"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import {
  Settings,
  Save,
  Cpu,
  FileText,
  KeyRound,
  Shield,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Lock,
  User,
  Sliders,
  Volume2,
  Play,
  Music,
  Layout,
  Eye,
  EyeOff,
  UserCheck,
  Globe,
  Database,
  VolumeX,
  Palette,
  Crosshair,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useAlertSounds, AVAILABLE_ALERT_FILES } from "@/hooks/useAlertSounds";
import { DEFAULT_THEME_SETTINGS } from "@/hooks/useMarketData";
import { AVAILABLE_MODELS } from "@/lib/aiModels";

// ─── Interfaces ──────────────────────────────────────────────────────────────
interface QuantSettings {
  ACTIVE_MODEL: string;
  SYSTEM_PROMPT: string;
  GEMINI_LIVE_KEY: string;
}

interface AccountState {
  initial_capital: string;
  max_risk_limit_pct: string;
  risk_per_trade_pct: string;
  max_daily_loss_pct: string;
  max_daily_loss_usd: string;
  max_consecutive_losses: number;
  max_daily_trades: number;
  current_balance: string;
  available_balance?: string;
  circuit_breaker_active?: boolean;
  circuit_breaker_reason?: string | null;
  is_live?: boolean;
}

interface SignalAlerts {
  FVG_DETECTION: string;
  DISPLACEMENT_CONFIRMED: string;
  SMT_TRAP_ACTIVE: string;
  DOL_EXHAUSTED: string;
  SESSION_TRANSITION: string;
  PRICING_SHIFT: string;
  SWEEP_ALERT: string;
  FLOW_STATE_CHANGE: string;
  DEAD_ZONE_ENTER: string;
}

interface SignalAlertsEnabled {
  FVG_DETECTION: boolean;
  DISPLACEMENT_CONFIRMED: boolean;
  SMT_TRAP_ACTIVE: boolean;
  DOL_EXHAUSTED: boolean;
  SESSION_TRANSITION: boolean;
  PRICING_SHIFT: boolean;
  SWEEP_ALERT: boolean;
  FLOW_STATE_CHANGE: boolean;
  DEAD_ZONE_ENTER: boolean;
}

type TabType = "quant_ai" | "account_risk" | "profile" | "terminal" | "appearance";
type SaveStatus = "idle" | "saving" | "success" | "error";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SIGNAL_ALERTS: SignalAlerts = {
  FVG_DETECTION: "fvg_alert.mp3",
  DISPLACEMENT_CONFIRMED: "flow_state.wav",
  SMT_TRAP_ACTIVE: "smt_trap.wav",
  DOL_EXHAUSTED: "objective_update.wav",
  SESSION_TRANSITION: "session_transition.wav",
  PRICING_SHIFT: "pricing_shift.wav",
  SWEEP_ALERT: "sweep_alert.mp3",
  FLOW_STATE_CHANGE: "flow_state.wav",
  DEAD_ZONE_ENTER: "dead_zone.mp3",
};

const DEFAULT_SIGNAL_ALERTS_ENABLED: SignalAlertsEnabled = {
  FVG_DETECTION: true,
  DISPLACEMENT_CONFIRMED: true,
  SMT_TRAP_ACTIVE: true,
  DOL_EXHAUSTED: true,
  SESSION_TRANSITION: true,
  PRICING_SHIFT: true,
  SWEEP_ALERT: true,
  FLOW_STATE_CHANGE: true,
  DEAD_ZONE_ENTER: true,
};

