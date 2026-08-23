"use client";

import React, { useState, useCallback, useMemo, memo, useRef, useEffect } from "react";
import { Play, Pause, XCircle, Trash2, Loader2, RefreshCw, AlertTriangle, Download, Trash } from "lucide-react";
import { useMarketDataContext, useMarketDataLiveContext } from "@/context/MarketDataContext";
import { useSessionJournalStore } from "@/lib/quantEngine/sessionJournalStore";

export interface TradeRecord {
  id: string;
  timestamp: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entry_price: string | number;
  stop_loss: string | number;
  take_profit: string | number;
  status: "OPEN" | "CLOSED" | "PAUSED";
  strategy_name: string;
  ai_narrative_summary: string | null;
  created_at: string;
  position_size?: string | number; // Added for V8.3 P&L calculations
  realized_pnl?: string | number;
  roi?: string | number;
  risk_amount_usd?: string | number;
  opened_at?: string;
  closed_at?: string;
}

interface JournalTableProps {
  initialTrades: TradeRecord[];
  initialAccount?: {
    current_balance: string | number;
    initial_capital: string | number;
    max_risk_limit_pct: string | number;
  };
  isBacktest?: boolean;
  backtestLivePrice?: number | null;
  backtestCandleTime?: number | null;
}

// ── ACTIONS CELL SUB-COMPONENT (Memoized Shared UI) ──────────────────────
const ActionsCell = memo(function ActionsCell({
  trade,
  isLoading,
  actionLoadingId,
  isDeletingConfirm,
  handleToggleStatus,
  handleClosePosition,
  setDeleteConfirmId,
  handleDeleteTrade
}: {
  trade: TradeRecord;
  isLoading: boolean;
  actionLoadingId: string | null;
  isDeletingConfirm: boolean;
  handleToggleStatus: (trade: TradeRecord) => void;
  handleClosePosition: (id: string) => void;
  setDeleteConfirmId: (id: string | null) => void;
  handleDeleteTrade: (id: string) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      {isDeletingConfirm ? (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 p-1.5 rounded-lg animate-fade-in">
          <span className="text-[9px] font-bold uppercase text-rose-500 flex items-center gap-1 font-sans">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            Purge Row?
          </span>
          <button
            onClick={() => handleDeleteTrade(trade.id)}
            disabled={isLoading}
            className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white font-mono text-[9px] font-bold uppercase tracking-wider cursor-pointer border-none rounded"
          >
            {isLoading && actionLoadingId === `${trade.id}-delete` ? "Purging..." : "Yes"}
          </button>
          <button
            onClick={() => setDeleteConfirmId(null)}
            disabled={isLoading}
            className="px-2 py-0.5 bg-card hover:bg-card-border/50 text-muted border border-card-border font-mono text-[9px] font-bold uppercase tracking-wider cursor-pointer rounded"
          >
            No
          </button>
        </div>
      ) : (
        <>
          {trade.status !== "CLOSED" && (
            <button
              onClick={() => handleToggleStatus(trade)}
              disabled={isLoading}
              className={`p-1.5 border rounded-lg transition-all cursor-pointer ${
                trade.status === "PAUSED"
                  ? "bg-emerald-500/5 border-card-border hover:border-emerald-500 text-muted hover:text-emerald-500"
                  : "bg-amber-500/5 border-card-border hover:border-amber-500 text-muted hover:text-amber-500"
              }`}
              title={trade.status === "PAUSED" ? "Reactivate Position" : "Pause Tracking"}
            >
              {isLoading && actionLoadingId === `${trade.id}-toggle` ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : trade.status === "PAUSED" ? (
                <Play className="w-3.5 h-3.5" />
              ) : (
                <Pause className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {trade.status !== "CLOSED" && (
            <button
              onClick={() => handleClosePosition(trade.id)}
              disabled={isLoading}
              className="p-1.5 bg-card border border-card-border hover:border-rose-500 text-muted hover:text-rose-500 rounded-lg transition-all cursor-pointer"
              title="Manually Close Trade"
            >
              {isLoading && actionLoadingId === `${trade.id}-close` ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <XCircle className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          <button
            onClick={() => setDeleteConfirmId(trade.id)}
            disabled={isLoading}
            className="p-1.5 bg-card border border-card-border hover:border-rose-500/50 hover:bg-rose-500/10 text-muted hover:text-rose-500 rounded-lg transition-all cursor-pointer"
            title="Purge Record"
          >
            {isLoading && actionLoadingId === `${trade.id}-delete` ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
          </button>
        </>
      )}
    </div>
  );
});

// ── CLOSED POSITION ROW (100% Static - Immune to live WS ticks) ────────────
const ClosedTradeRow = memo(function ClosedTradeRow({
  trade,
  isLoading,
  actionLoadingId,
  isDeletingConfirm,
  handleToggleStatus,
  handleClosePosition,
  setDeleteConfirmId,
  handleDeleteTrade,
  formatDate,
  isSelected = false,
  onToggleSelect
}: {
  trade: TradeRecord;
  isLoading: boolean;
  actionLoadingId: string | null;
  isDeletingConfirm: boolean;
  handleToggleStatus: (trade: TradeRecord) => void;
  handleClosePosition: (id: string) => void;
  setDeleteConfirmId: (id: string | null) => void;
  handleDeleteTrade: (id: string) => void;
  formatDate: (date: string) => string;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const realizedPnL = (trade as any).realized_pnl !== undefined && (trade as any).realized_pnl !== null
    ? parseFloat(String((trade as any).realized_pnl))
    : null;

  const roi = (trade as any).roi !== undefined && (trade as any).roi !== null
    ? parseFloat(String((trade as any).roi))
    : null;

  const positionSize = trade.position_size !== undefined && trade.position_size !== null
    ? parseFloat(String(trade.position_size))
    : 1.0;

  const pnlSign = realizedPnL !== null && realizedPnL > 0 ? "+" : "";
  const roiSign = roi !== null && roi > 0 ? "+" : "";

  const pnlColorClass = realizedPnL !== null
    ? realizedPnL > 0
      ? "text-emerald-500 font-bold"
      : realizedPnL < 0
      ? "text-rose-500 font-bold"
      : "text-muted"
    : "text-muted";

  const roiColorClass = roi !== null
    ? roi > 0
      ? "text-emerald-500 font-bold"
      : roi < 0
      ? "text-rose-500 font-bold"
      : "text-muted"
    : "text-muted";

  return (
    <tr className={`border-b border-card-border/50 transition-colors ${isSelected ? "bg-accent/15 hover:bg-accent/20" : "hover:bg-card/25"}`}>
      <td className="py-4 px-3 text-center">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect && onToggleSelect(trade.id)}
          className="w-3.5 h-3.5 accent-accent cursor-pointer rounded"
        />
      </td>
      <td className="py-4 px-4 md:px-6 font-mono text-[11px] text-muted leading-relaxed">
        <div>O: {formatDate(trade.opened_at || trade.created_at || trade.timestamp)}</div>
        {trade.closed_at && <div className="text-[9px] text-[#ffb4ab]">C: {formatDate(trade.closed_at)}</div>}
      </td>

      <td className="py-4 px-4 font-sans font-bold text-title">
        <div>{trade.symbol}</div>
        <div className="text-[9px] text-muted font-normal tracking-tight">
          Size: {positionSize.toFixed(4)} {trade.symbol.replace('.p', '').split('USD')[0] || 'Units'}
        </div>
      </td>

      <td className="py-4 px-4">
        <span
          className={`px-2 py-0.5 border font-sans text-[9px] font-bold uppercase tracking-wider rounded-md ${
            trade.direction === "LONG"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
              : "bg-rose-500/10 border-rose-500/20 text-rose-500"
          }`}
        >
          {trade.direction}
        </span>
      </td>

      <td className="py-4 px-4 text-right font-mono font-medium text-title">
        {parseFloat(String(trade.entry_price)).toFixed(2)}
      </td>

      <td className="py-4 px-4 text-right font-mono text-rose-500">
        <div>{parseFloat(String(trade.stop_loss)).toFixed(2)}</div>
        <div className="text-[9px] text-rose-500/70 font-sans font-medium">
          Risk: ${(trade as any).risk_amount_usd ? parseFloat(String((trade as any).risk_amount_usd)).toFixed(2) : (Math.abs(parseFloat(String(trade.entry_price)) - parseFloat(String(trade.stop_loss))) * positionSize).toFixed(2)}
        </div>
      </td>

      <td className="py-4 px-4 text-right font-mono text-emerald-500">
        {parseFloat(String(trade.take_profit)).toFixed(2)}
      </td>

      {/* Realized P&L Column */}
      <td className={`py-4 px-4 text-right font-mono ${pnlColorClass}`}>
        {realizedPnL !== null ? `${pnlSign}${realizedPnL.toFixed(2)}` : "-"}
      </td>

      {/* ROI % Column */}
      <td className={`py-4 px-4 text-right font-mono ${roiColorClass}`}>
        {roi !== null ? `${roiSign}${roi.toFixed(2)}%` : "-"}
      </td>

      <td className="py-4 px-4 font-mono text-[11px] text-muted max-w-[150px] truncate">
        {trade.strategy_name}
      </td>

      <td className="py-4 px-4">
        <span className="px-2 py-0.5 border border-card-border bg-card text-muted font-sans text-[9px] font-bold uppercase tracking-wider rounded-md leading-none flex items-center gap-1.5 w-fit">
          {trade.status}
        </span>
      </td>

      <td className="py-3 px-4 md:px-6">
        <ActionsCell
          trade={trade}
          isLoading={isLoading}
          actionLoadingId={actionLoadingId}
          isDeletingConfirm={isDeletingConfirm}
          handleToggleStatus={handleToggleStatus}
          handleClosePosition={handleClosePosition}
          setDeleteConfirmId={setDeleteConfirmId}
          handleDeleteTrade={handleDeleteTrade}
        />
      </td>
    </tr>
  );
});

// ── ACTIVE POSITION ROW (Scoped websocket listener for OPEN/PAUSED) ────────
const ActiveTradeRow = memo(function ActiveTradeRow({
  trade,
  isLoading,
  actionLoadingId,
  isDeletingConfirm,
  handleToggleStatus,
  handleClosePosition,
  setDeleteConfirmId,
  handleDeleteTrade,
  formatDate,
  isBacktest = false,
  backtestLivePrice,
  backtestCandleTime,
  isSelected = false,
  onToggleSelect
}: {
  trade: TradeRecord;
  isLoading: boolean;
  actionLoadingId: string | null;
  isDeletingConfirm: boolean;
  handleToggleStatus: (trade: TradeRecord) => void;
  handleClosePosition: (id: string, exitPrice?: number | null) => void;
  setDeleteConfirmId: (id: string | null) => void;
  handleDeleteTrade: (id: string) => void;
  formatDate: (date: string) => string;
  isBacktest?: boolean;
  backtestLivePrice?: number | null;
  backtestCandleTime?: number | null;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const liveContext = useMarketDataLiveContext();
  const livePrice = isBacktest ? (backtestLivePrice ?? null) : liveContext.livePrice;

  // Resolve position multiplier
  const positionSize = trade.position_size !== undefined && trade.position_size !== null
    ? parseFloat(String(trade.position_size))
    : 1.0;

  const entryPrice = parseFloat(String(trade.entry_price));
  const takeProfit = parseFloat(String(trade.take_profit));
  const stopLoss = parseFloat(String(trade.stop_loss));

  // Determine if Take Profit or Stop Loss has been touched or breached
  let isTpHit = false;
  let isSlHit = false;

  if (livePrice && trade.status === "OPEN") {
    if (trade.direction === "LONG") {
      isTpHit = livePrice >= takeProfit;
      isSlHit = livePrice <= stopLoss;
    } else if (trade.direction === "SHORT") {
      isTpHit = livePrice <= takeProfit;
      isSlHit = livePrice >= stopLoss;
    }
  }

  // P&L and ROI percentage move calculations
  let unrealizedPnL = 0;
  let roiPercentage = 0;

  if (livePrice) {
    unrealizedPnL = trade.direction === "LONG"
      ? (livePrice - entryPrice) * positionSize
      : (entryPrice - livePrice) * positionSize;

    const rawRiskAmountUsd = (trade as any).risk_amount_usd !== undefined && (trade as any).risk_amount_usd !== null ? parseFloat(String((trade as any).risk_amount_usd)) : 0;
    const riskAmountUsd = rawRiskAmountUsd > 0 ? rawRiskAmountUsd : Math.abs(entryPrice - stopLoss) * positionSize;
    roiPercentage = riskAmountUsd > 0 ? (unrealizedPnL / riskAmountUsd) * 100 : 0;
  }

  // Handle active price updates and pulse animation
  const prevPriceRef = useRef<number | null>(null);
  const [pulseClass, setPulseClass] = useState("");

  useEffect(() => {
    if (livePrice !== null && livePrice !== prevPriceRef.current) {
      const isUp = prevPriceRef.current !== null && livePrice > prevPriceRef.current;
      setPulseClass(isUp ? "animate-tick-green" : "animate-tick-red");
      prevPriceRef.current = livePrice;

      const timer = setTimeout(() => setPulseClass(""), 350);
      return () => clearTimeout(timer);
    }
  }, [livePrice]);

  // V8.5 — Automated exit trigger: hard-wire TP/SL breach → handleClosePosition
  // The hasAutoClosedRef prevents double-firing after the state update re-render.
  const hasAutoClosedRef = useRef(false);
  useEffect(() => {
    if (isBacktest) return; // Guardrail 2: The Backtest replay engine page handles its own auto-closure
    if (hasAutoClosedRef.current) return;
    if (trade.status !== "OPEN") return;
    if (!livePrice) return;

    if (isTpHit || isSlHit) {
      hasAutoClosedRef.current = true;
      const finalExitPrice = isTpHit ? takeProfit : stopLoss;
      handleClosePosition(trade.id, finalExitPrice);
    }
  }, [isTpHit, isSlHit, livePrice, trade.id, trade.status, handleClosePosition, takeProfit, stopLoss, isBacktest]);

  const pnlSign = unrealizedPnL > 0 ? "+" : "";
  const roiSign = roiPercentage > 0 ? "+" : "";

  // Dynamic institutional premium styling
  const pnlColorClass = unrealizedPnL > 0
    ? "text-emerald-500 font-bold"
    : unrealizedPnL < 0
    ? "text-rose-500 font-bold"
    : "text-muted";

  const roiColorClass = roiPercentage > 0
    ? "text-emerald-500 font-bold"
    : roiPercentage < 0
    ? "text-rose-500 font-bold"
    : "text-muted";

  const rowHighlightClass = isSelected
    ? "bg-accent/15 hover:bg-accent/20"
    : isTpHit
    ? "animate-exit-glow-green"
    : isSlHit
    ? "animate-exit-glow-red"
    : "hover:bg-card/25";

  return (
    <tr className={`border-b border-card-border/50 transition-colors ${rowHighlightClass} relative`}>
      <td className="py-4 px-3 text-center">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect && onToggleSelect(trade.id)}
          className="w-3.5 h-3.5 accent-accent cursor-pointer rounded"
        />
      </td>
      <td className="py-4 px-4 md:px-6 font-mono text-[11px] text-muted leading-relaxed">
        <div>O: {formatDate(trade.opened_at || trade.created_at || trade.timestamp)}</div>
        <div className="text-[9px] text-[#50ffaf]/80">C: RUNNING</div>
      </td>

      <td className="py-4 px-4 font-sans font-bold text-title">
        <div>{trade.symbol}</div>
        <div className="text-[9px] text-muted font-normal tracking-tight">
          Size: {positionSize.toFixed(4)} {trade.symbol.replace('.p', '').split('USD')[0] || 'Units'}
        </div>
      </td>

      <td className="py-4 px-4">
        <span
          className={`px-2 py-0.5 border font-sans text-[9px] font-bold uppercase tracking-wider rounded-md ${
            trade.direction === "LONG"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
              : "bg-rose-500/10 border-rose-500/20 text-rose-500"
          }`}
        >
          {trade.direction}
        </span>
      </td>

      <td className="py-4 px-4 text-right font-mono font-medium text-title">
        {parseFloat(String(trade.entry_price)).toFixed(2)}
      </td>

      <td className="py-4 px-4 text-right font-mono text-rose-500">
        <div>{parseFloat(String(trade.stop_loss)).toFixed(2)}</div>
        <div className="text-[9px] text-rose-500/70 font-sans font-medium">
          Risk: ${(trade as any).risk_amount_usd ? parseFloat(String((trade as any).risk_amount_usd)).toFixed(2) : (Math.abs(entryPrice - stopLoss) * positionSize).toFixed(2)}
        </div>
      </td>

      <td className="py-4 px-4 text-right font-mono text-emerald-500">
        {parseFloat(String(trade.take_profit)).toFixed(2)}
      </td>

      {/* Real-time Unrealized P&L */}
      <td className={`py-4 px-4 text-right font-mono font-bold transition-all duration-300 ${pulseClass} ${pnlColorClass}`}>
        {livePrice ? `${pnlSign}${unrealizedPnL.toFixed(2)}` : "Loading..."}
      </td>

      {/* Real-time ROI Percentage */}
      <td className={`py-4 px-4 text-right font-mono font-bold ${roiColorClass}`}>
        {livePrice ? `${roiSign}${roiPercentage.toFixed(2)}%` : "Loading..."}
      </td>

      <td className="py-4 px-4 font-mono text-[11px] text-muted max-w-[150px] truncate">
        {trade.strategy_name}
      </td>

      <td className="py-4 px-4">
        {isTpHit ? (
          <span className="px-2 py-0.5 border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 font-sans text-[9px] font-bold uppercase tracking-wider rounded-md leading-none flex items-center gap-1.5 w-fit shadow-[0_0_10px_rgba(80,255,175,0.1)] animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
            TP TARGET HIT
          </span>
        ) : isSlHit ? (
          <span className="px-2 py-0.5 border border-rose-500/30 bg-rose-500/10 text-rose-500 font-sans text-[9px] font-bold uppercase tracking-wider rounded-md leading-none flex items-center gap-1.5 w-fit shadow-[0_0_10px_rgba(255,95,95,0.1)] animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
            STOPPED OUT
          </span>
        ) : (
          <span
            className={`px-2 py-0.5 border font-sans text-[9px] font-bold uppercase tracking-wider rounded-md leading-none flex items-center gap-1.5 w-fit ${
              trade.status === "OPEN"
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500 shadow-[0_0_10px_rgba(80,255,175,0.1)] animate-pulse"
                : "bg-amber-500/10 border-amber-500/20 text-amber-500"
            }`}
          >
            {trade.status === "OPEN" && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
            {trade.status}
          </span>
        )}
      </td>

      <td className="py-3 px-4 md:px-6">
        <ActionsCell
          trade={trade}
          isLoading={isLoading}
          actionLoadingId={actionLoadingId}
          isDeletingConfirm={isDeletingConfirm}
          handleToggleStatus={handleToggleStatus}
          handleClosePosition={(id) => handleClosePosition(id, livePrice)}
          setDeleteConfirmId={setDeleteConfirmId}
          handleDeleteTrade={handleDeleteTrade}
        />
      </td>
    </tr>
  );
});

// ── SINGLE POSITION MANAGER ROUTER (Decouples Closed / Active render) ───────
const JournalTableRow = memo(function JournalTableRow({
  trade,
  isLoading,
  actionLoadingId,
  isDeletingConfirm,
  handleToggleStatus,
  handleClosePosition,
  setDeleteConfirmId,
  handleDeleteTrade,
  formatDate,
  isBacktest,
  backtestLivePrice,
  backtestCandleTime,
  isSelected = false,
  onToggleSelect
}: {
  trade: TradeRecord;
  isLoading: boolean;
  actionLoadingId: string | null;
  isDeletingConfirm: boolean;
  handleToggleStatus: (trade: TradeRecord) => void;
  handleClosePosition: (id: string, exitPrice?: number | null) => void;
  setDeleteConfirmId: (id: string | null) => void;
  handleDeleteTrade: (id: string) => void;
  formatDate: (date: string) => string;
  isBacktest?: boolean;
  backtestLivePrice?: number | null;
  backtestCandleTime?: number | null;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  if (trade.status === "CLOSED") {
    return (
      <ClosedTradeRow
        trade={trade}
        isLoading={isLoading}
        actionLoadingId={actionLoadingId}
        isDeletingConfirm={isDeletingConfirm}
        handleToggleStatus={handleToggleStatus}
        handleClosePosition={handleClosePosition}
        setDeleteConfirmId={setDeleteConfirmId}
        handleDeleteTrade={handleDeleteTrade}
        formatDate={formatDate}
        isSelected={isSelected}
        onToggleSelect={onToggleSelect}
      />
    );
  }

  return (
    <ActiveTradeRow
      trade={trade}
      isLoading={isLoading}
      actionLoadingId={actionLoadingId}
      isDeletingConfirm={isDeletingConfirm}
      handleToggleStatus={handleToggleStatus}
      handleClosePosition={handleClosePosition}
      setDeleteConfirmId={setDeleteConfirmId}
      handleDeleteTrade={handleDeleteTrade}
      formatDate={formatDate}
      isBacktest={isBacktest}
      backtestLivePrice={backtestLivePrice}
      backtestCandleTime={backtestCandleTime}
      isSelected={isSelected}
      onToggleSelect={onToggleSelect}
    />
  );
});

export const JournalTable = memo(function JournalTable({ initialTrades, initialAccount, isBacktest = false, backtestLivePrice, backtestCandleTime }: JournalTableProps) {
  const context = useMarketDataContext();
  const tradesApiUrl = isBacktest ? "/api/backtest-trades" : "/api/trades";

  const [trades, setTrades] = useState<TradeRecord[]>(initialTrades);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'QUANT' | 'MANUAL' | 'STRATEGY'>('ALL');
  const [selectedTradeIds, setSelectedTradeIds] = useState<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkArchiving, setIsBulkArchiving] = useState(false);

  // Filter trades based on Strategy Origin / Source
  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (sourceFilter === 'ALL') return true;
      const strat = (t.strategy_name || '').toLowerCase();
      if (sourceFilter === 'QUANT') return strat.includes('quant') || strat.includes('set-');
      if (sourceFilter === 'MANUAL') return strat.includes('manual');
      if (sourceFilter === 'STRATEGY') return strat.includes('strategy') || (!strat.includes('quant') && !strat.includes('manual'));
      return true;
    });
  }, [trades, sourceFilter]);

  const toggleSelectAll = useCallback(() => {
    if (selectedTradeIds.length === filteredTrades.length && filteredTrades.length > 0) {
      setSelectedTradeIds([]);
    } else {
      setSelectedTradeIds(filteredTrades.map((t) => t.id));
    }
  }, [filteredTrades, selectedTradeIds]);

  const toggleSelectTrade = useCallback((id: string) => {
    setSelectedTradeIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  // Stateful account tracker to display real persistent balance
  const [account, setAccount] = useState(() => {
    return initialAccount || {
      current_balance: "10000.0000",
      initial_capital: "10000.0000",
      max_risk_limit_pct: "3.00"
    };
  });

  // ── P&L HUD Sizing Calculations (V8.4) ──────────────────────────────────
  const closedTrades = trades.filter(t => t.status === "CLOSED");
  const totalRealizedPnL = closedTrades.reduce((sum, t) => {
    const pnl = (t as any).realized_pnl !== undefined && (t as any).realized_pnl !== null
      ? parseFloat(String((t as any).realized_pnl))
      : 0;
    return sum + pnl;
  }, 0);

  const winningTrades = closedTrades.filter(t => {
    const pnl = (t as any).realized_pnl !== undefined && (t as any).realized_pnl !== null
      ? parseFloat(String((t as any).realized_pnl))
      : 0;
    return pnl > 0;
  });

  const winRate = closedTrades.length > 0
    ? (winningTrades.length / closedTrades.length) * 100
    : 0;

  // Global Risk Exposure calculations for the Brutalist progress bar
  const openTrades = trades.filter(t => t.status === "OPEN");
  const totalOpenRiskUsd = openTrades.reduce((sum, t) => {
    const entry = parseFloat(String(t.entry_price));
    const sl = parseFloat(String(t.stop_loss));
    const size = parseFloat(String(t.position_size ?? 1.0));
    return sum + Math.abs(entry - sl) * size;
  }, 0);

  const currentBalance = parseFloat(String(account.current_balance));
  const maxRiskPct = parseFloat(String(account.max_risk_limit_pct));
  const maxRiskUsd = currentBalance * (maxRiskPct / 100);

  // Exact current open risk as a percentage of the total account balance
  const currentOpenRiskPct = currentBalance > 0 ? (totalOpenRiskUsd / currentBalance) * 100 : 0;
  // Progress occupancy of the allowed 3.00% limit (e.g. 50% used if open risk is 1.50% and limit is 3.00%)
  const riskLimitOccupancyPct = maxRiskUsd > 0 ? Math.min((totalOpenRiskUsd / maxRiskUsd) * 100, 100) : 0;

  // ── 1. GET: Fetch latest trade list (refresh) ──────────────────────────
  const refreshTrades = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // 1. Sync from local in-memory session journal first
      const localTrades = useSessionJournalStore.getState().getTradesByMode(isBacktest ? 'BACKTEST' : 'LIVE');
      if (localTrades.length > 0) {
        setTrades(localTrades as unknown as TradeRecord[]);
      }

      // 2. Non-blocking background sync from cloud DB
      const res = await fetch(tradesApiUrl);
      if (res.ok) {
        const json = await res.json();
        const combined = json.trades && json.trades.length > 0 ? json.trades : localTrades;
        setTrades(combined || []);
        if (json.account) {
          setAccount(json.account);
        }
      }
    } catch (err) {
      console.debug("[JOURNAL] Cloud sync skipped (in-memory journal preserved):", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [tradesApiUrl, isBacktest]);

  // Listen to server-side and local scan triggers to automatically update journal state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleRefresh = () => {
      refreshTrades();
    };
    const eventName = isBacktest ? 'backtest-trades-refresh' : 'trades-refresh';
    window.addEventListener(eventName, handleRefresh);
    return () => {
      window.removeEventListener(eventName, handleRefresh);
    };
  }, [refreshTrades, isBacktest]);

  // ── 2. PATCH: Toggle position status (Pause / Reactivate) ────────
  const handleToggleStatus = useCallback(async (trade: TradeRecord) => {
    const nextStatus = trade.status === "PAUSED" ? "OPEN" : "PAUSED";
    setActionLoadingId(`${trade.id}-toggle`);

    // 1. Update in-memory session store immediately
    useSessionJournalStore.getState().toggleTradeStatus(trade.id);
    setTrades(prev =>
      prev.map(t => (t.id === trade.id ? { ...t, status: nextStatus } : t))
    );

    // 2. Fire-and-forget background cloud sync
    fetch(tradesApiUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trade_id: trade.id, status: nextStatus })
    }).catch(() => {});

    setActionLoadingId(null);
  }, [tradesApiUrl]);

  // ── 3. PATCH: Manually close active trade ──────────────────────────────
  const handleClosePosition = useCallback(async (tradeId: string, exitPrice?: number | null) => {
    setActionLoadingId(`${tradeId}-close`);

    const closedAt = isBacktest && backtestCandleTime 
      ? new Date(backtestCandleTime).toISOString() 
      : new Date().toISOString();

    const targetTrade = trades.find((t) => t.id === tradeId);
    const resolvedExit = exitPrice ?? (targetTrade ? parseFloat(String(targetTrade.entry_price)) : 0);

    // 1. Close in in-memory session store immediately
    useSessionJournalStore.getState().closeTrade(tradeId, resolvedExit, 'MANUAL_EXIT', closedAt);
    setTrades(prev =>
      prev.map(t => (t.id === tradeId ? { ...t, status: "CLOSED" as const, exit_price: resolvedExit, closed_at: closedAt } : t))
    );

    // 2. Fire-and-forget background cloud sync
    fetch(tradesApiUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        trade_id: tradeId, 
        status: "CLOSED",
        exit_price: resolvedExit,
        closed_at: closedAt
      })
    }).catch(() => {});

    setActionLoadingId(null);
  }, [tradesApiUrl, isBacktest, backtestCandleTime, trades]);

  // ── 4. DELETE: Surgical hard row deletion ──────────────────────────────
  const handleDeleteTrade = useCallback(async (tradeId: string) => {
    setActionLoadingId(`${tradeId}-delete`);

    // 1. Delete from in-memory session store immediately
    useSessionJournalStore.getState().deleteTrade(tradeId);
    setTrades(prev => prev.filter(t => t.id !== tradeId));
    setDeleteConfirmId(null);

    // 2. Fire-and-forget background cloud sync
    fetch(`${tradesApiUrl}?trade_id=${tradeId}`, {
      method: "DELETE"
    }).catch(() => {});

    setActionLoadingId(null);
  }, [tradesApiUrl]);

  const handleBulkArchive = useCallback(async () => {
    if (selectedTradeIds.length === 0) return;
    setIsBulkArchiving(true);
    try {
      for (const id of selectedTradeIds) {
        const trade = trades.find((t) => t.id === id);
        if (trade && trade.status !== "CLOSED") {
          await handleClosePosition(id);
        }
      }
      setSelectedTradeIds([]);
    } catch (err) {
      console.error("[JOURNAL] Bulk archive error:", err);
    } finally {
      setIsBulkArchiving(false);
    }
  }, [selectedTradeIds, trades, handleClosePosition]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedTradeIds.length === 0) return;
    if (!confirm(`Are you sure you want to purge/delete ${selectedTradeIds.length} selected position(s)?`)) return;

    setIsBulkDeleting(true);
    try {
      for (const id of selectedTradeIds) {
        await handleDeleteTrade(id);
      }
      setSelectedTradeIds([]);
    } catch (err) {
      console.error("[JOURNAL] Bulk delete error:", err);
    } finally {
      setIsBulkDeleting(false);
    }
  }, [selectedTradeIds, handleDeleteTrade]);

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      // Hardcode Africa/Cairo UTC+3 to align with system clock display
      return date.toLocaleString("en-US", {
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="w-full flex flex-col gap-4">

      {/* ── Risk Summary HUD (V10.0) ────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-2 animate-in fade-in duration-300">
        {/* Account Capital persistence Card */}
        <div className="glass-panel p-4 flex flex-col gap-1.5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-accent/2 rounded-full blur-2xl pointer-events-none" />
          <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted">
            Persistent Capital Balance
          </span>
          <span className="text-xl font-mono font-bold tracking-tight text-title">
            ${currentBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
          </span>
          <div className="flex items-center gap-1.5 text-[9.5px] font-mono mt-1">
            <span className="text-muted font-sans font-medium">Initial:</span>
            <span className="text-title font-bold">${parseFloat(String(account.initial_capital)).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
            <span className={`px-1 py-0.5 rounded text-[8px] font-sans font-bold uppercase tracking-wide leading-none ${
              currentBalance >= parseFloat(String(account.initial_capital))
                ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
            }`}>
              {currentBalance >= parseFloat(String(account.initial_capital)) ? "In profit" : "In drawdown"}
            </span>
          </div>
        </div>

        {/* Total Realized P&L Card */}
        <div className="glass-panel p-4 flex flex-col gap-1.5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-accent/2 rounded-full blur-2xl pointer-events-none" />
          <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted">
            Total Realized P&L
          </span>
          <span className={`text-xl font-mono font-bold tracking-tight ${
            totalRealizedPnL > 0
              ? "text-emerald-500"
              : totalRealizedPnL < 0
              ? "text-rose-500"
              : "text-title"
          }`}>
            {totalRealizedPnL > 0 ? "+" : ""}{totalRealizedPnL.toFixed(2)} USD
          </span>
          <div className="text-[9.5px] font-sans font-medium text-muted mt-1">
            Realized return across audited deals
          </div>
        </div>

        {/* Risk Exposure (V10.0 Style) */}
        <div className="glass-panel p-4 flex flex-col gap-2 relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-rose-500">
              Global Risk Exposure
            </span>
            <span className={`text-[9px] font-sans font-bold px-1.5 py-0.5 rounded uppercase tracking-wide leading-none ${
              riskLimitOccupancyPct >= 80 
                ? "bg-rose-500/20 border border-rose-500 text-rose-500 animate-pulse" 
                : riskLimitOccupancyPct > 0 
                ? "bg-accent/10 border border-accent/30 text-accent" 
                : "bg-card-border/50 border border-card-border text-muted"
            }`}>
              {riskLimitOccupancyPct >= 80 ? "⚠️ CAP AT RISK" : riskLimitOccupancyPct > 0 ? "Active" : "Stable"}
            </span>
          </div>

          <div className="flex flex-col gap-1 mt-0.5">
            <div className="flex justify-between items-baseline font-mono">
              <span className="text-lg font-bold tracking-tight text-title">
                {currentOpenRiskPct.toFixed(2)}%
              </span>
              <span className="text-[9px] text-muted font-sans">
                / {maxRiskPct.toFixed(2)}% Limit
              </span>
            </div>
            <div className="text-[9.5px] font-sans font-medium text-muted">
              ${totalOpenRiskUsd.toFixed(2)} / ${maxRiskUsd.toFixed(2)} USD allocation
            </div>
          </div>

          {/* Highly Visible Dynamic Accent Progress Bar */}
          <div className="w-full bg-background border border-card-border h-2 rounded overflow-hidden relative p-[1px] mt-1">
            <div
              className={`h-full rounded-sm transition-all duration-500 ease-out ${
                riskLimitOccupancyPct >= 80
                  ? "bg-rose-500"
                  : riskLimitOccupancyPct >= 50
                  ? "bg-amber-500"
                  : "bg-accent"
              }`}
              style={{ width: `${riskLimitOccupancyPct}%` }}
            />
          </div>
        </div>

        {/* Performance Matrix Card */}
        <div className="glass-panel p-4 flex flex-col gap-1.5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-accent/2 rounded-full blur-2xl pointer-events-none" />
          <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted">
            Performance Matrix
          </span>
          <span className="text-xl font-mono font-bold tracking-tight text-title">
            {winRate.toFixed(1)}% <span className="text-[9px] font-sans font-medium text-muted uppercase ml-1">Win Rate</span>
          </span>
          <div className="flex items-center gap-1.5 text-[9.5px] font-sans mt-1 text-muted">
            <span>Deals:</span>
            <span className="text-title font-bold">{closedTrades.length} closed</span>
            <span className="font-mono">({winningTrades.length} W / {closedTrades.length - winningTrades.length} L)</span>
          </div>
        </div>
      </div>

      {/* Table Subheader Control Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] font-bold text-muted uppercase tracking-wider">
            Audited Positions: {filteredTrades.length} / {trades.length}
          </span>

          {/* Strategy Origin / Source Filter */}
          <div className="flex items-center gap-1 bg-background/50 border border-card-border p-1 rounded-lg">
            <span className="text-[9px] font-bold text-muted uppercase px-1.5 font-sans">Source:</span>
            {(['ALL', 'QUANT', 'MANUAL', 'STRATEGY'] as const).map((src) => (
              <button
                key={src}
                onClick={() => setSourceFilter(src)}
                className={`px-2.5 py-1 text-[9px] font-mono font-bold uppercase rounded-md transition-all cursor-pointer ${
                  sourceFilter === src
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {src === 'ALL' ? 'All' : src === 'QUANT' ? 'Quant Setups 🤖' : src === 'MANUAL' ? 'Manual 🎯' : 'Strategy 📈'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 1-Click Export JSON */}
          <button
            type="button"
            onClick={() => useSessionJournalStore.getState().exportSessionJson(isBacktest ? 'BACKTEST' : 'LIVE')}
            title="Download complete session trade log as structured JSON"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-mono text-[9px] font-bold uppercase tracking-wider transition-all rounded-lg shadow-sm cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </button>

          {/* 1-Click Export CSV */}
          <button
            type="button"
            onClick={() => useSessionJournalStore.getState().exportSessionCsv(isBacktest ? 'BACKTEST' : 'LIVE')}
            title="Download session audit ledger as spreadsheet CSV"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 font-mono text-[9px] font-bold uppercase tracking-wider transition-all rounded-lg shadow-sm cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          {/* Clear Session */}
          <button
            type="button"
            onClick={() => {
              if (confirm(`Are you sure you want to clear all ${isBacktest ? 'backtest' : 'live'} session trades from local memory?`)) {
                useSessionJournalStore.getState().clearSession(isBacktest ? 'BACKTEST' : 'LIVE');
                setTrades([]);
              }
            }}
            title="Clear all session trades from in-memory journal"
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 font-mono text-[9px] font-bold uppercase tracking-wider transition-all rounded-lg shadow-sm cursor-pointer"
          >
            <Trash className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>

          {/* Sync Logs */}
          <button
            onClick={refreshTrades}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-card hover:bg-card/85 border border-card-border hover:border-accent text-muted hover:text-accent font-mono text-[9px] font-bold uppercase tracking-wider transition-all rounded-lg shadow-md cursor-pointer disabled:opacity-50"
          >
            {isRefreshing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>[ Sync Logs ]</span>
          </button>
        </div>
      </div>

      {/* Bulk Action Bar Banner */}
      {selectedTradeIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between bg-accent/10 border border-accent/30 p-2.5 rounded-xl animate-in fade-in duration-200 text-xs gap-3">
          <div className="flex items-center gap-2 font-mono font-bold text-accent">
            <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
            <span>{selectedTradeIds.length} position(s) selected</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleBulkArchive}
              disabled={isBulkArchiving}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[9px] font-bold uppercase rounded-lg shadow-sm flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              {isBulkArchiving ? <Loader2 className="w-3 h-3 animate-spin" /> : "📁"}
              <span>Archive / Close Selected ({selectedTradeIds.length})</span>
            </button>

            <button
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-mono text-[9px] font-bold uppercase rounded-lg shadow-sm flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              {isBulkDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              <span>Purge / Delete Selected ({selectedTradeIds.length})</span>
            </button>

            <button
              onClick={() => setSelectedTradeIds([])}
              className="px-2.5 py-1.5 bg-card hover:bg-card-border/50 text-muted border border-card-border font-mono text-[9px] font-bold uppercase rounded-lg cursor-pointer"
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* Main Glassmorphism Data Table Wrapper */}
      <div className="w-full glass-panel overflow-hidden relative border border-card-border rounded-xl">
        <div className="overflow-x-auto min-w-full">
          <table className="w-full border-collapse text-left text-xs text-foreground">
            <thead>
              <tr className="border-b border-card-border bg-card/45 text-[9px] font-bold uppercase tracking-widest text-muted">
                <th className="py-4 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={filteredTrades.length > 0 && selectedTradeIds.length === filteredTrades.length}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 accent-accent cursor-pointer rounded"
                    title="Select / Deselect All Visible Trades"
                  />
                </th>
                <th className="py-4 px-4 md:px-6">Timestamp (UTC+3)</th>
                <th className="py-4 px-4">Asset</th>
                <th className="py-4 px-4">Direction</th>
                <th className="py-4 px-4 text-right">Entry Price</th>
                <th className="py-4 px-4 text-right">Stop Loss</th>
                <th className="py-4 px-4 text-right">Take Profit</th>
                <th className="py-4 px-4 text-right">Unrealized P&L</th>
                <th className="py-4 px-4 text-right">ROI %</th>
                <th className="py-4 px-4">Strategy</th>
                <th className="py-4 px-4">Status</th>
                <th className="py-4 px-4 md:px-6 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Dynamic Interactive Rows */}
              {filteredTrades.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-8 px-4 text-center font-mono text-[10px] text-muted uppercase tracking-wider leading-relaxed">
                    No active positions matching source filter [{sourceFilter}]
                  </td>
                </tr>
              ) : (
                filteredTrades.map((trade: TradeRecord) => (
                  <JournalTableRow
                    key={trade.id}
                    trade={trade}
                    isLoading={actionLoadingId !== null}
                    actionLoadingId={actionLoadingId}
                    isDeletingConfirm={deleteConfirmId === trade.id}
                    handleToggleStatus={handleToggleStatus}
                    handleClosePosition={handleClosePosition}
                    setDeleteConfirmId={setDeleteConfirmId}
                    handleDeleteTrade={handleDeleteTrade}
                    formatDate={formatDate}
                    isBacktest={isBacktest}
                    backtestLivePrice={backtestLivePrice}
                    backtestCandleTime={backtestCandleTime}
                    isSelected={selectedTradeIds.includes(trade.id)}
                    onToggleSelect={toggleSelectTrade}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
