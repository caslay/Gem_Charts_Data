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
    
    if (pivot.level === this.target_level) {
      if (pivot.type === 'SWING_HIGH') {
        this.active_swing_high = pivot.price;
        this.protected_low = this.active_swing_low; // Lock the bottom
      } else {
        this.active_swing_low = pivot.price;
        this.protected_high = this.active_swing_high; // Lock the top
      }
    }
  }

  public processCandle(candle: Candle, candles: Candle[], idx: number, atr: number) {
    if (this.current_trend_state === 'BULLISH_SWING') {
      // BOS Evaluation
      if (this.active_swing_high !== null) {
        if (candle.close > this.active_swing_high) {
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
        if (candle.close < this.protected_low) {
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
        } else if (candle.low < this.protected_low) {
          this.registered_events.push({
            type: 'SWEEP', direction: 'BEARISH', level: this.protected_low, index: idx, timestamp: candle.t
          });
        }
      }
    } else {
      // BOS Evaluation
      if (this.active_swing_low !== null) {
        if (candle.close < this.active_swing_low) {
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
        if (candle.close > this.protected_high) {
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
