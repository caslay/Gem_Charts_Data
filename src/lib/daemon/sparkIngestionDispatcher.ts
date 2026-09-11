/**
 * sparkIngestionDispatcher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow-State Quant Engine — Spark Inbound Ingestion Dispatcher
 * ─────────────────────────────────────────────────────────────────────────────
 * Dedicated inbound poller and dispatcher that monitors PostgreSQL for newly
 * submitted 'ACTIVE' agent decision records from Gemini Spark (via Quegar MCP).
 *
 * Execution Protocol:
 * 1. Monitored Queue: Polls `agent_decision_log` for rows with `status = 'ACTIVE'`.
 * 2. Invalidation Pre-Flight Gate: If market price breaches `invalidation_level`
 *    before queueing, mark status as 'INVALIDATED' (with `invalidated_at`) and stand down.
 * 3. Atomic Queue Claim: Atomically transitions record to 'QUEUED' to prevent
 *    duplicate execution loops across concurrent intervals.
 * 4. Structured Parsing: Extracts symbol, direction, entry boundaries, invalidation
 *    level, and Stage 1/Stage 2 targets.
 * 5. Pre-Trade Pipeline Handover: Feeds the parsed setup directly into
 *    `AutomatedStrategyExecutionEngine.submitStrategyOrder()` which enforces all
 *    guardrails (concurrency, directional lock, cooldown, resting-side check, 2% risk).
 * 6. Audit Logging & State Persistence: Updates status to 'EXECUTED' or 'REJECTED'
 *    with forensic notes in `agent_decision_log`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  AutomatedStrategyExecutionEngine,
  StrategyExecutionPosition,
} from '../quantEngine/AutomatedStrategyExecutionEngine';
import {
  runInvalidationCheck,
  fetchLivePrice,
  ensureAgentDecisionTableInitialized,
} from '../agentEngineHandlers';
import { sql } from '../postgres';
import { TelegramNotifier } from '../notifications/telegramNotifier';
import { DaemonLedger } from './daemonLedger';
import { GlobalRiskGovernor } from '../risk/GlobalRiskGovernor';
import { PreTradeAssessment, RiskGovernorConfig, RiskGovernorState } from '../risk/types';
import { evaluateExecutionSafetyGate } from '../binanceOrderRouter';

import { TelegramBotService } from '../notifications/telegramBotService';

export type TriStateExecutionMode = 'STANDBY' | 'PAPER_TRADING' | 'LIVE_BINANCE';

export function normalizeExecutionMode(raw?: string | null): TriStateExecutionMode | null {
  if (!raw) return null;
  const upper = String(raw).trim().toUpperCase();
  if (upper === 'STANDBY' || upper === 'LOGGED_STANDBY') return 'STANDBY';
  if (upper === 'PAPER' || upper === 'PAPER_TRADING' || upper === 'PAPER_ACTIVE') return 'PAPER_TRADING';
  if (upper === 'LIVE' || upper === 'LIVE_BINANCE' || upper === 'REAL') return 'LIVE_BINANCE';
  return null;
}

export interface ActiveRiskSettings {
  compoundingRiskPct: number;
  maxOpenPositions: number;
  accountEquity: number;
  emergencyEquityFloor?: number;
}

export interface SparkPositionSizingParams {
  accountEquity: number;
  compoundingRiskPct: number;
  entryPrice: number;
  invalidationLevel: number;
  direction: 'LONG' | 'SHORT';
  lotPrecision?: number; // default: 3 for ETHUSDC
  minLotSize?: number; // default: 0.001
  maxLotSize?: number; // default: 100.0
  minNotional?: number; // default: 5.0 USD
}

export interface SparkPositionSizingResult {
  rawStopDistance: number;
  minDistanceFloor: number;
  clampedStopDistance: number;
  clampedStopLoss: number;
  isClamped: boolean;
  dollarRisk: number;
  rawContractSize: number;
  contractSize: number;
  notionalValue: number;
  effectiveLeverage: number;
  compoundingRiskPct: number;
  accountEquity: number;
  isValid: boolean;
  error?: string;
}

export interface SparkIngestionDispatcherOptions {
  engine: AutomatedStrategyExecutionEngine;
  getCurrentPrice: (symbol: string) => number | null;
  pollIntervalMs?: number; // default: 2000 ms
  telegram?: TelegramNotifier | TelegramBotService;
  ledger?: DaemonLedger;
  allowOfflineFallback?: boolean; // When true, allows testing/dry-run pipeline execution even when PostgreSQL is offline
  userEmail?: string; // default: 'institutional_admin'
  getRiskSettings?: () => Partial<ActiveRiskSettings> | Promise<Partial<ActiveRiskSettings>>;
  stageOnly?: boolean; // When true, stages setups without auto-submitting to engine order placement
  executionMode?: TriStateExecutionMode; // Tri-State execution mode: 'STANDBY' | 'PAPER_TRADING' | 'LIVE_BINANCE'
  cliMode?: TriStateExecutionMode; // Explicit CLI override: --mode=standby|paper|live
}

export interface ParsedSparkDecision {
  id: number;
  symbol: string;
  agentId: string;
  direction: 'LONG' | 'SHORT' | null;
  limitEntryPrice: number | null;
  stopLossPrice: number | null;
  rawStopLossPrice?: number | null;
  clampedStopLossPrice?: number | null;
  clampedStopDistance?: number | null;
  stage1Target: number | null;
  stage2Target: number | null;
  entryRangeLow: number | null;
  entryRangeHigh: number | null;
  invalidationLevel: number | null;
  biasSignal: string;
  isInvalidatedPriorToQueue: boolean;
  invalidationReason?: string;
  rawRecord: any;
  positionSize?: number;
  dollarRisk?: number;
  riskPct?: number;
  effectiveLeverage?: number;
}

export interface ProcessDecisionResult {
  status:
    | 'EXECUTED'
    | 'STAGED'
    | 'LOGGED_STANDBY'
    | 'PAPER_ACTIVE'
    | 'INVALIDATED'
    | 'QUEUED'
    | 'REJECTED'
    | 'REJECTED_BY_RISK_GOVERNOR'
    | 'STAND_DOWN'
    | 'ALREADY_CLAIMED'
    | 'ERROR';
  executionMode?: TriStateExecutionMode;
  reason?: string;
  position?: StrategyExecutionPosition;
  parsed?: ParsedSparkDecision;
  riskAssessment?: PreTradeAssessment;
  sizing?: SparkPositionSizingResult;
}

/**
 * Calculates exact position sizing, dollar risk, and leverage programmatically
 * from account equity and Spark's price levels, enforcing the mandatory 0.15%
 * minimum stop-loss distance clamp and Binance futures lot constraints.
 */
