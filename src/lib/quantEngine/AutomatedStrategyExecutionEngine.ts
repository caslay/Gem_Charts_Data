/**
 * AutomatedStrategyExecutionEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Autonomous Strategy Execution & Position Management Engine with:
 *  - Dynamic 2% Compounding Risk Sizing ($1.0R = Equity * 0.02)
 *  - Resting Limit Order Routing (50% Mean Threshold / FVG CE / Reclaim Shelf)
 *  - 3-Stage Position Harvest Lifecycle (40% TP1 @ 1.0R, 40% TP2 @ 1.5R, 20% TP3 Runner)
 *  - Dynamic Trailing Stop & Profit-Locking Ratchet State Machine
 *  - Multi-Position Guardrails (Single-Position Cap, Directional Lock, Cooldown)
 *  - Full-Duplex Database Re-hydration & Event Bus Synchronization
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from '../fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimSetup,
  SweepReclaimScanConfig,
  SweepReclaimAnchorType
} from './SweepReclaimEngine';
import {
  SweepReclaimLiveSettings,
  DEFAULT_SR_LIVE_SETTINGS,
  SupportedOBTimeframe
} from './strategyExecutionConfig';

export type PositionStageStatus =
  | 'PENDING_LIMIT_ENTRY'
  | 'OPEN'
  | 'STAGE_1_FILLED'
  | 'STAGE_2_FILLED'
  | 'STAGE_3_RUNNER'
  | 'CLOSED';

export type TrailingStopSource =
  | 'INITIAL'
  | 'FVG_CE'
  | 'BREAKEVEN'
  | 'PROFIT_RATCHET_FLOOR'
  | 'SWING_PIVOT';

export type TradeExitReason =
  | 'STOPPED_OUT'
  | 'STAGE_1_SCRATCH'
  | 'STAGE_2_WIN'
  | 'FULL_TP3_WIN'
  | 'MANUAL_EXIT'
  | null;

export interface StrategyExecutionPosition {
  id: string;
  dbTradeId?: string | null;
  strategyId: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  status: PositionStageStatus;

  // Price & Risk Levels
  limitEntryPrice: number;
  entryPrice: number;
  initialStopLoss: number;
  activeStopLoss: number;
  activeRatchetFloor: number | null;
  trailingSlSource: TrailingStopSource;

  // 3-Stage Targets
  stage1Target: number;
  stage2Target: number;
  stage3Target: number;
  dynamicDolTarget: number | null;
  fvgCeLevel: number | null;

  // Multiples & Risk Parameters
  riskUsd: number;
  riskPerContract: number;
  equityAtEntry: number;
  riskPct: number;
  contractSize: number;
  allocatedAmount: number;     // e.g. 1.0 (100% position)
  remainingAllocation: number; // 1.0 -> 0.6 -> 0.2 -> 0.0

  // Realized and Floating Performance
  realizedR: number;
  realizedUsd: number;
  unrealizedR: number;
  unrealizedUsd: number;
  mfeR: number;
  maeR: number;

  // Tranche Fills Tracking
  isStage1Filled: boolean;
  isStage2Filled: boolean;
  isStage3Filled: boolean;
  stage1HitTime: number | null;
  stage2HitTime: number | null;
  stage3HitTime: number | null;

  // Lifecycle Timestamps
  pendingTime: number;
  openTime: number | null;
  closeTime: number | null;
  exitPrice: number | null;
  exitReason: TradeExitReason;

  // Metadata
  originAnchorLevel?: number;
  originZoneId?: string;
  isRehydrated?: boolean;
}

export interface AutomatedExecutionConfig {
  symbol: string;
  timeframe: string;
  autoExecute: boolean;
  compoundingRiskPct: number; // default: 2.0% ($1.0R = Equity * 0.02)
  maxOpenPositions: number;   // default: 1 (Strict Single-Position Cap)
  cooldownMs: number;         // default: 60000 (60s cooldown post close)
  minLotSize: number;         // default: 0.001 ETH
  maxLotSize: number;         // default: 100.0 ETH
  lotPrecision: number;       // default: 3 decimals (0.001 step)
  tickSize: number;           // default: 0.01 USD

  // 3-Stage Harvest R-Multiples
  stage1Multiple: number;     // default: 1.0R (40% tranche)
  stage2Multiple: number;     // default: 1.5R (40% tranche)
  stage3Multiple: number;     // default: 3.0R (20% DOL runner)

  // Position Allocations
  stage1Ratio: number;        // default: 0.40 (40%)
  stage2Ratio: number;        // default: 0.40 (40%)
  stage3Ratio: number;        // default: 0.20 (20%)

  // Trailing Stop Ratchet Toggles
  enableStructuralTrail: boolean; // Trail to FVG CE after Stage 1
  enableProfitRatchet: boolean;   // Ratchet SL to +1.0R floor after Stage 2
  slBufferAtrMultiplier: number;  // default: 0.15 ATR

  // Dynamic Live Settings
  liveSettings?: SweepReclaimLiveSettings;
}

export const DEFAULT_AUTOMATED_CONFIG: AutomatedExecutionConfig = {
  symbol: 'ETHUSDC',
  timeframe: '15m',
  autoExecute: true,
  compoundingRiskPct: 2.0,
  maxOpenPositions: 1,
  cooldownMs: 60000,
  minLotSize: 0.001,
  maxLotSize: 100.0,
  lotPrecision: 3,
  tickSize: 0.01,

  stage1Multiple: 1.0,
  stage2Multiple: 1.5,
  stage3Multiple: 3.0,

  stage1Ratio: 0.40,
  stage2Ratio: 0.40,
  stage3Ratio: 0.20,

  enableStructuralTrail: true,
  enableProfitRatchet: true,
  slBufferAtrMultiplier: 0.15,
  liveSettings: DEFAULT_SR_LIVE_SETTINGS,
};

export type ExecutionEventType =
  | 'LIMIT_ORDER_PLACED'
  | 'ORDER_FILLED'
  | 'STAGE_1_HARVEST'
  | 'STAGE_2_HARVEST'
  | 'STAGE_3_RUNNER'
  | 'POSITION_CLOSED'
  | 'COOLDOWN_ACTIVE'
  | 'DIRECTIONAL_VETO'
  | 'REHYDRATED'
  | 'ROLLBACK';

export interface ExecutionEvent {
  type: ExecutionEventType;
  position?: StrategyExecutionPosition;
  message: string;
  timestamp: number;
}

export type ExecutionEventListener = (event: ExecutionEvent) => void;

/**
 * Core Automated Strategy Execution & Risk Management Engine.
 */
