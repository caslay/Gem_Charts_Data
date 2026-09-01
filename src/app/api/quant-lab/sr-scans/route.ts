import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  listLocalSrScans,
  getLocalSrScanById,
  deleteLocalSrScan,
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

    // 1. Single scan detail fetch
    if (id) {
      const scan = await getLocalSrScanById(id);
      if (!scan) {
        return NextResponse.json({ error: "Sweep & Reclaim scan run not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, scan });
    }

    // 2. Summary list query
    const { scans, total } = await listLocalSrScans(limit, offset);

    return NextResponse.json({
      success: true,
      scans,
      pagination: { limit, offset, count: scans.length, total },
    });
  } catch (error: any) {
    console.error("[SR SCANS GET] Local fetch failed:", error);
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

    const deleted = await deleteLocalSrScan(id);
    if (!deleted) {
      return NextResponse.json({ error: "Sweep & Reclaim scan run not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted_id: id });
  } catch (error: any) {
    console.error("[SR SCANS DELETE] Failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

