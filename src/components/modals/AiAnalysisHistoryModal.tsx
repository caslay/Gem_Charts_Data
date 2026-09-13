'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Brain,
  Zap,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Cpu,
  Target,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Layers,
  ArrowRight,
  Database,
  Search,
  Check,
} from 'lucide-react';
import type { AiAnalysisRecord } from '@/lib/aiCascadeEngine';
import { safeParseAiJson } from '@/lib/aiJsonParser';

interface AiAnalysisHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyAnalysis?: (record: AiAnalysisRecord) => void;
}

export default function AiAnalysisHistoryModal({
  isOpen,
  onClose,
  onApplyAnalysis,
}: AiAnalysisHistoryModalProps) {
  const [history, setHistory] = useState<AiAnalysisRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showRawResponse, setShowRawResponse] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/quant-analyze?limit=50', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data)) {
          setHistory(json.data);
          if (json.data.length > 0 && selectedRecordId === null) {
            setSelectedRecordId(json.data[0].id);
          }
        }
      }
    } catch (err) {
      console.warn('[AiAnalysisHistoryModal] Failed to fetch history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
  }, [isOpen]);

  // Filtered list
  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      // Status filter
      if (filterStatus !== 'ALL') {
        if (filterStatus === 'ACTIVE_SETUP' && item.status !== 'ACTIVE_SETUP') return false;
        if (filterStatus === 'NEUTRAL' && item.status !== 'NEUTRAL') return false;
        if (filterStatus === 'INVALIDATED' && item.status !== 'INVALIDATED') return false;
        if (filterStatus === 'FALLBACK' && !item.was_fallback) return false;
      }
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesModel = item.resolved_model.toLowerCase().includes(q);
        const matchesNarrative = item.narrative.toLowerCase().includes(q);
        const matchesBias = item.bias_signal?.toLowerCase().includes(q);
        if (!matchesModel && !matchesNarrative && !matchesBias) return false;
      }
      return true;
    });
  }, [history, filterStatus, searchQuery]);

  const selectedRecord = useMemo(() => {
    const found = filteredHistory.find((h) => h.id === selectedRecordId);
    if (found) return found;
    return filteredHistory[0] || null;
  }, [filteredHistory, selectedRecordId]);

  const parsedDetails = useMemo(() => {
    if (!selectedRecord) return null;
    return safeParseAiJson(selectedRecord.raw_response || selectedRecord.narrative);
  }, [selectedRecord]);

  const telemetryData = useMemo(() => {
    if (!selectedRecord?.telemetry_data) return null;
    if (typeof selectedRecord.telemetry_data === 'string') {
      try {
        return JSON.parse(selectedRecord.telemetry_data);
      } catch {
        return null;
      }
    }
    return selectedRecord.telemetry_data as Record<string, unknown>;
  }, [selectedRecord]);

  if (!isOpen) return null;

  const handleCopyNarrative = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 animate-[fade-in_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-card border border-card-border rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden text-foreground font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Top Header ── */}
        <div className="p-4 border-b border-card-border bg-card/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent/15 border border-accent/30 text-accent">
              <Brain className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-black uppercase tracking-wider text-foreground">
                  AI Institutional Telemetry & Analysis History
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-accent/10 border border-accent/20 text-accent">
                  {history.length} Runs Logged
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground font-sans">
                Chronological audit trail of multi-model cascade executions, quota failovers, and institutional narratives.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchHistory}
              disabled={isLoading}
              className="p-2 rounded-lg bg-card border border-card-border hover:border-accent/40 text-muted-foreground hover:text-foreground transition cursor-pointer disabled:opacity-50"
              title="Refresh History"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-card border border-card-border hover:border-accent/40 text-muted-foreground hover:text-foreground transition cursor-pointer"
              title="Close Modal"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Sub-header: Filters & Search ── */}
        <div className="px-4 py-2.5 border-b border-card-border bg-card/30 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-black uppercase text-muted-foreground mr-1">Filter:</span>
            {(
              [
                { id: 'ALL', label: 'All Evaluations' },
                { id: 'ACTIVE_SETUP', label: 'Active Setups' },
                { id: 'NEUTRAL', label: 'Neutral / Stand Down' },
                { id: 'INVALIDATED', label: 'Invalidated' },
                { id: 'FALLBACK', label: '⚡ Fallback Cascaded' },
              ] as const
            ).map((f) => {
              const active = filterStatus === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilterStatus(f.id)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border ${
                    active
                      ? 'bg-accent text-accent-foreground border-accent shadow-sm'
                      : 'bg-card border-card-border text-muted-foreground hover:text-foreground hover:border-accent/30'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search model, narrative, bias..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-background/50 border border-card-border rounded-lg pl-8 pr-3 py-1 text-xs font-sans text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* ── Main Dual-Pane Body ── */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* Left Pane: Chronological List */}
          <div className="w-full md:w-5/12 lg:w-4/12 border-r border-card-border flex flex-col min-h-0 bg-background/30">
            <div className="p-2 border-b border-card-border bg-card/20 text-[9px] font-black uppercase tracking-widest text-muted-foreground flex justify-between">
              <span>Audit Run Stream</span>
              <span>{filteredHistory.length} Shown</span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-thumb-card-border">
              {isLoading && history.length === 0 ? (
                <div className="h-40 flex flex-col items-center justify-center text-muted-foreground text-xs gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-accent" />
                  <span>Loading telemetry log...</span>
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="h-40 flex flex-col items-center justify-center text-muted-foreground text-xs text-center p-4">
                  <Database className="w-6 h-6 mb-2 text-card-border" />
                  <p className="font-bold uppercase tracking-wider">No AI evaluations match filter</p>
                </div>
              ) : (
                filteredHistory.map((item) => {
                  const isSelected = selectedRecord?.id === item.id;
                  const date = new Date(item.created_at);
                  const timeFormatted = isNaN(date.getTime())
                    ? item.created_at
                    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  const dateFormatted = isNaN(date.getTime())
                    ? ''
                    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });

                  // Status style
                  let statusBadgeClass = 'bg-slate-500/15 border-slate-500/30 text-slate-400';
                  if (item.status === 'ACTIVE_SETUP') {
                    statusBadgeClass = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400';
                  } else if (item.status === 'INVALIDATED') {
                    statusBadgeClass = 'bg-rose-500/15 border-rose-500/40 text-rose-400';
                  } else if (item.status === 'NEUTRAL') {
                    statusBadgeClass = 'bg-amber-500/15 border-amber-500/40 text-amber-400';
                  }

                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedRecordId(item.id)}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer select-none text-left relative ${
                        isSelected
                          ? 'bg-accent/10 border-accent shadow-md shadow-accent/5'
                          : 'bg-card/70 border-card-border hover:border-accent/40 hover:bg-card'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border ${statusBadgeClass}`}
                          >
                            {item.status.replace(/_/g, ' ')}
                          </span>

                          {item.was_fallback && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center gap-0.5 animate-pulse"
                              title={item.fallback_reason || 'Fallback triggered'}
                            >
                              <Zap size={9} />
                              <span>Cascade</span>
                            </span>
                          )}
                        </div>

                        <div className="text-[9px] text-muted-foreground font-mono flex items-center gap-1">
                          <Clock size={10} />
                          <span>{timeFormatted}</span>
                          <span className="text-muted-foreground/60">{dateFormatted}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-black text-foreground truncate flex items-center gap-1">
                          <Cpu size={12} className="text-accent shrink-0" />
                          <span className="truncate">{item.resolved_model}</span>
                        </span>
                        <span className="text-[10px] font-mono font-bold text-accent shrink-0">
                          {item.execution_latency_ms}ms
                        </span>
                      </div>

                      <p className="text-[10.5px] font-sans text-muted-foreground line-clamp-2 leading-relaxed">
                        {item.narrative}
                      </p>

                      <div className="mt-2 flex items-center justify-between pt-1.5 border-t border-card-border/60 text-[9px]">
                        <span className="font-bold text-muted-foreground uppercase">
                          {item.symbol} • {item.timeframe}
                        </span>
                        {item.bias_signal && (
                          <span
                            className={`font-black uppercase tracking-wider ${
                              item.bias_signal.includes('BULL')
                                ? 'text-emerald-400'
                                : item.bias_signal.includes('BEAR')
                                ? 'text-rose-400'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {item.bias_signal}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Pane: Detailed Inspection */}
          <div className="flex-1 flex flex-col min-h-0 bg-card/40 overflow-y-auto p-4 sm:p-6 space-y-4">
            {selectedRecord ? (
              <>
                {/* Header card */}
                <div className="bg-card p-4 rounded-xl border border-card-border shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-black text-accent uppercase tracking-widest">
                        {selectedRecord.symbol} • {selectedRecord.timeframe}
                      </span>
                      <span className="text-[10px] text-muted-foreground">|</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(selectedRecord.created_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${
                          selectedRecord.status === 'ACTIVE_SETUP'
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                            : selectedRecord.status === 'INVALIDATED'
                            ? 'bg-rose-500/20 border-rose-500/50 text-rose-400'
                            : 'bg-slate-500/20 border-slate-500/50 text-slate-300'
                        }`}
                      >
                        {selectedRecord.status.replace(/_/g, ' ')}
                      </span>

                      {selectedRecord.trade_direction && (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${
                            selectedRecord.trade_direction === 'LONG'
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                              : selectedRecord.trade_direction === 'SHORT'
                              ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                              : 'bg-card border-card-border text-muted-foreground'
                          }`}
                        >
                          Direction: {selectedRecord.trade_direction}
                        </span>
                      )}

                      {selectedRecord.bias_signal && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-card border border-card-border text-foreground">
                          Bias: {selectedRecord.bias_signal}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopyNarrative(selectedRecord.id, selectedRecord.narrative)}
                      className="px-3 py-1.5 rounded-lg bg-card border border-card-border hover:border-accent/40 text-xs font-sans font-medium text-foreground transition cursor-pointer flex items-center gap-1.5"
                    >
                      {copiedId === selectedRecord.id ? (
                        <>
                          <Check size={12} className="text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Database size={12} />
                          <span>Copy Narrative</span>
                        </>
                      )}
                    </button>

                    {onApplyAnalysis && (
                      <button
                        onClick={() => {
                          onApplyAnalysis(selectedRecord);
                          onClose();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-xs font-bold uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5 shadow-sm"
                        title="Restore this historical analysis into the active HUD"
                      >
                        <Zap size={12} fill="currentColor" />
                        <span>Load to HUD</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Telemetry Cascade Card ── */}
                <div className="bg-card/70 p-4 rounded-xl border border-card-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5">
                      <Cpu size={12} />
                      Multi-Model Cascade Telemetry
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Latency: <span className="text-foreground font-bold">{selectedRecord.execution_latency_ms}ms</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                    <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                      <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                        Resolved Model
                      </span>
                      <span className="font-bold text-accent truncate block" title={selectedRecord.resolved_model}>
                        {selectedRecord.resolved_model}
                      </span>
                    </div>

                    <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                      <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                        Requested Model
                      </span>
                      <span className="font-bold text-foreground truncate block" title={selectedRecord.requested_model}>
                        {selectedRecord.requested_model}
                      </span>
                    </div>

                    <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                      <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                        Cascade Fallback
                      </span>
                      {selectedRecord.was_fallback ? (
                        <span className="font-bold text-amber-400 flex items-center gap-1">
                          <Zap size={12} />
                          <span>Fallback Triggered</span>
                        </span>
                      ) : (
                        <span className="font-bold text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 size={12} />
                          <span>Direct (Apex Primary)</span>
                        </span>
                      )}
                    </div>

                    <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                      <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                        Total Latency
                      </span>
                      <span className="font-bold text-foreground font-mono">
                        {selectedRecord.execution_latency_ms.toLocaleString()} ms
                      </span>
                    </div>
                  </div>

                  {/* Fallback reason banner */}
                  {selectedRecord.was_fallback && selectedRecord.fallback_reason && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 text-xs text-amber-300 flex items-start gap-2 font-sans">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-400" />
                      <div>
                        <span className="font-bold font-mono text-[10px] uppercase block mb-0.5">
                          Failover Reason Logged
                        </span>
                        <p className="text-[11px] leading-relaxed">{selectedRecord.fallback_reason}</p>
                      </div>
                    </div>
                  )}

                  {/* Attempts step-by-step breakdown */}
                  {Array.isArray(telemetryData?.attempts) &&
                    (telemetryData.attempts as any[]).length > 0 && (
                      <div className="pt-2 border-t border-card-border/60">
                        <span className="text-[9px] font-black uppercase text-muted-foreground block mb-1.5">
                          Execution Sequence Attempts
                        </span>
                        <div className="space-y-1.5">
                          {(telemetryData.attempts as any[]).map((att, idx) => (
                            <div
                              key={idx}
                              className={`p-2 rounded-lg border text-[11px] flex items-center justify-between gap-2 ${
                                att.success
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span className="font-black text-[9px] px-1.5 py-0.5 rounded bg-background/60 text-foreground">
                                  #{idx + 1}
                                </span>
                                <span className="font-bold font-mono truncate">{att.model}</span>
                                {att.error && <span className="text-[10px] italic">({att.error})</span>}
                              </div>
                              <span className="font-mono text-[10px] shrink-0">
                                {att.latency_ms}ms • {att.success ? 'RESOLVED' : 'FAILED'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>

                {/* ── Risk & Execution Parameters (if available) ── */}
                {(selectedRecord.invalidation_level !== null ||
                  selectedRecord.target_1 !== null ||
                  selectedRecord.entry_range_low !== null) && (
                  <div className="bg-card/70 p-4 rounded-xl border border-card-border space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5">
                      <Target size={12} />
                      SOP Execution Parameters
                    </span>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                        <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                          Invalidation (SL)
                        </span>
                        <span className="font-bold text-rose-400 font-mono">
                          {selectedRecord.invalidation_level !== null
                            ? `$${selectedRecord.invalidation_level}`
                            : 'N/A'}
                        </span>
                      </div>

                      <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                        <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                          Entry Range
                        </span>
                        <span className="font-bold text-cyan-400 font-mono">
                          {selectedRecord.entry_range_low !== null && selectedRecord.entry_range_high !== null
                            ? `$${selectedRecord.entry_range_low} - $${selectedRecord.entry_range_high}`
                            : 'N/A'}
                        </span>
                      </div>

                      <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                        <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                          Target 1 (TP1)
                        </span>
                        <span className="font-bold text-emerald-400 font-mono">
                          {selectedRecord.target_1 !== null ? `$${selectedRecord.target_1}` : 'N/A'}
                        </span>
                      </div>

                      <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                        <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                          Target 2 (TP2)
                        </span>
                        <span className="font-bold text-emerald-400 font-mono">
                          {selectedRecord.target_2 !== null ? `$${selectedRecord.target_2}` : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Institutional Narrative ── */}
                <div className="bg-card p-4 rounded-xl border border-card-border space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-accent block">
                    Institutional Narrative Synthesis
                  </span>

                  <div className="text-xs font-sans text-foreground/90 leading-relaxed whitespace-pre-wrap select-text bg-background/40 p-3.5 rounded-lg border border-card-border/60">
                    {selectedRecord.narrative}
                  </div>
                </div>

                {/* ── SOP Report Breakdown (if present) ── */}
                {parsedDetails?.sop_report && (
                  <div className="bg-card p-4 rounded-xl border border-card-border space-y-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-accent block">
                      SOP Framework Breakdown
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {parsedDetails.sop_report.market_context && (
                        <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                          <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                            Market Context
                          </span>
                          <span className="font-medium text-foreground font-sans text-[11px]">
                            {parsedDetails.sop_report.market_context}
                          </span>
                        </div>
                      )}

                      {parsedDetails.sop_report.htf_dol && (
                        <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                          <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                            HTF Draw on Liquidity (DOL)
                          </span>
                          <span className="font-medium text-accent font-sans text-[11px]">
                            {parsedDetails.sop_report.htf_dol}
                          </span>
                        </div>
                      )}

                      {parsedDetails.sop_report.smt_status && (
                        <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                          <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                            SMT Gate Status
                          </span>
                          <span className="font-medium text-foreground font-sans text-[11px]">
                            {parsedDetails.sop_report.smt_status}
                          </span>
                        </div>
                      )}

                      {parsedDetails.sop_report.session_profile && (
                        <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                          <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                            Session Profile & Value Area
                          </span>
                          <span className="font-medium text-foreground font-sans text-[11px]">
                            {parsedDetails.sop_report.session_profile}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Toggle Raw JSON Output ── */}
                <div className="pt-1">
                  <button
                    onClick={() => setShowRawResponse((prev) => !prev)}
                    className="text-[10px] font-black uppercase tracking-wider text-muted-foreground hover:text-foreground transition cursor-pointer flex items-center gap-1"
                  >
                    <ChevronRight
                      size={12}
                      className={`transition-transform duration-200 ${showRawResponse ? 'rotate-90' : ''}`}
                    />
                    <span>{showRawResponse ? 'Hide Raw AI Payload' : 'View Raw AI Payload'}</span>
                  </button>

                  {showRawResponse && (
                    <pre className="mt-2 text-[10px] text-emerald-400 bg-background/90 p-3 rounded-xl border border-card-border overflow-x-auto whitespace-pre-wrap select-text font-mono max-h-60 scrollbar-thin">
                      <code>{selectedRecord.raw_response || selectedRecord.narrative}</code>
                    </pre>
                  )}
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-xs text-center">
                <Brain size={32} className="text-card-border mb-3 animate-pulse" />
                <p className="font-bold uppercase tracking-wider">Select an evaluation from the stream</p>
                <p className="text-[11px] font-sans text-muted-foreground mt-1">
                  Click any entry on the left to inspect its multi-model cascade telemetry and institutional narrative.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
