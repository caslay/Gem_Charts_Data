/**
 * @file src/app/api/agent/context/route.ts
 * @description M2M Agent Bridge API Route Handler
 *
 * Provides a dedicated, secure Machine-to-Machine (M2M) bridge for external
 * AI reasoning agents (Gemini Spark, background workers, Antigravity CLI, etc.)
 * to interact with the Flow-State Quant Engine.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ARCHITECTURE MANDATE                                           ║
 * ║  This route is COMPLETELY INDEPENDENT of NextAuth browser       ║
 * ║  sessions. It authenticates via a high-entropy Bearer token     ║
 * ║  (M2M_AGENT_SECRET env var) and operates fully headless.        ║
 * ║                                                                 ║
 * ║  NON-DISRUPTION: Does NOT modify /api/market-data (God Node),   ║
 * ║  Chart.tsx, canvas overlays, or any WebSocket streams.          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Endpoints:
 *   GET  /api/agent/context?symbol=ETHUSDC
 *     → Returns enriched AgentContextPayload for LLM reasoning.
 *   POST /api/agent/context
 *     → Accepts AgentDecisionPayload; runs pre-flight invalidation check; persists to DB.
 *   PATCH /api/agent/context
 *     → Updates an existing agent_decision_log record by id.
 *
 * @version 1.0.0 — Flow-State Quant Engine V15.2
 */

import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { validateM2MToken } from '@/lib/m2mAuth';
import { serializeAgentContext } from '@/lib/agentContextSerializer';

// Engine imports — REUSE existing libs, do NOT duplicate logic
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

import type {
  AgentDecisionPayload,
  AgentDecisionPatchPayload,
  AgentDecisionRecord,
  M2MInvalidationCheckResult,
} from '@/types/agentTypes';

// ─── Runtime Config ────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

// ─── DDL Schema Init (Self-healing, cached per cold-start) ────────────────────

let isSchemaInitialized = false;

async function ensureAgentDecisionTableInitialized(): Promise<void> {
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
    console.log('[agent/context] ✅ agent_decision_log schema initialized.');
  } catch (error: any) {
    // Resilient fallback — DB may be temporarily unreachable. Log but continue.
    console.warn(
      `[agent/context] ⚠️ Schema init fallback (DB may be offline): ${error.message || error}`
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetch the live Binance Futures price for a symbol.
 * Used for the pre-flight invalidation guard on POST.
 */
async function fetchLivePrice(symbol: string): Promise<number | null> {
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

/**
 * Parse Binance klines array into the internal Candle shape used by
 * the quant engine libs.
 */
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

/**
 * Fetch klines from Binance Futures REST API with a graceful offline fallback.
 * Mirrors the pattern in /api/market-data — Lesson #20 (Bulletproof Offline Simulation).
 */
async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number
): Promise<any[]> {
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`[agent/context] Binance klines HTTP ${res.status} for ${symbol}/${interval}. Returning empty.`);
      return [];
    }
    return parseBinanceKlines(await res.json());
  } catch (err: any) {
    console.warn(`[agent/context] Klines fetch failed for ${symbol}/${interval}: ${err.message}. Returning empty.`);
    return [];
  }
}

/**
 * Compute Previous Day High / Low from 1h candles.
 * Mirrors the exact PDH/PDL computation from /api/market-data/route.ts.
 */
