'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Candle } from '@/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimSetup,
  SweepReclaimScanConfig,
  SweepReclaimAnchorType,
  SweepReclaimEntryMode,
  resolveRetestEntryPrice,
  DEFAULT_SWEEP_RECLAIM_CONFIG,
} from '@/lib/quantEngine/SweepReclaimEngine';
import {
  ScannerPreset,
  SweepReclaimPresetConfig,
  FACTORY_SWEEP_RECLAIM_PRESETS,
  loadScannerPresets,
} from '@/lib/quantEngine/scannerPresets';
import type { BtMasterArrays, BacktestTimeframe } from '@/hooks/useBacktestEngine';
import type { SmartAlert } from '@/hooks/useLiveAlerts';

export interface SweepReclaimOverlayData {
  id: string;
  type: 'BULLISH' | 'BEARISH';
  phase: 'ANCHOR' | 'SWEEP' | 'RECLAIM' | 'RETEST' | 'OPEN' | 'CLOSED';
  anchorName: string;
  anchorLevel: number;
  sweepPrice: number | null;
  sweepObMt: number | null;
  reclaimPrice: number | null;
  fvgTop: number | null;
  fvgBottom: number | null;
  fvgCe: number | null;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  volExpansion: number;
  deltaDominance: number;
  bodyRatio: number;
  threePillarsPassed: boolean;
  isValuationAligned: boolean;
  realizedR: number;
  unrealizedR: number;
  statusText: string;
  isStage1Filled: boolean;
  isStage2Filled: boolean;
  isStage3Filled: boolean;
  isClosed: boolean;
}

export interface ReplayPosition {
  id: string;
  dbTradeId?: string | null;
  setupId: string;
  direction: 'LONG' | 'SHORT';
  status: 'PENDING_LIMIT' | 'OPEN' | 'STAGE_1_FILLED' | 'STAGE_2_FILLED' | 'CLOSED';
  entryPrice: number;
  initialStopLoss: number;
  activeStopLoss: number;
  stage1Target: number;
  stage2Target: number;
  stage3Target: number;
  fvgCeLevel: number | null;
  riskUsd: number;
  riskDistance: number;
  contractSize: number;
  riskPct: number;
  realizedR: number;
  realizedUsd: number;
  unrealizedR: number;
  unrealizedUsd: number;
  isStage1Filled: boolean;
  isStage2Filled: boolean;
  isStage3Filled: boolean;
  openTime: number;
  closeTime: number | null;
  exitPrice: number | null;
  exitReason: string | null;
  anchorLevel: number;
  timeframe: string;
}

export interface UseBacktestStrategyExecutionProps {
  visibleArrays: BtMasterArrays | null;
  activeTimeframe: BacktestTimeframe;
  currentIndex: number;
  lastPrice: number | null;
  lastCandle: any | null;
  triggerSmartAlert?: (type: any, message: string, soundPath?: string, sourceTag?: string) => void;
  accountEquity?: number;
  onTradesRefresh?: () => void;
}

