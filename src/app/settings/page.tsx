"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
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
} from "lucide-react";
import { useAlertSounds, AVAILABLE_ALERT_FILES } from "@/hooks/useAlertSounds";
import { DEFAULT_THEME_SETTINGS } from "@/hooks/useMarketData";

// ─── Interfaces ──────────────────────────────────────────────────────────────
interface QuantSettings {
  ACTIVE_MODEL: string;
  SYSTEM_PROMPT: string;
  GEMINI_LIVE_KEY: string;
}

interface AccountState {
  initial_capital: string;
  max_risk_limit_pct: string;
  current_balance: string;
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
const AVAILABLE_MODELS = [
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)" },
  { value: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash (Preview)" },
  { value: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro (Preview)" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
] as const;

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
    current_balance: "10000.00",
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
    dark_bg: "#020617",
    dark_card: "#0f172a",
    dark_accent: "#a855f7",
    dark_up_candle: "#50ffaf",
    dark_down_candle: "#ffb4ab",
    dark_card_opacity: 90,
    dark_interactive_default: "#94a3b8",
    dark_interactive_active: "#a855f7",
    dark_interactive_hover: "#ffffff",
    dark_text_title: "#ffffff",
    dark_text_label: "#64748b",
    dark_text_value: "#f8fafc",
    dark_highlight_up: "#50ffaf",
    dark_highlight_down: "#ffb4ab",
    light_bg: "#fafafa",
    light_card: "#ffffff",
    light_accent: "#4f46e5",
    light_up_candle: "#059669",
    light_down_candle: "#e11d48",
    light_card_opacity: 75,
    light_interactive_default: "#475569",
    light_interactive_active: "#4f46e5",
    light_interactive_hover: "#020617",
    light_text_title: "#020617",
    light_text_label: "#64748b",
    light_text_value: "#334155",
    light_highlight_up: "#059669",
    light_highlight_down: "#e11d48",
  });

  // ── UX Status States ───────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // ── Auth Guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/settings");
    }
  }, [status, router]);

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
    try {
      setIsLoading(true);
      setErrorMessage("");

      // 1. Fetch AI & Terminal settings
      const settingsRes = await fetch("/api/settings");
      if (!settingsRes.ok) throw new Error("Failed to fetch settings from cloud vault.");
      const settingsData = await settingsRes.json();

      const s = settingsData.settings || {};
      setQuantSettings({
        ACTIVE_MODEL: s.ACTIVE_MODEL || "gemini-3.5-flash",
        SYSTEM_PROMPT: s.SYSTEM_PROMPT || "",
        GEMINI_LIVE_KEY: s.GEMINI_LIVE_KEY || "",
      });

      setThemeSettings({
        dark_bg: s.dark_bg || "#020617",
        dark_card: s.dark_card || "#0f172a",
        dark_accent: s.dark_accent || "#a855f7",
        dark_up_candle: s.dark_up_candle || "#50ffaf",
        dark_down_candle: s.dark_down_candle || "#ffb4ab",
        dark_card_opacity: s.dark_card_opacity ? Number(s.dark_card_opacity) : 90,
        dark_interactive_default: s.dark_interactive_default || "#94a3b8",
        dark_interactive_active: s.dark_interactive_active || "#a855f7",
        dark_interactive_hover: s.dark_interactive_hover || "#ffffff",
        dark_text_title: s.dark_text_title || "#ffffff",
        dark_text_label: s.dark_text_label || "#64748b",
        dark_text_value: s.dark_text_value || "#f8fafc",
        dark_highlight_up: s.dark_highlight_up || "#50ffaf",
        dark_highlight_down: s.dark_highlight_down || "#ffb4ab",
        light_bg: s.light_bg || "#fafafa",
        light_card: s.light_card || "#ffffff",
        light_accent: s.light_accent || "#4f46e5",
        light_up_candle: s.light_up_candle || "#059669",
        light_down_candle: s.light_down_candle || "#e11d48",
        light_card_opacity: s.light_card_opacity ? Number(s.light_card_opacity) : 75,
        light_interactive_default: s.light_interactive_default || "#475569",
        light_interactive_active: s.light_interactive_active || "#4f46e5",
        light_interactive_hover: s.light_interactive_hover || "#020617",
        light_text_title: s.light_text_title || "#020617",
        light_text_label: s.light_text_label || "#64748b",
        light_text_value: s.light_text_value || "#334155",
        light_highlight_up: s.light_highlight_up || "#059669",
        light_highlight_down: s.light_highlight_down || "#e11d48",
      });

      if (settingsData.terminalSettings) {
        const { signalSounds, enabledSignals } = settingsData.terminalSettings;
        if (signalSounds) setSignalAlerts(signalSounds);
        if (enabledSignals) setSignalAlertsEnabled(enabledSignals);
      }

      // 2. Fetch Account & Risk settings
      const accountRes = await fetch("/api/account");
      if (accountRes.ok) {
        const accountData = await accountRes.json();
        if (accountData.account) {
          setAccount({
            initial_capital: parseFloat(accountData.account.initial_capital).toFixed(2),
            max_risk_limit_pct: parseFloat(accountData.account.max_risk_limit_pct).toFixed(2),
            current_balance: parseFloat(accountData.account.current_balance).toFixed(2),
          });
        }
      }
    } catch (err) {
      console.error("[SETTINGS PAGE] Load error:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to establish cloud linkage.");
    } finally {
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

  // Save Tab 2: ACCOUNT & RISK Config
  const handleSaveAccountRisk = async () => {
    try {
      setSaveStatus("saving");
      setErrorMessage("");

      const capital = parseFloat(account.initial_capital);
      const riskLimit = parseFloat(account.max_risk_limit_pct);

      if (isNaN(capital) || capital <= 0) {
        throw new Error("Initial Capital must be a positive number.");
      }

      if (isNaN(riskLimit) || riskLimit <= 0 || riskLimit > 100) {
        throw new Error("Max Risk Limit must be a percentage between 0% and 100%.");
      }

      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initial_capital: capital,
          max_risk_limit_pct: riskLimit,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to commit account risk configuration.");
      }

      const json = await res.json();
      if (json.account) {
        setAccount({
          initial_capital: parseFloat(json.account.initial_capital).toFixed(2),
          max_risk_limit_pct: parseFloat(json.account.max_risk_limit_pct).toFixed(2),
          current_balance: parseFloat(json.account.current_balance).toFixed(2),
        });
      }

      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err: unknown) {
      setSaveStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Unknown error occurred");
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
  if (status === "loading" || isLoading) {
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
                  className={`flex items-center gap-3 px-4.5 py-3.5 text-xs md:text-sm font-black uppercase tracking-widest transition-all cursor-pointer whitespace-nowrap lg:w-full border-b-2 lg:border-b-0 lg:border-l-3 ${
                    active
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
                    className={`flex items-center gap-2 px-5 py-2.5 border font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer rounded-lg shadow-sm ${
                      saveStatus === "saving"
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
                    <Sliders className="w-4 h-4 text-emerald-400" /> [ 02 / TRADING ACCOUNT RISK GATES ]
                  </h2>
                  <p className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black">
                    Configure exposure limits and initial dynamic calculation baselines
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 bg-card/30 border border-card-border p-5 rounded-2xl shadow-inner">
                  {/* Total Pool readout */}
                  <div className="space-y-1">
                    <span className="text-[8px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest">
                      Dynamic Ledger Balance
                    </span>
                    <div className="text-xl font-bold tracking-tight text-[#50ffaf] font-mono">
                      ${parseFloat(account.current_balance).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </div>
                    <span className="text-[8px] text-slate-400 dark:text-zinc-500 block">
                      Recalculated from Starting Capital + realizing all CLOSED trades
                    </span>
                  </div>

                  {/* Single deal allocator math readout */}
                  <div className="space-y-1">
                    <span className="text-[8px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest">
                      Single Trade Maximum Loss Cap
                    </span>
                    <div className="text-xl font-bold tracking-tight text-foreground font-mono">
                      ${((parseFloat(account.current_balance) * parseFloat(account.max_risk_limit_pct)) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </div>
                    <span className="text-[8px] text-slate-400 dark:text-zinc-500 block">
                      Ledger Balance × Max Risk % ({account.max_risk_limit_pct}%)
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Initial Capital Seed input */}
                  <div className="space-y-2">
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
                  </div>

                  {/* Max Risk Limit Input */}
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest block">
                      Max Risk Limit (Percentage)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max="100"
                        value={account.max_risk_limit_pct}
                        onChange={(e) =>
                          setAccount((prev) => ({ ...prev, max_risk_limit_pct: e.target.value }))
                        }
                        className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none pl-3.5 pr-8 py-2.5 text-xs text-foreground rounded-lg transition-all shadow-sm font-mono"
                        placeholder="3.00"
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-zinc-500 text-[10px] font-bold">%</span>
                    </div>
                  </div>
                </div>

                {/* Save button */}
                <div className="pt-4 border-t border-card-border flex justify-end">
                  <button
                    onClick={handleSaveAccountRisk}
                    disabled={saveStatus === "saving"}
                    className={`flex items-center gap-2 px-5 py-2.5 border font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer rounded-lg shadow-sm ${
                      saveStatus === "saving"
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
                        <span>Config Saved</span>
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
                        <span className="text-[8px] text-slate-400 dark:text-zinc-500">Enable neon background glows</span>
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
                        <span className="text-[8px] text-slate-400 dark:text-zinc-500">Reduce spacing of layout cells</span>
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
                        <span className="text-[8px] text-slate-400 dark:text-zinc-500">Play mechanical clicks on WS updates</span>
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
                    className={`flex items-center gap-2 px-5 py-2.5 border font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer rounded-lg shadow-sm ${
                      saveStatus === "saving"
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
                        onClick={() => setThemeSettings((prev: any) => ({
                          ...prev,
                          dark_bg: DEFAULT_THEME_SETTINGS.dark_bg,
                          dark_card: DEFAULT_THEME_SETTINGS.dark_card,
                          dark_accent: DEFAULT_THEME_SETTINGS.dark_accent,
                          dark_up_candle: DEFAULT_THEME_SETTINGS.dark_up_candle,
                          dark_down_candle: DEFAULT_THEME_SETTINGS.dark_down_candle,
                          dark_card_opacity: DEFAULT_THEME_SETTINGS.dark_card_opacity,
                          dark_interactive_default: DEFAULT_THEME_SETTINGS.dark_interactive_default,
                          dark_interactive_active: DEFAULT_THEME_SETTINGS.dark_interactive_active,
                          dark_interactive_hover: DEFAULT_THEME_SETTINGS.dark_interactive_hover,
                          dark_text_title: DEFAULT_THEME_SETTINGS.dark_text_title,
                          dark_text_label: DEFAULT_THEME_SETTINGS.dark_text_label,
                          dark_text_value: DEFAULT_THEME_SETTINGS.dark_text_value,
                          dark_highlight_up: DEFAULT_THEME_SETTINGS.dark_highlight_up,
                          dark_highlight_down: DEFAULT_THEME_SETTINGS.dark_highlight_down,
                        }))}
                        className="px-2.5 py-1 bg-card border border-card-border hover:border-rose-500/50 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 text-[8px] font-black uppercase rounded-lg transition-all cursor-pointer shadow-sm"
                      >
                        Reset Defaults
                      </button>
                    </div>

                    {/* Midnight Live Swatch Mockup Box */}
                    <div className="space-y-1 select-none">
                      <span className="text-[8px] text-zinc-500 uppercase tracking-widest block font-bold">Midnight Swatch Preview</span>
                      <div 
                        className="w-full h-24 rounded-xl p-2.5 flex flex-col justify-between border transition-all text-[8px] font-sans leading-none"
                        style={{ 
                          backgroundColor: themeSettings.dark_bg, 
                          borderColor: `color-mix(in srgb, ${themeSettings.dark_accent} 25%, transparent)` 
                        }}
                      >
                        <div className="flex justify-between items-center w-full border-b pb-1.5" style={{ borderColor: `color-mix(in srgb, ${themeSettings.dark_accent} 15%, transparent)` }}>
                          <span className="font-black uppercase tracking-wider" style={{ color: themeSettings.dark_text_title }}>FS HUD</span>
                          <div className="flex gap-2">
                            <span style={{ color: themeSettings.dark_interactive_default }}>LINK</span>
                            <span style={{ color: themeSettings.dark_interactive_hover }} className="underline">HOVER</span>
                            <span className="px-1 py-0.5 rounded-[2px]" style={{ backgroundColor: `color-mix(in srgb, ${themeSettings.dark_card} ${themeSettings.dark_card_opacity}%, transparent)`, color: themeSettings.dark_interactive_active, border: `1px solid ${themeSettings.dark_accent}` }}>ACTIVE</span>
                          </div>
                        </div>

                        <div className="flex justify-between items-end w-full flex-1 pt-1.5">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1">
                              <span style={{ color: themeSettings.dark_text_label }}>LABEL:</span>
                              <span className="font-bold font-mono" style={{ color: themeSettings.dark_text_value }}>1,340.50</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded-[2px] text-[7px]" style={{ backgroundColor: `color-mix(in srgb, ${themeSettings.dark_highlight_up} 10%, transparent)`, color: themeSettings.dark_highlight_up }}>BULLISH</span>
                              <span className="px-1.5 py-0.5 rounded-[2px] text-[7px]" style={{ backgroundColor: `color-mix(in srgb, ${themeSettings.dark_highlight_down} 10%, transparent)`, color: themeSettings.dark_highlight_down }}>BEARISH</span>
                            </div>
                          </div>
                          <div className="flex gap-2 items-end h-full pb-0.5">
                            <div className="flex flex-col items-center h-full w-2">
                              <div className="w-0.5 flex-1" style={{ backgroundColor: themeSettings.dark_up_candle }} />
                              <div className="w-2 h-4 rounded-sm" style={{ backgroundColor: themeSettings.dark_up_candle }} />
                              <div className="w-0.5 flex-1" style={{ backgroundColor: themeSettings.dark_up_candle }} />
                            </div>
                            <div className="flex flex-col items-center h-full w-2">
                              <div className="w-0.5 flex-1" style={{ backgroundColor: themeSettings.dark_down_candle }} />
                              <div className="w-2 h-3 rounded-sm" style={{ backgroundColor: themeSettings.dark_down_candle }} />
                              <div className="w-0.5 flex-1" style={{ backgroundColor: themeSettings.dark_down_candle }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-card-border">
                      {/* Section 1: Panels */}
                      <div className="space-y-2.5">
                        <div className="text-[7.5px] uppercase tracking-widest text-[#a855f7] font-black border-b border-card-border pb-1">1. Layout Panels & Presets</div>
                        <ColorPickerItem label="Obsidian Background" value={themeSettings.dark_bg} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_bg: val }))} />
                        <ColorPickerItem label="Card Panel Fill" value={themeSettings.dark_card} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_card: val }))} />
                        <SliderItem label="Card Panel Opacity" value={themeSettings.dark_card_opacity} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_card_opacity: val }))} />
                        <ColorPickerItem label="Accent Neon Glow" value={themeSettings.dark_accent} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_accent: val }))} />
                      </div>

                      {/* Section 2: Interactive */}
                      <div className="space-y-2.5">
                        <div className="text-[7.5px] uppercase tracking-widest text-[#50ffaf] font-black border-b border-card-border pb-1">2. Interactive Controls & Buttons</div>
                        <ColorPickerItem label="Interactive Default" value={themeSettings.dark_interactive_default} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_interactive_default: val }))} />
                        <ColorPickerItem label="Interactive Active" value={themeSettings.dark_interactive_active} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_interactive_active: val }))} />
                        <ColorPickerItem label="Interactive Hover" value={themeSettings.dark_interactive_hover} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_interactive_hover: val }))} />
                      </div>

                      {/* Section 3: Typography */}
                      <div className="space-y-2.5">
                        <div className="text-[7.5px] uppercase tracking-widest text-cyan-400 font-black border-b border-card-border pb-1">3. Workspace Typography</div>
                        <ColorPickerItem label="Title Text" value={themeSettings.dark_text_title} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_text_title: val }))} />
                        <ColorPickerItem label="Label Text" value={themeSettings.dark_text_label} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_text_label: val }))} />
                        <ColorPickerItem label="Value Text" value={themeSettings.dark_text_value} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_text_value: val }))} />
                        <ColorPickerItem label="Bullish Candle & Signal" value={themeSettings.dark_up_candle} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_up_candle: val, dark_highlight_up: val }))} />
                        <ColorPickerItem label="Bearish Candle & Signal" value={themeSettings.dark_down_candle} onChange={(val) => setThemeSettings((s: any) => ({ ...s, dark_down_candle: val, dark_highlight_down: val }))} />
                      </div>
                    </div>
                  </div>

                  {/* Daylight Theme Customizer */}
                  <div className="space-y-4 bg-card/30 border border-card-border p-5 rounded-2xl relative shadow-sm">
                    <div className="flex justify-between items-center border-b border-card-border/60 pb-3">
                      <span className="text-[10px] font-black text-foreground tracking-widest uppercase">Daylight Customizer</span>
                      <button
                        type="button"
                        onClick={() => setThemeSettings((prev: any) => ({
                          ...prev,
                          light_bg: DEFAULT_THEME_SETTINGS.light_bg,
                          light_card: DEFAULT_THEME_SETTINGS.light_card,
                          light_accent: DEFAULT_THEME_SETTINGS.light_accent,
                          light_up_candle: DEFAULT_THEME_SETTINGS.light_up_candle,
                          light_down_candle: DEFAULT_THEME_SETTINGS.light_down_candle,
                          light_card_opacity: DEFAULT_THEME_SETTINGS.light_card_opacity,
                          light_interactive_default: DEFAULT_THEME_SETTINGS.light_interactive_default,
                          light_interactive_active: DEFAULT_THEME_SETTINGS.light_interactive_active,
                          light_interactive_hover: DEFAULT_THEME_SETTINGS.light_interactive_hover,
                          light_text_title: DEFAULT_THEME_SETTINGS.light_text_title,
                          light_text_label: DEFAULT_THEME_SETTINGS.light_text_label,
                          light_text_value: DEFAULT_THEME_SETTINGS.light_text_value,
                          light_highlight_up: DEFAULT_THEME_SETTINGS.light_highlight_up,
                          light_highlight_down: DEFAULT_THEME_SETTINGS.light_highlight_down,
                        }))}
                        className="px-2.5 py-1 bg-card border border-card-border hover:border-rose-500/50 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 text-[8px] font-black uppercase rounded-lg transition-all cursor-pointer shadow-sm"
                      >
                        Reset Defaults
                      </button>
                    </div>

                    {/* Daylight Live Swatch Mockup Box */}
                    <div className="space-y-1 select-none">
                      <span className="text-[8px] text-zinc-500 uppercase tracking-widest block font-bold">Daylight Swatch Preview</span>
                      <div 
                        className="w-full h-24 rounded-xl p-2.5 flex flex-col justify-between border transition-all text-[8px] font-sans leading-none"
                        style={{ 
                          backgroundColor: themeSettings.light_bg, 
                          borderColor: `color-mix(in srgb, ${themeSettings.light_accent} 25%, transparent)` 
                        }}
                      >
                        <div className="flex justify-between items-center w-full border-b pb-1.5" style={{ borderColor: `color-mix(in srgb, ${themeSettings.light_accent} 15%, transparent)` }}>
                          <span className="font-black uppercase tracking-wider" style={{ color: themeSettings.light_text_title }}>FS HUD</span>
                          <div className="flex gap-2">
                            <span style={{ color: themeSettings.light_interactive_default }}>LINK</span>
                            <span style={{ color: themeSettings.light_interactive_hover }} className="underline">HOVER</span>
                            <span className="px-1 py-0.5 rounded-[2px]" style={{ backgroundColor: `color-mix(in srgb, ${themeSettings.light_card} ${themeSettings.light_card_opacity}%, transparent)`, color: themeSettings.light_interactive_active, border: `1px solid ${themeSettings.light_accent}` }}>ACTIVE</span>
                          </div>
                        </div>

                        <div className="flex justify-between items-end w-full flex-1 pt-1.5">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1">
                              <span style={{ color: themeSettings.light_text_label }}>LABEL:</span>
                              <span className="font-bold font-mono" style={{ color: themeSettings.light_text_value }}>1,340.50</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded-[2px] text-[7px]" style={{ backgroundColor: `color-mix(in srgb, ${themeSettings.light_highlight_up} 10%, transparent)`, color: themeSettings.light_highlight_up }}>BULLISH</span>
                              <span className="px-1.5 py-0.5 rounded-[2px] text-[7px]" style={{ backgroundColor: `color-mix(in srgb, ${themeSettings.light_highlight_down} 10%, transparent)`, color: themeSettings.light_highlight_down }}>BEARISH</span>
                            </div>
                          </div>
                          <div className="flex gap-2 items-end h-full pb-0.5">
                            <div className="flex flex-col items-center h-full w-2">
                              <div className="w-0.5 flex-1" style={{ backgroundColor: themeSettings.light_up_candle }} />
                              <div className="w-2 h-4 rounded-sm" style={{ backgroundColor: themeSettings.light_up_candle }} />
                              <div className="w-0.5 flex-1" style={{ backgroundColor: themeSettings.light_up_candle }} />
                            </div>
                            <div className="flex flex-col items-center h-full w-2">
                              <div className="w-0.5 flex-1" style={{ backgroundColor: themeSettings.light_down_candle }} />
                              <div className="w-2 h-3 rounded-sm" style={{ backgroundColor: themeSettings.light_down_candle }} />
                              <div className="w-0.5 flex-1" style={{ backgroundColor: themeSettings.light_down_candle }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-card-border">
                      {/* Section 1: Panels */}
                      <div className="space-y-2.5">
                        <div className="text-[7.5px] uppercase tracking-widest text-[#4f46e5] font-black border-b border-card-border pb-1">1. Layout Panels & Presets</div>
                        <ColorPickerItem label="Daylight Background" value={themeSettings.light_bg} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_bg: val }))} />
                        <ColorPickerItem label="Card Panel Fill" value={themeSettings.light_card} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_card: val }))} />
                        <SliderItem label="Card Panel Opacity" value={themeSettings.light_card_opacity} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_card_opacity: val }))} />
                        <ColorPickerItem label="Accent Primary Glow" value={themeSettings.light_accent} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_accent: val }))} />
                      </div>

                      {/* Section 2: Interactive */}
                      <div className="space-y-2.5">
                        <div className="text-[7.5px] uppercase tracking-widest text-indigo-500 font-black border-b border-card-border pb-1">2. Interactive Controls & Buttons</div>
                        <ColorPickerItem label="Interactive Default" value={themeSettings.light_interactive_default} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_interactive_default: val }))} />
                        <ColorPickerItem label="Interactive Active" value={themeSettings.light_interactive_active} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_interactive_active: val }))} />
                        <ColorPickerItem label="Interactive Hover" value={themeSettings.light_interactive_hover} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_interactive_hover: val }))} />
                      </div>

                      {/* Section 3: Typography */}
                      <div className="space-y-2.5">
                        <div className="text-[7.5px] uppercase tracking-widest text-emerald-600 font-black border-b border-card-border pb-1">3. Workspace Typography</div>
                        <ColorPickerItem label="Title Text" value={themeSettings.light_text_title} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_text_title: val }))} />
                        <ColorPickerItem label="Label Text" value={themeSettings.light_text_label} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_text_label: val }))} />
                        <ColorPickerItem label="Value Text" value={themeSettings.light_text_value} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_text_value: val }))} />
                        <ColorPickerItem label="Bullish Candle & Signal" value={themeSettings.light_up_candle} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_up_candle: val, light_highlight_up: val }))} />
                        <ColorPickerItem label="Bearish Candle & Signal" value={themeSettings.light_down_candle} onChange={(val) => setThemeSettings((s: any) => ({ ...s, light_down_candle: val, light_highlight_down: val }))} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Commit Button */}
                <div className="pt-4 border-t border-card-border flex justify-end">
                  <button
                    onClick={handleSaveAppearance}
                    disabled={saveStatus === "saving"}
                    className={`flex items-center gap-2 px-5 py-2.5 border font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer rounded-lg shadow-sm ${
                      saveStatus === "saving"
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