function computePdhPdl(candles1h: any[]): { pdh: number; pdl: number } {
  if (candles1h.length === 0) return { pdh: 0, pdl: 0 };

  const getUtcDate = (t: number) => new Date(t);
  const lastCandle = candles1h[candles1h.length - 1];
  const lastDateUtc = getUtcDate(lastCandle.t);

  const previousDayDateUtc = new Date(
    Date.UTC(lastDateUtc.getUTCFullYear(), lastDateUtc.getUTCMonth(), lastDateUtc.getUTCDate() - 1)
  );
  const prevYear = previousDayDateUtc.getUTCFullYear();
  const prevMonth = previousDayDateUtc.getUTCMonth();
  const prevDate = previousDayDateUtc.getUTCDate();

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

/**
 * Compute session (Asian, London) high/low from 15m candles.
 */
function computeSessionLevels(candles15m: any[]): {
  asian_high: number | null;
  asian_low: number | null;
  london_high: number | null;
  london_low: number | null;
} {
  if (candles15m.length === 0) {
    return { asian_high: null, asian_low: null, london_high: null, london_low: null };
  }

  const now = new Date();
  const currentDayStr = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

  const getSessionRange = (startHour: number, endHour: number) => {
    const filtered = candles15m.filter((c) => {
      const d = new Date(c.t);
      const dayStr = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
      const h = d.getUTCHours();
      return dayStr === currentDayStr && h >= startHour && h < endHour;
    });
    if (filtered.length === 0) return { high: null, low: null };
    return {
      high: Math.max(...filtered.map((c) => c.h)),
      low: Math.min(...filtered.map((c) => c.l)),
    };
  };

  const asian = getSessionRange(0, 7);
  const london = getSessionRange(7, 12);

  return {
    asian_high: asian.high,
    asian_low: asian.low,
    london_high: london.high,
    london_low: london.low,
  };
}

/**
 * Run pre-flight invalidation guard.
 * Returns breach status, live price, and direction of breach.
 */
function runInvalidationCheck(
  invalidationLevel: number,
  livePrice: number,
  biasSignal: string
): M2MInvalidationCheckResult {
  const isBullish = biasSignal.includes('BULLISH');
  let breached = false;
  let breach_direction: 'ABOVE' | 'BELOW' | null = null;

  if (isBullish && livePrice < invalidationLevel) {
    // Bullish setup: price has FALLEN below the invalidation floor
    breached = true;
    breach_direction = 'BELOW';
  } else if (!isBullish && livePrice > invalidationLevel) {
    // Bearish setup: price has RISEN above the invalidation ceiling
    breached = true;
    breach_direction = 'ABOVE';
  }

  return { breached, live_price: livePrice, invalidation_level: invalidationLevel, breach_direction };
}

// ─── GET Handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/agent/context?symbol=ETHUSDC
 *
 * Returns a token-efficient, LLM-optimized market state snapshot.
 * Fetches fresh data from Binance + DB in parallel — no stale caching.
 *
 * Requires: Authorization: Bearer <M2M_AGENT_SECRET>
 */
export async function GET(req: Request) {
  // ── 1. M2M Auth Gate ──────────────────────────────────────────────────────
  const auth = validateM2MToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'ETHUSDC').toUpperCase();

  try {
    // ── 2. Initialize DB schema (cached after first call) ─────────────────
    await ensureAgentDecisionTableInitialized();

    // ── 3. Parallel data fetch — mirrors /api/market-data pattern ─────────
    const [
      candles15mRaw,
      candles5mRaw,
      candles1hRaw,
      candlesBtc5mRaw,
      candlesBtc15mRaw,
      oiMetrics,
      liquidityPools,
      smartMoneySentiment,
      recentTradesRes,
      lastDecisionRes,
    ] = await Promise.allSettled([
      fetchKlines(symbol, '15m', 200),
      fetchKlines(symbol, '5m', 200),
      fetchKlines(symbol, '1h', 48),
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
      // Last 5 open/recent trades
      sql`
        SELECT id, direction, status, symbol, entry_price, stop_loss,
               take_profit_1, take_profit_2, outcome, strategy_name,
               opened_at, closed_at
        FROM paper_trades
        ORDER BY created_at DESC
        LIMIT 5
      `.catch(() => ({ rows: [] })),
      // Last active agent decision for this symbol
      sql`
        SELECT * FROM agent_decision_log
        WHERE symbol = ${symbol}
        ORDER BY submitted_at DESC
        LIMIT 1
      `.catch(() => ({ rows: [] })),
    ]);

    // Safely extract settled values
    const candles15m = candles15mRaw.status === 'fulfilled' ? candles15mRaw.value : [];
    const candles5m = candles5mRaw.status === 'fulfilled' ? candles5mRaw.value : [];
    const candles1h = candles1hRaw.status === 'fulfilled' ? candles1hRaw.value : [];
    const candlesBtc5m = candlesBtc5mRaw.status === 'fulfilled' ? candlesBtc5mRaw.value : [];
    const candlesBtc15m = candlesBtc15mRaw.status === 'fulfilled' ? candlesBtc15mRaw.value : [];
    const oiResult = oiMetrics.status === 'fulfilled' ? oiMetrics.value : {
      open_interest_trend: 'UNAVAILABLE',
      displacement_sponsorship: 'INACTIVE',
      liquidation_events: { last_hour_purged: 'N/A', status: 'UNAVAILABLE' },
    };
    const pools = liquidityPools.status === 'fulfilled' ? liquidityPools.value : { BSL_Magnets: [], SSL_Magnets: [] };
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

    // ── 4. Derive live price ────────────────────────────────────────────────
    const primaryCandles = candles15m.length > 0 ? candles15m : candles5m;
    const currentLivePrice =
      primaryCandles.length > 0
        ? primaryCandles[primaryCandles.length - 1].c
        : 0;

    // ── 5. Run quant engine computations ───────────────────────────────────
    // Market Structure (15m primary)
    const structureCandidates = candles15m.length > 0 ? candles15m : candles5m;
    const structureAnalysis = analyzeMarketStructureStateful(
      symbol,
      '15m',
      structureCandidates,
      currentLivePrice,
      null,
      true // isInit — always recompute fresh for agent snapshot
    );

    // FVGs — 15m + 5m
    const fvgs15m = detectActiveFVGs(candles15m, true);
    const fvgs5m = detectActiveFVGs(candles5m, true);
    const activeFVGs = mapAndConsolidateFVGs(fvgs15m, fvgs5m);

    // Displacement
    const displacementResult = await verifyDisplacement(candles15m).catch(() => ({
      displacement_active: false,
      institutional_sponsorship: { status: 'INACTIVE' },
    }));
    const displacementStatus =
      typeof (displacementResult as any)?.institutional_sponsorship === 'object'
        ? (displacementResult as any).institutional_sponsorship?.status ?? 'INACTIVE'
        : String((displacementResult as any)?.institutional_sponsorship ?? 'INACTIVE');

    const takerBuyRatio =
      candles15m.length > 0
        ? candles15m[candles15m.length - 1].taker_buy_vol /
          (candles15m[candles15m.length - 1].v || 1)
        : null;

    // OI delta estimate from trend string
    const oiDelta =
      oiResult.open_interest_trend === 'RISING' ? 1 :
      oiResult.open_interest_trend === 'FALLING' ? -1 : 0;

    // PDH / PDL
    const { pdh, pdl } = computePdhPdl(candles1h);

    // Session levels
    const sessionLevels = computeSessionLevels(candles15m);

    // Macro bias — uses BiasEngine triple-vector model
    const ethPrevClose = candles15m.length > 1 ? candles15m[candles15m.length - 2].c : null;
    const btcPrevClose = candlesBtc15m.length > 1 ? candlesBtc15m[candlesBtc15m.length - 2].c : null;

    // Derive nearest HTF magnet from structure (PDH/PDL anchored)
    const nearestHtfMagnet: { label: string; distance: number } | null =
      pdh > 0 && pdl > 0
        ? currentLivePrice < (pdh + pdl) / 2
          ? { label: 'PWH', distance: Math.abs(currentLivePrice - pdh) }
          : { label: 'PWL', distance: Math.abs(currentLivePrice - pdl) }
        : null;

    // Dealing range equilibrium as the activeSwingPOC proxy
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

    // SMT Context
    const btcPrice = candlesBtc5m.length > 0 ? candlesBtc5m[candlesBtc5m.length - 1].c : 0;
    const smtContext = getSmtContext({
      ethCandles5m: candles5m,
      btcCandles5m: candlesBtc5m,
      ethCandles15m: candles15m,
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

    // Order flow state — bootstrap + update in-memory tracker
    const primaryCandlesForTracker = candles15m.length > 0 ? candles15m : candles5m;
    const currentCandleT = primaryCandlesForTracker.length > 0 ? primaryCandlesForTracker[primaryCandlesForTracker.length - 1].t : undefined;
    OrderFlowStateTracker.bootstrapFromCandles(symbol, primaryCandlesForTracker);
    const stateTimeline = OrderFlowStateTracker.updateLiveState(
      symbol,
      oiResult.open_interest_trend,
      primaryCandles.length > 0 ? primaryCandles[primaryCandles.length - 1].t : Date.now(),
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

    // ── 6. Serialize into token-efficient AgentContextPayload ──────────────
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

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Agent-Bridge-Version': '1.0.0',
      },
    });
  } catch (error: any) {
    console.error('[agent/context] GET handler error:', error);
    return NextResponse.json(
      { error: 'Internal engine error. See server logs.', detail: error.message },
      { status: 500 }
    );
  }
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/agent/context
 *
 * Accepts a structured analytical decision from an AI agent.
 * Runs pre-flight invalidation guard before persisting to DB.
 *
 * Request body: AgentDecisionPayload (JSON)
 * Requires: Authorization: Bearer <M2M_AGENT_SECRET>
 */
export async function POST(req: Request) {
  // ── 1. M2M Auth Gate ──────────────────────────────────────────────────────
  const auth = validateM2MToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  let body: AgentDecisionPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  // ── 2. Validate required fields ───────────────────────────────────────────
  const { agent_id, symbol, bias_signal, invalidation_level } = body;

  if (!agent_id || typeof agent_id !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid field: agent_id.' }, { status: 400 });
  }
  if (!symbol || typeof symbol !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid field: symbol.' }, { status: 400 });
  }
  if (!bias_signal || typeof bias_signal !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid field: bias_signal.' }, { status: 400 });
  }

  const validBiasSignals = [
    'CONFIRMED_BULLISH', 'CONFIRMED_BEARISH', 'NEUTRAL', 'ABORT', 'COUNTER_TREND_RETRACEMENT',
  ];
  if (!validBiasSignals.includes(bias_signal)) {
    return NextResponse.json(
      { error: `Invalid bias_signal. Must be one of: ${validBiasSignals.join(', ')}.` },
      { status: 400 }
    );
  }

  // ── 3. Pre-flight Invalidation Guard ─────────────────────────────────────
  // Only runs if an invalidation_level was provided
  let livePriceAtSubmission: number | null = null;

  if (invalidation_level !== undefined && invalidation_level !== null) {
    const livePrice = await fetchLivePrice(symbol.toUpperCase());

    if (livePrice !== null) {
      livePriceAtSubmission = livePrice;
      const check = runInvalidationCheck(invalidation_level, livePrice, bias_signal);

      if (check.breached) {
        return NextResponse.json(
          {
            error: 'INVALIDATION_BREACHED',
            message: `Live price (${livePrice}) has already breached the submitted invalidation level (${invalidation_level}) in direction: ${check.breach_direction}. Decision rejected.`,
            live_price: livePrice,
            invalidation_level,
            breach_direction: check.breach_direction,
          },
          { status: 409 }
        );
      }
    } else {
      console.warn('[agent/context] POST: Could not fetch live price for invalidation check. Proceeding without guard.');
    }
  }

  // ── 4. Initialize DB schema ───────────────────────────────────────────────
  await ensureAgentDecisionTableInitialized();

  // ── 5. Persist decision to agent_decision_log ─────────────────────────────
  try {
    const now = Date.now();
    const result = await sql`
      INSERT INTO agent_decision_log (
        symbol,
        agent_id,
        bias_signal,
        entry_range_low,
        entry_range_high,
        invalidation_level,
        target_1,
        target_2,
        narrative,
        status,
        live_price_at_submission,
        submitted_at
      ) VALUES (
        ${symbol.toUpperCase()},
        ${agent_id},
        ${bias_signal},
        ${body.entry_range_low ?? null},
        ${body.entry_range_high ?? null},
        ${invalidation_level ?? null},
        ${body.target_1 ?? null},
        ${body.target_2 ?? null},
        ${body.narrative ?? null},
        'ACTIVE',
        ${livePriceAtSubmission},
        ${now}
      )
      RETURNING id, submitted_at, status
    `;

    const inserted = result.rows[0];

    console.log(
      `[agent/context] ✅ Decision persisted. id=${inserted.id} agent=${agent_id} bias=${bias_signal} symbol=${symbol}`
    );

    return NextResponse.json(
      {
        success: true,
        id: inserted.id,
        status: inserted.status,
        submitted_at: inserted.submitted_at,
        live_price: livePriceAtSubmission,
        invalidation_guard: invalidation_level !== undefined
          ? { checked: true, live_price: livePriceAtSubmission, passed: true }
          : { checked: false },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[agent/context] POST DB error:', error);
    return NextResponse.json(
      { error: 'Failed to persist decision to database.', detail: error.message },
      { status: 500 }
    );
  }
}

// ─── PATCH Handler ────────────────────────────────────────────────────────────

/**
 * PATCH /api/agent/context
 *
 * Updates an existing agent_decision_log record.
 * Re-runs the invalidation guard against live price if the record
 * has an invalidation_level set.
 *
 * Request body: AgentDecisionPatchPayload (JSON)
 * Requires: Authorization: Bearer <M2M_AGENT_SECRET>
 */
export async function PATCH(req: Request) {
  // ── 1. M2M Auth Gate ──────────────────────────────────────────────────────
  const auth = validateM2MToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  let body: AgentDecisionPatchPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.id || typeof body.id !== 'number') {
    return NextResponse.json({ error: 'Missing or invalid field: id (must be a number).' }, { status: 400 });
  }

  // ── 2. Initialize DB schema ───────────────────────────────────────────────
  await ensureAgentDecisionTableInitialized();

  // ── 3. Fetch existing record ───────────────────────────────────────────────
  let existingRecord: AgentDecisionRecord | null = null;
  try {
    const res = await sql`
      SELECT * FROM agent_decision_log WHERE id = ${body.id} LIMIT 1
    `;
    existingRecord = (res.rows[0] as AgentDecisionRecord) ?? null;
  } catch (error: any) {
    return NextResponse.json({ error: 'Database lookup failed.', detail: error.message }, { status: 500 });
  }

  if (!existingRecord) {
    return NextResponse.json(
      { error: `No agent_decision_log record found with id=${body.id}.` },
      { status: 404 }
    );
  }

  // ── 4. Re-run invalidation guard on existing record ────────────────────────
  // If the stored record has an invalidation_level and the requested new status
  // is ACTIVE, verify that price has not already breached it.
  if (
    existingRecord.invalidation_level &&
    (body.status === 'ACTIVE' || body.status === undefined)
  ) {
    const livePrice = await fetchLivePrice(existingRecord.symbol);
    if (livePrice !== null) {
      const check = runInvalidationCheck(
        Number(existingRecord.invalidation_level),
        livePrice,
        existingRecord.bias_signal
      );
      if (check.breached) {
        // Auto-mark as INVALIDATED in DB
        await sql`
          UPDATE agent_decision_log
          SET status = 'INVALIDATED', invalidated_at = ${Date.now()}
          WHERE id = ${body.id}
        `.catch(() => {}); // Best effort

        return NextResponse.json(
          {
            error: 'INVALIDATION_BREACHED',
            message: `Live price (${livePrice}) has breached the stored invalidation level (${existingRecord.invalidation_level}). Record auto-marked INVALIDATED.`,
            live_price: livePrice,
            invalidation_level: existingRecord.invalidation_level,
            breach_direction: check.breach_direction,
          },
          { status: 409 }
        );
      }
    }
  }

  // ── 5. Apply updates ───────────────────────────────────────────────────────
  const newStatus = body.status ?? existingRecord.status;
  const newNarrative = body.narrative ?? existingRecord.narrative;
  const newTarget1 = body.target_1 ?? existingRecord.target_1;
  const newTarget2 = body.target_2 ?? existingRecord.target_2;
  const newInvalidatedAt =
    newStatus === 'INVALIDATED' && !existingRecord.invalidated_at
      ? Date.now()
      : existingRecord.invalidated_at;

  try {
    const updateRes = await sql`
      UPDATE agent_decision_log
      SET
        status         = ${newStatus},
        narrative      = ${newNarrative},
        target_1       = ${newTarget1},
        target_2       = ${newTarget2},
        invalidated_at = ${newInvalidatedAt}
      WHERE id = ${body.id}
      RETURNING *
    `;

    const updated = updateRes.rows[0] as AgentDecisionRecord;

    console.log(`[agent/context] ✅ Decision updated. id=${body.id} status=${newStatus}`);

    return NextResponse.json({ success: true, record: updated }, { status: 200 });
  } catch (error: any) {
    console.error('[agent/context] PATCH DB error:', error);
    return NextResponse.json(
      { error: 'Failed to update record in database.', detail: error.message },
      { status: 500 }
    );
  }
}
