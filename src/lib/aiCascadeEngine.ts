import { GoogleGenerativeAI } from '@google/generative-ai';
import { sql, getDbPool } from '@/lib/postgres';
import { safeParseAiJson } from '@/lib/aiJsonParser';
import { autoLogSopSetup } from '@/lib/sopTrackerLogger';
import {
  getFallbackCascadePool,
  isLiteWorkhorseModel,
  getModelProvider,
  DEFAULT_MODEL,
  type ModelProvider,
} from '@/lib/aiModels';
import { callOpenRouterApi } from '@/lib/openRouterClient';
import { buildLiveSessionContext, type LiveSessionContext } from '@/lib/sessionContext';
import {
  reconcileSetupOutcomes,
  calculateDailyAuditMetrics,
  getCairoDayRange,
  type EnrichedAiAnalysisRecord,
  type DailyAuditMetrics,
  type SetupReconciledStatus,
} from '@/lib/quantEngine/SetupOutcomeReconciler';

export type { EnrichedAiAnalysisRecord, DailyAuditMetrics, SetupReconciledStatus };

export interface AiAttemptTelemetry {
  model: string;
  provider?: ModelProvider;
  latency_ms: number;
  error?: string;
  success: boolean;
}

export interface AiExecutionTelemetry {
  requested_model: string;
  resolved_model: string;
  provider?: ModelProvider;
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
  provider?: string | null;
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
  apiKey?: string;
  geminiApiKey?: string;
  openRouterApiKey?: string;
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
        requested_model         VARCHAR(128)  NOT NULL,
        resolved_model          VARCHAR(128)  NOT NULL,
        provider                VARCHAR(32)   DEFAULT 'GOOGLE',
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

    // Self-healing migration for agent_decision_log & ai_analysis_log telemetry columns
    const decisionLogMigrations = [
      sql`ALTER TABLE ai_analysis_log ADD COLUMN IF NOT EXISTS provider VARCHAR(32) DEFAULT 'GOOGLE'`,
      sql`ALTER TABLE ai_analysis_log ALTER COLUMN requested_model TYPE VARCHAR(128)`,
      sql`ALTER TABLE ai_analysis_log ALTER COLUMN resolved_model TYPE VARCHAR(128)`,
      sql`ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`,
      sql`ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS requested_model VARCHAR(128)`,
      sql`ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS resolved_model VARCHAR(128)`,
      sql`ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS provider VARCHAR(32) DEFAULT 'GOOGLE'`,
      sql`ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS latency_ms INTEGER`,
      sql`ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS was_fallback BOOLEAN DEFAULT FALSE`,
      sql`ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS fallback_reason TEXT`,
    ];
    for (const mig of decisionLogMigrations) {
      await mig.catch(() => {});
    }

    isAiAnalysisTableReady = true;
  } catch (err) {
    console.warn('[AI_CASCADE] Table init warning (proceeding in-memory):', err);
    isAiAnalysisTableReady = true; // prevent tight loop
  }
}

/**
 * Robust error categorization to identify recoverable quota exhaustion (429),
 * server overload/unavailability (503), timeouts, and fatal auth errors (401/403).
 */
