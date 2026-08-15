/**
 * @file src/lib/agentEngineHandlers.ts
 * @description Shared engine handler functions consumed by BOTH:
 *   - REST M2M Bridge:  /api/agent/context  (GET / POST)
 *   - MCP Server:       /api/mcp            (tools/call)
 *
 * Extracts all quant engine orchestration logic into pure async functions,
 * eliminating duplication between the two consumer routes.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  runGetMarketContext(symbol, timeframe)                      │
 * │    → Fetches fresh klines, runs all engine libs,            │
 * │      serializes AgentContextPayload                         │
 * │                                                             │
 * │  runSubmitQuantDecision(payload)                            │
 * │    → Validates, pre-flight invalidation check, DB persist   │
 * └─────────────────────────────────────────────────────────────┘
 *
 * @version 1.0.0 — Flow-State Quant Engine V15.3
 */

import { sql } from '@vercel/postgres';
import { serializeAgentContext } from '@/lib/agentContextSerializer';

import {
  fetchRestingLiquidity,
  fetchOIMetricsAndLiquidations,
  fetchSmartMoneySentiment,
  OrderFlowStateTracker,
} from '@/lib/orderFlowEngine';
import { detectActiveFVGs, mapAndConsolidateFVGs } from '@/lib/fvgEngine';
import { analyzeMarketStructureStateful } from '@/lib/structureEngine';
import { getSmtContext } from '@/lib/smtEngine';
import { resolveTripleVectorBias } from '@/lib/quantEngine/BiasEngine';
import { verifyDisplacement } from '@/lib/displacementEngine';

import type { AgentContextPayload, AgentDecisionPayload, AgentDecisionRecord } from '@/types/agentTypes';

// ─── Supported primary timeframes for structure analysis ──────────────────────

export type AgentTimeframe = '15m' | '5m' | '1m' | '1h';

// ─── DDL Schema Init (cached, shared with M2M route) ─────────────────────────

let isSchemaInitialized = false;

