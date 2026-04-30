import { useState, useEffect, useCallback } from 'react';

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface MarketDataPayload {
  ticker: string;
  timestamp_utc: string;
  market_structure_framework: string;
  open_interest: number;
  data_payload: {
    candles_1h: Candle[];
    candles_15m: Candle[];
    candles_5m: Candle[];
  };
}

export function useMarketData() {
  const [data, setData] = useState<MarketDataPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch('/api/market-data');
      if (!res.ok) {
        throw new Error('Failed to fetch market data');
      }
      const jsonData: MarketDataPayload = await res.json();
      setData(jsonData);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Intentionally only fetching once on mount as per V6 requirements.
  }, [fetchData]);

  const downloadJSON = useCallback(() => {
    if (!data) return;

    // Create a copy of the data shifted to UTC+3
    const utcPlus3OffsetMs = 3 * 60 * 60 * 1000;
    
    // Shift the ISO string as well
    const originalDate = new Date(data.timestamp_utc);
    const shiftedDate = new Date(originalDate.getTime() + utcPlus3OffsetMs);

    const shiftCandles = (candles: Candle[]) => 
      candles.map(c => ({ ...c, t: c.t + utcPlus3OffsetMs }));

    const shiftedData = {
      ...data,
      timestamp_utc: shiftedDate.toISOString().replace('Z', '+03:00'), // Indicate it's not pure UTC anymore
      data_payload: {
        candles_1h: shiftCandles(data.data_payload.candles_1h),
        candles_15m: shiftCandles(data.data_payload.candles_15m),
        candles_5m: shiftCandles(data.data_payload.candles_5m),
      }
    };

    const blob = new Blob([JSON.stringify(shiftedData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `V6_Gem_Data_${data.ticker}_UTC+3_${shiftedData.timestamp_utc.replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [data]);

  return { data, isLoading, error, refetch: fetchData, downloadJSON };
}
