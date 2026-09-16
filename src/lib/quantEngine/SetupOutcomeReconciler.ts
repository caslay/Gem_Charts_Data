/**
 * src/lib/quantEngine/SetupOutcomeReconciler.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Setup Outcome Reconciliation Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Bridges historical AI evaluation logs (ai_analysis_log) with real-world
 * execution states (agent_decision_log, trades, paper_trades, and session logs).
 *
 * Enforces dynamic lifecycle badging:
 *  - 🟢 ACTIVE_SETUP: Restrict strictly to setups genuinely in-flight or armed within 12-bar TTL.
 *  - 🟢 TP1_HIT / 🟢 TP2_HIT: Realized win with harvested R multiple.
 *  - 🔴 STOPPED_OUT: Closed at invalidation level (-1.0R).
 *  - 🔵 BREAKEVEN: Scratched at entry price.
 *  - 🟡 CANCELLED_PRE_FILL: Target 1 reached or Invalidation breached prior to entry fill.
 *  - ⚪ TTL_EXPIRED: Limit order was never filled and 12-bar TTL expired.
 *  - ⚪ NEUTRAL / STAND_DOWN: Non-directional or dead-zone evaluations.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDbPool } from '../postgres';
import type { AiAnalysisRecord } from '../aiCascadeEngine';
import {
  type SetupReconciledStatus,
  type ReconciledOutcome,
  type EnrichedAiAnalysisRecord,
  type DailyAuditMetrics,
  getCairoDateString,
  getCairoDayRange,
  calculateDailyAuditMetrics,
} from './SetupOutcomeTypes';

export * from './SetupOutcomeTypes';

interface TradeMatchCandidate {
  id: string;
  symbol: string;
  direction: string;
  entryPrice: number;
  exitPrice?: number | null;
  status: string;
  realizedR?: number | null;
  realizedPnl?: number | null;
  openTime: number;
  closeTime?: number | null;
  setupId?: string | null;
}

interface DecisionMatchCandidate {
  id: number;
  symbol: string;
  direction: string;
  entryRangeLow?: number | null;
  entryRangeHigh?: number | null;
  invalidationLevel?: number | null;
  target1?: number | null;
  status: string;
  narrative?: string | null;
  submittedAt: number;
  ttlBars: number;
}


/**
 * Reconciles an array of raw ai_analysis_log records into terminal execution outcomes.
 */
