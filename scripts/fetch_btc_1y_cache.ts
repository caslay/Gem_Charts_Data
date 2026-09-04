/**
 * scripts/fetch_btc_1y_cache.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Downloads 1-Year Historical 5m Klines for BTCUSDT from Binance Futures REST API
 * for Phase 4 Inter-Market SMT Correlation Testing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import { Candle } from '../src/lib/fvgEngine';

const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/klines';

function parseBinanceKlines(raw: unknown[][]): Candle[] {
  return raw.map((c) => {
    const o = parseFloat(c[1] as string);
    const h = parseFloat(c[2] as string);
    const l = parseFloat(c[3] as string);
    const close = parseFloat(c[4] as string);
    const v = parseFloat(c[5] as string) || 0;

    const rawTakerBuy = parseFloat(c[9] as string);
    let taker_buy_vol: number;
    if (Number.isFinite(rawTakerBuy) && !isNaN(rawTakerBuy) && rawTakerBuy > 0) {
      taker_buy_vol = parseFloat(rawTakerBuy.toFixed(4));
    } else {
      const range = Math.max(0.0001, h - l);
      const conviction = Math.min(1.0, Math.max(0.0, (close - l) / range));
      taker_buy_vol = parseFloat((conviction * v).toFixed(4));
    }
    const taker_sell_vol = parseFloat(Math.max(0, v - taker_buy_vol).toFixed(4));

    return {
      t: Number(c[0]),
      o,
      h,
      l,
      c: close,
      v,
      taker_buy_vol,
      taker_sell_vol,
      isClosed: true,
    };
  });
}

async function main() {
  const endMs = Date.parse('2026-09-04T00:00:00.000Z');
  const startMs = Date.parse('2025-09-04T00:00:00.000Z');
  const warmupMs = startMs - 5 * 24 * 60 * 60 * 1000;

  const scratchDir = path.join(process.cwd(), 'scratch');
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  const cachePath = path.join(scratchDir, `cached_BTCUSDT_5m_1y_${warmupMs}_${endMs}.json`);
  if (fs.existsSync(cachePath)) {
    console.log(`✅ BTC 1-year cache already exists at: ${cachePath}`);
    return;
  }

  console.log(`🌐 Fetching BTCUSDT 5m 1-year klines (${new Date(warmupMs).toISOString()} to ${new Date(endMs).toISOString()})...`);
  const allKlines: Candle[] = [];
  let currentStart = warmupMs;
  const limit = 1000;
  let page = 0;

  while (currentStart < endMs) {
    page++;
    const url = `${BINANCE_REST}?symbol=BTCUSDT&interval=5m&startTime=${currentStart}&endTime=${endMs - 1}&limit=${limit}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        console.warn(`[Binance Fetch] HTTP error ${res.status}`);
        break;
      }
      const raw: unknown[][] = await res.json();
      if (!raw || raw.length === 0) break;

      const parsed = parseBinanceKlines(raw);
      allKlines.push(...parsed);

      if (page % 15 === 0 || allKlines.length % 15000 === 0) {
        const currentDate = new Date(parsed[parsed.length - 1].t).toISOString().split('T')[0];
        console.log(`  ⏳ Fetched ${allKlines.length} candles (reached ${currentDate}, page ${page})...`);
      }

      const lastTime = Number(raw[raw.length - 1][0]);
      if (lastTime <= currentStart) break;
      currentStart = lastTime + 1;

      // Rate limit throttle: 60ms between requests
      await new Promise((r) => setTimeout(r, 60));
    } catch (err: any) {
      console.warn(`[Binance Fetch] Error at page ${page}: ${err.message}. Retrying...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`💾 Saving ${allKlines.length} BTC candles to disk cache: ${cachePath}...`);
  fs.writeFileSync(cachePath, JSON.stringify(allKlines));
  console.log(`✅ BTCUSDT dataset cached successfully.`);
}

main().catch(console.error);
