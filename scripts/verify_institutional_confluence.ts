import * as fs from 'fs';
import * as path from 'path';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';
import {
  calculate1to1ExecutionTelemetry,
  calculateCompoundingMetrics,
  StandardizedExecutedTrade,
} from '../src/lib/quantEngine/equityCalculator';
import { computeStructuralBootstrap } from '../src/lib/quantEngine/structuralBootstrap';
import {
  FACTORY_SWEEP_RECLAIM_PRESETS,
  SweepReclaimPresetConfig,
} from '../src/lib/quantEngine/scannerPresets';

interface TelemetryReport {
  id: string;
  name: string;
  horizon: '90D_SUMMER_CHOP' | '1Y_BENCHMARK';
  startDateStr: string;
  endDateStr: string;
  durationWeeks: number;
  totalExecutedTrades: number;
  tradesPerWeek: number;
  winningTrades: number;
  losingTrades: number;
  beScratches: number;
  winRatePct: number;
  winRateExScratchPct: number;
  scratchRatePct: number;
  avgWinR: number;
  avgLossR: number;
  asymmetryRatio: number;
  grossRealizedR: number;
  totalFeesPaidR: number;
  totalFeesPaidUsd: number;
  netRealizedR: number;
  grossProfitFactor: number;
  netProfitFactor: number;
  maxDrawdownR: number;
  maxDrawdownPct: number;
  initialEquity: number;
  finalEquity: number;
  netPnlUsd: number;
  netRoiPct: number;
  fullWins: number;
  stage1PartialScratches: number;
  pureScratches: number;
}

function load15mCandles(startMs: number, endMs: number): Candle[] {
  const scratchDir = path.join(process.cwd(), 'scratch');
  const files = fs.readdirSync(scratchDir);
  const cache15m = files.find((f) => f.startsWith('cached_ETHUSDC_15m_') && f.endsWith('.json'));

  if (!cache15m) {
    throw new Error('Could not find cached 15m ETHUSDC dataset in scratch directory.');
  }

  const fullPath = path.join(scratchDir, cache15m);
  console.log(`📂 Loading cached 15m dataset: ${cache15m}...`);
  const allCandles: Candle[] = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  console.log(`✅ Loaded ${allCandles.length.toLocaleString()} 15m candles from cache.`);
  return allCandles.filter((c) => c.t >= startMs && c.t <= endMs);
}

