/**
 * test_sweep_reclaim_suite.ts
 * Automated quantitative verification suite for:
 *  - Liquidity Sweep Detection with Wick Rejection Signature
 *  - 3-Pillar Volumetric Displacement Gatekeeper (Volume >= 1.5x, Delta >= 60%, Body Ratio >= 60%)
 *  - Precision Mitigation & Order Routing (FVG 50% CE vs Sweep OB 50% MT)
 *  - Discount/Premium Valuation Gating
 *  - Hard Stop Loss 1 tick beyond sweep extreme
 *  - 3-Stage Harvest Execution State Machine & Ratchet Ratchet Floors
 *  - Comprehensive Telemetry Summary Reporting
 */

import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';

console.log("=== [TEST SUITE] Quantitative Sweep & Reclaim 3-Pillar & Harvest Engine ===");

// Generate synthetic multi-day candlestick dataset
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
        // Phase 2: Liquidity Sweep with Wick Rejection
        // Low: 2970 (-10 USD depth), Open: 2982, Close: 2978, High: 2985
        // Lower wick = min(2982, 2978) - 2970 = 8 USD out of 15 USD range = 53.3% wick ratio (Wick Rejection!)
        o = 2982;
        c = 2978;
        h = 2985;
        l = 2970;
        v = 3000; // 3.0x volume expansion
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
        // Pillar 1: Vol 4000 / SMA 1000 = 4.0x >= 1.5x (PASS)
        // Pillar 2: Taker delta 2800 / 4000 = 70.0% >= 60.0% (PASS)
        // Pillar 3: Body |2992 - 2978| / |2994 - 2976| = 14 / 18 = 77.8% >= 60.0% (PASS)
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
        taker_buy_vol = 1600;
      } else if (day2Index === 14) {
        // Phase 4: Pullback Retest into FVG 50% CE ($2985.00)
        // Candle dips to 2984 <= 2985, body closes at 2988 > 2980 (Body defense valid)
        o = 2996;
        c = 2988;
        h = 2997;
        l = 2984;
        v = 1200;
        taker_buy_vol = 650;
      } else if (day2Index === 15) {
        // Stage 1 Harvest (+1.0R = 2985 + 17.5 = 3002.5) -> High reaches 3005
        o = 2988;
        c = 3003;
        h = 3005;
        l = 2987;
        v = 2000;
        taker_buy_vol = 1400;
      } else if (day2Index === 16) {
        // Stage 2 Harvest (+1.5R = 2985 + 24.93 = 3009.93) -> High reaches 3015 (+1.0R floor ratcheted to 3001.62)
        o = 3003;
        c = 3012;
        h = 3015;
        l = 3004; // low above ratchet floor 3001.62 so position stays open for Stage 3 DOL
        v = 2200;
        taker_buy_vol = 1500;
      } else if (day2Index === 17) {
        // Stage 3 Harvest (DOL Runner @ 3.0R = 2985 + 49.86 = 3034.86) -> High reaches 3040
        o = 3012;
        c = 3038;
        h = 3040;
        l = 3010;
        v = 3500;
        taker_buy_vol = 2400;
      } else {
        c = 3020 + Math.sin(i) * 5;
        h = Math.max(o, c) + 2;
        l = Math.min(o, c) - 2;
      }
    }

    p = c;
    candles.push({
      t,
      o: parseFloat(o.toFixed(2)),
      h: parseFloat(h.toFixed(2)),
      l: parseFloat(l.toFixed(2)),
      c: parseFloat(c.toFixed(2)),
      v,
      taker_buy_vol,
      taker_sell_vol: parseFloat((v - taker_buy_vol).toFixed(2)),
      isClosed: true,
    });
  }

  return candles;
}

const candles = generateMultiDayTestCandles();
console.log(`Generated ${candles.length} multi-day historical candles.`);

