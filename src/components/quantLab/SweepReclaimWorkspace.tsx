"use client";

import React, { useState, useMemo } from "react";
import {
  Sliders,
  Calendar,
  Layers,
  Repeat,
  Sparkles,
  Download,
  Search,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  ChevronRight,
  Shield,
  Zap,
  TrendingUp,
  Activity,
  Award,
  X,
  RefreshCw,
  Play,
  Info
} from "lucide-react";
import {
  SweepReclaimSetup,
  SweepReclaimTelemetrySummary,
  SweepReclaimScanConfig
} from "@/lib/quantEngine/SweepReclaimEngine";
import { StoredSrScan } from "@/app/quant-lab/page";

interface SweepReclaimWorkspaceProps {
  scansList: StoredSrScan[];
  selectedScan: StoredSrScan | null;
  onSelectScan: (scan: StoredSrScan) => void;
  isScanning: boolean;
  statusMsg: string;
  progress: {
    phase: string;
    message: string;
    candlesFetched?: number;
    detectedCount?: number;
  } | null;
  onRunScan: (config: SweepReclaimScanConfig & { scan_name: string; start_date: string; end_date: string }) => void;
  onExportJson: () => void;
  onExportCsv: () => void;
}

export default function SweepReclaimWorkspace({
  selectedScan,
  isScanning,
  statusMsg,
  progress,
  onRunScan,
  onExportJson,
  onExportCsv,
}: SweepReclaimWorkspaceProps) {
  // Scan Configuration Form State
  const [scanName, setScanName] = useState("Deep Sweep & Reclaim Scan");
  const [symbol, setSymbol] = useState("ETHUSDC");
  const [timeframe, setTimeframe] = useState<"5m" | "15m" | "1h" | "4h">("15m");
  const [startDate, setStartDate] = useState("2026-03-01");
  const [endDate, setEndDate] = useState("2026-06-01");

  const [lookbackMajor, setLookbackMajor] = useState(15);
  const [lookbackInternal, setLookbackInternal] = useState(5);
  const [maxBarsAnchorToSweep, setMaxBarsAnchorToSweep] = useState(30);
  const [maxBarsSweepToReclaim, setMaxBarsSweepToReclaim] = useState(12);
  const [maxBarsToRetest, setMaxBarsToRetest] = useState(24);

  const [tp1Multiple, setTp1Multiple] = useState(1.2);
  const [tp2Multiple, setTp2Multiple] = useState(2.5);
  const [tp1Ratio, setTp1Ratio] = useState(0.50);
  const [tp2Ratio, setTp2Ratio] = useState(0.50);
  const [enableTrailingBe, setEnableTrailingBe] = useState(true);
  const [minSweepDepthAtr, setMinSweepDepthAtr] = useState(0.10);
  const [slBufferAtr, setSlBufferAtr] = useState(0.15);
  const [requireDisplacement, setRequireDisplacement] = useState(false);

  // Table Filter States
  const [filterDirection, setFilterDirection] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterOutcome, setFilterOutcome] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Inspector Modal State
  const [inspectedSetup, setInspectedSetup] = useState<SweepReclaimSetup | null>(null);

  // Quick Preset Handlers for Date Range
  const setQuickDateRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setEndDate(end.toISOString().slice(0, 10));
    setStartDate(start.toISOString().slice(0, 10));
  };

  const handleStartScan = () => {
    onRunScan({
      scan_name: scanName,
      symbol,
      timeframe,
      start_date: startDate,
      end_date: endDate,
      lookbackMajor,
      lookbackInternal,
      maxBarsAnchorToSweep,
      maxBarsSweepToReclaim,
      maxBarsToRetest,
      tp1Multiple,
      tp2Multiple,
      tp1Ratio,
      tp2Ratio,
      enableTrailingBe,
      minSweepDepthAtrMultiplier: minSweepDepthAtr,
      slBufferAtrMultiplier: slBufferAtr,
      requireDisplacementReclaim: requireDisplacement,
    });
  };

  // Filtered Setups
  const filteredSetups = useMemo(() => {
    if (!selectedScan || !selectedScan.setups) return [];
    let list = selectedScan.setups;

    if (filterDirection !== "ALL") {
      list = list.filter((s) => s.type === filterDirection);
    }
    if (filterStatus !== "ALL") {
      list = list.filter((s) => s.status === filterStatus);
    }
    if (filterOutcome !== "ALL") {
      list = list.filter((s) => s.simulated_outcome === filterOutcome);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          s.type.toLowerCase().includes(q) ||
          s.anchor_level.toString().includes(q) ||
          (s.sweep_price && s.sweep_price.toString().includes(q))
      );
    }

    return list;
  }, [selectedScan, filterDirection, filterStatus, filterOutcome, searchQuery]);

  const paginatedSetups = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredSetups.slice(start, start + itemsPerPage);
  }, [filteredSetups, currentPage]);

  const totalPages = Math.ceil(filteredSetups.length / itemsPerPage);
  const telemetry = selectedScan?.telemetry_summary;

  return (
    <>
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 1. CONFIGURATION CONTROLS PANEL                                     */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <section className="border border-slate-800/50 bg-slate-900/30 backdrop-blur-sm rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800/50 pb-4 mb-5 gap-3">
          <h2 className="text-xs uppercase tracking-widest text-slate-300 font-mono font-bold flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <span>Sweep & Reclaim Scanner Configuration</span>
          </h2>

          {/* Quick Lookback Preset Buttons */}
          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            <span className="text-slate-500 text-[9px] uppercase mr-1">Lookback:</span>
            <button
              onClick={() => setQuickDateRange(30)}
              className="px-2 py-1 rounded bg-slate-800/60 hover:bg-slate-700 text-slate-300 transition"
            >
              30D
            </button>
            <button
              onClick={() => setQuickDateRange(60)}
              className="px-2 py-1 rounded bg-slate-800/60 hover:bg-slate-700 text-slate-300 transition"
            >
              60D
            </button>
            <button
              onClick={() => setQuickDateRange(90)}
              className="px-2 py-1 rounded bg-slate-800/60 hover:bg-slate-700 text-slate-300 transition"
            >
              90D
            </button>
            <button
              onClick={() => setQuickDateRange(180)}
              className="px-2 py-1 rounded bg-slate-800/60 hover:bg-slate-700 text-slate-300 transition"
            >
              180D
            </button>
            <button
              onClick={() => setQuickDateRange(365)}
              className="px-2 py-1 rounded bg-slate-800/60 hover:bg-slate-700 text-slate-300 transition"
            >
              1Y
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          {/* Scan Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] uppercase font-mono font-semibold text-slate-500">
              Scan Name
            </label>
            <input
              type="text"
              disabled={isScanning}
              value={scanName}
              onChange={(e) => setScanName(e.target.value)}
              className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-white"
            />
          </div>

          {/* Symbol & Timeframe */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] uppercase font-mono font-semibold text-slate-500">
              Asset & Timeframe
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                disabled={isScanning}
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="text-xs font-mono px-2.5 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-white"
              >
                <option value="ETHUSDC">ETHUSDC</option>
                <option value="BTCUSDC">BTCUSDC</option>
                <option value="SOLUSDC">SOLUSDC</option>
              </select>

              <select
                disabled={isScanning}
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as any)}
                className="text-xs font-mono px-2.5 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-cyan-400 font-bold"
              >
                <option value="5m">5m TF</option>
                <option value="15m">15m TF</option>
                <option value="1h">1h TF</option>
                <option value="4h">4h TF</option>
              </select>
            </div>
          </div>

          {/* Start Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>Start Date</span>
            </label>
            <input
              type="date"
              disabled={isScanning}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-white"
            />
          </div>

          {/* End Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>End Date</span>
            </label>
            <input
              type="date"
              disabled={isScanning}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-white"
            />
          </div>
        </div>

        {/* Advanced Quantitative Parameters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-slate-800/40 pt-4 mb-4">
          {/* Max Bars Anchor to Sweep */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
              <span>Anchor to Sweep Window</span>
              <span className="text-slate-400">{maxBarsAnchorToSweep} bars</span>
            </label>
            <input
              type="range"
              min={10}
              max={60}
              step={5}
              disabled={isScanning}
              value={maxBarsAnchorToSweep}
              onChange={(e) => setMaxBarsAnchorToSweep(Number(e.target.value))}
              className="accent-cyan-500 cursor-pointer"
            />
          </div>

          {/* Max Bars Sweep to Reclaim */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
              <span>Sweep to Reclaim Limit</span>
              <span className="text-cyan-400 font-bold">{maxBarsSweepToReclaim} bars</span>
            </label>
            <input
              type="range"
              min={3}
              max={30}
              step={1}
              disabled={isScanning}
              value={maxBarsSweepToReclaim}
              onChange={(e) => setMaxBarsSweepToReclaim(Number(e.target.value))}
              className="accent-cyan-500 cursor-pointer"
            />
          </div>

          {/* Max Bars to Retest */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
              <span>Reclaim to Retest Expiry</span>
              <span className="text-slate-400">{maxBarsToRetest} bars</span>
            </label>
            <input
              type="range"
              min={5}
              max={50}
              step={1}
              disabled={isScanning}
              value={maxBarsToRetest}
              onChange={(e) => setMaxBarsToRetest(Number(e.target.value))}
              className="accent-cyan-500 cursor-pointer"
            />
          </div>

          {/* TP Multiples */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] uppercase font-mono font-semibold text-slate-500">
              Dynamic TP Multiples (TP1 / TP2)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                disabled={isScanning}
                value={tp1Multiple}
                onChange={(e) => setTp1Multiple(Number(e.target.value))}
                className="text-xs font-mono px-2 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-200"
              >
                <option value={1.0}>TP1: 1.0R</option>
                <option value={1.2}>TP1: 1.2R</option>
                <option value={1.5}>TP1: 1.5R</option>
              </select>

              <select
                disabled={isScanning}
                value={tp2Multiple}
                onChange={(e) => setTp2Multiple(Number(e.target.value))}
                className="text-xs font-mono px-2 py-1.5 bg-slate-950 border border-slate-800 rounded text-cyan-400 font-bold"
              >
                <option value={2.0}>TP2: 2.0R</option>
                <option value={2.5}>TP2: 2.5R</option>
                <option value={3.0}>TP2: 3.0R</option>
                <option value={4.0}>TP2: 4.0R</option>
              </select>
            </div>
          </div>
        </div>

        {/* Execution Gating Options */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800/40 pt-4">
          <div className="flex flex-wrap items-center gap-4 font-mono text-[10px]">
            <label className="flex items-center gap-2 cursor-pointer text-slate-400 hover:text-white">
              <input
                type="checkbox"
                disabled={isScanning}
                checked={enableTrailingBe}
                onChange={(e) => setEnableTrailingBe(e.target.checked)}
                className="rounded bg-slate-950 border-slate-800 text-cyan-500 focus:ring-0"
              />
              <span>Move SL to Breakeven @ TP1</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-slate-400 hover:text-white">
              <input
                type="checkbox"
                disabled={isScanning}
                checked={requireDisplacement}
                onChange={(e) => setRequireDisplacement(e.target.checked)}
                className="rounded bg-slate-950 border-slate-800 text-cyan-500 focus:ring-0"
              />
              <span>Require Volume Displacement on Reclaim</span>
            </label>
          </div>

          {/* Execute Scan Button */}
          <button
            onClick={handleStartScan}
            disabled={isScanning}
            className={`px-6 py-2.5 rounded font-mono font-bold text-xs uppercase tracking-wider flex items-center gap-2 transition cursor-pointer ${
              isScanning
                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                : "bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20"
            }`}
          >
            {isScanning ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Scanning Historical Feeds...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Run Historical S&R Scan</span>
              </>
            )}
          </button>
        </div>

        {/* Live SSE Ingestion & Analysis Progress HUD */}
        {isScanning && (
          <div className="mt-4 border border-cyan-500/30 bg-cyan-950/20 rounded-lg p-4 font-mono text-xs text-cyan-300">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                <span className="font-bold uppercase tracking-wider">{progress?.phase || "RUNNING SCAN"}</span>
              </div>
              <span className="text-[10px] text-cyan-400/80">
                {progress?.candlesFetched ? `${progress.candlesFetched} candles ingested` : statusMsg}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">{progress?.message || statusMsg}</p>
          </div>
        )}
      </section>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 2. QUANTITATIVE TELEMETRY HUD                                       */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {telemetry && (
        <section className="border border-slate-800/50 bg-slate-900/30 backdrop-blur-sm rounded-lg p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800/50 pb-3 mb-4 gap-2">
            <h3 className="text-xs uppercase tracking-widest text-slate-300 font-mono font-bold flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span>4-Phase Quantitative Telemetry & Expectancy</span>
            </h3>
            <span className="text-[10px] font-mono text-slate-400">
              Symbol: <strong className="text-white">{selectedScan.symbol}</strong> | Timeframe: <strong className="text-cyan-400">{selectedScan.timeframe}</strong>
            </span>
          </div>

          {/* Metric Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4 font-mono">
            {/* Anchors & Funnel */}
            <div className="border border-slate-800/80 bg-slate-950/60 rounded p-3 text-center">
              <span className="text-[9px] uppercase text-slate-500 block">Total Anchors</span>
              <span className="text-lg font-black text-white">{telemetry.total_anchors_detected}</span>
              <span className="text-[8px] text-cyan-400 block mt-0.5">{telemetry.total_sweeps_detected} Sweeps ({telemetry.sweep_rate_pct}%)</span>
            </div>

            {/* Reclaim Rate */}
            <div className="border border-slate-800/80 bg-slate-950/60 rounded p-3 text-center">
              <span className="text-[9px] uppercase text-slate-500 block">Reclaim Rate %</span>
              <span className="text-lg font-black text-cyan-400">{telemetry.reclaim_rate_pct}%</span>
              <span className="text-[8px] text-slate-400 block mt-0.5">{telemetry.total_reclaims_confirmed} Confirmed Reclaims</span>
            </div>

            {/* Retest Win Rate */}
            <div className="border border-slate-800/80 bg-slate-950/60 rounded p-3 text-center">
              <span className="text-[9px] uppercase text-slate-500 block">Retest Win Rate %</span>
              <span className={`text-lg font-black ${telemetry.retest_win_rate_pct >= 50 ? "text-emerald-400" : "text-rose-400"}`}>
                {telemetry.retest_win_rate_pct}%
              </span>
              <span className="text-[8px] text-slate-400 block mt-0.5">
                {telemetry.total_winning_trades}W / {telemetry.total_losing_trades}L ({telemetry.total_retests_executed} Retests)
              </span>
            </div>

            {/* Average Realized R:R */}
            <div className="border border-slate-800/80 bg-slate-950/60 rounded p-3 text-center">
              <span className="text-[9px] uppercase text-slate-500 block">Avg Realized R:R</span>
              <span className={`text-lg font-black ${telemetry.avg_realized_rr > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {telemetry.avg_realized_rr > 0 ? "+" : ""}{telemetry.avg_realized_rr}R
              </span>
              <span className="text-[8px] text-slate-400 block mt-0.5">Profit Factor: {telemetry.profit_factor}</span>
            </div>

            {/* Expected Value E[R] */}
            <div className="border border-slate-800/80 bg-slate-950/60 rounded p-3 text-center">
              <span className="text-[9px] uppercase text-slate-500 block">Expectancy E[R]</span>
              <span className={`text-lg font-black ${telemetry.expected_value_r > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {telemetry.expected_value_r > 0 ? "+" : ""}{telemetry.expected_value_r}R
              </span>
              <span className="text-[8px] text-cyan-400 block mt-0.5">TP1: {telemetry.stage_1_tp1_fill_rate_pct}% | TP2: {telemetry.stage_2_tp2_fill_rate_pct}%</span>
            </div>

            {/* Excursions MFE / MAE */}
            <div className="border border-slate-800/80 bg-slate-950/60 rounded p-3 text-center">
              <span className="text-[9px] uppercase text-slate-500 block">Avg MFE / MAE</span>
              <span className="text-lg font-black text-purple-400">{telemetry.avg_mfe_r}R</span>
              <span className="text-[8px] text-rose-400/90 block mt-0.5">MAE: {telemetry.avg_mae_r}R</span>
            </div>
          </div>

          {/* 4-Phase Conversion Funnel Bar */}
          <div className="border border-slate-800/60 bg-slate-950/40 rounded p-3.5 font-mono text-[10px]">
            <span className="text-slate-400 uppercase text-[9px] font-bold block mb-2">
              4-Phase Institutional Conversion Funnel
            </span>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-slate-900 border border-slate-800 p-2 rounded">
                <span className="text-slate-500 block text-[8px] uppercase">Phase 1: Anchors</span>
                <strong className="text-white text-xs">{telemetry.total_anchors_detected}</strong>
                <span className="text-[8px] text-slate-400 block">100% Origin</span>
              </div>
              <div className="bg-slate-900 border border-cyan-900/40 p-2 rounded">
                <span className="text-cyan-400 block text-[8px] uppercase">Phase 2: Sweeps</span>
                <strong className="text-cyan-300 text-xs">{telemetry.total_sweeps_detected}</strong>
                <span className="text-[8px] text-cyan-400/80 block">{telemetry.sweep_rate_pct}% Swept</span>
              </div>
              <div className="bg-slate-900 border border-emerald-900/40 p-2 rounded">
                <span className="text-emerald-400 block text-[8px] uppercase">Phase 3: Reclaims</span>
                <strong className="text-emerald-300 text-xs">{telemetry.total_reclaims_confirmed}</strong>
                <span className="text-[8px] text-emerald-400/80 block">{telemetry.reclaim_rate_pct}% Reclaimed</span>
              </div>
              <div className="bg-slate-900 border border-purple-900/40 p-2 rounded">
                <span className="text-purple-400 block text-[8px] uppercase">Phase 4: Retests</span>
                <strong className="text-purple-300 text-xs">{telemetry.total_retests_executed}</strong>
                <span className="text-[8px] text-purple-400/80 block">{telemetry.retest_rate_pct}% Retested</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 3. SETUP LEDGER & FILTERABLE TABLE                                  */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {selectedScan && selectedScan.setups && (
        <section className="border border-slate-800/50 bg-slate-900/30 backdrop-blur-sm rounded-lg p-5">
          {/* Header & Filter Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-slate-800/50 pb-4 mb-4 gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs uppercase tracking-widest text-slate-300 font-mono font-bold flex items-center gap-2">
                <Repeat className="w-4 h-4 text-cyan-400" />
                <span>Detected Setups Ledger</span>
              </h3>
              <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-cyan-950/40 text-cyan-400 border border-cyan-500/30">
                {filteredSetups.length} / {selectedScan.setups.length} SETUPS
              </span>
            </div>

            {/* Actions: Export JSON / CSV */}
            <div className="flex items-center gap-2 font-mono text-[10px]">
              <button
                onClick={onExportJson}
                className="px-3 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-cyan-400" />
                <span>Export JSON</span>
              </button>

              <button
                onClick={onExportCsv}
                className="px-3 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4 font-mono text-[10px]">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Search by ID, price, level..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-200 placeholder:text-slate-600 outline-none focus:border-cyan-500/50"
              />
            </div>

            {/* Direction Filter */}
            <select
              value={filterDirection}
              onChange={(e) => {
                setFilterDirection(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 outline-none"
            >
              <option value="ALL">Direction: All</option>
              <option value="BULLISH">🟢 Bullish (SSL Sweeps)</option>
              <option value="BEARISH">🔴 Bearish (BSL Sweeps)</option>
            </select>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 outline-none"
            >
              <option value="ALL">Status: All</option>
              <option value="RETESTED">✓ Retested & Executed</option>
              <option value="RECLAIMED_NO_RETEST">Reclaimed (No Retest)</option>
              <option value="SWEPT_NO_RECLAIM">Swept (No Reclaim)</option>
              <option value="INVALIDATED_AT_RETEST">Invalidated at Retest</option>
            </select>

            {/* Outcome Filter */}
            <select
              value={filterOutcome}
              onChange={(e) => {
                setFilterOutcome(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-300 outline-none"
            >
              <option value="ALL">Outcome: All</option>
              <option value="FULL_TP2_WIN">🏆 Full TP2 Win</option>
              <option value="TP1_BE_WIN">🛡️ TP1 Breakeven Win</option>
              <option value="STOPPED_OUT">❌ Stopped Out</option>
              <option value="PENDING">⏳ Pending Execution</option>
              <option value="NO_RETEST">⚪ No Retest</option>
            </select>
          </div>

          {/* Table */}
          {filteredSetups.length === 0 ? (
            <div className="py-12 border border-dashed border-slate-800 rounded text-center text-slate-500 font-mono text-xs">
              No Sweep & Reclaim setups match the selected filter criteria.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-800/80 rounded-lg">
              <table className="w-full text-left font-mono text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/80 text-[9px] uppercase tracking-wider text-slate-400">
                    <th className="py-2.5 px-3">Setup ID & Type</th>
                    <th className="py-2.5 px-3">Anchor Shelf</th>
                    <th className="py-2.5 px-3">Sweep Extreme</th>
                    <th className="py-2.5 px-3">Reclaim Close</th>
                    <th className="py-2.5 px-3">Retest Entry</th>
                    <th className="py-2.5 px-3">SL / TP Targets</th>
                    <th className="py-2.5 px-3 text-center">Outcome</th>
                    <th className="py-2.5 px-3 text-right">Realized R:R</th>
                    <th className="py-2.5 px-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {paginatedSetups.map((setup, idx) => {
                    const isBull = setup.type === "BULLISH";
                    const isWin = setup.simulated_outcome === "FULL_TP2_WIN" || setup.simulated_outcome === "TP1_BE_WIN";

                    return (
                      <tr
                        key={setup.id ? `${setup.id}_${idx}` : `sr_setup_${idx}`}
                        className="hover:bg-slate-900/60 transition group cursor-pointer"
                        onClick={() => setInspectedSetup(setup)}
                      >
                        {/* Type & ID */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`p-1 rounded text-[9px] font-bold ${
                                isBull
                                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                  : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                              }`}
                            >
                              {isBull ? "🟢 BULL SSL" : "🔴 BEAR BSL"}
                            </span>
                            <span className="text-[10px] text-slate-300 font-bold group-hover:text-cyan-400 transition">
                              {setup.anchor_swing_grade}
                            </span>
                          </div>
                          <span className="text-[8px] text-slate-500 block mt-0.5">
                            {new Date(setup.anchor_time).toISOString().slice(5, 16).replace("T", " ")}
                          </span>
                        </td>

                        {/* Anchor Shelf */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="font-bold text-white">${setup.anchor_level.toFixed(2)}</span>
                          <span className="text-[8px] text-slate-500 block">
                            {setup.anchor_color_validated ? "✓ Color Locked" : "Unvalidated"}
                          </span>
                        </td>

                        {/* Sweep Extreme */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {setup.sweep_price ? (
                            <>
                              <span className={`font-bold ${isBull ? "text-rose-400" : "text-emerald-400"}`}>
                                ${setup.sweep_price.toFixed(2)}
                              </span>
                              <span className="text-[8px] text-slate-500 block">
                                -{setup.sweep_depth?.toFixed(2)} USD ({setup.sweep_depth_pct?.toFixed(2)}%)
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>

                        {/* Reclaim Close */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {setup.reclaim_close_price ? (
                            <>
                              <span className="font-bold text-cyan-400">
                                ${setup.reclaim_close_price.toFixed(2)}
                              </span>
                              <span className="text-[8px] text-slate-500 block">
                                Vol: {setup.reclaim_volume_expansion ? `${setup.reclaim_volume_expansion.toFixed(1)}x` : "1.0x"}
                                {setup.reclaim_fvg_created ? " • FVG" : ""}
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-600">Pending</span>
                          )}
                        </td>

                        {/* Retest Entry */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {setup.is_retested ? (
                            <>
                              <span className="font-bold text-slate-200">
                                ${setup.entry_price.toFixed(2)}
                              </span>
                              <span className="text-[8px] text-emerald-400 block">
                                {setup.body_defense_passed ? "✓ Body Defended" : "⚠️ Violated"}
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-600">{setup.is_reclaimed ? "Awaiting Retest" : "—"}</span>
                          )}
                        </td>

                        {/* SL / TP */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex flex-col text-[10px]">
                            <span className="text-rose-400">SL: ${setup.stop_loss.toFixed(2)}</span>
                            <span className="text-emerald-400">TP2: ${setup.tp2_target.toFixed(2)}</span>
                          </div>
                        </td>

                        {/* Outcome */}
                        <td className="py-2.5 px-3 whitespace-nowrap text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                              setup.simulated_outcome === "FULL_TP2_WIN"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : setup.simulated_outcome === "TP1_BE_WIN"
                                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                                : setup.simulated_outcome === "STOPPED_OUT"
                                ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                : setup.simulated_outcome === "PENDING"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {setup.simulated_outcome}
                          </span>
                        </td>

                        {/* Realized RR */}
                        <td className="py-2.5 px-3 whitespace-nowrap text-right font-bold">
                          <span className={setup.realized_rr > 0 ? "text-emerald-400" : setup.realized_rr < 0 ? "text-rose-400" : "text-slate-400"}>
                            {setup.realized_rr > 0 ? "+" : ""}{setup.realized_rr.toFixed(2)}R
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-2.5 px-3 whitespace-nowrap text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspectedSetup(setup);
                            }}
                            className="p-1 rounded hover:bg-cyan-950/40 text-slate-400 hover:text-cyan-400 transition"
                            title="Inspect Setup Details"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-800/40 pt-3 mt-3 font-mono text-[10px]">
              <span className="text-slate-500">
                Page {currentPage} of {totalPages} ({filteredSetups.length} total)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-300 transition"
                >
                  Prev
                </button>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-300 transition"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 4. SETUP INSPECTOR MODAL / DRAWER                                   */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {inspectedSetup && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setInspectedSetup(null)}
        >
          <div
            className="border border-slate-800 bg-slate-950 rounded-xl max-w-2xl w-full p-6 text-slate-100 shadow-2xl overflow-y-auto max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4 mb-5">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                      inspectedSetup.type === "BULLISH"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                    }`}
                  >
                    {inspectedSetup.type === "BULLISH" ? "🟢 BULLISH SSL REVERSAL" : "🔴 BEARISH BSL REVERSAL"}
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    Grade: <strong className="text-white">{inspectedSetup.anchor_swing_grade}</strong>
                  </span>
                </div>
                <h3 className="text-sm font-mono font-bold text-white mt-1">
                  Setup ID: {inspectedSetup.id}
                </h3>
              </div>

              <button
                onClick={() => setInspectedSetup(null)}
                className="text-slate-500 hover:text-white p-1 rounded hover:bg-slate-900 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 4-Phase Timeline Chronology */}
            <div className="border border-slate-800/80 bg-slate-900/30 rounded-lg p-4 mb-4 font-mono text-xs">
              <h4 className="text-[10px] uppercase font-bold text-cyan-400 mb-3 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>4-Phase Execution Timeline Chronology</span>
              </h4>

              <div className="flex flex-col gap-3">
                {/* Phase 1 */}
                <div className="flex items-start gap-3 border-l-2 border-slate-700 pl-3">
                  <div>
                    <span className="text-[9px] uppercase text-slate-500 block">Phase 1: Anchor Origin Shelf</span>
                    <strong className="text-white">${inspectedSetup.anchor_level.toFixed(2)}</strong>
                    <span className="text-[10px] text-slate-400 block">
                      Time: {new Date(inspectedSetup.anchor_time).toUTCString()} ({inspectedSetup.anchor_swing_type})
                    </span>
                  </div>
                </div>

                {/* Phase 2 */}
                <div className="flex items-start gap-3 border-l-2 border-rose-500/60 pl-3">
                  <div>
                    <span className="text-[9px] uppercase text-rose-400 block">Phase 2: Liquidity Sweep (Purge)</span>
                    <strong className="text-rose-300">
                      ${inspectedSetup.sweep_price ? inspectedSetup.sweep_price.toFixed(2) : "N/A"}
                    </strong>
                    <span className="text-[10px] text-slate-400 block">
                      Sweep Depth: {inspectedSetup.sweep_depth?.toFixed(2)} USD ({inspectedSetup.sweep_depth_pct?.toFixed(2)}%) • Bars from Anchor: {inspectedSetup.bars_anchor_to_sweep}
                    </span>
                  </div>
                </div>

                {/* Phase 3 */}
                <div className="flex items-start gap-3 border-l-2 border-cyan-500/60 pl-3">
                  <div>
                    <span className="text-[9px] uppercase text-cyan-400 block">Phase 3: Displacement Reclaim (MSS)</span>
                    <strong className="text-cyan-300">
                      ${inspectedSetup.reclaim_close_price ? inspectedSetup.reclaim_close_price.toFixed(2) : "N/A"}
                    </strong>
                    <span className="text-[10px] text-slate-400 block">
                      Vol Expansion: {inspectedSetup.reclaim_volume_expansion ? `${inspectedSetup.reclaim_volume_expansion.toFixed(2)}x` : "1.0x"} • FVG Created: {inspectedSetup.reclaim_fvg_created ? "Yes" : "No"} • Bars from Sweep: {inspectedSetup.bars_sweep_to_reclaim}
                    </span>
                  </div>
                </div>

                {/* Phase 4 */}
                <div className="flex items-start gap-3 border-l-2 border-emerald-500/60 pl-3">
                  <div>
                    <span className="text-[9px] uppercase text-emerald-400 block">Phase 4: Retest & Execution</span>
                    <strong className="text-emerald-300">
                      ${inspectedSetup.entry_price.toFixed(2)} (Entry @ Shelf)
                    </strong>
                    <span className="text-[10px] text-slate-400 block">
                      ICT Body Defense: {inspectedSetup.body_defense_passed ? "✓ Validated" : "⚠️ Body Closed Against Shelf"} • Bars from Reclaim: {inspectedSetup.bars_reclaim_to_retest ?? "No Retest"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Risk / Reward & Execution Geometry */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border border-slate-800/80 bg-slate-900/40 rounded-lg p-4 mb-4 font-mono text-xs">
              <div>
                <span className="text-slate-500 text-[8px] uppercase block">Entry Price</span>
                <span className="font-bold text-white">${inspectedSetup.entry_price.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-slate-500 text-[8px] uppercase block">Stop Loss (SL)</span>
                <span className="font-bold text-rose-400">${inspectedSetup.stop_loss.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-slate-500 text-[8px] uppercase block">TP1 Target (1.2R)</span>
                <span className="font-bold text-slate-200">${inspectedSetup.tp1_target.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-slate-500 text-[8px] uppercase block">TP2 Target (2.5R)</span>
                <span className="font-bold text-emerald-400">${inspectedSetup.tp2_target.toFixed(2)}</span>
              </div>
            </div>

            {/* Outcome Telemetry */}
            <div className="border border-slate-800/80 bg-slate-900/40 rounded-lg p-4 mb-5 font-mono text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <span className="text-slate-500 text-[8px] uppercase block">Outcome Status</span>
                  <span className="font-bold text-cyan-300">{inspectedSetup.simulated_outcome}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[8px] uppercase block">Realized R:R</span>
                  <span className={`font-bold ${inspectedSetup.realized_rr > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {inspectedSetup.realized_rr > 0 ? "+" : ""}{inspectedSetup.realized_rr.toFixed(2)}R
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 text-[8px] uppercase block">Max MFE</span>
                  <span className="font-bold text-purple-400">+{inspectedSetup.mfe_r}R (${inspectedSetup.mfe_usd})</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[8px] uppercase block">Max MAE</span>
                  <span className="font-bold text-rose-400">-{inspectedSetup.mae_r}R (${inspectedSetup.mae_usd})</span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end">
              <button
                onClick={() => setInspectedSetup(null)}
                className="px-5 py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
