import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

// Self-healing check to ensure the tables are initialized if queried
async function initTables() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS quant_lab_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        strategy_config JSONB NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        start_date TIMESTAMP WITH TIME ZONE NOT NULL,
        end_date TIMESTAMP WITH TIME ZONE NOT NULL,
        initial_balance DECIMAL(18, 4) NOT NULL,
        final_balance DECIMAL(18, 4) NOT NULL,
        total_trades INT NOT NULL DEFAULT 0,
        winning_trades INT NOT NULL DEFAULT 0,
        losing_trades INT NOT NULL DEFAULT 0,
        win_rate_pct DECIMAL(5, 2) NOT NULL DEFAULT 0,
        total_pnl DECIMAL(18, 4) NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS quant_lab_trades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID REFERENCES quant_lab_runs(id) ON DELETE CASCADE,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        direction VARCHAR(10) NOT NULL,
        entry_price DECIMAL(18, 4) NOT NULL,
        exit_price DECIMAL(18, 4),
        stop_loss DECIMAL(18, 4) NOT NULL,
        take_profit DECIMAL(18, 4) NOT NULL,
        realized_pnl DECIMAL(18, 4),
        roi DECIMAL(18, 4),
        position_size DECIMAL(18, 4) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'CLOSED',
        exit_timestamp TIMESTAMP WITH TIME ZONE,
        logic_trigger VARCHAR(255),
        ipda_metrics_at_entry JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (error) {
    console.error("[QUANT LAB API] Table self-healing initialization failed:", error);
  }
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "25", 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

    await initTables();

    // 1. Single run detail fetch with full strategy config
    if (id) {
      const runRes = await sql`
        SELECT * FROM quant_lab_runs WHERE id = ${id} LIMIT 1
      `;
      if (runRes.rows.length === 0) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, run: runRes.rows[0] });
    }

    // 2. Lightweight summary list query (excludes heavy strategy_config JSONB column)
    const runsRes = await sql`
      SELECT 
        id, name, symbol, start_date, end_date, initial_balance, final_balance,
        total_trades, winning_trades, losing_trades, win_rate_pct, total_pnl, created_at
      FROM quant_lab_runs 
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return NextResponse.json({ 
      success: true, 
      runs: runsRes.rows,
      pagination: { limit, offset, count: runsRes.rows.length }
    });
  } catch (error: any) {
    console.error("[QUANT LAB GET RUNS] Fetch failed:", error);
    const isQuotaExceeded = error?.code === "53000" || error?.message?.includes("quota") || error?.status === 402;
    return NextResponse.json(
      { 
        error: isQuotaExceeded ? "Database bandwidth quota exceeded. Upgrade plan or contact administrator." : error.message,
        quota_exceeded: isQuotaExceeded
      }, 
      { status: isQuotaExceeded ? 402 : 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing required parameter: 'id' is required to delete." }, { status: 400 });
    }

    await initTables();
    const deleteRes = await sql`
      DELETE FROM quant_lab_runs WHERE id = ${id} RETURNING id
    `;

    if (deleteRes.rows.length === 0) {
      return NextResponse.json({ error: "Historical run not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted_id: id });
  } catch (error: any) {
    console.error("[QUANT LAB DELETE RUN] Failed:", error);
    const isQuotaExceeded = error?.code === "53000" || error?.message?.includes("quota") || error?.status === 402;
    return NextResponse.json(
      { 
        error: isQuotaExceeded ? "Database bandwidth quota exceeded." : error.message,
        quota_exceeded: isQuotaExceeded
      }, 
      { status: isQuotaExceeded ? 402 : 500 }
    );
  }
}
