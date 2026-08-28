import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup,
  SweepReclaimTelemetry
} from '../src/lib/quantEngine/SweepReclaimEngine';

interface TemporalBucket {
  key: string;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number;
  slHitRatePct: number;
  netR: number;
  profitFactor: number;
  expectedValueR: number;
  grossWinR: number;
  grossLossR: number;
  avgWinR: number;
  avgLossR: number;
  maxDrawdownR: number;
}

function computeBucketMetrics(key: string, label: string, tradeList: SweepReclaimSetup[]): TemporalBucket {
  let netR = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let wins = 0;
  let losses = 0;
  let scratches = 0;

  for (const t of tradeList) {
    netR += t.realized_rr;
    if (t.simulated_outcome === 'FULL_TP3_WIN' || t.simulated_outcome === 'FULL_TP2_WIN') {
      wins++;
    } else if (t.simulated_outcome === 'STOPPED_OUT') {
      losses++;
    } else {
      scratches++;
    }

    if (t.realized_rr > 0) {
      grossWinR += t.realized_rr;
    } else {
      grossLossR += Math.abs(t.realized_rr);
    }
  }

  const n = tradeList.length;
  const winRate = n > 0 ? (wins / n) * 100 : 0;
  const slHitRate = n > 0 ? (losses / n) * 100 : 0;
  const pf = grossLossR > 0 ? grossWinR / grossLossR : grossWinR > 0 ? 99.9 : 0;
  const ev = n > 0 ? netR / n : 0;
  const avgWin = wins > 0 ? grossWinR / wins : 0;
  const avgLoss = losses > 0 ? grossLossR / losses : 0;

  // Max Drawdown in R
  let peakR = 0;
  let currentR = 0;
  let maxDDR = 0;
  for (const t of tradeList) {
    currentR += t.realized_rr;
    if (currentR > peakR) peakR = currentR;
    const dd = peakR - currentR;
    if (dd > maxDDR) maxDDR = dd;
  }

  return {
    key,
    label,
    trades: n,
    wins,
    losses,
    scratches,
    winRatePct: parseFloat(winRate.toFixed(1)),
    slHitRatePct: parseFloat(slHitRate.toFixed(1)),
    netR: parseFloat(netR.toFixed(2)),
    profitFactor: parseFloat(pf.toFixed(2)),
    expectedValueR: parseFloat(ev.toFixed(2)),
    grossWinR: parseFloat(grossWinR.toFixed(2)),
    grossLossR: parseFloat(grossLossR.toFixed(2)),
    avgWinR: parseFloat(avgWin.toFixed(2)),
    avgLossR: parseFloat(avgLoss.toFixed(2)),
    maxDrawdownR: parseFloat(maxDDR.toFixed(2)),
  };
}