export function calculateSparkPositionSizing(
  params: SparkPositionSizingParams
): SparkPositionSizingResult {
  const {
    accountEquity,
    compoundingRiskPct,
    entryPrice,
    invalidationLevel,
    direction,
    lotPrecision = 3,
    minLotSize = 0.001,
    maxLotSize = 100.0,
    minNotional = 5.0,
  } = params;

  if (compoundingRiskPct <= 0 || isNaN(compoundingRiskPct) || compoundingRiskPct > 100) {
    return {
      rawStopDistance: 0,
      minDistanceFloor: 0,
      clampedStopDistance: 0,
      clampedStopLoss: invalidationLevel,
      isClamped: false,
      dollarRisk: 0,
      rawContractSize: 0,
      contractSize: 0,
      notionalValue: 0,
      effectiveLeverage: 0,
      compoundingRiskPct,
      accountEquity,
      isValid: false,
      error: 'Invalid compounding risk percentage (must be > 0 and <= 100)',
    };
  }

  if (direction !== 'LONG' && direction !== 'SHORT') {
    return {
      rawStopDistance: 0,
      minDistanceFloor: 0,
      clampedStopDistance: 0,
      clampedStopLoss: invalidationLevel,
      isClamped: false,
      dollarRisk: 0,
      rawContractSize: 0,
      contractSize: 0,
      notionalValue: 0,
      effectiveLeverage: 0,
      compoundingRiskPct,
      accountEquity,
      isValid: false,
      error: `Invalid direction: ${direction} (must be 'LONG' or 'SHORT')`,
    };
  }

  if (accountEquity <= 0 || isNaN(accountEquity)) {
    return {
      rawStopDistance: 0,
      minDistanceFloor: 0,
      clampedStopDistance: 0,
      clampedStopLoss: invalidationLevel,
      isClamped: false,
      dollarRisk: 0,
      rawContractSize: 0,
      contractSize: 0,
      notionalValue: 0,
      effectiveLeverage: 0,
      compoundingRiskPct,
      accountEquity,
      isValid: false,
      error: 'Invalid account equity (must be > 0)',
    };
  }

  if (entryPrice <= 0 || isNaN(entryPrice)) {
    return {
      rawStopDistance: 0,
      minDistanceFloor: 0,
      clampedStopDistance: 0,
      clampedStopLoss: invalidationLevel,
      isClamped: false,
      dollarRisk: 0,
      rawContractSize: 0,
      contractSize: 0,
      notionalValue: 0,
      effectiveLeverage: 0,
      compoundingRiskPct,
      accountEquity,
      isValid: false,
      error: 'Invalid entry price (must be > 0)',
    };
  }

  const rawStopDistance = Math.abs(entryPrice - invalidationLevel);
  if (rawStopDistance <= 0 || isNaN(rawStopDistance)) {
    return {
      rawStopDistance: 0,
      minDistanceFloor: 0,
      clampedStopDistance: 0,
      clampedStopLoss: invalidationLevel,
      isClamped: false,
      dollarRisk: 0,
      rawContractSize: 0,
      contractSize: 0,
      notionalValue: 0,
      effectiveLeverage: 0,
      compoundingRiskPct,
      accountEquity,
      isValid: false,
      error: 'Invalid stop loss: Entry equals invalidation level',
    };
  }

  // Anti-Micro-Friction Clamp: 0.15% minimum stop distance floor
  const minDistanceFloor = parseFloat((entryPrice * 0.0015).toFixed(4));
  const isClamped = rawStopDistance < minDistanceFloor;
  const clampedStopDistance = Math.max(rawStopDistance, minDistanceFloor);

  // Derive clamped stop loss level respecting direction
  const clampedStopLoss = direction === 'LONG'
    ? parseFloat((entryPrice - clampedStopDistance).toFixed(4))
    : parseFloat((entryPrice + clampedStopDistance).toFixed(4));

  // Dollar Risk = Account Equity * (Risk % / 100)
  const dollarRisk = parseFloat((accountEquity * (compoundingRiskPct / 100)).toFixed(4));

  // Raw contract size = Dollar Risk / Clamped Stop Distance
  const rawContractSize = dollarRisk / clampedStopDistance;

  // Lot size step rounding down
  const factor = Math.pow(10, lotPrecision);
  let contractSize = Math.floor(rawContractSize * factor) / factor;

  // Binance Minimum Notional ($5.00 USD)
  const minSizeForNotional = Math.ceil((minNotional / entryPrice) * factor) / factor;
  if (contractSize < minSizeForNotional) {
    contractSize = Math.max(minSizeForNotional, minLotSize);
  }

  if (contractSize < minLotSize) {
    contractSize = minLotSize;
  }
  if (contractSize > maxLotSize) {
    contractSize = maxLotSize;
  }

  contractSize = parseFloat(contractSize.toFixed(lotPrecision));
  const notionalValue = parseFloat((contractSize * entryPrice).toFixed(2));
  const effectiveLeverage = parseFloat((notionalValue / accountEquity).toFixed(2));

  return {
    rawStopDistance: parseFloat(rawStopDistance.toFixed(4)),
    minDistanceFloor,
    clampedStopDistance: parseFloat(clampedStopDistance.toFixed(4)),
    clampedStopLoss,
    isClamped,
    dollarRisk,
    rawContractSize,
    contractSize,
    notionalValue,
    effectiveLeverage,
    compoundingRiskPct,
    accountEquity,
    isValid: true,
  };
}

/**
 * Parses raw `agent_decision_log` row into normalized execution levels.
 * Pure function suitable for unit testing without database dependency.
 */
