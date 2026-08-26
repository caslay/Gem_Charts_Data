import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimAnchorType,
  SweepReclaimEntryMode,
  SweepReclaimTelemetrySummary,
  SweepReclaimSetup
} from '../src/lib/quantEngine/SweepReclaimEngine';

interface TestPresetDefinition {
  id: number;
  name: string;
  category: string;
  config: SweepReclaimScanConfig;
}

interface TestResultMetrics {
  id: number;
  name: string;
  category: string;
  config: SweepReclaimScanConfig;
  totalAnchors: number;
  totalSweeps: number;
  totalReclaims: number;
  totalRetests: number;
  winningTrades: number;
  losingTrades: number;
  beScratches: number;
  structuralScratches: number;
  stoppedOutCount: number;
  reclaimRatePct: number;
  retestRatePct: number;
  retestWinRatePct: number;
  slHitRatePct: number;
  avgRealizedRr: number;
  profitFactor: number;
  expectedValueR: number;
  netRealizedR: number;
  avgWinningRr: number;
  avgLosingRr: number;
  avgMfeR: number;
  avgMaeR: number;
  stage1Fills: number;
  stage2Fills: number;
  stage3Fills: number;
  bullishWinRatePct: number;
  bearishWinRatePct: number;
  bullishTrades: number;
  bearishTrades: number;
}

const ALL_ANCHORS: SweepReclaimAnchorType[] = [
  'SWING_PIVOT',
  'ASIAN_HIGH',
  'ASIAN_LOW',
  'LONDON_HIGH',
  'LONDON_LOW',
  'PDH',
  'PDL',
];

const SESSION_AND_PIVOT_ANCHORS: SweepReclaimAnchorType[] = [
  'SWING_PIVOT',
  'ASIAN_HIGH',
  'ASIAN_LOW',
  'LONDON_HIGH',
  'LONDON_LOW',
];

const SESSION_AND_DAILY_ANCHORS: SweepReclaimAnchorType[] = [
  'ASIAN_HIGH',
  'ASIAN_LOW',
  'LONDON_HIGH',
  'LONDON_LOW',
  'PDH',
  'PDL',
];

const SESSION_ONLY_ANCHORS: SweepReclaimAnchorType[] = [
  'ASIAN_HIGH',
  'ASIAN_LOW',
  'LONDON_HIGH',
  'LONDON_LOW',
];

const PIVOT_ONLY_ANCHORS: SweepReclaimAnchorType[] = ['SWING_PIVOT'];

