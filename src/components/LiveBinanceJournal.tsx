"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldAlert,
  Activity,
  RefreshCw,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  CheckCircle2,
  Lock,
  Layers,
  Zap,
  Flame,
  Check,
  X,
  XCircle,
} from "lucide-react";

interface AccountTelemetry {
  totalWalletBalance: string;
  totalMarginBalance: string;
  availableBalance: string;
  totalUnrealizedProfit: string;
  marginRatio: string;
  todayRealizedUsd?: string;
  todayRealizedR?: string;
  currency: string;
}

interface PositionItem {
  symbol: string;
  positionAmt: string;
  direction: "LONG" | "SHORT";
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  marginType: string;
  notional: string;
  activeStopLoss?: string;
  stage1Target?: string;
  stage2Target?: string;
}

interface OpenOrderItem {
  orderId: number;
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  price: string;
  origQty: string;
  stopPrice: string;
  status: string;
  time: number;
  anchorName?: string;
}

interface TradeItem {
  symbol: string;
  id: number | string;
  orderId: number;
  side: "BUY" | "SELL";
  price: string;
  exitPrice?: string;
  qty: string;
  realizedPnl: string;
  realizedR?: string;
  commission: string;
  commissionAsset: string;
  time: number;
  exitReason?: string;
}

interface LiveStatePayload {
  success: boolean;
  environment: "LOCAL_DEV" | "VPS_PRODUCTION";
  isLiveExecution: boolean;
  mode: string;
  watermark: string;
  gateReason: string;
  symbol: string;
  account: AccountTelemetry;
  positions: PositionItem[];
  openOrders: OpenOrderItem[];
  recentTrades: TradeItem[];
  lastUpdated: number;
  cached?: boolean;
}

