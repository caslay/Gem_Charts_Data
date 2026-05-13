'use client';

import { useState } from 'react';
import { DownloadCloud, TrendingUp, Activity, X, Brain, Zap } from 'lucide-react';
import type { MarketDataPayload } from '@/hooks/useMarketData';

// ─── Slicing Helper ──────────────────────────────────────────────────────────
// Slices candle arrays to the specified lookback window before export/copy.
// ipda_metrics is preserved intact.
export function slicePayloadByLookback(
  data: MarketDataPayload,
  counts: { '5m': number, '15m': number, '1h': number, '4h': number }
): MarketDataPayload {
  const data_payload: any = {};
  
  if (counts['4h'] > 0 && Array.isArray(data.data_payload?.candles_4h)) {
    data_payload.candles_4h = data.data_payload.candles_4h.slice(-counts['4h']);
  }
  if (counts['1h'] > 0 && Array.isArray(data.data_payload?.candles_1h)) {
    data_payload.candles_1h = data.data_payload.candles_1h.slice(-counts['1h']);
  }
  if (counts['15m'] > 0 && Array.isArray(data.data_payload?.candles_15m)) {
    data_payload.candles_15m = data.data_payload.candles_15m.slice(-counts['15m']);
  }
  if (counts['5m'] > 0 && Array.isArray(data.data_payload?.candles_5m)) {
    data_payload.candles_5m = data.data_payload.candles_5m.slice(-counts['5m']);
  }

  return {
    ...data,
    data_payload,
  };
}

// ─── AI Prompt Prefix ────────────────────────────────────────────────────────
const AI_PROMPT_PREFIX =
  'Act as the Institutional Flow Synthesizer V7.9. Analyze the following quantitative data and provide a mechanical bias report: \n\n';

// ─── Props ───────────────────────────────────────────────────────────────────
interface SidebarProps {
  data: MarketDataPayload | null;
  counts: { '5m': number, '15m': number, '1h': number, '4h': number };
  onCountChange: (tf: '5m' | '15m' | '1h' | '4h', value: string) => void;
  onDownloadV6: () => void;
  onDownloadV7Sliced: (counts: { '5m': number, '15m': number, '1h': number, '4h': number }) => void;
  isLoading?: boolean;
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({
  data,
  counts,
  onCountChange,
  onDownloadV6,
  onDownloadV7Sliced,
  isLoading,
  isOpen,
  onClose,
}: SidebarProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  // ── One-Click Context handler ────────────────────────────────────────────
  const handleOneClickContext = async () => {
    if (!data) return;
    const sliced = slicePayloadByLookback(data, counts);
    const text = AI_PROMPT_PREFIX + JSON.stringify(sliced, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      // Fallback: create a temporary textarea
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  };



  return (
    <>
      {/* Mobile overlay backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
      />

      {/* Sidebar panel */}
      <aside
        className={`
          fixed top-0 right-0 z-40 h-full w-80 max-w-[90vw]
          bg-[#0a0a0a] border-l border-white/5 flex flex-col gap-5 lg:relative shadow-2xl
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
          lg:static lg:translate-x-0 lg:flex lg:w-80 lg:shrink-0 lg:z-10
        `}
      >
        {/* Inner scrollable area */}
        <div className="flex flex-col gap-5 h-full overflow-y-auto p-6">

          {/* Header row with close button (mobile only) */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 shrink-0">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">ETHUSDC.p</h2>
                <p className="text-sm text-gray-400 font-medium">Binance Futures</p>
              </div>
            </div>
            {/* Close (X) – only visible on mobile */}
            <button
              onClick={onClose}
              className="lg:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ── IPDA Metrics Grid ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 relative z-10">
            {/* Pricing Context */}
            <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.05] backdrop-blur-md">
               <p className="text-[10px] text-gray-500 uppercase font-semibold">Pricing Context</p>
               <p className={`text-sm font-bold mt-1 ${data?.ipda_metrics?.current_pricing === 'PREMIUM' ? 'text-red-500' : data?.ipda_metrics?.current_pricing === 'DISCOUNT' ? 'text-green-500' : 'text-white'}`}>
                 {data?.ipda_metrics?.current_pricing || '---'}
               </p>
            </div>
            {/* True Day Open */}
            <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.05] backdrop-blur-md">
               <p className="text-[10px] text-gray-500 uppercase font-semibold">True Day Open</p>
               <p className="text-sm font-bold text-white mt-1">
                 {data?.ipda_metrics?.true_day_open ? `$${data?.ipda_metrics?.true_day_open}` : '---'}
               </p>
            </div>
            {/* Target Status */}
            <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.05] backdrop-blur-md">
               <p className="text-[10px] text-gray-500 uppercase font-semibold">Target Status</p>
               {data?.ipda_metrics?.target_status === 'PENDING' ? (
                  <span className="inline-block px-2 py-0.5 mt-1 rounded text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">PENDING</span>
               ) : data?.ipda_metrics?.target_status === 'EXHAUSTED' ? (
                  <span className="inline-block px-2 py-0.5 mt-1 rounded text-xs font-bold bg-gray-500/20 text-gray-400 border border-gray-500/30">EXHAUSTED</span>
               ) : <span className="text-sm font-bold text-white mt-1 block">---</span>}
            </div>
            {/* Inst. Sponsorship */}
            <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.05] backdrop-blur-md">
               <p className="text-[10px] text-gray-500 uppercase font-semibold">Inst. Sponsorship</p>
               {data?.ipda_metrics?.institutional_sponsorship?.displacement_active ? (
                 <span className="text-sm font-bold text-yellow-400 flex items-center gap-1 mt-1">⚡ ACTIVE</span>
               ) : (
                 <span className="text-sm font-bold text-gray-500 mt-1 block">INACTIVE</span>
               )}
            </div>
            {/* Time Window */}
            <div className="col-span-2 bg-white/[0.02] rounded-xl p-3 border border-white/[0.05] backdrop-blur-md">
               <p className="text-[10px] text-gray-500 uppercase font-semibold">Time Window</p>
               <p className="text-sm font-bold text-cyan-400 mt-1">
                 {data?.ipda_metrics?.current_time_window || '---'}
               </p>
            </div>
          </div>

