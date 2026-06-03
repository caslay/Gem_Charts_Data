export interface StructuralSwing {
  /** Candle open time in milliseconds (UTC). */
  t: number;
  /** Price level of the swing (high for HIGHs, low for LOWs). */
  price: number | string;
  /** Whether this swing marks a local HIGH or LOW. */
  type: 'HIGH' | 'LOW';
  /** Grade: MAJOR = Level 2 Multi-Scale, INNER = Level 1 Multi-Scale. Keep for API parity. */
  grade: 'MAJOR' | 'INNER';
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
}

export interface StructuralDealingRange {
  high: number | string;
  low: number | string;
  equilibrium: number | string;
  current_status: 'PREMIUM' | 'DISCOUNT' | 'AWAITING_IDM_SWEEP';
  /** The swing that anchors the HIGH boundary. */
  anchor_high_swing: StructuralSwing | null;
  /** The swing that anchors the LOW boundary. */
  anchor_low_swing: StructuralSwing | null;
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
  expansion_mode: 'NORMAL' | 'RUNAWAY';
  market_velocity: number;
  runaway_origin_price: number | null;
  
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
  retracementMultiplier0?: number;
  retracementMultiplier1?: number;
  retracementMultiplier2?: number;
  mssBodyRatio?: number;
  displacementVef?: number;
  sharpDepartureMult?: number;
}
