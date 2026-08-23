'use client';

import { useState, useEffect, memo, useCallback } from 'react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import Chart from '@/components/Chart';
import Sidebar from '@/components/Sidebar';
import SmartAlertsToast from '@/components/SmartAlertsToast';
import SettingsModal from '@/components/modals/SettingsModal';
import { Loader2, Menu, Settings, Shield, ChevronLeft } from 'lucide-react';
import { useStrategyEvaluator } from '@/hooks/useStrategyEvaluator';
import TimeframeSwitcher, { Timeframe } from '@/components/TimeframeSwitcher';
import { LiveTicker } from '@/components/LiveTicker';
import DashboardMetrics from '@/components/DashboardMetrics';
import ManualOrderPanel from '@/components/ManualOrderPanel';
import OrderFlowTimelineRibbon from '@/components/OrderFlowTimelineRibbon';
import OrderFlowTimelineModal from '@/components/modals/OrderFlowTimelineModal';
import LiveOrderBlockModal from '@/components/modals/LiveOrderBlockModal';
import LiveCockpitStatusBadge from '@/components/LiveCockpitStatusBadge';
import { useAutomatedStrategyExecution } from '@/hooks/useAutomatedStrategyExecution';
import { calculateATR } from '@/lib/riskEngine';
import { safeParseAiJson } from '@/lib/aiJsonParser';

const EMPTY_CANDLES: any[] = [];
const EMPTY_FVGS: any[] = [];

