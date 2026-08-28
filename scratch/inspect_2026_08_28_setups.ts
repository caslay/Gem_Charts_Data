import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades } from '../src/lib/quantEngine/equityCalculator';
import * as fs from 'fs';
import * as path from 'path';

async function inspect28() {
  console.log(`\n===============================================================`);
  console.log(` 🔬 FORENSIC AUDIT: 2026-08-28 QUANT LAB VS LIVE PM2 DAEMON `);
  console.log(`===============================================================\n`);

  const symbol = 'ETHUSDC';
  const all5m = await fetchHistoricalKlines(symbol, '5m', 500);

  const startMs = new Date('2026-08-28T00:00:00Z').getTime();
  const endMs = new Date('2026-08-28T23:59:59Z').getTime();
  const candles = all5m.filter((c) => c.t >= startMs && c.t <= endMs);

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
    enableProfitRatchet: true,
    volumeSmaPeriod: 20,
    volumeExpansionThreshold: 1.35,
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.50,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
  };

  const srEngine = new SweepReclaimEngine(scanConfig);
  const scanRes = srEngine.scanHistoricalSetups(candles);
  const setups = scanRes.setups || [];

  console.log(`Total 5M setups detected on 2026-08-28: ${setups.length}`);

  console.log(`\nAll Setups on 2026-08-28:`);
  for (const s of setups) {
    const reclaimIso = s.reclaim_time ? new Date(s.reclaim_time).toISOString().slice(11, 16) : 'N/A';
    const retestIso = s.retest_time ? new Date(s.retest_time).toISOString().slice(11, 16) : 'N/A';
    const exitIso = s.exit_time ? new Date(s.exit_time).toISOString().slice(11, 16) : 'N/A';
    console.log(`• ID: ${s.id}`);
    console.log(`  Anchor: ${s.anchor_name} ($${s.anchor_level}) | Type: ${s.type}`);
    console.log(`  Reclaim: ${reclaimIso} UTC | Retest: ${retestIso} UTC | Exit: ${exitIso} UTC`);
    console.log(`  Entry: $${s.entry_price} | SL: $${s.stop_loss} | Status: ${s.status} | Exit Outcome: ${s.stage_exit_type || s.simulated_outcome} (${s.realized_rr}R)`);
    console.log(`  Three Pillars: ${s.three_pillar_displacement_passed} | Valuation: ${s.is_valuation_aligned}\n`);
  }

  // Check what adaptSweepReclaimSetupsToTrades returns right now
  const adapted = adaptSweepReclaimSetupsToTrades(setups, { enforceSinglePositionWalk: true });
  console.log(`\n===============================================================`);
  console.log(` 📋 CURRENT ADAPTED TRADES (${adapted.length} trades):`);
  console.log(`===============================================================`);
  for (const t of adapted) {
    console.log(`• [${t.dateStr}] ${t.direction} ${t.label} @ $${t.entryPrice} ➔ Outcome: ${t.outcome} (${t.realizedR}R)`);
  }
}

inspect28().catch(console.error);