export async function ensureAgentDecisionTableInitialized(): Promise<void> {
  if (isSchemaInitialized) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS agent_decision_log (
        id                      SERIAL PRIMARY KEY,
        symbol                  VARCHAR(32)   NOT NULL,
        agent_id                VARCHAR(128)  NOT NULL,
        bias_signal             VARCHAR(64)   NOT NULL,
        entry_range_low         NUMERIC(16,4),
        entry_range_high        NUMERIC(16,4),
        invalidation_level      NUMERIC(16,4),
        target_1                NUMERIC(16,4),
        target_2                NUMERIC(16,4),
        narrative               TEXT,
        status                  VARCHAR(32)   NOT NULL DEFAULT 'PENDING',
        live_price_at_submission NUMERIC(16,4),
        submitted_at            BIGINT        NOT NULL,
        invalidated_at          BIGINT,
        created_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_agent_decision_symbol_status
        ON agent_decision_log(symbol, status, submitted_at DESC);
    `;
    isSchemaInitialized = true;
  } catch (error: any) {
    console.warn(`[agentEngineHandlers] ⚠️ Schema init fallback: ${error.message || error}`);
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/** Fetch live Binance Futures price. Returns null on failure. */
export async function fetchLivePrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = parseFloat(data.price);
    return isNaN(price) ? null : price;
  } catch {
    return null;
  }
}

/** Parse Binance raw klines array into the internal Candle shape. */
function parseBinanceKlines(raw: any[]): any[] {
  return raw.map((c: any) => {
    const vol = parseFloat(c[5]) || 0;
    const takerBuyVol = parseFloat(c[9]) || vol * 0.5;
    return {
      t: c[0],
      o: parseFloat(c[1]),
      h: parseFloat(c[2]),
      l: parseFloat(c[3]),
      c: parseFloat(c[4]),
      v: vol,
      taker_buy_vol: takerBuyVol,
      taker_sell_vol: vol - takerBuyVol,
      isClosed: true,
    };
  });
}

/** Fetch Binance Futures klines with graceful offline fallback. (Lesson #20) */
export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number
): Promise<any[]> {
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`[agentEngineHandlers] Binance klines HTTP ${res.status} for ${symbol}/${interval}.`);
      return [];
    }
    return parseBinanceKlines(await res.json());
  } catch (err: any) {
    console.warn(`[agentEngineHandlers] Klines fetch failed for ${symbol}/${interval}: ${err.message}.`);
    return [];
  }
}

/**
 * Compute Previous Day High / Low from 1h candles.
 * PDH/PDL anchor is used for dealing range and bias computation.
 */
function computePdhPdl(candles1h: any[]): { pdh: number; pdl: number } {
  if (candles1h.length === 0) return { pdh: 0, pdl: 0 };
  const getUtcDate = (t: number) => new Date(t);
  const lastCandle = candles1h[candles1h.length - 1];
  const lastDateUtc = getUtcDate(lastCandle.t);
  const prev = new Date(
    Date.UTC(lastDateUtc.getUTCFullYear(), lastDateUtc.getUTCMonth(), lastDateUtc.getUTCDate() - 1)
  );
  const prevYear = prev.getUTCFullYear();
  const prevMonth = prev.getUTCMonth();
  const prevDate = prev.getUTCDate();
  let pdh = 0;
  let pdl = Infinity;
  candles1h.forEach((c) => {
    const d = getUtcDate(c.t);
    if (d.getUTCFullYear() === prevYear && d.getUTCMonth() === prevMonth && d.getUTCDate() === prevDate) {
      if (c.h > pdh) pdh = c.h;
      if (c.l < pdl) pdl = c.l;
    }
  });
  return { pdh, pdl: pdl === Infinity ? 0 : pdl };
}

/** Compute today's Asian and London session high/low from 15m candles. */
function computeSessionLevels(candles15m: any[]) {
  if (candles15m.length === 0) {
    return { asian_high: null, asian_low: null, london_high: null, london_low: null };
  }
  const now = new Date();
  const currentDayStr = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
  const getRange = (startH: number, endH: number) => {
    const f = candles15m.filter((c) => {
      const d = new Date(c.t);
      return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` === currentDayStr &&
        d.getUTCHours() >= startH && d.getUTCHours() < endH;
    });
    if (!f.length) return { high: null, low: null };
    return { high: Math.max(...f.map((c) => c.h)), low: Math.min(...f.map((c) => c.l)) };
  };
  const asian = getRange(0, 7);
  const london = getRange(7, 12);
  return {
    asian_high: asian.high, asian_low: asian.low,
    london_high: london.high, london_low: london.low,
  };
}

/** Pre-flight invalidation guard result. */
export interface InvalidationCheckResult {
  breached: boolean;
  live_price: number;
  invalidation_level: number;
  breach_direction: 'ABOVE' | 'BELOW' | null;
}

/** Check whether live price has already breached the invalidation boundary. */
export function runInvalidationCheck(
  invalidationLevel: number,
  livePrice: number,
  biasSignal: string
): InvalidationCheckResult {
  const isBullish = biasSignal.includes('BULLISH');
  let breached = false;
  let breach_direction: 'ABOVE' | 'BELOW' | null = null;
  if (isBullish && livePrice < invalidationLevel) {
    breached = true;
    breach_direction = 'BELOW';
  } else if (!isBullish && livePrice > invalidationLevel) {
    breached = true;
    breach_direction = 'ABOVE';
  }
  return { breached, live_price: livePrice, invalidation_level: invalidationLevel, breach_direction };
}

// ─── Handler 1: runGetMarketContext ───────────────────────────────────────────

export interface GetMarketContextOptions {
  /** Trading pair symbol. Default: 'ETHUSDC' */
  symbol?: string;
  /**
   * Primary timeframe for market structure analysis.
   * Also controls which candle series is used as primary for FVG detection.
   *
   * - '15m' (default): institutional standard for ICT structure
   * - '5m': micro-structure / scalp precision
   * - '1m': ultra-short term / order flow confirmation
   * - '1h': macro swing context
   */
  timeframe?: AgentTimeframe;
}

