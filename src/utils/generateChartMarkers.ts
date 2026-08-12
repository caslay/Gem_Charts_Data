import { SeriesMarker } from 'lightweight-charts';
import { calculateATR } from '@/lib/riskEngine';
import { Candle, MarketDataPayload } from '@/hooks/useMarketData';

export interface MarkerCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  taker_buy_vol?: number;
  taker_sell_vol?: number;
  volumetric_signal?: 'ARROW_UP' | 'ARROW_DOWN' | 'CIRCLE_UP' | 'CIRCLE_DOWN' | null;
}

export interface PerfectMovementSettings {
  pmAtrMultiplier?: number;
  pmVolumeSmaPeriod?: number;
  pmMinBodyRatio?: number;
  pmMaxWickRatio?: number;
  pmMaxRetracementLimit?: number;
  pmSweepLookback?: number;
  direction?: 'LONG' | 'SHORT';
}

export interface MarkerColors {
  sponsorshipColor: string;
  bullishSweepColor: string;
  bearishSweepColor: string;
  volumetricStrongArrowColor?: string;
  theme?: 'dark' | 'light';
  visualizePerfectMovementOnly?: boolean;
  marketData?: MarketDataPayload | null;
  structureState?: any;
  pmAtrMultiplier?: number;
  pmVolumeSmaPeriod?: number;
  pmMinBodyRatio?: number;
  pmMaxWickRatio?: number;
  pmMaxRetracementLimit?: number;
  pmSweepLookback?: number;
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

export function checkPerfectMovementSetup(
  candles: MarkerCandle[],
  data: MarketDataPayload | null,
  settings: PerfectMovementSettings,
  signalIdx: number,
  structureState?: any
): boolean {
  if (!data || candles.length < 20 || signalIdx < 3 || signalIdx >= candles.length - 1) return false;

  const pmAtrMultiplier = settings.pmAtrMultiplier ?? 0.5;
  const pmVolumeSmaPeriod = settings.pmVolumeSmaPeriod ?? 10;
  const pmMinBodyRatio = settings.pmMinBodyRatio ?? 0.3;
  const pmMaxWickRatio = settings.pmMaxWickRatio ?? 0.5;
  const pmMaxRetracementLimit = settings.pmMaxRetracementLimit ?? 0.7;
  const pmSweepLookback = settings.pmSweepLookback ?? 5;
  const direction = settings.direction || 'LONG';

  const S = candles[signalIdx];         // Signal candle (Phase 2)
  const C = candles[signalIdx + 1];     // Confirmation candle (Phase 3)

  // --- Phase 1: Structural Proximity & Liquidity Sweep (Setup) ---
  // Expanded lookback: check the last N candles before the signal for a sweep
  const ipda = data.ipda_metrics || {};
  const pdh = ipda.macro_levels?.pdh || ipda.pdh || 0;
  const pdl = ipda.macro_levels?.pdl || ipda.pdl || 0;

  const asianHigh = ipda.macro_levels?.asian_high || ipda.session_ranges?.asian_range?.high || 0;
  const asianLow = ipda.macro_levels?.asian_low || ipda.session_ranges?.asian_range?.low || 0;

  const londonHigh = ipda.session_ranges?.london_range?.high || 0;
  const londonLow = ipda.session_ranges?.london_range?.low || 0;

  const swings = structureState?.swings || ipda.full_structure_map?.swings || [];

  // Compute ATR once for both Phase 1 tolerance and Phase 2 range check
  const sliceForAtr = candles.slice(0, signalIdx + 1);
  const atr = calculateATR(sliceForAtr, 14);
  // Proximity tolerance: allow near-sweeps within 0.3 × ATR of a structural level
  const sweepTolerance = 0.3 * atr;

  const checkCandleSweep = (c: MarkerCandle): boolean => {
    if (direction === 'LONG') {
      // Strict sweep: wick pierced below level AND closed back above
      if (pdl > 0 && c.l <= pdl && c.c > pdl) return true;
      if (asianLow > 0 && c.l <= asianLow && c.c > asianLow) return true;
      if (londonLow > 0 && c.l <= londonLow && c.c > londonLow) return true;

      // Proximity sweep: wick came within tolerance of a level AND closed above
      if (pdl > 0 && c.l <= pdl + sweepTolerance && c.c > pdl) return true;
      if (asianLow > 0 && c.l <= asianLow + sweepTolerance && c.c > asianLow) return true;
      if (londonLow > 0 && c.l <= londonLow + sweepTolerance && c.c > londonLow) return true;

      // Check swing levels (all grades — MAJOR, INTERNAL, INNER)
      const priorSwingLows = swings.filter(
        (s: any) => s.type === 'LOW' && s.t < c.t
      );
      const recentLows = priorSwingLows.slice(-8);
      for (const s of recentLows) {
        const p = Number(s.price);
        // Strict pierce or proximity sweep
        if (c.l <= p + sweepTolerance && c.c > p - sweepTolerance) return true;
      }
    } else {
      if (pdh > 0 && c.h >= pdh && c.c < pdh) return true;
      if (asianHigh > 0 && c.h >= asianHigh && c.c < asianHigh) return true;
      if (londonHigh > 0 && c.h >= londonHigh && c.c < londonHigh) return true;

      // Proximity sweep for shorts
      if (pdh > 0 && c.h >= pdh - sweepTolerance && c.c < pdh) return true;
      if (asianHigh > 0 && c.h >= asianHigh - sweepTolerance && c.c < asianHigh) return true;
      if (londonHigh > 0 && c.h >= londonHigh - sweepTolerance && c.c < londonHigh) return true;

      const priorSwingHighs = swings.filter(
        (s: any) => s.type === 'HIGH' && s.t < c.t
      );
      const recentHighs = priorSwingHighs.slice(-8);
      for (const s of recentHighs) {
        const p = Number(s.price);
        if (c.h >= p - sweepTolerance && c.c < p + sweepTolerance) return true;
      }
    }
    return false;
  };

  // Expanded lookback: check pmSweepLookback candles before the signal
  let isPhase1Valid = false;
  const sweepStart = Math.max(0, signalIdx - pmSweepLookback);
  for (let k = sweepStart; k < signalIdx; k++) {
    if (checkCandleSweep(candles[k])) {
      isPhase1Valid = true;
      break;
    }
  }
  if (!isPhase1Valid) return false;

  // --- Phase 2: Volumetric Anatomy (Catalyst) ---
  const sRange = S.h - S.l;
  if (sRange < pmAtrMultiplier * atr) return false;

  let volSum = 0;
  const vStartIdx = Math.max(0, signalIdx - pmVolumeSmaPeriod);
  const vEndIdx = signalIdx;
  for (let idx = vStartIdx; idx < vEndIdx; idx++) {
    volSum += candles[idx].v;
  }
  const avgVol = volSum / Math.max(1, vEndIdx - vStartIdx);
  if (S.v <= avgVol) return false;

  const sBody = Math.abs(S.c - S.o);
  const sBodyRatio = sRange > 0 ? sBody / sRange : 0;
  if (sBodyRatio < pmMinBodyRatio) return false;

  if (direction === 'LONG') {
    const wickHigh = S.h - S.c;
    if (wickHigh > pmMaxWickRatio * sRange) return false;
    if (S.c <= S.o) return false;
    const takerDelta = (S.taker_buy_vol || 0) - (S.taker_sell_vol || 0);
    if (takerDelta <= 0) return false;
  } else {
    const wickLow = S.c - S.l;
    if (wickLow > pmMaxWickRatio * sRange) return false;
    if (S.c >= S.o) return false;
    const takerDelta = (S.taker_buy_vol || 0) - (S.taker_sell_vol || 0);
    if (takerDelta >= 0) return false;
  }

  // --- Phase 3: Delayed Confirmation Gate ---
  if (direction === 'LONG') {
    if (C.c <= S.o) return false;
    const retracementFloor = S.c - pmMaxRetracementLimit * sBody;
    if (C.l < retracementFloor) return false;
  } else {
    if (C.c >= S.o) return false;
    const retracementCeiling = S.c + pmMaxRetracementLimit * sBody;
    if (C.h > retracementCeiling) return false;
  }

  // Requirement 3C: No opposing volumetric signal on S or C.
  const sSignal = (S as any).volumetric_signal;
  const cSignal = (C as any).volumetric_signal;
  if (direction === 'LONG') {
    if (sSignal === 'ARROW_DOWN' || sSignal === 'CIRCLE_DOWN') return false;
    if (cSignal === 'ARROW_DOWN' || cSignal === 'CIRCLE_DOWN') return false;
  } else {
    if (sSignal === 'ARROW_UP' || sSignal === 'CIRCLE_UP') return false;
    if (cSignal === 'ARROW_UP' || cSignal === 'CIRCLE_UP') return false;
  }

  return true;
}


export function generateVolumetricMarkers(candles: MarkerCandle[], colors: MarkerColors) {
  // Always annotate to ensure live candles (which lack pre-calculated signals from the backend)
  // are properly annotated on every tick. This operation is O(N) and takes < 1ms.
  annotateCandlesWithVolumetricSignals(candles);

  const markers: SeriesMarker<any>[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c.volumetric_signal) continue;

    // Lightweight charts time format handling
    const markerTime = c.t.toString().length > 10 ? Math.floor(c.t / 1000) : c.t;

    const usePerfectFilter = colors.visualizePerfectMovementOnly === true && colors.marketData;
    const fadedColor = colors.theme === 'light' ? 'rgba(128, 128, 128, 0.90)' : 'rgba(128, 128, 128, 0.90)';

    if (c.volumetric_signal === 'ARROW_UP') {
      let isPerfect = false;
      if (usePerfectFilter) {
        const pmSettings: PerfectMovementSettings = {
          pmAtrMultiplier: colors.pmAtrMultiplier,
          pmVolumeSmaPeriod: colors.pmVolumeSmaPeriod,
          pmMinBodyRatio: colors.pmMinBodyRatio,
          pmMaxWickRatio: colors.pmMaxWickRatio,
          pmMaxRetracementLimit: colors.pmMaxRetracementLimit,
          pmSweepLookback: colors.pmSweepLookback,
          direction: 'LONG',
        };
        isPerfect = checkPerfectMovementSetup(candles, colors.marketData || null, pmSettings, i, colors.structureState);
      }

      let arrowColor = '';
      if (usePerfectFilter) {
        arrowColor = isPerfect ? '#00f0ff' : fadedColor;
      } else {
        const isStrong = c.taker_buy_vol !== undefined && c.taker_sell_vol !== undefined && c.taker_buy_vol > c.taker_sell_vol;
        const weakColor = colors.theme === 'light' ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.45)';
        arrowColor = isStrong ? (colors.volumetricStrongArrowColor || (colors.theme === 'light' ? '#e11d48' : '#ff007f')) : weakColor;
      }

      markers.push({
        time: markerTime as any,
        position: 'belowBar',
        color: arrowColor,
        shape: 'arrowUp',
        text: isPerfect && usePerfectFilter ? 'PM' : '',
      });
    } else if (c.volumetric_signal === 'ARROW_DOWN') {
      let isPerfect = false;
      if (usePerfectFilter) {
        const pmSettings: PerfectMovementSettings = {
          pmAtrMultiplier: colors.pmAtrMultiplier,
          pmVolumeSmaPeriod: colors.pmVolumeSmaPeriod,
          pmMinBodyRatio: colors.pmMinBodyRatio,
          pmMaxWickRatio: colors.pmMaxWickRatio,
          pmMaxRetracementLimit: colors.pmMaxRetracementLimit,
          pmSweepLookback: colors.pmSweepLookback,
          direction: 'SHORT',
        };
        isPerfect = checkPerfectMovementSetup(candles, colors.marketData || null, pmSettings, i, colors.structureState);
      }

      let arrowColor = '';
      if (usePerfectFilter) {
        arrowColor = isPerfect ? '#ff007f' : fadedColor;
      } else {
        const isStrong = c.taker_buy_vol !== undefined && c.taker_sell_vol !== undefined && c.taker_sell_vol > c.taker_buy_vol;
        const weakColor = colors.theme === 'light' ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.45)';
        arrowColor = isStrong ? (colors.volumetricStrongArrowColor || (colors.theme === 'light' ? '#e11d48' : '#ff007f')) : weakColor;
      }

      markers.push({
        time: markerTime as any,
        position: 'aboveBar',
        color: arrowColor,
        shape: 'arrowDown',
        text: isPerfect && usePerfectFilter ? 'PM' : '',
      });
    } else if (c.volumetric_signal === 'CIRCLE_UP') {
      const circleColor = colors.bullishSweepColor;
      markers.push({
        time: markerTime as any,
        position: 'belowBar',
        color: circleColor,
        shape: 'circle',
        text: '',
      });
    } else if (c.volumetric_signal === 'CIRCLE_DOWN') {
      const circleColor = colors.bearishSweepColor;
      markers.push({
        time: markerTime as any,
        position: 'aboveBar',
        color: circleColor,
        shape: 'circle',
        text: '',
      });
    }
  }

  return markers;
}

