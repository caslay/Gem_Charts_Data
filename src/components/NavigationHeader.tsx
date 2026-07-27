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
  Moon
} from "lucide-react";
import MatrixConfigDrawer from "./MatrixConfigDrawer";
import { useMarketDataContext } from "@/context/MarketDataContext";
import { LiveTicker } from "./LiveTicker";

type ResetStatus = 'idle' | 'loading' | 'success' | 'error';

export function NavigationHeader() {
  const pathname = usePathname();
  const { data, wsStatus } = useMarketDataContext();
  const { theme, setTheme } = useTheme();

  const [isMatrixOpen, setIsMatrixOpen] = useState(false);
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
      <header className="bg-card/75 border-b border-card-border sticky top-0 z-50 shadow-md backdrop-blur-md transition-colors duration-300">
        <div className="w-full px-4 md:px-8 h-14 flex items-center justify-between">

          {/* LEFT SECTION (Logo & Version Badge) */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-7 h-7 rounded bg-gradient-to-tr from-purple-600 to-indigo-600 dark:from-purple-500 dark:to-emerald-500 flex items-center justify-center shadow-md">
              <span className="text-white text-xs font-black tracking-tighter">FS</span>
            </div>
            <span className="px-1.5 py-0.5 bg-accent/10 text-[8px] font-black text-accent border border-accent/20 leading-none rounded-sm">
              V{SYSTEM_VERSION}
            </span>
          </div>

          {/* CENTER SECTION (Tactical Link Group Switcher - Premium Tabs) */}
          <div className="hidden md:flex items-center bg-background/50 border border-card-border rounded-full p-1 gap-0.5">
            <Link
              href="/"
              className={`px-4 py-1.5 rounded-full text-[10px] font-black tracking-wider uppercase transition-all duration-300 ${pathname === '/'
                ? 'bg-accent text-accent-foreground shadow-sm shadow-accent/25'
                : 'text-slate-600 dark:text-zinc-400 hover:text-foreground'
                }`}
            >
              LIVE HUD
            </Link>
            <Link
              href="/backtest"
              className={`px-4 py-1.5 rounded-full text-[10px] font-black tracking-wider uppercase transition-all duration-300 ${pathname === '/backtest'
                ? 'bg-accent text-accent-foreground shadow-sm shadow-accent/25'
                : 'text-slate-600 dark:text-zinc-400 hover:text-foreground'
                }`}
            >
              BACKTEST
            </Link>
            <Link
              href="/quant-lab"
              className={`px-4 py-1.5 rounded-full text-[10px] font-black tracking-wider uppercase transition-all duration-300 ${pathname === '/quant-lab'
                ? 'bg-accent text-accent-foreground shadow-sm shadow-accent/25'
                : 'text-slate-600 dark:text-zinc-400 hover:text-foreground'}`}
            >
              QUANT LAB
            </Link>
            <Link
              href="/compounding"
              className={`px-4 py-1.5 rounded-full text-[10px] font-black tracking-wider uppercase transition-all duration-300 ${pathname === '/compounding'
                ? 'bg-accent text-accent-foreground shadow-sm shadow-accent/25'
                : 'text-slate-600 dark:text-zinc-400 hover:text-foreground'
                }`}
            >
              COMPOUNDING
            </Link>
            <Link
              href="/quant-sandbox"
              className={`px-3 py-1.5 rounded-full text-[10px] font-black tracking-wider uppercase transition-all duration-300 ${pathname === '/quant-sandbox'
                ? 'bg-purple-600 text-white shadow-sm shadow-purple-500/25'
                : 'text-purple-400 hover:text-purple-300 bg-purple-950/40 border border-purple-800/40'
                }`}
            >
              UI SANDBOX
            </Link>
          </div>

          {/* RIGHT SECTION (Awareness & Global Triggers) */}
          <div className="flex items-center gap-2.5">

            {/* Session Indicator */}
            <div className="hidden lg:flex px-2 py-1 bg-background/50 border border-card-border rounded text-[9px] font-mono font-bold text-accent shrink-0 uppercase">
              [{session}]
            </div>

            {/* Time & Live Sync — cairo clock and pulse dot */}
            <div className="flex items-center gap-2 px-2.5 py-1 bg-background/50 border border-card-border rounded-full shrink-0">
              <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'OPEN' ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`} />
              <span className="font-mono text-[9px] font-black text-muted uppercase leading-none tracking-wider">
                {cairoTime ? `${cairoTime} UTC+3` : '--:-- UTC+3'}
              </span>
            </div>

            <div className="w-px h-4 bg-card-border" />

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
    </>
  );
}
