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

import { Candle } from "../fvgEngine";
import {
  SweepReclaimEngine,
  SweepReclaimSetup,
  SweepReclaimScanConfig,
  SweepReclaimAnchorType,
  resolveRetestEntryPrice,
  DisplacementCandleAudit,
} from "./SweepReclaimEngine";
import {
  SweepReclaimLiveSettings,
  DEFAULT_SR_LIVE_SETTINGS,
  SupportedOBTimeframe,
} from "./strategyExecutionConfig";

export type PositionStageStatus =
  | "PENDING_LIMIT_ENTRY"
  | "OPEN"
  | "STAGE_1_FILLED"
  | "STAGE_2_FILLED"
  | "STAGE_3_RUNNER"
  | "CLOSED";

export type TrailingStopSource =
  "INITIAL" | "FVG_CE" | "BREAKEVEN" | "PROFIT_RATCHET_FLOOR" | "SWING_PIVOT";

export type TradeExitReason =
  | "STOPPED_OUT"
  | "STAGE_1_SCRATCH"
  | "STAGE_2_WIN"
  | "FULL_TP2_WIN"
  | "STAGE_2_PROFIT_PROTECTION"
  | "FULL_TP3_WIN"
  | "MANUAL_CLOSE"
  | "MANUAL_EXIT"
  | "INVALIDATED_EXPANDED"
  | "INVALIDATED_OPPOSING_SWEEP"
  | "INVALIDATED_TIMEOUT"
  | null;

export interface StrategyExecutionPosition {
  id: string;
  dbTradeId?: string | null;
  strategyId: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  direction: "LONG" | "SHORT";
  status: PositionStageStatus;

  // Price & Risk Levels
  limitEntryPrice: number;
  entryPrice: number;
  initialStopLoss: number;
  activeStopLoss: number;
  activeRatchetFloor: number | null;
  trailingSlSource: TrailingStopSource;

  // Multi-Stage Targets & Ratios
  stage1Target: number;
  stage2Target: number;
  stage3Target: number;
  dynamicDolTarget: number | null;
  fvgCeLevel: number | null;
  stage1Ratio?: number;
  stage2Ratio?: number;
  stage3Ratio?: number;
  stage1Multiple?: number;
  stage2Multiple?: number;
  stage3Multiple?: number;

  // Multiples & Risk Parameters
  riskUsd: number;
  riskPerContract: number;
  equityAtEntry: number;
  riskPct: number;
  contractSize: number;
  allocatedAmount: number; // e.g. 1.0 (100% position)
  remainingAllocation: number; // 1.0 -> 0.5 -> 0.0

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

  // Setup Audit & Origin Metadata
  setupId?: string;
  anchorName?: string;
  originAnchorLevel?: number;
  originZoneId?: string;
  sweepPrice?: number | null;
  reclaimPrice?: number | null;
  volExpansion?: number;
  deltaDominance?: number;
  bodyRatio?: number;
  threePillarsPassed?: boolean;
  displacementCandles?: DisplacementCandleAudit[];
  isRehydrated?: boolean;
}

export interface AutomatedExecutionConfig {
  symbol: string;
  timeframe: string;
  autoExecute: boolean;
  compoundingRiskPct: number; // default: 2.0% ($1.0R = Equity * 0.02)
  maxOpenPositions: number; // default: 1 (Strict Single-Position Cap)
  cooldownMs: number; // default: 60000 (60s cooldown post close)
  minLotSize: number; // default: 0.001 ETH
  maxLotSize: number; // default: 100.0 ETH
  lotPrecision: number; // default: 3 decimals (0.001 step)
  tickSize: number; // default: 0.01 USD

  // 3-Stage Harvest R-Multiples
  stage1Multiple: number; // default: 1.0R (40% tranche)
  stage2Multiple: number; // default: 1.5R (40% tranche)
  stage3Multiple: number; // default: 3.0R (20% DOL runner)

  // Position Allocations
  stage1Ratio: number; // default: 0.40 (40%)
  stage2Ratio: number; // default: 0.40 (40%)
  stage3Ratio: number; // default: 0.20 (20%)

  // Trailing Stop Ratchet Toggles
  enableStructuralTrail: boolean; // Trail to FVG CE after Stage 1
  enableProfitRatchet: boolean; // Ratchet SL to +1.0R floor after Stage 2
  slBufferAtrMultiplier: number; // default: 0.15 ATR

  // Dynamic Live Settings
  liveSettings?: SweepReclaimLiveSettings;
}

export const DEFAULT_AUTOMATED_CONFIG: AutomatedExecutionConfig = {
  symbol: "ETHUSDC",
  timeframe: "5m",
  autoExecute: true,
  compoundingRiskPct: 2.0,
  maxOpenPositions: 1,
  cooldownMs: 60000,
  minLotSize: 0.001,
  maxLotSize: 100.0,
  lotPrecision: 3,
  tickSize: 0.01,

  stage1Multiple: 1.0,
  stage2Multiple: 1.4,
  stage3Multiple: 3.0,

  stage1Ratio: 0.5,
  stage2Ratio: 0.5,
  stage3Ratio: 0.0,

  enableStructuralTrail: true,
  enableProfitRatchet: true,
  slBufferAtrMultiplier: 0.10,
  liveSettings: DEFAULT_SR_LIVE_SETTINGS,
};

