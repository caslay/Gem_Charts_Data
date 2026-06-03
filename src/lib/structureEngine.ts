/**
 * structureEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized Algorithmic Market Structure Engine (V11.0.4) — SINGLE SOURCE OF TRUTH.
 *
 * Implements:
 *   1. Volatility-Adjusted Adaptive Pivot Window (Nt) - Scale-Invariant per interval.
 *   2. Inside Bar Mitigation Filter (recursive mother bar indexing).
 *   3. Inducement (IDM) Confirmation Gate (sweep-validated swing confirmation).
 *   4. Dynamic Pullback Threshold: Retracement >= 0.5 * ATR(14) dynamically.
 *   5. Stateful Cache Cleans: timeframe hot-swaps completely purge old anchors.
 *   6. Awaiting IDM Sweep Veto: displays "AWAITING_IDM_SWEEP" safely if unconfirmed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { detectActiveFVGs } from './fvgEngine';
import type { Candle } from './fvgEngine';
import type { InstitutionalSponsorship } from './displacementEngine';

// ─── Exported Interfaces ──────────────────────────────────────────────────────

export interface StructuralSwing {
  /** Candle open time in milliseconds (UTC). */
  t: number;
  /** Price level of the swing (high for HIGHs, low for LOWs). */
  price: number | string;
  /** Whether this swing marks a local HIGH or LOW. */
  type: 'HIGH' | 'LOW';
  /** Grade: MAJOR = 5-bar fractal, INNER = 3-bar fractal. Keep for API parity. */
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

export interface Pivot {
  type: 'SWING_HIGH' | 'SWING_LOW';
  index: number;
  price: number;
  confirmed: boolean;
  timestamp: number;
}

// ─── MarketStructureEngine Class ──────────────────────────────────────────────

export class MarketStructureEngine {
  private n_base: number = 5;
  private adaptive_n_min: number = 3;
  private adaptive_n_max: number = 15;
  private atr_period: number = 14;
  private mss_body_ratio: number = 0.70;
  private displacement_vef: number = 1.50;
  private sharp_departure_mult: number = 1.50;

  public current_trend_state: 'BULLISH_SWING' | 'BEARISH_SWING' = 'BULLISH_SWING';
  public active_swing_high: number | null = null;
  public active_swing_low: number | null = null;
  public candidate_high: number = -Infinity;
  public candidate_low: number = Infinity;
  public protected_high: number | null = null;
  public protected_low: number | null = null;
  public active_idm_level: number | null = null;

  public candles: (Candle & { inside_bar?: boolean })[] = [];
  private last_mother_bar_index: number = 0;
  public confirmed_pivots: Pivot[] = [];
  public registered_events: any[] = [];
  private pending_breaks: { event_idx: number; p_ref: number; type: string; direction: string }[] = [];

  constructor(config?: any) {
    this.n_base = config?.adaptiveNMin ?? 5;
    this.atr_period = config?.atrPeriod ?? 14;
    this.adaptive_n_min = config?.adaptiveNMin ?? 3;
    this.adaptive_n_max = config?.adaptiveNMax ?? 15;
    this.mss_body_ratio = config?.mssBodyRatio ?? 0.70;
    this.displacement_vef = config?.displacementVef ?? 1.50;
    this.sharp_departure_mult = config?.sharpDepartureMult ?? 1.50;
  }

  private detect_timeframe_minutes(): number {
    if (this.candles.length < 2) return 5;
    const diffMs = this.candles[1].t - this.candles[0].t;
    return Math.round(diffMs / 60000);
  }

  // 1. Dynamic Volatility Window Calculation
  calculate_adaptive_n(current_idx: number): number {
    const diffMins = this.detect_timeframe_minutes();
    
    // Scale-Invariant N_base and limits based on candle frequency
    let local_n_base = this.n_base;
    let local_n_min = this.adaptive_n_min;
    let local_n_max = this.adaptive_n_max;

    // ONLY apply timeframe scaling if the user did NOT pass custom inner-engine overrides
    const hasCustomOverrides = this.adaptive_n_min !== 3 || this.adaptive_n_max !== 15;

    if (!hasCustomOverrides) {
      if (diffMins <= 1) {
        // 1m timeframe: compress lookback base and limits to prevent engine blindness
        local_n_base = 3;
        local_n_min = 2;
        local_n_max = 8;
      } else if (diffMins <= 5) {
        // 5m timeframe
        local_n_base = 5;
        local_n_min = 3;
        local_n_max = 12;
      } else {
        // 15m+ timeframes
        local_n_base = 6;
        local_n_min = 3;
        local_n_max = 15;
      }
    }

    const atr = this.compute_atr(current_idx, this.atr_period);
    const rolling_median_atr = this.compute_median_atr(current_idx, 100);
    
    if (isNaN(atr) || isNaN(rolling_median_atr) || rolling_median_atr === 0)
      return local_n_base;

    const ratio = atr / rolling_median_atr;
    const adaptive_n = Math.floor(local_n_base * (2.0 - ratio));
    
    if (isNaN(adaptive_n))
      return local_n_base;

    // Clamp to dynamic operational limits
    return Math.max(local_n_min, Math.min(local_n_max, adaptive_n));
  }

  // 2. Inside Bar Filtering Gate
  is_inside_bar(current_idx: number, mother_idx: number): boolean {
    const current = this.candles[current_idx];
    const mother = this.candles[mother_idx];
    if (!current || !mother)
      return false;
    return current.high <= mother.high && current.low >= mother.low;
  }

