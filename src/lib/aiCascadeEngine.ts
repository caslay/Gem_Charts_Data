import { GoogleGenerativeAI } from '@google/generative-ai';
import { sql } from '@/lib/postgres';
import { safeParseAiJson } from '@/lib/aiJsonParser';
import { autoLogSopSetup } from '@/lib/sopTrackerLogger';
import { getFallbackCascadePool, isLiteWorkhorseModel, DEFAULT_MODEL } from '@/lib/aiModels';

export interface AiAttemptTelemetry {
  model: string;
  latency_ms: number;
  error?: string;
  success: boolean;
}

export interface AiExecutionTelemetry {
  requested_model: string;
  resolved_model: string;
  was_fallback: boolean;
  fallback_reason: string | null;
  execution_latency_ms: number;
  timestamp: string;
  attempts: AiAttemptTelemetry[];
}

export interface AiAnalysisRecord {
  id: number;
  symbol: string;
  timeframe: string;
  requested_model: string;
  resolved_model: string;
  was_fallback: boolean;
  fallback_reason: string | null;
  execution_latency_ms: number;
  bias_signal: string | null;
  trade_direction: string | null;
  status: 'ACTIVE_SETUP' | 'NEUTRAL' | 'INVALIDATED' | 'COMPLETED' | string;
  entry_range_low: number | null;
  entry_range_high: number | null;
  invalidation_level: number | null;
  target_1: number | null;
  target_2: number | null;
  target_3: number | null;
  narrative: string;
  raw_response: string | null;
  telemetry_data: Record<string, unknown> | null;
  created_at: string;
}

export interface CascadeEvaluationParams {
  apiKey: string;
  requestedModel?: string;
  systemPrompt: string;
  payload: Record<string, unknown>;
  historicalState?: Record<string, unknown>;
  symbol?: string;
  timeframe?: string;
}

export interface CascadeEvaluationResult {
  text: string;
  telemetry: AiExecutionTelemetry;
  parsedResponse: Record<string, unknown> | null;
  status: string;
  tradeDirection: string;
  biasSignal: string;
  invalidationLevel: number | null;
  entryRangeLow: number | null;
  entryRangeHigh: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  logId?: number | null;
}

let isAiAnalysisTableReady = false;

/**
 * Self-healing table creation & schema migration for AI Analysis Telemetry
 */