export function useBacktestStrategyExecution({
  visibleArrays,
  activeTimeframe,
  currentIndex,
  lastPrice,
  lastCandle,
  triggerSmartAlert,
  accountEquity = 10000,
  onTradesRefresh,
}: UseBacktestStrategyExecutionProps) {
  // Preset list management (Factory + User Custom Presets)
  const [availablePresets, setAvailablePresets] = useState<ScannerPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(FACTORY_SWEEP_RECLAIM_PRESETS[0].id);

  // Active execution configuration overrides
  const [config, setConfig] = useState<SweepReclaimPresetConfig>({
    ...(FACTORY_SWEEP_RECLAIM_PRESETS[0].config as SweepReclaimPresetConfig),
  });

  // Replay Auto-Execution toggle (enabled by default)
  const [isAutoExecuteEnabled, setIsAutoExecuteEnabled] = useState<boolean>(true);

  // Execution tracking state in replay memory
  const [activeSetup, setActiveSetup] = useState<SweepReclaimSetup | null>(null);
  const [activePosition, setActivePosition] = useState<ReplayPosition | null>(null);
  const [pendingLimitOrder, setPendingLimitOrder] = useState<ReplayPosition | null>(null);
  const [closedReplayPositions, setClosedReplayPositions] = useState<ReplayPosition[]>([]);

  // Ref mirrors to prevent stale closures and infinite re-render cycles
  const activePositionRef = useRef<ReplayPosition | null>(null);
  activePositionRef.current = activePosition;

  const pendingLimitOrderRef = useRef<ReplayPosition | null>(null);
  pendingLimitOrderRef.current = pendingLimitOrder;

  const activeSetupRef = useRef<SweepReclaimSetup | null>(null);
  activeSetupRef.current = activeSetup;

  const closedSetupIdsRef = useRef<Set<string>>(new Set<string>());

  const lastProcessedCandleTimeRef = useRef<number | null>(null);

  // Load presets on mount and on storage events
  const refreshPresets = useCallback(() => {
    const presets = loadScannerPresets('SWEEP_RECLAIM');
    setAvailablePresets(presets);
  }, []);

  useEffect(() => {
    refreshPresets();
    if (typeof window !== 'undefined') {
      const handlePresetsChanged = () => refreshPresets();
      window.addEventListener('scanner-presets-changed', handlePresetsChanged);
      return () => window.removeEventListener('scanner-presets-changed', handlePresetsChanged);
    }
  }, [refreshPresets]);

  // Select Preset Handler
  const selectPreset = useCallback((presetId: string) => {
    const found = availablePresets.find((p) => p.id === presetId) || FACTORY_SWEEP_RECLAIM_PRESETS.find((p) => p.id === presetId);
    if (found && found.config) {
      setSelectedPresetId(found.id);
      setConfig(found.config as SweepReclaimPresetConfig);
    }
  }, [availablePresets]);

  // Update Config Overrides
  const updateConfig = useCallback((partial: Partial<SweepReclaimPresetConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const toggleAutoExecute = useCallback(() => {
    setIsAutoExecuteEnabled((prev) => !prev);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Evaluate Sweep & Reclaim State Machine on Visible Replay Slice
  // ─────────────────────────────────────────────────────────────────────────────
  const evaluationCandles = useMemo<Candle[]>(() => {
    if (!visibleArrays) return [];
    if (activeTimeframe === '1h') return visibleArrays.candles_1h as unknown as Candle[];
    if (activeTimeframe === '15m') return visibleArrays.candles_15m as unknown as Candle[];
    return visibleArrays.candles_5m as unknown as Candle[];
  }, [visibleArrays, activeTimeframe]);

  // Track previous index to auto-reset on scrub backward
  const prevCurrentIndexRef = useRef<number>(currentIndex);
  useEffect(() => {
    if (currentIndex < prevCurrentIndexRef.current) {
      // User scrubbed backward — clean up transient positions
      activePositionRef.current = null;
      pendingLimitOrderRef.current = null;
      activeSetupRef.current = null;
      setActivePosition(null);
      setPendingLimitOrder(null);
      setActiveSetup(null);
      closedSetupIdsRef.current.clear();
      lastProcessedCandleTimeRef.current = null;
    }
    prevCurrentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // Run SweepReclaimEngine on the visible slice (Strict zero look-ahead)
  useEffect(() => {
    if (!evaluationCandles || evaluationCandles.length < 15) {
      setActiveSetup(null);
      activeSetupRef.current = null;
      return;
    }

    const scanConfig: SweepReclaimScanConfig = {
      symbol: config.symbol || 'ETHUSDC',
      timeframe: activeTimeframe,
      anchorTypes: config.anchorTypes,
      lookbackMajor: config.lookbackMajor ?? 15,
      lookbackInternal: config.lookbackInternal ?? 5,
      maxBarsAnchorToSweep: config.maxBarsAnchorToSweep ?? 30,
      maxBarsSweepToReclaim: config.maxBarsSweepToReclaim ?? 12,
      maxBarsToRetest: config.maxBarsToRetest ?? 24,
      volumeExpansionThreshold: config.volumeExpansionThreshold ?? 1.50,
      deltaDominanceThreshold: config.deltaDominanceThreshold ?? 60.0,
      bodyRatioThreshold: config.bodyRatioThreshold ?? 0.60,
      requireThreePillarDisplacement: config.requireThreePillarDisplacement !== false,
      enforceDiscountPremiumGate: config.enforceDiscountPremiumGate !== false,
      stage1Multiple: config.stage1Multiple ?? 1.0,
      stage2Multiple: config.stage2Multiple ?? 1.5,
      stage3Multiple: config.stage3Multiple ?? 3.0,
      entryMode: config.entryMode ?? 'SWEEP_OB_MT',
      enableStructuralTrail: config.enableStructuralTrail !== false,
      enableProfitRatchet: config.enableProfitRatchet !== false,
      minSweepDepthAtrMultiplier: config.minSweepDepthAtrMultiplier ?? 0.10,
      slBufferAtrMultiplier: config.slBufferAtrMultiplier ?? 0.15,
    };

    try {
      const engine = new SweepReclaimEngine(scanConfig);
      const scanRes = engine.scanHistoricalSetups(evaluationCandles);
      const setups = scanRes.setups || [];

      // Filter out any setup that has already been closed/completed in this session
      const unclosedSetups = setups.filter((s) => !closedSetupIdsRef.current.has(s.id));

      if (unclosedSetups.length > 0) {
        // Priority 1: Confirmed setup waiting for retest or recently retested
        const activeOrRetested = unclosedSetups.filter(
          (s) =>
            s.status === 'RECLAIMED_NO_RETEST' ||
            s.status === 'RETESTED' ||
            s.phase === 'RECLAIM' ||
            s.phase === 'RETEST'
        );
        if (activeOrRetested.length > 0) {
          const latest = activeOrRetested[activeOrRetested.length - 1];
          activeSetupRef.current = latest;
          setActiveSetup(latest);
        } else {
          // Priority 2: Latest swept or anchor setup
          const latest = unclosedSetups[unclosedSetups.length - 1];
          activeSetupRef.current = latest;
          setActiveSetup(latest);
        }
      } else {
        activeSetupRef.current = null;
        setActiveSetup(null);
      }
    } catch (err) {
      console.warn('[useBacktestStrategyExecution] Scan evaluation error:', err);
    }
  }, [evaluationCandles, activeTimeframe, config, currentIndex]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Position Lifecycle, Retest Entry & 3-Stage Harvest Simulation
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!lastCandle || !isAutoExecuteEnabled) return;

    const candleTime = lastCandle.t;
    const currentPos = activePositionRef.current;
    const currentPending = pendingLimitOrderRef.current;
    const currentSetup = activeSetupRef.current;

    // Fast path: If the candle timestamp hasn't advanced, only update live floating R metrics
    if (lastProcessedCandleTimeRef.current === candleTime) {
      if (currentPos && currentPos.status !== 'CLOSED' && lastPrice) {
        const isLong = currentPos.direction === 'LONG';
        const currentDelta = isLong ? lastPrice - currentPos.entryPrice : currentPos.entryPrice - lastPrice;
        const floatingR = parseFloat((currentDelta / currentPos.riskDistance).toFixed(2));
        if (floatingR !== currentPos.unrealizedR) {
          const updatedPos = {
            ...currentPos,
            unrealizedR: floatingR,
            unrealizedUsd: parseFloat((floatingR * currentPos.riskUsd).toFixed(2)),
          };
          activePositionRef.current = updatedPos;
          setActivePosition(updatedPos);
        }
      }
      return;
    }
    lastProcessedCandleTimeRef.current = candleTime;

    const low = lastCandle.l ?? lastCandle.low;
    const high = lastCandle.h ?? lastCandle.high;
    const close = lastCandle.c ?? lastCandle.close;
    const currentCandleIdx = evaluationCandles.length - 1;

    // ── STEP A: Evaluate Pending Limit Orders (Touch, Expiration, or Invalidation) ──
    if (currentPending && currentPending.status === 'PENDING_LIMIT') {
      const isLong = currentPending.direction === 'LONG';
      const isLimitTouched = isLong
        ? low <= currentPending.entryPrice
        : high >= currentPending.entryPrice;

      // ICT Body Defense Doctrine: Candle body defends the level
      const isBodyDefended = isLong
        ? close >= Math.min(currentPending.anchorLevel, currentPending.entryPrice)
        : close <= Math.max(currentPending.anchorLevel, currentPending.entryPrice);

      // Check Expiration (TTL = maxBarsToRetest, default: 24 bars)
      const maxRetestBars = config.maxBarsToRetest ?? 24;
      const isExpired = currentSetup?.reclaim_index !== null && currentSetup?.reclaim_index !== undefined
        ? (currentCandleIdx - currentSetup.reclaim_index > maxRetestBars)
        : false;

      if (isExpired) {
        pendingLimitOrderRef.current = null;
        setPendingLimitOrder(null);
        triggerSmartAlert?.(
          'SMT_TRAP',
          `⌛ [S&R EXPIRED] Retest window elapsed (${maxRetestBars} bars). Resting limit cancelled.`,
          '/audio/dead_zone.wav',
          'REPLAY_STRATEGY'
        );
      } else if (isLimitTouched && isBodyDefended) {
        const openedPosition: ReplayPosition = {
          ...currentPending,
          status: 'OPEN',
          openTime: candleTime,
        };

        activePositionRef.current = openedPosition;
        pendingLimitOrderRef.current = null;
        setActivePosition(openedPosition);
        setPendingLimitOrder(null);

        triggerSmartAlert?.(
          'AUTO_ORDER_ROUTED',
          `🚀 [S&R RETEST FILLED] ${openedPosition.direction} position opened @ $${openedPosition.entryPrice.toFixed(
            2
          )} | Size: ${openedPosition.contractSize} ETH | SL: $${openedPosition.activeStopLoss.toFixed(2)}`,
          '/audio/sweep_alert.mp3',
          'REPLAY_STRATEGY'
        );

        // POST to /api/backtest-trades
        const tradePayload = {
          symbol: 'ETHUSDC',
          direction: openedPosition.direction,
          entry_price: openedPosition.entryPrice,
          stop_loss: openedPosition.activeStopLoss,
          take_profit: openedPosition.stage3Target,
          position_size: openedPosition.contractSize,
          risk_amount_usd: openedPosition.riskUsd,
          risk_percent: openedPosition.riskPct,
          strategy_name: `Sweep & Reclaim (3-Pillar Reversal - ${openedPosition.direction})`,
          ai_narrative_summary: `[Backtest Replay S&R Execution] ${openedPosition.direction} @ $${openedPosition.entryPrice.toFixed(2)} | Anchor: $${openedPosition.anchorLevel.toFixed(2)}`,
          status: 'OPEN',
          opened_at: new Date(candleTime).toISOString(),
          created_at: new Date(candleTime).toISOString(),
          ipda_metrics: {
            timeframe: activeTimeframe,
            stage1_target: openedPosition.stage1Target,
            stage2_target: openedPosition.stage2Target,
            stage3_target: openedPosition.stage3Target,
            fvg_ce: openedPosition.fvgCeLevel,
            anchor_level: openedPosition.anchorLevel,
          },
        };

        fetch('/api/backtest-trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tradePayload),
        })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json();
              if (data.trade_id) {
                const updated = { ...activePositionRef.current!, dbTradeId: data.trade_id };
                activePositionRef.current = updated;
                setActivePosition(updated);
              }
              onTradesRefresh?.();
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event('backtest-trades-refresh'));
              }
            }
          })
          .catch((err) => console.warn('[useBacktestStrategyExecution] POST trade error:', err));
      } else if (isLimitTouched && !isBodyDefended) {
        // Body defense failed -> Invalidate pending limit
        pendingLimitOrderRef.current = null;
        setPendingLimitOrder(null);
        triggerSmartAlert?.(
          'SMT_TRAP',
          `🚫 [S&R INVALIDATED] Candle body closed through anchor level. Retest order cancelled.`,
          '/audio/dead_zone.wav',
          'REPLAY_STRATEGY'
        );
      }
    }

    // ── STEP B: Immediate Touch Fill or Queue Pending Limit for Fresh Setups ──
    const freshPos = activePositionRef.current;
    const freshPending = pendingLimitOrderRef.current;

    if (currentSetup && !freshPos && !freshPending) {
      const isConfirmed =
        currentSetup.three_pillar_displacement_passed &&
        (!config.enforceDiscountPremiumGate || currentSetup.is_valuation_aligned);

      if (isConfirmed) {
        const entryPrice = currentSetup.entry_price;
        const stopLoss = currentSetup.stop_loss;

        // Pre-flight geometry validation
        const isValidGeometry =
          Number.isFinite(entryPrice) &&
          Number.isFinite(stopLoss) &&
          entryPrice !== stopLoss &&
          Number.isFinite(currentSetup.stage1_target) &&
          currentSetup.stage1_target !== 0 &&
          Number.isFinite(currentSetup.stage2_target) &&
          currentSetup.stage2_target !== 0;

        if (isValidGeometry) {
          const rawDist = Math.abs(entryPrice - stopLoss);
          const riskDistance = Number.isFinite(rawDist) && rawDist > 0.01 ? rawDist : 0.50;

          const equity = accountEquity > 0 ? accountEquity : 10000;
          const riskPct = 2.0;
          const riskUsd = parseFloat((equity * (riskPct / 100)).toFixed(2));
          const contractSize = parseFloat((riskUsd / riskDistance).toFixed(3));

          const basePositionData: ReplayPosition = {
            id: `BT_POS_${currentSetup.type}_${candleTime}`,
            setupId: currentSetup.id,
            direction: currentSetup.type === 'BULLISH' ? 'LONG' : 'SHORT',
            status: 'PENDING_LIMIT',
            entryPrice,
            initialStopLoss: stopLoss,
            activeStopLoss: stopLoss,
            stage1Target: currentSetup.stage1_target,
            stage2Target: currentSetup.stage2_target,
            stage3Target: currentSetup.stage3_target,
            fvgCeLevel: currentSetup.reclaim_fvg_ce,
            riskUsd,
            riskDistance,
            contractSize,
            riskPct,
            realizedR: 0,
            realizedUsd: 0,
            unrealizedR: 0,
            unrealizedUsd: 0,
            isStage1Filled: false,
            isStage2Filled: false,
            isStage3Filled: false,
            openTime: candleTime,
            closeTime: null,
            exitPrice: null,
            exitReason: null,
            anchorLevel: currentSetup.anchor_level,
            timeframe: activeTimeframe,
          };

          const isLong = basePositionData.direction === 'LONG';
          const isImmediateTouchOnCurrentBar = isLong
            ? low <= entryPrice && close >= Math.min(currentSetup.anchor_level, entryPrice)
            : high >= entryPrice && close <= Math.max(currentSetup.anchor_level, entryPrice);

          const isRetestedOnCurrentBar =
            currentSetup.status === 'RETESTED' &&
            (currentSetup.retest_index === currentCandleIdx || currentSetup.is_immediate_fill);

          if (isImmediateTouchOnCurrentBar || isRetestedOnCurrentBar) {
            // Immediate Touch / Retroactive Fill on Current Candle
            const openedPosition: ReplayPosition = {
              ...basePositionData,
              status: 'OPEN',
            };

            activePositionRef.current = openedPosition;
            setActivePosition(openedPosition);

            triggerSmartAlert?.(
              'AUTO_ORDER_ROUTED',
              `🚀 [S&R RETEST FILLED] ${openedPosition.direction} position opened @ $${openedPosition.entryPrice.toFixed(
                2
              )} | Size: ${openedPosition.contractSize} ETH | SL: $${openedPosition.activeStopLoss.toFixed(2)}`,
              '/audio/sweep_alert.mp3',
              'REPLAY_STRATEGY'
            );

            // POST to /api/backtest-trades
            const tradePayload = {
              symbol: 'ETHUSDC',
              direction: openedPosition.direction,
              entry_price: openedPosition.entryPrice,
              stop_loss: openedPosition.activeStopLoss,
              take_profit: openedPosition.stage3Target,
              position_size: openedPosition.contractSize,
              risk_amount_usd: openedPosition.riskUsd,
              risk_percent: openedPosition.riskPct,
              strategy_name: `Sweep & Reclaim (3-Pillar Reversal - ${openedPosition.direction})`,
              ai_narrative_summary: `[Backtest Replay S&R Execution] ${openedPosition.direction} @ $${openedPosition.entryPrice.toFixed(2)} | Anchor: $${openedPosition.anchorLevel.toFixed(2)}`,
              status: 'OPEN',
              opened_at: new Date(candleTime).toISOString(),
              created_at: new Date(candleTime).toISOString(),
              ipda_metrics: {
                timeframe: activeTimeframe,
                stage1_target: openedPosition.stage1Target,
                stage2_target: openedPosition.stage2Target,
                stage3_target: openedPosition.stage3Target,
                fvg_ce: openedPosition.fvgCeLevel,
                anchor_level: openedPosition.anchorLevel,
              },
            };

            fetch('/api/backtest-trades', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(tradePayload),
            })
              .then(async (res) => {
                if (res.ok) {
                  const data = await res.json();
                  if (data.trade_id) {
                    const updated = { ...activePositionRef.current!, dbTradeId: data.trade_id };
                    activePositionRef.current = updated;
                    setActivePosition(updated);
                  }
                  onTradesRefresh?.();
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new Event('backtest-trades-refresh'));
                  }
                }
              })
              .catch((err) => console.warn('[useBacktestStrategyExecution] POST trade error:', err));
          } else if (currentSetup.status === 'RECLAIMED_NO_RETEST' || currentSetup.phase === 'RECLAIM') {
            // Queue Resting Limit Order for future candle retest
            pendingLimitOrderRef.current = basePositionData;
            setPendingLimitOrder(basePositionData);
            triggerSmartAlert?.(
              'AUTO_ORDER_ROUTED',
              `⏳ [S&R LIMIT PLACED] ${basePositionData.direction} Limit resting @ $${entryPrice.toFixed(
                2
              )} (${currentSetup.anchor_name}) | 3-Pillars Confirmed | Risk: $${riskUsd.toFixed(2)} (2.0%).`,
              '/audio/fvg_alert.mp3',
              'REPLAY_STRATEGY'
            );
          }
        }
      }
    }

    // ── STEP C: Track Active Open Position (3-Stage Harvest & Exits) ──────────
    if (currentPos && currentPos.status !== 'CLOSED') {
      const pos = { ...currentPos };

      // FIX-4: Zombie Position Self-Healing Guard — if position geometry is corrupted
      // (NaN entryPrice, zero/NaN riskDistance, or zeroed stage targets), auto-abort
      // and garbage-collect the position immediately so the engine doesn't permanently
      // lock out all future setups. Zero stage1Target causes immediate false-fills for
      // LONGs (high >= 0 is always true) or permanent lockouts for SHORTs (low <= 0 never).
      const isGeometryCorrupted =
        !Number.isFinite(pos.entryPrice) ||
        !Number.isFinite(pos.riskDistance) ||
        pos.riskDistance <= 0 ||
        !Number.isFinite(pos.stage1Target) ||
        pos.stage1Target === 0 ||
        !Number.isFinite(pos.stage2Target) ||
        pos.stage2Target === 0;

      if (isGeometryCorrupted) {
        console.error('[ZOMBIE_POS] Corrupted position geometry detected — auto-aborting to unlock engine:', {
          id: pos.id,
          entryPrice: pos.entryPrice,
          riskDistance: pos.riskDistance,
          stage1Target: pos.stage1Target,
          stage2Target: pos.stage2Target,
        });
        if (pos.setupId) closedSetupIdsRef.current.add(pos.setupId);
        activePositionRef.current = null;
        setActivePosition(null);
        pendingLimitOrderRef.current = null;
        setPendingLimitOrder(null);
        return;
      }

      const isLong = pos.direction === 'LONG';
      // FIX-4: Guard riskDistance against NaN/zero before division — prevents unrealizedR = NaN.
      const riskDistance = Number.isFinite(pos.riskDistance) && pos.riskDistance > 0
        ? pos.riskDistance
        : 0.50;
      const currentDelta = isLong ? (lastPrice || close) - pos.entryPrice : pos.entryPrice - (lastPrice || close);
      const floatingR = Number.isFinite(currentDelta)
        ? parseFloat((currentDelta / riskDistance).toFixed(2))
        : 0;
      pos.unrealizedR = floatingR;
      pos.unrealizedUsd = parseFloat((floatingR * pos.riskUsd).toFixed(2));

      let positionUpdated = false;

      // 1. Tranche 1 Harvest (40% @ 1.0R)
      if (!pos.isStage1Filled) {
        const hitStage1 = isLong ? high >= pos.stage1Target : low <= pos.stage1Target;
        if (hitStage1) {
          pos.isStage1Filled = true;
          pos.status = 'STAGE_1_FILLED';
          const trancheR = 0.40 * 1.0;
          pos.realizedR = parseFloat((pos.realizedR + trancheR).toFixed(2));
          pos.realizedUsd = parseFloat((pos.realizedR * pos.riskUsd).toFixed(2));

          // Advance SL to FVG CE or Breakeven
          if (config.enableStructuralTrail && pos.fvgCeLevel) {
            pos.activeStopLoss = pos.fvgCeLevel;
          } else {
            pos.activeStopLoss = pos.entryPrice;
          }

          // Immediate position state flush to update downstream memo/canvas without frame lag
          activePositionRef.current = { ...pos };
          setActivePosition({ ...pos });

          triggerSmartAlert?.(
            'STAGE_FILL',
            `🎯 [STAGE 1 HARVEST] 40% scaled @ 1.0R ($${pos.stage1Target.toFixed(2)})! Locked +0.40R ($${(
              0.4 * pos.riskUsd
            ).toFixed(2)}). SL advanced to ${pos.fvgCeLevel ? 'FVG CE' : 'Breakeven'} ($${pos.activeStopLoss.toFixed(2)}).`,
            '/audio/objective_update.wav',
            'REPLAY_STRATEGY'
          );

          if (pos.dbTradeId) {
            fetch('/api/backtest-trades', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                trade_id: pos.dbTradeId,
                status: 'STAGE_1_FILLED',
                stop_loss: pos.activeStopLoss,
                realized_pnl: pos.realizedUsd,
              }),
            })
              .then(() => onTradesRefresh?.())
              .catch(() => {});
          }
        }
      }

      // 2. Tranche 2 Harvest (40% @ 1.5R with +1.0R Ratchet Floor)
      if (pos.isStage1Filled && !pos.isStage2Filled) {
        const hitStage2 = isLong ? high >= pos.stage2Target : low <= pos.stage2Target;
        if (hitStage2) {
          pos.isStage2Filled = true;
          pos.status = 'STAGE_2_FILLED';
          const trancheR = 0.40 * 1.5;
          pos.realizedR = parseFloat((pos.realizedR + trancheR).toFixed(2));
          pos.realizedUsd = parseFloat((pos.realizedR * pos.riskUsd).toFixed(2));

          // Ratchet SL to guaranteed +1.0R profit floor
          if (config.enableProfitRatchet) {
            const oneRPrice = isLong
              ? parseFloat((pos.entryPrice + riskDistance * 1.0).toFixed(4))
              : parseFloat((pos.entryPrice - riskDistance * 1.0).toFixed(4));
            pos.activeStopLoss = oneRPrice;
          }

          // Immediate position state flush to update downstream memo/canvas without frame lag
          activePositionRef.current = { ...pos };
          setActivePosition({ ...pos });

          triggerSmartAlert?.(
            'STAGE_FILL',
            `💎 [STAGE 2 HARVEST] 40% scaled @ 1.5R ($${pos.stage2Target.toFixed(2)})! Total Realized: +${pos.realizedR.toFixed(
              2
            )}R ($${pos.realizedUsd.toFixed(2)}). SL ratcheted to +1.0R Floor ($${pos.activeStopLoss.toFixed(2)}).`,
            '/audio/objective_update.wav',
            'REPLAY_STRATEGY'
          );

          if (pos.dbTradeId) {
            fetch('/api/backtest-trades', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                trade_id: pos.dbTradeId,
                status: 'STAGE_2_FILLED',
                stop_loss: pos.activeStopLoss,
                realized_pnl: pos.realizedUsd,
              }),
            })
              .then(() => onTradesRefresh?.())
              .catch(() => {});
          }
        }
      }

      // 3. Tranche 3 DOL Runner Full TP Exit (20% @ 3.0R)
      if (pos.isStage2Filled && !pos.isStage3Filled) {
        const hitStage3 = isLong ? high >= pos.stage3Target : low <= pos.stage3Target;
        if (hitStage3) {
          pos.isStage3Filled = true;
          pos.status = 'CLOSED';
          pos.closeTime = candleTime;
          pos.exitPrice = pos.stage3Target;
          pos.exitReason = 'FULL_TP3_WIN';
          const runnerR = 0.20 * (config.stage3Multiple ?? 3.0);
          pos.realizedR = parseFloat((pos.realizedR + runnerR).toFixed(2));
          pos.realizedUsd = parseFloat((pos.realizedR * pos.riskUsd).toFixed(2));
          pos.unrealizedR = 0;
          pos.unrealizedUsd = 0;

          // Blacklist setup ID from historical scan re-detection
          if (pos.setupId) closedSetupIdsRef.current.add(pos.setupId);
          if (currentSetup?.id) closedSetupIdsRef.current.add(currentSetup.id);

          activePositionRef.current = null;
          setActivePosition(null);
          activeSetupRef.current = null;
          setActiveSetup(null);
          setClosedReplayPositions((prev) => [pos, ...prev]);

          triggerSmartAlert?.(
            'FLOW_STATE',
            `🏆 [FULL TP3 WIN] 20% Runner reached Macro DOL ($${pos.stage3Target.toFixed(
              2
            )})! Final Net Realized: +${pos.realizedR.toFixed(2)}R ($${pos.realizedUsd.toFixed(2)}).`,
            '/audio/pricing_shift.wav',
            'REPLAY_STRATEGY'
          );

          if (pos.dbTradeId) {
            fetch('/api/backtest-trades', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                trade_id: pos.dbTradeId,
                status: 'CLOSED',
                exit_price: pos.exitPrice,
                realized_pnl: pos.realizedUsd,
                outcome: 'WIN',
                closed_at: new Date(candleTime).toISOString(),
              }),
            })
              .then(() => {
                onTradesRefresh?.();
                if (typeof window !== 'undefined') window.dispatchEvent(new Event('backtest-trades-refresh'));
              })
              .catch(() => {});
          }
          return;
        }
      }

      // 4. Hard Stop Loss Violation / Exit Check
      const hitStopLoss = isLong ? low <= pos.activeStopLoss : high >= pos.activeStopLoss;
      if (hitStopLoss) {
        pos.status = 'CLOSED';
        pos.closeTime = candleTime;
        pos.exitPrice = pos.activeStopLoss;
        pos.unrealizedR = 0;
        pos.unrealizedUsd = 0;

        if (pos.isStage2Filled) {
          pos.exitReason = 'STAGE_2_PROFIT_STOP';
          pos.realizedR = parseFloat((pos.realizedR + 0.20 * 1.0).toFixed(2));
        } else if (pos.isStage1Filled) {
          pos.exitReason = 'STAGE_1_BREAKEVEN_STOP';
        } else {
          pos.exitReason = 'HARD_STOP_LOSS';
          pos.realizedR = -1.0;
        }
        pos.realizedUsd = parseFloat((pos.realizedR * pos.riskUsd).toFixed(2));

        // Blacklist setup ID from historical scan re-detection
        if (pos.setupId) closedSetupIdsRef.current.add(pos.setupId);
        if (currentSetup?.id) closedSetupIdsRef.current.add(currentSetup.id);

        activePositionRef.current = null;
        setActivePosition(null);
        activeSetupRef.current = null;
        setActiveSetup(null);
        setClosedReplayPositions((prev) => [pos, ...prev]);

        const outcomeType = pos.realizedR > 0 ? 'WIN' : pos.realizedR === 0 ? 'BE_SCRATCH' : 'LOSS';
        const emoji = outcomeType === 'WIN' ? '🏆' : outcomeType === 'BE_SCRATCH' ? '🛡️' : '🛑';

        triggerSmartAlert?.(
          outcomeType === 'LOSS' ? 'SMT_TRAP' : 'FLOW_STATE',
          `${emoji} [POSITION CLOSED: ${pos.exitReason}] Exited @ $${pos.exitPrice.toFixed(
            2
          )} | Final P&L: ${pos.realizedR > 0 ? '+' : ''}${pos.realizedR.toFixed(2)}R ($${pos.realizedUsd > 0 ? '+' : ''}$${pos.realizedUsd.toFixed(
            2
          )})`,
          outcomeType === 'LOSS' ? '/audio/dead_zone.wav' : '/audio/pricing_shift.wav',
          'REPLAY_STRATEGY'
        );

        if (pos.dbTradeId) {
          fetch('/api/backtest-trades', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trade_id: pos.dbTradeId,
              status: 'CLOSED',
              exit_price: pos.exitPrice,
              realized_pnl: pos.realizedUsd,
              outcome: outcomeType,
              closed_at: new Date(candleTime).toISOString(),
            }),
          })
            .then(() => {
              onTradesRefresh?.();
              if (typeof window !== 'undefined') window.dispatchEvent(new Event('backtest-trades-refresh'));
            })
            .catch(() => {});
        }
        return;
      }
    }
  }, [
    lastCandle?.t,
    lastPrice,
    isAutoExecuteEnabled,
    config,
    activeTimeframe,
    accountEquity,
    triggerSmartAlert,
    onTradesRefresh,
  ]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Compute High-Contrast Canvas Overlay Geometry for Chart.tsx
  // ─────────────────────────────────────────────────────────────────────────────
  const srOverlay = useMemo<SweepReclaimOverlayData | null>(() => {
    if (!activeSetup) return null;
    if (activePosition?.status === 'CLOSED') return null;

    const isBull = activeSetup.type === 'BULLISH';
    let phase: SweepReclaimOverlayData['phase'] = 'ANCHOR';
    let statusText = 'Phase 1: Anchor Detected';

    if (activePosition) {
      phase = 'OPEN';
      const uR = activePosition.unrealizedR ?? 0;
      statusText = `Position OPEN (${activePosition.direction}) | ${uR > 0 ? '+' : ''}${uR.toFixed(2)}R`;
    } else if (pendingLimitOrder) {
      phase = 'RETEST';
      statusText = `Phase 4: Retest Limit Resting @ $${(pendingLimitOrder.entryPrice ?? 0).toFixed(2)}`;
    } else if (activeSetup.status === 'RETESTED' || activeSetup.is_retested) {
      phase = 'RETEST';
      statusText = 'Phase 4: Retest Confirmed';
    } else if (activeSetup.status === 'RECLAIMED_NO_RETEST' || activeSetup.is_reclaimed) {
      phase = 'RECLAIM';
      statusText = 'Phase 3: 3-Pillar Reclaim Confirmed';
    } else if (activeSetup.status === 'SWEPT_NO_RECLAIM' || activeSetup.sweep_index !== null) {
      phase = 'SWEEP';
      statusText = 'Phase 2: Liquidity Swept';
    }

    return {
      id: activeSetup.id,
      type: isBull ? 'BULLISH' : 'BEARISH',
      phase,
      anchorName: activeSetup.anchor_name,
      anchorLevel: activeSetup.anchor_level,
      sweepPrice: activeSetup.sweep_price,
      sweepObMt: activeSetup.sweep_ob_mt,
      reclaimPrice: activeSetup.reclaim_close_price,
      fvgTop: activeSetup.reclaim_fvg_top,
      fvgBottom: activeSetup.reclaim_fvg_bottom,
      fvgCe: activeSetup.reclaim_fvg_ce,
      entryPrice: activePosition?.entryPrice ?? pendingLimitOrder?.entryPrice ?? activeSetup.entry_price,
      stopLoss: activePosition?.activeStopLoss ?? pendingLimitOrder?.activeStopLoss ?? activeSetup.stop_loss,
      target1: activePosition?.stage1Target ?? activeSetup.stage1_target,
      target2: activePosition?.stage2Target ?? activeSetup.stage2_target,
      target3: activePosition?.stage3Target ?? activeSetup.stage3_target,
      volExpansion: activeSetup.reclaim_volume_expansion ?? 1.0,
      deltaDominance: activeSetup.reclaim_delta_dominance_pct ?? 50.0,
      bodyRatio: activeSetup.reclaim_body_ratio ?? 50.0,
      threePillarsPassed: activeSetup.three_pillar_displacement_passed,
      isValuationAligned: activeSetup.is_valuation_aligned,
      realizedR: activePosition?.realizedR ?? 0,
      unrealizedR: activePosition?.unrealizedR ?? 0,
      statusText,
      isStage1Filled: activePosition?.isStage1Filled ?? false,
      isStage2Filled: activePosition?.isStage2Filled ?? false,
      isStage3Filled: activePosition?.isStage3Filled ?? false,
      isClosed: false,
    };
  }, [activeSetup, activePosition, pendingLimitOrder]);

  return {
    config,
    updateConfig,
    availablePresets,
    selectedPresetId,
    selectPreset,
    isAutoExecuteEnabled,
    toggleAutoExecute,
    activeSetup,
    activePosition,
    pendingLimitOrder,
    closedReplayPositions,
    srOverlay,
  };
}
