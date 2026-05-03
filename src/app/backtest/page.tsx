'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { useBacktestEngine, BacktestTimeframe, BtCandle } from '@/hooks/useBacktestEngine';
import {
  ChevronLeft, ChevronRight, Eye, Download, Copy,
  Calendar, Clock, BarChart2, Loader2, AlertTriangle,
  ArrowLeft, Zap, CheckCheck,
} from 'lucide-react';
import Link from 'next/link';

// ─── Isolated chart component (no shared state with live Chart.tsx) ──────────
function BacktestChart({ data }: { data: BtCandle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);

  // Init chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#000000' },
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: 'rgba(255,255,255,0.08)',
        tickMarkFormatter: (time: number) =>
          // t is already Cairo-local ms (+3 h baked in), so format as UTC
          new Date(time * 1000).toLocaleTimeString('en-EG', {
            timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: true,
          }),
      },
      localization: {
        timeFormatter: (ts: number) =>
          // Same rule — display as UTC to avoid double-shift
          new Date(ts * 1000).toLocaleString('en-EG', {
            timeZone: 'UTC', hour: '2-digit', minute: '2-digit',
            day: '2-digit', month: 'short', hour12: true,
          }),
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      crosshair: {
        vertLine: { color: 'rgba(251,191,36,0.4)', width: 1, style: 3 },
        horzLine: { color: 'rgba(251,191,36,0.4)', width: 1, style: 3 },
      },
    });

    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor:      '#22d3ee',
      downColor:    '#c084fc',
      borderVisible: false,
      wickUpColor:   '#22d3ee',
      wickDownColor: '#c084fc',
    });
    seriesRef.current = series;

    const onResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width:  containerRef.current.clientWidth,
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
    };
  }, []);

  // Update data whenever visible slice changes
  useEffect(() => {
    if (!seriesRef.current || !data || data.length === 0) return;
    const formatted = data
      .map((d) => ({
        time: Math.floor(d.t / 1000) as unknown as number,
        open: d.o, high: d.h, low: d.l, close: d.c,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    seriesRef.current.setData(formatted as never);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div ref={containerRef} className="w-full h-full" />;
}

// ─── Stat badge ──────────────────────────────────────────────────────────────
function StatBadge({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 px-4 py-2 rounded-xl border ${accent ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/5 bg-white/[0.02]'}`}>
      <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-bold ${accent ? 'text-amber-300' : 'text-white'}`}>{value}</span>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function BacktestPage() {
  const engine = useBacktestEngine();
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [activeTimeframe, setActiveTimeframe] = useState<BacktestTimeframe>('5m');

  // keyboard shortcuts
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (engine.status !== 'ready') return;
    if (e.key === 'ArrowRight') engine.nextCandle();
    if (e.key === 'ArrowLeft')  engine.prevCandle();
    if (e.key === 'r' || e.key === 'R') engine.revealDay();
  }, [engine]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // copy with feedback
  const handleCopy = async () => {
    await engine.copyPayload();
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 2000);
  };

  // Which candle array feeds the chart?
  const chartData = (() => {
    if (!engine.visibleArrays) return [];
    if (activeTimeframe === '1h')  return engine.visibleArrays.candles_1h;
    if (activeTimeframe === '15m') return engine.visibleArrays.candles_15m;
    return engine.visibleArrays.candles_5m;
  })();

  const lastCandle = engine.visibleArrays?.candles_5m.slice(-1)[0] ?? null;
  const lastPrice  = lastCandle?.c ?? null;
  // lastCandle.t is already Cairo-local (UTC+3 baked in).
  // Use getUTC* to read it as-is without another timezone conversion.
  const cairoTime = lastCandle
    ? (() => {
        const d  = new Date(lastCandle.t);
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
    <main className="flex flex-col h-screen w-full bg-black text-white font-sans overflow-hidden selection:bg-amber-500/30">

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-15%] left-[-5%] w-[45%] h-[45%] rounded-full bg-amber-900/10 blur-[140px]" />
        <div className="absolute bottom-[-10%] right-[5%] w-[35%] h-[35%] rounded-full bg-purple-900/15 blur-[120px]" />
      </div>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="relative z-10 h-16 border-b border-white/5 flex items-center justify-between px-4 lg:px-8 bg-black/50 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm font-medium shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Live Dashboard</span>
          </Link>

          <span className="text-white/10 hidden sm:inline">|</span>

          <div className="w-2 h-6 rounded-full bg-gradient-to-b from-amber-400 to-orange-600 shrink-0" />
          <h1 className="text-base lg:text-xl font-bold text-white tracking-tight truncate">
            Market Replay Engine
          </h1>
          <span className="px-2 py-0.5 rounded bg-amber-500/10 text-[10px] font-bold text-amber-400 border border-amber-500/20 shrink-0">
            BACKTEST
          </span>
        </div>

        {/* Timeframe pills */}
        <div className="flex items-center gap-1 bg-[#0f0f0f] p-1 rounded-xl border border-white/10 shrink-0">
          {(['5m', '15m', '1h'] as BacktestTimeframe[]).map((tf) => (
            <button
              key={tf}
              id={`bt-tf-${tf}`}
              onClick={() => setActiveTimeframe(tf)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                activeTimeframe === tf
                  ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-500/30 shadow-[0_0_12px_rgba(251,191,36,0.12)]'
                  : 'text-gray-500 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {/* ── Body: controls + chart ────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative z-10">

        {/* ── Left control panel ──────────────────────────────────────────── */}
        <aside className="w-72 shrink-0 border-r border-white/5 bg-black/30 backdrop-blur-sm flex flex-col gap-4 p-5 overflow-y-auto">

          {/* Section: Date & Cutoff ───────────────────── */}
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Configuration</p>

            {/* Date picker */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bt-date" className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                Replay Date
              </label>
              <input
                id="bt-date"
                type="date"
                value={engine.selectedDate}
                onChange={(e) => engine.setSelectedDate(e.target.value)}
                max={new Date(Date.now() - 86400000).toISOString().slice(0, 10)}
                className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm text-white
                           focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20
                           [color-scheme:dark] transition-colors"
              />
            </div>

            {/* Cutoff time */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bt-cutoff" className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                Cut-off Time (Cairo)
              </label>
              <input
                id="bt-cutoff"
                type="time"
                value={engine.cutoffTime}
                onChange={(e) => engine.setCutoffTime(e.target.value)}
                className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm text-white
                           focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20
                           [color-scheme:dark] transition-colors"
              />
              <p className="text-[10px] text-gray-600">Chart starts hidden before this time</p>
            </div>

            {/* Load Day button */}
            <button
              id="bt-load-day"
              onClick={engine.loadDay}
              disabled={engine.status === 'fetching'}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                         bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30
                         text-amber-300 font-bold text-sm hover:from-amber-500/30 hover:to-orange-500/30
                         disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200
                         shadow-[0_0_20px_rgba(251,191,36,0.08)] hover:shadow-[0_0_20px_rgba(251,191,36,0.18)]"
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
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Session</p>
              <StatBadge label="Cairo Time" value={cairoTime} accent />
              <StatBadge label="Last Price" value={lastPrice !== null ? `$${lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '---'} />
              <StatBadge label="Candle" value={`${engine.currentIndex} / ${engine.totalCandles}`} />
              <StatBadge label="Progress" value={`${progressPct}%`} />

              {/* Progress bar */}
              <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden mt-1">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {engine.isDayRevealed && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                  <Eye className="w-3.5 h-3.5" /> Full day revealed
                </div>
              )}
            </div>
          )}

          {/* Error banner */}
          {engine.status === 'error' && (
            <div className="flex items-start gap-2 px-3 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{engine.error}</span>
            </div>
          )}

          <div className="flex-1" />

          {/* Section: AI Export ───────────────────────── */}
          {engine.status === 'ready' && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">AI Export</p>

              {/* Copy */}
              <button
                id="bt-copy-payload"
                onClick={handleCopy}
                disabled={!engine.enrichedPayload}
                className="w-full relative group overflow-hidden rounded-xl disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
              >
                <span className={`absolute inset-0 rounded-xl transition-opacity duration-300 ${copyState === 'copied' ? 'bg-gradient-to-r from-emerald-400 to-teal-500 opacity-90' : 'bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 opacity-70 group-hover:opacity-100'}`} />
                <div className={`relative flex items-center justify-center gap-2 px-4 py-2.5 m-[1px] rounded-xl transition-all duration-300 ${copyState === 'copied' ? 'bg-transparent' : 'bg-[#0a0a0a] group-hover:bg-transparent'}`}>
                  {copyState === 'copied'
                    ? <><CheckCheck className="w-4 h-4 text-white" /><span className="font-bold text-sm text-white">Copied!</span></>
                    : <><Zap className="w-4 h-4 text-amber-300 group-hover:text-white transition-colors" /><span className="font-bold text-sm text-white">⚡ Copy AI Context</span></>
                  }
                </div>
              </button>

              {/* Download */}
              <button
                id="bt-download-payload"
                onClick={engine.downloadPayload}
                disabled={!engine.enrichedPayload}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                           border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20
                           text-gray-300 hover:text-white font-semibold text-sm
                           disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
              >
                <Download className="w-4 h-4" />
                Download JSON
              </button>

              <p className="text-[10px] text-gray-600 text-center">
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
              <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-gray-600">
                <div className="w-20 h-20 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center">
                  <BarChart2 className="w-9 h-9 text-amber-500/40" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-500">Select a date and load the day</p>
                  <p className="text-xs text-gray-700 mt-1">Full 24 h ETHUSDT klines will be fetched from Binance</p>
                </div>
              </div>
            )}

            {engine.status === 'fetching' && (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
                <p className="text-sm font-medium text-gray-400 animate-pulse">
                  Fetching 3 timeframes from Binance public REST…
                </p>
              </div>
            )}

            {(engine.status === 'ready' || engine.status === 'error') && (
              <div className="w-full h-full rounded-2xl overflow-hidden border border-white/5 bg-[#050505]/80 backdrop-blur-xl shadow-2xl relative group">
                <div className="absolute inset-0 shadow-[inset_0_0_80px_rgba(251,191,36,0.02)] pointer-events-none z-10" />
                {engine.visibleArrays && chartData.length > 0
                  ? <BacktestChart data={chartData} />
                  : (
                    <div className="w-full h-full flex items-center justify-center text-gray-700 text-sm">
                      No visible candles yet — press Next Candle ⏩
                    </div>
                  )
                }
              </div>
            )}
          </div>

          {/* ── Replay control bar ──────────────────────────────────────── */}
          <div className="shrink-0 border-t border-white/5 bg-black/40 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3">

            {/* Left: keyboard hint */}
            <p className="text-[10px] text-gray-700 hidden lg:block">
              ← → arrow keys · R to reveal
            </p>

            {/* Center: main controls */}
            <div className="flex items-center gap-2 mx-auto">
              {/* Prev */}
              <button
                id="bt-prev-candle"
                onClick={engine.prevCandle}
                disabled={engine.status !== 'ready' || engine.currentIndex <= 1}
                title="Previous Candle (←)"
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/10
                           bg-white/[0.03] hover:bg-white/[0.08] hover:border-white/20
                           text-gray-300 hover:text-white font-semibold text-sm
                           disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200
                           active:scale-95"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Prev</span>
              </button>

              {/* Next */}
              <button
                id="bt-next-candle"
                onClick={engine.nextCandle}
                disabled={engine.status !== 'ready' || engine.currentIndex >= engine.totalCandles}
                title="Next Candle (→)"
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl
                           bg-gradient-to-r from-amber-500/25 to-orange-500/25
                           border border-amber-500/40 hover:border-amber-500/70
                           text-amber-300 hover:text-amber-100 font-bold text-sm
                           disabled:opacity-30 disabled:cursor-not-allowed
                           shadow-[0_0_15px_rgba(251,191,36,0.1)] hover:shadow-[0_0_20px_rgba(251,191,36,0.25)]
                           transition-all duration-200 active:scale-95"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* Divider */}
              <div className="w-px h-6 bg-white/10 mx-1" />

              {/* Reveal Day */}
              <button
                id="bt-reveal-day"
                onClick={engine.revealDay}
                disabled={engine.status !== 'ready' || engine.isDayRevealed}
                title="Reveal full day (R)"
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl
                           bg-gradient-to-r from-emerald-500/15 to-teal-500/15
                           border border-emerald-500/30 hover:border-emerald-500/60
                           text-emerald-400 hover:text-emerald-200 font-semibold text-sm
                           disabled:opacity-30 disabled:cursor-not-allowed
                           hover:shadow-[0_0_20px_rgba(52,211,153,0.15)]
                           transition-all duration-200 active:scale-95"
              >
                <Eye className="w-4 h-4" />
                <span className="hidden sm:inline">Reveal Day</span>
              </button>
            </div>

            {/* Right: copy shortcut */}
            <button
              onClick={handleCopy}
              disabled={!engine.enrichedPayload}
              title="Copy AI context"
              className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs
                         border border-white/5 bg-white/[0.02] hover:bg-white/[0.06]
                         text-gray-500 hover:text-amber-300 hover:border-amber-500/30
                         disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
            >
              {copyState === 'copied' ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copyState === 'copied' ? 'Copied' : 'Copy JSON'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
