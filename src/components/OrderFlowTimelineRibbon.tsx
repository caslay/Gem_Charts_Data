'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { OrderFlowStateRecord, OrderFlowTimelineSummary, OrderFlowState } from '@/lib/quantEngine/types';
import { Activity, Clock, ArrowRight, TrendingUp, TrendingDown, Maximize2, Shield, Info, SlidersHorizontal } from 'lucide-react';
import { useOBTimeframeStreams, SupportedOBTimeframe } from '@/lib/quantEngine/strategyExecutionConfig';
import { useMarketDataLiveContext } from '@/context/MarketDataContext';

interface OrderFlowTimelineRibbonProps {
  timeline?: OrderFlowTimelineSummary | null;
  livePrice?: number | null;
  onOpenModal?: () => void;
  onOpenLiveOBModal?: () => void;
  className?: string;
  isBacktest?: boolean;
}

export function getStateMetadata(state: OrderFlowState | string) {
  const s = String(state).toUpperCase();
  if (s.includes('RISING_WITH_PRICE')) {
    return {
      label: 'BUY SPONSORSHIP',
      shortLabel: 'LONG',
      description: 'Aggressive Buy Sponsorship (Longs Building)',
      colorBg: 'bg-emerald-500/80',
      colorBgMuted: 'bg-emerald-500/15',
      colorBorder: 'border-emerald-400/40',
      colorText: 'text-emerald-400',
      colorGlow: 'shadow-[0_0_12px_rgba(16,185,129,0.35)]',
      colorDot: 'bg-emerald-400',
      icon: TrendingUp,
    };
  }
  if (s.includes('RISING_AGAINST_PRICE')) {
    return {
      label: 'SHORT SPONSORSHIP',
      shortLabel: 'SHORT',
      description: 'Aggressive Short Sponsorship (Shorts Building)',
      colorBg: 'bg-rose-500/80',
      colorBgMuted: 'bg-rose-500/15',
      colorBorder: 'border-rose-400/40',
      colorText: 'text-rose-400',
      colorGlow: 'shadow-[0_0_12px_rgba(244,63,94,0.35)]',
      colorDot: 'bg-rose-400',
      icon: TrendingDown,
    };
  }
  if (s.includes('FALLING_WITH_PRICE')) {
    return {
      label: 'LONG LIQUIDATION',
      shortLabel: 'LIQ-L',
      description: 'Long Liquidation / Long Unwinding',
      colorBg: 'bg-sky-600/70',
      colorBgMuted: 'bg-sky-500/15',
      colorBorder: 'border-sky-400/40',
      colorText: 'text-sky-300',
      colorGlow: 'shadow-[0_0_10px_rgba(56,189,248,0.25)]',
      colorDot: 'bg-sky-400',
      icon: Activity,
    };
  }
  if (s.includes('FALLING_AGAINST_PRICE')) {
    return {
      label: 'SHORT COVERING',
      shortLabel: 'COV-S',
      description: 'Short Covering / Short Squeeze',
      colorBg: 'bg-amber-600/70',
      colorBgMuted: 'bg-amber-500/15',
      colorBorder: 'border-amber-400/40',
      colorText: 'text-amber-300',
      colorGlow: 'shadow-[0_0_10px_rgba(245,158,11,0.25)]',
      colorDot: 'bg-amber-400',
      icon: Activity,
    };
  }
  if (s.includes('FLAT')) {
    return {
      label: 'FLAT / BALANCE',
      shortLabel: 'FLAT',
      description: 'Equilibrium / Passive Order Book',
      colorBg: 'bg-slate-600/80',
      colorBgMuted: 'bg-slate-600/25',
      colorBorder: 'border-slate-500/50',
      colorText: 'text-slate-200',
      colorGlow: '',
      colorDot: 'bg-slate-400',
      icon: Activity,
    };
  }
  return {
    label: 'NEUTRAL',
    shortLabel: 'NEUT',
    description: 'Neutral / Undecided Volume Flow',
    colorBg: 'bg-zinc-600/70',
    colorBgMuted: 'bg-zinc-700/30',
    colorBorder: 'border-zinc-500/40',
    colorText: 'text-zinc-300',
    colorGlow: '',
    colorDot: 'bg-zinc-400',
    icon: Activity,
  };
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds) || seconds < 0) return '00:00';
  const sec = Math.floor(seconds);
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remSec = sec % 60;

  if (hrs > 0) {
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
  }
  return `${mins.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`;
}

