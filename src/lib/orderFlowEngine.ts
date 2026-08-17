import type {
  OrderFlowState,
  OrderFlowStateRecord,
  OrderFlowTimelineStats,
  OrderFlowTimelineSummary
} from '@/lib/quantEngine/types';

export interface RestingLiquidityPools {
  BSL_Magnets: number[];
  SSL_Magnets: number[];
}

export interface LiquidationEvents {
  last_hour_purged: string;
  status: string;
}

export interface SmartMoneySentiment {
  funding_rate_status: string;
  smart_money_divergence: boolean;
}

export interface OrderFlowEngine {
  open_interest_trend: string;
  displacement_sponsorship: string | any;
  resting_liquidity_pools: RestingLiquidityPools;
  liquidation_events: LiquidationEvents;
  smart_money_sentiment: SmartMoneySentiment;
  state_timeline?: OrderFlowTimelineSummary;
}

export async function fetchRestingLiquidity(symbol: string = 'ETHUSDC'): Promise<RestingLiquidityPools> {
  try {
    const [depthRes, tickerRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=1000`, { signal: AbortSignal.timeout(5000) }),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(5000) })
    ]);

    if (!depthRes.ok) throw new Error(`Failed to fetch depth data for ${symbol}`);
    if (!tickerRes.ok) throw new Error(`Failed to fetch ticker price for ${symbol}`);

    const [depthData, tickerData] = await Promise.all([
      depthRes.json(),
      tickerRes.json()
    ]);

    const livePrice = parseFloat(tickerData.price);
    if (isNaN(livePrice)) throw new Error(`Invalid live price fetched: ${tickerData.price}`);

    const bids = depthData.bids || [];
    const asks = depthData.asks || [];

    // Filter nodes that are at least 0.5% away from current price
    const filteredBids = bids.filter((bid: any) => {
      const price = parseFloat(bid[0]);
      return (livePrice - price) / livePrice >= 0.005;
    });

    const filteredAsks = asks.filter((ask: any) => {
      const price = parseFloat(ask[0]);
      return (price - livePrice) / livePrice >= 0.005;
    });

    const sortedBids = [...filteredBids].sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
    const topBids = sortedBids.slice(0, 3).map(bid => parseFloat(bid[0]));

    const sortedAsks = [...filteredAsks].sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
    const topAsks = sortedAsks.slice(0, 3).map(ask => parseFloat(ask[0]));

    return {
      BSL_Magnets: topAsks,
      SSL_Magnets: topBids,
    };
  } catch (error: any) {
    console.warn(`[orderFlowEngine] Binance depth feed unavailable for ${symbol}. Returning empty magnets to trigger dynamic simulation. Detail: ${error.message || error}`);
    return { BSL_Magnets: [], SSL_Magnets: [] };
  }
}

function calculateSMA(data: number[], period: number): number {
  if (data.length === 0) return 0;
  if (data.length < period) return data.reduce((a, b) => a + b, 0) / data.length;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export async function fetchOIMetricsAndLiquidations(symbol: string = 'ETHUSDC', isPriceRising: boolean = true): Promise<{ open_interest_trend: string, liquidation_events: LiquidationEvents }> {
  try {
    const [oiResult, liqResult] = await Promise.allSettled([
      fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=50`, { signal: AbortSignal.timeout(5000) }),
      fetch(`https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${symbol}&limit=100`, { signal: AbortSignal.timeout(5000) })
    ]);

    let open_interest_trend = 'UNAVAILABLE';
    let liquidation_events: LiquidationEvents = { last_hour_purged: 'UNAVAILABLE', status: 'UNAVAILABLE' };

    // Process OI
    if (oiResult.status === 'fulfilled' && oiResult.value.ok) {
      try {
        const oiData = await oiResult.value.json();
        if (Array.isArray(oiData) && oiData.length >= 14) {
          // sumOpenInterest is base asset quantity (ETH for ETHUSDC)
          const oiValues = oiData.map((d: { sumOpenInterest?: string | number, sumOpenInterestValue?: string | number }) => parseFloat(String(d.sumOpenInterest || d.sumOpenInterestValue))).filter(v => !isNaN(v));
          
          if (oiValues.length >= 14) {
            let currentTrend = 'NEUTRAL';
            const threshold = symbol.toUpperCase().includes('ETH') ? 500 : 50; // Calibrated 500 ETH hysteresis delta threshold
            
            for (let i = 14; i < oiValues.length; i++) {
              const sma = calculateSMA(oiValues.slice(0, i + 1), 14);
              const val = oiValues[i];
              
              if (currentTrend === 'RISING') {
                if (val < sma - threshold) {
                  currentTrend = 'FALLING';
                }
              } else if (currentTrend === 'FALLING') {
                if (val > sma + threshold) {
                  currentTrend = 'RISING';
                }
              } else {
                if (val > sma + threshold) {
                  currentTrend = 'RISING';
                } else if (val < sma - threshold) {
                  currentTrend = 'FALLING';
                }
              }
            }
            
            if ((currentTrend === 'RISING' && isPriceRising) || (currentTrend === 'FALLING' && !isPriceRising)) {
              open_interest_trend = `${currentTrend}_WITH_PRICE`;
            } else if (currentTrend !== 'NEUTRAL') {
              open_interest_trend = `${currentTrend}_AGAINST_PRICE`;
            } else {
              open_interest_trend = 'NEUTRAL';
            }
          }
        } else if (Array.isArray(oiData) && oiData.length >= 2) {
          // Fallback if data length is between 2 and 13
          const prevOI = parseFloat(oiData[oiData.length - 2].sumOpenInterest || oiData[oiData.length - 2].sumOpenInterestValue);
          const currOI = parseFloat(oiData[oiData.length - 1].sumOpenInterest || oiData[oiData.length - 1].sumOpenInterestValue);
          if (!isNaN(prevOI) && !isNaN(currOI)) {
            const trend = currOI > prevOI ? 'RISING' : 'FALLING';
            if ((trend === 'RISING' && isPriceRising) || (trend === 'FALLING' && !isPriceRising)) {
              open_interest_trend = `${trend}_WITH_PRICE`;
            } else {
              open_interest_trend = `${trend}_AGAINST_PRICE`;
            }
          }
        }
      } catch {}
    }

    // Process Liquidations
    if (liqResult.status === 'fulfilled' && liqResult.value.ok) {
      try {
        const data = await liqResult.value.json();
        if (Array.isArray(data)) {
          const oneHourAgo = Date.now() - 60 * 60 * 1000;
          const recentLiqs = data.filter((order: { time: number; executedQty: string; averagePrice: string; side: string }) => order.time > oneHourAgo);

          let totalLongsUsd = 0;
          let totalShortsUsd = 0;

          for (const order of recentLiqs) {
            const volume = parseFloat(order.executedQty) * parseFloat(order.averagePrice);
            if (!isNaN(volume)) {
              if (order.side === 'SELL') totalLongsUsd += volume; // Longs liquidated via Sell
              else if (order.side === 'BUY') totalShortsUsd += volume; // Shorts liquidated via Buy
            }
          }

          const totalPurged = totalLongsUsd + totalShortsUsd;
          const dominantSide = totalLongsUsd >= totalShortsUsd ? 'LONGS' : 'SHORTS';
          const dominantVolume = Math.max(totalLongsUsd, totalShortsUsd);

          let last_hour_purged = 'NO_MAJOR_PURGE';
          if (dominantVolume > 0) {
            if (dominantVolume >= 1_000_000) {
              last_hour_purged = `${(dominantVolume / 1_000_000).toFixed(1)}M_USD_${dominantSide}_PURGED`;
            } else if (dominantVolume >= 1_000) {
              last_hour_purged = `${(dominantVolume / 1_000).toFixed(0)}K_USD_${dominantSide}_PURGED`;
            } else {
              last_hour_purged = `${dominantVolume.toFixed(0)}_USD_${dominantSide}_PURGED`;
            }
          }

          liquidation_events = {
            last_hour_purged,
            status: totalPurged > 1_000_000 ? 'LIQUIDITY_SWEPT' : 'NORMAL'
          };
        }
      } catch {}
    }

    return { open_interest_trend, liquidation_events };
  } catch (error: any) {
    console.warn(`[orderFlowEngine] Binance OI/Liquidations feed unavailable for ${symbol}. Detail: ${error.message || error}`);
    return {
      open_interest_trend: 'UNAVAILABLE',
      liquidation_events: { last_hour_purged: 'UNAVAILABLE', status: 'UNAVAILABLE' }
    };
  }
}

