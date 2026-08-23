'use client';

import React, { useEffect, useState } from 'react';
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
  Globe
} from 'lucide-react';
import { useLiveOrderBlockExecution, IS_OB_STRATEGY_PAUSED } from '@/hooks/useLiveOrderBlockExecution';
import { useAutomatedStrategyExecution } from '@/hooks/useAutomatedStrategyExecution';
import ScannerPresetControlDeck from '@/components/quantLab/ScannerPresetControlDeck';
import {
  ScannerPreset,
  SweepReclaimPresetConfig,
  OrderBlockPresetConfig
} from '@/lib/quantEngine/scannerPresets';

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
  // Strategy 1: Order Block & Breaker Execution
  const {
    engineConfig,
    setEngineConfig,
    isOrderBlockAutoExecEnabled,
    enabledTimeframes,
    activePositions,
    activeZones,
    activeZonesByTimeframe,
    timeframeFilter,
    setTimeframeFilter,
    closedLiveTrades,
    lastEventMessage,
    lastEventTime,
    isConnected,
    cooldownRemainingSec,
    testingStates,
    toggleAutoExecute: toggleObAutoExecute,
    setScalingMode,
    setTrailingMode,
    setEnforceHtfAlignment,
    toggleTimeframeStream,
    isTimeframeStreamEnabled
  } = useLiveOrderBlockExecution();

  // Strategy 2: Sweep & Reclaim 3-Pillar Execution
  const {
    engineConfig: srEngineConfig,
    setEngineConfig: setSrEngineConfig,
    settings: srSettings,
    updateSettings: updateSrSettings,
    isSweepReclaimAutoExecEnabled,
    toggleAutoExecute: toggleSrAutoExecute,
    accountEquity,
    riskUsd2Pct
  } = useAutomatedStrategyExecution();

  const [activeTab, setActiveTab] = useState<'EXECUTION' | 'ZONES' | 'SETTINGS'>('EXECUTION');

  const currentSrLivePresetConfig: SweepReclaimPresetConfig = {
    symbol: symbol || 'ETHUSDC',
    timeframe: '15m',
    anchorTypes: (() => {
      const result: any[] = [];
      const list = srSettings?.anchorTypes || ['SWING_PIVOT', 'ASIAN', 'LONDON', 'DAILY'];
      if (list.includes('SWING_PIVOT')) result.push('SWING_PIVOT');
      if (list.includes('ASIAN')) result.push('ASIAN_HIGH', 'ASIAN_LOW');
      if (list.includes('LONDON')) result.push('LONDON_HIGH', 'LONDON_LOW');
      if (list.includes('DAILY')) result.push('PDH', 'PDL');
      return result;
    })(),
    lookbackMajor: 15,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 30,
    maxBarsSweepToReclaim: 12,
    maxBarsToRetest: 24,
    volumeSmaPeriod: srSettings?.volumeSmaPeriod ?? 20,
    volumeExpansionThreshold: srSettings?.volumeExpansionThreshold ?? 1.50,
    deltaDominanceThreshold: srSettings?.deltaDominanceThreshold ?? 55.0,
    bodyRatioThreshold: srSettings?.bodyRatioThreshold ?? 0.55,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: srSettings?.enforceDiscountPremiumGate ?? true,
    stage1Multiple: srSettings?.stage1Multiple ?? 1.0,
    stage2Multiple: srSettings?.stage2Multiple ?? 1.5,
    stage3Multiple: srSettings?.stage3Multiple ?? 3.0,
    entryMode: srSettings?.entryMode || 'SWEEP_OB_MT',
    enableStructuralTrail: srSettings?.enableStructuralTrail ?? true,
    enableProfitRatchet: srSettings?.enableProfitRatchet ?? true,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.15,
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
      stage2Multiple: cfg.stage2Multiple ?? 1.5,
      stage3Multiple: cfg.stage3Multiple ?? 3.0,
      enableStructuralTrail: cfg.enableStructuralTrail ?? true,
      enableProfitRatchet: cfg.enableProfitRatchet ?? true,
      anchorTypes: liveAnchors.length > 0 ? liveAnchors : ['SWING_PIVOT', 'ASIAN', 'LONDON', 'DAILY'],
    });
  };

  const currentObLivePresetConfig: OrderBlockPresetConfig = {
    symbol: symbol || 'ETHUSDC',
    timeframe: '15m',
    minTier: 'ALL',
    strictTierAPlus: false,
    maxBarsToMitigation: 24,
    enableBreakerSim: true,
    maxBreakerRetestBars: 20,
    enableDynamicMgmt: true,
    tp1Multiple: 1.0,
    tp2Multiple: 1.5,
    positionScalingMode: 'THREE_STAGE_HARVEST',
    tp1Ratio: 0.40,
    tp2Ratio: 0.40,
    tp3Ratio: 0.20,
    trailingStopMode: 'STRUCTURAL_FVG_TRAIL',
    trailingBuffer: 0.05,
    dynamicDolTp2Scaling: true,
    adaptiveBreakerConfirmation: true,
    requireBreakerConfirmation: true,
    requireBreakerDOL: true,
    requireBreakerVolumetric: true,
    breakerSessionFilter: 'ALL',
    aggregateConsecutive: true,
    maxConsecutive: 5,
    entryMode: 'BOUNDARY',
    targetRr: 2.5,
  };

  const handleApplyObLivePreset = (preset: ScannerPreset) => {
    if (preset.strategyType !== 'ORDER_BLOCK') return;
    const cfg = preset.config as OrderBlockPresetConfig;
    if (cfg.positionScalingMode) {
      setScalingMode(cfg.positionScalingMode);
    }
    if (cfg.trailingStopMode) {
      setTrailingMode(cfg.trailingStopMode);
    }
  };

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const count5m = activeZonesByTimeframe['5m']?.length || 0;
  const count15m = activeZonesByTimeframe['15m']?.length || 0;
  const count1h = activeZonesByTimeframe['1h']?.length || 0;
  const totalZones = activeZones.length;

  const totalRealizedR = closedLiveTrades.reduce((acc, t) => acc + t.realizedR, 0);
  const winCount = closedLiveTrades.filter(t => t.realizedR > 0).length;
  const lossCount = closedLiveTrades.filter(t => t.realizedR < 0).length;
  const winRate = closedLiveTrades.length > 0 ? (winCount / closedLiveTrades.length) * 100 : 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6 bg-background/80 backdrop-blur-md animate-in fade-in duration-150">
      {/* Modal Container */}
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col bg-[#0d0e12]/95 border border-card-border rounded-2xl shadow-2xl overflow-hidden font-mono text-xs select-none">
        
        {/* ── Modal Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-card-border bg-card/45 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
              <Activity className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black uppercase tracking-wider text-foreground">
                  Multi-Timeframe Live Order Block & Breaker Matrix
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-card border border-card-border text-[10px] font-bold text-cyan-400">
                  {symbol}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-500/30 text-[9px] font-bold flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" />
                  <span>CAP: 1 POS</span>
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Dual strategy independent auto-execution (OB & Breakers + Sweep & Reclaim) with Top-Down HTF gating & 3-Stage scaling.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Dynamic MTF Stream Selective Toggles */}
            <div className="hidden sm:flex items-center gap-1 bg-background/60 p-1 rounded-xl border border-card-border/60">
              <span className="text-[8px] font-black text-muted uppercase tracking-wider px-1">STREAMS:</span>
              {(['5m', '15m', '1h'] as const).map(tf => {
                const isEnabled = isTimeframeStreamEnabled(tf);
                const activeColor =
                  tf === '1h'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
                    : tf === '15m'
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-[0_0_8px_rgba(168,85,247,0.25)]'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.25)]';

                return (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => toggleTimeframeStream(tf)}
                    title={`Live OB ${tf.toUpperCase()} Stream: ${isEnabled ? 'ACTIVE (Click to Suspend)' : 'SUSPENDED (Click to Enable)'}`}
                    className={`px-2 py-0.5 rounded-lg border font-bold uppercase transition-all cursor-pointer text-[9px] flex items-center gap-1 ${
                      isEnabled
                        ? activeColor
                        : 'bg-card/40 border-card-border/40 text-muted/40 hover:text-muted line-through'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isEnabled ? (tf === '1h' ? 'bg-cyan-400' : tf === '15m' ? 'bg-purple-400' : 'bg-amber-400') : 'bg-slate-600'}`} />
                    <span>{tf}</span>
                  </button>
                );
              })}
            </div>

            {/* Dual Independent Auto-Execution Toggles */}
            <div className="flex items-center gap-1.5 bg-background/60 p-1 rounded-xl border border-card-border/60">
              {/* Strategy 1: OB & Breakers Toggle */}
              <button
                type="button"
                onClick={toggleObAutoExecute}
                title="Toggle Autonomous Execution for Order Block & Breaker Strategy"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-bold uppercase transition-all cursor-pointer text-[9px] ${
                  isOrderBlockAutoExecEnabled
                    ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/80 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
                    : 'bg-card/40 border-card-border text-muted hover:text-foreground'
                }`}
              >
                <span>🏛️ OB:</span>
                {isOrderBlockAutoExecEnabled ? (
                  <Play className="w-2.5 h-2.5 text-emerald-400 fill-emerald-400" />
                ) : (
                  <Pause className="w-2.5 h-2.5 text-slate-500" />
                )}
                <span>{isOrderBlockAutoExecEnabled ? 'ON' : 'OFF'}</span>
              </button>

              {/* Strategy 2: Sweep & Reclaim Toggle */}
              <button
                type="button"
                onClick={toggleSrAutoExecute}
                title="Toggle Autonomous Execution for Sweep & Reclaim 3-Pillar Strategy"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-bold uppercase transition-all cursor-pointer text-[9px] ${
                  isSweepReclaimAutoExecEnabled
                    ? 'bg-cyan-950/80 border-cyan-500/50 text-cyan-300 hover:bg-cyan-900/80 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
                    : 'bg-card/40 border-card-border text-muted hover:text-foreground'
                }`}
              >
                <span>⚡ S&R:</span>
                {isSweepReclaimAutoExecEnabled ? (
                  <Play className="w-2.5 h-2.5 text-cyan-400 fill-cyan-400" />
                ) : (
                  <Pause className="w-2.5 h-2.5 text-slate-500" />
                )}
                <span>{isSweepReclaimAutoExecEnabled ? 'ON' : 'OFF'}</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-card border border-transparent hover:border-card-border transition-all cursor-pointer ml-1"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Order Block Strategy Pause Status Banner ──────────────────────── */}
        {IS_OB_STRATEGY_PAUSED && (
          <div className="bg-cyan-950/70 border-b border-cyan-500/40 px-5 py-2.5 text-[11px] text-cyan-200 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
              </span>
              <span className="font-bold tracking-wide">
                <span className="text-amber-300 font-black">⏸️ ORDER BLOCK PIPELINE PAUSED:</span> 100% bandwidth allocated exclusively to <strong className="text-cyan-300">Sweep & Reclaim (3-Pillar Displacement Engine)</strong>.
              </span>
            </div>
            <span className="text-[10px] font-mono font-bold bg-cyan-900/80 px-2 py-0.5 rounded text-cyan-300 border border-cyan-500/30">
              SINGLE-STRATEGY DEDICATED MODE
            </span>
          </div>
        )}

        {/* ── Cooldown Alert Banner ─────────────────────────────────────────── */}
        {cooldownRemainingSec > 0 && (
          <div className="bg-amber-950/60 border-b border-amber-500/40 px-5 py-2 text-[10px] text-amber-300 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400 animate-spin" />
              <span className="font-bold uppercase tracking-wider">
                Post-Trade Safety Cooldown Active — Rapid-Fire Loops Suppressed
              </span>
            </div>
            <span className="font-bold bg-amber-900/90 px-2 py-0.5 rounded text-amber-200 border border-amber-500/40">
              {cooldownRemainingSec}s remaining
            </span>
          </div>
        )}

        {/* ── Tabs Bar ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-2 border-b border-card-border/60 bg-background/50 shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('EXECUTION')}
              className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase transition ${
                activeTab === 'EXECUTION'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              Live Positions ({activePositions.length})
            </button>
            <button
              onClick={() => setActiveTab('ZONES')}
              className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase transition ${
                activeTab === 'ZONES'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              MTF Active Matrix ({totalZones})
            </button>
            <button
              onClick={() => setActiveTab('SETTINGS')}
              className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase transition flex items-center gap-1 ${
                activeTab === 'SETTINGS'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              <Sliders size={11} />
              <span>Engine Settings</span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-[10px] text-muted">
            <span>
              NET R: <strong className={totalRealizedR >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                {totalRealizedR > 0 ? '+' : ''}{totalRealizedR.toFixed(2)}R
              </strong>
            </span>
            <span>
              WIN RATE: <strong className="text-foreground font-bold">{winRate.toFixed(0)}%</strong> ({winCount}W / {lossCount}L)
            </span>
          </div>
        </div>

        {/* ── Modal Body Content ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {activeTab === 'EXECUTION' && (
            <>
              {/* ── Status Metrics Cards ─────────────────────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-card/40 border border-card-border rounded-xl p-3 flex flex-col justify-between">
                  <span className="text-[9px] uppercase text-muted font-bold">Open Positions</span>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-base font-black text-white">{activePositions.length}</span>
                    <span className="text-[9px] text-purple-300 bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-500/30">
                      Cap: 1 Max
                    </span>
                  </div>
                </div>

                <div className="bg-card/40 border border-card-border rounded-xl p-3 flex flex-col justify-between">
                  <span className="text-[9px] uppercase text-muted font-bold">MTF Resting Matrix</span>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1 text-[11px] font-bold">
                      <span className={isTimeframeStreamEnabled('5m') ? 'text-amber-400' : 'text-slate-600 line-through'}>
                        {count5m}·5m
                      </span>
                      <span className="text-slate-500">/</span>
                      <span className={isTimeframeStreamEnabled('15m') ? 'text-purple-400' : 'text-slate-600 line-through'}>
                        {count15m}·15m
                      </span>
                      <span className="text-slate-500">/</span>
                      <span className={isTimeframeStreamEnabled('1h') ? 'text-cyan-400' : 'text-slate-600 line-through'}>
                        {count1h}·1h
                      </span>
                    </div>
                    <span className="text-[9px] text-slate-400">{totalZones} Total</span>
                  </div>
                </div>

                <div className="bg-card/40 border border-card-border rounded-xl p-3 flex flex-col justify-between">
                  <span className="text-[9px] uppercase text-muted font-bold">Scaling Model</span>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[11px] font-black text-emerald-400">3-STAGE</span>
                    <span className="text-[9px] text-slate-400">40% / 40% / 20%</span>
                  </div>
                </div>

                <div className="bg-card/40 border border-card-border rounded-xl p-3 flex flex-col justify-between">
                  <span className="text-[9px] uppercase text-muted font-bold">HTF Alignment Gate</span>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-[10px] font-bold ${engineConfig.enforceHtfAlignment ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {engineConfig.enforceHtfAlignment ? 'STRICT 15m/1h' : 'PERMISSIVE'}
                    </span>
                    <span className="text-[9px] text-slate-400">Top-Down</span>
                  </div>
                </div>
              </div>

              {/* ── In-Zone Confirmation Pending Radar ─────────────────────────── */}
              {testingStates.length > 0 && activePositions.length === 0 && (
                <div className="bg-cyan-950/30 border border-cyan-500/40 rounded-xl p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Crosshair className="w-5 h-5 text-cyan-400 animate-spin" />
                    <div>
                      <h4 className="font-bold text-cyan-200">Awaiting In-Zone Volumetric Confirmation</h4>
                      <p className="text-[10px] text-cyan-400/80">
                        Price touched active zone. Verifying 50% Mean Threshold candle defense & volumetric expansion before entry.
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-1 rounded bg-cyan-900/60 text-cyan-300 font-bold text-[9px] border border-cyan-500/30">
                    GATED VERIFICATION
                  </span>
                </div>
              )}

              {/* ── Active Positions List ────────────────────────────────────── */}
              {activePositions.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {activePositions.map((pos) => {
                    const isLong = pos.direction === 'LONG';
                    return (
                      <div
                        key={pos.id}
                        className="border border-cyan-500/40 bg-gradient-to-r from-card/90 via-slate-900/90 to-cyan-950/30 rounded-xl p-4 flex flex-col gap-3 shadow-lg"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                              pos.timeframe === '1h' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' :
                              pos.timeframe === '15m' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' :
                              'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            }`}>
                              {pos.timeframe.toUpperCase()}
                            </span>

                            {pos.dbTradeId ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold flex items-center gap-1" title={pos.dbTradeId}>
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span>DB: #{pos.dbTradeId.slice(0, 8)}</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/40 text-[9px] font-bold">
                                SYNCING DB...
                              </span>
                            )}

                            {pos.isRehydrated && (
                              <span className="px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-500/40 text-[9px] font-bold">
                                RE-HYDRATED
                              </span>
                            )}

                            <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase flex items-center gap-1.5 ${
                              isLong
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            }`}>
                              {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {pos.direction}
                            </span>
                            <span className="text-sm font-black text-white">${pos.entryPrice}</span>
                            <span className="text-[10px] text-muted">
                              SL: <strong className="text-slate-200">${pos.activeStopLoss}</strong>
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <span className="text-[9px] text-muted uppercase">Unrealized R</span>
                              <div className={`text-sm font-black ${pos.unrealizedR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {pos.unrealizedR > 0 ? '+' : ''}{pos.unrealizedR}R
                              </div>
                            </div>
                            <div className="text-right border-l border-card-border pl-3">
                              <span className="text-[9px] text-muted uppercase">Realized Secured</span>
                              <div className="text-sm font-black text-cyan-300">
                                +{pos.realizedR}R
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 3-Stage Visual Pipeline */}
                        <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                          <div className={`p-2 rounded-lg border flex flex-col justify-between ${
                            pos.isTp1Filled
                              ? 'bg-emerald-950/50 border-emerald-500/70 text-emerald-300 font-bold'
                              : 'bg-card/40 border-card-border text-muted'
                          }`}>
                            <div className="flex items-center justify-between">
                              <span>Stage 1 (40%)</span>
                              {pos.isTp1Filled ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <span className="text-[8px]">1.0R</span>}
                            </div>
                            <span className="text-[9px] opacity-90">${pos.tp1Price}</span>
                          </div>

                          <div className={`p-2 rounded-lg border flex flex-col justify-between ${
                            pos.isTp2Filled
                              ? 'bg-emerald-950/50 border-emerald-500/70 text-emerald-300 font-bold'
                              : 'bg-card/40 border-card-border text-muted'
                          }`}>
                            <div className="flex items-center justify-between">
                              <span>Stage 2 (40%)</span>
                              {pos.isTp2Filled ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <span className="text-[8px]">1.5R</span>}
                            </div>
                            <span className="text-[9px] opacity-90">${pos.tp2Price}</span>
                          </div>

                          <div className={`p-2 rounded-lg border flex flex-col justify-between ${
                            pos.isTp3Filled
                              ? 'bg-purple-950/50 border-purple-500/70 text-purple-300 font-bold'
                              : 'bg-card/40 border-card-border text-muted'
                          }`}>
                            <div className="flex items-center justify-between">
                              <span>Runner (20%)</span>
                              {pos.isTp3Filled ? <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" /> : <span className="text-[8px]">DOL</span>}
                            </div>
                            <span className="text-[9px] opacity-90">${pos.tp3Price}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[9px] text-muted border-t border-card-border/50 pt-2">
                          <span>Active Trailing Stop Anchor: <strong className="text-cyan-300">{pos.trailingSlSource}</strong> ($${pos.activeStopLoss})</span>
                          {pos.activeRatchetFloor && (
                            <span className="text-emerald-400 font-bold">🔒 Profit Ratchet Floor Locked: ${pos.activeRatchetFloor} (+1.0R)</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-muted text-[11px] border border-dashed border-card-border rounded-xl bg-card/10 flex flex-col items-center justify-center gap-2">
                  <Shield className="w-8 h-8 text-muted opacity-40" />
                  <span>Zero Active Trades. Scanning {totalZones} Multi-Timeframe Order Blocks & Breakers...</span>
                  <span className="text-[9px] text-muted-foreground">Enforcing Top-Down Alignment and Single-Position Concurrency Cap (1 Max).</span>
                </div>
              )}

              {/* ── Event Ticker Log ────────────────────────────────────────── */}
              {lastEventMessage && (
                <div className="bg-card/50 border border-card-border rounded-xl p-3 text-[10px] text-foreground flex items-center justify-between">
                  <span className="truncate">{lastEventMessage}</span>
                  <span className="text-[9px] text-muted shrink-0 ml-3">
                    {new Date(lastEventTime).toLocaleTimeString()}
                  </span>
                </div>
              )}
            </>
          )}

          {activeTab === 'ZONES' && (
            <div className="flex flex-col gap-3">
              {/* ── Multi-Timeframe Sub-Filter Bar ─────────────────────────────── */}
              <div className="flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-muted text-[9px] uppercase font-bold flex items-center gap-1 mr-1">
                    <Filter size={11} /> Filter:
                  </span>
                  <button
                    onClick={() => setTimeframeFilter('ALL')}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition cursor-pointer ${
                      timeframeFilter === 'ALL'
                        ? 'bg-slate-700 text-white border border-slate-500'
                        : 'bg-card/40 text-muted hover:text-foreground border border-card-border'
                    }`}
                  >
                    ALL ({totalZones})
                  </button>

                  <button
                    onClick={() => setTimeframeFilter('5m')}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition cursor-pointer flex items-center gap-1 ${
                      timeframeFilter === '5m'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/60'
                        : isTimeframeStreamEnabled('5m')
                        ? 'bg-card/40 text-muted hover:text-foreground border border-card-border'
                        : 'bg-card/20 text-slate-600 border border-card-border/30 line-through'
                    }`}
                  >
                    <span>5m Precision ({count5m})</span>
                    {!isTimeframeStreamEnabled('5m') && <span className="text-[8px] text-rose-400 font-normal">[OFF]</span>}
                  </button>

                  <button
                    onClick={() => setTimeframeFilter('15m')}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition cursor-pointer flex items-center gap-1 ${
                      timeframeFilter === '15m'
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/60'
                        : isTimeframeStreamEnabled('15m')
                        ? 'bg-card/40 text-muted hover:text-foreground border border-card-border'
                        : 'bg-card/20 text-slate-600 border border-card-border/30 line-through'
                    }`}
                  >
                    <span>15m Structural ({count15m})</span>
                    {!isTimeframeStreamEnabled('15m') && <span className="text-[8px] text-rose-400 font-normal">[OFF]</span>}
                  </button>

                  <button
                    onClick={() => setTimeframeFilter('1h')}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition cursor-pointer flex items-center gap-1 ${
                      timeframeFilter === '1h'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/60'
                        : isTimeframeStreamEnabled('1h')
                        ? 'bg-card/40 text-muted hover:text-foreground border border-card-border'
                        : 'bg-card/20 text-slate-600 border border-card-border/30 line-through'
                    }`}
                  >
                    <span>1h Macro ({count1h})</span>
                    {!isTimeframeStreamEnabled('1h') && <span className="text-[8px] text-rose-400 font-normal">[OFF]</span>}
                  </button>
                </div>

                <div className="flex items-center gap-2 text-[9px] text-muted">
                  <span className="flex items-center gap-1 text-emerald-400 font-bold">
                    <Check size={11} /> HTF Aligned
                  </span>
                  <span className="flex items-center gap-1 text-rose-400 font-bold">
                    <Ban size={11} /> Vetoed
                  </span>
                </div>
              </div>

              {/* ── Multi-Timeframe Matrix Grid ─────────────────────────────────── */}
              {activeZones.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {activeZones.map((zone) => {
                    const isBullish = zone.type === 'BULLISH';
                    const isVetoed = zone.htf_alignment_status === 'VETOED_COUNTER_HTF';
                    const is1h = zone.timeframe === '1h';
                    const is15m = zone.timeframe === '15m';

                    return (
                      <div
                        key={`${zone.timeframe}_${zone.id}_${zone.origin_time}`}
                        className={`border rounded-xl p-3.5 flex flex-col justify-between gap-2.5 transition-all ${
                          isVetoed
                            ? 'bg-rose-950/20 border-rose-500/30 opacity-75'
                            : is1h
                            ? 'bg-gradient-to-br from-card/70 via-slate-900/60 to-cyan-950/20 border-cyan-500/40'
                            : is15m
                            ? 'bg-gradient-to-br from-card/70 via-slate-900/60 to-purple-950/20 border-purple-500/40'
                            : 'bg-gradient-to-br from-card/70 via-slate-900/60 to-amber-950/20 border-amber-500/40'
                        }`}
                      >
                        {/* Header Row: TF + Role + Direction + Alignment Badge */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                              is1h ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' :
                              is15m ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' :
                              'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            }`}>
                              {zone.timeframe.toUpperCase()}
                            </span>

                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                              zone.is_breaker
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                : isBullish
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            }`}>
                              {zone.is_breaker ? '⚡ BREAKER' : `${zone.quality_tier} OB`} [{zone.type}]
                            </span>
                          </div>

                          {/* Alignment / Anchor Status */}
                          {zone.structural_weight === '15M_PROMOTED_ANCHOR' ? (
                            <span className="px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-500/30 text-[8px] font-bold flex items-center gap-1" title="1h disabled: 15m promoted to root structural anchor">
                              <Anchor size={10} /> PROMOTED ANCHOR
                            </span>
                          ) : zone.structural_weight === '5M_STANDALONE_TRIGGER' ? (
                            <span className="px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/30 text-[8px] font-bold flex items-center gap-1" title="HTFs disabled: 5m operating in standalone trigger mode">
                              <Crosshair size={10} /> STANDALONE TRIGGER
                            </span>
                          ) : zone.htf_alignment_status === 'HTF_ANCHOR' ? (
                            <span className="px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 text-[8px] font-bold flex items-center gap-1">
                              <Anchor size={10} /> MACRO ANCHOR
                            </span>
                          ) : isVetoed ? (
                            <span className="px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-500/30 text-[8px] font-bold flex items-center gap-1">
                              <Ban size={10} /> VETOED: COUNTER-HTF
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 text-[8px] font-bold flex items-center gap-1">
                              <Check size={10} /> HTF ALIGNED
                            </span>
                          )}
                        </div>

                        {/* Zone Boundaries: Top, 50% MT, Bottom */}
                        <div className="grid grid-cols-3 gap-1.5 text-[10px] bg-background/50 p-2 rounded-lg border border-card-border/40">
                          <div>
                            <span className="text-[8px] text-muted uppercase">Top</span>
                            <div className="font-bold text-foreground">${zone.top.toFixed(2)}</div>
                          </div>
                          <div>
                            <span className="text-[8px] text-cyan-400 uppercase font-bold">50% MT</span>
                            <div className="font-bold text-cyan-300">${zone.mean_threshold.toFixed(2)}</div>
                          </div>
                          <div>
                            <span className="text-[8px] text-muted uppercase">Bottom</span>
                            <div className="font-bold text-foreground">${zone.bottom.toFixed(2)}</div>
                          </div>
                        </div>

                        {/* Validation Gates Summary */}
                        <div className="flex items-center gap-1.5 text-[8px] text-muted">
                          <span className={`px-1.5 py-0.5 rounded border ${zone.gates?.gate1_liquidity_sweep ? 'text-emerald-300 border-emerald-500/30 bg-emerald-950/30' : 'text-slate-500 border-slate-700'}`}>
                            G1: Sweep ({zone.gates?.sweep_type || 'NONE'})
                          </span>
                          <span className={`px-1.5 py-0.5 rounded border ${zone.gates?.gate2_displacement_imbalance ? 'text-emerald-300 border-emerald-500/30 bg-emerald-950/30' : 'text-slate-500 border-slate-700'}`}>
                            G2: FVG ({zone.gates?.fvg_type || 'NONE'})
                          </span>
                          <span className={`px-1.5 py-0.5 rounded border ${zone.gates?.gate3_structure_break ? 'text-emerald-300 border-emerald-500/30 bg-emerald-950/30' : 'text-slate-500 border-slate-700'}`}>
                            G3: {zone.gates?.structure_break_type || 'NONE'}
                          </span>
                        </div>

                        {/* Footer Info */}
                        <div className="text-[8px] text-muted border-t border-card-border/40 pt-1.5 flex items-center justify-between">
                          <span>Origin: {new Date(zone.origin_time).toLocaleTimeString()}</span>
                          {zone.htf_veto_reason ? (
                            <span className="text-rose-400 truncate max-w-[200px]" title={zone.htf_veto_reason}>
                              {zone.htf_veto_reason}
                            </span>
                          ) : (
                            <span>Confluence: <strong className="text-foreground">{zone.confluence_score} pts</strong></span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-muted text-[11px] border border-dashed border-card-border rounded-xl bg-card/10">
                  No active resting zones detected for selected timeframe filter ({timeframeFilter}).
                </div>
              )}
            </div>
          )}

          {activeTab === 'SETTINGS' && (
            <div className="flex flex-col gap-5 max-w-2xl mx-auto py-2">
              {/* ───────────────────────────────────────────────────────────── */}
              {/* SUB-PANEL 1: 🏛️ ORDER BLOCK & BREAKER STRATEGY SETTINGS        */}
              {/* ───────────────────────────────────────────────────────────── */}
              <div className="bg-card/40 border border-slate-800 rounded-xl p-4 flex flex-col gap-3.5">
                <div className="flex items-center justify-between border-b border-card-border/60 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      <Activity className="w-4 h-4" />
                    </span>
                    <div>
                      <h4 className="font-bold text-foreground text-sm flex items-center gap-2">
                        <span>Order Block & Breaker Strategy</span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                          isOrderBlockAutoExecEnabled
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                            : 'bg-card text-muted border border-card-border'
                        }`}>
                          {isOrderBlockAutoExecEnabled ? 'AUTONOMOUS ROUTING' : 'MANUAL WATCH'}
                        </span>
                      </h4>
                      <p className="text-[9px] text-muted">
                        Multi-timeframe resting limit entries with In-Zone testing and HTF sponsorship.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={toggleObAutoExecute}
                    className={`px-3 py-1.5 rounded-lg border font-bold text-[10px] uppercase transition cursor-pointer flex items-center gap-1.5 ${
                      isOrderBlockAutoExecEnabled
                        ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
                        : 'bg-card border-card-border text-muted hover:text-foreground'
                    }`}
                  >
                    {isOrderBlockAutoExecEnabled ? <Play size={10} className="fill-emerald-400" /> : <Pause size={10} />}
                    <span>{isOrderBlockAutoExecEnabled ? 'AUTO-EXEC ON' : 'DISABLED'}</span>
                  </button>
                </div>

                {/* Preset Deck for Order Block Strategy */}
                <ScannerPresetControlDeck
                  strategyType="ORDER_BLOCK"
                  currentConfig={currentObLivePresetConfig}
                  onApplyPreset={handleApplyObLivePreset}
                />

                {/* ── Multi-Timeframe Stream Ingestion Matrix ── */}
                <div className="flex flex-col gap-2 bg-background/50 p-3 rounded-lg border border-card-border/40">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="font-bold text-foreground text-[11px]">MTF Stream Ingestion Matrix</span>
                    </div>
                    <span className="text-[8px] text-muted-foreground uppercase font-bold">
                      {enabledTimeframes?.length || 3} of 3 Active
                    </span>
                  </div>
                  <p className="text-[9px] text-muted">
                    Enable or suspend background candle processing per timeframe. Alignment gatekeepers adapt automatically.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
                    {/* 5m Precision Stream */}
                    <button
                      type="button"
                      onClick={() => toggleTimeframeStream('5m')}
                      className={`p-2.5 rounded-lg border text-left flex flex-col justify-between gap-1 transition cursor-pointer ${
                        isTimeframeStreamEnabled('5m')
                          ? 'bg-amber-950/40 border-2 border-amber-400 text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.3)]'
                          : 'bg-slate-950/80 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-mono font-black uppercase ${isTimeframeStreamEnabled('5m') ? 'text-amber-400' : 'text-slate-500'}`}>5M PRECISION</span>
                        <span className={`w-2 h-2 rounded-full ${isTimeframeStreamEnabled('5m') ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse' : 'bg-slate-700'}`} />
                      </div>
                      <span className={`text-[8.5px] font-bold ${isTimeframeStreamEnabled('5m') ? 'text-amber-200' : 'text-slate-600'}`}>
                        {isTimeframeStreamEnabled('5m') ? '✓ Live Trigger Enabled' : '✕ Stream Suspended'}
                      </span>
                    </button>

                    {/* 15m Structural Stream */}
                    <button
                      type="button"
                      onClick={() => toggleTimeframeStream('15m')}
                      className={`p-2.5 rounded-lg border text-left flex flex-col justify-between gap-1 transition cursor-pointer ${
                        isTimeframeStreamEnabled('15m')
                          ? 'bg-purple-950/40 border-2 border-purple-400 text-purple-300 shadow-[0_0_15px_rgba(192,132,252,0.3)]'
                          : 'bg-slate-950/80 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-mono font-black uppercase ${isTimeframeStreamEnabled('15m') ? 'text-purple-400' : 'text-slate-500'}`}>15M STRUCTURAL</span>
                        <span className={`w-2 h-2 rounded-full ${isTimeframeStreamEnabled('15m') ? 'bg-purple-400 shadow-[0_0_8px_#c084fc] animate-pulse' : 'bg-slate-700'}`} />
                      </div>
                      <span className={`text-[8.5px] font-bold ${isTimeframeStreamEnabled('15m') ? 'text-purple-200' : 'text-slate-600'}`}>
                        {isTimeframeStreamEnabled('15m') ? '✓ Structural Anchor' : '✕ Stream Suspended'}
                      </span>
                    </button>

                    {/* 1h Macro Stream */}
                    <button
                      type="button"
                      onClick={() => toggleTimeframeStream('1h')}
                      className={`p-2.5 rounded-lg border text-left flex flex-col justify-between gap-1 transition cursor-pointer ${
                        isTimeframeStreamEnabled('1h')
                          ? 'bg-cyan-950/40 border-2 border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.3)]'
                          : 'bg-slate-950/80 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-mono font-black uppercase ${isTimeframeStreamEnabled('1h') ? 'text-cyan-400' : 'text-slate-500'}`}>1H MACRO</span>
                        <span className={`w-2 h-2 rounded-full ${isTimeframeStreamEnabled('1h') ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse' : 'bg-slate-700'}`} />
                      </div>
                      <span className={`text-[8.5px] font-bold ${isTimeframeStreamEnabled('1h') ? 'text-cyan-200' : 'text-slate-600'}`}>
                        {isTimeframeStreamEnabled('1h') ? '✓ Macro Anchor' : '✕ Stream Suspended'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Higher-Timeframe Alignment Setting */}
                <div className="flex items-center justify-between bg-background/50 p-3 rounded-lg border border-card-border/40">
                  <div className="flex items-center gap-2">
                    <Anchor className="w-3.5 h-3.5 text-cyan-400" />
                    <div>
                      <div className="font-bold text-foreground text-[11px]">HTF Alignment Gatekeeper</div>
                      <p className="text-[8px] text-muted">Veto counter-trend 5m precision entries unless sponsored by 15m/1h structure.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setEnforceHtfAlignment(!engineConfig.enforceHtfAlignment)}
                    className={`px-3 py-1.5 rounded text-[9px] font-black uppercase transition cursor-pointer border ${
                      engineConfig.enforceHtfAlignment
                        ? 'bg-emerald-400 border-emerald-300 text-slate-950 shadow-[0_0_10px_rgba(52,211,153,0.45)]'
                        : 'bg-amber-400 border-amber-300 text-slate-950 shadow-[0_0_10px_rgba(251,191,36,0.45)]'
                    }`}
                  >
                    {engineConfig.enforceHtfAlignment ? 'STRICT ALIGNED' : 'PERMISSIVE (OFF)'}
                  </button>
                </div>

                {/* Position Scaling Model */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase font-bold text-muted flex items-center gap-1">
                    <Sliders className="w-3 h-3 text-cyan-400" /> Position Scaling Model
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setScalingMode('THREE_STAGE_HARVEST')}
                      className={`p-2 rounded-lg border text-left flex flex-col gap-0.5 transition cursor-pointer ${
                        engineConfig.positionScalingMode === 'THREE_STAGE_HARVEST'
                          ? 'bg-emerald-400 border-emerald-300 text-slate-950 font-black shadow-[0_0_10px_rgba(52,211,153,0.4)]'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span className="text-[9px] font-black">3-Stage (40/40/20)</span>
                      <span className={`text-[8px] ${engineConfig.positionScalingMode === 'THREE_STAGE_HARVEST' ? 'text-slate-900 font-bold' : 'opacity-75'}`}>1.0R / 1.5R / Runner</span>
                    </button>

                    <button
                      onClick={() => setScalingMode('TWO_STAGE_DYNAMIC')}
                      className={`p-2 rounded-lg border text-left flex flex-col gap-0.5 transition cursor-pointer ${
                        engineConfig.positionScalingMode === 'TWO_STAGE_DYNAMIC'
                          ? 'bg-emerald-400 border-emerald-300 text-slate-950 font-black shadow-[0_0_10px_rgba(52,211,153,0.4)]'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span className="text-[9px] font-black">2-Stage (50/50)</span>
                      <span className={`text-[8px] ${engineConfig.positionScalingMode === 'TWO_STAGE_DYNAMIC' ? 'text-slate-900 font-bold' : 'opacity-75'}`}>1.0R Scale + Runner</span>
                    </button>

                    <button
                      onClick={() => setScalingMode('SINGLE_STAGE')}
                      className={`p-2 rounded-lg border text-left flex flex-col gap-0.5 transition cursor-pointer ${
                        engineConfig.positionScalingMode === 'SINGLE_STAGE'
                          ? 'bg-emerald-400 border-emerald-300 text-slate-950 font-black shadow-[0_0_10px_rgba(52,211,153,0.4)]'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span className="text-[9px] font-black">Single 2.5R</span>
                      <span className={`text-[8px] ${engineConfig.positionScalingMode === 'SINGLE_STAGE' ? 'text-slate-900 font-bold' : 'opacity-75'}`}>100% Fixed Target</span>
                    </button>
                  </div>
                </div>

                {/* Trailing Stop Loss Logic */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase font-bold text-muted flex items-center gap-1">
                    <Shield className="w-3 h-3 text-emerald-400" /> Trailing Stop Loss Logic
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setTrailingMode('STRUCTURAL_FVG_TRAIL')}
                      className={`p-2 rounded-lg border text-left flex flex-col gap-0.5 transition cursor-pointer ${
                        engineConfig.trailingStopMode === 'STRUCTURAL_FVG_TRAIL'
                          ? 'bg-emerald-400 border-emerald-300 text-slate-950 font-black shadow-[0_0_10px_rgba(52,211,153,0.4)]'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span className="text-[9px] font-black">Structural FVG CE</span>
                      <span className={`text-[8px] ${engineConfig.trailingStopMode === 'STRUCTURAL_FVG_TRAIL' ? 'text-slate-900 font-bold' : 'opacity-75'}`}>Breathing Room Model</span>
                    </button>

                    <button
                      onClick={() => setTrailingMode('STATIC_BREAKEVEN')}
                      className={`p-2 rounded-lg border text-left flex flex-col gap-0.5 transition cursor-pointer ${
                        engineConfig.trailingStopMode === 'STATIC_BREAKEVEN'
                          ? 'bg-emerald-400 border-emerald-300 text-slate-950 font-black shadow-[0_0_10px_rgba(52,211,153,0.4)]'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span className="text-[9px] font-black">Static Breakeven</span>
                      <span className={`text-[8px] ${engineConfig.trailingStopMode === 'STATIC_BREAKEVEN' ? 'text-slate-900 font-bold' : 'opacity-75'}`}>Snaps SL to Entry</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* ───────────────────────────────────────────────────────────── */}
              {/* SUB-PANEL 2: ⚡ SWEEP & RECLAIM 3-PILLAR STRATEGY SETTINGS      */}
              {/* ───────────────────────────────────────────────────────────── */}
              <div className="bg-card/40 border border-slate-800 rounded-xl p-4 flex flex-col gap-4">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-card-border/60 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                      <Zap className="w-4 h-4" />
                    </span>
                    <div>
                      <h4 className="font-bold text-foreground text-sm flex items-center gap-2">
                        <span>Sweep & Reclaim Strategy</span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                          isSweepReclaimAutoExecEnabled
                            ? 'bg-cyan-400 text-slate-950 font-black shadow-[0_0_8px_rgba(34,211,238,0.3)]'
                            : 'bg-card text-muted border border-card-border'
                        }`}>
                          {isSweepReclaimAutoExecEnabled ? 'AUTONOMOUS ROUTING' : 'MANUAL WATCH'}
                        </span>
                      </h4>
                      <p className="text-[9px] text-muted">
                        Institutional 4-Phase Liquidity Sweep, 3-Pillar Displacement & Compounding Execution.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={toggleSrAutoExecute}
                    className={`px-3 py-1.5 rounded-lg border font-black text-[10px] uppercase transition cursor-pointer flex items-center gap-1.5 ${
                      isSweepReclaimAutoExecEnabled
                        ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                        : 'bg-card border-card-border text-muted hover:text-foreground'
                    }`}
                  >
                    {isSweepReclaimAutoExecEnabled ? <Play size={10} className="fill-slate-950 text-slate-950" /> : <Pause size={10} />}
                    <span>{isSweepReclaimAutoExecEnabled ? 'AUTO-EXEC ON' : 'DISABLED'}</span>
                  </button>
                </div>

                {/* Preset Deck for Sweep & Reclaim Strategy */}
                <ScannerPresetControlDeck
                  strategyType="SWEEP_RECLAIM"
                  currentConfig={currentSrLivePresetConfig}
                  onApplyPreset={handleApplySrLivePreset}
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

                {/* 2. Multi-Timeframe Stream Ingestion Matrix for S&R */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-cyan-400" />
                      Multi-Timeframe Ingestion Matrix
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {srSettings?.enabledTimeframes?.length || 3} Active Streams
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {(['5m', '15m', '1h'] as const).map((tf) => {
                      const isEnabled = srSettings?.enabledTimeframes?.includes(tf) ?? true;
                      const activeColorClasses = tf === '5m'
                        ? 'bg-amber-950/40 border-2 border-amber-400 text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.3)]'
                        : tf === '15m'
                        ? 'bg-purple-950/40 border-2 border-purple-400 text-purple-300 shadow-[0_0_15px_rgba(192,132,252,0.3)]'
                        : 'bg-cyan-950/40 border-2 border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.3)]';

                      const titleColor = isEnabled
                        ? tf === '5m'
                          ? 'text-amber-400'
                          : tf === '15m'
                          ? 'text-purple-400'
                          : 'text-cyan-400'
                        : 'text-slate-500';

                      const dotColor = isEnabled
                        ? tf === '5m'
                          ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse'
                          : tf === '15m'
                          ? 'bg-purple-400 shadow-[0_0_8px_#c084fc] animate-pulse'
                          : 'bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse'
                        : 'bg-slate-700';

                      const subtextColor = isEnabled
                        ? tf === '5m'
                          ? 'text-amber-200 font-bold'
                          : tf === '15m'
                          ? 'text-purple-200 font-bold'
                          : 'text-cyan-200 font-bold'
                        : 'text-slate-600 font-medium';

                      return (
                        <button
                          key={tf}
                          type="button"
                          onClick={() => {
                            const current = srSettings?.enabledTimeframes || ['5m', '15m', '1h'];
                            let next: ('5m' | '15m' | '1h')[];
                            if (current.includes(tf)) {
                              if (current.length <= 1) return;
                              next = current.filter(t => t !== tf);
                            } else {
                              next = [...current, tf];
                            }
                            updateSrSettings({ enabledTimeframes: next });
                          }}
                          className={`p-2.5 rounded-lg border text-left transition flex flex-col gap-1 cursor-pointer ${
                            isEnabled
                              ? activeColorClasses
                              : 'bg-slate-950/80 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-black font-mono uppercase ${titleColor}`}>{tf} Stream</span>
                            <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                          </div>
                          <span className={`text-[8.5px] ${subtextColor}`}>
                            {isEnabled ? 'ACTIVE INGESTION' : 'STREAM SUSPENDED'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Multi-Timeframe Anchor Selection */}
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

                {/* 4. 3-Pillar Displacement Gatekeeper & Volumetric Parameters */}
                <div className="bg-background/50 p-3 rounded-lg border border-card-border/40 flex flex-col gap-2.5">
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
                          {(srSettings?.volumeExpansionThreshold ?? 1.50).toFixed(2)}x
                        </span>
                      </label>
                      <input
                        type="range"
                        min="1.0"
                        max="2.5"
                        step="0.05"
                        value={srSettings?.volumeExpansionThreshold ?? 1.50}
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
                          {(srSettings?.deltaDominanceThreshold ?? 55.0).toFixed(1)}%
                        </span>
                      </label>
                      <input
                        type="range"
                        min="50.0"
                        max="75.0"
                        step="0.5"
                        value={srSettings?.deltaDominanceThreshold ?? 55.0}
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
                          {((srSettings?.bodyRatioThreshold ?? 0.55) * 100).toFixed(0)}%
                        </span>
                      </label>
                      <input
                        type="range"
                        min="0.30"
                        max="0.80"
                        step="0.05"
                        value={srSettings?.bodyRatioThreshold ?? 0.55}
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

                {/* 5. Retest Entry Model & Gating Grid (All 8 Modes) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px]">
                  {/* Entry Model Selection (All 8 Modes) */}
                  <div className="flex flex-col gap-1.5 bg-background/40 p-2.5 rounded-lg border border-card-border/50">
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
                  <div className="flex flex-col gap-1.5 bg-background/40 p-2.5 rounded-lg border border-card-border/50">
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

                {/* 6. Dynamic Multi-Stage Harvest Targets (3-Stage Harvest & HTF DOL) */}
                <div className="bg-background/50 p-3 rounded-lg border border-card-border/40 flex flex-col gap-2.5">
                  <div className="font-bold text-slate-300 uppercase text-[10px] flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5 text-cyan-400" />
                      3-Stage Harvest & Automated Risk Scaling
                    </span>
                    <span className="text-cyan-400 text-[9px] font-mono font-bold">40% / 40% / 20% RATIO</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[9px]">
                    {/* Stage 1: Auto-Breakeven & Partial Close */}
                    <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[8px] uppercase font-bold">Stage 1: TP1 Scale-Out</span>
                        <button
                          type="button"
                          onClick={() => updateSrSettings({ enableTp1AutoBreakeven: !(srSettings?.enableTp1AutoBreakeven ?? true) })}
                          className={`px-1.5 py-0.5 rounded text-[7.5px] font-black cursor-pointer transition ${
                            (srSettings?.enableTp1AutoBreakeven ?? true)
                              ? 'bg-emerald-400 border-emerald-300 text-slate-950 shadow-[0_0_8px_rgba(52,211,153,0.45)]'
                              : 'bg-slate-900 border border-slate-800 text-slate-500'
                          }`}
                        >
                          {(srSettings?.enableTp1AutoBreakeven ?? true) ? 'AUTO-BE ON' : 'OFF'}
                        </button>
                      </div>
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

                    {/* Stage 2: Main Harvest Target */}
                    <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-1.5">
                      <span className="text-slate-400 text-[8px] uppercase font-bold">Stage 2: Main Harvest</span>
                      <div className="grid grid-cols-3 gap-1">
                        {[1.5, 2.0, 2.5].map((val) => {
                          const isSelected = (srSettings?.stage2Multiple ?? 1.5) === val;
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

                    {/* Stage 3: Runner Target & HTF DOL Routing */}
                    <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[8px] uppercase font-bold">Stage 3: Runner Exit</span>
                        <button
                          type="button"
                          onClick={() => updateSrSettings({ routeRunnerToHtfDol: !(srSettings?.routeRunnerToHtfDol ?? true) })}
                          className={`px-1.5 py-0.5 rounded text-[7.5px] font-black cursor-pointer transition ${
                            (srSettings?.routeRunnerToHtfDol ?? true)
                              ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_8px_rgba(34,211,238,0.4)]'
                              : 'bg-slate-900 border border-slate-800 text-slate-500'
                          }`}
                        >
                          {(srSettings?.routeRunnerToHtfDol ?? true) ? 'HTF DOL ON' : 'STATIC'}
                        </button>
                      </div>
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

                {/* 7. Temporal & Statistical Gate Toggles */}
                <div className="bg-background/50 p-3 rounded-lg border border-card-border/40 flex flex-col gap-2.5">
                  <div className="font-bold text-slate-300 uppercase text-[10px] flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                      Temporal, Statistical & Directional Execution Locks
                    </span>
                    <span className="text-cyan-400 text-[9px] font-mono font-bold">QUANT GATES</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[9px]">
                    {/* Execution Timing */}
                    <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-1.5">
                      <span className="text-slate-400 text-[8px] uppercase font-bold flex items-center gap-1">
                        <Timer className="w-3 h-3 text-cyan-400" /> Execution Timing
                      </span>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={() => updateSrSettings({ executionTiming: 'INSTANT' })}
                          className={`py-1.5 rounded border text-center font-mono font-black text-[8.5px] cursor-pointer transition ${
                            (srSettings?.executionTiming || 'INSTANT') === 'INSTANT'
                              ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.5)]'
                              : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          ⚡ INSTANT
                        </button>
                        <button
                          type="button"
                          onClick={() => updateSrSettings({ executionTiming: 'ON_CLOSE' })}
                          className={`py-1.5 rounded border text-center font-mono font-black text-[8.5px] cursor-pointer transition ${
                            srSettings?.executionTiming === 'ON_CLOSE'
                              ? 'bg-purple-400 border-purple-300 text-slate-950 shadow-[0_0_12px_rgba(192,132,252,0.5)]'
                              : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          ⏳ ON_CLOSE
                        </button>
                      </div>
                    </div>

                    {/* OLS Statistical Sensitivity */}
                    <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-1.5">
                      <span className="text-slate-400 text-[8px] uppercase font-bold flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-cyan-400" /> OLS Sensitivity
                      </span>
                      <div className="grid grid-cols-3 gap-1">
                        {(['STRICT', 'RELAXED', 'OFF'] as const).map((mode) => {
                          const isSelected = (srSettings?.olsSensitivity || 'RELAXED') === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => updateSrSettings({ olsSensitivity: mode })}
                              className={`py-1.5 rounded border text-center font-mono font-black text-[8px] cursor-pointer transition ${
                                isSelected
                                  ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {mode}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Directional Execution Lock */}
                    <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-1.5">
                      <span className="text-slate-400 text-[8px] uppercase font-bold flex items-center gap-1">
                        <Compass className="w-3 h-3 text-cyan-400" /> Directional Lock
                      </span>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { id: 'DUAL', label: 'DUAL' },
                          { id: 'LONGS_ONLY', label: 'LONGS' },
                          { id: 'SHORTS_ONLY', label: 'SHORTS' },
                        ].map((item) => {
                          const isSelected = (srSettings?.directionalLock || 'DUAL') === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => updateSrSettings({ directionalLock: item.id as any })}
                              className={`py-1.5 rounded border text-center font-mono font-black text-[8px] cursor-pointer transition ${
                                isSelected
                                  ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {item.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Session Killzone Gates & Momentum Override */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-900">
                    {/* Session Killzones */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8.5px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1 shrink-0">
                        <Globe className="w-3 h-3 text-cyan-400" /> Sessions:
                      </span>
                      {(['ASIAN', 'LONDON', 'NY'] as const).map((session) => {
                        const isEnabled = (srSettings?.sessionGates || ['ASIAN', 'LONDON', 'NY']).includes(session);
                        return (
                          <button
                            key={session}
                            type="button"
                            onClick={() => {
                              const current = srSettings?.sessionGates || ['ASIAN', 'LONDON', 'NY'];
                              let next: ('ASIAN' | 'LONDON' | 'NY')[];
                              if (current.includes(session)) {
                                if (current.length <= 1) return;
                                next = current.filter((s) => s !== session);
                              } else {
                                next = [...current, session];
                              }
                              updateSrSettings({ sessionGates: next });
                            }}
                            className={`px-2.5 py-1 rounded border text-[8px] font-mono font-black cursor-pointer transition ${
                              isEnabled
                                ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_8px_rgba(34,211,238,0.45)]'
                                : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {session}
                          </button>
                        );
                      })}
                    </div>

                    {/* Momentum Protection Toggle */}
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => updateSrSettings({ enableMomentumOverride: !(srSettings?.enableMomentumOverride ?? true) })}
                        className={`px-2.5 py-1 rounded border font-mono font-black text-[8.5px] cursor-pointer flex items-center gap-1.5 transition ${
                          (srSettings?.enableMomentumOverride ?? true)
                            ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                            : 'bg-slate-900/80 border-slate-800 text-slate-500'
                        }`}
                      >
                        <Flame className={`w-3 h-3 ${(srSettings?.enableMomentumOverride ?? true) ? 'text-slate-950' : 'text-cyan-400'}`} />
                        <span>Runaway Momentum Override: {(srSettings?.enableMomentumOverride ?? true) ? 'ON' : 'OFF'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* 8. Trailing Stop Loss & Profit Ratchet Controls */}
                <div className="flex items-center justify-between text-[9px] bg-background/30 p-2.5 rounded-lg border border-card-border/40">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateSrSettings({ enableStructuralTrail: !(srSettings?.enableStructuralTrail ?? true) })}
                      className={`px-2.5 py-1.5 rounded border font-black text-[8.5px] cursor-pointer flex items-center gap-1.5 transition ${
                        (srSettings?.enableStructuralTrail ?? true)
                          ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                          : 'bg-slate-900/80 border-slate-800 text-slate-500'
                      }`}
                    >
                      <Lock className={`w-3 h-3 ${(srSettings?.enableStructuralTrail ?? true) ? 'text-slate-950' : 'text-cyan-400'}`} />
                      <span>Structural FVG Trail: {(srSettings?.enableStructuralTrail ?? true) ? 'ON' : 'OFF'}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateSrSettings({ enableProfitRatchet: !(srSettings?.enableProfitRatchet ?? true) })}
                      className={`px-2.5 py-1.5 rounded border font-black text-[8.5px] cursor-pointer flex items-center gap-1.5 transition ${
                        (srSettings?.enableProfitRatchet ?? true)
                          ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                          : 'bg-slate-900/80 border-slate-800 text-slate-500'
                      }`}
                    >
                      <TrendingUp className={`w-3 h-3 ${(srSettings?.enableProfitRatchet ?? true) ? 'text-slate-950' : 'text-cyan-400'}`} />
                      <span>+1.0R Ratchet @ Stage 2: {(srSettings?.enableProfitRatchet ?? true) ? 'ON' : 'OFF'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Modal Footer ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-card-border bg-card/30 shrink-0 text-[10px] text-muted">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span>Binance Futures WebSocket: <strong>{isConnected ? 'LIVE ACTIVE' : 'DISCONNECTED'}</strong></span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-card hover:bg-card-border border border-card-border text-foreground font-bold transition cursor-pointer"
          >
            Close Cockpit
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LiveOrderBlockModal(props: LiveOrderBlockModalProps) {
  if (!props.isOpen) return null;
  return <LiveOrderBlockModalContent {...props} />;
}
