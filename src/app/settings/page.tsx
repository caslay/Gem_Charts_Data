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
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface SettingsState {
  ACTIVE_MODEL: string;
  SYSTEM_PROMPT: string;
  GEMINI_LIVE_KEY: string;
}

type SaveStatus = "idle" | "saving" | "success" | "error";

// ─── Available Models ─────────────────────────────────────────────────────────
const AVAILABLE_MODELS = [
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)" },
  { value: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash (Preview)" },
  { value: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro (Preview)" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [settings, setSettings] = useState<SettingsState>({
    ACTIVE_MODEL: "gemini-3.5-flash",
    SYSTEM_PROMPT: "",
    GEMINI_LIVE_KEY: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // ── Auth Guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/settings");
    }
  }, [status, router]);

  // ── Fetch existing settings on mount ──────────────────────────────────────
  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");

      const data = await res.json();
      const s = data.settings || {};

      setSettings({
        ACTIVE_MODEL: s.ACTIVE_MODEL || "gemini-3.5-flash",
        SYSTEM_PROMPT: s.SYSTEM_PROMPT || "",
        GEMINI_LIVE_KEY: s.GEMINI_LIVE_KEY || "",
      });
    } catch (err) {
      console.error("[SETTINGS] Fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetchSettings();
    }
  }, [status, fetchSettings]);

  // ── Save handler ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    try {
      setSaveStatus("saving");
      setErrorMessage("");

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Save failed");
      }

      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err: unknown) {
      setSaveStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Unknown error occurred"
      );
      setTimeout(() => setSaveStatus("idle"), 5000);
    }
  };

  // ── Loading / Auth states ─────────────────────────────────────────────────
  if (status === "loading" || isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#50ffaf]/30 border-t-[#50ffaf] rounded-full animate-spin" />
          <span className="text-sm text-[#958da3] font-mono">
            LOADING COMMAND CENTER...
          </span>
        </div>
      </div>
    );
  }

  if (!session) return null;

  // ── Mask API key for display ──────────────────────────────────────────────
  const maskKey = (key: string) => {
    if (!key || key.length < 8) return key;
    return key.slice(0, 6) + "•".repeat(Math.min(key.length - 10, 30)) + key.slice(-4);
  };

  return (
    <div className="min-h-screen bg-black">
      {/* Ambient background glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-[#d1bcff]/3 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/3 right-1/4 w-[300px] h-[300px] bg-[#50ffaf]/3 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 py-10">
        {/* ── Page Header ────────────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-[#d1bcff]/10 border border-[#d1bcff]/20 rounded-xl">
              <Settings className="w-5 h-5 text-[#d1bcff]" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[#e5e2e3] tracking-tight">
                Command Center
              </h1>
              <p className="text-xs text-[#958da3] font-mono">
                SYSTEM CONFIGURATION · AI ENGINE PARAMETERS
              </p>
            </div>
          </div>

          {/* Session info badge */}
          <div className="mt-4 flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-[#50ffaf]" />
            <span className="text-[10px] font-mono text-[#958da3]">
              AUTHENTICATED AS{" "}
              <span className="text-[#50ffaf]">{session.user?.email}</span>
            </span>
          </div>
        </div>

        {/* ── Settings Form ──────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Card: AI Model Selection */}
          <div className="bg-[#1c1b1c] border border-[#4a4457]/50 rounded-2xl p-6 shadow-xl shadow-black/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
                <Cpu className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[#e5e2e3]">
                  Active AI Model
                </h2>
                <p className="text-[10px] text-[#958da3] font-mono">
                  GEMINI MODEL USED BY THE QUANT ENGINE
                </p>
              </div>
            </div>
            <select
              id="settings-model-select"
              value={settings.ACTIVE_MODEL}
              onChange={(e) =>
                setSettings((s) => ({ ...s, ACTIVE_MODEL: e.target.value }))
              }
              className="w-full bg-[#0e0e0f] border border-[#4a4457]/50 rounded-xl px-4 py-3 text-sm text-[#e5e2e3] font-mono focus:outline-none focus:border-[#d1bcff]/50 focus:ring-1 focus:ring-[#d1bcff]/20 transition-all appearance-none cursor-pointer"
            >
              {AVAILABLE_MODELS.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>

          {/* Card: System Prompt */}
          <div className="bg-[#1c1b1c] border border-[#4a4457]/50 rounded-2xl p-6 shadow-xl shadow-black/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <FileText className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[#e5e2e3]">
                  System Prompt
                </h2>
                <p className="text-[10px] text-[#958da3] font-mono">
                  QUANT ENGINE INSTRUCTION SET · INJECTED AT RUNTIME
                </p>
              </div>
            </div>
            <textarea
              id="settings-system-prompt"
              value={settings.SYSTEM_PROMPT}
              onChange={(e) =>
                setSettings((s) => ({ ...s, SYSTEM_PROMPT: e.target.value }))
              }
              rows={16}
              placeholder="Enter the institutional system prompt for the Quant AI Engine..."
              className="w-full bg-[#0e0e0f] border border-[#4a4457]/50 rounded-xl px-4 py-3 text-sm text-[#e5e2e3] font-mono leading-relaxed resize-y focus:outline-none focus:border-[#d1bcff]/50 focus:ring-1 focus:ring-[#d1bcff]/20 transition-all placeholder:text-[#4a4457]"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-[#958da3] font-mono">
                {settings.SYSTEM_PROMPT.length.toLocaleString()} CHARACTERS
              </span>
              <span className="text-[10px] text-[#4a4457] font-mono">
                MARKDOWN SUPPORTED
              </span>
            </div>
          </div>

          {/* Card: Gemini API Key */}
          <div className="bg-[#1c1b1c] border border-[#4a4457]/50 rounded-2xl p-6 shadow-xl shadow-black/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <KeyRound className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[#e5e2e3]">
                  Gemini API Key
                </h2>
                <p className="text-[10px] text-[#958da3] font-mono">
                  VAULT-SECURED · STORED IN VERCEL POSTGRES
                </p>
              </div>
            </div>
            <input
              id="settings-api-key"
              type="password"
              value={settings.GEMINI_LIVE_KEY}
              onChange={(e) =>
                setSettings((s) => ({ ...s, GEMINI_LIVE_KEY: e.target.value }))
              }
              placeholder="AIzaSy..."
              className="w-full bg-[#0e0e0f] border border-[#4a4457]/50 rounded-xl px-4 py-3 text-sm text-[#e5e2e3] font-mono focus:outline-none focus:border-[#50ffaf]/50 focus:ring-1 focus:ring-[#50ffaf]/20 transition-all placeholder:text-[#4a4457]"
            />
            {settings.GEMINI_LIVE_KEY && (
              <div className="mt-2 flex items-center gap-2">
                <Shield className="w-3 h-3 text-[#50ffaf]" />
                <span className="text-[10px] text-[#958da3] font-mono">
                  PREVIEW: {maskKey(settings.GEMINI_LIVE_KEY)}
                </span>
              </div>
            )}
          </div>

          {/* ── Save Button ──────────────────────────────────────────────── */}
          <div className="flex items-center gap-4">
            <button
              id="settings-save-btn"
              onClick={handleSave}
              disabled={saveStatus === "saving"}
              className={`flex items-center gap-2.5 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 cursor-pointer
                ${saveStatus === "saving"
                  ? "bg-[#d1bcff]/20 text-[#d1bcff]/50 cursor-wait"
                  : saveStatus === "success"
                    ? "bg-[#50ffaf]/20 text-[#50ffaf] border border-[#50ffaf]/30"
                    : saveStatus === "error"
                      ? "bg-[#ffb4ab]/20 text-[#ffb4ab] border border-[#ffb4ab]/30"
                      : "bg-[#d1bcff]/15 text-[#d1bcff] border border-[#d1bcff]/30 hover:bg-[#d1bcff]/25 hover:border-[#d1bcff]/50 active:scale-[0.98]"
                }`}
            >
              {saveStatus === "saving" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  COMMITTING...
                </>
              ) : saveStatus === "success" ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  SETTINGS DEPLOYED
                </>
              ) : saveStatus === "error" ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  DEPLOYMENT FAILED
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  DEPLOY SETTINGS
                </>
              )}
            </button>

            {saveStatus === "error" && errorMessage && (
              <span className="text-xs text-[#ffb4ab] font-mono">
                {errorMessage}
              </span>
            )}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="mt-12 pt-6 border-t border-[#4a4457]/30">
          <p className="text-[10px] text-[#4a4457] font-mono text-center">
            FLOW-STATE COMMAND CENTER · CHANGES TAKE EFFECT ON NEXT QUANT
            ENGINE INVOCATION
          </p>
        </div>
      </div>
    </div>
  );
}
