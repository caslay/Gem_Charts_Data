"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Activity, History, TrendingUp, LayoutGrid, Settings } from "lucide-react";
import MatrixConfigDrawer from "./MatrixConfigDrawer";
import { useMarketData } from "@/hooks/useMarketData";
import { LiveTicker } from "./LiveTicker";

export function NavigationHeader() {
  const pathname = usePathname();
  const { data } = useMarketData();
  const [isMatrixOpen, setIsMatrixOpen] = useState(false);

  const pricing = data?.ipda_metrics?.current_pricing || 'SCANNING';
  const session = data?.ipda_metrics?.current_time_window || 'WAITING';

  return (
    <>
      <header className="bg-[#1c1b1c] border-b border-[#4a4457]/50 sticky top-0 z-50 shadow-md">
        <div className="w-full px-4 md:px-8 h-14 flex items-center justify-between">
          
          {/* LEFT SECTION (Brand & Asset) */}
          <div className="flex items-center gap-4">
            <div className="font-bold text-sm tracking-widest text-[#e5e2e3] uppercase flex items-center gap-2">
              <div className="w-5 h-5 bg-[#50ffaf] rounded flex items-center justify-center">
                <span className="text-black text-[10px] font-black">FS</span>
              </div>
              FLOW-STATE V8.0
            </div>
            {/* Asset label */}
            <div className="px-2 py-0.5 bg-[#0e0e0f] border border-[#4a4457]/50 rounded font-mono text-[10px] text-[#e5e2e3]">
              ETHUSDC.p
            </div>
            {/* Live price ticker — isolated leaf, zero re-renders to this parent */}
            <LiveTicker />
          </div>

          {/* CENTER SECTION (Tactical Icon Switcher) */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center bg-[#0e0e0f] border border-[#4a4457]/50 rounded p-1 gap-1">
            <Link 
              href="/" 
              className={`p-1.5 transition-all flex items-center justify-center ${
                pathname === '/' 
                ? 'text-[#50ffaf] border-b-2 border-[#50ffaf] bg-[#50ffaf]/10' 
                : 'text-[#958da3] hover:text-[#e5e2e3] border-b-2 border-transparent hover:bg-zinc-800/50'
              }`} 
              title="Live Dashboard"
            >
              <Activity className="w-4 h-4" />
            </Link>
            <Link 
              href="/backtest" 
              className={`p-1.5 transition-all flex items-center justify-center ${
                pathname === '/backtest' 
                ? 'text-[#50ffaf] border-b-2 border-[#50ffaf] bg-[#50ffaf]/10' 
                : 'text-[#958da3] hover:text-[#e5e2e3] border-b-2 border-transparent hover:bg-zinc-800/50'
              }`} 
              title="Backtest Replay"
            >
              <History className="w-4 h-4" />
            </Link>
            <Link 
              href="/compounding" 
              className={`p-1.5 transition-all flex items-center justify-center ${
                pathname === '/compounding' 
                ? 'text-[#50ffaf] border-b-2 border-[#50ffaf] bg-[#50ffaf]/10' 
                : 'text-[#958da3] hover:text-[#e5e2e3] border-b-2 border-transparent hover:bg-zinc-800/50'
              }`} 
              title="Compound Plan"
            >
              <TrendingUp className="w-4 h-4" />
            </Link>
            <div className="w-px h-4 bg-[#4a4457]/50 mx-0.5" />
            <Link 
              href="/settings" 
              className={`p-1.5 transition-all flex items-center justify-center ${
                pathname === '/settings' 
                ? 'text-[#d1bcff] border-b-2 border-[#d1bcff] bg-[#d1bcff]/10' 
                : 'text-[#958da3] hover:text-[#d1bcff] border-b-2 border-transparent hover:bg-zinc-800/50'
              }`} 
              title="Command Center"
            >
              <Settings className="w-4 h-4" />
            </Link>
          </div>

          {/* RIGHT SECTION (Awareness & Global Triggers) */}
          <div className="flex items-center gap-3">
            {/* Time & Live Sync — static clock display */}
            <div className="hidden sm:flex items-center gap-2 px-2 py-1 bg-[#0e0e0f] border border-[#4a4457]/50 rounded">
              <span className="w-1.5 h-1.5 bg-[#958da3] rounded-full" />
              <span className="font-mono text-[10px] text-[#958da3]">
                {new Date().toLocaleTimeString('en-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false })} UTC+3
              </span>
            </div>

            {/* Badges */}
            <div className="hidden lg:flex items-center gap-2 font-mono text-[9px] font-black uppercase tracking-tighter">
              <span className="px-2 py-1 border border-[#4a4457]/50 bg-[#1c1b1c] text-[#d1bcff]">
                [{session}]
              </span>
              <span className={`px-2 py-1 border ${
                pricing === 'PREMIUM' ? 'bg-[#ffb4ab]/10 text-[#ffb4ab] border-[#ffb4ab]/30' : 
                pricing === 'DISCOUNT' ? 'bg-[#50ffaf]/10 text-[#50ffaf] border-[#50ffaf]/30' : 
                'bg-zinc-800/10 text-[#958da3] border-[#4a4457]/50'
              }`}>
                [{pricing}]
              </span>
            </div>

            {/* Master Drawer Trigger */}
            <button
              onClick={() => setIsMatrixOpen(true)}
              className="p-1.5 text-[#958da3] hover:text-[#d1bcff] bg-[#0e0e0f] border border-[#4a4457]/50 hover:border-[#d1bcff]/50 rounded transition-all ml-1 group"
              title="Matrix Metrics"
            >
              <LayoutGrid className="w-4 h-4 group-hover:scale-110 transition-transform" />
            </button>
          </div>
        </div>
      </header>

      <MatrixConfigDrawer 
        isOpen={isMatrixOpen} 
        onClose={() => setIsMatrixOpen(false)} 
        data={data}
      />
    </>
  );
}
