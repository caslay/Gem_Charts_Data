'use client';

import React from 'react';
import {
  Shield,
  Zap,
  TrendingUp,
  Award,
  Lock,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Sliders,
  DollarSign,
  Layers,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle
} from 'lucide-react';
import { useAutomatedStrategyExecution } from '@/hooks/useAutomatedStrategyExecution';

interface AutomatedExecutionHUDProps {
  className?: string;
  isCompact?: boolean;
}

export default function AutomatedExecutionHUD({
  className = '',
  isCompact = false,
}: AutomatedExecutionHUDProps) {
  const {
    engineConfig,
    setEngineConfig,
    isSweepReclaimAutoExecEnabled,
    toggleAutoExecute,
    activePositions,
    pendingOrders,
    closedTrades,
    accountEquity,
    riskUsd2Pct,
    lastEvent,
    emergencyClosePosition,
    moveStopToBreakeven,
  } = useAutomatedStrategyExecution();

  const totalOpen = activePositions.length;
  const totalPending = pendingOrders.length;

  return (
    <div className={`border border-slate-800/60 bg-slate-900/40 backdrop-blur-md rounded-xl p-4 font-mono text-xs ${className}`}>
      {/* ── Top Header & Dynamic 2% Compounding Summary ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-3 mb-3 border-b border-slate-800/60 gap-3">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
            <Zap className="w-4 h-4" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Dynamic 2% Compounding Execution Engine
              </h3>
              <button
                type="button"
                onClick={toggleAutoExecute}
                className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase transition flex items-center gap-1 border ${
                  isSweepReclaimAutoExecEnabled
                    ? 'bg-cyan-950 text-cyan-300 border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
                    : 'bg-slate-900 text-slate-400 border-slate-700'
                }`}
              >
                <span>⚡ S&R:</span>
                <span>{isSweepReclaimAutoExecEnabled ? 'AUTO-EXEC ON' : 'MANUAL WATCH'}</span>
              </button>
            </div>
            <span className="text-[10px] text-slate-400">
              3-Stage Harvest & Profit-Locking Ratchet State Machine
            </span>
          </div>
        </div>

        {/* Dynamic Compounding Equity Cards */}
        <div className="flex items-center gap-2.5 text-[10px]">
          <div className="px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col">
            <span className="text-slate-500 uppercase text-[8px]">Active Equity</span>
            <span className="text-white font-bold text-xs">${accountEquity.toFixed(2)}</span>
          </div>

          <div className="px-3 py-1.5 rounded-lg bg-cyan-950/40 border border-cyan-500/40 flex flex-col">
            <span className="text-cyan-400 uppercase text-[8px] font-bold">1.0R Risk (2.0%)</span>
            <span className="text-cyan-300 font-bold text-xs">${riskUsd2Pct.toFixed(2)}</span>
          </div>

          <div className="px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col">
            <span className="text-slate-500 uppercase text-[8px]">Active / Max Cap</span>
            <span className="text-slate-300 font-bold text-xs">
              {totalOpen} / {engineConfig.maxOpenPositions}
            </span>
          </div>
        </div>
      </div>

      {/* ── Active Positions Live Monitor ── */}
      {activePositions.length > 0 ? (
        <div className="flex flex-col gap-3 mb-3">
          {activePositions.map((pos) => {
            const isLong = pos.direction === 'LONG';
            return (
              <div
                key={pos.id}
                className="p-3.5 rounded-lg bg-slate-950/80 border border-cyan-500/40 shadow-sm shadow-cyan-500/10 flex flex-col gap-3"
              >
                {/* Position Summary Row */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`p-1.5 rounded text-xs font-bold ${
                        isLong
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {isLong ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-white text-xs">{pos.symbol}</strong>
                        <span className="text-[10px] px-1.5 rounded bg-slate-800 text-slate-300 font-semibold">
                          {pos.timeframe}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/30 font-bold">
                          {pos.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">
                        Entry: <strong className="text-white">${pos.entryPrice.toFixed(2)}</strong> | Size:{' '}
                        <strong className="text-white">{pos.contractSize}</strong> units (${pos.riskUsd.toFixed(2)} Risk)
                      </span>
                    </div>
                  </div>

                  {/* Realized & Floating P&L */}
                  <div className="text-right">
                    <div className="text-xs font-bold">
                      <span className={pos.realizedR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {pos.realizedR > 0 ? '+' : ''}{pos.realizedR.toFixed(2)}R Realized
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400">
                      Floating: {pos.unrealizedR > 0 ? '+' : ''}{pos.unrealizedR.toFixed(2)}R (${pos.unrealizedUsd > 0 ? '+' : ''}${pos.unrealizedUsd.toFixed(2)})
                    </span>
                  </div>
                </div>

                {/* 3-Stage Harvest Tranche Ladder Visualizer */}
                <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                  {/* Tranche 1 */}
                  <div
                    className={`p-2 rounded border ${
                      pos.isStage1Filled
                        ? 'bg-cyan-950/40 border-cyan-500/40 text-cyan-300'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400'
                    }`}
                  >
                    <span className="text-[8px] uppercase block text-slate-500">Stage 1 (40% @ 1.0R)</span>
                    <strong className="block mt-0.5">${pos.stage1Target.toFixed(2)}</strong>
                    <span className="text-[8px]">{pos.isStage1Filled ? 'FILLED ✓ (+0.40R)' : 'UNREACHED'}</span>
                  </div>

                  {/* Tranche 2 */}
                  <div
                    className={`p-2 rounded border ${
                      pos.isStage2Filled
                        ? 'bg-purple-950/40 border-purple-500/40 text-purple-300'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400'
                    }`}
                  >
                    <span className="text-[8px] uppercase block text-slate-500">Stage 2 (40% @ 1.5R)</span>
                    <strong className="block mt-0.5">${pos.stage2Target.toFixed(2)}</strong>
                    <span className="text-[8px]">{pos.isStage2Filled ? 'FILLED ✓ (+0.60R)' : 'UNREACHED'}</span>
                  </div>

                  {/* Tranche 3 */}
                  <div
                    className={`p-2 rounded border ${
                      pos.isStage3Filled
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400'
                    }`}
                  >
                    <span className="text-[8px] uppercase block text-slate-500">Stage 3 (20% DOL)</span>
                    <strong className="block mt-0.5">${pos.stage3Target.toFixed(2)}</strong>
                    <span className="text-[8px]">{pos.isStage3Filled ? 'FILLED ✓ (+0.60R)' : 'ACTIVE RUNNER'}</span>
                  </div>
                </div>

                {/* Trailing Stop Ratchet Banner & Actions */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[10px]">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Shield className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Active SL: <strong className="text-white">${pos.activeStopLoss.toFixed(2)}</strong></span>
                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-cyan-300 text-[9px] font-bold">
                      {pos.trailingSlSource}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => moveStopToBreakeven(pos.id)}
                      disabled={pos.trailingSlSource === 'BREAKEVEN' || pos.trailingSlSource === 'PROFIT_RATCHET_FLOOR'}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-[10px] transition"
                    >
                      Lock BE
                    </button>
                    <button
                      onClick={() => emergencyClosePosition(pos.id)}
                      className="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-500/30 text-[10px] transition"
                    >
                      Market Close
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty / Idle State */
        <div className="py-4 px-3 rounded-lg border border-dashed border-slate-800 text-center text-slate-500 text-[11px] mb-3">
          <span>No active compounded positions currently open. Engine standing by for high-probability setups.</span>
        </div>
      )}

      {/* ── Resting Limit Orders Queue ── */}
      {pendingOrders.length > 0 && (
        <div className="mb-3">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5 flex items-center gap-1">
            <Layers className="w-3 h-3 text-cyan-400" />
            <span>Resting Limit Orders ({pendingOrders.length})</span>
          </span>
          <div className="flex flex-col gap-1.5">
            {pendingOrders.map((order) => (
              <div
                key={order.id}
                className="px-3 py-2 rounded bg-slate-950/60 border border-slate-800 flex items-center justify-between text-[10px]"
              >
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${order.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {order.direction}
                  </span>
                  <span className="text-white font-bold">${order.limitEntryPrice.toFixed(2)}</span>
                  <span className="text-slate-500">({order.symbol} {order.timeframe})</span>
                </div>
                <span className="text-cyan-400 font-bold">${order.riskUsd.toFixed(2)} Risk (2% Compounded)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Latest Event Message Banner ── */}
      {lastEvent && (
        <div className="px-3 py-2 rounded-lg bg-slate-950/90 border border-slate-800 text-[10px] text-slate-300 flex items-center justify-between">
          <span className="truncate max-w-[85%]">{lastEvent.message}</span>
          <span className="text-[9px] text-slate-500">
            {new Date(lastEvent.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      )}
    </div>
  );
}
