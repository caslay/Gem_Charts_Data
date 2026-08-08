import { NextResponse } from 'next/server';
import { autoLogSopSetup, SopReportData } from '@/lib/sopTrackerLogger';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sopReport: SopReportData = body.sop_report || body;
    const entry = autoLogSopSetup(sopReport);

    if (!entry) {
      return NextResponse.json({ error: 'Failed to log setup to tracker.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, entry });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
