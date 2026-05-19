import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { sql } from '@vercel/postgres';

/**
 * Quant Analyze API — V8.3 Stateful Engine (Phase 4)
 *
 * All three critical parameters (API Key, Model, System Prompt) are
 * fetched from `system_settings` at runtime. Zero hardcoded values.
 *
 * NEW in Phase 4:
 * - Fetches `historical_memory` from `ai_trade_state` before each run.
 * - Invalidation Guard: resets state if live_price breaches invalidation_level.
 * - Injects memory into the Gemini prompt as a new context section.
 * - Parses `next_database_state` from Gemini's response and upserts it back.
 *
 * Fail-closed: if ANY critical parameter is missing, execution is aborted.
 */
export async function POST(req: Request) {
  try {
    // ── 1. Fetch all engine parameters from the Vault in a single query ──
    const { rows } = await sql`
      SELECT key_name, key_value FROM system_settings
      WHERE key_name IN ('GEMINI_LIVE_KEY', 'ACTIVE_MODEL', 'SYSTEM_PROMPT')
    `;

    const config: Record<string, string> = {};
    for (const row of rows) {
      config[row.key_name] = row.key_value;
    }

    const apiKey = config['GEMINI_LIVE_KEY'];
    const activeModel = config['ACTIVE_MODEL'];
    const systemPrompt = config['SYSTEM_PROMPT'];

    // ── 2. Fail-closed validation — all three parameters are mandatory ──
    if (!apiKey) {
      return NextResponse.json(
        { error: 'System Vault Locked: Missing API Key.' },
        { status: 500 }
      );
    }
    if (!activeModel) {
      return NextResponse.json(
        { error: 'Engine Misconfigured: ACTIVE_MODEL not set in Command Center.' },
        { status: 500 }
      );
    }
    if (!systemPrompt) {
      return NextResponse.json(
        { error: 'Engine Misconfigured: SYSTEM_PROMPT not set in Command Center.' },
        { status: 500 }
      );
    }

    // ── 3. Extract the incoming V8.x JSON payload ────────────────────────
    const payload = await req.json();

    // ── 4. PHASE 4: Fetch Historical Memory from ai_trade_state ─────────
    let parsedState: Record<string, unknown> = { status: 'SEARCHING' };
    try {
      const stateResult = await sql`
        SELECT state_json FROM ai_trade_state WHERE id = 1
      `;
      if (stateResult.rows.length > 0 && stateResult.rows[0].state_json) {
        const raw = stateResult.rows[0].state_json;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object') {
          parsedState = parsed;
        }
      }
    } catch (stateErr) {
      console.warn('[MEMORY BANK] Failed to fetch/parse ai_trade_state, defaulting to SEARCHING:', stateErr);
      parsedState = { status: 'SEARCHING' };
    }

    // ── 5. PHASE 4: Invalidation Guard ──────────────────────────────────
    // Extract live_price from the most recent candle (5m → 15m → 1h → 4h fallback)
    const livePrice = extractLivePrice(payload);

    if (
      livePrice !== null &&
      parsedState.invalidation_level != null &&
      typeof parsedState.invalidation_level === 'number'
    ) {
      const invalidation = parsedState.invalidation_level as number;
      const direction = (parsedState.trade_direction as string)?.toUpperCase();

      let breached = false;

      if (direction === 'LONG' && livePrice <= invalidation) {
        breached = true;
      } else if (direction === 'SHORT' && livePrice >= invalidation) {
        breached = true;
      } else if (!direction) {
        // Direction-agnostic: any crossing is a breach
        // Check if the live price has moved past invalidation in either direction
        breached = true;
      }

      if (breached) {
        console.log(
          `[MEMORY BANK] Invalidation breached. Live: ${livePrice}, Level: ${invalidation}, Direction: ${direction || 'N/A'}. Resetting to SEARCHING.`
        );
        parsedState = { status: 'SEARCHING' };
      }
    }

    // ── 6. Initialize the Google Generative AI client ────────────────────
    const genAI = new GoogleGenerativeAI(apiKey);

    // ── 7. Select the dynamically configured model ───────────────────────
    const model = genAI.getGenerativeModel({ model: activeModel });

    // ── 8. Construct the final prompt: System + Payload + Memory ─────────
    const memorySection = `\n\n=== [HISTORICAL MEMORY (CURRENT STATE)] ===\n${JSON.stringify(parsedState, null, 2)}`;
    const prompt = `${systemPrompt}\n\n=== MARKET DATA PAYLOAD ===\n${JSON.stringify(payload, null, 2)}${memorySection}`;

    // ── 9. Send the message to the Gemini model ──────────────────────────
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // ── 10. PHASE 4: Parse next_database_state & UPSERT ─────────────────
    try {
      const nextState = extractNextDatabaseState(text);
      if (nextState) {
        await sql`
          UPDATE ai_trade_state
          SET state_json = ${JSON.stringify(nextState)}, updated_at = NOW()
          WHERE id = 1
        `;
        console.log('[MEMORY BANK] State updated:', JSON.stringify(nextState).substring(0, 200));
      } else {
        console.log('[MEMORY BANK] No next_database_state found in AI response. State unchanged.');
      }
    } catch (upsertErr) {
      console.error('[MEMORY BANK] Failed to upsert next_database_state:', upsertErr);
      // Non-fatal: the analysis still returns to the client
    }

    // ── 11. Return the extracted markdown text to the client ─────────────
    return NextResponse.json({ analysis: text });

  } catch (error: unknown) {
    console.error('Quant AI Engine Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error during AI analysis.';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// ─── Helper: Extract live price from the most recent candle ──────────────────
function extractLivePrice(payload: Record<string, unknown>): number | null {
  const dp = payload?.data_payload as Record<string, unknown> | undefined;
  if (!dp) return null;

  // Priority: 5m → 15m → 1h → 4h (most granular = most recent close)
  const priorities = ['candles_5m', 'candles_15m', 'candles_1h', 'candles_4h'];
  for (const key of priorities) {
    const candles = dp[key] as Array<{ c?: number }> | undefined;
    if (Array.isArray(candles) && candles.length > 0) {
      const lastCandle = candles[candles.length - 1];
      if (lastCandle?.c != null && typeof lastCandle.c === 'number') {
        return lastCandle.c;
      }
    }
  }

  return null;
}

// ─── Helper: Extract next_database_state from Gemini's response ─────────────
function extractNextDatabaseState(text: string): Record<string, unknown> | null {
  try {
    // Step 1: Try to find a ```json ... ``` block in the response
    const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const candidate = jsonBlockMatch ? jsonBlockMatch[1].trim() : text.trim();

    // Step 2: Try direct JSON parse
    const parsed = JSON.parse(candidate);

    // Step 3: Extract next_database_state from the parsed object
    if (parsed && typeof parsed === 'object' && parsed.next_database_state) {
      return parsed.next_database_state as Record<string, unknown>;
    }

    return null;
  } catch {
    // Step 4: Regex fallback — look for "next_database_state": { ... } pattern
    try {
      const stateMatch = text.match(
        /"next_database_state"\s*:\s*(\{[\s\S]*?\})\s*(?:,|\})/
      );
      if (stateMatch) {
        return JSON.parse(stateMatch[1]);
      }
    } catch {
      // Could not extract
    }
    return null;
  }
}
