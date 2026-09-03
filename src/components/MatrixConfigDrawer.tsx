import React from 'react';
import { X, Activity, ChevronRight, Magnet, Target, Clock, History, TrendingUp } from 'lucide-react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import { SYSTEM_VERSION } from '@/lib/version';

export interface MatrixDataPayload {
  ipda_metrics?: {
    target_status?: string;
    session_ranges?: {
      asian_range?: { high: number | null; low: number | null };
      london_range?: { high: number | null; low: number | null };
    };
    macro_levels?: {
      pdh?: number | null;
      pdl?: number | null;
      asian_high?: number | null;
      asian_low?: number | null;
      london_high?: number | null;
      london_low?: number | null;
    };
    historical_magnets?: {
      nearest_weekly_high?: number | null;
      nearest_weekly_low?: number | null;
      nearest_daily_sibi?: { coordinates: { top: number; bottom: number } } | null;
      nearest_daily_bisi?: { coordinates: { top: number; bottom: number } } | null;
    };
    projected_targets?: {
      upward_dev_1_5?: number | null;
      upward_dev_2_0?: number | null;
      upward_dev_2_5?: number | null;
      downward_dev_1_5?: number | null;
      downward_dev_2_0?: number | null;
      downward_dev_2_5?: number | null;
    };
    pricing_context?: {
      local_dealing_range?: {
        high?: number;
        low?: number;
        equilibrium?: number;
      };
    };
    order_flow_engine?: {
      resting_liquidity_pools?: {
        BSL_Magnets?: number[];
        SSL_Magnets?: number[];
      };
    };
    current_trend?: string;
    market_structure_shift?: boolean;
    full_structure_map?: any;
  };
}

interface MatrixConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  data?: MatrixDataPayload | null;
}

/**
 * MatrixConfigDrawer - Phase 3 (Live Data Binding)
 * Wired to the V8.2 Ultimate Matrix List payload.
 */
