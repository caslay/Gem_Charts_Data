import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades, StandardizedExecutedTrade } from '../src/lib/quantEngine/equityCalculator';

export interface TestResultMetric {
  id: number;
  name: string;
  config: SweepReclaimScanConfig;
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number;
  slHitRatePct: number;
  scratchRatePct: number;
  armorRatePct: number;
  netRealizedR: number;
  profitFactor: number;
  expectedValueR: number;
  maxDrawdownR: number;
  stage1FillRatePct: number;
  stage2FillRatePct: number;
  stage3FillRatePct: number;
  compositeScore: number;
}

function evaluateTrades(
  id: number,
  name: string,
  config: SweepReclaimScanConfig,
  executedTrades: StandardizedExecutedTrade[],
  rawSetups: SweepReclaimSetup[]
): TestResultMetric {
  let netR = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let wins = 0;
  let losses = 0;
  let scratches = 0;

  for (const t of executedTrades) {
    const r = t.realizedR;
    netR += r;
    if (r > 0) {
      wins++;
      grossWinR += r;
    } else if (r < 0) {
      losses++;
      grossLossR += Math.abs(r);
    } else {
      scratches++;
    }
  }

  const n = executedTrades.length;
  const winRate = n > 0 ? (wins / n) * 100 : 0;
  const slHitRate = n > 0 ? (losses / n) * 100 : 0;
  const scratchRate = n > 0 ? (scratches / n) * 100 : 0;
  const armorRate = winRate + scratchRate;
  const pf = grossLossR > 0 ? grossWinR / grossLossR : grossWinR > 0 ? 99.9 : 0;
  const ev = n > 0 ? netR / n : 0;

  // Max Drawdown calculation
  let peakR = 0;
  let currentR = 0;
  let maxDDR = 0;
  for (const t of executedTrades) {
    currentR += t.realizedR;
    if (currentR > peakR) peakR = currentR;
    const dd = peakR - currentR;
    if (dd > maxDDR) maxDDR = dd;
  }

  // Stage Fills from raw setups that were executed
  const executedSetupIds = new Set(executedTrades.map((t) => t.id));
  const matchedSetups = rawSetups.filter((s) => executedSetupIds.has(s.id));
  const stage1Count = matchedSetups.filter((s) => s.is_stage1_filled).length;
  const stage2Count = matchedSetups.filter((s) => s.is_stage2_filled).length;
  const stage3Count = matchedSetups.filter((s) => s.is_stage3_filled).length;

  const s1Pct = n > 0 ? (stage1Count / n) * 100 : 0;
  const s2Pct = n > 0 ? (stage2Count / n) * 100 : 0;
  const s3Pct = n > 0 ? (stage3Count / n) * 100 : 0;

  // Composite Institutional Rank Score:
  // Rewards Net R, High Profit Factor, High Win Rate, Low Hard SL Rate, Low Drawdown
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
    scratches,
    winRatePct: parseFloat(winRate.toFixed(1)),
    slHitRatePct: parseFloat(slHitRate.toFixed(1)),
    scratchRatePct: parseFloat(scratchRate.toFixed(1)),
    armorRatePct: parseFloat(armorRate.toFixed(1)),
    netRealizedR: parseFloat(netR.toFixed(2)),
    profitFactor: parseFloat(pf.toFixed(2)),
    expectedValueR: parseFloat(ev.toFixed(2)),
    maxDrawdownR: parseFloat(maxDDR.toFixed(2)),
    stage1FillRatePct: parseFloat(s1Pct.toFixed(1)),
    stage2FillRatePct: parseFloat(s2Pct.toFixed(1)),
    stage3FillRatePct: parseFloat(s3Pct.toFixed(1)),
    compositeScore: parseFloat(compositeScore.toFixed(2)),
  };
}

