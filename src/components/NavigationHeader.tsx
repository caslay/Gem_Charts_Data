"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { useTheme } from "next-themes";
import { SYSTEM_VERSION } from "@/lib/version";
import {
  RotateCcw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  BookOpen,
  LayoutGrid,
  Settings,
  Sun,
  Moon,
  BarChart2
} from "lucide-react";
import MatrixConfigDrawer from "./MatrixConfigDrawer";
import PotentialTradesModal from "./modals/PotentialTradesModal";
import LiveOrderBlockModal from "./modals/LiveOrderBlockModal";
import LiveCockpitStatusBadge from "./LiveCockpitStatusBadge";
import { useMarketDataContext } from "@/context/MarketDataContext";
import { LiveTicker } from "./LiveTicker";

type ResetStatus = 'idle' | 'loading' | 'success' | 'error';

export function NavigationHeader() {
  const pathname = usePathname();
  const { data, wsStatus } = useMarketDataContext();
  const { theme, setTheme } = useTheme();

  const [isMatrixOpen, setIsMatrixOpen] = useState(false);
  const [isTradesModalOpen, setIsTradesModalOpen] = useState(false);
  const [isLiveOBModalOpen, setIsLiveOBModalOpen] = useState(false);
  const [resetStatus, setResetStatus] = useState<ResetStatus>('idle');
  const [cairoTime, setCairoTime] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Set mounted flag to safely render client-only icons without hydration mismatches
  useEffect(() => {
    setMounted(true);
  }, []);

  // Hydration-safe live ticking clock in Cairo timezone (UTC+3)
  useEffect(() => {
    const updateTime = () => {
      setCairoTime(
        new Date().toLocaleTimeString('en-EG', {
          timeZone: 'Africa/Cairo',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  const session = data?.ipda_metrics?.current_time_window || 'WAITING';

  // ── Phase 4: Force Reset State Handler ────────────────────────────────
  const handleForceReset = useCallback(async () => {
    if (resetStatus === 'loading') return;
    setResetStatus('loading');

    try {
      const res = await fetch('/api/reset-state', { method: 'POST' });
      const result = await res.json();

      if (res.ok && result.success) {
        setResetStatus('success');
        console.log('[NAV] AI State reset successfully.');
      } else {
        setResetStatus('error');
        console.error('[NAV] Reset failed:', result.error);
      }
    } catch (err) {
      setResetStatus('error');
      console.error('[NAV] Reset request failed:', err);
    }

    // Auto-revert to idle after 2.5 seconds
    setTimeout(() => setResetStatus('idle'), 2500);
  }, [resetStatus]);

  return (
    <>
      <header className="bg-card/95 border-b border-card-border sticky top-0 z-50 shadow-md transition-colors duration-300">
        <div className="w-full px-4 md:px-8 h-14 flex items-center justify-between">

          {/* LEFT SECTION (Logo & Version Badge) */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-7 h-7 rounded bg-gradient-to-tr from-purple-600 to-indigo-600 dark:from-purple-500 dark:to-emerald-500 flex items-center justify-center shadow-md">
              <span className="text-white text-xs font-black tracking-tighter">FS</span>
            </div>
            <span className="px-1.5 py-0.5 bg-accent/10 text-[8px] font-black text-accent border border-accent/20 leading-none rounded-sm font-mono">
              V{SYSTEM_VERSION}
            </span>
          </div>

          {/* CENTER SECTION (Tactical Link Group Switcher - Dark Brutalist Active Contract) */}
          <div className="hidden md:flex items-center bg-slate-950/80 border border-slate-800/80 rounded-full p-1 gap-1 shadow-inner">
            {[
              { href: '/', label: 'LIVE HUD' },
              { href: '/backtest', label: 'BACKTEST' },
              { href: '/quant-lab', label: 'QUANT LAB' },
              { href: '/compounding', label: 'COMPOUNDING' },
              { href: '/quant-sandbox', label: 'UI SANDBOX' },
            ].map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3.5 py-1.5 rounded-full text-[10px] font-mono font-black tracking-wider uppercase transition-all duration-200 flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-slate-900 border border-cyan-500/80 text-white shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                  }`}
                >
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse shrink-0" />
                  )}
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </div>

          {/* RIGHT SECTION (Awareness, Execution Cockpit & Global Triggers) */}
          <div className="flex items-center gap-2.5">

            {/* Persistent Live Cockpit Execution Status Badge */}
            <LiveCockpitStatusBadge onClick={() => setIsLiveOBModalOpen(true)} variant="full" />

            {/* Session Indicator */}
            <div className="hidden xl:flex px-2 py-1 bg-background/50 border border-card-border rounded text-[9px] font-mono font-bold text-accent shrink-0 uppercase">
              [{session}]
            </div>

            {/* Time & Live Sync — cairo clock and pulse dot */}
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 bg-background/50 border border-card-border rounded-full shrink-0">
              <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'OPEN' ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`} />
              <span className="font-mono text-[9px] font-black text-muted uppercase leading-none tracking-wider">
                {cairoTime ? `${cairoTime} UTC+3` : '--:-- UTC+3'}
              </span>
            </div>

            <div className="w-px h-4 bg-card-border hidden sm:block" />

            {/* Secondary Pages Icons */}
            <Link
              href="/journal"
              className={`p-1.5 border border-card-border hover:border-accent/40 rounded-full transition-all duration-300 shrink-0 ${pathname === '/journal' ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted hover:text-foreground hover:bg-card'}`}
              title="Trading Journal"
            >
              <BookOpen className="w-3.5 h-3.5" />
            </Link>

            <Link
              href="/settings"
              className={`p-1.5 border border-card-border hover:border-accent/40 rounded-full transition-all duration-300 shrink-0 ${pathname === '/settings' ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted hover:text-foreground hover:bg-card'}`}
              title="Command Center"
            >
              <Settings className="w-3.5 h-3.5" />
            </Link>

            {/* Force Reset State Button */}
            <button
              id="force-reset-state-btn"
              onClick={handleForceReset}
              disabled={resetStatus === 'loading'}
              className={`p-1.5 border border-card-border rounded-full transition-all duration-300 cursor-pointer ${resetStatus === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-500'
                : resetStatus === 'error'
                  ? 'bg-rose-500/10 border-rose-500/50 text-rose-500'
                  : resetStatus === 'loading'
                    ? 'bg-accent/5 border-accent/30 text-accent/50 cursor-wait'
                    : 'text-muted hover:text-rose-500 hover:bg-rose-500/5 hover:border-rose-500/30'
                }`}
              title="Force reset AI memory state to SEARCHING"
            >
              {resetStatus === 'loading' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : resetStatus === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : resetStatus === 'error' ? (
                <AlertCircle className="w-3.5 h-3.5" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Theme Toggle Button */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-1.5 text-muted hover:text-foreground bg-background/50 border border-card-border hover:border-accent/40 rounded-full transition-all duration-300 flex items-center justify-center shrink-0 cursor-pointer hover:bg-card"
              title="Toggle Theme"
            >
              {!mounted ? (
                <Sun className="w-3.5 h-3.5" />
              ) : theme === 'dark' ? (
                <Sun className="w-3.5 h-3.5 text-amber-400 animate-in spin-in-12 duration-300" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-indigo-600 animate-in spin-in-12 duration-300" />
              )}
            </button>

            {/* Potential Trades Trigger */}
            <button
              onClick={() => setIsTradesModalOpen(true)}
              className="px-2.5 py-1 text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:border-emerald-500/50 rounded-full transition-all duration-300 shrink-0 flex items-center gap-1.5 cursor-pointer font-sans text-[10px] font-black uppercase tracking-wider"
              title="Quant Potential Trades Matrix"
            >
              <BarChart2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Potential Trades</span>
            </button>

            {/* Master Drawer Trigger */}
            <button
              onClick={() => setIsMatrixOpen(true)}
              className="p-1.5 text-muted hover:text-accent bg-background/50 border border-card-border hover:border-accent/40 rounded-full transition-all duration-300 shrink-0 group hover:bg-card"
              title="Matrix Metrics"
            >
              <LayoutGrid className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
            </button>
          </div>
        </div>
      </header>

      <MatrixConfigDrawer
        isOpen={isMatrixOpen}
        onClose={() => setIsMatrixOpen(false)}
        data={data}
      />

      <PotentialTradesModal
        isOpen={isTradesModalOpen}
        onClose={() => setIsTradesModalOpen(false)}
      />

      <LiveOrderBlockModal
        isOpen={isLiveOBModalOpen}
        onClose={() => setIsLiveOBModalOpen(false)}
      />
    </>
  );
}
