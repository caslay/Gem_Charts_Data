import { NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';
import { DEFAULT_ETH_SOP_SYSTEM_PROMPT } from '@/lib/sopPromptBuilder';
import { DEFAULT_MODEL } from '@/lib/aiModels';
import { runAiCascadeEvaluation, fetchAiAnalysisHistory } from '@/lib/aiCascadeEngine';
import { buildLiveSessionContext } from '@/lib/sessionContext';

export const dynamic = 'force-dynamic';

/**
 * Quant Analyze API — Resilient Multi-Model Cascade & Telemetry Engine
 *
 * Supports:
 * - POST: Execute real-time institutional AI evaluation with automated multi-model cascade
 *   (Apex Flash -> High-Quota Lite Workhorse) upon 429/503 errors and DB telemetry persistence.
 * - GET: Fetch chronological history of recent AI analysis runs with pagination and bounds.
 */
export async function POST(req: Request) {
  try {
    // ── 1. Fetch all engine parameters from the Vault in a single query ──
    let config: Record<string, string> = {};
    try {
      const { rows } = await sql`
        SELECT key_name, key_value FROM system_settings
        WHERE key_name IN ('GEMINI_LIVE_KEY', 'OPENROUTER_API_KEY', 'ACTIVE_MODEL', 'SYSTEM_PROMPT')
      `;
      for (const row of rows) {
        config[row.key_name] = row.key_value;
      }
    } catch (dbErr) {
      console.warn('[QUANT_ANALYZE] System settings read error (using env fallback):', dbErr);
    }

    const geminiApiKey = config['GEMINI_LIVE_KEY'] || process.env.GEMINI_LIVE_KEY;
    const openRouterApiKey = config['OPENROUTER_API_KEY'] || process.env.OPENROUTER_API_KEY;
    const activeModel = config['ACTIVE_MODEL'] || process.env.ACTIVE_MODEL || DEFAULT_MODEL;
    let systemPrompt = config['SYSTEM_PROMPT'] || DEFAULT_ETH_SOP_SYSTEM_PROMPT;

    // Guard against outdated prompt in DB: ensure Canonical Pure Pro-Trend Continuation V19.0 is active
    const isOutdatedPrompt = !config['SYSTEM_PROMPT'] ||
      !config['SYSTEM_PROMPT'].includes('V19.0') ||
      config['SYSTEM_PROMPT'].includes('Sweep & Reclaim') ||
      config['SYSTEM_PROMPT'].includes('Phase C Spring') ||
      config['SYSTEM_PROMPT'].includes('Mean Reversion');

    if (isOutdatedPrompt) {
      systemPrompt = DEFAULT_ETH_SOP_SYSTEM_PROMPT;
      // Proactively upgrade system_settings in DB
      sql`
        INSERT INTO system_settings (key_name, key_value)
        VALUES ('SYSTEM_PROMPT', ${DEFAULT_ETH_SOP_SYSTEM_PROMPT})
        ON CONFLICT (key_name)
        DO UPDATE SET key_value = EXCLUDED.key_value;
      `.catch((err) => console.warn('[QUANT_ANALYZE] Auto-migrate SYSTEM_PROMPT to V19.0 skipped:', err));
    }

    // ── 2. Graceful validation: Ensure at least one intelligence provider key is configured ──
    if (!geminiApiKey && !openRouterApiKey) {
      return NextResponse.json(
        {
          analysis: `⚠️ **Quant AI Engine Notice:** Neither Google Gemini API Key nor OpenRouter API Key is configured in Settings. Please set your \`GEMINI_LIVE_KEY\` or \`OPENROUTER_API_KEY\` in the Command Center Vault or environment to activate real-time institutional AI analysis.`,
          isConfigured: false,
          telemetry: null,
        },
        { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
      );
    }

    // ── 3. Extract the incoming V8.x JSON payload ────────────────────────
    const payload = await req.json();

    // ── 4. Fetch Historical Memory from ai_trade_state ───────────────────
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

    // ── 5. Invalidation Guard & Dynamic Live Session Stamping ───────────
    const executionNow = new Date();
    const livePrice = extractLivePrice(payload);
    const liveSessionContext = buildLiveSessionContext(executionNow, livePrice);

    // Dynamically stamp the current session context at the exact millisecond of analysis execution.
    // Overwrites any stale cached timestamps with the active live clock and active killzone.
    payload.timestamp = executionNow.toISOString();
    payload.session_context = liveSessionContext;
    if (payload.ipda_metrics && typeof payload.ipda_metrics === 'object') {
      const ipda = payload.ipda_metrics as Record<string, unknown>;
      ipda.current_time_window = liveSessionContext.current_killzone;
      ipda.session_context = liveSessionContext;
    }

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
        breached = false;
      }

      if (breached) {
        console.log(
          `[MEMORY BANK] Invalidation breached. Live: ${livePrice}, Level: ${invalidation}, Direction: ${direction || 'N/A'}. Resetting to SEARCHING.`
        );
        parsedState = { status: 'SEARCHING' };
      }
    }

    // ── 6. Execute Multi-Model Cascade with Telemetry & Persistence ──────
    const result = await runAiCascadeEvaluation({
      apiKey: geminiApiKey,
      geminiApiKey,
      openRouterApiKey,
      requestedModel: activeModel,
      systemPrompt,
      payload,
      historicalState: parsedState,
      symbol: (payload?.symbol as string) || 'ETHUSDC',
      timeframe: (payload?.timeframe as string) || '5m',
    });

    // ── 7. Return comprehensive response to client ───────────────────────
    return NextResponse.json(
      {
        analysis: result.text,
        telemetry: result.telemetry,
        status: result.status,
        tradeDirection: result.tradeDirection,
        biasSignal: result.biasSignal,
        setup: {
          entry_range_low: result.entryRangeLow,
          entry_range_high: result.entryRangeHigh,
          invalidation_level: result.invalidationLevel,
          target_1: result.target1,
          target_2: result.target2,
          target_3: result.target3,
        },
        logId: result.logId,
        isConfigured: true,
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  } catch (error: unknown) {
    console.error('[QUANT_ANALYZE] Quant AI Engine Cascade Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error during AI analysis.';
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  }
}

/**
 * GET Handler — Fetch recent AI evaluation telemetry records
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;
    const page = searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1;
    const symbol = searchParams.get('symbol') || undefined;
    const status = searchParams.get('status') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const currentPrice = searchParams.get('currentPrice') ? parseFloat(searchParams.get('currentPrice')!) : undefined;

    const data = await fetchAiAnalysisHistory({
      limit,
      page,
      symbol,
      status,
      startDate,
      endDate,
      currentPrice,
    });

    return NextResponse.json(
      {
        success: true,
        data: data.history,
        summary: data.summary,
        pagination: data.pagination,
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  } catch (error: unknown) {
    console.error('[QUANT_ANALYZE] GET History Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to retrieve AI analysis history.';
    return NextResponse.json(
      { error: message, success: false, data: [] },
      { status: 500, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  }
}

// ─── Helper: Extract live price from the most recent candle ──────────────────
function extractLivePrice(payload: Record<string, unknown>): number | null {
  if (typeof payload?.live_price === 'number' && !isNaN(payload.live_price) && payload.live_price > 0) {
    return payload.live_price;
  }
  const ipda = payload?.ipda_metrics as Record<string, unknown> | undefined;
  const currentPricing = ipda?.current_pricing as Record<string, unknown> | undefined;
  if (typeof currentPricing?.current_price === 'number' && !isNaN(currentPricing.current_price) && currentPricing.current_price > 0) {
    return currentPricing.current_price;
  }

  const dp = payload?.data_payload as Record<string, unknown> | undefined;
  if (!dp) return null;

  // Priority: 5m → 15m → 1h → 4h (most granular = most recent close)
  const priorities = ['candles_5m', 'candles_15m', 'candles_1h', 'candles_4h'];
  for (const key of priorities) {
    const candles = dp[key] as Array<{ c?: number }> | undefined;
    if (Array.isArray(candles) && candles.length > 0) {
      const lastCandle = candles[candles.length - 1];
      if (lastCandle?.c != null && typeof lastCandle.c === 'number' && lastCandle.c > 0) {
        return lastCandle.c;
      }
    }
  }

  return null;
}