// ── TEST 1: 3-Pillar Displacement Gatekeeper & Wick Rejection ────────────────
console.log("\n[TEST 1] Testing 3-Pillar Displacement Gatekeeper & Wick Rejection...");

const engine = new SweepReclaimEngine({
  volumeExpansionThreshold: 1.50, // Pillar 1 >= 1.5x
  deltaDominanceThreshold: 60.0,   // Pillar 2 >= 60.0%
  bodyRatioThreshold: 0.60,        // Pillar 3 >= 60.0%
  requireThreePillarDisplacement: true,
  stage1Multiple: 1.0,
  stage2Multiple: 1.5,
  stage3Multiple: 3.0,
  entryMode: 'FVG_CE',
});

const { setups, telemetry } = engine.scanHistoricalSetups(candles);
console.log(`- Total Setups: ${setups.length}`);
console.log(`- Sweeps: ${telemetry.total_sweeps_detected} (${telemetry.sweep_rate_pct}%)`);
console.log(`- Reclaims: ${telemetry.total_reclaims_confirmed} (${telemetry.reclaim_rate_pct}%)`);
console.log(`- Retests Executed: ${telemetry.total_retests_executed} (${telemetry.retest_rate_pct}%)`);

// Find the Day 1 Asian Low setup
const asianSetup = setups.find(
  (s) => s.anchor_type === 'ASIAN_LOW' && s.anchor_level === 2980
);

if (!asianSetup) {
  console.error("❌ FAIL: Expected Asian Low @ 2980 setup.");
  process.exit(1);
}

console.log(`- Asian Setup ID: ${asianSetup.id}`);
console.log(`  Wick Rejection: ${asianSetup.is_wick_rejection_sweep} (Wick Ratio: ${asianSetup.sweep_wick_ratio}%)`);
console.log(`  Sweep OB MT: $${asianSetup.sweep_ob_mt}`);
console.log(`  3-Pillar Passed: ${asianSetup.three_pillar_displacement_passed}`);
console.log(`    Pillar 1 (Vol >= 1.5x): ${asianSetup.pillar1_volume_ratio_passed} (${asianSetup.reclaim_volume_expansion}x)`);
console.log(`    Pillar 2 (Delta >= 60%): ${asianSetup.pillar2_delta_dominance_passed} (${asianSetup.reclaim_delta_dominance_pct}%)`);
console.log(`    Pillar 3 (Body >= 60%): ${asianSetup.pillar3_body_ratio_passed} (${asianSetup.reclaim_body_ratio}%)`);

if (
  !asianSetup.is_wick_rejection_sweep ||
  !asianSetup.three_pillar_displacement_passed ||
  !asianSetup.pillar1_volume_ratio_passed ||
  !asianSetup.pillar2_delta_dominance_passed ||
  !asianSetup.pillar3_body_ratio_passed
) {
  console.error("❌ FAIL: 3-Pillar Displacement Gatekeeper or Wick Rejection failed.");
  process.exit(1);
}

console.log("✅ TEST 1 PASSED: 3-Pillar Displacement Gatekeeper & Wick Rejection verified.");

// ── TEST 2: Order Routing (FVG CE vs Sweep OB MT) & Stop Loss ────────────────
console.log("\n[TEST 2] Testing Precision Routing & Stop Loss Locking...");

console.log(`- FVG CE Entry: $${asianSetup.entry_price}`);
console.log(`- Hard Stop Loss: $${asianSetup.stop_loss} (Sweep Extreme: $${asianSetup.sweep_price})`);

// Long SL must be placed 1 tick / buffer beyond the sweep extreme low (2970)
if (asianSetup.stop_loss >= asianSetup.sweep_price!) {
  console.error("❌ FAIL: Hard Stop Loss must be locked beyond sweep extreme.");
  process.exit(1);
}

