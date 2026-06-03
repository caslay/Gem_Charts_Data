/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { detectActiveFVGs, mapAndConsolidateFVGs } from './fvgEngine';
import { verifyDisplacementOffline } from './displacementEngine';
import { generateTradeExecutionParameters } from './riskEngine';
import { analyzeMarketStructure } from './structureEngine';

export interface ServerBtCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  taker_buy_vol: number;
  taker_sell_vol: number;
}

export interface ServerMasterArrays {
  candles_1h: ServerBtCandle[];
  candles_15m: ServerBtCandle[];
  candles_5m: ServerBtCandle[];
}

export function buildServerEnrichedPayload(
  visible: ServerMasterArrays,
  selectedDate: string,
  timeframe: '5m' | '15m' | '1h',
  symbol: string
): Record<string, any> {
  const { candles_1h, candles_15m, candles_5m } = visible;

  const activeCandles = timeframe === '1h'
    ? candles_1h
    : timeframe === '15m'
      ? candles_15m
      : candles_5m;

  const liveCandle = activeCandles[activeCandles.length - 1] ?? null;
  const livePrice = liveCandle?.c ?? null;
  const lastDateUtc = liveCandle ? new Date(liveCandle.t) : null;

  // ── True Day Open (00:00 UTC Anchor) ──
  let trueDayOpen0700: number | null = null;
  for (let i = candles_15m.length - 1; i >= 0; i--) {
    const d = new Date(candles_15m[i].t);
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
      trueDayOpen0700 = candles_15m[i].o;
      break;
    }
  }

  // ── Previous Day H/L from 1h candles ──
  let pdh = 0;
  let pdl = Infinity;
  if (lastDateUtc) {
    const previousDayDateUtc = new Date(Date.UTC(lastDateUtc.getUTCFullYear(), lastDateUtc.getUTCMonth(), lastDateUtc.getUTCDate() - 1));
    const prevYear = previousDayDateUtc.getUTCFullYear();
    const prevMonth = previousDayDateUtc.getUTCMonth();
    const prevDate = previousDayDateUtc.getUTCDate();

    candles_1h.forEach((c) => {
      const dUtc = new Date(c.t);
      if (dUtc.getUTCFullYear() === prevYear && dUtc.getUTCMonth() === prevMonth && dUtc.getUTCDate() === prevDate) {
        if (c.h > pdh) pdh = c.h;
        if (c.l < pdl) pdl = c.l;
      }
    });
  }
  if (pdl === Infinity) pdl = 0;

  // ── Current price & premium/discount status ──
  let currentPricing = 'UNKNOWN';
  if (trueDayOpen0700 !== null && livePrice !== null) {
    if (livePrice > trueDayOpen0700) currentPricing = 'PREMIUM';
    else if (livePrice < trueDayOpen0700) currentPricing = 'DISCOUNT';
    else currentPricing = 'FAIR_VALUE';
  }

  // ── Active FVGs ──
  const candles_1h_with_closed = candles_1h.map((c, idx) => ({ ...c, isClosed: idx < candles_1h.length - 1 }));
  const candles_15m_with_closed = candles_15m.map((c, idx) => ({ ...c, isClosed: idx < candles_15m.length - 1 }));
  const candles_5m_with_closed = candles_5m.map((c, idx) => ({ ...c, isClosed: idx < candles_5m.length - 1 }));
  
  const fvgs1h = detectActiveFVGs(candles_1h_with_closed, true);
  const fvgs15m = detectActiveFVGs(candles_15m_with_closed, true);
  const fvgs5m = detectActiveFVGs(candles_5m_with_closed, true);

  const activeFVGs = mapAndConsolidateFVGs([
    { fvgs: fvgs5m, timeframe: '5m' },
    { fvgs: fvgs15m, timeframe: '15m' },
    { fvgs: fvgs1h, timeframe: '1h' },
  ]);

  // ── Session Ranges ──
  const getSessionLiquidityUTC = (candles: ServerBtCandle[], startHourUTC: number, endHourUTC: number) => {
    if (!lastDateUtc) return { high: null, low: null };

    const sessionCandles = candles.filter(c => {
      const d = new Date(c.t);
      return d.getUTCFullYear() === lastDateUtc.getUTCFullYear() &&
        d.getUTCMonth() === lastDateUtc.getUTCMonth() &&
        d.getUTCDate() === lastDateUtc.getUTCDate() &&
        d.getUTCHours() >= startHourUTC &&
        d.getUTCHours() < endHourUTC;
    });

    if (sessionCandles.length === 0) return { high: null, low: null };

    return {
      high: parseFloat(Math.max(...sessionCandles.map(c => c.h)).toFixed(2)),
      low: parseFloat(Math.min(...sessionCandles.map(c => c.l)).toFixed(2))
    };
  };

  const asianLiquidity = getSessionLiquidityUTC(candles_15m, 0, 7);
  const londonLiquidity = getSessionLiquidityUTC(candles_15m, 7, 12);

  // ── Target Sweeps and DOL Status ──
  let target_status = "PENDING";
  const todayCandles = lastDateUtc
    ? candles_15m.filter(c => {
      const d = new Date(c.t);
      return d.getUTCFullYear() === lastDateUtc.getUTCFullYear() &&
        d.getUTCMonth() === lastDateUtc.getUTCMonth() &&
        d.getUTCDate() === lastDateUtc.getUTCDate();
    })
    : [];

  const sweeps: string[] = [];

  for (const c of todayCandles) {
    if (c.h >= pdh || c.l <= pdl) {
      sweeps.push("EXHAUSTED");
    }
  }

  const afterAsianCandles = todayCandles.filter(c => new Date(c.t).getUTCHours() >= 7);
  for (const c of afterAsianCandles) {
    if (asianLiquidity.high && c.h >= asianLiquidity.high && c.h < pdh) {
      sweeps.push("ASIAN_HIGH_SWEPT");
    }
    if (asianLiquidity.low && c.l <= asianLiquidity.low && c.l > pdl) {
      sweeps.push("ASIAN_LOW_SWEPT");
    }
  }

  const afterLondonCandles = todayCandles.filter(c => new Date(c.t).getUTCHours() >= 12);
  for (const c of afterLondonCandles) {
    if (londonLiquidity.high && c.h >= londonLiquidity.high && c.h < pdh) {
      sweeps.push("LONDON_HIGH_SWEPT");
    }
    if (londonLiquidity.low && c.l <= londonLiquidity.low && c.l > pdl) {
      sweeps.push("LONDON_LOW_SWEPT");
    }
  }

  if (sweeps.includes("EXHAUSTED")) {
    target_status = "EXHAUSTED";
  } else if (sweeps.length > 0) {
    const uniqueSweeps = Array.from(new Set(sweeps));
    target_status = uniqueSweeps.join(" | ") + " / PDH_PDL_PENDING";
  }

  // ── Offline Sponsorship and Risk ──
  const displacement = verifyDisplacementOffline(activeCandles, symbol);
  const displacementSponsorship = displacement.status !== 'INACTIVE' && displacement.status !== 'CONSOLIDATION'
    ? 'ACTIVE'
    : 'INACTIVE';

  const openInterestTrend = displacement.status !== 'INACTIVE' && displacement.status !== 'CONSOLIDATION'
    ? 'RISING'
    : 'FLAT';

  // ── Centralized Structure Analysis ──
  const activeCandlesWithClosed = activeCandles.map((c, idx) => ({
    ...c,
    isClosed: idx < activeCandles.length - 1
  }));
  const structureCandles = activeCandlesWithClosed.slice(-350);

  const structureAnalysis = (livePrice !== null)
    ? analyzeMarketStructure(structureCandles, livePrice, displacement)
    : null;
  const localDealingRange = structureAnalysis
    ? structureAnalysis.dealingRange
    : { high: null, low: null, equilibrium: null, current_status: 'UNKNOWN' };

  // Current session window
  const current_time_window = liveCandle ? (() => {
    const utcDate = new Date(liveCandle.t);
    const nyTimeStr = utcDate.toLocaleString("en-US", { timeZone: "America/New_York" });
    const nyDate = new Date(nyTimeStr);
    const nyHour = nyDate.getHours();
    const nyMin = nyDate.getMinutes();
    if (nyHour === 12 || (nyHour === 13 && nyMin <= 30)) {
      return "DEAD_ZONE";
    }

    const hour = utcDate.getUTCHours();
    if (hour >= 0 && hour <= 3) return "ASIAN_RANGE";
    if (hour >= 6 && hour <= 8) return "LONDON_AM_KILLZONE";
    if (hour >= 12 && hour <= 14) return "NY_AM_KILLZONE";
    if (hour >= 17 && hour <= 18) return "NY_PM_KILLZONE";
    return "DEAD_ZONE";
  })() : "DEAD_ZONE";

  const trade_execution_parameters = generateTradeExecutionParameters(
    target_status,
    current_time_window,
    displacement,
    livePrice ?? 0,
    activeFVGs,
    {
      BSL_Magnets: pdh > 0 ? [pdh] : [],
      SSL_Magnets: pdl > 0 ? [pdl] : [],
    },
    activeCandles
  );

  return {
    ticker: `${symbol}.backtest`,
    timezone: 'UTC',
    replay_date: selectedDate,
    ipda_metrics: {
      note: 'Headless backtest - server-side computed.',
      true_day_open: trueDayOpen0700,
      true_day_open_0700: trueDayOpen0700,
      current_time_window,
      current_pricing: currentPricing,
      target_status,
      market_structure_shift: structureAnalysis?.market_structure_shift ?? false,
      market_structure_shift_direction: structureAnalysis?.market_structure_shift_direction ?? null,
      current_trend: structureAnalysis?.currentTrend ?? 'UNSET',
      internal_market_trend: structureAnalysis?.internalTrend || 'UNSET',
      internal_structure_shift: structureAnalysis?.internal_market_structure_shift === true,
      internal_context: {
        trend: structureAnalysis?.internalTrend || 'UNSET',
        high: structureAnalysis?.internalDealingRange?.high || 0,
        low: structureAnalysis?.internalDealingRange?.low || 0,
        equilibrium: structureAnalysis?.internalDealingRange?.equilibrium || 0,
        pricing_status: structureAnalysis?.internalDealingRange?.current_status || 'UNKNOWN',
        anchor_high_swing: structureAnalysis?.internalDealingRange?.anchor_high_swing || null,
        anchor_low_swing: structureAnalysis?.internalDealingRange?.anchor_low_swing || null
      },
      expansion_mode: structureAnalysis?.expansion_mode ?? 'NORMAL',
      market_velocity: structureAnalysis?.market_velocity ?? 0,
      runaway_origin_price: structureAnalysis?.runaway_origin_price ?? null,
      full_structure_map: structureAnalysis ? {
        swing_points: structureAnalysis.swing_points,
        structural_events: structureAnalysis.structural_events,
        swings: structureAnalysis.swings,
        zigzag: structureAnalysis.zigzag,
        innerSwings: structureAnalysis.innerSwings || [],
        innerZigzag: structureAnalysis.innerZigzag || [],
        currentTrend: structureAnalysis.currentTrend,
        subTrend: structureAnalysis.subTrend || 'UNSET',
        dealingRange: structureAnalysis.dealingRange,
        internalTrend: structureAnalysis.internalTrend || 'UNSET',
        internalZigzag: structureAnalysis.internalZigzag || [],
        latestInternalMSS: structureAnalysis.latestInternalMSS || null,
        internal_market_structure_shift: structureAnalysis.internal_market_structure_shift === true,
        internalDealingRange: structureAnalysis.internalDealingRange,
        latestMSS: structureAnalysis.latestMSS || null,
        market_structure_shift: structureAnalysis.market_structure_shift || false,
        market_structure_shift_direction: structureAnalysis.market_structure_shift_direction || null
      } : null,
      active_fvgs: activeFVGs,
      macro_levels: {
        pdh,
        pdl,
        asian_high: asianLiquidity.high,
        asian_low: asianLiquidity.low,
        true_day_open: trueDayOpen0700
      },
      session_ranges: {
        asian_range: asianLiquidity,
        london_range: londonLiquidity
      },
      pricing_context: {
        vs_daily_open:
          trueDayOpen0700 !== null && livePrice !== null
            ? livePrice > trueDayOpen0700 ? 'ABOVE_OPEN' : 'BELOW_OPEN'
            : 'UNKNOWN',
        local_dealing_range: localDealingRange,
      },
      order_flow_engine: {
        open_interest_trend: openInterestTrend,
        displacement_sponsorship: displacementSponsorship,
        smart_money_sentiment: { smart_money_divergence: false },
        resting_liquidity_pools: {
          BSL_Magnets: pdh > 0 ? [pdh] : [],
          SSL_Magnets: pdl > 0 ? [pdl] : [],
        },
      },
      institutional_sponsorship: displacement,
      trade_execution_parameters,
    },
    active_arrays: {
      fvgs: activeFVGs,
    },
    data_payload: {
      candles_1h,
      candles_15m,
      candles_5m,
    },
  };
}