export function getUnifiedTimelineSegments(
  timeline?: OrderFlowTimelineSummary | null,
  livePrice?: number | null,
  liveDurationSec?: number,
  maxHistoryCount: number = 50
): { segments: OrderFlowStateRecord[]; totalTransitions: number } {
  if (!timeline) return { segments: [], totalTransitions: 0 };
  const activeState = timeline.active_state || null;
  const history = timeline.history || [];

  const validHistory = activeState
    ? history.filter((h) => h.entered_at < activeState.entered_at)
    : history;

  const seenEnteredAt = new Set<number>();
  const recs: OrderFlowStateRecord[] = [];

  const sliceSource = maxHistoryCount > 0 ? validHistory.slice(-maxHistoryCount) : validHistory;
  for (const h of sliceSource) {
    if (!seenEnteredAt.has(h.entered_at)) {
      seenEnteredAt.add(h.entered_at);
      recs.push(h);
    }
  }

  if (activeState) {
    const activeEnriched: OrderFlowStateRecord = {
      ...activeState,
      duration_seconds: liveDurationSec || activeState.duration_seconds || 1,
      exit_price: livePrice ?? activeState.exit_price ?? activeState.entry_price,
      price_change: livePrice ? parseFloat((livePrice - activeState.entry_price).toFixed(2)) : activeState.price_change,
      price_change_pct: livePrice ? parseFloat((((livePrice - activeState.entry_price) / activeState.entry_price) * 100).toFixed(3)) : activeState.price_change_pct,
    };

    if (seenEnteredAt.has(activeState.entered_at)) {
      const idx = recs.findIndex((r) => r.entered_at === activeState.entered_at);
      if (idx !== -1) {
        recs[idx] = activeEnriched;
      }
    } else {
      recs.push(activeEnriched);
    }
  }

  recs.sort((a, b) => a.entered_at - b.entered_at);

  const totalTransitions = validHistory.length + (activeState ? 1 : 0);
  return { segments: recs, totalTransitions };
}

