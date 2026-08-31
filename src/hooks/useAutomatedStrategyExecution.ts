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
} from '@/lib/quantEngine/strategyExecutionConfig';
import type { SmartAlert } from '@/hooks/useLiveAlerts';

// Global singleton instance for local multi-timeframe candidate scanning (Active Anchors Matrix)
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
  const { data: marketData, triggerSmartAlert } = useMarketDataContext();
  const { livePrice } = useMarketDataLiveContext();

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
  const [isDaemonActive, setIsDaemonActive] = useState<boolean>(false);

  // ── 1. Daemon-First Live State Polling (Single Source of Truth) ────────────
  // Polls /api/daemon/state every 1000ms to synchronize directly with the PM2 Headless Daemon.
  // Completely eliminates local client-side state divergence and localStorage ghosts.
  const lastEventIdRef = useRef<string | null>(null);

  const fetchDaemonState = useCallback(async () => {
    try {
      const res = await fetch('/api/daemon/state?symbol=ETHUSDC', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return;

      const data = await res.json();
      if (!data.success) return;

      setIsDaemonActive(!!data.isDaemonActive);
      if (typeof data.equity === 'number' && data.equity > 0) {
        setAccountEquity(data.equity);
      }

      // 1. Sync Active In-Flight Positions enriched with real-time price
      const rawActive: StrategyExecutionPosition[] = data.activePositions || [];
      const enrichedActive = rawActive.map((pos) => {
        const curPrice = livePrice || pos.entryPrice;
        const isLong = pos.direction === 'LONG';
        const priceDiff = isLong ? curPrice - pos.entryPrice : pos.entryPrice - curPrice;
        const uR = pos.riskPerContract && pos.riskPerContract > 0 ? priceDiff / pos.riskPerContract : 0;
        const uUsd = pos.contractSize ? priceDiff * pos.contractSize : 0;
        return {
          ...pos,
          unrealizedR: parseFloat(uR.toFixed(4)),
          unrealizedUsd: parseFloat(uUsd.toFixed(2)),
        };
      });
      setActivePositions(enrichedActive);

      // 2. Sync Resting Pending Limit Orders
      setPendingOrders(data.pendingOrders || []);

      // 3. Sync Closed Trades (from today's session & tracker)
      setClosedTrades(data.completedTrades || []);

      // 4. Handle Live Notifications for new Daemon Events
      if (data.lastEvent && data.lastEvent.id !== lastEventIdRef.current) {
        lastEventIdRef.current = data.lastEvent.id;
        const evt = data.lastEvent;
        setLastEvent(evt);

        if (evt.type === 'LIMIT_ORDER_PLACED') {
          dispatchAlert?.('AUTO_ORDER_ROUTED', evt.message, '/audio/fvg_alert.mp3', 'STRATEGY_EXECUTION');
        } else if (evt.type === 'ORDER_FILLED') {
          dispatchAlert?.('AUTO_ORDER_ROUTED', evt.message, '/audio/sweep_alert.mp3', 'STRATEGY_EXECUTION');
        } else if (evt.type === 'STAGE_1_HARVEST' || evt.type === 'STAGE_2_HARVEST') {
          dispatchAlert?.('STAGE_FILL', evt.message, '/audio/objective_update.wav', 'STRATEGY_EXECUTION');
        } else if (evt.type === 'POSITION_CLOSED') {
          dispatchAlert?.('SMT_TRAP', evt.message, '/audio/flow_state.wav', 'STRATEGY_EXECUTION');
        }
      }
    } catch (err) {
      console.warn('[useAutomatedStrategyExecution] Daemon state sync warning:', err);
    }
  }, [livePrice, dispatchAlert]);

  // Periodic polling interval
  useEffect(() => {
    fetchDaemonState();
    const intervalId = setInterval(fetchDaemonState, 1000);
    return () => clearInterval(intervalId);
  }, [fetchDaemonState]);

  // ── 2. Local Candidate Scans for Active Anchors Matrix ─────────────────────
  // Continues ingesting multi-timeframe candles (5m, 15m, 1h) to populate the visual
  // Active Anchors Liquidity Matrix without running rogue trade executions.
  const lastProcessedSrCandleRef = useRef<string>('');
  useEffect(() => {
    if (!engineRef.current || !marketData) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const payload = marketData.data_payload || {};
    const candles5m = (payload.candles_5m || []).filter((c: Candle) => c.isClosed !== false);
    const candles15m = (payload.candles_15m || []).filter((c: Candle) => c.isClosed !== false);
    const candles1h = (payload.candles_1h || []).filter((c: Candle) => c.isClosed !== false);

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

    if (res.scannedSetups) {
      setScannedSetups(res.scannedSetups);
    }
  }, [marketData?.data_payload]);

  // ── 3. Cross-Component Dual Strategy Auto-Exec Synchronization ────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleAutoExecUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<StrategyAutoExecState>;
      const srEnabled = customEvent.detail ? customEvent.detail.isSweepReclaimAutoExecEnabled : getSweepReclaimAutoExec();
      setEngineConfig((prev) => {
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

  // ── 4. Cross-Component S&R Settings Updates ───────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleSettingsUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<SweepReclaimLiveSettings>;
      const updated = customEvent.detail || getSweepReclaimLiveSettings();
      setEngineConfig((prev) => ({
        ...prev,
        compoundingRiskPct: updated.compoundingRiskPct ?? prev.compoundingRiskPct,
        stage2Multiple: updated.stage2Multiple ?? prev.stage2Multiple,
        stage3Multiple: updated.stage3Multiple ?? prev.stage3Multiple,
        enableStructuralTrail: updated.enableStructuralTrail ?? prev.enableStructuralTrail,
        enableProfitRatchet: updated.enableProfitRatchet ?? prev.enableProfitRatchet,
        liveSettings: updated,
      }));
    };

    window.addEventListener(SR_SETTINGS_CHANGED_EVENT, handleSettingsUpdate);
    return () => {
      window.removeEventListener(SR_SETTINGS_CHANGED_EVENT, handleSettingsUpdate);
    };
  }, []);

  // ── 5. UI-to-Daemon Execution Actions (Emergency Flatten / Breakeven Snap) ───
  const emergencyClosePosition = useCallback(async (positionId?: string) => {
    try {
      await fetch('/api/daemon/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'EMERGENCY_FLATTEN',
          positionId,
        }),
      });
      // Immediate optimistic refetch
      setTimeout(fetchDaemonState, 150);
    } catch (err) {
      console.error('[useAutomatedStrategyExecution] Failed to dispatch EMERGENCY_FLATTEN command:', err);
    }
  }, [fetchDaemonState]);

  const moveStopToBreakeven = useCallback(async (positionId: string) => {
    try {
      await fetch('/api/daemon/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SNAP_BREAKEVEN',
          positionId,
        }),
      });
      // Immediate optimistic refetch
      setTimeout(fetchDaemonState, 150);
    } catch (err) {
      console.error('[useAutomatedStrategyExecution] Failed to dispatch SNAP_BREAKEVEN command:', err);
    }
  }, [fetchDaemonState]);

  const toggleAutoExecute = useCallback(async () => {
    const nextState = !engineConfig.autoExecute;
    setSweepReclaimAutoExec(nextState);
    setEngineConfig((prev) => ({ ...prev, autoExecute: nextState }));

    try {
      await fetch('/api/daemon/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'TOGGLE_AUTO_EXEC',
          metadata: { enabled: nextState },
        }),
      });
    } catch (err) {
      console.error('[useAutomatedStrategyExecution] Failed to dispatch TOGGLE_AUTO_EXEC command:', err);
    }
  }, [engineConfig.autoExecute]);

  const updateSettings = useCallback((newSettings: Partial<SweepReclaimLiveSettings>) => {
    const next = updateSweepReclaimLiveSettings(newSettings);
    setEngineConfig((prev) => ({
      ...prev,
      compoundingRiskPct: next.compoundingRiskPct ?? prev.compoundingRiskPct,
      stage2Multiple: next.stage2Multiple ?? prev.stage2Multiple,
      stage3Multiple: next.stage3Multiple ?? prev.stage3Multiple,
      enableStructuralTrail: next.enableStructuralTrail ?? prev.enableStructuralTrail,
      enableProfitRatchet: next.enableProfitRatchet ?? prev.enableProfitRatchet,
      liveSettings: next,
    }));
    return next;
  }, []);

  // ── 6. Live Chart Overlay Generation (`srOverlay`) ────────────────────────
  // Generates the chart overlay strictly based on the live daemon's authoritative active position.
  const srOverlay = useMemo<SweepReclaimOverlayData | null>(() => {
    const activePos = activePositions.length > 0 ? activePositions[0] : null;
    const pendingOrd = pendingOrders.length > 0 ? pendingOrders[0] : null;

    const activeDir = activePos?.direction ?? (pendingOrd?.direction ?? null);
    const activeDirType = activeDir === 'LONG' ? 'BULLISH' : activeDir === 'SHORT' ? 'BEARISH' : null;

    const activeSetupId = activePos?.setupId || activePos?.originZoneId || activePos?.strategyId;
    const pendingSetupId = pendingOrd?.setupId || pendingOrd?.originZoneId || pendingOrd?.strategyId;

    const matchById =
      (activeSetupId ? scannedSetups.find((s) => s.id === activeSetupId) : null) ??
      (pendingSetupId ? scannedSetups.find((s) => s.id === pendingSetupId) : null);

    const matchByAnchorLevel = (activePos?.originAnchorLevel || pendingOrd?.originAnchorLevel)
      ? [...scannedSetups].reverse().find((s) =>
          Math.abs(s.anchor_level - (activePos?.originAnchorLevel ?? pendingOrd?.originAnchorLevel ?? 0)) < 0.50 &&
          (activeDirType ? s.type === activeDirType : true)
        ) ?? null
      : null;

    const matchByDirAndReclaim = activeDirType
      ? [...scannedSetups].reverse().find((s) => s.type === activeDirType && s.is_reclaimed) ?? null
      : null;

    const matchByReclaimAny = [...scannedSetups].reverse().find((s) => s.is_reclaimed) ?? null;

    const latestActiveSetup =
      matchById ??
      matchByAnchorLevel ??
      matchByDirAndReclaim ??
      matchByReclaimAny ??
      (scannedSetups.length > 0 ? scannedSetups[scannedSetups.length - 1] : null);

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
      statusText = `Live Position OPEN (${activePos.direction}) | ${uR >= 0 ? '+' : ''}${uR.toFixed(2)}R`;
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

    const target1 = activePos?.stage1Target ?? pendingOrd?.stage1Target ?? latestActiveSetup?.stage1_target ?? (isBull ? entryPrice + riskUsd : entryPrice - riskUsd);
    const target2 = activePos?.stage2Target ?? pendingOrd?.stage2Target ?? latestActiveSetup?.stage2_target ?? (isBull ? entryPrice + 1.4 * riskUsd : entryPrice - 1.4 * riskUsd);
    const target3 = activePos?.stage3Target ?? pendingOrd?.stage3Target ?? latestActiveSetup?.stage3_target ?? (isBull ? entryPrice + 3.0 * riskUsd : entryPrice - 3.0 * riskUsd);

    const displacementCandles =
      activePos?.displacementCandles ??
      pendingOrd?.displacementCandles ??
      latestActiveSetup?.displacement_candles;

    const sweepPrice =
      activePos?.sweepPrice ??
      pendingOrd?.sweepPrice ??
      latestActiveSetup?.sweep_price ??
      null;

    const reclaimPrice =
      activePos?.reclaimPrice ??
      pendingOrd?.reclaimPrice ??
      latestActiveSetup?.reclaim_close_price ??
      null;

    const volExpansion =
      activePos?.volExpansion ??
      pendingOrd?.volExpansion ??
      latestActiveSetup?.reclaim_volume_expansion ??
      (isPositionOpen ? 2.0 : 1.0);

    const deltaDominance =
      activePos?.deltaDominance ??
      pendingOrd?.deltaDominance ??
      latestActiveSetup?.reclaim_delta_dominance_pct ??
      (isPositionOpen ? 60.0 : 50.0);

    const bodyRatio =
      activePos?.bodyRatio ??
      pendingOrd?.bodyRatio ??
      latestActiveSetup?.reclaim_body_ratio ??
      (isPositionOpen ? 65.0 : 50.0);

    const threePillarsPassed =
      activePos?.threePillarsPassed ??
      pendingOrd?.threePillarsPassed ??
      latestActiveSetup?.three_pillar_displacement_passed ??
      (isPositionOpen ? true : false);

    const anchorName =
      activePos?.anchorName ||
      pendingOrd?.anchorName ||
      latestActiveSetup?.anchor_name ||
      (isBull ? 'Bullish Anchor' : 'Bearish Anchor');

    return {
      id: activePos?.id ?? pendingOrd?.id ?? latestActiveSetup?.id ?? 'LIVE_SR',
      type: isBull ? 'BULLISH' : 'BEARISH',
      phase,
      anchorName,
      anchorLevel,
      sweepPrice,
      sweepObMt: latestActiveSetup?.sweep_ob_mt ?? null,
      reclaimPrice,
      fvgTop: latestActiveSetup?.reclaim_fvg_top ?? null,
      fvgBottom: latestActiveSetup?.reclaim_fvg_bottom ?? null,
      fvgCe: activePos?.fvgCeLevel ?? pendingOrd?.fvgCeLevel ?? latestActiveSetup?.reclaim_fvg_ce ?? null,
      entryPrice,
      stopLoss,
      target1,
      target2,
      target3,
      volExpansion,
      deltaDominance,
      bodyRatio,
      threePillarsPassed,
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
      displacementCandles,
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
    isDaemonActive,
    emergencyClosePosition,
    moveStopToBreakeven,
    refetchEquity: fetchDaemonState,
  };
}
