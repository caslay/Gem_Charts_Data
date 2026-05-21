import React from 'react';
import { X, Activity, ChevronRight, Magnet, Target, Clock, History } from 'lucide-react';
import { useBinanceWS } from '@/hooks/useBinanceWS';

export interface MatrixDataPayload {
  ipda_metrics?: {
    true_day_open?: number | null;
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
      true_day_open?: number | null;
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
  };
}

interface MatrixConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  data?: MatrixDataPayload | null;
}

/**
 * MatrixConfigDrawer - Phase 3 (Live Data Binding)
 * Wired to the V8.0 Ultimate Matrix List payload.
 */
const MatrixConfigDrawer: React.FC<MatrixConfigDrawerProps> = ({ isOpen, onClose, data }) => {
  const { livePrice } = useBinanceWS();

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
        className="fixed inset-0 bg-[#0e0e0f]/60 backdrop-blur-sm z-[100] transition-opacity duration-300 ease-in-out"
        onClick={onClose}
      />
      
      {/* Drawer Container */}
      <div className="fixed top-0 right-0 h-screen w-96 z-[101] bg-[#0e0e0f] border-l border-[#4a4457]/50 shadow-2xl flex flex-col font-sans overflow-hidden animate-in slide-in-from-right duration-300">
        
        {/* Drawer Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4a4457]/50 bg-[#1c1b1c]">
          <div className="flex items-center gap-2">
            <h2 className="text-[#e5e2e3] text-xs font-bold tracking-[0.15em] uppercase">IPDA MATRIX BASIN (V8.0)</h2>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[#50ffaf]/20 border border-[#50ffaf]/30">
              <span className="w-1.5 h-1.5 bg-[#50ffaf] animate-pulse rounded-full" />
              <span className="text-[9px] text-[#50ffaf] font-mono font-bold tracking-tight">LIVE SYNC</span>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-[#958da3] hover:text-[#e5e2e3] transition-colors p-1 group"
            aria-label="Close drawer"
          >
            <X size={18} className="group-hover:rotate-90 transition-transform duration-200" />
          </button>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#4a4457]/50 scrollbar-track-transparent">
          
          {/* Section 1: Temporal Context */}
          <section className="p-5 border-b border-[#4a4457]/50">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={14} className="text-[#958da3]" />
              <h3 className="text-[11px] text-[#958da3] font-bold uppercase tracking-[0.1em]">Temporal Context</h3>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-end border-b border-[#4a4457]/50 pb-2">
                <span className="text-[11px] text-[#958da3] uppercase tracking-tighter">True Day Open</span>
                <span className="text-base font-mono font-medium text-[#50ffaf] tracking-tighter">
                  {formatPrice(metrics?.true_day_open)}
                </span>
              </div>
              <div className="space-y-2">
                <span className="text-[10px] text-[#958da3] uppercase font-black tracking-widest">Local Dealing Range</span>
                <div className="grid grid-cols-3 gap-1">
                  <div className="bg-[#1c1b1c] border border-[#4a4457]/50 p-2.5">
                    <span className="block text-[8px] text-[#958da3] mb-1 font-bold">HIGH</span>
                    <span className="text-xs font-mono text-[#e5e2e3]">{formatPrice(range?.high)}</span>
                  </div>
                  <div className="bg-[#1c1b1c] border border-[#4a4457]/50 p-2.5">
                    <span className="block text-[8px] text-[#958da3] mb-1 font-bold">EQ</span>
                    <span className="text-xs font-mono text-[#958da3]">{formatPrice(range?.equilibrium)}</span>
                  </div>
                  <div className="bg-[#1c1b1c] border border-[#4a4457]/50 p-2.5">
                    <span className="block text-[8px] text-[#958da3] mb-1 font-bold">LOW</span>
                    <span className="text-xs font-mono text-[#e5e2e3]">{formatPrice(range?.low)}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 1.5: Session Liquidity Status */}
          <section className="p-5 border-b border-[#4a4457]/50 bg-[#1c1b1c]/10">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={14} className="text-[#958da3]" />
              <h3 className="text-[11px] text-[#958da3] font-bold uppercase tracking-[0.1em]">Session Liquidity</h3>
            </div>
            <div className="space-y-4">
              {/* Asian Session */}
              <div className="space-y-2">
                <span className="text-[10px] text-[#958da3] font-bold uppercase tracking-tight border-l-2 border-[#4a4457]/50 pl-2">Asian Range</span>
                <div className="grid grid-cols-1 gap-1">
                  <div className="flex justify-between py-1 border-b border-white/5 items-center">
                    <span className="text-[11px] font-mono text-[#958da3]">High:</span>
                    <span className={`text-[11px] font-mono ${isAsianHighSwept ? "text-[#ffb4ab] font-bold" : "text-[#958da3]"}`}>
                      {formatPrice(asianHigh)} {isAsianHighSwept && "[ PURGED 🧹 ]"}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/5 items-center">
                    <span className="text-[11px] font-mono text-[#958da3]">Low:</span>
                    <span className={`text-[11px] font-mono ${isAsianLowSwept ? "text-[#50ffaf] font-bold" : "text-[#958da3]"}`}>
                      {formatPrice(asianLow)} {isAsianLowSwept && "[ PURGED 🧹 ]"}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* London Session */}
              <div className="space-y-2">
                <span className="text-[10px] text-[#958da3] font-bold uppercase tracking-tight border-l-2 border-[#4a4457]/50 pl-2">London Range</span>
                <div className="grid grid-cols-1 gap-1">
                  <div className="flex justify-between py-1 border-b border-white/5 items-center">
                    <span className="text-[11px] font-mono text-[#958da3]">High:</span>
                    <span className={`text-[11px] font-mono ${isLondonHighSwept ? "text-[#ffb4ab] font-bold" : "text-[#958da3]"}`}>
                      {formatPrice(londonHigh)} {isLondonHighSwept && "[ PURGED 🧹 ]"}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/5 items-center">
                    <span className="text-[11px] font-mono text-[#958da3]">Low:</span>
                    <span className={`text-[11px] font-mono ${isLondonLowSwept ? "text-[#50ffaf] font-bold" : "text-[#958da3]"}`}>
                      {formatPrice(londonLow)} {isLondonLowSwept && "[ PURGED 🧹 ]"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Historical HTF Magnets */}
          <section className="p-5 border-b border-[#4a4457]/50 bg-[#1c1b1c]/20">
            <div className="flex items-center gap-2 mb-4">
              <History size={14} className="text-[#958da3]" />
              <h3 className="text-[11px] text-[#958da3] font-bold uppercase tracking-[0.1em]">Historical HTF Magnets</h3>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <span className="text-[10px] text-[#958da3] font-bold uppercase tracking-tight border-l-2 border-[#4a4457]/50 pl-2">Weekly Range</span>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#958da3]">wH</span>
                    <span className="text-[#e5e2e3]">{formatPrice(magnets?.nearest_weekly_high)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#958da3]">wL</span>
                    <span className="text-[#e5e2e3]">{formatPrice(magnets?.nearest_weekly_low)}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <span className="text-[10px] text-[#958da3] font-bold uppercase tracking-tight border-l-2 border-[#4a4457]/50 pl-2">Daily Imbalance</span>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#958da3]">SIBI</span>
                    <span className="text-[#ffb4ab]/90 font-bold">
                      {magnets?.nearest_daily_sibi?.coordinates?.bottom ? magnets.nearest_daily_sibi.coordinates.bottom.toFixed(2) : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#958da3]">BISI</span>
                    <span className="text-[#50ffaf]/90 font-bold">
                      {magnets?.nearest_daily_bisi?.coordinates?.top ? magnets.nearest_daily_bisi.coordinates.top.toFixed(2) : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Projected Targets */}
          <section className="p-5 border-b border-[#4a4457]/50">
            <div className="flex items-center gap-2 mb-4">
              <Target size={14} className="text-[#958da3]" />
              <h3 className="text-[11px] text-[#958da3] font-bold uppercase tracking-[0.1em]">Asian Range Std Dev</h3>
            </div>
            <div className="grid grid-cols-2 gap-px bg-zinc-800/40 border border-[#4a4457]/50 overflow-hidden">
              {/* Upward Projections */}
              <div className="bg-[#0e0e0f] p-3.5 space-y-3">
                <div className="flex justify-between items-center text-[9px] font-mono text-[#50ffaf]/50 uppercase font-black tracking-widest">
                  <span>Bullish</span>
                  <Activity size={10} strokeWidth={3} />
                </div>
                {[
                  { label: "1.5 SD", price: targets?.upward_dev_1_5 },
                  { label: "2.0 SD", price: targets?.upward_dev_2_0 },
                  { label: "2.5 SD", price: targets?.upward_dev_2_5 }
                ].map((item) => (
                  <div key={item.label} className="flex justify-between text-xs font-mono group">
                    <span className="text-[#958da3] group-hover:text-[#958da3] transition-colors">{item.label}</span>
                    <span className="text-[#e5e2e3]">{formatPrice(item.price)}</span>
                  </div>
                ))}
              </div>
              {/* Downward Projections */}
              <div className="bg-[#0e0e0f] p-3.5 space-y-3 border-l border-[#4a4457]/50">
                <div className="flex justify-between items-center text-[9px] font-mono text-[#ffb4ab]/50 uppercase font-black tracking-widest">
                  <span>Bearish</span>
                  <Activity size={10} className="rotate-180" strokeWidth={3} />
                </div>
                {[
                  { label: "1.5 SD", price: targets?.downward_dev_1_5 },
                  { label: "2.0 SD", price: targets?.downward_dev_2_0 },
                  { label: "2.5 SD", price: targets?.downward_dev_2_5 }
                ].map((item) => (
                  <div key={item.label} className="flex justify-between text-xs font-mono group">
                    <span className="text-[#958da3] group-hover:text-[#958da3] transition-colors">{item.label}</span>
                    <span className="text-[#e5e2e3]">{formatPrice(item.price)}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Section 4: Resting Liquidity */}
          <section className="p-5 pb-8">
            <div className="flex items-center gap-2 mb-4">
              <Magnet size={14} className="text-[#958da3]" />
              <h3 className="text-[11px] text-[#958da3] font-bold uppercase tracking-[0.1em]">Resting Liquidity</h3>
            </div>
            <div className="space-y-6">
              {/* BSL Array */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-[#50ffaf] uppercase tracking-tighter">BSL Magnet Array</span>
                  <div className="h-px flex-1 mx-3 bg-[#1c1b1c]" />
                  <span className="text-[8px] text-[#958da3] font-mono tracking-widest">
                    {liquidity?.BSL_Magnets?.length || 0}-ACTIVE
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(liquidity?.BSL_Magnets || []).length > 0 ? (
                    liquidity?.BSL_Magnets?.map((price, idx) => {
                      const isPurged = livePrice !== null && livePrice >= price;
                      return (
                        <div key={`bsl-${idx}`} className={`flex items-center justify-between bg-[#1c1b1c] border ${isPurged ? 'border-dashed border-[#50ffaf]/30 opacity-60 col-span-2' : 'border-[#4a4457]/50 hover:border-[#50ffaf]/30'} px-2.5 py-2 transition-colors cursor-pointer group`}>
                          <div className="flex items-center gap-1.5">
                            <ChevronRight size={10} className={`transition-colors ${isPurged ? 'text-[#50ffaf]' : 'text-[#958da3] group-hover:text-[#50ffaf]'}`} />
                            <span className={`text-xs font-mono ${isPurged ? 'text-[#50ffaf] line-through' : 'text-[#e5e2e3] group-hover:text-[#e5e2e3]'}`}>{price.toFixed(2)}</span>
                          </div>
                          {isPurged && <span className="text-[8px] text-[#50ffaf] font-black uppercase tracking-widest">[ PURGED 🧹 ]</span>}
                        </div>
                      );
                    })
                  ) : (
                    <span className="text-[10px] text-[#958da3] italic font-mono col-span-2">Scanning for BSL...</span>
                  )}
                </div>
              </div>
              {/* SSL Array */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-[#ffb4ab] uppercase tracking-tighter">SSL Magnet Array</span>
                  <div className="h-px flex-1 mx-3 bg-[#1c1b1c]" />
                  <span className="text-[8px] text-[#958da3] font-mono tracking-widest">
                    {liquidity?.SSL_Magnets?.length || 0}-ACTIVE
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(liquidity?.SSL_Magnets || []).length > 0 ? (
                    liquidity?.SSL_Magnets?.map((price, idx) => {
                      const isPurged = livePrice !== null && livePrice <= price;
                      return (
                        <div key={`ssl-${idx}`} className={`flex items-center justify-between bg-[#1c1b1c] border ${isPurged ? 'border-dashed border-[#ffb4ab]/30 opacity-60 col-span-2' : 'border-[#4a4457]/50 hover:border-[#ffb4ab]/30'} px-2.5 py-2 transition-colors cursor-pointer group`}>
                          <div className="flex items-center gap-1.5">
                            <ChevronRight size={10} className={`transition-colors ${isPurged ? 'text-[#ffb4ab]' : 'text-[#958da3] group-hover:text-[#ffb4ab]'}`} />
                            <span className={`text-xs font-mono ${isPurged ? 'text-[#ffb4ab] line-through' : 'text-[#e5e2e3] group-hover:text-[#e5e2e3]'}`}>{price.toFixed(2)}</span>
                          </div>
                          {isPurged && <span className="text-[8px] text-[#ffb4ab] font-black uppercase tracking-widest">[ PURGED 🧹 ]</span>}
                        </div>
                      );
                    })
                  ) : (
                    <span className="text-[10px] text-[#958da3] italic font-mono col-span-2">Scanning for SSL...</span>
                  )}
                </div>
              </div>
            </div>
          </section>

        </div>

        {/* Footer Stats Bar */}
        <div className="p-3 bg-[#1c1b1c] border-t border-[#4a4457]/50 flex justify-between items-center px-5">
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-[#958da3] font-mono uppercase tracking-widest">V8.0 ENGINE</span>
            <span className="w-1 h-1 bg-zinc-800 rounded-full" />
            <span className="text-[9px] text-[#958da3] font-mono">STATUS: {data ? 'CONNECTED' : 'STANDBY'}</span>
          </div>
          <span className="text-[9px] text-[#958da3] font-mono">IPDA-77-VX</span>
        </div>
      </div>
    </>
  );
};

export default MatrixConfigDrawer;