export function parseSparkDecision(
  record: any,
  livePrice: number | null
): ParsedSparkDecision {
  const id = Number(record.id);
  const rawSymbol = String(record.symbol || 'ETHUSDC').trim().toUpperCase().replace(/[-_/]/g, '');
  let symbol = rawSymbol;
  if (symbol === 'ETH') symbol = 'ETHUSDC';
  if (symbol === 'BTC') symbol = 'BTCUSDC';

  const agentId = String(record.agent_id || 'unknown_agent');
  const biasSignal = String(record.bias_signal || '').trim();

  const rawLow =
    record.entry_range_low !== null && record.entry_range_low !== undefined
      ? parseFloat(String(record.entry_range_low))
      : null;
  const rawHigh =
    record.entry_range_high !== null && record.entry_range_high !== undefined
      ? parseFloat(String(record.entry_range_high))
      : null;
  const invalidationLevel =
    record.invalidation_level !== null && record.invalidation_level !== undefined
      ? parseFloat(String(record.invalidation_level))
      : null;
  const target1 =
    record.target_1 !== null && record.target_1 !== undefined
      ? parseFloat(String(record.target_1))
      : null;
  const target2 =
    record.target_2 !== null && record.target_2 !== undefined
      ? parseFloat(String(record.target_2))
      : null;

  // Normalize range boundaries so low <= high
  let entryRangeLow: number | null = null;
  let entryRangeHigh: number | null = null;
  if (rawLow !== null && rawHigh !== null && !isNaN(rawLow) && !isNaN(rawHigh)) {
    entryRangeLow = Math.min(rawLow, rawHigh);
    entryRangeHigh = Math.max(rawLow, rawHigh);
  } else {
    entryRangeLow = rawLow !== null && !isNaN(rawLow) ? rawLow : null;
    entryRangeHigh = rawHigh !== null && !isNaN(rawHigh) ? rawHigh : null;
  }

  // Resolve direction strictly from bias_signal first
  let direction: 'LONG' | 'SHORT' | null = null;
  const upper = biasSignal.toUpperCase();
  if (upper.includes('NEUTRAL') || upper.includes('ABORT') || upper === 'STAND_DOWN') {
    // Explicit non-directional intent: MUST NOT fall back to target vs invalidation comparison
    direction = null;
  } else if (upper.includes('BULL') || upper === 'LONG' || upper === 'BUY') {
    direction = 'LONG';
  } else if (upper.includes('BEAR') || upper === 'SHORT' || upper === 'SELL') {
    direction = 'SHORT';
  } else if (target1 !== null && invalidationLevel !== null && target1 !== invalidationLevel) {
    // Fallback only when bias is not explicitly neutral/abort (e.g. COUNTER_TREND_RETRACEMENT or empty)
    direction = target1 > invalidationLevel ? 'LONG' : 'SHORT';
  }

  // Determine limitEntryPrice based on entry range and resting-side physics
  let limitEntryPrice: number | null = null;
  const isLong = direction === 'LONG';

  if (entryRangeLow !== null && entryRangeHigh !== null) {
    if (isLong) {
      if (livePrice === null || livePrice > entryRangeHigh) {
        // Price is above entry zone: proximal boundary is entryRangeHigh (resting buy limit below market)
        limitEntryPrice = entryRangeHigh;
      } else if (livePrice <= entryRangeHigh && livePrice > entryRangeLow) {
        // Price has already penetrated into the zone: distal boundary is entryRangeLow (resting buy limit below market)
        limitEntryPrice = entryRangeLow;
      } else {
        // Price is already <= entryRangeLow (at or below entire entry zone)
        limitEntryPrice = entryRangeLow;
      }
    } else {
      if (livePrice === null || livePrice < entryRangeLow) {
        // Price is below entry zone: proximal boundary is entryRangeLow (resting sell limit above market)
        limitEntryPrice = entryRangeLow;
      } else if (livePrice >= entryRangeLow && livePrice < entryRangeHigh) {
        // Price has already penetrated into the zone: distal boundary is entryRangeHigh (resting sell limit above market)
        limitEntryPrice = entryRangeHigh;
      } else {
        // Price is already >= entryRangeHigh (at or above entire entry zone)
        limitEntryPrice = entryRangeHigh;
      }
    }
  } else if (entryRangeHigh !== null) {
    limitEntryPrice = entryRangeHigh;
  } else if (entryRangeLow !== null) {
    limitEntryPrice = entryRangeLow;
  } else if (livePrice !== null && !isNaN(livePrice)) {
    // If no entry range is provided, place limit slightly past market to enforce resting maker execution
    limitEntryPrice = isLong ? livePrice * 0.999 : livePrice * 1.001;
  }

  // Invalidation level serves as Stop Loss. Sanity-check directional orientation.
  let stopLossPrice = invalidationLevel !== null && !isNaN(invalidationLevel) ? invalidationLevel : null;
  if (limitEntryPrice !== null) {
    if (stopLossPrice === null) {
      stopLossPrice = isLong ? limitEntryPrice * 0.995 : limitEntryPrice * 1.005;
    } else if (isLong && stopLossPrice >= limitEntryPrice) {
      // Inverted stop loss for Long: must be below entry
      stopLossPrice = limitEntryPrice * 0.995;
    } else if (!isLong && stopLossPrice <= limitEntryPrice) {
      // Inverted stop loss for Short: must be above entry
      stopLossPrice = limitEntryPrice * 1.005;
    }
  }

  // Targets: ensure correct directional orientation vs entry
  let stage1Target = target1 !== null && !isNaN(target1) ? target1 : null;
  let stage2Target = target2 !== null && !isNaN(target2) ? target2 : null;

  if (limitEntryPrice !== null && stopLossPrice !== null) {
    const riskDist = Math.max(Math.abs(limitEntryPrice - stopLossPrice), limitEntryPrice * 0.0015);
    if (isLong) {
      if (stage1Target === null || stage1Target <= limitEntryPrice) {
        stage1Target = limitEntryPrice + riskDist * 1.0;
      }
      if (stage2Target === null || stage2Target <= stage1Target) {
        stage2Target = limitEntryPrice + riskDist * 1.5;
      }
    } else {
      if (stage1Target === null || stage1Target >= limitEntryPrice) {
        stage1Target = limitEntryPrice - riskDist * 1.0;
      }
      if (stage2Target === null || stage2Target >= stage1Target) {
        stage2Target = limitEntryPrice - riskDist * 1.5;
      }
    }
  }

  // Pre-queue Invalidation Breach & Missed Target Check
  let isInvalidatedPriorToQueue = false;
  let invalidationReason: string | undefined = undefined;

  if (
    livePrice !== null &&
    !isNaN(livePrice) &&
    direction !== null
  ) {
    // 1. Direct Stop Loss / Invalidation breach check (inclusive of touch level)
    if (invalidationLevel !== null && !isNaN(invalidationLevel)) {
      if (isLong && livePrice <= invalidationLevel) {
        isInvalidatedPriorToQueue = true;
        invalidationReason = `Live price ($${livePrice}) breached or touched invalidation level ($${invalidationLevel})`;
      } else if (!isLong && livePrice >= invalidationLevel) {
        isInvalidatedPriorToQueue = true;
        invalidationReason = `Live price ($${livePrice}) breached or touched invalidation level ($${invalidationLevel})`;
      }
    }

    // 2. Auxiliary invalidation checker
    if (!isInvalidatedPriorToQueue && invalidationLevel !== null && !isNaN(invalidationLevel)) {
      const invCheck = runInvalidationCheck(
        invalidationLevel,
        livePrice,
        biasSignal,
        target1,
        entryRangeLow,
        entryRangeHigh,
        target2
      );
      if (invCheck.breached) {
        isInvalidatedPriorToQueue = true;
        invalidationReason = `Invalidation check failed (${invCheck.breach_direction})`;
      }
    }

    // 3. Missed Expansion / TP1 Reached Prior to Queue (Directive 08 Invariant 4)
    if (!isInvalidatedPriorToQueue && stage1Target !== null && !isNaN(stage1Target)) {
      if (isLong && livePrice >= stage1Target) {
        isInvalidatedPriorToQueue = true;
        invalidationReason = `Target 1 ($${stage1Target}) already reached prior to queueing (missed expansion)`;
      } else if (!isLong && livePrice <= stage1Target) {
        isInvalidatedPriorToQueue = true;
        invalidationReason = `Target 1 ($${stage1Target}) already reached prior to queueing (missed expansion)`;
      }
    }
  }

  return {
    id,
    symbol,
    agentId,
    direction,
    limitEntryPrice,
    stopLossPrice,
    stage1Target,
    stage2Target,
    entryRangeLow,
    entryRangeHigh,
    invalidationLevel,
    biasSignal,
    isInvalidatedPriorToQueue,
    invalidationReason,
    rawRecord: record,
  };
}

export class SparkIngestionDispatcher {
  private engine: AutomatedStrategyExecutionEngine;
  private getCurrentPrice: (symbol: string) => number | null;
  private pollIntervalMs: number;
  private telegram?: TelegramNotifier | TelegramBotService;
  private ledger?: DaemonLedger;
  private allowOfflineFallback: boolean;
  private userEmail: string;
  private getRiskSettingsCallback?: () => Partial<ActiveRiskSettings> | Promise<Partial<ActiveRiskSettings>>;
  private stageOnly: boolean;
  private executionMode: TriStateExecutionMode = 'STANDBY';
  private cliMode?: TriStateExecutionMode;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private isRunning = false;
  private hasWarnedDbOffline = false;

