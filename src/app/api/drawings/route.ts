import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/postgres";
import { UserDrawing } from "@/lib/drawings/types";

// In-memory fallback storage for offline development
const inMemoryDrawings: Map<string, UserDrawing[]> = new Map();

async function initDrawingsTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS user_drawings (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        interval VARCHAR(20) NOT NULL DEFAULT 'ALL',
        drawing_type VARCHAR(50) NOT NULL,
        points JSONB NOT NULL,
        style JSONB NOT NULL,
        locked BOOLEAN DEFAULT false,
        visible BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_drawings_user_symbol ON user_drawings(user_id, symbol);`;
  } catch (err) {
    console.warn("[DRAWINGS API] Postgres table initialization skipped or offline:", err);
  }
}

// ─── GET: Fetch User Drawings ───────────────────────────────────────────────
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol") || "ETHUSDC";

    const session = await auth();
    const userId = session?.user?.email || "anonymous_user";

    try {
      await initDrawingsTable();
      const { rows } = await sql`
        SELECT id, symbol, interval, drawing_type as "type", points, style, locked, visible, 
               EXTRACT(EPOCH FROM created_at)*1000 as "createdAt",
               EXTRACT(EPOCH FROM updated_at)*1000 as "updatedAt"
        FROM user_drawings
        WHERE user_id = ${userId} AND symbol = ${symbol}
        ORDER BY created_at ASC;
      `;

      const drawings: UserDrawing[] = rows.map((r) => ({
        id: r.id,
        type: r.type,
        points: typeof r.points === 'string' ? JSON.parse(r.points) : r.points,
        style: typeof r.style === 'string' ? JSON.parse(r.style) : r.style,
        symbol: r.symbol,
        interval: r.interval || 'ALL',
        locked: !!r.locked,
        visible: r.visible !== false,
        createdAt: Number(r.createdAt) || Date.now(),
        updatedAt: Number(r.updatedAt) || Date.now(),
      }));

      return NextResponse.json({ success: true, drawings });
    } catch (dbErr) {
      // In-memory fallback
      const key = `${userId}_${symbol}`;
      const fallbackList = inMemoryDrawings.get(key) || [];
      return NextResponse.json({ success: true, drawings: fallbackList, isOffline: true });
    }
  } catch (error: any) {
    console.error("[DRAWINGS API] GET Error:", error);
    return NextResponse.json({ error: "Failed to fetch drawings" }, { status: 500 });
  }
}

// ─── POST: Batch Upsert / Sync Drawings ─────────────────────────────────────
export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.email || "anonymous_user";

    const body = await req.json();
    const { symbol = "ETHUSDC", drawings = [] } = body as { symbol?: string; drawings?: UserDrawing[] };

    try {
      await initDrawingsTable();

      // Clear existing records for this user and symbol and re-insert active set
      await sql`
        DELETE FROM user_drawings 
        WHERE user_id = ${userId} AND symbol = ${symbol};
      `;

      for (const d of drawings) {
        await sql`
          INSERT INTO user_drawings (
            id, user_id, symbol, interval, drawing_type, points, style, locked, visible, updated_at
          ) VALUES (
            ${d.id},
            ${userId},
            ${d.symbol || symbol},
            ${d.interval || 'ALL'},
            ${d.type},
            ${JSON.stringify(d.points)},
            ${JSON.stringify(d.style)},
            ${!!d.locked},
            ${d.visible !== false},
            NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            points = EXCLUDED.points,
            style = EXCLUDED.style,
            locked = EXCLUDED.locked,
            visible = EXCLUDED.visible,
            updated_at = NOW();
        `;
      }

      // Also update in-memory cache
      const key = `${userId}_${symbol}`;
      inMemoryDrawings.set(key, drawings);

      return NextResponse.json({ success: true, count: drawings.length });
    } catch (dbErr) {
      // Offline fallback
      const key = `${userId}_${symbol}`;
      inMemoryDrawings.set(key, drawings);
      return NextResponse.json({ success: true, count: drawings.length, isOffline: true });
    }
  } catch (error: any) {
    console.error("[DRAWINGS API] POST Error:", error);
    return NextResponse.json({ error: "Failed to save drawings" }, { status: 500 });
  }
}

// ─── DELETE: Remove specific drawing or clear all ───────────────────────────
export async function DELETE(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.email || "anonymous_user";

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const symbol = searchParams.get("symbol") || "ETHUSDC";
    const clearAll = searchParams.get("clearAll") === "true";

    try {
      await initDrawingsTable();

      if (clearAll) {
        await sql`DELETE FROM user_drawings WHERE user_id = ${userId} AND symbol = ${symbol};`;
        inMemoryDrawings.set(`${userId}_${symbol}`, []);
      } else if (id) {
        await sql`DELETE FROM user_drawings WHERE user_id = ${userId} AND id = ${id};`;
        const key = `${userId}_${symbol}`;
        const current = inMemoryDrawings.get(key) || [];
        inMemoryDrawings.set(key, current.filter((d) => d.id !== id));
      }

      return NextResponse.json({ success: true });
    } catch (dbErr) {
      const key = `${userId}_${symbol}`;
      if (clearAll) {
        inMemoryDrawings.set(key, []);
      } else if (id) {
        const current = inMemoryDrawings.get(key) || [];
        inMemoryDrawings.set(key, current.filter((d) => d.id !== id));
      }
      return NextResponse.json({ success: true, isOffline: true });
    }
  } catch (error: any) {
    console.error("[DRAWINGS API] DELETE Error:", error);
    return NextResponse.json({ error: "Failed to delete drawings" }, { status: 500 });
  }
}
