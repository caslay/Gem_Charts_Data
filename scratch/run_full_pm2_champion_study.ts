import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades, StandardizedExecutedTrade, formatCairoDateTime } from '../src/lib/quantEngine/equityCalculator';

export interface FullStudyOutput {
  config: SweepReclaimScanConfig;
  year1: SessionAndMetricSummary;
  year2: SessionAndMetricSummary;
  combined2Y: SessionAndMetricSummary;
  temporalSessionTable: any[];
  weekdayTable: any[];
  hourlyAudit: any[];
  smartPauseSummary: any;
  capitalFixedRisk: any;
  capitalCompounding: any;
}

interface SessionAndMetricSummary {
  totalCandles: number;
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number;
  slHitRatePct: number;
  scratchRatePct: number;
  armorRatePct: number;
  netRealizedR: number;
  profitFactor: number;
  expectedValueR: number;
  maxDrawdownR: number;
  stage1FillRatePct: number;
  stage2FillRatePct: number;
  stage3FillRatePct: number;
}

function analyzeDataset(
  candles: Candle[],
  config: SweepReclaimScanConfig
): {
  metrics: SessionAndMetricSummary;
  trades: StandardizedExecutedTrade[];
  rawSetups: SweepReclaimSetup[];
} {
  const engine = new SweepReclaimEngine(config);
  const { setups } = engine.scanHistoricalSetups(candles);
  const trades = adaptSweepReclaimSetupsToTrades(setups, { enforceSinglePositionWalk: true });

  let netR = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let wins = 0;
  let losses = 0;
  let scratches = 0;

  for (const t of trades) {
    const r = t.realizedR;
    netR += r;
    if (r > 0) {
      wins++;
      grossWinR += r;
    } else if (r < 0) {
      losses++;
      grossLossR += Math.abs(r);
    } else {
      scratches++;
    }
  }

  const n = trades.length;
  const winRate = n > 0 ? (wins / n) * 100 : 0;
  const slHitRate = n > 0 ? (losses / n) * 100 : 0;
  const scratchRate = n > 0 ? (scratches / n) * 100 : 0;
  const armorRate = winRate + scratchRate;
  const pf = grossLossR > 0 ? grossWinR / grossLossR : 99.9;
  const ev = n > 0 ? netR / n : 0;

  let peakR = 0;
  let currentR = 0;
  let maxDDR = 0;
  for (const t of trades) {
    currentR += t.realizedR;
    if (currentR > peakR) peakR = currentR;
    const dd = peakR - currentR;
    if (dd > maxDDR) maxDDR = dd;
  }

  const executedSetupIds = new Set(trades.map((t) => t.id));
  const matchedSetups = setups.filter((s) => executedSetupIds.has(s.id));
  const stage1Count = matchedSetups.filter((s) => s.is_stage1_filled).length;
  const stage2Count = matchedSetups.filter((s) => s.is_stage2_filled).length;
  const stage3Count = matchedSetups.filter((s) => s.is_stage3_filled).length;

  return {
    metrics: {
      totalCandles: candles.length,
      totalTrades: n,
      wins,
      losses,
      scratches,
      winRatePct: parseFloat(winRate.toFixed(1)),
      slHitRatePct: parseFloat(slHitRate.toFixed(1)),
      scratchRatePct: parseFloat(scratchRate.toFixed(1)),
      armorRatePct: parseFloat(armorRate.toFixed(1)),
      netRealizedR: parseFloat(netR.toFixed(2)),
      profitFactor: parseFloat(pf.toFixed(2)),
      expectedValueR: parseFloat(ev.toFixed(2)),
      maxDrawdownR: parseFloat(maxDDR.toFixed(2)),
      stage1FillRatePct: parseFloat((n > 0 ? (stage1Count / n) * 100 : 0).toFixed(1)),
      stage2FillRatePct: parseFloat((n > 0 ? (stage2Count / n) * 100 : 0).toFixed(1)),
      stage3FillRatePct: parseFloat((n > 0 ? (stage3Count / n) * 100 : 0).toFixed(1)),
    },
    trades,
    rawSetups: setups,
  };
}

