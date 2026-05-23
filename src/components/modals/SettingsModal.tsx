import React, { useState, useEffect } from 'react';
import { X, Volume2, Play, Trash2, Bell, Cpu, Sparkles, AlertCircle } from 'lucide-react';
import { useAlertSounds, AVAILABLE_ALERT_FILES, AlertSound } from '@/hooks/useAlertSounds';
import { useMarketDataContext } from '@/context/MarketDataContext';

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

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alert: Alert | null;
  onSave: (updatedAlert: Alert) => void;
  onDelete: (alertId: string) => void;
  initialTab?: 'price' | 'signal';
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  alert,
  onSave,
  onDelete,
  initialTab = 'price',
}) => {
  const { playFile, playSound } = useAlertSounds();
  const { signalAlerts, updateSignalAlert, signalAlertsEnabled, toggleSignalAlertEnabled } = useMarketDataContext();

  // Tabs state
  const [activeTab, setActiveTab] = useState<'price' | 'signal'>(initialTab);

  // Price alert local form fields
  const [label, setLabel] = useState('');
  const [triggerCondition, setTriggerCondition] = useState<'TOUCH' | 'CLOSE_ABOVE' | 'CLOSE_BELOW' | 'WICK_PURGE_REJECT'>('TOUCH');
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m' | '1h' | '4h' | '1D'>('5m');
  const [browserNotification, setBrowserNotification] = useState(true);
  const [triggerAiAnalysis, setTriggerAiAnalysis] = useState(false);
  const [soundAlert, setSoundAlert] = useState(true);
  const [soundSelection, setSoundSelection] = useState<any>('Institutional Pulse');

  // Load alert details when modal opens or changes
  useEffect(() => {
    if (alert) {
      setLabel(alert.label || `Alert @ ${alert.price.toFixed(2)}`);
      setTriggerCondition(alert.triggerCondition || 'TOUCH');
      setTimeframe(alert.timeframe || '5m');
      setBrowserNotification(alert.actionChain?.browserNotification ?? true);
      setTriggerAiAnalysis(alert.actionChain?.triggerAiAnalysis ?? false);
      setSoundAlert(alert.actionChain?.soundAlert ?? true);
      setSoundSelection(alert.soundSelection || 'Institutional Pulse');
      setActiveTab('price');
    } else {
      setActiveTab('signal');
    }
  }, [alert, isOpen]);

  if (!isOpen) return null;

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

  return (
    <>
      {/* Backdrop with extreme blur and dark opacity */}
      <div 
        className="fixed inset-0 bg-[#0e0e0f]/80 backdrop-blur-md z-[200] transition-opacity duration-200"
        onClick={onClose}
      />

      {/* Brutalist Glass-morphic Modal Container */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-full max-w-md bg-[#0e0e0f]/90 border border-[#4a4457] shadow-[0_0_80px_rgba(0,0,0,0.95)] font-mono text-xs text-[#e5e2e3] select-none rounded-none animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4a4457] bg-[#141416]/95">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-[#50ffaf] rounded-none animate-pulse" />
            <h3 className="text-xs font-bold tracking-[0.15em] uppercase text-white">SYSTEM COMMAND CONSOLE</h3>
          </div>
          <button 
            onClick={onClose} 
            className="text-[#958da3] hover:text-white transition-colors p-1"
          >
            <X size={16} />
          </button>
        </div>

        {/* Brutalist Tabs Switcher */}
        <div className="flex bg-[#141416]/50 border-b border-[#4a4457] p-1 gap-1">
          <button
            onClick={() => alert && setActiveTab('price')}
            disabled={!alert}
            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest transition-all rounded-none border ${
              activeTab === 'price'
                ? 'bg-[#50ffaf] text-black border-[#50ffaf] font-black'
                : 'bg-transparent text-[#958da3] border-transparent hover:text-white disabled:opacity-30 disabled:hover:text-[#958da3] disabled:cursor-not-allowed'
            }`}
          >
            [Price Alerts]
          </button>
          <button
            onClick={() => setActiveTab('signal')}
            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest transition-all rounded-none border ${
              activeTab === 'signal'
                ? 'bg-[#50ffaf] text-black border-[#50ffaf] font-black'
                : 'bg-transparent text-[#958da3] border-transparent hover:text-white'
            }`}
          >
            [Signal Alerts]
          </button>
        </div>

        {/* Scrollable Form Content */}
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-[#4a4457] scrollbar-track-transparent">
          
          {/* TAB 1: PRICE ALERTS (MANUAL LINES) */}
          {activeTab === 'price' && alert && (
            <div className="space-y-4">
              
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
                {/* Trigger Condition dropdown */}
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

                {/* Timeframe dropdown */}
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

              {/* Action Chain Checkboxes */}
              <div className="space-y-2">
                <label className="block text-[9px] text-[#958da3] uppercase font-bold tracking-widest">Action Chain Execution</label>
                <div className="space-y-2 bg-[#141416]/50 border border-[#4a4457] p-3.5">
                  
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={browserNotification}
                      onChange={(e) => setBrowserNotification(e.target.checked)}
                      className="rounded-none bg-[#141416] border border-[#4a4457] text-[#50ffaf] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer accent-[#50ffaf]"
                    />
                    <div className="flex items-center gap-1.5">
                      <Bell size={11} className="text-[#958da3] group-hover:text-white transition-colors" />
                      <span className="text-[10px] text-[#958da3] group-hover:text-white transition-colors">Browser Notification</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={triggerAiAnalysis}
                      onChange={(e) => setTriggerAiAnalysis(e.target.checked)}
                      className="rounded-none bg-[#141416] border border-[#4a4457] text-[#50ffaf] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer accent-[#50ffaf]"
                    />
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={11} className="text-[#958da3] group-hover:text-white transition-colors" />
                      <span className="text-[10px] text-[#958da3] group-hover:text-white transition-colors">Trigger AI Analysis</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={soundAlert}
                      onChange={(e) => setSoundAlert(e.target.checked)}
                      className="rounded-none bg-[#141416] border border-[#4a4457] text-[#50ffaf] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer accent-[#50ffaf]"
                    />
                    <div className="flex items-center gap-1.5">
                      <Volume2 size={11} className="text-[#958da3] group-hover:text-white transition-colors" />
                      <span className="text-[10px] text-[#958da3] group-hover:text-white transition-colors">Sound Alert</span>
                    </div>
                  </label>

                </div>
              </div>

              {/* Sound Selection */}
              <div className="space-y-1.5">
                <label className="block text-[9px] text-[#958da3] uppercase font-bold tracking-widest">Tactile Audio Profile</label>
                <div className="flex gap-2">
                  <select 
                    value={soundSelection}
                    disabled={!soundAlert}
                    onChange={(e: any) => setSoundSelection(e.target.value)}
                    className="flex-1 bg-[#141416] border border-[#4a4457] focus:border-[#50ffaf] focus:outline-none px-2.5 py-2 text-xs font-mono text-white rounded-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <option value="Institutional Pulse">Institutional Pulse (Sine)</option>
                    <option value="Mechanical Click">Mechanical Click (Tri/Noise)</option>
                    <option value="Target Chime">Target Chime (Harmonic)</option>
                  </select>
                  
                  <button
                    type="button"
                    disabled={!soundAlert}
                    onClick={handleTestAudio}
                    className="flex items-center gap-1 px-3 py-2 bg-[#141416] border border-[#4a4457] hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-[#141416] transition-all text-[10px] font-bold uppercase text-[#958da3] hover:text-[#e5e2e3] rounded-none cursor-pointer"
                  >
                    <Play size={10} fill="currentColor" />
                    <span>Test</span>
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: SIGNAL ALERTS (ALGORITHMIC EVENTS) */}
          {activeTab === 'signal' && (
            <div className="space-y-4">
              
              <div className="bg-[#141416]/50 border border-[#4a4457] p-3 text-[10px] text-[#958da3] uppercase tracking-wide leading-relaxed">
                Configure dedicated audio mappings for critical quantitative engine events. Audio files are loaded from the <span className="text-[#50ffaf]">/public/audio/</span> directory.
              </div>

              {/* Events dropdown list */}
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

        {/* Footer Actions */}
        <div className="flex justify-between items-center p-4 border-t border-[#4a4457] bg-[#141416]/95">
          
          {/* Left Footer Action */}
          {activeTab === 'price' && alert ? (
            <button
              type="button"
              onClick={() => onDelete(alert.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 border border-red-500/30 hover:border-red-500 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 font-bold transition-all uppercase text-[10px] rounded-none cursor-pointer"
            >
              <Trash2 size={12} />
              <span>Delete</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 text-[9px] text-[#958da3]">
              <AlertCircle size={12} />
              <span>Signal Alerts Auto-Save</span>
            </div>
          )}

          {/* Right Button group */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-[#4a4457] hover:bg-white/5 text-[#958da3] hover:text-white font-bold transition-all uppercase text-[10px] rounded-none cursor-pointer"
            >
              Close
            </button>
            
            {activeTab === 'price' && alert && (
              <button
                type="button"
                onClick={() => {
                  handleSavePriceAlert();
                  onClose();
                }}
                className="px-4 py-1.5 bg-[#50ffaf] border border-[#50ffaf] hover:bg-[#40dd96] text-black font-bold transition-all uppercase text-[10px] rounded-none cursor-pointer"
              >
                Save Config
              </button>
            )}
          </div>
        </div>

      </div>
    </>
  );
};

export default SettingsModal;
