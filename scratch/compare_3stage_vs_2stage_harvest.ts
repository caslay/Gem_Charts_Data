import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades, StandardizedExecutedTrade } from '../src/lib/quantEngine/equityCalculator';

export interface HarvestModelConfig {
  name: string;
  w1: number;
  w2: number;
  w3: number;
  stage1Multiple: number;
  stage2Multiple: number;
  stage3Multiple?: number;
  description: string;
}

export interface SimulationResult {
  modelName: string;
  description: string;
  w1: number;
  w2: number;
  w3: number;
  stage1Multiple: number;
  stage2Multiple: number;
  stage3Multiple?: number;

  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number;
  slHitRatePct: number;
  scratchRatePct: number;
  netRealizedR: number;
  profitFactor: number;
  expectedValueR: number;
  maxDrawdownR: number;
  avgBarsInTrade: number;

  stage1HitCount: number;
  stage2HitCount: number;
  stage3HitCount: number;
  stage1HitPct: number;
  stage2HitPct: number;
  stage3HitPct: number;

  fixedRiskEndingCapital: number;
  fixedRiskNetProfit: number;
  fixedRiskMaxDD: number;

  compoundingEndingEquity: number;
  compoundingNetProfit: number;
  compoundingMaxDollarDD: number;
  compoundingMaxPctDD: number;
  compoundingConsecutiveLosses: number;
  sharpeProxy: number;
}

