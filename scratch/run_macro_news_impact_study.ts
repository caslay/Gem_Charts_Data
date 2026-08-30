import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades } from '../src/lib/quantEngine/equityCalculator';
import { MacroNewsEvent } from './generate_macro_calendar';

// Champion Parameters (2-Stage Dynamic Harvest)
const CHAMPION_CONFIG: SweepReclaimScanConfig = {
  anchorTypes: [
    'SWING_PIVOT',
    'ASIAN_HIGH',
    'ASIAN_LOW',
    'LONDON_HIGH',
    'LONDON_LOW',
    'PDH',
    'PDL',
  ],
  lookbackMajor: 10,
  lookbackInternal: 5,
  maxBarsAnchorToSweep: 25,
  maxBarsSweepToReclaim: 10,
  maxBarsToRetest: 20,
  volumeSmaPeriod: 20,
  volumeExpansionThreshold: 1.2,
  deltaDominanceThreshold: 52.0,
  bodyRatioThreshold: 0.4,
  requireThreePillarDisplacement: true,
  enforceDiscountPremiumGate: true,
  entryMode: 'FVG_PROXIMAL',
  stage1Multiple: 1.0,
  stage2Multiple: 1.4,
  stage3Multiple: 3.0,
  stage1Ratio: 0.5,
  stage2Ratio: 0.5,
  stage3Ratio: 0.0,
  enableStructuralTrail: true,
  enableProfitRatchet: false,
  minSweepDepthAtrMultiplier: 0.1,
  slBufferAtrMultiplier: 0.1,
};

export interface ExecutedTradeRecord {
  id: string;
  setupId: string;
  type: 'BULLISH' | 'BEARISH';
  entryPrice: number;
  stopLoss: number;
  stage1Target: number;
  stage2Target: number;
  entryTime: number; // ms
  entryTimeIso: string;
  closeTime: number;
  closeTimeIso: string;
  barsInTrade: number;
  realizedR: number;
  outcome: 'WIN' | 'LOSS' | 'SCRATCH';
  isStage1Filled: boolean;
  isStage2Filled: boolean;
  anchorName: string;
  // News Intersection Info
  coincidingNewsEvents: {
    event: MacroNewsEvent;
    offsetMinutes: number; // entryTime - event.timestamp_ms in minutes
    windowTag: string;
  }[];
}

interface PerformanceSummary {
  name: string;
  description: string;
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number;
  slHitRatePct: number;
  scratchRatePct: number;
  netRealizedR: number;
  profitFactor: number;
  expectedValueR: number;
  maxDrawdownR: number;
  avgBarsInTrade: number;
  stage1HitCount: number;
  stage2HitCount: number;
  stage1HitPct: number;
  stage2HitPct: number;

  // $1000 Capital Compounding Simulation
  compoundingEndingEquity: number;
  compoundingNetProfit: number;
  compoundingMaxDollarDD: number;
  compoundingMaxPctDD: number;
  sharpeProxy: number;
}

function runCompoundingSimulation(trades: { realizedR: number }[], initialEquity = 1000.0, riskPct = 2.0, maxRiskUsd = 250.0) {
  let equity = initialEquity;
  let peakEquity = initialEquity;
  let maxDollarDD = 0;
  let maxPctDD = 0;

  const returns: number[] = [];

  for (const t of trades) {
    const currentRisk = Math.min(equity * (riskPct / 100), maxRiskUsd);
    const tradePnl = currentRisk * t.realizedR;
    equity = Math.max(10, equity + tradePnl);
    returns.push(tradePnl / (equity || 1));

    if (equity > peakEquity) {
      peakEquity = equity;
    } else {
      const dollarDD = peakEquity - equity;
      const pctDD = (dollarDD / peakEquity) * 100;
      if (dollarDD > maxDollarDD) maxDollarDD = dollarDD;
      if (pctDD > maxPctDD) maxPctDD = pctDD;
    }
  }

  // Calculate Sharpe proxy
  const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const variance = returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (returns.length || 1);
  const stdDev = Math.sqrt(variance) || 1;
  const sharpeProxy = (avgReturn / stdDev) * Math.sqrt(252 * 4); // Annualized proxy

  return {
    endingEquity: parseFloat(equity.toFixed(2)),
    netProfit: parseFloat((equity - initialEquity).toFixed(2)),
    maxDollarDD: parseFloat(maxDollarDD.toFixed(2)),
    maxPctDD: parseFloat(maxPctDD.toFixed(2)),
    sharpeProxy: parseFloat(sharpeProxy.toFixed(2)),
  };
}

