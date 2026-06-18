'use client';

import React, { memo, useMemo } from 'react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';

interface DashboardMetricsProps {
  masterBias: string;
  pricing: string;
  targetStatus: string;
  isLive?: boolean;
}

// 1. Master Bias Card - Memoized, only re-renders when masterBias changes
const MasterBiasCard = memo(function MasterBiasCard({ masterBias }: { masterBias: string }) {
  const isBullish = masterBias === 'BULLISH';
  const isBearish = masterBias === 'BEARISH';

  return (
    <div className={`glass-panel p-4 lg:p-5 min-h-[105px] flex flex-col justify-between relative overflow-hidden group select-none transition-all duration-300 ${
      isBullish ? 'shadow-[inset_0_0_20px_rgba(16,185,129,0.04)] border-emerald-500/20' :
      isBearish ? 'shadow-[inset_0_0_20px_rgba(244,63,94,0.04)] border-rose-500/20' :
      'border-card-border'
    }`}>
      <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-all duration-300 ${
        isBullish ? 'bg-emerald-500/10 dark:bg-emerald-500/20' :
        isBearish ? 'bg-rose-500/10 dark:bg-rose-500/20' :
        'bg-accent/5'
      }`} />
      <span className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-zinc-400">Master Bias</span>
      <span className={`text-2xl lg:text-3xl font-black mt-2 leading-none transition-colors duration-300 ${
        isBullish ? 'text-emerald-500 dark:text-emerald-400' :
        isBearish ? 'text-rose-500 dark:text-rose-400' :
        'text-foreground'
      }`}>
        {masterBias}
      </span>
    </div>
  );
});

// 2. Premium / Discount Card - Subscribes to live price if isLive is true
const PremiumDiscountCard = memo(function PremiumDiscountCard({
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

  const pricing = useMemo(() => {
    if (isLive && livePrice && equilibrium) {
      return livePrice > Number(equilibrium) ? 'PREMIUM' : 'DISCOUNT';
    }
    return staticPricing;
  }, [isLive, livePrice, equilibrium, staticPricing]);

  return (
    <div className={`glass-panel p-4 lg:p-5 min-h-[105px] flex flex-col justify-between relative overflow-hidden group select-none transition-all duration-300 ${
      pricing === 'DISCOUNT' ? 'shadow-[inset_0_0_20px_rgba(16,185,129,0.04)] border-emerald-500/20' :
      pricing === 'PREMIUM' ? 'shadow-[inset_0_0_20px_rgba(244,63,94,0.04)] border-rose-500/20' :
      'border-card-border'
    }`}>
      <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-all duration-300 ${
        pricing === 'DISCOUNT' ? 'bg-emerald-500/10 dark:bg-emerald-500/20' :
        pricing === 'PREMIUM' ? 'bg-rose-500/10 dark:bg-rose-500/20' :
        'bg-accent/5'
      }`} />
      <span className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-zinc-400">Range Context</span>
      <span className={`text-2xl lg:text-3xl font-black mt-2 leading-none transition-colors duration-300 ${
        pricing === 'DISCOUNT' ? 'text-emerald-500 dark:text-emerald-400' :
        pricing === 'PREMIUM' ? 'text-rose-500 dark:text-rose-400' :
        'text-foreground'
      }`}>
        {pricing}
      </span>
    </div>
  );
});

// 3. Target Status Card - Memoized, only re-renders when targetStatus changes
const TargetStatusCard = memo(function TargetStatusCard({ targetStatus }: { targetStatus: string }) {
  return (
    <div className={`glass-panel p-4 lg:p-5 min-h-[105px] flex flex-col justify-between relative overflow-hidden group select-none transition-all duration-300 ${
      targetStatus === 'EXHAUSTED' ? 'shadow-[inset_0_0_20px_rgba(16,185,129,0.04)] border-emerald-500/20' :
      'border-card-border'
    }`}>
      <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-2xl pointer-events-none group-hover:scale-125 transition-all duration-300 ${
        targetStatus === 'EXHAUSTED' ? 'bg-emerald-500/10 dark:bg-emerald-500/20' :
        'bg-accent/5'
      }`} />
      <span className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-zinc-400">Target Status (DOL)</span>
      <span className={`text-lg lg:text-xl font-black mt-2 leading-none transition-colors duration-300 ${
        targetStatus === 'EXHAUSTED' ? 'text-emerald-500 dark:text-emerald-400' : 'text-accent'
      }`}>
        {targetStatus}
      </span>
    </div>
  );
});

export default function DashboardMetrics({ masterBias, pricing, targetStatus, isLive = false }: DashboardMetricsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-4 lg:px-6 py-4 shrink-0 relative z-10">
      <MasterBiasCard masterBias={masterBias} />
      <PremiumDiscountCard staticPricing={pricing} isLive={isLive} />
      <TargetStatusCard targetStatus={targetStatus} />
    </div>
  );
}
