'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  X,
  Activity,
  Play,
  Pause,
  Clock,
  Lock,
  Crosshair,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  Layers,
  Shield,
  Zap,
  Repeat,
  Sliders,
  Flame,
  CheckCheck,
  Filter,
  Check,
  Ban,
  Anchor,
  Percent,
  Target,
  Timer,
  Compass,
  Gauge,
  Sparkles,
  Globe,
  Radio,
  SlidersHorizontal,
  ChevronRight,
  AlertTriangle
} from 'lucide-react';
import { useAutomatedStrategyExecution } from '@/hooks/useAutomatedStrategyExecution';
import { useMarketDataLiveContext } from '@/context/MarketDataContext';
import ScannerPresetControlDeck from '@/components/quantLab/ScannerPresetControlDeck';
import {
  ScannerPreset,
  SweepReclaimPresetConfig,
} from '@/lib/quantEngine/scannerPresets';
import {
  SweepReclaimEntryMode,
  getEntryModeLabel,
  getEntryModeDescription
} from '@/lib/quantEngine/SweepReclaimEngine';

interface LiveOrderBlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbol?: string;
}

function LiveOrderBlockModalContent({
  isOpen,
  onClose,
  symbol = 'ETHUSDC.p'
}: LiveOrderBlockModalProps) {
  const { livePrice } = useMarketDataLiveContext();

  // Master Strategy: Sweep & Reclaim 3-Pillar Execution
  const {
    engineConfig,
    settings: srSettings,
    updateSettings: updateSrSettings,
    isSweepReclaimAutoExecEnabled,
    toggleAutoExecute: toggleSrAutoExecute,
    activePositions,
    pendingOrders,
    closedTrades,
    scannedSetups,
    accountEquity,
    riskUsd2Pct,
    lastEvent,
    isDaemonActive,
    emergencyClosePosition,
    moveStopToBreakeven,
  } = useAutomatedStrategyExecution();

  const [activeTab, setActiveTab] = useState<'POSITIONS' | 'ANCHORS' | 'SETTINGS'>('POSITIONS');
  const [anchorFilter, setAnchorFilter] = useState<'ALL' | 'RECLAIMED' | 'SWEPT' | 'MONITORED'>('ALL');

  // Multi-Timeframe Stream Ingestion state
  const enabledTimeframes = srSettings?.enabledTimeframes || ['5m', '15m', '1h'];
  const toggleTimeframeStream = (tf: '5m' | '15m' | '1h') => {
    let next: ('5m' | '15m' | '1h')[];
    if (enabledTimeframes.includes(tf)) {
      if (enabledTimeframes.length <= 1) return;
      next = enabledTimeframes.filter(t => t !== tf);
    } else {
      next = [...enabledTimeframes, tf];
    }
    updateSrSettings({ enabledTimeframes: next });
  };
  const isTimeframeStreamEnabled = (tf: '5m' | '15m' | '1h') => enabledTimeframes.includes(tf);

  // Stats calculation
  const winCount = closedTrades.filter(t => (t.realizedR || 0) > 0).length;
  const lossCount = closedTrades.filter(t => (t.realizedR || 0) < 0).length;
  const totalTradesCount = closedTrades.length;
  const winRate = totalTradesCount > 0 ? (winCount / totalTradesCount) * 100 : 0;
  const totalRealizedR = closedTrades.reduce((acc, t) => acc + (t.realizedR || 0), 0);
  const totalRealizedUsd = closedTrades.reduce((acc, t) => acc + (t.realizedUsd || 0), 0);

  // Active Positions count
  const totalActiveAndPending = activePositions.length + pendingOrders.length;

  // Filtered anchors
  const filteredAnchors = useMemo(() => {
    if (!scannedSetups || scannedSetups.length === 0) return [];
    if (anchorFilter === 'ALL') return scannedSetups;
    if (anchorFilter === 'RECLAIMED') return scannedSetups.filter(s => s.status === 'RECLAIMED_NO_RETEST' || s.status === 'RETESTED');
    if (anchorFilter === 'SWEPT') return scannedSetups.filter(s => s.status === 'SWEPT_NO_RECLAIM');
    if (anchorFilter === 'MONITORED') return scannedSetups.filter(s => s.status === 'ANCHOR_ONLY');
    return scannedSetups;
  }, [scannedSetups, anchorFilter]);

  const currentSrLivePresetConfig: SweepReclaimPresetConfig = {
    symbol: symbol || 'ETHUSDC',
    timeframe: '5m',
    anchorTypes: (() => {
      const result: any[] = [];
      const list = srSettings?.anchorTypes || ['SWING_PIVOT', 'ASIAN', 'LONDON', 'DAILY'];
      if (list.includes('SWING_PIVOT')) result.push('SWING_PIVOT');
      if (list.includes('ASIAN')) result.push('ASIAN_HIGH', 'ASIAN_LOW');
      if (list.includes('LONDON')) result.push('LONDON_HIGH', 'LONDON_LOW');
      if (list.includes('DAILY')) result.push('PDH', 'PDL');
      return result;
    })(),
    lookbackMajor: srSettings?.lookbackMajor ?? 10,
    lookbackInternal: srSettings?.lookbackInternal ?? 5,
    maxBarsAnchorToSweep: srSettings?.maxBarsAnchorToSweep ?? 25,
    maxBarsSweepToReclaim: srSettings?.maxBarsSweepToReclaim ?? 10,
    maxBarsToRetest: srSettings?.maxBarsToRetest ?? 20,
    volumeSmaPeriod: srSettings?.volumeSmaPeriod ?? 20,
    volumeExpansionThreshold: srSettings?.volumeExpansionThreshold ?? 1.20,
    deltaDominanceThreshold: srSettings?.deltaDominanceThreshold ?? 52.0,
    bodyRatioThreshold: srSettings?.bodyRatioThreshold ?? 0.40,
    requireThreePillarDisplacement: srSettings?.requireThreePillarDisplacement ?? true,
    enforceDiscountPremiumGate: srSettings?.enforceDiscountPremiumGate ?? true,
    stage1Multiple: srSettings?.stage1Multiple ?? 1.0,
    stage2Multiple: srSettings?.stage2Multiple ?? 1.4,
    stage3Multiple: srSettings?.stage3Multiple ?? 3.0,
    entryMode: srSettings?.entryMode || 'FVG_PROXIMAL',
    enableStructuralTrail: srSettings?.enableStructuralTrail ?? true,
    enableProfitRatchet: srSettings?.enableProfitRatchet ?? true,
    minSweepDepthAtrMultiplier: srSettings?.minSweepDepthAtrMultiplier ?? 0.10,
    slBufferAtrMultiplier: srSettings?.slBufferAtrMultiplier ?? 0.10,
  };

  const handleApplySrLivePreset = (preset: ScannerPreset) => {
    if (preset.strategyType !== 'SWEEP_RECLAIM') return;
    const cfg = preset.config as SweepReclaimPresetConfig;
    const liveAnchors: ('SWING_PIVOT' | 'ASIAN' | 'LONDON' | 'DAILY')[] = [];
    if (cfg.anchorTypes?.includes('SWING_PIVOT')) liveAnchors.push('SWING_PIVOT');
    if (cfg.anchorTypes?.some((t) => t.startsWith('ASIAN'))) liveAnchors.push('ASIAN');
    if (cfg.anchorTypes?.some((t) => t.startsWith('LONDON'))) liveAnchors.push('LONDON');
    if (cfg.anchorTypes?.includes('PDH') || cfg.anchorTypes?.includes('PDL')) liveAnchors.push('DAILY');

    updateSrSettings({
      entryMode: cfg.entryMode,
      enforceDiscountPremiumGate: cfg.enforceDiscountPremiumGate,
      volumeSmaPeriod: cfg.volumeSmaPeriod ?? 20,
      volumeExpansionThreshold: cfg.volumeExpansionThreshold,
      deltaDominanceThreshold: cfg.deltaDominanceThreshold,
      bodyRatioThreshold: cfg.bodyRatioThreshold,
      stage1Multiple: cfg.stage1Multiple ?? 1.0,
      stage2Multiple: cfg.stage2Multiple ?? 1.4,
      stage3Multiple: cfg.stage3Multiple ?? 3.0,
      enableStructuralTrail: cfg.enableStructuralTrail ?? true,
      enableProfitRatchet: cfg.enableProfitRatchet ?? true,
      anchorTypes: liveAnchors.length > 0 ? liveAnchors : ['SWING_PIVOT', 'ASIAN', 'LONDON', 'DAILY'],
      lookbackMajor: cfg.lookbackMajor ?? 10,
      lookbackInternal: cfg.lookbackInternal ?? 5,
      maxBarsAnchorToSweep: cfg.maxBarsAnchorToSweep ?? 25,
      maxBarsSweepToReclaim: cfg.maxBarsSweepToReclaim ?? 10,
      maxBarsToRetest: cfg.maxBarsToRetest ?? 20,
      requireThreePillarDisplacement: cfg.requireThreePillarDisplacement ?? true,
      minSweepDepthAtrMultiplier: cfg.minSweepDepthAtrMultiplier ?? 0.10,
      slBufferAtrMultiplier: cfg.slBufferAtrMultiplier ?? 0.10,
    });
  };

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn font-mono">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-5xl h-[90vh] max-h-[850px] shadow-2xl flex flex-col overflow-hidden text-slate-200">
        {/* ── Top Cockpit Header ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Zap className="w-5 h-5 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="font-black text-white text-sm tracking-tight uppercase">
                  Flow-State Quant Execution Cockpit
                </h3>
                <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-500/40 px-2 py-0.5 rounded-full font-bold">
                  {symbol}
                </span>
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 border ${
                  isDaemonActive
                    ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                    : 'bg-slate-900 text-slate-400 border-slate-700'
                }`}>
                  <Radio size={10} className={isDaemonActive ? 'animate-pulse text-emerald-400' : ''} />
                  <span>{isDaemonActive ? 'DAEMON LIVE' : 'DAEMON IDLE'}</span>
                </span>
                <span className="text-[9px] bg-purple-950/80 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <Lock size={10} />
                  <span>CAP: 1 POS</span>
                </span>
              </div>
              <p className="text-[9.5px] text-slate-400 mt-0.5">
                Master Sweep & Reclaim 3-Pillar Displacement & Dynamic Harvest Engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Multi-Stream Matrix Indicators */}
            <div className="hidden md:flex items-center gap-1 text-[9px] font-bold bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800">
              <span className="text-slate-500 uppercase mr-1">STREAMS:</span>
              <span className={isTimeframeStreamEnabled('5m') ? 'text-amber-400' : 'text-slate-600 line-through'}>● 5M</span>
              <span className="text-slate-600">/</span>
              <span className={isTimeframeStreamEnabled('15m') ? 'text-purple-400' : 'text-slate-600 line-through'}>● 15M</span>
              <span className="text-slate-600">/</span>
              <span className={isTimeframeStreamEnabled('1h') ? 'text-cyan-400' : 'text-slate-600 line-through'}>● 1H</span>
            </div>

            {/* Master S&R Auto-Exec Switch */}
            <button
              type="button"
              onClick={toggleSrAutoExecute}
              title="Toggle Autonomous Background Execution for Sweep & Reclaim"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-black uppercase transition-all cursor-pointer text-[10px] ${
                isSweepReclaimAutoExecEnabled
                  ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.45)]'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>⚡ S&R:</span>
              {isSweepReclaimAutoExecEnabled ? (
                <Play className="w-3 h-3 text-slate-950 fill-slate-950" />
              ) : (
                <Pause className="w-3 h-3 text-slate-500" />
              )}
              <span>{isSweepReclaimAutoExecEnabled ? 'AUTO-EXEC ON' : 'DISABLED'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent hover:border-slate-700 transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Navigation Tabs Bar & Realized Metrics ────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-800/80 bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab('POSITIONS')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'POSITIONS'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.2)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Live Positions ({totalActiveAndPending})</span>
            </button>

            <button
              onClick={() => setActiveTab('ANCHORS')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'ANCHORS'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.2)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <Anchor className="w-3.5 h-3.5" />
              <span>Active Anchors Matrix ({scannedSetups.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('SETTINGS')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'SETTINGS'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.2)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Engine & Risk Settings</span>
            </button>
          </div>

          <div className="flex items-center gap-4 text-[10px] text-slate-400">
            <span>
              NET R: <strong className={totalRealizedR >= 0 ? 'text-emerald-400 font-black' : 'text-rose-400 font-black'}>
                {totalRealizedR >= 0 ? '+' : ''}{totalRealizedR.toFixed(2)}R
              </strong>
            </span>
            <span>
              WIN RATE: <strong className="text-white font-bold">{winRate.toFixed(0)}%</strong> ({winCount}W / {lossCount}L)
            </span>
            <span>
              EQUITY: <strong className="text-cyan-400 font-bold">${accountEquity.toFixed(2)}</strong>
            </span>
          </div>
        </div>

        {/* ── Modal Body Content ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* ================================================================= */}
          {/* TAB 1: 🚀 LIVE POSITIONS & PENDING ORDERS                         */}
          {/* ================================================================= */}
          {activeTab === 'POSITIONS' && (
            <div className="flex flex-col gap-4">
              {/* Active Open Positions */}
              {activePositions.length > 0 ? (
                activePositions.map((pos) => {
                  const isLong = pos.direction === 'LONG';
                  const currentPrice = livePrice || pos.entryPrice;
                  const priceDiff = isLong ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
                  const floatingUsd = pos.contractSize ? priceDiff * pos.contractSize : 0;
                  const floatingR = pos.riskPerContract ? priceDiff / pos.riskPerContract : 0;
                  const distanceToSl = Math.abs(currentPrice - pos.activeStopLoss);
                  const distanceToTp1 = Math.abs(currentPrice - pos.stage1Target);

                  return (
                    <div
                      key={pos.id}
                      className="p-4 rounded-xl bg-slate-900/80 border-2 border-cyan-500/50 shadow-[0_0_20px_rgba(6,182,212,0.15)] flex flex-col gap-3.5"
                    >
                      {/* Card Header */}
                      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                        <div className="flex items-center gap-2.5">
                          <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase flex items-center gap-1 ${
                            isLong ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-slate-950'
                          }`}>
                            {isLong ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            <span>{pos.direction} POSITION</span>
                          </span>
                          <span className="font-bold text-white text-xs">
                            {pos.anchorName || 'Sweep & Reclaim Pivot'}
                          </span>
                          <span className="text-[9px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                            {pos.timeframe || '5m'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400">Floating PnL:</span>
                          <span className={`text-xs font-black font-mono ${floatingR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {floatingR >= 0 ? '+' : ''}{floatingR.toFixed(2)}R (${floatingUsd >= 0 ? '+' : ''}{floatingUsd.toFixed(2)})
                          </span>
                        </div>
                      </div>

                      {/* Key Price Metrics Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[10px]">
                        <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
                          <span className="text-slate-500 uppercase font-bold text-[9px]">Entry Fill</span>
                          <span className="text-white font-bold text-xs">${pos.entryPrice.toFixed(2)}</span>
                          <span className="text-[8.5px] text-slate-400 font-mono">{pos.contractSize?.toFixed(3)} ETH</span>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
                          <span className="text-slate-500 uppercase font-bold text-[9px]">Active Stop Loss</span>
                          <span className="text-rose-400 font-bold text-xs">${pos.activeStopLoss.toFixed(2)}</span>
                          <span className="text-[8.5px] text-slate-400 font-mono">
                            {pos.isStage1Filled ? '🛡️ Breakeven Mode' : 'Initial Protective SL'} (-${distanceToSl.toFixed(2)})
                          </span>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
                          <span className="text-slate-500 uppercase font-bold text-[9px]">Stage 1 Target</span>
                          <span className="text-cyan-400 font-bold text-xs">${pos.stage1Target.toFixed(2)}</span>
                          <span className="text-[8.5px] text-slate-400 font-mono">
                            {pos.isStage1Filled ? '✓ 40% Locked (+0.40R)' : `Pending (${distanceToTp1.toFixed(2)} away)`}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
                          <span className="text-slate-500 uppercase font-bold text-[9px]">Stage 2 Target</span>
                          <span className="text-purple-400 font-bold text-xs">${pos.stage2Target.toFixed(2)}</span>
                          <span className="text-[8.5px] text-slate-400 font-mono">
                            {pos.isStage2Filled ? '✓ 40% Locked (+0.60R)' : `${(pos.stage2Multiple || 1.4).toFixed(1)}R Alpha Champion`}
                          </span>
                        </div>
                      </div>

                      {/* Action Controls */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => moveStopToBreakeven(pos.id)}
                            disabled={pos.isStage1Filled}
                            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-[9.5px] font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Shield className="w-3.5 h-3.5 text-cyan-400" />
                            <span>{pos.isStage1Filled ? 'SL Already at Breakeven' : 'Snap SL to Breakeven'}</span>
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm('Emergency Market Close: Are you sure you want to flatten this position immediately?')) {
                              emergencyClosePosition(pos.id);
                            }
                          }}
                          className="px-3.5 py-1.5 rounded bg-rose-950 hover:bg-rose-900 border border-rose-500/40 text-rose-300 font-bold text-[10px] transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                          <span>Emergency Market Flatten</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : null}

              {/* Resting Pending Limit Orders */}
              {pendingOrders.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                    Resting Pending Limit Orders ({pendingOrders.length})
                  </span>
                  {pendingOrders.map((order) => (
                    <div
                      key={order.id}
                      className="p-3 rounded-lg bg-slate-900/60 border border-amber-500/40 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black ${
                          order.direction === 'LONG' ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-slate-950'
                        }`}>
                          {order.direction} LIMIT
                        </span>
                        <div>
                          <span className="text-white font-bold">${order.limitEntryPrice.toFixed(2)}</span>
                          <span className="text-[9px] text-slate-400 ml-2">({order.anchorName || 'Displacement Reclaim'})</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-amber-400 font-bold animate-pulse">
                          ⏳ WAITING FOR RETEST FILL
                        </span>
                        <button
                          type="button"
                          onClick={() => emergencyClosePosition(order.id)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-300 text-[9px] transition cursor-pointer"
                        >
                          Cancel Order
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Empty State / Radar Pulse */}
              {activePositions.length === 0 && pendingOrders.length === 0 && (
                <div className="p-8 rounded-xl bg-slate-900/30 border border-slate-800/80 flex flex-col items-center justify-center text-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 relative">
                    <Radio className="w-6 h-6 animate-pulse" />
                    <span className="w-full h-full rounded-full border border-cyan-400/20 animate-ping absolute" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white uppercase tracking-tight">
                      No Active Positions (Radar Active)
                    </h4>
                    <p className="text-[11px] text-slate-400 max-w-md mt-1">
                      The autonomous engine is actively scanning 5m, 15m, and 1h liquidity sweeps for 3-Pillar Displacement confirmation.
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] font-mono text-slate-400 mt-2 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800">
                    <span>Portfolio: <strong className="text-cyan-300 font-bold">${accountEquity.toFixed(2)} USD</strong></span>
                    <span>•</span>
                    <span>Standard Risk: <strong className="text-white font-bold">${riskUsd2Pct.toFixed(2)} @ 1.0R (2.0%)</strong></span>
                    <span>•</span>
                    <span>Single-Position Lock: <strong className="text-purple-300 font-bold">ARMED</strong></span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: 🎯 ACTIVE ANCHORS LIQUIDITY MATRIX                         */}
          {/* ================================================================= */}
          {activeTab === 'ANCHORS' && (
            <div className="flex flex-col gap-4">
              {/* Header & Filter Controls */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Filter Anchors:</span>
                  {(['ALL', 'RECLAIMED', 'SWEPT', 'MONITORED'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setAnchorFilter(f)}
                      className={`px-2.5 py-1 rounded text-[9px] font-black transition cursor-pointer ${
                        anchorFilter === f
                          ? 'bg-cyan-400 text-slate-950 shadow-[0_0_8px_rgba(34,211,238,0.4)]'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>

                <span className="text-[10px] text-slate-400 font-mono">
                  Showing {filteredAnchors.length} of {scannedSetups.length} Anchors
                </span>
              </div>

              {/* Anchors Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredAnchors.length > 0 ? (
                  filteredAnchors.map((setup) => {
                    const isBull = setup.type === 'BULLISH';
                    const isReclaimed = setup.status === 'RECLAIMED_NO_RETEST' || setup.status === 'RETESTED';
                    const isSwept = setup.status === 'SWEPT_NO_RECLAIM';

                    return (
                      <div
                        key={setup.id}
                        className={`p-3.5 rounded-xl border flex flex-col gap-2.5 transition ${
                          isReclaimed
                            ? 'bg-cyan-950/30 border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                            : isSwept
                            ? 'bg-amber-950/20 border-amber-500/40'
                            : 'bg-slate-900/40 border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[8.5px] font-black uppercase ${
                              isBull ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            }`}>
                              {setup.type}
                            </span>
                            <span className="font-bold text-white text-xs">{setup.anchor_name}</span>
                          </div>
                          <span className="text-white font-mono font-bold text-xs">${setup.anchor_level?.toFixed(2)}</span>
                        </div>

                        {/* Status Phase Badge */}
                        <div className="flex items-center justify-between text-[9px] font-mono">
                          <span className="text-slate-400">Lifecycle Phase:</span>
                          <span className={`font-bold ${
                            isReclaimed ? 'text-cyan-300' : isSwept ? 'text-amber-300' : 'text-slate-500'
                          }`}>
                            {setup.status}
                          </span>
                        </div>

                        {/* 3-Pillar Displacement Metrics */}
                        {setup.three_pillar_displacement_passed && (
                          <div className="p-2 rounded bg-slate-950/70 border border-slate-800/80 grid grid-cols-3 gap-1 text-[8.5px] text-center font-mono">
                            <div>
                              <span className="text-slate-500 block">VOL RATIO</span>
                              <span className="text-cyan-400 font-bold">{setup.reclaim_volume_expansion?.toFixed(2)}x</span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">DELTA DOM</span>
                              <span className="text-cyan-400 font-bold">{setup.reclaim_delta_dominance_pct?.toFixed(1)}%</span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">BODY RATIO</span>
                              <span className="text-cyan-400 font-bold">{((setup.reclaim_body_ratio || 0) * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="col-span-2 p-8 text-center text-slate-500 text-xs">
                    No anchors matching the active filter.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 3: ⚙️ ENGINE & RISK SETTINGS                                  */}
          {/* ================================================================= */}
          {activeTab === 'SETTINGS' && (
            <div className="flex flex-col gap-5">
              {/* Preset Deck for Sweep & Reclaim Strategy */}
              <ScannerPresetControlDeck
                strategyType="SWEEP_RECLAIM"
                currentConfig={currentSrLivePresetConfig}
                onApplyPreset={handleApplySrLivePreset}
                mode="live_deployment"
              />

              {/* 1. Dynamic Compounding Risk Sizing Selector */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Percent className="w-3.5 h-3.5 text-cyan-400" />
                    Dynamic Compounding Risk Sizing ($1.0R)
                  </span>
                  <span className="text-[9px] text-cyan-400 font-mono font-bold">
                    ${((accountEquity * ((srSettings?.compoundingRiskPct || 2.0) / 100))).toFixed(2)} USD / Trade
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[1.0, 2.0, 3.0].map((riskPct) => {
                    const isSelected = (srSettings?.compoundingRiskPct || 2.0) === riskPct;
                    const calculatedUsd = (accountEquity * (riskPct / 100)).toFixed(2);
                    return (
                      <button
                        key={riskPct}
                        type="button"
                        onClick={() => updateSrSettings({ compoundingRiskPct: riskPct })}
                        className={`p-2.5 rounded-lg border text-left transition flex flex-col gap-0.5 cursor-pointer ${
                          isSelected
                            ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.45)] font-black'
                            : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black">{riskPct.toFixed(1)}% Compounding</span>
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-slate-950" />}
                        </div>
                        <span className={`text-[9px] font-mono font-bold ${isSelected ? 'text-slate-900' : 'text-slate-400'}`}>${calculatedUsd} @ 1.0R</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Multi-Timeframe Stream Ingestion Matrix */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    Multi-Timeframe Ingestion Matrix
                  </span>
                  <span className="text-[9px] text-slate-400">
                    {enabledTimeframes.length} of 3 Active Streams
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {(['5m', '15m', '1h'] as const).map((tf) => {
                    const isEnabled = isTimeframeStreamEnabled(tf);
                    const activeColorClasses = tf === '5m'
                      ? 'bg-amber-950/40 border-2 border-amber-400 text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.3)]'
                      : tf === '15m'
                      ? 'bg-purple-950/40 border-2 border-purple-400 text-purple-300 shadow-[0_0_15px_rgba(192,132,252,0.3)]'
                      : 'bg-cyan-950/40 border-2 border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.3)]';

                    return (
                      <button
                        key={tf}
                        type="button"
                        onClick={() => toggleTimeframeStream(tf)}
                        className={`p-2.5 rounded-lg border text-left transition flex flex-col gap-1 cursor-pointer ${
                          isEnabled
                            ? activeColorClasses
                            : 'bg-slate-950/80 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black font-mono uppercase">{tf} Stream</span>
                          <span className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse' : 'bg-slate-700'}`} />
                        </div>
                        <span className="text-[8.5px] font-bold">
                          {isEnabled ? 'ACTIVE INGESTION' : 'STREAM SUSPENDED'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Multi-Timeframe Anchor Selection Pool */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Anchor className="w-3.5 h-3.5 text-cyan-400" />
                    Multi-Timeframe Anchor Pool
                  </span>
                  <span className="text-[9px] text-slate-400">
                    {srSettings?.anchorTypes?.length || 4} Selected
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'SWING_PIVOT', label: 'Major Pivots' },
                    { id: 'ASIAN', label: 'Asian H/L' },
                    { id: 'LONDON', label: 'London H/L' },
                    { id: 'DAILY', label: 'PDH / PDL' },
                  ].map((anchor) => {
                    const isSelected = (srSettings?.anchorTypes || ['SWING_PIVOT', 'ASIAN', 'LONDON', 'DAILY']).includes(anchor.id as any);
                    return (
                      <button
                        key={anchor.id}
                        type="button"
                        onClick={() => {
                          const current = srSettings?.anchorTypes || ['SWING_PIVOT', 'ASIAN', 'LONDON', 'DAILY'];
                          let next: any[];
                          if (current.includes(anchor.id as any)) {
                            if (current.length <= 1) return;
                            next = current.filter(a => a !== anchor.id);
                          } else {
                            next = [...current, anchor.id];
                          }
                          updateSrSettings({ anchorTypes: next });
                        }}
                        className={`px-2.5 py-2 rounded-lg border text-center transition cursor-pointer flex items-center justify-between text-[10px] font-black ${
                          isSelected
                            ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.4)]'
                            : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <span>{anchor.label}</span>
                        {isSelected ? <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" /> : <Ban className="w-3.5 h-3.5 text-slate-600" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. 3-Pillar Displacement Gatekeeper Thresholds */}
              <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-800 flex flex-col gap-2.5">
                <div className="font-bold text-slate-300 uppercase text-[10px] flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-cyan-400" />
                    3-Pillar Displacement Gatekeeper Thresholds
                  </span>
                  <span className="text-cyan-400 text-[9px] font-mono font-bold">STRICT GATING</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[10px] font-mono">
                  {/* Pillar 1: Volume Ratio vs SMA */}
                  <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                    <label className="text-[10px] uppercase font-semibold text-slate-400 flex items-center justify-between">
                      <span>P1: Volume Expansion</span>
                      <span className="text-cyan-400 font-bold">
                        {(srSettings?.volumeExpansionThreshold ?? 1.20).toFixed(2)}x
                      </span>
                    </label>
                    <input
                      type="range"
                      min="1.0"
                      max="2.5"
                      step="0.05"
                      value={srSettings?.volumeExpansionThreshold ?? 1.20}
                      onChange={(e) => updateSrSettings({ volumeExpansionThreshold: parseFloat(e.target.value) })}
                      className="w-full accent-cyan-400"
                    />
                    <span className="text-[9px] text-slate-500">
                      Min volume vs {srSettings?.volumeSmaPeriod ?? 20}-period SMA
                    </span>
                  </div>

                  {/* Pillar 2: Taker Delta Dominance Threshold */}
                  <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                    <label className="text-[10px] uppercase font-semibold text-slate-400 flex items-center justify-between">
                      <span>P2: Delta Dominance</span>
                      <span className="text-cyan-400 font-bold">
                        {(srSettings?.deltaDominanceThreshold ?? 52.0).toFixed(1)}%
                      </span>
                    </label>
                    <input
                      type="range"
                      min="50.0"
                      max="75.0"
                      step="0.5"
                      value={srSettings?.deltaDominanceThreshold ?? 52.0}
                      onChange={(e) => updateSrSettings({ deltaDominanceThreshold: parseFloat(e.target.value) })}
                      className="w-full accent-cyan-400"
                    />
                    <span className="text-[9px] text-slate-500">
                      Min directional taker delta %
                    </span>
                  </div>

                  {/* Pillar 3: Candle Body-to-Range Ratio */}
                  <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                    <label className="text-[10px] uppercase font-semibold text-slate-400 flex items-center justify-between">
                      <span>P3: Body-to-Range</span>
                      <span className="text-cyan-400 font-bold">
                        {((srSettings?.bodyRatioThreshold ?? 0.40) * 100).toFixed(0)}%
                      </span>
                    </label>
                    <input
                      type="range"
                      min="0.30"
                      max="0.80"
                      step="0.05"
                      value={srSettings?.bodyRatioThreshold ?? 0.40}
                      onChange={(e) => updateSrSettings({ bodyRatioThreshold: parseFloat(e.target.value) })}
                      className="w-full accent-cyan-400"
                    />
                    <span className="text-[9px] text-slate-500">
                      Min body ratio |c - o| / (h - l)
                    </span>
                  </div>

                  {/* Volume SMA Period */}
                  <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                    <label className="text-[10px] uppercase font-semibold text-slate-400 flex items-center justify-between">
                      <span>Volume SMA Period</span>
                      <span className="text-cyan-400 font-bold">
                        {srSettings?.volumeSmaPeriod ?? 20} bars
                      </span>
                    </label>
                    <input
                      type="range"
                      min="7"
                      max="50"
                      step="1"
                      value={srSettings?.volumeSmaPeriod ?? 20}
                      onChange={(e) => updateSrSettings({ volumeSmaPeriod: parseInt(e.target.value, 10) })}
                      className="w-full accent-cyan-400"
                    />
                    <span className="text-[9px] text-slate-500">
                      Baseline SMA lookback window
                    </span>
                  </div>
                </div>
              </div>

              {/* 5. Retest Entry Models & Valuation Gate */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[10px]">
                {/* Entry Model Selection (All 8 Modes) */}
                <div className="flex flex-col gap-1.5 bg-slate-900/40 p-3 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-bold text-slate-300 uppercase flex items-center gap-1">
                    <Crosshair className="w-3 h-3 text-cyan-400" />
                    Retest Entry Model (8 Geometries)
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 pt-0.5">
                    {[
                      { id: 'SWEEP_OB_MT', label: 'OB 50% MT', title: '50% Mean Threshold of the sweep Order Block' },
                      { id: 'OB_PROXIMAL', label: 'OB Proximal', title: 'First boundary of the sweep Order Block' },
                      { id: 'FVG_CE', label: 'FVG 50% CE', title: '50% Consequent Encroachment of displacement FVG' },
                      { id: 'FVG_PROXIMAL', label: 'FVG Proximal', title: 'Outer opening edge of displacement FVG' },
                      { id: 'FVG_DISTAL', label: 'FVG Distal', title: 'Deepest boundary edge of displacement FVG' },
                      { id: 'OTE_62', label: '62% OTE', title: '62% Fibonacci Retracement of displacement impulse' },
                      { id: 'SHELF_LEVEL', label: 'Shelf Level', title: 'Reclaimed anchor shelf level' },
                      { id: 'RECLAIM_LEVEL', label: 'Reclaim Level', title: 'Reclaimed horizontal level (explicit)' },
                    ].map((mode) => {
                      const isSelected = srSettings?.entryMode === mode.id || (mode.id === 'SHELF_LEVEL' && srSettings?.entryMode === 'RECLAIM_LEVEL');
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          title={mode.title}
                          onClick={() => updateSrSettings({ entryMode: mode.id as any })}
                          className={`py-1.5 px-1 rounded border text-center font-black text-[8px] cursor-pointer transition-all duration-150 flex items-center justify-center gap-1 ${
                            isSelected
                              ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.5)]'
                              : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <span>{mode.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Valuation Discount/Premium Gate */}
                <div className="flex flex-col gap-1.5 bg-slate-900/40 p-3 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-bold text-slate-300 uppercase flex items-center gap-1">
                    <Shield className="w-3 h-3 text-cyan-400" />
                    Valuation Gate (Discount/Premium)
                  </span>
                  <div className="grid grid-cols-2 gap-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() => updateSrSettings({ enforceDiscountPremiumGate: true })}
                      className={`py-2 px-1 rounded border text-center font-black text-[8.5px] cursor-pointer transition ${
                        (srSettings?.enforceDiscountPremiumGate ?? true)
                          ? 'bg-emerald-400 border-emerald-300 text-slate-950 shadow-[0_0_12px_rgba(52,211,153,0.5)]'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      STRICT ALIGNMENT
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSrSettings({ enforceDiscountPremiumGate: false })}
                      className={`py-2 px-1 rounded border text-center font-black text-[8.5px] cursor-pointer transition ${
                        !(srSettings?.enforceDiscountPremiumGate ?? true)
                          ? 'bg-amber-400 border-amber-300 text-slate-950 shadow-[0_0_12px_rgba(251,191,36,0.5)]'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      PERMISSIVE (OFF)
                    </button>
                  </div>
                </div>
              </div>

              {/* 6. Dynamic Multi-Stage Harvest Targets */}
              <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-800 flex flex-col gap-2.5">
                <div className="font-bold text-slate-300 uppercase text-[10px] flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-cyan-400" />
                    Multi-Stage Harvest & Risk Targets
                  </span>
                  <span className="text-cyan-400 text-[9px] font-mono font-bold">50% / 50% 2-STAGE ALPHA CHAMPION</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[9px]">
                  {/* Stage 1 Target */}
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-1.5">
                    <span className="text-slate-400 text-[8px] uppercase font-bold">Stage 1: TP1 & Auto-BE</span>
                    <div className="grid grid-cols-3 gap-1">
                      {[0.75, 1.0, 1.25].map((val) => {
                        const isSelected = (srSettings?.stage1Multiple ?? 1.0) === val;
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() => updateSrSettings({ stage1Multiple: val })}
                            className={`py-1.5 rounded border text-center font-mono font-black text-[9px] cursor-pointer transition ${
                              isSelected
                                ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                                : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {val.toFixed(2)}R
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Stage 2 Target */}
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-1.5">
                    <span className="text-slate-400 text-[8px] uppercase font-bold">Stage 2: Main Harvest</span>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
                      {[1.3, 1.4, 1.5, 1.6, 1.8, 2.0].map((val) => {
                        const isSelected = (srSettings?.stage2Multiple ?? 1.4) === val;
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() => updateSrSettings({ stage2Multiple: val })}
                            className={`py-1.5 rounded border text-center font-mono font-black text-[9px] cursor-pointer transition ${
                              isSelected
                                ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                                : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {val.toFixed(1)}R
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Stage 3 Target */}
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-1.5">
                    <span className="text-slate-400 text-[8px] uppercase font-bold">Stage 3: DOL Macro Runner</span>
                    <div className="grid grid-cols-3 gap-1">
                      {[3.0, 4.0, 5.0].map((val) => {
                        const isSelected = (srSettings?.stage3Multiple ?? 3.0) === val;
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() => updateSrSettings({ stage3Multiple: val })}
                            className={`py-1.5 rounded border text-center font-mono font-black text-[9px] cursor-pointer transition ${
                              isSelected
                                ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                                : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {val.toFixed(1)}R
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* 7. 🛡️ Quant Shield & Loss Streak Protection Settings (5 Institutional Rules) */}
              <div className="bg-gradient-to-r from-cyan-950/30 via-slate-900/50 to-purple-950/30 p-3.5 rounded-xl border border-cyan-500/30 flex flex-col gap-3">
                <div className="font-bold text-slate-200 uppercase text-[10px] flex items-center justify-between border-b border-cyan-500/20 pb-2">
                  <span className="flex items-center gap-1.5 text-cyan-300">
                    <Shield className="w-4 h-4 text-cyan-400" />
                    Quant Shield: 5 Anti-Loss Streak Protectors
                  </span>
                  <span className="text-[9px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/30 font-mono font-bold">
                    PM2 VERIFIED
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-[9px] font-mono">
                  {/* Rule 1: Wave Anchor Deduplication */}
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col justify-between gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] font-bold text-white uppercase">Rule 1: Wave Deduplication</span>
                      <input
                        type="checkbox"
                        checked={srSettings?.enableWaveDeduplication ?? false}
                        onChange={(e) => updateSrSettings({ enableWaveDeduplication: e.target.checked })}
                        className="w-3.5 h-3.5 accent-cyan-400 cursor-pointer"
                      />
                    </div>
                    <span className="text-[8.5px] text-slate-400">
                      Prunes duplicate clone entries on same candle wave (-84% loss streaks).
                    </span>
                  </div>

                  {/* Rule 2: Weekend Off-Liquidity Filter */}
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col justify-between gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] font-bold text-white uppercase">Rule 2: Weekend Filter</span>
                      <input
                        type="checkbox"
                        checked={srSettings?.filterWeekend ?? false}
                        onChange={(e) => updateSrSettings({ filterWeekend: e.target.checked })}
                        className="w-3.5 h-3.5 accent-cyan-400 cursor-pointer"
                      />
                    </div>
                    <span className="text-[8.5px] text-slate-400">
                      Mutes execution Fri 22:00 - Sun 20:00 UTC (skips 50% of multi-loss traps).
                    </span>
                  </div>

                  {/* Rule 3: Macro Daily Bias Guard */}
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col justify-between gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] font-bold text-white uppercase">Rule 3: Daily Bias Guard</span>
                      <input
                        type="checkbox"
                        checked={srSettings?.enforceHtfBiasGuard ?? false}
                        onChange={(e) => updateSrSettings({ enforceHtfBiasGuard: e.target.checked })}
                        className="w-3.5 h-3.5 accent-cyan-400 cursor-pointer"
                      />
                    </div>
                    <span className="text-[8.5px] text-slate-400">
                      Restricts Longs to Bullish 1D/1H, Shorts to Bearish 1D/1H.
                    </span>
                  </div>

                  {/* Rule 4: Early Breakeven Protection */}
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col justify-between gap-1.5 col-span-1 sm:col-span-2 lg:col-span-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9.5px] font-bold text-slate-300 uppercase">Rule 4: Early Breakeven Ratchet</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-cyan-400">+{(srSettings?.earlyBreakevenMultiple ?? 0.60).toFixed(2)}R MFE</span>
                        <input
                          type="checkbox"
                          checked={srSettings?.enableEarlyBreakeven ?? false}
                          onChange={(e) => updateSrSettings({ enableEarlyBreakeven: e.target.checked })}
                          className="w-3.5 h-3.5 accent-cyan-400 cursor-pointer"
                        />
                      </div>
                    </div>
                    <input
                      type="range"
                      min="0.40"
                      max="0.90"
                      step="0.05"
                      disabled={!(srSettings?.enableEarlyBreakeven ?? false)}
                      value={srSettings?.earlyBreakevenMultiple ?? 0.60}
                      onChange={(e) => updateSrSettings({ earlyBreakevenMultiple: parseFloat(e.target.value) })}
                      className="w-full accent-cyan-400"
                    />
                    <span className="text-[8.5px] text-slate-400">
                      Advances SL to Breakeven 0.0R at +{(srSettings?.earlyBreakevenMultiple ?? 0.60).toFixed(2)}R MFE before TP1.
                    </span>
                  </div>

                  {/* Rule 5: Post-Loss Directional Cooldown */}
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col justify-between gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] font-bold text-white uppercase">Rule 5: Post-Loss Cooldown</span>
                      <span className="text-[10px] font-bold text-purple-400">
                        {(srSettings?.postLossCooldownMinutes ?? 0) === 0 ? "OFF (0m)" : `${srSettings?.postLossCooldownMinutes}m Lock`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="120"
                      step="5"
                      value={srSettings?.postLossCooldownMinutes ?? 0}
                      onChange={(e) => updateSrSettings({ postLossCooldownMinutes: parseInt(e.target.value, 10) })}
                      className="w-full accent-purple-400"
                    />
                    <span className="text-[8.5px] text-slate-400">
                      Directional cooldown after stop out to prevent cascade traps.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/40 flex items-center justify-between text-[10px] text-slate-400 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Binance Futures WebSocket: <strong>LIVE ACTIVE</strong></span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition cursor-pointer"
          >
            Close Cockpit
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LiveOrderBlockModal(props: LiveOrderBlockModalProps) {
  return <LiveOrderBlockModalContent {...props} />;
}
