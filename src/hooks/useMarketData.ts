import { useState, useEffect, useCallback } from 'react';
import { slicePayloadByLookback } from '@/components/Sidebar';
import { useLiveAlerts } from './useLiveAlerts';

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
  timestamp?: string;
  timezone: string;
  open_interest: number;
  ipda_metrics: any;
  active_arrays: any;
  data_payload: {
    candles_4h?: Candle[];
    candles_1h?: Candle[];
    candles_15m?: Candle[];
    candles_5m?: Candle[];
  };
}

export function useMarketData() {
  const [data, setData] = useState<MarketDataPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isPolling = false) => {
    try {
      if (!isPolling) {
        setIsLoading(true);
      }
      setError(null);
      const res = await fetch('/api/market-data');
      if (!res.ok) {
        throw new Error('Failed to fetch market data');
      }
      const jsonData: MarketDataPayload = await res.json();

      setData((prev) => {
        if (!prev) return jsonData;
        // Preserve data_payload reference during polling to prevent Chart remounting/flashing
        return {
          ...jsonData,
          data_payload: isPolling ? prev.data_payload : jsonData.data_payload
        };
      });
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      if (!isPolling) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Added 5000ms polling to keep resting_liquidity_pools (BSL/SSL) fresh
    const interval = setInterval(() => {
      fetchData(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Hook into live alerts: Triggers Binance WS, performs diffs, fires audio/push alerts
  const { activeAlerts, clearAlerts, dismissAlert } = useLiveAlerts(data, fetchData);

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

  // ── V8.2 Enriched — sliced by candle counts ───────────────────────────────
  const downloadV7Sliced = useCallback(
    (counts: { '5m': number, '15m': number, '1h': number, '4h': number }) => {
      if (!data) return;

      const sliced = slicePayloadByLookback(data, counts);
      const v7Data = {
        ticker: sliced.ticker,
        timestamp: new Date().toISOString(),
        timezone: sliced.timezone,
        ipda_metrics: sliced.ipda_metrics,
        active_arrays: sliced.active_arrays,
        open_interest: sliced.open_interest,
        data_payload: sliced.data_payload,
      };

      const now = new Date();
      let hours = now.getHours();
      const minutes = now.getMinutes();
      const ampm = hours >= 12 ? 'pm' : 'am';

      hours = hours % 12;
      hours = hours ? hours : 12; // تحويل الصفر لـ 12

      const hoursStr = hours < 10 ? '0' + hours : hours.toString();
      const minutesStr = minutes < 10 ? '0' + minutes : minutes.toString();
      const timeString = `${hoursStr}-${minutesStr}-${ampm}`;

      triggerDownload(v7Data, `V8.2_Enriched_Data_${data.ticker}_${timeString}.json`);
    },
    [data]
  );

  return { data, isLoading, error, refetch: fetchData, downloadV6, downloadV7Sliced, activeAlerts, clearAlerts, dismissAlert };
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
