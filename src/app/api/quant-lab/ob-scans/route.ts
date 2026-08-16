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

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await initObScansTable();
    const scansRes = await sql`
      SELECT 
        id, scan_name, symbol, timeframe, start_date, end_date,
        total_detected, validation_rate_pct, mt_reaction_rate_pct,
        mitigation_win_rate_pct, avg_rr_tp1, avg_rr_tp2,
        telemetry_summary, order_blocks, created_at
      FROM quant_lab_ob_scans
      ORDER BY created_at DESC
    `;
    return NextResponse.json({ success: true, scans: scansRes.rows });
  } catch (error: any) {
    console.error("[OB SCANS GET] Failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