// ─── Metric Condition Evaluation Engine (Strict Parity) ───

function resolveServerMetric(
  strategy: any,
  condition: any,
  data: Record<string, any>,
  livePrice: number
): boolean | string | number {
  const ipda = data.ipda_metrics || {};
  const orderFlow = ipda.order_flow_engine || {};
  const metric = condition.metric;

  switch (metric) {
    case 'AI_DAILY_BIAS':
      return 'NEUTRAL'; // Server-side default neutral for headless backtest

    case 'FVG': {
      let fvgs = ipda.active_fvgs || [];
      if (!Array.isArray(fvgs)) return false;
      if (condition.timeframe && condition.timeframe !== 'ANY') {
        fvgs = fvgs.filter((f: any) => f.timeframe === condition.timeframe);
      }
      if (condition.direction && condition.direction !== 'ANY') {
        fvgs = fvgs.filter((f: any) => f.type === condition.direction);
      }
      return fvgs.length > 0;
    }

    case 'PRICE_IN_FVG': {
      let fvgs = ipda.active_fvgs || [];
      if (livePrice === 0 || !Array.isArray(fvgs) || fvgs.length === 0) return false;
      if (condition.timeframe && condition.timeframe !== 'ANY') {
        fvgs = fvgs.filter((f: any) => f.timeframe === condition.timeframe);
      }
      if (condition.direction && condition.direction !== 'ANY') {
        fvgs = fvgs.filter((f: any) => f.type === condition.direction);
      }
      return fvgs.some((fvg: any) => {
        const minVal = Math.min(fvg.top, fvg.bottom);
        const maxVal = Math.max(fvg.top, fvg.bottom);
        return livePrice >= minVal && livePrice <= maxVal;
      });
    }

    case 'DISPLACEMENT': {
      const sponsorshipObj = ipda.institutional_sponsorship || {};
      const status = sponsorshipObj.status || orderFlow.displacement_sponsorship || 'INACTIVE';
      const direction = sponsorshipObj.direction || (status.includes('BULLISH') ? 'BULLISH' : status.includes('BEARISH') ? 'BEARISH' : 'NONE');

      const isBullishActive = status === 'ACTIVE_BULLISH' || (status === 'ACTIVE' && direction === 'BULLISH');
      const isBearishActive = status === 'ACTIVE_BEARISH' || (status === 'ACTIVE' && direction === 'BEARISH');
      const userValue = condition.value;

      if (userValue === 'ACTIVE_BULLISH') return isBullishActive ? 'ACTIVE_BULLISH' : 'INACTIVE';
      if (userValue === 'ACTIVE_BEARISH') return isBearishActive ? 'ACTIVE_BEARISH' : 'INACTIVE';
      
      const isAnyActive = isBullishActive || isBearishActive || status === 'ACTIVE';
      return isAnyActive ? 'ANY' : 'INACTIVE';
    }

    case 'DISPLACEMENT_VALUE': {
      const sponsorship = ipda.institutional_sponsorship || {};
      return typeof sponsorship.anomaly_multiplier === 'number' ? sponsorship.anomaly_multiplier : 0;
    }

    case 'OI_TREND': {
      const trend = orderFlow.open_interest_trend;
      if (trend === 'RISING' || trend === 'FALLING' || trend === 'FLAT') return trend;
      return 'FLAT';
    }

    case 'MSS': {
      const condDir = condition.direction || 'ANY';
      const condConf = condition.confirmation || 'CONFIRMED';
      const zigzag = ipda.full_structure_map?.zigzag || [];
      const mssSegments = zigzag.filter((z: any) => z.label === 'MSS');
      const latestMssSegment = mssSegments[mssSegments.length - 1] || null;

      if (!latestMssSegment) {
        const mssActive = ipda.market_structure_shift === true;
        const mssDir = ipda.market_structure_shift_direction;
        const isDirMatch = condDir === 'ANY' || mssDir === condDir;
        if (condConf === 'UNCONFIRMED') return false;
        return mssActive && isDirMatch;
      }

      let isConfMatch = false;
      if (condConf === 'CONFIRMED') {
        isConfMatch = latestMssSegment.displacementConfirmed === true;
      } else if (condConf === 'UNCONFIRMED') {
        isConfMatch = latestMssSegment.displacementConfirmed === false;
      } else {
        isConfMatch = true;
      }

      const mssDir = latestMssSegment.trendAfter || ipda.market_structure_shift_direction;
      const isDirMatch = condDir === 'ANY' || mssDir === condDir;
      return isConfMatch && isDirMatch;
    }

    case 'SMT': {
      const smartMoney = orderFlow.smart_money_sentiment || {};
      return smartMoney.smart_money_divergence === true;
    }

    case 'SMT_DIVERGENCE': {
      const smt = ipda.smt_context || {};
      const tf = condition.timeframe || 'ANY';
      const dir = condition.direction || 'ANY';

      const isDivergenceMatch = (divergenceVal: string) => {
        if (!divergenceVal || divergenceVal === 'NONE') return false;
        if (dir === 'ANY') return true;
        if (dir === 'BULLISH' && divergenceVal === 'BULLISH_CONFIRMED') return true;
        if (dir === 'BEARISH' && divergenceVal === 'BEARISH_CONFIRMED') return true;
        return false;
      };

      if (tf === '1m' || tf === '5m') return isDivergenceMatch(smt.m5_divergence);
      if (tf === '15m' || tf === '30m' || tf === '1h' || tf === '4h') return isDivergenceMatch(smt.m15_divergence);
      return isDivergenceMatch(smt.m5_divergence) || isDivergenceMatch(smt.m15_divergence);
    }

    case 'PRICE_VS_OPEN': {
      const trueDayOpen = ipda.true_day_open_0700 || 0;
      if (trueDayOpen === 0 || livePrice === 0) return 'ABOVE';
      return livePrice > trueDayOpen ? 'ABOVE' : 'BELOW';
    }

    case 'EQUILIBRIUM_STATUS': {
      const isObj = !Array.isArray(strategy.conditions);
      const momentumOverride = isObj ? !!strategy.conditions.momentum_override : false;
      const expansionMode = ipda.expansion_mode || 'NORMAL';
      
      if (momentumOverride && expansionMode === 'RUNAWAY') {
        const stratDirection = isObj ? (strategy.conditions.direction || 'LONG') : 'LONG';
        return stratDirection === 'LONG' ? 'DISCOUNT' : 'PREMIUM';
      }

      if (ipda.global_anchors) {
        return ipda.global_anchors.current_status || 'UNKNOWN';
      }

      const pricing = ipda.pricing_context || {};
      const range = pricing.local_dealing_range || {};
      return range.current_status || 'UNKNOWN';
    }

    case 'TARGET_EXHAUSTION':
      return ipda.target_status || 'PENDING';

    case 'NEARBY_MAGNET': {
      const liquidity = orderFlow.resting_liquidity_pools || {};
      const bsl = liquidity.BSL_Magnets || [];
      const ssl = liquidity.SSL_Magnets || [];
      const allMagnets = [...bsl, ...ssl];
      if (livePrice === 0 || allMagnets.length === 0) return false;
      return allMagnets.some((magnetPrice: number) => Math.abs(livePrice - magnetPrice) <= 2.00);
    }

    case 'MARKET_TREND':
      return ipda.global_anchors?.current_trend || ipda.current_trend || 'UNSET';

    case 'SUB_TREND':
      return ipda.global_anchors?.sub_trend || ipda.full_structure_map?.subTrend || 'UNSET';

    case 'INTERNAL_TREND':
      return ipda.internal_context?.trend || ipda.internal_market_trend || 'UNSET';

    case 'INTERNAL_MSS':
      return ipda.internal_context?.market_structure_shift === true || ipda.internal_structure_shift === true;

    case 'INTERNAL_PRICING': {
      const internalRange = ipda.internal_context || ipda.full_structure_map?.internalDealingRange || {};
      return internalRange.pricing_status || internalRange.current_status || 'UNKNOWN';
    }

    case 'LOCAL_PRICING': {
      const isObj = !Array.isArray(strategy.conditions);
      const momentumOverride = isObj ? !!strategy.conditions.momentum_override : false;
      const expansionMode = ipda.expansion_mode || 'NORMAL';
      
      if (momentumOverride && expansionMode === 'RUNAWAY') {
        const stratDirection = isObj ? (strategy.conditions.direction || 'LONG') : 'LONG';
        return stratDirection === 'LONG' ? 'DISCOUNT' : 'PREMIUM';
      }

      const internalRange = ipda.internal_context || ipda.full_structure_map?.internalDealingRange || {};
      return internalRange.pricing_status || internalRange.current_status || 'UNKNOWN';
    }

    case 'MSS_CONFIRMED':
      return ipda.market_structure_shift === true;

    case 'BOS': {
      const zigzag = ipda.full_structure_map?.zigzag || [];
      if (!Array.isArray(zigzag) || zigzag.length === 0) return false;
      const latestSegment = zigzag[zigzag.length - 1];
      const isBOSActive = latestSegment?.label === 'BOS';

      const condDir = condition.direction;
      if (condDir === 'BULLISH') return isBOSActive && latestSegment?.trendAfter === 'BULLISH';
      if (condDir === 'BEARISH') return isBOSActive && latestSegment?.trendAfter === 'BEARISH';
      return isBOSActive;
    }

    case 'PRICE_IN_OTE': {
      const isObj = !Array.isArray(strategy.conditions);
      const momentumOverride = isObj ? !!strategy.conditions.momentum_override : false;
      const expansionMode = ipda.expansion_mode || 'NORMAL';
      
      if (momentumOverride && expansionMode === 'RUNAWAY') {
        return true; // Bypass Equilibrium retracement gate
      }

      const range = ipda.global_anchors || ipda.full_structure_map?.dealingRange || {};
      const high = range.high || 0;
      const low = range.low || 0;
      if (high === 0 || low === 0 || livePrice === 0) return false;

      const trend = ipda.global_anchors?.current_trend || ipda.current_trend || 'UNSET';
      const zone = condition.retracement || 'OTE';
      
      if (trend === 'BULLISH') {
        if (zone === 'OTE') {
          const minOte = high - 0.79 * (high - low);
          const maxOte = high - 0.62 * (high - low);
          return livePrice >= minOte && livePrice <= maxOte;
        }
        if (zone === 'FIB_50') return livePrice <= (high - 0.50 * (high - low));
        if (zone === 'FIB_60') return livePrice <= (high - 0.60 * (high - low));
        if (zone === 'FIB_705') return livePrice <= (high - 0.705 * (high - low));
        if (zone === 'FIB_79') return livePrice <= (high - 0.79 * (high - low));
      } else if (trend === 'BEARISH') {
        if (zone === 'OTE') {
          const minOte = low + 0.62 * (high - low);
          const maxOte = low + 0.79 * (high - low);
          return livePrice >= minOte && livePrice <= maxOte;
        }
        if (zone === 'FIB_50') return livePrice >= (low + 0.50 * (high - low));
        if (zone === 'FIB_60') return livePrice >= (low + 0.60 * (high - low));
        if (zone === 'FIB_705') return livePrice >= (low + 0.705 * (high - low));
        if (zone === 'FIB_79') return livePrice >= (low + 0.79 * (high - low));
      }
      return false;
    }

    case 'MARKET_VELOCITY':
      return typeof ipda.market_velocity === 'number' ? ipda.market_velocity : 0;

    case 'STRUCTURE_TYPE': {
      const swings = ipda.full_structure_map?.swings || [];
      if (swings.length === 0) return 'MAJOR';
      const latest = swings[swings.length - 1];
      return latest.structure_type || 'MAJOR';
    }

    case 'LIQUIDATION_STATUS':
      return orderFlow.liquidation_events?.status || 'NORMAL';

    case 'SMART_MONEY_SYNC': {
      const smartMoney = orderFlow.smart_money_sentiment || {};
      return smartMoney.smart_money_divergence !== true;
    }

    case 'BTC_RELATIVE_STRENGTH':
      return ipda.smt_context?.btc_relative_strength || 'LAGGARD';

    case 'HTF_MAGNET_DIST':
      return ipda.pricing_context?.nearest_htf_magnet?.distance ?? 999999;

    case 'HIGH_VOLUME_SESSION':
      return (ipda.current_time_window || 'DEAD_ZONE') !== 'DEAD_ZONE';

    case 'CURRENT_SESSION':
      return ipda.current_time_window || 'DEAD_ZONE';

    default:
      return false;
  }
}

