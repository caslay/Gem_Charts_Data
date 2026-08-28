import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';

async function inspect1445() {
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

  const setups1445 = setups.filter((s) => s.reclaim_time === new Date('2026-08-28T14:45:00Z').getTime());
  console.log(`Setups reclaimed at 14:45 UTC (17:45 Cairo): ${setups1445.length}`);
  for (const s of setups1445) {
    console.log(`• Setup ID: ${s.id}`);
    console.log(`  Anchor: ${s.anchor_name} ($${s.anchor_level})`);
    console.log(`  Type: ${s.type} | Direction: ${s.anchor_swing_type}`);
    console.log(`  Entry: $${s.entry_price} | Retest Time: ${s.retest_time ? new Date(s.retest_time).toISOString().slice(11, 16) : 'N/A'}`);
    console.log(`  Status: ${s.status} | Outcome: ${s.stage_exit_type} (${s.realized_rr}R)`);
  }
}

inspect1445().catch(console.error);
