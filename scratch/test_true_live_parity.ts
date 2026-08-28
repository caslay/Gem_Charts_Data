import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades, calculateCompoundingMetrics } from '../src/lib/quantEngine/equityCalculator';

async function testTrueParity() {
  console.log(`\n===============================================================`);
  console.log(` 🔬 FORENSIC ROOT CAUSE ANALYSIS & 1:1 TRUE LIVE PARITY `);
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
  let setups = scanRes.setups || [];

  // Filter out phantom intra-bar immediate fills where post-close price never touched entry
  const realisticSetups = setups.map((s) => {
    if (s.is_immediate_fill && s.reclaim_index !== null) {
      // Check if price actually touched entry on subsequent candles
      let postCloseTouched = false;
      const isBull = s.type === 'BULLISH';
      for (let i = s.reclaim_index + 1; i < Math.min(candles.length, s.reclaim_index + 20); i++) {
        const c = candles[i];
        if (isBull && c.l <= s.entry_price) { postCloseTouched = true; break; }
        if (!isBull && c.h >= s.entry_price) { postCloseTouched = true; break; }
      }
      if (!postCloseTouched) {
        return {
          ...s,
          is_retested: false,
          status: 'RECLAIMED_NO_RETEST',
          simulated_outcome: 'NO_RETEST',
        };
      }
    }
    return s;
  });

  const adapted = adaptSweepReclaimSetupsToTrades(realisticSetups as any, { enforceSinglePositionWalk: true });

  console.log(`[REALISTIC POST-CLOSE SINGLE-POSITION TRADES ON 2026-08-28]:`);
  for (let i = 0; i < adapted.length; i++) {
    const t = adapted[i];
    console.log(
      `#${i + 1} | [${t.dateStr}] | ${t.direction.padEnd(7, ' ')} | ${t.label.padEnd(42, ' ')} @ $${t.entryPrice.toFixed(2)} ➔ Outcome: ${t.outcome.padEnd(16, ' ')} (${t.realizedR >= 0 ? '+' : ''}${t.realizedR}R)`
    );
  }
}

testTrueParity().catch(console.error);
