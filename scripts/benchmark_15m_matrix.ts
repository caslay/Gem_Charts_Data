import * as fs from 'fs';
import * as path from 'path';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimAnchorType,
  SweepReclaimEntryMode,
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';
import {
  calculate1to1ExecutionTelemetry,
  calculateCompoundingMetrics,
  StandardizedExecutedTrade,
} from '../src/lib/quantEngine/equityCalculator';
import { computeStructuralBootstrap } from '../src/lib/quantEngine/structuralBootstrap';
import { FACTORY_SWEEP_RECLAIM_PRESETS, SweepReclaimPresetConfig } from '../src/lib/quantEngine/scannerPresets';

export interface BenchmarkConfig {
  id: string;
  name: string;
  scenario: 'A_CONSERVATIVE' | 'B_ASYMMETRIC' | 'CHAMPION_15M' | 'BASELINE_5M';
  timeframe: '5m' | '15m';
  entryMode: SweepReclaimEntryMode;
  stage1Ratio: number;
  stage1Multiple: number;
  stage2Ratio: number;
  stage2Multiple: number;
  stage3Ratio?: number;
  stage3Multiple?: number;
  earlyBreakeven: boolean;
  earlyBreakevenMultiple: number;
  enableFeePaddedBreakeven: boolean;
  breakevenOffsetPct: number;
  postLossCooldownMinutes: number;
  volExpansion: number;
  bodyRatio: number;
  deltaDominance: number;
  lookbackMajor: number;
  lookbackInternal: number;
  maxBarsAnchorToSweep: number;
  maxBarsSweepToReclaim: number;
  maxBarsToRetest: number;
  anchorTypes: SweepReclaimAnchorType[];
  filterDeadZones: boolean;
}

export interface DetailedBenchmarkTelemetry {
  id: string;
  name: string;
  scenario: string;
  timeframe: string;
  entryMode: string;
  horizon: '90D' | '1Y';
  totalExecutedTrades: number;
  winningTrades: number;
  losingTrades: number;
  beScratches: number;
  fullWins: number;
  stage1PartialScratches: number;
  pureScratches: number;
  winRatePct: number;
  winRateExScratchPct: number;
  scratchRatePct: number;
  grossRealizedR: number;
  totalFeesPaidR: number;
  totalFeesPaidUsd: number;
  netRealizedR: number;
  profitFactor: number;
  grossProfitFactor: number;
  netProfitFactor: number;
  maxDrawdownR: number;
  maxDrawdownPct: number;
  initialEquity: number;
  finalEquity: number;
  netPnlUsd: number;
  netRoiPct: number;
}

// ── Cache / Fetch Candle Helpers ─────────────────────────────────────────────