function evaluateServerCondition(
  strategy: any,
  condition: any,
  data: Record<string, any>,
  livePrice: number
): boolean {
  const resolved = resolveServerMetric(strategy, condition, data, livePrice);

  if (typeof resolved === 'boolean') {
    if (condition.operator === 'IS_TRUE') return resolved === true;
    if (condition.operator === 'IS_FALSE') return resolved === false;
    return false;
  }

  if (typeof resolved === 'number') {
    const condVal = parseFloat(condition.value || '0');
    if (condition.operator === 'GREATER_THAN') return resolved > condVal;
    if (condition.operator === 'LESS_THAN') return resolved < condVal;
    if (condition.operator === 'EQUALS') return resolved === condVal;
    if (condition.operator === 'NOT_EQUALS') return resolved !== condVal;
    return false;
  }

  if (condition.operator === 'EQUALS') return resolved === condition.value;
  if (condition.operator === 'NOT_EQUALS') return resolved !== condition.value;

  return false;
}

export function evaluateServerStrategy(
  strategy: any,
  data: Record<string, any>,
  livePrice: number,
  liveCandle: ServerBtCandle
): boolean {
  const conditions = Array.isArray(strategy.conditions)
    ? strategy.conditions
    : (strategy.conditions?.conditions || []);

  if (!Array.isArray(conditions) || conditions.length === 0) return false;

  const isObj = !Array.isArray(strategy.conditions);

  // ── OLS Statistical Validation Veto Gate ──
  const sensitivity = isObj ? (strategy.conditions.statistical_sensitivity || 'STRICT') : 'STRICT';

  if (sensitivity !== 'OFF' && data?.ipda_metrics?.institutional_sponsorship?.statistical_validation) {
    const statVal = data.ipda_metrics.institutional_sponsorship.statistical_validation;
    const tStat = Math.abs(statVal.t_statistic || 0);
    const pVal = statVal.p_value ?? 1.0;

    if (sensitivity === 'STRICT') {
      if (tStat < 1.96 || pVal >= 0.05) return false; // Vetoed!
    } else if (sensitivity === 'RELAXED') {
      if (tStat < 1.65 || pVal >= 0.15) return false; // Vetoed!
    }
  }

  // Pure ON_CLOSE temporal checks: server-side candles are treated as fully closed
  // during sequential loop steps, so onClose is always valid.

  // All conditions must pass simultaneously
  return conditions.every((c: any) => evaluateServerCondition(strategy, c, data, livePrice));
}
