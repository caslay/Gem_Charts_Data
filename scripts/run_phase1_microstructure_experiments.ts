/**
 * scripts/run_phase1_microstructure_experiments.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Quant Research Roadmap — Phase 1: Microstructure & Volumetric Absorption
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluates Pillar 3 Hypotheses under the 3-Strike Hypothesis Rejection Rule:
 *  - Benchmark: factory_sr_5m_fvg_ce_sniper (+191.9R Net, 1.61 PF, -6.50R Max DD)
 *  - Standard Initial Capital: $1,000 USD (2% Dynamic Compounding = $20.00 / 1.0R)
 *  - 100% Bit-for-Bit Bit Parity to PM2 Live Headless Daemon
 *  - Next-Bar Ratchet Rule & True Candle-by-Candle Path Reality
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
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
  exScratchWinRatePct: number;
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
      exScratchWinRatePct: 0,
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
  const exScratchWinRatePct =
    wins + losses > 0 ? parseFloat(((wins / (wins + losses)) * 100).toFixed(1)) : 0;
  const profitFactor = grossLossR > 0 ? parseFloat((grossWinR / grossLossR).toFixed(2)) : 99.9;
  const expectedValueR = parseFloat((netR / totalTrades).toFixed(2));

  return {
    totalTrades,
    wins,
    losses,
    scratches,
    winRatePct,
    exScratchWinRatePct,
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
  console.log('🧭 DIRECTIVE 09 — PHASE 1: MICROSTRUCTURE & VOLUMETRIC ABSORPTION EXPERIMENTS');
  console.log('═'.repeat(110));

  const endMs = Date.parse('2026-09-04T00:00:00.000Z');
  const startMs = Date.parse('2025-09-04T00:00:00.000Z');
  const warmupMs = startMs - 5 * 24 * 60 * 60 * 1000;

  const scratchDir = path.join(process.cwd(), 'scratch');
  const cachePath = path.join(scratchDir, `cached_ETHUSDC_5m_1y_${warmupMs}_${endMs}.json`);

  if (!fs.existsSync(cachePath)) {
    console.error(`❌ Cache not found at ${cachePath}`);
    process.exit(1);
  }

  console.log(`📂 Loading cached 1-year historical dataset (106,560 5m candles)...`);
  const candles: Candle[] = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  console.log(`✅ Loaded ${candles.length} historical candles.\n`);

  const allAnchors: any[] = ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'];

  // Base Champion Config (`factory_sr_5m_fvg_ce_sniper`)
  const baseChampionConfig: SweepReclaimScanConfig = {
    symbol: 'ETHUSDC',
    timeframe: '5m',
    anchorTypes: allAnchors,
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

  // Define Experiments across Pillar 3 Microstructure
  const experiments: Array<{
    id: string;
    name: string;
    factor: string;
    valueTested: number | string;
    overrideConfig: Partial<SweepReclaimScanConfig>;
  }> = [
    // 0. The Champion Benchmark
    {
      id: 'BENCHMARK',
      name: 'Champion Control (Baseline)',
      factor: 'Baseline',
      valueTested: '52% Delta | 1.20x Vol | 0.40 Body',
      overrideConfig: {},
    },

    // ── Hypothesis 1 (EXP-P1-01): Taker Delta Dominance Threshold ───────────
    {
      id: 'EXP-P1-01A',
      name: 'Delta Neutral Gate (50.0%)',
      factor: 'Delta Dominance',
      valueTested: '50.0%',
      overrideConfig: { deltaDominanceThreshold: 50.0 },
    },
    {
      id: 'EXP-P1-01B',
      name: 'Delta Institutional Aggression (55.0%)',
      factor: 'Delta Dominance',
      valueTested: '55.0%',
      overrideConfig: { deltaDominanceThreshold: 55.0 },
    },
    {
      id: 'EXP-P1-01C',
      name: 'Delta Decisive Conviction (58.0%)',
      factor: 'Delta Dominance',
      valueTested: '58.0%',
      overrideConfig: { deltaDominanceThreshold: 58.0 },
    },

    // ── Hypothesis 2 (EXP-P1-02): Volume Expansion Multiplier vs SMA20 ──────
    {
      id: 'EXP-P1-02A',
      name: 'Volume Permissive Expansion (1.10x)',
      factor: 'Volume Expansion',
      valueTested: '1.10x',
      overrideConfig: { volumeExpansionThreshold: 1.10 },
    },
    {
      id: 'EXP-P1-02B',
      name: 'Volume Institutional Surge (1.35x)',
      factor: 'Volume Expansion',
      valueTested: '1.35x',
      overrideConfig: { volumeExpansionThreshold: 1.35 },
    },
    {
      id: 'EXP-P1-02C',
      name: 'Volume Explosive Climax (1.50x)',
      factor: 'Volume Expansion',
      valueTested: '1.50x',
      overrideConfig: { volumeExpansionThreshold: 1.50 },
    },

    // ── Hypothesis 3 (EXP-P1-03): Candle Body-to-Range Conviction Ratio ─────
    {
      id: 'EXP-P1-03A',
      name: 'Body Ratio Relaxed (0.30)',
      factor: 'Body-to-Range',
      valueTested: '0.30',
      overrideConfig: { bodyRatioThreshold: 0.30 },
    },
    {
      id: 'EXP-P1-03B',
      name: 'Body Ratio Strict Impulse (0.50)',
      factor: 'Body-to-Range',
      valueTested: '0.50',
      overrideConfig: { bodyRatioThreshold: 0.50 },
    },
    {
      id: 'EXP-P1-03C',
      name: 'Body Ratio Solid Marubozu (0.60)',
      factor: 'Body-to-Range',
      valueTested: '0.60',
      overrideConfig: { bodyRatioThreshold: 0.60 },
    },
  ];

  console.log(`⚡ Executing ${experiments.length} Candle-by-Candle Path-Dependent Backtests...\n`);

  const results: ExperimentMetric[] = [];
  let benchmarkNetR = 0;
  let benchmarkMaxDd = 0;

  for (let idx = 0; idx < experiments.length; idx++) {
    const exp = experiments[idx];
    const cfg: SweepReclaimScanConfig = {
      ...baseChampionConfig,
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

    // Hurdle Rate Evaluation:
    // Net R > +191.9R OR Max DD < -6.0R, while PF >= 1.50, Max DD <= -8.0R, N >= 150
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
      `[${String(idx + 1).padStart(2)}/${experiments.length}] ${exp.id.padEnd(12)} | Trades: ${String(metrics.totalTrades).padStart(3)} | Win%: ${String(metrics.winRatePct + '%').padStart(5)} | Net R: ${String('+' + metrics.netR.toFixed(1) + 'R').padStart(8)} | PF: ${String(metrics.profitFactor.toFixed(2)).padStart(4)} | Max DD: ${String('-' + metrics.maxDrawdownR.toFixed(1) + 'R').padStart(7)} | $1k Eq: $${Math.round(metrics.finalEquity1k).toLocaleString()} (${metrics.maxCompoundedDdPct}% DD) -> ${statusBadge}`
    );
  }

  console.log('\n' + '═'.repeat(125));
  console.log('📋 PHASE 1 TOURNAMENT LEADERBOARD ($1,000 STARTING CAPITAL · 2% COMPOUNDING · 1-YEAR PARITY)');
  console.log('═'.repeat(125));
  console.log(
    `Experiment ID | Factor Tested      | Value   | Trades | Win%  | Net R    | PF   | Max DD  | $1k Final Eq | Comp DD% | Hurdle Status`
  );
  console.log(
    '--------------+--------------------+---------+--------+-------+----------+------+---------+--------------+----------+----------------'
  );

  for (const r of results) {
    const statusStr =
      r.hurdleStatus === 'CHAMPION_BENCHMARK'
        ? '🏆 BENCHMARK'
        : r.hurdleStatus === 'BEATS_HURDLE'
        ? '🟢 QUALIFIED'
        : '🔴 REJECTED';

    console.log(
      `${r.experimentId.padEnd(13)} | ${r.factor.padEnd(18)} | ${String(r.valueTested).padEnd(7)} | ${String(r.totalTrades).padStart(6)} | ${String(r.winRatePct + '%').padStart(5)} | ${String('+' + r.netR.toFixed(1) + 'R').padStart(8)} | ${String(r.profitFactor.toFixed(2)).padStart(4)} | ${String('-' + r.maxDrawdownR.toFixed(1) + 'R').padStart(7)} | ${String('$' + Math.round(r.finalEquity1k).toLocaleString()).padStart(12)} | ${String(r.maxCompoundedDdPct.toFixed(1) + '%').padStart(8)} | ${statusStr}`
    );
  }

  // Save audit artifact
  const outPath = path.join(scratchDir, 'phase1_microstructure_results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved detailed Phase 1 results to ${outPath}`);
}

main().catch(console.error);