// Test Sweep OB Mean Threshold entry mode
const mtEngine = new SweepReclaimEngine({
  entryMode: 'SWEEP_OB_MT',
  requireThreePillarDisplacement: true,
});
const { setups: mtSetups } = mtEngine.scanHistoricalSetups(candles);
const mtAsianSetup = mtSetups.find((s) => s.anchor_type === 'ASIAN_LOW' && s.anchor_level === 2980);

if (!mtAsianSetup || mtAsianSetup.entry_mode !== 'SWEEP_OB_MT' || mtAsianSetup.entry_price !== mtAsianSetup.sweep_ob_mt) {
  console.error("❌ FAIL: Sweep OB Mean Threshold entry mode failed.");
  process.exit(1);
}
console.log(`- Sweep OB MT Entry Mode: $${mtAsianSetup.entry_price} (matches sweep_ob_mt: $${mtAsianSetup.sweep_ob_mt})`);

console.log("✅ TEST 2 PASSED: Precision Routing & Stop Loss verified.");

// ── TEST 3: 3-Stage Harvest State Machine & Full Outcome ─────────────────────
console.log("\n[TEST 3] Testing 3-Stage Harvest State Machine Progression...");

console.log(`- Stage 1 Filled: ${asianSetup.is_stage1_filled} (Target: $${asianSetup.stage1_target})`);
console.log(`- Stage 2 Filled: ${asianSetup.is_stage2_filled} (Target: $${asianSetup.stage2_target})`);
console.log(`- Stage 3 Filled: ${asianSetup.is_stage3_filled} (Target: $${asianSetup.stage3_target})`);
console.log(`- Final Outcome: ${asianSetup.simulated_outcome} | Realized R: +${asianSetup.realized_rr}R`);

if (
  !asianSetup.is_stage1_filled ||
  !asianSetup.is_stage2_filled ||
  !asianSetup.is_stage3_filled ||
  asianSetup.simulated_outcome !== 'FULL_TP3_WIN' ||
  asianSetup.realized_rr <= 0
) {
  console.error("❌ FAIL: 3-Stage Harvest progression mismatch.");
  process.exit(1);
}

console.log("✅ TEST 3 PASSED: 3-Stage Harvest execution verified.");

// ── TEST 4: Telemetry Diagnostics ────────────────────────────────────────────
console.log("\n[TEST 4] Testing Telemetry Diagnostics & Pillar Summary...");

console.log(`- 3-Pillar All Pass Count: ${telemetry.three_pillar_all_pass_count} (${telemetry.three_pillar_all_pass_pct}%)`);
console.log(`- Pillar 1 Pass Count: ${telemetry.pillar1_pass_count} (${telemetry.pillar1_pass_pct}%)`);
console.log(`- Pillar 2 Pass Count: ${telemetry.pillar2_pass_count} (${telemetry.pillar2_pass_pct}%)`);
console.log(`- Pillar 3 Pass Count: ${telemetry.pillar3_pass_count} (${telemetry.pillar3_pass_pct}%)`);
console.log(`- Wick Rejection Sweeps: ${telemetry.wick_rejection_sweep_count} (${telemetry.wick_rejection_sweep_pct}%)`);
console.log(`- Discount/Premium Aligned: ${telemetry.discount_premium_aligned_count} (${telemetry.discount_premium_aligned_pct}%)`);
console.log(`- Retest Win Rate: ${telemetry.retest_win_rate_pct}%`);
console.log(`- Profit Factor: ${telemetry.profit_factor}`);
console.log(`- Expected Value E[R]: ${telemetry.expected_value_r}R`);

if (telemetry.three_pillar_all_pass_count < 1 || telemetry.total_winning_trades < 1) {
  console.error("❌ FAIL: Telemetry summary counts mismatch.");
  process.exit(1);
}

console.log("✅ TEST 4 PASSED: Telemetry Diagnostics verified.");

console.log("\n=========================================================================");
console.log("🎉 ALL SWEEP & RECLAIM 3-PILLAR & HARVEST TESTS PASSED (100%)!");
console.log("=========================================================================");
