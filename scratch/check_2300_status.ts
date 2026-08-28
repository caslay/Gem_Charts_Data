import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';

async function main() {
  const symbol = 'ETHUSDC';
  const all5m = await fetchHistoricalKlines(symbol, '5m', 500);
  const latestCandle = all5m[all5m.length - 1];

  console.log(`\n===============================================================`);
  console.log(` 🔎 23:00 CAIRO / 20:00 UTC LIVE VS QUANT LAB STATUS `);
  console.log(`===============================================================\n`);
  console.log(`• Current Time:      2026-08-28 23:00 Cairo (20:00 UTC)`);
  console.log(`• Live ETH Price:    $${latestCandle.c.toFixed(2)}`);
  console.log(`• Total 5M Candles:  ${all5m.length}`);

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
  const scanRes = srEngine.scanHistoricalSetups(all5m);
  const setups = scanRes.setups || [];

  console.log(`• Quant Lab Setups Detected: ${setups.length}`);
  
  const completedRetests = setups.filter(s => s.status === 'RETESTED' && (s.reclaim_time || 0) >= new Date('2026-08-28T09:38:30Z').getTime());
  console.log(`• Live Session Executed Setups (Retested): ${completedRetests.length}`);
  for (const s of completedRetests) {
    console.log(`  ➔ [${new Date(s.reclaim_time || 0).toISOString()}] ${s.type} ${s.anchor_name} @ $${s.entry_price} ➔ Exit: ${s.stage_exit_type} (${s.realized_rr}R)`);
  }
}

main().catch(console.error);
