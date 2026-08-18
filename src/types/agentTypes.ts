/**
 * @file agentTypes.ts
 * @description Strict TypeScript interfaces for the M2M Agent Bridge API.
 *
 * These types govern ALL request/response shapes for /api/agent/context.
 * They are intentionally decoupled from NextAuth session types and browser
 * client interfaces, enabling headless agent consumption.
 *
 * @version 1.0.0 — Flow-State Quant Engine V15.2
 */

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AgentAuthResult {
  ok: boolean;
  error?: string;
}

// ─── Serialized Market Structure ───────────────────────────────────────────────

/**
 * A pruned swing pivot for LLM consumption.
 * Raw candle arrays are stripped — only the computed level is emitted.
 */
export interface AgentSwing {
  /** UTC ms timestamp of the swing candle open. */
  t: number;
  /** Price level (high for HIGHs, low for LOWs). */
  price: number;
  /** HIGH or LOW designation. */
  type: 'HIGH' | 'LOW';
  /** Structural hierarchy grade. */
  grade: 'MAJOR' | 'INTERNAL' | 'INNER';
  /** Passes the Institutional Directional Color Lock. */
  colorValidated: boolean;
}

/**
 * A pruned ZigZag segment for LLM consumption.
 * Only the break classification and directional context are emitted.
 */
export interface AgentZigZagSegment {
  from: AgentSwing;
  to: AgentSwing;
  /** BOS = trend continuation, MSS = trend reversal. */
  label: 'BOS' | 'MSS' | 'INTERNAL';
  trendBefore: 'BULLISH' | 'BEARISH' | 'UNSET';
  trendAfter: 'BULLISH' | 'BEARISH' | 'UNSET';
  /** MSS confirmed by institutional displacement sponsorship. */
  displacementConfirmed: boolean;
  brokenLevel?: number;
}

/** Active dealing range anchored to color-validated major fractals. */
export interface AgentDealingRange {
  high: number | null;
  low: number | null;
  equilibrium: number | null;
  /** Whether price is currently PREMIUM (above EQ) or DISCOUNT (below EQ). */
  current_status: 'PREMIUM' | 'DISCOUNT' | 'AWAITING_IDM_SWEEP';
  profile_metrics?: {
    poc: number | null;
    vah: number | null;
    val: number | null;
  } | null;
}

/** Pruned market structure map for agent reasoning. */
export interface AgentMarketStructure {
  /** Active macro trend from the color-validated state machine. */
  current_trend: 'BULLISH' | 'BEARISH' | 'UNSET';
  /** TRUE when the most recent structural break was an MSS. */
  market_structure_shift: boolean;
  market_structure_shift_direction: 'BULLISH' | 'BEARISH' | 'UNSET' | null;
  /** Last 10 ZigZag segments — oldest first. */
  zigzag: AgentZigZagSegment[];
  /** Last 5 confirmed MAJOR swings for reference levels. */
  major_swings: AgentSwing[];
  /** The most recently confirmed MSS segment (if any). */
  latest_mss: AgentZigZagSegment | null;
  /** Active macro dealing range. */
  dealing_range: AgentDealingRange;
  /** Internal (1-level down) trend state. */
  internal_trend?: 'BULLISH' | 'BEARISH' | 'UNSET';
}

// ─── Serialized FVGs ──────────────────────────────────────────────────────────

/** A single active, unmitigated Fair Value Gap. */
export interface AgentFVG {
  /** The UTC ms candle timestamp where the FVG was created. */
  t: number;
  top: number;
  bottom: number;
  /** BISI = Bullish Imbalance (buy-side), SIBI = Bearish (sell-side). */
  type: 'BISI' | 'SIBI';
  /** Timeframe the FVG was detected on. */
  timeframe: '15m' | '5m' | '1m' | '4h' | '1h';
  status: 'UNMITIGATED' | 'RETESTED' | 'PENDING';
}

// ─── Serialized Order Flow ────────────────────────────────────────────────────

