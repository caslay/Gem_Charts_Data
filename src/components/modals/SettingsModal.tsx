import React, { useState, useEffect, useCallback } from 'react';
import { X, Volume2, Play, Trash2, Bell, Sparkles, AlertCircle, Cpu, FileText, KeyRound, Shield, Save, Loader2, CheckCircle2, AlertTriangle, Brain, Crosshair, Music } from 'lucide-react';
import { useAlertSounds, AVAILABLE_ALERT_FILES, AlertSound } from '@/hooks/useAlertSounds';
import { useMarketDataContext } from '@/context/MarketDataContext';
import EquationBuilder from './EquationBuilder';

export interface Alert {
  id: string;
  price: number;
  status: 'active' | 'triggered';
  color: string;
  label?: string;
  triggerCondition?: 'TOUCH' | 'CLOSE_ABOVE' | 'CLOSE_BELOW' | 'WICK_PURGE_REJECT';
  timeframe?: '1m' | '5m' | '15m' | '1h' | '4h' | '1D';
  actionChain?: {
    browserNotification: boolean;
    triggerAiAnalysis: boolean;
    soundAlert: boolean;
  };
  soundSelection?: AlertSound;
}

type CommandCenterTab = 'ai_config' | 'strategy' | 'audio';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alert: Alert | null;
  onSave: (updatedAlert: Alert) => void;
  onDelete: (alertId: string) => void;
  initialTab?: 'price' | 'signal' | 'ai_config' | 'strategy' | 'audio';
}

