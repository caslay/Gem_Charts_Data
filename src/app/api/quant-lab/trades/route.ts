import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLocalStrategyRunById } from "@/lib/quantLab/localScanStore";

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

    if (!runId) {
      return NextResponse.json({ error: "Missing required query parameter: 'run_id'." }, { status: 400 });
    }

    const run = await getLocalStrategyRunById(runId);
    if (!run) {
      return NextResponse.json({ error: "Strategy run not found" }, { status: 404 });
    }

    const allTrades = run.trades || [];
    const paginated = allTrades.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      trades: paginated,
      pagination: { limit, offset, count: paginated.length, total: allTrades.length },
    });
  } catch (error: any) {
    console.error("[QUANT LAB GET TRADES] Local fetch failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

