'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useMarketDataContext } from '@/context/MarketDataContext';
import type { MarketDataPayload } from '@/hooks/useMarketData';
import type { LiveCandle } from '@/hooks/useBinanceWS';
import type { MetricKey, OperatorKey, TemporalMode, CustomStrategy, StrategyCondition } from '@/components/modals/EquationBuilder';

// ─── Metric Evaluation Engine ─────────────────────────────────────────────────

/**
 * Resolves the boolean/enum value of a single metric key against the current
 * market data snapshot and live WebSocket price.
 *
 * Returns either a boolean (for boolean-type metrics) or a string
 * (for enum-type metrics like OI_TREND, PRICE_VS_OPEN).
 */
function resolveMetric(
  condition: StrategyCondition,
  data: MarketDataPayload | null,
  livePrice: number | null
): boolean | string | number {
  if (!data) return false;

  const ipda = data.ipda_metrics || {};
  const orderFlow = ipda.order_flow_engine || (data as any).order_flow_engine || {};
  const metric = condition.metric;

  switch (metric) {
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
      const sponsorship = ipda.institutional_sponsorship?.status
        || orderFlow.displacement_sponsorship;
      return sponsorship === 'ACTIVE' || sponsorship === 'ACTIVE_BULLISH' || sponsorship === 'ACTIVE_BEARISH';
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
      const mss = ipda.market_structure_shift
        || orderFlow.market_structure_shift;
      return mss === true || mss === 'ACTIVE' || mss === 'CONFIRMED';
    }

    case 'SMT': {
      const smartMoney = orderFlow.smart_money_sentiment || {};
      return smartMoney.smart_money_divergence === true;
    }

    case 'PRICE_VS_OPEN': {
      const trueDayOpen = ipda.true_day_open_0700
        || ipda.pricing_context?.true_day_open_0700
        || 0;
      const price = livePrice || 0;
      if (trueDayOpen === 0 || price === 0) return 'ABOVE';
      return price > trueDayOpen ? 'ABOVE' : 'BELOW';
    }

    case 'EQUILIBRIUM_STATUS': {
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

    default:
      return false;
  }
}

/**
 * Evaluates a single condition against the current data snapshot.
 */
