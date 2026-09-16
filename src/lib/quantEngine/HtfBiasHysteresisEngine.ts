/**
 * HtfBiasHysteresisEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional HTF Bias State Machine with Multi-Bar Hysteresis Confirmation
 * ─────────────────────────────────────────────────────────────────────────────
 * Prevents trend whiplash by enforcing strict multi-bar persistence on 1H/4H
 * macro structural shifts. A single 15m counter-trend wick or undisplaced break
 * can NEVER flip the confirmed macro directional bias.
 *
 * State Machine Flow:
 *   UNSET -> BULLISH_CONFIRMED <-> BEARISH_PENDING -> BEARISH_CONFIRMED <-> BULLISH_PENDING
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from '../fvgEngine';

export type HtfBiasState =
  | 'UNSET'
  | 'BULLISH_CONFIRMED'
  | 'BEARISH_PENDING'
  | 'BEARISH_CONFIRMED'
  | 'BULLISH_PENDING';

export interface HtfBiasEvaluationResult {
  state: HtfBiasState;
  confirmedBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  pendingTransition: 'NONE' | 'TO_BEARISH' | 'TO_BULLISH';
  protectedHigh: number | null;
  protectedLow: number | null;
  lastH1Close: number;
  sma20_h1: number;
  ema120_h1: number;
  isConfirmed: boolean;
  classification: 'MACRO_EXPANSION' | 'RETRACEMENT_IN_PREMIUM' | 'RETRACEMENT_IN_DISCOUNT' | 'CHOP';
  executionDisabled: boolean;
}

export class HtfBiasHysteresisEngine {
  private state: HtfBiasState = 'UNSET';
  private protectedHigh: number | null = null;
  private protectedLow: number | null = null;
  private pendingBarIndex: number | null = null;

  constructor(initialState?: HtfBiasState) {
    if (initialState) {
      this.state = initialState;
    }
  }

  public reset(): void {
    this.state = 'UNSET';
    this.protectedHigh = null;
    this.protectedLow = null;
    this.pendingBarIndex = null;
  }

  public getState(): HtfBiasState {
    return this.state;
  }

  /**
   * Evaluates HTF 1H candles sequentially and determines the robust macro bias with hysteresis.
   */
  public evaluate(candles1h: Candle[], candles15m?: Candle[]): HtfBiasEvaluationResult {
    if (!candles1h || candles1h.length < 5) {
      return {
        state: this.state,
        confirmedBias: this.state === 'BULLISH_CONFIRMED' ? 'BULLISH' : this.state === 'BEARISH_CONFIRMED' ? 'BEARISH' : 'NEUTRAL',
        pendingTransition: 'NONE',
        protectedHigh: this.protectedHigh,
        protectedLow: this.protectedLow,
        lastH1Close: candles1h && candles1h.length > 0 ? (candles1h[candles1h.length - 1].c || 0) : 0,
        sma20_h1: 0,
        ema120_h1: 0,
        isConfirmed: this.state === 'BULLISH_CONFIRMED' || this.state === 'BEARISH_CONFIRMED',
        classification: 'CHOP',
        executionDisabled: true,
      };
    }

    const n = candles1h.length;
    // Compute 20 SMA & 120 EMA on 1H
    let sum20 = 0;
    const start20 = Math.max(0, n - 20);
    const count20 = n - start20;
    for (let i = start20; i < n; i++) {
      sum20 += candles1h[i].c;
    }
    const sma20 = count20 > 0 ? sum20 / count20 : candles1h[n - 1].c;

    // EMA 120
    const emaPeriod = Math.min(120, n);
    const emaK = 2 / (emaPeriod + 1);
    let ema120 = candles1h[0].c;
    for (let i = 1; i < n; i++) {
      ema120 = candles1h[i].c * emaK + ema120 * (1 - emaK);
    }

    // Identify swing highs and lows on 1H (lookback 3 left/right)
    let swingHighs: { price: number; index: number }[] = [];
    let swingLows: { price: number; index: number }[] = [];

    for (let i = 3; i < n - 3; i++) {
      const c = candles1h[i];
      const isHigh =
        c.h > candles1h[i - 1].h &&
        c.h > candles1h[i - 2].h &&
        c.h > candles1h[i - 3].h &&
        c.h > candles1h[i + 1].h &&
        c.h > candles1h[i + 2].h &&
        c.h > candles1h[i + 3].h;

      const isLow =
        c.l < candles1h[i - 1].l &&
        c.l < candles1h[i - 2].l &&
        c.l < candles1h[i - 3].l &&
        c.l < candles1h[i + 1].l &&
        c.l < candles1h[i + 2].l &&
        c.l < candles1h[i + 3].l;

      if (isHigh) swingHighs.push({ price: c.h, index: i });
      if (isLow) swingLows.push({ price: c.l, index: i });
    }

    // Establish protected high & low from prior structural swings (excluding current evaluating bar)
    const priorCandles = candles1h.slice(0, Math.max(1, n - 1));
    if (swingHighs.length > 0) {
      this.protectedHigh = swingHighs[swingHighs.length - 1].price;
    } else {
      this.protectedHigh = Math.max(...priorCandles.slice(-20).map((c) => c.h));
    }

    if (swingLows.length > 0) {
      this.protectedLow = swingLows[swingLows.length - 1].price;
    } else {
      this.protectedLow = Math.min(...priorCandles.slice(-20).map((c) => c.l));
    }

    // Sequential walk from start or maintain state across closed bars
    // Initialize state if UNSET
    const lastCandle = candles1h[n - 1];
    const prevCandle = candles1h[n - 2];
    const lastClose = lastCandle.c;

    if (this.state === 'UNSET') {
      if (lastClose > sma20 && lastClose > ema120) {
        this.state = 'BULLISH_CONFIRMED';
      } else if (lastClose < sma20 && lastClose < ema120) {
        this.state = 'BEARISH_CONFIRMED';
      } else {
        this.state = lastClose >= sma20 ? 'BULLISH_CONFIRMED' : 'BEARISH_CONFIRMED';
      }
    }

    // Invariant 1: Trend Flip requires HTF Body Close (not just wick) with Body Ratio >= 0.40
    const candleRange = Math.max(0.01, lastCandle.h - lastCandle.l);
    const bodyRatio = Math.abs(lastCandle.c - lastCandle.o) / candleRange;
    const isDisplacedBody = bodyRatio >= 0.40;

    let pendingTransition: 'NONE' | 'TO_BEARISH' | 'TO_BULLISH' = 'NONE';

    if (this.state === 'BULLISH_CONFIRMED') {
      // Check if price breaks below Protected Low with confirmed body close
      const isBreakBelow = this.protectedLow !== null && lastCandle.c < this.protectedLow && isDisplacedBody;
      if (isBreakBelow) {
        this.state = 'BEARISH_PENDING';
        this.pendingBarIndex = n - 1;
        pendingTransition = 'TO_BEARISH';
      }
    } else if (this.state === 'BEARISH_PENDING') {
      // Invariant 2: Multi-bar persistence confirmation
      // Requires next 1H bar to confirm (close below protected low or remain lower)
      if (this.pendingBarIndex !== null && n - 1 > this.pendingBarIndex) {
        if (this.protectedLow !== null && lastCandle.c <= this.protectedLow) {
          this.state = 'BEARISH_CONFIRMED';
          this.pendingBarIndex = null;
        } else if (this.protectedLow !== null && lastCandle.c > this.protectedLow) {
          // Reverted — false break / spring / wick reclaim
          this.state = 'BULLISH_CONFIRMED';
          this.pendingBarIndex = null;
        }
      } else {
        pendingTransition = 'TO_BEARISH';
      }
    } else if (this.state === 'BEARISH_CONFIRMED') {
      // Check if price breaks above Protected High with confirmed body close
      const isBreakAbove = this.protectedHigh !== null && lastCandle.c > this.protectedHigh && isDisplacedBody;
      if (isBreakAbove) {
        this.state = 'BULLISH_PENDING';
        this.pendingBarIndex = n - 1;
        pendingTransition = 'TO_BULLISH';
      }
    } else if (this.state === 'BULLISH_PENDING') {
      // Requires next 1H bar to confirm
      if (this.pendingBarIndex !== null && n - 1 > this.pendingBarIndex) {
        if (this.protectedHigh !== null && lastCandle.c >= this.protectedHigh) {
          this.state = 'BULLISH_CONFIRMED';
          this.pendingBarIndex = null;
        } else if (this.protectedHigh !== null && lastCandle.c < this.protectedHigh) {
          // Reverted
          this.state = 'BEARISH_CONFIRMED';
          this.pendingBarIndex = null;
        }
      } else {
        pendingTransition = 'TO_BULLISH';
      }
    }

    const confirmedBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
      this.state === 'BULLISH_CONFIRMED'
        ? 'BULLISH'
        : this.state === 'BEARISH_CONFIRMED'
        ? 'BEARISH'
        : 'NEUTRAL';

    // Invariant 3: 15m counter-trend classification
    let classification: 'MACRO_EXPANSION' | 'RETRACEMENT_IN_PREMIUM' | 'RETRACEMENT_IN_DISCOUNT' | 'CHOP' = 'MACRO_EXPANSION';
    let executionDisabled = false;

    if (candles15m && candles15m.length > 0) {
      const latest15m = candles15m[candles15m.length - 1];
      const is15mBullishWick = latest15m.c > latest15m.o && latest15m.h > (this.protectedLow || 0);
      const is15mBearishWick = latest15m.c < latest15m.o && latest15m.l < (this.protectedHigh || Infinity);

      if (confirmedBias === 'BEARISH' && is15mBullishWick) {
        classification = 'RETRACEMENT_IN_DISCOUNT';
        // Suppress bullish execution during confirmed macro bearish bias
        executionDisabled = true;
      } else if (confirmedBias === 'BULLISH' && is15mBearishWick) {
        classification = 'RETRACEMENT_IN_PREMIUM';
        // Suppress bearish execution during confirmed macro bullish bias
        executionDisabled = true;
      }
    }

    if (this.state === 'BEARISH_PENDING' || this.state === 'BULLISH_PENDING') {
      executionDisabled = true;
      classification = 'CHOP';
    }

    return {
      state: this.state,
      confirmedBias,
      pendingTransition,
      protectedHigh: this.protectedHigh,
      protectedLow: this.protectedLow,
      lastH1Close: lastClose,
      sma20_h1: parseFloat(sma20.toFixed(2)),
      ema120_h1: parseFloat(ema120.toFixed(2)),
      isConfirmed: this.state === 'BULLISH_CONFIRMED' || this.state === 'BEARISH_CONFIRMED',
      classification,
      executionDisabled,
    };
  }
}

// Global Singleton for Headless Daemon / API handlers
export const globalHtfHysteresisEngine = new HtfBiasHysteresisEngine();