  // Single-pass processing pipeline
  process_candle(candle: Candle): void {
    this.candles.push(candle);
    const t = this.candles.length - 1;
    if (t < 2) {
      this.last_mother_bar_index = t;
      return;
    }

    // A. Evaluate Inside Bar Mitigation Filter
    if (this.is_inside_bar(t, this.last_mother_bar_index)) {
      this.candles[t].inside_bar = true;
      return;
    } else {
      this.last_mother_bar_index = t;
    }

    // B. Compute Volatility-Adjusted Window and Detect Pivots
    const N_t = this.calculate_adaptive_n(t);
    this.detect_pivots(t, N_t);

    // C. Update Inducement Sweep and Swing Confirmations
    this.update_inducement_gates(t);

    // D. Evaluate FSM State Transitions
    this.evaluate_state_transitions(t);

    // E. Evaluate Sharp Departures on Breakouts
    this.check_pending_departures(t);
  }

  detect_pivots(t: number, N_t: number): void {
    if (isNaN(N_t))
      return;
    const check_idx = t - N_t;
    if (check_idx < N_t || check_idx < 0 || check_idx >= this.candles.length)
      return;

    const target_candle = this.candles[check_idx];
    if (!target_candle || target_candle.inside_bar)
      return;

    const target_high = target_candle.high;
    const target_low = target_candle.low;
    let is_swing_high = true;
    let is_swing_low = true;

    for (let j = 1; j <= N_t; j++) {
      const left = this.candles[check_idx - j];
      const right = this.candles[check_idx + j];
      if (!left || !right) {
        is_swing_high = false;
        is_swing_low = false;
        continue;
      }
      if (left.high > target_high || right.high > target_high) {
        is_swing_high = false;
      }
      if (left.low < target_low || right.low < target_low) {
        is_swing_low = false;
      }
    }

    if (is_swing_high) {
      const isConfirmed = target_high === this.active_swing_high;
      this.confirmed_pivots.push({
        type: 'SWING_HIGH',
        index: check_idx,
        price: target_high,
        confirmed: isConfirmed,
        timestamp: target_candle.t
      });
      if (target_high > this.candidate_high) {
        this.candidate_high = target_high;
      }
      if (isConfirmed) {
        this.confirm_corresponding_low(check_idx);
      }
    }

    if (is_swing_low) {
      const isConfirmed = target_low === this.active_swing_low;
      this.confirmed_pivots.push({
        type: 'SWING_LOW',
        index: check_idx,
        price: target_low,
        confirmed: isConfirmed,
        timestamp: target_candle.t
      });
      if (target_low < this.candidate_low) {
        this.candidate_low = target_low;
      }
      if (isConfirmed) {
        this.confirm_corresponding_high(check_idx);
      }
    }
  }

  confirm_corresponding_low(highIdx: number): void {
    const lastHighIndex = this.confirmed_pivots
      .filter(p => p.type === 'SWING_HIGH' && p.confirmed && p.index < highIdx)
      .reduce((max, p) => p.index > max ? p.index : max, 0);
      
    const lows = this.confirmed_pivots.filter(p => p.type === 'SWING_LOW' && p.index > lastHighIndex && p.index < highIdx);
    if (lows.length > 0) {
      const lowestLow = lows.reduce((min, p) => p.price < min.price ? p : min, lows[0]);
      lowestLow.confirmed = true;
      this.active_swing_low = lowestLow.price;
      this.protected_low = lowestLow.price;
    }
  }

  confirm_corresponding_high(lowIdx: number): void {
    const lastLowIndex = this.confirmed_pivots
      .filter(p => p.type === 'SWING_LOW' && p.confirmed && p.index < lowIdx)
      .reduce((max, p) => p.index > max ? p.index : max, 0);
      
    const highs = this.confirmed_pivots.filter(p => p.type === 'SWING_HIGH' && p.index > lastLowIndex && p.index < lowIdx);
    if (highs.length > 0) {
      const highestHigh = highs.reduce((max, p) => p.price > max.price ? p : max, highs[0]);
      highestHigh.confirmed = true;
      this.active_swing_high = highestHigh.price;
      this.protected_high = highestHigh.price;
    }
  }

