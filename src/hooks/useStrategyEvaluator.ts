'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import type { MarketDataPayload, Candle } from '@/hooks/useMarketData';
import type { LiveCandle } from '@/hooks/useBinanceWS';
import type { MetricKey, OperatorKey, TemporalMode, CustomStrategy, StrategyCondition } from '@/components/modals/EquationBuilder';
import { annotateCandlesWithVolumetricSignals, checkPerfectMovementSetup, PerfectMovementSettings } from '@/utils/generateChartMarkers';

// ─── Metric Evaluation Engine ─────────────────────────────────────────────────

/**
 * Resolves the boolean/enum value of a single metric key against the current
 * market data snapshot and live WebSocket price.
 *
 * Returns either a boolean (for boolean-type metrics) or a string
 * (for enum-type metrics like OI_TREND, PRICE_VS_OPEN).
 */
function resolveMetric(
  strategy: CustomStrategy,
  condition: StrategyCondition,
  data: MarketDataPayload | null,
  livePrice: number | null,
  aiBias: number | null
): boolean | string | number {
  if (!data) return false;

  const ipda = data.ipda_metrics || {};
  const orderFlow = ipda.order_flow_engine || (data as any).order_flow_engine || {};
  const metric = condition.metric;

  switch (metric as string) {
    case 'AI_DAILY_BIAS': {
      if (aiBias === 1) return 'BULLISH';
      if (aiBias === -1) return 'BEARISH';
      if (aiBias === 0) return 'NEUTRAL';
      return 'NEUTRAL';
    }

    case 'MACRO_BIAS': {
      return ipda.macro_daily_bias || 'NEUTRAL';
    }

    case 'PRICE_VS_POC': {
      const price = livePrice || 0;
      const dr = ipda.full_structure_map?.dealingRange || {};
      const pm = dr.profile_metrics;
      if (!pm || typeof pm.poc !== 'number' || price === 0) return 'INSIDE_VALUE_AREA';

      const val = typeof pm.val === 'number' ? pm.val : null;
      const vah = typeof pm.vah === 'number' ? pm.vah : null;

      if (val !== null && vah !== null && price >= val && price <= vah) {
        return 'INSIDE_VALUE_AREA';
      }

      return price > pm.poc ? 'ABOVE_POC' : 'BELOW_POC';
    }

    case 'FVG': {
      let fvgs = ipda.active_fvgs || [];
      if (!Array.isArray(fvgs)) return false;

      // Dynamically filter by timeframe sub-dropdown selection
      if (condition.timeframe && condition.timeframe !== 'ANY') {
        fvgs = fvgs.filter((f: any) => f.timeframe === condition.timeframe);
      }

      // Dynamically filter by direction sub-dropdown selection
      if (condition.direction && condition.direction !== 'ANY') {
        fvgs = fvgs.filter((f: any) => f.type === condition.direction);
      }

      return fvgs.length > 0;
    }

    case 'PRICE_IN_FVG': {
      let fvgs = ipda.active_fvgs || [];
      const price = livePrice || 0;
      if (price === 0 || !Array.isArray(fvgs) || fvgs.length === 0) return false;

      // Dynamically filter by timeframe sub-dropdown selection
      if (condition.timeframe && condition.timeframe !== 'ANY') {
        fvgs = fvgs.filter((f: any) => f.timeframe === condition.timeframe);
      }

      // Dynamically filter by direction sub-dropdown selection
      if (condition.direction && condition.direction !== 'ANY') {
        fvgs = fvgs.filter((f: any) => f.type === condition.direction);
      }

      return fvgs.some((fvg: any) => {
        const minVal = Math.min(fvg.top, fvg.bottom);
        const maxVal = Math.max(fvg.top, fvg.bottom);
        return price >= minVal && price <= maxVal;
      });
    }

    case 'DISPLACEMENT': {
      const sponsorshipObj = ipda.institutional_sponsorship || {};
      const status = sponsorshipObj.status || orderFlow.displacement_sponsorship || 'INACTIVE';
      const direction = sponsorshipObj.direction || (status.includes('BULLISH') ? 'BULLISH' : status.includes('BEARISH') ? 'BEARISH' : 'NONE');

      const isBullishActive = status === 'ACTIVE_BULLISH' || (status === 'ACTIVE' && direction === 'BULLISH');
      const isBearishActive = status === 'ACTIVE_BEARISH' || (status === 'ACTIVE' && direction === 'BEARISH');
      
      const userValue = condition.value;

      if (userValue === 'ACTIVE_BULLISH') {
        return isBullishActive ? 'ACTIVE_BULLISH' : 'INACTIVE';
      }
      if (userValue === 'ACTIVE_BEARISH') {
        return isBearishActive ? 'ACTIVE_BEARISH' : 'INACTIVE';
      }
      
      // For 'ANY' or default/fallback matching
      const isAnyActive = isBullishActive || isBearishActive || status === 'ACTIVE';
      return isAnyActive ? 'ANY' : 'INACTIVE';
    }

    case 'DISPLACEMENT_VALUE': {
      const sponsorship = ipda.institutional_sponsorship || {};
      return typeof sponsorship.anomaly_multiplier === 'number' ? sponsorship.anomaly_multiplier : 0;
    }

    case 'OI_TREND': {
      const trend = orderFlow.open_interest_trend;
      if (trend === 'RISING' || trend === 'FALLING' || trend === 'FLAT') {
        return trend;
      }
      return 'FLAT';
    }

    case 'MSS': {
      const condDir = condition.direction || 'ANY';
      const condConf = (condition as any).confirmation || 'CONFIRMED';

      const events = ipda.full_structure_map?.structural_events || [];
      const mssEvents = events.filter((e: any) => e.type === 'MSS' || e.type === 'CHoCH');
      const latestMss = mssEvents[mssEvents.length - 1] || null;

      if (!latestMss) {
        // Fallback to legacy top-level ipda metrics if events are unavailable
        const mssActive = ipda.market_structure_shift === true;
        const mssDir = ipda.market_structure_shift_direction;
        const isDirMatch = condDir === 'ANY' || mssDir === condDir;
        if (condConf === 'UNCONFIRMED') return false; 
        return mssActive && isDirMatch;
      }

      // Invalidated breaks are ignored
      if (latestMss.invalidated) return false;

      // Check confirmation matching using the Sharp Departure Momentum filter
      let isConfMatch = false;
      if (condConf === 'CONFIRMED') {
        isConfMatch = latestMss.sharp_departure_confirmed === true;
      } else if (condConf === 'UNCONFIRMED') {
        isConfMatch = !latestMss.sharp_departure_confirmed && !latestMss.sharp_departure_failed;
      } else {
        isConfMatch = true; // ANY
      }

      // Check direction matching
      const isDirMatch = condDir === 'ANY' || latestMss.direction === condDir;

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

      if (tf === '1m' || tf === '5m') {
        return isDivergenceMatch(smt.m5_divergence);
      }
      if (tf === '15m' || tf === '30m' || tf === '1h' || tf === '4h') {
        return isDivergenceMatch(smt.m15_divergence);
      }

      // ANY timeframe
      return isDivergenceMatch(smt.m5_divergence) || isDivergenceMatch(smt.m15_divergence);
    }

    // [DEPRECATED — Phase 2 TDO Removal] PRICE_VS_OPEN has been removed.
    // Migrate saved strategies to LOCAL_PRICING (PREMIUM/DISCOUNT).
    case 'PRICE_VS_OPEN': {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[StrategyEvaluator] PRICE_VS_OPEN is deprecated and removed. Migrate to LOCAL_PRICING.');
      }
      return 'UNKNOWN';
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

    case 'TARGET_EXHAUSTION': {
      return ipda.target_status || 'PENDING';
    }

    case 'NEARBY_MAGNET': {
      const liquidity = orderFlow.resting_liquidity_pools || {};
      const bsl = liquidity.BSL_Magnets || [];
      const ssl = liquidity.SSL_Magnets || [];
      const allMagnets = [...bsl, ...ssl];
      const price = livePrice || 0;
      if (price === 0 || allMagnets.length === 0) return false;
      return allMagnets.some((magnetPrice: number) => Math.abs(price - magnetPrice) <= 2.00);
    }

    case 'MARKET_TREND': {
      return ipda.global_anchors?.current_trend || ipda.current_trend || 'UNSET';
    }

    case 'SUB_TREND': {
      return ipda.global_anchors?.sub_trend || ipda.full_structure_map?.subTrend || 'UNSET';
    }

    case 'INTERNAL_TREND': {
      return ipda.internal_context?.trend || ipda.internal_market_trend || 'UNSET';
    }

    case 'INTERNAL_MSS': {
      return ipda.internal_context?.market_structure_shift === true || ipda.internal_structure_shift === true;
    }

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

    case 'MSS_CONFIRMED': {
      return ipda.market_structure_shift === true;
    }

    case 'BOS': {
      const zigzag = ipda.full_structure_map?.zigzag || [];
      if (!Array.isArray(zigzag) || zigzag.length === 0) return false;
      const latestSegment = zigzag[zigzag.length - 1];
      const isBOSActive = latestSegment?.label === 'BOS';

      const condDir = (condition as any).direction;
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
      const price = livePrice || 0;
      
      if (high === 0 || low === 0 || price === 0) return false;
      const trend = ipda.global_anchors?.current_trend || ipda.current_trend || 'UNSET';
      const zone = (condition as any).retracement || 'OTE';
      
      if (trend === 'BULLISH') {
        if (zone === 'OTE') {
          const minOte = high - 0.79 * (high - low);
          const maxOte = high - 0.62 * (high - low);
          return price >= minOte && price <= maxOte;
        }
        if (zone === 'FIB_50') {
          const level = high - 0.50 * (high - low);
          return price <= level;
        }
        if (zone === 'FIB_60') {
          const level = high - 0.60 * (high - low);
          return price <= level;
        }
        if (zone === 'FIB_705') {
          const level = high - 0.705 * (high - low);
          return price <= level;
        }
        if (zone === 'FIB_79') {
          const level = high - 0.79 * (high - low);
          return price <= level;
        }
      } else if (trend === 'BEARISH') {
        if (zone === 'OTE') {
          const minOte = low + 0.62 * (high - low);
          const maxOte = low + 0.79 * (high - low);
          return price >= minOte && price <= maxOte;
        }
        if (zone === 'FIB_50') {
          const level = low + 0.50 * (high - low);
          return price >= level;
        }
        if (zone === 'FIB_60') {
          const level = low + 0.60 * (high - low);
          return price >= level;
        }
        if (zone === 'FIB_705') {
          const level = low + 0.705 * (high - low);
          return price >= level;
        }
        if (zone === 'FIB_79') {
          const level = low + 0.79 * (high - low);
          return price >= level;
        }
      }
      return false;
    }

    case 'MARKET_VELOCITY': {
      return typeof ipda.market_velocity === 'number' ? ipda.market_velocity : 0;
    }

    case 'STRUCTURE_TYPE': {
      const swings = ipda.full_structure_map?.swings || [];
      if (swings.length === 0) return 'MAJOR';
      const latest = swings[swings.length - 1];
      return latest.structure_type || 'MAJOR';
    }

    case 'LIQUIDATION_STATUS': {
      const status = orderFlow.liquidation_events?.status || 'NORMAL';
      return status;
    }

    case 'SMART_MONEY_SYNC': {
      const smartMoney = orderFlow.smart_money_sentiment || {};
      const divergence = smartMoney.smart_money_divergence === true;
      return !divergence;
    }

    case 'BTC_RELATIVE_STRENGTH': {
      const smt = ipda.smt_context || {};
      return smt.btc_relative_strength || 'LAGGARD';
    }

    case 'HTF_MAGNET_DIST': {
      const pricing = ipda.pricing_context || {};
      const magnet = pricing.nearest_htf_magnet || {};
      return typeof magnet.distance === 'number' ? magnet.distance : 999999;
    }

    case 'HIGH_VOLUME_SESSION': {
      const currentSession = ipda.current_time_window || 'DEAD_ZONE';
      return currentSession !== 'DEAD_ZONE';
    }

    case 'CURRENT_SESSION': {
      return ipda.current_time_window || 'DEAD_ZONE';
    }

    default:
      return false;
  }
}