export default function Home() {
  const {
    data,
    isLoading,
    error,
    refetch,
    downloadV6,
    downloadV7Sliced,
    activeAlerts,
    dismissAlert,
    wsInterval,
    setWsInterval,
    aiAnalysis,
    signalAlertsEnabled,
  } = useMarketDataContext();

  const liveSr = useAutomatedStrategyExecution();

  const selectedInterval = wsInterval;
  const setSelectedInterval = setWsInterval;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSoundSettingsOpen, setIsSoundSettingsOpen] = useState(false);
  const [isOrderFlowModalOpen, setIsOrderFlowModalOpen] = useState(false);
  const [isLiveOBModalOpen, setIsLiveOBModalOpen] = useState(false);
  const [commandCenterTab, setCommandCenterTab] = useState<'strategy' | 'audio'>('strategy');
  const [counts, setCounts] = useState({ '5m': 60, '15m': 0, '1h': 72, '4h': 20 });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsSidebarCollapsed(localStorage.getItem('gem_sidebar_collapsed') === 'true');
    }
  }, []);

  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('gem_sidebar_collapsed', String(next));
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
      }
      return next;
    });
  };

  // ── Manual Trading States ──────────────────────────────────────────────────
  const [isManualTradingActive, setIsManualTradingActive] = useState(false);
  const [manualOrderType, setManualOrderType] = useState<'MARKET' | 'LIMIT' | 'STOP'>('MARKET');
  const [manualDirection, setManualDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [manualRiskPct, setManualRiskPct] = useState(1.0);
  const [manualEntryPrice, setManualEntryPrice] = useState<number | null>(null);
  const [manualTakeProfit, setManualTakeProfit] = useState<number | null>(null);
  const [manualStopLoss, setManualStopLoss] = useState<number | null>(null);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [accountBalance, setAccountBalance] = useState(10000);

  // Fetch account balance
  const fetchBalance = async () => {
    try {
      const res = await fetch('/api/account');
      if (res.ok) {
        const contentType = res.headers.get('content-type');
        if (contentType && !contentType.includes('application/json')) return;
        const json = await res.json();
        if (json.account) {
          setAccountBalance(parseFloat(json.account.current_balance));
        }
      }
    } catch (e) {
      console.error('[Manual Trading] Failed to fetch account balance:', e);
    }
  };

  const [openTrades, setOpenTrades] = useState<any[]>([]);

  // Fetch open trades
  const fetchOpenTrades = async () => {
    try {
      const res = await fetch('/api/trades');
      if (res.ok) {
        const contentType = res.headers.get('content-type');
        if (contentType && !contentType.includes('application/json')) return;
        const json = await res.json();
        if (json.trades) {
          const openOnly = json.trades.filter((t: any) => t.status === 'OPEN');
          setOpenTrades(openOnly);
        }
      }
    } catch (e) {
      console.error('[Manual Trading] Failed to fetch open trades:', e);
    }
  };

  const handleUpdateTradeLevels = async (tradeId: string, tp: number | null, sl: number | null) => {
    try {
      const res = await fetch('/api/trades', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade_id: tradeId,
          take_profit: tp,
          stop_loss: sl,
        }),
      });

      if (res.ok) {
        if (typeof window !== 'undefined' && signalAlertsEnabled?.PRICING_SHIFT !== false) {
          const audio = new Audio('/sounds/pricing_shift.wav');
          audio.play().catch(() => {});
        }
        window.dispatchEvent(new Event('trades-refresh'));
      } else {
        const json = await res.json();
        console.error('[Manual Trading] Failed to update trade levels:', json.error);
      }
    } catch (e) {
      console.error('[Manual Trading] Error updating trade levels:', e);
    }
  };

  useEffect(() => {
    fetchBalance();
    fetchOpenTrades();
  }, []);

  // Listen to trade refreshes to sync open trades list and account balance
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleRefresh = () => {
      fetchBalance();
      fetchOpenTrades();
    };
    window.addEventListener('trades-refresh', handleRefresh);
    return () => {
      window.removeEventListener('trades-refresh', handleRefresh);
    };
  }, []);

  // Global hotkey listener (t/T) to toggle Manual Trading Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSetDirection = (d: 'LONG' | 'SHORT') => {
    setManualDirection(d);
    setManualTakeProfit(null);
    setManualStopLoss(null);
  };

  // Initialize manual prices with ATR and current candle price
  useEffect(() => {
    if (isManualTradingActive) {
      const chartCandles = getChartData();
      const currentEntry = chartCandles.length > 0 ? chartCandles[chartCandles.length - 1].c : 0;
      
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

  const handleSubmitManualOrder = async (livePrice: number | null) => {
    const entry = manualOrderType === 'MARKET' ? livePrice : manualEntryPrice;
    if (entry === null || manualStopLoss === null || manualTakeProfit === null) return;

    // Strict directional checks
    if (manualDirection === 'LONG') {
      if (manualTakeProfit <= entry) {
        alert('Validation failed: LONG Order Take Profit (TP) must be greater than Entry Price.');
        return;
      }
      if (manualStopLoss >= entry) {
        alert('Validation failed: LONG Order Stop Loss (SL) must be less than Entry Price.');
        return;
      }
    } else if (manualDirection === 'SHORT') {
      if (manualTakeProfit >= entry) {
        alert('Validation failed: SHORT Order Take Profit (TP) must be less than Entry Price.');
        return;
      }
      if (manualStopLoss <= entry) {
        alert('Validation failed: SHORT Order Stop Loss (SL) must be greater than Entry Price.');
        return;
      }
    }

    if (manualOrderType === 'MARKET') {
      setIsSubmittingManual(true);
      try {
        const res = await fetch('/api/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: 'ETHUSDC',
            direction: manualDirection,
            entry_price: entry,
            stop_loss: manualStopLoss,
            take_profit: manualTakeProfit,
            risk_percent: manualRiskPct,
            strategy_name: 'Manual Market Order',
          }),
        });

        if (res.ok) {
          if (typeof window !== 'undefined' && signalAlertsEnabled?.DISPLACEMENT_CONFIRMED !== false) {
            const audio = new Audio('/sounds/flow_state.wav');
            audio.play().catch(() => {});
          }
          window.dispatchEvent(new Event('trades-refresh'));
          fetchBalance();
          setIsManualTradingActive(false);
        } else {
          const json = await res.json();
          alert(`Order execution failed: ${json.error}`);
        }
      } catch (e) {
        console.error('[Manual Trading] Submit error:', e);
        alert('Failed to send order.');
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

      setPendingOrders((prev) => [...prev, newPending]);

      if (typeof window !== 'undefined') {
        if (signalAlertsEnabled?.PRICING_SHIFT !== false) {
          const audio = new Audio('/sounds/pricing_shift.wav');
          audio.play().catch(() => {});
        }
        alert(`[${manualOrderType} PLACED] ${manualDirection} order at $${(manualEntryPrice as number).toFixed(2)} is now queued in local memory.`);
      }

      setIsManualTradingActive(false);
    }
  };

  // Strategy Execution Engine — runs silently in the background

  const getChartData = useCallback(() => {
    if (!data || !data.data_payload) return EMPTY_CANDLES;
    const key = `candles_${selectedInterval}`;
    return data.data_payload[key] ?? EMPTY_CANDLES;
  }, [data, selectedInterval]);

  const handleManualPricesChange = useCallback((entry: number | null, tp: number | null, sl: number | null) => {
    setManualEntryPrice(entry);
    setManualTakeProfit(tp);
    setManualStopLoss(sl);
  }, []);

  const currentPrice = data?.data_payload?.candles_5m?.slice(-1)[0]?.c ?? null;

  // ── Parse AI analysis response for the HUD Bar ──────────────────────────────
  let parsedAiResponse: any = safeParseAiJson(aiAnalysis);
  let masterBias = 'NEUTRAL';
  if (parsedAiResponse) {
    masterBias = parsedAiResponse?.bias_label || parsedAiResponse?.diagnostics?.master_bias || 'NEUTRAL';
  }

  const pricing = data?.ipda_metrics?.pricing_context?.local_dealing_range?.current_status || 'SCANNING';
  const targetStatus = data?.ipda_metrics?.target_status || 'PENDING';

  return (
    <main className="flex h-[calc(100vh-56px)] w-full bg-background overflow-hidden selection:bg-accent/30 font-sans transition-colors duration-300">
      {/* ── Left / Main column ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col relative min-w-0">
        {/* Alerts UI Floating overlay */}
        <SmartAlertsToast activeAlerts={activeAlerts || []} dismissAlert={dismissAlert} />

        {/* Background glow effects */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-accent/10 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[10%] w-[40%] h-[40%] rounded-full bg-purple-900/10 blur-[120px] pointer-events-none" />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="py-3.5 md:py-4 mb-3 border-b border-card-border flex items-center justify-between px-4 lg:px-6 relative z-40 bg-card/45 backdrop-blur-xl gap-4 transition-colors">

          {/* Focal Price & Asset Display */}
          <div className="flex items-baseline gap-3.5 select-none">
            <span className="font-mono text-1xl md:text-1xl font-black text-foreground tracking-wider uppercase">
              ETHUSDC.P
            </span>
            <LiveTicker variant="large" />
          </div>

          {/* Toolbar & Live Execution HUD Controls */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Persistent Cockpit Execution Status Badge */}
            <LiveCockpitStatusBadge onClick={() => setIsLiveOBModalOpen(true)} variant="compact" />

            {/* Alert Sounds & Command Center Button */}
            <button
              onClick={() => {
                setCommandCenterTab('strategy');
                setIsSoundSettingsOpen(true);
              }}
              className="bg-slate-950/80 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white px-3 py-1.5 font-mono text-[10px] font-black uppercase tracking-widest transition-all rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm"
              title="Open Command Center"
            >
              <Settings size={12} />
              <span className="hidden xl:inline">[ COMMAND CENTER ]</span>
            </button>

            {/* Manual Trading Toggle Button */}
            <button
              onClick={() => setIsManualTradingActive((prev) => !prev)}
              className={`border px-3.5 py-1.5 font-mono text-[10px] font-black uppercase tracking-widest transition-all duration-200 rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm ${
                isManualTradingActive
                  ? 'bg-purple-400 border-purple-300 text-slate-950 shadow-[0_0_12px_rgba(192,132,252,0.45)]'
                  : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isManualTradingActive
                    ? 'bg-slate-950 shadow-[0_0_4px_rgba(0,0,0,0.5)]'
                    : 'bg-slate-600'
                }`}
              />
              <Shield size={12} className={isManualTradingActive ? 'text-slate-950' : 'text-slate-500'} />
              <span>[ MANUAL TRADING ]</span>
            </button>

            <TimeframeSwitcher selectedInterval={selectedInterval} onChange={setSelectedInterval} />

            {/* Hamburger — visible only on <lg screens */}
            <button
              id="btn-open-sidebar"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-all rounded-full"
              aria-label="Open sidebar"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── 3 Large Visual HUD Cards ─────────────────────────────────────── */}
        <DashboardMetrics masterBias={masterBias} pricing={pricing} targetStatus={targetStatus} isLive={true} />

        {/* ── Order Flow State Tracker & Chronological Timeline Ribbon ─────────── */}
        <div className="px-4 lg:px-6 mb-2 relative z-20">
          <OrderFlowTimelineRibbon
            timeline={data?.ipda_metrics?.order_flow_engine?.state_timeline}
            onOpenModal={() => setIsOrderFlowModalOpen(true)}
            onOpenLiveOBModal={() => setIsLiveOBModalOpen(true)}
          />
        </div>

        {/* ── Chart Area ─────────────────────────────────────────────────── */}
        <div className="flex-1 relative px-4 lg:px-6 pb-4 z-10 flex flex-col min-h-0">
          {error ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="bg-[#ffb4ab]/10 text-[#ffb4ab] px-6 py-4 rounded-2xl border border-[#ffb4ab]/20 shadow-lg shadow-[#ffb4ab]/10 flex items-center gap-3">
                <span className="font-semibold">Error:</span> {error}
              </div>
            </div>
          ) : !data && isLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-10 h-10 text-accent animate-spin" />
                <span className="text-sm font-medium text-muted-foreground animate-pulse text-center px-4">
                  Establishing direct link to Binance Futures...
                </span>
              </div>
            </div>
          ) : (
            <div className="w-full h-full rounded-2xl overflow-hidden border border-card-border bg-card/20 backdrop-blur-md shadow-2xl relative group">
              {/* Subtle inner glow for chart container */}
              <div className="absolute inset-0 shadow-[inset_0_0_100px_rgba(255,255,255,0.01)] pointer-events-none z-10" />
              <Chart
                data={getChartData()}
                activeFvgs={data?.ipda_metrics?.active_fvgs ?? EMPTY_FVGS}
                localDealingRange={data?.ipda_metrics?.pricing_context?.local_dealing_range}
                interval={selectedInterval}
                isManualTradingActive={isManualTradingActive}
                manualOrderType={manualOrderType}
                manualDirection={manualDirection}
                manualEntryPrice={manualEntryPrice}
                manualTakeProfit={manualTakeProfit}
                manualStopLoss={manualStopLoss}
                onManualPricesChange={handleManualPricesChange}
                openTrades={openTrades}
                onUpdateTradeLevels={handleUpdateTradeLevels}
                srOverlay={liveSr.srOverlay}
                symbol="ETHUSDC"
              />
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
                  balance={accountBalance}
                  onSubmit={handleSubmitManualOrder}
                  isSubmitting={isSubmittingManual}
                />
              )}
              {/* Premium overlay for timeframe transition load states */}
              {isLoading && (
                <div className="absolute inset-0 bg-background/60 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-3 transition-opacity duration-300">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                  <span className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground animate-pulse">
                    Pivoting Timeframe Scale...
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <Sidebar
        data={data}
        counts={counts}
        onCountChange={(tf, val) => {
          const num = parseInt(val, 10);
          setCounts(prev => ({ ...prev, [tf]: isNaN(num) ? 0 : num }));
        }}
        onDownloadV6={downloadV6}
        onDownloadV7Sliced={downloadV7Sliced}
        isLoading={isLoading}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
      />

      {/* Global Command Center Modal */}
      <SettingsModal
        isOpen={isSoundSettingsOpen}
        alert={null}
        initialTab={commandCenterTab}
        onClose={() => setIsSoundSettingsOpen(false)}
        onSave={() => { }}
        onDelete={() => { }}
      />

      {/* Order Flow State Timeline Modal */}
      <OrderFlowTimelineModal
        isOpen={isOrderFlowModalOpen}
        onClose={() => setIsOrderFlowModalOpen(false)}
        timeline={data?.ipda_metrics?.order_flow_engine?.state_timeline}
        symbol="ETHUSDC.p"
      />

      {/* Phase 7 Live Order Block & Breaker Execution Modal */}
      <LiveOrderBlockModal
        isOpen={isLiveOBModalOpen}
        onClose={() => setIsLiveOBModalOpen(false)}
        symbol="ETHUSDC.p"
      />

      {/* Decoupled Leaf Runners */}
      <StrategyEvaluatorRunner />
      <PendingOrdersManager
        pendingOrders={pendingOrders}
        setPendingOrders={setPendingOrders}
        fetchBalance={fetchBalance}
      />
    </main>
  );
}