async function loadOrFetch15mCandles(warmupStartMs: number, endMs: number): Promise<Candle[]> {
  const scratchDir = path.join(process.cwd(), 'scratch');
  const files = fs.readdirSync(scratchDir);
  const cache15m = files.find((f) => f.startsWith('cached_ETHUSDC_15m_') && f.endsWith('.json'));

  if (cache15m) {
    const fullPath = path.join(scratchDir, cache15m);
    console.log(`📂 Loading cached 15m dataset: ${cache15m}...`);
    const allCandles: Candle[] = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    console.log(`✅ Loaded ${allCandles.length.toLocaleString()} 15m candles from cache.`);
    return allCandles.filter((c) => c.t >= warmupStartMs && c.t <= endMs);
  }

  console.log(`🌐 Fetching 15m candles from Binance Futures (${new Date(warmupStartMs).toISOString()} to ${new Date(endMs).toISOString()})...`);
  const allKlines: Candle[] = [];
  let currentStart = warmupStartMs;
  const limit = 1000;
  const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/klines';

  while (currentStart < endMs) {
    const url = `${BINANCE_REST}?symbol=ETHUSDC&interval=15m&startTime=${currentStart}&endTime=${endMs - 1}&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn(`Fetch error: ${res.status}`);
      break;
    }
    const raw: any[][] = await res.json();
    if (!raw || raw.length === 0) break;

    const parsed: Candle[] = raw.map((k) => ({
      t: Number(k[0]),
      o: parseFloat(k[1]),
      h: parseFloat(k[2]),
      l: parseFloat(k[3]),
      c: parseFloat(k[4]),
      v: parseFloat(k[5]),
      takerBuyBaseAssetVolume: parseFloat(k[9]),
      takerBuyQuoteAssetVolume: parseFloat(k[10]),
      numberOfTrades: Number(k[8]),
    }));
    allKlines.push(...parsed);

    const lastTime = Number(raw[raw.length - 1][0]);
    if (lastTime <= currentStart) break;
    currentStart = lastTime + 1;
    if (raw.length < limit) break;
    await new Promise((r) => setTimeout(r, 40));
  }

  console.log(`✅ Fetched ${allKlines.length} 15m candles.`);
  return allKlines;
}

async function loadOrFetch5mCandles(warmupStartMs: number, endMs: number): Promise<Candle[]> {
  const scratchDir = path.join(process.cwd(), 'scratch');
  const files = fs.readdirSync(scratchDir);
  const cache5m = files.find((f) => f.startsWith('cached_ETHUSDC_5m_1y_') && f.endsWith('.json'));

  if (cache5m) {
    const fullPath = path.join(scratchDir, cache5m);
    console.log(`📂 Loading cached 5m dataset: ${cache5m}...`);
    const allCandles: Candle[] = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    console.log(`✅ Loaded ${allCandles.length.toLocaleString()} 5m candles from cache.`);
    return allCandles.filter((c) => c.t >= warmupStartMs && c.t <= endMs);
  }

  console.log(`🌐 Fetching 5m candles from Binance Futures...`);
  const allKlines: Candle[] = [];
  let currentStart = warmupStartMs;
  const limit = 1000;
  const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/klines';

  while (currentStart < endMs) {
    const url = `${BINANCE_REST}?symbol=ETHUSDC&interval=5m&startTime=${currentStart}&endTime=${endMs - 1}&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn(`Fetch error: ${res.status}`);
      break;
    }
    const raw: any[][] = await res.json();
    if (!raw || raw.length === 0) break;

    const parsed: Candle[] = raw.map((k) => ({
      t: Number(k[0]),
      o: parseFloat(k[1]),
      h: parseFloat(k[2]),
      l: parseFloat(k[3]),
      c: parseFloat(k[4]),
      v: parseFloat(k[5]),
      takerBuyBaseAssetVolume: parseFloat(k[9]),
      takerBuyQuoteAssetVolume: parseFloat(k[10]),
      numberOfTrades: Number(k[8]),
    }));
    allKlines.push(...parsed);

    const lastTime = Number(raw[raw.length - 1][0]);
    if (lastTime <= currentStart) break;
    currentStart = lastTime + 1;
    if (raw.length < limit) break;
    await new Promise((r) => setTimeout(r, 40));
  }

  console.log(`✅ Fetched ${allKlines.length} 5m candles.`);
  return allKlines;
}

// ── Single Backtest Runner ───────────────────────────────────────────────────

