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

import { sql } from '@/lib/postgres';
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
import * as fs from 'fs';
import * as path from 'path';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup,
  SweepReclaimAnchorType,
} from '@/lib/quantEngine/SweepReclaimEngine';
import { computeStructuralBootstrap } from '@/lib/quantEngine/structuralBootstrap';
import {
  calculate1to1ExecutionTelemetry,
  calculateCompoundingMetrics,
  formatCairoDateTime,
  StandardizedExecutedTrade,
} from '@/lib/quantEngine/equityCalculator';
import {
  FACTORY_SWEEP_RECLAIM_PRESETS,
  SweepReclaimPresetConfig,
} from '@/lib/quantEngine/scannerPresets';
import { MarketStructureAPI } from '@/lib/quantEngine/MarketStructureAPI';
import type { Candle } from '@/lib/fvgEngine';

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
    const o = parseFloat(c[1]);
    const h = parseFloat(c[2]);
    const l = parseFloat(c[3]);
    const close = parseFloat(c[4]);
    const vol = parseFloat(c[5]) || 0;
    let rawTakerBuy = parseFloat(c[9]);
    let takerBuyVol: number;
    if (Number.isFinite(rawTakerBuy) && !isNaN(rawTakerBuy) && rawTakerBuy > 0) {
      takerBuyVol = parseFloat(rawTakerBuy.toFixed(4));
    } else {
      const range = Math.max(0.0001, h - l);
      const conviction = Math.min(1.0, Math.max(0.0, (close - l) / range));
      takerBuyVol = parseFloat((conviction * vol).toFixed(4));
    }
    return {
      t: c[0],
      o,
      h,
      l,
      c: close,
      v: vol,
      taker_buy_vol: takerBuyVol,
      taker_sell_vol: parseFloat(Math.max(0, vol - takerBuyVol).toFixed(4)),
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
 * Robust paginated historical fetcher supporting multi-month lookbacks.
 */
export async function fetchPagedKlines(
  symbol: string,
  interval: string,
  startMs: number,
  endMs: number,
  onProgress?: (fetchedCount: number, currentTimestamp: number) => void
): Promise<any[]> {
  const allKlines: any[] = [];
  let currentStart = startMs;
  const limit = 1000;
  const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/klines';

  while (currentStart < endMs) {
    const url = `${BINANCE_REST}?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&endTime=${endMs - 1}&limit=${limit}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) {
        console.warn(`[agentEngineHandlers] Binance kline fetch warning [${interval}]: ${res.status}`);
        break;
      }
      const raw: unknown[][] = await res.json();
      if (!raw || raw.length === 0) break;

      const parsed = parseBinanceKlines(raw);
      allKlines.push(...parsed);

      if (onProgress) {
        onProgress(allKlines.length, parsed[parsed.length - 1].t);
      }

      const lastTime = Number(raw[raw.length - 1][0]);
      if (lastTime <= currentStart) break;
      currentStart = lastTime + 1;

      if (raw.length < limit) break;

      // Rate limit pacing: 40ms pause between pages
      await new Promise((resolve) => setTimeout(resolve, 40));
    } catch (err) {
      console.warn(`[agentEngineHandlers] Fetch interrupted, continuing with ${allKlines.length} candles.`, err);
      break;
    }
  }

  return allKlines;
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
  if (biasSignal === 'NEUTRAL' || biasSignal === 'ABORT' || !invalidationLevel) {
    return { breached: false, live_price: livePrice, invalidation_level: invalidationLevel, breach_direction: null };
  }
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

// ─── Handler 3: runQuantBacktest ──────────────────────────────────────────────

export interface QuantBacktestOptions {
  /** Symbol to backtest. Default: 'ETHUSDC' */
  symbol?: string;
  /** Primary candle resolution. Default: '5m' */
  timeframe?: string;
  /** Strategy preset ID. Default: 'factory_sr_5m_fvg_ce_sniper_v3' */
  preset_id?: string;
  /** Historical lookback in days. Default: 30, max: 365 */
  days_lookback?: number;
  /** Explicit start date YYYY-MM-DD */
  start_date?: string;
  /** Explicit end date YYYY-MM-DD */
  end_date?: string;
  /** Initial capital in USD. Default: 1000 */
  initial_equity?: number;
  /** Risk per trade in percentage (1.0R). Default: 2.0 */
  risk_per_trade_pct?: number;
  /** Compounding calculation model */
  compounding_mode?: 'DYNAMIC_COMPOUNDING' | 'FIXED_FRACTIONAL';
  /** Optional override for fee-padded breakeven toggle */
  enable_fee_padded_breakeven?: boolean;
  /** Optional override for fee-padded breakeven percentage */
  breakeven_offset_pct?: number;
  /** Optional override for Binance Maker fee % (default: 0.0000%) */
  maker_fee_pct?: number;
  /** Optional override for Binance Taker fee % (default: 0.0400%) */
  taker_fee_pct?: number;

  // ── 🔬 Inline Parameter Overrides for Fee-Resilient Tournament ──
  // These override the resolved preset's config for single-variable experiments.
  /** Override body-to-range ratio threshold (default: preset value) */
  body_ratio_threshold?: number;
  /** Override volume expansion threshold multiplier (default: preset value) */
  volume_expansion_threshold?: number;
  /** Override TP2 (stage2) R-multiple (default: preset value) */
  stage2_multiple?: number;
  /** Override early breakeven MFE multiple (default: preset value) */
  early_breakeven_multiple?: number;
  /** Override max bars to retest / FVG retest TTL (default: preset value) */
  max_bars_to_retest?: number;
  /** Override anchor types array (default: preset value). Accepts: SWING_PIVOT, PDH, PDL, ASIAN_HIGH, ASIAN_LOW, LONDON_HIGH, LONDON_LOW */
  anchor_types?: string[];
  /** Override TP1/TP2 tranche split ratios. E.g. [0.60, 0.40] for 60/40 */
  stage_ratios?: number[];
}

export async function runQuantBacktest(options: QuantBacktestOptions = {}) {
  const symbol = (options.symbol ?? 'ETHUSDC').toUpperCase();
  const timeframe = options.timeframe ?? '5m';
  const daysLookback = Math.min(365, Math.max(1, options.days_lookback ?? 30));

  let startMs: number;
  let endMs: number;

  if (options.start_date && options.end_date) {
    startMs = Date.parse(`${options.start_date}T00:00:00.000Z`);
    endMs = Date.parse(`${options.end_date}T23:59:59.000Z`);
  } else {
    endMs = Date.now();
    startMs = endMs - daysLookback * 24 * 60 * 60 * 1000;
  }

  // 1. Resolve preset configuration
  const preset =
    FACTORY_SWEEP_RECLAIM_PRESETS.find((p) => p.id === options.preset_id) ||
    FACTORY_SWEEP_RECLAIM_PRESETS[0];
  const pConfig = preset.config as SweepReclaimPresetConfig;

  // 2. T-Zero Structural Seed / Bootstrap Warmup
  const { warmupStartMs, bootstrap } = await computeStructuralBootstrap(symbol, timeframe, startMs, {
    lookbackMajor: pConfig.lookbackMajor,
    lookbackInternal: pConfig.lookbackInternal,
  });

  // 3. Paginated Kline Fetching from Binance Futures
  const candles = await fetchPagedKlines(symbol, timeframe, warmupStartMs, endMs);
  if (candles.length === 0) {
    throw new Error(`No candles fetched from Binance for ${symbol} on ${timeframe}. Check network connection.`);
  }

  // 4. Dealing Range derivation for short scans (<= 2000 candles)
  let structural_dealing_range = null;
  if (candles.length >= 25 && candles.length <= 2000) {
    try {
      const msApi = new MarketStructureAPI({
        lookbackMajor: pConfig.lookbackMajor,
        lookbackInternal: pConfig.lookbackInternal,
      });
      const lastCandle = candles[candles.length - 1];
      const lastPrice = lastCandle.c ?? (lastCandle as any).close ?? 0;
      const structure = bootstrap
        ? msApi.analyzeWithBootstrap(candles, lastPrice, undefined, bootstrap)
        : msApi.analyze(candles, lastPrice);
      const structEq = structure?.dealingRange?.equilibrium;
      if (structEq !== null && structEq !== undefined && Number.isFinite(structEq) && structEq > 0) {
        structural_dealing_range = {
          high: Number(structure.dealingRange.high),
          low: Number(structure.dealingRange.low),
          equilibrium: parseFloat(structEq.toFixed(4)),
        };
      }
    } catch (msErr) {
      console.warn('[runQuantBacktest] Dealing range fallback error:', msErr);
    }
  }

  // 5. Build Engine Configuration with 1:1 Execution Parity
  // 🔬 Inline overrides (options.*) take precedence over preset values (pConfig.*) for tournament experiments
  const effectiveBodyRatio = options.body_ratio_threshold ?? pConfig.bodyRatioThreshold;
  const effectiveVolExpansion = options.volume_expansion_threshold ?? pConfig.volumeExpansionThreshold;
  const effectiveStage2 = options.stage2_multiple ?? pConfig.stage2Multiple;
  const effectiveEarlyBE = options.early_breakeven_multiple ?? pConfig.earlyBreakevenMultiple ?? 0.40;
  const effectiveMaxRetest = options.max_bars_to_retest ?? pConfig.maxBarsToRetest;
  const effectiveAnchors = (options.anchor_types as SweepReclaimAnchorType[] | undefined) ?? pConfig.anchorTypes;
  const effectiveStage1Ratio = options.stage_ratios?.[0] ?? pConfig.stage1Ratio;
  const effectiveStage2Ratio = options.stage_ratios?.[1] ?? pConfig.stage2Ratio;

  const scanConfig: SweepReclaimScanConfig = {
    symbol,
    timeframe,
    anchorTypes: effectiveAnchors,
    lookbackMajor: pConfig.lookbackMajor,
    lookbackInternal: pConfig.lookbackInternal,
    maxBarsAnchorToSweep: pConfig.maxBarsAnchorToSweep,
    maxBarsSweepToReclaim: pConfig.maxBarsSweepToReclaim,
    maxBarsToRetest: effectiveMaxRetest,
    volumeSmaPeriod: pConfig.volumeSmaPeriod ?? 20,
    volumeExpansionThreshold: effectiveVolExpansion,
    deltaDominanceThreshold: pConfig.deltaDominanceThreshold,
    bodyRatioThreshold: effectiveBodyRatio,
    minBodyRatio: effectiveBodyRatio,
    requireThreePillarDisplacement: pConfig.requireThreePillarDisplacement,
    enforceDiscountPremiumGate: pConfig.enforceDiscountPremiumGate,
    enableRegimeAdaptiveEQ: true,
    enableInScannerWaveDedup: pConfig.enableWaveDeduplication ?? true,
    enforceSinglePositionConcurrency: true,
    pullbackExcursionThreshold: 0.5,
    structuralDealingRange: structural_dealing_range,
    stage1Multiple: pConfig.stage1Multiple,
    stage2Multiple: effectiveStage2,
    stage3Multiple: pConfig.stage3Multiple,
    stage1Ratio: effectiveStage1Ratio,
    stage2Ratio: effectiveStage2Ratio,
    entryMode: pConfig.entryMode,
    enableStructuralTrail: pConfig.enableStructuralTrail,
    enableProfitRatchet: pConfig.enableProfitRatchet,
    minSweepDepthAtrMultiplier: pConfig.minSweepDepthAtrMultiplier,
    slBufferAtrMultiplier: pConfig.slBufferAtrMultiplier,
    enableWaveDeduplication: pConfig.enableWaveDeduplication ?? true,
    filterWeekend: pConfig.filterWeekend ?? false,
    enforceHtfBiasGuard: pConfig.enforceHtfBiasGuard ?? false,
    enableEarlyBreakeven: pConfig.enableEarlyBreakeven ?? true,
    earlyBreakevenMultiple: effectiveEarlyBE,
    enableFeePaddedBreakeven: options.enable_fee_padded_breakeven !== undefined ? options.enable_fee_padded_breakeven : (pConfig.enableFeePaddedBreakeven ?? true),
    breakevenOffsetPct: options.breakeven_offset_pct !== undefined ? options.breakeven_offset_pct : (pConfig.breakevenOffsetPct ?? 0.05),
    postLossCooldownMinutes: pConfig.postLossCooldownMinutes ?? 0,
  };

  // 6. Execute Sweep & Reclaim Engine
  const engine = new SweepReclaimEngine(scanConfig);
  const { setups } = engine.scanHistoricalSetups(candles, bootstrap);

  // 7. Calculate Reconciled Execution Summary & Sequential Compounding
  const makerFeePct = options.maker_fee_pct !== undefined ? options.maker_fee_pct : (pConfig.makerFeePct ?? 0.0000);
  const takerFeePct = options.taker_fee_pct !== undefined ? options.taker_fee_pct : (pConfig.takerFeePct ?? 0.0400);

  const summary = calculate1to1ExecutionTelemetry(setups, {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: pConfig.enableWaveDeduplication ?? true,
    filterWeekend: pConfig.filterWeekend ?? false,
    enforceHtfBiasGuard: pConfig.enforceHtfBiasGuard ?? false,
    enableEarlyBreakeven: pConfig.enableEarlyBreakeven ?? true,
    earlyBreakevenMultiple: pConfig.earlyBreakevenMultiple ?? 0.40,
    enableFeePaddedBreakeven: scanConfig.enableFeePaddedBreakeven,
    breakevenOffsetPct: scanConfig.breakevenOffsetPct,
    postLossCooldownMinutes: pConfig.postLossCooldownMinutes ?? 0,
    makerFeePct,
    takerFeePct,
  });

  const initialCapital = options.initial_equity ?? 1000;
  const riskPct = options.risk_per_trade_pct ?? 2.0;
  const compounding = calculateCompoundingMetrics(summary.executedTrades, {
    initialCapital,
    riskPerTradePct: riskPct,
    compoundingMode: options.compounding_mode ?? 'DYNAMIC_COMPOUNDING',
    makerFeePct,
    takerFeePct,
  });

  // Recent executed trades (last 10)
  const recentTrades = summary.executedTrades.slice(-10).map((t: StandardizedExecutedTrade) => ({
    id: t.id,
    date_cairo: t.dateStr,
    direction: t.direction,
    entry_price: t.entryPrice,
    stop_loss: t.stopLossPrice,
    exit_price: t.exitPrice ?? null,
    realized_r: t.realizedR,
    net_realized_r: t.netRealizedR ?? t.realizedR,
    fee_in_r: t.feeInR ?? 0,
    outcome: t.outcome,
    label: t.label,
  }));

  return {
    status: 'SUCCESS',
    preset: {
      id: preset.id,
      name: preset.name,
      entry_mode: pConfig.entryMode,
      stage1_multiple: pConfig.stage1Multiple,
      stage2_multiple: pConfig.stage2Multiple,
      early_breakeven_multiple: pConfig.earlyBreakevenMultiple,
      enable_fee_padded_breakeven: scanConfig.enableFeePaddedBreakeven,
      breakeven_offset_pct: scanConfig.breakevenOffsetPct,
      maker_fee_pct: makerFeePct,
      taker_fee_pct: takerFeePct,
    },
    date_range: {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      days: Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)),
      total_candles: candles.length,
    },
    performance: {
      total_scanned_setups: summary.totalScannedSetups,
      total_executed_trades: summary.totalExecutedTrades,
      winning_trades: summary.totalWinningTrades,
      losing_trades: summary.totalLosingTrades,
      be_scratches: summary.totalBeScratches,
      win_rate_pct: summary.executionWinRatePct,
      win_rate_ex_scratch_pct: summary.winRateExScratchPct,
      // Dual Gross / Net Performance Mandate
      gross_realized_r: summary.grossRealizedR ?? summary.totalRealizedR,
      net_realized_r: summary.netRealizedR ?? summary.totalRealizedR,
      total_fees_paid_r: summary.totalFeesPaidR ?? 0,
      total_fees_paid_usd: compounding.totalFeesPaidUsd ?? 0,
      total_realized_r: summary.netRealizedR ?? summary.totalRealizedR, // Net-First primary
      avg_realized_r: summary.avgRealizedR,
      profit_factor: summary.profitFactor, // Net Profit Factor
      gross_profit_factor: summary.grossProfitFactor ?? summary.profitFactor,
      net_profit_factor: summary.netProfitFactor ?? summary.profitFactor,
      max_drawdown_r: summary.maxDrawdownR,
      max_drawdown_pct: compounding.maxDrawdownPct,
      initial_equity_usd: compounding.initialCapital,
      nominal_final_equity_usd: compounding.nominalFinalEquity ?? compounding.finalRealizedEquity,
      final_equity_usd: parseFloat(compounding.finalRealizedEquity.toFixed(2)), // Net final equity
      net_pnl_usd: parseFloat(compounding.realizedNetPnlUsd.toFixed(2)),
      net_roi_pct: parseFloat(compounding.realizedNetRoiPct.toFixed(2)),
      longest_win_streak: compounding.longestWinStreak,
      longest_loss_streak: compounding.longestLossStreak,
    },
    vetoed_breakdown: summary.vetoedBreakdown,
    recent_trades: recentTrades,
  };
}

// ─── Handler 4: runGetTradeDiagnostics ────────────────────────────────────────

export interface TradeDiagnosticsOptions {
  symbol?: string;
  timeframe?: string;
  target_price?: number;
  timestamp?: string | number;
  lookback_candles?: number;
}

export async function runGetTradeDiagnostics(options: TradeDiagnosticsOptions = {}) {
  const symbol = (options.symbol ?? 'ETHUSDC').toUpperCase();
  const timeframe = options.timeframe ?? '5m';
  const lookback = Math.min(1500, Math.max(50, options.lookback_candles ?? 300));

  const endMs = Date.now();
  // For fast sub-second diagnostics, fetch recent lookback + buffer candles directly
  const fetchLimit = Math.min(1000, lookback + 200);
  const candles = await fetchKlines(symbol, timeframe, fetchLimit);
  if (candles.length === 0) {
    throw new Error(`Failed to load candles for trade diagnostics (${symbol} ${timeframe}).`);
  }

  const preset = FACTORY_SWEEP_RECLAIM_PRESETS[0];
  const pConfig = preset.config as SweepReclaimPresetConfig;

  let structural_dealing_range = null;
  if (candles.length >= 25) {
    try {
      const msApi = new MarketStructureAPI({ lookbackMajor: 10, lookbackInternal: 5 });
      const lastCandle = candles[candles.length - 1];
      const lastPrice = lastCandle.c ?? (lastCandle as any).close ?? 0;
      const structure = msApi.analyze(candles, lastPrice);
      const structEq = structure?.dealingRange?.equilibrium;
      if (structEq && Number.isFinite(structEq) && structEq > 0) {
        structural_dealing_range = {
          high: Number(structure.dealingRange.high),
          low: Number(structure.dealingRange.low),
          equilibrium: parseFloat(structEq.toFixed(4)),
        };
      }
    } catch (e) {
      console.warn('[runGetTradeDiagnostics] Dealing range fallback error:', e);
    }
  }

  const scanConfig: SweepReclaimScanConfig = {
    symbol,
    timeframe,
    anchorTypes: pConfig.anchorTypes,
    lookbackMajor: pConfig.lookbackMajor,
    lookbackInternal: pConfig.lookbackInternal,
    maxBarsAnchorToSweep: pConfig.maxBarsAnchorToSweep,
    maxBarsSweepToReclaim: pConfig.maxBarsSweepToReclaim,
    maxBarsToRetest: pConfig.maxBarsToRetest,
    volumeSmaPeriod: pConfig.volumeSmaPeriod ?? 20,
    volumeExpansionThreshold: pConfig.volumeExpansionThreshold,
    deltaDominanceThreshold: pConfig.deltaDominanceThreshold,
    bodyRatioThreshold: pConfig.bodyRatioThreshold,
    minBodyRatio: pConfig.bodyRatioThreshold,
    requireThreePillarDisplacement: pConfig.requireThreePillarDisplacement,
    enforceDiscountPremiumGate: pConfig.enforceDiscountPremiumGate,
    enableRegimeAdaptiveEQ: true,
    enableInScannerWaveDedup: true,
    enforceSinglePositionConcurrency: true,
    pullbackExcursionThreshold: 0.5,
    structuralDealingRange: structural_dealing_range,
    stage1Multiple: pConfig.stage1Multiple,
    stage2Multiple: pConfig.stage2Multiple,
    stage3Multiple: pConfig.stage3Multiple,
    entryMode: pConfig.entryMode,
    enableStructuralTrail: pConfig.enableStructuralTrail,
    enableProfitRatchet: pConfig.enableProfitRatchet,
    minSweepDepthAtrMultiplier: pConfig.minSweepDepthAtrMultiplier,
    slBufferAtrMultiplier: pConfig.slBufferAtrMultiplier,
    enableWaveDeduplication: true,
    filterWeekend: false,
    enforceHtfBiasGuard: false,
    enableEarlyBreakeven: true,
    earlyBreakevenMultiple: 0.40,
    enableFeePaddedBreakeven: true,
    breakevenOffsetPct: 0.05,
    postLossCooldownMinutes: 0,
  };

  const engine = new SweepReclaimEngine(scanConfig);
  const { setups } = engine.scanHistoricalSetups(candles);

  // Filter setups based on target price or timestamp
  let matchedSetups = setups;
  if (options.target_price) {
    const target = options.target_price;
    matchedSetups = setups.filter((s) => {
      const entryDiff = Math.abs(s.entry_price - target) / target;
      const anchorDiff = Math.abs(s.anchor_level - target) / target;
      const sweepDiff = s.sweep_price ? Math.abs(s.sweep_price - target) / target : 1;
      return entryDiff <= 0.003 || anchorDiff <= 0.003 || sweepDiff <= 0.003;
    });
  } else if (options.timestamp) {
    const targetTs = typeof options.timestamp === 'string' ? Date.parse(options.timestamp) : options.timestamp;
    if (!isNaN(targetTs)) {
      matchedSetups = setups.filter((s) => {
        const t = s.retest_time || s.reclaim_time || s.sweep_time || s.anchor_time || 0;
        return Math.abs(t - targetTs) <= 30 * 60 * 1000;
      });
    }
  }

  // Fallback to top 3 most recent setups
  if (matchedSetups.length === 0) {
    matchedSetups = setups.slice(-3);
  }

  const diagnostics = matchedSetups.map((s) => ({
    setup_id: s.id,
    direction: s.type,
    anchor: {
      name: s.anchor_name,
      type: s.anchor_type,
      grade: s.anchor_swing_grade,
      price: s.anchor_level,
      time_cairo: formatCairoDateTime(s.anchor_time),
      time_iso: s.anchor_time ? new Date(s.anchor_time).toISOString() : null,
    },
    sweep: {
      price: s.sweep_price,
      depth_atr: s.sweep_depth,
      time_cairo: formatCairoDateTime(s.sweep_time),
      time_iso: s.sweep_time ? new Date(s.sweep_time).toISOString() : null,
    },
    reclaim: {
      close_price: s.reclaim_close_price,
      time_cairo: formatCairoDateTime(s.reclaim_time),
      bars_since_sweep: s.bars_sweep_to_reclaim,
      fvg_ce: s.reclaim_fvg_ce,
      fvg_zone: s.reclaim_fvg_bottom && s.reclaim_fvg_top ? [s.reclaim_fvg_bottom, s.reclaim_fvg_top] : null,
      displacement_metrics: {
        volume_expansion: s.reclaim_volume_expansion,
        delta_dominance_pct: s.reclaim_delta_dominance_pct,
        body_ratio: s.reclaim_body_ratio,
        three_pillar_passed: s.three_pillar_displacement_passed,
      },
    },
    dealing_range: {
      equilibrium: s.dealing_range_equilibrium,
      regime: s.type === 'BULLISH'
        ? (s.entry_price <= (s.dealing_range_equilibrium ?? 0) ? 'DISCOUNT (VALID LONG)' : 'PREMIUM (VETO RISK)')
        : (s.entry_price >= (s.dealing_range_equilibrium ?? 0) ? 'PREMIUM (VALID SHORT)' : 'DISCOUNT (VETO RISK)'),
      valuation_aligned: s.is_valuation_aligned,
    },
    execution_bracket: {
      entry_mode: s.entry_mode,
      entry_price: s.entry_price,
      stop_loss: s.stop_loss,
      risk_points: parseFloat(Math.abs(s.entry_price - s.stop_loss).toFixed(2)),
      stage1_target: s.stage1_target,
      stage2_target: s.stage2_target,
      is_retested: s.is_retested,
      retest_time_cairo: formatCairoDateTime(s.retest_time),
      retest_time_iso: s.retest_time ? new Date(s.retest_time).toISOString() : null,
      retest_price: s.retest_price,
    },
    trade_outcome: {
      status: s.status,
      simulated_outcome: s.simulated_outcome,
      stage_exit_type: s.stage_exit_type,
      realized_rr: s.realized_rr,
      is_be_scratch: s.is_be_scratch,
      exit_reason: s.stage_exit_type || s.simulated_outcome,
      exit_time_cairo: formatCairoDateTime(s.exit_time),
      exit_time_iso: s.exit_time ? new Date(s.exit_time).toISOString() : null,
    },
  }));

  return {
    symbol,
    timeframe,
    candles_evaluated: candles.length,
    matches_found: diagnostics.length,
    setups: diagnostics,
  };
}

// ─── Handler 5: runGetLiveDaemonStatus ─────────────────────────────────────────

export interface LiveDaemonStatusOptions {
  symbol?: string;
}

export async function runGetLiveDaemonStatus(options: LiveDaemonStatusOptions = {}) {
  const symbol = (options.symbol ?? 'ETHUSDC').toUpperCase();
  const rootDir = process.cwd();
  const sessionDir = path.join(rootDir, 'run_logs');

  let sessionLog: any = null;
  let logFileName = '';

  if (fs.existsSync(sessionDir)) {
    const files = fs.readdirSync(sessionDir)
      .filter((f) => f.startsWith('live_session_') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length > 0) {
      logFileName = files[0];
      try {
        const raw = fs.readFileSync(path.join(sessionDir, logFileName), 'utf8');
        sessionLog = JSON.parse(raw);
      } catch (e) {
        console.warn('[runGetLiveDaemonStatus] Error reading session log:', e);
      }
    }
  }

  // Read directives/ETHUSDC_Daily_Tracker.json
  const trackerPath = path.join(rootDir, 'directives', 'ETHUSDC_Daily_Tracker.json');
  let recentTrackerTrades: any[] = [];
  if (fs.existsSync(trackerPath)) {
    try {
      const rawTracker = fs.readFileSync(trackerPath, 'utf8');
      const tracker = JSON.parse(rawTracker);
      if (Array.isArray(tracker.trades)) {
        recentTrackerTrades = tracker.trades.slice(-5);
      }
    } catch (e) {
      console.warn('[runGetLiveDaemonStatus] Error reading daily tracker:', e);
    }
  }

  if (!sessionLog) {
    return {
      status: 'OFFLINE_OR_NO_LOGS',
      message: 'No active session log file found in run_logs/. The daemon may not have booted yet today.',
      recent_tracker_trades: recentTrackerTrades,
    };
  }

  // Reconstruct active positions and pending limit orders from events
  const activeMap = new Map<string, any>();
  const pendingLimitOrders: any[] = [];

  if (Array.isArray(sessionLog.events)) {
    for (const evt of sessionLog.events) {
      if (
        (evt.type === 'LIMIT_ORDER_PLACED' ||
          evt.type === 'ORDER_FILLED' ||
          evt.type === 'EARLY_BREAKEVEN' ||
          evt.type === 'STAGE_1_HARVEST' ||
          evt.type === 'STAGE_2_HARVEST') &&
        evt.position?.id
      ) {
        activeMap.set(evt.position.id, evt.position);
      } else if (evt.type === 'POSITION_CLOSED' && evt.position?.id) {
        activeMap.delete(evt.position.id);
      } else if (evt.type === 'LIMIT_ORDER_CANCELLED' && evt.position?.id) {
        activeMap.delete(evt.position.id);
      }

      if (evt.type === 'LIMIT_ORDER_PLACED' && evt.position) {
        pendingLimitOrders.push({
          id: evt.position.id,
          placed_at: evt.timeCairo || evt.timeIso,
          symbol: evt.position.symbol,
          direction: evt.position.direction,
          limit_entry: evt.position.limitEntryPrice ?? evt.position.entryPrice,
          stop_loss: evt.position.initialStopLoss ?? evt.position.activeStopLoss,
          tp1: evt.position.stage1Target,
          tp2: evt.position.stage2Target,
          anchor: evt.position.anchorName,
        });
      }
    }
  }

  const livePendingOrders = pendingLimitOrders.filter((po) => {
    const activePos = activeMap.get(po.id);
    return activePos && activePos.status === 'PENDING';
  });

  const activeInFlightPositions = Array.from(activeMap.values()).filter((p) => p.status !== 'PENDING');

  const recentEvents = Array.isArray(sessionLog.events)
    ? sessionLog.events.slice(-15).map((e: any) => ({
        type: e.type,
        time_cairo: e.timeCairo,
        time_iso: e.timeIso,
        message: e.message,
        live_price: e.livePrice,
      }))
    : [];

  return {
    status: 'ACTIVE_SESSION_FOUND',
    session_file: logFileName,
    session: {
      session_id: sessionLog.sessionId,
      date_str: sessionLog.dateStr,
      symbol: sessionLog.symbol,
      boot_time_iso: sessionLog.bootTimeIso,
      boot_time_cairo: sessionLog.bootTimeCairo,
      current_equity_usd: sessionLog.currentEquity,
      initial_equity_usd: sessionLog.initialEquity,
      total_realized_r: sessionLog.totalRealizedR,
      total_trades: sessionLog.totalTrades,
      winning_trades: sessionLog.winningTrades,
      losing_trades: sessionLog.losingTrades,
    },
    active_in_flight_positions: activeInFlightPositions,
    active_pending_limit_orders: livePendingOrders,
    recent_events: recentEvents,
    today_completed_trades: (sessionLog.completedTrades || []).slice(-5),
    daily_tracker_last_trades: recentTrackerTrades,
  };
}

// ─── Handler 6: runGetMarketStructure ─────────────────────────────────────────

export interface MarketStructureOptions {
  symbol?: string;
  timeframe?: AgentTimeframe;
  lookback_candles?: number;
}

export async function runGetMarketStructure(options: MarketStructureOptions = {}) {
  const symbol = (options.symbol ?? 'ETHUSDC').toUpperCase();
  const timeframe: AgentTimeframe = options.timeframe ?? '5m';
  const lookback = Math.min(1000, Math.max(50, options.lookback_candles ?? 250));

  const candles = await fetchKlines(symbol, timeframe, lookback);
  if (candles.length === 0) {
    throw new Error(`Failed to fetch candles for market structure (${symbol} ${timeframe}).`);
  }

  const lastCandle = candles[candles.length - 1];
  const currentPrice = lastCandle.c ?? 0;

  const msApi = new MarketStructureAPI({
    lookbackMajor: 10,
    lookbackInternal: 5,
  });

  const structure = msApi.analyze(candles, currentPrice);

  const eq = structure.dealingRange?.equilibrium ?? 0;
  const regime = currentPrice < eq ? 'DISCOUNT' : 'PREMIUM';
  const distToEqPct = eq > 0 ? parseFloat((((currentPrice - eq) / eq) * 100).toFixed(2)) : 0;

  const recentSwings = (structure.swings || []).slice(-8).map((s) => ({
    price: s.price,
    type: s.type,
    grade: s.grade,
    time_iso: s.timestamp || (s.t ? new Date(s.t).toISOString() : null),
    confirmed: s.confirmed ?? true,
  }));

  const recentBreaks = (structure.zigzag || [])
    .filter((z) => z.label === 'BOS' || z.label === 'MSS')
    .slice(-5)
    .map((z) => ({
      label: z.label,
      broken_level: z.brokenLevel,
      trend_before: z.trendBefore,
      trend_after: z.trendAfter,
      displacement_confirmed: z.displacementConfirmed,
    }));

  return {
    symbol,
    timeframe,
    current_price: currentPrice,
    primary_trend: structure.currentTrend,
    dealing_range: {
      high: structure.dealingRange?.high ?? null,
      low: structure.dealingRange?.low ?? null,
      equilibrium: eq,
      current_regime: regime,
      distance_to_equilibrium_pct: distToEqPct,
      status: structure.dealingRange?.current_status,
    },
    protected_levels: {
      protected_high: structure.engine_state?.protected_high ?? null,
      protected_low: structure.engine_state?.protected_low ?? null,
    },
    recent_swings: recentSwings,
    recent_structural_breaks: recentBreaks,
    displacement_state: {
      expansion_mode: structure.expansion_mode,
      market_velocity: structure.market_velocity,
      is_in_expansion: structure.is_in_expansion,
      expansion_high_float: structure.expansion_high_float,
      expansion_low_float: structure.expansion_low_float,
    },
  };
}
