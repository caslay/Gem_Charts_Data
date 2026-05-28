import { SeriesMarker } from 'lightweight-charts';

export interface MarkerCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface MarkerColors {
  sponsorshipColor: string;
  bullishSweepColor: string;
  bearishSweepColor: string;
}

export function generateVolumetricMarkers(candles: MarkerCandle[], colors: MarkerColors) {
  const markers: SeriesMarker<any>[] = [];

  // Iterate through candles (need at least 3 to check a swing)
  for (let i = 2; i < candles.length; i++) {
    const prev = candles[i - 2];
    const mid = candles[i - 1];  // The swing candle we are evaluating
    const curr = candles[i];     // The confirming candle

    // 1. Structural Swing Check
    const isSwingLow = mid.l < prev.l && mid.l < curr.l;
    const isSwingHigh = mid.h > prev.h && mid.h > curr.h;
    if (!isSwingLow && !isSwingHigh) continue;

    // 2. Directional Shift Check
    const isMidBullish = mid.c > mid.o;
    const isMidBearish = mid.c < mid.o;
    const isPrevBullish = prev.c > prev.o;
    const isPrevBearish = prev.c < prev.o;

    const isValidBullishShift = isSwingLow && isMidBullish && isPrevBearish;
    const isValidBearishShift = isSwingHigh && isMidBearish && isPrevBullish;

    if (!isValidBullishShift && !isValidBearishShift) continue;

    // 3. Volumetric Calculations
    const bodyRatioMid = (mid.h - mid.l) !== 0 ? Math.abs(mid.c - mid.o) / (mid.h - mid.l) : 0;
    const bodyRatioPrev = (prev.h - prev.l) !== 0 ? Math.abs(prev.c - prev.o) / (prev.h - prev.l) : 0;

    const dirVolMid = mid.v * bodyRatioMid;
    const dirVolPrev = prev.v * bodyRatioPrev;

    const isRawVolIncrease = mid.v > prev.v;
    const isDirVolIncrease = dirVolMid > dirVolPrev;

    // 4. Generate Markers
    // Lightweight charts time format handling
    const markerTime = mid.t.toString().length > 10 ? Math.floor(mid.t / 1000) : mid.t;

    if (isDirVolIncrease) {
      // SPECIAL SIGNAL - Institutional Sponsorship
      markers.push({
        time: markerTime as any,
        position: isValidBullishShift ? 'belowBar' : 'aboveBar',
        color: colors.sponsorshipColor,
        shape: isValidBullishShift ? 'arrowUp' : 'arrowDown',
        text: '',
      });
    } else if (isRawVolIncrease) {
      // NORMAL SIGNAL - SMT Trap / Sweep
      markers.push({
        time: markerTime as any,
        position: isValidBullishShift ? 'belowBar' : 'aboveBar',
        color: isValidBullishShift ? colors.bullishSweepColor : colors.bearishSweepColor,
        shape: 'circle',
        text: '',
      });
    }
  }

  return markers;
}
