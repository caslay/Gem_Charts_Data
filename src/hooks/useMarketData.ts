import { useState, useEffect, useCallback, useRef } from 'react';
import { slicePayloadByLookback } from '@/components/Sidebar';
import { useLiveAlerts } from './useLiveAlerts';

export interface SignalAlerts {
  FVG_DETECTION: string;
  DISPLACEMENT_CONFIRMED: string;
  SMT_TRAP_ACTIVE: string;
  DOL_EXHAUSTED: string;
  SESSION_TRANSITION: string;
  PRICING_SHIFT: string;
  SWEEP_ALERT: string;
  FLOW_STATE_CHANGE: string;
  DEAD_ZONE_ENTER: string;
}

export interface SignalAlertsEnabled {
  FVG_DETECTION: boolean;
  DISPLACEMENT_CONFIRMED: boolean;
  SMT_TRAP_ACTIVE: boolean;
  DOL_EXHAUSTED: boolean;
  SESSION_TRANSITION: boolean;
  PRICING_SHIFT: boolean;
  SWEEP_ALERT: boolean;
  FLOW_STATE_CHANGE: boolean;
  DEAD_ZONE_ENTER: boolean;
}

const DEFAULT_SIGNAL_ALERTS: SignalAlerts = {
  FVG_DETECTION: "fvg_alert.mp3",
  DISPLACEMENT_CONFIRMED: "flow_state.wav",
  SMT_TRAP_ACTIVE: "smt_trap.wav",
  DOL_EXHAUSTED: "objective_update.wav",
  SESSION_TRANSITION: "session_transition.wav",
  PRICING_SHIFT: "pricing_shift.wav",
  SWEEP_ALERT: "sweep_alert.mp3",
  FLOW_STATE_CHANGE: "flow_state.wav",
  DEAD_ZONE_ENTER: "dead_zone.mp3",
};