  constructor(options: SparkIngestionDispatcherOptions) {
    this.engine = options.engine;
    this.getCurrentPrice = options.getCurrentPrice;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.telegram = options.telegram;
    this.ledger = options.ledger;
    this.allowOfflineFallback = options.allowOfflineFallback ?? false;
    this.userEmail = options.userEmail || 'institutional_admin';
    this.getRiskSettingsCallback = options.getRiskSettings;
    this.stageOnly = options.stageOnly ?? false;
    this.cliMode = options.cliMode;
    if (options.executionMode) {
      this.executionMode = options.executionMode;
    }

    // Subscribe to engine events to synchronize agent_decision_log and ledger on Spark fills & closes
    this.engine.subscribe(async (event) => {
      const pos = event.position;
      if (!pos) return;
      const match = pos.strategyId?.match(/^SPARK_(\d+)$/) || pos.setupId?.match(/^spark_decision_(\d+)$/);
      if (!match) return;
      const decisionId = parseInt(match[1], 10);
      if (isNaN(decisionId)) return;

      const isPaper = pos.executionMode === 'PAPER_TRADING';

      if (event.type === 'ORDER_FILLED') {
        if (isPaper) {
          try {
            await sql`
              UPDATE agent_decision_log
              SET status = 'PAPER_FILLED',
                  narrative = COALESCE(narrative, '') || ' [SPARK_PAPER_FILLED: Maker fill @ $' || ${pos.entryPrice.toFixed(2)} || ']'
              WHERE id = ${decisionId} AND (status = 'PAPER_ACTIVE' OR status = 'STAGED' OR status = 'QUEUED')
            `;
          } catch {}
          this.ledger?.logEvent('SPARK_DECISION_PAPER_FILLED', `Paper order #${decisionId} filled at $${pos.entryPrice.toFixed(2)}`, {
            position: pos,
            metadata: { decisionId, fillPrice: pos.entryPrice },
          });
        }
      } else if (event.type === 'LIMIT_ORDER_CANCELLED') {
        const cancelReason = event.message || 'Cancelled';
        try {
          await sql`
            UPDATE agent_decision_log
            SET status = 'REJECTED',
                narrative = COALESCE(narrative, '') || ' [SPARK_ORDER_CANCELLED: ' || ${cancelReason} || ']'
            WHERE id = ${decisionId} AND (status = 'PAPER_ACTIVE' OR status = 'QUEUED' OR status = 'STAGED')
          `;
        } catch {}
        if (isPaper) {
          this.ledger?.logEvent('SPARK_DECISION_REJECTED', `Paper order #${decisionId} cancelled: ${cancelReason}`, {
            position: pos,
            metadata: { decisionId, cancelReason },
          });
        }
      } else if (event.type === 'STAGE_1_HARVEST') {
        const s1Price = pos.stage1Target ? `$${pos.stage1Target.toFixed(2)}` : 'Target';
        const s1Narrative = ` [SPARK_TP1_HARVEST: Stage 1 filled @ ${s1Price}, SL ratcheted to $${pos.activeStopLoss.toFixed(2)}]`;
        try {
          await sql`
            UPDATE agent_decision_log
            SET narrative = COALESCE(narrative, '') || ${s1Narrative}
            WHERE id = ${decisionId}
          `;
        } catch {}
        if (isPaper) {
          this.ledger?.logEvent('SPARK_DECISION_TP1_HARVEST', `Paper order #${decisionId} harvested TP1 at ${s1Price}`, {
            position: pos,
            metadata: { decisionId, stage1Target: pos.stage1Target, newStopLoss: pos.activeStopLoss },
          });
        }
      } else if (event.type === 'POSITION_CLOSED') {
        const nextStatus = isPaper ? 'PAPER_CLOSED' : 'EXECUTED';
        const sign = (pos.realizedR || 0) >= 0 ? '+' : '';
        const closeNarrative = ` [SPARK_${pos.executionMode || 'TRADE'}_CLOSED: ${pos.exitReason || 'CLOSED'} @ $${(pos.exitPrice || pos.activeStopLoss).toFixed(2)}, R=${sign}${(pos.realizedR || 0).toFixed(2)}R]`;
        try {
          await sql`
            UPDATE agent_decision_log
            SET status = ${nextStatus},
                narrative = COALESCE(narrative, '') || ${closeNarrative}
            WHERE id = ${decisionId}
          `;
        } catch {}
        if (isPaper) {
          this.ledger?.logEvent('SPARK_DECISION_PAPER_CLOSED', `Paper trade #${decisionId} closed (${pos.exitReason}) at $${(pos.exitPrice || pos.activeStopLoss).toFixed(2)} (${sign}${(pos.realizedR || 0).toFixed(2)}R)`, {
            position: pos,
            metadata: { decisionId, exitReason: pos.exitReason, realizedR: pos.realizedR, realizedUsd: pos.realizedUsd },
          });
        }
      }
    });
  }

  /**
   * Sets the active Tri-State execution mode dynamically at runtime.
   */
  public setExecutionMode(mode: TriStateExecutionMode): void {
    this.executionMode = mode;
    console.log(`[SPARK_DISPATCHER] 🔀 Active execution mode set to: ${mode}`);
  }

  /**
   * Returns currently resolved Tri-State execution mode.
   */
  public getExecutionMode(): TriStateExecutionMode {
    return this.resolveExecutionMode();
  }

  /**
   * Dynamically resolves active Tri-State execution mode from:
   * 1. Explicit modeOverride parameter (if provided)
   * 2. CLI arguments (--mode=standby|paper|live)
   * 3. Configured executionMode on dispatcher instance (if non-default)
   * 4. daemon_live_settings.json (executionMode or mode)
   * 5. Environment variables (EXECUTION_MODE or SPARK_EXECUTION_MODE)
   * 6. Default fallback: 'STANDBY'
   */
  public resolveExecutionMode(modeOverride?: TriStateExecutionMode): TriStateExecutionMode {
    if (modeOverride) return modeOverride;

    // 1. Explicit CLI override if captured
    if (this.cliMode) return this.cliMode;
    try {
      if (typeof process !== 'undefined' && process.argv) {
        const modeArg = process.argv.find((a) => a.startsWith('--mode='))?.split('=')[1];
        const parsedCli = normalizeExecutionMode(modeArg);
        if (parsedCli) return parsedCli;
      }
    } catch {}

    // 2. Persisted daemon live settings (hot-reloaded from UI or disk)
    try {
      const liveSettingsFile = path.join(process.cwd(), 'run_logs', 'daemon_live_settings.json');
      if (fs.existsSync(liveSettingsFile)) {
        const persisted = JSON.parse(fs.readFileSync(liveSettingsFile, 'utf8'));
        const persistedMode = normalizeExecutionMode(persisted.executionMode || persisted.mode);
        if (persistedMode) return persistedMode;
      }
    } catch {}

    // 3. Environment variables
    try {
      if (typeof process !== 'undefined' && process.env) {
        const envMode = normalizeExecutionMode(process.env.EXECUTION_MODE || process.env.SPARK_EXECUTION_MODE);
        if (envMode) return envMode;
      }
    } catch {}

    // 4. Configured instance value or fallback
    return this.executionMode || 'STANDBY';
  }

