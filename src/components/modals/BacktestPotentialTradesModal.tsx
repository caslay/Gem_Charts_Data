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
  RotateCcw,
  AlertTriangle,
  Lock,
  Ban
} from "lucide-react";
import type { MarketDataPayload } from "@/hooks/useMarketData";
import { generatePotentialTrades, PotentialTrade, toggleAutoExecuteKey } from "@/lib/quantTradeEngine";

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
  const [confirmingSetupId, setConfirmingSetupId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const engineSummary = useMemo(() => generatePotentialTrades(currentData, true), [currentData, refreshTrigger]);

  const autoExecuteCount = useMemo(
    () => engineSummary.setups.filter((s) => s.isAutoExecute).length,
    [engineSummary]
  );

  const handleToggleAutoExecute = (setup: PotentialTrade) => {
    toggleAutoExecuteKey(setup.setupKey);
    setRefreshTrigger((prev) => prev + 1);
  };

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
    setConfirmingSetupId(null);
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

  /** Status-aware Execute button config (same doctrine as Live HUD modal) */
  const getExecConfig = (setup: PotentialTrade) => {
    const isExecuting  = executingSetupId === setup.id;
    const isSuccess    = executedSuccessId === setup.id;
    const isConfirming = confirmingSetupId === setup.id;

    if (isSuccess) return {
      disabled: false, className: "bg-emerald-500 text-white border-emerald-500",
      icon: <Check className="w-3 h-3" />, label: "Opened!", onClick: () => {},
      title: "Trade successfully opened in backtest journal",
    };
    if (isExecuting) return {
      disabled: true, className: "bg-purple-500/20 border-purple-500/40 text-purple-300 cursor-wait",
      icon: <Loader2 className="w-3 h-3 animate-spin" />, label: "Opening...", onClick: () => {},
      title: "Opening trade...",
    };

    switch (setup.status) {
      case "ACTIVE_WATCH":
      case "CONFIRMED":
        return {
          disabled: false,
          className: "bg-purple-500/20 hover:bg-purple-500/30 border-purple-500/40 text-purple-300",
          icon: <Play className="w-3 h-3 fill-current" />,
          label: "Execute",
          onClick: () => handleExecute(setup),
          title: "Price is in entry zone — execute replay trade",
        };

      case "PENDING_TOUCH":
      case "WAITING":
        if (isConfirming) return {
          disabled: false,
          className: "bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/40 text-amber-300 animate-pulse",
          icon: <AlertTriangle className="w-3 h-3" />,
          label: setup.status === "PENDING_TOUCH" ? "Force Entry?" : "Force Breakout?",
          onClick: () => handleExecute(setup),
          title: setup.status === "PENDING_TOUCH"
            ? "Entry zone not touched yet. Click again to force-enter."
            : "Breakout not confirmed yet. Click again to force-enter.",
        };
        return {
          disabled: false,
          className: "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-400",
          icon: <AlertTriangle className="w-3 h-3" />,
          label: setup.status === "PENDING_TOUCH" ? "Not Touched" : "Not Confirmed",
          onClick: () => setConfirmingSetupId(setup.id),
          title: setup.status === "PENDING_TOUCH"
            ? "Entry zone not yet reached. Click to see force-entry option."
            : "Breakout not confirmed yet. Click to see force-entry option.",
        };

      case "TARGET_HIT":
        return {
          disabled: true,
          className: "bg-muted/10 text-muted border-muted/20 cursor-not-allowed opacity-50",
          icon: <Lock className="w-3 h-3" />, label: "Completed", onClick: () => {},
          title: "Move already played out. Cannot enter a completed setup.",
        };

      case "INVALIDATED":
        return {
          disabled: true,
          className: "bg-rose-500/10 text-rose-500/50 border-rose-500/20 cursor-not-allowed opacity-50",
          icon: <Ban className="w-3 h-3" />, label: "Invalidated", onClick: () => {},
          title: "Setup invalidated — stop loss was breached.",
        };

      default:
        return {
          disabled: false,
          className: "bg-purple-500/20 hover:bg-purple-500/30 border-purple-500/40 text-purple-300",
          icon: <Play className="w-3 h-3 fill-current" />,
          label: "Execute",
          onClick: () => handleExecute(setup),
          title: "Execute replay trade",
        };
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

          {/* ── Auto-Execution Control Banner ─────────────────────────────────── */}
          <div className="flex items-center justify-between p-3.5 bg-gradient-to-r from-purple-500/15 via-cyan-500/10 to-background/50 border border-purple-500/30 rounded-xl text-xs">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400 border border-purple-500/30">
                <Zap className="w-4 h-4 animate-pulse fill-current" />
              </div>
              <div>
                <span className="font-black uppercase tracking-wider text-foreground flex items-center gap-2">
                  Replay Auto-Execution Engine
                  {autoExecuteCount > 0 ? (
                    <span className="px-2 py-0.5 text-[9px] font-black uppercase rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
                      ⚡ ACTIVE — {autoExecuteCount} SETUPS MONITORED
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[9px] font-black uppercase rounded-full bg-muted/20 text-muted border border-card-border">
                      READY TO MONITOR
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-muted block mt-0.5 font-medium">
                  {autoExecuteCount > 0
                    ? "Selected setup(s) are actively monitored during replay. Position will automatically open in your Backtest Journal as replay candles reach entry range."
                    : "Click '⚡ Auto-Open' on any setup below to automatically log trades to your Backtest Journal when replay hits entry."}
                </span>
              </div>
            </div>
            {autoExecuteCount > 0 && (
              <span className="px-3 py-1.5 bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded-lg text-[10px] font-mono font-bold uppercase shrink-0">
                {autoExecuteCount} Auto-Active
              </span>
            )}
          </div>

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
                            {/* Auto-Open Toggle */}
                            <button
                              onClick={() => handleToggleAutoExecute(setup)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono font-bold uppercase rounded-lg border transition-all cursor-pointer ${
                                setup.isAutoOpened
                                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                  : setup.isAutoExecute
                                  ? "bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 shadow-sm shadow-purple-500/20"
                                  : "bg-background/50 hover:bg-card-border/50 text-muted hover:text-foreground border-card-border"
                              }`}
                              title={
                                setup.isAutoOpened
                                  ? "Trade auto-opened into backtest journal"
                                  : setup.isAutoExecute
                                  ? "Auto-Open ENABLED: Click to disable"
                                  : "Click to enable Auto-Open during backtest replay"
                              }
                            >
                              <Zap className={`w-3 h-3 ${setup.isAutoExecute ? "text-purple-400 fill-current animate-pulse" : ""}`} />
                              <span>
                                {setup.isAutoOpened
                                  ? "Auto-Opened"
                                  : setup.isAutoExecute
                                  ? "Auto ON"
                                  : "Auto OFF"}
                              </span>
                            </button>

                            {(() => {
                              const cfg = getExecConfig(setup);
                              return (
                                <button
                                  onClick={cfg.onClick}
                                  disabled={cfg.disabled}
                                  className={`inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono font-bold uppercase rounded-lg border transition-all ${
                                    cfg.disabled ? '' : 'cursor-pointer'
                                  } ${cfg.className}`}
                                  title={cfg.title}
                                >
                                  {cfg.icon}
                                  <span>{cfg.label}</span>
                                </button>
                              );
                            })()}

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
                  {/* Inspector Auto-Open Toggle Button */}
                  <button
                    onClick={() => handleToggleAutoExecute(selectedSetup)}
                    className={`flex items-center gap-2 px-4 py-1.5 text-xs font-mono font-black uppercase rounded-xl border transition-all cursor-pointer ${
                      selectedSetup.isAutoOpened
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        : selectedSetup.isAutoExecute
                        ? "bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 shadow-sm shadow-purple-500/20"
                        : "bg-background/50 hover:bg-card-border/50 text-muted hover:text-foreground border-card-border"
                    }`}
                    title={
                      selectedSetup.isAutoOpened
                        ? "Position auto-opened into backtest journal"
                        : selectedSetup.isAutoExecute
                        ? "Auto-Open ENABLED: Click to disable"
                        : "Click to enable Auto-Open when replay hits entry"
                    }
                  >
                    <Zap className={`w-3.5 h-3.5 ${selectedSetup.isAutoExecute ? "text-purple-400 fill-current animate-pulse" : ""}`} />
                    <span>
                      {selectedSetup.isAutoOpened
                        ? "Auto-Opened into Journal"
                        : selectedSetup.isAutoExecute
                        ? "⚡ Auto-Open: ON"
                        : "⚡ Auto-Open: OFF"}
                    </span>
                  </button>

                  {(() => {
                    const cfg = getExecConfig(selectedSetup);
                    return (
                      <button
                        onClick={cfg.onClick}
                        disabled={cfg.disabled}
                        className={`flex items-center gap-2 px-4 py-1.5 text-xs font-mono font-black uppercase rounded-xl border transition-all ${
                          cfg.disabled ? '' : 'cursor-pointer'
                        } ${cfg.className}`}
                        title={cfg.title}
                      >
                        {cfg.icon}
                        <span>
                          {executedSuccessId === selectedSetup.id
                            ? "Position Opened!"
                            : cfg.label === "Execute"
                            ? "Execute Trade in Backtest"
                            : cfg.label}
                        </span>
                      </button>
                    );
                  })()}


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

              {/* ── Trade Timeline — visible only for completed/invalidated setups ── */}
              {(selectedSetup.status === "TARGET_HIT" || selectedSetup.status === "INVALIDATED") && (
                <div className="space-y-2">
                  <span className="text-[9px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                    <span className={selectedSetup.status === "TARGET_HIT" ? "text-emerald-400" : "text-rose-400"}>
                      {selectedSetup.status === "TARGET_HIT" ? "✓" : "✕"}
                    </span>
                    Trade Timeline
                  </span>
                  <div className="grid grid-cols-2 gap-3 text-xs font-sans">
                    {/* Open */}
                    <div className={`p-3 rounded-lg border space-y-2 ${
                      selectedSetup.status === "TARGET_HIT"
                        ? "bg-emerald-500/5 border-emerald-500/20"
                        : "bg-rose-500/5 border-rose-500/20"
                    }`}>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted block">📥 Trade Open</span>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted">Price</span>
                          <span className="text-xs font-black font-mono text-foreground">
                            ${(selectedSetup.openPrice ?? ((selectedSetup.entryMin + selectedSetup.entryMax) / 2)).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted">Date</span>
                          <span className="text-[10px] font-mono text-foreground">
                            {selectedSetup.openTime
                              ? new Date(selectedSetup.openTime).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                              : <span className="text-muted italic">Replay detected</span>}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted">Time</span>
                          <span className="text-[10px] font-mono text-foreground">
                            {selectedSetup.openTime
                              ? new Date(selectedSetup.openTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
                              : <span className="text-muted italic">—</span>}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Close */}
                    <div className={`p-3 rounded-lg border space-y-2 ${
                      selectedSetup.status === "TARGET_HIT"
                        ? "bg-emerald-500/10 border-emerald-500/30"
                        : "bg-rose-500/10 border-rose-500/30"
                    }`}>
                      <span className={`text-[9px] font-bold uppercase tracking-wider block ${
                        selectedSetup.status === "TARGET_HIT" ? "text-emerald-400" : "text-rose-400"
                      }`}>
                        {selectedSetup.status === "TARGET_HIT" ? "🎯 Trade Close (Target Hit)" : "🚫 Trade Close (Invalidated)"}
                      </span>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted">Price</span>
                          <span className={`text-xs font-black font-mono ${
                            selectedSetup.status === "TARGET_HIT" ? "text-emerald-400" : "text-rose-400"
                          }`}>
                            ${(selectedSetup.closePrice ?? (selectedSetup.status === "TARGET_HIT" ? selectedSetup.target1 : selectedSetup.stopLoss)).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted">Date</span>
                          <span className="text-[10px] font-mono text-foreground">
                            {selectedSetup.closeTime
                              ? new Date(selectedSetup.closeTime).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                              : <span className="text-muted italic">Replay detected</span>}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted">Time</span>
                          <span className="text-[10px] font-mono text-foreground">
                            {selectedSetup.closeTime
                              ? new Date(selectedSetup.closeTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
                              : <span className="text-muted italic">—</span>}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
