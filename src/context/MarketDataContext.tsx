"use client";

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useMarketData as useMarketDataHook } from '@/hooks/useMarketData';
import { useBinanceWS } from '@/hooks/useBinanceWS';
import { useAutoTradeExecutor } from '@/hooks/useAutoTradeExecutor';
import type { LiveCandle, WSStatus } from '@/hooks/useBinanceWS';

import { useAutomatedStrategyExecution } from '@/hooks/useAutomatedStrategyExecution';
import { useLiveOrderBlockExecution } from '@/hooks/useLiveOrderBlockExecution';

type MarketDataReturnType = ReturnType<typeof useMarketDataHook>;

export interface MarketDataContextValue extends Omit<MarketDataReturnType, 'liveCandle' | 'livePrice'> {
  wsStatus: WSStatus;
  wsReconnect: () => void;
  wsInterval: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h';
  setWsInterval: (interval: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h') => void;
}

export interface MarketDataLiveContextValue {
  liveCandle: LiveCandle | null;
  livePrice: number | null;
}

const MarketDataStaticContext = createContext<MarketDataContextValue | null>(null);
const MarketDataLiveContext = createContext<MarketDataLiveContextValue | null>(null);

// Global background host component that executes autonomous strategy and order block scanners 24/7
function AutonomousExecutionHost() {
  useAutomatedStrategyExecution();
  useLiveOrderBlockExecution();
  return null;
}

export function MarketDataProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status: authStatus } = useSession();
  const isEnabled = authStatus === 'authenticated' && pathname !== '/login';

  // Centralized WS interval state — Chart and other consumers set this
  const [wsInterval, setWsInterval] = useState<'1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h'>('5m');

  // Single, global WebSocket connection with Multi-Stream MTF support (disabled on /login or when unauthenticated)
  const {
    liveCandle,
    liveCandles,
    lastClosedEvent,
    livePrice,
    status: wsStatus,
    reconnect: wsReconnect,
  } = useBinanceWS({ symbol: 'ethusdc', interval: wsInterval, enabled: isEnabled });

  const marketData = useMarketDataHook(wsInterval, liveCandle, liveCandles, lastClosedEvent, livePrice, isEnabled);

  // Background Auto-Trade Executor: automatically opens trades in journal when price touches entry
  useAutoTradeExecutor(isEnabled ? marketData.data : null, false);


  // Memoize static context value so sub-second price ticks do not trigger re-render cascades
  const staticValue: MarketDataContextValue = React.useMemo(() => ({
    ...marketData,
    wsStatus,
    wsReconnect,
    wsInterval,
    setWsInterval,
  }), [
    marketData,
    wsStatus,
    wsReconnect,
    wsInterval,
    setWsInterval,
  ]);

  const liveValue: MarketDataLiveContextValue = React.useMemo(() => ({
    liveCandle,
    livePrice,
  }), [liveCandle, livePrice]);

  return (
    <MarketDataStaticContext.Provider value={staticValue}>
      <MarketDataLiveContext.Provider value={liveValue}>
        {isEnabled && <AutonomousExecutionHost />}
        {children}
      </MarketDataLiveContext.Provider>
    </MarketDataStaticContext.Provider>
  );
}

export function useMarketDataContext() {
  const context = useContext(MarketDataStaticContext);
  if (!context) {
    throw new Error('useMarketDataContext must be used within a MarketDataProvider');
  }
  return context;
}

export function useMarketDataLiveContext() {
  const context = useContext(MarketDataLiveContext);
  if (!context) {
    throw new Error('useMarketDataLiveContext must be used within a MarketDataProvider');
  }
  return context;
}
