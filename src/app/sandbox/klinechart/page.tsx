'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

// Dynamically import KLineChartSandbox with ssr: false to prevent SSR 'window is not defined' errors
const KLineChartSandbox = dynamic(() => import('@/components/KLineChartSandbox'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[600px] flex flex-col items-center justify-center bg-[#0b0e14] text-slate-400 font-mono text-sm border border-slate-800 rounded-xl gap-3">
      <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
      <span>Initializing KLineChart Engine...</span>
    </div>
  ),
});

export default function KLineChartSandboxPage() {
  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#07090e] text-slate-100 flex flex-col p-4 md:p-6 gap-4 max-w-[1920px] w-full mx-auto">
      {/* Header Bar */}
      <div className="flex items-center justify-between bg-[#0b0e14] p-4 rounded-xl border border-slate-800/80 shadow-lg shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg border border-slate-800 transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-100 tracking-tight">KLineChart Sandbox Evaluation</h1>
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                FEATURE BRANCH EXPERIMENTAL
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Testing native user drawing tools (trendlines, fibonacci, rays) with automated SMC overlays &amp; zero-repaint logic.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-400 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
            Engine: <strong className="text-emerald-400">100% Preserved</strong>
          </span>
        </div>
      </div>

      {/* Main Sandbox Container */}
      <div className="flex-1 w-full min-h-[650px] flex flex-col">
        <KLineChartSandbox height="calc(100vh - 180px)" />
      </div>
    </div>
  );
}
