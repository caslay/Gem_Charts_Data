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
  Anchor
} from 'lucide-react';
import { useLiveOrderBlockExecution } from '@/hooks/useLiveOrderBlockExecution';

interface LiveOrderBlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbol?: string;
}

export default function LiveOrderBlockModal({
  isOpen,
  onClose,
  symbol = 'ETHUSDC.p'
}: LiveOrderBlockModalProps) {
  const {
    engineConfig,
    setEngineConfig,
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
    toggleAutoExecute,
    setScalingMode,
    setTrailingMode,
    setEnforceHtfAlignment
  } = useLiveOrderBlockExecution();

  const [activeTab, setActiveTab] = useState<'EXECUTION' | 'ZONES' | 'SETTINGS'>('EXECUTION');

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
                Simultaneous background tracking across 5m, 15m & 1h with Top-Down HTF Alignment gating and 3-Stage scaling (40/40/20).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Auto Execute Toggle Button */}
            <button
              type="button"
              onClick={toggleAutoExecute}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-bold uppercase transition-all cursor-pointer text-[10px] ${
                engineConfig.autoExecute
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/80 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
                  : 'bg-card border-card-border text-muted hover:text-foreground'
              }`}
            >
              {engineConfig.autoExecute ? (
                <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />
              ) : (
                <Pause className="w-3 h-3" />
              )}
              <span>{engineConfig.autoExecute ? 'AUTO-EXEC ON' : 'MANUAL WATCH'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-card border border-transparent hover:border-card-border transition-all cursor-pointer ml-1"
            >
              <X size={16} />
            </button>
          </div>
        </div>

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
                      <span className="text-amber-400">{count5m}·5m</span>
                      <span className="text-slate-500">/</span>
                      <span className="text-purple-400">{count15m}·15m</span>
                      <span className="text-slate-500">/</span>
                      <span className="text-cyan-400">{count1h}·1h</span>
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
                <div className="flex items-center gap-1.5">
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
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition cursor-pointer ${
                      timeframeFilter === '5m'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/60'
                        : 'bg-card/40 text-muted hover:text-foreground border border-card-border'
                    }`}
                  >
                    5m Precision ({count5m})
                  </button>

                  <button
                    onClick={() => setTimeframeFilter('15m')}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition cursor-pointer ${
                      timeframeFilter === '15m'
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/60'
                        : 'bg-card/40 text-muted hover:text-foreground border border-card-border'
                    }`}
                  >
                    15m Structural ({count15m})
                  </button>

                  <button
                    onClick={() => setTimeframeFilter('1h')}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition cursor-pointer ${
                      timeframeFilter === '1h'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/60'
                        : 'bg-card/40 text-muted hover:text-foreground border border-card-border'
                    }`}
                  >
                    1h Macro ({count1h})
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
                        key={zone.id}
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
                          {zone.htf_alignment_status === 'HTF_ANCHOR' ? (
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
            <div className="flex flex-col gap-4 max-w-xl mx-auto py-2">
              {/* ── Higher-Timeframe Alignment Setting ────────────────────────── */}
              <div className="bg-card/40 border border-card-border rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Anchor className="w-4 h-4 text-cyan-400" />
                    <div>
                      <h4 className="font-bold text-foreground text-sm">Higher-Timeframe (HTF) Alignment</h4>
                      <p className="text-[9px] text-muted">Veto counter-trend 5m precision entries unless sponsored by 15m/1h structure.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setEnforceHtfAlignment(!engineConfig.enforceHtfAlignment)}
                    className={`px-3 py-1.5 rounded-lg border font-bold text-[10px] uppercase transition cursor-pointer ${
                      engineConfig.enforceHtfAlignment
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                        : 'bg-card border-card-border text-muted hover:text-foreground'
                    }`}
                  >
                    {engineConfig.enforceHtfAlignment ? 'ENABLED (STRICT)' : 'DISABLED (PERMISSIVE)'}
                  </button>
                </div>
              </div>

              {/* ── Position Scaling Model ──────────────────────────────────── */}
              <div className="bg-card/40 border border-card-border rounded-xl p-4 flex flex-col gap-3">
                <h4 className="font-bold text-foreground text-sm flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-cyan-400" />
                  <span>Position Scaling Model</span>
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setScalingMode('THREE_STAGE_HARVEST')}
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition cursor-pointer ${
                      engineConfig.positionScalingMode === 'THREE_STAGE_HARVEST'
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold'
                        : 'bg-card/30 border-card-border text-muted hover:text-foreground'
                    }`}
                  >
                    <span className="text-[10px]">3-Stage (40/40/20)</span>
                    <span className="text-[8px] opacity-75">1.0R / 1.5R / Runner</span>
                  </button>

                  <button
                    onClick={() => setScalingMode('TWO_STAGE_DYNAMIC')}
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition cursor-pointer ${
                      engineConfig.positionScalingMode === 'TWO_STAGE_DYNAMIC'
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold'
                        : 'bg-card/30 border-card-border text-muted hover:text-foreground'
                    }`}
                  >
                    <span className="text-[10px]">2-Stage (50/50)</span>
                    <span className="text-[8px] opacity-75">1.0R Scale + Runner</span>
                  </button>

                  <button
                    onClick={() => setScalingMode('SINGLE_STAGE')}
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition cursor-pointer ${
                      engineConfig.positionScalingMode === 'SINGLE_STAGE'
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold'
                        : 'bg-card/30 border-card-border text-muted hover:text-foreground'
                    }`}
                  >
                    <span className="text-[10px]">Single 2.5R</span>
                    <span className="text-[8px] opacity-75">100% Fixed Target</span>
                  </button>
                </div>
              </div>

              {/* ── Trailing Stop Loss Logic ─────────────────────────────────── */}
              <div className="bg-card/40 border border-card-border rounded-xl p-4 flex flex-col gap-3">
                <h4 className="font-bold text-foreground text-sm flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <span>Trailing Stop Loss Logic</span>
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setTrailingMode('STRUCTURAL_FVG_TRAIL')}
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition cursor-pointer ${
                      engineConfig.trailingStopMode === 'STRUCTURAL_FVG_TRAIL'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                        : 'bg-card/30 border-card-border text-muted hover:text-foreground'
                    }`}
                  >
                    <span className="text-[10px]">Structural FVG CE</span>
                    <span className="text-[8px] opacity-75">Breathing Room Model</span>
                  </button>

                  <button
                    onClick={() => setTrailingMode('STATIC_BREAKEVEN')}
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition cursor-pointer ${
                      engineConfig.trailingStopMode === 'STATIC_BREAKEVEN'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                        : 'bg-card/30 border-card-border text-muted hover:text-foreground'
                    }`}
                  >
                    <span className="text-[10px]">Static Breakeven</span>
                    <span className="text-[8px] opacity-75">Snaps SL to Entry</span>
                  </button>
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
