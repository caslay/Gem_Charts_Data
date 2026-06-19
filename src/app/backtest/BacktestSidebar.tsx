'use client';

import { useState } from 'react';
import {
  Activity,
  X,
  Brain,
  Zap,
  Magnet,
  BarChart3,
  Terminal,
  Loader2,
  TrendingUp,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import type { MarketDataPayload } from '@/hooks/useMarketData';
import type { BacktestTimeframe } from '@/hooks/useBacktestEngine';
import { useMarketDataContext } from '@/context/MarketDataContext';
import { calculateATR } from '@/lib/riskEngine';

// ─── Props ───────────────────────────────────────────────────────────────────
interface BacktestSidebarProps {
  enrichedPayload: any | null;
  lastPrice: number | null;
  activeTimeframe: BacktestTimeframe;
  aiAnalysis: string | null;
  isAnalyzing: boolean;
  triggerAiAnalysisScan: (payload: MarketDataPayload) => Promise<void>;
  isOpen: boolean;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const formatPrice = (price: number | null | undefined) =>
  price != null ? price.toFixed(2) : '---';

function parseAiResponse(aiAnalysis: string | null) {
  if (!aiAnalysis) return { hudData: null, aiNote: null, tvAlerts: [] };

  let parsedAiResponse: any = null;
  let hudData: any = null;
  let aiNote: { title: string; text: string } | null = null;
  let tvAlerts: any[] = [];

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

    if (parsedAiResponse?.hud_display) {
      hudData = { ...parsedAiResponse.hud_display };
      const noteKey = Object.keys(hudData).find((k) => k.toLowerCase().includes('note'));
      if (noteKey) {
        aiNote = { title: noteKey, text: hudData[noteKey] as string };
        delete hudData[noteKey];
      }
    } else if (parsedAiResponse?.diagnostics || parsedAiResponse?.execution) {
      hudData = {
        ...(parsedAiResponse.diagnostics || {}),
        ...(parsedAiResponse.execution || {}),
      };
      if (parsedAiResponse.narrative) {
        aiNote = { title: '💡 AI Quant Note', text: parsedAiResponse.narrative };
      }
    } else if (parsedAiResponse?.bias_signal !== undefined || parsedAiResponse?.bias_label !== undefined) {
      hudData = {
        BIAS_SIGNAL: parsedAiResponse.bias_signal,
        BIAS_LABEL: parsedAiResponse.bias_label,
        PRIMARY_TARGET: parsedAiResponse.primary_target,
      };
      const narrativeText = parsedAiResponse.narrative_summary || parsedAiResponse.narrative || '';
      if (narrativeText) {
        aiNote = { title: '💡 AI Quant Bias Narrative', text: narrativeText };
      }
    }

    if (Array.isArray(parsedAiResponse?.tradingview_alerts)) {
      tvAlerts = parsedAiResponse.tradingview_alerts;
    }
  } catch (e) {
    console.error('[BacktestSidebar] Failed to parse AI Analysis JSON:', e);
  }

  return { hudData, aiNote, tvAlerts };
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function BacktestSidebar({
  enrichedPayload,
  lastPrice,
  activeTimeframe,
  aiAnalysis,
  isAnalyzing,
  triggerAiAnalysisScan,
  isOpen,
  onClose,
}: BacktestSidebarProps) {
  const [isHudExpanded, setIsHudExpanded] = useState(false);
  const { themeSettings } = useMarketDataContext();

  const metrics = enrichedPayload?.ipda_metrics;
  const orderFlow = metrics?.order_flow_engine;
  const targetStatus = metrics?.target_status || '';

  const isAsianHighSwept = targetStatus.includes('ASIAN_HIGH_SWEPT');
  const isAsianLowSwept = targetStatus.includes('ASIAN_LOW_SWEPT');
  const asianHigh = metrics?.macro_levels?.asian_high;
  const asianLow = metrics?.macro_levels?.asian_low;

  // Market structure from enriched payload
  const structureMap = metrics?.full_structure_map;
  const dealingRange = structureMap?.dealingRange;
  const currentTrend = metrics?.current_trend || 'UNSET';
  const mssConfirmed = metrics?.market_structure_shift || false;
  const latestMSS = structureMap?.zigzag?.find((z: any) => z.label === 'MSS') || null;
  const mssStatus = latestMSS
    ? latestMSS.displacementConfirmed
      ? 'CONFIRMED'
      : 'PENDING'
    : mssConfirmed
    ? 'CONFIRMED'
    : 'NONE';

  const pricingStatus = dealingRange?.current_status || 'UNKNOWN';
  const pricingColorClass =
    pricingStatus === 'DISCOUNT'
      ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
      : pricingStatus === 'PREMIUM'
      ? 'text-amber-500 bg-amber-500/10 border-amber-500/20'
      : 'text-muted bg-card-border/20 border-transparent';

  const { hudData, aiNote, tvAlerts } = parseAiResponse(aiAnalysis);

  return (
    <>
      {/* Mobile overlay backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-background/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Sidebar panel */}
      <aside
        className={`
          fixed top-0 right-0 z-40 h-full w-80 max-w-[90vw]
          bg-card/90 border-l border-card-border flex flex-col shadow-2xl backdrop-blur-md
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
          lg:static lg:translate-x-0 lg:flex lg:w-80 lg:shrink-0 lg:z-10
        `}
      >
        <div className="flex flex-col h-full overflow-hidden relative">

          {/* Header */}
          <div className="p-4 border-b border-card-border flex items-center justify-between shrink-0 bg-card/45">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-accent animate-pulse" />
              <h2 className="text-xs font-black uppercase tracking-[0.2em] text-foreground">
                Replay HUD
              </h2>
              <span className="px-1.5 py-0.5 rounded bg-accent/15 text-[8px] font-black text-accent border border-accent/20 uppercase tracking-wider">
                {activeTimeframe.toUpperCase()}
              </span>
            </div>
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 text-muted hover:text-foreground rounded-full hover:bg-card cursor-pointer"
              title="Close HUD sidebar"
            >
              <X size={16} />
            </button>
          </div>

          {/* Scrollable Cards */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-card-border scrollbar-track-transparent">

            {/* Card: Time Killzones */}
            <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
              <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] tracking-widest">
                <Clock size={12} className="text-accent animate-pulse" />
                <span>Time Killzones</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-muted uppercase font-bold">Active Window</span>
                  <span className="text-sm font-black text-accent uppercase">
                    {metrics?.current_time_window || 'REPLAY'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-muted uppercase font-bold">NY Day Open</span>
                  <span className="text-sm font-mono font-bold text-foreground">
                    {formatPrice(metrics?.true_day_open)}
                  </span>
                </div>
                <div className="bg-background/40 border border-card-border p-2 mt-2 space-y-1.5 rounded-lg select-none">
                  {[
                    { label: 'ASIAN RANGE', time: '00:00 - 07:00 UTC' },
                    { label: 'LONDON OPEN', time: '07:00 - 10:00 UTC' },
                    { label: 'NY OPEN', time: '12:00 - 15:00 UTC' },
                  ].map((kz) => (
                    <div key={kz.label} className="flex justify-between items-center text-[10px]">
                      <span className="text-muted font-bold uppercase tracking-wider">{kz.label}</span>
                      <span className="text-foreground font-mono font-bold">{kz.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Market Structure Card (Nested Hierarchy View) */}
            <div className="glass-panel p-4 space-y-3.5 relative overflow-hidden group">
              {/* Header with Title and Alignment Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] tracking-widest">
                  <TrendingUp size={12} className="text-accent" />
                  <span>Market Structure</span>
                </div>
                {(() => {
                  const majorTrend = metrics?.current_trend || 'UNSET';
                  const internalTrend = metrics?.internal_context?.trend || 'UNSET';
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
              </div>

              <div className="space-y-3">
                {/* ──────── TOP SECTION: MACRO DEPTH ──────── */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-muted-foreground/80">
                    <span>Macro Depth</span>
                    <span className="text-[9px] font-mono text-muted">(Locked 1000)</span>
                  </div>

                  <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-muted uppercase font-bold">Macro Trend</span>
                      {(() => {
                        const trend = metrics?.current_trend || 'UNSET';
                        if (trend === 'BULLISH') return <span className="text-[11px] font-black text-emerald-500 uppercase">🟢 BULLISH</span>;
                        if (trend === 'BEARISH') return <span className="text-[11px] font-black text-rose-500 uppercase">🔴 BEARISH</span>;
                        return <span className="text-[11px] font-black text-muted uppercase">⚪ UNSET</span>;
                      })()}
                    </div>

                    {(() => {
                      const range = dealingRange;
                      if (!range) return null;
                      const isAwaiting = range.low === null || range.high === null || range.current_status === 'AWAITING_IDM_SWEEP';
                      const pricingStatus = isAwaiting ? 'AWAITING_IDM_SWEEP' : (range.current_status || 'UNKNOWN');
                      const pricingColorClass = isAwaiting
                        ? 'text-amber-500 bg-amber-500/10 border-amber-500/20 shadow-[0_0_6px_rgba(245,158,11,0.05)]'
                        : pricingStatus === 'DISCOUNT'
                          ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_6px_rgba(16,185,129,0.05)]'
                          : pricingStatus === 'PREMIUM'
                            ? 'text-amber-500 bg-amber-500/10 border-amber-500/20 shadow-[0_0_6px_rgba(245,158,11,0.05)]'
                            : 'text-muted bg-card-border/20 border-transparent';

                      return (
                        <div className="space-y-1.5 border-t border-card-border/30 pt-1.5">
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-muted font-bold uppercase tracking-wider">Dealing Range</span>
                            <span className="font-mono font-bold text-foreground/90">
                              {isAwaiting ? 'AWAITING_IDM_SWEEP' : `${formatPrice(range.low)} - ${formatPrice(range.high)}`}
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-muted font-bold uppercase tracking-wider">Equilibrium</span>
                            <span className="font-mono font-bold text-accent">
                              {isAwaiting ? 'AWAITING sweep confirmation' : formatPrice(range.equilibrium)}
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-muted font-bold uppercase tracking-wider">Pricing Context</span>
                            <span className={`px-1.5 py-0.5 text-[8px] font-black rounded border tracking-widest uppercase ${pricingColorClass}`}>
                              {pricingStatus}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* ──────── BOTTOM SECTION: INTRADAY DEPTH ──────── */}
                <div className="space-y-2 border-t border-card-border/30 pt-3">
                  <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-muted-foreground/80">
                    <span>Intraday Depth</span>
                    <span className="text-[9px] font-mono text-muted">(Dynamic Swings)</span>
                  </div>

                  <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-muted uppercase font-bold">Internal Trend</span>
                      {(() => {
                        const trend = metrics?.internal_context?.trend || 'UNSET';
                        if (trend === 'BULLISH') return <span className="text-[11px] font-black text-emerald-500 uppercase">🟢 BULLISH</span>;
                        if (trend === 'BEARISH') return <span className="text-[11px] font-black text-rose-500 uppercase">🔴 BEARISH</span>;
                        return <span className="text-[11px] font-black text-muted uppercase">⚪ UNSET</span>;
                      })()}
                    </div>

                    {(() => {
                      const internalRange = metrics?.internal_context || structureMap?.internalDealingRange;
                      if (!internalRange || (internalRange.high === null && internalRange.low === null)) {
                        return (
                          <div className="text-[10px] text-muted italic text-center py-2 border-t border-card-border/30">
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
                        <div className="space-y-1.5 border-t border-card-border/30 pt-1.5">
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-muted font-bold uppercase tracking-wider">Internal Range</span>
                            <span className="font-mono font-bold text-foreground/90">
                              {isAwaiting ? 'AWAITING_IDM_SWEEP' : `${formatPrice(internalRange.low)} - ${formatPrice(internalRange.high)}`}
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-muted font-bold uppercase tracking-wider">Equilibrium</span>
                            <span className="font-mono font-bold text-accent">
                              {isAwaiting ? 'AWAITING sweep confirmation' : formatPrice(internalRange.equilibrium)}
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-muted font-bold uppercase tracking-wider">Pricing Context</span>
                            <span className={`px-1.5 py-0.5 text-[8px] font-black rounded border tracking-widest uppercase ${pricingColorClass}`}>
                              {pricingStatus}
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-muted font-bold uppercase tracking-wider">Volatility Gate</span>
                            {(() => {
                              const multiplier = parseFloat(themeSettings?.structure_istr_atr_multiplier || '1.5');
                              const activeCandles = enrichedPayload?.data_payload?.[`candles_${activeTimeframe}` as keyof typeof enrichedPayload.data_payload] || [];
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
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* Card: Liquidity Pool Context */}
            <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
              <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] tracking-widest">
                <Magnet size={12} className="text-accent" />
                <span>Liquidity Pool Context</span>
              </div>
              <div className="space-y-2.5">
                {/* PDH / PDL */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-background/40 p-2.5 border border-card-border rounded-lg">
                    <span className="text-[10px] text-muted block mb-0.5 uppercase font-bold tracking-wider">PDH</span>
                    <span className="text-sm font-mono font-bold text-foreground">{formatPrice(metrics?.macro_levels?.pdh)}</span>
                  </div>
                  <div className="bg-background/40 p-2.5 border border-card-border rounded-lg">
                    <span className="text-[10px] text-muted block mb-0.5 uppercase font-bold tracking-wider">PDL</span>
                    <span className="text-sm font-mono font-bold text-foreground">{formatPrice(metrics?.macro_levels?.pdl)}</span>
                  </div>
                </div>

                {/* Asian Range Sweeps */}
                {asianHigh && (
                  <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-1.5">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-muted uppercase font-bold tracking-wider">Asian High</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`font-mono text-sm font-bold ${isAsianHighSwept ? 'text-rose-500 line-through opacity-60' : 'text-foreground'}`}>
                          {formatPrice(asianHigh)}
                        </span>
                        {isAsianHighSwept && (
                          <span className="px-1 py-0.5 bg-rose-500/10 text-rose-500 text-[8px] font-black rounded-sm border border-rose-500/20">
                            SWEPT 🧹
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-muted uppercase font-bold tracking-wider">Asian Low</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`font-mono text-sm font-bold ${isAsianLowSwept ? 'text-emerald-500 line-through opacity-60' : 'text-foreground'}`}>
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
            </div>

            {/* Card: Order Flow Pulse */}
            <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
              <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] tracking-widest">
                <BarChart3 size={12} className="text-accent" />
                <span>Order Flow Pulse</span>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-muted font-bold">OI Trend</span>
                  <span className={`text-[11px] font-black uppercase tracking-wider ${
                    orderFlow?.open_interest_trend === 'BULLISH' ? 'text-emerald-500' :
                    orderFlow?.open_interest_trend === 'BEARISH' ? 'text-rose-500' : 'text-muted'
                  }`}>
                    {orderFlow?.open_interest_trend || 'NEUTRAL'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-muted font-bold">Displacement</span>
                  <span className={`text-[11px] font-black uppercase tracking-wider ${
                    metrics?.institutional_sponsorship?.status?.includes('BULLISH') ? 'text-emerald-500' :
                    metrics?.institutional_sponsorship?.status?.includes('BEARISH') ? 'text-rose-500' :
                    metrics?.institutional_sponsorship?.status === 'CONSOLIDATION' ? 'text-accent' : 'text-muted'
                  }`}>
                    {metrics?.institutional_sponsorship?.status || 'INACTIVE'}
                  </span>
                </div>

                {/* Statistical Validation */}
                {metrics?.institutional_sponsorship?.statistical_validation && (
                  <div className="bg-background/40 p-2 border border-card-border rounded-lg space-y-1">
                    {[
                      { label: 't-STAT', value: metrics.institutional_sponsorship.statistical_validation.t_statistic?.toFixed(4) ?? '0.0000' },
                      { label: 'p-VALUE', value: metrics.institutional_sponsorship.statistical_validation.p_value?.toFixed(4) ?? '1.0000' },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between text-[10px] items-center">
                        <span className="text-muted">{row.label}</span>
                        <span className="font-mono font-bold text-foreground">{row.value}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-[10px] items-center">
                      <span className="text-muted">OLS VALIDATION</span>
                      <span className={`font-black uppercase text-[9px] tracking-wider ${
                        metrics.institutional_sponsorship.statistical_validation.confidence_interval_95 === true
                          ? 'text-emerald-500'
                          : metrics.institutional_sponsorship.status === 'CONSOLIDATION'
                          ? 'text-accent'
                          : 'text-rose-500'
                      }`}>
                        {metrics.institutional_sponsorship.statistical_validation.confidence_interval_95 === true
                          ? 'CONFIRMED'
                          : metrics.institutional_sponsorship.status === 'CONSOLIDATION'
                          ? 'CONSOLIDATION'
                          : 'REJECTED'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Smart Money Divergence */}
                <div className="bg-background/40 p-2.5 border border-card-border rounded-lg">
                  <span className="text-[10px] text-muted block mb-1 uppercase tracking-wider font-bold">
                    Smart Money Divergence
                  </span>
                  <p className="text-[10px] text-muted italic leading-normal select-text">
                    {orderFlow?.smart_money_sentiment?.smart_money_divergence || 'No divergence detected in HTF/LTF pairing.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Card: Resting Magnets */}
            <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
              <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] tracking-widest">
                <Activity size={12} className="text-accent" />
                <span>Resting Magnets</span>
              </div>
              <div className="space-y-3.5">
                {/* BSL */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-black text-emerald-500 uppercase tracking-wider">BSL Targets</span>
                  <div className="flex flex-col gap-1">
                    {orderFlow?.resting_liquidity_pools?.BSL_Magnets?.length
                      ? orderFlow.resting_liquidity_pools.BSL_Magnets.map((p: number, idx: number) => {
                          const isPurged = lastPrice !== null && lastPrice >= p;
                          return (
                            <div key={idx} className="flex justify-between items-center text-[13px] font-mono">
                              <span className={isPurged ? 'text-emerald-500 line-through opacity-60' : 'text-foreground font-bold'}>
                                {p.toFixed(2)}
                              </span>
                              {isPurged && (
                                <span className="text-[8px] text-emerald-500 font-black tracking-wider bg-emerald-500/10 px-1 py-0.5 rounded-sm border border-emerald-500/20">
                                  PURGED 🧹
                                </span>
                              )}
                            </div>
                          );
                        })
                      : <span className="text-[13px] font-mono text-muted">N/A</span>}
                  </div>
                </div>
                {/* SSL */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-black text-rose-500 uppercase tracking-wider">SSL Targets</span>
                  <div className="flex flex-col gap-1">
                    {orderFlow?.resting_liquidity_pools?.SSL_Magnets?.length
                      ? orderFlow.resting_liquidity_pools.SSL_Magnets.map((p: number, idx: number) => {
                          const isPurged = lastPrice !== null && lastPrice <= p;
                          return (
                            <div key={idx} className="flex justify-between items-center text-[13px] font-mono">
                              <span className={isPurged ? 'text-rose-500 line-through opacity-60' : 'text-foreground font-bold'}>
                                {p.toFixed(2)}
                              </span>
                              {isPurged && (
                                <span className="text-[8px] text-rose-500 font-black tracking-wider bg-rose-500/10 px-1 py-0.5 rounded-sm border border-rose-500/20">
                                  PURGED 🧹
                                </span>
                              )}
                            </div>
                          );
                        })
                      : <span className="text-[13px] font-mono text-muted">N/A</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Card: AI Synthesis Console */}
            <div className="glass-panel flex flex-col overflow-hidden">
              <div className="p-3 border-b border-card-border bg-card/45 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Terminal size={12} className="text-accent" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Synthesis Console
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsHudExpanded(!isHudExpanded)}
                    className="text-[8px] font-black uppercase tracking-wider text-muted hover:text-accent transition-colors cursor-pointer"
                    title={isHudExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isHudExpanded ? '▲ LESS' : '▼ MORE'}
                  </button>
                  {isAnalyzing && <Loader2 size={12} className="text-accent animate-spin" />}
                </div>
              </div>

              <div
                className={`overflow-y-auto bg-background/25 font-mono scrollbar-thin scrollbar-thumb-card-border transition-all duration-300 ${
                  isHudExpanded ? 'max-h-[420px] p-3' : 'max-h-[200px] p-3'
                }`}
              >
                {aiAnalysis ? (
                  hudData ? (
                    <div className="space-y-4">
                      {/* HUD Table */}
                      <div className="border border-card-border rounded-lg overflow-hidden">
                        <table className="w-full text-left border-collapse">
                          <tbody>
                            {Object.entries(hudData).map(([key, value]) => {
                              let colorClass = 'text-foreground font-semibold';
                              const vStr = Array.isArray(value)
                                ? (value as any[]).join(', ')
                                : String(value).toUpperCase();

                              if (vStr.includes('BUY') || vStr.includes('LONG') || vStr.includes('BULLISH') || vStr.includes('STRONG') || vStr.includes('FULL_RISK'))
                                colorClass = 'text-emerald-600 dark:text-emerald-400 font-bold';
                              else if (vStr.includes('SELL') || vStr.includes('SHORT') || vStr.includes('BEARISH') || vStr.includes('WEAK') || vStr.includes('ABORT'))
                                colorClass = 'text-rose-600 dark:text-rose-400 font-bold';
                              else if (vStr.includes('STAND DOWN') || vStr.includes('NEUTRAL') || vStr.includes('NONE') || vStr.includes('WAIT'))
                                colorClass = 'text-muted font-semibold';

                              return (
                                <tr key={key} className="border-b border-card-border last:border-0 bg-background/25">
                                  <td className="p-2 text-[10px] font-black uppercase tracking-wider text-muted border-r border-card-border w-1/3">
                                    {key.replace(/_/g, ' ').toUpperCase()}
                                  </td>
                                  <td className={`p-2 text-xs font-mono font-medium ${colorClass}`}>
                                    {Array.isArray(value) ? (value as any[]).join(', ') : String(value)}
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
                              const displayAlert =
                                typeof alert === 'object' && alert !== null && 'price' in alert && 'reason' in alert
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
                  <div className="h-full flex flex-col items-center justify-center text-center p-4 min-h-[100px]">
                    <Brain size={24} className="text-card-border mb-2 animate-pulse" />
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                      Awaiting Replay Payload Injection.
                    </p>
                  </div>
                )}
              </div>

              {/* Synthesize Button */}
              <div className="p-3 bg-card/45 border-t border-card-border shrink-0">
                <button
                  onClick={() => {
                    if (enrichedPayload) triggerAiAnalysisScan(enrichedPayload);
                  }}
                  disabled={isAnalyzing || !enrichedPayload}
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
                      <span>Synthesize Replay Data</span>
                    </>
                  )}
                </button>
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="p-3 border-t border-card-border bg-card/45 shrink-0 select-none text-center">
            <span className="text-[8px] font-black text-muted-foreground tracking-widest uppercase">
              Market Replay HUD · Backtest Mode
            </span>
          </div>

        </div>
      </aside>
    </>
  );
}