function getSessionCategory(hourUtc: number): { key: string; name: string; cairoHours: string } {
  if (hourUtc >= 0 && hourUtc < 7) {
    return { key: 'ASIAN_SESSION', name: 'Asian Session (00:00–07:00 UTC)', cairoHours: '03:00–10:00 Cairo' };
  } else if (hourUtc >= 7 && hourUtc < 10) {
    return { key: 'LONDON_AM_KZ', name: 'London AM Killzone (07:00–10:00 UTC)', cairoHours: '10:00–13:00 Cairo' };
  } else if (hourUtc >= 10 && hourUtc < 12) {
    return { key: 'LONDON_LUNCH', name: 'London Midday (10:00–12:00 UTC)', cairoHours: '13:00–15:00 Cairo' };
  } else if (hourUtc >= 12 && hourUtc < 15) {
    return { key: 'NY_AM_KZ', name: 'NY AM Killzone (12:00–15:00 UTC)', cairoHours: '15:00–18:00 Cairo' };
  } else if (hourUtc >= 15 && hourUtc < 17) {
    return { key: 'NY_DEAD_ZONE', name: 'NY Lunch / Dead Zone (15:00–17:00 UTC)', cairoHours: '18:00–20:00 Cairo' };
  } else if (hourUtc >= 17 && hourUtc < 20) {
    return { key: 'NY_PM_KZ', name: 'NY PM Killzone (17:00–20:00 UTC)', cairoHours: '20:00–23:00 Cairo' };
  } else {
    return { key: 'ASIAN_EVE_ROLL', name: 'Asian Eve / Rollover (20:00–00:00 UTC)', cairoHours: '23:00–03:00 Cairo' };
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function analyzePeriod(
  periodName: string,
  candles: Candle[],
  config: SweepReclaimScanConfig
) {
  const engine = new SweepReclaimEngine(config);
  const { setups, telemetry } = engine.scanHistoricalSetups(candles);
  const executedTrades = setups.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');

  // Overall Bucket
  const overall = computeBucketMetrics('ALL', periodName, executedTrades);

  // Session Groups
  const sessionGroups: Record<string, { label: string; list: SweepReclaimSetup[] }> = {
    ASIAN_SESSION: { label: 'Asian Session (00:00–07:00 UTC | 03:00–10:00 Cairo)', list: [] },
    LONDON_AM_KZ: { label: 'London AM Killzone (07:00–10:00 UTC | 10:00–13:00 Cairo)', list: [] },
    LONDON_LUNCH: { label: 'London Midday / Lunch (10:00–12:00 UTC | 13:00–15:00 Cairo)', list: [] },
    NY_AM_KZ: { label: 'NY AM Killzone (12:00–15:00 UTC | 15:00–18:00 Cairo)', list: [] },
    NY_DEAD_ZONE: { label: 'NY Midday / Dead Zone (15:00–17:00 UTC | 18:00–20:00 Cairo)', list: [] },
    NY_PM_KZ: { label: 'NY PM Killzone (17:00–20:00 UTC | 20:00–23:00 Cairo)', list: [] },
    ASIAN_EVE_ROLL: { label: 'Asian Eve / Rollover (20:00–00:00 UTC | 23:00–03:00 Cairo)', list: [] },
  };

  for (const t of executedTrades) {
    const tradeTime = t.retest_time || t.anchor_time;
    const hourUtc = new Date(tradeTime).getUTCHours();
    const session = getSessionCategory(hourUtc);
    if (sessionGroups[session.key]) {
      sessionGroups[session.key].list.push(t);
    }
  }

  const sessionResults: TemporalBucket[] = Object.entries(sessionGroups).map(([k, v]) =>
    computeBucketMetrics(k, v.label, v.list)
  );

  // Day of Week Groups
  const tradesByDayOfWeek = new Map<number, SweepReclaimSetup[]>();
  for (let d = 0; d < 7; d++) tradesByDayOfWeek.set(d, []);

  for (const t of executedTrades) {
    const tradeTime = t.retest_time || t.anchor_time;
    const dayOfWeek = new Date(tradeTime).getUTCDay();
    tradesByDayOfWeek.get(dayOfWeek)!.push(t);
  }

  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const dayOfWeekResults: TemporalBucket[] = dayOrder.map((d) =>
    computeBucketMetrics(String(d), DAY_NAMES[d], tradesByDayOfWeek.get(d)!)
  );

  // Day of Week x Session Cross-Matrix
  const matrixBuckets = new Map<string, { label: string; list: SweepReclaimSetup[] }>();
  for (const d of dayOrder) {
    for (const sKey of Object.keys(sessionGroups)) {
      const cellKey = `${DAY_NAMES[d]}_${sKey}`;
      const cellLabel = `${DAY_NAMES[d]} — ${sessionGroups[sKey].label.split('(')[0].trim()} (${sessionGroups[sKey].label.split('|')[1]?.replace(')', '').trim() || ''})`;
      matrixBuckets.set(cellKey, { label: cellLabel, list: [] });
    }
  }

  for (const t of executedTrades) {
    const tradeTime = t.retest_time || t.anchor_time;
    const dt = new Date(tradeTime);
    const dayOfWeek = dt.getUTCDay();
    const hourUtc = dt.getUTCHours();
    const session = getSessionCategory(hourUtc);
    const cellKey = `${DAY_NAMES[dayOfWeek]}_${session.key}`;
    if (matrixBuckets.has(cellKey)) {
      matrixBuckets.get(cellKey)!.list.push(t);
    }
  }

  const matrixResults: TemporalBucket[] = Array.from(matrixBuckets.entries()).map(([k, v]) =>
    computeBucketMetrics(k, v.label, v.list)
  );

  // 12 Months Chronological Breakdown
  const tradesByMonth = new Map<string, SweepReclaimSetup[]>();
  for (const t of executedTrades) {
    const tradeTime = t.retest_time || t.anchor_time;
    const mKey = new Date(tradeTime).toISOString().slice(0, 7);
    if (!tradesByMonth.has(mKey)) tradesByMonth.set(mKey, []);
    tradesByMonth.get(mKey)!.push(t);
  }

  const monthlyResults: TemporalBucket[] = Array.from(tradesByMonth.keys())
    .sort()
    .map((m) => computeBucketMetrics(m, m, tradesByMonth.get(m)!));

  // Rankings
  const sortedSessionsByProfit = [...sessionResults].sort((a, b) => b.netR - a.netR);
  const mostProfitSession = sortedSessionsByProfit[0];

  const sortedSessionsBySafety = [...sessionResults]
    .filter((s) => s.trades >= 100)
    .sort((a, b) => a.slHitRatePct - b.slHitRatePct || b.profitFactor - a.profitFactor);
  const lessLossSession = sortedSessionsBySafety[0];

  const sortedDaysByProfit = [...dayOfWeekResults].sort((a, b) => b.netR - a.netR);
  const mostProfitDay = sortedDaysByProfit[0];

  const sortedDaysBySafety = [...dayOfWeekResults].sort((a, b) => a.slHitRatePct - b.slHitRatePct);
  const lessLossDay = sortedDaysBySafety[0];

  const validMatrixCells = matrixResults.filter((m) => m.trades >= 25);
  const sortedMatrixByEV = [...validMatrixCells].sort((a, b) => {
    const scoreA = a.netR * 0.4 + a.expectedValueR * 50 + a.profitFactor * 10 - a.slHitRatePct * 5;
    const scoreB = b.netR * 0.4 + b.expectedValueR * 50 + b.profitFactor * 10 - b.slHitRatePct * 5;
    return scoreB - scoreA;
  });
  const ultimateDayTimePeriod = sortedMatrixByEV[0];

  return {
    periodName,
    candlesCount: candles.length,
    dateRange: `${new Date(candles[0].t).toISOString().slice(0, 10)} to ${new Date(candles[candles.length - 1].t).toISOString().slice(0, 10)}`,
    telemetry,
    executedTradesCount: executedTrades.length,
    overall,
    sessionResults,
    dayOfWeekResults,
    matrixResults: sortedMatrixByEV,
    monthlyResults,
    mostProfitPeriod: {
      session: mostProfitSession,
      day: mostProfitDay,
    },
    lessLossPeriod: {
      session: lessLossSession,
      day: lessLossDay,
    },
    ultimateDayTimePeriod,
    rawTrades: executedTrades,
  };
}

async function main() {
  const championConfig: SweepReclaimScanConfig = {
    symbol: 'ETHUSDC',
    timeframe: '5m',
    anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
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
  };

  // Load Year 1 (2024-2025)
  const pathYear1 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_2024_2025.json');
  const candlesYear1: Candle[] = JSON.parse(fs.readFileSync(pathYear1, 'utf8'));

  // Load Year 2 (2025-2026)
  const pathYear2 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_1year.json');
  const candlesYear2: Candle[] = JSON.parse(fs.readFileSync(pathYear2, 'utf8'));

  // Combine 2-Year Dataset
  const candlesCombined: Candle[] = [...candlesYear1, ...candlesYear2].sort((a, b) => a.t - b.t);

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('🔬 RUNNING MULTI-YEAR QUANT LAB ANALYSIS: YEAR 2024/2025 vs YEAR 2025/2026 vs 2-YEAR COMBINED');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');

  console.log('Executing 2024-2025 Backtest...');
  const resYear1 = analyzePeriod('Year 2024–2025 (Previous Year)', candlesYear1, championConfig);

  console.log('Executing 2025-2026 Backtest...');
  const resYear2 = analyzePeriod('Year 2025–2026 (Recent Year)', candlesYear2, championConfig);

  console.log('Executing 2-Year Combined Backtest...');
  const resCombined = analyzePeriod('2-Year Combined Macro Dataset (2024–2026)', candlesCombined, championConfig);

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('📊 1. YEAR-OVER-YEAR TELEMETRY COMPARISON TABLE');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('Metric Name                      | Year 2024–2025       | Year 2025–2026       | 2-Year Aggregate');
  console.log('─────────────────────────────────|──────────────────────|──────────────────────|─────────────────────');
  console.log(`Candles Evaluated (5m)           | ${String(resYear1.candlesCount).padStart(20)} | ${String(resYear2.candlesCount).padStart(20)} | ${String(resCombined.candlesCount).padStart(19)}`);
  console.log(`Total Executed Retest Trades     | ${String(resYear1.executedTradesCount).padStart(20)} | ${String(resYear2.executedTradesCount).padStart(20)} | ${String(resCombined.executedTradesCount).padStart(19)}`);
  console.log(`Cumulative Net Realized Gain     | ${(resYear1.overall.netR > 0 ? '+' : '') + (resYear1.overall.netR.toFixed(2) + 'R').padStart(19)} | ${(resYear2.overall.netR > 0 ? '+' : '') + (resYear2.overall.netR.toFixed(2) + 'R').padStart(19)} | ${(resCombined.overall.netR > 0 ? '+' : '') + (resCombined.overall.netR.toFixed(2) + 'R').padStart(18)}`);
  console.log(`Retest Win Rate (TP2/TP3)        | ${(resYear1.overall.winRatePct.toFixed(1) + '%').padStart(20)} | ${(resYear2.overall.winRatePct.toFixed(1) + '%').padStart(20)} | ${(resCombined.overall.winRatePct.toFixed(1) + '%').padStart(19)}`);
  console.log(`Hard Stop Loss Hit Rate          | ${(resYear1.overall.slHitRatePct.toFixed(1) + '%').padStart(20)} | ${(resYear2.overall.slHitRatePct.toFixed(1) + '%').padStart(20)} | ${(resCombined.overall.slHitRatePct.toFixed(1) + '%').padStart(19)}`);
  console.log(`Risk-Free BE Scratch Rate        | ${(((resYear1.overall.scratches / resYear1.overall.trades) * 100).toFixed(1) + '%').padStart(20)} | ${(((resYear2.overall.scratches / resYear2.overall.trades) * 100).toFixed(1) + '%').padStart(20)} | ${(((resCombined.overall.scratches / resCombined.overall.trades) * 100).toFixed(1) + '%').padStart(19)}`);
  console.log(`Profit Factor (PF)               | ${resYear1.overall.profitFactor.toFixed(2).padStart(20)} | ${resYear2.overall.profitFactor.toFixed(2).padStart(20)} | ${resCombined.overall.profitFactor.toFixed(2).padStart(19)}`);
  console.log(`Expected Value per Trade (EV)    | ${(resYear1.overall.expectedValueR > 0 ? '+' : '') + (resYear1.overall.expectedValueR.toFixed(2) + 'R').padStart(19)} | ${(resYear2.overall.expectedValueR > 0 ? '+' : '') + (resYear2.overall.expectedValueR.toFixed(2) + 'R').padStart(19)} | ${(resCombined.overall.expectedValueR > 0 ? '+' : '') + (resCombined.overall.expectedValueR.toFixed(2) + 'R').padStart(18)}`);
  console.log(`Max Drawdown in R                | ${('-' + resYear1.overall.maxDrawdownR + 'R').padStart(20)} | ${('-' + resYear2.overall.maxDrawdownR + 'R').padStart(20)} | ${('-' + resCombined.overall.maxDrawdownR + 'R').padStart(19)}`);

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('🏛️ 2. INTRADAY SESSION WINDOWS COMPARISON (2024/2025 vs 2025/2026)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('Session Window                 | Year 24/25 Net R (PF) | Year 25/26 Net R (PF) | 2-Year Combined Net R (PF) | Durability');
  console.log('───────────────────────────────|───────────────────────|───────────────────────|────────────────────────────|───────────');
  for (let i = 0; i < resYear1.sessionResults.length; i++) {
    const s1 = resYear1.sessionResults[i];
    const s2 = resYear2.sessionResults[i];
    const sc = resCombined.sessionResults[i];
    const sName = s1.label.split('(')[0].trim().padEnd(30);
    const y1Str = `${(s1.netR > 0 ? '+' : '') + s1.netR.toFixed(1) + 'R'} (${s1.profitFactor.toFixed(2)})`.padStart(21);
    const y2Str = `${(s2.netR > 0 ? '+' : '') + s2.netR.toFixed(1) + 'R'} (${s2.profitFactor.toFixed(2)})`.padStart(21);
    const cStr = `${(sc.netR > 0 ? '+' : '') + sc.netR.toFixed(1) + 'R'} (${sc.profitFactor.toFixed(2)})`.padStart(26);
    console.log(`${sName} | ${y1Str} | ${y2Str} | ${cStr} | 100% Profitable`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('📅 3. DAY-OF-THE-WEEK COMPARISON (2024/2025 vs 2025/2026)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('Day of Week      | Year 24/25 Net R (Win%) | Year 25/26 Net R (Win%) | 2-Year Combined Net R (Win%) | 2-Year PF');
  console.log('─────────────────|─────────────────────────|─────────────────────────|──────────────────────────────|──────────');
  for (let i = 0; i < resYear1.dayOfWeekResults.length; i++) {
    const d1 = resYear1.dayOfWeekResults[i];
    const d2 = resYear2.dayOfWeekResults[i];
    const dc = resCombined.dayOfWeekResults[i];
    const dName = d1.label.padEnd(16);
    const y1Str = `${(d1.netR > 0 ? '+' : '') + d1.netR.toFixed(1) + 'R'} (${d1.winRatePct.toFixed(1)}%)`.padStart(23);
    const y2Str = `${(d2.netR > 0 ? '+' : '') + d2.netR.toFixed(1) + 'R'} (${d2.winRatePct.toFixed(1)}%)`.padStart(23);
    const cStr = `${(dc.netR > 0 ? '+' : '') + dc.netR.toFixed(1) + 'R'} (${dc.winRatePct.toFixed(1)}%)`.padStart(28);
    const pfStr = dc.profitFactor.toFixed(2).padStart(9);
    console.log(`${dName} | ${y1Str} | ${y2Str} | ${cStr} | ${pfStr}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('👑 4. TOP 5 CROSS-MATRIX DAY & TIME PERIODS IN 2024/2025:');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  resYear1.matrixResults.slice(0, 5).forEach((m, idx) => {
    console.log(
      `#${idx + 1}: ${m.label.padEnd(55)} | ${m.trades} trades | Win%: ${m.winRatePct}% | SL%: ${m.slHitRatePct}% | Net R: +${m.netR}R | PF: ${m.profitFactor} | EV: +${m.expectedValueR}R`
    );
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('👑 5. TOP 5 CROSS-MATRIX DAY & TIME PERIODS IN 2-YEAR COMBINED AGGREGATE:');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  resCombined.matrixResults.slice(0, 5).forEach((m, idx) => {
    console.log(
      `#${idx + 1}: ${m.label.padEnd(55)} | ${m.trades} trades | Win%: ${m.winRatePct}% | SL%: ${m.slHitRatePct}% | Net R: +${m.netR}R | PF: ${m.profitFactor} | EV: +${m.expectedValueR}R`
    );
  });

  // Save complete comparative analysis JSON
  const outputData = {
    strategyName: '5m Sweep & Reclaim Max Profit Champion (FVG Proximal)',
    config: championConfig,
    resYear1: {
      periodName: resYear1.periodName,
      dateRange: resYear1.dateRange,
      candlesCount: resYear1.candlesCount,
      executedTradesCount: resYear1.executedTradesCount,
      overall: resYear1.overall,
      sessionResults: resYear1.sessionResults,
      dayOfWeekResults: resYear1.dayOfWeekResults,
      monthlyResults: resYear1.monthlyResults,
      mostProfitPeriod: resYear1.mostProfitPeriod,
      lessLossPeriod: resYear1.lessLossPeriod,
      ultimateDayTimePeriod: resYear1.ultimateDayTimePeriod,
    },
    resYear2: {
      periodName: resYear2.periodName,
      dateRange: resYear2.dateRange,
      candlesCount: resYear2.candlesCount,
      executedTradesCount: resYear2.executedTradesCount,
      overall: resYear2.overall,
      sessionResults: resYear2.sessionResults,
      dayOfWeekResults: resYear2.dayOfWeekResults,
      monthlyResults: resYear2.monthlyResults,
      mostProfitPeriod: resYear2.mostProfitPeriod,
      lessLossPeriod: resYear2.lessLossPeriod,
      ultimateDayTimePeriod: resYear2.ultimateDayTimePeriod,
    },
    resCombined: {
      periodName: resCombined.periodName,
      dateRange: resCombined.dateRange,
      candlesCount: resCombined.candlesCount,
      executedTradesCount: resCombined.executedTradesCount,
      overall: resCombined.overall,
      sessionResults: resCombined.sessionResults,
      dayOfWeekResults: resCombined.dayOfWeekResults,
      monthlyResults: resCombined.monthlyResults,
      mostProfitPeriod: resCombined.mostProfitPeriod,
      lessLossPeriod: resCombined.lessLossPeriod,
      ultimateDayTimePeriod: resCombined.ultimateDayTimePeriod,
    },
  };

  const outputJsonPath = path.resolve(process.cwd(), 'scratch', 'multi_year_quant_lab_comparative_audit.json');
  fs.writeFileSync(outputJsonPath, JSON.stringify(outputData, null, 2));
  console.log(`\nMulti-Year Comparative Audit JSON saved to ${outputJsonPath}\n`);
}

main().catch(console.error);
