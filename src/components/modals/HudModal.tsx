import React, { useState } from 'react';
import { X, Brain, Zap, Copy, Loader2, Activity } from 'lucide-react';

interface HudModalProps {
  isOpen: boolean;
  onClose: () => void;
  hudData: any;
  aiNote: { title: string; text: string } | null;
  tvAlerts: any[];
  aiAnalysis: string | null;
  isAnalyzing: boolean;
  onSynthesize: () => void;
  copyText: string;
}

const HudModal: React.FC<HudModalProps> = ({
  isOpen,
  onClose,
  hudData,
  aiNote,
  tvAlerts,
  aiAnalysis,
  isAnalyzing,
  onSynthesize,
  copyText,
}) => {
  const [activeTab, setActiveTab] = useState<'HUD' | 'JSON'>('HUD');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = copyText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      {/* Backdrop with extreme blur and dark opacity */}
      <div
        className="fixed inset-0 bg-[#0e0e0f]/80 backdrop-blur-md z-[200] transition-opacity duration-200"
        onClick={onClose}
      />

      {/* Brutalist Glass-morphic Modal Container */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-full max-w-3xl bg-[#0e0e0f]/90 border border-[#4a4457] shadow-[0_0_80px_rgba(0,0,0,0.95)] font-mono text-xs text-[#e5e2e3] select-none rounded-none animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4a4457] bg-[#141416]/95 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-[#d1bcff] rounded-none animate-pulse" />
            <h3 className="text-xs font-bold tracking-[0.15em] uppercase text-white">SYNTHESIS DISPATCH CONSOLE</h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#958da3] hover:text-white transition-colors p-1"
            title="Close Console"
          >
            <X size={16} />
          </button>
        </div>

        {/* Brutalist Tabs Switcher */}
        {aiAnalysis && (
          <div className="flex bg-[#141416]/50 border-b border-[#4a4457] p-1 gap-1 shrink-0">
            <button
              onClick={() => setActiveTab('HUD')}
              className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest transition-all rounded-none border ${
                activeTab === 'HUD'
                  ? 'bg-[#d1bcff] text-black border-[#d1bcff] font-black shadow-[0_0_10px_rgba(209,188,255,0.2)]'
                  : 'bg-transparent text-[#958da3] border-transparent hover:text-white'
              }`}
            >
              [HUD Diagnostics]
            </button>
            <button
              onClick={() => setActiveTab('JSON')}
              className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest transition-all rounded-none border ${
                activeTab === 'JSON'
                  ? 'bg-[#d1bcff] text-black border-[#d1bcff] font-black shadow-[0_0_10px_rgba(209,188,255,0.2)]'
                  : 'bg-transparent text-[#958da3] border-transparent hover:text-white'
              }`}
            >
              [Raw Prompt JSON]
            </button>
          </div>
        )}

        {/* Scrollable Form Content */}
        <div className="p-5 space-y-5 overflow-y-auto scrollbar-thin scrollbar-thumb-[#4a4457] scrollbar-track-transparent bg-[#0e0e0f]/50 flex-1">
          {aiAnalysis ? (
            activeTab === 'HUD' && hudData ? (
              <div className="space-y-5">
                
                {/* HUD Grid/Table */}
                <div className="border border-[#4a4457]/50 rounded-none overflow-hidden bg-[#0e0e0f]/40 relative">
                  {isAnalyzing && (
                    <div className="absolute inset-0 bg-[#0e0e0f]/40 backdrop-blur-[1px] flex items-center justify-center z-10">
                      <div className="flex items-center gap-2 bg-[#141416] border border-[#4a4457] px-4 py-2 text-[10px] font-black text-[#d1bcff] tracking-widest">
                        <Loader2 size={12} className="animate-spin" />
                        <span>RE-INFERRING...</span>
                      </div>
                    </div>
                  )}
                  <table className="w-full text-left border-collapse">
                    <tbody>
                      {Object.entries(hudData).map(([key, value]) => {
                        let colorClass = 'text-[#e5e2e3]';
                        const vStr = Array.isArray(value) ? value.join(', ') : String(value).toUpperCase();

                        if (vStr.includes('BUY') || vStr.includes('LONG') || vStr.includes('BULLISH') || vStr.includes('STRONG') || vStr.includes('FULL_RISK')) colorClass = 'text-[#50ffaf]';
                        else if (vStr.includes('SELL') || vStr.includes('SHORT') || vStr.includes('BEARISH') || vStr.includes('WEAK') || vStr.includes('ABORT')) colorClass = 'text-[#ffb4ab]';
                        else if (vStr.includes('STAND DOWN') || vStr.includes('NEUTRAL') || vStr.includes('NONE') || vStr.includes('WAIT')) colorClass = 'text-[#958da3]';

                        const displayKey = key.replace(/_/g, ' ').toUpperCase();
                        return (
                          <tr key={key} className="border-b border-[#4a4457]/50 last:border-0 bg-[#0e0e0f]/40 hover:bg-[#141416]/40 transition-colors">
                            <td className="p-3 text-[10px] font-black uppercase tracking-widest text-[#958da3] border-r border-[#4a4457]/50 w-1/3">
                              {displayKey}
                            </td>
                            <td className={`p-3 text-xs font-bold font-mono ${colorClass}`}>
                              {Array.isArray(value) ? value.join(', ') : String(value)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* AI Note / Narrative */}
                {aiNote && (
                  <div className="bg-[#1c1b1c]/80 border border-[#d1bcff]/30 p-4 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-[#d1bcff]/5 blur-2xl rounded-full" />
                    <span className="text-[10px] font-black text-[#d1bcff] uppercase tracking-widest block mb-2 flex items-center gap-1.5">
                      <Activity size={12} className="text-[#d1bcff]" />
                      {aiNote.title}
                    </span>
                    <p className="text-xs text-[#e5e2e3] italic leading-relaxed whitespace-pre-line font-medium pl-3 border-l-2 border-[#d1bcff]/40">
                      {aiNote.text}
                    </p>
                  </div>
                )}

                {/* TradingView Alerts */}
                {tvAlerts.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[10px] font-black text-[#958da3] uppercase tracking-widest block">
                      TradingView Live Alerts Pipeline
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {tvAlerts.map((alert: any, i: number) => {
                        const displayAlert = typeof alert === 'object' && alert !== null && alert.price && alert.reason
                          ? `${alert.price} - ${alert.reason}`
                          : typeof alert === 'string'
                            ? alert
                            : JSON.stringify(alert);

                        return (
                          <div key={i} className="bg-[#1c1b1c]/40 p-3 border border-[#4a4457]/50 flex items-start gap-2.5 hover:bg-[#1c1b1c]/60 transition-colors">
                            <Zap size={12} className="text-[#50ffaf] mt-0.5 shrink-0 animate-pulse" />
                            <span className="text-[10px] text-[#e5e2e3] uppercase tracking-wider font-mono">
                              {displayAlert}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-[#958da3] uppercase font-bold tracking-wider">Context Prompt Payload</span>
                  <button
                    onClick={handleCopy}
                    className={`flex items-center gap-1.5 px-3 py-1.5 border transition-all text-[10px] font-black uppercase tracking-widest ${
                      copied
                        ? 'bg-[#50ffaf]/10 border-[#50ffaf]/50 text-[#50ffaf]'
                        : 'bg-[#141416] border-[#4a4457] text-[#958da3] hover:text-[#d1bcff] hover:border-[#d1bcff]/30'
                    }`}
                  >
                    <Copy size={12} />
                    <span>{copied ? 'COPIED' : 'COPY CONTEXT'}</span>
                  </button>
                </div>
                <pre className="text-[10px] text-[#50ffaf] leading-relaxed whitespace-pre-wrap bg-[#1c1b1c]/80 p-4 rounded-none border border-[#4a4457]/50 max-h-[50vh] overflow-y-auto font-mono scrollbar-thin scrollbar-thumb-[#4a4457] scrollbar-track-transparent">
                  <code>{copyText}</code>
                </pre>
              </div>
            )
          ) : (
            <div className="py-20 flex flex-col items-center justify-center text-center p-6 bg-[#0e0e0f]/30 border border-[#4a4457]/30">
              <Brain size={48} className="text-zinc-800 mb-4 animate-pulse" />
              <h4 className="text-xs font-black text-[#958da3] uppercase tracking-widest mb-2">SYSTEM INACTIVE</h4>
              <p className="text-[10px] text-[#958da3] uppercase tracking-tighter max-w-sm mb-6 leading-relaxed">
                No active synthesis found. The neural inference engine requires live payload data to start structural mapping.
              </p>
              <button
                onClick={onSynthesize}
                disabled={isAnalyzing}
                className="py-2.5 px-6 bg-[#d1bcff] hover:bg-[#c2a9f3] text-black text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    <span>Inference Scanning...</span>
                  </>
                ) : (
                  <>
                    <Zap size={12} fill="currentColor" />
                    <span>Synthesize Live Data</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex justify-between items-center p-4 border-t border-[#4a4457] bg-[#141416]/95 shrink-0">
          <div className="flex items-center gap-1.5 text-[9px] text-[#958da3] font-bold uppercase tracking-widest">
            <Activity size={12} className="text-[#50ffaf] animate-pulse" />
            <span>Console Link: Active</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[#4a4457] hover:bg-white/5 text-[#958da3] hover:text-white font-bold transition-all uppercase text-[10px] rounded-none cursor-pointer"
            >
              Close Console
            </button>
            {aiAnalysis && (
              <button
                type="button"
                onClick={onSynthesize}
                disabled={isAnalyzing}
                className="px-5 py-2 bg-[#d1bcff] border border-[#d1bcff] hover:bg-[#c2a9f3] text-black font-black transition-all uppercase text-[10px] rounded-none cursor-pointer flex items-center gap-1.5"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    <span>Synthesizing...</span>
                  </>
                ) : (
                  <>
                    <Zap size={12} fill="currentColor" />
                    <span>Synthesize Live Data</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </>
  );
};

export default HudModal;
