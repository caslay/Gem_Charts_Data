'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useBacktestEngine, BacktestTimeframe } from '@/hooks/useBacktestEngine';
import { useMarketDataContext } from '@/context/MarketDataContext';
import { useStrategyEvaluator } from '@/hooks/useStrategyEvaluator';
import { useAIAnalysis } from '@/hooks/useAIAnalysis';
import { JournalTable, type TradeRecord } from '@/components/JournalTable';
import type { MarketDataPayload } from '@/hooks/useMarketData';
import type { LiveCandle } from '@/hooks/useBinanceWS';
import Chart from '@/components/Chart';
import DashboardMetrics from '@/components/DashboardMetrics';
import SmartAlertsToast from '@/components/SmartAlertsToast';
import type { SmartAlert } from '@/hooks/useLiveAlerts';
import {
  ChevronLeft, ChevronRight, Eye, Download, Copy,
  Calendar, Clock, BarChart2, Loader2, AlertTriangle,
  ArrowLeft, Zap, CheckCheck, Brain, TrendingUp, Percent, AlertCircle,
  Settings, Activity
} from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import SettingsModal from '@/components/modals/SettingsModal';
import BacktestSidebar from './BacktestSidebar';


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
  const { aiAnalysis, aiBias, isAnalyzing, triggerAiAnalysisScan } = useAIAnalysis();
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [activeTimeframe, setActiveTimeframe] = useState<BacktestTimeframe>('5m');
  const [counts, setCounts] = useState({ '5m': 60, '15m': 0, '1h': 72, '4h': 20 });

  // ── Unified Dropdowns & Collapsible Sidebar State ─────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isSoundSettingsOpen, setIsSoundSettingsOpen] = useState(false);
  const [commandCenterTab, setCommandCenterTab] = useState<'strategy' | 'audio'>('strategy');
  const [isTfDropdownOpen, setIsTfDropdownOpen] = useState(false);

  // Sync page activeTimeframe scale with backtest engine scale
  useEffect(() => {
    engine.setTimeframe(activeTimeframe);
  }, [activeTimeframe, engine]);

  // ── Backtest Toast Alerts State ───────────────────────────────────────────
  const [activeAlerts, setActiveAlerts] = useState<SmartAlert[]>([]);

  const dismissAlert = useCallback((id: string) => {
    setActiveAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const triggerSmartAlert = useCallback((type: any, message: string, soundPath?: string) => {
    setActiveAlerts((prev) => {
      const newAlert: SmartAlert = {
        id: `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        type,
        message,
        timestamp: Date.now(),
      };
      return [newAlert, ...prev].slice(0, 10);
    });

    if (typeof window !== 'undefined' && soundPath) {
      const audio = new Audio(soundPath);
      audio.play().catch(e => {
        if (e.name === 'NotAllowedError') {
          console.log('[Audio] Playback blocked by browser autoplay policy until user interacts.');
        } else {
          console.error('Audio play error:', e);
        }
      });
    }
  }, []);

  // ── Backtest Trades & Account State ───────────────────────────────────────
  const [backtestTrades, setBacktestTrades] = useState<TradeRecord[]>([]);
  const [backtestAccount, setBacktestAccount] = useState<any>(null);
  const [isLoadingTrades, setIsLoadingTrades] = useState(true);

  const fetchBacktestTrades = useCallback(async () => {
    try {
      const res = await fetch('/api/backtest-trades');
      if (res.ok) {
        const json = await res.json();
        setBacktestTrades(json.trades || []);
        setBacktestAccount(json.account || null);
      }
    } catch (err) {
      console.error('[Backtest] Failed to fetch backtest trades:', err);
    } finally {
      setIsLoadingTrades(false);
    }
  }, []);

  useEffect(() => {
    fetchBacktestTrades();
  }, [fetchBacktestTrades]);

  // Sync replayed trade executions with table states
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleRefresh = () => {
      fetchBacktestTrades();
    };
    window.addEventListener('backtest-trades-refresh', handleRefresh);
    return () => {
      window.removeEventListener('backtest-trades-refresh', handleRefresh);
    };
  }, [fetchBacktestTrades]);

  // Candle price extracts
  const lastCandle = engine.visibleArrays?.candles_5m.slice(-1)[0] ?? null;
  const lastPrice = lastCandle?.c ?? null;

  // Map replayed 5m candle as a closed liveCandle for Strategy Evaluator temporal gating
  const liveCandle = lastCandle
    ? {
      t: lastCandle.t,
      time: lastCandle.t / 1000,
      open: lastCandle.o,
      high: lastCandle.h,
      low: lastCandle.l,
      close: lastCandle.c,
      volume: lastCandle.v,
      isClosed: true,
    }
    : null;

  // ── Parse AI analysis response for the HUD Bar ──────────────────────────────
  let parsedAiResponse: any = null;
  let masterBias = 'NEUTRAL';
  if (aiAnalysis) {
    try {
      let candidate = aiAnalysis.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)?.[1];
      if (!candidate) {
        const start = aiAnalysis.indexOf('{');
        const end = aiAnalysis.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          candidate = aiAnalysis.slice(start, end + 1);
        } else {
          candidate = aiAnalysis;
        }
      }
      parsedAiResponse = JSON.parse(candidate.trim());
      masterBias = parsedAiResponse?.bias_label || parsedAiResponse?.diagnostics?.master_bias || 'NEUTRAL';
    } catch (e) {
      console.error('[Backtest] Failed to parse AI Analysis JSON for Master Bias:', e);
    }
  }

  // Strategy Execution Engine — re-evaluates automatically on replayed steps
  const { refetchStrategies } = useStrategyEvaluator({
    isBacktest: true,
    data: engine.enrichedPayload as unknown as MarketDataPayload,
    livePrice: lastPrice,
    liveCandle: liveCandle as unknown as LiveCandle,
    aiBias: aiBias,
    triggerSmartAlert
  });

  // Dynamic backtest statistics calculations
  const closedTrades = backtestTrades.filter((t: any) => t.status === "CLOSED");
  const winningTrades = closedTrades.filter((t: any) => parseFloat(String(t.realized_pnl || 0)) > 0);
  const totalRealizedPnL = closedTrades.reduce((sum, t) => sum + parseFloat(String(t.realized_pnl || 0)), 0);

  const winRate = closedTrades.length > 0
    ? (winningTrades.length / closedTrades.length) * 100
    : 0;

  const initialCapital = backtestAccount ? parseFloat(String(backtestAccount.initial_capital)) : 10000;
  const returnPercentage = (totalRealizedPnL / initialCapital) * 100;

  // Max drawdown walk
  let maxDrawdown = 0;
  let peak = initialCapital;
  let runningBalance = initialCapital;

  const sortedClosedTrades = [...closedTrades].sort(
    (a, b) => new Date(a.created_at || a.timestamp).getTime() - new Date(b.created_at || b.timestamp).getTime()
  );

  for (const t of sortedClosedTrades) {
    runningBalance += parseFloat(String(t.realized_pnl || 0));
    if (runningBalance > peak) {
      peak = runningBalance;
    }
    const drawdown = ((peak - runningBalance) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

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

  const cairoTime = lastCandle
    ? new Date(lastCandle.t).toLocaleTimeString('en-EG', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
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

        {/* Timeframe dropdown & Command Center */}
        <div className="flex items-center gap-3 shrink-0 select-none">
          {/* Command Center */}
          <button
            onClick={() => {
              setCommandCenterTab('strategy');
              setIsSoundSettingsOpen(true);
            }}
            className="bg-card border border-card-border hover:border-accent text-slate-500 dark:text-zinc-400 hover:text-foreground px-3.5 py-2 font-mono text-[10px] font-black uppercase tracking-widest transition-all rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm"
            title="Open Command Center"
          >
            <Settings className="w-3.5 h-3.5 text-accent" />
            <span className="hidden sm:inline">[ COMMAND CENTER ]</span>
          </button>

          {/* Timeframe dropdown */}
          <div className="relative inline-block text-left">
            <button
              onClick={() => setIsTfDropdownOpen(!isTfDropdownOpen)}
              className="bg-card border border-card-border hover:border-accent text-slate-500 dark:text-zinc-400 hover:text-foreground px-4 py-2 font-mono text-[10px] font-black uppercase tracking-widest transition-all rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm"
              id="bt-timeframe-dropdown"
            >
              <span>TIMEFRAME: {activeTimeframe.toUpperCase()}</span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isTfDropdownOpen ? 'rotate-90 text-accent' : ''}`} />
            </button>

            {isTfDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsTfDropdownOpen(false)}
                />
                <div className="absolute right-0 z-40 mt-1.5 w-32 origin-top-right rounded-xl bg-card border border-card-border shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="py-1">
                    {(['5m', '15m', '1h'] as const).map((tf) => {
                      const isActive = activeTimeframe === tf;
                      return (
                        <button
                          key={tf}
                          onClick={() => {
                            setActiveTimeframe(tf);
                            setIsTfDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 font-mono text-[10px] font-black tracking-widest uppercase cursor-pointer transition-all duration-150 first:rounded-t-xl last:rounded-b-xl ${isActive
                              ? 'bg-accent/10 text-accent border-l-2 border-accent'
                              : 'text-slate-500 dark:text-zinc-400 hover:text-foreground hover:bg-accent/5 border-l-2 border-transparent'
                            }`}
                        >
                          {tf.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Sidebar Toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`bg-card border border-card-border hover:border-accent px-3.5 py-2 font-mono text-[10px] font-black uppercase tracking-widest transition-all rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm ${sidebarOpen ? 'text-accent border-accent/35 shadow-[0_0_12px_rgba(var(--accent),0.12)]' : 'text-slate-500 dark:text-zinc-400 hover:text-foreground'
              }`}
            title="Toggle HUD Sidebar"
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">[ HUD SIDEBAR ]</span>
          </button>
        </div>
      </header>

      {/* ── 3 Unified Visual HUD Cards (Parity with Live HUD) ────────── */}
      <DashboardMetrics
        masterBias={masterBias}
        pricing={(engine.enrichedPayload?.ipda_metrics as any)?.current_pricing || 'SCANNING'}
        targetStatus={(engine.enrichedPayload?.ipda_metrics as any)?.target_status || 'PENDING'}
      />

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

          {/* Section: Gemini Synthesis ───────────────── */}
          {engine.status === 'ready' && (
            <div className="flex flex-col gap-2 pt-3 border-t border-card-border select-none">
              <p className="text-[11px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Gemini Synthesis</p>
              <button
                onClick={async () => {
                  if (!engine.enrichedPayload) return;
                  await triggerAiAnalysisScan(engine.enrichedPayload as unknown as MarketDataPayload);
                }}
                disabled={isAnalyzing || !engine.enrichedPayload}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                               bg-accent text-white font-black text-xs hover:opacity-90
                               disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer
                               shadow-md hover:shadow-accent/25 active:scale-95"
              >
                {isAnalyzing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Synthesizing…</>
                ) : (
                  <><Brain className="w-4 h-4" /> Trigger AI Analysis</>
                )}
              </button>

              {aiAnalysis && (
                <div className="mt-2 max-h-36 overflow-y-auto text-[10px] text-emerald-500 leading-relaxed whitespace-pre-wrap bg-card p-3 rounded-lg border border-card-border font-mono select-text scrollbar-thin">
                  {aiAnalysis}
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

        {/* ── Chart + replay controls + Journal ───────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto scrollbar-thin scrollbar-thumb-card-border scrollbar-track-transparent">

          {/* Chart area */}
          <div className="h-[680px] relative p-3 lg:p-5 shrink-0 min-h-0">
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
                  ? (
                    <Chart
                      data={chartData as any}
                      isBacktest={true}
                      marketContextData={engine.enrichedPayload as unknown as MarketDataPayload}
                      liveCandle={liveCandle as unknown as LiveCandle}
                      livePrice={lastPrice}
                      interval={activeTimeframe as any}
                      triggerSmartAlert={triggerSmartAlert}
                    />
                  )
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

          {/* Journal Table area */}
          {engine.status === 'ready' && (
            <div className="flex-1 p-4 lg:p-6 border-t border-card-border bg-card/10 relative z-10 shrink-0">
              <div className="flex justify-between items-center mb-4 select-none">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-4 rounded-full bg-accent" />
                  <h2 className="text-xs font-black uppercase tracking-[0.12em] text-foreground">
                    Backtest Strategy execution & journaling ledger
                  </h2>
                </div>
              </div>

              {/* Sleek, compact backtest performance overview row */}
              <div className="grid grid-cols-3 gap-3 mb-4 select-none">
                {/* Total P&L Card */}
                <div className={`glass-panel p-3 flex flex-col justify-between border ${totalRealizedPnL >= 0 ? 'border-emerald-500/20 shadow-[inset_0_0_12px_rgba(16,185,129,0.02)]' : 'border-rose-500/20 shadow-[inset_0_0_12px_rgba(244,63,94,0.02)]'}`}>
                  <span className="text-[9px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Backtest P&L</span>
                  <span className={`text-sm font-black font-mono ${totalRealizedPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {totalRealizedPnL >= 0 ? '+' : ''}${totalRealizedPnL.toFixed(2)} <span className="text-[10px] font-semibold opacity-90">({totalRealizedPnL >= 0 ? '+' : ''}{returnPercentage.toFixed(2)}%)</span>
                  </span>
                </div>
                {/* Win Rate Card */}
                <div className="glass-panel p-3 flex flex-col justify-between border border-accent/20">
                  <span className="text-[9px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Win Rate</span>
                  <span className="text-sm font-black font-mono text-accent">
                    {winRate.toFixed(1)}%
                  </span>
                </div>
                {/* Max Drawdown Card */}
                <div className="glass-panel p-3 flex flex-col justify-between border border-rose-500/20 shadow-[inset_0_0_12px_rgba(244,63,94,0.02)]">
                  <span className="text-[9px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Max Drawdown</span>
                  <span className="text-sm font-black font-mono text-rose-500">
                    -{maxDrawdown.toFixed(2)}%
                  </span>
                </div>
              </div>
              {isLoadingTrades ? (
                <div className="flex justify-center items-center py-12 text-xs font-mono uppercase text-muted">
                  <Loader2 className="w-4 h-4 animate-spin mr-2 text-accent" /> Loading Backtest Ledger...
                </div>
              ) : (
                <JournalTable
                  initialTrades={backtestTrades}
                  initialAccount={backtestAccount}
                  isBacktest={true}
                  backtestLivePrice={lastPrice}
                />
              )}
            </div>
          )}

        </div>

        {/* ── Right HUD Sidebar Clone ─────────────────────────────────────── */}
        <BacktestSidebar
          enrichedPayload={engine.enrichedPayload}
          lastPrice={lastPrice}
          activeTimeframe={activeTimeframe}
          aiAnalysis={aiAnalysis}
          isAnalyzing={isAnalyzing}
          triggerAiAnalysisScan={triggerAiAnalysisScan}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      {/* Backtest Toast alerts */}
      <SmartAlertsToast activeAlerts={activeAlerts} dismissAlert={dismissAlert} />

      {/* Global Command Center Modal */}
      <SettingsModal
        isOpen={isSoundSettingsOpen}
        alert={null}
        initialTab={commandCenterTab}
        onClose={() => setIsSoundSettingsOpen(false)}
        onSave={() => {
          refetchStrategies();
        }}
        onDelete={() => {
          refetchStrategies();
        }}
      />
    </main>
  );
}