function runStrategyEvaluation(
  presetConfig: SweepReclaimPresetConfig,
  candles: Candle[],
  bootstrap: any,
  horizon: '90D_SUMMER_CHOP' | '1Y_BENCHMARK',
  id: string,
  name: string,
  initialCapital = 10000,
  riskPct = 2.0
): TelemetryReport {
  const scanConfig: SweepReclaimScanConfig = {
    symbol: presetConfig.symbol,
    timeframe: presetConfig.timeframe,
    anchorTypes: presetConfig.anchorTypes,
    suppressInternalPivots: presetConfig.suppressInternalPivots ?? false,
    lookbackMajor: presetConfig.lookbackMajor,
    lookbackInternal: presetConfig.lookbackInternal,
    maxBarsAnchorToSweep: presetConfig.maxBarsAnchorToSweep,
    maxBarsSweepToReclaim: presetConfig.maxBarsSweepToReclaim,
    maxBarsToRetest: presetConfig.maxBarsToRetest,
    volumeSmaPeriod: presetConfig.volumeSmaPeriod ?? 20,
    volumeExpansionThreshold: presetConfig.volumeExpansionThreshold,
    deltaDominanceThreshold: presetConfig.deltaDominanceThreshold,
    bodyRatioThreshold: presetConfig.bodyRatioThreshold,
    minBodyRatio: presetConfig.bodyRatioThreshold,
    requireThreePillarDisplacement: presetConfig.requireThreePillarDisplacement,
    enforceDiscountPremiumGate: presetConfig.enforceDiscountPremiumGate,
    enableRegimeAdaptiveEQ: true,
    enableInScannerWaveDedup: true,
    enforceSinglePositionConcurrency: true,
    pullbackExcursionThreshold: 0.5,
    stage1Multiple: presetConfig.stage1Multiple,
    stage2Multiple: presetConfig.stage2Multiple,
    stage3Multiple: presetConfig.stage3Multiple ?? 0.0,
    stage1Ratio: presetConfig.stage1Ratio ?? 0.50,
    stage2Ratio: presetConfig.stage2Ratio ?? 0.50,
    stage3Ratio: presetConfig.stage3Ratio ?? 0.0,
    entryMode: presetConfig.entryMode,
    enableStructuralTrail: presetConfig.enableStructuralTrail,
    enableProfitRatchet: presetConfig.enableProfitRatchet ?? false,
    minSweepDepthAtrMultiplier: presetConfig.minSweepDepthAtrMultiplier,
    slBufferAtrMultiplier: presetConfig.slBufferAtrMultiplier,
    targetMode: presetConfig.targetMode ?? 'FIXED_RR',
    dynamicTp1Source: presetConfig.dynamicTp1Source ?? 'FIXED_RR',
    dynamicTp2Source: presetConfig.dynamicTp2Source ?? 'FIXED_RR',
    minDynamicTp1Multiple: presetConfig.minDynamicTp1Multiple ?? 0.8,
    maxDynamicTp1Multiple: presetConfig.maxDynamicTp1Multiple ?? 1.5,
    minDynamicTp2Multiple: presetConfig.minDynamicTp2Multiple ?? 1.3,
    maxDynamicTp2Multiple: presetConfig.maxDynamicTp2Multiple ?? 3.5,
    requireMssConfirmation: presetConfig.requireMssConfirmation ?? false,
    mssLookbackBars: (presetConfig as any).mssLookbackBars ?? 15,
    maxBarsSweepToMss: (presetConfig as any).maxBarsSweepToMss ?? 10,
    enableEarlyBreakeven: presetConfig.enableEarlyBreakeven ?? false,
    earlyBreakevenMultiple: presetConfig.earlyBreakevenMultiple ?? 0.40,
    enableFeePaddedBreakeven: presetConfig.enableFeePaddedBreakeven ?? true,
    breakevenOffsetPct: presetConfig.breakevenOffsetPct ?? 0.015,
    enableWaveDeduplication: presetConfig.enableWaveDeduplication ?? true,
    filterWeekend: presetConfig.filterWeekend ?? false,
    filterDeadZones: presetConfig.filterDeadZones ?? false,
    enforceHtfBiasGuard: presetConfig.enforceHtfBiasGuard ?? false,
    postLossCooldownMinutes: presetConfig.postLossCooldownMinutes ?? 0,
    makerFeePct: presetConfig.makerFeePct ?? 0.0,
    takerFeePct: presetConfig.takerFeePct ?? 0.04,

    // Institutional Confluence Architecture
    enforceValueAreaGate: presetConfig.enforceValueAreaGate ?? false,
    valueAreaLookbackBars: presetConfig.valueAreaLookbackBars ?? 96,
    pocExclusionBandPct: presetConfig.pocExclusionBandPct ?? 0.0015,
    enforceSmtGate: presetConfig.enforceSmtGate ?? false,
    smtLookbackBars: presetConfig.smtLookbackBars ?? 15,
    enforceInstitutionalKillzones: presetConfig.enforceInstitutionalKillzones ?? false,
    institutionalKillzoneCutoffHourUtc: presetConfig.institutionalKillzoneCutoffHourUtc ?? 14,
    institutionalKillzoneCutoffMinuteUtc: presetConfig.institutionalKillzoneCutoffMinuteUtc ?? 30,
    enforcePreNewsFreeze: presetConfig.enforcePreNewsFreeze ?? false,
    enableM15StructuralTrail: presetConfig.enableM15StructuralTrail ?? false,
  };

  const engine = new SweepReclaimEngine(scanConfig);
  const { setups } = engine.scanHistoricalSetups(candles, bootstrap);

  const summary = calculate1to1ExecutionTelemetry(setups, {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: presetConfig.enableWaveDeduplication ?? true,
    filterWeekend: presetConfig.filterWeekend ?? false,
    filterDeadZones: presetConfig.filterDeadZones ?? false,
    enforceHtfBiasGuard: presetConfig.enforceHtfBiasGuard ?? false,
    enableEarlyBreakeven: presetConfig.enableEarlyBreakeven ?? false,
    earlyBreakevenMultiple: presetConfig.earlyBreakevenMultiple ?? 0.40,
    enableFeePaddedBreakeven: presetConfig.enableFeePaddedBreakeven ?? true,
    breakevenOffsetPct: presetConfig.breakevenOffsetPct ?? 0.015,
    postLossCooldownMinutes: presetConfig.postLossCooldownMinutes ?? 0,
    makerFeePct: presetConfig.makerFeePct ?? 0.0,
    takerFeePct: presetConfig.takerFeePct ?? 0.04,
  });

  const compounding = calculateCompoundingMetrics(summary.executedTrades, {
    initialCapital,
    riskPerTradePct: riskPct,
    compoundingMode: 'DYNAMIC_COMPOUNDING',
    makerFeePct: presetConfig.makerFeePct ?? 0.0,
    takerFeePct: presetConfig.takerFeePct ?? 0.04,
  });

  // Calculate detailed harvest & win/loss asymmetry metrics
  let fullWins = 0;
  let stage1PartialScratches = 0;
  let pureScratches = 0;
  let losingTrades = 0;
  let sumWinGrossR = 0;
  let sumLossGrossR = 0;

  for (const t of summary.executedTrades) {
    if (t.outcome === 'FULL_TP2_WIN' || t.outcome === 'FULL_TP3_WIN') {
      fullWins++;
      sumWinGrossR += t.realizedR;
    } else if (t.outcome === 'STAGE_1_SCRATCH' || (t.realizedR > 0 && t.metadata?.isStage1Filled && !t.metadata?.isStage2Filled)) {
      stage1PartialScratches++;
      sumWinGrossR += t.realizedR;
    } else if (t.realizedR === 0 || t.outcome === 'BE_SCRATCH_WIN') {
      pureScratches++;
    } else if (t.realizedR < 0 || t.outcome === 'STOPPED_OUT') {
      losingTrades++;
      sumLossGrossR += Math.abs(t.realizedR);
    }
  }

  const winningTrades = fullWins + stage1PartialScratches;
  const avgWinR = winningTrades > 0 ? sumWinGrossR / winningTrades : 0;
  const avgLossR = losingTrades > 0 ? sumLossGrossR / losingTrades : 0;
  const asymmetryRatio = avgLossR > 0 ? avgWinR / avgLossR : 0;

  const firstCandleT = candles[0]?.t ?? 0;
  const lastCandleT = candles[candles.length - 1]?.t ?? 0;
  const durationDays = Math.max(1, (lastCandleT - firstCandleT) / (24 * 60 * 60 * 1000));
  const durationWeeks = durationDays / 7;
  const tradesPerWeek = summary.totalExecutedTrades / durationWeeks;

  return {
    id,
    name,
    horizon,
    startDateStr: new Date(firstCandleT).toISOString(),
    endDateStr: new Date(lastCandleT).toISOString(),
    durationWeeks: parseFloat(durationWeeks.toFixed(1)),
    totalExecutedTrades: summary.totalExecutedTrades,
    tradesPerWeek: parseFloat(tradesPerWeek.toFixed(2)),
    winningTrades,
    losingTrades,
    beScratches: summary.totalBeScratches,
    winRatePct: summary.executionWinRatePct,
    winRateExScratchPct: summary.winRateExScratchPct,
    scratchRatePct: summary.scratchRatePct ?? 0,
    avgWinR: parseFloat(avgWinR.toFixed(3)),
    avgLossR: parseFloat(avgLossR.toFixed(3)),
    asymmetryRatio: parseFloat(asymmetryRatio.toFixed(2)),
    grossRealizedR: summary.grossRealizedR ?? summary.totalRealizedR ?? 0,
    totalFeesPaidR: summary.totalFeesPaidR ?? 0,
    totalFeesPaidUsd: compounding.totalFeesPaidUsd ?? 0,
    netRealizedR: summary.netRealizedR ?? summary.totalRealizedR ?? 0,
    grossProfitFactor: summary.grossProfitFactor ?? summary.profitFactor ?? 0,
    netProfitFactor: summary.netProfitFactor ?? summary.profitFactor ?? 0,
    maxDrawdownR: summary.maxDrawdownR ?? 0,
    maxDrawdownPct: compounding.maxDrawdownPct ?? 0,
    initialEquity: initialCapital,
    finalEquity: compounding.finalRealizedEquity ?? initialCapital,
    netPnlUsd: compounding.realizedNetPnlUsd ?? 0,
    netRoiPct: compounding.realizedNetRoiPct ?? 0,
    fullWins,
    stage1PartialScratches,
    pureScratches,
  };
}

