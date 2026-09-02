'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import {
  LiveOrderBlockExecutionEngine,
  LivePosition,
  LiveExecutionConfig,
  DEFAULT_LIVE_EXEC_CONFIG,
  InZoneTestingState,
  MacroMarketContext,
  SupportedTimeframe
} from '@/lib/quantEngine/LiveOrderBlockExecutionEngine';
import { InstitutionalOrderBlock } from '@/lib/quantEngine/OrderBlockEngine';
import {
  getOrderBlockAutoExec,
  setOrderBlockAutoExec,
  STRATEGY_AUTO_EXEC_EVENT,
  StrategyAutoExecState,
  getEnabledOBTimeframes,
  setEnabledOBTimeframes,
  toggleOBTimeframeStream,
  OB_TIMEFRAME_TOGGLE_EVENT,
  OBTimeframeToggleState,
  SupportedOBTimeframe,
  DEFAULT_ENABLED_TIMEFRAMES,
  IS_ORDER_BLOCK_STRATEGY_PAUSED
} from '@/lib/quantEngine/strategyExecutionConfig';
import type { SmartAlert } from '@/hooks/useLiveAlerts';
import { useSessionJournalStore, type SessionTradeStatus } from '@/lib/quantEngine/sessionJournalStore';

export const IS_OB_STRATEGY_PAUSED = IS_ORDER_BLOCK_STRATEGY_PAUSED;

// Global singleton instance ensures synchronous background processing across all page components & modals
let sharedEngineInstance: LiveOrderBlockExecutionEngine | null = null;

function getSharedEngine(config: LiveExecutionConfig): LiveOrderBlockExecutionEngine {
  if (!sharedEngineInstance) {
    sharedEngineInstance = new LiveOrderBlockExecutionEngine(config);
  }
  return sharedEngineInstance;
}

