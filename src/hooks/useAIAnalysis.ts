import { useState, useCallback } from 'react';
import type { MarketDataPayload } from '@/hooks/useMarketData';
import { safeParseAiJson } from '@/lib/aiJsonParser';

export interface UseAIAnalysisReturn {
  aiAnalysis: string | null;
  aiBias: number | null;
  isAnalyzing: boolean;
  triggerAiAnalysisScan: (data: MarketDataPayload | null, alertMetadata?: unknown) => Promise<void>;
  setAiAnalysis: (analysis: string | null) => void;
  setAiBias: (bias: number | null) => void;
  setIsAnalyzing: (analyzing: boolean) => void;
}

export function useAIAnalysis(): UseAIAnalysisReturn {
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiBias, setAiBias] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const triggerAiAnalysisScan = useCallback(async (data: MarketDataPayload | null, alertMetadata?: unknown) => {
    if (!data) return;
    setIsAnalyzing(true);
    setAiAnalysis(null);
    setAiBias(null);
 
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
        try {
          const parsed = safeParseAiJson(result.analysis);
          if (parsed && parsed.bias_signal !== undefined) {
            setAiBias(Number(parsed.bias_signal));
          }
        } catch (e) {
          console.error('[useAIAnalysis] Failed to parse bias_signal from AI response:', e);
        }
      } else {
        setAiAnalysis(`**Error:** ${result.error || 'Synthesis failed.'}`);
      }
    } catch (err) {
      console.error('[useAIAnalysis] Connection error during AI synthesis:', err);
      setAiAnalysis('**Error:** Connection lost during synthesis.');
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  return {
    aiAnalysis,
    aiBias,
    isAnalyzing,
    triggerAiAnalysisScan,
    setAiAnalysis,
    setAiBias,
    setIsAnalyzing
  };
}