          {/* ── Dynamic UI Inputs ───────────────────────────────────── */}
          <div className="bg-white/[0.02] rounded-2xl p-5 border border-white/[0.05] backdrop-blur-md relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-3xl -mr-6 -mt-6 pointer-events-none" />
            <div className="flex items-center gap-2 mb-4 relative z-10">
              <Brain className="w-4 h-4 text-cyan-400 shrink-0" />
              <p className="text-sm font-semibold text-cyan-400 tracking-wide uppercase">AI Context Settings</p>
            </div>

            <div className="grid grid-cols-2 gap-3 relative z-10">
              {(['5m', '15m', '1h', '4h'] as const).map((tf) => (
                <div key={tf} className="flex flex-col bg-black/30 rounded-xl p-2 border border-white/5">
                  <label htmlFor={`input-${tf}`} className="text-[10px] text-gray-500 font-medium mb-1 uppercase text-center">{tf} Candles</label>
                  <input
                    id={`input-${tf}`}
                    type="number"
                    min="0"
                    value={counts[tf]}
                    onChange={(e) => onCountChange(tf, e.target.value)}
                    className="w-full bg-transparent text-white text-sm font-bold text-center outline-none border-b border-white/10 focus:border-cyan-400 transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1" />

          {/* ── Action Buttons ─────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3">

            {/* ONE-CLICK CONTEXT — primary CTA */}
            <button
              id="btn-one-click-context"
              onClick={handleOneClickContext}
              disabled={isLoading || !data}
              className="w-full relative group overflow-hidden rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed min-h-[52px]"
            >
              {/* Animated gradient border */}
              <span className={`absolute inset-0 rounded-2xl transition-opacity duration-300 ${copyState === 'copied'
                ? 'bg-gradient-to-r from-emerald-400 to-teal-500 opacity-90'
                : 'bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 opacity-80 group-hover:opacity-100'
                }`} />
              {/* Inner bg that disappears on hover for a "fill" effect */}
              <div className={`relative flex items-center justify-center gap-2 px-5 py-3 m-[1px] rounded-2xl transition-all duration-300 ${copyState === 'copied'
                ? 'bg-transparent'
                : 'bg-[#0a0a0a] group-hover:bg-transparent'
                }`}>
                <Zap className={`w-4 h-4 shrink-0 transition-colors duration-300 ${copyState === 'copied' ? 'text-white' : 'text-cyan-300 group-hover:text-white'
                  }`} />
                <span className={`font-bold text-sm transition-colors duration-300 ${copyState === 'copied' ? 'text-white' : 'text-white'
                  }`}>
                  {copyState === 'copied' ? '✅ Copied to Clipboard!' : '⚡ One-Click Context (AI Ready)'}
                </span>
              </div>
            </button>

            {/* ── JSON Download Buttons ── */}
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={onDownloadV6}
                disabled={!data}
                className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-xl text-xs font-semibold text-gray-400 hover:text-white transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                title="Download V6 Naked JSON"
              >
                <span className="text-gray-500">{"{}"}</span>
                Raw V6
              </button>
              <button
                onClick={() => onDownloadV7Sliced(counts)}
                disabled={!data}
                className="flex-1 px-3 py-2 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 hover:from-cyan-500/30 hover:to-blue-500/30 border border-cyan-500/20 hover:border-cyan-500/40 rounded-xl text-xs font-bold text-cyan-300 hover:text-cyan-100 transition-all disabled:opacity-50 shadow-[0_0_10px_rgba(34,211,238,0.1)] flex items-center justify-center gap-1.5"
                title="Download V7.9 Enriched JSON (Sliced)"
              >
                <span className="text-cyan-500">{"{}"}</span>
                Sliced V7.9
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
