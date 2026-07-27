"use client";

import React, { useState } from "react";
import {
  Sliders,
  Layers,
  Activity,
  ShieldCheck,
  Zap,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  TrendingUp,
  Bell,
  Palette,
  Crosshair,
  Brain,
  Terminal,
  Copy,
  Database,
  Check,
  Magnet,
  Flame,
  FileCode
} from "lucide-react";

// Expanded Font Options
type FontOption =
  | "geist-mono"
  | "geist-sans"
  | "jetbrains-mono"
  | "fira-code"
  | "space-mono"
  | "roboto-mono"
  | "inter-sans"
  | "sf-pro"
  | "system-mono";

// Color Palette Options
type PaletteOption = "daylight" | "obsidian" | "slate" | "bloomberg" | "nordic" | "solarized";

// Density Presets
type DensityPreset = "compact" | "medium" | "relaxed";

// Line Height Presets
type LineHeightPreset = "tight" | "normal" | "relaxed";

// Letter Spacing Presets
type TrackingPreset = "tight" | "normal" | "wide";

// Candle Data Structure for Realistic Chart SVG
interface ChartCandle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  buyV: number;
  sellV: number;
  marker?: "ARROW_UP" | "ARROW_DOWN" | "CIRCLE_UP" | "CIRCLE_DOWN";
  markerLabel?: string;
}

// 24 Detailed Realistic Mock Candles
const REALISTIC_CANDLES: ChartCandle[] = [
  { t: "13:00", o: 3410.0, h: 3418.5, l: 3408.0, c: 3415.2, v: 420, buyV: 240, sellV: 180 },
  { t: "13:05", o: 3415.2, h: 3416.0, l: 3398.2, c: 3402.5, v: 890, buyV: 210, sellV: 680, marker: "CIRCLE_DOWN", markerLabel: "SSL SWEEP" },
  { t: "13:10", o: 3402.5, h: 3422.0, l: 3401.0, c: 3420.0, v: 1250, buyV: 980, sellV: 270, marker: "ARROW_UP", markerLabel: "REVERSAL ▲" },
  { t: "13:15", o: 3420.0, h: 3428.5, l: 3418.0, c: 3426.0, v: 670, buyV: 450, sellV: 220 },
  { t: "13:20", o: 3426.0, h: 3435.0, l: 3424.0, c: 3432.8, v: 780, buyV: 520, sellV: 260 },
  { t: "13:25", o: 3432.8, h: 3444.0, l: 3430.0, c: 3442.0, v: 1420, buyV: 1100, sellV: 320, marker: "ARROW_UP", markerLabel: "DISPLACEMENT ▲" },
  { t: "13:30", o: 3442.0, h: 3452.0, l: 3441.0, c: 3450.5, v: 1680, buyV: 1350, sellV: 330, marker: "ARROW_UP", markerLabel: "BOS BREAK" },
  { t: "13:35", o: 3450.5, h: 3458.0, l: 3445.0, c: 3446.2, v: 850, buyV: 320, sellV: 530 },
  { t: "13:40", o: 3446.2, h: 3449.0, l: 3441.5, c: 3444.0, v: 620, buyV: 290, sellV: 330 },
  { t: "13:45", o: 3444.0, h: 3455.0, l: 3443.5, c: 3453.8, v: 940, buyV: 680, sellV: 260 },
  { t: "13:50", o: 3453.8, h: 3465.5, l: 3452.0, c: 3462.0, v: 1510, buyV: 1180, sellV: 330, marker: "ARROW_UP", markerLabel: "CONTINUATION ▲" },
  { t: "13:55", o: 3462.0, h: 3466.0, l: 3455.0, c: 3457.5, v: 730, buyV: 310, sellV: 420 },
  { t: "14:00", o: 3457.5, h: 3460.0, l: 3448.0, c: 3451.0, v: 650, buyV: 280, sellV: 370 },
  { t: "14:05", o: 3451.0, h: 3459.5, l: 3450.0, c: 3456.8, v: 810, buyV: 530, sellV: 280 }
];