export class AutomatedStrategyExecutionEngine {
  private config: AutomatedExecutionConfig;
  private activePositions: StrategyExecutionPosition[] = [];
  private pendingLimitOrders: StrategyExecutionPosition[] = [];
  private closedPositionsHistory: StrategyExecutionPosition[] = [];
  private listeners: ExecutionEventListener[] = [];

  // Concurrency & Safety Controls
  private lastTradeClosedTimestamp: number = 0;
  private consumedZoneIds: Set<string> = new Set();
  private currentAccountEquity: number = 10000.0;

  // Background Multi-Timeframe Scanning State
  private processedSetupIds: Set<string> = new Set();
  private latestScannedSetups: SweepReclaimSetup[] = [];

  constructor(config?: Partial<AutomatedExecutionConfig>) {
    this.config = { ...DEFAULT_AUTOMATED_CONFIG, ...config };
  }

  public updateConfig(newConfig: Partial<AutomatedExecutionConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): AutomatedExecutionConfig {
    return { ...this.config };
  }

  public setAccountEquity(equity: number): void {
    if (equity > 0 && !isNaN(equity)) {
      this.currentAccountEquity = equity;
    }
  }

  public getAccountEquity(): number {
    return this.currentAccountEquity;
  }

  public subscribe(listener: ExecutionEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(type: ExecutionEventType, message: string, position?: StrategyExecutionPosition): void {
    const event: ExecutionEvent = {
      type,
      position,
      message,
      timestamp: Date.now(),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[AutomatedStrategyExecutionEngine] Listener error:', err);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Dynamic 2% Compounding Risk Calculation Engine
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Computes dynamic compounding position sizing based on active portfolio equity:
   *  1.0R = Equity * (compoundingRiskPct / 100)
   *  Distance = |Entry - StopLoss|
   *  Contract Size = 1.0R / Distance
   *  Clamped to platform min/max lot and rounded down to lot precision.
   */
  public calculateCompoundedPositionSize(
    equity: number,
    entryPrice: number,
    stopLossPrice: number,
    overrideRiskPct?: number
  ): {
    riskUsd: number;
    distance: number;
    contractSize: number;
    riskPct: number;
    isValid: boolean;
    error?: string;
  } {
    const riskPct = overrideRiskPct ?? this.config.compoundingRiskPct;

    if (equity <= 0 || isNaN(equity)) {
      return {
        riskUsd: 0,
        distance: 0,
        contractSize: 0,
        riskPct,
        isValid: false,
        error: 'Invalid portfolio equity (must be > 0).',
      };
    }

    const distance = Math.abs(entryPrice - stopLossPrice);
    if (distance <= 0 || isNaN(distance)) {
      return {
        riskUsd: 0,
        distance: 0,
        contractSize: 0,
        riskPct,
        isValid: false,
        error: 'Invalid Stop Loss distance: Entry price equals Stop Loss (zero distance error).',
      };
    }

    const riskUsd = parseFloat((equity * (riskPct / 100)).toFixed(4));
    let rawContractSize = riskUsd / distance;

    // Lot size step rounding down
    const factor = Math.pow(10, this.config.lotPrecision);
    let contractSize = Math.floor(rawContractSize * factor) / factor;

    // Platform boundary clamping
    if (contractSize < this.config.minLotSize) {
      contractSize = this.config.minLotSize;
    }
    if (contractSize > this.config.maxLotSize) {
      contractSize = this.config.maxLotSize;
    }

    contractSize = parseFloat(contractSize.toFixed(this.config.lotPrecision));

    return {
      riskUsd,
      distance: parseFloat(distance.toFixed(4)),
      contractSize,
      riskPct,
      isValid: true,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Order Submission & Resting Limit Order Routing
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Submits a new strategy trade setup for automated execution.
   * If entry matches current price, fills immediately; otherwise places resting limit order.
   */
  public submitStrategyOrder(params: {
    strategyId: string;
    strategyName: string;
    symbol: string;
    timeframe: string;
    direction: 'LONG' | 'SHORT';
    limitEntryPrice: number;
    stopLossPrice: number;
    fvgCeLevel?: number | null;
    dynamicDolTarget?: number | null;
    originZoneId?: string;
    originAnchorLevel?: number;
    currentMarketPrice?: number;
    activeEquity?: number;
    overrideRiskPct?: number;
  }): {
    success: boolean;
    position?: StrategyExecutionPosition;
    message: string;
  } {
    const {
      strategyId,
      strategyName,
      symbol,
      timeframe,
      direction,
      limitEntryPrice,
      stopLossPrice,
      fvgCeLevel,
      dynamicDolTarget,
      originZoneId,
      originAnchorLevel,
      currentMarketPrice,
      activeEquity,
      overrideRiskPct,
    } = params;

    // ── Guardrail 1: Auto-Execute Flag ──
    if (!this.config.autoExecute) {
      return { success: false, message: 'Automated execution is currently disabled in configuration.' };
    }

    // ── Guardrail 2: Concurrency Cap (maxOpenPositions: 1) ──
    const totalActive = this.activePositions.length + this.pendingLimitOrders.length;
    if (totalActive >= this.config.maxOpenPositions) {
      return {
        success: false,
        message: `[CONCURRENCY_CAP] Maximum open positions (${this.config.maxOpenPositions}) already active.`,
      };
    }

    // ── Guardrail 3: Directional Conflict Veto (No opposing positions) ──
    const opposingActive = this.activePositions.find((p) => p.direction !== direction);
    const opposingPending = this.pendingLimitOrders.find((p) => p.direction !== direction);
    if (opposingActive || opposingPending) {
      const msg = `[DIRECTIONAL_LOCK] Cannot submit ${direction} order while an opposing ${
        opposingActive ? opposingActive.direction : opposingPending?.direction
      } position is active.`;
      this.emit('DIRECTIONAL_VETO', msg);
      return { success: false, message: msg };
    }

    // ── Guardrail 4: Mandatory Post-Trade Cooldown ──
    const now = Date.now();
    const timeSinceLastClose = now - this.lastTradeClosedTimestamp;
    if (this.lastTradeClosedTimestamp > 0 && timeSinceLastClose < this.config.cooldownMs) {
      const remainingSec = Math.ceil((this.config.cooldownMs - timeSinceLastClose) / 1000);
      const msg = `[COOLDOWN_ACTIVE] Post-trade cooldown in effect (${remainingSec}s remaining).`;
      this.emit('COOLDOWN_ACTIVE', msg);
      return { success: false, message: msg };
    }

    // ── Guardrail 5: Zone Single-Use Doctrine ──
    if (originZoneId && this.consumedZoneIds.has(originZoneId)) {
      return {
        success: false,
        message: `[ZONE_CONSUMED] Anchor zone ${originZoneId} was already executed and consumed.`,
      };
    }

    // ── Compute Dynamic 2% Compounding Risk & Contract Sizing ──
    const equity = activeEquity && activeEquity > 0 ? activeEquity : this.currentAccountEquity;
    const sizing = this.calculateCompoundedPositionSize(equity, limitEntryPrice, stopLossPrice, overrideRiskPct);

    if (!sizing.isValid) {
      return { success: false, message: sizing.error || 'Position sizing calculation failed.' };
    }

    // ── Derive 3-Stage Harvest Targets ──
    const isLong = direction === 'LONG';
    const riskDistance = sizing.distance;

    const stage1Target = isLong
      ? parseFloat((limitEntryPrice + riskDistance * this.config.stage1Multiple).toFixed(4))
      : parseFloat((limitEntryPrice - riskDistance * this.config.stage1Multiple).toFixed(4));

    const stage2Target = isLong
      ? parseFloat((limitEntryPrice + riskDistance * this.config.stage2Multiple).toFixed(4))
      : parseFloat((limitEntryPrice - riskDistance * this.config.stage2Multiple).toFixed(4));

    let stage3Target: number;
    if (dynamicDolTarget && ((isLong && dynamicDolTarget > stage2Target) || (!isLong && dynamicDolTarget < stage2Target))) {
      stage3Target = parseFloat(dynamicDolTarget.toFixed(4));
    } else {
      stage3Target = isLong
        ? parseFloat((limitEntryPrice + riskDistance * this.config.stage3Multiple).toFixed(4))
        : parseFloat((limitEntryPrice - riskDistance * this.config.stage3Multiple).toFixed(4));
    }

    const posId = `POS_${direction}_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const newPosition: StrategyExecutionPosition = {
      id: posId,
      dbTradeId: null,
      strategyId,
      strategyName,
      symbol,
      timeframe,
      direction,
      status: 'PENDING_LIMIT_ENTRY',

      limitEntryPrice,
      entryPrice: limitEntryPrice,
      initialStopLoss: stopLossPrice,
      activeStopLoss: stopLossPrice,
      activeRatchetFloor: null,
      trailingSlSource: 'INITIAL',

      stage1Target,
      stage2Target,
      stage3Target,
      dynamicDolTarget: dynamicDolTarget ?? null,
      fvgCeLevel: fvgCeLevel ?? null,

      riskUsd: sizing.riskUsd,
      riskPerContract: riskDistance,
      equityAtEntry: equity,
      riskPct: sizing.riskPct,
      contractSize: sizing.contractSize,
      allocatedAmount: 1.0,
      remainingAllocation: 1.0,

      realizedR: 0,
      realizedUsd: 0,
      unrealizedR: 0,
      unrealizedUsd: 0,
      mfeR: 0,
      maeR: 0,

      isStage1Filled: false,
      isStage2Filled: false,
      isStage3Filled: false,
      stage1HitTime: null,
      stage2HitTime: null,
      stage3HitTime: null,

      pendingTime: now,
      openTime: null,
      closeTime: null,
      exitPrice: null,
      exitReason: null,

      originAnchorLevel,
      originZoneId,
    };

    if (originZoneId) {
      this.consumedZoneIds.add(originZoneId);
    }

    // Check if limit entry can be filled immediately against current market price
    const currentPrice = currentMarketPrice ?? limitEntryPrice;
    const canFillNow = isLong ? currentPrice <= limitEntryPrice : currentPrice >= limitEntryPrice;

    if (canFillNow) {
      newPosition.status = 'OPEN';
      newPosition.entryPrice = currentPrice;
      newPosition.openTime = now;
      this.activePositions.push(newPosition);

      const msg = `🚀 [ORDER_FILLED] ${direction} position opened on ${symbol} (${timeframe}) @ $${currentPrice.toFixed(
        2
      )} | Size: ${newPosition.contractSize} contracts ($${newPosition.riskUsd.toFixed(2)} Risk, 2.0% Compounded).`;
      this.emit('ORDER_FILLED', msg, newPosition);
      return { success: true, position: newPosition, message: msg };
    } else {
      this.pendingLimitOrders.push(newPosition);
      const msg = `⏳ [LIMIT_ORDER_PLACED] Resting Limit ${direction} placed @ $${limitEntryPrice.toFixed(
        2
      )} on ${symbol} (${timeframe}) | Risk: $${newPosition.riskUsd.toFixed(2)} (2% Compounded).`;
      this.emit('LIMIT_ORDER_PLACED', msg, newPosition);
      return { success: true, position: newPosition, message: msg };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Real-Time Tick & Candle Evaluation Pipeline
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Processes incoming live ticks and candle updates.
   * Evaluates resting limit order fills, Take Profit harvest tranches, and trailing ratchets.
   */
  public processMarketTick(livePrice: number, currentCandle?: Candle | null): void {
    if (!livePrice || isNaN(livePrice) || livePrice <= 0) return;
    const now = Date.now();

    // ── Step A: Evaluate Pending Limit Orders for Touch Execution ──
    for (let i = this.pendingLimitOrders.length - 1; i >= 0; i--) {
      const order = this.pendingLimitOrders[i];
      const isLong = order.direction === 'LONG';
      const isTouched = isLong ? livePrice <= order.limitEntryPrice : livePrice >= order.limitEntryPrice;

      if (isTouched) {
        order.status = 'OPEN';
        order.entryPrice = order.limitEntryPrice;
        order.openTime = now;
        this.pendingLimitOrders.splice(i, 1);
        this.activePositions.push(order);

        const msg = `🚀 [ORDER_FILLED] Limit ${order.direction} triggered on ${order.symbol} @ $${order.entryPrice.toFixed(
          2
        )} | Size: ${order.contractSize} ($${order.riskUsd.toFixed(2)} Risk, 2% Compounded).`;
        this.emit('ORDER_FILLED', msg, order);
      }
    }

    // ── Step B: Evaluate Active Positions Lifecycle & 3-Stage Harvest ──
    for (let i = this.activePositions.length - 1; i >= 0; i--) {
      const pos = this.activePositions[i];
      const isLong = pos.direction === 'LONG';
      const riskPerContract = pos.riskPerContract;

      // Update current Floating R-multiple and MFE / MAE
      const currentDelta = isLong ? livePrice - pos.entryPrice : pos.entryPrice - livePrice;
      const floatingR = currentDelta / riskPerContract;
      pos.unrealizedR = parseFloat((floatingR * pos.remainingAllocation).toFixed(4));
      pos.unrealizedUsd = parseFloat((pos.unrealizedR * pos.riskUsd).toFixed(2));

      if (floatingR > pos.mfeR) {
        pos.mfeR = parseFloat(floatingR.toFixed(4));
      }
      if (floatingR < pos.maeR) {
        pos.maeR = parseFloat(floatingR.toFixed(4));
      }

      // ── B.1: Check Stop Loss Violation ──
      const isStopped = isLong ? livePrice <= pos.activeStopLoss : livePrice >= pos.activeStopLoss;
      if (isStopped) {
        this.closePosition(i, pos.activeStopLoss, 'STOPPED_OUT', now);
        continue;
      }

      // ── B.2: Tranche 1 Harvest (40% @ 1.0R Target) ──
      if (!pos.isStage1Filled) {
        const isStage1Hit = isLong ? livePrice >= pos.stage1Target : livePrice <= pos.stage1Target;
        if (isStage1Hit) {
          pos.isStage1Filled = true;
          pos.stage1HitTime = now;
          pos.status = 'STAGE_1_FILLED';

          // Lock 40% position at 1.0R (+0.40R realized)
          const trancheR = this.config.stage1Ratio * this.config.stage1Multiple;
          pos.realizedR = parseFloat((pos.realizedR + trancheR).toFixed(4));
          pos.realizedUsd = parseFloat((pos.realizedR * pos.riskUsd).toFixed(2));
          pos.remainingAllocation = parseFloat((pos.remainingAllocation - this.config.stage1Ratio).toFixed(2)); // 0.60 remaining

          // Advance SL to Displacement FVG 50% CE or Breakeven (capping runner risk so net P&L >= 0.0R)
          if (this.config.enableStructuralTrail && pos.fvgCeLevel) {
            pos.activeStopLoss = pos.fvgCeLevel;
            pos.trailingSlSource = 'FVG_CE';
          } else {
            pos.activeStopLoss = pos.entryPrice;
            pos.trailingSlSource = 'BREAKEVEN';
          }

          const msg = `🎯 [STAGE_1_HARVEST] Tranche 1 (40% @ ${pos.stage1Target.toFixed(2)}) filled on ${
            pos.symbol
          }! Locked +${trancheR.toFixed(2)}R ($${(trancheR * pos.riskUsd).toFixed(
            2
          )}). SL advanced to ${pos.trailingSlSource} ($${pos.activeStopLoss.toFixed(2)}).`;
          this.emit('STAGE_1_HARVEST', msg, pos);
        }
      }

      // ── B.3: Tranche 2 Harvest (40% @ 1.5R Target + +1.0R Ratchet Floor) ──
      if (pos.isStage1Filled && !pos.isStage2Filled) {
        const isStage2Hit = isLong ? livePrice >= pos.stage2Target : livePrice <= pos.stage2Target;
        if (isStage2Hit) {
          pos.isStage2Filled = true;
          pos.stage2HitTime = now;
          pos.status = 'STAGE_2_FILLED';

          // Lock 40% position at 1.5R (+0.60R realized, total +1.0R)
          const trancheR = this.config.stage2Ratio * this.config.stage2Multiple;
          pos.realizedR = parseFloat((pos.realizedR + trancheR).toFixed(4));
          pos.realizedUsd = parseFloat((pos.realizedR * pos.riskUsd).toFixed(2));
          pos.remainingAllocation = parseFloat((pos.remainingAllocation - this.config.stage2Ratio).toFixed(2)); // 0.20 remaining

          // Immediately Ratchet Active SL to Guaranteed +1.0R Structural Profit Floor
          if (this.config.enableProfitRatchet) {
            const oneRPrice = isLong
              ? parseFloat((pos.entryPrice + riskPerContract * 1.0).toFixed(4))
              : parseFloat((pos.entryPrice - riskPerContract * 1.0).toFixed(4));

            pos.activeStopLoss = oneRPrice;
            pos.activeRatchetFloor = oneRPrice;
            pos.trailingSlSource = 'PROFIT_RATCHET_FLOOR';
          }

          const msg = `💎 [STAGE_2_HARVEST] Tranche 2 (40% @ ${pos.stage2Target.toFixed(2)}) filled on ${
            pos.symbol
          }! Total Realized: +${pos.realizedR.toFixed(2)}R ($${pos.realizedUsd.toFixed(
            2
          )}). SL ratcheted to +1.0R Profit Floor ($${pos.activeStopLoss.toFixed(2)}).`;
          this.emit('STAGE_2_HARVEST', msg, pos);
        }
      }

      // ── B.4: Tranche 3 DOL Runner (20% @ Macro DOL) ──
      if (pos.isStage2Filled && !pos.isStage3Filled) {
        pos.status = 'STAGE_3_RUNNER';
        const isStage3Hit = isLong ? livePrice >= pos.stage3Target : livePrice <= pos.stage3Target;
        if (isStage3Hit) {
          pos.isStage3Filled = true;
          pos.stage3HitTime = now;

          // Lock 20% position at Stage 3 Multiple / DOL
          const trancheR = this.config.stage3Ratio * this.config.stage3Multiple;
          pos.realizedR = parseFloat((pos.realizedR + trancheR).toFixed(4));
          pos.realizedUsd = parseFloat((pos.realizedR * pos.riskUsd).toFixed(2));
          pos.remainingAllocation = 0.0;

          this.closePosition(i, pos.stage3Target, 'FULL_TP3_WIN', now);
          continue;
        }
      }
    }
  }

  /**
   * Internal helper to close an active position and trigger post-trade cooldown.
   */
  private closePosition(index: number, exitPrice: number, reason: TradeExitReason, timestamp: number): void {
    const pos = this.activePositions[index];
    if (!pos) return;

    pos.status = 'CLOSED';
    pos.closeTime = timestamp;
    pos.exitPrice = parseFloat(exitPrice.toFixed(4));
    pos.exitReason = reason;

    // Calculate final realized R and USD if not already fully realized via targets
    if (reason === 'STOPPED_OUT') {
      if (!pos.isStage1Filled && !pos.isStage2Filled) {
        // Full stop out at initial SL (-1.0R)
        pos.realizedR = -1.0;
        pos.realizedUsd = -pos.riskUsd;
      } else if (pos.isStage1Filled && !pos.isStage2Filled) {
        // Stopped out after Stage 1 (Break-even / scratch)
        // 40% locked at +1.0R (+0.40R). Remaining 60% stopped out at FVG CE / BE.
        pos.exitReason = 'STAGE_1_SCRATCH';
      } else if (pos.isStage2Filled) {
        // Stopped out after Stage 2 (+1.0R ratchet floor exit)
        // 40% @ 1.0R (+0.40R) + 40% @ 1.5R (+0.60R) + 20% @ +1.0R floor (+0.20R) = +1.20R net!
        const runnerFloorR = this.config.stage3Ratio * 1.0;
        pos.realizedR = parseFloat((pos.realizedR + runnerFloorR).toFixed(4));
        pos.realizedUsd = parseFloat((pos.realizedR * pos.riskUsd).toFixed(2));
        pos.exitReason = 'STAGE_2_WIN';
      }
    }

    pos.unrealizedR = 0;
    pos.unrealizedUsd = 0;
    pos.remainingAllocation = 0;

    this.activePositions.splice(index, 1);
    this.closedPositionsHistory.unshift(pos);
    this.lastTradeClosedTimestamp = timestamp;

    const emoji = pos.realizedR > 0 ? '🏆' : pos.realizedR === 0 ? '🛡️' : '🛑';
    const msg = `${emoji} [POSITION_CLOSED] ${pos.direction} on ${pos.symbol} closed @ $${exitPrice.toFixed(2)} (${
      pos.exitReason
    }). Final P&L: ${pos.realizedR > 0 ? '+' : ''}${pos.realizedR.toFixed(2)}R ($${pos.realizedUsd > 0 ? '+' : ''}$${pos.realizedUsd.toFixed(
      2
    )}). Cooldown activated.`;

    this.emit('POSITION_CLOSED', msg, pos);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Database Rehydration & Synchronization
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Links a persistent database trade ID (UUID) from /api/trades to an active position.
   */
  public linkDbTradeId(posId: string, dbTradeId: string): void {
    const pos = this.activePositions.find((p) => p.id === posId) || this.pendingLimitOrders.find((p) => p.id === posId);
    if (pos) {
      pos.dbTradeId = dbTradeId;
    }
  }

  /**
   * Performs an atomic in-memory rollback if database order placement or network fails.
   */
  public rollbackPosition(posId: string, errorReason?: string): boolean {
    const activeIdx = this.activePositions.findIndex((p) => p.id === posId || p.dbTradeId === posId);
    if (activeIdx !== -1) {
      const pos = this.activePositions[activeIdx];
      this.activePositions.splice(activeIdx, 1);
      if (pos.originZoneId) {
        this.consumedZoneIds.delete(pos.originZoneId);
      }
      this.emit('ROLLBACK', `⚠️ [ORDER ROLLBACK] Position ${posId} purged from memory due to persistence failure: ${errorReason || 'Unknown error'}`, pos);
      return true;
    }

    const pendingIdx = this.pendingLimitOrders.findIndex((p) => p.id === posId || p.dbTradeId === posId);
    if (pendingIdx !== -1) {
      const pos = this.pendingLimitOrders[pendingIdx];
      this.pendingLimitOrders.splice(pendingIdx, 1);
      if (pos.originZoneId) {
        this.consumedZoneIds.delete(pos.originZoneId);
      }
      this.emit('ROLLBACK', `⚠️ [ORDER ROLLBACK] Pending limit order ${posId} purged from memory: ${errorReason || 'Unknown error'}`, pos);
      return true;
    }

    return false;
  }

  /**
   * Rehydrates open positions from persistent PostgreSQL / in-memory trade records on mount.
   * Strictly isolates trades to Sweep & Reclaim namespace signatures.
   */
  public rehydrateOpenPositions(dbTrades: any[]): StrategyExecutionPosition[] {
    const rehydrated: StrategyExecutionPosition[] = [];

    for (const trade of dbTrades) {
      if (trade.status !== 'OPEN' && trade.status !== 'STAGE_1_FILLED' && trade.status !== 'STAGE_2_FILLED') {
        continue;
      }

      // Namespace Isolation: Only adopt trades belonging to Sweep & Reclaim
      const stratName = (trade.strategy_name || '').toLowerCase();
      const isSrStrategy =
        stratName.includes('sweep & reclaim') ||
        stratName.includes('s&r') ||
        stratName.includes('3-pillar') ||
        stratName.includes('failed signal reversal') ||
        stratName.includes('auto 2% compounded');

      if (!isSrStrategy) {
        continue; // Strictly ignore Order Block or other strategy trades
      }

      // Check if already active
      if (this.activePositions.some((p) => p.dbTradeId === trade.id || p.id === trade.id)) {
        continue;
      }

      const direction = trade.direction as 'LONG' | 'SHORT';
      const entryPrice = parseFloat(trade.entry_price);
      const stopLoss = parseFloat(trade.stop_loss);
      const ipda = trade.ipda_metrics || {};

      const riskUsd = parseFloat(trade.risk_amount_usd || 200.0);
      const distance = Math.abs(entryPrice - stopLoss);
      const contractSize = parseFloat(trade.position_size || (riskUsd / (distance || 1)).toFixed(3));

      const stage1Target = ipda.stage1_target ?? (direction === 'LONG' ? entryPrice + distance * 1.0 : entryPrice - distance * 1.0);
      const stage2Target = ipda.stage2_target ?? (direction === 'LONG' ? entryPrice + distance * 1.5 : entryPrice - distance * 1.5);
      const stage3Target = ipda.stage3_target ?? (direction === 'LONG' ? entryPrice + distance * 3.0 : entryPrice - distance * 3.0);

      const isStage1Filled = trade.status === 'STAGE_1_FILLED' || trade.status === 'STAGE_2_FILLED';
      const isStage2Filled = trade.status === 'STAGE_2_FILLED';

      const pos: StrategyExecutionPosition = {
        id: `REHYDRATED_${trade.id.slice(0, 8)}`,
        dbTradeId: trade.id,
        strategyId: trade.strategy_name || 'Automated Strategy',
        strategyName: trade.strategy_name || 'Automated Strategy',
        symbol: trade.symbol || 'ETHUSDC',
        timeframe: ipda.timeframe || '15m',
        direction,
        status: trade.status as PositionStageStatus,

        limitEntryPrice: entryPrice,
        entryPrice,
        initialStopLoss: stopLoss,
        activeStopLoss: stopLoss,
        activeRatchetFloor: isStage2Filled ? (direction === 'LONG' ? entryPrice + distance : entryPrice - distance) : null,
        trailingSlSource: isStage2Filled ? 'PROFIT_RATCHET_FLOOR' : isStage1Filled ? 'BREAKEVEN' : 'INITIAL',

        stage1Target: parseFloat(stage1Target.toFixed(4)),
        stage2Target: parseFloat(stage2Target.toFixed(4)),
        stage3Target: parseFloat(stage3Target.toFixed(4)),
        dynamicDolTarget: ipda.dol_target ?? null,
        fvgCeLevel: ipda.fvg_ce ?? null,

        riskUsd,
        riskPerContract: distance,
        equityAtEntry: 10000.0,
        riskPct: 2.0,
        contractSize,
        allocatedAmount: 1.0,
        remainingAllocation: isStage2Filled ? 0.20 : isStage1Filled ? 0.60 : 1.0,

        realizedR: isStage2Filled ? 1.0 : isStage1Filled ? 0.40 : 0.0,
        realizedUsd: isStage2Filled ? riskUsd * 1.0 : isStage1Filled ? riskUsd * 0.40 : 0.0,
        unrealizedR: 0,
        unrealizedUsd: 0,
        mfeR: 0,
        maeR: 0,

        isStage1Filled,
        isStage2Filled,
        isStage3Filled: false,
        stage1HitTime: isStage1Filled ? Date.now() : null,
        stage2HitTime: isStage2Filled ? Date.now() : null,
        stage3HitTime: null,

        pendingTime: new Date(trade.opened_at || trade.created_at || Date.now()).getTime(),
        openTime: new Date(trade.opened_at || trade.created_at || Date.now()).getTime(),
        closeTime: null,
        exitPrice: null,
        exitReason: null,

        isRehydrated: true,
      };

      this.activePositions.push(pos);
      rehydrated.push(pos);
    }

    if (rehydrated.length > 0) {
      this.emit('REHYDRATED', `🔄 Re-hydrated ${rehydrated.length} active position(s) from database.`);
    }

    return rehydrated;
  }

  // ── Manual Emergency Controls ──
  public emergencyClosePosition(posId: string, currentMarketPrice: number): boolean {
    const idx = this.activePositions.findIndex((p) => p.id === posId || p.dbTradeId === posId);
    if (idx !== -1) {
      this.closePosition(idx, currentMarketPrice, 'MANUAL_EXIT', Date.now());
      return true;
    }
    return false;
  }

  public moveStopToBreakeven(posId: string): boolean {
    const pos = this.activePositions.find((p) => p.id === posId || p.dbTradeId === posId);
    if (pos && pos.status !== 'CLOSED') {
      pos.activeStopLoss = pos.entryPrice;
      pos.trailingSlSource = 'BREAKEVEN';
      this.emit('STAGE_1_HARVEST', `🛡️ [MANUAL_BE] Stop loss moved to Break-even ($${pos.entryPrice.toFixed(2)}).`, pos);
      return true;
    }
    return false;
  }

  public getActivePositions(): StrategyExecutionPosition[] {
    return [...this.activePositions];
  }

  public getPendingLimitOrders(): StrategyExecutionPosition[] {
    return [...this.pendingLimitOrders];
  }

  public getClosedPositions(): StrategyExecutionPosition[] {
    return [...this.closedPositionsHistory];
  }

  public getScannedSetups(): SweepReclaimSetup[] {
    return [...this.latestScannedSetups];
  }

  public getLiveSettings(): SweepReclaimLiveSettings {
    return this.config.liveSettings || DEFAULT_SR_LIVE_SETTINGS;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Autonomous Multi-Timeframe Background Ingestion & Scan Loop
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Ingests closed multi-timeframe candle streams (5m, 15m, 1h) concurrently.
   * Runs SweepReclaimEngine detection across enabled timeframes and auto-routes confirmed setups.
   */
  public onMultiTimeframeCandles(
    multiTfCandles: { '5m'?: Candle[]; '15m'?: Candle[]; '1h'?: Candle[] },
    macroContext?: {
      macroDailyBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
      dolDirection?: 'BULLISH' | 'BEARISH' | 'BALANCED';
      localDealingRange?: any;
    }
  ): {
    scannedSetups: SweepReclaimSetup[];
    executedSetups: SweepReclaimSetup[];
  } {
    const settings = this.config.liveSettings || DEFAULT_SR_LIVE_SETTINGS;
    const enabledTfs = settings.enabledTimeframes && settings.enabledTimeframes.length > 0
      ? settings.enabledTimeframes
      : ['5m', '15m', '1h'];

    const scanned: SweepReclaimSetup[] = [];
    const executed: SweepReclaimSetup[] = [];

    // Map UI anchor categories to underlying SweepReclaimAnchorType array
    const mappedAnchorTypes: SweepReclaimAnchorType[] = [];
    const activeAnchors = settings.anchorTypes || ['SWING_PIVOT', 'ASIAN', 'LONDON', 'DAILY'];
    if (activeAnchors.includes('SWING_PIVOT')) mappedAnchorTypes.push('SWING_PIVOT');
    if (activeAnchors.includes('ASIAN')) {
      mappedAnchorTypes.push('ASIAN_HIGH');
      mappedAnchorTypes.push('ASIAN_LOW');
    }
    if (activeAnchors.includes('LONDON')) {
      mappedAnchorTypes.push('LONDON_HIGH');
      mappedAnchorTypes.push('LONDON_LOW');
    }
    if (activeAnchors.includes('DAILY')) {
      mappedAnchorTypes.push('PDH');
      mappedAnchorTypes.push('PDL');
    }

    for (const tf of enabledTfs) {
      const candles = multiTfCandles[tf as keyof typeof multiTfCandles];
      if (!candles || candles.length < 25) continue;

      const latestCandle = candles[candles.length - 1];
      const latestPrice = latestCandle.c ?? (latestCandle as any).close;

      const scanConfig: SweepReclaimScanConfig = {
        symbol: this.config.symbol,
        timeframe: tf,
        anchorTypes: mappedAnchorTypes.length > 0 ? mappedAnchorTypes : undefined,
        minSweepDepthAtrMultiplier: 0.10,
        maxBarsAnchorToSweep: 40,
        maxBarsSweepToReclaim: 16,
        maxBarsToRetest: 30,
        slBufferAtrMultiplier: this.config.slBufferAtrMultiplier ?? 0.15,
        entryMode: settings.entryMode ?? 'FVG_CE',
        stage1Multiple: settings.stage2Multiple ? settings.stage2Multiple * 0.67 : this.config.stage1Multiple ?? 1.0,
        stage2Multiple: settings.stage2Multiple ?? this.config.stage2Multiple ?? 1.5,
        stage3Multiple: settings.stage3Multiple ?? this.config.stage3Multiple ?? 3.0,
        enableStructuralTrail: settings.enableStructuralTrail ?? this.config.enableStructuralTrail,
        enableProfitRatchet: settings.enableProfitRatchet ?? this.config.enableProfitRatchet,
        volumeExpansionThreshold: settings.volumeExpansionThreshold ?? 1.50,
        deltaDominanceThreshold: settings.deltaDominanceThreshold ?? 60.0,
        bodyRatioThreshold: settings.bodyRatioThreshold ?? 0.60,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: settings.enforceDiscountPremiumGate ?? true,
      };

      try {
        const engine = new SweepReclaimEngine(scanConfig);
        const scanResult = engine.scanHistoricalSetups(candles);
        const setups = scanResult.setups || [];

        for (const s of setups) {
          scanned.push(s);

          // ── STRICT FRESHNESS & REAL-TIME RECENTNESS GUARD ──
          // A setup is ONLY eligible for live execution if:
          // 1. It is currently waiting for retest (RECLAIMED_NO_RETEST) and the reclaim occurred on a recent bar (within last 6 bars)
          // 2. OR it was retested on the very latest closed bar (retest_index >= candles.length - 2)
          // All older historical setups are marked processed and ignored for live execution.
          const isFreshReclaim =
            s.status === 'RECLAIMED_NO_RETEST' &&
            s.reclaim_index !== null &&
            s.reclaim_index >= candles.length - 6;

          const isLatestRetest =
            s.status === 'RETESTED' &&
            s.retest_index !== null &&
            s.retest_index >= candles.length - 2;

          if (!isFreshReclaim && !isLatestRetest) {
            // Stale historical setup: mark as processed to prevent back-execution
            this.processedSetupIds.add(s.id);
            continue;
          }

          // Check if setup is confirmed for live entry (3-Pillars passed and Valuation aligned)
          const isConfirmed =
            s.three_pillar_displacement_passed &&
            (!settings.enforceDiscountPremiumGate || s.is_valuation_aligned);

          if (isConfirmed && this.config.autoExecute && !this.processedSetupIds.has(s.id)) {
            // Determine limit entry price based on entryMode
            let entryPrice = s.entry_price;
            if (!entryPrice || isNaN(entryPrice)) {
              if (settings.entryMode === 'FVG_CE' && s.reclaim_fvg_ce) {
                entryPrice = s.reclaim_fvg_ce;
              } else if (settings.entryMode === 'SWEEP_OB_MT' && s.sweep_ob_mt) {
                entryPrice = s.sweep_ob_mt;
              } else {
                entryPrice = s.anchor_level;
              }
            }

            // Price Sanity Guard: Ensure entry level is within 5% of current market price
            const priceDistancePct = Math.abs(entryPrice - latestPrice) / latestPrice;
            if (priceDistancePct > 0.05) {
              this.processedSetupIds.add(s.id);
              continue;
            }

            const direction = s.type === 'BULLISH' ? 'LONG' : 'SHORT';
            const strategyName = `Sweep & Reclaim (${tf.toUpperCase()} ${s.anchor_name || s.anchor_type})`;

            const submitRes = this.submitStrategyOrder({
              strategyId: s.id,
              strategyName,
              symbol: this.config.symbol,
              timeframe: tf,
              direction,
              limitEntryPrice: parseFloat(entryPrice.toFixed(4)),
              stopLossPrice: parseFloat(s.stop_loss.toFixed(4)),
              currentMarketPrice: latestPrice,
              fvgCeLevel: s.reclaim_fvg_ce,
              dynamicDolTarget: s.stage3_target,
              originZoneId: s.id,
              originAnchorLevel: s.anchor_level,
              overrideRiskPct: settings.compoundingRiskPct,
            });

            if (submitRes.success) {
              this.processedSetupIds.add(s.id);
              executed.push(s);
            }
          }
        }
      } catch (err) {
        console.warn(`[AutomatedStrategyExecutionEngine] Error scanning ${tf} candles for S&R:`, err);
      }
    }

    this.latestScannedSetups = scanned;
    return { scannedSetups: scanned, executedSetups: executed };
  }
}
