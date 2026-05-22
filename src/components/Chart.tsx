'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries, SeriesMarker, createSeriesMarkers, ISeriesMarkersPluginApi, LineStyle } from 'lightweight-charts';
import { Candle } from '@/hooks/useMarketData';
import { generateVolumetricMarkers } from '@/utils/generateChartMarkers';
import { useBinanceWS } from '@/hooks/useBinanceWS';
import type { LiveCandle } from '@/hooks/useBinanceWS';
import AlertSettingsModal from './modals/AlertSettingsModal';
import { AlertSound, useAlertSounds } from '@/hooks/useAlertSounds';
import { useMarketDataContext } from '@/context/MarketDataContext';

export interface Alert {
  id: string;
  price: number;
  status: 'active' | 'triggered';
  color: string;
  label?: string;
  triggerCondition?: 'TOUCH' | 'CLOSE_ABOVE' | 'CLOSE_BELOW' | 'WICK_PURGE_REJECT';
  timeframe?: '1m' | '5m' | '15m' | '1h' | '4h' | '1D';
  actionChain?: {
    browserNotification: boolean;
    triggerAiAnalysis: boolean;
    soundAlert: boolean;
  };
  soundSelection?: AlertSound;
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
}

export default function Chart({ data, activeFvgs, localDealingRange, interval = '5m', colors }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const seriesMarkersRef = useRef<ISeriesMarkersPluginApi<any> | null>(null);
  const isInitialLoad = useRef(true);

  // ── Phase 1: Alerts State & Interaction Refs ──────────────────────────────
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [alertLabelPositions, setAlertLabelPositions] = useState<{ id: string; y: number; price: number; color: string; status: 'active' | 'triggered' }[]>([]);
  const [hudPulse, setHudPulse] = useState<'BULLISH' | 'BEARISH' | null>(null);

  const { playSound } = useAlertSounds();
  const { data: marketContextData, triggerAiAnalysisScan } = useMarketDataContext();
  
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
  const { liveCandle, livePrice } = useBinanceWS({ symbol: 'ethusdc', interval });

  const {
    upColor = '#50ffaf', // Cyan accent
    downColor = '#ffb4ab', // Purple accent
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
            timeZone: 'UTC',
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
            timeZone: 'UTC',
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

    // Crosshair movement listener
    const handleCrosshairMove = (param: any) => {
      if (param && param.time) {
        cursorTimeRef.current = Number(param.time);
      } else {
        cursorTimeRef.current = null;
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

  // ── Sync Historical Data & Markers ───────────────────────────────────────
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
      seriesRef.current.setData(formattedData);

      const sortedDataForMarkers = [...data].sort((a, b) => a.t - b.t);
      const markers = generateVolumetricMarkers(sortedDataForMarkers);
      seriesMarkersRef.current?.setMarkers(markers);

      if (isInitialLoad.current) {
        chartRef.current?.timeScale().fitContent();
        isInitialLoad.current = false;
      }
      
      // Update coordinates
      updateAlertPositions();
    }
  }, [data]); // eslint-disable-next-line react-hooks/exhaustive-deps

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

    const handleChartUpdate = () => {
      updateAlertPositions();
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
  }, [alerts, updateAlertPositions]);

  // ── Phase 2: Live Candle Injection & Snapping Update ─────────────────────
  useEffect(() => {
    if (seriesRef.current && liveCandle) {
      try {
        console.log('[Chart] Live Candle Time:', liveCandle.time, '| Close:', liveCandle.close);
        seriesRef.current.update(liveCandle as any);
        
        // Live price can resize or rescale the chart, sync badges immediately
        updateAlertPositions();
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
      playSound(alert.soundSelection);
    }

    // 3. Browser Notification if enabled and granted
    if (alert.actionChain?.browserNotification && typeof window !== 'undefined' && 'Notification' in window) {
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
  }, [playSound, upColor, marketContextData]);

  const prevPriceRef = useRef<number | null>(null);
  const lastProcessedClosedTimeRef = useRef<number | null>(null);

  // Monitor tick-by-tick and bar-by-bar
  useEffect(() => {
    if (livePrice === null) return;
    
    const activeAlerts = alerts.filter((a) => a.status === 'active');
    if (activeAlerts.length === 0) {
      prevPriceRef.current = livePrice;
      return;
    }

    const prevPrice = prevPriceRef.current;

    // A. TOUCH Check (Tick-by-Tick)
    if (prevPrice !== null && prevPrice !== livePrice) {
      const activeTouchAlerts = activeAlerts.filter((a) => a.triggerCondition === 'TOUCH');
      
      activeTouchAlerts.forEach((alert) => {
        const crossedUp = prevPrice < alert.price && livePrice >= alert.price;
        const crossedDown = prevPrice > alert.price && livePrice <= alert.price;
        const exactHit = livePrice === alert.price;

        if (crossedUp || crossedDown || exactHit) {
          console.log(`[ALERT] TOUCH condition satisfied for alert ${alert.id} (${alert.label}) at tick: ${livePrice}`);
          executeAlert(alert);
        }
      });
    }

    // B. Candle Close Check (CLOSE_ABOVE, CLOSE_BELOW, WICK_PURGE_REJECT)
    if (liveCandle && liveCandle.isClosed && Number(liveCandle.time) !== lastProcessedClosedTimeRef.current) {
      lastProcessedClosedTimeRef.current = Number(liveCandle.time);

      const activeCloseAlerts = activeAlerts.filter((a) => a.triggerCondition !== 'TOUCH');

      activeCloseAlerts.forEach((alert) => {
        let isSatisfied = false;

        if (alert.triggerCondition === 'CLOSE_ABOVE') {
          if (liveCandle.close > alert.price) {
            isSatisfied = true;
          }
        } else if (alert.triggerCondition === 'CLOSE_BELOW') {
          if (liveCandle.close < alert.price) {
            isSatisfied = true;
          }
        } else if (alert.triggerCondition === 'WICK_PURGE_REJECT') {
          // If alert was placed above candle open (resistance line)
          if (alert.price > liveCandle.open) {
            if (liveCandle.high >= alert.price && liveCandle.close < alert.price) {
              isSatisfied = true;
            }
          }
          // If alert was placed below candle open (support line)
          else if (alert.price < liveCandle.open) {
            if (liveCandle.low <= alert.price && liveCandle.close > alert.price) {
              isSatisfied = true;
            }
          }
        }

        if (isSatisfied) {
          console.log(`[ALERT] ${alert.triggerCondition} condition satisfied for alert ${alert.id} (${alert.label}) at close: ${liveCandle.close}`);
          executeAlert(alert);
        }
      });
    }

    // Always keep prevPriceRef synced with current live price tick
    prevPriceRef.current = livePrice;

  }, [livePrice, liveCandle, alerts, executeAlert]);

  return (
    <div className="w-full h-full relative group">
      {/* The Chart Canvas container */}
      <div 
        ref={chartContainerRef} 
        className="w-full h-full absolute inset-0 cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleChartClick}
      />

      {/* HTML Overlays for Placed Alerts */}
      <div className="absolute right-0 top-0 bottom-0 w-28 pointer-events-none z-10 overflow-hidden">
        {alertLabelPositions.map((pos) => (
          <div
            key={pos.id}
            className={`absolute right-[56px] pointer-events-auto flex items-center gap-1.5 bg-[#141416]/95 border px-1.5 py-0.5 rounded-sm shadow-xl transition-all duration-150 ${
              pos.status === 'triggered' ? 'opacity-65 hover:bg-[#141416]/90' : 'hover:bg-[#1c1c1f]'
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
 
      {/* Institutional alert placement HUD */}
      {(isHoveringPriceScale || isHotkeyAlertModeActive) && (
        <div className="absolute top-4 left-4 bg-[#0e0e0f]/95 border border-[#4a4457]/50 px-2.5 py-1.5 rounded-none shadow-xl pointer-events-none z-10 flex items-center gap-2 select-none animate-[pulse_1.5s_infinite]">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
          <span className="text-[10px] font-mono font-bold tracking-wider text-amber-400">
            STATUS: ALERT_PLACEMENT_ACTIVE
          </span>
          <span className="text-[9px] font-mono text-white/50">
            [CLICK TO DROP / ESC TO ABORT]
          </span>
        </div>
      )}

      {/* Alert Settings Modal Overlay */}
      <AlertSettingsModal
        isOpen={selectedAlertId !== null}
        alert={alerts.find((a) => a.id === selectedAlertId) || null}
        onClose={() => setSelectedAlertId(null)}
        onSave={(updatedAlert) => {
          setAlerts((prev) => prev.map((a) => (a.id === updatedAlert.id ? updatedAlert : a)));
          setSelectedAlertId(null);
        }}
        onDelete={(alertId) => {
          setAlerts((prev) => prev.filter((a) => a.id !== alertId));
          setSelectedAlertId(null);
        }}
      />

      {/* HUD Pulse Visual Overlay */}
      {hudPulse && (
        <div 
          className={`absolute inset-0 pointer-events-none z-20 border-2 transition-all duration-300 ${
            hudPulse === 'BULLISH' 
              ? 'border-[#50ffaf]/60 shadow-[inset_0_0_100px_rgba(80,255,175,0.25)] bg-[#50ffaf]/5' 
              : 'border-[#ffb4ab]/60 shadow-[inset_0_0_100px_rgba(255,180,171,0.25)] bg-[#ffb4ab]/5'
          }`}
        />
      )}
    </div>
  );
}

