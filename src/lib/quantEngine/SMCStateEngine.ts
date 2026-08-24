import { Candle } from '../fvgEngine';
import { Pivot, MarketStructureConfig, ZigZagSegment, StructuralDealingRange } from './types';

export interface StructuralEvent {
  type: 'BOS' | 'MSS' | 'CHoCH' | 'SWING_HIGH_CONFIRMED' | 'SWING_LOW_CONFIRMED' | 'SWEEP';
  direction: 'BULLISH' | 'BEARISH';
  level: number;
  index: number;
  timestamp: number;
  sharp_departure_confirmed?: boolean;
  sharp_departure_failed?: boolean;
  invalidated?: boolean;
}

export class SMCStateEngine {
  public current_trend_state: 'BULLISH_SWING' | 'BEARISH_SWING' = 'BULLISH_SWING';
  public protected_high: number | null = null;
  public protected_low: number | null = null;
  public active_swing_high: number | null = null;
  public active_swing_low: number | null = null;
  public active_idm_level: number | null = null;

  // ─── Ephemeral Expansion Float State (Range Freeze Resolution) ────────────
  /** Live floating ceiling during BULLISH expansion (post-BOS, pre-fractal). */
  public expansion_high_float: number | null = null;
  /** Live floating floor during BEARISH expansion (post-BOS, pre-fractal). */
  public expansion_low_float: number | null = null;
  /** TRUE between BOS confirmation and the next confirmed MAJOR fractal pivot. */
  public is_in_expansion: boolean = false;
  /** The structural level that was broken by the BOS (for market_velocity calculation). */
  public expansion_origin_price: number | null = null;

  public registered_events: StructuralEvent[] = [];
  public pending_breaks: { event_idx: number; p_ref: number; type: string; direction: string }[] = [];
  
  private mss_body_ratio: number;
  private displacement_vef: number;
  private sharp_departure_mult: number;
  private target_level: number;

  constructor(config?: MarketStructureConfig, targetLevel: number = 2) {
    this.mss_body_ratio = config?.mssBodyRatio ?? 0.70;
    this.displacement_vef = config?.displacementVef ?? 1.50;
    this.sharp_departure_mult = config?.sharpDepartureMult ?? 1.50;
    this.target_level = targetLevel;
  }

  public captureSnapshot(): import('./types').StructuralStateSnapshot {
    return {
      current_trend_state: this.current_trend_state,
      protected_high: this.protected_high,
      protected_low: this.protected_low,
      active_swing_high: this.active_swing_high,
      active_swing_low: this.active_swing_low,
      expansion_high_float: this.expansion_high_float,
      expansion_low_float: this.expansion_low_float,
      is_in_expansion: this.is_in_expansion,
      expansion_origin_price: this.expansion_origin_price,
    };
  }

  public restoreFromSnapshot(snapshot: import('./types').StructuralStateSnapshot): void {
    this.current_trend_state = snapshot.current_trend_state;
    this.protected_high = snapshot.protected_high;
    this.protected_low = snapshot.protected_low;
    this.active_swing_high = snapshot.active_swing_high;
    this.active_swing_low = snapshot.active_swing_low;
    this.expansion_high_float = snapshot.expansion_high_float;
    this.expansion_low_float = snapshot.expansion_low_float;
    this.is_in_expansion = snapshot.is_in_expansion;
    this.expansion_origin_price = snapshot.expansion_origin_price;
  }

  /**
   * Bootstrap the trend direction from the first confirmed pivot in the dataset.
   * This prevents the false BULLISH bias on markets that open in a bearish leg.
   * Called by MarketStructureAPI before the main candle-processing loop.
   */
  public initializeFromFirstPivot(pivots: import('./types').Pivot[]): void {
    const firstConfirmed = pivots
      .filter(p => p.confirmed && p.level === this.target_level)
      .sort((a, b) => a.timestamp - b.timestamp)[0];

    if (!firstConfirmed) return;

    if (firstConfirmed.type === 'SWING_LOW') {
      // First major pivot is a low → market was rallying → start BULLISH
      this.current_trend_state = 'BULLISH_SWING';
      this.active_swing_low = firstConfirmed.price;
    } else {
      // First major pivot is a high → market was declining → start BEARISH
      this.current_trend_state = 'BEARISH_SWING';
      this.active_swing_high = firstConfirmed.price;
    }
  }

  private compute_volume_sma(candles: Candle[], idx: number, len: number): number {
    const start = Math.max(0, idx - len + 1);
    let volSum = 0;
    for (let i = start; i <= idx; i++) {
      if (candles[i]) volSum += candles[i].volume;
    }
    return volSum / (idx - start + 1);
  }

