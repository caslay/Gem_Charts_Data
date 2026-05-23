export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  taker_buy_vol?: number;
  taker_sell_vol?: number;
  isClosed?: boolean;
  [key: string]: any;
}

export function detectActiveFVGs(candles: Candle[], onlyClosed: boolean = true) {
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
        const isClosed = c3.isClosed === undefined ? true : c3.isClosed;

        if (onlyClosed) {
          if (isClosed) {
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
        } else {
          active_fvgs.push({
            type,
            status: isClosed ? 'ACTIVE_UNMITIGATED' : 'PENDING_FVG',
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
  }

  return active_fvgs;
}

export interface MappedFVG {
  timeframe: string;
  type: 'BULLISH' | 'BEARISH';
  top: number;
  bottom: number;
  ce: number;
  status: 'UNMITIGATED' | 'MITIGATED' | 'PENDING';
  origin_time: number;
}

export function mapAndConsolidateFVGs(fvgs15m: any[], fvgs5m: any[]): MappedFVG[] {
  const mapFVG = (fvg: any, tf: string): MappedFVG => ({
    timeframe: tf,
    type: fvg.type === 'BISI' ? 'BULLISH' : 'BEARISH',
    top: fvg.coordinates.top,
    bottom: fvg.coordinates.bottom,
    ce: fvg.coordinates.ce_50_percent,
    status: fvg.status === 'ACTIVE_UNMITIGATED' ? 'UNMITIGATED' : (fvg.status === 'PENDING_FVG' ? 'PENDING' : 'MITIGATED'),
    origin_time: fvg.origin_time
  });

  return [
    ...fvgs15m.map(f => mapFVG(f, '15m')),
    ...fvgs5m.map(f => mapFVG(f, '5m'))
  ];
}