export interface GetMarketContextResult {
  payload: AgentContextPayload;
  /** Candle counts fetched — useful for agent diagnostics */
  meta: {
    symbol: string;
    timeframe: AgentTimeframe;
    primary_candle_count: number;
    offline_mode: boolean;
    generated_at: number;
  };
}

/**
 * Core market context pipeline.
 *
 * Fetches fresh Binance klines, runs full quant engine stack, and returns
 * a serialized AgentContextPayload. Used by both /api/agent/context (GET)
 * and /api/mcp (tools/call → get_market_context).
 *
 * Timeframe parameter controls the primary analysis timeframe:
 *   - Structure engine runs on `timeframe` candles
 *   - FVGs detected on `timeframe` + supporting lower TF (one step below)
 *   - Displacement verified on `timeframe` candles
 */
export async function runGetMarketContext(
  options: GetMarketContextOptions = {}
): Promise<GetMarketContextResult> {
  const symbol = (options.symbol ?? 'ETHUSDC').toUpperCase();
  const timeframe: AgentTimeframe = options.timeframe ?? '15m';

  // Map timeframe to fetch limits (Lesson #3: only fetch what's needed)
  const TF_LIMITS: Record<AgentTimeframe, number> = {
    '1m': 300,
    '5m': 250,
    '15m': 200,
    '1h': 100,
  };

  // Supporting lower timeframe for FVG cross-confirmation
  const LOWER_TF: Record<AgentTimeframe, AgentTimeframe> = {
    '1h': '15m',
    '15m': '5m',
    '5m': '1m',
    '1m': '1m', // self (no lower)
  };

  const primaryLimit = TF_LIMITS[timeframe];
  const lowerTf = LOWER_TF[timeframe];
  const lowerLimit = TF_LIMITS[lowerTf];

  // ── Parallel data fetch (Promise.allSettled — resilient) ─────────────────
  await ensureAgentDecisionTableInitialized();

  const [
    primaryCandlesRaw,
    lowerCandlesRaw,
    candles1hRaw,
    candlesBtc5mRaw,
    candlesBtc15mRaw,
    oiMetrics,
    liquidityPools,
    smartMoneySentiment,
    recentTradesRes,
    lastDecisionRes,
  ] = await Promise.allSettled([
    fetchKlines(symbol, timeframe, primaryLimit),
    lowerTf !== timeframe ? fetchKlines(symbol, lowerTf, lowerLimit) : Promise.resolve([]),
    timeframe !== '1h' ? fetchKlines(symbol, '1h', 48) : Promise.resolve([]),
    fetchKlines('BTCUSDC', '5m', 100),
    fetchKlines('BTCUSDC', '15m', 100),
    fetchOIMetricsAndLiquidations(symbol).catch(() => ({
      open_interest_trend: 'UNAVAILABLE',
      displacement_sponsorship: 'INACTIVE',
      liquidation_events: { last_hour_purged: 'N/A', status: 'UNAVAILABLE' },
    })),
    fetchRestingLiquidity(symbol).catch(() => ({ BSL_Magnets: [], SSL_Magnets: [] })),
    fetchSmartMoneySentiment(symbol).catch(() => ({
      funding_rate_status: 'N/A',
      smart_money_divergence: false,
    })),
    sql`
      SELECT id, direction, status, symbol, entry_price, stop_loss,
             take_profit_1, take_profit_2, outcome, strategy_name,
             opened_at, closed_at
      FROM paper_trades
      ORDER BY created_at DESC
      LIMIT 5
    `.catch(() => ({ rows: [] })),
    sql`
      SELECT * FROM agent_decision_log
      WHERE symbol = ${symbol}
      ORDER BY submitted_at DESC
      LIMIT 1
    `.catch(() => ({ rows: [] })),
  ]);

  // ── Extract settled values ────────────────────────────────────────────────
  const primaryCandles = primaryCandlesRaw.status === 'fulfilled' ? primaryCandlesRaw.value : [];
  const lowerCandles = lowerCandlesRaw.status === 'fulfilled' ? lowerCandlesRaw.value : [];
  // For 1h timeframe, 1h candles ARE the primary — no separate 1h fetch
  const candles1h = timeframe === '1h' ? primaryCandles :
    (candles1hRaw.status === 'fulfilled' ? candles1hRaw.value : []);
  const candlesBtc5m = candlesBtc5mRaw.status === 'fulfilled' ? candlesBtc5mRaw.value : [];
  const candlesBtc15m = candlesBtc15mRaw.status === 'fulfilled' ? candlesBtc15mRaw.value : [];
  const oiResult = oiMetrics.status === 'fulfilled' ? oiMetrics.value : {
    open_interest_trend: 'UNAVAILABLE',
    displacement_sponsorship: 'INACTIVE',
    liquidation_events: { last_hour_purged: 'N/A', status: 'UNAVAILABLE' },
  };
  const pools = liquidityPools.status === 'fulfilled'
    ? liquidityPools.value
    : { BSL_Magnets: [], SSL_Magnets: [] };
  const sentiment = smartMoneySentiment.status === 'fulfilled' ? smartMoneySentiment.value : {
    funding_rate_status: 'N/A',
    smart_money_divergence: false,
  };
  const tradeRows = recentTradesRes.status === 'fulfilled'
    ? (recentTradesRes.value as any).rows ?? []
    : [];
  const lastDecisionRow = lastDecisionRes.status === 'fulfilled'
    ? ((lastDecisionRes.value as any).rows ?? [])[0] ?? null
    : null;

  const offlineMode = primaryCandles.length === 0;

  // ── Live price ────────────────────────────────────────────────────────────
  const currentLivePrice =
    primaryCandles.length > 0 ? primaryCandles[primaryCandles.length - 1].c : 0;

  // ── Market Structure (primary timeframe) ──────────────────────────────────
  const structureCandidates = primaryCandles.length > 0 ? primaryCandles : lowerCandles;
  const structureAnalysis = analyzeMarketStructureStateful(
    symbol,
    timeframe,
    structureCandidates,
    currentLivePrice,
    null,
    true // isInit — always fresh for agent snapshot
  );

  // ── FVGs: primary TF + lower TF ───────────────────────────────────────────
  const fvgsPrimary = detectActiveFVGs(primaryCandles, true);
  const fvgsLower = lowerTf !== timeframe ? detectActiveFVGs(lowerCandles, true) : [];
  const activeFVGs = mapAndConsolidateFVGs(fvgsPrimary, fvgsLower);

  // ── Displacement ──────────────────────────────────────────────────────────
  const displacementResult = await verifyDisplacement(primaryCandles).catch(() => ({
    displacement_active: false,
    institutional_sponsorship: { status: 'INACTIVE' },
  }));
  const displacementStatus =
    typeof (displacementResult as any)?.institutional_sponsorship === 'object'
      ? (displacementResult as any).institutional_sponsorship?.status ?? 'INACTIVE'
      : String((displacementResult as any)?.institutional_sponsorship ?? 'INACTIVE');

  const takerBuyRatio =
    primaryCandles.length > 0
      ? primaryCandles[primaryCandles.length - 1].taker_buy_vol /
        (primaryCandles[primaryCandles.length - 1].v || 1)
      : null;

  // ── PDH / PDL ─────────────────────────────────────────────────────────────
  const { pdh, pdl } = computePdhPdl(candles1h);

  // ── Session Levels (always based on available 15m-ish candles) ───────────
  const sessionSourceCandles = timeframe === '15m' ? primaryCandles
    : timeframe === '5m' ? lowerCandles
    : timeframe === '1m' ? lowerCandles
    : []; // 1h: session levels unavailable at that granularity
  const sessionLevels = computeSessionLevels(sessionSourceCandles);

  // ── OI delta ─────────────────────────────────────────────────────────────
  const oiDelta =
    oiResult.open_interest_trend === 'RISING' ? 1 :
    oiResult.open_interest_trend === 'FALLING' ? -1 : 0;

  // ── Macro Bias (BiasEngine triple-vector) ─────────────────────────────────
  const nearestHtfMagnet: { label: string; distance: number } | null =
    pdh > 0 && pdl > 0
      ? currentLivePrice < (pdh + pdl) / 2
        ? { label: 'PWH', distance: Math.abs(currentLivePrice - pdh) }
        : { label: 'PWL', distance: Math.abs(currentLivePrice - pdl) }
      : null;

  const dealingRangeEq = structureAnalysis.dealingRange?.equilibrium ?? null;
  const activeSwingPOC = dealingRangeEq ?? (pdh > 0 && pdl > 0 ? (pdh + pdl) / 2 : null);

  const resolvedBias: string = resolveTripleVectorBias({
    livePrice: currentLivePrice,
    nearest_htf_magnet: nearestHtfMagnet,
    activeSwingPOC,
    liquidation_status:
      typeof (oiResult as any).liquidation_events?.status === 'string'
        ? (oiResult as any).liquidation_events.status
        : 'PENDING',
    target_status: 'PENDING',
  });

  // ── SMT Context ───────────────────────────────────────────────────────────
  const ethPrevClose = primaryCandles.length > 1 ? primaryCandles[primaryCandles.length - 2].c : null;
  const btcPrevClose = candlesBtc15m.length > 1 ? candlesBtc15m[candlesBtc15m.length - 2].c : null;
  const btcPrice = candlesBtc5m.length > 0 ? candlesBtc5m[candlesBtc5m.length - 1].c : 0;
  const smtContext = getSmtContext({
    ethCandles5m: timeframe === '5m' ? primaryCandles : lowerCandles,
    btcCandles5m: candlesBtc5m,
    ethCandles15m: timeframe === '15m' ? primaryCandles : (lowerTf === '15m' ? lowerCandles : primaryCandles),
    btcCandles15m: candlesBtc15m,
    ethPrice: currentLivePrice,
    ethPrevClose,
    ethPdh: pdh,
    ethPdl: pdl,
    btcPrice,
    btcPrevClose,
    btcHigh1h: pdh,
    btcLow1h: pdl,
    btcPdh: pdh,
    btcPdl: pdl,
  });

  // ── Order Flow ────────────────────────────────────────────────────────────
  const trackerCandles = primaryCandles.length > 0 ? primaryCandles : lowerCandles;
  const currentCandleT = trackerCandles.length > 0
    ? trackerCandles[trackerCandles.length - 1].t
    : undefined;
  OrderFlowStateTracker.bootstrapFromCandles(symbol, trackerCandles);
  const stateTimeline = OrderFlowStateTracker.updateLiveState(
    symbol,
    oiResult.open_interest_trend,
    currentCandleT ?? Date.now(),
    currentLivePrice,
    { displacement_status: displacementStatus, liquidation_status: oiResult.liquidation_events?.status },
    currentCandleT
  );

  const orderFlowEngine = {
    open_interest_trend: oiResult.open_interest_trend,
    displacement_sponsorship: displacementStatus,
    resting_liquidity_pools: pools,
    liquidation_events: oiResult.liquidation_events,
    smart_money_sentiment: sentiment,
    state_timeline: stateTimeline,
  };

  // ── Serialize ─────────────────────────────────────────────────────────────
  const payload = serializeAgentContext({
    structureAnalysis,
    activeFVGs,
    orderFlowEngine,
    smtContext,
    currentPrice: currentLivePrice,
    pdh: pdh || null,
    pdl: pdl || null,
    macroBias: resolvedBias,
    displacementStatus,
    takerBuyRatio,
    oiDelta,
    sessionLevels,
    recentTrades: tradeRows,
    lastAgentDecision: lastDecisionRow as AgentDecisionRecord | null,
    symbol,
  });

  return {
    payload,
    meta: {
      symbol,
      timeframe,
      primary_candle_count: primaryCandles.length,
      offline_mode: offlineMode,
      generated_at: payload.generated_at,
    },
  };
}

