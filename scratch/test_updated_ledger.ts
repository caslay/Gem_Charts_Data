import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades, calculateCompoundingMetrics } from '../src/lib/quantEngine/equityCalculator';

async function testUpdatedLedger() {
  console.log(`\n===============================================================`);
  console.log(` 🔬 TESTING QUANT LAB SINGLE-POSITION DEDUPLICATED LEDGER `);
  console.log(`===============================================================\n`);

  const symbol = 'ETHUSDC';
  const all5m = await fetchHistoricalKlines(symbol, '5m', 1000);

  // Filter 5m candles for 08/27/2026 to 08/28/2026 (matching user's screenshot range)
  const startMs = new Date('2026-08-27T00:00:00Z').getTime();
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

  const rawExecutedSetups = setups.filter((s) => s.is_retested === true || s.status === 'RETESTED');
  const deduplicatedTrades = adaptSweepReclaimSetupsToTrades(setups, { enforceSinglePositionWalk: true });
  const rawTrades = adaptSweepReclaimSetupsToTrades(setups, { enforceSinglePositionWalk: false });

  console.log(`[DATASET AUDIT: 08/27/2026 — 08/28/2026]`);
  console.log(`• Total Setups Detected in Market:   ${setups.length}`);
  console.log(`• Raw Retested Setups (Old Ledger):  ${rawTrades.length} trades`);
  console.log(`• Single-Position Walk (New Ledger): ${deduplicatedTrades.length} trades`);
  console.log(`• Multi-Anchor Duplicates Purged:    ${rawTrades.length - deduplicatedTrades.length} duplicate rows`);

  console.log(`\n===============================================================`);
  console.log(` 📋 DEDUPLICATED CHRONOLOGICAL LEDGER (#1 to #${deduplicatedTrades.length})`);
  console.log(`===============================================================`);

  const compounding = calculateCompoundingMetrics(deduplicatedTrades, { initialCapital: 10000, riskPerTradePct: 1.5 });

  let i = 1;
  for (const pt of compounding.equityCurvePoints.slice(1)) {
    console.log(
      `#${String(i).padStart(2, ' ')} | ${pt.dateStr} | ${pt.direction.padEnd(7, ' ')} | ${pt.label.padEnd(38, ' ')} | Entry: $${pt.entryPrice.toFixed(2)} | SL: $${pt.stopLossPrice.toFixed(2)} | Outcome: ${pt.outcome.padEnd(16, ' ')} | Realized: ${pt.realizedR >= 0 ? '+' : ''}${pt.realizedR}R | PNL: ${pt.pnlUsd >= 0 ? '+' : ''}$${pt.pnlUsd.toFixed(2)} | Balance: $${pt.equity.toFixed(2)}`
    );
    i++;
  }

  console.log(`\n===============================================================`);
  console.log(` 📊 CAPITAL GROWTH SUMMARY COMPARISON`);
  console.log(`===============================================================`);
  const rawCompounding = calculateCompoundingMetrics(rawTrades, { initialCapital: 10000, riskPerTradePct: 1.5 });
  console.log(`• Old Multi-Anchor Stacked Capital: $${rawCompounding.finalEquity.toFixed(2)} (${rawTrades.length} trades) ⚠️ HYPER-COMPOUNDED`);
  console.log(`• New Realistic Single-Position:    $${compounding.finalEquity.toFixed(2)} (${deduplicatedTrades.length} trades) ✅ 1:1 LIVE PARITY`);
  console.log(`• Realized Return:                  +${compounding.totalNetPnlPct.toFixed(1)}%`);
  console.log(`• Win Rate:                         ${compounding.executionWinRatePct.toFixed(1)}%`);
  console.log(`• Profit Factor:                    ${compounding.profitFactor.toFixed(2)}`);
  console.log(`===============================================================\n`);
}

testUpdatedLedger().catch(console.error);
