'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries, createSeriesMarkers, ISeriesMarkersPluginApi } from 'lightweight-charts';
import { generateVolumetricMarkers } from '@/utils/generateChartMarkers';
import { useBacktestEngine, BacktestTimeframe, BtCandle } from '@/hooks/useBacktestEngine';
import { useMarketDataContext } from '@/context/MarketDataContext';
import {
  ChevronLeft, ChevronRight, Eye, Download, Copy,
  Calendar, Clock, BarChart2, Loader2, AlertTriangle,
  ArrowLeft, Zap, CheckCheck, Brain, TrendingUp, Percent, AlertCircle
} from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';

// ─── Isolated chart component (no shared state with live Chart.tsx) ──────────
interface BacktestChartProps {
  data: BtCandle[];
  themeSettings: any;
}

function BacktestChart({ data, themeSettings }: BacktestChartProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const seriesMarkersRef = useRef<ISeriesMarkersPluginApi<any> | null>(null);

  const isDark = theme === 'dark';
  const upColor = themeSettings ? (isDark ? themeSettings.dark_up_candle : themeSettings.light_up_candle) : (isDark ? '#50ffaf' : '#059669');
  const downColor = themeSettings ? (isDark ? themeSettings.dark_down_candle : themeSettings.light_down_candle) : (isDark ? '#ffb4ab' : '#e11d48');

  // Init chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: isDark ? '#020617' : '#fafafa' },
        textColor: isDark ? '#94a3b8' : '#475569',
        fontFamily: 'var(--font-geist-sans), sans-serif',
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15, 23, 42, 0.04)' },
        horzLines: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15, 23, 42, 0.04)' },
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15, 23, 42, 0.04)',
        tickMarkFormatter: (time: number) =>
          new Date(time * 1000).toLocaleTimeString('en-EG', {
            timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: true,
          }),
      },
      localization: {
        timeFormatter: (ts: number) =>
          new Date(ts * 1000).toLocaleString('en-EG', {
            timeZone: 'UTC', hour: '2-digit', minute: '2-digit',
            day: '2-digit', month: 'short', hour12: true,
          }),
      },
      rightPriceScale: { borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15, 23, 42, 0.04)' },
      crosshair: {
        vertLine: { color: isDark ? 'rgba(168,85,247,0.4)' : 'rgba(79, 70, 229, 0.4)', width: 1, style: 3 },
        horzLine: { color: isDark ? 'rgba(168,85,247,0.4)' : 'rgba(79, 70, 229, 0.4)', width: 1, style: 3 },
      },
    });

    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: upColor,
      downColor: downColor,
      borderVisible: false,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });
    seriesRef.current = series;
    seriesMarkersRef.current = createSeriesMarkers(series);

    const onResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      seriesMarkersRef.current = null;
    };
  }, []);

  // ── Sync Chart Colors with Theme and Dynamic Presets ─────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    const bg = isDark ? '#020617' : '#fafafa';
    const text = isDark ? '#94a3b8' : '#475569';
    const grid = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.04)';
    const crosshairColor = isDark ? 'rgba(168, 85, 247, 0.4)' : 'rgba(79, 70, 229, 0.4)';

    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: bg },
        textColor: text,
      },
      grid: {
        vertLines: { color: grid },
        horzLines: { color: grid },
      },
      timeScale: { borderColor: grid },
      rightPriceScale: { borderColor: grid },
      crosshair: {
        vertLine: { color: crosshairColor },
        horzLine: { color: crosshairColor },
      },
    });

    series.applyOptions({
      upColor: upColor,
      downColor: downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });
  }, [theme, upColor, downColor, isDark]);

  // Update data whenever visible slice changes or theme shifts
  useEffect(() => {
    if (!seriesRef.current || !data || data.length === 0) return;
    const formatted = data
      .map((d) => ({
        time: Math.floor(d.t / 1000) as unknown as number,
        open: d.o, high: d.h, low: d.l, close: d.c,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    seriesRef.current.setData(formatted as never);

    const sortedDataForMarkers = [...data].sort((a, b) => a.t - b.t);
    seriesMarkersRef.current?.setMarkers(generateVolumetricMarkers(sortedDataForMarkers, isDark));

    chartRef.current?.timeScale().fitContent();
  }, [data, isDark]);

  return <div ref={containerRef} className="w-full h-full" />;
}

// ─── Stat badge ──────────────────────────────────────────────────────────────
interface StatBadgeProps {
  label: string;
  value: string | number;
  accent?: boolean;
}

function StatBadge({ label, value, accent = false }: StatBadgeProps) {
  return (
    <div className={`flex flex-col gap-0.5 px-4 py-2 rounded-xl border transition-all ${accent ? 'border-accent/30 bg-accent/5' : 'border-card-border bg-card/25 shadow-sm'}`}>
      <span className="text-[10px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-black ${accent ? 'text-accent' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function BacktestPage() {
  const engine = useBacktestEngine();
  const { themeSettings } = useMarketDataContext();
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [activeTimeframe, setActiveTimeframe] = useState<BacktestTimeframe>('5m');
  const [counts, setCounts] = useState({ '5m': 60, '15m': 0, '1h': 72, '4h': 20 });

  const handleCountChange = (tf: '5m' | '15m' | '1h' | '4h', value: string) => {
    const num = parseInt(value, 10);
    setCounts(prev => ({ ...prev, [tf]: isNaN(num) ? 0 : num }));
  };

  // keyboard shortcuts
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (engine.status !== 'ready') return;
    if (e.key === 'ArrowRight') engine.nextCandle();
    if (e.key === 'ArrowLeft') engine.prevCandle();
    if (e.key === 'r' || e.key === 'R') engine.revealDay();
  }, [engine]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // copy with feedback
  const handleCopy = async () => {
    await engine.copyPayload(counts);
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 2000);
  };

  // Which candle array feeds the chart?
  const chartData = (() => {
    if (!engine.visibleArrays) return [];
    if (activeTimeframe === '1h') return engine.visibleArrays.candles_1h;
    if (activeTimeframe === '15m') return engine.visibleArrays.candles_15m;
    return engine.visibleArrays.candles_5m;
  })();

  const lastCandle = engine.visibleArrays?.candles_5m.slice(-1)[0] ?? null;
  const lastPrice = lastCandle?.c ?? null;
  
  const cairoTime = lastCandle
    ? (() => {
      const d = new Date(lastCandle.t);
      const hh = d.getUTCHours();
      const mm = d.getUTCMinutes().toString().padStart(2, '0');
      const suffix = hh >= 12 ? 'PM' : 'AM';
      const h12 = (hh % 12 || 12).toString().padStart(2, '0');
      return `${h12}:${mm} ${suffix}`;
    })()
    : '--:--';

  const progressPct = engine.totalCandles > 0
    ? Math.round((engine.currentIndex / engine.totalCandles) * 100)
    : 0;

  return (
    <main className="flex flex-col h-[calc(100vh-56px)] w-full bg-background text-foreground font-sans overflow-hidden selection:bg-accent/30 transition-colors duration-300 relative">

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-15%] left-[-5%] w-[45%] h-[45%] rounded-full bg-accent/5 blur-[140px]" />
        <div className="absolute bottom-[-10%] right-[5%] w-[35%] h-[35%] rounded-full bg-accent/3 blur-[120px]" />
      </div>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="relative z-20 h-14 lg:h-16 border-b border-card-border flex items-center justify-between px-4 lg:px-8 bg-card/45 backdrop-blur-md shrink-0 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-slate-500 dark:text-zinc-400 hover:text-foreground transition-colors text-sm font-black shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">LIVE HUD</span>
          </Link>

          <span className="text-card-border hidden sm:inline">|</span>

          <div className="w-2 h-6 rounded-full bg-accent shrink-0 animate-pulse" />
          <h1 className="text-base lg:text-xl font-black text-foreground tracking-tight truncate">
            MARKET REPLAY ENGINE
          </h1>
          <span className="px-2.5 py-0.5 rounded-lg bg-accent/15 text-[10px] font-black text-accent border border-accent/20 shrink-0 uppercase tracking-wider">
            BACKTESTING
          </span>
        </div>

        {/* Timeframe pills */}
        <div className="flex items-center gap-1 bg-card/65 p-1 rounded-full border border-card-border shrink-0">
          {(['5m', '15m', '1h'] as BacktestTimeframe[]).map((tf) => (
            <button
              key={tf}
              id={`bt-tf-${tf}`}
              onClick={() => setActiveTimeframe(tf)}
              className={`px-3 py-1.5 rounded-full text-xs font-black transition-all duration-200 cursor-pointer ${activeTimeframe === tf
                ? 'bg-accent/15 text-accent border border-accent/30 shadow-[0_0_12px_rgba(var(--accent),0.12)]'
                : 'text-slate-500 dark:text-zinc-400 hover:text-foreground hover:bg-card/50 border border-transparent'
                }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {/* ── 3 Visual HUD Cards (Total P&L, Win Rate, Drawdown) ────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-4 lg:px-8 py-4 shrink-0 relative z-10">
        
        {/* Card 1: Total P&L */}
        <div className="glass-panel p-4 lg:p-5 min-h-[100px] flex flex-col justify-between relative overflow-hidden group select-none transition-all duration-300 shadow-[inset_0_0_20px_rgba(16,185,129,0.02)] border-emerald-500/20">
          <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-all duration-300 bg-emerald-500/10 dark:bg-emerald-500/20" />
          <div className="flex justify-between items-start">
            <span className="text-[10px] lg:text-xs font-black uppercase tracking-widest text-slate-500 dark:text-zinc-400">Total Backtest P&L</span>
            <TrendingUp size={14} className="text-emerald-500 dark:text-emerald-400" />
          </div>
          <span className="text-2xl lg:text-3xl font-black mt-2 leading-none text-emerald-600 dark:text-emerald-400 font-mono">
            +$12,430.20 <span className="text-xs lg:text-sm font-semibold tracking-tight opacity-90">(+14.2%)</span>
          </span>
        </div>

        {/* Card 2: Win Rate */}
        <div className="glass-panel p-4 lg:p-5 min-h-[100px] flex flex-col justify-between relative overflow-hidden group select-none transition-all duration-300 border-accent/20">
          <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-all duration-300 bg-accent/10" />
          <div className="flex justify-between items-start">
            <span className="text-[10px] lg:text-xs font-black uppercase tracking-widest text-slate-500 dark:text-zinc-400">Backtest Win Rate</span>
            <Percent size={14} className="text-accent" />
          </div>
          <span className="text-2xl lg:text-3xl font-black mt-2 leading-none text-accent font-mono">
            73.5%
          </span>
        </div>

        {/* Card 3: Max Drawdown */}
        <div className="glass-panel p-4 lg:p-5 min-h-[100px] flex flex-col justify-between relative overflow-hidden group select-none transition-all duration-300 border-rose-500/20 shadow-[inset_0_0_20px_rgba(244,63,94,0.02)]">
          <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-all duration-300 bg-rose-500/10 dark:bg-rose-500/20" />
          <div className="flex justify-between items-start">
            <span className="text-[10px] lg:text-xs font-black uppercase tracking-widest text-slate-500 dark:text-zinc-400">Maximum Drawdown</span>
            <AlertCircle size={14} className="text-rose-500 dark:text-rose-400" />
          </div>
          <span className="text-2xl lg:text-3xl font-black mt-2 leading-none text-rose-600 dark:text-rose-400 font-mono">
            -2.15%
          </span>
        </div>

      </div>

      {/* ── Body: controls + chart ────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative z-10">

        {/* ── Left control panel ──────────────────────────────────────────── */}
        <aside className="w-72 shrink-0 border-r border-card-border bg-card/25 backdrop-blur-sm flex flex-col gap-4 p-5 overflow-y-auto transition-colors">

          {/* Section: Date & Cutoff ───────────────────── */}
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Configuration</p>

            {/* Date picker */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bt-date" className="flex items-center gap-1.5 text-xs font-black text-slate-500 dark:text-zinc-400">
                <Calendar className="w-3.5 h-3.5 text-accent" />
                Replay Date
              </label>
              <input
                id="bt-date"
                type="date"
                value={engine.selectedDate}
                onChange={(e) => engine.setSelectedDate(e.target.value)}
                max={new Date(Date.now() - 86400000).toISOString().slice(0, 10)}
                className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3.5 py-2.5 text-xs text-foreground rounded-lg transition-all shadow-sm [color-scheme:dark]"
              />
            </div>

            {/* Cutoff time */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bt-cutoff" className="flex items-center gap-1.5 text-xs font-black text-slate-500 dark:text-zinc-400">
                <Clock className="w-3.5 h-3.5 text-accent" />
                Cut-off Time (Cairo)
              </label>
              <input
                id="bt-cutoff"
                type="time"
                value={engine.cutoffTime}
                onChange={(e) => engine.setCutoffTime(e.target.value)}
                className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3.5 py-2.5 text-xs text-foreground rounded-lg transition-all shadow-sm [color-scheme:dark]"
              />
              <p className="text-[10px] text-slate-500 dark:text-zinc-500 font-bold uppercase">Chart starts hidden before this time</p>
            </div>

            {/* Load Day button */}
            <button
              id="bt-load-day"
              onClick={engine.loadDay}
              disabled={engine.status === 'fetching'}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                         bg-accent/15 border border-accent/20
                         text-accent font-black text-sm hover:bg-accent/25
                         disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer
                         shadow-sm"
            >
              {engine.status === 'fetching' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Fetching Binance…</>
              ) : (
                <><BarChart2 className="w-4 h-4" /> Load Day</>
              )}
            </button>
          </div>

          {/* Section: Stats (only when ready) ───────────── */}
          {engine.status === 'ready' && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Session</p>
              <StatBadge label="Cairo Time" value={cairoTime} accent />
              <StatBadge label="Last Price" value={lastPrice !== null ? `$${lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '---'} />
              <StatBadge label="Candle" value={`${engine.currentIndex} / ${engine.totalCandles}`} />
              <StatBadge label="Progress" value={`${progressPct}%`} />

              {/* Progress bar */}
              <div className="w-full h-1.5 rounded-full bg-card-border overflow-hidden mt-1">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300 animate-pulse"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {engine.isDayRevealed && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-semibold">
                  <Eye className="w-3.5 h-3.5" /> Full day revealed
                </div>
              )}
            </div>
          )}

          {/* Error banner */}
          {engine.status === 'error' && (
            <div className="flex items-start gap-2 px-3 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{engine.error}</span>
            </div>
          )}

          <div className="flex-1" />

          {/* Section: AI Export ───────────────────────── */}
          {engine.status === 'ready' && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">AI Export</p>

              {/* ── Dynamic UI Inputs ───────────────────────────────────── */}
              <div className="bg-card/45 rounded-2xl p-4 border border-card-border backdrop-blur-md relative overflow-hidden mb-2 shadow-sm">
                <div className="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-full blur-3xl -mr-6 -mt-6 pointer-events-none" />
                <div className="flex items-center gap-2 mb-3 relative z-10">
                  <Brain className="w-4 h-4 text-accent shrink-0" />
                  <p className="text-xs font-black text-accent tracking-wide uppercase">AI Context Settings</p>
                </div>

                <div className="grid grid-cols-2 gap-3 relative z-10">
                  {(['5m', '15m', '1h', '4h'] as const).map((tf) => (
                    <div key={tf} className="flex flex-col bg-background/50 rounded-xl p-2 border border-card-border shadow-inner">
                      <label htmlFor={`input-${tf}`} className="text-[10px] text-slate-500 dark:text-zinc-400 font-black mb-1 uppercase text-center">{tf} Candles</label>
                      <input
                        id={`input-${tf}`}
                        type="number"
                        min="0"
                        value={counts[tf]}
                        onChange={(e) => handleCountChange(tf, e.target.value)}
                        className="w-full bg-transparent text-foreground text-sm font-black text-center outline-none border-b border-card-border focus:border-accent transition-colors font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Copy */}
              <button
                id="bt-copy-payload"
                onClick={handleCopy}
                disabled={!engine.enrichedPayload}
                className="w-full relative group overflow-hidden rounded-xl disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] cursor-pointer"
              >
                <span className={`absolute inset-0 rounded-xl transition-opacity duration-300 ${copyState === 'copied' ? 'bg-emerald-500 opacity-90' : 'bg-accent opacity-70 group-hover:opacity-100'}`} />
                <div className={`relative flex items-center justify-center gap-2 px-4 py-2.5 m-[1px] rounded-xl transition-all duration-300 ${copyState === 'copied' ? 'bg-transparent' : 'bg-background group-hover:bg-transparent'}`}>
                  {copyState === 'copied'
                    ? <><CheckCheck className="w-4 h-4 text-white" /><span className="font-black text-sm text-white">Copied!</span></>
                    : <><Zap className="w-4 h-4 text-accent group-hover:text-white transition-colors" /><span className="font-black text-sm text-white">⚡ Copy AI Context</span></>
                  }
                </div>
              </button>

              {/* Download */}
              <button
                id="bt-download-payload"
                onClick={() => engine.downloadPayload(counts)}
                disabled={!engine.enrichedPayload}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                           border border-card-border bg-card/10 hover:bg-card/25 hover:border-accent
                           text-slate-500 dark:text-zinc-400 hover:text-foreground font-black text-sm
                           disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Download JSON
              </button>

              <p className="text-[10px] text-slate-500 dark:text-zinc-500 font-bold uppercase text-center">
                Payload reflects visible candles only
              </p>
            </div>
          )}
        </aside>

        {/* ── Chart + replay controls ─────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Chart area */}
          <div className="flex-1 relative p-3 lg:p-5 min-h-0">
            {engine.status === 'idle' && (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted">
                <div className="w-20 h-20 rounded-2xl bg-card border border-card-border flex items-center justify-center shadow-lg">
                  <BarChart2 className="w-9 h-9 text-accent/45" />
                </div>
                <div className="text-center select-none font-sans">
                  <p className="text-sm font-black text-slate-500 dark:text-zinc-400">Select a date and load the day</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1 font-bold uppercase">Full 24 h ETHUSDC klines will be fetched from Binance</p>
                </div>
              </div>
            )}

            {engine.status === 'fetching' && (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-10 h-10 text-accent animate-spin" />
                <p className="text-sm font-black text-slate-500 dark:text-zinc-400 animate-pulse uppercase">
                  Fetching 3 timeframes from Binance public REST…
                </p>
              </div>
            )}

            {(engine.status === 'ready' || engine.status === 'error') && (
              <div className="w-full h-full rounded-2xl overflow-hidden border border-card-border bg-card/20 backdrop-blur-xl shadow-2xl relative group">
                <div className="absolute inset-0 shadow-[inset_0_0_80px_rgba(var(--accent),0.01)] pointer-events-none z-10" />
                {engine.visibleArrays && chartData.length > 0
                  ? <BacktestChart data={chartData} themeSettings={themeSettings} />
                  : (
                    <div className="w-full h-full flex items-center justify-center text-slate-500 dark:text-zinc-400 text-sm select-none font-black uppercase">
                      No visible candles yet — press Next Candle ⏩
                    </div>
                  )
                }

                {/* Sleek Floating Glass Replay Controls (Centered Bottom Overlay) */}
                {engine.status === 'ready' && (
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 bg-card/60 backdrop-blur-xl border border-card-border px-6 py-3.5 rounded-2xl shadow-xl transition-all duration-300 hover:border-accent/40 select-none">
                    
                    {/* Prev */}
                    <button
                      id="bt-prev-candle"
                      onClick={engine.prevCandle}
                      disabled={engine.currentIndex <= 1}
                      title="Previous Candle (←)"
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-card-border
                                 bg-card/30 hover:bg-card-hover/20 text-foreground font-black text-xs
                                 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer
                                 active:scale-95 shadow-sm"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span className="hidden sm:inline uppercase">Prev</span>
                    </button>

                    {/* Next */}
                    <button
                      id="bt-next-candle"
                      onClick={engine.nextCandle}
                      disabled={engine.currentIndex >= engine.totalCandles}
                      title="Next Candle (→)"
                      className="flex items-center gap-1.5 px-5 py-2 rounded-xl
                                 bg-accent text-white hover:opacity-95 font-black text-xs
                                 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer
                                 shadow-md hover:shadow-accent/25 transition-all duration-200 active:scale-95"
                    >
                      <span className="hidden sm:inline uppercase">Next</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>

                    {/* Divider */}
                    <div className="w-px h-6 bg-card-border" />

                    {/* Reveal Day */}
                    <button
                      id="bt-reveal-day"
                      onClick={engine.revealDay}
                      disabled={engine.isDayRevealed}
                      title="Reveal full day (R)"
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl
                                 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20
                                 text-emerald-600 dark:text-emerald-400 font-black text-xs
                                 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer
                                 transition-all duration-200 active:scale-95 shadow-sm"
                    >
                      <Eye className="w-4 h-4" />
                      <span className="hidden sm:inline uppercase">Reveal</span>
                    </button>

                    {/* Keyboard Shortcuts Hint */}
                    <div className="hidden lg:block text-[9px] text-slate-500 dark:text-zinc-500 font-bold uppercase tracking-wider pl-2 border-l border-card-border">
                      ← → KEYS
                    </div>

                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
