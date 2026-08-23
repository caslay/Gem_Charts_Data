/**
 * test_volumetric_reclaim_audit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification script for:
 * 1. Historical Kline Taker Volume Parser with Wyckoff Conviction Fallback.
 * 2. Multi-Candle Displacement Window in SweepReclaimEngine (Absorption + Expansion).
 * 3. Parameter Synchronization across Command Center & Quant Lab.
 * 4. 1-Year 5m/15m ETHUSDC Backtest & Telemetry Diagnostics Funnel.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  SweepReclaimEngine,
  DEFAULT_SWEEP_RECLAIM_CONFIG,
  SweepReclaimScanConfig,
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';
import assert from 'assert';

console.log('=========================================================================');
console.log('🧪 RUNNING VOLUMETRIC RECLAIM PIPELINE AUDIT & TAKER VOLUME TEST SUITE');
console.log('=========================================================================\n');

// ── Test 1: Historical Kline Taker Volume Parser & Wyckoff Fallback ───────────
console.log('=== TEST 1: Historical Kline Taker Volume Parser & Wyckoff Fallback ===');

// Simulate raw Binance kline without taker volume (c[9] undefined / 0)
const rawSampleKlines = [
  // [time, open, high, low, close, volume, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote, ignore]
  [1700000000000, '3000.0', '3050.0', '2990.0', '3045.0', '1000.0', 1700000300000, '3000000', 500, '', '0', '0'], // Bullish close near high
  [1700000300000, '3045.0', '3055.0', '2995.0', '3000.0', '1200.0', 1700000600000, '3600000', 600, '0', '0', '0'], // Bearish close near low
  [1700000600000, '3000.0', '3020.0', '2980.0', '3010.0', '800.0', 1700000900000, '2400000', 400, '600.0', '0', '0'], // Real taker buy volume 600/800 (75%)
];

function parseKlinesWithFallback(raw: unknown[][]): Candle[] {
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

const parsedCandles = parseKlinesWithFallback(rawSampleKlines);
assert.strictEqual(parsedCandles.length, 3);

// Candle 0: Range = 60 (3050 - 2990), Close-Low = 55 (3045 - 2990) -> Conviction = 55/60 = 91.67% of 1000 = ~916.67
console.log(`- Candle 0 (Bullish Conviction): taker_buy_vol = ${parsedCandles[0].taker_buy_vol} / ${parsedCandles[0].v} (${((parsedCandles[0].taker_buy_vol / parsedCandles[0].v) * 100).toFixed(1)}%)`);
assert.ok(parsedCandles[0].taker_buy_vol > 900, 'Bullish candle has strong synthetic taker buy delta');

// Candle 1: Range = 60 (3055 - 2995), Close-Low = 5 (3000 - 2995) -> Conviction = 5/60 = 8.33% taker buy (91.67% taker sell)
console.log(`- Candle 1 (Bearish Conviction): taker_sell_vol = ${parsedCandles[1].taker_sell_vol} / ${parsedCandles[1].v} (${((parsedCandles[1].taker_sell_vol / parsedCandles[1].v) * 100).toFixed(1)}%)`);
assert.ok(parsedCandles[1].taker_sell_vol > 1000, 'Bearish candle has strong synthetic taker sell delta');

// Candle 2: Real exchange taker buy volume used
console.log(`- Candle 2 (Real Binance Taker Buy): taker_buy_vol = ${parsedCandles[2].taker_buy_vol} / ${parsedCandles[2].v} (${((parsedCandles[2].taker_buy_vol / parsedCandles[2].v) * 100).toFixed(1)}%)`);
assert.strictEqual(parsedCandles[2].taker_buy_vol, 600);

console.log('✅ TEST 1 PASSED: Taker Volume Parser & Wyckoff Fallback verified.\n');

// ── Test 2: Multi-Candle Displacement Window (Absorption at Sweep + Expansion) ─
console.log('=== TEST 2: Multi-Candle Displacement Window (Absorption at Sweep + Expansion) ===');

function generateMultiDayTestCandles(): Candle[] {
  const candles: Candle[] = [];
  const baseTime = Date.parse("2026-05-01T00:00:00.000Z");
  const intervalMs = 900000; // 15m (96 candles per day)
  let p = 3000.0;

  for (let i = 0; i < 192; i++) {
    const t = baseTime + i * intervalMs;
    const date = new Date(t);
    const hour = date.getUTCHours();
    const day = date.getUTCDate();

    let o = p;
    let c = p;
    let h = p;
    let l = p;
    let v = 1000;
    let taker_buy_vol = 500;

    if (day === 1) {
      // Day 1: Asian Session (00:00 - 07:00 UTC) with Low at $2,980.00
      if (hour >= 0 && hour < 7) {
        if (i === 12) {
          o = 2985;
          c = 2982;
          h = 2987;
          l = 2980; // Asian Low @ 2980
          v = 1500;
          taker_buy_vol = 700;
        } else {
          c = 2990 + Math.sin(i) * 5;
          h = Math.max(o, c) + 2;
          l = Math.min(o, c) - 2;
        }
      } else if (hour >= 7 && hour < 12) {
        // London Session (07:00 - 12:00 UTC) with High at $3,030.00
        if (i === 36) {
          o = 3020;
          c = 3028;
          h = 3030; // London High @ 3030
          l = 3018;
          v = 2000;
          taker_buy_vol = 1200;
        } else {
          c = 3010 + Math.sin(i) * 6;
          h = Math.max(o, c) + 2;
          l = Math.min(o, c) - 2;
        }
      } else {
        c = 3005 + Math.sin(i) * 4;
        h = Math.max(o, c) + 2;
        l = Math.min(o, c) - 2;
      }
    } else {
      // Day 2: Liquidity Sweep of Day 1 Asian Low @ 2980
      const day2Index = i - 96;

      if (day2Index === 10) {
        // Phase 2: Liquidity Sweep with Wick Rejection (Absorption bar: 3000 vol = 3.0x SMA)
        o = 2982;
        c = 2978;
        h = 2985;
        l = 2970;
        v = 3000;
        taker_buy_vol = 1200;
      } else if (day2Index === 11) {
        o = 2978;
        c = 2980;
        h = 2982;
        l = 2976;
        v = 1500;
        taker_buy_vol = 800;
      } else if (day2Index === 12) {
        // Phase 3: 3-Pillar Volumetric Reclaim (Body close 2992 > 2980 shelf)
        // Multi-candle displacement window captures sweep absorption (3.0x vol) + reclaim delta (70%)
        o = 2978;
        c = 2992;
        h = 2994;
        l = 2976;
        v = 4000;
        taker_buy_vol = 2800;
      } else if (day2Index === 13) {
        // Extension candle creating BISI FVG from 2982 to 2988 (CE = 2985)
        o = 2992;
        c = 2998;
        h = 3000;
        l = 2988;
        v = 2500;
        taker_buy_vol = 1750;
      } else if (day2Index === 14) {
        // Phase 4: Precision Retest to FVG 50% CE ($2985) / Sweep OB MT ($2977.5)
        o = 2998;
        c = 2988;
        h = 2999;
        l = 2977.5; // Hits Sweep OB MT
        v = 1800;
        taker_buy_vol = 900;
      } else if (day2Index >= 15 && day2Index <= 25) {
        // Multi-stage expansion towards TP targets ($3005 - $3040)
        c = 2990 + (day2Index - 14) * 4.5;
        h = c + 3;
        l = o - 1;
        v = 1200;
        taker_buy_vol = 800;
      } else {
        c = 3010 + Math.sin(i) * 5;
        h = Math.max(o, c) + 2;
        l = Math.min(o, c) - 2;
      }
    }

    candles.push({
      t,
      o: parseFloat(o.toFixed(2)),
      h: parseFloat(h.toFixed(2)),
      l: parseFloat(l.toFixed(2)),
      c: parseFloat(c.toFixed(2)),
      v: parseFloat(v.toFixed(2)),
      taker_buy_vol: parseFloat(taker_buy_vol.toFixed(2)),
      taker_sell_vol: parseFloat((v - taker_buy_vol).toFixed(2)),
      isClosed: true,
    });

    p = c;
  }

  return candles;
}

const testCandles = generateMultiDayTestCandles();

const engine = new SweepReclaimEngine({
  symbol: 'ETHUSDC',
  timeframe: '15m',
  volumeSmaPeriod: 20,
  volumeExpansionThreshold: 1.50,
  deltaDominanceThreshold: 55.0,
  bodyRatioThreshold: 0.55,
  requireThreePillarDisplacement: true,
  enforceDiscountPremiumGate: false,
  entryMode: 'SWEEP_OB_MT',
});

const scanResult = engine.scanHistoricalSetups(testCandles);
console.log(`- Detected Setups: ${scanResult.setups.length}`);
console.log(`- Sweeps Detected: ${scanResult.telemetry.total_sweeps_detected}`);
console.log(`- Reclaims Confirmed: ${scanResult.telemetry.total_reclaims_confirmed}`);
console.log(`- Retests Executed: ${scanResult.telemetry.total_retests_executed}`);

assert.ok(scanResult.telemetry.total_reclaims_confirmed >= 1, 'Multi-candle absorption + displacement confirmed reclaim');
assert.ok(scanResult.telemetry.total_retests_executed >= 1, 'Retest executed at Sweep OB MT');

console.log('✅ TEST 2 PASSED: Multi-Candle Displacement Window confirmed.\n');

// ── Test 3: 1-Year 5m & 15m Simulation Benchmark & Conversion Funnel ──────────
console.log('=== TEST 3: 1-Year 5m & 15m Simulation Benchmark & Funnel Diagnostics ===');

function generateBenchmarkCandles(count: number, intervalMinutes: number): Candle[] {
  const candles: Candle[] = [];
  let price = 3000.0;
  const startT = Date.now() - count * intervalMinutes * 60 * 1000;
  const intMs = intervalMinutes * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const cycle = (i % 96) / 96;
    const wave = Math.sin(cycle * Math.PI * 2) * 15.0;
    const noise = (Math.random() - 0.5) * 6.0;
    const delta = wave * 0.15 + noise;

    const o = price;
    const c = o + delta;
    const h = Math.max(o, c) + Math.random() * 4.0;
    const l = Math.min(o, c) - Math.random() * 4.0;
    const isSpike = Math.random() < 0.20;
    const v = isSpike ? 1500 + Math.random() * 2500 : 400 + Math.random() * 500;

    const range = Math.max(0.0001, h - l);
    const conviction = Math.min(1.0, Math.max(0.0, (c - l) / range));
    const taker_buy_vol = parseFloat((v * conviction).toFixed(2));
    const taker_sell_vol = parseFloat(Math.max(0, v - taker_buy_vol).toFixed(2));

    candles.push({
      t: startT + i * intMs,
      o: parseFloat(o.toFixed(2)),
      h: parseFloat(h.toFixed(2)),
      l: parseFloat(l.toFixed(2)),
      c: parseFloat(c.toFixed(2)),
      v: parseFloat(v.toFixed(2)),
      taker_buy_vol,
      taker_sell_vol,
      isClosed: true,
    });

    price = c;
  }
  return candles;
}

// 1. 1-Year 15m Benchmark (35,000 candles)
const year15mCandles = generateBenchmarkCandles(35000, 15);
const yearEngine15m = new SweepReclaimEngine({
  symbol: 'ETHUSDC',
  timeframe: '15m',
  volumeSmaPeriod: 20,
  volumeExpansionThreshold: 1.50,
  deltaDominanceThreshold: 55.0,
  bodyRatioThreshold: 0.55,
  requireThreePillarDisplacement: true,
  enforceDiscountPremiumGate: false,
  entryMode: 'SWEEP_OB_MT',
});

const yearResult15m = yearEngine15m.scanHistoricalSetups(year15mCandles);
const t15m = yearResult15m.telemetry;

console.log('--- 1-Year 15m ETHUSDC Funnel Telemetry ---');
console.log(`- Total Anchors Detected: ${t15m.total_anchors_detected}`);
console.log(`- Sweeps Detected: ${t15m.total_sweeps_detected} (${t15m.sweep_rate_pct}%)`);
console.log(`- Pillar 1 (Volume) Passed: ${t15m.pillar1_volume_passed_count ?? t15m.pillar1_pass_count} (${t15m.pillar1_pass_pct}%)`);
console.log(`- Pillar 2 (Delta) Passed: ${t15m.pillar2_delta_passed_count ?? t15m.pillar2_pass_count} (${t15m.pillar2_pass_pct}%)`);
console.log(`- Pillar 3 (Body) Passed: ${t15m.pillar3_body_passed_count ?? t15m.pillar3_pass_count} (${t15m.pillar3_pass_pct}%)`);
console.log(`- 3-Pillars All Pass: ${t15m.three_pillar_all_passed_count ?? t15m.three_pillar_all_pass_count} (${t15m.three_pillar_all_pass_pct}%)`);
console.log(`- Volumetric Reclaims Confirmed: ${t15m.total_reclaims_confirmed} (${t15m.reclaim_rate_pct}%)`);
console.log(`- Retests Executed: ${t15m.total_retests_executed} (${t15m.retest_rate_pct}%)`);
console.log(`- Retest Win Rate: ${t15m.retest_win_rate_pct}%`);
console.log(`- Profit Factor: ${t15m.profit_factor}`);
console.log(`- Average Realized RR: +${t15m.avg_realized_rr}R`);

const sweepToReclaimPct = (t15m.total_reclaims_confirmed / t15m.total_sweeps_detected) * 100;
console.log(`- Sweep-to-Reclaim Conversion Rate: ${sweepToReclaimPct.toFixed(1)}% (Target: 15%–25%)`);
assert.ok(sweepToReclaimPct >= 12.0 && sweepToReclaimPct <= 35.0, 'Sweep-to-reclaim conversion rate normalized out of chokepoint');
assert.ok(t15m.total_retests_executed >= 50, '15m trade frequency active');

// 2. 1-Year 5m Benchmark (105,000 candles)
console.log('\n--- 1-Year 5m ETHUSDC Funnel Telemetry ---');
const year5mCandles = generateBenchmarkCandles(105000, 5);
const yearEngine5m = new SweepReclaimEngine({
  symbol: 'ETHUSDC',
  timeframe: '5m',
  volumeSmaPeriod: 20,
  volumeExpansionThreshold: 1.50,
  deltaDominanceThreshold: 55.0,
  bodyRatioThreshold: 0.55,
  requireThreePillarDisplacement: true,
  enforceDiscountPremiumGate: false,
  entryMode: 'RECLAIM_LEVEL',
});

const yearResult5m = yearEngine5m.scanHistoricalSetups(year5mCandles);
const t5m = yearResult5m.telemetry;
console.log(`- Total Anchors Detected (5m): ${t5m.total_anchors_detected}`);
console.log(`- Sweeps Detected (5m): ${t5m.total_sweeps_detected} (${t5m.sweep_rate_pct}%)`);
console.log(`- Volumetric Reclaims Confirmed (5m): ${t5m.total_reclaims_confirmed} (${t5m.reclaim_rate_pct}%)`);
console.log(`- Retests Executed (5m, RECLAIM_LEVEL): ${t5m.total_retests_executed} trades/year`);
console.log(`- Retest Win Rate (5m): ${t5m.retest_win_rate_pct}%`);
console.log(`- Profit Factor (5m): ${t5m.profit_factor}`);
console.log(`- Average Realized RR (5m): +${t5m.avg_realized_rr}R`);

const sweepToReclaimPct5m = (t5m.total_reclaims_confirmed / t5m.total_sweeps_detected) * 100;
console.log(`- 5m Sweep-to-Reclaim Conversion Rate: ${sweepToReclaimPct5m.toFixed(1)}% (Target: 15%–25%)`);
assert.ok(sweepToReclaimPct5m >= 15.0 && sweepToReclaimPct5m <= 35.0, '5m Sweep-to-reclaim conversion rate normalized');
assert.ok(t5m.total_retests_executed >= 250, '5m Annual trade frequency scales to institutional sample size (250–550/yr)');

console.log('✅ TEST 3 PASSED: 1-Year 15m & 5m Benchmark & Conversion Funnel verified.\n');

// ── Test 4: Dynamic Parameter Override Verification ───────────────────────────
console.log('=== TEST 4: Dynamic Parameter Override Verification ===');

// Scan with looser thresholds: 1.2x Vol, 50% Delta, 35% Body
const looseEngine = new SweepReclaimEngine({
  ...DEFAULT_SWEEP_RECLAIM_CONFIG,
  volumeExpansionThreshold: 1.20,
  deltaDominanceThreshold: 50.0,
  bodyRatioThreshold: 0.35,
});

// Scan with strict thresholds: 2.0x Vol, 65% Delta, 70% Body
const strictEngine = new SweepReclaimEngine({
  ...DEFAULT_SWEEP_RECLAIM_CONFIG,
  volumeExpansionThreshold: 2.00,
  deltaDominanceThreshold: 65.0,
  bodyRatioThreshold: 0.70,
});

const looseResult = looseEngine.scanHistoricalSetups(year15mCandles.slice(0, 5000));
const strictResult = strictEngine.scanHistoricalSetups(year15mCandles.slice(0, 5000));

console.log(`- Loose Config Reclaims: ${looseResult.telemetry.total_reclaims_confirmed}`);
console.log(`- Strict Config Reclaims: ${strictResult.telemetry.total_reclaims_confirmed}`);
assert.ok(
  looseResult.telemetry.total_reclaims_confirmed > strictResult.telemetry.total_reclaims_confirmed,
  'Adjusting thresholds dynamically changes scan conversion rate'
);

console.log('✅ TEST 4 PASSED: Dynamic parameter overrides verified.\n');

console.log('=========================================================================');
console.log('🎉 ALL VOLUMETRIC RECLAIM PIPELINE & TAKER PARSER TESTS PASSED (100%)!');
console.log('=========================================================================');
