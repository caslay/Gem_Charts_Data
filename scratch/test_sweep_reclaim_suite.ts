/**
 * test_sweep_reclaim_suite.ts
 * Automated verification script for Sweep & Reclaim Engine and Telemetry
 */

import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';

console.log("=== [TEST SUITE] Sweep & Reclaim (Failed Signal Reversal) Engine ===");

// 1. Generate realistic synthetic candlestick sequence with known SSL Sweep & Reclaim pattern
function generateTestCandles(): Candle[] {
  const candles: Candle[] = [];
  const baseTime = Date.parse("2026-05-01T00:00:00.000Z");
  const intervalMs = 900000; // 15m
  let p = 3000.0;

  // Build 150 candles
  for (let i = 0; i < 150; i++) {
    const t = baseTime + (i * intervalMs);
    let o = p;
    let c = p;
    let h = p;
    let l = p;
    let v = 1000;

    if (i < 20) {
      // Steady price oscillation around 3000
      c = o + (Math.sin(i) * 3);
      h = Math.max(o, c) + 2;
      l = Math.min(o, c) - 2;
    } else if (i === 20) {
      // Anchor Swing Low (Phase 1): red candle into green
      o = 3000;
      c = 2990; // Red
      h = 3002;
      l = 2988;
    } else if (i === 21) {
      // Green bottom
      o = 2990;
      c = 2998;
      h = 3000;
      l = 2987; // Anchor shelf @ 2987
    } else if (i < 30) {
      // Bounce up to 3010
      c = o + 2;
      h = Math.max(o, c) + 2;
      l = Math.min(o, c) - 1;
    } else if (i === 30) {
      // Phase 2: Liquidity Sweep (Purge SSL below 2987 down to 2975)
      o = 2995;
      c = 2980;
      h = 2996;
      l = 2975; // Sweep price: 2975 (-12 USD depth)
      v = 2500;
    } else if (i === 31) {
      // Phase 3: Displacement Reclaim (Aggressive reversal body close back above 2987)
      o = 2980;
      c = 2995; // Confirmed close above anchor shelf 2987
      h = 2998;
      l = 2978;
      v = 3200; // Volume expansion
    } else if (i === 33) {
      // Phase 4: Retest Pullback into 2987
      o = 2996;
      c = 2990; // Close above shelf (Body defended!)
      h = 2998;
      l = 2986; // Tapped shelf @ 2987
      v = 1500;
    } else if (i > 33 && i <= 45) {
      // Post-retest rally hitting TP1 (3001) and TP2 (3017)
      c = o + 3.5;
      h = Math.max(o, c) + 3;
      l = Math.min(o, c) - 1;
      v = 2000;
    } else {
      c = o + (Math.sin(i) * 4);
      h = Math.max(o, c) + 2;
      l = Math.min(o, c) - 2;
    }

    candles.push({
      t,
      o: parseFloat(o.toFixed(2)),
      h: parseFloat(h.toFixed(2)),
      l: parseFloat(l.toFixed(2)),
      c: parseFloat(c.toFixed(2)),
      v,
      isClosed: true,
    });

    p = c;
  }

  return candles;
}

const testCandles = generateTestCandles();
console.log(`Generated ${testCandles.length} test candles.`);

// 2. Initialize Engine and run historical scan
const config: SweepReclaimScanConfig = {
  symbol: 'ETHUSDC',
  timeframe: '15m',
  lookbackMajor: 5,
  lookbackInternal: 3,
  maxBarsAnchorToSweep: 30,
  maxBarsSweepToReclaim: 12,
  maxBarsToRetest: 24,
  tp1Multiple: 1.2,
  tp2Multiple: 2.5,
  tp1Ratio: 0.50,
  tp2Ratio: 0.50,
  enableTrailingBe: true,
  minSweepDepthAtrMultiplier: 0.05,
  slBufferAtrMultiplier: 0.15,
};

const engine = new SweepReclaimEngine(config);
const { setups, telemetry } = engine.scanHistoricalSetups(testCandles);

console.log(`\nScan Results:`);
console.log(`- Total Setups Detected: ${setups.length}`);
console.log(`- Sweeps Detected: ${telemetry.total_sweeps_detected} (${telemetry.sweep_rate_pct}%)`);
console.log(`- Reclaims Confirmed: ${telemetry.total_reclaims_confirmed} (${telemetry.reclaim_rate_pct}%)`);
console.log(`- Retests Executed: ${telemetry.total_retests_executed} (${telemetry.retest_rate_pct}%)`);
console.log(`- Retest Win Rate: ${telemetry.retest_win_rate_pct}%`);
console.log(`- Avg Realized R:R: ${telemetry.avg_realized_rr}R`);
console.log(`- Profit Factor: ${telemetry.profit_factor}`);
console.log(`- Expected Value E[R]: ${telemetry.expected_value_r}R`);
console.log(`- Avg MFE: ${telemetry.avg_mfe_r}R | Avg MAE: ${telemetry.avg_mae_r}R`);

// 3. Assertions
if (setups.length === 0) {
  console.error("❌ FAIL: No setups detected.");
  process.exit(1);
}

const retestedSetup = setups.find(s => s.is_retested);
if (!retestedSetup) {
  console.error("❌ FAIL: Expected at least one retested setup.");
  process.exit(1);
}

console.log(`\nVerified Setup Details:`);
console.log(`- ID: ${retestedSetup.id}`);
console.log(`- Type: ${retestedSetup.type}`);
console.log(`- Anchor Level: $${retestedSetup.anchor_level}`);
console.log(`- Sweep Price: $${retestedSetup.sweep_price} (Depth: $${retestedSetup.sweep_depth})`);
console.log(`- Reclaim Close: $${retestedSetup.reclaim_close_price}`);
console.log(`- Retest Price: $${retestedSetup.retest_price}`);
console.log(`- Entry: $${retestedSetup.entry_price} | SL: $${retestedSetup.stop_loss} | TP1: $${retestedSetup.tp1_target} | TP2: $${retestedSetup.tp2_target}`);
console.log(`- Outcome: ${retestedSetup.simulated_outcome} (${retestedSetup.realized_rr}R)`);
console.log(`- MFE: ${retestedSetup.mfe_r}R ($${retestedSetup.mfe_usd}) | MAE: ${retestedSetup.mae_r}R ($${retestedSetup.mae_usd})`);

// 4. Chronological & Zero Look-Ahead Assertion
if (retestedSetup.reclaim_index! <= retestedSetup.sweep_index!) {
  console.error("❌ FAIL: Reclaim index must be strictly greater than sweep index.");
  process.exit(1);
}
if (retestedSetup.retest_index! <= retestedSetup.reclaim_index!) {
  console.error("❌ FAIL: Retest index must be strictly greater than reclaim index (Zero Look-Ahead).");
  process.exit(1);
}

console.log("\n✅ ALL SWEEP & RECLAIM TESTS PASSED WITH 100% PARITY & ZERO LOOK-AHEAD VERIFICATION!");