/** Active order flow regime state. */
export interface AgentOrderFlowState {
  state:
    | 'RISING_WITH_PRICE'
    | 'RISING_AGAINST_PRICE'
    | 'FALLING_WITH_PRICE'
    | 'FALLING_AGAINST_PRICE'
    | 'FLAT'
    | 'NEUTRAL'
    | 'UNAVAILABLE';
  entered_at: number;
  entry_price: number;
  duration_seconds: number | null;
}

/** Condensed order flow telemetry for LLM reasoning. */
export interface AgentOrderFlowSummary {
  active_state: AgentOrderFlowState | null;
  dominant_state_last_24h:
    | 'RISING_WITH_PRICE'
    | 'RISING_AGAINST_PRICE'
    | 'FALLING_WITH_PRICE'
    | 'FALLING_AGAINST_PRICE'
    | 'FLAT'
    | 'NEUTRAL'
    | 'UNAVAILABLE';
  /** Last 5 state transitions for regime memory. */
  recent_transitions: AgentOrderFlowState[];
  time_in_buy_sponsorship_pct: number;
  time_in_short_sponsorship_pct: number;
}

// ─── Serialized Liquidity ─────────────────────────────────────────────────────

export interface AgentLiquidityLevels {
  /** Buy-side liquidity resting pools (overhead highs). */
  bsl_magnets: number[];
  /** Sell-side liquidity resting pools (below lows). */
  ssl_magnets: number[];
  /** Previous Day High / Low for session anchoring. */
  pdh: number | null;
  pdl: number | null;
  /** Intraday session context (London High/Low, Asian Range). */
  session_levels?: {
    london_high?: number | null;
    london_low?: number | null;
    asian_high?: number | null;
    asian_low?: number | null;
  };
}

// ─── Serialized Trade Memory ──────────────────────────────────────────────────

/** A trimmed active/recent trade record for agent memory injection. */
export interface AgentTradeRecord {
  id: string | number;
  direction: 'LONG' | 'SHORT';
  status: 'OPEN' | 'CLOSED' | 'PAUSED';
  symbol: string;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  outcome: 'WIN' | 'LOSS' | null;
  strategy_name: string;
  opened_at: string | null;
  closed_at: string | null;
}

// ─── Serialized Displacement ──────────────────────────────────────────────────

export interface AgentDisplacementStatus {
  displacement_active: boolean;
  /** ACTIVE_BULLISH | ACTIVE_BEARISH | INACTIVE | etc. */
  institutional_sponsorship: string;
  /** Taker buy volume ratio 0–1. */
  taker_buy_ratio?: number | null;
  oi_delta?: number | null;
}

// ─── SMT Context ──────────────────────────────────────────────────────────────

export interface AgentSmtContext {
  /** BULLISH_SMT | BEARISH_SMT | NEUTRAL */
  divergence: string;
  htf_order_flow_trend: string;
  /** TRUE when the 15m signal is vetoed by HTF bearish structure. */
  counter_trend_vetoed: boolean;
}

// ─── Full GET Response Payload ────────────────────────────────────────────────

/**
 * The complete, token-efficient context snapshot returned to an AI agent
 * via GET /api/agent/context.
 *
 * Raw OHLCV candle arrays are NEVER included. All data is pre-computed and labeled.
 */
export interface AgentContextPayload {
  /** UTC ms timestamp when this snapshot was generated. */
  generated_at: number;
  symbol: string;
  /** Current live market price. */
  live_price: number;
  /** Macro daily bias from the triple-vector engine. */
  macro_daily_bias: string;

  /** Compressed market structure map. */
  market_structure: AgentMarketStructure;

  /** Active, unmitigated Fair Value Gaps (max 5). */
  active_fvgs: AgentFVG[];

  /** Resting liquidity pools and session levels. */
  liquidity: AgentLiquidityLevels;

  /** Order flow regime state and telemetry. */
  order_flow: AgentOrderFlowSummary;

  /** Displacement engine verdict. */
  displacement: AgentDisplacementStatus;

  /** SMT inter-market divergence state. */
  smt: AgentSmtContext;

