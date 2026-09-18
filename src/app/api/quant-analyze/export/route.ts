import { NextResponse } from 'next/server';
import {
  buildTelemetryCorpus,
  serializeTelemetryToCsv,
  serializeTelemetryToJson,
} from '@/lib/quantEngine/telemetryExportService';
import { getCairoDateString } from '@/lib/quantEngine/SetupOutcomeTypes';

export const dynamic = 'force-dynamic';

/**
 * GET /api/quant-analyze/export
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Telemetry & Reconciled Outcome Export Route (V17.96 Parity)
 * ─────────────────────────────────────────────────────────────────────────────
 * Query Parameters:
 *   - startDate: YYYY-MM-DD or ISO string or 'ALL'
 *   - endDate: YYYY-MM-DD or ISO string or 'ALL'
 *   - format: 'csv' | 'json' (default: 'csv')
 *   - filter: 'ALL' | 'WINS' | 'LOSSES' | 'CANCELLED' | 'ACTIVE' | string
 *   - symbol: string (optional)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const format = (searchParams.get('format') || 'csv').toLowerCase();
    const filter = searchParams.get('filter') || 'ALL';
    const symbol = searchParams.get('symbol') || undefined;

    // Build the reconciled historical telemetry corpus
    const corpus = await buildTelemetryCorpus({
      startDate,
      endDate,
      filter,
      symbol,
    });

    // Derive institutional filename: quegar_ai_telemetry_[START_DATE]_[END_DATE].[csv|json]
    let dateSuffix = '';
    const todayStr = getCairoDateString(new Date());

    if (startDate && endDate && startDate !== 'ALL' && endDate !== 'ALL') {
      const cleanStart = startDate.split('T')[0];
      const cleanEnd = endDate.split('T')[0];
      dateSuffix = cleanStart === cleanEnd ? cleanStart : `${cleanStart}_${cleanEnd}`;
    } else if (startDate && startDate !== 'ALL') {
      dateSuffix = startDate.split('T')[0];
    } else if (endDate && endDate !== 'ALL') {
      dateSuffix = endDate.split('T')[0];
    } else if (startDate === 'ALL' || endDate === 'ALL') {
      dateSuffix = `all_history_${todayStr}`;
    } else {
      dateSuffix = todayStr;
    }

    const filename = `quegar_ai_telemetry_${dateSuffix}.${format === 'json' ? 'json' : 'csv'}`;

    if (format === 'json') {
      const jsonContent = serializeTelemetryToJson(corpus);
      return new Response(jsonContent, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Export-Count': String(corpus.length),
        },
      });
    }

    // Default: CSV format
    const csvContent = serializeTelemetryToCsv(corpus);
    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Export-Count': String(corpus.length),
      },
    });
  } catch (error: unknown) {
    console.error('[QUANT_ANALYZE_EXPORT] Failed to generate telemetry export:', error);
    const message = error instanceof Error ? error.message : 'Telemetry export failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  }
}
