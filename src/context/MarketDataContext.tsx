"use client";

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useMarketData as useMarketDataHook } from '@/hooks/useMarketData';
import { useBinanceWS } from '@/hooks/useBinanceWS';
import type { LiveCandle, WSStatus } from '@/hooks/useBinanceWS';

type MarketDataReturnType = ReturnType<typeof useMarketDataHook>;

interface MarketDataContextValue extends MarketDataReturnType {
  /** Live candle from Binance WebSocket — null until first tick */
  liveCandle: LiveCandle | null;
  /** Current live close price — convenience accessor */
  livePrice: number | null;
  /** WebSocket connection status */
  wsStatus: WSStatus;
  /** Manual WS reconnect trigger */
  wsReconnect: () => void;
  /** Current WS kline interval */
  wsInterval: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h';
  /** Update the WS kline interval (e.g. when user switches timeframe) */
  setWsInterval: (interval: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h') => void;
}

const MarketDataContext = createContext<MarketDataContextValue | null>(null);

export function MarketDataProvider({ children }: { children: ReactNode }) {
  // Centralized WS interval state — Chart and other consumers set this
  const [wsInterval, setWsInterval] = useState<'1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h'>('5m');

  const marketData = useMarketDataHook(wsInterval);

  // Single, global WebSocket connection — prevents duplicate connections (Lesson #7)
  const {
    liveCandle,
    livePrice,
    status: wsStatus,
    reconnect: wsReconnect,
  } = useBinanceWS({ symbol: 'ethusdc', interval: wsInterval });

  const contextValue: MarketDataContextValue = {
    ...marketData,
    liveCandle,
    livePrice,
    wsStatus,
    wsReconnect,
    wsInterval,
    setWsInterval,
  };

  return (
    <MarketDataContext.Provider value={contextValue}>
      {children}
    </MarketDataContext.Provider>
  );
}

export function useMarketDataContext() {
  const context = useContext(MarketDataContext);
  if (!context) {
    throw new Error('useMarketDataContext must be used within a MarketDataProvider');
  }
  return context;
}