// ─── Available Models (mirrors /settings page) ─────────────────────────────
const AVAILABLE_MODELS = [
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)" },
  { value: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash (Preview)" },
  { value: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro (Preview)" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
] as const;

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  alert,
  onSave,
  onDelete,
  initialTab = 'ai_config',
}) => {
  const { playFile, playSound } = useAlertSounds();
  const {
    signalAlerts,
    updateSignalAlert,
    signalAlertsEnabled,
    toggleSignalAlertEnabled,
    syncStatus
  } = useMarketDataContext();

  // ── Tabs State ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<CommandCenterTab>('ai_config');
  const [showPriceOverlay, setShowPriceOverlay] = useState(false);

  // ── AI Config State ───────────────────────────────────────────────────────
  const [aiModel, setAiModel] = useState("gemini-3.5-flash");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [aiSaveStatus, setAiSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [aiLoading, setAiLoading] = useState(false);

  // ── Price alert local form fields ─────────────────────────────────────────
  const [label, setLabel] = useState('');
  const [triggerCondition, setTriggerCondition] = useState<'TOUCH' | 'CLOSE_ABOVE' | 'CLOSE_BELOW' | 'WICK_PURGE_REJECT'>('TOUCH');
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m' | '1h' | '4h' | '1D'>('5m');
  const [browserNotification, setBrowserNotification] = useState(true);
  const [triggerAiAnalysis, setTriggerAiAnalysis] = useState(false);
  const [soundAlert, setSoundAlert] = useState(true);
  const [soundSelection, setSoundSelection] = useState<any>('Institutional Pulse');

  // ── Tab resolution from initialTab prop ───────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    if (alert) {
      // Price alert editing — show the price overlay
      setShowPriceOverlay(true);
      setLabel(alert.label || `Alert @ ${alert.price.toFixed(2)}`);
      setTriggerCondition(alert.triggerCondition || 'TOUCH');
      setTimeframe(alert.timeframe || '5m');
      setBrowserNotification(alert.actionChain?.browserNotification ?? true);
      setTriggerAiAnalysis(alert.actionChain?.triggerAiAnalysis ?? false);
      setSoundAlert(alert.actionChain?.soundAlert ?? true);
      setSoundSelection(alert.soundSelection || 'Institutional Pulse');
    } else {
      setShowPriceOverlay(false);
      // Map legacy tab names
      if (initialTab === 'signal') {
        setActiveTab('audio');
      } else if (initialTab === 'price') {
        setActiveTab('ai_config');
      } else {
        setActiveTab(initialTab as CommandCenterTab);
      }
    }
  }, [alert, isOpen, initialTab]);

  // ── Fetch AI config on mount ──────────────────────────────────────────────
  const fetchAiConfig = useCallback(async () => {
    try {
      setAiLoading(true);
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        const s = data.settings || {};
        setAiModel(s.ACTIVE_MODEL || "gemini-3.5-flash");
        setSystemPrompt(s.SYSTEM_PROMPT || "");
        setApiKey(s.GEMINI_LIVE_KEY || "");
      }
    } catch (err) {
      console.error('[CommandCenter] Failed to fetch AI config:', err);
    } finally {
      setAiLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && activeTab === 'ai_config') {
      fetchAiConfig();
    }
  }, [isOpen, activeTab, fetchAiConfig]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSaveAiConfig = async () => {
    try {
      setAiSaveStatus('saving');
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            ACTIVE_MODEL: aiModel,
            SYSTEM_PROMPT: systemPrompt,
            GEMINI_LIVE_KEY: apiKey,
          },
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setAiSaveStatus('success');
      setTimeout(() => setAiSaveStatus('idle'), 2000);
    } catch {
      setAiSaveStatus('error');
      setTimeout(() => setAiSaveStatus('idle'), 3000);
    }
  };

  const handleSavePriceAlert = () => {
    if (!alert) return;
    onSave({
      ...alert,
      label,
      triggerCondition,
      timeframe,
      actionChain: {
        browserNotification,
        triggerAiAnalysis,
        soundAlert,
      },
      soundSelection,
    });
  };

  const handleTestAudio = () => {
    playSound(soundSelection);
  };

  const handlePlaySignalSound = (fileName: string) => {
    playFile(fileName);
  };

  const maskKey = (key: string) => {
    if (!key || key.length < 8) return key;
    return key.slice(0, 6) + "•".repeat(Math.min(key.length - 10, 30)) + key.slice(-4);
  };

  const renderSyncIndicator = () => {
    switch (syncStatus) {
      case 'syncing':
        return (
          <div className="flex items-center gap-1.5 text-[9px] text-[#d1bcff] font-bold tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d1bcff] animate-ping" />
            <span>SYNCING TO CLOUD...</span>
          </div>
        );
      case 'saved':
        return (
          <div className="flex items-center gap-1.5 text-[9px] text-[#50ffaf] font-bold tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-[#50ffaf]" />
            <span>CLOUD SYNCED</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-1.5 text-[9px] text-red-400 font-bold tracking-widest">
            <AlertCircle size={10} className="text-red-500 animate-pulse" />
            <span>SYNC ERROR</span>
          </div>
        );
      case 'idle':
      default:
        return (
          <div className="flex items-center gap-1.5 text-[9px] text-[#958da3]">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
            <span>CLOUD AUTOSAVE ACTIVE</span>
          </div>
        );
    }
  };

  if (!isOpen) return null;

  // ── Tab Definitions ───────────────────────────────────────────────────────
  const tabs: { id: CommandCenterTab; icon: React.ReactNode; label: string }[] = [
    { id: 'ai_config', icon: <Brain size={14} />, label: 'AI CONFIG' },
    { id: 'strategy', icon: <Crosshair size={14} />, label: 'STRATEGY' },
    { id: 'audio', icon: <Music size={14} />, label: 'AUDIO' },
  ];

  // If a price alert is active for configuration, render ONLY the Price Alert Config Modal
  if (alert) {
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-[#0e0e0f]/80 backdrop-blur-md z-[200] transition-opacity duration-200"
          onClick={onClose}
        />
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[204] w-full max-w-sm bg-[#0e0e0f]/95 border border-[#4a4457] shadow-[0_0_80px_rgba(0,0,0,0.95)] font-mono text-xs text-[#e5e2e3] select-none rounded-none animate-in fade-in zoom-in-95 duration-150">
          {/* Price Overlay Header */}
          <div className="flex items-center justify-between p-4 border-b border-[#4a4457] bg-[#141416]/95">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-amber-400 rounded-none animate-pulse" />
              <h3 className="text-xs font-bold tracking-[0.15em] uppercase text-white">PRICE ALERT CONFIG</h3>
            </div>
            <button onClick={onClose} className="text-[#958da3] hover:text-white transition-colors p-1 cursor-pointer">
              <X size={14} />
            </button>
          </div>

          {/* Price Alert Form */}
          <div className="p-5 space-y-4 max-h-[50vh] overflow-y-auto scrollbar-thin scrollbar-thumb-[#4a4457] scrollbar-track-transparent">
            {/* Static Price read-out */}
            <div className="flex justify-between items-center bg-[#141416] border border-[#4a4457] px-3.5 py-2.5">
              <span className="text-[10px] text-[#958da3] uppercase font-bold tracking-wider">Level Target</span>
              <span className="text-sm font-bold tracking-tight text-[#50ffaf]">
                {alert.price.toFixed(2)} USDC
              </span>
            </div>

            {/* Label Input */}
            <div className="space-y-1.5">
              <label className="block text-[9px] text-[#958da3] uppercase font-bold tracking-widest">Alert Descriptor</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full bg-[#141416] border border-[#4a4457] focus:border-[#50ffaf] focus:outline-none px-3 py-2 text-xs font-mono text-white rounded-none transition-colors"
                placeholder="e.g. PDH Sweep Trap"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-[9px] text-[#958da3] uppercase font-bold tracking-widest">Condition</label>
                <select
                  value={triggerCondition}
                  onChange={(e: any) => setTriggerCondition(e.target.value)}
                  className="w-full bg-[#141416] border border-[#4a4457] focus:border-[#50ffaf] focus:outline-none px-2.5 py-2 text-xs font-mono text-white rounded-none transition-colors cursor-pointer"
                >
                  <option value="TOUCH">TOUCH</option>
                  <option value="CLOSE_ABOVE">CLOSE_ABOVE</option>
                  <option value="CLOSE_BELOW">CLOSE_BELOW</option>
                  <option value="WICK_PURGE_REJECT">WICK_PURGE_REJECT</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-[9px] text-[#958da3] uppercase font-bold tracking-widest">Timeframe</label>
                <select
                  value={timeframe}
                  onChange={(e: any) => setTimeframe(e.target.value)}
                  className="w-full bg-[#141416] border border-[#4a4457] focus:border-[#50ffaf] focus:outline-none px-2.5 py-2 text-xs font-mono text-white rounded-none transition-colors cursor-pointer"
                >
                  <option value="1m">1m</option>
                  <option value="5m">5m</option>
                  <option value="15m">15m</option>
                  <option value="1h">1h</option>
                  <option value="4h">4h</option>
                  <option value="1D">1D</option>
                </select>
              </div>
            </div>

            {/* Action Chain */}
            <div className="space-y-2">
              <label className="block text-[9px] text-[#958da3] uppercase font-bold tracking-widest">Action Chain</label>
              <div className="space-y-2 bg-[#141416]/50 border border-[#4a4457] p-3">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input type="checkbox" checked={browserNotification} onChange={(e) => setBrowserNotification(e.target.checked)} className="rounded-none bg-[#141416] border border-[#4a4457] w-3.5 h-3.5 cursor-pointer accent-[#50ffaf]" />
                  <div className="flex items-center gap-1.5">
                    <Bell size={11} className="text-[#958da3] group-hover:text-white transition-colors" />
                    <span className="text-[10px] text-[#958da3] group-hover:text-white transition-colors">Browser Notification</span>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input type="checkbox" checked={triggerAiAnalysis} onChange={(e) => setTriggerAiAnalysis(e.target.checked)} className="rounded-none bg-[#141416] border border-[#4a4457] w-3.5 h-3.5 cursor-pointer accent-[#50ffaf]" />
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={11} className="text-[#958da3] group-hover:text-white transition-colors" />
                    <span className="text-[10px] text-[#958da3] group-hover:text-white transition-colors">Trigger AI Analysis</span>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input type="checkbox" checked={soundAlert} onChange={(e) => setSoundAlert(e.target.checked)} className="rounded-none bg-[#141416] border border-[#4a4457] w-3.5 h-3.5 cursor-pointer accent-[#50ffaf]" />
                  <div className="flex items-center gap-1.5">
                    <Volume2 size={11} className="text-[#958da3] group-hover:text-white transition-colors" />
                    <span className="text-[10px] text-[#958da3] group-hover:text-white transition-colors">Sound Alert</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Sound */}
            <div className="space-y-1.5">
              <label className="block text-[9px] text-[#958da3] uppercase font-bold tracking-widest">Audio Profile</label>
              <div className="flex gap-2">
                <select value={soundSelection} disabled={!soundAlert} onChange={(e: any) => setSoundSelection(e.target.value)} className="flex-1 bg-[#141416] border border-[#4a4457] focus:border-[#50ffaf] focus:outline-none px-2.5 py-2 text-xs font-mono text-white rounded-none transition-colors disabled:opacity-40 cursor-pointer">
                  <option value="Institutional Pulse">Institutional Pulse (Sine)</option>
                  <option value="Mechanical Click">Mechanical Click (Tri/Noise)</option>
                  <option value="Target Chime">Target Chime (Harmonic)</option>
                </select>
                <button type="button" disabled={!soundAlert} onClick={handleTestAudio} className="flex items-center gap-1 px-3 py-2 bg-[#141416] border border-[#4a4457] hover:bg-zinc-800 disabled:opacity-40 transition-all text-[10px] font-bold uppercase text-[#958da3] rounded-none cursor-pointer">
                  <Play size={10} fill="currentColor" />
                  <span>Test</span>
                </button>
              </div>
            </div>
          </div>

          {/* Price Overlay Footer */}
          <div className="flex justify-between items-center p-4 border-t border-[#4a4457] bg-[#141416]/95">
            <button type="button" onClick={() => onDelete(alert.id)} className="flex items-center gap-1 px-2.5 py-1.5 border border-red-500/30 hover:border-red-500 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 font-bold transition-all uppercase text-[10px] rounded-none cursor-pointer">
              <Trash2 size={12} />
              <span>Delete</span>
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 border border-[#4a4457] hover:bg-white/5 text-[#958da3] hover:text-white font-bold transition-all uppercase text-[10px] rounded-none cursor-pointer">
                Cancel
              </button>
              <button type="button" onClick={handleSavePriceAlert} className="px-4 py-1.5 bg-[#50ffaf] border border-[#50ffaf] hover:bg-[#40dd96] text-black font-bold transition-all uppercase text-[10px] rounded-none cursor-pointer">
                Save Config
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // If no price alert is selected, render the standard global Command Center Modal
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#0e0e0f]/80 backdrop-blur-md z-[200] transition-opacity duration-200"
        onClick={onClose}
      />

      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-full max-w-5xl bg-[#0e0e0f]/90 border border-[#4a4457] shadow-[0_0_80px_rgba(0,0,0,0.95)] font-mono text-xs text-[#e5e2e3] select-none rounded-none animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4a4457] bg-[#141416]/95 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-[#50ffaf] rounded-none animate-pulse" />
            <h3 className="text-xs font-bold tracking-[0.15em] uppercase text-white">COMMAND CENTER</h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#958da3] hover:text-white transition-colors p-1 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Main content area: vertical tabs + panel */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── Vertical Tabs Sidebar ──────────────────────────────────── */}
          <div className="w-[140px] shrink-0 bg-[#141416]/50 border-r border-[#4a4457] flex flex-col py-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2.5 px-4 py-3 text-[9px] font-bold uppercase tracking-widest transition-all cursor-pointer border-l-2 ${activeTab === tab.id
                  ? 'bg-[#50ffaf]/10 text-[#50ffaf] border-l-[#50ffaf]'
                  : 'text-[#958da3] hover:text-white hover:bg-white/3 border-l-transparent'
                  }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* ── Tab Content Panel ──────────────────────────────────────── */}
          <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin scrollbar-thumb-[#4a4457] scrollbar-track-transparent">

            {/* TAB 1: AI CONFIG ────────────────────────────────────────── */}
            {activeTab === 'ai_config' && (
              <div className="p-5 space-y-5">
                {aiLoading ? (
                  <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-5 h-5 text-[#d1bcff] animate-spin" />
                    <span className="ml-2 text-[10px] text-[#958da3] font-mono uppercase tracking-widest">Loading Config...</span>
                  </div>
                ) : (
                  <>
                    {/* Model Selector */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Cpu size={12} className="text-cyan-400" />
                        <label className="text-[9px] text-[#958da3] uppercase font-bold tracking-widest">Active AI Model</label>
                      </div>
                      <select
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        className="w-full bg-[#141416] border border-[#4a4457] focus:border-[#d1bcff] focus:outline-none px-3 py-2.5 text-xs font-mono text-white rounded-none transition-colors cursor-pointer"
                      >
                        {AVAILABLE_MODELS.map((model) => (
                          <option key={model.value} value={model.value}>{model.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* System Prompt */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <FileText size={12} className="text-amber-400" />
                        <label className="text-[9px] text-[#958da3] uppercase font-bold tracking-widest">System Prompt</label>
                      </div>
                      <textarea
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        rows={10}
                        placeholder="Enter the institutional system prompt for the Quant AI Engine..."
                        className="w-full bg-[#141416] border border-[#4a4457] focus:border-[#d1bcff] focus:outline-none px-3 py-2.5 text-xs font-mono text-white rounded-none transition-colors resize-y leading-relaxed placeholder:text-[#4a4457]"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-[#958da3] font-mono">{systemPrompt.length.toLocaleString()} CHARS</span>
                        <span className="text-[9px] text-[#4a4457] font-mono">MARKDOWN SUPPORTED</span>
                      </div>
                    </div>

                    {/* API Key */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <KeyRound size={12} className="text-emerald-400" />
                        <label className="text-[9px] text-[#958da3] uppercase font-bold tracking-widest">Gemini API Key</label>
                      </div>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full bg-[#141416] border border-[#4a4457] focus:border-[#50ffaf] focus:outline-none px-3 py-2.5 text-xs font-mono text-white rounded-none transition-colors placeholder:text-[#4a4457]"
                      />
                      {apiKey && (
                        <div className="flex items-center gap-1.5">
                          <Shield size={10} className="text-[#50ffaf]" />
                          <span className="text-[9px] text-[#958da3] font-mono">PREVIEW: {maskKey(apiKey)}</span>
                        </div>
                      )}
                    </div>

                    {/* Save Button */}
                    <button
                      onClick={handleSaveAiConfig}
                      disabled={aiSaveStatus === 'saving'}
                      className={`flex items-center gap-2 px-4 py-2.5 font-bold text-[10px] uppercase tracking-widest transition-all cursor-pointer rounded-none ${aiSaveStatus === 'saving'
                        ? 'bg-[#d1bcff]/10 text-[#d1bcff]/50 cursor-wait border border-[#d1bcff]/20'
                        : aiSaveStatus === 'success'
                          ? 'bg-[#50ffaf]/15 text-[#50ffaf] border border-[#50ffaf]/30'
                          : aiSaveStatus === 'error'
                            ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                            : 'bg-[#d1bcff]/10 text-[#d1bcff] border border-[#d1bcff]/30 hover:bg-[#d1bcff]/20'
                        }`}
                    >
                      {aiSaveStatus === 'saving' ? (
                        <><Loader2 size={12} className="animate-spin" /> COMMITTING...</>
                      ) : aiSaveStatus === 'success' ? (
                        <><CheckCircle2 size={12} /> DEPLOYED</>
                      ) : aiSaveStatus === 'error' ? (
                        <><AlertTriangle size={12} /> FAILED</>
                      ) : (
                        <><Save size={12} /> DEPLOY CONFIG</>
                      )}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* TAB 2: STRATEGY ARCHITECT ────────────────────────────────── */}
            {activeTab === 'strategy' && (
              <EquationBuilder />
            )}

            {/* TAB 3: AUDIO VAULT ──────────────────────────────────────── */}
            {activeTab === 'audio' && (
              <div className="p-5 space-y-4">
                <div className="bg-[#141416]/50 border border-[#4a4457] p-3 text-[10px] text-[#958da3] uppercase tracking-wide leading-relaxed">
                  Configure dedicated audio mappings for critical quantitative engine events. Audio files are loaded from the <span className="text-[#50ffaf]">/public/audio/</span> directory.
                </div>

                {[
                  { key: 'FVG_DETECTION', label: 'FVG Detection', desc: 'Fires when a new Fair Value Gap forms' },
                  { key: 'DISPLACEMENT_CONFIRMED', label: 'Displacement', desc: 'Fires when institutional sponsorship acts' },
                  { key: 'SMT_TRAP_ACTIVE', label: 'SMT Trap Active', desc: 'Fires when Equal Highs/Lows are engineered' },
                  { key: 'DOL_EXHAUSTED', label: 'DOL Exhausted', desc: 'Fires when Daily Objective targets are hit' },
                  { key: 'SESSION_TRANSITION', label: 'Session Transition', desc: 'Fires when trading shifts into a new session window' },
                  { key: 'PRICING_SHIFT', label: 'Pricing Crossover', desc: 'Fires when price moves between premium/discount' },
                  { key: 'SWEEP_ALERT', label: 'Liquidity Sweep Alert', desc: 'Fires when Asian or London highs/lows are swept' },
                  { key: 'FLOW_STATE_CHANGE', label: 'Flow State Trend Shift', desc: 'Fires when the open interest trend shifts' },
                  { key: 'DEAD_ZONE_ENTER', label: 'Dead Zone Crossing', desc: 'Fires when entering the temporal dead zone' },
                ].map((ev) => {
                  const currentVal = signalAlerts ? (signalAlerts as any)[ev.key] : '';
                  const isEnabled = signalAlertsEnabled ? (signalAlertsEnabled as any)[ev.key] !== false : true;

                  return (
                    <div key={ev.key} className="space-y-1.5 border-b border-[#4a4457]/30 pb-3 last:border-0 last:pb-0">
                      <div className="flex justify-between items-baseline">
                        <label className="flex items-center gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={() => toggleSignalAlertEnabled && toggleSignalAlertEnabled(ev.key as any)}
                            className="rounded-none bg-[#141416] border border-[#4a4457] text-[#50ffaf] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer accent-[#50ffaf]"
                          />
                          <span className="text-[10px] font-black uppercase text-white tracking-widest group-hover:text-[#50ffaf] transition-colors">
                            {ev.label}
                          </span>
                        </label>
                        <span className="text-[8px] text-[#958da3] font-bold uppercase">
                          {ev.key}
                        </span>
                      </div>
                      <span className="block text-[9px] text-[#958da3] italic -mt-1 mb-1 leading-none pl-5">
                        {ev.desc}
                      </span>
                      <div className="flex gap-2 pl-5">
                        <select
                          value={currentVal}
                          disabled={!isEnabled}
                          onChange={(e) => updateSignalAlert(ev.key as any, e.target.value)}
                          className="flex-1 bg-[#141416] border border-[#4a4457] focus:border-[#50ffaf] focus:outline-none px-2.5 py-2 text-xs font-mono text-white rounded-none transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {AVAILABLE_ALERT_FILES.map((file) => (
                            <option key={file} value={file}>
                              {file}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handlePlaySignalSound(currentVal)}
                          disabled={!currentVal || !isEnabled}
                          className="flex items-center justify-center gap-1 px-3 py-2 bg-[#141416] border border-[#4a4457] hover:bg-zinc-800 transition-all text-[10px] font-bold uppercase text-[#958da3] hover:text-[#e5e2e3] rounded-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Preview audio output"
                        >
                          <Play size={10} fill="currentColor" />
                          <span>Play</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-4 border-t border-[#4a4457] bg-[#141416]/95 shrink-0">
          {renderSyncIndicator()}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 border border-[#4a4457] hover:bg-white/5 text-[#958da3] hover:text-white font-bold transition-all uppercase text-[10px] rounded-none cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
};

export default SettingsModal;
