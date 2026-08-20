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
  TrendingUp,
  Layers,
  Shield,
  ShieldCheck,
  Zap,
  Filter,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  Sliders,
  Crosshair,
  ArrowUpRight,
  ArrowDownRight,
  Info,
  X,
  Search,
  Check,
  Repeat
} from "lucide-react";
import { QuantLabRun, QuantLabTrade } from "@/lib/chartLayers/types";
import { InstitutionalOrderBlock, OrderBlockTelemetrySummary } from "@/lib/quantEngine/OrderBlockEngine";
import {
  SweepReclaimSetup,
  SweepReclaimTelemetrySummary,
  SweepReclaimScanConfig
} from "@/lib/quantEngine/SweepReclaimEngine";
import { adaptOrderBlocksToTrades } from "@/lib/quantEngine/equityCalculator";
import CapitalGrowthLedger from "@/components/quantLab/CapitalGrowthLedger";
import SweepReclaimWorkspace from "@/components/quantLab/SweepReclaimWorkspace";
import SweepReclaimSidebarList from "@/components/quantLab/SweepReclaimSidebarList";
import SettingsModal from "@/components/modals/SettingsModal";

export interface StoredSrScan {
  id: string;
  scan_name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_detected: number;
  sweep_rate_pct: number;
  reclaim_rate_pct: number;
  retest_rate_pct: number;
  retest_win_rate_pct: number;
  avg_realized_rr: number;
  profit_factor: number;
  telemetry_summary: SweepReclaimTelemetrySummary;
  setups: SweepReclaimSetup[];
  created_at: string;
}

export interface StoredObScan {
  id: string;
  scan_name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_detected: number;
  validation_rate_pct: number;
  mt_reaction_rate_pct: number;
  mitigation_win_rate_pct: number;
  avg_rr_tp1: number;
  avg_rr_tp2: number;
  telemetry_summary: OrderBlockTelemetrySummary;
  order_blocks: InstitutionalOrderBlock[];
  created_at: string;
}

