'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { init, dispose, registerOverlay, Chart, KLineData, Period } from 'klinecharts';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import { Candle } from '@/lib/fvgEngine';
import { generateVolumetricMarkers } from '@/utils/generateChartMarkers';
import { useTheme } from 'next-themes';
import {
  TrendingUp,
  Square,
  Slash,
  Trash2,
  MousePointer,
  Layers,
  Activity,
  Zap,
  RefreshCw,
  BarChart2,
  Compass
} from 'lucide-react';

// Register custom FVG Rectangle Overlay template for KLineCharts v10
try {
  registerOverlay({
    name: 'fvgRect',
    totalStep: 3,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const p0 = coordinates[0];
      const p1 = coordinates[1];
      return [
        {
          type: 'polygon',
          attrs: {
            coordinates: [
              { x: p0.x, y: p0.y },
              { x: p1.x, y: p0.y },
              { x: p1.x, y: p1.y },
              { x: p0.x, y: p1.y }
            ]
          },
          styles: overlay.styles?.polygon as any
        }
      ];
    }
  });

  // Register custom Pivot Dot Overlay template for KLineCharts v10
  registerOverlay({
    name: 'pivotDot',
    totalStep: 2,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 1) return [];
      const p0 = coordinates[0];
      return [
        {
          type: 'circle',
          attrs: {
            x: p0.x,
            y: p0.y,
            r: 3
          },
          styles: overlay.styles?.circle as any
        }
      ];
    }
  });
} catch (e) {
  // Catch any re-registration warnings
}

interface KLineChartSandboxProps {
  height?: string | number;
}

type DrawingTool = 'none' | 'segment' | 'rayLine' | 'rectangle' | 'fibonacciLine' | 'priceLine';

const getPeriodFromInterval = (interval: string): Period => {
  if (interval === '1m') return { type: 'minute', span: 1 };
  if (interval === '3m') return { type: 'minute', span: 3 };
  if (interval === '5m') return { type: 'minute', span: 5 };
  if (interval === '15m') return { type: 'minute', span: 15 };
  if (interval === '30m') return { type: 'minute', span: 30 };
  if (interval === '1h') return { type: 'hour', span: 1 };
  if (interval === '4h') return { type: 'hour', span: 4 };
  return { type: 'minute', span: 5 };
};

