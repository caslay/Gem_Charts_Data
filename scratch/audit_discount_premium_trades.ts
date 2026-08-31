import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import * as fs from 'fs';
import * as path from 'path';

async function investigateTrades() {
  console.log(`\n===============================================================`);
  console.log(` 🔬 DEEP AUDIT: DISCOUNT/PREMIUM VETO GATE ON LAST 2 TRADES`);
  console.log(`===============================================================\n`);

  const symbol = 'ETHUSDC';
  const all5m = await fetchHistoricalKlines(symbol, '5m', 1000);
  const all15m = await fetchHistoricalKlines(symbol, '15m', 500);
  const all1h = await fetchHistoricalKlines(symbol, '1h', 500);

  console.log(`Fetched 5m candles: ${all5m.length}, 15m: ${all15m.length}, 1h: ${all1h.length}`);

  const scanConfig: SweepReclaimScanConfig = {
    symbol,
    timeframe: '5m',
    anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
    lookbackMajor: 10,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 25,
    maxBarsSweepToReclaim: 10,
    maxBarsToRetest: 20,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.12,
    entryMode: 'FVG_PROXIMAL',
    stage1Multiple: 1.0,
    stage2Multiple: 1.4,
    stage3Multiple: 3.0,
    enableStructuralTrail: true,
    enableProfitRatchet: false,
    volumeSmaPeriod: 20,
    volumeExpansionThreshold: 1.35,
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.50,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
  };

  const srEngine = new SweepReclaimEngine(scanConfig);
  const scanRes = srEngine.scanHistoricalSetups(all5m);
  const setups = scanRes.setups || [];

  // Target Trade 1: 2026-08-30 ~11:50-12:00 UTC (Anchor around 2457.80)
  // Target Trade 2: 2026-08-31 ~09:00 UTC (Anchor around 2445.51)

  const trade1Setups = setups.filter(s => 
    s.type === 'BEARISH' && 
    Math.abs(s.anchor_level - 2457.80) < 1.0
  );

  const trade2Setups = setups.filter(s => 
    s.type === 'BEARISH' && 
    Math.abs(s.anchor_level - 2445.51) < 1.0
  );

  console.log(`\n--- TRADE 1 CANDIDATES (Anchor ~2457.80 on 2026-08-30) ---`);
  for (const s of trade1Setups) {
    console.log({
      id: s.id,
      anchor_name: s.anchor_name,
      anchor_level: s.anchor_level,
      anchor_time: new Date(s.anchor_time).toISOString(),
      sweep_price: s.sweep_price,
      sweep_time: s.sweep_time ? new Date(s.sweep_time).toISOString() : null,
      reclaim_time: s.reclaim_time ? new Date(s.reclaim_time).toISOString() : null,
      entry_price: s.entry_price,
      stop_loss: s.stop_loss,
      dealing_range_equilibrium: s.dealing_range_equilibrium,
      is_valuation_aligned: s.is_valuation_aligned,
      simulated_outcome: s.simulated_outcome,
      three_pillars: s.three_pillar_displacement_passed
    });
  }

  console.log(`\n--- TRADE 2 CANDIDATES (Anchor ~2445.51 on 2026-08-31) ---`);
  for (const s of trade2Setups) {
    console.log({
      id: s.id,
      anchor_name: s.anchor_name,
      anchor_level: s.anchor_level,
      anchor_time: new Date(s.anchor_time).toISOString(),
      sweep_price: s.sweep_price,
      sweep_time: s.sweep_time ? new Date(s.sweep_time).toISOString() : null,
      reclaim_time: s.reclaim_time ? new Date(s.reclaim_time).toISOString() : null,
      entry_price: s.entry_price,
      stop_loss: s.stop_loss,
      dealing_range_equilibrium: s.dealing_range_equilibrium,
      is_valuation_aligned: s.is_valuation_aligned,
      simulated_outcome: s.simulated_outcome,
      three_pillars: s.three_pillar_displacement_passed
    });
  }
}

investigateTrades().catch(console.error);
