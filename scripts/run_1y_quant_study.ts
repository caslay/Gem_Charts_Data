/**
 * scripts/run_1y_quant_study.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional 1-Year Quantitative Study Runner
 * Evaluates ETHUSDC 5m Sweep & Reclaim with the newly updated V17.30 engine:
 *  - Zero lookahead bias in FVG detection
 *  - Immediate missed expansion exclusion
 *  - Strict 1:1 single-position walk & directional conflict lock
 *  - Exact match with Live PM2 execution
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';
import { adaptSweepReclaimSetupsToTrades, StandardizedExecutedTrade } from '../src/lib/quantEngine/equityCalculator';
import { saveLocalSrScan } from '../src/lib/quantLab/localScanStore';

const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/klines';

function parseBinanceKlines(raw: unknown[][]): Candle[] {
  return raw.map((c) => {
    const o = parseFloat(c[1] as string);
    const h = parseFloat(c[2] as string);
    const l = parseFloat(c[3] as string);
    const close = parseFloat(c[4] as string);
    const v = parseFloat(c[5] as string) || 0;

    const rawTakerBuy = parseFloat(c[9] as string);
    let taker_buy_vol: number;
    if (Number.isFinite(rawTakerBuy) && !isNaN(rawTakerBuy) && rawTakerBuy > 0) {
      taker_buy_vol = parseFloat(rawTakerBuy.toFixed(4));
    } else {
      const range = Math.max(0.0001, h - l);
      const conviction = Math.min(1.0, Math.max(0.0, (close - l) / range));
      taker_buy_vol = parseFloat((conviction * v).toFixed(4));
    }
    const taker_sell_vol = parseFloat(Math.max(0, v - taker_buy_vol).toFixed(4));

    return {
      t: Number(c[0]),
      o,
      h,
      l,
      c: close,
      v,
      taker_buy_vol,
      taker_sell_vol,
      isClosed: true,
    };
  });
}

async function fetchHistoricalKlines(
  symbol: string,
  interval: string,
  startMs: number,
  endMs: number
): Promise<Candle[]> {
  const scratchDir = path.join(process.cwd(), 'scratch');
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  const cachePath = path.join(scratchDir, `cached_${symbol}_${interval}_1y_${startMs}_${endMs}.json`);
  if (fs.existsSync(cachePath)) {
    console.log(`📂 Loading cached historical candles from disk: ${cachePath}...`);
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      console.log(`✅ Loaded ${cached.length} candles from disk cache.`);
      return cached;
    } catch (e) {
      console.warn('Cache parse failed, re-fetching...');
    }
  }

  console.log(`🌐 Streaming 1-Year historical Klines from Binance Futures REST API...`);
  const allKlines: Candle[] = [];
  let currentStart = startMs;
  const limit = 1000;
  let page = 0;

  while (currentStart < endMs) {
    page++;
    const url = `${BINANCE_REST}?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&endTime=${endMs - 1}&limit=${limit}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        console.warn(`[Binance Fetch] HTTP error ${res.status}`);
        break;
      }
      const raw: unknown[][] = await res.json();
      if (!raw || raw.length === 0) break;

      const parsed = parseBinanceKlines(raw);
      allKlines.push(...parsed);

      if (page % 10 === 0 || allKlines.length % 10000 === 0) {
        const currentDate = new Date(parsed[parsed.length - 1].t).toISOString().split('T')[0];
        console.log(`  ⏳ Fetched ${allKlines.length} candles (reached ${currentDate}, page ${page})...`);
      }

      const lastTime = Number(raw[raw.length - 1][0]);
      if (lastTime <= currentStart) break;
      currentStart = lastTime + 1;

      if (raw.length < limit) break;

      await new Promise((resolve) => setTimeout(resolve, 40));
    } catch (err) {
      console.warn(`Fetch error on page ${page}:`, err);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log(`✅ Completed fetching ${allKlines.length} historical candles.`);
  try {
    fs.writeFileSync(cachePath, JSON.stringify(allKlines));
    console.log(`💾 Cached candles to ${cachePath} (${(fs.statSync(cachePath).size / 1024 / 1024).toFixed(2)} MB)`);
  } catch (e) {
    console.warn('Failed to cache candles to disk:', e);
  }

  return allKlines;
}

interface MonthlyStat {
  month: string;
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number;
  exScratchWinRatePct: number;
  netR: number;
  profitFactor: number;
  maxDdInMonth: number;
}

function analyzeTrades(trades: StandardizedExecutedTrade[]) {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      scratches: 0,
      winRatePct: 0,
      scratchRatePct: 0,
      lossRatePct: 0,
      exScratchWinRatePct: 0,
      netR: 0,
      profitFactor: 0,
      expectedValueR: 0,
      maxDrawdownR: 0,
      peakR: 0,
      monthly: {},
      compoundingEquity10k: 10000,
      compoundingMaxDdPct: 0,
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

  // Monthly buckets
  const monthly: Record<string, MonthlyStat> = {};

  // Compounding simulation ($10,000 start, 2% risk per 1.0R)
  let equity = 10000;
  let peakEquity = 10000;
  let compoundingMaxDdPct = 0;

  for (const t of trades) {
    const r = t.realizedR;
    netR += r;
    cumulativeR += r;
    if (cumulativeR > peakR) peakR = cumulativeR;
    const currentDd = peakR - cumulativeR;
    if (currentDd > maxDrawdownR) maxDrawdownR = currentDd;

    // Compounding (2.0% risk per 1R)
    const tradeRiskDollar = equity * 0.02;
    const dollarPnl = tradeRiskDollar * r;
    equity += dollarPnl;
    if (equity > peakEquity) peakEquity = equity;
    const currentEqDd = ((peakEquity - equity) / peakEquity) * 100;
    if (currentEqDd > compoundingMaxDdPct) compoundingMaxDdPct = currentEqDd;

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

    // Monthly
    const date = new Date(t.timestamp);
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!monthly[monthKey]) {
      monthly[monthKey] = {
        month: monthKey,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        scratches: 0,
        winRatePct: 0,
        exScratchWinRatePct: 0,
        netR: 0,
        profitFactor: 0,
        maxDdInMonth: 0,
      };
    }
    const m = monthly[monthKey];
    m.totalTrades++;
    m.netR += r;
    if (r > 0.05) {
      if (t.outcome === 'FULL_TP2_WIN' || t.outcome === 'FULL_TP3_WIN' || r >= 1.0) {
        m.wins++;
      } else {
        m.scratches++;
      }
    } else if (r < -0.05) {
      m.losses++;
    } else {
      m.scratches++;
    }
  }

  // Finalize monthly
  for (const [mk, m] of Object.entries(monthly)) {
    m.winRatePct = m.totalTrades > 0 ? parseFloat(((m.wins / m.totalTrades) * 100).toFixed(1)) : 0;
    m.exScratchWinRatePct = (m.wins + m.losses) > 0 ? parseFloat(((m.wins / (m.wins + m.losses)) * 100).toFixed(1)) : 0;
    m.netR = parseFloat(m.netR.toFixed(2));

    const mTrades = trades.filter((t) => {
      const d = new Date(t.timestamp);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` === mk;
    });
    const winR = mTrades.filter((t) => t.realizedR > 0).reduce((s, t) => s + t.realizedR, 0);
    const lossR = mTrades.filter((t) => t.realizedR < 0).reduce((s, t) => s + Math.abs(t.realizedR), 0);
    m.profitFactor = lossR > 0 ? parseFloat((winR / lossR).toFixed(2)) : winR > 0 ? 99.9 : 0;

    let mPeak = 0;
    let mCum = 0;
    let mMaxDd = 0;
    for (const t of mTrades) {
      mCum += t.realizedR;
      if (mCum > mPeak) mPeak = mCum;
      const dd = mPeak - mCum;
      if (dd > mMaxDd) mMaxDd = dd;
    }
    m.maxDdInMonth = parseFloat(mMaxDd.toFixed(2));
  }

  const winRatePct = parseFloat(((wins / totalTrades) * 100).toFixed(1));
  const scratchRatePct = parseFloat(((scratches / totalTrades) * 100).toFixed(1));
  const lossRatePct = parseFloat(((losses / totalTrades) * 100).toFixed(1));
  const exScratchWinRatePct = (wins + losses) > 0 ? parseFloat(((wins / (wins + losses)) * 100).toFixed(1)) : 0;
  const profitFactor = grossLossR > 0 ? parseFloat((grossWinR / grossLossR).toFixed(2)) : 99.9;
  const expectedValueR = parseFloat((netR / totalTrades).toFixed(2));

  return {
    totalTrades,
    wins,
    losses,
    scratches,
    winRatePct,
    scratchRatePct,
    lossRatePct,
    exScratchWinRatePct,
    netR: parseFloat(netR.toFixed(2)),
    grossWinR: parseFloat(grossWinR.toFixed(2)),
    grossLossR: parseFloat(grossLossR.toFixed(2)),
    profitFactor,
    expectedValueR,
    maxDrawdownR: parseFloat(maxDrawdownR.toFixed(2)),
    peakR: parseFloat(peakR.toFixed(2)),
    monthly,
    compoundingEquity10k: parseFloat(equity.toFixed(2)),
    compoundingMaxDdPct: parseFloat(compoundingMaxDdPct.toFixed(1)),
  };
}

async function main() {
  console.log('═'.repeat(75));
  console.log('🏛️  1-YEAR QUANTITATIVE STUDY — POST-LOOKAHEAD FIX & 1:1 PM2 PARITY');
  console.log('═'.repeat(75));

  // Date range: Exactly 1 year ending at current live candle
  const endMs = Date.parse('2026-09-04T00:00:00.000Z');
  const startMs = Date.parse('2025-09-04T00:00:00.000Z');
  // 5 days extra warmup for structural anchors
  const warmupMs = startMs - 5 * 24 * 60 * 60 * 1000;

  console.log(`📅 Study Window: 2025-09-04 → 2026-09-04 (Warmup from 2025-08-30)`);
  console.log(`🪙 Symbol: ETHUSDC | Timeframe: 5m\n`);

  // 1. Fetch / Load candles
  const candles = await fetchHistoricalKlines('ETHUSDC', '5m', warmupMs, endMs);
  if (!candles || candles.length === 0) {
    console.error('❌ Failed to obtain candle dataset.');
    process.exit(1);
  }

  console.log(`\nCandles spanning from ${new Date(candles[0].t).toISOString()} to ${new Date(candles[candles.length - 1].t).toISOString()} (${candles.length} bars)`);

  // 2. Configure Champion Scan Config
  const scanConfig: SweepReclaimScanConfig = {
    symbol: 'ETHUSDC',
    timeframe: '5m',
    anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
    lookbackMajor: 10,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 25,
    maxBarsSweepToReclaim: 10,
    maxBarsToRetest: 20, // Live PM2 Champion window
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
    entryMode: 'FVG_PROXIMAL',
    enableStructuralTrail: true,
    enableProfitRatchet: false,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.10,
  };

  console.log(`\n⚙️  Running SweepReclaimEngine (V17.30)...`);
  const t0 = Date.now();
  const engine = new SweepReclaimEngine(scanConfig);
  const scanResult = engine.scanHistoricalSetups(candles);
  const durationSec = ((Date.now() - t0) / 1000).toFixed(2);

  console.log(`✅ Scan completed in ${durationSec}s!`);
  console.log(`   Total Anchors Evaluated: ${scanResult.telemetry.total_anchors_detected}`);
  console.log(`   Total Sweeps Detected:   ${scanResult.telemetry.total_sweeps_detected} (${scanResult.telemetry.sweep_rate_pct}%)`);
  console.log(`   Total Reclaims Passed:   ${scanResult.telemetry.total_reclaims_confirmed} (${scanResult.telemetry.reclaim_rate_pct}%)`);
  console.log(`   Raw Retests Triggered:   ${scanResult.telemetry.total_retests_executed}`);

  // Filter setups to the study window (>= startMs)
  const windowSetups = scanResult.setups.filter((s) => {
    const t = s.retest_time || s.reclaim_time || s.sweep_time || s.anchor_time || 0;
    return t >= startMs && t <= endMs;
  });
  console.log(`   Setups inside 1-Year window: ${windowSetups.length}`);

  // 3. Adapt to 1:1 PM2 Executed Trades (Strict Single Position Walk)
  console.log(`\n🔬 Executing 1:1 PM2 Single-Position Concurrency Walk...`);
  const executedTrades = adaptSweepReclaimSetupsToTrades(windowSetups, {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: false, // Pure Champion Profile
    filterWeekend: false,
    postLossCooldownMinutes: 0,
  });

  const executedAnalysis = analyzeTrades(executedTrades);

  // 4. Also test additional configurations
  console.log(`🛡️  Executing Anti-Cluster Quant Shield Walk (Wave Dedup + 45m Cooldown)...`);
  const antiClusterTrades = adaptSweepReclaimSetupsToTrades(windowSetups, {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: true,
    filterWeekend: false,
    postLossCooldownMinutes: 45,
  });
  const antiClusterAnalysis = analyzeTrades(antiClusterTrades);

  // 4B. Macro Liquidity Only (Excluding minor 5m Swing Pivots)
  const macroSetups = windowSetups.filter(s => s.anchor_type !== 'SWING_PIVOT');
  console.log(`🏛️  Executing Macro Liquidity Only Walk (Session High/Low + PDH/PDL)...`);
  const macroTrades = adaptSweepReclaimSetupsToTrades(macroSetups, {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: true,
    filterWeekend: false,
    postLossCooldownMinutes: 45,
  });
  const macroAnalysis = analyzeTrades(macroTrades);

  // 4C. Early Breakeven Shield (Champion + 0.60R BE)
  console.log(`⚡ Executing Champion + Early Breakeven (0.60R MFE -> BE)...`);
  const earlyBeTrades = adaptSweepReclaimSetupsToTrades(windowSetups, {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: false,
    filterWeekend: false,
    enableEarlyBreakeven: true,
    earlyBreakevenMultiple: 0.60,
    postLossCooldownMinutes: 0,
  });
  const earlyBeAnalysis = analyzeTrades(earlyBeTrades);

  // 4D. Combined Institutional Alpha Shield (Wave Dedup + 45m Cooldown + Early BE 0.60R)
  console.log(`💎 Executing Combined Alpha Shield (Wave Dedup + 45m Cooldown + Early BE)...`);
  const combinedTrades = adaptSweepReclaimSetupsToTrades(windowSetups, {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: true,
    filterWeekend: false,
    enableEarlyBreakeven: true,
    earlyBreakevenMultiple: 0.60,
    postLossCooldownMinutes: 45,
  });
  const combinedAnalysis = analyzeTrades(combinedTrades);

  // 4E. Swing Pivots Only + Combined Alpha Shield
  const swingSetups = windowSetups.filter(s => s.anchor_type === 'SWING_PIVOT');
  console.log(`🎯 Executing Swing Pivots + Combined Alpha Shield...`);
  const swingCombinedTrades = adaptSweepReclaimSetupsToTrades(swingSetups, {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: true,
    filterWeekend: false,
    enableEarlyBreakeven: true,
    earlyBreakevenMultiple: 0.60,
    postLossCooldownMinutes: 45,
  });
  const swingCombinedAnalysis = analyzeTrades(swingCombinedTrades);

  // 5. Output Institutional Scorecard
  console.log('\n' + '═'.repeat(120));
  console.log('📊 1-YEAR PERFORMANCE AUDIT: MULTI-PROFILE INSTITUTIONAL COMPARISON (1:1 EXECUTED TRADES)');
  console.log('═'.repeat(120));

  console.log(`
┌──────────────────────────────────────┬───────────────────────┬───────────────────────┬───────────────────────┬───────────────────────┬───────────────────────┐
│ Metric                               │ Champion Live (1:1)   │ Anti-Cluster Shield   │ Early BE (0.60R MFE)  │ Combined Alpha Shield │ Swing Pivot + Comb.   │
├──────────────────────────────────────┼───────────────────────┼───────────────────────┼───────────────────────┼───────────────────────┼───────────────────────┤
│ Executed Trades Count                │ ${String(executedAnalysis.totalTrades).padEnd(21)} │ ${String(antiClusterAnalysis.totalTrades).padEnd(21)} │ ${String(earlyBeAnalysis.totalTrades).padEnd(21)} │ ${String(combinedAnalysis.totalTrades).padEnd(21)} │ ${String(swingCombinedAnalysis.totalTrades).padEnd(21)} │
│ Full TP2 Wins (+1.20R)               │ ${String(executedAnalysis.wins + ' (' + executedAnalysis.winRatePct + '%)').padEnd(21)} │ ${String(antiClusterAnalysis.wins + ' (' + antiClusterAnalysis.winRatePct + '%)').padEnd(21)} │ ${String(earlyBeAnalysis.wins + ' (' + earlyBeAnalysis.winRatePct + '%)').padEnd(21)} │ ${String(combinedAnalysis.wins + ' (' + combinedAnalysis.winRatePct + '%)').padEnd(21)} │ ${String(swingCombinedAnalysis.wins + ' (' + swingCombinedAnalysis.winRatePct + '%)').padEnd(21)} │
│ Scratches (TP1 / BE +0.50R)          │ ${String(executedAnalysis.scratches + ' (' + executedAnalysis.scratchRatePct + '%)').padEnd(21)} │ ${String(antiClusterAnalysis.scratches + ' (' + antiClusterAnalysis.scratchRatePct + '%)').padEnd(21)} │ ${String(earlyBeAnalysis.scratches + ' (' + earlyBeAnalysis.scratchRatePct + '%)').padEnd(21)} │ ${String(combinedAnalysis.scratches + ' (' + combinedAnalysis.scratchRatePct + '%)').padEnd(21)} │ ${String(swingCombinedAnalysis.scratches + ' (' + swingCombinedAnalysis.scratchRatePct + '%)').padEnd(21)} │
│ Losses / Stop-Outs (-1.00R)          │ ${String(executedAnalysis.losses + ' (' + executedAnalysis.lossRatePct + '%)').padEnd(21)} │ ${String(antiClusterAnalysis.losses + ' (' + antiClusterAnalysis.lossRatePct + '%)').padEnd(21)} │ ${String(earlyBeAnalysis.losses + ' (' + earlyBeAnalysis.lossRatePct + '%)').padEnd(21)} │ ${String(combinedAnalysis.losses + ' (' + combinedAnalysis.lossRatePct + '%)').padEnd(21)} │ ${String(swingCombinedAnalysis.losses + ' (' + swingCombinedAnalysis.lossRatePct + '%)').padEnd(21)} │
│ Win Rate Ex-Scratch                  │ ${String(executedAnalysis.exScratchWinRatePct + '%').padEnd(21)} │ ${String(antiClusterAnalysis.exScratchWinRatePct + '%').padEnd(21)} │ ${String(earlyBeAnalysis.exScratchWinRatePct + '%').padEnd(21)} │ ${String(combinedAnalysis.exScratchWinRatePct + '%').padEnd(21)} │ ${String(swingCombinedAnalysis.exScratchWinRatePct + '%').padEnd(21)} │
│ Gross Profit (Wins R)                │ ${String('+' + executedAnalysis.grossWinR + 'R').padEnd(21)} │ ${String('+' + antiClusterAnalysis.grossWinR + 'R').padEnd(21)} │ ${String('+' + earlyBeAnalysis.grossWinR + 'R').padEnd(21)} │ ${String('+' + combinedAnalysis.grossWinR + 'R').padEnd(21)} │ ${String('+' + swingCombinedAnalysis.grossWinR + 'R').padEnd(21)} │
│ Gross Loss (Losses R)                │ ${String('-' + executedAnalysis.grossLossR + 'R').padEnd(21)} │ ${String('-' + antiClusterAnalysis.grossLossR + 'R').padEnd(21)} │ ${String('-' + earlyBeAnalysis.grossLossR + 'R').padEnd(21)} │ ${String('-' + combinedAnalysis.grossLossR + 'R').padEnd(21)} │ ${String('-' + swingCombinedAnalysis.grossLossR + 'R').padEnd(21)} │
│ Net Realized Return                  │ ${String('+' + executedAnalysis.netR + 'R').padEnd(21)} │ ${String('+' + antiClusterAnalysis.netR + 'R').padEnd(21)} │ ${String('+' + earlyBeAnalysis.netR + 'R').padEnd(21)} │ ${String('+' + combinedAnalysis.netR + 'R').padEnd(21)} │ ${String('+' + swingCombinedAnalysis.netR + 'R').padEnd(21)} │
│ Profit Factor                        │ ${String(executedAnalysis.profitFactor).padEnd(21)} │ ${String(antiClusterAnalysis.profitFactor).padEnd(21)} │ ${String(earlyBeAnalysis.profitFactor).padEnd(21)} │ ${String(combinedAnalysis.profitFactor).padEnd(21)} │ ${String(swingCombinedAnalysis.profitFactor).padEnd(21)} │
│ Expected Value (EV / trade)          │ ${String('+' + executedAnalysis.expectedValueR + 'R').padEnd(21)} │ ${String('+' + antiClusterAnalysis.expectedValueR + 'R').padEnd(21)} │ ${String('+' + earlyBeAnalysis.expectedValueR + 'R').padEnd(21)} │ ${String('+' + combinedAnalysis.expectedValueR + 'R').padEnd(21)} │ ${String('+' + swingCombinedAnalysis.expectedValueR + 'R').padEnd(21)} │
│ Peak Equity (R)                      │ ${String('+' + executedAnalysis.peakR + 'R').padEnd(21)} │ ${String('+' + antiClusterAnalysis.peakR + 'R').padEnd(21)} │ ${String('+' + earlyBeAnalysis.peakR + 'R').padEnd(21)} │ ${String('+' + combinedAnalysis.peakR + 'R').padEnd(21)} │ ${String('+' + swingCombinedAnalysis.peakR + 'R').padEnd(21)} │
│ Max Drawdown (R)                     │ ${String('-' + executedAnalysis.maxDrawdownR + 'R').padEnd(21)} │ ${String('-' + antiClusterAnalysis.maxDrawdownR + 'R').padEnd(21)} │ ${String('-' + earlyBeAnalysis.maxDrawdownR + 'R').padEnd(21)} │ ${String('-' + combinedAnalysis.maxDrawdownR + 'R').padEnd(21)} │ ${String('-' + swingCombinedAnalysis.maxDrawdownR + 'R').padEnd(21)} │
│ Compounded $10k Equity (2% risk)     │ ${String('$' + executedAnalysis.compoundingEquity10k.toLocaleString()).padEnd(21)} │ ${String('$' + antiClusterAnalysis.compoundingEquity10k.toLocaleString()).padEnd(21)} │ ${String('$' + earlyBeAnalysis.compoundingEquity10k.toLocaleString()).padEnd(21)} │ ${String('$' + combinedAnalysis.compoundingEquity10k.toLocaleString()).padEnd(21)} │ ${String('$' + swingCombinedAnalysis.compoundingEquity10k.toLocaleString()).padEnd(21)} │
│ Compounded Max Drawdown %            │ ${String(executedAnalysis.compoundingMaxDdPct + '%').padEnd(21)} │ ${String(antiClusterAnalysis.compoundingMaxDdPct + '%').padEnd(21)} │ ${String(earlyBeAnalysis.compoundingMaxDdPct + '%').padEnd(21)} │ ${String(combinedAnalysis.compoundingMaxDdPct + '%').padEnd(21)} │ ${String(swingCombinedAnalysis.compoundingMaxDdPct + '%').padEnd(21)} │
└──────────────────────────────────────┴───────────────────────┴───────────────────────┴───────────────────────┴───────────────────────┴───────────────────────┘
`);

  // Anchor Type Performance Breakdown
  console.log('\n' + '═'.repeat(85));
  console.log('🎯 PERFORMANCE BY ANCHOR TYPE (Champion Live Trades)');
  console.log('═'.repeat(85));
  console.log(`Anchor Type         | Trades | Wins | Scratches | Losses | WinRate | Net R   | ProfitFactor`);
  console.log(`--------------------+--------+------+-----------+--------+---------+---------+-------------`);

  const anchorTypes = Array.from(new Set(executedTrades.map(t => t.metadata?.anchorType || 'UNKNOWN')));
  for (const at of anchorTypes) {
    const atTrades = executedTrades.filter(t => (t.metadata?.anchorType || 'UNKNOWN') === at);
    const atAnalysis = analyzeTrades(atTrades);
    const sign = atAnalysis.netR >= 0 ? '+' : '';
    console.log(
      `${at.padEnd(19)} | ${String(atAnalysis.totalTrades).padStart(6)} | ${String(atAnalysis.wins).padStart(4)} | ${String(atAnalysis.scratches).padStart(9)} | ${String(atAnalysis.losses).padStart(6)} | ${String(atAnalysis.winRatePct + '%').padStart(7)} | ${String(sign + atAnalysis.netR + 'R').padStart(7)} | ${String(atAnalysis.profitFactor).padStart(12)}`
    );
  }

  console.log('\n' + '═'.repeat(85));
  console.log('📅 MONTH-BY-MONTH REALIZED BREAKDOWN (Champion Live 1:1 Execution)');
  console.log('═'.repeat(85));
  console.log(`Month    | Trades | Wins | Scratches | Losses | WinRate | Net R   | ProfitFactor | MaxDD (R)`);
  console.log(`---------+--------+------+-----------+--------+---------+---------+--------------+----------`);

  const sortedMonths = Object.keys(executedAnalysis.monthly).sort();
  for (const mk of sortedMonths) {
    const m = executedAnalysis.monthly[mk];
    const sign = m.netR >= 0 ? '+' : '';
    console.log(
      `${m.month.padEnd(8)} | ${String(m.totalTrades).padStart(6)} | ${String(m.wins).padStart(4)} | ${String(m.scratches).padStart(9)} | ${String(m.losses).padStart(6)} | ${String(m.winRatePct + '%').padStart(7)} | ${String(sign + m.netR + 'R').padStart(7)} | ${String(m.profitFactor).padStart(12)} | -${m.maxDdInMonth}R`
    );
  }

  console.log('\n' + '═'.repeat(85));
  console.log('💎 MONTH-BY-MONTH REALIZED BREAKDOWN (Early BE @ 0.60R MFE Shield)');
  console.log('═'.repeat(85));
  console.log(`Month    | Trades | Wins | Scratches | Losses | WinRate | Net R   | ProfitFactor | MaxDD (R)`);
  console.log(`---------+--------+------+-----------+--------+---------+---------+--------------+----------`);

  for (const mk of sortedMonths) {
    const m = earlyBeAnalysis.monthly[mk];
    const sign = m.netR >= 0 ? '+' : '';
    console.log(
      `${m.month.padEnd(8)} | ${String(m.totalTrades).padStart(6)} | ${String(m.wins).padStart(4)} | ${String(m.scratches).padStart(9)} | ${String(m.losses).padStart(6)} | ${String(m.winRatePct + '%').padStart(7)} | ${String(sign + m.netR + 'R').padStart(7)} | ${String(m.profitFactor).padStart(12)} | -${m.maxDdInMonth}R`
    );
  }

  // 6. Save new scan to localScanStore for Quant Lab UI
  const scanId = '1y-champion-parity-' + Date.now();
  const scanRecord = {
    id: scanId,
    scan_name: '1y ETHUSDC 5m V17.30 (Parity Cleansed)',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    start_date: new Date(startMs).toISOString(),
    end_date: new Date(endMs).toISOString(),
    total_detected: scanResult.telemetry.total_anchors_detected,
    sweep_rate_pct: scanResult.telemetry.sweep_rate_pct,
    reclaim_rate_pct: scanResult.telemetry.reclaim_rate_pct,
    retest_rate_pct: scanResult.telemetry.retest_rate_pct,
    retest_win_rate_pct: executedAnalysis.winRatePct,
    avg_realized_rr: executedAnalysis.expectedValueR,
    profit_factor: executedAnalysis.profitFactor,
    telemetry_summary: scanResult.telemetry,
    setups: windowSetups,
    created_at: new Date().toISOString(),
  };

  await saveLocalSrScan(scanRecord as any);
  console.log(`\n💾 Saved scan to Quant Lab local store: data/quant_lab/sr_scans/${scanId}.json`);

  // Write a summary markdown file for documentation
  const reportMdPath = path.join(process.cwd(), 'docs', '1YEAR_POST_PARITY_AUDIT_REPORT.md');
  const mdContent = `# 🏛️ 1-Year Quantitative Performance Audit (V17.30 Parity Cleansed)

> **Asset:** ETHUSDC.p (Binance Futures 5m)  
> **Evaluation Window:** 2025-09-04 00:00 UTC → 2026-09-04 00:00 UTC (365 Days • 105,120 Candles)  
> **Engine State:** V17.30 (Zero-Lookahead FVG Clamp + Missed Expansion Exclusion + 1:1 PM2 Single Position Walk)  
> **Generated:** ${new Date().toISOString()}

---

## 1. Executive Summary & Verdict

Following the discovery and resolution of the FVG lookahead bias and phantom multi-position concurrency stacking, this 1-year backtest reflects **genuine, 1:1 executable market reality**.

### Headline Results (Champion Live Profile):
- **Total Executed Trades:** **${executedAnalysis.totalTrades}** (strictly non-overlapping, sequential walk).
- **Full TP2 Wins (+1.20R):** **${executedAnalysis.wins} (${executedAnalysis.winRatePct}%)**
- **Scratches (TP1 / BE +0.50R):** **${executedAnalysis.scratches} (${executedAnalysis.scratchRatePct}%)**
- **Losses / Stop-Outs (-1.00R):** **${executedAnalysis.losses} (${executedAnalysis.lossRatePct}%)**
- **Win Rate (Excluding Scratches):** **${executedAnalysis.exScratchWinRatePct}%**
- **Net Realized Return:** **+${executedAnalysis.netR}R**
- **Profit Factor:** **${executedAnalysis.profitFactor}**
- **Expected Value (EV / trade):** **+${executedAnalysis.expectedValueR}R**
- **Max Drawdown (R):** **-${executedAnalysis.maxDrawdownR}R**
- **Compounded Equity from \$10,000 (2% risk):** **\$${executedAnalysis.compoundingEquity10k.toLocaleString()}** (Max Drawdown: **${executedAnalysis.compoundingMaxDdPct}%**)

---

## 2. Monthly Performance Matrix

| Month | Executed Trades | Wins | Scratches | Losses | Win Rate % | Net Realized R | Profit Factor | Max DD (R) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${sortedMonths
  .map((mk) => {
    const m = executedAnalysis.monthly[mk];
    const s = m.netR >= 0 ? '+' : '';
    return `| **${m.month}** | ${m.totalTrades} | ${m.wins} | ${m.scratches} | ${m.losses} | ${m.winRatePct}% | **${s}${m.netR}R** | ${m.profitFactor} | -${m.maxDdInMonth}R |`;
  })
  .join('\n')}
| **TOTAL** | **${executedAnalysis.totalTrades}** | **${executedAnalysis.wins}** | **${executedAnalysis.scratches}** | **${executedAnalysis.losses}** | **${executedAnalysis.winRatePct}%** | **+${executedAnalysis.netR}R** | **${executedAnalysis.profitFactor}** | **-${executedAnalysis.maxDrawdownR}R** |
`;

  fs.writeFileSync(reportMdPath, mdContent);
  console.log(`📝 Audit Report generated at: ${reportMdPath}`);
  console.log('═'.repeat(75));
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
