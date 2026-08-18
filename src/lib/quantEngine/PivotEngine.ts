import { Candle } from '../fvgEngine';
import { Pivot, MarketStructureConfig } from './types';

interface TrackedLevel {
  level: 0 | 1 | 2;
  lookback: number;
}

export class PivotEngine {
  public pivots: Pivot[] = [];
  public levels: TrackedLevel[];

  constructor(config?: MarketStructureConfig) {
    this.levels = [
      { level: 0, lookback: config?.lookbackMicro ?? 3 },
      { level: 1, lookback: config?.lookbackInternal ?? 5 },
      { level: 2, lookback: config?.lookbackMajor ?? 15 }
    ];
  }

  public processCandles(candles: Candle[]) {
    // Re-initialize tracking states
    this.pivots = [];

    if (candles.length < 2) return;

    // Process each hierarchical level independently
    for (const lvl of this.levels) {
      const lb = lvl.lookback;
      
      // A pivot requires `lb` candles on the left and `lb` candles on the right.
      for (let i = lb; i < candles.length - lb; i++) {
        const c = candles[i];
        let isPH = true;
        let isPL = true;

        const cHigh = c.high ?? c.h;
        const cLow = c.low ?? c.l;

        for (let j = 1; j <= lb; j++) {
          const nextC = candles[i + j];
          const prevC = candles[i - j];
          const nextHigh = nextC.high ?? nextC.h;
          const nextLow = nextC.low ?? nextC.l;
          const prevHigh = prevC.high ?? prevC.h;
          const prevLow = prevC.low ?? prevC.l;

          if (cHigh <= nextHigh || cHigh <= prevHigh) {
            isPH = false;
          }
          if (cLow >= nextLow || cLow >= prevLow) {
            isPL = false;
          }
          if (!isPH && !isPL) break;
        }

        const isConfirmed = (candles[i + lb] !== undefined) && (candles[i + lb].isClosed !== false);

        // ─── Directional Color Lock (Lesson #1 / Lesson #17 Doctrine) ───────────────
        // A valid Swing High MUST be a red candle (close < open) immediately preceded
        // by a green candle (close > open).
        // A valid Swing Low MUST be a green candle (close > open) immediately preceded
        // by a red candle (close < open).
        // Unvalidated pivots are still registered so the renderer can show them as
        // dim/dashed visual hints, but they are NOT used for dealing-range anchoring.
        const prev = i > 0 ? candles[i - 1] : null;
        const cIsRed   = (c.close ?? c.c) < (c.open ?? c.o);
        const cIsGreen = (c.close ?? c.c) > (c.open ?? c.o);
        const prevIsGreen = prev !== null && (prev.close ?? prev.c) > (prev.open ?? prev.o);
        const prevIsRed   = prev !== null && (prev.close ?? prev.c) < (prev.open ?? prev.o);

        if (isPH) {
          const pIdx = c.index ?? i;
          // Color Lock: red top preceded by green candle
          const colorValidated = cIsRed && prevIsGreen;
          this.pivots.push({
            type: 'SWING_HIGH',
            index: pIdx,
            price: cHigh,
            confirmed: isConfirmed,
            timestamp: c.t,
            level: lvl.level,
            colorValidated
          });
        }

        if (isPL) {
          const pIdx = c.index ?? i;
          // Color Lock: green bottom preceded by red candle
          const colorValidated = cIsGreen && prevIsRed;
          this.pivots.push({
            type: 'SWING_LOW',
            index: pIdx,
            price: cLow,
            confirmed: isConfirmed,
            timestamp: c.t,
            level: lvl.level,
            colorValidated
          });
        }
      }
    }

    // Sort pivots chronologically
    this.pivots.sort((a, b) => a.timestamp - b.timestamp);
  }
}
