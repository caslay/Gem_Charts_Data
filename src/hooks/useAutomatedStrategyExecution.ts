'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import type { SweepReclaimOverlayData } from '@/hooks/useBacktestStrategyExecution';
import {
  AutomatedStrategyExecutionEngine,
  StrategyExecutionPosition,
  AutomatedExecutionConfig,
  DEFAULT_AUTOMATED_CONFIG,
  ExecutionEvent,
} from '@/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { Candle } from '@/lib/fvgEngine';
import { SweepReclaimSetup } from '@/lib/quantEngine/SweepReclaimEngine';
import {
  getSweepReclaimAutoExec,
  setSweepReclaimAutoExec,
  STRATEGY_AUTO_EXEC_EVENT,
  StrategyAutoExecState,
  getSweepReclaimLiveSettings,
  setSweepReclaimLiveSettings,
  updateSweepReclaimLiveSettings,
  SR_SETTINGS_CHANGED_EVENT,
  SweepReclaimLiveSettings,
  DEFAULT_SR_LIVE_SETTINGS,
  SupportedOBTimeframe,
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
    liveSettings: getSweepReclaimLiveSettings(),
    ...initialConfig,
  });

  const engineRef = useRef<AutomatedStrategyExecutionEngine>(getSharedStrategyEngine(engineConfig));
  const [activePositions, setActivePositions] = useState<StrategyExecutionPosition[]>([]);
  const [pendingOrders, setPendingOrders] = useState<StrategyExecutionPosition[]>([]);
  const [closedTrades, setClosedTrades] = useState<StrategyExecutionPosition[]>([]);
  const [scannedSetups, setScannedSetups] = useState<SweepReclaimSetup[]>([]);
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

  // Listen to cross-component S&R settings updates
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleSettingsUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<SweepReclaimLiveSettings>;
      const updated = customEvent.detail || getSweepReclaimLiveSettings();
      setEngineConfig(prev => ({
        ...prev,
        compoundingRiskPct: updated.compoundingRiskPct ?? prev.compoundingRiskPct,
        stage2Multiple: updated.stage2Multiple ?? prev.stage2Multiple,
        stage3Multiple: updated.stage3Multiple ?? prev.stage3Multiple,
        enableStructuralTrail: updated.enableStructuralTrail ?? prev.enableStructuralTrail,
        enableProfitRatchet: updated.enableProfitRatchet ?? prev.enableProfitRatchet,
        liveSettings: updated,
      }));
      if (engineRef.current) {
        engineRef.current.updateConfig({
          compoundingRiskPct: updated.compoundingRiskPct,
          stage2Multiple: updated.stage2Multiple,
          stage3Multiple: updated.stage3Multiple,
          enableStructuralTrail: updated.enableStructuralTrail,
          enableProfitRatchet: updated.enableProfitRatchet,
          liveSettings: updated,
        });
      }
    };

    window.addEventListener(SR_SETTINGS_CHANGED_EVENT, handleSettingsUpdate);
    return () => {
      window.removeEventListener(SR_SETTINGS_CHANGED_EVENT, handleSettingsUpdate);
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
      const res = await fetch('/api/account', { credentials: 'same-origin' });
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

  // ── 2. On-Mount Database Re-hydration from /api/trades (Namespace Isolated) ──
  useEffect(() => {
    let isMounted = true;

    async function rehydrateFromDatabase() {
      try {
        const res = await fetch('/api/trades', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = await res.json();
        const trades = data.trades || [];

        // STRICT ISOLATION: Only rehydrate trades belonging to Sweep & Reclaim
        const openTrades = trades.filter((t: any) => {
          if (t.status !== 'OPEN' && t.status !== 'STAGE_1_FILLED' && t.status !== 'STAGE_2_FILLED') {
            return false;
          }
          const strat = (t.strategy_name || '').toLowerCase();
          return (
            strat.includes('sweep & reclaim') ||
            strat.includes('s&r') ||
            strat.includes('3-pillar') ||
            strat.includes('failed signal reversal') ||
            strat.includes('auto 2% compounded')
          );
        });

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
      } else if (event.type === 'ORDER_FILLED' && pos?.dbTradeId) {
        dispatchAlert?.('AUTO_ORDER_ROUTED', event.message, '/audio/sweep_alert.mp3', 'STRATEGY_EXECUTION');
      } else if (event.type === 'STAGE_1_HARVEST' || event.type === 'STAGE_2_HARVEST') {
        dispatchAlert?.('STAGE_FILL', event.message, '/audio/objective_update.wav', 'STRATEGY_EXECUTION');
      } else if (event.type === 'POSITION_CLOSED') {
        dispatchAlert?.('SMT_TRAP', event.message, '/audio/flow_state.wav', 'STRATEGY_EXECUTION');
      }

      // ── A. Atomic Trade Entry: POST /api/trades with Rollback Guard ──
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
            credentials: 'same-origin',
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const errorJson = await res.json().catch(() => ({}));
            const errorMsg = errorJson.error || errorJson.message || `HTTP ${res.status}`;
            console.warn('[useAutomatedStrategyExecution] DB Trade creation vetoed/failed, triggering rollback:', errorMsg);
            dispatchAlert?.('SMT_TRAP', `🛡️ [PORTFOLIO GUARD] Order placement vetoed: ${errorMsg}`, undefined, 'STRATEGY_EXECUTION');
            // Atomic rollback on failure
            engineRef.current.rollbackPosition(pos.id, errorMsg);
            setActivePositions([...engineRef.current.getActivePositions()]);
            setPendingOrders([...engineRef.current.getPendingLimitOrders()]);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('trades-refresh'));
            }
            return;
          }

          const data = await res.json();
          const dbId = data.trade_id || data.trade?.id;
          if (dbId) {
            engineRef.current.linkDbTradeId(pos.id, dbId);
            setActivePositions([...engineRef.current.getActivePositions()]);
            // Dispatch verified entry alert after DB confirmation
            dispatchAlert?.('AUTO_ORDER_ROUTED', event.message, '/audio/sweep_alert.mp3', 'STRATEGY_EXECUTION');
          }

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('trades-refresh'));
          }
        } catch (err) {
          console.warn('[useAutomatedStrategyExecution] Network failure during trade creation, rolling back:', err);
          engineRef.current.rollbackPosition(pos.id, 'Network failure during trade entry persistence');
          setActivePositions([...engineRef.current.getActivePositions()]);
          setPendingOrders([...engineRef.current.getPendingLimitOrders()]);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('trades-refresh'));
          }
        }
      }

      // ── B. Progressive Stage Updates: PATCH /api/trades on Stage 1 / 2 ──
      if ((event.type === 'STAGE_1_HARVEST' || event.type === 'STAGE_2_HARVEST') && pos && pos.dbTradeId) {
        try {
          await fetch('/api/trades', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
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
            credentials: 'same-origin',
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

  // ── 4. Multi-Timeframe Background Candle Ingestion (5m, 15m, 1h) ────────────
  const lastProcessedSrCandleRef = useRef<string>('');
  useEffect(() => {
    if (!engineRef.current || !marketData) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const payload = marketData.data_payload || {};
    const candles5m = payload.candles_5m || [];
    const candles15m = payload.candles_15m || [];
    const candles1h = payload.candles_1h || [];

    const key = `${candles5m?.[candles5m.length - 1]?.t}_${candles15m?.[candles15m.length - 1]?.t}_${candles1h?.[candles1h.length - 1]?.t}_${candles5m.length}_${candles15m.length}_${candles1h.length}`;
    if (lastProcessedSrCandleRef.current === key) return;
    lastProcessedSrCandleRef.current = key;

    const ipda = marketData.ipda_metrics || {};
    const macroContext = {
      macroDailyBias: ipda.macro_daily_bias,
      dolDirection: ipda.dol_direction,
      localDealingRange: ipda.pricing_context?.local_dealing_range,
    };

    const res = engineRef.current.onMultiTimeframeCandles(
      {
        '5m': candles5m,
        '15m': candles15m,
        '1h': candles1h,
      },
      macroContext
    );

    setScannedSetups(res.scannedSetups);
    setActivePositions([...engineRef.current.getActivePositions()]);
    setPendingOrders([...engineRef.current.getPendingLimitOrders()]);
    setClosedTrades([...engineRef.current.getClosedPositions()]);
  }, [marketData?.data_payload]);

  // ── 5. Real-Time Market Tick Processing Pipeline (Throttled UI state sync) ──
  const lastSrUiSyncTimeRef = useRef<number>(0);
  const prevSrActiveCountRef = useRef<number>(0);
  const prevSrPendingCountRef = useRef<number>(0);
  const prevSrClosedCountRef = useRef<number>(0);

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
            taker_buy_vol: liveCandle.taker_buy_vol ?? ((liveCandle.volume || 0) * 0.5),
            taker_sell_vol: liveCandle.taker_sell_vol ?? ((liveCandle.volume || 0) * 0.5),
            isClosed: !!liveCandle.isClosed,
          }
        : null;

      engineRef.current.processMarketTick(livePrice, candleAdapter);

      const active = engineRef.current.getActivePositions();
      const pending = engineRef.current.getPendingLimitOrders();
      const closed = engineRef.current.getClosedPositions();

      const activeCountChanged = prevSrActiveCountRef.current !== active.length;
      const pendingCountChanged = prevSrPendingCountRef.current !== pending.length;
      const closedCountChanged = prevSrClosedCountRef.current !== closed.length;

      const now = Date.now();
      const isThrottledSync = (now - lastSrUiSyncTimeRef.current >= 250) && (active.length > 0 || pending.length > 0);

      if (activeCountChanged || pendingCountChanged || closedCountChanged || isThrottledSync) {
        lastSrUiSyncTimeRef.current = now;
        prevSrActiveCountRef.current = active.length;
        prevSrPendingCountRef.current = pending.length;
        prevSrClosedCountRef.current = closed.length;

        setActivePositions([...active]);
        setPendingOrders([...pending]);
        setClosedTrades([...closed]);
      }
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

  const updateSettings = useCallback((partial: Partial<SweepReclaimLiveSettings>) => {
    const next = updateSweepReclaimLiveSettings(partial);
    setEngineConfig(prev => ({
      ...prev,
      compoundingRiskPct: next.compoundingRiskPct ?? prev.compoundingRiskPct,
      stage1Multiple: next.stage1Multiple ?? prev.stage1Multiple,
      stage2Multiple: next.stage2Multiple ?? prev.stage2Multiple,
      stage3Multiple: next.stage3Multiple ?? prev.stage3Multiple,
      enableStructuralTrail: next.enableStructuralTrail ?? prev.enableStructuralTrail,
      enableProfitRatchet: next.enableProfitRatchet ?? prev.enableProfitRatchet,
      liveSettings: next,
    }));
    if (engineRef.current) {
      engineRef.current.updateConfig({
        compoundingRiskPct: next.compoundingRiskPct,
        stage1Multiple: next.stage1Multiple,
        stage2Multiple: next.stage2Multiple,
        stage3Multiple: next.stage3Multiple,
        enableStructuralTrail: next.enableStructuralTrail,
        enableProfitRatchet: next.enableProfitRatchet,
        liveSettings: next,
      });
    }
    return next;
  }, []);

  const srOverlay = useMemo<SweepReclaimOverlayData | null>(() => {
    const activePos = activePositions.length > 0 ? activePositions[0] : null;
    const pendingOrd = pendingOrders.length > 0 ? pendingOrders[0] : null;
    const latestActiveSetup = scannedSetups.length > 0 ? scannedSetups[scannedSetups.length - 1] : null;

    if (!activePos && !pendingOrd && !latestActiveSetup) return null;

    const isBull = activePos
      ? activePos.direction === 'LONG'
      : pendingOrd
      ? pendingOrd.direction === 'LONG'
      : latestActiveSetup?.type === 'BULLISH';

    let phase: SweepReclaimOverlayData['phase'] = 'ANCHOR';
    let statusText = 'Phase 1: Anchor Detected';

    if (activePos) {
      phase = 'OPEN';
      const uR = activePos.unrealizedR ?? 0;
      statusText = `Live Position OPEN (${activePos.direction}) | ${uR > 0 ? '+' : ''}${uR.toFixed(2)}R`;
    } else if (pendingOrd) {
      phase = 'RETEST';
      statusText = `Live Pending Limit Resting @ $${(pendingOrd.limitEntryPrice ?? 0).toFixed(2)}`;
    } else if (latestActiveSetup?.status === 'RETESTED' || latestActiveSetup?.is_retested) {
      phase = 'RETEST';
      statusText = 'Phase 4: Retest Confirmed';
    } else if (latestActiveSetup?.status === 'RECLAIMED_NO_RETEST' || latestActiveSetup?.is_reclaimed) {
      phase = 'RECLAIM';
      statusText = 'Phase 3: 3-Pillar Reclaim Confirmed';
    } else if (latestActiveSetup?.status === 'SWEPT_NO_RECLAIM' || latestActiveSetup?.sweep_index !== null) {
      phase = 'SWEEP';
      statusText = 'Phase 2: Liquidity Swept';
    }

    const entryPrice = activePos?.entryPrice ?? pendingOrd?.limitEntryPrice ?? latestActiveSetup?.entry_price ?? 0;
    const stopLoss = activePos?.activeStopLoss ?? pendingOrd?.activeStopLoss ?? latestActiveSetup?.stop_loss ?? 0;
    const anchorLevel = activePos?.originAnchorLevel ?? pendingOrd?.originAnchorLevel ?? latestActiveSetup?.anchor_level ?? 0;

    return {
      id: activePos?.id ?? pendingOrd?.id ?? latestActiveSetup?.id ?? 'LIVE_SR',
      type: isBull ? 'BULLISH' : 'BEARISH',
      phase,
      anchorName: latestActiveSetup?.anchor_name || (isBull ? 'Bullish Anchor' : 'Bearish Anchor'),
      anchorLevel,
      sweepPrice: latestActiveSetup?.sweep_price ?? null,
      sweepObMt: latestActiveSetup?.sweep_ob_mt ?? null,
      reclaimPrice: latestActiveSetup?.reclaim_close_price ?? null,
      fvgTop: latestActiveSetup?.reclaim_fvg_top ?? null,
      fvgBottom: latestActiveSetup?.reclaim_fvg_bottom ?? null,
      fvgCe: activePos?.fvgCeLevel ?? pendingOrd?.fvgCeLevel ?? latestActiveSetup?.reclaim_fvg_ce ?? null,
      entryPrice,
      stopLoss,
      // FIX-OVERLAY: Include pendingOrd stage targets in the priority chain.
      // Previously, target1/target2 skipped pendingOrd and fell back directly to
      // latestActiveSetup?.stage1_target — an ANCHOR_ONLY placeholder anchored to
      // the session level (~$2425), not the actual entry price. The pending order's
      // stage targets are computed correctly by AutomatedStrategyExecutionEngine
      // (entry ± stageMultiple × riskUsd) and must take priority over the setup placeholder.
      target1: activePos?.stage1Target ?? pendingOrd?.stage1Target ?? latestActiveSetup?.stage1_target ?? 0,
      target2: activePos?.stage2Target ?? pendingOrd?.stage2Target ?? latestActiveSetup?.stage2_target ?? 0,
      target3: activePos?.stage3Target ?? pendingOrd?.dynamicDolTarget ?? pendingOrd?.stage3Target ?? latestActiveSetup?.stage3_target ?? 0,
      volExpansion: latestActiveSetup?.reclaim_volume_expansion ?? 1.0,
      deltaDominance: latestActiveSetup?.reclaim_delta_dominance_pct ?? 50.0,
      bodyRatio: latestActiveSetup?.reclaim_body_ratio ?? 50.0,
      threePillarsPassed: latestActiveSetup?.three_pillar_displacement_passed ?? true,
      isValuationAligned: latestActiveSetup?.is_valuation_aligned ?? true,
      realizedR: activePos?.realizedR ?? 0,
      unrealizedR: activePos?.unrealizedR ?? 0,
      statusText,
      isStage1Filled: activePos?.isStage1Filled ?? false,
      isStage2Filled: activePos?.isStage2Filled ?? false,
      isStage3Filled: activePos?.isStage3Filled ?? false,
      isClosed: false,
    };
  }, [scannedSetups, activePositions, pendingOrders]);

  const riskPct = engineConfig.liveSettings?.compoundingRiskPct ?? engineConfig.compoundingRiskPct ?? 2.0;
  const riskUsd2Pct = parseFloat((accountEquity * (riskPct / 100)).toFixed(2));

  return {
    engineConfig,
    setEngineConfig,
    settings: engineConfig.liveSettings || DEFAULT_SR_LIVE_SETTINGS,
    updateSettings,
    isSweepReclaimAutoExecEnabled: engineConfig.autoExecute,
    toggleAutoExecute,
    activePositions,
    pendingOrders,
    closedTrades,
    scannedSetups,
    srOverlay,
    accountEquity,
    riskUsd2Pct,
    lastEvent,
    submitStrategyOrder,
    emergencyClosePosition,
    moveStopToBreakeven,
    refetchEquity: fetchAccountEquity,
  };
}
