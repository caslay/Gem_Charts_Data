'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries, SeriesMarker, createSeriesMarkers, ISeriesMarkersPluginApi, LineStyle } from 'lightweight-charts';
import { Candle, MarketDataPayload } from '@/hooks/useMarketData';
import { generateVolumetricMarkers } from '@/utils/generateChartMarkers';
import type { LiveCandle } from '@/hooks/useBinanceWS';
import SettingsModal, { Alert } from './modals/SettingsModal';
import { AlertSound, useAlertSounds } from '@/hooks/useAlertSounds';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import { Volume2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import { registry } from '@/lib/chartLayers/registry';
import { useLayerStore } from '@/lib/chartLayers/store';
import ChartLayerHud from './ChartLayerHud';
// Imports of detectActiveFVGs, mapAndConsolidateFVGs, and analyzeMarketStructure removed to prevent main-thread blocking calculations

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
  const [activeDragLine, setActiveDragLine] = useState<'entry' | 'tp' | 'sl' | null>(null);
  const activeDragLineRef = useRef<'entry' | 'tp' | 'sl' | null>(null);

  // Open Trades Price Line Refs mapping tradeId -> { entryLine, tpLine, slLine }
  const openTradesLinesRef = useRef<Map<string, { entry: any; tp: any; sl: any }>>(new Map());
  const [activeDragTradeLine, setActiveDragTradeLine] = useState<{ tradeId: string; type: 'tp' | 'sl' } | null>(null);
  const activeDragTradeLineRef = useRef<{ tradeId: string; type: 'tp' | 'sl' } | null>(null);

  // Zustand persistent chart layer store visibility states
  const { visibility } = useLayerStore();
  const layerStorageRef = useRef<Map<string, Map<string, any>>>(new Map());

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

  // Sync data prop to local state
  useEffect(() => {
    setLocalCandles(data);
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

  // ── Phase 1: Alerts State & Interaction Refs ──────────────────────────────
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [alertLabelPositions, setAlertLabelPositions] = useState<{ id: string; y: number; price: number; color: string; status: 'active' | 'triggered' }[]>([]);
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

  // Unified modal overlay triggers
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<'price' | 'signal'>('price');

  const { playSound, playFile } = useAlertSounds();
  const context = useMarketDataContext();
  const liveContext = useMarketDataLiveContext();

  const marketContextData = propsMarketContextData !== undefined ? propsMarketContextData : context.data;
  const livePrice = propsLivePrice !== undefined ? propsLivePrice : liveContext.livePrice;
  const liveCandle = propsLiveCandle !== undefined ? propsLiveCandle : liveContext.liveCandle;
  const themeSettings = propsThemeSettings !== undefined ? propsThemeSettings : context.themeSettings;
  const { triggerAiAnalysisScan, signalAlerts, signalAlertsEnabled, triggerSmartAlert: contextTriggerSmartAlert, setWsInterval, loadMoreHistory: contextLoadMoreHistory, isFetchingMore: contextIsFetchingMore, structureState: liveStructureState, contextAnchorTimestamp: liveContextAnchorTimestamp } = context;
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
    setWsInterval(interval as any);
  }, [interval, setWsInterval, isBacktest]);

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
        const referenceVal = livePrice || hoverCandle.c;
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
  }, [data, livePrice]);

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

    setAlertLabelPositions(positions);
  }, [alerts]);

  // ── Ghost Line Performance Mechanics ──────────────────────────────────────
  const updateGhostLine = useCallback((offsetY: number, hoverTime: number | null) => {
    const series = seriesRef.current;
    if (!series) return;

    const rawPrice = series.coordinateToPrice(offsetY);
    if (rawPrice === null) return;

    const price = snapPrice(rawPrice, hoverTime);
    ghostPriceRef.current = price;

    const referencePrice = livePrice || (data && data.length > 0 ? data[data.length - 1].c : 0);
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
  }, [snapPrice, livePrice, data, upColor, downColor]);

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
    if (activeDragLineRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const containerWidth = rect.width;

    const gridWidth = chartRef.current.timeScale().width();
    const isOverYAxis = offsetX >= gridWidth && offsetX <= containerWidth;

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
      const referencePrice = livePrice || (data && data.length > 0 ? data[data.length - 1].c : 0);
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

  // ── Sync Open Trades Price Lines ───────────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    // Remove all existing open trade lines
    openTradesLinesRef.current.forEach((lines) => {
      if (lines.entry) series.removePriceLine(lines.entry);
      if (lines.tp) series.removePriceLine(lines.tp);
      if (lines.sl) series.removePriceLine(lines.sl);
    });
    openTradesLinesRef.current.clear();

    if (!openTrades || openTrades.length === 0) return;

    const tpColor = themeSettings?.theme_manual_tp_line || '#10b981';
    const slColor = themeSettings?.theme_manual_sl_line || '#ef4444';

    openTrades.forEach((trade) => {
      const tradeId = trade.id;
      const entryPriceVal = parseFloat(String(trade.entry_price));
      const tpPriceVal = parseFloat(String(trade.take_profit));
      const slPriceVal = parseFloat(String(trade.stop_loss));

      const entryLine = series.createPriceLine({
        price: entryPriceVal,
        color: '#71717a', // Muted zinc-500
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `OPEN ENTRY (${trade.direction})`,
      });

      let tpLine = null;
      if (tpPriceVal > 0 && !isNaN(tpPriceVal)) {
        tpLine = series.createPriceLine({
          price: tpPriceVal,
          color: tpColor,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `OPEN TP (${trade.direction})`,
        });
      }

      let slLine = null;
      if (slPriceVal > 0 && !isNaN(slPriceVal)) {
        slLine = series.createPriceLine({
          price: slPriceVal,
          color: slColor,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `OPEN SL (${trade.direction})`,
        });
      }

      openTradesLinesRef.current.set(tradeId, { entry: entryLine, tp: tpLine, sl: slLine });
    });

    return () => {
      if (seriesRef.current) {
        openTradesLinesRef.current.forEach((lines) => {
          if (lines.entry) seriesRef.current?.removePriceLine(lines.entry);
          if (lines.tp) seriesRef.current?.removePriceLine(lines.tp);
          if (lines.sl) seriesRef.current?.removePriceLine(lines.sl);
        });
        openTradesLinesRef.current.clear();
      }
    };
  }, [openTrades, themeSettings, theme]);

  // ── Drag & Drop Pointer Event Handlers ─────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!chartRef.current || !seriesRef.current) return;
    if (e.button !== 0) return; // Only left-click
    
    const rect = e.currentTarget.getBoundingClientRect();
    const pointerY = e.clientY - rect.top;
    
    const series = seriesRef.current;
    
    const clickThreshold = 12;
    let target: 'entry' | 'tp' | 'sl' | 'open-tp' | 'open-sl' | null = null;
    let minDistance = clickThreshold;
    
    // 1. Check manual order entry layout lines (if active)
    if (isManualTradingActive) {
      const entryY = manualEntryPrice !== null ? series.priceToCoordinate(manualEntryPrice) : null;
      const tpY = manualTakeProfit !== null ? series.priceToCoordinate(manualTakeProfit) : null;
      const slY = manualStopLoss !== null ? series.priceToCoordinate(manualStopLoss) : null;
      
      if (entryY !== null && manualOrderType !== 'MARKET') {
        const dist = Math.abs(pointerY - entryY);
        if (dist < minDistance) {
          minDistance = dist;
          target = 'entry';
        }
      }
      if (tpY !== null) {
        const dist = Math.abs(pointerY - tpY);
        if (dist < minDistance) {
          minDistance = dist;
          target = 'tp';
        }
      }
      if (slY !== null) {
        const dist = Math.abs(pointerY - slY);
        if (dist < minDistance) {
          minDistance = dist;
          target = 'sl';
        }
      }
    }
    
    // 2. Check open trades lines
    if (openTrades && openTrades.length > 0) {
      for (const trade of openTrades) {
        const lines = openTradesLinesRef.current.get(trade.id);
        if (!lines) continue;
        
        const tpPriceVal = parseFloat(trade.take_profit);
        const slPriceVal = parseFloat(trade.stop_loss);
        
        const tpY = lines.tp && tpPriceVal > 0 ? series.priceToCoordinate(tpPriceVal) : null;
        const slY = lines.sl && slPriceVal > 0 ? series.priceToCoordinate(slPriceVal) : null;
        
        if (tpY !== null) {
          const dist = Math.abs(pointerY - tpY);
          if (dist < minDistance) {
            minDistance = dist;
            target = 'open-tp';
            activeDragTradeLineRef.current = { tradeId: trade.id, type: 'tp' };
          }
        }
        if (slY !== null) {
          const dist = Math.abs(pointerY - slY);
          if (dist < minDistance) {
            minDistance = dist;
            target = 'open-sl';
            activeDragTradeLineRef.current = { tradeId: trade.id, type: 'sl' };
          }
        }
      }
    }
    
    if (target) {
      e.preventDefault();
      e.stopPropagation();
      
      if (target === 'entry' || target === 'tp' || target === 'sl') {
        activeDragLineRef.current = target;
        setActiveDragLine(target);
      } else {
        setActiveDragTradeLine(activeDragTradeLineRef.current);
      }
      
      chartRef.current.applyOptions({
        handleScroll: false,
        handleScale: false,
      });
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seriesRef.current) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const pointerY = e.clientY - rect.top;
    const rawPrice = seriesRef.current.coordinateToPrice(pointerY);
    if (rawPrice === null || isNaN(rawPrice)) return;
    
    const snappedPrice = Math.round(rawPrice / 0.05) * 0.05;
    
    // A. Handle manual layout lines
    if (activeDragLineRef.current && onManualPricesChange) {
      let nextEntry = manualEntryPrice ?? 0;
      let nextTp = manualTakeProfit ?? 0;
      let nextSl = manualStopLoss ?? 0;
      
      if (activeDragLineRef.current === 'entry' && manualOrderType !== 'MARKET') {
        nextEntry = snappedPrice;
      } else if (activeDragLineRef.current === 'tp') {
        nextTp = snappedPrice;
      } else if (activeDragLineRef.current === 'sl') {
        nextSl = snappedPrice;
      }
      
      onManualPricesChange(nextEntry, nextTp, nextSl);
    }
    
    // B. Handle open trades lines (smooth sliding feedback)
    if (activeDragTradeLineRef.current) {
      const { tradeId, type } = activeDragTradeLineRef.current;
      const lines = openTradesLinesRef.current.get(tradeId);
      if (lines) {
        const lineToUpdate = type === 'tp' ? lines.tp : lines.sl;
        if (lineToUpdate) {
          lineToUpdate.applyOptions({ price: snappedPrice });
        }
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    // 1. Finish manual layout drag
    if (activeDragLineRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      activeDragLineRef.current = null;
      setActiveDragLine(null);
    }
    
    // 2. Finish open trade drag and submit update
    if (activeDragTradeLineRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      const { tradeId, type } = activeDragTradeLineRef.current;
      
      const trade = openTrades?.find((t) => t.id === tradeId);
      if (trade && onUpdateTradeLevels) {
        const lines = openTradesLinesRef.current.get(tradeId);
        const finalPrice = type === 'tp' ? lines?.tp?.options().price : lines?.sl?.options().price;
        if (finalPrice !== undefined && finalPrice !== null) {
          const nextTp = type === 'tp' ? finalPrice : parseFloat(trade.take_profit);
          const nextSl = type === 'sl' ? finalPrice : parseFloat(trade.stop_loss);
          onUpdateTradeLevels(tradeId, nextTp, nextSl);
        }
      }
      activeDragTradeLineRef.current = null;
      setActiveDragTradeLine(null);
    }
    
    // 3. Restore scroll/scale options
    if (chartRef.current) {
      chartRef.current.applyOptions({
        handleScroll: true,
        handleScale: true
      });
    }
  };

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

          // Look up volume from liveCandle or historical data
          let volume = 0;
          const hoverTime = Number(param.time);

          if (liveCandle && Number(liveCandle.time) === hoverTime) {
            volume = liveCandle.volume;
          } else {
            const histCandle = dataRef.current?.find(
              (d) => Math.floor(d.t / 1000) === hoverTime
            );
            if (histCandle) {
              volume = histCandle.v;
            }
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
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
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
      const formattedData = data.map((d) => ({
        time: (Math.floor(d.t / 1000)) as any,
        open: d.o,
        high: d.h,
        low: d.l,
        close: d.c,
      }));

      formattedData.sort((a, b) => a.time - b.time);

      // Calculate shift count for left-edge prepends
      let prependedCount = 0;
      if (prevFirstCandleTimeRef.current !== null && !isInitialLoad.current) {
        prependedCount = data.filter((c) => c.t < prevFirstCandleTimeRef.current!).length;
      }

      seriesRef.current.setData(formattedData);

      if (isInitialLoad.current) {
        if (isBacktest) {
          // comfortable standard logical range zoom (last 150 candles) for replay parity
          const totalCount = formattedData.length;
          if (totalCount > 150) {
            chartRef.current?.timeScale().setVisibleRange({
              from: formattedData[totalCount - 150].time,
              to: formattedData[totalCount - 1].time,
            });
          } else {
            chartRef.current?.timeScale().fitContent();
          }
        } else {
          chartRef.current?.timeScale().fitContent();
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

  // ── Dynamic Recalculations for Real-Time WebSocket Reactivity ──────────────
  const activeStructureState = useMemo(() => {
    if (!structureState) return null;
    const currentPrice = livePrice ?? (localCandles[localCandles.length - 1]?.c ?? 0);

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
  }, [structureState, livePrice, localCandles]);

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
    const isInteracting = activeDragLine !== null || 
      activeDragTradeLine !== null || 
      isHotkeyAlertModeActive || 
      hoveredCandle !== null;

    if (!isNewCandle && !isViewportChanged && !isInteracting && lastClosedTRef.current !== null) {
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
  }, [localCandles, marketContextData, visibility, theme, themeSettings, getLayerStorage, activeStructureState, structureState, contextAnchorTimestamp, context.engineSettings, activeDragLine, activeDragTradeLine, isHotkeyAlertModeActive, hoveredCandle]);

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

  // ── Zoom/Scroll Synchronization ───────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handleChartUpdate = (logicalRange?: any) => {
      updateAlertPositions();
      computeFvgOverlay();

      if (logicalRange && logicalRange.from < 15 && loadMoreHistory && !isFetchingMore) {
        loadMoreHistory();
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
  }, [alerts, updateAlertPositions, loadMoreHistory, isFetchingMore]); // eslint-disable-next-line react-hooks/exhaustive-deps

  // ── V8.6: FVG Overlay Pixel Calculator (Finite & Anchored) ───────────────
  const computeFvgOverlay = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || !activeFvgs || activeFvgs.length === 0) {
      setFvgOverlayBoxes([]);
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

    setFvgOverlayBoxes(boxes);
  }, [activeFvgs]);

  // Recompute FVG overlay whenever activeFvgs or localCandles updates
  useEffect(() => {
    computeFvgOverlay();
  }, [activeFvgs, localCandles, computeFvgOverlay]);

  // ── Phase 2: Live Candle Injection & Snapping Update ─────────────────────
  useEffect(() => {
    const candles = localCandlesRef.current;
    if (seriesRef.current && liveCandle && candles && candles.length > 0) {
      try {
        const lastBar = candles[candles.length - 1];
        const lastBarTimeSec = Math.floor(lastBar.t / 1000);

        if (liveCandle.time >= lastBarTimeSec) {
          // Update the lightweight chart series
          seriesRef.current.update(liveCandle as any);
          updateAlertPositions();

          // Sync into localCandles state
          setLocalCandles(prev => {
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
              isClosed: liveCandle.isClosed === true
            };

            if (liveCandle.time === lastTimeSec) {
              // Overwrite or update the last candle
              updated[lastIdx] = mappedCandle;
            } else if (liveCandle.time > lastTimeSec) {
              // Append a new candle
              updated.push(mappedCandle);
            }
            return updated;
          });
        }
      } catch (error) {
        console.error('[Chart] Lightweight Charts Update Error:', error);
      }
    }
  }, [liveCandle, updateAlertPositions]);

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
  }, [playSound, upColor, marketContextData, triggerSmartAlert, triggerAiAnalysisScan]);

  const prevPriceRef = useRef<number | null>(null);
  const lastProcessedClosedTimeRef = useRef<number | null>(null);

  // Reset chart scaling and tracking refs when timeframe interval changes
  useEffect(() => {
    isInitialLoad.current = true;
    prevPriceRef.current = null;
    lastProcessedClosedTimeRef.current = null;
    setHoveredCandle(null);
  }, [interval]);

  // Monitor tick-by-tick and bar-by-bar
  useEffect(() => {
    if (isBacktest) return;

    // 1. Resolve current active price (with WebSocket-to-REST fallback)
    const currentPriceForAlerts = livePrice !== null
      ? livePrice
      : (data && data.length > 0 ? data[data.length - 1].c : null);

    if (currentPriceForAlerts === null) return;

    const activeAlerts = alerts.filter((a) => a.status === 'active');
    if (activeAlerts.length === 0) {
      prevPriceRef.current = currentPriceForAlerts;
      return;
    }

    const prevPrice = prevPriceRef.current;

    console.log('[Chart Component] Tick crossover check:', {
      livePrice,
      fallbackPrice: data && data.length > 0 ? data[data.length - 1].c : null,
      currentPriceForAlerts,
      prevPrice,
      activeAlertsCount: activeAlerts.length
    });

    // A. TOUCH Check (Tick-by-Tick)
    if (prevPrice !== null && prevPrice !== currentPriceForAlerts) {
      const activeTouchAlerts = activeAlerts.filter((a) => a.triggerCondition === 'TOUCH');

      activeTouchAlerts.forEach((alert) => {
        const crossedUp = prevPrice < alert.price && currentPriceForAlerts >= alert.price;
        const crossedDown = prevPrice > alert.price && currentPriceForAlerts <= alert.price;
        const exactHit = currentPriceForAlerts === alert.price;

        if (crossedUp || crossedDown || exactHit) {
          console.log(`[ALERT] TOUCH condition satisfied for alert ${alert.id} (${alert.label}) at price: ${currentPriceForAlerts}`);
          executeAlert(alert);
        }
      });
    }

    // B. Candle Close Check (CLOSE_ABOVE, CLOSE_BELOW, WICK_PURGE_REJECT)
    // Resolve candle to evaluate: either live kline, or the last historical candle when it is closed
    const activeCandle = liveCandle
      ? liveCandle
      : (data && data.length > 0
        ? {
          time: Math.floor(data[data.length - 1].t / 1000),
          open: data[data.length - 1].o,
          high: data[data.length - 1].h,
          low: data[data.length - 1].l,
          close: data[data.length - 1].c,
          volume: data[data.length - 1].v,
          isClosed: true // REST polled candles are by definition completed
        }
        : null);

    if (activeCandle && activeCandle.isClosed && Number(activeCandle.time) !== lastProcessedClosedTimeRef.current) {
      lastProcessedClosedTimeRef.current = Number(activeCandle.time);

      const activeCloseAlerts = activeAlerts.filter((a) => a.triggerCondition !== 'TOUCH');

      activeCloseAlerts.forEach((alert) => {
        let isSatisfied = false;

        if (alert.triggerCondition === 'CLOSE_ABOVE') {
          if (activeCandle.close > alert.price) {
            isSatisfied = true;
          }
        } else if (alert.triggerCondition === 'CLOSE_BELOW') {
          if (activeCandle.close < alert.price) {
            isSatisfied = true;
          }
        } else if (alert.triggerCondition === 'WICK_PURGE_REJECT') {
          // If alert was placed above candle open (resistance line)
          if (alert.price > activeCandle.open) {
            if (activeCandle.high >= alert.price && activeCandle.close < alert.price) {
              isSatisfied = true;
            }
          }
          // If alert was placed below candle open (support line)
          else if (alert.price < activeCandle.open) {
            if (activeCandle.low <= alert.price && activeCandle.close > alert.price) {
              isSatisfied = true;
            }
          }
        }

        if (isSatisfied) {
          console.log(`[ALERT] ${alert.triggerCondition} condition satisfied for alert ${alert.id} (${alert.label}) at close: ${activeCandle.close}`);
          executeAlert(alert);
        }
      });
    }

    // Always keep prevPriceRef synced with current live price tick
    prevPriceRef.current = currentPriceForAlerts;

  }, [livePrice, liveCandle, data, alerts, executeAlert]);

  // Resolve the candle to show in the HUD (top left)
  // 1. If user is hovering a candle, show the hovered candle
  // 2. Otherwise, if there is a liveCandle, show the live candle
  // 3. Otherwise, if there is historical data, show the last candle
  const hudCandle = (() => {
    if (hoveredCandle) {
      return hoveredCandle;
    }
    if (liveCandle) {
      return {
        open: liveCandle.open,
        high: liveCandle.high,
        low: liveCandle.low,
        close: liveCandle.close,
        volume: liveCandle.volume,
      };
    }
    if (data && data.length > 0) {
      const last = data[data.length - 1];
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
          cursor: activeDragLine || activeDragTradeLine ? 'ns-resize' : isManualTradingActive ? 'crosshair' : 'default'
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleChartClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

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

        const lastClosedT = localCandles[localCandles.length - 2]?.t;
        const isNewCandle = lastClosedTRef.current !== lastClosedT;

        const visibleRange = chartRef.current.timeScale().getVisibleLogicalRange();
        const isViewportChanged = !lastVisibleRangeRef.current || 
          lastVisibleRangeRef.current.from !== visibleRange?.from || 
          lastVisibleRangeRef.current.to !== visibleRange?.to;

        const isDataChanged = lastDataPayloadRef.current !== activeData;

        // Force rebuild HTML nodes only if candle closed, viewport changed, data changed, or cache is missing
        const shouldRecalculate = isNewCandle || isViewportChanged || isDataChanged || !htmlLayerCacheRef.current[layer.id];

        if (!shouldRecalculate && htmlLayerCacheRef.current[layer.id]) {
          return htmlLayerCacheRef.current[layer.id];
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
          const rendered = (
            <React.Fragment key={layer.id}>
              {layer.renderHtml(context)}
            </React.Fragment>
          );
          htmlLayerCacheRef.current[layer.id] = rendered;
          return rendered;
        } catch (err) {
          console.error(`[LayerOrchestrator] Failed to render HTML layer ${layer.id}:`, err);
          return null;
        }
      })}

      {/* Persistent Layer Visibility Control HUD Panel */}
      <ChartLayerHud />

      {/* HTML Overlays for Placed Alerts */}
      <div className="absolute right-0 top-0 bottom-0 w-28 pointer-events-none z-10 overflow-hidden">
        {alertLabelPositions.map((pos) => (
          <div
            key={pos.id}
            className={`absolute right-[56px] pointer-events-auto flex items-center gap-1.5 bg-[#141416]/95 border px-1.5 py-0.5 rounded-sm shadow-xl transition-all duration-150 ${pos.status === 'triggered' ? 'opacity-65 hover:bg-[#141416]/90' : 'hover:bg-[#1c1c1f]'
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
            <span className="text-[9px] font-mono text-white/80 font-semibold select-none">
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
              className="p-0.5 text-white/50 hover:text-white transition-colors cursor-pointer rounded-sm hover:bg-white/10"
              title="Alert Settings"
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
        <div className="absolute top-4 left-4 bg-[#0e0e0f]/80 backdrop-blur-md border border-[#4a4457]/30 px-3 py-1 rounded-none shadow-xl pointer-events-none z-10 flex flex-wrap items-center gap-x-4 gap-y-1 select-none font-mono text-[11px]">
          <div className="flex items-center gap-1">
            <span className="text-white/40">O</span>
            <span className="text-[#e5e2e3] font-medium">{hudCandle.open.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-white/40">H</span>
            <span className="text-[#50ffaf] font-medium">{hudCandle.high.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-white/40">L</span>
            <span className="text-[#ffb4ab] font-medium">{hudCandle.low.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-white/40">C</span>
            <span className={hudCandle.close >= hudCandle.open ? 'text-[#50ffaf] font-medium' : 'text-[#ffb4ab] font-medium'}>
              {hudCandle.close.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-white/40">V</span>
            <span className="text-[#e5e2e3] font-medium">
              {hudCandle.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
          {hudCandle.open > 0 && (
            <div className="flex items-center gap-1 pl-2 border-l border-[#4a4457]/30">
              <span className={`font-semibold ${hudCandle.close >= hudCandle.open ? 'text-[#50ffaf]' : 'text-[#ffb4ab]'}`}>
                {hudCandle.close >= hudCandle.open ? '+' : ''}{(((hudCandle.close - hudCandle.open) / hudCandle.open) * 100).toFixed(2)}%
              </span>
            </div>
          )}

          {/* V8.7: BTC Live Price Indicator */}
          {marketContextData?.correlation_data?.btc_live_price && (
            <div className="flex items-center gap-1 pl-2 border-l border-[#4a4457]/30">
              <span className="text-white/40">BTC</span>
              <span className="text-[#e5e2e3] font-semibold">
                ${marketContextData.correlation_data.btc_live_price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </span>
            </div>
          )}

          {/* V8.7: Correlation Pulse Indicator */}
          {smtContext && (
            <div className="flex items-center gap-1.5 pl-2 border-l border-[#4a4457]/30">
              <span className="text-white/40">PULSE</span>
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${hasMicroDivergence ? 'bg-amber-500 animate-pulse shadow-[0_0_8px_#f59e0b]' : 'bg-[#50ffaf] shadow-[0_0_6px_#50ffaf]'}`}></span>
                <span className={`font-mono text-[9px] uppercase tracking-wider ${hasMicroDivergence ? 'text-amber-400 font-bold' : 'text-[#50ffaf]/80'}`}>
                  {hasMicroDivergence ? 'SMT_DIV' : 'SYNCED'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Institutional alert placement HUD */}
      {(isHoveringPriceScale || isHotkeyAlertModeActive) && (
        <div className="absolute top-[48px] left-4 bg-[#0e0e0f]/95 border border-[#4a4457]/50 px-2.5 py-1.5 rounded-none shadow-xl pointer-events-none z-10 flex items-center gap-2 select-none animate-[pulse_1.5s_infinite]">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
          <span className="text-[10px] font-mono font-bold tracking-wider text-amber-400">
            STATUS: ALERT_PLACEMENT_ACTIVE
          </span>
          <span className="text-[9px] font-mono text-white/50">
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

      {/* HUD Pulse Visual Overlay */}
      {hudPulse && (
        <div
          className={`absolute inset-0 pointer-events-none z-20 border-2 transition-all duration-300 ${hudPulse === 'BULLISH'
            ? 'border-[#50ffaf]/60 shadow-[inset_0_0_100px_rgba(80,255,175,0.25)] bg-[#50ffaf]/5'
            : 'border-[#ffb4ab]/60 shadow-[inset_0_0_100px_rgba(255,180,171,0.25)] bg-[#ffb4ab]/5'
            }`}
        />
      )}
    </div>
  );
}

