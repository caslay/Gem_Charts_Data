/**
 * proximityRadar.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow-State Quant Engine — Asynchronous Armed Intent & Proximity Radar Pipeline
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the Two-Stage "Armed Intent & Proximity Radar" architecture:
 *
 * Stage 1 (Armed Intent):
 *  - External AI agents define setup geometry, Point of Interest (POI) action
 *    zone boundaries, and structural trigger criteria (e.g. MSS body close).
 *  - Quegar persists intent and arms the local radar in ARMED_WATCHING_TRIGGER state.
 *
 * Stage 2 (Deterministic Execution):
 *  - Proximity Radar: Monitors real-time ticks. Far from POI = DORMANT;
 *    upon POI penetration = elevated to PROXIMITY_ELEVATED (inspecting 1m/5m micro-candles).
 *  - Trigger Evaluator: Evaluates closed candles for exact physical confirmation
 *    (e.g., MSS body close beyond trigger level with volumetric displacement).
 *  - Auto-Arming: Calculates dynamic position sizing (2% risk, 0.15% clamp),
 *    clears Risk Governor, places resting limit order, and transitions to ORDER_RESTING.
 *  - Expiration & Atomic Cancellation: 12-bar TTL expiration or early Target 1 touch
 *    before fill atomicaly invalidates the setup and notifies Telegram.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from '../fvgEngine';

export type ArmedIntentExecutionMode =
  | 'IMMEDIATE_LIMIT'
  | 'TRIGGER_ON_CONFIRMATION'
  | 'STANDBY'
  | 'PAPER_TRADING'
  | 'LIVE_BINANCE';

export type ArmedIntentTriggerCondition =
  | 'MSS_BODY_CLOSE_ABOVE'
  | 'MSS_BODY_CLOSE_BELOW'
  | 'SWEEP_AND_RECLAIM'
  | 'NONE';

export type ArmedIntentStage =
  | 'ARMED_PENDING'
  | 'PROXIMITY_ELEVATED'
  | 'ORDER_RESTING'
  | 'IN_FLIGHT_STAGE_1'
  | 'IN_FLIGHT_STAGE_2'
  | 'IN_FLIGHT_STAGE_3'
  | 'EXPIRED'
  | 'INVALIDATED'
  | 'COMPLETED';

export type RadarProximityStatus = 'DORMANT' | 'PROXIMITY_ELEVATED' | 'TRIGGERED';

export type DaemonStateMachineState =
  | 'SEARCHING'
  | 'ARMED_WATCHING_TRIGGER'
  | 'ORDER_RESTING'
  | 'ACTIVE_TRADE';

export interface ArmedIntent {
  id: number;
  symbol: string;
  agentId: string;
  direction: 'LONG' | 'SHORT';
  executionMode: ArmedIntentExecutionMode;
  triggerCondition: ArmedIntentTriggerCondition;
  triggerPrice: number;
  triggerTimeframe: string; // e.g. '1m', '3m', '5m', '15m'
  poiZoneLow: number;
  poiZoneHigh: number;
  limitOffsetRule: 'FVG_PROXIMAL' | 'ANCHOR_PRICE' | 'POI_MIDPOINT' | 'LIMIT_EXACT' | string;
  ttlBars: number; // default: 12 bars
  barsElapsed: number;
  invalidationLevel: number;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  stage1Ratio?: number;
  stage2Ratio?: number;
  stage3Ratio?: number;
  limitEntryPrice?: number | null;
  fvgProximalPrice?: number | null;
  narrative?: string | null;
  radarStatus: RadarProximityStatus;
  stage: ArmedIntentStage;
  armedAt: number;
  triggeredAt?: number | null;
  invalidatedAt?: number | null;
  invalidationReason?: string;
  associatedPositionId?: string;
  resolvedEntryPrice?: number;
}

export interface ProximityEvaluationResult {
  intent: ArmedIntent;
  previousStatus: RadarProximityStatus;
  currentStatus: RadarProximityStatus;
  reason: string;
}

export interface InvalidationEvaluationResult {
  intent: ArmedIntent;
  reason: string;
  breachPrice: number;
  timestamp: number;
}

export interface TriggerEvaluationResult {
  intent: ArmedIntent;
  triggerCandle: Candle;
  resolvedEntryPrice: number;
  volumetricPassed: boolean;
  timestamp: number;
}

export interface CandleEvaluationOutput {
  triggered: TriggerEvaluationResult[];
  expired: ArmedIntent[];
  invalidated: InvalidationEvaluationResult[];
}

export class ProximityRadarEngine {
  private intents: Map<number, ArmedIntent> = new Map();

  constructor(initialIntents?: ArmedIntent[]) {
    if (initialIntents && Array.isArray(initialIntents)) {
      for (const intent of initialIntents) {
        this.registerIntent(intent);
      }
    }
  }

  /**
   * Register or update an armed intent in the radar.
   */
  public registerIntent(intent: ArmedIntent): void {
    const sanitized: ArmedIntent = {
      ...intent,
      symbol: (intent.symbol || 'ETHUSDC').toUpperCase().replace(/[-_/]/g, ''),
      direction: intent.direction === 'SHORT' ? 'SHORT' : 'LONG',
      executionMode: intent.executionMode || 'TRIGGER_ON_CONFIRMATION',
      triggerCondition: intent.triggerCondition || 'MSS_BODY_CLOSE_ABOVE',
      triggerPrice: Number(intent.triggerPrice) || 0,
      triggerTimeframe: (intent.triggerTimeframe || '5m').toLowerCase(),
      poiZoneLow: Number(intent.poiZoneLow) || 0,
      poiZoneHigh: Number(intent.poiZoneHigh) || 0,
      limitOffsetRule: intent.limitOffsetRule || 'FVG_PROXIMAL',
      ttlBars: intent.ttlBars && intent.ttlBars > 0 ? intent.ttlBars : 12,
      barsElapsed: intent.barsElapsed || 0,
      invalidationLevel: Number(intent.invalidationLevel) || 0,
      target1: intent.target1 ? Number(intent.target1) : null,
      target2: intent.target2 ? Number(intent.target2) : null,
      target3: intent.target3 ? Number(intent.target3) : null,
      radarStatus: intent.radarStatus || 'DORMANT',
      stage: intent.stage || 'ARMED_PENDING',
      armedAt: intent.armedAt || Date.now(),
    };

    this.intents.set(sanitized.id, sanitized);
  }

  /**
   * Remove an armed intent by ID.
   */
  public removeIntent(id: number): boolean {
    return this.intents.delete(id);
  }

  /**
   * Retrieve intent by ID.
   */
  public getIntent(id: number): ArmedIntent | undefined {
    return this.intents.get(id);
  }

  /**
   * Return all registered intents.
   */
  public getAllIntents(): ArmedIntent[] {
    return Array.from(this.intents.values());
  }

  /**
   * Return only active intents awaiting trigger.
   */
  public getActiveIntents(symbol?: string): ArmedIntent[] {
    const cleanSym = symbol ? symbol.toUpperCase().replace(/[-_/]/g, '') : null;
    return Array.from(this.intents.values()).filter((intent) => {
      const isPending =
        intent.stage === 'ARMED_PENDING' || intent.stage === 'PROXIMITY_ELEVATED';
      if (!isPending) return false;
      if (cleanSym && intent.symbol !== cleanSym) return false;
      return true;
    });
  }

  /**
   * Evaluates incoming real-time market ticks:
   * 1. Detects POI zone penetration: Elevates radar monitoring from DORMANT to PROXIMITY_ELEVATED.
   * 2. Invalidation pre-check: If live price breaches stop loss before fill -> invalidates.
   * 3. Early target hit check: If live price touches Target 1 before entry -> invalidates.
   */
  public onMarketTick(
    livePrice: number,
    symbol: string = 'ETHUSDC'
  ): {
    elevated: ProximityEvaluationResult[];
    deElevated: ProximityEvaluationResult[];
    invalidated: InvalidationEvaluationResult[];
  } {
    const elevated: ProximityEvaluationResult[] = [];
    const deElevated: ProximityEvaluationResult[] = [];
    const invalidated: InvalidationEvaluationResult[] = [];
    const activeIntents = this.getActiveIntents(symbol);

    for (const intent of activeIntents) {
      // 1. Invalidation Check: adverse stop price breach
      if (
        (intent.direction === 'LONG' && livePrice <= intent.invalidationLevel) ||
        (intent.direction === 'SHORT' && livePrice >= intent.invalidationLevel)
      ) {
        const breachReason = `Live price ($${livePrice.toFixed(2)}) breached invalidation level ($${intent.invalidationLevel.toFixed(2)})`;
        intent.stage = 'INVALIDATED';
        intent.invalidatedAt = Date.now();
        intent.invalidationReason = breachReason;
        invalidated.push({
          intent,
          reason: breachReason,
          breachPrice: livePrice,
          timestamp: Date.now(),
        });
        continue;
      }

      // 2. Early Target 1 Touch Check (Atomic Cancellation)
      if (intent.target1 !== null && intent.target1 > 0) {
        const isTarget1Hit =
          (intent.direction === 'LONG' && livePrice >= intent.target1) ||
          (intent.direction === 'SHORT' && livePrice <= intent.target1);

        if (isTarget1Hit) {
          const cancelReason = `Target 1 ($${intent.target1.toFixed(2)}) touched at $${livePrice.toFixed(2)} before entry fill (Missed Expansion)`;
          intent.stage = 'INVALIDATED';
          intent.invalidatedAt = Date.now();
          intent.invalidationReason = cancelReason;
          invalidated.push({
            intent,
            reason: cancelReason,
            breachPrice: livePrice,
            timestamp: Date.now(),
          });
          continue;
        }
      }

      // 3. Proximity Radar Elevation & De-Elevation (with anti-oscillation hysteresis)
      const zoneFloor = Math.min(intent.poiZoneLow, intent.poiZoneHigh);
      const zoneCeil = Math.max(intent.poiZoneLow, intent.poiZoneHigh);
      const zoneHeight = Math.max(1.0, zoneCeil - zoneFloor);
      const proximityBuffer = zoneHeight * 0.2; // 20% outer buffer

      const isInActionZone =
        livePrice >= zoneFloor - proximityBuffer &&
        livePrice <= zoneCeil + proximityBuffer;

      if (isInActionZone && intent.radarStatus !== 'PROXIMITY_ELEVATED') {
        const prev = intent.radarStatus;
        intent.radarStatus = 'PROXIMITY_ELEVATED';
        intent.stage = 'PROXIMITY_ELEVATED';
        elevated.push({
          intent,
          previousStatus: prev,
          currentStatus: 'PROXIMITY_ELEVATED',
          reason: `Price ($${livePrice.toFixed(2)}) penetrated POI Action Zone [$${zoneFloor.toFixed(2)} - $${zoneCeil.toFixed(2)}]`,
        });
      } else if (!isInActionZone && intent.radarStatus === 'PROXIMITY_ELEVATED') {
        // Price pulled significantly away from POI zone
        const hysteresisBuffer = zoneHeight * 0.5;
        if (
          livePrice < zoneFloor - hysteresisBuffer ||
          livePrice > zoneCeil + hysteresisBuffer
        ) {
          const prev = intent.radarStatus;
          intent.radarStatus = 'DORMANT';
          intent.stage = 'ARMED_PENDING';
          deElevated.push({
            intent,
            previousStatus: prev,
            currentStatus: 'DORMANT',
            reason: `Price ($${livePrice.toFixed(2)}) pulled back outside POI hysteresis zone [$${(zoneFloor - hysteresisBuffer).toFixed(2)} - $${(zoneCeil + hysteresisBuffer).toFixed(2)}]`,
          });
        }
      }
    }

    return { elevated, deElevated, invalidated };
  }

  /**
   * Evaluates closed candle events from Binance WebSocket:
   * 1. Increments TTL bars elapsed for matching timeframe (or micro-candles if elevated).
   * 2. Checks 12-bar TTL expiration.
   * 3. Checks intra-candle invalidation or target 1 hits.
   * 4. Evaluates structural trigger condition (MSS_BODY_CLOSE_ABOVE, MSS_BODY_CLOSE_BELOW, SWEEP_AND_RECLAIM).
   * 5. Resolves resting limit entry price based on limitOffsetRule.
   */
  public onCandleClosed(
    candleTimeframe: string,
    candle: Candle,
    symbol: string = 'ETHUSDC'
  ): CandleEvaluationOutput {
    const triggered: TriggerEvaluationResult[] = [];
    const expired: ArmedIntent[] = [];
    const invalidated: InvalidationEvaluationResult[] = [];

    const normTf = candleTimeframe.toLowerCase();
    const activeIntents = this.getActiveIntents(symbol);

    for (const intent of activeIntents) {
      const isPrimaryTfMatch = intent.triggerTimeframe === normTf;
      // When proximity is elevated, evaluate 1m or 5m micro-candles
      const isMicroCandleElevation =
        intent.radarStatus === 'PROXIMITY_ELEVATED' &&
        (normTf === '1m' || normTf === '3m' || normTf === '5m');

      if (!isPrimaryTfMatch && !isMicroCandleElevation) {
        continue;
      }

      // Increment TTL bar count only on primary trigger timeframe to avoid accelerated countdown
      if (isPrimaryTfMatch) {
        intent.barsElapsed++;
      }

      // 1. Check TTL Expiration
      if (intent.barsElapsed >= intent.ttlBars) {
        intent.stage = 'EXPIRED';
        intent.invalidatedAt = candle.t || Date.now();
        intent.invalidationReason = `TTL Expired: ${intent.barsElapsed} bars elapsed on ${intent.triggerTimeframe} without trigger confirmation`;
        expired.push(intent);
        continue;
      }

      // 2. Intra-Candle Invalidation Check
      const candleBreachedSl =
        (intent.direction === 'LONG' && candle.l <= intent.invalidationLevel) ||
        (intent.direction === 'SHORT' && candle.h >= intent.invalidationLevel);

      if (candleBreachedSl) {
        const breachPrice = intent.direction === 'LONG' ? candle.l : candle.h;
        const reason = `Candle extreme ($${breachPrice.toFixed(2)}) breached invalidation level ($${intent.invalidationLevel.toFixed(2)})`;
        intent.stage = 'INVALIDATED';
        intent.invalidatedAt = candle.t || Date.now();
        intent.invalidationReason = reason;
        invalidated.push({
          intent,
          reason,
          breachPrice,
          timestamp: candle.t || Date.now(),
        });
        continue;
      }

      // 3. Intra-Candle Target 1 Cancellation Check (Missed Expansion)
      if (intent.target1 !== null && intent.target1 > 0) {
        const candleHitTarget1 =
          (intent.direction === 'LONG' && candle.h >= intent.target1) ||
          (intent.direction === 'SHORT' && candle.l <= intent.target1);

        if (candleHitTarget1) {
          const hitPrice = intent.direction === 'LONG' ? candle.h : candle.l;
          const reason = `Target 1 ($${intent.target1.toFixed(2)}) reached at $${hitPrice.toFixed(2)} before entry was filled (Missed Expansion)`;
          intent.stage = 'INVALIDATED';
          intent.invalidatedAt = candle.t || Date.now();
          intent.invalidationReason = reason;
          invalidated.push({
            intent,
            reason,
            breachPrice: hitPrice,
            timestamp: candle.t || Date.now(),
          });
          continue;
        }
      }

      // 4. Trigger Condition Evaluation
      // A structural trigger (e.g. 5m MSS body close) requires the primary trigger timeframe candle to close.
      // Micro-candles (1m/3m) when elevated evaluate intra-candle invalidations and TP1 hits above,
      // but do not prematurely trigger structural setups configured for higher timeframes.
      if (!isPrimaryTfMatch) {
        continue;
      }

      const condition = intent.triggerCondition;
      let isTriggered = false;
      let volumetricPassed = false;

      const candleRange = Math.max(0.01, candle.h - candle.l);
      const bodySize = Math.abs(candle.c - candle.o);
      const bodyRatio = bodySize / candleRange;
      const isBullishCandle = candle.c > candle.o;
      const isBearishCandle = candle.c < candle.o;

      // Volumetric sponsorship criteria:
      // Minimum body ratio >= 0.25 (strong body close) OR high taker delta conviction
      const takerBuy = candle.taker_buy_vol || 0;
      const takerSell = candle.taker_sell_vol || (candle.v ? candle.v - takerBuy : 0);
      const totalVol = Math.max(1, takerBuy + takerSell);
      const takerBuyRatio = takerBuy / totalVol;

      if (condition === 'MSS_BODY_CLOSE_ABOVE') {
        const bodyClosedAbove = candle.c > intent.triggerPrice;
        const directionalDisplacement =
          isBullishCandle && (bodyRatio >= 0.25 || takerBuyRatio >= 0.50);

        if (bodyClosedAbove && directionalDisplacement) {
          isTriggered = true;
          volumetricPassed = true;
        }
      } else if (condition === 'MSS_BODY_CLOSE_BELOW') {
        const bodyClosedBelow = candle.c < intent.triggerPrice;
        const directionalDisplacement =
          isBearishCandle && (bodyRatio >= 0.25 || takerBuyRatio <= 0.50);

        if (bodyClosedBelow && directionalDisplacement) {
          isTriggered = true;
          volumetricPassed = true;
        }
      } else if (condition === 'SWEEP_AND_RECLAIM') {
        if (intent.direction === 'LONG') {
          // Swept below trigger price and closed back above
          const swept = candle.l < intent.triggerPrice;
          const reclaimed = candle.c > intent.triggerPrice;
          const volOk = isBullishCandle || bodyRatio >= 0.25 || takerBuyRatio >= 0.50;
          if (swept && reclaimed && volOk) {
            isTriggered = true;
            volumetricPassed = true;
          }
        } else {
          // Swept above trigger price and closed back below
          const swept = candle.h > intent.triggerPrice;
          const reclaimed = candle.c < intent.triggerPrice;
          const volOk = isBearishCandle || bodyRatio >= 0.25 || takerBuyRatio <= 0.50;
          if (swept && reclaimed && volOk) {
            isTriggered = true;
            volumetricPassed = true;
          }
        }
      }

      if (isTriggered && volumetricPassed) {
        // Resolve resting limit entry price based on limitOffsetRule
        let resolvedEntryPrice = intent.triggerPrice;

        const zoneFloor = Math.min(intent.poiZoneLow, intent.poiZoneHigh);
        const zoneCeil = Math.max(intent.poiZoneLow, intent.poiZoneHigh);

        if (intent.limitOffsetRule === 'FVG_PROXIMAL') {
          // Bullish: proximal retest high boundary of action zone
          // Bearish: proximal retest low boundary of action zone
          resolvedEntryPrice =
            intent.direction === 'LONG'
              ? (zoneCeil > 0 ? zoneCeil : candle.c)
              : (zoneFloor > 0 ? zoneFloor : candle.c);
        } else if (intent.limitOffsetRule === 'POI_MIDPOINT') {
          resolvedEntryPrice =
            zoneFloor > 0 && zoneCeil > 0
              ? (zoneFloor + zoneCeil) / 2
              : (intent.triggerPrice > 0 ? intent.triggerPrice : candle.c);
        } else if (intent.limitOffsetRule === 'ANCHOR_PRICE') {
          resolvedEntryPrice =
            intent.direction === 'LONG'
              ? (zoneFloor > 0 ? zoneFloor : intent.triggerPrice)
              : (zoneCeil > 0 ? zoneCeil : intent.triggerPrice);
        } else if (
          intent.limitOffsetRule === 'LIMIT_EXACT' &&
          intent.limitEntryPrice &&
          intent.limitEntryPrice > 0
        ) {
          resolvedEntryPrice = intent.limitEntryPrice;
        } else {
          // Default to trigger price
          resolvedEntryPrice = intent.triggerPrice > 0 ? intent.triggerPrice : candle.c;
        }

        if (!resolvedEntryPrice || resolvedEntryPrice <= 0) {
          resolvedEntryPrice = intent.triggerPrice > 0 ? intent.triggerPrice : candle.c;
        }

        intent.stage = 'ORDER_RESTING';
        intent.radarStatus = 'TRIGGERED';
        intent.triggeredAt = candle.t || Date.now();
        intent.resolvedEntryPrice = resolvedEntryPrice;

        triggered.push({
          intent,
          triggerCandle: candle,
          resolvedEntryPrice,
          volumetricPassed,
          timestamp: candle.t || Date.now(),
        });
      }
    }

    return { triggered, expired, invalidated };
  }

  /**
   * Resolves the overall Daemon state machine:
   * - ACTIVE_TRADE: An active in-flight position is currently running.
   * - ORDER_RESTING: A resting limit order is on the order book.
   * - ARMED_WATCHING_TRIGGER: At least one armed intent is waiting for structural confirmation.
   * - SEARCHING: Baseline state, no active trades or armed intents.
   */
  public resolveDaemonState(
    activePositionsCount: number = 0,
    pendingOrdersCount: number = 0,
    symbol?: string
  ): DaemonStateMachineState {
    if (activePositionsCount > 0) {
      return 'ACTIVE_TRADE';
    }
    if (pendingOrdersCount > 0) {
      return 'ORDER_RESTING';
    }
    if (this.getActiveIntents(symbol).length > 0) {
      return 'ARMED_WATCHING_TRIGGER';
    }
    return 'SEARCHING';
  }
}