  /** Last 5 open/recent trades from the journal. */
  trade_memory: AgentTradeRecord[];

  /**
   * The most recent agent decision record from `agent_decision_log`.
   * Null if no prior decision has been recorded for this symbol.
   */
  last_agent_decision: AgentDecisionRecord | null;
}

// ─── POST Request Payload (Agent → Bridge) ────────────────────────────────────

/**
 * Structured analytical decision submitted by an AI agent via
 * POST /api/agent/context.
 */
export interface AgentDecisionPayload {
  /** Identifies the agent that submitted this decision (e.g. 'gemini-spark-v1'). */
  agent_id: string;
  symbol: string;
  /** The directional bias determined by the agent. */
  bias_signal:
    | 'CONFIRMED_BULLISH'
    | 'CONFIRMED_BEARISH'
    | 'NEUTRAL'
    | 'ABORT'
    | 'COUNTER_TREND_RETRACEMENT';
  /** Entry price range for limit order placement. */
  entry_range_low?: number;
  entry_range_high?: number;
  /**
   * The price level that INVALIDATES this decision.
   * Pre-flight check: if live_price has already breached this, the POST is rejected.
   */
  invalidation_level?: number;
  target_1?: number;
  target_2?: number;
  /** Free-form narrative rationale from the agent's reasoning pass. */
  narrative?: string;
}

// ─── PATCH Request Payload ────────────────────────────────────────────────────

export interface AgentDecisionPatchPayload {
  /** Must reference an existing agent_decision_log.id */
  id: number;
  status?: 'PENDING' | 'ACTIVE' | 'INVALIDATED' | 'COMPLETED';
  narrative?: string;
  target_1?: number;
  target_2?: number;
}

// ─── DB Row Shape ─────────────────────────────────────────────────────────────

/** Mirrors the `agent_decision_log` database row exactly. */
export interface AgentDecisionRecord {
  id: number;
  symbol: string;
  agent_id: string;
  bias_signal: string;
  entry_range_low: number | null;
  entry_range_high: number | null;
  invalidation_level: number | null;
  target_1: number | null;
  target_2: number | null;
  narrative: string | null;
  status: 'PENDING' | 'ACTIVE' | 'INVALIDATED' | 'COMPLETED';
  live_price_at_submission: number | null;
  submitted_at: number;
  invalidated_at: number | null;
  created_at: string;
}

// ─── Invalidation Guard Result ────────────────────────────────────────────────

export interface M2MInvalidationCheckResult {
  /** TRUE if live price has already breached the submitted invalidation_level. */
  breached: boolean;
  live_price: number;
  invalidation_level: number;
  /** Direction of the breach (price went ABOVE or BELOW the invalidation level). */
  breach_direction: 'ABOVE' | 'BELOW' | null;
}

// ─── Multi-Timeframe (MTF) Telemetry Context ──────────────────────────────────

export interface AgentTimeframeTelemetry {
  timeframe: '1m' | '5m' | '15m' | '1h';
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  structure_break: 'BOS' | 'MSS' | 'NONE';
  displacement: 'ACTIVE_BULLISH' | 'ACTIVE_BEARISH' | 'INACTIVE' | 'CONSOLIDATION';
  ols_tier: 'CONFIRMED_95' | 'MODERATE_90' | 'BORDERLINE_85' | 'REJECTED' | 'CONSOLIDATION';
  ols_tier_label: string;
  t_statistic: number;
  p_value: number;
  order_flow_regime: string;
  active_ob_count: number;
  unmitigated_fvg_count: number;
  dol_target: { price: number; type: 'BSL' | 'SSL'; distance_pips: number } | null;
  last_close_price: number;
}

export interface AgentMTFSummary {
  timeframes: Record<string, AgentTimeframeTelemetry>;
  htf_directional_bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  htf_alignment: boolean;
  top_down_confluence_pct: number;
  active_macro_dol: { price: number; type: 'BSL' | 'SSL'; timeframe: string; distance_pips: number } | null;
  evaluated_at: number;
}