export async function fetchSmartMoneySentiment(symbol: string = 'ETHUSDC'): Promise<SmartMoneySentiment> {
  try {
    const [fundingResult, ratioResult] = await Promise.allSettled([
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { signal: AbortSignal.timeout(5000) }),
      fetch(`https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`, { signal: AbortSignal.timeout(5000) })
    ]);

    let funding_rate_status = 'NEUTRAL';
    let smart_money_divergence = false;

    if (fundingResult.status === 'fulfilled' && fundingResult.value.ok) {
      try {
        const fundingData = await fundingResult.value.json();
        const lastFundingRate = parseFloat(fundingData.lastFundingRate);
        if (!isNaN(lastFundingRate)) {
          if (lastFundingRate > 0.0001) {
            funding_rate_status = 'HIGHLY_POSITIVE_RETAIL_LONG';
          } else if (lastFundingRate < -0.0001) {
            funding_rate_status = 'NEGATIVE_RETAIL_SHORT';
          }
        }
      } catch {}
    }

    if (ratioResult.status === 'fulfilled' && ratioResult.value.ok) {
      try {
        const ratioData = await ratioResult.value.json();
        if (Array.isArray(ratioData) && ratioData.length > 0) {
          const longShortRatio = parseFloat(ratioData[0].longShortRatio);
          if (!isNaN(longShortRatio)) {
            // Divergence is true if top traders oppose retail sentiment
            if (longShortRatio < 1.0 && funding_rate_status === 'HIGHLY_POSITIVE_RETAIL_LONG') {
              smart_money_divergence = true;
            } else if (longShortRatio > 1.0 && funding_rate_status === 'NEGATIVE_RETAIL_SHORT') {
              smart_money_divergence = true;
            }
          }
        }
      } catch {}
    }

    return { funding_rate_status, smart_money_divergence };
  } catch (error: any) {
    console.warn(`[orderFlowEngine] Binance smart money sentiment feed unavailable for ${symbol}. Detail: ${error.message || error}`);
    return {
      funding_rate_status: 'UNAVAILABLE',
      smart_money_divergence: false
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 📈 Order Flow State Machine & Chronological Timeline Engine (V14.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes raw string input into a strongly typed OrderFlowState enum.
 */
export function normalizeOrderFlowState(raw: string | undefined | null): OrderFlowState {
  if (!raw) return 'NEUTRAL';
  const u = raw.toUpperCase().trim();
  if (u.includes('RISING_WITH_PRICE') || u === 'RISING_WITH_PRICE') return 'RISING_WITH_PRICE';
  if (u.includes('RISING_AGAINST_PRICE') || u === 'RISING_AGAINST_PRICE') return 'RISING_AGAINST_PRICE';
  if (u.includes('FALLING_WITH_PRICE') || u === 'FALLING_WITH_PRICE') return 'FALLING_WITH_PRICE';
  if (u.includes('FALLING_AGAINST_PRICE') || u === 'FALLING_AGAINST_PRICE') return 'FALLING_AGAINST_PRICE';
  if (u.includes('FLAT') || u === 'FLAT') return 'FLAT';
  if (u.includes('BULLISH')) return 'RISING_WITH_PRICE';
  if (u.includes('BEARISH')) return 'RISING_AGAINST_PRICE';
  if (u === 'UNAVAILABLE') return 'UNAVAILABLE';
  return 'NEUTRAL';
}

/**
 * Computes aggregated statistics across a history of state transitions.
 */
export function calculateOrderFlowStats(
  history: OrderFlowStateRecord[],
  activeState: OrderFlowStateRecord | null,
  nowMs: number = Date.now()
): OrderFlowTimelineStats {
  let buySec = 0;
  let shortSec = 0;
  let liqSec = 0;
  let covSec = 0;
  let neutSec = 0;
  let totalDur = 0;
  let totalCount = 0;

  const stateDurationMap: Record<OrderFlowState, number> = {
    RISING_WITH_PRICE: 0,
    RISING_AGAINST_PRICE: 0,
    FALLING_WITH_PRICE: 0,
    FALLING_AGAINST_PRICE: 0,
    FLAT: 0,
    NEUTRAL: 0,
    UNAVAILABLE: 0
  };

  const oneDayAgo = nowMs - 24 * 60 * 60 * 1000;

  const validHistory = activeState
    ? history.filter((h) => h.entered_at < activeState.entered_at)
    : history;

  const allRecords: OrderFlowStateRecord[] = [...validHistory];
  if (activeState) {
    const elapsed = Math.max(1, Math.round((nowMs - activeState.entered_at) / 1000));
    allRecords.push({
      ...activeState,
      duration_seconds: elapsed
    });
  }

  for (const rec of allRecords) {
    const dur = rec.duration_seconds || (rec.exited_at ? Math.max(1, Math.round((rec.exited_at - rec.entered_at) / 1000)) : 60);
    totalDur += dur;
    totalCount += 1;

    if (rec.entered_at >= oneDayAgo) {
      stateDurationMap[rec.state] = (stateDurationMap[rec.state] || 0) + dur;
    }

    switch (rec.state) {
      case 'RISING_WITH_PRICE':
        buySec += dur;
        break;
      case 'RISING_AGAINST_PRICE':
        shortSec += dur;
        break;
      case 'FALLING_WITH_PRICE':
        liqSec += dur;
        break;
      case 'FALLING_AGAINST_PRICE':
        covSec += dur;
        break;
      default:
        neutSec += dur;
        break;
    }
  }

  let dominant_state: OrderFlowState = 'NEUTRAL';
  let maxTime = -1;
  for (const [st, timeVal] of Object.entries(stateDurationMap) as [OrderFlowState, number][]) {
    if (timeVal > maxTime && st !== 'NEUTRAL' && st !== 'FLAT' && st !== 'UNAVAILABLE') {
      maxTime = timeVal;
      dominant_state = st;
    }
  }

  return {
    total_transitions: allRecords.length,
    time_in_buy_sponsorship_sec: buySec,
    time_in_short_sponsorship_sec: shortSec,
    time_in_liquidation_sec: liqSec,
    time_in_covering_sec: covSec,
    time_in_neutral_sec: neutSec,
    dominant_state_last_24h: dominant_state,
    avg_state_duration_sec: totalCount > 0 ? Math.round(totalDur / totalCount) : 0,
  };
}

/**
 * Pure deterministic chronological timeline generator from an array of candles.
 * Used for Backtest Replay iterations and bootstrapping live historical state memory.
 */
export function computeTimelineFromCandles(
  candles: Array<{
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v?: number;
    taker_buy_vol?: number;
    taker_sell_vol?: number;
  }>,
  symbol: string = 'ETHUSDC'
): OrderFlowTimelineSummary {
  if (!candles || candles.length === 0) {
    const emptyStats: OrderFlowTimelineStats = {
      total_transitions: 0,
      time_in_buy_sponsorship_sec: 0,
      time_in_short_sponsorship_sec: 0,
      time_in_liquidation_sec: 0,
      time_in_covering_sec: 0,
      time_in_neutral_sec: 0,
      dominant_state_last_24h: 'NEUTRAL',
      avg_state_duration_sec: 0
    };
    return { active_state: null, history: [], stats: emptyStats };
  }

  // Calculate rolling volume SMA
  const rollingVols: number[] = [];
  const candleStates: {
    candle: (typeof candles)[0];
    state: OrderFlowState;
    buyRatio: number;
    volDelta: number;
  }[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const vol = c.v ?? 0;
    rollingVols.push(vol);
    const avgVol = calculateSMA(rollingVols.slice(Math.max(0, i - 14), i + 1), 14);

    const isPriceRising = c.c >= c.o;
    const takerBuy = c.taker_buy_vol ?? (vol * (isPriceRising ? 0.6 : 0.4));
    const takerSell = c.taker_sell_vol ?? (vol - takerBuy);
    const totalTaker = takerBuy + takerSell;
    const buyRatio = totalTaker > 0 ? takerBuy / totalTaker : 0.5;
    const volDelta = takerBuy - takerSell;

    const isHighVolume = avgVol > 0 ? vol >= avgVol * 0.95 : true;

    let state: OrderFlowState = 'NEUTRAL';

    if (isHighVolume) {
      if (isPriceRising && buyRatio >= 0.505) {
        // Aggressive buying driving price up
        state = 'RISING_WITH_PRICE';
      } else if (!isPriceRising && buyRatio <= 0.495) {
        // Aggressive selling driving price down
        state = 'RISING_AGAINST_PRICE';
      } else if (!isPriceRising && buyRatio > 0.505) {
        // Price falling despite taker buying -> Long Liquidation / Absorption
        state = 'FALLING_WITH_PRICE';
      } else if (isPriceRising && buyRatio < 0.495) {
        // Price rising despite taker selling -> Short Covering / Squeeze
        state = 'FALLING_AGAINST_PRICE';
      } else {
        state = 'FLAT';
      }
    } else {
      state = isPriceRising ? 'FLAT' : 'NEUTRAL';
    }

    candleStates.push({ candle: c, state, buyRatio, volDelta });
  }

  // Group contiguous candle states into timeline records
  const history: OrderFlowStateRecord[] = [];
  let currentGroup: {
    state: OrderFlowState;
    startCandle: (typeof candles)[0];
    lastCandle: (typeof candles)[0];
    count: number;
    totalVolDelta: number;
    buyRatioSum: number;
  } | null = null;

  for (let i = 0; i < candleStates.length; i++) {
    const cs = candleStates[i];
    if (!currentGroup) {
      currentGroup = {
        state: cs.state,
        startCandle: cs.candle,
        lastCandle: cs.candle,
        count: 1,
        totalVolDelta: cs.volDelta,
        buyRatioSum: cs.buyRatio,
      };
    } else if (currentGroup.state === cs.state) {
      currentGroup.lastCandle = cs.candle;
      currentGroup.count += 1;
      currentGroup.totalVolDelta += cs.volDelta;
      currentGroup.buyRatioSum += cs.buyRatio;
    } else {
      // Close previous group
      const entered_at = currentGroup.startCandle.t;
      // Approximate exit timestamp from next candle open or candle end
      const exited_at = cs.candle.t;
      const entry_price = currentGroup.startCandle.o;
      const exit_price = currentGroup.lastCandle.c;
      const duration_seconds = Math.max(1, Math.round((exited_at - entered_at) / 1000));
      const price_change = parseFloat((exit_price - entry_price).toFixed(2));
      const price_change_pct = parseFloat((((exit_price - entry_price) / entry_price) * 100).toFixed(3));

      history.push({
        id: `bt-${entered_at}`,
        symbol,
        state: currentGroup.state,
        entered_at,
        entry_price,
        exited_at,
        exit_price,
        duration_seconds,
        price_change,
        price_change_pct,
        metadata: {
          candle_count: currentGroup.count,
          volume_delta: parseFloat(currentGroup.totalVolDelta.toFixed(2)),
          taker_buy_ratio: parseFloat((currentGroup.buyRatioSum / currentGroup.count).toFixed(3)),
        }
      });

      // Start new group
      currentGroup = {
        state: cs.state,
        startCandle: cs.candle,
        lastCandle: cs.candle,
        count: 1,
        totalVolDelta: cs.volDelta,
        buyRatioSum: cs.buyRatio,
      };
    }
  }

  let active_state: OrderFlowStateRecord | null = null;

  if (currentGroup) {
    const entered_at = currentGroup.startCandle.t;
    const entry_price = currentGroup.startCandle.o;
    const currentPrice = currentGroup.lastCandle.c;
    const nowMs = candles[candles.length - 1].t;
    const duration_seconds = Math.max(1, Math.round((nowMs - entered_at) / 1000));
    const price_change = parseFloat((currentPrice - entry_price).toFixed(2));
    const price_change_pct = parseFloat((((currentPrice - entry_price) / entry_price) * 100).toFixed(3));

    active_state = {
      id: `active-${entered_at}`,
      symbol,
      state: currentGroup.state,
      entered_at,
      entry_price,
      exited_at: null,
      exit_price: null,
      duration_seconds,
      price_change,
      price_change_pct,
      metadata: {
        candle_count: currentGroup.count,
        volume_delta: parseFloat(currentGroup.totalVolDelta.toFixed(2)),
        taker_buy_ratio: parseFloat((currentGroup.buyRatioSum / currentGroup.count).toFixed(3)),
        is_live: true,
      }
    };
  }

  const stats = calculateOrderFlowStats(history, active_state, candles[candles.length - 1].t);

  return {
    active_state,
    history,
    stats,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 🏛️ Stateful In-Memory & Database Persistent Tracker Singleton (Live Streaming)
// ─────────────────────────────────────────────────────────────────────────────

interface SymbolTrackerMemory {
  active_state: OrderFlowStateRecord | null;
  history: OrderFlowStateRecord[];
  isBootstrapped: boolean;
}

class OrderFlowStateTrackerClass {
  private trackerMap = new Map<string, SymbolTrackerMemory>();

  private getMemory(symbol: string): SymbolTrackerMemory {
    const key = symbol.toUpperCase();
    if (!this.trackerMap.has(key)) {
      this.trackerMap.set(key, {
        active_state: null,
        history: [],
        isBootstrapped: false,
      });
    }
    return this.trackerMap.get(key)!;
  }

  /**
   * Bootstraps historical timeline state deterministically from candles
   * and guarantees perfect stability and parity across server instances.
   */
  public bootstrapFromCandles(symbol: string, candles: Array<any>) {
    const mem = this.getMemory(symbol);
    if (!candles || candles.length === 0) return;

    // Pure deterministic reconstruction from closed candles
    const summary = computeTimelineFromCandles(candles, symbol);
    
    // Always sync historical segments to immutable closed-candle ground truth
    mem.history = summary.history.slice(-100);
    if (!mem.active_state) {
      mem.active_state = summary.active_state;
    }
    mem.isBootstrapped = true;
  }

  /**
   * Evaluates live ticks/polls and maintains active state without generating 5s sub-tick flutter.
   * Gated strictly on confirmed candle closes / new candle arrivals for history push.
   */
  public updateLiveState(
    symbol: string,
    rawState: string,
    timestamp: number,
    livePrice: number,
    metadata?: Record<string, any>,
    currentCandleTimestamp?: number
  ): OrderFlowTimelineSummary {
    const mem = this.getMemory(symbol);
    const normalizedState = normalizeOrderFlowState(rawState);

    const candleStart = currentCandleTimestamp || timestamp;

    // Initial state setup if empty
    if (!mem.active_state) {
      mem.active_state = {
        id: `live-${candleStart}`,
        symbol,
        state: normalizedState,
        entered_at: candleStart,
        entry_price: livePrice,
        exited_at: null,
        exit_price: null,
        duration_seconds: 0,
        price_change: 0,
        price_change_pct: 0,
        metadata: { ...metadata, is_live: true }
      };
      const stats = calculateOrderFlowStats(mem.history, mem.active_state, timestamp);
      return {
        active_state: mem.active_state,
        history: mem.history.slice(-100),
        stats
      };
    }

    const isNewCandleBoundary = currentCandleTimestamp ? (currentCandleTimestamp > mem.active_state.entered_at) : false;

    // Check for State Transition at confirmed candle boundary
    if (isNewCandleBoundary && mem.active_state.state !== normalizedState) {
      // 1. Close previous record upon confirmed candle close
      const previous = mem.active_state;
      const exited_at = candleStart;
      const exit_price = livePrice;
      const duration_seconds = Math.max(1, Math.round((exited_at - previous.entered_at) / 1000));
      const price_change = parseFloat((exit_price - previous.entry_price).toFixed(2));
      const price_change_pct = parseFloat((((exit_price - previous.entry_price) / previous.entry_price) * 100).toFixed(3));

      const closedRecord: OrderFlowStateRecord = {
        ...previous,
        exited_at,
        exit_price,
        duration_seconds,
        price_change,
        price_change_pct,
      };

      // Push to in-memory history ring buffer
      mem.history.push(closedRecord);
      if (mem.history.length > 200) {
        mem.history.shift();
      }

      // Asynchronously persist to Neon PostgreSQL
      persistStateTransitionToDb(closedRecord).catch((err) => {
        console.warn(`[OrderFlowTracker] Failed to persist state transition to DB: ${err.message || err}`);
      });

      // 2. Create new active state record for the new candle
      mem.active_state = {
        id: `live-${candleStart}`,
        symbol,
        state: normalizedState,
        entered_at: candleStart,
        entry_price: livePrice,
        exited_at: null,
        exit_price: null,
        duration_seconds: 0,
        price_change: 0,
        price_change_pct: 0,
        metadata: { ...metadata, is_live: true }
      };
    } else {
      // Intra-candle live tick: update active state regime & live metrics without polluting history array
      if (!isNewCandleBoundary && mem.active_state.state !== normalizedState) {
        // Update active regime on live open candle without committing prematurely to closed history
        mem.active_state.state = normalizedState;
      }

      const duration_seconds = Math.max(0, Math.round((timestamp - mem.active_state.entered_at) / 1000));
      const price_change = parseFloat((livePrice - mem.active_state.entry_price).toFixed(2));
      const price_change_pct = parseFloat((((livePrice - mem.active_state.entry_price) / mem.active_state.entry_price) * 100).toFixed(3));

      mem.active_state = {
        ...mem.active_state,
        duration_seconds,
        exit_price: livePrice,
        price_change,
        price_change_pct,
      };
    }

    const stats = calculateOrderFlowStats(mem.history, mem.active_state, timestamp);
    return {
      active_state: mem.active_state,
      history: mem.history.slice(-100),
      stats
    };
  }

  /**
   * Retrieves the current timeline snapshot.
   */
  public getTimelineSummary(symbol: string): OrderFlowTimelineSummary {
    const mem = this.getMemory(symbol);
    const now = Date.now();
    const stats = calculateOrderFlowStats(mem.history, mem.active_state, now);
    return {
      active_state: mem.active_state,
      history: mem.history.slice(-100),
      stats
    };
  }

  /**
   * Directly injects historical records into memory cache (e.g. from DB load).
   */
  public setHistory(symbol: string, records: OrderFlowStateRecord[]) {
    const mem = this.getMemory(symbol);
    mem.history = records;
    mem.isBootstrapped = true;
  }
}

export const OrderFlowStateTracker = new OrderFlowStateTrackerClass();

/**
 * Asynchronously logs closed state transitions to database.
 */
async function persistStateTransitionToDb(record: OrderFlowStateRecord): Promise<void> {
  try {
    const { sql } = await import('@vercel/postgres');
    await sql`
      INSERT INTO order_flow_states_log (
        symbol,
        state,
        entered_at,
        entry_price,
        exited_at,
        exit_price,
        duration_seconds,
        price_change,
        price_change_pct,
        metadata
      ) VALUES (
        ${record.symbol},
        ${record.state},
        ${record.entered_at},
        ${record.entry_price},
        ${record.exited_at},
        ${record.exit_price},
        ${record.duration_seconds},
        ${record.price_change},
        ${record.price_change_pct},
        ${JSON.stringify(record.metadata || {})}
      )
    `;
  } catch (error: any) {
    // Database offline or serverless cold start - silently ignore as deterministic candle truth holds state
  }
}

