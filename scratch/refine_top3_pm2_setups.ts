import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades, StandardizedExecutedTrade } from '../src/lib/quantEngine/equityCalculator';

export interface RefinedTestMetric {
  id: number;
  name: string;
  config: SweepReclaimScanConfig;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  slHitRatePct: number;
  netRealizedR: number;
  profitFactor: number;
  expectedValueR: number;
  maxDrawdownR: number;
  stage1FillRatePct: number;
  stage2FillRatePct: number;
  stage3FillRatePct: number;
  compositeScore: number;
  twoYearTotalTrades?: number;
  twoYearNetR?: number;
  twoYearWinRatePct?: number;
  twoYearPF?: number;
  twoYearMaxDDR?: number;
}

function evaluateTrades(
  id: number,
  name: string,
  config: SweepReclaimScanConfig,
  executedTrades: StandardizedExecutedTrade[],
  rawSetups: SweepReclaimSetup[]
): RefinedTestMetric {
  let netR = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let wins = 0;
  let losses = 0;

  for (const t of executedTrades) {
    const r = t.realizedR;
    netR += r;
    if (r > 0) {
      wins++;
      grossWinR += r;
    } else if (r < 0) {
      losses++;
      grossLossR += Math.abs(r);
    }
  }

  const n = executedTrades.length;
  const winRate = n > 0 ? (wins / n) * 100 : 0;
  const slHitRate = n > 0 ? (losses / n) * 100 : 0;
  const pf = grossLossR > 0 ? grossWinR / grossLossR : 99.9;
  const ev = n > 0 ? netR / n : 0;

  let peakR = 0;
  let currentR = 0;
  let maxDDR = 0;
  for (const t of executedTrades) {
    currentR += t.realizedR;
    if (currentR > peakR) peakR = currentR;
    const dd = peakR - currentR;
    if (dd > maxDDR) maxDDR = dd;
  }

  const executedSetupIds = new Set(executedTrades.map((t) => t.id));
  const matchedSetups = rawSetups.filter((s) => executedSetupIds.has(s.id));
  const stage1Count = matchedSetups.filter((s) => s.is_stage1_filled).length;
  const stage2Count = matchedSetups.filter((s) => s.is_stage2_filled).length;
  const stage3Count = matchedSetups.filter((s) => s.is_stage3_filled).length;

  const compositeScore =
    netR * 0.4 +
    pf * 100 * 0.25 +
    winRate * 10 * 0.15 -
    slHitRate * 15 * 0.15 -
    maxDDR * 20 * 0.05;

  return {
    id,
    name,
    config,
    totalTrades: n,
    wins,
    losses,
    winRatePct: parseFloat(winRate.toFixed(1)),
    slHitRatePct: parseFloat(slHitRate.toFixed(1)),
    netRealizedR: parseFloat(netR.toFixed(2)),
    profitFactor: parseFloat(pf.toFixed(2)),
    expectedValueR: parseFloat(ev.toFixed(2)),
    maxDrawdownR: parseFloat(maxDDR.toFixed(2)),
    stage1FillRatePct: parseFloat((n > 0 ? (stage1Count / n) * 100 : 0).toFixed(1)),
    stage2FillRatePct: parseFloat((n > 0 ? (stage2Count / n) * 100 : 0).toFixed(1)),
    stage3FillRatePct: parseFloat((n > 0 ? (stage3Count / n) * 100 : 0).toFixed(1)),
    compositeScore: parseFloat(compositeScore.toFixed(2)),
  };
}

