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

    if (!runId) {
      return NextResponse.json({ error: "Missing required query parameter: 'run_id'." }, { status: 400 });
    }

    const tradesRes = await sql`
      SELECT * FROM quant_lab_trades WHERE run_id = ${runId} ORDER BY timestamp ASC
    `;
    return NextResponse.json({ success: true, trades: tradesRes.rows });
  } catch (error: any) {
    console.error("[QUANT LAB GET TRADES] Fetch failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
