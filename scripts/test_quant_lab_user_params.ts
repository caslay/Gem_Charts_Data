/**
 * scripts/test_quant_lab_user_params.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scans live Binance candles using the exact UI configuration shown in the user's
 * Quant Lab screenshot (Image 2):
 * - Entry Mode: Displacement FVG Proximal Edge (FVG_PROXIMAL)
 * - Discount/Premium Valuation Gate: TRUE
 * - Volume Ratio: 1.35x
 * - Delta Dominance: 52.0%
 * - Body-to-Range: 50%
 * - Lookback Major: 10, Internal: 5
 * - Max Bars Anchor to Sweep: 25, Sweep to Reclaim: 10, Retest: 20
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';

async function fetchBinanceKlines(symbol: string = 'ETHUSDC', interval: string = '5m', limit: number = 200): Promise<Candle[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error: ${res.statusText}`);
  const data = (await res.json()) as any[];

  return data.map((k) => {
    const o = parseFloat(k[1]);
    const h = parseFloat(k[2]);
    const l = parseFloat(k[3]);
    const c = parseFloat(k[4]);
    const v = parseFloat(k[5]);
    const taker_buy = parseFloat(k[9]);
    return {
      t: k[0],
      o,
      h,
      l,
      c,
      v,
      taker_buy_vol: taker_buy,
      taker_sell_vol: Math.max(0, v - taker_buy),
      isClosed: true,
    };
  });
}

async function main() {
  console.log('======================================================================');
  console.log('🔬 TESTING QUANT LAB RUN WITH USER\'S EXACT SCREENSHOT CONFIGURATION');
  console.log('======================================================================\n');

  const candles = await fetchBinanceKlines('ETHUSDC', '5m', 200);
  console.log(`✓ Loaded ${candles.length} 5m candles from Binance.`);

  // Configuration A: Exactly as shown in the Quant Lab screenshot (Image 2)
  console.log('\n▶ CONFIGURATION A: Exact UI Screenshot (FVG_PROXIMAL + Valuation Gate ON)...');
  const configA: SweepReclaimScanConfig = {
    symbol: 'ETHUSDC',
    timeframe: '5m',
    anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
    lookbackMajor: 10,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 25,
    maxBarsSweepToReclaim: 10,
    maxBarsToRetest: 20,
    volumeSmaPeriod: 20,
    volumeExpansionThreshold: 1.35,
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.50,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true, // [✓] CHECKED in Image 2
    entryMode: 'FVG_PROXIMAL',        // Selected in Image 2
    stage1Multiple: 1.0,
    stage2Multiple: 1.4,
    stage3Multiple: 3.0,
    enableStructuralTrail: true,
    enableProfitRatchet: true,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.12,
  };

  const engineA = new SweepReclaimEngine(configA);
  const resultA = engineA.scanHistoricalSetups(candles);
  const executedTradesA = resultA.setups.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');

  console.log(`✓ Total Setups Found: ${resultA.setups.length}`);
  console.log(`✓ Executed Trades in Ledger: ${executedTradesA.length}`);

  const shortSetupA = resultA.setups.find((s) => Math.abs(s.anchor_level - 2466.21) < 0.5 && s.type === 'BEARISH');
  if (shortSetupA) {
    console.log(`\n🔍 Status of Short Setup ($2466.21 Anchor) in Configuration A:`);
    console.log(`   - Setup ID:               ${shortSetupA.id}`);
    console.log(`   - 3-Pillars Passed:       ${shortSetupA.three_pillar_displacement_passed}`);
    console.log(`   - Is Reclaimed:           ${shortSetupA.is_reclaimed}`);
    console.log(`   - Valuation Aligned:      ${shortSetupA.is_valuation_aligned} (Equilibrium: $${shortSetupA.dealing_range_equilibrium})`);
    console.log(`   - Entry Mode:             ${shortSetupA.entry_mode} -> Entry Price: $${shortSetupA.entry_price}`);
    console.log(`   - Retested & Filled:      ${shortSetupA.is_retested}`);
    console.log(`   - Setup Status:           ${shortSetupA.status}`);
    console.log(`   - Simulated Outcome:      ${shortSetupA.simulated_outcome}`);
  } else {
    console.log('\n❌ Short Setup ($2466.21 Anchor) was NOT detected under Config A.');
  }

  // Configuration B: Entry Mode = SHELF_LEVEL (As executed in Live)
  console.log('\n▶ CONFIGURATION B: Entry Mode = SHELF_LEVEL (Anchor Shelf)...');
  const configB: SweepReclaimScanConfig = {
    ...configA,
    entryMode: 'SHELF_LEVEL',
    enforceDiscountPremiumGate: false,
  };

  const engineB = new SweepReclaimEngine(configB);
  const resultB = engineB.scanHistoricalSetups(candles);
  const shortSetupB = resultB.setups.find((s) => Math.abs(s.anchor_level - 2466.21) < 0.5 && s.type === 'BEARISH');

  if (shortSetupB) {
    console.log(`\n🔍 Status of Short Setup ($2466.21 Anchor) in Configuration B:`);
    console.log(`   - Entry Mode:             ${shortSetupB.entry_mode} -> Entry Price: $${shortSetupB.entry_price}`);
    console.log(`   - Stop Loss:              $${shortSetupB.stop_loss}`);
    console.log(`   - Retested & Filled:      ${shortSetupB.is_retested}`);
    console.log(`   - Simulated Outcome:      ${shortSetupB.simulated_outcome}`);
    console.log(`   - Exit Price:             $${shortSetupB.exit_price}`);
    console.log(`   - Realized RR:            ${shortSetupB.realized_rr}R`);
  }

  // Configuration C: Entry Mode = SWEEP_OB_MT
  console.log('\n▶ CONFIGURATION C: Entry Mode = SWEEP_OB_MT (50% Mean Threshold)...');
  const configC: SweepReclaimScanConfig = {
    ...configA,
    entryMode: 'SWEEP_OB_MT',
    enforceDiscountPremiumGate: false,
  };

  const engineC = new SweepReclaimEngine(configC);
  const resultC = engineC.scanHistoricalSetups(candles);
  const shortSetupC = resultC.setups.find((s) => Math.abs(s.anchor_level - 2466.21) < 0.5 && s.type === 'BEARISH');

  if (shortSetupC) {
    console.log(`\n🔍 Status of Short Setup ($2466.21 Anchor) in Configuration C:`);
    console.log(`   - Entry Mode:             ${shortSetupC.entry_mode} -> Entry Price: $${shortSetupC.entry_price}`);
    console.log(`   - Retested & Filled:      ${shortSetupC.is_retested}`);
    console.log(`   - Simulated Outcome:      ${shortSetupC.simulated_outcome}`);
  }
}

main().catch((err) => console.error(err));
