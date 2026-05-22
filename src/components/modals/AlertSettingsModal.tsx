import React, { useState, useEffect } from 'react';
import { X, Volume2, Play, Trash2, Bell, Cpu, Sparkles } from 'lucide-react';
import { useAlertSounds, AlertSound } from '@/hooks/useAlertSounds';

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

interface AlertSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alert: Alert | null;
  onSave: (updatedAlert: Alert) => void;
  onDelete: (alertId: string) => void;
}

const AlertSettingsModal: React.FC<AlertSettingsModalProps> = ({
  isOpen,
  onClose,
  alert,
  onSave,
  onDelete,
}) => {
  const { playSound } = useAlertSounds();

  // Local state for alert form fields
  const [label, setLabel] = useState('');
  const [triggerCondition, setTriggerCondition] = useState<'TOUCH' | 'CLOSE_ABOVE' | 'CLOSE_BELOW' | 'WICK_PURGE_REJECT'>('TOUCH');
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m' | '1h' | '4h' | '1D'>('5m');
  const [browserNotification, setBrowserNotification] = useState(true);
  const [triggerAiAnalysis, setTriggerAiAnalysis] = useState(false);
  const [soundAlert, setSoundAlert] = useState(true);
  const [soundSelection, setSoundSelection] = useState<AlertSound>('Institutional Pulse');

  // Load alert details when modal opens
  useEffect(() => {
    if (alert) {
      setLabel(alert.label || `Alert @ ${alert.price.toFixed(2)}`);
      setTriggerCondition(alert.triggerCondition || 'TOUCH');
      setTimeframe(alert.timeframe || '5m');
      setBrowserNotification(alert.actionChain?.browserNotification ?? true);
      setTriggerAiAnalysis(alert.actionChain?.triggerAiAnalysis ?? false);
      setSoundAlert(alert.actionChain?.soundAlert ?? true);
      setSoundSelection(alert.soundSelection || 'Institutional Pulse');
    }
  }, [alert, isOpen]);

  if (!isOpen || !alert) return null;

  const handleSave = () => {
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

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-[#0e0e0f]/75 backdrop-blur-sm z-[200] transition-opacity duration-200"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-full max-w-md bg-[#141416]/95 border border-[#4a4457]/50 shadow-[0_0_50px_rgba(0,0,0,0.8)] font-mono text-xs text-[#e5e2e3] select-none rounded-none animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4a4457]/50 bg-[#1c1b1c]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: alert.color }} />
            <h3 className="text-xs font-bold tracking-[0.12em] uppercase text-white/95">ALERT CONFIGURATION</h3>
          </div>
          <button 
            onClick={onClose} 
            className="text-[#958da3] hover:text-white transition-colors p-1"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Form Content */}
        <div className="p-5 space-y-4">
          
          {/* Static Price read-out */}
          <div className="flex justify-between items-center bg-[#0e0e0f] border border-[#4a4457]/30 px-3 py-2">
            <span className="text-[10px] text-[#958da3] uppercase font-semibold">Price Trigger Level</span>
            <span className="text-sm font-bold tracking-tight text-white/90">
              {alert.price.toFixed(2)} USDC
            </span>
          </div>

          {/* Label Input */}
          <div className="space-y-1.5">
            <label className="block text-[10px] text-[#958da3] uppercase font-bold tracking-wider">Alert Name / Label</label>
            <input 
              type="text" 
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full bg-[#0e0e0f] border border-[#4a4457]/50 focus:border-[#50ffaf] focus:outline-none px-3 py-2 text-xs font-mono text-white/90 rounded-none transition-colors"
              placeholder="e.g. PDH Sweep Trap"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Trigger Condition dropdown */}
            <div className="space-y-1.5">
              <label className="block text-[10px] text-[#958da3] uppercase font-bold tracking-wider">Condition</label>
              <select 
                value={triggerCondition}
                onChange={(e: any) => setTriggerCondition(e.target.value)}
                className="w-full bg-[#0e0e0f] border border-[#4a4457]/50 focus:border-[#50ffaf] focus:outline-none px-2.5 py-2 text-xs font-mono text-white/90 rounded-none transition-colors cursor-pointer"
              >
                <option value="TOUCH">TOUCH</option>
                <option value="CLOSE_ABOVE">CLOSE_ABOVE</option>
                <option value="CLOSE_BELOW">CLOSE_BELOW</option>
                <option value="WICK_PURGE_REJECT">WICK_PURGE_REJECT</option>
              </select>
            </div>

            {/* Timeframe dropdown */}
            <div className="space-y-1.5">
              <label className="block text-[10px] text-[#958da3] uppercase font-bold tracking-wider">Timeframe</label>
              <select 
                value={timeframe}
                onChange={(e: any) => setTimeframe(e.target.value)}
                className="w-full bg-[#0e0e0f] border border-[#4a4457]/50 focus:border-[#50ffaf] focus:outline-none px-2.5 py-2 text-xs font-mono text-white/90 rounded-none transition-colors cursor-pointer"
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
            <label className="block text-[10px] text-[#958da3] uppercase font-bold tracking-wider mb-1">Action Chain Execution</label>
            <div className="space-y-1.5 bg-[#0e0e0f]/50 border border-[#4a4457]/30 p-3">
              
              {/* Browser notification option */}
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={browserNotification}
                  onChange={(e) => setBrowserNotification(e.target.checked)}
                  className="rounded-none bg-[#0e0e0f] border border-[#4a4457]/50 text-[#50ffaf] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer accent-[#50ffaf]"
                />
                <div className="flex items-center gap-1.5">
                  <Bell size={11} className="text-[#958da3] group-hover:text-white transition-colors" />
                  <span className="text-[11px] text-[#958da3] group-hover:text-white transition-colors">Browser Notification</span>
                </div>
              </label>

              {/* Trigger AI Analysis option */}
              <label className="flex items-center gap-2.5 cursor-pointer group mt-2.5">
                <input 
                  type="checkbox" 
                  checked={triggerAiAnalysis}
                  onChange={(e) => setTriggerAiAnalysis(e.target.checked)}
                  className="rounded-none bg-[#0e0e0f] border border-[#4a4457]/50 text-[#50ffaf] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer accent-[#50ffaf]"
                />
                <div className="flex items-center gap-1.5">
                  <Sparkles size={11} className="text-[#958da3] group-hover:text-white transition-colors" />
                  <span className="text-[11px] text-[#958da3] group-hover:text-white transition-colors">Trigger AI Analysis</span>
                </div>
              </label>

              {/* Sound alert option */}
              <label className="flex items-center gap-2.5 cursor-pointer group mt-2.5">
                <input 
                  type="checkbox" 
                  checked={soundAlert}
                  onChange={(e) => setSoundAlert(e.target.checked)}
                  className="rounded-none bg-[#0e0e0f] border border-[#4a4457]/50 text-[#50ffaf] focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer accent-[#50ffaf]"
                />
                <div className="flex items-center gap-1.5">
                  <Volume2 size={11} className="text-[#958da3] group-hover:text-white transition-colors" />
                  <span className="text-[11px] text-[#958da3] group-hover:text-white transition-colors">Sound Alert</span>
                </div>
              </label>

            </div>
          </div>

          {/* Sound Selection - disabled if sound alert is false */}
          <div className="space-y-1.5">
            <label className="block text-[10px] text-[#958da3] uppercase font-bold tracking-wider">Tactile Audio Profile</label>
            <div className="flex gap-2">
              <select 
                value={soundSelection}
                disabled={!soundAlert}
                onChange={(e: any) => setSoundSelection(e.target.value)}
                className="flex-1 bg-[#0e0e0f] border border-[#4a4457]/50 focus:border-[#50ffaf] focus:outline-none px-2.5 py-2 text-xs font-mono text-white/90 rounded-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <option value="Institutional Pulse">Institutional Pulse (Sine)</option>
                <option value="Mechanical Click">Mechanical Click (Tri/Noise)</option>
                <option value="Target Chime">Target Chime (Harmonic)</option>
              </select>
              
              <button
                type="button"
                disabled={!soundAlert}
                onClick={handleTestAudio}
                className="flex items-center gap-1 px-3 py-2 bg-[#1c1b1c] border border-[#4a4457]/50 hover:bg-[#282729] disabled:opacity-40 disabled:hover:bg-[#1c1b1c] active:bg-[#0e0e0f] transition-all text-[10px] font-bold uppercase text-[#958da3] hover:text-[#e5e2e3] disabled:text-[#958da3] rounded-none cursor-pointer"
                title="Test sound output"
              >
                <Play size={10} fill="currentColor" />
                <span>Test</span>
              </button>
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="flex justify-between items-center p-4 border-t border-[#4a4457]/50 bg-[#1c1b1c]">
          {/* Delete Button */}
          <button
            type="button"
            onClick={() => onDelete(alert.id)}
            className="flex items-center gap-1 px-2.5 py-1.5 border border-red-500/30 hover:border-red-500 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 font-bold transition-all uppercase text-[10px] rounded-none cursor-pointer"
          >
            <Trash2 size={12} />
            <span>Delete</span>
          </button>

          {/* Cancel/Save Button group */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-[#4a4457]/50 hover:bg-white/5 text-[#958da3] hover:text-white font-bold transition-all uppercase text-[10px] rounded-none cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 bg-[#50ffaf] border border-[#50ffaf] hover:bg-[#40dd96] text-black font-bold transition-all uppercase text-[10px] rounded-none cursor-pointer"
            >
              Save Config
            </button>
          </div>
        </div>

      </div>
    </>
  );
};

export default AlertSettingsModal;
