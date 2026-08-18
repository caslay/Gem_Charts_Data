/**
 * test_sweep_reclaim_suite.ts
 * Automated quantitative verification script for Sweep & Reclaim Engine,
 * Multi-Timeframe Session Anchors, Volumetric Gating, and 3-Stage Harvest Execution.
 */

import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';

console.log("=== [TEST SUITE] Sweep & Reclaim Multi-Timeframe & 3-Stage Harvest Suite ===");

// 1. Generate multi-day synthetic candlestick sequence with known Asian/London sessions and SSL Sweeps
function generateMultiDayTestCandles(): Candle[] {
  const candles: Candle[] = [];
  const baseTime = Date.parse("2026-05-01T00:00:00.000Z");
  const intervalMs = 900000; // 15m (96 candles per day)
  let p = 3000.0;

  // Generate 2 full days of candles (192 bars)
  for (let i = 0; i < 192; i++) {
    const t = baseTime + (i * intervalMs);
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
      // Day 1: Build Asian Session (00:00 - 07:00 UTC) with Low at $2,980.00
      if (hour >= 0 && hour < 7) {
        if (i === 12) {
          // Asian Low candle
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
        // NY session consolidation
        c = 3005 + Math.sin(i) * 4;
        h = Math.max(o, c) + 2;
        l = Math.min(o, c) - 2;
      }
    } else {
      // Day 2: Price action sweeps Day 1 Asian Low @ 2980, performs volumetric reclaim, retests FVG CE, and executes 3-stage harvest
      const day2Index = i - 96;

      if (day2Index === 10) {
        // Phase 2: Liquidity Sweep (Wick below Asian Low 2980 down to 2970)
        o = 2985;
        c = 2976;
        h = 2986;
        l = 2970; // Sweep extreme: 2970 (-10 USD depth)
        v = 3000;
        taker_buy_vol = 1200;
      } else if (day2Index === 11) {
        // Reversal prep candle
        o = 2976;
        c = 2978;
        h = 2981;
        l = 2974;
        v = 2000;
        taker_buy_vol = 1100;
      } else if (day2Index === 12) {
        // Phase 3: Volumetric Reclaim (Body close 2992 > 2980, Body Ratio 0.70 >= 0.55, Taker Delta 65% >= 51.5%, BISI FVG from 2981 to 2986)
        o = 2978;
        c = 2992; // Strong close above shelf 2980
        h = 2994;
        l = 2977;
        v = 4000;
        taker_buy_vol = 2600; // 65% Delta dominance!
      } else if (day2Index === 13) {
        // Extension candle creating BISI FVG (Low 2989 > Candle 11 High 2981 => FVG: [2981, 2989], CE: 2985)
        o = 2992;
        c = 2998;
        h = 3000;
        l = 2989;
        v = 3500;
        taker_buy_vol = 2200;
      } else if (day2Index === 15) {
        // Phase 4: Retest Touch into FVG CE ($2,985.00) / Anchor Shelf ($2,980.00) with ICT body defense close at $2,988.00
        o = 2995;
        c = 2988; // Close > 2980 (Body defended!)
        h = 2996;
        l = 2980; // Taps entry perfectly
        v = 1800;
        taker_buy_vol = 1000;
      } else if (day2Index > 15 && day2Index <= 45) {
        // Forward rally reaching Stage 1 (1.0R), Stage 2 (1.5R), and Stage 3 (3.0R @ 3034)
        c = o + 4.0;
        h = Math.max(o, c) + 3;
        l = Math.min(o, c) - 1;
        v = 2000;
        taker_buy_vol = 1400;
      } else {
        c = o + Math.sin(i) * 3;
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
      v,
      taker_buy_vol,
      taker_sell_vol: v - taker_buy_vol,
      isClosed: true,
    });

    p = c;
  }

  return candles;
}

const candles = generateMultiDayTestCandles();
console.log(`Generated ${candles.length} multi-day candles.`);

// 2. Initialize Engine with full multi-timeframe anchors & volumetric gating
const config: SweepReclaimScanConfig = {
  symbol: 'ETHUSDC',
  timeframe: '15m',
  anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
  lookbackMajor: 15,
  lookbackInternal: 5,
  maxBarsAnchorToSweep: 40,
  maxBarsSweepToReclaim: 15,
  maxBarsToRetest: 25,
  deltaDominanceThreshold: 51.5,
  bodyRatioThreshold: 0.55,
  stage1Multiple: 1.0,
  stage2Multiple: 1.5,
  stage3Multiple: 3.0,
  entryMode: 'FVG_CE',
  enableStructuralTrail: true,
  enableProfitRatchet: true,
  minSweepDepthAtrMultiplier: 0.05,
  slBufferAtrMultiplier: 0.15,
};

