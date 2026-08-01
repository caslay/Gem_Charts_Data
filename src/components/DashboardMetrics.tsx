'use client';

import React, { memo, useMemo } from 'react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import { Target, Activity, Compass } from 'lucide-react';

interface DashboardMetricsProps {
  masterBias: string;
  pricing: string;
  targetStatus: string;
  isLive?: boolean;
}

// 1. Master Bias Card - Compact Minimalist Bar
const MasterBiasCard = memo(function MasterBiasCard({ masterBias }: { masterBias: string }) {
  const isBullish = masterBias === 'BULLISH';
  const isBearish = masterBias === 'BEARISH';

  return (
    <div className={`flex items-center justify-between px-3 py-1.5 rounded-lg border backdrop-blur-md transition-all duration-200 ${
      isBullish ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
      isBearish ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' :
      'bg-card/40 border-card-border text-foreground'
    }`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <Compass className={`w-3 h-3 shrink-0 ${isBullish ? 'text-emerald-400' : isBearish ? 'text-rose-400' : 'text-muted'}`} />
        <span className="text-[9px] font-black uppercase tracking-wider text-muted truncate">Master Bias</span>
      </div>
      <span className={`text-xs font-black uppercase tracking-wide ml-2 font-mono ${
        isBullish ? 'text-emerald-400' : isBearish ? 'text-rose-400' : 'text-foreground'
      }`}>
        {masterBias}
      </span>
    </div>
  );
});

// 2. Premium / Discount Card - Compact Minimalist Bar
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

  const isDiscount = pricing === 'DISCOUNT';
  const isPremium = pricing === 'PREMIUM';

  return (
    <div className={`flex items-center justify-between px-3 py-1.5 rounded-lg border backdrop-blur-md transition-all duration-200 ${
      isDiscount ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
      isPremium ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' :
      'bg-card/40 border-card-border text-amber-400'
    }`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <Activity className={`w-3 h-3 shrink-0 ${isDiscount ? 'text-emerald-400' : isPremium ? 'text-rose-400' : 'text-amber-400'}`} />
        <span className="text-[9px] font-black uppercase tracking-wider text-muted truncate">Range Context</span>
      </div>
      <span className={`text-xs font-black uppercase tracking-wide ml-2 font-mono ${
        isDiscount ? 'text-emerald-400' : isPremium ? 'text-rose-400' : 'text-foreground'
      }`}>
        {pricing}
      </span>
    </div>
  );
});

// 3. Target Status Card - Compact Minimalist Bar
const TargetStatusCard = memo(function TargetStatusCard({ targetStatus }: { targetStatus: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 rounded-lg border border-card-border bg-card/40 backdrop-blur-md transition-all duration-200 min-w-0">
      <div className="flex items-center gap-1.5 shrink-0">
        <Target className="w-3 h-3 text-accent shrink-0" />
        <span className="text-[9px] font-black uppercase tracking-wider text-muted truncate">Target Status (DOL)</span>
      </div>
      <span className="text-[11px] font-black uppercase tracking-tight text-accent truncate ml-2 font-mono" title={targetStatus}>
        {targetStatus}
      </span>
    </div>
  );
});

export default function DashboardMetrics({ masterBias, pricing, targetStatus, isLive = false }: DashboardMetricsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 px-4 lg:px-6 py-1.5 shrink-0 relative z-10">
      <MasterBiasCard masterBias={masterBias} />
      <PremiumDiscountCard staticPricing={pricing} isLive={isLive} />
      <TargetStatusCard targetStatus={targetStatus} />
    </div>
  );
}

