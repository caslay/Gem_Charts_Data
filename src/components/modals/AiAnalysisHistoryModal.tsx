'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  Search,
  Check,
  Calendar,
  CalendarDays,
  Pin,
} from 'lucide-react';
import type { AiAnalysisRecord } from '@/lib/aiCascadeEngine';
import {
  getCairoDateString,
  calculateDailyAuditMetrics,
  type EnrichedAiAnalysisRecord,
  type DailyAuditMetrics,
  type SetupReconciledStatus,
} from '@/lib/quantEngine/SetupOutcomeTypes';
import { safeParseAiJson } from '@/lib/aiJsonParser';

interface AiAnalysisHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyAnalysis?: (record: AiAnalysisRecord) => void;
}

type DateFilterMode = 'TODAY' | 'YESTERDAY' | 'CUSTOM' | 'ALL';

const STATUS_FILTERS = [
  { id: 'ALL', label: 'All Evaluations' },
  { id: 'ACTIVE_SETUP', label: '🟢 Active Setups' },
  { id: 'RESOLVED_WINS', label: '🏆 Wins (TP1/TP2)' },
  { id: 'STOPPED_OUT', label: '🔴 Stopped Out' },
  { id: 'EXPIRED_OR_CANCELLED', label: '⚪ Expired / Cancelled' },
  { id: 'NEUTRAL', label: 'Neutral / Stand Down' },
  { id: 'FALLBACK', label: '⚡ Cascade Fallback' },
] as const;

