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

        for (let j = 1; j <= lb; j++) {
          if (c.high <= candles[i + j].high || c.high <= candles[i - j].high) {
            isPH = false;
          }
          if (c.low >= candles[i + j].low || c.low >= candles[i - j].low) {
            isPL = false;
          }
          if (!isPH && !isPL) break;
        }

        if (isPH) {
          const pIdx = c.index ?? i;
          this.pivots.push({
            type: 'SWING_HIGH',
            index: pIdx,
            price: c.high,
            confirmed: true,
            timestamp: c.t,
            level: lvl.level,
            colorValidated: true // Automatically valid in standard SMC
          });
        }

        if (isPL) {
          const pIdx = c.index ?? i;
          this.pivots.push({
            type: 'SWING_LOW',
            index: pIdx,
            price: c.low,
            confirmed: true,
            timestamp: c.t,
            level: lvl.level,
            colorValidated: true // Automatically valid in standard SMC
          });
        }
      }
    }

    // Sort pivots chronologically
    this.pivots.sort((a, b) => a.timestamp - b.timestamp);
  }
}
