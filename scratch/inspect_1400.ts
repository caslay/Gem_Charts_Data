import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { DEFAULT_SR_LIVE_SETTINGS } from '../src/lib/quantEngine/strategyExecutionConfig';

async function inspect1400() {
  const symbol = 'ETHUSDC';
  const all5m = await fetchHistoricalKlines(symbol, '5m', 1000);

  // Find index of 14:00 candle
  const targetIdx = all5m.findIndex((c) => new Date(c.t).toISOString() === '2026-08-28T14:00:00.000Z');
  console.log(`Candle 14:00 UTC is at index ${targetIdx} (${new Date(all5m[targetIdx].t).toISOString()})`);

  const current5mSlice = all5m.slice(0, targetIdx + 1);

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
  const scanRes = srEngine.scanHistoricalSetups(current5mSlice);
  const setups = scanRes.setups || [];
  console.log(`Setups scanned at 14:00 UTC slice: ${setups.length}`);

  const latestCandle = current5mSlice[current5mSlice.length - 1];
  const latestPrice = latestCandle.c;
  const latestIndex = current5mSlice.length - 1;

  for (const s of setups.slice(-5)) {
    console.log(`\n--------------------------------------------`);
    console.log(`Setup ID: ${s.id} | Type: ${s.type} | Anchor: ${s.anchor_name} ($${s.anchor_level})`);
    console.log(`Reclaim Index: ${s.reclaim_index} (Latest Index: ${latestIndex}) -> Bars Since: ${latestIndex - (s.reclaim_index ?? 0)}`);
    console.log(`Reclaim Time: ${new Date(s.reclaim_time || 0).toISOString()}`);
    console.log(`is_retested: ${s.is_retested} | simulated_outcome: ${s.simulated_outcome} | status: ${s.status}`);
    console.log(`three_pillar_passed: ${s.three_pillar_displacement_passed} | is_valuation_aligned: ${s.is_valuation_aligned}`);
    console.log(`Latest Price: $${latestPrice} | Entry Price: $${s.entry_price} | Anchor Level: $${s.anchor_level}`);

    // Check Gate 1: Freshness
    const barsSinceReclaim = s.reclaim_index !== null ? latestIndex - s.reclaim_index : Infinity;
    if (s.reclaim_index === null || barsSinceReclaim > 20) {
      console.log(`❌ REJECTED by Gate 1: Stale (barsSinceReclaim = ${barsSinceReclaim} > 20)`);
      continue;
    }

    // Check Gate 3: Anchor Boundary
    const isBullish = s.type === "BULLISH";
    if (isBullish && latestPrice < s.anchor_level) {
      console.log(`❌ REJECTED by Gate 3: Long below anchor (${latestPrice} < ${s.anchor_level})`);
      continue;
    }
    if (!isBullish && latestPrice > s.anchor_level) {
      console.log(`❌ REJECTED by Gate 3: Short above anchor (${latestPrice} > ${s.anchor_level})`);
      continue;
    }

    // Check Gate 4: Missed Expansion
    if (isBullish && latestPrice >= s.stage1_target) {
      console.log(`❌ REJECTED by Gate 4: Missed TP1 expansion`);
      continue;
    }
    if (!isBullish && latestPrice <= s.stage1_target) {
      console.log(`❌ REJECTED by Gate 4: Missed TP1 expansion`);
      continue;
    }

    // Check Gate 5: Historical Resolution Guard
    if (
      s.is_retested === true ||
      s.simulated_outcome !== null ||
      s.retest_time !== null ||
      s.status === 'RETESTED' ||
      s.status === 'INVALIDATED_AT_RETEST' ||
      s.status === 'EXPIRED'
    ) {
      console.log(`❌ REJECTED by Gate 5: Already marked RETESTED/COMPLETED in historical simulation!`);
      continue;
    }

    // Check Gate 6: Resting Side
    if (isBullish && latestPrice <= s.entry_price) {
      console.log(`❌ REJECTED by Gate 6: Long price <= entry (${latestPrice} <= ${s.entry_price})`);
      continue;
    }
    if (!isBullish && latestPrice >= s.entry_price) {
      console.log(`❌ REJECTED by Gate 6: Short price >= entry (${latestPrice} >= ${s.entry_price})`);
      continue;
    }

    console.log(`✅ PASSED ALL GATES! Ready for live execution!`);
  }
}

inspect1400().catch(console.error);