export async function reconcileSetupOutcomes(
  records: AiAnalysisRecord[],
  options: { currentPrice?: number | null; now?: number } = {}
): Promise<EnrichedAiAnalysisRecord[]> {
  if (!records || records.length === 0) return [];

  const now = options.now ?? Date.now();
  const currentPrice = options.currentPrice ?? null;

  // Gather time range for batch context lookup
  const timestamps = records
    .map((r) => new Date(r.created_at).getTime())
    .filter((t) => !isNaN(t));

  const minTime = timestamps.length > 0 ? Math.min(...timestamps) - 5 * 60 * 1000 : now - 24 * 3600 * 1000;
  const maxTime = timestamps.length > 0 ? Math.max(...timestamps) + 6 * 3600 * 1000 : now;

  // 1. Fetch relevant trades from DB & session logs
  const trades = await fetchTradeCandidates(minTime, maxTime);

  // 2. Fetch relevant agent decisions from DB
  const decisions = await fetchDecisionCandidates(minTime, maxTime);

  // 3. Reconcile each record
  return records.map((rec) => {
    const rawStatus = (rec.status || 'COMPLETED').toUpperCase();
    const evaluatedStatus = rawStatus;

    // Non-ACTIVE_SETUP records retain their natural status
    if (rawStatus !== 'ACTIVE_SETUP') {
      let terminalState: SetupReconciledStatus = 'NEUTRAL';
      let reason = 'Evaluated as Neutral / Stand Down by SOP criteria';

      if (rawStatus.includes('INVALIDAT')) {
        terminalState = 'INVALIDATED';
        reason = 'Invalidated by structure or order flow filter';
      } else if (rawStatus.includes('STAND_DOWN') || rawStatus === 'NEUTRAL') {
        terminalState = 'NEUTRAL';
        reason = 'Neutral market context / Stand Down';
      } else {
        terminalState = rawStatus as SetupReconciledStatus;
      }

      return {
        ...rec,
        evaluated_status: evaluatedStatus,
        reconciled_status: terminalState,
        reconciled_outcome: {
          terminal_state: terminalState,
          outcome_reason: reason,
        },
      };
    }

    // ── ACTIVE_SETUP: Perform Deep Outcome Reconciliation ──
    const recTime = new Date(rec.created_at).getTime();
    const elapsedMs = Math.max(0, now - recTime);
    const barMinutes = rec.timeframe === '15m' ? 15 : 5;
    const ttlBars = 12;
    const ttlDurationMs = ttlBars * barMinutes * 60 * 1000;
    const isWithinTtl = elapsedMs <= ttlDurationMs;

    const dir = (rec.trade_direction || '').toUpperCase();
    const isLong = dir.includes('LONG') || rec.bias_signal?.toUpperCase().includes('BULL');
    const normDir = isLong ? 'LONG' : 'SHORT';

    const entryLow = rec.entry_range_low !== null ? Number(rec.entry_range_low) : null;
    const entryHigh = rec.entry_range_high !== null ? Number(rec.entry_range_high) : null;
    const invalidation = rec.invalidation_level !== null ? Number(rec.invalidation_level) : null;
    const target1 = rec.target_1 !== null ? Number(rec.target_1) : null;
    const target2 = rec.target_2 !== null ? Number(rec.target_2) : null;

    // ── Step A: Check matched filled/in-flight trade ──
    const matchedTrade = findMatchingTrade(trades, {
      symbol: rec.symbol,
      direction: normDir,
      entryLow,
      entryHigh,
      recTime,
      ttlDurationMs,
    });

    if (matchedTrade) {
      if (matchedTrade.status === 'OPEN') {
        return {
          ...rec,
          status: 'ACTIVE_SETUP',
          evaluated_status: evaluatedStatus,
          reconciled_status: 'ACTIVE_SETUP',
          reconciled_outcome: {
            terminal_state: 'ACTIVE_SETUP',
            is_in_flight: true,
            matched_trade_id: matchedTrade.id,
            outcome_reason: `Position actively in-flight on exchange (${matchedTrade.direction} @ $${matchedTrade.entryPrice})`,
          },
        };
      }

      // Closed trade outcome
      const r = matchedTrade.realizedR ?? 0;
      const pnl = matchedTrade.realizedPnl ?? 0;
      const isWin = r > 0;
      const isBreakeven = r === 0 || matchedTrade.status.includes('BREAKEVEN');

      if (isWin) {
        const isTp2 = r >= 1.2 || matchedTrade.status.includes('STAGE_2') || matchedTrade.status.includes('TP2');
        const state: SetupReconciledStatus = isTp2 ? 'TP2_HIT' : 'TP1_HIT';
        const label = isTp2 ? 'Target 2' : 'Target 1';

        return {
          ...rec,
          status: state,
          evaluated_status: evaluatedStatus,
          reconciled_status: state,
          reconciled_outcome: {
            terminal_state: state,
            realized_r: r,
            realized_pnl: pnl,
            matched_trade_id: matchedTrade.id,
            outcome_reason: `${label} harvested successfully (+${r.toFixed(2)}R)`,
          },
        };
      }

      if (isBreakeven) {
        return {
          ...rec,
          status: 'BREAKEVEN',
          evaluated_status: evaluatedStatus,
          reconciled_status: 'BREAKEVEN',
          reconciled_outcome: {
            terminal_state: 'BREAKEVEN',
            realized_r: 0,
            realized_pnl: pnl,
            matched_trade_id: matchedTrade.id,
            outcome_reason: 'Scratched at breakeven after partial or drawdown',
          },
        };
      }

      // Stopped Out
      const stopR = r !== 0 ? r : -1.0;
      return {
        ...rec,
        status: 'STOPPED_OUT',
        evaluated_status: evaluatedStatus,
        reconciled_status: 'STOPPED_OUT',
        reconciled_outcome: {
          terminal_state: 'STOPPED_OUT',
          realized_r: stopR,
          realized_pnl: pnl,
          matched_trade_id: matchedTrade.id,
          outcome_reason: `Stopped out at Invalidation level (${stopR.toFixed(2)}R)`,
        },
      };
    }

    // ── Step B: Check matched agent_decision_log record ──
    const matchedDecision = findMatchingDecision(decisions, {
      symbol: rec.symbol,
      recTime,
      entryLow,
      entryHigh,
    });

    if (matchedDecision) {
      const decStatus = matchedDecision.status.toUpperCase();

      if (decStatus === 'STAND_DOWN') {
        return {
          ...rec,
          status: 'STAND_DOWN',
          evaluated_status: evaluatedStatus,
          reconciled_status: 'STAND_DOWN',
          reconciled_outcome: {
            terminal_state: 'STAND_DOWN',
            outcome_reason: matchedDecision.narrative?.includes('DEADZONE')
              ? 'Stand down: Toxic dead zone window hard-locked execution'
              : 'Stand down: Microstructure condition rejected order placement',
          },
        };
      }

      if (decStatus === 'INVALIDATED') {
        return {
          ...rec,
          status: 'CANCELLED_PRE_FILL',
          evaluated_status: evaluatedStatus,
          reconciled_status: 'CANCELLED_PRE_FILL',
          reconciled_outcome: {
            terminal_state: 'CANCELLED_PRE_FILL',
            outcome_reason: 'Cancelled pre-fill: Invalidation level breached before limit fill',
          },
        };
      }

      if (decStatus.includes('REJECTED') || decStatus.includes('VETO')) {
        return {
          ...rec,
          status: 'CANCELLED_PRE_FILL',
          evaluated_status: evaluatedStatus,
          reconciled_status: 'CANCELLED_PRE_FILL',
          reconciled_outcome: {
            terminal_state: 'CANCELLED_PRE_FILL',
            outcome_reason: 'Cancelled pre-fill: Vetoed by Global Risk Governor or Geometry Gate',
          },
        };
      }

      if (decStatus === 'TTL_EXPIRED' || decStatus === 'CANCELLED') {
        const isCancelPreFill =
          matchedDecision.narrative?.includes('STOP_LOSS_BREACHED') ||
          matchedDecision.narrative?.includes('MISSED_TP1');
        const finalState: SetupReconciledStatus = isCancelPreFill ? 'CANCELLED_PRE_FILL' : 'TTL_EXPIRED';
        const reason = isCancelPreFill
          ? 'Cancelled pre-fill: Target reached or SL breached before limit entry'
          : 'TTL expired: Limit order was never filled within 12 bars';

        return {
          ...rec,
          status: finalState,
          evaluated_status: evaluatedStatus,
          reconciled_status: finalState,
          reconciled_outcome: {
            terminal_state: finalState,
            bars_elapsed: ttlBars,
            ttl_bars: ttlBars,
            outcome_reason: reason,
          },
        };
      }

      if (decStatus.includes('ARMED') && isWithinTtl) {
        return {
          ...rec,
          status: 'ACTIVE_SETUP',
          evaluated_status: evaluatedStatus,
          reconciled_status: 'ACTIVE_SETUP',
          reconciled_outcome: {
            terminal_state: 'ACTIVE_SETUP',
            is_armed: true,
            bars_elapsed: Math.floor(elapsedMs / (barMinutes * 60 * 1000)),
            ttl_bars: ttlBars,
            outcome_reason: 'Actively armed in Proximity Radar awaiting trigger confirmation',
          },
        };
      }
    }

    // ── Step C: Temporal TTL & Pre-Fill Cancellation Fallback ──
    if (isWithinTtl) {
      // Check if immediate live price breached invalidation while armed
      if (currentPrice !== null && invalidation !== null) {
        const isBreached = isLong ? currentPrice <= invalidation : currentPrice >= invalidation;
        if (isBreached) {
          return {
            ...rec,
            status: 'CANCELLED_PRE_FILL',
            evaluated_status: evaluatedStatus,
            reconciled_status: 'CANCELLED_PRE_FILL',
            reconciled_outcome: {
              terminal_state: 'CANCELLED_PRE_FILL',
              outcome_reason: `Cancelled pre-fill: Live price ($${currentPrice.toFixed(2)}) breached invalidation ($${invalidation.toFixed(2)})`,
            },
          };
        }
      }

      // Check if price already reached Target 1 prior to filling entry
      if (currentPrice !== null && target1 !== null) {
        const isTp1Reached = isLong ? currentPrice >= target1 : currentPrice <= target1;
        if (isTp1Reached) {
          return {
            ...rec,
            status: 'CANCELLED_PRE_FILL',
            evaluated_status: evaluatedStatus,
            reconciled_status: 'CANCELLED_PRE_FILL',
            reconciled_outcome: {
              terminal_state: 'CANCELLED_PRE_FILL',
              outcome_reason: `Cancelled pre-fill: Market reached Target 1 ($${target1.toFixed(2)}) before filling entry`,
            },
          };
        }
      }

      // Still actively armed and valid
      const barsElapsed = Math.floor(elapsedMs / (barMinutes * 60 * 1000));
      return {
        ...rec,
        status: 'ACTIVE_SETUP',
        evaluated_status: evaluatedStatus,
        reconciled_status: 'ACTIVE_SETUP',
        reconciled_outcome: {
          terminal_state: 'ACTIVE_SETUP',
          is_armed: true,
          bars_elapsed: barsElapsed,
          ttl_bars: ttlBars,
          outcome_reason: `Armed setup within active ${ttlBars}-bar window (${barsElapsed}/${ttlBars} bars elapsed)`,
        },
      };
    }

    // TTL Has Expired (>12 bars elapsed without an executed trade)
    return {
      ...rec,
      status: 'TTL_EXPIRED',
      evaluated_status: evaluatedStatus,
      reconciled_status: 'TTL_EXPIRED',
      reconciled_outcome: {
        terminal_state: 'TTL_EXPIRED',
        bars_elapsed: ttlBars,
        ttl_bars: ttlBars,
        outcome_reason: `Limit order was never filled and ${ttlBars}-bar TTL expired without execution`,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Private Data Fetching & Matching Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTradeCandidates(minTime: number, maxTime: number): Promise<TradeMatchCandidate[]> {
  const trades: TradeMatchCandidate[] = [];

  // 1. Fetch from PostgreSQL trades table
  try {
    const pool = getDbPool();
    const res = await pool.query(
      `SELECT trade_id, symbol, direction, entry_price, exit_price, status,
              realized_pnl, realized_r, entry_time, exit_time, metadata
       FROM trades
       WHERE entry_time >= $1 AND entry_time <= $2`,
      [new Date(minTime), new Date(maxTime)]
    );

    for (const row of res.rows) {
      let setupId: string | null = null;
      if (row.metadata) {
        const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        setupId = meta?.setupId || null;
      }

      trades.push({
        id: String(row.trade_id),
        symbol: String(row.symbol),
        direction: String(row.direction).toUpperCase(),
        entryPrice: parseFloat(row.entry_price) || 0,
        exitPrice: row.exit_price ? parseFloat(row.exit_price) : null,
        status: String(row.status).toUpperCase(),
        realizedR: row.realized_r !== null ? parseFloat(row.realized_r) : null,
        realizedPnl: row.realized_pnl !== null ? parseFloat(row.realized_pnl) : null,
        openTime: new Date(row.entry_time).getTime(),
        closeTime: row.exit_time ? new Date(row.exit_time).getTime() : null,
        setupId,
      });
    }
  } catch (dbErr) {
    // Database fallback
  }

  // 2. Fetch from local session log file if today matches
  try {
    const today = new Date().toISOString().split('T')[0];
    const sessionLogPath = path.join(process.cwd(), 'run_logs', `live_session_${today}.json`);
    if (fs.existsSync(sessionLogPath)) {
      const raw = fs.readFileSync(sessionLogPath, 'utf8');
      const sessionLog = JSON.parse(raw);

      // Add completed trades
      if (Array.isArray(sessionLog.completedTrades)) {
        for (const t of sessionLog.completedTrades) {
          if (!trades.some((existing) => existing.id === t.id)) {
            trades.push({
              id: t.id,
              symbol: t.symbol || 'ETHUSDC',
              direction: String(t.direction).toUpperCase(),
              entryPrice: t.entryPrice || 0,
              exitPrice: t.exitPrice || null,
              status: String(t.exitReason || 'CLOSED').toUpperCase(),
              realizedR: typeof t.realizedR === 'number' ? t.realizedR : null,
              realizedPnl: typeof t.realizedUsd === 'number' ? t.realizedUsd : null,
              openTime: t.openTime ? new Date(t.openTime).getTime() : Date.now(),
              closeTime: t.closeTime ? new Date(t.closeTime).getTime() : null,
              setupId: t.setupId || null,
            });
          }
        }
      }

      // Add active open positions
      if (Array.isArray(sessionLog.activeInFlightPositions)) {
        for (const pos of sessionLog.activeInFlightPositions) {
          if (!trades.some((existing) => existing.id === pos.id)) {
            trades.push({
              id: pos.id,
              symbol: pos.symbol || 'ETHUSDC',
              direction: String(pos.direction).toUpperCase(),
              entryPrice: pos.entryPrice || 0,
              status: 'OPEN',
              openTime: pos.openTime ? new Date(pos.openTime).getTime() : Date.now(),
              setupId: pos.setupId || null,
            });
          }
        }
      }
    }
  } catch {}

  return trades;
}

async function fetchDecisionCandidates(minTime: number, maxTime: number): Promise<DecisionMatchCandidate[]> {
  const decisions: DecisionMatchCandidate[] = [];

  try {
    const pool = getDbPool();
    const res = await pool.query(
      `SELECT id, symbol, bias_signal, entry_range_low, entry_range_high,
              invalidation_level, target_1, status, narrative, submitted_at, ttl_bars, created_at
       FROM agent_decision_log
       WHERE created_at >= $1 AND created_at <= $2`,
      [new Date(minTime), new Date(maxTime)]
    );

    for (const row of res.rows) {
      const rawBias = String(row.bias_signal || '').toUpperCase();
      const dir = rawBias.includes('BULL') || rawBias.includes('LONG') ? 'LONG' : 'SHORT';

      decisions.push({
        id: Number(row.id),
        symbol: String(row.symbol),
        direction: dir,
        entryRangeLow: row.entry_range_low ? parseFloat(row.entry_range_low) : null,
        entryRangeHigh: row.entry_range_high ? parseFloat(row.entry_range_high) : null,
        invalidationLevel: row.invalidation_level ? parseFloat(row.invalidation_level) : null,
        target1: row.target_1 ? parseFloat(row.target_1) : null,
        status: String(row.status || 'PENDING').toUpperCase(),
        narrative: row.narrative || null,
        submittedAt: row.submitted_at ? Number(row.submitted_at) : new Date(row.created_at).getTime(),
        ttlBars: Number(row.ttl_bars) || 12,
      });
    }
  } catch {}

  return decisions;
}

function findMatchingTrade(
  trades: TradeMatchCandidate[],
  criteria: {
    symbol: string;
    direction: string;
    entryLow: number | null;
    entryHigh: number | null;
    recTime: number;
    ttlDurationMs: number;
  }
): TradeMatchCandidate | null {
  for (const t of trades) {
    if (t.symbol !== criteria.symbol) continue;
    if (t.direction !== criteria.direction) continue;

    // Time window check: trade opened between recTime - 2m and recTime + TTL + 5m
    const openedWithinWindow =
      t.openTime >= criteria.recTime - 2 * 60 * 1000 &&
      t.openTime <= criteria.recTime + criteria.ttlDurationMs + 5 * 60 * 1000;

    if (!openedWithinWindow) continue;

    // Entry price proximity check
    if (criteria.entryLow !== null && criteria.entryHigh !== null) {
      const minEntry = Math.min(criteria.entryLow, criteria.entryHigh) * 0.998;
      const maxEntry = Math.max(criteria.entryLow, criteria.entryHigh) * 1.002;
      if (t.entryPrice >= minEntry && t.entryPrice <= maxEntry) {
        return t;
      }
    } else {
      return t;
    }
  }

  return null;
}

function findMatchingDecision(
  decisions: DecisionMatchCandidate[],
  criteria: {
    symbol: string;
    recTime: number;
    entryLow: number | null;
    entryHigh: number | null;
  }
): DecisionMatchCandidate | null {
  for (const d of decisions) {
    if (d.symbol !== criteria.symbol) continue;

    // Time window check: submitted within 3 minutes of evaluation
    const timeDelta = Math.abs(d.submittedAt - criteria.recTime);
    if (timeDelta <= 3 * 60 * 1000) {
      return d;
    }
  }

  return null;
}