/**
 * Evaluates a single condition against the current data snapshot.
 */
function evaluateCondition(
  strategy: CustomStrategy,
  condition: StrategyCondition,
  data: MarketDataPayload | null,
  livePrice: number | null,
  aiBias: number | null
): boolean {
  const resolved = resolveMetric(strategy, condition, data, livePrice, aiBias);

  const expected = (condition.operator === 'IS_TRUE')
    ? 'true'
    : (condition.operator === 'IS_FALSE')
      ? 'false'
      : `${condition.operator} ${condition.value}`;

  if (typeof resolved === 'boolean') {
    // Boolean-type metrics
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

  // Enum/string-type metrics
  if (condition.operator === 'EQUALS') return resolved === condition.value;
  if (condition.operator === 'NOT_EQUALS') return resolved !== condition.value;

  return false;
}

/**
 * Evaluates all conditions for a strategy, respecting temporal modes.
 *
 * TEMPORAL RULES:
 * - If ANY condition has temporal === 'ON_CLOSE', the entire strategy can ONLY
 *   trigger when a candle close event occurs (liveCandle.isClosed === true).
 * - Pure INSTANT strategies can fire mid-candle.
 * - ALL conditions must be TRUE simultaneously.
 */


/**
 * Evaluates all conditions for a strategy, respecting temporal modes.
 *
 * TEMPORAL RULES:
 * - If ANY condition has temporal === 'ON_CLOSE', the entire strategy can ONLY
 *   trigger when a candle close event occurs (liveCandle.isClosed === true).
 * - Pure INSTANT strategies can fire mid-candle.
 * - ALL conditions must be TRUE simultaneously.
 */
function evaluateStrategy(
  strategy: CustomStrategy,
  data: MarketDataPayload | null,
  livePrice: number | null,
  liveCandle: LiveCandle | null,
  aiBias: number | null,
  activeInterval: string = '5m',
  structureState?: any
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
      if (tStat < 1.96 || pVal >= 0.05) {
        return false; // Vetoed! (Strict 95% threshold)
      }
    } else if (sensitivity === 'RELAXED') {
      if (tStat < 1.65 || pVal > 0.10) {
        return false; // Vetoed! (Standard 90% threshold)
      }
    }
  }

  // ── Perfect Movement setup gate check ──
  if (isObj && strategy.conditions.perfect_movement_filter) {
    const tf = strategy.conditions.target_timeframe || activeInterval || '5m';
    const tfKey = `candles_${tf === 'ANY' ? '5m' : tf}`;
    const rawCandles = data?.data_payload?.[tfKey] || [];
    
    if (rawCandles.length < 20) {
      return false; // Not enough history
    }

    // Clone and annotate candles with volumetric signals
    const clonedCandles = rawCandles.map((c: any) => ({ ...c }));
    annotateCandlesWithVolumetricSignals(clonedCandles);

    // Find last fully closed candle index
    let lastClosedIdx = -1;
    for (let i = clonedCandles.length - 1; i >= 0; i--) {
      if (clonedCandles[i].isClosed === true) {
        lastClosedIdx = i;
        break;
      }
    }

    if (lastClosedIdx < 5) return false;

    const pmSettings: PerfectMovementSettings = {
      pmAtrMultiplier: strategy.conditions.pm_atr_multiplier,
      pmVolumeSmaPeriod: strategy.conditions.pm_volume_sma_period,
      pmMinBodyRatio: strategy.conditions.pm_min_body_ratio,
      pmMaxWickRatio: strategy.conditions.pm_max_wick_ratio,
      pmMaxRetracementLimit: strategy.conditions.pm_max_retracement_limit,
      pmSweepLookback: strategy.conditions.pm_sweep_lookback,
      direction: strategy.conditions.direction || 'LONG',
    };

    const isPmValid = checkPerfectMovementSetup(clonedCandles, data, pmSettings, lastClosedIdx - 1, structureState);
    if (!isPmValid) {
      return false; // Perfect Movement Setup filter failed!
    }
  }

  const hasOnCloseCondition = conditions.some((c: any) => c.temporal === 'ON_CLOSE');
  const hasInstantCondition = conditions.some((c: any) => c.temporal === 'INSTANT');
  
  // Strategy settings level check
  const temporalMode = isObj ? (strategy.conditions.temporal_mode || 'INSTANT') : 'INSTANT';

  // Decide if we need to gate this evaluation behind the candle close event:
  // - Gated ONLY if it is a pure ON_CLOSE strategy (i.e. has ON_CLOSE conditions but NO INSTANT conditions).
  // - If it is a mixed strategy (has both ON_CLOSE and INSTANT conditions), we do NOT gate it on close,
  //   allowing the INSTANT conditions to trigger mid-candle.
  // - If it is a pure INSTANT strategy, we do NOT gate it.
  const isPureOnClose = (temporalMode === 'ON_CLOSE' && !hasInstantCondition) || (hasOnCloseCondition && !hasInstantCondition);

  if (isPureOnClose) {
    if (!liveCandle || !liveCandle.isClosed) return false;
  }

  // All conditions must pass
  return conditions.every((c: any) => evaluateCondition(strategy, c, data, livePrice, aiBias));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface StrategyMatch {
  strategyId: string;
  strategyName: string;
  timestamp: number;
}

