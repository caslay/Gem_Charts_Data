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
  metric: MetricKey,
  data: MarketDataPayload | null,
  livePrice: number | null
): boolean | string {
  if (!data) return false;

  const ipda = data.ipda_metrics || {};
  const orderFlow = ipda.order_flow_engine || {};

  switch (metric) {
    case 'FVG': {
      const fvgs = ipda.active_fvgs || [];
      return Array.isArray(fvgs) && fvgs.length > 0;
    }

    case 'DISPLACEMENT': {
      const sponsorship = ipda.institutional_sponsorship?.status
        || orderFlow.displacement_sponsorship;
      return sponsorship === 'ACTIVE';
    }

    case 'OI_TREND': {
      const trend = orderFlow.open_interest_trend;
      if (trend === 'RISING' || trend === 'FALLING' || trend === 'FLAT') {
        return trend;
      }
      return 'FLAT';
    }

    case 'MSS': {
      // Market Structure Shift detection — look for explicit flag or structural shift indicator
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

    default:
      return false;
  }
}

/**
 * Evaluates a single condition against the current data snapshot.
 */
function evaluateCondition(
  condition: StrategyCondition,
  data: MarketDataPayload | null,
  livePrice: number | null
): boolean {
  const resolved = resolveMetric(condition.metric, data, livePrice);

  if (typeof resolved === 'boolean') {
    // Boolean-type metrics
    if (condition.operator === 'IS_TRUE') return resolved === true;
    if (condition.operator === 'IS_FALSE') return resolved === false;
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
  const conditions = strategy.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) return false;

  const hasOnCloseCondition = conditions.some((c) => c.temporal === 'ON_CLOSE');

  // If any condition requires ON_CLOSE, the entire strategy is gated behind candle close
  if (hasOnCloseCondition) {
    if (!liveCandle || !liveCandle.isClosed) return false;
  }

  // All conditions must pass
  return conditions.every((c) => evaluateCondition(c, data, livePrice));
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

      // ── Debounce Lock: one fire per candle ──────────────────────────
      // Derive the "candle key" from liveCandle time. If no liveCandle,
      // use a timestamp floor (5-second buckets to prevent rapid re-fires).
      const candleKey = liveCandle
        ? Number(liveCandle.time)
        : Math.floor(Date.now() / 5000);

      const lastFiredTime = firedLockRef.current.get(strategy.id);
      if (lastFiredTime === candleKey) continue; // Already fired for this candle

      // ── FIRE! ──────────────────────────────────────────────────────
      firedLockRef.current.set(strategy.id, candleKey);

      const match: StrategyMatch = {
        strategyId: strategy.id,
        strategyName: strategy.name,
        timestamp: Date.now(),
      };

      setLastMatch(match);

      console.log(`[StrategyEvaluator] ✅ STRATEGY MATCHED: "${strategy.name}"`, {
        conditions: strategy.conditions,
        candleKey,
      });

      // Fire global toast notification (zero latency — direct call)
      if (triggerSmartAlert) {
        triggerSmartAlert(
          'STRATEGY_MATCHED' as any,
          `[SYSTEM: STRATEGY_MATCHED → ${strategy.name}]`
        );
      }
    }
  }, [data, liveCandle, livePrice, strategies, triggerSmartAlert]);

  return {
    strategies,
    lastMatch,
    refetchStrategies: fetchStrategies,
  };
}
