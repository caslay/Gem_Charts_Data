'use client';

import React, { useState, useEffect } from 'react';
import { X, Brain, Check, AlertTriangle, ShieldAlert, Sparkles, RefreshCw } from 'lucide-react';

interface SopTrackerEntry {
  id: string;
  date: string;
  time: string;
  symbol: string;
  setupType: string;
  htfDol: string;
  smtStatus: string;
  entryRange: [number, number];
  invalidation: number;
  tp1: number;
  tp2: number;
  outcome: 'PENDING' | 'SUCCESS' | 'STOP_OUT' | 'NO_TRIGGER' | 'WRONG_BIAS';
  dolReached: boolean;
  notes: string;
}

interface SelfCorrectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const MISTAKE_CATEGORIES = [
  { id: 'EARLY_ENTRY', label: 'Early Entry (Before 15m MSS Displacement)' },
  { id: 'SMT_FAKEOUT', label: 'SMT Divergence Unconfirmed at Key HTF Level' },
  { id: 'PRE_NEWS_VIOLATION', label: 'Executed inside Pre/Post-News Volatility Window' },
  { id: 'TDO_LEAKAGE', label: 'Used Invalid TDO Anchor instead of PDH/PDL Midpoint' },
  { id: 'DISPLACEMENT_UNCONFIRMED', label: 'MSS Lacked Institutional Taker Volume Sponsorship' },
  { id: 'MISSED_DOL', label: 'Targeted Wrong Liquidity Pool (ERL vs IRL Mismatch)' },
  { id: 'EXECUTION_SLIPPAGE', label: 'Slippage / Bad Risk-Reward Placement' },
  { id: 'OTHER', label: 'Other Quantitative / Narrative Deviation' },
];

export default function SelfCorrectionModal({ isOpen, onClose, onSuccess }: SelfCorrectionModalProps) {
  const [entries, setEntries] = useState<SopTrackerEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [outcome, setOutcome] = useState<'SUCCESS' | 'STOP_OUT' | 'NO_TRIGGER' | 'WRONG_BIAS'>('STOP_OUT');
  const [mistakeCategory, setMistakeCategory] = useState<string>('EARLY_ENTRY');
  const [lessonText, setLessonText] = useState<string>('');
  const [priceActionNotes, setPriceActionNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch setups from tracker JSON on modal open
  useEffect(() => {
    if (!isOpen) return;

    const fetchTrackerData = async () => {
      try {
        const res = await fetch('/directives/ETHUSDC_Daily_Tracker.json');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.entries)) {
            setEntries(data.entries);
            if (data.entries.length > 0) {
              setSelectedId(data.entries[0].id);
            }
          }
        }
      } catch (err) {
        console.warn('[SelfCorrectionModal] Could not fetch tracker JSON:', err);
      }
    };

    fetchTrackerData();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) {
      setStatusMsg({ type: 'error', text: 'Please select a setup to submit self-correction.' });
      return;
    }
    if (!lessonText.trim()) {
      setStatusMsg({ type: 'error', text: 'Please enter a lesson learned for AI prompt memory.' });
      return;
    }

    setIsSubmitting(true);
    setStatusMsg(null);

    try {
      const res = await fetch('/api/self-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setup_id: selectedId,
          outcome,
          mistake_category: mistakeCategory,
          lesson_learned: lessonText.trim(),
          price_action_notes: priceActionNotes.trim()
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setStatusMsg({ type: 'success', text: 'Self-correction saved! AI prompt memory updated.' });
        setTimeout(() => {
          if (onSuccess) onSuccess();
          onClose();
        }, 1200);
      } else {
        setStatusMsg({ type: 'error', text: data.error || 'Failed to save self-correction.' });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Network error submitting correction.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedSetup = entries.find(e => e.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-[fade-in_0.2s_ease-out]">
      <div className="relative w-full max-w-xl bg-card border border-card-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-card-border bg-card-header">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/10 border border-accent/20 text-accent">
              <Brain size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                AI Quant Self-Correction & Learning
                <Sparkles size={14} className="text-accent animate-pulse" />
              </h3>
              <p className="text-[11px] text-muted font-mono">Feedback loop to update Daily Tracker & Gemini historical memory</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted hover:text-foreground hover:bg-white/5 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1 font-sans">
          {statusMsg && (
            <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
              statusMsg.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}>
              {statusMsg.type === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />}
              <span>{statusMsg.text}</span>
            </div>
          )}

          {/* Setup Selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted">Select Target Setup</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full bg-background border border-card-border rounded-xl px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-accent"
            >
              {entries.length === 0 && <option value="">No setups logged yet in Daily Tracker</option>}
              {entries.map((e) => (
                <option key={e.id} value={e.id}>
                  [{e.date} {e.time}] {e.id} — {e.setupType.substring(0, 35)}... ({e.outcome})
                </option>
              ))}
            </select>
          </div>

          {selectedSetup && (
            <div className="p-3 bg-white/5 border border-card-border rounded-xl text-xs space-y-1 font-mono text-muted">
              <div><span className="font-bold text-foreground">HTF DOL:</span> {selectedSetup.htfDol}</div>
              <div><span className="font-bold text-foreground">SMT Status:</span> {selectedSetup.smtStatus}</div>
              <div><span className="font-bold text-foreground">Invalidation:</span> ${selectedSetup.invalidation} | <span className="font-bold text-foreground">Targets:</span> TP1 ${selectedSetup.tp1} / TP2 ${selectedSetup.tp2}</div>
            </div>
          )}

          {/* Outcome Buttons */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted">Trade Outcome</label>
            <div className="grid grid-cols-4 gap-2 text-xs font-bold font-mono">
              {[
                { id: 'SUCCESS', label: 'SUCCESS', color: 'hover:border-emerald-500 active:bg-emerald-500/20' },
                { id: 'STOP_OUT', label: 'STOP OUT', color: 'hover:border-rose-500 active:bg-rose-500/20' },
                { id: 'NO_TRIGGER', label: 'NO TRIGGER', color: 'hover:border-amber-500 active:bg-amber-500/20' },
                { id: 'WRONG_BIAS', label: 'WRONG BIAS', color: 'hover:border-purple-500 active:bg-purple-500/20' }
              ].map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setOutcome(btn.id as any)}
                  className={`py-2 px-1 rounded-xl border text-center transition-all ${
                    outcome === btn.id
                      ? 'bg-accent/20 border-accent text-accent font-black shadow-sm'
                      : 'bg-background border-card-border text-muted hover:text-foreground'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mistake Category */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted">Mistake / Deviation Category</label>
            <select
              value={mistakeCategory}
              onChange={(e) => setMistakeCategory(e.target.value)}
              className="w-full bg-background border border-card-border rounded-xl px-3 py-2 text-xs font-sans text-foreground focus:outline-none focus:border-accent"
            >
              {MISTAKE_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {/* Lesson Learned Textarea */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted">
              Lesson Learned for AI Self-Correction Prompt
            </label>
            <textarea
              rows={3}
              value={lessonText}
              onChange={(e) => setLessonText(e.target.value)}
              placeholder="e.g. Price swept London Low but ETH lacked 15m displacement volume. Do not enter without active institutional sponsorship."
              className="w-full bg-background border border-card-border rounded-xl p-3 text-xs font-mono text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Footer Submit */}
          <div className="pt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-card-border text-xs font-semibold text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs hover:opacity-90 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Saving Lesson...</span>
                </>
              ) : (
                <>
                  <Brain size={14} />
                  <span>Save Correction & Teach AI</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
