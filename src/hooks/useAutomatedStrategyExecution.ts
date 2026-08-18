'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import {
  AutomatedStrategyExecutionEngine,
  StrategyExecutionPosition,
  AutomatedExecutionConfig,
  DEFAULT_AUTOMATED_CONFIG,
  ExecutionEvent,
} from '@/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { Candle } from '@/lib/fvgEngine';
import {
  getSweepReclaimAutoExec,
  setSweepReclaimAutoExec,
  STRATEGY_AUTO_EXEC_EVENT,
  StrategyAutoExecState,
} from '@/lib/quantEngine/strategyExecutionConfig';
import type { SmartAlert } from '@/hooks/useLiveAlerts';

// Global singleton instance ensures background tick execution persists across tabs & modals
let sharedStrategyEngineInstance: AutomatedStrategyExecutionEngine | null = null;

function getSharedStrategyEngine(config: AutomatedExecutionConfig): AutomatedStrategyExecutionEngine {
  if (!sharedStrategyEngineInstance) {
    sharedStrategyEngineInstance = new AutomatedStrategyExecutionEngine(config);
  }
  return sharedStrategyEngineInstance;
}

export function useAutomatedStrategyExecution(
  initialConfig?: Partial<AutomatedExecutionConfig>,
  triggerAlertOverride?: (type: SmartAlert['type'], message: string, soundPath?: string, sourceTag?: string) => void
) {
  const { data: marketData, wsStatus, triggerSmartAlert } = useMarketDataContext();
  const { livePrice, liveCandle } = useMarketDataLiveContext();

  const dispatchAlert = triggerAlertOverride || triggerSmartAlert;

  const [engineConfig, setEngineConfig] = useState<AutomatedExecutionConfig>({
    ...DEFAULT_AUTOMATED_CONFIG,
    autoExecute: getSweepReclaimAutoExec(),
    ...initialConfig,
  });

  const engineRef = useRef<AutomatedStrategyExecutionEngine>(getSharedStrategyEngine(engineConfig));
  const [activePositions, setActivePositions] = useState<StrategyExecutionPosition[]>([]);
  const [pendingOrders, setPendingOrders] = useState<StrategyExecutionPosition[]>([]);
  const [closedTrades, setClosedTrades] = useState<StrategyExecutionPosition[]>([]);
  const [accountEquity, setAccountEquity] = useState<number>(10000.0);
  const [lastEvent, setLastEvent] = useState<ExecutionEvent | null>(null);

  // Listen to cross-component dual strategy auto-exec changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleAutoExecUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<StrategyAutoExecState>;
      const srEnabled = customEvent.detail ? customEvent.detail.isSweepReclaimAutoExecEnabled : getSweepReclaimAutoExec();
      setEngineConfig(prev => {
        if (prev.autoExecute !== srEnabled) {
          return { ...prev, autoExecute: srEnabled };
        }
        return prev;
      });
    };

    window.addEventListener(STRATEGY_AUTO_EXEC_EVENT, handleAutoExecUpdate);
    return () => {
      window.removeEventListener(STRATEGY_AUTO_EXEC_EVENT, handleAutoExecUpdate);
    };
  }, []);

  // Sync configuration updates into engine
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateConfig(engineConfig);
    }
  }, [engineConfig]);

  // ── 1. Query Active Portfolio Equity from /api/account ─────────────────────
  const fetchAccountEquity = useCallback(async () => {
    try {
      const res = await fetch('/api/account');
      if (!res.ok) return;
      const data = await res.json();
      if (data.account?.current_balance) {
        const balance = parseFloat(data.account.current_balance);
        if (balance > 0 && !isNaN(balance)) {
          setAccountEquity(balance);
          engineRef.current.setAccountEquity(balance);
        }
      }
    } catch (err) {
      console.warn('[useAutomatedStrategyExecution] Failed to fetch account equity:', err);
    }
  }, []);

  useEffect(() => {
    fetchAccountEquity();
  }, [fetchAccountEquity]);

  // ── 2. On-Mount Database Re-hydration from /api/trades ─────────────────────
  useEffect(() => {
    let isMounted = true;

    async function rehydrateFromDatabase() {
      try {
        const res = await fetch('/api/trades');
        if (!res.ok) return;
        const data = await res.json();
        const trades = data.trades || [];
        const openTrades = trades.filter(
          (t: any) =>
            t.status === 'OPEN' || t.status === 'STAGE_1_FILLED' || t.status === 'STAGE_2_FILLED'
        );

        if (openTrades.length > 0 && engineRef.current && isMounted) {
          const rehydrated = engineRef.current.rehydrateOpenPositions(openTrades);
          if (rehydrated.length > 0) {
            setActivePositions([...engineRef.current.getActivePositions()]);
            setPendingOrders([...engineRef.current.getPendingLimitOrders()]);
            setClosedTrades([...engineRef.current.getClosedPositions()]);
          }
        }
      } catch (err) {
        console.warn('[useAutomatedStrategyExecution] On-mount DB re-hydration error:', err);
      }
    }

    rehydrateFromDatabase();
    return () => {
      isMounted = false;
    };
  }, []);

  // ── 3. Subscribe to Engine Lifecycle Events & Full-Duplex Trade Journal ────
  useEffect(() => {
    if (!engineRef.current) return;

    const unsubscribe = engineRef.current.subscribe(async (event) => {
      setLastEvent(event);
      setActivePositions([...engineRef.current.getActivePositions()]);
      setPendingOrders([...engineRef.current.getPendingLimitOrders()]);
      setClosedTrades([...engineRef.current.getClosedPositions()]);

      const pos = event.position;

      // ── Event Bus Audio / Toast Notifications ──
      if (event.type === 'LIMIT_ORDER_PLACED') {
        dispatchAlert?.('AUTO_ORDER_ROUTED', event.message, '/audio/fvg_alert.mp3', 'STRATEGY_EXECUTION');
      } else if (event.type === 'ORDER_FILLED') {
        dispatchAlert?.('AUTO_ORDER_ROUTED', event.message, '/audio/sweep_alert.mp3', 'STRATEGY_EXECUTION');
      } else if (event.type === 'STAGE_1_HARVEST' || event.type === 'STAGE_2_HARVEST') {
        dispatchAlert?.('STAGE_FILL', event.message, '/audio/objective_update.wav', 'STRATEGY_EXECUTION');
      } else if (event.type === 'POSITION_CLOSED') {
        dispatchAlert?.('SMT_TRAP', event.message, '/audio/flow_state.wav', 'STRATEGY_EXECUTION');
      }

      // ── A. Atomic Trade Entry: POST /api/trades ──
      if (event.type === 'ORDER_FILLED' && pos && !pos.dbTradeId) {
        try {
          const payload = {
            symbol: pos.symbol,
            direction: pos.direction,
            strategy_name: pos.strategyName,
            ai_narrative_summary: `[Auto 2% Compounded 3-Stage Harvest] ${event.message}`,
            entry_price: pos.entryPrice,
            stop_loss: pos.initialStopLoss,
            take_profit: pos.stage3Target,
            status: 'OPEN',
            position_size: pos.contractSize,
            risk_amount_usd: pos.riskUsd,
            risk_percent: pos.riskPct,
            opened_at: new Date(pos.openTime || Date.now()).toISOString(),
            ipda_metrics: {
              timeframe: pos.timeframe,
              fvg_ce: pos.fvgCeLevel,
              dol_target: pos.dynamicDolTarget,
              stage1_target: pos.stage1Target,
              stage2_target: pos.stage2Target,
              stage3_target: pos.stage3Target,
              equity_at_entry: pos.equityAtEntry,
            },
          };

          const res = await fetch('/api/trades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (res.ok) {
            const data = await res.json();
            const dbId = data.trade_id || data.trade?.id;
            if (dbId) {
              engineRef.current.linkDbTradeId(pos.id, dbId);
            }
          }

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('trades-refresh'));
          }
        } catch (err) {
          console.error('[useAutomatedStrategyExecution] Failed to persist new trade to DB:', err);
        }
      }

      // ── B. Progressive Stage Updates: PATCH /api/trades on Stage 1 / 2 ──
      if ((event.type === 'STAGE_1_HARVEST' || event.type === 'STAGE_2_HARVEST') && pos && pos.dbTradeId) {
        try {
          await fetch('/api/trades', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trade_id: pos.dbTradeId,
              status: pos.status,
              stop_loss: pos.activeStopLoss,
              realized_pnl: pos.realizedUsd,
              ai_narrative_summary: `[${pos.status}] ${event.message}`,
            }),
          });

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('trades-refresh'));
          }
        } catch (err) {
          console.warn('[useAutomatedStrategyExecution] Stage harvest PATCH failed:', err);
        }
      }

      // ── C. Final Trade Closure: PATCH /api/trades ──
      if (event.type === 'POSITION_CLOSED' && pos && pos.dbTradeId) {
        try {
          await fetch('/api/trades', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trade_id: pos.dbTradeId,
              status: 'CLOSED',
              exit_price: pos.exitPrice,
              realized_pnl: pos.realizedUsd,
              outcome: pos.realizedR > 0 ? 'WIN' : pos.realizedR === 0 ? 'BE_SCRATCH' : 'LOSS',
              closed_at: new Date(pos.closeTime || Date.now()).toISOString(),
              ai_narrative_summary: `[CLOSED: ${pos.exitReason}] Final Realized P&L: ${pos.realizedR > 0 ? '+' : ''}${pos.realizedR.toFixed(
                2
              )}R ($${pos.realizedUsd.toFixed(2)})`,
            }),
          });

          // Refresh account equity dynamically after closing trade
          fetchAccountEquity();

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('trades-refresh'));
          }
        } catch (err) {
          console.warn('[useAutomatedStrategyExecution] Final close PATCH failed:', err);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [dispatchAlert, fetchAccountEquity]);

  // ── 4. Real-Time Market Tick Processing Pipeline ──────────────────────────
  useEffect(() => {
    if (livePrice && livePrice > 0 && engineRef.current) {
      const candleAdapter: Candle | null = liveCandle
        ? {
            t: Number(liveCandle.time),
            o: liveCandle.open,
            h: liveCandle.high,
            l: liveCandle.low,
            c: liveCandle.close,
            v: liveCandle.volume || 0,
            taker_buy_vol: (liveCandle.volume || 0) * 0.5,
            taker_sell_vol: (liveCandle.volume || 0) * 0.5,
            isClosed: !!liveCandle.isClosed,
          }
        : null;

      engineRef.current.processMarketTick(livePrice, candleAdapter);
      setActivePositions([...engineRef.current.getActivePositions()]);
      setPendingOrders([...engineRef.current.getPendingLimitOrders()]);
      setClosedTrades([...engineRef.current.getClosedPositions()]);
    }
  }, [livePrice, liveCandle]);

  // ── Public API Handlers ──
  const submitStrategyOrder = useCallback(
    (params: Parameters<AutomatedStrategyExecutionEngine['submitStrategyOrder']>[0]) => {
      return engineRef.current.submitStrategyOrder(params);
    },
    []
  );

  const emergencyClosePosition = useCallback(
    (posId: string) => {
      const price = livePrice || 0;
      return engineRef.current.emergencyClosePosition(posId, price);
    },
    [livePrice]
  );

  const moveStopToBreakeven = useCallback((posId: string) => {
    return engineRef.current.moveStopToBreakeven(posId);
  }, []);

  const toggleAutoExecute = useCallback(() => {
    const nextVal = !engineConfig.autoExecute;
    setSweepReclaimAutoExec(nextVal);
    setEngineConfig(prev => ({ ...prev, autoExecute: nextVal }));
    return nextVal;
  }, [engineConfig.autoExecute]);

  const riskUsd2Pct = parseFloat((accountEquity * (engineConfig.compoundingRiskPct / 100)).toFixed(2));

  return {
    engineConfig,
    setEngineConfig,
    isSweepReclaimAutoExecEnabled: engineConfig.autoExecute,
    toggleAutoExecute,
    activePositions,
    pendingOrders,
    closedTrades,
    accountEquity,
    riskUsd2Pct,
    lastEvent,
    submitStrategyOrder,
    emergencyClosePosition,
    moveStopToBreakeven,
    refetchEquity: fetchAccountEquity,
  };
}