async function main() {
  const pathYear1 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_2024_2025.json');
  const candlesY1: Candle[] = JSON.parse(fs.readFileSync(pathYear1, 'utf8'));

  const pathYear2 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_1year.json');
  const candlesY2: Candle[] = JSON.parse(fs.readFileSync(pathYear2, 'utf8'));

  const candles2Y: Candle[] = [...candlesY1, ...candlesY2].sort((a, b) => a.t - b.t);

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('🎯 DEEP REFINEMENT MATRIX: OPTIMIZING TOP 3 FINALISTS UNDER PM2 1:1 PARITY');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');

  const baseAnchors = ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'];

  // Refinement Candidates combining Volume (1.15-1.25x), Delta (50-52%), Body (0.40-0.45), Targets (1.3-1.4R)
  const refinementConfigs: { name: string; config: SweepReclaimScanConfig }[] = [
    {
      name: 'Refinement 01: Top 1 Champion (1.20x Vol, 52% Delta, 0.50 Body, 1.4R TP2, 0.12 ATR SL)',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: baseAnchors,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 20,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
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
      },
    },
    {
      name: 'Refinement 02: Hybrid Vol-Body Alpha (1.20x Vol, 52% Delta, 0.45 Body, 1.4R TP2, 0.12 ATR SL)',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: baseAnchors,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 20,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.45,
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
      },
    },
    {
      name: 'Refinement 03: Hybrid Vol-Body-Delta (1.20x Vol, 51% Delta, 0.45 Body, 1.4R TP2, 0.10 ATR SL)',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: baseAnchors,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 20,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 51.0,
        bodyRatioThreshold: 0.45,
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
      },
    },
    {
      name: 'Refinement 04: High-Velocity 1.35R Target (1.20x Vol, 52% Delta, 0.45 Body, 1.35R TP2, 0.10 ATR SL)',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: baseAnchors,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 20,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.45,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.35,
        stage3Multiple: 3.0,
        entryMode: 'FVG_PROXIMAL',
        enableStructuralTrail: true,
        enableProfitRatchet: true,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.10,
      },
    },
    {
      name: 'Refinement 05: Balanced 1.25x Vol (1.25x Vol, 52% Delta, 0.45 Body, 1.4R TP2, 0.12 ATR SL)',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: baseAnchors,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 20,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.25,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.45,
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
      },
    },
    {
      name: 'Refinement 06: Maximum Asymmetry (1.20x Vol, 52% Delta, 0.40 Body, 1.4R TP2, 0.10 ATR SL)',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: baseAnchors,
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
      },
    },
  ];

  const refinedResults: RefinedTestMetric[] = [];

  for (let i = 0; i < refinementConfigs.length; i++) {
    const t = refinementConfigs[i];
    const engine = new SweepReclaimEngine(t.config);

    // 1-Year Test
    const { setups: setupsY2 } = engine.scanHistoricalSetups(candlesY2);
    const tradesY2 = adaptSweepReclaimSetupsToTrades(setupsY2, { enforceSinglePositionWalk: true });
    const metrics = evaluateTrades(i + 1, t.name, t.config, tradesY2, setupsY2);

    // 2-Year Test
    const { setups: setups2Y } = engine.scanHistoricalSetups(candles2Y);
    const trades2Y = adaptSweepReclaimSetupsToTrades(setups2Y, { enforceSinglePositionWalk: true });
    let netR2Y = 0;
    let win2Y = 0;
    let loss2Y = 0;
    let gw2Y = 0;
    let gl2Y = 0;
    let peak2Y = 0;
    let curr2Y = 0;
    let maxDD2Y = 0;

    for (const tr of trades2Y) {
      netR2Y += tr.realizedR;
      if (tr.realizedR > 0) {
        win2Y++;
        gw2Y += tr.realizedR;
      } else if (tr.realizedR < 0) {
        loss2Y++;
        gl2Y += Math.abs(tr.realizedR);
      }
      curr2Y += tr.realizedR;
      if (curr2Y > peak2Y) peak2Y = curr2Y;
      const dd = peak2Y - curr2Y;
      if (dd > maxDD2Y) maxDD2Y = dd;
    }

    metrics.twoYearTotalTrades = trades2Y.length;
    metrics.twoYearNetR = parseFloat(netR2Y.toFixed(2));
    metrics.twoYearWinRatePct = parseFloat(((win2Y / (trades2Y.length || 1)) * 100).toFixed(1));
    metrics.twoYearPF = parseFloat((gl2Y > 0 ? gw2Y / gl2Y : 99.9).toFixed(2));
    metrics.twoYearMaxDDR = parseFloat(maxDD2Y.toFixed(2));

    refinedResults.push(metrics);

    console.log(
      `[Refinement ${String(i + 1).padStart(2, '0')}] ${t.name.padEnd(70)}`
    );
    console.log(
      `   ➔ 1-Year: Trades: ${metrics.totalTrades} | Win: ${metrics.winRatePct}% | Hard SL: ${metrics.slHitRatePct}% | Net R: +${metrics.netRealizedR}R | PF: ${metrics.profitFactor} | Max DD: -${metrics.maxDrawdownR}R`
    );
    console.log(
      `   ➔ 2-Year: Trades: ${metrics.twoYearTotalTrades} | Win: ${metrics.twoYearWinRatePct}% | Net R: +${metrics.twoYearNetR}R | PF: ${metrics.twoYearPF} | Max DD: -${metrics.twoYearMaxDDR}R\n`
    );
  }

  // Sort by composite score
  refinedResults.sort((a, b) => (b.twoYearNetR || 0) - (a.twoYearNetR || 0));

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('👑 REFINEMENT WINNER LEADERBOARD (SORTED BY 2-YEAR CUMULATIVE PROFIT)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('Rank | Refined Setup Name                                     | 1Y Net R | 1Y Win% | 1Y PF | 2Y Trades | 2Y Net R Gain | 2Y Win% | 2Y PF | 2Y Max DD');
  console.log('─────|────────────────────────────────────────────────────────|──────────|─────────|───────|───────────|───────────────|─────────|───────|──────────');
  refinedResults.forEach((r, idx) => {
    const badge = idx === 0 ? '👑 WINNER' : idx === 1 ? '🥈 RUNNER-UP' : idx === 2 ? '🥉 3RD PLACE' : ` #${idx + 1}`;
    console.log(
      `${badge.padEnd(10)} | ${r.name.padEnd(54)} | ${('+' + r.netRealizedR + 'R').padStart(8)} | ${(r.winRatePct + '%').padStart(7)} | ${r.profitFactor.toFixed(2).padStart(5)} | ${String(r.twoYearTotalTrades).padStart(9)} | ${('+' + r.twoYearNetR + 'R').padStart(13)} | ${(r.twoYearWinRatePct + '%').padStart(7)} | ${r.twoYearPF?.toFixed(2).padStart(5)} | ${('-' + r.twoYearMaxDDR + 'R').padStart(9)}`
    );
  });

  const outputJsonPath = path.resolve(process.cwd(), 'scratch', 'quant_lab_top3_refined_pm2_results.json');
  fs.writeFileSync(outputJsonPath, JSON.stringify(refinedResults, null, 2));
  console.log(`\nRefinement Results saved to ${outputJsonPath}\n`);
}

main().catch(console.error);
