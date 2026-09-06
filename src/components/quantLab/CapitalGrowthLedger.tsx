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
  ChevronsLeft,
  ChevronsRight,
  ArrowUpRight,
  ArrowDownRight,
  Sliders,
  Sparkles,
  Layers,
  HelpCircle,
  Zap,
  Crosshair,
  BarChart2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  MoveHorizontal
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
  makerFeePct?: number;
  takerFeePct?: number;
}

export default function CapitalGrowthLedger({
  trades,
  totalMonitoredCount,
  monitoredLabel = "Scanned Setups",
  defaultCapital = 1000,
  defaultRiskPct = 2.0,
  title = "CAPITAL GROWTH & CHRONOLOGICAL EQUITY LEDGER",
  subtitle = "Dynamic path-dependent compounding, drawdown telemetry, and theoretical closed-expectancy modeling.",
  makerFeePct = 0.0000,
  takerFeePct = 0.0400,
}: CapitalGrowthLedgerProps) {
  // ── 1. Configuration State ──────────────────────────────────────────────────
  const [initialCapital, setInitialCapital] = useState<number>(defaultCapital);
  const [riskPerTradePct, setRiskPerTradePct] = useState<number>(defaultRiskPct);
  const [compoundingMode, setCompoundingMode] = useState<"DYNAMIC_COMPOUNDING" | "FIXED_FRACTIONAL">("DYNAMIC_COMPOUNDING");
  const [isLedgerExpanded, setIsLedgerExpanded] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(10);

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
              if (!isNaN(parsed) && parsed > 0 && initialCapital === 1000) {
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
      makerFeePct,
      takerFeePct,
    });
  }, [trades, initialCapital, riskPerTradePct, compoundingMode, makerFeePct, takerFeePct]);

  // ── 3. SVG Path Derivation & Interactive Zoom/Pan State ──────────────────
  const chartWidth = 900;
  const chartHeight = 260;
  const chartPadding = { top: 25, right: 30, bottom: 35, left: 65 };

  // Zoom Window: { start: number, count: number } or null for 100% full view
  const [zoomWindow, setZoomWindow] = useState<{ start: number; count: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartWindow, setDragStartWindow] = useState<{ start: number; count: number } | null>(null);

  // Compute sliced visible points for current zoom level
  const visiblePoints = useMemo(() => {
    const allPoints = metrics.equityCurvePoints;
    if (!zoomWindow || allPoints.length <= 1) return allPoints;
    const start = Math.max(0, Math.min(allPoints.length - 1, zoomWindow.start));
    const end = Math.min(allPoints.length, start + zoomWindow.count);
    const slice = allPoints.slice(start, end);
    return slice.length > 0 ? slice : allPoints;
  }, [metrics.equityCurvePoints, zoomWindow]);

  const svgData = useMemo(() => {
    return generateSvgEquityPaths(
      visiblePoints,
      chartWidth,
      chartHeight,
      chartPadding
    );
  }, [visiblePoints]);

  // ── 4. Interactive Crosshair & Hover Tooltip State ──────────────────────────
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Quick Zoom Preset Handlers
  const handleSetPresetZoom = useCallback((count: number) => {
    const totalPoints = metrics.equityCurvePoints.length;
    if (count >= totalPoints) {
      setZoomWindow(null);
    } else {
      setZoomWindow({
        start: Math.max(0, totalPoints - count),
        count,
      });
    }
  }, [metrics.equityCurvePoints.length]);

  const handleZoomIn = useCallback(() => {
    const totalPoints = metrics.equityCurvePoints.length;
    const currentCount = zoomWindow ? zoomWindow.count : totalPoints;
    const currentStart = zoomWindow ? zoomWindow.start : 0;
    const newCount = Math.max(15, Math.round(currentCount * 0.7));
    if (newCount < totalPoints) {
      const center = currentStart + Math.round(currentCount / 2);
      const newStart = Math.max(0, Math.min(totalPoints - newCount, center - Math.round(newCount / 2)));
      setZoomWindow({ start: newStart, count: newCount });
    }
  }, [metrics.equityCurvePoints.length, zoomWindow]);

  const handleZoomOut = useCallback(() => {
    const totalPoints = metrics.equityCurvePoints.length;
    if (!zoomWindow) return;
    const newCount = Math.min(totalPoints, Math.round(zoomWindow.count * 1.4));
    if (newCount >= totalPoints) {
      setZoomWindow(null);
    } else {
      const center = zoomWindow.start + Math.round(zoomWindow.count / 2);
      const newStart = Math.max(0, Math.min(totalPoints - newCount, center - Math.round(newCount / 2)));
      setZoomWindow({ start: newStart, count: newCount });
    }
  }, [metrics.equityCurvePoints.length, zoomWindow]);

  const handleResetZoom = useCallback(() => {
    setZoomWindow(null);
  }, []);

  // Mouse Drag to Pan
  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!zoomWindow) return;
    setIsDragging(true);
    setDragStartX(e.clientX);
    setDragStartWindow({ ...zoomWindow });
  }, [zoomWindow]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStartWindow(null);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || svgData.points.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();

      // Pan dragging mode
      if (isDragging && dragStartWindow) {
        const dx = e.clientX - dragStartX;
        const pointsPerPx = dragStartWindow.count / rect.width;
        const shift = Math.round(-dx * pointsPerPx);
        const totalPoints = metrics.equityCurvePoints.length;
        let newStart = dragStartWindow.start + shift;
        newStart = Math.max(0, Math.min(totalPoints - dragStartWindow.count, newStart));
        setZoomWindow({ start: newStart, count: dragStartWindow.count });
        return;
      }

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
    [svgData.points, isDragging, dragStartWindow, dragStartX, metrics.equityCurvePoints.length]
  );

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    const totalPoints = metrics.equityCurvePoints.length;
    if (totalPoints <= 15) return;
    e.preventDefault();

    const currentCount = zoomWindow ? zoomWindow.count : totalPoints;
    const currentStart = zoomWindow ? zoomWindow.start : 0;

    const zoomFactor = e.deltaY < 0 ? 0.8 : 1.25;
    let newCount = Math.round(currentCount * zoomFactor);
    newCount = Math.max(15, Math.min(totalPoints, newCount));

    if (newCount >= totalPoints) {
      setZoomWindow(null);
      return;
    }

    const rect = svgRef.current?.getBoundingClientRect();
    const mouseRatio = rect ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0.5;
    const centerIndex = currentStart + Math.round(currentCount * mouseRatio);
    let newStart = Math.round(centerIndex - newCount * mouseRatio);
    newStart = Math.max(0, Math.min(totalPoints - newCount, newStart));

    setZoomWindow({ start: newStart, count: newCount });
  }, [metrics.equityCurvePoints.length, zoomWindow]);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
    setHoverIndex(null);
    setHoverPos(null);
  }, []);

  const activeHoverPoint: SequentialEquityPoint | null =
    hoverIndex !== null && visiblePoints[hoverIndex]
      ? visiblePoints[hoverIndex]
      : null;

  // ── 5. Paginated Trade Ledger ───────────────────────────────────────────────
  const paginatedTrades = useMemo(() => {
    // Exclude the index 0 START point for the trade ledger table
    const tradeOnlyPoints = metrics.equityCurvePoints.filter((p) => p.tradeIndex > 0);
    const start = (currentPage - 1) * itemsPerPage;
    return tradeOnlyPoints.slice(start, start + itemsPerPage);
  }, [metrics.equityCurvePoints, currentPage, itemsPerPage]);

  const totalTradePages = Math.max(
    1,
    Math.ceil(Math.max(0, metrics.equityCurvePoints.length - 1) / itemsPerPage)
  );

  // Formatting helpers
  const fmtUsd = (n: number) =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtR = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}R`;

  const isNetPositive = metrics.realizedNetPnlUsd >= 0;

  return (
    <div className="border border-card-border dark:border-slate-800/80 bg-card/75 dark:bg-slate-950/70 backdrop-blur-md rounded-2xl p-5 md:p-6 shadow-xs flex flex-col gap-6 text-foreground dark:text-slate-100 font-mono transition-all">
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 1. HEADER & DYNAMIC CONFIGURATION CONTROLS                          */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-card-border/60 dark:border-slate-800/60 pb-5 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <TrendingUp className="w-4 h-4" />
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400 font-bold">
              QUANT EQUITY LEDGER ENGINE
            </span>
          </div>
          <h3 className="text-base font-bold text-foreground dark:text-white uppercase tracking-tight flex items-center gap-2">
            <span>{title}</span>
          </h3>
          <p className="text-[11px] text-muted dark:text-slate-400 mt-0.5 max-w-2xl font-sans">
            {subtitle}
          </p>
        </div>

        {/* Dynamic Risk & Capital Controls */}
        <div className="flex flex-wrap items-center gap-3 bg-card dark:bg-slate-900/80 border border-card-border dark:border-slate-800/90 rounded-xl p-2.5 shadow-xs">
          {/* Initial Capital Input */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] uppercase font-bold text-muted dark:text-slate-400 flex items-center justify-between">
              <span>Initial Capital</span>
              <span className="text-emerald-600 dark:text-emerald-400">${initialCapital.toLocaleString()}</span>
            </label>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <span className="absolute left-2 top-1.5 text-muted dark:text-slate-500 text-xs">$</span>
                <input
                  type="number"
                  min="100"
                  step="500"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(Math.max(100, parseFloat(e.target.value) || 0))}
                  className="w-24 pl-5 pr-2 py-1 bg-background dark:bg-slate-950 border border-card-border dark:border-slate-800 rounded-lg text-xs text-foreground dark:text-white font-bold outline-none focus:border-emerald-500 shadow-xs"
                />
              </div>

              {/* Capital Preset Pills */}
              <div className="hidden sm:flex items-center gap-1 text-[9px]">
                {[1000, 2500, 5000, 10000].map((cap) => (
                  <button
                    key={cap}
                    type="button"
                    onClick={() => setInitialCapital(cap)}
                    className={`px-1.5 py-1 rounded-md border transition cursor-pointer ${
                      initialCapital === cap
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300 font-bold"
                        : "bg-background dark:bg-slate-950 border-card-border dark:border-slate-800 text-muted dark:text-slate-500 hover:text-foreground dark:hover:text-slate-300"
                    }`}
                  >
                    ${cap >= 1000 ? `${cap / 1000}k` : cap}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Vertical Divider */}
          <div className="h-9 w-[1px] bg-card-border dark:bg-slate-800 hidden sm:block" />

          {/* Risk Per Trade Slider & Number */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] uppercase font-bold text-muted dark:text-slate-400 flex items-center justify-between">
              <span>Risk Per Trade</span>
              <span className="text-cyan-600 dark:text-cyan-400 font-bold">{riskPerTradePct.toFixed(1)}%</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.1"
                max="5.0"
                step="0.1"
                value={riskPerTradePct}
                onChange={(e) => setRiskPerTradePct(parseFloat(e.target.value))}
                className="w-20 sm:w-24 accent-cyan-500 cursor-pointer"
              />

              {/* Risk Preset Pills */}
              <div className="flex items-center gap-1 text-[9px]">
                {[0.5, 1.0, 1.5, 2.0].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRiskPerTradePct(r)}
                    className={`px-1.5 py-1 rounded-md border transition cursor-pointer ${
                      riskPerTradePct === r
                        ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-600 dark:text-cyan-300 font-bold"
                        : "bg-background dark:bg-slate-950 border-card-border dark:border-slate-800 text-muted dark:text-slate-500 hover:text-foreground dark:hover:text-slate-300"
                    }`}
                  >
                    {r}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Vertical Divider */}
          <div className="h-9 w-[1px] bg-card-border dark:bg-slate-800 hidden md:block" />

          {/* Compounding Mode Toggle */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] uppercase font-bold text-muted dark:text-slate-400">
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
              className={`px-2.5 py-1 rounded-md border text-[9px] font-bold transition flex items-center gap-1.5 cursor-pointer ${
                compoundingMode === "DYNAMIC_COMPOUNDING"
                  ? "bg-purple-500/15 border-purple-500/40 text-purple-600 dark:text-purple-300"
                  : "bg-background dark:bg-slate-950 border-card-border dark:border-slate-800 text-muted dark:text-slate-400 hover:text-foreground"
              }`}
              title="Dynamic Compounding recalculates risk size per trade based on running equity balance."
            >
              <Zap className="w-3 h-3 text-purple-500 dark:text-purple-400" />
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
        <div className="p-3.5 rounded-xl border border-card-border dark:border-slate-800/80 bg-card/75 dark:bg-slate-900/30 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] uppercase font-bold text-muted dark:text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-500 dark:text-cyan-400" />
              <span>Approach A: Theoretical Closed Expectancy</span>
            </span>
            <span className="text-[9px] font-bold text-cyan-600 dark:text-cyan-400/90 bg-cyan-500/10 dark:bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-500/20">
              E[R] = {metrics.expectedValueR > 0 ? "+" : ""}{metrics.expectedValueR}R / trade
            </span>
          </div>
          <p className="text-[10px] text-muted dark:text-slate-400 mb-2 font-sans">
            Mathematical expectation across {metrics.totalExecutedTrades} trades assuming uniform win distribution.
          </p>
          <div className="flex items-center justify-between border-t border-card-border/60 dark:border-slate-800/50 pt-2 text-xs">
            <span className="text-muted dark:text-slate-400">Projected Compounded Capital:</span>
            <span className="font-bold text-cyan-600 dark:text-cyan-300">
              {fmtUsd(metrics.theoreticalFinalEquity)}{" "}
              <span className="text-[10px] text-cyan-600/80 dark:text-cyan-400/80">
                ({metrics.theoreticalNetRoiPct >= 0 ? "+" : ""}{metrics.theoreticalNetRoiPct}%)
              </span>
            </span>
          </div>
        </div>

        {/* Approach B: Path-Dependent Sequential Walk */}
        <div className="p-3.5 rounded-xl border border-card-border dark:border-slate-800/80 bg-card/75 dark:bg-slate-900/30 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] uppercase font-bold text-muted dark:text-slate-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
              <span>Approach B: Realized Chronological Walk</span>
            </span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
              isNetPositive
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                : "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400"
            }`}>
              Max DD: -{metrics.maxDrawdownPct}%
            </span>
          </div>
          <p className="text-[10px] text-muted dark:text-slate-400 mb-2 font-sans">
            Exact path-dependent equity progression accounting for real-world trade sequences and drawdown.
          </p>
          <div className="flex items-center justify-between border-t border-card-border/60 dark:border-slate-800/50 pt-2 text-xs">
            <span className="text-muted dark:text-slate-400">Actual Realized Balance:</span>
            <span className={`font-bold ${isNetPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
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
        <div className="border border-card-border dark:border-slate-800/80 bg-card/75 dark:bg-slate-900/40 rounded-xl p-3 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] uppercase text-muted dark:text-slate-500 font-bold block">
              Net Compounded Balance
            </span>
            {metrics.totalFeesPaidUsd !== undefined && metrics.totalFeesPaidUsd > 0 && (
              <span className="text-[8px] px-1 py-0.2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 font-mono font-bold">
                Fee-Adjusted
              </span>
            )}
          </div>
          <div>
            <span className={`text-base font-bold block ${isNetPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {fmtUsd(metrics.finalRealizedEquity)}
            </span>
            <span className={`text-[9px] font-bold block mt-0.5 ${isNetPositive ? "text-emerald-600 dark:text-emerald-500" : "text-rose-600 dark:text-rose-500"}`}>
              {metrics.realizedNetPnlUsd >= 0 ? "+" : ""}{fmtUsd(metrics.realizedNetPnlUsd)} ({metrics.realizedNetRoiPct >= 0 ? "+" : ""}{metrics.realizedNetRoiPct}%)
            </span>
            {metrics.nominalFinalEquity !== undefined && (
              <span className="text-[8.5px] text-muted dark:text-slate-400 block mt-1 border-t border-card-border/60 dark:border-slate-800/40 pt-1 font-mono">
                Gross: {fmtUsd(metrics.nominalFinalEquity)} • Fees: -${metrics.totalFeesPaidUsd?.toFixed(2) ?? "0.00"}
              </span>
            )}
          </div>
        </div>

        {/* Metric 2: Max Peak-to-Trough Drawdown */}
        <div className="border border-card-border dark:border-slate-800/80 bg-card/75 dark:bg-slate-900/40 rounded-xl p-3 flex flex-col justify-between shadow-xs">
          <span className="text-[8px] uppercase text-muted dark:text-slate-500 font-bold block mb-1">
            Max Drawdown
          </span>
          <div>
            <span className="text-base font-bold text-rose-600 dark:text-rose-400 block">
              -{metrics.maxDrawdownPct}%
            </span>
            <span className="text-[9px] text-muted dark:text-slate-400 block mt-0.5">
              -{fmtUsd(metrics.maxDrawdownUsd)} Peak-to-Trough
            </span>
          </div>
        </div>

        {/* Metric 3: Profit Factor & Average Realized R */}
        <div className="border border-card-border dark:border-slate-800/80 bg-card/75 dark:bg-slate-900/40 rounded-xl p-3 flex flex-col justify-between shadow-xs">
          <span className="text-[8px] uppercase text-muted dark:text-slate-500 font-bold block mb-1">
            Profit Factor (Net)
          </span>
          <div>
            <span className="text-base font-bold text-purple-600 dark:text-purple-300 block">
              {metrics.profitFactor >= 99 ? "99.9+" : metrics.profitFactor.toFixed(2)}
            </span>
            <span className="text-[9px] text-muted dark:text-slate-400 block mt-0.5">
              Net R: {fmtR(metrics.netRealizedR ?? metrics.avgRealizedR)}
            </span>
            {metrics.grossProfitFactor !== undefined && (
              <span className="text-[8.5px] text-muted dark:text-slate-400 block mt-1 border-t border-card-border/60 dark:border-slate-800/40 pt-1 font-mono">
                Gross PF: {metrics.grossProfitFactor.toFixed(2)} • Fees: -{metrics.totalFeesPaidR?.toFixed(1) ?? "0.0"}R
              </span>
            )}
          </div>
        </div>

        {/* Metric 4: Realized Win/Loss Asymmetry */}
        <div className="border border-card-border dark:border-slate-800/80 bg-card/75 dark:bg-slate-900/40 rounded-xl p-3 flex flex-col justify-between shadow-xs">
          <span className="text-[8px] uppercase text-muted dark:text-slate-500 font-bold block mb-1">
            Win/Loss Asymmetry
          </span>
          <div>
            <span className="text-base font-bold text-cyan-600 dark:text-cyan-300 block">
              {metrics.realizedWinLossAsymmetryRatio.toFixed(2)}x
            </span>
            <span className="text-[9px] text-muted dark:text-slate-400 block mt-0.5">
              +{metrics.avgWinningR}R Win / -{metrics.avgLosingR}R Loss
            </span>
          </div>
        </div>

        {/* Metric 5: Execution Efficiency */}
        <div className="border border-card-border dark:border-slate-800/80 bg-card/75 dark:bg-slate-900/40 rounded-xl p-3 flex flex-col justify-between shadow-xs">
          <span className="text-[8px] uppercase text-muted dark:text-slate-500 font-bold block mb-1">
            Execution Win Rate
          </span>
          <div>
            <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 block">
              {metrics.executionWinRatePct}%
            </span>
            <span className="text-[9px] text-muted dark:text-slate-400 block mt-0.5">
              {metrics.winningTradesCount}W / {metrics.losingTradesCount}L / {metrics.scratchTradesCount}BE
            </span>
          </div>
        </div>

        {/* Metric 6: Streaks & Conversion Rate */}
        <div className="border border-card-border dark:border-slate-800/80 bg-card/75 dark:bg-slate-900/40 rounded-xl p-3 flex flex-col justify-between shadow-xs">
          <span className="text-[8px] uppercase text-muted dark:text-slate-500 font-bold block mb-1">
            Streak Telemetry
          </span>
          <div>
            <span className="text-base font-bold text-foreground dark:text-white block">
              {metrics.longestWinStreak}W <span className="text-xs text-muted dark:text-slate-500 font-normal">max</span> / {metrics.longestLossStreak}L
            </span>
            <span className="text-[9px] text-muted dark:text-slate-400 block mt-0.5">
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
      <div className="border border-card-border dark:border-slate-800/80 bg-background dark:bg-slate-950 rounded-2xl p-4 relative overflow-hidden flex flex-col shadow-xs">
        {/* Chart Header Bar with Zoom Toolbar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-3 mb-2 border-b border-card-border/60 dark:border-slate-800/60 gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <BarChart2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="font-bold text-foreground dark:text-slate-200 uppercase">Chronological Compounding Trajectory</span>
            <span className="text-[9px] text-muted dark:text-slate-500 font-mono">
              ({metrics.equityCurvePoints.length - 1} Executed Events)
            </span>

            {/* If zoomed in, show current window tag */}
            {zoomWindow && (
              <span className="px-1.5 py-0.5 rounded-md bg-cyan-500/10 dark:bg-cyan-950/80 border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 text-[9px] font-bold animate-in fade-in duration-100">
                Viewing #{zoomWindow.start + 1}–#{Math.min(metrics.equityCurvePoints.length - 1, zoomWindow.start + zoomWindow.count)} ({zoomWindow.count} events)
              </span>
            )}
          </div>

          {/* Right Controls: Legend & Zoom Presets */}
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted dark:text-slate-400">
            {/* Legend */}
            <div className="hidden lg:flex items-center gap-3 text-[9px]">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-0.5 bg-emerald-500 dark:bg-emerald-400" />
                <span>Realized Equity</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-0.5 bg-slate-400 dark:bg-slate-500 border-b border-dashed border-slate-500" />
                <span>Peak Watermark</span>
              </span>
            </div>

            {/* Quick Zoom Presets & Controls */}
            {metrics.equityCurvePoints.length > 20 && (
              <div className="flex items-center gap-1 bg-card dark:bg-slate-900/90 border border-card-border dark:border-slate-800 p-0.5 rounded-lg shadow-xs">
                <span className="text-[8px] uppercase tracking-wider text-muted dark:text-slate-500 px-1 font-bold">Zoom:</span>
                
                <button
                  type="button"
                  onClick={() => handleSetPresetZoom(metrics.equityCurvePoints.length)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition cursor-pointer ${
                    !zoomWindow ? 'bg-cyan-500 text-slate-950 shadow-xs' : 'text-muted dark:text-slate-400 hover:text-foreground dark:hover:text-white hover:bg-muted/15 dark:hover:bg-slate-800'
                  }`}
                  title="View All Trades (100% Full View)"
                >
                  All
                </button>

                {metrics.equityCurvePoints.length > 500 && (
                  <button
                    type="button"
                    onClick={() => handleSetPresetZoom(500)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition cursor-pointer ${
                      zoomWindow?.count === 500 ? 'bg-cyan-500 text-slate-950 shadow-xs' : 'text-muted dark:text-slate-400 hover:text-foreground dark:hover:text-white hover:bg-muted/15 dark:hover:bg-slate-800'
                    }`}
                  >
                    500
                  </button>
                )}

                {metrics.equityCurvePoints.length > 250 && (
                  <button
                    type="button"
                    onClick={() => handleSetPresetZoom(250)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition cursor-pointer ${
                      zoomWindow?.count === 250 ? 'bg-cyan-500 text-slate-950 shadow-xs' : 'text-muted dark:text-slate-400 hover:text-foreground dark:hover:text-white hover:bg-muted/15 dark:hover:bg-slate-800'
                    }`}
                  >
                    250
                  </button>
                )}

                {metrics.equityCurvePoints.length > 100 && (
                  <button
                    type="button"
                    onClick={() => handleSetPresetZoom(100)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition cursor-pointer ${
                      zoomWindow?.count === 100 ? 'bg-cyan-500 text-slate-950 shadow-xs' : 'text-muted dark:text-slate-400 hover:text-foreground dark:hover:text-white hover:bg-muted/15 dark:hover:bg-slate-800'
                    }`}
                  >
                    100
                  </button>
                )}

                {metrics.equityCurvePoints.length > 50 && (
                  <button
                    type="button"
                    onClick={() => handleSetPresetZoom(50)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition cursor-pointer ${
                      zoomWindow?.count === 50 ? 'bg-cyan-500 text-slate-950 shadow-xs' : 'text-muted dark:text-slate-400 hover:text-foreground dark:hover:text-white hover:bg-muted/15 dark:hover:bg-slate-800'
                    }`}
                  >
                    50
                  </button>
                )}

                <div className="w-px h-3 bg-card-border dark:bg-slate-800 my-auto" />

                {/* Zoom In Button */}
                <button
                  type="button"
                  onClick={handleZoomIn}
                  className="p-1 text-muted dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-muted/15 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                  title="Zoom In (or scroll up with mouse wheel)"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>

                {/* Zoom Out Button */}
                <button
                  type="button"
                  onClick={handleZoomOut}
                  disabled={!zoomWindow}
                  className="p-1 text-muted dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-muted/15 dark:hover:bg-slate-800 rounded transition cursor-pointer disabled:opacity-30 disabled:hover:text-muted disabled:cursor-not-allowed"
                  title="Zoom Out (or scroll down with mouse wheel)"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>

                {/* Reset Zoom Button */}
                {zoomWindow && (
                  <button
                    type="button"
                    onClick={handleResetZoom}
                    className="p-1 text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300 hover:bg-rose-500/10 dark:hover:bg-rose-950/40 rounded transition cursor-pointer"
                    title="Reset Zoom to 100%"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* SVG Container */}
        {trades.length === 0 ? (
          <div className="h-56 flex flex-col items-center justify-center text-muted dark:text-slate-500 text-xs border border-dashed border-card-border dark:border-slate-800/60 rounded-xl">
            <Activity className="w-6 h-6 mb-2 text-muted/60 dark:text-slate-600 animate-pulse" />
            <span>No executed trades recorded in this scan dataset.</span>
            <span className="text-[10px] text-muted/60 dark:text-slate-600 mt-1">
              Trades execute when setups pass all quantitative gatekeepers and retest triggers.
            </span>
          </div>
        ) : (
          <div className="relative w-full overflow-hidden select-none">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className={`w-full h-auto max-h-72 select-none overflow-visible ${
                zoomWindow ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair'
              }`}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
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
                  <path d="M 40 0 L 0 0 0 30" fill="none" stroke="currentColor" className="text-card-border/40 dark:text-slate-800/40" strokeWidth="0.5" />
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
                fill="currentColor"
                className="text-muted dark:text-slate-400"
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
                fill="currentColor"
                className="text-muted dark:text-slate-400"
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
                stroke="#94a3b8"
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

              {/* Data Points Markers with Adaptive Density (Avoids caterpillar overlap) */}
              {svgData.points.map((p, idx) => {
                if (idx === 0 && !zoomWindow) return null; // skip start dummy point if full view
                const isHovered = hoverIndex === idx;
                const isWin = p.point.realizedR > 0;
                const isLoss = p.point.realizedR < 0;

                // When there are more than 120 visible points, suppress non-hovered dots
                // to maintain a crisp, uncluttered vector trajectory
                if (svgData.points.length > 120 && !isHovered) {
                  return null;
                }

                return (
                  <circle
                    key={p.point.tradeId || idx}
                    cx={p.x}
                    cy={p.y}
                    r={isHovered ? 5.5 : svgData.points.length > 60 ? 2 : 3}
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

            {/* Smart Adaptive Tooltip Card (Positioned to side with clearance, never covering dot) */}
            {activeHoverPoint && hoverPos && (
              <div
                className="absolute z-20 pointer-events-none p-3 rounded-xl bg-card/95 dark:bg-slate-950/95 border border-card-border dark:border-slate-700/90 shadow-2xl text-[10px] font-mono transition-all duration-75 min-w-[220px] max-w-[260px] backdrop-blur-xl text-foreground dark:text-slate-100"
                style={{
                  left: hoverPos.x > (svgRef.current?.getBoundingClientRect().width || 600) / 2
                    ? `${Math.max(10, hoverPos.x - 245)}px`
                    : `${hoverPos.x + 24}px`,
                  top: `${Math.max(10, Math.min((svgRef.current?.getBoundingClientRect().height || 260) - 155, hoverPos.y - 70))}px`,
                }}
              >
                <div className="flex items-center justify-between border-b border-card-border/60 dark:border-slate-800 pb-1.5 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                    <span className="text-foreground dark:text-slate-300 font-bold">
                      {activeHoverPoint.tradeIndex === 0
                        ? "STARTING BASE"
                        : `TRADE #${activeHoverPoint.tradeIndex}`}
                    </span>
                  </div>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[8px] font-bold ${
                      activeHoverPoint.realizedR > 0
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                        : activeHoverPoint.realizedR < 0
                        ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                        : "bg-muted/15 text-muted"
                    }`}
                  >
                    {activeHoverPoint.outcome.replace(/_/g, " ")}
                  </span>
                </div>

                <div className="flex flex-col gap-1 text-foreground/90 dark:text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-muted dark:text-slate-500">Timestamp:</span>
                    <span className="text-foreground dark:text-slate-300">{activeHoverPoint.dateStr}</span>
                  </div>

                  {activeHoverPoint.tradeIndex > 0 && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted dark:text-slate-500">Setup:</span>
                        <span className="font-bold text-foreground dark:text-white truncate max-w-[130px]" title={activeHoverPoint.label}>
                          {activeHoverPoint.label}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted dark:text-slate-500">Realized R:</span>
                        <span
                          className={`font-bold ${
                            activeHoverPoint.realizedR > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : activeHoverPoint.realizedR < 0
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-muted dark:text-slate-400"
                          }`}
                        >
                          {fmtR(activeHoverPoint.realizedR)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted dark:text-slate-500">Trade PnL:</span>
                        <span
                          className={`font-bold ${
                            activeHoverPoint.pnlUsd >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {activeHoverPoint.pnlUsd >= 0 ? "+" : ""}
                          {fmtUsd(activeHoverPoint.pnlUsd)}
                        </span>
                      </div>
                    </>
                  )}

                  <div className="flex justify-between border-t border-card-border/60 dark:border-slate-800/80 pt-1 mt-0.5">
                    <span className="text-muted dark:text-slate-400 font-bold">Running Balance:</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-300">
                      {fmtUsd(activeHoverPoint.equity)}
                    </span>
                  </div>

                  <div className="flex justify-between text-[9px]">
                    <span className="text-muted dark:text-slate-500">Peak Drawdown:</span>
                    <span
                      className={`font-bold ${
                        activeHoverPoint.drawdownPct > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted dark:text-slate-400"
                      }`}
                    >
                      {activeHoverPoint.drawdownPct > 0 ? `-${activeHoverPoint.drawdownPct}%` : "0%"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Interactive Timeline Range Scrubber Slider when zoomed in */}
            {zoomWindow && (
              <div className="mt-2 pt-2 border-t border-card-border/60 dark:border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[9px] font-mono text-muted dark:text-slate-400 animate-in fade-in duration-150">
                <div className="flex items-center gap-1.5 text-muted dark:text-slate-400 shrink-0">
                  <MoveHorizontal className="w-3 h-3 text-cyan-500 dark:text-cyan-400" />
                  <span>Timeline Pan Scrubber:</span>
                </div>

                <div className="flex-1 max-w-md mx-2">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, metrics.equityCurvePoints.length - zoomWindow.count)}
                    value={zoomWindow.start}
                    onChange={(e) => {
                      setZoomWindow({
                        start: Number(e.target.value),
                        count: zoomWindow.count,
                      });
                    }}
                    className="w-full h-1.5 bg-muted/20 dark:bg-slate-800 accent-cyan-500 rounded-lg cursor-ew-resize transition-all"
                  />
                </div>

                <div className="text-muted dark:text-slate-500 text-[8px] flex items-center gap-1 shrink-0">
                  <span>Click-drag chart or use slider to pan</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 5. COLLAPSIBLE CHRONOLOGICAL EQUITY LEDGER TABLE                    */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="border border-card-border dark:border-slate-800/80 bg-card/75 dark:bg-slate-900/30 rounded-2xl overflow-hidden shadow-xs">
        {/* Toggle Bar */}
        <button
          type="button"
          onClick={() => setIsLedgerExpanded(!isLedgerExpanded)}
          className="w-full px-5 py-3.5 flex items-center justify-between bg-card/90 dark:bg-slate-900/60 hover:bg-muted/10 hover:dark:bg-slate-900 text-left transition font-mono cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
            <span className="text-xs uppercase font-bold text-foreground dark:text-slate-200">
              Chronological Trade Execution Ledger
            </span>
            <span className="text-[10px] text-muted dark:text-slate-500">
              ({metrics.totalExecutedTrades} executed events)
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-cyan-600 dark:text-cyan-400 font-bold">
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
          <div className="p-4 border-t border-card-border/60 dark:border-slate-800/60 flex flex-col gap-3">
            {metrics.totalExecutedTrades === 0 ? (
              <div className="py-8 text-center text-muted dark:text-slate-500 text-xs font-mono">
                No trade executions in active dataset.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-[10px] text-foreground dark:text-slate-300">
                    <thead>
                      <tr className="border-b border-card-border/80 dark:border-slate-800 text-muted dark:text-slate-500 uppercase">
                        <th className="py-2.5 px-2">#</th>
                        <th className="py-2.5 px-2">Date / Time (Cairo)</th>
                        <th className="py-2.5 px-2">Trade ID / Setup</th>
                        <th className="py-2.5 px-2">Direction</th>
                        <th className="py-2.5 px-2">Entry / SL</th>
                        <th className="py-2.5 px-2">Outcome</th>
                        <th className="py-2.5 px-2 text-right">R (Net / Gross)</th>
                        <th className="py-2.5 px-2 text-right">Risk ($)</th>
                        <th className="py-2.5 px-2 text-right">Fee ($)</th>
                        <th className="py-2.5 px-2 text-right">Net PnL ($)</th>
                        <th className="py-2.5 px-2 text-right">Running Equity</th>
                        <th className="py-2.5 px-2 text-right">Drawdown</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-card-border/40 dark:divide-slate-800/40">
                      {paginatedTrades.map((pt) => {
                        const isNetWin = (pt.netRealizedR ?? pt.realizedR) > 0;
                        const isNetLoss = (pt.netRealizedR ?? pt.realizedR) < 0;

                        return (
                          <tr key={pt.tradeId || pt.tradeIndex} className="hover:bg-muted/10 hover:dark:bg-slate-900/40 transition">
                            {/* Index */}
                            <td className="py-2.5 px-2 text-muted dark:text-slate-500 font-bold">
                              #{pt.tradeIndex}
                            </td>

                            {/* Timestamp */}
                            <td className="py-2.5 px-2 text-muted dark:text-slate-400">
                              {pt.dateStr}
                            </td>

                            {/* Label */}
                            <td className="py-2.5 px-2">
                              <span className="font-bold text-foreground dark:text-white block truncate max-w-[140px]">
                                {pt.label}
                              </span>
                              <span className="text-[8px] text-muted dark:text-slate-500 truncate block max-w-[140px]">
                                {pt.tradeId}
                              </span>
                            </td>

                            {/* Direction */}
                            <td className="py-2.5 px-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                  pt.direction === "BULLISH" || pt.direction === "LONG"
                                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                                    : "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                                }`}
                              >
                                {pt.direction}
                              </span>
                            </td>

                            {/* Entry / SL */}
                            <td className="py-2.5 px-2 text-muted dark:text-slate-400 text-[9px]">
                              ${pt.entryPrice.toFixed(1)} / ${pt.stopLossPrice.toFixed(1)}
                            </td>

                            {/* Outcome Badge */}
                            <td className="py-2.5 px-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                  pt.realizedR > 0
                                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                    : pt.realizedR < 0
                                    ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                                    : "bg-muted/15 text-muted dark:bg-slate-800 dark:text-slate-400"
                                }`}
                              >
                                {pt.outcome.replace(/_/g, " ")}
                              </span>
                            </td>

                            {/* Realized R (Net / Gross) */}
                            <td className="py-2.5 px-2 text-right">
                              <span
                                className={`font-bold block ${
                                  isNetWin
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : isNetLoss
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-muted dark:text-slate-400"
                                }`}
                              >
                                {fmtR(pt.netRealizedR ?? pt.realizedR)}
                              </span>
                              {pt.feeInR !== undefined && pt.feeInR > 0 && (
                                <span className="text-[8px] text-muted dark:text-slate-500 block font-mono">
                                  Gross: {fmtR(pt.realizedR)}
                                </span>
                              )}
                            </td>

                            {/* Risk USD */}
                            <td className="py-2.5 px-2 text-right text-muted dark:text-slate-400">
                              {fmtUsd(pt.riskUsd)}
                            </td>

                            {/* Fee USD */}
                            <td className="py-2.5 px-2 text-right text-muted dark:text-slate-400 font-mono">
                              {pt.feeUsd && pt.feeUsd > 0 ? (
                                <span className="text-amber-500">-${pt.feeUsd.toFixed(2)}</span>
                              ) : (
                                <span className="text-slate-500">$0.00</span>
                              )}
                            </td>

                            {/* Net PnL USD */}
                            <td
                              className={`py-2.5 px-2 text-right font-bold ${
                                pt.pnlUsd > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : pt.pnlUsd < 0
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-muted dark:text-slate-400"
                              }`}
                            >
                              {pt.pnlUsd >= 0 ? "+" : ""}
                              {fmtUsd(pt.pnlUsd)}
                            </td>

                            {/* Running Equity */}
                            <td className="py-2.5 px-2 text-right font-bold text-foreground dark:text-white">
                              {fmtUsd(pt.equity)}
                            </td>

                            {/* Drawdown % */}
                            <td
                              className={`py-2.5 px-2 text-right ${
                                pt.drawdownPct > 0 ? "text-rose-600 dark:text-rose-400 font-bold" : "text-muted dark:text-slate-500"
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
                {metrics.totalExecutedTrades > 0 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between border-t border-card-border/80 dark:border-slate-800/80 pt-3.5 mt-1 gap-3 text-[10px] text-muted dark:text-slate-400 font-mono">
                    {/* Left: Summary & Rows Per Page */}
                    <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
                      <span>
                        Showing <span className="font-bold text-foreground dark:text-slate-100">{(currentPage - 1) * itemsPerPage + 1}</span>–<span className="font-bold text-foreground dark:text-slate-100">{Math.min(currentPage * itemsPerPage, metrics.totalExecutedTrades)}</span> of <span className="font-bold text-foreground dark:text-slate-100">{metrics.totalExecutedTrades}</span> trades
                      </span>

                      {/* Rows per page selector */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] uppercase tracking-wider text-muted dark:text-slate-500">Rows:</span>
                        <select
                          value={itemsPerPage}
                          onChange={(e) => {
                            const nextLimit = Number(e.target.value);
                            setItemsPerPage(nextLimit);
                            setCurrentPage(1);
                          }}
                          className="bg-card dark:bg-slate-900 border border-card-border dark:border-slate-800 text-foreground dark:text-slate-200 text-[10px] rounded-lg px-2 py-0.5 focus:outline-none focus:border-cyan-500 cursor-pointer transition shadow-xs"
                        >
                          <option value={10}>10</option>
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                        </select>
                      </div>
                    </div>

                    {/* Right: Full Navigation Cluster */}
                    <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
                      {/* Jump to First Page */}
                      <button
                        type="button"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(1)}
                        className="p-1.5 rounded-lg bg-card dark:bg-slate-900 border border-card-border dark:border-slate-800 hover:border-cyan-500/50 disabled:opacity-30 text-foreground dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition cursor-pointer disabled:cursor-not-allowed shadow-xs"
                        title="First Page (Jump to Start)"
                      >
                        <ChevronsLeft className="w-3.5 h-3.5" />
                      </button>

                      {/* Previous Page */}
                      <button
                        type="button"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className="p-1.5 rounded-lg bg-card dark:bg-slate-900 border border-card-border dark:border-slate-800 hover:border-cyan-500/50 disabled:opacity-30 text-foreground dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition cursor-pointer disabled:cursor-not-allowed shadow-xs"
                        title="Previous Page"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>

                      {/* Select Page Dropdown */}
                      <div className="flex items-center">
                        <select
                          value={currentPage}
                          onChange={(e) => setCurrentPage(Number(e.target.value))}
                          className="bg-card dark:bg-slate-900 border border-card-border dark:border-slate-800 text-foreground dark:text-slate-100 font-bold text-[10px] rounded-lg px-2 py-1 focus:outline-none focus:border-cyan-500 cursor-pointer transition shadow-xs"
                        >
                          {Array.from({ length: totalTradePages }, (_, i) => i + 1).map((pageNum) => (
                            <option key={pageNum} value={pageNum}>
                              Page {pageNum} of {totalTradePages}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Next Page */}
                      <button
                        type="button"
                        disabled={currentPage === totalTradePages}
                        onClick={() => setCurrentPage((p) => Math.min(totalTradePages, p + 1))}
                        className="p-1.5 rounded-lg bg-card dark:bg-slate-900 border border-card-border dark:border-slate-800 hover:border-cyan-500/50 disabled:opacity-30 text-foreground dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition cursor-pointer disabled:cursor-not-allowed shadow-xs"
                        title="Next Page"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>

                      {/* Jump to Last Page */}
                      <button
                        type="button"
                        disabled={currentPage === totalTradePages}
                        onClick={() => setCurrentPage(totalTradePages)}
                        className="p-1.5 rounded-lg bg-card dark:bg-slate-900 border border-card-border dark:border-slate-800 hover:border-cyan-500/50 disabled:opacity-30 text-foreground dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition cursor-pointer disabled:cursor-not-allowed shadow-xs"
                        title="Last Page (Jump to End)"
                      >
                        <ChevronsRight className="w-3.5 h-3.5" />
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
