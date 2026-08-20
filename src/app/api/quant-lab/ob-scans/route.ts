import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

async function initObScansTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS quant_lab_ob_scans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scan_name VARCHAR(255) NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        timeframe VARCHAR(20) NOT NULL,
        start_date TIMESTAMP WITH TIME ZONE NOT NULL,
        end_date TIMESTAMP WITH TIME ZONE NOT NULL,
        total_detected INT NOT NULL,
        validation_rate_pct DECIMAL(5, 2) NOT NULL,
        mt_reaction_rate_pct DECIMAL(5, 2) NOT NULL,
        mitigation_win_rate_pct DECIMAL(5, 2) NOT NULL,
        avg_rr_tp1 DECIMAL(6, 2) NOT NULL,
        avg_rr_tp2 DECIMAL(6, 2) NOT NULL,
        telemetry_summary JSONB NOT NULL,
        order_blocks JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (err) {
    console.error("[OB SCANS DB] Table init failed:", err);
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

    await initObScansTable();

    // 1. Single scan detail fetch with full order_blocks and telemetry_summary
    if (id) {
      const scanRes = await sql`
        SELECT * FROM quant_lab_ob_scans WHERE id = ${id} LIMIT 1
      `;
      if (scanRes.rows.length === 0) {
        return NextResponse.json({ error: "Order Block scan run not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, scan: scanRes.rows[0] });
    }

    // 2. Lightweight summary list query (excludes heavy order_blocks & telemetry_summary JSONB columns)
    const scansRes = await sql`
      SELECT 
        id, scan_name, symbol, timeframe, start_date, end_date,
        total_detected, validation_rate_pct, mt_reaction_rate_pct,
        mitigation_win_rate_pct, avg_rr_tp1, avg_rr_tp2, created_at
      FROM quant_lab_ob_scans
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
    console.error("[OB SCANS GET] Failed:", error);
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

    await initObScansTable();
    const deleteRes = await sql`
      DELETE FROM quant_lab_ob_scans WHERE id = ${id} RETURNING id
    `;

    if (deleteRes.rows.length === 0) {
      return NextResponse.json({ error: "Order Block scan run not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted_id: id });
  } catch (error: any) {
    console.error("[OB SCANS DELETE] Failed:", error);
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