const TEST_DEFINITIONS: TestPresetDefinition[] = [
  {
    id: 1,
    name: 'Platform Baseline (5m Golden Sweep OB MT)',
    category: 'Baseline Models',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 3.0,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    },
  },
  {
    id: 2,
    name: 'High-Velocity Displacement FVG 50% CE Scalper',
    category: 'FVG Retest Models',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: SESSION_AND_PIVOT_ANCHORS,
      lookbackMajor: 10,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 20,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 3.0,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    },
  },
  {
    id: 3,
    name: 'Ultra-Strict 3-Pillar Institutional Sniper (OB MT)',
    category: 'Displacement Filter Variants',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 35,
      maxBarsSweepToReclaim: 14,
      maxBarsToRetest: 30,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.80,
      deltaDominanceThreshold: 65.0,
      bodyRatioThreshold: 0.65,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 2.0,
      stage3Multiple: 4.0,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.12,
      slBufferAtrMultiplier: 0.20,
    },
  },
  {
    id: 4,
    name: 'Ultra-Strict 3-Pillar Institutional Sniper (FVG CE)',
    category: 'Displacement Filter Variants',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 35,
      maxBarsSweepToReclaim: 14,
      maxBarsToRetest: 30,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.80,
      deltaDominanceThreshold: 65.0,
      bodyRatioThreshold: 0.65,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 2.0,
      stage3Multiple: 4.0,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.12,
      slBufferAtrMultiplier: 0.20,
    },
  },
  {
    id: 5,
    name: 'Reclaimed Anchor Shelf Breakout (Direct Defense)',
    category: 'Entry Routing Models',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.4,
      stage3Multiple: 2.8,
      entryMode: 'SHELF_LEVEL',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    },
  },
  {
    id: 6,
    name: 'Deep Retracement 62% OTE Fibonacci Model',
    category: 'Entry Routing Models',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.60,
      deltaDominanceThreshold: 60.0,
      bodyRatioThreshold: 0.60,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.8,
      stage3Multiple: 3.5,
      entryMode: 'OTE_62',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    },
  },
  {
    id: 7,
    name: 'Displacement FVG Proximal Edge (Early Fill)',
    category: 'Entry Routing Models',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 3.0,
      entryMode: 'FVG_PROXIMAL',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    },
  },
  {
    id: 8,
    name: 'Displacement FVG Distal Edge (Deep Invalidation Buffer)',
    category: 'Entry Routing Models',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.6,
      stage3Multiple: 3.2,
      entryMode: 'FVG_DISTAL',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.12,
    },
  },
  {
    id: 9,
    name: 'Sweep OB Proximal Boundary Model',
    category: 'Entry Routing Models',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 3.0,
      entryMode: 'OB_PROXIMAL',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    },
  },
  {
    id: 10,
    name: 'Session Extrema Only (Asian & London Liquidity Purge)',
    category: 'Anchor Source Profiles',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: SESSION_ONLY_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 35,
      maxBarsSweepToReclaim: 14,
      maxBarsToRetest: 28,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 3.0,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    },
  },
  {
    id: 11,
    name: 'Session + Daily PDH/PDL Macro Liquidity Specialist',
    category: 'Anchor Source Profiles',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: SESSION_AND_DAILY_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 35,
      maxBarsSweepToReclaim: 14,
      maxBarsToRetest: 28,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.60,
      deltaDominanceThreshold: 58.0,
      bodyRatioThreshold: 0.58,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.6,
      stage3Multiple: 3.2,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    },
  },
  {
    id: 12,
    name: 'Pure Structural Major Pivots Only (Trend Reversal)',
    category: 'Anchor Source Profiles',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: PIVOT_ONLY_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 3.0,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    },
  },
  {
    id: 13,
    name: 'High-Delta Aggression Sniper (68% Taker Dominance)',
    category: 'Displacement Filter Variants',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.40,
      deltaDominanceThreshold: 68.0,
      bodyRatioThreshold: 0.60,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.7,
      stage3Multiple: 3.5,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.18,
    },
  },
  {
    id: 14,
    name: 'Tight Scalp Fast-Harvest Model (1.0R / 1.3R / 2.2R)',
    category: 'Risk & Harvest Scaling',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 12,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 8,
      maxBarsToRetest: 15,
      volumeSmaPeriod: 14,
      volumeExpansionThreshold: 1.45,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.3,
      stage3Multiple: 2.2,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.08,
      slBufferAtrMultiplier: 0.10,
    },
  },
  {
    id: 15,
    name: 'Wide Macro Swing Runner Model (1.0R / 2.0R / 4.5R)',
    category: 'Risk & Harvest Scaling',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 20,
      lookbackInternal: 6,
      maxBarsAnchorToSweep: 40,
      maxBarsSweepToReclaim: 16,
      maxBarsToRetest: 36,
      volumeSmaPeriod: 25,
      volumeExpansionThreshold: 1.65,
      deltaDominanceThreshold: 60.0,
      bodyRatioThreshold: 0.60,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 2.0,
      stage3Multiple: 4.5,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.15,
      slBufferAtrMultiplier: 0.22,
    },
  },
  {
    id: 16,
    name: 'Relaxed Volumetric Filter (High-Frequency Probe)',
    category: 'Displacement Filter Variants',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.25,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.45,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 3.0,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.08,
      slBufferAtrMultiplier: 0.15,
    },
  },
  {
    id: 17,
    name: 'Strict Volatility-Protected Stop (0.25x ATR Buffer)',
    category: 'Risk & Harvest Scaling',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 3.0,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.15,
      slBufferAtrMultiplier: 0.25,
    },
  },
  {
    id: 18,
    name: 'Dual-Anchor Session Sniper with FVG 50% CE Retest',
    category: 'Combined Synergy Models',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: SESSION_AND_DAILY_ANCHORS,
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.65,
      deltaDominanceThreshold: 60.0,
      bodyRatioThreshold: 0.60,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.6,
      stage3Multiple: 3.2,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.16,
    },
  },
  {
    id: 19,
    name: 'Fast Pivot Lookback Scalper (8 Major / 4 Internal)',
    category: 'Structural Timing Variants',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 8,
      lookbackInternal: 4,
      maxBarsAnchorToSweep: 20,
      maxBarsSweepToReclaim: 8,
      maxBarsToRetest: 16,
      volumeSmaPeriod: 14,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 3.0,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    },
  },
  {
    id: 20,
    name: 'Deep Structural Swing Anchor (25 Major / 10 Internal)',
    category: 'Structural Timing Variants',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ALL_ANCHORS,
      lookbackMajor: 25,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 45,
      maxBarsSweepToReclaim: 15,
      maxBarsToRetest: 30,
      volumeSmaPeriod: 25,
      volumeExpansionThreshold: 1.55,
      deltaDominanceThreshold: 58.0,
      bodyRatioThreshold: 0.58,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.7,
      stage3Multiple: 3.5,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.12,
      slBufferAtrMultiplier: 0.18,
    },
  },
];