const MatrixConfigDrawer: React.FC<MatrixConfigDrawerProps> = ({ isOpen, onClose, data }) => {
  const { livePrice } = useMarketDataLiveContext();
  const { wsInterval, structureState } = useMarketDataContext();

  if (!isOpen) return null;

  const metrics = data?.ipda_metrics;
  const magnets = metrics?.historical_magnets;
  const targets = metrics?.projected_targets;
  const range = metrics?.pricing_context?.local_dealing_range;
  const liquidity = metrics?.order_flow_engine?.resting_liquidity_pools;

  const targetStatus = metrics?.target_status || "";
  const sessionRanges = metrics?.session_ranges;
  const macroLevels = metrics?.macro_levels;

  const isAsianHighSwept = targetStatus.includes("ASIAN_HIGH_SWEPT");
  const isAsianLowSwept = targetStatus.includes("ASIAN_LOW_SWEPT");
  const isLondonHighSwept = targetStatus.includes("LONDON_HIGH_SWEPT");
  const isLondonLowSwept = targetStatus.includes("LONDON_LOW_SWEPT");

  const asianHigh = sessionRanges?.asian_range?.high ?? macroLevels?.asian_high;
  const asianLow = sessionRanges?.asian_range?.low ?? macroLevels?.asian_low;
  const londonHigh = sessionRanges?.london_range?.high ?? macroLevels?.london_high;
  const londonLow = sessionRanges?.london_range?.low ?? macroLevels?.london_low;

  const formatPrice = (price: number | null | undefined) =>
    price != null ? price.toFixed(2) : 'N/A';

  return (
    <>
      {/* Backdrop Overlay */}
      <div
        className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[100] transition-opacity duration-300 ease-in-out"
        onClick={onClose}
      />

      {/* Drawer Container */}
      <div className="fixed top-0 right-0 h-screen w-96 z-[101] bg-background/95 backdrop-blur-xl border-l border-card-border shadow-2xl flex flex-col font-sans overflow-hidden animate-in slide-in-from-right duration-300">

        {/* Drawer Header */}
        <div className="flex items-center justify-between p-4 border-b border-card-border bg-card/50 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <h2 className="text-title text-xs font-bold tracking-[0.15em] uppercase">IPDA MATRIX BASIN (V{SYSTEM_VERSION})</h2>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 bg-emerald-500 animate-pulse rounded-full" />
              <span className="text-[9px] text-emerald-500 font-mono font-bold tracking-tight">LIVE SYNC</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-title transition-colors p-1 group cursor-pointer"
            aria-label="Close drawer"
          >
            <X size={18} className="group-hover:rotate-90 transition-transform duration-200" />
          </button>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-card-border scrollbar-track-transparent">

          {/* Section 1: Temporal Context */}
          <section className="p-5 border-b border-card-border">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={14} className="text-muted" />
              <h3 className="text-[11px] text-muted font-bold uppercase tracking-[0.1em]">Temporal Context</h3>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <span className="text-[9px] text-muted uppercase font-black tracking-widest block mb-1">Local Dealing Range</span>
                <div className="grid grid-cols-3 gap-2">
                  <div className="glass-panel p-2.5 rounded-lg flex flex-col justify-between">
                    <span className="block text-[8px] text-muted font-bold uppercase">HIGH</span>
                    <span className="text-xs font-mono font-semibold text-foreground mt-1">{formatPrice(range?.high)}</span>
                  </div>
                  <div className="glass-panel p-2.5 rounded-lg flex flex-col justify-between">
                    <span className="block text-[8px] text-muted font-bold uppercase">EQ</span>
                    <span className="text-xs font-mono font-semibold text-muted mt-1">{formatPrice(range?.equilibrium)}</span>
                  </div>
                  <div className="glass-panel p-2.5 rounded-lg flex flex-col justify-between">
                    <span className="block text-[8px] text-muted font-bold uppercase">LOW</span>
                    <span className="text-xs font-mono font-semibold text-foreground mt-1">{formatPrice(range?.low)}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 1.2: Stateful Market Structure */}
          <section className="p-5 border-b border-card-border bg-accent/5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={14} className="text-accent animate-pulse" />
              <h3 className="text-[11px] text-accent font-bold uppercase tracking-[0.1em]">
                Market Structure Basin ({wsInterval || '---'})
              </h3>
            </div>
            <div className="space-y-4">
              {/* Core metrics grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="glass-panel p-2.5 rounded-lg flex flex-col justify-between">
                  <span className="block text-[8px] text-muted font-bold uppercase">Trend Bias</span>
                  {(() => {
                    const trend = structureState?.currentTrend || data?.ipda_metrics?.current_trend || 'UNSET';
                    if (trend === 'BULLISH') return <span className="text-xs font-black text-emerald-500 mt-1 uppercase">🟢 BULLISH</span>;
                    if (trend === 'BEARISH') return <span className="text-xs font-black text-rose-500 mt-1 uppercase">🔴 BEARISH</span>;
                    return <span className="text-xs font-black text-muted mt-1 uppercase">⚪ UNSET</span>;
                  })()}
                </div>

                <div className="glass-panel p-2.5 rounded-lg flex flex-col justify-between">
                  <span className="block text-[8px] text-muted font-bold uppercase">Shift Status</span>
                  {(() => {
                    const mssConfirmed = structureState?.market_structure_shift || data?.ipda_metrics?.market_structure_shift || false;
                    const latestMSS = structureState?.latestMSS || data?.ipda_metrics?.full_structure_map?.zigzag?.find((z: any) => z.label === 'MSS') || null;
                    const statusText = latestMSS ? (latestMSS.displacementConfirmed ? 'CONFIRMED' : 'PENDING') : (mssConfirmed ? 'CONFIRMED' : 'NONE');

                    if (statusText === 'CONFIRMED') {
                      return (
                        <span className="text-xs font-black text-emerald-500 mt-1 uppercase tracking-wider">
                          CONFIRMED ⚡
                        </span>
                      );
                    }
                    if (statusText === 'PENDING') {
                      return (
                        <span className="text-xs font-black text-amber-500 mt-1 uppercase tracking-wider animate-pulse">
                          PENDING ⏳
                        </span>
                      );
                    }
                    return <span className="text-xs font-mono font-semibold text-muted mt-1 uppercase">NONE</span>;
                  })()}
                </div>
              </div>

              {/* Swing counters */}
              {(() => {
                const swings = structureState?.swings || data?.ipda_metrics?.full_structure_map?.swings || [];
                const majorCount = swings.filter((s: any) => s.grade === 'MAJOR').length;
                const innerCount = swings.filter((s: any) => s.grade === 'INNER').length;

                return (
                  <div className="bg-background/40 p-2.5 border border-card-border rounded-lg space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted font-medium">Major Swings (Level 2 Multi-Scale)</span>
                      <span className="font-mono font-bold text-foreground">{majorCount}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs border-t border-card-border/30 pt-1.5">
                      <span className="text-muted font-medium">Inner Swings (Level 1 Multi-Scale)</span>
                      <span className="font-mono font-semibold text-accent">{innerCount}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Anchor Swings */}
              {(() => {
                const range = structureState?.dealingRange || data?.ipda_metrics?.full_structure_map?.dealingRange;
                if (!range) return null;

                const formatCairoTime = (timeMs: number | undefined) => {
                  if (!timeMs) return '---';
                  return new Date(timeMs).toLocaleString('en-EG', {
                    timeZone: 'Africa/Cairo',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  }) + ' UTC+3';
                };

                return (
                  <div className="space-y-3">
                    <span className="text-[9px] text-muted uppercase font-black tracking-widest block mb-1">Dealing Range Anchors</span>
                    <div className="glass-panel p-3 space-y-2.5">
                      <div className="flex flex-col gap-0.5 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="text-muted font-semibold uppercase text-[10px]">Anchor High</span>
                          <span className="font-mono font-bold text-foreground">
                            {range.high !== null ? formatPrice(range.high) : 'AWAITING_IDM_SWEEP'}
                          </span>
                        </div>
                        <span className="text-[9.5px] text-muted/70 font-mono text-right">
                          {range.anchor_high_swing?.t ? formatCairoTime(range.anchor_high_swing.t) : 'N/A'}
                        </span>
                      </div>

                      <div className="flex flex-col gap-0.5 text-xs border-t border-card-border/30 pt-2">
                        <div className="flex justify-between items-center">
                          <span className="text-muted font-semibold uppercase text-[10px]">Anchor Low</span>
                          <span className="font-mono font-bold text-foreground">
                            {range.low !== null ? formatPrice(range.low) : 'AWAITING_IDM_SWEEP'}
                          </span>
                        </div>
                        <span className="text-[9.5px] text-muted/70 font-mono text-right">
                          {range.anchor_low_swing?.t ? formatCairoTime(range.anchor_low_swing.t) : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

            </div>
          </section>

          {/* Section 1.5: Session Liquidity Status */}
          <section className="p-5 border-b border-card-border bg-card/10">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={14} className="text-muted" />
              <h3 className="text-[11px] text-muted font-bold uppercase tracking-[0.1em]">Session Liquidity</h3>
            </div>
            <div className="space-y-4">
              {/* Asian Session */}
              <div className="space-y-3">
                <span className="text-[10px] text-muted font-bold uppercase tracking-tight border-l-2 border-accent/50 pl-2 block">Asian Range</span>
                <div className="glass-panel p-3 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-sans font-medium text-muted">Range High:</span>
                    <span className={`font-mono font-bold ${isAsianHighSwept ? "text-rose-500" : "text-foreground"}`}>
                      {formatPrice(asianHigh)} {isAsianHighSwept && <span className="text-[9px] font-sans font-bold bg-rose-500/10 border border-rose-500/20 px-1 py-0.5 ml-1 rounded">PURGED 🧹</span>}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs border-t border-card-border/30 pt-2">
                    <span className="font-sans font-medium text-muted">Range Low:</span>
                    <span className={`font-mono font-bold ${isAsianLowSwept ? "text-emerald-500" : "text-foreground"}`}>
                      {formatPrice(asianLow)} {isAsianLowSwept && <span className="text-[9px] font-sans font-bold bg-emerald-500/10 border border-emerald-500/20 px-1 py-0.5 ml-1 rounded">PURGED 🧹</span>}
                    </span>
                  </div>
                </div>
              </div>

              {/* London Session */}
              <div className="space-y-3">
                <span className="text-[10px] text-muted font-bold uppercase tracking-tight border-l-2 border-accent/50 pl-2 block">London Range</span>
                <div className="glass-panel p-3 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-sans font-medium text-muted">Range High:</span>
                    <span className={`font-mono font-bold ${isLondonHighSwept ? "text-rose-500" : "text-foreground"}`}>
                      {formatPrice(londonHigh)} {isLondonHighSwept && <span className="text-[9px] font-sans font-bold bg-rose-500/10 border border-rose-500/20 px-1 py-0.5 ml-1 rounded">PURGED 🧹</span>}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs border-t border-card-border/30 pt-2">
                    <span className="font-sans font-medium text-muted">Range Low:</span>
                    <span className={`font-mono font-bold ${isLondonLowSwept ? "text-emerald-500" : "text-foreground"}`}>
                      {formatPrice(londonLow)} {isLondonLowSwept && <span className="text-[9px] font-sans font-bold bg-emerald-500/10 border border-emerald-500/20 px-1 py-0.5 ml-1 rounded">PURGED 🧹</span>}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Historical HTF Magnets */}
          <section className="p-5 border-b border-card-border bg-card/20">
            <div className="flex items-center gap-2 mb-4">
              <History size={14} className="text-muted" />
              <h3 className="text-[11px] text-muted font-bold uppercase tracking-[0.1em]">Historical HTF Magnets</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="glass-panel p-3.5 space-y-2">
                <span className="text-[10px] text-muted font-bold uppercase tracking-tight border-l-2 border-accent/50 pl-2 block">Weekly Range</span>
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-muted font-sans">wH</span>
                    <span className="text-foreground font-bold">{formatPrice(magnets?.nearest_weekly_high)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-mono border-t border-card-border/30 pt-1.5">
                    <span className="text-muted font-sans">wL</span>
                    <span className="text-foreground font-bold">{formatPrice(magnets?.nearest_weekly_low)}</span>
                  </div>
                </div>
              </div>
              <div className="glass-panel p-3.5 space-y-2">
                <span className="text-[10px] text-muted font-bold uppercase tracking-tight border-l-2 border-accent/50 pl-2 block">Daily Imbalance</span>
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-muted font-sans">SIBI</span>
                    <span className="text-rose-500 font-bold">
                      {magnets?.nearest_daily_sibi?.coordinates?.bottom ? magnets.nearest_daily_sibi.coordinates.bottom.toFixed(2) : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs font-mono border-t border-card-border/30 pt-1.5">
                    <span className="text-muted font-sans">BISI</span>
                    <span className="text-emerald-500 font-bold">
                      {magnets?.nearest_daily_bisi?.coordinates?.top ? magnets.nearest_daily_bisi.coordinates.top.toFixed(2) : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Projected Targets */}
          <section className="p-5 border-b border-card-border">
            <div className="flex items-center gap-2 mb-4">
              <Target size={14} className="text-muted" />
              <h3 className="text-[11px] text-muted font-bold uppercase tracking-[0.1em]">Asian Range Std Dev</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Upward Projections */}
              <div className="glass-panel p-3.5 space-y-3">
                <div className="flex justify-between items-center text-[9px] font-sans text-emerald-500 uppercase font-black tracking-widest">
                  <span>Bullish</span>
                  <Activity size={10} strokeWidth={3} />
                </div>
                <div className="space-y-2">
                  {[
                    { label: "1.5 SD", price: targets?.upward_dev_1_5 },
                    { label: "2.0 SD", price: targets?.upward_dev_2_0 },
                    { label: "2.5 SD", price: targets?.upward_dev_2_5 }
                  ].map((item) => (
                    <div key={item.label} className="flex justify-between text-xs font-mono group">
                      <span className="text-muted font-sans font-medium transition-colors">{item.label}</span>
                      <span className="text-foreground font-semibold">{formatPrice(item.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Downward Projections */}
              <div className="glass-panel p-3.5 space-y-3">
                <div className="flex justify-between items-center text-[9px] font-sans text-rose-500 uppercase font-black tracking-widest">
                  <span>Bearish</span>
                  <Activity size={10} className="rotate-180" strokeWidth={3} />
                </div>
                <div className="space-y-2">
                  {[
                    { label: "1.5 SD", price: targets?.downward_dev_1_5 },
                    { label: "2.0 SD", price: targets?.downward_dev_2_0 },
                    { label: "2.5 SD", price: targets?.downward_dev_2_5 }
                  ].map((item) => (
                    <div key={item.label} className="flex justify-between text-xs font-mono group">
                      <span className="text-muted font-sans font-medium transition-colors">{item.label}</span>
                      <span className="text-foreground font-semibold">{formatPrice(item.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: Resting Liquidity */}
          <section className="p-5 pb-8">
            <div className="flex items-center gap-2 mb-4">
              <Magnet size={14} className="text-muted" />
              <h3 className="text-[11px] text-muted font-bold uppercase tracking-[0.1em]">Resting Liquidity</h3>
            </div>
            <div className="space-y-6">
              {/* BSL Array */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-emerald-500 uppercase tracking-tighter">BSL Magnet Array</span>
                  <div className="h-px flex-1 mx-3 bg-card-border" />
                  <span className="text-[8px] text-muted font-mono tracking-widest">
                    {liquidity?.BSL_Magnets?.length || 0}-ACTIVE
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(liquidity?.BSL_Magnets || []).length > 0 ? (
                    liquidity?.BSL_Magnets?.map((price, idx) => {
                      const isPurged = livePrice !== null && livePrice >= price;
                      return (
                        <div
                          key={`bsl-${idx}`}
                          className={`flex items-center justify-between glass-panel px-3 py-2 transition-all cursor-pointer group ${
                            isPurged
                              ? "border-dashed border-emerald-500/30 opacity-50 col-span-2 hover:border-emerald-500/50"
                              : "hover:border-emerald-500/30"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <ChevronRight size={10} className={`transition-colors ${isPurged ? 'text-emerald-500' : 'text-muted group-hover:text-emerald-500'}`} />
                            <span className={`text-xs font-mono font-semibold ${isPurged ? 'text-emerald-500 line-through' : 'text-foreground'}`}>
                              {price.toFixed(2)}
                            </span>
                          </div>
                          {isPurged && (
                            <span className="text-[8px] font-sans font-bold bg-emerald-500/10 border border-emerald-500/20 px-1 py-0.5 rounded text-emerald-500 uppercase tracking-widest">
                              PURGED 🧹
                            </span>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <span className="text-[10px] text-muted italic font-mono col-span-2">Scanning for BSL...</span>
                  )}
                </div>
              </div>
              {/* SSL Array */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-rose-500 uppercase tracking-tighter">SSL Magnet Array</span>
                  <div className="h-px flex-1 mx-3 bg-card-border" />
                  <span className="text-[8px] text-muted font-mono tracking-widest">
                    {liquidity?.SSL_Magnets?.length || 0}-ACTIVE
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(liquidity?.SSL_Magnets || []).length > 0 ? (
                    liquidity?.SSL_Magnets?.map((price, idx) => {
                      const isPurged = livePrice !== null && livePrice <= price;
                      return (
                        <div
                          key={`ssl-${idx}`}
                          className={`flex items-center justify-between glass-panel px-3 py-2 transition-all cursor-pointer group ${
                            isPurged
                              ? "border-dashed border-rose-500/30 opacity-50 col-span-2 hover:border-rose-500/50"
                              : "hover:border-rose-500/30"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <ChevronRight size={10} className={`transition-colors ${isPurged ? 'text-rose-500' : 'text-muted group-hover:text-rose-500'}`} />
                            <span className={`text-xs font-mono font-semibold ${isPurged ? 'text-rose-500 line-through' : 'text-foreground'}`}>
                              {price.toFixed(2)}
                            </span>
                          </div>
                          {isPurged && (
                            <span className="text-[8px] font-sans font-bold bg-rose-500/10 border border-rose-500/20 px-1 py-0.5 rounded text-rose-500 uppercase tracking-widest">
                              PURGED 🧹
                            </span>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <span className="text-[10px] text-muted italic font-mono col-span-2">Scanning for SSL...</span>
                  )}
                </div>
              </div>
            </div>
          </section>

        </div>

        {/* Footer Stats Bar */}
        <div className="p-3.5 bg-card/50 border-t border-card-border flex justify-between items-center px-5">
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-muted font-mono uppercase tracking-widest font-semibold">V{SYSTEM_VERSION} (SOP V2.0.0)</span>
            <span className="w-1 h-1 bg-card-border rounded-full" />
            <span className="text-[9px] text-muted font-mono font-semibold">STATUS: {data ? 'CONNECTED' : 'STANDBY'}</span>
          </div>
          <span className="text-[9px] text-muted font-mono font-semibold">IPDA-77-VX</span>
        </div>
      </div>
    </>
  );
};

export default MatrixConfigDrawer;
