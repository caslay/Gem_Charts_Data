/**
 * OrderBlockEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Order Block Detection, Aggregation, Validation & Lifecycle Engine.
 *
 * Phase 4 Institutional Features:
 *  - Origin candle detection preceding high-displacement impulse legs
 *  - Consecutive same-color candle aggregation at pivot extremes
 *  - Mean Threshold (50% midpoint / Consequent Encroachment) precision entry
 *  - 4-Gate Institutional Validation Filter (Liquidity Sweep, Displacement & FVG, MSS/BOS, Dealing Range)
 *  - Tier A+ Strict Execution Gate (Gate 1 Liquidity Sweep mandate)
 *  - Temporal Freshness Expiry (Session-scoped max_bars_to_mitigation filter)
 *  - Breaker Block Inversion State Tracking & Temporal Retest Expiry (max_breaker_retest_bars)
 *  - Dynamic Trade Management State Machine (TP1 partial fill + Breakeven stop trail)
 *  - Phase 4 Confirmation-Gated Breaker Engine:
 *      * Draw on Liquidity (DOL) Gatekeeper (Resting BSL/SSL, Session extremes, PDH/PDL)
 *      * In-Zone Micro MSS & Fair Value Gap (BISI/SIBI) Confirmation Gate
 *      * Volumetric Sponsorship Filter (Taker volume delta & volume expansion)
 *      * Dealing Range Valuation (Discount for Bullish Breakers, Premium for Bearish Breakers)
 *      * Phase 4 Telemetry (Confirmed vs Blind Win Rate Delta, Net Expectancy EV)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle, detectActiveFVGs } from '../fvgEngine';
import { MarketStructureAPI } from './MarketStructureAPI';
import { PivotEngine } from './PivotEngine';

// ── Types & Interfaces ────────────────────────────────────────────────────────

export type OrderBlockType = 'BULLISH' | 'BEARISH';

export type OrderBlockQualityTier = 'A_PLUS' | 'A' | 'B' | 'UNVALIDATED';

export type OrderBlockLifecycleStatus =
  | 'UNTESTED'
  | 'MITIGATED_RESPECTED'
  | 'MEAN_THRESHOLD_VIOLATED'
  | 'ZONE_INVALIDATED'
  | 'EXPIRED_STALE'
  | 'ACTIVE_BREAKER'
  | 'BREAKER_EXPIRED'
  | 'BREAKER_VETOED_NO_DOL'
  | 'BREAKER_VETOED_VALUATION'
  | 'BREAKER_CONFIRMED_ACTIVE';

export type LiquiditySweepType =
  | 'BSL'
  | 'SSL'
  | 'ASIAN_HIGH'
  | 'ASIAN_LOW'
  | 'LONDON_HIGH'
  | 'LONDON_LOW'
  | 'PDH'
  | 'PDL'
  | 'SWING_HIGH'
  | 'SWING_LOW'
  | 'NONE';

export interface OrderBlockGateResults {
  gate1_liquidity_sweep: boolean;
  sweep_type: LiquiditySweepType;
  sweep_level: number | null;
  sweep_candle_index: number | null;

  gate2_displacement_imbalance: boolean;
  fvg_found: boolean;
  fvg_top: number | null;
  fvg_bottom: number | null;
  fvg_type: 'BISI' | 'SIBI' | null;
  displacement_body_ratio: number;
  displacement_volume_expansion: number;

  gate3_structure_break: boolean;
  structure_break_type: 'BOS' | 'MSS' | 'CHoCH' | 'NONE';
  broken_structure_level: number | null;

  gate4_dealing_range: boolean;
  dealing_range_location: 'DISCOUNT' | 'PREMIUM' | 'UNKNOWN';
  dealing_range_equilibrium: number | null;
  dealing_range_high: number | null;
  dealing_range_low: number | null;

  all_gates_passed: boolean;
  passed_gates_count: number;
}

export interface InstitutionalOrderBlock {
  id: string;
  type: OrderBlockType;
  symbol: string;
  timeframe: string;

  // Formation & Origin Geometry
  origin_time: number;          // Timestamp of the first origin candle in the aggregated sequence
  formation_time: number;       // Timestamp of the impulse candle confirming the block
  origin_index: number;
  formation_index: number;
  candles_count: number;        // Number of consecutive same-color candles aggregated

  top: number;                  // Maximum high of the aggregated origin sequence
  bottom: number;               // Minimum low of the aggregated origin sequence
  mean_threshold: number;       // 50% Midpoint (Consequent Encroachment) = (top + bottom) / 2
  range_height: number;         // top - bottom
  range_pct: number;            // (range_height / bottom) * 100

  // Volume & Flow Metrics
  volume_total: number;
  taker_buy_vol_total: number;
  taker_sell_vol_total: number;
  volume_delta_total: number;

  // Multi-Gate Validation
  gates: OrderBlockGateResults;
  quality_tier: OrderBlockQualityTier;
  confluence_score: number;     // 0 - 100

  // Lifecycle & Invalidation State Machine
  lifecycle_status: OrderBlockLifecycleStatus;
  is_body_close_violated: boolean;
  first_test_time: number | null;
  first_test_index: number | null;
  mitigation_time: number | null;
  mitigation_index: number | null;
  mitigation_price: number | null;
  max_penetration_price: number | null;
  max_retracement_depth_pct: number | null; // 0% = tapped boundary, 50% = touched MT, 100% = tapped bottom
  invalidation_time: number | null;
  invalidation_index: number | null;

  // Temporal Freshness (Phase 2)
  is_expired: boolean;
  expiration_time: number | null;
  is_fresh_mitigation: boolean;

  // Breaker Block Inversion Pipeline (Phase 2, 3 & 4)
  is_breaker: boolean;
  breaker_flip_time: number | null;
  is_breaker_expired: boolean;
  breaker_expiration_time: number | null;
  breaker_is_fresh: boolean;
  breaker_trade_outcome: 'WIN' | 'LOSS' | 'PENDING' | 'NO_RETEST' | 'EXPIRED';
  breaker_entry_price: number | null;
  breaker_stop_loss: number | null;
  breaker_tp: number | null;
  breaker_realized_rr: number;
  breaker_retest_time: number | null;
  breaker_bars_to_retest: number | null;

  // Phase 4: Confirmation-Gated Breaker Details
  breaker_is_confirmed: boolean;
  breaker_confirmation_type: 'MICRO_MSS_FVG' | 'BLIND_LIMIT' | 'NONE';
  breaker_confirmation_time: number | null;
  breaker_confirmation_index: number | null;
  breaker_fvg_top: number | null;
  breaker_fvg_bottom: number | null;
  breaker_volume_expansion: number | null;
  breaker_taker_delta: number | null;
  breaker_dol_target: number | null;
  breaker_dol_type: LiquiditySweepType | 'NONE';
  breaker_veto_reason: string | null;

  // Dynamic Trade Management & Execution Simulation (Phase 3)
  simulated_entry_price: number;
  simulated_stop_loss: number;
  simulated_tp1: number;         // 1.0R Partial Take Profit Level
  simulated_tp2: number;         // 2.0R / Target Runner Take Profit Level
  is_be_active: boolean;         // True once TP1 is hit and SL moved to Breakeven
  tp1_hit_time: number | null;
  tp1_hit_index: number | null;
  is_be_scratch: boolean;        // True if stopped out at exact breakeven (+0.5R protected)
  simulated_outcome: 'FULL_TP2_WIN' | 'BE_SCRATCH_WIN' | 'STOPPED_OUT' | 'WIN' | 'LOSS' | 'PENDING' | 'INVALIDATED' | 'EXPIRED';
  realized_rr: number;           // Blended realized R-multiple
  max_favorable_excursion_r: number;
  max_adverse_excursion_r: number;
  bars_to_mitigation: number | null;
  bars_to_outcome: number | null;
}

export interface OrderBlockScanConfig {
  symbol?: string;
  timeframe?: string;
  minQualityTier?: 'ALL' | 'A_PLUS_ONLY' | 'A_AND_A_PLUS';
  strictTierAPlus?: boolean;              // Phase 2: Mandates Gate 1 Liquidity Sweep
  maxBarsToMitigation?: number;           // Phase 2: Freshness Limit (default: 24 bars)
  enableBreakerSimulation?: boolean;      // Phase 2: Simulate Breaker Inversion trades
  maxBreakerRetestBars?: number;          // Phase 3: Breaker Freshness Expiry (default: 20 bars)
  enableDynamicManagement?: boolean;      // Phase 3: Multi-stage TP1/BE Management (default: true)
  tp1Multiple?: number;                   // Phase 3: Partial TP1 multiple in R (default: 1.0)
  requireBreakerConfirmation?: boolean;   // Phase 4: In-Zone Micro MSS + FVG Confirmation Gate (default: true)
  requireBreakerDOL?: boolean;            // Phase 4: Draw on Liquidity Target Gatekeeper (default: true)
  requireBreakerVolumetric?: boolean;     // Phase 4: Volumetric Sponsorship Gate (default: true)
  breakerSessionFilter?: 'ALL' | 'NY_AND_LONDON' | 'NY_ONLY' | 'LONDON_ONLY'; // Phase 4: Session filter
  aggregateConsecutiveCandles?: boolean;
  maxConsecutiveLookback?: number;
  sweepLookbackBars?: number;
  displacementMinBodyRatio?: number;
  displacementMinVolExpansion?: number;
  entryMode?: 'BOUNDARY' | 'MEAN_THRESHOLD';
  targetRewardRatio?: number;             // Phase 3: TP2 Runner Multiple in R (default: 2.0)
}

export interface OrderBlockTelemetrySummary {
  total_detected: number;
  total_bullish: number;
  total_bearish: number;
  aggregated_blocks_count: number;
  single_candle_blocks_count: number;
  aggregation_rate_pct: number;

  // Quality Tier Breakdown
  tier_a_plus_count: number;
  tier_a_count: number;
  tier_b_count: number;
  tier_unvalidated_count: number;
  validation_rate_pct: number; // (A+ and A) / Total

  // Lifecycle & Reaction Metrics
  untested_count: number;
  tested_count: number;
  mitigated_respected_count: number;
  mean_threshold_violated_count: number;
  zone_invalidated_count: number;
  expired_stale_count: number;
  mt_reaction_rate_pct: number; // Mitigated & Respected / Total Tested

  // Phase 2: Fresh vs. Stale Mitigation Comparison
  fresh_mitigation_count: number;
  fresh_win_rate_pct: number;
  fresh_avg_realized_rr: number;
  stale_mitigation_count: number;
  stale_win_rate_pct: number;
  stale_avg_realized_rr: number;

  // Phase 2: Tier A vs. Tier A+ Comparison
  tier_a_total_trades: number;
  tier_a_win_rate_pct: number;
  tier_a_avg_rr: number;
  tier_a_profit_factor: number;

  tier_a_plus_total_trades: number;
  tier_a_plus_win_rate_pct: number;
  tier_a_plus_avg_rr: number;
  tier_a_plus_profit_factor: number;

  tier_a_plus_win_rate_delta: number; // Tier A+ Win Rate - Tier A Win Rate
  tier_a_plus_rr_delta: number;       // Tier A+ R:R - Tier A R:R

  // Phase 2, 3 & 4: Breaker Block Telemetry
  breaker_converted_count: number;
  breaker_conversion_rate_pct: number;
  breaker_retest_count: number;
  breaker_retest_rate_pct: number;
  breaker_expired_count: number;
  breaker_winning_trades: number;
  breaker_losing_trades: number;
  breaker_win_rate_pct: number;
  breaker_avg_rr: number;
  fresh_breakers_count: number;
  fresh_breakers_win_rate_pct: number;
  stale_breakers_count: number;
  stale_breakers_win_rate_pct: number;
  breaker_freshness_win_rate_delta: number;

  // Phase 4: Confirmation-Gated vs Blind Breaker Analytics
  confirmed_breaker_retest_count: number;
  confirmed_breaker_win_rate_pct: number;
  confirmed_breaker_avg_rr: number;
  blind_breaker_retest_count: number;
  blind_breaker_win_rate_pct: number;
  blind_breaker_avg_rr: number;
  breaker_confirmation_win_rate_delta: number;
  breaker_confirmation_rr_delta: number;
  breaker_vetoed_count: number;
  breaker_vetoed_no_dol_count: number;
  breaker_vetoed_valuation_count: number;
  breaker_expected_value_r: number;

  // Phase 3: Dynamic Trade Management & Expectancy
  full_tp2_win_count: number;
  full_tp2_win_rate_pct: number;
  be_scratch_win_count: number;
  be_scratch_win_rate_pct: number;
  stopped_out_count: number;
  stopped_out_rate_pct: number;
  adjusted_win_rate_pct: number;       // (Full Wins + Protected BE Wins) / Closed Trades
  expected_value_r: number;            // Net EV per trade in R-multiples

  // Overall Backtest Outcome Metrics (Mitigated Trades)
  mitigation_total_trades: number;
  mitigation_winning_trades: number;
  mitigation_losing_trades: number;
  mitigation_pending_trades: number;
  mitigation_win_rate_pct: number;
  overall_profit_factor: number;

  avg_rr_tp1: number;
  avg_rr_tp2: number;
  avg_realized_rr: number;
  avg_max_favorable_excursion_r: number;
  avg_max_adverse_excursion_r: number;
  avg_retracement_depth_pct: number;
  avg_bars_to_mitigation: number;
  avg_bars_to_outcome: number;
}

// ── Default Scan Settings ─────────────────────────────────────────────────────

export const DEFAULT_OB_SCAN_CONFIG: Required<OrderBlockScanConfig> = {
  symbol: 'ETHUSDC',
  timeframe: '15m',
  minQualityTier: 'ALL',
  strictTierAPlus: false,
  maxBarsToMitigation: 24,
  enableBreakerSimulation: true,
  maxBreakerRetestBars: 20,
  enableDynamicManagement: true,
  tp1Multiple: 1.0,
  requireBreakerConfirmation: true,
  requireBreakerDOL: true,
  requireBreakerVolumetric: true,
  breakerSessionFilter: 'ALL',
  aggregateConsecutiveCandles: true,
  maxConsecutiveLookback: 5,
  sweepLookbackBars: 6,
  displacementMinBodyRatio: 0.55,
  displacementMinVolExpansion: 1.35,
  entryMode: 'BOUNDARY',
  targetRewardRatio: 2.0,
};

// ── Main OrderBlockEngine Class ──────────────────────────────────────────────

export class OrderBlockEngine {
  private config: Required<OrderBlockScanConfig>;

  constructor(customConfig?: OrderBlockScanConfig) {
    this.config = { ...DEFAULT_OB_SCAN_CONFIG, ...customConfig };
  }

  /**
   * Scans an entire chronological historical candlestick series step-by-step.
   * Ensures zero forward-looking data: every block is detected strictly when its
   * confirmation impulse candle closes.
   */
  public scanHistoricalOrderBlocks(candles: Candle[]): {
    orderBlocks: InstitutionalOrderBlock[];
    telemetry: OrderBlockTelemetrySummary;
  } {
    if (!candles || candles.length < 20) {
      return {
        orderBlocks: [],
        telemetry: this.createEmptyTelemetry()
      };
    }

    // Sort strictly ascending by timestamp
    const sortedCandles = [...candles].sort((a, b) => a.t - b.t);
    const detectedBlocks: InstitutionalOrderBlock[] = [];

    // Pre-calculate 20-bar volume SMA for displacement evaluation
    const volSma = this.computeVolumeSmaArray(sortedCandles, 20);

    // Track active swing pivots and structural events
    const pivotEngine = new PivotEngine();
    pivotEngine.processCandles(sortedCandles);
    const allPivots = pivotEngine.pivots.filter(p => p.confirmed);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Step-by-Step Chronological OB Detection
    // ─────────────────────────────────────────────────────────────────────────
    for (let i = 5; i < sortedCandles.length - 2; i++) {
      const impulseCandle = sortedCandles[i];
      const prevCandle = sortedCandles[i - 1];

      // ── 1. Bullish Order Block Candidate ──
      if (impulseCandle.c > impulseCandle.o && prevCandle.c <= prevCandle.o) {
        const ob = this.evaluateBullishObCandidate(
          sortedCandles,
          i,
          volSma[i] || 1,
          allPivots
        );
        if (ob) {
          detectedBlocks.push(ob);
        }
      }

      // ── 2. Bearish Order Block Candidate ──
      else if (impulseCandle.c < impulseCandle.o && prevCandle.c >= prevCandle.o) {
        const ob = this.evaluateBearishObCandidate(
          sortedCandles,
          i,
          volSma[i] || 1,
          allPivots
        );
        if (ob) {
          detectedBlocks.push(ob);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2, 3 & 4: Chronological Lifecycle, Expiry, Confirmation & Management
    // ─────────────────────────────────────────────────────────────────────────
    for (const ob of detectedBlocks) {
      this.evaluateOrderBlockLifecycle(ob, sortedCandles, allPivots, volSma);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Filter & Telemetry Calculation
    // ─────────────────────────────────────────────────────────────────────────
    let filteredBlocks = detectedBlocks;

    // Strict Tier A+ Execution Filter (Gate 1 Liquidity Sweep Mandate)
    if (this.config.strictTierAPlus) {
      filteredBlocks = filteredBlocks.filter(b => b.gates.gate1_liquidity_sweep && b.quality_tier === 'A_PLUS');
    } else if (this.config.minQualityTier === 'A_PLUS_ONLY') {
      filteredBlocks = filteredBlocks.filter(b => b.quality_tier === 'A_PLUS');
    } else if (this.config.minQualityTier === 'A_AND_A_PLUS') {
      filteredBlocks = filteredBlocks.filter(b => b.quality_tier === 'A_PLUS' || b.quality_tier === 'A');
    }

    const telemetry = this.calculateTelemetry(filteredBlocks, detectedBlocks);

    return {
      orderBlocks: filteredBlocks,
      telemetry
    };
  }

  // ── Candidate Detection Helpers ───────────────────────────────────────────

  private evaluateBullishObCandidate(
    candles: Candle[],
    impulseIdx: number,
    smaVol: number,
    pivots: import('./types').Pivot[]
  ): InstitutionalOrderBlock | null {
    const impulse = candles[impulseIdx];

    const impulseRange = impulse.h - impulse.l;
    if (impulseRange <= 0) return null;

    const impulseBody = impulse.c - impulse.o;
    const bodyRatio = impulseBody / impulseRange;
    const volExpansion = smaVol > 0 ? (impulse.v / smaVol) : 1.0;

    if (bodyRatio < this.config.displacementMinBodyRatio && volExpansion < this.config.displacementMinVolExpansion) {
      return null;
    }

    const originCandles: Candle[] = [];
    let curIdx = impulseIdx - 1;
    const maxLookback = this.config.aggregateConsecutiveCandles ? this.config.maxConsecutiveLookback : 1;

    while (curIdx >= 0 && originCandles.length < maxLookback) {
      const c = candles[curIdx];
      if (c.c <= c.o || originCandles.length === 0) {
        originCandles.unshift(c);
        if (c.c > c.o && originCandles.length > 0) break;
      } else {
        break;
      }
      curIdx--;
    }

    if (originCandles.length === 0) return null;

    const top = Math.max(...originCandles.map(c => c.h));
    const bottom = Math.min(...originCandles.map(c => c.l));
    const mean_threshold = parseFloat(((top + bottom) / 2).toFixed(4));
    const range_height = parseFloat((top - bottom).toFixed(4));
    const range_pct = bottom > 0 ? parseFloat(((range_height / bottom) * 100).toFixed(3)) : 0;

    const volume_total = originCandles.reduce((s, c) => s + (c.v || 0), 0);
    const taker_buy_vol_total = originCandles.reduce((s, c) => s + (c.taker_buy_vol || 0), 0);
    const taker_sell_vol_total = originCandles.reduce((s, c) => s + (c.taker_sell_vol || 0), 0);
    const volume_delta_total = taker_buy_vol_total - taker_sell_vol_total;

    const origin_time = originCandles[0].t;
    const formation_time = impulse.t;
    const origin_index = impulseIdx - originCandles.length;
    const formation_index = impulseIdx;

    const gates = this.evaluateMultiGates(
      'BULLISH',
      candles,
      origin_index,
      formation_index,
      top,
      bottom,
      mean_threshold,
      bodyRatio,
      volExpansion,
      pivots
    );

    const quality_tier = this.resolveQualityTier(gates);
    const confluence_score = this.computeConfluenceScore(gates, originCandles.length, range_pct);

    const entryPrice = this.config.entryMode === 'MEAN_THRESHOLD' ? mean_threshold : top;
    const tickBuffer = 0.05;
    const stopLoss = parseFloat((bottom - tickBuffer).toFixed(4));
    const risk = Math.max(0.1, entryPrice - stopLoss);
    const tp1 = parseFloat((entryPrice + this.config.tp1Multiple * risk).toFixed(4));
    const tp2 = parseFloat((entryPrice + this.config.targetRewardRatio * risk).toFixed(4));

    return {
      id: `OB_BULL_${origin_time}_${top.toFixed(2)}_${bottom.toFixed(2)}`,
      type: 'BULLISH',
      symbol: this.config.symbol,
      timeframe: this.config.timeframe,
      origin_time,
      formation_time,
      origin_index,
      formation_index,
      candles_count: originCandles.length,
      top: parseFloat(top.toFixed(4)),
      bottom: parseFloat(bottom.toFixed(4)),
      mean_threshold,
      range_height,
      range_pct,
      volume_total: parseFloat(volume_total.toFixed(2)),
      taker_buy_vol_total: parseFloat(taker_buy_vol_total.toFixed(2)),
      taker_sell_vol_total: parseFloat(taker_sell_vol_total.toFixed(2)),
      volume_delta_total: parseFloat(volume_delta_total.toFixed(2)),
      gates,
      quality_tier,
      confluence_score,
      lifecycle_status: 'UNTESTED',
      is_body_close_violated: false,
      first_test_time: null,
      first_test_index: null,
      mitigation_time: null,
      mitigation_index: null,
      mitigation_price: null,
      max_penetration_price: null,
      max_retracement_depth_pct: null,
      invalidation_time: null,
      invalidation_index: null,
      is_expired: false,
      expiration_time: null,
      is_fresh_mitigation: false,
      is_breaker: false,
      breaker_flip_time: null,
      is_breaker_expired: false,
      breaker_expiration_time: null,
      breaker_is_fresh: false,
      breaker_trade_outcome: 'NO_RETEST',
      breaker_entry_price: null,
      breaker_stop_loss: null,
      breaker_tp: null,
      breaker_realized_rr: 0,
      breaker_retest_time: null,
      breaker_bars_to_retest: null,
      breaker_is_confirmed: false,
      breaker_confirmation_type: 'NONE',
      breaker_confirmation_time: null,
      breaker_confirmation_index: null,
      breaker_fvg_top: null,
      breaker_fvg_bottom: null,
      breaker_volume_expansion: null,
      breaker_taker_delta: null,
      breaker_dol_target: null,
      breaker_dol_type: 'NONE',
      breaker_veto_reason: null,
      simulated_entry_price: parseFloat(entryPrice.toFixed(4)),
      simulated_stop_loss: stopLoss,
      simulated_tp1: tp1,
      simulated_tp2: tp2,
      is_be_active: false,
      tp1_hit_time: null,
      tp1_hit_index: null,
      is_be_scratch: false,
      simulated_outcome: 'PENDING',
      realized_rr: 0,
      max_favorable_excursion_r: 0,
      max_adverse_excursion_r: 0,
      bars_to_mitigation: null,
      bars_to_outcome: null,
    };
  }

  private evaluateBearishObCandidate(
    candles: Candle[],
    impulseIdx: number,
    smaVol: number,
    pivots: import('./types').Pivot[]
  ): InstitutionalOrderBlock | null {
    const impulse = candles[impulseIdx];

    const impulseRange = impulse.h - impulse.l;
    if (impulseRange <= 0) return null;

    const impulseBody = impulse.o - impulse.c;
    const bodyRatio = impulseBody / impulseRange;
    const volExpansion = smaVol > 0 ? (impulse.v / smaVol) : 1.0;

    if (bodyRatio < this.config.displacementMinBodyRatio && volExpansion < this.config.displacementMinVolExpansion) {
      return null;
    }

    const originCandles: Candle[] = [];
    let curIdx = impulseIdx - 1;
    const maxLookback = this.config.aggregateConsecutiveCandles ? this.config.maxConsecutiveLookback : 1;

    while (curIdx >= 0 && originCandles.length < maxLookback) {
      const c = candles[curIdx];
      if (c.c >= c.o || originCandles.length === 0) {
        originCandles.unshift(c);
        if (c.c < c.o && originCandles.length > 0) break;
      } else {
        break;
      }
      curIdx--;
    }

    if (originCandles.length === 0) return null;

    const top = Math.max(...originCandles.map(c => c.h));
    const bottom = Math.min(...originCandles.map(c => c.l));
    const mean_threshold = parseFloat(((top + bottom) / 2).toFixed(4));
    const range_height = parseFloat((top - bottom).toFixed(4));
    const range_pct = bottom > 0 ? parseFloat(((range_height / bottom) * 100).toFixed(3)) : 0;

    const volume_total = originCandles.reduce((s, c) => s + (c.v || 0), 0);
    const taker_buy_vol_total = originCandles.reduce((s, c) => s + (c.taker_buy_vol || 0), 0);
    const taker_sell_vol_total = originCandles.reduce((s, c) => s + (c.taker_sell_vol || 0), 0);
    const volume_delta_total = taker_buy_vol_total - taker_sell_vol_total;

    const origin_time = originCandles[0].t;
    const formation_time = impulse.t;
    const origin_index = impulseIdx - originCandles.length;
    const formation_index = impulseIdx;

    const gates = this.evaluateMultiGates(
      'BEARISH',
      candles,
      origin_index,
      formation_index,
      top,
      bottom,
      mean_threshold,
      bodyRatio,
      volExpansion,
      pivots
    );

    const quality_tier = this.resolveQualityTier(gates);
    const confluence_score = this.computeConfluenceScore(gates, originCandles.length, range_pct);

    const entryPrice = this.config.entryMode === 'MEAN_THRESHOLD' ? mean_threshold : bottom;
    const tickBuffer = 0.05;
    const stopLoss = parseFloat((top + tickBuffer).toFixed(4));
    const risk = Math.max(0.1, stopLoss - entryPrice);
    const tp1 = parseFloat((entryPrice - this.config.tp1Multiple * risk).toFixed(4));
    const tp2 = parseFloat((entryPrice - this.config.targetRewardRatio * risk).toFixed(4));

    return {
      id: `OB_BEAR_${origin_time}_${top.toFixed(2)}_${bottom.toFixed(2)}`,
      type: 'BEARISH',
      symbol: this.config.symbol,
      timeframe: this.config.timeframe,
      origin_time,
      formation_time,
      origin_index,
      formation_index,
      candles_count: originCandles.length,
      top: parseFloat(top.toFixed(4)),
      bottom: parseFloat(bottom.toFixed(4)),
      mean_threshold,
      range_height,
      range_pct,
      volume_total: parseFloat(volume_total.toFixed(2)),
      taker_buy_vol_total: parseFloat(taker_buy_vol_total.toFixed(2)),
      taker_sell_vol_total: parseFloat(taker_sell_vol_total.toFixed(2)),
      volume_delta_total: parseFloat(volume_delta_total.toFixed(2)),
      gates,
      quality_tier,
      confluence_score,
      lifecycle_status: 'UNTESTED',
      is_body_close_violated: false,
      first_test_time: null,
      first_test_index: null,
      mitigation_time: null,
      mitigation_index: null,
      mitigation_price: null,
      max_penetration_price: null,
      max_retracement_depth_pct: null,
      invalidation_time: null,
      invalidation_index: null,
      is_expired: false,
      expiration_time: null,
      is_fresh_mitigation: false,
      is_breaker: false,
      breaker_flip_time: null,
      is_breaker_expired: false,
      breaker_expiration_time: null,
      breaker_is_fresh: false,
      breaker_trade_outcome: 'NO_RETEST',
      breaker_entry_price: null,
      breaker_stop_loss: null,
      breaker_tp: null,
      breaker_realized_rr: 0,
      breaker_retest_time: null,
      breaker_bars_to_retest: null,
      breaker_is_confirmed: false,
      breaker_confirmation_type: 'NONE',
      breaker_confirmation_time: null,
      breaker_confirmation_index: null,
      breaker_fvg_top: null,
      breaker_fvg_bottom: null,
      breaker_volume_expansion: null,
      breaker_taker_delta: null,
      breaker_dol_target: null,
      breaker_dol_type: 'NONE',
      breaker_veto_reason: null,
      simulated_entry_price: parseFloat(entryPrice.toFixed(4)),
      simulated_stop_loss: stopLoss,
      simulated_tp1: tp1,
      simulated_tp2: tp2,
      is_be_active: false,
      tp1_hit_time: null,
      tp1_hit_index: null,
      is_be_scratch: false,
      simulated_outcome: 'PENDING',
      realized_rr: 0,
      max_favorable_excursion_r: 0,
      max_adverse_excursion_r: 0,
      bars_to_mitigation: null,
      bars_to_outcome: null,
    };
  }

  // ── Multi-Gate Validation Filter ──────────────────────────────────────────

  private evaluateMultiGates(
    type: OrderBlockType,
    candles: Candle[],
    originIdx: number,
    formationIdx: number,
    top: number,
    bottom: number,
    meanThreshold: number,
    bodyRatio: number,
    volExpansion: number,
    pivots: import('./types').Pivot[]
  ): OrderBlockGateResults {
    let gate1 = false;
    let sweepType: LiquiditySweepType = 'NONE';
    let sweepLevel: number | null = null;
    let sweepIdx: number | null = null;

    const sweepLookback = Math.min(this.config.sweepLookbackBars, originIdx);
    const preOriginCandles = candles.slice(Math.max(0, originIdx - sweepLookback), originIdx + 1);
    const priorPivots = pivots.filter(p => p.index < originIdx && p.index >= Math.max(0, originIdx - 50));

    if (type === 'BULLISH') {
      const lowWick = bottom;
      const priorLows = priorPivots.filter(p => p.type === 'SWING_LOW');

      for (const pl of priorLows) {
        if (lowWick < pl.price && preOriginCandles.some(c => c.c > pl.price || c.l <= pl.price)) {
          gate1 = true;
          sweepType = pl.level === 2 ? 'SSL' : 'SWING_LOW';
          sweepLevel = pl.price;
          sweepIdx = pl.index;
          break;
        }
      }

      if (!gate1 && preOriginCandles.length > 0) {
        const prior5Lows = candles.slice(Math.max(0, originIdx - 6), originIdx).map(c => c.l);
        const minPrior = prior5Lows.length > 0 ? Math.min(...prior5Lows) : Infinity;
        if (lowWick < minPrior) {
          gate1 = true;
          sweepType = 'SSL';
          sweepLevel = minPrior;
        }
      }
    } else {
      const highWick = top;
      const priorHighs = priorPivots.filter(p => p.type === 'SWING_HIGH');

      for (const ph of priorHighs) {
        if (highWick > ph.price && preOriginCandles.some(c => c.c < ph.price || c.h >= ph.price)) {
          gate1 = true;
          sweepType = ph.level === 2 ? 'BSL' : 'SWING_HIGH';
          sweepLevel = ph.price;
          sweepIdx = ph.index;
          break;
        }
      }

      if (!gate1 && preOriginCandles.length > 0) {
        const prior5Highs = candles.slice(Math.max(0, originIdx - 6), originIdx).map(c => c.h);
        const maxPrior = prior5Highs.length > 0 ? Math.max(...prior5Highs) : -Infinity;
        if (highWick > maxPrior) {
          gate1 = true;
          sweepType = 'BSL';
          sweepLevel = maxPrior;
        }
      }
    }

    // ── GATE 2: Displacement & Active FVG Formation ──
    let gate2 = false;
    let fvgFound = false;
    let fvgTop: number | null = null;
    let fvgBottom: number | null = null;
    let fvgType: 'BISI' | 'SIBI' | null = null;

    const nextIdx = formationIdx + 1;
    if (nextIdx < candles.length) {
      const c1 = candles[formationIdx - 1];
      const c3 = candles[nextIdx];

      if (type === 'BULLISH') {
        if (c3.l > c1.h) {
          fvgFound = true;
          fvgTop = c3.l;
          fvgBottom = c1.h;
          fvgType = 'BISI';
        }
      } else {
        if (c1.l > c3.h) {
          fvgFound = true;
          fvgTop = c1.l;
          fvgBottom = c3.h;
          fvgType = 'SIBI';
        }
      }
    }

    const hasStrongDisplacement = bodyRatio >= this.config.displacementMinBodyRatio || volExpansion >= this.config.displacementMinVolExpansion;
    gate2 = hasStrongDisplacement && fvgFound;

    // ── GATE 3: Structure Break (MSS / BOS) ──
    let gate3 = false;
    let breakType: 'BOS' | 'MSS' | 'CHoCH' | 'NONE' = 'NONE';
    let brokenLevel: number | null = null;

    const impulseCandle = candles[formationIdx];
    const recentOpposingSwings = priorPivots.filter(p => p.index < formationIdx && p.index >= Math.max(0, formationIdx - 30));

    if (type === 'BULLISH') {
      const priorHigh = recentOpposingSwings.filter(p => p.type === 'SWING_HIGH').slice(-1)[0];
      if (priorHigh && impulseCandle.c > priorHigh.price) {
        gate3 = true;
        breakType = priorHigh.level === 2 ? 'MSS' : 'BOS';
        brokenLevel = priorHigh.price;
      } else {
        const recentHighs = candles.slice(Math.max(0, formationIdx - 6), formationIdx).map(c => c.h);
        const maxRecent = recentHighs.length > 0 ? Math.max(...recentHighs) : Infinity;
        if (impulseCandle.c > maxRecent) {
          gate3 = true;
          breakType = 'BOS';
          brokenLevel = maxRecent;
        }
      }
    } else {
      const priorLow = recentOpposingSwings.filter(p => p.type === 'SWING_LOW').slice(-1)[0];
      if (priorLow && impulseCandle.c < priorLow.price) {
        gate3 = true;
        breakType = priorLow.level === 2 ? 'MSS' : 'BOS';
        brokenLevel = priorLow.price;
      } else {
        const recentLows = candles.slice(Math.max(0, formationIdx - 6), formationIdx).map(c => c.l);
        const minRecent = recentLows.length > 0 ? Math.min(...recentLows) : -Infinity;
        if (impulseCandle.c < minRecent) {
          gate3 = true;
          breakType = 'BOS';
          brokenLevel = minRecent;
        }
      }
    }

    // ── GATE 4: Dealing Range Location (Discount for Bullish / Premium for Bearish) ──
    let gate4 = false;
    let dealingLocation: 'DISCOUNT' | 'PREMIUM' | 'UNKNOWN' = 'UNKNOWN';

    const windowStart = Math.max(0, formationIdx - 50);
    const windowCandles = candles.slice(windowStart, formationIdx + 1);
    const drHigh = Math.max(...windowCandles.map(c => c.h));
    const drLow = Math.min(...windowCandles.map(c => c.l));
    const drEq = drHigh > drLow ? (drHigh + drLow) / 2 : meanThreshold;

    if (type === 'BULLISH') {
      if (top <= drEq || meanThreshold <= drEq) {
        gate4 = true;
        dealingLocation = 'DISCOUNT';
      } else {
        dealingLocation = 'PREMIUM';
      }
    } else {
      if (bottom >= drEq || meanThreshold >= drEq) {
        gate4 = true;
        dealingLocation = 'PREMIUM';
      } else {
        dealingLocation = 'DISCOUNT';
      }
    }

    const passedCount = (gate1 ? 1 : 0) + (gate2 ? 1 : 0) + (gate3 ? 1 : 0) + (gate4 ? 1 : 0);
    const allPassed = passedCount === 4;

    return {
      gate1_liquidity_sweep: gate1,
      sweep_type: sweepType,
      sweep_level: sweepLevel,
      sweep_candle_index: sweepIdx,

      gate2_displacement_imbalance: gate2,
      fvg_found: fvgFound,
      fvg_top: fvgTop,
      fvg_bottom: fvgBottom,
      fvg_type: fvgType,
      displacement_body_ratio: parseFloat(bodyRatio.toFixed(3)),
      displacement_volume_expansion: parseFloat(volExpansion.toFixed(2)),

      gate3_structure_break: gate3,
      structure_break_type: breakType,
      broken_structure_level: brokenLevel,

      gate4_dealing_range: gate4,
      dealing_range_location: dealingLocation,
      dealing_range_equilibrium: parseFloat(drEq.toFixed(4)),
      dealing_range_high: parseFloat(drHigh.toFixed(4)),
      dealing_range_low: parseFloat(drLow.toFixed(4)),

      all_gates_passed: allPassed,
      passed_gates_count: passedCount,
    };
  }

  private resolveQualityTier(gates: OrderBlockGateResults): OrderBlockQualityTier {
    if (gates.all_gates_passed || gates.passed_gates_count === 4) {
      return 'A_PLUS';
    } else if (gates.passed_gates_count === 3) {
      return 'A';
    } else if (gates.passed_gates_count === 2) {
      return 'B';
    }
    return 'UNVALIDATED';
  }

  private computeConfluenceScore(
    gates: OrderBlockGateResults,
    consecutiveCount: number,
    rangePct: number
  ): number {
    let score = 0;
    if (gates.gate1_liquidity_sweep) score += 25;
    if (gates.gate2_displacement_imbalance) score += 25;
    if (gates.gate3_structure_break) score += 25;
    if (gates.gate4_dealing_range) score += 25;

    if (consecutiveCount >= 2) score = Math.min(100, score + 5);
    if (rangePct > 2.5) score = Math.max(0, score - 10);

    return score;
  }

  // ── Phase 4: Draw on Liquidity (DOL) Gatekeeper ────────────────────────────

  private resolveDrawOnLiquidity(
    isBullishBreaker: boolean,
    candles: Candle[],
    activationIdx: number,
    pivots: import('./types').Pivot[],
    breakerEntry: number
  ): { target: number | null; type: LiquiditySweepType } {
    const lookbackStart = Math.max(0, activationIdx - 100);
    const relevantPivots = pivots.filter(p => p.index >= lookbackStart && p.index <= activationIdx);

    if (isBullishBreaker) {
      // Long Target: Resting BSL / Swing High above the breaker entry
      const highPivots = relevantPivots
        .filter(p => p.type === 'SWING_HIGH' && p.price > breakerEntry)
        .sort((a, b) => a.price - b.price); // Closest target first

      if (highPivots.length > 0) {
        const best = highPivots[0];
        return { target: best.price, type: best.level === 2 ? 'BSL' : 'SWING_HIGH' };
      }

      // Check max high of recent 50 bars
      const recentHighs = candles.slice(lookbackStart, activationIdx + 1).map(c => c.h);
      const maxH = Math.max(...recentHighs);
      if (maxH > breakerEntry * 1.003) {
        return { target: maxH, type: 'BSL' };
      }
    } else {
      // Short Target: Resting SSL / Swing Low below the breaker entry
      const lowPivots = relevantPivots
        .filter(p => p.type === 'SWING_LOW' && p.price < breakerEntry)
        .sort((a, b) => b.price - a.price); // Closest target first

      if (lowPivots.length > 0) {
        const best = lowPivots[0];
        return { target: best.price, type: best.level === 2 ? 'SSL' : 'SWING_LOW' };
      }

      const recentLows = candles.slice(lookbackStart, activationIdx + 1).map(c => c.l);
      const minL = Math.min(...recentLows);
      if (minL < breakerEntry * 0.997) {
        return { target: minL, type: 'SSL' };
      }
    }

    return { target: null, type: 'NONE' };
  }

  // ── Phase 2, 3 & 4: Dynamic Lifecycle, Expiry & Confirmation Engine ────────

  /**
   * Evaluates the lifecycle of the Order Block chronologically.
   * Enforces:
   *  1. Temporal Freshness Expiry (maxBarsToMitigation)
   *  2. Mean Threshold Precision Entry (50% midpoint)
   *  3. Body Close Rule for MT & Zone Invalidation
   *  4. Dynamic Trade Management (TP1 partial fill + BE stop loss trail)
   *  5. Confirmation-Gated Breaker Block Execution (DOL + Micro MSS + FVG + Volume Delta)
   */
  private evaluateOrderBlockLifecycle(
    ob: InstitutionalOrderBlock,
    candles: Candle[],
    pivots: import('./types').Pivot[],
    volSma: number[]
  ) {
    const startIdx = ob.formation_index + 1;
    if (startIdx >= candles.length) return;

    let isTested = false;
    let isMitigated = false;
    let isMtViolated = false;
    let isInvalidated = false;

    let deepestPrice = ob.type === 'BULLISH' ? ob.top : ob.bottom;
    const entryPrice = ob.simulated_entry_price;
    const initialStopLoss = ob.simulated_stop_loss;
    let activeStopLoss = initialStopLoss;
    const tp1 = ob.simulated_tp1;
    const tp2 = ob.simulated_tp2;
    const risk = Math.abs(entryPrice - initialStopLoss);

    let positionOpen = false;
    let entryCandleIdx: number | null = null;
    let maxFavorablePrice = entryPrice;
    let maxAdversePrice = entryPrice;

    let breakerActivationIdx: number | null = null;

    for (let i = startIdx; i < candles.length; i++) {
      const c = candles[i];
      const barsElapsed = i - ob.formation_index;

      // ── Temporal Expiry Gate (Phase 2) ──
      if (!isTested && barsElapsed > this.config.maxBarsToMitigation) {
        ob.is_expired = true;
        if (!ob.expiration_time) {
          ob.expiration_time = c.t;
          ob.lifecycle_status = 'EXPIRED_STALE';
        }
      }

      // ── 1. BULLISH ORDER BLOCK LIFECYCLE ──
      if (ob.type === 'BULLISH') {
        const testCondition = this.config.entryMode === 'MEAN_THRESHOLD'
          ? (c.l <= ob.mean_threshold)
          : (c.l <= ob.top);

        if (testCondition && !isInvalidated) {
          if (!isTested) {
            isTested = true;
            ob.first_test_time = c.t;
            ob.first_test_index = i;
            ob.bars_to_mitigation = barsElapsed;
            ob.is_fresh_mitigation = barsElapsed <= this.config.maxBarsToMitigation;
          }

          if (c.l < deepestPrice) {
            deepestPrice = c.l;
          }

          // Body Close Rule:
          if (c.c < ob.bottom) {
            isInvalidated = true;
            ob.lifecycle_status = 'ZONE_INVALIDATED';
            ob.invalidation_time = c.t;
            ob.invalidation_index = i;
            ob.is_breaker = true;
            ob.breaker_flip_time = c.t;
            breakerActivationIdx = i;

            if (positionOpen) {
              if (ob.is_be_active) {
                ob.simulated_outcome = 'BE_SCRATCH_WIN';
                ob.is_be_scratch = true;
                ob.realized_rr = parseFloat((0.5 * this.config.tp1Multiple).toFixed(2));
              } else {
                ob.simulated_outcome = 'STOPPED_OUT';
                ob.realized_rr = -1.0;
              }
              ob.bars_to_outcome = i - (entryCandleIdx ?? ob.formation_index);
              positionOpen = false;
            }
          } else if (c.c < ob.mean_threshold) {
            isMtViolated = true;
            ob.is_body_close_violated = true;
            ob.lifecycle_status = 'MEAN_THRESHOLD_VIOLATED';
          } else if (!isMtViolated) {
            isMitigated = true;
            ob.lifecycle_status = 'MITIGATED_RESPECTED';
            ob.mitigation_time = c.t;
            ob.mitigation_index = i;
            ob.mitigation_price = c.l;
          }

          // Trigger simulated trade open
          if (!positionOpen && ob.simulated_outcome === 'PENDING' && !isInvalidated) {
            if (!ob.is_expired || ob.is_fresh_mitigation) {
              positionOpen = true;
              entryCandleIdx = i;
            } else {
              ob.simulated_outcome = 'EXPIRED';
            }
          }
        }

        // Manage Dynamic Position Exits for Bullish Setup
        if (positionOpen) {
          if (c.h > maxFavorablePrice) maxFavorablePrice = c.h;
          if (c.l < maxAdversePrice) maxAdversePrice = c.l;

          const hitSL = c.l <= activeStopLoss;
          const hitTP1 = c.h >= tp1;
          const hitTP2 = c.h >= tp2;

          if (this.config.enableDynamicManagement) {
            if (hitTP1 && !ob.is_be_active) {
              ob.is_be_active = true;
              ob.tp1_hit_time = c.t;
              ob.tp1_hit_index = i;
              activeStopLoss = entryPrice; // Breakeven
            }

            if (ob.is_be_active) {
              if (hitTP2) {
                ob.simulated_outcome = 'FULL_TP2_WIN';
                const blended = (0.5 * this.config.tp1Multiple) + (0.5 * this.config.targetRewardRatio);
                ob.realized_rr = parseFloat(blended.toFixed(2));
                ob.bars_to_outcome = i - (entryCandleIdx ?? ob.formation_index);
                positionOpen = false;
              } else if (c.l <= activeStopLoss) {
                ob.simulated_outcome = 'BE_SCRATCH_WIN';
                ob.is_be_scratch = true;
                ob.realized_rr = parseFloat((0.5 * this.config.tp1Multiple).toFixed(2));
                ob.bars_to_outcome = i - (entryCandleIdx ?? ob.formation_index);
                positionOpen = false;
              }
            } else {
              if (hitSL) {
                ob.simulated_outcome = 'STOPPED_OUT';
                ob.realized_rr = -1.0;
                ob.bars_to_outcome = i - (entryCandleIdx ?? ob.formation_index);
                positionOpen = false;
              }
            }
          } else {
            if (hitSL) {
              ob.simulated_outcome = 'STOPPED_OUT';
              ob.realized_rr = -1.0;
              ob.bars_to_outcome = i - (entryCandleIdx ?? ob.formation_index);
              positionOpen = false;
            } else if (hitTP2) {
              ob.simulated_outcome = 'FULL_TP2_WIN';
              ob.realized_rr = parseFloat(((tp2 - entryPrice) / risk).toFixed(2));
              ob.bars_to_outcome = i - (entryCandleIdx ?? ob.formation_index);
              positionOpen = false;
            }
          }
        }
      }

      // ── 2. BEARISH ORDER BLOCK LIFECYCLE ──
      else {
        const testCondition = this.config.entryMode === 'MEAN_THRESHOLD'
          ? (c.h >= ob.mean_threshold)
          : (c.h >= ob.bottom);

        if (testCondition && !isInvalidated) {
          if (!isTested) {
            isTested = true;
            ob.first_test_time = c.t;
            ob.first_test_index = i;
            ob.bars_to_mitigation = barsElapsed;
            ob.is_fresh_mitigation = barsElapsed <= this.config.maxBarsToMitigation;
          }

          if (c.h > deepestPrice) {
            deepestPrice = c.h;
          }

          if (c.c > ob.top) {
            isInvalidated = true;
            ob.lifecycle_status = 'ZONE_INVALIDATED';
            ob.invalidation_time = c.t;
            ob.invalidation_index = i;
            ob.is_breaker = true;
            ob.breaker_flip_time = c.t;
            breakerActivationIdx = i;

            if (positionOpen) {
              if (ob.is_be_active) {
                ob.simulated_outcome = 'BE_SCRATCH_WIN';
                ob.is_be_scratch = true;
                ob.realized_rr = parseFloat((0.5 * this.config.tp1Multiple).toFixed(2));
              } else {
                ob.simulated_outcome = 'STOPPED_OUT';
                ob.realized_rr = -1.0;
              }
              ob.bars_to_outcome = i - (entryCandleIdx ?? ob.formation_index);
              positionOpen = false;
            }
          } else if (c.c > ob.mean_threshold) {
            isMtViolated = true;
            ob.is_body_close_violated = true;
            ob.lifecycle_status = 'MEAN_THRESHOLD_VIOLATED';
          } else if (!isMtViolated) {
            isMitigated = true;
            ob.lifecycle_status = 'MITIGATED_RESPECTED';
            ob.mitigation_time = c.t;
            ob.mitigation_index = i;
            ob.mitigation_price = c.h;
          }

          if (!positionOpen && ob.simulated_outcome === 'PENDING' && !isInvalidated) {
            if (!ob.is_expired || ob.is_fresh_mitigation) {
              positionOpen = true;
              entryCandleIdx = i;
            } else {
              ob.simulated_outcome = 'EXPIRED';
            }
          }
        }

        // Manage Dynamic Position Exits for Bearish Setup
        if (positionOpen) {
          if (c.l < maxFavorablePrice) maxFavorablePrice = c.l;
          if (c.h > maxAdversePrice) maxAdversePrice = c.h;

          const hitSL = c.h >= activeStopLoss;
          const hitTP1 = c.l <= tp1;
          const hitTP2 = c.l <= tp2;

          if (this.config.enableDynamicManagement) {
            if (hitTP1 && !ob.is_be_active) {
              ob.is_be_active = true;
              ob.tp1_hit_time = c.t;
              ob.tp1_hit_index = i;
              activeStopLoss = entryPrice;
            }

            if (ob.is_be_active) {
              if (hitTP2) {
                ob.simulated_outcome = 'FULL_TP2_WIN';
                const blended = (0.5 * this.config.tp1Multiple) + (0.5 * this.config.targetRewardRatio);
                ob.realized_rr = parseFloat(blended.toFixed(2));
                ob.bars_to_outcome = i - (entryCandleIdx ?? ob.formation_index);
                positionOpen = false;
              } else if (c.h >= activeStopLoss) {
                ob.simulated_outcome = 'BE_SCRATCH_WIN';
                ob.is_be_scratch = true;
                ob.realized_rr = parseFloat((0.5 * this.config.tp1Multiple).toFixed(2));
                ob.bars_to_outcome = i - (entryCandleIdx ?? ob.formation_index);
                positionOpen = false;
              }
            } else {
              if (hitSL) {
                ob.simulated_outcome = 'STOPPED_OUT';
                ob.realized_rr = -1.0;
                ob.bars_to_outcome = i - (entryCandleIdx ?? ob.formation_index);
                positionOpen = false;
              }
            }
          } else {
            if (hitSL) {
              ob.simulated_outcome = 'STOPPED_OUT';
              ob.realized_rr = -1.0;
              ob.bars_to_outcome = i - (entryCandleIdx ?? ob.formation_index);
              positionOpen = false;
            } else if (hitTP2) {
              ob.simulated_outcome = 'FULL_TP2_WIN';
              ob.realized_rr = parseFloat(((entryPrice - tp2) / risk).toFixed(2));
              ob.bars_to_outcome = i - (entryCandleIdx ?? ob.formation_index);
              positionOpen = false;
            }
          }
        }
      }

      if (isInvalidated) {
        break;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: Confirmation-Gated Inverted Breaker Block Engine
    // ─────────────────────────────────────────────────────────────────────────
    if (ob.is_breaker && breakerActivationIdx !== null && this.config.enableBreakerSimulation) {
      ob.lifecycle_status = 'ACTIVE_BREAKER';

      const isBearishBreaker = ob.type === 'BULLISH'; // Bullish OB violated -> Bearish Breaker (Resistance)
      const tickBuffer = 0.05;

      const breakerEntry = isBearishBreaker
        ? (this.config.entryMode === 'MEAN_THRESHOLD' ? ob.mean_threshold : ob.bottom)
        : (this.config.entryMode === 'MEAN_THRESHOLD' ? ob.mean_threshold : ob.top);

      const breakerSL = isBearishBreaker
        ? parseFloat((ob.top + tickBuffer).toFixed(4))
        : parseFloat((ob.bottom - tickBuffer).toFixed(4));

      const breakerRisk = Math.max(0.1, Math.abs(breakerEntry - breakerSL));

      // ── 1. Draw on Liquidity (DOL) Gatekeeper ──
      const dolResult = this.resolveDrawOnLiquidity(!isBearishBreaker, candles, breakerActivationIdx, pivots, breakerEntry);
      ob.breaker_dol_target = dolResult.target;
      ob.breaker_dol_type = dolResult.type;

      if (this.config.requireBreakerDOL && dolResult.target === null) {
        ob.lifecycle_status = 'BREAKER_VETOED_NO_DOL';
        ob.breaker_veto_reason = 'NO_UNMITIGATED_DOL_TARGET';
        ob.breaker_trade_outcome = 'EXPIRED';
        return;
      }

      // ── 2. Valuation Gatekeeper (Dealing Range) ──
      const windowStart = Math.max(0, breakerActivationIdx - 50);
      const drHigh = Math.max(...candles.slice(windowStart, breakerActivationIdx + 1).map(c => c.h));
      const drLow = Math.min(...candles.slice(windowStart, breakerActivationIdx + 1).map(c => c.l));
      const drEq = (drHigh + drLow) / 2;

      // Bullish Breaker must be in Discount (<= eq); Bearish Breaker in Premium (>= eq)
      const isDiscount = breakerEntry <= drEq;
      const isPremium = breakerEntry >= drEq;

      if (isBearishBreaker && !isPremium && breakerEntry < drEq * 0.98) {
        ob.lifecycle_status = 'BREAKER_VETOED_VALUATION';
        ob.breaker_veto_reason = 'BEARISH_BREAKER_IN_DISCOUNT';
        ob.breaker_trade_outcome = 'EXPIRED';
        return;
      } else if (!isBearishBreaker && !isDiscount && breakerEntry > drEq * 1.02) {
        ob.lifecycle_status = 'BREAKER_VETOED_VALUATION';
        ob.breaker_veto_reason = 'BULLISH_BREAKER_IN_PREMIUM';
        ob.breaker_trade_outcome = 'EXPIRED';
        return;
      }

      // Set TP based on DOL target or fixed R:R
      let breakerTP = isBearishBreaker
        ? parseFloat((breakerEntry - this.config.targetRewardRatio * breakerRisk).toFixed(4))
        : parseFloat((breakerEntry + this.config.targetRewardRatio * breakerRisk).toFixed(4));

      if (dolResult.target !== null) {
        // Use DOL target if it offers favorable R:R
        const dolReward = Math.abs(breakerEntry - dolResult.target);
        if (dolReward >= breakerRisk * 1.2) {
          breakerTP = dolResult.target;
        }
      }

      ob.breaker_entry_price = breakerEntry;
      ob.breaker_stop_loss = breakerSL;
      ob.breaker_tp = breakerTP;

      let breakerPositionOpen = false;
      let inZoneTouchIdx: number | null = null;

      for (let k = breakerActivationIdx + 1; k < candles.length; k++) {
        const bc = candles[k];
        const breakerBarsElapsed = k - breakerActivationIdx;

        // Breaker Expiry Gate
        if (!breakerPositionOpen && ob.breaker_trade_outcome === 'NO_RETEST') {
          if (breakerBarsElapsed > this.config.maxBreakerRetestBars) {
            ob.is_breaker_expired = true;
            ob.breaker_expiration_time = bc.t;
            ob.breaker_trade_outcome = 'EXPIRED';
            ob.lifecycle_status = 'BREAKER_EXPIRED';
            break;
          }

          // Check if price touched the Breaker zone
          const retestTouched = isBearishBreaker
            ? (bc.h >= breakerEntry)
            : (bc.l <= breakerEntry);

          if (retestTouched) {
            inZoneTouchIdx = k;
            ob.breaker_retest_time = bc.t;
            ob.breaker_bars_to_retest = breakerBarsElapsed;
            ob.breaker_is_fresh = breakerBarsElapsed <= this.config.maxBreakerRetestBars;
          }

          // ── Phase 4: Confirmation Evaluation (In-Zone Micro MSS + FVG + Volume Delta) ──
          if (inZoneTouchIdx !== null) {
            // Check Mean Threshold Respect (Candle body close cannot breach MT in invalid direction)
            const mtBreached = isBearishBreaker
              ? (bc.c > ob.mean_threshold)
              : (bc.c < ob.mean_threshold);

            if (mtBreached) {
              // MT violated -> Confirmation fails
              ob.breaker_trade_outcome = 'EXPIRED';
              ob.breaker_veto_reason = 'MT_BODY_CLOSE_VIOLATED_DURING_TEST';
              break;
            }

            if (this.config.requireBreakerConfirmation) {
              // Look for Micro MSS Reversal Candle & FVG in direction of trade
              const prev1 = candles[k - 1];
              const prev2 = candles[k - 2];

              let confirmedMss = false;
              let fvgCreated = false;
              let fvgTopVal: number | null = null;
              let fvgBotVal: number | null = null;

              if (isBearishBreaker) {
                // Bearish Micro MSS: Closes below prior low + creates SIBI FVG (prev2.l > bc.h)
                const isBearishRejection = bc.c < bc.o && bc.c < prev1.l;
                if (isBearishRejection) {
                  confirmedMss = true;
                  if (prev2 && prev2.l > bc.h) {
                    fvgCreated = true;
                    fvgTopVal = prev2.l;
                    fvgBotVal = bc.h;
                  }
                }
              } else {
                // Bullish Micro MSS: Closes above prior high + creates BISI FVG (bc.l > prev2.h)
                const isBullishRejection = bc.c > bc.o && bc.c > prev1.h;
                if (isBullishRejection) {
                  confirmedMss = true;
                  if (prev2 && bc.l > prev2.h) {
                    fvgCreated = true;
                    fvgTopVal = bc.l;
                    fvgBotVal = prev2.h;
                  }
                }
              }

              // Volumetric Check
              const smaV = volSma[k] || 1;
              const volExp = smaV > 0 ? bc.v / smaV : 1.0;
              const takerDelta = (bc.taker_buy_vol || 0) - (bc.taker_sell_vol || 0);
              const volPassed = !this.config.requireBreakerVolumetric || (
                isBearishBreaker ? (takerDelta < 0 || volExp >= 1.15) : (takerDelta > 0 || volExp >= 1.15)
              );

              if (confirmedMss && volPassed) {
                breakerPositionOpen = true;
                ob.breaker_is_confirmed = true;
                ob.breaker_confirmation_type = 'MICRO_MSS_FVG';
                ob.breaker_confirmation_time = bc.t;
                ob.breaker_confirmation_index = k;
                ob.breaker_fvg_top = fvgTopVal;
                ob.breaker_fvg_bottom = fvgBotVal;
                ob.breaker_volume_expansion = parseFloat(volExp.toFixed(2));
                ob.breaker_taker_delta = parseFloat(takerDelta.toFixed(2));
                ob.breaker_trade_outcome = 'PENDING';
                ob.lifecycle_status = 'BREAKER_CONFIRMED_ACTIVE';
              } else if (k - inZoneTouchIdx > 4) {
                // If 4 bars elapsed without confirmation, fail execution
                ob.breaker_trade_outcome = 'EXPIRED';
                ob.breaker_veto_reason = 'MICRO_MSS_CONFIRMATION_TIMEOUT';
                break;
              }
            } else {
              // Blind limit fill mode
              breakerPositionOpen = true;
              ob.breaker_is_confirmed = false;
              ob.breaker_confirmation_type = 'BLIND_LIMIT';
              ob.breaker_trade_outcome = 'PENDING';
            }
          }
        }

        // Manage Inverted Breaker Trade Exits
        if (breakerPositionOpen) {
          if (isBearishBreaker) {
            const hitSL = bc.h >= breakerSL;
            const hitTP = bc.l <= breakerTP;

            if (hitSL) {
              ob.breaker_trade_outcome = 'LOSS';
              ob.breaker_realized_rr = -1.0;
              breakerPositionOpen = false;
              break;
            } else if (hitTP) {
              ob.breaker_trade_outcome = 'WIN';
              ob.breaker_realized_rr = parseFloat(this.config.targetRewardRatio.toFixed(2));
              breakerPositionOpen = false;
              break;
            }
          } else {
            const hitSL = bc.l <= breakerSL;
            const hitTP = bc.h >= breakerTP;

            if (hitSL) {
              ob.breaker_trade_outcome = 'LOSS';
              ob.breaker_realized_rr = -1.0;
              breakerPositionOpen = false;
              break;
            } else if (hitTP) {
              ob.breaker_trade_outcome = 'WIN';
              ob.breaker_realized_rr = parseFloat(this.config.targetRewardRatio.toFixed(2));
              breakerPositionOpen = false;
              break;
            }
          }
        }
      }
    }

    // Compute final penetration depth % & Excursions
    if (isTested) {
      ob.max_penetration_price = deepestPrice;
      const height = ob.range_height || 1;
      if (ob.type === 'BULLISH') {
        const depth = ((ob.top - deepestPrice) / height) * 100;
        ob.max_retracement_depth_pct = parseFloat(Math.min(150, Math.max(0, depth)).toFixed(1));
      } else {
        const depth = ((deepestPrice - ob.bottom) / height) * 100;
        ob.max_retracement_depth_pct = parseFloat(Math.min(150, Math.max(0, depth)).toFixed(1));
      }

      if (risk > 0) {
        if (ob.type === 'BULLISH') {
          ob.max_favorable_excursion_r = parseFloat(((maxFavorablePrice - entryPrice) / risk).toFixed(2));
          ob.max_adverse_excursion_r = parseFloat(((entryPrice - maxAdversePrice) / risk).toFixed(2));
        } else {
          ob.max_favorable_excursion_r = parseFloat(((entryPrice - maxFavorablePrice) / risk).toFixed(2));
          ob.max_adverse_excursion_r = parseFloat(((maxAdversePrice - entryPrice) / risk).toFixed(2));
        }
      }
    }
  }

  // ── Phase 4 Telemetry & Net Expectancy Aggregator ─────────────────────────

  private calculateTelemetry(
    filteredBlocks: InstitutionalOrderBlock[],
    allDetectedBlocks: InstitutionalOrderBlock[]
  ): OrderBlockTelemetrySummary {
    if (filteredBlocks.length === 0) return this.createEmptyTelemetry();

    const total_detected = filteredBlocks.length;
    const total_bullish = filteredBlocks.filter(b => b.type === 'BULLISH').length;
    const total_bearish = filteredBlocks.filter(b => b.type === 'BEARISH').length;

    const aggregated_blocks_count = filteredBlocks.filter(b => b.candles_count >= 2).length;
    const single_candle_blocks_count = filteredBlocks.filter(b => b.candles_count === 1).length;
    const aggregation_rate_pct = parseFloat(((aggregated_blocks_count / total_detected) * 100).toFixed(1));

    const tier_a_plus_count = filteredBlocks.filter(b => b.quality_tier === 'A_PLUS').length;
    const tier_a_count = filteredBlocks.filter(b => b.quality_tier === 'A').length;
    const tier_b_count = filteredBlocks.filter(b => b.quality_tier === 'B').length;
    const tier_unvalidated_count = filteredBlocks.filter(b => b.quality_tier === 'UNVALIDATED').length;
    const validation_rate_pct = parseFloat((((tier_a_plus_count + tier_a_count) / total_detected) * 100).toFixed(1));

    const untested_count = filteredBlocks.filter(b => b.lifecycle_status === 'UNTESTED').length;
    const tested_count = total_detected - untested_count;
    const mitigated_respected_count = filteredBlocks.filter(b => b.lifecycle_status === 'MITIGATED_RESPECTED').length;
    const mean_threshold_violated_count = filteredBlocks.filter(b => b.lifecycle_status === 'MEAN_THRESHOLD_VIOLATED').length;
    const zone_invalidated_count = filteredBlocks.filter(b => b.lifecycle_status === 'ZONE_INVALIDATED' || b.is_breaker).length;
    const expired_stale_count = filteredBlocks.filter(b => b.lifecycle_status === 'EXPIRED_STALE' || b.is_expired).length;

    const mt_reaction_rate_pct = tested_count > 0
      ? parseFloat(((mitigated_respected_count / tested_count) * 100).toFixed(1))
      : 0;

    // ── Phase 3: Dynamic Trade Management Breakdown ──
    const testedBlocks = filteredBlocks.filter(b => b.lifecycle_status !== 'UNTESTED' && b.lifecycle_status !== 'EXPIRED_STALE');
    const closedTrades = testedBlocks.filter(b => b.simulated_outcome === 'FULL_TP2_WIN' || b.simulated_outcome === 'BE_SCRATCH_WIN' || b.simulated_outcome === 'STOPPED_OUT' || b.simulated_outcome === 'WIN' || b.simulated_outcome === 'LOSS');
    const closedCount = closedTrades.length;

    const full_tp2_win_count = closedTrades.filter(b => b.simulated_outcome === 'FULL_TP2_WIN' || b.simulated_outcome === 'WIN').length;
    const full_tp2_win_rate_pct = closedCount > 0
      ? parseFloat(((full_tp2_win_count / closedCount) * 100).toFixed(1))
      : 0;

    const be_scratch_win_count = closedTrades.filter(b => b.simulated_outcome === 'BE_SCRATCH_WIN' || b.is_be_scratch).length;
    const be_scratch_win_rate_pct = closedCount > 0
      ? parseFloat(((be_scratch_win_count / closedCount) * 100).toFixed(1))
      : 0;

    const stopped_out_count = closedTrades.filter(b => b.simulated_outcome === 'STOPPED_OUT' || b.simulated_outcome === 'LOSS').length;
    const stopped_out_rate_pct = closedCount > 0
      ? parseFloat(((stopped_out_count / closedCount) * 100).toFixed(1))
      : 0;

    const totalProfitableTrades = full_tp2_win_count + be_scratch_win_count;
    const adjusted_win_rate_pct = closedCount > 0
      ? parseFloat(((totalProfitableTrades / closedCount) * 100).toFixed(1))
      : 0;

    const sumRealizedR = closedTrades.reduce((s, b) => s + b.realized_rr, 0);
    const expected_value_r = closedCount > 0
      ? parseFloat((sumRealizedR / closedCount).toFixed(2))
      : 0;

    // ── Phase 2: Fresh vs. Stale Mitigation Comparison ──
    const freshMitigations = closedTrades.filter(b => b.is_fresh_mitigation);
    const freshWins = freshMitigations.filter(b => b.simulated_outcome === 'FULL_TP2_WIN' || b.simulated_outcome === 'BE_SCRATCH_WIN' || b.simulated_outcome === 'WIN').length;
    const fresh_win_rate_pct = freshMitigations.length > 0
      ? parseFloat(((freshWins / freshMitigations.length) * 100).toFixed(1))
      : 0;
    const fresh_avg_realized_rr = freshMitigations.length > 0
      ? parseFloat((freshMitigations.reduce((s, b) => s + b.realized_rr, 0) / freshMitigations.length).toFixed(2))
      : 0;

    const staleMitigations = closedTrades.filter(b => !b.is_fresh_mitigation);
    const staleWins = staleMitigations.filter(b => b.simulated_outcome === 'FULL_TP2_WIN' || b.simulated_outcome === 'BE_SCRATCH_WIN' || b.simulated_outcome === 'WIN').length;
    const stale_win_rate_pct = staleMitigations.length > 0
      ? parseFloat(((staleWins / staleMitigations.length) * 100).toFixed(1))
      : 0;
    const stale_avg_realized_rr = staleMitigations.length > 0
      ? parseFloat((staleMitigations.reduce((s, b) => s + b.realized_rr, 0) / staleMitigations.length).toFixed(2))
      : 0;

    // ── Phase 2: Tier A vs. Tier A+ Comparison ──
    const tierATrades = allDetectedBlocks.filter(b => b.quality_tier === 'A' && (b.simulated_outcome === 'FULL_TP2_WIN' || b.simulated_outcome === 'BE_SCRATCH_WIN' || b.simulated_outcome === 'STOPPED_OUT' || b.simulated_outcome === 'WIN' || b.simulated_outcome === 'LOSS'));
    const tierAWins = tierATrades.filter(b => b.simulated_outcome === 'FULL_TP2_WIN' || b.simulated_outcome === 'BE_SCRATCH_WIN' || b.simulated_outcome === 'WIN').length;
    const tierALosses = tierATrades.filter(b => b.simulated_outcome === 'STOPPED_OUT' || b.simulated_outcome === 'LOSS').length;
    const tier_a_win_rate_pct = tierATrades.length > 0
      ? parseFloat(((tierAWins / tierATrades.length) * 100).toFixed(1))
      : 0;
    const tier_a_avg_rr = tierATrades.length > 0
      ? parseFloat((tierATrades.reduce((s, b) => s + b.realized_rr, 0) / tierATrades.length).toFixed(2))
      : 0;
    const tierAGrossProfit = tierATrades.filter(b => b.realized_rr > 0).reduce((s, b) => s + b.realized_rr, 0);
    const tierAGrossLoss = tierALosses * 1.0;
    const tier_a_profit_factor = tierAGrossLoss > 0 ? parseFloat((tierAGrossProfit / tierAGrossLoss).toFixed(2)) : tierAGrossProfit > 0 ? 99.9 : 0;

    const tierAPlusTrades = allDetectedBlocks.filter(b => b.quality_tier === 'A_PLUS' && (b.simulated_outcome === 'FULL_TP2_WIN' || b.simulated_outcome === 'BE_SCRATCH_WIN' || b.simulated_outcome === 'STOPPED_OUT' || b.simulated_outcome === 'WIN' || b.simulated_outcome === 'LOSS'));
    const tierAPlusWins = tierAPlusTrades.filter(b => b.simulated_outcome === 'FULL_TP2_WIN' || b.simulated_outcome === 'BE_SCRATCH_WIN' || b.simulated_outcome === 'WIN').length;
    const tierAPlusLosses = tierAPlusTrades.filter(b => b.simulated_outcome === 'STOPPED_OUT' || b.simulated_outcome === 'LOSS').length;
    const tier_a_plus_win_rate_pct = tierAPlusTrades.length > 0
      ? parseFloat(((tierAPlusWins / tierAPlusTrades.length) * 100).toFixed(1))
      : 0;
    const tier_a_plus_avg_rr = tierAPlusTrades.length > 0
      ? parseFloat((tierAPlusTrades.reduce((s, b) => s + b.realized_rr, 0) / tierAPlusTrades.length).toFixed(2))
      : 0;
    const tierAPlusGrossProfit = tierAPlusTrades.filter(b => b.realized_rr > 0).reduce((s, b) => s + b.realized_rr, 0);
    const tierAPlusGrossLoss = tierAPlusLosses * 1.0;
    const tier_a_plus_profit_factor = tierAPlusGrossLoss > 0 ? parseFloat((tierAPlusGrossProfit / tierAPlusGrossLoss).toFixed(2)) : tierAPlusGrossProfit > 0 ? 99.9 : 0;

    const tier_a_plus_win_rate_delta = parseFloat((tier_a_plus_win_rate_pct - tier_a_win_rate_pct).toFixed(1));
    const tier_a_plus_rr_delta = parseFloat((tier_a_plus_avg_rr - tier_a_avg_rr).toFixed(2));

    // ── Phase 2, 3 & 4: Breaker Block Telemetry ──
    const breakerBlocks = filteredBlocks.filter(b => b.is_breaker);
    const breaker_converted_count = breakerBlocks.length;
    const breaker_conversion_rate_pct = zone_invalidated_count > 0
      ? parseFloat(((breaker_converted_count / zone_invalidated_count) * 100).toFixed(1))
      : 0;

    const breakerExpired = breakerBlocks.filter(b => b.is_breaker_expired || b.lifecycle_status === 'BREAKER_EXPIRED' || b.breaker_trade_outcome === 'EXPIRED');
    const breaker_expired_count = breakerExpired.length;

    const breakerRetested = breakerBlocks.filter(b => b.breaker_trade_outcome === 'WIN' || b.breaker_trade_outcome === 'LOSS' || b.breaker_trade_outcome === 'PENDING');
    const breaker_retest_count = breakerRetested.length;
    const breaker_retest_rate_pct = breaker_converted_count > 0
      ? parseFloat(((breaker_retest_count / breaker_converted_count) * 100).toFixed(1))
      : 0;

    const breakerCompleted = breakerRetested.filter(b => b.breaker_trade_outcome === 'WIN' || b.breaker_trade_outcome === 'LOSS');
    const breaker_winning_trades = breakerCompleted.filter(b => b.breaker_trade_outcome === 'WIN').length;
    const breaker_losing_trades = breakerCompleted.filter(b => b.breaker_trade_outcome === 'LOSS').length;
    const breaker_win_rate_pct = breakerCompleted.length > 0
      ? parseFloat(((breaker_winning_trades / breakerCompleted.length) * 100).toFixed(1))
      : 0;
    const breaker_avg_rr = breakerCompleted.length > 0
      ? parseFloat((breakerCompleted.reduce((s, b) => s + b.breaker_realized_rr, 0) / breakerCompleted.length).toFixed(2))
      : 0;

    // Fresh vs Stale Breakers
    const freshBreakers = breakerCompleted.filter(b => b.breaker_is_fresh);
    const freshBreakerWins = freshBreakers.filter(b => b.breaker_trade_outcome === 'WIN').length;
    const fresh_breakers_win_rate_pct = freshBreakers.length > 0
      ? parseFloat(((freshBreakerWins / freshBreakers.length) * 100).toFixed(1))
      : 0;

    const staleBreakers = breakerCompleted.filter(b => !b.breaker_is_fresh);
    const staleBreakerWins = staleBreakers.filter(b => b.breaker_trade_outcome === 'WIN').length;
    const stale_breakers_win_rate_pct = staleBreakers.length > 0
      ? parseFloat(((staleBreakerWins / staleBreakers.length) * 100).toFixed(1))
      : 0;

    const breaker_freshness_win_rate_delta = parseFloat((fresh_breakers_win_rate_pct - stale_breakers_win_rate_pct).toFixed(1));

    // ── Phase 4: Confirmation-Gated Analytics ──
    const confirmedBreakers = breakerCompleted.filter(b => b.breaker_is_confirmed);
    const confirmedWins = confirmedBreakers.filter(b => b.breaker_trade_outcome === 'WIN').length;
    const confirmed_breaker_retest_count = confirmedBreakers.length;
    const confirmed_breaker_win_rate_pct = confirmed_breaker_retest_count > 0
      ? parseFloat(((confirmedWins / confirmed_breaker_retest_count) * 100).toFixed(1))
      : 0;
    const confirmed_breaker_avg_rr = confirmed_breaker_retest_count > 0
      ? parseFloat((confirmedBreakers.reduce((s, b) => s + b.breaker_realized_rr, 0) / confirmed_breaker_retest_count).toFixed(2))
      : 0;

    const blindBreakers = breakerCompleted.filter(b => !b.breaker_is_confirmed);
    const blindWins = blindBreakers.filter(b => b.breaker_trade_outcome === 'WIN').length;
    const blind_breaker_retest_count = blindBreakers.length;
    const blind_breaker_win_rate_pct = blind_breaker_retest_count > 0
      ? parseFloat(((blindWins / blind_breaker_retest_count) * 100).toFixed(1))
      : 0;
    const blind_breaker_avg_rr = blind_breaker_retest_count > 0
      ? parseFloat((blindBreakers.reduce((s, b) => s + b.breaker_realized_rr, 0) / blind_breaker_retest_count).toFixed(2))
      : 0;

    const breaker_confirmation_win_rate_delta = parseFloat((confirmed_breaker_win_rate_pct - blind_breaker_win_rate_pct).toFixed(1));
    const breaker_confirmation_rr_delta = parseFloat((confirmed_breaker_avg_rr - blind_breaker_avg_rr).toFixed(2));

    const breaker_vetoed_no_dol_count = breakerBlocks.filter(b => b.lifecycle_status === 'BREAKER_VETOED_NO_DOL').length;
    const breaker_vetoed_valuation_count = breakerBlocks.filter(b => b.lifecycle_status === 'BREAKER_VETOED_VALUATION').length;
    const breaker_vetoed_count = breaker_vetoed_no_dol_count + breaker_vetoed_valuation_count;

    const breaker_expected_value_r = confirmed_breaker_retest_count > 0
      ? parseFloat((confirmedBreakers.reduce((s, b) => s + b.breaker_realized_rr, 0) / confirmed_breaker_retest_count).toFixed(2))
      : 0;

    // ── Overall Closed Trades Telemetry ──
    const mitigation_total_trades = testedBlocks.length;
    const mitigation_winning_trades = totalProfitableTrades;
    const mitigation_losing_trades = stopped_out_count;
    const mitigation_pending_trades = testedBlocks.filter(b => b.simulated_outcome === 'PENDING').length;

    const mitigation_win_rate_pct = closedCount > 0
      ? parseFloat(((full_tp2_win_count / closedCount) * 100).toFixed(1))
      : 0;

    const grossProfit = closedTrades.filter(b => b.realized_rr > 0).reduce((s, b) => s + b.realized_rr, 0);
    const grossLoss = stopped_out_count * 1.0;
    const overall_profit_factor = grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99.9 : 0;

    const avg_realized_rr = closedCount > 0
      ? parseFloat((closedTrades.reduce((s, b) => s + b.realized_rr, 0) / closedCount).toFixed(2))
      : 0;

    const avg_mfe = testedBlocks.length > 0
      ? parseFloat((testedBlocks.reduce((s, b) => s + b.max_favorable_excursion_r, 0) / testedBlocks.length).toFixed(2))
      : 0;
    const avg_mae = testedBlocks.length > 0
      ? parseFloat((testedBlocks.reduce((s, b) => s + b.max_adverse_excursion_r, 0) / testedBlocks.length).toFixed(2))
      : 0;

    const blocksWithDepth = testedBlocks.filter(b => b.max_retracement_depth_pct !== null);
    const avg_retracement_depth_pct = blocksWithDepth.length > 0
      ? parseFloat((blocksWithDepth.reduce((s, b) => s + (b.max_retracement_depth_pct || 0), 0) / blocksWithDepth.length).toFixed(1))
      : 0;

    const blocksWithBarsToMit = testedBlocks.filter(b => b.bars_to_mitigation !== null);
    const avg_bars_to_mitigation = blocksWithBarsToMit.length > 0
      ? Math.round(blocksWithBarsToMit.reduce((s, b) => s + (b.bars_to_mitigation || 0), 0) / blocksWithBarsToMit.length)
      : 0;

    const blocksWithBarsToOut = testedBlocks.filter(b => b.bars_to_outcome !== null);
    const avg_bars_to_outcome = blocksWithBarsToOut.length > 0
      ? Math.round(blocksWithBarsToOut.reduce((s, b) => s + (b.bars_to_outcome || 0), 0) / blocksWithBarsToOut.length)
      : 0;

    return {
      total_detected,
      total_bullish,
      total_bearish,
      aggregated_blocks_count,
      single_candle_blocks_count,
      aggregation_rate_pct,

      tier_a_plus_count,
      tier_a_count,
      tier_b_count,
      tier_unvalidated_count,
      validation_rate_pct,

      untested_count,
      tested_count,
      mitigated_respected_count,
      mean_threshold_violated_count,
      zone_invalidated_count,
      expired_stale_count,
      mt_reaction_rate_pct,

      fresh_mitigation_count: freshMitigations.length,
      fresh_win_rate_pct,
      fresh_avg_realized_rr,
      stale_mitigation_count: staleMitigations.length,
      stale_win_rate_pct,
      stale_avg_realized_rr,

      tier_a_total_trades: tierATrades.length,
      tier_a_win_rate_pct,
      tier_a_avg_rr,
      tier_a_profit_factor,

      tier_a_plus_total_trades: tierAPlusTrades.length,
      tier_a_plus_win_rate_pct,
      tier_a_plus_avg_rr,
      tier_a_plus_profit_factor,

      tier_a_plus_win_rate_delta,
      tier_a_plus_rr_delta,

      breaker_converted_count,
      breaker_conversion_rate_pct,
      breaker_retest_count,
      breaker_retest_rate_pct,
      breaker_expired_count,
      breaker_winning_trades,
      breaker_losing_trades,
      breaker_win_rate_pct,
      breaker_avg_rr,
      fresh_breakers_count: freshBreakers.length,
      fresh_breakers_win_rate_pct,
      stale_breakers_count: staleBreakers.length,
      stale_breakers_win_rate_pct,
      breaker_freshness_win_rate_delta,

      confirmed_breaker_retest_count,
      confirmed_breaker_win_rate_pct,
      confirmed_breaker_avg_rr,
      blind_breaker_retest_count,
      blind_breaker_win_rate_pct,
      blind_breaker_avg_rr,
      breaker_confirmation_win_rate_delta,
      breaker_confirmation_rr_delta,
      breaker_vetoed_count,
      breaker_vetoed_no_dol_count,
      breaker_vetoed_valuation_count,
      breaker_expected_value_r,

      full_tp2_win_count,
      full_tp2_win_rate_pct,
      be_scratch_win_count,
      be_scratch_win_rate_pct,
      stopped_out_count,
      stopped_out_rate_pct,
      adjusted_win_rate_pct,
      expected_value_r,

      mitigation_total_trades,
      mitigation_winning_trades,
      mitigation_losing_trades,
      mitigation_pending_trades,
      mitigation_win_rate_pct,
      overall_profit_factor,

      avg_rr_tp1: this.config.tp1Multiple,
      avg_rr_tp2: this.config.targetRewardRatio,
      avg_realized_rr,
      avg_max_favorable_excursion_r: avg_mfe,
      avg_max_adverse_excursion_r: avg_mae,
      avg_retracement_depth_pct,
      avg_bars_to_mitigation,
      avg_bars_to_outcome,
    };
  }

  private createEmptyTelemetry(): OrderBlockTelemetrySummary {
    return {
      total_detected: 0,
      total_bullish: 0,
      total_bearish: 0,
      aggregated_blocks_count: 0,
      single_candle_blocks_count: 0,
      aggregation_rate_pct: 0,
      tier_a_plus_count: 0,
      tier_a_count: 0,
      tier_b_count: 0,
      tier_unvalidated_count: 0,
      validation_rate_pct: 0,
      untested_count: 0,
      tested_count: 0,
      mitigated_respected_count: 0,
      mean_threshold_violated_count: 0,
      zone_invalidated_count: 0,
      expired_stale_count: 0,
      mt_reaction_rate_pct: 0,
      fresh_mitigation_count: 0,
      fresh_win_rate_pct: 0,
      fresh_avg_realized_rr: 0,
      stale_mitigation_count: 0,
      stale_win_rate_pct: 0,
      stale_avg_realized_rr: 0,
      tier_a_total_trades: 0,
      tier_a_win_rate_pct: 0,
      tier_a_avg_rr: 0,
      tier_a_profit_factor: 0,
      tier_a_plus_total_trades: 0,
      tier_a_plus_win_rate_pct: 0,
      tier_a_plus_avg_rr: 0,
      tier_a_plus_profit_factor: 0,
      tier_a_plus_win_rate_delta: 0,
      tier_a_plus_rr_delta: 0,
      breaker_converted_count: 0,
      breaker_conversion_rate_pct: 0,
      breaker_retest_count: 0,
      breaker_retest_rate_pct: 0,
      breaker_expired_count: 0,
      breaker_winning_trades: 0,
      breaker_losing_trades: 0,
      breaker_win_rate_pct: 0,
      breaker_avg_rr: 0,
      fresh_breakers_count: 0,
      fresh_breakers_win_rate_pct: 0,
      stale_breakers_count: 0,
      stale_breakers_win_rate_pct: 0,
      breaker_freshness_win_rate_delta: 0,
      confirmed_breaker_retest_count: 0,
      confirmed_breaker_win_rate_pct: 0,
      confirmed_breaker_avg_rr: 0,
      blind_breaker_retest_count: 0,
      blind_breaker_win_rate_pct: 0,
      blind_breaker_avg_rr: 0,
      breaker_confirmation_win_rate_delta: 0,
      breaker_confirmation_rr_delta: 0,
      breaker_vetoed_count: 0,
      breaker_vetoed_no_dol_count: 0,
      breaker_vetoed_valuation_count: 0,
      breaker_expected_value_r: 0,
      full_tp2_win_count: 0,
      full_tp2_win_rate_pct: 0,
      be_scratch_win_count: 0,
      be_scratch_win_rate_pct: 0,
      stopped_out_count: 0,
      stopped_out_rate_pct: 0,
      adjusted_win_rate_pct: 0,
      expected_value_r: 0,
      mitigation_total_trades: 0,
      mitigation_winning_trades: 0,
      mitigation_losing_trades: 0,
      mitigation_pending_trades: 0,
      mitigation_win_rate_pct: 0,
      overall_profit_factor: 0,
      avg_rr_tp1: 1.0,
      avg_rr_tp2: 2.0,
      avg_realized_rr: 0,
      avg_max_favorable_excursion_r: 0,
      avg_max_adverse_excursion_r: 0,
      avg_retracement_depth_pct: 0,
      avg_bars_to_mitigation: 0,
      avg_bars_to_outcome: 0,
    };
  }

  private computeVolumeSmaArray(candles: Candle[], period: number): number[] {
    const sma: number[] = new Array(candles.length).fill(0);
    let sum = 0;
    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].v || 0;
      if (i >= period) {
        sum -= candles[i - period].v || 0;
        sma[i] = sum / period;
      } else {
        sma[i] = sum / (i + 1);
      }
    }
    return sma;
  }
}
