import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup
} from '../src/lib/quantEngine/SweepReclaimEngine';

interface CompoundingRunStats {
  scenarioName: string;
  initialCapital: number;
  riskPct: number;
  totalTrades: number;
  winRatePct: number;
  slHitRatePct: number;
  profitFactor: number;
  netR: number;
  endingCapital: number;
  netProfitUsd: number;
  totalRoiPct: number;
  maxDrawdownPct: number;
  maxDrawdownUsd: number;
  cagrPct: number;
  sharpeRatioProxy: number;
  calmarRatioProxy: number;
  consecutiveLossMax: number;
}

function filterToxicTrades(trades: SweepReclaimSetup[]): SweepReclaimSetup[] {
  return trades.filter((t) => {
    const dt = new Date(t.retest_time || t.anchor_time);
    const day = dt.getUTCDay();
    const hour = dt.getUTCHours();

    // Veto 1: Daily NY Dead Zone Trap (16:00 UTC / 19:00 Cairo)
    if (hour === 16) return false;

    // Veto 2: Monday 18:00 UTC & 23:00 UTC
    if (day === 1 && (hour === 18 || hour === 23)) return false;

    // Veto 3: Tuesday 03:00 UTC
    if (day === 2 && hour === 3) return false;

    // Veto 4: Thursday 23:00 UTC
    if (day === 4 && hour === 23) return false;

    // Veto 5: Friday after 18:00 UTC
    if (day === 5 && hour >= 18) return false;

    // Veto 6: Sunday 04:00 UTC & 21:00 UTC
    if (day === 0 && (hour === 4 || hour === 21)) return false;

    return true;
  });
}

function simulateDynamicCompounding(
  scenarioName: string,
  initialCapital: number,
  riskPct: number,
  tradeList: SweepReclaimSetup[],
  maxRiskCapUsd?: number
): CompoundingRunStats {
  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxDDPct = 0;
  let maxDDUsd = 0;
  let wins = 0;
  let losses = 0;
  let scratches = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let netR = 0;

  let currentConsecLosses = 0;
  let maxConsecLosses = 0;

  const returns: number[] = [];

  for (const t of tradeList) {
    const r = t.realized_rr;
    netR += r;

    if (t.simulated_outcome === 'FULL_TP3_WIN' || t.simulated_outcome === 'FULL_TP2_WIN') {
      wins++;
      currentConsecLosses = 0;
    } else if (t.simulated_outcome === 'STOPPED_OUT') {
      losses++;
      currentConsecLosses++;
      if (currentConsecLosses > maxConsecLosses) maxConsecLosses = currentConsecLosses;
    } else {
      scratches++;
      currentConsecLosses = 0;
    }

    if (r > 0) grossWinR += r;
    else grossLossR += Math.abs(r);

    // Dynamic Risk Allocation based on Compounded Equity
    let currentRiskUsd = equity * (riskPct / 100);
    if (maxRiskCapUsd && currentRiskUsd > maxRiskCapUsd) {
      currentRiskUsd = maxRiskCapUsd;
    }

    const tradePnlUsd = r * currentRiskUsd;
    const prevEquity = equity;
    equity += tradePnlUsd;

    const tradePctReturn = (tradePnlUsd / prevEquity) * 100;
    returns.push(tradePctReturn);

    if (equity > peakEquity) {
      peakEquity = equity;
    }

    const currentDDUsd = peakEquity - equity;
    const currentDDPct = (currentDDUsd / peakEquity) * 100;

    if (currentDDPct > maxDDPct) maxDDPct = currentDDPct;
    if (currentDDUsd > maxDDUsd) maxDDUsd = currentDDUsd;
  }

  const n = tradeList.length;
  const winRatePct = n > 0 ? (wins / n) * 100 : 0;
  const slHitRatePct = n > 0 ? (losses / n) * 100 : 0;
  const pf = grossLossR > 0 ? grossWinR / grossLossR : 99.9;
  const totalRoiPct = ((equity - initialCapital) / initialCapital) * 100;

  // Mean & Std Dev for Sharpe
  const meanReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const variance = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / (returns.length || 1);
  const stdDev = Math.sqrt(variance);
  const sharpeProxy = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(365 * 10) : 0;
  const calmarProxy = maxDDPct > 0 ? totalRoiPct / maxDDPct : 0;

  return {
    scenarioName,
    initialCapital,
    riskPct,
    totalTrades: n,
    winRatePct: parseFloat(winRatePct.toFixed(1)),
    slHitRatePct: parseFloat(slHitRatePct.toFixed(1)),
    profitFactor: parseFloat(pf.toFixed(2)),
    netR: parseFloat(netR.toFixed(2)),
    endingCapital: parseFloat(equity.toFixed(2)),
    netProfitUsd: parseFloat((equity - initialCapital).toFixed(2)),
    totalRoiPct: parseFloat(totalRoiPct.toFixed(1)),
    maxDrawdownPct: parseFloat(maxDDPct.toFixed(1)),
    maxDrawdownUsd: parseFloat(maxDDUsd.toFixed(2)),
    cagrPct: parseFloat(totalRoiPct.toFixed(1)),
    sharpeRatioProxy: parseFloat(sharpeProxy.toFixed(2)),
    calmarRatioProxy: parseFloat(calmarProxy.toFixed(2)),
    consecutiveLossMax: maxConsecLosses,
  };
}

