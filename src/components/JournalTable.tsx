"use client";

import { useState, useCallback } from "react";
import { Play, Pause, XCircle, Trash2, Loader2, RefreshCw, AlertTriangle } from "lucide-react";

export interface TradeRecord {
  id: string;
  timestamp: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entry_price: string | number;
  stop_loss: string | number;
  take_profit: string | number;
  status: "OPEN" | "CLOSED" | "PAUSED";
  strategy_name: string;
  ai_narrative_summary: string | null;
  created_at: string;
}

interface JournalTableProps {
  initialTrades: TradeRecord[];
}

export function JournalTable({ initialTrades }: JournalTableProps) {
  const [trades, setTrades] = useState<TradeRecord[]>(initialTrades);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ── 1. GET: Fetch latest trade list (refresh) ──────────────────────────
  const refreshTrades = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/trades");
      if (res.ok) {
        const json = await res.json();
        setTrades(json.trades || []);
      } else {
        console.error("[JOURNAL] Failed to fetch latest trades:", res.statusText);
      }
    } catch (err) {
      console.error("[JOURNAL] Refresh request failed:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // ── 2. PATCH: Toggle position status (Pause / Stop / Reactivate) ────────
  const handleToggleStatus = useCallback(async (trade: TradeRecord) => {
    const nextStatus = trade.status === "PAUSED" ? "OPEN" : "PAUSED";
    setActionLoadingId(`${trade.id}-toggle`);

    try {
      const res = await fetch("/api/trades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: trade.id, status: nextStatus })
      });

      if (res.ok) {
        const json = await res.json();
        // Optimistically update the status locally for fluid UI interaction
        setTrades(prev =>
          prev.map(t => (t.id === trade.id ? { ...t, status: json.trade.status } : t))
        );
      } else {
        const json = await res.json();
        alert(`Failed to toggle position: ${json.error}`);
      }
    } catch (err) {
      console.error("[JOURNAL] Toggle request failed:", err);
    } finally {
      setActionLoadingId(null);
    }
  }, []);

  // ── 3. PATCH: Manually close active trade ──────────────────────────────
  const handleClosePosition = useCallback(async (tradeId: string) => {
    setActionLoadingId(`${tradeId}-close`);

    try {
      const res = await fetch("/api/trades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: tradeId, status: "CLOSED" })
      });

      if (res.ok) {
        const json = await res.json();
        // Optimistically update the status locally for fluid UI interaction
        setTrades(prev =>
          prev.map(t => (t.id === tradeId ? { ...t, status: json.trade.status } : t))
        );
      } else {
        const json = await res.json();
        alert(`Failed to close position: ${json.error}`);
      }
    } catch (err) {
      console.error("[JOURNAL] Close request failed:", err);
    } finally {
      setActionLoadingId(null);
    }
  }, []);

  // ── 4. DELETE: Surgical hard row deletion ──────────────────────────────
  const handleDeleteTrade = useCallback(async (tradeId: string) => {
    setActionLoadingId(`${tradeId}-delete`);

    try {
      const res = await fetch(`/api/trades?trade_id=${tradeId}`, {
        method: "DELETE"
      });

      if (res.ok) {
        // Optimistically delete from the local trade array
        setTrades(prev => prev.filter(t => t.id !== tradeId));
        setDeleteConfirmId(null);
      } else {
        const json = await res.json();
        alert(`Failed to delete trade record: ${json.error}`);
      }
    } catch (err) {
      console.error("[JOURNAL] Delete request failed:", err);
    } finally {
      setActionLoadingId(null);
    }
  }, []);

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      // Hardcode Africa/Cairo UTC+3 to align with system clock display
      return date.toLocaleString("en-US", {
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Table Subheader Control Actions */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-[#958da3] uppercase tracking-wider">
          Audited Positions: {trades.length}
        </span>
        <button
          onClick={refreshTrades}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1c1b1c] border border-[#4a4457] hover:border-[#50ffaf] text-[#958da3] hover:text-[#50ffaf] font-mono text-[9px] font-black uppercase tracking-widest transition-all rounded-none shadow-md cursor-pointer disabled:opacity-50"
        >
          {isRefreshing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          <span>[ Sync Logs ]</span>
        </button>
      </div>

      {/* Main Glassmorphism Data Table Wrapper */}
      <div className="w-full border border-[#4a4457]/50 bg-[#1c1b1c]/80 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden relative">
        <div className="absolute inset-0 shadow-[inset_0_0_100px_rgba(255,255,255,0.01)] pointer-events-none z-10" />

        <div className="overflow-x-auto min-w-full">
          <table className="w-full border-collapse text-left text-xs text-[#e5e2e3]">
            <thead>
              <tr className="border-b border-[#4a4457]/50 bg-black/40 text-[9px] font-bold uppercase tracking-widest text-[#958da3]">
                <th className="py-4 px-4 md:px-6">Timestamp (UTC+3)</th>
                <th className="py-4 px-4">Asset</th>
                <th className="py-4 px-4">Direction</th>
                <th className="py-4 px-4 text-right">Entry Price</th>
                <th className="py-4 px-4 text-right">Stop Loss</th>
                <th className="py-4 px-4 text-right">Take Profit</th>
                <th className="py-4 px-4">Strategy</th>
                <th className="py-4 px-4">Status</th>
                <th className="py-4 px-4 md:px-6 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-[#958da3] font-mono">
                    No trade records found. Execute trades from the terminal or wait for custom strategies to trigger.
                  </td>
                </tr>
              ) : (
                trades.map((trade) => {
                  const isLoading = actionLoadingId?.startsWith(trade.id);
                  const isDeletingConfirm = deleteConfirmId === trade.id;

                  return (
                    <tr
                      key={trade.id}
                      className="border-b border-[#4a4457]/30 hover:bg-white/2 transition-colors relative"
                    >
                      {/* 1. Date / Time */}
                      <td className="py-4 px-4 md:px-6 font-mono text-[11px] text-[#958da3]">
                        {formatDate(trade.created_at || trade.timestamp)}
                      </td>

                      {/* 2. Asset */}
                      <td className="py-4 px-4 font-mono font-bold text-[#e5e2e3]">
                        {trade.symbol}
                      </td>

                      {/* 3. Direction (LONG / SHORT) */}
                      <td className="py-4 px-4">
                        <span
                          className={`px-2 py-0.5 border font-mono text-[9px] font-black uppercase tracking-widest rounded-sm ${
                            trade.direction === "LONG"
                              ? "bg-[#50ffaf]/10 border-[#50ffaf]/30 text-[#50ffaf]"
                              : "bg-[#ffb4ab]/10 border-[#ffb4ab]/30 text-[#ffb4ab]"
                          }`}
                        >
                          {trade.direction}
                        </span>
                      </td>

                      {/* 4. Entry Price */}
                      <td className="py-4 px-4 text-right font-mono font-medium text-[#e5e2e3]">
                        {parseFloat(String(trade.entry_price)).toFixed(2)}
                      </td>

                      {/* 5. Stop Loss */}
                      <td className="py-4 px-4 text-right font-mono text-red-400">
                        {parseFloat(String(trade.stop_loss)).toFixed(2)}
                      </td>

                      {/* 6. Take Profit */}
                      <td className="py-4 px-4 text-right font-mono text-emerald-400">
                        {parseFloat(String(trade.take_profit)).toFixed(2)}
                      </td>

                      {/* 7. Strategy Name */}
                      <td className="py-4 px-4 font-mono text-[11px] text-[#958da3] max-w-[150px] truncate">
                        {trade.strategy_name}
                      </td>

                      {/* 8. Status Badge */}
                      <td className="py-4 px-4">
                        <span
                          className={`px-2 py-0.5 border font-mono text-[9px] font-black uppercase tracking-widest rounded-sm leading-none flex items-center gap-1.5 w-fit ${
                            trade.status === "OPEN"
                              ? "bg-[#50ffaf]/10 border-[#50ffaf]/40 text-[#50ffaf] shadow-[0_0_10px_rgba(80,255,175,0.15)] animate-pulse"
                              : trade.status === "PAUSED"
                              ? "bg-amber-500/10 border-amber-500/40 text-amber-400"
                              : "bg-zinc-800/40 border-zinc-700/40 text-zinc-500"
                          }`}
                        >
                          {trade.status === "OPEN" && (
                            <span className="w-1 h-1 rounded-full bg-[#50ffaf]" />
                          )}
                          {trade.status}
                        </span>
                      </td>

                      {/* 9. CRUD Actions Column */}
                      <td className="py-3 px-4 md:px-6">
                        <div className="flex items-center justify-center gap-2">
                          {isDeletingConfirm ? (
                            // DELETE Confirmation Prompt
                            <div className="flex items-center gap-2 bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 p-1 rounded-sm animate-fade-in">
                              <span className="text-[9px] font-black uppercase text-[#ffb4ab] flex items-center gap-1 font-mono">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                Purge Row?
                              </span>
                              <button
                                onClick={() => handleDeleteTrade(trade.id)}
                                disabled={isLoading}
                                className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white font-mono text-[9px] font-black uppercase tracking-widest cursor-pointer border-none"
                              >
                                {isLoading ? "Purging..." : "Yes"}
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                disabled={isLoading}
                                className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-[#958da3] font-mono text-[9px] font-black uppercase tracking-widest cursor-pointer border-none"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            // Core Position Management Buttons
                            <>
                              {/* Pause / Resume Trigger */}
                              {trade.status !== "CLOSED" && (
                                <button
                                  onClick={() => handleToggleStatus(trade)}
                                  disabled={isLoading}
                                  className={`p-1.5 border rounded-sm transition-all cursor-pointer ${
                                    trade.status === "PAUSED"
                                      ? "bg-[#50ffaf]/5 border-[#4a4457] hover:border-[#50ffaf] text-[#958da3] hover:text-[#50ffaf]"
                                      : "bg-amber-500/5 border-[#4a4457] hover:border-amber-500 text-[#958da3] hover:text-amber-400"
                                  }`}
                                  title={trade.status === "PAUSED" ? "Reactivate Position" : "Pause Tracking"}
                                >
                                  {isLoading && actionLoadingId === `${trade.id}-toggle` ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : trade.status === "PAUSED" ? (
                                    <Play className="w-3 h-3" />
                                  ) : (
                                    <Pause className="w-3 h-3" />
                                  )}
                                </button>
                              )}

                              {/* Manual Close Position */}
                              {trade.status !== "CLOSED" && (
                                <button
                                  onClick={() => handleClosePosition(trade.id)}
                                  disabled={isLoading}
                                  className="p-1.5 bg-zinc-800/40 border border-[#4a4457] hover:border-[#ffb4ab] text-[#958da3] hover:text-[#ffb4ab] rounded-sm transition-all cursor-pointer"
                                  title="Manually Close Trade"
                                >
                                  {isLoading && actionLoadingId === `${trade.id}-close` ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <XCircle className="w-3 h-3" />
                                  )}
                                </button>
                              )}

                              {/* Surgical Delete */}
                              <button
                                onClick={() => setDeleteConfirmId(trade.id)}
                                disabled={isLoading}
                                className="p-1.5 bg-red-500/5 border border-[#4a4457] hover:border-red-500/50 hover:bg-red-500/10 text-[#958da3] hover:text-red-400 rounded-sm transition-all cursor-pointer"
                                title="Purge Record"
                              >
                                {isLoading && actionLoadingId === `${trade.id}-delete` ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3 h-3" />
                                )}
                              </button>
                            </>
                          )}
                        </div>
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
  );
}
