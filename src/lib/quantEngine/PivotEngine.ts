import { Candle } from '../fvgEngine';
import { Pivot, MarketStructureConfig } from './types';

interface TrackedLevel {
  level: 0 | 1 | 2;
  mode: 'UP' | 'DOWN';
  extremeHigh: number;
  extremeHighCandle: Candle | null;
  extremeLow: number;
  extremeLowCandle: Candle | null;
  multiplier: number;
}

export class PivotEngine {
  public pivots: Pivot[] = [];
  public levels: TrackedLevel[];
  private atrPeriod: number;

  constructor(config?: MarketStructureConfig) {
    this.atrPeriod = config?.atrPeriod ?? 14;
    this.levels = [
      { level: 0, mode: 'UP', extremeHigh: -Infinity, extremeHighCandle: null, extremeLow: Infinity, extremeLowCandle: null, multiplier: config?.retracementMultiplier0 ?? 1.0 },
      { level: 1, mode: 'UP', extremeHigh: -Infinity, extremeHighCandle: null, extremeLow: Infinity, extremeLowCandle: null, multiplier: config?.retracementMultiplier1 ?? 2.0 },
      { level: 2, mode: 'UP', extremeHigh: -Infinity, extremeHighCandle: null, extremeLow: Infinity, extremeLowCandle: null, multiplier: config?.retracementMultiplier2 ?? 3.5 }
    ];
  }

  // Institutional Color Lock Validation
  private validateColorLock(candles: Candle[], targetIdx: number, type: 'SWING_HIGH' | 'SWING_LOW'): boolean {
    if (targetIdx <= 0 || targetIdx >= candles.length) return false;
    const target = candles[targetIdx];
    const prev = candles[targetIdx - 1];

    const targetIsRed = target.close < target.open;
    const targetIsGreen = target.close > target.open;
    const prevIsRed = prev.close < prev.open;
    const prevIsGreen = prev.close > prev.open;

    if (type === 'SWING_HIGH') {
      // Valid SH: Red top preceded by Green
      return targetIsRed && prevIsGreen;
    } else {
      // Valid SL: Green bottom preceded by Red
      return targetIsGreen && prevIsRed;
    }
  }

  private findValidPivotBackwards(candles: Candle[], startIdx: number, endIdx: number, type: 'SWING_HIGH' | 'SWING_LOW'): Candle | null {
    let bestCandle: Candle | null = null;
    let bestPrice = type === 'SWING_HIGH' ? -Infinity : Infinity;

    for (let i = startIdx; i >= endIdx; i--) {
      const c = candles[i];
      if (this.validateColorLock(candles, i, type)) {
        if (type === 'SWING_HIGH') {
          if (c.high > bestPrice) {
            bestPrice = c.high;
            bestCandle = c;
          }
        } else {
          if (c.low < bestPrice) {
            bestPrice = c.low;
            bestCandle = c;
          }
        }
      }
    }
    return bestCandle;
  }

  // Compute ATR up to the current index
  private computeATR(candles: Candle[], currentIdx: number): number {
    if (currentIdx === 0) return candles[0].high - candles[0].low;
    
    let trSum = 0;
    const start = Math.max(1, currentIdx - this.atrPeriod + 1);
    const end = currentIdx;
    let count = 0;

    for (let i = start; i <= end; i++) {
      const c = candles[i];
      const prev = candles[i - 1];
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close)
      );
      trSum += tr;
      count++;
    }
    return count > 0 ? trSum / count : candles[currentIdx].high - candles[currentIdx].low;
  }

  public processCandles(candles: Candle[]) {
    // Re-initialize tracking states
    this.pivots = [];
    for (const lvl of this.levels) {
      lvl.mode = 'UP';
      lvl.extremeHigh = -Infinity;
      lvl.extremeHighCandle = null;
      lvl.extremeLow = Infinity;
      lvl.extremeLowCandle = null;
    }

    if (candles.length < 2) return;

    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const atr = this.computeATR(candles, i);

      // Process each hierarchical level independently
      for (const lvl of this.levels) {
        const threshold = atr * lvl.multiplier;

        if (lvl.mode === 'UP') {
          if (c.high > lvl.extremeHigh) {
            lvl.extremeHigh = c.high;
            lvl.extremeHighCandle = c;
          }

          // Retracement detected: Price moves down from the extreme high by the threshold
          if (lvl.extremeHighCandle && c.close < lvl.extremeHigh - threshold) {
            const pivotCandle = this.findValidPivotBackwards(candles, i, lvl.extremeHighCandle.index ?? candles.indexOf(lvl.extremeHighCandle), 'SWING_HIGH') 
                                || lvl.extremeHighCandle; // Fallback if no color-locked candle found
            
            const pIdx = pivotCandle.index ?? candles.indexOf(pivotCandle);

            this.pivots.push({
              type: 'SWING_HIGH',
              index: pIdx,
              price: pivotCandle.high,
              confirmed: true,
              timestamp: pivotCandle.t,
              level: lvl.level,
              colorValidated: this.validateColorLock(candles, pIdx, 'SWING_HIGH')
            });

            lvl.mode = 'DOWN';
            lvl.extremeLow = c.low;
            lvl.extremeLowCandle = c;
          }
        } else {
          if (c.low < lvl.extremeLow) {
            lvl.extremeLow = c.low;
            lvl.extremeLowCandle = c;
          }

          // Retracement detected: Price moves up from the extreme low by the threshold
          if (lvl.extremeLowCandle && c.close > lvl.extremeLow + threshold) {
            const pivotCandle = this.findValidPivotBackwards(candles, i, lvl.extremeLowCandle.index ?? candles.indexOf(lvl.extremeLowCandle), 'SWING_LOW') 
                                || lvl.extremeLowCandle; // Fallback if no color-locked candle found
            
            const pIdx = pivotCandle.index ?? candles.indexOf(pivotCandle);

            this.pivots.push({
              type: 'SWING_LOW',
              index: pIdx,
              price: pivotCandle.low,
              confirmed: true,
              timestamp: pivotCandle.t,
              level: lvl.level,
              colorValidated: this.validateColorLock(candles, pIdx, 'SWING_LOW')
            });

            lvl.mode = 'UP';
            lvl.extremeHigh = c.high;
            lvl.extremeHighCandle = c;
          }
        }
      }
    }

    // Sort pivots chronologically
    this.pivots.sort((a, b) => a.timestamp - b.timestamp);
  }
}
