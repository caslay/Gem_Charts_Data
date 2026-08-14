'use client';

import React, { useState, useMemo } from 'react';
import {
  X,
  Activity,
  Clock,
  TrendingUp,
  TrendingDown,
  Download,
  Copy,
  CheckCheck,
  Filter,
  Layers,
  ArrowRight,
  ShieldAlert,
  Flame,
  Zap,
  BarChart3,
  Search
} from 'lucide-react';
import type { OrderFlowTimelineSummary, OrderFlowStateRecord, OrderFlowState } from '@/lib/quantEngine/types';
import { getStateMetadata, formatDuration, formatTimeCairo } from '../OrderFlowTimelineRibbon';

interface OrderFlowTimelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  timeline?: OrderFlowTimelineSummary | null;
  livePrice?: number | null;
  symbol?: string;
  isBacktest?: boolean;
}

export default function OrderFlowTimelineModal({
  isOpen,
  onClose,
  timeline,
  livePrice,
  symbol = 'ETHUSDC.p',
  isBacktest = false,
}: OrderFlowTimelineModalProps) {
  const [filterState, setFilterState] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRecord, setSelectedRecord] = useState<OrderFlowStateRecord | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  const activeState = timeline?.active_state || null;
  const history = timeline?.history || [];
  const stats = timeline?.stats;

  // Aggregate all records: history (reversed to newest first for table view) + active
  const allChronological = useMemo(() => {
    const list: OrderFlowStateRecord[] = [];
    const seenEnteredAt = new Set<number>();

    for (const h of history) {
      if (!seenEnteredAt.has(h.entered_at)) {
        seenEnteredAt.add(h.entered_at);
        list.push(h);
      }
    }

    if (activeState) {
      if (seenEnteredAt.has(activeState.entered_at)) {
        const idx = list.findIndex((r) => r.entered_at === activeState.entered_at);
        if (idx !== -1) list[idx] = activeState;
      } else {
        list.push(activeState);
      }
    }
    return list;
  }, [history, activeState]);

  const filteredHistory = useMemo(() => {
    const list = [...allChronological].reverse(); // Newest first for log table
    return list.filter((item) => {
      if (filterState !== 'ALL' && item.state !== filterState) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const stateName = item.state.toLowerCase();
        const priceStr = `${item.entry_price} ${item.exit_price ?? ''}`;
        return stateName.includes(q) || priceStr.includes(q);
      }
      return true;
    });
  }, [allChronological, filterState, searchQuery]);

  // Regime distribution calculations
  const distribution = useMemo(() => {
    const buySec = stats?.time_in_buy_sponsorship_sec || 0;
    const shortSec = stats?.time_in_short_sponsorship_sec || 0;
    const liqSec = stats?.time_in_liquidation_sec || 0;
    const covSec = stats?.time_in_covering_sec || 0;
    const neutSec = stats?.time_in_neutral_sec || 0;
    const totalSec = buySec + shortSec + liqSec + covSec + neutSec || 1;

    return {
      buyPct: parseFloat(((buySec / totalSec) * 100).toFixed(1)),
      shortPct: parseFloat(((shortSec / totalSec) * 100).toFixed(1)),
      liqPct: parseFloat(((liqSec / totalSec) * 100).toFixed(1)),
      covPct: parseFloat(((covSec / totalSec) * 100).toFixed(1)),
      neutPct: parseFloat(((neutSec / totalSec) * 100).toFixed(1)),
      totalSec,
    };
  }, [stats]);

  if (!isOpen) return null;

  const handleCopyJson = async () => {
    try {
      const payload = {
        symbol,
        exported_at: new Date().toISOString(),
        stats,
        active_state: activeState,
        history,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (e) {
      console.error('Failed to copy order flow json:', e);
    }
  };

  const handleDownloadCsv = () => {
    const headers = ['ID', 'Symbol', 'State', 'Entered_At_UTC', 'Entered_At_Cairo', 'Exited_At_Cairo', 'Duration_Sec', 'Entry_Price', 'Exit_Price', 'Price_Change', 'Price_Change_Pct', 'Volume_Delta'];
    const rows = allChronological.map((r) => [
      r.id || '',
      r.symbol || symbol,
      r.state,
      new Date(r.entered_at).toISOString(),
      formatTimeCairo(r.entered_at),
      r.exited_at ? formatTimeCairo(r.exited_at) : 'LIVE_ACTIVE',
      r.duration_seconds || 0,
      r.entry_price,
      r.exit_price ?? (livePrice ?? r.entry_price),
      r.price_change ?? 0,
      r.price_change_pct ?? 0,
      r.metadata?.volume_delta ?? 0,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `order_flow_timeline_${symbol}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeMeta = activeState ? getStateMetadata(activeState.state) : getStateMetadata('NEUTRAL');

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6 bg-background/80 backdrop-blur-md animate-in fade-in duration-150">
      {/* Modal Container */}
      <div className="w-full max-w-6xl max-h-[92vh] flex flex-col bg-[#0d0e12]/95 border border-card-border rounded-2xl shadow-2xl overflow-hidden font-mono text-xs select-none">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-card-border bg-card/45 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/15 border border-accent/30 text-accent">
              <Activity className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black uppercase tracking-wider text-foreground">
                  Order Flow State Tracker & Chronological Timeline
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-card border border-card-border text-[10px] font-mono font-bold text-accent">
                  {symbol}
                </span>
                {isBacktest && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-mono font-bold">
                    REPLAY MODE
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Institutional state-machine monitoring Open Interest momentum, taker absorption, and price sponsorship transitions.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyJson}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card hover:bg-accent/15 border border-card-border hover:border-accent text-muted hover:text-accent transition-all cursor-pointer"
              title="Copy Timeline JSON"
            >
              {copyStatus === 'copied' ? <CheckCheck size={13} className="text-emerald-400" /> : <Copy size={13} />}
              <span className="text-[10px] font-bold uppercase">{copyStatus === 'copied' ? 'COPIED' : 'JSON'}</span>
            </button>

            <button
              onClick={handleDownloadCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card hover:bg-accent/15 border border-card-border hover:border-accent text-muted hover:text-accent transition-all cursor-pointer"
              title="Download CSV Log"
            >
              <Download size={13} />
              <span className="text-[10px] font-bold uppercase">CSV</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-card border border-transparent hover:border-card-border transition-all cursor-pointer ml-1"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin scrollbar-thumb-card-border">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Active State Card */}
            <div className={`p-3 rounded-xl border ${activeMeta.colorBorder} ${activeMeta.colorBgMuted} flex flex-col justify-between`}>
              <div className="flex items-center justify-between text-[10px] text-muted font-bold">
                <span>ACTIVE REGIME</span>
                <span className={`w-2 h-2 rounded-full ${activeMeta.colorDot} animate-ping`} />
              </div>
              <div className="mt-1">
                <span className={`text-xs font-black uppercase block ${activeMeta.colorText}`}>
                  {activeMeta.label}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatDuration(activeState?.duration_seconds)} active
                </span>
              </div>
            </div>

            {/* Buy Sponsorship */}
            <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 flex flex-col justify-between">
              <span className="text-[10px] text-emerald-400 font-bold uppercase">BUY SPONSORSHIP</span>
              <div className="mt-1">
                <span className="text-base font-black text-emerald-400">{distribution.buyPct}%</span>
                <span className="text-[10px] text-muted block">{formatDuration(stats?.time_in_buy_sponsorship_sec)}</span>
              </div>
            </div>

            {/* Short Sponsorship */}
            <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/5 flex flex-col justify-between">
              <span className="text-[10px] text-rose-400 font-bold uppercase">SHORT SPONSORSHIP</span>
              <div className="mt-1">
                <span className="text-base font-black text-rose-400">{distribution.shortPct}%</span>
                <span className="text-[10px] text-muted block">{formatDuration(stats?.time_in_short_sponsorship_sec)}</span>
              </div>
            </div>

            {/* Long Liquidation */}
            <div className="p-3 rounded-xl border border-sky-500/30 bg-sky-500/5 flex flex-col justify-between">
              <span className="text-[10px] text-sky-400 font-bold uppercase">LONG LIQUIDATION</span>
              <div className="mt-1">
                <span className="text-base font-black text-sky-400">{distribution.liqPct}%</span>
                <span className="text-[10px] text-muted block">{formatDuration(stats?.time_in_liquidation_sec)}</span>
              </div>
            </div>

            {/* Short Covering */}
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 flex flex-col justify-between">
              <span className="text-[10px] text-amber-400 font-bold uppercase">SHORT COVERING</span>
              <div className="mt-1">
                <span className="text-base font-black text-amber-400">{distribution.covPct}%</span>
                <span className="text-[10px] text-muted block">{formatDuration(stats?.time_in_covering_sec)}</span>
              </div>
            </div>

            {/* Avg Persistence */}
            <div className="p-3 rounded-xl border border-card-border bg-card/30 flex flex-col justify-between">
              <span className="text-[10px] text-muted font-bold uppercase">AVG STATE DURATION</span>
              <div className="mt-1">
                <span className="text-base font-black text-foreground">{formatDuration(stats?.avg_state_duration_sec)}</span>
                <span className="text-[10px] text-muted block">{allChronological.length} total transitions</span>
              </div>
            </div>
          </div>

          {/* Regime Distribution Progress Bar */}
          <div className="bg-card/30 border border-card-border rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold">
              <span className="text-foreground uppercase tracking-wider">REGIME VOLUME & TIME DISTRIBUTION</span>
              <span className="text-muted text-[10px]">Total Monitored Time: {formatDuration(distribution.totalSec)}</span>
            </div>

            <div className="w-full h-3 rounded-full overflow-hidden flex bg-background border border-card-border/60">
              <div style={{ width: `${distribution.buyPct}%` }} className="bg-emerald-500 transition-all" title={`Buy Sponsorship: ${distribution.buyPct}%`} />
              <div style={{ width: `${distribution.shortPct}%` }} className="bg-rose-500 transition-all" title={`Short Sponsorship: ${distribution.shortPct}%`} />
              <div style={{ width: `${distribution.liqPct}%` }} className="bg-sky-500 transition-all" title={`Long Liquidation: ${distribution.liqPct}%`} />
              <div style={{ width: `${distribution.covPct}%` }} className="bg-amber-500 transition-all" title={`Short Covering: ${distribution.covPct}%`} />
              <div style={{ width: `${distribution.neutPct}%` }} className="bg-slate-600 transition-all" title={`Neutral/Flat: ${distribution.neutPct}%`} />
            </div>

            <div className="flex flex-wrap items-center gap-4 text-[10px] pt-1">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                <span className="text-muted">Buy Sponsorship ({distribution.buyPct}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                <span className="text-muted">Short Sponsorship ({distribution.shortPct}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-500" />
                <span className="text-muted">Long Liquidation ({distribution.liqPct}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                <span className="text-muted">Short Covering ({distribution.covPct}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-slate-600" />
                <span className="text-muted">Neutral/Flat ({distribution.neutPct}%)</span>
              </div>
            </div>
          </div>

          {/* Chronological Ribbon Strip Visualizer */}
          <div className="bg-card/30 border border-card-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-foreground font-black uppercase tracking-wider text-[11px]">
                CHRONOLOGICAL TRANSITIONS STRIP (OLDEST ➔ NEWEST)
              </span>
              <span className="text-muted text-[10px]">Click any block to inspect details</span>
            </div>

            <div className="w-full h-8 rounded-lg overflow-hidden flex gap-[2px] bg-background/80 p-1 border border-card-border/60 shadow-inner">
              {allChronological.map((seg, idx) => {
                const meta = getStateMetadata(seg.state);
                const isSelected = selectedRecord?.entered_at === seg.entered_at;
                const isLatest = idx === allChronological.length - 1;

                return (
                  <button
                    key={`strip-seg-${seg.id || seg.entered_at}-${idx}`}
                    type="button"
                    style={{ flex: Math.max(1, seg.duration_seconds || 60) }}
                    onClick={() => setSelectedRecord(seg)}
                    className={`
                      h-full rounded-sm transition-all cursor-pointer relative group
                      ${meta.colorBg} hover:brightness-125
                      ${isSelected ? 'ring-2 ring-accent scale-y-105 z-10 brightness-125' : 'opacity-90'}
                      ${isLatest ? `animate-pulse ${meta.colorGlow}` : ''}
                    `}
                    title={`${meta.label} | ${formatDuration(seg.duration_seconds)} | Entry: $${seg.entry_price}`}
                  />
                );
              })}
            </div>

            {/* Selected Record Detail Panel */}
            {selectedRecord && (
              <div className="bg-background/80 border border-card-border rounded-xl p-3.5 space-y-2 animate-in fade-in duration-100">
                {(() => {
                  const meta = getStateMetadata(selectedRecord.state);
                  const isUp = (selectedRecord.price_change ?? 0) >= 0;
                  return (
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[11px]">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-black text-xs uppercase ${meta.colorText}`}>{meta.label}</span>
                          <span className="text-muted-foreground text-[10px]">({meta.description})</span>
                        </div>
                        <div className="flex items-center gap-3 text-muted text-[10px]">
                          <span>ENTERED: <strong className="text-foreground font-mono">{formatTimeCairo(selectedRecord.entered_at)}</strong></span>
                          <span>EXITED: <strong className="text-foreground font-mono">{selectedRecord.exited_at ? formatTimeCairo(selectedRecord.exited_at) : 'LIVE ACTIVE'}</strong></span>
                          <span>DURATION: <strong className="text-foreground font-mono">{formatDuration(selectedRecord.duration_seconds)}</strong></span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 border-t sm:border-t-0 sm:border-l border-card-border pt-2 sm:pt-0 sm:pl-4">
                        <div>
                          <span className="text-muted text-[9px] uppercase block font-bold">PRICE FROM ➔ TO</span>
                          <span className="font-mono font-bold text-foreground">
                            ${selectedRecord.entry_price.toFixed(2)} ➔ ${selectedRecord.exit_price?.toFixed(2) ?? (livePrice?.toFixed(2) || '---')}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted text-[9px] uppercase block font-bold">PRICE DELTA</span>
                          <span className={`font-mono font-black ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isUp ? '+' : ''}{selectedRecord.price_change?.toFixed(2) ?? '0.00'} ({isUp ? '+' : ''}{selectedRecord.price_change_pct?.toFixed(2) ?? '0.00'}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Transition Log Table */}
          <div className="bg-card/30 border border-card-border rounded-xl overflow-hidden space-y-0">
            {/* Table Filter & Search Controls */}
            <div className="p-3.5 border-b border-card-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-card/20">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-muted font-bold text-[10px] uppercase flex items-center gap-1 mr-1">
                  <Filter size={11} /> FILTER:
                </span>
                {['ALL', 'RISING_WITH_PRICE', 'RISING_AGAINST_PRICE', 'FALLING_WITH_PRICE', 'FALLING_AGAINST_PRICE', 'FLAT'].map((st) => {
                  const isSelected = filterState === st;
                  return (
                    <button
                      key={st}
                      onClick={() => setFilterState(st)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-accent text-accent-foreground shadow-sm'
                          : 'bg-card border border-card-border text-muted hover:text-foreground hover:border-accent'
                      }`}
                    >
                      {st === 'ALL' ? 'ALL REGIMES' : getStateMetadata(st).shortLabel}
                    </button>
                  );
                })}
              </div>

              <div className="relative w-full sm:w-48">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search transitions..."
                  className="w-full bg-background border border-card-border rounded-md pl-7 pr-2.5 py-1 text-[10px] text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* Table */}
            <div className="max-h-72 overflow-y-auto scrollbar-thin scrollbar-thumb-card-border">
              <table className="w-full text-left border-collapse font-mono text-[11px]">
                <thead className="bg-card/50 text-muted text-[9px] uppercase tracking-wider sticky top-0 z-10 border-b border-card-border">
                  <tr>
                    <th className="py-2.5 px-3 font-bold">STATE REGIME</th>
                    <th className="py-2.5 px-3 font-bold">START (CAIRO UTC+3)</th>
                    <th className="py-2.5 px-3 font-bold">END</th>
                    <th className="py-2.5 px-3 font-bold">DURATION</th>
                    <th className="py-2.5 px-3 font-bold">ENTRY</th>
                    <th className="py-2.5 px-3 font-bold">EXIT</th>
                    <th className="py-2.5 px-3 font-bold">DELTA ($ / %)</th>
                    <th className="py-2.5 px-3 font-bold text-right">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/50">
                  {filteredHistory.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted">
                        No state transitions match the active filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredHistory.map((item, idx) => {
                      const meta = getStateMetadata(item.state);
                      const isLiveActive = item.exited_at === null;
                      const pDiff = item.price_change ?? ((item.exit_price ?? (livePrice ?? item.entry_price)) - item.entry_price);
                      const pPct = item.price_change_pct ?? (((pDiff) / item.entry_price) * 100);
                      const isUp = pDiff >= 0;

                      return (
                        <tr
                          key={`row-${item.id || item.entered_at}-${idx}`}
                          onClick={() => setSelectedRecord(item)}
                          className="hover:bg-card/40 transition-colors cursor-pointer"
                        >
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${meta.colorDot} ${isLiveActive ? 'animate-ping' : ''}`} />
                              <span className={`font-black uppercase text-[10px] ${meta.colorText}`}>
                                {meta.label}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-muted">{formatTimeCairo(item.entered_at)}</td>
                          <td className="py-2 px-3 text-muted">{item.exited_at ? formatTimeCairo(item.exited_at) : 'LIVE ACTIVE'}</td>
                          <td className="py-2 px-3 font-bold text-foreground">{formatDuration(item.duration_seconds)}</td>
                          <td className="py-2 px-3 font-mono">${item.entry_price.toFixed(2)}</td>
                          <td className="py-2 px-3 font-mono">
                            {item.exit_price !== null ? `$${item.exit_price.toFixed(2)}` : (livePrice ? `$${livePrice.toFixed(2)}` : '---')}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`font-black ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {isUp ? '+' : ''}{pDiff.toFixed(2)} ({isUp ? '+' : ''}{pPct.toFixed(2)}%)
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            {isLiveActive ? (
                              <span className="text-[9px] font-black uppercase text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                ACTIVE
                              </span>
                            ) : (
                              <span className="text-[9px] text-muted">CLOSED</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
