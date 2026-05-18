import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

/**
 * Settings API — Command Center Backend
 *
 * GET  /api/settings  → Returns all system_settings rows as { key: value } map.
 * POST /api/settings  → Upserts one or more key-value pairs into system_settings.
 *
 * Both endpoints are protected by NextAuth session validation.
 * Fail-closed: if session is missing, returns 401 immediately.
 */

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

    const { rows } = await sql`
      SELECT key_name, key_value FROM system_settings
    `;

    // Transform rows into a clean key-value map
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key_name] = row.key_value;
    }

    return NextResponse.json({ settings });
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
