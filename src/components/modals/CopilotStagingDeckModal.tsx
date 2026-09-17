'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Pin,
  TrendingUp,
  TrendingDown,
  Target,
  Shield,
  Trash2,
  Zap,
  FileText,
  AlertTriangle,
  RefreshCw,
  Clock,
  Crosshair,
  Sparkles,
} from 'lucide-react';
import type { UserStagedSetup } from '@/types/stagedSetupTypes';

interface CopilotStagingDeckModalProps {
  isOpen: boolean;
  onClose: () => void;
  livePrice?: number | null;
  onPreviewSetup?: (setup: UserStagedSetup | null) => void;
  onDeploySuccess?: (stagedId: number, mode: string) => void;
}

export default function CopilotStagingDeckModal({
  isOpen,
  onClose,
  livePrice,
  onPreviewSetup,
  onDeploySuccess,
}: CopilotStagingDeckModalProps) {
  const [stagedSetups, setStagedSetups] = useState<UserStagedSetup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [deployingId, setDeployingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Live 2-Step Confirmation Modal State (Rendered directly inside drawer)
  const [confirmLiveSetup, setConfirmLiveSetup] = useState<UserStagedSetup | null>(null);

  const drawerRef = useRef<HTMLDivElement>(null);

  const fetchStagedSetups = useCallback(async () => {
    setIsLoading(true);
    setActionError(null);
    try {
      const res = await fetch('/api/staged-setups?status=PINNED', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data)) {
          setStagedSetups(json.data);
        }
      }
    } catch (err: any) {
      console.warn('[COPILOT_DECK] Failed to fetch staged setups:', err);
      setActionError('Could not refresh staging queue.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchStagedSetups();
    } else {
      setSelectedId(null);
      setHoveredId(null);
      setConfirmLiveSetup(null);
      if (onPreviewSetup) onPreviewSetup(null);
    }
  }, [isOpen, fetchStagedSetups, onPreviewSetup]);

  // Click-outside listener & ESC key listener
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDownOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      // Do not close if clicking the staging trigger button in the navbar
      if (target?.closest('[data-staging-deck-trigger]')) {
        return;
      }
      if (drawerRef.current && !drawerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (confirmLiveSetup) {
          setConfirmLiveSetup(null);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('mousedown', handlePointerDownOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, confirmLiveSetup]);

  // Sync active preview to parent
  useEffect(() => {
    if (!isOpen || !onPreviewSetup) return;
    const activeSetup = stagedSetups.find((s) => s.id === (hoveredId ?? selectedId)) || null;
    onPreviewSetup(activeSetup);
  }, [hoveredId, selectedId, stagedSetups, isOpen, onPreviewSetup]);

  // Dismiss / Unpin setup
  const handleDismiss = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    try {
      const res = await fetch('/api/staged-setups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'DISMISS', id }),
      });
      if (res.ok) {
        setStagedSetups((prev) => prev.filter((s) => s.id !== id));
        if (selectedId === id) setSelectedId(null);
        if (hoveredId === id) setHoveredId(null);
      }
    } catch (err: any) {
      console.error('[COPILOT_DECK] Dismiss failed:', err);
    }
  };

  // Deploy setup via Manual Override Router
  const handleDeploy = async (setup: UserStagedSetup, targetMode: 'PAPER_TRADING' | 'LIVE_BINANCE') => {
    setDeployingId(setup.id);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await fetch('/api/daemon/execute-staged', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stagedId: setup.id,
          targetMode,
          executionSource: 'COCKPIT_MANUAL_OVERRIDE',
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setActionSuccess(
          `Setup #${setup.id} successfully deployed to ${targetMode === 'PAPER_TRADING' ? 'Paper Trading' : 'Live Binance'}!`
        );
        // Remove deployed setup from active list
        setStagedSetups((prev) => prev.filter((s) => s.id !== setup.id));
        if (selectedId === setup.id) setSelectedId(null);
        if (onDeploySuccess) onDeploySuccess(setup.id, targetMode);
      } else {
        setActionError(json.error || json.message || 'Execution failed.');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Network error while dispatching execution.');
    } finally {
      setDeployingId(null);
      setConfirmLiveSetup(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={drawerRef}
      className="fixed top-0 right-0 bottom-0 h-full w-full sm:w-[420px] z-50 border-l border-slate-700/80 bg-slate-950/95 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden text-slate-100 font-sans animate-in slide-in-from-right duration-300 ease-out"
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800/80 bg-slate-950/70 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400">
            <Pin className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-tight text-slate-100">
                Copilot Staging Deck
              </h2>
              <span className="px-1.5 py-0.2 text-[9px] font-mono font-bold uppercase rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {stagedSetups.length} Pinned
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              Discretionary queue • Live chart projection
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={fetchStagedSetups}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-slate-100 transition-colors cursor-pointer"
            title="Refresh Staging Queue"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition-colors cursor-pointer"
            title="Close Drawer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Status Feedback Banners ─────────────────────────────────────── */}
      {actionSuccess && (
        <div className="mx-4 mt-2.5 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-xs flex items-center justify-between shrink-0">
          <span className="truncate">{actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-400 hover:text-emerald-200 ml-2">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      {actionError && (
        <div className="mx-4 mt-2.5 px-3 py-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-xs flex items-center justify-between shrink-0">
          <span className="truncate">{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-200 ml-2">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Content Area: Vertical Single-Column Setup Stream ───────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 custom-scrollbar">
        {stagedSetups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-800/80 rounded-xl bg-slate-900/30">
            <div className="p-3 bg-slate-800/50 rounded-xl text-slate-500 mb-2">
              <Pin className="w-6 h-6 opacity-40" />
            </div>
            <h3 className="text-xs font-semibold text-slate-300">Staging Deck is Empty</h3>
            <p className="text-[11px] text-slate-500 max-w-[280px] mt-1 mb-3 leading-relaxed">
              Pin setups from the AI History Modal or Setup Drawer via <span className="text-amber-400 font-mono">[ 📌 Pin to Staging ]</span>.
            </p>
          </div>
        ) : (
          stagedSetups.map((setup) => {
            const isLong = setup.direction === 'LONG';
            const isSelected = selectedId === setup.id;
            const isHovered = hoveredId === setup.id;
            const isDeploying = deployingId === setup.id;

            // Distance calculation
            let distanceText = '---';
            let distancePctText = '';
            let isFavorable = false;
            if (livePrice != null && livePrice > 0 && setup.entryPrice > 0) {
              const diff = setup.entryPrice - livePrice;
              const diffPct = ((diff / livePrice) * 100);
              distanceText = `${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}`;
              distancePctText = `(${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(2)}%)`;
              isFavorable = isLong ? diff <= 0 : diff >= 0;
            }

            return (
              <div
                key={setup.id}
                onMouseEnter={() => setHoveredId(setup.id)}
                onMouseLeave={() => setHoveredId((prev) => (prev === setup.id ? null : prev))}
                onClick={() => setSelectedId((prev) => (prev === setup.id ? null : setup.id))}
                className={`relative p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-slate-900/90 border-amber-500/80 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/30'
                    : isHovered
                    ? 'bg-slate-900/80 border-slate-600'
                    : 'bg-slate-900/50 border-slate-800/90 hover:border-slate-700'
                }`}
              >
                {/* Top Row: Direction, Symbol, Source, and Dismiss */}
                <div className="flex items-start justify-between gap-1.5 mb-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider uppercase flex items-center gap-1 ${
                        isLong
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {setup.direction}
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-200">
                      {setup.symbol}
                    </span>
                    <span className="px-1.5 py-0.5 text-[9px] font-mono rounded bg-slate-800/80 text-slate-400 border border-slate-700/60">
                      {setup.sourceReference}
                    </span>
                  </div>

                  <button
                    onClick={(e) => handleDismiss(e, setup.id)}
                    className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    title="Dismiss from Staging"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                {/* Metrics Grid (2x2 Compact) */}
                <div className="grid grid-cols-2 gap-1.5 my-1 text-xs font-mono">
                  {/* Entry Price */}
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
                    <div className="text-[9px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
                      <Crosshair className="w-2.5 h-2.5 text-sky-400" /> Limit Entry
                    </div>
                    <div className="text-xs font-bold text-sky-300 mt-0.5">
                      ${setup.entryPrice.toFixed(2)}
                    </div>
                    {setup.entryRangeLow != null && setup.entryRangeHigh != null && (
                      <div className="text-[8.5px] text-slate-500">
                        [{setup.entryRangeLow.toFixed(1)} - {setup.entryRangeHigh.toFixed(1)}]
                      </div>
                    )}
                  </div>

                  {/* Distance to Fill */}
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
                    <div className="text-[9px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5 text-amber-400" /> Distance to Fill
                    </div>
                    <div className={`text-xs font-bold mt-0.5 ${isFavorable ? 'text-emerald-400' : 'text-slate-300'}`}>
                      {distanceText} <span className="text-[9px] font-normal">{distancePctText}</span>
                    </div>
                    <div className="text-[8.5px] text-slate-500">
                      Live: ${livePrice ? livePrice.toFixed(2) : '---'}
                    </div>
                  </div>

                  {/* Invalidation (SL) */}
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
                    <div className="text-[9px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
                      <Shield className="w-2.5 h-2.5 text-rose-400" /> Invalidation (SL)
                    </div>
                    <div className="text-xs font-bold text-rose-300 mt-0.5">
                      ${setup.stopLoss.toFixed(2)}
                    </div>
                    <div className="text-[8.5px] text-slate-500">
                      Δ ${(Math.abs(setup.entryPrice - setup.stopLoss)).toFixed(2)}
                    </div>
                  </div>

                  {/* Targets & R:R */}
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
                    <div className="text-[9px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
                      <Target className="w-2.5 h-2.5 text-emerald-400" /> Targets & R:R
                    </div>
                    <div className="text-xs font-bold text-emerald-300 mt-0.5">
                      TP1: ${setup.target1.toFixed(2)}
                    </div>
                    <div className="text-[8.5px] text-slate-400">
                      {setup.target2 ? `TP2: $${setup.target2.toFixed(1)} • ` : ''}
                      <span className="text-amber-400 font-bold">{setup.riskRewardRatio ? `${setup.riskRewardRatio}R` : '---'}</span>
                    </div>
                  </div>
                </div>

                {/* Chart Projection Status */}
                <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono py-1">
                  <span className="flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5 text-amber-400/80" />
                    {isSelected || isHovered ? (
                      <span className="text-amber-300 font-semibold">Projected on Chart</span>
                    ) : (
                      'Hover to Project on Chart'
                    )}
                  </span>
                  <span>Pinned: {new Date(setup.pinnedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>

                {/* Action Execution Buttons */}
                <div className="mt-2 pt-2.5 border-t border-slate-800/80 flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeploy(setup, 'PAPER_TRADING');
                    }}
                    disabled={isDeploying}
                    className="flex-1 py-1.5 px-2.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer border border-slate-700/60"
                  >
                    <FileText className="w-3 h-3 text-sky-400" />
                    {isDeploying ? 'Deploying...' : 'Deploy Paper'}
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmLiveSetup(setup);
                    }}
                    disabled={isDeploying}
                    className="flex-1 py-1.5 px-2.5 bg-rose-500/20 hover:bg-rose-500/30 active:bg-rose-500/40 text-rose-300 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer border border-rose-500/40"
                  >
                    <Zap className="w-3 h-3 text-rose-400" />
                    Deploy Live
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-2.5 border-t border-slate-800/80 bg-slate-950/80 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px]">Override Authorized (Bypasses Deadzone)</span>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
        >
          Close
        </button>
      </div>

      {/* ── 2-Step Live Execution Confirmation (Rendered inside drawer) ─── */}
      {confirmLiveSetup && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full bg-slate-900 border border-rose-500/50 rounded-xl p-4 shadow-2xl space-y-3">
            <div className="flex items-center gap-2.5 text-rose-400">
              <div className="p-2 bg-rose-500/20 border border-rose-500/40 rounded-lg">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-100">Confirm Live Binance Execution</h3>
                <p className="text-[10px] text-rose-300">Mandatory Risk Governor Pre-Flight Lock</p>
              </div>
            </div>

            <div className="text-xs text-slate-300 space-y-1 bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">Symbol:</span>
                <span className="font-bold text-white">{confirmLiveSetup.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Direction:</span>
                <span className={`font-bold ${confirmLiveSetup.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {confirmLiveSetup.direction}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Limit Entry:</span>
                <span className="font-bold text-sky-400">${confirmLiveSetup.entryPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Stop Loss:</span>
                <span className="font-bold text-rose-400">${confirmLiveSetup.stopLoss.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">TP 1:</span>
                <span className="font-bold text-emerald-400">${confirmLiveSetup.target1.toFixed(2)}</span>
              </div>
              {confirmLiveSetup.target2 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">TP 2:</span>
                  <span className="font-bold text-sky-400">${confirmLiveSetup.target2.toFixed(2)}</span>
                </div>
              )}
            </div>

            <div className="text-[10px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 p-2 rounded-lg leading-relaxed">
              ⚠️ Transmits a live maker limit order to Binance Futures. Ensure VPS credentials are active.
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setConfirmLiveSetup(null)}
                className="flex-1 py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeploy(confirmLiveSetup, 'LIVE_BINANCE')}
                disabled={deployingId === confirmLiveSetup.id}
                className="flex-1 py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 flex items-center justify-center gap-1 cursor-pointer transition-colors"
              >
                <Zap className="w-3 h-3" />
                {deployingId === confirmLiveSetup.id ? 'Deploying...' : 'Yes, Execute Live'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
