"use client";

import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  TrendingUp,
  DollarSign,
  Percent,
  Activity,
  Shield,
  Award,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Sliders,
  Sparkles,
  Layers,
  HelpCircle,
  RefreshCw,
  Zap,
  Crosshair,
  BarChart2
} from "lucide-react";
import {
  StandardizedExecutedTrade,
  calculateCompoundingMetrics,
  generateSvgEquityPaths,
  SequentialEquityPoint,
  CompoundingMetricsSummary
} from "@/lib/quantEngine/equityCalculator";

interface CapitalGrowthLedgerProps {
  trades: StandardizedExecutedTrade[];
  totalMonitoredCount?: number; // e.g. total anchors detected or total OBs detected
  monitoredLabel?: string;      // e.g. "Anchors" or "Order Blocks"
  defaultCapital?: number;
  defaultRiskPct?: number;
  title?: string;
  subtitle?: string;
}

export default function CapitalGrowthLedger({
  trades,
  totalMonitoredCount,
  monitoredLabel = "Scanned Setups",
  defaultCapital = 10000,
  defaultRiskPct = 1.5,
  title = "CAPITAL GROWTH & CHRONOLOGICAL EQUITY LEDGER",
  subtitle = "Dynamic path-dependent compounding, drawdown telemetry, and theoretical closed-expectancy modeling."
}: CapitalGrowthLedgerProps) {
  // ── 1. Configuration State ──────────────────────────────────────────────────
  const [initialCapital, setInitialCapital] = useState<number>(defaultCapital);
  const [riskPerTradePct, setRiskPerTradePct] = useState<number>(defaultRiskPct);
  const [compoundingMode, setCompoundingMode] = useState<"DYNAMIC_COMPOUNDING" | "FIXED_FRACTIONAL">("DYNAMIC_COMPOUNDING");
  const [isLedgerExpanded, setIsLedgerExpanded] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 12;

  // Fetch global account capital fallback on mount if user hasn't modified local capital
  useEffect(() => {
    let isMounted = true;
    async function fetchAccountSetting() {
      try {
        const res = await fetch("/api/account", { credentials: "same-origin" });
        if (res.ok) {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const data = await res.json();
            if (isMounted && data.account?.initial_capital) {
              const parsed = parseFloat(data.account.initial_capital);
              if (!isNaN(parsed) && parsed > 0 && initialCapital === 10000) {
                setInitialCapital(parsed);
              }
            }
          }
        }
      } catch {
        // Fall back gracefully to default
      }
    }
    fetchAccountSetting();
    return () => {
      isMounted = false;
    };
  }, []);

  // ── 2. Memoized Compounding Calculation (60 FPS zero-lag) ───────────────────
  const metrics: CompoundingMetricsSummary = useMemo(() => {
    return calculateCompoundingMetrics(trades, {
      initialCapital,
      riskPerTradePct,
      compoundingMode,
    });
  }, [trades, initialCapital, riskPerTradePct, compoundingMode]);

  // ── 3. SVG Path Derivation for Responsive Vector Chart ───────────────────────
  const chartWidth = 900;
  const chartHeight = 260;
  const chartPadding = { top: 25, right: 30, bottom: 35, left: 65 };

  const svgData = useMemo(() => {
    return generateSvgEquityPaths(
      metrics.equityCurvePoints,
      chartWidth,
      chartHeight,
      chartPadding
    );
  }, [metrics.equityCurvePoints]);

  // ── 4. Interactive Crosshair & Hover Tooltip State ──────────────────────────
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || svgData.points.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const scaleX = chartWidth / rect.width;
      const virtualX = mouseX * scaleX;

      // Find closest point by X coordinate
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < svgData.points.length; i++) {
        const diff = Math.abs(svgData.points[i].x - virtualX);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }

      setHoverIndex(closestIdx);
      setHoverPos({
        x: (svgData.points[closestIdx].x / chartWidth) * rect.width,
        y: (svgData.points[closestIdx].y / chartHeight) * rect.height,
      });
    },
    [svgData.points]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverIndex(null);
    setHoverPos(null);
  }, []);

  const activeHoverPoint: SequentialEquityPoint | null =
    hoverIndex !== null && metrics.equityCurvePoints[hoverIndex]
      ? metrics.equityCurvePoints[hoverIndex]
      : null;

  // ── 5. Paginated Trade Ledger ───────────────────────────────────────────────
  const paginatedTrades = useMemo(() => {
    // Exclude the index 0 START point for the trade ledger table
    const tradeOnlyPoints = metrics.equityCurvePoints.filter((p) => p.tradeIndex > 0);
    const start = (currentPage - 1) * itemsPerPage;
    return tradeOnlyPoints.slice(start, start + itemsPerPage);
  }, [metrics.equityCurvePoints, currentPage]);

  const totalTradePages = Math.ceil(
    Math.max(1, metrics.equityCurvePoints.length - 1) / itemsPerPage
  );

  // Formatting helpers
  const fmtUsd = (n: number) =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtR = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}R`;

  const isNetPositive = metrics.realizedNetPnlUsd >= 0;

  return (
    <div className="border border-slate-800/80 bg-slate-950/70 backdrop-blur-md rounded-xl p-5 md:p-6 shadow-2xl flex flex-col gap-6 text-slate-100 font-mono transition-all">
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 1. HEADER & DYNAMIC CONFIGURATION CONTROLS                          */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-slate-800/60 pb-5 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <TrendingUp className="w-4 h-4" />
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-400 font-bold">
              QUANT EQUITY LEDGER ENGINE
            </span>
          </div>
          <h3 className="text-base font-bold text-white uppercase tracking-tight flex items-center gap-2">
            <span>{title}</span>
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5 max-w-2xl font-sans">
            {subtitle}
          </p>
        </div>

        {/* Dynamic Risk & Capital Controls */}
        <div className="flex flex-wrap items-center gap-3 bg-slate-900/80 border border-slate-800/90 rounded-lg p-2.5">
          {/* Initial Capital Input */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] uppercase font-bold text-slate-400 flex items-center justify-between">
              <span>Initial Capital</span>
              <span className="text-emerald-400">${initialCapital.toLocaleString()}</span>
            </label>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <span className="absolute left-2 top-1.5 text-slate-500 text-xs">$</span>
                <input
                  type="number"
                  min="100"
                  step="500"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(Math.max(100, parseFloat(e.target.value) || 0))}
                  className="w-24 pl-5 pr-2 py-1 bg-slate-950 border border-slate-800 rounded text-xs text-white font-bold outline-none focus:border-emerald-500/50"
                />
              </div>

              {/* Capital Preset Pills */}
              <div className="hidden sm:flex items-center gap-1 text-[9px]">
                {[5000, 10000, 25000, 50000].map((cap) => (
                  <button
                    key={cap}
                    type="button"
                    onClick={() => setInitialCapital(cap)}
                    className={`px-1.5 py-1 rounded border transition ${
                      initialCapital === cap
                        ? "bg-emerald-950/60 border-emerald-500/50 text-emerald-300 font-bold"
                        : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    ${cap >= 1000 ? `${cap / 1000}k` : cap}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Vertical Divider */}
          <div className="h-9 w-[1px] bg-slate-800 hidden sm:block" />

          {/* Risk Per Trade Slider & Number */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] uppercase font-bold text-slate-400 flex items-center justify-between">
              <span>Risk Per Trade</span>
              <span className="text-cyan-400 font-bold">{riskPerTradePct.toFixed(1)}%</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.1"
                max="5.0"
                step="0.1"
                value={riskPerTradePct}
                onChange={(e) => setRiskPerTradePct(parseFloat(e.target.value))}
                className="w-20 sm:w-24 accent-cyan-400 cursor-pointer"
              />

              {/* Risk Preset Pills */}
              <div className="flex items-center gap-1 text-[9px]">
                {[0.5, 1.0, 1.5, 2.0].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRiskPerTradePct(r)}
                    className={`px-1.5 py-1 rounded border transition ${
                      riskPerTradePct === r
                        ? "bg-cyan-950/60 border-cyan-500/50 text-cyan-300 font-bold"
                        : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {r}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Vertical Divider */}
          <div className="h-9 w-[1px] bg-slate-800 hidden md:block" />

          {/* Compounding Mode Toggle */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] uppercase font-bold text-slate-400">
              Model Mode
            </label>
            <button
              type="button"
              onClick={() =>
                setCompoundingMode(
                  compoundingMode === "DYNAMIC_COMPOUNDING"
                    ? "FIXED_FRACTIONAL"
                    : "DYNAMIC_COMPOUNDING"
                )
              }
              className={`px-2.5 py-1 rounded border text-[9px] font-bold transition flex items-center gap-1.5 ${
                compoundingMode === "DYNAMIC_COMPOUNDING"
                  ? "bg-purple-950/60 border-purple-500/50 text-purple-300"
                  : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
              title="Dynamic Compounding recalculates risk size per trade based on running equity balance."
            >
              <Zap className="w-3 h-3 text-purple-400" />
              <span>{compoundingMode === "DYNAMIC_COMPOUNDING" ? "COMPOUNDING" : "FIXED INITIAL"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 2. DUAL EXPECTANCY COMPARISON BANNER (Theoretical vs Path-Dependent) */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Approach A: Theoretical Closed-Form Expectancy */}
        <div className="p-3.5 rounded-lg border border-slate-800/80 bg-slate-900/30 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Approach A: Theoretical Closed Expectancy</span>
            </span>
            <span className="text-[9px] font-bold text-cyan-400/90 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-500/20">
              E[R] = {metrics.expectedValueR > 0 ? "+" : ""}{metrics.expectedValueR}R / trade
            </span>
          </div>
          <p className="text-[10px] text-slate-400 mb-2 font-sans">
            Mathematical expectation across {metrics.totalExecutedTrades} trades assuming uniform win distribution.
          </p>
          <div className="flex items-center justify-between border-t border-slate-800/50 pt-2 text-xs">
            <span className="text-slate-400">Projected Compounded Capital:</span>
            <span className="font-bold text-cyan-300">
              {fmtUsd(metrics.theoreticalFinalEquity)}{" "}
              <span className="text-[10px] text-cyan-400/80">
                ({metrics.theoreticalNetRoiPct >= 0 ? "+" : ""}{metrics.theoreticalNetRoiPct}%)
              </span>
            </span>
          </div>
        </div>

        {/* Approach B: Path-Dependent Sequential Walk */}
        <div className="p-3.5 rounded-lg border border-slate-800/80 bg-slate-900/30 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Approach B: Realized Chronological Walk</span>
            </span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
              isNetPositive
                ? "bg-emerald-950/40 border-emerald-500/20 text-emerald-400"
                : "bg-rose-950/40 border-rose-500/20 text-rose-400"
            }`}>
              Max DD: -{metrics.maxDrawdownPct}%
            </span>
          </div>
          <p className="text-[10px] text-slate-400 mb-2 font-sans">
            Exact path-dependent equity progression accounting for real-world trade sequences and drawdown.
          </p>
          <div className="flex items-center justify-between border-t border-slate-800/50 pt-2 text-xs">
            <span className="text-slate-400">Actual Realized Balance:</span>
            <span className={`font-bold ${isNetPositive ? "text-emerald-400" : "text-rose-400"}`}>
              {fmtUsd(metrics.finalRealizedEquity)}{" "}
              <span className="text-[10px]">
                ({metrics.realizedNetRoiPct >= 0 ? "+" : ""}{metrics.realizedNetRoiPct}%)
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 3. SIX-CARD INSTITUTIONAL TELEMETRY METRICS GRID                     */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Metric 1: Final Compounded Equity */}
        <div className="border border-slate-800/80 bg-slate-900/40 rounded-lg p-3 flex flex-col justify-between">
          <span className="text-[8px] uppercase text-slate-500 font-bold block mb-1">
            Compounded Balance
          </span>
          <div>
            <span className={`text-base font-bold block ${isNetPositive ? "text-emerald-400" : "text-rose-400"}`}>
              {fmtUsd(metrics.finalRealizedEquity)}
            </span>
            <span className={`text-[9px] font-bold block mt-0.5 ${isNetPositive ? "text-emerald-500" : "text-rose-500"}`}>
              {metrics.realizedNetPnlUsd >= 0 ? "+" : ""}{fmtUsd(metrics.realizedNetPnlUsd)} ({metrics.realizedNetRoiPct >= 0 ? "+" : ""}{metrics.realizedNetRoiPct}%)
            </span>
          </div>
        </div>

        {/* Metric 2: Max Peak-to-Trough Drawdown */}
        <div className="border border-slate-800/80 bg-slate-900/40 rounded-lg p-3 flex flex-col justify-between">
          <span className="text-[8px] uppercase text-slate-500 font-bold block mb-1">
            Max Drawdown
          </span>
          <div>
            <span className="text-base font-bold text-rose-400 block">
              -{metrics.maxDrawdownPct}%
            </span>
            <span className="text-[9px] text-slate-400 block mt-0.5">
              -{fmtUsd(metrics.maxDrawdownUsd)} Peak-to-Trough
            </span>
          </div>
        </div>

        {/* Metric 3: Profit Factor & Average Realized R */}
        <div className="border border-slate-800/80 bg-slate-900/40 rounded-lg p-3 flex flex-col justify-between">
          <span className="text-[8px] uppercase text-slate-500 font-bold block mb-1">
            Profit Factor
          </span>
          <div>
            <span className="text-base font-bold text-purple-300 block">
              {metrics.profitFactor >= 99 ? "99.9+" : metrics.profitFactor.toFixed(2)}
            </span>
            <span className="text-[9px] text-slate-400 block mt-0.5">
              Avg R: {fmtR(metrics.avgRealizedR)}
            </span>
          </div>
        </div>

        {/* Metric 4: Realized Win/Loss Asymmetry */}
        <div className="border border-slate-800/80 bg-slate-900/40 rounded-lg p-3 flex flex-col justify-between">
          <span className="text-[8px] uppercase text-slate-500 font-bold block mb-1">
            Win/Loss Asymmetry
          </span>
          <div>
            <span className="text-base font-bold text-cyan-300 block">
              {metrics.realizedWinLossAsymmetryRatio.toFixed(2)}x
            </span>
            <span className="text-[9px] text-slate-400 block mt-0.5">
              +{metrics.avgWinningR}R Win / -{metrics.avgLosingR}R Loss
            </span>
          </div>
        </div>

        {/* Metric 5: Execution Efficiency */}
        <div className="border border-slate-800/80 bg-slate-900/40 rounded-lg p-3 flex flex-col justify-between">
          <span className="text-[8px] uppercase text-slate-500 font-bold block mb-1">
            Execution Win Rate
          </span>
          <div>
            <span className="text-base font-bold text-emerald-400 block">
              {metrics.executionWinRatePct}%
            </span>
            <span className="text-[9px] text-slate-400 block mt-0.5">
              {metrics.winningTradesCount}W / {metrics.losingTradesCount}L / {metrics.scratchTradesCount}BE
            </span>
          </div>
        </div>

        {/* Metric 6: Streaks & Conversion Rate */}
        <div className="border border-slate-800/80 bg-slate-900/40 rounded-lg p-3 flex flex-col justify-between">
          <span className="text-[8px] uppercase text-slate-500 font-bold block mb-1">
            Streak Telemetry
          </span>
          <div>
            <span className="text-base font-bold text-white block">
              {metrics.longestWinStreak}W <span className="text-xs text-slate-500 font-normal">max</span> / {metrics.longestLossStreak}L
            </span>
            <span className="text-[9px] text-slate-400 block mt-0.5">
              {totalMonitoredCount
                ? `${metrics.totalExecutedTrades}/${totalMonitoredCount} ${monitoredLabel} (${((metrics.totalExecutedTrades / Math.max(1, totalMonitoredCount)) * 100).toFixed(0)}%)`
                : `${metrics.totalExecutedTrades} Executed Setups`}
            </span>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 4. INTERACTIVE SVG DYNAMIC EQUITY CURVE & HOVER CROSSHAIR           */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="border border-slate-800/80 bg-slate-950 rounded-xl p-4 relative overflow-hidden flex flex-col">
        {/* Chart Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-2 border-b border-slate-800/60 gap-2">
          <div className="flex items-center gap-2 text-xs">
            <BarChart2 className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-slate-200 uppercase">Chronological Compounding Trajectory</span>
            <span className="text-[9px] text-slate-500 font-mono">
              ({metrics.equityCurvePoints.length - 1} Executed Events)
            </span>
          </div>

          <div className="flex items-center gap-4 text-[10px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-emerald-400" />
              <span>Realized Equity</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-slate-500 border-b border-dashed border-slate-400" />
              <span>Peak Watermark</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-cyan-500/60 border-b border-dashed" />
              <span>Base Capital ($10k)</span>
            </span>
          </div>
        </div>

        {/* SVG Container */}
        {trades.length === 0 ? (
          <div className="h-56 flex flex-col items-center justify-center text-slate-500 text-xs border border-dashed border-slate-800/60 rounded-lg">
            <Activity className="w-6 h-6 mb-2 text-slate-600 animate-pulse" />
            <span>No executed trades recorded in this scan dataset.</span>
            <span className="text-[10px] text-slate-600 mt-1">
              Trades execute when setups pass all quantitative gatekeepers and retest triggers.
            </span>
          </div>
        ) : (
          <div className="relative w-full overflow-hidden select-none">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full h-auto max-h-72 cursor-crosshair overflow-visible"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <defs>
                {/* Emerald Equity Area Gradient */}
                <linearGradient id="equityGradientPositive" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                  <stop offset="70%" stopColor="#10b981" stopOpacity="0.05" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.00" />
                </linearGradient>

                {/* Rose Equity Area Gradient */}
                <linearGradient id="equityGradientNegative" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.35" />
                  <stop offset="70%" stopColor="#f43f5e" stopOpacity="0.05" />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.00" />
                </linearGradient>

                {/* Grid Pattern */}
                <pattern id="gridLines" width="40" height="30" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 30" fill="none" stroke="#1e293b" strokeWidth="0.5" strokeOpacity="0.4" />
                </pattern>
              </defs>

              {/* Background Grid */}
              <rect
                x={chartPadding.left}
                y={chartPadding.top}
                width={chartWidth - chartPadding.left - chartPadding.right}
                height={chartHeight - chartPadding.top - chartPadding.bottom}
                fill="url(#gridLines)"
              />

              {/* Base Capital ($Initial) Reference Dashed Line */}
              <line
                x1={chartPadding.left}
                y1={svgData.baselineY}
                x2={chartWidth - chartPadding.right}
                y2={svgData.baselineY}
                stroke="#06b6d4"
                strokeWidth="1"
                strokeDasharray="3 3"
                strokeOpacity="0.6"
              />
              <text
                x={chartPadding.left - 6}
                y={svgData.baselineY + 3}
                fill="#06b6d4"
                fontSize="9"
                textAnchor="end"
                fontFamily="monospace"
                opacity="0.8"
              >
                ${(initialCapital >= 1000 ? `${(initialCapital / 1000).toFixed(0)}k` : initialCapital)} Base
              </text>

              {/* Y-Axis High Label */}
              <text
                x={chartPadding.left - 6}
                y={chartPadding.top + 8}
                fill="#64748b"
                fontSize="8"
                textAnchor="end"
                fontFamily="monospace"
              >
                ${Math.round(svgData.maxVal).toLocaleString()}
              </text>

              {/* Y-Axis Low Label */}
              <text
                x={chartPadding.left - 6}
                y={chartHeight - chartPadding.bottom}
                fill="#64748b"
                fontSize="8"
                textAnchor="end"
                fontFamily="monospace"
              >
                ${Math.round(svgData.minVal).toLocaleString()}
              </text>

              {/* Area Gradient Fill */}
              <path
                d={svgData.areaPathD}
                fill={isNetPositive ? "url(#equityGradientPositive)" : "url(#equityGradientNegative)"}
              />

              {/* Peak Watermark Trajectory Line (Dashed Slate) */}
              <path
                d={svgData.peakPathD}
                fill="none"
                stroke="#64748b"
                strokeWidth="1.2"
                strokeDasharray="4 4"
                strokeOpacity="0.5"
              />

              {/* Main Realized Equity Stroke */}
              <path
                d={svgData.equityPathD}
                fill="none"
                stroke={isNetPositive ? "#10b981" : "#f43f5e"}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Data Points Markers */}
              {svgData.points.map((p, idx) => {
                if (idx === 0) return null; // skip start dummy point
                const isHovered = hoverIndex === idx;
                const isWin = p.point.realizedR > 0;
                const isLoss = p.point.realizedR < 0;

                return (
                  <circle
                    key={p.point.tradeId || idx}
                    cx={p.x}
                    cy={p.y}
                    r={isHovered ? 5 : 2.5}
                    fill={isHovered ? "#ffffff" : isWin ? "#10b981" : isLoss ? "#f43f5e" : "#94a3b8"}
                    stroke={isHovered ? (isWin ? "#10b981" : "#f43f5e") : "#090d16"}
                    strokeWidth={isHovered ? 2.5 : 1}
                    className="transition-all duration-75"
                  />
                );
              })}

              {/* Interactive Crosshair Line */}
              {hoverIndex !== null && svgData.points[hoverIndex] && (
                <g>
                  {/* Vertical Guide Line */}
                  <line
                    x1={svgData.points[hoverIndex].x}
                    y1={chartPadding.top}
                    x2={svgData.points[hoverIndex].x}
                    y2={chartHeight - chartPadding.bottom}
                    stroke="#94a3b8"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    strokeOpacity="0.8"
                  />

                  {/* Horizontal Guide Line to Y-Axis */}
                  <line
                    x1={chartPadding.left}
                    y1={svgData.points[hoverIndex].y}
                    x2={svgData.points[hoverIndex].x}
                    y2={svgData.points[hoverIndex].y}
                    stroke="#94a3b8"
                    strokeWidth="0.8"
                    strokeDasharray="2 2"
                    strokeOpacity="0.5"
                  />

                  {/* Active Highlight Target Outer Pulse */}
                  <circle
                    cx={svgData.points[hoverIndex].x}
                    cy={svgData.points[hoverIndex].y}
                    r="8"
                    fill="none"
                    stroke={
                      svgData.points[hoverIndex].point.realizedR > 0
                        ? "#10b981"
                        : svgData.points[hoverIndex].point.realizedR < 0
                        ? "#f43f5e"
                        : "#94a3b8"
                    }
                    strokeWidth="1.5"
                    strokeOpacity="0.7"
                    className="animate-ping"
                  />
                </g>
              )}
            </svg>

            {/* Hover Floating Tooltip Card */}
            {activeHoverPoint && hoverPos && (
              <div
                className="absolute z-20 pointer-events-none p-3 rounded-lg bg-slate-950/95 border border-slate-700/80 shadow-2xl text-[10px] font-mono transition-all duration-75 min-w-[210px]"
                style={{
                  left: `${Math.min(
                    Math.max(10, hoverPos.x - 105),
                    (svgRef.current?.getBoundingClientRect().width || 600) - 230
                  )}px`,
                  top: `${Math.max(10, hoverPos.y - 120)}px`,
                }}
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
                  <span className="text-slate-400 font-bold">
                    {activeHoverPoint.tradeIndex === 0
                      ? "STARTING BASE"
                      : `TRADE #${activeHoverPoint.tradeIndex}`}
                  </span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[8px] font-bold ${
                      activeHoverPoint.realizedR > 0
                        ? "bg-emerald-950 text-emerald-400 border border-emerald-500/30"
                        : activeHoverPoint.realizedR < 0
                        ? "bg-rose-950 text-rose-400 border border-rose-500/30"
                        : "bg-slate-900 text-slate-400"
                    }`}
                  >
                    {activeHoverPoint.outcome}
                  </span>
                </div>

                <div className="flex flex-col gap-1 text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Timestamp:</span>
                    <span className="text-slate-300">{activeHoverPoint.dateStr}</span>
                  </div>

                  {activeHoverPoint.tradeIndex > 0 && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Setup:</span>
                        <span className="font-bold text-white truncate max-w-[130px]">
                          {activeHoverPoint.label}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Realized R:</span>
                        <span
                          className={`font-bold ${
                            activeHoverPoint.realizedR > 0
                              ? "text-emerald-400"
                              : activeHoverPoint.realizedR < 0
                              ? "text-rose-400"
                              : "text-slate-400"
                          }`}
                        >
                          {fmtR(activeHoverPoint.realizedR)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Trade PnL:</span>
                        <span
                          className={`font-bold ${
                            activeHoverPoint.pnlUsd >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {activeHoverPoint.pnlUsd >= 0 ? "+" : ""}
                          {fmtUsd(activeHoverPoint.pnlUsd)}
                        </span>
                      </div>
                    </>
                  )}

                  <div className="flex justify-between border-t border-slate-800/80 pt-1 mt-0.5">
                    <span className="text-slate-400 font-bold">Running Balance:</span>
                    <span className="font-bold text-emerald-300">
                      {fmtUsd(activeHoverPoint.equity)}
                    </span>
                  </div>

                  <div className="flex justify-between text-[9px]">
                    <span className="text-slate-500">Peak Drawdown:</span>
                    <span
                      className={`font-bold ${
                        activeHoverPoint.drawdownPct > 0 ? "text-rose-400" : "text-slate-400"
                      }`}
                    >
                      -{activeHoverPoint.drawdownPct}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 5. COLLAPSIBLE CHRONOLOGICAL EQUITY LEDGER TABLE                    */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="border border-slate-800/80 bg-slate-900/30 rounded-xl overflow-hidden">
        {/* Toggle Bar */}
        <button
          type="button"
          onClick={() => setIsLedgerExpanded(!isLedgerExpanded)}
          className="w-full px-5 py-3.5 flex items-center justify-between bg-slate-900/60 hover:bg-slate-900 text-left transition font-mono"
        >
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span className="text-xs uppercase font-bold text-slate-200">
              Chronological Trade Execution Ledger
            </span>
            <span className="text-[10px] text-slate-500">
              ({metrics.totalExecutedTrades} executed events)
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-cyan-400 font-bold">
            <span>{isLedgerExpanded ? "COLLAPSE LEDGER" : "EXPAND AUDIT TABLE"}</span>
            {isLedgerExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        </button>

        {/* Expanded Table Content */}
        {isLedgerExpanded && (
          <div className="p-4 border-t border-slate-800/60 flex flex-col gap-3">
            {metrics.totalExecutedTrades === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs font-mono">
                No trade executions in active dataset.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-[10px] text-slate-300">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-500 uppercase">
                        <th className="py-2.5 px-2">#</th>
                        <th className="py-2.5 px-2">Date / Time (Cairo)</th>
                        <th className="py-2.5 px-2">Trade ID / Setup</th>
                        <th className="py-2.5 px-2">Direction</th>
                        <th className="py-2.5 px-2">Entry / SL</th>
                        <th className="py-2.5 px-2">Outcome</th>
                        <th className="py-2.5 px-2 text-right">Realized R</th>
                        <th className="py-2.5 px-2 text-right">Risk ($)</th>
                        <th className="py-2.5 px-2 text-right">PnL ($)</th>
                        <th className="py-2.5 px-2 text-right">Running Equity</th>
                        <th className="py-2.5 px-2 text-right">Drawdown</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {paginatedTrades.map((pt) => {
                        const isWin = pt.realizedR > 0;
                        const isLoss = pt.realizedR < 0;

                        return (
                          <tr key={pt.tradeId || pt.tradeIndex} className="hover:bg-slate-900/40 transition">
                            {/* Index */}
                            <td className="py-2.5 px-2 text-slate-500 font-bold">
                              #{pt.tradeIndex}
                            </td>

                            {/* Timestamp */}
                            <td className="py-2.5 px-2 text-slate-400">
                              {pt.dateStr}
                            </td>

                            {/* Label */}
                            <td className="py-2.5 px-2">
                              <span className="font-bold text-white block truncate max-w-[140px]">
                                {pt.label}
                              </span>
                              <span className="text-[8px] text-slate-500 truncate block max-w-[140px]">
                                {pt.tradeId}
                              </span>
                            </td>

                            {/* Direction */}
                            <td className="py-2.5 px-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                  pt.direction === "BULLISH" || pt.direction === "LONG"
                                    ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"
                                    : "bg-rose-950/60 text-rose-400 border border-rose-500/30"
                                }`}
                              >
                                {pt.direction}
                              </span>
                            </td>

                            {/* Entry / SL */}
                            <td className="py-2.5 px-2 text-slate-400 text-[9px]">
                              ${pt.entryPrice.toFixed(1)} / ${pt.stopLossPrice.toFixed(1)}
                            </td>

                            {/* Outcome Badge */}
                            <td className="py-2.5 px-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                  isWin
                                    ? "bg-emerald-950/40 text-emerald-400 border border-emerald-500/20"
                                    : isLoss
                                    ? "bg-rose-950/40 text-rose-400 border border-rose-500/20"
                                    : "bg-slate-800 text-slate-400"
                                }`}
                              >
                                {pt.outcome.replace(/_/g, " ")}
                              </span>
                            </td>

                            {/* Realized R */}
                            <td
                              className={`py-2.5 px-2 text-right font-bold ${
                                isWin ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-slate-400"
                              }`}
                            >
                              {fmtR(pt.realizedR)}
                            </td>

                            {/* Risk USD */}
                            <td className="py-2.5 px-2 text-right text-slate-400">
                              {fmtUsd(pt.riskUsd)}
                            </td>

                            {/* PnL USD */}
                            <td
                              className={`py-2.5 px-2 text-right font-bold ${
                                isWin ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-slate-400"
                              }`}
                            >
                              {pt.pnlUsd >= 0 ? "+" : ""}
                              {fmtUsd(pt.pnlUsd)}
                            </td>

                            {/* Running Equity */}
                            <td className="py-2.5 px-2 text-right font-bold text-white">
                              {fmtUsd(pt.equity)}
                            </td>

                            {/* Drawdown % */}
                            <td
                              className={`py-2.5 px-2 text-right ${
                                pt.drawdownPct > 0 ? "text-rose-400 font-bold" : "text-slate-500"
                              }`}
                            >
                              {pt.drawdownPct > 0 ? `-${pt.drawdownPct}%` : "0.0%"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Table Pagination */}
                {totalTradePages > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-800/60 pt-3 text-[10px] text-slate-400">
                    <span>
                      Page {currentPage} of {totalTradePages} ({metrics.totalExecutedTrades} total trades)
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className="px-2 py-1 rounded bg-slate-900 border border-slate-800 disabled:opacity-30 hover:border-slate-700 text-slate-300 transition"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="px-2 font-bold text-white">{currentPage}</span>
                      <button
                        type="button"
                        disabled={currentPage === totalTradePages}
                        onClick={() => setCurrentPage((p) => Math.min(totalTradePages, p + 1))}
                        className="px-2 py-1 rounded bg-slate-900 border border-slate-800 disabled:opacity-30 hover:border-slate-700 text-slate-300 transition"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
