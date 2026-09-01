"use client";

import React from "react";
import { Repeat, RefreshCw, Trash2 } from "lucide-react";
import { StoredSrScan } from "@/app/quant-lab/page";

interface SweepReclaimSidebarListProps {
  scans: StoredSrScan[];
  selectedScan: StoredSrScan | null;
  onSelectScan: (scan: StoredSrScan) => void;
  onDeleteScan: (e: React.MouseEvent, scanId: string) => void;
  loading: boolean;
}

export default function SweepReclaimSidebarList({
  scans,
  selectedScan,
  onSelectScan,
  onDeleteScan,
  loading,
}: SweepReclaimSidebarListProps) {
  return (
    <div className="border border-card-border dark:border-slate-800/50 bg-card/75 dark:bg-slate-900/30 backdrop-blur-sm rounded-xl p-5 shadow-xs">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs uppercase tracking-widest text-muted dark:text-slate-400 font-mono font-bold flex items-center gap-1.5">
          <Repeat className="w-3.5 h-3.5 text-cyan-500 dark:text-cyan-400" />
          <span>Historical S&R Scans</span>
        </h2>
        <span className="px-2 py-0.5 rounded text-[9px] bg-muted/10 dark:bg-slate-800 text-foreground dark:text-slate-300 font-mono font-bold border border-card-border/60 dark:border-transparent">
          {scans.length} SCANS
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted dark:text-slate-500 font-mono text-xs">
          <RefreshCw className="w-5 h-5 animate-spin text-cyan-500" />
          <span>Loading S&R scan records...</span>
        </div>
      ) : scans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-card-border dark:border-slate-800 rounded-lg text-muted dark:text-slate-500 font-mono text-[11px] text-center p-4">
          <span>No Sweep & Reclaim scans recorded in database.</span>
          <span className="text-[9px] text-muted/70 dark:text-slate-600 mt-1">Configure lookback parameters and run a deep scan.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 max-h-[560px] overflow-y-auto pr-1">
          {scans.map((scan) => {
            const isSelected = selectedScan?.id === scan.id;
            const rawWinRate = Number(scan.retest_win_rate_pct);
            const exScratchWinRate = typeof (scan.telemetry_summary as any)?.ex_scratch_win_rate_pct === 'number'
              ? (scan.telemetry_summary as any).ex_scratch_win_rate_pct
              : rawWinRate;
            const reclaimRate = Number(scan.reclaim_rate_pct);

            return (
              <div
                key={scan.id}
                onClick={() => onSelectScan(scan)}
                className={`group cursor-pointer border rounded-lg p-3.5 transition text-left flex flex-col justify-between ${
                  isSelected
                    ? "border-cyan-500/60 bg-cyan-500/10 dark:bg-cyan-950/15 shadow-sm shadow-cyan-500/10"
                    : "border-card-border/70 dark:border-slate-800/60 bg-card/60 dark:bg-slate-900/40 hover:bg-card hover:dark:bg-slate-900/80 hover:border-card-border dark:hover:border-slate-700 shadow-xs"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-xs font-mono font-bold text-foreground dark:text-slate-200 uppercase tracking-tight group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition">
                      {scan.scan_name}
                    </h3>
                    <span className="text-[9px] text-muted dark:text-slate-500 font-mono flex items-center gap-1.5 mt-0.5">
                      <span className="text-cyan-600 dark:text-cyan-400 font-bold">{scan.symbol}</span>
                      <span>•</span>
                      <span>{scan.timeframe} TF</span>
                      <span>•</span>
                      <span>{scan.start_date.slice(0, 10)} to {scan.end_date.slice(0, 10)}</span>
                    </span>
                  </div>
                  <button
                    onClick={(e) => onDeleteScan(e, scan.id)}
                    className="text-muted/60 hover:text-rose-500 dark:text-slate-600 dark:hover:text-rose-400 p-1 rounded hover:bg-rose-500/10 transition opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="Delete Scan Record"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-1.5 border-t border-card-border/60 dark:border-slate-800/40 pt-2.5 mt-1 font-mono text-[9px] text-center">
                  <div className="flex flex-col">
                    <span className="text-muted dark:text-slate-500 uppercase text-[8px]">Setups</span>
                    <span className="font-bold text-foreground dark:text-slate-200">{scan.total_detected}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted dark:text-slate-500 uppercase text-[8px]">Reclaim %</span>
                    <span className="font-bold text-cyan-600 dark:text-cyan-400">{reclaimRate.toFixed(0)}%</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted dark:text-slate-500 uppercase text-[8px]">Retest %</span>
                    <span className="font-bold text-foreground/80 dark:text-slate-300">{Number(scan.retest_rate_pct).toFixed(0)}%</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted dark:text-slate-500 uppercase text-[8px]">Win Rate</span>
                    <span className={`font-bold ${exScratchWinRate >= 50 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {exScratchWinRate.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
