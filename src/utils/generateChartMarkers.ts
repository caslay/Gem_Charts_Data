import { SeriesMarker } from 'lightweight-charts';

export interface MarkerCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  volumetric_signal?: 'ARROW_UP' | 'ARROW_DOWN' | 'CIRCLE_UP' | 'CIRCLE_DOWN' | null;
}

export interface MarkerColors {
  sponsorshipColor: string;
  bullishSweepColor: string;
  bearishSweepColor: string;
}

/**
 * Iterates through candles and annotates each candle with its volumetric signal
 * ('ARROW_UP' | 'ARROW_DOWN' | 'CIRCLE_UP' | 'CIRCLE_DOWN' | null) on the middle/swing candle.
 */
export function annotateCandlesWithVolumetricSignals<T extends {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  volumetric_signal?: 'ARROW_UP' | 'ARROW_DOWN' | 'CIRCLE_UP' | 'CIRCLE_DOWN' | null;
}>(candles: T[]): T[] {
  // 1. Initialize all signals to null
  for (const c of candles) {
    c.volumetric_signal = null;
  }

  // 2. Iterate (need at least 3 candles to evaluate a swing)
  for (let i = 2; i < candles.length; i++) {
    const prev = candles[i - 2];
    const mid = candles[i - 1];  // The swing candle we are evaluating
    const curr = candles[i];     // The confirming candle

    // Gate 1: Structural Swing Check
    const isSwingLow = mid.l < prev.l && mid.l < curr.l;
    const isSwingHigh = mid.h > prev.h && mid.h > curr.h;
    if (!isSwingLow && !isSwingHigh) continue;

    // Gate 2: Directional Shift Check (Color Lock)
    const isMidBullish = mid.c > mid.o;
    const isMidBearish = mid.c < mid.o;
    const isPrevBullish = prev.c > prev.o;
    const isPrevBearish = prev.c < prev.o;

    const isValidBullishShift = isSwingLow && isMidBullish && isPrevBearish;
    const isValidBearishShift = isSwingHigh && isMidBearish && isPrevBullish;

    if (!isValidBullishShift && !isValidBearishShift) continue;

    // Gate 3: Volumetric Calculations
    const bodyRatioMid = (mid.h - mid.l) !== 0 ? Math.abs(mid.c - mid.o) / (mid.h - mid.l) : 0;
    const bodyRatioPrev = (prev.h - prev.l) !== 0 ? Math.abs(prev.c - prev.o) / (prev.h - prev.l) : 0;

    const dirVolMid = mid.v * bodyRatioMid;
    const dirVolPrev = prev.v * bodyRatioPrev;

    const isRawVolIncrease = mid.v > prev.v;
    const isDirVolIncrease = dirVolMid > dirVolPrev;

    // Gate 4: Assign Signal
    if (isDirVolIncrease) {
      mid.volumetric_signal = isValidBullishShift ? 'ARROW_UP' : 'ARROW_DOWN';
    } else if (isRawVolIncrease) {
      mid.volumetric_signal = isValidBullishShift ? 'CIRCLE_UP' : 'CIRCLE_DOWN';
    }
  }

  return candles;
}

export function generateVolumetricMarkers(candles: MarkerCandle[], colors: MarkerColors) {
  // Check if signals are pre-calculated; if not, annotate now
  const hasPrecalculatedSignals = candles.some(c => c.volumetric_signal !== undefined);
  if (!hasPrecalculatedSignals) {
    annotateCandlesWithVolumetricSignals(candles);
  }

  const markers: SeriesMarker<any>[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c.volumetric_signal) continue;

    // Lightweight charts time format handling
    const markerTime = c.t.toString().length > 10 ? Math.floor(c.t / 1000) : c.t;

    if (c.volumetric_signal === 'ARROW_UP') {
      markers.push({
        time: markerTime as any,
        position: 'belowBar',
        color: colors.sponsorshipColor,
        shape: 'arrowUp',
        text: '',
      });
    } else if (c.volumetric_signal === 'ARROW_DOWN') {
      markers.push({
        time: markerTime as any,
        position: 'aboveBar',
        color: colors.sponsorshipColor,
        shape: 'arrowDown',
        text: '',
      });
    } else if (c.volumetric_signal === 'CIRCLE_UP') {
      markers.push({
        time: markerTime as any,
        position: 'belowBar',
        color: colors.bullishSweepColor,
        shape: 'circle',
        text: '',
      });
    } else if (c.volumetric_signal === 'CIRCLE_DOWN') {
      markers.push({
        time: markerTime as any,
        position: 'aboveBar',
        color: colors.bearishSweepColor,
        shape: 'circle',
        text: '',
      });
    }
  }

  return markers;
}

