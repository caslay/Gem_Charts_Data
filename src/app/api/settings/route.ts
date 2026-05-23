import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

/**
 * Settings API — Command Center Backend
 *
 * GET  /api/settings  → Returns all system_settings rows as { key: value } map AND terminal_settings.
 * POST /api/settings  → Upserts key-value pairs into system_settings OR terminal_settings.
 *
 * Both endpoints are protected by NextAuth session validation.
 * Fail-closed: if session is missing, returns 401 immediately.
 */

// Helper to ensure database table is created dynamically (self-healing architecture)
async function initTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS terminal_settings (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) UNIQUE NOT NULL,
      signal_sounds JSONB NOT NULL,
      enabled_signals JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS custom_strategies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      logic_json JSONB NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
}

// ─── GET: Fetch all settings ──────────────────────────────────────────────────
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    // Ensure the terminal settings schema is loaded
    await initTables();

    // 1. Fetch system settings
    const { rows } = await sql`
      SELECT key_name, key_value FROM system_settings
    `;

    // Transform rows into a clean key-value map
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key_name] = row.key_value;
    }

    // 2. Fetch specific user's terminal settings
    const userEmail = session.user.email;
    const { rows: termRows } = await sql`
      SELECT signal_sounds, enabled_signals FROM terminal_settings
      WHERE user_id = ${userEmail}
      LIMIT 1
    `;

    const terminalSettings = termRows.length > 0 ? {
      signalSounds: termRows[0].signal_sounds,
      enabledSignals: termRows[0].enabled_signals,
    } : null;

    return NextResponse.json({ settings, terminalSettings });
  } catch (error: unknown) {
    console.error("[SETTINGS API] GET Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings." },
      { status: 500 }
    );
  }
}

// ─── POST: Upsert settings ───────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    const body = await req.json();
    
    // Ensure the terminal settings schema is loaded
    await initTables();

    // 1. Handle terminalSettings payload if provided
    if (body.terminalSettings) {
      const { signalSounds, enabledSignals } = body.terminalSettings as {
        signalSounds: Record<string, string>;
        enabledSignals: Record<string, boolean>;
      };

      if (!signalSounds || !enabledSignals) {
        return NextResponse.json(
          { error: "Invalid payload: 'terminalSettings' with 'signalSounds' and 'enabledSignals' required." },
          { status: 400 }
        );
      }

      const userEmail = session.user.email;

      await sql`
        INSERT INTO terminal_settings (user_id, signal_sounds, enabled_signals, updated_at)
        VALUES (${userEmail}, ${JSON.stringify(signalSounds)}, ${JSON.stringify(enabledSignals)}, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET 
          signal_sounds = EXCLUDED.signal_sounds,
          enabled_signals = EXCLUDED.enabled_signals,
          updated_at = NOW()
      `;

      return NextResponse.json({ success: true, message: "Terminal settings saved." });
    }

    // 2. Otherwise, handle legacy system settings payload
    const { settings } = body as { settings: Record<string, string> };

    if (!settings || typeof settings !== "object") {
      return NextResponse.json(
        { error: "Invalid payload: 'settings' object required." },
        { status: 400 }
      );
    }

    // Upsert each key-value pair using ON CONFLICT
    for (const [key, value] of Object.entries(settings)) {
      if (typeof key !== "string" || typeof value !== "string") continue;

      await sql`
        INSERT INTO system_settings (key_name, key_value)
        VALUES (${key}, ${value})
        ON CONFLICT (key_name)
        DO UPDATE SET key_value = EXCLUDED.key_value, updated_at = NOW()
      `;
    }

    return NextResponse.json({ success: true, message: "Settings saved." });
  } catch (error: unknown) {
    console.error("[SETTINGS API] POST Error:", error);
    return NextResponse.json(
      { error: "Failed to save settings." },
      { status: 500 }
    );
  }
}
