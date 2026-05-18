'use client';

import { useState } from 'react';
import { useMarketData } from '@/hooks/useMarketData';
import Chart from '@/components/Chart';
import Sidebar from '@/components/Sidebar';
import SmartAlertsToast from '@/components/SmartAlertsToast';
import { Loader2, Menu } from 'lucide-react';

type Timeframe = '5m' | '15m' | '1h';

export default function Home() {
  const { data, isLoading, error, downloadV6, downloadV7Sliced, activeAlerts, dismissAlert } = useMarketData();
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [counts, setCounts] = useState({ '5m': 60, '15m': 0, '1h': 72, '4h': 20 });



  const getChartData = () => {
    if (!data) return [];
    if (timeframe === '5m') return data.data_payload.candles_5m ?? [];
    if (timeframe === '15m') return data.data_payload.candles_15m ?? [];
    if (timeframe === '1h') return data.data_payload.candles_1h ?? [];
    return [];
  };

  const currentPrice = data?.data_payload?.candles_5m?.slice(-1)[0]?.c ?? null;

  return (
    <main className="flex h-[calc(100vh-64px)] w-full bg-[#0e0e0f] overflow-hidden selection:bg-[#d1bcff]/30 font-sans">
      {/* ── Left / Main column ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col relative min-w-0">
        {/* Alerts UI Floating overlay */}
        <SmartAlertsToast activeAlerts={activeAlerts || []} dismissAlert={dismissAlert} />

        {/* Background glow effects */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#d1bcff]/20 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[10%] w-[40%] h-[40%] rounded-full bg-purple-900/20 blur-[120px] pointer-events-none" />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="h-14 lg:h-16 border-b border-[#4a4457]/50 flex items-center justify-between px-4 lg:px-6 relative z-10 bg-[#0e0e0f]/60 backdrop-blur-xl gap-4">

          {/* Brand / Context Title */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 bg-[#50ffaf] flex items-center justify-center shrink-0">
              <span className="text-black text-[10px] font-black tracking-tighter">FS</span>
            </div>
            <div className="flex flex-col -space-y-0.5 truncate">
              <h1 className="text-[10px] lg:text-xs font-black text-[#e5e2e3] uppercase tracking-[0.2em] truncate">
                Quant Engine Dashboard
              </h1>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold text-[#958da3] uppercase tracking-widest">Institutional Flow</span>
                <span className="px-1.5 py-0.5 bg-[#d1bcff]/10 text-[8px] font-black text-[#d1bcff] border border-[#d1bcff]/20 leading-none">
                  V8.0
                </span>
              </div>
            </div>
          </div>

          {/* Timeframe selector + hamburger */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center p-0.5 bg-[#1c1b1c] border border-[#4a4457]/50">
              {(['5m', '15m', '1h'] as const).map((tf) => (
                <button
                  key={tf}
                  id={`tf-${tf}`}
                  onClick={() => setTimeframe(tf)}
                  className={`px-3 lg:px-5 py-1.5 text-[10px] lg:text-[11px] font-black uppercase tracking-widest transition-all duration-200 ${timeframe === tf
                    ? 'bg-[#d1bcff] text-black shadow-[0_0_20px_rgba(209,188,255,0.2)]'
                    : 'text-[#958da3] hover:text-[#e5e2e3] hover:bg-white/5'
                    }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* Hamburger — visible only on <lg screens */}
            <button
              id="btn-open-sidebar"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 bg-[#1c1b1c] border border-[#4a4457]/50 text-[#958da3] hover:text-[#50ffaf] hover:border-[#50ffaf]/50 transition-all"
              aria-label="Open sidebar"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        </div>



        {/* ── Chart Area ─────────────────────────────────────────────────── */}
        <div className="flex-1 relative p-3 lg:p-6 z-10 flex flex-col min-h-0">
          {error ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="bg-[#ffb4ab]/10 text-[#ffb4ab] px-6 py-4 rounded-2xl border border-[#ffb4ab]/20 shadow-lg shadow-[#ffb4ab]/10 flex items-center gap-3">
                <span className="font-semibold">Error:</span> {error}
              </div>
            </div>
          ) : isLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-10 h-10 text-[#d1bcff] animate-spin" />
                <span className="text-sm font-medium text-[#958da3] animate-pulse text-center px-4">
                  Establishing direct link to Binance Futures...
                </span>
              </div>
            </div>
          ) : (
            <div className="w-full h-full rounded-2xl overflow-hidden border border-[#4a4457]/50 bg-[#1c1b1c]/80 backdrop-blur-xl shadow-2xl relative group">
              {/* Subtle inner glow for chart container */}
              <div className="absolute inset-0 shadow-[inset_0_0_100px_rgba(255,255,255,0.02)] pointer-events-none z-10" />
              <Chart 
                data={getChartData()} 
                activeFvgs={data?.ipda_metrics?.active_fvgs || []}
                localDealingRange={data?.ipda_metrics?.pricing_context?.local_dealing_range}
                interval={timeframe}
              />
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
    </main>
  );
}