export function LiveBinanceJournal() {
  const [data, setData] = useState<LiveStatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"positions" | "pipeline" | "trades">("positions");

  // Emergency Flatten Modal State
  const [showFlattenModal, setShowFlattenModal] = useState(false);
  const [flattenCountdown, setFlattenCountdown] = useState(15);
  const [isFlattening, setIsFlattening] = useState(false);
  const [flattenToast, setFlattenToast] = useState<string | null>(null);

  const fetchLiveState = useCallback(async (manual = false) => {
    if (manual) setIsRefreshing(true);
    try {
      const res = await fetch("/api/binance/live-state?symbol=ETHUSDC");
      if (res.ok) {
        const json: LiveStatePayload = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Failed to fetch live Binance state:", err);
    } finally {
      setLoading(false);
      if (manual) setTimeout(() => setIsRefreshing(false), 500);
    }
  }, []);

  // Poll every 4 seconds
  useEffect(() => {
    fetchLiveState();
    const interval = setInterval(() => {
      fetchLiveState();
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchLiveState]);

  // Countdown timer for emergency modal
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showFlattenModal && flattenCountdown > 0) {
      timer = setTimeout(() => setFlattenCountdown((prev) => prev - 1), 1000);
    } else if (showFlattenModal && flattenCountdown === 0) {
      setShowFlattenModal(false);
    }
    return () => clearTimeout(timer);
  }, [showFlattenModal, flattenCountdown]);

  const handleOpenFlattenModal = () => {
    setFlattenCountdown(15);
    setShowFlattenModal(true);
  };

  const handleConfirmFlatten = async () => {
    setIsFlattening(true);
    try {
      const res = await fetch("/api/binance/flatten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: "ETHUSDC" }),
      });
      const resData = await res.json();
      setShowFlattenModal(false);
      setFlattenToast(
        resData.success
          ? "🚨 Emergency Flatten Executed: Account is flat."
          : `⚠️ Flatten notice: ${resData.message || resData.error}`
      );
      setTimeout(() => setFlattenToast(null), 7000);
      await fetchLiveState(true);
    } catch (err: any) {
      setFlattenToast(`❌ Flatten Error: ${err.message || String(err)}`);
      setTimeout(() => setFlattenToast(null), 7000);
    } finally {
      setIsFlattening(false);
    }
  };

  const account = data?.account;
  const positions = data?.positions || [];
  const openOrders = data?.openOrders || [];
  const recentTrades = data?.recentTrades || [];

  const unPnlNum = parseFloat(account?.totalUnrealizedProfit || "0");
  const marginRatioNum = parseFloat(account?.marginRatio || "0");

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Toast Notification */}
      {flattenToast && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-950/80 backdrop-blur-md text-white flex items-center justify-between shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-400" />
            <span className="text-sm font-semibold tracking-wide">{flattenToast}</span>
          </div>
          <button
            onClick={() => setFlattenToast(null)}
            className="text-white/60 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Environment Watermark & Header Controls */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 rounded-xl border border-card-border bg-card-bg/40 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {data?.isLiveExecution ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-black uppercase tracking-wider shadow-sm shadow-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              🔴 VPS LIVE PM2 — REAL MONEY ARMED
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-black uppercase tracking-wider shadow-sm shadow-amber-500/20">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              🧪 LOCAL DEV — SHADOW / PAPER SANDBOX
            </div>
          )}
          <span className="text-xs text-muted font-mono hidden sm:inline">
            Asset: <b>ETHUSDC</b> (Binance USDⓈ-M)
          </span>
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
          <button
            onClick={() => fetchLiveState(true)}
            disabled={isRefreshing}
            className="px-3 py-2 rounded-lg border border-card-border bg-card-bg hover:border-accent/40 text-xs text-foreground font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            title="Refresh Live Exchange State"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-accent" : ""}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={handleOpenFlattenModal}
            className="px-3.5 py-2 rounded-lg border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500 hover:text-white text-rose-400 text-xs font-black tracking-wider uppercase transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-rose-950/30"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Emergency Flatten</span>
          </button>
        </div>
      </div>

      {/* Account Telemetry Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* Margin Balance */}
        <div className="p-4 rounded-xl border border-card-border bg-card-bg/60 flex flex-col">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted mb-1">
            Total Margin Balance
          </span>
          <span className="text-lg md:text-xl font-bold font-mono text-foreground">
            ${parseFloat(account?.totalMarginBalance || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] text-muted/70 mt-1">
            Includes open floating P&L
          </span>
        </div>

        {/* Free Collateral */}
        <div className="p-4 rounded-xl border border-card-border bg-card-bg/60 flex flex-col">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted mb-1">
            Available Collateral
          </span>
          <span className="text-lg md:text-xl font-bold font-mono text-foreground">
            ${parseFloat(account?.availableBalance || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] text-muted/70 mt-1">
            Unencumbered free margin
          </span>
        </div>

        {/* Unrealized Floating PnL */}
        <div className="p-4 rounded-xl border border-card-border bg-card-bg/60 flex flex-col">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted mb-1">
            Unrealized P&L
          </span>
          <div className="flex items-center gap-1.5">
            {unPnlNum >= 0 ? (
              <ArrowUpRight className="w-4 h-4 text-emerald-400" />
            ) : (
              <ArrowDownRight className="w-4 h-4 text-rose-400" />
            )}
            <span
              className={`text-lg md:text-xl font-bold font-mono ${
                unPnlNum >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {unPnlNum >= 0 ? "+" : ""}${unPnlNum.toFixed(2)}
            </span>
          </div>
          <span className="text-[10px] text-muted/70 mt-1">
            Floating market delta
          </span>
        </div>

        {/* Margin Ratio */}
        <div className="p-4 rounded-xl border border-card-border bg-card-bg/60 flex flex-col">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted mb-1">
            Margin Ratio
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`text-lg md:text-xl font-bold font-mono ${
                marginRatioNum < 20
                  ? "text-emerald-400"
                  : marginRatioNum < 50
                  ? "text-amber-400"
                  : "text-rose-400"
              }`}
            >
              {marginRatioNum.toFixed(2)}%
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-card-bg/80 border border-card-border text-muted font-bold">
              {marginRatioNum < 20 ? "HEALTHY" : marginRatioNum < 50 ? "MODERATE" : "RISK"}
            </span>
          </div>
          <span className="text-[10px] text-muted/70 mt-1">
            Liquidation threshold: 100%
          </span>
        </div>

        {/* Today's Realized */}
        <div className="p-4 rounded-xl border border-card-border bg-card-bg/60 flex flex-col col-span-2 sm:col-span-1">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted mb-1">
            Session Realized Net
          </span>
          <span
            className={`text-lg md:text-xl font-bold font-mono ${
              parseFloat(account?.todayRealizedUsd || "0") >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {parseFloat(account?.todayRealizedUsd || "0") >= 0 ? "+" : ""}
            ${parseFloat(account?.todayRealizedUsd || "0").toFixed(2)}{" "}
            <span className="text-xs text-muted">
              ({account?.todayRealizedR ? `${account.todayRealizedR}R` : "0.00R"})
            </span>
          </span>
          <span className="text-[10px] text-muted/70 mt-1">
            After exchange fees & slip
          </span>
        </div>
      </div>

      {/* 3 Viewport Tab Switcher */}
      <div className="flex items-center border-b border-card-border gap-2">
        <button
          onClick={() => setActiveTab("positions")}
          className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "positions"
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>Live Exchange Positions ({positions.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("pipeline")}
          className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "pipeline"
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>PM2 Resting Limit Queue ({openOrders.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("trades")}
          className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "trades"
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Execution Fills & Parity ({recentTrades.length})</span>
        </button>
      </div>

      {/* VIEWPORT 1: LIVE POSITIONS TABLE */}
      {activeTab === "positions" && (
        <div className="rounded-xl border border-card-border bg-card-bg/40 overflow-hidden">
          {positions.length === 0 ? (
            <div className="py-12 px-4 text-center flex flex-col items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400/60 mb-3" />
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                Account is Flat — Zero Active Market Exposure
              </h3>
              <p className="text-xs text-muted mt-1 max-w-md">
                The PM2 Quantitative Daemon is actively scanning liquidity sweeps and anchoring 5m structures.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-card-bg/80 border-b border-card-border text-[10px] uppercase font-bold text-muted tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Symbol / Side</th>
                    <th className="py-3 px-4">Position Size</th>
                    <th className="py-3 px-4">Entry Price</th>
                    <th className="py-3 px-4">Mark Price</th>
                    <th className="py-3 px-4">Unrealized P&L</th>
                    <th className="py-3 px-4">Stop Loss</th>
                    <th className="py-3 px-4">Target (TP1)</th>
                    <th className="py-3 px-4">Liquidation Price</th>
                    <th className="py-3 px-4 text-right">Quick Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/50 font-mono">
                  {positions.map((pos, idx) => {
                    const pnlNum = parseFloat(pos.unRealizedProfit);
                    const notionalNum = parseFloat(pos.notional);
                    return (
                      <tr key={idx} className="hover:bg-card-bg/60 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2 font-sans font-bold">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                pos.direction === "LONG"
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                  : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                              }`}
                            >
                              {pos.direction}
                            </span>
                            <span className="text-foreground">{pos.symbol}</span>
                            <span className="text-[10px] text-muted font-normal">
                              ({pos.leverage}x {pos.marginType})
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-semibold">
                          {Math.abs(parseFloat(pos.positionAmt)).toFixed(3)} ETH
                          <div className="text-[10px] text-muted font-normal">
                            ~${notionalNum.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
                          </div>
                        </td>
                        <td className="py-3.5 px-4">${parseFloat(pos.entryPrice).toFixed(2)}</td>
                        <td className="py-3.5 px-4 font-bold text-foreground">
                          ${parseFloat(pos.markPrice).toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`font-bold ${
                              pnlNum >= 0 ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {pnlNum >= 0 ? "+" : ""}${pnlNum.toFixed(2)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-rose-400">
                          ${parseFloat(pos.activeStopLoss || "0").toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4 text-emerald-400">
                          ${parseFloat(pos.stage1Target || "0").toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4 text-muted">
                          ${parseFloat(pos.liquidationPrice).toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={handleOpenFlattenModal}
                            className="px-2.5 py-1 rounded bg-rose-500/10 hover:bg-rose-500 hover:text-white border border-rose-500/30 text-rose-400 text-[10px] font-bold uppercase transition-all cursor-pointer"
                          >
                            Close Market
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEWPORT 2: PM2 RESTING LIMIT QUEUE */}
      {activeTab === "pipeline" && (
        <div className="rounded-xl border border-card-border bg-card-bg/40 overflow-hidden">
          {openOrders.length === 0 ? (
            <div className="py-12 px-4 text-center flex flex-col items-center justify-center">
              <Clock className="w-10 h-10 text-muted/50 mb-3" />
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                No Resting Limit Orders in Queue
              </h3>
              <p className="text-xs text-muted mt-1 max-w-md">
                Orders are queued automatically when high-probability sweep & reclaim setups touch dynamic FVG proximal entry levels.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-card-bg/80 border-b border-card-border text-[10px] uppercase font-bold text-muted tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Side / Symbol</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Limit Price</th>
                    <th className="py-3 px-4">Quantity</th>
                    <th className="py-3 px-4">Anchor Origin</th>
                    <th className="py-3 px-4">Order Status</th>
                    <th className="py-3 px-4">TTL Protection</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/50 font-mono">
                  {openOrders.map((ord, idx) => (
                    <tr key={idx} className="hover:bg-card-bg/60 transition-colors">
                      <td className="py-3.5 px-4 font-sans font-bold">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase mr-2 ${
                            ord.side === "BUY"
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                          }`}
                        >
                          {ord.side}
                        </span>
                        <span className="text-foreground">{ord.symbol}</span>
                      </td>
                      <td className="py-3.5 px-4 text-muted">{ord.type}</td>
                      <td className="py-3.5 px-4 font-bold text-foreground">
                        ${parseFloat(ord.price).toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4">{parseFloat(ord.origQty).toFixed(3)} ETH</td>
                      <td className="py-3.5 px-4 text-accent font-sans">
                        {ord.anchorName || "5m Structural Swing"}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] font-bold uppercase">
                          {ord.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-sans text-muted text-[11px]">
                        <span className="text-foreground font-bold">20 Bars</span> (100m Max TTL)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEWPORT 3: EXECUTION FILLS & PARITY */}
      {activeTab === "trades" && (
        <div className="rounded-xl border border-card-border bg-card-bg/40 overflow-hidden">
          {recentTrades.length === 0 ? (
            <div className="py-12 px-4 text-center flex flex-col items-center justify-center">
              <Activity className="w-10 h-10 text-muted/50 mb-3" />
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                No Execution Fills Recorded Yet Today
              </h3>
              <p className="text-xs text-muted mt-1 max-w-md">
                Executed orders and realized trades will appear here with Binance fee receipts and parity slips.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-card-bg/80 border-b border-card-border text-[10px] uppercase font-bold text-muted tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Timestamp (UTC)</th>
                    <th className="py-3 px-4">Side / Symbol</th>
                    <th className="py-3 px-4">Execution Price</th>
                    <th className="py-3 px-4">Executed Qty</th>
                    <th className="py-3 px-4">Exchange Fee</th>
                    <th className="py-3 px-4">Realized Net P&L</th>
                    <th className="py-3 px-4">Execution Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/50 font-mono">
                  {recentTrades.map((t, idx) => {
                    const pnlNum = parseFloat(t.realizedPnl);
                    const feeNum = parseFloat(t.commission);
                    return (
                      <tr key={idx} className="hover:bg-card-bg/60 transition-colors">
                        <td className="py-3.5 px-4 text-muted">
                          {new Date(t.time).toISOString().substring(11, 19)}
                        </td>
                        <td className="py-3.5 px-4 font-sans font-bold">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase mr-2 ${
                              t.side === "BUY"
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                            }`}
                          >
                            {t.side}
                          </span>
                          <span className="text-foreground">{t.symbol}</span>
                        </td>
                        <td className="py-3.5 px-4 font-bold text-foreground">
                          ${parseFloat(t.price).toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4">{parseFloat(t.qty).toFixed(3)} ETH</td>
                        <td className="py-3.5 px-4 text-muted">
                          ${feeNum.toFixed(4)} {t.commissionAsset}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`font-bold ${
                              pnlNum >= 0 ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {pnlNum >= 0 ? "+" : ""}${pnlNum.toFixed(2)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-sans">
                          <span className="px-2 py-0.5 rounded bg-card-bg/80 border border-card-border text-[10px] font-bold text-muted uppercase">
                            {t.exitReason || (pnlNum > 0 ? "WIN" : pnlNum < 0 ? "LOSS" : "FILL")}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TWO-STEP EMERGENCY FLATTEN CONFIRMATION MODAL */}
      {showFlattenModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-rose-500/40 bg-card-bg p-6 shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col">
            <div className="flex items-center gap-3 text-rose-400 mb-4">
              <div className="p-2.5 rounded-full bg-rose-500/10 border border-rose-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground uppercase tracking-wider">
                  Emergency Flatten Confirmation
                </h3>
                <span className="text-xs text-muted">
                  Two-Factor Armed Safety Interlock
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-950/20 text-xs space-y-2 mb-6">
              <div className="flex justify-between">
                <span className="text-muted">Target Asset:</span>
                <span className="font-bold font-mono text-foreground">ETHUSDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Active Open Positions:</span>
                <span className="font-bold font-mono text-foreground">
                  {positions.length > 0 ? `${positions[0].direction} (${positions[0].positionAmt} ETH)` : "None"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Resting Limit Orders:</span>
                <span className="font-bold font-mono text-foreground">{openOrders.length} orders</span>
              </div>
              <div className="border-t border-rose-500/20 pt-2 text-[11px] text-rose-300 font-semibold leading-relaxed">
                ⚠️ Confirming will immediately liquidate all open positions at MARKET and cancel all resting orders on Binance!
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-muted mb-6">
              <span>Auto-Disarming in:</span>
              <span className="font-mono font-bold text-rose-400 text-sm">
                {flattenCountdown}s
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowFlattenModal(false)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-card-border bg-card-bg/60 hover:bg-card-bg text-muted hover:text-foreground text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
              >
                Cancel / Disarm
              </button>
              <button
                onClick={handleConfirmFlatten}
                disabled={isFlattening}
                className="flex-1 py-2.5 px-4 rounded-xl border border-rose-500 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-rose-950/40 flex items-center justify-center gap-2"
              >
                {isFlattening ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldAlert className="w-4 h-4" />
                )}
                <span>Confirm Flatten</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
