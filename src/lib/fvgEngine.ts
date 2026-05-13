export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  taker_buy_vol?: number;
  taker_sell_vol?: number;
  [key: string]: any;
}

export function detectActiveFVGs(candles: Candle[]) {
  const active_fvgs = [];
  
  for (let i = 0; i < candles.length - 2; i++) {
    const c1 = candles[i];
    const c3 = candles[i + 2];

    let type: 'BISI' | 'SIBI' | null = null;
    let top = 0;
    let bottom = 0;

    // Bullish FVG (BISI): Buyside Imbalance Sellside Inefficiency
    if (c3.l > c1.h) {
      type = 'BISI';
      top = c3.l;
      bottom = c1.h;
    }
    // Bearish FVG (SIBI): Sellside Imbalance Buyside Inefficiency
    else if (c1.l > c3.h) {
      type = 'SIBI';
      top = c1.l;
      bottom = c3.h;
    }

    if (type) {
      let isMitigated = false;
      // Loop through all subsequent candles that came after c3
      for (let j = i + 3; j < candles.length; j++) {
        const future = candles[j];
        if (type === 'BISI' && future.l <= bottom) {
          isMitigated = true;
          break;
        }
        if (type === 'SIBI' && future.h >= top) {
          isMitigated = true;
          break;
        }
      }

      if (!isMitigated) {
        active_fvgs.push({
          type,
          status: 'ACTIVE_UNMITIGATED',
          coordinates: {
            top,
            ce_50_percent: (top + bottom) / 2,
            bottom
          },
          origin_time: c1.t
        });
      }
    }
  }

  return active_fvgs;
}