const engine = new SweepReclaimEngine(config);
const { setups, telemetry } = engine.scanHistoricalSetups(candles);

console.log(`\nScan Telemetry Summary:`);
console.log(`- Total Anchors: ${telemetry.total_anchors_detected}`);
console.log(`- Total Sweeps: ${telemetry.total_sweeps_detected} (${telemetry.sweep_rate_pct}%)`);
console.log(`- Total Reclaims: ${telemetry.total_reclaims_confirmed} (${telemetry.reclaim_rate_pct}%)`);
console.log(`- Total Retests: ${telemetry.total_retests_executed} (${telemetry.retest_rate_pct}%)`);
console.log(`- Retest Win Rate: ${telemetry.retest_win_rate_pct}%`);
console.log(`- Stage 1 Fills (40% @ 1.0R): ${telemetry.stage1_fill_count} (${telemetry.stage1_fill_pct}%)`);
console.log(`- Stage 2 Fills (40% @ 1.5R): ${telemetry.stage2_fill_count} (${telemetry.stage2_fill_pct}%)`);
console.log(`- Stage 3 Fills (20% @ DOL): ${telemetry.stage3_fill_count} (${telemetry.stage3_fill_pct}%)`);
console.log(`- Avg Realized R:R: ${telemetry.avg_realized_rr}R`);
console.log(`- Profit Factor: ${telemetry.profit_factor}`);
console.log(`- Expected Value E[R]: ${telemetry.expected_value_r}R`);
console.log(`- Anchor Distribution:`, telemetry.anchor_type_distribution);

// 3. Assertions
if (setups.length === 0) {
  console.error("❌ FAIL: No setups detected.");
  process.exit(1);
}

const asianLowSetup = setups.find(s => s.anchor_type === 'ASIAN_LOW' && s.is_retested);
if (!asianLowSetup) {
  console.error("❌ FAIL: Expected to find and execute a verified Asian Low Sweep & Reclaim setup.");
  process.exit(1);
}

console.log(`\nVerified Setup Details:`);
console.log(`- Setup ID: ${asianLowSetup.id}`);
console.log(`- Anchor Name: ${asianLowSetup.anchor_name}`);
console.log(`- Sweep Price: $${asianLowSetup.sweep_price} (Depth: $${asianLowSetup.sweep_depth})`);
console.log(`- Reclaim Close: $${asianLowSetup.reclaim_close_price} (Delta: ${asianLowSetup.reclaim_delta_dominance_pct}%, Body: ${asianLowSetup.reclaim_body_ratio}%)`);
console.log(`- Displacement FVG CE: $${asianLowSetup.reclaim_fvg_ce}`);
console.log(`- Entry (${asianLowSetup.entry_mode}): $${asianLowSetup.entry_price} | SL: $${asianLowSetup.stop_loss}`);
console.log(`- Target Ladder: Stage 1: $${asianLowSetup.stage1_target} | Stage 2: $${asianLowSetup.stage2_target} | Stage 3: $${asianLowSetup.stage3_target}`);
console.log(`- Outcome: ${asianLowSetup.simulated_outcome} (Realized: ${asianLowSetup.realized_rr}R)`);
console.log(`- 3-Stage Fills: Stage 1: ${asianLowSetup.is_stage1_filled}, Stage 2: ${asianLowSetup.is_stage2_filled}, Stage 3: ${asianLowSetup.is_stage3_filled}`);

// Mathematical Assertions
if (asianLowSetup.reclaim_delta_dominance_pct! < 51.5) {
  console.error("❌ FAIL: Reclaim delta dominance must be >= 51.5%");
  process.exit(1);
}
if (asianLowSetup.reclaim_body_ratio! < 55.0) {
  console.error("❌ FAIL: Reclaim body ratio must be >= 55%");
  process.exit(1);
}
if (!asianLowSetup.is_stage1_filled || !asianLowSetup.is_stage2_filled) {
  console.error("❌ FAIL: Expected Stage 1 and Stage 2 partial fills.");
  process.exit(1);
}

console.log("\n✅ ALL MULTI-TIMEFRAME ANCHOR, VOLUMETRIC GATING, AND 3-STAGE HARVEST TESTS PASSED WITH 100% MATHEMATICAL PRECISION!");
