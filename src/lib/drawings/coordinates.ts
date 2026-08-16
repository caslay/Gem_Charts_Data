import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { Candle } from '@/hooks/useMarketData';
import type { DrawingPoint, PixelPoint } from './types';

/**
 * Converts a Price (number) to viewport Pixel Y coordinate.
 */
export function priceToPixel(
  price: number,
  series: ISeriesApi<'Candlestick'> | null | undefined
): number | null {
  if (!series || price === null || price === undefined || isNaN(price)) return null;
  try {
    const y = series.priceToCoordinate(price);
    return y !== null && !isNaN(y) ? y : null;
  } catch {
    return null;
  }
}

/**
 * Converts a viewport Pixel Y coordinate to Price (number).
 */
export function pixelToPrice(
  y: number,
  series: ISeriesApi<'Candlestick'> | null | undefined,
  tickSize: number = 0.05
): number | null {
  if (!series || y === null || y === undefined || isNaN(y)) return null;
  try {
    const rawPrice = series.coordinateToPrice(y);
    if (rawPrice === null || isNaN(rawPrice)) return null;
    if (tickSize > 0) {
      return Math.round(rawPrice / tickSize) * tickSize;
    }
    return rawPrice;
  } catch {
    return null;
  }
}

/**
 * Estimates average candle interval in milliseconds from candle dataset.
 */
export function estimateCandleIntervalMs(candles: Candle[] | undefined, defaultIntervalMs: number = 300000): number {
  if (!candles || candles.length < 2) return defaultIntervalMs;
  const count = Math.min(candles.length - 1, 10);
  const startIdx = candles.length - 1 - count;
  const diffTotal = candles[candles.length - 1].t - candles[startIdx].t;
  const avg = diffTotal / count;
  return avg > 0 ? avg : defaultIntervalMs;
}

/**
 * Converts a Timestamp (in milliseconds) to viewport Pixel X coordinate.
 * Handles historical bars, intra-bar timestamps, and future projections smoothly.
 */
export function timeToPixel(
  timeMs: number,
  chart: IChartApi | null | undefined,
  candles: Candle[] | undefined
): number | null {
  if (!chart || timeMs === null || timeMs === undefined || isNaN(timeMs)) return null;

  try {
    const timeScale = chart.timeScale();
    const timeSec = Math.floor(timeMs / 1000);

    // 1. Direct TimeScale mapping
    const directX = timeScale.timeToCoordinate(timeSec as any);
    if (directX !== null && !isNaN(directX)) {
      return directX;
    }

    if (!candles || candles.length === 0) return null;

    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];
    const intervalMs = estimateCandleIntervalMs(candles);

    // 2. Future Projection (time is ahead of the newest candle)
    if (timeMs > lastCandle.t) {
      const extraBars = (timeMs - lastCandle.t) / intervalMs;
      const targetLogical = (candles.length - 1) + extraBars;
      const projX = timeScale.logicalToCoordinate(targetLogical as any);
      if (projX !== null && !isNaN(projX)) return projX;
    }

    // 3. Past Projection (time is before the oldest candle)
    if (timeMs < firstCandle.t) {
      const pastBars = (firstCandle.t - timeMs) / intervalMs;
      const targetLogical = -pastBars;
      const projX = timeScale.logicalToCoordinate(targetLogical as any);
      if (projX !== null && !isNaN(projX)) return projX;
    }

    // 4. Intra-bar interpolation (between two existing candles)
    let low = 0;
    let high = candles.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (candles[mid].t <= timeMs && (mid === candles.length - 1 || candles[mid + 1].t > timeMs)) {
        const c1 = candles[mid];
        const c2 = mid < candles.length - 1 ? candles[mid + 1] : null;
        const x1 = timeScale.timeToCoordinate(Math.floor(c1.t / 1000) as any) ?? timeScale.logicalToCoordinate(mid as any);
        if (c2 && x1 !== null) {
          const x2 = timeScale.timeToCoordinate(Math.floor(c2.t / 1000) as any) ?? timeScale.logicalToCoordinate((mid + 1) as any);
          if (x2 !== null) {
            const frac = (timeMs - c1.t) / (c2.t - c1.t);
            return x1 + frac * (x2 - x1);
          }
        }
        return x1;
      } else if (candles[mid].t > timeMs) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Converts a viewport Pixel X coordinate to UTC Timestamp (milliseconds).
 * Handles clicks beyond the right scale edge into future whitespace.
 */
export function pixelToTime(
  x: number,
  chart: IChartApi | null | undefined,
  candles: Candle[] | undefined,
  fallbackIntervalMs: number = 300000
): number | null {
  if (!chart || x === null || x === undefined || isNaN(x)) return null;

  try {
    const timeScale = chart.timeScale();

    // 1. Direct Time query
    const timeSec = timeScale.coordinateToTime(x);
    if (timeSec !== null && !isNaN(Number(timeSec))) {
      return Number(timeSec) * 1000;
    }

    // 2. Logical index fallback
    const logical = timeScale.coordinateToLogical(x);
    if (logical === null || isNaN(Number(logical))) return null;

    const logicalIdx = Number(logical);

    if (!candles || candles.length === 0) {
      // Fallback timestamp if no candles loaded
      return Date.now() + Math.round(logicalIdx) * fallbackIntervalMs;
    }

    const intervalMs = estimateCandleIntervalMs(candles, fallbackIntervalMs);

    if (logicalIdx >= candles.length) {
      const extraBars = logicalIdx - (candles.length - 1);
      return candles[candles.length - 1].t + Math.round(extraBars * intervalMs);
    } else if (logicalIdx < 0) {
      return candles[0].t + Math.round(logicalIdx * intervalMs);
    } else {
      const floorIdx = Math.floor(logicalIdx);
      const frac = logicalIdx - floorIdx;
      if (floorIdx >= 0 && floorIdx < candles.length - 1) {
        const t1 = candles[floorIdx].t;
        const t2 = candles[floorIdx + 1].t;
        return Math.round(t1 + frac * (t2 - t1));
      }
      return candles[Math.min(candles.length - 1, Math.max(0, floorIdx))].t;
    }
  } catch {
    return null;
  }
}

/**
 * Converts a DrawingPoint { price, time } into viewport PixelPoint { x, y }.
 */
export function pointToPixel(
  pt: DrawingPoint,
  chart: IChartApi | null | undefined,
  series: ISeriesApi<'Candlestick'> | null | undefined,
  candles: Candle[] | undefined
): PixelPoint | null {
  const x = timeToPixel(pt.time, chart, candles);
  const y = priceToPixel(pt.price, series);
  if (x === null || y === null) return null;
  return { x, y };
}

/**
 * Converts a viewport PixelPoint { x, y } into a math-anchored DrawingPoint { price, time }.
 */
export function pixelToPoint(
  pixel: PixelPoint,
  chart: IChartApi | null | undefined,
  series: ISeriesApi<'Candlestick'> | null | undefined,
  candles: Candle[] | undefined,
  tickSize: number = 0.05
): DrawingPoint | null {
  const time = pixelToTime(pixel.x, chart, candles);
  const price = pixelToPrice(pixel.y, series, tickSize);
  if (time === null || price === null) return null;
  return { price, time };
}
