import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

async function initSrScansTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS quant_lab_sr_scans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scan_name VARCHAR(255) NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        timeframe VARCHAR(20) NOT NULL,
        start_date TIMESTAMP WITH TIME ZONE NOT NULL,
        end_date TIMESTAMP WITH TIME ZONE NOT NULL,
        total_detected INT NOT NULL,
        sweep_rate_pct DECIMAL(5, 2) NOT NULL,
        reclaim_rate_pct DECIMAL(5, 2) NOT NULL,
        retest_rate_pct DECIMAL(5, 2) NOT NULL,
        retest_win_rate_pct DECIMAL(5, 2) NOT NULL,
        avg_realized_rr DECIMAL(6, 2) NOT NULL,
        profit_factor DECIMAL(6, 2) NOT NULL,
        telemetry_summary JSONB NOT NULL,
        setups JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (err) {
    console.error("[SR SCANS DB] Table init failed:", err);
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

    await initSrScansTable();

    // 1. Single scan detail fetch with full setups and telemetry_summary
    if (id) {
      const scanRes = await sql`
        SELECT * FROM quant_lab_sr_scans WHERE id = ${id} LIMIT 1
      `;
      if (scanRes.rows.length === 0) {
        return NextResponse.json({ error: "Sweep & Reclaim scan run not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, scan: scanRes.rows[0] });
    }

    // 2. Lightweight summary list query (excludes heavy setups & telemetry_summary JSONB columns)
    const scansRes = await sql`
      SELECT 
        id, scan_name, symbol, timeframe, start_date, end_date,
        total_detected, sweep_rate_pct, reclaim_rate_pct,
        retest_rate_pct, retest_win_rate_pct, avg_realized_rr,
        profit_factor, created_at
      FROM quant_lab_sr_scans
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return NextResponse.json({ 
      success: true, 
      scans: scansRes.rows,
      pagination: { limit, offset, count: scansRes.rows.length }
    });
  } catch (error: any) {
    console.error("[SR SCANS GET] Failed:", error);
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
      return NextResponse.json({ error: "Missing required parameter: 'id' is required." }, { status: 400 });
    }

    await initSrScansTable();
    const deleteRes = await sql`
      DELETE FROM quant_lab_sr_scans WHERE id = ${id} RETURNING id
    `;

    if (deleteRes.rows.length === 0) {
      return NextResponse.json({ error: "Sweep & Reclaim scan run not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted_id: id });
  } catch (error: any) {
    console.error("[SR SCANS DELETE] Failed:", error);
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