function getSessionName(utcHour: number): string {
  if (utcHour >= 0 && utcHour < 7) return 'Asian Session (00:00-07:00 UTC)';
  if (utcHour >= 7 && utcHour < 9) return 'Asian Eve / Rollover (07:00-09:00 UTC)';
  if (utcHour >= 9 && utcHour < 12) return 'London AM Killzone (09:00-12:00 UTC)';
  if (utcHour >= 12 && utcHour < 15) return 'NY AM Killzone (12:00-15:00 UTC)';
  if (utcHour >= 15 && utcHour < 17) return 'London Midday / Lunch (15:00-17:00 UTC)';
  if (utcHour >= 17 && utcHour < 20) return 'NY PM Killzone (17:00-20:00 UTC)';
  return 'NY Dead Zone (20:00-00:00 UTC)';
}

function isToxicWindow(t: number): boolean {
  const d = new Date(t);
  const utcDay = d.getUTCDay();
  const utcHour = d.getUTCHours();

  // Rule 1: Daily NY Post-Lunch 16:00-17:00 UTC
  if (utcHour === 16) return true;

  // Rule 2: Mon & Thu Late Rollover 23:00-00:00 UTC
  if ((utcDay === 1 || utcDay === 4) && utcHour === 23) return true;

  // Rule 3: Friday Weekend Liquidity Drain >18:00 UTC
  if (utcDay === 5 && utcHour >= 18) return true;

  // Rule 4: Sunday Illiquid Open 00:00-05:00 UTC
  if (utcDay === 0 && utcHour < 5) return true;

  return false;
}