export default function QuantLabPage() {
  // --- Workspace Mode Switcher ---
  const [activeMainTab, setActiveMainTab] = useState<'SWEEP_RECLAIM_SCANNER' | 'OB_SCANNER' | 'STRATEGY_BACKTEST'>('SWEEP_RECLAIM_SCANNER');
  const [isSoundSettingsOpen, setIsSoundSettingsOpen] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────────
  // 0. SWEEP & RECLAIM SCANNER STATES (New V16.16 Suite)
  // ─────────────────────────────────────────────────────────────────────────────
  const [srScansList, setSrScansList] = useState<StoredSrScan[]>([]);
  const [selectedSrScan, setSelectedSrScan] = useState<StoredSrScan | null>(null);
  const [loadingSrScans, setLoadingSrScans] = useState(false);

  const [srScanning, setSrScanning] = useState(false);
  const [srStatusMsg, setSrStatusMsg] = useState("");
  const [srProgress, setSrProgress] = useState<{
    phase: string;
    message: string;
    candlesFetched?: number;
    detectedCount?: number;
  } | null>(null);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. STRATEGY BACKTEST STATES (Legacy V15 Suite)
  // ─────────────────────────────────────────────────────────────────────────────
  const [runs, setRuns] = useState<QuantLabRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<QuantLabRun | null>(null);
  const [trades, setTrades] = useState<QuantLabTrade[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingTrades, setLoadingTrades] = useState(false);

  const [strategyName, setStrategyName] = useState("Institutional FVG Sniper");
  const [startDate, setStartDate] = useState("2026-04-01");
  const [endDate, setEndDate] = useState("2026-05-20");
  const [strategyConfigText, setStrategyConfigText] = useState(
    JSON.stringify(
      {
        name: "Institutional FVG Sniper",
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

  const [backtestRunning, setBacktestRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [backtestProgress, setBacktestProgress] = useState<{
    date: string;
    equity: number;
    tradeCount: number;
  } | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const tradesPerPage = 10;

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. DEEP ORDER BLOCK SCANNER STATES (New V16 Suite)
  // ─────────────────────────────────────────────────────────────────────────────
  const [obScanName, setObScanName] = useState("Deep Macro OB Backtest Scan");
  const [obSymbol, setObSymbol] = useState("ETHUSDC");
  const [obTimeframe, setObTimeframe] = useState<"5m" | "15m" | "1h" | "4h">("15m");
  const [obStartDate, setObStartDate] = useState("2026-03-01");
  const [obEndDate, setObEndDate] = useState("2026-06-01");
  const [obMinTier, setObMinTier] = useState<"ALL" | "A_PLUS_ONLY" | "A_AND_A_PLUS">("ALL");
  const [obStrictTierAPlus, setObStrictTierAPlus] = useState(false);
  const [obMaxBarsToMitigation, setObMaxBarsToMitigation] = useState(24);
  const [obEnableBreakerSim, setObEnableBreakerSim] = useState(true);
  const [obMaxBreakerRetestBars, setObMaxBreakerRetestBars] = useState(20);
  const [obEnableDynamicMgmt, setObEnableDynamicMgmt] = useState(true);
  const [obTp1Multiple, setObTp1Multiple] = useState(1.0);
  const [obTp2Multiple, setObTp2Multiple] = useState(1.5);
  const [obPositionScalingMode, setObPositionScalingMode] = useState<"THREE_STAGE_HARVEST" | "TWO_STAGE_DYNAMIC" | "SINGLE_STAGE">("THREE_STAGE_HARVEST");
  const [obTp1Ratio, setObTp1Ratio] = useState(0.40);
  const [obTp2Ratio, setObTp2Ratio] = useState(0.40);
  const [obTp3Ratio, setObTp3Ratio] = useState(0.20);
  const [obTrailingStopMode, setObTrailingStopMode] = useState<"STRUCTURAL_FVG_TRAIL" | "STATIC_BREAKEVEN">("STRUCTURAL_FVG_TRAIL");
  const [obTrailingBuffer, setObTrailingBuffer] = useState(0.05);
  const [obDynamicDolTp2Scaling, setObDynamicDolTp2Scaling] = useState(true);
  const [obAdaptiveBreakerConfirmation, setObAdaptiveBreakerConfirmation] = useState(true);
  const [obRequireBreakerConfirmation, setObRequireBreakerConfirmation] = useState(true);
  const [obRequireBreakerDOL, setObRequireBreakerDOL] = useState(true);
  const [obRequireBreakerVolumetric, setObRequireBreakerVolumetric] = useState(true);
  const [obBreakerSessionFilter, setObBreakerSessionFilter] = useState<"ALL" | "NY_AND_LONDON" | "NY_ONLY" | "LONDON_ONLY">("ALL");
  const [obAggregateConsecutive, setObAggregateConsecutive] = useState(true);
  const [obMaxConsecutive, setObMaxConsecutive] = useState(5);
  const [obEntryMode, setObEntryMode] = useState<"BOUNDARY" | "MEAN_THRESHOLD">("BOUNDARY");
  const [obTargetRr, setObTargetRr] = useState(2.5);

  const [obScansList, setObScansList] = useState<StoredObScan[]>([]);
  const [selectedObScan, setSelectedObScan] = useState<StoredObScan | null>(null);
  const [loadingObScans, setLoadingObScans] = useState(false);

  const [obScanning, setObScanning] = useState(false);
  const [obStatusMsg, setObStatusMsg] = useState("");
  const [obProgress, setObProgress] = useState<{
    phase: string;
    message: string;
    candlesFetched?: number;
    detectedCount?: number;
  } | null>(null);

  // OB Table Filter States
  const [obFilterDirection, setObFilterDirection] = useState<string>("ALL");
  const [obFilterTier, setObFilterTier] = useState<string>("ALL");
  const [obFilterStatus, setObFilterStatus] = useState<string>("ALL");
  const [obFilterOutcome, setObFilterOutcome] = useState<string>("ALL");
  const [obSearchQuery, setObSearchQuery] = useState("");

  const [obCurrentPage, setObCurrentPage] = useState(1);
  const obsPerPage = 12;

  // OB Inspector Modal / Drawer
  const [inspectedOb, setInspectedOb] = useState<InstitutionalOrderBlock | null>(null);

  // ─────────────────────────────────────────────────────────────────────────────
  // Data Fetching: Strategy Runs & OB Scans
  // ─────────────────────────────────────────────────────────────────────────────

  const loadSrScanDetail = useCallback(async (scanId: string) => {
    try {
      const res = await fetch(`/api/quant-lab/sr-scans?id=${scanId}`, { credentials: "same-origin" });
      if (res.ok) {
        const json = await res.json();
        if (json.scan) {
          setSelectedSrScan(json.scan);
        }
      }
    } catch (err) {
      console.error("Failed to fetch full SR scan detail:", err);
    }
  }, []);

  const loadObScanDetail = useCallback(async (scanId: string) => {
    try {
      const res = await fetch(`/api/quant-lab/ob-scans?id=${scanId}`, { credentials: "same-origin" });
      if (res.ok) {
        const json = await res.json();
        if (json.scan) {
          setSelectedObScan(json.scan);
        }
      }
    } catch (err) {
      console.error("Failed to fetch full OB scan detail:", err);
    }
  }, []);

  const handleSelectSrScan = useCallback(async (scan: StoredSrScan) => {
    setSelectedSrScan(scan);
    if (!scan.setups || scan.setups.length === 0) {
      await loadSrScanDetail(scan.id);
    }
  }, [loadSrScanDetail]);

  const handleSelectObScan = useCallback(async (scan: StoredObScan) => {
    setSelectedObScan(scan);
    if (!scan.order_blocks || scan.order_blocks.length === 0) {
      await loadObScanDetail(scan.id);
    }
  }, [loadObScanDetail]);

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await fetch("/api/quant-lab/runs", { credentials: "same-origin" });
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

  const fetchSrScans = useCallback(async () => {
    setLoadingSrScans(true);
    try {
      const res = await fetch("/api/quant-lab/sr-scans", { credentials: "same-origin" });
      if (res.ok) {
        const json = await res.json();
        setSrScansList(json.scans || []);
        if (!selectedSrScan && json.scans && json.scans.length > 0) {
          loadSrScanDetail(json.scans[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch S&R scans:", err);
    } finally {
      setLoadingSrScans(false);
    }
  }, [selectedSrScan, loadSrScanDetail]);

  const fetchObScans = useCallback(async () => {
    setLoadingObScans(true);
    try {
      const res = await fetch("/api/quant-lab/ob-scans", { credentials: "same-origin" });
      if (res.ok) {
        const json = await res.json();
        setObScansList(json.scans || []);
        // Auto-select first scan if none selected
        if (!selectedObScan && json.scans && json.scans.length > 0) {
          loadObScanDetail(json.scans[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch OB scans:", err);
    } finally {
      setLoadingObScans(false);
    }
  }, [selectedObScan, loadObScanDetail]);

  useEffect(() => {
    fetchRuns();
    fetchObScans();
    fetchSrScans();
  }, [fetchRuns, fetchObScans, fetchSrScans]);

  const fetchTradesForRun = useCallback(async (runId: string) => {
    setLoadingTrades(true);
    try {
      const res = await fetch(`/api/quant-lab/trades?run_id=${runId}`, { credentials: "same-origin" });
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

  const handleSelectRun = async (run: QuantLabRun) => {
    setSelectedRun(run);
    fetchTradesForRun(run.id);
    if (!run.strategy_config) {
      try {
        const res = await fetch(`/api/quant-lab/runs?id=${run.id}`, { credentials: "same-origin" });
        if (res.ok) {
          const json = await res.json();
          if (json.run) {
            setSelectedRun(json.run);
          }
        }
      } catch (err) {
        console.error("Failed to fetch full run detail:", err);
      }
    }
  };

  const handleDeleteRun = async (e: React.MouseEvent, runId: string) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this historical backtest run? All trade records will be lost.")) {
      return;
    }
    try {
      const res = await fetch(`/api/quant-lab/runs?id=${runId}`, { method: "DELETE" });
      if (res.ok) {
        setRuns(prev => prev.filter(r => r.id !== runId));
        if (selectedRun?.id === runId) {
          setSelectedRun(null);
          setTrades([]);
        }
      }
    } catch (err) {
      console.error("Failed to delete run:", err);
    }
  };

  const handleDeleteObScan = async (e: React.MouseEvent, scanId: string) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this historical Order Block scan?")) {
      return;
    }
    try {
      const res = await fetch(`/api/quant-lab/ob-scans?id=${scanId}`, { method: "DELETE" });
      if (res.ok) {
        setObScansList(prev => prev.filter(s => s.id !== scanId));
        if (selectedObScan?.id === scanId) {
          setSelectedObScan(null);
        }
      }
    } catch (err) {
      console.error("Failed to delete OB scan:", err);
    }
  };

  const handleDeleteSrScan = async (e: React.MouseEvent, scanId: string) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this historical Sweep & Reclaim scan?")) {
      return;
    }
    try {
      const res = await fetch(`/api/quant-lab/sr-scans?id=${scanId}`, { method: "DELETE" });
      if (res.ok) {
        setSrScansList(prev => prev.filter(s => s.id !== scanId));
        if (selectedSrScan?.id === scanId) {
          setSelectedSrScan(null);
        }
      }
    } catch (err) {
      console.error("Failed to delete S&R scan:", err);
    }
  };

  const runSweepReclaimScan = async (config: SweepReclaimScanConfig & { scan_name: string; start_date: string; end_date: string }) => {
    if (srScanning) return;
    setSrScanning(true);
    setSrProgress(null);
    setSrStatusMsg("Connecting to historical data ingestion pipeline...");

    try {
      const response = await fetch("/api/quant-lab/sweep-reclaim-scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (!response.body) {
        throw new Error("Failed to initialize SSE stream.");
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
                setSrStatusMsg(payload.message);
              } else if (payload.type === "progress") {
                setSrProgress({
                  phase: payload.phase,
                  message: payload.message,
                  candlesFetched: payload.candlesFetched,
                  detectedCount: payload.detectedCount,
                });
              } else if (payload.type === "complete") {
                setSrStatusMsg("Sweep & Reclaim scanning and 4-phase backtesting complete!");
                setSrScansList(prev => [payload.scan, ...prev]);
                setSelectedSrScan(payload.scan);
                setSrScanning(false);
                setSrProgress(null);
              } else if (payload.type === "error") {
                setSrStatusMsg(`Scan Failed: ${payload.error}`);
                setSrScanning(false);
              }
            } catch (jsonErr) {
              console.error("SSE parse error:", jsonErr);
            }
          }
        }
      }
    } catch (err: any) {
      console.error("S&R Scan stream failed:", err);
      setSrStatusMsg(`Network Error: ${err.message}`);
      setSrScanning(false);
    }
  };

  // Quick Preset Handlers for Date Range
  const setQuickDateRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setObEndDate(end.toISOString().slice(0, 10));
    setObStartDate(start.toISOString().slice(0, 10));
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // OB Scanning Execution (SSE Stream)
  // ─────────────────────────────────────────────────────────────────────────────

  const runOrderBlockScan = async () => {
    if (obScanning) return;
    setObScanning(true);
    setObProgress(null);
    setObStatusMsg("Connecting to historical data ingestion pipeline...");

    try {
      const response = await fetch("/api/quant-lab/ob-scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scan_name: obScanName,
          symbol: obSymbol,
          timeframe: obTimeframe,
          start_date: obStartDate,
          end_date: obEndDate,
          min_quality_tier: obMinTier,
          strict_tier_a_plus: obStrictTierAPlus,
          max_bars_to_mitigation: obMaxBarsToMitigation,
          enable_breaker_simulation: obEnableBreakerSim,
          max_breaker_retest_bars: obMaxBreakerRetestBars,
          enable_dynamic_management: obEnableDynamicMgmt,
          position_scaling_mode: obPositionScalingMode,
          tp1_ratio: obTp1Ratio,
          tp2_ratio: obTp2Ratio,
          tp3_ratio: obTp3Ratio,
          tp1_multiple: obTp1Multiple,
          tp2_multiple: obTp2Multiple,
          require_breaker_confirmation: obRequireBreakerConfirmation,
          require_breaker_dol: obRequireBreakerDOL,
          require_breaker_volumetric: obRequireBreakerVolumetric,
          breaker_session_filter: obBreakerSessionFilter,
          trailing_stop_mode: obTrailingStopMode,
          trailing_buffer: obTrailingBuffer,
          adaptive_breaker_confirmation: obAdaptiveBreakerConfirmation,
          dynamic_dol_tp2_scaling: obDynamicDolTp2Scaling,
          aggregate_consecutive: obAggregateConsecutive,
          max_consecutive_lookback: obMaxConsecutive,
          entry_mode: obEntryMode,
          target_rr: obTargetRr,
        })
      });

      if (!response.body) {
        throw new Error("Failed to initialize SSE stream.");
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
                setObStatusMsg(payload.message);
              } else if (payload.type === "progress") {
                setObProgress({
                  phase: payload.phase,
                  message: payload.message,
                  candlesFetched: payload.candlesFetched,
                  detectedCount: payload.detectedCount
                });
              } else if (payload.type === "complete") {
                setObStatusMsg("Order Block scanning and multi-gate filtering complete!");
                setObScansList(prev => [payload.scan, ...prev]);
                setSelectedObScan(payload.scan);
                setObScanning(false);
                setObProgress(null);
                setObCurrentPage(1);
              } else if (payload.type === "error") {
                setObStatusMsg(`Scan Failed: ${payload.error}`);
                setObScanning(false);
              }
            } catch (jsonErr) {
              console.error("SSE parse error:", jsonErr);
            }
          }
        }
      }
    } catch (err: any) {
      console.error("OB Scan stream failed:", err);
      setObStatusMsg(`Network Error: ${err.message}`);
      setObScanning(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Strategy Backtest Execution (SSE Stream)
  // ─────────────────────────────────────────────────────────────────────────────

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
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
          if (jsonObj.name) setStrategyName(jsonObj.name);
        } catch {
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
      if (parsed.name) setStrategyName(parsed.name);
    } catch (err: any) {
      setConfigError(`Syntax Error: ${err.message}`);
    }
  };

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

      if (!response.body) throw new Error("Backtest stream initialization failed.");

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
              console.error("Failed to parse SSE JSON:", jsonErr);
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Export Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  const handleExportSrJson = () => {
    if (!selectedSrScan) return;
    const exportPayload = {
      scan_metadata: {
        id: selectedSrScan.id,
        scan_name: selectedSrScan.scan_name,
        symbol: selectedSrScan.symbol,
        timeframe: selectedSrScan.timeframe,
        start_date: selectedSrScan.start_date.slice(0, 10),
        end_date: selectedSrScan.end_date.slice(0, 10),
        total_detected: selectedSrScan.total_detected,
        sweep_rate_pct: selectedSrScan.sweep_rate_pct,
        reclaim_rate_pct: selectedSrScan.reclaim_rate_pct,
        retest_rate_pct: selectedSrScan.retest_rate_pct,
        retest_win_rate_pct: selectedSrScan.retest_win_rate_pct,
        avg_realized_rr: selectedSrScan.avg_realized_rr,
        profit_factor: selectedSrScan.profit_factor,
      },
      telemetry: selectedSrScan.telemetry_summary,
      setups: selectedSrScan.setups,
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SWEEP_RECLAIM_${selectedSrScan.symbol}_${selectedSrScan.timeframe}_${selectedSrScan.id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportSrCsv = () => {
    if (!selectedSrScan || !selectedSrScan.setups) return;

    const headers = [
      "ID", "Type", "AnchorType", "AnchorName", "AnchorTime", "AnchorLevel",
      "SweepTime", "SweepPrice", "SweepDepthUsd", "SweepDepthPct", "WickRejectionSweep", "SweepOBMT",
      "ReclaimTime", "ReclaimClosePrice", "Pillar1VolPass", "Pillar2DeltaPass", "Pillar3BodyPass", "ThreePillarsAllPass",
      "DeltaDominancePct", "BodyRatioPct", "FvgCE", "DealingRangeEquilibrium", "ValuationAligned",
      "RetestTime", "EntryMode", "EntryPrice", "StopLoss", "Stage1Target", "Stage2Target", "Stage3Target",
      "BodyDefensePassed", "Outcome", "StageExitType", "RealizedRR", "MFE_R", "MAE_R",
      "TrailingSlSource", "ActiveTrailingSl", "BarsAnchorToSweep", "BarsSweepToReclaim", "BarsReclaimToRetest", "BarsToOutcome"
    ];

    const rows = selectedSrScan.setups.map((s) => [
      s.id,
      s.type,
      s.anchor_type,
      `"${s.anchor_name.replace(/"/g, '""')}"`,
      new Date(s.anchor_time).toISOString(),
      s.anchor_level,
      s.sweep_time ? new Date(s.sweep_time).toISOString() : "N/A",
      s.sweep_price ?? "N/A",
      s.sweep_depth ?? "N/A",
      s.sweep_depth_pct ?? "N/A",
      s.is_wick_rejection_sweep ? "YES" : "NO",
      s.sweep_ob_mt ?? "N/A",
      s.reclaim_time ? new Date(s.reclaim_time).toISOString() : "N/A",
      s.reclaim_close_price ?? "N/A",
      s.pillar1_volume_ratio_passed ? "PASS" : "FAIL",
      s.pillar2_delta_dominance_passed ? "PASS" : "FAIL",
      s.pillar3_body_ratio_passed ? "PASS" : "FAIL",
      s.three_pillar_displacement_passed ? "PASS" : "FAIL",
      s.reclaim_delta_dominance_pct ?? "N/A",
      s.reclaim_body_ratio ?? "N/A",
      s.reclaim_fvg_ce ?? "N/A",
      s.dealing_range_equilibrium ?? "N/A",
      s.is_valuation_aligned ? "ALIGNED" : "UNALIGNED",
      s.retest_time ? new Date(s.retest_time).toISOString() : "N/A",
      s.entry_mode ?? "FVG_CE",
      s.entry_price,
      s.stop_loss,
      s.stage1_target,
      s.stage2_target,
      s.stage3_target,
      s.body_defense_passed ? "PASS" : "FAIL",
      s.simulated_outcome,
      s.stage_exit_type ?? "N/A",
      s.realized_rr,
      s.mfe_r,
      s.mae_r,
      s.trailing_sl_source ?? "INITIAL",
      s.active_trailing_sl ?? s.stop_loss,
      s.bars_anchor_to_sweep ?? "N/A",
      s.bars_sweep_to_reclaim ?? "N/A",
      s.bars_reclaim_to_retest ?? "N/A",
      s.bars_to_outcome ?? "N/A",
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SWEEP_RECLAIM_TELEMETRY_${selectedSrScan.symbol}_${selectedSrScan.timeframe}_${selectedSrScan.id.slice(0, 8)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportValidatedObDataset = () => {
    if (!selectedObScan) return;
    const exportPayload = {
      scan_metadata: {
        id: selectedObScan.id,
        scan_name: selectedObScan.scan_name,
        symbol: selectedObScan.symbol,
        timeframe: selectedObScan.timeframe,
        start_date: selectedObScan.start_date.slice(0, 10),
        end_date: selectedObScan.end_date.slice(0, 10),
        total_detected: selectedObScan.total_detected,
        validation_rate_pct: selectedObScan.validation_rate_pct,
        mt_reaction_rate_pct: selectedObScan.mt_reaction_rate_pct,
        mitigation_win_rate_pct: selectedObScan.mitigation_win_rate_pct,
        avg_rr_tp1: selectedObScan.avg_rr_tp1,
        avg_rr_tp2: selectedObScan.avg_rr_tp2
      },
      telemetry: selectedObScan.telemetry_summary,
      order_blocks: selectedObScan.order_blocks
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `VALIDATED_ORDER_BLOCKS_${selectedObScan.symbol}_${selectedObScan.timeframe}_${selectedObScan.id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportObCsv = () => {
    if (!selectedObScan || !selectedObScan.order_blocks) return;

    const headers = [
      "ID", "Type", "OriginTime", "FormationTime", "Top", "Bottom", "MeanThreshold",
      "CandlesCount", "Tier", "ConfluenceScore", "Status", "SweepGate", "DisplacementGate",
      "StructureGate", "DealingRangeGate", "RetracementDepthPct", "Outcome", "RealizedRR"
    ];

    const rows = selectedObScan.order_blocks.map(ob => [
      ob.id,
      ob.type,
      new Date(ob.origin_time).toISOString(),
      new Date(ob.formation_time).toISOString(),
      ob.top,
      ob.bottom,
      ob.mean_threshold,
      ob.candles_count,
      ob.quality_tier,
      ob.confluence_score,
      ob.lifecycle_status,
      ob.gates.gate1_liquidity_sweep ? "PASS" : "FAIL",
      ob.gates.gate2_displacement_imbalance ? "PASS" : "FAIL",
      ob.gates.gate3_structure_break ? "PASS" : "FAIL",
      ob.gates.gate4_dealing_range ? "PASS" : "FAIL",
      ob.max_retracement_depth_pct ?? "N/A",
      ob.simulated_outcome,
      ob.realized_rr
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `OB_TELEMETRY_${selectedObScan.symbol}_${selectedObScan.timeframe}_${selectedObScan.id.slice(0, 8)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
      trade_records: trades
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `GEMINI_QUANT_LAB_${selectedRun.name.replace(/\s+/g, "_")}_${selectedRun.id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Order Block Filtered Slices & Pagination
  // ─────────────────────────────────────────────────────────────────────────────

  const filteredOrderBlocks = useMemo(() => {
    if (!selectedObScan || !selectedObScan.order_blocks) return [];
    let list = selectedObScan.order_blocks;

    if (obFilterDirection !== "ALL") {
      list = list.filter(ob => ob.type === obFilterDirection);
    }
    if (obFilterTier !== "ALL") {
      list = list.filter(ob => ob.quality_tier === obFilterTier);
    }
    if (obFilterStatus !== "ALL") {
      list = list.filter(ob => ob.lifecycle_status === obFilterStatus);
    }
    if (obFilterOutcome !== "ALL") {
      list = list.filter(ob => ob.simulated_outcome === obFilterOutcome);
    }
    if (obSearchQuery.trim()) {
      const q = obSearchQuery.toLowerCase();
      list = list.filter(ob =>
        ob.id.toLowerCase().includes(q) ||
        ob.type.toLowerCase().includes(q) ||
        ob.top.toString().includes(q) ||
        ob.bottom.toString().includes(q) ||
        ob.gates.sweep_type.toLowerCase().includes(q)
      );
    }

    return list;
  }, [selectedObScan, obFilterDirection, obFilterTier, obFilterStatus, obFilterOutcome, obSearchQuery]);

  const paginatedOrderBlocks = useMemo(() => {
    const start = (obCurrentPage - 1) * obsPerPage;
    return filteredOrderBlocks.slice(start, start + obsPerPage);
  }, [filteredOrderBlocks, obCurrentPage]);

  const totalObPages = Math.ceil(filteredOrderBlocks.length / obsPerPage);

  const executedObTrades = useMemo(() => {
    return selectedObScan?.order_blocks
      ? adaptOrderBlocksToTrades(selectedObScan.order_blocks)
      : [];
  }, [selectedObScan?.order_blocks]);

  const paginatedTrades = useMemo(() => {
    const start = (currentPage - 1) * tradesPerPage;
    return trades.slice(start, start + tradesPerPage);
  }, [trades, currentPage]);

  const totalPages = Math.ceil(trades.length / tradesPerPage);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 md:p-6 overflow-x-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800/50 pb-5 mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1 rounded bg-emerald-500/10 text-emerald-400">
              <LineChart className="w-5 h-5" />
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold font-mono">
              Quantitative Architecture & Backtesting
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black font-mono tracking-tight text-white uppercase">
            Quant <span className="text-emerald-400">Lab</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Deep historical scanning, multi-gate institutional validation, and zero look-ahead bias telemetry engine for Order Blocks & Custom Strategies.
          </p>
        </div>

        {/* Mode Switcher Tabs + Status */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-900/90 border border-slate-800 p-1 rounded-lg flex items-center gap-1 font-mono text-xs font-bold">
            <button
              onClick={() => setActiveMainTab('SWEEP_RECLAIM_SCANNER')}
              className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition ${
                activeMainTab === 'SWEEP_RECLAIM_SCANNER'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
              <span>SWEEP & RECLAIM SCANNER</span>
            </button>

            <button
              onClick={() => setActiveMainTab('OB_SCANNER')}
              className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition ${
                activeMainTab === 'OB_SCANNER'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>INSTITUTIONAL OB SCANNER</span>
            </button>

            <button
              onClick={() => setActiveMainTab('STRATEGY_BACKTEST')}
              className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition ${
                activeMainTab === 'STRATEGY_BACKTEST'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>STRATEGY BACKTEST</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden lg:flex flex-col text-right font-mono pr-3 border-r border-slate-800/50">
              <span className="text-[9px] text-slate-500 uppercase">Engine Node</span>
              <span className="text-xs text-emerald-400 font-bold flex items-center gap-1.5 justify-end">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                ONLINE [V{SYSTEM_VERSION}]
              </span>
            </div>

            <button
              onClick={() => setIsSoundSettingsOpen(true)}
              className="px-3 py-1.5 border border-purple-500/30 text-[10px] font-mono font-bold uppercase rounded bg-purple-950/20 text-purple-400 hover:bg-purple-950/40 hover:border-purple-400/50 transition cursor-pointer"
            >
              Command Center
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* LEFT SIDEBAR: Scan / Run History List                              */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <aside className="lg:col-span-4 flex flex-col gap-6">
          {activeMainTab === 'SWEEP_RECLAIM_SCANNER' ? (
            <SweepReclaimSidebarList
              scans={srScansList}
              selectedScan={selectedSrScan}
              onSelectScan={handleSelectSrScan}
              onDeleteScan={handleDeleteSrScan}
              loading={loadingSrScans}
            />
          ) : activeMainTab === 'OB_SCANNER' ? (
            // Historical OB Scans List
            <div className="border border-slate-800/50 bg-slate-900/30 backdrop-blur-sm rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs uppercase tracking-widest text-slate-400 font-mono font-bold flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Historical OB Scans</span>
                </h2>
                <span className="px-2 py-0.5 rounded text-[9px] bg-slate-800 text-slate-300 font-mono">
                  {obScansList.length} SCANS
                </span>
              </div>

              {loadingObScans ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500 font-mono text-xs">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Loading scan records...</span>
                </div>
              ) : obScansList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 border border-dashed border-slate-800 rounded-lg text-slate-500 font-mono text-[11px] text-center p-4">
                  <span>No Order Block scans recorded in database.</span>
                  <span className="text-[9px] text-slate-600 mt-1">Configure multi-month lookback parameters and run a deep scan.</span>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 max-h-[560px] overflow-y-auto pr-1">
                  {obScansList.map((scan) => {
                    const isSelected = selectedObScan?.id === scan.id;
                    const winRate = Number(scan.mitigation_win_rate_pct);
                    const validationRate = Number(scan.validation_rate_pct);

                    return (
                      <div
                        key={scan.id}
                        onClick={() => handleSelectObScan(scan)}
                        className={`group cursor-pointer border rounded-lg p-3.5 transition text-left flex flex-col justify-between ${
                          isSelected
                            ? "border-emerald-500/60 bg-emerald-950/15 shadow-sm shadow-emerald-500/10"
                            : "border-slate-800/60 bg-slate-900/40 hover:bg-slate-900/80 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-tight group-hover:text-emerald-400 transition">
                              {scan.scan_name}
                            </h3>
                            <span className="text-[9px] text-slate-500 font-mono flex items-center gap-1.5 mt-0.5">
                              <span className="text-emerald-400/90 font-bold">{scan.symbol}</span>
                              <span>•</span>
                              <span>{scan.timeframe} TF</span>
                              <span>•</span>
                              <span>{scan.start_date.slice(0, 10)} to {scan.end_date.slice(0, 10)}</span>
                            </span>
                          </div>
                          <button
                            onClick={(e) => handleDeleteObScan(e, scan.id)}
                            className="text-slate-600 hover:text-rose-400 p-1 rounded hover:bg-rose-950/20 transition opacity-0 group-hover:opacity-100 focus:opacity-100"
                            title="Delete Scan Record"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-4 gap-1.5 border-t border-slate-800/40 pt-2.5 mt-1 font-mono text-[9px] text-center">
                          <div className="flex flex-col">
                            <span className="text-slate-500 uppercase text-[8px]">OBs</span>
                            <span className="font-bold text-slate-200">{scan.total_detected}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-slate-500 uppercase text-[8px]">Valid %</span>
                            <span className="font-bold text-emerald-400">{validationRate.toFixed(0)}%</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-slate-500 uppercase text-[8px]">MT React</span>
                            <span className="font-bold text-slate-300">{Number(scan.mt_reaction_rate_pct).toFixed(0)}%</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-slate-500 uppercase text-[8px]">Win Rate</span>
                            <span className={`font-bold ${winRate >= 50 ? "text-emerald-400" : "text-rose-400"}`}>
                              {winRate.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            // Historical Strategy Runs List (Strategy Mode)
            <div className="border border-slate-800/50 bg-slate-900/30 backdrop-blur-sm rounded-lg p-5">
              <h2 className="text-xs uppercase tracking-widest text-slate-400 font-mono font-bold mb-4 flex items-center justify-between">
                <span>Historical Strategy Runs</span>
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
                <div className="flex flex-col items-center justify-center py-12 border border-dashed border-slate-800 rounded-lg text-slate-500 font-mono text-[11px] text-center p-4">
                  <span>No strategy runs recorded in database.</span>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 max-h-[560px] overflow-y-auto pr-1">
                  {runs.map((run) => {
                    const isSelected = selectedRun?.id === run.id;
                    const isPositive = Number(run.total_pnl) >= 0;
                    return (
                      <div
                        key={run.id}
                        onClick={() => handleSelectRun(run)}
                        className={`group cursor-pointer border rounded-lg p-3.5 transition text-left flex flex-col justify-between ${
                          isSelected
                            ? "border-emerald-500/50 bg-emerald-950/10"
                            : "border-slate-800/40 bg-slate-900/20 hover:bg-slate-900/60"
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-tight group-hover:text-white transition">
                              {run.name}
                            </h3>
                            <span className="text-[9px] text-slate-500 font-mono">
                              {run.symbol} | {run.strategy_config?.conditions?.target_timeframe || "5m"}
                            </span>
                          </div>
                          <button
                            onClick={(e) => handleDeleteRun(e, run.id)}
                            className="text-slate-600 hover:text-rose-400 p-1 rounded hover:bg-rose-950/20 transition opacity-0 group-hover:opacity-100 focus:opacity-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between border-t border-slate-800/30 pt-2.5 mt-1 font-mono text-[10px]">
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
          )}
        </aside>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* RIGHT MAIN WORKSPACE                                               */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <main className="lg:col-span-8 flex flex-col gap-6">
          {activeMainTab === 'SWEEP_RECLAIM_SCANNER' ? (
            <SweepReclaimWorkspace
              scansList={srScansList}
              selectedScan={selectedSrScan}
              onSelectScan={handleSelectSrScan}
              isScanning={srScanning}
              statusMsg={srStatusMsg}
              progress={srProgress}
              onRunScan={runSweepReclaimScan}
              onExportJson={handleExportSrJson}
              onExportCsv={handleExportSrCsv}
            />
          ) : activeMainTab === 'OB_SCANNER' ? (
            // =================================================================
            // TAB 1: INSTITUTIONAL ORDER BLOCK SCANNER & FILTERING WORKSPACE
            // =================================================================
            <>
              {/* Scan Configuration Panel */}
              <section className="border border-slate-800/50 bg-slate-900/30 backdrop-blur-sm rounded-lg p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800/50 pb-4 mb-5 gap-3">
                  <h2 className="text-xs uppercase tracking-widest text-slate-300 font-mono font-bold flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-emerald-400" />
                    <span>Deep Historical OB Scanner Configuration</span>
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
                      disabled={obScanning}
                      value={obScanName}
                      onChange={(e) => setObScanName(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none rounded text-white"
                    />
                  </div>

                  {/* Symbol & Timeframe */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500">
                      Asset & Timeframe
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        disabled={obScanning}
                        value={obSymbol}
                        onChange={(e) => setObSymbol(e.target.value)}
                        className="text-xs font-mono px-2.5 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none rounded text-white"
                      >
                        <option value="ETHUSDC">ETHUSDC</option>
                        <option value="BTCUSDC">BTCUSDC</option>
                      </select>

                      <select
                        disabled={obScanning}
                        value={obTimeframe}
                        onChange={(e) => setObTimeframe(e.target.value as any)}
                        className="text-xs font-mono px-2.5 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none rounded text-emerald-400 font-bold"
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
                      disabled={obScanning}
                      value={obStartDate}
                      onChange={(e) => setObStartDate(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none rounded text-white"
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
                      disabled={obScanning}
                      value={obEndDate}
                      onChange={(e) => setObEndDate(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none rounded text-white"
                    />
                  </div>
                </div>

                {/* Advanced Quantitative Directives */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-slate-800/40 pt-4 mb-4">
                  {/* Consecutive Candle Aggregation */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Consecutive Aggregation</span>
                      <span className="text-[8px] text-emerald-400 font-bold">MACRO ZONES</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setObAggregateConsecutive(!obAggregateConsecutive)}
                      className={`w-full py-2 px-3 rounded font-mono text-[10px] font-bold border transition ${
                        obAggregateConsecutive
                          ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-400"
                          : "bg-slate-950 border-slate-800 text-slate-500"
                      }`}
                    >
                      {obAggregateConsecutive ? "ENABLED (2+ BARS)" : "DISABLED (1 BAR)"}
                    </button>
                  </div>

                  {/* Min Quality Tier Gate */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500">
                      Multi-Gate Filter Threshold
                    </label>
                    <select
                      value={obMinTier}
                      onChange={(e) => setObMinTier(e.target.value as any)}
                      className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none rounded text-white"
                    >
                      <option value="ALL">ALL DETECTED (A+, A, B, UNVALIDATED)</option>
                      <option value="A_AND_A_PLUS">HIGH CONFLUENCE (A & A+ ONLY)</option>
                      <option value="A_PLUS_ONLY">MAX RIGOR (A+ 4-GATE ONLY)</option>
                    </select>
                  </div>

                  {/* Entry Mode */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Precision Entry Mode</span>
                      <span className="text-[8px] text-cyan-400 font-bold">50% MT</span>
                    </label>
                    <select
                      value={obEntryMode}
                      onChange={(e) => setObEntryMode(e.target.value as any)}
                      className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none rounded text-cyan-300 font-bold"
                    >
                      <option value="BOUNDARY">OB Edge (Proximal Boundary)</option>
                      <option value="MEAN_THRESHOLD">Mean Threshold (50% Midpoint)</option>
                    </select>
                  </div>

                  {/* Target Reward Ratio */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500">
                      TP2 Runner Target (R:R)
                    </label>
                    <select
                      value={obTargetRr}
                      onChange={(e) => setObTargetRr(Number(e.target.value))}
                      className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none rounded text-slate-300"
                    >
                      <option value={1.5}>1:1.5 Target R:R</option>
                      <option value={2.0}>1:2.0 Target R:R</option>
                      <option value={2.5}>1:2.5 Target R:R</option>
                      <option value={3.0}>1:3.0 Target R:R</option>
                      <option value={4.0}>1:4.0 Target R:R</option>
                    </select>
                  </div>
                </div>

                {/* Phase 2 & 3 Institutional Execution & Trade Management Gates */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-slate-800/40 pt-4 mb-4">
                  {/* Freshness Window Limit */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>OB Freshness (Max Bars)</span>
                      <span className="text-[8px] text-amber-400 font-bold">{obMaxBarsToMitigation}B</span>
                    </label>
                    <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
                      {[12, 24, 48, 96].map(bars => (
                        <button
                          key={bars}
                          type="button"
                          onClick={() => setObMaxBarsToMitigation(bars)}
                          className={`py-1.5 rounded border font-bold transition ${
                            obMaxBarsToMitigation === bars
                              ? "bg-amber-950/40 border-amber-500/50 text-amber-300"
                              : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {bars}B
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Breaker Max Retest Bars (Phase 3) */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Breaker Expiry (Max Bars)</span>
                      <span className="text-[8px] text-purple-400 font-bold">{obMaxBreakerRetestBars}B</span>
                    </label>
                    <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
                      {[10, 20, 30, 50].map(bars => (
                        <button
                          key={bars}
                          type="button"
                          onClick={() => setObMaxBreakerRetestBars(bars)}
                          className={`py-1.5 rounded border font-bold transition ${
                            obMaxBreakerRetestBars === bars
                              ? "bg-purple-950/40 border-purple-500/50 text-purple-300"
                              : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {bars}B
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tier A+ Strict Execution Gate (Sweep Mandate) */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Tier A+ Sweep Mandate</span>
                      <span className="text-[8px] text-emerald-400 font-bold">SWEEP GATE</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setObStrictTierAPlus(!obStrictTierAPlus)}
                      className={`w-full py-1.5 px-2 rounded font-mono text-[10px] font-bold border transition ${
                        obStrictTierAPlus
                          ? "bg-emerald-950/50 border-emerald-500/60 text-emerald-300"
                          : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {obStrictTierAPlus ? "⭐ STRICT (GATE 1 REQUIRED)" : "STANDARD (ANY TIER)"}
                    </button>
                  </div>

                  {/* Dynamic Trade Management (TP1 + BE Trail) */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Dynamic TP1 / BE Trail</span>
                      <span className="text-[8px] text-cyan-400 font-bold">50% @ 1.0R</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setObEnableDynamicMgmt(!obEnableDynamicMgmt)}
                      className={`w-full py-1.5 px-2 rounded font-mono text-[10px] font-bold border transition ${
                        obEnableDynamicMgmt
                          ? "bg-cyan-950/50 border-cyan-500/60 text-cyan-300"
                          : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {obEnableDynamicMgmt ? "🛡️ ACTIVE (SCALE 50% & BE TRAIL)" : "OFF (ALL-OR-NOTHING)"}
                    </button>
                  </div>
                </div>

                {/* Phase 4 Institutional Breaker Confirmation & DOL Gates */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-slate-800/40 pt-4 mb-5">
                  {/* Micro MSS + FVG Confirmation Gate */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>In-Zone Micro MSS Gate</span>
                      <span className="text-[8px] text-purple-400 font-bold">REVERSAL SHIFT</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setObRequireBreakerConfirmation(!obRequireBreakerConfirmation)}
                      className={`w-full py-1.5 px-2 rounded font-mono text-[10px] font-bold border transition ${
                        obRequireBreakerConfirmation
                          ? "bg-purple-950/50 border-purple-500/60 text-purple-300"
                          : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {obRequireBreakerConfirmation ? "🎯 CONFIRMED (MSS + FVG REQUIRED)" : "BLIND (INSTANT TOUCH FILL)"}
                    </button>
                  </div>

                  {/* Draw on Liquidity (DOL) Gatekeeper */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Draw on Liquidity (DOL)</span>
                      <span className="text-[8px] text-emerald-400 font-bold">BSL/SSL TARGET</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setObRequireBreakerDOL(!obRequireBreakerDOL)}
                      className={`w-full py-1.5 px-2 rounded font-mono text-[10px] font-bold border transition ${
                        obRequireBreakerDOL
                          ? "bg-emerald-950/50 border-emerald-500/60 text-emerald-300"
                          : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {obRequireBreakerDOL ? "🧲 ACTIVE (MANDATE DOL TARGET)" : "OFF (STATIC R:R ONLY)"}
                    </button>
                  </div>

                  {/* Volumetric Sponsorship Gate */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Volumetric Sponsorship</span>
                      <span className="text-[8px] text-cyan-400 font-bold">DELTA & EXP</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setObRequireBreakerVolumetric(!obRequireBreakerVolumetric)}
                      className={`w-full py-1.5 px-2 rounded font-mono text-[10px] font-bold border transition ${
                        obRequireBreakerVolumetric
                          ? "bg-cyan-950/50 border-cyan-500/60 text-cyan-300"
                          : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {obRequireBreakerVolumetric ? "⚡ ACTIVE (TAKER DELTA ≥1.15x)" : "OFF (PRICE ONLY)"}
                    </button>
                  </div>

                  {/* Session Alignment Filter */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Session Alignment</span>
                      <span className="text-[8px] text-amber-400 font-bold">ICT MACROS</span>
                    </label>
                    <select
                      value={obBreakerSessionFilter}
                      onChange={(e) => setObBreakerSessionFilter(e.target.value as any)}
                      className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-purple-500/50 outline-none rounded text-slate-300"
                    >
                      <option value="ALL">All Trading Hours</option>
                      <option value="NY_AND_LONDON">NY & London Sessions Only</option>
                      <option value="NY_ONLY">New York Session (12-20 UTC)</option>
                      <option value="LONDON_ONLY">London Session (07-11 UTC)</option>
                    </select>
                  </div>
                </div>

                {/* Phase 5 Structural Trailing Stop & Expectancy Expansion Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-slate-800/40 pt-4 mb-5">
                  {/* Trailing Stop Mode (Breathing Room Model) */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Trailing Stop Mode</span>
                      <span className="text-[8px] text-cyan-400 font-bold">STAGE 2 TRAIL</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setObTrailingStopMode(obTrailingStopMode === "STRUCTURAL_FVG_TRAIL" ? "STATIC_BREAKEVEN" : "STRUCTURAL_FVG_TRAIL")}
                      className={`w-full py-1.5 px-2 rounded font-mono text-[10px] font-bold border transition ${
                        obTrailingStopMode === "STRUCTURAL_FVG_TRAIL"
                          ? "bg-cyan-950/50 border-cyan-500/60 text-cyan-300"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      {obTrailingStopMode === "STRUCTURAL_FVG_TRAIL" ? "🌊 STRUCTURAL FVG (BREATHING ROOM)" : "🔒 STATIC BREAKEVEN (0.0R)"}
                    </button>
                  </div>

                  {/* Dynamic DOL TP2 Scaling */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Dynamic DOL TP2 Scaling</span>
                      <span className="text-[8px] text-emerald-400 font-bold">EXPANSION</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setObDynamicDolTp2Scaling(!obDynamicDolTp2Scaling)}
                      className={`w-full py-1.5 px-2 rounded font-mono text-[10px] font-bold border transition ${
                        obDynamicDolTp2Scaling
                          ? "bg-emerald-950/50 border-emerald-500/60 text-emerald-300"
                          : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {obDynamicDolTp2Scaling ? "🚀 DOL SCALED TP2 (CAPTURE RUNNERS)" : "STATIC TP2 MULTIPLE"}
                    </button>
                  </div>

                  {/* Adaptive Breaker Confirmation */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Adaptive Breaker Gate</span>
                      <span className="text-[8px] text-purple-400 font-bold">FVG OR VOL EXP</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setObAdaptiveBreakerConfirmation(!obAdaptiveBreakerConfirmation)}
                      className={`w-full py-1.5 px-2 rounded font-mono text-[10px] font-bold border transition ${
                        obAdaptiveBreakerConfirmation
                          ? "bg-purple-950/50 border-purple-500/60 text-purple-300"
                          : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {obAdaptiveBreakerConfirmation ? "⚡ ADAPTIVE (FVG OR VOL ≥1.25x)" : "STRICT (FVG MANDATED)"}
                    </button>
                  </div>

                  {/* Trailing Buffer Offset */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Trail Buffer Offset</span>
                      <span className="text-[8px] text-amber-400 font-bold">±${obTrailingBuffer}</span>
                    </label>
                    <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
                      {[0.02, 0.05, 0.10, 0.20].map(buf => (
                        <button
                          key={buf}
                          type="button"
                          onClick={() => setObTrailingBuffer(buf)}
                          className={`py-1.5 rounded border font-bold transition ${
                            obTrailingBuffer === buf
                              ? "bg-amber-950/40 border-amber-500/50 text-amber-300"
                              : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {buf}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Phase 6 Multi-Stage Institutional Harvest & Position Runner Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-slate-800/40 pt-4 mb-5">
                  {/* Position Scaling Mode */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Scaling Architecture</span>
                      <span className="text-[8px] text-cyan-400 font-bold">3-STAGE TRANCHES</span>
                    </label>
                    <select
                      value={obPositionScalingMode}
                      onChange={(e) => setObPositionScalingMode(e.target.value as any)}
                      className="w-full text-xs font-mono px-3 py-2 bg-slate-950 border border-slate-800 focus:border-cyan-500/50 outline-none rounded text-cyan-300"
                    >
                      <option value="THREE_STAGE_HARVEST">🌾 3-Stage Harvest (40% / 40% / 20%)</option>
                      <option value="TWO_STAGE_DYNAMIC">⚖️ 2-Stage Dynamic (50% / 50%)</option>
                      <option value="SINGLE_STAGE">🎯 Single Stage (All-or-Nothing)</option>
                    </select>
                  </div>

                  {/* Stage 2 Multiple */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Stage 2 TP2 Multiple</span>
                      <span className="text-[8px] text-emerald-400 font-bold">{obTp2Multiple}R (+1.0R FLOOR)</span>
                    </label>
                    <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
                      {[1.3, 1.5, 1.8, 2.0].map(mult => (
                        <button
                          key={mult}
                          type="button"
                          onClick={() => setObTp2Multiple(mult)}
                          className={`py-1.5 rounded border font-bold transition ${
                            obTp2Multiple === mult
                              ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-300"
                              : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {mult}R
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tranche Allocation Matrix */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Tranche Allocation</span>
                      <span className="text-[8px] text-purple-400 font-bold">40% • 40% • 20%</span>
                    </label>
                    <div className="w-full py-1.5 px-2.5 rounded font-mono text-[10px] font-bold border border-slate-800 bg-slate-950 text-slate-400 flex items-center justify-between">
                      <span className="text-cyan-300">TP1: 40%</span>
                      <span className="text-emerald-300">TP2: 40%</span>
                      <span className="text-purple-300">Runner: 20%</span>
                    </div>
                  </div>

                  {/* Stage 3 Target R:R / DOL Multiple */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] uppercase font-mono font-semibold text-slate-500 flex items-center justify-between">
                      <span>Stage 3 Target R:R</span>
                      <span className="text-[8px] text-amber-400 font-bold">{obTargetRr}R+ (DOL)</span>
                    </label>
                    <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
                      {[2.0, 2.5, 3.0, 4.0].map(rr => (
                        <button
                          key={rr}
                          type="button"
                          onClick={() => setObTargetRr(rr)}
                          className={`py-1.5 rounded border font-bold transition ${
                            obTargetRr === rr
                              ? "bg-amber-950/40 border-amber-500/50 text-amber-300"
                              : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {rr}R
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Scan Trigger Action */}
                <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-800/40 pt-4 gap-4">
                  <div className="font-mono text-left">
                    <span className="text-[9px] text-slate-500 uppercase block">Zero Look-Ahead Rule</span>
                    <span className="text-xs text-slate-400">Step-by-step chronological candle closure validation</span>
                  </div>

                  <button
                    onClick={runOrderBlockScan}
                    disabled={obScanning}
                    className={`w-full sm:w-auto px-6 py-2.5 rounded font-mono font-bold uppercase text-xs flex items-center justify-center gap-2 transition tracking-wider ${
                      obScanning
                        ? "bg-slate-900 border border-slate-800 text-slate-500 cursor-not-allowed"
                        : "bg-emerald-500 text-slate-950 font-black hover:bg-emerald-400 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                    }`}
                  >
                    {obScanning ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Running Ingestion & Scanning...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        <span>Run Deep OB Scan</span>
                      </>
                    )}
                  </button>
                </div>
              </section>

              {/* Active Scanner Processing HUD */}
              {(obScanning || obProgress || (obStatusMsg && !selectedObScan)) && (
                <section className="border border-emerald-500/30 bg-emerald-950/10 backdrop-blur-sm rounded-lg p-5 font-mono text-left animate-in fade-in duration-200">
                  <div className="flex items-center justify-between mb-3 border-b border-emerald-500/20 pb-3">
                    <span className="text-[10px] uppercase font-bold text-emerald-400 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                      Historical Ingestion & Multi-Gate Engine Active
                    </span>
                    {obScanning && (
                      <span className="text-[9px] text-emerald-400 font-bold animate-pulse uppercase">
                        Streaming SSE
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-200 mb-3">{obStatusMsg}</p>

                  {obProgress && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border border-emerald-500/20 bg-slate-950/60 rounded-lg p-3 text-center">
                      <div className="flex flex-col">
                        <span className="text-[8px] text-slate-500 uppercase">Phase</span>
                        <span className="text-xs font-bold text-emerald-400">{obProgress.phase}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[8px] text-slate-500 uppercase">Candles Loaded</span>
                        <span className="text-xs font-bold text-slate-200">{obProgress.candlesFetched || "—"}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[8px] text-slate-500 uppercase">Detected Blocks</span>
                        <span className="text-xs font-bold text-slate-200">{obProgress.detectedCount ?? "—"}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[8px] text-slate-500 uppercase">Status</span>
                        <span className="text-xs font-bold text-emerald-400">PROCESSING</span>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* ───────────────────────────────────────────────────────────── */}
              {/* Selected Scan Telemetry Dashboard                             */}
              {/* ───────────────────────────────────────────────────────────── */}
              {selectedObScan && selectedObScan.telemetry_summary && (
                <section className="border border-slate-800/50 bg-slate-900/30 backdrop-blur-sm rounded-lg p-6">
                  {/* Top Bar: Scan Metadata & Export Actions */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800/50 pb-5 mb-5 gap-4">
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {selectedObScan.symbol} • {selectedObScan.timeframe}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {selectedObScan.start_date.slice(0, 10)} to {selectedObScan.end_date.slice(0, 10)}
                        </span>
                      </div>
                      <h3 className="text-base font-mono font-bold text-white uppercase mt-1">
                        {selectedObScan.scan_name} Telemetry
                      </h3>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={handleExportValidatedObDataset}
                        className="px-3.5 py-1.5 border border-emerald-500/30 text-[10px] font-mono font-bold uppercase rounded bg-emerald-950/20 text-emerald-400 hover:bg-emerald-950/40 hover:border-emerald-400/50 flex items-center gap-1.5 transition"
                        title="Export High-Probability Dataset for Execution Strategies"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export Dataset (.json)</span>
                      </button>

                      <button
                        onClick={handleExportObCsv}
                        className="px-3.5 py-1.5 border border-slate-700 text-[10px] font-mono font-bold uppercase rounded bg-slate-900 text-slate-300 hover:border-slate-500 flex items-center gap-1.5 transition"
                        title="Export Full CSV Telemetry Table"
                      >
                        <FileCode className="w-3.5 h-3.5" />
                        <span>Export CSV</span>
                      </button>
                    </div>
                  </div>

                  {/* Macro Telemetry Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5 font-mono text-center">
                    {/* Total Detected */}
                    <div className="border border-slate-800/40 bg-slate-950/60 rounded-lg p-3">
                      <span className="text-[8px] text-slate-500 uppercase block mb-1">Total Detected</span>
                      <span className="text-base font-bold text-white">{selectedObScan.total_detected}</span>
                      <span className="text-[8px] text-slate-500 block mt-0.5">
                        {selectedObScan.telemetry_summary.aggregated_blocks_count} Aggregated ({selectedObScan.telemetry_summary.aggregation_rate_pct}%)
                      </span>
                    </div>

                    {/* Validation Rate */}
                    <div className="border border-slate-800/40 bg-slate-950/60 rounded-lg p-3">
                      <span className="text-[8px] text-slate-500 uppercase block mb-1">Validation Rate (A+/A)</span>
                      <span className="text-base font-bold text-emerald-400">{Number(selectedObScan.validation_rate_pct).toFixed(1)}%</span>
                      <span className="text-[8px] text-slate-500 block mt-0.5">
                        {selectedObScan.telemetry_summary.tier_a_plus_count} A+ • {selectedObScan.telemetry_summary.tier_a_count} A
                      </span>
                    </div>

                    {/* Mean Threshold Reaction Rate */}
                    <div className="border border-slate-800/40 bg-slate-950/60 rounded-lg p-3">
                      <span className="text-[8px] text-slate-500 uppercase block mb-1">MT Reaction Rate</span>
                      <span className="text-base font-bold text-cyan-400">{Number(selectedObScan.mt_reaction_rate_pct).toFixed(1)}%</span>
                      <span className="text-[8px] text-slate-500 block mt-0.5">
                        {selectedObScan.telemetry_summary.mitigated_respected_count} Respected MT
                      </span>
                    </div>

                    {/* Mitigation Win Rate */}
                    <div className="border border-slate-800/40 bg-slate-950/60 rounded-lg p-3">
                      <span className="text-[8px] text-slate-500 uppercase block mb-1">Mitigation Win Rate</span>
                      <span className={`text-base font-bold ${Number(selectedObScan.mitigation_win_rate_pct) >= 50 ? "text-emerald-400" : "text-rose-400"}`}>
                        {Number(selectedObScan.mitigation_win_rate_pct).toFixed(1)}%
                      </span>
                      <span className="text-[8px] text-slate-500 block mt-0.5">
                        PF: {selectedObScan.telemetry_summary.overall_profit_factor ?? "—"} • {selectedObScan.telemetry_summary.mitigation_winning_trades}W/{selectedObScan.telemetry_summary.mitigation_losing_trades}L
                      </span>
                    </div>

                    {/* Average Realized R:R */}
                    <div className="border border-slate-800/40 bg-slate-950/60 rounded-lg p-3">
                      <span className="text-[8px] text-slate-500 uppercase block mb-1">Avg Realized R:R</span>
                      <span className="text-base font-bold text-slate-200">
                        {Number(selectedObScan.telemetry_summary.avg_realized_rr) > 0 ? "+" : ""}{Number(selectedObScan.telemetry_summary.avg_realized_rr).toFixed(2)}R
                      </span>
                      <span className="text-[8px] text-slate-500 block mt-0.5">
                        MFE: +{selectedObScan.telemetry_summary.avg_max_favorable_excursion_r}R
                      </span>
                    </div>

                    {/* Breaker Transitions */}
                    <div className="border border-slate-800/40 bg-slate-950/60 rounded-lg p-3">
                      <span className="text-[8px] text-slate-500 uppercase block mb-1">Breaker Conversion</span>
                      <span className="text-base font-bold text-purple-400">
                        {selectedObScan.telemetry_summary.breaker_converted_count}
                      </span>
                      <span className="text-[8px] text-slate-500 block mt-0.5">
                        {selectedObScan.telemetry_summary.breaker_conversion_rate_pct}% of Invalids
                      </span>
                    </div>
                  </div>

                  {/* ───────────────────────────────────────────────────────── */}
                  {/* PHASE 2, 3, 4, 5 & 6: COMPARATIVE PERFORMANCE MATRIX      */}
                  {/* ───────────────────────────────────────────────────────── */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6 font-mono text-left">
                    {/* Matrix 1: Phase 6 Multi-Stage Harvest & Net Expectancy HUD */}
                    <div className="border border-cyan-500/30 bg-gradient-to-br from-slate-950/90 to-cyan-950/20 rounded-lg p-3.5 flex flex-col justify-between shadow-sm shadow-cyan-500/5">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] uppercase font-bold text-cyan-300 flex items-center gap-1">
                            <Shield className="w-3.5 h-3.5 text-cyan-400" />
                            3-Stage Harvest & EV
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[8px] font-bold bg-cyan-500/20 text-cyan-300">
                            {selectedObScan.telemetry_summary.stage_1_fill_rate_pct ?? "0"}% S1 • {selectedObScan.telemetry_summary.stage_2_fill_rate_pct ?? "0"}% S2
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] my-2">
                          <div className="bg-slate-950/60 border border-slate-800/80 rounded p-2">
                            <span className="text-[8px] text-slate-500 uppercase block">Tranche Fills</span>
                            <span className="text-xs font-bold text-cyan-300 block">
                              {selectedObScan.telemetry_summary.stage_3_fill_rate_pct ?? "0"}% S3 Runner
                            </span>
                            <span className="text-[8px] text-slate-400">
                              S1: {selectedObScan.telemetry_summary.stage_1_fill_count ?? 0} • S2: {selectedObScan.telemetry_summary.stage_2_fill_count ?? 0} • S3: {selectedObScan.telemetry_summary.stage_3_fill_count ?? 0}
                            </span>
                          </div>
                          <div className="bg-cyan-950/30 border border-cyan-500/40 rounded p-2">
                            <span className="text-[8px] text-cyan-300 uppercase block">3-Stage Expectancy</span>
                            <span className="text-xs font-bold text-emerald-400 block">
                              {selectedObScan.telemetry_summary.three_stage_ev_r > 0 ? "+" : ""}{selectedObScan.telemetry_summary.three_stage_ev_r ?? "0"}R EV
                            </span>
                            <span className="text-[8px] text-cyan-400 font-bold">
                              2-Stg: {selectedObScan.telemetry_summary.two_stage_ev_r > 0 ? "+" : ""}{selectedObScan.telemetry_summary.two_stage_ev_r ?? 0}R • 1-Stg: {selectedObScan.telemetry_summary.single_stage_ev_r > 0 ? "+" : ""}{selectedObScan.telemetry_summary.single_stage_ev_r ?? 0}R
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-800/40 pt-2 text-[9px]">
                        <span className="text-slate-400">EV Expansion Delta:</span>
                        <span className="font-bold text-emerald-400">
                          {selectedObScan.telemetry_summary.expectancy_expansion_delta_r >= 0 ? "+" : ""}{selectedObScan.telemetry_summary.expectancy_expansion_delta_r ?? 0}R vs 2-Stage • Adj WR: {selectedObScan.telemetry_summary.adjusted_win_rate_pct ?? 0}%
                        </span>
                      </div>
                    </div>

                    {/* Matrix 2: Tier A vs. Tier A+ Confluence Delta */}
                    <div className="border border-emerald-500/20 bg-gradient-to-br from-slate-950/80 to-emerald-950/10 rounded-lg p-3.5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] uppercase font-bold text-emerald-400 flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-emerald-400" />
                            Tier A vs. Tier A+ Delta
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[8px] font-bold bg-emerald-500/20 text-emerald-300">
                            SWEEP GATE
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] my-2">
                          <div className="bg-slate-950/60 border border-slate-800/80 rounded p-2">
                            <span className="text-[8px] text-slate-500 uppercase block">Tier A (3 Gates)</span>
                            <span className="text-xs font-bold text-slate-200 block">
                              {selectedObScan.telemetry_summary.tier_a_win_rate_pct ?? "0"}% WR
                            </span>
                            <span className="text-[8px] text-slate-400">
                              {selectedObScan.telemetry_summary.tier_a_avg_rr ?? "0"}R • PF: {selectedObScan.telemetry_summary.tier_a_profit_factor ?? "—"}
                            </span>
                          </div>
                          <div className="bg-emerald-950/30 border border-emerald-500/30 rounded p-2">
                            <span className="text-[8px] text-emerald-400 uppercase block">Tier A+ (4 Gates)</span>
                            <span className="text-xs font-bold text-emerald-300 block">
                              {selectedObScan.telemetry_summary.tier_a_plus_win_rate_pct ?? "0"}% WR
                            </span>
                            <span className="text-[8px] text-emerald-400 font-bold">
                              {selectedObScan.telemetry_summary.tier_a_plus_avg_rr ?? "0"}R • PF: {selectedObScan.telemetry_summary.tier_a_plus_profit_factor ?? "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-800/40 pt-2 text-[9px]">
                        <span className="text-slate-400">Tier A+ Advantage:</span>
                        <span className="font-bold text-emerald-400">
                          {selectedObScan.telemetry_summary.tier_a_plus_win_rate_delta > 0 ? "+" : ""}{selectedObScan.telemetry_summary.tier_a_plus_win_rate_delta}% WR / {selectedObScan.telemetry_summary.tier_a_plus_rr_delta > 0 ? "+" : ""}{selectedObScan.telemetry_summary.tier_a_plus_rr_delta}R
                        </span>
                      </div>
                    </div>

                    {/* Matrix 3: Fresh vs. Stale Mitigation Comparison */}
                    <div className="border border-amber-500/20 bg-gradient-to-br from-slate-950/80 to-amber-950/10 rounded-lg p-3.5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] uppercase font-bold text-amber-400 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-400" />
                            Fresh vs. Stale Tests
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[8px] font-bold bg-amber-500/20 text-amber-300">
                            ≤{selectedObScan.telemetry_summary.avg_bars_to_mitigation || 24}B
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] my-2">
                          <div className="bg-amber-950/20 border border-amber-500/30 rounded p-2">
                            <span className="text-[8px] text-amber-400 uppercase block">Fresh Tests</span>
                            <span className="text-xs font-bold text-amber-300 block">
                              {selectedObScan.telemetry_summary.fresh_win_rate_pct ?? "0"}% WR
                            </span>
                            <span className="text-[8px] text-slate-400">
                              {selectedObScan.telemetry_summary.fresh_avg_realized_rr ?? "0"}R ({selectedObScan.telemetry_summary.fresh_mitigation_count} trades)
                            </span>
                          </div>
                          <div className="bg-slate-950/60 border border-slate-800/80 rounded p-2">
                            <span className="text-[8px] text-slate-500 uppercase block">Stale Tests</span>
                            <span className="text-xs font-bold text-slate-400 block">
                              {selectedObScan.telemetry_summary.stale_win_rate_pct ?? "0"}% WR
                            </span>
                            <span className="text-[8px] text-slate-500">
                              {selectedObScan.telemetry_summary.stale_avg_realized_rr ?? "0"}R ({selectedObScan.telemetry_summary.stale_mitigation_count} trades)
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-800/40 pt-2 text-[9px]">
                        <span className="text-slate-400">Expired Stale:</span>
                        <span className="font-bold text-amber-400">
                          {selectedObScan.telemetry_summary.expired_stale_count ?? 0} Bypassed
                        </span>
                      </div>
                    </div>

                    {/* Matrix 4: Inverted Breaker Block Engine */}
                    {/* Matrix 4: Phase 4 Confirmation-Gated Breaker Engine */}
                    <div className="border border-purple-500/30 bg-gradient-to-br from-slate-950/80 to-purple-950/20 rounded-lg p-3.5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] uppercase font-bold text-purple-400 flex items-center gap-1">
                            <Repeat className="w-3 h-3 text-purple-400" />
                            Confirmed vs Blind Breakers
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[8px] font-bold bg-purple-500/20 text-purple-300">
                            MICRO MSS + DOL
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] my-2">
                          <div className="bg-purple-950/30 border border-purple-500/40 rounded p-2">
                            <span className="text-[8px] text-purple-300 uppercase block">Confirmed WR%</span>
                            <span className="text-xs font-bold text-purple-300 block">
                              {selectedObScan.telemetry_summary.confirmed_breaker_win_rate_pct ?? "0"}% WR
                            </span>
                            <span className="text-[8px] text-purple-400 font-bold">
                              {selectedObScan.telemetry_summary.confirmed_breaker_avg_rr ?? "0"}R ({selectedObScan.telemetry_summary.confirmed_breaker_retest_count ?? 0} fills)
                            </span>
                          </div>
                          <div className="bg-slate-950/60 border border-slate-800/80 rounded p-2">
                            <span className="text-[8px] text-slate-500 uppercase block">Blind Limit WR%</span>
                            <span className="text-xs font-bold text-slate-400 block">
                              {selectedObScan.telemetry_summary.blind_breaker_win_rate_pct ?? "0"}% WR
                            </span>
                            <span className="text-[8px] text-slate-500">
                              {selectedObScan.telemetry_summary.blind_breaker_avg_rr ?? "0"}R ({selectedObScan.telemetry_summary.blind_breaker_retest_count ?? 0} fills)
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-800/40 pt-2 text-[9px]">
                        <span className="text-slate-400">Confirmation Delta:</span>
                        <span className="font-bold text-purple-300">
                          {selectedObScan.telemetry_summary.breaker_confirmation_win_rate_delta > 0 ? "+" : ""}{selectedObScan.telemetry_summary.breaker_confirmation_win_rate_delta ?? 0}% WR ({selectedObScan.telemetry_summary.breaker_vetoed_count ?? 0} Vetoed)
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* ───────────────────────────────────────────────────────── */}
                  {/* Capital Growth & Chronological Equity Ledger               */}
                  {/* ───────────────────────────────────────────────────────── */}
                  <div className="mb-6">
                    <CapitalGrowthLedger
                      trades={executedObTrades}
                      totalMonitoredCount={selectedObScan.total_detected}
                      monitoredLabel="Order Blocks"
                      title={`ORDER BLOCK COMPOUNDING LEDGER • ${selectedObScan.symbol} (${selectedObScan.timeframe})`}
                      subtitle={`Sequential path-dependent walk across ${executedObTrades.length} executed mitigations & breaker tests from ${selectedObScan.scan_name}.`}
                    />
                  </div>

                  {/* ───────────────────────────────────────────────────────── */}
                  {/* Interactive Table Filter Bar                              */}
                  {/* ───────────────────────────────────────────────────────── */}
                  <div className="border border-slate-800/60 bg-slate-950/50 rounded-lg p-3 mb-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[10px]">
                      {/* Search */}
                      <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded px-2.5 py-1 min-w-[180px]">
                        <Search className="w-3 h-3 text-slate-500" />
                        <input
                          type="text"
                          placeholder="Search OB ID / Price / Sweep..."
                          value={obSearchQuery}
                          onChange={(e) => {
                            setObSearchQuery(e.target.value);
                            setObCurrentPage(1);
                          }}
                          className="bg-transparent text-white outline-none text-[10px] w-full"
                        />
                      </div>

                      {/* Direction Filter */}
                      <div className="flex items-center gap-1">
                        <span className="text-slate-500 uppercase text-[9px] mr-1">Dir:</span>
                        {(["ALL", "BULLISH", "BEARISH"] as const).map(d => (
                          <button
                            key={d}
                            onClick={() => {
                              setObFilterDirection(d);
                              setObCurrentPage(1);
                            }}
                            className={`px-2 py-0.5 rounded text-[9px] font-bold transition ${
                              obFilterDirection === d
                                ? d === "BULLISH"
                                  ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/40"
                                  : d === "BEARISH"
                                  ? "bg-rose-950/60 text-rose-400 border border-rose-500/40"
                                  : "bg-slate-800 text-white"
                                : "text-slate-500 hover:text-slate-300"
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>

                      {/* Tier Filter */}
                      <div className="flex items-center gap-1">
                        <span className="text-slate-500 uppercase text-[9px] mr-1">Tier:</span>
                        {(["ALL", "A_PLUS", "A", "B", "UNVALIDATED"] as const).map(t => (
                          <button
                            key={t}
                            onClick={() => {
                              setObFilterTier(t);
                              setObCurrentPage(1);
                            }}
                            className={`px-2 py-0.5 rounded text-[9px] font-bold transition ${
                              obFilterTier === t
                                ? t === "A_PLUS"
                                  ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/40"
                                  : t === "A"
                                  ? "bg-cyan-950/60 text-cyan-400 border border-cyan-500/40"
                                  : "bg-slate-800 text-white"
                                : "text-slate-500 hover:text-slate-300"
                            }`}
                          >
                            {t === "A_PLUS" ? "⭐ A+" : t}
                          </button>
                        ))}
                      </div>

                      {/* Lifecycle Status Filter */}
                      <div className="flex items-center gap-1">
                        <span className="text-slate-500 uppercase text-[9px] mr-1">Status:</span>
                        <select
                          value={obFilterStatus}
                          onChange={(e) => {
                            setObFilterStatus(e.target.value as any);
                            setObCurrentPage(1);
                          }}
                          className="bg-slate-900 border border-slate-800 text-slate-300 px-2 py-1 rounded text-[9px] outline-none"
                        >
                          <option value="ALL">ALL STATUSES</option>
                          <option value="UNTESTED">UNTESTED</option>
                          <option value="MITIGATED_RESPECTED">MITIGATED / RESPECTED</option>
                          <option value="MEAN_THRESHOLD_VIOLATED">MT VIOLATED</option>
                          <option value="ZONE_INVALIDATED">INVALIDATED (BREAKER FLIP)</option>
                          <option value="EXPIRED_STALE">EXPIRED / STALE</option>
                          <option value="ACTIVE_BREAKER">ACTIVE BREAKER</option>
                          <option value="BREAKER_EXPIRED">BREAKER EXPIRED</option>
                        </select>
                      </div>

                      {/* Outcome Filter */}
                      <div className="flex items-center gap-1">
                        <span className="text-slate-500 uppercase text-[9px] mr-1">Trade:</span>
                        {[
                          { id: "ALL", label: "ALL" },
                          { id: "FULL_TP2_WIN", label: "FULL TP2" },
                          { id: "BE_SCRATCH_WIN", label: "BE SCRATCH" },
                          { id: "STOPPED_OUT", label: "STOPPED OUT" },
                          { id: "PENDING", label: "PENDING" }
                        ].map(o => (
                          <button
                            key={o.id}
                            onClick={() => {
                              setObFilterOutcome(o.id);
                              setObCurrentPage(1);
                            }}
                            className={`px-2 py-0.5 rounded text-[9px] font-bold transition ${
                              obFilterOutcome === o.id
                                ? o.id === "FULL_TP2_WIN"
                                  ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/40"
                                  : o.id === "BE_SCRATCH_WIN"
                                  ? "bg-cyan-950/60 text-cyan-300 border border-cyan-500/40"
                                  : o.id === "STOPPED_OUT"
                                  ? "bg-rose-950/60 text-rose-400 border border-rose-500/40"
                                  : "bg-slate-800 text-white"
                                : "text-slate-500 hover:text-slate-300"
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ───────────────────────────────────────────────────────── */}
                  {/* Order Blocks Telemetry Table                              */}
                  {/* ───────────────────────────────────────────────────────── */}
                  {filteredOrderBlocks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 border border-dashed border-slate-800 rounded-lg text-slate-500 font-mono text-xs text-center">
                      <span>No Order Blocks match the active filter criteria.</span>
                      <span className="text-[10px] mt-1 text-slate-600">Try loosening your quality tier or lifecycle status filters.</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="overflow-x-auto">
                        <table className="w-full font-mono text-[10px] text-slate-300 text-left">
                          <thead>
                            <tr className="border-b border-slate-800 text-slate-500 uppercase">
                              <th className="py-2.5 px-2">Formation</th>
                              <th className="py-2.5 px-2">Type</th>
                              <th className="py-2.5 px-2">Zone [Top - Bottom]</th>
                              <th className="py-2.5 px-2">Mean Threshold (50%)</th>
                              <th className="py-2.5 px-2 text-center">Agg</th>
                              <th className="py-2.5 px-2">Institutional Gates</th>
                              <th className="py-2.5 px-2">Tier</th>
                              <th className="py-2.5 px-2">Lifecycle State</th>
                              <th className="py-2.5 px-2 text-right">Simulated Outcome</th>
                              <th className="py-2.5 px-2 text-center">Inspect</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/40">
                            {paginatedOrderBlocks.map((ob) => {
                              const isBull = ob.type === "BULLISH";

                              return (
                                <tr
                                  key={ob.id}
                                  onClick={() => setInspectedOb(ob)}
                                  className="hover:bg-slate-900/40 cursor-pointer transition group"
                                >
                                  {/* Formation Timestamp */}
                                  <td className="py-2.5 px-2 text-slate-400">
                                    {new Date(ob.formation_time).toLocaleString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      timeZone: "UTC"
                                    })}
                                  </td>

                                  {/* Type */}
                                  <td className="py-2.5 px-2">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[8px] font-bold inline-flex items-center gap-1 ${
                                        isBull
                                          ? "bg-emerald-950/40 text-emerald-400 border border-emerald-500/30"
                                          : "bg-rose-950/40 text-rose-400 border border-rose-500/30"
                                      }`}
                                    >
                                      {isBull ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                                      {ob.type}
                                    </span>
                                  </td>

                                  {/* Zone Top - Bottom */}
                                  <td className="py-2.5 px-2 text-white font-bold">
                                    ${ob.top.toFixed(2)} - ${ob.bottom.toFixed(2)}
                                    <span className="text-[8px] text-slate-500 font-normal block">
                                      H: ${ob.range_height.toFixed(2)} ({ob.range_pct}%)
                                    </span>
                                  </td>

                                  {/* Mean Threshold */}
                                  <td className="py-2.5 px-2 text-cyan-300 font-bold">
                                    ${ob.mean_threshold.toFixed(2)}
                                  </td>

                                  {/* Aggregated Candles */}
                                  <td className="py-2.5 px-2 text-center">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                        ob.candles_count >= 2
                                          ? "bg-purple-950/40 text-purple-400 border border-purple-500/30"
                                          : "text-slate-500"
                                      }`}
                                    >
                                      {ob.candles_count}B
                                    </span>
                                  </td>

                                  {/* Gates Passed */}
                                  <td className="py-2.5 px-2">
                                    <div className="flex items-center gap-1">
                                      <span
                                        title={`Gate 1 Sweep: ${ob.gates.sweep_type}`}
                                        className={`px-1 py-0.2 rounded text-[7px] font-bold ${
                                          ob.gates.gate1_liquidity_sweep
                                            ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"
                                            : "bg-slate-900 text-slate-600"
                                        }`}
                                      >
                                        G1:{ob.gates.gate1_liquidity_sweep ? "✓" : "✗"}
                                      </span>
                                      <span
                                        title={`Gate 2 FVG: ${ob.gates.fvg_found ? "YES" : "NO"}`}
                                        className={`px-1 py-0.2 rounded text-[7px] font-bold ${
                                          ob.gates.gate2_displacement_imbalance
                                            ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"
                                            : "bg-slate-900 text-slate-600"
                                        }`}
                                      >
                                        G2:{ob.gates.gate2_displacement_imbalance ? "✓" : "✗"}
                                      </span>
                                      <span
                                        title={`Gate 3 Break: ${ob.gates.structure_break_type}`}
                                        className={`px-1 py-0.2 rounded text-[7px] font-bold ${
                                          ob.gates.gate3_structure_break
                                            ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"
                                            : "bg-slate-900 text-slate-600"
                                        }`}
                                      >
                                        G3:{ob.gates.gate3_structure_break ? "✓" : "✗"}
                                      </span>
                                      <span
                                        title={`Gate 4 Dealing Range: ${ob.gates.dealing_range_location}`}
                                        className={`px-1 py-0.2 rounded text-[7px] font-bold ${
                                          ob.gates.gate4_dealing_range
                                            ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"
                                            : "bg-slate-900 text-slate-600"
                                        }`}
                                      >
                                        G4:{ob.gates.gate4_dealing_range ? "✓" : "✗"}
                                      </span>
                                    </div>
                                  </td>

                                  {/* Tier */}
                                  <td className="py-2.5 px-2">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                        ob.quality_tier === "A_PLUS"
                                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                          : ob.quality_tier === "A"
                                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                                          : ob.quality_tier === "B"
                                          ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                                          : "bg-slate-800 text-slate-400"
                                      }`}
                                    >
                                      {ob.quality_tier === "A_PLUS" ? "⭐ A+" : ob.quality_tier}
                                    </span>
                                  </td>

                                  {/* Lifecycle State */}
                                  <td className="py-2.5 px-2">
                                    <div className="flex flex-col gap-0.5">
                                      <span
                                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold w-fit ${
                                          ob.lifecycle_status === "MITIGATED_RESPECTED"
                                            ? "bg-emerald-950/50 text-emerald-400 border border-emerald-500/30"
                                            : ob.lifecycle_status === "MEAN_THRESHOLD_VIOLATED"
                                            ? "bg-amber-950/50 text-amber-400 border border-amber-500/30"
                                            : ob.lifecycle_status === "ZONE_INVALIDATED"
                                            ? "bg-rose-950/50 text-rose-400 border border-rose-500/30"
                                            : ob.lifecycle_status === "ACTIVE_BREAKER"
                                            ? "bg-purple-950/50 text-purple-300 border border-purple-500/30"
                                            : ob.lifecycle_status === "BREAKER_EXPIRED"
                                            ? "bg-purple-950/30 text-purple-400/80 border border-purple-500/20"
                                            : ob.lifecycle_status === "EXPIRED_STALE"
                                            ? "bg-slate-800/80 text-amber-400/80 border border-amber-500/20"
                                            : "bg-slate-800/80 text-slate-400"
                                        }`}
                                      >
                                        {ob.lifecycle_status === "ZONE_INVALIDATED"
                                          ? "BREAKER FLIP"
                                          : ob.lifecycle_status === "EXPIRED_STALE"
                                          ? "EXPIRED STALE"
                                          : ob.lifecycle_status.replace(/_/g, " ")}
                                      </span>

                                      {/* Breaker outcome badge */}
                                      {ob.is_breaker && ob.breaker_trade_outcome !== "NO_RETEST" && (
                                        <span className={`text-[7px] font-bold px-1 rounded w-fit ${
                                          ob.breaker_trade_outcome === "WIN"
                                            ? "bg-purple-950/80 text-purple-300 border border-purple-500/40"
                                            : ob.breaker_trade_outcome === "LOSS"
                                            ? "bg-rose-950/60 text-rose-400 border border-rose-500/30"
                                            : "bg-slate-800 text-slate-400"
                                        }`}>
                                          BRK: {ob.breaker_trade_outcome} ({ob.breaker_realized_rr > 0 ? "+" : ""}{ob.breaker_realized_rr}R)
                                        </span>
                                      )}
                                    </div>
                                  </td>

                                  {/* Outcome / Realized R:R */}
                                  <td className="py-2.5 px-2 text-right">
                                    {ob.simulated_outcome === "FULL_TP2_WIN" || ob.simulated_outcome === "WIN" ? (
                                      <span className="text-emerald-400 font-bold">
                                        FULL TP2 (+{ob.realized_rr}R)
                                      </span>
                                    ) : ob.simulated_outcome === "BE_SCRATCH_WIN" ? (
                                      <span className="text-cyan-300 font-bold">
                                        BE SCRATCH (+{ob.realized_rr}R)
                                      </span>
                                    ) : ob.simulated_outcome === "STOPPED_OUT" || ob.simulated_outcome === "LOSS" ? (
                                      <span className="text-rose-400 font-bold">
                                        STOPPED OUT (-1.0R)
                                      </span>
                                    ) : ob.simulated_outcome === "EXPIRED" ? (
                                      <span className="text-amber-500/80 font-bold">
                                        STALE EXPIRED
                                      </span>
                                    ) : (
                                      <span className="text-slate-500">
                                        {ob.simulated_outcome}
                                      </span>
                                    )}
                                  </td>

                                  {/* Inspect Action */}
                                  <td className="py-2.5 px-2 text-center">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setInspectedOb(ob);
                                      }}
                                      className="p-1 rounded bg-slate-800 hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 transition"
                                      title="Inspect Quantitative Breakdown"
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
                      {totalObPages > 1 && (
                        <div className="flex items-center justify-between border-t border-slate-800/40 pt-4 font-mono text-[10px]">
                          <span className="text-slate-500">
                            Showing {(obCurrentPage - 1) * obsPerPage + 1} - {Math.min(obCurrentPage * obsPerPage, filteredOrderBlocks.length)} of {filteredOrderBlocks.length} filtered OBs
                          </span>

                          <div className="flex items-center gap-2">
                            <button
                              disabled={obCurrentPage === 1}
                              onClick={() => setObCurrentPage(prev => Math.max(1, prev - 1))}
                              className="px-2 py-1 border border-slate-800 rounded bg-slate-900/50 hover:border-slate-600 disabled:opacity-30 text-slate-300"
                            >
                              Prev
                            </button>
                            <span className="px-2 text-slate-400 font-bold">
                              {obCurrentPage} / {totalObPages}
                            </span>
                            <button
                              disabled={obCurrentPage === totalObPages}
                              onClick={() => setObCurrentPage(prev => Math.min(totalObPages, prev + 1))}
                              className="px-2 py-1 border border-slate-800 rounded bg-slate-900/50 hover:border-slate-600 disabled:opacity-30 text-slate-300"
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
            </>
          ) : (
            // =================================================================
            // TAB 2: CUSTOM STRATEGY HEADLESS BACKTEST WORKSPACE
            // =================================================================
            <>
              {/* Backtest Controller Panel */}
              <section className="border border-slate-800/50 bg-slate-900/30 backdrop-blur-sm rounded-lg p-6">
                <h2 className="text-xs uppercase tracking-widest text-slate-400 font-mono font-bold mb-5 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>Custom Strategy Configuration</span>
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
                              className="px-2 py-1 border border-slate-800 rounded bg-slate-900/50 hover:border-slate-600 disabled:opacity-30 text-slate-300"
                            >
                              Prev
                            </button>
                            <button
                              disabled={currentPage === totalPages}
                              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                              className="px-2 py-1 border border-slate-800 rounded bg-slate-900/50 hover:border-slate-600 disabled:opacity-30 text-slate-300"
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
            </>
          )}
        </main>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* ORDER BLOCK INSPECTOR DRAWER / MODAL                                */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {inspectedOb && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150 font-mono">
          <div className="bg-slate-950 border border-slate-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative">
            {/* Close Button */}
            <button
              onClick={() => setInspectedOb(null)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white p-1 rounded-lg hover:bg-slate-900 transition"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-800/60 pb-4 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`px-2 py-0.5 rounded text-[9px] font-bold inline-flex items-center gap-1 ${
                      inspectedOb.type === "BULLISH"
                        ? "bg-emerald-950/50 text-emerald-400 border border-emerald-500/30"
                        : "bg-rose-950/50 text-rose-400 border border-rose-500/30"
                    }`}
                  >
                    {inspectedOb.type} ORDER BLOCK
                  </span>
                  <span className="text-[9px] text-slate-400">
                    Tier: <strong className="text-white">{inspectedOb.quality_tier}</strong>
                  </span>
                  <span className="text-[9px] text-slate-400">
                    Score: <strong className="text-emerald-400">{inspectedOb.confluence_score}/100</strong>
                  </span>
                </div>
                <h3 className="text-sm font-bold text-white uppercase">{inspectedOb.id}</h3>
              </div>
            </div>

            {/* Geometry Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900/40 border border-slate-800/60 rounded-lg p-3.5 mb-4 text-center">
              <div className="flex flex-col">
                <span className="text-[8px] text-slate-500 uppercase">Top Boundary</span>
                <span className="text-xs font-bold text-white">${inspectedOb.top.toFixed(2)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[8px] text-slate-500 uppercase">Mean Threshold (50%)</span>
                <span className="text-xs font-bold text-cyan-300">${inspectedOb.mean_threshold.toFixed(2)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[8px] text-slate-500 uppercase">Bottom Boundary</span>
                <span className="text-xs font-bold text-white">${inspectedOb.bottom.toFixed(2)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[8px] text-slate-500 uppercase">Range Height</span>
                <span className="text-xs font-bold text-slate-300">
                  ${inspectedOb.range_height.toFixed(2)} ({inspectedOb.range_pct}%)
                </span>
              </div>
            </div>

            {/* 4-Gate Validation Breakdown */}
            <div className="border border-slate-800/60 bg-slate-900/20 rounded-lg p-4 mb-4">
              <h4 className="text-[10px] uppercase font-bold text-slate-300 mb-3 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Multi-Gate Institutional Validation Filter</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[10px]">
                {/* Gate 1 */}
                <div className={`p-2.5 rounded border ${inspectedOb.gates.gate1_liquidity_sweep ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300" : "bg-slate-900/60 border-slate-800 text-slate-500"}`}>
                  <div className="flex items-center justify-between font-bold mb-1">
                    <span>Gate 1: Liquidity Sweep</span>
                    <span>{inspectedOb.gates.gate1_liquidity_sweep ? "PASSED" : "FAILED"}</span>
                  </div>
                  <p className="text-[9px] text-slate-400">
                    Sweep Type: <strong>{inspectedOb.gates.sweep_type}</strong> {inspectedOb.gates.sweep_level ? `at $${inspectedOb.gates.sweep_level}` : ""}
                  </p>
                </div>

                {/* Gate 2 */}
                <div className={`p-2.5 rounded border ${inspectedOb.gates.gate2_displacement_imbalance ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300" : "bg-slate-900/60 border-slate-800 text-slate-500"}`}>
                  <div className="flex items-center justify-between font-bold mb-1">
                    <span>Gate 2: Displacement & FVG</span>
                    <span>{inspectedOb.gates.gate2_displacement_imbalance ? "PASSED" : "FAILED"}</span>
                  </div>
                  <p className="text-[9px] text-slate-400">
                    FVG: <strong>{inspectedOb.gates.fvg_type || "None"}</strong> • Body: {(inspectedOb.gates.displacement_body_ratio * 100).toFixed(0)}% • Vol: {inspectedOb.gates.displacement_volume_expansion}x
                  </p>
                </div>

                {/* Gate 3 */}
                <div className={`p-2.5 rounded border ${inspectedOb.gates.gate3_structure_break ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300" : "bg-slate-900/60 border-slate-800 text-slate-500"}`}>
                  <div className="flex items-center justify-between font-bold mb-1">
                    <span>Gate 3: Structure Break</span>
                    <span>{inspectedOb.gates.gate3_structure_break ? "PASSED" : "FAILED"}</span>
                  </div>
                  <p className="text-[9px] text-slate-400">
                    Shift: <strong>{inspectedOb.gates.structure_break_type}</strong> {inspectedOb.gates.broken_structure_level ? `fractured $${inspectedOb.gates.broken_structure_level}` : ""}
                  </p>
                </div>

                {/* Gate 4 */}
                <div className={`p-2.5 rounded border ${inspectedOb.gates.gate4_dealing_range ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300" : "bg-slate-900/60 border-slate-800 text-slate-500"}`}>
                  <div className="flex items-center justify-between font-bold mb-1">
                    <span>Gate 4: Dealing Range</span>
                    <span>{inspectedOb.gates.gate4_dealing_range ? "PASSED" : "FAILED"}</span>
                  </div>
                  <p className="text-[9px] text-slate-400">
                    Pricing: <strong>{inspectedOb.gates.dealing_range_location}</strong> (Eq: ${inspectedOb.gates.dealing_range_equilibrium ?? "—"})
                  </p>
                </div>
              </div>
            </div>

            {/* Lifecycle & Simulated Trade Blueprint (Phase 3 Dynamic Management) */}
            <div className="border border-slate-800/60 bg-slate-900/30 rounded-lg p-4 mb-4 font-mono text-[10px]">
              <h4 className="uppercase font-bold text-slate-300 mb-2.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Primary OB Dynamic Trade Lifecycle & Execution</span>
                </span>
                {inspectedOb.is_be_active && (
                  <span className="px-2 py-0.5 rounded text-[8px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    🛡️ BREAKEVEN PROTECTED
                  </span>
                )}
              </h4>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-slate-300 mb-3">
                <div>
                  <span className="text-slate-500 text-[8px] uppercase block">Lifecycle State</span>
                  <span className="font-bold text-white">{inspectedOb.lifecycle_status}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[8px] uppercase block">Freshness Status</span>
                  <span className={`font-bold ${inspectedOb.is_fresh_mitigation ? "text-emerald-400" : inspectedOb.is_expired ? "text-amber-400" : "text-slate-400"}`}>
                    {inspectedOb.is_fresh_mitigation ? "FRESH TEST" : inspectedOb.is_expired ? "EXPIRED STALE" : "NORMAL"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 text-[8px] uppercase block">Bars to Mitigation</span>
                  <span className="font-bold text-slate-200">{inspectedOb.bars_to_mitigation ?? "—"} bars</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[8px] uppercase block">Entry / Initial Stop Loss</span>
                  <span className="font-bold text-white">${inspectedOb.simulated_entry_price} / ${inspectedOb.simulated_stop_loss}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[8px] uppercase block">TP1 (40%) • TP2 (40%) • TP3 (20%)</span>
                  <span className="font-bold text-emerald-400">${inspectedOb.simulated_tp1} • ${inspectedOb.simulated_tp2} • ${inspectedOb.simulated_tp3}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[8px] uppercase block">Simulated Trade Outcome</span>
                  <span className={`font-bold ${
                    inspectedOb.simulated_outcome === "FULL_TP2_WIN" || inspectedOb.simulated_outcome === "WIN"
                      ? "text-emerald-400"
                      : inspectedOb.simulated_outcome === "BE_SCRATCH_WIN"
                      ? "text-cyan-300"
                      : inspectedOb.simulated_outcome === "STOPPED_OUT" || inspectedOb.simulated_outcome === "LOSS"
                      ? "text-rose-400"
                      : "text-slate-400"
                  }`}>
                    {inspectedOb.stage_exit_type ?? inspectedOb.simulated_outcome} ({inspectedOb.realized_rr > 0 ? "+" : ""}{inspectedOb.realized_rr}R)
                  </span>
                </div>
              </div>

              {inspectedOb.is_be_active && (
                <div className="border-t border-slate-800/60 pt-2.5 mt-2 flex flex-wrap items-center justify-between text-[9px] text-slate-400 gap-y-1.5">
                  <span>Tranche 1 (40% @ 1.0R): <strong className="text-emerald-400">{inspectedOb.tp1_hit_time ? `${new Date(inspectedOb.tp1_hit_time).toLocaleTimeString()} (+0.4R)` : "—"}</strong></span>
                  <span>Tranche 2 (40% @ 1.5R): <strong className={inspectedOb.is_tp2_filled ? "text-emerald-400" : "text-slate-500"}>{inspectedOb.tp2_hit_time ? `${new Date(inspectedOb.tp2_hit_time).toLocaleTimeString()} (+0.6R)` : "Pending"}</strong></span>
                  <span>Tranche 3 (20% DOL): <strong className={inspectedOb.is_tp3_filled ? "text-purple-400" : "text-slate-500"}>{inspectedOb.is_tp3_filled ? `Filled (${inspectedOb.realized_rr}R Total)` : "Trailing"}</strong></span>
                  <span>Active SL Trail: <strong className="text-cyan-300">${inspectedOb.active_trailing_sl ?? inspectedOb.simulated_entry_price} ({inspectedOb.trailing_sl_source ?? "BREAKEVEN"})</strong></span>
                </div>
              )}
            </div>

            {/* Inverted Breaker Block Execution Blueprint (Phase 4 Confirmation-Gated) */}
            {inspectedOb.is_breaker && (
              <div className="border border-purple-500/30 bg-purple-950/15 rounded-lg p-4 mb-4 font-mono text-[10px]">
                <div className="flex items-center justify-between mb-2.5">
                  <h4 className="uppercase font-bold text-purple-300 flex items-center gap-1.5">
                    <Repeat className="w-3.5 h-3.5 text-purple-400" />
                    <span>Inverted Breaker Block Execution Blueprint</span>
                  </h4>
                  <div className="flex items-center gap-2">
                    {inspectedOb.breaker_is_confirmed && (
                      <span className="px-2 py-0.5 rounded text-[8px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        ✓ CONFIRMED (MICRO MSS)
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded text-[8px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      {inspectedOb.type === "BULLISH" ? "BEARISH BREAKER (RESISTANCE)" : "BULLISH BREAKER (SUPPORT)"}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-slate-300 mb-3">
                  <div>
                    <span className="text-slate-500 text-[8px] uppercase block">Breaker Retest Status</span>
                    <span className={`font-bold ${inspectedOb.breaker_trade_outcome === "WIN" ? "text-purple-300" : inspectedOb.breaker_trade_outcome === "LOSS" ? "text-rose-400" : inspectedOb.breaker_trade_outcome === "EXPIRED" ? "text-amber-400" : "text-slate-400"}`}>
                      {inspectedOb.breaker_trade_outcome} {inspectedOb.breaker_realized_rr !== 0 ? `(${inspectedOb.breaker_realized_rr > 0 ? "+" : ""}{inspectedOb.breaker_realized_rr}R)` : ""}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[8px] uppercase block">Breaker Entry Price</span>
                    <span className="font-bold text-white">${inspectedOb.breaker_entry_price ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[8px] uppercase block">Breaker SL / Target TP</span>
                    <span className="font-bold text-purple-300">${inspectedOb.breaker_stop_loss ?? "—"} / ${inspectedOb.breaker_tp ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[8px] uppercase block">Draw on Liquidity (DOL)</span>
                    <span className="font-bold text-emerald-400">
                      {inspectedOb.breaker_dol_target ? `$${inspectedOb.breaker_dol_target} (${inspectedOb.breaker_dol_type})` : "Standard Target R:R"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[8px] uppercase block">Confirmation Gate</span>
                    <span className={`font-bold ${inspectedOb.breaker_is_confirmed ? "text-emerald-400" : inspectedOb.breaker_veto_reason ? "text-rose-400" : "text-slate-400"}`}>
                      {inspectedOb.breaker_is_confirmed ? "MICRO MSS + FVG CONFIRMED" : inspectedOb.breaker_veto_reason ? `VETO: ${inspectedOb.breaker_veto_reason}` : inspectedOb.breaker_confirmation_type}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[8px] uppercase block">Bars to Inversion Retest</span>
                    <span className="font-bold text-slate-200">{inspectedOb.breaker_bars_to_retest ? `${inspectedOb.breaker_bars_to_retest} bars` : "No Retest"}</span>
                  </div>
                </div>

                {inspectedOb.breaker_is_confirmed && (
                  <div className="border-t border-purple-500/20 pt-2.5 mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[9px] text-purple-200">
                    <div>
                      <span className="text-slate-500 block text-[7px] uppercase">Confirmation Time</span>
                      <span>{inspectedOb.breaker_confirmation_time ? new Date(inspectedOb.breaker_confirmation_time).toLocaleTimeString() : "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[7px] uppercase">Confirmed FVG Range</span>
                      <span>{inspectedOb.breaker_fvg_top ? `$${inspectedOb.breaker_fvg_top} - $${inspectedOb.breaker_fvg_bottom}` : "Structural"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[7px] uppercase">Vol Expansion</span>
                      <span className="font-bold text-cyan-300">{inspectedOb.breaker_volume_expansion ? `${inspectedOb.breaker_volume_expansion}x` : "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[7px] uppercase">Taker Delta</span>
                      <span className="font-bold text-emerald-400">{inspectedOb.breaker_taker_delta ? `${inspectedOb.breaker_taker_delta > 0 ? "+" : ""}${inspectedOb.breaker_taker_delta}` : "—"}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Footer Close */}
            <div className="flex justify-end">
              <button
                onClick={() => setInspectedOb(null)}
                className="px-5 py-2 rounded bg-slate-900 hover:bg-slate-800 text-xs font-bold text-slate-300 transition"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

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
