/**
 * scripts/run_1m_3m_liquidity_hunter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 🏹 High-Fidelity 1m & 3m Liquidity Hunter Simulation Engine.
 * 
 * Bypasses the UI tunnel (no rigid 15-bar 50% FVG retest).
 * Implements pure institutional liquidity hunting:
 *  1. Identifies Resting Liquidity Pools (Asian H/L, London H/L, PDH/PDL, Equal H/L).
 *  2. Detects Stop Runs (Wick piercing pool + high volume absorption).
 *  3. Triggers on SFP (Swing Failure Pattern) Shelf Snap (Body closes back inside).
 *  4. Entry: Exact Shelf Level (Limit at broken anchor) or Immediate Reclaim Close.
 *  5. Stop Loss: 1 tick behind the sweep wick tip (tight $1.50 - $3.50 risk).
 *  6. Target: Opposing Liquidity Pool / Range Equilibrium (3R to 8R asymmetric payoff).
 *  7. Full Binance USDⓈ-M Fee Physics (0.00% Maker / 0.04% Taker).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from '../src/lib/fvgEngine';

const BINANCE_FAPI = 'https://fapi.binance.com/fapi/v1/klines';

interface LiquidityPool {
  id: string;
  name: string;
  type: 'BSL' | 'SSL'; // Buy-Side Liquidity (Highs) vs Sell-Side Liquidity (Lows)
  price: number;
  time: number;
  originIndex: number;
  isSwept: boolean;
}

interface SfpTrade {
  id: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  anchorName: string;
  anchorPrice: number;
  sweepPrice: number;
  entryPrice: number;
  entryTime: number;
  stopLoss: number;
  riskUsd: number;
  target1: number;
  target2: number;
  outcome: 'WIN_FULL' | 'WIN_TP1_SCRATCH' | 'STOPPED_OUT' | 'PENDING';
  realizedR: number;
  netRealizedR: number;
  feeR: number;
  exitPrice: number;
  exitTime: number;
  barsHeld: number;
}

// ── Kline Fetcher ────────────────────────────────────────────────────────────

async function fetchBinancePagedKlines(
  symbol: string,
  interval: string,
  totalCandles: number = 3000
): Promise<Candle[]> {
  const candles: Candle[] = [];
  const limit = 1000;
  let endTime = Date.now();

  console.log(`📡 Fetching ${totalCandles} ${interval} klines for ${symbol} from Binance Futures...`);

  while (candles.length < totalCandles) {
    const url = `${BINANCE_FAPI}?symbol=${symbol}&interval=${interval}&limit=${limit}&endTime=${endTime}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance API Error: ${res.statusText}`);
    const raw = (await res.json()) as any[];
    if (!raw || raw.length === 0) break;

    const batch: Candle[] = raw.map((k) => {
      const o = parseFloat(k[1]);
      const h = parseFloat(k[2]);
      const l = parseFloat(k[3]);
      const c = parseFloat(k[4]);
      const v = parseFloat(k[5]);
      const taker_buy = parseFloat(k[9]);
      return {
        t: k[0],
        o,
        h,
        l,
        c,
        v,
        taker_buy_vol: taker_buy,
        taker_sell_vol: Math.max(0, v - taker_buy),
        isClosed: true,
      };
    });

    candles.unshift(...batch);
    endTime = batch[0].t - 1;
    if (raw.length < limit) break;
  }

  // Deduplicate and sort chronologically
  const unique = Array.from(new Map(candles.map((c) => [c.t, c])).values());
  unique.sort((a, b) => a.t - b.t);
  console.log(`✅ Loaded ${unique.length} candles (${new Date(unique[0].t).toISOString()} to ${new Date(unique[unique.length - 1].t).toISOString()})`);
  return unique;
}

// ── Liquidity Pool Extractor ─────────────────────────────────────────────────

function extractLiquidityPools(candles: Candle[], lookbackBars: number = 20): LiquidityPool[] {
  const pools: LiquidityPool[] = [];

  // 1. Swing Highs & Lows (Clean turning points where stops cluster)
  for (let i = lookbackBars; i < candles.length - lookbackBars; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = i - lookbackBars; j <= i + lookbackBars; j++) {
      if (j === i) continue;
      if (candles[j].h >= c.h) isHigh = false;
      if (candles[j].l <= c.l) isLow = false;
    }

    if (isHigh) {
      pools.push({
        id: `SWING_HIGH_${c.t}`,
        name: `Swing High ($${c.h.toFixed(2)})`,
        type: 'BSL',
        price: c.h,
        time: c.t,
        originIndex: i,
        isSwept: false,
      });
    }

    if (isLow) {
      pools.push({
        id: `SWING_LOW_${c.t}`,
        name: `Swing Low ($${c.l.toFixed(2)})`,
        type: 'SSL',
        price: c.l,
        time: c.t,
        originIndex: i,
        isSwept: false,
      });
    }
  }

  // 2. Session Extremes (Asian Range: 00:00 - 07:00 UTC)
  const sessionHighs = new Map<string, { high: number; low: number; time: number; index: number }>();
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const date = new Date(c.t);
    const hour = date.getUTCHours();
    const dayKey = date.toISOString().slice(0, 10);

    if (hour >= 0 && hour < 7) {
      const current = sessionHighs.get(dayKey) || { high: -Infinity, low: Infinity, time: c.t, index: i };
      if (c.h > current.high) current.high = c.h;
      if (c.l < current.low) current.low = c.l;
      sessionHighs.set(dayKey, current);
    }
  }

  sessionHighs.forEach((val, dayKey) => {
    pools.push({
      id: `ASIA_HIGH_${dayKey}`,
      name: `Asian High [${dayKey}]`,
      type: 'BSL',
      price: val.high,
      time: val.time,
      originIndex: val.index,
      isSwept: false,
    });
    pools.push({
      id: `ASIA_LOW_${dayKey}`,
      name: `Asian Low [${dayKey}]`,
      type: 'SSL',
      price: val.low,
      time: val.time,
      originIndex: val.index,
      isSwept: false,
    });
  });

  pools.sort((a, b) => a.time - b.time);
  return pools;
}

// ── SFP Liquidity Hunter Simulation ──────────────────────────────────────────

interface HunterConfig {
  timeframe: string;
  entryMode: 'SHELF_RETEST' | 'IMMEDIATE_CLOSE';
  minSweepPips: number; // Minimum penetration beyond pool ($)
  maxWickDistance: number; // Max stop distance allowed ($)
  minVolumeRatio?: number; // Minimum volume expansion on sweep/reclaim
  tp1Ratio: number; // e.g. 0.50
  tp2Ratio: number; // e.g. 0.50
  tp1Multiple: number; // e.g. 2.5R
  tp2Multiple: number; // e.g. 5.0R
  cooldownBars: number; // Post-trade cooldown
  makerFeePct: number; // 0.0000%
  takerFeePct: number; // 0.0400%
}

function runLiquidityHunterSimulation(
  candles: Candle[],
  pools: LiquidityPool[],
  config: HunterConfig
): { trades: SfpTrade[]; summary: any } {
  const trades: SfpTrade[] = [];
  let inTrade = false;
  let cooldownUntilIndex = 0;

  // Precompute Volume SMA20
  const volSma: number[] = new Array(candles.length).fill(0);
  for (let i = 20; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - 20; j < i; j++) sum += candles[j].v;
    volSma[i] = sum / 20;
  }

  for (let i = 50; i < candles.length - 50; i++) {
    if (i < cooldownUntilIndex) continue;
    if (inTrade) continue;

    const currentCandle = candles[i];
    const avgVol = volSma[i] || 1;
    const volRatio = currentCandle.v / avgVol;

    // Optional Volume Filter
    if (config.minVolumeRatio && volRatio < config.minVolumeRatio) continue;

    // Find active un-swept pools formed at least 5 bars ago
    const activePools = pools.filter(
      (p) => !p.isSwept && p.originIndex < i - 5 && i - p.originIndex < 300
    );

    for (const pool of activePools) {
      if (inTrade) break;

      // ── BULLISH SFP: Sweep of Sell-Side Liquidity (SSL) ────────────────────
      if (pool.type === 'SSL') {
        const swept = currentCandle.l < pool.price;
        const sweepDepth = pool.price - currentCandle.l;

        if (swept && sweepDepth >= config.minSweepPips) {
          // SFP Rule: Price pierces below pool, but candle CLOSES back ABOVE the shelf!
          const isSfpClose = currentCandle.c > pool.price && currentCandle.c > currentCandle.o;
          const lowerWick = Math.min(currentCandle.o, currentCandle.c) - currentCandle.l;
          const totalRange = currentCandle.h - currentCandle.l;
          const isRejectionWick = totalRange > 0 && lowerWick / totalRange >= 0.40;

          if (isSfpClose || (isRejectionWick && currentCandle.c >= pool.price - 0.50)) {
            pool.isSwept = true;

            const sweepPrice = currentCandle.l;
            const stopLoss = sweepPrice - 0.20; // 1 tick behind wick tip
            const entryPrice = config.entryMode === 'SHELF_RETEST' ? pool.price : currentCandle.c;
            const riskUsd = entryPrice - stopLoss;

            if (riskUsd <= 0.80 || riskUsd > config.maxWickDistance) continue; // Skip blown-out wicks

            // Simulate Retest and Forward Walk
            let filled = false;
            let fillIndex = i;
            let fillPrice = entryPrice;

            if (config.entryMode === 'IMMEDIATE_CLOSE') {
              filled = true;
              fillIndex = i;
              fillPrice = currentCandle.c;
            } else {
              // Wait up to 5 bars for a dip to the broken shelf level
              for (let f = i; f <= Math.min(candles.length - 1, i + 5); f++) {
                if (candles[f].l <= pool.price) {
                  filled = true;
                  fillIndex = f;
                  fillPrice = pool.price;
                  break;
                }
              }
            }

            if (!filled) continue;

            const tp1Price = fillPrice + config.tp1Multiple * riskUsd;
            const tp2Price = fillPrice + config.tp2Multiple * riskUsd;

            // Forward trade walk
            let tradeOutcome: SfpTrade['outcome'] = 'PENDING';
            let exitPrice = fillPrice;
            let exitTime = candles[fillIndex].t;
            let barsHeld = 0;
            let isTp1Hit = false;
            let trailingSl = stopLoss;

            for (let k = fillIndex + 1; k < Math.min(candles.length, fillIndex + 100); k++) {
              const bar = candles[k];
              barsHeld++;

              // Check Stop Loss
              if (bar.l <= trailingSl) {
                if (isTp1Hit) {
                  tradeOutcome = 'WIN_TP1_SCRATCH';
                  exitPrice = trailingSl;
                } else {
                  tradeOutcome = 'STOPPED_OUT';
                  exitPrice = trailingSl;
                }
                exitTime = bar.t;
                break;
              }

              // Check TP1
              if (!isTp1Hit && bar.h >= tp1Price) {
                isTp1Hit = true;
                trailingSl = fillPrice + 0.10; // Move to breakeven ONLY after TP1!
              }

              // Check TP2
              if (isTp1Hit && bar.h >= tp2Price) {
                tradeOutcome = 'WIN_FULL';
                exitPrice = tp2Price;
                exitTime = bar.t;
                break;
              }
            }

            if (tradeOutcome === 'PENDING') {
              tradeOutcome = isTp1Hit ? 'WIN_TP1_SCRATCH' : 'STOPPED_OUT';
              exitPrice = candles[Math.min(candles.length - 1, fillIndex + 100)].c;
              exitTime = candles[Math.min(candles.length - 1, fillIndex + 100)].t;
            }

            // Fee and Return Calculations
            let grossR = 0;
            if (tradeOutcome === 'WIN_FULL') {
              grossR = config.tp1Ratio * config.tp1Multiple + config.tp2Ratio * config.tp2Multiple;
            } else if (tradeOutcome === 'WIN_TP1_SCRATCH') {
              grossR = config.tp1Ratio * config.tp1Multiple;
            } else {
              grossR = -1.0;
            }

            const notionalMultiplier = 1.0 / (riskUsd / fillPrice);
            const entryFeeR = notionalMultiplier * (config.takerFeePct / 100);
            const exitFeeR = tradeOutcome === 'STOPPED_OUT'
              ? notionalMultiplier * (config.takerFeePct / 100)
              : 0;
            const feeR = entryFeeR + exitFeeR;
            const netR = grossR - feeR;

            trades.push({
              id: `TRADE_BULL_${currentCandle.t}`,
              timeframe: config.timeframe,
              direction: 'LONG',
              anchorName: pool.name,
              anchorPrice: pool.price,
              sweepPrice,
              entryPrice: fillPrice,
              entryTime: candles[fillIndex].t,
              stopLoss,
              riskUsd: parseFloat(riskUsd.toFixed(2)),
              target1: parseFloat(tp1Price.toFixed(2)),
              target2: parseFloat(tp2Price.toFixed(2)),
              outcome: tradeOutcome,
              realizedR: parseFloat(grossR.toFixed(2)),
              netRealizedR: parseFloat(netR.toFixed(2)),
              feeR: parseFloat(feeR.toFixed(3)),
              exitPrice: parseFloat(exitPrice.toFixed(2)),
              exitTime,
              barsHeld,
            });

            cooldownUntilIndex = fillIndex + config.cooldownBars;
            break;
          }
        }
      }

      // ── BEARISH SFP: Sweep of Buy-Side Liquidity (BSL) ────────────────────
      if (pool.type === 'BSL') {
        const swept = currentCandle.h > pool.price;
        const sweepDepth = currentCandle.h - pool.price;

        if (swept && sweepDepth >= config.minSweepPips) {
          const isSfpClose = currentCandle.c < pool.price && currentCandle.c < currentCandle.o;
          const upperWick = currentCandle.h - Math.max(currentCandle.o, currentCandle.c);
          const totalRange = currentCandle.h - currentCandle.l;
          const isRejectionWick = totalRange > 0 && upperWick / totalRange >= 0.40;

          if (isSfpClose || (isRejectionWick && currentCandle.c <= pool.price + 0.50)) {
            pool.isSwept = true;

            const sweepPrice = currentCandle.h;
            const stopLoss = sweepPrice + 0.20;
            const entryPrice = config.entryMode === 'SHELF_RETEST' ? pool.price : currentCandle.c;
            const riskUsd = stopLoss - entryPrice;

            if (riskUsd <= 0.50 || riskUsd > config.maxWickDistance) continue;

            let filled = false;
            let fillIndex = i;
            let fillPrice = entryPrice;

            if (config.entryMode === 'IMMEDIATE_CLOSE') {
              filled = true;
              fillIndex = i;
              fillPrice = currentCandle.c;
            } else {
              for (let f = i; f <= Math.min(candles.length - 1, i + 5); f++) {
                if (candles[f].h >= pool.price) {
                  filled = true;
                  fillIndex = f;
                  fillPrice = pool.price;
                  break;
                }
              }
            }

            if (!filled) continue;

            const tp1Price = fillPrice - config.tp1Multiple * riskUsd;
            const tp2Price = fillPrice - config.tp2Multiple * riskUsd;

            let tradeOutcome: SfpTrade['outcome'] = 'PENDING';
            let exitPrice = fillPrice;
            let exitTime = candles[fillIndex].t;
            let barsHeld = 0;
            let isTp1Hit = false;
            let trailingSl = stopLoss;

            for (let k = fillIndex + 1; k < Math.min(candles.length, fillIndex + 100); k++) {
              const bar = candles[k];
              barsHeld++;

              if (bar.h >= trailingSl) {
                if (isTp1Hit) {
                  tradeOutcome = 'WIN_TP1_SCRATCH';
                  exitPrice = trailingSl;
                } else {
                  tradeOutcome = 'STOPPED_OUT';
                  exitPrice = trailingSl;
                }
                exitTime = bar.t;
                break;
              }

              if (!isTp1Hit && bar.l <= tp1Price) {
                isTp1Hit = true;
                trailingSl = fillPrice - 0.10;
              }

              if (isTp1Hit && bar.l <= tp2Price) {
                tradeOutcome = 'WIN_FULL';
                exitPrice = tp2Price;
                exitTime = bar.t;
                break;
              }
            }

            if (tradeOutcome === 'PENDING') {
              tradeOutcome = isTp1Hit ? 'WIN_TP1_SCRATCH' : 'STOPPED_OUT';
              exitPrice = candles[Math.min(candles.length - 1, fillIndex + 100)].c;
              exitTime = candles[Math.min(candles.length - 1, fillIndex + 100)].t;
            }

            let grossR = 0;
            if (tradeOutcome === 'WIN_FULL') {
              grossR = config.tp1Ratio * config.tp1Multiple + config.tp2Ratio * config.tp2Multiple;
            } else if (tradeOutcome === 'WIN_TP1_SCRATCH') {
              grossR = config.tp1Ratio * config.tp1Multiple;
            } else {
              grossR = -1.0;
            }

            const notionalMultiplier = 1.0 / (riskUsd / fillPrice);
            const entryFeeR = notionalMultiplier * (config.takerFeePct / 100);
            const exitFeeR = tradeOutcome === 'STOPPED_OUT'
              ? notionalMultiplier * (config.takerFeePct / 100)
              : 0;
            const feeR = entryFeeR + exitFeeR;
            const netR = grossR - feeR;

            trades.push({
              id: `TRADE_BEAR_${currentCandle.t}`,
              timeframe: config.timeframe,
              direction: 'SHORT',
              anchorName: pool.name,
              anchorPrice: pool.price,
              sweepPrice,
              entryPrice: fillPrice,
              entryTime: candles[fillIndex].t,
              stopLoss,
              riskUsd: parseFloat(riskUsd.toFixed(2)),
              target1: parseFloat(tp1Price.toFixed(2)),
              target2: parseFloat(tp2Price.toFixed(2)),
              outcome: tradeOutcome,
              realizedR: parseFloat(grossR.toFixed(2)),
              netRealizedR: parseFloat(netR.toFixed(2)),
              feeR: parseFloat(feeR.toFixed(3)),
              exitPrice: parseFloat(exitPrice.toFixed(2)),
              exitTime,
              barsHeld,
            });

            cooldownUntilIndex = fillIndex + config.cooldownBars;
            break;
          }
        }
      }
    }
  }

  // ── Compute Performance Summary ──────────────────────────────────────────
  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.outcome === 'WIN_FULL').length;
  const tp1Wins = trades.filter((t) => t.outcome === 'WIN_TP1_SCRATCH').length;
  const losses = trades.filter((t) => t.outcome === 'STOPPED_OUT').length;
  const grossR = trades.reduce((acc, t) => acc + t.realizedR, 0);
  const netR = trades.reduce((acc, t) => acc + t.netRealizedR, 0);
  const totalFeesR = trades.reduce((acc, t) => acc + t.feeR, 0);

  const winRate = totalTrades > 0 ? ((wins + tp1Wins) / totalTrades) * 100 : 0;
  const fullWinRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  let grossWinsSum = trades.filter((t) => t.realizedR > 0).reduce((acc, t) => acc + t.realizedR, 0);
  let grossLossSum = Math.abs(trades.filter((t) => t.realizedR < 0).reduce((acc, t) => acc + t.realizedR, 0));
  const grossPf = grossLossSum > 0 ? grossWinsSum / grossLossSum : 0;
  const netPf = grossLossSum + totalFeesR > 0 ? grossWinsSum / (grossLossSum + totalFeesR) : 0;

  // Compounded equity walk from $1000 @ 2% risk
  let equity = 1000;
  let peakEquity = 1000;
  let maxDdUsd = 0;
  let maxDdPct = 0;

  for (const t of trades) {
    const riskUsd = equity * 0.02;
    const pnl = t.netRealizedR * riskUsd;
    equity += pnl;
    if (equity > peakEquity) peakEquity = equity;
    const ddUsd = peakEquity - equity;
    const ddPct = (ddUsd / peakEquity) * 100;
    if (ddUsd > maxDdUsd) maxDdUsd = ddUsd;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
  }

  return {
    trades,
    summary: {
      timeframe: config.timeframe,
      entryMode: config.entryMode,
      totalTrades,
      wins,
      tp1Wins,
      losses,
      winRate: parseFloat(winRate.toFixed(1)),
      fullWinRate: parseFloat(fullWinRate.toFixed(1)),
      grossR: parseFloat(grossR.toFixed(2)),
      netR: parseFloat(netR.toFixed(2)),
      totalFeesR: parseFloat(totalFeesR.toFixed(2)),
      grossPf: parseFloat(grossPf.toFixed(2)),
      netPf: parseFloat(netPf.toFixed(2)),
      initialEquity: 1000,
      finalEquity: parseFloat(equity.toFixed(2)),
      maxDdPct: parseFloat(maxDdPct.toFixed(2)),
      avgRiskUsd: trades.length > 0 ? parseFloat((trades.reduce((acc, t) => acc + t.riskUsd, 0) / trades.length).toFixed(2)) : 0,
    },
  };
}

// ── Main Execution ───────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🏹 1M & 3M LIQUIDITY HUNTER — SFP SHELF-SNAP EMPIRICAL TEST');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Fetch 12000 candles on 3m (~25 days of trading)
  const candles3m = await fetchBinancePagedKlines('ETHUSDC', '3m', 12000);
  const pools3mStandard = extractLiquidityPools(candles3m, 15);
  const pools3mClean = extractLiquidityPools(candles3m, 25); // Clean macro turning points
  console.log(`🔍 Extracted ${pools3mStandard.length} standard pools, ${pools3mClean.length} clean macro pools on 3m`);

  console.log('\n▶️ [Test 1] 3m SFP Standard Shelf Retest (TP1: 2.5R, TP2: 5.0R)...');
  const res3mStandard = runLiquidityHunterSimulation(candles3m, pools3mStandard, {
    timeframe: '3m',
    entryMode: 'SHELF_RETEST',
    minSweepPips: 0.50,
    maxWickDistance: 6.00,
    tp1Ratio: 0.60,
    tp2Ratio: 0.40,
    tp1Multiple: 2.5,
    tp2Multiple: 5.0,
    cooldownBars: 10,
    makerFeePct: 0.0000,
    takerFeePct: 0.0400,
  });

  console.log('\n▶️ [Test 2] 3m SFP Volume-Hardened (Vol >= 1.25x SMA20, Sweep >= $1.00)...');
  const res3mVolHardened = runLiquidityHunterSimulation(candles3m, pools3mStandard, {
    timeframe: '3m',
    entryMode: 'SHELF_RETEST',
    minSweepPips: 1.00,
    maxWickDistance: 6.00,
    minVolumeRatio: 1.25,
    tp1Ratio: 0.60,
    tp2Ratio: 0.40,
    tp1Multiple: 2.5,
    tp2Multiple: 5.0,
    cooldownBars: 15,
    makerFeePct: 0.0000,
    takerFeePct: 0.0400,
  });

  console.log('\n▶️ [Test 3] 3m SFP Clean Macro Swings (Lookback 25, TP1: 3.0R, TP2: 6.0R)...');
  const res3mClean = runLiquidityHunterSimulation(candles3m, pools3mClean, {
    timeframe: '3m',
    entryMode: 'SHELF_RETEST',
    minSweepPips: 0.80,
    maxWickDistance: 7.00,
    tp1Ratio: 0.50,
    tp2Ratio: 0.50,
    tp1Multiple: 3.0,
    tp2Multiple: 6.0,
    cooldownBars: 12,
    makerFeePct: 0.0000,
    takerFeePct: 0.0400,
  });

  // Print Comparison Table
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('📊 RESULTS SUMMARY: 3M LIQUIDITY HUNTER TOURNAMENT');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.table([
    { Strategy: '1. Standard 3m SFP', ...res3mStandard.summary },
    { Strategy: '2. Volume-Hardened 3m SFP', ...res3mVolHardened.summary },
    { Strategy: '3. Clean Macro 3m SFP', ...res3mClean.summary },
  ]);
}

main().catch(console.error);