// Dedicated leaf component to run strategy evaluator in isolation, avoiding parent re-renders on price ticks
function StrategyEvaluatorRunner() {
  useStrategyEvaluator();
  return null;
}

// Dedicated leaf component to manage pending resting orders in isolation, avoiding parent re-renders on price ticks
function PendingOrdersManager({
  pendingOrders,
  setPendingOrders,
  fetchBalance
}: {
  pendingOrders: any[];
  setPendingOrders: React.Dispatch<React.SetStateAction<any[]>>;
  fetchBalance: () => Promise<void>;
}) {
  const { livePrice } = useMarketDataLiveContext();
  const { signalAlertsEnabled } = useMarketDataContext();

  useEffect(() => {
    if (!livePrice || pendingOrders.length === 0) return;

    const triggered = pendingOrders.filter((order) => {
      if (order.orderType === 'LIMIT') {
        return order.direction === 'LONG' ? livePrice <= order.entryPrice : livePrice >= order.entryPrice;
      } else {
        return order.direction === 'LONG' ? livePrice >= order.entryPrice : livePrice <= order.entryPrice;
      }
    });

    if (triggered.length === 0) return;

    triggered.forEach(async (order) => {
      try {
        const res = await fetch('/api/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: 'ETHUSDC',
            direction: order.direction,
            entry_price: order.entryPrice,
            stop_loss: order.stopLoss,
            take_profit: order.takeProfit,
            risk_percent: order.riskPct,
            strategy_name: `Manual ${order.orderType} Order`,
          }),
        });

        if (res.ok) {
          if (typeof window !== 'undefined' && signalAlertsEnabled?.DISPLACEMENT_CONFIRMED !== false) {
            const audio = new Audio('/sounds/flow_state.wav');
            audio.play().catch(() => {});
          }
          window.dispatchEvent(new Event('trades-refresh'));
          fetchBalance();
        } else {
          console.error('[Manual Trading] Failed to execute resting order:', res.statusText);
        }
      } catch (e) {
        console.error('[Manual Trading] Error executing resting order:', e);
      }
    });

    setPendingOrders((prev) => prev.filter((order) => !triggered.some((t) => t.id === order.id)));
  }, [livePrice, pendingOrders, setPendingOrders, fetchBalance]);

  return null;
}