async function main() {
  const cachePath = path.join(__dirname, 'candles_5m_ethusdc.json');
  if (!fs.existsSync(cachePath)) {
    console.error(`Dataset not found at ${cachePath}. Run download script first.`);
    process.exit(1);
  }

  console.log(`Loading 5m historical candlestick dataset from ${cachePath}...`);
  const rawData = fs.readFileSync(cachePath, 'utf8');
  const candles: Candle[] = JSON.parse(rawData);
  console.log(`Successfully loaded ${candles.length} candles (Date range: ${new Date(candles[0].t).toISOString().slice(0, 10)} to ${new Date(candles[candles.length - 1].t).toISOString().slice(0, 10)})\n`);

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('🚀 EXECUTING 20 QUANT LAB BACKTEST SUITE FOR "SWEEP & RECLAIM STRATEGY" (5M TIMEFRAME)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');

  const results: TestResultMetrics[] = [];

  for (const t of TEST_DEFINITIONS) {
    const startTime = Date.now();
    const engine = new SweepReclaimEngine(t.config);
    const { setups, telemetry } = engine.scanHistoricalSetups(candles);
    const elapsed = Date.now() - startTime;

    // Filter executed retest trades
    const executedTrades = setups.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');
    const stoppedOut = executedTrades.filter((s) => s.simulated_outcome === 'STOPPED_OUT').length;
    const totalExecuted = executedTrades.length;
    const slHitRate = totalExecuted > 0 ? parseFloat(((stoppedOut / totalExecuted) * 100).toFixed(2)) : 0;

    let netR = 0;
    for (const trade of executedTrades) {
      netR += trade.realized_rr;
    }
    netR = parseFloat(netR.toFixed(2));

    const metric: TestResultMetrics = {
      id: t.id,
      name: t.name,
      category: t.category,
      config: t.config,
      totalAnchors: telemetry.total_anchors_detected,
      totalSweeps: telemetry.total_sweeps_detected,
      totalReclaims: telemetry.total_reclaims_confirmed,
      totalRetests: telemetry.total_retests_executed,
      winningTrades: telemetry.total_winning_trades,
      losingTrades: telemetry.total_losing_trades,
      beScratches: telemetry.total_be_scratches,
      structuralScratches: telemetry.total_structural_scratches,
      stoppedOutCount: stoppedOut,
      reclaimRatePct: telemetry.reclaim_rate_pct,
      retestRatePct: telemetry.retest_rate_pct,
      retestWinRatePct: telemetry.retest_win_rate_pct,
      slHitRatePct: slHitRate,
      avgRealizedRr: telemetry.avg_realized_rr,
      profitFactor: telemetry.profit_factor,
      expectedValueR: telemetry.expected_value_r,
      netRealizedR: netR,
      avgWinningRr: telemetry.avg_winning_rr,
      avgLosingRr: telemetry.avg_losing_rr,
      avgMfeR: telemetry.avg_mfe_r,
      avgMaeR: telemetry.avg_mae_r,
      stage1Fills: telemetry.stage1_fill_count,
      stage2Fills: telemetry.stage2_fill_count,
      stage3Fills: telemetry.stage3_fill_count,
      bullishWinRatePct: telemetry.bullish_win_rate_pct,
      bearishWinRatePct: telemetry.bearish_win_rate_pct,
      bullishTrades: telemetry.bullish_retest_count,
      bearishTrades: telemetry.bearish_retest_count,
    };

    results.push(metric);

    console.log(
      `[Test ${String(t.id).padStart(2, '0')}] ${t.name.padEnd(52)} | Trades: ${String(totalExecuted).padStart(3)} | WinRate: ${(metric.retestWinRatePct.toFixed(1) + '%').padStart(6)} | Net R: ${(metric.netRealizedR > 0 ? '+' : '') + metric.netRealizedR.toFixed(1) + 'R'} | PF: ${metric.profitFactor.toFixed(2)} | SL Hit: ${metric.slHitRatePct.toFixed(1)}% | (${elapsed}ms)`
    );
  }

  // Save all results to scratch JSON
  const outputPath = path.join(__dirname, 'quant_lab_20_tests_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nAll 20 test results saved to ${outputPath}\n`);

  // Ranking by Multi-Metric Score:
  // We want: High Profits (Net R, Win Rate, Profit Factor) AND Low SL Hit Rate
  // Composite Institutional Score = (Net R * 0.4) + (Win Rate * 0.3) + (Profit Factor * 15) - (SL Hit Rate * 0.3)
  const ranked = [...results].sort((a, b) => {
    // Primary sort: Net Realized R, secondary: Profit Factor, tertiary: lowest SL hit rate
    if (b.netRealizedR !== a.netRealizedR) {
      return b.netRealizedR - a.netRealizedR;
    }
    return b.profitFactor - a.profitFactor;
  });

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('🏆 20-TEST LEADERBOARD (RANKED BY NET PROFIT R & PROFIT FACTOR)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(
    'Rank | Test ID | Name                                                 | Trades | Win Rate | Net R Gain  | Profit Factor | SL Hit % | Avg R/Trade'
  );
  console.log('───────────────────────────────────────────────────────────────────────────────────────────────');

  ranked.forEach((r, idx) => {
    console.log(
      `#${String(idx + 1).padStart(2)}  | Test ${String(r.id).padStart(2)} | ${r.name.padEnd(52)} | ${String(r.totalRetests).padStart(6)} | ${(r.retestWinRatePct.toFixed(1) + '%').padStart(8)} | ${(r.netRealizedR > 0 ? '+' : '') + (r.netRealizedR.toFixed(1) + 'R').padStart(10)} | ${r.profitFactor.toFixed(2).padStart(13)} | ${(r.slHitRatePct.toFixed(1) + '%').padStart(8)} | ${(r.avgRealizedRr > 0 ? '+' : '') + r.avgRealizedRr.toFixed(2) + 'R'}`
    );
  });

  console.log('───────────────────────────────────────────────────────────────────────────────────────────────\n');

  // Display top 3
  console.log('🌟 TOP 3 INITIAL LEADING SETUPS:');
  for (let i = 0; i < 3; i++) {
    const top = ranked[i];
    console.log(`\n[RANK #${i + 1}] Test ${top.id}: ${top.name}`);
    console.log(`  • Net Realized R:      ${top.netRealizedR > 0 ? '+' : ''}${top.netRealizedR}R across ${top.totalRetests} executed setups`);
    console.log(`  • Retest Win Rate:     ${top.retestWinRatePct}% (${top.winningTrades}W / ${top.losingTrades}L / ${top.beScratches} BE Scratches)`);
    console.log(`  • Stop Loss Hit Rate:  ${top.slHitRatePct}% (${top.stoppedOutCount} hard stops out of ${top.totalRetests})`);
    console.log(`  • Profit Factor:       ${top.profitFactor}`);
    console.log(`  • Expected Value:      ${top.expectedValueR > 0 ? '+' : ''}${top.expectedValueR}R per trade`);
    console.log(`  • Entry Routing Mode:  ${top.config.entryMode}`);
    console.log(`  • 3-Pillar Thresholds: Vol: ${top.config.volumeExpansionThreshold}x, Delta: ${top.config.deltaDominanceThreshold}%, Body: ${top.config.bodyRatioThreshold}`);
    console.log(`  • Multiples:           Stage 1: ${top.config.stage1Multiple}R, Stage 2: ${top.config.stage2Multiple}R, Stage 3: ${top.config.stage3Multiple}R`);
  }
}

main().catch(console.error);
