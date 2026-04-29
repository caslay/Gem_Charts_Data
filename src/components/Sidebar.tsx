'use client';

import { DownloadCloud, TrendingUp, Activity } from 'lucide-react';

interface SidebarProps {
  currentPrice: number | null;
  openInterest: number | null;
  onDownload: () => void;
  isLoading?: boolean;
}

export default function Sidebar({ currentPrice, openInterest, onDownload, isLoading }: SidebarProps) {
  return (
    <div className="w-80 h-full bg-[#0a0a0a] border-l border-white/5 p-6 flex flex-col gap-6 relative z-10 shadow-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <Activity className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">ETHUSDC.p</h2>
          <p className="text-sm text-gray-400 font-medium">Binance Futures</p>
        </div>
      </div>

      <div className="bg-white/[0.02] rounded-2xl p-5 border border-white/[0.05] backdrop-blur-md relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-150 duration-500" />
        <p className="text-sm font-medium text-gray-400 mb-1 relative z-10">Live Price</p>
        <div className="flex items-baseline gap-2 relative z-10">
          <span className="text-3xl font-bold text-white tracking-tight">
            {isLoading ? (
              <span className="animate-pulse text-gray-600">---</span>
            ) : currentPrice !== null ? (
              `$${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ) : (
              '---'
            )}
          </span>
        </div>
      </div>

      <div className="bg-white/[0.02] rounded-2xl p-5 border border-white/[0.05] backdrop-blur-md relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-150 duration-500" />
        <p className="text-sm font-medium text-gray-400 mb-1 relative z-10">Open Interest</p>
        <div className="flex items-center gap-2 relative z-10">
          <TrendingUp className="w-4 h-4 text-purple-400" />
          <span className="text-2xl font-bold text-white tracking-tight">
            {isLoading ? (
              <span className="animate-pulse text-gray-600">---</span>
            ) : openInterest !== null ? (
              openInterest.toLocaleString(undefined, { maximumFractionDigits: 2 })
            ) : (
              '---'
            )}
          </span>
          <span className="text-sm text-gray-500 font-medium ml-1">ETH</span>
        </div>
      </div>

      <div className="flex-1" />

      <button
        onClick={onDownload}
        disabled={isLoading}
        className="w-full relative group overflow-hidden rounded-2xl p-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-purple-500 rounded-2xl opacity-70 group-hover:opacity-100 transition-opacity duration-300" />
        <div className="relative flex items-center justify-center gap-2 px-6 py-4 bg-[#0a0a0a] rounded-2xl group-hover:bg-transparent transition-colors duration-300">
          <DownloadCloud className="w-5 h-5 text-cyan-400 group-hover:text-white transition-colors duration-300" />
          <span className="font-semibold text-white">Download V6 JSON for Gem</span>
        </div>
      </button>
    </div>
  );
}
