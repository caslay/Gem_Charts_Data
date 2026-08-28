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
  ChevronDown,
  ChevronUp,
  Sparkles,
  BarChart2,
  Loader2,
  Play,
  RotateCcw,
  AlertTriangle,
  Lock,
  Ban,
  History,
  Award
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
  const [activeTab, setActiveTab] = useState<"ACTIVE" | "COMPLETED">("ACTIVE");
  const [filterDirection, setFilterDirection] = useState<"ALL" | "BULLISH" | "BEARISH">("ALL");
  const [qualityMode, setQualityMode] = useState<"PREMIUM" | "ENTRY_ZONE" | "ALL">("PREMIUM");
  const [selectedSetupId, setSelectedSetupId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);
  const [executingSetupId, setExecutingSetupId] = useState<string | null>(null);
  const [executedSuccessId, setExecutedSuccessId] = useState<string | null>(null);
  const [confirmingSetupId, setConfirmingSetupId] = useState<string | null>(null);
  const [isJoinGuideOpen, setIsJoinGuideOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const engineSummary = useMemo(() => {
    if (!isOpen) {
      return {
        currentPrice: 0,
        institutionalBias: "NEUTRAL",
        equilibrium: 0,
        dealingZone: "EQUILIBRIUM",
        bslMagnets: [],
        sslMagnets: [],
        swingHigh: 0,
        swingLow: 0,
        setups: [],
      };
    }
    return generatePotentialTrades(currentData, true);
  }, [isOpen, currentData, refreshTrigger]);

  const autoExecuteCount = useMemo(
    () => engineSummary.setups.filter((s) => s.isAutoExecute).length,
    [engineSummary]
  );

  const handleToggleAutoExecute = (setup: PotentialTrade) => {
    toggleAutoExecuteKey(setup.setupKey);
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleResetMemory = () => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("gem_quant_setup_history");
        setRefreshTrigger((prev) => prev + 1);
      } catch {}
    }
  };

  // Separate active setups from completed trades
  const activeSetups = useMemo(() => {
    return engineSummary.setups.filter(
      (s) => s.status !== "TARGET_HIT" && s.status !== "INVALIDATED"
    );
  }, [engineSummary.setups]);

  const completedSetups = useMemo(() => {
    return engineSummary.setups.filter(
      (s) => s.status === "TARGET_HIT" || s.status === "INVALIDATED"
    );
  }, [engineSummary.setups]);

  // Filter & Sort Active Setups
  const filteredActiveSetups = useMemo(() => {
    let list = activeSetups.filter((s) => {
      if (filterDirection === "BULLISH" && s.direction !== "BULLISH") return false;
      if (filterDirection === "BEARISH" && s.direction !== "BEARISH") return false;

      if (qualityMode === "PREMIUM") return (s.scenarioScore ?? 0) >= 70 || s.isHighProbability;
      if (qualityMode === "ENTRY_ZONE") return s.status === "ACTIVE_WATCH" || s.status === "CONFIRMED";
      return true;
    });

    // Sort by Tier (A+ -> A -> B) and Confluence Score (descending)
    return list.sort((a, b) => {
      const scoreA = a.scenarioScore ?? 0;
      const scoreB = b.scenarioScore ?? 0;
      if (scoreA !== scoreB) return scoreB - scoreA;

      const isActionableA = a.status === "ACTIVE_WATCH" || a.status === "CONFIRMED" ? 1 : 0;
      const isActionableB = b.status === "ACTIVE_WATCH" || b.status === "CONFIRMED" ? 1 : 0;
      return isActionableB - isActionableA;
    });
  }, [activeSetups, filterDirection, qualityMode]);

  // Filter Completed Setups
  const filteredCompletedSetups = useMemo(() => {
    return completedSetups.filter((s) => {
      if (filterDirection === "BULLISH" && s.direction !== "BULLISH") return false;
      if (filterDirection === "BEARISH" && s.direction !== "BEARISH") return false;
      return true;
    });
  }, [completedSetups, filterDirection]);

  // Displayed setups list based on active tab
  const displayedSetups = activeTab === "ACTIVE" ? filteredActiveSetups : filteredCompletedSetups;

  // Selected setup
  const selectedSetup = displayedSetups.find((s) => s.id === selectedSetupId) || displayedSetups[0] || engineSummary.setups[0];

  if (!isOpen) return null;

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

  /** Status-aware Execute button config */
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
            ? "Entry zone not touched yet in replay. Click again to force-enter."
            : "Breakout not confirmed yet in replay. Click again to force-enter.",
        };
        return {
          disabled: false,
          className: "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-400",
          icon: <AlertTriangle className="w-3 h-3" />,
          label: setup.status === "PENDING_TOUCH" ? "Not Touched" : "Not Confirmed",
          onClick: () => setConfirmingSetupId(setup.id),
          title: setup.status === "PENDING_TOUCH"
            ? "Entry zone not yet reached in replay. Click to see force-entry option."
            : "Breakout not confirmed yet in replay. Click to see force-entry option.",
        };

      case "TARGET_HIT":
        return {
          disabled: false,
          className: "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30",
          icon: <Check className="w-3 h-3 text-emerald-400" />,
          label: "Log Win 🎯",
          onClick: () => handleExecute(setup),
          title: "Log completed winning trade into backtest journal with open/close timeline data",
        };

      case "INVALIDATED":
        return {
          disabled: false,
          className: "bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30",
          icon: <Ban className="w-3 h-3 text-rose-400" />,
          label: "Log Loss 🚫",
          onClick: () => handleExecute(setup),
          title: "Log completed invalidated trade into backtest journal with open/close timeline data",
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-[fade-in_0.15s_ease-out]">
      <div className="relative w-full max-w-[90vw] max-h-[92vh] flex flex-col bg-card/95 border border-card-border shadow-2xl rounded-2xl overflow-hidden font-sans text-foreground">

        {/* ── Modal Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-card-border bg-background/60 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black tracking-widest uppercase text-foreground">
                  [ REPLAY POTENTIAL TRADES & CONTEXT ]
                </h2>
                <span className="px-2 py-0.5 text-[9px] font-black uppercase rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  MARKET REPLAY
                </span>
              </div>
              <p className="text-[10px] text-muted font-bold uppercase tracking-wider">
                Historical Replay IPDA Liquidity & Structure Matrix
              </p>
            </div>
          </div>

          {/* ── Tab Navigation Selector ─────────────────────────────────────── */}
          <div className="flex items-center gap-1.5 p-1 bg-background/60 border border-card-border rounded-xl">
            <button
              onClick={() => setActiveTab("ACTIVE")}
              className={`flex items-center gap-2 px-4 py-1.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                activeTab === "ACTIVE"
                  ? "bg-purple-600 text-white shadow-sm shadow-purple-500/30"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>⚡ Active Setups</span>
              <span className="px-1.5 py-0.2 text-[9px] font-mono font-black rounded-full bg-background/40">
                {activeSetups.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("COMPLETED")}
              className={`flex items-center gap-2 px-4 py-1.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                activeTab === "COMPLETED"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>📜 Completed Log</span>
              <span className="px-1.5 py-0.2 text-[9px] font-mono font-black rounded-full bg-background/40">
                {completedSetups.length}
              </span>
            </button>
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
              <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                <Zap className="w-4 h-4 animate-pulse fill-current" />
              </div>
              <div>
                <span className="font-black uppercase tracking-wider text-foreground flex items-center gap-2">
                  Replay Auto-Execution Engine
                  {autoExecuteCount > 0 ? (
                    <span className="px-2 py-0.5 text-[9px] font-black uppercase rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
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
                    ? "Selected setup(s) are actively monitored during market replay. Position will automatically open in your Backtest Journal the instant price touches entry range."
                    : "Click '⚡ Auto-Open' on any setup below to automatically log trades to your Backtest Journal when price hits entry."}
                </span>
              </div>
            </div>
            {autoExecuteCount > 0 && (
              <span className="px-3 py-1.5 bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded-lg text-[10px] font-mono font-bold uppercase shrink-0">
                {autoExecuteCount} Auto-Active
              </span>
            )}
          </div>

          {/* ── 1. Telemetry Bar (Market Context Cards) ────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Live Price */}
            <div className="p-3 bg-background/50 border border-card-border rounded-xl space-y-1">
              <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">Replay Cursor Price</span>
              <div className="text-sm font-mono font-black text-foreground">
                ${engineSummary.currentPrice.toFixed(2)}
              </div>
            </div>

            {/* Institutional Bias */}
            <div className="p-3 bg-background/50 border border-card-border rounded-xl space-y-1">
              <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">Institutional Bias</span>
              <div className="text-xs font-mono font-black uppercase text-emerald-400 truncate">
                {engineSummary.institutionalBias.replace("_", " ")}
              </div>
            </div>

            {/* Dealing Range EQ */}
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

            {/* BSL Magnet Target */}
            <div className="p-3 bg-background/50 border border-card-border rounded-xl space-y-1">
              <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider block">BSL Target (High)</span>
              <div className="text-sm font-mono font-bold text-emerald-400">
                ${engineSummary.bslMagnets[0]?.toFixed(2) || engineSummary.swingHigh.toFixed(2)}
              </div>
            </div>

            {/* SSL Magnet Target */}
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
                  {activeTab === "ACTIVE"
                    ? `Actionable Replay Setups (${filteredActiveSetups.length} Sorted by Tier & Score)`
                    : `Completed Replay Log (${filteredCompletedSetups.length} Trades Recorded)`}
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Quality Mode Pills — Active Tab Only */}
                {activeTab === "ACTIVE" && (
                  <div className="flex items-center gap-1 p-1 bg-background/50 border border-card-border rounded-lg">
                    <button
                      onClick={() => setQualityMode("PREMIUM")}
                      className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                        qualityMode === "PREMIUM"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      ⭐ Premium (A+/A Only)
                    </button>
                    <button
                      onClick={() => setQualityMode("ENTRY_ZONE")}
                      className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                        qualityMode === "ENTRY_ZONE"
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      🎯 In Entry Zone
                    </button>
                    <button
                      onClick={() => setQualityMode("ALL")}
                      className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                        qualityMode === "ALL"
                          ? "bg-purple-600 text-white shadow-sm"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      All Active Setups
                    </button>
                  </div>
                )}

                {/* Direction Filters */}
                <div className="flex items-center gap-1.5 p-1 bg-background/50 border border-card-border rounded-lg">
                  <button
                    onClick={() => setFilterDirection("ALL")}
                    className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                      filterDirection === "ALL"
                        ? "bg-purple-600 text-white shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    All ({displayedSetups.length})
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
                  <tbody className="divide-y divide-card-border/60">
                    {displayedSetups.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-muted font-mono">
                          {activeTab === "ACTIVE"
                            ? "No active setups match the selected filter. Try selecting 'All Active Setups'."
                            : "No completed replay trades logged yet."}
                        </td>
                      </tr>
                    ) : (
                      displayedSetups.map((setup) => {
                        const isSelected = selectedSetup?.id === setup.id;
                        return (
                          <tr
                            key={setup.id}
                            onClick={() => setSelectedSetupId(setup.id)}
                            className={`group transition-colors cursor-pointer ${
                              isSelected ? "bg-purple-500/10 hover:bg-purple-500/15" : "hover:bg-card-hover/20"
                            }`}
                          >
                            <td className="px-4 py-3.5 font-mono font-black text-foreground">
                              {setup.id}
                            </td>
                            <td className="px-4 py-3.5 font-bold text-foreground">
                              <div className="flex items-center gap-2">
                                <span>{setup.type}</span>
                                {setup.scenarioTier && (
                                  <span className={`px-1.5 py-0.5 text-[8px] font-mono font-black rounded border ${
                                    setup.scenarioTier === "A+" ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
                                    setup.scenarioTier === "A" ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" :
                                    "bg-purple-500/20 text-purple-300 border-purple-500/40"
                                  }`}>
                                    {setup.scenarioTier} ({setup.scenarioScore}%)
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="px-4 py-3.5">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-black rounded ${
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
                            <td className="px-4 py-3.5 font-mono text-foreground font-bold">
                              ${setup.entryMin.toFixed(2)} – ${setup.entryMax.toFixed(2)}
                            </td>
                            <td className="px-4 py-3.5 font-mono text-rose-400 font-bold">
                              ${setup.stopLoss.toFixed(2)}
                            </td>
                            <td className="px-4 py-3.5 font-mono text-emerald-400">
                              <span className="font-bold">${setup.target1.toFixed(2)}</span> / ${setup.target2.toFixed(2)}
                            </td>
                            <td className="px-4 py-3.5 font-mono font-black text-purple-400">
                              1 : {setup.rrRatio}
                            </td>
                            <td className="px-4 py-3.5">
                              <span
                                className={`px-2 py-0.5 text-[8px] font-black tracking-wider uppercase rounded ${
                                  setup.status === "TARGET_HIT"
                                    ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 animate-pulse"
                                    : setup.status === "ACTIVE_WATCH"
                                    ? "bg-cyan-500 text-white shadow-sm"
                                    : setup.status === "CONFIRMED"
                                    ? "bg-purple-600 text-white"
                                    : setup.status === "INVALIDATED"
                                    ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                                    : "bg-card text-muted border border-card-border"
                                }`}
                              >
                                {setup.status === "TARGET_HIT" ? "TARGET HIT 🎯" : setup.status.replace("_", " ")}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-right flex items-center justify-end gap-1.5">
                              {/* Auto-Open Toggle */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleAutoExecute(setup);
                                }}
                                className={`flex items-center gap-1 px-2.5 py-1 text-[9px] font-black uppercase rounded-lg border transition-all cursor-pointer ${
                                  setup.isAutoOpened
                                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                    : setup.isAutoExecute
                                    ? "bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/20"
                                    : "bg-muted/10 hover:bg-card-border/50 text-muted hover:text-foreground border-card-border"
                                }`}
                                title={
                                  setup.isAutoOpened
                                    ? "Trade auto-opened into backtest journal"
                                    : setup.isAutoExecute
                                    ? "Auto-Open ENABLED: Click to disable"
                                    : "Click to enable Auto-Open when entry triggers"
                                }
                              >
                                <Zap className={`w-3 h-3 ${setup.isAutoExecute ? "text-cyan-400 fill-current animate-pulse" : ""}`} />
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
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cfg.onClick();
                                    }}
                                    disabled={cfg.disabled}
                                    className={`flex items-center gap-1 px-2.5 py-1 text-[9px] font-black uppercase rounded-lg transition-all ${
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopySetup(setup);
                                }}
                                className="p-1.5 bg-card hover:bg-purple-500/20 hover:text-purple-400 border border-card-border rounded-lg transition-all text-muted cursor-pointer"
                                title="Copy setup parameters"
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
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── 3. Streamlined Trade Inspector Card ───────────────────────────── */}
          {selectedSetup && (
            <div className="p-5 bg-card/60 border border-card-border rounded-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border/60 pb-3">
                <div className="flex items-center gap-3">
                  <Target className="w-5 h-5 text-purple-400" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-black uppercase tracking-wider text-foreground">
                        [{selectedSetup.id}: {selectedSetup.type}]
                      </h4>
                      {selectedSetup.scenarioTier && (
                        <span className={`px-2 py-0.5 text-[9px] font-mono font-black uppercase rounded border ${
                          selectedSetup.scenarioTier === "A+" ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
                          selectedSetup.scenarioTier === "A" ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" :
                          "bg-purple-500/20 text-purple-300 border-purple-500/40"
                        }`}>
                          Tier {selectedSetup.scenarioTier} • Score: {selectedSetup.scenarioScore}%
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted font-medium">
                      R:R 1:{selectedSetup.rrRatio} • {selectedSetup.confluence}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Inspector Auto-Open Toggle Button */}
                  <button
                    onClick={() => handleToggleAutoExecute(selectedSetup)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase rounded-lg border transition-all cursor-pointer ${
                      selectedSetup.isAutoOpened
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        : selectedSetup.isAutoExecute
                        ? "bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/20"
                        : "bg-muted/10 hover:bg-card-border/50 text-muted hover:text-foreground border-card-border"
                    }`}
                    title={
                      selectedSetup.isAutoOpened
                        ? "Position auto-opened into backtest journal"
                        : selectedSetup.isAutoExecute
                        ? "Auto-Open ENABLED: Click to disable"
                        : "Click to enable Auto-Open when price touches entry"
                    }
                  >
                    <Zap className={`w-3.5 h-3.5 ${selectedSetup.isAutoExecute ? "text-cyan-400 fill-current animate-pulse" : ""}`} />
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
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 text-[10px] font-black uppercase rounded-lg shadow-sm transition-all ${
                          cfg.disabled ? '' : 'cursor-pointer'
                        } ${cfg.className}`}
                        title={cfg.title}
                      >
                        {cfg.icon}
                        <span>
                          {executedSuccessId === selectedSetup.id
                            ? "Trade Executed & Recorded!"
                            : cfg.label === "Execute"
                            ? "Execute Replay Trade"
                            : cfg.label}
                        </span>
                      </button>
                    );
                  })()}

                  <button
                    onClick={() => handleCopySetup(selectedSetup)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-[10px] font-black uppercase rounded-lg shadow-sm hover:bg-purple-700 transition-all cursor-pointer"
                  >
                    {copyState === selectedSetup.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copyState === selectedSetup.id ? "Copied!" : "Copy Parameters"}</span>
                  </button>
                </div>
              </div>

              {/* Key Price Levels Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-background/50 border border-card-border rounded-lg space-y-1">
                  <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">Entry Range</span>
                  <div className="text-xs font-mono font-black text-foreground">
                    ${selectedSetup.entryMin.toFixed(2)} – ${selectedSetup.entryMax.toFixed(2)}
                  </div>
                </div>
                <div className="p-3 bg-background/50 border border-card-border rounded-lg space-y-1">
                  <span className="text-[9px] font-bold text-rose-500 uppercase tracking-wider block">Stop Loss (ATR Buffered)</span>
                  <div className="text-xs font-mono font-black text-rose-400">
                    ${selectedSetup.stopLoss.toFixed(2)}
                  </div>
                </div>
                <div className="p-3 bg-background/50 border border-card-border rounded-lg space-y-1">
                  <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider block">TP1 (1:1 Floor)</span>
                  <div className="text-xs font-mono font-black text-emerald-400">
                    ${selectedSetup.target1.toFixed(2)}
                  </div>
                </div>
                <div className="p-3 bg-background/50 border border-card-border rounded-lg space-y-1">
                  <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider block">TP2 (Structural Magnet)</span>
                  <div className="text-xs font-mono font-black text-emerald-400">
                    ${selectedSetup.target2.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="space-y-1 p-3 bg-background/50 border border-card-border rounded-lg">
                  <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">Trigger Condition</span>
                  <p className="text-foreground font-medium leading-relaxed">
                    {selectedSetup.trigger}
                  </p>
                </div>
                <div className="space-y-1 p-3 bg-background/50 border border-card-border rounded-lg">
                  <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">Institutional Confluences</span>
                  <p className="text-purple-400 font-medium leading-relaxed">
                    {selectedSetup.confluence}
                  </p>
                </div>
              </div>

              {/* 🎯 Collapsible Institutional Best Scenario Join Guide Accordion */}
              {selectedSetup.scenarioRules && selectedSetup.scenarioRules.length > 0 && (
                <div className="border border-amber-500/30 rounded-xl overflow-hidden bg-background/40">
                  <button
                    onClick={() => setIsJoinGuideOpen(!isJoinGuideOpen)}
                    className="w-full flex items-center justify-between p-3 bg-amber-500/10 hover:bg-amber-500/15 text-amber-300 text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>Institutional Best Scenario Join Guide</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-mono">
                      <span>{selectedSetup.scenarioRules.length} Execution Rules</span>
                      {isJoinGuideOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>

                  {isJoinGuideOpen && (
                    <div className="p-4 space-y-2 text-xs text-foreground border-t border-amber-500/20 bg-background/60">
                      {selectedSetup.scenarioRules.map((rule, idx) => (
                        <div key={idx} className="flex items-start gap-2.5 bg-background/80 p-2.5 rounded-lg border border-card-border/40">
                          <span className="font-mono text-purple-400 text-[10px] font-black mt-0.5">{idx + 1}.</span>
                          <span className="leading-relaxed font-medium">{rule}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Trade Timeline — visible for completed setups ── */}
              {(selectedSetup.status === "TARGET_HIT" || selectedSetup.status === "INVALIDATED") && (
                <div className="space-y-2 pt-2 border-t border-card-border/50">
                  <span className="text-[9px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                    <span className={selectedSetup.status === "TARGET_HIT" ? "text-emerald-400" : "text-rose-400"}>
                      {selectedSetup.status === "TARGET_HIT" ? "✓" : "✕"}
                    </span>
                    Replay Trade Timeline & Execution Summary
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Open */}
                    <div className={`p-3 rounded-lg border space-y-2 ${
                      selectedSetup.status === "TARGET_HIT"
                        ? "bg-emerald-500/5 border-emerald-500/20"
                        : "bg-rose-500/5 border-rose-500/20"
                    }`}>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted block">
                        📥 Replay Open
                      </span>
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
                              ? new Date(selectedSetup.openTime).toLocaleDateString("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "short", year: "numeric" })
                              : <span className="text-muted italic">Replay timestamp</span>}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted">Time (Cairo)</span>
                          <span className="text-[10px] font-mono text-foreground">
                            {selectedSetup.openTime
                              ? new Date(selectedSetup.openTime).toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
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
                        {selectedSetup.status === "TARGET_HIT" ? "🎯 Replay Close (Target Hit)" : "🚫 Replay Close (Invalidated)"}
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
                              ? new Date(selectedSetup.closeTime).toLocaleDateString("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "short", year: "numeric" })
                              : <span className="text-muted italic">Replay timestamp</span>}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted">Time (Cairo)</span>
                          <span className="text-[10px] font-mono text-foreground">
                            {selectedSetup.closeTime
                              ? new Date(selectedSetup.closeTime).toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
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
