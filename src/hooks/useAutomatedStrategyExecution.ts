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
import { useSessionJournalStore, type SessionTradeStatus } from '@/lib/quantEngine/sessionJournalStore';

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

  // ── 2. On-Mount In-Memory & Database Re-hydration (Namespace Isolated) ──
  useEffect(() => {
    let isMounted = true;

    async function rehydrateSessionAndDb() {
      try {
        // 1. Rehydrate first from instant local session journal
        const localTrades = useSessionJournalStore.getState().getTradesByMode('LIVE');
        const openLocalTrades = localTrades.filter(
          (t) => t.status === 'OPEN' || t.status === 'STAGE_1_FILLED' || t.status === 'STAGE_2_FILLED'
        );

        if (openLocalTrades.length > 0 && engineRef.current && isMounted) {
          const rehydrated = engineRef.current.rehydrateOpenPositions(openLocalTrades as any);
          if (rehydrated.length > 0) {
            setActivePositions([...engineRef.current.getActivePositions()]);
            setPendingOrders([...engineRef.current.getPendingLimitOrders()]);
            setClosedTrades([...engineRef.current.getClosedPositions()]);
          }
        }

        // 2. Non-blocking background sync from cloud database if available
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
        console.warn('[useAutomatedStrategyExecution] On-mount DB re-hydration warning (offline safe):', err);
      }
    }

    rehydrateSessionAndDb();
    return () => {
      isMounted = false;
    };
  }, []);

  // ── 3. Subscribe to Engine Lifecycle Events & Local Session Journal ────
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

      // ── A. Instant Local Session Journal Entry: addTrade ──
      if (event.type === 'ORDER_FILLED' && pos) {
        // Record in fast reactive in-memory store immediately
        const journalTrade = useSessionJournalStore.getState().addTrade({
          id: pos.id,
          symbol: pos.symbol,
          direction: pos.direction,
          strategy_name: pos.strategyName,
          ai_narrative_summary: `[Auto 2% Compounded 3-Stage Harvest] ${event.message}`,
          entry_price: pos.entryPrice,
          stop_loss: pos.initialStopLoss,
          take_profit: pos.stage3Target,
          status: 'OPEN',
          mode: 'LIVE',
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
        });

        // Fire-and-forget non-blocking background sync to cloud DB
        fetch('/api/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
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
            ipda_metrics: journalTrade.ipda_metrics,
          }),
        })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json();
              const dbId = data.trade_id || data.trade?.id;
              if (dbId && engineRef.current) {
                engineRef.current.linkDbTradeId(pos.id, dbId);
              }
            }
          })
          .catch((err) => {
            console.debug('[useAutomatedStrategyExecution] Background cloud DB sync skipped (in-memory preserved):', err);
          });
      }

      // ── B. Instant Local Session Stage Updates: updateTrade on Stage 1 / 2 ──
      if ((event.type === 'STAGE_1_HARVEST' || event.type === 'STAGE_2_HARVEST') && pos) {
        useSessionJournalStore.getState().updateTrade(pos.id, {
          status: pos.status as unknown as SessionTradeStatus,
          stop_loss: pos.activeStopLoss,
          realized_pnl: pos.realizedUsd,
          realized_r: pos.realizedR,
          ai_narrative_summary: `[${pos.status}] ${event.message}`,
        });

        // Fire-and-forget background cloud sync
        if (pos.dbTradeId) {
          fetch('/api/trades', {
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
          }).catch(() => {});
        }
      }

      // ── C. Instant Local Session Trade Closure: closeTrade ──
      if (event.type === 'POSITION_CLOSED' && pos) {
        const exitPrice = pos.exitPrice ?? (pos.direction === 'LONG' ? pos.activeStopLoss : pos.activeStopLoss);
        useSessionJournalStore.getState().closeTrade(
          pos.id,
          exitPrice,
          pos.exitReason || 'CLOSED',
          new Date(pos.closeTime || Date.now()).toISOString()
        );

        // Update equity directly in session journal store
        if (pos.realizedUsd) {
          setAccountEquity((prev) => {
            const next = parseFloat((prev + pos.realizedUsd).toFixed(2));
            if (engineRef.current) engineRef.current.setAccountEquity(next);
            return next;
          });
        }

        // Fire-and-forget background cloud sync
        if (pos.dbTradeId) {
          fetch('/api/trades', {
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
          }).catch(() => {});
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [dispatchAlert]);

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

  // ── 5. BUG-4 FIX: 3-Day Cold-Start Historical State Reconciliation ───────────
  // On initial mount AND every time the browser tab regains focus:
  //   1. Fetch the preceding 72h of 15m candles (288 bars × 15min) from the
  //      market-data endpoint using poll=false to bypass delta-diffing.
  //   2. Re-run the engine's multi-timeframe candle ingestion pass so the
  //      candidate pool is rebuilt from real closed-bar history.
  //   3. Sync all UI state slices to reflect the reconciled candidate queue.
  //
  // This eliminates the environment divergence between:
  //   - Local dev: persistent Node.js process keeps in-memory candidates across
  //     hot reloads and browser refreshes.
  //   - Vercel production: ephemeral serverless Lambdas restart with no memory,
  //     forcing a fresh scan from the live API on every cold start.
  //
  // After reconciliation, stale/mitigated historical candidates (whose entry
  // zones have already been traded through or whose maxBarsToRetest TTL has
  // expired) are correctly excluded from the active pending setup queue.
  const reconciliationRunRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    async function run3DayHistoricalReconciliation() {
      if (!engineRef.current) return;

      // Prevent concurrent reconciliation runs
      if (reconciliationRunRef.current) return;
      reconciliationRunRef.current = true;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s hard timeout

      try {
        // Fetch 288 × 15m bars = 72h of history (matching the 3-day directive)
        // poll=false bypasses the delta-diffing path and returns a full payload.
        const res = await fetch(
          '/api/market-data?interval=15m&limit=288&poll=false',
          { signal: controller.signal, credentials: 'same-origin' }
        );
        clearTimeout(timeoutId);

        if (!res.ok) return;

        const json = await res.json();
        const payload = json?.data_payload || {};
        const candles15m: Candle[] = payload.candles_15m || [];

        // Guard: need at least 20 bars for the engine to produce meaningful output
        if (candles15m.length < 20) return;

        // Re-run ingestion using the historical 15m slice as the structural anchor.
        // 5m and 1h slices are optional for reconciliation — 15m is the primary
        // structural frame for the Sweep & Reclaim strategy.
        const ipda = json?.ipda_metrics || {};
        const macroContext = {
          macroDailyBias: ipda.macro_daily_bias,
          dolDirection: ipda.dol_direction,
          localDealingRange: ipda.pricing_context?.local_dealing_range,
        };

        const res2 = engineRef.current.onMultiTimeframeCandles(
          { '15m': candles15m },
          macroContext
        );

        setScannedSetups(res2.scannedSetups);
        setActivePositions([...engineRef.current.getActivePositions()]);
        setPendingOrders([...engineRef.current.getPendingLimitOrders()]);
        setClosedTrades([...engineRef.current.getClosedPositions()]);

        console.debug(
          `[3DayReconciliation] Synchronized: ${res2.scannedSetups.length} setups from ${candles15m.length} historical 15m bars`
        );
      } catch (err: unknown) {
        // AbortError is expected on timeout — not a critical failure
        if ((err as Error)?.name !== 'AbortError') {
          console.warn('[3DayReconciliation] Non-blocking reconciliation warning:', err);
        }
      } finally {
        reconciliationRunRef.current = false;
      }
    }

    // 1. Run immediately on mount
    run3DayHistoricalReconciliation();

    // 2. Subscribe to browser tab visibility change
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Tab just became visible (user switched back) — re-reconcile
        run3DayHistoricalReconciliation();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Mount-only — visibilitychange listener handles all subsequent triggers

  // ── 6. Real-Time Market Tick Processing Pipeline (Throttled UI state sync) ──
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

    const isPositionOpen = !!activePos && activePos.status !== 'CLOSED';
    const entryPrice = activePos?.entryPrice ?? pendingOrd?.limitEntryPrice ?? latestActiveSetup?.entry_price ?? 0;
    const stopLoss = activePos?.activeStopLoss ?? pendingOrd?.activeStopLoss ?? latestActiveSetup?.stop_loss ?? 0;
    const anchorLevel = activePos?.originAnchorLevel ?? pendingOrd?.originAnchorLevel ?? latestActiveSetup?.anchor_level ?? 0;
    const riskUsd = activePos?.riskUsd ?? pendingOrd?.riskUsd ?? latestActiveSetup?.risk_usd ?? Math.abs(entryPrice - stopLoss);
    const riskPct = activePos?.riskPct ?? pendingOrd?.riskPct ?? latestActiveSetup?.risk_pct ?? (engineConfig.liveSettings?.compoundingRiskPct ?? 2.0);

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
      isPositionOpen,
      riskUsd,
      riskPct,
      displacementCandles: latestActiveSetup?.displacement_candles,
      anchorTime: latestActiveSetup?.anchor_time,
      sweepTime: latestActiveSetup?.sweep_time ?? undefined,
      reclaimTime: latestActiveSetup?.reclaim_time ?? undefined,
    };
  }, [scannedSetups, activePositions, pendingOrders, engineConfig.liveSettings?.compoundingRiskPct]);

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
