export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  taker_buy_vol: number;
  taker_sell_vol: number;
  isClosed?: boolean;
  volumetric_signal?: 'ARROW_UP' | 'ARROW_DOWN' | 'CIRCLE_UP' | 'CIRCLE_DOWN' | null;
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
      let isRetested = false;

      // Institutional Invalidation & Retest Scanning:
      // BISI: fully invalidated when price breaches below bottom boundary. Touches inside top/bottom mark an active retest.
      // SIBI: fully invalidated when price breaches above top boundary. Touches inside bottom/top mark an active retest.
      for (let j = i + 3; j < candles.length; j++) {
        const future = candles[j];
        if (type === 'BISI') {
          if (future.l < bottom) {
            isMitigated = true;
            break;
          }
          if (future.l <= top) {
            isRetested = true;
          }
        } else if (type === 'SIBI') {
          if (future.h > top) {
            isMitigated = true;
            break;
          }
          if (future.h >= bottom) {
            isRetested = true;
          }
        }
      }

      if (!isMitigated) {
        const isClosed = c3.isClosed === undefined ? true : c3.isClosed;
        const fvgStatus = isClosed
          ? (isRetested ? 'ACTIVE_RETESTED' : 'ACTIVE_UNMITIGATED')
          : 'PENDING_FVG';

        if (onlyClosed) {
          if (isClosed) {
            active_fvgs.push({
              type,
              status: fvgStatus,
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
            status: fvgStatus,
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

export function mapAndConsolidateFVGs(
  fvgGroups: { fvgs: any[]; timeframe: string }[] | any[],
  legacyFvgs5m?: any[]
): MappedFVG[] {
  const mapFVG = (fvg: any, tf: string): MappedFVG => ({
    timeframe: tf,
    type: fvg.type === 'BISI' ? 'BULLISH' : 'BEARISH',
    top: fvg.coordinates.top,
    bottom: fvg.coordinates.bottom,
    ce: fvg.coordinates.ce_50_percent,
    status: (fvg.status === 'ACTIVE_UNMITIGATED' || fvg.status === 'ACTIVE_RETESTED') ? 'UNMITIGATED' : (fvg.status === 'PENDING_FVG' ? 'PENDING' : 'MITIGATED'),
    origin_time: fvg.origin_time
  });


  if (legacyFvgs5m !== undefined && Array.isArray(fvgGroups)) {
    return [
      ...fvgGroups.map(f => mapFVG(f, '15m')),
      ...legacyFvgs5m.map(f => mapFVG(f, '5m'))
    ];
  }

  const groups = fvgGroups as { fvgs: any[]; timeframe: string }[];
  return groups.flatMap(({ fvgs, timeframe }) => fvgs.map(f => mapFVG(f, timeframe)));
}