export interface StrategyEvaluatorConfig {
  isBacktest?: boolean;
  data?: MarketDataPayload | null;
  livePrice?: number | null;
  liveCandle?: LiveCandle | null;
  aiBias?: number | null;
  triggerSmartAlert?: (type: any, message: string, sound?: string) => void;
  activeInterval?: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h';
}

export function useStrategyEvaluator(config?: StrategyEvaluatorConfig) {
  const context = useMarketDataContext();
  const liveContext = useMarketDataLiveContext();

  // Pivot configuration values: use config first, fall back to Live HUD Context
  const data = config?.data !== undefined ? config.data : context.data;
  const livePrice = config?.livePrice !== undefined ? config.livePrice : liveContext.livePrice;
  const liveCandle = config?.liveCandle !== undefined ? config.liveCandle : liveContext.liveCandle;
  const aiBias = config?.aiBias !== undefined ? config.aiBias : context.aiBias;
  const triggerSmartAlert = config?.triggerSmartAlert !== undefined ? config.triggerSmartAlert : context.triggerSmartAlert;

  const isBacktest = !!config?.isBacktest;
  const activeInterval = config?.activeInterval !== undefined ? config.activeInterval : context.wsInterval;
  const tradesApiUrl = isBacktest ? '/api/backtest-trades' : '/api/trades';

  const [strategies, setStrategies] = useState<CustomStrategy[]>([]);
  const [lastMatch, setLastMatch] = useState<StrategyMatch | null>(null);

  // Dynamic Trade Sensing state
  const [trades, setTrades] = useState<any[]>([]);
  const tradesRef = useRef<any[]>([]);
  useEffect(() => {
    tradesRef.current = trades;
  }, [trades]);

  // Per-strategy debounce lock: maps strategy ID → last fired candle time
  const firedLockRef = useRef<Map<string, number>>(new Map());
  
  // Track whether strategies have been fetched
  const hasFetchedRef = useRef(false);

  // ── Fetch active strategies from the API ────────────────────────────────
  const fetchStrategies = useCallback(async () => {
    try {
      const res = await fetch('/api/strategies');
      if (res.ok) {
        const contentType = res.headers.get('content-type');
        if (contentType && !contentType.includes('application/json')) {
          return;
        }
        const json = await res.json();
        const activeStrats = (json.strategies || []).filter((s: CustomStrategy) => s.is_active);
        const filtered = activeStrats.filter((s: any) => {
          const env = s.target_environment || 'BOTH';
          if (isBacktest) {
            return env === 'BACKTEST_ONLY' || env === 'BOTH';
          } else {
            return env === 'LIVE_ONLY' || env === 'BOTH';
          }
        });
        setStrategies(filtered);
      }
    } catch (err) {
      console.error('[StrategyEvaluator] Failed to fetch strategies:', err);
    }
  }, [isBacktest]);

  // V8.5 — One-Trade Rule: cache of strategy names that already have OPEN/PAUSED positions
  const activeTradeNamesRef = useRef<Set<string>>(new Set());

  const refreshActiveTradeNames = useCallback(async () => {
    try {
      const res = await fetch(tradesApiUrl);
      if (res.ok) {
        const contentType = res.headers.get('content-type');
        if (contentType && !contentType.includes('application/json')) {
          return;
        }
        const json = await res.json();
        const tradesList = json.trades || [];
        setTrades(tradesList);

        const activeNames = new Set<string>(
          tradesList
            .filter((t: any) => t.status === 'OPEN' || t.status === 'PAUSED')
            .map((t: any) => t.strategy_name as string)
        );
        activeTradeNamesRef.current = activeNames;
      }
    } catch (err) {
      console.error('[StrategyEvaluator] Failed to refresh active trade names:', err);
    }
  }, [tradesApiUrl]);

  // Fetch on mount + periodically refresh (ONLY in live mode to prevent backtest lag/refetch loops)
  useEffect(() => {
    if (!hasFetchedRef.current) {
      fetchStrategies();
      refreshActiveTradeNames();
      hasFetchedRef.current = true;
    }
    if (isBacktest) return;

    const interval = setInterval(() => {
      fetchStrategies();
      refreshActiveTradeNames();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchStrategies, refreshActiveTradeNames, isBacktest]);

  // Sync active trades with server-side closes triggered by background scans
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleRefresh = () => {
      refreshActiveTradeNames();
    };
    const eventName = isBacktest ? 'backtest-trades-refresh' : 'trades-refresh';
    window.addEventListener(eventName, handleRefresh);
    return () => {
      window.removeEventListener(eventName, handleRefresh);
    };
  }, [refreshActiveTradeNames, isBacktest]);

  // ── Main Evaluation Loop ────────────────────────────────────────────────
  useEffect(() => {
    if (!data || strategies.length === 0) return;

    // Derived states for Directional & Active Trade Sensing
    const currentTrades = tradesRef.current;
    const hasOpenShort = currentTrades.some(t => t.status === 'OPEN' && t.direction === 'SHORT');
    const hasOpenLong = currentTrades.some(t => t.status === 'OPEN' && t.direction === 'LONG');

    const structureState = isBacktest
      ? data?.ipda_metrics?.full_structure_map
      : context.structureState;

    for (const strategy of strategies) {
      const conditions = Array.isArray(strategy.conditions)
        ? strategy.conditions
        : (strategy.conditions?.conditions || []);

      const settings = Array.isArray(strategy.conditions)
        ? {}
        : strategy.conditions;

      // ── Strategy-Level Timeframe Locking Gate ──
      const targetTf = settings.target_timeframe || 'ANY';
      if (targetTf !== 'ANY' && activeInterval !== targetTf) {
        continue; // Enforce zero-latency timeframe locking gate
      }

      const direction = settings.direction || 'LONG';

      // ── Directional Lock Gate (Cross-Strategy Conflict) ──
      // LONG Gate: Before evaluating any strategy for a LONG entry, check: if (hasOpenShort) return;
      // SHORT Gate: Before evaluating any strategy for a SHORT entry, check: if (hasOpenLong) return;
      const isAnyTradeOpenInOppositeDirection =
        (direction === 'LONG' && hasOpenShort) ||
        (direction === 'SHORT' && hasOpenLong);

      // Check if the current specific strategy already has an OPEN position in the trades array
      const isThisStrategyAlreadyOpen = trades.some(
        t => t.strategy_name === strategy.name && t.status === 'OPEN'
      );

      // Wrap the execution trigger in a pre-check block:
      if (isAnyTradeOpenInOppositeDirection || isThisStrategyAlreadyOpen) {
        continue; // Pure silence, no alerts
      }

      // V10.23 — Backtest Replay mid-candle TICK fills simulation:
      // If evaluating in the backtest replay engine, a mid-candle TICK strategy (TICK temporal/conditions)
      // can fire if the candle's extreme price (High for shorts, Low for longs) enters the zone.
      let backtestPrice = livePrice;
      if (isBacktest && liveCandle) {
        backtestPrice = direction === 'SHORT' ? liveCandle.high : liveCandle.low;
      }

      const isMatch = evaluateStrategy(strategy, data, backtestPrice, liveCandle, aiBias, activeInterval, structureState);

      if (!isMatch) continue;

      const temporalMode = settings.temporal_mode || 'INSTANT';

      // Determine debounce lock key based on close-gated logic
      const hasOnClose = temporalMode === 'ON_CLOSE' || settings.perfect_movement_filter || conditions.some((c: any) => c.temporal === 'ON_CLOSE');
      const candleKey = hasOnClose
        ? (liveCandle ? Number(liveCandle.time) : Math.floor(Date.now() / 5000))
        : Math.floor(Date.now() / 1000);

      const lastFiredTime = firedLockRef.current.get(strategy.id);
      if (lastFiredTime === candleKey) continue; // Already fired for this state/second

      // ── FIRE! ──────────────────────────────────────────────────────
      firedLockRef.current.set(strategy.id, candleKey);

      const match: StrategyMatch = {
        strategyId: strategy.id,
        strategyName: strategy.name,
        timestamp: Date.now(),
      };

      setLastMatch(match);

      // Fire global toast notification (zero latency — direct call)
      if (triggerSmartAlert) {
        triggerSmartAlert(
          'STRATEGY_MATCHED',
          `[SYSTEM: STRATEGY_MATCHED → ${strategy.name}]`,
          '/audio/fvg_alert.mp3',
          'STRATEGY_ARCHITECT'
        );
      }

      // ── LINKAGE: Automatically execute a paper/backtest trade ──────────────
      const sl_logic = settings.sl_logic || 'Structural Swing';
      const tp_logic = settings.tp_logic || 'Nearest Order Book Magnet';
      const risk_percent = settings.risk_percent ?? 1.0;

      // V8.5 — One-Trade Rule: abort if this strategy already has an OPEN/PAUSED position
      if (activeTradeNamesRef.current.has(strategy.name)) {
        if (triggerSmartAlert) {
          triggerSmartAlert(
            'RISK_OVERRIDE',
            `[SYSTEM: ENTRY_BLOCKED → ${strategy.name}: One-Trade Rule. Close the active position first.]`,
            '/audio/fvg_alert.mp3',
            'RISK_MANAGEMENT'
          );
        }
        continue;
      }

      // V8.8 — Sniper FVG Mitigation: pass exact livePrice as entry_price if PRICE_IN_FVG is evaluated
      const hasPriceInFvg = conditions.some((c: any) => c.metric === 'PRICE_IN_FVG');
      const entry_price = (hasPriceInFvg && typeof livePrice === 'number' && livePrice > 0) ? livePrice : undefined;

      fetch(tradesApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: data.ticker || 'ETHUSDC',
          direction: direction,
          strategy_name: strategy.name,
          ai_narrative_summary: `[AUTO EXECUTE] Triggered by Strategy: ${strategy.name}`,
          ipda_metrics: data.ipda_metrics || data,
          sl_logic,
          tp_logic,
          current_price: livePrice,
          entry_price,
          risk_percent
        })
      }).then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          console.warn(`[StrategyEvaluator] Trade execution declined:`, json.error || json);
          
          // Silently log the 403 directional guardrail lock/veto to the console without triggering generic UI warnings
          if (res.status === 403) {
            console.log("Execution vetoed by Global Lock");
            return;
          }

          if (triggerSmartAlert) {
            triggerSmartAlert(
              'RISK_OVERRIDE',
              `[SYSTEM: TRADE_FAILED → ${strategy.name}: ${json.error || 'Inefficient RR < 2.0'}]`,
              '/audio/fvg_alert.mp3',
              'RISK_MANAGEMENT'
            );
          }
        } else {
          // Mark strategy as having an active trade in the local cache immediately
          activeTradeNamesRef.current.add(strategy.name);

          // Instantly append new trade to local trades state to trigger immediate guardrail protection
          setTrades(prevTrades => [
            {
              id: json.trade_id,
              strategy_name: strategy.name,
              status: 'OPEN',
              direction: direction,
              timestamp: json.timestamp || Date.now()
            },
            ...prevTrades
          ]);

          if (triggerSmartAlert) {
            triggerSmartAlert(
              'STRATEGY_MATCHED',
              `[SYSTEM: JOURNAL_LOGGED → ${strategy.name} trade successfully posted to Journal @ $${json.execution_parameters?.entry_price || livePrice}]`,
              '/audio/fvg_alert.mp3',
              'STRATEGY_ARCHITECT'
            );
          }

          // Trigger a refresh event for components displaying trades
          if (typeof window !== 'undefined') {
            const refreshEventName = isBacktest ? 'backtest-trades-refresh' : 'trades-refresh';
            window.dispatchEvent(new CustomEvent(refreshEventName));
          }
        }
      }).catch((err) => {
        console.error(`[StrategyEvaluator] Trade execution connection error:`, err);
      });
    }
  }, [data, liveCandle, livePrice, strategies, triggerSmartAlert, isBacktest, tradesApiUrl]);

  return {
    strategies,
    lastMatch,
    refetchStrategies: fetchStrategies,
    trades,
    refetchTrades: refreshActiveTradeNames
  };
}