export function useLiveOrderBlockExecution(
  initialConfig?: Partial<LiveExecutionConfig>,
  triggerAlertOverride?: (type: SmartAlert['type'], message: string, soundPath?: string, sourceTag?: string) => void
) {
  const { data: marketData, wsStatus, triggerSmartAlert } = useMarketDataContext();
  const { livePrice } = useMarketDataLiveContext();
  const isConnected = wsStatus === 'OPEN';

  const dispatchAlert = triggerAlertOverride || triggerSmartAlert;

  const [engineConfig, setEngineConfig] = useState<LiveExecutionConfig>({
    ...DEFAULT_LIVE_EXEC_CONFIG,
    autoExecute: getOrderBlockAutoExec(),
    enabledTimeframes: getEnabledOBTimeframes(),
    ...initialConfig
  });

  const engineRef = useRef<LiveOrderBlockExecutionEngine>(getSharedEngine(engineConfig));
  const [enabledTimeframes, setEnabledTimeframesState] = useState<SupportedOBTimeframe[]>(
    engineConfig.enabledTimeframes || DEFAULT_ENABLED_TIMEFRAMES
  );
  const [activePositions, setActivePositions] = useState<LivePosition[]>([]);
  const [activeZones, setActiveZones] = useState<InstitutionalOrderBlock[]>([]);
  const [activeZonesByTimeframe, setActiveZonesByTimeframe] = useState<Record<string, InstitutionalOrderBlock[]>>({
    '5m': [],
    '15m': [],
    '1h': []
  });
  const [timeframeFilter, setTimeframeFilter] = useState<'ALL' | '5m' | '15m' | '1h'>('ALL');
  const [closedLiveTrades, setClosedLiveTrades] = useState<LivePosition[]>([]);
  const [lastEventMessage, setLastEventMessage] = useState<string>('');
  const [lastEventTime, setLastEventTime] = useState<number>(0);
  const [cooldownRemainingSec, setCooldownRemainingSec] = useState<number>(0);
  const [testingStates, setTestingStates] = useState<InZoneTestingState[]>([]);

  // Listen to cross-component dual strategy auto-exec changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleAutoExecUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<StrategyAutoExecState>;
      const obEnabled = customEvent.detail ? customEvent.detail.isOrderBlockAutoExecEnabled : getOrderBlockAutoExec();
      setEngineConfig(prev => {
        if (prev.autoExecute !== obEnabled) {
          return { ...prev, autoExecute: obEnabled };
        }
        return prev;
      });
    };

    window.addEventListener(STRATEGY_AUTO_EXEC_EVENT, handleAutoExecUpdate);
    return () => {
      window.removeEventListener(STRATEGY_AUTO_EXEC_EVENT, handleAutoExecUpdate);
    };
  }, []);

  // Listen to cross-component MTF stream toggle changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleTfUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<OBTimeframeToggleState>;
      const tfs = (customEvent.detail && Array.isArray(customEvent.detail.enabledTimeframes))
        ? customEvent.detail.enabledTimeframes
        : getEnabledOBTimeframes();

      setEnabledTimeframesState(tfs);
      setEngineConfig(prev => ({ ...prev, enabledTimeframes: tfs }));
      if (engineRef.current) {
        engineRef.current.updateEnabledTimeframes(tfs);
        setActiveZones([...engineRef.current.getActiveZones(timeframeFilter)]);
        setActiveZonesByTimeframe({ ...engineRef.current.getActiveZonesByTimeframe() });
      }
    };

    window.addEventListener(OB_TIMEFRAME_TOGGLE_EVENT, handleTfUpdate);
    return () => {
      window.removeEventListener(OB_TIMEFRAME_TOGGLE_EVENT, handleTfUpdate);
    };
  }, [timeframeFilter]);

  // Update engine config when state changes
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateConfig(engineConfig);
    }
  }, [engineConfig]);

  // ── On-Mount Zone Purge & DB State Re-hydration ──────────────────────────
  useEffect(() => {
    let isMounted = true;

    if (IS_OB_STRATEGY_PAUSED) {
      if (engineRef.current) {
        engineRef.current.purgeAllZones();
      }
      setActiveZones([]);
      setActiveZonesByTimeframe({ '5m': [], '15m': [], '1h': [] });
      setTestingStates([]);
      return;
    }

    async function rehydrateFromDatabase() {
      try {
        const localTrades = useSessionJournalStore.getState().getTradesByMode("LIVE");
        const openTrades = localTrades.filter((t: any) =>
          (t.status === "OPEN" || t.status === "STAGE_1_FILLED" || t.status === "STAGE_2_FILLED") && (
            t.strategy_name?.includes("OB Live") ||
            t.strategy_name?.includes("Auto OB Execution") ||
            t.strategy_name?.startsWith("Phase 7") ||
            t.strategy_name?.startsWith("Phase 6")
          )
        );

        if (engineRef.current && isMounted) {
          engineRef.current.reconcileWithOpenTrades(localTrades);
          if (openTrades.length > 0) {
            engineRef.current.rehydrateOpenPositions(openTrades as any);
          }
          setActivePositions([...engineRef.current.getActivePositions()]);
          setTestingStates([...engineRef.current.getInZoneTestingStates()]);
          setLastEventMessage(`🔄 Re-hydrated and reconciled ${openTrades.length} active trade(s) from local session journal.`);
          setLastEventTime(Date.now());
        }
      } catch (err) {
        console.warn("[useLiveOrderBlockExecution] On-mount local re-hydration error:", err);
      }
    }

    rehydrateFromDatabase();
    return () => {
      isMounted = false;
    };
  }, []);

  // ── Sync with External Journal Changes (Close / Delete / Purge / Archive) ────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleTradesRefresh = () => {
      if (!engineRef.current || IS_OB_STRATEGY_PAUSED) return;
      const localTrades = useSessionJournalStore.getState().getTradesByMode("LIVE");
      const openTrades = localTrades.filter((t: any) =>
        (t.status === "OPEN" || t.status === "STAGE_1_FILLED" || t.status === "STAGE_2_FILLED") && (
          t.strategy_name?.includes("OB Live") ||
          t.strategy_name?.includes("Auto OB Execution") ||
          t.strategy_name?.startsWith("Phase 7") ||
          t.strategy_name?.startsWith("Phase 6")
        )
      );

      engineRef.current.reconcileWithOpenTrades(localTrades);
      if (openTrades.length > 0) {
        engineRef.current.rehydrateOpenPositions(openTrades as any);
      }

      setActivePositions([...engineRef.current.getActivePositions()]);
      setTestingStates([...engineRef.current.getInZoneTestingStates()]);
    };

    window.addEventListener('trades-refresh', handleTradesRefresh);
    return () => {
      window.removeEventListener('trades-refresh', handleTradesRefresh);
    };
  }, []);

  // ── 2. Subscribe to Engine Lifecycle Events & DB Synchronization ──────────
  useEffect(() => {
    if (!engineRef.current) return;

    const unsubscribe = engineRef.current.subscribe(async (event) => {
      setLastEventMessage(event.message);
      setLastEventTime(Date.now());

      const pos = event.position;

      // ── Event Bus Channel Dispatches (Strictly Autonomous OB Pipeline) ──
      if (event.type === 'LIVE_OB_DETECTED') {
        dispatchAlert?.('LIVE_OB_DETECTED', event.message, '/audio/flow_state.wav', 'AUTONOMOUS_OB');
      } else if (event.type === 'CONFIRMATION_PENDING') {
        dispatchAlert?.('IN_ZONE_CONFIRMATION_PENDING', event.message, '/audio/session_transition.wav', 'AUTONOMOUS_OB');
      } else if (event.type === 'ORDER_OPENED' && pos?.dbTradeId) {
        dispatchAlert?.('AUTO_ORDER_ROUTED', event.message, '/audio/sweep_alert.mp3', 'AUTONOMOUS_OB');
      } else if (event.type === 'STAGE_1_HARVEST' || event.type === 'STAGE_2_HARVEST' || event.type === 'STAGE_3_RUNNER') {
        dispatchAlert?.('STAGE_FILL', event.message, '/audio/objective_update.wav', 'AUTONOMOUS_OB');
      }

      // ── A. Atomic Trade Entry: POST /api/trades with Rollback Guard ──
      // ── A. Atomic Trade Entry: Local Store ──
      if (event.type === 'ORDER_OPENED' && pos) {
        try {
          const strategyName = `Auto OB Execution (${pos.timeframe.toUpperCase()} ${pos.orderBlock.quality_tier})`;
          const journalTrade = useSessionJournalStore.getState().addTrade({
            id: pos.id,
            symbol: pos.symbol,
            direction: pos.direction,
            strategy_name: strategyName,
            ai_narrative_summary: `[Phase 7 MTF Live 3-Stage Position] ${event.message}`,
            entry_price: pos.entryPrice,
            stop_loss: pos.initialStopLoss,
            take_profit: pos.tp3Price,
            status: 'OPEN',
            mode: 'LIVE',
            position_size: pos.allocatedAmount,
            risk_amount_usd: engineConfig.fixedRiskUsd,
            risk_percent: 1.0,
            opened_at: new Date(pos.openTime || Date.now()).toISOString(),
            ipda_metrics: {
              timeframe: pos.timeframe,
              orderBlockId: pos.orderBlockId,
              structural_weight: pos.orderBlock.structural_weight,
              htf_alignment: pos.orderBlock.htf_alignment_status,
              gates: pos.orderBlock.gates,
              quality_tier: pos.orderBlock.quality_tier,
              tp1_target: pos.tp1Price,
              tp2_target: pos.tp2Price,
              tp3_target: pos.tp3Price
            }
          });

          engineRef.current.setDbTradeId(pos.id, pos.id);
          setActivePositions([...engineRef.current.getActivePositions()]);
          dispatchAlert?.('AUTO_ORDER_ROUTED', event.message, '/audio/sweep_alert.mp3', 'AUTONOMOUS_OB');

          // Trigger global journal refresh
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('trades-refresh'));
          }
        } catch (err) {
          console.warn('[useLiveOrderBlockExecution] Local trade creation failed, rolling back:', err);
          engineRef.current.rollbackPosition(pos.id, 'Local failure during trade entry persistence');
          setActivePositions([...engineRef.current.getActivePositions()]);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('trades-refresh'));
          }
        }
      }

      // ── B. Progressive Lifecycle Scale-Out: Local Store ──
      if ((event.type === 'STAGE_1_HARVEST' || event.type === 'STAGE_2_HARVEST') && pos) {
          try {
            useSessionJournalStore.getState().updateTrade(pos.id, {
              status: pos.status as unknown as SessionTradeStatus,
              stop_loss: pos.activeStopLoss,
              realized_pnl: pos.realizedR * engineConfig.fixedRiskUsd,
              realized_r: pos.realizedR,
              ai_narrative_summary: `[Auto OB Scale-Out] ${event.message}`
            });
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event('trades-refresh'));
            }
          } catch (err) {
            console.warn('[useLiveOrderBlockExecution] Stage harvest update failed:', err);
          }
      }

      // ── C. Final Trade Closure: Local Store ──
      if (event.type === 'POSITION_CLOSED' && pos) {
          try {
            const exitPrice = pos.exitReason === 'FULL_TP3_WIN' ? pos.tp3Price : pos.activeStopLoss;
            useSessionJournalStore.getState().closeTrade(
              pos.id,
              exitPrice,
              pos.exitReason || 'CLOSED',
              new Date(pos.closeTime || Date.now()).toISOString()
            );

            // Update pnl
            useSessionJournalStore.getState().updateTrade(pos.id, {
              realized_pnl: pos.realizedR * engineConfig.fixedRiskUsd,
              ai_narrative_summary: `[Auto OB Trade Closed] ${event.message}`
            });

            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event('trades-refresh'));
            }
          } catch (err) {
            console.warn('[useLiveOrderBlockExecution] Final close update failed:', err);
          }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [engineConfig.fixedRiskUsd]);

  // Ingest multi-timeframe closed candle streams (5m, 15m, 1h) concurrently from marketData
  const lastProcessedCandleRef = useRef<string>('');
  useEffect(() => {
    if (IS_OB_STRATEGY_PAUSED || !engineRef.current || !marketData) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const payload = marketData.data_payload || {};
    const candles5m = payload.candles_5m || [];
    const candles15m = payload.candles_15m || [];
    const candles1h = payload.candles_1h || [];

    const key = `${candles5m[candles5m.length - 1]?.t}_${candles15m[candles15m.length - 1]?.t}_${candles1h[candles1h.length - 1]?.t}_${timeframeFilter}`;
    if (lastProcessedCandleRef.current === key) return;
    lastProcessedCandleRef.current = key;

    const ipda = marketData.ipda_metrics || {};
    const orderFlow = ipda.order_flow_engine || (marketData as any).order_flow_engine || {};
    const restingPools = orderFlow.resting_liquidity_pools || {};

    const macroContext: MacroMarketContext = {
      macroDailyBias: ipda.macro_daily_bias,
      dolDirection: ipda.dol_direction,
      bslMagnets: restingPools.BSL_Magnets,
      sslMagnets: restingPools.SSL_Magnets,
      localDealingRange: ipda.pricing_context?.local_dealing_range
    };

    engineRef.current.onMultiTimeframeCandles(
      {
        '5m': candles5m,
        '15m': candles15m,
        '1h': candles1h
      },
      macroContext
    );

    setActiveZones((prev) => {
      const next = engineRef.current.getActiveZones(timeframeFilter);
      if (prev.length === 0 && next.length === 0) return prev;
      if (prev.length === next.length && JSON.stringify(prev) === JSON.stringify(next)) return prev;
      return [...next];
    });
    setActiveZonesByTimeframe((prev) => {
      const next = engineRef.current.getActiveZonesByTimeframe();
      if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
      return { ...next };
    });
    setTestingStates((prev) => {
      const next = engineRef.current.getInZoneTestingStates();
      if (prev.length === 0 && next.length === 0) return prev;
      if (prev.length === next.length && JSON.stringify(prev) === JSON.stringify(next)) return prev;
      return [...next];
    });
  }, [marketData?.data_payload, timeframeFilter]);

  // Process live incoming price ticks (Real-time calculation with throttled UI state sync)
  const lastUiSyncTimeRef = useRef<number>(0);
  const prevOpenCountRef = useRef<number>(0);
  const prevClosedCountRef = useRef<number>(0);
  const prevTestingCountRef = useRef<number>(0);

  useEffect(() => {
    if (IS_OB_STRATEGY_PAUSED || !engineRef.current || !livePrice || livePrice <= 0) return;

    const res = engineRef.current.onPriceTick(livePrice, Date.now());
    const openPositions = res.activePositions;
    const closedPositions = engineRef.current.getClosedPositions();
    const testing = engineRef.current.getInZoneTestingStates();

    const openCountChanged = prevOpenCountRef.current !== openPositions.length;
    const closedCountChanged = prevClosedCountRef.current !== closedPositions.length;
    const testingCountChanged = prevTestingCountRef.current !== testing.length;

    const now = Date.now();
    const isThrottledSync = (now - lastUiSyncTimeRef.current >= 250) && openPositions.length > 0;

    if (openCountChanged || closedCountChanged || testingCountChanged || isThrottledSync) {
      lastUiSyncTimeRef.current = now;
      prevOpenCountRef.current = openPositions.length;
      prevClosedCountRef.current = closedPositions.length;
      prevTestingCountRef.current = testing.length;

      setActivePositions((prev) => {
        if (prev.length === 0 && openPositions.length === 0) return prev;
        if (prev.length === openPositions.length && JSON.stringify(prev) === JSON.stringify(openPositions)) return prev;
        return [...openPositions];
      });
      setActiveZones((prev) => {
        const next = engineRef.current.getActiveZones(timeframeFilter);
        if (prev.length === 0 && next.length === 0) return prev;
        if (prev.length === next.length && JSON.stringify(prev) === JSON.stringify(next)) return prev;
        return [...next];
      });
      setActiveZonesByTimeframe((prev) => {
        const next = engineRef.current.getActiveZonesByTimeframe();
        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
        return { ...next };
      });
      setClosedLiveTrades((prev) => {
        if (prev.length === 0 && closedPositions.length === 0) return prev;
        if (prev.length === closedPositions.length && JSON.stringify(prev) === JSON.stringify(closedPositions)) return prev;
        return [...closedPositions];
      });
      setTestingStates((prev) => {
        if (prev.length === 0 && testing.length === 0) return prev;
        if (prev.length === testing.length && JSON.stringify(prev) === JSON.stringify(testing)) return prev;
        return [...testing];
      });
    }
  }, [livePrice, timeframeFilter]);

  // Timer interval to smoothly update cooldown ticker (gated to prevent zero-churn re-renders)
  const prevCooldownRef = useRef<number>(0);
  useEffect(() => {
    if (IS_OB_STRATEGY_PAUSED) return;
    const timer = setInterval(() => {
      if (engineRef.current) {
        const remaining = engineRef.current.getCooldownRemainingSec();
        if (remaining !== prevCooldownRef.current) {
          prevCooldownRef.current = remaining;
          setCooldownRemainingSec(remaining);
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleAutoExecute = useCallback(() => {
    const nextVal = !engineConfig.autoExecute;
    setOrderBlockAutoExec(nextVal);
    setEngineConfig(prev => ({ ...prev, autoExecute: nextVal }));
    return nextVal;
  }, [engineConfig.autoExecute]);

  const setScalingMode = useCallback((mode: 'THREE_STAGE_HARVEST' | 'TWO_STAGE_DYNAMIC' | 'SINGLE_STAGE') => {
    setEngineConfig(prev => ({ ...prev, positionScalingMode: mode }));
  }, []);

  const setTrailingMode = useCallback((mode: 'STRUCTURAL_FVG_TRAIL' | 'STATIC_BREAKEVEN') => {
    setEngineConfig(prev => ({ ...prev, trailingStopMode: mode }));
  }, []);

  const setEnforceHtfAlignment = useCallback((enabled: boolean) => {
    setEngineConfig(prev => ({ ...prev, enforceHtfAlignment: enabled }));
  }, []);

  const toggleTimeframeStream = useCallback((tf: SupportedOBTimeframe) => {
    const next = toggleOBTimeframeStream(tf);
    setEnabledTimeframesState(next);
    setEngineConfig(prev => ({ ...prev, enabledTimeframes: next }));
    if (engineRef.current) {
      engineRef.current.updateEnabledTimeframes(next);
      setActiveZones([...engineRef.current.getActiveZones(timeframeFilter)]);
      setActiveZonesByTimeframe({ ...engineRef.current.getActiveZonesByTimeframe() });
    }
    return next;
  }, [timeframeFilter]);

  const setTimeframeStreamEnabled = useCallback((tf: SupportedOBTimeframe, enabled: boolean) => {
    const current = getEnabledOBTimeframes();
    let next: SupportedOBTimeframe[];
    if (enabled) {
      next = current.includes(tf) ? current : [...current, tf];
    } else {
      if (current.length <= 1 && current.includes(tf)) return;
      next = current.filter(t => t !== tf);
    }
    setEnabledOBTimeframes(next);
    setEnabledTimeframesState(next);
    setEngineConfig(prev => ({ ...prev, enabledTimeframes: next }));
    if (engineRef.current) {
      engineRef.current.updateEnabledTimeframes(next);
      setActiveZones([...engineRef.current.getActiveZones(timeframeFilter)]);
      setActiveZonesByTimeframe({ ...engineRef.current.getActiveZonesByTimeframe() });
    }
  }, [timeframeFilter]);

  const isTimeframeStreamEnabled = useCallback((tf: SupportedOBTimeframe) => {
    return enabledTimeframes.includes(tf);
  }, [enabledTimeframes]);

  return {
    engineConfig,
    setEngineConfig,
    isOrderBlockAutoExecEnabled: engineConfig.autoExecute,
    enabledTimeframes,
    activePositions,
    activeZones,
    activeZonesByTimeframe,
    timeframeFilter,
    setTimeframeFilter,
    closedLiveTrades,
    lastEventMessage,
    lastEventTime,
    isConnected,
    cooldownRemainingSec,
    testingStates,
    toggleAutoExecute,
    setScalingMode,
    setTrailingMode,
    setEnforceHtfAlignment,
    toggleTimeframeStream,
    setTimeframeStreamEnabled,
    isTimeframeStreamEnabled,
    setEnabledTimeframes: setEnabledOBTimeframes
  };
}







