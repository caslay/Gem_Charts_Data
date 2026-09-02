'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries, SeriesMarker, createSeriesMarkers, ISeriesMarkersPluginApi, LineStyle, CrosshairMode } from 'lightweight-charts';
import { Candle, MarketDataPayload } from '@/hooks/useMarketData';
import { generateVolumetricMarkers } from '@/utils/generateChartMarkers';
import type { LiveCandle } from '@/hooks/useBinanceWS';
import SettingsModal, { Alert } from './modals/SettingsModal';
import { AlertSound, useAlertSounds } from '@/hooks/useAlertSounds';
import { Volume2, X, Info, Sparkles, Activity, ShieldCheck } from 'lucide-react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import { useTheme } from 'next-themes';
import { registry } from '@/lib/chartLayers/registry';
import { useLayerStore } from '@/lib/chartLayers/store';
import ChartLayerHud from './ChartLayerHud';
import { useDrawings } from '@/hooks/useDrawings';
import DrawingCanvasOverlay from './drawings/DrawingCanvasOverlay';
import DrawingToolbar from './drawings/DrawingToolbar';
import type { SweepReclaimOverlayData } from '@/hooks/useBacktestStrategyExecution';
// Imports of detectActiveFVGs, mapAndConsolidateFVGs, and analyzeMarketStructure removed to prevent main-thread blocking calculations

function findCandleByTime(candles: Candle[] | undefined, targetSec: number): Candle | undefined {
  if (!candles || candles.length === 0) return undefined;
  let low = 0;
  let high = candles.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const midSec = Math.floor(candles[mid].t / 1000);
    if (midSec === targetSec) return candles[mid];
    if (midSec < targetSec) low = mid + 1;
    else high = mid - 1;
  }
  return undefined;
}

interface ChartProps {
  data: Candle[];
  activeFvgs?: any[];
  localDealingRange?: any;
  /** Binance kline interval — must match the selected timeframe in the parent */
  interval?: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h';
  colors?: {
    backgroundColor?: string;
    textColor?: string;
    upColor?: string;
    downColor?: string;
  };
  isBacktest?: boolean;
  marketContextData?: MarketDataPayload | null;
  liveCandle?: LiveCandle | null;
  livePrice?: number | null;
  themeSettings?: any;
  triggerSmartAlert?: (type: any, message: string, sound?: string) => void;
  loadMoreHistory?: () => Promise<void>;
  isFetchingMore?: boolean;
  isManualTradingActive?: boolean;
  manualOrderType?: 'MARKET' | 'LIMIT' | 'STOP';
  manualDirection?: 'LONG' | 'SHORT';
  manualEntryPrice?: number | null;
  manualTakeProfit?: number | null;
  manualStopLoss?: number | null;
  onManualPricesChange?: (entry: number, tp: number, sl: number) => void;
  openTrades?: any[];
  onUpdateTradeLevels?: (tradeId: string, tp: number | null, sl: number | null) => Promise<void>;
  symbol?: string;
  srOverlay?: SweepReclaimOverlayData | null;
}

