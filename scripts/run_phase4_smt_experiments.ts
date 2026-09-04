/**
 * scripts/run_phase4_smt_experiments.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Quant Research Roadmap — Phase 4: BTC vs ETH Intermarket SMT Divergence
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests whether gating Sweep & Reclaim entries by BTC SMT Divergence compresses
 * Drawdown below -5.0R while preserving statistical sample size and high compounding.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup,
  SweepReclaimAnchorType,
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';
import {
  adaptSweepReclaimSetupsToTrades,
  StandardizedExecutedTrade,
} from '../src/lib/quantEngine/equityCalculator';

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
  console.log('🧭 DIRECTIVE 09 — PHASE 4: BTC vs ETH INTERMARKET SMT DIVERGENCE EXPERIMENTS');
  console.log('═'.repeat(110));

  const endMs = Date.parse('2026-09-04T00:00:00.000Z');
  const startMs = Date.parse('2025-09-04T00:00:00.000Z');
  const warmupMs = startMs - 5 * 24 * 60 * 60 * 1000;

  const scratchDir = path.join(process.cwd(), 'scratch');
  const ethCachePath = path.join(scratchDir, `cached_ETHUSDC_5m_1y_${warmupMs}_${endMs}.json`);
  const btcCachePath = path.join(scratchDir, `cached_BTCUSDT_5m_1y_${warmupMs}_${endMs}.json`);

  console.log(`📂 Loading ETH 1-Year Dataset (106,560 candles)...`);
  const ethCandles: Candle[] = JSON.parse(fs.readFileSync(ethCachePath, 'utf8'));

  console.log(`📂 Loading BTC 1-Year Dataset (106,560 candles)...`);
  const btcCandles: Candle[] = JSON.parse(fs.readFileSync(btcCachePath, 'utf8'));

  // Build quick timestamp map for BTC candles
  const btcMap = new Map<number, { candle: Candle; index: number }>();
  for (let i = 0; i < btcCandles.length; i++) {
    btcMap.set(btcCandles[i].t, { candle: btcCandles[i], index: i });
  }

  const pivotOnlyAnchors: SweepReclaimAnchorType[] = ['SWING_PIVOT', 'PDH', 'PDL'];

  // Base V2 Champion Config
  const v2Config: SweepReclaimScanConfig = {
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

  console.log(`\n🔍 Scanning ETH Setups with V2 Champion Engine...`);
  const engine = new SweepReclaimEngine(v2Config);
  const scanResult = engine.scanHistoricalSetups(ethCandles);
  const rawSetups = scanResult.setups || [];
  console.log(`✅ Scanned ${rawSetups.length} raw setups.`);

  // Function to classify BTC SMT divergence for an ETH setup
  function classifySmt(setup: SweepReclaimSetup, lookback: number = 15): 'BULLISH_SMT' | 'BEARISH_SMT' | 'SYMMETRIC' | 'INVERTED_TRAP' | 'UNKNOWN' {
    const sweepTime = setup.sweep_time;
    if (!sweepTime) return 'UNKNOWN';

    const btcEntry = btcMap.get(sweepTime);
    if (!btcEntry) return 'UNKNOWN';

    const btcIdx = btcEntry.index;
    if (btcIdx < lookback + 1) return 'UNKNOWN';

    const targetBtc = btcCandles[btcIdx];
    const prevBtc = btcCandles.slice(btcIdx - lookback, btcIdx);

    const prevMinLow = Math.min(...prevBtc.map((c) => c.l));
    const prevMaxHigh = Math.max(...prevBtc.map((c) => c.h));

    const btcBrokeLow = targetBtc.l < prevMinLow;
    const btcBrokeHigh = targetBtc.h > prevMaxHigh;

    if (setup.type === 'BULLISH') {
      // ETH swept low. Did BTC hold higher low?
      if (!btcBrokeLow) {
        return 'BULLISH_SMT'; // Strong Bullish SMT divergence: BTC held Higher Low
      } else {
        return 'SYMMETRIC'; // Both broke low
      }
    } else {
      // ETH swept high. Did BTC hold lower high?
      if (!btcBrokeHigh) {
        return 'BEARISH_SMT'; // Strong Bearish SMT divergence: BTC held Lower High
      } else {
        return 'SYMMETRIC'; // Both broke high
      }
    }
  }

  // Annotate all setups with SMT classification
  const annotated = rawSetups.map((s) => ({
    setup: s,
    smt: classifySmt(s, 15),
  }));

  const smtCounts = {
    BULLISH_SMT: annotated.filter((a) => a.smt === 'BULLISH_SMT').length,
    BEARISH_SMT: annotated.filter((a) => a.smt === 'BEARISH_SMT').length,
    SYMMETRIC: annotated.filter((a) => a.smt === 'SYMMETRIC').length,
    UNKNOWN: annotated.filter((a) => a.smt === 'UNKNOWN').length,
  };
  console.log(`📊 SMT Distribution:`, smtCounts);

  // Define SMT Filter Scenarios
  const scenarios = [
    {
      id: 'V2_CHAMPION_ALL',
      name: 'V2 Champion (All Setups / SMT Filter OFF)',
      filter: () => true,
    },
    {
      id: 'SMT_STRICT_DIVERGENCE',
      name: 'Strict SMT Divergence Only (Bullish SMT on Longs / Bearish SMT on Shorts)',
      filter: (a: typeof annotated[0]) =>
        (a.setup.type === 'BULLISH' && a.smt === 'BULLISH_SMT') ||
        (a.setup.type === 'BEARISH' && a.smt === 'BEARISH_SMT'),
    },
    {
      id: 'SMT_SYMMETRIC_ONLY',
      name: 'Symmetric Sweeps Only (Both ETH & BTC Sweep Together)',
      filter: (a: typeof annotated[0]) => a.smt === 'SYMMETRIC',
    },
  ];

  console.log('\n' + '═'.repeat(125));
  console.log('📋 PHASE 4 SMT TOURNAMENT LEADERBOARD ($1,000 STARTING CAPITAL · 2% COMPOUNDING · 1-YEAR PARITY)');
  console.log('═'.repeat(125));
  console.log(
    `Scenario ID           | Filter Logic               | Trades | Win%  | Net R    | PF   | Max DD  | $1k Final Eq | Comp DD% | Hurdle Status`
  );
  console.log(
    '----------------------+----------------------------+--------+-------+----------+------+---------+--------------+----------+----------------'
  );

  for (const sc of scenarios) {
    const candidateSetups = annotated.filter(sc.filter).map((a) => a.setup);

    const trades = adaptSweepReclaimSetupsToTrades(candidateSetups, {
      enforceSinglePositionWalk: true,
      enableWaveDeduplication: true,
      filterWeekend: false,
      enforceHtfBiasGuard: false,
      enableEarlyBreakeven: true,
      earlyBreakevenMultiple: 0.40,
      postLossCooldownMinutes: 0,
    });

    const m = evaluateTrades(trades, 1000.0);

    const statusStr =
      sc.id === 'V2_CHAMPION_ALL'
        ? '🏆 BENCHMARK'
        : m.maxDrawdownR < 5.0 && m.profitFactor >= 1.50
        ? '🟢 SLASHES DD (< -5.0R)'
        : m.netR > 223.76
        ? '🟢 BEATS RETURN'
        : '🔴 REJECTED';

    console.log(
      `${sc.id.padEnd(21)} | ${sc.name.substring(0, 26).padEnd(26)} | ${String(m.totalTrades).padStart(6)} | ${String(m.winRatePct + '%').padStart(5)} | ${String('+' + m.netR.toFixed(1) + 'R').padStart(8)} | ${String(m.profitFactor.toFixed(2)).padStart(4)} | ${String('-' + m.maxDrawdownR.toFixed(1) + 'R').padStart(7)} | ${String('$' + Math.round(m.finalEquity1k).toLocaleString()).padStart(12)} | ${String(m.maxCompoundedDdPct.toFixed(1) + '%').padStart(8)} | ${statusStr}`
    );
  }
}

main().catch(console.error);
