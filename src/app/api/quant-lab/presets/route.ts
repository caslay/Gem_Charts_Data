import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ScannerPreset } from "@/lib/quantEngine/scannerPresets";
import {
  listLocalPresets,
  saveLocalPreset,
  deleteLocalPreset,
} from "@/lib/quantLab/localScanStore";

// ─── GET: Fetch Saved Presets ───────────────────────────────────────────────
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const strategyType = searchParams.get("strategyType") || undefined;

    const session = await auth();
    const userId = session?.user?.email || "local_user";

    const presets = await listLocalPresets(strategyType, userId);

    return NextResponse.json({ success: true, presets });
  } catch (error: any) {
    console.warn("[PRESETS API] Local GET Error:", error);
    return NextResponse.json({ success: true, presets: [] });
  }
}

// ─── POST: Upsert Custom Preset ─────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.email || "local_user";

    const body = await req.json();
    const preset: ScannerPreset = body.preset;

    if (!preset || !preset.id || !preset.name || !preset.strategyType) {
      return NextResponse.json({ error: "Invalid preset payload" }, { status: 400 });
    }

    const updatedPreset: ScannerPreset = {
      ...preset,
      syncStatus: "synced",
      updatedAt: Date.now(),
      createdAt: preset.createdAt || Date.now(),
    };

    await saveLocalPreset(updatedPreset, userId);

    return NextResponse.json({ success: true, preset: updatedPreset });
  } catch (error: any) {
    console.warn("[PRESETS API] Local POST Error:", error);
    return NextResponse.json({ error: "Failed to persist preset" }, { status: 500 });
  }
}

// ─── DELETE: Delete Custom Preset ───────────────────────────────────────────
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Preset ID is required" }, { status: 400 });
    }

    const session = await auth();
    const userId = session?.user?.email || "local_user";

    await deleteLocalPreset(id, userId);

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error: any) {
    console.warn("[PRESETS API] Local DELETE Error:", error);
    return NextResponse.json({ error: "Failed to delete preset" }, { status: 500 });
  }
}
