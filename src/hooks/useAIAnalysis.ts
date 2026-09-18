import { useState, useCallback, useEffect } from 'react';
import type { MarketDataPayload } from '@/hooks/useMarketData';
import { safeParseAiJson } from '@/lib/aiJsonParser';
import type { AiExecutionTelemetry, AiAnalysisRecord } from '@/lib/aiCascadeEngine';
import { buildLiveSessionContext } from '@/lib/sessionContext';

export interface UseAIAnalysisReturn {
  aiAnalysis: string | null;
  aiBias: number | null;
  aiTelemetry: AiExecutionTelemetry | null;
  aiHistory: AiAnalysisRecord[];
  isAnalyzing: boolean;
  isHistoryLoading: boolean;
  triggerAiAnalysisScan: (data: MarketDataPayload | null, alertMetadata?: unknown) => Promise<void>;
  fetchAiHistory: (options?: { limit?: number; page?: number; status?: string }) => Promise<void>;
  setAiAnalysis: (analysis: string | null) => void;
  setAiBias: (bias: number | null) => void;
  setAiTelemetry: (telemetry: AiExecutionTelemetry | null) => void;
  setIsAnalyzing: (analyzing: boolean) => void;
}

export function useAIAnalysis(): UseAIAnalysisReturn {
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiBias, setAiBias] = useState<number | null>(null);
  const [aiTelemetry, setAiTelemetry] = useState<AiExecutionTelemetry | null>(null);
  const [aiHistory, setAiHistory] = useState<AiAnalysisRecord[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const fetchAiHistory = useCallback(async (options?: { limit?: number; page?: number; status?: string }) => {
    setIsHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.page) params.set('page', String(options.page));
      if (options?.status) params.set('status', options.status);

      const res = await fetch(`/api/quant-analyze?${params.toString()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data)) {
          setAiHistory(json.data);
          // If no live telemetry is set yet, populate telemetry from the most recent run
          if (json.data.length > 0) {
            const latest = json.data[0];
            setAiTelemetry((current) => {
              if (current) return current;
              return {
                requested_model: latest.requested_model,
                resolved_model: latest.resolved_model,
                provider: (latest.provider as any) || (latest.telemetry_data as any)?.provider || undefined,
                was_fallback: latest.was_fallback,
                fallback_reason: latest.fallback_reason,
                execution_latency_ms: latest.execution_latency_ms,
                timestamp: latest.created_at,
                attempts: Array.isArray(latest.telemetry_data?.attempts)
                  ? (latest.telemetry_data.attempts as any)
                  : [],
              };
            });
          }
        }
      }
    } catch (err) {
      console.warn('[useAIAnalysis] Failed to fetch AI history:', err);
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  // Hydrate recent AI history and telemetry on initial mount
  useEffect(() => {
    fetchAiHistory({ limit: 20 });
  }, [fetchAiHistory]);

  const triggerAiAnalysisScan = useCallback(async (data: MarketDataPayload | null, alertMetadata?: unknown) => {
    if (!data) return;
    setIsAnalyzing(true);
    setAiAnalysis(null);
    setAiBias(null);

    const executionNow = new Date();
    // Extract live price from most granular candle available
    let livePrice: number | null = null;
    const dp = data.data_payload;
    if (dp) {
      const priorities = [dp.candles_5m, dp.candles_15m, dp.candles_1h, dp.candles_4h];
      for (const arr of priorities) {
        if (Array.isArray(arr) && arr.length > 0) {
          const last = arr[arr.length - 1];
          if (last?.c != null && typeof last.c === 'number') {
            livePrice = last.c;
            break;
          }
        }
      }
    }
    const sessionContext = buildLiveSessionContext(executionNow, livePrice);

    // Create the pruned AI payload with dynamic live timestamp & session context
    const ai_payload = {
      ...data,
      timestamp: executionNow.toISOString(),
      session_context: sessionContext,
      ipda_metrics: data.ipda_metrics ? {
        ...data.ipda_metrics,
        current_time_window: sessionContext.current_killzone,
        session_context: sessionContext,
      } : undefined,
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
        body: JSON.stringify(ai_payload),
        cache: 'no-store',
      });

      const result = await response.json();
      if (response.ok) {
        setAiAnalysis(result.analysis);
        if (result.telemetry) {
          setAiTelemetry(result.telemetry);
        }
        try {
          const parsed = safeParseAiJson(result.analysis);
          const rawSignal = parsed?.bias_signal ?? result.biasSignal;
          if (rawSignal === 1 || String(rawSignal).toUpperCase().includes('BULL') || String(rawSignal).toUpperCase().includes('LONG')) {
            setAiBias(1);
          } else if (rawSignal === -1 || String(rawSignal).toUpperCase().includes('BEAR') || String(rawSignal).toUpperCase().includes('SHORT')) {
            setAiBias(-1);
          } else if (rawSignal === 0 || String(rawSignal).toUpperCase().includes('NEUT')) {
            setAiBias(0);
          } else if (rawSignal !== undefined && rawSignal !== null && !isNaN(Number(rawSignal))) {
            setAiBias(Number(rawSignal));
          }
        } catch (e) {
          console.error('[useAIAnalysis] Failed to parse bias_signal from AI response:', e);
        }
        // Refresh history after a successful scan
        fetchAiHistory({ limit: 20 });
      } else {
        setAiAnalysis(`**Error:** ${result.error || 'Synthesis failed.'}`);
      }
    } catch (err) {
      console.error('[useAIAnalysis] Connection error during AI synthesis:', err);
      setAiAnalysis('**Error:** Connection lost during synthesis.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [fetchAiHistory]);

  return {
    aiAnalysis,
    aiBias,
    aiTelemetry,
    aiHistory,
    isAnalyzing,
    isHistoryLoading,
    triggerAiAnalysisScan,
    fetchAiHistory,
    setAiAnalysis,
    setAiBias,
    setAiTelemetry,
    setIsAnalyzing
  };
}
