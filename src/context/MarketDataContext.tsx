"use client";

import React, { createContext, useContext, ReactNode } from 'react';
import { useMarketData as useMarketDataHook } from '@/hooks/useMarketData';

type MarketDataReturnType = ReturnType<typeof useMarketDataHook>;

const MarketDataContext = createContext<MarketDataReturnType | null>(null);

export function MarketDataProvider({ children }: { children: ReactNode }) {
  const marketData = useMarketDataHook();
  
  return (
    <MarketDataContext.Provider value={marketData}>
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