async function main() {
  const championConfig: SweepReclaimScanConfig = {
    symbol: 'ETHUSDC',
    timeframe: '5m',
    anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
    lookbackMajor: 10,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 25,
    maxBarsSweepToReclaim: 10,
    maxBarsToRetest: 20,
    volumeSmaPeriod: 20,
    volumeExpansionThreshold: 1.35,
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.50,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
    stage1Multiple: 1.0,
    stage2Multiple: 1.4,
    stage3Multiple: 3.0,
    entryMode: 'FVG_PROXIMAL',
    enableStructuralTrail: true,
    enableProfitRatchet: true,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.12,
  };

  const pathYear1 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_2024_2025.json');
  const candlesYear1: Candle[] = JSON.parse(fs.readFileSync(pathYear1, 'utf8'));

  const pathYear2 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_1year.json');
  const candlesYear2: Candle[] = JSON.parse(fs.readFileSync(pathYear2, 'utf8'));

  const candlesCombined: Candle[] = [...candlesYear1, ...candlesYear2].sort((a, b) => a.t - b.t);

  const engine = new SweepReclaimEngine(championConfig);

  // Year 1 Setups
  const { setups: setupsY1 } = engine.scanHistoricalSetups(candlesYear1);
  const tradesY1Base = setupsY1.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');
  const tradesY1Veto = filterToxicTrades(tradesY1Base);

  // Year 2 Setups
  const { setups: setupsY2 } = engine.scanHistoricalSetups(candlesYear2);
  const tradesY2Base = setupsY2.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');
  const tradesY2Veto = filterToxicTrades(tradesY2Base);

  // 2-Year Combined Setups
  const { setups: setupsComb } = engine.scanHistoricalSetups(candlesCombined);
  const tradesCombBase = setupsComb.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');
  const tradesCombVeto = filterToxicTrades(tradesCombBase);

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('📊 COMPOUNDING RISK MODE SIMULATION ($1,000 STARTING CAPITAL)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');

  // 1. Practical Institutional Sized Compounding (Compounding up to $500 Max Risk / Trade = $50,000 Equity Pool)
  // This gives realistic, executable dollar figures that match real liquidity constraints!
  console.log('--- 1. PRACTICAL REALISTIC COMPOUNDING (1.0% Risk with $250 Risk Cap per trade) ---');
  const y1CapBase = simulateDynamicCompounding('Year 1 Baseline', 1000, 1.0, tradesY1Base, 250);
  const y1CapVeto = simulateDynamicCompounding('Year 1 Smart Pause', 1000, 1.0, tradesY1Veto, 250);

  const y2CapBase = simulateDynamicCompounding('Year 2 Baseline', 1000, 1.0, tradesY2Base, 250);
  const y2CapVeto = simulateDynamicCompounding('Year 2 Smart Pause', 1000, 1.0, tradesY2Veto, 250);

  const combCapBase = simulateDynamicCompounding('2-Year Baseline', 1000, 1.0, tradesCombBase, 250);
  const combCapVeto = simulateDynamicCompounding('2-Year Smart Pause', 1000, 1.0, tradesCombVeto, 250);

  console.log('Year 1 Baseline:', y1CapBase);
  console.log('Year 1 Smart Pause:', y1CapVeto);
  console.log('Year 2 Baseline:', y2CapBase);
  console.log('Year 2 Smart Pause:', y2CapVeto);
  console.log('2-Year Combined Baseline:', combCapBase);
  console.log('2-Year Combined Smart Pause:', combCapVeto);

  // 2. Pure Dynamic 1.0% Compounding (Uncapped Risk)
  console.log('\n--- 2. PURE UNLIMITED 1.0% COMPOUNDING ---');
  const pure1Y1Base = simulateDynamicCompounding('Pure 1% Y1 Base', 1000, 1.0, tradesY1Base);
  const pure1Y1Veto = simulateDynamicCompounding('Pure 1% Y1 Veto', 1000, 1.0, tradesY1Veto);

  const pure1Y2Base = simulateDynamicCompounding('Pure 1% Y2 Base', 1000, 1.0, tradesY2Base);
  const pure1Y2Veto = simulateDynamicCompounding('Pure 1% Y2 Veto', 1000, 1.0, tradesY2Veto);

  const pure1CombBase = simulateDynamicCompounding('Pure 1% 2Y Base', 1000, 1.0, tradesCombBase);
  const pure1CombVeto = simulateDynamicCompounding('Pure 1% 2Y Veto', 1000, 1.0, tradesCombVeto);

  console.log('Pure 1% Y1 Base Max DD:', pure1Y1Base.maxDrawdownPct + '% | Max Consec Losses:', pure1Y1Base.consecutiveLossMax);
  console.log('Pure 1% Y1 Veto Max DD:', pure1Y1Veto.maxDrawdownPct + '% | Max Consec Losses:', pure1Y1Veto.consecutiveLossMax);
  console.log('Pure 1% Y2 Base Max DD:', pure1Y2Base.maxDrawdownPct + '% | Max Consec Losses:', pure1Y2Base.consecutiveLossMax);
  console.log('Pure 1% Y2 Veto Max DD:', pure1Y2Veto.maxDrawdownPct + '% | Max Consec Losses:', pure1Y2Veto.consecutiveLossMax);
  console.log('Pure 1% 2Y Base Max DD:', pure1CombBase.maxDrawdownPct + '% | Max Consec Losses:', pure1CombBase.consecutiveLossMax);
  console.log('Pure 1% 2Y Veto Max DD:', pure1CombVeto.maxDrawdownPct + '% | Max Consec Losses:', pure1CombVeto.consecutiveLossMax);

  // 3. Moderate 0.5% Conservative Compounding
  console.log('\n--- 3. CONSERVATIVE 0.5% COMPOUNDING ---');
  const consY1Base = simulateDynamicCompounding('Cons 0.5% Y1 Base', 1000, 0.5, tradesY1Base);
  const consY1Veto = simulateDynamicCompounding('Cons 0.5% Y1 Veto', 1000, 0.5, tradesY1Veto);

  const consY2Base = simulateDynamicCompounding('Cons 0.5% Y2 Base', 1000, 0.5, tradesY2Base);
  const consY2Veto = simulateDynamicCompounding('Cons 0.5% Y2 Veto', 1000, 0.5, tradesY2Veto);

  const consCombBase = simulateDynamicCompounding('Cons 0.5% 2Y Base', 1000, 0.5, tradesCombBase);
  const consCombVeto = simulateDynamicCompounding('Cons 0.5% 2Y Veto', 1000, 0.5, tradesCombVeto);

  console.log('Cons 0.5% Y1 Base Max DD:', consY1Base.maxDrawdownPct + '% | Ending:', consY1Base.endingCapital);
  console.log('Cons 0.5% Y1 Veto Max DD:', consY1Veto.maxDrawdownPct + '% | Ending:', consY1Veto.endingCapital);
  console.log('Cons 0.5% Y2 Base Max DD:', consY2Base.maxDrawdownPct + '% | Ending:', consY2Base.endingCapital);
  console.log('Cons 0.5% Y2 Veto Max DD:', consY2Veto.maxDrawdownPct + '% | Ending:', consY2Veto.endingCapital);
  console.log('Cons 0.5% 2Y Base Max DD:', consCombBase.maxDrawdownPct + '% | Ending:', consCombBase.endingCapital);
  console.log('Cons 0.5% 2Y Veto Max DD:', consCombVeto.maxDrawdownPct + '% | Ending:', consCombVeto.endingCapital);

  // Output JSON
  const outputData = {
    practicalCompounding: { y1CapBase, y1CapVeto, y2CapBase, y2CapVeto, combCapBase, combCapVeto },
    pure1PercentCompounding: { pure1Y1Base, pure1Y1Veto, pure1Y2Base, pure1Y2Veto, pure1CombBase, pure1CombVeto },
    conservative05PercentCompounding: { consY1Base, consY1Veto, consY2Base, consY2Veto, consCombBase, consCombVeto },
  };

  const outputJsonPath = path.resolve(process.cwd(), 'scratch', 'compounding_study_results.json');
  fs.writeFileSync(outputJsonPath, JSON.stringify(outputData, null, 2));
  console.log(`\nCompounding Study JSON saved to ${outputJsonPath}\n`);
}

main().catch(console.error);
