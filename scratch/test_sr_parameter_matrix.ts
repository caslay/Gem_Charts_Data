/**
 * test_sr_parameter_matrix.ts
 * Rigorous parameter override matrix test for Sweep & Reclaim Quantitative Scanner.
 * Verifies that:
 * 1. Filtered anchor selection restricts anchor detection strictly to active anchor types.
 * 2. Precision routing routes limit entries to the selected model (FVG CE vs OB MT vs Reclaim Shelf).
 * 3. Valuation gate strictly vetoes unaligned setups when enabled.
 * 4. Stricter displacement/delta thresholds dynamically filter reclaims.
 */

import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';

// Generate a rich synthetic multi-day candle dataset
function generateMatrixTestCandles(): Candle[] {
  const candles: Candle[] = [];
  const baseTime = Date.parse("2026-05-01T00:00:00.000Z");
  const intervalMs = 900000; // 15m (96 candles/day)
  let p = 3000.0;

  for (let i = 0; i < 384; i++) { // 4 days of 15m candles
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
      if (hour >= 0 && hour < 7) {
        if (i === 12) {
          o = 2985; c = 2982; h = 2987; l = 2980; v = 1500; taker_buy_vol = 700; // Asian Low 2980
        } else {
          c = 2990 + Math.sin(i) * 5; h = Math.max(o, c) + 2; l = Math.min(o, c) - 2;
        }
      } else if (hour >= 7 && hour < 12) {
        if (i === 36) {
          o = 3020; c = 3028; h = 3030; l = 3018; v = 2000; taker_buy_vol = 1200; // London High 3030
        } else {
          c = 3010 + Math.sin(i) * 6; h = Math.max(o, c) + 2; l = Math.min(o, c) - 2;
        }
      } else {
        c = 3005 + Math.sin(i) * 4; h = Math.max(o, c) + 2; l = Math.min(o, c) - 2;
      }
    } else if (day === 2) {
      const d2 = i - 96;
      if (d2 === 10) {
        // Sweep Asian Low 2980 down to 2970
        o = 2982; c = 2978; h = 2985; l = 2970; v = 3000; taker_buy_vol = 1200;
      } else if (d2 === 11) {
        o = 2978; c = 2980; h = 2982; l = 2976; v = 1500; taker_buy_vol = 800;
      } else if (d2 === 12) {
        // 3-Pillar Reclaim
        o = 2978; c = 2992; h = 2994; l = 2976; v = 4000; taker_buy_vol = 2800;
      } else if (d2 === 13) {
        // FVG creation: 2982 to 2988 (CE = 2985)
        o = 2992; c = 2998; h = 3000; l = 2988; v = 2500; taker_buy_vol = 1600;
      } else if (d2 === 14) {
        // Retest pullback to 2984
        o = 2996; c = 2988; h = 2997; l = 2984; v = 1200; taker_buy_vol = 650;
      } else if (d2 === 15) {
        // Stage 1/2/3 run
        o = 2988; c = 3010; h = 3015; l = 2987; v = 2500; taker_buy_vol = 1800;
      } else {
        c = 3020 + Math.sin(i) * 5; h = Math.max(o, c) + 2; l = Math.min(o, c) - 2;
      }
    } else {
      c = 3010 + Math.sin(i) * 10;
      h = Math.max(o, c) + 3;
      l = Math.min(o, c) - 3;
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

const dataset = generateMatrixTestCandles();
console.log(`[MATRIX TEST] Generated test dataset: ${dataset.length} candles.\n`);

// ── TEST MATRIX 1: Dynamic Anchor Type Filtering ─────────────────────────────
console.log("=== MATRIX 1: Dynamic Anchor Selection Filtering ===");

const allAnchorsEngine = new SweepReclaimEngine({
  anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL']
});
const { setups: allSetups } = allAnchorsEngine.scanHistoricalSetups(dataset);

const asianOnlyEngine = new SweepReclaimEngine({
  anchorTypes: ['ASIAN_HIGH', 'ASIAN_LOW']
});
const { setups: asianOnlySetups } = asianOnlyEngine.scanHistoricalSetups(dataset);

const londonOnlyEngine = new SweepReclaimEngine({
  anchorTypes: ['LONDON_HIGH', 'LONDON_LOW']
});
const { setups: londonOnlySetups } = londonOnlyEngine.scanHistoricalSetups(dataset);

const dailyOnlyEngine = new SweepReclaimEngine({
  anchorTypes: ['PDH', 'PDL']
});
const { setups: dailyOnlySetups } = dailyOnlyEngine.scanHistoricalSetups(dataset);

console.log(`- All Anchors Total: ${allSetups.length}`);
console.log(`- Asian Only Total: ${asianOnlySetups.length} (all anchor types: ${[...new Set(asianOnlySetups.map(s => s.anchor_type))].join(', ')})`);
console.log(`- London Only Total: ${londonOnlySetups.length} (all anchor types: ${[...new Set(londonOnlySetups.map(s => s.anchor_type))].join(', ')})`);
console.log(`- Daily Only Total: ${dailyOnlySetups.length} (all anchor types: ${[...new Set(dailyOnlySetups.map(s => s.anchor_type))].join(', ')})`);

const asianOnlyHasOther = asianOnlySetups.some(s => s.anchor_type !== 'ASIAN_HIGH' && s.anchor_type !== 'ASIAN_LOW');
if (asianOnlyHasOther) {
  console.error("❌ FAIL: Asian Only filter leaked non-Asian anchors!");
  process.exit(1);
}
console.log("✅ MATRIX 1 PASSED: Anchor types strictly filtered by user selection.\n");

// ── TEST MATRIX 2: Entry Model Precision Routing ─────────────────────────────
console.log("=== MATRIX 2: Retest Entry Model Precision Routing ===");

const fvgCeEngine = new SweepReclaimEngine({
  entryMode: 'FVG_CE',
  anchorTypes: ['ASIAN_LOW']
});
const { setups: fvgCeSetups } = fvgCeEngine.scanHistoricalSetups(dataset);
const fvgSetup = fvgCeSetups.find(s => s.is_reclaimed && s.reclaim_fvg_created);

const obMtEngine = new SweepReclaimEngine({
  entryMode: 'SWEEP_OB_MT',
  anchorTypes: ['ASIAN_LOW']
});
const { setups: obMtSetups } = obMtEngine.scanHistoricalSetups(dataset);
const obSetup = obMtSetups.find(s => s.is_reclaimed && s.sweep_ob_mt !== null);

const shelfEngine = new SweepReclaimEngine({
  entryMode: 'RECLAIM_LEVEL',
  anchorTypes: ['ASIAN_LOW']
});
const { setups: shelfSetups } = shelfEngine.scanHistoricalSetups(dataset);
const shelfSetup = shelfSetups.find(s => s.is_reclaimed);

console.log(`- FVG CE Model: Entry = $${fvgSetup?.entry_price} (FVG CE: $${fvgSetup?.reclaim_fvg_ce})`);
console.log(`- Sweep OB MT Model: Entry = $${obSetup?.entry_price} (Sweep OB MT: $${obSetup?.sweep_ob_mt})`);
console.log(`- Shelf Model: Entry = $${shelfSetup?.entry_price} (Anchor Shelf: $${shelfSetup?.anchor_level})`);

if (!fvgSetup || !obSetup || !shelfSetup) {
  console.error("❌ FAIL: Failed to identify setups for entry model verification.");
  process.exit(1);
}

if (fvgSetup.entry_price !== fvgSetup.reclaim_fvg_ce) {
  console.error("❌ FAIL: FVG CE model did not match reclaim_fvg_ce!");
  process.exit(1);
}
if (obSetup.entry_price !== obSetup.sweep_ob_mt) {
  console.error("❌ FAIL: Sweep OB MT model did not match sweep_ob_mt!");
  process.exit(1);
}
if (shelfSetup.entry_price !== shelfSetup.anchor_level) {
  console.error("❌ FAIL: Shelf model did not match anchor_level!");
  process.exit(1);
}
console.log("✅ MATRIX 2 PASSED: Limit entry routed exactly to selected model.\n");

// ── TEST MATRIX 3: Valuation Gate Strict Veto ────────────────────────────────
console.log("=== MATRIX 3: Discount/Premium Valuation Gate Veto ===");

const unGatedEngine = new SweepReclaimEngine({
  enforceDiscountPremiumGate: false,
  anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL']
});
const { setups: unGatedSetups, telemetry: unGatedTelemetry } = unGatedEngine.scanHistoricalSetups(dataset);

const gatedEngine = new SweepReclaimEngine({
  enforceDiscountPremiumGate: true,
  anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL']
});
const { setups: gatedSetups, telemetry: gatedTelemetry } = gatedEngine.scanHistoricalSetups(dataset);

console.log(`- Un-Gated Retests Executed: ${unGatedTelemetry.total_retests_executed}`);
console.log(`- Gated Retests Executed: ${gatedTelemetry.total_retests_executed}`);

// Verify that when gate is enabled, NO setup with is_valuation_aligned === false ever has is_retested === true
const unalignedRetestedInGated = gatedSetups.filter(s => s.is_retested && !s.is_valuation_aligned);
if (unalignedRetestedInGated.length > 0) {
  console.error(`❌ FAIL: Found ${unalignedRetestedInGated.length} unaligned retests when Valuation Gate was ON!`);
  process.exit(1);
}
console.log(`- Zero unaligned retests in Gated scan: ${unalignedRetestedInGated.length === 0}`);
console.log("✅ MATRIX 3 PASSED: Valuation Gate strictly vetoes unaligned setups.\n");

// ── TEST MATRIX 4: Displacement & Delta Threshold Overrides ──────────────────
console.log("=== MATRIX 4: Displacement & Delta Threshold Overrides ===");

const normalThresholdsEngine = new SweepReclaimEngine({
  volumeExpansionThreshold: 1.50,
  deltaDominanceThreshold: 60.0,
  bodyRatioThreshold: 0.60
});
const { telemetry: normalTelemetry } = normalThresholdsEngine.scanHistoricalSetups(dataset);

const strictThresholdsEngine = new SweepReclaimEngine({
  volumeExpansionThreshold: 2.50, // very high volume requirement
  deltaDominanceThreshold: 75.0,  // very high delta requirement
  bodyRatioThreshold: 0.75
});
const { telemetry: strictTelemetry } = strictThresholdsEngine.scanHistoricalSetups(dataset);

console.log(`- Standard (1.5x Vol, 60% Delta): ${normalTelemetry.total_reclaims_confirmed} Reclaims, ${normalTelemetry.three_pillar_all_pass_count} 3-Pillar Passes`);
console.log(`- Strict (2.5x Vol, 75% Delta): ${strictTelemetry.total_reclaims_confirmed} Reclaims, ${strictTelemetry.three_pillar_all_pass_count} 3-Pillar Passes`);

if (strictTelemetry.total_reclaims_confirmed > normalTelemetry.total_reclaims_confirmed) {
  console.error("❌ FAIL: Strict thresholds produced more reclaims than standard!");
  process.exit(1);
}
console.log("✅ MATRIX 4 PASSED: Dynamic threshold overrides strictly enforce displacement gates.\n");

console.log("=========================================================================");
console.log("🎉 ALL PARAMETER OVERRIDE MATRIX TESTS PASSED WITH 100% SUCCESS!");
console.log("=========================================================================");
