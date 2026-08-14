/**
 * @file agentContextSerializer.ts
 * @description Pure serializer for the M2M Agent Bridge context payload.
 *
 * PURE FUNCTION — no DB I/O, no fetch calls, no side effects.
 * Takes pre-fetched engine outputs and compresses them into a
 * token-efficient, LLM-optimized JSON payload.
 *
 * Key compression rules (from Lesson #3 — Context Window Memory Overflow):
 * - Raw OHLCV candle arrays are NEVER included.
 * - ZigZag limited to last 10 segments (oldest first).
 * - Active FVGs limited to 5 (sorted nearest-to-price first).
 * - BSL/SSL magnets limited to 3 each.
 * - Trade memory limited to last 5 trades.
 * - All numeric values rounded to 4 decimal places.
 *
 * @version 1.0.0 — Flow-State Quant Engine V15.2
 */

import type { MarketStructureAnalysis } from '@/lib/quantEngine/types';
import type { MappedFVG } from '@/lib/fvgEngine';
import type { OrderFlowEngine } from '@/lib/orderFlowEngine';
import type {
  AgentContextPayload,
  AgentMarketStructure,
  AgentZigZagSegment,
  AgentSwing,
  AgentFVG,
  AgentOrderFlowSummary,
  AgentOrderFlowState,
  AgentLiquidityLevels,
  AgentDisplacementStatus,
  AgentSmtContext,
  AgentTradeRecord,
  AgentDecisionRecord,
} from '@/types/agentTypes';

// ─── Helper: Round to N decimals ─────────────────────────────────────────────

function r4(n: number | null | undefined): number | null {
  if (n === null || n === undefined || isNaN(n as number)) return null;
  return Math.round((n as number) * 10000) / 10000;
}

// ─── Serializer Input Shape ───────────────────────────────────────────────────

export interface SerializerInput {
  /** Result from analyzeMarketStructureStateful() on the primary timeframe candles. */
  structureAnalysis: MarketStructureAnalysis;
  /** Result from mapAndConsolidateFVGs() — all active FVGs across timeframes. */
  activeFVGs: MappedFVG[];
  /** Result from fetchOIMetricsAndLiquidations() + fetchRestingLiquidity(). */
  orderFlowEngine: OrderFlowEngine;
  /** SMT divergence context object from getSmtContext(). */
  smtContext: {
    divergence?: string;
    htf_order_flow_trend?: string;
    counter_trend_vetoed?: boolean;
    [key: string]: any;
  };
  /** Current live price fetched from Binance ticker. */
  currentPrice: number;
  /** Previous Day High — used as BSL anchor. */
  pdh: number | null;
  /** Previous Day Low — used as SSL anchor. */
  pdl: number | null;
  /** Macro daily bias string from resolveTripleVectorBias(). */
  macroBias: string;
  /** Raw displacement sponsorship status string from the order flow engine. */
  displacementStatus: string;
  /** Taker buy ratio (0–1). */
  takerBuyRatio?: number | null;
  /** Open Interest delta. */
  oiDelta?: number | null;
  /** Session levels (optional). */
  sessionLevels?: {
    london_high?: number | null;
    london_low?: number | null;
    asian_high?: number | null;
    asian_low?: number | null;
  };
  /** Last 5 trades from paper_trades DB query. */
  recentTrades: any[];
  /** Last active agent decision from agent_decision_log (null if none). */
  lastAgentDecision: AgentDecisionRecord | null;
  /** Symbol (e.g. 'ETHUSDC'). */
  symbol: string;
}

// ─── Market Structure Serializer ──────────────────────────────────────────────

