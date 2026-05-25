'use client';

import { useState, useEffect } from 'react';
import { useMarketDataContext } from '@/context/MarketDataContext';
import Chart from '@/components/Chart';
import Sidebar from '@/components/Sidebar';
import SmartAlertsToast from '@/components/SmartAlertsToast';
import SettingsModal from '@/components/modals/SettingsModal';
import { Loader2, Menu, Settings } from 'lucide-react';
import { useStrategyEvaluator } from '@/hooks/useStrategyEvaluator';
import TimeframeSwitcher, { Timeframe } from '@/components/TimeframeSwitcher';
import { LiveTicker } from '@/components/LiveTicker';

export default function Home() {
  const {
    data,
    isLoading,
    error,
    refetch,
    downloadV6,
    downloadV7Sliced,
    activeAlerts,
    dismissAlert,
    setWsInterval,
    livePrice,
    aiAnalysis
  } = useMarketDataContext();

  const [selectedInterval, setSelectedInterval] = useState<Timeframe>('5m');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isSoundSettingsOpen, setIsSoundSettingsOpen] = useState(false);
  const [commandCenterTab, setCommandCenterTab] = useState<'strategy' | 'audio'>('strategy');
  const [counts, setCounts] = useState({ '5m': 60, '15m': 0, '1h': 72, '4h': 20 });

  // Strategy Execution Engine — runs silently in the background
  useStrategyEvaluator();

  // Sync localized selection with global WebSocket context interval
  useEffect(() => {
    setWsInterval(selectedInterval);
  }, [selectedInterval, setWsInterval]);

  // Fetch fresh historical candles when selectedInterval changes or Home mounts
  useEffect(() => {
    refetch();
  }, [selectedInterval, refetch]);

  const getChartData = () => {
    if (!data) return [];
    const key = `candles_${selectedInterval}`;
    return data.data_payload[key] ?? [];
  };

  const currentPrice = data?.data_payload?.candles_5m?.slice(-1)[0]?.c ?? null;

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
      console.error('[Home] Failed to parse AI Analysis JSON for Master Bias:', e);
    }
  }

  const pricing = data?.ipda_metrics?.current_pricing || 'SCANNING';
  const targetStatus = data?.ipda_metrics?.target_status || 'PENDING';

  return (
    <main className="flex h-[calc(100vh-56px)] w-full bg-background overflow-hidden selection:bg-accent/30 font-sans transition-colors duration-300">
      {/* ── Left / Main column ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col relative min-w-0">
        {/* Alerts UI Floating overlay */}
        <SmartAlertsToast activeAlerts={activeAlerts || []} dismissAlert={dismissAlert} />

        {/* Background glow effects */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-accent/10 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[10%] w-[40%] h-[40%] rounded-full bg-purple-900/10 blur-[120px] pointer-events-none" />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="py-3.5 md:py-4 mb-3 border-b border-card-border flex items-center justify-between px-4 lg:px-6 relative z-12 bg-card/45 backdrop-blur-xl gap-4 transition-colors">

          {/* Focal Price & Asset Display */}
          <div className="flex items-baseline gap-3.5 select-none">
            <span className="font-mono text-1xl md:text-1xl font-black text-foreground tracking-wider uppercase">
              ETHUSDC.P
            </span>
            <LiveTicker variant="large" />
          </div>

          {/* Timeframe selector + hamburger */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Alert Sounds Config Button */}
            <button
              onClick={() => {
                setCommandCenterTab('strategy');
                setIsSoundSettingsOpen(true);
              }}
              className="bg-card border border-card-border hover:border-accent text-muted hover:text-foreground px-3 py-1.5 font-mono text-[10px] font-black uppercase tracking-widest transition-all rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm"
              title="Open Command Center"
            >
              <Settings size={12} />
              <span className="hidden sm:inline">[ COMMAND CENTER ]</span>
            </button>

            <TimeframeSwitcher selectedInterval={selectedInterval} onChange={setSelectedInterval} />

            {/* Hamburger — visible only on <lg screens */}
            <button
              id="btn-open-sidebar"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 bg-card border border-card-border text-muted hover:text-foreground hover:border-accent transition-all rounded-full"
              aria-label="Open sidebar"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── 3 Large Visual HUD Cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-4 lg:px-6 py-4 shrink-0 relative z-10">

          {/* Card 1: Master Bias */}
          <div className={`glass-panel p-4 lg:p-5 min-h-[105px] flex flex-col justify-between relative overflow-hidden group select-none transition-all duration-300 ${masterBias === 'BULLISH' ? 'shadow-[inset_0_0_20px_rgba(16,185,129,0.04)] border-emerald-500/20' :
            masterBias === 'BEARISH' ? 'shadow-[inset_0_0_20px_rgba(244,63,94,0.04)] border-rose-500/20' :
              'border-card-border'
            }`}>
            <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-all duration-300 ${masterBias === 'BULLISH' ? 'bg-emerald-500/10 dark:bg-emerald-500/20' :
              masterBias === 'BEARISH' ? 'bg-rose-500/10 dark:bg-rose-500/20' :
                'bg-accent/5'
              }`} />
            <span className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-zinc-400">Master Bias</span>
            <span className={`text-2xl lg:text-3xl font-black mt-2 leading-none transition-colors duration-300 ${masterBias === 'BULLISH' ? 'text-emerald-500 dark:text-emerald-400' :
              masterBias === 'BEARISH' ? 'text-rose-500 dark:text-rose-400' :
                'text-foreground'
              }`}>
              {masterBias}
            </span>
          </div>

          {/* Card 2: Range Context */}
          <div className={`glass-panel p-4 lg:p-5 min-h-[105px] flex flex-col justify-between relative overflow-hidden group select-none transition-all duration-300 ${pricing === 'DISCOUNT' ? 'shadow-[inset_0_0_20px_rgba(16,185,129,0.04)] border-emerald-500/20' :
            pricing === 'PREMIUM' ? 'shadow-[inset_0_0_20px_rgba(244,63,94,0.04)] border-rose-500/20' :
              'border-card-border'
            }`}>
            <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-all duration-300 ${pricing === 'DISCOUNT' ? 'bg-emerald-500/10 dark:bg-emerald-500/20' :
              pricing === 'PREMIUM' ? 'bg-rose-500/10 dark:bg-rose-500/20' :
                'bg-accent/5'
              }`} />
            <span className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-zinc-400">Range Context</span>
            <span className={`text-2xl lg:text-3xl font-black mt-2 leading-none transition-colors duration-300 ${pricing === 'DISCOUNT' ? 'text-emerald-500 dark:text-emerald-400' :
              pricing === 'PREMIUM' ? 'text-rose-500 dark:text-rose-400' :
                'text-foreground'
              }`}>
              {pricing}
            </span>
          </div>

          {/* Card 3: Daily Objective Level */}
          <div className={`glass-panel p-4 lg:p-5 min-h-[105px] flex flex-col justify-between relative overflow-hidden group select-none transition-all duration-300 ${targetStatus === 'EXHAUSTED' ? 'shadow-[inset_0_0_20px_rgba(16,185,129,0.04)] border-emerald-500/20' :
            'border-card-border'
            }`}>
            <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-all duration-300 ${targetStatus === 'EXHAUSTED' ? 'bg-emerald-500/10 dark:bg-emerald-500/20' :
              'bg-accent/5'
              }`} />
            <span className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-zinc-400">Target Status (DOL)</span>
            <span className={`text-lg lg:text-xl font-black mt-2 leading-none transition-colors duration-300 ${targetStatus === 'EXHAUSTED' ? 'text-emerald-500 dark:text-emerald-400' : 'text-accent'
              }`}>
              {targetStatus}
            </span>
          </div>
        </div>

        {/* ── Chart Area ─────────────────────────────────────────────────── */}
        <div className="flex-1 relative px-4 lg:px-6 pb-4 z-10 flex flex-col min-h-0">
          {error ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="bg-[#ffb4ab]/10 text-[#ffb4ab] px-6 py-4 rounded-2xl border border-[#ffb4ab]/20 shadow-lg shadow-[#ffb4ab]/10 flex items-center gap-3">
                <span className="font-semibold">Error:</span> {error}
              </div>
            </div>
          ) : !data && isLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-10 h-10 text-accent animate-spin" />
                <span className="text-sm font-medium text-muted-foreground animate-pulse text-center px-4">
                  Establishing direct link to Binance Futures...
                </span>
              </div>
            </div>
          ) : (
            <div className="w-full h-full rounded-2xl overflow-hidden border border-card-border bg-card/20 backdrop-blur-md shadow-2xl relative group">
              {/* Subtle inner glow for chart container */}
              <div className="absolute inset-0 shadow-[inset_0_0_100px_rgba(255,255,255,0.01)] pointer-events-none z-10" />
              <Chart
                data={getChartData()}
                activeFvgs={data?.ipda_metrics?.active_fvgs || []}
                localDealingRange={data?.ipda_metrics?.pricing_context?.local_dealing_range}
                interval={selectedInterval}
              />
              {/* Premium overlay for timeframe transition load states */}
              {isLoading && (
                <div className="absolute inset-0 bg-background/60 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-3 transition-opacity duration-300">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                  <span className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground animate-pulse">
                    Pivoting Timeframe Scale...
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <Sidebar
        data={data}
        counts={counts}
        onCountChange={(tf, val) => {
          const num = parseInt(val, 10);
          setCounts(prev => ({ ...prev, [tf]: isNaN(num) ? 0 : num }));
        }}
        onDownloadV6={downloadV6}
        onDownloadV7Sliced={downloadV7Sliced}
        isLoading={isLoading}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Global Command Center Modal */}
      <SettingsModal
        isOpen={isSoundSettingsOpen}
        alert={null}
        initialTab={commandCenterTab}
        onClose={() => setIsSoundSettingsOpen(false)}
        onSave={() => { }}
        onDelete={() => { }}
      />
    </main>
  );
}

