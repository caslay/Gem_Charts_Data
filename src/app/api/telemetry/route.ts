import { NextResponse } from "next/server";

/**
 * Public Decoy Telemetry Endpoint — Stealth Edge Layer
 * Returns generic, non-financial developer telemetry response for public pingers.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "healthy",
      service: "telemetry-worker",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      region: "ap-northeast-1",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}
