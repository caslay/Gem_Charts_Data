"use client";

import { useState, useMemo } from "react";
import {
  X,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  Target,
  Copy,
  Check,
  Shield,
  Layers,
  ChevronRight,
  Sparkles,
  BarChart2,
  Loader2,
  Play,
  RotateCcw
} from "lucide-react";
import type { MarketDataPayload } from "@/hooks/useMarketData";
import { generatePotentialTrades, PotentialTrade } from "@/lib/quantTradeEngine";

interface BacktestPotentialTradesModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentData: MarketDataPayload | null;
  onExecuteTrade: (setup: PotentialTrade) => Promise<void> | void;
}

export default function BacktestPotentialTradesModal({
  isOpen,
  onClose,
  currentData,
  onExecuteTrade,
}: BacktestPotentialTradesModalProps) {
  const [filterDirection, setFilterDirection] = useState<"ALL" | "BULLISH" | "BEARISH">("ALL");
  const [qualityMode, setQualityMode] = useState<"HIGH_PROBABILITY" | "NEARBY" | "PENDING" | "ALL">("HIGH_PROBABILITY");
  const [selectedSetupId, setSelectedSetupId] = useState<string | null>("SET-01");
  const [copyState, setCopyState] = useState<string | null>(null);
  const [executingSetupId, setExecutingSetupId] = useState<string | null>(null);
  const [executedSuccessId, setExecutedSuccessId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const engineSummary = useMemo(() => generatePotentialTrades(currentData, true), [currentData, refreshTrigger]);

  if (!isOpen) return null;

  const handleResetMemory = () => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("gem_quant_setup_history");
        setRefreshTrigger((prev) => prev + 1);
      } catch {}
    }
  };

  const filteredSetups = engineSummary.setups.filter((s) => {
    if (filterDirection === "BULLISH" && s.direction !== "BULLISH") return false;
    if (filterDirection === "BEARISH" && s.direction !== "BEARISH") return false;

    if (qualityMode === "HIGH_PROBABILITY") return s.isHighProbability || s.status === "ACTIVE_WATCH";
    if (qualityMode === "NEARBY") return s.isNearby;
    if (qualityMode === "PENDING") return s.status === "PENDING_TOUCH" || s.status === "ACTIVE_WATCH" || s.status === "WAITING";
    return true;
  });

  const selectedSetup = engineSummary.setups.find((s) => s.id === selectedSetupId) || engineSummary.setups[0];

  const handleCopySetup = (setup: PotentialTrade) => {
    const text = `[BACKTEST QUANT TRADE SETUP: ${setup.id} - ${setup.type}]
Direction: ${setup.direction}
Entry Range: $${setup.entryMin.toFixed(2)} - $${setup.entryMax.toFixed(2)}
Stop Loss: $${setup.stopLoss.toFixed(2)}
TP1: $${setup.target1.toFixed(2)} | TP2: $${setup.target2.toFixed(2)}
R:R Ratio: 1:${setup.rrRatio}
Trigger: ${setup.trigger}
Confluence: ${setup.confluence}
Timestamp: ${new Date().toISOString()}`;

    navigator.clipboard.writeText(text);
    setCopyState(setup.id);
    setTimeout(() => setCopyState(null), 2000);
  };

  const handleExecute = async (setup: PotentialTrade) => {
    setExecutingSetupId(setup.id);
    try {
      await onExecuteTrade(setup);
      setExecutedSuccessId(setup.id);
      setTimeout(() => setExecutedSuccessId(null), 3000);
    } catch (err) {
      console.error("[BACKTEST_POTENTIAL_TRADES] Execution error:", err);
    } finally {
      setExecutingSetupId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-[fade-in_0.15s_ease-out]">
      <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col bg-card/95 border border-purple-500/30 shadow-2xl rounded-2xl overflow-hidden font-sans text-foreground">
        
        {/* ── Modal Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-card-border bg-background/80 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black tracking-widest uppercase text-foreground">
                  [ BACKTEST QUANT POTENTIAL TRADES ]
                </h2>
                <span className="px-2 py-0.5 text-[9px] font-black uppercase rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  REPLAY ENGINE
                </span>
              </div>
              <p className="text-[10px] text-muted font-bold uppercase tracking-wider">
                Historical Replay Market Structure & Confluence Matrix
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleResetMemory}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-card hover:bg-card-border/50 border border-card-border text-muted hover:text-foreground text-[10px] font-mono font-bold uppercase rounded-lg transition-all cursor-pointer"
              title="Clear completed setup history and refresh rolling queue"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Setup Memory</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 text-muted hover:text-foreground hover:bg-card-hover/20 rounded-xl transition-all cursor-pointer"
              title="Close Modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Scrollable Body ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* ── 1. Telemetry Bar ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            
            {/* Replay Price */}
            <div className="p-3 bg-background/50 border border-card-border rounded-xl space-y-1">
              <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">Replay Price</span>
              <div className="text-sm font-mono font-black text-foreground">
                ${engineSummary.currentPrice.toFixed(2)}
              </div>
            </div>

            {/* Institutional Bias */}
            <div className="p-3 bg-background/50 border border-card-border rounded-xl space-y-1">
              <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">Institutional Bias</span>
              <div className="text-xs font-mono font-black uppercase text-purple-400 truncate">
                {engineSummary.institutionalBias.replace("_", " ")}
              </div>
            </div>

            {/* Range EQ */}
            <div className="p-3 bg-background/50 border border-card-border rounded-xl space-y-1">
              <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">Range Equilibrium ($EQ$)</span>
              <div className="text-sm font-mono font-bold text-purple-400">
                ${engineSummary.equilibrium.toFixed(2)}
              </div>
            </div>

            {/* Pricing Zone */}
            <div className="p-3 bg-background/50 border border-card-border rounded-xl space-y-1">
              <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">Pricing Zone</span>
              <span className={`inline-block px-2 py-0.5 text-[10px] font-black rounded-md ${
                engineSummary.dealingZone === "DISCOUNT"
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : engineSummary.dealingZone === "PREMIUM"
                  ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
              }`}>
                {engineSummary.dealingZone}
              </span>
            </div>

            {/* BSL Target */}
            <div className="p-3 bg-background/50 border border-card-border rounded-xl space-y-1">
              <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider block">BSL Target (High)</span>
              <div className="text-sm font-mono font-bold text-emerald-400">
                ${engineSummary.bslMagnets[0]?.toFixed(2) || engineSummary.swingHigh.toFixed(2)}
              </div>
            </div>

            {/* SSL Target */}
            <div className="p-3 bg-background/50 border border-card-border rounded-xl space-y-1">
              <span className="text-[9px] font-bold text-rose-500 uppercase tracking-wider block">SSL Target (Low)</span>
              <div className="text-sm font-mono font-bold text-rose-400">
                ${engineSummary.sslMagnets[0]?.toFixed(2) || engineSummary.swingLow.toFixed(2)}
              </div>
            </div>

          </div>

          {/* ── 2. Potential Trades Table Section ──────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <h3 className="text-xs font-black uppercase tracking-wider text-foreground">
                  Evaluated Replay Setups ({filteredSetups.length})
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Quality Mode Pills */}
                <div className="flex items-center gap-1 p-1 bg-background/50 border border-card-border rounded-lg">
                  <button
                    onClick={() => setQualityMode("HIGH_PROBABILITY")}
                    className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                      qualityMode === "HIGH_PROBABILITY"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    🔥 High Prob (R:R ≥ 1.5)
                  </button>
                  <button
                    onClick={() => setQualityMode("NEARBY")}
                    className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                      qualityMode === "NEARBY"
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    🎯 Nearby (≤2%)
                  </button>
                  <button
                    onClick={() => setQualityMode("PENDING")}
                    className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                      qualityMode === "PENDING"
                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    ⚡ Pending Only
                  </button>
                  <button
                    onClick={() => setQualityMode("ALL")}
                    className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                      qualityMode === "ALL"
                        ? "bg-accent text-accent-foreground shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    Show All
                  </button>
                </div>

                {/* Direction Filters */}
                <div className="flex items-center gap-1.5 p-1 bg-background/50 border border-card-border rounded-lg">
                  <button
                    onClick={() => setFilterDirection("ALL")}
                    className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                      filterDirection === "ALL"
                        ? "bg-accent text-accent-foreground shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    All ({engineSummary.setups.length})
                  </button>
                  <button
                    onClick={() => setFilterDirection("BULLISH")}
                    className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                      filterDirection === "BULLISH"
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "text-emerald-500/70 hover:text-emerald-400"
                    }`}
                  >
                    Bullish
                  </button>
                  <button
                    onClick={() => setFilterDirection("BEARISH")}
                    className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                      filterDirection === "BEARISH"
                        ? "bg-rose-500 text-white shadow-sm"
                        : "text-rose-500/70 hover:text-rose-400"
                    }`}
                  >
                    Bearish
                  </button>
                </div>
              </div>
            </div>

            {/* Interactive Table */}
            <div className="border border-card-border rounded-xl overflow-hidden bg-background/30 shadow-inner">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-sans">
                  <thead className="bg-background/80 text-[9px] uppercase font-black tracking-widest text-muted border-b border-card-border">
                    <tr>
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">Setup Type</th>
                      <th className="px-4 py-3">Direction</th>
                      <th className="px-4 py-3">Entry Zone</th>
                      <th className="px-4 py-3">Stop Loss</th>
                      <th className="px-4 py-3">TP1 / TP2</th>
                      <th className="px-4 py-3">R:R Ratio</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-card-border/50 font-mono">
                    {filteredSetups.map((setup) => {
                      const isSelected = selectedSetup?.id === setup.id;
                      const isExecuting = executingSetupId === setup.id;
                      const isSuccess = executedSuccessId === setup.id;

                      return (
                        <tr
                          key={setup.id}
                          onClick={() => setSelectedSetupId(setup.id)}
                          className={`transition-colors cursor-pointer ${
                            isSelected ? "bg-purple-500/10" : "hover:bg-card-hover/20"
                          }`}
                        >
                          <td className="px-4 py-3.5 font-bold text-foreground">{setup.id}</td>
                          <td className="px-4 py-3.5 font-sans font-semibold text-foreground">
                            {setup.type}
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black ${
                                setup.direction === "BULLISH"
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                              }`}
                            >
                              {setup.direction === "BULLISH" ? (
                                <TrendingUp className="w-3 h-3" />
                              ) : (
                                <TrendingDown className="w-3 h-3" />
                              )}
                              {setup.direction}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-foreground font-bold">
                            ${setup.entryMin.toFixed(2)} - ${setup.entryMax.toFixed(2)}
                          </td>
                          <td className="px-4 py-3.5 text-rose-400 font-bold">
                            ${setup.stopLoss.toFixed(2)}
                          </td>
                          <td className="px-4 py-3.5 text-emerald-400 font-bold">
                            ${setup.target1.toFixed(2)} / ${setup.target2.toFixed(2)}
                          </td>
                          <td className="px-4 py-3.5 font-black text-purple-400">
                            1 : {setup.rrRatio}
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`px-2 py-0.5 text-[9px] font-black uppercase rounded ${
                                setup.status === "ACTIVE_WATCH"
                                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse"
                                  : setup.status === "TARGET_HIT"
                                  ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                                  : setup.status === "INVALIDATED"
                                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                  : setup.status === "CONFIRMED"
                                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                                  : "bg-background/80 text-muted border border-card-border"
                              }`}
                            >
                              {setup.status.replace("_", " ")}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right space-x-1.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleExecute(setup)}
                              disabled={isExecuting}
                              className={`inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono font-bold uppercase rounded-lg border transition-all cursor-pointer ${
                                isSuccess
                                  ? "bg-emerald-500 text-white border-emerald-500"
                                  : "bg-purple-500/20 hover:bg-purple-500/30 border-purple-500/40 text-purple-300"
                              }`}
                              title="Execute Trade in Backtest Replay"
                            >
                              {isExecuting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : isSuccess ? (
                                <Check className="w-3 h-3" />
                              ) : (
                                <Play className="w-3 h-3 fill-current" />
                              )}
                              <span>{isSuccess ? "Opened!" : "Execute"}</span>
                            </button>

                            <button
                              onClick={() => handleCopySetup(setup)}
                              className="p-1.5 bg-background/50 hover:bg-card-border/50 border border-card-border text-muted hover:text-foreground rounded-lg transition-all cursor-pointer"
                              title="Copy Setup Parameters"
                            >
                              {copyState === setup.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── 3. Detailed Execution Inspector ────────────────────────────── */}
          {selectedSetup && (
            <div className="p-5 bg-background/40 border border-card-border rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-purple-400" />
                  <h4 className="text-xs font-black uppercase tracking-wider text-foreground">
                    Detailed Execution Inspector — [{selectedSetup.id}: {selectedSetup.type}]
                  </h4>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExecute(selectedSetup)}
                    disabled={executingSetupId === selectedSetup.id}
                    className={`flex items-center gap-2 px-4 py-1.5 text-xs font-mono font-black uppercase rounded-xl border transition-all cursor-pointer ${
                      executedSuccessId === selectedSetup.id
                        ? "bg-emerald-500 text-white border-emerald-500"
                        : "bg-purple-500/20 hover:bg-purple-500/30 border-purple-500/40 text-purple-300"
                    }`}
                  >
                    {executingSetupId === selectedSetup.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : executedSuccessId === selectedSetup.id ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    <span>{executedSuccessId === selectedSetup.id ? "Position Opened!" : "Execute Trade in Backtest"}</span>
                  </button>

                  <button
                    onClick={() => handleCopySetup(selectedSetup)}
                    className="flex items-center gap-2 px-4 py-1.5 bg-accent hover:bg-accent-hover text-accent-foreground text-xs font-mono font-black uppercase rounded-xl transition-all cursor-pointer shadow-sm"
                  >
                    {copyState === selectedSetup.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>Copy Parameters</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
                <div className="p-3 bg-card/40 border border-card-border rounded-lg space-y-1">
                  <span className="text-[10px] font-bold text-muted uppercase tracking-wider block">Trigger Condition</span>
                  <p className="text-foreground font-semibold">{selectedSetup.trigger}</p>
                </div>
                <div className="p-3 bg-card/40 border border-card-border rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">Institutional Confluences</span>
                  <p className="text-foreground font-semibold">{selectedSetup.confluence}</p>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
