import React, { useMemo, useEffect, memo } from 'react';
import { Shield, TrendingUp, AlertTriangle, X, CheckCircle2 } from 'lucide-react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';

interface ManualOrderPanelProps {
  onClose: () => void;
  orderType: 'MARKET' | 'LIMIT' | 'STOP';
  setOrderType: (t: 'MARKET' | 'LIMIT' | 'STOP') => void;
  direction: 'LONG' | 'SHORT';
  setDirection: (d: 'LONG' | 'SHORT') => void;
  riskPct: number;
  setRiskPct: (r: number) => void;
  entryPrice: number | null;
  setEntryPrice: (p: number | null) => void;
  takeProfit: number | null;
  setTakeProfit: (p: number | null) => void;
  stopLoss: number | null;
  setStopLoss: (p: number | null) => void;
  balance: number;
  onSubmit: (livePrice: number | null) => void;
  isSubmitting?: boolean;
}

function ManualOrderPanel({
  onClose,
  orderType,
  setOrderType,
  direction,
  setDirection,
  riskPct,
  setRiskPct,
  entryPrice,
  setEntryPrice,
  takeProfit,
  setTakeProfit,
  stopLoss,
  setStopLoss,
  balance,
  onSubmit,
  isSubmitting = false
}: ManualOrderPanelProps) {
  const { livePrice } = useMarketDataLiveContext();

  // 1. Determine the effective entry price (live price for MARKET orders, custom entry for LIMIT/STOP)
  const effectiveEntryPrice = useMemo(() => {
    return orderType === 'MARKET' ? livePrice : entryPrice;
  }, [orderType, livePrice, entryPrice]);


  
  // Calculate Risk USD
  const riskUsd = useMemo(() => {
    return balance * (riskPct / 100);
  }, [balance, riskPct]);

  // Calculate SL Distance
  const slDistance = useMemo(() => {
    if (effectiveEntryPrice === null || stopLoss === null) return 0;
    return Math.abs(effectiveEntryPrice - stopLoss);
  }, [effectiveEntryPrice, stopLoss]);

  // Calculate Position Size
  const positionSize = useMemo(() => {
    if (slDistance <= 0) return 0;
    return riskUsd / slDistance;
  }, [riskUsd, slDistance]);

  // Calculate Reward Distance
  const rewardDistance = useMemo(() => {
    if (effectiveEntryPrice === null || takeProfit === null) return 0;
    return Math.abs(takeProfit - effectiveEntryPrice);
  }, [effectiveEntryPrice, takeProfit]);

  // Calculate Risk-to-Reward Ratio (RR)
  const riskRewardRatio = useMemo(() => {
    if (slDistance <= 0) return 0;
    return rewardDistance / slDistance;
  }, [rewardDistance, slDistance]);

  // Check if warning banner is needed
  const isRrTooLow = useMemo(() => {
    if (effectiveEntryPrice === null || stopLoss === null || takeProfit === null) return false;
    return riskRewardRatio < 2.0;
  }, [effectiveEntryPrice, stopLoss, takeProfit, riskRewardRatio]);

  const handleRiskChange = (valStr: string) => {
    const val = parseFloat(valStr);
    if (!isNaN(val)) {
      // Clamp between 0.1% and 100%
      setRiskPct(Math.min(100, Math.max(0.1, val)));
    }
  };

  return (
    <div className="absolute top-4 left-4 z-30 w-[340px] glass-panel bg-card/90 border border-card-border p-4.5 rounded-2xl shadow-2xl backdrop-blur-xl animate-[fade-in_0.25s_ease-out] select-none">
      
      {/* Panel Header */}
      <div className="flex items-center justify-between pb-3.5 border-b border-card-border/60">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-500" />
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-foreground">MANUAL ORDER ENTRY</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-full text-slate-500 hover:text-foreground hover:bg-card-border/30 transition-all cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Control Content */}
      <div className="space-y-4 pt-3.5">
        
        {/* Toggle 1: Order Type */}
        <div className="space-y-1.5">
          <label className="text-[9px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Order Type</label>
          <div className="grid grid-cols-3 gap-1 bg-background/50 border border-card-border/60 p-0.5 rounded-xl">
            {(['MARKET', 'LIMIT', 'STOP'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setOrderType(type)}
                className={`py-1.5 text-[10px] font-black tracking-wider rounded-lg transition-all cursor-pointer uppercase ${
                  orderType === type
                    ? 'bg-accent text-accent-foreground shadow-md'
                    : 'text-muted hover:text-foreground hover:bg-card/30'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Toggle 2: Direction choice */}
        <div className="space-y-1.5">
          <label className="text-[9px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Order Direction</label>
          <div className="grid grid-cols-2 gap-1 bg-background/50 border border-card-border/60 p-0.5 rounded-xl">
            <button
              onClick={() => setDirection('LONG')}
              className={`py-1.5 text-[10px] font-black tracking-wider rounded-lg transition-all cursor-pointer uppercase ${
                direction === 'LONG'
                  ? 'bg-emerald-500 text-white shadow-md'
                  : 'text-muted hover:text-foreground hover:bg-card/30'
              }`}
            >
              LONG
            </button>
            <button
              onClick={() => setDirection('SHORT')}
              className={`py-1.5 text-[10px] font-black tracking-wider rounded-lg transition-all cursor-pointer uppercase ${
                direction === 'SHORT'
                  ? 'bg-rose-500 text-white shadow-md'
                  : 'text-muted hover:text-foreground hover:bg-card/30'
              }`}
            >
              SHORT
            </button>
          </div>
        </div>

        {/* Section 3: Risk Parameter */}
        <div className="space-y-1.5">
          <label className="text-[9px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Risk Allocation (%)</label>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="100"
              value={riskPct}
              onChange={(e) => handleRiskChange(e.target.value)}
              className="w-20 bg-background/60 border border-card-border/80 focus:border-accent focus:outline-none px-2.5 py-1.5 text-xs font-mono text-foreground font-black rounded-lg text-center transition-all shadow-sm"
            />
            <div className="flex-1 grid grid-cols-3 gap-1">
              {([0.5, 1.0, 2.5] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRiskPct(r)}
                  className={`py-1.5 text-[9px] font-mono font-black rounded-lg transition-all border cursor-pointer ${
                    riskPct === r
                      ? 'bg-accent/15 border-accent text-accent shadow-inner font-bold'
                      : 'border-card-border/60 hover:border-accent/40 text-muted hover:text-foreground hover:bg-card/20'
                  }`}
                >
                  {r}%
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Section 4: Coordinates prices readout */}
        <div className="grid grid-cols-3 gap-2 bg-background/30 p-2.5 border border-card-border/60 rounded-xl">
          <div className="flex flex-col gap-0.5">
            <span className="text-[8px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-wider">ENTRY PRICE</span>
            <input
              type="number"
              step="0.05"
              disabled={orderType === 'MARKET'}
              value={entryPrice !== null ? entryPrice : ''}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setEntryPrice(isNaN(val) ? null : val);
              }}
              className="w-full bg-background/60 border border-card-border/80 focus:border-accent focus:outline-none px-1.5 py-0.5 text-[11px] font-mono text-foreground font-black rounded-md text-center transition-all disabled:opacity-50"
            />
          </div>
          <div className="flex flex-col gap-0.5 border-l border-card-border/30 pl-2">
            <span className="text-[8px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-wider text-emerald-500">TAKE PROFIT</span>
            <input
              type="number"
              step="0.05"
              value={takeProfit !== null ? takeProfit : ''}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setTakeProfit(isNaN(val) ? null : val);
              }}
              className="w-full bg-background/60 border border-card-border/80 focus:border-accent focus:outline-none px-1.5 py-0.5 text-[11px] font-mono text-emerald-400 font-black rounded-md text-center transition-all"
            />
          </div>
          <div className="flex flex-col gap-0.5 border-l border-card-border/30 pl-2">
            <span className="text-[8px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-wider text-rose-500">STOP LOSS</span>
            <input
              type="number"
              step="0.05"
              value={stopLoss !== null ? stopLoss : ''}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setStopLoss(isNaN(val) ? null : val);
              }}
              className="w-full bg-background/60 border border-card-border/80 focus:border-accent focus:outline-none px-1.5 py-0.5 text-[11px] font-mono text-rose-400 font-black rounded-md text-center transition-all"
            />
          </div>
        </div>

        {/* Section 5: Analytical Badges */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-background/20 p-2 border border-card-border/40 rounded-xl flex flex-col gap-0.5">
            <span className="text-[8px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Position Size</span>
            <span className="text-xs font-mono font-black text-foreground">
              {positionSize > 0 ? positionSize.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '---'}
            </span>
          </div>
          <div className="bg-background/20 p-2 border border-card-border/40 rounded-xl flex flex-col gap-0.5">
            <span className="text-[8px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Risk-Reward (RR)</span>
            <span className={`text-xs font-mono font-black ${isRrTooLow ? 'text-amber-500' : 'text-accent'}`}>
              {riskRewardRatio > 0 ? `${riskRewardRatio.toFixed(2)}x` : '---'}
            </span>
          </div>
          <div className="bg-background/20 p-2 border border-card-border/40 rounded-xl flex flex-col gap-0.5 col-span-2">
            <span className="text-[8px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Capital Risk Exposure</span>
            <span className="text-xs font-mono font-black text-[#50ffaf]">
              ${riskUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
            </span>
          </div>
        </div>

        {/* Warning Banner */}
        {isRrTooLow && (
          <div className="bg-amber-500/10 border border-amber-500/20 text-amber-500 px-3 py-2 rounded-xl flex items-start gap-2 animate-[fade-in_0.2s_ease-out]">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-black uppercase tracking-wider">RISK_WARNING: LOW_EFFICIENCY</span>
              <p className="text-[10px] leading-normal font-medium">
                The computed Risk-to-Reward ratio is below the floor target (2.0 RR). High likelihood of statistical drawdown.
              </p>
            </div>
          </div>
        )}

        {/* Submission Button */}
        <button
          onClick={() => onSubmit(livePrice)}
          disabled={isSubmitting || effectiveEntryPrice === null || stopLoss === null || takeProfit === null}
          className="w-full py-2.5 bg-accent hover:bg-accent disabled:opacity-50 disabled:bg-card-border text-accent-foreground text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md rounded-xl"
        >
          {isSubmitting ? (
            <>
              <svg className="animate-spin h-3 w-3 text-current" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>SENDING ORDER...</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>CONFIRM EXECUTION</span>
            </>
          )}
        </button>

      </div>
    </div>
  );
}

export default memo(ManualOrderPanel);
