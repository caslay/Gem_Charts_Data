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

  useEffect(() => {
    if (!data || isExecutingRef.current) return;

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
