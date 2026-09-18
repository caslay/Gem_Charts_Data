/**
 * src/lib/quantEngine/telemetryExportService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Telemetry & Reconciled Outcome Export Service (V17.96 Parity)
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracts comprehensive AI evaluation logs, joins with decision telemetry,
 * invokes read-only SetupOutcomeReconciler to determine ground-truth simulated/live
 * outcomes, extracts MFE/MAE excursions and entry precision, classifies failure
 * modes into post-mortem diagnostic tags, and serializes into RFC 4180 CSV & JSON.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getDbPool } from '../postgres';
import {
  reconcileSetupOutcomes,
  getCairoDateString,
  getCairoDayRange,
  type EnrichedAiAnalysisRecord,
  type SetupReconciledStatus,
} from './SetupOutcomeReconciler';
import { type AiAnalysisRecord } from '../aiCascadeEngine';
import { safeParseAiJson } from '../aiJsonParser';
import { isDeadZone } from '../temporalGatekeeper';

export type DiagnosticTag =
  | 'HARVEST_GAP_REVERSAL'
  | 'MISSED_EXPANSION'
  | 'INSTANT_INVALIDATION'
  | 'DEADZONE_CHOP'
  | 'NONE';

export interface TelemetryCorpusItem {
  metadata: {
    record_id: number;
    date_cairo: string;
    time_cairo: string;
    date_utc: string;
    time_utc: string;
    model_requested: string;
    model_resolved: string;
    provider: string;
    was_fallback: boolean;
    fallback_reason: string | null;
    execution_latency_ms: number;
    attempts: Array<{
      model: string;
      provider?: string;
      latency_ms: number;
      error?: string;
      success: boolean;
    }>;
  };
  market_context: {
    pair: string;
    timeframe: string;
    bias_signal: string;
    bias_label: string;
    structural_dealing_valuation: string;
    auction_status: string;
    valuation_note: string;
    btc_smt_status: string;
    open_interest_regime: string;
    volume_expansion_ratio: number | string;
    taker_delta_pct: number | string;
    body_ratio: number | string;
  };
  trade_plan: {
    bos_level: number | string;
    entry_low: number | string;
    entry_high: number | string;
    entry_mid: number | string;
    stop_loss: number | string;
    target_1: number | string;
    target_2: number | string;
    target_3: number | string | null;
    risk_amount_usd: number;
    projected_size_contracts: number;
    rr_tp1: number | string;
    rr_tp2: number | string;
  };
  forward_audit: {
    outcome_status: SetupReconciledStatus | string;
    realized_r: number | string;
    realized_pnl_usd: number | string;
    mfe_r: number | string;
    mfe_usd: number | string;
    mae_r: number | string;
    mae_usd: number | string;
    entry_precision_usd: number | string;
    bars_to_fill: number | string;
    bars_in_trade: number | string;
    exit_price: number | string;
    exit_time_cairo: string;
    diagnostic_tag: DiagnosticTag;
    outcome_reason: string;
  };
  narrative: {
    summary: string;
    full_narrative: string;
    raw_response: string | null;
  };
}

export interface BuildCorpusOptions {
  startDate?: string;
  endDate?: string;
  filter?: string;
  symbol?: string;
  limit?: number;
}

/**
 * Format a Date object into local Cairo (UTC+3) HH:mm:ss.
 */
export function formatCairoTime(d: Date): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    return formatter.format(d);
  } catch {
    const shifted = new Date(d.getTime() + 3 * 3600 * 1000);
    return shifted.toISOString().slice(11, 19);
  }
}

/**
 * Format a Date object into local Cairo (UTC+3) full timestamp: YYYY-MM-DD HH:mm:ss.
 */
export function formatCairoTimestamp(d: Date): string {
  const dateStr = getCairoDateString(d);
  const timeStr = formatCairoTime(d);
  return `${dateStr} ${timeStr}`;
}

/**
 * Clean and sanitize a narrative text into a single-line string for CSV.
 */
export function sanitizeSingleLine(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/"/g, '""')
    .trim();
}

/**
 * RFC 4180 CSV value escaper.
 */
export function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Automated post-mortem diagnostic tag classifier.
 */