async function runSingleBacktest(
  candles: Candle[],
  bootstrap: any,
  cfg: BenchmarkConfig,
  horizon: '90D' | '1Y',
  initialCapital = 10000,
  riskPct = 2.0
): Promise<DetailedBenchmarkTelemetry> {
  const scanConfig: SweepReclaimScanConfig = {
    symbol: 'ETHUSDC',
    timeframe: cfg.timeframe,
    anchorTypes: cfg.anchorTypes,
    suppressInternalPivots: false,
    lookbackMajor: cfg.lookbackMajor,
    lookbackInternal: cfg.lookbackInternal,
    maxBarsAnchorToSweep: cfg.maxBarsAnchorToSweep,
    maxBarsSweepToReclaim: cfg.maxBarsSweepToReclaim,
    maxBarsToRetest: cfg.maxBarsToRetest,
    volumeSmaPeriod: 20,
    volumeExpansionThreshold: cfg.volExpansion,
    deltaDominanceThreshold: cfg.deltaDominance,
    bodyRatioThreshold: cfg.bodyRatio,
    minBodyRatio: cfg.bodyRatio,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
    enableRegimeAdaptiveEQ: true,
    enableInScannerWaveDedup: true,
    enforceSinglePositionConcurrency: true,
    pullbackExcursionThreshold: 0.5,
    stage1Multiple: cfg.stage1Multiple,
    stage2Multiple: cfg.stage2Multiple,
    stage3Multiple: cfg.stage3Multiple ?? 0.0,
    stage1Ratio: cfg.stage1Ratio,
    stage2Ratio: cfg.stage2Ratio,
    stage3Ratio: cfg.stage3Ratio ?? 0.0,
    entryMode: cfg.entryMode,
    enableStructuralTrail: true,
    enableProfitRatchet: false,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.10,
    enableWaveDeduplication: true,
    filterWeekend: false,
    filterDeadZones: cfg.filterDeadZones,
    enforceHtfBiasGuard: false,
    enableEarlyBreakeven: cfg.earlyBreakeven,
    earlyBreakevenMultiple: cfg.earlyBreakevenMultiple,
    enableFeePaddedBreakeven: cfg.enableFeePaddedBreakeven,
    breakevenOffsetPct: cfg.breakevenOffsetPct,
    postLossCooldownMinutes: cfg.postLossCooldownMinutes,
    targetMode: 'FIXED_RR',
    requireMssConfirmation: false,
    makerFeePct: 0.0,
    takerFeePct: 0.04,
  };

  const engine = new SweepReclaimEngine(scanConfig);
  const { setups } = engine.scanHistoricalSetups(candles, bootstrap);

  const summary = calculate1to1ExecutionTelemetry(setups, {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: true,
    filterWeekend: false,
    filterDeadZones: cfg.filterDeadZones,
    enforceHtfBiasGuard: false,
    enableEarlyBreakeven: cfg.earlyBreakeven,
    earlyBreakevenMultiple: cfg.earlyBreakevenMultiple,
    enableFeePaddedBreakeven: cfg.enableFeePaddedBreakeven,
    breakevenOffsetPct: cfg.breakevenOffsetPct,
    postLossCooldownMinutes: cfg.postLossCooldownMinutes,
    makerFeePct: 0.0,
    takerFeePct: 0.04,
  });

  const compounding = calculateCompoundingMetrics(summary.executedTrades, {
    initialCapital,
    riskPerTradePct: riskPct,
    compoundingMode: 'DYNAMIC_COMPOUNDING',
    makerFeePct: 0.0,
    takerFeePct: 0.04,
  });

  // Detailed harvest breakdown
  let fullWins = 0;
  let stage1PartialScratches = 0;
  let pureScratches = 0;
  let losingTrades = 0;

  for (const t of summary.executedTrades) {
    if (t.outcome === 'FULL_TP2_WIN' || t.outcome === 'FULL_TP3_WIN') {
      fullWins++;
    } else if (t.outcome === 'STAGE_1_SCRATCH' || (t.realizedR > 0 && t.metadata?.isStage1Filled && !t.metadata?.isStage2Filled)) {
      stage1PartialScratches++;
    } else if (t.realizedR === 0 || t.outcome === 'BE_SCRATCH_WIN') {
      pureScratches++;
    } else if (t.realizedR < 0 || t.outcome === 'STOPPED_OUT') {
      losingTrades++;
    }
  }

  const winningTrades = fullWins + stage1PartialScratches;
  const beScratches = pureScratches;

  return {
    id: cfg.id,
    name: cfg.name,
    scenario: cfg.scenario,
    timeframe: cfg.timeframe,
    entryMode: cfg.entryMode,
    horizon,
    totalExecutedTrades: summary.totalExecutedTrades,
    winningTrades: summary.totalWinningTrades,
    losingTrades: summary.totalLosingTrades,
    beScratches: summary.totalBeScratches,
    fullWins,
    stage1PartialScratches,
    pureScratches,
    winRatePct: summary.executionWinRatePct,
    winRateExScratchPct: summary.winRateExScratchPct,
    scratchRatePct: summary.scratchRatePct ?? 0,
    grossRealizedR: summary.grossRealizedR ?? summary.totalRealizedR,
    totalFeesPaidR: summary.totalFeesPaidR ?? 0,
    totalFeesPaidUsd: compounding.totalFeesPaidUsd,
    netRealizedR: summary.netRealizedR ?? summary.totalRealizedR,
    profitFactor: summary.profitFactor,
    grossProfitFactor: summary.grossProfitFactor ?? summary.profitFactor,
    netProfitFactor: summary.netProfitFactor ?? summary.profitFactor,
    maxDrawdownR: summary.maxDrawdownR,
    maxDrawdownPct: compounding.maxDrawdownPct,
    initialEquity: initialCapital,
    finalEquity: compounding.finalRealizedEquity,
    netPnlUsd: compounding.realizedNetPnlUsd,
    netRoiPct: compounding.realizedNetRoiPct,
  };
}

