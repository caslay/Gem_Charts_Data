import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import * as fs from 'fs';
import * as path from 'path';

async function auditDeep() {
  console.log(`\n===============================================================`);
  console.log(` 🔬 DEEP FORENSIC AUDIT: 2026-08-29 QUANT LAB VS LIVE PM2 `);
  console.log(`===============================================================\n`);

  const symbol = 'ETHUSDC';
  const all5m = await fetchHistoricalKlines(symbol, '5m', 500);

  const startMs = new Date('2026-08-29T00:00:00Z').getTime();
  const endMs = new Date('2026-08-29T23:59:59Z').getTime();
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

  console.log(`Total Setups Detected on 2026-08-29: ${setups.length}\n`);

  console.log(`---------------------------------------------------------------`);
  console.log(`🔍 AUDIT TOPIC 1: What happened at 15:00 - 15:30 Cairo (12:00 - 12:30 UTC)?`);
  console.log(`---------------------------------------------------------------`);
  const middaySetups = setups.filter((s) => {
    const t = s.reclaim_time || s.anchor_time || 0;
    return t >= new Date('2026-08-29T11:00:00Z').getTime() && t <= new Date('2026-08-29T13:30:00Z').getTime();
  });

  for (const s of middaySetups) {
    const reclaimIso = s.reclaim_time ? new Date(s.reclaim_time).toISOString().slice(11, 16) : 'N/A';
    const retestIso = s.retest_time ? new Date(s.retest_time).toISOString().slice(11, 16) : 'N/A';
    const exitIso = s.exit_time ? new Date(s.exit_time).toISOString().slice(11, 16) : 'N/A';
    console.log(`• ID: ${s.id}`);
    console.log(`  Anchor: ${s.anchor_name} ($${s.anchor_level}) | Type: ${s.type} | Grade: ${s.anchor_swing_grade}`);
    console.log(`  Reclaim: ${reclaimIso} UTC | Retest: ${retestIso} UTC | Exit: ${exitIso} UTC`);
    console.log(`  Entry: $${s.entry_price} | SL: $${s.stop_loss} | Status: ${s.status}`);
    console.log(`  Outcome: ${s.stage_exit_type || s.simulated_outcome} (${s.realized_rr}R) | Exit Price: $${s.exit_price}\n`);
  }

  console.log(`---------------------------------------------------------------`);
  console.log(`🔍 AUDIT TOPIC 2: What happened at 18:05 Cairo (15:05 UTC)?`);
  console.log(`---------------------------------------------------------------`);
  const asianHighSetups = setups.filter((s) => s.id.includes('ASIAN_HIGH_2446.92'));
  for (const s of asianHighSetups) {
    console.log(`• ID: ${s.id}`);
    console.log(`  Anchor: ${s.anchor_name} ($${s.anchor_level})`);
    console.log(`  Reclaim: ${s.reclaim_time ? new Date(s.reclaim_time).toISOString().slice(11, 16) : 'N/A'} UTC`);
    console.log(`  Retest:  ${s.retest_time ? new Date(s.retest_time).toISOString().slice(11, 16) : 'N/A'} UTC`);
    console.log(`  Entry: $${s.entry_price} | SL: $${s.stop_loss} | Status: ${s.status}`);
    console.log(`  Outcome: ${s.stage_exit_type || s.simulated_outcome} (${s.realized_rr}R)\n`);
  }

  console.log(`---------------------------------------------------------------`);
  console.log(`🔍 AUDIT TOPIC 3: What happened at 22:40 Cairo (19:40 UTC)?`);
  console.log(`---------------------------------------------------------------`);
  const eveningSetups = setups.filter((s) => s.id.includes('2454.30'));
  for (const s of eveningSetups) {
    console.log(`• ID: ${s.id}`);
    console.log(`  Anchor: ${s.anchor_name} ($${s.anchor_level})`);
    console.log(`  Reclaim: ${s.reclaim_time ? new Date(s.reclaim_time).toISOString().slice(11, 16) : 'N/A'} UTC`);
    console.log(`  Retest:  ${s.retest_time ? new Date(s.retest_time).toISOString().slice(11, 16) : 'N/A'} UTC`);
    console.log(`  Entry: $${s.entry_price} | SL: $${s.stop_loss} | Status: ${s.status}`);
    console.log(`  Outcome: ${s.stage_exit_type || s.simulated_outcome} (${s.realized_rr}R)\n`);
  }
}

auditDeep().catch(console.error);