export function classifyDiagnosticTag(params: {
  terminalState: SetupReconciledStatus | string;
  outcomeReason: string;
  narrative: string;
  recTime: number;
  mfeR: number | null;
  maeR: number | null;
  barsElapsed?: number;
  barsToFill?: number | null;
}): DiagnosticTag {
  const { terminalState, outcomeReason, narrative, recTime, mfeR, barsElapsed } = params;
  const reasonLower = (outcomeReason || '').toLowerCase();
  const narrativeUpper = (narrative || '').toUpperCase();

  // 1. DEADZONE_CHOP
  const dz = isDeadZone(recTime);
  if (
    dz.isDead ||
    narrativeUpper.includes('DEADZONE') ||
    narrativeUpper.includes('DEAD_ZONE') ||
    reasonLower.includes('dead zone') ||
    reasonLower.includes('deadzone')
  ) {
    if (terminalState === 'TTL_EXPIRED' || terminalState === 'STAND_DOWN' || terminalState === 'CANCELLED_PRE_FILL') {
      return 'DEADZONE_CHOP';
    }
  }

  // 2. MISSED_EXPANSION
  if (
    terminalState === 'CANCELLED_PRE_FILL' &&
    (reasonLower.includes('target 1') ||
      reasonLower.includes('missed expansion') ||
      reasonLower.includes('expanded directly to target'))
  ) {
    return 'MISSED_EXPANSION';
  }

  // 3. INSTANT_INVALIDATION
  if (
    terminalState === 'CANCELLED_PRE_FILL' &&
    (reasonLower.includes('invalidation level') ||
      reasonLower.includes('invalidation breached') ||
      reasonLower.includes('breached prior to limit'))
  ) {
    return 'INSTANT_INVALIDATION';
  }
  if (
    terminalState === 'STOPPED_OUT' &&
    barsElapsed !== undefined &&
    barsElapsed <= 1
  ) {
    return 'INSTANT_INVALIDATION';
  }

  // 4. HARVEST_GAP_REVERSAL
  if (
    (terminalState === 'STOPPED_OUT' || terminalState === 'BREAKEVEN') &&
    ((typeof mfeR === 'number' && mfeR >= 0.70) ||
      reasonLower.includes('tp1 banked') ||
      reasonLower.includes('early breakeven ratchet'))
  ) {
    return 'HARVEST_GAP_REVERSAL';
  }

  return 'NONE';
}

/**
 * Builds the comprehensive historical Telemetry Corpus by querying PostgreSQL,
 * running reconciliation, and assembling structured items.
 */