  /**
   * Dynamically hydrates active risk parameters from:
   * 1. Custom callback (if provided)
   * 2. daemon_live_settings.json (if present)
   * 3. GlobalRiskGovernor / PostgreSQL
   * 4. Engine configuration defaults
   *
   * Automatically synchronizes the execution engine without requiring a process restart.
   */
  public async getActiveRiskParameters(): Promise<ActiveRiskSettings> {
    let customSettings: Partial<ActiveRiskSettings> = {};
    if (this.getRiskSettingsCallback) {
      try {
        customSettings = (await this.getRiskSettingsCallback()) || {};
      } catch (err) {
        console.warn('[SPARK_DISPATCHER] Warning calling getRiskSettings callback:', err);
      }
    }

    let persistedLiveSettings: any = {};
    try {
      const liveSettingsFile = path.join(process.cwd(), 'run_logs', 'daemon_live_settings.json');
      if (fs.existsSync(liveSettingsFile)) {
        persistedLiveSettings = JSON.parse(fs.readFileSync(liveSettingsFile, 'utf8'));
      }
    } catch {}

    let riskGovConfig: RiskGovernorConfig | null = null;
    let riskGovState: RiskGovernorState | null = null;
    try {
      const hydrated = await GlobalRiskGovernor.hydrateState(this.userEmail);
      riskGovConfig = hydrated.config;
      riskGovState = hydrated.state;
    } catch {
      riskGovConfig = GlobalRiskGovernor.getConfig();
      riskGovState = GlobalRiskGovernor.getState();
    }

    const compoundingRiskPct =
      customSettings.compoundingRiskPct ??
      persistedLiveSettings.compoundingRiskPct ??
      riskGovConfig?.risk_per_trade_pct ??
      this.engine.config.compoundingRiskPct ??
      2.0;

    const maxOpenPositions =
      customSettings.maxOpenPositions ??
      persistedLiveSettings.maxOpenPositions ??
      this.engine.config.maxOpenPositions ??
      1;

    let accountEquity: number = 1000.0;
    if (typeof customSettings.accountEquity === 'number' && customSettings.accountEquity > 0) {
      accountEquity = customSettings.accountEquity;
    } else if (typeof persistedLiveSettings.accountEquity === 'number' && persistedLiveSettings.accountEquity > 0) {
      accountEquity = persistedLiveSettings.accountEquity;
    } else if (riskGovState && riskGovState.current_balance > 0) {
      accountEquity = riskGovState.current_balance;
    } else {
      const engineEq = this.engine.getAccountEquity();
      accountEquity = engineEq > 0 ? engineEq : 1000.0;
    }

    const emergencyEquityFloor =
      customSettings.emergencyEquityFloor ??
      persistedLiveSettings.emergencyEquityFloor ??
      riskGovConfig?.emergency_equity_floor ??
      0;

    // Hot-reload onto the engine instance to keep engine and dispatcher 100% in sync
    if (this.engine.config.compoundingRiskPct !== compoundingRiskPct) {
      this.engine.updateConfig({ compoundingRiskPct });
    }
    if (this.engine.config.maxOpenPositions !== maxOpenPositions) {
      this.engine.updateConfig({ maxOpenPositions });
    }
    if (Math.abs(this.engine.getAccountEquity() - accountEquity) > 0.01) {
      this.engine.setAccountEquity(accountEquity);
    }

    return {
      compoundingRiskPct,
      maxOpenPositions,
      accountEquity,
      emergencyEquityFloor,
    };
  }

  /**
   * Arm the background poller loop.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(
      `[SPARK_DISPATCHER] 🟢 Spark Inbound Ingestion Dispatcher armed (polling every ${this.pollIntervalMs}ms for 'ACTIVE' decisions on ${this.engine.config.symbol}).`
    );

    // Initial immediate poll
    this.pollOnce().catch(() => {});

    this.intervalTimer = setInterval(() => {
      this.pollOnce().catch(() => {});
    }, this.pollIntervalMs);
  }

  /**
   * Stop the background poller loop cleanly.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    console.log(`[SPARK_DISPATCHER] 🛑 Spark Inbound Ingestion Dispatcher stopped.`);
  }

  /**
   * Executes a single polling iteration.
   * Can be invoked directly in unit tests or by the interval timer.
   */
  public async pollOnce(): Promise<number> {
    if (this.isPolling) return 0;
    this.isPolling = true;
    let processedCount = 0;

    try {
      await ensureAgentDecisionTableInitialized();
      const symbol = this.engine.config.symbol;
      const baseAsset = symbol.replace(/USDC|USDT/g, '');

      const result = await sql`
        SELECT id, symbol, agent_id, bias_signal, entry_range_low, entry_range_high,
               invalidation_level, target_1, target_2, narrative, status,
               live_price_at_submission, submitted_at, invalidated_at
        FROM agent_decision_log
        WHERE (status = 'ACTIVE' OR status = 'QUEUED') 
          AND (
            UPPER(REPLACE(REPLACE(symbol, '-', ''), '/', '')) = ${symbol.toUpperCase()}
            OR UPPER(symbol) = ${baseAsset.toUpperCase()}
          )
        ORDER BY submitted_at ASC
        LIMIT 5
      `;

      for (const row of result.rows) {
        await this.processDecision(row);
        processedCount++;
      }
    } catch (err: any) {
      if (!this.hasWarnedDbOffline) {
        console.warn(
          `[SPARK_DISPATCHER] Polling notice (database offline or table not ready): ${err?.message || err}`
        );
        this.hasWarnedDbOffline = true;
      }
    } finally {
      this.isPolling = false;
    }

    return processedCount;
  }

  /**
   * Ingests, validates, queues, and dispatches a single decision record.
   * Accepts an optional `livePriceOverride` for deterministic testing.
   */
  public async processDecision(
    record: any,
    livePriceOverride?: number,
    options?: { stageOnly?: boolean; modeOverride?: TriStateExecutionMode }
  ): Promise<ProcessDecisionResult> {
    const id = Number(record.id);

    // 1. Determine current live price
    let livePrice = livePriceOverride ?? this.getCurrentPrice(record.symbol);
    if (livePrice === null || isNaN(livePrice) || livePrice <= 0) {
      try {
        livePrice = await fetchLivePrice(record.symbol);
      } catch {
        livePrice = null;
      }
    }

    // 2. Parse record
    const parsed = parseSparkDecision(record, livePrice);

    // 3. Invalidation Pre-Flight Gate: Check if setup reached invalidation before queueing
    if (parsed.isInvalidatedPriorToQueue) {
      const now = Date.now();
      const breachReason = parsed.invalidationReason || 'Breached invalidation level prior to queueing';
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'INVALIDATED',
              invalidated_at = ${now},
              narrative = COALESCE(narrative, '') || ' [SPARK_DISPATCHER: ' || ${breachReason} || ']'
          WHERE id = ${id} AND (status = 'ACTIVE' OR status = 'QUEUED')
        `;
      } catch (err: any) {
        console.warn(`[SPARK_DISPATCHER] Could not update status for invalidated record #${id}:`, err?.message || err);
      }

      const msg = `Decision #${id} reached invalidation or target (${breachReason}) before queueing (Live Price: $${livePrice}). Marked as INVALIDATED. Standing down.`;
      console.warn(`[SPARK_DISPATCHER] 🛑 ${msg}`);
      this.ledger?.logEvent('SPARK_DECISION_INVALIDATED', msg, {
        livePrice: livePrice ?? undefined,
        metadata: {
          decisionId: id,
          invalidationLevel: parsed.invalidationLevel,
          reason: breachReason,
        },
      });

      return {
        status: 'INVALIDATED',
        reason: breachReason,
        parsed,
      };
    }

