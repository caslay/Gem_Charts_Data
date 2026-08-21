export interface StructuralSwing {
  /** Candle open time in milliseconds (UTC). */
  t: number;
  /** Price level of the swing (high for HIGHs, low for LOWs). */
  price: number | string;
  /** Whether this swing marks a local HIGH or LOW. */
  type: 'HIGH' | 'LOW';
  /** Grade: MAJOR = Level 2, INTERNAL = Level 1, INNER = Level 0. */
  grade: 'MAJOR' | 'INTERNAL' | 'INNER';
  /** Passes the Institutional Color Lock (API parity). */
  colorValidated: boolean;
  /** Index of this swing in the processed array. */
  candle_index?: number;
  /** ISO timestamp string of the swing candle. */
  timestamp?: string;
  /** Structure hierarchy classification: MAJOR (Parent Range) vs INTERNAL (Child Wave) vs INNER (Micro Wave) */
  structure_type?: 'MAJOR' | 'INTERNAL' | 'INNER';
  /** Confirmation flag: TRUE only when the succeeding candles have fully closed */
  confirmed?: boolean;
  /**
   * Anti-repainting firewall flag.
   * TRUE when this swing is a live synthesized expansion anchor (not yet a confirmed fractal).
   * Visual layers MUST render these as dashed/translucent — never as solid historical pivots.
   */
  is_expansion_float?: boolean;
}

export interface ZigZagSegment {
  /** The swing point this segment starts from. */
  from: StructuralSwing;
  /** The swing point this segment connects to. */
  to: StructuralSwing;
  /**
   * Contextual classification:
   *   BOS      — Break of Structure (trend continuation)
   *   MSS      — Market Structure Shift (trend reversal)
   *   INTERNAL — First segment / insufficient context for classification
   */
  label: 'BOS' | 'MSS' | 'INTERNAL';
  /** Trend state BEFORE this break was evaluated. */
  trendBefore: 'BULLISH' | 'BEARISH' | 'UNSET';
  /** Trend state AFTER this break was applied. */
  trendAfter: 'BULLISH' | 'BEARISH' | 'UNSET';
  /**
   * TRUE only when label === 'MSS' AND institutional displacement
   * sponsorship was active at the time of evaluation.
   */
  displacementConfirmed: boolean;
  /** The price level that was broken (if BOS or MSS) */
  brokenLevel?: number;
}

export interface StructuralDealingRange {
  high: number | null;
  low: number | null;
  equilibrium: number | null;
  current_status: 'PREMIUM' | 'DISCOUNT' | 'AWAITING_IDM_SWEEP';
  /** The swing that anchors the HIGH boundary. */
  anchor_high_swing: StructuralSwing | null;
  /** The swing that anchors the LOW boundary. */
  anchor_low_swing: StructuralSwing | null;
  profile_metrics?: {
    poc: number | null;
    vah: number | null;
    val: number | null;
    vsr: number | null;
  } | null;
}

export interface Pivot {
  type: 'SWING_HIGH' | 'SWING_LOW';
  index: number;
  price: number;
  confirmed: boolean;
  timestamp: number;
  level?: 0 | 1 | 2; // Support for multi-scale hierarchy
  colorValidated?: boolean; // Whether the strict directional color lock passed
}

export interface MarketStructureAnalysis {
  last_processed_index: number;
  engine_state: {
    current_trend_state: 'BULLISH_SWING' | 'BEARISH_SWING';
    protected_high: number | null;
    protected_low: number | null;
    active_swing_range: {
      low: number | null;
      high: number | null;
    };
  };
  swing_points: Pivot[];
  structural_events: any[];
  liquidity_zones: any[];
  /** 'RUNAWAY' when a displacement-backed BOS is actively expanding before fractal confirmation. */
  expansion_mode: 'NORMAL' | 'RUNAWAY';
  /** ATR-relative momentum speed since BOS origin. 0 when NORMAL. */
  market_velocity: number;
  /** Price of the structural level broken by the BOS that triggered expansion. null when NORMAL. */
  runaway_origin_price: number | null;