function serializeMarketStructure(
  analysis: MarketStructureAnalysis,
  currentPrice: number
): AgentMarketStructure {
  // Prune ZigZag to last 10 segments
  const zigzagRaw = analysis.zigzag ?? [];
  const zigzag: AgentZigZagSegment[] = zigzagRaw.slice(-10).map((seg) => ({
    from: {
      t: seg.from.t,
      price: r4(Number(seg.from.price)) ?? 0,
      type: seg.from.type,
      grade: seg.from.grade,
      colorValidated: seg.from.colorValidated,
    } as AgentSwing,
    to: {
      t: seg.to.t,
      price: r4(Number(seg.to.price)) ?? 0,
      type: seg.to.type,
      grade: seg.to.grade,
      colorValidated: seg.to.colorValidated,
    } as AgentSwing,
    label: seg.label,
    trendBefore: seg.trendBefore,
    trendAfter: seg.trendAfter,
    displacementConfirmed: seg.displacementConfirmed,
    brokenLevel: r4(seg.brokenLevel) ?? undefined,
  }));

  // Prune major swings to last 5 MAJOR color-validated swings
  const majorSwingsRaw = (analysis.swings ?? [])
    .filter((s) => s.grade === 'MAJOR' && s.colorValidated)
    .slice(-5);

  const majorSwings: AgentSwing[] = majorSwingsRaw.map((s) => ({
    t: s.t,
    price: r4(Number(s.price)) ?? 0,
    type: s.type,
    grade: s.grade,
    colorValidated: s.colorValidated,
  }));

  // Latest MSS
  const latestMSS = analysis.latestMSS
    ? {
        from: {
          t: analysis.latestMSS.from.t,
          price: r4(Number(analysis.latestMSS.from.price)) ?? 0,
          type: analysis.latestMSS.from.type,
          grade: analysis.latestMSS.from.grade,
          colorValidated: analysis.latestMSS.from.colorValidated,
        } as AgentSwing,
        to: {
          t: analysis.latestMSS.to.t,
          price: r4(Number(analysis.latestMSS.to.price)) ?? 0,
          type: analysis.latestMSS.to.type,
          grade: analysis.latestMSS.to.grade,
          colorValidated: analysis.latestMSS.to.colorValidated,
        } as AgentSwing,
        label: analysis.latestMSS.label,
        trendBefore: analysis.latestMSS.trendBefore,
        trendAfter: analysis.latestMSS.trendAfter,
        displacementConfirmed: analysis.latestMSS.displacementConfirmed,
        brokenLevel: r4(analysis.latestMSS.brokenLevel) ?? undefined,
      }
    : null;

  // Dealing range
  const dr = analysis.dealingRange;
  const dealingRange = {
    high: r4(dr?.high ?? null),
    low: r4(dr?.low ?? null),
    equilibrium: r4(dr?.equilibrium ?? null),
    current_status: dr?.current_status ?? 'AWAITING_IDM_SWEEP',
    profile_metrics: dr?.profile_metrics
      ? {
          poc: r4(dr.profile_metrics.poc ?? null),
          vah: r4(dr.profile_metrics.vah ?? null),
          val: r4(dr.profile_metrics.val ?? null),
        }
      : null,
  };

  return {
    current_trend: analysis.currentTrend ?? 'UNSET',
    market_structure_shift: analysis.market_structure_shift ?? false,
    market_structure_shift_direction:
      analysis.market_structure_shift_direction ?? null,
    zigzag,
    major_swings: majorSwings,
    latest_mss: latestMSS,
    dealing_range: dealingRange,
    internal_trend: analysis.internalTrend ?? 'UNSET',
  };
}

// ─── FVG Serializer ───────────────────────────────────────────────────────────

function serializeFVGs(
  mappedFVGs: MappedFVG[],
  currentPrice: number
): AgentFVG[] {
  // Only UNMITIGATED and RETESTED FVGs are relevant for agent reasoning
  const active = mappedFVGs.filter(
    (f) => f.status === 'UNMITIGATED' || f.status === 'RETESTED'
  );

  // Sort by proximity to current price (nearest first) — agent should focus
  // on the closest actionable zone
  const sorted = active.sort((a, b) => {
    const midA = (a.top + a.bottom) / 2;
    const midB = (b.top + b.bottom) / 2;
    return Math.abs(midA - currentPrice) - Math.abs(midB - currentPrice);
  });

  // Limit to 5 FVGs — Lesson #3: avoid token bloat
  return sorted.slice(0, 5).map((f) => ({
    t: f.origin_time,
    top: r4(f.top) ?? 0,
    bottom: r4(f.bottom) ?? 0,
    type: f.type === 'BULLISH' ? 'BISI' : 'SIBI',
    timeframe: f.timeframe as AgentFVG['timeframe'],
    status: f.status as AgentFVG['status'],
  }));
}

// ─── Order Flow Serializer ────────────────────────────────────────────────────

function serializeOrderFlow(engine: OrderFlowEngine): AgentOrderFlowSummary {
  const timeline = engine.state_timeline;
  const stats = timeline?.stats;
  const activeState = timeline?.active_state ?? null;
  const history = timeline?.history ?? [];

  // Build active state summary
  const active: AgentOrderFlowState | null = activeState
    ? {
        state: activeState.state,
        entered_at: activeState.entered_at,
        entry_price: r4(activeState.entry_price) ?? 0,
        duration_seconds: activeState.duration_seconds,
      }
    : null;

  // Last 5 recent transitions (excluding currently active)
  const recentTransitions: AgentOrderFlowState[] = history
    .filter((h) => h.exited_at !== null)
    .slice(-5)
    .map((h) => ({
      state: h.state,
      entered_at: h.entered_at,
      entry_price: r4(h.entry_price) ?? 0,
      duration_seconds: h.duration_seconds,
    }));

  // Calculate percentage of time in each regime
  const totalTime =
    (stats?.time_in_buy_sponsorship_sec ?? 0) +
    (stats?.time_in_short_sponsorship_sec ?? 0) +
    (stats?.time_in_liquidation_sec ?? 0) +
    (stats?.time_in_covering_sec ?? 0) +
    (stats?.time_in_neutral_sec ?? 0) || 1;

  const buyPct = Math.round(
    ((stats?.time_in_buy_sponsorship_sec ?? 0) / totalTime) * 100
  );
  const shortPct = Math.round(
    ((stats?.time_in_short_sponsorship_sec ?? 0) / totalTime) * 100
  );

  return {
    active_state: active,
    dominant_state_last_24h: stats?.dominant_state_last_24h ?? 'UNAVAILABLE',
    recent_transitions: recentTransitions,
    time_in_buy_sponsorship_pct: buyPct,
    time_in_short_sponsorship_pct: shortPct,
  };
}

