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
import {
  ProximityRadarEngine,
  ArmedIntent,
  DaemonStateMachineState,
  TriggerEvaluationResult,
  InvalidationEvaluationResult,
  ProximityEvaluationResult,
  CandleEvaluationOutput,
} from './proximityRadar';
import { Candle } from '../fvgEngine';

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
    | 'DUPLICATE_SUPPRESSED'
    | 'ALREADY_CLAIMED'
    | 'ARMED_WATCHING_TRIGGER'
    | 'ORDER_RESTING'
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

  const rawLimitEntry =
    record.limit_entry_price !== null && record.limit_entry_price !== undefined
      ? parseFloat(String(record.limit_entry_price))
      : null;

  if (rawLimitEntry !== null && !isNaN(rawLimitEntry) && rawLimitEntry > 0) {
    limitEntryPrice = rawLimitEntry;
  } else if (entryRangeLow !== null && entryRangeHigh !== null) {
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
  private radar: ProximityRadarEngine;

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
    this.radar = new ProximityRadarEngine();
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
        const intent = this.radar.getIntent(decisionId);
        if (intent) {
          intent.stage = 'IN_FLIGHT_STAGE_1';
          this.ledger?.setArmedIntents(this.radar.getAllIntents());
          this.ledger?.setDaemonState(this.getDaemonState());
        }
        if (isPaper) {
          try {
            await sql`
              UPDATE agent_decision_log
              SET status = 'PAPER_FILLED',
                  narrative = COALESCE(narrative, '') || ' [SPARK_PAPER_FILLED: Maker fill @ $' || ${pos.entryPrice.toFixed(2)} || ']',
                  updated_at = NOW()
              WHERE id = ${decisionId} AND (status = 'PAPER_ACTIVE' OR status = 'ARMED' OR status = 'STAGED' OR status = 'QUEUED' OR status = 'ORDER_RESTING')
            `;
          } catch {}
          this.ledger?.logEvent('SPARK_DECISION_PAPER_FILLED', `Paper order #${decisionId} filled at $${pos.entryPrice.toFixed(2)}`, {
            position: pos,
            metadata: { decisionId, fillPrice: pos.entryPrice },
          });
        } else {
          try {
            await sql`
              UPDATE agent_decision_log
              SET status = 'ACTIVE',
                  narrative = COALESCE(narrative, '') || ' [SPARK_LIVE_FILLED: Maker fill @ $' || ${pos.entryPrice.toFixed(2)} || ']',
                  updated_at = NOW()
              WHERE id = ${decisionId} AND (status = 'EXECUTED' OR status = 'ARMED' OR status = 'STAGED' OR status = 'QUEUED' OR status = 'ORDER_RESTING')
            `;
          } catch {}
          this.ledger?.logEvent('SPARK_DECISION_EXECUTED', `Live order #${decisionId} filled at $${pos.entryPrice.toFixed(2)}`, {
            position: pos,
            metadata: { decisionId, fillPrice: pos.entryPrice },
          });
        }
      } else if (event.type === 'LIMIT_ORDER_CANCELLED') {
        const cancelReason = event.message || 'Cancelled';
        const intent = this.radar.getIntent(decisionId);
        const isTtl =
          cancelReason.toLowerCase().includes('ttl') ||
          cancelReason.toLowerCase().includes('retest') ||
          cancelReason.toLowerCase().includes('expired');
        const nextStage = isTtl ? 'EXPIRED' : 'INVALIDATED';
        const nextStatus = isTtl ? 'EXPIRED' : 'REJECTED';

        if (intent) {
          intent.stage = nextStage;
          intent.invalidationReason = cancelReason;
          intent.invalidatedAt = Date.now();
          this.ledger?.setArmedIntents(this.radar.getAllIntents());
          this.ledger?.setDaemonState(this.getDaemonState());

          // 📡 Broadcast cancellation/expiry to Telegram
          if (this.telegram) {
            if (isTtl) {
              const eventKey = `evt_ARMED_INTENT_EXPIRED_${intent.symbol}_${decisionId}`;
              this.telegram
                .broadcastSparkMilestone(
                  'ARMED_INTENT_EXPIRED',
                  {
                    id: decisionId,
                    symbol: intent.symbol,
                    direction: intent.direction,
                    triggerCondition: intent.triggerCondition,
                    triggerPrice: intent.triggerPrice,
                    triggerTimeframe: intent.triggerTimeframe,
                    ttlBars: intent.ttlBars,
                    timestamp: Date.now(),
                  },
                  { eventKey }
                )
                .catch(() => {});
            } else {
              const eventKey = `evt_ARMED_INTENT_INVALIDATED_${intent.symbol}_${decisionId}`;
              this.telegram
                .broadcastSparkMilestone(
                  'ARMED_INTENT_INVALIDATED',
                  {
                    id: decisionId,
                    symbol: intent.symbol,
                    direction: intent.direction,
                    reason: cancelReason,
                    invalidationLevel: intent.invalidationLevel,
                    timestamp: Date.now(),
                  },
                  { eventKey }
                )
                .catch(() => {});
            }
          }
        }
        try {
          await sql`
            UPDATE agent_decision_log
            SET status = ${nextStatus},
                narrative = COALESCE(narrative, '') || ' [SPARK_ORDER_CANCELLED: ' || ${cancelReason} || ']',
                updated_at = NOW()
            WHERE id = ${decisionId} AND (status = 'PAPER_ACTIVE' OR status = 'ARMED' OR status = 'QUEUED' OR status = 'STAGED' OR status = 'ORDER_RESTING')
          `;
        } catch {}
        if (isPaper) {
          this.ledger?.logEvent('SPARK_DECISION_REJECTED', `Paper order #${decisionId} cancelled: ${cancelReason}`, {
            position: pos,
            metadata: { decisionId, cancelReason },
          });
        }
      } else if (event.type === 'STAGE_1_HARVEST') {
        const intent = this.radar.getIntent(decisionId);
        if (intent) {
          intent.stage = 'IN_FLIGHT_STAGE_2';
          this.ledger?.setArmedIntents(this.radar.getAllIntents());
          this.ledger?.setDaemonState(this.getDaemonState());
        }
        const s1Price = pos.stage1Target ? `$${pos.stage1Target.toFixed(2)}` : 'Target';
        const s1Narrative = ` [SPARK_TP1_HARVEST: Stage 1 filled @ ${s1Price}, SL ratcheted to $${pos.activeStopLoss.toFixed(2)}]`;
        try {
          await sql`
            UPDATE agent_decision_log
            SET narrative = COALESCE(narrative, '') || ${s1Narrative},
                updated_at = NOW()
            WHERE id = ${decisionId}
          `;
        } catch {}
        if (isPaper) {
          this.ledger?.logEvent('SPARK_DECISION_TP1_HARVEST', `Paper order #${decisionId} harvested TP1 at ${s1Price}`, {
            position: pos,
            metadata: { decisionId, stage1Target: pos.stage1Target, newStopLoss: pos.activeStopLoss },
          });
        }
      } else if (event.type === 'STAGE_2_HARVEST') {
        const intent = this.radar.getIntent(decisionId);
        if (intent) {
          intent.stage = 'IN_FLIGHT_STAGE_3';
          this.ledger?.setArmedIntents(this.radar.getAllIntents());
          this.ledger?.setDaemonState(this.getDaemonState());
        }
      } else if (event.type === 'POSITION_CLOSED') {
        const intent = this.radar.getIntent(decisionId);
        if (intent) {
          intent.stage = 'COMPLETED';
          this.ledger?.setArmedIntents(this.radar.getAllIntents());
          this.ledger?.setDaemonState(this.getDaemonState());
        }
        const nextStatus = isPaper ? 'PAPER_CLOSED' : 'EXECUTED';
        const sign = (pos.realizedR || 0) >= 0 ? '+' : '';
        const closeNarrative = ` [SPARK_${pos.executionMode || 'TRADE'}_CLOSED: ${pos.exitReason || 'CLOSED'} @ $${(pos.exitPrice || pos.activeStopLoss).toFixed(2)}, R=${sign}${(pos.realizedR || 0).toFixed(2)}R]`;
        try {
          await sql`
            UPDATE agent_decision_log
            SET status = ${nextStatus},
                narrative = COALESCE(narrative, '') || ${closeNarrative},
                updated_at = NOW()
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
   * Returns the internal Proximity Radar instance.
   */
  public getProximityRadar(): ProximityRadarEngine {
    return this.radar;
  }

  /**
   * Resolves the overall Daemon state machine state:
   * ACTIVE_TRADE | ORDER_RESTING | ARMED_WATCHING_TRIGGER | SEARCHING
   */
  public getDaemonState(): DaemonStateMachineState {
    const activePositions = this.engine.getActivePositions();
    const pendingOrders = this.engine.getPendingLimitOrders();
    return this.radar.resolveDaemonState(
      activePositions.length,
      pendingOrders.length,
      this.engine.config.symbol
    );
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
   * Promotes a setup from STANDBY into active PAPER_TRADING or LIVE_BINANCE mode.
   */
  public async promoteStandbyToMode(
    decisionId: number,
    targetMode: 'PAPER_TRADING' | 'LIVE_BINANCE'
  ): Promise<{ success: boolean; message: string; position?: any; entryPrice?: number }> {
    console.log(`[SPARK_DISPATCHER] 🚀 Promoting decision #${decisionId} to ${targetMode}...`);
    try {
      // 0. Ensure schema self-healing is active
      await ensureAgentDecisionTableInitialized();

      // 1. Fetch decision record from database
      const { rows } = await sql`
        SELECT * FROM agent_decision_log WHERE id = ${decisionId} LIMIT 1;
      `;
      let record: any = rows && rows.length > 0 ? rows[0] : null;
      if (!record) {
        const radarIntent = this.radar.getIntent(decisionId);
        if (radarIntent) {
          record = {
            id: radarIntent.id,
            symbol: radarIntent.symbol,
            agent_id: radarIntent.agentId,
            bias_signal: radarIntent.direction === 'LONG' ? 'CONFIRMED_BULLISH' : 'CONFIRMED_BEARISH',
            entry_range_low: radarIntent.poiZoneLow,
            entry_range_high: radarIntent.poiZoneHigh,
            limit_entry_price: radarIntent.fvgProximalPrice || radarIntent.triggerPrice,
            invalidation_level: radarIntent.invalidationLevel,
            target_1: radarIntent.target1,
            target_2: radarIntent.target2,
            execution_mode: radarIntent.executionMode,
            status: 'STANDBY',
            trigger_condition: radarIntent.triggerCondition,
            trigger_price: radarIntent.triggerPrice,
            trigger_timeframe: radarIntent.triggerTimeframe,
            ttl_bars: radarIntent.ttlBars,
          };
        } else {
          return { success: false, message: `Decision #${decisionId} not found in database or radar.` };
        }
      }

      // 2. If promoting to LIVE_BINANCE, verify safety gate
      if (targetMode === 'LIVE_BINANCE') {
        const safetyGate = evaluateExecutionSafetyGate();
        if (!safetyGate.isAllowed) {
          return {
            success: false,
            message: `Safety Gate Veto: ${safetyGate.reason}`,
          };
        }
      }

      // 3. Update database record to target execution mode and status ARMED
      try {
        await sql`
          UPDATE agent_decision_log
          SET execution_mode = ${targetMode},
              status = 'ARMED',
              narrative = COALESCE(narrative, '') || ' [PROMOTED_VIA_TELEGRAM: Promoted to ' || ${targetMode} || ' @ ' || NOW() || ']',
              updated_at = NOW()
          WHERE id = ${decisionId};
        `;
      } catch (updErr: any) {
        if (updErr?.message?.includes('updated_at') || updErr?.code === '42703') {
          try {
            await ensureAgentDecisionTableInitialized(true);
            await sql`
              UPDATE agent_decision_log
              SET execution_mode = ${targetMode},
                  status = 'ARMED',
                  narrative = COALESCE(narrative, '') || ' [PROMOTED_VIA_TELEGRAM: Promoted to ' || ${targetMode} || ' @ ' || NOW() || ']',
                  updated_at = NOW()
              WHERE id = ${decisionId};
            `;
          } catch {
            // Defensive fallback if updated_at cannot be added (e.g. read-only/restricted user)
            await sql`
              UPDATE agent_decision_log
              SET execution_mode = ${targetMode},
                  status = 'ARMED',
                  narrative = COALESCE(narrative, '') || ' [PROMOTED_VIA_TELEGRAM: Promoted to ' || ${targetMode} || ' @ ' || NOW() || ']'
              WHERE id = ${decisionId};
            `.catch(() => {});
          }
        } else {
          // In offline/sandbox mode without PostgreSQL, non-fatal
          console.warn(`[SPARK_DISPATCHER] Non-fatal DB update notice for decision #${decisionId}:`, updErr?.message || updErr);
        }
      }

      // 4. Update radar intent if present
      const intent = this.radar.getIntent(decisionId);
      if (intent) {
        intent.executionMode = targetMode;
        this.ledger?.setArmedIntents(this.radar.getAllIntents());
      }

      // 4.5 Operator Preemption: Clear any resting limit order so the manually promoted setup occupies the resting slot
      if (this.engine.getPendingLimitOrders().length > 0) {
        this.engine.cancelAllPendingLimitOrders();
      }

      // 5. Trigger immediate processing of this decision with modeOverride
      record.execution_mode = targetMode;
      record.status = 'ARMED';
      const result = await this.processDecision(record, undefined, { modeOverride: targetMode });
      const resolvedEntry =
        result.position?.limitEntryPrice ??
        result.position?.entryPrice ??
        result.parsed?.limitEntryPrice ??
        (record.limit_entry_price ? parseFloat(String(record.limit_entry_price)) : null) ??
        (record.entry_range_high ? parseFloat(String(record.entry_range_high)) : null) ??
        (record.entry_range_low ? parseFloat(String(record.entry_range_low)) : null);

      const isSuccess =
        result.status === 'PAPER_ACTIVE' ||
        result.status === 'ARMED_WATCHING_TRIGGER' ||
        (result.status as string) === 'ARMED' ||
        result.status === 'EXECUTED' ||
        result.status === 'ORDER_RESTING' ||
        result.status === 'STAGED';

      return {
        success: isSuccess,
        message: isSuccess
          ? `Decision #${decisionId} successfully promoted to ${targetMode} (Status: ${result.status}).`
          : (result.reason || `Promotion to ${targetMode} rejected: status ${result.status}`),
        position: result.position,
        entryPrice: resolvedEntry ?? undefined,
      };
    } catch (err: any) {
      console.error(`[SPARK_DISPATCHER] Error promoting decision #${decisionId}:`, err);
      return { success: false, message: err?.message || String(err) };
    }
  }

  /**
   * Dismisses a decision record and purges it from radar.
   */
  public async dismissDecision(decisionId: number): Promise<{ success: boolean; message: string }> {
    console.log(`[SPARK_DISPATCHER] ❌ Dismissing decision #${decisionId}...`);
    try {
      await ensureAgentDecisionTableInitialized();
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'DISMISSED',
              narrative = COALESCE(narrative, '') || ' [DISMISSED_VIA_TELEGRAM @ ' || NOW() || ']',
              updated_at = NOW()
          WHERE id = ${decisionId};
        `;
      } catch (updErr: any) {
        if (updErr?.message?.includes('updated_at') || updErr?.code === '42703') {
          try {
            await ensureAgentDecisionTableInitialized(true);
            await sql`
              UPDATE agent_decision_log
              SET status = 'DISMISSED',
                  narrative = COALESCE(narrative, '') || ' [DISMISSED_VIA_TELEGRAM @ ' || NOW() || ']',
                  updated_at = NOW()
              WHERE id = ${decisionId};
            `;
          } catch {
            await sql`
              UPDATE agent_decision_log
              SET status = 'DISMISSED',
                  narrative = COALESCE(narrative, '') || ' [DISMISSED_VIA_TELEGRAM @ ' || NOW() || ']'
              WHERE id = ${decisionId};
            `.catch(() => {});
          }
        } else {
          throw updErr;
        }
      }

      this.radar.removeIntent(decisionId);
      this.ledger?.setArmedIntents(this.radar.getAllIntents());
      this.ledger?.setDaemonState(this.getDaemonState());

      return { success: true, message: `Decision #${decisionId} successfully dismissed.` };
    } catch (err: any) {
      console.error(`[SPARK_DISPATCHER] Error dismissing decision #${decisionId}:`, err);
      return { success: false, message: err?.message || String(err) };
    }
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

    // 3b. Sync execution mode from PostgreSQL system_settings if not overridden by CLI or offline fallback
    if (!this.cliMode && !this.allowOfflineFallback) {
      try {
        const { rows } = await sql`
          SELECT key_value FROM system_settings WHERE key_name = 'EXECUTION_MODE' LIMIT 1
        `;
        if (rows.length > 0 && rows[0].key_value) {
          const dbMode = normalizeExecutionMode(rows[0].key_value);
          if (dbMode && dbMode !== this.executionMode) {
            this.executionMode = dbMode;
            console.log(`[SPARK_DISPATCHER] 🔄 Synced execution mode from PostgreSQL system_settings: ${dbMode}`);
          }
        }
      } catch (e) {
        // Non-fatal
      }
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

      // 1. Immediate Execution Queue (status = ACTIVE or QUEUED)
      const result = await sql`
        SELECT id, symbol, agent_id, bias_signal, entry_range_low, entry_range_high,
               invalidation_level, target_1, target_2, narrative, status,
               live_price_at_submission, submitted_at, invalidated_at,
               execution_mode, trigger_timeframe, trigger_condition, trigger_price,
               poi_zone_low, poi_zone_high, limit_offset_rule, ttl_bars, bars_elapsed,
               target_3, stage1_ratio, stage2_ratio, stage3_ratio, limit_entry_price
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

      // 2. Proximity Radar Armed Queue (status = ARMED_WATCHING_TRIGGER or ARMED_PENDING)
      const armedResult = await sql`
        SELECT id, symbol, agent_id, bias_signal, execution_mode,
               trigger_condition, trigger_price, trigger_timeframe,
               poi_zone_low, poi_zone_high, limit_offset_rule,
               ttl_bars, bars_elapsed, invalidation_level,
               target_1, target_2, target_3, stage1_ratio, stage2_ratio, stage3_ratio,
               limit_entry_price, narrative, status, radar_status, submitted_at
        FROM agent_decision_log
        WHERE (status = 'ARMED_WATCHING_TRIGGER' OR status = 'ARMED_PENDING')
          AND (
            UPPER(REPLACE(REPLACE(symbol, '-', ''), '/', '')) = ${symbol.toUpperCase()}
            OR UPPER(symbol) = ${baseAsset.toUpperCase()}
          )
        ORDER BY submitted_at ASC
        LIMIT 10
      `;

      let armedCountChanged = false;
      for (const row of armedResult.rows) {
        const intentId = Number(row.id);
        const existing = this.radar.getIntent(intentId);
        if (!existing) {
          let direction: 'LONG' | 'SHORT' = 'LONG';
          const bias = String(row.bias_signal || '').toUpperCase();
          if (bias.includes('BEAR') || bias === 'SHORT' || bias === 'SELL') {
            direction = 'SHORT';
          } else if (bias.includes('BULL') || bias === 'LONG' || bias === 'BUY') {
            direction = 'LONG';
          } else if (row.target_1 && row.invalidation_level) {
            direction = Number(row.target_1) > Number(row.invalidation_level) ? 'LONG' : 'SHORT';
          }

          const armedIntent: ArmedIntent = {
            id: intentId,
            symbol: row.symbol || symbol,
            agentId: row.agent_id || 'unknown_agent',
            direction,
            executionMode: row.execution_mode || 'TRIGGER_ON_CONFIRMATION',
            triggerCondition: row.trigger_condition || 'MSS_BODY_CLOSE_ABOVE',
            triggerPrice: parseFloat(String(row.trigger_price || 0)),
            triggerTimeframe: row.trigger_timeframe || '5m',
            poiZoneLow: parseFloat(String(row.poi_zone_low || 0)),
            poiZoneHigh: parseFloat(String(row.poi_zone_high || 0)),
            limitOffsetRule: row.limit_offset_rule || 'FVG_PROXIMAL',
            ttlBars: row.ttl_bars ? Number(row.ttl_bars) : 12,
            barsElapsed: row.bars_elapsed ? Number(row.bars_elapsed) : 0,
            invalidationLevel: parseFloat(String(row.invalidation_level || 0)),
            target1: row.target_1 ? parseFloat(String(row.target_1)) : null,
            target2: row.target_2 ? parseFloat(String(row.target_2)) : null,
            target3: row.target_3 ? parseFloat(String(row.target_3)) : null,
            stage1Ratio: row.stage1_ratio ? parseFloat(String(row.stage1_ratio)) : undefined,
            stage2Ratio: row.stage2_ratio ? parseFloat(String(row.stage2_ratio)) : undefined,
            stage3Ratio: row.stage3_ratio ? parseFloat(String(row.stage3_ratio)) : undefined,
            limitEntryPrice: row.limit_entry_price ? parseFloat(String(row.limit_entry_price)) : null,
            narrative: row.narrative,
            radarStatus: (row.radar_status === 'PROXIMITY_ELEVATED' ? 'PROXIMITY_ELEVATED' : 'DORMANT') as any,
            stage: (row.radar_status === 'PROXIMITY_ELEVATED' ? 'PROXIMITY_ELEVATED' : 'ARMED_PENDING') as any,
            armedAt: row.submitted_at ? new Date(row.submitted_at).getTime() : Date.now(),
          };
          this.radar.registerIntent(armedIntent);
          armedCountChanged = true;
          processedCount++;
          console.log(
            `[SPARK_DISPATCHER] 📡 Radar registered armed intent #${intentId} (${armedIntent.symbol} ${armedIntent.direction} ${armedIntent.triggerCondition} @ $${armedIntent.triggerPrice})`
          );
        }
      }

      // 3. Synchronize external cancellations or invalidations from DB
      const activeRadarIntents = this.radar.getActiveIntents(symbol);
      for (const activeIntent of activeRadarIntents) {
        try {
          const dbRecord = await sql`
            SELECT status, narrative FROM agent_decision_log WHERE id = ${activeIntent.id} LIMIT 1
          `;
          if (dbRecord.rows.length > 0) {
            const st = dbRecord.rows[0].status;
            if (st === 'INVALIDATED' || st === 'REJECTED' || st === 'STAND_DOWN' || st === 'EXPIRED') {
              activeIntent.stage = st === 'EXPIRED' ? 'EXPIRED' : 'INVALIDATED';
              activeIntent.invalidationReason = dbRecord.rows[0].narrative || `External status update: ${st}`;
              activeIntent.invalidatedAt = Date.now();
              armedCountChanged = true;
            }
          }
        } catch {}
      }

      if (armedCountChanged) {
        this.ledger?.setArmedIntents(this.radar.getAllIntents());
        this.ledger?.setDaemonState(this.getDaemonState());
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
              updated_at = NOW(),
              narrative = COALESCE(narrative, '') || ' [SPARK_DISPATCHER: ' || ${breachReason} || ']'
          WHERE id = ${id} AND (status = 'ACTIVE' OR status = 'QUEUED' OR status = 'ARMED')
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
              updated_at = NOW(),
              narrative = COALESCE(narrative, '') || ' [SPARK_DISPATCHER: Non-directional bias signal (' || ${parsed.biasSignal} || '). Standing down.]'
          WHERE id = ${id} AND (status = 'ACTIVE' OR status = 'QUEUED' OR status = 'ARMED')
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

    // 4.1 Spatial Deduplication Guard: Suppress redundant alerts/orders if entry zone is within +/- 0.15%
    // of an existing armed or resting setup on the same symbol and direction.
    const targetEntry =
      parsed.limitEntryPrice ||
      (parsed.entryRangeLow && parsed.entryRangeHigh ? (parsed.entryRangeLow + parsed.entryRangeHigh) / 2 : 0) ||
      (record.trigger_price ? parseFloat(String(record.trigger_price)) : 0);

    if (targetEntry > 0 && parsed.direction) {
      // Check 1: Armed intents in Proximity Radar
      const duplicateIntent = this.radar.findSpatialDuplicate(
        parsed.symbol,
        parsed.direction,
        targetEntry,
        0.0015,
        id
      );

      // Check 2: Resting limit orders in Automated Strategy Execution Engine
      let duplicateOrder: StrategyExecutionPosition | undefined = undefined;
      const cleanTargetSym = parsed.symbol ? parsed.symbol.toUpperCase().replace(/[-_/]/g, '') : '';
      const pendingOrders = this.engine.getPendingLimitOrders();
      for (const pos of pendingOrders) {
        const cleanPosSym = pos.symbol ? pos.symbol.toUpperCase().replace(/[-_/]/g, '') : '';
        if (cleanPosSym === cleanTargetSym && pos.direction === parsed.direction) {
          const existingEntry = pos.entryPrice;
          if (existingEntry > 0) {
            const delta = Math.abs(targetEntry - existingEntry) / existingEntry;
            if (delta <= 0.0015) {
              duplicateOrder = pos;
              break;
            }
          }
        }
      }

      if (duplicateIntent || duplicateOrder) {
        const existingRef = duplicateIntent
          ? `Radar Intent #${duplicateIntent.id} (Stage: ${duplicateIntent.stage})`
          : `Engine Order #${duplicateOrder!.id} (Status: ${duplicateOrder!.status})`;
        const existingPrice = duplicateIntent
          ? (duplicateIntent.resolvedEntryPrice || duplicateIntent.limitEntryPrice || duplicateIntent.triggerPrice || targetEntry)
          : duplicateOrder!.entryPrice;
        const deltaPct = ((Math.abs(targetEntry - existingPrice) / existingPrice) * 100).toFixed(3);

        const dupReason = `Spatial duplicate: Target entry $${targetEntry.toFixed(2)} is within ${deltaPct}% (+/-0.15%) of existing ${parsed.direction} setup (${existingRef} @ $${existingPrice.toFixed(2)}). Redundant alerts/orders suppressed.`;
        console.warn(`[SPARK_DISPATCHER] 🔁 Decision #${id} suppressed: ${dupReason}`);

        try {
          await sql`
            UPDATE agent_decision_log
            SET status = 'DUPLICATE_SUPPRESSED',
                updated_at = NOW(),
                narrative = COALESCE(narrative, '') || ' [SPATIAL_DEDUPLICATION_SUPPRESSED: ' || ${dupReason} || ']'
            WHERE id = ${id} AND (status = 'ACTIVE' OR status = 'QUEUED' OR status = 'ARMED')
          `;
        } catch {}

        this.ledger?.logEvent('SPARK_DECISION_DUPLICATE_SUPPRESSED', dupReason, {
          livePrice: livePrice ?? undefined,
          metadata: { decisionId: id, targetEntry, existingPrice, deltaPct },
        });

        return {
          status: 'DUPLICATE_SUPPRESSED',
          reason: dupReason,
          parsed,
        };
      }
    }

    // 4.5 Armed Intent Routing: If record is conditional or armed, register directly into Proximity Radar
    if (
      record.execution_mode === 'TRIGGER_ON_CONFIRMATION' ||
      record.status === 'ARMED_WATCHING_TRIGGER' ||
      record.status === 'ARMED_PENDING'
    ) {
      const armedIntent: ArmedIntent = {
        id,
        symbol: parsed.symbol,
        agentId: parsed.agentId,
        direction: parsed.direction!,
        executionMode: 'TRIGGER_ON_CONFIRMATION',
        triggerCondition:
          record.trigger_condition ||
          (parsed.direction === 'LONG' ? 'MSS_BODY_CLOSE_ABOVE' : 'MSS_BODY_CLOSE_BELOW'),
        triggerPrice: record.trigger_price
          ? parseFloat(String(record.trigger_price))
          : (parsed.limitEntryPrice || livePrice || 0),
        triggerTimeframe: record.trigger_timeframe || '5m',
        poiZoneLow:
          record.poi_zone_low !== undefined && record.poi_zone_low !== null
            ? parseFloat(String(record.poi_zone_low))
            : (parsed.entryRangeLow || 0),
        poiZoneHigh:
          record.poi_zone_high !== undefined && record.poi_zone_high !== null
            ? parseFloat(String(record.poi_zone_high))
            : (parsed.entryRangeHigh || 0),
        limitOffsetRule: record.limit_offset_rule || 'FVG_PROXIMAL',
        ttlBars: record.ttl_bars ? Number(record.ttl_bars) : 12,
        barsElapsed: record.bars_elapsed ? Number(record.bars_elapsed) : 0,
        invalidationLevel: parsed.invalidationLevel || 0,
        target1: parsed.stage1Target,
        target2: parsed.stage2Target,
        target3: record.target_3 ? parseFloat(String(record.target_3)) : null,
        stage1Ratio: record.stage1_ratio ? parseFloat(String(record.stage1_ratio)) : undefined,
        stage2Ratio: record.stage2_ratio ? parseFloat(String(record.stage2_ratio)) : undefined,
        stage3Ratio: record.stage3_ratio ? parseFloat(String(record.stage3_ratio)) : undefined,
        limitEntryPrice: parsed.limitEntryPrice,
        narrative: parsed.rawRecord?.narrative,
        radarStatus: 'DORMANT',
        stage: 'ARMED_PENDING',
        armedAt: record.submitted_at ? new Date(record.submitted_at).getTime() : Date.now(),
      };

      this.radar.registerIntent(armedIntent);
      this.ledger?.setArmedIntents(this.radar.getAllIntents());
      this.ledger?.setDaemonState(this.getDaemonState());

      // Atomically transition status from ACTIVE to ARMED_WATCHING_TRIGGER in DB to prevent infinite polling loops
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'ARMED_WATCHING_TRIGGER',
              updated_at = NOW()
          WHERE id = ${id} AND (status = 'ACTIVE' OR status = 'ARMED')
        `;
      } catch {}

      return {
        status: 'ARMED_WATCHING_TRIGGER',
        reason: 'Registered armed intent in Proximity Radar awaiting trigger confirmation',
        parsed,
      };
    }

    // 5. Atomic Queue Claim: Flag record as 'QUEUED' to prevent duplicate execution loops
    let claimSuccessful = false;
    if (record.status === 'QUEUED' || record.status === 'ARMED') {
      claimSuccessful = true;
    } else {
      try {
        const claimRes = await sql`
          UPDATE agent_decision_log
          SET status = 'QUEUED',
              updated_at = NOW()
          WHERE id = ${id} AND (status = 'ACTIVE' OR status = 'ARMED')
          RETURNING id
        `;
        claimSuccessful = claimRes.rows.length > 0;
        if (!claimSuccessful && (this.allowOfflineFallback || livePriceOverride !== undefined)) {
          claimSuccessful = true;
        }
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
              updated_at = NOW(),
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
              updated_at = NOW(),
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
              updated_at = NOW(),
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
            updated_at = NOW(),
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
            htfTrend:
              parsed.rawRecord?.htf_trend ||
              (parsed.direction === 'LONG'
                ? 'BULLISH CONTINUATION (1H / 15m)'
                : 'BEARISH CONTINUATION (1H / 15m)'),
            bosTriggerLevel: parsed.rawRecord?.trigger_price
              ? parseFloat(String(parsed.rawRecord.trigger_price))
              : null,
            entryRangeLow: parsed.entryRangeLow,
            entryRangeHigh: parsed.entryRangeHigh,
            limitEntryPrice: parsed.limitEntryPrice,
            invalidationLevel: sizing.clampedStopLoss,
            target1: parsed.stage1Target,
            target2: parsed.stage2Target,
            riskUsd: sizing.dollarRisk,
            riskPct: sizing.compoundingRiskPct,
            contractSize: sizing.contractSize,
            rewardRiskRatio:
              parsed.stage2Target && parsed.limitEntryPrice && sizing.clampedStopLoss
                ? Math.abs(parsed.stage2Target - parsed.limitEntryPrice) /
                  Math.abs(parsed.limitEntryPrice - sizing.clampedStopLoss)
                : undefined,
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
              updated_at = NOW(),
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
          SET status = 'ARMED',
              updated_at = NOW(),
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
        originAnchorLevel: (parsed.direction === 'LONG' ? parsed.entryRangeLow : parsed.entryRangeHigh) ?? undefined,
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
                updated_at = NOW(),
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
                updated_at = NOW(),
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
        originAnchorLevel: (parsed.direction === 'LONG' ? parsed.entryRangeLow : parsed.entryRangeHigh) ?? undefined,
        executionMode: 'LIVE_BINANCE',
        maxRetestBars: 12,
        bypassWeekendFilter: true,
      });

      if (submitRes.success) {
        try {
          await sql`
            UPDATE agent_decision_log
            SET status = 'EXECUTED',
                updated_at = NOW(),
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
                updated_at = NOW(),
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

  /**
   * Evaluates incoming real-time market ticks:
   * 1. Detects POI zone penetration and elevates radar monitoring to PROXIMITY_ELEVATED.
   * 2. Detects tick-level adverse invalidation breaches or early Target 1 touches.
   */
  public async onMarketTick(
    livePrice: number,
    symbol: string = this.engine.config.symbol
  ): Promise<{
    elevated: ProximityEvaluationResult[];
    deElevated: ProximityEvaluationResult[];
    invalidated: InvalidationEvaluationResult[];
  }> {
    const result = this.radar.onMarketTick(livePrice, symbol);

    // Handle proximity elevations
    for (const elev of result.elevated) {
      console.log(
        `[SPARK_DISPATCHER] 📡 Proximity elevated for intent #${elev.intent.id} (${elev.intent.symbol} ${elev.intent.direction}): ${elev.reason}`
      );
      try {
        await sql`
          UPDATE agent_decision_log
          SET radar_status = 'PROXIMITY_ELEVATED',
              updated_at = NOW()
          WHERE id = ${elev.intent.id} AND (status = 'ARMED_WATCHING_TRIGGER' OR status = 'ARMED_PENDING')
        `;
      } catch {}
      this.ledger?.logEvent(
        'ARMED_INTENT_PROXIMITY_ELEVATED',
        `Armed intent #${elev.intent.id} elevated to PROXIMITY_ELEVATED: ${elev.reason}`,
        {
          livePrice,
          metadata: {
            intentId: elev.intent.id,
            symbol: elev.intent.symbol,
            poiZone: [elev.intent.poiZoneLow, elev.intent.poiZoneHigh],
            status: elev.currentStatus,
          },
        }
      );
    }

    // Handle de-elevations back to DORMANT
    for (const deElev of result.deElevated) {
      console.log(
        `[SPARK_DISPATCHER] 📡 Proximity de-elevated for intent #${deElev.intent.id} (${deElev.intent.symbol}): ${deElev.reason}`
      );
      try {
        await sql`
          UPDATE agent_decision_log
          SET radar_status = 'DORMANT',
              updated_at = NOW()
          WHERE id = ${deElev.intent.id} AND (status = 'ARMED_WATCHING_TRIGGER' OR status = 'ARMED_PENDING')
        `;
      } catch {}
    }

    // Handle tick-level invalidations (adverse stop-loss breach or early Target 1 hit)
    for (const inv of result.invalidated) {
      console.warn(
        `[SPARK_DISPATCHER] 🛑 Armed intent #${inv.intent.id} invalidated on tick: ${inv.reason}`
      );
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'INVALIDATED',
              invalidated_at = ${inv.timestamp},
              updated_at = NOW(),
              narrative = COALESCE(narrative, '') || ' [RADAR_TICK: ' || ${inv.reason} || ']'
          WHERE id = ${inv.intent.id}
        `;
      } catch (err: any) {
        console.warn(`[SPARK_DISPATCHER] DB update error for invalidated intent #${inv.intent.id}:`, err?.message || err);
      }

      this.ledger?.logEvent(
        'ARMED_INTENT_INVALIDATED',
        `Armed intent #${inv.intent.id} invalidated: ${inv.reason}`,
        {
          livePrice,
          metadata: {
            intentId: inv.intent.id,
            symbol: inv.intent.symbol,
            reason: inv.reason,
            breachPrice: inv.breachPrice,
          },
        }
      );

      if (this.telegram) {
        const eventKey = `evt_ARMED_INTENT_INVALIDATED_${inv.intent.symbol}_${inv.intent.id}`;
        this.telegram
          .broadcastSparkMilestone(
            'ARMED_INTENT_INVALIDATED',
            {
              id: inv.intent.id,
              symbol: inv.intent.symbol,
              direction: inv.intent.direction,
              reason: inv.reason,
              invalidationLevel: inv.intent.invalidationLevel,
              breachPrice: inv.breachPrice,
              timestamp: inv.timestamp,
            },
            { eventKey }
          )
          .catch(() => {});
      }
    }

    if (result.elevated.length > 0 || result.deElevated.length > 0 || result.invalidated.length > 0) {
      this.ledger?.setArmedIntents(this.radar.getAllIntents());
      this.ledger?.setDaemonState(this.getDaemonState());
    }

    return result;
  }

  /**
   * Evaluates closed candle boundaries:
   * 1. Increments TTL bars elapsed and evaluates 12-bar TTL expiration.
   * 2. Evaluates intra-candle invalidation or target 1 hits.
   * 3. Confirms structural triggers (MSS body close, sweep & reclaim with volumetric displacement).
   * 4. Dispatches triggered intents to resting limit order placement.
   */
  public async onCandleClosed(
    candleTimeframe: string,
    candle: Candle,
    symbol: string = this.engine.config.symbol
  ): Promise<CandleEvaluationOutput> {
    const output = this.radar.onCandleClosed(candleTimeframe, candle, symbol);

    // 1. Handle Expired Intents (TTL reached)
    for (const exp of output.expired) {
      console.log(
        `[SPARK_DISPATCHER] ⌛ Armed intent #${exp.id} reached TTL expiration (${exp.barsElapsed}/${exp.ttlBars} bars on ${exp.triggerTimeframe}).`
      );
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'EXPIRED',
              bars_elapsed = ${exp.barsElapsed},
              invalidated_at = ${exp.invalidatedAt || Date.now()},
              updated_at = NOW(),
              narrative = COALESCE(narrative, '') || ' [RADAR_CANDLE: ' || ${exp.invalidationReason || 'TTL Expired'} || ']'
          WHERE id = ${exp.id}
        `;
      } catch (err: any) {
        console.warn(`[SPARK_DISPATCHER] DB update error for expired intent #${exp.id}:`, err?.message || err);
      }

      this.ledger?.logEvent(
        'ARMED_INTENT_EXPIRED',
        `Armed intent #${exp.id} expired after ${exp.barsElapsed} bars`,
        {
          livePrice: candle.c,
          metadata: {
            intentId: exp.id,
            symbol: exp.symbol,
            barsElapsed: exp.barsElapsed,
            ttlBars: exp.ttlBars,
            triggerTimeframe: exp.triggerTimeframe,
          },
        }
      );

      if (this.telegram) {
        const eventKey = `evt_ARMED_INTENT_EXPIRED_${exp.symbol}_${exp.id}`;
        this.telegram
          .broadcastSparkMilestone(
            'ARMED_INTENT_EXPIRED',
            {
              id: exp.id,
              symbol: exp.symbol,
              direction: exp.direction,
              triggerCondition: exp.triggerCondition,
              triggerPrice: exp.triggerPrice,
              triggerTimeframe: exp.triggerTimeframe,
              ttlBars: exp.ttlBars,
              timestamp: exp.invalidatedAt || Date.now(),
            },
            { eventKey }
          )
          .catch(() => {});
      }
    }

    // 2. Handle Invalidated Intents (intra-candle breach or early target 1)
    for (const inv of output.invalidated) {
      console.warn(
        `[SPARK_DISPATCHER] 🛑 Armed intent #${inv.intent.id} invalidated on candle close: ${inv.reason}`
      );
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'INVALIDATED',
              invalidated_at = ${inv.timestamp},
              updated_at = NOW(),
              narrative = COALESCE(narrative, '') || ' [RADAR_CANDLE: ' || ${inv.reason} || ']'
          WHERE id = ${inv.intent.id}
        `;
      } catch (err: any) {
        console.warn(`[SPARK_DISPATCHER] DB update error for invalidated intent #${inv.intent.id}:`, err?.message || err);
      }

      this.ledger?.logEvent(
        'ARMED_INTENT_INVALIDATED',
        `Armed intent #${inv.intent.id} invalidated: ${inv.reason}`,
        {
          livePrice: candle.c,
          metadata: {
            intentId: inv.intent.id,
            symbol: inv.intent.symbol,
            reason: inv.reason,
            breachPrice: inv.breachPrice,
          },
        }
      );

      if (this.telegram) {
        const eventKey = `evt_ARMED_INTENT_INVALIDATED_${inv.intent.symbol}_${inv.intent.id}`;
        this.telegram
          .broadcastSparkMilestone(
            'ARMED_INTENT_INVALIDATED',
            {
              id: inv.intent.id,
              symbol: inv.intent.symbol,
              direction: inv.intent.direction,
              reason: inv.reason,
              invalidationLevel: inv.intent.invalidationLevel,
              breachPrice: inv.breachPrice,
              timestamp: inv.timestamp,
            },
            { eventKey }
          )
          .catch(() => {});
      }
    }

    // 3. Handle Triggered Intents (Physical structural confirmation + volumetric displacement)
    for (const trig of output.triggered) {
      await this.executeTriggeredIntent(trig);
    }

    if (
      output.expired.length > 0 ||
      output.invalidated.length > 0 ||
      output.triggered.length > 0
    ) {
      this.ledger?.setArmedIntents(this.radar.getAllIntents());
      this.ledger?.setDaemonState(this.getDaemonState());
    }

    return output;
  }

  /**
   * Executes an armed intent that has passed structural trigger confirmation:
   * 1. Hydrates dynamic 2% compounding risk parameters and applies 0.15% clamp.
   * 2. Validates setup through GlobalRiskGovernor pre-flight gatekeeper.
   * 3. Routes to Tri-State execution mode (STANDBY / PAPER_TRADING / LIVE_BINANCE).
   * 4. Enforces maker resting limit placement with 12-bar TTL and notifies Telegram.
   */
  public async executeTriggeredIntent(
    trig: TriggerEvaluationResult,
    options?: { modeOverride?: TriStateExecutionMode }
  ): Promise<ProcessDecisionResult> {
    const intent = trig.intent;
    const id = intent.id;
    console.log(
      `[SPARK_DISPATCHER] 🚀 Executing triggered armed intent #${id} (${intent.symbol} ${intent.direction} ${intent.triggerCondition} @ $${intent.triggerPrice.toFixed(2)}, resolved entry: $${trig.resolvedEntryPrice.toFixed(2)})`
    );

    // 1. Dynamic Risk Parameter Hydration
    const activeRisk = await this.getActiveRiskParameters();

    // 2. Dynamic Position Sizing & Anti-Micro-Friction Clamp (0.15% floor)
    const sizing = calculateSparkPositionSizing({
      accountEquity: activeRisk.accountEquity,
      compoundingRiskPct: activeRisk.compoundingRiskPct,
      entryPrice: trig.resolvedEntryPrice,
      invalidationLevel: intent.invalidationLevel,
      direction: intent.direction,
      lotPrecision: this.engine.config.lotPrecision ?? 3,
      minLotSize: this.engine.config.minLotSize ?? 0.001,
      maxLotSize: this.engine.config.maxLotSize ?? 100.0,
    });

    if (!sizing.isValid) {
      const rejectReason = sizing.error || 'Position sizing calculation failed';
      intent.stage = 'INVALIDATED';
      intent.invalidationReason = rejectReason;
      intent.invalidatedAt = Date.now();
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'REJECTED',
              updated_at = NOW(),
              narrative = COALESCE(narrative, '') || ' [TRIGGER_SIZING_ERROR: ' || ${rejectReason} || ']'
          WHERE id = ${id}
        `;
      } catch {}

      this.ledger?.setArmedIntents(this.radar.getAllIntents());
      this.ledger?.setDaemonState(this.getDaemonState());

      if (this.telegram) {
        const eventKey = `evt_ARMED_INTENT_INVALIDATED_${intent.symbol}_${id}`;
        this.telegram
          .broadcastSparkMilestone(
            'ARMED_INTENT_INVALIDATED',
            {
              id,
              symbol: intent.symbol,
              direction: intent.direction,
              reason: rejectReason,
              invalidationLevel: intent.invalidationLevel,
              timestamp: Date.now(),
            },
            { eventKey }
          )
          .catch(() => {});
      }

      return {
        status: 'REJECTED',
        reason: rejectReason,
        sizing,
      };
    }

    // 3. Global Risk Governor Pre-Flight Gatekeeper
    const normalizeSym = (s: string) => {
      const clean = String(s || '').trim().toUpperCase().replace(/[-_/]/g, '');
      if (clean === 'ETH') return 'ETHUSDC';
      if (clean === 'BTC') return 'BTCUSDC';
      return clean;
    };
    const activePositionsForSymbol = this.engine
      .getActivePositions()
      .filter((p) => normalizeSym(p.symbol) === normalizeSym(intent.symbol)).length;

    const lastLossTs =
      typeof this.engine.getLastLossClosedTimestamp === 'function'
        ? this.engine.getLastLossClosedTimestamp()
        : ((this.engine as any).lastLossClosedTimestamp || 0);

    const riskAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
      symbol: intent.symbol,
      direction: intent.direction,
      entryPrice: trig.resolvedEntryPrice,
      stopLossPrice: sizing.clampedStopLoss,
      currentEquity: activeRisk.accountEquity,
      currentOpenPositionsCount: activePositionsForSymbol,
      maxOpenPositions: activeRisk.maxOpenPositions,
      emergencyEquityFloor: activeRisk.emergencyEquityFloor,
      lastLossTimestamp: lastLossTs,
      cooldownMinutes: this.engine.config.postLossCooldownMinutes ?? 45,
      userEmail: this.userEmail,
    });

    if (!riskAssessment.isApproved) {
      const vetoReason = riskAssessment.reason || 'Vetoed by Global Risk Governor';
      intent.stage = 'INVALIDATED';
      intent.invalidationReason = vetoReason;
      intent.invalidatedAt = Date.now();
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'REJECTED_BY_RISK_GOVERNOR',
              updated_at = NOW(),
              narrative = COALESCE(narrative, '') || ' [VETO_RISK_GOVERNOR: ' || ${vetoReason} || ']'
          WHERE id = ${id}
        `;
      } catch (err: any) {
        console.warn(`[SPARK_DISPATCHER] Could not update record #${id} to REJECTED_BY_RISK_GOVERNOR:`, err?.message || err);
      }

      this.ledger?.setArmedIntents(this.radar.getAllIntents());
      this.ledger?.setDaemonState(this.getDaemonState());

      if (this.telegram) {
        const eventKey = `evt_ARMED_INTENT_INVALIDATED_${intent.symbol}_${id}`;
        this.telegram
          .broadcastSparkMilestone(
            'ARMED_INTENT_INVALIDATED',
            {
              id,
              symbol: intent.symbol,
              direction: intent.direction,
              reason: vetoReason,
              invalidationLevel: intent.invalidationLevel,
              timestamp: Date.now(),
            },
            { eventKey }
          )
          .catch(() => {});
      }

      console.warn(`[SPARK_DISPATCHER] 🛡️ Triggered intent #${id} rejected by Global Risk Governor: ${vetoReason}`);
      this.ledger?.logEvent(
        'SPARK_DECISION_REJECTED',
        `Triggered intent #${id} rejected by Risk Governor: ${vetoReason}`,
        {
          livePrice: trig.triggerCandle.c,
          metadata: {
            decisionId: id,
            violationTier: riskAssessment.violationTier,
            reason: vetoReason,
            sizing,
          },
        }
      );

      return {
        status: 'REJECTED_BY_RISK_GOVERNOR',
        reason: vetoReason,
        riskAssessment,
        sizing,
      };
    }

    const activeMode = this.resolveExecutionMode(options?.modeOverride);

    // 4. Tri-State Execution Mode Routing
    if (activeMode === 'STANDBY') {
      intent.stage = 'COMPLETED';
      intent.invalidationReason = 'Routed to STANDBY mode (paper/live trading bypass)';
      const standbyNarrative = ` [ROUTED: STANDBY (Logged to UI Cockpit, no orders queued or margin committed)]`;
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'LOGGED_STANDBY',
              updated_at = NOW(),
              narrative = COALESCE(narrative, '') || ${standbyNarrative}
          WHERE id = ${id}
        `;
      } catch {}

      this.ledger?.setArmedIntents(this.radar.getAllIntents());
      this.ledger?.setDaemonState(this.getDaemonState());

      this.ledger?.logEvent('SPARK_DECISION_STANDBY', `Triggered intent #${id} logged to STANDBY mode`, {
        livePrice: trig.triggerCandle.c,
        metadata: { decisionId: id, sizing, riskAssessment },
      });

      return {
        status: 'LOGGED_STANDBY',
        executionMode: 'STANDBY',
        reason: 'Triggered intent routed to STANDBY mode',
        riskAssessment,
        sizing,
      };
    }

    if (activeMode === 'LIVE_BINANCE') {
      const safetyGate = evaluateExecutionSafetyGate('LIVE_BINANCE');
      if (!safetyGate.isAllowed) {
        const vetoReason = `LIVE_BINANCE execution physically blocked outside verified production VPS: ${safetyGate.reason}`;
        intent.stage = 'INVALIDATED';
        intent.invalidationReason = vetoReason;
        intent.invalidatedAt = Date.now();
        try {
          await sql`
            UPDATE agent_decision_log
            SET status = 'REJECTED',
                updated_at = NOW(),
                narrative = COALESCE(narrative, '') || ' [ENVIRONMENT_ISOLATION_VETO: ' || ${vetoReason} || ']'
            WHERE id = ${id}
          `;
        } catch {}

        this.ledger?.setArmedIntents(this.radar.getAllIntents());
        this.ledger?.setDaemonState(this.getDaemonState());

        if (this.telegram) {
          const eventKey = `evt_ARMED_INTENT_INVALIDATED_${intent.symbol}_${id}`;
          this.telegram
            .broadcastSparkMilestone(
              'ARMED_INTENT_INVALIDATED',
              {
                id,
                symbol: intent.symbol,
                direction: intent.direction,
                reason: vetoReason,
                invalidationLevel: intent.invalidationLevel,
                timestamp: Date.now(),
              },
              { eventKey }
            )
            .catch(() => {});
        }

        return {
          status: 'REJECTED',
          executionMode: 'LIVE_BINANCE',
          reason: vetoReason,
          riskAssessment,
          sizing,
        };
      }
    }

    // 5. Submit resting limit order to engine (PAPER_TRADING or LIVE_BINANCE)
    const submitRes = this.engine.submitStrategyOrder({
      strategyId: `SPARK_${id}`,
      strategyName: `Spark Armed Intent #${id} (${intent.agentId})`,
      symbol: intent.symbol,
      timeframe: intent.triggerTimeframe || '5m',
      direction: intent.direction,
      limitEntryPrice: parseFloat(trig.resolvedEntryPrice.toFixed(4)),
      stopLossPrice: parseFloat(sizing.clampedStopLoss.toFixed(4)),
      stage1Target: intent.target1 ? parseFloat(intent.target1.toFixed(4)) : undefined,
      stage2Target: intent.target2 ? parseFloat(intent.target2.toFixed(4)) : undefined,
      stage3Target: intent.target3 ? parseFloat(intent.target3.toFixed(4)) : undefined,
      stage1Ratio: intent.stage1Ratio,
      stage2Ratio: intent.stage2Ratio,
      stage3Ratio: intent.stage3Ratio,
      currentMarketPrice: trig.triggerCandle.c,
      activeEquity: activeRisk.accountEquity,
      overrideRiskPct: activeRisk.compoundingRiskPct,
      setupId: `spark_decision_${id}`,
      anchorName: `Armed Intent (${intent.agentId})`,
      originZoneId: `spark_zone_${id}`,
      originAnchorLevel: trig.resolvedEntryPrice,
      executionMode: activeMode,
      maxRetestBars: intent.ttlBars || 12,
      bypassWeekendFilter: true,
    });

    if (submitRes.success) {
      intent.stage = 'ORDER_RESTING';
      intent.associatedPositionId = submitRes.position?.id;

      const restingNarrative = ` [ARMED_INTENT_TRIGGERED: Resting limit @ $${trig.resolvedEntryPrice.toFixed(2)}, SL @ $${sizing.clampedStopLoss.toFixed(2)}, Mode: ${activeMode}]`;
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'ORDER_RESTING',
              limit_entry_price = ${trig.resolvedEntryPrice},
              narrative = COALESCE(narrative, '') || ${restingNarrative},
              updated_at = NOW()
          WHERE id = ${id}
        `;
      } catch (err: any) {
        console.warn(`[SPARK_DISPATCHER] DB update error for triggered intent #${id}:`, err?.message || err);
      }

      this.ledger?.logEvent(
        'ARMED_INTENT_TRIGGERED',
        `Armed intent #${id} triggered: Resting limit placed @ $${trig.resolvedEntryPrice.toFixed(2)} (${activeMode})`,
        {
          livePrice: trig.triggerCandle.c,
          position: submitRes.position,
          metadata: {
            decisionId: id,
            resolvedEntryPrice: trig.resolvedEntryPrice,
            condition: intent.triggerCondition,
            sizing,
          },
        }
      );

      this.ledger?.setArmedIntents(this.radar.getAllIntents());
      this.ledger?.setDaemonState(this.getDaemonState());

      // 📡 Telegram Milestone: ARMED_INTENT_TRIGGERED
      if (this.telegram) {
        const trigEventKey = `evt_ARMED_INTENT_TRIGGERED_${intent.symbol}_${id}`;
        this.telegram
          .broadcastSparkMilestone(
            'ARMED_INTENT_TRIGGERED',
            {
              id,
              symbol: intent.symbol,
              direction: intent.direction,
              triggerCondition: intent.triggerCondition,
              triggerPrice: intent.triggerPrice,
              triggerTimeframe: intent.triggerTimeframe,
              limitEntryPrice: trig.resolvedEntryPrice,
              stopLossPrice: sizing.clampedStopLoss,
              contractSize: sizing.contractSize,
              riskUsd: sizing.dollarRisk,
              riskPct: sizing.compoundingRiskPct,
              target1: intent.target1,
              timestamp: Date.now(),
            },
            { eventKey: trigEventKey }
          )
          .catch(() => {});

        // Also broadcast ORDER_ARMED milestone
        const armedEventKey = submitRes.position?.id ? `evt_${submitRes.position.id}_LIMIT_ORDER_PLACED` : undefined;
        this.telegram
          .broadcastSparkMilestone(
            'ORDER_ARMED',
            {
              mode: activeMode,
              symbol: intent.symbol,
              direction: intent.direction,
              limitEntryPrice: trig.resolvedEntryPrice,
              stopLossPrice: sizing.clampedStopLoss,
              contractSize: sizing.contractSize,
              notionalValue: sizing.notionalValue,
              riskUsd: sizing.dollarRisk,
              riskPct: sizing.compoundingRiskPct,
              ttlBars: intent.ttlBars || 12,
              timestamp: Date.now(),
            },
            { eventKey: armedEventKey }
          )
          .catch(() => {});
      }

      return {
        status: activeMode === 'PAPER_TRADING' ? 'PAPER_ACTIVE' : 'EXECUTED',
        executionMode: activeMode,
        position: submitRes.position,
        riskAssessment,
        sizing,
      };
    } else {
      const rejectReason = submitRes.message || 'Order submission failed';
      intent.stage = 'INVALIDATED';
      intent.invalidationReason = rejectReason;
      intent.invalidatedAt = Date.now();
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'REJECTED',
              narrative = COALESCE(narrative, '') || ' [SUBMISSION_FAILED: ' || ${rejectReason} || ']',
              updated_at = NOW()
          WHERE id = ${id}
        `;
      } catch {}

      this.ledger?.setArmedIntents(this.radar.getAllIntents());
      this.ledger?.setDaemonState(this.getDaemonState());

      if (this.telegram) {
        const eventKey = `evt_ARMED_INTENT_INVALIDATED_${intent.symbol}_${id}`;
        this.telegram
          .broadcastSparkMilestone(
            'ARMED_INTENT_INVALIDATED',
            {
              id,
              symbol: intent.symbol,
              direction: intent.direction,
              reason: rejectReason,
              invalidationLevel: intent.invalidationLevel,
              timestamp: Date.now(),
            },
            { eventKey }
          )
          .catch(() => {});
      }

      return {
        status: 'REJECTED',
        executionMode: activeMode,
        reason: rejectReason,
        riskAssessment,
        sizing,
      };
    }
  }
}
