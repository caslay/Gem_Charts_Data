import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  listLocalStrategyRuns,
  getLocalStrategyRunById,
  deleteLocalStrategyRun,
} from "@/lib/quantLab/localScanStore";

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

    // 1. Single run detail fetch
    if (id) {
      const run = await getLocalStrategyRunById(id);
      if (!run) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, run });
    }

    // 2. Summary list query
    const { runs, total } = await listLocalStrategyRuns(limit, offset);

    return NextResponse.json({
      success: true,
      runs,
      pagination: { limit, offset, count: runs.length, total },
    });
  } catch (error: any) {
    console.error("[QUANT LAB GET RUNS] Local fetch failed:", error);
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
      return NextResponse.json({ error: "Missing required parameter: 'id' is required to delete." }, { status: 400 });
    }

    const deleted = await deleteLocalStrategyRun(id);
    if (!deleted) {
      return NextResponse.json({ error: "Historical run not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted_id: id });
  } catch (error: any) {
    console.error("[QUANT LAB DELETE RUN] Failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

