'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import {
  LiveOrderBlockExecutionEngine,
  LivePosition,
  LiveExecutionConfig,
  DEFAULT_LIVE_EXEC_CONFIG,
  InZoneTestingState
} from '@/lib/quantEngine/LiveOrderBlockExecutionEngine';
import { InstitutionalOrderBlock } from '@/lib/quantEngine/OrderBlockEngine';

export function useLiveOrderBlockExecution(initialConfig?: Partial<LiveExecutionConfig>) {
  const { data: marketData, wsStatus } = useMarketDataContext();
  const { livePrice } = useMarketDataLiveContext();
  const isConnected = wsStatus === 'OPEN';

  const [engineConfig, setEngineConfig] = useState<LiveExecutionConfig>({
    ...DEFAULT_LIVE_EXEC_CONFIG,
    ...initialConfig
  });

  const engineRef = useRef<LiveOrderBlockExecutionEngine | null>(null);
  const [activePositions, setActivePositions] = useState<LivePosition[]>([]);
  const [activeZones, setActiveZones] = useState<InstitutionalOrderBlock[]>([]);
  const [closedLiveTrades, setClosedLiveTrades] = useState<LivePosition[]>([]);
  const [lastEventMessage, setLastEventMessage] = useState<string>('');
  const [lastEventTime, setLastEventTime] = useState<number>(0);
  const [cooldownRemainingSec, setCooldownRemainingSec] = useState<number>(0);
  const [testingStates, setTestingStates] = useState<InZoneTestingState[]>([]);

  // Initialize engine instance
  if (!engineRef.current) {
    engineRef.current = new LiveOrderBlockExecutionEngine(engineConfig);
  }

  // Update engine config when state changes
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateConfig(engineConfig);
    }
  }, [engineConfig]);

  // Subscribe to engine events & auto-journal to /api/trades
  useEffect(() => {
    if (!engineRef.current) return;

    const unsubscribe = engineRef.current.subscribe(async (event) => {
      setLastEventMessage(event.message);
      setLastEventTime(Date.now());

      // Auto-persist closed trades to journal /api/trades
      if (event.type === 'POSITION_CLOSED' && event.position) {
        try {
          const payload = {
            symbol: event.position.symbol,
            direction: event.position.direction,
            strategy_name: `Phase 7 OB Live (${event.position.orderBlock.quality_tier})`,
            ai_narrative_summary: `[Phase 7 Live 3-Stage Position] ${event.message}`,
            entry_price: event.position.entryPrice,
            stop_loss: event.position.initialStopLoss,
            take_profit: event.position.tp3Price,
            status: 'CLOSED',
            pnl: (event.position.realizedR * engineConfig.fixedRiskUsd).toFixed(2),
            rr: event.position.realizedR.toFixed(2),
            exit_reason: event.position.exitReason,
            closed_at: new Date(event.position.closeTime || Date.now()).toISOString(),
            ipda_metrics: {
              gates: event.position.orderBlock.gates,
              quality_tier: event.position.orderBlock.quality_tier,
              stage_exit: event.position.exitReason,
              realized_rr: event.position.realizedR
            }
          };

          await fetch('/api/trades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } catch (err) {
          console.warn('[useLiveOrderBlockExecution] Failed to auto-journal trade:', err);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [engineConfig.fixedRiskUsd]);

  // Ingest closed candles from marketData
  useEffect(() => {
    if (!engineRef.current || !marketData) return;

    const payloadCandles = (marketData as any)?.candles ||
      (marketData as any)?.all_candles ||
      marketData?.data_payload?.candles_15m ||
      marketData?.data_payload?.candles_5m ||
      [];
    if (payloadCandles.length > 0) {
      const lastCandle = payloadCandles[payloadCandles.length - 1];
      engineRef.current.onCandleClosed(lastCandle, payloadCandles);
      setActiveZones([...engineRef.current.getActiveZones()]);
      setTestingStates([...engineRef.current.getInZoneTestingStates()]);
    }
  }, [marketData]);

  // Process live incoming price ticks
  useEffect(() => {
    if (!engineRef.current || !livePrice || livePrice <= 0) return;

    const res = engineRef.current.onPriceTick(livePrice, Date.now());
    setActivePositions([...res.activePositions]);
    setActiveZones([...res.activeZones]);
    setClosedLiveTrades([...engineRef.current.getClosedPositions()]);
    setCooldownRemainingSec(engineRef.current.getCooldownRemainingSec());
    setTestingStates([...engineRef.current.getInZoneTestingStates()]);
  }, [livePrice]);

  // Timer interval to smoothly update cooldown ticker
  useEffect(() => {
    const timer = setInterval(() => {
      if (engineRef.current) {
        const remaining = engineRef.current.getCooldownRemainingSec();
        setCooldownRemainingSec(remaining);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleAutoExecute = useCallback(() => {
    setEngineConfig(prev => ({ ...prev, autoExecute: !prev.autoExecute }));
  }, []);

  const setScalingMode = useCallback((mode: 'THREE_STAGE_HARVEST' | 'TWO_STAGE_DYNAMIC' | 'SINGLE_STAGE') => {
    setEngineConfig(prev => ({ ...prev, positionScalingMode: mode }));
  }, []);

  const setTrailingMode = useCallback((mode: 'STRUCTURAL_FVG_TRAIL' | 'STATIC_BREAKEVEN') => {
    setEngineConfig(prev => ({ ...prev, trailingStopMode: mode }));
  }, []);

  return {
    engineConfig,
    setEngineConfig,
    activePositions,
    activeZones,
    closedLiveTrades,
    lastEventMessage,
    lastEventTime,
    isConnected,
    cooldownRemainingSec,
    testingStates,
    toggleAutoExecute,
    setScalingMode,
    setTrailingMode
  };
}
