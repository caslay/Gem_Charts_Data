import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { sql } from '@vercel/postgres';

/**
 * Quant Analyze API — V8.2 Dynamic Engine
 *
 * All three critical parameters (API Key, Model, System Prompt) are
 * fetched from `system_settings` at runtime. Zero hardcoded values.
 * Fail-closed: if ANY parameter is missing, execution is aborted.
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

    // ── 3. Initialize the Google Generative AI client ────────────────────
    const genAI = new GoogleGenerativeAI(apiKey);

    // ── 4. Extract the incoming V8.x JSON payload ────────────────────────
    const payload = await req.json();

    // ── 5. Select the dynamically configured model ───────────────────────
    const model = genAI.getGenerativeModel({ model: activeModel });

    // ── 6. Construct the final prompt: System Instructions + Payload ─────
    const prompt = `${systemPrompt}\n\n=== MARKET DATA PAYLOAD ===\n${JSON.stringify(payload, null, 2)}`;

    // ── 7. Send the message to the Gemini model ──────────────────────────
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // ── 8. Return the extracted markdown text to the client ──────────────
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
