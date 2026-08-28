/**
 * restBootstrap.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Cold-start REST Bootstrapper for Flow-State Headless Daemon.
 * Fetches historical multi-timeframe candles (5m, 15m, 1h) from Binance Futures
 * REST API to seed in-memory ring buffers and initialize structural pivots.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from '../../src/lib/fvgEngine';

const BINANCE_FAPI_BASE = 'https://fapi.binance.com/fapi/v1/klines';

export interface BootstrapCandleBuffers {
  '5m': Candle[];
  '15m': Candle[];
  '1h': Candle[];
}

export interface MacroStructuralContext {
  macroDailyBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  dolDirection: 'BULLISH' | 'BEARISH' | 'BALANCED';
  localDealingRange: {
    high: number;
    low: number;
    equilibrium: number;
    current_status: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM';
  } | null;
  pdh: number;
  pdl: number;
  asianSession: { high: number | null; low: number | null };
  londonSession: { high: number | null; low: number | null };
}

/**
 * Parses raw Binance REST kline array into strict Candle interface.
 */
export function parseBinanceRestKlines(raw: unknown[][]): Candle[] {
  if (!Array.isArray(raw)) return [];

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

/**
 * Fetches historical candles for a specific timeframe.
 */
export async function fetchHistoricalKlines(
  symbol: string = 'ETHUSDC',
  interval: '5m' | '15m' | '1h' = '5m',
  limit: number = 500
): Promise<Candle[]> {
  const url = `${BINANCE_FAPI_BASE}?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${interval} klines: HTTP ${res.status} ${res.statusText}`);
  }
  const raw: unknown[][] = await res.json();
  return parseBinanceRestKlines(raw);
}

/**
 * Computes Session Liquidity and Macro Context from 1h and 15m candles.
 */
export function computeMacroContext(
  candles1h: Candle[],
  candles15m: Candle[]
): MacroStructuralContext {
  const latestCandle = candles15m[candles15m.length - 1];
  const lastDateUtc = latestCandle ? new Date(latestCandle.t) : new Date();

  // ── 1. Calculate Previous Day High/Low (PDH/PDL) strictly from UTC 1h candles ──
  const prevDayUtc = new Date(
    Date.UTC(lastDateUtc.getUTCFullYear(), lastDateUtc.getUTCMonth(), lastDateUtc.getUTCDate() - 1)
  );
  const prevYear = prevDayUtc.getUTCFullYear();
  const prevMonth = prevDayUtc.getUTCMonth();
  const prevDate = prevDayUtc.getUTCDate();

  let pdh = 0;
  let pdl = Infinity;

  candles1h.forEach((c) => {
    const dUtc = new Date(c.t);
    if (
      dUtc.getUTCFullYear() === prevYear &&
      dUtc.getUTCMonth() === prevMonth &&
      dUtc.getUTCDate() === prevDate
    ) {
      if (c.h > pdh) pdh = c.h;
      if (c.l < pdl) pdl = c.l;
    }
  });

  if (pdl === Infinity) pdl = 0;

  // ── 2. Session Liquidity (Asian: 00:00–07:00 UTC, London: 07:00–12:00 UTC) ──
  const getSessionRange = (startHour: number, endHour: number) => {
    const sessionCandles = candles15m.filter((c) => {
      const d = new Date(c.t);
      return (
        d.getUTCFullYear() === lastDateUtc.getUTCFullYear() &&
        d.getUTCMonth() === lastDateUtc.getUTCMonth() &&
        d.getUTCDate() === lastDateUtc.getUTCDate() &&
        d.getUTCHours() >= startHour &&
        d.getUTCHours() < endHour
      );
    });

    if (sessionCandles.length === 0) return { high: null, low: null };
    return {
      high: parseFloat(Math.max(...sessionCandles.map((c) => c.h)).toFixed(2)),
      low: parseFloat(Math.min(...sessionCandles.map((c) => c.l)).toFixed(2)),
    };
  };

  const asianSession = getSessionRange(0, 7);
  const londonSession = getSessionRange(7, 12);

  // ── 3. Macro Daily Bias & Dealing Range ──
  const livePrice = latestCandle?.c || 0;
  let currentStatus: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM' = 'EQUILIBRIUM';
  let eq = 0;

  if (pdh > 0 && pdl > 0) {
    eq = parseFloat(((pdh + pdl) / 2).toFixed(2));
    if (livePrice > eq + 0.5) currentStatus = 'PREMIUM';
    else if (livePrice < eq - 0.5) currentStatus = 'DISCOUNT';
  }

  // Macro Bias heuristics based on 1H trend & equilibrium
  let macroDailyBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (candles1h.length >= 20) {
    const sma20 =
      candles1h.slice(-20).reduce((acc, c) => acc + c.c, 0) / 20;
    if (livePrice > sma20 && currentStatus === 'DISCOUNT') {
      macroDailyBias = 'BULLISH';
    } else if (livePrice < sma20 && currentStatus === 'PREMIUM') {
      macroDailyBias = 'BEARISH';
    } else {
      macroDailyBias = livePrice > sma20 ? 'BULLISH' : 'BEARISH';
    }
  }

  const dolDirection = macroDailyBias === 'BULLISH' ? 'BULLISH' : macroDailyBias === 'BEARISH' ? 'BEARISH' : 'BALANCED';

  return {
    macroDailyBias,
    dolDirection,
    localDealingRange:
      pdh > 0 && pdl > 0
        ? {
            high: pdh,
            low: pdl,
            equilibrium: eq,
            current_status: currentStatus,
          }
        : null,
    pdh,
    pdl,
    asianSession,
    londonSession,
  };
}

/**
 * Master Bootstrap Loader: Pulls all 3 timeframes concurrently and prepares macro context.
 */
export async function bootstrapHistoricalBuffers(
  symbol: string = 'ETHUSDC',
  limits: { '5m': number; '15m': number; '1h': number } = { '5m': 500, '15m': 500, '1h': 500 }
): Promise<{
  buffers: BootstrapCandleBuffers;
  macroContext: MacroStructuralContext;
}> {
  console.log(`[REST_BOOTSTRAP] 🚀 Fetching historical candles for ${symbol.toUpperCase()} (5m, 15m, 1h)...`);

  const [candles5m, candles15m, candles1h] = await Promise.all([
    fetchHistoricalKlines(symbol, '5m', limits['5m']),
    fetchHistoricalKlines(symbol, '15m', limits['15m']),
    fetchHistoricalKlines(symbol, '1h', limits['1h']),
  ]);

  console.log(
    `[REST_BOOTSTRAP] ✅ Received: 5m (${candles5m.length} bars), 15m (${candles15m.length} bars), 1h (${candles1h.length} bars).`
  );

  const macroContext = computeMacroContext(candles1h, candles15m);
  console.log(
    `[REST_BOOTSTRAP] 🧭 Macro Context: Bias=${macroContext.macroDailyBias} | PDH=$${macroContext.pdh} | PDL=$${macroContext.pdl} | Asian=[$${macroContext.asianSession.low}-$${macroContext.asianSession.high}]`
  );

  return {
    buffers: {
      '5m': candles5m,
      '15m': candles15m,
      '1h': candles1h,
    },
    macroContext,
  };
}

// ── Self-Test Execution CLI ──
if (process.argv.includes('--test')) {
  (async () => {
    try {
      const res = await bootstrapHistoricalBuffers('ETHUSDC');
      console.log('✅ Bootstrap Verification Successful!');
      process.exit(0);
    } catch (err) {
      console.error('❌ Bootstrap Test Failed:', err);
      process.exit(1);
    }
  })();
}
