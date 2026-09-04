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
      profitFactor: 0,
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
    maxDrawdownR: parseFloat(maxDrawdownR.toFixed(2)),
    finalEquity1k: parseFloat(equity.toFixed(2)),
    maxCompoundedDdPct: parseFloat(maxCompoundedDdPct.toFixed(1)),
  };
}

async function main() {
  console.log('═'.repeat(100));
  console.log('🔬 PHASE 1: 3-REGIME & MULTI-MONTH ANTI-FRAGILITY AUDIT');
  console.log('═'.repeat(100));

  const endMs = Date.parse('2026-09-04T00:00:00.000Z');
  const startMs = Date.parse('2025-09-04T00:00:00.000Z');
  const warmupMs = startMs - 5 * 24 * 60 * 60 * 1000;

  const scratchDir = path.join(process.cwd(), 'scratch');
  const cachePath = path.join(scratchDir, `cached_ETHUSDC_5m_1y_${warmupMs}_${endMs}.json`);

  const candles: Candle[] = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

  const baseChampionConfig: SweepReclaimScanConfig = {
    symbol: 'ETHUSDC',
    timeframe: '5m',
    anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
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

  const candidates = [
    {
      id: 'BENCHMARK',
      name: 'Champion Control (Vol 1.20x | Body 0.40)',
      cfg: { ...baseChampionConfig },
    },
    {
      id: 'CANDIDATE_1.10X',
      name: 'EXP-P1-02A (Vol 1.10x | Body 0.40)',
      cfg: { ...baseChampionConfig, volumeExpansionThreshold: 1.10 },
    },
    {
      id: 'CANDIDATE_1.10X_BODY0.50',
      name: 'EXP-P1-HYBRID (Vol 1.10x | Body 0.50)',
      cfg: { ...baseChampionConfig, volumeExpansionThreshold: 1.10, bodyRatioThreshold: 0.50 },
    },
    {
      id: 'EXP-P1-03B',
      name: 'EXP-P1-03B (Vol 1.20x | Body 0.50)',
      cfg: { ...baseChampionConfig, bodyRatioThreshold: 0.50 },
    },
  ];

  for (const c of candidates) {
    console.log(`\n────────────────────────────────────────────────────────────────────────────────`);
    console.log(`🔎 Auditing: ${c.name} [${c.id}]`);
    console.log(`────────────────────────────────────────────────────────────────────────────────`);

    const engine = new SweepReclaimEngine(c.cfg);
    const scanResult = engine.scanHistoricalSetups(candles);
    const setups = scanResult.setups || [];

    const executedTrades = adaptSweepReclaimSetupsToTrades(setups, {
      enforceSinglePositionWalk: true,
      enableWaveDeduplication: c.cfg.enableWaveDeduplication === true,
      filterWeekend: c.cfg.filterWeekend === true,
      enforceHtfBiasGuard: c.cfg.enforceHtfBiasGuard === true,
      enableEarlyBreakeven: c.cfg.enableEarlyBreakeven === true,
      earlyBreakevenMultiple: c.cfg.earlyBreakevenMultiple ?? 0.40,
      postLossCooldownMinutes: c.cfg.postLossCooldownMinutes ?? 0,
    });

    const fullMetrics = evaluateTrades(executedTrades, 1000.0);
    console.log(
      `FULL 1-YEAR: Trades: ${fullMetrics.totalTrades} | Net R: +${fullMetrics.netR}R | PF: ${fullMetrics.profitFactor} | Max DD: -${fullMetrics.maxDrawdownR}R | $1k Eq: $${Math.round(fullMetrics.finalEquity1k).toLocaleString()} (${fullMetrics.maxCompoundedDdPct}% DD)`
    );

    // Month by Month Breakdown
    console.log('\nMonthly Breakdown:');
    console.log('Month     | Trades | Net R   | PF   | Max DD | Win%');
    console.log('----------+--------+---------+------+--------+------');

    const monthlyTrades: { [key: string]: StandardizedExecutedTrade[] } = {};

    for (const t of executedTrades) {
      const d = new Date(t.timestamp);
      const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!monthlyTrades[monthKey]) monthlyTrades[monthKey] = [];
      monthlyTrades[monthKey].push(t);
    }

    const months = Object.keys(monthlyTrades).sort();
    let losingMonths = 0;
    for (const m of months) {
      const mTrades = monthlyTrades[m];
      const mMetrics = evaluateTrades(mTrades, 1000.0);
      if (mMetrics.netR < 0) losingMonths++;
      const netRStr = mMetrics.netR >= 0 ? `+${mMetrics.netR.toFixed(1)}R` : `${mMetrics.netR.toFixed(1)}R`;
      console.log(
        `${m.padEnd(9)} | ${String(mMetrics.totalTrades).padStart(6)} | ${netRStr.padStart(7)} | ${String(mMetrics.profitFactor.toFixed(2)).padStart(4)} | ${String('-' + mMetrics.maxDrawdownR.toFixed(1) + 'R').padStart(6)} | ${mMetrics.winRatePct}%`
      );
    }
    console.log(`Losing Months: ${losingMonths} / ${months.length}`);
  }
}

main().catch(console.error);
