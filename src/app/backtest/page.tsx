'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useBacktestEngine, BacktestTimeframe } from '@/hooks/useBacktestEngine';
import { useMarketDataContext } from '@/context/MarketDataContext';
import { useStrategyEvaluator } from '@/hooks/useStrategyEvaluator';
import { useAIAnalysis } from '@/hooks/useAIAnalysis';
import { JournalTable, type TradeRecord } from '@/components/JournalTable';
import type { MarketDataPayload } from '@/hooks/useMarketData';
import type { LiveCandle } from '@/hooks/useBinanceWS';
import Chart from '@/components/Chart';
import DashboardMetrics from '@/components/DashboardMetrics';
import SmartAlertsToast from '@/components/SmartAlertsToast';
import type { SmartAlert } from '@/hooks/useLiveAlerts';
import {
  ChevronLeft, ChevronRight, Eye, Download, Copy,
  Calendar, Clock, BarChart2, Loader2, AlertTriangle,
  ArrowLeft, Zap, CheckCheck, Brain, TrendingUp, Percent, AlertCircle,
  Settings, Activity, Shield, Check, Sliders, Sparkles
} from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import SettingsModal from '@/components/modals/SettingsModal';
import BacktestSidebar from './BacktestSidebar';
import ManualOrderPanel from '@/components/ManualOrderPanel';
import { calculateATR } from '@/lib/riskEngine';
import BacktestPotentialTradesModal from '@/components/modals/BacktestPotentialTradesModal';
import OrderFlowTimelineRibbon from '@/components/OrderFlowTimelineRibbon';
import OrderFlowTimelineModal from '@/components/modals/OrderFlowTimelineModal';
import type { PotentialTrade } from '@/lib/quantTradeEngine';
import { useAutoTradeExecutor } from '@/hooks/useAutoTradeExecutor';
import { useBacktestStrategyExecution } from '@/hooks/useBacktestStrategyExecution';
import { SweepReclaimEntryMode, getEntryModeLabel } from '@/lib/quantEngine/SweepReclaimEngine';
import { useSessionJournalStore } from '@/lib/quantEngine/sessionJournalStore';

// ─── Stat badge ──────────────────────────────────────────────────────────────
interface StatBadgeProps {
  label: string;
  value: string | number;
  accent?: boolean;
}

