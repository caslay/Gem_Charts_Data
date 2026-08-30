import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades } from '../src/lib/quantEngine/equityCalculator';

async function auditFullDayWalk() {
  console.log(`\n===============================================================`);
  console.log(` 🔬 STEP-BY-STEP SINGLE-POSITION WALK ON 2026-08-29 `);
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

  // Full day single-position walk
  const trades = adaptSweepReclaimSetupsToTrades(setups, { enforceSinglePositionWalk: true });

  console.log(`[ALL EXECUTED TRADES ON 2026-08-29 IN QUANT LAB]:`);
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    console.log(
      `#${i + 1} | [${t.dateStr}] | ${t.direction.padEnd(7, ' ')} | ${t.label.padEnd(42, ' ')} | Entry: $${t.entryPrice.toFixed(2)} | SL: $${t.stopLoss?.toFixed(2)} | Outcome: ${t.outcome.padEnd(16, ' ')} (${t.realizedR >= 0 ? '+' : ''}${t.realizedR}R)`
    );
  }
}

auditFullDayWalk().catch(console.error);
