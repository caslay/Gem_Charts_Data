import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const runId = url.searchParams.get("run_id");
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10), 1), 500);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);
    const detail = url.searchParams.get("detail") === "true";

    if (!runId) {
      return NextResponse.json({ error: "Missing required query parameter: 'run_id'." }, { status: 400 });
    }

    const tradesRes = detail
      ? await sql`
          SELECT * FROM quant_lab_trades 
          WHERE run_id = ${runId} 
          ORDER BY timestamp ASC
          LIMIT ${limit}
          OFFSET ${offset}
        `
      : await sql`
          SELECT 
            id, run_id, timestamp, direction, entry_price, exit_price, stop_loss, take_profit,
            realized_pnl, roi, position_size, status, exit_timestamp, logic_trigger, created_at
          FROM quant_lab_trades 
          WHERE run_id = ${runId} 
          ORDER BY timestamp ASC
          LIMIT ${limit}
          OFFSET ${offset}
        `;

    return NextResponse.json({ 
      success: true, 
      trades: tradesRes.rows,
      pagination: { limit, offset, count: tradesRes.rows.length }
    });
  } catch (error: any) {
    console.error("[QUANT LAB GET TRADES] Fetch failed:", error);
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
