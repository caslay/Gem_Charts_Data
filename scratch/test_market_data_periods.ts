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
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) {
        console.warn(`[FETCH] Binance kline fetch warning [${interval}]: ${res.status}`);
        break;
      }
      const raw: unknown[][] = await res.json();
      if (!raw || raw.length === 0) break;

      const parsed = parseBinanceKlines(raw);
      allKlines.push(...parsed);

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
  console.log('Testing Binance API access for ETHUSDC / ETHUSDT...');
  
  // Let's test a 30-day, 90-day, and 180-day window
  const now = Date.now();
  const d30 = now - 30 * 24 * 3600 * 1000;
  const d90 = now - 90 * 24 * 3600 * 1000;
  const d180 = now - 180 * 24 * 3600 * 1000;

  console.log('Fetching sample 5m candles for ETHUSDC (past 30d)...');
  const sampleUSDC = await fetchPagedKlines('ETHUSDC', '5m', d30, now);
  console.log(`ETHUSDC 30d 5m candles fetched: ${sampleUSDC.length}`);
  
  if (sampleUSDC.length > 0) {
    console.log(`First candle: ${new Date(sampleUSDC[0].t).toISOString()}, Price: ${sampleUSDC[0].c}`);
    console.log(`Last candle: ${new Date(sampleUSDC[sampleUSDC.length - 1].t).toISOString()}, Price: ${sampleUSDC[sampleUSDC.length - 1].c}`);
  }
}

main().catch(console.error);