function evaluateTrades(name: string, description: string, trades: ExecutedTradeRecord[]): PerformanceSummary {
  let netR = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let wins = 0;
  let losses = 0;
  let scratches = 0;
  let s1Count = 0;
  let s2Count = 0;
  let totalBars = 0;

  let peakR = 0;
  let maxDDR = 0;
  let cumulativeR = 0;

  for (const t of trades) {
    const r = t.realizedR;
    netR += r;
    cumulativeR += r;
    totalBars += t.barsInTrade;

    if (cumulativeR > peakR) {
      peakR = cumulativeR;
    } else {
      const dd = peakR - cumulativeR;
      if (dd > maxDDR) maxDDR = dd;
    }

    if (r > 0) {
      wins++;
      grossWinR += r;
    } else if (r < 0) {
      losses++;
      grossLossR += Math.abs(r);
    } else {
      scratches++;
    }

    if (t.isStage1Filled) s1Count++;
    if (t.isStage2Filled) s2Count++;
  }

  const total = trades.length;
  const winRatePct = total > 0 ? parseFloat(((wins / total) * 100).toFixed(2)) : 0;
  const slHitRatePct = total > 0 ? parseFloat(((losses / total) * 100).toFixed(2)) : 0;
  const scratchRatePct = total > 0 ? parseFloat(((scratches / total) * 100).toFixed(2)) : 0;
  const profitFactor = grossLossR > 0 ? parseFloat((grossWinR / grossLossR).toFixed(2)) : grossWinR > 0 ? 99.0 : 1.0;
  const expectedValueR = total > 0 ? parseFloat((netR / total).toFixed(4)) : 0;
  const avgBarsInTrade = total > 0 ? parseFloat((totalBars / total).toFixed(1)) : 0;

  const comp = runCompoundingSimulation(trades, 1000.0, 2.0, 250.0);

  return {
    name,
    description,
    totalTrades: total,
    wins,
    losses,
    scratches,
    winRatePct,
    slHitRatePct,
    scratchRatePct,
    netRealizedR: parseFloat(netR.toFixed(2)),
    profitFactor,
    expectedValueR,
    maxDrawdownR: parseFloat((-maxDDR).toFixed(2)),
    avgBarsInTrade,
    stage1HitCount: s1Count,
    stage2HitCount: s2Count,
    stage1HitPct: total > 0 ? parseFloat(((s1Count / total) * 100).toFixed(2)) : 0,
    stage2HitPct: total > 0 ? parseFloat(((s2Count / total) * 100).toFixed(2)) : 0,
    compoundingEndingEquity: comp.endingEquity,
    compoundingNetProfit: comp.netProfit,
    compoundingMaxDollarDD: comp.maxDollarDD,
    compoundingMaxPctDD: comp.maxPctDD,
    sharpeProxy: comp.sharpeProxy,
  };
}