export default function AiAnalysisHistoryModal({
  isOpen,
  onClose,
  onApplyAnalysis,
}: AiAnalysisHistoryModalProps) {
  const [history, setHistory] = useState<EnrichedAiAnalysisRecord[]>([]);
  const [serverMetrics, setServerMetrics] = useState<DailyAuditMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('TODAY');
  const [customDate, setCustomDate] = useState<string>(() => getCairoDateString(new Date()));
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showRawResponse, setShowRawResponse] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [pinnedAnalysisIds, setPinnedAnalysisIds] = useState<Set<number>>(new Set());
  const [isPinning, setIsPinning] = useState(false);

  // ── 1. Fetch History from Server with Date Parameters & Staged Setups ──
  const fetchHistory = useCallback(
    async (mode: DateFilterMode = dateFilterMode, cDate: string = customDate) => {
      setIsLoading(true);
      try {
        // Fetch staged setups in parallel to track pinned states
        fetch('/api/staged-setups?status=PINNED', { cache: 'no-store' })
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            if (json && Array.isArray(json.data)) {
              const ids = new Set<number>();
              json.data.forEach((s: any) => {
                if (s.analysisLogId) ids.add(s.analysisLogId);
              });
              setPinnedAnalysisIds(ids);
            }
          })
          .catch(() => {});

        const params = new URLSearchParams();
        params.set('limit', '100');

        if (mode === 'TODAY') {
          const today = getCairoDateString(new Date());
          params.set('startDate', today);
          params.set('endDate', today);
        } else if (mode === 'YESTERDAY') {
          const yesterday = getCairoDateString(new Date(Date.now() - 24 * 3600 * 1000));
          params.set('startDate', yesterday);
          params.set('endDate', yesterday);
        } else if (mode === 'CUSTOM' && cDate) {
          params.set('startDate', cDate);
          params.set('endDate', cDate);
        }
        // mode === 'ALL': no startDate/endDate params

        const res = await fetch(`/api/quant-analyze?${params.toString()}`, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.data)) {
            setHistory(json.data);
            if (json.summary) {
              setServerMetrics(json.summary);
            }
            if (json.data.length > 0) {
              setSelectedRecordId((prevId) => {
                const stillExists = json.data.some((d: EnrichedAiAnalysisRecord) => d.id === prevId);
                return stillExists && prevId !== null ? prevId : json.data[0].id;
              });
            } else {
              setSelectedRecordId(null);
            }
          }
        }
      } catch (err) {
        console.warn('[AiAnalysisHistoryModal] Failed to fetch history:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [dateFilterMode, customDate]
  );

  useEffect(() => {
    if (isOpen) {
      fetchHistory(dateFilterMode, customDate);
    }
  }, [isOpen, dateFilterMode, customDate, fetchHistory]);

  const handleDateModeChange = (mode: DateFilterMode) => {
    setDateFilterMode(mode);
    fetchHistory(mode, customDate);
  };

  const handleCustomDateChange = (dateVal: string) => {
    setCustomDate(dateVal);
    if (dateFilterMode === 'CUSTOM') {
      fetchHistory('CUSTOM', dateVal);
    }
  };

  // ── 2. Computed Metrics (Fallback / Live Hydration) ──
  const activeMetrics = useMemo<DailyAuditMetrics>(() => {
    if (history.length > 0) {
      return calculateDailyAuditMetrics(history);
    }
    if (serverMetrics) return serverMetrics;
    return {
      totalRuns: 0,
      activeSetups: 0,
      neutralCount: 0,
      invalidatedCount: 0,
      winsCount: 0,
      tp1Count: 0,
      tp2Count: 0,
      lossesCount: 0,
      breakevenCount: 0,
      expiredCount: 0,
      cancelledCount: 0,
      primaryModelCount: 0,
      fallbackCount: 0,
      avgLatencyMs: 0,
    };
  }, [history, serverMetrics]);

  // ── 3. Client Filtered List ──
  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      // Status filter
      if (filterStatus !== 'ALL') {
        const termStatus = (item.reconciled_status || item.status).toUpperCase();
        if (filterStatus === 'ACTIVE_SETUP' && termStatus !== 'ACTIVE_SETUP') return false;
        if (filterStatus === 'RESOLVED_WINS' && termStatus !== 'TP1_HIT' && termStatus !== 'TP2_HIT')
          return false;
        if (filterStatus === 'STOPPED_OUT' && termStatus !== 'STOPPED_OUT') return false;
        if (
          filterStatus === 'EXPIRED_OR_CANCELLED' &&
          termStatus !== 'TTL_EXPIRED' &&
          termStatus !== 'CANCELLED_PRE_FILL'
        )
          return false;
        if (filterStatus === 'NEUTRAL' && termStatus !== 'NEUTRAL' && termStatus !== 'STAND_DOWN')
          return false;
        if (filterStatus === 'FALLBACK' && !item.was_fallback) return false;
      }
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesModel = item.resolved_model.toLowerCase().includes(q);
        const matchesNarrative = item.narrative.toLowerCase().includes(q);
        const matchesBias = item.bias_signal?.toLowerCase().includes(q);
        const matchesStatus = (item.reconciled_status || item.status).toLowerCase().includes(q);
        if (!matchesModel && !matchesNarrative && !matchesBias && !matchesStatus) return false;
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

  const handleCopyNarrative = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleTogglePin = async (record: EnrichedAiAnalysisRecord) => {
    setIsPinning(true);
    try {
      const isCurrentlyPinned = pinnedAnalysisIds.has(record.id);
      if (isCurrentlyPinned) {
        // Find staged record to unpin
        const stagedRes = await fetch('/api/staged-setups?status=PINNED', { cache: 'no-store' });
        if (stagedRes.ok) {
          const json = await stagedRes.json();
          const found = json.data?.find((s: any) => s.analysisLogId === record.id);
          if (found) {
            await fetch('/api/staged-setups', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'DISMISS', id: found.id }),
            });
            setPinnedAnalysisIds((prev) => {
              const next = new Set(prev);
              next.delete(record.id);
              return next;
            });
          }
        }
      } else {
        // Derive entry price
        let entryPrice = 0;
        if (record.entry_range_low != null && record.entry_range_high != null) {
          entryPrice = (Number(record.entry_range_low) + Number(record.entry_range_high)) / 2;
        } else if (record.entry_range_high != null) {
          entryPrice = Number(record.entry_range_high);
        } else if (record.entry_range_low != null) {
          entryPrice = Number(record.entry_range_low);
        }

        const sl = Number(record.invalidation_level || 0);
        const tp1 = Number(record.target_1 || 0);
        const dir = (record.trade_direction || (String(record.bias_signal).includes('BULL') ? 'LONG' : 'SHORT')) as 'LONG' | 'SHORT';

        if (!entryPrice || !sl || !tp1) {
          alert('Cannot pin setup: Missing entry, stop loss, or target parameters.');
          return;
        }

        const res = await fetch('/api/staged-setups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'PIN',
            symbol: record.symbol || 'ETHUSDC',
            direction: dir,
            entryPrice,
            entryRangeLow: record.entry_range_low != null ? Number(record.entry_range_low) : null,
            entryRangeHigh: record.entry_range_high != null ? Number(record.entry_range_high) : null,
            stopLoss: sl,
            target1: tp1,
            target2: record.target_2 != null ? Number(record.target_2) : null,
            target3: record.target_3 != null ? Number(record.target_3) : null,
            sourceReference: `AI Analysis #${record.id}`,
            analysisLogId: record.id,
            notes: record.narrative?.slice(0, 200),
          }),
        });

        if (res.ok) {
          setPinnedAnalysisIds((prev) => new Set(prev).add(record.id));
        }
      }
    } catch (err) {
      console.error('[AiAnalysisHistoryModal] Failed to toggle pin:', err);
    } finally {
      setIsPinning(false);
    }
  };

  const currentDateLabel = useMemo(() => {
    if (dateFilterMode === 'TODAY') return `Today (${getCairoDateString(new Date())} Cairo)`;
    if (dateFilterMode === 'YESTERDAY')
      return `Yesterday (${getCairoDateString(new Date(Date.now() - 24 * 3600 * 1000))} Cairo)`;
    if (dateFilterMode === 'CUSTOM') return `Custom Date (${customDate})`;
    return 'All Recorded History';
  }, [dateFilterMode, customDate]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 animate-[fade-in_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-card border border-card-border rounded-2xl w-full max-w-6xl h-[92vh] flex flex-col shadow-2xl overflow-hidden text-foreground font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Top Header ── */}
        <div className="p-4 border-b border-card-border bg-card/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent/15 border border-accent/30 text-accent">
              <Brain className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black uppercase tracking-wider text-foreground">
                  AI Institutional Telemetry & Analysis History
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-accent/10 border border-accent/20 text-accent">
                  {history.length} Runs Logged
                </span>
                <span className="text-[10px] text-muted-foreground font-sans">• Cairo (UTC+3)</span>
              </div>
              <p className="text-[11px] text-muted-foreground font-sans">
                Dynamic lifecycle badging, post-trade outcome reconciliation, and multi-model cascade telemetry.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchHistory(dateFilterMode, customDate)}
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

        {/* ── Workstream B: Temporal Scoping Date Navigation Ribbon ── */}
        <div className="px-4 py-2 border-b border-card-border bg-card/30 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-black uppercase text-muted-foreground mr-1 flex items-center gap-1">
              <Calendar size={11} className="text-accent" />
              <span>Date Scope:</span>
            </span>

            <button
              onClick={() => handleDateModeChange('TODAY')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border ${
                dateFilterMode === 'TODAY'
                  ? 'bg-accent text-accent-foreground border-accent shadow-sm'
                  : 'bg-card border-card-border text-muted-foreground hover:text-foreground hover:border-accent/30'
              }`}
            >
              Today
            </button>

            <button
              onClick={() => handleDateModeChange('YESTERDAY')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border ${
                dateFilterMode === 'YESTERDAY'
                  ? 'bg-accent text-accent-foreground border-accent shadow-sm'
                  : 'bg-card border-card-border text-muted-foreground hover:text-foreground hover:border-accent/30'
              }`}
            >
              Yesterday
            </button>

            <button
              onClick={() => handleDateModeChange('CUSTOM')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border flex items-center gap-1.5 ${
                dateFilterMode === 'CUSTOM'
                  ? 'bg-accent text-accent-foreground border-accent shadow-sm'
                  : 'bg-card border-card-border text-muted-foreground hover:text-foreground hover:border-accent/30'
              }`}
            >
              <CalendarDays size={11} />
              <span>Custom Date</span>
            </button>

            {dateFilterMode === 'CUSTOM' && (
              <input
                type="date"
                value={customDate}
                onChange={(e) => handleCustomDateChange(e.target.value)}
                className="bg-background/80 border border-card-border text-foreground rounded-lg px-2 py-0.5 text-[11px] font-mono focus:outline-none focus:border-accent"
              />
            )}

            <button
              onClick={() => handleDateModeChange('ALL')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border ${
                dateFilterMode === 'ALL'
                  ? 'bg-accent text-accent-foreground border-accent shadow-sm'
                  : 'bg-card border-card-border text-muted-foreground hover:text-foreground hover:border-accent/30'
              }`}
            >
              All History
            </button>
          </div>

          <div className="text-[10px] text-muted-foreground font-mono">
            Viewing: <span className="text-foreground font-bold">{currentDateLabel}</span>
          </div>
        </div>

        {/* ── Workstream C: Daily Audit Mini-KPI Ribbon ── */}
        <div className="px-4 py-2 border-b border-card-border bg-card/40 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs shrink-0">
          <div className="bg-background/50 p-2 rounded-lg border border-card-border/80 flex flex-col justify-between">
            <span className="text-[8.5px] uppercase font-black tracking-wider text-muted-foreground flex items-center gap-1">
              <Cpu size={10} className="text-accent" />
              <span>Scans Executed</span>
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-sm font-black text-foreground font-mono">{activeMetrics.totalRuns}</span>
              <span className="text-[10px] text-muted-foreground">evaluations</span>
            </div>
            <span className="text-[9px] text-muted-foreground truncate">{currentDateLabel}</span>
          </div>

          <div className="bg-background/50 p-2 rounded-lg border border-card-border/80 flex flex-col justify-between">
            <span className="text-[8.5px] uppercase font-black tracking-wider text-muted-foreground flex items-center gap-1">
              <Target size={10} className="text-emerald-400" />
              <span>Setups Identified</span>
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm font-black text-emerald-400 font-mono">
                {activeMetrics.activeSetups} Active
              </span>
              <span className="text-[10px] text-muted-foreground">/</span>
              <span className="text-xs font-bold text-amber-400 font-mono">
                {activeMetrics.neutralCount} Neutral
              </span>
            </div>
            <span className="text-[9px] text-muted-foreground">
              {activeMetrics.totalRuns > 0
                ? `${((activeMetrics.activeSetups / activeMetrics.totalRuns) * 100).toFixed(0)}% setup yield`
                : '0% setup yield'}
            </span>
          </div>

          <div className="bg-background/50 p-2 rounded-lg border border-card-border/80 flex flex-col justify-between">
            <span className="text-[8.5px] uppercase font-black tracking-wider text-muted-foreground flex items-center gap-1">
              <Zap size={10} className="text-emerald-400" />
              <span>Execution Outcomes</span>
            </span>
            <div className="flex items-center gap-2 mt-0.5 font-mono text-xs font-black">
              <span className="text-emerald-400 flex items-center gap-0.5" title="Wins (TP1 / TP2)">
                🟢 {activeMetrics.winsCount}W
              </span>
              <span className="text-rose-400 flex items-center gap-0.5" title="Stopped Out">
                🔴 {activeMetrics.lossesCount}L
              </span>
              {activeMetrics.breakevenCount > 0 && (
                <span className="text-blue-400 flex items-center gap-0.5" title="Breakeven Scratch">
                  🔵 {activeMetrics.breakevenCount}BE
                </span>
              )}
              <span
                className="text-slate-400 flex items-center gap-0.5"
                title="TTL Expired / Cancelled Pre-Fill"
              >
                ⚪ {activeMetrics.expiredCount + activeMetrics.cancelledCount}X
              </span>
            </div>
            <span className="text-[9px] text-muted-foreground">
              {activeMetrics.winsCount + activeMetrics.lossesCount > 0
                ? `${(
                    (activeMetrics.winsCount / (activeMetrics.winsCount + activeMetrics.lossesCount)) *
                    100
                  ).toFixed(0)}% Win Rate`
                : '0 closed trades'}
            </span>
          </div>

          <div className="bg-background/50 p-2 rounded-lg border border-card-border/80 flex flex-col justify-between">
            <span className="text-[8.5px] uppercase font-black tracking-wider text-muted-foreground flex items-center gap-1">
              <Layers size={10} className="text-accent" />
              <span>Cascade Health</span>
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs font-bold text-emerald-400 font-mono">
                {activeMetrics.primaryModelCount} Apex
              </span>
              {activeMetrics.fallbackCount > 0 ? (
                <span className="text-[10px] font-bold text-amber-300 font-mono bg-amber-500/20 px-1 rounded animate-pulse">
                  ⚡ {activeMetrics.fallbackCount}
                </span>
              ) : (
                <span className="text-[10px] text-emerald-400/80 font-mono">100% Primary</span>
              )}
            </div>
            <span className="text-[9px] text-muted-foreground font-mono">
              Avg Latency: {activeMetrics.avgLatencyMs}ms
            </span>
          </div>
        </div>

        {/* ── Sub-header: Filters & Search ── */}
        <div className="px-4 py-2 border-b border-card-border bg-card/20 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-black uppercase text-muted-foreground mr-1">Filter:</span>
            {STATUS_FILTERS.map((f) => {
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
                <div className="h-48 flex flex-col items-center justify-center text-muted-foreground text-xs text-center p-4">
                  <Clock className="w-8 h-8 mb-2 text-card-border" />
                  <p className="font-bold uppercase tracking-wider text-foreground">
                    No evaluations for this filter
                  </p>
                  <p className="text-[11px] font-sans text-muted-foreground mt-1 max-w-xs">
                    {history.length === 0
                      ? `Zero AI scans recorded for ${currentDateLabel}. Headless scheduler scans on 15m cadence.`
                      : 'No records matched the selected status or search filter.'}
                  </p>
                  {history.length === 0 && dateFilterMode !== 'ALL' && (
                    <button
                      onClick={() => handleDateModeChange('ALL')}
                      className="mt-3 px-3 py-1 rounded-lg bg-accent/20 border border-accent/40 text-accent text-[10px] font-black uppercase tracking-wider hover:bg-accent/30 transition cursor-pointer"
                    >
                      View All History
                    </button>
                  )}
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

                  // Dynamic Outcome Badge
                  const badgeInfo = getOutcomeBadgeInfo(
                    item.reconciled_status || item.status,
                    item.reconciled_outcome?.realized_r
                  );

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
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border ${badgeInfo.className}`}
                          >
                            {badgeInfo.label}
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

                          {pinnedAnalysisIds.has(item.id) && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center gap-0.5"
                              title="Pinned to Copilot Staging Deck"
                            >
                              <Pin size={9} className="fill-current text-amber-400" />
                              <span>Staged</span>
                            </span>
                          )}
                        </div>

                        <div className="text-[9px] text-muted-foreground font-mono flex items-center gap-1 shrink-0">
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
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-black text-accent uppercase tracking-widest">
                        {selectedRecord.symbol} • {selectedRecord.timeframe}
                      </span>
                      <span className="text-[10px] text-muted-foreground">|</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {new Date(selectedRecord.created_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {(() => {
                        const badge = getOutcomeBadgeInfo(
                          selectedRecord.reconciled_status || selectedRecord.status,
                          selectedRecord.reconciled_outcome?.realized_r
                        );
                        return (
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        );
                      })()}

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
                          <CheckCircle2 size={12} />
                          <span>Copy Narrative</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => handleTogglePin(selectedRecord)}
                      disabled={isPinning}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-sans font-medium transition cursor-pointer flex items-center gap-1.5 ${
                        pinnedAnalysisIds.has(selectedRecord.id)
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold shadow-sm'
                          : 'bg-card border-card-border hover:border-amber-500/50 hover:text-amber-300 text-foreground'
                      }`}
                      title={
                        pinnedAnalysisIds.has(selectedRecord.id)
                          ? 'Setup is pinned in Copilot Staging Deck (Click to unpin)'
                          : 'Pin setup to persistent Copilot Staging Deck'
                      }
                    >
                      <Pin size={12} className={pinnedAnalysisIds.has(selectedRecord.id) ? 'fill-current text-amber-400' : ''} />
                      <span>{pinnedAnalysisIds.has(selectedRecord.id) ? 'Pinned to Deck' : 'Pin to Staging'}</span>
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

                {/* ── Workstream A: Outcome Reconciliation Audit Card ── */}
                <div className="bg-card p-4 rounded-xl border border-card-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5">
                      <Shield size={12} />
                      Terminal Execution Outcome & Reconciliation Audit
                    </span>
                    {selectedRecord.reconciled_outcome?.bars_elapsed !== undefined && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        TTL: {selectedRecord.reconciled_outcome.bars_elapsed} /{' '}
                        {selectedRecord.reconciled_outcome.ttl_bars || 12} bars
                      </span>
                    )}
                  </div>

                  {(() => {
                    const badge = getOutcomeBadgeInfo(
                      selectedRecord.reconciled_status || selectedRecord.status,
                      selectedRecord.reconciled_outcome?.realized_r
                    );
                    const outcome = selectedRecord.reconciled_outcome;

                    return (
                      <div
                        className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${badge.className}`}
                      >
                        <div className="flex items-start gap-2.5">
                          <span className="text-base mt-0.5">{badge.icon}</span>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-black text-xs uppercase tracking-wider">
                                {badge.label}
                              </span>
                              {outcome?.is_synthetic_evaluation && (
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-violet-500/20 border border-violet-500/40 text-violet-300">
                                  Synthetic Tape Reconciled
                                </span>
                              )}
                              {outcome?.is_in_flight && (
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/30 text-emerald-300 animate-pulse">
                                  In-Flight Position
                                </span>
                              )}
                              {outcome?.is_armed && (
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-cyan-500/30 text-cyan-300">
                                  Proximity Radar Armed
                                </span>
                              )}
                              {outcome?.matched_trade_id && (
                                <span className="text-[9px] font-mono opacity-70">
                                  Trade: #{outcome.matched_trade_id}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] font-sans opacity-90 mt-1 leading-relaxed">
                              {outcome?.outcome_reason || 'Initial evaluation state preserved.'}
                            </p>
                            {outcome?.synthetic_fill_price && (
                              <div className="text-[10px] font-mono opacity-85 mt-1 flex items-center gap-3">
                                <span>Fill: <b>${outcome.synthetic_fill_price.toFixed(2)}</b></span>
                                {outcome.synthetic_exit_price && (
                                  <span>Exit: <b>${outcome.synthetic_exit_price.toFixed(2)}</b></span>
                                )}
                                {outcome.synthetic_mfe_r !== undefined && outcome.synthetic_mfe_r !== null && (
                                  <span>MFE: <b>+{outcome.synthetic_mfe_r.toFixed(2)}R</b></span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {outcome?.realized_r !== undefined && outcome?.realized_r !== null && (
                          <div className="text-left sm:text-right shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-current/20">
                            <span className="text-[9px] uppercase font-black opacity-80 block">
                              Realized Performance
                            </span>
                            <span
                              className={`text-base font-black font-mono ${
                                outcome.realized_r > 0
                                  ? 'text-emerald-400'
                                  : outcome.realized_r < 0
                                  ? 'text-rose-400'
                                  : 'text-slate-300'
                              }`}
                            >
                              {outcome.realized_r >= 0 ? '+' : ''}
                              {outcome.realized_r.toFixed(2)}R
                            </span>
                            {outcome.realized_pnl !== undefined && outcome.realized_pnl !== null && (
                              <span className="text-[10px] block font-mono opacity-80">
                                (${outcome.realized_pnl.toFixed(2)} USD)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* ── Telemetry Cascade Card ── */}
                <div className="bg-card/70 p-4 rounded-xl border border-card-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5">
                      <Cpu size={12} />
                      Multi-Model Cascade Telemetry
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Latency:{' '}
                      <span className="text-foreground font-bold">{selectedRecord.execution_latency_ms}ms</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                    <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                      <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                        Resolved Model
                      </span>
                      <span
                        className="font-bold text-accent truncate block"
                        title={selectedRecord.resolved_model}
                      >
                        {selectedRecord.resolved_model}
                      </span>
                    </div>

                    <div className="bg-background/60 p-2.5 rounded-lg border border-card-border">
                      <span className="text-[8.5px] uppercase font-black text-muted-foreground block mb-1">
                        Requested Model
                      </span>
                      <span
                        className="font-bold text-foreground truncate block"
                        title={selectedRecord.requested_model}
                      >
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
                <p className="text-[11px] font-sans text-muted-foreground mt-1 max-w-sm">
                  Click any entry on the left to inspect its terminal outcome, multi-model cascade telemetry, and institutional narrative.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge Helper
// ─────────────────────────────────────────────────────────────────────────────

function getOutcomeBadgeInfo(status: string, realizedR?: number | null) {
  const s = status.toUpperCase();

  if (s === 'ACTIVE_SETUP') {
    return {
      label: 'ACTIVE SETUP',
      className: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 animate-pulse',
      icon: '🟢',
    };
  }
  if (s === 'TP1_HIT') {
    const rText = realizedR !== undefined && realizedR !== null ? ` (+${realizedR.toFixed(2)}R)` : ' (TP1)';
    return {
      label: `TP1 HIT${rText}`,
      className: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400',
      icon: '🟢',
    };
  }
  if (s === 'TP2_HIT') {
    const rText = realizedR !== undefined && realizedR !== null ? ` (+${realizedR.toFixed(2)}R)` : ' (TP2)';
    return {
      label: `TP2 HIT${rText}`,
      className: 'bg-teal-500/20 border-teal-500/50 text-teal-300',
      icon: '🏆',
    };
  }
  if (s === 'STOPPED_OUT') {
    const rText = realizedR !== undefined && realizedR !== null ? ` (${realizedR.toFixed(2)}R)` : ' (-1.0R)';
    return {
      label: `STOPPED OUT${rText}`,
      className: 'bg-rose-500/20 border-rose-500/50 text-rose-400',
      icon: '🔴',
    };
  }
  if (s === 'BREAKEVEN') {
    return {
      label: 'BREAKEVEN (0.0R)',
      className: 'bg-blue-500/20 border-blue-500/50 text-blue-300',
      icon: '🔵',
    };
  }
  if (s === 'CANCELLED_PRE_FILL') {
    return {
      label: 'CANCELLED PRE-FILL',
      className: 'bg-amber-500/20 border-amber-500/50 text-amber-300',
      icon: '🟡',
    };
  }
  if (s === 'TTL_EXPIRED') {
    return {
      label: 'TTL EXPIRED',
      className: 'bg-slate-500/20 border-slate-500/40 text-slate-300',
      icon: '⚪',
    };
  }
  if (s === 'STAND_DOWN' || s === 'NEUTRAL') {
    return {
      label: 'STAND DOWN',
      className: 'bg-slate-500/15 border-slate-500/30 text-slate-400',
      icon: '⚪',
    };
  }
  if (s === 'INVALIDATED') {
    return {
      label: 'INVALIDATED',
      className: 'bg-rose-500/15 border-rose-500/30 text-rose-400',
      icon: '🔴',
    };
  }
  return {
    label: s.replace(/_/g, ' '),
    className: 'bg-slate-500/15 border-slate-500/30 text-slate-400',
    icon: '⚪',
  };
}
