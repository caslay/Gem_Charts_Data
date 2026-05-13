'use client';

import { useState } from 'react';
import { useMarketData } from '@/hooks/useMarketData';
import Chart from '@/components/Chart';
import Sidebar from '@/components/Sidebar';
import { Loader2, Menu, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Timeframe = '5m' | '15m' | '1h';

export default function Home() {
  const { data, isLoading, error, downloadV6, downloadV7Sliced } = useMarketData();
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [counts, setCounts] = useState({ '5m': 60, '15m': 0, '1h': 72, '4h': 20 });

  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAIAnalysis = async () => {
    if (!data) return;
    setIsAnalyzing(true);
    setAiAnalysis(null);

    try {
      const response = await fetch('/api/quant-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      const result = await response.json();
      if (response.ok) {
        setAiAnalysis(result.analysis);
      } else {
        setAiAnalysis(`**Error:** ${result.error || 'Failed to fetch analysis.'}`);
      }
    } catch (err) {
      console.error(err);
      setAiAnalysis('**Error:** Connection failed. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getChartData = () => {
    if (!data) return [];
    if (timeframe === '5m') return data.data_payload.candles_5m ?? [];
    if (timeframe === '15m') return data.data_payload.candles_15m ?? [];
    if (timeframe === '1h') return data.data_payload.candles_1h ?? [];
    return [];
  };

  const currentPrice = data?.data_payload?.candles_5m?.slice(-1)[0]?.c ?? null;

  return (
    <main className="flex h-screen w-full bg-black overflow-hidden selection:bg-cyan-500/30 font-sans">
      {/* ── Left / Main column ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col relative min-w-0">
        {/* Background glow effects */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-900/20 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[10%] w-[40%] h-[40%] rounded-full bg-purple-900/20 blur-[120px] pointer-events-none" />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="h-16 lg:h-20 border-b border-white/5 flex items-center justify-between px-4 lg:px-8 relative z-10 bg-black/40 backdrop-blur-md gap-3">

          {/* Brand */}
          <div className="flex items-center gap-2 lg:gap-3 min-w-0">
            <div className="w-2 h-6 lg:h-8 rounded-full bg-gradient-to-b from-cyan-400 to-blue-600 shrink-0" />
            <h1 className="text-base lg:text-2xl font-bold text-white tracking-tight truncate">
              Flow-State Quant Engine
            </h1>
            <span className="px-2 py-1 rounded bg-white/10 text-[10px] lg:text-xs font-bold text-cyan-400 border border-white/5 ml-1 shadow-[0_0_10px_rgba(34,211,238,0.2)] shrink-0">
              V7.9
            </span>
          </div>

          {/* Timeframe selector + hamburger */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 bg-[#0f0f0f] p-1 lg:p-1.5 rounded-xl border border-white/10 shadow-inner">
              {(['5m', '15m', '1h'] as const).map((tf) => (
                <button
                  key={tf}
                  id={`tf-${tf}`}
                  onClick={() => setTimeframe(tf)}
                  className={`px-3 lg:px-6 py-1.5 lg:py-2 rounded-lg text-xs lg:text-sm font-bold transition-all duration-300 ${timeframe === tf
                      ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.15)] border border-cyan-500/30'
                      : 'text-gray-500 hover:text-white hover:bg-white/5 border border-transparent'
                    }`}
                >
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Hamburger — visible only on <lg screens */}
            <button
              id="btn-open-sidebar"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-colors"
              aria-label="Open sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── AI Analysis Panel ───────────────────────────────────────────── */}
        <div className="px-4 lg:px-8 pt-4 lg:pt-6 z-10 relative flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={handleAIAnalysis}
              disabled={isAnalyzing || !data || isLoading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-700 hover:from-cyan-500 hover:to-blue-600 text-white font-bold tracking-wide shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🧠 Run Quant AI Analysis
            </button>
            {isAnalyzing && (
              <div className="flex items-center gap-2 text-cyan-400 animate-pulse font-medium">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Synthesizing Order Flow...</span>
              </div>
            )}
          </div>
          
          {aiAnalysis && (
            <div className="relative p-6 rounded-2xl bg-[#0a0a0a]/90 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_30px_rgba(34,211,238,0.15)] max-h-[40vh] overflow-y-auto">
              <div className="text-gray-300 text-sm leading-relaxed space-y-4 [&>h1]:text-xl [&>h1]:font-bold [&>h1]:text-white [&>h2]:text-lg [&>h2]:font-bold [&>h2]:text-cyan-400 [&>h3]:text-base [&>h3]:font-bold [&>h3]:text-cyan-300 [&>p]:mb-4 [&>ul]:list-disc [&>ul]:ml-5 [&>li]:mb-1 [&>strong]:text-white">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiAnalysis}</ReactMarkdown>
              </div>
              <button 
                onClick={() => setAiAnalysis(null)}
                className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                title="Dismiss Analysis"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        {/* ── Chart Area ─────────────────────────────────────────────────── */}
        <div className="flex-1 relative p-3 lg:p-6 z-10 flex flex-col min-h-0">
          {error ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="bg-red-500/10 text-red-400 px-6 py-4 rounded-2xl border border-red-500/20 shadow-lg shadow-red-500/10 flex items-center gap-3">
                <span className="font-semibold">Error:</span> {error}
              </div>
            </div>
          ) : isLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-10 h-10 text-cyan-500 animate-spin" />
                <span className="text-sm font-medium text-gray-400 animate-pulse text-center px-4">
                  Establishing direct link to Binance Futures...
                </span>
              </div>
            </div>
          ) : (
            <div className="w-full h-full rounded-2xl overflow-hidden border border-white/5 bg-[#050505]/80 backdrop-blur-xl shadow-2xl relative group">
              {/* Subtle inner glow for chart container */}
              <div className="absolute inset-0 shadow-[inset_0_0_100px_rgba(255,255,255,0.02)] pointer-events-none z-10" />
              <Chart data={getChartData()} />
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
