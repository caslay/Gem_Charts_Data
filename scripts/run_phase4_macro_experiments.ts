/**
 * scripts/run_phase4_macro_experiments.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Quant Research Roadmap — Phase 4: Macro HTF Context & Valuation Gating
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluates Pillar 1 Hypotheses under the 3-Strike Hypothesis Rejection Rule:
 *  - Benchmark: factory_sr_5m_fvg_ce_sniper_v2 (+223.76R Net, 1.75 PF, -6.68R Max DD, $74,287)
 *  - Target Metric: Compress Max Drawdown from -6.68R to < -5.0R while maintaining PF >= 1.50
 *  - Standard Initial Capital: $1,000 USD (2% Dynamic Compounding = $20.00 / 1.0R)
 *  - 100% Bit-for-Bit Parity to PM2 Live Headless Daemon
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimAnchorType,
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';
import {
  adaptSweepReclaimSetupsToTrades,
  StandardizedExecutedTrade,
} from '../src/lib/quantEngine/equityCalculator';

interface ExperimentMetric {
  experimentId: string;
  name: string;
  factor: string;
  valueTested: number | string;
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number;
  netR: number;
  grossWinR: number;
  grossLossR: number;
  profitFactor: number;
  expectedValueR: number;
  maxDrawdownR: number;
  finalEquity1k: number;
  maxCompoundedDdPct: number;
  hurdleStatus: 'CHAMPION_BENCHMARK' | 'BEATS_HURDLE' | 'FAILED_HURDLE';
  failureReason?: string;
}

function evaluateTrades(trades: StandardizedExecutedTrade[], initialCapital: number = 1000.0) {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      scratches: 0,
      winRatePct: 0,
      netR: 0,
      grossWinR: 0,
      grossLossR: 0,
      profitFactor: 0,
      expectedValueR: 0,
      maxDrawdownR: 0,
      finalEquity1k: initialCapital,
      maxCompoundedDdPct: 0,
    };
  }

  let wins = 0;
  let losses = 0;
  let scratches = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let netR = 0;

  let cumulativeR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;

  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxCompoundedDdPct = 0;

  for (const t of trades) {
    const r = t.realizedR;
    netR += r;
    cumulativeR += r;
    if (cumulativeR > peakR) peakR = cumulativeR;
    const currentDd = peakR - cumulativeR;
    if (currentDd > maxDrawdownR) maxDrawdownR = currentDd;

    // Dynamic 2% Compounding ($1.0R = Equity * 0.02)
    const tradeRiskDollar = equity * 0.02;
    const dollarPnl = tradeRiskDollar * r;
    equity += dollarPnl;
    if (equity > peakEquity) peakEquity = equity;
    const currentEqDd = ((peakEquity - equity) / peakEquity) * 100;
    if (currentEqDd > maxCompoundedDdPct) maxCompoundedDdPct = currentEqDd;

    if (r > 0.05) {
      if (t.outcome === 'FULL_TP2_WIN' || t.outcome === 'FULL_TP3_WIN' || r >= 1.0) {
        wins++;
      } else {
        scratches++;
      }
      grossWinR += r;
    } else if (r < -0.05) {
      losses++;
      grossLossR += Math.abs(r);
    } else {
      scratches++;
    }
  }

  const winRatePct = parseFloat(((wins / totalTrades) * 100).toFixed(1));
  const profitFactor = grossLossR > 0 ? parseFloat((grossWinR / grossLossR).toFixed(2)) : 99.9;
  const expectedValueR = parseFloat((netR / totalTrades).toFixed(2));

  return {
    totalTrades,
    wins,
    losses,
    scratches,
    winRatePct,
    netR: parseFloat(netR.toFixed(2)),
    grossWinR: parseFloat(grossWinR.toFixed(2)),
    grossLossR: parseFloat(grossLossR.toFixed(2)),
    profitFactor,
    expectedValueR,
    maxDrawdownR: parseFloat(maxDrawdownR.toFixed(2)),
    finalEquity1k: parseFloat(equity.toFixed(2)),
    maxCompoundedDdPct: parseFloat(maxCompoundedDdPct.toFixed(1)),
  };
}

async function main() {
  console.log('═'.repeat(110));
  console.log('🧭 DIRECTIVE 09 — PHASE 4: MACRO HTF CONTEXT & VALUATION GATING EXPERIMENTS');
  console.log('═'.repeat(110));

  const endMs = Date.parse('2026-09-04T00:00:00.000Z');
  const startMs = Date.parse('2025-09-04T00:00:00.000Z');
  const warmupMs = startMs - 5 * 24 * 60 * 60 * 1000;

  const scratchDir = path.join(process.cwd(), 'scratch');
  const cachePath = path.join(scratchDir, `cached_ETHUSDC_5m_1y_${warmupMs}_${endMs}.json`);

  const candles: Candle[] = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

  const pivotOnlyAnchors: SweepReclaimAnchorType[] = ['SWING_PIVOT', 'PDH', 'PDL'];

  // Base V2 Champion Config
  const baseV2ChampionConfig: SweepReclaimScanConfig = {
    symbol: 'ETHUSDC',
    timeframe: '5m',
    anchorTypes: pivotOnlyAnchors,
    lookbackMajor: 10,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 25,
    maxBarsSweepToReclaim: 10,
    maxBarsToRetest: 15,
    volumeSmaPeriod: 20,
    volumeExpansionThreshold: 1.10,
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.40,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
    stage1Multiple: 1.0,
    stage2Multiple: 1.30,
    stage3Multiple: 3.0,
    stage1Ratio: 0.60,
    stage2Ratio: 0.40,
    stage3Ratio: 0.00,
    entryMode: 'FVG_CE',
    enableStructuralTrail: true,
    enableProfitRatchet: false,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.10,
    enableEarlyBreakeven: true,
    earlyBreakevenMultiple: 0.40,
    enableWaveDeduplication: true,
    filterWeekend: false,
    enforceHtfBiasGuard: false,
    postLossCooldownMinutes: 0,
  };

  // Define Experiments across Pillar 1 Macro Gating
  const experiments: Array<{
    id: string;
    name: string;
    factor: string;
    valueTested: number | string;
    overrideConfig: Partial<SweepReclaimScanConfig>;
    enforceHtfBiasGuard: boolean;
    filterWeekend: boolean;
  }> = [
    // 0. The V2 Champion Control
    {
      id: 'BENCHMARK',
      name: 'V2 Champion Baseline Control (No HTF Bias Gate)',
      factor: 'Baseline',
      valueTested: 'HTF Guard: OFF | Wknd: OFF',
      overrideConfig: {},
      enforceHtfBiasGuard: false,
      filterWeekend: false,
    },

    // ── Hypothesis 4.1: Macro Valuation Gating (Rule 3 HTF Guard) ─────────────
    {
      id: 'EXP-P4-01A',
      name: 'Macro HTF Valuation Gate Active',
      factor: 'HTF Valuation Gate',
      valueTested: 'HTF Guard: ON',
      overrideConfig: { enforceHtfBiasGuard: true },
      enforceHtfBiasGuard: true,
      filterWeekend: false,
    },

    // ── Hypothesis 4.2: Weekend Off-Liquidity Filter (Rule 2) ─────────────────
    {
      id: 'EXP-P4-02A',
      name: 'Weekend Off-Liquidity Filter Active (Fri 22:00 - Sun 20:00 UTC)',
      factor: 'Weekend Filter',
      valueTested: 'Filter Weekend: ON',
      overrideConfig: { filterWeekend: true },
      enforceHtfBiasGuard: false,
      filterWeekend: true,
    },

    // ── Hypothesis 4.3: Regime-Adaptive EQ Sensitivity ────────────────────────
    {
      id: 'EXP-P4-03A',
      name: 'Strict Static Structural EQ (No Regime Decoupling)',
      factor: 'Regime Adaptive EQ',
      valueTested: 'enableRegimeAdaptiveEQ: false',
      overrideConfig: { enableRegimeAdaptiveEQ: false, enforceHtfBiasGuard: true },
      enforceHtfBiasGuard: true,
      filterWeekend: false,
    },
    {
      id: 'EXP-P4-03B',
      name: 'Combined Macro Guard + Weekend Shield',
      factor: 'Full Quant Shield',
      valueTested: 'HTF Guard: ON + Wknd: ON',
      overrideConfig: { enforceHtfBiasGuard: true, filterWeekend: true },
      enforceHtfBiasGuard: true,
      filterWeekend: true,
    },
  ];

  console.log(`⚡ Executing ${experiments.length} Candle-by-Candle Path-Dependent Backtests...\n`);

  const results: ExperimentMetric[] = [];
  let benchmarkNetR = 0;
  let benchmarkMaxDd = 0;

  for (let idx = 0; idx < experiments.length; idx++) {
    const exp = experiments[idx];
    const cfg: SweepReclaimScanConfig = {
      ...baseV2ChampionConfig,
      ...exp.overrideConfig,
    };

    const engine = new SweepReclaimEngine(cfg);
    const scanResult = engine.scanHistoricalSetups(candles);
    const setups = scanResult.setups || [];

    const executedTrades = adaptSweepReclaimSetupsToTrades(setups, {
      enforceSinglePositionWalk: true,
      enableWaveDeduplication: cfg.enableWaveDeduplication === true,
      filterWeekend: exp.filterWeekend,
      enforceHtfBiasGuard: exp.enforceHtfBiasGuard,
      enableEarlyBreakeven: cfg.enableEarlyBreakeven === true,
      earlyBreakevenMultiple: cfg.earlyBreakevenMultiple ?? 0.40,
      postLossCooldownMinutes: cfg.postLossCooldownMinutes ?? 0,
    });

    const metrics = evaluateTrades(executedTrades, 1000.0);

    if (exp.id === 'BENCHMARK') {
      benchmarkNetR = metrics.netR;
      benchmarkMaxDd = metrics.maxDrawdownR;
    }

    let hurdleStatus: 'CHAMPION_BENCHMARK' | 'BEATS_HURDLE' | 'FAILED_HURDLE' = 'FAILED_HURDLE';
    let failureReason: string | undefined;

    if (exp.id === 'BENCHMARK') {
      hurdleStatus = 'CHAMPION_BENCHMARK';
    } else {
      const beatsReturn = metrics.netR > benchmarkNetR;
      const slashesDd = metrics.maxDrawdownR < 5.0; // Phase 4 Target: Max DD < -5.0R!
      const passesConstraints =
        metrics.profitFactor >= 1.50 &&
        metrics.maxDrawdownR <= 7.0 &&
        metrics.totalTrades >= 150 &&
        metrics.maxCompoundedDdPct <= 16.0;

      if ((beatsReturn || slashesDd) && passesConstraints) {
        hurdleStatus = 'BEATS_HURDLE';
      } else {
        hurdleStatus = 'FAILED_HURDLE';
        const reasons: string[] = [];
        if (!beatsReturn && !slashesDd) reasons.push(`Neither beat Return (${metrics.netR}R vs ${benchmarkNetR}R) nor slashed DD to < -5.0R (-${metrics.maxDrawdownR}R)`);
        if (metrics.profitFactor < 1.50) reasons.push(`PF ${metrics.profitFactor} < 1.50`);
        if (metrics.maxDrawdownR > 7.0) reasons.push(`DD -${metrics.maxDrawdownR}R > -7.0R`);
        if (metrics.totalTrades < 150) reasons.push(`Trades ${metrics.totalTrades} < 150`);
        if (metrics.maxCompoundedDdPct > 16.0) reasons.push(`Comp DD ${metrics.maxCompoundedDdPct}% > 16%`);
        failureReason = reasons.join('; ');
      }
    }

    results.push({
      experimentId: exp.id,
      name: exp.name,
      factor: exp.factor,
      valueTested: exp.valueTested,
      ...metrics,
      hurdleStatus,
      failureReason,
    });

    const statusBadge =
      hurdleStatus === 'CHAMPION_BENCHMARK'
        ? '🏆 BENCHMARK'
        : hurdleStatus === 'BEATS_HURDLE'
        ? '🟢 BEATS HURDLE'
        : '🔴 REJECTED';

    console.log(
      `[${String(idx + 1).padStart(2)}/${experiments.length}] ${exp.id.padEnd(12)} | Trades: ${String(metrics.totalTrades).padStart(4)} | Win%: ${String(metrics.winRatePct + '%').padStart(5)} | Net R: ${String('+' + metrics.netR.toFixed(1) + 'R').padStart(8)} | PF: ${String(metrics.profitFactor.toFixed(2)).padStart(4)} | Max DD: ${String('-' + metrics.maxDrawdownR.toFixed(1) + 'R').padStart(7)} | $1k Eq: $${Math.round(metrics.finalEquity1k).toLocaleString()} (${metrics.maxCompoundedDdPct}% DD) -> ${statusBadge}`
    );
  }

  console.log('\n' + '═'.repeat(125));
  console.log('📋 PHASE 4 TOURNAMENT LEADERBOARD ($1,000 STARTING CAPITAL · 2% COMPOUNDING · 1-YEAR PARITY)');
  console.log('═'.repeat(125));
  console.log(
    `Experiment ID | Factor Tested      | Value Tested               | Trades | Win%  | Net R    | PF   | Max DD  | $1k Final Eq | Comp DD% | Hurdle Status`
  );
  console.log(
    '--------------+--------------------+----------------------------+--------+-------+----------+------+---------+--------------+----------+----------------'
  );

  for (const r of results) {
    const statusStr =
      r.hurdleStatus === 'CHAMPION_BENCHMARK'
        ? '🏆 BENCHMARK'
        : r.hurdleStatus === 'BEATS_HURDLE'
        ? '🟢 QUALIFIED'
        : '🔴 REJECTED';

    console.log(
      `${r.experimentId.padEnd(13)} | ${r.factor.padEnd(18)} | ${String(r.valueTested).padEnd(26)} | ${String(r.totalTrades).padStart(6)} | ${String(r.winRatePct + '%').padStart(5)} | ${String('+' + r.netR.toFixed(1) + 'R').padStart(8)} | ${String(r.profitFactor.toFixed(2)).padStart(4)} | ${String('-' + r.maxDrawdownR.toFixed(1) + 'R').padStart(7)} | ${String('$' + Math.round(r.finalEquity1k).toLocaleString()).padStart(12)} | ${String(r.maxCompoundedDdPct.toFixed(1) + '%').padStart(8)} | ${statusStr}`
    );
  }

  // Save audit artifact
  const outPath = path.join(scratchDir, 'phase4_macro_results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved detailed Phase 4 results to ${outPath}`);
}

main().catch(console.error);