// ── Main Execution ───────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(110));
  console.log('🔬 15m SWEEP & RECLAIM QUANTITATIVE BENCHMARK & STRESS TEST SUITE (STRICT 1:1 PARITY)');
  console.log('═'.repeat(110));

  // Anchor Universe per original task
  const anchors15m: SweepReclaimAnchorType[] = [
    'SWING_PIVOT',
    'PDH',
    'PDL',
    'ASIAN_HIGH',
    'ASIAN_LOW',
    'LONDON_HIGH',
    'LONDON_LOW',
  ];

  const anchors5mChampion: SweepReclaimAnchorType[] = [
    'SWING_PIVOT',
    'PDH',
    'PDL',
    'ASIAN_HIGH',
    'ASIAN_LOW',
  ];

  // Configurations
  const configs: BenchmarkConfig[] = [
    // 0A. 5m Baseline Champion V3
    {
      id: 'CTRL_5M_CHAMPION_V3',
      name: '5m Champion Baseline V3 (factory_sr_5m_fvg_ce_sniper_v3)',
      scenario: 'BASELINE_5M',
      timeframe: '5m',
      entryMode: 'FVG_CE',
      stage1Ratio: 0.60,
      stage1Multiple: 1.0,
      stage2Ratio: 0.40,
      stage2Multiple: 1.30,
      earlyBreakeven: true,
      earlyBreakevenMultiple: 0.40,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      postLossCooldownMinutes: 0,
      volExpansion: 1.10,
      bodyRatio: 0.40,
      deltaDominance: 52.0,
      lookbackMajor: 10,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 15,
      anchorTypes: anchors5mChampion,
      filterDeadZones: false,
    },
    // 0B. 15m Macro Champion V1
    {
      id: 'CTRL_15M_MACRO_CHAMPION_V1',
      name: '15m Macro Champion V1 (factory_sr_15m_macro_sniper_v1)',
      scenario: 'CHAMPION_15M',
      timeframe: '15m',
      entryMode: 'FVG_CE',
      stage1Ratio: 0.70,
      stage1Multiple: 1.0,
      stage2Ratio: 0.30,
      stage2Multiple: 1.35,
      earlyBreakeven: true,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      postLossCooldownMinutes: 0,
      volExpansion: 1.10,
      bodyRatio: 0.40,
      deltaDominance: 52.0,
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      anchorTypes: anchors15m,
      filterDeadZones: true,
    },
    // Scenario A1: Conservative FVG_CE (Pure TP1 Breakeven)
    {
      id: '15M_SCEN_A1_FVG_CE_PURE_BE',
      name: '15m Scen A1: Conservative FVG_CE (70/30 @ 1.0/1.35, Pure TP1 BE)',
      scenario: 'A_CONSERVATIVE',
      timeframe: '15m',
      entryMode: 'FVG_CE',
      stage1Ratio: 0.70,
      stage1Multiple: 1.0,
      stage2Ratio: 0.30,
      stage2Multiple: 1.35,
      earlyBreakeven: false,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      postLossCooldownMinutes: 45,
      volExpansion: 1.20,
      bodyRatio: 0.45,
      deltaDominance: 52.0,
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      anchorTypes: anchors15m,
      filterDeadZones: true,
    },
    // Scenario A2: Conservative FVG Proximal (Pure TP1 Breakeven)
    {
      id: '15M_SCEN_A2_FVG_PROX_PURE_BE',
      name: '15m Scen A2: Conservative FVG Proximal (70/30 @ 1.0/1.35, Pure TP1 BE)',
      scenario: 'A_CONSERVATIVE',
      timeframe: '15m',
      entryMode: 'FVG_PROXIMAL',
      stage1Ratio: 0.70,
      stage1Multiple: 1.0,
      stage2Ratio: 0.30,
      stage2Multiple: 1.35,
      earlyBreakeven: false,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      postLossCooldownMinutes: 45,
      volExpansion: 1.20,
      bodyRatio: 0.45,
      deltaDominance: 52.0,
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      anchorTypes: anchors15m,
      filterDeadZones: true,
    },
    // Scenario A3: Conservative FVG_CE + Early BE (+0.35R) sensitivity
    {
      id: '15M_SCEN_A3_FVG_CE_EARLY_BE',
      name: '15m Scen A3: Conservative FVG_CE + Early BE (+0.35R)',
      scenario: 'A_CONSERVATIVE',
      timeframe: '15m',
      entryMode: 'FVG_CE',
      stage1Ratio: 0.70,
      stage1Multiple: 1.0,
      stage2Ratio: 0.30,
      stage2Multiple: 1.35,
      earlyBreakeven: true,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      postLossCooldownMinutes: 45,
      volExpansion: 1.20,
      bodyRatio: 0.45,
      deltaDominance: 52.0,
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      anchorTypes: anchors15m,
      filterDeadZones: true,
    },
    // Scenario B1: Asymmetric FVG_CE (Pure TP1 Breakeven)
    {
      id: '15M_SCEN_B1_FVG_CE_PURE_BE',
      name: '15m Scen B1: Asymmetric FVG_CE (60/40 @ 1.0/2.0, Pure TP1 BE)',
      scenario: 'B_ASYMMETRIC',
      timeframe: '15m',
      entryMode: 'FVG_CE',
      stage1Ratio: 0.60,
      stage1Multiple: 1.0,
      stage2Ratio: 0.40,
      stage2Multiple: 2.0,
      earlyBreakeven: false,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      postLossCooldownMinutes: 45,
      volExpansion: 1.20,
      bodyRatio: 0.45,
      deltaDominance: 52.0,
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      anchorTypes: anchors15m,
      filterDeadZones: true,
    },
    // Scenario B2: Asymmetric FVG Proximal (Pure TP1 Breakeven)
    {
      id: '15M_SCEN_B2_FVG_PROX_PURE_BE',
      name: '15m Scen B2: Asymmetric FVG Proximal (60/40 @ 1.0/2.0, Pure TP1 BE)',
      scenario: 'B_ASYMMETRIC',
      timeframe: '15m',
      entryMode: 'FVG_PROXIMAL',
      stage1Ratio: 0.60,
      stage1Multiple: 1.0,
      stage2Ratio: 0.40,
      stage2Multiple: 2.0,
      earlyBreakeven: false,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      postLossCooldownMinutes: 45,
      volExpansion: 1.20,
      bodyRatio: 0.45,
      deltaDominance: 52.0,
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      anchorTypes: anchors15m,
      filterDeadZones: true,
    },
    // Scenario B3: Asymmetric FVG_CE + Early BE (+0.35R) sensitivity
    {
      id: '15M_SCEN_B3_FVG_CE_EARLY_BE',
      name: '15m Scen B3: Asymmetric FVG_CE + Early BE (+0.35R)',
      scenario: 'B_ASYMMETRIC',
      timeframe: '15m',
      entryMode: 'FVG_CE',
      stage1Ratio: 0.60,
      stage1Multiple: 1.0,
      stage2Ratio: 0.40,
      stage2Multiple: 2.0,
      earlyBreakeven: true,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      postLossCooldownMinutes: 45,
      volExpansion: 1.20,
      bodyRatio: 0.45,
      deltaDominance: 52.0,
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      anchorTypes: anchors15m,
      filterDeadZones: true,
    },
  ];

  // Dates
  const endMs = Date.now();
  const start90dMs = endMs - 90 * 24 * 60 * 60 * 1000;
  const start1yMs = endMs - 365 * 24 * 60 * 60 * 1000;

  console.log(`\n📅 Evaluation Horizons:`);
  console.log(`   1-Year Start:   ${new Date(start1yMs).toISOString()}`);
  console.log(`   90-Day Start:   ${new Date(start90dMs).toISOString()}`);
  console.log(`   End Timestamp:  ${new Date(endMs).toISOString()}\n`);

  // 1. Initialize 15m Structural Bootstraps with 45-day warmup
  console.log('🔄 Initializing 15m Structural Bootstraps...');
  const { warmupStartMs: warmup15m1yMs, bootstrap: bootstrap15m1y } = await computeStructuralBootstrap(
    'ETHUSDC',
    '15m',
    start1yMs,
    { lookbackMajor: 15, lookbackInternal: 10 }
  );

  const { warmupStartMs: warmup15m90dMs, bootstrap: bootstrap15m90d } = await computeStructuralBootstrap(
    'ETHUSDC',
    '15m',
    start90dMs,
    { lookbackMajor: 15, lookbackInternal: 10 }
  );

  // 2. Initialize 5m Structural Bootstraps with 45-day warmup
  console.log('🔄 Initializing 5m Structural Bootstraps...');
  const { warmupStartMs: warmup5m1yMs, bootstrap: bootstrap5m1y } = await computeStructuralBootstrap(
    'ETHUSDC',
    '5m',
    start1yMs,
    { lookbackMajor: 10, lookbackInternal: 5 }
  );

  const { warmupStartMs: warmup5m90dMs, bootstrap: bootstrap5m90d } = await computeStructuralBootstrap(
    'ETHUSDC',
    '5m',
    start90dMs,
    { lookbackMajor: 10, lookbackInternal: 5 }
  );

  // 3. Load candle streams
  const allCandles15m1y = await loadOrFetch15mCandles(warmup15m1yMs, endMs);
  const allCandles15m90d = allCandles15m1y.filter((c) => c.t >= warmup15m90dMs);

  const allCandles5m1y = await loadOrFetch5mCandles(warmup5m1yMs, endMs);
  const allCandles5m90d = allCandles5m1y.filter((c) => c.t >= warmup5m90dMs);

  console.log(`\n📊 Datasets Prepared:`);
  console.log(`   15m 1-Year Candles (with 45d warmup): ${allCandles15m1y.length}`);
  console.log(`   15m 90-Day Candles (with 45d warmup): ${allCandles15m90d.length}`);
  console.log(`   5m 1-Year Candles  (with 45d warmup): ${allCandles5m1y.length}`);
  console.log(`   5m 90-Day Candles  (with 45d warmup): ${allCandles5m90d.length}`);

  const results: DetailedBenchmarkTelemetry[] = [];

  // ── HORIZON 1: 90-DAY SUMMER CHOP REGIME ───────────────────────────────────
  console.log('\n' + '─'.repeat(110));
  console.log('🚀 EVALUATING HORIZON 1: 90-DAY SUMMER CHOP REGIME (June 12 – September 10, 2026)');
  console.log('─'.repeat(110));

  for (const cfg of configs) {
    const is5m = cfg.timeframe === '5m';
    const candles = is5m ? allCandles5m90d : allCandles15m90d;
    const bootstrap = is5m ? bootstrap5m90d : bootstrap15m90d;

    const res = await runSingleBacktest(candles, bootstrap, cfg, '90D');
    results.push(res);
    console.log(
      `  [90D] ${cfg.id.padEnd(30)} | Trades: ${String(res.totalExecutedTrades).padStart(3)} | Net R: ${res.netRealizedR >= 0 ? '+' : ''}${res.netRealizedR.toFixed(2)}R | WinRate: ${res.winRateExScratchPct.toFixed(1)}% | PF: ${res.netProfitFactor.toFixed(2)} | Fees: ${res.totalFeesPaidR.toFixed(2)}R ($${res.totalFeesPaidUsd.toFixed(0)}) | MaxDD: ${res.maxDrawdownPct.toFixed(1)}% | Equity: $${res.finalEquity.toFixed(0)}`
    );
  }

  // ── HORIZON 2: 1-YEAR HISTORICAL CONTINUOUS BENCHMARK ─────────────────────
  console.log('\n' + '─'.repeat(110));
  console.log('🚀 EVALUATING HORIZON 2: 1-YEAR HISTORICAL BENCHMARK (September 2025 – September 2026)');
  console.log('─'.repeat(110));

  for (const cfg of configs) {
    const is5m = cfg.timeframe === '5m';
    const candles = is5m ? allCandles5m1y : allCandles15m1y;
    const bootstrap = is5m ? bootstrap5m1y : bootstrap15m1y;

    const res = await runSingleBacktest(candles, bootstrap, cfg, '1Y');
    results.push(res);
    console.log(
      `  [1Y]  ${cfg.id.padEnd(30)} | Trades: ${String(res.totalExecutedTrades).padStart(3)} | Net R: ${res.netRealizedR >= 0 ? '+' : ''}${res.netRealizedR.toFixed(2)}R | WinRate: ${res.winRateExScratchPct.toFixed(1)}% | PF: ${res.netProfitFactor.toFixed(2)} | Fees: ${res.totalFeesPaidR.toFixed(2)}R ($${res.totalFeesPaidUsd.toFixed(0)}) | MaxDD: ${res.maxDrawdownPct.toFixed(1)}% | Equity: $${res.finalEquity.toFixed(0)}`
    );
  }

  const outPath = path.join(process.cwd(), 'scratch', 'benchmark_15m_results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved detailed benchmark results to ${outPath}`);
}

main().catch(console.error);