export default function QuantSandboxPage() {
  // Playground State Controls
  const [fontFamily, setFontFamily] = useState<FontOption>("geist-mono");
  const [palette, setPalette] = useState<PaletteOption>("daylight");
  const [density, setDensity] = useState<DensityPreset>("compact");
  const [lineHeight, setLineHeight] = useState<LineHeightPreset>("normal");
  const [tracking, setTracking] = useState<TrackingPreset>("normal");
  const [minimalistMode, setMinimalistMode] = useState<boolean>(true);

  // Chart Overlay Toggles
  const [showFvgOverlay, setShowFvgOverlay] = useState<boolean>(true);
  const [showBosOverlay, setShowBosOverlay] = useState<boolean>(true);
  const [showLiquidityOverlay, setShowLiquidityOverlay] = useState<boolean>(true);
  const [showVolumeDelta, setShowVolumeDelta] = useState<boolean>(true);

  // Sidebar Collapse States
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState<boolean>(false);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState<boolean>(false);

  // Order Entry Mock Controls
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP">("MARKET");
  const [orderDirection, setOrderDirection] = useState<"LONG" | "SHORT">("LONG");
  const [riskPercent, setRiskPercent] = useState<number>(1.0);

  // AI Area Interactive States
  const [isAiSynthesizing, setIsAiSynthesizing] = useState<boolean>(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<{
    bias: string;
    bias_strength: string;
    actionable_setups: string;
    risk_profile: string;
    dol_target: string;
    confidence_score: string;
    key_observation: string;
  } | null>({
    bias: "BULLISH",
    bias_strength: "STRONG_INSTITUTIONAL",
    actionable_setups: "LONG_DISPLACEMENT_FVG",
    risk_profile: "FULL_RISK_1.0%",
    dol_target: "$3,520.00 (BSL Pool)",
    confidence_score: "94.2%",
    key_observation: "Asian low swept at $3,398.20 followed by +4.25x ATR displacement and 5m Bullish FVG creation. OLS t-stat +3.84 confirms institutional sponsorship."
  });
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [isJsonDrawerOpen, setIsJsonDrawerOpen] = useState<boolean>(false);

  const handleTriggerAiSynthesis = () => {
    setIsAiSynthesizing(true);
    setTimeout(() => {
      setIsAiSynthesizing(false);
      setAiAnalysisResult({
        bias: "BULLISH",
        bias_strength: "HIGH_CONFLUENCE",
        actionable_setups: "LONG_LIMIT_ENTRY",
        risk_profile: "STANDARD_RISK_1.0%",
        dol_target: "$3,545.00 (HTF BSL)",
        confidence_score: "96.5%",
        key_observation: "Displacement confirmed above NY Midnight Open. OLS statistical validation passed (R^2 = 0.892, p-value < 0.001)."
      });
    }, 1200);
  };

  const handleCopyAiPrompt = () => {
    const promptText = `Act as the Institutional Flow Synthesizer V12.0. Analyze quantitative data for ETHUSDT:
Master Bias: BULLISH (Cairo 07:00 Anchor)
Dealing Range: DISCOUNT (48.2% to EQ $3,440.00)
Displacement: +4.25x ATR (OLS R^2=0.892, t-stat=+3.84)
Liquidity Swept: Asian Low Swept at $3,398.20
BSL Target: $3,520.00 (850 ETH)`;
    navigator.clipboard.writeText(promptText);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  // Inner Container Collapse States
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({
    metricsHud: false,
    ipdaLevels: false,
    liquidityMagnets: false,
    orderFlowPulse: false,
    macroLiquidity: false,
    aiConsole: false,
    marketStructure: false,
    fvgInspector: false,
    chartArea: false,
    orderPanel: false,
    strategyConfluence: false,
    matrixWeights: false,
    alertFeed: false,
    journalTable: false
  });

  const toggleCard = (cardId: string) => {
    setCollapsedCards((prev) => ({ ...prev, [cardId]: !prev[cardId] }));
  };

  // Font Style Mapping
  const fontStyleMap: Record<FontOption, string> = {
    "geist-mono": "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
    "geist-sans": "var(--font-geist-sans), Inter, system-ui, sans-serif",
    "jetbrains-mono": "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    "fira-code": "'Fira Code', ui-monospace, SFMono-Regular, monospace",
    "space-mono": "'Space Mono', ui-monospace, monospace",
    "roboto-mono": "'Roboto Mono', ui-monospace, monospace",
    "inter-sans": "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    "sf-pro": "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif",
    "system-mono": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
  };

  // 100% Theme Definitions with Scoped Overrides
  const paletteThemeMap: Record<
    PaletteOption,
    {
      isLight: boolean;
      bg: string;
      toolbarBg: string;
      cardBg: string;
      boxBg: string;
      boxBgSubtle: string;
      border: string;
      textPrimary: string;
      textSecondary: string;
      textMuted: string;
      accentUp: string;
      accentUpBg: string;
      accentDown: string;
      accentDownBg: string;
      accentPrimary: string;
      accentPrimaryBg: string;
      chartBg: string;
      chartGrid: string;
      chartText: string;
      candleGreen: string;
      candleRed: string;
    }
  > = {
    daylight: {
      isLight: true,
      bg: "bg-slate-100",
      toolbarBg: "bg-white border-slate-300 shadow-sm",
      cardBg: "bg-white border-slate-300",
      boxBg: "bg-slate-100 border-slate-300",
      boxBgSubtle: "bg-slate-200/80 border-slate-300",
      border: "border-slate-300",
      textPrimary: "text-slate-950 font-black",
      textSecondary: "text-slate-800 font-extrabold",
      textMuted: "text-slate-600 font-bold",
      accentUp: "text-emerald-800 font-black",
      accentUpBg: "bg-emerald-100 border-emerald-400 text-emerald-950 font-black",
      accentDown: "text-rose-800 font-black",
      accentDownBg: "bg-rose-100 border-rose-400 text-rose-950 font-black",
      accentPrimary: "text-purple-900 font-black",
      accentPrimaryBg: "bg-purple-100 border-purple-300 text-purple-950 font-black",
      chartBg: "#ffffff",
      chartGrid: "#cbd5e1",
      chartText: "#0f172a",
      candleGreen: "#059669",
      candleRed: "#e11d48"
    },
    obsidian: {
      isLight: false,
      bg: "bg-slate-950",
      toolbarBg: "bg-slate-900/95 border-slate-800",
      cardBg: "bg-slate-900/60 border-slate-800/80",
      boxBg: "bg-slate-950/70 border-slate-800/80",
      boxBgSubtle: "bg-slate-950/90 border-slate-800",
      border: "border-slate-800/80",
      textPrimary: "text-slate-100 font-bold",
      textSecondary: "text-slate-400 font-medium",
      textMuted: "text-slate-500",
      accentUp: "text-emerald-400 font-bold",
      accentUpBg: "bg-emerald-950/60 border-emerald-800/60 text-emerald-300 font-bold",
      accentDown: "text-rose-400 font-bold",
      accentDownBg: "bg-rose-950/60 border-rose-800/60 text-rose-300 font-bold",
      accentPrimary: "text-purple-400 font-bold",
      accentPrimaryBg: "bg-purple-950/60 border-purple-800/60 text-purple-300 font-bold",
      chartBg: "#020617",
      chartGrid: "#1e293b",
      chartText: "#94a3b8",
      candleGreen: "#10b981",
      candleRed: "#f43f5e"
    },
    slate: {
      isLight: false,
      bg: "bg-slate-900",
      toolbarBg: "bg-slate-800/95 border-slate-700",
      cardBg: "bg-slate-800/50 border-slate-700/60",
      boxBg: "bg-slate-900/70 border-slate-700/60",
      boxBgSubtle: "bg-slate-900/90 border-slate-700",
      border: "border-slate-700/60",
      textPrimary: "text-slate-200 font-bold",
      textSecondary: "text-slate-400 font-medium",
      textMuted: "text-slate-500",
      accentUp: "text-teal-300 font-bold",
      accentUpBg: "bg-teal-950/60 border-teal-800/60 text-teal-300 font-bold",
      accentDown: "text-pink-300 font-bold",
      accentDownBg: "bg-pink-950/60 border-pink-800/60 text-pink-300 font-bold",
      accentPrimary: "text-indigo-300 font-bold",
      accentPrimaryBg: "bg-indigo-950/60 border-indigo-800/60 text-indigo-300 font-bold",
      chartBg: "#0f172a",
      chartGrid: "#334155",
      chartText: "#94a3b8",
      candleGreen: "#14b8a6",
      candleRed: "#ec4899"
    },
    bloomberg: {
      isLight: false,
      bg: "bg-zinc-950",
      toolbarBg: "bg-zinc-900/95 border-zinc-800",
      cardBg: "bg-zinc-900/60 border-zinc-800",
      boxBg: "bg-zinc-950/80 border-zinc-800",
      boxBgSubtle: "bg-zinc-900/90 border-zinc-800",
      border: "border-zinc-800",
      textPrimary: "text-amber-100 font-bold",
      textSecondary: "text-amber-500/80 font-medium",
      textMuted: "text-zinc-500",
      accentUp: "text-emerald-400 font-bold",
      accentUpBg: "bg-emerald-950/80 border-emerald-800 text-emerald-400 font-bold",
      accentDown: "text-red-400 font-bold",
      accentDownBg: "bg-red-950/80 border-red-800 text-red-400 font-bold",
      accentPrimary: "text-amber-400 font-bold",
      accentPrimaryBg: "bg-amber-950/80 border-amber-800 text-amber-300 font-bold",
      chartBg: "#09090b",
      chartGrid: "#27272a",
      chartText: "#a1a1aa",
      candleGreen: "#10b981",
      candleRed: "#ef4444"
    },
    nordic: {
      isLight: false,
      bg: "bg-[#0f172a]",
      toolbarBg: "bg-[#1e293b]/95 border-[#334155]",
      cardBg: "bg-[#1e293b]/50 border-[#334155]",
      boxBg: "bg-[#0f172a]/70 border-[#334155]",
      boxBgSubtle: "bg-[#0f172a]/90 border-[#334155]",
      border: "border-[#334155]",
      textPrimary: "text-[#f1f5f9] font-bold",
      textSecondary: "text-[#94a3b8] font-medium",
      textMuted: "text-[#64748b]",
      accentUp: "text-[#34d399] font-bold",
      accentUpBg: "bg-[#064e3b]/80 border-[#059669] text-[#34d399] font-bold",
      accentDown: "text-[#f87171] font-bold",
      accentDownBg: "bg-[#7f1d1d]/80 border-[#dc2626] text-[#f87171] font-bold",
      accentPrimary: "text-[#38bdf8] font-bold",
      accentPrimaryBg: "bg-[#0c4a6e]/80 border-[#0284c7] text-[#38bdf8] font-bold",
      chartBg: "#0f172a",
      chartGrid: "#1e293b",
      chartText: "#94a3b8",
      candleGreen: "#34d399",
      candleRed: "#f87171"
    },
    solarized: {
      isLight: false,
      bg: "bg-[#002b36]",
      toolbarBg: "bg-[#073642]/95 border-[#586e75]/50",
      cardBg: "bg-[#073642]/60 border-[#586e75]/50",
      boxBg: "bg-[#002b36]/80 border-[#586e75]/40",
      boxBgSubtle: "bg-[#002b36] border-[#586e75]/40",
      border: "border-[#586e75]/50",
      textPrimary: "text-[#93a1a1] font-bold",
      textSecondary: "text-[#657b83] font-medium",
      textMuted: "text-[#586e75]",
      accentUp: "text-[#859900] font-bold",
      accentUpBg: "bg-[#859900]/20 border-[#859900]/50 text-[#859900] font-bold",
      accentDown: "text-[#dc322f] font-bold",
      accentDownBg: "bg-[#dc322f]/20 border-[#dc322f]/50 text-[#dc322f] font-bold",
      accentPrimary: "text-[#2aa198] font-bold",
      accentPrimaryBg: "bg-[#2aa198]/20 border-[#2aa198]/50 text-[#2aa198] font-bold",
      chartBg: "#002b36",
      chartGrid: "#073642",
      chartText: "#657b83",
      candleGreen: "#859900",
      candleRed: "#dc322f"
    }
  };

  const currentTheme = paletteThemeMap[palette];

  // Dynamic Theme Token Classes for QA Accuracy
  const titleColor = currentTheme.textPrimary;
  const labelColor = currentTheme.textSecondary;
  const mutedColor = currentTheme.textMuted;
  const btnIdleBg = currentTheme.isLight
    ? "bg-slate-200 text-slate-900 border-slate-300 font-extrabold hover:bg-slate-300"
    : "bg-slate-900 text-slate-400 border-slate-800 font-medium hover:text-slate-200";

  const densityPaddingMap: Record<DensityPreset, { card: string; table: string; badge: string; textBase: string }> = {
    compact: { card: "p-2.5 lg:p-3 gap-2", table: "py-1.5 px-2.5 text-[11px]", badge: "px-1.5 py-0.5 text-[9px]", textBase: "text-xs" },
    medium: { card: "p-4 gap-3", table: "py-2 px-3 text-xs", badge: "px-2 py-1 text-[10px]", textBase: "text-sm" },
    relaxed: { card: "p-5 gap-4", table: "py-3 px-4 text-sm", badge: "px-2.5 py-1 text-xs", textBase: "text-base" }
  };

  const lineHeightMap: Record<LineHeightPreset, string> = {
    tight: "leading-tight",
    normal: "leading-normal",
    relaxed: "leading-relaxed"
  };

  const trackingMap: Record<TrackingPreset, string> = {
    tight: "tracking-tighter",
    normal: "tracking-normal",
    wide: "tracking-wider"
  };

  // Container Border Styles
  const containerStyle = minimalistMode
    ? `${currentTheme.cardBg} rounded-md transition-all duration-200 shadow-none`
    : "glass-panel rounded-xl shadow-lg border border-accent/20 hover:border-accent/40 transition-all duration-300";

  const cardHeaderStyle = `${labelColor} uppercase tracking-widest text-[10px]`;

  // Dynamic Grid Columns
  let centerColSpan = "lg:col-span-6";
  if (isLeftSidebarCollapsed && isRightSidebarCollapsed) {
    centerColSpan = "lg:col-span-12";
  } else if (isLeftSidebarCollapsed || isRightSidebarCollapsed) {
    centerColSpan = "lg:col-span-9";
  }

  // Realistic Chart SVG Coordinates & Helpers
  const minPrice = 3390.0;
  const maxPrice = 3530.0;
  const svgHeight = 280;
  const svgWidth = 780;
  const volumeHeight = 50;

  const priceToY = (price: number) => {
    return (1 - (price - minPrice) / (maxPrice - minPrice)) * (svgHeight - volumeHeight - 20) + 10;
  };

  return (
    <div
      style={{ fontFamily: fontStyleMap[fontFamily] }}
      className={`min-h-screen ${currentTheme.bg} ${titleColor} ${lineHeightMap[lineHeight]} ${trackingMap[tracking]} ${currentTheme.isLight ? "sandbox-light-theme" : ""}`}
    >
      {/* ──────────────────────────────────────────────────────────────────────────
          SCOPED STYLE OVERRIDE FOR LIGHT MODE TO DEFEAT GLOBALS.CSS !IMPORTANT
         ────────────────────────────────────────────────────────────────────────── */}
      {currentTheme.isLight && (
        <style>{`
          .sandbox-light-theme,
          .sandbox-light-theme *,
          .sandbox-light-theme h1,
          .sandbox-light-theme h2,
          .sandbox-light-theme h3,
          .sandbox-light-theme h4,
          .sandbox-light-theme h5,
          .sandbox-light-theme h6,
          .sandbox-light-theme .text-title,
          .sandbox-light-theme .text-foreground {
            color: #0f172a !important;
          }
          .sandbox-light-theme select,
          .sandbox-light-theme option {
            background-color: #ffffff !important;
            color: #0f172a !important;
            font-weight: 800 !important;
          }
          .sandbox-light-theme input {
            background-color: #ffffff !important;
            color: #0f172a !important;
            font-weight: 800 !important;
          }
          .sandbox-light-theme .text-slate-400,
          .sandbox-light-theme .text-slate-500,
          .sandbox-light-theme .text-muted {
            color: #475569 !important;
          }
          .sandbox-light-theme .text-slate-600,
          .sandbox-light-theme .text-slate-700,
          .sandbox-light-theme .text-slate-800,
          .sandbox-light-theme .text-slate-900 {
            color: #0f172a !important;
          }
          .sandbox-light-theme .text-emerald-400,
          .sandbox-light-theme .text-emerald-500,
          .sandbox-light-theme .text-emerald-600,
          .sandbox-light-theme .text-emerald-700 {
            color: #047857 !important;
          }
          .sandbox-light-theme .text-rose-400,
          .sandbox-light-theme .text-rose-500,
          .sandbox-light-theme .text-rose-600,
          .sandbox-light-theme .text-rose-700 {
            color: #be123c !important;
          }
          .sandbox-light-theme .text-purple-400,
          .sandbox-light-theme .text-purple-500,
          .sandbox-light-theme .text-purple-600,
          .sandbox-light-theme .text-purple-700 {
            color: #6b21a8 !important;
          }
        `}</style>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          TOP PLAYGROUND CONTROLS HEADER (FIXED TOOLBAR)
         ────────────────────────────────────────────────────────────────────────── */}
      <div className={`sticky top-0 z-50 ${currentTheme.toolbarBg} backdrop-blur-md px-3 lg:px-6 py-2.5 shadow-md`}>
        <div className="w-full flex flex-wrap items-center justify-between gap-3">
          {/* Title & Badge */}
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded ${currentTheme.isLight ? "bg-purple-600 text-white" : "bg-purple-500/10 border border-purple-500/30 text-purple-400"}`}>
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-black uppercase ${currentTheme.isLight ? "text-purple-900" : currentTheme.accentPrimary} tracking-wider`}>
                  Phase 1 Sandbox
                </span>
                <span className={`px-2 py-0.5 text-[9px] font-black ${currentTheme.isLight ? "bg-slate-200 text-slate-900 border border-slate-300" : "bg-slate-800 text-slate-300 border border-slate-700"} rounded`}>
                  Full Live Engine Data + AI Area
                </span>
              </div>
              <h1 className={`text-xs lg:text-sm font-black ${titleColor}`}>
                Quant UI/UX Minimalist Playground
              </h1>
            </div>
          </div>

          {/* Interactive Controls Group */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            {/* Expanded Font Selector */}
            <div className={`flex items-center gap-1.5 ${currentTheme.isLight ? "bg-white border-slate-300" : "bg-slate-950/80 border-slate-800"} border rounded px-2.5 py-1`}>
              <span className={`text-[10px] ${labelColor} uppercase font-bold`}>Font:</span>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as FontOption)}
                style={{ color: currentTheme.isLight ? "#0f172a" : undefined }}
                className="bg-transparent text-xs focus:outline-none cursor-pointer font-black"
              >
                <option value="geist-mono" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>Geist Mono (Tabular)</option>
                <option value="geist-sans" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>Geist Sans</option>
                <option value="jetbrains-mono" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>JetBrains Mono</option>
                <option value="fira-code" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>Fira Code (Ligatures)</option>
                <option value="space-mono" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>Space Mono (Brutalist)</option>
                <option value="roboto-mono" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>Roboto Mono</option>
                <option value="inter-sans" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>Inter Sans</option>
                <option value="sf-pro" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>SF Pro System</option>
                <option value="system-mono" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>System Monospace</option>
              </select>
            </div>

            {/* Color Palette Selector */}
            <div className={`flex items-center gap-1.5 ${currentTheme.isLight ? "bg-white border-slate-300" : "bg-slate-950/80 border-slate-800"} border rounded px-2.5 py-1`}>
              <Palette className={`w-3.5 h-3.5 ${currentTheme.isLight ? "text-amber-700" : "text-amber-500"}`} />
              <span className={`text-[10px] ${labelColor} uppercase font-bold`}>Theme:</span>
              <select
                value={palette}
                onChange={(e) => setPalette(e.target.value as PaletteOption)}
                style={{ color: currentTheme.isLight ? "#0f172a" : undefined }}
                className="bg-transparent text-xs focus:outline-none cursor-pointer font-black"
              >
                <option value="daylight" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>☀️ Daylight Studio (Light Mode)</option>
                <option value="obsidian" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>🌌 Obsidian Dark (Default)</option>
                <option value="slate" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>🌙 Midnight Slate (Soft Eye)</option>
                <option value="bloomberg" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>📊 Bloomberg Gold Terminal</option>
                <option value="nordic" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>❄️ Nordic Cold Navy</option>
                <option value="solarized" style={{ color: "#0f172a", backgroundColor: "#ffffff" }}>🌊 Solarized Midnight (Teal)</option>
              </select>
            </div>

            {/* JSON Stream Drawer Toggle */}
            <button
              onClick={() => setIsJsonDrawerOpen(!isJsonDrawerOpen)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs border transition-all cursor-pointer ${
                isJsonDrawerOpen
                  ? "bg-purple-600 text-white font-black"
                  : btnIdleBg
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>JSON Stream</span>
            </button>

            {/* Density Controls */}
            <div className={`flex items-center gap-1 ${currentTheme.isLight ? "bg-white border-slate-300" : "bg-slate-950/80 border-slate-800"} border rounded p-1`}>
              <span className={`text-[10px] ${labelColor} uppercase px-1 font-bold`}>Density:</span>
              {(["compact", "medium", "relaxed"] as DensityPreset[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDensity(d)}
                  className={`px-2 py-0.5 rounded text-[10px] uppercase transition-colors cursor-pointer ${
                    density === d
                      ? "bg-purple-600 text-white font-black"
                      : btnIdleBg
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>

            {/* Line Height Controls */}
            <div className={`flex items-center gap-1 ${currentTheme.isLight ? "bg-white border-slate-300" : "bg-slate-950/80 border-slate-800"} border rounded p-1`}>
              <span className={`text-[10px] ${labelColor} uppercase px-1 font-bold`}>Line Ht:</span>
              {(["tight", "normal", "relaxed"] as LineHeightPreset[]).map((lh) => (
                <button
                  key={lh}
                  onClick={() => setLineHeight(lh)}
                  className={`px-2 py-0.5 rounded text-[10px] uppercase transition-colors cursor-pointer ${
                    lineHeight === lh
                      ? "bg-indigo-600 text-white font-black"
                      : btnIdleBg
                  }`}
                >
                  {lh}
                </button>
              ))}
            </div>

            {/* Tracking Controls */}
            <div className={`flex items-center gap-1 ${currentTheme.isLight ? "bg-white border-slate-300" : "bg-slate-950/80 border-slate-800"} border rounded p-1`}>
              <span className={`text-[10px] ${labelColor} uppercase px-1 font-bold`}>Tracking:</span>
              {(["tight", "normal", "wide"] as TrackingPreset[]).map((tr) => (
                <button
                  key={tr}
                  onClick={() => setTracking(tr)}
                  className={`px-2 py-0.5 rounded text-[10px] uppercase transition-colors cursor-pointer ${
                    tracking === tr
                      ? "bg-cyan-600 text-white font-black"
                      : btnIdleBg
                  }`}
                >
                  {tr}
                </button>
              ))}
            </div>

            {/* Minimalist Mode Toggle */}
            <button
              onClick={() => setMinimalistMode(!minimalistMode)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs border transition-all cursor-pointer ${
                minimalistMode
                  ? `${currentTheme.accentUpBg} font-black`
                  : "bg-amber-100 border-amber-400 text-amber-950 font-black"
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {minimalistMode ? "Minimalist: ON" : "Legacy Style: ON"}
            </button>

            {/* Global Sidebars Toggle Shortcuts */}
            <div className={`flex items-center gap-1 border-l ${currentTheme.border} pl-2`}>
              <button
                onClick={() => setIsLeftSidebarCollapsed(!isLeftSidebarCollapsed)}
                className={`p-1.5 rounded border transition-colors cursor-pointer ${
                  isLeftSidebarCollapsed
                    ? currentTheme.accentPrimaryBg
                    : btnIdleBg
                }`}
                title={isLeftSidebarCollapsed ? "Expand Left Quantitative Sidebar" : "Collapse Left Quantitative Sidebar"}
              >
                {isLeftSidebarCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => setIsRightSidebarCollapsed(!isRightSidebarCollapsed)}
                className={`p-1.5 rounded border transition-colors cursor-pointer ${
                  isRightSidebarCollapsed
                    ? currentTheme.accentPrimaryBg
                    : btnIdleBg
                }`}
                title={isRightSidebarCollapsed ? "Expand Right Strategy Sidebar" : "Collapse Right Strategy Sidebar"}
              >
                {isRightSidebarCollapsed ? <PanelRightOpen className="w-3.5 h-3.5" /> : <PanelRightClose className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────
          MAIN FLUID DEMO CANVAS CONTAINER
         ────────────────────────────────────────────────────────────────────────── */}
      <div className="w-full px-3 lg:px-6 py-4 space-y-3 relative">

        {/* JSON STREAM DRAWER OVERLAY */}
        {isJsonDrawerOpen && (
          <div className={`fixed top-14 right-4 z-50 w-96 max-w-full ${currentTheme.cardBg} border ${currentTheme.border} rounded-lg shadow-2xl p-4 space-y-3 animate-in slide-in-from-right duration-200`}>
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-purple-600" />
                <span className={`text-xs font-black ${titleColor} uppercase tracking-wider`}>JSON Data Stream Drawer</span>
              </div>
              <button onClick={() => setIsJsonDrawerOpen(false)} className={`${labelColor} p-1 hover:${titleColor}`}>✕</button>
            </div>
            <pre className={`text-[10px] ${currentTheme.isLight ? "bg-slate-100 text-slate-900" : "bg-slate-950 text-emerald-400"} p-3 rounded overflow-x-auto max-h-80 font-mono select-all border ${currentTheme.border}`}>
              {JSON.stringify({
                symbol: "ETHUSDT",
                session: "NY_AM_KILLZONE",
                cairo_anchor: 3412.00,
                ipda_metrics: { current_trend: "BULLISH", pricing: "DISCOUNT_48.2%" },
                institutional_sponsorship: { status: "DISPLACEMENT_BULLISH", ols_r2: 0.892, t_stat: 3.842 },
                active_fvg: { timeframe: "5m", low: 3440.00, high: 3448.50 },
                liquidity_pools: { BSL: 3520.00, SSL: 3380.00 }
              }, null, 2)}
            </pre>
            <div className="flex justify-end">
              <button
                onClick={handleCopyAiPrompt}
                className={`px-3 py-1 text-xs ${currentTheme.accentPrimaryBg} rounded font-black cursor-pointer flex items-center gap-1.5`}
              >
                {copiedPrompt ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedPrompt ? "Copied JSON!" : "Copy Payload JSON"}
              </button>
            </div>
          </div>
        )}

        {/* 1. MOCK NAVIGATION HEADER REGION */}
        <div className={containerStyle}>
          <div className={`flex flex-wrap items-center justify-between ${densityPaddingMap[density].card}`}>
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center font-black text-xs text-white shadow">
                FS
              </div>
              <span className={`text-xs font-black ${titleColor}`}>
                ETHUSDT <span className={labelColor}>Perp</span>
              </span>
              <span className={`px-1.5 py-0.5 text-[9px] ${currentTheme.accentPrimaryBg} rounded font-bold`}>
                5m Timeframe
              </span>
              <span className={`px-2 py-0.5 text-[9px] ${currentTheme.accentUpBg} rounded font-black uppercase tracking-wider`}>
                [NY AM KILLZONE]
              </span>
              <span className={`text-[10px] ${labelColor} border-l ${currentTheme.border} pl-3 hidden md:inline`}>
                Active Palette: <strong className={titleColor}>{palette.toUpperCase()}</strong> • Mode: <strong className={titleColor}>{currentTheme.isLight ? "LIGHT" : "DARK"}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <div className={`flex items-center gap-1.5 px-2.5 py-1 ${currentTheme.boxBgSubtle} border ${currentTheme.border} rounded`}>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className={`text-[10px] ${labelColor} font-bold`}>NY MIDNIGHT 07:00 CAIRO:</span>
                <span className={`${currentTheme.accentUp} font-black tabular-nums`}>$3,412.00</span>
              </div>
              <div className={`px-2.5 py-1 ${currentTheme.boxBgSubtle} border ${currentTheme.border} rounded ${titleColor} text-[10px] font-black tabular-nums`}>
                Cairo: 13:49:48 UTC+3
              </div>
              <div className={`flex items-center gap-1.5 pl-2 border-l ${currentTheme.border} ${labelColor} text-[10px] font-bold`}>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>WS ONLINE</span>
              </div>
            </div>
          </div>
        </div>

        {/* 2. MOCK METRICS HUD CARDS SECTION */}
        <div className={containerStyle}>
          <div className={`flex items-center justify-between px-3 py-2 border-b ${currentTheme.border} ${currentTheme.isLight ? "bg-slate-200/80" : "bg-slate-900/40"}`}>
            <span className={`text-[10px] font-black ${titleColor} uppercase tracking-widest flex items-center gap-1.5`}>
              <BarChart3 className={`w-3.5 h-3.5 ${currentTheme.isLight ? "text-purple-800" : "text-purple-400"}`} /> Key Institutional Metrics HUD
            </span>
            <button
              onClick={() => toggleCard("metricsHud")}
              className={`${labelColor} hover:${titleColor} transition-colors p-1 cursor-pointer`}
            >
              {collapsedCards.metricsHud ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>

          {!collapsedCards.metricsHud && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-3">
              {/* Card 1: Master Bias */}
              <div className={`${currentTheme.boxBg} p-3 rounded flex flex-col justify-between border ${currentTheme.border}`}>
                <div className="flex items-center justify-between">
                  <span className={cardHeaderStyle}>Master Bias</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                </div>
                <div className="mt-2">
                  <div className={`text-xl lg:text-2xl font-black ${currentTheme.accentUp} tracking-tight`}>
                    BULLISH
                  </div>
                  <div className={`text-[10px] ${labelColor} mt-0.5 font-bold`}>
                    Directional Lock Confirmed (Cairo 07:00 Anchor)
                  </div>
                </div>
              </div>

              {/* Card 2: Range Context */}
              <div className={`${currentTheme.boxBg} p-3 rounded flex flex-col justify-between border ${currentTheme.border}`}>
                <div className="flex items-center justify-between">
                  <span className={cardHeaderStyle}>Range Context</span>
                  <span className={`text-[10px] ${titleColor} tabular-nums font-bold`}>EQ: $3,440.00</span>
                </div>
                <div className="mt-2">
                  <div className={`text-xl lg:text-2xl font-black ${currentTheme.accentUp} tracking-tight`}>
                    DISCOUNT <span className={`text-xs font-black ${labelColor} tabular-nums`}>(48.2%)</span>
                  </div>
                  <div className={`text-[10px] ${labelColor} mt-0.5 tabular-nums font-bold`}>
                    Dealing Range Height: $67.30 (48.2% to EQ)
                  </div>
                </div>
              </div>

              {/* Card 3: Target Status */}
              <div className={`${currentTheme.boxBg} p-3 rounded flex flex-col justify-between border ${currentTheme.border}`}>
                <div className="flex items-center justify-between">
                  <span className={cardHeaderStyle}>Target Status (DOL)</span>
                  <span className={`text-[10px] ${labelColor} font-bold`}>BSL Purged</span>
                </div>
                <div className="mt-2">
                  <div className={`text-xl lg:text-2xl font-black ${currentTheme.isLight ? "text-cyan-800" : "text-cyan-400"} tracking-tight`}>
                    EXHAUSTED
                  </div>
                  <div className={`text-[10px] ${labelColor} mt-0.5 tabular-nums font-bold`}>
                    Major High Pierced at $3,485.50
                  </div>
                </div>
              </div>

              {/* Card 4: Volumetric Sponsorship */}
              <div className={`${currentTheme.boxBg} p-3 rounded flex flex-col justify-between border ${currentTheme.border}`}>
                <div className="flex items-center justify-between">
                  <span className={cardHeaderStyle}>Volumetric Vector</span>
                  <span className={`text-[10px] ${currentTheme.accentUp} tabular-nums font-bold`}>OLS R² = 0.892</span>
                </div>
                <div className="mt-2">
                  <div className={`text-xl lg:text-2xl font-black ${currentTheme.accentPrimary} tracking-tight`}>
                    +4.25x <span className={`text-xs font-bold ${labelColor}`}>ATR</span>
                  </div>
                  <div className={`text-[10px] ${labelColor} mt-0.5 tabular-nums font-bold`}>
                    Displacement Active • t-STAT +3.84 • p-VAL 0.00018
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 3. FLUID DYNAMIC GRID VIEW */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
          
          {/* LEFT SIDEBAR: QUANTITATIVE METRICS & LIVE ENGINE BOXES */}
          {!isLeftSidebarCollapsed && (
            <div className="lg:col-span-3 space-y-3 transition-all">
              <div className={`flex items-center justify-between px-3 py-1.5 ${currentTheme.isLight ? "bg-slate-200/80" : "bg-slate-900/80"} border ${currentTheme.border} rounded`}>
                <span className={`text-xs font-black ${titleColor} uppercase tracking-wider flex items-center gap-1.5`}>
                  <Activity className={`w-3.5 h-3.5 ${currentTheme.accentPrimary}`} /> Quant Telemetry
                </span>
                <button
                  onClick={() => setIsLeftSidebarCollapsed(true)}
                  className={`p-1 ${labelColor} hover:${titleColor} transition-colors cursor-pointer`}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>

              {/* IPDA Metrics Panel */}
              <div className={containerStyle}>
                <div className={`flex items-center justify-between px-3 py-2 border-b ${currentTheme.border} ${currentTheme.isLight ? "bg-slate-200/50" : ""}`}>
                  <span className={`text-xs font-black ${titleColor} uppercase tracking-wider`}>IPDA Reference Levels</span>
                  <button onClick={() => toggleCard("ipdaLevels")} className={`${labelColor} p-0.5 cursor-pointer`}>
                    {collapsedCards.ipdaLevels ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {!collapsedCards.ipdaLevels && (
                  <div className={`space-y-2 text-xs ${densityPaddingMap[density].card}`}>
                    <div className="flex justify-between items-center">
                      <span className={labelColor}>True Day Open (07:00 Cairo):</span>
                      <span className={`${titleColor} tabular-nums font-black`}>$3,412.00</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={labelColor}>Asian Session High:</span>
                      <span className={`${currentTheme.accentDown} tabular-nums font-black`}>$3,465.50</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={labelColor}>Asian Session Low:</span>
                      <span className={`${currentTheme.accentUp} tabular-nums font-black`}>$3,398.20</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={labelColor}>London Open Anchor:</span>
                      <span className={`${titleColor} tabular-nums font-black`}>$3,428.10</span>
                    </div>
                  </div>
                )}
              </div>

              {/* CLONED BOX 1: Order Flow Pulse & OLS Statistical Engine */}
              <div className={containerStyle}>
                <div className={`flex items-center justify-between px-3 py-2 border-b ${currentTheme.border} ${currentTheme.isLight ? "bg-slate-200/50" : ""}`}>
                  <span className={`text-xs font-black ${titleColor} uppercase tracking-wider flex items-center gap-1.5`}>
                    <Zap className={`w-3.5 h-3.5 ${currentTheme.isLight ? "text-amber-700" : "text-amber-400"}`} /> Order Flow Pulse
                  </span>
                  <button onClick={() => toggleCard("orderFlowPulse")} className={`${labelColor} p-0.5 cursor-pointer`}>
                    {collapsedCards.orderFlowPulse ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {!collapsedCards.orderFlowPulse && (
                  <div className={`space-y-2 text-xs ${densityPaddingMap[density].card}`}>
                    <div className="flex justify-between items-center">
                      <span className={labelColor}>OI Trend:</span>
                      <span className={`${currentTheme.accentUp} font-black uppercase tracking-wider`}>BULLISH (+4.1%)</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={labelColor}>Displacement:</span>
                      <span className={`${currentTheme.accentUp} font-black uppercase tracking-wider`}>DISPLACEMENT_BULLISH</span>
                    </div>

                    <div className={`${currentTheme.boxBg} p-2 border ${currentTheme.border} rounded space-y-1`}>
                      <div className="flex justify-between text-[10px] items-center">
                        <span className={labelColor}>t-STAT:</span>
                        <span className={`${titleColor} font-black tabular-nums`}>+3.842</span>
                      </div>
                      <div className="flex justify-between text-[10px] items-center">
                        <span className={labelColor}>p-VALUE:</span>
                        <span className={`${titleColor} font-black tabular-nums`}>0.00018</span>
                      </div>
                      <div className="flex justify-between text-[10px] items-center">
                        <span className={labelColor}>OLS VALIDATION:</span>
                        <span className={`px-1 py-0.5 rounded text-[8px] font-black ${currentTheme.accentUpBg}`}>CONFIRMED</span>
                      </div>
                    </div>

                    <div className={`${currentTheme.boxBg} p-2 border ${currentTheme.border} rounded text-[10px]`}>
                      <span className={`${labelColor} font-black block uppercase mb-0.5`}>Smart Money Sentiment</span>
                      <p className={`${mutedColor} italic leading-tight`}>
                        Heavy Buy-Side Delta absorption on Asian Sweep low ($3,398.20).
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* CLONED BOX 2: Macro Liquidity & Asian Sweeps */}
              <div className={containerStyle}>
                <div className={`flex items-center justify-between px-3 py-2 border-b ${currentTheme.border} ${currentTheme.isLight ? "bg-slate-200/50" : ""}`}>
                  <span className={`text-xs font-black ${titleColor} uppercase tracking-wider flex items-center gap-1.5`}>
                    <Magnet className={`w-3.5 h-3.5 ${currentTheme.isLight ? "text-cyan-800" : "text-cyan-400"}`} /> Macro Liquidity Ranges
                  </span>
                  <button onClick={() => toggleCard("macroLiquidity")} className={`${labelColor} p-0.5 cursor-pointer`}>
                    {collapsedCards.macroLiquidity ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {!collapsedCards.macroLiquidity && (
                  <div className={`space-y-2 text-xs ${densityPaddingMap[density].card}`}>
                    <div className="grid grid-cols-2 gap-2">
                      <div className={`${currentTheme.boxBg} p-2 border ${currentTheme.border} rounded`}>
                        <span className={`text-[9px] ${labelColor} uppercase font-bold block`}>Prev Day High</span>
                        <span className={`${titleColor} font-black tabular-nums text-xs`}>$3,485.50</span>
                      </div>
                      <div className={`${currentTheme.boxBg} p-2 border ${currentTheme.border} rounded`}>
                        <span className={`text-[9px] ${labelColor} uppercase font-bold block`}>Prev Day Low</span>
                        <span className={`${titleColor} font-black tabular-nums text-xs`}>$3,395.00</span>
                      </div>
                    </div>

                    <div className={`${currentTheme.boxBg} p-2 border ${currentTheme.border} rounded space-y-1.5`}>
                      <div className="flex justify-between items-center">
                        <span className={`text-[10px] ${labelColor} uppercase font-bold`}>Asian High:</span>
                        <div className="flex items-center gap-1">
                          <span className={`${titleColor} font-black tabular-nums`}>$3,465.50</span>
                          <span className={`px-1 py-0.5 text-[8px] font-black rounded ${currentTheme.accentDownBg}`}>SWEPT 🧹</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className={`text-[10px] ${labelColor} uppercase font-bold`}>Asian Low:</span>
                        <div className="flex items-center gap-1">
                          <span className={`${titleColor} font-black tabular-nums`}>$3,398.20</span>
                          <span className={`px-1 py-0.5 text-[8px] font-black rounded ${currentTheme.accentUpBg}`}>SWEPT 🧹</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CENTER: REALISTIC FINANCIAL SVG CHART SECTION */}
          <div className={`${centerColSpan} space-y-3 transition-all duration-300 relative`}>
            
            {/* Quick Expand Handles */}
            <div className="flex items-center justify-between gap-2">
              {isLeftSidebarCollapsed && (
                <button
                  onClick={() => setIsLeftSidebarCollapsed(false)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 ${currentTheme.accentPrimaryBg} text-[10px] font-black rounded cursor-pointer`}
                >
                  <ChevronRight className="w-3.5 h-3.5" /> EXPAND LEFT SIDEBAR
                </button>
              )}
              {isRightSidebarCollapsed && (
                <button
                  onClick={() => setIsRightSidebarCollapsed(false)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 ${currentTheme.accentPrimaryBg} text-[10px] font-black rounded cursor-pointer ml-auto`}
                >
                  EXPAND RIGHT SIDEBAR <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* REALISTIC MULTI-LAYER CHART CONTAINER */}
            <div className={`${containerStyle} ${densityPaddingMap[density].card} flex flex-col justify-between`}>
              {/* Ticker HUD Header */}
              <div className={`flex flex-wrap items-center justify-between border-b ${currentTheme.border} pb-2`}>
                <div className="flex items-center gap-3">
                  <span className={`text-base font-black ${titleColor}`}>ETHUSDT</span>
                  <span className={`text-lg font-black ${currentTheme.accentUp} tabular-nums`}>$3,456.80</span>
                  <span className={`text-xs ${currentTheme.accentUpBg} px-1.5 py-0.5 rounded font-black tabular-nums`}>
                    +3.42%
                  </span>
                </div>

                {/* Interactive Chart Layer Toggles */}
                <div className="flex items-center gap-1.5 text-[10px]">
                  <button
                    onClick={() => setShowFvgOverlay(!showFvgOverlay)}
                    className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                      showFvgOverlay ? currentTheme.accentPrimaryBg : btnIdleBg
                    }`}
                  >
                    FVG Overlay
                  </button>
                  <button
                    onClick={() => setShowBosOverlay(!showBosOverlay)}
                    className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                      showBosOverlay ? currentTheme.accentUpBg : btnIdleBg
                    }`}
                  >
                    BOS/MSS
                  </button>
                  <button
                    onClick={() => setShowLiquidityOverlay(!showLiquidityOverlay)}
                    className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                      showLiquidityOverlay ? (currentTheme.isLight ? "bg-cyan-100 text-cyan-900 border-cyan-300 font-black" : "bg-cyan-950/80 text-cyan-300 border-cyan-700 font-black") : btnIdleBg
                    }`}
                  >
                    BSL/SSL Pools
                  </button>
                  <button
                    onClick={() => toggleCard("chartArea")}
                    className={`${labelColor} hover:${titleColor} transition-colors p-0.5 cursor-pointer ml-2`}
                  >
                    {collapsedCards.chartArea ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {!collapsedCards.chartArea && (
                /* HIGHLY DETAILED REALISTIC SVG FINANCIAL CHART */
                <div className={`my-2 ${currentTheme.isLight ? "bg-white border-slate-300" : "bg-slate-950/90 border-slate-800/80"} border rounded p-2 overflow-x-auto relative`}>
                  <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto select-none">
                    <defs>
                      <linearGradient id="fvgGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a855f7" stopOpacity={currentTheme.isLight ? "0.2" : "0.3"} />
                        <stop offset="100%" stopColor="#a855f7" stopOpacity="0.05" />
                      </linearGradient>
                    </defs>

                    {/* Background Chart Rect */}
                    <rect x="0" y="0" width={svgWidth} height={svgHeight} fill={currentTheme.chartBg} />

                    {/* Grid Lines */}
                    {[3400, 3420, 3440, 3460, 3480, 3500].map((p) => {
                      const y = priceToY(p);
                      return (
                        <g key={p}>
                          <line x1="0" y1={y} x2={svgWidth} y2={y} stroke={currentTheme.chartGrid} strokeDasharray="3 3" strokeWidth="0.8" />
                          <text x={svgWidth - 45} y={y - 3} fill={currentTheme.chartText} fontSize="9" fontWeight="bold">
                            ${p}
                          </text>
                        </g>
                      );
                    })}

                    {/* 1. Liquidity Lines */}
                    {showLiquidityOverlay && (
                      <>
                        <line x1="0" y1={priceToY(3520)} x2={svgWidth} y2={priceToY(3520)} stroke="#059669" strokeWidth="1.5" strokeDasharray="4 2" />
                        <text x="10" y={priceToY(3520) - 4} fill="#059669" fontSize="9" fontWeight="bold">
                          BSL Liquidity Target Pool: $3,520.00 (850 ETH)
                        </text>

                        <line x1="0" y1={priceToY(3380)} x2={svgWidth} y2={priceToY(3380)} stroke="#e11d48" strokeWidth="1.5" strokeDasharray="4 2" />
                        <text x="10" y={priceToY(3380) + 12} fill="#e11d48" fontSize="9" fontWeight="bold">
                          SSL Liquidity Target Pool: $3,380.00 (1,240 ETH)
                        </text>
                      </>
                    )}

                    {/* 2. True Day Open Line */}
                    <line x1="0" y1={priceToY(3412)} x2={svgWidth} y2={priceToY(3412)} stroke="#d97706" strokeWidth="1.5" strokeDasharray="6 3" />
                    <text x={svgWidth - 160} y={priceToY(3412) - 4} fill="#d97706" fontSize="9" fontWeight="bold">
                      True Day Open (Cairo 07:00): $3,412.00
                    </text>

                    {/* 3. Fair Value Gap */}
                    {showFvgOverlay && (
                      <g>
                        <rect
                          x="220"
                          y={priceToY(3448.5)}
                          width="480"
                          height={priceToY(3440.0) - priceToY(3448.5)}
                          fill="url(#fvgGrad)"
                          stroke="#a855f7"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                        />
                        <text x="230" y={priceToY(3448.5) + 12} fill="#7e22ce" fontSize="9" fontWeight="bold">
                          Bullish FVG Zone [5m]: $3,440.00 – $3,448.50
                        </text>
                      </g>
                    )}

                    {/* 4. Market Structure Line */}
                    {showBosOverlay && (
                      <g>
                        <line x1="180" y1={priceToY(3450)} x2={svgWidth} y2={priceToY(3450)} stroke="#059669" strokeWidth="1.5" />
                        <rect x="360" y={priceToY(3450) - 10} width="110" height="14" rx="2" fill={currentTheme.isLight ? "#d1fae5" : "#064e3b"} stroke="#059669" strokeWidth="0.8" />
                        <text x="366" y={priceToY(3450)} fill={currentTheme.isLight ? "#065f46" : "#34d399"} fontSize="9" fontWeight="bold">
                          BOS CONFIRMED $3,450
                        </text>
                      </g>
                    )}

                    {/* 5. Realistic Candlesticks */}
                    {REALISTIC_CANDLES.map((c, i) => {
                      const x = 30 + i * 50;
                      const isBull = c.c >= c.o;
                      const candleColor = isBull ? currentTheme.candleGreen : currentTheme.candleRed;
                      const wickColor = candleColor;

                      const yOpen = priceToY(c.o);
                      const yClose = priceToY(c.c);
                      const yHigh = priceToY(c.h);
                      const yLow = priceToY(c.l);

                      const bodyTop = Math.min(yOpen, yClose);
                      const bodyHeight = Math.max(Math.abs(yOpen - yClose), 2);

                      return (
                        <g key={i}>
                          <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={wickColor} strokeWidth="1.5" />
                          <rect x={x - 8} y={bodyTop} width="16" height={bodyHeight} fill={candleColor} stroke={wickColor} strokeWidth="0.8" rx="1" />

                          {c.marker === "ARROW_UP" && (
                            <g>
                              <polygon points={`${x},${yHigh - 14} ${x - 5},${yHigh - 4} ${x + 5},${yHigh - 4}`} fill="#0284c7" />
                              <text x={x - 12} y={yHigh - 16} fill="#0284c7" fontSize="8" fontWeight="bold">▲ VOL</text>
                            </g>
                          )}
                          {c.marker === "CIRCLE_DOWN" && (
                            <g>
                              <circle cx={x} cy={yLow + 12} r="4" fill="#e11d48" />
                              <text x={x - 14} y={yLow + 24} fill="#e11d48" fontSize="8" fontWeight="bold">● SWEEP</text>
                            </g>
                          )}

                          {showVolumeDelta && (
                            <g>
                              <rect x={x - 8} y={svgHeight - (c.buyV / 1800) * volumeHeight} width="8" height={(c.buyV / 1800) * volumeHeight} fill={currentTheme.candleGreen} opacity={currentTheme.isLight ? "0.85" : "0.75"} />
                              <rect x={x} y={svgHeight - (c.sellV / 1800) * volumeHeight} width="8" height={(c.sellV / 1800) * volumeHeight} fill={currentTheme.candleRed} opacity={currentTheme.isLight ? "0.85" : "0.75"} />
                            </g>
                          )}

                          <text x={x - 10} y={svgHeight - volumeHeight - 4} fill={currentTheme.chartText} fontSize="8" fontWeight="bold">
                            {c.t}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}
            </div>

            {/* Interactive Order Entry HUD */}
            <div className={containerStyle}>
              <div className={`flex items-center justify-between px-3 py-2 border-b ${currentTheme.border} ${currentTheme.isLight ? "bg-slate-200/50" : ""}`}>
                <span className={`text-[10px] font-black ${titleColor} uppercase tracking-widest flex items-center gap-1.5`}>
                  <Crosshair className={`w-3.5 h-3.5 ${currentTheme.isLight ? "text-purple-800" : "text-purple-400"}`} /> Interactive Order Entry HUD
                </span>
                <button onClick={() => toggleCard("orderPanel")} className={`${labelColor} p-0.5 cursor-pointer`}>
                  {collapsedCards.orderPanel ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                </button>
              </div>

              {!collapsedCards.orderPanel && (
                <div className={`p-3 space-y-3 text-xs ${densityPaddingMap[density].card}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className={`flex items-center gap-1 ${currentTheme.isLight ? "bg-white border-slate-300" : "bg-slate-950/40 border-slate-800"} p-1 border rounded`}>
                      {(["MARKET", "LIMIT", "STOP"] as const).map((ot) => (
                        <button
                          key={ot}
                          onClick={() => setOrderType(ot)}
                          className={`px-2 py-0.5 rounded text-[10px] font-black transition-colors cursor-pointer ${
                            orderType === ot ? "bg-purple-600 text-white font-black" : btnIdleBg
                          }`}
                        >
                          {ot}
                        </button>
                      ))}
                    </div>

                    <div className={`flex items-center gap-1 ${currentTheme.isLight ? "bg-white border-slate-300" : "bg-slate-950/40 border-slate-800"} p-1 border rounded`}>
                      <button
                        onClick={() => setOrderDirection("LONG")}
                        className={`px-3 py-0.5 rounded text-[10px] font-black transition-colors cursor-pointer ${
                          orderDirection === "LONG" ? "bg-emerald-600 text-white" : btnIdleBg
                        }`}
                      >
                        LONG 🟢
                      </button>
                      <button
                        onClick={() => setOrderDirection("SHORT")}
                        className={`px-3 py-0.5 rounded text-[10px] font-black transition-colors cursor-pointer ${
                          orderDirection === "SHORT" ? "bg-rose-600 text-white" : btnIdleBg
                        }`}
                      >
                        SHORT 🔴
                      </button>
                    </div>

                    <div className={`flex items-center gap-1 ${currentTheme.isLight ? "bg-white border-slate-300" : "bg-slate-950/40 border-slate-800"} p-1 border rounded`}>
                      <span className={`text-[10px] ${labelColor} uppercase px-1 font-bold`}>Risk:</span>
                      {[0.5, 1.0, 2.5].map((r) => (
                        <button
                          key={r}
                          onClick={() => setRiskPercent(r)}
                          className={`px-2 py-0.5 rounded text-[10px] font-black transition-colors cursor-pointer ${
                            riskPercent === r ? "bg-cyan-600 text-white" : btnIdleBg
                          }`}
                        >
                          {r}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <div className={`${currentTheme.boxBg} border ${currentTheme.border} p-2 rounded`}>
                      <span className={`text-[9px] ${labelColor} uppercase font-black`}>Entry Price</span>
                      <input
                        type="number"
                        defaultValue="3456.80"
                        disabled={orderType === "MARKET"}
                        className={`w-full bg-transparent ${titleColor} font-black text-xs focus:outline-none tabular-nums`}
                      />
                    </div>
                    <div className={`${currentTheme.boxBg} border ${currentTheme.border} p-2 rounded`}>
                      <span className={`text-[9px] ${currentTheme.accentDown} uppercase font-black`}>Stop Loss</span>
                      <input
                        type="number"
                        defaultValue="3410.00"
                        className={`w-full bg-transparent ${currentTheme.accentDown} font-black text-xs focus:outline-none tabular-nums`}
                      />
                    </div>
                    <div className={`${currentTheme.boxBg} border ${currentTheme.border} p-2 rounded`}>
                      <span className={`text-[9px] ${currentTheme.accentUp} uppercase font-black`}>Take Profit</span>
                      <input
                        type="number"
                        defaultValue="3510.00"
                        className={`w-full bg-transparent ${currentTheme.accentUp} font-black text-xs focus:outline-none tabular-nums`}
                      />
                    </div>
                    <div className={`${currentTheme.boxBg} border ${currentTheme.border} p-2 rounded flex flex-col justify-center`}>
                      <span className={`text-[9px] ${labelColor} uppercase font-black`}>Est. R:R Ratio</span>
                      <span className={`${currentTheme.accentUp} font-black text-xs tabular-nums`}>1 : 5.67</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT SIDEBAR: AI AREA & STRATEGY INSPECTOR */}
          {!isRightSidebarCollapsed && (
            <div className="lg:col-span-3 space-y-3 transition-all">
              <div className={`flex items-center justify-between px-3 py-1.5 ${currentTheme.isLight ? "bg-slate-200/80" : "bg-slate-900/80"} border ${currentTheme.border} rounded`}>
                <span className={`text-xs font-black ${titleColor} uppercase tracking-wider flex items-center gap-1.5`}>
                  <Brain className={`w-3.5 h-3.5 ${currentTheme.accentPrimary}`} /> AI Synthesis & Strategy
                </span>
                <button
                  onClick={() => setIsRightSidebarCollapsed(true)}
                  className={`p-1 ${labelColor} hover:${titleColor} transition-colors cursor-pointer`}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* CLONED BOX 3: AI SYNTHESIS CONSOLE & LLM ASSISTANT AREA */}
              <div className={containerStyle}>
                <div className={`flex items-center justify-between px-3 py-2 border-b ${currentTheme.border} ${currentTheme.isLight ? "bg-slate-200/50" : ""}`}>
                  <div className="flex items-center gap-1.5">
                    <Terminal className={`w-3.5 h-3.5 ${currentTheme.isLight ? "text-purple-800" : "text-purple-400"}`} />
                    <span className={`text-xs font-black ${titleColor} uppercase tracking-wider`}>AI Synthesis Console</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleCopyAiPrompt}
                      className={`p-1 text-[10px] font-bold ${labelColor} hover:${titleColor} cursor-pointer`}
                      title="Copy AI Prompt Prefix"
                    >
                      {copiedPrompt ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => toggleCard("aiConsole")} className={`${labelColor} p-0.5 cursor-pointer`}>
                      {collapsedCards.aiConsole ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {!collapsedCards.aiConsole && (
                  <div className={`space-y-3.5 text-xs ${densityPaddingMap[density].card}`}>
                    {/* Live AI Analysis Results Table */}
                    {aiAnalysisResult && (
                      <div className={`border ${currentTheme.border} rounded overflow-hidden`}>
                        <table className="w-full text-left border-collapse">
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            <tr className={`${currentTheme.boxBg}`}>
                              <td className={`p-1.5 text-[9px] font-black uppercase ${labelColor} border-r ${currentTheme.border}`}>BIAS</td>
                              <td className={`p-1.5 text-[10px] font-black ${currentTheme.accentUp}`}>{aiAnalysisResult.bias}</td>
                            </tr>
                            <tr className={`${currentTheme.boxBg}`}>
                              <td className={`p-1.5 text-[9px] font-black uppercase ${labelColor} border-r ${currentTheme.border}`}>STRENGTH</td>
                              <td className={`p-1.5 text-[10px] font-bold ${titleColor}`}>{aiAnalysisResult.bias_strength}</td>
                            </tr>
                            <tr className={`${currentTheme.boxBg}`}>
                              <td className={`p-1.5 text-[9px] font-black uppercase ${labelColor} border-r ${currentTheme.border}`}>ACTION SETUP</td>
                              <td className={`p-1.5 text-[10px] font-bold ${currentTheme.accentPrimary}`}>{aiAnalysisResult.actionable_setups}</td>
                            </tr>
                            <tr className={`${currentTheme.boxBg}`}>
                              <td className={`p-1.5 text-[9px] font-black uppercase ${labelColor} border-r ${currentTheme.border}`}>DOL TARGET</td>
                              <td className={`p-1.5 text-[10px] font-black ${currentTheme.accentUp} tabular-nums`}>{aiAnalysisResult.dol_target}</td>
                            </tr>
                            <tr className={`${currentTheme.boxBg}`}>
                              <td className={`p-1.5 text-[9px] font-black uppercase ${labelColor} border-r ${currentTheme.border}`}>CONFIDENCE</td>
                              <td className={`p-1.5 text-[10px] font-black ${currentTheme.accentUp} tabular-nums`}>{aiAnalysisResult.confidence_score}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* AI Key Insight Note */}
                    <div className={`${currentTheme.boxBg} p-2.5 border ${currentTheme.border} rounded space-y-1`}>
                      <span className={`text-[9px] font-black uppercase ${currentTheme.isLight ? "text-purple-800" : "text-purple-300"} tracking-wider flex items-center gap-1`}>
                        <Brain className="w-3 h-3" /> Institutional Flow Synthesizer Note
                      </span>
                      <p className={`text-[10px] ${titleColor} italic leading-tight font-medium`}>
                        "{aiAnalysisResult?.key_observation}"
                      </p>
                    </div>

                    {/* Trigger AI Synthesis Button */}
                    <button
                      onClick={handleTriggerAiSynthesis}
                      disabled={isAiSynthesizing}
                      className={`w-full py-2 ${currentTheme.accentPrimaryBg} text-[10px] font-black uppercase tracking-widest rounded-full transition-all cursor-pointer flex items-center justify-center gap-2 shadow-sm`}
                    >
                      <Zap className={`w-3.5 h-3.5 ${isAiSynthesizing ? "animate-spin" : ""}`} />
                      <span>{isAiSynthesizing ? "Synthesizing Live Data..." : "Synthesize Live AI Analysis"}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Confluence Inspector Card */}
              <div className={containerStyle}>
                <div className={`flex items-center justify-between px-3 py-2 border-b ${currentTheme.border} ${currentTheme.isLight ? "bg-slate-200/50" : ""}`}>
                  <span className={`text-xs font-black ${titleColor} uppercase tracking-wider`}>Confluence Gates</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] ${currentTheme.accentUpBg} font-black rounded px-1.5 py-0.5 tabular-nums`}>
                      87% PASS
                    </span>
                    <button onClick={() => toggleCard("strategyConfluence")} className={`${labelColor} p-0.5 cursor-pointer`}>
                      {collapsedCards.strategyConfluence ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {!collapsedCards.strategyConfluence && (
                  <div className={`space-y-2 text-xs ${densityPaddingMap[density].card}`}>
                    <div className="flex justify-between items-center">
                      <span className={labelColor}>IPDA Range Filter:</span>
                      <span className={`${currentTheme.accentUp} font-black`}>PASS (Discount)</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={labelColor}>Volumetric Vector:</span>
                      <span className={`${currentTheme.accentUp} font-black tabular-nums`}>PASS (+4.25x)</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={labelColor}>OLS Validation ($R^2$):</span>
                      <span className={`${currentTheme.accentUp} font-black tabular-nums`}>PASS (0.892)</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={labelColor}>Liquidity Sweep:</span>
                      <span className={`${currentTheme.accentUp} font-black`}>PASS (INNER Low)</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Matrix Equation Weights Card */}
              <div className={containerStyle}>
                <div className={`flex items-center justify-between px-3 py-2 border-b ${currentTheme.border} ${currentTheme.isLight ? "bg-slate-200/50" : ""}`}>
                  <span className={`text-xs font-black ${titleColor} uppercase tracking-wider`}>Matrix Weights</span>
                  <button onClick={() => toggleCard("matrixWeights")} className={`${labelColor} p-0.5 cursor-pointer`}>
                    {collapsedCards.matrixWeights ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {!collapsedCards.matrixWeights && (
                  <div className={`space-y-1.5 text-xs ${densityPaddingMap[density].card}`}>
                    <div className="flex justify-between">
                      <span className={labelColor}>Displacement Weight:</span>
                      <span className={`${titleColor} font-black tabular-nums`}>0.35</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={labelColor}>Structural Alignment:</span>
                      <span className={`${titleColor} font-black tabular-nums`}>0.25</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={labelColor}>Proximity Sweep Multiplier:</span>
                      <span className={`${titleColor} font-black tabular-nums`}>0.20</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={labelColor}>OLS Statistical Conf:</span>
                      <span className={`${titleColor} font-black tabular-nums`}>0.20</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Live Alerts Feed Log */}
              <div className={containerStyle}>
                <div className={`flex items-center justify-between px-3 py-2 border-b ${currentTheme.border} ${currentTheme.isLight ? "bg-slate-200/50" : ""}`}>
                  <span className={`text-xs font-black ${titleColor} uppercase tracking-wider flex items-center gap-1.5`}>
                    <Bell className={`w-3.5 h-3.5 ${currentTheme.isLight ? "text-amber-700" : "text-amber-400"}`} /> Live Alert Log
                  </span>
                  <button onClick={() => toggleCard("alertFeed")} className={`${labelColor} p-0.5 cursor-pointer`}>
                    {collapsedCards.alertFeed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {!collapsedCards.alertFeed && (
                  <div className={`space-y-1.5 text-[11px] ${densityPaddingMap[density].card}`}>
                    <div className={`${currentTheme.accentPrimaryBg} p-2 rounded flex items-start gap-1.5 border`}>
                      <span className="font-black">13:42:10</span>
                      <span className="font-bold">STRATEGY_MATCHED: High Confluence Buy Executed</span>
                    </div>
                    <div className={`${currentTheme.accentUpBg} p-2 rounded flex items-start gap-1.5 border`}>
                      <span className="font-black">13:38:00</span>
                      <span className="font-bold">BOS_CONFIRMED: Pierced $3,450.00</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 4. EXECUTION DATA TABLE SECTION */}
        <div className={containerStyle}>
          <div className={`flex items-center justify-between px-3 py-2 border-b ${currentTheme.border} ${currentTheme.isLight ? "bg-slate-200/80" : "bg-slate-900/40"}`}>
            <span className={`text-xs font-black ${titleColor} uppercase tracking-wider flex items-center gap-2`}>
              <BookOpen className={`w-4 h-4 ${currentTheme.isLight ? "text-purple-800" : "text-purple-400"}`} />
              Execution Journal & Account Performance Summary
            </span>
            <button onClick={() => toggleCard("journalTable")} className={`${labelColor} hover:${titleColor} p-1 cursor-pointer`}>
              {collapsedCards.journalTable ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>

          {!collapsedCards.journalTable && (
            <div className={`${densityPaddingMap[density].card} space-y-3`}>
              {/* Account Performance Summary Bar */}
              <div className={`grid grid-cols-2 sm:grid-cols-6 gap-2 ${currentTheme.boxBg} p-2.5 border ${currentTheme.border} rounded text-xs`}>
                <div>
                  <span className={`text-[9px] ${labelColor} block uppercase font-black`}>Total Trades</span>
                  <strong className={`${titleColor} font-black tabular-nums text-sm`}>42</strong>
                </div>
                <div>
                  <span className={`text-[9px] ${labelColor} block uppercase font-black`}>Win Rate</span>
                  <strong className={`${currentTheme.accentUp} font-black tabular-nums text-sm`}>71.4%</strong>
                </div>
                <div>
                  <span className={`text-[9px] ${labelColor} block uppercase font-black`}>Profit Factor</span>
                  <strong className={`${currentTheme.accentUp} font-black tabular-nums text-sm`}>2.84</strong>
                </div>
                <div>
                  <span className={`text-[9px] ${labelColor} block uppercase font-black`}>Realized PnL</span>
                  <strong className={`${currentTheme.accentUp} font-black tabular-nums text-sm`}>+$14,850.00</strong>
                </div>
                <div>
                  <span className={`text-[9px] ${labelColor} block uppercase font-black`}>Max Drawdown</span>
                  <strong className={`${titleColor} font-black tabular-nums text-sm`}>-4.2%</strong>
                </div>
                <div>
                  <span className={`text-[9px] ${labelColor} block uppercase font-black`}>Average R:R</span>
                  <strong className={`${titleColor} font-black tabular-nums text-sm`}>1 : 3.42</strong>
                </div>
              </div>

              {/* Table Ledger */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`border-b ${currentTheme.border} ${currentTheme.isLight ? "bg-slate-200 text-slate-900 font-black" : "text-slate-400"} text-[10px] uppercase tracking-wider`}>
                      <th className={densityPaddingMap[density].table}>ID</th>
                      <th className={densityPaddingMap[density].table}>Timestamp</th>
                      <th className={densityPaddingMap[density].table}>Symbol</th>
                      <th className={densityPaddingMap[density].table}>Direction</th>
                      <th className={densityPaddingMap[density].table}>Type</th>
                      <th className={densityPaddingMap[density].table}>Entry Price</th>
                      <th className={densityPaddingMap[density].table}>Mark Price</th>
                      <th className={densityPaddingMap[density].table}>Stop Loss</th>
                      <th className={densityPaddingMap[density].table}>Take Profit</th>
                      <th className={densityPaddingMap[density].table}>PnL ($)</th>
                      <th className={densityPaddingMap[density].table}>R:R</th>
                      <th className={densityPaddingMap[density].table}>Score</th>
                      <th className={densityPaddingMap[density].table}>Status</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${currentTheme.border} ${titleColor}`}>
                    <tr className={`hover:${currentTheme.boxBg} transition-colors`}>
                      <td className={`${densityPaddingMap[density].table} ${labelColor} font-black`}>#TRD-9042</td>
                      <td className={`${densityPaddingMap[density].table} ${labelColor} tabular-nums font-bold`}>13:42:10</td>
                      <td className={`${densityPaddingMap[density].table} font-black`}>ETHUSDT</td>
                      <td className={densityPaddingMap[density].table}>
                        <span className={`px-1.5 py-0.5 rounded ${currentTheme.accentUpBg} text-[10px]`}>
                          LONG
                        </span>
                      </td>
                      <td className={`${densityPaddingMap[density].table} ${labelColor} font-bold text-[10px]`}>MARKET</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums font-black`}>$3,425.00</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums font-black`}>$3,456.80</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums ${labelColor} font-bold`}>$3,410.00</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums ${currentTheme.accentUp} font-black`}>$3,510.00</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums font-black ${currentTheme.accentUp}`}>+$636.00</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums font-black`}>1:5.67</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums ${currentTheme.accentUp} font-black`}>87%</td>
                      <td className={densityPaddingMap[density].table}>
                        <span className={`px-1.5 py-0.5 rounded ${currentTheme.accentPrimaryBg} text-[10px]`}>
                          ACTIVE
                        </span>
                      </td>
                    </tr>
                    <tr className={`hover:${currentTheme.boxBg} transition-colors`}>
                      <td className={`${densityPaddingMap[density].table} ${labelColor} font-black`}>#TRD-9041</td>
                      <td className={`${densityPaddingMap[density].table} ${labelColor} tabular-nums font-bold`}>11:15:00</td>
                      <td className={`${densityPaddingMap[density].table} font-black`}>ETHUSDT</td>
                      <td className={densityPaddingMap[density].table}>
                        <span className={`px-1.5 py-0.5 rounded ${currentTheme.accentDownBg} text-[10px]`}>
                          SHORT
                        </span>
                      </td>
                      <td className={`${densityPaddingMap[density].table} ${labelColor} font-bold text-[10px]`}>LIMIT</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums font-black`}>$3,468.20</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums font-black`}>$3,428.10</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums ${labelColor} font-bold`}>$3,485.00</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums ${currentTheme.accentUp} font-black`}>$3,428.00</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums font-black ${currentTheme.accentUp}`}>+$802.00</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums font-black`}>1:2.38</td>
                      <td className={`${densityPaddingMap[density].table} tabular-nums ${currentTheme.accentUp} font-black`}>92%</td>
                      <td className={densityPaddingMap[density].table}>
                        <span className={`px-1.5 py-0.5 rounded ${currentTheme.accentUpBg} text-[10px]`}>
                          CLOSED_TP
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