  public processPivot(pivot: Pivot, candles: Candle[]) {
    // IDM confirmation is primarily tied to Level 1 / Level 2 interaction
    // Since Directional Change confirms pivots immediately based on price retracement,
    // we use Level 2 pivots directly as major swings, but we can annotate when they sweep Level 1.
    
    if (!pivot.confirmed) return;

    if (pivot.level === this.target_level) {
      if (pivot.type === 'SWING_HIGH') {
        this.active_swing_high = pivot.price;
        this.protected_low = this.active_swing_low; // Lock the bottom

        // ─── EXPANSION FLOAT CLEAR: Bullish expansion leg crystallizes into confirmed fractal ───
        // The live floating ceiling is no longer needed — a real structural HIGH now anchors the range.
        if (this.is_in_expansion && this.expansion_high_float !== null) {
          this.expansion_high_float = null;
          this.is_in_expansion = false;
          this.expansion_origin_price = null;
        }
      } else {
        // SWING_LOW confirmed

        // ─── PULLBACK UPGRADE: During active BULLISH expansion, immediately promote retrace low ───
        // This is the sponsoring structural floor for the expansion leg.
        // Do NOT wait for another swing high — lock the floor immediately.
        if (this.is_in_expansion && this.expansion_high_float !== null) {
          this.active_swing_low = pivot.price;
          this.protected_low = pivot.price; // Immediate promotion — no downstream wave confirmation needed
        } else {
          this.active_swing_low = pivot.price;
          this.protected_high = this.active_swing_high; // Lock the top (standard path)
        }

        // ─── EXPANSION FLOAT CLEAR: Bearish expansion leg crystallizes into confirmed fractal ───
        if (this.is_in_expansion && this.expansion_low_float !== null) {
          this.expansion_low_float = null;
          this.is_in_expansion = false;
          this.expansion_origin_price = null;
        }
      }
    }
  }

