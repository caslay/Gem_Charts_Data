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
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Shield,
  Zap,
  TrendingUp,
  Activity,
  Award,
  X,
  RefreshCw,
  Play,
  Info,
  Check,
  Target,
  BarChart3,
  Percent
} from "lucide-react";
import {
  SweepReclaimSetup,
  SweepReclaimTelemetrySummary,
  SweepReclaimScanConfig,
  SweepReclaimAnchorType,
  SweepReclaimEntryMode,
  getEntryModeLabel,
  getEntryModeDescription,
} from "@/lib/quantEngine/SweepReclaimEngine";
import { adaptSweepReclaimSetupsToTrades, formatCairoDateTime } from "@/lib/quantEngine/equityCalculator";
import CapitalGrowthLedger from "@/components/quantLab/CapitalGrowthLedger";
import ScannerPresetControlDeck from "@/components/quantLab/ScannerPresetControlDeck";
import { ScannerPreset, SweepReclaimPresetConfig } from "@/lib/quantEngine/scannerPresets";
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
  onRunScan: (config: SweepReclaimScanConfig & { scan_name: string; start_date: string; end_date: string;[key: string]: any }) => void;
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
  const [timeframe, setTimeframe] = useState<"5m" | "15m" | "1h" | "4h">("5m");
  const [startDate, setStartDate] = useState("2026-03-01");
  const [endDate, setEndDate] = useState("2026-06-01");

  // Multi-Timeframe Anchor Selection
  const [enabledAnchors, setEnabledAnchors] = useState<Record<string, boolean>>({
    SWING_PIVOT: true,
    ASIAN: true,
    LONDON: true,
    DAILY: true,
  });

  // Volumetric & Displacement Gating (3-Pillar Gatekeeper)
  const [volumeSmaPeriod, setVolumeSmaPeriod] = useState(20);
  const [volumeExpansionThreshold, setVolumeExpansionThreshold] = useState(1.35);
  const [deltaDominanceThreshold, setDeltaDominanceThreshold] = useState(52.0);
  const [bodyRatioThreshold, setBodyRatioThreshold] = useState(0.50);
  const [enforceDiscountPremiumGate, setEnforceDiscountPremiumGate] = useState(true);

  // 3-Stage Harvest & Risk Controls
  const [entryMode, setEntryMode] = useState<SweepReclaimEntryMode>("FVG_PROXIMAL");
  const [stage1Multiple, setStage1Multiple] = useState(1.0);
  const [stage2Multiple, setStage2Multiple] = useState(1.4);
  const [stage3Multiple, setStage3Multiple] = useState(3.0);
  const [enableStructuralTrail, setEnableStructuralTrail] = useState(true);
  const [enableProfitRatchet, setEnableProfitRatchet] = useState(true);

  // Structural Pivot Lookbacks
  const [lookbackMajor, setLookbackMajor] = useState(10);
  const [lookbackInternal, setLookbackInternal] = useState(5);
  const [maxBarsAnchorToSweep, setMaxBarsAnchorToSweep] = useState(25);
  const [maxBarsSweepToReclaim, setMaxBarsSweepToReclaim] = useState(10);
  const [maxBarsToRetest, setMaxBarsToRetest] = useState(20);
  const [minSweepDepthAtr, setMinSweepDepthAtr] = useState(0.10);
  const [slBufferAtr, setSlBufferAtr] = useState(0.12);

  // Table Filter States
  const [filterDirection, setFilterDirection] = useState<string>("ALL");
  const [filterAnchor, setFilterAnchor] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterOutcome, setFilterOutcome] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Inspector Modal State
  const [inspectedSetup, setInspectedSetup] = useState<SweepReclaimSetup | null>(null);

  // Quick Preset Handlers for Date Range
  const setQuickDateRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    const cairoFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
    setEndDate(cairoFormatter.format(end));
    setStartDate(cairoFormatter.format(start));
  };

  const toggleAnchorGroup = (key: string) => {
    setEnabledAnchors((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const resolvedAnchorTypes = useMemo(() => {
    const types: SweepReclaimAnchorType[] = [];
    if (enabledAnchors.SWING_PIVOT) types.push("SWING_PIVOT");
    if (enabledAnchors.ASIAN) {
      types.push("ASIAN_HIGH", "ASIAN_LOW");
    }
    if (enabledAnchors.LONDON) {
      types.push("LONDON_HIGH", "LONDON_LOW");
    }
    if (enabledAnchors.DAILY) {
      types.push("PDH", "PDL");
    }
    return types;
  }, [enabledAnchors]);

  // Current config representation for preset saving
  const currentSweepReclaimConfig: SweepReclaimPresetConfig = useMemo(() => ({
    symbol,
    timeframe,
    anchorTypes: resolvedAnchorTypes,
    lookbackMajor,
    lookbackInternal,
    maxBarsAnchorToSweep,
    maxBarsSweepToReclaim,
    maxBarsToRetest,
    volumeSmaPeriod,
    volumeExpansionThreshold,
    deltaDominanceThreshold,
    bodyRatioThreshold,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate,
    stage1Multiple,
    stage2Multiple,
    stage3Multiple,
    entryMode,
    enableStructuralTrail,
    enableProfitRatchet,
    minSweepDepthAtrMultiplier: minSweepDepthAtr,
    slBufferAtrMultiplier: slBufferAtr,
  }), [
    symbol,
    timeframe,
    resolvedAnchorTypes,
    lookbackMajor,
    lookbackInternal,
    maxBarsAnchorToSweep,
    maxBarsSweepToReclaim,
    maxBarsToRetest,
    volumeSmaPeriod,
    volumeExpansionThreshold,
    deltaDominanceThreshold,
    bodyRatioThreshold,
    enforceDiscountPremiumGate,
    stage1Multiple,
    stage2Multiple,
    stage3Multiple,
    entryMode,
    enableStructuralTrail,
    enableProfitRatchet,
    minSweepDepthAtr,
    slBufferAtr,
  ]);

  const handleApplyPreset = (preset: ScannerPreset) => {
    if (preset.strategyType !== 'SWEEP_RECLAIM') return;
    const cfg = preset.config as SweepReclaimPresetConfig;

    if (cfg.symbol) setSymbol(cfg.symbol);
    if (cfg.timeframe) setTimeframe(cfg.timeframe as "5m" | "15m" | "1h" | "4h");
    if (cfg.entryMode) setEntryMode(cfg.entryMode);
    if (typeof cfg.volumeSmaPeriod === 'number') setVolumeSmaPeriod(cfg.volumeSmaPeriod);
    if (typeof cfg.volumeExpansionThreshold === 'number') setVolumeExpansionThreshold(cfg.volumeExpansionThreshold);
    if (typeof cfg.deltaDominanceThreshold === 'number') setDeltaDominanceThreshold(cfg.deltaDominanceThreshold);
    if (typeof cfg.bodyRatioThreshold === 'number') setBodyRatioThreshold(cfg.bodyRatioThreshold);
    if (typeof cfg.enforceDiscountPremiumGate === 'boolean') setEnforceDiscountPremiumGate(cfg.enforceDiscountPremiumGate);
    if (typeof cfg.stage1Multiple === 'number') setStage1Multiple(cfg.stage1Multiple);
    if (typeof cfg.stage2Multiple === 'number') setStage2Multiple(cfg.stage2Multiple);
    if (typeof cfg.stage3Multiple === 'number') setStage3Multiple(cfg.stage3Multiple);
    if (typeof cfg.enableStructuralTrail === 'boolean') setEnableStructuralTrail(cfg.enableStructuralTrail);
    if (typeof cfg.enableProfitRatchet === 'boolean') setEnableProfitRatchet(cfg.enableProfitRatchet);
    if (typeof cfg.lookbackMajor === 'number') setLookbackMajor(cfg.lookbackMajor);
    if (typeof cfg.lookbackInternal === 'number') setLookbackInternal(cfg.lookbackInternal);
    if (typeof cfg.maxBarsAnchorToSweep === 'number') setMaxBarsAnchorToSweep(cfg.maxBarsAnchorToSweep);
    if (typeof cfg.maxBarsSweepToReclaim === 'number') setMaxBarsSweepToReclaim(cfg.maxBarsSweepToReclaim);
    if (typeof cfg.maxBarsToRetest === 'number') setMaxBarsToRetest(cfg.maxBarsToRetest);
    if (typeof cfg.minSweepDepthAtrMultiplier === 'number') setMinSweepDepthAtr(cfg.minSweepDepthAtrMultiplier);
    if (typeof cfg.slBufferAtrMultiplier === 'number') setSlBufferAtr(cfg.slBufferAtrMultiplier);

    if (Array.isArray(cfg.anchorTypes)) {
      setEnabledAnchors({
        SWING_PIVOT: cfg.anchorTypes.includes('SWING_PIVOT'),
        ASIAN: cfg.anchorTypes.some((a) => a.startsWith('ASIAN')),
        LONDON: cfg.anchorTypes.some((a) => a.startsWith('LONDON')),
        DAILY: cfg.anchorTypes.includes('PDH') || cfg.anchorTypes.includes('PDL'),
      });
    }
  };

  const handleStartScan = () => {
    onRunScan({
      scan_name: scanName,
      scanName,
      symbol,
      timeframe,
      start_date: startDate,
      startDate,
      end_date: endDate,
      endDate,
      anchorTypes: resolvedAnchorTypes,
      anchor_types: resolvedAnchorTypes,
      lookbackMajor,
      lookback_major: lookbackMajor,
      lookbackInternal,
      lookback_internal: lookbackInternal,
      maxBarsAnchorToSweep,
      max_bars_anchor_to_sweep: maxBarsAnchorToSweep,
      maxBarsSweepToReclaim,
      max_bars_sweep_to_reclaim: maxBarsSweepToReclaim,
      maxBarsToRetest,
      max_bars_to_retest: maxBarsToRetest,
      volumeSmaPeriod,
      volume_sma_period: volumeSmaPeriod,
      volumeExpansionThreshold,
      volume_expansion_threshold: volumeExpansionThreshold,
      deltaDominanceThreshold,
      delta_dominance_threshold: deltaDominanceThreshold,
      bodyRatioThreshold,
      body_ratio_threshold: bodyRatioThreshold,
      requireThreePillarDisplacement: true,
      require_three_pillar_displacement: true,
      enforceDiscountPremiumGate,
      enforce_discount_premium_gate: enforceDiscountPremiumGate,
      stage1Multiple,
      stage1_multiple: stage1Multiple,
      stage2Multiple,
      stage2_multiple: stage2Multiple,
      stage3Multiple,
      stage3_multiple: stage3Multiple,
      entryMode,
      entry_mode: entryMode,
      enableStructuralTrail,
      enable_structural_trail: enableStructuralTrail,
      enableProfitRatchet,
      enable_profit_ratchet: enableProfitRatchet,
      minSweepDepthAtrMultiplier: minSweepDepthAtr,
      min_sweep_depth_atr: minSweepDepthAtr,
      slBufferAtrMultiplier: slBufferAtr,
      sl_buffer_atr: slBufferAtr,
    });
  };

  // Filtered Setups
  const filteredSetups = useMemo(() => {
    if (!selectedScan || !selectedScan.setups) return [];
    let list = selectedScan.setups;

    if (filterDirection !== "ALL") {
      list = list.filter((s) => s.type === filterDirection);
    }
    if (filterAnchor !== "ALL") {
      list = list.filter((s) => (s.anchor_type || "SWING_PIVOT") === filterAnchor);
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
          (s.anchor_name ? s.anchor_name.toLowerCase().includes(q) : false) ||
          (s.anchor_type ? s.anchor_type.toLowerCase().includes(q) : false) ||
          s.anchor_level.toString().includes(q) ||
          (s.sweep_price && s.sweep_price.toString().includes(q))
      );
    }

    return list;
  }, [selectedScan, filterDirection, filterAnchor, filterStatus, filterOutcome, searchQuery]);

  const paginatedSetups = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredSetups.slice(start, start + itemsPerPage);
  }, [filteredSetups, currentPage, itemsPerPage]);

  const totalPages = Math.max(1, Math.ceil(filteredSetups.length / itemsPerPage));
  const telemetry = selectedScan?.telemetry_summary;

  const executedSrTrades = useMemo(() => {
    return selectedScan?.setups ? adaptSweepReclaimSetupsToTrades(selectedScan.setups) : [];
  }, [selectedScan?.setups]);

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

        {/* Local-First Scanner Preset Control Deck */}
        <div className="mb-5">
          <ScannerPresetControlDeck
            strategyType="SWEEP_RECLAIM"
            currentConfig={currentSweepReclaimConfig}
            onApplyPreset={handleApplyPreset}
          />
        </div>

        {/* Form Inputs Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          {/* Scan Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-mono font-semibold text-slate-400">
              Scan Run Name
            </label>
            <input
              type="text"
              disabled={isScanning}
              value={scanName}
              onChange={(e) => setScanName(e.target.value)}
              className="text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-white"
            />
          </div>

          {/* Symbol */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-mono font-semibold text-slate-400">
              Asset Symbol
            </label>
            <select
              disabled={isScanning}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-white"
            >
              <option value="ETHUSDC">ETHUSDC (Binance Futures)</option>
              <option value="BTCUSDC">BTCUSDC (Binance Futures)</option>
              <option value="SOLUSDC">SOLUSDC (Binance Futures)</option>
            </select>
          </div>

          {/* Timeframe */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-mono font-semibold text-slate-400">
              Execution Timeframe
            </label>
            <select
              disabled={isScanning}
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as any)}
              className="text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-white"
            >
              <option value="5m">5m (Intraday Micro)</option>
              <option value="15m">15m (Primary Institutional)</option>
              <option value="1h">1h (Macro Structural)</option>
              <option value="4h">4h (HTF Swing)</option>
            </select>
          </div>

          {/* Date Range Start / End */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-mono font-semibold text-slate-400 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-cyan-400" />
                <span>Start Date</span>
              </label>
              <input
                type="date"
                disabled={isScanning}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="text-xs font-mono px-2 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-white"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-mono font-semibold text-slate-400 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-cyan-400" />
                <span>End Date</span>
              </label>
              <input
                type="date"
                disabled={isScanning}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="text-xs font-mono px-2 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-white"
              />
            </div>
          </div>
        </div>

        {/* Anchor Selection & Multi-Timeframe Toggles */}
        <div className="border-t border-slate-800/40 pt-4 mb-4">
          <label className="text-[10px] uppercase font-mono font-bold text-slate-400 mb-2.5 block flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>Multi-Timeframe Liquidity Anchor Sources:</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              disabled={isScanning}
              onClick={() => toggleAnchorGroup("SWING_PIVOT")}
              className={`px-3 py-2 rounded text-xs font-mono font-black border flex items-center justify-between transition ${enabledAnchors.SWING_PIVOT
                  ? "bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.4)]"
                  : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                }`}
            >
              <span>Major Pivots</span>
              {enabledAnchors.SWING_PIVOT && <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />}
            </button>

            <button
              type="button"
              disabled={isScanning}
              onClick={() => toggleAnchorGroup("ASIAN")}
              className={`px-3 py-2 rounded text-xs font-mono font-black border flex items-center justify-between transition ${enabledAnchors.ASIAN
                  ? "bg-amber-400 border-amber-300 text-slate-950 shadow-[0_0_10px_rgba(251,191,36,0.4)]"
                  : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                }`}
            >
              <span>Asian Session (H/L)</span>
              {enabledAnchors.ASIAN && <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />}
            </button>

            <button
              type="button"
              disabled={isScanning}
              onClick={() => toggleAnchorGroup("LONDON")}
              className={`px-3 py-2 rounded text-xs font-mono font-black border flex items-center justify-between transition ${enabledAnchors.LONDON
                  ? "bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.4)]"
                  : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                }`}
            >
              <span>London Session (H/L)</span>
              {enabledAnchors.LONDON && <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />}
            </button>

            <button
              type="button"
              disabled={isScanning}
              onClick={() => toggleAnchorGroup("DAILY")}
              className={`px-3 py-2 rounded text-xs font-mono font-black border flex items-center justify-between transition ${enabledAnchors.DAILY
                  ? "bg-purple-400 border-purple-300 text-slate-950 shadow-[0_0_10px_rgba(192,132,252,0.4)]"
                  : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                }`}
            >
              <span>Previous Day (PDH/PDL)</span>
              {enabledAnchors.DAILY && <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />}
            </button>
          </div>
        </div>

        {/* 3-Pillar Displacement Gatekeeper & 3-Stage Harvest Parameters */}
        <div className="border-t border-slate-800/40 pt-4 mb-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {/* Pillar 1: Volume Ratio vs SMA */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-mono font-semibold text-slate-400 flex items-center justify-between">
                <span>P1: Volume Ratio</span>
                <span className="text-cyan-400 font-bold">{volumeExpansionThreshold.toFixed(2)}x</span>
              </label>
              <input
                type="range"
                min="1.0"
                max="2.5"
                step="0.05"
                disabled={isScanning}
                value={volumeExpansionThreshold}
                onChange={(e) => setVolumeExpansionThreshold(parseFloat(e.target.value))}
                className="w-full accent-cyan-400"
              />
              <span className="text-[9px] text-slate-500 font-mono">
                Min volume vs {volumeSmaPeriod}-period SMA
              </span>
            </div>

            {/* Pillar 2: Taker Delta Dominance Threshold */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-mono font-semibold text-slate-400 flex items-center justify-between">
                <span>P2: Delta Dominance</span>
                <span className="text-cyan-400 font-bold">{deltaDominanceThreshold.toFixed(1)}%</span>
              </label>
              <input
                type="range"
                min="50.0"
                max="75.0"
                step="0.5"
                disabled={isScanning}
                value={deltaDominanceThreshold}
                onChange={(e) => setDeltaDominanceThreshold(parseFloat(e.target.value))}
                className="w-full accent-cyan-400"
              />
              <span className="text-[9px] text-slate-500 font-mono">
                Min directional taker delta %
              </span>
            </div>

            {/* Pillar 3: Candle Body-to-Range Ratio */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-mono font-semibold text-slate-400 flex items-center justify-between">
                <span>P3: Body-to-Range</span>
                <span className="text-cyan-400 font-bold">{(bodyRatioThreshold * 100).toFixed(0)}%</span>
              </label>
              <input
                type="range"
                min="0.30"
                max="0.80"
                step="0.05"
                disabled={isScanning}
                value={bodyRatioThreshold}
                onChange={(e) => setBodyRatioThreshold(parseFloat(e.target.value))}
                className="w-full accent-cyan-400"
              />
              <span className="text-[9px] text-slate-500 font-mono">
                Min body ratio |c - o| / (h - l)
              </span>
            </div>

            {/* Volume SMA Period */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-mono font-semibold text-slate-400 flex items-center justify-between">
                <span>Volume SMA Period</span>
                <span className="text-cyan-400 font-bold">{volumeSmaPeriod} bars</span>
              </label>
              <input
                type="range"
                min="7"
                max="50"
                step="1"
                disabled={isScanning}
                value={volumeSmaPeriod}
                onChange={(e) => setVolumeSmaPeriod(parseInt(e.target.value, 10))}
                className="w-full accent-cyan-400"
              />
              <span className="text-[9px] text-slate-500 font-mono">
                Baseline SMA lookback window
              </span>
            </div>

            {/* Entry Mode */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-mono font-semibold text-slate-400">
                Retest Entry Model
              </label>
              <select
                disabled={isScanning}
                value={entryMode}
                onChange={(e) => setEntryMode(e.target.value as SweepReclaimEntryMode)}
                className="text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-white"
              >
                <option value="SWEEP_OB_MT">Sweep OB 50% Mean Threshold (MT)</option>
                <option value="OB_PROXIMAL">Sweep OB Proximal Boundary</option>
                <option value="FVG_CE">Displacement FVG 50% CE</option>
                <option value="FVG_PROXIMAL">Displacement FVG Proximal Edge</option>
                <option value="FVG_DISTAL">Displacement FVG Distal Edge</option>
                <option value="OTE_62">62% OTE Fibonacci Retracement</option>
                <option value="SHELF_LEVEL">Reclaimed Anchor Shelf Level</option>
                <option value="RECLAIM_LEVEL">Reclaimed Horizontal Level (Explicit)</option>
              </select>
              <span className="text-[9px] text-slate-500 font-mono">
                {getEntryModeDescription(entryMode)}
              </span>
            </div>

            {/* Stage 2 Multiple Target */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-mono font-semibold text-slate-400">
                Stage 2 Tranche Target
              </label>
              <select
                disabled={isScanning}
                value={stage2Multiple}
                onChange={(e) => setStage2Multiple(parseFloat(e.target.value))}
                className="text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-white"
              >
                <option value={1.3}>1.3R (Fast Scalp)</option>
                <option value={1.4}>1.4R (Quant Champion Target)</option>
                <option value={1.5}>1.5R (Institutional Standard)</option>
                <option value={1.6}>1.6R (Refined Sniper Target)</option>
                <option value={1.8}>1.8R (Extended)</option>
                <option value={2.0}>2.0R (Full Macro)</option>
              </select>
              <span className="text-[9px] text-slate-500 font-mono">
                Tranche 1: 40% @ 1.0R | Tranche 3: 20% DOL
              </span>
            </div>
          </div>
        </div>

        {/* Execution & Trigger Button */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-slate-800/40">
          <div className="flex flex-wrap items-center gap-4 text-slate-400 text-xs font-mono">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                disabled={isScanning}
                checked={enableStructuralTrail}
                onChange={(e) => setEnableStructuralTrail(e.target.checked)}
                className="rounded accent-cyan-400"
              />
              <span>Structural Trailing SL (FVG CE)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                disabled={isScanning}
                checked={enableProfitRatchet}
                onChange={(e) => setEnableProfitRatchet(e.target.checked)}
                className="rounded accent-cyan-400"
              />
              <span>+1.0R Profit Ratchet Floor</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                disabled={isScanning}
                checked={enforceDiscountPremiumGate}
                onChange={(e) => setEnforceDiscountPremiumGate(e.target.checked)}
                className="rounded accent-cyan-400"
              />
              <span>Discount/Premium Valuation Gate</span>
            </label>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={handleStartScan}
              disabled={isScanning || resolvedAnchorTypes.length === 0}
              className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-mono font-bold text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isScanning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                  <span>EXECUTING QUANT SCAN...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 text-slate-950 fill-current" />
                  <span>RUN SWEEP & RECLAIM SCAN</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live SSE Scanning Progress HUD */}
        {isScanning && (
          <div className="mt-5 p-4 rounded-lg bg-cyan-950/30 border border-cyan-500/30 font-mono">
            <div className="flex items-center justify-between text-xs text-cyan-300 font-bold mb-2">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span>{progress?.phase || "RUNNING SCAN"}</span>
              </span>
              <span>{progress?.candlesFetched ? `${progress.candlesFetched} Candles Loaded` : ""}</span>
            </div>
            <p className="text-[11px] text-slate-300 mb-2">{progress?.message || statusMsg}</p>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 animate-pulse w-full" />
            </div>
          </div>
        )}
      </section>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 2. TELEMETRY & 3-STAGE HARVEST PERFORMANCE HUD                       */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {telemetry && (
        <section className="flex flex-col gap-4">
          {/* Top Metric Cards Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {/* Total Anchors */}
            <div className="p-3.5 rounded-lg border border-slate-800/60 bg-slate-900/40 backdrop-blur-sm">
              <span className="text-[9px] uppercase font-mono text-slate-500 block mb-1">
                Anchors Detected
              </span>
              <span className="text-lg font-mono font-bold text-white">
                {telemetry.total_anchors_detected ?? 0}
              </span>
              <span className="text-[9px] font-mono text-cyan-400/80 block mt-0.5">
                {telemetry.total_sweeps_detected ?? 0} Swept ({telemetry.sweep_rate_pct ?? 0}%)
              </span>
            </div>

            {/* Reclaim Rate */}
            <div className="p-3.5 rounded-lg border border-slate-800/60 bg-slate-900/40 backdrop-blur-sm">
              <span className="text-[9px] uppercase font-mono text-slate-500 block mb-1">
                Reclaim Rate
              </span>
              <span className="text-lg font-mono font-bold text-emerald-400">
                {telemetry.reclaim_rate_pct ?? 0}%
              </span>
              <span className="text-[9px] font-mono text-slate-400 block mt-0.5">
                {telemetry.total_reclaims_confirmed ?? 0} Reclaims
              </span>
            </div>

            {/* Retest Win Rate */}
            <div className="p-3.5 rounded-lg border border-slate-800/60 bg-slate-900/40 backdrop-blur-sm">
              <span className="text-[9px] uppercase font-mono text-slate-500 block mb-1">
                Retest Win Rate
              </span>
              <span className="text-lg font-mono font-bold text-cyan-400">
                {telemetry.retest_win_rate_pct ?? 0}%
              </span>
              <span className="text-[9px] font-mono text-slate-400 block mt-0.5">
                {telemetry.total_winning_trades ?? 0}W / {telemetry.total_losing_trades ?? 0}L ({telemetry.total_retests_executed ?? 0} Retests)
              </span>
            </div>

            {/* Realized R:R */}
            <div className="p-3.5 rounded-lg border border-slate-800/60 bg-slate-900/40 backdrop-blur-sm">
              <span className="text-[9px] uppercase font-mono text-slate-500 block mb-1">
                Avg Realized R:R
              </span>
              <span className={`text-lg font-mono font-bold ${(telemetry.avg_realized_rr ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {(telemetry.avg_realized_rr ?? 0) > 0 ? "+" : ""}{telemetry.avg_realized_rr ?? 0}R
              </span>
              <span className="text-[9px] font-mono text-slate-400 block mt-0.5">
                Win: +{telemetry.avg_winning_rr ?? 0}R
              </span>
            </div>

            {/* Profit Factor */}
            <div className="p-3.5 rounded-lg border border-slate-800/60 bg-slate-900/40 backdrop-blur-sm">
              <span className="text-[9px] uppercase font-mono text-slate-500 block mb-1">
                Profit Factor
              </span>
              <span className="text-lg font-mono font-bold text-purple-400">
                {(telemetry.profit_factor ?? 0) >= 99 ? "99.9+" : (telemetry.profit_factor ?? 0).toFixed(2)}
              </span>
              <span className="text-[9px] font-mono text-slate-400 block mt-0.5">
                Gross Win / Loss Ratio
              </span>
            </div>

            {/* Expected Value E[R] */}
            <div className="p-3.5 rounded-lg border border-slate-800/60 bg-slate-900/40 backdrop-blur-sm">
              <span className="text-[9px] uppercase font-mono text-slate-500 block mb-1">
                Expected Value E[R]
              </span>
              <span className={`text-lg font-mono font-bold ${(telemetry.expected_value_r ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {(telemetry.expected_value_r ?? 0) > 0 ? "+" : ""}{telemetry.expected_value_r ?? 0}R
              </span>
              <span className="text-[9px] font-mono text-slate-400 block mt-0.5">
                Per Retest Trade
              </span>
            </div>
          </div>

          {/* 3-Stage Harvest Distribution & Funnel Visuals */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* 4-Phase Conversion Funnel */}
            <div className="lg:col-span-6 p-4 rounded-lg border border-slate-800/60 bg-slate-900/30 font-mono">
              <h3 className="text-xs uppercase font-bold text-slate-300 mb-3 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Repeat className="w-3.5 h-3.5 text-cyan-400" />
                  <span>4-Phase Conversion Funnel</span>
                </span>
                <span className="text-[10px] text-slate-500">Zero Look-Ahead Parity</span>
              </h3>

              <div className="flex flex-col gap-2.5 text-xs">
                {/* Phase 1: Anchors */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400 font-semibold">1. Anchor Shelves</span>
                    <span className="text-white font-bold">{telemetry.total_anchors_detected ?? 0} (100%)</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-slate-400 w-full" />
                  </div>
                </div>

                {/* Phase 2: Sweeps */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400 font-semibold">2. Liquidity Sweeps</span>
                    <span className="text-amber-400 font-bold">{telemetry.total_sweeps_detected ?? 0} ({telemetry.sweep_rate_pct ?? 0}%)</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full"
                      style={{ width: `${Math.min(100, telemetry.sweep_rate_pct ?? 0)}%` }}
                    />
                  </div>
                </div>

                {/* Phase 3: Volumetric Reclaims */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400 font-semibold">3. Volumetric Reclaims</span>
                    <span className="text-emerald-400 font-bold">{telemetry.total_reclaims_confirmed ?? 0} ({telemetry.reclaim_rate_pct ?? 0}%)</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 rounded-full"
                      style={{ width: `${Math.min(100, telemetry.reclaim_rate_pct ?? 0)}%` }}
                    />
                  </div>
                </div>

                {/* Phase 4: Retests Executed */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400 font-semibold">4. Retest Executions</span>
                    <span className="text-cyan-400 font-bold">{telemetry.total_retests_executed ?? 0} ({telemetry.retest_rate_pct ?? 0}%)</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-400 rounded-full"
                      style={{ width: `${Math.min(100, telemetry.retest_rate_pct ?? 0)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 3-Stage Harvest Tranche Distributions */}
            <div className="lg:col-span-6 p-4 rounded-lg border border-slate-800/60 bg-slate-900/30 font-mono">
              <h3 className="text-xs uppercase font-bold text-slate-300 mb-3 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5 text-purple-400" />
                  <span>3-Stage Harvest Tranche Distributions</span>
                </span>
                <span className="text-[10px] text-purple-400">Position Scaling 40 / 40 / 20</span>
              </h3>

              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                {/* Stage 1 */}
                <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-[8px] uppercase text-slate-500 block">Stage 1 (40% @ 1.0R)</span>
                  <span className="text-base font-bold text-cyan-300">{telemetry.stage1_fill_count ?? 0}</span>
                  <span className="text-[9px] text-slate-400 block">{telemetry.stage1_fill_pct ?? 0}% Fills</span>
                </div>

                {/* Stage 2 */}
                <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-[8px] uppercase text-slate-500 block">Stage 2 (40% @ 1.5R)</span>
                  <span className="text-base font-bold text-purple-300">{telemetry.stage2_fill_count ?? 0}</span>
                  <span className="text-[9px] text-slate-400 block">{telemetry.stage2_fill_pct ?? 0}% Fills</span>
                </div>

                {/* Stage 3 */}
                <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-[8px] uppercase text-slate-500 block">Stage 3 (20% DOL)</span>
                  <span className="text-base font-bold text-emerald-300">{telemetry.stage3_fill_count ?? 0}</span>
                  <span className="text-[9px] text-slate-400 block">{telemetry.stage3_fill_pct ?? 0}% Fills</span>
                </div>
              </div>

              {/* Scratches vs Full Wins */}
              <div className="flex items-center justify-between text-[10px] pt-2 border-t border-slate-800/40 text-slate-400">
                <span>BE Scratches: <strong className="text-white">{telemetry.total_be_scratches ?? 0}</strong></span>
                <span>Structural Scratches: <strong className="text-white">{telemetry.total_structural_scratches ?? 0}</strong></span>
                <span>Full TP Wins: <strong className="text-emerald-400">{(telemetry.full_tp2_wins ?? 0) + (telemetry.full_tp3_wins ?? 0)}</strong></span>
                <span>Stopped: <strong className="text-rose-400">{telemetry.stopped_out_count ?? 0}</strong></span>
              </div>
            </div>

            {/* 3-Pillar Volumetric Displacement Gatekeeper & Liquidity Metrics */}
            <div className="lg:col-span-12 p-4 rounded-lg border border-slate-800/60 bg-slate-900/30 font-mono">
              <h3 className="text-xs uppercase font-bold text-slate-300 mb-3 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-cyan-400" />
                  <span>3-Pillar Institutional Displacement & Valuation Telemetry</span>
                </span>
                <span className="text-[10px] text-cyan-400">Volumetric Conviction Standard</span>
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-center">
                {/* Pillar 1 */}
                <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-[8px] uppercase text-slate-500 block">Pillar 1: Vol &ge; {volumeExpansionThreshold.toFixed(2)}x</span>
                  <span className="text-sm font-bold text-cyan-300">{telemetry.pillar1_volume_passed_count ?? telemetry.pillar1_pass_count ?? 0}</span>
                  <span className="text-[9px] text-slate-400 block">{telemetry.pillar1_pass_pct ?? 0}% Passed</span>
                </div>

                {/* Pillar 2 */}
                <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-[8px] uppercase text-slate-500 block">Pillar 2: Delta &ge; {deltaDominanceThreshold.toFixed(0)}%</span>
                  <span className="text-sm font-bold text-cyan-300">{telemetry.pillar2_delta_passed_count ?? telemetry.pillar2_pass_count ?? 0}</span>
                  <span className="text-[9px] text-slate-400 block">{telemetry.pillar2_pass_pct ?? 0}% Passed</span>
                </div>

                {/* Pillar 3 */}
                <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-[8px] uppercase text-slate-500 block">Pillar 3: Body &ge; {(bodyRatioThreshold * 100).toFixed(0)}%</span>
                  <span className="text-sm font-bold text-cyan-300">{telemetry.pillar3_body_passed_count ?? telemetry.pillar3_pass_count ?? 0}</span>
                  <span className="text-[9px] text-slate-400 block">{telemetry.pillar3_pass_pct ?? 0}% Passed</span>
                </div>

                {/* All 3 Pillars */}
                <div className="p-2.5 rounded bg-cyan-950/30 border border-cyan-500/40">
                  <span className="text-[8px] uppercase text-cyan-400 block font-bold">3-Pillars All Pass</span>
                  <span className="text-sm font-bold text-cyan-300">{telemetry.three_pillar_all_passed_count ?? telemetry.three_pillar_all_pass_count ?? 0}</span>
                  <span className="text-[9px] text-cyan-400/80 block">{telemetry.three_pillar_all_pass_pct ?? 0}% Confirmed</span>
                </div>

                {/* Wick Rejection */}
                <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-[8px] uppercase text-slate-500 block">Wick Rejection Sweeps</span>
                  <span className="text-sm font-bold text-amber-300">{telemetry.wick_rejection_sweep_count ?? 0}</span>
                  <span className="text-[9px] text-slate-400 block">{telemetry.wick_rejection_sweep_pct ?? 0}% Sweeps</span>
                </div>

                {/* Valuation Aligned */}
                <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-[8px] uppercase text-slate-500 block">Discount/Premium Aligned</span>
                  <span className="text-sm font-bold text-purple-300">{telemetry.discount_premium_aligned_count ?? 0}</span>
                  <span className="text-[9px] text-slate-400 block">{telemetry.discount_premium_aligned_pct ?? 0}% Aligned</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 2.5 CAPITAL GROWTH & CHRONOLOGICAL EQUITY LEDGER                    */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {selectedScan && (
        <CapitalGrowthLedger
          trades={executedSrTrades}
          totalMonitoredCount={telemetry?.total_anchors_detected}
          monitoredLabel="Anchors"
          title={`SWEEP & RECLAIM COMPOUNDING LEDGER • ${selectedScan.symbol} (${selectedScan.timeframe})`}
          subtitle={`Sequential path-dependent walk across ${executedSrTrades.length} executed retest trades from ${selectedScan.scan_name}.`}
        />
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 3. FILTERABLE DATA TABLE & EXPORT CONTROLS                          */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {selectedScan && (
        <section className="border border-slate-800/50 bg-slate-900/30 backdrop-blur-sm rounded-lg p-5">
          {/* Table Header Controls */}
          <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 mb-4 border-b border-slate-800/50 gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xs uppercase tracking-widest text-slate-300 font-mono font-bold flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-cyan-400" />
                <span>Detected Setups Ledger ({filteredSetups.length})</span>
              </h2>

              {/* Direction Filter */}
              <select
                value={filterDirection}
                onChange={(e) => {
                  setFilterDirection(e.target.value);
                  setCurrentPage(1);
                }}
                className="text-[11px] font-mono px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-300 focus:border-cyan-500/50 outline-none"
              >
                <option value="ALL">All Directions</option>
                <option value="BULLISH">Bullish (SSL Sweeps)</option>
                <option value="BEARISH">Bearish (BSL Sweeps)</option>
              </select>

              {/* Anchor Filter */}
              <select
                value={filterAnchor}
                onChange={(e) => {
                  setFilterAnchor(e.target.value);
                  setCurrentPage(1);
                }}
                className="text-[11px] font-mono px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-300 focus:border-cyan-500/50 outline-none"
              >
                <option value="ALL">All Anchors</option>
                <option value="SWING_PIVOT">Major Pivots</option>
                <option value="ASIAN_HIGH">Asian High</option>
                <option value="ASIAN_LOW">Asian Low</option>
                <option value="LONDON_HIGH">London High</option>
                <option value="LONDON_LOW">London Low</option>
                <option value="PDH">Previous Day High</option>
                <option value="PDL">Previous Day Low</option>
              </select>

              {/* Status Filter */}
              <select
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="text-[11px] font-mono px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-300 focus:border-cyan-500/50 outline-none"
              >
                <option value="ALL">All Statuses</option>
                <option value="RETESTED">Retested & Executed</option>
                <option value="RECLAIMED_NO_RETEST">Reclaimed (No Retest)</option>
                <option value="SWEPT_NO_RECLAIM">Swept Only</option>
                <option value="INVALIDATED_AT_RETEST">Invalidated at Retest</option>
              </select>

              {/* Outcome Filter */}
              <select
                value={filterOutcome}
                onChange={(e) => {
                  setFilterOutcome(e.target.value);
                  setCurrentPage(1);
                }}
                className="text-[11px] font-mono px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-300 focus:border-cyan-500/50 outline-none"
              >
                <option value="ALL">All Outcomes</option>
                <option value="FULL_TP3_WIN">Full TP3 (DOL Runner)</option>
                <option value="FULL_TP2_WIN">Full TP2 (+1.5R Win)</option>
                <option value="BE_SCRATCH_WIN">BE / Structural Scratch</option>
                <option value="STOPPED_OUT">Stopped Out (-1.0R)</option>
                <option value="NO_RETEST">No Retest</option>
              </select>
            </div>

            {/* Search & Export Buttons */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search ID / Price / Anchor..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="text-xs font-mono pl-8 pr-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-white placeholder:text-slate-600 focus:border-cyan-500/50 outline-none w-44"
                />
              </div>

              <button
                onClick={onExportJson}
                className="px-2.5 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-mono text-[11px] flex items-center gap-1.5 transition"
                title="Export JSON Dataset"
              >
                <Download className="w-3.5 h-3.5" />
                <span>JSON</span>
              </button>

              <button
                onClick={onExportCsv}
                className="px-2.5 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-mono text-[11px] flex items-center gap-1.5 transition"
                title="Export CSV Dataset"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
            </div>
          </div>

          {/* Setups Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-500 uppercase text-[9px] tracking-wider">
                  <th className="py-2.5 px-3">Setup / Direction</th>
                  <th className="py-2.5 px-3">Anchor Reference</th>
                  <th className="py-2.5 px-3">Sweep Depth</th>
                  <th className="py-2.5 px-3">Reclaim Volumetrics</th>
                  <th className="py-2.5 px-3">Retest Entry</th>
                  <th className="py-2.5 px-3">Outcome</th>
                  <th className="py-2.5 px-3 text-right">Realized R:R</th>
                  <th className="py-2.5 px-3 text-center">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {paginatedSetups.map((setup, idx) => {
                  const isBull = setup.type === "BULLISH";
                  const isWin = setup.simulated_outcome === "FULL_TP3_WIN" || setup.simulated_outcome === "FULL_TP2_WIN";
                  const isScratch = setup.simulated_outcome === "BE_SCRATCH_WIN" || setup.simulated_outcome === "STRUCTURAL_SCRATCH";

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
                            className={`p-1 rounded text-[9px] font-bold ${isBull
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                              }`}
                          >
                            {isBull ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          </span>
                          <div className="flex flex-col">
                            <span className="font-bold text-white text-[11px]">{setup.type}</span>
                            <span className="text-[9px] text-cyan-400 font-mono">
                              {formatCairoDateTime(setup.retest_time || setup.reclaim_time || setup.anchor_time)} (Cairo)
                            </span>
                            <span className="text-[8px] text-slate-500 truncate max-w-[120px]">{setup.id}</span>
                          </div>
                        </div>
                      </td>

                      {/* Anchor Reference */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded w-fit ${(setup.anchor_type || "").includes("ASIAN")
                              ? "bg-amber-950/60 text-amber-300 border border-amber-500/30"
                              : (setup.anchor_type || "").includes("LONDON")
                                ? "bg-blue-950/60 text-blue-300 border border-blue-500/30"
                                : (setup.anchor_type || "").includes("PD")
                                  ? "bg-purple-950/60 text-purple-300 border border-purple-500/30"
                                  : "bg-slate-800 text-slate-300"
                            }`}>
                            {(setup.anchor_type || setup.anchor_swing_grade || "SWING PIVOT").replace(/_/g, " ")}
                          </span>
                          <span className="text-white font-bold mt-0.5">${setup.anchor_level.toFixed(2)}</span>
                        </div>
                      </td>

                      {/* Sweep Depth */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {setup.sweep_price ? (
                          <div className="flex flex-col">
                            <span className="text-slate-300 font-bold">${setup.sweep_price.toFixed(2)}</span>
                            <span className="text-[9px] text-amber-400/90">
                              {setup.sweep_depth ? `-${setup.sweep_depth.toFixed(2)} (${setup.sweep_depth_pct}%)` : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Reclaim Volumetrics */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {setup.is_reclaimed ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <span className="text-[8px] px-1 rounded bg-cyan-950/50 text-cyan-300 border border-cyan-500/30 font-bold">
                                Delta: {setup.reclaim_delta_dominance_pct}%
                              </span>
                              <span className="text-[8px] px-1 rounded bg-slate-800 text-slate-300 font-bold">
                                Body: {setup.reclaim_body_ratio}%
                              </span>
                            </div>
                            <span className="text-[9px] text-slate-400">
                              Close: ${setup.reclaim_close_price?.toFixed(2)} {setup.reclaim_fvg_ce ? `(CE: $${setup.reclaim_fvg_ce.toFixed(2)})` : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-600">No Reclaim</span>
                        )}
                      </td>

                      {/* Retest Entry */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {setup.is_retested ? (
                          <div className="flex flex-col">
                            <span className="text-emerald-400 font-bold">${setup.entry_price.toFixed(2)}</span>
                            <span className="text-[9px] text-slate-500">
                              SL: ${setup.stop_loss.toFixed(2)} (Risk: ${setup.risk_usd.toFixed(2)})
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-600">No Retest</span>
                        )}
                      </td>

                      {/* Outcome Badge */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${isWin
                            ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/30"
                            : isScratch
                              ? "bg-cyan-950/80 text-cyan-300 border border-cyan-500/30"
                              : setup.simulated_outcome === "STOPPED_OUT"
                                ? "bg-rose-950/80 text-rose-300 border border-rose-500/30"
                                : "bg-slate-800 text-slate-400"
                          }`}>
                          {setup.simulated_outcome.replace(/_/g, " ")}
                        </span>
                      </td>

                      {/* Realized R:R */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <span className={`font-bold ${setup.realized_rr > 0 ? "text-emerald-400" : setup.realized_rr < 0 ? "text-rose-400" : "text-slate-400"}`}>
                          {setup.realized_rr > 0 ? "+" : ""}{setup.realized_rr}R
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectedSetup(setup);
                          }}
                          className="p-1 rounded bg-slate-800/80 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-400 transition"
                          title="Inspect Setup Lifecycle"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {filteredSetups.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between pt-4 mt-4 border-t border-slate-800/80 gap-3 text-xs font-mono text-slate-400">
              {/* Left: Summary & Rows Per Page */}
              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
                <span>
                  Showing <span className="font-bold text-slate-100">{(currentPage - 1) * itemsPerPage + 1}</span>–<span className="font-bold text-slate-100">{Math.min(currentPage * itemsPerPage, filteredSetups.length)}</span> of <span className="font-bold text-slate-100">{filteredSetups.length}</span> setups
                </span>

                {/* Rows per page selector */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">Rows:</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => {
                      const nextLimit = Number(e.target.value);
                      setItemsPerPage(nextLimit);
                      setCurrentPage(1);
                    }}
                    className="bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded px-2 py-0.5 focus:outline-none focus:border-cyan-500 cursor-pointer transition shadow-sm"
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
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(1)}
                  className="p-1.5 rounded bg-slate-900 border border-slate-800 hover:border-cyan-500/50 disabled:opacity-30 disabled:hover:border-slate-800 text-slate-300 hover:text-cyan-400 transition cursor-pointer disabled:cursor-not-allowed shadow-sm"
                  title="First Page (Jump to Start)"
                >
                  <ChevronsLeft className="w-3.5 h-3.5" />
                </button>

                {/* Previous Page */}
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="p-1.5 rounded bg-slate-900 border border-slate-800 hover:border-cyan-500/50 disabled:opacity-30 disabled:hover:border-slate-800 text-slate-300 hover:text-cyan-400 transition cursor-pointer disabled:cursor-not-allowed shadow-sm"
                  title="Previous Page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                {/* Select Page Dropdown */}
                <div className="flex items-center">
                  <select
                    value={currentPage}
                    onChange={(e) => setCurrentPage(Number(e.target.value))}
                    className="bg-slate-900 border border-slate-800 text-slate-100 font-bold text-xs rounded px-2 py-1 focus:outline-none focus:border-cyan-500 cursor-pointer transition shadow-sm"
                  >
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                      <option key={pageNum} value={pageNum}>
                        Page {pageNum} of {totalPages}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Next Page */}
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="p-1.5 rounded bg-slate-900 border border-slate-800 hover:border-cyan-500/50 disabled:opacity-30 disabled:hover:border-slate-800 text-slate-300 hover:text-cyan-400 transition cursor-pointer disabled:cursor-not-allowed shadow-sm"
                  title="Next Page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>

                {/* Jump to Last Page */}
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                  className="p-1.5 rounded bg-slate-900 border border-slate-800 hover:border-cyan-500/50 disabled:opacity-30 disabled:hover:border-slate-800 text-slate-300 hover:text-cyan-400 transition cursor-pointer disabled:cursor-not-allowed shadow-sm"
                  title="Last Page (Jump to End)"
                >
                  <ChevronsRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 4. SETUP INSPECTOR MODAL (4-Phase Lifecycle Deep Dive)             */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {inspectedSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl font-mono relative max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
              <div className="flex items-center gap-2.5">
                <span
                  className={`p-1.5 rounded-md font-bold text-xs ${inspectedSetup.type === "BULLISH"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                    }`}
                >
                  {inspectedSetup.type === "BULLISH" ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                </span>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>{inspectedSetup.anchor_name || `${inspectedSetup.anchor_swing_grade || "MAJOR"} Pivot ($${inspectedSetup.anchor_level.toFixed(2)})`}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/30">
                      {inspectedSetup.simulated_outcome.replace(/_/g, " ")}
                    </span>
                  </h3>
                  <span className="text-[10px] text-slate-500">{inspectedSetup.id}</span>
                </div>
              </div>

              <button
                onClick={() => setInspectedSetup(null)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 4-Phase Progress Timeline Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              {/* Phase 1: Anchor */}
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Phase 1: Anchor Reference</span>
                  </span>
                  <span className="text-[9px] text-cyan-400 font-bold">{inspectedSetup.anchor_type || inspectedSetup.anchor_swing_grade || "SWING_PIVOT"}</span>
                </div>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Anchor Price:</span>
                    <span className="text-white font-bold">${inspectedSetup.anchor_level.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Anchor Time (Cairo):</span>
                    <span className="text-slate-300">{formatCairoDateTime(inspectedSetup.anchor_time)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Color Locked:</span>
                    <span className={inspectedSetup.anchor_color_validated ? "text-emerald-400" : "text-slate-400"}>
                      {inspectedSetup.anchor_color_validated ? "PASSED" : "N/A"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Phase 2: Sweep */}
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Phase 2: Liquidity Purge</span>
                  </span>
                  <span className="text-[9px] text-amber-400 font-bold">
                    {inspectedSetup.bars_anchor_to_sweep} Bars Post-Anchor
                  </span>
                </div>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Sweep Extreme:</span>
                    <span className="text-white font-bold">
                      {inspectedSetup.sweep_price ? `$${inspectedSetup.sweep_price.toFixed(2)}` : "None"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Sweep Time (Cairo):</span>
                    <span className="text-slate-300">{formatCairoDateTime(inspectedSetup.sweep_time)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Purge Depth:</span>
                    <span className="text-amber-400">
                      {inspectedSetup.sweep_depth ? `$${inspectedSetup.sweep_depth.toFixed(2)} (${inspectedSetup.sweep_depth_pct}%)` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Volume Ratio:</span>
                    <span className="text-slate-300">{inspectedSetup.sweep_volume_ratio ?? 1}x SMA</span>
                  </div>
                </div>
              </div>

              {/* Phase 3: Volumetric Reclaim */}
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Phase 3: Volumetric Reclaim</span>
                  </span>
                  <span className="text-[9px] text-emerald-400 font-bold">
                    {inspectedSetup.is_reclaimed ? "CONFIRMED" : "FAILED"}
                  </span>
                </div>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Close Price:</span>
                    <span className="text-white font-bold">
                      {inspectedSetup.reclaim_close_price ? `$${inspectedSetup.reclaim_close_price.toFixed(2)}` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Reclaim Time (Cairo):</span>
                    <span className="text-slate-300">{formatCairoDateTime(inspectedSetup.reclaim_time)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Taker Delta Dominance:</span>
                    <span className="text-cyan-300 font-bold">{inspectedSetup.reclaim_delta_dominance_pct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Candle Body Ratio:</span>
                    <span className="text-white font-bold">{inspectedSetup.reclaim_body_ratio}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Displacement FVG CE:</span>
                    <span className="text-purple-300 font-bold">
                      {inspectedSetup.reclaim_fvg_ce ? `$${inspectedSetup.reclaim_fvg_ce.toFixed(2)}` : "None"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Phase 4: 3-Stage Harvest Execution */}
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />
                    <span>Phase 4: 3-Stage Harvest</span>
                  </span>
                  <span className="text-[9px] text-purple-400 font-bold">
                    {inspectedSetup.is_retested ? "EXECUTED" : "UNTESTED"}
                  </span>
                </div>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Entry Price ({getEntryModeLabel(inspectedSetup.entry_mode)}):</span>
                    <span className="text-emerald-400 font-bold">${inspectedSetup.entry_price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Execution Time (Cairo):</span>
                    <span className="text-slate-300">{formatCairoDateTime(inspectedSetup.retest_time || inspectedSetup.reclaim_time)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Stop Loss:</span>
                    <span className="text-rose-400 font-bold">${inspectedSetup.stop_loss.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Realized R:R:</span>
                    <span className={`font-bold ${inspectedSetup.realized_rr > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {inspectedSetup.realized_rr > 0 ? "+" : ""}{inspectedSetup.realized_rr}R
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Trailing Stop Source:</span>
                    <span className="text-cyan-300">{inspectedSetup.trailing_sl_source}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tranche Scaling Targets Progress */}
            <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 mb-5">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-2">
                Tranche Target Ladder
              </span>
              <div className="grid grid-cols-3 gap-3 text-center text-xs">
                <div className={`p-2 rounded border ${inspectedSetup.is_stage1_filled ? "bg-cyan-950/40 border-cyan-500/40 text-cyan-300" : "bg-slate-900 border-slate-800 text-slate-500"}`}>
                  <span className="text-[9px] block">Stage 1 (40% @ 1.0R)</span>
                  <strong className="block mt-0.5">${inspectedSetup.stage1_target.toFixed(2)}</strong>
                  <span className="text-[8px]">{inspectedSetup.is_stage1_filled ? "FILLED ✓" : "UNREACHED"}</span>
                </div>

                <div className={`p-2 rounded border ${inspectedSetup.is_stage2_filled ? "bg-purple-950/40 border-purple-500/40 text-purple-300" : "bg-slate-900 border-slate-800 text-slate-500"}`}>
                  <span className="text-[9px] block">Stage 2 (40% @ {inspectedSetup.stage2_multiple}R)</span>
                  <strong className="block mt-0.5">${inspectedSetup.stage2_target.toFixed(2)}</strong>
                  <span className="text-[8px]">{inspectedSetup.is_stage2_filled ? "FILLED ✓" : "UNREACHED"}</span>
                </div>

                <div className={`p-2 rounded border ${inspectedSetup.is_stage3_filled ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300" : "bg-slate-900 border-slate-800 text-slate-500"}`}>
                  <span className="text-[9px] block">Stage 3 (20% DOL)</span>
                  <strong className="block mt-0.5">${inspectedSetup.stage3_target.toFixed(2)}</strong>
                  <span className="text-[8px]">{inspectedSetup.is_stage3_filled ? "FILLED ✓" : "UNREACHED"}</span>
                </div>
              </div>
            </div>

            {/* Close Button */}
            <div className="flex justify-end">
              <button
                onClick={() => setInspectedSetup(null)}
                className="px-5 py-2 rounded bg-slate-800 hover:bg-slate-700 text-white font-mono text-xs transition"
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