export default function KLineChartSandbox({ height = 'calc(100vh - 180px)' }: KLineChartSandboxProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const { theme } = useTheme();

  // Context market data
  const {
    data: marketDataPayload,
    wsInterval,
    setWsInterval,
    refetch,
    wsStatus
  } = useMarketDataContext();

  const { liveCandle, livePrice } = useMarketDataLiveContext();

  // Local state for toggles and drawing tools
  const [activeTool, setActiveTool] = useState<DrawingTool>('none');
  const [showFVG, setShowFVG] = useState(true);
  const [showStructure, setShowStructure] = useState(true);
  const [showVolumetrics, setShowVolumetrics] = useState(true);

  // Performance telemetry
  const [fps, setFps] = useState<number>(60);
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());
  const liveWsCallbackRef = useRef<((data: KLineData) => void) | null>(null);

  // Measure FPS
  useEffect(() => {
    let animId: number;
    const calcFps = () => {
      frameCountRef.current++;
      const now = performance.now();
      if (now - lastFpsTimeRef.current >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / (now - lastFpsTimeRef.current)));
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }
      animId = requestAnimationFrame(calcFps);
    };
    animId = requestAnimationFrame(calcFps);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Strict sanitization, deduplication, and ascending sort of candle data for KLineCharts v10
  const formatAndSortCandles = useCallback((candles: any[]): KLineData[] => {
    if (!Array.isArray(candles) || candles.length === 0) return [];
    const map = new Map<number, KLineData>();

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (!c) continue;

      const rawTime = c.t ?? c.time ?? c.timestamp ?? 0;
      const ts = typeof rawTime === 'number'
        ? (rawTime > 1e10 ? Math.floor(rawTime) : Math.floor(rawTime * 1000))
        : Date.now();

      const open = Number(c.o ?? c.open ?? 0);
      const high = Number(c.h ?? c.high ?? open);
      const low = Number(c.l ?? c.low ?? open);
      const close = Number(c.c ?? c.close ?? open);
      const volume = Number(c.v ?? c.volume ?? 0);

      if (open > 0 && high > 0 && low > 0 && close > 0 && !isNaN(ts)) {
        map.set(ts, {
          timestamp: ts,
          open,
          high,
          low,
          close,
          volume
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, []);

  // Extract active candle array from MarketDataPayload based on current wsInterval
  const activeCandles: Candle[] = React.useMemo(() => {
    if (!marketDataPayload?.data_payload) return [];

    const candlesKey = `candles_${wsInterval}`;
    const targetCandles = marketDataPayload.data_payload[candlesKey];
    if (Array.isArray(targetCandles) && targetCandles.length > 0) {
      return targetCandles;
    }

    // Secondary fallback: check any available key
    const keys = Object.keys(marketDataPayload.data_payload).filter((k) => k.startsWith('candles_'));
    for (const key of keys) {
      const arr = marketDataPayload.data_payload[key];
      if (Array.isArray(arr) && arr.length > 0) {
        return arr;
      }
    }

    return [];
  }, [marketDataPayload, wsInterval]);

  const activeCandlesRef = useRef(activeCandles);
  useEffect(() => {
    activeCandlesRef.current = activeCandles;
  }, [activeCandles]);

  // Handle Timeframe Switching (updates interval & refetches historical data)
  const handleTimeframeChange = useCallback(
    (tf: '1m' | '3m' | '5m' | '15m' | '1h' | '4h') => {
      console.log('[KLineChartSandbox] Switching timeframe to:', tf);
      setWsInterval(tf);
      if (chartRef.current) {
        chartRef.current.setPeriod(getPeriodFromInterval(tf));
        chartRef.current.resetData();
      }
      refetch();
    },
    [setWsInterval, refetch]
  );

  // Handle Container Resize Observer
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      chartRef.current?.resize();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Chart initialization effect
  useEffect(() => {
    if (!containerRef.current) return;

    // Safely dispose any previous instance on the container to prevent duplicate canvas layers in StrictMode
    try {
      dispose(containerRef.current);
    } catch (e) {
      // ignore
    }

    // Initialize KLineCharts v10 instance
    const chart = init(containerRef.current, {
      styles: {
        grid: {
          show: true,
          horizontal: { show: true, color: 'rgba(255, 255, 255, 0.05)', style: 'dashed', dashedValue: [4, 4], size: 1 },
          vertical: { show: true, color: 'rgba(255, 255, 255, 0.05)', style: 'dashed', dashedValue: [4, 4], size: 1 }
        },
        candle: {
          type: 'candle_solid',
          bar: {
            upColor: '#50ffaf',
            downColor: '#ffb4ab',
            noChangeColor: '#94a3b8',
            upBorderColor: '#50ffaf',
            downBorderColor: '#ffb4ab',
            noChangeBorderColor: '#94a3b8',
            upWickColor: '#50ffaf',
            downWickColor: '#ffb4ab',
            noChangeWickColor: '#94a3b8',
            compareRule: 'current_open'
          },
          tooltip: {
            showRule: 'follow_cross',
            showType: 'rect'
          }
        },
        xAxis: {
          show: true,
          size: 'auto',
          axisLine: { show: true, color: '#1e293b', size: 1 },
          tickLine: { show: true, color: '#1e293b', size: 1, length: 4 },
          tickText: { show: true, color: '#94a3b8', size: 11, family: 'sans-serif', weight: 'normal', marginStart: 4, marginEnd: 4 }
        },
        yAxis: {
          show: true,
          size: 'auto',
          axisLine: { show: true, color: '#1e293b', size: 1 },
          tickLine: { show: true, color: '#1e293b', size: 1, length: 4 },
          tickText: { show: true, color: '#94a3b8', size: 11, family: 'sans-serif', weight: 'normal', marginStart: 4, marginEnd: 4 }
        },
        separator: {
          color: '#1e293b',
          size: 1,
          activeBackgroundColor: '#3b82f6'
        },
        crosshair: {
          show: true,
          horizontal: {
            show: true,
            line: { show: true, color: '#64748b', style: 'dashed', dashedValue: [4, 4], size: 1 },
            text: { show: true, color: '#f8fafc', size: 11, family: 'sans-serif', weight: 'normal', backgroundColor: '#0f172a', style: 'fill', borderStyle: 'solid', borderColor: '#334155', borderSize: 1, borderRadius: 2, borderDashedValue: [0, 0], paddingLeft: 4, paddingTop: 2, paddingRight: 4, paddingBottom: 2 },
            features: []
          },
          vertical: {
            show: true,
            line: { show: true, color: '#64748b', style: 'dashed', dashedValue: [4, 4], size: 1 },
            text: { show: true, color: '#f8fafc', size: 11, family: 'sans-serif', weight: 'normal', backgroundColor: '#0f172a', style: 'fill', borderStyle: 'solid', borderColor: '#334155', borderSize: 1, borderRadius: 2, borderDashedValue: [0, 0], paddingLeft: 4, paddingTop: 2, paddingRight: 4, paddingBottom: 2 }
          }
        }
      }
    });

    if (chart) {
      chartRef.current = chart;
      (typeof window !== 'undefined') && ((window as any).__kline_chart__ = chart);

      chart.setSymbol({ ticker: 'ETHUSDC', pricePrecision: 2, volumePrecision: 4 });
      chart.setPeriod(getPeriodFromInterval(wsInterval));

      // Register DataLoader BEFORE calling resetData()
      chart.setDataLoader({
        getBars: ({ callback }) => {
          const formatted = formatAndSortCandles(activeCandlesRef.current);
          if (formatted.length > 0) {
            callback(formatted, { backward: false, forward: false });
          } else {
            callback([], { backward: true, forward: true });
          }
        },
        subscribeBar: ({ callback }) => {
          liveWsCallbackRef.current = callback;
        },
        unsubscribeBar: () => {
          liveWsCallbackRef.current = null;
        }
      });

      // Add volume indicator
      chart.createIndicator('VOL', false);

      setTimeout(() => {
        chart.resize();
        chart.resetData();
        chart.scrollToRealTime();
      }, 50);
    }

    return () => {
      if (containerRef.current) {
        dispose(containerRef.current);
      }
      chartRef.current = null;
      liveWsCallbackRef.current = null;
    };
  }, [formatAndSortCandles]);

  // Update chart symbol/period/data when activeCandles or wsInterval changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || activeCandles.length === 0) return;

    const formatted = formatAndSortCandles(activeCandles);
    if (formatted.length === 0) return;

    console.log(`[KLineChartSandbox] Loading ${formatted.length} candles for interval ${wsInterval}...`);

    chart.setDataLoader({
      getBars: ({ callback }) => {
        callback(formatted, { backward: false, forward: false });
      },
      subscribeBar: ({ callback }) => {
        liveWsCallbackRef.current = callback;
      },
      unsubscribeBar: () => {
        liveWsCallbackRef.current = null;
      }
    });

    chart.setSymbol({ ticker: 'ETHUSDC', pricePrecision: 2, volumePrecision: 4 });
    chart.setPeriod(getPeriodFromInterval(wsInterval));
    chart.resetData();
    chart.resize();
    requestAnimationFrame(() => {
      chart?.scrollToRealTime();
    });
  }, [activeCandles, wsInterval, formatAndSortCandles]);

  // Handle live WebSocket candle ticks (smooth real-time 60 FPS update)
  useEffect(() => {
    const chart = chartRef.current;
    if (!liveCandle || !chart || activeCandles.length === 0) return;

    const rawTime = liveCandle.time;
    const liveTs = rawTime > 1e10 ? Math.floor(rawTime) : Math.floor(rawTime * 1000);

    const open = Number(liveCandle.open);
    const high = Number(liveCandle.high);
    const low = Number(liveCandle.low);
    const close = Number(liveCandle.close);
    const volume = Number(liveCandle.volume || 0);

    const klineData: KLineData = {
      timestamp: liveTs,
      open,
      high,
      low,
      close,
      volume
    };

    if (liveWsCallbackRef.current) {
      liveWsCallbackRef.current(klineData);
    }
  }, [liveCandle, activeCandles]);

  // Overlays rendering logic (FVGs, Market Structure, Volumetric Markers)
  const renderSmcOverlays = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || activeCandles.length === 0) return;

    // Clear existing automated SMC overlays
    chart.removeOverlay({ groupId: 'smc_overlays' });

    const candles = activeCandles;
    const firstCandle = candles[0];
    const firstRawTime = firstCandle?.t ?? (firstCandle as any)?.time ?? (Date.now() / 1000);
    const firstTs = typeof firstRawTime === 'number' ? (firstRawTime > 1e10 ? firstRawTime : firstRawTime * 1000) : Date.now();

    const lastCandle = candles[candles.length - 1];
    const lastRawTime = lastCandle?.t ?? (lastCandle as any)?.time ?? (Date.now() / 1000);
    const lastTs = typeof lastRawTime === 'number' ? (lastRawTime > 1e10 ? lastRawTime : lastRawTime * 1000) : Date.now();

    // 1. Port Authoritative FVG Layer from Quant Engine ipda_metrics with strict mitigation, price bounds, and timestamp clamping
    if (showFVG) {
      const ipdaMetrics = marketDataPayload?.ipda_metrics;
      const activeFvgs = ipdaMetrics?.active_fvgs || ipdaMetrics?.fvgs || [];

      const minChartPrice = Math.min(...candles.map((c: any) => Number(c.l ?? c.low ?? 0)));
      const maxChartPrice = Math.max(...candles.map((c: any) => Number(c.h ?? c.high ?? 0)));

      activeFvgs.forEach((fvg: any) => {
        if (fvg.status && fvg.status !== 'UNMITIGATED') return;

        const rawOriginTs = fvg.origin_time > 1e10 ? fvg.origin_time : fvg.origin_time * 1000;
        const top = Number(fvg.top ?? fvg.coordinates?.top ?? 0);
        const bottom = Number(fvg.bottom ?? fvg.coordinates?.bottom ?? 0);
        if (top <= 0 || bottom <= 0 || top <= bottom) return;

        // Skip FVGs sitting far out of the current active chart price range
        if (top < minChartPrice || bottom > maxChartPrice) return;

        const isBullish = fvg.type === 'BULLISH' || fvg.type === 'BISI';

        // Check if any subsequent candle in activeCandles has breached/mitigated the FVG boundary
        const isMitigated = candles.some((c: any) => {
          const cTs = c.t > 1e10 ? c.t : c.t * 1000;
          if (cTs <= rawOriginTs) return false;
          const cHigh = Number(c.h ?? c.high ?? 0);
          const cLow = Number(c.l ?? c.low ?? 0);
          return isBullish ? cLow < bottom : cHigh > top;
        });

        // Skip/remove mitigated FVGs
        if (isMitigated) return;

        // Clamp left edge timestamp to visible chart history bound to prevent off-screen rendering
        const createTs = Math.max(rawOriginTs, firstTs);
        const mitigateTs = fvg.mitigated_time
          ? (fvg.mitigated_time > 1e10 ? fvg.mitigated_time : fvg.mitigated_time * 1000)
          : Math.max(createTs + 3600000, lastTs);

        chart.createOverlay({
          name: 'fvgRect',
          groupId: 'smc_overlays',
          points: [
            { timestamp: createTs, value: top },
            { timestamp: mitigateTs, value: bottom }
          ],
          styles: {
            polygon: {
              style: 'stroke_fill',
              color: isBullish ? 'rgba(80, 255, 175, 0.22)' : 'rgba(255, 180, 171, 0.22)',
              borderColor: isBullish ? '#50ffaf' : '#ffb4ab',
              borderSize: 1,
              borderStyle: 'dashed',
              borderDashedValue: [3, 3]
            }
          }
        });
      });
    }

    // 2. Port Authoritative Market Structure Layer (BOS/MSS horizontal breach lines + Pivot dots)
    if (showStructure) {
      try {
        const structureMap = marketDataPayload?.ipda_metrics?.full_structure_map;
        const swings = structureMap?.swings || [];
        const zigzag = structureMap?.zigzag || [];

        // Draw Swings / Pivot Dots within active chart time bounds
        swings.forEach((swing: any) => {
          const swingTs = swing.t > 1e10 ? swing.t : swing.t * 1000;
          if (swingTs < firstTs || swingTs > lastTs) return;

          const price = typeof swing.price === 'string' ? parseFloat(swing.price) : swing.price;
          const isHigh = swing.type === 'HIGH';

          const dotColor = isHigh ? 'rgba(239, 68, 68, 0.9)' : 'rgba(80, 255, 175, 0.9)';

          chart.createOverlay({
            name: 'pivotDot',
            groupId: 'smc_overlays',
            points: [{ timestamp: swingTs, value: price }],
            styles: {
              circle: {
                color: dotColor,
                borderColor: dotColor,
                borderSize: 1,
                radius: 3
              }
            } as any
          });
        });

        // Draw Horizontal BOS / MSS / CHOCH Breach Lines
        zigzag.forEach((seg: any) => {
          if (!seg.label || seg.label === 'INTERNAL') return; // Skip non-breach internal links

          const rawStartTs = seg.from.t > 1e10 ? seg.from.t : seg.from.t * 1000;
          const endTs = seg.to.t > 1e10 ? seg.to.t : seg.to.t * 1000;
          if (endTs < firstTs) return; // Skip historical breaches before loaded history

          const startTs = Math.max(rawStartTs, firstTs);
          const breachPrice = seg.brokenLevel || (typeof seg.to.price === 'string' ? parseFloat(seg.to.price) : seg.to.price);

          const isBOS = seg.label === 'BOS';
          const color = isBOS ? '#a855f7' : '#50ffaf'; // BOS: Purple, MSS: Mint Green

          chart.createOverlay({
            name: 'segment',
            groupId: 'smc_overlays',
            points: [
              { timestamp: startTs, value: breachPrice },
              { timestamp: endTs, value: breachPrice }
            ],
            styles: {
              line: {
                color: color,
                size: 2,
                style: seg.displacementConfirmed ? 'solid' : 'dashed',
                dashedValue: [4, 4]
              }
            }
          });
        });
      } catch (err) {
        console.warn('Market structure analysis error:', err);
      }
    }

    // 3. Port Volumetric Displacement Layer (Arrows & Circles without blue rectangular background)
    if (showVolumetrics) {
      const markers = generateVolumetricMarkers(candles, {
        sponsorshipColor: '#ffffff',
        bullishSweepColor: '#50ffaf',
        bearishSweepColor: '#ffb4ab',
        volumetricStrongArrowColor: '#ff007f',
        theme: 'dark'
      });

      markers.forEach((m: any) => {
        const markerTs = (m.time || 0) * (m.time > 1e10 ? 1 : 1000);

        let symbolText = '▲';
        if (m.shape === 'arrowDown') symbolText = '▼';
        else if (m.shape === 'circle') symbolText = '●';

        const matchCandle: any = candles.find((c: any) => {
          const rawTime = c.t ?? c.time ?? c.timestamp ?? 0;
          const ts = rawTime > 1e10 ? rawTime : rawTime * 1000;
          return ts === markerTs;
        });

        const yVal = m.position === 'belowBar'
          ? (matchCandle?.l ?? matchCandle?.low ?? 0)
          : (matchCandle?.h ?? matchCandle?.high ?? 0);

        chart.createOverlay({
          name: 'simpleAnnotation',
          groupId: 'smc_overlays',
          points: [{ timestamp: markerTs, value: yVal }],
          extendData: symbolText,
          styles: {
            text: {
              color: m.color || '#ffffff',
              size: 13,
              weight: 'bold',
              family: 'sans-serif',
              backgroundColor: 'transparent',
              borderColor: 'transparent',
              borderSize: 0,
              borderRadius: 0,
              paddingLeft: 0,
              paddingRight: 0,
              paddingTop: 0,
              paddingBottom: 0
            }
          }
        });
      });
    }
  }, [activeCandles, marketDataPayload, showFVG, showStructure, showVolumetrics]);

  // Re-render SMC overlays on toggle or payload change
  useEffect(() => {
    renderSmcOverlays();
  }, [renderSmcOverlays]);

  // Handle Drawing Tool activation
  const handleSelectTool = (tool: DrawingTool) => {
    setActiveTool(tool);
    const chart = chartRef.current;
    if (!chart) return;

    if (tool === 'none') return;

    console.log('[KLineChartSandbox] Activating drawing tool:', tool);
    chart.createOverlay({
      name: tool,
      groupId: 'user_drawings',
      onDrawEnd: () => {
        setActiveTool('none');
      }
    });
  };

  // Clear user drawings
  const handleClearUserDrawings = () => {
    const chart = chartRef.current;
    if (chart) {
      chart.removeOverlay({ groupId: 'user_drawings' });
      setActiveTool('none');
    }
  };

  return (
    <div
      className="flex flex-col w-full bg-[#0b0e14] text-slate-100 rounded-xl border border-slate-800 shadow-2xl overflow-hidden"
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
    >
      {/* ── Sandbox Control Header & Toolbar ────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-[#090d16] border-b border-slate-800/80 gap-3 shrink-0">
        {/* Left: Title & Symbol/TF Selection */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-md border border-emerald-500/20 text-xs font-mono font-semibold">
            <Zap className="w-3.5 h-3.5 animate-pulse" />
            <span>KLineChart Sandbox</span>
          </div>

          <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-lg p-0.5 text-xs font-mono">
            {(['1m', '3m', '5m', '15m', '1h', '4h'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => handleTimeframeChange(tf)}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  wsInterval === tf
                    ? 'bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <button
            onClick={() => refetch()}
            className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg border border-slate-800 transition-colors"
            title="Refresh Market Data"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Center: SMC Layer Toggles */}
        <div className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-lg border border-slate-800 text-xs">
          <span className="text-slate-500 font-mono px-2 text-[10px] uppercase tracking-wider">Automated Overlays:</span>
          <button
            onClick={() => setShowFVG(!showFVG)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
              showFVG
                ? 'bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>FVG</span>
          </button>

          <button
            onClick={() => setShowStructure(!showStructure)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
              showStructure
                ? 'bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Compass className="w-3 h-3" />
            <span>BOS/MSS</span>
          </button>

          <button
            onClick={() => setShowVolumetrics(!showVolumetrics)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
              showVolumetrics
                ? 'bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <BarChart2 className="w-3 h-3" />
            <span>Volumetrics</span>
          </button>
        </div>

        {/* Right: Native Drawing Tools & Clear Buttons */}
        <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-lg border border-slate-800 text-xs">
          <span className="text-slate-500 font-mono px-1.5 text-[10px] uppercase tracking-wider">Draw:</span>

          <button
            onClick={() => handleSelectTool('none')}
            className={`p-1.5 rounded-md transition-all ${
              activeTool === 'none' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Select Mode"
          >
            <MousePointer className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => handleSelectTool('segment')}
            className={`p-1.5 rounded-md transition-all ${
              activeTool === 'segment' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Trendline / Segment"
          >
            <Slash className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => handleSelectTool('rayLine')}
            className={`p-1.5 rounded-md transition-all ${
              activeTool === 'rayLine' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Ray Line"
          >
            <TrendingUp className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => handleSelectTool('rectangle')}
            className={`p-1.5 rounded-md transition-all ${
              activeTool === 'rectangle' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Rectangle Zone"
          >
            <Square className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => handleSelectTool('fibonacciLine')}
            className={`p-1.5 rounded-md transition-all ${
              activeTool === 'fibonacciLine' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Fibonacci Retracement"
          >
            <Activity className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-slate-800 mx-1" />

          <button
            onClick={handleClearUserDrawings}
            className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors"
            title="Clear User Drawings"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Chart Container Element ────────────────────────────────────────── */}
      <div className="relative flex-1 w-full min-h-[550px] overflow-hidden" style={{ minHeight: '550px' }}>
        <div
          ref={containerRef}
          className="w-full h-full min-h-[550px]"
          style={{ width: '100%', height: '100%', minHeight: '550px' }}
        />

        {/* Live Status HUD Overlay */}
        <div className="absolute bottom-3 left-4 pointer-events-none flex items-center gap-3 bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800/80 text-[11px] font-mono text-slate-400 z-10">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                String(wsStatus) === 'connected' ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'
              }`}
            />
            <span className="text-slate-300 font-semibold">{String(wsStatus).toUpperCase()}</span>
          </div>

          <div className="w-[1px] h-3 bg-slate-800" />

          <div>
            FPS: <span className="text-emerald-400 font-bold">{fps}</span>
          </div>

          <div className="w-[1px] h-3 bg-slate-800" />

          <div>
            Bars: <span className="text-slate-200 font-medium">{activeCandles.length}</span>
          </div>

          {livePrice && (
            <>
              <div className="w-[1px] h-3 bg-slate-800" />
              <div>
                Price: <span className="text-emerald-400 font-bold">${livePrice.toFixed(2)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