function evaluateCondition(
  strategyId: string,
  condition: StrategyCondition,
  data: MarketDataPayload | null,
  livePrice: number | null
): boolean {
  const resolved = resolveMetric(condition, data, livePrice);

  const expected = (condition.operator === 'IS_TRUE')
    ? 'true'
    : (condition.operator === 'IS_FALSE')
      ? 'false'
      : `${condition.operator} ${condition.value}`;

  console.log(`[EVALUATOR] Strategy ${strategyId} - Checking ${condition.metric}: ${resolved} vs ${expected}`);

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
function evaluateStrategy(
  strategy: CustomStrategy,
  data: MarketDataPayload | null,
  livePrice: number | null,
  liveCandle: LiveCandle | null
): boolean {
  const conditions = Array.isArray(strategy.conditions)
    ? strategy.conditions
    : (strategy.conditions?.conditions || []);

  if (!Array.isArray(conditions) || conditions.length === 0) return false;

  const hasOnCloseCondition = conditions.some((c: any) => c.temporal === 'ON_CLOSE');
  
  // Strategy settings level check
  const isObj = !Array.isArray(strategy.conditions);
  const temporalMode = isObj ? (strategy.conditions.temporal_mode || 'INSTANT') : 'INSTANT';

  // If either the strategy settings has temporal === 'ON_CLOSE' or any condition is CLOSE
  if (temporalMode === 'ON_CLOSE' || hasOnCloseCondition) {
    if (!liveCandle || !liveCandle.isClosed) return false;
  }

  // All conditions must pass
  return conditions.every((c: any) => evaluateCondition(strategy.id, c, data, livePrice));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface StrategyMatch {
  strategyId: string;
  strategyName: string;
  timestamp: number;
}

export function useStrategyEvaluator() {
  const { data, liveCandle, livePrice, triggerSmartAlert } = useMarketDataContext();

  const [strategies, setStrategies] = useState<CustomStrategy[]>([]);
  const [lastMatch, setLastMatch] = useState<StrategyMatch | null>(null);

  // Per-strategy debounce lock: maps strategy ID → last fired candle time
  const firedLockRef = useRef<Map<string, number>>(new Map());
  
  // Track whether strategies have been fetched
  const hasFetchedRef = useRef(false);

  // ── Fetch active strategies from the API ────────────────────────────────
  const fetchStrategies = useCallback(async () => {
    try {
      const res = await fetch('/api/strategies');
      if (res.ok) {
        const json = await res.json();
        setStrategies((json.strategies || []).filter((s: CustomStrategy) => s.is_active));
      }
    } catch (err) {
      console.error('[StrategyEvaluator] Failed to fetch strategies:', err);
    }
  }, []);

  // Fetch on mount + periodically refresh every 30s to pick up new strategies
  useEffect(() => {
    if (!hasFetchedRef.current) {
      fetchStrategies();
      hasFetchedRef.current = true;
    }
    const interval = setInterval(fetchStrategies, 30_000);
    return () => clearInterval(interval);
  }, [fetchStrategies]);

  // ── Main Evaluation Loop ────────────────────────────────────────────────
  useEffect(() => {
    if (!data || strategies.length === 0) return;

    for (const strategy of strategies) {
      const isMatch = evaluateStrategy(strategy, data, livePrice, liveCandle);

      if (!isMatch) continue;

      const conditions = Array.isArray(strategy.conditions)
        ? strategy.conditions
        : (strategy.conditions?.conditions || []);

      const settings = Array.isArray(strategy.conditions)
        ? {}
        : strategy.conditions;

      const temporalMode = settings.temporal_mode || 'INSTANT';

      // Determine debounce lock key based on close-gated logic
      const hasOnClose = temporalMode === 'ON_CLOSE' || conditions.some((c: any) => c.temporal === 'ON_CLOSE');
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

      console.log(`[StrategyEvaluator] ✅ STRATEGY MATCHED: "${strategy.name}"`, {
        conditions,
        candleKey,
      });

      // Fire global toast notification (zero latency — direct call)
      if (triggerSmartAlert) {
        triggerSmartAlert(
          'STRATEGY_MATCHED' as any,
          `[SYSTEM: STRATEGY_MATCHED → ${strategy.name}]`
        );
      }

      // ── LINKAGE: Automatically execute a paper trade ──────────────
      const sl_logic = settings.sl_logic || 'Structural Swing';
      const tp_logic = settings.tp_logic || 'Nearest Order Book Magnet';
      const direction = settings.direction || 'LONG';
      const risk_percent = settings.risk_percent ?? 1.0;

      fetch('/api/trades', {
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
          risk_percent
        })
      }).then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          console.warn(`[StrategyEvaluator] Trade execution declined:`, json.error || json);
          if (triggerSmartAlert) {
            triggerSmartAlert(
              'RISK_OVERRIDE' as any,
              `[SYSTEM: TRADE_FAILED → ${strategy.name}: ${json.error || 'Inefficient RR < 2.0'}]`,
              '/audio/fvg_alert.mp3'
            );
          }
        } else {
          console.log(`[StrategyEvaluator] Trade opened successfully:`, json);
          // Secondary success notification (Flow state chimes)
          if (triggerSmartAlert) {
            triggerSmartAlert(
              'FLOW_STATE' as any,
              `[SYSTEM: JOURNAL_LOGGED → ${strategy.name} trade successfully posted to Journal @ $${json.execution_parameters?.entry_price || livePrice}]`,
              '/audio/flow_state.wav'
            );
          }
        }
      }).catch((err) => {
        console.error(`[StrategyEvaluator] Trade execution connection error:`, err);
      });
    }
  }, [data, liveCandle, livePrice, strategies, triggerSmartAlert]);

  return {
    strategies,
    lastMatch,
    refetchStrategies: fetchStrategies,
  };
}
