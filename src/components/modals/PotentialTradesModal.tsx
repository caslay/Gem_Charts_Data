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
  BarChart2
} from "lucide-react";
import { useMarketDataContext } from "@/context/MarketDataContext";
import { generatePotentialTrades, PotentialTrade } from "@/lib/quantTradeEngine";

interface PotentialTradesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PotentialTradesModal({ isOpen, onClose }: PotentialTradesModalProps) {
  const { data } = useMarketDataContext();
  const [filterDirection, setFilterDirection] = useState<"ALL" | "BULLISH" | "BEARISH">("ALL");
  const [selectedSetupId, setSelectedSetupId] = useState<string | null>("SET-01");
  const [copyState, setCopyState] = useState<string | null>(null);

  const engineSummary = useMemo(() => generatePotentialTrades(data), [data]);

  if (!isOpen) return null;

  const filteredSetups = engineSummary.setups.filter((s) => {
    if (filterDirection === "BULLISH") return s.direction === "BULLISH";
    if (filterDirection === "BEARISH") return s.direction === "BEARISH";
    return true;
  });

  const selectedSetup = engineSummary.setups.find((s) => s.id === selectedSetupId) || engineSummary.setups[0];

  const handleCopySetup = (setup: PotentialTrade) => {
    const text = `[QUANT TRADE SETUP: ${setup.id} - ${setup.type}]
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-[fade-in_0.15s_ease-out]">
      <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col bg-card/95 border border-card-border shadow-2xl rounded-2xl overflow-hidden font-sans text-foreground">
        
        {/* ── Modal Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-card-border bg-background/60 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent/10 border border-accent/20 text-accent">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black tracking-widest uppercase text-foreground">
                  [ QUANT POTENTIAL TRADES & CONTEXT ]
                </h2>
                <span className="px-2 py-0.5 text-[9px] font-black uppercase rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  LIVE ENGINE
                </span>
              </div>
              <p className="text-[10px] text-muted font-bold uppercase tracking-wider">
                Institutional IPDA Liquidity & Structure Matrix
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-muted hover:text-foreground hover:bg-card-hover/20 rounded-xl transition-all cursor-pointer"
            title="Close Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Scrollable Body ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* ── 1. Telemetry Bar (Market Context Cards) ────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            
            {/* Live Price */}
            <div className="p-3 bg-background/50 border border-card-border rounded-xl space-y-1">
              <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">Live Price</span>
              <div className="text-sm font-mono font-black text-foreground">
                ${engineSummary.currentPrice.toFixed(2)}
              </div>
            </div>

            {/* True Day Open */}
            <div className="p-3 bg-background/50 border border-card-border rounded-xl space-y-1">
              <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">True Day Open</span>
              <div className="text-sm font-mono font-bold text-cyan-400">
                ${engineSummary.trueDayOpen.toFixed(2)}
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
                <Sparkles className="w-4 h-4 text-accent" />
                <h3 className="text-xs font-black uppercase tracking-wider text-foreground">
                  Evaluated High-Probability Setups
                </h3>
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
                  Bullish Only
                </button>
                <button
                  onClick={() => setFilterDirection("BEARISH")}
                  className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                    filterDirection === "BEARISH"
                      ? "bg-rose-500 text-white shadow-sm"
                      : "text-rose-500/70 hover:text-rose-400"
                  }`}
                >
                  Bearish Only
                </button>
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
                    {filteredSetups.map((setup) => {
                      const isSelected = selectedSetup?.id === setup.id;
                      return (
                        <tr
                          key={setup.id}
                          onClick={() => setSelectedSetupId(setup.id)}
                          className={`group transition-colors cursor-pointer ${
                            isSelected ? "bg-accent/10 hover:bg-accent/15" : "hover:bg-card-hover/20"
                          }`}
                        >
                          <td className="px-4 py-3.5 font-mono font-black text-foreground">
                            {setup.id}
                          </td>
                          <td className="px-4 py-3.5 font-bold text-foreground">
                            {setup.type}
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
                          <td className="px-4 py-3.5 font-mono font-black text-accent">
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
                          <td className="px-4 py-3.5 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopySetup(setup);
                              }}
                              className="p-1.5 bg-card hover:bg-accent/20 hover:text-accent border border-card-border rounded-lg transition-all text-muted cursor-pointer"
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
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── 3. Trade Inspector Card ───────────────────────────────────────── */}
          {selectedSetup && (
            <div className="p-5 bg-card/60 border border-card-border rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-accent" />
                  <h4 className="text-xs font-black uppercase tracking-wider text-foreground">
                    Detailed Execution Inspector — [{selectedSetup.id}: {selectedSetup.type}]
                  </h4>
                </div>
                <button
                  onClick={() => handleCopySetup(selectedSetup)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground text-[10px] font-black uppercase rounded-lg shadow-sm hover:opacity-90 transition-all cursor-pointer"
                >
                  {copyState === selectedSetup.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copyState === selectedSetup.id ? "Copied to Clipboard!" : "Copy Setup Parameters"}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-1.5 p-3 bg-background/50 border border-card-border rounded-lg">
                  <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">Trigger Condition</span>
                  <p className="text-foreground font-medium leading-relaxed">
                    {selectedSetup.trigger}
                  </p>
                </div>
                <div className="space-y-1.5 p-3 bg-background/50 border border-card-border rounded-lg">
                  <span className="text-[9px] font-bold text-muted uppercase tracking-wider block">Institutional Confluences</span>
                  <p className="text-accent font-medium leading-relaxed">
                    {selectedSetup.confluence}
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* ── Modal Footer ────────────────────────────────────────────────────── */}
        <div className="px-6 py-3 border-t border-card-border bg-background/60 flex items-center justify-between text-[10px] text-muted font-mono">
          <span>Flow-State Quant Engine V12.1.0</span>
          <span>Interbank Price Delivery Algorithm (IPDA) Rules Applied</span>
        </div>

      </div>
    </div>
  );
}