// ─── Handler 2: runSubmitQuantDecision ────────────────────────────────────────

export interface SubmitQuantDecisionResult {
  success: boolean;
  id?: number;
  status?: string;
  submitted_at?: number;
  live_price: number | null;
  invalidation_guard: {
    checked: boolean;
    live_price?: number | null;
    passed?: boolean;
  };
}

/**
 * Submit and persist a structured quant analytical decision.
 *
 * Validates required fields, runs pre-flight invalidation guard (live Binance
 * price vs provided invalidation_level), then persists to agent_decision_log.
 *
 * Used by both /api/agent/context (POST) and /api/mcp (tools/call → submit_quant_decision).
 *
 * @throws Error with structured message on validation failure or invalidation breach.
 *         Callers should catch and map to appropriate HTTP status or MCP error content.
 */
export async function runSubmitQuantDecision(
  payload: AgentDecisionPayload
): Promise<SubmitQuantDecisionResult> {
  const { agent_id, symbol, bias_signal, invalidation_level } = payload;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!agent_id || typeof agent_id !== 'string') {
    throw Object.assign(new Error('Missing or invalid field: agent_id.'), { code: 'VALIDATION_ERROR', status: 400 });
  }
  if (!symbol || typeof symbol !== 'string') {
    throw Object.assign(new Error('Missing or invalid field: symbol.'), { code: 'VALIDATION_ERROR', status: 400 });
  }
  if (!bias_signal || typeof bias_signal !== 'string') {
    throw Object.assign(new Error('Missing or invalid field: bias_signal.'), { code: 'VALIDATION_ERROR', status: 400 });
  }

  const validBiasSignals = [
    'CONFIRMED_BULLISH', 'CONFIRMED_BEARISH', 'NEUTRAL', 'ABORT', 'COUNTER_TREND_RETRACEMENT',
  ];
  if (!validBiasSignals.includes(bias_signal)) {
    throw Object.assign(
      new Error(`Invalid bias_signal. Must be one of: ${validBiasSignals.join(', ')}.`),
      { code: 'VALIDATION_ERROR', status: 400 }
    );
  }

  // ── Pre-flight invalidation guard ─────────────────────────────────────────
  let livePriceAtSubmission: number | null = null;

  if (invalidation_level !== undefined && invalidation_level !== null) {
    const livePrice = await fetchLivePrice(symbol.toUpperCase());

    if (livePrice !== null) {
      livePriceAtSubmission = livePrice;
      const check = runInvalidationCheck(invalidation_level, livePrice, bias_signal);

      if (check.breached) {
        throw Object.assign(
          new Error(
            `INVALIDATION_BREACHED: Live price (${livePrice}) has already breached the submitted invalidation level (${invalidation_level}) in direction: ${check.breach_direction}. Decision rejected.`
          ),
          {
            code: 'INVALIDATION_BREACHED',
            status: 409,
            live_price: livePrice,
            invalidation_level,
            breach_direction: check.breach_direction,
          }
        );
      }
    } else {
      console.warn('[agentEngineHandlers] Could not fetch live price for invalidation check. Proceeding without guard.');
    }
  }

  // ── DB persist ────────────────────────────────────────────────────────────
  await ensureAgentDecisionTableInitialized();

  const now = Date.now();
  const result = await sql`
    INSERT INTO agent_decision_log (
      symbol, agent_id, bias_signal,
      entry_range_low, entry_range_high, invalidation_level,
      target_1, target_2, narrative,
      status, live_price_at_submission, submitted_at
    ) VALUES (
      ${symbol.toUpperCase()},
      ${agent_id},
      ${bias_signal},
      ${payload.entry_range_low ?? null},
      ${payload.entry_range_high ?? null},
      ${invalidation_level ?? null},
      ${payload.target_1 ?? null},
      ${payload.target_2 ?? null},
      ${payload.narrative ?? null},
      'ACTIVE',
      ${livePriceAtSubmission},
      ${now}
    )
    RETURNING id, submitted_at, status
  `;

  const inserted = result.rows[0];

  console.log(
    `[agentEngineHandlers] ✅ Decision persisted. id=${inserted.id} agent=${agent_id} bias=${bias_signal} symbol=${symbol}`
  );

  return {
    success: true,
    id: inserted.id,
    status: inserted.status,
    submitted_at: inserted.submitted_at,
    live_price: livePriceAtSubmission,
    invalidation_guard: invalidation_level !== undefined
      ? { checked: true, live_price: livePriceAtSubmission, passed: true }
      : { checked: false },
  };
}
