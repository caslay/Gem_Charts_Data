/**
 * scripts/run_phase3_harvest_experiments.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Quant Research Roadmap — Phase 3: Dynamic Harvest & Execution Mechanics
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluates Pillar 4 Hypotheses under the 3-Strike Hypothesis Rejection Rule:
 *  - Benchmark: factory_sr_5m_fvg_ce_sniper (+197.9R Net, 1.62 PF, -6.50R Max DD)
 *  - Phase 2 Leader: EXP-P2-HYBRID-A (+217.2R Net, 1.73 PF, -6.30R Max DD, $65,010)
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
  console.log('🧭 DIRECTIVE 09 — PHASE 3: DYNAMIC HARVEST & EXECUTION MECHANICS EXPERIMENTS');
  console.log('═'.repeat(110));

  const endMs = Date.parse('2026-09-04T00:00:00.000Z');
  const startMs = Date.parse('2025-09-04T00:00:00.000Z');
  const warmupMs = startMs - 5 * 24 * 60 * 60 * 1000;

  const scratchDir = path.join(process.cwd(), 'scratch');
  const cachePath = path.join(scratchDir, `cached_ETHUSDC_5m_1y_${warmupMs}_${endMs}.json`);

  const candles: Candle[] = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

  const pivotOnlyAnchors: SweepReclaimAnchorType[] = ['SWING_PIVOT', 'PDH', 'PDL'];

  // Base Qualified Config (Inherited from Phase 1 + Phase 2 Champion)
  const basePhase2ChampionConfig: SweepReclaimScanConfig = {
    symbol: 'ETHUSDC',
    timeframe: '5m',
    anchorTypes: pivotOnlyAnchors,
    lookbackMajor: 10,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 25,
    maxBarsSweepToReclaim: 10,
    maxBarsToRetest: 15, // 15 bars TTL from Phase 2
    volumeSmaPeriod: 20,
    volumeExpansionThreshold: 1.10, // 1.10x from Phase 1
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.40,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
    stage1Multiple: 1.0,
    stage2Multiple: 1.4,
    stage3Multiple: 3.0,
    stage1Ratio: 0.50,
    stage2Ratio: 0.50,
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

  // Define Experiments across Pillar 4 Harvest Mechanics
  const experiments: Array<{
    id: string;
    name: string;
    factor: string;
    valueTested: number | string;
    overrideConfig: Partial<SweepReclaimScanConfig>;
  }> = [
    // 0. The Phase 2 Champion Benchmark
    {
      id: 'BENCHMARK',
      name: 'Phase 2 Champion Control (1.0R / 1.4R | 50/50 | BE 0.40R)',
      factor: 'Baseline',
      valueTested: 'TP2: 1.4R | 50/50 | BE: 0.40R',
      overrideConfig: {},
    },

    // ── Factor 1 (EXP-P3-01): Stage 2 Multiple Target Expansion ─────────────
    {
      id: 'EXP-P3-01A',
      name: 'TP2 Compact Quick Bank (1.30R)',
      factor: 'TP2 Multiple',
      valueTested: '1.30R',
      overrideConfig: { stage2Multiple: 1.30 },
    },
    {
      id: 'EXP-P3-01B',
      name: 'TP2 Moderate Extension (1.50R)',
      factor: 'TP2 Multiple',
      valueTested: '1.50R',
      overrideConfig: { stage2Multiple: 1.50 },
    },
    {
      id: 'EXP-P3-01C',
      name: 'TP2 Wide Expansion (1.60R)',
      factor: 'TP2 Multiple',
      valueTested: '1.60R',
      overrideConfig: { stage2Multiple: 1.60 },
    },
    {
      id: 'EXP-P3-01D',
      name: 'TP2 Extended Runner (1.80R)',
      factor: 'TP2 Multiple',
      valueTested: '1.80R',
      overrideConfig: { stage2Multiple: 1.80 },
    },

    // ── Factor 2 (EXP-P3-02): Harvest Allocation Weighting ──────────────────
    {
      id: 'EXP-P3-02A',
      name: 'Heavy TP2 Runner Allocation (40% @ 1.0R / 60% @ 1.4R)',
      factor: 'Tranche Split',
      valueTested: '40/60 Split',
      overrideConfig: { stage1Ratio: 0.40, stage2Ratio: 0.60 },
    },
    {
      id: 'EXP-P3-02B',
      name: 'Conservative Front-Loaded Bank (60% @ 1.0R / 40% @ 1.4R)',
      factor: 'Tranche Split',
      valueTested: '60/40 Split',
      overrideConfig: { stage1Ratio: 0.60, stage2Ratio: 0.40 },
    },
    {
      id: 'EXP-P3-02C',
      name: '3-Stage Moonbag Runner (40% @ 1.0R / 40% @ 1.4R / 20% @ 2.5R)',
      factor: 'Tranche Split',
      valueTested: '40/40/20 Moonbag',
      overrideConfig: { stage1Ratio: 0.40, stage2Ratio: 0.40, stage3Ratio: 0.20, stage3Multiple: 2.5 },
    },

    // ── Factor 3 (EXP-P3-03): Early Breakeven Ratchet Multiple ───────────────
    {
      id: 'EXP-P3-03A',
      name: 'Hyper-Protective Breakeven (0.30R)',
      factor: 'Early BE Multiple',
      valueTested: '0.30R',
      overrideConfig: { earlyBreakevenMultiple: 0.30 },
    },
    {
      id: 'EXP-P3-03B',
      name: 'Breathing Room Breakeven (0.50R)',
      factor: 'Early BE Multiple',
      valueTested: '0.50R',
      overrideConfig: { earlyBreakevenMultiple: 0.50 },
    },
    {
      id: 'EXP-P3-03C',
      name: 'Late Breakeven (0.60R)',
      factor: 'Early BE Multiple',
      valueTested: '0.60R',
      overrideConfig: { earlyBreakevenMultiple: 0.60 },
    },
  ];

  console.log(`⚡ Executing ${experiments.length} Candle-by-Candle Path-Dependent Backtests...\n`);

  const results: ExperimentMetric[] = [];
  let benchmarkNetR = 0;
  let benchmarkMaxDd = 0;

  for (let idx = 0; idx < experiments.length; idx++) {
    const exp = experiments[idx];
    const cfg: SweepReclaimScanConfig = {
      ...basePhase2ChampionConfig,
      ...exp.overrideConfig,
    };

    const engine = new SweepReclaimEngine(cfg);
    const scanResult = engine.scanHistoricalSetups(candles);
    const setups = scanResult.setups || [];

    const executedTrades = adaptSweepReclaimSetupsToTrades(setups, {
      enforceSinglePositionWalk: true,
      enableWaveDeduplication: cfg.enableWaveDeduplication === true,
      filterWeekend: cfg.filterWeekend === true,
      enforceHtfBiasGuard: cfg.enforceHtfBiasGuard === true,
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
      const slashesDd = metrics.maxDrawdownR < 6.0;
      const passesConstraints =
        metrics.profitFactor >= 1.50 &&
        metrics.maxDrawdownR <= 8.0 &&
        metrics.totalTrades >= 150 &&
        metrics.maxCompoundedDdPct <= 16.0;

      if ((beatsReturn || slashesDd) && passesConstraints) {
        hurdleStatus = 'BEATS_HURDLE';
      } else {
        hurdleStatus = 'FAILED_HURDLE';
        const reasons: string[] = [];
        if (!beatsReturn && !slashesDd) reasons.push(`Neither beat Return (${metrics.netR}R vs ${benchmarkNetR}R) nor DD (-${metrics.maxDrawdownR}R vs -6.0R)`);
        if (metrics.profitFactor < 1.50) reasons.push(`PF ${metrics.profitFactor} < 1.50`);
        if (metrics.maxDrawdownR > 8.0) reasons.push(`DD -${metrics.maxDrawdownR}R > -8.0R`);
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
  console.log('📋 PHASE 3 TOURNAMENT LEADERBOARD ($1,000 STARTING CAPITAL · 2% COMPOUNDING · 1-YEAR PARITY)');
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
  const outPath = path.join(scratchDir, 'phase3_harvest_results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved detailed Phase 3 results to ${outPath}`);
}

main().catch(console.error);