async function main() {
  const pathYear2 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_1year.json');
  const candles: Candle[] = JSON.parse(fs.readFileSync(pathYear2, 'utf8'));

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('🔬 20 QUANT LAB TEST MATRIX — RE-TESTING UNDER PM2 1:1 PARITY ADAPTER');
  console.log(`Evaluating across ${candles.length} continuous 5m candles (365.7 continuous trading days)...`);
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');

  const baseAnchors = ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'];

  // 20 Structured Test Configurations
  const testConfigs: { name: string; config: SweepReclaimScanConfig }[] = [
    // 1-4: Baseline & Entry Mode Variations (1.35x Vol, 52% Delta, 50% Body)
    {
      name: 'Test 01: Baseline FVG Proximal (1.0R / 1.5R / 3.0R)',
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
        volumeExpansionThreshold: 1.35,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.50,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.5,
        stage3Multiple: 3.0,
        entryMode: 'FVG_PROXIMAL',
        enableStructuralTrail: true,
        enableProfitRatchet: true,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.12,
      },
    },
    {
      name: 'Test 02: FVG Consequent Encroachment (50% CE Limit)',
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
        volumeExpansionThreshold: 1.35,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.50,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.5,
        stage3Multiple: 3.0,
        entryMode: 'FVG_CE',
        enableStructuralTrail: true,
        enableProfitRatchet: true,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.12,
      },
    },
    {
      name: 'Test 03: Order Block Mean Threshold (50% OB MT Limit)',
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
        volumeExpansionThreshold: 1.35,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.50,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.5,
        stage3Multiple: 3.0,
        entryMode: 'OB_MT',
        enableStructuralTrail: true,
        enableProfitRatchet: true,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.12,
      },
    },
    {
      name: 'Test 04: Reclaim Candle Close (Immediate Market Execution)',
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
        volumeExpansionThreshold: 1.35,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.50,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.5,
        stage3Multiple: 3.0,
        entryMode: 'RECLAIM_CLOSE',
        enableStructuralTrail: true,
        enableProfitRatchet: true,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.12,
      },
    },

    // 5-8: Target Multiples Variations (1.3R, 1.4R, 1.6R, 2.0R)
    {
      name: 'Test 05: FVG Proximal with 1.3R Target 2 (High Velocity)',
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
        volumeExpansionThreshold: 1.35,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.50,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.3,
        stage3Multiple: 3.0,
        entryMode: 'FVG_PROXIMAL',
        enableStructuralTrail: true,
        enableProfitRatchet: true,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.12,
      },
    },
    {
      name: 'Test 06: FVG Proximal with 1.4R Target 2 (Calibrated Sweet Spot)',
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
      },
    },
    {
      name: 'Test 07: FVG Proximal with 1.6R Target 2 (Macro Stretch)',
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
        volumeExpansionThreshold: 1.35,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.50,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.6,
        stage3Multiple: 3.0,
        entryMode: 'FVG_PROXIMAL',
        enableStructuralTrail: true,
        enableProfitRatchet: true,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.12,
      },
    },
    {
      name: 'Test 08: 2-Stage Simplified Model (50% @ 1.0R / 50% @ 2.0R)',
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
        volumeExpansionThreshold: 1.35,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.50,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 2.0,
        stage3Multiple: 3.0,
        entryMode: 'FVG_PROXIMAL',
        enableStructuralTrail: true,
        enableProfitRatchet: true,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.12,
      },
    },

    // 9-12: Volume Expansion Variations (1.20x, 1.50x, 1.75x, 2.00x)
    {
      name: 'Test 09: Ultra-Sensitive Volume Expansion (1.20x Vol)',
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
      name: 'Test 10: Strict Volume Expansion (1.50x Vol)',
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
        volumeExpansionThreshold: 1.50,
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
      name: 'Test 11: Institutional Climax Volume (1.75x Vol)',
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
        volumeExpansionThreshold: 1.75,
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
      name: 'Test 12: Ultra-Strict Institutional Climax (2.00x Vol)',
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
        volumeExpansionThreshold: 2.00,
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

    // 13-16: Delta Dominance & Body Ratio Variations
    {
      name: 'Test 13: Neutral Delta Gate (50.0% Taker Delta)',
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
        volumeExpansionThreshold: 1.35,
        deltaDominanceThreshold: 50.0,
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
      name: 'Test 14: Strong Aggressive Delta (55.0% Taker Delta)',
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
        volumeExpansionThreshold: 1.35,
        deltaDominanceThreshold: 55.0,
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
      name: 'Test 15: High Body Conviction (0.60 Body Ratio)',
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
        volumeExpansionThreshold: 1.35,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.60,
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
      name: 'Test 16: Relaxed Body Ratio (0.40 Body Ratio)',
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
        volumeExpansionThreshold: 1.35,
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
        slBufferAtrMultiplier: 0.12,
      },
    },

    // 17-20: Lookbacks, Valuation Gate & Stop Loss Variations
    {
      name: 'Test 17: Extended Anchor Lookbacks (Major 15 / Internal 7)',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: baseAnchors,
        lookbackMajor: 15,
        lookbackInternal: 7,
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
      },
    },
    {
      name: 'Test 18: Unfiltered Dealing Range (Valuation Gate OFF)',
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
        volumeExpansionThreshold: 1.35,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.50,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: false, // Valuation Gate OFF
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
      name: 'Test 19: Tight Stop Buffer (0.08 ATR SL Buffer)',
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
        slBufferAtrMultiplier: 0.08, // Tighter Buffer
      },
    },
    {
      name: 'Test 20: Wide Protective Stop Buffer (0.18 ATR SL Buffer)',
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
        slBufferAtrMultiplier: 0.18, // Wider Buffer
      },
    },
  ];

  const results: TestResultMetric[] = [];

  for (let i = 0; i < testConfigs.length; i++) {
    const t = testConfigs[i];
    const engine = new SweepReclaimEngine(t.config);
    const { setups } = engine.scanHistoricalSetups(candles);

    // Apply strict PM2 1:1 Parity Single-Position Walk
    const executedTrades = adaptSweepReclaimSetupsToTrades(setups, { enforceSinglePositionWalk: true });
    const metrics = evaluateTrades(i + 1, t.name, t.config, executedTrades, setups);
    results.push(metrics);

    console.log(
      `[Test ${String(i + 1).padStart(2, '0')}] ${t.name.padEnd(65)} ➔ Trades: ${String(metrics.totalTrades).padStart(4)} | Win: ${metrics.winRatePct}% | Hard SL: ${metrics.slHitRatePct}% | Net R: +${metrics.netRealizedR}R | PF: ${metrics.profitFactor} | Max DD: -${metrics.maxDrawdownR}R`
    );
  }

  // Sort by Composite Rank Score (Net Profit + High PF + High Win Rate + Low SL)
  const ranked = [...results].sort((a, b) => b.compositeScore - a.compositeScore);

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('🏆 20 QUANT LAB TESTS — FINAL RANKING LEADERBOARD (SORTED BY COMPOSITE SCORE)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('Rank | Test ID & Configuration Name                           | Trades | Win Rate | Hard SL % | Net R Gain  | Profit Factor | EV / Trade | Max DD | Score');
  console.log('─────|────────────────────────────────────────────────────────|────────|──────────|───────────|─────────────|───────────────|────────────|────────|───────');
  ranked.forEach((r, idx) => {
    const badge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${String(idx + 1).padStart(2)}`;
    console.log(
      `${badge.padEnd(4)} | [Test ${String(r.id).padStart(2, '0')}] ${r.name.padEnd(48)} | ${String(r.totalTrades).padStart(6)} | ${(r.winRatePct.toFixed(1) + '%').padStart(8)} | ${(r.slHitRatePct.toFixed(1) + '%').padStart(9)} | ${(r.netRealizedR > 0 ? '+' : '') + (r.netRealizedR.toFixed(1) + 'R').padStart(11)} | ${r.profitFactor.toFixed(2).padStart(13)} | ${(r.expectedValueR > 0 ? '+' : '') + (r.expectedValueR.toFixed(2) + 'R').padStart(10)} | ${('-' + r.maxDrawdownR.toFixed(2) + 'R').padStart(6)} | ${r.compositeScore.toFixed(1).padStart(6)}`
    );
  });

  const outputJsonPath = path.resolve(process.cwd(), 'scratch', 'quant_lab_20_pm2_tests_results.json');
  fs.writeFileSync(outputJsonPath, JSON.stringify(ranked, null, 2));
  console.log(`\n20 Quant Lab PM2 Test Results saved to ${outputJsonPath}\n`);
}

main().catch(console.error);