export async function ensureAiAnalysisTableInitialized(): Promise<void> {
  if (isAiAnalysisTableReady) return;

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS ai_analysis_log (
        id                      SERIAL PRIMARY KEY,
        symbol                  VARCHAR(32)   NOT NULL DEFAULT 'ETHUSDC',
        timeframe               VARCHAR(16)   DEFAULT '5m',
        requested_model         VARCHAR(64)   NOT NULL,
        resolved_model          VARCHAR(64)   NOT NULL,
        was_fallback            BOOLEAN       NOT NULL DEFAULT FALSE,
        fallback_reason         TEXT,
        execution_latency_ms    INTEGER       NOT NULL,
        bias_signal             VARCHAR(64),
        trade_direction         VARCHAR(32),
        status                  VARCHAR(32)   NOT NULL DEFAULT 'COMPLETED',
        entry_range_low         NUMERIC(16,4),
        entry_range_high        NUMERIC(16,4),
        invalidation_level      NUMERIC(16,4),
        target_1                NUMERIC(16,4),
        target_2                NUMERIC(16,4),
        target_3                NUMERIC(16,4),
        narrative               TEXT          NOT NULL,
        raw_response            TEXT,
        telemetry_data          JSONB,
        created_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_ai_analysis_log_created_at
        ON ai_analysis_log (created_at DESC);
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_ai_analysis_log_symbol_status
        ON ai_analysis_log (symbol, status, created_at DESC);
    `;

    // Self-healing migration for agent_decision_log telemetry columns
    try {
      await sql`ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS requested_model VARCHAR(64)`;
      await sql`ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS resolved_model VARCHAR(64)`;
      await sql`ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS latency_ms INTEGER`;
      await sql`ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS was_fallback BOOLEAN DEFAULT FALSE`;
      await sql`ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS fallback_reason TEXT`;
    } catch {
      // Non-fatal if table not present or columns already exist
    }

    isAiAnalysisTableReady = true;
  } catch (err) {
    console.warn('[AI_CASCADE] Table init warning (proceeding in-memory):', err);
    isAiAnalysisTableReady = true; // prevent tight loop
  }
}

/**
 * Robust error categorization to identify recoverable quota exhaustion (429)
 * and server overload/unavailability (503) errors.
 */
export function isRecoverableAiError(error: unknown): { isRecoverable: boolean; reason: string } {
  if (!error) return { isRecoverable: false, reason: 'Unknown error' };

  const errObj = error as Record<string, unknown>;
  const status = Number(errObj.status || (errObj.response as Record<string, unknown>)?.status);
  const message = String(errObj.message || error);

  // 0. Non-recoverable auth / permission errors (immediate abort, never loop across models)
  if (status === 401 || /401|API_KEY_INVALID|unauthorized/i.test(message)) {
    return { isRecoverable: false, reason: '401 Invalid API Key' };
  }
  if (status === 403 || /403|PERMISSION_DENIED/i.test(message)) {
    return { isRecoverable: false, reason: '403 Permission Denied' };
  }
  if (status === 400 || /400|INVALID_ARGUMENT/i.test(message)) {
    return { isRecoverable: false, reason: `400 Bad Request: ${message.slice(0, 100)}` };
  }

  // 1. Quota Exhaustion (429 / RESOURCE_EXHAUSTED)
  if (status === 429 || /429|quota|RESOURCE_EXHAUSTED|rate\s*limit/i.test(message)) {
    return { isRecoverable: true, reason: '429 Quota Exceeded' };
  }

  // 2. High traffic / Overloaded model (503 / UNAVAILABLE)
  if (status === 503 || /503|overloaded|Service Unavailable|UNAVAILABLE|high\s*traffic/i.test(message)) {
    return { isRecoverable: true, reason: '503 Service Overloaded' };
  }

  // 3. Model endpoint deprecated, preview disabled, or not found (404 / NOT_FOUND)
  if (status === 404 || /404|NOT_FOUND|model.*not found|is not supported/i.test(message)) {
    return { isRecoverable: true, reason: '404 Model Endpoint Unavailable' };
  }

  // 4. Any general 5xx upstream gateway/server issue
  if (status >= 500 && status < 600) {
    return { isRecoverable: true, reason: `HTTP ${status} Upstream Error` };
  }

  return { isRecoverable: false, reason: message.slice(0, 140) };
}

/**
 * Execute an AI evaluation with the automated multi-model cascade loop.
 */
export async function runAiCascadeEvaluation(
  params: CascadeEvaluationParams
): Promise<CascadeEvaluationResult> {
  const {
    apiKey,
    requestedModel = DEFAULT_MODEL,
    systemPrompt,
    payload,
    historicalState = { status: 'SEARCHING' },
    symbol = 'ETHUSDC',
    timeframe = '5m',
  } = params;

  const totalStartTime = Date.now();
  const genAI = new GoogleGenerativeAI(apiKey);

  // ── Construct prompt ──
  const memorySection = `\n\n=== [HISTORICAL MEMORY (CURRENT STATE)] ===\n${JSON.stringify(historicalState, null, 2)}`;
  const prompt = `${systemPrompt}\n\n=== MARKET DATA PAYLOAD ===\n${JSON.stringify(payload, null, 2)}${memorySection}`;

  // ── Build cascade pool: starts with requested model, falls back to remaining Flash models, then 500 RPD Lite models ──
  const cascadePool = getFallbackCascadePool(requestedModel);
  const attempts: AiAttemptTelemetry[] = [];

  let text = '';
  let resolvedModel = requestedModel;
  let wasFallback = false;
  let fallbackReason: string | null = null;

  for (let i = 0; i < cascadePool.length; i++) {
    const candidateModel = cascadePool[i];
    const attemptStart = Date.now();

    try {
      const isLite = isLiteWorkhorseModel(candidateModel);
      if (i > 0) {
        console.warn(
          `[AI_CASCADE] Attempting fallback candidate #${i + 1}: ${candidateModel} (${isLite ? '500 RPD Workhorse' : 'Apex Reasoning'})`
        );
      }

      const model = genAI.getGenerativeModel({ model: candidateModel });
      const result = await model.generateContent(prompt);
      text = result.response.text();

      const attemptLatency = Date.now() - attemptStart;
      attempts.push({
        model: candidateModel,
        latency_ms: attemptLatency,
        success: true,
      });

      resolvedModel = candidateModel;
      if (i > 0) {
        wasFallback = true;
      }
      break; // Success! Exit cascade.
    } catch (err: unknown) {
      const attemptLatency = Date.now() - attemptStart;
      const { isRecoverable, reason } = isRecoverableAiError(err);

      console.warn(
        `[AI_CASCADE] Model ${candidateModel} failed (${reason}) in ${attemptLatency}ms:`,
        (err as Error)?.message || err
      );

      attempts.push({
        model: candidateModel,
        latency_ms: attemptLatency,
        error: reason,
        success: false,
      });

      if (!fallbackReason) {
        fallbackReason = `${reason} on ${candidateModel}`;
      }

      // Non-recoverable fatal errors (e.g. invalid API key, permission denied): abort cascade immediately
      if (!isRecoverable) {
        console.error(
          `[AI_CASCADE] Non-recoverable error encountered on ${candidateModel} (${reason}). Halting cascade.`
        );
        throw new Error(`AI evaluation failed on ${candidateModel}: ${reason}`);
      }

      // If this was the last model in the pool, throw comprehensive cascade error
      if (i === cascadePool.length - 1) {
        const errorSummary = attempts.map((a) => `${a.model}: ${a.error || 'Failed'}`).join(' | ');
        throw new Error(`All cascade models exhausted (${attempts.length} models attempted). Details: ${errorSummary}`);
      }
    }
  }

  const totalExecutionLatency = Date.now() - totalStartTime;

  const telemetry: AiExecutionTelemetry = {
    requested_model: requestedModel,
    resolved_model: resolvedModel,
    was_fallback: wasFallback,
    fallback_reason: fallbackReason,
    execution_latency_ms: totalExecutionLatency,
    timestamp: new Date().toISOString(),
    attempts,
  };

  // ── Parse structured fields from AI response ──
  const parsedResponse = safeParseAiJson<Record<string, any>>(text);

  let biasSignal = 'NEUTRAL';
  let tradeDirection = 'NEUTRAL';
  let status = 'COMPLETED';
  let entryRangeLow: number | null = null;
  let entryRangeHigh: number | null = null;
  let invalidationLevel: number | null = null;
  let target1: number | null = null;
  let target2: number | null = null;
  let target3: number | null = null;

  if (parsedResponse) {
    // 1. Bias Signal & Direction
    const rawBias = parsedResponse.bias_signal ?? parsedResponse.bias_label;
    if (rawBias === 1 || String(rawBias).toUpperCase().includes('BULL') || String(rawBias).toUpperCase().includes('LONG')) {
      biasSignal = 'BULLISH';
      tradeDirection = 'LONG';
    } else if (rawBias === -1 || String(rawBias).toUpperCase().includes('BEAR') || String(rawBias).toUpperCase().includes('SHORT')) {
      biasSignal = 'BEARISH';
      tradeDirection = 'SHORT';
    } else {
      biasSignal = 'NEUTRAL';
      tradeDirection = 'NEUTRAL';
    }

    // Explicit override if trade_direction or next_database_state specifies direction
    const explicitDir = parsedResponse.trade_direction ?? parsedResponse.next_database_state?.trade_direction;
    if (explicitDir) {
      const upDir = String(explicitDir).toUpperCase();
      if (upDir.includes('LONG') || upDir.includes('BUY')) {
        tradeDirection = 'LONG';
        if (biasSignal === 'NEUTRAL') biasSignal = 'BULLISH';
      } else if (upDir.includes('SHORT') || upDir.includes('SELL')) {
        tradeDirection = 'SHORT';
        if (biasSignal === 'NEUTRAL') biasSignal = 'BEARISH';
      } else if (upDir.includes('NEUTRAL') || upDir.includes('NONE')) {
        tradeDirection = 'NEUTRAL';
      }
    }

    // 2. Risk parameters & targets from sop_report or next_database_state
    const riskParams = parsedResponse.sop_report?.risk_parameters;
    const nextState = parsedResponse.next_database_state;

    if (Array.isArray(riskParams?.entry_range) && riskParams.entry_range.length >= 2) {
      entryRangeLow = Number(riskParams.entry_range[0]) || null;
      entryRangeHigh = Number(riskParams.entry_range[1]) || null;
    } else if (nextState?.entry_range_low != null) {
      entryRangeLow = Number(nextState.entry_range_low) || null;
      entryRangeHigh = Number(nextState.entry_range_high) || null;
    }

    invalidationLevel =
      riskParams?.invalidation != null
        ? Number(riskParams.invalidation)
        : nextState?.invalidation_level != null
        ? Number(nextState.invalidation_level)
        : null;

    target1 =
      riskParams?.tp1 != null
        ? Number(riskParams.tp1)
        : parsedResponse.primary_target != null
        ? Number(parsedResponse.primary_target)
        : nextState?.target_1 != null
        ? Number(nextState.target_1)
        : null;

    target2 =
      riskParams?.tp2 != null
        ? Number(riskParams.tp2)
        : nextState?.target_2 != null
        ? Number(nextState.target_2)
        : null;

    target3 =
      riskParams?.tp3 != null
        ? Number(riskParams.tp3)
        : nextState?.target_3 != null
        ? Number(nextState.target_3)
        : null;

    // 3. Status determination (ACTIVE_SETUP vs NEUTRAL vs INVALIDATED vs COMPLETED)
    const rawStatus = (
      parsedResponse.status ??
      parsedResponse.next_database_state?.status ??
      ''
    ).toString().toUpperCase();

    if (rawStatus.includes('INVALIDAT')) {
      status = 'INVALIDATED';
    } else if (rawStatus.includes('STAND_DOWN') || rawStatus.includes('NEUTRAL') || tradeDirection === 'NEUTRAL') {
      status = 'NEUTRAL';
    } else if (
      rawStatus.includes('ACTIVE') ||
      rawStatus.includes('ARMED') ||
      (invalidationLevel !== null && (entryRangeLow !== null || target1 !== null))
    ) {
      status = 'ACTIVE_SETUP';
    } else if (rawStatus) {
      status = rawStatus;
    } else {
      status = 'COMPLETED';
    }
  }

  // ── Extract narrative ──
  const narrative =
    parsedResponse?.narrative ||
    parsedResponse?.narrative_summary ||
    parsedResponse?.sop_report?.trade_narrative ||
    text.slice(0, 1500);

  // ── Persist to PostgreSQL (ai_analysis_log) ──
  let logId: number | null = null;
  try {
    await ensureAiAnalysisTableInitialized();

    const insertResult = await sql`
      INSERT INTO ai_analysis_log (
        symbol, timeframe, requested_model, resolved_model, was_fallback, fallback_reason,
        execution_latency_ms, bias_signal, trade_direction, status,
        entry_range_low, entry_range_high, invalidation_level,
        target_1, target_2, target_3, narrative, raw_response, telemetry_data
      ) VALUES (
        ${symbol}, ${timeframe}, ${requestedModel}, ${resolvedModel}, ${wasFallback}, ${fallbackReason},
        ${totalExecutionLatency}, ${biasSignal}, ${tradeDirection}, ${status},
        ${entryRangeLow}, ${entryRangeHigh}, ${invalidationLevel},
        ${target1}, ${target2}, ${target3}, ${narrative}, ${text},
        ${JSON.stringify(telemetry)}
      )
      RETURNING id
    `;

    if (insertResult.rows.length > 0) {
      logId = insertResult.rows[0].id;
    }
  } catch (dbErr) {
    console.warn('[AI_CASCADE] Failed to log telemetry to ai_analysis_log (non-fatal):', dbErr);
  }

  // ── Upsert ai_trade_state row id=1 if next_database_state was returned ──
  try {
    const nextState = parsedResponse?.next_database_state;
    if (nextState && typeof nextState === 'object') {
      await sql`
        UPDATE ai_trade_state
        SET state_json = ${JSON.stringify(nextState)}, updated_at = NOW()
        WHERE id = 1
      `;
      console.log('[AI_CASCADE] ai_trade_state updated with next_database_state');
    }
  } catch (stateErr) {
    console.warn('[AI_CASCADE] Failed to update ai_trade_state:', stateErr);
  }

  // ── Auto-Log setup to directives/ETHUSDC_Daily_Tracker.md & .json if sop_report is present ──
  try {
    if (parsedResponse?.sop_report) {
      autoLogSopSetup(parsedResponse.sop_report, parsedResponse.next_database_state || undefined);
    }
  } catch (sopErr) {
    console.warn('[AI_CASCADE] Auto-log SOP setup warning:', sopErr);
  }

  return {
    text,
    telemetry,
    parsedResponse,
    status,
    tradeDirection,
    biasSignal,
    invalidationLevel,
    entryRangeLow,
    entryRangeHigh,
    target1,
    target2,
    target3,
    logId,
  };
}

