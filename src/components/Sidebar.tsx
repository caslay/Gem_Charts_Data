'use client';

import { useState, memo, useMemo, useEffect } from 'react';
import { SYSTEM_VERSION } from '@/lib/version';
import { safeParseAiJson } from '@/lib/aiJsonParser';
import {
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
  ChevronLeft,
  Shield,
  Layers,
  Target,
  History
} from 'lucide-react';
import HudModal from './modals/HudModal';
import PotentialTradesModal from './modals/PotentialTradesModal';
import SelfCorrectionModal from './modals/SelfCorrectionModal';
import OrderFlowTimelineModal from './modals/OrderFlowTimelineModal';
import { MTFStatusRadar } from './MTFStatusRadar';
import { getStateMetadata, formatDuration, getUnifiedTimelineSegments } from './OrderFlowTimelineRibbon';
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
  'Act as the Institutional Flow Synthesizer V14.0 (SOP V2.0.0). Analyze the following quantitative data and provide a mechanical bias report: \n\n';

// ─── Resting Magnets Card ───────────────────────────────────────────────────
const RestingMagnetsCard = memo(function RestingMagnetsCard({ orderFlow }: { orderFlow: any }) {
  const [isOpen, setIsOpen] = useState(true);
  const { livePrice } = useMarketDataLiveContext();

  const bslPools: number[] = orderFlow?.resting_liquidity_pools?.BSL_Magnets || [];
  const sslPools: number[] = orderFlow?.resting_liquidity_pools?.SSL_Magnets || [];

  return (
    <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between cursor-pointer select-none group-hover:text-accent transition-colors"
      >
        <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] lg:text-xs tracking-widest group-hover:text-accent">
          <Layers size={12} className="text-accent" />
          <span>Resting Liquidity Pools</span>
        </div>
        <button type="button" className="text-muted hover:text-foreground transition-colors p-0.5">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {isOpen && (
        <div className="space-y-2 animate-[fade-in_0.15s_ease-out] text-[10px]">
          {/* BSL Pools Sub-Card */}
          <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-emerald-400 uppercase font-black tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                BSL Magnets (Buy Stops)
              </span>
              <span className="text-[9px] font-mono text-muted">
                {bslPools.length} {bslPools.length === 1 ? 'POOL' : 'POOLS'}
              </span>
            </div>

            {bslPools.length > 0 ? (
              <div className="space-y-1.5">
                {bslPools.map((p: number, idx: number) => {
                  const isPurged = livePrice !== null && livePrice >= p;
                  const delta = livePrice !== null ? p - livePrice : null;
                  const deltaPct = livePrice !== null && livePrice > 0 ? ((p - livePrice) / livePrice) * 100 : null;

                  return (
                    <div
                      key={`bsl-pool-${idx}`}
                      className="flex items-center justify-between text-[11px] font-mono py-0.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="px-1 py-0.2 rounded text-[8px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          #{idx + 1}
                        </span>
                        <span className={`font-bold ${isPurged ? 'text-emerald-500/60 line-through' : 'text-foreground'}`}>
                          ${p.toFixed(2)}
                        </span>
                      </div>

                      {isPurged ? (
                        <span className="text-[8px] text-emerald-400 font-black tracking-wider bg-emerald-500/10 px-1 py-0.5 rounded-sm border border-emerald-500/20">
                          SWEPT 🧹
                        </span>
                      ) : (
                        delta !== null && (
                          <span className="text-[9px] text-muted font-bold">
                            +{delta > 0 ? `$${delta.toFixed(2)}` : `$${Math.abs(delta).toFixed(2)}`} ({deltaPct ? `+${deltaPct.toFixed(2)}%` : '0%'})
                          </span>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="text-[10px] font-mono text-muted block text-center py-1">No Active BSL Pools</span>
            )}
          </div>

          {/* SSL Pools Sub-Card */}
          <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-rose-400 uppercase font-black tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                SSL Magnets (Sell Stops)
              </span>
              <span className="text-[9px] font-mono text-muted">
                {sslPools.length} {sslPools.length === 1 ? 'POOL' : 'POOLS'}
              </span>
            </div>

            {sslPools.length > 0 ? (
              <div className="space-y-1.5">
                {sslPools.map((p: number, idx: number) => {
                  const isPurged = livePrice !== null && livePrice <= p;
                  const delta = livePrice !== null ? livePrice - p : null;
                  const deltaPct = livePrice !== null && livePrice > 0 ? ((livePrice - p) / livePrice) * 100 : null;

                  return (
                    <div
                      key={`ssl-pool-${idx}`}
                      className="flex items-center justify-between text-[11px] font-mono py-0.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="px-1 py-0.2 rounded text-[8px] font-mono font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          #{idx + 1}
                        </span>
                        <span className={`font-bold ${isPurged ? 'text-rose-500/60 line-through' : 'text-foreground'}`}>
                          ${p.toFixed(2)}
                        </span>
                      </div>

                      {isPurged ? (
                        <span className="text-[8px] text-rose-400 font-black tracking-wider bg-rose-500/10 px-1 py-0.5 rounded-sm border border-rose-500/20">
                          SWEPT 🧹
                        </span>
                      ) : (
                        delta !== null && (
                          <span className="text-[9px] text-muted font-bold">
                            -{delta > 0 ? `$${delta.toFixed(2)}` : `$${Math.abs(delta).toFixed(2)}`} ({deltaPct ? `-${deltaPct.toFixed(2)}%` : '0%'})
                          </span>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="text-[10px] font-mono text-muted block text-center py-1">No Active SSL Pools</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Value Area Calculator Helper ───────────────────────────────────────────
function calculateValueArea(candles: Array<{ c?: number; h?: number; l?: number; v?: number }>) {
  if (!candles || candles.length === 0) return { vah: null, val: null, poc: null };
  const slice = candles.slice(-48);
  let minP = Infinity, maxP = -Infinity;
  slice.forEach(c => {
    const h = c.h ?? 0, l = c.l ?? 0;
    if (h > maxP) maxP = h;
    if (l < minP && l > 0) minP = l;
  });
  if (minP === Infinity || maxP === -Infinity || minP === maxP) return { vah: null, val: null, poc: null };

  const bins = 24;
  const step = (maxP - minP) / bins;
  const profile = new Array(bins).fill(0);
  let totalVol = 0;

  slice.forEach(c => {
    const price = c.c ?? (minP + maxP) / 2;
    const vol = c.v ?? 1;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((price - minP) / step)));
    profile[idx] += vol;
    totalVol += vol;
  });

  let maxIdx = 0;
  profile.forEach((v, i) => {
    if (v > profile[maxIdx]) maxIdx = i;
  });

  const poc = minP + (maxIdx + 0.5) * step;

  let vaVol = profile[maxIdx];
  let up = maxIdx, down = maxIdx;
  while (vaVol < totalVol * 0.70 && (up < bins - 1 || down > 0)) {
    const nextUp = up < bins - 1 ? profile[up + 1] : 0;
    const nextDown = down > 0 ? profile[down - 1] : 0;
    if (nextUp >= nextDown && up < bins - 1) {
      up++;
      vaVol += profile[up];
    } else if (down > 0) {
      down--;
      vaVol += profile[down];
    } else if (up < bins - 1) {
      up++;
      vaVol += profile[up];
    } else {
      break;
    }
  }

  const vah = minP + (up + 1) * step;
  const val = minP + down * step;
  return { vah, val, poc };
}

// ─── Auto-Scan Countdown Leaf Component ──────────────────────────────────────
const AutoScanCountdown = memo(function AutoScanCountdown({
  nextScanTimestamp,
  isAutoScanActive,
  onToggle
}: {
  nextScanTimestamp: number;
  isAutoScanActive: boolean;
  onToggle: () => void;
}) {
  const [remainingSec, setRemainingSec] = useState<number>(() => {
    return Math.max(0, Math.floor((nextScanTimestamp - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!isAutoScanActive) return;
    const timer = setInterval(() => {
      const sec = Math.max(0, Math.floor((nextScanTimestamp - Date.now()) / 1000));
      setRemainingSec(sec);
    }, 1000);
    return () => clearInterval(timer);
  }, [isAutoScanActive, nextScanTimestamp]);

  const mins = Math.floor(remainingSec / 60);
  const secs = (remainingSec % 60).toString().padStart(2, '0');

  return (
    <div suppressHydrationWarning className="flex items-center justify-between px-2 py-1 bg-background/50 border border-card-border rounded-lg text-[10px] font-mono">
      <div suppressHydrationWarning className="flex items-center gap-1.5">
        <Clock size={11} className={isAutoScanActive ? "text-accent animate-pulse" : "text-muted"} />
        <span className="text-muted font-bold">30m Auto-Scan:</span>
        <span suppressHydrationWarning className="text-foreground font-extrabold">
          {isAutoScanActive ? `${mins}:${secs}` : 'OFF'}
        </span>
      </div>
      <button
        type="button"
        onClick={onToggle}
        suppressHydrationWarning
        className={`px-2 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wider border transition-colors ${
          isAutoScanActive
            ? 'bg-accent/20 border-accent text-accent'
            : 'bg-card border-card-border text-muted hover:text-foreground'
        }`}
      >
        {isAutoScanActive ? 'ENABLED' : 'PAUSED'}
      </button>
    </div>
  );
});

// ─── AMT Value Area Card Leaf Component ──────────────────────────────────────
const ValueAreaCard = memo(function ValueAreaCard({
  vah,
  val,
  poc,
  formatPrice,
  isOpen,
  onToggle
}: {
  vah?: number | null;
  val?: number | null;
  poc?: number | null;
  formatPrice: (p: any) => string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { livePrice } = useMarketDataLiveContext();

  let auctionState = '⚪ VALUE ACCEPTANCE (HVN)';
  let auctionColor = 'text-amber-400 bg-amber-500/10 border-amber-500/30';
  if (livePrice && val && livePrice <= val) {
    auctionState = '🟢 DISCOUNT AUCTION (< VAL)';
    auctionColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
  } else if (livePrice && vah && livePrice >= vah) {
    auctionState = '🔴 PREMIUM AUCTION (> VAH)';
    auctionColor = 'text-rose-400 bg-rose-500/10 border-rose-500/30';
  }

  return (
    <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
      <div
        onClick={onToggle}
        className="flex items-center justify-between cursor-pointer select-none group-hover:text-accent transition-colors"
      >
        <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] lg:text-xs tracking-widest group-hover:text-accent">
          <Layers size={12} className="text-accent" />
          <span>AMT Value Area</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 text-[8px] font-black rounded border tracking-widest uppercase ${auctionColor}`}>
            {auctionState.split(' ')[0]}
          </span>
          <button type="button" className="text-muted hover:text-foreground transition-colors p-0.5">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="space-y-2.5 animate-[fade-in_0.15s_ease-out]">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-background/40 p-2 border border-card-border rounded-lg text-center">
              <span className="text-[8px] text-muted block uppercase font-bold">VAH (70%)</span>
              <span className="text-xs font-mono font-bold text-rose-400">{formatPrice(vah)}</span>
            </div>
            <div className="bg-background/40 p-2 border border-card-border rounded-lg text-center">
              <span className="text-[8px] text-muted block uppercase font-bold">POC (HVN)</span>
              <span className="text-xs font-mono font-bold text-accent">{formatPrice(poc)}</span>
            </div>
            <div className="bg-background/40 p-2 border border-card-border rounded-lg text-center">
              <span className="text-[8px] text-muted block uppercase font-bold">VAL (70%)</span>
              <span className="text-xs font-mono font-bold text-emerald-400">{formatPrice(val)}</span>
            </div>
          </div>
          <div className={`p-2 rounded-lg border text-center text-[10px] font-black uppercase tracking-wider ${auctionColor}`}>
            {auctionState}
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Order Flow Pulse Card Leaf Component ──────────────────────────────────
const OrderFlowPulseCard = memo(function OrderFlowPulseCard({
  orderFlow,
  metrics,
  isOpen,
  onToggle,
  onOpenModal
}: {
  orderFlow: any;
  metrics: any;
  isOpen: boolean;
  onToggle: () => void;
  onOpenModal: () => void;
}) {
  const { livePrice } = useMarketDataLiveContext();
  const activeSt = orderFlow?.state_timeline?.active_state;
  const [liveOfDurationSec, setLiveOfDurationSec] = useState<number>(0);

  useEffect(() => {
    if (!activeSt?.entered_at) {
      setLiveOfDurationSec(0);
      return;
    }
    const update = () => {
      const diff = Math.max(0, Math.round((Date.now() - activeSt.entered_at) / 1000));
      setLiveOfDurationSec(diff);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activeSt?.entered_at]);

  const meta = activeSt ? getStateMetadata(activeSt.state) : getStateMetadata(orderFlow?.open_interest_trend || 'NEUTRAL');
  const { segments, totalTransitions } = getUnifiedTimelineSegments(orderFlow?.state_timeline, livePrice, liveOfDurationSec, 10);
  const totalDur = segments.reduce((acc, s) => acc + Math.max(15, s.duration_seconds || 60), 0);

  return (
    <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
      <div
        onClick={onToggle}
        className="flex items-center justify-between cursor-pointer select-none group-hover:text-accent transition-colors"
      >
        <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] lg:text-xs tracking-widest group-hover:text-accent">
          <BarChart3 size={12} className="text-accent" />
          <span>Order Flow Pulse & State</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenModal();
            }}
            className="p-1 rounded-md text-muted hover:text-accent hover:bg-card border border-transparent hover:border-card-border transition-all cursor-pointer"
            title="Open Order Flow State Timeline"
          >
            <Activity size={12} />
          </button>
          <button type="button" className="text-muted hover:text-foreground transition-colors p-0.5">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="space-y-3 animate-[fade-in_0.15s_ease-out]">
          {/* Active State Machine Regime */}
          <div className={`p-2.5 rounded-lg border ${meta.colorBorder} ${meta.colorBgMuted} space-y-1`}>
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-muted uppercase font-bold">OI State Machine:</span>
              <span className={`font-black uppercase tracking-wider ${meta.colorText}`}>
                {meta.label}
              </span>
            </div>
            <div className="flex justify-between items-center text-[9px] text-muted-foreground">
              <span>{meta.description}</span>
              {activeSt && (
                <span className="font-mono font-bold text-foreground">
                  {formatDuration(liveOfDurationSec || activeSt.duration_seconds)}
                </span>
              )}
            </div>
          </div>

          {/* Mini Timeline Ribbon Preview */}
          {segments.length > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[9px] text-muted font-bold uppercase">
                <span>Recent Transitions:</span>
                <span className="text-foreground font-bold">{totalTransitions} logged</span>
              </div>
              <div className="w-full h-2.5 rounded-sm overflow-hidden flex gap-[1px] bg-background/60 p-0.5 border border-card-border/60 shadow-inner">
                {segments.map((seg: any, idx: number) => {
                  const segMeta = getStateMetadata(seg.state);
                  const isLatest = idx === segments.length - 1;
                  const dur = Math.max(15, seg.duration_seconds || 60);
                  const flexPct = totalDur > 0 ? (dur / totalDur) * 100 : 100 / segments.length;

                  return (
                    <div
                      key={`sidebar-mini-seg-${seg.id || seg.entered_at}-${idx}`}
                      style={{ flex: `max(1, ${flexPct})` }}
                      className={`h-full rounded-[1px] transition-all ${segMeta.colorBg} ${
                        isLatest ? 'animate-pulse ring-1 ring-white/60 opacity-100' : 'opacity-80 hover:opacity-100'
                      }`}
                      title={`${segMeta.label} (${formatDuration(seg.duration_seconds)})`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span className="text-[11px] lg:text-xs text-muted font-bold">Displacement</span>
            <span className={`text-[11px] lg:text-xs font-black uppercase tracking-wider ${metrics?.institutional_sponsorship?.status?.includes('BULLISH') ? 'text-emerald-500' :
              metrics?.institutional_sponsorship?.status?.includes('BEARISH') ? 'text-rose-500' :
                metrics?.institutional_sponsorship?.status === 'CONSOLIDATION' ? 'text-accent' : 'text-muted'
              }`}>
              {metrics?.institutional_sponsorship?.status || 'INACTIVE'}
            </span>
          </div>

          {/* Open Timeline Modal Button */}
          <button
            type="button"
            onClick={onOpenModal}
            className="w-full py-1.5 px-2.5 rounded-lg bg-card hover:bg-accent/15 border border-card-border hover:border-accent text-muted hover:text-accent font-mono text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Activity size={11} />
            <span>[ VIEW TIMELINE & STATS ]</span>
          </button>

          {metrics?.institutional_sponsorship?.statistical_validation && (() => {
            const statVal = metrics.institutional_sponsorship.statistical_validation;
            const tStat = Math.abs(statVal.t_statistic || 0);
            const pVal = statVal.p_value ?? 1.0;
            const isConsolidation = metrics.institutional_sponsorship.status === 'CONSOLIDATION';

            let tierLabel = statVal.confidence_tier_label || 'REJECTED';
            let tierColor = 'text-rose-500';

            if (isConsolidation) {
              tierLabel = 'CONSOLIDATION';
              tierColor = 'text-accent';
            } else if (statVal.confidence_tier === 'CONFIRMED_95' || (tStat >= 1.96 && pVal < 0.05)) {
              tierLabel = 'CONFIRMED (95%)';
              tierColor = 'text-emerald-400';
            } else if (statVal.confidence_tier === 'MODERATE_90' || (tStat >= 1.65 && pVal <= 0.10)) {
              tierLabel = 'MODERATE (90%)';
              tierColor = 'text-amber-400';
            } else if (statVal.confidence_tier === 'BORDERLINE_85' || (tStat >= 1.44 && pVal <= 0.15)) {
              tierLabel = 'BORDERLINE (85%)';
              tierColor = 'text-sky-400';
            } else {
              tierLabel = 'REJECTED';
              tierColor = 'text-rose-500';
            }

            return (
              <div className="bg-background/40 p-2 border border-card-border rounded-lg space-y-1">
                <div className="flex justify-between text-[10px] items-center">
                  <span className="text-muted">t-STAT</span>
                  <span className="font-mono font-bold text-foreground">
                    {statVal.t_statistic?.toFixed(4) ?? '0.0000'}
                  </span>
                </div>
                <div className="flex justify-between text-[10px] items-center">
                  <span className="text-muted">p-VALUE</span>
                  <span className="font-mono font-bold text-foreground">
                    {statVal.p_value?.toFixed(4) ?? '1.0000'}
                  </span>
                </div>
                <div className="flex justify-between text-[10px] items-center">
                  <span className="text-muted">OLS CONFIDENCE</span>
                  <span className={`font-mono font-bold ${tierColor}`}>
                    {tierLabel}
                  </span>
                </div>
              </div>
            );
          })()}
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
    setWsInterval,
    structureState,
    themeSettings,
    isAuto30mScanActive,
    toggleAuto30mScan,
    nextScanTimestamp,
    mtfSummary,
  } = useMarketDataContext();

  const [isJsonDrawerOpen, setIsJsonDrawerOpen] = useState(false);
  const [isHudModalOpen, setIsHudModalOpen] = useState(false);
  const [isTradesModalOpen, setIsTradesModalOpen] = useState(false);
  const [isSelfCorrectionModalOpen, setIsSelfCorrectionModalOpen] = useState(false);
  const [isOrderFlowModalOpen, setIsOrderFlowModalOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  // Inner cards collapsible states (all open by default)
  const [cardOpenState, setCardOpenState] = useState({
    time: true,
    valueArea: true,
    structure: true,
    smtGate: true,
    liquidity: true,
    orderFlow: true,
    restingMagnets: true,
    twoStageRisk: true,
    synthesis: true,
  });

  const toggleCard = (card: keyof typeof cardOpenState) => {
    setCardOpenState((prev) => ({ ...prev, [card]: !prev[card] }));
  };

  const metrics = data?.ipda_metrics;
  const targetStatus = metrics?.target_status || '';

  // ── AMT Value Area Calculation ──
  const candles15m = data?.data_payload?.candles_15m || [];
  const { vah, val, poc } = useMemo(() => calculateValueArea(candles15m), [candles15m]);

  // ── Parse AI analysis response ──
  let parsedAiResponse: any = null;
  let hudData: any = null;
  let aiNote: { title: string, text: string } | null = null;
  let tvAlerts: any[] = [];

  if (aiAnalysis) {
    try {
      parsedAiResponse = safeParseAiJson(aiAnalysis);

      if (parsedAiResponse?.hud_display) {
        hudData = { ...parsedAiResponse.hud_display };
        const noteKey = Object.keys(hudData).find(k => k.toLowerCase().includes('note'));
        if (noteKey) {
          aiNote = { title: noteKey, text: hudData[noteKey] as string };
          delete hudData[noteKey];
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
          STAGE_1_SL: fmtP(sopRp?.stage1_sl ?? sopRp?.invalidation ?? nextSt?.invalidation_level),
          STAGE_2_SL: sopRp?.stage2_sl ? String(sopRp.stage2_sl) : 'M15 HL post-TP1',
          TP1: fmtP(sopRp?.tp1),
          TP2: fmtP(sopRp?.tp2 ?? nextSt?.target_level),
          PRIMARY_TARGET: fmtP(parsedAiResponse.primary_target ?? sopRp?.tp2 ?? nextSt?.target_level)
        };
        const narrativeText = parsedAiResponse.narrative_summary || parsedAiResponse.narrative || parsedAiResponse.sop_report?.trade_narrative || '';
        if (narrativeText) {
          aiNote = { title: '💡 Institutional Synthesis Narrative', text: narrativeText };
        }
      }

      if (Array.isArray(parsedAiResponse?.tradingview_alerts)) {
        tvAlerts = parsedAiResponse.tradingview_alerts;
      }
    } catch (e) {
      console.error('[HUD] Failed to parse AI Analysis JSON:', e);
    }
  }

  const orderFlow = metrics?.order_flow_engine;
  const magnets = metrics?.historical_magnets;
  const targets = metrics?.projected_targets;

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
  const londonHigh = metrics?.macro_levels?.london_high;
  const londonLow = metrics?.macro_levels?.london_low;

  // Macro Trend & SMT Gatekeeper logic
  const macroTrend = structureState?.currentTrend || data?.ipda_metrics?.current_trend || 'UNSET';
  const smtStatusRaw = parsedAiResponse?.sop_report?.smt_status || orderFlow?.smart_money_sentiment?.smart_money_divergence || 'NEUTRAL';
  const isBullishSMT = String(smtStatusRaw).toUpperCase().includes('BULLISH');
  const isBearishSMT = String(smtStatusRaw).toUpperCase().includes('BEARISH');

  let htfVetoStatus = '🟢 AUTHORIZED';
  let htfVetoColor = 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30';
  if (macroTrend === 'BEARISH' && isBullishSMT) {
    htfVetoStatus = '🚫 COUNTER-TREND LONG VETOED';
    htfVetoColor = 'text-rose-500 bg-rose-500/10 border-rose-500/30';
  } else if (macroTrend === 'BULLISH' && isBearishSMT) {
    htfVetoStatus = '🚫 COUNTER-TREND SHORT VETOED';
    htfVetoColor = 'text-rose-500 bg-rose-500/10 border-rose-500/30';
  }

  return (
    <>
      {/* Mobile overlay backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[60] bg-background/80 backdrop-blur-md transition-opacity duration-300 lg:hidden ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Vertically Centered Desktop Sidebar Toggle Tab Handle */}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`
            hidden lg:flex fixed top-1/2 -translate-y-1/2 z-30
            bg-card/95 border border-card-border hover:border-accent text-muted hover:text-accent
            w-5 h-14 rounded-l-xl shadow-[0_0_20px_rgba(0,0,0,0.5)] transition-all duration-300 cursor-pointer
            items-center justify-center group select-none
            ${isCollapsed ? 'right-0 border-r-0 shadow-[0_0_15px_rgba(168,85,247,0.25)]' : 'right-80 border-r-0'}
          `}
          title={isCollapsed ? 'Expand Telemetry Sidebar' : 'Collapse Sidebar (Full Width Chart)'}
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
          fixed top-0 right-0 z-[70] h-full w-80 max-w-[90vw]
          bg-card/95 border-l border-card-border flex flex-col shadow-2xl
          transition-all duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
          lg:z-auto lg:static lg:translate-x-0 lg:flex lg:shrink-0 lg:shadow-none
          ${isCollapsed ? 'lg:w-0 lg:border-l-0 lg:overflow-hidden lg:pointer-events-none' : 'lg:w-80 lg:opacity-100'}
        `}
      >
        <div className="flex flex-col h-full overflow-hidden relative">

          {/* Header */}
          <div className="p-4 border-b border-card-border flex items-center justify-between shrink-0 bg-card/45">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-accent" />
              <h2 className="text-xs font-black uppercase tracking-[0.2em] text-foreground">Quant Telemetry</h2>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Desktop Sidebar Collapse Arrow Button */}
              {onToggleCollapse && (
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  className="hidden lg:flex p-1.5 rounded-full text-muted hover:text-foreground hover:bg-card border border-card-border hover:border-accent transition-all cursor-pointer items-center justify-center shrink-0"
                  title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
                >
                  <ChevronRight size={14} />
                </button>
              )}

              {/* Database Drawer Trigger Icon */}
              <button
                onClick={() => setIsJsonDrawerOpen(!isJsonDrawerOpen)}
                className={`p-1.5 rounded-full transition-colors flex items-center justify-center shrink-0 cursor-pointer ${isJsonDrawerOpen ? 'bg-accent/15 text-accent border border-accent/35' : 'text-muted hover:text-foreground hover:bg-card border border-transparent'
                  }`}
                title="Toggle JSON Data Stream"
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

            {/* Multi-Timeframe Status Radar */}
            <MTFStatusRadar
              mtfSummary={mtfSummary}
              activeInterval={wsInterval}
              onSelectInterval={setWsInterval as any}
            />

            {/* Card 1: Time Killzones */}
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

                  <div className="bg-background/40 border border-card-border p-2 mt-2 space-y-1.5 rounded-lg select-none">
                    <div className="flex justify-between items-center text-[10px] lg:text-[11px]">
                      <span className="text-muted font-bold uppercase tracking-wider">LONDON (0-90m)</span>
                      <span className="text-foreground font-mono font-bold">02:00 - 05:00 EST</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] lg:text-[11px]">
                      <span className="text-muted font-bold uppercase tracking-wider">NY AM (0-90m)</span>
                      <span className="text-foreground font-mono font-bold">08:00 - 11:00 EST</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] lg:text-[11px]">
                      <span className="text-rose-400 font-bold uppercase tracking-wider">DEAD_ZONE (PAUSE)</span>
                      <span className="text-rose-400 font-mono font-bold">12:00 - 13:30 EST</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Card 2: AMT Value Area Matrix (NEW Institutional Synthesis Widget) */}
            <ValueAreaCard
              vah={vah}
              val={val}
              poc={poc}
              formatPrice={formatPrice}
              isOpen={cardOpenState.valueArea}
              onToggle={() => toggleCard('valueArea')}
            />

            {/* Card 3: Market Structure Matrix */}
            <div className="glass-panel p-4 space-y-3.5 relative overflow-hidden group">
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
                    const internalTrend = structureState?.internalTrend || data?.ipda_metrics?.internal_context?.trend || 'UNSET';
                    if (macroTrend === 'UNSET' || internalTrend === 'UNSET') return null;
                    const isAligned = macroTrend === internalTrend;
                    return (
                      <span
                        className={`px-1.5 py-0.5 text-[8px] font-black rounded border tracking-widest uppercase ${isAligned
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                          : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                          }`}
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
                  {/* Macro Depth */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-muted-foreground/80">
                      <span>Macro Trend</span>
                      {macroTrend === 'BULLISH' ? (
                        <span className="text-[11px] font-black text-emerald-500">🟢 BULLISH</span>
                      ) : macroTrend === 'BEARISH' ? (
                        <span className="text-[11px] font-black text-rose-500">🔴 BEARISH</span>
                      ) : (
                        <span className="text-[11px] font-black text-muted">⚪ UNSET</span>
                      )}
                    </div>

                    {(() => {
                      const range = structureState?.dealingRange || data?.ipda_metrics?.full_structure_map?.dealingRange;
                      if (!range) return null;
                      return (
                        <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-1.5 text-[10px]">
                          <div className="flex justify-between items-center">
                            <span className="text-muted uppercase font-bold">Dealing Range</span>
                            <span className="font-mono font-bold text-foreground">{formatPrice(range.low)} - {formatPrice(range.high)}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted uppercase font-bold">Equilibrium (EQ)</span>
                            <span className="font-mono font-bold text-accent">{formatPrice(range.equilibrium)}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Multi-Scale Swing Telemetry (Integrated from Matrix Drawer) */}
                  {(() => {
                    const swings = structureState?.swings || data?.ipda_metrics?.full_structure_map?.swings || [];
                    const majorCount = swings.filter((s: any) => s.grade === 'MAJOR').length;
                    const innerCount = swings.filter((s: any) => s.grade === 'INNER').length;
                    const mssConfirmed = structureState?.market_structure_shift || data?.ipda_metrics?.market_structure_shift || false;

                    return (
                      <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-1.5 text-[10px]">
                        <div className="flex justify-between items-center">
                          <span className="text-muted uppercase font-bold">Shift Status (MSS)</span>
                          <span className={`font-black uppercase ${mssConfirmed ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {mssConfirmed ? 'CONFIRMED ⚡' : 'PENDING / NONE'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center border-t border-card-border/30 pt-1">
                          <span className="text-muted uppercase font-bold">Swings (Maj / Inn)</span>
                          <span className="font-mono font-bold text-foreground">{majorCount} MAJ / {innerCount} INN</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Card 4: BTC SMT Gatekeeper (NEW Institutional Synthesis Widget) */}
            <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
              <div
                onClick={() => toggleCard('smtGate')}
                className="flex items-center justify-between cursor-pointer select-none group-hover:text-accent transition-colors"
              >
                <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] lg:text-xs tracking-widest group-hover:text-accent">
                  <Zap size={12} className="text-accent" />
                  <span>BTC SMT Gatekeeper</span>
                </div>
                <button type="button" className="text-muted hover:text-foreground transition-colors p-0.5">
                  {cardOpenState.smtGate ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </div>

              {cardOpenState.smtGate && (
                <div className="space-y-2.5 animate-[fade-in_0.15s_ease-out]">
                  <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-1.5">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-muted uppercase font-bold">SMT Divergence</span>
                      <span className={`font-mono text-[10px] font-bold ${isBullishSMT ? 'text-emerald-400' : isBearishSMT ? 'text-rose-400' : 'text-muted'}`}>
                        {smtStatusRaw}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] border-t border-card-border/30 pt-1.5">
                      <span className="text-muted uppercase font-bold">HTF Trend Filter</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase border ${htfVetoColor}`}>
                        {htfVetoStatus}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Card 5: Liquidity Pools & Macro Context */}
            <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
              <div
                onClick={() => toggleCard('liquidity')}
                className="flex items-center justify-between cursor-pointer select-none group-hover:text-accent transition-colors"
              >
                <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] lg:text-xs tracking-widest group-hover:text-accent">
                  <Magnet size={12} className="text-accent" />
                  <span>Session Liquidity</span>
                </div>
                <button type="button" className="text-muted hover:text-foreground transition-colors p-0.5">
                  {cardOpenState.liquidity ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </div>

              {cardOpenState.liquidity && (
                <div className="space-y-2.5 animate-[fade-in_0.15s_ease-out]">
                  {/* PDH / PDL */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-background/40 p-2.5 border border-card-border rounded-lg">
                      <span className="text-[10px] text-muted block mb-0.5 uppercase font-bold tracking-wider">Prev Day High (PDH)</span>
                      <span className="text-sm font-mono font-bold text-foreground">{formatPrice(metrics?.macro_levels?.pdh)}</span>
                    </div>
                    <div className="bg-background/40 p-2.5 border border-card-border rounded-lg">
                      <span className="text-[10px] text-muted block mb-0.5 uppercase font-bold tracking-wider">Prev Day Low (PDL)</span>
                      <span className="text-sm font-mono font-bold text-foreground">{formatPrice(metrics?.macro_levels?.pdl)}</span>
                    </div>
                  </div>

                  {/* London Session High / Low */}
                  {londonHigh && (
                    <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-1.5">
                      <span className="text-[9px] text-accent uppercase font-black tracking-wider block">London Session Pools</span>
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-muted uppercase font-bold">London High (LH)</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`font-mono font-bold ${isLondonHighSwept ? 'text-rose-500 line-through opacity-60' : 'text-foreground'}`}>
                            {formatPrice(londonHigh)}
                          </span>
                          {isLondonHighSwept && <span className="px-1 py-0.5 bg-rose-500/10 text-rose-500 text-[8px] font-black rounded-sm border border-rose-500/20">SWEPT 🧹</span>}
                        </div>
                      </div>
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-muted uppercase font-bold">London Low (LL)</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`font-mono font-bold ${isLondonLowSwept ? 'text-emerald-500 line-through opacity-60' : 'text-foreground'}`}>
                            {formatPrice(londonLow)}
                          </span>
                          {isLondonLowSwept && <span className="px-1 py-0.5 bg-emerald-500/10 text-emerald-500 text-[8px] font-black rounded-sm border border-emerald-500/20">SWEPT 🧹</span>}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Asian Session High / Low */}
                  {asianHigh && (
                    <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-1.5">
                      <span className="text-[9px] text-muted uppercase font-black tracking-wider block">Asian Session Pools</span>
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-muted uppercase font-bold">Asian High</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`font-mono font-bold ${isAsianHighSwept ? 'text-rose-500 line-through opacity-60' : 'text-foreground'}`}>
                            {formatPrice(asianHigh)}
                          </span>
                          {isAsianHighSwept && <span className="px-1 py-0.5 bg-rose-500/10 text-rose-500 text-[8px] font-black rounded-sm border border-rose-500/20">SWEPT 🧹</span>}
                        </div>
                      </div>
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-muted uppercase font-bold">Asian Low</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`font-mono font-bold ${isAsianLowSwept ? 'text-emerald-500 line-through opacity-60' : 'text-foreground'}`}>
                            {formatPrice(asianLow)}
                          </span>
                          {isAsianLowSwept && <span className="px-1 py-0.5 bg-emerald-500/10 text-emerald-500 text-[8px] font-black rounded-sm border border-emerald-500/20">SWEPT 🧹</span>}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Historical HTF Imbalances (Integrated from Drawer) */}
                  {magnets && (
                    <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-1.5 text-[10px]">
                      <span className="text-[9px] text-muted uppercase font-black tracking-wider block">Historical HTF Magnets</span>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex justify-between">
                          <span className="text-muted">Weekly wH:</span>
                          <span className="font-mono font-bold text-foreground">{formatPrice(magnets.nearest_weekly_high)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted">Weekly wL:</span>
                          <span className="font-mono font-bold text-foreground">{formatPrice(magnets.nearest_weekly_low)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Asian Range Standard Deviation Targets (Integrated from Drawer) */}
                  {targets && (
                    <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-1.5 text-[10px]">
                      <span className="text-[9px] text-muted uppercase font-black tracking-wider block">Asian Range Projections (SD)</span>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1 text-emerald-400 font-mono">
                          <div className="flex justify-between text-[9px]"><span>+1.5 SD:</span><span>{formatPrice(targets.upward_dev_1_5)}</span></div>
                          <div className="flex justify-between text-[9px]"><span>+2.0 SD:</span><span>{formatPrice(targets.upward_dev_2_0)}</span></div>
                        </div>
                        <div className="space-y-1 text-rose-400 font-mono">
                          <div className="flex justify-between text-[9px]"><span>-1.5 SD:</span><span>{formatPrice(targets.downward_dev_1_5)}</span></div>
                          <div className="flex justify-between text-[9px]"><span>-2.0 SD:</span><span>{formatPrice(targets.downward_dev_2_0)}</span></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Card 6: Order Flow Pulse & State Tracker */}
            <OrderFlowPulseCard
              orderFlow={orderFlow}
              metrics={metrics}
              isOpen={cardOpenState.orderFlow}
              onToggle={() => toggleCard('orderFlow')}
              onOpenModal={() => setIsOrderFlowModalOpen(true)}
            />

            {/* Card 7: Resting Liquidity Pools */}
            <RestingMagnetsCard orderFlow={orderFlow} />

            {/* Card 8: Two-Stage Trailing Stop Monitor (NEW Institutional Synthesis Widget) */}
            <div className="glass-panel p-4 space-y-3 relative overflow-hidden group">
              <div
                onClick={() => toggleCard('twoStageRisk')}
                className="flex items-center justify-between cursor-pointer select-none group-hover:text-accent transition-colors"
              >
                <div className="flex items-center gap-2 text-muted uppercase font-bold text-[11px] lg:text-xs tracking-widest group-hover:text-accent">
                  <Shield size={12} className="text-accent" />
                  <span>Two-Stage Trailing Stop</span>
                </div>
                <button type="button" className="text-muted hover:text-foreground transition-colors p-0.5">
                  {cardOpenState.twoStageRisk ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </div>

              {cardOpenState.twoStageRisk && (
                <div className="space-y-2 animate-[fade-in_0.15s_ease-out] text-[10px]">
                  <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-muted uppercase font-bold">Stage 1 (In-Flight)</span>
                      <span className="font-mono font-bold text-amber-400">Anchored Base SL</span>
                    </div>
                    <p className="text-[9px] text-muted leading-tight">
                      Prohibits trailing to Internal Range Liquidity / micro-swings before TP1.
                    </p>
                  </div>
                  <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-muted uppercase font-bold">Stage 2 (Runner Phase)</span>
                      <span className="font-mono font-bold text-emerald-400">M15 Structural HL</span>
                    </div>
                    <p className="text-[9px] text-muted leading-tight">
                      70% volume banked at TP1 (ERL) → SL trailed to confirmed M15 HL/LH.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Card 9: AI Synthesis Console */}
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
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Institutional SOP Engine Ready. Awaiting Live Payload Injection.</p>
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-card/45 border-t border-card-border shrink-0 flex flex-col gap-2">
                    {/* 30m Auto-Scan Toggle & Countdown */}
                    <AutoScanCountdown
                      nextScanTimestamp={nextScanTimestamp}
                      isAutoScanActive={isAuto30mScanActive}
                      onToggle={toggleAuto30mScan}
                    />

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

          {/* Footer Branding */}
          <div className="p-3 border-t border-card-border bg-card/45 shrink-0 select-none text-center">
            <span className="text-[8px] font-black text-muted-foreground tracking-widest uppercase">
              Flow-State Quant Engine V{SYSTEM_VERSION} (SOP V2.0.0)
            </span>
          </div>

          {/* ── JSON LOGS SLIDE-OUT DRAWER ─────────────────────────────────── */}
          <div
            className={`
              absolute top-0 bottom-0 z-[80] w-80 max-w-full bg-card border-r border-card-border shadow-2xl flex flex-col
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
              <div className="bg-background/60 rounded-xl p-4 border border-card-border">
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
                  title="Download Sliced V14.0 JSON"
                >
                  <Download size={12} />
                  <span className="text-[9px] font-black uppercase tracking-wider">DL V14.0 JSON</span>
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

      {/* Order Flow State Timeline Modal */}
      <OrderFlowTimelineModal
        isOpen={isOrderFlowModalOpen}
        onClose={() => setIsOrderFlowModalOpen(false)}
        timeline={orderFlow?.state_timeline}
        symbol="ETHUSDC.p"
      />
    </>
  );
});

export default Sidebar;