// ─── Trade Memory Serializer ──────────────────────────────────────────────────

function serializeTradeMemory(rawTrades: any[]): AgentTradeRecord[] {
  return rawTrades.slice(0, 5).map((t) => ({
    id: t.id,
    direction: t.direction,
    status: t.status,
    symbol: t.symbol || 'ETHUSDC',
    entry_price: r4(parseFloat(t.entry_price ?? '0')),
    stop_loss: r4(parseFloat(t.stop_loss ?? '0')),
    take_profit_1: r4(parseFloat(t.take_profit_1 ?? '0')),
    take_profit_2: r4(parseFloat(t.take_profit_2 ?? '0')),
    outcome: t.outcome ?? null,
    strategy_name: t.strategy_name ?? 'UNKNOWN',
    opened_at: t.opened_at ?? null,
    closed_at: t.closed_at ?? null,
  }));
}

// ─── Main Serializer ──────────────────────────────────────────────────────────

/**
 * Serializes all pre-fetched engine outputs into a single, token-efficient
 * AgentContextPayload suitable for LLM consumption.
 *
 * This function is PURE — it has no side effects and performs no I/O.
 * Call it after gathering all inputs server-side.
 */
export function serializeAgentContext(input: SerializerInput): AgentContextPayload {
  const {
    structureAnalysis,
    activeFVGs,
    orderFlowEngine,
    smtContext,
    currentPrice,
    pdh,
    pdl,
    macroBias,
    displacementStatus,
    takerBuyRatio,
    oiDelta,
    sessionLevels,
    recentTrades,
    lastAgentDecision,
    symbol,
  } = input;

  // ── Displacement status ────────────────────────────────────────────────────
  const displacementActive =
    typeof displacementStatus === 'string' &&
    displacementStatus.includes('ACTIVE');

  const displacement: AgentDisplacementStatus = {
    displacement_active: displacementActive,
    institutional_sponsorship: displacementStatus,
    taker_buy_ratio: r4(takerBuyRatio),
    oi_delta: r4(oiDelta),
  };

  // ── SMT Context ────────────────────────────────────────────────────────────
  const smt: AgentSmtContext = {
    divergence: smtContext?.divergence ?? 'NEUTRAL',
    htf_order_flow_trend: smtContext?.htf_order_flow_trend ?? 'UNSET',
    counter_trend_vetoed: smtContext?.counter_trend_vetoed ?? false,
  };

  // ── Liquidity levels ───────────────────────────────────────────────────────
  const pools = orderFlowEngine.resting_liquidity_pools ?? {
    BSL_Magnets: [],
    SSL_Magnets: [],
  };

  const liquidity: AgentLiquidityLevels = {
    bsl_magnets: pools.BSL_Magnets.slice(0, 3).map((v) => r4(v) ?? v),
    ssl_magnets: pools.SSL_Magnets.slice(0, 3).map((v) => r4(v) ?? v),
    pdh: r4(pdh),
    pdl: r4(pdl),
    session_levels: sessionLevels
      ? {
          london_high: r4(sessionLevels.london_high ?? null),
          london_low: r4(sessionLevels.london_low ?? null),
          asian_high: r4(sessionLevels.asian_high ?? null),
          asian_low: r4(sessionLevels.asian_low ?? null),
        }
      : undefined,
  };

  // ── Assemble payload ───────────────────────────────────────────────────────
  return {
    generated_at: Date.now(),
    symbol,
    live_price: r4(currentPrice) ?? currentPrice,
    macro_daily_bias: macroBias,
    market_structure: serializeMarketStructure(structureAnalysis, currentPrice),
    active_fvgs: serializeFVGs(activeFVGs, currentPrice),
    liquidity,
    order_flow: serializeOrderFlow(orderFlowEngine),
    displacement,
    smt,
    trade_memory: serializeTradeMemory(recentTrades),
    last_agent_decision: lastAgentDecision,
  };
}
