import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';

const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/klines';

function parseBinanceKlines(raw: unknown[][]): Candle[] {
  return raw.map((c) => {
    const o = parseFloat(c[1] as string);
    const h = parseFloat(c[2] as string);
    const l = parseFloat(c[3] as string);
    const close = parseFloat(c[4] as string);
    const v = parseFloat(c[5] as string) || 0;

    let rawTakerBuy = parseFloat(c[9] as string);
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

async function fetchPagedKlines(
  symbol: string,
  interval: string,
  startMs: number,
  endMs: number
): Promise<Candle[]> {
  const allKlines: Candle[] = [];
  let currentStart = startMs;
  const limit = 1000;

  while (currentStart < endMs) {
    const url = `${BINANCE_REST}?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&endTime=${endMs - 1}&limit=${limit}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        console.warn(`[FETCH] Binance kline fetch warning [${interval}]: ${res.status}`);
        break;
      }
      const raw: unknown[][] = await res.json();
      if (!raw || raw.length === 0) break;

      const parsed = parseBinanceKlines(raw);
      allKlines.push(...parsed);

      console.log(`Fetched page up to ${new Date(parsed[parsed.length - 1].t).toISOString().slice(0, 10)}, total candles: ${allKlines.length}`);

      const lastTime = Number(raw[raw.length - 1][0]);
      if (lastTime <= currentStart) break;
      currentStart = lastTime + 1;

      if (raw.length < limit) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (err) {
      console.warn(`[FETCH] Fetch interrupted at ${allKlines.length} candles:`, err);
      break;
    }
  }

  return allKlines;
}

async function main() {
  const symbol = 'ETHUSDC';
  const interval = '5m';
  
  // Previous Year: 2024-08-27 00:00 UTC to 2025-08-27 00:00 UTC (365 Days)
  const startMs = Date.parse('2024-08-27T00:00:00.000Z');
  const endMs = Date.parse('2025-08-27T00:00:00.000Z');

  console.log(`Downloading PREVIOUS YEAR (2024-2025) dataset for ${symbol} ${interval} from ${new Date(startMs).toISOString()} to ${new Date(endMs).toISOString()}...`);
  const candles = await fetchPagedKlines(symbol, interval, startMs, endMs);
  
  console.log(`Total 2024-2025 candles downloaded: ${candles.length}`);
  
  if (candles.length > 0) {
    const cachePath = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_2024_2025.json');
    fs.writeFileSync(cachePath, JSON.stringify(candles));
    console.log(`2024-2025 Dataset cached successfully to ${cachePath} (${(fs.statSync(cachePath).size / 1024 / 1024).toFixed(2)} MB)`);

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let minPriceDate = '';
    let maxPriceDate = '';

    for (const c of candles) {
      if (c.l < minPrice) {
        minPrice = c.l;
        minPriceDate = new Date(c.t).toISOString().slice(0, 10);
      }
      if (c.h > maxPrice) {
        maxPrice = c.h;
        maxPriceDate = new Date(c.t).toISOString().slice(0, 10);
      }
    }

    const startPrice = candles[0].o;
    const endPrice = candles[candles.length - 1].c;
    const totalReturn = ((endPrice - startPrice) / startPrice) * 100;

    console.log('\n--- 2024-2025 Market Characterization ---');
    console.log(`Date Range: ${new Date(candles[0].t).toISOString().slice(0, 10)} to ${new Date(candles[candles.length - 1].t).toISOString().slice(0, 10)} (${((candles[candles.length - 1].t - candles[0].t) / (24 * 3600 * 1000)).toFixed(1)} days)`);
    console.log(`Start Price: $${startPrice.toFixed(2)} | End Price: $${endPrice.toFixed(2)}`);
    console.log(`Lowest:     $${minPrice.toFixed(2)} on ${minPriceDate}`);
    console.log(`Highest:    $${maxPrice.toFixed(2)} on ${maxPriceDate}`);
    console.log(`Net Return: ${totalReturn.toFixed(2)}%`);
    console.log(`Max Price Span: $${(maxPrice - minPrice).toFixed(2)} (${(((maxPrice - minPrice) / minPrice) * 100).toFixed(1)}% amplitude)`);
    console.log('------------------------------------------\n');
  }
}

main().catch(console.error);