export function isRecoverableAiError(error: unknown): { isRecoverable: boolean; reason: string } {
  if (!error) return { isRecoverable: false, reason: 'Unknown error' };

  const errObj = error as Record<string, unknown>;
  const status = Number(errObj.status || (errObj.response as Record<string, unknown>)?.status);
  const message = String(errObj.message || error);

  // 0. Non-recoverable auth / permission errors (immediate abort, never loop across models)
  if (status === 401 || /401|API_KEY_INVALID|unauthorized|invalid\s*api\s*key/i.test(message)) {
    return { isRecoverable: false, reason: '401 Invalid API Key' };
  }
  if (status === 403 || /403|PERMISSION_DENIED/i.test(message)) {
    return { isRecoverable: false, reason: '403 Permission Denied' };
  }
  if (status === 400 || /400|INVALID_ARGUMENT/i.test(message)) {
    return { isRecoverable: false, reason: `400 Bad Request: ${message.slice(0, 100)}` };
  }

  // 1. Quota Exhaustion / Rate Limits (429 / RESOURCE_EXHAUSTED)
  if (status === 429 || /429|quota|RESOURCE_EXHAUSTED|rate\s*limit/i.test(message)) {
    return { isRecoverable: true, reason: '429 Quota Exceeded' };
  }

  // 1b. Quota Exhaustion / Out of Credits (402 Payment Required / Insufficient credits)
  if (status === 402 || /402|insufficient.*credit|payment\s*required/i.test(message)) {
    return { isRecoverable: true, reason: '402 Insufficient Provider Credits' };
  }

  // 2. High traffic / Overloaded model / Service Unavailable (503 / UNAVAILABLE)
  if (status === 503 || /503|overloaded|Service Unavailable|UNAVAILABLE|high\s*traffic/i.test(message)) {
    return { isRecoverable: true, reason: '503 Service Overloaded' };
  }

  // 3. Model endpoint deprecated, preview disabled, or not found (404 / NOT_FOUND)
  if (status === 404 || /404|NOT_FOUND|model.*not found|is not supported/i.test(message)) {
    return { isRecoverable: true, reason: '404 Model Endpoint Unavailable' };
  }

  // 4. Timeouts & queue stalls (504 / 524 / 408 / AbortError / ETIMEDOUT)
  if (
    status === 504 ||
    status === 524 ||
    status === 408 ||
    /timeout|timed\s*out|AbortError|ECONNABORTED|ETIMEDOUT|queue\s*timeout/i.test(message)
  ) {
    return { isRecoverable: true, reason: 'Request Timeout / Queue Stalled' };
  }

  // 5. Any general 5xx upstream gateway/server issue
  if (status >= 500 && status < 600) {
    return { isRecoverable: true, reason: `HTTP ${status} Upstream Error` };
  }

  return { isRecoverable: false, reason: message.slice(0, 140) };
}

/**
 * Execute an AI evaluation with the automated multi-model cascade loop.
 * Abstracts Google Gemini and OpenRouter behind a unified resilient dispatch layer.
 */
