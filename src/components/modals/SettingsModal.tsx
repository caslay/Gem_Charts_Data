import React, { useState, useEffect } from 'react';
import { X, Volume2, Play, Trash2, Bell, Sparkles, AlertCircle, Music, Crosshair } from 'lucide-react';
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

type CommandCenterTab = 'strategy' | 'audio' | 'engine';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alert: Alert | null;
  onSave: (updatedAlert: Alert) => void;
  onDelete: (alertId: string) => void;
  initialTab?: 'price' | 'signal' | 'ai_config' | 'strategy' | 'audio';
}

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
    syncStatus,
    engineSettings,
    updateEngineSettings
  } = useMarketDataContext();

  // ── Tabs State ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<CommandCenterTab>('strategy');
  const [showPriceOverlay, setShowPriceOverlay] = useState(false);

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
      } else if (initialTab === 'price' || initialTab === 'ai_config') {
        setActiveTab('strategy');
      } else {
        setActiveTab((initialTab as CommandCenterTab) || 'strategy');
      }
    }
  }, [alert, isOpen, initialTab]);

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

  const renderSyncIndicator = () => {
    switch (syncStatus) {
      case 'syncing':
        return (
          <div className="flex items-center gap-1.5 text-[9px] text-[#d1bcff] font-bold tracking-widest font-sans uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d1bcff] animate-ping" />
            <span>Syncing to Cloud...</span>
          </div>
        );
      case 'saved':
        return (
          <div className="flex items-center gap-1.5 text-[9px] text-[#50ffaf] font-bold tracking-widest font-sans uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-[#50ffaf]" />
            <span>Cloud Synced</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-1.5 text-[9px] text-rose-500 font-bold tracking-widest font-sans uppercase">
            <AlertCircle size={10} className="text-rose-500 animate-pulse" />
            <span>Sync Error</span>
          </div>
        );
      case 'idle':
      default:
        return (
          <div className="flex items-center gap-1.5 text-[9px] text-slate-500 dark:text-zinc-500 font-black font-sans uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
            <span>Cloud Autosave Active</span>
          </div>
        );
    }
  };

  if (!isOpen) return null;

  // ── Tab Definitions ───────────────────────────────────────────────────────
  const tabs: { id: CommandCenterTab; icon: React.ReactNode; label: string }[] = [
    { id: 'strategy', icon: <Crosshair size={14} />, label: 'STRATEGY' },
    { id: 'audio', icon: <Music size={14} />, label: 'AUDIO' },
    { id: 'engine', icon: <Sparkles size={14} />, label: 'ENGINE CORE' },
  ];

  // If a price alert is active for configuration, render ONLY the Price Alert Config Modal
  if (alert) {
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-md z-[200] transition-opacity duration-200"
          onClick={onClose}
        />
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[204] w-full max-w-sm bg-card/95 backdrop-blur-xl border border-card-border shadow-[0_10px_50px_rgba(0,0,0,0.3)] font-sans text-xs text-foreground select-none rounded-2xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
          {/* Price Overlay Header */}
          <div className="flex items-center justify-between p-4.5 border-b border-card-border bg-card/50">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-accent rounded-sm animate-pulse" />
              <h3 className="text-xs font-bold tracking-widest uppercase text-foreground">PRICE ALERT CONFIG</h3>
            </div>
            <button onClick={onClose} className="text-muted hover:text-foreground transition-colors p-1.5 cursor-pointer rounded-lg hover:bg-card/50">
              <X size={14} />
            </button>
          </div>

          {/* Price Alert Form */}
          <div className="p-5 space-y-4 max-h-[50vh] overflow-y-auto scrollbar-thin scrollbar-thumb-card-border scrollbar-track-transparent">
            {/* Static Price read-out */}
            <div className="flex justify-between items-center glass-panel bg-card/45 border border-card-border/80 px-4 py-3 rounded-xl shadow-sm">
              <span className="text-[10px] text-muted uppercase font-bold tracking-wider">Level Target</span>
              <span className="text-sm font-black tracking-tight text-emerald-600 dark:text-[#50ffaf] font-mono">
                {alert.price.toFixed(2)} USDC
              </span>
            </div>

            {/* Descriptor Input */}
            <div className="space-y-1.5">
              <label className="block text-[9px] text-muted uppercase font-bold tracking-widest">Alert Descriptor</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full bg-background/60 backdrop-blur-md border border-card-border/80 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3.5 py-2.5 text-xs text-foreground rounded-lg transition-all shadow-sm"
                placeholder="e.g. PDH Sweep Trap"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-[9px] text-muted uppercase font-bold tracking-widest">Condition</label>
                <select
                  value={triggerCondition}
                  onChange={(e: any) => setTriggerCondition(e.target.value)}
                  className="w-full bg-background/60 backdrop-blur-md border border-card-border/80 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3 py-2.5 text-xs text-foreground rounded-lg transition-all cursor-pointer shadow-sm"
                >
                  <option value="TOUCH">TOUCH</option>
                  <option value="CLOSE_ABOVE">CLOSE_ABOVE</option>
                  <option value="CLOSE_BELOW">CLOSE_BELOW</option>
                  <option value="WICK_PURGE_REJECT">WICK_PURGE_REJECT</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-[9px] text-muted uppercase font-bold tracking-widest">Timeframe</label>
                <select
                  value={timeframe}
                  onChange={(e: any) => setTimeframe(e.target.value)}
                  className="w-full bg-background/60 backdrop-blur-md border border-card-border/80 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3 py-2.5 text-xs text-foreground rounded-lg transition-all cursor-pointer shadow-sm"
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
              <label className="block text-[9px] text-muted uppercase font-bold tracking-widest">Action Chain</label>
              <div className="space-y-2.5 glass-panel bg-card/40 border border-card-border/80 p-3.5 rounded-xl">
                <label className="flex items-center gap-3 cursor-pointer group hover:bg-accent/10 p-2 rounded-lg transition-all select-none">
                  <input type="checkbox" checked={browserNotification} onChange={(e) => setBrowserNotification(e.target.checked)} className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all" />
                  <div className="flex items-center gap-2">
                    <Bell size={13} className="text-muted group-hover:text-foreground transition-colors" />
                    <span className="text-xs text-foreground font-semibold group-hover:text-foreground transition-colors">Browser Notification</span>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group hover:bg-accent/10 p-2 rounded-lg transition-all select-none">
                  <input type="checkbox" checked={triggerAiAnalysis} onChange={(e) => setTriggerAiAnalysis(e.target.checked)} className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all" />
                  <div className="flex items-center gap-2">
                    <Sparkles size={13} className="text-muted group-hover:text-foreground transition-colors" />
                    <span className="text-xs text-foreground font-semibold group-hover:text-foreground transition-colors">Trigger AI Analysis</span>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group hover:bg-accent/10 p-2 rounded-lg transition-all select-none">
                  <input type="checkbox" checked={soundAlert} onChange={(e) => setSoundAlert(e.target.checked)} className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all" />
                  <div className="flex items-center gap-2">
                    <Volume2 size={13} className="text-muted group-hover:text-foreground transition-colors" />
                    <span className="text-xs text-foreground font-semibold group-hover:text-foreground transition-colors">Sound Alert</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Sound */}
            <div className="space-y-1.5">
              <label className="block text-[9px] text-muted uppercase font-bold tracking-widest">Audio Profile</label>
              <div className="flex gap-2">
                <select value={soundSelection} disabled={!soundAlert} onChange={(e: any) => setSoundSelection(e.target.value)} className="flex-1 bg-background/60 backdrop-blur-md border border-card-border/80 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3 py-2.5 text-xs text-foreground rounded-lg transition-all disabled:opacity-40 cursor-pointer shadow-sm">
                  <option value="Institutional Pulse">Institutional Pulse (Sine)</option>
                  <option value="Mechanical Click">Mechanical Click (Tri/Noise)</option>
                  <option value="Target Chime">Target Chime (Harmonic)</option>
                </select>
                <button type="button" disabled={!soundAlert} onClick={handleTestAudio} className="flex items-center gap-1.5 px-3 py-2.5 bg-card/60 border border-card-border/80 hover:bg-accent/10 hover:text-accent disabled:opacity-40 transition-all text-[10px] font-bold uppercase text-muted hover:text-foreground rounded-lg cursor-pointer shadow-sm shadow-black/5">
                  <Play size={10} fill="currentColor" />
                  <span>Test</span>
                </button>
              </div>
            </div>
          </div>

          {/* Price Overlay Footer */}
          <div className="flex justify-between items-center p-4 border-t border-card-border bg-card/50 rounded-b-2xl">
            <button type="button" onClick={() => onDelete(alert.id)} className="flex items-center gap-1.5 px-3.5 py-2 border border-rose-500/30 hover:border-rose-500 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 hover:text-rose-400 font-bold transition-all uppercase text-[10px] rounded-lg cursor-pointer shadow-sm shadow-black/5">
              <Trash2 size={12} />
              <span>Delete</span>
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-3.5 py-2 border border-card-border hover:bg-card-hover/20 text-muted hover:text-foreground font-bold transition-all uppercase text-[10px] rounded-lg cursor-pointer">
                Cancel
              </button>
              <button type="button" onClick={handleSavePriceAlert} className="px-4 py-2 bg-accent hover:opacity-90 text-black font-black transition-all uppercase text-[10px] rounded-lg cursor-pointer shadow-md">
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
        className="fixed inset-0 bg-background/80 backdrop-blur-md z-[200] transition-opacity duration-200"
        onClick={onClose}
      />

      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-full max-w-5xl bg-card/95 backdrop-blur-xl border border-card-border shadow-[0_20px_80px_rgba(0,0,0,0.5)] font-sans text-xs text-foreground select-none rounded-2xl animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[85vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between p-4.5 border-b border-card-border bg-card/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 bg-accent rounded-sm animate-pulse" />
            <h3 className="text-xs font-bold tracking-widest uppercase text-foreground">SYSTEM COMMAND CENTER</h3>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors p-1.5 cursor-pointer rounded-lg hover:bg-card/50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Main content area: vertical tabs + panel */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── Vertical Tabs Sidebar ──────────────────────────────────── */}
          <div className="w-[160px] shrink-0 bg-card/30 border-r border-card-border flex flex-col py-2.5 gap-1 select-none font-sans">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2.5 px-4.5 py-3.5 text-xs font-bold uppercase tracking-widest transition-all cursor-pointer border-l-3 ${activeTab === tab.id
                  ? 'bg-accent/15 text-accent border-l-accent'
                  : 'text-muted hover:text-foreground hover:bg-card/45 border-l-transparent'
                  }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* ── Tab Content Panel ──────────────────────────────────────── */}
          <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin scrollbar-thumb-card-border scrollbar-track-transparent">

            {/* TAB CONTENT ────────────────────────────────────────── */}

            {/* TAB 2: STRATEGY ARCHITECT ────────────────────────────────── */}
            {activeTab === 'strategy' && (
              <EquationBuilder />
            )}

            {/* TAB 3: AUDIO VAULT ──────────────────────────────────────── */}
            {activeTab === 'audio' && (
              <div className="p-6 space-y-4">
                <div className="glass-panel bg-card/45 border border-card-border/80 p-4 rounded-xl text-xs text-muted uppercase tracking-wide leading-relaxed shadow-sm">
                  Configure dedicated audio mappings for critical quantitative engine events. Audio files are loaded from the <span className="text-accent font-bold">/public/audio/</span> directory.
                </div>

                {[
                  { key: 'AUTO_ORDER_ROUTED', label: 'Auto OB Order Routed', desc: 'Fires when autonomous 3-stage position is opened' },
                  { key: 'STAGE_FILL', label: 'Tranche Scale Fill (40/40/20)', desc: 'Fires when Stage 1/2/3 scaling or ratchet update occurs' },
                  { key: 'LIVE_OB_DETECTED', label: 'Live OB Detection', desc: 'Fires when a new institutional Order Block confirms on candle close' },
                  { key: 'IN_ZONE_CONFIRMATION_PENDING', label: 'In-Zone Test Pending', desc: 'Fires when live price enters an active zone awaiting volume confirmation' },
                  { key: 'STRATEGY_MATCHED', label: 'Strategy Architect Match', desc: 'Fires when custom user-built equations match condition gates' },
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
                    <div key={ev.key} className="space-y-2 border-b border-card-border/40 pb-4.5 last:border-0 last:pb-0">
                      <div className="flex justify-between items-baseline">
                        <label className="flex items-center gap-2.5 cursor-pointer group select-none">
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={() => toggleSignalAlertEnabled && toggleSignalAlertEnabled(ev.key as any)}
                            className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all"
                          />
                          <span className="text-xs font-bold uppercase text-foreground tracking-widest group-hover:text-accent transition-colors">
                            {ev.label}
                          </span>
                        </label>
                        <span className="text-[9px] text-muted font-bold uppercase tracking-wider">
                          {ev.key}
                        </span>
                      </div>
                      <span className="block text-xs text-muted italic -mt-1.5 mb-1 leading-none pl-6.5 font-sans">
                        {ev.desc}
                      </span>
                      <div className="flex gap-2 pl-6.5">
                        <select
                          value={currentVal}
                          disabled={!isEnabled}
                          onChange={(e) => updateSignalAlert(ev.key as any, e.target.value)}
                          className="flex-1 bg-background/60 border border-card-border/80 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3.5 py-2.5 text-xs text-foreground rounded-lg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shadow-sm font-sans"
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
                          className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-card/60 border border-card-border/80 hover:bg-accent/10 hover:text-accent transition-all text-[10px] font-bold uppercase text-muted hover:text-foreground rounded-lg cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
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

            {/* TAB 4: ENGINE CORE TUNING PANEL ─────────────────────────── */}
            {activeTab === 'engine' && (
              <div className="p-6 space-y-6">
                <div className="glass-panel bg-card/45 border border-card-border/80 p-4 rounded-xl text-xs text-muted uppercase tracking-wide leading-relaxed shadow-sm">
                  Fine-tune the dynamic, hedge-fund grade Interbank Price Delivery Algorithm (IPDA) quantitative variables in real-time. Changes are auto-saved to Neon PG database.
                </div>

                <div className="space-y-6">
                  {/* Group A: Fractal Sensitivity */}
                  <div className="border border-card-border/60 bg-card/30 rounded-xl p-5 space-y-4">
                    <h4 className="text-xs font-black uppercase text-accent tracking-widest border-b border-card-border/40 pb-2 flex items-center gap-2">
                      <Sparkles size={12} />
                      <span>Group A: Fractal Sensitivity</span>
                    </h4>
                    
                    {/* ATR Period */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-foreground">ATR Period (Volatility Length)</span>
                        <span className="text-xs font-mono font-bold text-accent">{engineSettings?.atrPeriod ?? 14}</span>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="30"
                        step="1"
                        value={engineSettings?.atrPeriod ?? 14}
                        onChange={(e) => updateEngineSettings && updateEngineSettings({ atrPeriod: parseInt(e.target.value, 10) })}
                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-accent"
                      />
                      <span className="block text-[10px] text-muted italic">Defines the lookback length for the normalized Volatility measurement.</span>
                    </div>


                  </div>

                  {/* Group B: Institutional Sponsorship */}
                  <div className="border border-card-border/60 bg-card/30 rounded-xl p-5 space-y-4">
                    <h4 className="text-xs font-black uppercase text-accent tracking-widest border-b border-card-border/40 pb-2 flex items-center gap-2">
                      <Sparkles size={12} />
                      <span>Group B: Institutional Sponsorship</span>
                    </h4>

                    {/* Body Ratio */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-foreground">Candle Body Ratio (BR_t)</span>
                        <span className="text-xs font-mono font-bold text-accent">{(engineSettings?.mssBodyRatio ?? 0.70).toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.50"
                        max="0.95"
                        step="0.05"
                        value={engineSettings?.mssBodyRatio ?? 0.70}
                        onChange={(e) => updateEngineSettings && updateEngineSettings({ mssBodyRatio: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-accent"
                      />
                      <span className="block text-[10px] text-muted italic">Required ratio of real body to total candle height for displacement verification.</span>
                    </div>

                    {/* VEF */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-foreground">Volume Expansion Factor (VEF_t)</span>
                        <span className="text-xs font-mono font-bold text-accent">{(engineSettings?.displacementVef ?? 1.50).toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="1.00"
                        max="3.00"
                        step="0.10"
                        value={engineSettings?.displacementVef ?? 1.50}
                        onChange={(e) => updateEngineSettings && updateEngineSettings({ displacementVef: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-accent"
                      />
                      <span className="block text-[10px] text-muted italic">Specifies the multiple of standard volume required to validate institutionally backed shifts.</span>
                    </div>
                  </div>

                  {/* Group C: Hardening Gates */}
                  <div className="border border-card-border/60 bg-card/30 rounded-xl p-5 space-y-4">
                    <h4 className="text-xs font-black uppercase text-accent tracking-widest border-b border-card-border/40 pb-2 flex items-center gap-2">
                      <Sparkles size={12} />
                      <span>Group C: Hardening Gates</span>
                    </h4>

                    {/* Sharp Departure */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-foreground">Sharp Departure Multiplier (ATR)</span>
                        <span className="text-xs font-mono font-bold text-accent">{(engineSettings?.sharpDepartureMult ?? 1.50).toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="1.00"
                        max="3.00"
                        step="0.10"
                        value={engineSettings?.sharpDepartureMult ?? 1.50}
                        onChange={(e) => updateEngineSettings && updateEngineSettings({ sharpDepartureMult: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-accent"
                      />
                      <span className="block text-[10px] text-muted italic">ATR multiplier required to confirm sharp price departure from breakout zones within 5 candles.</span>
                    </div>
                  </div>

                  {/* Group D: Timeframe Candle Lookbacks */}
                  <div className="border border-card-border/60 bg-card/30 rounded-xl p-5 space-y-4">
                    <h4 className="text-xs font-black uppercase text-accent tracking-widest border-b border-card-border/40 pb-2 flex items-center gap-2">
                      <Sparkles size={12} />
                      <span>Group D: Timeframe Candle Lookbacks</span>
                    </h4>

                    <div className="grid grid-cols-2 gap-4">
                      {/* 1m Limit */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-bold text-foreground font-sans">1m Candle Limit</span>
                          <span className="text-[11px] font-mono font-bold text-accent">{engineSettings?.candlesLimit1m ?? 350}</span>
                        </div>
                        <input
                          type="number"
                          min="50"
                          max="1500"
                          value={engineSettings?.candlesLimit1m ?? 350}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val)) {
                              updateEngineSettings && updateEngineSettings({ candlesLimit1m: val });
                            }
                          }}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value, 10);
                            const clamped = isNaN(val) ? 350 : Math.max(50, Math.min(1500, val));
                            updateEngineSettings && updateEngineSettings({ candlesLimit1m: clamped });
                          }}
                          className="w-full bg-background/60 border border-card-border/80 focus:border-accent focus:outline-none px-3 py-2 text-xs font-bold text-foreground rounded-lg font-mono shadow-sm"
                        />
                      </div>

                      {/* 5m Limit */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-bold text-foreground font-sans">5m Candle Limit</span>
                          <span className="text-[11px] font-mono font-bold text-accent">{engineSettings?.candlesLimit5m ?? 350}</span>
                        </div>
                        <input
                          type="number"
                          min="50"
                          max="1500"
                          value={engineSettings?.candlesLimit5m ?? 350}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val)) {
                              updateEngineSettings && updateEngineSettings({ candlesLimit5m: val });
                            }
                          }}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value, 10);
                            const clamped = isNaN(val) ? 350 : Math.max(50, Math.min(1500, val));
                            updateEngineSettings && updateEngineSettings({ candlesLimit5m: clamped });
                          }}
                          className="w-full bg-background/60 border border-card-border/80 focus:border-accent focus:outline-none px-3 py-2 text-xs font-bold text-foreground rounded-lg font-mono shadow-sm"
                        />
                      </div>

                      {/* 15m Limit */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-bold text-foreground font-sans">15m Candle Limit</span>
                          <span className="text-[11px] font-mono font-bold text-accent">{engineSettings?.candlesLimit15m ?? 250}</span>
                        </div>
                        <input
                          type="number"
                          min="50"
                          max="1500"
                          value={engineSettings?.candlesLimit15m ?? 250}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val)) {
                              updateEngineSettings && updateEngineSettings({ candlesLimit15m: val });
                            }
                          }}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value, 10);
                            const clamped = isNaN(val) ? 250 : Math.max(50, Math.min(1500, val));
                            updateEngineSettings && updateEngineSettings({ candlesLimit15m: clamped });
                          }}
                          className="w-full bg-background/60 border border-card-border/80 focus:border-accent focus:outline-none px-3 py-2 text-xs font-bold text-foreground rounded-lg font-mono shadow-sm"
                        />
                      </div>

                      {/* 1h Limit */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-bold text-foreground font-sans">1h Candle Limit</span>
                          <span className="text-[11px] font-mono font-bold text-accent">{engineSettings?.candlesLimit1h ?? 120}</span>
                        </div>
                        <input
                          type="number"
                          min="30"
                          max="1500"
                          value={engineSettings?.candlesLimit1h ?? 120}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val)) {
                              updateEngineSettings && updateEngineSettings({ candlesLimit1h: val });
                            }
                          }}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value, 10);
                            const clamped = isNaN(val) ? 120 : Math.max(30, Math.min(1500, val));
                            updateEngineSettings && updateEngineSettings({ candlesLimit1h: clamped });
                          }}
                          className="w-full bg-background/60 border border-card-border/80 focus:border-accent focus:outline-none px-3 py-2 text-xs font-bold text-foreground rounded-lg font-mono shadow-sm"
                        />
                      </div>

                      {/* 4h Limit */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-bold text-foreground font-sans">4h Candle Limit</span>
                          <span className="text-[11px] font-mono font-bold text-accent">{engineSettings?.candlesLimit4h ?? 80}</span>
                        </div>
                        <input
                          type="number"
                          min="20"
                          max="1500"
                          value={engineSettings?.candlesLimit4h ?? 80}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val)) {
                              updateEngineSettings && updateEngineSettings({ candlesLimit4h: val });
                            }
                          }}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value, 10);
                            const clamped = isNaN(val) ? 80 : Math.max(20, Math.min(1500, val));
                            updateEngineSettings && updateEngineSettings({ candlesLimit4h: clamped });
                          }}
                          className="w-full bg-background/60 border border-card-border/80 focus:border-accent focus:outline-none px-3 py-2 text-xs font-bold text-foreground rounded-lg font-mono shadow-sm"
                        />
                      </div>
                    </div>
                    <span className="block text-[10px] text-muted italic font-sans leading-relaxed">Configure the historical lookback candle counts for each timeframe independently (min 20, max 1500).</span>
                  </div>

                  {/* Group E: Data Stream Features & Payloads */}
                  <div className="border border-card-border/60 bg-card/30 rounded-xl p-5 space-y-4">
                    <h4 className="text-xs font-black uppercase text-accent tracking-widest border-b border-card-border/40 pb-2 flex items-center gap-2">
                      <Sparkles size={12} />
                      <span>Group E: Data Stream Features & Payloads</span>
                    </h4>

                    <div className="space-y-3.5 pl-1">
                      {/* BTC Correlation Toggle */}
                      <label className="flex items-center gap-3.5 cursor-pointer group select-none">
                        <input
                          type="checkbox"
                          checked={engineSettings?.includeBtcCorrelation !== false}
                          onChange={(e) => updateEngineSettings && updateEngineSettings({ includeBtcCorrelation: e.target.checked })}
                          className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all"
                        />
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold uppercase text-foreground tracking-widest group-hover:text-accent transition-colors">
                            Enable BTC Correlation Data
                          </span>
                          <span className="block text-[10px] text-muted italic font-sans leading-tight">
                            Fetches and serializes BTCUSDT kline arrays for macro calculations.
                          </span>
                        </div>
                      </label>

                      {/* Structure and Swings Toggle */}
                      <label className="flex items-center gap-3.5 cursor-pointer group select-none">
                        <input
                          type="checkbox"
                          checked={engineSettings?.includeStructureAnalysis !== false}
                          onChange={(e) => updateEngineSettings && updateEngineSettings({ includeStructureAnalysis: e.target.checked })}
                          className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all"
                        />
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold uppercase text-foreground tracking-widest group-hover:text-accent transition-colors">
                            Enable Structure & Swings Analysis
                          </span>
                          <span className="block text-[10px] text-muted italic font-sans leading-tight">
                            Runs high-performance intermediate 5-bar pivot tracking, BOS/MSS maps, and SAVP.
                          </span>
                        </div>
                      </label>

                      {/* FVG Detection Toggle */}
                      <label className="flex items-center gap-3.5 cursor-pointer group select-none">
                        <input
                          type="checkbox"
                          checked={engineSettings?.includeFvgDetection !== false}
                          onChange={(e) => updateEngineSettings && updateEngineSettings({ includeFvgDetection: e.target.checked })}
                          className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all"
                        />
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold uppercase text-foreground tracking-widest group-hover:text-accent transition-colors">
                            Enable Fair Value Gap (FVG) Detection
                          </span>
                          <span className="block text-[10px] text-muted italic font-sans leading-tight">
                            Scans and consolidates active unmitigated/pending FVG zones.
                          </span>
                        </div>
                      </label>

                      {/* High Performance Chart Mode Toggle */}
                      <label className="flex items-center gap-3.5 cursor-pointer group select-none">
                        <input
                          type="checkbox"
                          checked={engineSettings?.highPerformanceMode === true}
                          onChange={(e) => updateEngineSettings && updateEngineSettings({ highPerformanceMode: e.target.checked })}
                          className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all"
                        />
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold uppercase text-foreground tracking-widest group-hover:text-accent transition-colors flex items-center gap-1.5">
                            ⚡ High Performance Chart Mode (FPS Boost)
                          </span>
                          <span className="block text-[10px] text-muted italic font-sans leading-tight">
                            Slices active chart indicator lookbacks to 500 candles and defers background overlays for ultra-smooth 60+ FPS chart rendering on lower-power devices.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Group F: Volumetric Visual Filters */}
                  <div className="border border-card-border/60 bg-card/30 rounded-xl p-5 space-y-4">
                    <h4 className="text-xs font-black uppercase text-accent tracking-widest border-b border-card-border/40 pb-2 flex items-center gap-2">
                      <Sparkles size={12} />
                      <span>Group F: Volumetric Visual Filters</span>
                    </h4>

                    <div className="space-y-4 pl-1">
                      {/* Toggle */}
                      <label className="flex items-center gap-3.5 cursor-pointer group select-none">
                        <input
                          type="checkbox"
                          checked={engineSettings?.visualizePerfectMovementOnly === true}
                          onChange={(e) => updateEngineSettings && updateEngineSettings({ visualizePerfectMovementOnly: e.target.checked })}
                          className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all"
                        />
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold uppercase text-foreground tracking-widest group-hover:text-accent transition-colors">
                            Filter Chart Volumetrics (Perfect setups only)
                          </span>
                          <span className="block text-[10px] text-muted italic font-sans leading-tight">
                            Filter volumetric signals to display only setups that satisfy the 3-Phase Perfect Movement Setup Formula. Failed signals render at 20% opacity.
                          </span>
                        </div>
                      </label>

                      {/* Slider parameters under collapsible visualization options */}
                      {engineSettings?.visualizePerfectMovementOnly && (
                        <div className="mt-3 p-4 bg-[#09090b] border-2 border-zinc-800 rounded-none flex flex-col gap-4.5 animate-[fadeIn_0.2s_ease-out]">
                          <span className="text-[9px] font-black uppercase tracking-wider text-accent block border-b border-card-border/40 pb-1.5 font-sans">
                            Global Setup Formula Parameters (Smart Money Sweet Spot)
                          </span>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">
                            {/* ATR Multiplier Slider & Input */}
                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center">
                                <label className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted font-sans">
                                  ATR Multiplier (Setup Range)
                                </label>
                                <span className="text-[10px] font-mono font-bold text-accent">
                                  {(engineSettings?.pmAtrMultiplier ?? 0.5).toFixed(1)}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <input
                                  type="range"
                                  min="0.5"
                                  max="5.0"
                                  step="0.1"
                                  value={engineSettings?.pmAtrMultiplier ?? 0.5}
                                  onChange={(e) => updateEngineSettings && updateEngineSettings({ pmAtrMultiplier: parseFloat(e.target.value) })}
                                  className="flex-1 accent-accent cursor-pointer h-1.5 bg-zinc-900 border border-zinc-800 rounded-none appearance-none"
                                />
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0.1"
                                  max="10.0"
                                  value={engineSettings?.pmAtrMultiplier ?? 0.5}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    if (!isNaN(val)) updateEngineSettings && updateEngineSettings({ pmAtrMultiplier: val });
                                  }}
                                  className="bg-zinc-950 border-2 border-zinc-800 focus:border-accent focus:outline-none px-2 py-1 text-[10px] font-mono text-center text-foreground font-bold rounded-none w-16 shadow-none transition-colors"
                                />
                              </div>
                            </div>

                            {/* Volume SMA Period Slider & Input */}
                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center">
                                <label className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted font-sans">
                                  Volume SMA Period
                                </label>
                                <span className="text-[10px] font-mono font-bold text-accent">
                                  {engineSettings?.pmVolumeSmaPeriod ?? 10}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <input
                                  type="range"
                                  min="5"
                                  max="50"
                                  step="1"
                                  value={engineSettings?.pmVolumeSmaPeriod ?? 10}
                                  onChange={(e) => updateEngineSettings && updateEngineSettings({ pmVolumeSmaPeriod: parseInt(e.target.value, 10) })}
                                  className="flex-1 accent-accent cursor-pointer h-1.5 bg-zinc-900 border border-zinc-800 rounded-none appearance-none"
                                />
                                <input
                                  type="number"
                                  step="1"
                                  min="2"
                                  max="100"
                                  value={engineSettings?.pmVolumeSmaPeriod ?? 10}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (!isNaN(val)) updateEngineSettings && updateEngineSettings({ pmVolumeSmaPeriod: val });
                                  }}
                                  className="bg-zinc-950 border-2 border-zinc-800 focus:border-accent focus:outline-none px-2 py-1 text-[10px] font-mono text-center text-foreground font-bold rounded-none w-16 shadow-none transition-colors"
                                />
                              </div>
                            </div>

                            {/* Min Body Ratio Slider & Input */}
                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center">
                                <label className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted font-sans">
                                  Min Body Ratio (Conviction)
                                </label>
                                <span className="text-[10px] font-mono font-bold text-accent">
                                  {(engineSettings?.pmMinBodyRatio ?? 0.3).toFixed(2)}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <input
                                  type="range"
                                  min="0.1"
                                  max="1.0"
                                  step="0.05"
                                  value={engineSettings?.pmMinBodyRatio ?? 0.3}
                                  onChange={(e) => updateEngineSettings && updateEngineSettings({ pmMinBodyRatio: parseFloat(e.target.value) })}
                                  className="flex-1 accent-accent cursor-pointer h-1.5 bg-zinc-900 border border-zinc-800 rounded-none appearance-none"
                                />
                                <input
                                  type="number"
                                  step="0.05"
                                  min="0.0"
                                  max="1.0"
                                  value={engineSettings?.pmMinBodyRatio ?? 0.3}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    if (!isNaN(val)) updateEngineSettings && updateEngineSettings({ pmMinBodyRatio: val });
                                  }}
                                  className="bg-zinc-950 border-2 border-zinc-800 focus:border-accent focus:outline-none px-2 py-1 text-[10px] font-mono text-center text-foreground font-bold rounded-none w-16 shadow-none transition-colors"
                                />
                              </div>
                            </div>

                            {/* Max Wick Ratio Slider & Input */}
                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center">
                                <label className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted font-sans">
                                  Max Wick Ratio (Rejection)
                                </label>
                                <span className="text-[10px] font-mono font-bold text-accent">
                                  {(engineSettings?.pmMaxWickRatio ?? 0.5).toFixed(2)}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <input
                                  type="range"
                                  min="0.05"
                                  max="0.5"
                                  step="0.01"
                                  value={engineSettings?.pmMaxWickRatio ?? 0.5}
                                  onChange={(e) => updateEngineSettings && updateEngineSettings({ pmMaxWickRatio: parseFloat(e.target.value) })}
                                  className="flex-1 accent-accent cursor-pointer h-1.5 bg-zinc-900 border border-zinc-800 rounded-none appearance-none"
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.0"
                                  max="1.0"
                                  value={engineSettings?.pmMaxWickRatio ?? 0.5}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    if (!isNaN(val)) updateEngineSettings && updateEngineSettings({ pmMaxWickRatio: val });
                                  }}
                                  className="bg-zinc-950 border-2 border-zinc-800 focus:border-accent focus:outline-none px-2 py-1 text-[10px] font-mono text-center text-foreground font-bold rounded-none w-16 shadow-none transition-colors"
                                />
                              </div>
                            </div>

                            {/* Max Retracement Limit Slider & Input */}
                            <div className="flex flex-col gap-2 col-span-2">
                              <div className="flex justify-between items-center">
                                <label className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted font-sans">
                                  Max Retracement Limit (Phase 3 Confirm Rule)
                                </label>
                                <span className="text-[10px] font-mono font-bold text-accent">
                                  {(engineSettings?.pmMaxRetracementLimit ?? 0.7).toFixed(2)}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <input
                                  type="range"
                                  min="0.1"
                                  max="1.0"
                                  step="0.05"
                                  value={engineSettings?.pmMaxRetracementLimit ?? 0.7}
                                  onChange={(e) => updateEngineSettings && updateEngineSettings({ pmMaxRetracementLimit: parseFloat(e.target.value) })}
                                  className="flex-1 accent-accent cursor-pointer h-1.5 bg-zinc-900 border border-zinc-800 rounded-none appearance-none"
                                />
                                <input
                                  type="number"
                                  step="0.05"
                                  min="0.0"
                                  max="2.0"
                                  value={engineSettings?.pmMaxRetracementLimit ?? 0.7}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    if (!isNaN(val)) updateEngineSettings && updateEngineSettings({ pmMaxRetracementLimit: val });
                                  }}
                                  className="bg-zinc-950 border-2 border-zinc-800 focus:border-accent focus:outline-none px-2 py-1 text-[10px] font-mono text-center text-foreground font-bold rounded-none w-16 shadow-none transition-colors"
                                />
                              </div>
                            </div>

                            {/* Sweep Lookback Slider & Input */}
                            <div className="flex flex-col gap-2 col-span-2">
                              <div className="flex justify-between items-center">
                                <label className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted font-sans">
                                  Sweep Lookback (Candles Before Signal)
                                </label>
                                <span className="text-[10px] font-mono font-bold text-accent">
                                  {engineSettings?.pmSweepLookback ?? 5}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <input
                                  type="range"
                                  min="2"
                                  max="15"
                                  step="1"
                                  value={engineSettings?.pmSweepLookback ?? 5}
                                  onChange={(e) => updateEngineSettings && updateEngineSettings({ pmSweepLookback: parseInt(e.target.value, 10) })}
                                  className="flex-1 accent-accent cursor-pointer h-1.5 bg-zinc-900 border border-zinc-800 rounded-none appearance-none"
                                />
                                <input
                                  type="number"
                                  step="1"
                                  min="1"
                                  max="30"
                                  value={engineSettings?.pmSweepLookback ?? 5}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (!isNaN(val)) updateEngineSettings && updateEngineSettings({ pmSweepLookback: val });
                                  }}
                                  className="bg-zinc-950 border-2 border-zinc-800 focus:border-accent focus:outline-none px-2 py-1 text-[10px] font-mono text-center text-foreground font-bold rounded-none w-16 shadow-none transition-colors"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-4 border-t border-card-border bg-card/50 shrink-0 rounded-b-2xl">
          {renderSyncIndicator()}
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 border border-card-border hover:bg-card-hover/20 text-muted hover:text-foreground font-bold transition-all uppercase text-[10px] rounded-lg cursor-pointer shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
};

export default SettingsModal;
