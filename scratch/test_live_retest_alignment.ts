import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades } from '../src/lib/quantEngine/equityCalculator';

async function testAlignment() {
  console.log(`\n===============================================================`);
  console.log(` 🔬 TESTING REAL-TIME 1:1 RE-TEST & EXIT ALIGNMENT `);
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

  // Look at setups around 14:00 - 15:00 UTC (17:00 - 18:00 Cairo)
  console.log(`Setups around 17:00 - 18:00 Cairo:`);
  for (const s of setups) {
    if (s.reclaim_time && s.reclaim_time >= new Date('2026-08-28T13:30:00Z').getTime() && s.reclaim_time <= new Date('2026-08-28T15:30:00Z').getTime()) {
      console.log(`\n• Setup: ${s.id}`);
      console.log(`  Anchor: ${s.anchor_name} | Type: ${s.type}`);
      console.log(`  Reclaim: ${new Date(s.reclaim_time).toISOString().slice(11, 16)} UTC (idx ${s.reclaim_index})`);
      console.log(`  Retest:  ${s.retest_time ? new Date(s.retest_time).toISOString().slice(11, 16) : 'N/A'} UTC (idx ${s.retest_index}) | Immediate Fill: ${s.is_immediate_fill}`);
      console.log(`  Exit:    ${s.exit_time ? new Date(s.exit_time).toISOString().slice(11, 16) : 'N/A'} UTC | Outcome: ${s.stage_exit_type || s.simulated_outcome}`);
    }
  }
}

testAlignment().catch(console.error);