function printReport(r: TelemetryReport) {
  console.log(`\n─────────────────────────────────────────────────────────────────────────────`);
  console.log(`📊 [${r.horizon}] ${r.name} (${r.id})`);
  console.log(`─────────────────────────────────────────────────────────────────────────────`);
  console.log(`• Date Range:             ${r.startDateStr ? r.startDateStr.slice(0, 10) : 'N/A'} to ${r.endDateStr ? r.endDateStr.slice(0, 10) : 'N/A'} (${r.durationWeeks} weeks)`);
  console.log(`• Total Executed Trades:   ${r.totalExecutedTrades} trades (${(r.tradesPerWeek ?? 0).toFixed(2)} trades/week)`);
  console.log(`• Win / Loss / Scratch:    ${r.winningTrades} Wins (${r.fullWins} Full + ${r.stage1PartialScratches} Partial) | ${r.losingTrades} Losses | ${r.beScratches} Scratches`);
  console.log(`• Execution Win Rate:      ${(r.winRatePct ?? 0).toFixed(1)}% (Ex-Scratch Win Rate: ${(r.winRateExScratchPct ?? 0).toFixed(1)}%)`);
  console.log(`• Scratch Rate:            ${(r.scratchRatePct ?? 0).toFixed(1)}%`);
  console.log(`• Realized Win/Loss Asymm: ${(r.asymmetryRatio ?? 0).toFixed(2)}x (Avg Win: +${(r.avgWinR ?? 0).toFixed(2)}R vs Avg Loss: -${(r.avgLossR ?? 0).toFixed(2)}R)`);
  console.log(`• Gross Realized Return:   ${(r.grossRealizedR ?? 0) >= 0 ? '+' : ''}${(r.grossRealizedR ?? 0).toFixed(2)}R`);
  console.log(`• Binance Taker Fees Paid: ${(r.totalFeesPaidR ?? 0).toFixed(2)}R ($${(r.totalFeesPaidUsd ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
  console.log(`• Net Realized Return:     ${(r.netRealizedR ?? 0) >= 0 ? '+' : ''}${(r.netRealizedR ?? 0).toFixed(2)}R`);
  console.log(`• Gross Profit Factor:     ${(r.grossProfitFactor ?? 0).toFixed(2)}`);
  console.log(`• Net Profit Factor:       ${(r.netProfitFactor ?? 0).toFixed(2)}`);
  console.log(`• Max Drawdown (R):        -${(r.maxDrawdownR ?? 0).toFixed(2)}R`);
  console.log(`• Max Compounded Drawdown: ${(r.maxDrawdownPct ?? 0).toFixed(2)}% ($10,000 start @ 2% risk)`);
  console.log(`• Final Equity ($10k @ 2%): $${(r.finalEquity ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${(r.netRoiPct ?? 0) >= 0 ? '+' : ''}${(r.netRoiPct ?? 0).toFixed(1)}% Net ROI)`);
}

async function main() {
  console.log('═'.repeat(90));
  console.log('🏛️ INSTITUTIONAL CONFLUENCE ARCHITECTURE COMPARATIVE VALIDATION SUITE');
  console.log('   Baseline Champion vs Institutional Confluence Champion across 90D & 1Y');
  console.log('═'.repeat(90));

  // Find presets
  const baselinePreset = FACTORY_SWEEP_RECLAIM_PRESETS.find(
    (p) => p.id === 'factory_sr_15m_asymmetric_macro_sniper'
  );
  const institutionalPreset = FACTORY_SWEEP_RECLAIM_PRESETS.find(
    (p) => p.id === 'factory_sr_15m_institutional_confluence'
  );

  if (!baselinePreset || !institutionalPreset) {
    throw new Error('Could not find factory presets in scannerPresets.ts');
  }

  // Define Horizon Time Windows
  const endMs = Date.parse('2026-09-10T19:30:00.000Z');
  const start90dMs = endMs - 90 * 24 * 60 * 60 * 1000;
  const start1yMs = endMs - 365 * 24 * 60 * 60 * 1000;

  console.log(`\n📅 Evaluation Horizons:`);
  console.log(`   Horizon A (90-Day Summer Chop): ${new Date(start90dMs).toISOString()} to ${new Date(endMs).toISOString()}`);
  console.log(`   Horizon B (1-Year Benchmark):   ${new Date(start1yMs).toISOString()} to ${new Date(endMs).toISOString()}`);

  // Load Candles
  console.log('\n📥 Loading Datasets...');
  const candles90d = load15mCandles(start90dMs, endMs);
  const candles1y = load15mCandles(start1yMs, endMs);

  // Compute Bootstraps
  console.log('\n🔄 Loading Structural Bootstraps...');
  const { bootstrap: bootstrap90d } = await computeStructuralBootstrap(
    'ETHUSDC',
    '15m',
    start90dMs,
    { lookbackMajor: 15, lookbackInternal: 10 }
  );

  const { bootstrap: bootstrap1y } = await computeStructuralBootstrap(
    'ETHUSDC',
    '15m',
    start1yMs,
    { lookbackMajor: 15, lookbackInternal: 10 }
  );

  // Run Evaluations
  console.log('\n⚡ Running Horizon A (90-Day Summer Chop) Simulations...');
  const rA_baseline = runStrategyEvaluation(
    baselinePreset.config as SweepReclaimPresetConfig,
    candles90d,
    bootstrap90d,
    '90D_SUMMER_CHOP',
    baselinePreset.id,
    baselinePreset.name
  );

  const rA_institutional = runStrategyEvaluation(
    institutionalPreset.config as SweepReclaimPresetConfig,
    candles90d,
    bootstrap90d,
    '90D_SUMMER_CHOP',
    institutionalPreset.id,
    institutionalPreset.name
  );

  console.log('\n⚡ Running Horizon B (1-Year Benchmark) Simulations...');
  const rB_baseline = runStrategyEvaluation(
    baselinePreset.config as SweepReclaimPresetConfig,
    candles1y,
    bootstrap1y,
    '1Y_BENCHMARK',
    baselinePreset.id,
    baselinePreset.name
  );

  const rB_institutional = runStrategyEvaluation(
    institutionalPreset.config as SweepReclaimPresetConfig,
    candles1y,
    bootstrap1y,
    '1Y_BENCHMARK',
    institutionalPreset.id,
    institutionalPreset.name
  );

  // Print Detailed Reports
  console.log('\n' + '═'.repeat(90));
  console.log('🏆 COMPLETE COMPARATIVE TELEMETRY REPORT');
  console.log('═'.repeat(90));

  printReport(rA_baseline);
  printReport(rA_institutional);
  printReport(rB_baseline);
  printReport(rB_institutional);

  // Print Side-by-Side Summary Tables
  console.log('\n' + '═'.repeat(110));
  console.log('📋 SIDE-BY-SIDE EXECUTIVE COMPARISON TABLE');
  console.log('═'.repeat(110));
  console.log(
    'Metric'.padEnd(35) +
    '| 90D Baseline'.padEnd(18) +
    '| 90D Confluence'.padEnd(18) +
    '| 1Y Baseline'.padEnd(18) +
    '| 1Y Confluence'
  );
  console.log('-'.repeat(110));

  const rows: [string, string, string, string, string][] = [
    ['Total Executed Trades', `${rA_baseline.totalExecutedTrades}`, `${rA_institutional.totalExecutedTrades}`, `${rB_baseline.totalExecutedTrades}`, `${rB_institutional.totalExecutedTrades}`],
    ['Trade Frequency (Trades/Week)', `${(rA_baseline.tradesPerWeek ?? 0).toFixed(2)}`, `${(rA_institutional.tradesPerWeek ?? 0).toFixed(2)}`, `${(rB_baseline.tradesPerWeek ?? 0).toFixed(2)}`, `${(rB_institutional.tradesPerWeek ?? 0).toFixed(2)}`],
    ['Execution Win Rate %', `${(rA_baseline.winRatePct ?? 0).toFixed(1)}%`, `${(rA_institutional.winRatePct ?? 0).toFixed(1)}%`, `${(rB_baseline.winRatePct ?? 0).toFixed(1)}%`, `${(rB_institutional.winRatePct ?? 0).toFixed(1)}%`],
    ['Ex-Scratch Win Rate %', `${(rA_baseline.winRateExScratchPct ?? 0).toFixed(1)}%`, `${(rA_institutional.winRateExScratchPct ?? 0).toFixed(1)}%`, `${(rB_baseline.winRateExScratchPct ?? 0).toFixed(1)}%`, `${(rB_institutional.winRateExScratchPct ?? 0).toFixed(1)}%`],
    ['Scratch Rate %', `${(rA_baseline.scratchRatePct ?? 0).toFixed(1)}%`, `${(rA_institutional.scratchRatePct ?? 0).toFixed(1)}%`, `${(rB_baseline.scratchRatePct ?? 0).toFixed(1)}%`, `${(rB_institutional.scratchRatePct ?? 0).toFixed(1)}%`],
    ['Realized Win/Loss Asymmetry', `${(rA_baseline.asymmetryRatio ?? 0).toFixed(2)}x`, `${(rA_institutional.asymmetryRatio ?? 0).toFixed(2)}x`, `${(rB_baseline.asymmetryRatio ?? 0).toFixed(2)}x`, `${(rB_institutional.asymmetryRatio ?? 0).toFixed(2)}x`],
    ['Gross Realized Return (R)', `${(rA_baseline.grossRealizedR ?? 0) >= 0 ? '+' : ''}${(rA_baseline.grossRealizedR ?? 0).toFixed(2)}R`, `${(rA_institutional.grossRealizedR ?? 0) >= 0 ? '+' : ''}${(rA_institutional.grossRealizedR ?? 0).toFixed(2)}R`, `${(rB_baseline.grossRealizedR ?? 0) >= 0 ? '+' : ''}${(rB_baseline.grossRealizedR ?? 0).toFixed(2)}R`, `${(rB_institutional.grossRealizedR ?? 0) >= 0 ? '+' : ''}${(rB_institutional.grossRealizedR ?? 0).toFixed(2)}R`],
    ['Binance Taker Fees Paid (R)', `${(rA_baseline.totalFeesPaidR ?? 0).toFixed(2)}R`, `${(rA_institutional.totalFeesPaidR ?? 0).toFixed(2)}R`, `${(rB_baseline.totalFeesPaidR ?? 0).toFixed(2)}R`, `${(rB_institutional.totalFeesPaidR ?? 0).toFixed(2)}R`],
    ['Net Realized Return (R)', `${(rA_baseline.netRealizedR ?? 0) >= 0 ? '+' : ''}${(rA_baseline.netRealizedR ?? 0).toFixed(2)}R`, `${(rA_institutional.netRealizedR ?? 0) >= 0 ? '+' : ''}${(rA_institutional.netRealizedR ?? 0).toFixed(2)}R`, `${(rB_baseline.netRealizedR ?? 0) >= 0 ? '+' : ''}${(rB_baseline.netRealizedR ?? 0).toFixed(2)}R`, `${(rB_institutional.netRealizedR ?? 0) >= 0 ? '+' : ''}${(rB_institutional.netRealizedR ?? 0).toFixed(2)}R`],
    ['Net Profit Factor', `${(rA_baseline.netProfitFactor ?? 0).toFixed(2)}`, `${(rA_institutional.netProfitFactor ?? 0).toFixed(2)}`, `${(rB_baseline.netProfitFactor ?? 0).toFixed(2)}`, `${(rB_institutional.netProfitFactor ?? 0).toFixed(2)}`],
    ['Max Drawdown (R)', `-${(rA_baseline.maxDrawdownR ?? 0).toFixed(2)}R`, `-${(rA_institutional.maxDrawdownR ?? 0).toFixed(2)}R`, `-${(rB_baseline.maxDrawdownR ?? 0).toFixed(2)}R`, `-${(rB_institutional.maxDrawdownR ?? 0).toFixed(2)}R`],
    ['Max Compounded Drawdown %', `${(rA_baseline.maxDrawdownPct ?? 0).toFixed(2)}%`, `${(rA_institutional.maxDrawdownPct ?? 0).toFixed(2)}%`, `${(rB_baseline.maxDrawdownPct ?? 0).toFixed(2)}%`, `${(rB_institutional.maxDrawdownPct ?? 0).toFixed(2)}%`],
    ['Compounded Net ROI %', `${(rA_baseline.netRoiPct ?? 0) >= 0 ? '+' : ''}${(rA_baseline.netRoiPct ?? 0).toFixed(1)}%`, `${(rA_institutional.netRoiPct ?? 0) >= 0 ? '+' : ''}${(rA_institutional.netRoiPct ?? 0).toFixed(1)}%`, `${(rB_baseline.netRoiPct ?? 0) >= 0 ? '+' : ''}${(rB_baseline.netRoiPct ?? 0).toFixed(1)}%`, `${(rB_institutional.netRoiPct ?? 0) >= 0 ? '+' : ''}${(rB_institutional.netRoiPct ?? 0).toFixed(1)}%`],
    ['Final Equity ($10k @ 2%)', `$${Math.round(rA_baseline.finalEquity ?? 0).toLocaleString()}`, `$${Math.round(rA_institutional.finalEquity ?? 0).toLocaleString()}`, `$${Math.round(rB_baseline.finalEquity ?? 0).toLocaleString()}`, `$${Math.round(rB_institutional.finalEquity ?? 0).toLocaleString()}`],
  ];

  for (const row of rows) {
    console.log(
      row[0].padEnd(35) +
      '| ' + row[1].padEnd(16) +
      '| ' + row[2].padEnd(16) +
      '| ' + row[3].padEnd(16) +
      '| ' + row[4]
    );
  }
  console.log('═'.repeat(110));

  // Save report to disk
  const outPath = path.join(process.cwd(), 'scratch', 'institutional_confluence_validation_results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    timestamp: Date.now(),
    horizonA: { baseline: rA_baseline, institutional: rA_institutional },
    horizonB: { baseline: rB_baseline, institutional: rB_institutional },
  }, null, 2));
  console.log(`\n💾 Saved detailed results to ${outPath}\n`);
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