// Color Picker Item Component for dynamic theme controls
const ColorPickerItem: React.FC<{
  label: string;
  value: string;
  onChange: (val: string) => void;
}> = ({ label, value, onChange }) => {
  return (
    <div className="flex items-center justify-between bg-card/40 border border-card-border p-3.5 rounded-xl hover:border-accent/40 transition-all select-none shadow-sm">
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest">{label}</span>
        <span className="text-[11px] font-mono text-foreground font-semibold select-all">{value ? value.toUpperCase() : ''}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative w-8 h-8 rounded-lg border border-card-border overflow-hidden cursor-pointer shadow-inner hover:scale-105 transition-transform">
          <div
            className="w-full h-full"
            style={{ backgroundColor: value }}
          />
          <input
            type="color"
            value={value || '#ffffff'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
};

// Slider Item Component for opacity ranges
const SliderItem: React.FC<{
  label: string;
  value: number;
  onChange: (val: number) => void;
}> = ({ label, value, onChange }) => {
  return (
    <div className="flex flex-col gap-2 bg-card/40 border border-card-border p-3.5 rounded-xl hover:border-accent/40 transition-all select-none shadow-sm">
      <div className="flex justify-between items-baseline">
        <span className="text-[10px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest">{label}</span>
        <span className="text-xs font-mono text-[#50ffaf] font-black">{value}%</span>
      </div>
      <input
        type="range"
        min="10"
        max="100"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-card-border accent-accent h-1 rounded-lg cursor-pointer"
      />
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { playFile } = useAlertSounds();

  // ── Tab State ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabType>("quant_ai");

  // ── Quant AI State ─────────────────────────────────────────────────────────
  const [quantSettings, setQuantSettings] = useState<QuantSettings>({
    ACTIVE_MODEL: "gemini-3.5-flash",
    SYSTEM_PROMPT: "",
    GEMINI_LIVE_KEY: "",
  });
  const [showApiKey, setShowApiKey] = useState(false);

  // ── Account & Risk State ───────────────────────────────────────────────────
  const [account, setAccount] = useState<AccountState>({
    initial_capital: "10000.00",
    max_risk_limit_pct: "3.00",
    risk_per_trade_pct: "2.00",
    max_daily_loss_pct: "4.00",
    max_daily_loss_usd: "400.00",
    max_consecutive_losses: 3,
    max_daily_trades: 6,
    current_balance: "10000.00",
    circuit_breaker_active: false,
    circuit_breaker_reason: null,
  });
  // ── Terminal / Audio Alerts State ──────────────────────────────────────────
  const [signalAlerts, setSignalAlerts] = useState<SignalAlerts>(DEFAULT_SIGNAL_ALERTS);
  const [signalAlertsEnabled, setSignalAlertsEnabled] = useState<SignalAlertsEnabled>(DEFAULT_SIGNAL_ALERTS_ENABLED);

  // Local storage terminal preferences
  const [ambientGlow, setAmbientGlow] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [liveTicksSound, setLiveTicksSound] = useState(false);

  // ── Appearance Studio State ────────────────────────────────────────────────
  const [themeSettings, setThemeSettings] = useState<any>({
    ...DEFAULT_THEME_SETTINGS
  });

  // ── UX Status States ───────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // ── Auth Guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "unauthenticated") {
      const targetUrl = "/login?callbackUrl=" + encodeURIComponent("/settings");
      if (typeof window !== "undefined") {
        window.location.href = targetUrl;
      }
    }
  }, [status]);

  // Load local storage UI preferences on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      setAmbientGlow(localStorage.getItem("gem_ambient_glow") !== "false");
      setCompactMode(localStorage.getItem("gem_compact_mode") === "true");
      setLiveTicksSound(localStorage.getItem("gem_live_ticks_sound") === "true");
    }
  }, []);

  // ── Fetch all settings from server endpoints ────────────────────────────────
  const fetchAllSettings = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      setIsLoading(true);
      setErrorMessage("");

      // 1. Fetch AI & Terminal settings
      const settingsRes = await fetch("/api/settings", { 
        credentials: "same-origin",
        signal: controller.signal
      });
      if (!settingsRes.ok) throw new Error("Failed to fetch settings from cloud vault.");
      const settingsData = await settingsRes.json();

      const s = settingsData.settings || {};
      setQuantSettings({
        ACTIVE_MODEL: s.ACTIVE_MODEL || "gemini-3.5-flash",
        SYSTEM_PROMPT: s.SYSTEM_PROMPT || "",
        GEMINI_LIVE_KEY: s.GEMINI_LIVE_KEY || "",
      });

      // Merge retrieved settings on top of default settings to guarantee all keys exist
      const mergedTheme = { ...DEFAULT_THEME_SETTINGS };
      Object.keys(DEFAULT_THEME_SETTINGS).forEach((key) => {
        const val = s[key];
        if (val !== undefined && val !== null) {
          if (typeof DEFAULT_THEME_SETTINGS[key as keyof typeof DEFAULT_THEME_SETTINGS] === "number") {
            mergedTheme[key as keyof typeof DEFAULT_THEME_SETTINGS] = Number(val) as never;
          } else {
            mergedTheme[key as keyof typeof DEFAULT_THEME_SETTINGS] = String(val) as never;
          }
        }
      });
      setThemeSettings(mergedTheme);

      if (settingsData.terminalSettings) {
        const { signalSounds, enabledSignals } = settingsData.terminalSettings;
        if (signalSounds) setSignalAlerts(signalSounds);
        if (enabledSignals) setSignalAlertsEnabled(enabledSignals);
      }

      // 2. Fetch Account & Risk settings
      const accountRes = await fetch("/api/account", { 
        credentials: "same-origin",
        signal: controller.signal
      });
      if (accountRes.ok) {
        const accountData = await accountRes.json();
        if (accountData.account) {
          const acc = accountData.account;
          setAccount({
            initial_capital: parseFloat(acc.initial_capital || '10000').toFixed(2),
            max_risk_limit_pct: parseFloat(acc.max_risk_limit_pct || '3').toFixed(2),
            risk_per_trade_pct: parseFloat(acc.risk_per_trade_pct || '2').toFixed(2),
            max_daily_loss_pct: parseFloat(acc.max_daily_loss_pct || '4').toFixed(2),
            max_daily_loss_usd: parseFloat(acc.max_daily_loss_usd || '400').toFixed(2),
            max_consecutive_losses: parseInt(acc.max_consecutive_losses || 3, 10),
            max_daily_trades: parseInt(acc.max_daily_trades || 6, 10),
            current_balance: parseFloat(acc.current_balance || '10000').toFixed(2),
            available_balance: acc.available_balance ? parseFloat(acc.available_balance).toFixed(2) : undefined,
            circuit_breaker_active: Boolean(acc.circuit_breaker_active),
            circuit_breaker_reason: acc.circuit_breaker_reason || null,
            is_live: Boolean(acc.is_live),
          });
        }
      }
    } catch (err: any) {
      console.error("[SETTINGS PAGE] Load error:", err);
      setErrorMessage(
        err.name === 'AbortError' 
          ? "Connection timed out reaching cloud vault." 
          : (err instanceof Error ? err.message : "Failed to establish cloud linkage.")
      );
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetchAllSettings();
    }
  }, [status, fetchAllSettings]);

  // ── Save handlers per tab ──────────────────────────────────────────────────

  // Save Tab 5: APPEARANCE Customizer Config
  const handleSaveAppearance = async () => {
    try {
      setSaveStatus("saving");
      setErrorMessage("");

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ settings: themeSettings }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to commit appearance configuration.");
      }

      if (typeof window !== "undefined") {
        localStorage.setItem("gem_theme_settings", JSON.stringify(themeSettings));
      }

      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err: unknown) {
      setSaveStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Unknown error occurred");
      setTimeout(() => setSaveStatus("idle"), 5000);
    }
  };

  // Save Tab 1: QUANT AI Config
  const handleSaveQuantAi = async () => {
    try {
      setSaveStatus("saving");
      setErrorMessage("");

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ settings: quantSettings }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Save failed");
      }

      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err: unknown) {
      setSaveStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Unknown error occurred");
      setTimeout(() => setSaveStatus("idle"), 5000);
    }
  };

  // Save Tab 2: ACCOUNT & RISK Config + Platform Configs
  const handleSaveAccountRisk = async () => {
    try {
      setSaveStatus("saving");
      setErrorMessage("");

      const capital = parseFloat(account.initial_capital);
      const riskLimit = parseFloat(account.max_risk_limit_pct);
      const tradeRisk = parseFloat(account.risk_per_trade_pct);
      const dailyLossPct = parseFloat(account.max_daily_loss_pct);
      const dailyLossUsd = parseFloat(account.max_daily_loss_usd);
      const consecLosses = parseInt(String(account.max_consecutive_losses), 10);
      const dailyTrades = parseInt(String(account.max_daily_trades), 10);

      if (isNaN(capital) || capital <= 0) {
        throw new Error("Initial Capital must be a positive number.");
      }

      if (isNaN(riskLimit) || riskLimit <= 0 || riskLimit > 100) {
        throw new Error("Max Risk Limit must be a percentage between 0% and 100%.");
      }

      if (isNaN(tradeRisk) || tradeRisk <= 0 || tradeRisk > 100) {
        throw new Error("Risk Ratio per Trade must be a percentage between 0% and 100%.");
      }

      if (tradeRisk > riskLimit * 1.05) {
        throw new Error(`Operational Risk (${tradeRisk}%) cannot exceed Max Risk Limit ceiling (${riskLimit}%).`);
      }

      const accountRes = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          initial_capital: capital,
          max_risk_limit_pct: riskLimit,
          risk_per_trade_pct: tradeRisk,
          max_daily_loss_pct: dailyLossPct,
          max_daily_loss_usd: dailyLossUsd,
          max_consecutive_losses: consecLosses,
          max_daily_trades: dailyTrades,
        }),
      });

      if (!accountRes.ok) {
        const data = await accountRes.json();
        throw new Error(data.error || "Failed to commit account risk configurations.");
      }

      const json = await accountRes.json();
      if (json.account) {
        const acc = json.account;
        setAccount((prev) => ({
          ...prev,
          initial_capital: parseFloat(acc.initial_capital || prev.initial_capital).toFixed(2),
          max_risk_limit_pct: parseFloat(acc.max_risk_limit_pct || prev.max_risk_limit_pct).toFixed(2),
          risk_per_trade_pct: parseFloat(acc.risk_per_trade_pct || prev.risk_per_trade_pct).toFixed(2),
          max_daily_loss_pct: parseFloat(acc.max_daily_loss_pct || prev.max_daily_loss_pct).toFixed(2),
          max_daily_loss_usd: parseFloat(acc.max_daily_loss_usd || prev.max_daily_loss_usd).toFixed(2),
          max_consecutive_losses: parseInt(acc.max_consecutive_losses || prev.max_consecutive_losses, 10),
          max_daily_trades: parseInt(acc.max_daily_trades || prev.max_daily_trades, 10),
          current_balance: parseFloat(acc.current_balance || prev.current_balance).toFixed(2),
        }));
      }

      // Proactively trigger a global data refresh so components update immediately
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("trades-refresh"));
      }

      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err: unknown) {
      setSaveStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Unknown error occurred");
      setTimeout(() => setSaveStatus("idle"), 5000);
    }
  };

  const handleResetCircuitBreaker = async () => {
    try {
      setSaveStatus("saving");
      setErrorMessage("");
      const res = await fetch("/api/risk/reset", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed to reset circuit breaker.");
      setAccount((prev) => ({
        ...prev,
        circuit_breaker_active: false,
        circuit_breaker_reason: null,
      }));
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err: any) {
      setSaveStatus("error");
      setErrorMessage(err?.message || "Failed to reset circuit breaker");
      setTimeout(() => setSaveStatus("idle"), 5000);
    }
  };

  // Save Tab 4: TERMINAL Config
  const handleSaveTerminal = async () => {
    try {
      setSaveStatus("saving");
      setErrorMessage("");

      // Save database terminal audio settings
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          terminalSettings: {
            signalSounds: signalAlerts,
            enabledSignals: signalAlertsEnabled,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save terminal settings.");
      }

      // Save local storage UI toggles
      if (typeof window !== "undefined") {
        localStorage.setItem("gem_ambient_glow", String(ambientGlow));
        localStorage.setItem("gem_compact_mode", String(compactMode));
        localStorage.setItem("gem_live_ticks_sound", String(liveTicksSound));
      }

      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err: unknown) {
      setSaveStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Unknown error occurred");
      setTimeout(() => setSaveStatus("idle"), 5000);
    }
  };

  // Preview sound mapping file
  const handlePlaySound = (fileName: string) => {
    playFile(fileName);
  };

  // Masking helper
  const maskKey = (key: string) => {
    if (!key || key.length < 8) return "";
    return key.slice(0, 6) + "•".repeat(Math.min(key.length - 10, 20)) + key.slice(-4);
  };

  // ── Auth Loading States ──────────────────────────────────────────────────
  if (status === "loading" || (status === "authenticated" && isLoading)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          <span className="text-xs text-slate-500 dark:text-zinc-400 font-sans tracking-widest uppercase font-black">
            Establishing Secure Link...
          </span>
        </div>
      </div>
    );
  }

  // ── Unauthenticated Gate ────────────────────────────────────────────────
  if (status === "unauthenticated" || (!session && status !== "loading")) {
    return (
      <div className="flex h-[calc(100vh-64px)] w-full items-center justify-center bg-background selection:bg-accent/30 font-sans p-6 transition-colors duration-300">
        <div className="max-w-md w-full glass-panel p-8 flex flex-col items-center text-center border-rose-500/20">
          <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 rounded-full flex items-center justify-center mb-6">
            <Lock className="w-8 h-8 text-rose-500" />
          </div>
          <h2 className="text-lg font-bold text-title uppercase tracking-wider mb-2">
            Unauthorized Access
          </h2>
          <p className="text-sm text-muted mb-6 leading-relaxed">
            The Quegar Vault is locked. This terminal page requires an active institutional session to view or configure settings.
          </p>
          <Link
            href="/login?callbackUrl=/settings"
            className="w-full bg-accent hover:bg-accent/80 text-black py-2.5 px-4 font-black text-xs uppercase tracking-widest transition-all text-center rounded-lg shadow-md shadow-accent/10 cursor-pointer"
          >
            Authenticate Terminal
          </Link>
        </div>
      </div>
    );
  }

  // ── Cloud Linkage Disrupted Gate (With Retry) ───────────────────────────
  if (errorMessage && !quantSettings.ACTIVE_MODEL) {
    return (
      <div className="flex h-[calc(100vh-64px)] w-full items-center justify-center bg-background selection:bg-accent/30 font-sans p-6">
        <div className="max-w-md w-full glass-panel p-8 flex flex-col items-center text-center border-amber-500/20">
          <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center justify-center mb-6">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-lg font-bold text-title uppercase tracking-wider mb-2">
            Cloud Linkage Disrupted
          </h2>
          <p className="text-sm text-muted mb-6 leading-relaxed">
            {errorMessage}
          </p>
          <button
            onClick={() => fetchAllSettings()}
            className="w-full bg-accent hover:bg-accent/80 text-black py-2.5 px-4 font-black text-xs uppercase tracking-widest transition-all text-center rounded-lg shadow-md shadow-accent/10 cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!session) return null;

  // Tabs Definitions
  const tabs = [
    { id: "quant_ai", label: "QUANT AI", icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: "account_risk", label: "ACCOUNT & RISK", icon: <Sliders className="w-3.5 h-3.5" /> },
    { id: "profile", label: "PROFILE", icon: <User className="w-3.5 h-3.5" /> },
    { id: "terminal", label: "TERMINAL", icon: <Layout className="w-3.5 h-3.5" /> },
    { id: "appearance", label: "APPEARANCE", icon: <Palette className="w-3.5 h-3.5" /> },
  ] as const;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans select-none overflow-x-hidden relative">
      {/* ── Ambient Glow (Active based on local preferences) ──────────────────── */}
      {ambientGlow && (
        <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] bg-accent/5 rounded-full blur-[140px]" />
          <div className="absolute bottom-[10%] right-[10%] w-[400px] h-[400px] bg-accent/3 rounded-full blur-[120px]" />
        </div>
      )}

      <div className="relative z-10 max-w-6xl mx-auto px-4 py-8 lg:py-12">
        {/* ── Page Header ────────────────────────────────────────────────── */}
        <div className="mb-8 border-b border-card-border pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 bg-accent/10 border border-accent/25 rounded-xl shadow-lg shadow-accent/5">
              <Settings className="w-5 h-5 text-accent animate-[spin_8s_linear_infinite]" />
            </div>
            <div>
              <h1 className="text-base lg:text-lg font-black text-foreground tracking-[0.15em] uppercase">
                SYSTEM COMMAND CENTER
              </h1>
              <p className="text-[10px] text-slate-500 dark:text-zinc-400 tracking-widest font-black uppercase mt-0.5">
                Vault Configurations & HUD Customizations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-start md:self-auto bg-card border border-card-border px-4 py-2 text-[10px] tracking-wider text-slate-500 dark:text-zinc-400 shadow-md rounded-xl">
            <Shield className="w-3.5 h-3.5 text-[#50ffaf]" />
            <span>
              NODE CONNECTED: <span className="text-[#50ffaf] font-black">{session.user?.email}</span>
            </span>
          </div>
        </div>

        {/* ── Main Layout: Vertical Tabs on desktop / Scrollable Horizontal Row on Mobile ── */}
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Tab Switcher */}
          <div className="w-full lg:w-64 shrink-0 flex lg:flex-col overflow-x-auto lg:overflow-visible scrollbar-none border-b lg:border-b-0 lg:border-r border-card-border pb-2 lg:pb-0 lg:pr-4 gap-2">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setErrorMessage("");
                  }}
                  className={`flex items-center gap-3 px-4.5 py-3.5 text-xs md:text-sm font-black uppercase tracking-widest transition-all cursor-pointer whitespace-nowrap lg:w-full border-b-2 lg:border-b-0 lg:border-l-3 ${active
                    ? "bg-accent/15 text-accent border-accent shadow-inner rounded-r-none lg:rounded-r-lg rounded-lg"
                    : "text-slate-500 dark:text-zinc-400 border-transparent hover:text-foreground hover:bg-card/45 rounded-lg"
                    }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Active Pane Container (Glassmorphic dark design) */}
          <div className="flex-1 w-full min-w-0 glass-panel p-5 lg:p-8 relative">

            {/* Error Telemetry Alert Banner */}
            {errorMessage && (
              <div className="mb-6 flex items-start gap-3 bg-rose-500/10 border border-rose-500/40 p-4 text-[10px] text-rose-600 dark:text-rose-400 leading-relaxed rounded-xl">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500 animate-pulse" />
                <div>
                  <span className="font-bold uppercase tracking-widest block mb-0.5">TELEMETRY WARNING</span>
                  {errorMessage}
                </div>
              </div>
            )}

            {/* TAB 1: QUANT AI ─────────────────────────────────────────── */}
            {activeTab === "quant_ai" && (
              <div className="space-y-6 animate-[fade-in_0.2s_ease-out]">
                <div>
                  <h2 className="text-xs font-black tracking-widest text-accent uppercase flex items-center gap-2 mb-1">
                    <Cpu className="w-4 h-4 text-cyan-400" /> [ 01 / QUANT AI CONTEXT ]
                  </h2>
                  <p className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black">
                    Configure the hyper-scale deep reasoning backend parameters
                  </p>
                </div>

                {/* Model selector */}
                <div className="space-y-2">
                  <label className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                    Active Analytical Model
                  </label>
                  <select
                    value={quantSettings.ACTIVE_MODEL}
                    onChange={(e) =>
                      setQuantSettings((s) => ({ ...s, ACTIVE_MODEL: e.target.value }))
                    }
                    className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3.5 py-2.5 text-xs text-foreground rounded-lg transition-all cursor-pointer shadow-sm"
                  >
                    {AVAILABLE_MODELS.map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* System Prompt */}
                <div className="space-y-2">
                  <label className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                    Quant Prompt Architecture (System Instructions)
                  </label>
                  <textarea
                    value={quantSettings.SYSTEM_PROMPT}
                    onChange={(e) =>
                      setQuantSettings((s) => ({ ...s, SYSTEM_PROMPT: e.target.value }))
                    }
                    rows={12}
                    placeholder="Provide the core algorithmic directives for Gemini to evaluate market data..."
                    className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3.5 py-2.5 text-xs text-foreground rounded-lg transition-all resize-y placeholder:text-slate-500 dark:placeholder-zinc-600 shadow-sm leading-relaxed"
                  />
                  <div className="flex justify-between items-center text-[8px] text-slate-500 dark:text-zinc-400 uppercase font-black">
                    <span>{quantSettings.SYSTEM_PROMPT.length.toLocaleString()} characters declared</span>
                    <span className="text-zinc-600">Markdown rules allowed</span>
                  </div>
                </div>

                {/* API Key */}
                <div className="space-y-2">
                  <label className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                    Google Gemini API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={quantSettings.GEMINI_LIVE_KEY}
                      onChange={(e) =>
                        setQuantSettings((s) => ({ ...s, GEMINI_LIVE_KEY: e.target.value }))
                      }
                      placeholder="AIzaSy..."
                      className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none pl-3.5 pr-10 py-2.5 text-xs text-foreground rounded-lg transition-all placeholder:text-slate-500 dark:placeholder-zinc-600 shadow-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-zinc-500 hover:text-foreground transition-colors cursor-pointer"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {quantSettings.GEMINI_LIVE_KEY && !showApiKey && (
                    <div className="flex items-center gap-2 text-[9px] text-slate-500 dark:text-zinc-400">
                      <Shield className="w-3.5 h-3.5 text-[#50ffaf]" />
                      <span>VAULT VALUE MASKED: {maskKey(quantSettings.GEMINI_LIVE_KEY)}</span>
                    </div>
                  )}
                </div>

                {/* Save button */}
                <div className="pt-4 border-t border-card-border flex justify-end">
                  <button
                    onClick={handleSaveQuantAi}
                    disabled={saveStatus === "saving"}
                    className={`flex items-center gap-2 px-5 py-2.5 border font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer rounded-lg shadow-sm ${saveStatus === "saving"
                      ? "bg-accent/10 border-accent/30 text-accent/50 cursor-wait"
                      : saveStatus === "success"
                        ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                        : saveStatus === "error"
                          ? "bg-rose-500/10 border-rose-500/40 text-rose-600 dark:text-rose-400"
                          : "bg-card border border-card-border hover:border-accent text-slate-500 dark:text-zinc-400 hover:text-foreground"
                      }`}
                  >
                    {saveStatus === "saving" ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Committing...</span>
                      </>
                    ) : saveStatus === "success" ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>AI Saved</span>
                      </>
                    ) : saveStatus === "error" ? (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Failed</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>Commit AI Config</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: ACCOUNT & RISK ─────────────────────────────────────── */}
            {activeTab === "account_risk" && (
              <div className="space-y-6 animate-[fade-in_0.2s_ease-out]">
                <div>
                  <h2 className="text-xs font-black tracking-widest text-accent uppercase flex items-center gap-2 mb-1">
                    <Sliders className="w-4 h-4 text-emerald-400" /> [ 02 / GLOBAL RISK GOVERNOR & POSITION SIZING ]
                  </h2>
                  <p className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black">
                    Multi-Tier Risk Hierarchy: Operational $1.0R Allocation, Sizing Sliders & Portfolio Circuit Breakers
                  </p>
                </div>

                {/* ── CIRCUIT BREAKER LIVE STATUS BANNER ────────────────────── */}
                {account.circuit_breaker_active ? (
                  <div className="flex flex-col md:flex-row md:items-center justify-between p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-500 shrink-0">
                        <AlertTriangle className="w-5 h-5 animate-pulse" />
                      </div>
                      <div>
                        <div className="text-xs font-black uppercase tracking-wider text-rose-400 flex items-center gap-2">
                          <span>🚨 CIRCUIT BREAKER ENGAGED — EXECUTION HALTED</span>
                        </div>
                        <div className="text-[10px] text-muted font-mono mt-0.5">
                          {account.circuit_breaker_reason || "Daily drawdown or streak threshold reached. All new order entries locked."}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleResetCircuitBreaker}
                      disabled={saveStatus === "saving"}
                      className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-black uppercase tracking-wider rounded-lg shadow-md transition-all cursor-pointer shrink-0"
                    >
                      [ 🔓 Manual Override & Reset ]
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                        CIRCUIT BREAKER ARMED & NORMAL — ZERO ACTIVE HALTS
                      </span>
                    </div>
                    <span className="text-[9px] font-mono text-muted uppercase">Daily Auto-Reset @ 00:00 UTC</span>
                  </div>
                )}

                {/* ── LIVE MATH TELEMETRY RIBBON ───────────────────────────── */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-card/30 border border-card-border p-4 rounded-2xl shadow-inner font-mono">
                  {/* Ledger Balance */}
                  <div className="space-y-1">
                    <span className="text-[8px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                      Ledger Collateral
                    </span>
                    <div className="text-lg font-bold text-[#50ffaf]">
                      ${parseFloat(account.current_balance || '0').toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <span className="text-[8px] text-muted block truncate">
                      {account.is_live ? "Binance USDC Balance" : "Local Sandbox Equity"}
                    </span>
                  </div>

                  {/* Planned 1.0R Risk */}
                  <div className="space-y-1">
                    <span className="text-[8px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                      Trade Risk ($1.0R)
                    </span>
                    <div className="text-lg font-bold text-accent">
                      ${((parseFloat(account.current_balance || '0') * parseFloat(account.risk_per_trade_pct || '2')) / 100).toFixed(2)}
                    </div>
                    <span className="text-[8px] text-muted block truncate">
                      {account.risk_per_trade_pct}% of Ledger Equity
                    </span>
                  </div>

                  {/* Sizing Preview */}
                  <div className="space-y-1">
                    <span className="text-[8px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                      Size Est. ($10 Stop)
                    </span>
                    <div className="text-lg font-bold text-foreground">
                      {(((parseFloat(account.current_balance || '0') * parseFloat(account.risk_per_trade_pct || '2')) / 100) / 10).toFixed(3)} <span className="text-xs text-muted">ETH</span>
                    </div>
                    <span className="text-[8px] text-emerald-400 block truncate">
                      Min Notional Met ($5)
                    </span>
                  </div>

                  {/* Daily Drawdown Stop */}
                  <div className="space-y-1">
                    <span className="text-[8px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                      Daily Max Drawdown
                    </span>
                    <div className="text-lg font-bold text-rose-400">
                      -${Math.min((parseFloat(account.current_balance || '0') * parseFloat(account.max_daily_loss_pct || '4')) / 100, parseFloat(account.max_daily_loss_usd || '400')).toFixed(2)}
                    </div>
                    <span className="text-[8px] text-muted block truncate">
                      Halt at {account.max_daily_loss_pct}% loss
                    </span>
                  </div>
                </div>

                {/* ── TIER 1: OPERATIONAL SIZING SLIDER & PRESETS ─────────────── */}
                <div className="p-5 bg-card/40 border border-card-border rounded-2xl space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        <h3 className="text-xs font-black uppercase tracking-wider text-title">
                          Operational Risk Ratio per Trade ($1.0R)
                        </h3>
                      </div>
                      <p className="text-[9px] text-muted uppercase font-bold mt-0.5">
                        Controls exact contract lot size calculated for each automated and manual setup
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative w-24">
                        <input
                          type="number"
                          step="0.05"
                          min="0.10"
                          max="10.00"
                          value={account.risk_per_trade_pct}
                          onChange={(e) =>
                            setAccount((prev) => ({ ...prev, risk_per_trade_pct: e.target.value }))
                          }
                          className="w-full bg-card border border-card-border focus:border-accent focus:outline-none pl-3 pr-6 py-1.5 text-xs text-foreground font-mono font-bold rounded-lg text-right"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted text-[10px] font-bold">%</span>
                      </div>
                    </div>
                  </div>

                  {/* Range Slider */}
                  <div className="space-y-1.5">
                    <input
                      type="range"
                      min="0.25"
                      max="5.00"
                      step="0.05"
                      value={account.risk_per_trade_pct}
                      onChange={(e) =>
                        setAccount((prev) => ({ ...prev, risk_per_trade_pct: e.target.value }))
                      }
                      className="w-full accent-accent h-2 bg-card border border-card-border rounded-lg cursor-pointer"
                    />
                    <div className="flex justify-between text-[9px] font-mono text-muted">
                      <span>0.25% (Ultra-Safe)</span>
                      <span>1.00% (Standard)</span>
                      <span>2.00% (Baseline)</span>
                      <span>3.50%</span>
                      <span>5.00% (Max)</span>
                    </div>
                  </div>

                  {/* Preset Pills */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-[9px] text-muted uppercase font-black tracking-widest mr-1">Quick Presets:</span>
                    {[
                      { label: "0.50% Conservative", val: "0.50" },
                      { label: "1.00% Standard", val: "1.00" },
                      { label: "1.50% Growth", val: "1.50" },
                      { label: "2.00% Aggressive", val: "2.00" },
                    ].map((pill) => (
                      <button
                        key={pill.val}
                        type="button"
                        onClick={() => setAccount((prev) => ({ ...prev, risk_per_trade_pct: pill.val }))}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer border ${
                          parseFloat(account.risk_per_trade_pct) === parseFloat(pill.val)
                            ? "bg-accent text-black border-accent shadow-md shadow-accent/20"
                            : "bg-card/60 hover:bg-card border-card-border text-muted hover:text-foreground"
                        }`}
                      >
                        {pill.label}
                      </button>
                    ))}
                  </div>

                  {/* Risk Conflict Warning */}
                  {parseFloat(account.risk_per_trade_pct) > parseFloat(account.max_risk_limit_pct) && (
                    <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        <strong>Risk Hierarchy Warning:</strong> Operational Risk ({account.risk_per_trade_pct}%) cannot exceed Single-Trade Max Risk Limit ({account.max_risk_limit_pct}%). Please raise your ceiling or lower trade risk.
                      </span>
                    </div>
                  )}
                </div>

                {/* ── TIER 2 & TIER 3: CEILINGS & CIRCUIT BREAKERS ─────────────── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Initial Capital Seed */}
                  <div className="space-y-2 p-4 bg-card/30 border border-card-border rounded-xl">
                    <label className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                      Initial Capital Seed (USD)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      value={account.initial_capital}
                      onChange={(e) =>
                        setAccount((prev) => ({ ...prev, initial_capital: e.target.value }))
                      }
                      className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3.5 py-2.5 text-xs text-foreground rounded-lg transition-all shadow-sm font-mono"
                      placeholder="10000.00"
                    />
                    <span className="text-[8px] text-muted block">Benchmark starting equity for ROI calculations</span>
                  </div>

                  {/* Single-Trade Ceiling */}
                  <div className="space-y-2 p-4 bg-card/30 border border-card-border rounded-xl">
                    <label className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                      Single-Trade Risk Ceiling (%)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="10.0"
                        value={account.max_risk_limit_pct}
                        onChange={(e) =>
                          setAccount((prev) => ({ ...prev, max_risk_limit_pct: e.target.value }))
                        }
                        className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none pl-3.5 pr-8 py-2.5 text-xs text-foreground rounded-lg transition-all shadow-sm font-mono"
                        placeholder="3.00"
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted text-[10px] font-bold">%</span>
                    </div>
                    <span className="text-[8px] text-muted block">Hard stop loss safety ceiling per position</span>
                  </div>

                  {/* Max Daily Drawdown % */}
                  <div className="space-y-2 p-4 bg-card/30 border border-card-border rounded-xl">
                    <label className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                      Max Daily Drawdown Limit (%)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        min="1.0"
                        max="20.0"
                        value={account.max_daily_loss_pct}
                        onChange={(e) =>
                          setAccount((prev) => ({ ...prev, max_daily_loss_pct: e.target.value }))
                        }
                        className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none pl-3.5 pr-8 py-2.5 text-xs text-foreground rounded-lg transition-all shadow-sm font-mono"
                        placeholder="4.00"
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted text-[10px] font-bold">%</span>
                    </div>
                    <span className="text-[8px] text-muted block">Trips Circuit Breaker and halts execution until 00:00 UTC</span>
                  </div>

                  {/* Max Daily Drawdown USD */}
                  <div className="space-y-2 p-4 bg-card/30 border border-card-border rounded-xl">
                    <label className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                      Max Daily Drawdown Cap ($USD)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="10"
                        min="50"
                        value={account.max_daily_loss_usd}
                        onChange={(e) =>
                          setAccount((prev) => ({ ...prev, max_daily_loss_usd: e.target.value }))
                        }
                        className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none pl-3.5 pr-8 py-2.5 text-xs text-foreground rounded-lg transition-all shadow-sm font-mono"
                        placeholder="400.00"
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted text-[10px] font-bold">$</span>
                    </div>
                    <span className="text-[8px] text-muted block">Absolute dollar loss ceiling per 24h trading cycle</span>
                  </div>

                  {/* Max Consecutive Losses */}
                  <div className="space-y-2 p-4 bg-card/30 border border-card-border rounded-xl">
                    <label className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                      Max Consecutive Losses (Streak Halt)
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="10"
                      value={account.max_consecutive_losses}
                      onChange={(e) =>
                        setAccount((prev) => ({ ...prev, max_consecutive_losses: parseInt(e.target.value, 10) || 3 }))
                      }
                      className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3.5 py-2.5 text-xs text-foreground rounded-lg transition-all shadow-sm font-mono"
                      placeholder="3"
                    />
                    <span className="text-[8px] text-muted block">Triggers 6-hour cooldown if hit to prevent tilt in market chop</span>
                  </div>

                  {/* Max Daily Trades */}
                  <div className="space-y-2 p-4 bg-card/30 border border-card-border rounded-xl">
                    <label className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                      Daily Execution Frequency Cap
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="20"
                      value={account.max_daily_trades}
                      onChange={(e) =>
                        setAccount((prev) => ({ ...prev, max_daily_trades: parseInt(e.target.value, 10) || 6 }))
                      }
                      className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3.5 py-2.5 text-xs text-foreground rounded-lg transition-all shadow-sm font-mono"
                      placeholder="6"
                    />
                    <span className="text-[8px] text-muted block">Limits total entries per day to avoid overtrading churn</span>
                  </div>
                </div>

                {/* Save button */}
                <div className="pt-4 border-t border-card-border flex justify-end">
                  <button
                    onClick={handleSaveAccountRisk}
                    disabled={saveStatus === "saving" || parseFloat(account.risk_per_trade_pct) > parseFloat(account.max_risk_limit_pct)}
                    className={`flex items-center gap-2 px-5 py-2.5 border font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer rounded-lg shadow-sm ${saveStatus === "saving"
                      ? "bg-accent/10 border-accent/30 text-accent/50 cursor-wait"
                      : saveStatus === "success"
                        ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                        : saveStatus === "error"
                          ? "bg-rose-500/10 border-rose-500/40 text-rose-600 dark:text-rose-400"
                          : "bg-card border border-card-border hover:border-accent text-slate-500 dark:text-zinc-400 hover:text-foreground"
                      }`}
                  >
                    {saveStatus === "saving" ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Committing...</span>
                      </>
                    ) : saveStatus === "success" ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Risk Config Saved</span>
                      </>
                    ) : saveStatus === "error" ? (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Failed</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>Commit Risk Config</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: PROFILE ────────────────────────────────────────────── */}
            {activeTab === "profile" && (
              <div className="space-y-6 animate-[fade-in_0.2s_ease-out]">
                <div>
                  <h2 className="text-xs font-black tracking-widest text-accent uppercase flex items-center gap-2 mb-1">
                    <User className="w-4 h-4 text-purple-400" /> [ 03 / OPERATOR IDENTITY MATRIX ]
                  </h2>
                  <p className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black">
                    Institutional Identity Card & Node Level access details
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Identity card */}
                  <div className="bg-card/40 border border-card-border p-5 rounded-2xl flex flex-col justify-between min-h-[140px] relative group hover:border-accent/40 transition-colors shadow-md">
                    <div className="flex justify-between items-start">
                      <div className="space-y-0.5">
                        <span className="text-[8px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">OPERATOR EMAIL</span>
                        <span className="text-xs font-black text-foreground">{session.user?.email}</span>
                      </div>
                      <UserCheck className="w-4 h-4 text-[#50ffaf]" />
                    </div>
                    <div className="mt-4 pt-3 border-t border-card-border flex justify-between items-center text-[9px]">
                      <span className="text-slate-500 dark:text-zinc-400 uppercase font-black">CLIENT NODE STATUS</span>
                      <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-black uppercase tracking-wider text-[8px] rounded">
                        ACTIVE SECURE
                      </span>
                    </div>
                  </div>

                  {/* System Level Card */}
                  <div className="bg-card/40 border border-card-border p-5 rounded-2xl flex flex-col justify-between min-h-[140px] relative group hover:border-accent/40 transition-colors shadow-md">
                    <div className="flex justify-between items-start">
                      <div className="space-y-0.5">
                        <span className="text-[8px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">SECURITY PROFILE</span>
                        <span className="text-xs font-black text-foreground">Institutional Level 3</span>
                      </div>
                      <Globe className="w-4 h-4 text-accent" />
                    </div>
                    <div className="mt-4 pt-3 border-t border-card-border flex justify-between items-center text-[9px]">
                      <span className="text-slate-500 dark:text-zinc-400 uppercase font-black">LICENSE TYPE</span>
                      <span className="text-foreground font-black uppercase tracking-wider text-[9px]">
                        ENTERPRISE Lifetime
                      </span>
                    </div>
                  </div>

                  {/* Database Metadata Card */}
                  <div className="bg-card/40 border border-card-border p-5 rounded-2xl flex flex-col justify-between min-h-[140px] relative group hover:border-accent/40 transition-colors shadow-md">
                    <div className="flex justify-between items-start">
                      <div className="space-y-0.5">
                        <span className="text-[8px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">DATABASE VAULT</span>
                        <span className="text-xs font-black text-foreground">Vercel Serverless Postgres</span>
                      </div>
                      <Database className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div className="mt-4 pt-3 border-t border-card-border flex justify-between items-center text-[9px]">
                      <span className="text-slate-500 dark:text-zinc-400 uppercase font-black">SCHEMA ENFORCEMENT</span>
                      <span className="text-cyan-600 dark:text-cyan-400 font-black uppercase tracking-wider text-[9px]">
                        Self-Healing ON
                      </span>
                    </div>
                  </div>

                  {/* Session Context Card */}
                  <div className="bg-card/40 border border-card-border p-5 rounded-2xl flex flex-col justify-between min-h-[140px] relative group hover:border-accent/40 transition-colors shadow-md">
                    <div className="flex justify-between items-start">
                      <div className="space-y-0.5">
                        <span className="text-[8px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">SESSION INGRESS</span>
                        <span className="text-xs font-black text-foreground">Direct JWT Signature</span>
                      </div>
                      <Shield className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="mt-4 pt-3 border-t border-card-border flex justify-between items-center text-[9px]">
                      <span className="text-slate-500 dark:text-zinc-400 uppercase font-black">EXPIRE STATUS</span>
                      <span className="text-[#50ffaf] font-black uppercase tracking-wider text-[8px]">
                        SYNCHRONIZED
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: TERMINAL ───────────────────────────────────────────── */}
            {activeTab === "terminal" && (
              <div className="space-y-6 animate-[fade-in_0.2s_ease-out]">
                <div>
                  <h2 className="text-xs font-black tracking-widest text-accent uppercase flex items-center gap-2 mb-1">
                    <Layout className="w-4 h-4 text-purple-400" /> [ 04 / TERMINAL ENVIRONMENT & ALERTS ]
                  </h2>
                  <p className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black">
                    Configure sound notifications and HUD aesthetic configurations
                  </p>
                </div>

                {/* ── Sub-Section: Visual Toggles (Sync to Local Storage) ──────── */}
                <div className="space-y-3 bg-card/30 border border-card-border p-5 rounded-2xl shadow-inner">
                  <span className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block mb-2 border-b border-card-border pb-1.5">
                    Visual & Audio Feedback Toggles (Client Local Storage)
                  </span>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Ambient Glow */}
                    <label className="flex items-center gap-3 cursor-pointer group bg-card/50 p-4 border border-card-border hover:border-accent transition-all rounded-xl shadow-sm">
                      <input
                        type="checkbox"
                        checked={ambientGlow}
                        onChange={(e) => setAmbientGlow(e.target.checked)}
                        className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all"
                      />
                      <div className="flex flex-col select-none">
                        <span className="text-[9px] font-black uppercase text-foreground tracking-wider group-hover:text-accent transition-colors">
                          Ambient Neon Glow
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-zinc-150">Enable neon background glows</span>
                      </div>
                    </label>

                    {/* Compact Mode */}
                    <label className="flex items-center gap-3 cursor-pointer group bg-card/50 p-4 border border-card-border hover:border-accent transition-all rounded-xl shadow-sm">
                      <input
                        type="checkbox"
                        checked={compactMode}
                        onChange={(e) => setCompactMode(e.target.checked)}
                        className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all"
                      />
                      <div className="flex flex-col select-none">
                        <span className="text-[9px] font-black uppercase text-foreground tracking-wider group-hover:text-accent transition-colors">
                          Compact Dashboard
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-zinc-150">Reduce spacing of layout cells</span>
                      </div>
                    </label>

                    {/* Live Ticks Sound */}
                    <label className="flex items-center gap-3 cursor-pointer group bg-card/50 p-4 border border-card-border hover:border-accent transition-all rounded-xl shadow-sm">
                      <input
                        type="checkbox"
                        checked={liveTicksSound}
                        onChange={(e) => setLiveTicksSound(e.target.checked)}
                        className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all"
                      />
                      <div className="flex flex-col select-none">
                        <span className="text-[9px] font-black uppercase text-foreground tracking-wider group-hover:text-accent transition-colors">
                          Price Ticks Sound
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-zinc-150">Play mechanical clicks on WS updates</span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* ── Sub-Section: Audio Alert Mappings (Sync to PostgreSQL) ─── */}
                <div className="space-y-4">
                  <span className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block border-b border-card-border pb-1.5">
                    Dedicated Quantitative Audio Signal Event Mappings (Sync to Cloud)
                  </span>

                  <div className="space-y-3 px-1.5 max-h-[350px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-card-border scrollbar-track-transparent">
                    {[
                      { key: "AUTO_ORDER_ROUTED", label: "Auto OB Order Routed", desc: "Fires when autonomous 3-stage position is opened" },
                      { key: "STAGE_FILL", label: "Tranche Scale Fill (40/40/20)", desc: "Fires when Stage 1/2/3 scaling or ratchet update occurs" },
                      { key: "LIVE_OB_DETECTED", label: "Live OB Structural Detection", desc: "Fires when a new institutional Order Block confirms on candle close" },
                      { key: "IN_ZONE_CONFIRMATION_PENDING", label: "In-Zone Volumetric Test", desc: "Fires when live price enters an active zone awaiting confirmation" },
                      { key: "STRATEGY_MATCHED", label: "Strategy Architect Match", desc: "Fires when custom user-built equations match condition gates" },
                      { key: "FVG_DETECTION", label: "FVG Imbalance Detection", desc: "Fires when a new Fair Value Gap forms" },
                      { key: "DISPLACEMENT_CONFIRMED", label: "Displacement Sponsorship", desc: "Fires when institutional displacement acts" },
                      { key: "SMT_TRAP_ACTIVE", label: "SMT Divergence Trap", desc: "Fires when Equal Highs/Lows are engineered" },
                      { key: "DOL_EXHAUSTED", label: "Daily Objective Hit", desc: "Fires when daily structural levels are swept" },
                      { key: "SESSION_TRANSITION", label: "Session Transition Crossing", desc: "Fires when entering a new Killzone window" },
                      { key: "PRICING_SHIFT", label: "Pricing Equilibrium Crossing", desc: "Fires when crossing premium/discount threshold" },
                      { key: "SWEEP_ALERT", label: "Liquidity Sweep Trigger", desc: "Fires when session highs or lows are swept" },
                      { key: "FLOW_STATE_CHANGE", label: "Flow State Trend Shift", desc: "Fires when the open interest trend shifts" },
                      { key: "DEAD_ZONE_ENTER", label: "Temporal Dead Zone Entrance", desc: "Fires when crossing into high-risk hour slots" },
                    ].map((ev) => {
                      const currentFile = signalAlerts[ev.key as keyof SignalAlerts];
                      const isEnabled = signalAlertsEnabled[ev.key as keyof SignalAlertsEnabled] !== false;

                      return (
                        <div
                          key={ev.key}
                          className="flex flex-col md:flex-row md:items-center justify-between p-4 bg-card/45 border border-card-border rounded-xl gap-3 group hover:border-accent/40 transition-colors shadow-sm"
                        >
                          <div className="space-y-0.5">
                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={isEnabled}
                                onChange={() =>
                                  setSignalAlertsEnabled((prev) => ({
                                    ...prev,
                                    [ev.key]: !prev[ev.key as keyof SignalAlertsEnabled],
                                  }))
                                }
                                className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all"
                              />
                              <span className="text-[10px] font-black uppercase text-foreground tracking-widest group-hover:text-accent transition-colors">
                                {ev.label}
                              </span>
                            </label>
                            <span className="block text-[8px] text-slate-500 dark:text-zinc-500 font-bold uppercase pl-6.5 leading-none">
                              {ev.desc}
                            </span>
                          </div>

                          <div className="flex gap-2 pl-6.5 md:pl-0 shrink-0">
                            <select
                              value={currentFile}
                              disabled={!isEnabled}
                              onChange={(e) =>
                                setSignalAlerts((prev) => ({
                                  ...prev,
                                  [ev.key]: e.target.value,
                                }))
                              }
                              className="bg-card/60 border border-card-border text-[10px] font-sans text-foreground focus:outline-none focus:border-accent px-3 py-2 rounded-lg cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
                            >
                              {AVAILABLE_ALERT_FILES.map((file) => (
                                <option key={file} value={file}>
                                  {file}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handlePlaySound(currentFile)}
                              disabled={!currentFile || !isEnabled}
                              className="flex items-center gap-1.5 px-3 py-2 bg-card border border-card-border hover:bg-card-hover/20 text-slate-500 dark:text-zinc-400 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed text-[9px] font-black uppercase transition-all cursor-pointer shadow-sm rounded-lg"
                              title="Play audio preview file"
                            >
                              <Play size={10} fill="currentColor" />
                              <span>Play</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Save button */}
                <div className="pt-4 border-t border-card-border flex justify-end">
                  <button
                    onClick={handleSaveTerminal}
                    disabled={saveStatus === "saving"}
                    className={`flex items-center gap-2 px-5 py-2.5 border font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer rounded-lg shadow-sm ${saveStatus === "saving"
                      ? "bg-accent/10 border-accent/30 text-accent/50 cursor-wait"
                      : saveStatus === "success"
                        ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                        : saveStatus === "error"
                          ? "bg-rose-500/10 border-rose-500/40 text-rose-600 dark:text-rose-400"
                          : "bg-card border border-card-border hover:border-accent text-slate-500 dark:text-zinc-400 hover:text-foreground"
                      }`}
                  >
                    {saveStatus === "saving" ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Committing...</span>
                      </>
                    ) : saveStatus === "success" ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Terminal Saved</span>
                      </>
                    ) : saveStatus === "error" ? (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Failed</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>Commit Terminal Config</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 5: APPEARANCE CUSTOMIZER ─────────────────────────────────── */}
            {activeTab === "appearance" && (
              <div className="space-y-6 animate-[fade-in_0.2s_ease-out]">
                <div>
                  <h2 className="text-xs font-black tracking-widest text-accent uppercase flex items-center gap-2 mb-1">
                    <Palette className="w-4 h-4 text-pink-400" /> [ 05 / SYSTEM THEME CUSTOMIZATION STUDIO ]
                  </h2>
                  <p className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black">
                    Select custom HEX palettes and opacity levels for Midnight and Daylight presets
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Midnight Theme Customizer */}
                  <div className="space-y-4 bg-card/30 border border-card-border p-5 rounded-2xl relative shadow-sm">
                    <div className="flex justify-between items-center border-b border-card-border/60 pb-3">
                      <span className="text-[10px] font-black text-foreground tracking-widest uppercase">Midnight Customizer</span>
                      <button
                        type="button"
                        onClick={() => {
                          const resetDark: any = {};
                          Object.keys(DEFAULT_THEME_SETTINGS).forEach((key) => {
                            if (key.startsWith("dark_")) {
                              resetDark[key] = DEFAULT_THEME_SETTINGS[key as keyof typeof DEFAULT_THEME_SETTINGS];
                            }
                          });
                          setThemeSettings((prev: any) => ({
                            ...prev,
                            ...resetDark,
                          }));
                        }}
                        className="px-2.5 py-1 bg-card border border-card-border hover:border-rose-500/50 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 text-[8px] font-black uppercase rounded-lg transition-all cursor-pointer shadow-sm"
                      >
                        Reset Defaults
                      </button>
                    </div>

                    {/* Midnight Live Swatch Mockup Box */}
                    <div className="space-y-1 select-none">
                      <span className="text-[8px] text-zinc-500 uppercase tracking-widest block font-bold">Midnight Swatch Preview</span>
                      <div
                        className="w-full h-44 rounded-xl p-2.5 flex flex-col justify-between border transition-all text-[8px] font-sans leading-none overflow-hidden"
                        style={{
                          backgroundColor: themeSettings.dark_bg,
                          borderColor: themeSettings.dark_chart_border
                        }}
                      >
                        {/* Mini Header */}
                        <div
                          className="flex justify-between items-center w-full px-2 py-1.5 border-b rounded-t-lg transition-all animate-[fade-in_0.3s_ease-out]"
                          style={{
                            backgroundColor: themeSettings.dark_header_bg,
                            borderColor: themeSettings.dark_header_border
                          }}
                        >
                          <div className="flex items-center gap-1">
                            <Sliders className="w-2 h-2 animate-[spin_10s_linear_infinite]" style={{ color: themeSettings.dark_header_icon }} />
                            <span className="font-black uppercase tracking-wider text-[7px]" style={{ color: themeSettings.dark_header_text }}>QUANT HUD</span>
                          </div>
                          <div className="flex gap-2 text-[6px] font-black items-center">
                            <span style={{ color: themeSettings.dark_header_link_idle }}>IDLE</span>
                            <span style={{ color: themeSettings.dark_header_link_hover }} className="underline">HOVER</span>
                            <span className="px-1.5 py-0.5 rounded-[3px] text-[5px]" style={{ backgroundColor: themeSettings.dark_header_link_active_bg, color: themeSettings.dark_header_link_active }}>ACTIVE</span>
                          </div>
                        </div>

                        {/* Mid Section: Chart and Sidebar */}
                        <div className="flex-1 flex gap-2 w-full pt-1.5 overflow-hidden">
                          {/* Mini Chart Area */}
                          <div
                            className="flex-1 rounded-lg border p-1.5 flex flex-col justify-between relative transition-all"
                            style={{
                              backgroundColor: themeSettings.dark_bg,
                              borderColor: themeSettings.dark_chart_border,
                              backgroundImage: `radial-gradient(${themeSettings.dark_chart_grid} 1px, transparent 1px)`,
                              backgroundSize: '8px 8px'
                            }}
                          >
                            <div className="flex justify-between items-center text-[5px]">
                              <span style={{ color: themeSettings.dark_chart_text }}>07:00 TDO</span>
                              <span style={{ color: themeSettings.dark_chart_swing_high }} className="font-bold">▲ HIGH</span>
                            </div>

                            {/* Candles and FVG Box */}
                            <div className="flex-1 flex items-center justify-center gap-2 relative">
                              {/* FVG Box */}
                              <div className="absolute inset-x-2 h-3 border" style={{
                                backgroundColor: `color-mix(in srgb, ${themeSettings.dark_chart_fvg_bullish} 15%, transparent)`,
                                borderColor: themeSettings.dark_chart_fvg_bullish,
                                borderStyle: 'dashed'
                              }} />

                              {/* Candle 1 */}
                              <div className="flex flex-col items-center w-1.5 h-full justify-center z-10">
                                <div className="w-0.5 h-2" style={{ backgroundColor: themeSettings.dark_up_candle }} />
                                <div className="w-1.5 h-6 rounded-sm" style={{ backgroundColor: themeSettings.dark_up_candle }} />
                                <div className="w-0.5 h-2" style={{ backgroundColor: themeSettings.dark_up_candle }} />
                              </div>
                              {/* Candle 2 */}
                              <div className="flex flex-col items-center w-1.5 h-full justify-center z-10">
                                <div className="w-0.5 h-3" style={{ backgroundColor: themeSettings.dark_down_candle }} />
                                <div className="w-1.5 h-5 rounded-sm" style={{ backgroundColor: themeSettings.dark_down_candle }} />
                                <div className="w-0.5 h-3" style={{ backgroundColor: themeSettings.dark_down_candle }} />
                              </div>
                            </div>

                            <div className="flex justify-between items-center text-[5px]">
                              <span className="px-1 rounded-[2px] text-[5px] font-black" style={{ backgroundColor: `color-mix(in srgb, ${themeSettings.dark_chart_bos} 15%, transparent)`, color: themeSettings.dark_chart_bos }}>BOS</span>
                              <span style={{ color: themeSettings.dark_chart_swing_low }} className="font-bold">▼ LOW</span>
                            </div>
                          </div>

                          {/* Mini Sidebar Area */}
                          <div
                            className="w-20 rounded-lg p-1.5 flex flex-col justify-between border transition-all"
                            style={{
                              backgroundColor: `color-mix(in srgb, ${themeSettings.dark_card} ${themeSettings.dark_card_opacity}%, transparent)`,
                              borderColor: themeSettings.dark_chart_border
                            }}
                          >
                            <div className="flex flex-col gap-0.5">
                              <span className="font-black text-[6px] tracking-wider" style={{ color: themeSettings.dark_text_sidebar_title }}>SYS INFO</span>
                              <div className="h-[1px] w-full mt-0.5" style={{ backgroundColor: themeSettings.dark_chart_border }} />
                            </div>
                            <div className="flex flex-col gap-0.5 my-1">
                              <span style={{ color: themeSettings.dark_text_sidebar_label }} className="text-[5px] font-bold">METRIC LABEL</span>
                              <span style={{ color: themeSettings.dark_text_sidebar_value }} className="font-bold font-mono text-[7px] leading-tight select-all">18,245.50</span>
                            </div>
                            <div className="text-[5px] leading-tight font-medium" style={{ color: themeSettings.dark_text_sidebar_notes }}>
                              * System telemetry active.
                            </div>
                          </div>
                        </div>

                        {/* Bottom Buttons Mock */}
                        <div className="flex gap-2 pt-1.5 w-full">
                          {/* Solid Button */}
                          <div
                            className="flex-1 py-1 rounded-[3px] text-center font-black text-[6px] uppercase tracking-wider transition-all"
                            style={{
                              backgroundColor: themeSettings.dark_btn_solid_bg,
                              color: themeSettings.dark_btn_solid_text
                            }}
                          >
                            SOLID BTN
                          </div>
                          {/* Transparent Button */}
                          <div
                            className="flex-1 py-1 rounded-[3px] text-center font-black text-[6px] uppercase tracking-wider border transition-all"
                            style={{
                              borderColor: themeSettings.dark_btn_trans_border,
                              color: themeSettings.dark_btn_trans_text,
                              backgroundColor: 'transparent'
                            }}
                          >
                            OUTLINE BTN
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-card-border">
                      {/* Section 1: Panels */}
                      <details className="group border border-card-border/80 rounded-xl overflow-hidden [&_summary::-webkit-details-marker]:hidden bg-card/10 hover:border-accent/40 transition-colors" open>
                        <summary className="flex justify-between items-center p-3.5 cursor-pointer select-none bg-card/30 hover:bg-card/50 transition-colors">
                          <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2">
                            <Sliders className="w-3.5 h-3.5 text-cyan-400 group-open:rotate-90 transition-transform" />
                            1. Base Layout & Panels
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase transition-transform group-open:rotate-180">▼</span>
                        </summary>
                        <div className="p-4 space-y-3.5 border-t border-card-border/60 bg-card/5 animate-[fade-in_0.2s_ease-out]">
                          <ColorPickerItem label="Obsidian Background" value={themeSettings.dark_bg} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_bg: val }))} />
                          <ColorPickerItem label="Card Panel Fill" value={themeSettings.dark_card} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_card: val }))} />
                          <SliderItem label="Card Panel Opacity" value={themeSettings.dark_card_opacity} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_card_opacity: val }))} />
                          <ColorPickerItem label="Accent Neon Glow" value={themeSettings.dark_accent} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_accent: val }))} />
                          <ColorPickerItem label="Interactive Default" value={themeSettings.dark_interactive_default} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_interactive_default: val }))} />
                          <ColorPickerItem label="Interactive Active" value={themeSettings.dark_interactive_active} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_interactive_active: val }))} />
                          <ColorPickerItem label="Interactive Hover" value={themeSettings.dark_interactive_hover} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_interactive_hover: val }))} />
                        </div>
                      </details>

                      {/* Section 2: Header & Navigation */}
                      <details className="group border border-card-border/80 rounded-xl overflow-hidden [&_summary::-webkit-details-marker]:hidden bg-card/10 hover:border-accent/40 transition-colors">
                        <summary className="flex justify-between items-center p-3.5 cursor-pointer select-none bg-card/30 hover:bg-card/50 transition-colors">
                          <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2">
                            <Layout className="w-3.5 h-3.5 text-pink-400 group-open:rotate-90 transition-transform" />
                            2. Header & Navigation
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase transition-transform group-open:rotate-180">▼</span>
                        </summary>
                        <div className="p-4 space-y-3.5 border-t border-card-border/60 bg-card/5 animate-[fade-in_0.2s_ease-out]">
                          <ColorPickerItem label="Header Background" value={themeSettings.dark_header_bg} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_header_bg: val }))} />
                          <ColorPickerItem label="Header Border" value={themeSettings.dark_header_border} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_header_border: val }))} />
                          <ColorPickerItem label="Header Text" value={themeSettings.dark_header_text} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_header_text: val }))} />
                          <ColorPickerItem label="Header Icon" value={themeSettings.dark_header_icon} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_header_icon: val }))} />
                          <ColorPickerItem label="Nav Link Idle" value={themeSettings.dark_header_link_idle} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_header_link_idle: val }))} />
                          <ColorPickerItem label="Nav Link Hover" value={themeSettings.dark_header_link_hover} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_header_link_hover: val }))} />
                          <ColorPickerItem label="Nav Link Active" value={themeSettings.dark_header_link_active} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_header_link_active: val }))} />
                          <ColorPickerItem label="Nav Link Active BG" value={themeSettings.dark_header_link_active_bg} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_header_link_active_bg: val }))} />
                        </div>
                      </details>

                      {/* Section 3: Chart Layout & Indicators */}
                      <details className="group border border-card-border/80 rounded-xl overflow-hidden [&_summary::-webkit-details-marker]:hidden bg-card/10 hover:border-accent/40 transition-colors">
                        <summary className="flex justify-between items-center p-3.5 cursor-pointer select-none bg-card/30 hover:bg-card/50 transition-colors">
                          <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2">
                            <Crosshair className="w-3.5 h-3.5 text-[#50ffaf] group-open:rotate-90 transition-transform" />
                            3. Chart Layout & Indicators
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase transition-transform group-open:rotate-180">▼</span>
                        </summary>
                        <div className="p-4 space-y-3.5 border-t border-card-border/60 bg-card/5 animate-[fade-in_0.2s_ease-out]">
                          <ColorPickerItem label="Grid Lines" value={themeSettings.dark_chart_grid} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_grid: val }))} />
                          <ColorPickerItem label="Border Scales" value={themeSettings.dark_chart_border} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_border: val }))} />
                          <ColorPickerItem label="Axes Text" value={themeSettings.dark_chart_text} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_text: val }))} />
                          <ColorPickerItem label="Bullish Candle Body" value={themeSettings.dark_up_candle} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_up_candle: val }))} />
                          <ColorPickerItem label="Bearish Candle Body" value={themeSettings.dark_down_candle} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_down_candle: val }))} />
                          <ColorPickerItem label="Swing High Pivot" value={themeSettings.dark_chart_swing_high} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_swing_high: val }))} />
                          <ColorPickerItem label="Swing Low Pivot" value={themeSettings.dark_chart_swing_low} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_swing_low: val }))} />
                          <ColorPickerItem label="Internal Swing High" value={themeSettings.dark_chart_swing_high_internal} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_swing_high_internal: val }))} />
                          <ColorPickerItem label="Internal Swing Low" value={themeSettings.dark_chart_swing_low_internal} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_swing_low_internal: val }))} />
                          <ColorPickerItem label="BOS Structural Badge" value={themeSettings.dark_chart_bos} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_bos: val }))} />
                          <ColorPickerItem label="MSS Structural Badge" value={themeSettings.dark_chart_mss} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_mss: val }))} />
                          <ColorPickerItem label="Bullish FVG Box" value={themeSettings.dark_chart_fvg_bullish} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_fvg_bullish: val }))} />
                          <ColorPickerItem label="Bearish FVG Box" value={themeSettings.dark_chart_fvg_bearish} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_fvg_bearish: val }))} />
                          <ColorPickerItem label="Asian Session Range" value={themeSettings.dark_chart_session_asian} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_session_asian: val }))} />
                          <ColorPickerItem label="London Session Range" value={themeSettings.dark_chart_session_london} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_session_london: val }))} />
                          <ColorPickerItem label="Buy-Side Liquidity (BSL)" value={themeSettings.dark_chart_magnet_bsl} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_magnet_bsl: val }))} />
                          <ColorPickerItem label="Sell-Side Liquidity (SSL)" value={themeSettings.dark_chart_magnet_ssl} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_magnet_ssl: val }))} />
                          <ColorPickerItem label="Strong Volumetric Arrow" value={themeSettings.dark_chart_volumetric_strong_arrow} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_chart_volumetric_strong_arrow: val }))} />
                          <ColorPickerItem label="Manual Entry Line" value={themeSettings.theme_manual_entry_line} onChange={(val) => setThemeSettings((s: any) => ({ ...s, theme_manual_entry_line: val }))} />
                          <ColorPickerItem label="Manual Take Profit Line" value={themeSettings.theme_manual_tp_line} onChange={(val) => setThemeSettings((s: any) => ({ ...s, theme_manual_tp_line: val }))} />
                          <ColorPickerItem label="Manual Stop Loss Line" value={themeSettings.theme_manual_sl_line} onChange={(val) => setThemeSettings((s: any) => ({ ...s, theme_manual_sl_line: val }))} />

                          {/* ATR Multiplier Volatility Gating Input */}
                          <div className="flex items-center justify-between py-2 border-b border-card-border/30 px-1 font-sans">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">iSTR Volatility Filter (ATR Multiplier)</span>
                            <input
                              type="text"
                              value={themeSettings.structure_istr_atr_multiplier || '1.5'}
                              onChange={(e) => setThemeSettings((s: any) => ({ ...s, structure_istr_atr_multiplier: e.target.value }))}
                              placeholder="1.5"
                              className="bg-background/60 border border-card-border/80 focus:border-accent focus:outline-none px-2.5 py-1 text-xs font-mono text-foreground rounded-lg w-[76px] shrink-0 text-center transition-all shadow-sm"
                            />
                          </div>
                        </div>
                      </details>

                      {/* Section 4: Interactive Buttons */}
                      <details className="group border border-card-border/80 rounded-xl overflow-hidden [&_summary::-webkit-details-marker]:hidden bg-card/10 hover:border-accent/40 transition-colors">
                        <summary className="flex justify-between items-center p-3.5 cursor-pointer select-none bg-card/30 hover:bg-card/50 transition-colors">
                          <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2">
                            <Palette className="w-3.5 h-3.5 text-amber-400 group-open:rotate-90 transition-transform" />
                            4. Interactive Buttons
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase transition-transform group-open:rotate-180">▼</span>
                        </summary>
                        <div className="p-4 space-y-3.5 border-t border-card-border/60 bg-card/5 animate-[fade-in_0.2s_ease-out]">
                          <ColorPickerItem label="Solid Button Background" value={themeSettings.dark_btn_solid_bg} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_btn_solid_bg: val }))} />
                          <ColorPickerItem label="Solid Button Hover BG" value={themeSettings.dark_btn_solid_bg_hover} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_btn_solid_bg_hover: val }))} />
                          <ColorPickerItem label="Solid Button Text" value={themeSettings.dark_btn_solid_text} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_btn_solid_text: val }))} />
                          <ColorPickerItem label="Outline Button Border" value={themeSettings.dark_btn_trans_border} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_btn_trans_border: val }))} />
                          <ColorPickerItem label="Outline Button Hover BG" value={themeSettings.dark_btn_trans_bg_hover} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_btn_trans_bg_hover: val }))} />
                          <ColorPickerItem label="Outline Button Text" value={themeSettings.dark_btn_trans_text} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_btn_trans_text: val }))} />
                        </div>
                      </details>

                      {/* Section 5: Sidebar & System Info */}
                      <details className="group border border-card-border/80 rounded-xl overflow-hidden [&_summary::-webkit-details-marker]:hidden bg-card/10 hover:border-accent/40 transition-colors">
                        <summary className="flex justify-between items-center p-3.5 cursor-pointer select-none bg-card/30 hover:bg-card/50 transition-colors">
                          <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2">
                            <FileText className="w-3.5 h-3.5 text-indigo-400 group-open:rotate-90 transition-transform" />
                            5. Sidebar & System Info
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase transition-transform group-open:rotate-180">▼</span>
                        </summary>
                        <div className="p-4 space-y-3.5 border-t border-card-border/60 bg-card/5 animate-[fade-in_0.2s_ease-out]">
                          <ColorPickerItem label="Sidebar Header Title" value={themeSettings.dark_text_sidebar_title} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_text_sidebar_title: val }))} />
                          <ColorPickerItem label="Metric Info Label" value={themeSettings.dark_text_sidebar_label} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_text_sidebar_label: val }))} />
                          <ColorPickerItem label="Metric Readout Value" value={themeSettings.dark_text_sidebar_value} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_text_sidebar_value: val }))} />
                          <ColorPickerItem label="Small Footnote Annotation" value={themeSettings.dark_text_sidebar_notes} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_text_sidebar_notes: val }))} />
                          <ColorPickerItem label="Standard Bullish Highlight" value={themeSettings.dark_highlight_up} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_highlight_up: val }))} />
                          <ColorPickerItem label="Standard Bearish Highlight" value={themeSettings.dark_highlight_down} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_highlight_down: val }))} />
                          <ColorPickerItem label="General Title Text" value={themeSettings.dark_text_title} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_text_title: val }))} />
                          <ColorPickerItem label="General Label Text" value={themeSettings.dark_text_label} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_text_label: val }))} />
                          <ColorPickerItem label="General Value Text" value={themeSettings.dark_text_value} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_text_value: val }))} />
                        </div>
                      </details>
                    </div>
                  </div>

                  {/* Daylight Theme Customizer */}
                  <div className="space-y-4 bg-card/30 border border-card-border p-5 rounded-2xl relative shadow-sm">
                    <div className="flex justify-between items-center border-b border-card-border/60 pb-3">
                      <span className="text-[10px] font-black text-foreground tracking-widest uppercase">Daylight Customizer</span>
                      <button
                        type="button"
                        onClick={() => {
                          const resetLight: any = {};
                          Object.keys(DEFAULT_THEME_SETTINGS).forEach((key) => {
                            if (key.startsWith("light_")) {
                              resetLight[key] = DEFAULT_THEME_SETTINGS[key as keyof typeof DEFAULT_THEME_SETTINGS];
                            }
                          });
                          setThemeSettings((prev: any) => ({
                            ...prev,
                            ...resetLight,
                          }));
                        }}
                        className="px-2.5 py-1 bg-card border border-card-border hover:border-rose-500/50 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 text-[8px] font-black uppercase rounded-lg transition-all cursor-pointer shadow-sm"
                      >
                        Reset Defaults
                      </button>
                    </div>

                    {/* Daylight Live Swatch Mockup Box */}
                    <div className="space-y-1 select-none">
                      <span className="text-[8px] text-zinc-500 uppercase tracking-widest block font-bold">Daylight Swatch Preview</span>
                      <div
                        className="w-full h-44 rounded-xl p-2.5 flex flex-col justify-between border transition-all text-[8px] font-sans leading-none overflow-hidden"
                        style={{
                          backgroundColor: themeSettings.light_bg,
                          borderColor: themeSettings.light_chart_border
                        }}
                      >
                        {/* Mini Header */}
                        <div
                          className="flex justify-between items-center w-full px-2 py-1.5 border-b rounded-t-lg transition-all animate-[fade-in_0.3s_ease-out]"
                          style={{
                            backgroundColor: themeSettings.light_header_bg,
                            borderColor: themeSettings.light_header_border
                          }}
                        >
                          <div className="flex items-center gap-1">
                            <Sliders className="w-2 h-2 animate-[spin_10s_linear_infinite]" style={{ color: themeSettings.light_header_icon }} />
                            <span className="font-black uppercase tracking-wider text-[7px]" style={{ color: themeSettings.light_header_text }}>QUANT HUD</span>
                          </div>
                          <div className="flex gap-2 text-[6px] font-black items-center">
                            <span style={{ color: themeSettings.light_header_link_idle }}>IDLE</span>
                            <span style={{ color: themeSettings.light_header_link_hover }} className="underline">HOVER</span>
                            <span className="px-1.5 py-0.5 rounded-[3px] text-[5px]" style={{ backgroundColor: themeSettings.light_header_link_active_bg, color: themeSettings.light_header_link_active }}>ACTIVE</span>
                          </div>
                        </div>

                        {/* Mid Section: Chart and Sidebar */}
                        <div className="flex-1 flex gap-2 w-full pt-1.5 overflow-hidden">
                          {/* Mini Chart Area */}
                          <div
                            className="flex-1 rounded-lg border p-1.5 flex flex-col justify-between relative transition-all"
                            style={{
                              backgroundColor: themeSettings.light_bg,
                              borderColor: themeSettings.light_chart_border,
                              backgroundImage: `radial-gradient(${themeSettings.light_chart_grid} 1px, transparent 1px)`,
                              backgroundSize: '8px 8px'
                            }}
                          >
                            <div className="flex justify-between items-center text-[5px]">
                              <span style={{ color: themeSettings.light_chart_text }}>07:00 TDO</span>
                              <span style={{ color: themeSettings.light_chart_swing_high }} className="font-bold">▲ HIGH</span>
                            </div>

                            {/* Candles and FVG Box */}
                            <div className="flex-1 flex items-center justify-center gap-2 relative">
                              {/* FVG Box */}
                              <div className="absolute inset-x-2 h-3 border" style={{
                                backgroundColor: `color-mix(in srgb, ${themeSettings.light_chart_fvg_bullish} 15%, transparent)`,
                                borderColor: themeSettings.light_chart_fvg_bullish,
                                borderStyle: 'dashed'
                              }} />

                              {/* Candle 1 */}
                              <div className="flex flex-col items-center w-1.5 h-full justify-center z-10">
                                <div className="w-0.5 h-2" style={{ backgroundColor: themeSettings.light_up_candle }} />
                                <div className="w-1.5 h-6 rounded-sm" style={{ backgroundColor: themeSettings.light_up_candle }} />
                                <div className="w-0.5 h-2" style={{ backgroundColor: themeSettings.light_up_candle }} />
                              </div>
                              {/* Candle 2 */}
                              <div className="flex flex-col items-center w-1.5 h-full justify-center z-10">
                                <div className="w-0.5 h-3" style={{ backgroundColor: themeSettings.light_down_candle }} />
                                <div className="w-1.5 h-5 rounded-sm" style={{ backgroundColor: themeSettings.light_down_candle }} />
                                <div className="w-0.5 h-3" style={{ backgroundColor: themeSettings.light_down_candle }} />
                              </div>
                            </div>

                            <div className="flex justify-between items-center text-[5px]">
                              <span className="px-1 rounded-[2px] text-[5px] font-black" style={{ backgroundColor: `color-mix(in srgb, ${themeSettings.light_chart_bos} 15%, transparent)`, color: themeSettings.light_chart_bos }}>BOS</span>
                              <span style={{ color: themeSettings.light_chart_swing_low }} className="font-bold">▼ LOW</span>
                            </div>
                          </div>

                          {/* Mini Sidebar Area */}
                          <div
                            className="w-20 rounded-lg p-1.5 flex flex-col justify-between border transition-all"
                            style={{
                              backgroundColor: `color-mix(in srgb, ${themeSettings.light_card} ${themeSettings.light_card_opacity}%, transparent)`,
                              borderColor: themeSettings.light_chart_border
                            }}
                          >
                            <div className="flex flex-col gap-0.5">
                              <span className="font-black text-[6px] tracking-wider" style={{ color: themeSettings.light_text_sidebar_title }}>SYS INFO</span>
                              <div className="h-[1px] w-full mt-0.5" style={{ backgroundColor: themeSettings.light_chart_border }} />
                            </div>
                            <div className="flex flex-col gap-0.5 my-1">
                              <span style={{ color: themeSettings.light_text_sidebar_label }} className="text-[5px] font-bold">METRIC LABEL</span>
                              <span style={{ color: themeSettings.light_text_sidebar_value }} className="font-bold font-mono text-[7px] leading-tight select-all">18,245.50</span>
                            </div>
                            <div className="text-[5px] leading-tight font-medium" style={{ color: themeSettings.light_text_sidebar_notes }}>
                              * System telemetry active.
                            </div>
                          </div>
                        </div>

                        {/* Bottom Buttons Mock */}
                        <div className="flex gap-2 pt-1.5 w-full">
                          {/* Solid Button */}
                          <div
                            className="flex-1 py-1 rounded-[3px] text-center font-black text-[6px] uppercase tracking-wider transition-all"
                            style={{
                              backgroundColor: themeSettings.light_btn_solid_bg,
                              color: themeSettings.light_btn_solid_text
                            }}
                          >
                            SOLID BTN
                          </div>
                          {/* Transparent Button */}
                          <div
                            className="flex-1 py-1 rounded-[3px] text-center font-black text-[6px] uppercase tracking-wider border transition-all"
                            style={{
                              borderColor: themeSettings.light_btn_trans_border,
                              color: themeSettings.light_btn_trans_text,
                              backgroundColor: 'transparent'
                            }}
                          >
                            OUTLINE BTN
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-card-border">
                      {/* Section 1: Panels */}
                      <details className="group border border-card-border/80 rounded-xl overflow-hidden [&_summary::-webkit-details-marker]:hidden bg-card/10 hover:border-accent/40 transition-colors" open>
                        <summary className="flex justify-between items-center p-3.5 cursor-pointer select-none bg-card/30 hover:bg-card/50 transition-colors">
                          <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2">
                            <Sliders className="w-3.5 h-3.5 text-[#4f46e5] group-open:rotate-90 transition-transform" />
                            1. Base Layout & Panels
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase transition-transform group-open:rotate-180">▼</span>
                        </summary>
                        <div className="p-4 space-y-3.5 border-t border-card-border/60 bg-card/5 animate-[fade-in_0.2s_ease-out]">
                          <ColorPickerItem label="Daylight Background" value={themeSettings.light_bg} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_bg: val }))} />
                          <ColorPickerItem label="Card Panel Fill" value={themeSettings.light_card} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_card: val }))} />
                          <SliderItem label="Card Panel Opacity" value={themeSettings.light_card_opacity} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_card_opacity: val }))} />
                          <ColorPickerItem label="Accent Primary Glow" value={themeSettings.light_accent} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_accent: val }))} />
                          <ColorPickerItem label="Interactive Default" value={themeSettings.light_interactive_default} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_interactive_default: val }))} />
                          <ColorPickerItem label="Interactive Active" value={themeSettings.light_interactive_active} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_interactive_active: val }))} />
                          <ColorPickerItem label="Interactive Hover" value={themeSettings.light_interactive_hover} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_interactive_hover: val }))} />
                        </div>
                      </details>

                      {/* Section 2: Header & Navigation */}
                      <details className="group border border-card-border/80 rounded-xl overflow-hidden [&_summary::-webkit-details-marker]:hidden bg-card/10 hover:border-accent/40 transition-colors">
                        <summary className="flex justify-between items-center p-3.5 cursor-pointer select-none bg-card/30 hover:bg-card/50 transition-colors">
                          <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2">
                            <Layout className="w-3.5 h-3.5 text-[#4f46e5] group-open:rotate-90 transition-transform" />
                            2. Header & Navigation
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase transition-transform group-open:rotate-180">▼</span>
                        </summary>
                        <div className="p-4 space-y-3.5 border-t border-card-border/60 bg-card/5 animate-[fade-in_0.2s_ease-out]">
                          <ColorPickerItem label="Header Background" value={themeSettings.light_header_bg} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_header_bg: val }))} />
                          <ColorPickerItem label="Header Border" value={themeSettings.light_header_border} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_header_border: val }))} />
                          <ColorPickerItem label="Header Text" value={themeSettings.light_header_text} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_header_text: val }))} />
                          <ColorPickerItem label="Header Icon" value={themeSettings.light_header_icon} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_header_icon: val }))} />
                          <ColorPickerItem label="Nav Link Idle" value={themeSettings.light_header_link_idle} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_header_link_idle: val }))} />
                          <ColorPickerItem label="Nav Link Hover" value={themeSettings.light_header_link_hover} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_header_link_hover: val }))} />
                          <ColorPickerItem label="Nav Link Active" value={themeSettings.light_header_link_active} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_header_link_active: val }))} />
                          <ColorPickerItem label="Nav Link Active BG" value={themeSettings.light_header_link_active_bg} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_header_link_active_bg: val }))} />
                        </div>
                      </details>

                      {/* Section 3: Chart Layout & Indicators */}
                      <details className="group border border-card-border/80 rounded-xl overflow-hidden [&_summary::-webkit-details-marker]:hidden bg-card/10 hover:border-accent/40 transition-colors">
                        <summary className="flex justify-between items-center p-3.5 cursor-pointer select-none bg-card/30 hover:bg-card/50 transition-colors">
                          <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2">
                            <Crosshair className="w-3.5 h-3.5 text-[#4f46e5] group-open:rotate-90 transition-transform" />
                            3. Chart Layout & Indicators
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase transition-transform group-open:rotate-180">▼</span>
                        </summary>
                        <div className="p-4 space-y-3.5 border-t border-card-border/60 bg-card/5 animate-[fade-in_0.2s_ease-out]">
                          <ColorPickerItem label="Grid Lines" value={themeSettings.light_chart_grid} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_grid: val }))} />
                          <ColorPickerItem label="Border Scales" value={themeSettings.light_chart_border} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_border: val }))} />
                          <ColorPickerItem label="Axes Text" value={themeSettings.light_chart_text} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_text: val }))} />
                          <ColorPickerItem label="Bullish Candle Body" value={themeSettings.light_up_candle} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_up_candle: val }))} />
                          <ColorPickerItem label="Bearish Candle Body" value={themeSettings.light_down_candle} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_down_candle: val }))} />
                          <ColorPickerItem label="Swing High Pivot" value={themeSettings.light_chart_swing_high} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_swing_high: val }))} />
                          <ColorPickerItem label="Swing Low Pivot" value={themeSettings.light_chart_swing_low} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_swing_low: val }))} />
                          <ColorPickerItem label="Internal Swing High" value={themeSettings.light_chart_swing_high_internal} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_swing_high_internal: val }))} />
                          <ColorPickerItem label="Internal Swing Low" value={themeSettings.light_chart_swing_low_internal} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_swing_low_internal: val }))} />
                          <ColorPickerItem label="BOS Structural Badge" value={themeSettings.light_chart_bos} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_bos: val }))} />
                          <ColorPickerItem label="MSS Structural Badge" value={themeSettings.light_chart_mss} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_mss: val }))} />
                          <ColorPickerItem label="Bullish FVG Box" value={themeSettings.light_chart_fvg_bullish} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_fvg_bullish: val }))} />
                          <ColorPickerItem label="Bearish FVG Box" value={themeSettings.light_chart_fvg_bearish} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_fvg_bearish: val }))} />
                          <ColorPickerItem label="Asian Session Range" value={themeSettings.light_chart_session_asian} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_session_asian: val }))} />
                          <ColorPickerItem label="London Session Range" value={themeSettings.light_chart_session_london} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_session_london: val }))} />
                          <ColorPickerItem label="Buy-Side Liquidity (BSL)" value={themeSettings.light_chart_magnet_bsl} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_magnet_bsl: val }))} />
                          <ColorPickerItem label="Sell-Side Liquidity (SSL)" value={themeSettings.light_chart_magnet_ssl} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_magnet_ssl: val }))} />
                          <ColorPickerItem label="Strong Volumetric Arrow" value={themeSettings.light_chart_volumetric_strong_arrow} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_chart_volumetric_strong_arrow: val }))} />
                          <ColorPickerItem label="Manual Entry Line" value={themeSettings.theme_manual_entry_line} onChange={(val) => setThemeSettings((s: any) => ({ ...s, theme_manual_entry_line: val }))} />
                          <ColorPickerItem label="Manual Take Profit Line" value={themeSettings.theme_manual_tp_line} onChange={(val) => setThemeSettings((s: any) => ({ ...s, theme_manual_tp_line: val }))} />
                          <ColorPickerItem label="Manual Stop Loss Line" value={themeSettings.theme_manual_sl_line} onChange={(val) => setThemeSettings((s: any) => ({ ...s, theme_manual_sl_line: val }))} />
                        </div>
                      </details>

                      {/* Section 4: Interactive Buttons */}
                      <details className="group border border-card-border/80 rounded-xl overflow-hidden [&_summary::-webkit-details-marker]:hidden bg-card/10 hover:border-accent/40 transition-colors">
                        <summary className="flex justify-between items-center p-3.5 cursor-pointer select-none bg-card/30 hover:bg-card/50 transition-colors">
                          <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2">
                            <Palette className="w-3.5 h-3.5 text-[#4f46e5] group-open:rotate-90 transition-transform" />
                            4. Interactive Buttons
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase transition-transform group-open:rotate-180">▼</span>
                        </summary>
                        <div className="p-4 space-y-3.5 border-t border-card-border/60 bg-card/5 animate-[fade-in_0.2s_ease-out]">
                          <ColorPickerItem label="Solid Button Background" value={themeSettings.light_btn_solid_bg} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_btn_solid_bg: val }))} />
                          <ColorPickerItem label="Solid Button Hover BG" value={themeSettings.light_btn_solid_bg_hover} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_btn_solid_bg_hover: val }))} />
                          <ColorPickerItem label="Solid Button Text" value={themeSettings.light_btn_solid_text} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_btn_solid_text: val }))} />
                          <ColorPickerItem label="Outline Button Border" value={themeSettings.light_btn_trans_border} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_btn_trans_border: val }))} />
                          <ColorPickerItem label="Outline Button Hover BG" value={themeSettings.light_btn_trans_bg_hover} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_btn_trans_bg_hover: val }))} />
                          <ColorPickerItem label="Outline Button Text" value={themeSettings.light_btn_trans_text} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_btn_trans_text: val }))} />
                        </div>
                      </details>

                      {/* Section 5: Sidebar & System Info */}
                      <details className="group border border-card-border/80 rounded-xl overflow-hidden [&_summary::-webkit-details-marker]:hidden bg-card/10 hover:border-accent/40 transition-colors">
                        <summary className="flex justify-between items-center p-3.5 cursor-pointer select-none bg-card/30 hover:bg-card/50 transition-colors">
                          <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2">
                            <FileText className="w-3.5 h-3.5 text-[#4f46e5] group-open:rotate-90 transition-transform" />
                            5. Sidebar & System Info
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase transition-transform group-open:rotate-180">▼</span>
                        </summary>
                        <div className="p-4 space-y-3.5 border-t border-card-border/60 bg-card/5 animate-[fade-in_0.2s_ease-out]">
                          <ColorPickerItem label="Sidebar Header Title" value={themeSettings.light_text_sidebar_title} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_text_sidebar_title: val }))} />
                          <ColorPickerItem label="Metric Info Label" value={themeSettings.light_text_sidebar_label} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_text_sidebar_label: val }))} />
                          <ColorPickerItem label="Metric Readout Value" value={themeSettings.light_text_sidebar_value} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_text_sidebar_value: val }))} />
                          <ColorPickerItem label="Small Footnote Annotation" value={themeSettings.light_text_sidebar_notes} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_text_sidebar_notes: val }))} />
                          <ColorPickerItem label="Standard Bullish Highlight" value={themeSettings.light_highlight_up} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_highlight_up: val }))} />
                          <ColorPickerItem label="Standard Bearish Highlight" value={themeSettings.light_highlight_down} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_highlight_down: val }))} />
                          <ColorPickerItem label="General Title Text" value={themeSettings.light_text_title} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_text_title: val }))} />
                          <ColorPickerItem label="General Label Text" value={themeSettings.light_text_label} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_text_label: val }))} />
                          <ColorPickerItem label="General Value Text" value={themeSettings.light_text_value} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_text_value: val }))} />
                        </div>
                      </details>
                    </div>
                  </div>
                </div>

                {/* Commit Button */}
                <div className="pt-4 border-t border-card-border flex justify-end">
                  <button
                    onClick={handleSaveAppearance}
                    disabled={saveStatus === "saving"}
                    className={`flex items-center gap-2 px-5 py-2.5 border font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer rounded-lg shadow-sm ${saveStatus === "saving"
                      ? "bg-accent/10 border-accent/30 text-accent/50 cursor-wait"
                      : saveStatus === "success"
                        ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                        : saveStatus === "error"
                          ? "bg-rose-500/10 border-rose-500/40 text-rose-600 dark:text-rose-400"
                          : "bg-card border border-card-border hover:border-accent text-slate-500 dark:text-zinc-400 hover:text-foreground"
                      }`}
                  >
                    {saveStatus === "saving" ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Committing...</span>
                      </>
                    ) : saveStatus === "success" ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Aesthetic Committed</span>
                      </>
                    ) : saveStatus === "error" ? (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Failed</span>
                      </>
                    ) : (
                      <>
                        <Palette className="w-3.5 h-3.5" />
                        <span>Commit Global Aesthetic</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
