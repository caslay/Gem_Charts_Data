import { useState, useEffect, useCallback } from 'react';
import { slicePayloadByLookback } from '@/components/Sidebar';

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
  timezone: string;
  open_interest: number;
  data_payload: {
    candles_1h: Candle[];
    candles_15m: Candle[];
    candles_5m: Candle[];
  };
  ipda_metrics: any;
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

  // ── V6 Naked — always full, unsliced ─────────────────────────────────────
  const downloadV6 = useCallback(() => {
    if (!data) return;

    const v6Data = {
      ticker: data.ticker,
      timezone: data.timezone,
      open_interest: data.open_interest,
      data_payload: data.data_payload,
    };

    triggerDownload(v6Data, `V6_Naked_Data_${data.ticker}.json`);
  }, [data]);

  // ── V7.9 Enriched — sliced by lookbackDays ───────────────────────────────
  const downloadV7Sliced = useCallback(
    (lookbackDays: number) => {
      if (!data) return;

      const sliced = slicePayloadByLookback(data, lookbackDays);
      const v7Data = {
        ticker: sliced.ticker,
        timezone: sliced.timezone,
        open_interest: sliced.open_interest,
        data_payload: sliced.data_payload,
        ipda_metrics: sliced.ipda_metrics,
      };

      triggerDownload(v7Data, `V7.9_Enriched_Data_${data.ticker}_${lookbackDays}d.json`);
    },
    [data]
  );

  return { data, isLoading, error, refetch: fetchData, downloadV6, downloadV7Sliced };
}

// ── Shared file-download helper ───────────────────────────────────────────────
function triggerDownload(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