export async function runAiCascadeEvaluation(
  params: CascadeEvaluationParams
): Promise<CascadeEvaluationResult> {
  const {
    apiKey,
    geminiApiKey = apiKey || process.env.GEMINI_LIVE_KEY,
    openRouterApiKey = process.env.OPENROUTER_API_KEY,
    requestedModel = DEFAULT_MODEL,
    systemPrompt,
    payload,
    historicalState = { status: 'SEARCHING' },
    symbol = 'ETHUSDC',
    timeframe = '5m',
  } = params;

  const totalStartTime = Date.now();
  let genAI: GoogleGenerativeAI | null = null;
  if (geminiApiKey) {
    genAI = new GoogleGenerativeAI(geminiApiKey);
  }

  // ── Construct prompt with live execution timestamps and session context ──
  const liveContext: LiveSessionContext =
    (payload?.session_context as LiveSessionContext) ||
    buildLiveSessionContext(new Date(), typeof payload?.live_price === 'number' ? payload.live_price : null);
  const sessionHeader = `=== [LIVE EXECUTION TIMESTAMPS & SESSION CONTEXT] ===\n- System Clock UTC: ${liveContext.timestamp_utc} (${liveContext.current_time_utc})\n- Localized Cairo Time: ${liveContext.timestamp_cairo} (${liveContext.current_time_cairo})\n- Active Institutional Killzone: ${liveContext.current_killzone}\n- In-Flight Live Price: ${liveContext.live_price != null ? `$${Number(liveContext.live_price).toFixed(2)}` : 'N/A'}\n- Millisecond Stamp: ${liveContext.execution_millisecond}\n\n`;

  const memorySection = `\n\n=== [HISTORICAL MEMORY (CURRENT STATE)] ===\n${JSON.stringify(historicalState, null, 2)}`;
  const marketDataPrompt = `${sessionHeader}=== MARKET DATA PAYLOAD ===\n${JSON.stringify(payload, null, 2)}${memorySection}`;
  const fullPromptForGemini = `${systemPrompt}\n\n${marketDataPrompt}`;

  // ── Build cascade pool: starts with requested model, cascades to Lite workhorses then reserve pool ──
  const cascadePool = getFallbackCascadePool(requestedModel);
  const attempts: AiAttemptTelemetry[] = [];

  let text = '';
  let resolvedModel = requestedModel;
  let wasFallback = false;
  let fallbackReason: string | null = null;

  for (let i = 0; i < cascadePool.length; i++) {
    const candidateModel = cascadePool[i];
    const candidateProvider = getModelProvider(candidateModel);
    const attemptStart = Date.now();

    try {
      const isLite = isLiteWorkhorseModel(candidateModel);
      if (i > 0) {
        console.warn(
          `[AI_CASCADE] Attempting fallback candidate #${i + 1}: ${candidateModel} (${candidateProvider} • ${isLite ? '500 RPD Workhorse' : 'Apex / Community'})`
        );
      }

      if (candidateProvider === 'OPENROUTER') {
        const orKey = openRouterApiKey || process.env.OPENROUTER_API_KEY;
        if (!orKey) {
          if (candidateModel === requestedModel) {
            const keyErr = new Error('401 Invalid API Key: OPENROUTER_API_KEY not configured in Settings or Environment');
            (keyErr as any).status = 401;
            throw keyErr;
          }
          // Secondary fallback provider unconfigured: record and continue cascade
          console.warn(`[AI_CASCADE] Skipping fallback candidate ${candidateModel}: OPENROUTER_API_KEY not configured.`);
          attempts.push({
            model: candidateModel,
            provider: candidateProvider,
            latency_ms: 0,
            error: 'OPENROUTER_API_KEY not configured (skipped)',
            success: false,
          });
          if (i === cascadePool.length - 1) {
            const errorSummary = attempts.map((a) => `${a.model} [${a.provider}]: ${a.error || 'Failed'}`).join(' | ');
            throw new Error(`All cascade models exhausted (${attempts.length} models attempted). Details: ${errorSummary}`);
          }
          continue;
        }

        const openRouterRes = await callOpenRouterApi({
          apiKey: orKey,
          model: candidateModel,
          prompt: marketDataPrompt,
          systemPrompt,
          temperature: 0.2,
          maxTokens: 4096,
          timeoutMs: 45000,
        });

        text = openRouterRes.content;
      } else {
        // Google Gemini Provider
        const gKey = geminiApiKey || apiKey || process.env.GEMINI_LIVE_KEY;
        if (!gKey) {
          if (candidateModel === requestedModel) {
            const keyErr = new Error('401 Invalid API Key: GEMINI_LIVE_KEY not configured in Settings or Environment');
            (keyErr as any).status = 401;
            throw keyErr;
          }
          // Secondary fallback provider unconfigured: record and continue cascade
          console.warn(`[AI_CASCADE] Skipping fallback candidate ${candidateModel}: GEMINI_LIVE_KEY not configured.`);
          attempts.push({
            model: candidateModel,
            provider: candidateProvider,
            latency_ms: 0,
            error: 'GEMINI_LIVE_KEY not configured (skipped)',
            success: false,
          });
          if (i === cascadePool.length - 1) {
            const errorSummary = attempts.map((a) => `${a.model} [${a.provider}]: ${a.error || 'Failed'}`).join(' | ');
            throw new Error(`All cascade models exhausted (${attempts.length} models attempted). Details: ${errorSummary}`);
          }
          continue;
        }

        if (!genAI) {
          genAI = new GoogleGenerativeAI(gKey);
        }

        const model = genAI.getGenerativeModel({ model: candidateModel });
        const result = await model.generateContent(fullPromptForGemini);
        text = result.response.text();
      }

      if (!text || !text.trim()) {
        const emptyErr = new Error(`Received empty or blank response from ${candidateModel}`);
        (emptyErr as any).status = 502;
        throw emptyErr;
      }

      const attemptLatency = Date.now() - attemptStart;
      attempts.push({
        model: candidateModel,
        provider: candidateProvider,
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
        `[AI_CASCADE] Model ${candidateModel} (${candidateProvider}) failed (${reason}) in ${attemptLatency}ms:`,
        (err as Error)?.message || err
      );

      attempts.push({
        model: candidateModel,
        provider: candidateProvider,
        latency_ms: attemptLatency,
        error: reason,
        success: false,
      });

      if (!fallbackReason) {
        fallbackReason = `${reason} on ${candidateModel} (${candidateProvider})`;
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
        const errorSummary = attempts.map((a) => `${a.model} [${a.provider}]: ${a.error || 'Failed'}`).join(' | ');
        throw new Error(`All cascade models exhausted (${attempts.length} models attempted). Details: ${errorSummary}`);
      }
    }
  }

  const resolvedProvider = getModelProvider(resolvedModel);
  const totalExecutionLatency = Date.now() - totalStartTime;

  const telemetry: AiExecutionTelemetry = {
    requested_model: requestedModel,
    resolved_model: resolvedModel,
    provider: resolvedProvider,
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

    // ── Veto State Cleanliness & Programmatic Valuation Guard (Constraint 3) ──
    const narrativeText = (
      parsedResponse.narrative ||
      parsedResponse.narrative_summary ||
      parsedResponse.sop_report?.trade_narrative ||
      text ||
      ''
    );
    const hasValuationVeto =
      narrativeText.includes('VALUATION_VETO') ||
      String(parsedResponse.next_database_state?.notes || '').includes('VALUATION_VETO');

    const pricingStatus = (
      payload?.ipda_metrics as any
    )?.pricing_context?.local_dealing_range?.current_status || (payload?.ipda_metrics as any)?.current_pricing;

    const isValuationMismatch =
      (pricingStatus === 'PREMIUM' && (tradeDirection === 'LONG' || biasSignal === 'BULLISH')) ||
      (pricingStatus === 'DISCOUNT' && (tradeDirection === 'SHORT' || biasSignal === 'BEARISH'));

    if (hasValuationVeto || isValuationMismatch) {
      biasSignal = 'NEUTRAL';
      tradeDirection = 'NEUTRAL';
      status = 'NEUTRAL';
      entryRangeLow = null;
      entryRangeHigh = null;
      invalidationLevel = null;
      target1 = null;
      target2 = null;
      target3 = null;

      parsedResponse.bias_signal = 0;
      parsedResponse.bias_label = 'NEUTRAL';
      if (!parsedResponse.next_database_state) {
        parsedResponse.next_database_state = {};
      }
      parsedResponse.next_database_state.status = 'SEARCHING';
      parsedResponse.next_database_state.trade_direction = null;
      parsedResponse.next_database_state.invalidation_level = null;
      parsedResponse.next_database_state.target_level = null;
      parsedResponse.next_database_state.active_setup_id = null;

      if (isValuationMismatch && !hasValuationVeto) {
        const vetoMsg = `[VALUATION_VETO] ${pricingStatus === 'PREMIUM' ? 'Long prohibited in Premium territory' : 'Short prohibited in Discount territory'}. Automatic valuation gate enforced.`;
        parsedResponse.narrative = `${vetoMsg} ${parsedResponse.narrative || ''}`.trim();
        parsedResponse.next_database_state.notes = vetoMsg;
      }
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
        symbol, timeframe, requested_model, resolved_model, provider, was_fallback, fallback_reason,
        execution_latency_ms, bias_signal, trade_direction, status,
        entry_range_low, entry_range_high, invalidation_level,
        target_1, target_2, target_3, narrative, raw_response, telemetry_data
      ) VALUES (
        ${symbol}, ${timeframe}, ${requestedModel}, ${resolvedModel}, ${resolvedProvider}, ${wasFallback}, ${fallbackReason},
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

  // ── Upsert ai_trade_state row id=1 if next_database_state was returned (Non-destructive merge) ──
  try {
    const nextState = parsedResponse?.next_database_state;
    if (nextState && typeof nextState === 'object') {
      let existingState: Record<string, unknown> =
        historicalState && typeof historicalState === 'object'
          ? { ...historicalState }
          : {};

      try {
        const stateRes = await sql`SELECT state_json FROM ai_trade_state WHERE id = 1`;
        if (stateRes.rows.length > 0 && stateRes.rows[0].state_json) {
          const raw = stateRes.rows[0].state_json;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (parsed && typeof parsed === 'object') {
            existingState = { ...existingState, ...parsed };
          }
        }
      } catch (readErr) {
        console.warn('[AI_CASCADE] Failed to read existing ai_trade_state before merge (falling back to historicalState):', readErr);
      }

      // Explicitly preserve and deduplicate historical arrays (specifically recent_mistakes_lessons)
      const existingLessons = Array.isArray(existingState.recent_mistakes_lessons)
        ? existingState.recent_mistakes_lessons
        : [];
      const nextLessons = Array.isArray((nextState as any).recent_mistakes_lessons)
        ? (nextState as any).recent_mistakes_lessons
        : [];

      const seenLessons = new Set<string>();
      const combinedLessons: unknown[] = [];
      for (const item of [...nextLessons, ...existingLessons]) {
        const key = typeof item === 'string'
          ? item.trim()
          : item && typeof item === 'object'
          ? ((item as any).lesson || (item as any).setup_id ? `${(item as any).setup_id || ''}::${(item as any).lesson || ''}` : JSON.stringify(item))
          : JSON.stringify(item);
        if (!seenLessons.has(key)) {
          seenLessons.add(key);
          combinedLessons.push(item);
        }
      }

      const mergedState = {
        ...existingState,
        ...nextState,
        recent_mistakes_lessons: combinedLessons.slice(0, 20),
        updated_at: new Date().toISOString(),
      };

      await sql`
        INSERT INTO ai_trade_state (id, state_json, updated_at)
        VALUES (1, ${JSON.stringify(mergedState)}, NOW())
        ON CONFLICT (id) DO UPDATE
        SET state_json = ${JSON.stringify(mergedState)}, updated_at = NOW()
      `;
      console.log('[AI_CASCADE] ai_trade_state merged non-destructively with next_database_state');
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
  startDate?: string;
  endDate?: string;
  currentPrice?: number | null;
}

export interface HistoryQueryResult {
  history: EnrichedAiAnalysisRecord[];
  summary: DailyAuditMetrics;
  pagination: {
    total: number;
    limit: number;
    page: number;
    pages: number;
  };
}

/**
 * Fetch recent AI evaluation telemetry records from PostgreSQL with
 * temporal date filtering, dynamic outcome reconciliation, and daily audit KPIs.
 */
export async function fetchAiAnalysisHistory(
  options: FetchHistoryOptions = {}
): Promise<HistoryQueryResult> {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const page = Math.max(Number(options.page) || 1, 1);
  const offset = (page - 1) * limit;
  const symbol = options.symbol?.trim() || '';
  const status = options.status?.trim() || '';
  const startDate = options.startDate?.trim() || '';
  const endDate = options.endDate?.trim() || '';

  await ensureAiAnalysisTableInitialized();

  try {
    const pool = getDbPool();
    const conditions: string[] = [];
    const params: any[] = [];

    if (symbol) {
      params.push(symbol);
      conditions.push(`symbol = $${params.length}`);
    }

    if (status && status !== 'ALL') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    // Temporal date range filtering
    if (startDate || endDate) {
      let startBound: Date | null = null;
      let endBound: Date | null = null;

      if (startDate && endDate) {
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
      } else if (startDate) {
        const range = getCairoDayRange(startDate);
        startBound = new Date(range.startIso);
        endBound = new Date(range.endIso);
      } else if (endDate) {
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

    // 1. Total count query
    const countSql = `SELECT COUNT(*)::integer AS total FROM ai_analysis_log ${whereClause}`;
    const countResult = await pool.query(countSql, params);
    const total = countResult.rows[0]?.total || 0;
    const pages = Math.ceil(total / limit) || 1;

    // 2. Data query
    const queryParams = [...params, limit, offset];
    const limitIdx = queryParams.length - 1;
    const offsetIdx = queryParams.length;

    const dataSql = `
      SELECT * FROM ai_analysis_log
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const dataResult = await pool.query(dataSql, queryParams);
    const rawRecords = dataResult.rows as AiAnalysisRecord[];

    // 3. Dynamic setup outcome reconciliation
    const reconciledHistory = await reconcileSetupOutcomes(rawRecords, {
      currentPrice: options.currentPrice,
    });

    // 4. Daily audit summary metrics
    const summary = calculateDailyAuditMetrics(reconciledHistory);

    return {
      history: reconciledHistory,
      summary,
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
      summary: {
        totalRuns: 0,
        activeSetups: 0,
        neutralCount: 0,
        invalidatedCount: 0,
        winsCount: 0,
        tp1Count: 0,
        tp2Count: 0,
        lossesCount: 0,
        breakevenCount: 0,
        expiredCount: 0,
        cancelledCount: 0,
        primaryModelCount: 0,
        fallbackCount: 0,
        avgLatencyMs: 0,
      },
      pagination: {
        total: 0,
        limit,
        page: 1,
        pages: 1,
      },
    };
  }
}
