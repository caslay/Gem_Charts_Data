import * as fs from 'fs';
import * as path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
} from '../src/lib/quantEngine/SweepReclaimEngine';
import {
  TrendContinuationEngine,
  TrendContinuationConfig,
} from '../src/lib/quantEngine/TrendContinuationEngine';
import {
  calculate1to1ExecutionTelemetry,
  calculateCompoundingMetrics,
} from '../src/lib/quantEngine/equityCalculator';
import { computeStructuralBootstrap } from '../src/lib/quantEngine/structuralBootstrap';
import {
  FACTORY_SWEEP_RECLAIM_PRESETS,
  FACTORY_TREND_CONTINUATION_PRESETS,
  SweepReclaimPresetConfig,
  TrendContinuationPresetConfig,
} from '../src/lib/quantEngine/scannerPresets';

export interface ComparativeTelemetryResult {
  engine: 'Engine 1: Sweep & Reclaim' | 'Engine 2: Trend Continuation';
  presetId: string;
  presetName: string;
  horizon: 'Horizon A (90D Summer Chop)' | 'Horizon B (1Y Benchmark)';
  startDate: string;
  endDate: string;
  totalCandles: number;
  totalExecutedTrades: number;
  tradesPerWeek: number;
  winningTrades: number;
  losingTrades: number;
  scratches: number;
  winRatePct: number;
  winRateExScratchPct: number;
  asymmetryRatio: number;
  grossRealizedR: number;
  totalFeesPaidR: number;
  totalFeesPaidUsd: number;
  netRealizedR: number;
  netProfitFactor: number;
  maxDrawdownR: number;
  maxCompoundedDrawdownPct: number;
  initialEquity: number;
  finalEquity: number;
  netRoiPct: number;
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

function evaluateSweepReclaim(
  presetConfig: SweepReclaimPresetConfig,
  candles: Candle[],
  bootstrap: any,
  horizon: 'Horizon A (90D Summer Chop)' | 'Horizon B (1Y Benchmark)',
  initialCapital = 10000,
  riskPct = 2.0
): ComparativeTelemetryResult {
  const scanConfig: SweepReclaimScanConfig = {
    symbol: presetConfig.symbol,
    timeframe: presetConfig.timeframe,
    anchorTypes: presetConfig.anchorTypes,
    suppressInternalPivots: presetConfig.suppressInternalPivots ?? true,
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
    enforceDiscountPremiumGate: presetConfig.enforceDiscountPremiumGate ?? false,
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
    targetMode: presetConfig.targetMode ?? 'DYNAMIC_LIQUIDITY',
    dynamicTp1Source: presetConfig.dynamicTp1Source ?? 'DEALING_RANGE_EQ',
    dynamicTp2Source: presetConfig.dynamicTp2Source ?? 'OPPOSING_LIQUIDITY',
    minDynamicTp1Multiple: presetConfig.minDynamicTp1Multiple ?? 1.20,
    maxDynamicTp1Multiple: presetConfig.maxDynamicTp1Multiple ?? 1.50,
    minDynamicTp2Multiple: presetConfig.minDynamicTp2Multiple ?? 3.00,
    maxDynamicTp2Multiple: presetConfig.maxDynamicTp2Multiple ?? 5.00,
    requireMssConfirmation: presetConfig.requireMssConfirmation ?? false,
    mssLookbackBars: (presetConfig as any).mssLookbackBars ?? 15,
    maxBarsSweepToMss: (presetConfig as any).maxBarsSweepToMss ?? 10,
    enableEarlyBreakeven: presetConfig.enableEarlyBreakeven ?? false,
    earlyBreakevenMultiple: presetConfig.earlyBreakevenMultiple ?? 0.40,
    enableFeePaddedBreakeven: presetConfig.enableFeePaddedBreakeven ?? true,
    breakevenOffsetPct: presetConfig.breakevenOffsetPct ?? 0.015,
    enableWaveDeduplication: presetConfig.enableWaveDeduplication ?? true,
    filterWeekend: presetConfig.filterWeekend ?? true,
    filterDeadZones: presetConfig.filterDeadZones ?? false,
    enforceHtfBiasGuard: presetConfig.enforceHtfBiasGuard ?? false,
    postLossCooldownMinutes: presetConfig.postLossCooldownMinutes ?? 45,
    makerFeePct: presetConfig.makerFeePct ?? 0.0,
    takerFeePct: presetConfig.takerFeePct ?? 0.04,
    enforceValueAreaGate: presetConfig.enforceValueAreaGate ?? true,
    valueAreaLookbackBars: presetConfig.valueAreaLookbackBars ?? 96,
    pocExclusionBandPct: presetConfig.pocExclusionBandPct ?? 0.0015,
    enforceSmtGate: presetConfig.enforceSmtGate ?? true,
    smtLookbackBars: presetConfig.smtLookbackBars ?? 15,
    enforceInstitutionalKillzones: presetConfig.enforceInstitutionalKillzones ?? true,
    institutionalKillzoneCutoffHourUtc: presetConfig.institutionalKillzoneCutoffHourUtc ?? 14,
    institutionalKillzoneCutoffMinuteUtc: presetConfig.institutionalKillzoneCutoffMinuteUtc ?? 30,
    enforcePreNewsFreeze: presetConfig.enforcePreNewsFreeze ?? true,
    enableM15StructuralTrail: presetConfig.enableM15StructuralTrail ?? true,
  };

  const engine = new SweepReclaimEngine(scanConfig);
  const { setups } = engine.scanHistoricalSetups(candles, bootstrap);

  const summary = calculate1to1ExecutionTelemetry(setups, {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: true,
    filterWeekend: presetConfig.filterWeekend ?? true,
    filterDeadZones: presetConfig.filterDeadZones ?? false,
    enforceHtfBiasGuard: presetConfig.enforceHtfBiasGuard ?? false,
    enableEarlyBreakeven: presetConfig.enableEarlyBreakeven ?? false,
    earlyBreakevenMultiple: presetConfig.earlyBreakevenMultiple ?? 0.40,
    enableFeePaddedBreakeven: presetConfig.enableFeePaddedBreakeven ?? true,
    breakevenOffsetPct: presetConfig.breakevenOffsetPct ?? 0.015,
    postLossCooldownMinutes: presetConfig.postLossCooldownMinutes ?? 45,
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

  let winningTrades = 0;
  let losingTrades = 0;
  let scratches = 0;
  let sumWinGrossR = 0;
  let sumLossGrossR = 0;

  for (const t of summary.executedTrades) {
    if (t.realizedR > 0.05) {
      winningTrades++;
      sumWinGrossR += t.realizedR;
    } else if (t.realizedR < -0.05) {
      losingTrades++;
      sumLossGrossR += Math.abs(t.realizedR);
    } else {
      scratches++;
    }
  }

  const avgWinR = winningTrades > 0 ? sumWinGrossR / winningTrades : 0;
  const avgLossR = losingTrades > 0 ? sumLossGrossR / losingTrades : 0;
  const asymmetryRatio = avgLossR > 0 ? avgWinR / avgLossR : 0;

  const firstCandleT = candles[0]?.t ?? 0;
  const lastCandleT = candles[candles.length - 1]?.t ?? 0;
  const durationDays = Math.max(1, (lastCandleT - firstCandleT) / (24 * 60 * 60 * 1000));
  const durationWeeks = durationDays / 7;
  const tradesPerWeek = summary.totalExecutedTrades / durationWeeks;

  return {
    engine: 'Engine 1: Sweep & Reclaim',
    presetId: 'factory_sr_15m_asymmetric_macro_sniper',
    presetName: '15m Institutional Asymmetric Macro Sniper',
    horizon,
    startDate: new Date(firstCandleT).toISOString().slice(0, 10),
    endDate: new Date(lastCandleT).toISOString().slice(0, 10),
    totalCandles: candles.length,
    totalExecutedTrades: summary.totalExecutedTrades,
    tradesPerWeek: parseFloat(tradesPerWeek.toFixed(2)),
    winningTrades,
    losingTrades,
    scratches,
    winRatePct: summary.executionWinRatePct,
    winRateExScratchPct: summary.winRateExScratchPct,
    asymmetryRatio: parseFloat(asymmetryRatio.toFixed(2)),
    grossRealizedR: parseFloat((summary.grossRealizedR ?? summary.totalRealizedR ?? 0).toFixed(2)),
    totalFeesPaidR: parseFloat((summary.totalFeesPaidR ?? 0).toFixed(2)),
    totalFeesPaidUsd: parseFloat((compounding.totalFeesPaidUsd ?? 0).toFixed(2)),
    netRealizedR: parseFloat((summary.netRealizedR ?? summary.totalRealizedR ?? 0).toFixed(2)),
    netProfitFactor: parseFloat((summary.netProfitFactor ?? summary.profitFactor ?? 0).toFixed(2)),
    maxDrawdownR: parseFloat((summary.maxDrawdownR ?? 0).toFixed(2)),
    maxCompoundedDrawdownPct: parseFloat((compounding.maxDrawdownPct ?? 0).toFixed(2)),
    initialEquity: initialCapital,
    finalEquity: parseFloat((compounding.finalRealizedEquity ?? initialCapital).toFixed(2)),
    netRoiPct: parseFloat((compounding.realizedNetRoiPct ?? 0).toFixed(1)),
  };
}

function evaluateTrendContinuation(
  presetConfig: TrendContinuationPresetConfig,
  candles: Candle[],
  bootstrap: any,
  horizon: 'Horizon A (90D Summer Chop)' | 'Horizon B (1Y Benchmark)',
  initialCapital = 10000,
  riskPct = 2.0
): ComparativeTelemetryResult {
  const config: TrendContinuationConfig = {
    symbol: presetConfig.symbol,
    timeframe: presetConfig.timeframe,
    lookbackMajor: presetConfig.lookbackMajor,
    lookbackInternal: presetConfig.lookbackInternal,
    emaPeriod: presetConfig.emaPeriod,
    enforceHtfTrendLock: presetConfig.enforceHtfTrendLock,
    volumeSmaPeriod: presetConfig.volumeSmaPeriod,
    volumeExpansionThreshold: presetConfig.volumeExpansionThreshold,
    deltaDominanceThreshold: presetConfig.deltaDominanceThreshold,
    bodyRatioThreshold: presetConfig.bodyRatioThreshold,
    requireThreePillarDisplacement: presetConfig.requireThreePillarDisplacement,
    maxBarsToRetest: presetConfig.maxBarsToRetest,
    maxOriginLookbackBars: presetConfig.maxOriginLookbackBars ?? 32,
    slBufferAtrMultiplier: presetConfig.slBufferAtrMultiplier,
    entryMode: presetConfig.entryMode,
    stage1Ratio: presetConfig.stage1Ratio,
    stage2Ratio: presetConfig.stage2Ratio,
    stage1Multiple: presetConfig.stage1Multiple,
    stage2Multiple: presetConfig.stage2Multiple,
    dynamicTp2Source: presetConfig.dynamicTp2Source,
    minDynamicTp2Multiple: presetConfig.minDynamicTp2Multiple,
    maxDynamicTp2Multiple: presetConfig.maxDynamicTp2Multiple,
    enableM15StructuralTrail: presetConfig.enableM15StructuralTrail,
    enableFeePaddedBreakeven: presetConfig.enableFeePaddedBreakeven,
    breakevenOffsetPct: presetConfig.breakevenOffsetPct,
    postLossCooldownMinutes: presetConfig.postLossCooldownMinutes,
    enforceSinglePositionConcurrency: true,
    enforceValueAreaGate: presetConfig.enforceValueAreaGate ?? true,
    valueAreaLookbackBars: presetConfig.valueAreaLookbackBars ?? 96,
    valueAreaMode: presetConfig.valueAreaMode ?? 'PREVIOUS_DAY_DEVELOPING',
    pocBandPct: presetConfig.pocBandPct ?? 0.0020,
    enforceOlsValidation: presetConfig.enforceOlsValidation ?? true,
    enforceOiSponsorship: presetConfig.enforceOiSponsorship ?? true,
    enforceSmtGate: presetConfig.enforceSmtGate ?? true,
    smtLookbackBars: presetConfig.smtLookbackBars ?? 15,
    enableDynamicProfitFloor: presetConfig.enableDynamicProfitFloor ?? true,
    enforceToxicWindowBlacklist: presetConfig.enforceToxicWindowBlacklist ?? true,
    enforceRolloverFreeze: presetConfig.enforceRolloverFreeze ?? true,
    enforceNewsFreeze: presetConfig.enforceNewsFreeze ?? true,
    makerFeePct: presetConfig.makerFeePct ?? 0.0,
    takerFeePct: presetConfig.takerFeePct ?? 0.04,
    initialEquity: initialCapital,
    compoundingRiskPct: riskPct,
  };

  const engine = new TrendContinuationEngine(config);
  const { setups, telemetry } = engine.scanHistoricalSetups(candles, bootstrap);

  const firstCandleT = candles[0]?.t ?? 0;
  const lastCandleT = candles[candles.length - 1]?.t ?? 0;
  const durationDays = Math.max(1, (lastCandleT - firstCandleT) / (24 * 60 * 60 * 1000));
  const durationWeeks = durationDays / 7;
  const tradesPerWeek = telemetry.retestedTradesCount / durationWeeks;

  const netRoiPct = initialCapital > 0
    ? ((telemetry.finalEquity - initialCapital) / initialCapital) * 100
    : 0;

  return {
    engine: 'Engine 2: Trend Continuation',
    presetId: 'factory_tc_15m_trend_expansion_champion',
    presetName: '15m Institutional Trend Expansion Champion',
    horizon,
    startDate: new Date(firstCandleT).toISOString().slice(0, 10),
    endDate: new Date(lastCandleT).toISOString().slice(0, 10),
    totalCandles: candles.length,
    totalExecutedTrades: telemetry.retestedTradesCount,
    tradesPerWeek: parseFloat(tradesPerWeek.toFixed(2)),
    winningTrades: telemetry.winningTradesCount,
    losingTrades: telemetry.losingTradesCount,
    scratches: telemetry.scratchTradesCount,
    winRatePct: telemetry.executionWinRatePct,
    winRateExScratchPct: telemetry.exScratchWinRatePct,
    asymmetryRatio: telemetry.realizedWinLossAsymmetry,
    grossRealizedR: telemetry.grossRealizedR,
    totalFeesPaidR: telemetry.totalFeesR,
    totalFeesPaidUsd: telemetry.totalFeesUsd,
    netRealizedR: telemetry.netRealizedR,
    netProfitFactor: telemetry.netProfitFactor,
    maxDrawdownR: telemetry.maxDrawdownR,
    maxCompoundedDrawdownPct: telemetry.maxCompoundedDrawdownPct,
    initialEquity: telemetry.initialEquity,
    finalEquity: telemetry.finalEquity,
    netRoiPct: parseFloat(netRoiPct.toFixed(1)),
  };
}

function printComparativeTable(results: ComparativeTelemetryResult[]) {
  console.log('\n' + '═'.repeat(120));
  console.log('🏛️ DUAL-ENGINE QUANTITATIVE BENCHMARK & COMPARATIVE HARVEST TELEMETRY');
  console.log('═'.repeat(120));

  for (const r of results) {
    console.log(`\n▶ [${r.engine}] - ${r.horizon}`);
    console.log(`  Preset:                 ${r.presetName} (${r.presetId})`);
    console.log(`  Window:                 ${r.startDate} to ${r.endDate} (${r.totalCandles.toLocaleString()} 15m candles)`);
    console.log(`  Total Executed Trades:  ${r.totalExecutedTrades} (${r.tradesPerWeek} trades/week)`);
    console.log(`  Wins / Losses / Scratch: ${r.winningTrades} Wins | ${r.losingTrades} Losses | ${r.scratches} Scratches`);
    console.log(`  Execution Win Rate:     ${r.winRatePct}% (Ex-Scratch: ${r.winRateExScratchPct}%)`);
    console.log(`  Win/Loss Asymmetry:     ${r.asymmetryRatio}x`);
    console.log(`  Gross Realized Return:  ${r.grossRealizedR >= 0 ? '+' : ''}${r.grossRealizedR}R`);
    console.log(`  Binance Fees Paid:      ${r.totalFeesPaidR}R ($${r.totalFeesPaidUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
    console.log(`  Net Realized Return:    ${r.netRealizedR >= 0 ? '+' : ''}${r.netRealizedR}R`);
    console.log(`  Net Profit Factor:      ${r.netProfitFactor}`);
    console.log(`  Max Drawdown (R):       -${r.maxDrawdownR}R`);
    console.log(`  Max Compounded DD:      ${r.maxCompoundedDrawdownPct}% ($10k @ 2% risk)`);
    console.log(`  Final Equity:           $${r.finalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${r.netRoiPct >= 0 ? '+' : ''}${r.netRoiPct}% Net ROI)`);
  }
}

async function main() {
  console.log('🚀 Starting Comparative Backtest: Engine 1 vs Engine 2...');

  const srPreset = FACTORY_SWEEP_RECLAIM_PRESETS.find((p) => p.id === 'factory_sr_15m_asymmetric_macro_sniper');
  const tcPreset = FACTORY_TREND_CONTINUATION_PRESETS.find((p) => p.id === 'factory_tc_15m_trend_expansion_champion');

  if (!srPreset) throw new Error('Missing factory_sr_15m_asymmetric_macro_sniper');
  if (!tcPreset) throw new Error('Missing factory_tc_15m_trend_expansion_champion');

  const endMs = Date.parse('2026-09-10T19:30:00.000Z');
  const start90dMs = endMs - 90 * 24 * 60 * 60 * 1000;
  const start1yMs = endMs - 365 * 24 * 60 * 60 * 1000;

  console.log(`📅 Horizon A (90D): ${new Date(start90dMs).toISOString()} to ${new Date(endMs).toISOString()}`);
  console.log(`📅 Horizon B (1Y):  ${new Date(start1yMs).toISOString()} to ${new Date(endMs).toISOString()}`);

  const candles90d = load15mCandles(start90dMs, endMs);
  const candles1y = load15mCandles(start1yMs, endMs);

  console.log('🔄 Computing structural bootstraps...');
  const { bootstrap: bootstrap90d } = await computeStructuralBootstrap('ETHUSDC', '15m', start90dMs, {
    lookbackMajor: 15,
    lookbackInternal: 10,
  });
  const { bootstrap: bootstrap1y } = await computeStructuralBootstrap('ETHUSDC', '15m', start1yMs, {
    lookbackMajor: 15,
    lookbackInternal: 10,
  });

  const results: ComparativeTelemetryResult[] = [];

  console.log('\n⚡ Evaluating Horizon A: Engine 1 (Sweep & Reclaim)...');
  results.push(evaluateSweepReclaim(srPreset.config as SweepReclaimPresetConfig, candles90d, bootstrap90d, 'Horizon A (90D Summer Chop)'));

  console.log('⚡ Evaluating Horizon A: Engine 2 (Trend Continuation)...');
  results.push(evaluateTrendContinuation(tcPreset.config as TrendContinuationPresetConfig, candles90d, bootstrap90d, 'Horizon A (90D Summer Chop)'));

  console.log('⚡ Evaluating Horizon B: Engine 1 (Sweep & Reclaim)...');
  results.push(evaluateSweepReclaim(srPreset.config as SweepReclaimPresetConfig, candles1y, bootstrap1y, 'Horizon B (1Y Benchmark)'));

  console.log('⚡ Evaluating Horizon B: Engine 2 (Trend Continuation)...');
  results.push(evaluateTrendContinuation(tcPreset.config as TrendContinuationPresetConfig, candles1y, bootstrap1y, 'Horizon B (1Y Benchmark)'));

  printComparativeTable(results);

  // Save results to scratch
  const outPath = path.join(process.cwd(), 'scratch', 'comparative_dual_engine_results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n💾 Saved detailed results to ${outPath}`);
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