async function main() {
  console.log('🚀 Loading 2-Year 5m continuous candle dataset (2024-2026)...');
  const y1Path = path.join(process.cwd(), 'scratch', 'candles_5m_ethusdc_2024_2025.json');
  const y2Path = path.join(process.cwd(), 'scratch', 'candles_5m_ethusdc_1year.json');

  const y1Candles: Candle[] = JSON.parse(fs.readFileSync(y1Path, 'utf8'));
  const y2Candles: Candle[] = JSON.parse(fs.readFileSync(y2Path, 'utf8'));

  const combinedCandles = [...y1Candles, ...y2Candles].sort((a, b) => a.t - b.t);
  console.log(`✅ Loaded ${combinedCandles.length} continuous 5m candles (${y1Candles.length} Y1 + ${y2Candles.length} Y2).`);

  // Load Macro Calendar
  const calendarPath = path.join(process.cwd(), 'data', 'macro_calendar_2024_2026.json');
  const macroCalendar: MacroNewsEvent[] = JSON.parse(fs.readFileSync(calendarPath, 'utf8'));
  console.log(`📅 Loaded ${macroCalendar.length} curated high-impact macro events.`);

  console.log('🔍 Executing 2-Year Sequential Sweep & Reclaim Engine scan...');
  const engine = new SweepReclaimEngine(CHAMPION_CONFIG);
  const scanResult = engine.scanHistoricalSetups(combinedCandles);
  const baseSetups = scanResult.setups;

  // Single-position sequential walk
  const executedTrades = adaptSweepReclaimSetupsToTrades(baseSetups, { enforceSinglePositionWalk: true });
  const executedSetupIds = new Set(executedTrades.map((t) => t.id));
  const validSetups = baseSetups.filter((s) => executedSetupIds.has(s.id));

  console.log(`📊 Executed Trades Identified: ${validSetups.length} valid 2-Stage trades.`);

  // Map candles for exact timing
  const candleTimeMap = new Map<number, number>();
  combinedCandles.forEach((c, idx) => candleTimeMap.set(c.t, idx));

  // Build Trade Records with 2-Stage Harvest simulation (50% TP1 @ 1.0R / 50% TP2 @ 1.4R)
  const tradeRecords: ExecutedTradeRecord[] = [];

  for (const s of validSetups) {
    const isBullish = s.type === 'BULLISH';
    const entryPrice = s.entry_price;
    const stopLoss = s.stop_loss;
    const riskDistance = Math.abs(entryPrice - stopLoss);
    if (riskDistance <= 0) continue;

    const tp1 = isBullish ? entryPrice + riskDistance * 1.0 : entryPrice - riskDistance * 1.0;
    const tp2 = isBullish ? entryPrice + riskDistance * 1.4 : entryPrice - riskDistance * 1.4;

    const retestTime = s.retest_time;
    if (!retestTime) continue;
    const entryIdx = s.retest_index ?? candleTimeMap.get(retestTime);
    if (entryIdx === undefined || entryIdx === null || entryIdx < 0 || entryIdx >= combinedCandles.length) continue;

    let isStage1Filled = false;
    let isStage2Filled = false;
    let finalRealizedR = 0;
    let barsInTrade = 0;
    let exitTime = retestTime;
    let activeStopLoss = stopLoss;

    for (let i = entryIdx; i < combinedCandles.length; i++) {
      const c = combinedCandles[i];
      barsInTrade++;
      exitTime = c.t;

      // Stop Loss check
      const isStopped = isBullish ? c.l <= activeStopLoss : c.h >= activeStopLoss;
      if (isStopped) {
        if (!isStage1Filled) {
          finalRealizedR = -1.0;
        } else {
          // Stopped after Stage 1 (Breakeven scratch)
          // 50% was locked at +1.0R (+0.50R). Remaining 50% stopped at BE (0.0R) = +0.50R net
          finalRealizedR = 0.50 * 1.0;
        }
        break;
      }

      // Stage 1 Target Check
      if (!isStage1Filled) {
        const hitS1 = isBullish ? c.h >= tp1 : c.l <= tp1;
        if (hitS1) {
          isStage1Filled = true;
          // Advance SL to FVG CE or Breakeven
          activeStopLoss = s.reclaim_fvg_ce ?? entryPrice;
        }
      }

      // Stage 2 Target Check (100% full exit on 2-Stage)
      if (isStage1Filled && !isStage2Filled) {
        const hitS2 = isBullish ? c.h >= tp2 : c.l <= tp2;
        if (hitS2) {
          isStage2Filled = true;
          // 50% @ 1.0R (+0.50R) + 50% @ 1.4R (+0.70R) = +1.20R net!
          finalRealizedR = 0.50 * 1.0 + 0.50 * 1.4;
          break;
        }
      }

      // Max timeout safeguard (48 bars = 4 hours)
      if (barsInTrade >= 48) {
        if (isStage1Filled) {
          finalRealizedR = 0.50 * 1.0;
        } else {
          const finalPrice = c.c;
          const deltaR = isBullish ? (finalPrice - entryPrice) / riskDistance : (entryPrice - finalPrice) / riskDistance;
          finalRealizedR = Math.max(-1.0, Math.min(1.20, deltaR));
        }
        break;
      }
    }

    finalRealizedR = parseFloat(finalRealizedR.toFixed(4));
    const outcome: 'WIN' | 'LOSS' | 'SCRATCH' = finalRealizedR > 0 ? 'WIN' : finalRealizedR < 0 ? 'LOSS' : 'SCRATCH';

    // Intersect with Macro Events
    const coinciding: ExecutedTradeRecord['coincidingNewsEvents'] = [];
    for (const ev of macroCalendar) {
      const diffMs = retestTime - ev.timestamp_ms;
      const diffMins = diffMs / (60 * 1000);

      // Check if entry falls within +/- 120 minutes of the event
      if (Math.abs(diffMins) <= 120) {
        coinciding.push({
          event: ev,
          offsetMinutes: parseFloat(diffMins.toFixed(1)),
          windowTag: `${diffMins >= 0 ? '+' : ''}${diffMins.toFixed(0)}m_${ev.category}`,
        });
      }
    }

    tradeRecords.push({
      id: s.id,
      setupId: s.id,
      type: s.type,
      entryPrice: s.entry_price,
      stopLoss: s.stop_loss,
      stage1Target: tp1,
      stage2Target: tp2,
      entryTime: retestTime,
      entryTimeIso: new Date(retestTime).toISOString(),
      closeTime: exitTime,
      closeTimeIso: new Date(exitTime).toISOString(),
      barsInTrade,
      realizedR: finalRealizedR,
      outcome,
      isStage1Filled,
      isStage2Filled,
      anchorName: s.anchor_type,
      coincidingNewsEvents: coinciding,
    });
  }

  console.log(`✅ Processed ${tradeRecords.length} simulated trades with macro news intersection.`);

  // -------------------------------------------------------------
  // SIMULATION 1: Blackout Window Comparison
  // -------------------------------------------------------------
  // Filter 1: No Filter (Baseline)
  const baseline = evaluateTrades('Baseline (24/7 - No News Filter)', 'All 3,075 trades executed unconditionally', tradeRecords);

  // Filter 2: Window A (±15 min)
  const tradesWindowA = tradeRecords.filter((t) => {
    return !t.coincidingNewsEvents.some((c) => Math.abs(c.offsetMinutes) <= 15);
  });
  const summaryWindowA = evaluateTrades('Window A (±15 min Blackout)', 'Pause trading from 15m before to 15m after any Tier-1 release', tradesWindowA);

  // Filter 3: Window B (Standard: -15m to +30m)
  const tradesWindowB = tradeRecords.filter((t) => {
    return !t.coincidingNewsEvents.some((c) => c.offsetMinutes >= -15 && c.offsetMinutes <= 30);
  });
  const summaryWindowB = evaluateTrades('Window B (-15m to +30m Standard)', 'Pause from 15m before release to 30m after release', tradesWindowB);

  // Filter 4: Window C (Conservative: -30m to +60m)
  const tradesWindowC = tradeRecords.filter((t) => {
    return !t.coincidingNewsEvents.some((c) => c.offsetMinutes >= -30 && c.offsetMinutes <= 60);
  });
  const summaryWindowC = evaluateTrades('Window C (-30m to +60m Conservative)', 'Pause from 30m before release to 60m after (covers full FOMC press conference)', tradesWindowC);

  // Filter 5: Window D (Post-News Only: 0 to +45m)
  const tradesWindowD = tradeRecords.filter((t) => {
    return !t.coincidingNewsEvents.some((c) => c.offsetMinutes >= 0 && c.offsetMinutes <= 45);
  });
  const summaryWindowD = evaluateTrades('Window D (0m to +45m Post-News Only)', 'Allow pre-news positioning, but pause immediately during and 45m after release', tradesWindowD);

  // -------------------------------------------------------------
  // SIMULATION 2: Trades Executed Strictly INSIDE the News Windows
  // -------------------------------------------------------------
  const newsOnlyTrades = tradeRecords.filter((t) => {
    return t.coincidingNewsEvents.some((c) => c.offsetMinutes >= -15 && c.offsetMinutes <= 30);
  });
  const summaryNewsOnly = evaluateTrades('News Window Trades Only (-15m to +30m)', 'Telemetry of trades taken strictly inside high-impact news spikes', newsOnlyTrades);

  // -------------------------------------------------------------
  // SIMULATION 3: Category Breakdown
  // -------------------------------------------------------------
  const categories: MacroNewsEvent['category'][] = ['FOMC', 'CPI', 'NFP', 'PCE', 'PPI', 'GDP', 'PMI', 'RETAIL_SALES'];
  const categorySummaries: Record<string, { total: number; winRate: number; slRate: number; netR: number; pf: number }> = {};

  for (const cat of categories) {
    const catTrades = tradeRecords.filter((t) =>
      t.coincidingNewsEvents.some((c) => c.event.category === cat && c.offsetMinutes >= -30 && c.offsetMinutes <= 45)
    );
    const sum = evaluateTrades(`News: ${cat}`, `Trades occurring during ${cat} releases`, catTrades);
    categorySummaries[cat] = {
      total: sum.totalTrades,
      winRate: sum.winRatePct,
      slRate: sum.slHitRatePct,
      netR: sum.netRealizedR,
      pf: sum.profitFactor,
    };
  }

  // -------------------------------------------------------------
  // SIMULATION 4: Multi-Year Breakdown (Year 1 vs Year 2 vs 2-Year Total)
  // -------------------------------------------------------------
  const midpointTime = new Date('2025-08-27T00:00:00.000Z').getTime();
  const y1TradesBaseline = tradeRecords.filter((t) => t.entryTime < midpointTime);
  const y2TradesBaseline = tradeRecords.filter((t) => t.entryTime >= midpointTime);

  const y1TradesWindowB = tradesWindowB.filter((t) => t.entryTime < midpointTime);
  const y2TradesWindowB = tradesWindowB.filter((t) => t.entryTime >= midpointTime);

  const y1SumBase = evaluateTrades('Year 1 (2024-2025) Baseline', '', y1TradesBaseline);
  const y2SumBase = evaluateTrades('Year 2 (2025-2026) Baseline', '', y2TradesBaseline);

  const y1SumWindowB = evaluateTrades('Year 1 (2024-2025) News Filter', '', y1TradesWindowB);
  const y2SumWindowB = evaluateTrades('Year 2 (2025-2026) News Filter', '', y2TradesWindowB);

  const finalOutput = {
    generatedAt: new Date().toISOString(),
    baseline,
    windows: {
      windowA: summaryWindowA,
      windowB: summaryWindowB,
      windowC: summaryWindowC,
      windowD: summaryWindowD,
    },
    newsOnlyTrades: summaryNewsOnly,
    categoryBreakdown: categorySummaries,
    yearlyBreakdown: {
      year1: { baseline: y1SumBase, filtered: y1SumWindowB },
      year2: { baseline: y2SumBase, filtered: y2SumWindowB },
      twoYears: { baseline, filtered: summaryWindowB },
    },
  };

  const resultPath = path.join(process.cwd(), 'scratch', 'macro_news_impact_study_results.json');
  fs.writeFileSync(resultPath, JSON.stringify(finalOutput, null, 2), 'utf8');

  console.log('\n===============================================================');
  console.log(' 📊 2-YEAR MACROECONOMIC NEWS IMPACT AUDIT RESULTS');
  console.log('===============================================================');
  console.log(`Baseline 24/7 Trades:      ${baseline.totalTrades} | Win%: ${baseline.winRatePct}% | Net R: +${baseline.netRealizedR}R | PF: ${baseline.profitFactor} | Max DD: ${baseline.maxDrawdownR}R | $1k Equity: $${baseline.compoundingEndingEquity}`);
  console.log(`Window B (-15m/+30m) Trades: ${summaryWindowB.totalTrades} | Win%: ${summaryWindowB.winRatePct}% | Net R: +${summaryWindowB.netRealizedR}R | PF: ${summaryWindowB.profitFactor} | Max DD: ${summaryWindowB.maxDrawdownR}R | $1k Equity: $${summaryWindowB.compoundingEndingEquity}`);
  console.log(`News-Only Trades (-15m/+30m): ${summaryNewsOnly.totalTrades} | Win%: ${summaryNewsOnly.winRatePct}% | Net R: ${summaryNewsOnly.netRealizedR > 0 ? '+' : ''}${summaryNewsOnly.netRealizedR}R | PF: ${summaryNewsOnly.profitFactor}`);
  console.log('===============================================================\n');
}

main().catch((err) => {
  console.error('❌ Study execution failed:', err);
  process.exit(1);
});