  update_inducement_gates(t: number): void {
    const current = this.candles[t];
    if (!current) return;
    
    // Calculate Volume and Body elements for V-Reversal overrides
    const body_ratio = Math.abs(current.close - current.open) / (current.high - current.low || 1);
    const volume_sma = this.compute_volume_sma(t, 20);
    const volume_expansion = volume_sma > 0 ? (current.volume / volume_sma) : 1.0;

    if (this.current_trend_state === 'BULLISH_SWING') {
      // V-Reversal override: Aggressive downward displacement collapses candidate without pullback
      if (this.active_swing_high === null && current.close < current.open && body_ratio >= 0.85 && volume_expansion >= 2.0) {
        this.active_swing_high = this.candidate_high;
        this.active_idm_level = null;
        const pivot = this.confirmed_pivots.find(p => p.type === 'SWING_HIGH' && p.price === this.candidate_high);
        if (pivot) {
          pivot.confirmed = true;
          this.confirm_corresponding_low(pivot.index);
        }
        this.registered_events.push({
          type: 'SWING_HIGH_CONFIRMED',
          price: this.active_swing_high,
          index: t,
          timestamp: current.t,
          is_vreversal: true
        });
      }
      
      // Standard Inducement Sweep validation
      if (this.active_idm_level !== null && current.low < this.active_idm_level) {
        this.active_swing_high = this.candidate_high;
        this.active_idm_level = null;
        const pivot = this.confirmed_pivots.find(p => p.type === 'SWING_HIGH' && p.price === this.candidate_high);
        if (pivot) {
          pivot.confirmed = true;
          this.confirm_corresponding_low(pivot.index);
        }
        this.registered_events.push({
          type: 'SWING_HIGH_CONFIRMED',
          price: this.active_swing_high,
          index: t,
          timestamp: current.t
        });
      }
      
      // Inducement Shift Mechanism
      if (current.high > this.candidate_high) {
        this.candidate_high = current.high;
        const new_idm = this.locate_last_pullback_low(t);
        if (new_idm !== null) {
          this.active_idm_level = new_idm;
        }
      }
    } else if (this.current_trend_state === 'BEARISH_SWING') {
      // V-Reversal override: Aggressive upward displacement spikes candidate without pullback
      if (this.active_swing_low === null && current.close > current.open && body_ratio >= 0.85 && volume_expansion >= 2.0) {
        this.active_swing_low = this.candidate_low;
        this.active_idm_level = null;
        const pivot = this.confirmed_pivots.find(p => p.type === 'SWING_LOW' && p.price === this.candidate_low);
        if (pivot) {
          pivot.confirmed = true;
          this.confirm_corresponding_high(pivot.index);
        }
        this.registered_events.push({
          type: 'SWING_LOW_CONFIRMED',
          price: this.active_swing_low,
          index: t,
          timestamp: current.t,
          is_vreversal: true
        });
      }
      
      // Standard Inducement Sweep validation
      if (this.active_idm_level !== null && current.high > this.active_idm_level) {
        this.active_swing_low = this.candidate_low;
        this.active_idm_level = null;
        const pivot = this.confirmed_pivots.find(p => p.type === 'SWING_LOW' && p.price === this.candidate_low);
        if (pivot) {
          pivot.confirmed = true;
          this.confirm_corresponding_high(pivot.index);
        }
        this.registered_events.push({
          type: 'SWING_LOW_CONFIRMED',
          price: this.active_swing_low,
          index: t,
          timestamp: current.t
        });
      }
      
      // Inducement Shift Mechanism
      if (current.low < this.candidate_low) {
        this.candidate_low = current.low;
        const new_idm = this.locate_last_pullback_high(t);
        if (new_idm !== null) {
          this.active_idm_level = new_idm;
        }
      }
    }
  }

  evaluate_state_transitions(t: number): void {
    const current = this.candles[t];
    if (!current) return;
    
    if (this.current_trend_state === 'BULLISH_SWING') {
      // 1. Evaluate Break of Structure (BOS)
      if (this.active_swing_high !== null && current.close > this.active_swing_high) {
        this.registered_events.push({
          type: 'BOS',
          direction: 'BULLISH',
          level: this.active_swing_high,
          index: t,
          timestamp: current.t
        });
        this.pending_breaks.push({ event_idx: t, p_ref: this.active_swing_high, type: 'BOS', direction: 'BULLISH' });
        this.protected_low = this.active_swing_low;
        this.active_swing_high = null;
        this.candidate_high = current.high;
      }
      
      // 2. Evaluate Change of Character / Market Structure Shift
      if (this.protected_low !== null && current.close < this.protected_low) {
        const body_ratio = Math.abs(current.close - current.open) / (current.high - current.low || 1);
        const volume_sma = this.compute_volume_sma(t, 20);
        const volume_expansion = volume_sma > 0 ? (current.volume / volume_sma) : 1.0;
        const is_displaced = body_ratio >= this.mss_body_ratio && volume_expansion >= this.displacement_vef;
        const event_type = is_displaced ? 'MSS' : 'CHoCH';
        
        this.registered_events.push({
          type: event_type,
          direction: 'BEARISH',
          level: this.protected_low,
          index: t,
          timestamp: current.t
        });
        this.pending_breaks.push({ event_idx: t, p_ref: this.protected_low, type: event_type, direction: 'BEARISH' });
        
        // State Mutation
        this.current_trend_state = 'BEARISH_SWING';
        this.protected_high = this.active_swing_high;
        this.active_swing_low = current.low;
        this.candidate_low = current.low;
        this.active_idm_level = null;
      }
    } else if (this.current_trend_state === 'BEARISH_SWING') {
      // 1. Evaluate Break of Structure (BOS)
      if (this.active_swing_low !== null && current.close < this.active_swing_low) {
        this.registered_events.push({
          type: 'BOS',
          direction: 'BEARISH',
          level: this.active_swing_low,
          index: t,
          timestamp: current.t
        });
        this.pending_breaks.push({ event_idx: t, p_ref: this.active_swing_low, type: 'BOS', direction: 'BEARISH' });
        this.protected_high = this.active_swing_high;
        this.active_swing_low = null;
        this.candidate_low = current.low;
      }
      
      // 2. Evaluate Change of Character / Market Structure Shift
      if (this.protected_high !== null && current.close > this.protected_high) {
        const body_ratio = Math.abs(current.close - current.open) / (current.high - current.low || 1);
        const volume_sma = this.compute_volume_sma(t, 20);
        const volume_expansion = volume_sma > 0 ? (current.volume / volume_sma) : 1.0;
        const is_displaced = body_ratio >= this.mss_body_ratio && volume_expansion >= this.displacement_vef;
        const event_type = is_displaced ? 'MSS' : 'CHoCH';
        
        this.registered_events.push({
          type: event_type,
          direction: 'BULLISH',
          level: this.protected_high,
          index: t,
          timestamp: current.t
        });
        this.pending_breaks.push({ event_idx: t, p_ref: this.protected_high, type: event_type, direction: 'BULLISH' });
        
        // State Mutation
        this.current_trend_state = 'BULLISH_SWING';
        this.protected_low = this.active_swing_low;
        this.active_swing_high = current.high;
        this.candidate_high = current.high;
        this.active_idm_level = null;
      }
    }
  }

