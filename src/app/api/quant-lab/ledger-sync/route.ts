import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { auth } from "@/auth";
import { generateSnapshot } from "@/lib/quantEngine/structuralBootstrap";
import { Candle } from "@/lib/fvgEngine";

// Base URL for Binance Futures REST API
const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/klines';
const SERVER_CACHE_DIR = path.join(process.cwd(), '.cache', 'structural_snapshots');

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
    } catch {
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
    const mode = body.mode || 'APPEND';
    const symbol = body.symbol || 'ETHUSDC';
    const timeframe = body.timeframe || '15m';

    if (!fs.existsSync(SERVER_CACHE_DIR)) {
      fs.mkdirSync(SERVER_CACHE_DIR, { recursive: true });
    }

    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);

    if (mode === 'FLUSH_AND_REBUILD') {
      return NextResponse.json({ success: true, message: `Local structural cache ready.` });
    } 
    
    if (mode === 'APPEND') {
      const targetDate = body.date ? new Date(body.date) : now;
      targetDate.setUTCHours(0,0,0,0);
      
      const targetMs = targetDate.getTime();
      const lookbackMajor = 15;
      
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
      const dateKey = targetDate.toISOString().split('T')[0];
      const cacheKey = `${symbol.toUpperCase()}_${timeframe.toLowerCase()}_${dateKey}`;
      const cachePath = path.join(SERVER_CACHE_DIR, `${cacheKey}.json`);
      fs.writeFileSync(cachePath, JSON.stringify(snapshot, null, 2), 'utf8');

      return NextResponse.json({ success: true, snapshot_date: targetDate.toISOString() });
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (err: any) {
    console.error("[LEDGER SYNC LOCAL] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
