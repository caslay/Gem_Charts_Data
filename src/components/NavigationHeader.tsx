"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { useTheme } from "next-themes";
import { SYSTEM_VERSION } from "@/lib/version";
import {
  Activity,
  History,
  FlaskConical,
  BookOpen,
  Settings,
  RotateCcw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  LayoutGrid,
  Sun,
  Moon,
  BarChart2,
  Menu,
  X,
  Clock,
  Radio,
  ExternalLink
} from "lucide-react";
import MatrixConfigDrawer from "./MatrixConfigDrawer";
import PotentialTradesModal from "./modals/PotentialTradesModal";
import LiveOrderBlockModal from "./modals/LiveOrderBlockModal";
import LiveCockpitStatusBadge from "./LiveCockpitStatusBadge";
import { useMarketDataContext } from "@/context/MarketDataContext";

type ResetStatus = 'idle' | 'loading' | 'success' | 'error';

interface NavItem {
  href: string;
  label: string;
  tag: string;
  icon: typeof Activity;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Live HUD', tag: 'Cockpit', icon: Activity },
  { href: '/backtest', label: 'Backtest', tag: 'Engine', icon: History },
  { href: '/quant-lab', label: 'Quant Lab', tag: 'Scanners', icon: FlaskConical },
  { href: '/journal', label: 'Journal', tag: 'Logs', icon: BookOpen },
  { href: '/settings', label: 'Settings', tag: 'Config', icon: Settings },
];