    // 3.5 Symbol Mismatch Check: Daemon engine is pinned to a specific asset
    if (parsed.symbol !== this.engine.config.symbol) {
      const msg = `Decision #${id} symbol (${parsed.symbol}) does not match engine symbol (${this.engine.config.symbol}). Standing down.`;
      console.log(`[SPARK_DISPATCHER] ⚪ ${msg}`);
      this.ledger?.logEvent('SPARK_DECISION_STAND_DOWN', msg, {
        livePrice: livePrice ?? undefined,
        metadata: {
          decisionId: id,
          decisionSymbol: parsed.symbol,
          engineSymbol: this.engine.config.symbol,
        },
      });
      return {
        status: 'STAND_DOWN',
        reason: `Symbol mismatch: ${parsed.symbol} != ${this.engine.config.symbol}`,
        parsed,
      };
    }

    // 4. Non-Directional Check (NEUTRAL / ABORT / STAND_DOWN)
    if (!parsed.direction) {
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'STAND_DOWN',
              narrative = COALESCE(narrative, '') || ' [SPARK_DISPATCHER: Non-directional bias signal (' || ${parsed.biasSignal} || '). Standing down.]'
          WHERE id = ${id} AND (status = 'ACTIVE' OR status = 'QUEUED')
        `;
      } catch (err: any) {
        console.warn(`[SPARK_DISPATCHER] Could not update status for stand-down record #${id}:`, err?.message || err);
      }

