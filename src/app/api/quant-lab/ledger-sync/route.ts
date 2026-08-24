import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { auth } from "@/auth";
import { generateSnapshot } from "@/lib/quantEngine/structuralBootstrap";
import { Candle } from "@/lib/fvgEngine";

// Base URL for Binance Futures REST API
const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/klines';

async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const allKlines: Candle[] = [];
  let currentStart = startMs;
  const limit = 1000;

  while (currentStart < endMs) {
    const url = `${BINANCE_REST}?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&endTime=${endMs - 1}&limit=${limit}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) break;
      const raw: unknown[][] = await res.json();
      if (!raw || raw.length === 0) break;

      const parsed = raw.map((c) => ({
        t: Number(c[0]),
        o: parseFloat(c[1] as string),
        h: parseFloat(c[2] as string),
        l: parseFloat(c[3] as string),
        c: parseFloat(c[4] as string),
        v: parseFloat(c[5] as string) || 0,
        taker_buy_vol: 0,
        taker_sell_vol: 0,
        isClosed: true,
      }));

      allKlines.push(...parsed);
      const lastTime = Number(raw[raw.length - 1][0]);
      if (lastTime <= currentStart) break;
      currentStart = lastTime + 1;
      if (raw.length < limit) break;
      await new Promise(r => setTimeout(r, 40));
    } catch (err) {
      break;
    }
  }
  return allKlines;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const mode = body.mode || 'APPEND'; // APPEND or FLUSH_AND_REBUILD
    const symbol = body.symbol || 'ETHUSDC';
    const timeframe = body.timeframe || '15m';

    // 1. Ensure Table Exists
    await sql`
      CREATE TABLE IF NOT EXISTS quant_lab_daily_structural_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol VARCHAR(50) NOT NULL,
        timeframe VARCHAR(20) NOT NULL,
        snapshot_date TIMESTAMP WITH TIME ZONE NOT NULL,
        state_json JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, timeframe, snapshot_date)
      );
    `;

    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);

    if (mode === 'FLUSH_AND_REBUILD') {
      const { rowCount } = await sql`
        DELETE FROM quant_lab_daily_structural_snapshots 
        WHERE symbol = ${symbol} AND timeframe = ${timeframe};
      `;
      return NextResponse.json({ success: true, message: `Flushed ${rowCount} old snapshots. Background rebuild would be initiated here.` });
    } 
    
    if (mode === 'APPEND') {
      // Append for today (00:00 UTC)
      const targetDate = body.date ? new Date(body.date) : now;
      targetDate.setUTCHours(0,0,0,0);
      
      const targetMs = targetDate.getTime();
      const lookbackMajor = 15;
      
      // We need timeframe in Ms
      let intervalMs = 900000;
      switch (timeframe) {
        case '1m': intervalMs = 60000; break;
        case '5m': intervalMs = 300000; break;
        case '15m': intervalMs = 900000; break;
        case '1h': intervalMs = 3600000; break;
        case '4h': intervalMs = 14400000; break;
        case '1d': intervalMs = 86400000; break;
      }
      
      const fetchStart = targetMs - (lookbackMajor * 3 * intervalMs);
      const warmupCandles = await fetchKlines(symbol, timeframe, fetchStart, targetMs);
      
      if (warmupCandles.length === 0) {
        return NextResponse.json({ error: "Failed to fetch warmup candles" }, { status: 500 });
      }

      const snapshot = generateSnapshot(warmupCandles, { lookbackMajor });
      
      await sql`
        INSERT INTO quant_lab_daily_structural_snapshots (symbol, timeframe, snapshot_date, state_json)
        VALUES (${symbol}, ${timeframe}, ${targetDate.toISOString()}, ${JSON.stringify(snapshot)})
        ON CONFLICT (symbol, timeframe, snapshot_date) DO UPDATE 
        SET state_json = EXCLUDED.state_json, updated_at = CURRENT_TIMESTAMP;
      `;

      return NextResponse.json({ success: true, snapshot_date: targetDate.toISOString() });
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
