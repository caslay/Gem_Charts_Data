import { useEffect, useRef } from "react";
import type { MarketDataPayload } from "./useMarketData";
import { generatePotentialTrades, autoExecuteTradeIfNeeded } from "@/lib/quantTradeEngine";

/**
 * Background Auto-Trade Execution Hook.
 * Monitored 24/7 in Live Mode and on replay steps in Backtest Mode.
 * Whenever market data arrives, checks if any setups flagged with 'isAutoExecute'
 * have entered ACTIVE_WATCH / CONFIRMED / TARGET_HIT state, and automatically
 * logs them to the Trading Journal endpoint (/api/trades or /api/backtest-trades).
 */
export function useAutoTradeExecutor(data: MarketDataPayload | null, isBacktest: boolean = false) {
  const isExecutingRef = useRef(false);
  const lastEvaluatedKeyRef = useRef<string>('');

  useEffect(() => {
    if (!data || isExecutingRef.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const candles5m = data.data_payload?.candles_5m || [];
    const last5mT = candles5m.length > 0 ? candles5m[candles5m.length - 1]?.t : 0;
    const fvgCount = data.ipda_metrics?.active_fvgs?.length || 0;
    const key = `${last5mT}_${fvgCount}`;

    // Skip redundant full scans during 5s delta polls if candle timestamp and FVG count haven't changed
    if (!isBacktest && lastEvaluatedKeyRef.current === key) return;
    lastEvaluatedKeyRef.current = key;

    try {
      const summary = generatePotentialTrades(data, isBacktest);
      summary.setups.forEach((setup) => {
        if (setup.isAutoExecute && !setup.isAutoOpened) {
          isExecutingRef.current = true;
          autoExecuteTradeIfNeeded(setup, isBacktest).finally(() => {
            isExecutingRef.current = false;
          });
        }
      });
    } catch (err) {
      console.error("[useAutoTradeExecutor] Error running auto-trade check:", err);
      isExecutingRef.current = false;
    }
  }, [data, isBacktest]);
}