  public processCandle(candle: Candle, candles: Candle[], idx: number, atr: number) {
    if (this.current_trend_state === 'BULLISH_SWING') {
      // ─── Track Running Extreme During Active BULLISH Expansion ────────────
      // This must execute on EVERY candle during expansion, BEFORE the BOS check,
      // so even the bar that confirms a new fractal high updates the float first.
      if (this.is_in_expansion && this.expansion_high_float !== null) {
        if (candle.high > this.expansion_high_float) {
          this.expansion_high_float = candle.high;
        }
      }

      // BOS Evaluation
      if (this.active_swing_high !== null) {
        if (candle.isClosed !== false && candle.close > this.active_swing_high) {
          // ─── EXPANSION FLOAT ACTIVATION ───────────────────────────────────
          // Seed the float with the BOS bar's own high — this is the first expansion extreme.
          // expansion_origin_price records the structural level that was broken (for velocity calc).
          this.expansion_origin_price = this.active_swing_high;
          this.expansion_high_float = candle.high;
          this.is_in_expansion = true;

          this.registered_events.push({
            type: 'BOS', direction: 'BULLISH', level: this.active_swing_high, index: idx, timestamp: candle.t
          });
          this.pending_breaks.push({ event_idx: idx, p_ref: this.active_swing_high, type: 'BOS', direction: 'BULLISH' });
          this.active_swing_high = null; // Wait for next Level 2 HIGH
        } else if (candle.high > this.active_swing_high) {
          this.registered_events.push({
            type: 'SWEEP', direction: 'BULLISH', level: this.active_swing_high, index: idx, timestamp: candle.t
          });
          // Do not reset, it's just a sweep. Next candle could close above.
        }
      }
      
      // MSS / CHoCH Evaluation
      if (this.protected_low !== null) {
        if (candle.isClosed !== false && candle.close < this.protected_low) {
          const body_ratio = Math.abs(candle.close - candle.open) / (candle.high - candle.low || 1);
          const volume_sma = this.compute_volume_sma(candles, idx, 20);
          const volume_expansion = volume_sma > 0 ? (candle.volume / volume_sma) : 1.0;
          const is_displaced = body_ratio >= this.mss_body_ratio && volume_expansion >= this.displacement_vef;
          const event_type = is_displaced ? 'MSS' : 'CHoCH';
          
          this.registered_events.push({
            type: event_type, direction: 'BEARISH', level: this.protected_low, index: idx, timestamp: candle.t
          });
          this.pending_breaks.push({ event_idx: idx, p_ref: this.protected_low, type: event_type, direction: 'BEARISH' });
          
          this.current_trend_state = 'BEARISH_SWING';
          this.protected_high = this.active_swing_high;
          this.active_swing_low = candle.low; // Candidate bottom

          // ─── BEARISH EXPANSION FLOAT ACTIVATION (MSS from BULLISH) ─────────
          // If this is a displaced MSS, activate the bearish expansion float.
          if (is_displaced) {
            this.expansion_origin_price = this.protected_low;
            this.expansion_low_float = candle.low;
            this.is_in_expansion = true;
          }
          // Clear any stale bullish float
          this.expansion_high_float = null;

        } else if (candle.low < this.protected_low) {
          this.registered_events.push({
            type: 'SWEEP', direction: 'BEARISH', level: this.protected_low, index: idx, timestamp: candle.t
          });
        }
      }
    } else {
      // ─── Track Running Extreme During Active BEARISH Expansion ────────────
      if (this.is_in_expansion && this.expansion_low_float !== null) {
        if (candle.low < this.expansion_low_float) {
          this.expansion_low_float = candle.low;
        }
      }

      // BOS Evaluation
      if (this.active_swing_low !== null) {
        if (candle.isClosed !== false && candle.close < this.active_swing_low) {
          // ─── BEARISH EXPANSION FLOAT ACTIVATION (BOS from BEARISH) ─────────
          this.expansion_origin_price = this.active_swing_low;
          this.expansion_low_float = candle.low;
          this.is_in_expansion = true;

          this.registered_events.push({
            type: 'BOS', direction: 'BEARISH', level: this.active_swing_low, index: idx, timestamp: candle.t
          });
          this.pending_breaks.push({ event_idx: idx, p_ref: this.active_swing_low, type: 'BOS', direction: 'BEARISH' });
          this.active_swing_low = null; // Wait for next Level 2 LOW
        } else if (candle.low < this.active_swing_low) {
          this.registered_events.push({
            type: 'SWEEP', direction: 'BEARISH', level: this.active_swing_low, index: idx, timestamp: candle.t
          });
        }
      }
      
      // MSS / CHoCH Evaluation
      if (this.protected_high !== null) {
        if (candle.isClosed !== false && candle.close > this.protected_high) {
          const body_ratio = Math.abs(candle.close - candle.open) / (candle.high - candle.low || 1);
          const volume_sma = this.compute_volume_sma(candles, idx, 20);
          const volume_expansion = volume_sma > 0 ? (candle.volume / volume_sma) : 1.0;
          const is_displaced = body_ratio >= this.mss_body_ratio && volume_expansion >= this.displacement_vef;
          const event_type = is_displaced ? 'MSS' : 'CHoCH';
          
          this.registered_events.push({
            type: event_type, direction: 'BULLISH', level: this.protected_high, index: idx, timestamp: candle.t
          });
          this.pending_breaks.push({ event_idx: idx, p_ref: this.protected_high, type: event_type, direction: 'BULLISH' });
          
          this.current_trend_state = 'BULLISH_SWING';
          this.protected_low = this.active_swing_low;
          this.active_swing_high = candle.high; // Candidate top

          // ─── BULLISH EXPANSION FLOAT ACTIVATION (MSS from BEARISH) ─────────
          if (is_displaced) {
            this.expansion_origin_price = this.protected_high;
            this.expansion_high_float = candle.high;
            this.is_in_expansion = true;
          }
          // Clear any stale bearish float
          this.expansion_low_float = null;

        } else if (candle.high > this.protected_high) {
          this.registered_events.push({
            type: 'SWEEP', direction: 'BULLISH', level: this.protected_high, index: idx, timestamp: candle.t
          });
        }
      }
    }

    this.check_pending_departures(candle, idx, atr);
  }

  private check_pending_departures(candle: Candle, idx: number, atr: number): void {
    for (let i = this.pending_breaks.length - 1; i >= 0; i--) {
      const pb = this.pending_breaks[i];
      const k = idx - pb.event_idx;
      if (k > 5) {
        const ev = this.registered_events.find(e => e.index === pb.event_idx && (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH'));
        if (ev) {
          ev.sharp_departure_failed = true;
          ev.invalidated = true;
        }
        this.pending_breaks.splice(i, 1);
      } else {
        const distance = Math.abs(candle.close - pb.p_ref);
        if (distance >= this.sharp_departure_mult * atr) {
          const ev = this.registered_events.find(e => e.index === pb.event_idx && (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH'));
          if (ev) ev.sharp_departure_confirmed = true;
          this.pending_breaks.splice(i, 1);
        }
      }
    }
  }
}