  check_pending_departures(t: number): void {
    const atr = this.compute_atr(t, this.atr_period);
    for (let i = this.pending_breaks.length - 1; i >= 0; i--) {
      const pb = this.pending_breaks[i];
      const k = t - pb.event_idx;
      if (k > 5) {
        // Exceeded MaxConsolidation, departure failed
        const ev = this.registered_events.find(e => e.index === pb.event_idx && (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH'));
        if (ev) {
          ev.sharp_departure_failed = true;
          ev.invalidated = true;
        }
        this.pending_breaks.splice(i, 1);
      } else {
        const current_candle = this.candles[t];
        if (current_candle) {
          const distance = Math.abs(current_candle.close - pb.p_ref);
          if (distance >= this.sharp_departure_mult * atr) {
            const ev = this.registered_events.find(e => e.index === pb.event_idx && (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH'));
            if (ev) {
              ev.sharp_departure_confirmed = true;
            }
            this.pending_breaks.splice(i, 1);
          }
        }
      }
    }
  }

  // Mathematics Helpers
  compute_tr(idx: number): number {
    const current = this.candles[idx];
    if (!current)
      return 0;
    if (idx === 0)
      return current.high - current.low;
    const prev = this.candles[idx - 1];
    if (!prev)
      return current.high - current.low;
    return Math.max(current.high - current.low, Math.abs(current.high - prev.close), Math.abs(current.low - prev.close));
  }

  compute_atr(idx: number, len: number): number {
    if (idx < len - 1) {
      let trSum = 0;
      for (let i = 0; i <= idx; i++) {
        trSum += this.compute_tr(i);
      }
      return trSum / (idx + 1);
    }
    let trSum = 0;
    for (let i = idx - len + 1; i <= idx; i++) {
      trSum += this.compute_tr(i);
    }
    return trSum / len;
  }

  compute_median_atr(idx: number, horizon: number): number {
    const atrs: number[] = [];
    const start = Math.max(0, idx - horizon + 1);
    for (let i = start; i <= idx; i++) {
      atrs.push(this.compute_atr(i, this.atr_period));
    }
    if (atrs.length === 0)
      return 0;
    atrs.sort((a, b) => a - b);
    const mid = Math.floor(atrs.length / 2);
    if (atrs.length % 2 === 0) {
      return (atrs[mid - 1] + atrs[mid]) / 2;
    }
    return atrs[mid];
  }

  compute_volume_sma(idx: number, len: number): number {
    const start = Math.max(0, idx - len + 1);
    let volSum = 0;
    for (let i = start; i <= idx; i++) {
      const candle = this.candles[i];
      if (candle) {
        volSum += candle.volume;
      }
    }
    return volSum / (idx - start + 1);
  }

  // Pullback search algorithms
  locate_last_pullback_low(peak_idx: number): number | null {
    for (let k = peak_idx - 1; k >= 0; k--) {
      const candle_k = this.candles[k];
      if (!candle_k || candle_k.inside_bar)
        continue;
      let is_pullback = false;
      let lowest_low = Infinity;
      let highest_in_between = -Infinity;
      for (let s = k + 1; s <= peak_idx; s++) {
        const candle_s = this.candles[s];
        if (!candle_s || candle_s.inside_bar)
          continue;
        const prev_s = this.candles[s - 1];
        if (!prev_s)
          continue;
        if (prev_s.high > highest_in_between) {
          highest_in_between = prev_s.high;
        }
        if (highest_in_between > candle_k.high) {
          break;
        }
        if (candle_s.low < candle_k.low) {
          is_pullback = true;
          for (let j = k; j <= peak_idx; j++) {
            const candle_j = this.candles[j];
            if (candle_j && candle_j.low < lowest_low) {
              lowest_low = candle_j.low;
            }
          }
          break;
        }
      }
      if (is_pullback) {
        // Enforce dynamic pullback requirement: Pullback >= 0.5 * ATR
        const atr = this.compute_atr(peak_idx, 14);
        const pullback_depth = this.candles[peak_idx].high - lowest_low;
        if (pullback_depth >= 0.5 * atr) {
          return lowest_low;
        }
      }
    }
    return null;
  }

  locate_last_pullback_high(t: number): number | null {
    for (let k = t - 1; k >= 0; k--) {
      const candle_k = this.candles[k];
      if (!candle_k || candle_k.inside_bar)
        continue;
      let is_pullback = false;
      let highest_high = -Infinity;
      let lowest_in_between = Infinity;
      for (let s = k + 1; s <= t; s++) {
        const candle_s = this.candles[s];
        if (!candle_s || candle_s.inside_bar)
          continue;
        const prev_s = this.candles[s - 1];
        if (!prev_s)
          continue;
        if (prev_s.low < lowest_in_between) {
          lowest_in_between = prev_s.low;
        }
        if (lowest_in_between < candle_k.low) {
          break;
        }
        if (candle_s.high > candle_k.high) {
          is_pullback = true;
          for (let j = k; j <= t; j++) {
            const candle_j = this.candles[j];
            if (candle_j && candle_j.high > highest_high) {
              highest_high = candle_j.high;
            }
          }
          break;
        }
      }
      if (is_pullback) {
        // Enforce dynamic pullback requirement: Pullback >= 0.5 * ATR
        const atr = this.compute_atr(t, 14);
        const pullback_depth = highest_high - this.candles[t].low;
        if (pullback_depth >= 0.5 * atr) {
          return highest_high;
        }
      }
    }
    return null;
  }
}

// ─── Single/Stateful Execution Wrapper ───────────────────────────────────────

export function analyzeMarketStructure(
  candles: Candle[],
  currentPrice: number,
  displacementStatus?: InstitutionalSponsorship | null,
  contextAnchorTimestamp?: number | null,
  globalAnchors?: any | null,
  config?: any
): MarketStructureAnalysis {
  if (candles.length === 0) {
    return {
      last_processed_index: 0,
      engine_state: {
        current_trend_state: 'BULLISH_SWING',
        protected_high: null,
        protected_low: null,
        active_swing_range: { low: null, high: null }
      },
      swing_points: [],
      structural_events: [],
      liquidity_zones: [],
      expansion_mode: 'NORMAL',
      market_velocity: 0,
      runaway_origin_price: null,
      swings: [],
      zigzag: [],
      dealingRange: {
        high: "AWAITING_IDM_SWEEP",
        low: "AWAITING_IDM_SWEEP",
        equilibrium: "AWAITING_IDM_SWEEP",
        current_status: 'AWAITING_IDM_SWEEP',
        anchor_high_swing: null,
        anchor_low_swing: null
      },
      currentTrend: 'UNSET',
      latestMSS: null,
      market_structure_shift: false,
      market_structure_shift_direction: null
    };
  }

  // Normalization Guard: Support both h/l/o/c/v and high/low/open/close/volume seamlessly
  const normalizedCandles = candles.map(c => ({
    ...c,
    open: c.open !== undefined ? c.open : c.o,
    high: c.high !== undefined ? c.high : c.h,
    low: c.low !== undefined ? c.low : c.l,
    close: c.close !== undefined ? c.close : c.c,
    volume: c.volume !== undefined ? c.volume : c.v
  }));

  // ─── PASS 1: Main (Macro) Engine ─────────────────────────────────────────────
  const engine = new MarketStructureEngine(config);
  for (const c of normalizedCandles) {
    engine.process_candle(c);
  }

  const last_idx = normalizedCandles.length - 1;
  const swing_points = engine.confirmed_pivots;
  const structural_events = engine.registered_events;

  // ─── FALLBACK ANCHOR CONFIRMATION ────────────────────────────────────────────
  // If the IDM gate never fired (no confirmed pivots), find the absolute high/low
  // in the window and mark them confirmed so the chart always has at least one
  // dealing range. This is the "degraded mode" from quant_logic.md §5.4.
  const hasAnyConfirmed = swing_points.some(p => p.confirmed);
  if (!hasAnyConfirmed && swing_points.length > 0) {
    const highs = swing_points.filter(p => p.type === 'SWING_HIGH');
    const lows  = swing_points.filter(p => p.type === 'SWING_LOW');
    if (highs.length > 0) {
      const peak = highs.reduce((a, b) => b.price > a.price ? b : a, highs[0]);
      peak.confirmed = true;
    }
    if (lows.length > 0) {
      const trough = lows.reduce((a, b) => b.price < a.price ? b : a, lows[0]);
      trough.confirmed = true;
    }
  }

  // ─── PASS 2: Inner-Wave Engine (tight N for intraday sub-waves) ──────────────
  // This is a completely independent engine pass with a compressed N window
  // so Layer 2 (internal) and Layer 3 (inner) are always decoupled from macro.
  const innerConfig = {
    ...(config || {}),
    adaptiveNMin: 1,
    adaptiveNMax: 3,
  };
  const innerEngine = new MarketStructureEngine(innerConfig);
  for (const c of normalizedCandles) {
    innerEngine.process_candle(c);
  }

  // Fallback for inner engine (same logic)
  const innerHasConfirmed = innerEngine.confirmed_pivots.some(p => p.confirmed);
  if (!innerHasConfirmed && innerEngine.confirmed_pivots.length > 0) {
    const iHighs = innerEngine.confirmed_pivots.filter(p => p.type === 'SWING_HIGH');
    const iLows  = innerEngine.confirmed_pivots.filter(p => p.type === 'SWING_LOW');
    if (iHighs.length > 0) {
      iHighs.reduce((a, b) => b.price > a.price ? b : a, iHighs[0]).confirmed = true;
    }
    if (iLows.length > 0) {
      iLows.reduce((a, b) => b.price < a.price ? b : a, iLows[0]).confirmed = true;
    }
  }

  // ─── MAP MACRO SWINGS ────────────────────────────────────────────────────────
  const swings: StructuralSwing[] = swing_points.map(pt => ({
    t: pt.timestamp,
    price: pt.price,
    type: pt.type === 'SWING_HIGH' ? 'HIGH' as const : 'LOW' as const,
    grade: 'MAJOR' as const,
    colorValidated: true,
    candle_index: pt.index,
    timestamp: new Date(pt.timestamp).toISOString(),
    structure_type: 'MAJOR' as const,
    confirmed: pt.confirmed
  }));

  // ─── MAP INNER SWINGS ────────────────────────────────────────────────────────
  const innerSwingsRaw: StructuralSwing[] = innerEngine.confirmed_pivots.map(pt => ({
    t: pt.timestamp,
    price: pt.price,
    type: pt.type === 'SWING_HIGH' ? 'HIGH' as const : 'LOW' as const,
    grade: 'INNER' as const,
    colorValidated: true,
    candle_index: pt.index,
    timestamp: new Date(pt.timestamp).toISOString(),
    structure_type: 'INNER' as const,
    confirmed: pt.confirmed
  }));

  // ─── ALTERNATING FILTER & ZIGZAG (MACRO) ─────────────────────────────────────
  const zigzag: ZigZagSegment[] = [];
  let trend: 'BULLISH' | 'BEARISH' | 'UNSET' = 'UNSET';
  let latestMSS: ZigZagSegment | null = null;
  const confirmedSwings = swings.filter(s => s.confirmed);
  const alternatingSwings: StructuralSwing[] = [];
  
  for (const s of confirmedSwings) {
    if (alternatingSwings.length === 0) {
      alternatingSwings.push(s);
      continue;
    }
    const last = alternatingSwings[alternatingSwings.length - 1];
    if (last.type === s.type) {
      if (s.type === 'HIGH') {
        if ((s.price as number) > (last.price as number)) {
          alternatingSwings[alternatingSwings.length - 1] = s;
        }
      } else {
        if ((s.price as number) < (last.price as number)) {
          alternatingSwings[alternatingSwings.length - 1] = s;
        }
      }
    } else {
      alternatingSwings.push(s);
    }
  }

  for (let i = 0; i < alternatingSwings.length - 1; i++) {
    const from = alternatingSwings[i];
    const to = alternatingSwings[i + 1];
    const trendBefore = trend;
    let label: 'BOS' | 'MSS' | 'INTERNAL' = 'INTERNAL';
    let trendAfter: 'BULLISH' | 'BEARISH' | 'UNSET' = trend;

    // Resolve breakout event at the segment's ending coordinate
    const ev = structural_events.find(e => e.index === to.candle_index && (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH'));
    if (ev) {
      if (ev.type === 'BOS') {
        label = 'BOS';
        trendAfter = ev.direction || 'UNSET';
      } else {
        label = 'MSS';
        trendAfter = ev.direction || 'UNSET';
      }
    }
    
    trend = trendAfter;
    
    const segment: ZigZagSegment = {
      from,
      to,
      label,
      trendBefore,
      trendAfter,
      displacementConfirmed: label === 'MSS' && !ev?.sharp_departure_failed
    };
    
    zigzag.push(segment);
    if (label === 'MSS') {
      latestMSS = segment;
    }
  }

  // ─── ALTERNATING FILTER & ZIGZAG (INNER) ─────────────────────────────────────
  const innerZigzag: ZigZagSegment[] = [];
  let innerTrendTracker: 'BULLISH' | 'BEARISH' | 'UNSET' = 'UNSET';
  const confirmedInnerSwings = innerSwingsRaw.filter(s => s.confirmed);
  const alternatingInner: StructuralSwing[] = [];
  
  for (const s of confirmedInnerSwings) {
    if (alternatingInner.length === 0) {
      alternatingInner.push(s);
      continue;
    }
    const last = alternatingInner[alternatingInner.length - 1];
    if (last.type === s.type) {
      if (s.type === 'HIGH') {
        if ((s.price as number) > (last.price as number)) alternatingInner[alternatingInner.length - 1] = s;
      } else {
        if ((s.price as number) < (last.price as number)) alternatingInner[alternatingInner.length - 1] = s;
      }
    } else {
      alternatingInner.push(s);
    }
  }

  for (let i = 0; i < alternatingInner.length - 1; i++) {
    const from = alternatingInner[i];
    const to = alternatingInner[i + 1];
    const trendBefore = innerTrendTracker;
    let innerLabel: 'BOS' | 'MSS' | 'INTERNAL' = 'INTERNAL';
    let innerTrendAfter: 'BULLISH' | 'BEARISH' | 'UNSET' = innerTrendTracker;

    const iEv = innerEngine.registered_events.find(e => e.index === to.candle_index && (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH'));
    if (iEv) {
      innerLabel = iEv.type === 'BOS' ? 'BOS' : 'MSS';
      innerTrendAfter = iEv.direction || 'UNSET';
    }

    innerTrendTracker = innerTrendAfter;

    const seg: ZigZagSegment = {
      from, to,
      label: innerLabel,
      trendBefore,
      trendAfter: innerTrendAfter,
      displacementConfirmed: innerLabel === 'MSS' && !iEv?.sharp_departure_failed
    };
    innerZigzag.push(seg);
  }

  // ─── DEALING RANGE (MACRO) ────────────────────────────────────────────────────
  let dealingRange: StructuralDealingRange;
  const majorHighs = alternatingSwings.filter(s => s.type === 'HIGH');
  const majorLows = alternatingSwings.filter(s => s.type === 'LOW');
  
  if (majorHighs.length > 0 && majorLows.length > 0) {
    const lastHigh = majorHighs[majorHighs.length - 1];
    const lastLow = majorLows[majorLows.length - 1];
    const highVal = parseFloat((lastHigh.price as number).toFixed(2));
    const lowVal = parseFloat((lastLow.price as number).toFixed(2));
    const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));
    
    dealingRange = {
      high: highVal,
      low: lowVal,
      equilibrium: eqVal,
      current_status: currentPrice > eqVal ? 'PREMIUM' as const : 'DISCOUNT' as const,
      anchor_high_swing: lastHigh,
      anchor_low_swing: lastLow
    };
  } else {
    dealingRange = {
      high: "AWAITING_IDM_SWEEP",
      low: "AWAITING_IDM_SWEEP",
      equilibrium: "AWAITING_IDM_SWEEP",
      current_status: 'AWAITING_IDM_SWEEP',
      anchor_high_swing: null,
      anchor_low_swing: null
    };
  }

  // ─── DEALING RANGE (INNER / INTRADAY) ────────────────────────────────────────
  let internalDealingRange: StructuralDealingRange;
  let internalTrend: 'BULLISH' | 'BEARISH' | 'UNSET' = 'UNSET';
  let internalZigzag: ZigZagSegment[] = [];

  const anchor_high = dealingRange.anchor_high_swing;
  const anchor_low  = dealingRange.anchor_low_swing;

  if (anchor_high && anchor_low) {
    const majorRangeStartTime = Math.min(anchor_high.t, anchor_low.t);
    const lowRange = anchor_low.price as number;
    const highRange = anchor_high.price as number;

    // Filter MAIN engine's confirmed swings to find Layer 2 INTERNAL swings (strictly inside the macro range)
    const internalSwings = confirmedSwings.filter(s => (s.price as number) > lowRange && (s.price as number) < highRange);

    // Apply dynamic majorRangeStartTime filter to keep them in the current cycle context (V10.43)
    const activeInternalSwings = internalSwings.filter(s => s.t >= majorRangeStartTime);

    const internalHighs = activeInternalSwings.filter(s => s.type === 'HIGH');
    const internalLows  = activeInternalSwings.filter(s => s.type === 'LOW');

    // Filter main zigzag segments inside the macro bounds to build internalZigzag (V10.40)
    internalZigzag = zigzag.filter(seg => 
      seg.from.t >= majorRangeStartTime &&
      (seg.from.price as number) > lowRange && (seg.from.price as number) < highRange &&
      (seg.to.price as number) > lowRange && (seg.to.price as number) < highRange
    );

    // ─── IMPLEMENT ACTIVE iMSS BREAKOUT ORIGIN ANCHORING (V10.43) ───
    const activeMSS = internalZigzag
      .filter(seg => seg.label === 'MSS' && seg.displacementConfirmed)
      .slice(-1)[0] ?? null;

    if (activeMSS) {
      const originPrice = activeMSS.from.price as number;
      const originTime = activeMSS.from.t;
      const candlesSince = normalizedCandles.filter(c => c.t >= originTime);
      const highsSince = candlesSince.map(c => c.high);
      const lowsSince = candlesSince.map(c => c.low);
      const maxExtreme = Math.max(...highsSince);
      const minExtreme = Math.min(...lowsSince);
      
      const isBullish = activeMSS.trendAfter === 'BULLISH';
      const lowVal = isBullish ? originPrice : minExtreme;
      const highVal = isBullish ? maxExtreme : originPrice;
      const eqVal = parseFloat(((lowVal + highVal) / 2).toFixed(2));
      
      internalDealingRange = {
        high: parseFloat(highVal.toFixed(2)),
        low: parseFloat(lowVal.toFixed(2)),
        equilibrium: eqVal,
        current_status: currentPrice > eqVal ? 'PREMIUM' as const : 'DISCOUNT' as const,
        anchor_high_swing: swings.find(s => s.price === highVal) || activeMSS.to,
        anchor_low_swing: swings.find(s => s.price === lowVal) || activeMSS.from
      };
      internalTrend = activeMSS.trendAfter;
    } else if (internalHighs.length > 0 && internalLows.length > 0) {
      // Standard local anchor fallback (within active major bounds)
      const iH = internalHighs[internalHighs.length - 1];
      const iL = internalLows[internalLows.length - 1];
      const iHighVal = parseFloat((iH.price as number).toFixed(2));
      const iLowVal  = parseFloat((iL.price as number).toFixed(2));
      const iEqVal   = parseFloat(((iHighVal + iLowVal) / 2).toFixed(2));
      
      internalDealingRange = {
        high: iHighVal,
        low: iLowVal,
        equilibrium: iEqVal,
        current_status: currentPrice > iEqVal ? 'PREMIUM' as const : 'DISCOUNT' as const,
        anchor_high_swing: iH,
        anchor_low_swing: iL
      };
      
      const lastInternal = activeInternalSwings[activeInternalSwings.length - 1];
      internalTrend = lastInternal.type === 'HIGH' ? 'BULLISH' : 'BEARISH';
    } else {
      // Fallback: 3-bar micro inner swings inside the macro range (V10.36)
      const fallbackSwings = confirmedInnerSwings.filter(s => 
        s.t >= majorRangeStartTime && 
        (s.price as number) > lowRange && 
        (s.price as number) < highRange
      );
      const fallbackHighs = fallbackSwings.filter(s => s.type === 'HIGH');
      const fallbackLows  = fallbackSwings.filter(s => s.type === 'LOW');

      if (fallbackHighs.length > 0 && fallbackLows.length > 0) {
        const iH = fallbackHighs[fallbackHighs.length - 1];
        const iL = fallbackLows[fallbackLows.length - 1];
        const iHighVal = parseFloat((iH.price as number).toFixed(2));
        const iLowVal  = parseFloat((iL.price as number).toFixed(2));
        const iEqVal   = parseFloat(((iHighVal + iLowVal) / 2).toFixed(2));
        
        internalDealingRange = {
          high: iHighVal,
          low: iLowVal,
          equilibrium: iEqVal,
          current_status: currentPrice > iEqVal ? 'PREMIUM' as const : 'DISCOUNT' as const,
          anchor_high_swing: iH,
          anchor_low_swing: iL
        };
        internalTrend = iH.t > iL.t ? 'BULLISH' : 'BEARISH';
      } else {
        internalDealingRange = {
          high: "AWAITING_IDM_SWEEP",
          low: "AWAITING_IDM_SWEEP",
          equilibrium: "AWAITING_IDM_SWEEP",
          current_status: 'AWAITING_IDM_SWEEP',
          anchor_high_swing: null,
          anchor_low_swing: null
        };
        internalTrend = 'UNSET';
      }
    }
  } else {
    internalDealingRange = {
      high: "AWAITING_IDM_SWEEP",
      low: "AWAITING_IDM_SWEEP",
      equilibrium: "AWAITING_IDM_SWEEP",
      current_status: 'AWAITING_IDM_SWEEP',
      anchor_high_swing: null,
      anchor_low_swing: null
    };
    internalTrend = 'UNSET';
  }

  const hasConfirmedMSS = latestMSS !== null && latestMSS.displacementConfirmed;

  // Add unconfirmed swings back for expansion ray visualizers (macro only)
  swings.push(...(swings.filter(s => !s.confirmed).map(s => ({ ...s, structure_type: 'INTERNAL' as 'MAJOR' | 'INTERNAL' })) as StructuralSwing[]));
  swings.sort((a, b) => a.t - b.t);

  return {
    last_processed_index: last_idx,
    engine_state: {
      current_trend_state: engine.current_trend_state,
      protected_high: engine.protected_high,
      protected_low: engine.protected_low,
      active_swing_range: {
        low: engine.active_swing_low,
        high: engine.active_swing_high
      }
    },
    swing_points,
    structural_events,
    liquidity_zones: [],
    
    expansion_mode: 'NORMAL',
    market_velocity: 0,
    runaway_origin_price: null,
    
    // ── MACRO LAYER ──
    swings,
    zigzag,
    dealingRange,
    currentTrend: engine.current_trend_state === 'BULLISH_SWING' ? 'BULLISH' : 'BEARISH',
    latestMSS,
    market_structure_shift: hasConfirmedMSS,
    market_structure_shift_direction: hasConfirmedMSS ? latestMSS!.trendAfter : null,

    // ── INNER LAYER (independently computed, never a copy of macro) ──
    subTrend: innerTrendTracker,
    innerSwings: innerSwingsRaw,
    innerZigzag,
    internalTrend,
    internalZigzag,
    latestInternalMSS: internalZigzag.filter(s => s.label === 'MSS').slice(-1)[0] ?? null,
    internal_market_structure_shift: internalZigzag.some(s => s.label === 'MSS' && s.displacementConfirmed),
    internalDealingRange,
  };
}

// Stateful Caching Layer for real-time memory synchronization

const accumulatedCandlesCache = new Map<string, Candle[]>();
const contextAnchorCache = new Map<string, number>();
const globalAnchorsCache = new Map<string, any>();

export function analyzeMarketStructureStateful(
  symbol: string,
  interval: string,
  newCandles: Candle[],
  currentPrice: number,
  displacementStatus: InstitutionalSponsorship | null | undefined,
  isInit: boolean = false,
  globalAnchors?: any | null,
  config?: any
): MarketStructureAnalysis {
  const cacheKey = `${symbol}_${interval}`;
  
  if (isInit) {
    accumulatedCandlesCache.delete(cacheKey);
    contextAnchorCache.delete(cacheKey);
    globalAnchorsCache.delete(cacheKey);
  }

  let accumulated = accumulatedCandlesCache.get(cacheKey) || [];
  if (isInit || accumulated.length === 0) {
    accumulated = [...newCandles].sort((a, b) => a.t - b.t);
  } else {
    const existingIds = new Set(accumulated.map(c => c.t));
    const uniqueNew = newCandles.filter(c => !existingIds.has(c.t));
    accumulated = [...accumulated, ...uniqueNew].sort((a, b) => a.t - b.t);
  }

  // 10,000 candles ceiling to optimize visual canvas performance
  if (accumulated.length > 10000) {
    accumulated = accumulated.slice(-10000);
  }
  accumulatedCandlesCache.set(cacheKey, accumulated);

  let anchor = contextAnchorCache.get(cacheKey) || null;
  if (anchor === null && accumulated.length > 0) {
    anchor = accumulated[0].t;
    contextAnchorCache.set(cacheKey, anchor);
  }

  return analyzeMarketStructure(accumulated, currentPrice, displacementStatus, anchor, globalAnchors, config);
}
