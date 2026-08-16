'use client';

import React, { useState } from 'react';
import {
  Shield,
  Zap,
  CheckCircle2,
  AlertCircle,
  Play,
  Pause,
  Layers,
  Repeat,
  Crosshair,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Activity,
  Clock,
  Lock
} from 'lucide-react';
import { useLiveOrderBlockExecution } from '@/hooks/useLiveOrderBlockExecution';

export default function LiveOrderBlockExecutionHUD() {
  const {
    engineConfig,
    activePositions,
    activeZones,
    closedLiveTrades,
    lastEventMessage,
    lastEventTime,
    isConnected,
    cooldownRemainingSec,
    testingStates,
    toggleAutoExecute,
    setScalingMode,
    setTrailingMode
  } = useLiveOrderBlockExecution();

  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="bg-slate-950/90 border border-slate-800 backdrop-blur-md rounded-lg p-3 font-mono shadow-2xl transition-all max-w-full">
      {/* ── HUD Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="text-[11px] font-black tracking-wider uppercase text-slate-100 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Phase 7 Live OB Execution</span>
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 font-bold">
            3-STAGE (40/40/20)
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-500/30 font-bold flex items-center gap-1">
            <Lock className="w-2.5 h-2.5" />
            <span>CAP: 1 POS</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-Execute Toggle */}
          <button
            type="button"
            onClick={toggleAutoExecute}
            className={`px-2.5 py-1 rounded text-[9px] font-bold uppercase transition flex items-center gap-1 border ${
              engineConfig.autoExecute
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/80 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {engineConfig.autoExecute ? <Play className="w-2.5 h-2.5 text-emerald-400 fill-emerald-400" /> : <Pause className="w-2.5 h-2.5" />}
            <span>{engineConfig.autoExecute ? 'AUTO-EXECUTE ON' : 'MANUAL WATCH'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="pt-2.5 flex flex-col gap-2.5">
          {/* ── Cooldown Alert Banner ───────────────────────────────────────── */}
          {cooldownRemainingSec > 0 && (
            <div className="bg-amber-950/50 border border-amber-500/40 rounded p-2 text-[10px] text-amber-300 flex items-center justify-between animate-pulse">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-bold uppercase tracking-wider">Post-Trade Safety Cooldown Active</span>
              </div>
              <span className="font-mono font-bold bg-amber-900/80 px-2 py-0.5 rounded text-amber-200 border border-amber-500/30">
                {cooldownRemainingSec}s remaining
              </span>
            </div>
          )}

          {/* ── In-Zone Confirmation Pending Banner ──────────────────────────── */}
          {testingStates.length > 0 && activePositions.length === 0 && (
            <div className="bg-cyan-950/40 border border-cyan-500/40 rounded p-2 text-[10px] text-cyan-300 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                <span className="font-bold">Awaiting In-Zone Volumetric Confirmation</span>
              </div>
              <span className="text-[9px] text-cyan-400 bg-cyan-900/60 px-1.5 py-0.5 rounded">
                MT Defense & Vol &ge; 1.25x
              </span>
            </div>
          )}

          {/* ── Active Status Metrics Ribbon ─────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
            <div className="bg-slate-900/60 border border-slate-800/80 rounded p-2 flex flex-col justify-between">
              <span className="text-[8px] uppercase text-slate-500 font-bold">Open Positions</span>
              <div className="flex items-center justify-between mt-1">
                <span className="text-sm font-bold text-white">{activePositions.length}</span>
                <span className="text-[8px] text-purple-300 font-bold">Single-Cap: 1</span>
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800/80 rounded p-2 flex flex-col justify-between">
              <span className="text-[8px] uppercase text-slate-500 font-bold">Active Fresh Zones</span>
              <div className="flex items-center justify-between mt-1">
                <span className="text-sm font-bold text-cyan-300">{activeZones.length}</span>
                <span className="text-[8px] text-slate-400">Single-Use</span>
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800/80 rounded p-2 flex flex-col justify-between">
              <span className="text-[8px] uppercase text-slate-500 font-bold">Closed Session Trades</span>
              <div className="flex items-center justify-between mt-1">
                <span className="text-sm font-bold text-emerald-400">{closedLiveTrades.length}</span>
                <span className="text-[8px] text-slate-400">
                  {closedLiveTrades.filter(t => t.realizedR > 0).length}W / {closedLiveTrades.filter(t => t.realizedR < 0).length}L
                </span>
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800/80 rounded p-2 flex flex-col justify-between">
              <span className="text-[8px] uppercase text-slate-500 font-bold">Session Net R:R</span>
              <div className="flex items-center justify-between mt-1">
                <span className={`text-sm font-bold ${
                  closedLiveTrades.reduce((s, t) => s + t.realizedR, 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {closedLiveTrades.reduce((s, t) => s + t.realizedR, 0) > 0 ? '+' : ''}
                  {closedLiveTrades.reduce((s, t) => s + t.realizedR, 0).toFixed(2)}R
                </span>
                <span className="text-[8px] text-slate-400">Realized</span>
              </div>
            </div>
          </div>

          {/* ── Active Live Positions Display ─────────────────────────────────── */}
          {activePositions.length > 0 ? (
            <div className="flex flex-col gap-2">
              {activePositions.map((pos) => {
                const isLong = pos.direction === 'LONG';
                return (
                  <div
                    key={pos.id}
                    className="border border-cyan-500/30 bg-gradient-to-r from-slate-950 via-slate-900/90 to-cyan-950/20 rounded-lg p-3 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase flex items-center gap-1 ${
                          isLong ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}>
                          {isLong ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                          {pos.direction}
                        </span>
                        <span className="text-xs font-bold text-white">${pos.entryPrice}</span>
                        <span className="text-[9px] text-slate-400">SL: ${pos.activeStopLoss}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-400">Open R:</span>
                        <span className={`text-xs font-bold ${pos.unrealizedR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {pos.unrealizedR > 0 ? '+' : ''}{pos.unrealizedR}R
                        </span>
                        <span className="text-[9px] text-cyan-300 font-bold">
                          (Realized: +{pos.realizedR}R)
                        </span>
                      </div>
                    </div>

                    {/* 3-Stage Progress Bar */}
                    <div className="grid grid-cols-3 gap-1.5 text-[9px] font-mono">
                      <div className={`p-1.5 rounded border flex flex-col justify-between ${
                        pos.isTp1Filled
                          ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-300 font-bold'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400'
                      }`}>
                        <div className="flex items-center justify-between">
                          <span>Stage 1 (40%)</span>
                          {pos.isTp1Filled && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        </div>
                        <span className="text-[8px] opacity-80">${pos.tp1Price} (1.0R)</span>
                      </div>

                      <div className={`p-1.5 rounded border flex flex-col justify-between ${
                        pos.isTp2Filled
                          ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-300 font-bold'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400'
                      }`}>
                        <div className="flex items-center justify-between">
                          <span>Stage 2 (40%)</span>
                          {pos.isTp2Filled && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        </div>
                        <span className="text-[8px] opacity-80">${pos.tp2Price} (1.5R)</span>
                      </div>

                      <div className={`p-1.5 rounded border flex flex-col justify-between ${
                        pos.isTp3Filled
                          ? 'bg-purple-950/40 border-purple-500/60 text-purple-300 font-bold'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400'
                      }`}>
                        <div className="flex items-center justify-between">
                          <span>Runner (20%)</span>
                          {pos.isTp3Filled && <CheckCircle2 className="w-3 h-3 text-purple-400" />}
                        </div>
                        <span className="text-[8px] opacity-80">${pos.tp3Price} (DOL)</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[8px] text-slate-400 border-t border-slate-800/40 pt-1.5">
                      <span>Trailing SL Source: <strong className="text-cyan-300">{pos.trailingSlSource}</strong></span>
                      {pos.activeRatchetFloor && (
                        <span className="text-emerald-400 font-bold">🔒 Profit Floor: ${pos.activeRatchetFloor} (+1.0R)</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-3 text-center text-slate-500 text-[10px] border border-dashed border-slate-800/80 rounded bg-slate-950/40">
              <span>No open positions. Monitoring {activeZones.length} active Order Blocks & Breakers...</span>
            </div>
          )}

          {/* ── Event Ticker Readout ────────────────────────────────────────── */}
          {lastEventMessage && (
            <div className="bg-slate-900/80 border border-slate-800 rounded p-2 text-[9px] text-slate-300 flex items-center justify-between">
              <span className="truncate">{lastEventMessage}</span>
              <span className="text-[8px] text-slate-500 shrink-0 ml-2">
                {new Date(lastEventTime).toLocaleTimeString()}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
