/**
 * LiveOrderBlockExecutionEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 7 Live Automated Execution Engine & Real-Time Position Manager.
 *
 * Capabilities:
 *  - Global Single-Position Concurrency Cap (maxOpenPositions: 1)
 *  - Zone Single-Use Doctrine (consumedZoneIds Set to eliminate multi-entry spam)
 *  - Mandatory Post-Trade Cooldown Timer (prevents rapid-fire stop-out loops)
 *  - Live In-Zone Volumetric Confirmation Gatekeeper:
 *      * 50% Mean Threshold (MT) body close defense
 *      * Volumetric rejection expansion (>= 1.25x Volume SMA) + Directional Taker Delta dominance
 *      * Active unmitigated Draw on Liquidity (DOL) target verification
 *  - Live 3-Stage Position Scaling & Profit-Locking Ratchet Router:
 *      * Tranche 1 (TP1 @ 1.0R - 40% Allocation): Banks partial profit, trails SL to FVG CE
 *      * Tranche 2 (TP2 @ 1.5R - 40% Allocation): Banks intermediate expansion, ratchets SL to +1.0R floor
 *      * Tranche 3 (TP3 / DOL Runner - 20% Allocation): Trails remaining inventory to macro DOL
 *  - Active Zone Garbage Collection & Expiry Pruning (max 24 bars lookback)
 *  - Auto-Journaling Bridge for automated database trade persistence (/api/trades)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from '../fvgEngine';
import {
  InstitutionalOrderBlock,
  OrderBlockEngine,
  OrderBlockScanConfig,
  PositionScalingMode,
  TrailingStopMode
} from './OrderBlockEngine';

export interface LivePosition {
  id: string;
  orderBlockId: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  status: 'OPEN' | 'STAGE_1_FILLED' | 'STAGE_2_FILLED' | 'CLOSED';
  entryPrice: number;
  initialStopLoss: number;
  activeStopLoss: number;
  activeRatchetFloor: number | null;
  trailingSlSource: 'INITIAL' | 'FVG_CE' | 'SWING_PIVOT' | 'PROFIT_RATCHET_FLOOR' | 'BREAKEVEN';

  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  dynamicDolTarget: number | null;
  risk: number;

  allocatedAmount: number;     // e.g. 1.0 unit position size
  remainingAllocation: number;  // starts at 1.0 -> 0.6 -> 0.2 -> 0.0
  realizedR: number;            // cumulative realized R-multiple
  unrealizedR: number;          // current open unrealized R on active balance

  isTp1Filled: boolean;
  isTp2Filled: boolean;
  isTp3Filled: boolean;
  tp1HitTime: number | null;
  tp2HitTime: number | null;
  tp3HitTime: number | null;
  openTime: number;
  closeTime: number | null;
  exitReason: 'STOPPED_OUT' | 'STAGE_1_SCRATCH' | 'STAGE_2_WIN' | 'FULL_TP3_WIN' | null;

  orderBlock: InstitutionalOrderBlock;
}

export interface LiveExecutionConfig extends OrderBlockScanConfig {
  autoExecute: boolean;
  maxOpenPositions: number;
  fixedRiskUsd: number;
  enableSoundAlerts: boolean;
  cooldownMs: number;
  requireInZoneConfirmation: boolean;
  volumeExpansionThreshold: number;
}

export const DEFAULT_LIVE_EXEC_CONFIG: LiveExecutionConfig = {
  symbol: 'ETHUSDC',
  timeframe: '15m',
  autoExecute: true,
  maxOpenPositions: 1,           // Strict single-position cap
  fixedRiskUsd: 100,
  enableSoundAlerts: true,
  cooldownMs: 60000,             // 60-second mandatory cooldown post trade close
  requireInZoneConfirmation: true,// Eliminate blind limit fills
  volumeExpansionThreshold: 1.25,// >= 1.25x Volume SMA requirement
  strictTierAPlus: false,
  minQualityTier: 'ALL',
  maxBarsToMitigation: 24,       // Lookback limit for fresh zones
  enableBreakerSimulation: true,
  maxBreakerRetestBars: 20,
  enableDynamicManagement: true,
  positionScalingMode: 'THREE_STAGE_HARVEST',
  tp1Ratio: 0.40,
  tp2Ratio: 0.40,
  tp3Ratio: 0.20,
  tp1Multiple: 1.0,
  tp2Multiple: 1.5,
  targetRewardRatio: 2.5,
  trailingStopMode: 'STRUCTURAL_FVG_TRAIL',
  trailingBuffer: 0.05,
  adaptiveBreakerConfirmation: true,
  dynamicDolTp2Scaling: true,
  requireBreakerConfirmation: true,
  requireBreakerDOL: true,
  requireBreakerVolumetric: true,
  breakerSessionFilter: 'ALL',
  aggregateConsecutiveCandles: true,
  maxConsecutiveLookback: 5,
  entryMode: 'MEAN_THRESHOLD',
};

export type TradeEventCallback = (event: {
  type: 'ORDER_OPENED' | 'STAGE_1_HARVEST' | 'STAGE_2_HARVEST' | 'STAGE_3_RUNNER' | 'POSITION_CLOSED' | 'CONFIRMATION_PENDING' | 'COOLDOWN_ACTIVE';
  position?: LivePosition;
  message: string;
}) => void;

export interface InZoneTestingState {
  zoneId: string;
  touchTime: number;
  touchPrice: number;
  status: 'AWAITING_IN_ZONE_CONFIRMATION' | 'CONFIRMED' | 'REJECTED';
}

export class LiveOrderBlockExecutionEngine {
  private config: LiveExecutionConfig;
  private orderBlockEngine: OrderBlockEngine;
  private closedCandles: Candle[] = [];
  private activeZones: InstitutionalOrderBlock[] = [];
  private openPositions: Map<string, LivePosition> = new Map();
  private closedPositions: LivePosition[] = [];
  private eventListeners: TradeEventCallback[] = [];
  private lastProcessedCandleTime: number = 0;

  // Single-use zone doctrine and cooldown tracking
  private consumedZoneIds: Set<string> = new Set();
  private cooldownUntilTimestamp: number = 0;
  private inZoneTestingStates: Map<string, InZoneTestingState> = new Map();

  constructor(customConfig?: Partial<LiveExecutionConfig>) {
    this.config = { ...DEFAULT_LIVE_EXEC_CONFIG, ...customConfig };
    this.orderBlockEngine = new OrderBlockEngine(this.config);
  }

  public updateConfig(newConfig: Partial<LiveExecutionConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.orderBlockEngine = new OrderBlockEngine(this.config);
  }

  public subscribe(callback: TradeEventCallback): () => void {
    this.eventListeners.push(callback);
    return () => {
      this.eventListeners = this.eventListeners.filter(cb => cb !== callback);
    };
  }

  private emitEvent(
    type: 'ORDER_OPENED' | 'STAGE_1_HARVEST' | 'STAGE_2_HARVEST' | 'STAGE_3_RUNNER' | 'POSITION_CLOSED' | 'CONFIRMATION_PENDING' | 'COOLDOWN_ACTIVE',
    position: LivePosition | undefined,
    message: string
  ) {
    for (const listener of this.eventListeners) {
      try {
        listener({ type, position, message });
      } catch (err) {
        console.error('[LiveExecutionEngine] Listener error:', err);
      }
    }
  }

  /**
   * Ingests a new closed candlestick event from the market data stream.
   * Runs the zero look-ahead multi-gate validation pipeline and performs zone garbage collection.
   */
  public onCandleClosed(candle: Candle, allHistoricalCandles?: Candle[]) {
    if (candle.t <= this.lastProcessedCandleTime) return;
    this.lastProcessedCandleTime = candle.t;

    if (allHistoricalCandles && allHistoricalCandles.length > 0) {
      this.closedCandles = [...allHistoricalCandles].sort((a, b) => a.t - b.t);
    } else {
      this.closedCandles.push(candle);
      if (this.closedCandles.length > 300) {
        this.closedCandles = this.closedCandles.slice(-300);
      }
    }

    // Run Order Block Scan on strictly closed candles
    const scanResult = this.orderBlockEngine.scanHistoricalOrderBlocks(this.closedCandles);

    // ── Active Zone Garbage Collection & Expiry Pruning ──
    const maxLookbackMs = (this.config.maxBarsToMitigation ?? 24) * 15 * 60 * 1000;
    const now = candle.t;

    this.activeZones = scanResult.orderBlocks.filter(ob => {
      // 1. Purge consumed zones (single-use doctrine)
      if (this.consumedZoneIds.has(ob.id)) return false;

      // 2. Purge stale zones exceeding max lookback window
      const ageMs = now - ob.origin_time;
      if (ageMs > maxLookbackMs && ob.lifecycle_status === 'UNTESTED') return false;

      // 3. Purge invalidated zones
      if (
        ob.lifecycle_status === 'ZONE_INVALIDATED' ||
        ob.lifecycle_status === 'MEAN_THRESHOLD_VIOLATED' ||
        ob.lifecycle_status === 'EXPIRED_STALE' ||
        ob.lifecycle_status === 'BREAKER_EXPIRED' ||
        ob.lifecycle_status === 'BREAKER_VETOED_NO_DOL' ||
        ob.lifecycle_status === 'BREAKER_VETOED_VALUATION'
      ) {
        this.consumedZoneIds.add(ob.id);
        return false;
      }

      // 4. Retain only valid resting or active breaker zones
      return (
        ob.lifecycle_status === 'UNTESTED' ||
        ob.lifecycle_status === 'ACTIVE_BREAKER' ||
        ob.lifecycle_status === 'BREAKER_CONFIRMED_ACTIVE'
      );
    });

    // ── Evaluate In-Zone Testing Confirmations on Closed Candle ──
    if (this.inZoneTestingStates.size > 0 && this.config.autoExecute && this.openPositions.size < this.config.maxOpenPositions) {
      for (const [zoneId, testState] of this.inZoneTestingStates.entries()) {
        const zone = this.activeZones.find(z => z.id === zoneId);
        if (!zone || this.consumedZoneIds.has(zoneId)) {
          this.inZoneTestingStates.delete(zoneId);
          continue;
        }

        const isBullish = zone.is_breaker ? (zone.type === 'BEARISH') : (zone.type === 'BULLISH');

        // Check Mean Threshold Respect: Candle body must not close beyond MT
        const mtRespected = isBullish
          ? candle.c >= zone.mean_threshold
          : candle.c <= zone.mean_threshold;

        if (!mtRespected) {
          // Mean Threshold violated on closing basis -> invalidate & consume
          this.consumedZoneIds.add(zoneId);
          this.inZoneTestingStates.delete(zoneId);
          continue;
        }

        // Check Volumetric Rejection Expansion & Taker Delta
        const volExp = this.verifyVolumetricConfirmation(isBullish, candle);

        if (volExp) {
          testState.status = 'CONFIRMED';
          this.openLivePosition(zone, candle.c, candle.t);
          this.inZoneTestingStates.delete(zoneId);
          if (this.openPositions.size >= this.config.maxOpenPositions) break;
        }
      }
    }
  }

  /**
   * Helper to verify volume expansion and directional taker delta dominance on closed rejection bar.
   */
  private verifyVolumetricConfirmation(isBullish: boolean, candle: Candle): boolean {
    if (!this.closedCandles || this.closedCandles.length < 10) return true;

    // Calculate 10-bar Volume SMA
    const recentBars = this.closedCandles.slice(-10);
    const avgVol = recentBars.reduce((sum, c) => sum + (c.v || 0), 0) / recentBars.length;
    const volRatio = (candle.v || 0) / Math.max(1, avgVol);
    const threshold = this.config.volumeExpansionThreshold ?? 1.25;

    const hasVolExpansion = volRatio >= threshold;
    const takerDelta = (candle.taker_buy_vol || 0) - (candle.taker_sell_vol || 0);
    const hasDeltaDominance = isBullish ? (takerDelta >= 0) : (takerDelta <= 0);

    return hasVolExpansion && hasDeltaDominance;
  }

  /**
   * Evaluates live incoming real-time price ticks.
   * Enforces single-position concurrency cap, single-use zone doctrine, in-zone confirmation, and cooldown.
   */
  public onPriceTick(tickPrice: number, tickTime: number = Date.now()): {
    activePositions: LivePosition[];
    activeZones: InstitutionalOrderBlock[];
  } {
    if (!tickPrice || tickPrice <= 0) {
      return {
        activePositions: Array.from(this.openPositions.values()),
        activeZones: this.activeZones
      };
    }

    const isCoolingDown = tickTime < this.cooldownUntilTimestamp;

    // ── 1. Evaluate Entry Triggers on Resting Zones ──
    if (
      this.config.autoExecute &&
      this.openPositions.size < this.config.maxOpenPositions &&
      !isCoolingDown
    ) {
      for (const zone of this.activeZones) {
        // Enforce Single-Use Doctrine: Skip consumed zones or active positions
        if (this.consumedZoneIds.has(zone.id) || this.openPositions.has(zone.id)) continue;

        const isBullish = zone.is_breaker ? (zone.type === 'BEARISH') : (zone.type === 'BULLISH');
        const entryPrice = this.config.entryMode === 'MEAN_THRESHOLD' ? zone.mean_threshold : (isBullish ? zone.top : zone.bottom);

        let isTouched = false;
        if (zone.lifecycle_status === 'ACTIVE_BREAKER' || zone.lifecycle_status === 'BREAKER_CONFIRMED_ACTIVE') {
          const isBearishBreaker = zone.type === 'BULLISH';
          if (isBearishBreaker && tickPrice >= (zone.breaker_entry_price || zone.mean_threshold)) {
            isTouched = true;
          } else if (!isBearishBreaker && tickPrice <= (zone.breaker_entry_price || zone.mean_threshold)) {
            isTouched = true;
          }
        } else {
          if (isBullish && tickPrice <= entryPrice && tickPrice >= zone.bottom) {
            isTouched = true;
          } else if (!isBullish && tickPrice >= entryPrice && tickPrice <= zone.top) {
            isTouched = true;
          }
        }

        if (isTouched) {
          if (this.config.requireInZoneConfirmation) {
            // Transition to Awaiting In-Zone Confirmation
            if (!this.inZoneTestingStates.has(zone.id)) {
              this.inZoneTestingStates.set(zone.id, {
                zoneId: zone.id,
                touchTime: tickTime,
                touchPrice: tickPrice,
                status: 'AWAITING_IN_ZONE_CONFIRMATION'
              });
              this.emitEvent(
                'CONFIRMATION_PENDING',
                undefined,
                `⏳ [IN-ZONE TEST] Price entered ${zone.quality_tier} ${zone.type} zone @ $${tickPrice}. Awaiting rejection candle & volume confirmation...`
              );
            }
          } else {
            // Direct immediate fill mode (if confirmation requirement disabled)
            this.openLivePosition(zone, tickPrice, tickTime);
            if (this.openPositions.size >= this.config.maxOpenPositions) break;
          }
        }
      }
    }

    // ── 2. Manage Active 3-Stage Positions & Ratchets ──
    for (const [posId, pos] of this.openPositions.entries()) {
      this.updatePositionTick(pos, tickPrice, tickTime);
      if (pos.status === 'CLOSED') {
        this.openPositions.delete(posId);
        this.closedPositions.push(pos);

        // Activate post-trade cooldown timer to kill rapid-fire machine-gun loops
        this.cooldownUntilTimestamp = tickTime + (this.config.cooldownMs ?? 60000);
        this.emitEvent(
          'COOLDOWN_ACTIVE',
          pos,
          `⏸️ [TRADE COOLDOWN] Mandatory ${(this.config.cooldownMs ?? 60000) / 1000}s cooldown active. Preventing machine-gun re-entries.`
        );
      }
    }

    return {
      activePositions: Array.from(this.openPositions.values()),
      activeZones: this.activeZones
    };
  }

  private openLivePosition(zone: InstitutionalOrderBlock, currentPrice: number, time: number) {
    // Strict Safety Guard: Do not exceed maxOpenPositions or open consumed zones
    if (this.openPositions.size >= this.config.maxOpenPositions) return;
    if (this.consumedZoneIds.has(zone.id)) return;

    // Mark zone as CONSUMED immediately (Single-Use Doctrine)
    this.consumedZoneIds.add(zone.id);
    zone.is_consumed = true;

    const isBullish = zone.is_breaker ? (zone.type === 'BEARISH') : (zone.type === 'BULLISH');
    const direction: 'LONG' | 'SHORT' = isBullish ? 'LONG' : 'SHORT';
    const trailingBuf = this.config.trailingBuffer ?? 0.05;
    const tp1Mult = this.config.tp1Multiple ?? 1.0;
    const tp2Mult = this.config.tp2Multiple ?? 1.5;
    const targetReward = this.config.targetRewardRatio ?? 2.5;

    const entryPrice = parseFloat(currentPrice.toFixed(4));
    const initialStopLoss = zone.is_breaker
      ? (zone.breaker_stop_loss || (isBullish ? zone.bottom - trailingBuf : zone.top + trailingBuf))
      : zone.simulated_stop_loss;

    const risk = Math.max(0.1, Math.abs(entryPrice - initialStopLoss));
    const tp1Price = isBullish
      ? parseFloat((entryPrice + tp1Mult * risk).toFixed(4))
      : parseFloat((entryPrice - tp1Mult * risk).toFixed(4));
    const tp2Price = isBullish
      ? parseFloat((entryPrice + tp2Mult * risk).toFixed(4))
      : parseFloat((entryPrice - tp2Mult * risk).toFixed(4));
    const tp3Price = isBullish
      ? parseFloat((entryPrice + targetReward * risk).toFixed(4))
      : parseFloat((entryPrice - targetReward * risk).toFixed(4));

    const newPos: LivePosition = {
      id: `POS_${zone.id}_${time}`,
      orderBlockId: zone.id,
      symbol: this.config.symbol || 'ETHUSDC',
      timeframe: this.config.timeframe || '15m',
      direction,
      status: 'OPEN',
      entryPrice,
      initialStopLoss,
      activeStopLoss: initialStopLoss,
      activeRatchetFloor: null,
      trailingSlSource: 'INITIAL',
      tp1Price,
      tp2Price,
      tp3Price,
      dynamicDolTarget: zone.breaker_dol_target || zone.dynamic_tp2_target || null,
      risk,
      allocatedAmount: 1.0,
      remainingAllocation: 1.0,
      realizedR: 0,
      unrealizedR: 0,
      isTp1Filled: false,
      isTp2Filled: false,
      isTp3Filled: false,
      tp1HitTime: null,
      tp2HitTime: null,
      tp3HitTime: null,
      openTime: time,
      closeTime: null,
      exitReason: null,
      orderBlock: zone,
    };

    this.openPositions.set(zone.id, newPos);
    this.emitEvent('ORDER_OPENED', newPos, `🚀 [LIVE EXECUTION] Opened ${direction} position on ${newPos.symbol} @ $${entryPrice} (Zone ${zone.id} marked CONSUMED)`);
  }

  private updatePositionTick(pos: LivePosition, currentPrice: number, time: number) {
    const isLong = pos.direction === 'LONG';
    const tp1Weight = this.config.tp1Ratio ?? 0.40;
    const tp2Weight = this.config.tp2Ratio ?? 0.40;
    const tp3Weight = this.config.tp3Ratio ?? 0.20;
    const tp1Mult = this.config.tp1Multiple ?? 1.0;
    const tp2Mult = this.config.tp2Multiple ?? 1.5;
    const trailingBuf = this.config.trailingBuffer ?? 0.05;

    // Calculate current open unrealized R on active position
    const currentPriceDeltaR = isLong
      ? (currentPrice - pos.entryPrice) / pos.risk
      : (pos.entryPrice - currentPrice) / pos.risk;
    pos.unrealizedR = parseFloat((currentPriceDeltaR * pos.remainingAllocation).toFixed(2));

    const hitSL = isLong ? (currentPrice <= pos.activeStopLoss) : (currentPrice >= pos.activeStopLoss);
    const hitTP1 = isLong ? (currentPrice >= pos.tp1Price) : (currentPrice <= pos.tp1Price);
    const hitTP2 = isLong ? (currentPrice >= pos.tp2Price) : (currentPrice <= pos.tp2Price);
    const hitTP3 = isLong ? (currentPrice >= pos.tp3Price) : (currentPrice <= pos.tp3Price);

    // ── STAGE 1 HARVEST: Scale 40% @ 1.0R + Trail SL to FVG CE ──
    if (hitTP1 && !pos.isTp1Filled) {
      pos.isTp1Filled = true;
      pos.tp1HitTime = time;
      pos.status = 'STAGE_1_FILLED';
      pos.remainingAllocation = parseFloat((pos.remainingAllocation - tp1Weight).toFixed(2));
      pos.realizedR = parseFloat((pos.realizedR + (tp1Weight * tp1Mult)).toFixed(2));

      if (this.config.trailingStopMode === 'STRUCTURAL_FVG_TRAIL') {
        let trailLevel = pos.entryPrice;
        let trailSource: 'FVG_CE' | 'SWING_PIVOT' | 'BREAKEVEN' = 'BREAKEVEN';

        if (pos.orderBlock.gates.fvg_found && typeof pos.orderBlock.gates.fvg_top === 'number' && typeof pos.orderBlock.gates.fvg_bottom === 'number') {
          const fvgCe = (pos.orderBlock.gates.fvg_top + pos.orderBlock.gates.fvg_bottom) / 2;
          trailLevel = isLong ? (fvgCe - trailingBuf) : (fvgCe + trailingBuf);
          trailSource = 'FVG_CE';
        } else {
          trailLevel = isLong ? (pos.entryPrice - 0.5 * pos.risk) : (pos.entryPrice + 0.5 * pos.risk);
          trailSource = 'SWING_PIVOT';
        }

        const guaranteedStop = isLong ? (pos.entryPrice - 0.5 * pos.risk) : (pos.entryPrice + 0.5 * pos.risk);
        pos.activeStopLoss = isLong ? Math.max(trailLevel, guaranteedStop) : Math.min(trailLevel, guaranteedStop);
        pos.trailingSlSource = trailSource;
      } else {
        pos.activeStopLoss = pos.entryPrice;
        pos.trailingSlSource = 'BREAKEVEN';
      }

      this.emitEvent('STAGE_1_HARVEST', pos, `🌾 [STAGE 1 HARVEST] Scaled 40% @ 1.0R (+$0.4R secured). SL trailed to ${pos.trailingSlSource} ($${pos.activeStopLoss})`);
      return;
    }

    // ── STAGE 2 HARVEST: Scale 40% @ 1.5R + Ratchet SL to +1.0R Floor ──
    if (hitTP2 && pos.isTp1Filled && !pos.isTp2Filled) {
      pos.isTp2Filled = true;
      pos.tp2HitTime = time;
      pos.status = 'STAGE_2_FILLED';
      pos.remainingAllocation = parseFloat((pos.remainingAllocation - tp2Weight).toFixed(2));
      pos.realizedR = parseFloat((pos.realizedR + (tp2Weight * tp2Mult)).toFixed(2));

      // Ratchet Stop Loss to guaranteed +1.0R structural profit floor
      const ratchetFloor = isLong
        ? parseFloat((pos.entryPrice + 1.0 * pos.risk).toFixed(4))
        : parseFloat((pos.entryPrice - 1.0 * pos.risk).toFixed(4));

      pos.activeStopLoss = ratchetFloor;
      pos.activeRatchetFloor = ratchetFloor;
      pos.trailingSlSource = 'PROFIT_RATCHET_FLOOR';

      this.emitEvent('STAGE_2_HARVEST', pos, `🔒 [STAGE 2 HARVEST] Scaled 40% @ 1.5R (+1.0R cumulative secured on 80%). SL ratcheted to +1.0R Profit Floor ($${ratchetFloor})`);
      return;
    }

    // ── STAGE 3 RUNNER: Scale 20% @ Macro DOL ──
    if (hitTP3 && pos.isTp2Filled) {
      pos.isTp3Filled = true;
      pos.tp3HitTime = time;
      pos.status = 'CLOSED';
      pos.closeTime = time;
      const runnerR = isLong ? (pos.tp3Price - pos.entryPrice) / pos.risk : (pos.entryPrice - pos.tp3Price) / pos.risk;
      pos.realizedR = parseFloat((pos.realizedR + (tp3Weight * runnerR)).toFixed(2));
      pos.remainingAllocation = 0;
      pos.exitReason = 'FULL_TP3_WIN';

      this.emitEvent('STAGE_3_RUNNER', pos, `🏆 [STAGE 3 DOL RUNNER] Macro target filled @ $${pos.tp3Price}! Full position completed (+${pos.realizedR}R Blended Return)`);
      return;
    }

    // ── STOP LOSS / TRAILING STOP EXITS ──
    if (hitSL) {
      pos.status = 'CLOSED';
      pos.closeTime = time;

      if (pos.isTp2Filled) {
        pos.realizedR = parseFloat((pos.realizedR + (pos.remainingAllocation * 1.0)).toFixed(2));
        pos.exitReason = 'STAGE_2_WIN';
        pos.remainingAllocation = 0;
        this.emitEvent('POSITION_CLOSED', pos, `✅ [STAGE 2 EXIT] Runner closed at +1.0R Ratchet Floor ($${pos.activeStopLoss}). Final Return: +${pos.realizedR}R`);
      } else if (pos.isTp1Filled) {
        const runnerR = isLong ? (pos.activeStopLoss - pos.entryPrice) / pos.risk : (pos.entryPrice - pos.activeStopLoss) / pos.risk;
        pos.realizedR = parseFloat((pos.realizedR + (pos.remainingAllocation * runnerR)).toFixed(2));
        pos.exitReason = 'STAGE_1_SCRATCH';
        pos.remainingAllocation = 0;
        this.emitEvent('POSITION_CLOSED', pos, `🛡️ [STAGE 1 SCRATCH] Position closed at Structural Trail ($${pos.activeStopLoss}). Final Return: +${pos.realizedR}R`);
      } else {
        pos.realizedR = -1.0;
        pos.exitReason = 'STOPPED_OUT';
        pos.remainingAllocation = 0;
        this.emitEvent('POSITION_CLOSED', pos, `🛑 [STOPPED OUT] Initial SL hit ($${pos.activeStopLoss}). Realized Loss: -1.0R`);
      }
    }
  }

  // ── Getters ──
  public getActivePositions(): LivePosition[] {
    return Array.from(this.openPositions.values());
  }

  public getActiveZones(): InstitutionalOrderBlock[] {
    return this.activeZones;
  }

  public getClosedPositions(): LivePosition[] {
    return this.closedPositions;
  }

  public getConfig(): LiveExecutionConfig {
    return this.config;
  }

  public getCooldownRemainingSec(): number {
    const diffMs = this.cooldownUntilTimestamp - Date.now();
    return Math.max(0, Math.ceil(diffMs / 1000));
  }

  public getInZoneTestingStates(): InZoneTestingState[] {
    return Array.from(this.inZoneTestingStates.values());
  }
}