export interface FetchHistoryOptions {
  limit?: number;
  page?: number;
  symbol?: string;
  status?: string;
}

export interface HistoryQueryResult {
  history: AiAnalysisRecord[];
  pagination: {
    total: number;
    limit: number;
    page: number;
    pages: number;
  };
}

/**
 * Fetch recent AI evaluation telemetry records from PostgreSQL
 */
export async function fetchAiAnalysisHistory(
  options: FetchHistoryOptions = {}
): Promise<HistoryQueryResult> {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
  const page = Math.max(Number(options.page) || 1, 1);
  const offset = (page - 1) * limit;
  const symbol = options.symbol?.trim() || '';
  const status = options.status?.trim() || '';

  await ensureAiAnalysisTableInitialized();

  try {
    // Dynamic query building
    let countResult;
    let dataResult;

    if (symbol && status) {
      countResult = await sql`
        SELECT COUNT(*)::integer AS total FROM ai_analysis_log
        WHERE symbol = ${symbol} AND status = ${status}
      `;
      dataResult = await sql`
        SELECT * FROM ai_analysis_log
        WHERE symbol = ${symbol} AND status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (symbol) {
      countResult = await sql`
        SELECT COUNT(*)::integer AS total FROM ai_analysis_log
        WHERE symbol = ${symbol}
      `;
      dataResult = await sql`
        SELECT * FROM ai_analysis_log
        WHERE symbol = ${symbol}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (status) {
      countResult = await sql`
        SELECT COUNT(*)::integer AS total FROM ai_analysis_log
        WHERE status = ${status}
      `;
      dataResult = await sql`
        SELECT * FROM ai_analysis_log
        WHERE status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      countResult = await sql`
        SELECT COUNT(*)::integer AS total FROM ai_analysis_log
      `;
      dataResult = await sql`
        SELECT * FROM ai_analysis_log
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const total = countResult.rows[0]?.total || 0;
    const pages = Math.ceil(total / limit) || 1;

    return {
      history: dataResult.rows as AiAnalysisRecord[],
      pagination: {
        total,
        limit,
        page,
        pages,
      },
    };
  } catch (err) {
    console.warn('[AI_CASCADE] Failed to fetch ai_analysis_log history (returning empty list):', err);
    return {
      history: [],
      pagination: {
        total: 0,
        limit,
        page: 1,
        pages: 1,
      },
    };
  }
}
