import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ success: true, trades: [] });
}

export async function POST() {
  return NextResponse.json({ success: true });
}

export async function PATCH() {
  return NextResponse.json({ success: true });
}

export async function DELETE() {
  return NextResponse.json({ success: true });
}
