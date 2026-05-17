'use client';

import { useState } from 'react';
import { DownloadCloud, TrendingUp, Activity, X, Brain, Zap, Target, Magnet, BarChart3, Terminal, Loader2, Copy, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MarketDataPayload } from '@/hooks/useMarketData';

// ─── Slicing Helper ──────────────────────────────────────────────────────────
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
  'Act as the Institutional Flow Synthesizer V8.0. Analyze the following quantitative data and provide a mechanical bias report: \n\n';

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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const metrics = data?.ipda_metrics;
  const orderFlow = metrics?.order_flow_engine;
  const pricing = metrics?.current_pricing;

  const handleLiveSynthesis = async () => {
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
        setAiAnalysis(`**Error:** ${result.error || 'Synthesis failed.'}`);
      }
    } catch (err) {
      console.error(err);
      setAiAnalysis('**Error:** Connection lost during synthesis.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const formatPrice = (price: number | null | undefined) => 
    price != null ? price.toFixed(2) : '---';

  const handleCopyJson = async () => {
    if (!data) return;
    const sliced = slicePayloadByLookback(data, counts);
    const text = AI_PROMPT_PREFIX + JSON.stringify(sliced, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
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
        className={`fixed inset-0 z-30 bg-[#0e0e0f]/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Sidebar panel */}
      <aside
        className={`
          fixed top-0 right-0 z-40 h-full w-80 max-w-[90vw]
          bg-[#0e0e0f] border-l border-[#4a4457]/50 flex flex-col lg:relative shadow-2xl
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
          lg:static lg:translate-x-0 lg:flex lg:w-80 lg:shrink-0 lg:z-10
        `}
      >
        <div className="flex flex-col h-full overflow-hidden">
          
          {/* Header */}
          <div className="p-5 border-b border-[#4a4457]/50 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#50ffaf]" />
              <h2 className="text-xs font-black uppercase tracking-[0.2em] text-[#e5e2e3]">Execution Sidebar</h2>
            </div>
            <button onClick={onClose} className="lg:hidden p-1 text-[#958da3] hover:text-[#e5e2e3]">
              <X size={18} />
            </button>
          </div>

          {/* Scrollable Cards Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-[#4a4457]/50 scrollbar-track-transparent">
            
            {/* Card 1: Context */}
            <div className="bg-[#1c1b1c] border border-[#4a4457]/50 rounded-none p-4 space-y-3">
              <div className="flex items-center gap-2 text-[#958da3] uppercase font-bold text-[10px] tracking-widest">
                <Target size={12} />
                <span>Temporal Context</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-[#958da3]">Day Open</span>
                  <span className="text-xs font-mono text-[#e5e2e3]">{formatPrice(metrics?.true_day_open)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-[#958da3]">Time Window</span>
                  <span className="text-xs font-mono text-[#d1bcff] uppercase">{metrics?.current_time_window || '---'}</span>
                </div>
                <div className="flex justify-between items-center pt-1">
                  <span className="text-[10px] text-[#958da3] uppercase font-black tracking-tighter">Status</span>
                  <span className={`px-2 py-0.5 text-[10px] font-black rounded-none border ${
                    pricing === 'PREMIUM' ? 'bg-[#ffb4ab]/10 text-[#ffb4ab] border-[#ffb4ab]/30' : 
                    pricing === 'DISCOUNT' ? 'bg-[#50ffaf]/10 text-[#50ffaf] border-[#50ffaf]/30' : 
                    'bg-zinc-800/10 text-[#958da3] border-[#4a4457]/50'
                  }`}>
                    {pricing || 'SCANNING'}
                  </span>
                </div>
              </div>
            </div>

            {/* Card 2: Liquidity */}
            <div className="bg-[#1c1b1c] border border-[#4a4457]/50 rounded-none p-4 space-y-3">
              <div className="flex items-center gap-2 text-[#958da3] uppercase font-bold text-[10px] tracking-widest">
                <Magnet size={12} />
                <span>Macro Liquidity</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#0e0e0f] p-2 border border-[#4a4457]/50">
                  <span className="text-[8px] text-[#958da3] block mb-1">PDH</span>
                  <span className="text-xs font-mono text-[#e5e2e3]">{formatPrice(metrics?.macro_levels?.pdh)}</span>
                </div>
                <div className="bg-[#0e0e0f] p-2 border border-[#4a4457]/50">
                  <span className="text-[8px] text-[#958da3] block mb-1">PDL</span>
                  <span className="text-xs font-mono text-[#e5e2e3]">{formatPrice(metrics?.macro_levels?.pdl)}</span>
                </div>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-[#4a4457]/50 mt-1">
                <span className="text-[10px] text-[#958da3]">Target State</span>
                <span className={`text-[10px] font-bold ${metrics?.target_status === 'EXHAUSTED' ? 'text-[#958da3]' : 'text-[#50ffaf]'}`}>
                  {metrics?.target_status || 'PENDING'}
                </span>
              </div>
            </div>

            {/* Card 3: Order Flow */}
            <div className="bg-[#1c1b1c] border border-[#4a4457]/50 rounded-none p-4 space-y-3">
              <div className="flex items-center gap-2 text-[#958da3] uppercase font-bold text-[10px] tracking-widest">
                <BarChart3 size={12} />
                <span>Order Flow Pulse</span>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-[#958da3]">OI Trend</span>
                  <span className={`text-[10px] font-bold ${
                    orderFlow?.open_interest_trend === 'BULLISH' ? 'text-[#50ffaf]' : 
                    orderFlow?.open_interest_trend === 'BEARISH' ? 'text-[#ffb4ab]' : 'text-[#958da3]'
                  }`}>
                    {orderFlow?.open_interest_trend || 'NEUTRAL'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-[#958da3]">Displacement</span>
                  <span className={`text-[10px] font-bold ${metrics?.institutional_sponsorship?.status === 'ACTIVE' ? 'text-[#ffb2bb]' : 'text-[#958da3]'}`}>
                    {metrics?.institutional_sponsorship?.status || 'INACTIVE'}
                  </span>
                </div>
                <div className="bg-[#0e0e0f] p-2 border border-[#4a4457]/50 mt-2">
                  <span className="text-[8px] text-[#958da3] block mb-1 uppercase tracking-tight">Smart Money Div</span>
                  <p className="text-[9px] text-[#958da3] italic">
                    {orderFlow?.smart_money_sentiment?.smart_money_divergence || 'No divergence detected in HTF/LTF pairing.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Card 4: Resting Magnets */}
            <div className="bg-[#1c1b1c] border border-[#4a4457]/50 rounded-none p-4 space-y-3">
              <div className="flex items-center gap-2 text-[#958da3] uppercase font-bold text-[10px] tracking-widest">
                <Activity size={12} />
                <span>Resting Magnets</span>
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black text-[#50ffaf] uppercase tracking-tighter">BSL Targets</span>
                  <p className="text-xs font-mono text-[#e5e2e3] break-words leading-relaxed text-wrap">
                    {orderFlow?.resting_liquidity_pools?.BSL_Magnets?.map((p: number) => p.toFixed(2)).join(', ') || 'N/A'}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black text-[#ffb4ab] uppercase tracking-tighter">SSL Targets</span>
                  <p className="text-xs font-mono text-[#e5e2e3] break-words leading-relaxed text-wrap">
                    {orderFlow?.resting_liquidity_pools?.SSL_Magnets?.map((p: number) => p.toFixed(2)).join(', ') || 'N/A'}
                  </p>
                </div>
              </div>
            </div>

            {/* Card 5: AI Synthesis Console */}
            <div className="bg-[#1c1b1c] border border-[#4a4457]/50 rounded-none flex flex-col h-80">
              <div className="p-3 border-b border-[#4a4457]/50 bg-[#1c1b1c] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal size={12} className="text-[#d1bcff]" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#958da3]">Synthesis Console</span>
                </div>
                {isAnalyzing && <Loader2 size={12} className="text-[#d1bcff] animate-spin" />}
              </div>
              
              <div className="flex-1 p-3 overflow-y-auto bg-[#0e0e0f] font-mono scrollbar-thin scrollbar-thumb-[#4a4457]/50">
                {aiAnalysis ? (
                  <div className="text-[11px] text-[#e5e2e3] leading-relaxed prose prose-invert prose-xs max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiAnalysis}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-4">
                    <Brain size={24} className="text-zinc-800 mb-2" />
                    <p className="text-[10px] text-[#958da3] uppercase tracking-tighter">System Ready. Awaiting Live Payload Injection.</p>
                  </div>
                )}
              </div>

              <div className="p-3 bg-[#1c1b1c] border-t border-[#4a4457]/50">
                <button
                  onClick={handleLiveSynthesis}
                  disabled={isAnalyzing || !data}
                  className="w-full py-2 bg-[#d1bcff] hover:bg-[#d1bcff] disabled:opacity-50 disabled:bg-zinc-800 text-black text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      <span>Synthesizing...</span>
                    </>
                  ) : (
                    <>
                      <Zap size={12} fill="currentColor" />
                      <span>Synthesize Live Data</span>
                    </>
                  )}
                </button>
              </div>
            </div>

          </div>

          {/* Collapsible Data Export Panel */}
          <div className="mt-auto shrink-0 flex flex-col">
            <button
              onClick={() => setIsExportOpen(!isExportOpen)}
              className="h-8 w-full flex items-center justify-center bg-[#1c1b1c] border-t border-[#4a4457]/50 text-[10px] font-black uppercase tracking-[0.2em] text-[#958da3] hover:text-[#e5e2e3] transition-colors"
            >
              {isExportOpen ? '[-] SYSTEM DATA EXPORT' : '[+] SYSTEM DATA EXPORT'}
            </button>
            
            {isExportOpen && (
              <div className="bg-[#1c1b1c] p-3 border-t border-[#4a4457]/50 space-y-3 animate-in slide-in-from-bottom-2 duration-200">
                <div className="grid grid-cols-2 gap-2">
                  {(['5m', '15m', '1h', '4h'] as const).map((tf) => (
                    <div key={tf} className="flex flex-col bg-[#0e0e0f]/40 border border-[#4a4457]/50 p-1.5">
                      <label className="text-[8px] text-[#958da3] uppercase font-black text-center mb-1">{tf} Lim</label>
                      <input
                        type="number"
                        min="0"
                        value={counts[tf]}
                        onChange={(e) => onCountChange(tf, e.target.value)}
                        className="w-full bg-transparent text-[#d1bcff] text-[10px] font-mono font-bold text-center outline-none border-b border-[#4a4457]/50 focus:border-[#d1bcff]/50 transition-colors"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleCopyJson}
                    disabled={!data}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 border transition-all ${
                      copyState === 'copied' 
                      ? 'bg-[#50ffaf]/10 border-[#50ffaf]/50 text-[#50ffaf]' 
                      : 'bg-[#0e0e0f] border-[#4a4457]/50 text-[#958da3] hover:text-[#d1bcff] hover:border-[#d1bcff]/30'
                    }`}
                    title="Copy Context to Clipboard"
                  >
                    <Copy size={12} />
                    <span className="text-[9px] font-black uppercase tracking-widest">
                      {copyState === 'copied' ? 'COPIED' : 'COPY'}
                    </span>
                  </button>
                  <button
                    onClick={() => onDownloadV7Sliced(counts)}
                    disabled={!data}
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-[#0e0e0f] border border-[#4a4457]/50 text-[#958da3] hover:text-[#d1bcff] hover:border-[#d1bcff]/30 transition-all"
                    title="Download Sliced V8.0 JSON"
                  >
                    <Download size={12} />
                    <span className="text-[9px] font-black uppercase tracking-widest">DL V8.0</span>
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </aside>
    </>
  );
}