export type ExecutionEventType =
  | "LIMIT_ORDER_PLACED"
  | "ORDER_FILLED"
  | "STAGE_1_HARVEST"
  | "STAGE_2_HARVEST"
  | "STAGE_3_RUNNER"
  | "POSITION_CLOSED"
  | "COOLDOWN_ACTIVE"
  | "DIRECTIONAL_VETO"
  | "REHYDRATED"
  | "RECONCILED"
  | "ROLLBACK";

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

  private emit(
    type: ExecutionEventType,
    message: string,
    position?: StrategyExecutionPosition,
  ): void {
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
        console.error(
          "[AutomatedStrategyExecutionEngine] Listener error:",
          err,
        );
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
    overrideRiskPct?: number,
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
        error: "Invalid portfolio equity (must be > 0).",
      };
    }

    const calculatedRawDistance = Math.abs(entryPrice - stopLossPrice);
    if (calculatedRawDistance <= 0 || isNaN(calculatedRawDistance)) {
      return {
        riskUsd: 0,
        distance: 0,
        contractSize: 0,
        riskPct,
        isValid: false,
        error:
          "Invalid Stop Loss distance: Entry price equals Stop Loss (zero distance error).",
      };
    }

    // Anti-Micro-Friction Clamp: 0.15% minimum stop loss distance floor
    const minStopLossDistance = Math.max(
      calculatedRawDistance,
      entryPrice * 0.0015,
    );
    const distance = minStopLossDistance;

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
  // 3. Execution Pipeline (Single-Position Cap & Sizing Validation)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Evaluates entry parameters, validates portfolio risk constraints, and queues
   * or executes a single limit order for the Sweep & Reclaim engine.
   */
  public submitStrategyOrder(params: {
    strategyId: string;
    strategyName: string;
    symbol: string;
    timeframe: string;
    direction: "LONG" | "SHORT";
    limitEntryPrice: number;
    stopLossPrice: number;
    fvgCeLevel?: number | null;
    dynamicDolTarget?: number | null;
    setupId?: string;
    anchorName?: string;
    originZoneId?: string;
    originAnchorLevel?: number;
    sweepPrice?: number | null;
    reclaimPrice?: number | null;
    volExpansion?: number;
    deltaDominance?: number;
    bodyRatio?: number;
    threePillarsPassed?: boolean;
    displacementCandles?: DisplacementCandleAudit[];
    currentMarketPrice?: number;
    activeEquity?: number;
    overrideRiskPct?: number;
  }): {
    success: boolean;
    message: string;
    position?: StrategyExecutionPosition;
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
      setupId,
      anchorName,
      originZoneId,
      originAnchorLevel,
      sweepPrice,
      reclaimPrice,
      volExpansion,
      deltaDominance,
      bodyRatio,
      threePillarsPassed,
      displacementCandles,
      currentMarketPrice,
      activeEquity,
      overrideRiskPct,
    } = params;

    // ── Guardrail 1: Auto-Execute Flag ──
    if (!this.config.autoExecute) {
      return {
        success: false,
        message: "Automated execution is currently disabled in configuration.",
      };
    }

    // ── Guardrail 2: Concurrency Cap (maxOpenPositions: 1 on ACTIVE positions) ──
    if (this.activePositions.length >= this.config.maxOpenPositions) {
      return {
        success: false,
        message: `[CONCURRENCY_CAP] Maximum active positions (${this.config.maxOpenPositions}) already open.`,
      };
    }

    // ── Guardrail 3: Directional Conflict Veto (No opposing positions) ──
    const opposingActive = this.activePositions.find(
      (p) => p.direction !== direction,
    );
    const opposingPending = this.pendingLimitOrders.find(
      (p) => p.direction !== direction,
    );
    if (opposingActive || opposingPending) {
      const msg = `[DIRECTIONAL_LOCK] Cannot submit ${direction} order while an opposing ${
        opposingActive ? opposingActive.direction : opposingPending?.direction
      } position is active.`;
      this.emit("DIRECTIONAL_VETO", msg);
      return { success: false, message: msg };
    }

    // ── Guardrail 4: Mandatory Post-Trade Cooldown ──
    const now = Date.now();
    const timeSinceLastClose = now - this.lastTradeClosedTimestamp;
    if (
      this.lastTradeClosedTimestamp > 0 &&
      timeSinceLastClose < this.config.cooldownMs
    ) {
      const remainingSec = Math.ceil(
        (this.config.cooldownMs - timeSinceLastClose) / 1000,
      );
      const msg = `[COOLDOWN_ACTIVE] Post-trade cooldown in effect (${remainingSec}s remaining).`;
      this.emit("COOLDOWN_ACTIVE", msg);
      return { success: false, message: msg };
    }

    // ── Guardrail 5: One-Active-Position-Per-Structural-Wave Concurrency Lock ──
    const targetAnchorLevel =
      originAnchorLevel !== undefined ? originAnchorLevel : limitEntryPrice;
    const hasActiveForZone =
      this.activePositions.some((p) => {
        if (originZoneId && p.originZoneId === originZoneId) return true;
        if (
          p.originAnchorLevel !== undefined &&
          Math.abs(p.originAnchorLevel - targetAnchorLevel) < 0.5
        )
          return true;
        return false;
      }) ||
      this.pendingLimitOrders.some((p) => {
        if (originZoneId && p.originZoneId === originZoneId) return true;
        if (
          p.originAnchorLevel !== undefined &&
          Math.abs(p.originAnchorLevel - targetAnchorLevel) < 0.5
        )
          return true;
        return false;
      });

    if (hasActiveForZone) {
      const msg = `[EXECUTION_LOCK] Vetoed duplicate entry for active zone: ${targetAnchorLevel}`;
      console.warn(msg);
      return { success: false, message: msg };
    }

    // ── Guardrail 6: Zone Single-Use Doctrine ──
    if (originZoneId && this.consumedZoneIds.has(originZoneId)) {
      return {
        success: false,
        message: `[ZONE_CONSUMED] Anchor zone ${originZoneId} was already executed and consumed.`,
      };
    }

    // ── Guardrail 7: Resting Side Market Price Gate ──
    const isLong = direction === "LONG";
    if (currentMarketPrice !== undefined && currentMarketPrice > 0) {
      if (isLong && currentMarketPrice <= limitEntryPrice) {
        return {
          success: false,
          message: `[RESTING_SIDE_VETO] Cannot place LONG limit order @ $${limitEntryPrice} when market price is already @ $${currentMarketPrice}.`,
        };
      }
      if (!isLong && currentMarketPrice >= limitEntryPrice) {
        return {
          success: false,
          message: `[RESTING_SIDE_VETO] Cannot place SHORT limit order @ $${limitEntryPrice} when market price is already @ $${currentMarketPrice}.`,
        };
      }
    }

    // ── Anti-Micro-Friction Stop Loss Clamp (0.15% Minimum Price Buffer) ──
    const calculatedRawDistance = Math.abs(limitEntryPrice - stopLossPrice);
    const minStopLossDistance = Math.max(
      calculatedRawDistance,
      limitEntryPrice * 0.0015,
    );
    const clampedStopLoss = isLong
      ? parseFloat((limitEntryPrice - minStopLossDistance).toFixed(4))
      : parseFloat((limitEntryPrice + minStopLossDistance).toFixed(4));

    // ── Compute Dynamic 2% Compounding Risk & Contract Sizing ──
    const equity =
      activeEquity && activeEquity > 0
        ? activeEquity
        : this.currentAccountEquity;
    const sizing = this.calculateCompoundedPositionSize(
      equity,
      limitEntryPrice,
      clampedStopLoss,
      overrideRiskPct,
    );

    if (!sizing.isValid) {
      return {
        success: false,
        message: sizing.error || "Position sizing calculation failed.",
      };
    }

    // ── Derive 3-Stage Harvest Targets ──
    const riskDistance = sizing.distance;

    const stage1Target = isLong
      ? parseFloat(
          (limitEntryPrice + riskDistance * this.config.stage1Multiple).toFixed(
            4,
          ),
        )
      : parseFloat(
          (limitEntryPrice - riskDistance * this.config.stage1Multiple).toFixed(
            4,
          ),
        );

    const stage2Target = isLong
      ? parseFloat(
          (limitEntryPrice + riskDistance * this.config.stage2Multiple).toFixed(
            4,
          ),
        )
      : parseFloat(
          (limitEntryPrice - riskDistance * this.config.stage2Multiple).toFixed(
            4,
          ),
        );

    let stage3Target: number;
    if (
      dynamicDolTarget &&
      ((isLong && dynamicDolTarget > stage2Target) ||
        (!isLong && dynamicDolTarget < stage2Target))
    ) {
      stage3Target = parseFloat(dynamicDolTarget.toFixed(4));
    } else {
      stage3Target = isLong
        ? parseFloat(
            (
              limitEntryPrice +
              riskDistance * this.config.stage3Multiple
            ).toFixed(4),
          )
        : parseFloat(
            (
              limitEntryPrice -
              riskDistance * this.config.stage3Multiple
            ).toFixed(4),
          );
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
      status: "PENDING_LIMIT_ENTRY",

      limitEntryPrice,
      entryPrice: limitEntryPrice,
      initialStopLoss: clampedStopLoss,
      activeStopLoss: clampedStopLoss,
      activeRatchetFloor: null,
      trailingSlSource: "INITIAL",

      stage1Target,
      stage2Target,
      stage3Target,
      dynamicDolTarget: dynamicDolTarget ?? null,
      fvgCeLevel: fvgCeLevel ?? null,
      stage1Ratio: this.config.stage1Ratio,
      stage2Ratio: this.config.stage2Ratio,
      stage3Ratio: this.config.stage3Ratio,
      stage1Multiple: this.config.stage1Multiple,
      stage2Multiple: this.config.stage2Multiple,
      stage3Multiple: this.config.stage3Multiple,

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

      setupId: setupId || strategyId,
      anchorName,
      originAnchorLevel,
      originZoneId,
      sweepPrice: sweepPrice ?? null,
      reclaimPrice: reclaimPrice ?? null,
      volExpansion,
      deltaDominance,
      bodyRatio,
      threePillarsPassed,
      displacementCandles,
    };

    if (originZoneId) {
      this.consumedZoneIds.add(originZoneId);
    }

    // ── Guardrail 7: Price Sanity & Invalidated Setups (Stop Loss / TP1 Breached) ──
    const currentPrice = currentMarketPrice ?? limitEntryPrice;
    const isStopLossBreached = isLong
      ? currentPrice <= clampedStopLoss
      : currentPrice >= clampedStopLoss;
    const isTarget1Breached = isLong
      ? currentPrice >= stage1Target
      : currentPrice <= stage1Target;

    if (isStopLossBreached) {
      const msg = `[EXECUTION_VETO] Current market price ($${currentPrice.toFixed(2)}) has already breached the Stop Loss ($${clampedStopLoss.toFixed(2)}). Setup invalidated.`;
      this.emit("DIRECTIONAL_VETO", msg);
      return { success: false, message: msg };
    }

    if (isTarget1Breached) {
      const msg = `[EXECUTION_VETO] Current market price ($${currentPrice.toFixed(2)}) has already reached Target 1 ($${stage1Target.toFixed(2)}). Setup invalidated.`;
      this.emit("DIRECTIONAL_VETO", msg);
      return { success: false, message: msg };
    }

    // Anchor Polarity Guardrail: For Longs, market must NOT be below the anchor level
    if (originAnchorLevel !== undefined && originAnchorLevel !== null) {
      if (isLong && currentPrice < originAnchorLevel) {
        const msg = `[EXECUTION_VETO] Current market price ($${currentPrice.toFixed(2)}) is below the anchor level ($${originAnchorLevel.toFixed(2)}). Reclaim not established.`;
        this.emit("DIRECTIONAL_VETO", msg);
        return { success: false, message: msg };
      }
      if (!isLong && currentPrice > originAnchorLevel) {
        const msg = `[EXECUTION_VETO] Current market price ($${currentPrice.toFixed(2)}) is above the anchor level ($${originAnchorLevel.toFixed(2)}). Reclaim not established.`;
        this.emit("DIRECTIONAL_VETO", msg);
        return { success: false, message: msg };
      }
    }

    // Always place fresh setups into the resting limit queue for true pullback retest execution
    this.pendingLimitOrders.push(newPosition);
    const msg = `⏳ [LIMIT_ORDER_PLACED] Resting Limit ${direction} placed @ $${limitEntryPrice.toFixed(
      2,
    )} on ${symbol} (${timeframe}) | Risk: $${newPosition.riskUsd.toFixed(2)} (2% Compounded).`;
    this.emit("LIMIT_ORDER_PLACED", msg, newPosition);
    return { success: true, position: newPosition, message: msg };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Real-Time Tick & Candle Evaluation Pipeline
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Processes incoming live ticks and candle updates.
   * Evaluates resting limit order fills, Take Profit harvest tranches, and trailing ratchets.
   */
  public processMarketTick(
    livePrice: number,
    currentCandle?: Candle | null,
  ): void {
    if (!livePrice || isNaN(livePrice) || livePrice <= 0) return;
    const now = Date.now();

    // ── Step A: Evaluate Pending Limit Orders for Touch Execution & Atomic Queue Flush ──
    if (this.activePositions.length === 0) {
      for (let i = 0; i < this.pendingLimitOrders.length; i++) {
        const order = this.pendingLimitOrders[i];
        const isLong = order.direction === "LONG";

        // Check if pending order has been invalidated by SL breach or missed TP1 expansion
        const isStopLossBreached = isLong
          ? livePrice <= order.activeStopLoss
          : livePrice >= order.activeStopLoss;
        const isTarget1Reached = isLong
          ? livePrice >= order.stage1Target
          : livePrice <= order.stage1Target;

        if (isStopLossBreached || isTarget1Reached) {
          this.pendingLimitOrders.splice(i, 1);
          i--;
          continue;
        }

        const isTouched = isLong
          ? livePrice <= order.limitEntryPrice
          : livePrice >= order.limitEntryPrice;

        if (isTouched) {
          order.status = "OPEN";
          order.entryPrice = order.limitEntryPrice;
          order.openTime = now;
          this.activePositions.push(order);

          // ATOMIC QUEUE FLUSH: Immediately purge all competing pending limit orders
          this.pendingLimitOrders = [];

          const msg = `🚀 [ORDER_FILLED] Limit ${order.direction} triggered on ${order.symbol} @ $${order.entryPrice.toFixed(
            2,
          )} | Size: ${order.contractSize} ($${order.riskUsd.toFixed(2)} Risk, 2% Compounded).`;
          this.emit("ORDER_FILLED", msg, order);
          break;
        }
      }
    }

    // ── Step B: Evaluate Active Positions Lifecycle & 3-Stage Harvest ──
    for (let i = this.activePositions.length - 1; i >= 0; i--) {
      const pos = this.activePositions[i];
      const isLong = pos.direction === "LONG";
      const riskPerContract = pos.riskPerContract;

      // Update current Floating R-multiple and MFE / MAE
      const currentDelta = isLong
        ? livePrice - pos.entryPrice
        : pos.entryPrice - livePrice;
      const floatingR = currentDelta / riskPerContract;
      pos.unrealizedR = parseFloat(
        (floatingR * pos.remainingAllocation).toFixed(4),
      );
      pos.unrealizedUsd = parseFloat(
        (pos.unrealizedR * pos.riskUsd).toFixed(2),
      );

      if (floatingR > pos.mfeR) {
        pos.mfeR = parseFloat(floatingR.toFixed(4));
      }
      if (floatingR < pos.maeR) {
        pos.maeR = parseFloat(floatingR.toFixed(4));
      }

      // ── B.1: Check Stop Loss Violation ──
      const isStopped = isLong
        ? livePrice <= pos.activeStopLoss
        : livePrice >= pos.activeStopLoss;
      if (isStopped) {
        this.closePosition(i, pos.activeStopLoss, "STOPPED_OUT", now);
        continue;
      }

      // ── B.2: Tranche 1 Harvest (e.g. 50% @ 1.0R Target) ──
      if (!pos.isStage1Filled) {
        const isStage1Hit = isLong
          ? livePrice >= pos.stage1Target
          : livePrice <= pos.stage1Target;
        if (isStage1Hit) {
          pos.isStage1Filled = true;
          pos.stage1HitTime = now;
          pos.status = "STAGE_1_FILLED";

          const stage1Ratio = pos.stage1Ratio ?? this.config.stage1Ratio;
          const stage1Multiple = pos.stage1Multiple ?? this.config.stage1Multiple;
          const trancheR = stage1Ratio * stage1Multiple;
          pos.realizedR = parseFloat((pos.realizedR + trancheR).toFixed(4));
          pos.realizedUsd = parseFloat(
            (pos.realizedR * pos.riskUsd).toFixed(2),
          );
          pos.remainingAllocation = parseFloat(
            Math.max(0, pos.remainingAllocation - stage1Ratio).toFixed(2),
          );

          // Advance SL to Displacement FVG 50% CE or Breakeven (capping runner risk so net P&L >= 0.0R)
          if (this.config.enableStructuralTrail && pos.fvgCeLevel) {
            pos.activeStopLoss = pos.fvgCeLevel;
            pos.trailingSlSource = "FVG_CE";
          } else {
            pos.activeStopLoss = pos.entryPrice;
            pos.trailingSlSource = "BREAKEVEN";
          }

          const pctLabel = (stage1Ratio * 100).toFixed(0);
          const msg = `🎯 [STAGE_1_HARVEST] Tranche 1 (${pctLabel}% @ ${pos.stage1Target.toFixed(2)}) filled on ${
            pos.symbol
          }! Locked +${trancheR.toFixed(2)}R ($${(
            trancheR * pos.riskUsd
          ).toFixed(
            2,
          )}). SL advanced to ${pos.trailingSlSource} ($${pos.activeStopLoss.toFixed(2)}).`;
          this.emit("STAGE_1_HARVEST", msg, pos);
        }
      }

      // ── B.3: Tranche 2 Harvest (e.g. 50% @ 1.4R Target) ──
      if (pos.isStage1Filled && !pos.isStage2Filled) {
        const isStage2Hit = isLong
          ? livePrice >= pos.stage2Target
          : livePrice <= pos.stage2Target;
        if (isStage2Hit) {
          pos.isStage2Filled = true;
          pos.stage2HitTime = now;
          pos.status = "STAGE_2_FILLED";

          const stage2Ratio = pos.stage2Ratio ?? this.config.stage2Ratio;
          const stage2Multiple = pos.stage2Multiple ?? this.config.stage2Multiple;
          const stage3Ratio = pos.stage3Ratio ?? this.config.stage3Ratio;
          const trancheR = stage2Ratio * stage2Multiple;
          pos.realizedR = parseFloat((pos.realizedR + trancheR).toFixed(4));
          pos.realizedUsd = parseFloat(
            (pos.realizedR * pos.riskUsd).toFixed(2),
          );
          pos.remainingAllocation = parseFloat(
            Math.max(0, pos.remainingAllocation - stage2Ratio).toFixed(2),
          );

          const pctLabel = (stage2Ratio * 100).toFixed(0);

          if (stage3Ratio === 0 || pos.remainingAllocation <= 0) {
            // 2-STAGE COMPLETE HARVEST: 100% position closed at TP2!
            const msg = `🏆 [STAGE_2_HARVEST] Tranche 2 (${pctLabel}% @ ${pos.stage2Target.toFixed(2)}) filled on ${
              pos.symbol
            }! 100% Position Closed with Maximum Edge! Total Realized: +${pos.realizedR.toFixed(2)}R ($${pos.realizedUsd.toFixed(
              2,
            )}).`;
            this.emit("STAGE_2_HARVEST", msg, pos);
            this.closePosition(i, pos.stage2Target, "FULL_TP2_WIN", now);
            continue;
          }

          // Immediately Ratchet Active SL to Guaranteed +1.0R Structural Profit Floor
          if (this.config.enableProfitRatchet) {
            const oneRPrice = isLong
              ? parseFloat((pos.entryPrice + riskPerContract * 1.0).toFixed(4))
              : parseFloat((pos.entryPrice - riskPerContract * 1.0).toFixed(4));

            pos.activeStopLoss = oneRPrice;
            pos.activeRatchetFloor = oneRPrice;
            pos.trailingSlSource = "PROFIT_RATCHET_FLOOR";
          }

          const msg = `💎 [STAGE_2_HARVEST] Tranche 2 (${pctLabel}% @ ${pos.stage2Target.toFixed(2)}) filled on ${
            pos.symbol
          }! Total Realized: +${pos.realizedR.toFixed(2)}R ($${pos.realizedUsd.toFixed(
            2,
          )}). SL ratcheted to +1.0R Profit Floor ($${pos.activeStopLoss.toFixed(2)}).`;
          this.emit("STAGE_2_HARVEST", msg, pos);
        }
      }

      // ── B.4: Tranche 3 DOL Runner (20% @ Macro DOL) ──
      const stage3Ratio = pos.stage3Ratio ?? this.config.stage3Ratio;
      if (stage3Ratio > 0 && pos.isStage2Filled && !pos.isStage3Filled) {
        pos.status = "STAGE_3_RUNNER";
        const isStage3Hit = isLong
          ? livePrice >= pos.stage3Target
          : livePrice <= pos.stage3Target;
        if (isStage3Hit) {
          pos.isStage3Filled = true;
          pos.stage3HitTime = now;

          const stage3Multiple = pos.stage3Multiple ?? this.config.stage3Multiple;
          const trancheR = stage3Ratio * stage3Multiple;
          pos.realizedR = parseFloat((pos.realizedR + trancheR).toFixed(4));
          pos.realizedUsd = parseFloat(
            (pos.realizedR * pos.riskUsd).toFixed(2),
          );
          pos.remainingAllocation = 0.0;

          this.closePosition(i, pos.stage3Target, "FULL_TP3_WIN", now);
          continue;
        }
      }
    }
  }

  /**
   * Internal helper to close an active position and trigger post-trade cooldown.
   */
  private closePosition(
    index: number,
    exitPrice: number,
    reason: TradeExitReason,
    timestamp: number,
  ): void {
    const pos = this.activePositions[index];
    if (!pos) return;

    pos.status = "CLOSED";
    pos.closeTime = timestamp;
    pos.exitPrice = parseFloat(exitPrice.toFixed(4));
    pos.exitReason = reason;

    // Calculate final realized R and USD if not already fully realized via targets
    if (reason === "STOPPED_OUT") {
      if (!pos.isStage1Filled && !pos.isStage2Filled) {
        // Full stop out at initial SL (-1.0R)
        pos.realizedR = -1.0;
        pos.realizedUsd = -pos.riskUsd;
      } else if (pos.isStage1Filled && !pos.isStage2Filled) {
        // Stopped out after Stage 1 (Break-even / scratch)
        // 40% locked at +1.0R (+0.40R). Remaining 60% stopped out at FVG CE / BE.
        pos.exitReason = "STAGE_1_SCRATCH";
      } else if (pos.isStage2Filled) {
        // Stopped out after Stage 2 (+1.0R ratchet floor exit)
        // 40% @ 1.0R (+0.40R) + 40% @ 1.5R (+0.60R) + 20% @ +1.0R floor (+0.20R) = +1.20R net!
        const runnerFloorR = this.config.stage3Ratio * 1.0;
        pos.realizedR = parseFloat((pos.realizedR + runnerFloorR).toFixed(4));
        pos.realizedUsd = parseFloat((pos.realizedR * pos.riskUsd).toFixed(2));
        pos.exitReason = "STAGE_2_WIN";
      }
    }

    pos.unrealizedR = 0;
    pos.unrealizedUsd = 0;
    pos.remainingAllocation = 0;

    this.activePositions.splice(index, 1);
    this.closedPositionsHistory.unshift(pos);
    this.lastTradeClosedTimestamp = timestamp;

    const emoji = pos.realizedR > 0 ? "🏆" : pos.realizedR === 0 ? "🛡️" : "🛑";
    const msg = `${emoji} [POSITION_CLOSED] ${pos.direction} on ${pos.symbol} closed @ $${exitPrice.toFixed(2)} (${
      pos.exitReason
    }). Final P&L: ${pos.realizedR > 0 ? "+" : ""}${pos.realizedR.toFixed(2)}R ($${pos.realizedUsd > 0 ? "+" : ""}$${pos.realizedUsd.toFixed(
      2,
    )}). Cooldown activated.`;

    this.emit("POSITION_CLOSED", msg, pos);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Database Rehydration & Synchronization
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Links a persistent database trade ID (UUID) from /api/trades to an active position.
   */
  public linkDbTradeId(posId: string, dbTradeId: string): void {
    const pos =
      this.activePositions.find((p) => p.id === posId) ||
      this.pendingLimitOrders.find((p) => p.id === posId);
    if (pos) {
      pos.dbTradeId = dbTradeId;
    }
  }

  /**
   * Performs an atomic in-memory rollback if database order placement or network fails.
   */
  public rollbackPosition(posId: string, errorReason?: string): boolean {
    const activeIdx = this.activePositions.findIndex(
      (p) => p.id === posId || p.dbTradeId === posId,
    );
    if (activeIdx !== -1) {
      const pos = this.activePositions[activeIdx];
      this.activePositions.splice(activeIdx, 1);
      if (pos.originZoneId) {
        this.consumedZoneIds.delete(pos.originZoneId);
      }
      this.emit(
        "ROLLBACK",
        `⚠️ [ORDER ROLLBACK] Position ${posId} purged from memory due to persistence failure: ${errorReason || "Unknown error"}`,
        pos,
      );
      return true;
    }

    const pendingIdx = this.pendingLimitOrders.findIndex(
      (p) => p.id === posId || p.dbTradeId === posId,
    );
    if (pendingIdx !== -1) {
      const pos = this.pendingLimitOrders[pendingIdx];
      this.pendingLimitOrders.splice(pendingIdx, 1);
      if (pos.originZoneId) {
        this.consumedZoneIds.delete(pos.originZoneId);
      }
      this.emit(
        "ROLLBACK",
        `⚠️ [ORDER ROLLBACK] Pending limit order ${posId} purged from memory: ${errorReason || "Unknown error"}`,
        pos,
      );
      return true;
    }

    return false;
  }

  /**
   * Bi-directional Synchronization: Reconciles in-memory active positions and pending limit orders
   * against the authoritative session journal store.
   * Purges any active positions or pending limit orders that have been closed, deleted, or archived.
   */
  public reconcileWithOpenTrades(sessionTrades: any[]): {
    removedCount: number;
    activeCount: number;
  } {
    const openTradeIds = new Set<string>();
    const closedTradeIds = new Set<string>();

    if (Array.isArray(sessionTrades)) {
      for (const t of sessionTrades) {
        if (!t) continue;
        if (
          t.status === "OPEN" ||
          t.status === "STAGE_1_FILLED" ||
          t.status === "STAGE_2_FILLED" ||
          t.status === "PENDING_LIMIT_ENTRY" ||
          t.status === "PAUSED"
        ) {
          openTradeIds.add(t.id);
        } else if (t.status === "CLOSED") {
          closedTradeIds.add(t.id);
          if (t.setupId) this.processedSetupIds.add(t.setupId);
          if (t.strategyId) this.processedSetupIds.add(t.strategyId);
          if (t.originZoneId) this.processedSetupIds.add(t.originZoneId);
          if (t.metadata?.setupId) this.processedSetupIds.add(t.metadata.setupId);
        }
      }
    }

    let removedCount = 0;

    // 1. Reconcile Active Positions
    for (let i = this.activePositions.length - 1; i >= 0; i--) {
      const pos = this.activePositions[i];
      const isKnownOpen =
        openTradeIds.has(pos.id) ||
        (pos.dbTradeId ? openTradeIds.has(pos.dbTradeId) : false);
      const isExplicitlyClosed =
        closedTradeIds.has(pos.id) ||
        (pos.dbTradeId ? closedTradeIds.has(pos.dbTradeId) : false);

      // If the trade is explicitly closed in journal or is no longer in open list
      if (isExplicitlyClosed || !isKnownOpen) {
        if (pos.originZoneId) {
          this.consumedZoneIds.delete(pos.originZoneId);
        }
        this.activePositions.splice(i, 1);
        removedCount++;
      }
    }

    // 2. Reconcile Pending Limit Orders
    for (let i = this.pendingLimitOrders.length - 1; i >= 0; i--) {
      const ord = this.pendingLimitOrders[i];
      const isKnownOpen =
        openTradeIds.has(ord.id) ||
        (ord.dbTradeId ? openTradeIds.has(ord.dbTradeId) : false);
      const isExplicitlyClosed =
        closedTradeIds.has(ord.id) ||
        (ord.dbTradeId ? closedTradeIds.has(ord.dbTradeId) : false);

      if (isExplicitlyClosed || !isKnownOpen) {
        if (ord.originZoneId) {
          this.consumedZoneIds.delete(ord.originZoneId);
        }
        this.pendingLimitOrders.splice(i, 1);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.emit(
        "RECONCILED",
        `🔄 Reconciled with session journal: purged ${removedCount} closed/stale position(s).`,
      );
    }

    return { removedCount, activeCount: this.activePositions.length };
  }

  /**
   * Hard reset: purges all active positions, pending orders, and consumed zones from memory.
   */
  public purgeAllActivePositions(): void {
    this.activePositions = [];
    this.pendingLimitOrders = [];
    this.consumedZoneIds.clear();
    this.emit(
      "RECONCILED",
      "🧹 Purged all active positions and pending limit orders from engine memory.",
    );
  }

  /**
   * Rehydrates open positions from persistent PostgreSQL / in-memory trade records on mount.
   * Strictly isolates trades to Sweep & Reclaim namespace signatures.
   */
  public rehydrateOpenPositions(dbTrades: any[]): StrategyExecutionPosition[] {
    const rehydrated: StrategyExecutionPosition[] = [];

    for (const trade of dbTrades) {
      if (
        trade.status !== "OPEN" &&
        trade.status !== "STAGE_1_FILLED" &&
        trade.status !== "STAGE_2_FILLED"
      ) {
        continue;
      }

      // Namespace Isolation: Only adopt trades belonging to Sweep & Reclaim
      const stratName = (trade.strategy_name || "").toLowerCase();
      const isSrStrategy =
        stratName.includes("sweep & reclaim") ||
        stratName.includes("s&r") ||
        stratName.includes("3-pillar") ||
        stratName.includes("failed signal reversal") ||
        stratName.includes("auto 2% compounded");

      if (!isSrStrategy) {
        continue; // Strictly ignore Order Block or other strategy trades
      }

      // Check if already active
      if (
        this.activePositions.some(
          (p) => p.dbTradeId === trade.id || p.id === trade.id,
        )
      ) {
        continue;
      }

      const direction = trade.direction as "LONG" | "SHORT";
      const entryPrice = parseFloat(trade.entry_price);
      const stopLoss = parseFloat(trade.stop_loss);
      const ipda = trade.ipda_metrics || {};

      const riskUsd = parseFloat(trade.risk_amount_usd || 200.0);
      const distance = Math.abs(entryPrice - stopLoss);
      const contractSize = parseFloat(
        trade.position_size || (riskUsd / (distance || 1)).toFixed(3),
      );

      const stage1Target =
        ipda.stage1_target ??
        (direction === "LONG"
          ? entryPrice + distance * 1.0
          : entryPrice - distance * 1.0);
      const stage2Target =
        ipda.stage2_target ??
        (direction === "LONG"
          ? entryPrice + distance * 1.5
          : entryPrice - distance * 1.5);
      const stage3Target =
        ipda.stage3_target ??
        (direction === "LONG"
          ? entryPrice + distance * 3.0
          : entryPrice - distance * 3.0);

      const isStage1Filled =
        trade.status === "STAGE_1_FILLED" || trade.status === "STAGE_2_FILLED";
      const isStage2Filled = trade.status === "STAGE_2_FILLED";

      const pos: StrategyExecutionPosition = {
        id: `REHYDRATED_${trade.id.slice(0, 8)}`,
        dbTradeId: trade.id,
        strategyId: trade.strategy_name || "Automated Strategy",
        strategyName: trade.strategy_name || "Automated Strategy",
        symbol: trade.symbol || "ETHUSDC",
        timeframe: ipda.timeframe || "15m",
        direction,
        status: trade.status as PositionStageStatus,

        limitEntryPrice: entryPrice,
        entryPrice,
        initialStopLoss: stopLoss,
        activeStopLoss: stopLoss,
        activeRatchetFloor: isStage2Filled
          ? direction === "LONG"
            ? entryPrice + distance
            : entryPrice - distance
          : null,
        trailingSlSource: isStage2Filled
          ? "PROFIT_RATCHET_FLOOR"
          : isStage1Filled
            ? "BREAKEVEN"
            : "INITIAL",

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
        remainingAllocation: isStage2Filled ? 0.2 : isStage1Filled ? 0.6 : 1.0,

        realizedR: isStage2Filled ? 1.0 : isStage1Filled ? 0.4 : 0.0,
        realizedUsd: isStage2Filled
          ? riskUsd * 1.0
          : isStage1Filled
            ? riskUsd * 0.4
            : 0.0,
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

        pendingTime: new Date(
          trade.opened_at || trade.created_at || Date.now(),
        ).getTime(),
        openTime: new Date(
          trade.opened_at || trade.created_at || Date.now(),
        ).getTime(),
        closeTime: null,
        exitPrice: null,
        exitReason: null,

        setupId: ipda.setup_id || ipda.origin_zone_id || trade.id,
        anchorName: ipda.anchor_name,
        originAnchorLevel: ipda.anchor_level ?? ipda.origin_anchor_level,
        originZoneId: ipda.origin_zone_id || ipda.setup_id,
        sweepPrice: ipda.sweep_price ?? null,
        reclaimPrice: ipda.reclaim_price ?? null,
        volExpansion: ipda.vol_expansion ?? undefined,
        deltaDominance: ipda.delta_dominance ?? undefined,
        bodyRatio: ipda.body_ratio ?? undefined,
        threePillarsPassed: ipda.three_pillars_passed ?? undefined,
        displacementCandles: ipda.displacement_candles ?? undefined,

        isRehydrated: true,
      };

      this.activePositions.push(pos);
      rehydrated.push(pos);
    }

    if (rehydrated.length > 0) {
      this.emit(
        "REHYDRATED",
        `🔄 Re-hydrated ${rehydrated.length} active position(s) from database.`,
      );
    }

    return rehydrated;
  }

  /**
   * Directly rehydrates full StrategyExecutionPosition objects (e.g. from DaemonLedger session file).
   */
  public rehydratePositionsDirect(positions: StrategyExecutionPosition[]): void {
    for (const pos of positions) {
      if (pos.status === 'PENDING_LIMIT_ENTRY') {
        if (!this.pendingLimitOrders.some(p => p.id === pos.id)) {
          this.pendingLimitOrders.push(pos);
          if (pos.originZoneId) this.consumedZoneIds.add(pos.originZoneId);
          if (pos.setupId) this.processedSetupIds.add(pos.setupId);
        }
      } else if (
        pos.status === 'OPEN' ||
        pos.status === 'STAGE_1_FILLED' ||
        pos.status === 'STAGE_2_FILLED' ||
        pos.status === 'STAGE_3_RUNNER'
      ) {
        if (!this.activePositions.some(p => p.id === pos.id)) {
          // Ensure 2-stage configuration is populated
          pos.stage1Ratio = pos.stage1Ratio ?? this.config.stage1Ratio;
          pos.stage2Ratio = pos.stage2Ratio ?? this.config.stage2Ratio;
          pos.stage3Ratio = pos.stage3Ratio ?? this.config.stage3Ratio;
          pos.stage1Multiple = pos.stage1Multiple ?? this.config.stage1Multiple;
          pos.stage2Multiple = pos.stage2Multiple ?? this.config.stage2Multiple;
          pos.stage3Multiple = pos.stage3Multiple ?? this.config.stage3Multiple;
          this.activePositions.push(pos);
          if (pos.originZoneId) this.consumedZoneIds.add(pos.originZoneId);
          if (pos.setupId) this.processedSetupIds.add(pos.setupId);
        }
      }
    }
  }

  // ── Manual Emergency Controls ──
  public emergencyClosePosition(
    posId: string,
    currentMarketPrice: number,
  ): boolean {
    const idx = this.activePositions.findIndex(
      (p) => p.id === posId || p.dbTradeId === posId,
    );
    if (idx !== -1) {
      this.closePosition(idx, currentMarketPrice, "MANUAL_EXIT", Date.now());
      return true;
    }
    return false;
  }

  public moveStopToBreakeven(posId: string): boolean {
    const pos = this.activePositions.find(
      (p) => p.id === posId || p.dbTradeId === posId,
    );
    if (pos && pos.status !== "CLOSED") {
      pos.activeStopLoss = pos.entryPrice;
      pos.trailingSlSource = "BREAKEVEN";
      this.emit(
        "STAGE_1_HARVEST",
        `🛡️ [MANUAL_BE] Stop loss moved to Break-even ($${pos.entryPrice.toFixed(2)}).`,
        pos,
      );
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
    multiTfCandles: { "5m"?: Candle[]; "15m"?: Candle[]; "1h"?: Candle[] },
    macroContext?: {
      macroDailyBias?: "BULLISH" | "BEARISH" | "NEUTRAL";
      dolDirection?: "BULLISH" | "BEARISH" | "BALANCED";
      localDealingRange?: any;
    },
  ): {
    scannedSetups: SweepReclaimSetup[];
    executedSetups: SweepReclaimSetup[];
  } {
    const settings = this.config.liveSettings || DEFAULT_SR_LIVE_SETTINGS;
    const enabledTfs =
      settings.enabledTimeframes && settings.enabledTimeframes.length > 0
        ? settings.enabledTimeframes
        : ["5m", "15m", "1h"];

    const scanned: SweepReclaimSetup[] = [];
    const executed: SweepReclaimSetup[] = [];

    // Map UI anchor categories to underlying SweepReclaimAnchorType array
    const mappedAnchorTypes: SweepReclaimAnchorType[] = [];
    const activeAnchors = settings.anchorTypes || [
      "SWING_PIVOT",
      "ASIAN",
      "LONDON",
      "DAILY",
    ];
    if (activeAnchors.includes("SWING_PIVOT"))
      mappedAnchorTypes.push("SWING_PIVOT");
    if (activeAnchors.includes("ASIAN")) {
      mappedAnchorTypes.push("ASIAN_HIGH");
      mappedAnchorTypes.push("ASIAN_LOW");
    }
    if (activeAnchors.includes("LONDON")) {
      mappedAnchorTypes.push("LONDON_HIGH");
      mappedAnchorTypes.push("LONDON_LOW");
    }
    if (activeAnchors.includes("DAILY")) {
      mappedAnchorTypes.push("PDH");
      mappedAnchorTypes.push("PDL");
    }

    for (const tf of enabledTfs) {
      const rawCandles = multiTfCandles[tf as keyof typeof multiTfCandles];
      if (!rawCandles || rawCandles.length < 25) continue;

      const candles = rawCandles.filter((c) => c.isClosed !== false);
      if (candles.length < 25) continue;

      const latestCandle = rawCandles[rawCandles.length - 1];
      const latestPrice = latestCandle.c ?? (latestCandle as any).close;

      const scanConfig: SweepReclaimScanConfig = {
        symbol: this.config.symbol,
        timeframe: tf,
        anchorTypes:
          mappedAnchorTypes.length > 0 ? mappedAnchorTypes : undefined,

        // Quant Lab Structural Alignment Parameters (5m Winner Default)
        lookbackMajor: settings.lookbackMajor ?? 10,
        lookbackInternal: settings.lookbackInternal ?? 5,
        maxBarsAnchorToSweep: settings.maxBarsAnchorToSweep ?? 25,
        maxBarsSweepToReclaim: settings.maxBarsSweepToReclaim ?? 10,
        maxBarsToRetest: settings.maxBarsToRetest ?? 20,
        minSweepDepthAtrMultiplier: settings.minSweepDepthAtrMultiplier ?? 0.10,
        slBufferAtrMultiplier:
          settings.slBufferAtrMultiplier ??
          this.config.slBufferAtrMultiplier ??
          0.12,

        // Target Multiples & Execution
        entryMode: settings.entryMode ?? "FVG_PROXIMAL",
        stage1Multiple:
          settings.stage1Multiple ?? this.config.stage1Multiple ?? 1.0,
        stage2Multiple:
          settings.stage2Multiple ?? this.config.stage2Multiple ?? 1.4,
        stage3Multiple:
          settings.stage3Multiple ?? this.config.stage3Multiple ?? 3.0,
        enableStructuralTrail:
          settings.enableStructuralTrail ?? this.config.enableStructuralTrail,
        enableProfitRatchet:
          settings.enableProfitRatchet ?? this.config.enableProfitRatchet,

        // 3-Pillar Displacement Gatekeeper Thresholds
        volumeSmaPeriod: settings.volumeSmaPeriod ?? 20,
        volumeExpansionThreshold: settings.volumeExpansionThreshold ?? 1.35,
        deltaDominanceThreshold: settings.deltaDominanceThreshold ?? 52.0,
        bodyRatioThreshold: settings.bodyRatioThreshold ?? 0.50,
        requireThreePillarDisplacement:
          settings.requireThreePillarDisplacement ?? true,

        // Valuation Gating
        enforceDiscountPremiumGate: settings.enforceDiscountPremiumGate ?? true,
      };

      try {
        const engine = new SweepReclaimEngine(scanConfig);
        const scanResult = engine.scanHistoricalSetups(candles);
        const setups = scanResult.setups || [];

        for (const s of setups) {
          scanned.push(s);

          // If a position is already active, enforce strict single-position concurrency lock
          if (this.activePositions.length > 0) {
            continue;
          }

          // 1. Strict Freshness Gate: Reclaim must be within the active maxBarsToRetest window from latest candle
          const latestIndex = candles.length - 1;
          const barsSinceReclaim = s.reclaim_index !== null ? latestIndex - s.reclaim_index : Infinity;
          const maxRetestBars = settings.maxBarsToRetest ?? 20;
          if (s.reclaim_index === null || barsSinceReclaim > maxRetestBars) {
            continue; // Stale historical candidate: do not arm for live execution
          }

          // 2. Wall-Clock TTL Guard (if real-time elapsed exceeds maxBarsToRetest duration)
          const tfMinutes = tf === "1h" ? 60 : tf === "15m" ? 15 : 5;
          const maxTtlMs = maxRetestBars * tfMinutes * 60 * 1000;
          if (s.reclaim_time && Date.now() - s.reclaim_time > maxTtlMs) {
            continue; // TTL expired
          }

          // 3. Anchor Boundary Verification: Price must be currently on the valid reclaimed side of the anchor
          const isBullish = s.type === "BULLISH";
          if (isBullish && latestPrice < s.anchor_level) {
            continue; // Long setup invalid if price is trading below anchor
          }
          if (!isBullish && latestPrice > s.anchor_level) {
            continue; // Short setup invalid if price is trading above anchor
          }

          // 4. Missed Expansion Check: Do not arm if price already reached or exceeded TP1
          if (isBullish && latestPrice >= s.stage1_target) {
            continue;
          }
          if (!isBullish && latestPrice <= s.stage1_target) {
            continue;
          }

          // 5. CRITICAL HISTORICAL RESOLUTION & ZERO-LEAK GUARD:
          // For historical setups (older than the latest candle), if the setup has ALREADY been retested,
          // simulated, stopped out, closed, or completed in past candles, it is a past event and must
          // NEVER be re-opened as a live pending order on cold-start / reboot.
          // Freshly closed setups on the current candle (reclaim_index === latestIndex) MUST be allowed
          // to arm for live real-time execution even if the historical backtest marked an immediate fill artifact.
          const isFreshCandleClose = s.reclaim_index === latestIndex;
          if (
            !isFreshCandleClose &&
            (s.is_retested === true ||
              s.simulated_outcome !== null ||
              s.retest_time !== null ||
              s.status === 'RETESTED' ||
              s.status === 'INVALIDATED_AT_RETEST' ||
              s.status === 'EXPIRED')
          ) {
            this.processedSetupIds.add(s.id);
            continue;
          }

          // Check if setup is confirmed for live entry (3-Pillars passed and Valuation aligned)
          const isConfirmed =
            s.is_reclaimed &&
            s.three_pillar_displacement_passed &&
            (!settings.enforceDiscountPremiumGate || s.is_valuation_aligned);

          if (
            isConfirmed &&
            this.config.autoExecute &&
            !this.processedSetupIds.has(s.id)
          ) {
            // One-Active-Position-Per-Structural-Wave Concurrency Lock
            const isZoneAlreadyActive =
              this.activePositions.some(
                (p) =>
                  p.originZoneId === s.id ||
                  (p.originAnchorLevel !== undefined &&
                    Math.abs(p.originAnchorLevel - s.anchor_level) < 0.5),
              ) ||
              this.pendingLimitOrders.some(
                (p) =>
                  p.originZoneId === s.id ||
                  (p.originAnchorLevel !== undefined &&
                    Math.abs(p.originAnchorLevel - s.anchor_level) < 0.5),
              );

            if (isZoneAlreadyActive) {
              continue;
            }

            // Determine limit entry price based on entryMode
            let entryPrice = s.entry_price;
            if (
              !entryPrice ||
              isNaN(entryPrice) ||
              (settings.entryMode && settings.entryMode !== s.entry_mode)
            ) {
              entryPrice = resolveRetestEntryPrice({
                mode: settings.entryMode ?? "FVG_PROXIMAL",
                isBullish: s.type === "BULLISH",
                anchorLevel: s.anchor_level,
                sweepCandle:
                  s.sweep_price !== null
                    ? {
                        high:
                          s.sweep_ob_proximal !== undefined &&
                          s.sweep_ob_proximal !== null &&
                          s.type === "BULLISH"
                            ? s.sweep_ob_proximal
                            : s.type === "BULLISH"
                              ? Math.max(
                                  s.anchor_level,
                                  (s.sweep_ob_mt ?? s.sweep_price) * 2 -
                                    s.sweep_price,
                                )
                              : s.sweep_price,
                        low:
                          s.sweep_ob_proximal !== undefined &&
                          s.sweep_ob_proximal !== null &&
                          s.type === "BEARISH"
                            ? s.sweep_ob_proximal
                            : s.type === "BULLISH"
                              ? s.sweep_price
                              : Math.min(
                                  s.anchor_level,
                                  (s.sweep_ob_mt ?? s.sweep_price) * 2 -
                                    s.sweep_price,
                                ),
                        mt: s.sweep_ob_mt ?? undefined,
                      }
                    : null,
                fvg:
                  s.reclaim_fvg_created &&
                  s.reclaim_fvg_top !== null &&
                  s.reclaim_fvg_bottom !== null
                    ? {
                        top: s.reclaim_fvg_top,
                        bottom: s.reclaim_fvg_bottom,
                        ce: s.reclaim_fvg_ce ?? undefined,
                      }
                    : null,
                displacementExtremes:
                  s.displacement_impulse_high && s.displacement_impulse_low
                    ? {
                        impulseHigh: s.displacement_impulse_high,
                        impulseLow: s.displacement_impulse_low,
                      }
                    : null,
              });
            }

            // 6. Limit Resting Side Check:
            // For a Short limit entry, market price must currently be resting BELOW the limit price (waiting to rally up into entry).
            // If market price is already ABOVE limit price, price has already traded past the entry zone.
            // For a Long limit entry, market price must currently be resting ABOVE the limit price (waiting to pullback down into entry).
            // If market price is already BELOW limit price, price has already traded past the entry zone.
            if (isBullish && latestPrice <= entryPrice) {
              continue;
            }
            if (!isBullish && latestPrice >= entryPrice) {
              continue;
            }

            // Price Sanity Guard: Ensure entry level is within 5% of current market price
            const priceDistancePct =
              Math.abs(entryPrice - latestPrice) / latestPrice;
            if (priceDistancePct > 0.05) {
              // Temporary distance mismatch: do NOT permanently blacklist
              continue;
            }

            const direction = s.type === "BULLISH" ? "LONG" : "SHORT";
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
              setupId: s.id,
              anchorName: s.anchor_name,
              originZoneId: s.id,
              originAnchorLevel: s.anchor_level,
              sweepPrice: s.sweep_price,
              reclaimPrice: s.reclaim_close_price,
              volExpansion: s.reclaim_volume_expansion ?? undefined,
              deltaDominance: s.reclaim_delta_dominance_pct ?? undefined,
              bodyRatio: s.reclaim_body_ratio ?? undefined,
              threePillarsPassed: s.three_pillar_displacement_passed,
              displacementCandles: s.displacement_candles,
              overrideRiskPct: settings.compoundingRiskPct,
            });

            if (submitRes.success) {
              this.processedSetupIds.add(s.id);
              executed.push(s);
            }
          }
        }
      } catch (err) {
        console.warn(
          `[AutomatedStrategyExecutionEngine] Error scanning ${tf} candles for S&R:`,
          err,
        );
      }
    }

    this.latestScannedSetups = scanned;
    return { scannedSetups: scanned, executedSetups: executed };
  }
}
