'use client';

import React, { memo, useMemo } from 'react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import { Target, Activity, Compass, Zap, Shield } from 'lucide-react';
import { safeParseAiJson } from '@/lib/aiJsonParser';

interface DashboardMetricsProps {
  masterBias: string;
  pricing: string;
  targetStatus: string;
  isLive?: boolean;
}

// 1. Master Bias Card - Synthesizes AI & Algorithmic Structure Trend
const MasterBiasCard = memo(function MasterBiasCard({ masterBias }: { masterBias: string }) {
  const { structureState, data } = useMarketDataContext();
  const macroTrend = structureState?.currentTrend || data?.ipda_metrics?.current_trend || 'UNSET';

  const isBullish = masterBias === 'BULLISH';
  const isBearish = masterBias === 'BEARISH';
  const isAligned = (isBullish && macroTrend === 'BULLISH') || (isBearish && macroTrend === 'BEARISH');

  return (
    <div className={`flex items-center justify-between px-3 py-1.5 rounded-lg border backdrop-blur-md transition-all duration-200 ${
      isBullish ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
      isBearish ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' :
      'bg-card/40 border-card-border text-foreground'
    }`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <Compass className={`w-3 h-3 shrink-0 ${isBullish ? 'text-emerald-400' : isBearish ? 'text-rose-400' : 'text-muted'}`} />
        <span className="text-[9px] font-black uppercase tracking-wider text-muted truncate">Master Bias</span>
        {macroTrend !== 'UNSET' && (
          <span className={`text-[8px] px-1 py-0.2 rounded font-black tracking-widest uppercase border ${
            isAligned ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
          }`}>
            {isAligned ? 'ALIGNED' : 'RETRACING'}
          </span>
        )}
      </div>
      <span className={`text-xs font-black uppercase tracking-wide ml-2 font-mono ${
        isBullish ? 'text-emerald-400' : isBearish ? 'text-rose-400' : 'text-foreground'
      }`}>
        {masterBias}
      </span>
    </div>
  );
});

// 2. AMT Value Area & Range Context Card
const ValueAreaRangeCard = memo(function ValueAreaRangeCard({
  staticPricing,
  isLive = false
}: {
  staticPricing: string;
  isLive?: boolean;
}) {
  const staticContext = useMarketDataContext();
  const liveContext = isLive ? useMarketDataLiveContext() : null;

  const livePrice = liveContext?.livePrice ?? null;
  const equilibrium = staticContext?.data?.ipda_metrics?.pricing_context?.local_dealing_range?.equilibrium ?? null;
  const candles = staticContext?.data?.data_payload?.candles_15m || [];

  // Approximate Value Area from candles
  const { vah, val } = useMemo(() => {
    if (!candles || candles.length === 0) return { vah: null, val: null };
    const slice = candles.slice(-48);
    let minP = Infinity, maxP = -Infinity;
    slice.forEach(c => {
      if (c.h && c.h > maxP) maxP = c.h;
      if (c.l && c.l < minP && c.l > 0) minP = c.l;
    });
    if (minP === Infinity || maxP === -Infinity) return { vah: null, val: null };
    const step = (maxP - minP) / 20;
    const vahCalc = maxP - (step * 5);
    const valCalc = minP + (step * 5);
    return { vah: vahCalc, val: valCalc };
  }, [candles]);

  const { statusLabel, colorClass } = useMemo(() => {
    if (livePrice && val && livePrice <= val) {
      return { statusLabel: 'DISCOUNT AUCTION (< VAL)', colorClass: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' };
    }
    if (livePrice && vah && livePrice >= vah) {
      return { statusLabel: 'PREMIUM AUCTION (> VAH)', colorClass: 'bg-rose-500/10 border-rose-500/30 text-rose-400' };
    }
    if (isLive && livePrice && equilibrium) {
      const isDisc = livePrice <= Number(equilibrium);
      return {
        statusLabel: isDisc ? 'DISCOUNT VALUE' : 'PREMIUM VALUE',
        colorClass: isDisc ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
      };
    }
    return {
      statusLabel: staticPricing || 'SCANNING VALUE',
      colorClass: 'bg-card/40 border-card-border text-amber-400'
    };
  }, [livePrice, val, vah, isLive, equilibrium, staticPricing]);

  return (
    <div className={`flex items-center justify-between px-3 py-1.5 rounded-lg border backdrop-blur-md transition-all duration-200 ${colorClass}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <Activity className="w-3 h-3 shrink-0" />
        <span className="text-[9px] font-black uppercase tracking-wider text-muted truncate">AMT Value Area</span>
      </div>
      <span className="text-xs font-black uppercase tracking-wide ml-2 font-mono truncate">
        {statusLabel}
      </span>
    </div>
  );
});

// 3. SMT & Target Status (DOL) Card
const TargetStatusCard = memo(function TargetStatusCard({ targetStatus }: { targetStatus: string }) {
  const { aiAnalysis } = useMarketDataContext();
  
  const parsedAi = useMemo(() => safeParseAiJson(aiAnalysis), [aiAnalysis]);
  const primaryTarget = parsedAi?.primary_target ?? parsedAi?.sop_report?.htf_dol ?? null;
  const smtStatus = parsedAi?.sop_report?.smt_status ?? null;

  const displayTarget = primaryTarget ? String(primaryTarget).substring(0, 24) : (targetStatus || 'PENDING');

  return (
    <div className="flex items-center justify-between px-3 py-1.5 rounded-lg border border-card-border bg-card/40 backdrop-blur-md transition-all duration-200 min-w-0">
      <div className="flex items-center gap-1.5 shrink-0">
        <Target className="w-3 h-3 text-accent shrink-0" />
        <span className="text-[9px] font-black uppercase tracking-wider text-muted truncate">Target DOL</span>
        {smtStatus && (
          <span className="text-[8px] px-1 py-0.2 rounded font-black tracking-wider uppercase bg-accent/15 border border-accent/30 text-accent" title={smtStatus}>
            SMT GATE
          </span>
        )}
      </div>
      <span className="text-[11px] font-black uppercase tracking-tight text-accent truncate ml-2 font-mono" title={displayTarget}>
        {displayTarget}
      </span>
    </div>
  );
});

export default function DashboardMetrics({ masterBias, pricing, targetStatus, isLive = false }: DashboardMetricsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 px-4 lg:px-6 py-1.5 shrink-0 relative z-10">
      <MasterBiasCard masterBias={masterBias} />
      <ValueAreaRangeCard staticPricing={pricing} isLive={isLive} />
      <TargetStatusCard targetStatus={targetStatus} />
    </div>
  );
}
