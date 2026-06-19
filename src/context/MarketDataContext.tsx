"use client";

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useMarketData as useMarketDataHook } from '@/hooks/useMarketData';
import { useBinanceWS } from '@/hooks/useBinanceWS';
import type { LiveCandle, WSStatus } from '@/hooks/useBinanceWS';

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

export function MarketDataProvider({ children }: { children: ReactNode }) {
  // Centralized WS interval state — Chart and other consumers set this
  const [wsInterval, setWsInterval] = useState<'1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h'>('5m');

  // Single, global WebSocket connection — prevents duplicate connections (Lesson #7)
  const {
    liveCandle,
    livePrice,
    status: wsStatus,
    reconnect: wsReconnect,
  } = useBinanceWS({ symbol: 'ethusdc', interval: wsInterval });

  const marketData = useMarketDataHook(wsInterval, liveCandle);

  const staticValue: MarketDataContextValue = {
    ...marketData,
    wsStatus,
    wsReconnect,
    wsInterval,
    setWsInterval,
  };

  const liveValue: MarketDataLiveContextValue = {
    liveCandle,
    livePrice,
  };

  return (
    <MarketDataStaticContext.Provider value={staticValue}>
      <MarketDataLiveContext.Provider value={liveValue}>
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
