"use client";

import React, { useState, useEffect } from "react";
import { Settings, Save, Loader2, CheckCircle2, AlertTriangle, HelpCircle } from "lucide-react";

interface SettingsPanelProps {
  account: {
    current_balance: string | number;
    initial_capital: string | number;
    max_risk_limit_pct: string | number;
  };
  onSave: (updatedAccount: any) => void;
}

export function SettingsPanel({ account, onSave }: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialCapital, setInitialCapital] = useState("");
  const [maxRiskLimitPct, setMaxRiskLimitPct] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Sync inputs with account state on load / update
  useEffect(() => {
    if (account) {
      setInitialCapital(parseFloat(String(account.initial_capital)).toFixed(2));
      setMaxRiskLimitPct(parseFloat(String(account.max_risk_limit_pct)).toFixed(2));
    }
  }, [account]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus("saving");
    setErrorMessage("");

    const capital = parseFloat(initialCapital);
    const riskLimit = parseFloat(maxRiskLimitPct);

    // Validate inputs
    if (isNaN(capital) || capital <= 0) {
      setSaveStatus("error");
      setErrorMessage("Initial Capital must be a positive number.");
      return;
    }

    if (isNaN(riskLimit) || riskLimit <= 0 || riskLimit > 100) {
      setSaveStatus("error");
      setErrorMessage("Max Risk Limit must be a percentage between 0% and 100%.");
      return;
    }

    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initial_capital: capital,
          max_risk_limit_pct: riskLimit,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        onSave(json.account);
        setSaveStatus("success");
        setTimeout(() => setSaveStatus("idle"), 2500);
      } else {
        const json = await res.json();
        setSaveStatus("error");
        setErrorMessage(json.error || "Failed to update trading account configurations.");
      }
    } catch (err) {
      console.error("[SETTINGS PANEL] Request failed:", err);
      setSaveStatus("error");
      setErrorMessage("Network error. Could not connect to API server.");
    }
  };

  return (
    <div className="w-full glass-panel overflow-hidden font-sans text-xs text-foreground transition-all duration-300">
      {/* Trigger Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-card/10 hover:bg-card/25 border-b border-card-border/50 transition-all text-left uppercase font-bold text-muted hover:text-title cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Settings className={`w-3.5 h-3.5 text-accent ${isOpen ? "animate-spin" : ""}`} />
          <span className="text-[10px] font-bold tracking-widest">[ ⚙️ RISK ENGINE CONFIGURATIONS ]</span>
        </div>
        <span className="text-[9px] text-muted font-bold">
          {isOpen ? "[ DECOLLAPSE - ]" : "[ EXPAND PANEL + ]"}
        </span>
      </button>

      {/* Expandable Form Content */}
      {isOpen && (
        <form onSubmit={handleSave} className="p-5 space-y-4 animate-fade-in border-t border-card-border/30 bg-card/5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Initial Capital Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[9px] text-muted uppercase font-bold tracking-wider flex items-center gap-1.5">
                  Initial Capital Seed (USD)
                </label>
                <div className="group relative">
                  <HelpCircle className="w-3 h-3 text-muted hover:text-title cursor-help" />
                  <span className="absolute bottom-6 right-0 w-48 bg-background border border-card-border text-[8px] text-muted p-2 shadow-2xl invisible group-hover:visible z-30 leading-relaxed font-normal normal-case rounded-lg">
                    Sets the historical baseline capital. Adjusting this will instantly recalculate your dynamic balance.
                  </span>
                </div>
              </div>
              <input
                type="number"
                step="0.01"
                min="1"
                value={initialCapital}
                onChange={(e) => setInitialCapital(e.target.value)}
                className="w-full bg-background border border-card-border/60 focus:border-accent focus:outline-none px-3.5 py-2 text-xs font-mono text-title transition-all rounded-lg"
                placeholder="10000.00"
                required
              />
            </div>

            {/* Max Risk Limit Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[9px] text-muted uppercase font-bold tracking-wider flex items-center gap-1.5">
                  Max Risk Limit (Percentage)
                </label>
                <div className="group relative">
                  <HelpCircle className="w-3 h-3 text-muted hover:text-title cursor-help" />
                  <span className="absolute bottom-6 right-0 w-48 bg-background border border-card-border text-[8px] text-muted p-2 shadow-2xl invisible group-hover:visible z-30 leading-relaxed font-normal normal-case rounded-lg">
                    Enforces a portfolio-wide veto gate. Total open risk across deals cannot exceed this percentage.
                  </span>
                </div>
              </div>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="100"
                  value={maxRiskLimitPct}
                  onChange={(e) => setMaxRiskLimitPct(e.target.value)}
                  className="w-full bg-background border border-card-border/60 focus:border-accent focus:outline-none pl-3.5 pr-8 py-2 text-xs font-mono text-title transition-all rounded-lg"
                  placeholder="3.00"
                  required
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted text-[10px] font-bold">%</span>
              </div>
            </div>
          </div>

          {/* Feedback Errors */}
          {errorMessage && (
            <div className="flex items-center gap-2 bg-rose-500/5 border border-rose-500/20 px-3.5 py-2.5 text-[9px] uppercase tracking-wide text-rose-500 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Controls */}
          <div className="flex justify-between items-center pt-2 border-t border-card-border/20">
            <span className="text-[8px] text-muted font-bold uppercase tracking-wider">
              Secure Cloud Configurations Enabled
            </span>
            <button
              type="submit"
              disabled={saveStatus === "saving"}
              className={`flex items-center gap-2 px-4 py-2 border font-bold text-[9px] uppercase tracking-wider transition-all cursor-pointer rounded-lg ${
                saveStatus === "saving"
                  ? "bg-accent/5 border-accent/20 text-accent/40 cursor-wait"
                  : saveStatus === "success"
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-500"
                  : saveStatus === "error"
                  ? "bg-rose-500/10 border-rose-500/40 text-rose-500"
                  : "bg-card border-card-border hover:border-accent text-muted hover:text-accent shadow-md"
              }`}
            >
              {saveStatus === "saving" ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Committing...</span>
                </>
              ) : saveStatus === "success" ? (
                <>
                  <HelpCircle className="w-3 h-3 text-emerald-500" />
                  <span>Config Saved</span>
                </>
              ) : saveStatus === "error" ? (
                <>
                  <AlertTriangle className="w-3 h-3 text-rose-500" />
                  <span>Save Failed</span>
                </>
              ) : (
                <>
                  <Save className="w-3 h-3" />
                  <span>Save Settings</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
