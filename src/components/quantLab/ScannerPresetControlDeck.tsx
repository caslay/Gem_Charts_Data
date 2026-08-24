'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Bookmark,
  BookmarkPlus,
  Save,
  Trash2,
  Check,
  RotateCw,
  Sparkles,
  Cloud,
  HardDrive,
  ShieldCheck,
  X,
  Sliders
} from 'lucide-react';
import {
  ScannerStrategyType,
  ScannerPreset,
  SweepReclaimPresetConfig,
  OrderBlockPresetConfig,
  loadScannerPresets,
  saveCustomPreset,
  updateCustomPreset,
  deleteCustomPreset,
  getActivePresetId,
  setActivePresetId,
  applyPresetToLiveExecution,
  syncPresetsWithCloud,
  SCANNER_PRESETS_CHANGED_EVENT
} from '@/lib/quantEngine/scannerPresets';

interface ScannerPresetControlDeckProps {
  strategyType: ScannerStrategyType;
  currentConfig: SweepReclaimPresetConfig | OrderBlockPresetConfig;
  onApplyPreset: (preset: ScannerPreset) => void;
  className?: string;
  presetTimeframe?: string;
  presetSymbol?: string;
}

export default function ScannerPresetControlDeck({
  strategyType,
  currentConfig,
  onApplyPreset,
  className = '',
  presetTimeframe,
  presetSymbol,
}: ScannerPresetControlDeckProps) {
  const [presets, setPresets] = useState<ScannerPreset[]>(() => {
    // To prevent hydration mismatch, only load factory presets on initial render.
    // The useEffect will load custom presets from localStorage after mount.
    if (typeof window === 'undefined') return loadScannerPresets(strategyType);
    return loadScannerPresets(strategyType).filter(p => p.isFactory);
  });
  const [activePresetId, setActivePresetIdState] = useState<string | null>(null);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');
  const [presetDescInput, setPresetDescInput] = useState('');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Synchronize presets from local store and listen for background changes
  const refreshPresets = useCallback(() => {
    const loaded = loadScannerPresets(strategyType);
    setPresets(loaded);
    const activeId = getActivePresetId(strategyType);
    setActivePresetIdState(activeId);
  }, [strategyType]);

  useEffect(() => {
    refreshPresets();

    const handleStorageChange = () => {
      refreshPresets();
    };

    window.addEventListener(SCANNER_PRESETS_CHANGED_EVENT, handleStorageChange);
    window.addEventListener('storage', handleStorageChange);

    // Trigger background cloud sync on mount
    syncPresetsWithCloud().then(({ isOffline }) => {
      if (!isOffline) {
        refreshPresets();
      }
    });

    return () => {
      window.removeEventListener(SCANNER_PRESETS_CHANGED_EVENT, handleStorageChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [refreshPresets]);

  // Flash feedback message
  const triggerFeedback = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 2500);
  };

  // Find active preset object
  const activePreset = presets.find((p) => p.id === activePresetId) || presets[0] || null;

  // Handle Preset Selection
  const handleSelectPreset = (presetId: string) => {
    const selected = presets.find((p) => p.id === presetId);
    if (!selected) return;

    setActivePresetId(strategyType, presetId);
    setActivePresetIdState(presetId);
    applyPresetToLiveExecution(selected);
    onApplyPreset(selected);
    triggerFeedback(`Armed Live Engine: ${selected.name}`);
  };

  // Handle Save New Preset
  const handleSaveNewPreset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetNameInput.trim()) return;

    const saved = saveCustomPreset({
      name: presetNameInput.trim(),
      description: presetDescInput.trim() || undefined,
      strategyType,
      symbol: presetSymbol || (currentConfig as any).symbol || 'ETHUSDC',
      timeframe: presetTimeframe || activePreset?.timeframe || (currentConfig as any).timeframe || '15m',
      config: currentConfig,
    });

    setActivePresetId(strategyType, saved.id);
    setActivePresetIdState(saved.id);
    applyPresetToLiveExecution(saved);
    onApplyPreset(saved);
    setIsSaveModalOpen(false);
    setPresetNameInput('');
    setPresetDescInput('');
    refreshPresets();
    triggerFeedback(`Saved & Armed: "${saved.name}"`);
  };

  // Handle Overwrite / Update Active Custom Preset
  const handleUpdateActivePreset = () => {
    if (!activePreset || activePreset.isFactory) return;

    const updated = updateCustomPreset(activePreset.id, {
      config: currentConfig,
      symbol: presetSymbol || (currentConfig as any).symbol || activePreset.symbol,
      timeframe: presetTimeframe || activePreset.timeframe, // Always fallback to active preset's timeframe on update if no explicit prop
    });

    if (updated) {
      refreshPresets();
      triggerFeedback(`Updated: "${updated.name}"`);
    }
  };

  // Handle Delete Active Custom Preset
  const handleDeleteActivePreset = () => {
    if (!activePreset || activePreset.isFactory) return;

    const confirmDelete = window.confirm(`Are you sure you want to delete custom preset "${activePreset.name}"?`);
    if (!confirmDelete) return;

    const deleted = deleteCustomPreset(activePreset.id);
    if (deleted) {
      // Default back to first factory preset
      const remaining = loadScannerPresets(strategyType);
      const fallbackId = remaining[0]?.id || null;
      setActivePresetId(strategyType, fallbackId);
      setActivePresetIdState(fallbackId);
      if (remaining[0]) {
        onApplyPreset(remaining[0]);
      }
      refreshPresets();
      triggerFeedback(`Deleted preset`);
    }
  };

  const factoryList = presets.filter((p) => p.isFactory);
  const customList = presets.filter((p) => !p.isFactory);

  return (
    <div className={`flex flex-col gap-2 p-3 bg-slate-950/80 border border-slate-800/80 rounded-lg backdrop-blur-md ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        {/* Left: Preset Selector & Sync Indicator */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0 text-slate-400 font-mono text-[10px] uppercase font-bold">
            <Bookmark className="w-3.5 h-3.5 text-cyan-400" />
            <span>Preset:</span>
          </div>

          <div className="relative flex-1 min-w-[200px]">
            <select
              value={activePresetId || factoryList[0]?.id || ''}
              onChange={(e) => handleSelectPreset(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 text-white font-mono text-xs px-2.5 py-1.5 rounded focus:border-cyan-500/50 outline-none transition cursor-pointer"
            >
              <optgroup label="⚡ Factory Presets (Institutional Defaults)">
                {factoryList.map((p) => (
                  <option key={p.id} value={p.id}>
                    ⚡ {p.name} ({p.timeframe.toUpperCase()})
                  </option>
                ))}
              </optgroup>

              {customList.length > 0 && (
                <optgroup label="💾 Custom User Presets (Local-First)">
                  {customList.map((p) => (
                    <option key={p.id} value={p.id}>
                      👤 {p.name} ({p.timeframe.toUpperCase()})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Sync Status Badge */}
          <div className="shrink-0">
            {activePreset?.isFactory ? (
              <span
                title="Built-in immutable institutional baseline"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-cyan-950/80 border border-cyan-500/30 text-cyan-300"
              >
                <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
                FACTORY
              </span>
            ) : activePreset?.syncStatus === 'synced' ? (
              <span
                title="Persisted in local storage and synced to cloud"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950/80 border border-emerald-500/30 text-emerald-300"
              >
                <Cloud className="w-2.5 h-2.5 text-emerald-400" />
                SYNCED
              </span>
            ) : (
              <span
                title="Persisted with 0ms latency in local storage"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-indigo-950/80 border border-indigo-500/30 text-indigo-300"
              >
                <HardDrive className="w-2.5 h-2.5 text-indigo-400" />
                LOCAL
              </span>
            )}
          </div>
        </div>

        {/* Right: Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
          {/* Save As New Preset Button */}
          <button
            type="button"
            onClick={() => {
              const suggestedSymbol = presetSymbol || (currentConfig as any).symbol || 'ETHUSDC';
              const suggestedTimeframe = presetTimeframe || activePreset?.timeframe || (currentConfig as any).timeframe || '15m';
              setPresetNameInput(`${suggestedSymbol} ${suggestedTimeframe} - Custom Setup`);
              setIsSaveModalOpen(true);
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-slate-300 hover:text-cyan-300 font-mono text-[10px] font-semibold transition"
            title="Save current parameter sliders as a new preset"
          >
            <BookmarkPlus className="w-3.5 h-3.5 text-cyan-400" />
            <span>Save New</span>
          </button>

          {/* Overwrite / Update (Custom only) */}
          {!activePreset?.isFactory && (
            <>
              <button
                type="button"
                onClick={handleUpdateActivePreset}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/40 text-slate-300 hover:text-emerald-300 font-mono text-[10px] font-semibold transition"
                title="Update active custom preset with current parameters"
              >
                <RotateCw className="w-3.5 h-3.5 text-emerald-400" />
                <span>Update</span>
              </button>

              <button
                type="button"
                onClick={handleDeleteActivePreset}
                className="flex items-center gap-1 px-2 py-1.5 rounded bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-500/40 text-slate-400 hover:text-rose-400 font-mono text-[10px] transition"
                title="Delete this custom preset"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Description & Action Toast */}
      <div className="flex items-center justify-between text-[9.5px] font-mono text-slate-400 px-0.5">
        <span className="truncate max-w-[80%] text-slate-400 italic">
          {activePreset?.description || (activePreset?.isFactory ? 'Factory preset' : 'Custom configuration')}
        </span>
        {actionFeedback && (
          <span className="text-emerald-400 font-bold flex items-center gap-1 animate-pulse shrink-0">
            <Check className="w-3 h-3" />
            {actionFeedback}
          </span>
        )}
      </div>

      {/* Quick 1-Click Factory Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-1 border-t border-slate-900/80">
        <span className="text-[8.5px] uppercase font-mono font-bold text-slate-500 shrink-0">
          Quick Switch:
        </span>
        {factoryList.map((fp) => {
          const isSelected = activePresetId === fp.id;
          return (
            <button
              key={fp.id}
              type="button"
              onClick={() => handleSelectPreset(fp.id)}
              className={`text-[9px] font-mono px-2.5 py-1 rounded-md border transition-all duration-200 shrink-0 cursor-pointer flex items-center gap-1.5 ${
                isSelected
                  ? 'bg-cyan-400 border-cyan-300 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.5)] font-black'
                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
              }`}
            >
              {isSelected && (
                <span className="w-1.5 h-1.5 rounded-full bg-slate-950 shadow-[0_0_4px_rgba(0,0,0,0.5)] shrink-0" />
              )}
              <span>{fp.name.replace(' (Platform Default)', '').replace(' Scalper', '').replace(' Sniper', '')}</span>
            </button>
          );
        })}
      </div>

      {/* Save Preset Modal Dialog */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 w-full max-w-md shadow-2xl flex flex-col gap-4 font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <BookmarkPlus className="w-4 h-4 text-cyan-400" />
                <span>Save Custom Scanner Preset</span>
              </div>
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(false)}
                className="text-slate-500 hover:text-white p-1 rounded hover:bg-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNewPreset} className="flex flex-col gap-3.5">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400">
                  Preset Name *
                </label>
                <input
                  type="text"
                  required
                  value={presetNameInput}
                  onChange={(e) => setPresetNameInput(e.target.value)}
                  placeholder="e.g. ETH 5m High-Conviction Scalp"
                  className="bg-slate-900 border border-slate-800 focus:border-cyan-500 text-white text-xs px-3 py-2 rounded outline-none transition"
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400">
                  Description / Strategy Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={presetDescInput}
                  onChange={(e) => setPresetDescInput(e.target.value)}
                  placeholder="e.g. Strict 65% Delta Dominance with FVG 50% CE limit entry"
                  className="bg-slate-900 border border-slate-800 focus:border-cyan-500 text-white text-xs px-3 py-2 rounded outline-none transition resize-none"
                />
              </div>

              <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800 text-[10px] text-slate-400 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Saves synchronously to local storage with resilient background cloud backup.</span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSaveModalOpen(false)}
                  className="px-3 py-1.5 rounded text-xs text-slate-400 hover:text-white hover:bg-slate-900 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded text-xs bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition flex items-center gap-1.5 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Preset</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
