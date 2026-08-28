import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';

async function testFirstTouch() {
  console.log(`\n===============================================================`);
  console.log(` 🔬 TESTING FIRST-TOUCH PROXIMITY SELECTION RULE `);
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

  // Filter realistic post-close setups
  const realisticSetups = setups.map((s) => {
    if (s.is_retested && s.reclaim_index !== null && s.retest_index !== null) {
      if (s.retest_index <= s.reclaim_index) {
        let subsequentTouch = false;
        let subTouchIdx = -1;
        let subTouchTime = 0;
        const isBull = s.type === 'BULLISH';
        for (let i = s.reclaim_index + 1; i < Math.min(candles.length, s.reclaim_index + 20); i++) {
          const c = candles[i];
          if (isBull && c.l <= s.entry_price) { subsequentTouch = true; subTouchIdx = i; subTouchTime = c.t; break; }
          if (!isBull && c.h >= s.entry_price) { subsequentTouch = true; subTouchIdx = i; subTouchTime = c.t; break; }
          if (isBull && c.h >= s.stage1_target) break;
          if (!isBull && c.l <= s.stage1_target) break;
        }

        if (!subsequentTouch) {
          return {
            ...s,
            is_retested: false,
            status: 'RECLAIMED_NO_RETEST',
            simulated_outcome: 'NO_RETEST',
            stage_exit_type: 'NO_RETEST',
          };
        } else {
          return {
            ...s,
            retest_index: subTouchIdx,
            retest_time: subTouchTime,
          };
        }
      }
    }
    return s;
  });

  // Cluster same-wave setups and pick the one with closest entry to reclaim close price (First Touch)
  const waveMap = new Map<string, typeof setups>();
  for (const s of realisticSetups.filter(s => s.is_retested)) {
    const waveKey = `${s.reclaim_time || s.sweep_time}_${s.type}`;
    if (!waveMap.has(waveKey)) waveMap.set(waveKey, []);
    waveMap.get(waveKey)!.push(s);
  }

  const selectedSetups: typeof setups = [];
  for (const [_, cluster] of waveMap.entries()) {
    if (cluster.length === 1) {
      selectedSetups.push(cluster[0]);
    } else {
      // First-Touch Proximity sorting:
      // For Shorts: Lower entry price is closer to close price -> touches first
      // For Longs: Higher entry price is closer to close price -> touches first
      cluster.sort((a, b) => {
        const closePrice = a.reclaim_close_price || 0;
        const distA = Math.abs(a.entry_price - closePrice);
        const distB = Math.abs(b.entry_price - closePrice);
        return distA - distB; // closest distance first
      });
      selectedSetups.push(cluster[0]);
    }
  }

  console.log(`[FIRST-TOUCH SELECTION RESULTS ON 2026-08-28]:`);
  for (const s of selectedSetups) {
    const dateStr = s.retest_time ? new Date(s.retest_time + 3 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) : 'N/A';
    console.log(`• [${dateStr}] ${s.type} ${s.anchor_name} @ $${s.entry_price} ➔ Exit: ${s.stage_exit_type || s.simulated_outcome} (${s.realized_rr}R)`);
  }
}

testFirstTouch().catch(console.error);