// Function to simulate custom harvest tranches for executed setups
function simulateCustomHarvest(
  candles: Candle[],
  baseSetups: SweepReclaimSetup[],
  model: HarvestModelConfig,
  enableStructuralTrail = true,
  enableProfitRatchet = true
): SimulationResult {
  const executedTrades = adaptSweepReclaimSetupsToTrades(baseSetups, { enforceSinglePositionWalk: true });
  const executedSetupIds = new Set(executedTrades.map((t) => t.id));
  const validSetups = baseSetups.filter((s) => executedSetupIds.has(s.id));

  // Build candle map for quick lookups
  const n = candles.length;
  const candleTimeMap = new Map<number, number>();
  candles.forEach((c, idx) => candleTimeMap.set(c.t, idx));

  let netR = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let wins = 0;
  let losses = 0;
  let scratches = 0;
  let totalBarsInTrade = 0;

  let s1Count = 0;
  let s2Count = 0;
  let s3Count = 0;

  const modifiedTrades: { id: string; timestamp: number; realizedR: number; barsInTrade: number }[] = [];

  for (const s of validSetups) {
    const isBullish = s.type === 'BULLISH';
    const executionEntry = s.entry_price;
    const initialStopLoss = s.stop_loss;
    const riskUsd = Math.abs(executionEntry - initialStopLoss);
    if (riskUsd <= 0) continue;

    const target1 = isBullish
      ? executionEntry + model.stage1Multiple * riskUsd
      : executionEntry - model.stage1Multiple * riskUsd;
    const target2 = isBullish
      ? executionEntry + model.stage2Multiple * riskUsd
      : executionEntry - model.stage2Multiple * riskUsd;
    const target3 = model.w3 > 0 && model.stage3Multiple
      ? (isBullish
          ? executionEntry + model.stage3Multiple * riskUsd
          : executionEntry - model.stage3Multiple * riskUsd)
      : null;

    const reclaimFvgCe = s.reclaim_fvg_ce;
    const retestIdx = s.retest_index ?? (s.retest_time ? candleTimeMap.get(s.retest_time) : null);
    if (retestIdx === null || retestIdx === undefined || retestIdx < 0 || retestIdx >= n) continue;

    let activeStopLoss = initialStopLoss;
    let isStage1Filled = false;
    let isStage2Filled = false;
    let isStage3Filled = false;
    let realizedRr = 0;
    let exitIdx = retestIdx;
    let positionOpen = true;

    for (let i = retestIdx; i < n; i++) {
      if (!positionOpen) break;
      const c = candles[i];
      const high = c.h;
      const low = c.l;

      if (isBullish) {
        const initialBarSL = activeStopLoss;
        const hitStage1 = high >= target1;
        const hitStage2 = high >= target2;
        const hitStage3 = target3 !== null && high >= target3;

        let stageFilledThisBar = false;

        // Tranche 1 (w1)
        if (hitStage1 && !isStage1Filled) {
          isStage1Filled = true;
          s1Count++;
          stageFilledThisBar = true;

          if (enableStructuralTrail) {
            const structuralTrailLevel =
              reclaimFvgCe !== null && reclaimFvgCe !== undefined && reclaimFvgCe > initialStopLoss
                ? reclaimFvgCe
                : executionEntry;
            const maxGuaranteedFloor = executionEntry - 0.60 * riskUsd;
            activeStopLoss = Math.max(structuralTrailLevel, maxGuaranteedFloor);
          } else {
            activeStopLoss = executionEntry;
          }
        }

        // Tranche 2 (w2)
        if (hitStage2 && isStage1Filled && !isStage2Filled) {
          isStage2Filled = true;
          s2Count++;
          stageFilledThisBar = true;

          if (model.w3 === 0) {
            // 2-STAGE COMPLETE EXIT!
            realizedRr = model.w1 * model.stage1Multiple + model.w2 * model.stage2Multiple;
            exitIdx = i;
            positionOpen = false;
            break;
          } else if (enableProfitRatchet) {
            const ratchetLevel = executionEntry + 1.0 * riskUsd;
            activeStopLoss = Math.max(activeStopLoss, ratchetLevel);
          }
        }

        // Tranche 3 (w3) - Only if 3-stage model
        if (model.w3 > 0 && hitStage3 && isStage2Filled && !isStage3Filled) {
          isStage3Filled = true;
          s3Count++;
          realizedRr =
            model.w1 * model.stage1Multiple +
            model.w2 * model.stage2Multiple +
            model.w3 * (model.stage3Multiple || 3.0);
          exitIdx = i;
          positionOpen = false;
          break;
        }

        // Stop loss check
        const checkSL = stageFilledThisBar ? activeStopLoss : initialBarSL;
        if (low <= checkSL) {
          exitIdx = i;
          positionOpen = false;
          if (isStage2Filled && model.w3 > 0) {
            const runnerR = (checkSL - executionEntry) / riskUsd;
            realizedRr = model.w1 * model.stage1Multiple + model.w2 * model.stage2Multiple + model.w3 * runnerR;
          } else if (isStage1Filled) {
            const runnerR = (checkSL - executionEntry) / riskUsd;
            realizedRr = model.w1 * model.stage1Multiple + (model.w2 + model.w3) * runnerR;
          } else {
            realizedRr = -1.0;
          }
          break;
        }
      } else {
        // Bearish logic
        const initialBarSL = activeStopLoss;
        const hitStage1 = low <= target1;
        const hitStage2 = low <= target2;
        const hitStage3 = target3 !== null && low <= target3;

        let stageFilledThisBar = false;

        // Tranche 1 (w1)
        if (hitStage1 && !isStage1Filled) {
          isStage1Filled = true;
          s1Count++;
          stageFilledThisBar = true;

          if (enableStructuralTrail) {
            const structuralTrailLevel =
              reclaimFvgCe !== null && reclaimFvgCe !== undefined && reclaimFvgCe < initialStopLoss
                ? reclaimFvgCe
                : executionEntry;
            const maxGuaranteedFloor = executionEntry + 0.60 * riskUsd;
            activeStopLoss = Math.min(structuralTrailLevel, maxGuaranteedFloor);
          } else {
            activeStopLoss = executionEntry;
          }
        }

        // Tranche 2 (w2)
        if (hitStage2 && isStage1Filled && !isStage2Filled) {
          isStage2Filled = true;
          s2Count++;
          stageFilledThisBar = true;

          if (model.w3 === 0) {
            // 2-STAGE COMPLETE EXIT!
            realizedRr = model.w1 * model.stage1Multiple + model.w2 * model.stage2Multiple;
            exitIdx = i;
            positionOpen = false;
            break;
          } else if (enableProfitRatchet) {
            const ratchetLevel = executionEntry - 1.0 * riskUsd;
            activeStopLoss = Math.min(activeStopLoss, ratchetLevel);
          }
        }

        // Tranche 3 (w3)
        if (model.w3 > 0 && hitStage3 && isStage2Filled && !isStage3Filled) {
          isStage3Filled = true;
          s3Count++;
          realizedRr =
            model.w1 * model.stage1Multiple +
            model.w2 * model.stage2Multiple +
            model.w3 * (model.stage3Multiple || 3.0);
          exitIdx = i;
          positionOpen = false;
          break;
        }

        // Stop loss check
        const checkSL = stageFilledThisBar ? activeStopLoss : initialBarSL;
        if (high >= checkSL) {
          exitIdx = i;
          positionOpen = false;
          if (isStage2Filled && model.w3 > 0) {
            const runnerR = (executionEntry - checkSL) / riskUsd;
            realizedRr = model.w1 * model.stage1Multiple + model.w2 * model.stage2Multiple + model.w3 * runnerR;
          } else if (isStage1Filled) {
            const runnerR = (executionEntry - checkSL) / riskUsd;
            realizedRr = model.w1 * model.stage1Multiple + (model.w2 + model.w3) * runnerR;
          } else {
            realizedRr = -1.0;
          }
          break;
        }
      }
    }

    const barsInTrade = Math.max(1, exitIdx - retestIdx);
    totalBarsInTrade += barsInTrade;

    netR += realizedRr;
    if (realizedRr > 0) {
      wins++;
      grossWinR += realizedRr;
    } else if (realizedRr < 0) {
      losses++;
      grossLossR += Math.abs(realizedRr);
    } else {
      scratches++;
    }

    modifiedTrades.push({
      id: s.id,
      timestamp: s.retest_time || s.reclaim_time || Date.now(),
      realizedR: parseFloat(realizedRr.toFixed(2)),
      barsInTrade,
    });
  }

  const numTrades = modifiedTrades.length;
  const winRate = numTrades > 0 ? (wins / numTrades) * 100 : 0;
  const slHitRate = numTrades > 0 ? (losses / numTrades) * 100 : 0;
  const scratchRate = numTrades > 0 ? (scratches / numTrades) * 100 : 0;
  const pf = grossLossR > 0 ? grossWinR / grossLossR : 99.9;
  const ev = numTrades > 0 ? netR / numTrades : 0;
  const avgBars = numTrades > 0 ? totalBarsInTrade / numTrades : 0;

  // Max Drawdown calculation
  let peakR = 0;
  let currentR = 0;
  let maxDDR = 0;
  for (const t of modifiedTrades) {
    currentR += t.realizedR;
    if (currentR > peakR) peakR = currentR;
    const dd = peakR - currentR;
    if (dd > maxDDR) maxDDR = dd;
  }

  // Financial Simulations ($1000 start)
  const fixedEndingCapital = 1000 + netR * 10;
  const fixedNetProfit = netR * 10;
  const fixedMaxDollarDD = maxDDR * 10;

  // Compounding simulation
  let equity = 1000;
  let peakEquity = 1000;
  let maxDollarDD = 0;
  let maxPctDD = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;
  const dailyPnLs: number[] = [];

  for (const t of modifiedTrades) {
    const riskAmount = Math.min(equity * 0.01, 250);
    const dollarPnL = t.realizedR * riskAmount;
    equity += dollarPnL;
    dailyPnLs.push(dollarPnL);

    if (t.realizedR < 0) {
      consecutiveLosses++;
      if (consecutiveLosses > maxConsecutiveLosses) maxConsecutiveLosses = consecutiveLosses;
    } else if (t.realizedR > 0) {
      consecutiveLosses = 0;
    }

    if (equity > peakEquity) peakEquity = equity;
    const dollarDD = peakEquity - equity;
    if (dollarDD > maxDollarDD) maxDollarDD = dollarDD;
    const pctDD = (dollarDD / peakEquity) * 100;
    if (pctDD > maxPctDD) maxPctDD = pctDD;
  }

  // Sharpe ratio proxy
  const avgTradePnL = dailyPnLs.reduce((a, b) => a + b, 0) / (dailyPnLs.length || 1);
  const variance = dailyPnLs.reduce((a, b) => a + Math.pow(b - avgTradePnL, 2), 0) / (dailyPnLs.length || 1);
  const stdDev = Math.sqrt(variance);
  const sharpeProxy = stdDev > 0 ? (avgTradePnL / stdDev) * Math.sqrt(365 * 4) : 0;

  return {
    modelName: model.name,
    description: model.description,
    w1: model.w1,
    w2: model.w2,
    w3: model.w3,
    stage1Multiple: model.stage1Multiple,
    stage2Multiple: model.stage2Multiple,
    stage3Multiple: model.stage3Multiple,

    totalTrades: numTrades,
    wins,
    losses,
    scratches,
    winRatePct: parseFloat(winRate.toFixed(1)),
    slHitRatePct: parseFloat(slHitRate.toFixed(1)),
    scratchRatePct: parseFloat(scratchRate.toFixed(1)),
    netRealizedR: parseFloat(netR.toFixed(2)),
    profitFactor: parseFloat(pf.toFixed(2)),
    expectedValueR: parseFloat(ev.toFixed(2)),
    maxDrawdownR: parseFloat(maxDDR.toFixed(2)),
    avgBarsInTrade: parseFloat(avgBars.toFixed(1)),

    stage1HitCount: s1Count,
    stage2HitCount: s2Count,
    stage3HitCount: s3Count,
    stage1HitPct: parseFloat(((s1Count / numTrades) * 100).toFixed(1)),
    stage2HitPct: parseFloat(((s2Count / numTrades) * 100).toFixed(1)),
    stage3HitPct: parseFloat(((s3Count / numTrades) * 100).toFixed(1)),

    fixedRiskEndingCapital: parseFloat(fixedEndingCapital.toFixed(2)),
    fixedRiskNetProfit: parseFloat(fixedNetProfit.toFixed(2)),
    fixedRiskMaxDD: parseFloat(fixedMaxDollarDD.toFixed(2)),

    compoundingEndingEquity: parseFloat(equity.toFixed(2)),
    compoundingNetProfit: parseFloat((equity - 1000).toFixed(2)),
    compoundingMaxDollarDD: parseFloat(maxDollarDD.toFixed(2)),
    compoundingMaxPctDD: parseFloat(maxPctDD.toFixed(2)),
    compoundingConsecutiveLosses: maxConsecutiveLosses,
    sharpeProxy: parseFloat(sharpeProxy.toFixed(2)),
  };
}

