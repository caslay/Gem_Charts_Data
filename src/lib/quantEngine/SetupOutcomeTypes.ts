/**
 * src/lib/quantEngine/SetupOutcomeTypes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure Types & Client-Safe Helpers for Setup Outcome Reconciliation
 * ─────────────────────────────────────────────────────────────────────────────
 * Zero Node.js dependencies (no fs, path, or pg) - 100% Client & Server Safe.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { AiAnalysisRecord } from '../aiCascadeEngine';

export type SetupExecutionMode = 'SYNTHETIC_AUDIT' | 'PAPER_TRADING' | 'LIVE_BINANCE';

export type SetupReconciledStatus =
  | 'ACTIVE_SETUP'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'STOPPED_OUT'
  | 'BREAKEVEN'
  | 'TTL_EXPIRED'
  | 'CANCELLED_PRE_FILL'
  | 'STAND_DOWN'
  | 'NEUTRAL'
  | 'INVALIDATED';

export interface ReconciledOutcome {
  terminal_state: SetupReconciledStatus;
  execution_mode?: SetupExecutionMode;
  realized_r?: number | null;
  realized_pnl?: number | null;
  outcome_reason: string;
  is_in_flight?: boolean;
  is_armed?: boolean;
  matched_trade_id?: string | null;
  bars_elapsed?: number;
  ttl_bars?: number;
  is_synthetic_evaluation?: boolean;
  synthetic_fill_price?: number | null;
  synthetic_exit_price?: number | null;
  synthetic_mfe_r?: number | null;
  synthetic_mae_r?: number | null;
}

export interface EnrichedAiAnalysisRecord extends AiAnalysisRecord {
  evaluated_status: string;
  reconciled_status: SetupReconciledStatus;
  reconciled_outcome: ReconciledOutcome;
  execution_mode?: SetupExecutionMode;
}

export interface DailyAuditMetrics {
  totalRuns: number;
  activeSetups: number;
  neutralCount: number;
  invalidatedCount: number;
  winsCount: number;
  tp1Count: number;
  tp2Count: number;
  lossesCount: number;
  breakevenCount: number;
  expiredCount: number;
  cancelledCount: number;
  primaryModelCount: number;
  fallbackCount: number;
  avgLatencyMs: number;
}

/**
 * Returns localized Cairo date string (YYYY-MM-DD) for a given Date.
 */
export function getCairoDateString(d: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(d);
  } catch {
    const shifted = new Date(d.getTime() + 3 * 3600 * 1000);
    return shifted.toISOString().slice(0, 10);
  }
}

/**
 * Computes the UTC start and end bounds for a calendar day in Cairo time (UTC+3).
 */
export function getCairoDayRange(dateInput: string | Date): { startIso: string; endIso: string } {
  let dateStr: string;
  if (typeof dateInput === 'string') {
    if (dateInput.includes('T')) {
      dateStr = getCairoDateString(new Date(dateInput));
    } else {
      dateStr = dateInput.trim();
    }
  } else {
    dateStr = getCairoDateString(dateInput);
  }

  // Parse YYYY-MM-DD components
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);

  // In Cairo (UTC+3 in summer / UTC+2 in winter, standard +3 for market ops):
  // 00:00:00 Cairo = previous day 21:00:00 UTC
  // 23:59:59 Cairo = current day 20:59:59.999 UTC
  const startUtc = new Date(Date.UTC(year, month, day, 0, 0, 0) - 3 * 3600 * 1000);
  const endUtc = new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - 3 * 3600 * 1000);

  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
  };
}

/**
 * Calculates aggregated daily audit KPIs across an array of reconciled records.
 */
export function calculateDailyAuditMetrics(records: EnrichedAiAnalysisRecord[]): DailyAuditMetrics {
  let activeSetups = 0;
  let neutralCount = 0;
  let invalidatedCount = 0;
  let winsCount = 0;
  let tp1Count = 0;
  let tp2Count = 0;
  let lossesCount = 0;
  let breakevenCount = 0;
  let expiredCount = 0;
  let cancelledCount = 0;
  let primaryModelCount = 0;
  let fallbackCount = 0;
  let totalLatency = 0;

  for (const rec of records) {
    const term = rec.reconciled_status || rec.status;

    if (term === 'ACTIVE_SETUP') activeSetups++;
    else if (term === 'NEUTRAL' || term === 'STAND_DOWN') neutralCount++;
    else if (term === 'INVALIDATED') invalidatedCount++;
    else if (term === 'TP1_HIT') {
      winsCount++;
      tp1Count++;
    } else if (term === 'TP2_HIT') {
      winsCount++;
      tp2Count++;
    } else if (term === 'STOPPED_OUT') lossesCount++;
    else if (term === 'BREAKEVEN') breakevenCount++;
    else if (term === 'TTL_EXPIRED') expiredCount++;
    else if (term === 'CANCELLED_PRE_FILL') cancelledCount++;

    if (rec.was_fallback) {
      fallbackCount++;
    } else {
      primaryModelCount++;
    }

    totalLatency += rec.execution_latency_ms || 0;
  }

  const avgLatencyMs = records.length > 0 ? Math.round(totalLatency / records.length) : 0;

  return {
    totalRuns: records.length,
    activeSetups,
    neutralCount,
    invalidatedCount,
    winsCount,
    tp1Count,
    tp2Count,
    lossesCount,
    breakevenCount,
    expiredCount,
    cancelledCount,
    primaryModelCount,
    fallbackCount,
    avgLatencyMs,
  };
}