export async function buildTelemetryCorpus(
  options: BuildCorpusOptions = {}
): Promise<TelemetryCorpusItem[]> {
  const pool = getDbPool();
  const conditions: string[] = [];
  const params: any[] = [];

  const symbol = options.symbol?.trim() || '';
  if (symbol) {
    params.push(symbol);
    conditions.push(`symbol = $${params.length}`);
  }

  // Temporal range handling (Cairo UTC bounds)
  const startDate = options.startDate?.trim() || '';
  const endDate = options.endDate?.trim() || '';

  if (startDate || endDate) {
    let startBound: Date | null = null;
    let endBound: Date | null = null;

    if (startDate && startDate !== 'ALL' && endDate && endDate !== 'ALL') {
      if (!startDate.includes('T')) {
        startBound = new Date(getCairoDayRange(startDate).startIso);
      } else {
        startBound = new Date(startDate);
      }
      if (!endDate.includes('T')) {
        endBound = new Date(getCairoDayRange(endDate).endIso);
      } else {
        endBound = new Date(endDate);
      }
    } else if (startDate && startDate !== 'ALL') {
      const range = getCairoDayRange(startDate);
      startBound = new Date(range.startIso);
      endBound = new Date(range.endIso);
    } else if (endDate && endDate !== 'ALL') {
      const range = getCairoDayRange(endDate);
      startBound = new Date(range.startIso);
      endBound = new Date(range.endIso);
    }

    if (startBound && !isNaN(startBound.getTime())) {
      params.push(startBound);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (endBound && !isNaN(endBound.getTime())) {
      params.push(endBound);
      conditions.push(`created_at <= $${params.length}`);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit && options.limit > 0 ? options.limit : 5000;
  params.push(limit);
  const limitIdx = params.length;

  // 1. Fetch historical raw AI evaluations
  const querySql = `
    SELECT * FROM ai_analysis_log
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${limitIdx}
  `;

  let rawRecords: AiAnalysisRecord[] = [];
  try {
    const res = await pool.query(querySql, params);
    rawRecords = res.rows as AiAnalysisRecord[];
  } catch (err) {
    console.error('[telemetryExportService] Failed to query ai_analysis_log:', err);
    return [];
  }

  if (rawRecords.length === 0) {
    return [];
  }

  // 2. Fetch corresponding agent_decision_log entries for enrichment
  const timestamps = rawRecords
    .map((r) => new Date(r.created_at).getTime())
    .filter((t) => !isNaN(t));
  const minTime = timestamps.length > 0 ? Math.min(...timestamps) - 10 * 60 * 1000 : Date.now() - 24 * 3600 * 1000;
  const maxTime = timestamps.length > 0 ? Math.max(...timestamps) + 10 * 60 * 1000 : Date.now();

  const decisionMap = new Map<number, any>();
  try {
    const decRes = await pool.query(
      `SELECT * FROM agent_decision_log WHERE created_at >= $1 AND created_at <= $2`,
      [new Date(minTime), new Date(maxTime)]
    );
    for (const d of decRes.rows) {
      decisionMap.set(Number(d.id), d);
    }
  } catch {
    // Graceful fallback if agent_decision_log is empty or unavailable
  }

  // 3. Perform read-only reconciliation via SetupOutcomeReconciler
  const enrichedRecords: EnrichedAiAnalysisRecord[] = await reconcileSetupOutcomes(rawRecords);

  // 4. Filter by status if specified
  const filter = (options.filter || 'ALL').toUpperCase();
  const filteredRecords = enrichedRecords.filter((rec) => {
    if (filter === 'ALL') return true;
    const term = (rec.reconciled_status || rec.status).toUpperCase();

    if (filter === 'WINS' || filter === 'RESOLVED_WINS') {
      return term === 'TP1_HIT' || term === 'TP2_HIT';
    }
    if (filter === 'LOSSES' || filter === 'STOPPED_OUT') {
      return term === 'STOPPED_OUT';
    }
    if (filter === 'CANCELLED' || filter === 'EXPIRED_OR_CANCELLED') {
      return term === 'CANCELLED_PRE_FILL' || term === 'TTL_EXPIRED';
    }
    if (filter === 'ACTIVE' || filter === 'ACTIVE_SETUP') {
      return term === 'ACTIVE_SETUP';
    }
    if (filter === 'NEUTRAL') {
      return term === 'NEUTRAL' || term === 'STAND_DOWN';
    }
    if (filter === 'FALLBACK') {
      return rec.was_fallback;
    }
    return term === filter;
  });

  // 5. Transform into TelemetryCorpusItem objects
  const corpus: TelemetryCorpusItem[] = [];

  for (const rec of filteredRecords) {
    const recDate = new Date(rec.created_at);
    const recTime = recDate.getTime();
    const outcome = rec.reconciled_outcome;
    const outcomeState: SetupReconciledStatus = rec.reconciled_status || rec.status;

    // Parsed response from AI
    const parsed = safeParseAiJson(rec.raw_response || rec.narrative) || {};
    const sopReport = parsed.sop_report || {};
    const riskParams = sopReport.risk_parameters || {};
    const ofTelemetry = sopReport.order_flow_state_telemetry || {};

    // Telemetry metadata
    const telemetryObj =
      typeof rec.telemetry_data === 'string'
        ? (() => {
            try {
              return JSON.parse(rec.telemetry_data);
            } catch {
              return {};
            }
          })()
        : (rec.telemetry_data as Record<string, any>) || {};

    const attempts = Array.isArray(telemetryObj.attempts) ? telemetryObj.attempts : [];

    // Geometry parameters
    const entryLow = rec.entry_range_low !== null && rec.entry_range_low !== undefined
      ? Number(rec.entry_range_low)
      : (Array.isArray(riskParams.entry_range) ? Number(riskParams.entry_range[0]) : null);
    const entryHigh = rec.entry_range_high !== null && rec.entry_range_high !== undefined
      ? Number(rec.entry_range_high)
      : (Array.isArray(riskParams.entry_range) ? Number(riskParams.entry_range[1]) : null);

    let entryMid: number | null = null;
    if (entryLow !== null && entryHigh !== null) {
      entryMid = (entryLow + entryHigh) / 2;
    } else if (entryLow !== null) {
      entryMid = entryLow;
    } else if (entryHigh !== null) {
      entryMid = entryHigh;
    }

    const stopLoss = rec.invalidation_level !== null && rec.invalidation_level !== undefined
      ? Number(rec.invalidation_level)
      : (riskParams.invalidation !== undefined ? Number(riskParams.invalidation) : null);

    const target1 = rec.target_1 !== null && rec.target_1 !== undefined
      ? Number(rec.target_1)
      : (riskParams.tp1 !== undefined ? Number(riskParams.tp1) : null);

    const target2 = rec.target_2 !== null && rec.target_2 !== undefined
      ? Number(rec.target_2)
      : (riskParams.tp2 !== undefined ? Number(riskParams.tp2) : null);

    const target3 = rec.target_3 !== null && rec.target_3 !== undefined
      ? Number(rec.target_3)
      : null;

    // Risk calculations
    const riskDist = entryMid !== null && stopLoss !== null ? Math.abs(entryMid - stopLoss) : 0;
    const defaultRiskUsd = 50.0;
    const riskAmountUsd = typeof telemetryObj.risk_amount_usd === 'number'
      ? telemetryObj.risk_amount_usd
      : defaultRiskUsd;

    const projectedSizeContracts = riskDist > 0 ? parseFloat((riskAmountUsd / riskDist).toFixed(4)) : 0;

    const rrTp1 = riskDist > 0 && target1 !== null
      ? parseFloat((Math.abs(target1 - (entryMid ?? target1)) / riskDist).toFixed(2))
      : (riskParams.rr_ratio !== undefined ? Number(riskParams.rr_ratio) : '');

    const rrTp2 = riskDist > 0 && target2 !== null
      ? parseFloat((Math.abs(target2 - (entryMid ?? target2)) / riskDist).toFixed(2))
      : '';

    // BOS Level extraction
    let bosLevel: number | string = '';
    if (sopReport.bos_level !== undefined) {
      bosLevel = sopReport.bos_level;
    } else if (sopReport.trade_narrative) {
      const match = String(sopReport.trade_narrative).match(/BOS.*?\$?([0-9,.]+)/i);
      if (match && match[1]) {
        bosLevel = parseFloat(match[1].replace(/,/g, '')) || match[1];
      }
    } else if (rec.narrative) {
      const match = rec.narrative.match(/BOS.*?\$?([0-9,.]+)/i);
      if (match && match[1]) {
        bosLevel = parseFloat(match[1].replace(/,/g, '')) || match[1];
      }
    }

    // Excursions & outcome values
    const realizedR = outcome?.realized_r !== undefined && outcome?.realized_r !== null
      ? outcome.realized_r
      : (outcomeState === 'TP1_HIT' ? (typeof rrTp1 === 'number' ? rrTp1 : 1.5) : outcomeState === 'STOPPED_OUT' ? -1.0 : outcomeState === 'BREAKEVEN' ? 0.0 : '');

    const realizedPnlUsd = outcome?.realized_pnl !== undefined && outcome?.realized_pnl !== null
      ? outcome.realized_pnl
      : (typeof realizedR === 'number' ? parseFloat((realizedR * riskAmountUsd).toFixed(2)) : '');

    const mfeR = outcome?.synthetic_mfe_r !== undefined && outcome?.synthetic_mfe_r !== null
      ? outcome.synthetic_mfe_r
      : (typeof realizedR === 'number' && realizedR > 0 ? realizedR : '');

    const mfeUsd = typeof mfeR === 'number' ? parseFloat((mfeR * riskAmountUsd).toFixed(2)) : '';

    let maeR: number | string = '';
    if (outcome?.synthetic_mae_r !== undefined && outcome?.synthetic_mae_r !== null) {
      maeR = outcome.synthetic_mae_r;
    } else if (outcomeState === 'STOPPED_OUT') {
      maeR = -1.0;
    } else if (outcomeState === 'BREAKEVEN') {
      maeR = -0.3;
    } else if (outcomeState === 'TP1_HIT' || outcomeState === 'TP2_HIT') {
      maeR = -0.2;
    } else if (outcomeState === 'TTL_EXPIRED' || outcomeState === 'CANCELLED_PRE_FILL') {
      maeR = 0.0;
    }

    const maeUsd = typeof maeR === 'number' ? parseFloat((maeR * riskAmountUsd).toFixed(2)) : '';

    // Entry precision delta
    const fillPrice = outcome?.synthetic_fill_price ?? null;
    let entryPrecisionUsd: number | string = '';
    if (fillPrice !== null && entryMid !== null) {
      entryPrecisionUsd = parseFloat(Math.abs(fillPrice - entryMid).toFixed(2));
    } else {
      entryPrecisionUsd = 0.0;
    }

    // Bars elapsed / to fill
    const barsElapsed = outcome?.bars_elapsed ?? '';
    const barsToFill = outcome?.is_synthetic_evaluation && outcome?.synthetic_fill_price !== null
      ? (typeof barsElapsed === 'number' ? Math.min(barsElapsed, 1) : '')
      : '';

    // Exit price
    const exitPrice = outcome?.synthetic_exit_price !== undefined && outcome?.synthetic_exit_price !== null
      ? outcome.synthetic_exit_price
      : (outcomeState === 'STOPPED_OUT' && stopLoss !== null ? stopLoss : outcomeState === 'TP1_HIT' && target1 !== null ? target1 : outcomeState === 'TP2_HIT' && target2 !== null ? target2 : '');

    // Exit time localized to Cairo
    let exitTimeCairo = '';
    if (typeof barsElapsed === 'number' && barsElapsed > 0) {
      const barMins = rec.timeframe === '15m' ? 15 : 5;
      const exitMs = recTime + barsElapsed * barMins * 60 * 1000;
      exitTimeCairo = formatCairoTimestamp(new Date(exitMs));
    }

    // Diagnostic tag
    const diagnosticTag = classifyDiagnosticTag({
      terminalState: outcomeState,
      outcomeReason: outcome?.outcome_reason || '',
      narrative: rec.narrative || '',
      recTime,
      mfeR: typeof mfeR === 'number' ? mfeR : null,
      maeR: typeof maeR === 'number' ? maeR : null,
      barsElapsed: typeof barsElapsed === 'number' ? barsElapsed : undefined,
    });

    // V17.96 Nomenclature fields
    const biasSignal = rec.bias_signal || (parsed.bias_signal !== undefined ? String(parsed.bias_signal) : '');
    const biasLabel = parsed.bias_label || (biasSignal.includes('BULL') ? 'BULLISH' : biasSignal.includes('BEAR') ? 'BEARISH' : 'NEUTRAL');

    const structuralValuation =
      parsed.structural_dealing_range_valuation ||
      sopReport.structural_dealing_valuation ||
      (telemetryObj.pricing_context as any)?.local_dealing_range?.current_status ||
      (rec.narrative.includes('[VALUATION_VETO]') ? 'VALUATION_VETO' : '');

    const auctionStatus =
      parsed.auction_status ||
      sopReport.auction_status ||
      (telemetryObj.pricing_context as any)?.value_area?.auction_status ||
      '';

    const valuationNote =
      parsed.valuation_note ||
      parsed.next_database_state?.notes ||
      (telemetryObj.pricing_context as any)?.valuation_reconciliation_note ||
      '';

    const btcSmtStatus =
      sopReport.smt_status ||
      parsed.smt_status ||
      (telemetryObj.smt_context as any)?.status ||
      '';

    const openInterestRegime =
      ofTelemetry.active_regime ||
      parsed.open_interest_regime ||
      '';

    const volExpansion =
      sopReport.volumetric_sponsorship?.volume_expansion ||
      parsed.volume_expansion_ratio ||
      '';

    const takerDeltaPct =
      sopReport.volumetric_sponsorship?.taker_delta_pct ||
      parsed.taker_delta_pct ||
      '';

    const bodyRatio =
      sopReport.volumetric_sponsorship?.body_ratio ||
      parsed.body_ratio ||
      '';

    const summaryText = parsed.narrative_summary || parsed.narrative || rec.narrative;

    corpus.push({
      metadata: {
        record_id: rec.id,
        date_cairo: getCairoDateString(recDate),
        time_cairo: formatCairoTime(recDate),
        date_utc: recDate.toISOString().slice(0, 10),
        time_utc: recDate.toISOString().slice(11, 19),
        model_requested: rec.requested_model,
        model_resolved: rec.resolved_model,
        provider: rec.provider || 'GOOGLE',
        was_fallback: rec.was_fallback,
        fallback_reason: rec.fallback_reason || null,
        execution_latency_ms: rec.execution_latency_ms,
        attempts,
      },
      market_context: {
        pair: rec.symbol || 'ETHUSDC',
        timeframe: rec.timeframe || '15m',
        bias_signal: biasSignal,
        bias_label: biasLabel,
        structural_dealing_valuation: structuralValuation,
        auction_status: auctionStatus,
        valuation_note: valuationNote,
        btc_smt_status: btcSmtStatus,
        open_interest_regime: openInterestRegime,
        volume_expansion_ratio: volExpansion,
        taker_delta_pct: takerDeltaPct,
        body_ratio: bodyRatio,
      },
      trade_plan: {
        bos_level: bosLevel,
        entry_low: entryLow !== null ? parseFloat(entryLow.toFixed(2)) : '',
        entry_high: entryHigh !== null ? parseFloat(entryHigh.toFixed(2)) : '',
        entry_mid: entryMid !== null ? parseFloat(entryMid.toFixed(2)) : '',
        stop_loss: stopLoss !== null ? parseFloat(stopLoss.toFixed(2)) : '',
        target_1: target1 !== null ? parseFloat(target1.toFixed(2)) : '',
        target_2: target2 !== null ? parseFloat(target2.toFixed(2)) : '',
        target_3: target3 !== null ? parseFloat(target3.toFixed(2)) : null,
        risk_amount_usd: riskAmountUsd,
        projected_size_contracts: projectedSizeContracts,
        rr_tp1: rrTp1,
        rr_tp2: rrTp2,
      },
      forward_audit: {
        outcome_status: outcomeState,
        realized_r: typeof realizedR === 'number' ? parseFloat(realizedR.toFixed(2)) : '',
        realized_pnl_usd: typeof realizedPnlUsd === 'number' ? parseFloat(realizedPnlUsd.toFixed(2)) : '',
        mfe_r: typeof mfeR === 'number' ? parseFloat(mfeR.toFixed(2)) : '',
        mfe_usd: typeof mfeUsd === 'number' ? parseFloat(mfeUsd.toFixed(2)) : '',
        mae_r: typeof maeR === 'number' ? parseFloat(maeR.toFixed(2)) : '',
        mae_usd: typeof maeUsd === 'number' ? parseFloat(maeUsd.toFixed(2)) : '',
        entry_precision_usd: entryPrecisionUsd,
        bars_to_fill: barsToFill,
        bars_in_trade: barsElapsed,
        exit_price: typeof exitPrice === 'number' ? parseFloat(exitPrice.toFixed(2)) : '',
        exit_time_cairo: exitTimeCairo,
        diagnostic_tag: diagnosticTag,
        outcome_reason: outcome?.outcome_reason || '',
      },
      narrative: {
        summary: sanitizeSingleLine(summaryText),
        full_narrative: rec.narrative || '',
        raw_response: rec.raw_response || null,
      },
    });
  }

  return corpus;
}

/**
 * Standard RFC 4180 CSV Header Columns (V17.96 Parity).
 */
export const CSV_COLUMNS = [
  'Record_ID',
  'Date_Cairo',
  'Time_Cairo',
  'Date_UTC',
  'Time_UTC',
  'Model_Requested',
  'Model_Resolved',
  'Fallback_Triggered',
  'Failover_Reason',
  'Latency_ms',
  'Pair',
  'Timeframe',
  'Bias_Signal',
  'Bias_Label',
  'Structural_Dealing_Valuation',
  'Auction_Status',
  'Valuation_Note',
  'BTC_SMT_Status',
  'Open_Interest_Regime',
  'Volume_Expansion_Ratio',
  'Taker_Delta_Pct',
  'Body_Ratio',
  'BOS_Level',
  'Entry_Low',
  'Entry_High',
  'Entry_Mid',
  'Stop_Loss',
  'TP1',
  'TP2',
  'Risk_Amount_USD',
  'Projected_Size_Contracts',
  'RR_TP1',
  'RR_TP2',
  'Outcome_Status',
  'Realized_R',
  'MFE_R',
  'MAE_R',
  'Entry_Precision_USD',
  'Bars_To_Fill',
  'Bars_In_Trade',
  'Exit_Price',
  'Exit_Time_Cairo',
  'Diagnostic_Tag',
  'Quant_Narrative_Summary',
] as const;

/**
 * Serializes a TelemetryCorpusItem array into a standardized, RFC 4180-compliant CSV string.
 * Prepends UTF-8 BOM (\uFEFF) for automated Excel / Calc character recognition.
 */
export function serializeTelemetryToCsv(corpus: TelemetryCorpusItem[]): string {
  const headerLine = CSV_COLUMNS.join(',');
  const lines: string[] = [headerLine];

  for (const item of corpus) {
    const row = [
      escapeCsvField(item.metadata.record_id),
      escapeCsvField(item.metadata.date_cairo),
      escapeCsvField(item.metadata.time_cairo),
      escapeCsvField(item.metadata.date_utc),
      escapeCsvField(item.metadata.time_utc),
      escapeCsvField(item.metadata.model_requested),
      escapeCsvField(item.metadata.model_resolved),
      escapeCsvField(item.metadata.was_fallback ? 'TRUE' : 'FALSE'),
      escapeCsvField(item.metadata.fallback_reason || ''),
      escapeCsvField(item.metadata.execution_latency_ms),
      escapeCsvField(item.market_context.pair),
      escapeCsvField(item.market_context.timeframe),
      escapeCsvField(item.market_context.bias_signal),
      escapeCsvField(item.market_context.bias_label),
      escapeCsvField(item.market_context.structural_dealing_valuation),
      escapeCsvField(item.market_context.auction_status),
      escapeCsvField(item.market_context.valuation_note),
      escapeCsvField(item.market_context.btc_smt_status),
      escapeCsvField(item.market_context.open_interest_regime),
      escapeCsvField(item.market_context.volume_expansion_ratio),
      escapeCsvField(item.market_context.taker_delta_pct),
      escapeCsvField(item.market_context.body_ratio),
      escapeCsvField(item.trade_plan.bos_level),
      escapeCsvField(item.trade_plan.entry_low),
      escapeCsvField(item.trade_plan.entry_high),
      escapeCsvField(item.trade_plan.entry_mid),
      escapeCsvField(item.trade_plan.stop_loss),
      escapeCsvField(item.trade_plan.target_1),
      escapeCsvField(item.trade_plan.target_2),
      escapeCsvField(item.trade_plan.risk_amount_usd.toFixed(2)),
      escapeCsvField(item.trade_plan.projected_size_contracts.toFixed(4)),
      escapeCsvField(item.trade_plan.rr_tp1),
      escapeCsvField(item.trade_plan.rr_tp2),
      escapeCsvField(item.forward_audit.outcome_status),
      escapeCsvField(item.forward_audit.realized_r),
      escapeCsvField(item.forward_audit.mfe_r),
      escapeCsvField(item.forward_audit.mae_r),
      escapeCsvField(item.forward_audit.entry_precision_usd),
      escapeCsvField(item.forward_audit.bars_to_fill),
      escapeCsvField(item.forward_audit.bars_in_trade),
      escapeCsvField(item.forward_audit.exit_price),
      escapeCsvField(item.forward_audit.exit_time_cairo),
      escapeCsvField(item.forward_audit.diagnostic_tag),
      escapeCsvField(item.narrative.summary),
    ];

    lines.push(row.join(','));
  }

  // Prepend UTF-8 BOM for Microsoft Excel compliance
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Serializes a TelemetryCorpusItem array into an indented JSON evaluation corpus.
 */
export function serializeTelemetryToJson(corpus: TelemetryCorpusItem[]): string {
  return JSON.stringify(corpus, null, 2);
}
