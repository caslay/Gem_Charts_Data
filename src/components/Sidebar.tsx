'use client';

import { useState, memo } from 'react';
import { SYSTEM_VERSION } from '@/lib/version';
import { safeParseAiJson } from '@/lib/aiJsonParser';
import {
  DownloadCloud,
  TrendingUp,
  Activity,
  X,
  Brain,
  Zap,
  Magnet,
  BarChart3,
  Terminal,
  Loader2,
  Copy,
  Download,
  Search,
  Database,
  Clock,
  ChevronDown,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import HudModal from './modals/HudModal';
import PotentialTradesModal from './modals/PotentialTradesModal';
import SelfCorrectionModal from './modals/SelfCorrectionModal';
import type { MarketDataPayload } from '@/hooks/useMarketData';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import { calculateATR } from '@/lib/riskEngine';

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
  'Act as the Institutional Flow Synthesizer V12.0. Analyze the following quantitative data and provide a mechanical bias report: \n\n';

// ─── Resting Magnets Card ───────────────────────────────────────────────────
const RestingMagnetsCard = memo(function RestingMagnetsCard({ orderFlow }: { orderFlow: any }) {
  const [isOpen, setIsOpen] = useState(true);
  const { livePrice } = useMarketDataLiveContext();

  return (
    <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between cursor-pointer select-none group-hover:text-accent transition-colors"
      >
        <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] lg:text-xs tracking-widest group-hover:text-accent">
          <Activity size={12} className="text-accent" />
          <span>Resting Magnets</span>
        </div>
        <button type="button" className="text-muted hover:text-foreground transition-colors p-0.5">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>
      {isOpen && (
        <div className="space-y-3.5 animate-[fade-in_0.15s_ease-out]">
          <div className="space-y-1.5">
            <span className="text-[10px] font-black text-emerald-500 dark:text-emerald-400 uppercase tracking-wider">BSL Targets</span>
            <div className="flex flex-col gap-1">
              {orderFlow?.resting_liquidity_pools?.BSL_Magnets?.length ? orderFlow.resting_liquidity_pools.BSL_Magnets.map((p: number, idx: number) => {
                const isPurged = livePrice !== null && livePrice >= p;
                return (
                  <div key={idx} className="flex justify-between items-center text-[13px] font-mono">
                    <span className={`${isPurged ? 'text-emerald-500 line-through opacity-60' : 'text-foreground font-bold'}`}>
                      {p.toFixed(2)}
                    </span>
                    {isPurged && <span className="text-[8px] text-emerald-500 font-black tracking-wider bg-emerald-500/10 px-1 py-0.5 rounded-sm border border-emerald-500/20">PURGED 🧹</span>}
                  </div>
                );
              }) : <span className="text-[13px] font-mono text-muted">N/A</span>}
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-[10px] font-black text-rose-500 dark:text-rose-400 uppercase tracking-wider">SSL Targets</span>
            <div className="flex flex-col gap-1">
              {orderFlow?.resting_liquidity_pools?.SSL_Magnets?.length ? orderFlow.resting_liquidity_pools.SSL_Magnets.map((p: number, idx: number) => {
                const isPurged = livePrice !== null && livePrice <= p;
                return (
                  <div key={idx} className="flex justify-between items-center text-[13px] font-mono">
                    <span className={`${isPurged ? 'text-rose-500 line-through opacity-60' : 'text-foreground font-bold'}`}>
                      {p.toFixed(2)}
                    </span>
                    {isPurged && <span className="text-[8px] text-rose-500 font-black tracking-wider bg-rose-500/10 px-1 py-0.5 rounded-sm border border-rose-500/20">PURGED 🧹</span>}
                  </div>
                );
              }) : <span className="text-[13px] font-mono text-muted">N/A</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

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
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

const Sidebar = memo(function Sidebar({
  data,
  counts,
  onCountChange,
  onDownloadV6,
  onDownloadV7Sliced,
  isLoading,
  isOpen,
  onClose,
  isCollapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const {
    isAnalyzing,
    aiAnalysis,
    triggerAiAnalysisScan,
    wsInterval,
    structureState,
    themeSettings,
    isAuto30mScanActive,
    toggleAuto30mScan,
    next30mScanSeconds
  } = useMarketDataContext();
  const [isJsonDrawerOpen, setIsJsonDrawerOpen] = useState(false);
  const [isHudModalOpen, setIsHudModalOpen] = useState(false);
  const [isTradesModalOpen, setIsTradesModalOpen] = useState(false);
  const [isSelfCorrectionModalOpen, setIsSelfCorrectionModalOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  // Inner cards collapsible states (all open by default)
  const [cardOpenState, setCardOpenState] = useState({
    time: true,
    structure: true,
    liquidity: true,
    orderFlow: true,
    synthesis: true,
  });

  const toggleCard = (card: keyof typeof cardOpenState) => {
    setCardOpenState((prev) => ({ ...prev, [card]: !prev[card] }));
  };

  const metrics = data?.ipda_metrics;
  const targetStatus = metrics?.target_status || '';

  let parsedAiResponse: any = null;
  let hudData: any = null;
  let aiNote: { title: string, text: string } | null = null;
  let tvAlerts: any[] = [];

  if (aiAnalysis) {
    try {
      parsedAiResponse = safeParseAiJson(aiAnalysis);

      // Support BOTH old hud_display format and new V8.2 diagnostics/execution format
      if (parsedAiResponse?.hud_display) {
        hudData = { ...parsedAiResponse.hud_display };
        const noteKey = Object.keys(hudData).find(k => k.toLowerCase().includes('note'));
        if (noteKey) {
          aiNote = { title: noteKey, text: hudData[noteKey] as string };
          delete hudData[noteKey]; // Remove note from table
        }
      } else if (parsedAiResponse?.diagnostics || parsedAiResponse?.execution) {
        hudData = {
          ...(parsedAiResponse.diagnostics || {}),
          ...(parsedAiResponse.execution || {})
        };
        if (parsedAiResponse.narrative) {
          aiNote = { title: '💡 AI Quant Note', text: parsedAiResponse.narrative };
        }
      } else if (parsedAiResponse && (parsedAiResponse.bias_signal !== undefined || parsedAiResponse.bias_label !== undefined)) {
        const sopRp = parsedAiResponse.sop_report?.risk_parameters;
        const nextSt = parsedAiResponse.next_database_state;

        const fmtP = (val?: number) => (val !== undefined && val !== null && !isNaN(Number(val))) ? `$${Number(val).toFixed(2)}` : 'N/A';
        const fmtR = (arr?: [number, number]) => (Array.isArray(arr) && arr.length >= 2) ? `$${Number(arr[0]).toFixed(2)} – $${Number(arr[1]).toFixed(2)}` : 'N/A';

        hudData = {
          BIAS_SIGNAL: parsedAiResponse.bias_signal ?? (parsedAiResponse.bias_label === 'BULLISH' ? 1 : parsedAiResponse.bias_label === 'BEARISH' ? -1 : 0),
          BIAS_LABEL: parsedAiResponse.bias_label ?? 'NEUTRAL',
          EXECUTION_ZONE: fmtR(sopRp?.entry_range),
          INVALIDATION_LEVEL: fmtP(sopRp?.invalidation ?? nextSt?.invalidation_level),
          TP1: fmtP(sopRp?.tp1),
          TP2: fmtP(sopRp?.tp2 ?? nextSt?.target_level),
          PRIMARY_TARGET: fmtP(parsedAiResponse.primary_target ?? sopRp?.tp2 ?? nextSt?.target_level)
        };
        const narrativeText = parsedAiResponse.narrative_summary || parsedAiResponse.narrative || parsedAiResponse.sop_report?.trade_narrative || '';
        if (narrativeText) {
          aiNote = { title: '💡 AI Quant Bias Narrative', text: narrativeText };
        }
      }

      if (Array.isArray(parsedAiResponse?.tradingview_alerts)) {
        tvAlerts = parsedAiResponse.tradingview_alerts;
      }
    } catch (e) {
      // Failed to parse, it will be treated as raw
      console.error('[HUD] Failed to parse AI Analysis JSON:', e);
    }
  }

  const orderFlow = metrics?.order_flow_engine;
  const pricing = metrics?.current_pricing;

  const handleLiveSynthesis = () => {
    triggerAiAnalysisScan();
  };

  const formatPrice = (price: any) => {
    if (price === 'AWAITING_IDM_SWEEP') return 'AWAITING_IDM_SWEEP';
    if (typeof price === 'string') return price;
    if (price && typeof price === 'object') {
      if (typeof price.price === 'number') return price.price.toFixed(2);
    }
    return price != null && typeof price === 'number' && !isNaN(price) ? price.toFixed(2) : '---';
  };

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

  // Sweeps verification logic
  const isAsianHighSwept = targetStatus.includes("ASIAN_HIGH_SWEPT");
  const isAsianLowSwept = targetStatus.includes("ASIAN_LOW_SWEPT");
  const isLondonHighSwept = targetStatus.includes("LONDON_HIGH_SWEPT");
  const isLondonLowSwept = targetStatus.includes("LONDON_LOW_SWEPT");

  const asianHigh = metrics?.macro_levels?.asian_high;
  const asianLow = metrics?.macro_levels?.asian_low;

  return (
    <>
      {/* Mobile overlay backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-background/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Vertically Centered Desktop Sidebar Toggle Tab Handle */}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`
            hidden lg:flex fixed top-1/2 -translate-y-1/2 z-30
            bg-card/90 backdrop-blur-md border border-card-border hover:border-accent text-muted hover:text-accent
            w-5 h-14 rounded-l-xl shadow-[0_0_20px_rgba(0,0,0,0.5)] transition-all duration-300 cursor-pointer
            items-center justify-center group select-none
            ${isCollapsed ? 'right-0 border-r-0 shadow-[0_0_15px_rgba(168,85,247,0.25)]' : 'right-80 border-r-0'}
          `}
          title={isCollapsed ? 'Expand Sidebar (Live HUD)' : 'Collapse Sidebar (Full Width Chart)'}
        >
          {isCollapsed ? (
            <ChevronLeft size={14} className="group-hover:-translate-x-0.5 transition-transform text-accent animate-pulse" />
          ) : (
            <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
          )}
        </button>
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          fixed top-0 right-0 z-20 h-full w-80 max-w-[90vw]
          bg-card/90 border-l border-card-border flex flex-col lg:relative shadow-2xl backdrop-blur-md
          transition-all duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
          lg:static lg:translate-x-0 lg:flex lg:shrink-0
          ${isCollapsed ? 'lg:w-0 lg:border-l-0 lg:overflow-hidden lg:pointer-events-none' : 'lg:w-80 lg:opacity-100'}
        `}
      >
        <div className="flex flex-col h-full overflow-hidden relative">

          {/* Header */}
          <div className="p-4 border-b border-card-border flex items-center justify-between shrink-0 bg-card/45">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-accent" />
              <h2 className="text-xs font-black uppercase tracking-[0.2em] text-foreground">Flow Execution</h2>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Desktop Sidebar Collapse Arrow Button */}
              {onToggleCollapse && (
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  className="hidden lg:flex p-1.5 rounded-full text-muted hover:text-foreground hover:bg-card border border-card-border hover:border-accent transition-all cursor-pointer items-center justify-center shrink-0"
                  title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar (Full Width Chart)'}
                >
                  <ChevronRight size={14} />
                </button>
              )}

              {/* Database Drawer Trigger Icon */}
              <button
                onClick={() => setIsJsonDrawerOpen(!isJsonDrawerOpen)}
                className={`p-1.5 rounded-full transition-colors flex items-center justify-center shrink-0 cursor-pointer ${isJsonDrawerOpen ? 'bg-accent/15 text-accent border border-accent/35' : 'text-muted hover:text-foreground hover:bg-card border border-transparent'
                  }`}
                title="Toggle JSON Data Drawer"
              >
                <Database size={14} />
              </button>

              <button onClick={onClose} className="lg:hidden p-1.5 text-muted hover:text-foreground rounded-full hover:bg-card">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Scrollable Cards Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-card-border scrollbar-track-transparent">

            {/* Time Card: Killzone Context */}
            <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
              <div
                onClick={() => toggleCard('time')}
                className="flex items-center justify-between cursor-pointer select-none group-hover:text-accent transition-colors"
              >
                <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] lg:text-xs tracking-widest group-hover:text-accent">
                  <Clock size={12} className="text-accent animate-pulse" />
                  <span>Time Killzones</span>
                </div>
                <button type="button" className="text-muted hover:text-foreground transition-colors p-0.5">
                  {cardOpenState.time ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </div>

              {cardOpenState.time && (
                <div className="space-y-2 animate-[fade-in_0.15s_ease-out]">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] lg:text-xs text-muted uppercase font-bold">Active Window</span>
                    <span className="text-sm font-black text-accent uppercase">{metrics?.current_time_window || 'WAITING'}</span>
                  </div>

                  {/* Killzone Timings Reference */}
                  <div className="bg-background/40 border border-card-border p-2 mt-2 space-y-1.5 rounded-lg select-none">
                    <div className="flex justify-between items-center text-[10px] lg:text-[11px]">
                      <span className="text-muted font-bold uppercase tracking-wider">ASIAN RANGE</span>
                      <span className="text-foreground font-mono font-bold">00:00 - 07:00 UTC</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] lg:text-[11px]">
                      <span className="text-muted font-bold uppercase tracking-wider">LONDON OPEN</span>
                      <span className="text-foreground font-mono font-bold">07:00 - 10:00 UTC</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] lg:text-[11px]">
                      <span className="text-muted font-bold uppercase tracking-wider">NY OPEN</span>
                      <span className="text-foreground font-mono font-bold">12:00 - 15:00 UTC</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Market Structure Card (Nested Hierarchy View) */}
            <div className="glass-panel p-4 space-y-3.5 relative overflow-hidden group">
              {/* Header with Title and Alignment Status */}
              <div
                onClick={() => toggleCard('structure')}
                className="flex items-center justify-between cursor-pointer select-none group-hover:text-accent transition-colors"
              >
                <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] lg:text-xs tracking-widest group-hover:text-accent">
                  <TrendingUp size={12} className="text-accent" />
                  <span>Market Structure ({wsInterval || '---'})</span>
                </div>
                <div className="flex items-center gap-2">
                  {(() => {
                    const majorTrend = structureState?.currentTrend || data?.ipda_metrics?.current_trend || 'UNSET';
                    const internalTrend = structureState?.internalTrend || data?.ipda_metrics?.internal_context?.trend || 'UNSET';
                    if (majorTrend === 'UNSET' || internalTrend === 'UNSET') return null;
                    const isAligned = majorTrend === internalTrend;
                    return (
                      <span
                        className={`px-1.5 py-0.5 text-[8px] font-black rounded border tracking-widest uppercase transition-all duration-300 ${isAligned
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.08)]'
                          : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.08)]'
                          }`}
                        title={isAligned ? 'Major and Internal trends are synchronized' : 'Retracement in progress (Intraday trend is running counter to Macro)'}
                      >
                        {isAligned ? '🟢 ALIGNED' : '⚪ DIVERGENT'}
                      </span>
                    );
                  })()}
                  <button type="button" className="text-muted hover:text-foreground transition-colors p-0.5">
                    {cardOpenState.structure ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </div>
              </div>

              {cardOpenState.structure && (
                <div className="space-y-3 animate-[fade-in_0.15s_ease-out]">
                  {/* ──────── TOP SECTION: MACRO DEPTH ──────── */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-muted-foreground/80">
                      <span>Macro Depth</span>
                      <span className="text-[9px] font-mono text-muted">(Limit {data?.candles_limit ?? 1000})</span>
                    </div>

                    {(() => {
                      const range = structureState?.dealingRange || data?.ipda_metrics?.full_structure_map?.dealingRange;
                      const isAwaiting = !range || range.low === null || range.current_status === 'AWAITING_IDM_SWEEP';
                      const pricingStatus = isAwaiting ? 'AWAITING_IDM_SWEEP' : (range?.current_status || 'UNKNOWN');
                      const pricingColorClass = isAwaiting
                        ? 'text-amber-500 bg-amber-500/10 border-amber-500/20 shadow-[0_0_6px_rgba(245,158,11,0.05)]'
                        : pricingStatus === 'DISCOUNT'
                          ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_6px_rgba(16,185,129,0.05)]'
                          : pricingStatus === 'PREMIUM'
                            ? 'text-amber-500 bg-amber-500/10 border-amber-500/20 shadow-[0_0_6px_rgba(245,158,11,0.05)]'
                            : 'text-muted bg-card-border/20 border-transparent';

                      return (
                        <div className={`p-2.5 border rounded-lg space-y-2 transition-colors duration-300 ${
                          isAwaiting
                            ? 'bg-amber-500/5 border-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.03)]'
                            : 'bg-background/40 border-card-border'
                        }`}>
                          <div className="flex justify-between items-center">
                            <span className={`text-[10px] uppercase font-bold ${isAwaiting ? 'text-amber-500/70' : 'text-muted'}`}>Macro Trend</span>
                            {(() => {
                              const trend = structureState?.currentTrend || data?.ipda_metrics?.current_trend || 'UNSET';
                              if (isAwaiting) return <span className="text-[11px] font-black text-amber-500 uppercase animate-pulse">AWAITING SWEEP</span>;
                              if (trend === 'BULLISH') return <span className="text-[11px] font-black text-emerald-500 uppercase">🟢 BULLISH</span>;
                              if (trend === 'BEARISH') return <span className="text-[11px] font-black text-rose-500 uppercase">🔴 BEARISH</span>;
                              return <span className="text-[11px] font-black text-muted uppercase">⚪ UNSET</span>;
                            })()}
                          </div>

                          {range && (
                            <div className={`space-y-1.5 border-t pt-1.5 ${isAwaiting ? 'border-amber-500/10' : 'border-card-border/30'}`}>
                              <div className="flex justify-between items-center text-[10px]">
                                <span className={`font-bold uppercase tracking-wider ${isAwaiting ? 'text-amber-500/60' : 'text-muted'}`}>Dealing Range</span>
                                <span className={`font-mono font-bold ${isAwaiting ? 'text-[#fbbf24] text-[10px]' : 'text-foreground/90'}`}>
                                  {isAwaiting ? 'AWAITING_IDM_SWEEP' : `${formatPrice(range.low)} - ${formatPrice(range.high)}`}
                                </span>
                              </div>

                              <div className="flex justify-between items-center text-[10px]">
                                <span className={`font-bold uppercase tracking-wider ${isAwaiting ? 'text-amber-500/60' : 'text-muted'}`}>Equilibrium</span>
                                <span className={`font-mono font-bold ${isAwaiting ? 'text-amber-500/80 text-[10px]' : 'text-accent'}`}>
                                  {isAwaiting ? 'AWAITING sweep confirmation' : formatPrice(range.equilibrium)}
                                </span>
                              </div>

                              <div className="flex justify-between items-center text-[10px]">
                                <span className={`font-bold uppercase tracking-wider ${isAwaiting ? 'text-amber-500/60' : 'text-muted'}`}>Pricing Context</span>
                                <span className={`px-1.5 py-0.5 text-[8px] font-black rounded border tracking-widest uppercase ${pricingColorClass}`}>
                                  {pricingStatus}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* ──────── BOTTOM SECTION: INTRADAY DEPTH ──────── */}
                  <div className="space-y-2 border-t border-card-border/30 pt-3">
                    <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-muted-foreground/80">
                      <span>Intraday Depth</span>
                      <span className="text-[9px] font-mono text-muted">(Dynamic Swings)</span>
                    </div>

                    {(() => {
                      const internalRange = structureState?.internalDealingRange || data?.ipda_metrics?.internal_context || data?.ipda_metrics?.full_structure_map?.internalDealingRange;
                      if (!internalRange || (internalRange.high === null && internalRange.low === null)) {
                        return (
                          <div className="bg-background/40 p-2.5 border border-card-border rounded-lg text-[10px] text-muted italic text-center py-4">
                            No confirmed internal swings yet
                          </div>
                        );
                      }

                      const isAwaiting = internalRange.low === null || internalRange.high === null || internalRange.current_status === 'AWAITING_IDM_SWEEP' || internalRange.pricing_status === 'AWAITING_IDM_SWEEP';
                      const pricingStatus = isAwaiting ? 'AWAITING_IDM_SWEEP' : (internalRange.current_status || internalRange.pricing_status || 'UNKNOWN');
                      const pricingColorClass = isAwaiting
                        ? 'text-amber-500 bg-amber-500/10 border-amber-500/20 shadow-[0_0_6px_rgba(245,158,11,0.05)]'
                        : pricingStatus === 'DISCOUNT'
                          ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_6px_rgba(16,185,129,0.05)]'
                          : pricingStatus === 'PREMIUM'
                            ? 'text-amber-500 bg-amber-500/10 border-amber-500/20 shadow-[0_0_6px_rgba(245,158,11,0.05)]'
                            : 'text-muted bg-card-border/20 border-transparent';

                      return (
                        <div className={`p-2.5 border rounded-lg space-y-2 transition-colors duration-300 ${
                          isAwaiting
                            ? 'bg-amber-500/5 border-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.03)]'
                            : 'bg-background/40 border-card-border'
                        }`}>
                          <div className="flex justify-between items-center">
                            <span className={`text-[10px] uppercase font-bold ${isAwaiting ? 'text-amber-500/70' : 'text-muted'}`}>Internal Trend</span>
                            {(() => {
                              const trend = structureState?.internalTrend || data?.ipda_metrics?.internal_context?.trend || 'UNSET';
                              if (isAwaiting) return <span className="text-[11px] font-black text-amber-500 uppercase animate-pulse">AWAITING SWEEP</span>;
                              if (trend === 'BULLISH') return <span className="text-[11px] font-black text-emerald-500 uppercase">🟢 BULLISH</span>;
                              if (trend === 'BEARISH') return <span className="text-[11px] font-black text-rose-500 uppercase">🔴 BEARISH</span>;
                              return <span className="text-[11px] font-black text-muted uppercase">⚪ UNSET</span>;
                            })()}
                          </div>

                          <div className={`space-y-1.5 border-t pt-1.5 ${isAwaiting ? 'border-amber-500/10' : 'border-card-border/30'}`}>
                            <div className="flex justify-between items-center text-[10px]">
                              <span className={`font-bold uppercase tracking-wider ${isAwaiting ? 'text-amber-500/60' : 'text-muted'}`}>Internal Range</span>
                              <span className={`font-mono font-bold ${isAwaiting ? 'text-[#fbbf24] text-[10px]' : 'text-foreground/90'}`}>
                                {isAwaiting ? 'AWAITING_IDM_SWEEP' : `${formatPrice(internalRange.low)} - ${formatPrice(internalRange.high)}`}
                              </span>
                            </div>

                            <div className="flex justify-between items-center text-[10px]">
                              <span className={`font-bold uppercase tracking-wider ${isAwaiting ? 'text-amber-500/60' : 'text-muted'}`}>Equilibrium</span>
                              <span className={`font-mono font-bold ${isAwaiting ? 'text-amber-500/80 text-[10px]' : 'text-accent'}`}>
                                {isAwaiting ? 'AWAITING sweep confirmation' : formatPrice(internalRange.equilibrium)}
                              </span>
                            </div>

                            <div className="flex justify-between items-center text-[10px]">
                              <span className={`font-bold uppercase tracking-wider ${isAwaiting ? 'text-amber-500/60' : 'text-muted'}`}>Pricing Context</span>
                              <span className={`px-1.5 py-0.5 text-[8px] font-black rounded border tracking-widest uppercase ${pricingColorClass}`}>
                                {pricingStatus}
                              </span>
                            </div>

                            <div className="flex justify-between items-center text-[10px]">
                              <span className={`font-bold uppercase tracking-wider ${isAwaiting ? 'text-amber-500/60' : 'text-muted'}`}>Volatility Gate</span>
                              {(() => {
                                const multiplier = parseFloat(themeSettings?.structure_istr_atr_multiplier || '1.5');
                                const activeCandles = data?.data_payload?.[`candles_${wsInterval}` as keyof typeof data.data_payload] || [];
                                const atr = activeCandles.length > 0 ? calculateATR(activeCandles) : 0;
                                const rangeHeight = internalRange.high && internalRange.low && !isAwaiting ? (internalRange.high - internalRange.low) : 0;
                                const isSuppressed = rangeHeight > 0 && atr > 0 && rangeHeight < atr * multiplier;
                                if (isAwaiting) {
                                  return (
                                    <span className="text-[9px] font-black text-amber-500/70 bg-amber-500/5 border border-amber-500/10 px-1.5 py-0.5 rounded tracking-wider uppercase">
                                      PENDING
                                    </span>
                                  );
                                }
                                if (isSuppressed) {
                                  return (
                                    <span className="text-[9px] font-black text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded tracking-wider uppercase shadow-[0_0_6px_rgba(245,158,11,0.05)]">
                                      ⚠️ NOISE_SUPPRESSED
                                    </span>
                                  );
                                }
                                return (
                                  <span className="text-[9px] font-black text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded tracking-wider uppercase shadow-[0_0_6px_rgba(16,185,129,0.05)]">
                                    🟢 AUTHORIZED
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>

            {/* Liquidity Card: Macro Ranges */}
            <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
              <div
                onClick={() => toggleCard('liquidity')}
                className="flex items-center justify-between cursor-pointer select-none group-hover:text-accent transition-colors"
              >
                <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] lg:text-xs tracking-widest group-hover:text-accent">
                  <Magnet size={12} className="text-accent" />
                  <span>Liquidity Pool context</span>
                </div>
                <button type="button" className="text-muted hover:text-foreground transition-colors p-0.5">
                  {cardOpenState.liquidity ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </div>

              {cardOpenState.liquidity && (
                <div className="space-y-2.5 animate-[fade-in_0.15s_ease-out]">
                  {/* PDH / PDL */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-background/40 p-2.5 border border-card-border rounded-lg relative">
                      <span className="text-[10px] text-muted block mb-0.5 uppercase font-bold tracking-wider">Prev Day High (PDH)</span>
                      <span className="text-sm font-mono font-bold text-foreground">{formatPrice(metrics?.macro_levels?.pdh)}</span>
                    </div>
                    <div className="bg-background/40 p-2.5 border border-card-border rounded-lg relative">
                      <span className="text-[10px] text-muted block mb-0.5 uppercase font-bold tracking-wider">Prev Day Low (PDL)</span>
                      <span className="text-sm font-mono font-bold text-foreground">{formatPrice(metrics?.macro_levels?.pdl)}</span>
                    </div>
                  </div>

                  {/* Asian Range High / Low Sweeps */}
                  {asianHigh && (
                    <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-1.5">
                      <div className="flex justify-between items-center text-[10px] lg:text-[11px]">
                        <span className="text-muted uppercase font-bold tracking-wider">Asian High</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`font-mono text-xs lg:text-sm font-bold ${isAsianHighSwept ? 'text-rose-500 line-through opacity-60' : 'text-foreground'}`}>
                            {formatPrice(asianHigh)}
                          </span>
                          {isAsianHighSwept && (
                            <span className="px-1 py-0.5 bg-rose-500/10 text-rose-500 text-[8px] font-black rounded-sm border border-rose-500/20">
                              SWEPT 🧹
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-center text-[10px] lg:text-[11px]">
                        <span className="text-muted uppercase font-bold tracking-wider">Asian Low</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`font-mono text-xs lg:text-sm font-bold ${isAsianLowSwept ? 'text-emerald-500 line-through opacity-60' : 'text-foreground'}`}>
                            {formatPrice(asianLow)}
                          </span>
                          {isAsianLowSwept && (
                            <span className="px-1 py-0.5 bg-emerald-500/10 text-emerald-500 text-[8px] font-black rounded-sm border border-emerald-500/20">
                              SWEPT 🧹
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Card 3: Order Flow Pulse */}
            <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
              <div
                onClick={() => toggleCard('orderFlow')}
                className="flex items-center justify-between cursor-pointer select-none group-hover:text-accent transition-colors"
              >
                <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] lg:text-xs tracking-widest group-hover:text-accent">
                  <BarChart3 size={12} className="text-accent" />
                  <span>Order Flow Pulse</span>
                </div>
                <button type="button" className="text-muted hover:text-foreground transition-colors p-0.5">
                  {cardOpenState.orderFlow ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </div>

              {cardOpenState.orderFlow && (
                <div className="space-y-3 animate-[fade-in_0.15s_ease-out]">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] lg:text-xs text-muted font-bold">OI Trend</span>
                    <span className={`text-[11px] lg:text-xs font-black uppercase tracking-wider ${orderFlow?.open_interest_trend === 'BULLISH' ? 'text-emerald-500' :
                      orderFlow?.open_interest_trend === 'BEARISH' ? 'text-rose-500' : 'text-muted'
                      }`}>
                      {orderFlow?.open_interest_trend || 'NEUTRAL'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] lg:text-xs text-muted font-bold">Displacement</span>
                    <span className={`text-[11px] lg:text-xs font-black uppercase tracking-wider ${metrics?.institutional_sponsorship?.status?.includes('BULLISH') ? 'text-emerald-500' :
                      metrics?.institutional_sponsorship?.status?.includes('BEARISH') ? 'text-rose-500' :
                        metrics?.institutional_sponsorship?.status === 'CONSOLIDATION' ? 'text-accent' : 'text-muted'
                      }`}>
                      {metrics?.institutional_sponsorship?.status || 'INACTIVE'}
                    </span>
                  </div>
                  {metrics?.institutional_sponsorship?.statistical_validation && (
                    <div className="bg-background/40 p-2 border border-card-border rounded-lg space-y-1">
                      <div className="flex justify-between text-[10px] items-center">
                        <span className="text-muted">t-STAT</span>
                        <span className="font-mono font-bold text-foreground">
                          {metrics.institutional_sponsorship.statistical_validation.t_statistic?.toFixed(4) ?? '0.0000'}
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] items-center">
                        <span className="text-muted">p-VALUE</span>
                        <span className="font-mono font-bold text-foreground">
                          {metrics.institutional_sponsorship.statistical_validation.p_value?.toFixed(4) ?? '0.0000'}
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] items-center">
                        <span className="text-muted">OLS VALIDATION</span>
                        <span className={`font-black uppercase text-[9px] tracking-wider ${metrics.institutional_sponsorship.statistical_validation.confidence_interval_95 === true ? 'text-emerald-500' :
                          metrics.institutional_sponsorship.status === 'CONSOLIDATION' ? 'text-accent' : 'text-rose-500'
                          }`}>
                          {metrics.institutional_sponsorship.statistical_validation.confidence_interval_95 === true ? 'CONFIRMED' :
                            metrics.institutional_sponsorship.status === 'CONSOLIDATION' ? 'CONSOLIDATION' : 'REJECTED'}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="bg-background/40 p-2.5 border border-card-border rounded-lg">
                    <span className="text-[10px] text-muted block mb-1 uppercase tracking-wider font-bold">Smart Money Divergence</span>
                    <p className="text-[10px] text-muted italic leading-normal select-text">
                      {orderFlow?.smart_money_sentiment?.smart_money_divergence || 'No divergence detected in HTF/LTF pairing.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Card 4: Resting Magnets */}
            <RestingMagnetsCard orderFlow={orderFlow} />

            {/* Card 5: AI Synthesis Console */}
            <div className={`glass-panel flex flex-col transition-all duration-200 overflow-hidden ${cardOpenState.synthesis ? 'h-[380px]' : 'h-auto'}`}>
              <div
                onClick={() => toggleCard('synthesis')}
                className="p-3 border-b border-card-border bg-card/45 flex items-center justify-between shrink-0 cursor-pointer select-none hover:bg-card-hover/20 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Terminal size={12} className="text-accent" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Synthesis Console</span>
                </div>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setIsHudModalOpen(true)}
                    className="text-muted hover:text-foreground transition-colors p-1 rounded-full hover:bg-card cursor-pointer"
                    title="Expand Synthesis HUD Console"
                  >
                    <Search size={12} />
                  </button>
                  {isAnalyzing && <Loader2 size={12} className="text-accent animate-spin" />}
                  <button
                    type="button"
                    onClick={() => toggleCard('synthesis')}
                    className="text-muted hover:text-foreground transition-colors p-0.5 cursor-pointer"
                  >
                    {cardOpenState.synthesis ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </div>
              </div>

              {cardOpenState.synthesis && (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-[fade-in_0.15s_ease-out]">
                  <div className="flex-1 p-3 overflow-y-auto bg-background/25 font-mono scrollbar-thin scrollbar-thumb-card-border">
                    {aiAnalysis ? (
                      hudData ? (
                        <div className="space-y-4">
                          {/* HUD Table */}
                          <div className="border border-card-border rounded-lg overflow-hidden">
                            <table className="w-full text-left border-collapse">
                              <tbody>
                                {Object.entries(hudData).map(([key, value]) => {
                                  let colorClass = 'text-foreground font-semibold';
                                  const vStr = Array.isArray(value) ? value.join(', ') : String(value).toUpperCase();

                                  if (vStr.includes('BUY') || vStr.includes('LONG') || vStr.includes('BULLISH') || vStr.includes('STRONG') || vStr.includes('FULL_RISK')) colorClass = 'text-emerald-600 dark:text-emerald-400 font-bold';
                                  else if (vStr.includes('SELL') || vStr.includes('SHORT') || vStr.includes('BEARISH') || vStr.includes('WEAK') || vStr.includes('ABORT')) colorClass = 'text-rose-600 dark:text-rose-400 font-bold';
                                  else if (vStr.includes('STAND DOWN') || vStr.includes('NEUTRAL') || vStr.includes('NONE') || vStr.includes('WAIT')) colorClass = 'text-muted font-semibold';

                                  const displayKey = key.replace(/_/g, ' ').toUpperCase();
                                  return (
                                    <tr key={key} className="border-b border-card-border last:border-0 bg-background/25">
                                      <td className="p-2 text-[10.5px] font-black uppercase tracking-wider text-muted border-r border-card-border w-1/3">
                                        {displayKey}
                                      </td>
                                      <td className={`p-2 text-xs font-mono font-medium ${colorClass}`}>
                                        {Array.isArray(value) ? value.join(', ') : String(value)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* AI Note */}
                          {aiNote && (
                            <div className="bg-card p-3.5 border border-card-border rounded-lg shadow-sm">
                              <span className="text-[10px] font-black text-accent uppercase tracking-widest block mb-1">
                                {aiNote.title}
                              </span>
                              <p className="text-[11.5px] text-foreground italic leading-relaxed font-sans select-text">
                                {aiNote.text}
                              </p>
                            </div>
                          )}

                          {/* TradingView Alerts */}
                          {tvAlerts.length > 0 && (
                            <div className="space-y-1.5">
                              <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest block">
                                TradingView Alerts
                              </span>
                              <div className="flex flex-col gap-1.5">
                                {tvAlerts.map((alert: unknown, i: number) => {
                                  const displayAlert = typeof alert === 'object' && alert !== null && 'price' in alert && 'reason' in alert
                                    ? `${(alert as Record<string, unknown>).price} - ${(alert as Record<string, unknown>).reason}`
                                    : typeof alert === 'string'
                                      ? alert
                                      : JSON.stringify(alert);

                                  return (
                                    <div key={i} className="bg-card p-2 border border-card-border flex items-start gap-2 rounded-lg">
                                      <Zap size={10} className="text-accent mt-0.5 shrink-0" />
                                      <span className="text-[9px] text-foreground font-sans font-medium uppercase tracking-wide">
                                        {displayAlert}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <pre className="text-[10px] text-emerald-500 leading-relaxed whitespace-pre-wrap bg-card p-3 rounded-lg border border-card-border overflow-x-auto select-text">
                          <code>{aiAnalysis}</code>
                        </pre>
                      )
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center p-4">
                        <Brain size={24} className="text-card-border mb-2 animate-pulse" />
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">System Ready. Awaiting Live Payload Injection.</p>
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-card/45 border-t border-card-border shrink-0 flex flex-col gap-2">
                    {/* 30m Auto-Scan Toggle & Countdown */}
                    <div className="flex items-center justify-between px-2 py-1 bg-background/50 border border-card-border rounded-lg text-[10px] font-mono">
                      <div className="flex items-center gap-1.5">
                        <Clock size={11} className={isAuto30mScanActive ? "text-accent animate-pulse" : "text-muted"} />
                        <span className="text-muted font-bold">30m Auto-Scan:</span>
                        <span className="text-foreground font-extrabold">
                          {isAuto30mScanActive
                            ? `${Math.floor((next30mScanSeconds ?? 1800) / 60)}:${((next30mScanSeconds ?? 1800) % 60).toString().padStart(2, '0')}`
                            : 'OFF'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={toggleAuto30mScan}
                        className={`px-2 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wider border transition-colors ${
                          isAuto30mScanActive
                            ? 'bg-accent/20 border-accent text-accent'
                            : 'bg-card border-card-border text-muted hover:text-foreground'
                        }`}
                      >
                        {isAuto30mScanActive ? 'ENABLED' : 'PAUSED'}
                      </button>
                    </div>

                    <button
                      onClick={handleLiveSynthesis}
                      disabled={isAnalyzing || !data}
                      className="w-full py-2 bg-accent hover:bg-accent disabled:opacity-50 disabled:bg-card-border text-accent-foreground text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm rounded-full"
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

                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => setIsTradesModalOpen(true)}
                        className="py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer rounded-full"
                      >
                        <BarChart3 size={11} />
                        <span>Trades</span>
                      </button>
                      <button
                        onClick={() => setIsSelfCorrectionModalOpen(true)}
                        className="py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 text-[9px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer rounded-full"
                        title="Open Self-Correction & AI Learning Window"
                      >
                        <Brain size={11} />
                        <span>Self-Correction</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Collapsible Data Export Panel — RELOCATED TO DRAWER */}
          <div className="p-3 border-t border-card-border bg-card/45 shrink-0 select-none text-center">
            <span className="text-[8px] font-black text-muted-foreground tracking-widest uppercase">
              Flow-State Quant Dashboard V{SYSTEM_VERSION}
            </span>
          </div>

          {/* ── JSON LOGS SLIDE-OUT DRAWER ─────────────────────────────────── */}
          <div
            className={`
              absolute top-0 bottom-0 z-50 w-80 bg-card border-r border-card-border shadow-2xl flex flex-col
              transition-all duration-300 ease-in-out select-none
              ${isJsonDrawerOpen ? 'right-0 pointer-events-auto' : 'translate-x-full right-0 pointer-events-none opacity-0'}
            `}
          >
            {/* Drawer Header */}
            <div className="p-4 border-b border-card-border flex items-center justify-between shrink-0 bg-card/45">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-accent animate-pulse" />
                <h3 className="text-xs font-black uppercase tracking-[0.15em] text-foreground">JSON Data Stream</h3>
              </div>
              <button
                onClick={() => setIsJsonDrawerOpen(false)}
                className="p-1 text-muted hover:text-foreground rounded-full hover:bg-background/80 cursor-pointer"
                title="Close Data Drawer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* Lookback filters */}
              <div className="bg-background/40 rounded-xl p-4 border border-card-border backdrop-blur-md">
                <span className="text-[9px] font-black text-accent uppercase tracking-widest block mb-2">Lookback Configurations</span>
                <div className="grid grid-cols-2 gap-2">
                  {(['5m', '15m', '1h', '4h'] as const).map((tf) => (
                    <div key={tf} className="flex flex-col bg-background/50 border border-card-border p-2 rounded-lg">
                      <label className="text-[8px] text-muted-foreground uppercase font-black text-center mb-1">{tf} candles</label>
                      <input
                        type="number"
                        min="0"
                        value={counts[tf]}
                        onChange={(e) => onCountChange(tf, e.target.value)}
                        className="w-full bg-transparent text-accent text-center text-xs font-mono font-bold outline-none border-b border-card-border focus:border-accent transition-colors"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleCopyJson}
                  disabled={!data}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 border rounded-full transition-all duration-300 cursor-pointer ${copyState === 'copied'
                    ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-500'
                    : 'bg-background hover:bg-card border-card-border text-muted hover:text-foreground'
                    }`}
                  title="Copy Context to Clipboard"
                >
                  <Copy size={12} />
                  <span className="text-[9px] font-black uppercase tracking-wider">
                    {copyState === 'copied' ? 'COPIED' : 'COPY PAYLOAD'}
                  </span>
                </button>

                <button
                  onClick={() => onDownloadV7Sliced(counts)}
                  disabled={!data}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-background hover:bg-card border border-card-border text-muted hover:text-foreground rounded-full transition-all duration-300 cursor-pointer"
                  title="Download Sliced V12.0 JSON"
                >
                  <Download size={12} />
                  <span className="text-[9px] font-black uppercase tracking-wider">DL V12.0 JSON</span>
                </button>
              </div>

              {/* Raw JSON Pre-synthesis log */}
              <div className="flex flex-col bg-background/40 border border-card-border p-3 rounded-xl space-y-2">
                <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest block">Active Data Frame</span>
                <div className="bg-card p-3 rounded-lg border border-card-border h-[220px] overflow-y-auto font-mono text-[9px] text-muted-foreground select-text whitespace-pre-wrap">
                  {data ? JSON.stringify(slicePayloadByLookback(data, counts), null, 2) : 'No payload loaded.'}
                </div>
              </div>

            </div>
          </div>

        </div>
      </aside>

      <HudModal
        isOpen={isHudModalOpen}
        onClose={() => setIsHudModalOpen(false)}
        hudData={hudData}
        aiNote={aiNote}
        tvAlerts={tvAlerts}
        aiAnalysis={aiAnalysis}
        isAnalyzing={isAnalyzing}
        onSynthesize={handleLiveSynthesis}
        copyText={data ? AI_PROMPT_PREFIX + JSON.stringify(slicePayloadByLookback(data, counts), null, 2) : ''}
      />

      {/* Self-Correction Modal */}
      <SelfCorrectionModal
        isOpen={isSelfCorrectionModalOpen}
        onClose={() => setIsSelfCorrectionModalOpen(false)}
      />

      {/* Potential Trades Modal */}
      <PotentialTradesModal
        isOpen={isTradesModalOpen}
        onClose={() => setIsTradesModalOpen(false)}
      />
    </>
  );
});

export default Sidebar;