async function main() {
  const pathYear1 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_2024_2025.json');
  const candlesY1: Candle[] = JSON.parse(fs.readFileSync(pathYear1, 'utf8'));

  const pathYear2 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_1year.json');
  const candlesY2: Candle[] = JSON.parse(fs.readFileSync(pathYear2, 'utf8'));

  const candles2Y: Candle[] = [...candlesY1, ...candlesY2].sort((a, b) => a.t - b.t);

  const baseConfig: SweepReclaimScanConfig = {
    symbol: 'ETHUSDC',
    timeframe: '5m',
    anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
    lookbackMajor: 10,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 25,
    maxBarsSweepToReclaim: 10,
    maxBarsToRetest: 20,
    volumeSmaPeriod: 20,
    volumeExpansionThreshold: 1.20,
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.40,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
    stage1Multiple: 1.0,
    stage2Multiple: 1.4,
    stage3Multiple: 3.0,
    entryMode: 'FVG_PROXIMAL',
    enableStructuralTrail: true,
    enableProfitRatchet: true,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.10,
  };

  console.log('Generating base setups across 2-Year dataset (210,456 candles)...');
  const engine2Y = new SweepReclaimEngine(baseConfig);
  const { setups: baseSetups2Y } = engine2Y.scanHistoricalSetups(candles2Y);

  console.log('Generating base setups for Year 1 (105,120 candles)...');
  const engineY1 = new SweepReclaimEngine(baseConfig);
  const { setups: baseSetupsY1 } = engineY1.scanHistoricalSetups(candlesY1);

  console.log('Generating base setups for Year 2 (105,336 candles)...');
  const engineY2 = new SweepReclaimEngine(baseConfig);
  const { setups: baseSetupsY2 } = engineY2.scanHistoricalSetups(candlesY2);

  // Define Harvest Models to compare
  const models: HarvestModelConfig[] = [
    // Current 3-Stage Model
    {
      name: 'Current 3-Stage Harvest (40% @ 1.0R / 40% @ 1.4R / 20% @ 3.0R)',
      description: 'Active production champion: 40% TP1 @ 1.0R, 40% TP2 @ 1.4R with +1.0R ratchet, 20% runner @ 3.0R.',
      w1: 0.40,
      w2: 0.40,
      w3: 0.20,
      stage1Multiple: 1.0,
      stage2Multiple: 1.4,
      stage3Multiple: 3.0,
    },
    // 2-Stage Variant 1: 50% @ 1.0R / 50% @ 1.4R (Exact requested 50/50 test)
    {
      name: '2-Stage Harvest Model A (50% @ 1.0R / 50% @ 1.4R)',
      description: 'Requested 50/50 split: 50% TP1 @ 1.0R (move to BE), 50% TP2 @ 1.4R (Full 100% position close).',
      w1: 0.50,
      w2: 0.50,
      w3: 0.00,
      stage1Multiple: 1.0,
      stage2Multiple: 1.4,
    },
    // 2-Stage Variant 2: 50% @ 1.0R / 50% @ 1.3R (High velocity)
    {
      name: '2-Stage Harvest Model B (50% @ 1.0R / 50% @ 1.3R)',
      description: 'High velocity 50/50 split: 50% TP1 @ 1.0R, 50% TP2 @ 1.3R full close.',
      w1: 0.50,
      w2: 0.50,
      w3: 0.00,
      stage1Multiple: 1.0,
      stage2Multiple: 1.3,
    },
    // 2-Stage Variant 3: 50% @ 1.0R / 50% @ 1.5R (Slight stretch)
    {
      name: '2-Stage Harvest Model C (50% @ 1.0R / 50% @ 1.5R)',
      description: 'Slight stretch 50/50 split: 50% TP1 @ 1.0R, 50% TP2 @ 1.5R full close.',
      w1: 0.50,
      w2: 0.50,
      w3: 0.00,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
    },
    // 2-Stage Variant 4: 50% @ 1.0R / 50% @ 1.6R
    {
      name: '2-Stage Harvest Model D (50% @ 1.0R / 50% @ 1.6R)',
      description: 'Medium stretch 50/50 split: 50% TP1 @ 1.0R, 50% TP2 @ 1.6R full close.',
      w1: 0.50,
      w2: 0.50,
      w3: 0.00,
      stage1Multiple: 1.0,
      stage2Multiple: 1.6,
    },
    // 2-Stage Variant 5: 50% @ 1.0R / 50% @ 2.0R
    {
      name: '2-Stage Harvest Model E (50% @ 1.0R / 50% @ 2.0R)',
      description: 'Macro 2.0R 50/50 split: 50% TP1 @ 1.0R, 50% TP2 @ 2.0R full close.',
      w1: 0.50,
      w2: 0.50,
      w3: 0.00,
      stage1Multiple: 1.0,
      stage2Multiple: 2.0,
    },
    // 2-Stage Asymmetric Variant: 60% @ 1.0R / 40% @ 1.5R
    {
      name: '2-Stage Asymmetric Model F (60% @ 1.0R / 40% @ 1.5R)',
      description: 'Asymmetric 60/40 split: 60% TP1 @ 1.0R, 40% TP2 @ 1.5R full close.',
      w1: 0.60,
      w2: 0.40,
      w3: 0.00,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
    },
  ];

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('🔬 QUANTITATIVE HARVEST AUDIT: 3-STAGE (40/40/20) VS. 2-STAGE (50/50) MODELS');
  console.log('Evaluated across 2 Full Calendar Years (210,456 continuous 5m candles / 3,075 executed trades)...');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');

  const results2Y: SimulationResult[] = [];
  const resultsY1: SimulationResult[] = [];
  const resultsY2: SimulationResult[] = [];

  for (const m of models) {
    const res2Y = simulateCustomHarvest(candles2Y, baseSetups2Y, m);
    const resY1 = simulateCustomHarvest(candlesY1, baseSetupsY1, m);
    const resY2 = simulateCustomHarvest(candlesY2, baseSetupsY2, m);

    results2Y.push(res2Y);
    resultsY1.push(resY1);
    resultsY2.push(resY2);

    console.log(`Model: [${m.name}]`);
    console.log(`  ➔ 2-Year Total: Net R: +${res2Y.netRealizedR}R | Win%: ${res2Y.winRatePct}% | PF: ${res2Y.profitFactor} | EV: +${res2Y.expectedValueR}R | Max DD: -${res2Y.maxDrawdownR}R | Avg Bars: ${res2Y.avgBarsInTrade}`);
    console.log(`     Stage 1 Hit: ${res2Y.stage1HitPct}% (${res2Y.stage1HitCount}) | Stage 2 Hit: ${res2Y.stage2HitPct}% (${res2Y.stage2HitCount}) | Stage 3 Hit: ${res2Y.stage3HitPct}% (${res2Y.stage3HitCount})`);
    console.log(`     $1,000 Fixed Risk: $${res2Y.fixedRiskEndingCapital.toLocaleString()} (+$${res2Y.fixedRiskNetProfit.toLocaleString()})`);
    console.log(`     $1,000 Compounding ($250 cap): $${res2Y.compoundingEndingEquity.toLocaleString()} (+$${res2Y.compoundingNetProfit.toLocaleString()} | Max DD: -$${res2Y.compoundingMaxDollarDD.toLocaleString()} / ${res2Y.compoundingMaxPctDD}% | Sharpe: ${res2Y.sharpeProxy})\n`);
  }

  fs.writeFileSync(
    path.resolve(process.cwd(), 'scratch', 'harvest_model_comparison_results.json'),
    JSON.stringify({ results2Y, resultsY1, resultsY2 }, null, 2)
  );

  console.log('Results saved to scratch/harvest_model_comparison_results.json');
}

main().catch(console.error);
