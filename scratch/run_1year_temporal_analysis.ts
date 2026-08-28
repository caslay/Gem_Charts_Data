import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup
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

async function main() {
  const cachePath = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_1year.json');
  if (!fs.existsSync(cachePath)) {
    console.error(`1-year dataset not found at ${cachePath}`);
    process.exit(1);
  }

  console.log(`Loading 1-year 5m ETH dataset from ${cachePath}...`);
  const rawData = fs.readFileSync(cachePath, 'utf8');
  const candles: Candle[] = JSON.parse(rawData);
  console.log(`Successfully loaded ${candles.length} candles spanning ${new Date(candles[0].t).toISOString().slice(0, 10)} to ${new Date(candles[candles.length - 1].t).toISOString().slice(0, 10)} (365 Days)\n`);

  // Ultimate Winner Strategy Configuration
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

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('🚀 EXECUTING FULL 1-YEAR QUANT LAB BACKTEST (THE ULTIMATE WINNER SETUP — 5M FVG PROXIMAL)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');

  const startTime = Date.now();
  const engine = new SweepReclaimEngine(championConfig);
  const { setups, telemetry } = engine.scanHistoricalSetups(candles);
  const elapsed = Date.now() - startTime;

  const executedTrades = setups.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');
  console.log(`Execution complete in ${elapsed}ms!`);
  console.log(`Total Executed Retest Trades: ${executedTrades.length}`);
  console.log(`Total Cumulative Net Profit:  +${telemetry.avg_realized_rr > 0 ? (executedTrades.reduce((acc, t) => acc + t.realized_rr, 0)).toFixed(2) : 0}R`);
  console.log(`Retest Win Rate:              ${telemetry.retest_win_rate_pct}% (${telemetry.total_winning_trades}W / ${telemetry.total_losing_trades}L / ${telemetry.total_be_scratches + telemetry.total_structural_scratches} Scratches)`);
  console.log(`Hard Stop Loss Hit Rate:      ${((telemetry.stopped_out_count / executedTrades.length) * 100).toFixed(2)}%`);
  console.log(`Profit Factor:                ${telemetry.profit_factor}`);
  console.log(`Expected Value per Trade:     +${telemetry.expected_value_r}R\n`);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. HOURLY BREAKDOWN (24 HOURS UTC & CAIRO)
  // ─────────────────────────────────────────────────────────────────────────────
  const tradesByHour = new Map<number, SweepReclaimSetup[]>();
  for (let h = 0; h < 24; h++) tradesByHour.set(h, []);

  for (const t of executedTrades) {
    const tradeTime = t.retest_time || t.anchor_time;
    const hourUtc = new Date(tradeTime).getUTCHours();
    tradesByHour.get(hourUtc)!.push(t);
  }

  const hourlyResults: TemporalBucket[] = [];
  for (let h = 0; h < 24; h++) {
    const list = tradesByHour.get(h)!;
    const cairoHour = (h + 3) % 24;
    const label = `${String(h).padStart(2, '0')}:00 UTC (${String(cairoHour).padStart(2, '0')}:00 Cairo)`;
    hourlyResults.push(computeBucketMetrics(String(h), label, list));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. SESSION WINDOW BREAKDOWN (7 CORE INSTITUTIONAL WINDOWS)
  // ─────────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. DAY OF WEEK BREAKDOWN (MONDAY TO SUNDAY)
  // ─────────────────────────────────────────────────────────────────────────────
  const tradesByDayOfWeek = new Map<number, SweepReclaimSetup[]>();
  for (let d = 0; d < 7; d++) tradesByDayOfWeek.set(d, []);

  for (const t of executedTrades) {
    const tradeTime = t.retest_time || t.anchor_time;
    const dayOfWeek = new Date(tradeTime).getUTCDay();
    tradesByDayOfWeek.get(dayOfWeek)!.push(t);
  }

  const dayOfWeekResults: TemporalBucket[] = [];
  // Re-order Monday (1) to Sunday (0)
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  for (const d of dayOrder) {
    const list = tradesByDayOfWeek.get(d)!;
    const label = DAY_NAMES[d];
    dayOfWeekResults.push(computeBucketMetrics(String(d), label, list));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. DAY OF WEEK × SESSION CROSS-MATRIX (49 CELLS)
  // ─────────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. MONTHLY CHRONOLOGICAL TIMELINE (12 MONTHS)
  // ─────────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────────
  // IDENTIFY KEY PERIODS
  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Most Profitable Session Window
  const sortedSessionsByProfit = [...sessionResults].sort((a, b) => b.netR - a.netR);
  const mostProfitSession = sortedSessionsByProfit[0];

  // 2. Less Loss Session Window (Lowest SL Hit Rate & Lowest Drawdown with >= 100 trades)
  const sortedSessionsBySafety = [...sessionResults]
    .filter((s) => s.trades >= 100)
    .sort((a, b) => a.slHitRatePct - b.slHitRatePct || b.profitFactor - a.profitFactor);
  const lessLossSession = sortedSessionsBySafety[0];

  // 3. Most Profitable Day of Week
  const sortedDaysByProfit = [...dayOfWeekResults].sort((a, b) => b.netR - a.netR);
  const mostProfitDay = sortedDaysByProfit[0];

  // 4. Less Loss Day of Week (Lowest SL Hit Rate)
  const sortedDaysBySafety = [...dayOfWeekResults].sort((a, b) => a.slHitRatePct - b.slHitRatePct);
  const lessLossDay = sortedDaysBySafety[0];

  // 5. Ultimate Cross-Matrix Day & Time Period (Combining Profit, High Win Rate, Lowest SL Hit Rate, and Highest EV)
  const validMatrixCells = matrixResults.filter((m) => m.trades >= 30);
  const sortedMatrixByEV = [...validMatrixCells].sort((a, b) => {
    // Composite Institutional Temporal Score = (Net R * 0.4) + (EV * 50) + (PF * 10) - (SL Hit Rate * 5)
    const scoreA = a.netR * 0.4 + a.expectedValueR * 50 + a.profitFactor * 10 - a.slHitRatePct * 5;
    const scoreB = b.netR * 0.4 + b.expectedValueR * 50 + b.profitFactor * 10 - b.slHitRatePct * 5;
    return scoreB - scoreA;
  });
  const ultimateDayTimePeriod = sortedMatrixByEV[0];

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('📊 1. SESSION WINDOW TEMPORAL PERFORMANCE TABLE');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('Session Window                                    | Trades | Win Rate | SL Hit % | Net R Gain  | Profit Factor | EV / Trade | Max DD');
  console.log('──────────────────────────────────────────────────|────────|──────────|──────────|─────────────|───────────────|────────────|───────');
  sessionResults.forEach((s) => {
    console.log(
      `${s.label.padEnd(50)} | ${String(s.trades).padStart(6)} | ${(s.winRatePct.toFixed(1) + '%').padStart(8)} | ${(s.slHitRatePct.toFixed(1) + '%').padStart(8)} | ${(s.netR > 0 ? '+' : '') + (s.netR.toFixed(1) + 'R').padStart(11)} | ${s.profitFactor.toFixed(2).padStart(13)} | ${(s.expectedValueR > 0 ? '+' : '') + (s.expectedValueR.toFixed(2) + 'R').padStart(10)} | -${s.maxDrawdownR}R`
    );
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('📅 2. DAY-OF-WEEK TEMPORAL PERFORMANCE TABLE');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('Day of the Week  | Trades | Win Rate | SL Hit % | Net R Gain  | Profit Factor | EV / Trade | Max DD');
  console.log('─────────────────|────────|──────────|──────────|─────────────|───────────────|────────────|───────');
  dayOfWeekResults.forEach((d) => {
    console.log(
      `${d.label.padEnd(16)} | ${String(d.trades).padStart(6)} | ${(d.winRatePct.toFixed(1) + '%').padStart(8)} | ${(d.slHitRatePct.toFixed(1) + '%').padStart(8)} | ${(d.netR > 0 ? '+' : '') + (d.netR.toFixed(1) + 'R').padStart(11)} | ${d.profitFactor.toFixed(2).padStart(13)} | ${(d.expectedValueR > 0 ? '+' : '') + (d.expectedValueR.toFixed(2) + 'R').padStart(10)} | -${d.maxDrawdownR}R`
    );
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('👑 3. TOP 10 CROSS-MATRIX DAY & TIME PERIODS (LEADERBOARD)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('Rank | Day & Session Window                                | Trades | Win Rate | SL Hit % | Net R Gain  | Profit Factor | EV / Trade');
  console.log('─────|─────────────────────────────────────────────────────|────────|──────────|──────────|─────────────|───────────────|───────────');
  sortedMatrixByEV.slice(0, 10).forEach((m, idx) => {
    console.log(
      `#${String(idx + 1).padStart(2)}  | ${m.label.padEnd(51)} | ${String(m.trades).padStart(6)} | ${(m.winRatePct.toFixed(1) + '%').padStart(8)} | ${(m.slHitRatePct.toFixed(1) + '%').padStart(8)} | ${(m.netR > 0 ? '+' : '') + (m.netR.toFixed(1) + 'R').padStart(11)} | ${m.profitFactor.toFixed(2).padStart(13)} | ${(m.expectedValueR > 0 ? '+' : '') + (m.expectedValueR.toFixed(2) + 'R').padStart(9)}`
    );
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('📆 4. 12-MONTH CHRONOLOGICAL TIMELINE TABLE');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('Month    | Trades | Win Rate | SL Hit % | Net R Gain  | Profit Factor | EV / Trade');
  console.log('---------|--------|----------|----------|-------------|---------------|-----------');
  monthlyResults.forEach((m) => {
    console.log(
      `${m.label}  | ${String(m.trades).padStart(6)} | ${(m.winRatePct.toFixed(1) + '%').padStart(8)} | ${(m.slHitRatePct.toFixed(1) + '%').padStart(8)} | ${(m.netR > 0 ? '+' : '') + (m.netR.toFixed(1) + 'R').padStart(11)} | ${m.profitFactor.toFixed(2).padStart(13)} | ${(m.expectedValueR > 0 ? '+' : '') + (m.expectedValueR.toFixed(2) + 'R').padStart(9)}`
    );
  });

  // Save complete temporal audit report JSON
  const outputData = {
    strategyName: '5m Sweep & Reclaim Max Profit Champion (FVG Proximal)',
    config: championConfig,
    datasetSummary: {
      totalCandles: candles.length,
      daysCovered: 365,
      startDate: new Date(candles[0].t).toISOString(),
      endDate: new Date(candles[candles.length - 1].t).toISOString(),
      startPrice: candles[0].o,
      endPrice: candles[candles.length - 1].c,
      minPrice: Math.min(...candles.map((c) => c.l)),
      maxPrice: Math.max(...candles.map((c) => c.h)),
    },
    overallTelemetry: telemetry,
    totalExecutedTrades: executedTrades.length,
    mostProfitPeriod: {
      session: mostProfitSession,
      day: mostProfitDay,
    },
    lessLossPeriod: {
      session: lessLossSession,
      day: lessLossDay,
    },
    ultimateDayTimePeriod: ultimateDayTimePeriod,
    sessionResults,
    dayOfWeekResults,
    hourlyResults,
    matrixResults: sortedMatrixByEV,
    monthlyResults,
  };

  const outputJsonPath = path.resolve(process.cwd(), 'scratch', '1year_quant_lab_temporal_audit.json');
  fs.writeFileSync(outputJsonPath, JSON.stringify(outputData, null, 2));
  console.log(`\nFull 1-Year Temporal Audit JSON saved to ${outputJsonPath}\n`);
}

main().catch(console.error);
