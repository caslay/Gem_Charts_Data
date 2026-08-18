'use client';

import React from 'react';
import { Activity, ShieldCheck, Zap, Compass, TrendingUp, TrendingDown, Target, Layers } from 'lucide-react';
import type { MTFTelemetrySummary, TimeframeTelemetry } from '@/lib/quantEngine/MTFTelemetryEngine';

interface MTFStatusRadarProps {
  mtfSummary?: MTFTelemetrySummary | null;
  activeInterval: string;
  onSelectInterval?: (interval: string) => void;
  className?: string;
}

export const MTFStatusRadar: React.FC<MTFStatusRadarProps> = ({
  mtfSummary,
  activeInterval,
  onSelectInterval,
  className = '',
}) => {
  if (!mtfSummary || !mtfSummary.timeframes) return null;

  const { timeframes, htf_directional_bias, htf_alignment, top_down_confluence_pct, active_macro_dol } = mtfSummary;
  const coreTfs: Array<'5m' | '15m' | '1h'> = ['5m', '15m', '1h'];

  const getTrendBadge = (tfData?: TimeframeTelemetry) => {
    if (!tfData) return <span className="text-muted text-[9px] font-mono">--</span>;
    if (tfData.structure_break === 'MSS') {
      return (
        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 font-mono text-[9px] font-black tracking-wider animate-pulse flex items-center gap-1">
          <Zap size={9} />
          MSS!
        </span>
      );
    }
    if (tfData.trend === 'BULLISH') {
      return (
        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 font-mono text-[9px] font-bold flex items-center gap-1">
          <TrendingUp size={9} />
          BULL
        </span>
      );
    }
    if (tfData.trend === 'BEARISH') {
      return (
        <span className="px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/25 text-rose-400 font-mono text-[9px] font-bold flex items-center gap-1">
          <TrendingDown size={9} />
          BEAR
        </span>
      );
    }
    return <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-muted font-mono text-[9px]">FLAT</span>;
  };

  const getOfBadge = (tfData?: TimeframeTelemetry) => {
    if (!tfData) return null;
    const regime = tfData.order_flow_regime;
    if (regime === 'RISING_WITH_PRICE') {
      return <span className="text-emerald-400 font-mono text-[9px] font-bold">🟢 BUY</span>;
    }
    if (regime === 'RISING_AGAINST_PRICE') {
      return <span className="text-rose-400 font-mono text-[9px] font-bold">🔴 SHORT</span>;
    }
    if (regime === 'FALLING_WITH_PRICE') {
      return <span className="text-sky-400 font-mono text-[9px] font-bold">🔵 LIQ</span>;
    }
    if (regime === 'FALLING_AGAINST_PRICE') {
      return <span className="text-amber-400 font-mono text-[9px] font-bold">⚠️ COV</span>;
    }
    return <span className="text-muted font-mono text-[9px]">FLAT</span>;
  };

  const getOlsBadge = (tfData?: TimeframeTelemetry) => {
    if (!tfData) return null;
    const tier = tfData.ols_tier;
    if (tier === 'CONFIRMED_95') {
      return <span className="px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[8.5px] font-black border border-emerald-500/30">95%</span>;
    }
    if (tier === 'MODERATE_90') {
      return <span className="px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[8.5px] font-black border border-amber-500/30">90%</span>;
    }
    if (tier === 'BORDERLINE_85') {
      return <span className="px-1 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono text-[8.5px] font-black border border-sky-500/30">85%</span>;
    }
    if (tier === 'CONSOLIDATION') {
      return <span className="px-1 py-0.5 rounded bg-accent/20 text-accent font-mono text-[8.5px] font-bold">RNG</span>;
    }
    return <span className="px-1 py-0.5 rounded bg-rose-500/15 text-rose-400 font-mono text-[8.5px] font-bold border border-rose-500/20">REJ</span>;
  };

  return (
    <div className={`glass-panel p-3 relative overflow-hidden group space-y-2.5 ${className}`}>
      {/* Header with Pulse & Confluence Score */}
      <div className="flex items-center justify-between border-b border-card-border pb-2">
        <div className="flex items-center gap-1.5">
          <Compass size={13} className="text-accent animate-spin-slow" />
          <span className="text-foreground font-mono font-bold text-[11px] uppercase tracking-wider">
            MTF Status Radar
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-mono text-muted uppercase">Top-Down:</span>
          <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-black tracking-wider ${
            top_down_confluence_pct >= 70 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
            top_down_confluence_pct >= 40 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
            'bg-rose-500/20 text-rose-400 border border-rose-500/30'
          }`}>
            {top_down_confluence_pct}% {htf_alignment ? 'ALIGNED' : 'SPLIT'}
          </span>
        </div>
      </div>

      {/* Timeframe Matrix Grid */}
      <div className="space-y-1.5">
        {coreTfs.map((tf) => {
          const tfData = timeframes[tf];
          const isActive = activeInterval === tf;

          return (
            <div
              key={tf}
              onClick={() => onSelectInterval?.(tf)}
              className={`flex items-center justify-between p-1.5 rounded-lg border transition-all cursor-pointer ${
                isActive
                  ? 'bg-accent/10 border-accent/40 shadow-sm'
                  : 'bg-card/50 hover:bg-card border-card-border hover:border-accent/30'
              }`}
            >
              {/* Left: Timeframe Button Pill */}
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[10px] font-black px-1.5 py-0.5 rounded uppercase ${
                  isActive ? 'bg-accent text-accent-foreground shadow-xs' : 'bg-background/80 text-muted group-hover:text-foreground'
                }`}>
                  {tf}
                </span>
                {getTrendBadge(tfData)}
              </div>

              {/* Middle: Order Flow & OLS Status */}
              <div className="flex items-center gap-2">
                {getOfBadge(tfData)}
                {getOlsBadge(tfData)}
              </div>

              {/* Right: Active OB & FVG counts */}
              <div className="flex items-center gap-1.5 text-[9px] font-mono text-muted">
                <span title="Active Order Blocks" className="flex items-center gap-0.5 text-foreground/80">
                  <Layers size={9} className="text-accent" />
                  {tfData?.active_ob_count ?? 0}
                </span>
                <span className="text-card-border">|</span>
                <span title="Unmitigated FVGs" className="text-foreground/80">
                  {tfData?.unmitigated_fvg_count ?? 0} FVG
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer: Macro DOL Target Target */}
      {active_macro_dol && (
        <div className="pt-1.5 border-t border-card-border flex items-center justify-between text-[9.5px] font-mono">
          <div className="flex items-center gap-1 text-muted">
            <Target size={11} className={active_macro_dol.type === 'BSL' ? 'text-emerald-400' : 'text-rose-400'} />
            <span>MACRO DOL ({active_macro_dol.timeframe}):</span>
          </div>
          <div className="flex items-center gap-1">
            <span className={`font-bold ${active_macro_dol.type === 'BSL' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {active_macro_dol.type} ${active_macro_dol.price.toFixed(2)}
            </span>
            <span className="text-muted text-[8.5px]">({active_macro_dol.distance_pips} pts)</span>
          </div>
        </div>
      )}
    </div>
  );
};
