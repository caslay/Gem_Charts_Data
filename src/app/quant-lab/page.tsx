/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { SYSTEM_VERSION } from "@/lib/version";
import {
  LineChart,
  Play,
  Calendar,
  Upload,
  Download,
  Trash2,
  FileCode,
  Coins,
  Activity,
  Award,
  ChevronRight,
  Sparkles,
  RefreshCw,
  TrendingUp
} from "lucide-react";
import { QuantLabRun, QuantLabTrade } from "@/lib/chartLayers/types";
import SettingsModal from "@/components/modals/SettingsModal";

export default function QuantLabPage() {
  // --- States ---
  const [isSoundSettingsOpen, setIsSoundSettingsOpen] = useState(false);
  const [runs, setRuns] = useState<QuantLabRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<QuantLabRun | null>(null);
  const [trades, setTrades] = useState<QuantLabTrade[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingTrades, setLoadingTrades] = useState(false);

  // Form states
  const [strategyName, setStrategyName] = useState("Institutuional FVG Sniper");
  const [startDate, setStartDate] = useState("2026-04-01");
  const [endDate, setEndDate] = useState("2026-05-20");
  const [strategyConfigText, setStrategyConfigText] = useState(
    JSON.stringify(
      {
        name: "Institutuional FVG Sniper",
        conditions: {
          direction: "LONG",
          sl_logic: "Structural Swing",
          tp_logic: "Nearest Order Book Magnet",
          risk_percent: 1.5,
          statistical_sensitivity: "STRICT",
          temporal_mode: "INSTANT",
          momentum_override: false,
          conditions: [
            { metric: "MARKET_TREND", operator: "EQUALS", value: "BULLISH" },
            { metric: "LOCAL_PRICING", operator: "EQUALS", value: "DISCOUNT" },
            { metric: "PRICE_IN_FVG", timeframe: "5m", direction: "BULLISH", operator: "IS_TRUE" }
          ]
        }
      },
      null,
      2
    )
  );
  const [configError, setConfigError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Backtest execution states
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [backtestProgress, setBacktestProgress] = useState<{
    date: string;
    equity: number;
    tradeCount: number;
  } | null>(null);

  // Pagination for trades
  const [currentPage, setCurrentPage] = useState(1);
  const tradesPerPage = 10;

  // --- Fetch Runs ---
  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await fetch("/api/quant-lab/runs");
      if (res.ok) {
        const json = await res.json();
        setRuns(json.runs || []);
      }
    } catch (err) {
      console.error("Failed to fetch historical runs:", err);
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // --- Fetch Trades for Selected Run ---
  const fetchTradesForRun = useCallback(async (runId: string) => {
    setLoadingTrades(true);
    try {
      const res = await fetch(`/api/quant-lab/trades?run_id=${runId}`);
      if (res.ok) {
        const json = await res.json();
        setTrades(json.trades || []);
        setCurrentPage(1);
      }
    } catch (err) {
      console.error("Failed to fetch trades for run:", err);
    } finally {
      setLoadingTrades(false);
    }
  }, []);

  const handleSelectRun = (run: QuantLabRun) => {
    setSelectedRun(run);
    fetchTradesForRun(run.id);
  };

  // --- Delete Run ---
  const handleDeleteRun = async (e: React.MouseEvent, runId: string) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this historical backtest run? All trade records will be lost.")) {
      return;
    }

    try {
      const res = await fetch(`/api/quant-lab/runs?id=${runId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setRuns(prev => prev.filter(r => r.id !== runId));
        if (selectedRun?.id === runId) {
          setSelectedRun(null);
          setTrades([]);
        }
      }
    } catch (err) {
      console.error("Failed to delete historical run:", err);
    }
  };

  // --- Drag and Drop Handlers ---
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        try {
          const jsonObj = JSON.parse(text);
          setStrategyConfigText(JSON.stringify(jsonObj, null, 2));
          setConfigError(null);
          if (jsonObj.name) {
            setStrategyName(jsonObj.name);
          }
        } catch (err) {
          setConfigError("Invalid JSON structure in uploaded file.");
        }
      };
      reader.readAsText(file);
    }
  };

  const handleManualConfigChange = (val: string) => {
    setStrategyConfigText(val);
    try {
      const parsed = JSON.parse(val);
      setConfigError(null);
      if (parsed.name) {
        setStrategyName(parsed.name);
      }
    } catch (err: any) {
      setConfigError(`Syntax Error: ${err.message}`);
    }
  };

  // --- Trigger Headless Backtest ---
  const runHeadlessBacktest = async () => {
    if (backtestRunning) return;
    if (configError) {
      alert("Please fix strategy configuration JSON syntax errors first.");
      return;
    }

    let parsedConfig: any = null;
    try {
      parsedConfig = JSON.parse(strategyConfigText);
    } catch {
      alert("Invalid JSON configuration.");
      return;
    }

    setBacktestRunning(true);
    setSelectedRun(null);
    setTrades([]);
    setBacktestProgress(null);
    setStatusMessage("Connecting to headless backtest processor...");

    try {
      const response = await fetch("/api/quant-lab/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_name: strategyName,
          strategy_config: parsedConfig,
          start_date: startDate,
          end_date: endDate,
          symbol: "ETHUSDC",
          timeframe: parsedConfig?.conditions?.target_timeframe || "5m",
          initial_capital: 10000.00
        })
      });

      if (!response.body) {
        throw new Error("Headless backtesting stream initialization failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const cleanLine = line.trim();
          if (cleanLine.startsWith("data: ")) {
            try {
              const payload = JSON.parse(cleanLine.substring(6));

              if (payload.type === "status") {
                setStatusMessage(payload.message);
              } else if (payload.type === "progress") {
                setBacktestProgress({
                  date: payload.date,
                  equity: payload.equity,
                  tradeCount: payload.tradeCount
                });
              } else if (payload.type === "complete") {
                setStatusMessage("Backtest execution completed! Run stored.");
                setRuns(prev => [payload.run, ...prev]);
                setSelectedRun(payload.run);
                setTrades(payload.trades);
                setBacktestRunning(false);
                setBacktestProgress(null);
              } else if (payload.type === "error") {
                setStatusMessage(`Execution Failed: ${payload.error}`);
                setBacktestRunning(false);
              }
            } catch (jsonErr) {
              console.error("Failed to parse SSE line JSON:", jsonErr);
            }
          }
        }
      }
    } catch (err: any) {
      console.error("Backtest stream failed:", err);
      setStatusMessage(`Network Failure: ${err.message}`);
      setBacktestRunning(false);
    }
  };

  // --- Export Surgical Data for Gemini Analysis ---
  const handleExportForAnalysis = () => {
    if (!selectedRun) return;

    const exportPayload = {
      run_metadata: {
        id: selectedRun.id,
        name: selectedRun.name,
        symbol: selectedRun.symbol,
        start_date: selectedRun.start_date.slice(0, 10),
        end_date: selectedRun.end_date.slice(0, 10),
        initial_balance: selectedRun.initial_balance,
        final_balance: selectedRun.final_balance,
        total_pnl_usd: selectedRun.total_pnl,
        win_rate_pct: selectedRun.win_rate_pct,
        total_trades: selectedRun.total_trades,
        winning_trades: selectedRun.winning_trades,
        losing_trades: selectedRun.losing_trades
      },
      strategy_logic: selectedRun.strategy_config,
      trade_records: trades.map(t => {
        const start = new Date(t.timestamp).getTime();
        const end = t.exit_timestamp ? new Date(t.exit_timestamp).getTime() : start;
        const duration_minutes = Math.max(1, Math.round((end - start) / 60000));

        return {
          id: t.id,
          timestamp: t.timestamp,
          exit_timestamp: t.exit_timestamp,
          duration_minutes,
          direction: t.direction,
          entry_price: parseFloat(Number(t.entry_price).toFixed(4)),
          exit_price: t.exit_price ? parseFloat(Number(t.exit_price).toFixed(4)) : null,
          stop_loss: parseFloat(Number(t.stop_loss).toFixed(4)),
          take_profit: parseFloat(Number(t.take_profit).toFixed(4)),
          realized_pnl_usd: t.realized_pnl ? parseFloat(Number(t.realized_pnl).toFixed(4)) : null,
          roi_pct: t.roi ? parseFloat(Number(t.roi).toFixed(4)) : null,
          position_size: parseFloat(Number(t.position_size).toFixed(4)),
          logic_trigger: t.logic_trigger,
          ipda_metrics_at_entry: t.ipda_metrics_at_entry
        };
      })
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `GEMINI_QUANT_LAB_${selectedRun.name.replace(/\s+/g, "_")}_${selectedRun.id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Pagination slice
  const paginatedTrades = useMemo(() => {
    const start = (currentPage - 1) * tradesPerPage;
    return trades.slice(start, start + tradesPerPage);
  }, [trades, currentPage]);

  const totalPages = Math.ceil(trades.length / tradesPerPage);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 overflow-x-hidden">
      {/* Dynamic Glow effects in Midnight */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Sub-Header container (using div to prevent matching global header styling rules) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800/50 pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1 rounded bg-emerald-500/10 text-emerald-400">
              <LineChart className="w-5 h-5" />
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold font-mono">
              Algorithmic Suite
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black font-mono tracking-tight text-white uppercase">
            Quant <span className="text-emerald-400">Lab</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            SMC & IPDA Headless Engine. Process massive historical sweeps sequentially with zero look-ahead bias and compile surgical AI analyses.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex flex-col text-right font-mono pr-4 border-r border-slate-800/50">
            <span className="text-[10px] text-slate-500 uppercase">Server Engine</span>
            <span className="text-xs text-emerald-400 font-bold flex items-center gap-1.5 justify-end">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              ONLINE [V{SYSTEM_VERSION}]
            </span>
          </div>
          <button
            onClick={() => setIsSoundSettingsOpen(true)}
            className="px-4 py-2 border border-purple-500/30 text-[11px] font-mono font-bold uppercase rounded bg-purple-950/20 text-purple-400 hover:bg-purple-950/40 hover:border-purple-400/50 transition cursor-pointer"
          >
            [ Command Center ]
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Sidebar: Historical Runs */}
        <aside className="lg:col-span-4 flex flex-col gap-6">
          <div className="border border-slate-800/50 bg-slate-900/20 backdrop-blur-sm rounded-lg p-5">
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-mono font-bold mb-4 flex items-center justify-between">
              <span>Historical Runs</span>
              <span className="px-2 py-0.5 rounded text-[9px] bg-slate-800 text-slate-300 font-normal">
                {runs.length} TOTAL
              </span>
            </h2>

            {loadingRuns ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500 font-mono text-xs">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Loading run ledger...</span>
              </div>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 border border-dashed border-slate-800 rounded-lg text-slate-500 font-mono text-[11px]">
                <span>No runs recorded in database.</span>
                <span className="text-[9px] text-slate-600 mt-1">Configure & start a new backtest setup.</span>
              </div>
            ) : (
              <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-1">
                {runs.map((run) => {
                  const isSelected = selectedRun?.id === run.id;
                  const isPositive = Number(run.total_pnl) >= 0;
                  return (
                    <div
                      key={run.id}
                      onClick={() => handleSelectRun(run)}
                      className={`group cursor-pointer border rounded-lg p-4 transition text-left flex flex-col justify-between hover:bg-slate-900/30 ${
                        isSelected
                          ? "border-emerald-500/50 bg-emerald-950/5"
                          : "border-slate-800/40 bg-slate-900/10"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-tight group-hover:text-white transition">
                            {run.name}
                          </h3>
                          <span className="text-[9px] text-slate-500 font-mono">
                            {run.symbol} | {run.strategy_config?.conditions?.target_timeframe || "5m"} timeframe
                          </span>
                        </div>
                        <button
                          onClick={(e) => handleDeleteRun(e, run.id)}
                          className="text-slate-600 hover:text-rose-400 p-1 rounded hover:bg-rose-950/20 transition opacity-0 group-hover:opacity-100 focus:opacity-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between border-t border-slate-800/30 pt-3 mt-1 font-mono text-[10px]">
                        <div className="flex flex-col">
                          <span className="text-slate-500 text-[8px] uppercase">Win Rate</span>
                          <span className="font-bold text-slate-300">
                            {Number(run.win_rate_pct).toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-slate-500 text-[8px] uppercase">Trades</span>
                          <span className="font-bold text-slate-300">{run.total_trades}</span>
                        </div>
                        <div className="flex flex-col text-right">
                          <span className="text-slate-500 text-[8px] uppercase">Total PnL</span>
                          <span className={`font-bold ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
                            {isPositive ? "+" : ""}${Number(run.total_pnl).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Right Section: Workspace */}
        <main className="lg:col-span-8 flex flex-col gap-6">
          {/* Backtest Controller Panel */}
          <section className="border border-slate-800/50 bg-slate-900/20 backdrop-blur-sm rounded-lg p-6">
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-mono font-bold mb-5 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>Backtest Configuration</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {/* Strategy Name */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-mono font-semibold text-slate-500 text-left">
                  Strategy Name
                </label>
                <input
                  type="text"
                  disabled={backtestRunning}
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                  className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none rounded text-white"
                />
              </div>

              {/* Start Date */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-mono font-semibold text-slate-500 text-left flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Start Date</span>
                </label>
                <input
                  type="date"
                  disabled={backtestRunning}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none rounded text-white"
                />
              </div>

              {/* End Date */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-mono font-semibold text-slate-500 text-left flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>End Date</span>
                </label>
                <input
                  type="date"
                  disabled={backtestRunning}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none rounded text-white"
                />
              </div>
            </div>

            {/* Strategy JSON Dropzone & Visualizer */}
            <div className="flex flex-col gap-2 mb-6">
              <label className="text-[10px] uppercase font-mono font-semibold text-slate-500 text-left">
                Strategy Config JSON
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* File Dropzone */}
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  className={`border border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-3 transition min-h-[220px] ${
                    dragActive
                      ? "border-emerald-400 bg-emerald-950/10"
                      : "border-slate-800 bg-slate-950/30 hover:border-slate-700"
                  }`}
                >
                  <Upload className={`w-8 h-8 ${dragActive ? "text-emerald-400 animate-bounce" : "text-slate-600"}`} />
                  <div className="text-center font-mono">
                    <span className="text-xs text-slate-200 block font-bold mb-1">
                      Drag & Drop Strategy JSON
                    </span>
                    <span className="text-[9px] text-slate-500 uppercase">
                      or click to browse local files
                    </span>
                  </div>
                  <input
                    type="file"
                    accept=".json"
                    disabled={backtestRunning}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          const text = event.target?.result as string;
                          handleManualConfigChange(text);
                        };
                        reader.readAsText(e.target.files[0]);
                      }
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
                    className="px-3 py-1.5 border border-slate-700 hover:border-slate-500 rounded bg-slate-900 text-[10px] font-bold font-mono uppercase cursor-pointer transition"
                  >
                    Select File
                  </label>
                </div>

                {/* Editor / Config Readout */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-mono text-slate-500 uppercase">Interactive Editor</span>
                    {configError ? (
                      <span className="text-[9px] font-mono text-rose-400 font-bold">{configError}</span>
                    ) : (
                      <span className="text-[9px] font-mono text-emerald-400 font-bold">JSON VALID</span>
                    )}
                  </div>
                  <textarea
                    disabled={backtestRunning}
                    value={strategyConfigText}
                    onChange={(e) => handleManualConfigChange(e.target.value)}
                    spellCheck="false"
                    className="w-full h-[220px] font-mono text-[10px] p-4 bg-slate-950 border border-slate-800 outline-none focus:border-emerald-500/40 rounded text-slate-300 resize-none overflow-y-auto"
                  />
                </div>
              </div>
            </div>

            {/* Run Button */}
            <div className="flex items-center justify-between border-t border-slate-800/30 pt-6">
              <div className="font-mono text-left">
                <p className="text-[10px] text-slate-500 uppercase">Active Asset</p>
                <p className="text-xs text-slate-300 font-bold">ETHUSDC (Binance Futures)</p>
              </div>

              <button
                onClick={runHeadlessBacktest}
                disabled={backtestRunning || !!configError}
                className={`px-6 py-3 rounded font-mono font-bold uppercase text-xs flex items-center gap-2 transition tracking-wider ${
                  backtestRunning
                    ? "bg-slate-900 border border-slate-800 text-slate-500 cursor-not-allowed"
                    : "bg-emerald-500 text-slate-950 font-black hover:bg-emerald-400 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                }`}
              >
                {backtestRunning ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Crunching Numbers...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Run Headless Backtest</span>
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Active Processing HUD */}
          {(backtestRunning || backtestProgress || statusMessage) && (
            <section className="border border-slate-800/50 bg-slate-900/20 backdrop-blur-sm rounded-lg p-5 text-left font-mono">
              <div className="flex items-center justify-between mb-3 border-b border-slate-800/50 pb-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                  Processing HUD
                </span>
                {backtestRunning && (
                  <span className="text-[9px] font-mono text-emerald-400 font-bold animate-pulse uppercase">
                    Headless Loop Active
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-300 mb-4">{statusMessage}</p>

              {backtestProgress && (
                <div className="grid grid-cols-3 gap-4 border border-emerald-500/20 bg-emerald-950/5 rounded-lg p-4 text-center">
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-500 uppercase">Tested Date</span>
                    <span className="text-sm font-bold text-slate-200">{backtestProgress.date}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-500 uppercase">Active Balance</span>
                    <span className="text-sm font-bold text-emerald-400">${backtestProgress.equity}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-500 uppercase">Trades Placed</span>
                    <span className="text-sm font-bold text-slate-200">{backtestProgress.tradeCount}</span>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Trades Ledger */}
          {selectedRun && (
            <section className="border border-slate-800/50 bg-slate-900/20 backdrop-blur-sm rounded-lg p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800/50 pb-5 mb-5 gap-4">
                <div className="text-left">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">
                    Execution Ledger
                  </span>
                  <h3 className="text-sm font-mono font-bold text-white uppercase mt-0.5">
                    {selectedRun.name} Results
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportForAnalysis}
                    className="px-4 py-2 border border-emerald-500/30 text-[10px] font-mono font-bold uppercase rounded bg-emerald-950/20 text-emerald-400 hover:bg-emerald-950/40 hover:border-emerald-400/50 flex items-center gap-1.5 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export For Analysis</span>
                  </button>
                </div>
              </div>

              {/* Statistics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 text-center font-mono">
                <div className="border border-slate-800/30 bg-slate-900/10 rounded p-3">
                  <span className="text-[8px] text-slate-500 uppercase block mb-1">Win Rate</span>
                  <span className="text-sm font-bold text-slate-200">{Number(selectedRun.win_rate_pct).toFixed(1)}%</span>
                </div>
                <div className="border border-slate-800/30 bg-slate-900/10 rounded p-3">
                  <span className="text-[8px] text-slate-500 uppercase block mb-1">Profit Trades</span>
                  <span className="text-sm font-bold text-emerald-400">{selectedRun.winning_trades} / {selectedRun.total_trades}</span>
                </div>
                <div className="border border-slate-800/30 bg-slate-900/10 rounded p-3">
                  <span className="text-[8px] text-slate-500 uppercase block mb-1">Final Balance</span>
                  <span className="text-sm font-bold text-slate-200">${Number(selectedRun.final_balance).toFixed(2)}</span>
                </div>
                <div className="border border-slate-800/30 bg-slate-900/10 rounded p-3">
                  <span className="text-[8px] text-slate-500 uppercase block mb-1">Net ROI</span>
                  <span className={`text-sm font-bold ${Number(selectedRun.total_pnl) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {Number(selectedRun.total_pnl) >= 0 ? "+" : ""}{((Number(selectedRun.total_pnl) / selectedRun.initial_balance) * 100).toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* Trades Table */}
              {loadingTrades ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500 font-mono text-xs">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Retrieving trade ledger...</span>
                </div>
              ) : trades.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 border border-dashed border-slate-800 rounded-lg text-slate-500 font-mono text-xs">
                  <span>No trades fired during this backtest run.</span>
                  <span className="text-[10px] mt-1 text-slate-600">The conditions in your strategy config did not align with market data.</span>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="overflow-x-auto">
                    <table className="w-full font-mono text-[10px] text-slate-300 text-left">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-500 uppercase">
                          <th className="py-3 px-2">Timestamp</th>
                          <th className="py-3 px-2">Dir</th>
                          <th className="py-3 px-2">Entry</th>
                          <th className="py-3 px-2">Exit</th>
                          <th className="py-3 px-2">SL / TP</th>
                          <th className="py-3 px-2 text-right">Realized P&L</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40">
                        {paginatedTrades.map((trade) => {
                          const pnl = Number(trade.realized_pnl);
                          const isWin = pnl > 0;
                          return (
                            <tr key={trade.id} className="hover:bg-slate-900/10">
                              <td className="py-3 px-2 text-slate-400">
                                {new Date(trade.timestamp).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZone: "UTC"
                                })}
                              </td>
                              <td className="py-3 px-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                    trade.direction === "LONG"
                                      ? "bg-emerald-950/30 text-emerald-400 border border-emerald-500/20"
                                      : "bg-rose-950/30 text-rose-400 border border-rose-500/20"
                                  }`}
                                >
                                  {trade.direction}
                                </span>
                              </td>
                              <td className="py-3 px-2 text-white">${Number(trade.entry_price).toFixed(2)}</td>
                              <td className="py-3 px-2 text-slate-400">
                                {trade.exit_price ? `$${Number(trade.exit_price).toFixed(2)}` : "—"}
                              </td>
                              <td className="py-3 px-2 text-slate-500 text-[9px]">
                                SL: {Number(trade.stop_loss).toFixed(1)} <br />
                                TP: {Number(trade.take_profit).toFixed(1)}
                              </td>
                              <td className={`py-3 px-2 text-right font-bold ${isWin ? "text-emerald-400" : "text-rose-400"}`}>
                                {isWin ? "+" : ""}${pnl.toFixed(2)}
                                <span className="text-[8px] font-normal text-slate-500 block">
                                  {trade.roi ? `${Number(trade.roi).toFixed(1)}% ROI` : ""}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Paginator */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-slate-800/40 pt-4 font-mono text-[10px]">
                      <span className="text-slate-500">
                        Page {currentPage} of {totalPages} ({trades.length} trades)
                      </span>

                      <div className="flex items-center gap-2">
                        <button
                          disabled={currentPage === 1}
                          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          className="px-2 py-1 border border-slate-800 rounded bg-slate-900/50 hover:border-slate-600 disabled:opacity-30 disabled:hover:border-slate-800 text-slate-300"
                        >
                          Prev
                        </button>
                        <button
                          disabled={currentPage === totalPages}
                          onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                          className="px-2 py-1 border border-slate-800 rounded bg-slate-900/50 hover:border-slate-600 disabled:opacity-30 disabled:hover:border-slate-800 text-slate-300"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {/* Global Command Center Settings Modal */}
      <SettingsModal
        isOpen={isSoundSettingsOpen}
        onClose={() => setIsSoundSettingsOpen(false)}
        alert={null}
        onSave={() => {}}
        onDelete={() => {}}
      />
    </div>
  );
}