export function NavigationHeader() {
  const pathname = usePathname();
  const { data, wsStatus } = useMarketDataContext();
  const { theme, setTheme } = useTheme();

  const [isMatrixOpen, setIsMatrixOpen] = useState(false);
  const [isTradesModalOpen, setIsTradesModalOpen] = useState(false);
  const [isLiveOBModalOpen, setIsLiveOBModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [resetStatus, setResetStatus] = useState<ResetStatus>('idle');
  const [cairoTime, setCairoTime] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Set mounted flag to safely render client-only icons without hydration mismatches
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

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

  // Force Reset State Handler
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

    setTimeout(() => setResetStatus('idle'), 2500);
  }, [resetStatus]);

  return (
    <>
      <header className="bg-card/95 border-b border-card-border sticky top-0 z-50 shadow-md backdrop-blur-md transition-colors duration-300">
        <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 h-14 flex items-center justify-between gap-2">

          {/* ─── LEFT SECTION: Brand Logo & System Version ─── */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href="/"
              className="flex items-center gap-2.5 group focus:outline-none"
              title="Flow-State Quant Engine"
            >
              <div className="w-7 h-7 rounded-md bg-gradient-to-tr from-purple-600 to-indigo-600 dark:from-purple-500 dark:to-cyan-400 flex items-center justify-center shadow-md group-hover:shadow-[0_0_12px_rgba(168,85,247,0.4)] transition-all duration-300">
                <span className="text-white text-xs font-black tracking-tighter">FS</span>
              </div>
              <div className="hidden min-[400px]:flex flex-col">
                <span className="text-[11px] font-mono font-black tracking-wider text-foreground leading-none">
                  FLOW<span className="text-cyan-400">STATE</span>
                </span>
                <span className="text-[7.5px] font-mono text-muted tracking-widest uppercase">
                  QUANT COCKPIT
                </span>
              </div>
            </Link>
            <span className="px-1.5 py-0.5 bg-accent/10 text-[8px] font-black text-accent border border-accent/20 leading-none rounded-sm font-mono shrink-0">
              V{SYSTEM_VERSION}
            </span>
          </div>

          {/* ─── CENTER SECTION: Unified Adaptive Icon Dock (Tablet & Desktop) ─── */}
          <nav
            aria-label="Main Navigation"
            className="hidden sm:flex items-center bg-slate-200/80 dark:bg-slate-950/85 border border-slate-300/80 dark:border-slate-800/80 rounded-full p-1 gap-1 shadow-inner backdrop-blur-md shrink-0"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <div key={item.href} className="relative group flex items-center justify-center">
                  <Link
                    href={item.href}
                    aria-label={item.label}
                    className={`w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center transition-all duration-200 relative ${
                      isActive
                        ? 'bg-white dark:bg-slate-900 border border-indigo-500/80 dark:border-cyan-500/80 text-indigo-600 dark:text-cyan-400 shadow-[0_0_12px_rgba(79,70,229,0.2)] dark:shadow-[0_0_12px_rgba(6,182,212,0.35)]'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-100 hover:bg-slate-300/60 dark:hover:bg-slate-800/50 border border-transparent'
                    }`}
                  >
                    <Icon className={`w-4 h-4 transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-indigo-600 dark:text-cyan-400' : ''}`} />

                    {/* Active Pulsing Indicator Dot */}
                    {isActive && (
                      <span className="absolute -bottom-0.5 w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-cyan-400 shadow-[0_0_8px_#4f46e5] dark:shadow-[0_0_8px_#22d3ee] animate-pulse" />
                    )}
                  </Link>

                  {/* Desktop / Pointer Hover Tooltip */}
                  <div
                    role="tooltip"
                    className="hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex custom-tooltip absolute top-full mt-2.5 left-1/2 -translate-x-1/2 z-50 flex-col items-center pointer-events-none animate-in fade-in zoom-in-95 duration-150"
                  >
                    {/* Tooltip Arrow */}
                    <div className="w-2 h-2 bg-slate-900 dark:bg-slate-950 border-t border-l border-slate-700 dark:border-slate-800 rotate-45 -mb-1 shadow-sm" />
                    
                    {/* Tooltip Body */}
                    <div className="bg-slate-900/95 dark:bg-slate-950/95 border border-slate-700/90 dark:border-slate-800/90 rounded-md px-2.5 py-1 shadow-xl backdrop-blur-md flex items-center gap-1.5 whitespace-nowrap">
                      <span className="text-[10px] font-mono font-bold text-slate-100 dark:text-slate-200 tracking-wider">
                        {item.label}
                      </span>
                      <span className="text-[8px] font-mono font-black uppercase px-1 py-0.2 rounded bg-indigo-500/20 dark:bg-cyan-500/10 text-indigo-300 dark:text-cyan-400 border border-indigo-500/30 dark:border-cyan-500/20">
                        {item.tag}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>

          {/* ─── RIGHT SECTION: Live Cockpit, Telemetry & Utility Actions ─── */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">

            {/* Persistent Live Cockpit Execution Status Badge */}
            <LiveCockpitStatusBadge onClick={() => setIsLiveOBModalOpen(true)} variant="responsive" />

            {/* Session Indicator (Large Screens) */}
            <div className="hidden xl:flex px-2 py-1 bg-background/50 border border-card-border rounded text-[9px] font-mono font-bold text-accent shrink-0 uppercase tracking-wider">
              [{session}]
            </div>

            {/* Cairo Live Time Clock (Desktop & Tablet) */}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-background/50 border border-card-border rounded-full shrink-0">
              <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'OPEN' ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`} />
              <span className="font-mono text-[9px] font-black text-muted uppercase leading-none tracking-wider">
                {cairoTime ? `${cairoTime} Cairo` : '--:-- Cairo'}
              </span>
            </div>

            <div className="w-px h-4 bg-card-border hidden md:block" />

            {/* Potential Trades Trigger (Icon-only with Tooltip) */}
            <div className="relative group flex items-center">
              <button
                onClick={() => setIsTradesModalOpen(true)}
                className="p-1.5 text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:border-emerald-500/50 rounded-full transition-all duration-300 shrink-0 flex items-center justify-center cursor-pointer hover:bg-emerald-500/20"
                aria-label="Quant Potential Trades Matrix"
              >
                <BarChart2 className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
              </button>

              <div
                role="tooltip"
                className="hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex custom-tooltip absolute top-full mt-2.5 left-1/2 -translate-x-1/2 z-50 flex-col items-center pointer-events-none animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="w-2 h-2 bg-slate-950 border-t border-l border-slate-800 rotate-45 -mb-1 shadow-sm" />
                <div className="bg-slate-950/95 border border-slate-800/90 rounded-md px-2.5 py-1 shadow-xl text-[9px] font-mono font-bold text-emerald-400 whitespace-nowrap">
                  Potential Trades
                </div>
              </div>
            </div>

            {/* Force Reset AI State Button (Hidden on mobile phone to prevent clutter) */}
            <div className="relative group hidden sm:flex items-center">
              <button
                id="force-reset-state-btn"
                onClick={handleForceReset}
                disabled={resetStatus === 'loading'}
                className={`p-1.5 border border-card-border rounded-full transition-all duration-300 cursor-pointer ${
                  resetStatus === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-500'
                    : resetStatus === 'error'
                      ? 'bg-rose-500/10 border-rose-500/50 text-rose-500'
                      : resetStatus === 'loading'
                        ? 'bg-accent/5 border-accent/30 text-accent/50 cursor-wait'
                        : 'text-muted hover:text-rose-500 hover:bg-rose-500/5 hover:border-rose-500/30'
                }`}
                aria-label="Force reset AI memory state"
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

              <div
                role="tooltip"
                className="hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex custom-tooltip absolute top-full mt-2.5 left-1/2 -translate-x-1/2 z-50 flex-col items-center pointer-events-none animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="w-2 h-2 bg-slate-950 border-t border-l border-slate-800 rotate-45 -mb-1 shadow-sm" />
                <div className="bg-slate-950/95 border border-slate-800/90 rounded-md px-2 py-0.5 shadow-xl text-[9px] font-mono font-bold text-slate-300 whitespace-nowrap">
                  Reset AI State
                </div>
              </div>
            </div>

            {/* Matrix Metrics Drawer Trigger (Hidden on mobile phone) */}
            <div className="relative group hidden sm:flex items-center">
              <button
                onClick={() => setIsMatrixOpen(true)}
                className="p-1.5 text-muted hover:text-accent bg-background/50 border border-card-border hover:border-accent/40 rounded-full transition-all duration-300 shrink-0 group hover:bg-card cursor-pointer"
                aria-label="Open Matrix Metrics Drawer"
              >
                <LayoutGrid className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
              </button>

              <div
                role="tooltip"
                className="hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex custom-tooltip absolute top-full mt-2.5 left-1/2 -translate-x-1/2 z-50 flex-col items-center pointer-events-none animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="w-2 h-2 bg-slate-950 border-t border-l border-slate-800 rotate-45 -mb-1 shadow-sm" />
                <div className="bg-slate-950/95 border border-slate-800/90 rounded-md px-2 py-0.5 shadow-xl text-[9px] font-mono font-bold text-slate-300 whitespace-nowrap">
                  Matrix Metrics
                </div>
              </div>
            </div>

            {/* Theme Toggle Button */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-1.5 text-muted hover:text-foreground bg-background/50 border border-card-border hover:border-accent/40 rounded-full transition-all duration-300 flex items-center justify-center shrink-0 cursor-pointer hover:bg-card"
              title="Toggle Theme"
              aria-label="Toggle Color Theme"
            >
              {!mounted ? (
                <Sun className="w-3.5 h-3.5" />
              ) : theme === 'dark' ? (
                <Sun className="w-3.5 h-3.5 text-amber-400 animate-in spin-in-12 duration-300" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-indigo-600 animate-in spin-in-12 duration-300" />
              )}
            </button>

            {/* ─── MOBILE DRAWER TOGGLE (Visible strictly on mobile screens < 640px) ─── */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="sm:hidden p-1.5 text-muted hover:text-foreground bg-background/50 border border-card-border hover:border-accent/40 rounded-md transition-all duration-200 flex items-center justify-center shrink-0 cursor-pointer"
              aria-label="Toggle Mobile Navigation Drawer"
            >
              {isMobileMenuOpen ? (
                <X className="w-4 h-4 text-cyan-400" />
              ) : (
                <Menu className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ─── MOBILE SLIDE-OUT DRAWER OVERLAY & SHEET (< 640px) ─── */}
      <div
        className={`fixed inset-0 z-[70] sm:hidden transition-all duration-300 ${
          isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Backdrop */}
        <div
          onClick={() => setIsMobileMenuOpen(false)}
          className="absolute inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
        />

        {/* Slide-out Drawer Panel */}
        <aside
          className={`absolute top-0 right-0 w-72 max-w-[85vw] h-full bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col justify-between p-5 z-10 transform transition-transform duration-300 ease-out overflow-y-auto ${
            isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="space-y-5">
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-gradient-to-tr from-purple-600 to-indigo-600 dark:from-purple-500 dark:to-cyan-400 flex items-center justify-center shadow-md">
                  <span className="text-white text-[10px] font-black">FS</span>
                </div>
                <span className="text-xs font-mono font-black text-slate-200">
                  NAVIGATION DECK
                </span>
              </div>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/50"
                aria-label="Close Mobile Navigation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Navigation Page Links with Full Labels */}
            <div className="space-y-1.5">
              <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted px-1 block">
                Primary Modules
              </span>
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-mono font-bold transition-all duration-200 ${
                      isActive
                        ? 'bg-accent/15 dark:bg-slate-900 border border-indigo-500/60 dark:border-cyan-500/60 text-indigo-600 dark:text-cyan-400 shadow-[0_0_15px_rgba(79,70,229,0.15)] dark:shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                        : 'text-foreground hover:bg-card-border/20 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600 dark:text-cyan-400' : 'text-muted'}`} />
                      <span>{item.label}</span>
                    </div>
                    <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded bg-card-border/30 text-muted">
                      {item.tag}
                    </span>
                  </Link>
                );
              })}
            </div>

            {/* Mobile Actions & Telemetry Section */}
            <div className="space-y-2 pt-3 border-t border-card-border dark:border-slate-800/80">
              <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted px-1 block">
                System Telemetry & Actions
              </span>

              {/* Cairo Clock & Session Card */}
              <div className="bg-card dark:bg-slate-900/70 border border-card-border dark:border-slate-800 rounded-lg p-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-accent dark:text-cyan-400" />
                  <span className="text-[10px] font-mono text-foreground font-bold">
                    {cairoTime ? `${cairoTime} Cairo` : '--:-- Cairo'}
                  </span>
                </div>
                <span className="text-[8.5px] font-mono uppercase px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 font-black">
                  [{session}]
                </span>
              </div>

              {/* Matrix Config Drawer Trigger */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsMatrixOpen(true);
                }}
                className="w-full flex items-center justify-between px-3 py-2 bg-card dark:bg-slate-900/50 hover:bg-card-border/20 border border-card-border dark:border-slate-800 rounded-lg text-xs font-mono font-bold text-foreground transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <LayoutGrid className="w-3.5 h-3.5 text-accent" />
                  <span>Matrix Metrics</span>
                </div>
                <span className="text-[8px] font-mono uppercase text-muted">OPEN &rarr;</span>
              </button>

              {/* Force Reset AI Memory Button */}
              <button
                onClick={() => {
                  handleForceReset();
                }}
                disabled={resetStatus === 'loading'}
                className="w-full flex items-center justify-between px-3 py-2 bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/20 hover:border-rose-500/40 rounded-lg text-xs font-mono font-bold text-rose-500 dark:text-rose-400 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  {resetStatus === 'loading' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500 dark:text-rose-400" />
                  ) : resetStatus === 'success' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                  )}
                  <span>{resetStatus === 'loading' ? 'Resetting AI State...' : resetStatus === 'success' ? 'State Reset Complete' : 'Reset AI Memory State'}</span>
                </div>
                <span className="text-[8px] font-mono uppercase text-rose-500/80 dark:text-rose-400/80">RELOAD</span>
              </button>
            </div>
          </div>

          {/* Drawer Footer */}
          <div className="pt-4 border-t border-card-border dark:border-slate-800/80 flex items-center justify-between text-[9px] font-mono text-muted">
            <span>FLOW-STATE QUANT</span>
            <span>V{SYSTEM_VERSION}</span>
          </div>
        </aside>
      </div>

      {/* ─── Global System Modals & Drawers ─── */}
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