      const msg = `Decision #${id} has non-directional bias (${parsed.biasSignal}). Standing down.`;
      console.log(`[SPARK_DISPATCHER] ⚪ ${msg}`);
      this.ledger?.logEvent('SPARK_DECISION_STAND_DOWN', msg, {
        livePrice: livePrice ?? undefined,
        metadata: {
          decisionId: id,
          biasSignal: parsed.biasSignal,
        },
      });
      return {
        status: 'STAND_DOWN',
        reason: `Non-directional bias: ${parsed.biasSignal}`,
        parsed,
      };
    }

    // 5. Atomic Queue Claim: Flag record as 'QUEUED' to prevent duplicate execution loops
    let claimSuccessful = false;
    if (record.status === 'QUEUED') {
      claimSuccessful = true;
    } else {
      try {
        const claimRes = await sql`
          UPDATE agent_decision_log
          SET status = 'QUEUED'
          WHERE id = ${id} AND status = 'ACTIVE'
          RETURNING id
        `;
        claimSuccessful = claimRes.rows.length > 0;
      } catch (err: any) {
        console.warn(`[SPARK_DISPATCHER] DB error claiming record #${id} as QUEUED:`, err?.message || err);
        // If DB update fails (e.g. read-only local sandbox or offline testing), allow pipeline to proceed if permitted
        if (this.allowOfflineFallback || livePriceOverride !== undefined) {
          claimSuccessful = true;
        }
      }
    }

    if (!claimSuccessful) {
      return {
        status: 'ALREADY_CLAIMED',
        reason: 'Record was already claimed or updated concurrently',
        parsed,
      };
    }

    console.log(
      `[SPARK_DISPATCHER] 📥 Decision #${id} (${parsed.symbol} ${parsed.direction}) flagged as QUEUED. Handing over to pre-trade validation pipeline...`
    );

    // 6. Validate price levels prior to order submission
    if (
      parsed.limitEntryPrice === null ||
      parsed.stopLossPrice === null ||
      isNaN(parsed.limitEntryPrice) ||
      isNaN(parsed.stopLossPrice)
    ) {
      const rejectReason = 'Missing or invalid limit entry price or stop loss';
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'REJECTED',
              narrative = COALESCE(narrative, '') || ' [SPARK_DISPATCHER: ' || ${rejectReason} || ']'
          WHERE id = ${id}
        `;
      } catch {}

      return {
        status: 'REJECTED',
        reason: rejectReason,
        parsed,
      };
    }

    // 7. Dynamic Risk Parameter Hydration (account equity, compounding risk %, max open positions)
    const activeRisk = await this.getActiveRiskParameters();

    // 8. Dynamic Position Sizing & Anti-Micro-Friction Clamp (0.15% floor)
    const sizing = calculateSparkPositionSizing({
      accountEquity: activeRisk.accountEquity,
      compoundingRiskPct: activeRisk.compoundingRiskPct,
      entryPrice: parsed.limitEntryPrice,
      invalidationLevel: parsed.stopLossPrice,
      direction: parsed.direction,
      lotPrecision: this.engine.config.lotPrecision ?? 3,
      minLotSize: this.engine.config.minLotSize ?? 0.001,
      maxLotSize: this.engine.config.maxLotSize ?? 100.0,
    });

    if (!sizing.isValid) {
      const rejectReason = sizing.error || 'Position sizing calculation failed';
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'REJECTED',
              narrative = COALESCE(narrative, '') || ' [SPARK_DISPATCHER SIZING ERROR: ' || ${rejectReason} || ']'
          WHERE id = ${id}
        `;
      } catch {}

      return {
        status: 'REJECTED',
        reason: rejectReason,
        parsed,
        sizing,
      };
    }

    // Attach computed position size, dollar risk, clamped SL parameters, and leverage to decision payload
    parsed.rawStopLossPrice = parsed.stopLossPrice;
    parsed.clampedStopLossPrice = sizing.clampedStopLoss;
    parsed.clampedStopDistance = sizing.clampedStopDistance;
    parsed.positionSize = sizing.contractSize;
    parsed.dollarRisk = sizing.dollarRisk;
    parsed.riskPct = sizing.compoundingRiskPct;
    parsed.effectiveLeverage = sizing.effectiveLeverage;
    parsed.stopLossPrice = sizing.clampedStopLoss;

    // 9. Global Risk Governor Pre-Flight Gatekeeper
    const normalizeSym = (s: string) => {
      const clean = String(s || '').trim().toUpperCase().replace(/[-_/]/g, '');
      if (clean === 'ETH') return 'ETHUSDC';
      if (clean === 'BTC') return 'BTCUSDC';
      return clean;
    };
    const activePositionsForSymbol = this.engine
      .getActivePositions()
      .filter((p) => normalizeSym(p.symbol) === normalizeSym(parsed.symbol)).length;

    const lastLossTs = typeof this.engine.getLastLossClosedTimestamp === 'function'
      ? this.engine.getLastLossClosedTimestamp()
      : ((this.engine as any).lastLossClosedTimestamp || 0);

    const riskAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
      symbol: parsed.symbol,
      direction: parsed.direction,
      entryPrice: parsed.limitEntryPrice,
      stopLossPrice: sizing.clampedStopLoss,
      currentEquity: activeRisk.accountEquity,
      currentOpenPositionsCount: activePositionsForSymbol,
      maxOpenPositions: activeRisk.maxOpenPositions,
      emergencyEquityFloor: activeRisk.emergencyEquityFloor,
      lastLossTimestamp: lastLossTs,
      cooldownMinutes: this.engine.config.postLossCooldownMinutes ?? 45,
      userEmail: this.userEmail,
    });

    // 10. Check Global Risk Governor Gatekeeper
    if (!riskAssessment.isApproved) {
      const vetoReason = riskAssessment.reason || 'Vetoed by Global Risk Governor';
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'REJECTED_BY_RISK_GOVERNOR',
              narrative = COALESCE(narrative, '') || ' [VETO_RISK_GOVERNOR: ' || ${vetoReason} || ']'
          WHERE id = ${id}
        `;
      } catch (err: any) {
        console.warn(`[SPARK_DISPATCHER] Could not update record #${id} to REJECTED_BY_RISK_GOVERNOR:`, err?.message || err);
      }

      console.warn(`[SPARK_DISPATCHER] 🛡️ Decision #${id} rejected by Global Risk Governor: ${vetoReason}`);

      this.ledger?.logEvent('SPARK_DECISION_REJECTED', `Decision #${id} rejected by Risk Governor: ${vetoReason}`, {
        livePrice: livePrice ?? undefined,
        metadata: {
          decisionId: id,
          violationTier: riskAssessment.violationTier,
          reason: vetoReason,
          sizing,
        },
      });

      return {
        status: 'REJECTED_BY_RISK_GOVERNOR',
        reason: vetoReason,
        parsed,
        riskAssessment,
        sizing,
      };
    }

    // 11. Passed all Risk Governor checks -> Transition status to 'STAGED'
    const stageNarrative = ` [STAGED: Size=${sizing.contractSize} ${parsed.symbol}, Risk=$${sizing.dollarRisk} (${sizing.compoundingRiskPct}%), ClampedSL=$${sizing.clampedStopLoss}, Lev=${sizing.effectiveLeverage}x]`;
    try {
      await sql`
        UPDATE agent_decision_log
        SET status = 'STAGED',
            narrative = COALESCE(narrative, '') || ${stageNarrative}
        WHERE id = ${id}
      `;
    } catch (err: any) {
      console.warn(`[SPARK_DISPATCHER] Could not update record #${id} to STAGED:`, err?.message || err);
    }

    console.log(
      `[SPARK_DISPATCHER] 📋 Decision #${id} passed Risk Governor -> STAGED (${sizing.contractSize} contracts, $${sizing.dollarRisk} Risk, ${sizing.effectiveLeverage}x Lev).`
    );

    this.ledger?.logEvent('SPARK_DECISION_STAGED', `Decision #${id} staged for execution`, {
      livePrice: livePrice ?? undefined,
      metadata: {
        decisionId: id,
        sizing,
        riskAssessment,
      },
    });

    const activeMode = this.resolveExecutionMode(options?.modeOverride);

    // 📡 Telegram Milestone 1: Signal Received (Intake)
    if (this.telegram) {
      const signalEventKey = `evt_SPARK_SIGNAL_${parsed.symbol}_${parsed.id}`;
      this.telegram
        .broadcastSparkMilestone(
          'SIGNAL_RECEIVED',
          {
            id: parsed.id,
            decisionId: parsed.id,
            symbol: parsed.symbol,
            direction: parsed.direction,
            entryRangeLow: parsed.entryRangeLow,
            entryRangeHigh: parsed.entryRangeHigh,
            limitEntryPrice: parsed.limitEntryPrice,
            invalidationLevel: sizing.clampedStopLoss,
            target1: parsed.stage1Target,
            target2: parsed.stage2Target,
            riskUsd: sizing.dollarRisk,
            riskPct: sizing.compoundingRiskPct,
            contractSize: sizing.contractSize,
            narrative: parsed.rawRecord?.narrative,
            timestamp: Date.now(),
            mode: activeMode,
          },
          { eventKey: signalEventKey }
        )
        .catch((err) =>
          console.warn('[SPARK_DISPATCHER] Telegram signal received alert warning:', err?.message || err)
        );
    }

    const isStageOnly = options?.stageOnly ?? this.stageOnly;
    if (isStageOnly) {
      return {
        status: 'STAGED',
        executionMode: activeMode,
        reason: 'Passed Risk Governor and successfully staged',
        parsed,
        riskAssessment,
        sizing,
      };
    }

    // 12. Tri-State Execution Mode Routing (STANDBY / PAPER_TRADING / LIVE_BINANCE)
    console.log(`[SPARK_DISPATCHER] 🔀 Routing Decision #${id} to execution mode: ${activeMode}`);

    // ── Mode 1: STANDBY (Logged in DB, visible in UI Cockpit, 0 orders/margin) ──
    if (activeMode === 'STANDBY') {
      const standbyNarrative = ` [ROUTED: STANDBY (Logged to UI Cockpit, no orders queued or margin committed)]`;
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'LOGGED_STANDBY',
              narrative = COALESCE(narrative, '') || ${standbyNarrative}
          WHERE id = ${id}
        `;
      } catch (err: any) {
        console.warn(`[SPARK_DISPATCHER] DB update error for STANDBY record #${id}:`, err?.message || err);
      }

      console.log(`[SPARK_DISPATCHER] 🏛️ Decision #${id} logged to STANDBY (Confluence boost visible in UI, zero margin committed).`);
      this.ledger?.logEvent('SPARK_DECISION_STANDBY', `Decision #${id} logged to STANDBY mode`, {
        livePrice: livePrice ?? undefined,
        metadata: { decisionId: id, sizing, riskAssessment },
      });

      return {
        status: 'LOGGED_STANDBY',
        executionMode: 'STANDBY',
        reason: 'Decision routed to STANDBY mode (logged without order queueing)',
        parsed,
        riskAssessment,
        sizing,
      };
    }

    // ── Mode 2: PAPER_TRADING (In-Daemon Simulated Resting Limit & Bracket Lifecycle) ──
    if (activeMode === 'PAPER_TRADING') {
      const paperNarrative = ` [ROUTED: PAPER_TRADING (In-daemon simulated execution with 12-bar TTL)]`;
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'PAPER_ACTIVE',
              narrative = COALESCE(narrative, '') || ${paperNarrative}
          WHERE id = ${id}
        `;
      } catch (err: any) {
        console.warn(`[SPARK_DISPATCHER] DB update error for PAPER_TRADING record #${id}:`, err?.message || err);
      }

      const submitRes = this.engine.submitStrategyOrder({
        strategyId: `SPARK_${id}`,
        strategyName: `Spark Quant Decision #${id} (${parsed.agentId})`,
        symbol: parsed.symbol,
        timeframe: '5m',
        direction: parsed.direction,
        limitEntryPrice: parseFloat(parsed.limitEntryPrice.toFixed(4)),
        stopLossPrice: parseFloat(sizing.clampedStopLoss.toFixed(4)),
        stage1Target: parsed.stage1Target ? parseFloat(parsed.stage1Target.toFixed(4)) : undefined,
        stage2Target: parsed.stage2Target ? parseFloat(parsed.stage2Target.toFixed(4)) : undefined,
        currentMarketPrice: livePrice ?? undefined,
        activeEquity: activeRisk.accountEquity,
        overrideRiskPct: activeRisk.compoundingRiskPct,
        setupId: `spark_decision_${id}`,
        anchorName: `Spark Decision (${parsed.agentId})`,
        originZoneId: `spark_zone_${id}`,
        originAnchorLevel: parsed.limitEntryPrice,
        executionMode: 'PAPER_TRADING',
        maxRetestBars: 12,
        bypassWeekendFilter: true,
      });

      if (submitRes.success) {
        console.log(`[SPARK_DISPATCHER] 🧪 Decision #${id} queued in PAPER_TRADING simulator (12-bar TTL)!`);
        this.ledger?.logEvent('SPARK_DECISION_PAPER_QUEUED', `Decision #${id} queued in Paper Trading Simulator`, {
          livePrice: livePrice ?? undefined,
          position: submitRes.position,
          metadata: { decisionId: id, sizing },
        });

        // 📡 Telegram Milestone 2: Order Armed (PAPER TRADING)
        if (this.telegram) {
          const armedEventKey = submitRes.position?.id ? `evt_${submitRes.position.id}_LIMIT_ORDER_PLACED` : undefined;
          this.telegram
            .broadcastSparkMilestone('ORDER_ARMED', {
              mode: 'PAPER_TRADING',
              symbol: parsed.symbol,
              direction: parsed.direction,
              limitEntryPrice: parsed.limitEntryPrice,
              stopLossPrice: sizing.clampedStopLoss,
              contractSize: sizing.contractSize,
              notionalValue: sizing.notionalValue,
              riskUsd: sizing.dollarRisk,
              riskPct: sizing.compoundingRiskPct,
              ttlBars: 12,
              timestamp: Date.now(),
            }, { eventKey: armedEventKey })
            .catch(() => {});
        }

        return {
          status: 'PAPER_ACTIVE',
          executionMode: 'PAPER_TRADING',
          position: submitRes.position,
          parsed,
          riskAssessment,
          sizing,
        };
      } else {
        const rejectReason = submitRes.message || 'Paper trading queue submission vetoed';
        try {
          await sql`
            UPDATE agent_decision_log
            SET status = 'REJECTED',
                narrative = COALESCE(narrative, '') || ' [SPARK_PAPER_VETO: ' || ${rejectReason} || ']'
            WHERE id = ${id}
          `;
        } catch {}

        this.ledger?.logEvent('SPARK_DECISION_REJECTED', `Paper submission rejected: ${rejectReason}`, {
          livePrice: livePrice ?? undefined,
          metadata: { decisionId: id, reason: rejectReason, sizing },
        });

        return {
          status: 'REJECTED',
          executionMode: 'PAPER_TRADING',
          reason: rejectReason,
          parsed,
          riskAssessment,
          sizing,
        };
      }
    }

    // ── Mode 3: LIVE_BINANCE (Guarded with Physical Environment Isolation & VPS-Only Checks) ──
    if (activeMode === 'LIVE_BINANCE') {
      const safetyGate = evaluateExecutionSafetyGate('LIVE_BINANCE');
      if (!safetyGate.isAllowed) {
        const vetoReason = `LIVE_BINANCE execution physically blocked outside verified production VPS: ${safetyGate.reason}`;
        console.warn(`[SPARK_DISPATCHER] 🛡️ ${vetoReason}`);
        try {
          await sql`
            UPDATE agent_decision_log
            SET status = 'REJECTED',
                narrative = COALESCE(narrative, '') || ' [ENVIRONMENT_ISOLATION_VETO: ' || ${vetoReason} || ']'
            WHERE id = ${id}
          `;
        } catch {}

        this.ledger?.logEvent('SPARK_DECISION_REJECTED', vetoReason, {
          livePrice: livePrice ?? undefined,
          metadata: { decisionId: id, safetyGate, reason: vetoReason },
        });

        return {
          status: 'REJECTED',
          executionMode: 'LIVE_BINANCE',
          reason: vetoReason,
          parsed,
          riskAssessment,
          sizing,
        };
      }

      // Pre-flight exchange sanity checks (symbol precision, min notional, valid stop distance)
      const submitRes = this.engine.submitStrategyOrder({
        strategyId: `SPARK_${id}`,
        strategyName: `Spark Quant Decision #${id} (${parsed.agentId})`,
        symbol: parsed.symbol,
        timeframe: '5m',
        direction: parsed.direction,
        limitEntryPrice: parseFloat(parsed.limitEntryPrice.toFixed(4)),
        stopLossPrice: parseFloat(sizing.clampedStopLoss.toFixed(4)),
        stage1Target: parsed.stage1Target ? parseFloat(parsed.stage1Target.toFixed(4)) : undefined,
        stage2Target: parsed.stage2Target ? parseFloat(parsed.stage2Target.toFixed(4)) : undefined,
        currentMarketPrice: livePrice ?? undefined,
        activeEquity: activeRisk.accountEquity,
        overrideRiskPct: activeRisk.compoundingRiskPct,
        setupId: `spark_decision_${id}`,
        anchorName: `Spark Decision (${parsed.agentId})`,
        originZoneId: `spark_zone_${id}`,
        originAnchorLevel: parsed.limitEntryPrice,
        executionMode: 'LIVE_BINANCE',
        maxRetestBars: 12,
        bypassWeekendFilter: true,
      });

      if (submitRes.success) {
        try {
          await sql`
            UPDATE agent_decision_log
            SET status = 'EXECUTED',
                narrative = COALESCE(narrative, '') || ' [SPARK_DISPATCHER: Submitted to LIVE Binance execution queue]'
            WHERE id = ${id}
          `;
        } catch (err: any) {
          console.warn(`[SPARK_DISPATCHER] Could not update record #${id} to EXECUTED:`, err?.message || err);
        }

        console.log(`[SPARK_DISPATCHER] 🚀 Decision #${id} submitted to LIVE Binance execution queue!`);
        this.ledger?.logEvent('SPARK_DECISION_EXECUTED', `Decision #${id} accepted into LIVE execution queue`, {
          livePrice: livePrice ?? undefined,
          position: submitRes.position,
          metadata: { decisionId: id, sizing },
        });

        // 📡 Telegram Milestone 2: Order Armed (LIVE BINANCE)
        if (this.telegram) {
          const armedEventKey = submitRes.position?.id ? `evt_${submitRes.position.id}_LIMIT_ORDER_PLACED` : undefined;
          this.telegram
            .broadcastSparkMilestone('ORDER_ARMED', {
              mode: 'LIVE_BINANCE',
              symbol: parsed.symbol,
              direction: parsed.direction,
              limitEntryPrice: parsed.limitEntryPrice,
              stopLossPrice: sizing.clampedStopLoss,
              contractSize: sizing.contractSize,
              notionalValue: sizing.notionalValue,
              riskUsd: sizing.dollarRisk,
              riskPct: sizing.compoundingRiskPct,
              ttlBars: 12,
              timestamp: Date.now(),
            }, { eventKey: armedEventKey })
            .catch(() => {});
        }

        return {
          status: 'EXECUTED',
          executionMode: 'LIVE_BINANCE',
          position: submitRes.position,
          parsed,
          riskAssessment,
          sizing,
        };
      } else {
        const rejectReason = submitRes.message || 'Live execution queue submission vetoed';
        try {
          await sql`
            UPDATE agent_decision_log
            SET status = 'REJECTED',
                narrative = COALESCE(narrative, '') || ' [SPARK_LIVE_VETO: ' || ${rejectReason} || ']'
            WHERE id = ${id}
          `;
        } catch {}

        this.ledger?.logEvent('SPARK_DECISION_REJECTED', `Live submission rejected: ${rejectReason}`, {
          livePrice: livePrice ?? undefined,
          metadata: { decisionId: id, reason: rejectReason, sizing },
        });

        return {
          status: 'REJECTED',
          executionMode: 'LIVE_BINANCE',
          reason: rejectReason,
          parsed,
          riskAssessment,
          sizing,
        };
      }
    }

    return {
      status: 'ERROR',
      reason: `Unknown execution mode: ${activeMode}`,
      parsed,
      riskAssessment,
      sizing,
    };
  }
}
