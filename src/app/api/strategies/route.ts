import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

/**
 * Custom Strategies API — Strategy Architect Backend
 *
 * GET    /api/strategies  → Returns all strategies for the authenticated user.
 * POST   /api/strategies  → Upserts a strategy (create if no id, update if id provided).
 * DELETE  /api/strategies  → Deletes a strategy by id.
 *
 * Auth-protected via NextAuth session validation (fail-closed).
 */

// Self-healing table creation (mirrors pattern from /api/settings)
async function ensureTable() {
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
  try {
    await sql`ALTER TABLE custom_strategies ADD COLUMN IF NOT EXISTS target_environment VARCHAR(20) DEFAULT 'BOTH';`;
  } catch (err) {
    console.error("[STRATEGIES API] Failed to alter table custom_strategies:", err);
  }
}

// ─── GET: Fetch all strategies for the current user ───────────────────────────
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const summary = url.searchParams.get("summary") === "true";
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

    await ensureTable();

    const userEmail = session.user.email;

    if (id) {
      const { rows } = await sql`
        SELECT id, name, logic_json, is_active, target_environment, created_at, updated_at
        FROM custom_strategies
        WHERE id = ${id} AND user_id = ${userEmail}
        LIMIT 1
      `;
      if (rows.length === 0) {
        return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
      }
      const row = rows[0];
      return NextResponse.json({
        strategy: {
          id: row.id,
          name: row.name,
          conditions: row.logic_json,
          is_active: row.is_active,
          target_environment: row.target_environment || 'BOTH',
          created_at: row.created_at,
          updated_at: row.updated_at,
        }
      });
    }

    const { rows } = summary
      ? await sql`
          SELECT id, name, is_active, target_environment, created_at, updated_at
          FROM custom_strategies
          WHERE user_id = ${userEmail}
          ORDER BY created_at DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `
      : await sql`
          SELECT id, name, logic_json, is_active, target_environment, created_at, updated_at
          FROM custom_strategies
          WHERE user_id = ${userEmail}
          ORDER BY created_at DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `;

    // Transform rows to frontend-friendly shape
    const strategies = rows.map((row) => ({
      id: row.id,
      name: row.name,
      conditions: row.logic_json,
      is_active: row.is_active,
      target_environment: row.target_environment || 'BOTH',
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    return NextResponse.json({ 
      strategies,
      pagination: { limit, offset, count: strategies.length }
    });
  } catch (error: any) {
    console.error("[STRATEGIES API] GET Error:", error);
    const isQuotaExceeded = error?.code === "53000" || error?.message?.includes("quota") || error?.status === 402;
    return NextResponse.json(
      { 
        error: isQuotaExceeded ? "Database bandwidth quota exceeded." : "Failed to fetch strategies.",
        quota_exceeded: isQuotaExceeded
      },
      { status: isQuotaExceeded ? 402 : 500 }
    );
  }
}

// ─── POST: Create or Update a strategy ────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    if (process.env.READ_ONLY_LOCAL === "true") {
      return NextResponse.json(
        { error: "Forbidden: Local development sandbox is in READ-ONLY mode. Strategy mutations cannot be pushed to VPS database." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { id, name, conditions, is_active, target_environment } = body as {
      id?: string;
      name: string;
      conditions: any;
      is_active?: boolean;
      target_environment?: string;
    };

    const isLegacyArray = Array.isArray(conditions);
    const isNewObject = typeof conditions === "object" && conditions !== null && !Array.isArray(conditions) && Array.isArray(conditions.conditions);

    if (!name || (!isLegacyArray && !isNewObject)) {
      return NextResponse.json(
        { error: "Invalid payload: 'name' (string) and 'conditions' (array or structured settings object) are required." },
        { status: 400 }
      );
    }

    await ensureTable();
    const userEmail = session.user.email;
    const active = is_active !== undefined ? is_active : true;
    const targetEnv = target_environment || 'BOTH';

    if (id) {
      // UPDATE existing strategy (verify ownership)
      const { rowCount } = await sql`
        UPDATE custom_strategies
        SET name = ${name},
            logic_json = ${JSON.stringify(conditions)},
            is_active = ${active},
            target_environment = ${targetEnv},
            updated_at = NOW()
        WHERE id = ${id}::uuid AND user_id = ${userEmail}
      `;

      if (rowCount === 0) {
        return NextResponse.json(
          { error: "Strategy not found or access denied." },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, id, message: "Strategy updated." });
    } else {
      // CREATE new strategy
      const { rows } = await sql`
        INSERT INTO custom_strategies (user_id, name, logic_json, is_active, target_environment)
        VALUES (${userEmail}, ${name}, ${JSON.stringify(conditions)}, ${active}, ${targetEnv})
        RETURNING id
      `;

      return NextResponse.json({
        success: true,
        id: rows[0].id,
        message: "Strategy created.",
      });
    }
  } catch (error: unknown) {
    console.error("[STRATEGIES API] POST Error:", error);
    return NextResponse.json(
      { error: "Failed to save strategy." },
      { status: 500 }
    );
  }
}

// ─── DELETE: Remove a strategy by ID ──────────────────────────────────────────
export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    if (process.env.READ_ONLY_LOCAL === "true") {
      return NextResponse.json(
        { error: "Forbidden: Local development sandbox is in READ-ONLY mode. Strategy deletion cannot be pushed to VPS database." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { id } = body as { id: string };

    if (!id) {
      return NextResponse.json(
        { error: "Invalid payload: 'id' (UUID) is required." },
        { status: 400 }
      );
    }

    await ensureTable();
    const userEmail = session.user.email;

    const { rowCount } = await sql`
      DELETE FROM custom_strategies
      WHERE id = ${id}::uuid AND user_id = ${userEmail}
    `;

    if (rowCount === 0) {
      return NextResponse.json(
        { error: "Strategy not found or access denied." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: "Strategy deleted." });
  } catch (error: unknown) {
    console.error("[STRATEGIES API] DELETE Error:", error);
    return NextResponse.json(
      { error: "Failed to delete strategy." },
      { status: 500 }
    );
  }
}
