'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useMarketDataContext, useMarketDataLiveContext } from '@/context/MarketDataContext';
import {
  LiveOrderBlockExecutionEngine,
  LivePosition,
  LiveExecutionConfig,
  DEFAULT_LIVE_EXEC_CONFIG,
  InZoneTestingState,
  MacroMarketContext
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
  const [activeZonesByTimeframe, setActiveZonesByTimeframe] = useState<Record<string, InstitutionalOrderBlock[]>>({
    '5m': [],
    '15m': [],
    '1h': []
  });
  const [timeframeFilter, setTimeframeFilter] = useState<'ALL' | '5m' | '15m' | '1h'>('ALL');
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
            strategy_name: `Phase 7 MTF OB Live (${event.position.timeframe.toUpperCase()} ${event.position.orderBlock.quality_tier})`,
            ai_narrative_summary: `[Phase 7 MTF Live 3-Stage Position] ${event.message}`,
            entry_price: event.position.entryPrice,
            stop_loss: event.position.initialStopLoss,
            take_profit: event.position.tp3Price,
            status: 'CLOSED',
            pnl: (event.position.realizedR * engineConfig.fixedRiskUsd).toFixed(2),
            rr: event.position.realizedR.toFixed(2),
            exit_reason: event.position.exitReason,
            closed_at: new Date(event.position.closeTime || Date.now()).toISOString(),
            ipda_metrics: {
              timeframe: event.position.timeframe,
              structural_weight: event.position.orderBlock.structural_weight,
              htf_alignment: event.position.orderBlock.htf_alignment_status,
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

  // Ingest multi-timeframe closed candle streams (5m, 15m, 1h) concurrently from marketData
  useEffect(() => {
    if (!engineRef.current || !marketData) return;

    const payload = marketData.data_payload || {};
    const candles5m = payload.candles_5m;
    const candles15m = payload.candles_15m;
    const candles1h = payload.candles_1h;

    const ipda = marketData.ipda_metrics || {};
    const orderFlow = ipda.order_flow_engine || (marketData as any).order_flow_engine || {};
    const restingPools = orderFlow.resting_liquidity_pools || {};

    const macroContext: MacroMarketContext = {
      macroDailyBias: ipda.macro_daily_bias,
      dolDirection: ipda.dol_direction,
      bslMagnets: restingPools.BSL_Magnets,
      sslMagnets: restingPools.SSL_Magnets,
      localDealingRange: ipda.pricing_context?.local_dealing_range
    };

    engineRef.current.onMultiTimeframeCandles(
      {
        '5m': candles5m,
        '15m': candles15m,
        '1h': candles1h
      },
      macroContext
    );

    setActiveZones([...engineRef.current.getActiveZones(timeframeFilter)]);
    setActiveZonesByTimeframe({ ...engineRef.current.getActiveZonesByTimeframe() });
    setTestingStates([...engineRef.current.getInZoneTestingStates()]);
  }, [marketData, timeframeFilter]);

  // Process live incoming price ticks
  useEffect(() => {
    if (!engineRef.current || !livePrice || livePrice <= 0) return;

    const res = engineRef.current.onPriceTick(livePrice, Date.now());
    setActivePositions([...res.activePositions]);
    setActiveZones([...engineRef.current.getActiveZones(timeframeFilter)]);
    setActiveZonesByTimeframe({ ...engineRef.current.getActiveZonesByTimeframe() });
    setClosedLiveTrades([...engineRef.current.getClosedPositions()]);
    setCooldownRemainingSec(engineRef.current.getCooldownRemainingSec());
    setTestingStates([...engineRef.current.getInZoneTestingStates()]);
  }, [livePrice, timeframeFilter]);

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

  const setEnforceHtfAlignment = useCallback((enabled: boolean) => {
    setEngineConfig(prev => ({ ...prev, enforceHtfAlignment: enabled }));
  }, []);

  return {
    engineConfig,
    setEngineConfig,
    activePositions,
    activeZones,
    activeZonesByTimeframe,
    timeframeFilter,
    setTimeframeFilter,
    closedLiveTrades,
    lastEventMessage,
    lastEventTime,
    isConnected,
    cooldownRemainingSec,
    testingStates,
    toggleAutoExecute,
    setScalingMode,
    setTrailingMode,
    setEnforceHtfAlignment
  };
}