export default function Chart({
  data,
  activeFvgs: propsActiveFvgs,
  localDealingRange: propsLocalDealingRange,
  interval = '5m',
  colors,
  isBacktest = false,
  marketContextData: propsMarketContextData,
  liveCandle: propsLiveCandle,
  livePrice: propsLivePrice,
  themeSettings: propsThemeSettings,
  triggerSmartAlert: propsTriggerSmartAlert,
  loadMoreHistory: propsLoadMoreHistory,
  isFetchingMore: propsIsFetchingMore,
  isManualTradingActive = false,
  manualOrderType = 'MARKET',
  manualDirection = 'LONG',
  manualEntryPrice = null,
  manualTakeProfit = null,
  manualStopLoss = null,
  onManualPricesChange,
  openTrades = [],
  onUpdateTradeLevels,
  symbol = 'ETHUSDC',
  srOverlay = null,
}: ChartProps) {
  const { theme } = useTheme();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const seriesMarkersRef = useRef<ISeriesMarkersPluginApi<any> | null>(null);
  const isInitialLoad = useRef(true);
  const [localCandles, setLocalCandles] = useState<Candle[]>(data);
  const localCandlesRef = useRef(localCandles);
  const dataRef = useRef(data);

  // Manual Trading Price Line Refs
  const manualEntryLineRef = useRef<any | null>(null);
  const manualTpLineRef = useRef<any | null>(null);
  const manualSlLineRef = useRef<any | null>(null);

  // Zustand persistent chart layer store visibility states
  const { visibility } = useLayerStore();
  const layerStorageRef = useRef<Map<string, Map<string, any>>>(new Map());
  
  // Tracking refs to detect configuration and theme changes to trigger layer re-renders
  const prevVisibilityRef = useRef<Record<string, boolean> | null>(null);
  const prevThemeRef = useRef<string | undefined>(undefined);
  const prevThemeSettingsRef = useRef<any>(null);
  const prevEngineSettingsRef = useRef<any>(null);

  // Refs for Closed-Candle Memoization Barrier, HTML layer caching, and prepend tracking
  const lastClosedTRef = useRef<number | null>(null);
  const lastVisibleRangeRef = useRef<{ from: number; to: number } | null>(null);
  const htmlLayerCacheRef = useRef<Record<string, React.ReactNode>>({});
  const prevFirstCandleTimeRef = useRef<number | null>(null);
  const lastDataPayloadRef = useRef<any>(null);

  const getLayerStorage = useCallback((layerId: string) => {
    if (!layerStorageRef.current.has(layerId)) {
      layerStorageRef.current.set(layerId, new Map());
    }
    return layerStorageRef.current.get(layerId)!;
  }, []);

  // Sync data prop to local state with content-equality diffing
  useEffect(() => {
    if (!data) return;
    setLocalCandles((prev) => {
      if (prev === data) return prev;
      if (prev.length === 0 && data.length === 0) return prev;
      if (prev.length === data.length && prev.length > 0) {
        const prevLast = prev[prev.length - 1];
        const dataLast = data[data.length - 1];
        if (
          prevLast.t === dataLast.t &&
          prevLast.c === dataLast.c &&
          prevLast.v === dataLast.v &&
          prev[0].t === data[0].t
        ) {
          return prev; // Candle series content is identical, preserve state reference!
        }
      }
      return data;
    });
  }, [data]);

  // Sync local state to refs
  useEffect(() => {
    localCandlesRef.current = localCandles;
    dataRef.current = localCandles;
  }, [localCandles]);

  // Reset initial load zoom anchor on timeframe/interval switches
  useEffect(() => {
    isInitialLoad.current = true;
  }, [interval]);

  // ── User Drawing Tools Suite ──────────────────────────────────────────────
  const {
    drawings: userDrawings,
    selectedDrawingId: selectedDrawingId,
    activeTool: activeDrawingTool,
    toolStyles: drawingToolStyles,
    isGlobalVisible: isDrawingsVisible,
    setActiveTool: setActiveDrawingTool,
    setSelectedDrawingId: setSelectedDrawingId,
    setToolStyle: setDrawingToolStyle,
    updateSelectedDrawingStyle,
    addDrawing: addUserDrawing,
    updateDrawing: updateUserDrawing,
    deleteDrawing: deleteUserDrawing,
    clearDrawings: clearUserDrawings,
    duplicateDrawing: duplicateUserDrawing,
    toggleLock: toggleDrawingLock,
    toggleGlobalVisibility: toggleDrawingsVisibility,
    undo: undoDrawing,
    redo: redoDrawing,
  } = useDrawings({
    symbol,
    interval,
    enabled: true,
  });

  // ── Phase 1: Alerts State & Interaction Refs ──────────────────────────────
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [alertLabelPositions, setAlertLabelPositions] = useState<{ id: string; y: number; price: number; color: string; status: 'active' | 'triggered' }[]>([]);

  // Countdown timer for current candle
  const countdownRef = useRef<HTMLDivElement>(null);
  const [countdownText, setCountdownText] = useState<string>('');
  const [hudPulse, setHudPulse] = useState<'BULLISH' | 'BEARISH' | null>(null);

  // V8.6 — FVG Overlay: pixel-mapped anchored rectangles for unmitigated FVG zones
  const [fvgOverlayBoxes, setFvgOverlayBoxes] = useState<{
    key: string;
    top: number;
    height: number;
    left: number;
    width: number;
    isBullish: boolean;
  }[]>([]);
  const [hoveredCandle, setHoveredCandle] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null>(null);

  // Magnet Cursor Snapping States (Disabled by default per user request)
  const [isSnapEnabled, setIsSnapEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gem_chart_snap_enabled');
      if (saved !== null) return saved === 'true';
    }
    return false; // Disabled by default
  });

  const [snapTarget, setSnapTarget] = useState<'CLOSE' | 'HIGH' | 'LOW' | 'OPEN' | 'NEAREST'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gem_chart_snap_target');
      if (saved && ['CLOSE', 'HIGH', 'LOW', 'OPEN', 'NEAREST'].includes(saved)) {
        return saved as any;
      }
    }
    return 'CLOSE';
  });

  const [snappedPrice, setSnappedPrice] = useState<number | null>(null);
  const [snapNotification, setSnapNotification] = useState<string | null>(null);
  const [isSnapDropdownOpen, setIsSnapDropdownOpen] = useState(false);
  const [isAuditPopoverOpen, setIsAuditPopoverOpen] = useState(false);

  const isSnapEnabledRef = useRef(isSnapEnabled);
  isSnapEnabledRef.current = isSnapEnabled;
  const snapTargetRef = useRef(snapTarget);
  snapTargetRef.current = snapTarget;

  // Keyboard shortcut effect for Magnet Snapping (Key: 'S')
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setIsSnapEnabled((prev) => {
          const next = !prev;
          try {
            localStorage.setItem('gem_chart_snap_enabled', String(next));
          } catch {}
          setSnapNotification(next ? `Magnet Snap: ON (${snapTarget})` : 'Magnet Snap: OFF');
          setTimeout(() => setSnapNotification(null), 1800);
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [snapTarget]);

  // Sync crosshair mode options on chartRef when isSnapEnabled changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        crosshair: {
          mode: isSnapEnabled ? CrosshairMode.Magnet : CrosshairMode.Normal,
        },
      });
    }
  }, [isSnapEnabled]);

  // Unified modal overlay triggers
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<'price' | 'signal'>('price');

  const { playSound, playFile } = useAlertSounds();
  const context = useMarketDataContext();

  const marketContextData = propsMarketContextData !== undefined ? propsMarketContextData : context.data;
  const themeSettings = propsThemeSettings !== undefined ? propsThemeSettings : context.themeSettings;
  const { wsInterval, triggerAiAnalysisScan, signalAlerts, signalAlertsEnabled, triggerSmartAlert: contextTriggerSmartAlert, setWsInterval, loadMoreHistory: contextLoadMoreHistory, isFetchingMore: contextIsFetchingMore, structureState: liveStructureState, contextAnchorTimestamp: liveContextAnchorTimestamp } = context;
  const triggerSmartAlert = propsTriggerSmartAlert !== undefined ? propsTriggerSmartAlert : contextTriggerSmartAlert;
  const loadMoreHistory = propsLoadMoreHistory !== undefined ? propsLoadMoreHistory : contextLoadMoreHistory;
  const isFetchingMore = propsIsFetchingMore !== undefined ? propsIsFetchingMore : contextIsFetchingMore;

  const structureState = isBacktest
    ? marketContextData?.ipda_metrics?.full_structure_map
    : liveStructureState;

  const contextAnchorTimestamp = isBacktest
    ? (marketContextData?.ipda_metrics?.full_structure_map?.swings?.[0]?.t ?? null)
    : liveContextAnchorTimestamp;

  const activeFvgs = propsActiveFvgs !== undefined ? propsActiveFvgs : (marketContextData?.ipda_metrics?.active_fvgs || []);
  const localDealingRange = propsLocalDealingRange !== undefined ? propsLocalDealingRange : marketContextData?.ipda_metrics?.pricing_context?.local_dealing_range;

  const smtContext = marketContextData?.ipda_metrics?.smt_context;
  const hasMicroDivergence = 
    (smtContext?.m5_divergence && smtContext.m5_divergence !== 'NONE') ||
    (smtContext?.m15_divergence && smtContext.m15_divergence !== 'NONE');

  // Load alerts from localStorage on initial client mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('gem_alerts_data');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setAlerts(parsed);
        }
      }
    } catch (e) {
      console.error('[Chart] Failed to load alerts from localStorage:', e);
    }
  }, []);

  // Sync alerts back to localStorage on state changes
  useEffect(() => {
    try {
      localStorage.setItem('gem_alerts_data', JSON.stringify(alerts));
    } catch (e) {
      console.error('[Chart] Failed to save alerts to localStorage:', e);
    }
  }, [alerts]);

  // ── Difference Engine (Diff Engine) for Algorithmic Events ──────────────
  const prevDataRef = useRef<any>(null);
  // Cooldown map to prevent alert bursts from the Diff Engine
  const diffCooldownsRef = useRef<Record<string, number>>({});
  const checkDiffCooldown = (key: string, cooldownMs: number): boolean => {
    const now = Date.now();
    const last = diffCooldownsRef.current[key] ?? 0;
    if (now - last >= cooldownMs) {
      diffCooldownsRef.current[key] = now;
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!marketContextData || !signalAlerts) return;

    // Helper: generate FVG unique hash key
    const makeFvgKey = (fvg: any) => `${fvg.timeframe}_${fvg.type}_${fvg.top}_${fvg.bottom}_${fvg.origin_time}`;
    // Helper: generate SMT unique hash key
    const makeSmtKey = (smt: any) => `${smt.time1}_${smt.time2}_${smt.price}`;

    const prevData = prevDataRef.current;

    if (prevData) {
      const prevMetrics = prevData.ipda_metrics || {};
      const currMetrics = marketContextData.ipda_metrics || {};

      const prevTimeWindow = prevMetrics.current_time_window;
      const currTimeWindow = currMetrics.current_time_window;
      const prevStatus = prevMetrics.target_status || '';
      const currStatus = currMetrics.target_status || '';

      // 1. FVG Watcher — cooldown 2 min
      const prevFvgs = prevMetrics.active_fvgs || [];
      const currFvgs = currMetrics.active_fvgs || [];

      const prevFvgKeys = new Set(prevFvgs.map(makeFvgKey));

      const hasNewFvg = currFvgs.some((fvg: any) => {
        const key = makeFvgKey(fvg);
        return !prevFvgKeys.has(key);
      });

      const isFvgEnabled = signalAlertsEnabled ? signalAlertsEnabled.FVG_DETECTION !== false : true;

      if (hasNewFvg && isFvgEnabled && checkDiffCooldown('FVG_DETECTION', 2 * 60 * 1000)) {
        if (signalAlerts.FVG_DETECTION) playFile(signalAlerts.FVG_DETECTION);
        if (triggerSmartAlert) {
          const newFvgObj = currFvgs.find((fvg: any) => !prevFvgKeys.has(makeFvgKey(fvg)));
          const detail = newFvgObj
            ? `${newFvgObj.type} FVG on ${newFvgObj.timeframe} [${newFvgObj.bottom.toFixed(2)} - ${newFvgObj.top.toFixed(2)}]`
            : 'New Fair Value Gap formed';
          triggerSmartAlert('FLOW_STATE', `🚨 FVG DETECTION: ${detail}`);
        }
      }

      // 2. Displacement Watcher — cooldown 3 min
      const prevDisp = prevMetrics.order_flow_engine?.displacement_sponsorship === 'ACTIVE';
      const currDisp = currMetrics.order_flow_engine?.displacement_sponsorship === 'ACTIVE';

      const isDispEnabled = signalAlertsEnabled ? signalAlertsEnabled.DISPLACEMENT_CONFIRMED !== false : true;

      if (!prevDisp && currDisp && isDispEnabled && checkDiffCooldown('DISPLACEMENT_CONFIRMED', 3 * 60 * 1000)) {
        if (signalAlerts.DISPLACEMENT_CONFIRMED) playFile(signalAlerts.DISPLACEMENT_CONFIRMED);
        if (triggerSmartAlert) {
          triggerSmartAlert('FLOW_STATE', `🌊 FLOW STATE: Displacement Confirmed (Institutional Sponsorship Active)`);
        }
      }

      // 3. SMT Watcher — cooldown 5 min
      const prevSmts = prevMetrics.smt_traps || [];
      const currSmts = currMetrics.smt_traps || [];

      const prevSmtKeys = new Set(prevSmts.map(makeSmtKey));

      const hasNewSmt = currSmts.some((smt: any) => {
        const key = makeSmtKey(smt);
        return !prevSmtKeys.has(key);
      });

      const isSmtEnabled = signalAlertsEnabled ? signalAlertsEnabled.SMT_TRAP_ACTIVE !== false : true;

      if (hasNewSmt && isSmtEnabled && checkDiffCooldown('SMT_TRAP_ACTIVE', 5 * 60 * 1000)) {
        if (signalAlerts.SMT_TRAP_ACTIVE) playFile(signalAlerts.SMT_TRAP_ACTIVE);
        if (triggerSmartAlert) {
          const newSmtObj = currSmts.find((smt: any) => !prevSmtKeys.has(makeSmtKey(smt)));
          const detail = newSmtObj
            ? `Equal Highs/Lows engineered near ${newSmtObj.price.toFixed(2)}`
            : 'Equal Highs/Lows engineered';
          triggerSmartAlert('SMT_TRAP', `📉 SMT TRAP ACTIVE: ${detail}`);
        }
      }

      // 4. Target/DOL Exhaustion Watcher — cooldown 15 min
      const prevExhausted = prevStatus.includes('EXHAUSTED');
      const currExhausted = currStatus.includes('EXHAUSTED');

      const isDolEnabled = signalAlertsEnabled ? signalAlertsEnabled.DOL_EXHAUSTED !== false : true;

      if (!prevExhausted && currExhausted && isDolEnabled && checkDiffCooldown('DOL_EXHAUSTED', 15 * 60 * 1000)) {
        if (signalAlerts.DOL_EXHAUSTED) playFile(signalAlerts.DOL_EXHAUSTED);
        if (triggerSmartAlert) {
          triggerSmartAlert('OBJECTIVE_UPDATE', `🎯 OBJECTIVE UPDATE: Daily Objective targets reached (Liquidity Swept)!`);
        }
      }

      // 5. Session Transition Watcher — cooldown 15 min
      const isSessionEnabled = signalAlertsEnabled ? signalAlertsEnabled.SESSION_TRANSITION !== false : true;
      if (prevTimeWindow && currTimeWindow && prevTimeWindow !== currTimeWindow && isSessionEnabled && checkDiffCooldown(`SESSION_${currTimeWindow}`, 15 * 60 * 1000)) {
        if (signalAlerts.SESSION_TRANSITION) playFile(signalAlerts.SESSION_TRANSITION);
        if (triggerSmartAlert) {
          triggerSmartAlert('SESSION_TRANSITION', `🕒 SESSION TRANSITION: Entering ${currTimeWindow}`);
        }
      }

      // 6. Pricing Shift Watcher — cooldown 5 min
      const prevPricing = prevMetrics.pricing_context?.local_dealing_range?.current_status;
      const currPricing = currMetrics.pricing_context?.local_dealing_range?.current_status;
      const isPricingEnabled = signalAlertsEnabled ? signalAlertsEnabled.PRICING_SHIFT !== false : true;
      if (prevPricing && currPricing && prevPricing !== currPricing && isPricingEnabled && checkDiffCooldown('PRICING_SHIFT', 5 * 60 * 1000)) {
        if (signalAlerts.PRICING_SHIFT) playFile(signalAlerts.PRICING_SHIFT);
        if (triggerSmartAlert) {
          triggerSmartAlert('PRICING_SHIFT', `⚖️ PRICING CROSSOVER [${interval}]: Market shifted to ${currPricing}`);
        }
      }

      // 7. Liquidity Sweep Watcher — cooldown 5 min
      const sweepKeywords = ['ASIAN_HIGH_SWEPT', 'ASIAN_LOW_SWEPT', 'LONDON_HIGH_SWEPT', 'LONDON_LOW_SWEPT'];
      const newSweeps = sweepKeywords.filter(keyword =>
        currStatus.includes(keyword) && !prevStatus.includes(keyword)
      );
      const isSweepEnabled = signalAlertsEnabled ? signalAlertsEnabled.SWEEP_ALERT !== false : true;
      if (newSweeps.length > 0 && isSweepEnabled && checkDiffCooldown('SWEEP_ALERT', 5 * 60 * 1000)) {
        if (signalAlerts.SWEEP_ALERT) playFile(signalAlerts.SWEEP_ALERT);
        if (triggerSmartAlert) {
          triggerSmartAlert('PURGE', `🧹 SWEEP ALERT: Intraday range swept - ${newSweeps.join(', ')}`);
        }
      }

      // 9. Flow State Trend Shift Watcher — cooldown 10 min
      const prevTrend = prevMetrics.order_flow_engine?.open_interest_trend;
      const currTrend = currMetrics.order_flow_engine?.open_interest_trend;
      const isFlowEnabled = signalAlertsEnabled ? signalAlertsEnabled.FLOW_STATE_CHANGE !== false : true;
      if (prevTrend && currTrend && prevTrend !== currTrend && isFlowEnabled && checkDiffCooldown('FLOW_STATE_CHANGE', 10 * 60 * 1000)) {
        if (signalAlerts.FLOW_STATE_CHANGE) playFile(signalAlerts.FLOW_STATE_CHANGE);
        if (triggerSmartAlert) {
          triggerSmartAlert('FLOW_STATE', `🌊 FLOW STATE TREND: Open Interest momentum is now ${currTrend}`);
        }
      }

      // 10. Dead Zone Restriction Watcher — cooldown 60 min
      const isDeadZoneEnabled = signalAlertsEnabled ? signalAlertsEnabled.DEAD_ZONE_ENTER !== false : true;
      if (currTimeWindow === 'DEAD_ZONE' && prevTimeWindow !== 'DEAD_ZONE' && isDeadZoneEnabled && checkDiffCooldown('DEAD_ZONE_ENTER', 60 * 60 * 1000)) {
        if (signalAlerts.DEAD_ZONE_ENTER) playFile(signalAlerts.DEAD_ZONE_ENTER);
        if (triggerSmartAlert) {
          triggerSmartAlert('DEAD_ZONE', `🔕 DEAD ZONE: Entering NY mid-day pause. Structural alerts muted.`);
        }
      }
    }

    // Always update prevDataRef
    prevDataRef.current = marketContextData;
  }, [marketContextData, signalAlerts, signalAlertsEnabled, playFile, triggerSmartAlert]);

  // Placement Mode states
  const [isHoveringPriceScale, setIsHoveringPriceScale] = useState(false);
  const [isHotkeyAlertModeActive, setIsHotkeyAlertModeActive] = useState(false);

  // Refs for lightweight-charts integration
  const ghostPriceRef = useRef<number | null>(null);
  const ghostLineRef = useRef<any | null>(null);
  const priceLinesRef = useRef<Map<string, any>>(new Map());
  const cursorTimeRef = useRef<number | null>(null);

  // ── Phase 2: Live Tick Hook ──────────────────────────────────────────────
  // GUARDRAIL: `liveCandle` is consumed ONLY by the .update() effect below.
  // It is NEVER pushed into the `data` array or any state that feeds the AI JSON.
  // WebSocket data is now consumed from the global MarketDataContext (hoisted).
  // Sync the chart's interval prop into the global WS interval.
  useEffect(() => {
    if (isBacktest) return;
    if (wsInterval !== interval) {
      setWsInterval(interval as any);
    }
  }, [interval, wsInterval, setWsInterval, isBacktest]);

  const isDark = theme === 'dark';
  const {
    upColor = isDark ? (themeSettings?.dark_up_candle || '#50ffaf') : (themeSettings?.light_up_candle || '#059669'),
    downColor = isDark ? (themeSettings?.dark_down_candle || '#ffb4ab') : (themeSettings?.light_down_candle || '#e11d48'),
  } = colors || {};

  // ── Snapping & Color Logic ────────────────────────────────────────────────
  const snapPrice = useCallback((rawPrice: number, hoverTime: number | null) => {
    let snapped = rawPrice;
    const tickIncrement = 0.05; // Institutional tick snap step

    // 1. Try to snap to High/Low of the hovered candle
    if (hoverTime !== null && data && data.length > 0) {
      const hoverCandle = data.find(d => Math.floor(d.t / 1000) === hoverTime);
      if (hoverCandle) {
        const referenceVal = (localCandlesRef.current && localCandlesRef.current.length > 0)
          ? localCandlesRef.current[localCandlesRef.current.length - 1].c
          : hoverCandle.c;
        const snapThreshold = referenceVal * 0.0015; // 0.15% threshold for snapping to H/L

        if (Math.abs(rawPrice - hoverCandle.h) <= snapThreshold) {
          snapped = hoverCandle.h;
        } else if (Math.abs(rawPrice - hoverCandle.l) <= snapThreshold) {
          snapped = hoverCandle.l;
        }
      }
    }

    // 2. Snap to nearest tick increment
    return Math.round(snapped / tickIncrement) * tickIncrement;
  }, [data]);

  // ── HTML Overlay Position Syncer ──────────────────────────────────────────
  const updateAlertPositions = useCallback(() => {
    const series = seriesRef.current;
    if (!series) return;

    const positions = alerts
      .map((alert) => {
        const y = series.priceToCoordinate(alert.price) as any as number | null;
        const isTriggered = alert.status === 'triggered';
        return {
          id: alert.id,
          y: y,
          price: alert.price,
          color: isTriggered ? 'rgba(149, 141, 163, 0.4)' : alert.color,
          status: alert.status,
        };
      })
      .filter((pos): pos is { id: string; y: number; price: number; color: string; status: 'active' | 'triggered' } => pos.y !== null);

    setAlertLabelPositions((prev) => {
      if (
        prev.length === positions.length &&
        prev.every(
          (p, i) =>
            p.id === positions[i].id &&
            p.y === positions[i].y &&
            p.price === positions[i].price &&
            p.color === positions[i].color &&
            p.status === positions[i].status
        )
      ) {
        return prev;
      }
      return positions;
    });
  }, [alerts]);

  const updateCountdownPosition = useCallback(() => {
    const series = seriesRef.current;
    if (!series || !countdownRef.current) return;
    
    const candles = localCandlesRef.current;
    const currentPriceForAlerts = (candles && candles.length > 0 ? candles[candles.length - 1].c : 0);
      
    const y = series.priceToCoordinate(currentPriceForAlerts) as number | null;
    if (y !== null) {
      countdownRef.current.style.top = `${y}px`;
    }
  }, []);

  // ── Ghost Line Performance Mechanics ──────────────────────────────────────
  const updateGhostLine = useCallback((offsetY: number, hoverTime: number | null) => {
    const series = seriesRef.current;
    if (!series) return;

    const rawPrice = series.coordinateToPrice(offsetY);
    if (rawPrice === null) return;

    const price = snapPrice(rawPrice, hoverTime);
    ghostPriceRef.current = price;

    const candles = localCandlesRef.current;
    const referencePrice = (candles && candles.length > 0)
      ? candles[candles.length - 1].c
      : (data && data.length > 0 ? data[data.length - 1].c : 0);
    const color = price < referencePrice ? upColor : downColor;

    if (ghostLineRef.current) {
      ghostLineRef.current.applyOptions({
        price,
        color,
      });
    } else {
      ghostLineRef.current = series.createPriceLine({
        price,
        color,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: 'ALERT (PLACE)',
      } as any);
    }
  }, [snapPrice, data, upColor, downColor]);

  const clearGhostLine = useCallback(() => {
    ghostPriceRef.current = null;
    if (ghostLineRef.current && seriesRef.current) {
      seriesRef.current.removePriceLine(ghostLineRef.current);
      ghostLineRef.current = null;
    }
  }, []);

  // ── Event Handlers ────────────────────────────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartRef.current || !seriesRef.current) return;
    
    // Use native event pixel offsets directly to eliminate synchronous getBoundingClientRect layout reflows
    const offsetX = e.nativeEvent.offsetX;
    const offsetY = e.nativeEvent.offsetY;

    const gridWidth = chartRef.current.timeScale().width();
    const isOverYAxis = offsetX >= gridWidth;

    setIsHoveringPriceScale(isOverYAxis);

    const active = isOverYAxis || isHotkeyAlertModeActive;
    if (active) {
      const hoverTime = isOverYAxis ? null : cursorTimeRef.current;
      updateGhostLine(offsetY, hoverTime);
    } else {
      clearGhostLine();
    }
  };

  const handleMouseLeave = () => {
    setIsHoveringPriceScale(false);
    if (!isHotkeyAlertModeActive) {
      clearGhostLine();
    }
  };

  const handleChartClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const active = isHoveringPriceScale || isHotkeyAlertModeActive;
    if (active && ghostPriceRef.current !== null) {
      e.preventDefault();
      e.stopPropagation();

      const price = ghostPriceRef.current;
      const candles = localCandlesRef.current;
      const referencePrice = (candles && candles.length > 0)
        ? candles[candles.length - 1].c
        : (data && data.length > 0 ? data[data.length - 1].c : 0);
      const color = price < referencePrice ? upColor : downColor;

      // Select default timeframe matching chart's current interval (or closest match)
      let initialTimeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1D' = '5m';
      if (interval === '1m') initialTimeframe = '1m';
      else if (interval === '5m') initialTimeframe = '5m';
      else if (interval === '15m') initialTimeframe = '15m';
      else if (interval === '30m') initialTimeframe = '15m'; // map 30m to closest standard alert TF
      else if (interval === '1h') initialTimeframe = '1h';
      else if (interval === '4h') initialTimeframe = '4h';

      const newAlert: Alert = {
        id: `alert-${Date.now()}`,
        price,
        status: 'active',
        color,
        label: `Alert @ ${price.toFixed(2)}`,
        triggerCondition: 'TOUCH',
        timeframe: initialTimeframe,
        actionChain: {
          browserNotification: true,
          triggerAiAnalysis: false,
          soundAlert: true,
        },
        soundSelection: 'Institutional Pulse',
      };

      setAlerts((prev) => [...prev, newAlert]);
      setIsHotkeyAlertModeActive(false);
      clearGhostLine();
    }
  };

  // ── Global Keyboard Bindings ──────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return; // Ignore key bindings if user is typing
      }

      if (e.key === 'a' || e.key === 'A') {
        setIsHotkeyAlertModeActive((prev) => {
          const next = !prev;
          if (!next) {
            clearGhostLine();
          }
          return next;
        });
      } else if (e.key === 'Escape') {
        setIsHotkeyAlertModeActive(false);
        clearGhostLine();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [clearGhostLine]);

  // ── Sync Manual Trading Lines ──────────────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    // Remove existing lines if they exist
    if (manualEntryLineRef.current) {
      series.removePriceLine(manualEntryLineRef.current);
      manualEntryLineRef.current = null;
    }
    if (manualTpLineRef.current) {
      series.removePriceLine(manualTpLineRef.current);
      manualTpLineRef.current = null;
    }
    if (manualSlLineRef.current) {
      series.removePriceLine(manualSlLineRef.current);
      manualSlLineRef.current = null;
    }

    if (!isManualTradingActive) return;

    const entryColor = themeSettings?.theme_manual_entry_line || '#eab308';
    const tpColor = themeSettings?.theme_manual_tp_line || '#10b981';
    const slColor = themeSettings?.theme_manual_sl_line || '#ef4444';

    if (manualEntryPrice !== null && !isNaN(manualEntryPrice)) {
      manualEntryLineRef.current = series.createPriceLine({
        price: manualEntryPrice,
        color: entryColor,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `ENTRY (${manualOrderType})`,
      });
    }

    if (manualTakeProfit !== null && !isNaN(manualTakeProfit)) {
      manualTpLineRef.current = series.createPriceLine({
        price: manualTakeProfit,
        color: tpColor,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'TAKE PROFIT (TP)',
      });
    }

    if (manualStopLoss !== null && !isNaN(manualStopLoss)) {
      manualSlLineRef.current = series.createPriceLine({
        price: manualStopLoss,
        color: slColor,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'STOP LOSS (SL)',
      });
    }

    return () => {
      if (seriesRef.current) {
        if (manualEntryLineRef.current) {
          seriesRef.current.removePriceLine(manualEntryLineRef.current);
          manualEntryLineRef.current = null;
        }
        if (manualTpLineRef.current) {
          seriesRef.current.removePriceLine(manualTpLineRef.current);
          manualTpLineRef.current = null;
        }
        if (manualSlLineRef.current) {
          seriesRef.current.removePriceLine(manualSlLineRef.current);
          manualSlLineRef.current = null;
        }
      }
    };
  }, [
    isManualTradingActive,
    manualOrderType,
    manualEntryPrice,
    manualTakeProfit,
    manualStopLoss,
    themeSettings,
    theme
  ]);

  const openTradesRef = useRef(openTrades);
  openTradesRef.current = openTrades;
  const srOverlayRef = useRef(srOverlay);
  srOverlayRef.current = srOverlay;

  // Update SVG line and label coordinates directly in DOM styles to target 120 FPS
  const updateSvgCoordinates = useCallback(() => {
    const series = seriesRef.current;
    const currentOpenTrades = openTradesRef.current;
    if (!series || !currentOpenTrades) return;

    currentOpenTrades.forEach((trade) => {
      const entryPrice = parseFloat(trade.entry_price);
      const tpPrice = parseFloat(trade.take_profit);
      const slPrice = parseFloat(trade.stop_loss);

      const entryY = series.priceToCoordinate(entryPrice);
      const tpY = tpPrice > 0 ? series.priceToCoordinate(tpPrice) : null;
      const slY = slPrice > 0 ? series.priceToCoordinate(slPrice) : null;

      // Update Entry DOM
      const entryLineEl = document.getElementById(`svg-line-${trade.id}-entry`);
      if (entryLineEl) {
        if (entryY !== null && !isNaN(entryY)) {
          entryLineEl.setAttribute('y1', String(entryY));
          entryLineEl.setAttribute('y2', String(entryY));
        } else {
          entryLineEl.setAttribute('y1', '-1000');
          entryLineEl.setAttribute('y2', '-1000');
        }
      }
      const entryLabelEl = document.getElementById(`svg-label-${trade.id}-entry`);
      if (entryLabelEl) {
        if (entryY !== null && !isNaN(entryY)) {
          entryLabelEl.setAttribute('transform', `translate(10, ${entryY})`);
        } else {
          entryLabelEl.setAttribute('transform', 'translate(10, -1000)');
        }
      }

      // Update TP DOM
      const tpLineEl = document.getElementById(`svg-line-${trade.id}-tp`);
      if (tpLineEl) {
        if (tpY !== null && !isNaN(tpY)) {
          tpLineEl.setAttribute('y1', String(tpY));
          tpLineEl.setAttribute('y2', String(tpY));
        } else {
          tpLineEl.setAttribute('y1', '-1000');
          tpLineEl.setAttribute('y2', '-1000');
        }
      }
      const tpLabelEl = document.getElementById(`svg-label-${trade.id}-tp`);
      if (tpLabelEl) {
        if (tpY !== null && !isNaN(tpY)) {
          tpLabelEl.setAttribute('transform', `translate(10, ${tpY})`);
        } else {
          tpLabelEl.setAttribute('transform', 'translate(10, -1000)');
        }
      }

      // Update SL DOM
      const slLineEl = document.getElementById(`svg-line-${trade.id}-sl`);
      if (slLineEl) {
        if (slY !== null && !isNaN(slY)) {
          slLineEl.setAttribute('y1', String(slY));
          slLineEl.setAttribute('y2', String(slY));
        } else {
          slLineEl.setAttribute('y1', '-1000');
          slLineEl.setAttribute('y2', '-1000');
        }
      }
      const slLabelEl = document.getElementById(`svg-label-${trade.id}-sl`);
      if (slLabelEl) {
        if (slY !== null && !isNaN(slY)) {
          slLabelEl.setAttribute('transform', `translate(10, ${slY})`);
        } else {
          slLabelEl.setAttribute('transform', 'translate(10, -1000)');
        }
      }
    });

    // ── Update Sweep & Reclaim Overlay DOM Lines & Labels ──
    const currentSrOverlay = srOverlayRef.current;
    if (currentSrOverlay) {
      const updateSrLineAndLabel = (idPrefix: string, price: number | null | undefined, xOffset = 10) => {
        const lineEl = document.getElementById(`svg-sr-line-${idPrefix}`);
        const labelEl = document.getElementById(`svg-sr-label-${idPrefix}`);
        const y = price !== null && price !== undefined && price > 0 ? series.priceToCoordinate(price) : null;
        if (lineEl) {
          if (y !== null && !isNaN(y)) {
            lineEl.setAttribute('y1', String(y));
            lineEl.setAttribute('y2', String(y));
          } else {
            lineEl.setAttribute('y1', '-1000');
            lineEl.setAttribute('y2', '-1000');
          }
        }
        if (labelEl) {
          if (y !== null && !isNaN(y)) {
            labelEl.setAttribute('transform', `translate(${xOffset}, ${y})`);
          } else {
            labelEl.setAttribute('transform', `translate(${xOffset}, -1000)`);
          }
        }
      };

      const entryCollidesWithAnchor =
        currentSrOverlay.entryPrice > 0 &&
        currentSrOverlay.anchorLevel > 0 &&
        Math.abs(currentSrOverlay.entryPrice - currentSrOverlay.anchorLevel) < 0.05;

      const isPositionOpen = currentSrOverlay.isPositionOpen || currentSrOverlay.phase === 'OPEN';

      updateSrLineAndLabel('anchor', currentSrOverlay.anchorLevel, 10);
      updateSrLineAndLabel('reclaim', currentSrOverlay.fvgCe ?? currentSrOverlay.reclaimPrice ?? currentSrOverlay.sweepObMt, 10);
      updateSrLineAndLabel('entry', currentSrOverlay.entryPrice, entryCollidesWithAnchor ? 110 : 10);

      // Gated Overlay: Only render/position SL and TP lines when position is actively OPEN
      if (isPositionOpen) {
        updateSrLineAndLabel('sl', currentSrOverlay.stopLoss, 10);
        updateSrLineAndLabel('tp1', currentSrOverlay.target1, 10);
        updateSrLineAndLabel('tp2', currentSrOverlay.target2, 10);
        updateSrLineAndLabel('tp3', currentSrOverlay.target3, 10);
      } else {
        updateSrLineAndLabel('sl', null, 10);
        updateSrLineAndLabel('tp1', null, 10);
        updateSrLineAndLabel('tp2', null, 10);
        updateSrLineAndLabel('tp3', null, 10);
      }

      // When entry is co-located with anchor level, suppress redundant anchor badge
      if (entryCollidesWithAnchor) {
        const anchorLabelEl = document.getElementById('svg-sr-label-anchor');
        if (anchorLabelEl) {
          anchorLabelEl.setAttribute('transform', 'translate(10, -1000)');
        }
      }
    } else {
      // HIDE ALL S&R SVG LINES AND LABELS WHEN SROVERLAY IS NULL
      const hideLineAndLabel = (idPrefix: string) => {
        const lineEl = document.getElementById(`svg-sr-line-${idPrefix}`);
        const labelEl = document.getElementById(`svg-sr-label-${idPrefix}`);
        if (lineEl) {
          lineEl.setAttribute('y1', '-1000');
          lineEl.setAttribute('y2', '-1000');
        }
        if (labelEl) {
          labelEl.setAttribute('transform', `translate(10, -1000)`);
        }
      };
      
      hideLineAndLabel('anchor');
      hideLineAndLabel('reclaim');
      hideLineAndLabel('entry');
      hideLineAndLabel('sl');
      hideLineAndLabel('tp1');
      hideLineAndLabel('tp2');
      hideLineAndLabel('tp3');
    }
  }, []);

  // Sync coordinates when openTrades, srOverlay, or data changes
  useEffect(() => {
    const timer = setTimeout(() => {
      updateSvgCoordinates();
    }, 50);
    return () => clearTimeout(timer);
  }, [
    openTrades?.length,
    srOverlay?.phase,
    srOverlay?.entryPrice,
    srOverlay?.stopLoss,
    srOverlay?.target1,
    data?.length,
    updateSvgCoordinates
  ]);

  // ── Main Chart Initialization ─────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const {
      backgroundColor = '#0e0e0f', // Deep black for premium look
      textColor = '#958da3',
    } = colors || {};

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: backgroundColor },
        textColor,
      },
      localization: {
        timeFormatter: (timestamp: number) => {
          return new Date(timestamp * 1000).toLocaleTimeString('en-EG', {
            timeZone: 'Africa/Cairo',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
        },
      },
      grid: {
        vertLines: { color: 'rgba(74, 68, 87, 0.5)' },
        horzLines: { color: 'rgba(74, 68, 87, 0.5)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 1.5,
        borderColor: 'rgba(74, 68, 87, 0.5)',
        tickMarkFormatter: (time: number) => {
          return new Date(time * 1000).toLocaleTimeString('en-EG', {
            timeZone: 'Africa/Cairo',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(74, 68, 87, 0.5)',
      },
      crosshair: {
        mode: isSnapEnabled ? CrosshairMode.Magnet : CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(74, 68, 87, 0.5)',
          width: 1,
          style: 3,
        },
        horzLine: {
          color: 'rgba(74, 68, 87, 0.5)',
          width: 1,
          style: 3,
        },
      },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor,
      downColor,
      borderVisible: false,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });
    seriesRef.current = candlestickSeries;
    seriesMarkersRef.current = createSeriesMarkers(candlestickSeries);

    // Keep track of the last hovered candle values to avoid duplicate state updates
    let prevHovered: { open: number; high: number; low: number; close: number; volume: number } | null = null;
    let prevSnapped: number | null = null;

    // Crosshair movement listener
    const handleCrosshairMove = (param: any) => {
      if (param && param.time) {
        cursorTimeRef.current = Number(param.time);
        const seriesData = param.seriesData.get(candlestickSeries);
        if (seriesData) {
          const open = seriesData.open !== undefined ? seriesData.open : seriesData.close;
          const high = seriesData.high !== undefined ? seriesData.high : seriesData.close;
          const low = seriesData.low !== undefined ? seriesData.low : seriesData.close;
          const close = seriesData.close;

          // Target anchor calculation for magnet snapping (ONLY when magnet snapping is enabled)
          if (isSnapEnabledRef.current) {
            let calculatedSnap = close;
            const currentTarget = snapTargetRef.current;
            if (currentTarget === 'HIGH') calculatedSnap = high;
            else if (currentTarget === 'LOW') calculatedSnap = low;
            else if (currentTarget === 'OPEN') calculatedSnap = open;
            else if (currentTarget === 'CLOSE') calculatedSnap = close;
            else if (currentTarget === 'NEAREST') {
              if (param.point && candlestickSeries) {
                const yPrice = candlestickSeries.coordinateToPrice(param.point.y);
                if (yPrice !== null) {
                  const candidates = [open, high, low, close];
                  calculatedSnap = candidates.reduce((prev, curr) =>
                    Math.abs(curr - yPrice) < Math.abs(prev - yPrice) ? curr : prev
                  );
                }
              }
            }
            if (prevSnapped !== calculatedSnap) {
              prevSnapped = calculatedSnap;
              setSnappedPrice(calculatedSnap);
            }
          } else if (prevSnapped !== null) {
            prevSnapped = null;
            setSnappedPrice(null);
          }

          // Fast binary search lookup for hovered candle volume
          let volume = 0;
          const hoverTime = Number(param.time);
          const histCandle = findCandleByTime(localCandlesRef.current || dataRef.current, hoverTime);
          if (histCandle) {
            volume = histCandle.v;
          }

          if (
            !prevHovered ||
            prevHovered.open !== open ||
            prevHovered.high !== high ||
            prevHovered.low !== low ||
            prevHovered.close !== close ||
            prevHovered.volume !== volume
          ) {
            const nextCandle = { open, high, low, close, volume };
            prevHovered = nextCandle;
            setHoveredCandle(nextCandle);
          }
          return;
        }
      }

      cursorTimeRef.current = null;
      if (prevSnapped !== null) {
        prevSnapped = null;
        setSnappedPrice(null);
      }
      if (prevHovered !== null) {
        prevHovered = null;
        setHoveredCandle(null);
      }
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
        updateSvgCoordinates();
      }
    };

    const resizeObserver = new ResizeObserver((entries) => {
      try {
        if (!entries || !Array.isArray(entries) || entries.length === 0) return;
        const entry = entries[0];
        if (!entry || !entry.contentRect) return;
        if (chartRef.current) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            chartRef.current.applyOptions({ width, height });
            updateSvgCoordinates();
          }
        }
      } catch (err) {
        // Prevent unhandled observer exceptions from crashing page mount
      }
    });

    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      seriesMarkersRef.current = null;

      // Clean up maps and temporary lines
      priceLinesRef.current.clear();
      if (ghostLineRef.current) {
        ghostLineRef.current = null;
      }
    };
  }, [colors, upColor, downColor]);

  // ── Sync Chart Colors with Theme and Custom ThemeSettings ────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const isDark = theme === 'dark';
    const bg = isDark 
      ? (themeSettings?.dark_bg || '#020617') 
      : (themeSettings?.light_bg || '#fafafa');
    const text = isDark 
      ? (themeSettings?.dark_chart_text || '#94a3b8') 
      : (themeSettings?.light_chart_text || '#475569');
    const grid = isDark 
      ? (themeSettings?.dark_chart_grid || 'rgba(255, 255, 255, 0.05)') 
      : (themeSettings?.light_chart_grid || 'rgba(0, 0, 0, 0.04)');
    const border = isDark 
      ? (themeSettings?.dark_chart_border || 'rgba(255, 255, 255, 0.08)') 
      : (themeSettings?.light_chart_border || 'rgba(0, 0, 0, 0.06)');
    
    // Crosshair matches dynamic accent color
    const crosshairColor = isDark
      ? (themeSettings?.dark_accent || '#a855f7')
      : (themeSettings?.light_accent || '#4f46e5');

    const upCandleColor = isDark 
      ? (themeSettings?.dark_up_candle || '#50ffaf') 
      : (themeSettings?.light_up_candle || '#059669');
      
    const downCandleColor = isDark 
      ? (themeSettings?.dark_down_candle || '#ffb4ab') 
      : (themeSettings?.light_down_candle || '#e11d48');

    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: bg },
        textColor: text,
      },
      grid: {
        vertLines: { color: grid },
        horzLines: { color: grid },
      },
      timeScale: {
        borderColor: border,
      },
      rightPriceScale: {
        borderColor: border,
      },
      crosshair: {
        vertLine: {
          color: crosshairColor,
        },
        horzLine: {
          color: crosshairColor,
        },
      },
    });

    if (seriesRef.current) {
      seriesRef.current.applyOptions({
        upColor: upCandleColor,
        downColor: downCandleColor,
        wickUpColor: upCandleColor,
        wickDownColor: downCandleColor,
      });
    }
  }, [theme, themeSettings]);

  // ── Sync Historical Data ──────────────────────────────────────────────────
  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      // Format and deduplicate candles by timestamp (in seconds) to guarantee strictly ascending order for Lightweight Charts
      const candleMap = new Map<number, { time: any; open: number; high: number; low: number; close: number }>();
      
      for (const d of data) {
        // Price sanity validation: ensure valid positive finite values
        if (!d.t || !Number.isFinite(d.t) || d.c <= 0 || !Number.isFinite(d.c)) {
          continue;
        }

        const timeSec = Math.floor(d.t / 1000);
        candleMap.set(timeSec, {
          time: timeSec as any,
          open: d.o,
          high: d.h,
          low: d.l,
          close: d.c,
        });
      }

      const formattedData = Array.from(candleMap.values()).sort((a, b) => (a.time as number) - (b.time as number));

      // Calculate shift count for left-edge prepends
      let prependedCount = 0;
      if (prevFirstCandleTimeRef.current !== null && !isInitialLoad.current) {
        prependedCount = data.filter((c) => c.t < prevFirstCandleTimeRef.current!).length;
      }

      seriesRef.current.setData(formattedData);

      if (isInitialLoad.current && chartRef.current) {
        const timeScale = chartRef.current.timeScale();
        const totalCount = formattedData.length;
        const visibleCandlesCount = 120; // comfortable standard trading view (last 120 candles)

        if (totalCount > visibleCandlesCount) {
          timeScale.setVisibleRange({
            from: formattedData[totalCount - visibleCandlesCount].time,
            to: formattedData[totalCount - 1].time,
          });
        } else {
          timeScale.fitContent();
        }
        isInitialLoad.current = false;
      } else if (prependedCount > 0 && chartRef.current) {
        // Adjust visible logical range to avoid left-edge jump
        const timeScale = chartRef.current.timeScale();
        const logicalRange = timeScale.getVisibleLogicalRange();
        if (logicalRange) {
          timeScale.setVisibleLogicalRange({
            from: logicalRange.from + prependedCount,
            to: logicalRange.to + prependedCount,
          });
        }
      }

      // Store the first candle timestamp for tracking prepends
      prevFirstCandleTimeRef.current = data[0].t;

      // Update coordinates
      updateAlertPositions();
    }
  }, [data, theme, isBacktest]); // eslint-disable-next-line react-hooks/exhaustive-deps

  // Reset viewport and layer caches whenever timeframe interval changes
  useEffect(() => {
    isInitialLoad.current = true;
    
    // Cleanly remove all active canvas price lines before clearing storage
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (chart && series) {
      const activeTheme = theme === 'dark' ? 'dark' : 'light';
      registry.getAll().forEach((layer) => {
        if (layer.clearChart) {
          const storage = getLayerStorage(layer.id);
          try {
            layer.clearChart({
              chart,
              series,
              seriesMarkers: seriesMarkersRef.current,
              data: (marketContextData || undefined) as any,
              activeCandles: localCandles,
              theme: activeTheme as 'dark' | 'light',
              themeSettings,
              storage,
              structureState,
              contextAnchorTimestamp,
              engineSettings: context.engineSettings,
            });
          } catch (err) {
            console.error(`[LayerOrchestrator] Failed to clear layer ${layer.id} on timeframe switch:`, err);
          }
        }
      });
    }

    layerStorageRef.current.clear();
    htmlLayerCacheRef.current = {};
    lastClosedTRef.current = null;
    lastVisibleRangeRef.current = null;
    lastDataPayloadRef.current = null;
  }, [interval]);

  // ── Dynamic Recalculations for Real-Time WebSocket Reactivity ──────────────
  const activeStructureState = useMemo(() => {
    if (!structureState) return null;
    const currentPrice = localCandles.length > 0 ? (localCandles[localCandles.length - 1]?.c ?? 0) : 0;

    // Perform lightweight update on dealing range status (O(1) complexity)
    const updatedDealingRange = structureState.dealingRange ? {
      ...structureState.dealingRange,
      current_status: structureState.dealingRange.equilibrium === null
        ? 'AWAITING_IDM_SWEEP' as const
        : (currentPrice > Number(structureState.dealingRange.equilibrium) ? 'PREMIUM' as const : 'DISCOUNT' as const)
    } : null;

    const updatedInternalDealingRange = structureState.internalDealingRange ? {
      ...structureState.internalDealingRange,
      current_status: structureState.internalDealingRange.equilibrium === null
        ? 'AWAITING_IDM_SWEEP' as const
        : (currentPrice > Number(structureState.internalDealingRange.equilibrium) ? 'PREMIUM' as const : 'DISCOUNT' as const)
    } : null;

    return {
      ...structureState,
      dealingRange: updatedDealingRange,
      internalDealingRange: updatedInternalDealingRange
    } as any;
  }, [structureState, localCandles]);

  // ── Dynamic Chart Layer Orchestrator ─────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const activeData = marketContextData;
    if (!chart || !series || !localCandles || localCandles.length === 0 || !activeData) return;

    const lastClosedT = localCandles[localCandles.length - 2]?.t;
    const isNewCandle = lastClosedTRef.current !== lastClosedT;

    const visibleRange = chart.timeScale().getVisibleLogicalRange();
    const isViewportChanged = !lastVisibleRangeRef.current || 
      lastVisibleRangeRef.current.from !== visibleRange?.from || 
      lastVisibleRangeRef.current.to !== visibleRange?.to;

    // Interactivity bypass checks
    const isInteracting = isHotkeyAlertModeActive || hoveredCandle !== null;

    // Check if configuration has changed
    const prevVisibility = prevVisibilityRef.current;
    let isConfigChanged = false;
    if (prevVisibility) {
      const keys = new Set([...Object.keys(prevVisibility), ...Object.keys(visibility)]);
      for (const key of keys) {
        if (prevVisibility[key] !== visibility[key]) {
          isConfigChanged = true;
          break;
        }
      }
    } else {
      isConfigChanged = true;
    }

    if (prevThemeRef.current !== theme) isConfigChanged = true;
    if (JSON.stringify(prevThemeSettingsRef.current) !== JSON.stringify(themeSettings)) isConfigChanged = true;
    if (JSON.stringify(prevEngineSettingsRef.current) !== JSON.stringify(context.engineSettings)) isConfigChanged = true;

    // Update tracking refs for next run
    prevVisibilityRef.current = visibility;
    prevThemeRef.current = theme;
    prevThemeSettingsRef.current = themeSettings;
    prevEngineSettingsRef.current = context.engineSettings;

    if (!isNewCandle && !isViewportChanged && !isInteracting && !isConfigChanged && lastClosedTRef.current !== null) {
      return;
    }

    // Keep track of parameters
    if (lastClosedT) {
      lastClosedTRef.current = lastClosedT;
    }
    if (visibleRange) {
      lastVisibleRangeRef.current = { from: visibleRange.from, to: visibleRange.to };
    }
    lastDataPayloadRef.current = activeData;

    const activeTheme = theme === 'dark' ? 'dark' : 'light';
    const layers = registry.getAll();

    layers.forEach((layer) => {
      const isEnabled = visibility[layer.id] !== false;
      const storage = getLayerStorage(layer.id);

      const renderContext = {
        chart,
        series,
        seriesMarkers: seriesMarkersRef.current,
        data: activeData,
        activeCandles: localCandles,
        theme: activeTheme as 'dark' | 'light',
        themeSettings,
        storage,
        structureState: activeStructureState || structureState,
        contextAnchorTimestamp,
        engineSettings: context.engineSettings,
      };

      if (isEnabled) {
        if (layer.renderChart) {
          try {
            layer.renderChart(renderContext);
          } catch (err) {
            console.error(`[LayerOrchestrator] Failed to render chart layer ${layer.id}:`, err);
          }
        }
      } else {
        if (layer.clearChart) {
          try {
            layer.clearChart(renderContext);
          } catch (err) {
            console.error(`[LayerOrchestrator] Failed to clear chart layer ${layer.id}:`, err);
          }
        }
      }
    });
  }, [localCandles, marketContextData, visibility, theme, themeSettings, getLayerStorage, activeStructureState, structureState, contextAnchorTimestamp, context.engineSettings, isHotkeyAlertModeActive]);

  // ── Sync Active Alerts with Price Lines ───────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const currentLines = priceLinesRef.current;

    // 1. Remove price lines that are no longer in the alerts array
    const activeAlertIds = new Set(alerts.map((a) => a.id));
    for (const [id, line] of currentLines.entries()) {
      if (!activeAlertIds.has(id)) {
        series.removePriceLine(line);
        currentLines.delete(id);
      }
    }

    // 2. Add or update price lines for alerts
    alerts.forEach((alert) => {
      let line = currentLines.get(alert.id);
      const isTriggered = alert.status === 'triggered';
      const options = {
        price: alert.price,
        color: isTriggered ? 'rgba(149, 141, 163, 0.4)' : alert.color,
        lineStyle: isTriggered ? LineStyle.Dotted : LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: isTriggered ? 'SPENT' : 'ALERT',
      } as any;

      if (line) {
        line.applyOptions(options);
      } else {
        const newLine = series.createPriceLine(options);
        currentLines.set(alert.id, newLine);
      }
    });

    // 3. Trigger alert badge updates
    updateAlertPositions();
  }, [alerts, upColor, downColor, updateAlertPositions]);

  // ── V8.6: FVG Overlay Pixel Calculator (Finite & Anchored) ───────────────
  const computeFvgOverlay = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || !activeFvgs || activeFvgs.length === 0) {
      setFvgOverlayBoxes((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const layoutOptions = chart.options()?.layout as any;
    const timeScaleOptions = chart.timeScale().options() as any;
    const barSpacing = layoutOptions?.barSpacing ?? timeScaleOptions?.barSpacing ?? 6;
    const width = 9 * barSpacing;

    const boxes: { key: string; top: number; height: number; left: number; width: number; isBullish: boolean }[] = [];

    for (const fvg of activeFvgs) {
      // Only render strictly UNMITIGATED zones
      if (fvg.status !== 'UNMITIGATED') continue;

      const topY = series.priceToCoordinate(fvg.top) as number | null;
      const bottomY = series.priceToCoordinate(fvg.bottom) as number | null;

      if (topY === null || bottomY === null) continue;

      // Starting X position: anchored to the origin candle timestamp (Candle 1)
      const timeSec = Math.floor(fvg.origin_time / 1000);
      const left = chart.timeScale().timeToCoordinate(timeSec as any);

      if (left === null) continue;

      // Viewport culling: Skip FVG boxes completely off-screen
      const lastCandleSec = localCandlesRef.current && localCandlesRef.current.length > 0 ? Math.floor(localCandlesRef.current[localCandlesRef.current.length - 1].t / 1000) : 0;
      const chartRightX = (chart.timeScale().timeToCoordinate(lastCandleSec as any) ?? 2500) + 300;
      if (left + width < -50 || left > chartRightX + 50) continue;

      const pixelTop = Math.min(topY, bottomY);
      const pixelBottom = Math.max(topY, bottomY);
      const height = pixelBottom - pixelTop;

      if (height <= 0) continue;

      boxes.push({
        key: `${fvg.timeframe}_${fvg.type}_${fvg.top}_${fvg.bottom}_${fvg.origin_time}`,
        top: pixelTop,
        height,
        left,
        width,
        isBullish: fvg.type === 'BULLISH',
      });
    }

    setFvgOverlayBoxes((prev) => {
      if (
        prev.length === boxes.length &&
        prev.every(
          (b, i) =>
            b.key === boxes[i].key &&
            b.top === boxes[i].top &&
            b.height === boxes[i].height &&
            b.left === boxes[i].left &&
            b.width === boxes[i].width &&
            b.isBullish === boxes[i].isBullish
        )
      ) {
        return prev;
      }
      return boxes;
    });
  }, [activeFvgs]);

  // Callback refs to stabilize layout scheduler dependencies
  const updateAlertPositionsRef = useRef(updateAlertPositions);
  updateAlertPositionsRef.current = updateAlertPositions;
  const computeFvgOverlayRef = useRef(computeFvgOverlay);
  computeFvgOverlayRef.current = computeFvgOverlay;
  const updateSvgCoordinatesRef = useRef(updateSvgCoordinates);
  updateSvgCoordinatesRef.current = updateSvgCoordinates;
  const updateCountdownPositionRef = useRef(updateCountdownPosition);
  updateCountdownPositionRef.current = updateCountdownPosition;

  const loadMoreHistoryRef = useRef(loadMoreHistory);
  loadMoreHistoryRef.current = loadMoreHistory;
  const isFetchingMoreRef = useRef(isFetchingMore);
  isFetchingMoreRef.current = isFetchingMore;

  // ── Throttled Layout Update Scheduler (requestAnimationFrame) ──────────────
  const rafScheduledRef = useRef(false);
  const scheduleLayoutUpdates = useCallback(() => {
    if (rafScheduledRef.current) return;
    rafScheduledRef.current = true;
    requestAnimationFrame(() => {
      rafScheduledRef.current = false;
      updateAlertPositionsRef.current?.();
      computeFvgOverlayRef.current?.();
      updateSvgCoordinatesRef.current?.();
      updateCountdownPositionRef.current?.();
    });
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handleChartUpdate = (logicalRange?: any) => {
      scheduleLayoutUpdates();

      if (logicalRange && logicalRange.from < 15 && loadMoreHistoryRef.current && !isFetchingMoreRef.current) {
        loadMoreHistoryRef.current();
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleChartUpdate);

    const priceScaleApi = chart.priceScale('right') as any;
    if (priceScaleApi && priceScaleApi.subscribeVisiblePriceRangeChange) {
      priceScaleApi.subscribeVisiblePriceRangeChange(handleChartUpdate);
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(handleChartUpdate);
      }
      if (priceScaleApi && priceScaleApi.unsubscribeVisiblePriceRangeChange) {
        priceScaleApi.unsubscribeVisiblePriceRangeChange(handleChartUpdate);
      }
    };
  }, [scheduleLayoutUpdates]);

  // Recompute FVG overlay whenever activeFvgs or localCandles updates
  useEffect(() => {
    computeFvgOverlay();
  }, [activeFvgs, localCandles, computeFvgOverlay]);

  // Countdown Timer Interval
  useEffect(() => {
    const timer = setInterval(() => {
      const candles = localCandlesRef.current;
      if (!candles || candles.length === 0) return;
      const latestCandle = candles[candles.length - 1];
      
      const intervalStr = interval || '5m'; 
      let intSeconds = 300;
      if (intervalStr.endsWith('m')) intSeconds = parseInt(intervalStr) * 60;
      else if (intervalStr.endsWith('h')) intSeconds = parseInt(intervalStr) * 3600;
      else if (intervalStr.endsWith('d')) intSeconds = parseInt(intervalStr) * 86400;

      const openTimeSec = Math.floor(latestCandle.t / 1000);
      const closeTimeSec = openTimeSec + intSeconds;
      const nowSec = Math.floor(Date.now() / 1000);
      let diff = closeTimeSec - nowSec;
      
      if (diff <= 0) {
        setCountdownText('00:00');
        return;
      }
      
      const mm = Math.floor(diff / 60).toString().padStart(2, '0');
      const ss = (diff % 60).toString().padStart(2, '0');
      let text = `${mm}:${ss}`;
      if (diff >= 3600) {
        const hh = Math.floor(diff / 3600).toString().padStart(2, '0');
        const remMm = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
        text = `${hh}:${remMm}:${ss}`;
      }
      setCountdownText(text);
    }, 1000);

    return () => clearInterval(timer);
  }, [interval]);

  // ── Phase 3: The Execution Loop & Tick Crossovers ─────────────────────────
  const executeAlert = useCallback((alert: Alert) => {

    // 1. Instantly flip status in state to prevent double execution
    setAlerts((prevAlerts) =>
      prevAlerts.map((a) => (a.id === alert.id ? { ...a, status: 'triggered' as const } : a))
    );

    // 2. Play Audio if enabled
    if (alert.actionChain?.soundAlert && alert.soundSelection) {
      console.log('[Chart Component] Playing audio asset:', alert.soundSelection);
      playSound(alert.soundSelection);
    }

    // 3. Global Toast Console & Browser Notification Routing
    console.log('[Chart Component] triggerSmartAlert status:', !!triggerSmartAlert);
    if (triggerSmartAlert) {
      const alertLabel = alert.label || `Level @ ${alert.price.toFixed(2)}`;
      triggerSmartAlert(
        'PURGE', // Crimson red styling matching sweeps/purges
        `🚨 PRICE ALERT CROSSOVER: "${alertLabel}" struck at ${alert.price.toFixed(2)} USDC`
      );
    } else if (alert.actionChain?.browserNotification && typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(`[FLOW-STATE ALERT] ${alert.label || 'Level Struck'}`, {
          body: `${alert.label || 'Price Alert'} struck at ${alert.price.toFixed(2)}`,
        });
      }
    }

    // 4. AI Narrative Scan if enabled
    if (alert.actionChain?.triggerAiAnalysis) {
      console.log(`[AI SCAN] Dispatching synthetic narrative scan for alert: ${alert.id} (${alert.label})`);
      triggerAiAnalysisScan({
        id: alert.id,
        label: alert.label || 'Unnamed Alert',
        price: alert.price,
        triggerCondition: alert.triggerCondition
      });
    }

    // 5. Trigger HUD Pulse for 1000ms visual institutional feedback
    const isBullish = alert.color === upColor;
    setHudPulse(isBullish ? 'BULLISH' : 'BEARISH');
    setTimeout(() => {
      setHudPulse(null);
    }, 1000);
  }, [playSound, upColor, triggerSmartAlert, triggerAiAnalysisScan]);

  // Reset chart scaling and tracking refs when timeframe interval changes
  useEffect(() => {
    isInitialLoad.current = true;
    setHoveredCandle(null);
  }, [interval]);

  // Resolve the candle to show in the HUD (top left)
  // 1. If user is hovering a candle, show the hovered candle
  // 2. Otherwise, show the last candle in localCandles
  const hudCandle = (() => {
    if (hoveredCandle) {
      return hoveredCandle;
    }
    if (localCandles.length > 0) {
      const last = localCandles[localCandles.length - 1];
      return {
        open: last.o,
        high: last.h,
        low: last.l,
        close: last.c,
        volume: last.v,
      };
    }
    return null;
  })();

  return (
    <div className="w-full h-full relative group">
      {/* The Chart Canvas container */}
      <div
        ref={chartContainerRef}
        className="w-full h-full absolute inset-0"
        style={{
          cursor: activeDrawingTool !== 'CURSOR' ? 'crosshair' : isManualTradingActive ? 'crosshair' : 'default'
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleChartClick}
      />

      {/* SVG Overlay Container for Open Trades (Non-blocking structural reference) */}
      <svg className="absolute inset-0 pointer-events-none w-full h-full z-15 select-none">
        {openTrades && openTrades.map((trade) => {
          const entryPrice = parseFloat(trade.entry_price);
          const tpPrice = parseFloat(trade.take_profit);
          const slPrice = parseFloat(trade.stop_loss);

          return (
            <g key={trade.id} id={`svg-trade-group-${trade.id}`} className="pointer-events-none">
              {/* Entry Line */}
              <line
                id={`svg-line-${trade.id}-entry`}
                x1="0"
                x2="100%"
                y1="-1000"
                y2="-1000"
                stroke="#958da3"
                strokeDasharray="4 4"
                strokeWidth="1.5"
              />
              <g id={`svg-label-${trade.id}-entry`} transform="translate(10, -1000)">
                <rect x="5" y="-8" width="165" height="16" fill="#141416" rx="2" stroke="#958da3" strokeWidth="1" />
                <text x="10" y="4" fill="#958da3" fontSize="9" fontFamily="monospace" fontWeight="bold">
                  {`ENTRY (${trade.direction}): ${entryPrice.toFixed(2)}`}
                </text>
              </g>

              {/* TP Line */}
              {tpPrice > 0 && !isNaN(tpPrice) && (
                <>
                  <line
                    id={`svg-line-${trade.id}-tp`}
                    x1="0"
                    x2="100%"
                    y1="-1000"
                    y2="-1000"
                    stroke="#10b981"
                    strokeDasharray="4 2"
                    strokeWidth="1.5"
                  />
                  <g id={`svg-label-${trade.id}-tp`} transform="translate(10, -1000)">
                    <rect x="5" y="-8" width="165" height="16" fill="#141416" rx="2" stroke="#10b981" strokeWidth="1" />
                    <text
                      id={`svg-text-${trade.id}-tp`}
                      x="10"
                      y="4"
                      fill="#10b981"
                      fontSize="9"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {`TP (${trade.direction}): ${tpPrice.toFixed(2)}`}
                    </text>
                  </g>
                </>
              )}

              {/* SL Line */}
              {slPrice > 0 && !isNaN(slPrice) && (
                <>
                  <line
                    id={`svg-line-${trade.id}-sl`}
                    x1="0"
                    x2="100%"
                    y1="-1000"
                    y2="-1000"
                    stroke="#ef4444"
                    strokeDasharray="4 2"
                    strokeWidth="1.5"
                  />
                  <g id={`svg-label-${trade.id}-sl`} transform="translate(10, -1000)">
                    <rect x="5" y="-8" width="165" height="16" fill="#141416" rx="2" stroke="#ef4444" strokeWidth="1" />
                    <text
                      id={`svg-text-${trade.id}-sl`}
                      x="10"
                      y="4"
                      fill="#ef4444"
                      fontSize="9"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {`SL (${trade.direction}): ${slPrice.toFixed(2)}`}
                    </text>
                  </g>
                </>
              )}
            </g>
          );
        })}

        {/* Sweep & Reclaim Quantitative Strategy SVG Overlay */}
        {srOverlay && (() => {
          const isPositionOpen = srOverlay.isPositionOpen || srOverlay.phase === 'OPEN';
          const entryCollidesWithAnchor =
            srOverlay.entryPrice > 0 &&
            srOverlay.anchorLevel > 0 &&
            Math.abs(srOverlay.entryPrice - srOverlay.anchorLevel) < 0.05;

          return (
            <g id="svg-sr-overlay-group">
              {/* Swept Anchor Line & Label */}
              <line
                id="svg-sr-line-anchor"
                x1="0"
                x2="100%"
                y1="-1000"
                y2="-1000"
                stroke="#38bdf8"
                strokeDasharray="6 3"
                strokeWidth="1.5"
              />
              <g
                id="svg-sr-label-anchor"
                transform="translate(10, -1000)"
                style={{ display: entryCollidesWithAnchor ? 'none' : 'block' }}
              >
                <rect x="5" y="-9" width="230" height="18" fill="#0f172a" rx="3" stroke="#38bdf8" strokeWidth="1" />
                <text x="12" y="4" fill="#38bdf8" fontSize="9.5" fontFamily="monospace" fontWeight="bold">
                  {`⚓ ANCHOR (${srOverlay.anchorName}): $${srOverlay.anchorLevel.toFixed(2)} [SWEPT]`}
                </text>
              </g>

              {/* Reclaim Shelf / Displacement FVG CE Line & Label */}
              {(srOverlay.fvgCe || srOverlay.reclaimPrice || srOverlay.sweepObMt) && (
                <>
                  <line
                    id="svg-sr-line-reclaim"
                    x1="0"
                    x2="100%"
                    y1="-1000"
                    y2="-1000"
                    stroke="#c084fc"
                    strokeDasharray="4 3"
                    strokeWidth="1.5"
                  />
                  <g id="svg-sr-label-reclaim" transform="translate(10, -1000)">
                    <rect x="5" y="-9" width="240" height="18" fill="#1e1035" rx="3" stroke="#c084fc" strokeWidth="1" />
                    <text x="12" y="4" fill="#c084fc" fontSize="9.5" fontFamily="monospace" fontWeight="bold">
                      {`⚡ RECLAIM SHELF / FVG CE: $${(srOverlay.fvgCe ?? srOverlay.reclaimPrice ?? srOverlay.sweepObMt ?? 0).toFixed(2)}`}
                    </text>
                  </g>
                </>
              )}

              {/* Limit Entry Line & Label */}
              {srOverlay.entryPrice > 0 && (
                <>
                  <line
                    id="svg-sr-line-entry"
                    x1="0"
                    x2="100%"
                    y1="-1000"
                    y2="-1000"
                    stroke="#38bdf8"
                    strokeDasharray="3 3"
                    strokeWidth="2"
                  />
                  <g id="svg-sr-label-entry" transform="translate(10, -1000)">
                    <rect
                      x="5"
                      y="-9"
                      width={entryCollidesWithAnchor ? 285 : 190}
                      height="18"
                      fill="#0c2340"
                      rx="3"
                      stroke="#38bdf8"
                      strokeWidth="1.2"
                    />
                    <text x="12" y="4" fill="#38bdf8" fontSize="9.5" fontFamily="monospace" fontWeight="bold">
                      {entryCollidesWithAnchor
                        ? `🎯 S&R ENTRY / ⚓ SHELF (${srOverlay.type === 'BULLISH' ? 'LONG' : 'SHORT'}): $${srOverlay.entryPrice.toFixed(2)}`
                        : `🎯 S&R ENTRY (${srOverlay.type === 'BULLISH' ? 'LONG' : 'SHORT'}): $${srOverlay.entryPrice.toFixed(2)}`}
                    </text>

                    {/* Interactive Setup Audit Badge */}
                    <g
                      className="pointer-events-auto cursor-pointer"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsAuditPopoverOpen((prev) => !prev);
                      }}
                    >
                      <rect
                        x={entryCollidesWithAnchor ? 295 : 200}
                        y="-9"
                        width="70"
                        height="18"
                        fill="#0369a1"
                        rx="3"
                        stroke="#38bdf8"
                        strokeWidth="1"
                      />
                      <text
                        x={entryCollidesWithAnchor ? 301 : 206}
                        y="4"
                        fill="#ffffff"
                        fontSize="9"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        🔍 AUDIT
                      </text>
                    </g>
                  </g>
                </>
              )}

              {/* Stop Loss & Take Profit Target Lines - GATED to Active / Open Positions */}
              {isPositionOpen && (
                <>
                  {/* Stop Loss Line & Label (Dynamic Multi-Stage Trailing Color & Label) */}
                  {srOverlay.stopLoss > 0 && (
                    <>
                      <line
                        id="svg-sr-line-sl"
                        x1="0"
                        x2="100%"
                        y1="-1000"
                        y2="-1000"
                        stroke={
                          srOverlay.isStage2Filled
                            ? '#34d399'
                            : srOverlay.isStage1Filled
                            ? '#facc15'
                            : '#f43f5e'
                        }
                        strokeDasharray="4 2"
                        strokeWidth="1.5"
                      />
                      <g id="svg-sr-label-sl" transform="translate(10, -1000)">
                        <rect
                          x="5"
                          y="-9"
                          width={srOverlay.isStage2Filled ? 220 : srOverlay.isStage1Filled ? 215 : 200}
                          height="18"
                          fill={
                            srOverlay.isStage2Filled
                              ? '#02140f'
                              : srOverlay.isStage1Filled
                              ? '#281c03'
                              : '#2c0b0e'
                          }
                          rx="3"
                          stroke={
                            srOverlay.isStage2Filled
                              ? '#34d399'
                              : srOverlay.isStage1Filled
                              ? '#facc15'
                              : '#f43f5e'
                          }
                          strokeWidth="1"
                        />
                        <text
                          x="12"
                          y="4"
                          fill={
                            srOverlay.isStage2Filled
                              ? '#34d399'
                              : srOverlay.isStage1Filled
                              ? '#facc15'
                              : '#f43f5e'
                          }
                          fontSize="9.5"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {`🛑 S&R SL: $${srOverlay.stopLoss.toFixed(2)} ${
                            srOverlay.isStage2Filled
                              ? '(+1.0R FLOOR)'
                              : srOverlay.isStage1Filled
                              ? '(FVG CE / BE)'
                              : '(-1.0R HARD)'
                          }`}
                        </text>
                      </g>
                    </>
                  )}

                  {/* Stage 1 Target (50% @ 1.0R) - Unmounts when Stage 1 is Filled */}
                  {srOverlay.target1 > 0 && !srOverlay.isStage1Filled && (
                    <>
                      <line
                        id="svg-sr-line-tp1"
                        x1="0"
                        x2="100%"
                        y1="-1000"
                        y2="-1000"
                        stroke="#34d399"
                        strokeDasharray="4 2"
                        strokeWidth="1.5"
                      />
                      <g id="svg-sr-label-tp1" transform="translate(10, -1000)">
                        <rect x="5" y="-9" width="205" height="18" fill="#06281e" rx="3" stroke="#34d399" strokeWidth="1" />
                        <text x="12" y="4" fill="#34d399" fontSize="9.5" fontFamily="monospace" fontWeight="bold">
                          {`🏆 TP1 (50% @ 1.0R): $${srOverlay.target1.toFixed(2)}`}
                        </text>
                      </g>
                    </>
                  )}

                  {/* Stage 2 Target (50% @ 1.4R) - Unmounts when Stage 2 is Filled */}
                  {srOverlay.target2 > 0 && !srOverlay.isStage2Filled && (
                    <>
                      <line
                        id="svg-sr-line-tp2"
                        x1="0"
                        x2="100%"
                        y1="-1000"
                        y2="-1000"
                        stroke="#10b981"
                        strokeDasharray="4 2"
                        strokeWidth="1.5"
                      />
                      <g id="svg-sr-label-tp2" transform="translate(10, -1000)">
                        <rect x="5" y="-9" width="205" height="18" fill="#042018" rx="3" stroke="#10b981" strokeWidth="1" />
                        <text x="12" y="4" fill="#10b981" fontSize="9.5" fontFamily="monospace" fontWeight="bold">
                          {`💎 TP2 (50% @ 1.4R): $${srOverlay.target2.toFixed(2)}`}
                        </text>
                      </g>
                    </>
                  )}

                  {/* Stage 3 Target (20% @ 3.0R Runner) - Unmounts when Stage 3 is Filled */}
                  {srOverlay.target3 > 0 && !srOverlay.isStage3Filled && (
                    <>
                      <line
                        id="svg-sr-line-tp3"
                        x1="0"
                        x2="100%"
                        y1="-1000"
                        y2="-1000"
                        stroke="#059669"
                        strokeDasharray="4 2"
                        strokeWidth="1.5"
                      />
                      <g id="svg-sr-label-tp3" transform="translate(10, -1000)">
                        <rect x="5" y="-9" width="220" height="18" fill="#02140f" rx="3" stroke="#059669" strokeWidth="1" />
                        <text x="12" y="4" fill="#059669" fontSize="9.5" fontFamily="monospace" fontWeight="bold">
                          {`🚀 TP3 RUNNER (20% @ 3.0R): $${srOverlay.target3.toFixed(2)}`}
                        </text>
                      </g>
                    </>
                  )}
                </>
              )}
            </g>
          );
        })()}
      </svg>

      {/* Dynamic Layer Orchestrator HTML Overlays */}
      {registry.getAll().map((layer) => {
        const isEnabled = visibility[layer.id] !== false;
        const activeData = marketContextData;
        if (!isEnabled || !layer.renderHtml || !chartRef.current || !seriesRef.current || !activeData) {
          if (htmlLayerCacheRef.current[layer.id]) {
            delete htmlLayerCacheRef.current[layer.id];
          }
          return null;
        }

        const storage = getLayerStorage(layer.id);
        const context = {
          chart: chartRef.current,
          series: seriesRef.current,
          seriesMarkers: seriesMarkersRef.current,
          data: activeData,
          activeCandles: localCandles,
          theme: (theme === 'dark' ? 'dark' : 'light') as 'dark' | 'light',
          themeSettings,
          storage,
          structureState: activeStructureState || structureState,
          contextAnchorTimestamp,
        };

        try {
          return (
            <React.Fragment key={layer.id}>
              {layer.renderHtml(context)}
            </React.Fragment>
          );
        } catch (err) {
          console.error(`[LayerOrchestrator] Failed to render HTML layer ${layer.id}:`, err);
          return null;
        }
      })}

      {/* Persistent Layer Visibility Control HUD Panel */}
      <ChartLayerHud />

      {/* Active Sweep & Reclaim Replay HUD Badge */}
      {srOverlay && (
        <div className="absolute top-12 left-14 z-20 pointer-events-auto select-none bg-card/90 backdrop-blur-md border border-card-border/80 px-3 py-2 rounded-xl shadow-2xl flex flex-col gap-1 max-w-[280px] animate-[fade-in_0.2s_ease-out]">
          <div className="flex items-center justify-between gap-2 border-b border-card-border/40 pb-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full animate-ping bg-accent" />
              <span className="text-[10px] font-black text-foreground tracking-wider uppercase">
                S&R 3-Pillar
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsAuditPopoverOpen((prev) => !prev)}
                className="text-[8.5px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 hover:bg-sky-500/30 transition-colors cursor-pointer"
                title="Inspect Displacement & Risk Metrics"
              >
                🔍 Audit
              </button>
              <span
                className={`text-[9px] font-black uppercase px-1.5 py-0.2 rounded border ${
                  srOverlay.type === 'BULLISH'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                }`}
              >
                {srOverlay.type} ({srOverlay.phase})
              </span>
            </div>
          </div>

          <div className="text-[9.5px] font-mono text-muted flex justify-between items-center">
            <span>{srOverlay.anchorName}</span>
            <span className="font-bold text-foreground">${srOverlay.anchorLevel.toFixed(2)}</span>
          </div>

          {/* 3-Pillar Displacement Status */}
          <div className="grid grid-cols-3 gap-1 pt-1 text-[8.5px] font-mono text-center">
            <div
              className={`px-1 py-0.5 rounded border ${
                srOverlay.volExpansion >= 1.5
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-card text-muted border-card-border'
              }`}
              title="Volume Expansion vs 20-SMA"
            >
              Vol: {srOverlay.volExpansion.toFixed(1)}x
            </div>
            <div
              className={`px-1 py-0.5 rounded border ${
                srOverlay.deltaDominance >= 60
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-card text-muted border-card-border'
              }`}
              title="Taker Delta Dominance %"
            >
              Δ {srOverlay.deltaDominance.toFixed(0)}%
            </div>
            <div
              className={`px-1 py-0.5 rounded border ${
                srOverlay.bodyRatio >= 60
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-card text-muted border-card-border'
              }`}
              title="Candle Body Ratio %"
            >
              Body: {srOverlay.bodyRatio.toFixed(0)}%
            </div>
          </div>

          {/* Active P&L / Status text */}
          <div className="text-[9px] font-mono font-bold text-accent pt-0.5 flex justify-between">
            <span>{srOverlay.statusText}</span>
            {srOverlay.unrealizedR !== 0 && (
              <span className={srOverlay.unrealizedR > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {srOverlay.unrealizedR > 0 ? '+' : ''}
                {srOverlay.unrealizedR.toFixed(2)}R
              </span>
            )}
          </div>
        </div>
      )}

      {/* Interactive Setup & Displacement Origin Audit Popover */}
      {isAuditPopoverOpen && srOverlay && (
        <div
          className="absolute top-14 left-14 z-50 max-w-lg w-[480px] bg-card/98 backdrop-blur-2xl border border-sky-500/40 rounded-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] p-4 text-xs font-sans text-foreground animate-in fade-in zoom-in-95 duration-150 pointer-events-auto select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-card-border pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse" />
              <span className="font-mono text-xs font-black uppercase tracking-wider text-sky-500 dark:text-sky-400">
                Institutional Setup Audit
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                  srOverlay.isPositionOpen || srOverlay.phase === 'OPEN'
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                }`}
              >
                {srOverlay.isPositionOpen || srOverlay.phase === 'OPEN' ? 'Position Active' : 'Pending Retest Limit'}
              </span>
            </div>
            <button
              onClick={() => setIsAuditPopoverOpen(false)}
              className="w-6 h-6 rounded-md hover:bg-card-border/20 flex items-center justify-center text-muted hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Core Geometry Grid */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-card-border/10 border border-card-border/40 p-2.5 rounded-xl">
              <span className="text-[9px] font-bold text-muted uppercase font-mono block mb-1">
                Execution Geometry
              </span>
              <div className="flex items-baseline justify-between font-mono text-[11px]">
                <span className="text-muted">Direction:</span>
                <span className={`font-bold ${srOverlay.type === 'BULLISH' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {srOverlay.type === 'BULLISH' ? 'LONG 🐂' : 'SHORT 🐻'}
                </span>
              </div>
              <div className="flex items-baseline justify-between font-mono text-[11px] mt-0.5">
                <span className="text-muted">Planned Entry:</span>
                <span className="font-bold text-sky-500 dark:text-sky-400">${srOverlay.entryPrice.toFixed(2)}</span>
              </div>
              <div className="flex items-baseline justify-between font-mono text-[11px] mt-0.5">
                <span className="text-muted">Anchor Shelf:</span>
                <span className="text-foreground">{srOverlay.anchorName} (${srOverlay.anchorLevel.toFixed(2)})</span>
              </div>
            </div>

            <div className="bg-card-border/10 border border-card-border/40 p-2.5 rounded-xl">
              <span className="text-[9px] font-bold text-muted uppercase font-mono block mb-1">
                Risk Parameters
              </span>
              <div className="flex items-baseline justify-between font-mono text-[11px]">
                <span className="text-muted">Initial Stop Loss:</span>
                <span className="font-bold text-rose-600 dark:text-rose-400">${srOverlay.stopLoss.toFixed(2)}</span>
              </div>
              <div className="flex items-baseline justify-between font-mono text-[11px] mt-0.5">
                <span className="text-muted">Risk Distance:</span>
                <span className="text-foreground">${Math.abs(srOverlay.entryPrice - srOverlay.stopLoss).toFixed(2)}</span>
              </div>
              <div className="flex items-baseline justify-between font-mono text-[11px] mt-0.5">
                <span className="text-muted">Risk Capital:</span>
                <span className="text-amber-600 dark:text-amber-400 font-bold">${(srOverlay.riskUsd ?? Math.abs(srOverlay.entryPrice - srOverlay.stopLoss)).toFixed(2)} ({(srOverlay.riskPct ?? 1.0).toFixed(2)}%)</span>
              </div>
            </div>
          </div>

          {/* Projected Profit Target Continuum */}
          <div className="bg-card-border/10 border border-card-border/40 p-2.5 rounded-xl mb-3">
            <span className="text-[9px] font-bold text-muted uppercase font-mono block mb-1.5">
              Projected 2-Stage Dynamic Harvest Continuum
            </span>
            <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
              <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <div className="text-emerald-600 dark:text-emerald-400 font-bold text-[10.5px]">TP1 (50% @ 1.0R)</div>
                <div className="text-foreground font-bold text-xs mt-0.5">${srOverlay.target1.toFixed(2)}</div>
                <div className="text-[8.5px] text-muted mt-0.5">Trails SL to BE / FVG CE</div>
              </div>
              <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <div className="text-emerald-600 dark:text-emerald-400 font-bold text-[10.5px]">TP2 (50% @ 1.4R)</div>
                <div className="text-foreground font-bold text-xs mt-0.5">${srOverlay.target2.toFixed(2)}</div>
                <div className="text-[8.5px] text-muted mt-0.5">100% Full Position Close</div>
              </div>
            </div>
          </div>

          {/* 3-Pillar Volumetric Conviction */}
          <div className="bg-card-border/10 border border-card-border/40 p-2.5 rounded-xl mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-bold text-muted uppercase font-mono">
                3-Pillar Volumetric Conviction
              </span>
              {srOverlay.threePillarsPassed ? (
                <span className="text-[9px] font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  ✓ 3-Pillars Confirmed
                </span>
              ) : (
                <span className="text-[9px] font-mono font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                  ✗ Pillars Failed
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
              <div className="p-1.5 bg-card border border-card-border rounded-lg text-center">
                <span className="text-muted text-[8.5px] block">P1 Volume Exp</span>
                <span className="font-bold text-foreground text-xs">{srOverlay.volExpansion.toFixed(2)}x</span>
                <span className="text-[8px] text-muted block">vs 20-SMA</span>
              </div>
              <div className="p-1.5 bg-card border border-card-border rounded-lg text-center">
                <span className="text-muted text-[8.5px] block">P2 Taker Delta</span>
                <span className="font-bold text-foreground text-xs">{srOverlay.deltaDominance.toFixed(1)}%</span>
                <span className="text-[8px] text-muted block">{srOverlay.type === 'BULLISH' ? 'Taker Buy' : 'Taker Sell'}</span>
              </div>
              <div className="p-1.5 bg-card border border-card-border rounded-lg text-center">
                <span className="text-muted text-[8.5px] block">P3 Body Ratio</span>
                <span className="font-bold text-foreground text-xs">{srOverlay.bodyRatio.toFixed(1)}%</span>
                <span className="text-[8px] text-muted block">Conviction</span>
              </div>
            </div>
          </div>

          {/* Displacement Origin Audit (3 Candles) */}
          <div className="bg-card-border/10 border border-card-border/40 p-2.5 rounded-xl">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-bold text-muted uppercase font-mono">
                Displacement Origin Audit (3-Candle Impulse Leg)
              </span>
              <span className="text-[8.5px] font-mono text-muted">
                {srOverlay.displacementCandles && srOverlay.displacementCandles.length > 0 ? 'Exact Kline Coordinates' : 'Algorithmic Anchor Bounds'}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 font-mono text-[9.5px]">
              {srOverlay.displacementCandles && srOverlay.displacementCandles.length > 0 ? (
                srOverlay.displacementCandles.map((dc, idx) => {
                  const d = new Date(dc.time > 1e11 ? dc.time : dc.time * 1000);
                  const dateStr = d.toLocaleString('en-US', {
                    timeZone: 'Africa/Cairo',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  }).replace(',', '') + ' (Cairo)';
                  const isBull = dc.close >= dc.open;
                  return (
                    <div key={idx} className="p-2 bg-card border border-card-border rounded-lg flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sky-500 dark:text-sky-300 text-[10px]">{dc.label}</span>
                        <span className="text-[8.5px] text-muted font-mono">{dateStr}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-1 text-[9px]">
                        <div><span className="text-muted">O: </span><span className="text-foreground">${dc.open.toFixed(2)}</span></div>
                        <div><span className="text-muted">H: </span><span className="text-emerald-600 dark:text-emerald-400">${dc.high.toFixed(2)}</span></div>
                        <div><span className="text-muted">L: </span><span className="text-rose-600 dark:text-rose-400">${dc.low.toFixed(2)}</span></div>
                        <div><span className="text-muted">C: </span><span className={isBull ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>${dc.close.toFixed(2)}</span></div>
                        {dc.volume !== undefined && (
                          <div><span className="text-muted">V: </span><span className="text-foreground">{dc.volume.toFixed(1)}</span></div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-2.5 bg-black/40 border border-white/5 rounded-lg text-[9.5px] text-muted text-center flex flex-col gap-1">
                  <div>Displacement leg confirmed at anchor shelf <span className="text-sky-300 font-bold">${srOverlay.anchorLevel.toFixed(2)}</span>.</div>
                  <div className="text-[8.5px] text-muted/80">
                    Sweep Extreme: {srOverlay.sweepPrice !== null && srOverlay.sweepPrice !== undefined ? `$${srOverlay.sweepPrice.toFixed(2)}` : 'Awaiting Retest'} ➔ Reclaim Close: {srOverlay.reclaimPrice !== null && srOverlay.reclaimPrice !== undefined ? `$${srOverlay.reclaimPrice.toFixed(2)}` : 'Confirmed at Shelf'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Interactive User Drawing Canvas Overlay */}
      <DrawingCanvasOverlay
        chart={chartRef.current}
        series={seriesRef.current}
        candles={localCandles}
        drawings={userDrawings}
        selectedDrawingId={selectedDrawingId}
        activeTool={activeDrawingTool}
        isGlobalVisible={isDrawingsVisible}
        toolStyles={drawingToolStyles}
        onAddDrawing={addUserDrawing}
        onUpdateDrawing={updateUserDrawing}
        onSelectDrawing={setSelectedDrawingId}
        onDeleteDrawing={deleteUserDrawing}
        onDuplicateDrawing={duplicateUserDrawing}
        onToggleLock={toggleDrawingLock}
        onUpdateStyle={updateSelectedDrawingStyle}
        symbol={symbol}
        interval={interval}
      />

      {/* Floating Drawing Tool Suite Dock */}
      <DrawingToolbar
        activeTool={activeDrawingTool}
        onSelectTool={setActiveDrawingTool}
        activeColor={drawingToolStyles[activeDrawingTool === 'CURSOR' ? 'LINE' : activeDrawingTool]?.strokeColor || '#38bdf8'}
        onChangeColor={(hex) => {
          if (activeDrawingTool === 'CURSOR') {
            setDrawingToolStyle('LINE', { strokeColor: hex });
            setDrawingToolStyle('RECTANGLE', { strokeColor: hex, fillColor: hex });
            setDrawingToolStyle('FREEHAND', { strokeColor: hex });
          } else {
            setDrawingToolStyle(activeDrawingTool, {
              strokeColor: hex,
              ...(activeDrawingTool === 'RECTANGLE' ? { fillColor: hex } : {}),
            });
          }
        }}
        isGlobalVisible={isDrawingsVisible}
        onToggleVisibility={toggleDrawingsVisibility}
        onUndo={undoDrawing}
        onRedo={redoDrawing}
        onClearAll={clearUserDrawings}
        drawingCount={userDrawings.length}
      />

      {/* Dynamic DOM Overlays */}
      <div className="absolute right-0 top-0 bottom-0 w-28 pointer-events-none z-10 overflow-hidden">
        {countdownText && (
          <div
            ref={countdownRef}
            className="absolute right-[56px] -translate-y-1/2 pointer-events-none flex items-center justify-center bg-card/95 border border-card-border text-[10px] text-muted font-mono font-bold tracking-wider px-1.5 py-[2px] rounded-sm shadow-md transition-none"
            style={{ top: '-100px' }}
          >
            {countdownText}
          </div>
        )}
        {alertLabelPositions.map((pos) => (
          <div
            key={pos.id}
            className={`absolute right-[56px] pointer-events-auto flex items-center gap-1.5 bg-card/95 border px-1.5 py-0.5 rounded-sm shadow-xl transition-all duration-150 ${pos.status === 'triggered' ? 'opacity-65 hover:bg-card/90' : 'hover:bg-card-border/20'
              }`}
            style={{
              top: `${pos.y - 11}px`, // Vertically centered on the price line
              borderColor: pos.color,
            }}
          >
            {/* Color-coded alert moniker */}
            <span
              className="text-[9px] font-mono font-bold tracking-wider"
              style={{ color: pos.color }}
            >
              {pos.status === 'triggered' ? 'SPENT' : 'ALERT'}
            </span>

            {/* High precision monospace price value */}
            <span className="text-[9px] font-mono text-foreground font-semibold select-none">
              {pos.price.toFixed(2)}
            </span>

            {/* Interactive Settings icon */}
            <button
              onClick={(e) => {
                e.stopPropagation(); // Avoid triggering map drop placement
                setSelectedAlertId(pos.id);
                setSettingsModalTab('price');
                setIsSettingsModalOpen(true);
              }}
              className="p-0.5 text-muted hover:text-foreground transition-colors cursor-pointer rounded-sm hover:bg-card-border/20"
              title="Alert Settings"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3 h-3"
              >
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>

            {/* Hover-to-Delete icon */}
            <button
              onClick={(e) => {
                e.stopPropagation(); // Avoid triggering map drop placement
                setAlerts((prev) => prev.filter((a) => a.id !== pos.id));
              }}
              className="p-0.5 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer rounded-sm"
              title="Delete Alert"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-2.5 h-2.5"
              >
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Top Left HUD - Candle Info */}
      {hudCandle && (
        <div className="absolute top-4 left-14 bg-card/95 border border-card-border px-3 py-1 rounded-lg shadow-xl backdrop-blur-md pointer-events-none z-10 flex flex-wrap items-center gap-x-4 gap-y-1 select-none font-mono text-[11px]">
          <div className="flex items-center gap-1">
            <span className="text-muted">O</span>
            <span className="text-foreground font-semibold">{hudCandle.open.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted">H</span>
            <span className="text-emerald-600 dark:text-[#50ffaf] font-semibold">{hudCandle.high.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted">L</span>
            <span className="text-rose-600 dark:text-[#ffb4ab] font-semibold">{hudCandle.low.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted">C</span>
            <span className={hudCandle.close >= hudCandle.open ? 'text-emerald-600 dark:text-[#50ffaf] font-semibold' : 'text-rose-600 dark:text-[#ffb4ab] font-semibold'}>
              {hudCandle.close.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted">V</span>
            <span className="text-foreground font-semibold">
              {hudCandle.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
          {hudCandle.open > 0 && (
            <div className="flex items-center gap-1 pl-2 border-l border-card-border">
              <span className={`font-semibold ${hudCandle.close >= hudCandle.open ? 'text-emerald-600 dark:text-[#50ffaf]' : 'text-rose-600 dark:text-[#ffb4ab]'}`}>
                {hudCandle.close >= hudCandle.open ? '+' : ''}{(((hudCandle.close - hudCandle.open) / hudCandle.open) * 100).toFixed(2)}%
              </span>
            </div>
          )}

          {/* V8.7: BTC Live Price Indicator */}
          {marketContextData?.correlation_data?.btc_live_price && (
            <div className="flex items-center gap-1 pl-2 border-l border-card-border">
              <span className="text-muted">BTC</span>
              <span className="text-foreground font-semibold">
                ${marketContextData.correlation_data.btc_live_price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </span>
            </div>
          )}

          {/* V8.7: Correlation Pulse Indicator */}
          {smtContext && (
            <div className="flex items-center gap-1.5 pl-2 border-l border-card-border">
              <span className="text-muted">PULSE</span>
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${hasMicroDivergence ? 'bg-amber-500 animate-pulse shadow-[0_0_8px_#f59e0b]' : 'bg-emerald-500 dark:bg-[#50ffaf] shadow-[0_0_6px_#50ffaf]'}`}></span>
                <span className={`font-mono text-[9px] uppercase tracking-wider ${hasMicroDivergence ? 'text-amber-500 dark:text-amber-400 font-bold' : 'text-emerald-600 dark:text-[#50ffaf]/80'}`}>
                  {hasMicroDivergence ? 'SMT_DIV' : 'SYNCED'}
                </span>
              </div>
            </div>
          )}

          {/* Magnet Snapping Control Pill & Target Dropdown */}
          <div className="relative flex items-center gap-1 pl-2 border-l border-card-border pointer-events-auto">
            <button
              onClick={() => {
                const next = !isSnapEnabled;
                setIsSnapEnabled(next);
                try {
                  localStorage.setItem('gem_chart_snap_enabled', String(next));
                } catch {}
                setSnapNotification(next ? `Magnet Snap: ON (${snapTarget})` : 'Magnet Snap: OFF');
                setTimeout(() => setSnapNotification(null), 1800);
              }}
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-black uppercase transition-all flex items-center gap-1 cursor-pointer ${
                isSnapEnabled
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                  : 'bg-card-border/20 text-muted hover:text-foreground border border-card-border/40'
              }`}
              title="Toggle Magnet Snapping (HotKey: 'S')"
            >
              <span>🧲 {isSnapEnabled ? `SNAP: ${snapTarget}` : 'SNAP: OFF'}</span>
            </button>

            <button
              onClick={() => setIsSnapDropdownOpen((prev) => !prev)}
              className="px-1 py-0.5 rounded text-[8px] font-mono font-bold text-muted hover:text-foreground bg-card-border/20 border border-card-border/40 cursor-pointer"
              title="Change Snap Target (Close, High, Low, Open, Nearest)"
            >
              ▾
            </button>

            {isSnapDropdownOpen && (
              <div className="absolute top-7 left-0 z-50 bg-card/98 border border-card-border backdrop-blur-xl rounded-lg p-1 shadow-2xl flex flex-col gap-0.5 min-w-[130px] font-mono text-[9px]">
                {(['CLOSE', 'HIGH', 'LOW', 'OPEN', 'NEAREST'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setSnapTarget(t);
                      try {
                        localStorage.setItem('gem_chart_snap_target', t);
                      } catch {}
                      setIsSnapDropdownOpen(false);
                      if (!isSnapEnabled) {
                        setIsSnapEnabled(true);
                        try {
                          localStorage.setItem('gem_chart_snap_enabled', 'true');
                        } catch {}
                      }
                      setSnapNotification(`Magnet Target: ${t}`);
                      setTimeout(() => setSnapNotification(null), 1800);
                    }}
                    className={`px-2 py-1 text-left rounded font-bold transition-all cursor-pointer ${
                      snapTarget === t && isSnapEnabled
                        ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-black'
                        : 'text-muted hover:text-foreground hover:bg-card-border/20'
                    }`}
                  >
                    Snap to {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Snapped Price Display */}
          {isSnapEnabled && snappedPrice !== null && (
            <div className="flex items-center gap-1 pl-2 border-l border-card-border">
              <span className="text-emerald-600 dark:text-emerald-400 font-bold">SNAPPED:</span>
              <span className="text-emerald-700 dark:text-emerald-300 font-mono font-black">${snappedPrice.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* Floating Magnet Notification Toast */}
      {snapNotification && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 bg-card/98 border border-emerald-500/50 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-black uppercase tracking-wider rounded-lg shadow-2xl backdrop-blur-xl animate-[fadeIn_0.15s_ease-out]">
          🧲 {snapNotification}
        </div>
      )}

      {/* Institutional alert placement HUD */}
      {(isHoveringPriceScale || isHotkeyAlertModeActive) && (
        <div className="absolute top-[48px] left-14 bg-card/95 border border-amber-500/40 px-2.5 py-1.5 rounded-lg shadow-xl pointer-events-none z-10 flex items-center gap-2 select-none animate-[pulse_1.5s_infinite] backdrop-blur-md">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
          <span className="text-[10px] font-mono font-bold tracking-wider text-amber-600 dark:text-amber-400">
            STATUS: ALERT_PLACEMENT_ACTIVE
          </span>
          <span className="text-[9px] font-mono text-muted">
            [CLICK TO DROP / ESC TO ABORT]
          </span>
        </div>
      )}


      {/* Unified Settings Modal Overlay */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        alert={selectedAlertId !== null ? alerts.find((a) => a.id === selectedAlertId) || null : null}
        initialTab={settingsModalTab}
        onClose={() => setIsSettingsModalOpen(false)}
        onSave={(updatedAlert) => {
          setAlerts((prev) => prev.map((a) => (a.id === updatedAlert.id ? updatedAlert : a)));
          setIsSettingsModalOpen(false);
        }}
        onDelete={(alertId) => {
          setAlerts((prev) => prev.filter((a) => a.id !== alertId));
          setIsSettingsModalOpen(false);
        }}
      />

      {/* Isolated Native Canvas Series & Alert Updater */}
      <LiveSeriesCanvasUpdater
        seriesRef={seriesRef}
        localCandlesRef={localCandlesRef}
        setLocalCandles={setLocalCandles}
        scheduleLayoutUpdates={scheduleLayoutUpdates}
        customLiveCandle={propsLiveCandle}
        customLivePrice={propsLivePrice}
        alerts={alerts}
        executeAlert={executeAlert}
        isBacktest={isBacktest}
      />
    </div>
  );
}

interface LiveSeriesCanvasUpdaterProps {
  seriesRef: React.RefObject<any>;
  localCandlesRef: React.RefObject<Candle[]>;
  setLocalCandles: React.Dispatch<React.SetStateAction<Candle[]>>;
  scheduleLayoutUpdates: () => void;
  customLiveCandle?: LiveCandle | null;
  customLivePrice?: number | null;
  alerts: Alert[];
  executeAlert: (alert: Alert) => void;
  isBacktest?: boolean;
}

const LiveSeriesCanvasUpdater = memo(function LiveSeriesCanvasUpdater({
  seriesRef,
  localCandlesRef,
  setLocalCandles,
  scheduleLayoutUpdates,
  customLiveCandle,
  customLivePrice,
  alerts,
  executeAlert,
  isBacktest = false,
}: LiveSeriesCanvasUpdaterProps) {
  const liveContext = useMarketDataLiveContext();
  const liveCandle = customLiveCandle !== undefined ? customLiveCandle : liveContext?.liveCandle;
  const livePrice = customLivePrice !== undefined ? customLivePrice : liveContext?.livePrice;

  const prevPriceRef = useRef<number | null>(null);
  const lastProcessedClosedTimeRef = useRef<number | null>(null);

  // 1. Direct Native Canvas Series Update via Lightweight Charts API (60fps)
  useEffect(() => {
    const candles = localCandlesRef.current;
    if (seriesRef.current && liveCandle && candles && candles.length > 0) {
      try {
        const lastBar = candles[candles.length - 1];
        const lastBarTimeSec = Math.floor(lastBar.t / 1000);
        const lastBarPrice = lastBar.c;

        // ── Outlier Price Sanity Gate (>15% Drop & Canvas Protection) ──
        if (lastBarPrice > 0 && Math.abs(liveCandle.close - lastBarPrice) / lastBarPrice > 0.15) {
          console.warn(`[OUTLIER_DATA_DROP] Rejected chart series update: liveCandle price ${liveCandle.close} deviates >15% from last chart bar ${lastBarPrice}.`);
          return;
        }

        if (liveCandle.time >= lastBarTimeSec) {
          seriesRef.current.update(liveCandle as any);
          scheduleLayoutUpdates();

          const isSameTime = liveCandle.time === lastBarTimeSec;
          if (isSameTime && !liveCandle.isClosed) return;

          setLocalCandles((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            const lastCandle = updated[lastIdx];
            const lastTimeSec = Math.floor(lastCandle.t / 1000);

            const mappedCandle: Candle = {
              t: liveCandle.time * 1000,
              o: liveCandle.open,
              h: liveCandle.high,
              l: liveCandle.low,
              c: liveCandle.close,
              v: liveCandle.volume,
              taker_buy_vol: (liveCandle as any).taker_buy_vol ?? liveCandle.volume / 2,
              taker_sell_vol: (liveCandle as any).taker_sell_vol ?? liveCandle.volume / 2,
              isClosed: liveCandle.isClosed === true,
            };

            if (liveCandle.time === lastTimeSec) {
              updated[lastIdx] = mappedCandle;
            } else if (liveCandle.time > lastTimeSec) {
              updated.push(mappedCandle);
            }
            return updated;
          });
        }
      } catch (error) {
        console.error('[Chart] Lightweight Charts Update Error:', error);
      }
    }
  }, [liveCandle, seriesRef, localCandlesRef, setLocalCandles, scheduleLayoutUpdates]);

  // 2. Alert Crossover Evaluation (Isolated from parent Chart re-renders)
  useEffect(() => {
    if (isBacktest) return;

    const currentPriceForAlerts = livePrice !== null && livePrice !== undefined
      ? livePrice
      : (localCandlesRef.current && localCandlesRef.current.length > 0 ? localCandlesRef.current[localCandlesRef.current.length - 1].c : null);

    if (currentPriceForAlerts === null) return;

    const activeAlerts = alerts.filter((a) => a.status === 'active');
    if (activeAlerts.length === 0) {
      prevPriceRef.current = currentPriceForAlerts;
      return;
    }

    const prevPrice = prevPriceRef.current;

    // A. TOUCH Check (Tick-by-Tick)
    if (prevPrice !== null && prevPrice !== currentPriceForAlerts) {
      const activeTouchAlerts = activeAlerts.filter((a) => a.triggerCondition === 'TOUCH');

      activeTouchAlerts.forEach((alert) => {
        const crossedUp = prevPrice < alert.price && currentPriceForAlerts >= alert.price;
        const crossedDown = prevPrice > alert.price && currentPriceForAlerts <= alert.price;
        const exactHit = currentPriceForAlerts === alert.price;

        if (crossedUp || crossedDown || exactHit) {
          executeAlert(alert);
        }
      });
    }

    // B. Candle Close Check
    if (liveCandle && liveCandle.isClosed && Number(liveCandle.time) !== lastProcessedClosedTimeRef.current) {
      lastProcessedClosedTimeRef.current = Number(liveCandle.time);
      const activeCloseAlerts = activeAlerts.filter((a) => a.triggerCondition !== 'TOUCH');

      activeCloseAlerts.forEach((alert) => {
        let isSatisfied = false;
        if (alert.triggerCondition === 'CLOSE_ABOVE' && liveCandle.close > alert.price) {
          isSatisfied = true;
        } else if (alert.triggerCondition === 'CLOSE_BELOW' && liveCandle.close < alert.price) {
          isSatisfied = true;
        } else if (alert.triggerCondition === 'WICK_PURGE_REJECT') {
          if (alert.price > liveCandle.open && liveCandle.high >= alert.price && liveCandle.close < alert.price) {
            isSatisfied = true;
          } else if (alert.price < liveCandle.open && liveCandle.low <= alert.price && liveCandle.close > alert.price) {
            isSatisfied = true;
          }
        }
        if (isSatisfied) {
          executeAlert(alert);
        }
      });
    }

    prevPriceRef.current = currentPriceForAlerts;
  }, [livePrice, liveCandle, alerts, executeAlert, isBacktest, localCandlesRef]);

  return null;
});