export function formatTimeCairo(ms: number | null | undefined): string {
  if (!ms) return '---';
  try {
    return new Date(ms).toLocaleTimeString('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } catch {
    return new Date(ms).toISOString().substring(11, 19);
  }
}

export default function OrderFlowTimelineRibbon({
  timeline,
  livePrice,
  onOpenModal,
  onOpenLiveOBModal,
  className = '',
  isBacktest = false,
}: OrderFlowTimelineRibbonProps) {
  const [hoveredRecord, setHoveredRecord] = useState<{
    record: OrderFlowStateRecord;
    rect: DOMRect | null;
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  const { enabledTimeframes, isTimeframeEnabled, toggleTimeframe } = useOBTimeframeStreams();
  const liveContext = useMarketDataLiveContext();
  const effectiveLivePrice = livePrice !== undefined ? livePrice : liveContext?.livePrice;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Live ticking counter for active ongoing state
  const [liveDurationSec, setLiveDurationSec] = useState<number>(0);

  const activeState = timeline?.active_state || null;

  // Update live duration ticker every second
  useEffect(() => {
    if (!activeState?.entered_at) {
      setLiveDurationSec(0);
      return;
    }
    const update = () => {
      const now = isBacktest ? (activeState.entered_at + (activeState.duration_seconds || 0) * 1000) : Date.now();
      const diff = Math.max(0, Math.round((now - activeState.entered_at) / 1000));
      setLiveDurationSec(diff);
    };
    update();
    if (isBacktest) return; // in backtest, fixed per step
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activeState?.entered_at, activeState?.duration_seconds, isBacktest]);

  // Combine visible history (last 20 segments) + active state, strictly deduplicating and sorting chronologically
  const { segments: allSegments, totalTransitions } = useMemo(() => {
    return getUnifiedTimelineSegments(timeline, effectiveLivePrice, liveDurationSec, 20);
  }, [timeline, effectiveLivePrice, liveDurationSec]);

  // Compute total duration to determine percentage flex widths with min/max clamps
  const totalDuration = useMemo(() => {
    return allSegments.reduce((acc, s) => acc + Math.max(15, s.duration_seconds || 60), 0);
  }, [allSegments]);

  if (!allSegments || allSegments.length === 0) {
    return null;
  }

  const activeMeta = activeState ? getStateMetadata(activeState.state) : getStateMetadata('NEUTRAL');

  return (
    <div className={`w-full bg-card/75 backdrop-blur-md border border-card-border rounded-xl px-3 py-2 select-none relative z-10 transition-all ${className}`}>
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] font-mono">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 font-black tracking-wider uppercase text-foreground">
            <Activity className="w-3.5 h-3.5 text-accent animate-pulse" />
            <span className="hidden sm:inline text-muted font-bold">ORDER FLOW REGIME:</span>
          </div>

          {/* Active State Badge */}
          {activeState && (
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border ${activeMeta.colorBorder} ${activeMeta.colorBgMuted} ${activeMeta.colorGlow} transition-all`}>
              <span className={`w-1.5 h-1.5 rounded-full ${activeMeta.colorDot} animate-ping`} />
              <span className={`font-black text-[10px] uppercase tracking-wider ${activeMeta.colorText}`}>
                {activeMeta.label}
              </span>
              <span className="text-[9px] text-muted-foreground font-mono font-bold pl-1 border-l border-card-border/60">
                {formatDuration(liveDurationSec || activeState.duration_seconds)}
              </span>
            </div>
          )}
        </div>

        {/* Action button & Stats count */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden lg:flex items-center gap-2 text-[10px] text-muted">
            <span>TRANSITIONS: <strong className="text-foreground font-bold">{timeline?.stats?.total_transitions ?? allSegments.length}</strong></span>
            {timeline?.stats?.dominant_state_last_24h && (
              <span className="hidden xl:inline border-l border-card-border pl-2">
                DOMINANT 24H: <strong className="text-foreground font-bold">{getStateMetadata(timeline.stats.dominant_state_last_24h).shortLabel}</strong>
              </span>
            )}
          </div>

          {/* Dynamic MTF Stream Toggles in Cockpit Ribbon */}
          <div className="hidden sm:flex items-center gap-1 bg-background/60 px-1.5 py-0.5 rounded-md border border-card-border/60">
            <span className="text-[8px] font-black text-muted uppercase tracking-wider mr-0.5">MTF:</span>
            {(['5m', '15m', '1h'] as const).map(tf => {
              const isEnabled = isTimeframeEnabled(tf);
              const activeColor =
                tf === '1h'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
                  : tf === '15m'
                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-[0_0_8px_rgba(168,85,247,0.25)]'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.25)]';

              return (
                <button
                  key={tf}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTimeframe(tf);
                  }}
                  title={`Live OB ${tf.toUpperCase()} Stream: ${isEnabled ? 'ACTIVE (Click to Suspend)' : 'SUSPENDED (Click to Enable)'}`}
                  className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer border flex items-center gap-1 ${
                    isEnabled
                      ? activeColor
                      : 'bg-card/40 text-muted/40 border-card-border/40 hover:text-muted hover:border-card-border line-through'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isEnabled ? (tf === '1h' ? 'bg-cyan-400' : tf === '15m' ? 'bg-purple-400' : 'bg-amber-400') : 'bg-slate-600'}`} />
                  <span>{tf}</span>
                </button>
              );
            })}
          </div>

          {onOpenLiveOBModal && (
            <button
              type="button"
              onClick={onOpenLiveOBModal}
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-card hover:bg-cyan-500/15 border border-card-border hover:border-cyan-500/50 text-muted hover:text-cyan-400 font-mono text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm"
              title="Open Phase 7 Live Order Block & Breaker Execution Cockpit"
            >
              <Activity size={11} className="text-cyan-400 animate-pulse" />
              <span>[ LIVE OB EXECUTION ]</span>
            </button>
          )}

          {onOpenModal && (
            <button
              type="button"
              onClick={onOpenModal}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-card hover:bg-accent/15 border border-card-border hover:border-accent text-muted hover:text-accent font-mono text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm"
              title="Open Full Order Flow State Timeline & Analytics Suite"
            >
              <Maximize2 size={10} />
              <span>[ TIMELINE & ANALYTICS ]</span>
            </button>
          )}
        </div>
      </div>

      {/* Multi-segmented Horizontal Color-Coded Ribbon */}
      <div className="w-full h-4 sm:h-5 rounded-md overflow-hidden flex gap-[2px] bg-background/50 p-0.5 border border-card-border/50 relative shadow-inner">
        {allSegments.map((seg, idx) => {
          const meta = getStateMetadata(seg.state);
          const dur = Math.max(15, seg.duration_seconds || 60);
          // Flex percentage with bounds
          const flexPct = totalDuration > 0 ? (dur / totalDuration) * 100 : 100 / allSegments.length;
          const isLatest = idx === allSegments.length - 1;

          return (
            <div
              key={`ribbon-seg-${seg.id || seg.entered_at}-${idx}`}
              style={{ flex: `max(1.5, ${flexPct})` }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredRecord({ record: seg, rect });
              }}
              onMouseLeave={() => setHoveredRecord(null)}
              onClick={onOpenModal}
              className={`
                h-full min-w-[6px] rounded-sm transition-all duration-150 cursor-pointer relative group border border-black/20
                ${meta.colorBg} hover:brightness-125 hover:scale-y-110 hover:z-20
                ${isLatest ? `animate-pulse ${meta.colorGlow} ring-1 ring-white/50` : 'opacity-90 hover:opacity-100'}
              `}
            >
              {/* Optional inner micro-pattern for aggressive sponsorship */}
              {(seg.state === 'RISING_WITH_PRICE' || seg.state === 'RISING_AGAINST_PRICE') && (
                <div className="absolute inset-0 opacity-20 bg-[linear-gradient(45deg,rgba(255,255,255,0.4)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.4)_50%,rgba(255,255,255,0.4)_75%,transparent_75%,transparent)] bg-[length:6px_6px]" />
              )}
            </div>
          );
        })}
      </div>

      {/* Interactive Floating Tooltip Card (Rendered into document.body via Portal with z-[999999]) */}
      {mounted && hoveredRecord && hoveredRecord.rect && createPortal(
        (() => {
          const r = hoveredRecord.record;
          const rect = hoveredRecord.rect;
          const meta = getStateMetadata(r.state);
          const isLiveActive = r.exited_at === null;
          const pFrom = r.entry_price;
          const pTo = r.exit_price ?? (livePrice ?? r.entry_price);
          const pDiff = parseFloat((pTo - pFrom).toFixed(2));
          const pPct = parseFloat((((pTo - pFrom) / pFrom) * 100).toFixed(2));
          const isUp = pDiff >= 0;

          // Position above ribbon if there is room (>= 220px from top), otherwise below ribbon
          const placeAbove = rect.top >= 220;
          const topPos = placeAbove ? rect.top - 8 : rect.bottom + 8;
          const leftPos = Math.max(160, Math.min((typeof window !== 'undefined' ? window.innerWidth : 1200) - 160, rect.left + rect.width / 2));

          return (
            <div
              className={`fixed z-[999999] pointer-events-none transform -translate-x-1/2 ${
                placeAbove ? '-translate-y-full' : 'translate-y-0'
              } bg-[#0b0c10]/98 text-foreground border border-card-border/90 rounded-xl p-3 shadow-[0_16px_40px_rgba(0,0,0,0.85)] backdrop-blur-2xl font-mono text-[11px] min-w-[250px] max-w-[320px] ring-1 ring-white/10 animate-in fade-in zoom-in-95 duration-100`}
              style={{
                left: `${leftPos}px`,
                top: `${topPos}px`,
              }}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b border-card-border/70 pb-1.5">
                  <div className="flex items-center gap-1.5 font-bold">
                    <span className={`w-2 h-2 rounded-full ${meta.colorDot} ${isLiveActive ? 'animate-ping' : ''}`} />
                    <span className={`uppercase font-black text-xs ${meta.colorText}`}>{meta.label}</span>
                  </div>
                  {isLiveActive ? (
                    <span className="text-[9px] font-black uppercase text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                      LIVE NOW
                    </span>
                  ) : (
                    <span className="text-[9px] text-muted uppercase font-bold tracking-wider">CLOSED</span>
                  )}
                </div>

                <div className="text-[10px] text-muted-foreground leading-tight">
                  {meta.description}
                </div>

                {/* Time & Duration */}
                <div className="grid grid-cols-2 gap-2 bg-background/60 p-2 rounded-lg border border-card-border/50 text-[10px]">
                  <div>
                    <span className="text-muted text-[9px] uppercase block font-bold">DURATION</span>
                    <span className="font-bold text-foreground">{formatDuration(r.duration_seconds)}</span>
                  </div>
                  <div>
                    <span className="text-muted text-[9px] uppercase block font-bold">TIME (CAIRO UTC+3)</span>
                    <span className="font-mono text-foreground font-semibold">{formatTimeCairo(r.entered_at)}</span>
                  </div>
                </div>

                {/* Price change */}
                <div className="flex items-center justify-between bg-background/60 p-2 rounded-lg border border-card-border/50 text-[10px]">
                  <div>
                    <span className="text-muted text-[9px] uppercase block font-bold">PRICE FROM ➔ TO</span>
                    <span className="font-mono font-bold text-foreground">
                      ${pFrom.toFixed(2)} ➔ ${pTo.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-muted text-[9px] uppercase block font-bold">DELTA</span>
                    <span className={`font-mono font-black ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isUp ? '+' : ''}{pDiff.toFixed(2)} ({isUp ? '+' : ''}{pPct}%)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
}