  // ─── Expansion Telemetry (NEW — Dynamic Range Freeze Resolution) ───────────
  /** TRUE during an active momentum leg between BOS confirmation and next confirmed MAJOR fractal. */
  is_in_expansion: boolean;
  /** Live floating ceiling during BULLISH expansion. null when not in expansion. Anti-repaints: never overwrites confirmed historical pivots. */
  expansion_high_float: number | null;
  /** Live floating floor during BEARISH expansion. null when not in expansion. Anti-repaints: never overwrites confirmed historical pivots. */
  expansion_low_float: number | null;

  // Mapped visual properties
  swings: StructuralSwing[];
  zigzag: ZigZagSegment[];
  dealingRange: StructuralDealingRange;
  currentTrend: 'BULLISH' | 'BEARISH' | 'UNSET';
  latestMSS: ZigZagSegment | null;
  market_structure_shift: boolean;
  market_structure_shift_direction: 'BULLISH' | 'BEARISH' | 'UNSET' | null;

  // Subordinate inner waves
  subTrend?: 'BULLISH' | 'BEARISH' | 'UNSET';
  innerSwings?: StructuralSwing[];
  innerZigzag?: ZigZagSegment[];
  internalTrend?: 'BULLISH' | 'BEARISH' | 'UNSET';
  internalZigzag?: ZigZagSegment[];
  latestInternalMSS?: ZigZagSegment | null;
  internal_market_structure_shift?: boolean;
  internalDealingRange?: StructuralDealingRange;
}

export interface MarketStructureConfig {
  atrPeriod?: number;
  lookbackMajor?: number;
  lookbackInternal?: number;
  lookbackMicro?: number;
  mssBodyRatio?: number;
  displacementVef?: number;
  sharpDepartureMult?: number;
}

// ─── Order Flow State Machine & Chronological Timeline Types ────────────────
export type OrderFlowState =
  | 'RISING_WITH_PRICE'       // Aggressive Buy Sponsorship (Longs Building)
  | 'RISING_AGAINST_PRICE'    // Aggressive Short Sponsorship (Shorts Building)
  | 'FALLING_WITH_PRICE'      // Long Liquidation / Long Unwinding
  | 'FALLING_AGAINST_PRICE'   // Short Covering / Short Squeeze
  | 'FLAT'                    // Equilibrium / Flat Open Interest
  | 'NEUTRAL'                 // Low Volatility / Undecided
  | 'UNAVAILABLE';            // Offline / Uninitialized

export interface OrderFlowStateRecord {
  id?: string | number;
  symbol: string;
  state: OrderFlowState;
  entered_at: number; // UTC ms timestamp
  entry_price: number;
  exited_at: number | null; // UTC ms timestamp (null while state is active)
  exit_price: number | null; // (null while state is active)
  duration_seconds: number | null; // calculated when state exits or live elapsed
  price_change?: number | null; // exit_price - entry_price (or live - entry)
  price_change_pct?: number | null; // ((exit_price - entry_price) / entry_price) * 100
  metadata?: {
    volume_delta?: number;
    oi_delta?: number;
    taker_buy_ratio?: number;
    displacement_status?: string;
    is_live?: boolean;
    candle_count?: number;
  };
}

export interface OrderFlowTimelineStats {
  total_transitions: number;
  time_in_buy_sponsorship_sec: number;
  time_in_short_sponsorship_sec: number;
  time_in_liquidation_sec: number;
  time_in_covering_sec: number;
  time_in_neutral_sec: number;
  dominant_state_last_24h: OrderFlowState;
  avg_state_duration_sec: number;
}

export interface OrderFlowTimelineSummary {
  active_state: OrderFlowStateRecord | null;
  history: OrderFlowStateRecord[];
  stats: OrderFlowTimelineStats;
}

