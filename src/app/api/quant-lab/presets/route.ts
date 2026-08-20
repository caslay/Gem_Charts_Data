import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";
import { ScannerPreset } from "@/lib/quantEngine/scannerPresets";

// In-memory fallback storage for offline development / database quota degradation
const inMemoryPresets: Map<string, ScannerPreset[]> = new Map();

async function initPresetsTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS quant_scanner_presets (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        strategy_type VARCHAR(50) NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        timeframe VARCHAR(20) NOT NULL,
        config JSONB NOT NULL,
        is_factory BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_quant_presets_user ON quant_scanner_presets(user_id, strategy_type);`;
  } catch (err) {
    console.warn("[PRESETS API] Postgres table initialization skipped or offline:", err);
  }
}

// ─── GET: Fetch Saved Presets ───────────────────────────────────────────────
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const strategyType = searchParams.get("strategyType");

    const session = await auth();
    const userId = session?.user?.email || "anonymous_user";

    try {
      await initPresetsTable();
      const { rows } = strategyType
        ? await sql`
            SELECT id, name, description, strategy_type as "strategyType", symbol, timeframe, config, is_factory as "isFactory",
                   EXTRACT(EPOCH FROM created_at)*1000 as "createdAt",
                   EXTRACT(EPOCH FROM updated_at)*1000 as "updatedAt"
            FROM quant_scanner_presets
            WHERE user_id = ${userId} AND strategy_type = ${strategyType}
            ORDER BY updated_at DESC;
          `
        : await sql`
            SELECT id, name, description, strategy_type as "strategyType", symbol, timeframe, config, is_factory as "isFactory",
                   EXTRACT(EPOCH FROM created_at)*1000 as "createdAt",
                   EXTRACT(EPOCH FROM updated_at)*1000 as "updatedAt"
            FROM quant_scanner_presets
            WHERE user_id = ${userId}
            ORDER BY updated_at DESC;
          `;

      const presets: ScannerPreset[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description || undefined,
        strategyType: r.strategyType,
        symbol: r.symbol,
        timeframe: r.timeframe,
        isFactory: !!r.isFactory,
        syncStatus: 'synced',
        createdAt: Number(r.createdAt) || Date.now(),
        updatedAt: Number(r.updatedAt) || Date.now(),
        config: typeof r.config === 'string' ? JSON.parse(r.config) : r.config,
      }));

      return NextResponse.json({ success: true, presets });
    } catch (dbErr: any) {
      // Check if error is quota exceeded (HTTP 402)
      const isQuotaError = dbErr?.message?.includes('exceeded') || dbErr?.code === '402';
      const key = `${userId}_${strategyType || 'ALL'}`;
      const fallbackList = inMemoryPresets.get(key) || [];
      return NextResponse.json(
        { success: true, presets: fallbackList, isOffline: true, isQuotaExceeded: isQuotaError },
        { status: isQuotaError ? 402 : 200 }
      );
    }
  } catch (error: any) {
    console.warn("[PRESETS API] GET Error:", error);
    return NextResponse.json({ success: true, presets: [], isOffline: true });
  }
}

// ─── POST: Upsert Custom Preset ─────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.email || "anonymous_user";

    const body = await req.json();
    const preset: ScannerPreset = body.preset;

    if (!preset || !preset.id || !preset.name || !preset.strategyType) {
      return NextResponse.json({ error: "Invalid preset payload" }, { status: 400 });
    }

    try {
      await initPresetsTable();
      const configJson = JSON.stringify(preset.config);
      const createdAtDate = new Date(preset.createdAt || Date.now()).toISOString();
      const updatedAtDate = new Date(preset.updatedAt || Date.now()).toISOString();

      await sql`
        INSERT INTO quant_scanner_presets (
          id, user_id, name, description, strategy_type, symbol, timeframe, config, is_factory, created_at, updated_at
        ) VALUES (
          ${preset.id},
          ${userId},
          ${preset.name},
          ${preset.description || null},
          ${preset.strategyType},
          ${preset.symbol || 'ETHUSDC'},
          ${preset.timeframe || '15m'},
          ${configJson}::jsonb,
          ${preset.isFactory || false},
          ${createdAtDate},
          ${updatedAtDate}
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          symbol = EXCLUDED.symbol,
          timeframe = EXCLUDED.timeframe,
          config = EXCLUDED.config,
          updated_at = EXCLUDED.updated_at;
      `;

      // Update in-memory fallback
      const key = `${userId}_${preset.strategyType}`;
      const list = inMemoryPresets.get(key) || [];
      const updatedList = [preset, ...list.filter((p) => p.id !== preset.id)];
      inMemoryPresets.set(key, updatedList);

      return NextResponse.json({ success: true, preset: { ...preset, syncStatus: 'synced' } });
    } catch (dbErr: any) {
      // Graceful fallback on database error
      const isQuotaError = dbErr?.message?.includes('exceeded') || dbErr?.code === '402';
      const key = `${userId}_${preset.strategyType}`;
      const list = inMemoryPresets.get(key) || [];
      const updatedList = [preset, ...list.filter((p) => p.id !== preset.id)];
      inMemoryPresets.set(key, updatedList);

      return NextResponse.json(
        { success: true, preset, isOffline: true, isQuotaExceeded: isQuotaError },
        { status: isQuotaError ? 402 : 200 }
      );
    }
  } catch (error: any) {
    console.warn("[PRESETS API] POST Error:", error);
    return NextResponse.json({ error: "Failed to persist preset" }, { status: 500 });
  }
}

// ─── DELETE: Delete Custom Preset ───────────────────────────────────────────
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Preset ID is required" }, { status: 400 });
    }

    const session = await auth();
    const userId = session?.user?.email || "anonymous_user";

    try {
      await initPresetsTable();
      await sql`
        DELETE FROM quant_scanner_presets
        WHERE id = ${id} AND user_id = ${userId};
      `;

      // Update in-memory fallback
      for (const [k, list] of inMemoryPresets.entries()) {
        if (k.startsWith(userId)) {
          inMemoryPresets.set(k, list.filter((p) => p.id !== id));
        }
      }

      return NextResponse.json({ success: true, deletedId: id });
    } catch (dbErr) {
      return NextResponse.json({ success: true, deletedId: id, isOffline: true });
    }
  } catch (error: any) {
    console.warn("[PRESETS API] DELETE Error:", error);
    return NextResponse.json({ error: "Failed to delete preset" }, { status: 500 });
  }
}
