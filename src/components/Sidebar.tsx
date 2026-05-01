'use client';

import { useState } from 'react';
import { DownloadCloud, TrendingUp, Activity, X, Brain, Zap } from 'lucide-react';
import type { MarketDataPayload } from '@/hooks/useMarketData';

// ─── Slicing Helper ──────────────────────────────────────────────────────────
// Slices candle arrays to the specified lookback window before export/copy.
// ipda_metrics is preserved intact.
export function slicePayloadByLookback(
  data: MarketDataPayload,
  lookbackDays: number
): MarketDataPayload {
  return {
    ...data,
    data_payload: {
      candles_1h: data.data_payload.candles_1h.slice(-(lookbackDays * 24)),
      candles_15m: data.data_payload.candles_15m.slice(-(lookbackDays * 96)),
      candles_5m: data.data_payload.candles_5m.slice(-(lookbackDays * 288)),
    },
  };
}

// ─── AI Prompt Prefix ────────────────────────────────────────────────────────
const AI_PROMPT_PREFIX =
  'Act as the Institutional Flow Synthesizer V7.6. Analyze the following quantitative data and provide a mechanical bias report: \n\n';

// ─── Props ───────────────────────────────────────────────────────────────────
interface SidebarProps {
  currentPrice: number | null;
  openInterest: number | null;
  data: MarketDataPayload | null;
  onDownloadV6: () => void;
  onDownloadV7Sliced: (lookbackDays: number) => void;
  isLoading?: boolean;
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({
  currentPrice,
  openInterest,
  data,
  onDownloadV6,
  onDownloadV7Sliced,
  isLoading,
  isOpen,
  onClose,
}: SidebarProps) {
  const [lookbackDays, setLookbackDays] = useState(3);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  // ── One-Click Context handler ────────────────────────────────────────────
  const handleOneClickContext = async () => {
    if (!data) return;
    const sliced = slicePayloadByLookback(data, lookbackDays);
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

  // ── Slider percentage for track fill ────────────────────────────────────
  const sliderPct = ((lookbackDays - 1) / 6) * 100;

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

          {/* Live Price card */}
          <div className="bg-white/[0.02] rounded-2xl p-5 border border-white/[0.05] backdrop-blur-md relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-150 duration-500" />
            <p className="text-sm font-medium text-gray-400 mb-1 relative z-10">Live Price</p>
            <div className="flex items-baseline gap-2 relative z-10">
              <span className="text-3xl font-bold text-white tracking-tight">
                {isLoading ? (
                  <span className="animate-pulse text-gray-600">---</span>
                ) : currentPrice !== null ? (
                  `$${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                ) : (
                  '---'
                )}
              </span>
            </div>
          </div>

          {/* Open Interest card */}
          <div className="bg-white/[0.02] rounded-2xl p-5 border border-white/[0.05] backdrop-blur-md relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-150 duration-500" />
            <p className="text-sm font-medium text-gray-400 mb-1 relative z-10">Open Interest</p>
            <div className="flex items-center gap-2 relative z-10">
              <TrendingUp className="w-4 h-4 text-purple-400" />
              <span className="text-2xl font-bold text-white tracking-tight">
                {isLoading ? (
                  <span className="animate-pulse text-gray-600">---</span>
                ) : openInterest !== null ? (
                  openInterest.toLocaleString(undefined, { maximumFractionDigits: 2 })
                ) : (
                  '---'
                )}
              </span>
              <span className="text-sm text-gray-500 font-medium ml-1">ETH</span>
            </div>
          </div>

          {/* ── AI Context Window Slider ───────────────────────────────────── */}
          <div className="bg-white/[0.02] rounded-2xl p-5 border border-white/[0.05] backdrop-blur-md relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-3xl -mr-6 -mt-6 pointer-events-none" />
            <div className="flex items-center gap-2 mb-3 relative z-10">
              <Brain className="w-4 h-4 text-cyan-400 shrink-0" />
              <p className="text-sm font-semibold text-cyan-400 tracking-wide uppercase">AI Context Window</p>
            </div>
            <p className="text-xs text-gray-500 mb-4 relative z-10">
              Lookback:{' '}
              <span className="text-white font-bold">
                {lookbackDays} Day{lookbackDays > 1 ? 's' : ''}
              </span>
            </p>

            {/* Custom-styled range slider */}
            <div className="relative z-10">
              <div
                className="relative w-full h-2 rounded-full bg-white/10 mb-2 overflow-hidden"
                style={{ background: `linear-gradient(to right, #22d3ee ${sliderPct}%, rgba(255,255,255,0.1) ${sliderPct}%)` }}
              >
              </div>
              <input
                id="lookback-slider"
                type="range"
                min={1}
                max={7}
                step={1}
                value={lookbackDays}
                onChange={(e) => setLookbackDays(Number(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer h-2"
                style={{ top: 0 }}
              />
              <div className="flex justify-between text-[10px] text-gray-600 mt-1 px-0.5">
                {[1, 2, 3, 4, 5, 6, 7].map(d => (
                  <span
                    key={d}
                    className={d === lookbackDays ? 'text-cyan-400 font-bold' : ''}
                  >
                    {d}d
                  </span>
                ))}
              </div>
            </div>

            {/* Candle count preview */}
            <div className="mt-4 grid grid-cols-3 gap-2 relative z-10">
              {[
                { label: '1H', count: lookbackDays * 24 },
                { label: '15M', count: lookbackDays * 96 },
                { label: '5M', count: lookbackDays * 288 },
              ].map(({ label, count }) => (
                <div key={label} className="flex flex-col items-center bg-black/30 rounded-xl p-2 border border-white/5">
                  <span className="text-[10px] text-gray-500 font-medium">{label}</span>
                  <span className="text-sm font-bold text-white">{count}</span>
                  <span className="text-[9px] text-gray-600">candles</span>
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

            {/* V7.6 Enriched Download — respects slider */}
            <button
              id="btn-download-v7"
              onClick={() => onDownloadV7Sliced(lookbackDays)}
              disabled={isLoading || !data}
              className="w-full relative group overflow-hidden rounded-2xl p-[1px] disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-purple-500 rounded-2xl opacity-60 group-hover:opacity-90 transition-opacity duration-300" />
              <div className="relative flex items-center justify-center gap-2 px-5 py-3 bg-[#0a0a0a] rounded-2xl group-hover:bg-transparent transition-colors duration-300">
                <DownloadCloud className="w-4 h-4 text-cyan-300 group-hover:text-white shrink-0 transition-colors duration-300" />
                <span className="font-bold text-white text-sm">⬇ Download V7.6 Enriched Data</span>
              </div>
            </button>

            {/* V6 Naked — unaffected by slider (raw full payload) */}
            <button
              id="btn-download-v6"
              onClick={onDownloadV6}
              disabled={isLoading || !data}
              className="w-full relative group overflow-hidden rounded-2xl p-[1px] disabled:opacity-50 disabled:cursor-not-allowed border border-white/10 hover:border-white/20 transition-colors min-h-[44px]"
            >
              <div className="relative flex items-center justify-center gap-2 px-5 py-3 bg-[#111] rounded-2xl transition-colors duration-300 hover:bg-[#1a1a1a]">
                <span className="font-semibold text-gray-300 group-hover:text-white text-sm transition-colors">
                  ⬇️ Download V6 Naked Data
                </span>
              </div>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