const DEFAULT_SIGNAL_ALERTS_ENABLED: SignalAlertsEnabled = {
  FVG_DETECTION: true,
  DISPLACEMENT_CONFIRMED: true,
  SMT_TRAP_ACTIVE: true,
  DOL_EXHAUSTED: true,
  SESSION_TRANSITION: true,
  PRICING_SHIFT: true,
  SWEEP_ALERT: true,
  FLOW_STATE_CHANGE: true,
  DEAD_ZONE_ENTER: true,
};

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ipda_metrics: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  active_arrays: any;
  correlation_data?: any; // V8.7 Correlation Data
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

  const [signalAlerts, setSignalAlerts] = useState<SignalAlerts>(() => {
    if (typeof window === 'undefined') return DEFAULT_SIGNAL_ALERTS;
    try {
      const stored = localStorage.getItem('gem_signal_sounds');
      return stored ? JSON.parse(stored) : DEFAULT_SIGNAL_ALERTS;
    } catch {
      return DEFAULT_SIGNAL_ALERTS;
    }
  });

  const [signalAlertsEnabled, setSignalAlertsEnabled] = useState<SignalAlertsEnabled>(() => {
    if (typeof window === 'undefined') return DEFAULT_SIGNAL_ALERTS_ENABLED;
    try {
      const stored = localStorage.getItem('gem_signal_enabled');
      return stored ? JSON.parse(stored) : DEFAULT_SIGNAL_ALERTS_ENABLED;
    } catch {
      return DEFAULT_SIGNAL_ALERTS_ENABLED;
    }
  });

  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'saved' | 'error'>('idle');

  // Keep refs of latest values to avoid closure/dependency loop issues in the debounced sync call
  const signalAlertsRef = useRef(signalAlerts);
  const signalAlertsEnabledRef = useRef(signalAlertsEnabled);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    signalAlertsRef.current = signalAlerts;
  }, [signalAlerts]);

  useEffect(() => {
    signalAlertsEnabledRef.current = signalAlertsEnabled;
  }, [signalAlertsEnabled]);

  // Clean up any pending sync timeout on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  // Background SWR Rehydration: fetch settings from Neon on mount to overwrite localStorage
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          if (data.terminalSettings) {
            const { signalSounds, enabledSignals } = data.terminalSettings;
            if (signalSounds) {
              setSignalAlerts(signalSounds);
              if (typeof window !== 'undefined') {
                localStorage.setItem('gem_signal_sounds', JSON.stringify(signalSounds));
              }
            }
            if (enabledSignals) {
              setSignalAlertsEnabled(enabledSignals);
              if (typeof window !== 'undefined') {
                localStorage.setItem('gem_signal_enabled', JSON.stringify(enabledSignals));
              }
            }
          }
        }
      } catch (err) {
        console.error('[MarketData] Failed to fetch server settings:', err);
      }
    };
    loadSettings();
  }, []);

  // Debounced Neon PostgreSQL sync
  const queueSettingsSync = useCallback(() => {
    setSyncStatus('syncing');
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            terminalSettings: {
              signalSounds: signalAlertsRef.current,
              enabledSignals: signalAlertsEnabledRef.current,
            },
          }),
        });
        if (!res.ok) throw new Error('Failed to save settings');
        setSyncStatus('saved');
        // Reset saved indicator to idle after 2 seconds
        setTimeout(() => setSyncStatus('idle'), 2000);
      } catch (err) {
        console.error('[MarketData] Sync error:', err);
        setSyncStatus('error');
      }
    }, 1000); // 1-second debounce
  }, []);

  const updateSignalAlert = useCallback((event: keyof SignalAlerts, fileName: string) => {
    setSignalAlerts((prev) => {
      const updated = { ...prev, [event]: fileName };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('gem_signal_sounds', JSON.stringify(updated));
        } catch (e) {
          console.error('[MarketData] Failed to save signal alerts to localStorage:', e);
        }
      }
      signalAlertsRef.current = updated;
      queueSettingsSync();
      return updated;
    });
  }, [queueSettingsSync]);

  const toggleSignalAlertEnabled = useCallback((event: keyof SignalAlertsEnabled) => {
    setSignalAlertsEnabled((prev) => {
      const updated = { ...prev, [event]: !prev[event] };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('gem_signal_enabled', JSON.stringify(updated));
        } catch (e) {
          console.error('[MarketData] Failed to save signal alerts enabled to localStorage:', e);
        }
      }
      signalAlertsEnabledRef.current = updated;
      queueSettingsSync();
      return updated;
    });
  }, [queueSettingsSync]);

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      if (!isPolling) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // Wrap initial fetch in a macro-task to prevent synchronous cascading React state updates
    const initialTimer = setTimeout(() => {
      fetchData();
    }, 0);
    // Added 5000ms polling to keep resting_liquidity_pools (BSL/SSL) fresh
    const interval = setInterval(() => {
      fetchData(true);
    }, 5000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [fetchData]);

  // Hook into live alerts: Triggers Binance WS, performs diffs, fires audio/push alerts
  const { activeAlerts, clearAlerts, dismissAlert, triggerAlert } = useLiveAlerts(data, fetchData);

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

  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const triggerAiAnalysisScan = useCallback(async (alertMetadata?: unknown) => {
    if (!data) return;
    setIsAnalyzing(true);
    setAiAnalysis(null);
 
    // Create the pruned AI payload to prevent "Lost in the Middle" syndrome
    const ai_payload = {
      ...data,
      data_payload: {
        candles_4h: data.data_payload?.candles_4h?.slice(-30) ?? [],
        candles_1h: data.data_payload?.candles_1h?.slice(-30) ?? [],
        candles_15m: data.data_payload?.candles_15m?.slice(-30) ?? [],
        candles_5m: data.data_payload?.candles_5m?.slice(-30) ?? [],
      },
      ...(alertMetadata ? { alert_metadata: alertMetadata } : {})
    };
 
    try {
      const response = await fetch('/api/quant-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ai_payload)
      });
 
      const result = await response.json();
      if (response.ok) {
        setAiAnalysis(result.analysis);
      } else {
        setAiAnalysis(`**Error:** ${result.error || 'Synthesis failed.'}`);
      }
    } catch (err) {
      console.error(err);
      setAiAnalysis('**Error:** Connection lost during synthesis.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [data]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchData,
    downloadV6,
    downloadV7Sliced,
    activeAlerts,
    clearAlerts,
    dismissAlert,
    triggerSmartAlert: triggerAlert,
    aiAnalysis,
    isAnalyzing,
    setAiAnalysis,
    triggerAiAnalysisScan,
    signalAlerts,
    updateSignalAlert,
    signalAlertsEnabled,
    toggleSignalAlertEnabled,
    syncStatus
  };
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