function StatBadge({ label, value, accent = false }: StatBadgeProps) {
  return (
    <div className={`flex flex-col gap-0.5 px-4 py-2 rounded-xl border transition-all ${accent ? 'border-accent/30 bg-accent/5' : 'border-card-border bg-card/25 shadow-sm'}`}>
      <span className="text-[10px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-black ${accent ? 'text-accent' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function BacktestPage() {
  const engine = useBacktestEngine();
  const { themeSettings } = useMarketDataContext();
  const { aiAnalysis, aiBias, isAnalyzing, triggerAiAnalysisScan } = useAIAnalysis();

  // Background Auto-Trade Executor for backtest replay
  useAutoTradeExecutor((engine.enrichedPayload as unknown as MarketDataPayload | null), true);


  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [activeTimeframe, setActiveTimeframe] = useState<BacktestTimeframe>('5m');
  const [counts, setCounts] = useState({ '5m': 60, '15m': 0, '1h': 72, '4h': 20 });

  // ── Unified Dropdowns & Collapsible Sidebar State ─────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isSoundSettingsOpen, setIsSoundSettingsOpen] = useState(false);
  const [commandCenterTab, setCommandCenterTab] = useState<'strategy' | 'audio'>('strategy');
  const [isTfDropdownOpen, setIsTfDropdownOpen] = useState(false);
  const [isPotentialTradesOpen, setIsPotentialTradesOpen] = useState(false);
  const [isOrderFlowModalOpen, setIsOrderFlowModalOpen] = useState(false);
  const [isStrategyDropdownOpen, setIsStrategyDropdownOpen] = useState(false);

  const { signalAlertsEnabled } = useMarketDataContext();

  // Sync page activeTimeframe scale with backtest engine scale
  useEffect(() => {
    engine.setTimeframe(activeTimeframe);
  }, [activeTimeframe, engine]);

  // ── Backtest Toast Alerts State ───────────────────────────────────────────
  const [activeAlerts, setActiveAlerts] = useState<SmartAlert[]>([]);

  const dismissAlert = useCallback((id: string) => {
    setActiveAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const triggerSmartAlert = useCallback((type: any, message: string, soundPath?: string, sourceTag?: string) => {
    // Audit gate: check if signal type is enabled
    if (signalAlertsEnabled) {
      const isTypeEnabled = (type === 'PURGE' && signalAlertsEnabled.SWEEP_ALERT !== false) ||
        (type === 'DEAD_ZONE' && signalAlertsEnabled.DEAD_ZONE_ENTER !== false) ||
        (type === 'RISK_OVERRIDE' && signalAlertsEnabled.FVG_DETECTION !== false) ||
        (type === 'SMT_TRAP' && signalAlertsEnabled.SMT_TRAP_ACTIVE !== false) ||
        (type === 'PRICING_SHIFT' && signalAlertsEnabled.PRICING_SHIFT !== false) ||
        (type === 'OBJECTIVE_UPDATE' && signalAlertsEnabled.DOL_EXHAUSTED !== false) ||
        (type === 'FLOW_STATE' && signalAlertsEnabled.FLOW_STATE_CHANGE !== false) ||
        (type === 'SESSION_TRANSITION' && signalAlertsEnabled.SESSION_TRANSITION !== false) ||
        (type === 'STRATEGY_MATCHED' && signalAlertsEnabled.STRATEGY_MATCHED !== false) ||
        (type === 'LIVE_OB_DETECTED' && signalAlertsEnabled.LIVE_OB_DETECTED !== false) ||
        (type === 'IN_ZONE_CONFIRMATION_PENDING' && signalAlertsEnabled.IN_ZONE_CONFIRMATION_PENDING !== false) ||
        (type === 'AUTO_ORDER_ROUTED' && signalAlertsEnabled.AUTO_ORDER_ROUTED !== false) ||
        (type === 'STAGE_FILL' && signalAlertsEnabled.STAGE_FILL !== false);

      if (!isTypeEnabled) {
        console.log(`[Backtest] Alert '${type}' suppressed per user settings.`);
        return;
      }
    }

    const resolvedSourceTag = sourceTag || (
      type === 'STRATEGY_MATCHED' ? 'STRATEGY_ARCHITECT' :
      (type === 'LIVE_OB_DETECTED' || type === 'IN_ZONE_CONFIRMATION_PENDING' || type === 'AUTO_ORDER_ROUTED' || type === 'STAGE_FILL') ? 'AUTONOMOUS_OB' :
      type === 'RISK_OVERRIDE' ? 'RISK_MANAGEMENT' :
      'MARKET_STRUCTURE'
    );

    setActiveAlerts((prev) => {
      const newAlert: SmartAlert = {
        id: `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        type,
        message,
        timestamp: Date.now(),
        sourceTag: resolvedSourceTag,
      };
      return [newAlert, ...prev].slice(0, 10);
    });

    if (typeof window !== 'undefined' && soundPath) {
      const audio = new Audio(soundPath);
      audio.play().catch(e => {
        if (e.name === 'NotAllowedError') {
          console.log('[Audio] Playback blocked by browser autoplay policy until user interacts.');
        } else {
          console.error('Audio play error:', e);
        }
      });
    }
  }, [signalAlertsEnabled]);

  // ── Backtest Trades & Account State ───────────────────────────────────────
  const [backtestTrades, setBacktestTrades] = useState<TradeRecord[]>([]);
  const [backtestAccount, setBacktestAccount] = useState<any>(null);
  const [isLoadingTrades, setIsLoadingTrades] = useState(true);

  // ── Manual Trading States ──────────────────────────────────────────────────
  const [isManualTradingActive, setIsManualTradingActive] = useState(false);
  const [manualOrderType, setManualOrderType] = useState<'MARKET' | 'LIMIT' | 'STOP'>('MARKET');
  const [manualDirection, setManualDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [manualRiskPct, setManualRiskPct] = useState(1.0);
  const [manualEntryPrice, setManualEntryPrice] = useState<number | null>(null);
  const [manualTakeProfit, setManualTakeProfit] = useState<number | null>(null);
  const [manualStopLoss, setManualStopLoss] = useState<number | null>(null);
  const [backtestPendingOrders, setBacktestPendingOrders] = useState<any[]>([]);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const closingBacktestTradesRef = useRef<Set<string>>(new Set());

  const fetchBacktestTrades = useCallback(async () => {
    try {
      // 1. Sync immediately from fast in-memory session journal store
      const localTrades = useSessionJournalStore.getState().getTradesByMode('BACKTEST');
      const localAccount = useSessionJournalStore.getState().backtestAccount;
      if (localTrades.length > 0) {
        setBacktestTrades(localTrades as unknown as TradeRecord[]);
        setBacktestAccount(localAccount as any);
      }

      // 2. Background cloud DB sync fallback
      const res = await fetch('/api/backtest-trades');
      if (res.ok) {
        const json = await res.json();
        const combined = json.trades || localTrades;
        setBacktestTrades(combined);
        if (json.account) {
          setBacktestAccount(json.account);
        }
      }
    } catch (err) {
      console.debug('[Backtest] Cloud DB fetch skipped (in-memory journal preserved):', err);
    } finally {
      setIsLoadingTrades(false);
    }
  }, []);

  useEffect(() => {
    fetchBacktestTrades();
  }, [fetchBacktestTrades]);

  // Sync replayed trade executions with table states
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleRefresh = () => {
      fetchBacktestTrades();
    };
    window.addEventListener('backtest-trades-refresh', handleRefresh);
    return () => {
      window.removeEventListener('backtest-trades-refresh', handleRefresh);
    };
  }, [fetchBacktestTrades]);

  // Candle price extracts
  const lastCandle = engine.visibleArrays?.candles_5m.slice(-1)[0] ?? null;
  const lastPrice = lastCandle?.c ?? null;

  // Map replayed 5m candle as a closed liveCandle for Strategy Evaluator temporal gating
  const liveCandle = lastCandle
    ? {
      t: lastCandle.t,
      time: lastCandle.t / 1000,
      open: lastCandle.o,
      high: lastCandle.h,
      low: lastCandle.l,
      close: lastCandle.c,
      volume: lastCandle.v,
      isClosed: true,
    }
    : null;
 
  // ── Dedicated Sweep & Reclaim Replay Execution Engine (Zero Look-Ahead Bias) ──
  const backtestSr = useBacktestStrategyExecution({
    visibleArrays: engine.visibleArrays,
    activeTimeframe,
    currentIndex: engine.currentIndex,
    lastPrice,
    lastCandle,
    triggerSmartAlert,
    accountEquity: backtestAccount ? parseFloat(String(backtestAccount.current_balance)) : 10000,
    onTradesRefresh: fetchBacktestTrades,
  });

  // ── Manual Trading Hook Effects & Submission Handler ───────────────────────
  const handleSetDirection = (d: 'LONG' | 'SHORT') => {
    setManualDirection(d);
    setManualTakeProfit(null);
    setManualStopLoss(null);
  };

  // Initialize manual prices with ATR and snap to active replay candle
  useEffect(() => {
    if (isManualTradingActive) {
      const chartCandles = (() => {
        if (!engine.visibleArrays) return [];
        if (activeTimeframe === '1h') return engine.visibleArrays.candles_1h;
        if (activeTimeframe === '15m') return engine.visibleArrays.candles_15m;
        return engine.visibleArrays.candles_5m;
      })();
      const currentEntry = lastPrice || (chartCandles.length > 0 ? chartCandles[chartCandles.length - 1].c : 0);
      
      setManualEntryPrice((prev) => (prev === null || manualOrderType === 'MARKET') ? currentEntry : prev);
      
      const atr = calculateATR(chartCandles) || (currentEntry * 0.01);
      
      setManualTakeProfit((prev) => {
        if (prev !== null) return prev;
        return manualDirection === 'LONG' ? currentEntry + (3.0 * atr) : currentEntry - (3.0 * atr);
      });
      
      setManualStopLoss((prev) => {
        if (prev !== null) return prev;
        return manualDirection === 'LONG' ? currentEntry - (1.5 * atr) : currentEntry + (1.5 * atr);
      });
    } else {
      setManualEntryPrice(null);
      setManualTakeProfit(null);
      setManualStopLoss(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManualTradingActive, manualDirection, manualOrderType]);

  // Lock entry price to last price if MARKET is active
  useEffect(() => {
    if (isManualTradingActive && manualOrderType === 'MARKET' && lastPrice) {
      setManualEntryPrice(lastPrice);
    }
  }, [isManualTradingActive, manualOrderType, lastPrice]);

  // Backtest pending resting orders execution logic
  useEffect(() => {
    if (backtestPendingOrders.length === 0) return;
    if (!lastCandle) return;

    const triggered = backtestPendingOrders.filter((order) => {
      if (order.orderType === 'LIMIT') {
        return order.direction === 'LONG' 
          ? lastCandle.l <= order.entryPrice 
          : lastCandle.h >= order.entryPrice;
      } else { // STOP order
        return order.direction === 'LONG' 
          ? lastCandle.h >= order.entryPrice 
          : lastCandle.l <= order.entryPrice;
      }
    });

    if (triggered.length === 0) return;

    triggered.forEach(async (order) => {
      try {
        const res = await fetch('/api/backtest-trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: 'ETHUSDC',
            direction: order.direction,
            entry_price: order.entryPrice,
            stop_loss: order.stopLoss,
            take_profit: order.takeProfit,
            risk_percent: order.riskPct,
            strategy_name: `Manual Replay ${order.orderType} Order`,
            current_price: order.entryPrice,
            ipda_metrics: engine.enrichedPayload,
          }),
        });

        if (res.ok) {
          if (typeof window !== 'undefined') {
            const audio = new Audio('/sounds/flow_state.wav');
            audio.play().catch(() => {});
          }
          window.dispatchEvent(new Event('backtest-trades-refresh'));
          fetchBacktestTrades();
        } else {
          console.error('[Manual Trading] Failed to execute pending backtest order:', res.statusText);
        }
      } catch (e) {
        console.error('[Manual Trading] Error executing pending backtest order:', e);
      }
    });

    // Remove the triggered orders from the pending list
    setBacktestPendingOrders((prev) => 
      prev.filter((order) => !triggered.some((t) => t.id === order.id))
    );
  }, [engine.currentIndex, backtestPendingOrders, lastCandle]);

  // Backtest active open trades SL/TP hit logic (Replay Auto-Closure)
  useEffect(() => {
    const openTrades = backtestTrades.filter((t) => t.status === 'OPEN');

    // Clean up locking ref for any trades that are no longer open in state
    closingBacktestTradesRef.current.forEach((id) => {
      if (!openTrades.some((t) => t.id === id)) {
        closingBacktestTradesRef.current.delete(id);
      }
    });

    if (openTrades.length === 0) return;
    if (!lastCandle) return;

    openTrades.forEach(async (trade) => {
      // Gate against duplicate pending closure requests
      if (closingBacktestTradesRef.current.has(trade.id)) {
        return;
      }

      const entryPrice = parseFloat(String(trade.entry_price));
      const stopLoss = parseFloat(String(trade.stop_loss));
      const takeProfit = parseFloat(String(trade.take_profit));
      const direction = trade.direction;

      let isBreached = false;
      let exitPrice = entryPrice;

      if (direction === 'LONG') {
        if (lastCandle.l <= stopLoss) {
          isBreached = true;
          exitPrice = stopLoss;
        } else if (lastCandle.h >= takeProfit) {
          isBreached = true;
          exitPrice = takeProfit;
        }
      } else if (direction === 'SHORT') {
        if (lastCandle.h >= stopLoss) {
          isBreached = true;
          exitPrice = stopLoss;
        } else if (lastCandle.l <= takeProfit) {
          isBreached = true;
          exitPrice = takeProfit;
        }
      }

      if (isBreached) {
        // Lock this trade ID
        closingBacktestTradesRef.current.add(trade.id);

        try {
          const res = await fetch('/api/backtest-trades', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trade_id: trade.id,
              status: 'CLOSED',
              exit_price: exitPrice,
              closed_at: new Date(lastCandle.t).toISOString(),
            }),
          });

          if (res.ok) {
            if (typeof window !== 'undefined') {
              const isProfit = direction === 'LONG' ? exitPrice >= entryPrice : exitPrice <= entryPrice;
              const audio = new Audio(isProfit ? '/sounds/pricing_shift.wav' : '/sounds/dead_zone.wav');
              audio.play().catch(() => {});
            }
            window.dispatchEvent(new Event('backtest-trades-refresh'));
            fetchBacktestTrades();
          } else {
            console.error('[Manual Trading] Failed to auto-close backtest trade:', res.statusText);
            // Unlock on failure to allow retry
            closingBacktestTradesRef.current.delete(trade.id);
          }
        } catch (e) {
          console.error('[Manual Trading] Error auto-closing backtest trade:', e);
          // Unlock on error to allow retry
          closingBacktestTradesRef.current.delete(trade.id);
        }
      }
    });
  }, [engine.currentIndex, backtestTrades, lastCandle, fetchBacktestTrades]);

  const handleSubmitManualOrder = async () => {
    if (manualEntryPrice === null || manualStopLoss === null || manualTakeProfit === null) return;

    // Strict directional checks
    if (manualDirection === 'LONG') {
      if (manualTakeProfit <= manualEntryPrice) {
        alert('Validation failed: LONG Order Take Profit (TP) must be greater than Entry Price.');
        return;
      }
      if (manualStopLoss >= manualEntryPrice) {
        alert('Validation failed: LONG Order Stop Loss (SL) must be less than Entry Price.');
        return;
      }
    } else if (manualDirection === 'SHORT') {
      if (manualTakeProfit >= manualEntryPrice) {
        alert('Validation failed: SHORT Order Take Profit (TP) must be less than Entry Price.');
        return;
      }
      if (manualStopLoss <= manualEntryPrice) {
        alert('Validation failed: SHORT Order Stop Loss (SL) must be greater than Entry Price.');
        return;
      }
    }

    if (manualOrderType === 'MARKET') {
      setIsSubmittingManual(true);
      try {
        const balance = backtestAccount ? parseFloat(String(backtestAccount.current_balance)) : 10000;
        const riskUsd = (balance * (manualRiskPct / 100));
        const riskDist = Math.abs(manualEntryPrice - manualStopLoss) || 1.0;
        const size = parseFloat((riskUsd / riskDist).toFixed(3));

        // 1. Record immediately into in-memory session journal
        useSessionJournalStore.getState().addTrade({
          symbol: 'ETHUSDC',
          direction: manualDirection,
          entry_price: manualEntryPrice,
          stop_loss: manualStopLoss,
          take_profit: manualTakeProfit,
          position_size: size,
          risk_amount_usd: riskUsd,
          risk_percent: manualRiskPct,
          strategy_name: 'Manual Replay Market Order',
          status: 'OPEN',
          mode: 'BACKTEST',
          opened_at: lastCandle ? new Date(lastCandle.t).toISOString() : new Date().toISOString(),
          ipda_metrics: engine.enrichedPayload as any,
        });

        if (typeof window !== 'undefined') {
          const audio = new Audio('/sounds/flow_state.wav');
          audio.play().catch(() => {});
        }
        fetchBacktestTrades();
        setIsManualTradingActive(false);

        // 2. Fire-and-forget background cloud sync
        fetch('/api/backtest-trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: 'ETHUSDC',
            direction: manualDirection,
            entry_price: manualEntryPrice,
            stop_loss: manualStopLoss,
            take_profit: manualTakeProfit,
            risk_percent: manualRiskPct,
            strategy_name: 'Manual Replay Market Order',
            current_price: manualEntryPrice,
            ipda_metrics: engine.enrichedPayload,
          }),
        }).catch(() => {});
      } catch (e) {
        console.error('[Manual Trading] Submit error:', e);
      } finally {
        setIsSubmittingManual(false);
      }
    } else {
      const newPending = {
        id: `pending-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        orderType: manualOrderType,
        direction: manualDirection,
        entryPrice: manualEntryPrice,
        takeProfit: manualTakeProfit,
        stopLoss: manualStopLoss,
        riskPct: manualRiskPct,
      };

      setBacktestPendingOrders((prev) => [...prev, newPending]);

      if (typeof window !== 'undefined') {
        const audio = new Audio('/sounds/pricing_shift.wav');
        audio.play().catch(() => {});
        alert(`[${manualOrderType} PLACED] ${manualDirection} order at $${manualEntryPrice.toFixed(2)} is now queued in local backtest memory.`);
      }

      setIsManualTradingActive(false);
    }
  };

  const handleExecuteBacktestTrade = async (setup: PotentialTrade) => {
    const isCompleted = setup.status === 'TARGET_HIT' || setup.status === 'INVALIDATED';
    const isWin = setup.status === 'TARGET_HIT';
    const direction = setup.direction === 'BULLISH' ? 'LONG' : 'SHORT';
    const entryPrice = parseFloat((setup.openPrice ?? ((setup.entryMin + setup.entryMax) / 2)).toFixed(2));
    const exitPrice = isCompleted
      ? parseFloat((setup.closePrice ?? (isWin ? setup.target1 : setup.stopLoss)).toFixed(2))
      : undefined;

    let realizedPnl: number | undefined = undefined;
    if (isCompleted && exitPrice !== undefined) {
      const diff = direction === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;
      realizedPnl = parseFloat(diff.toFixed(2));
    }

    const lastCandle = (engine.enrichedPayload?.data_payload as any)?.candles_5m?.slice(-1)[0];
    const openTimeStr = setup.openTime || (lastCandle ? new Date(lastCandle.t).toISOString() : new Date().toISOString());
    const closeTimeStr = isCompleted ? (setup.closeTime || new Date().toISOString()) : undefined;

    const summaryText = isCompleted
      ? `[COMPLETED - ${isWin ? 'TARGET HIT 🎯' : 'INVALIDATED 🚫'}] ${setup.type}: ${setup.trigger}\nEntry: $${entryPrice.toFixed(2)} | Exit: $${exitPrice?.toFixed(2)} | Open: ${openTimeStr} | Close: ${closeTimeStr} | TP2: $${setup.target2.toFixed(2)} | ${setup.confluence}`
      : `${setup.confluence} | TP2: $${setup.target2.toFixed(2)}`;

    try {
      const res = await fetch('/api/backtest-trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'ETHUSDC',
          direction,
          entry_price: entryPrice,
          exit_price: exitPrice,
          stop_loss: setup.stopLoss,
          take_profit: setup.target1,
          strategy_name: `Quant Setup (${setup.id})`,
          notes: summaryText,
          status: isCompleted ? 'CLOSED' : 'OPEN',
          outcome: isCompleted ? (isWin ? 'WIN' : 'LOSS') : undefined,
          pnl: realizedPnl,
          realized_pnl: realizedPnl,
          created_at: openTimeStr,
          opened_at: openTimeStr,
          closed_at: closeTimeStr,
        }),
      });

      if (res.ok) {
        if (typeof window !== 'undefined') {
          const audio = new Audio('/sounds/pricing_shift.wav');
          audio.play().catch(() => {});
          window.dispatchEvent(new Event('backtest-trades-refresh'));
        }
        fetchBacktestTrades();
      } else {
        const err = await res.json();
        alert(`Failed to execute backtest setup: ${err.error || res.statusText}`);
      }
    } catch (err) {
      console.error('[Backtest] Failed to execute setup:', err);
    }
  };


  const handleUpdateBacktestTradeLevels = async (tradeId: string, tp: number | null, sl: number | null) => {
    try {
      const res = await fetch('/api/backtest-trades', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade_id: tradeId,
          take_profit: tp,
          stop_loss: sl,
        }),
      });

      if (res.ok) {
        if (typeof window !== 'undefined') {
          const audio = new Audio('/sounds/pricing_shift.wav');
          audio.play().catch(() => {});
        }
        window.dispatchEvent(new Event('backtest-trades-refresh'));
        fetchBacktestTrades();
      } else {
        const json = await res.json();
        console.error('[Manual Trading] Failed to update backtest trade levels:', json.error);
      }
    } catch (e) {
      console.error('[Manual Trading] Error updating backtest trade levels:', e);
    }
  };

  // ── Parse AI analysis response for the HUD Bar ──────────────────────────────
  let parsedAiResponse: any = null;
  let masterBias = 'NEUTRAL';
  if (aiAnalysis) {
    try {
      let candidate = aiAnalysis.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)?.[1];
      if (!candidate) {
        const start = aiAnalysis.indexOf('{');
        const end = aiAnalysis.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          candidate = aiAnalysis.slice(start, end + 1);
        } else {
          candidate = aiAnalysis;
        }
      }
      parsedAiResponse = JSON.parse(candidate.trim());
      masterBias = parsedAiResponse?.bias_label || parsedAiResponse?.diagnostics?.master_bias || 'NEUTRAL';
    } catch (e) {
      console.error('[Backtest] Failed to parse AI Analysis JSON for Master Bias:', e);
    }
  }

  // Strategy Execution Engine — re-evaluates automatically on replayed steps
  const { refetchStrategies } = useStrategyEvaluator({
    isBacktest: true,
    data: engine.enrichedPayload as unknown as MarketDataPayload,
    livePrice: lastPrice,
    liveCandle: liveCandle as unknown as LiveCandle,
    aiBias: aiBias,
    triggerSmartAlert,
    activeInterval: activeTimeframe as any
  });

  // Dynamic backtest statistics calculations
  const closedTrades = backtestTrades.filter((t: any) => t.status === "CLOSED");
  const winningTrades = closedTrades.filter((t: any) => parseFloat(String(t.realized_pnl || 0)) > 0);
  const totalRealizedPnL = closedTrades.reduce((sum, t) => sum + parseFloat(String(t.realized_pnl || 0)), 0);

  const winRate = closedTrades.length > 0
    ? (winningTrades.length / closedTrades.length) * 100
    : 0;

  const initialCapital = backtestAccount ? parseFloat(String(backtestAccount.initial_capital)) : 10000;
  const returnPercentage = (totalRealizedPnL / initialCapital) * 100;

  // Max drawdown walk
  let maxDrawdown = 0;
  let peak = initialCapital;
  let runningBalance = initialCapital;

  const sortedClosedTrades = [...closedTrades].sort(
    (a, b) => new Date(a.created_at || a.timestamp).getTime() - new Date(b.created_at || b.timestamp).getTime()
  );

  for (const t of sortedClosedTrades) {
    runningBalance += parseFloat(String(t.realized_pnl || 0));
    if (runningBalance > peak) {
      peak = runningBalance;
    }
    const drawdown = ((peak - runningBalance) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  const handleCountChange = (tf: '5m' | '15m' | '1h' | '4h', value: string) => {
    const num = parseInt(value, 10);
    setCounts(prev => ({ ...prev, [tf]: isNaN(num) ? 0 : num }));
  };

  // keyboard shortcuts
  const handleKey = useCallback((e: KeyboardEvent) => {
    const activeEl = document.activeElement;
    if (
      activeEl &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.getAttribute('contenteditable') === 'true')
    ) {
      return; // Ignore key bindings if user is typing
    }

    if (e.key === 't' || e.key === 'T') {
      setIsManualTradingActive((prev) => !prev);
      return;
    }

    if (engine.status !== 'ready') return;
    if (e.key === 'ArrowRight') engine.nextCandle();
    if (e.key === 'ArrowLeft') engine.prevCandle();
    if (e.key === 'r' || e.key === 'R') engine.revealDay();
  }, [engine]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // copy with feedback
  const handleCopy = async () => {
    await engine.copyPayload(counts);
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 2000);
  };

  // Which candle array feeds the chart?
  const chartData = (() => {
    if (!engine.visibleArrays) return [];
    if (activeTimeframe === '1h') return engine.visibleArrays.candles_1h;
    if (activeTimeframe === '15m') return engine.visibleArrays.candles_15m;
    return engine.visibleArrays.candles_5m;
  })();

  const cairoTime = lastCandle
    ? new Date(lastCandle.t).toLocaleTimeString('en-EG', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    : '--:--';

  const progressPct = engine.totalCandles > 0
    ? Math.round((engine.currentIndex / engine.totalCandles) * 100)
    : 0;

  return (
    <main className="flex flex-col h-[calc(100vh-56px)] w-full bg-background text-foreground font-sans overflow-hidden selection:bg-accent/30 transition-colors duration-300 relative">

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-15%] left-[-5%] w-[45%] h-[45%] rounded-full bg-accent/5 blur-[140px]" />
        <div className="absolute bottom-[-10%] right-[5%] w-[35%] h-[35%] rounded-full bg-accent/3 blur-[120px]" />
      </div>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="relative z-40 h-14 lg:h-16 border-b border-card-border flex items-center justify-between px-4 lg:px-8 bg-card/45 backdrop-blur-md shrink-0 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-slate-500 dark:text-zinc-400 hover:text-foreground transition-colors text-sm font-black shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">LIVE HUD</span>
          </Link>

          <span className="text-card-border hidden sm:inline">|</span>

          <div className="w-2 h-6 rounded-full bg-accent shrink-0 animate-pulse" />
          <h1 className="text-base lg:text-xl font-black text-foreground tracking-tight truncate">
            MARKET REPLAY ENGINE
          </h1>
          <span className="px-2.5 py-0.5 rounded-lg bg-accent/15 text-[10px] font-black text-accent border border-accent/20 shrink-0 uppercase tracking-wider">
            BACKTESTING
          </span>
        </div>

        {/* Timeframe dropdown & Command Center */}
        <div className="flex items-center gap-3 shrink-0 select-none">
          {/* Command Center */}
          <button
            onClick={() => {
              setCommandCenterTab('strategy');
              setIsSoundSettingsOpen(true);
            }}
            className="bg-card border border-card-border hover:border-accent text-slate-500 dark:text-zinc-400 hover:text-foreground px-3.5 py-2 font-mono text-[10px] font-black uppercase tracking-widest transition-all rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm"
            title="Open Command Center"
          >
            <Settings className="w-3.5 h-3.5 text-accent" />
            <span className="hidden sm:inline">[ COMMAND CENTER ]</span>
          </button>

          {/* Potential Trades Modal Trigger */}
          <button
            onClick={() => setIsPotentialTradesOpen(true)}
            className="bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 px-3.5 py-2 font-mono text-[10px] font-black uppercase tracking-widest transition-all rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm"
            title="Open Replay Potential Trades Modal"
          >
            <Zap className="w-3.5 h-3.5 text-purple-400" />
            <span>[ POTENTIAL TRADES ]</span>
          </button>

          {/* Replay Strategy Preset Dropdown */}
          <div className="relative inline-block text-left">
            <button
              onClick={() => setIsStrategyDropdownOpen(!isStrategyDropdownOpen)}
              className={`border px-3.5 py-2 font-mono text-[10px] font-black uppercase tracking-widest transition-all rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm ${
                backtestSr.isAutoExecuteEnabled
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                  : 'bg-card border-card-border text-slate-500 dark:text-zinc-400 hover:text-foreground hover:border-accent'
              }`}
              title="Select Replay Quantitative Strategy & Preset"
            >
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">STRATEGY: PM BREAKER BLOCK</span>
              <span className="sm:hidden">S&R</span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isStrategyDropdownOpen ? 'rotate-90 text-emerald-400' : ''}`} />
            </button>

            {isStrategyDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsStrategyDropdownOpen(false)}
                />
                <div className="absolute right-0 z-40 mt-1.5 w-72 origin-top-right rounded-2xl bg-card border border-card-border shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-1 duration-150 p-2 space-y-2">
                  <div className="px-2 pt-1 flex items-center justify-between border-b border-card-border/40 pb-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted">S&R Presets</span>
                    <button
                      type="button"
                      onClick={backtestSr.toggleAutoExecute}
                      className={`text-[8px] font-black uppercase px-2 py-0.5 rounded border transition-all cursor-pointer ${
                        backtestSr.isAutoExecuteEnabled
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                          : 'bg-card-border/40 text-muted border-card-border'
                      }`}
                    >
                      {backtestSr.isAutoExecuteEnabled ? '⚡ AUTO-EXEC ON' : '⏸️ AUTO-EXEC OFF'}
                    </button>
                  </div>

                  <div className="max-h-56 overflow-y-auto space-y-1 scrollbar-thin">
                    {backtestSr.availablePresets.map((preset) => {
                      const isSelected = preset.id === backtestSr.selectedPresetId;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => {
                            backtestSr.selectPreset(preset.id);
                            setIsStrategyDropdownOpen(false);
                          }}
                          className={`w-full text-left p-2 rounded-xl transition-all flex flex-col gap-0.5 cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                              : 'hover:bg-accent/5 text-foreground border border-transparent'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-tight">{preset.name}</span>
                            {isSelected && <Check className="w-3 h-3 text-emerald-400 shrink-0" />}
                          </div>
                          {preset.description && (
                            <span className="text-[8.5px] text-muted line-clamp-1">{preset.description}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Manual Trading Toggle */}
          <button
            onClick={() => setIsManualTradingActive((prev) => !prev)}
            className={`border px-3.5 py-2 font-mono text-[10px] font-black uppercase tracking-widest transition-all rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm ${
              isManualTradingActive
                ? 'bg-accent text-accent-foreground border-accent shadow-[0_0_12px_rgba(168,85,247,0.2)]'
                : 'bg-card border-card-border text-slate-500 dark:text-zinc-400 hover:text-foreground hover:border-accent'
            }`}
          >
            <Shield size={12} className={isManualTradingActive ? 'animate-pulse' : ''} />
            <span>[ MANUAL TRADING ]</span>
          </button>

          {/* Timeframe dropdown */}
          <div className="relative inline-block text-left">
            <button
              onClick={() => setIsTfDropdownOpen(!isTfDropdownOpen)}
              className="bg-card border border-card-border hover:border-accent text-slate-500 dark:text-zinc-400 hover:text-foreground px-4 py-2 font-mono text-[10px] font-black uppercase tracking-widest transition-all rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm"
              id="bt-timeframe-dropdown"
            >
              <span>TIMEFRAME: {activeTimeframe.toUpperCase()}</span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isTfDropdownOpen ? 'rotate-90 text-accent' : ''}`} />
            </button>

            {isTfDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsTfDropdownOpen(false)}
                />
                <div className="absolute right-0 z-40 mt-1.5 w-32 origin-top-right rounded-xl bg-card border border-card-border shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="py-1">
                    {(['5m', '15m', '1h'] as const).map((tf) => {
                      const isActive = activeTimeframe === tf;
                      return (
                        <button
                          key={tf}
                          onClick={() => {
                            setActiveTimeframe(tf);
                            setIsTfDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 font-mono text-[10px] font-black tracking-widest uppercase cursor-pointer transition-all duration-150 first:rounded-t-xl last:rounded-b-xl ${isActive
                              ? 'bg-accent/10 text-accent border-l-2 border-accent'
                              : 'text-slate-500 dark:text-zinc-400 hover:text-foreground hover:bg-accent/5 border-l-2 border-transparent'
                            }`}
                        >
                          {tf.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Sidebar Toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`bg-card border border-card-border hover:border-accent px-3.5 py-2 font-mono text-[10px] font-black uppercase tracking-widest transition-all rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm ${sidebarOpen ? 'text-accent border-accent/35 shadow-[0_0_12px_rgba(var(--accent),0.12)]' : 'text-slate-500 dark:text-zinc-400 hover:text-foreground'
              }`}
            title="Toggle HUD Sidebar"
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">[ HUD SIDEBAR ]</span>
          </button>
        </div>
      </header>

      {/* ── 3 Unified Visual HUD Cards (Parity with Live HUD) ────────── */}
      <DashboardMetrics
        masterBias={masterBias}
        pricing={(engine.enrichedPayload?.ipda_metrics as any)?.pricing_context?.local_dealing_range?.current_status || 'SCANNING'}
        targetStatus={(engine.enrichedPayload?.ipda_metrics as any)?.target_status || 'PENDING'}
      />

      {/* ── Body: controls + chart ────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative z-10">

        {/* ── Left control panel ──────────────────────────────────────────── */}
        <aside className="w-72 shrink-0 border-r border-card-border bg-card/25 backdrop-blur-sm flex flex-col gap-4 p-5 overflow-y-auto transition-colors">

          {/* Section: Date & Range Configuration ───────────────────── */}
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Replay Range Configuration</p>

            {/* From Date & Time */}
            <div className="p-2.5 rounded-xl border border-card-border bg-card/40 space-y-2">
              <span className="text-[10px] font-black text-accent uppercase tracking-wider block">Start Anchor (From)</span>
              
              <div className="flex flex-col gap-1">
                <label htmlFor="bt-start-date" className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
                  <Calendar className="w-3 h-3 text-accent" />
                  Start Date
                </label>
                <input
                  id="bt-start-date"
                  type="date"
                  value={engine.startDate}
                  onChange={(e) => engine.setStartDate(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3 py-1.5 text-xs text-foreground rounded-lg transition-all shadow-sm [color-scheme:dark]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="bt-start-time" className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
                  <Clock className="w-3 h-3 text-accent" />
                  Start Time (Cairo)
                </label>
                <input
                  id="bt-start-time"
                  type="time"
                  value={engine.startTime}
                  onChange={(e) => engine.setStartTime(e.target.value)}
                  className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3 py-1.5 text-xs text-foreground rounded-lg transition-all shadow-sm [color-scheme:dark]"
                />
              </div>
            </div>

            {/* To Date & Time */}
            <div className="p-2.5 rounded-xl border border-card-border bg-card/40 space-y-2">
              <span className="text-[10px] font-black text-accent uppercase tracking-wider block">End Target (To)</span>
              
              <div className="flex flex-col gap-1">
                <label htmlFor="bt-end-date" className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
                  <Calendar className="w-3 h-3 text-accent" />
                  End Date
                </label>
                <input
                  id="bt-end-date"
                  type="date"
                  value={engine.endDate}
                  onChange={(e) => engine.setEndDate(e.target.value)}
                  min={engine.startDate}
                  max={new Date().toISOString().slice(0, 10)}
                  className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3 py-1.5 text-xs text-foreground rounded-lg transition-all shadow-sm [color-scheme:dark]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="bt-end-time" className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
                  <Clock className="w-3 h-3 text-accent" />
                  End Time (Cairo)
                </label>
                <input
                  id="bt-end-time"
                  type="time"
                  value={engine.endTime}
                  onChange={(e) => engine.setEndTime(e.target.value)}
                  className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3 py-1.5 text-xs text-foreground rounded-lg transition-all shadow-sm [color-scheme:dark]"
                />
              </div>
            </div>

            {/* Load Range button */}
            <button
              id="bt-load-day"
              onClick={engine.loadDay}
              disabled={engine.status === 'fetching'}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                         bg-accent/15 border border-accent/20
                         text-accent font-black text-sm hover:bg-accent/25
                         disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer
                         shadow-sm"
            >
              {engine.status === 'fetching' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Fetching Range…</>
              ) : (
                <><BarChart2 className="w-4 h-4" /> Load Replay Range</>
              )}
            </button>
          </div>

          {/* Section: Replay Quantitative Strategy (Sweep & Reclaim) ───── */}
          <div className="flex flex-col gap-3 p-3.5 rounded-2xl border border-card-border bg-card/40 backdrop-blur-md shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-accent animate-pulse" />
                <span className="text-[11px] font-black text-foreground uppercase tracking-wider">
                  Sweep & Reclaim
                </span>
              </div>
              <button
                type="button"
                onClick={backtestSr.toggleAutoExecute}
                className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                  backtestSr.isAutoExecuteEnabled
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-card-border/40 text-muted border-card-border'
                }`}
                title="Toggle Auto-Execution in Replay"
              >
                {backtestSr.isAutoExecuteEnabled ? '⚡ AUTO ON' : 'PAUSED'}
              </button>
            </div>

            {/* PM Volumetric Setup Controls */}
            <div className="space-y-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase flex justify-between">
                  <span>C2 Volume Ratio</span>
                  <span className="text-emerald-400 font-mono">{(backtestSr.config.volumeExpansionThreshold ?? 1.5).toFixed(2)}x</span>
                </label>
                <input
                  type="range"
                  min="1.0"
                  max="2.5"
                  step="0.05"
                  value={backtestSr.config.volumeExpansionThreshold ?? 1.50}
                  onChange={(e) => backtestSr.updateConfig({ volumeExpansionThreshold: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-400 h-1 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase flex justify-between">
                  <span>Phase 3 TTL (Reclaim)</span>
                  <span className="text-emerald-400 font-mono">{backtestSr.config.maxBarsSweepToReclaim ?? 50} bars</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={backtestSr.config.maxBarsSweepToReclaim ?? 50}
                  onChange={(e) => backtestSr.updateConfig({ maxBarsSweepToReclaim: parseInt(e.target.value, 10) })}
                  className="w-full accent-emerald-400 h-1 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase flex justify-between">
                  <span>Phase 4 TTL (Retest)</span>
                  <span className="text-emerald-400 font-mono">{backtestSr.config.maxBarsToRetest ?? 24} bars</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="200"
                  step="1"
                  value={backtestSr.config.maxBarsToRetest ?? 24}
                  onChange={(e) => backtestSr.updateConfig({ maxBarsToRetest: parseInt(e.target.value, 10) })}
                  className="w-full accent-emerald-400 h-1 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Active Setup Phase Monitor Card */}
            {backtestSr.activeSetup ? (
              <div className="bg-background/40 p-2.5 rounded-xl border border-card-border/80 space-y-1.5 text-[10px]">
                <div className="flex justify-between items-center">
                  <span className="font-bold uppercase text-foreground">
                    {backtestSr.activeSetup.anchor_name}
                  </span>
                  <span
                    className={`text-[8px] font-black uppercase px-1.5 py-0.2 rounded border ${
                      backtestSr.activeSetup.type === 'BULLISH'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    }`}
                  >
                    {backtestSr.activeSetup.type}
                  </span>
                </div>
                <div className="flex justify-between items-center text-muted font-mono text-[9px]">
                  <span>Anchor: ${backtestSr.activeSetup.anchor_level.toFixed(2)}</span>
                  <span>Entry: ${backtestSr.activeSetup.entry_price.toFixed(2)}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 pt-1 text-[8.5px] font-mono text-center">
                  <div className={`p-0.5 rounded border ${(backtestSr.activeSetup.reclaim_volume_expansion ?? 0) >= 1.5 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-card text-muted border-card-border'}`}>
                    {(backtestSr.activeSetup.reclaim_volume_expansion ?? 1.0).toFixed(1)}x Vol
                  </div>
                  <div className={`p-0.5 rounded border ${(backtestSr.activeSetup.reclaim_delta_dominance_pct ?? 0) >= 60 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-card text-muted border-card-border'}`}>
                    {(backtestSr.activeSetup.reclaim_delta_dominance_pct ?? 50.0).toFixed(0)}% Δ
                  </div>
                  <div className={`p-0.5 rounded border ${(backtestSr.activeSetup.reclaim_body_ratio ?? 0) >= 60 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-card text-muted border-card-border'}`}>
                    {(backtestSr.activeSetup.reclaim_body_ratio ?? 50.0).toFixed(0)}% Body
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[9.5px] text-muted italic text-center py-1.5 bg-background/20 rounded-lg border border-card-border/30">
                Awaiting 3-pillar displacement signal…
              </div>
            )}
          </div>

          {/* Section: Stats (only when ready) ───────────── */}
          {engine.status === 'ready' && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Session</p>
              <StatBadge label="Cairo Time" value={cairoTime} accent />
              <StatBadge label="Replay Range" value={engine.startDate === engine.endDate ? engine.startDate : `${engine.startDate} → ${engine.endDate}`} />
              <StatBadge label="Last Price" value={lastPrice !== null ? `$${lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '---'} />
              <StatBadge label="Candle" value={`${engine.currentIndex} / ${engine.totalCandles}`} />
              <StatBadge label="Progress" value={`${progressPct}%`} />

              {/* Progress bar */}
              <div className="w-full h-1.5 rounded-full bg-card-border overflow-hidden mt-1">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300 animate-pulse"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {engine.isDayRevealed && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-semibold">
                  <Eye className="w-3.5 h-3.5" /> Full range revealed
                </div>
              )}
            </div>
          )}

          {/* Section: Gemini Synthesis ───────────────── */}
          {engine.status === 'ready' && (
            <div className="flex flex-col gap-2 pt-3 border-t border-card-border select-none">
              <p className="text-[11px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Gemini Synthesis</p>
              <button
                onClick={async () => {
                  if (!engine.enrichedPayload) return;
                  await triggerAiAnalysisScan(engine.enrichedPayload as unknown as MarketDataPayload);
                }}
                disabled={isAnalyzing || !engine.enrichedPayload}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                               bg-accent text-white font-black text-xs hover:opacity-90
                               disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer
                               shadow-md hover:shadow-accent/25 active:scale-95"
              >
                {isAnalyzing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Synthesizing…</>
                ) : (
                  <><Brain className="w-4 h-4" /> Trigger AI Analysis</>
                )}
              </button>

              {aiAnalysis && (
                <div className="mt-2 max-h-36 overflow-y-auto text-[10px] text-emerald-500 leading-relaxed whitespace-pre-wrap bg-card p-3 rounded-lg border border-card-border font-mono select-text scrollbar-thin">
                  {aiAnalysis}
                </div>
              )}
            </div>
          )}

          {/* Error banner */}
          {engine.status === 'error' && (
            <div className="flex items-start gap-2 px-3 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{engine.error}</span>
            </div>
          )}

          <div className="flex-1" />

          {/* Section: AI Export ───────────────────────── */}
          {engine.status === 'ready' && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">AI Export</p>

              {/* ── Dynamic UI Inputs ───────────────────────────────────── */}
              <div className="bg-card/45 rounded-2xl p-4 border border-card-border backdrop-blur-md relative overflow-hidden mb-2 shadow-sm">
                <div className="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-full blur-3xl -mr-6 -mt-6 pointer-events-none" />
                <div className="flex items-center gap-2 mb-3 relative z-10">
                  <Brain className="w-4 h-4 text-accent shrink-0" />
                  <p className="text-xs font-black text-accent tracking-wide uppercase">AI Context Settings</p>
                </div>

                <div className="grid grid-cols-2 gap-3 relative z-10">
                  {(['5m', '15m', '1h', '4h'] as const).map((tf) => (
                    <div key={tf} className="flex flex-col bg-background/50 rounded-xl p-2 border border-card-border shadow-inner">
                      <label htmlFor={`input-${tf}`} className="text-[10px] text-slate-500 dark:text-zinc-400 font-black mb-1 uppercase text-center">{tf} Candles</label>
                      <input
                        id={`input-${tf}`}
                        type="number"
                        min="0"
                        value={counts[tf]}
                        onChange={(e) => handleCountChange(tf, e.target.value)}
                        className="w-full bg-transparent text-foreground text-sm font-black text-center outline-none border-b border-card-border focus:border-accent transition-colors font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Copy */}
              <button
                id="bt-copy-payload"
                onClick={handleCopy}
                disabled={!engine.enrichedPayload}
                className="w-full relative group overflow-hidden rounded-xl disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] cursor-pointer"
              >
                <span className={`absolute inset-0 rounded-xl transition-opacity duration-300 ${copyState === 'copied' ? 'bg-emerald-500 opacity-90' : 'bg-accent opacity-70 group-hover:opacity-100'}`} />
                <div className={`relative flex items-center justify-center gap-2 px-4 py-2.5 m-[1px] rounded-xl transition-all duration-300 ${copyState === 'copied' ? 'bg-transparent' : 'bg-background group-hover:bg-transparent'}`}>
                  {copyState === 'copied'
                    ? <><CheckCheck className="w-4 h-4 text-white" /><span className="font-black text-sm text-white">Copied!</span></>
                    : <><Zap className="w-4 h-4 text-accent group-hover:text-white transition-colors" /><span className="font-black text-sm text-white">⚡ Copy AI Context</span></>
                  }
                </div>
              </button>

              {/* Download */}
              <button
                id="bt-download-payload"
                onClick={() => engine.downloadPayload(counts)}
                disabled={!engine.enrichedPayload}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                           border border-card-border bg-card/10 hover:bg-card/25 hover:border-accent
                           text-slate-500 dark:text-zinc-400 hover:text-foreground font-black text-sm
                           disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Download JSON
              </button>

              <p className="text-[10px] text-slate-500 dark:text-zinc-500 font-bold uppercase text-center">
                Payload reflects visible candles only
              </p>
            </div>
          )}
        </aside>

        {/* ── Chart + replay controls + Journal ───────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto scrollbar-thin scrollbar-thumb-card-border scrollbar-track-transparent">

          {/* Chart area */}
          <div className="h-[740px] relative p-3 lg:p-5 shrink-0 min-h-0 flex flex-col gap-2">
            {/* Order Flow State Tracker & Chronological Timeline Ribbon */}
            <OrderFlowTimelineRibbon
              timeline={(engine.enrichedPayload?.ipda_metrics as any)?.order_flow_engine?.state_timeline}
              livePrice={lastPrice}
              onOpenModal={() => setIsOrderFlowModalOpen(true)}
              isBacktest={true}
            />

            <div className="flex-1 relative min-h-0">
            {engine.status === 'idle' && (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted">
                <div className="w-20 h-20 rounded-2xl bg-card border border-card-border flex items-center justify-center shadow-lg">
                  <BarChart2 className="w-9 h-9 text-accent/45" />
                </div>
                <div className="text-center select-none font-sans">
                  <p className="text-sm font-black text-slate-500 dark:text-zinc-400">Select a date and load the day</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1 font-bold uppercase">Full 24 h ETHUSDC klines will be fetched from Binance</p>
                </div>
              </div>
            )}

            {engine.status === 'fetching' && (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-10 h-10 text-accent animate-spin" />
                <p className="text-sm font-black text-slate-500 dark:text-zinc-400 animate-pulse uppercase">
                  Fetching 3 timeframes from Binance public REST…
                </p>
              </div>
            )}

            {(engine.status === 'ready' || engine.status === 'error') && (
              <div className="w-full h-full rounded-2xl overflow-hidden border border-card-border bg-card/20 backdrop-blur-xl shadow-2xl relative group">
                <div className="absolute inset-0 shadow-[inset_0_0_80px_rgba(var(--accent),0.01)] pointer-events-none z-10" />
                {engine.visibleArrays && chartData.length > 0
                  ? (
                    <Chart
                      data={chartData as any}
                      isBacktest={true}
                      marketContextData={engine.enrichedPayload as unknown as MarketDataPayload}
                      liveCandle={liveCandle as unknown as LiveCandle}
                      livePrice={lastPrice}
                      interval={activeTimeframe as any}
                      triggerSmartAlert={triggerSmartAlert}
                      isManualTradingActive={isManualTradingActive}
                      manualOrderType={manualOrderType}
                      manualDirection={manualDirection}
                      manualEntryPrice={manualEntryPrice}
                      manualTakeProfit={manualTakeProfit}
                      manualStopLoss={manualStopLoss}
                      onManualPricesChange={(entry, tp, sl) => {
                        setManualEntryPrice(entry);
                        setManualTakeProfit(tp);
                        setManualStopLoss(sl);
                      }}
                      openTrades={backtestTrades.filter((t) => t.status === 'OPEN')}
                      onUpdateTradeLevels={handleUpdateBacktestTradeLevels}
                      symbol="ETHUSDC"
                      srOverlay={backtestSr.srOverlay}
                    />
                  )
                  : (
                    <div className="w-full h-full flex items-center justify-center text-slate-500 dark:text-zinc-400 text-sm select-none font-black uppercase">
                      No visible candles yet — press Next Candle ⏩
                    </div>
                  )
                }
                {isManualTradingActive && (
                  <ManualOrderPanel
                    onClose={() => setIsManualTradingActive(false)}
                    orderType={manualOrderType}
                    setOrderType={setManualOrderType}
                    direction={manualDirection}
                    setDirection={handleSetDirection}
                    riskPct={manualRiskPct}
                    setRiskPct={setManualRiskPct}
                    entryPrice={manualEntryPrice}
                    setEntryPrice={setManualEntryPrice}
                    takeProfit={manualTakeProfit}
                    setTakeProfit={setManualTakeProfit}
                    stopLoss={manualStopLoss}
                    setStopLoss={setManualStopLoss}
                    balance={backtestAccount ? parseFloat(String(backtestAccount.current_balance)) : 10000}
                    onSubmit={handleSubmitManualOrder}
                    isSubmitting={isSubmittingManual}
                  />
                )}

                {/* Sleek Floating Glass Replay Controls (Centered Bottom Overlay) */}
                {engine.status === 'ready' && (
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 bg-card/60 backdrop-blur-xl border border-card-border px-6 py-3.5 rounded-2xl shadow-xl transition-all duration-300 hover:border-accent/40 select-none">

                    {/* Prev */}
                    <button
                      id="bt-prev-candle"
                      onClick={engine.prevCandle}
                      disabled={engine.currentIndex <= 1}
                      title="Previous Candle (←)"
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-card-border
                                 bg-card/30 hover:bg-card-hover/20 text-foreground font-black text-xs
                                 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer
                                 active:scale-95 shadow-sm"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span className="hidden sm:inline uppercase">Prev</span>
                    </button>

                    {/* Next */}
                    <button
                      id="bt-next-candle"
                      onClick={engine.nextCandle}
                      disabled={engine.currentIndex >= engine.totalCandles}
                      title="Next Candle (→)"
                      className="flex items-center gap-1.5 px-5 py-2 rounded-xl
                                 bg-accent text-white hover:opacity-95 font-black text-xs
                                 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer
                                 shadow-md hover:shadow-accent/25 transition-all duration-200 active:scale-95"
                    >
                      <span className="hidden sm:inline uppercase">Next</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>

                    {/* Divider */}
                    <div className="w-px h-6 bg-card-border" />

                    {/* Reveal Day */}
                    <button
                      id="bt-reveal-day"
                      onClick={engine.revealDay}
                      disabled={engine.isDayRevealed}
                      title="Reveal full day (R)"
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl
                                 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20
                                 text-emerald-600 dark:text-emerald-400 font-black text-xs
                                 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer
                                 transition-all duration-200 active:scale-95 shadow-sm"
                    >
                      <Eye className="w-4 h-4" />
                      <span className="hidden sm:inline uppercase">Reveal</span>
                    </button>

                    {/* Keyboard Shortcuts Hint */}
                    <div className="hidden lg:block text-[9px] text-slate-500 dark:text-zinc-500 font-bold uppercase tracking-wider pl-2 border-l border-card-border">
                      ← → KEYS
                    </div>

                  </div>
                )}
              </div>
            )}
            </div>
          </div>

          {/* Journal Table area */}
          {engine.status === 'ready' && (
            <div className="flex-1 p-4 lg:p-6 border-t border-card-border bg-card/10 relative z-10 shrink-0">
              <div className="flex justify-between items-center mb-4 select-none">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-4 rounded-full bg-accent" />
                  <h2 className="text-xs font-black uppercase tracking-[0.12em] text-foreground">
                    Backtest Strategy execution & journaling ledger
                  </h2>
                </div>
              </div>

              {/* Sleek, compact backtest performance overview row */}
              <div className="grid grid-cols-3 gap-3 mb-4 select-none">
                {/* Total P&L Card */}
                <div className={`glass-panel p-3 flex flex-col justify-between border ${totalRealizedPnL >= 0 ? 'border-emerald-500/20 shadow-[inset_0_0_12px_rgba(16,185,129,0.02)]' : 'border-rose-500/20 shadow-[inset_0_0_12px_rgba(244,63,94,0.02)]'}`}>
                  <span className="text-[9px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Backtest P&L</span>
                  <span className={`text-sm font-black font-mono ${totalRealizedPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {totalRealizedPnL >= 0 ? '+' : ''}${totalRealizedPnL.toFixed(2)} <span className="text-[10px] font-semibold opacity-90">({totalRealizedPnL >= 0 ? '+' : ''}{returnPercentage.toFixed(2)}%)</span>
                  </span>
                </div>
                {/* Win Rate Card */}
                <div className="glass-panel p-3 flex flex-col justify-between border border-accent/20">
                  <span className="text-[9px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Win Rate</span>
                  <span className="text-sm font-black font-mono text-accent">
                    {winRate.toFixed(1)}%
                  </span>
                </div>
                {/* Max Drawdown Card */}
                <div className="glass-panel p-3 flex flex-col justify-between border border-rose-500/20 shadow-[inset_0_0_12px_rgba(244,63,94,0.02)]">
                  <span className="text-[9px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Max Drawdown</span>
                  <span className="text-sm font-black font-mono text-rose-500">
                    -{maxDrawdown.toFixed(2)}%
                  </span>
                </div>
              </div>
              {isLoadingTrades ? (
                <div className="flex justify-center items-center py-12 text-xs font-mono uppercase text-muted">
                  <Loader2 className="w-4 h-4 animate-spin mr-2 text-accent" /> Loading Backtest Ledger...
                </div>
              ) : (
                <JournalTable
                  initialTrades={backtestTrades}
                  initialAccount={backtestAccount}
                  isBacktest={true}
                  backtestLivePrice={lastPrice}
                  backtestCandleTime={lastCandle?.t}
                />
              )}
            </div>
          )}

        </div>

        {/* ── Right HUD Sidebar Clone ─────────────────────────────────────── */}
        <BacktestSidebar
          enrichedPayload={engine.enrichedPayload}
          lastPrice={lastPrice}
          activeTimeframe={activeTimeframe}
          aiAnalysis={aiAnalysis}
          isAnalyzing={isAnalyzing}
          triggerAiAnalysisScan={triggerAiAnalysisScan}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          srOverlay={backtestSr.srOverlay}
        />
      </div>

      {/* Backtest Toast alerts */}
      <SmartAlertsToast activeAlerts={activeAlerts} dismissAlert={dismissAlert} />

      {/* Backtest Potential Trades Modal */}
      <BacktestPotentialTradesModal
        isOpen={isPotentialTradesOpen}
        onClose={() => setIsPotentialTradesOpen(false)}
        currentData={engine.enrichedPayload as unknown as MarketDataPayload}
        onExecuteTrade={handleExecuteBacktestTrade}
      />

      {/* Global Command Center Modal */}
      <SettingsModal
        isOpen={isSoundSettingsOpen}
        alert={null}
        initialTab={commandCenterTab}
        onClose={() => setIsSoundSettingsOpen(false)}
        onSave={() => {
          refetchStrategies();
        }}
        onDelete={() => {
          refetchStrategies();
        }}
      />
      {/* Order Flow State Timeline Modal for Backtest Replay */}
      <OrderFlowTimelineModal
        isOpen={isOrderFlowModalOpen}
        onClose={() => setIsOrderFlowModalOpen(false)}
        timeline={(engine.enrichedPayload?.ipda_metrics as any)?.order_flow_engine?.state_timeline}
        livePrice={lastPrice}
        symbol="ETHUSDC.backtest"
        isBacktest={true}
      />
    </main>
  );
}
