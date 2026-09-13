import { NextResponse } from 'next/server';
import { fetchAiAnalysisHistory } from '@/lib/aiCascadeEngine';

/**
 * Explicit GET endpoint for AI Analysis History: /api/quant-analyze/history
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 20;
    const page = searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1;
    const symbol = searchParams.get('symbol') || undefined;
    const status = searchParams.get('status') || undefined;

    const data = await fetchAiAnalysisHistory({
      limit,
      page,
      symbol,
      status,
    });

    return NextResponse.json({
      success: true,
      data: data.history,
      pagination: data.pagination,
    });
  } catch (error: unknown) {
    console.error('[QUANT_ANALYZE_HISTORY] GET Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to retrieve AI analysis history.';
    return NextResponse.json(
      { error: message, success: false, data: [] },
      { status: 500 }
    );
  }
}
