import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';

async function testFix() {
  const symbol = 'ETHUSDC';
  const all5m = await fetchHistoricalKlines(symbol, '5m', 1000);

  // Let's simulate stepping through 2026-08-28 bar by bar
  const startDayIdx = all5m.findIndex((c) => new Date(c.t).toISOString().startsWith('2026-08-28'));
  console.log(`Starting step-through from index ${startDayIdx}...`);

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

  let armedCount = 0;
  for (let i = startDayIdx; i < all5m.length; i++) {
    const currentSlice = all5m.slice(0, i + 1);
    const scanRes = srEngine.scanHistoricalSetups(currentSlice);
    const latestCandle = currentSlice[currentSlice.length - 1];
    const latestIndex = currentSlice.length - 1;
    const latestPrice = latestCandle.c;

    // Check setups where reclaim_index === latestIndex (freshly closed reclaim on this bar!)
    const freshSetups = (scanRes.setups || []).filter((s) => s.reclaim_index === latestIndex);
    for (const s of freshSetups) {
      if (s.three_pillar_displacement_passed && s.is_valuation_aligned) {
        armedCount++;
        const timeUtc = new Date(latestCandle.t).toISOString();
        console.log(`[ARMED @ ${timeUtc}] Setup ID: ${s.id} | ${s.type} ${s.anchor_name} | Entry: $${s.entry_price} | SL: $${s.stop_loss} | TP1: $${s.stage1_target}`);
      }
    }
  }

  console.log(`\nTotal Fresh Setups Confirmed on Candle Close during 2026-08-28: ${armedCount}`);
}

testFix().catch(console.error);