async function main() {
  const pathYear1 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_2024_2025.json');
  const candlesY1: Candle[] = JSON.parse(fs.readFileSync(pathYear1, 'utf8'));

  const pathYear2 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_1year.json');
  const candlesY2: Candle[] = JSON.parse(fs.readFileSync(pathYear2, 'utf8'));

  const candles2Y: Candle[] = [...candlesY1, ...candlesY2].sort((a, b) => a.t - b.t);

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
    volumeExpansionThreshold: 1.20,
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.40,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
    stage1Multiple: 1.0,
    stage2Multiple: 1.4,
    stage3Multiple: 3.0,
    entryMode: 'FVG_PROXIMAL',
    enableStructuralTrail: true,
    enableProfitRatchet: true,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.10,
  };

  console.log('Running study for Year 1 (2024-2025)...');
  const resY1 = analyzeDataset(candlesY1, championConfig);

  console.log('Running study for Year 2 (2025-2026)...');
  const resY2 = analyzeDataset(candlesY2, championConfig);

  console.log('Running study for 2-Year Combined (2024-2026)...');
  const res2Y = analyzeDataset(candles2Y, championConfig);

  // Intraday Sessions Analysis
  const sessions = [
    'Asian Session (00:00-07:00 UTC)',
    'Asian Eve / Rollover (07:00-09:00 UTC)',
    'London AM Killzone (09:00-12:00 UTC)',
    'NY AM Killzone (12:00-15:00 UTC)',
    'London Midday / Lunch (15:00-17:00 UTC)',
    'NY PM Killzone (17:00-20:00 UTC)',
    'NY Dead Zone (20:00-00:00 UTC)',
  ];

  const sessionTable: any[] = [];
  for (const s of sessions) {
    const tradesY1 = resY1.trades.filter((t) => getSessionName(new Date(t.timestamp).getUTCHours()) === s);
    const tradesY2 = resY2.trades.filter((t) => getSessionName(new Date(t.timestamp).getUTCHours()) === s);
    const trades2Y = res2Y.trades.filter((t) => getSessionName(new Date(t.timestamp).getUTCHours()) === s);

    const calc = (tr: StandardizedExecutedTrade[]) => {
      let r = 0, gw = 0, gl = 0, w = 0;
      for (const t of tr) {
        r += t.realizedR;
        if (t.realizedR > 0) { w++; gw += t.realizedR; }
        else if (t.realizedR < 0) { gl += Math.abs(t.realizedR); }
      }
      return {
        netR: parseFloat(r.toFixed(1)),
        pf: parseFloat((gl > 0 ? gw / gl : 99.9).toFixed(2)),
        winRate: parseFloat(((w / (tr.length || 1)) * 100).toFixed(1)),
        count: tr.length,
      };
    };

    const sY1 = calc(tradesY1);
    const sY2 = calc(tradesY2);
    const s2Y = calc(trades2Y);

    sessionTable.push({
      session: s,
      y1NetR: sY1.netR,
      y1PF: sY1.pf,
      y2NetR: sY2.netR,
      y2PF: sY2.pf,
      twoYearNetR: s2Y.netR,
      twoYearPF: s2Y.pf,
      twoYearWinRate: s2Y.winRate,
      twoYearTrades: s2Y.count,
    });
  }

  // Weekday Analysis
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekdayTable: any[] = [];
  for (let d = 0; d < 7; d++) {
    const dayName = weekdays[d];
    const tradesY1 = resY1.trades.filter((t) => new Date(t.timestamp).getUTCDay() === d);
    const tradesY2 = resY2.trades.filter((t) => new Date(t.timestamp).getUTCDay() === d);
    const trades2Y = res2Y.trades.filter((t) => new Date(t.timestamp).getUTCDay() === d);

    const calc = (tr: StandardizedExecutedTrade[]) => {
      let r = 0, gw = 0, gl = 0, w = 0;
      for (const t of tr) {
        r += t.realizedR;
        if (t.realizedR > 0) { w++; gw += t.realizedR; }
        else if (t.realizedR < 0) { gl += Math.abs(t.realizedR); }
      }
      return {
        netR: parseFloat(r.toFixed(1)),
        pf: parseFloat((gl > 0 ? gw / gl : 99.9).toFixed(2)),
        winRate: parseFloat(((w / (tr.length || 1)) * 100).toFixed(1)),
        count: tr.length,
      };
    };

    const dY1 = calc(tradesY1);
    const dY2 = calc(tradesY2);
    const d2Y = calc(trades2Y);

    weekdayTable.push({
      day: dayName,
      y1NetR: dY1.netR,
      y1WinPct: dY1.winRate,
      y2NetR: dY2.netR,
      y2WinPct: dY2.winRate,
      twoYearNetR: d2Y.netR,
      twoYearWinPct: d2Y.winRate,
      twoYearPF: d2Y.pf,
      twoYearTrades: d2Y.count,
    });
  }

  // Smart Pause Protocol Impact
  const nonToxicTrades = res2Y.trades.filter((t) => !isToxicWindow(t.timestamp));
  let netR_pause = 0, gw_pause = 0, gl_pause = 0, w_pause = 0, l_pause = 0;
  let peak_pause = 0, curr_pause = 0, maxDD_pause = 0;

  for (const t of nonToxicTrades) {
    netR_pause += t.realizedR;
    if (t.realizedR > 0) {
      w_pause++;
      gw_pause += t.realizedR;
    } else if (t.realizedR < 0) {
      l_pause++;
      gl_pause += Math.abs(t.realizedR);
    }
    curr_pause += t.realizedR;
    if (curr_pause > peak_pause) peak_pause = curr_pause;
    const dd = peak_pause - curr_pause;
    if (dd > maxDD_pause) maxDD_pause = dd;
  }

  const smartPauseSummary = {
    baselineTrades: res2Y.metrics.totalTrades,
    baselineNetR: res2Y.metrics.netRealizedR,
    baselineWinRate: res2Y.metrics.winRatePct,
    baselineHardSL: res2Y.metrics.slHitRatePct,
    baselinePF: res2Y.metrics.profitFactor,
    baselineMaxDD: res2Y.metrics.maxDrawdownR,

    pausedTrades: nonToxicTrades.length,
    purgedTrades: res2Y.metrics.totalTrades - nonToxicTrades.length,
    pausedNetR: parseFloat(netR_pause.toFixed(2)),
    pausedWinRate: parseFloat(((w_pause / nonToxicTrades.length) * 100).toFixed(1)),
    pausedHardSL: parseFloat(((l_pause / nonToxicTrades.length) * 100).toFixed(1)),
    pausedPF: parseFloat((gl_pause > 0 ? gw_pause / gl_pause : 99.9).toFixed(2)),
    pausedMaxDD: parseFloat(maxDD_pause.toFixed(2)),
  };

  // Capital Fixed Risk Simulation ($1000 start, $10/R)
  const fixedRisk = {
    baselineEndingCapital: 1000 + res2Y.metrics.netRealizedR * 10,
    baselineNetCashProfit: res2Y.metrics.netRealizedR * 10,
    baselineMaxDollarDD: res2Y.metrics.maxDrawdownR * 10,
    baselineCashEarnedPerTrade: (res2Y.metrics.netRealizedR * 10) / res2Y.metrics.totalTrades,

    pausedEndingCapital: 1000 + netR_pause * 10,
    pausedNetCashProfit: netR_pause * 10,
    pausedMaxDollarDD: maxDD_pause * 10,
    pausedCashEarnedPerTrade: (netR_pause * 10) / nonToxicTrades.length,
  };

  // Dynamic Compounding Simulation ($1000 start, 1.0% risk per trade capped at $250)
  function simulateCompounding(trades: StandardizedExecutedTrade[]) {
    let equity = 1000;
    let peakEquity = 1000;
    let maxDollarDD = 0;
    let maxPctDD = 0;
    let consecutiveLosses = 0;
    let maxConsecutiveLosses = 0;

    for (const t of trades) {
      const riskAmount = Math.min(equity * 0.01, 250);
      const dollarPnL = t.realizedR * riskAmount;
      equity += dollarPnL;

      if (t.realizedR < 0) {
        consecutiveLosses++;
        if (consecutiveLosses > maxConsecutiveLosses) maxConsecutiveLosses = consecutiveLosses;
      } else if (t.realizedR > 0) {
        consecutiveLosses = 0;
      }

      if (equity > peakEquity) peakEquity = equity;
      const dollarDD = peakEquity - equity;
      if (dollarDD > maxDollarDD) maxDollarDD = dollarDD;
      const pctDD = (dollarDD / peakEquity) * 100;
      if (pctDD > maxPctDD) maxPctDD = pctDD;
    }

    return {
      endingEquity: parseFloat(equity.toFixed(2)),
      netProfit: parseFloat((equity - 1000).toFixed(2)),
      maxDollarDD: parseFloat(maxDollarDD.toFixed(2)),
      maxPctDD: parseFloat(maxPctDD.toFixed(2)),
      maxConsecutiveLosses,
    };
  }

  const compBaseline = simulateCompounding(res2Y.trades);
  const compPaused = simulateCompounding(nonToxicTrades);

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('📊 MULTI-YEAR TELEMETRY UNDER PM2 1:1 PARITY (1.20x Vol, 52% Delta, 0.40 Body, 0.10 ATR SL)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('Year 1 Metrics:', resY1.metrics);
  console.log('Year 2 Metrics:', resY2.metrics);
  console.log('2-Year Combined Metrics:', res2Y.metrics);
  console.log('\nSessions:', sessionTable);
  console.log('\nWeekdays:', weekdayTable);
  console.log('\nSmart Pause Summary:', smartPauseSummary);
  console.log('\nFixed Risk Summary:', fixedRisk);
  console.log('\nCompounding Summary Baseline:', compBaseline);
  console.log('Compounding Summary Paused:', compPaused);

  const fullOutput: FullStudyOutput = {
    config: championConfig,
    year1: resY1.metrics,
    year2: resY2.metrics,
    combined2Y: res2Y.metrics,
    temporalSessionTable: sessionTable,
    weekdayTable,
    hourlyAudit: [],
    smartPauseSummary,
    capitalFixedRisk: fixedRisk,
    capitalCompounding: { baseline: compBaseline, paused: compPaused },
  };

  fs.writeFileSync(
    path.resolve(process.cwd(), 'scratch', 'pm2_champion_full_study_output.json'),
    JSON.stringify(fullOutput, null, 2)
  );
}

main().catch(console.error);
