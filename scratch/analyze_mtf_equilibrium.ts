import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import * as fs from 'fs';

async function analyzeMultiTimeframeEquilibrium() {
  console.log(`\n===============================================================`);
  console.log(` 📊 MULTI-TIMEFRAME DEALING RANGE & EQUILIBRIUM INVESTIGATION`);
  console.log(`===============================================================\n`);

  const symbol = 'ETHUSDC';
  const all5m = await fetchHistoricalKlines(symbol, '5m', 1000);
  const all15m = await fetchHistoricalKlines(symbol, '15m', 500);
  const all1h = await fetchHistoricalKlines(symbol, '1h', 500);
  const all1d = await fetchHistoricalKlines(symbol, '1d', 30);

  console.log(`Fetched 5m: ${all5m.length}, 15m: ${all15m.length}, 1h: ${all1h.length}, 1d: ${all1d.length}`);

  // Helper to find candle index at a given timestamp
  function getCandleIndex(candles: any[], timestamp: number) {
    return candles.findIndex((c) => c.t >= timestamp);
  }

  // Trade 1: 2026-08-30 11:50 UTC (timestamp: 1788090600000 approx)
  const t1Time = new Date('2026-08-30T11:50:00.000Z').getTime();
  // Trade 2: 2026-08-31 09:00 UTC (timestamp: 1788166800000 approx)
  const t2Time = new Date('2026-08-31T09:00:00.000Z').getTime();

  for (const [tradeName, tradeTime, entryPrice, anchorLevel] of [
    ['Trade 1 (2026-08-30 11:57 UTC)', t1Time, 2457.80, 2457.80],
    ['Trade 2 (2026-08-31 09:00 UTC)', t2Time, 2445.51, 2445.51]
  ] as const) {
    console.log(`\n===============================================================`);
    console.log(` 🔍 ${tradeName}`);
    console.log(` Entry Price: $${entryPrice} | Anchor: $${anchorLevel}`);
    console.log(`===============================================================`);

    // 1. Daily Range (Previous Day High/Low & Current Day Range)
    const dIdx = all1d.findIndex(c => c.t <= tradeTime && c.t + 86400000 > tradeTime);
    if (dIdx >= 1) {
      const pd = all1d[dIdx - 1];
      const cd = all1d[dIdx];
      const pdh = pd.h;
      const pdl = pd.l;
      const pdEq = (pdh + pdl) / 2;
      console.log(`\n[DAILY CONTEXT]`);
      console.log(`  Previous Day (${new Date(pd.t).toISOString().slice(0, 10)}): High = $${pdh.toFixed(2)}, Low = $${pdl.toFixed(2)}, Midpoint (PDH/PDL Eq) = $${pdEq.toFixed(2)}`);
      console.log(`  Entry ($${entryPrice}) vs PDH/PDL Eq ($${pdEq.toFixed(2)}): ${entryPrice > pdEq ? '🔴 PREMIUM (> Eq)' : '🟢 DISCOUNT (< Eq)'}`);
      console.log(`  Current Day to date: High = $${cd.h.toFixed(2)}, Low = $${cd.l.toFixed(2)}, Midpoint = $${((cd.h + cd.l) / 2).toFixed(2)}`);
    }

    // 2. 1-Hour Context (Lookback 24h / 48h before trade)
    const h1Idx = all1h.findIndex(c => c.t >= tradeTime);
    if (h1Idx >= 24) {
      const h24Candles = all1h.slice(h1Idx - 24, h1Idx);
      const h24High = Math.max(...h24Candles.map(c => c.h));
      const h24Low = Math.min(...h24Candles.map(c => c.l));
      const h24Eq = (h24High + h24Low) / 2;
      console.log(`\n[1-HOUR CONTEXT (24H ROLLING RANGE)]`);
      console.log(`  24H Range: High = $${h24High.toFixed(2)}, Low = $${h24Low.toFixed(2)}, Eq (50%) = $${h24Eq.toFixed(2)}`);
      console.log(`  Entry ($${entryPrice}) vs 24H Eq ($${h24Eq.toFixed(2)}): ${entryPrice > h24Eq ? '🔴 PREMIUM (> Eq)' : '🟢 DISCOUNT (< Eq)'}`);

      const h48Candles = all1h.slice(Math.max(0, h1Idx - 48), h1Idx);
      const h48High = Math.max(...h48Candles.map(c => c.h));
      const h48Low = Math.min(...h48Candles.map(c => c.l));
      const h48Eq = (h48High + h48Low) / 2;
      console.log(`\n[1-HOUR CONTEXT (48H ROLLING RANGE)]`);
      console.log(`  48H Range: High = $${h48High.toFixed(2)}, Low = $${h48Low.toFixed(2)}, Eq (50%) = $${h48Eq.toFixed(2)}`);
      console.log(`  Entry ($${entryPrice}) vs 48H Eq ($${h48Eq.toFixed(2)}): ${entryPrice > h48Eq ? '🔴 PREMIUM (> Eq)' : '🟢 DISCOUNT (< Eq)'}`);
    }

    // 3. 15-Minute Context (Lookback 32 bars = 8h session)
    const m15Idx = all15m.findIndex(c => c.t >= tradeTime);
    if (m15Idx >= 32) {
      const m15Candles = all15m.slice(m15Idx - 32, m15Idx);
      const m15High = Math.max(...m15Candles.map(c => c.h));
      const m15Low = Math.min(...m15Candles.map(c => c.l));
      const m15Eq = (m15High + m15Low) / 2;
      console.log(`\n[15-MINUTE CONTEXT (8H SESSION RANGE)]`);
      console.log(`  8H Range: High = $${m15High.toFixed(2)}, Low = $${m15Low.toFixed(2)}, Eq (50%) = $${m15Eq.toFixed(2)}`);
      console.log(`  Entry ($${entryPrice}) vs 15M Eq ($${m15Eq.toFixed(2)}): ${entryPrice > m15Eq ? '🔴 PREMIUM (> Eq)' : '🟢 DISCOUNT (< Eq)'}`);
    }

    // 4. 5-Minute Local SweepReclaimEngine Calculation
    const m5Idx = all5m.findIndex(c => c.t >= tradeTime);
    console.log(`\n[5-MINUTE LOCAL SWEEPRECLAIM ENGINE CALCULATION]`);
    console.log(`  Candle index at trade: ${m5Idx}`);
  }
}

analyzeMultiTimeframeEquilibrium().catch(console.error);
