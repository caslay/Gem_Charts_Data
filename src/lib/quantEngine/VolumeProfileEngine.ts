import { Candle } from '../fvgEngine';
import { StructuralDealingRange } from './types';

export interface VolumeProfileMetrics {
  poc: number | null;
  vah: number | null;
  val: number | null;
  vsr: number | null;
}

/**
 * Calculates Swing-Anchored Volume Profile (SAVP) metrics for a given StructuralDealingRange.
 *
 * @param dr The active StructuralDealingRange
 * @param candles The raw OHLCV candle array
 * @returns The computed VolumeProfileMetrics or null if inputs are insufficient
 */
export function calculateVolumeProfile(
  dr: StructuralDealingRange | null,
  candles: Candle[]
): VolumeProfileMetrics | null {
  if (
    !dr ||
    dr.anchor_high_swing === null ||
    dr.anchor_low_swing === null ||
    dr.high === null ||
    dr.low === null
  ) {
    return null;
  }

  const highPrice = Number(dr.high);
  const lowPrice = Number(dr.low);

  if (isNaN(highPrice) || isNaN(lowPrice) || highPrice <= lowPrice) {
    return null;
  }

  // Determine the start and end timestamps of the structural dealing range
  const startTime = Math.min(Number(dr.anchor_low_swing.t), Number(dr.anchor_high_swing.t));
  const endTime = Math.max(Number(dr.anchor_low_swing.t), Number(dr.anchor_high_swing.t));

  // Filter candles spanning the range
  const rangeCandles = candles.filter((c) => c.t >= startTime && c.t <= endTime);
  if (rangeCandles.length === 0) {
    return null;
  }

  // --- Point of Control & Value Area ---
  const numBins = 50;
  const binSize = (highPrice - lowPrice) / numBins;
  const binVolumes = new Array(numBins).fill(0);

  // Fractional Overlap Binning
  for (const c of rangeCandles) {
    const candleHigh = c.high !== undefined ? c.high : c.h;
    const candleLow = c.low !== undefined ? c.low : c.l;
    const candleVolume = c.volume !== undefined ? c.volume : c.v;

    if (
      candleHigh === undefined ||
      candleLow === undefined ||
      candleVolume === undefined ||
      isNaN(candleHigh) ||
      isNaN(candleLow) ||
      isNaN(candleVolume)
    ) {
      continue;
    }

    if (candleHigh === candleLow) {
      // Single price candle, assign volume to the single bin
      const binIdx = Math.min(
        numBins - 1,
        Math.max(0, Math.floor((candleHigh - lowPrice) / binSize))
      );
      binVolumes[binIdx] += candleVolume;
    } else {
      // Distribute volume proportionally across overlapping bins
      for (let i = 0; i < numBins; i++) {
        const binLow = lowPrice + i * binSize;
        const binHigh = lowPrice + (i + 1) * binSize;

        const overlap = Math.max(0, Math.min(candleHigh, binHigh) - Math.max(candleLow, binLow));
        if (overlap > 0) {
          const fraction = overlap / (candleHigh - candleLow);
          binVolumes[i] += candleVolume * fraction;
        }
      }
    }
  }

  // Locate POC (Bin with the highest volume)
  let maxVol = -1;
  let pocIdx = -1;
  let totalVol = 0;

  for (let i = 0; i < numBins; i++) {
    totalVol += binVolumes[i];
    if (binVolumes[i] > maxVol) {
      maxVol = binVolumes[i];
      pocIdx = i;
    }
  }

  if (pocIdx === -1 || totalVol === 0) {
    return null;
  }

  // POC price is the midpoint of the POC bin
  const poc = parseFloat((lowPrice + pocIdx * binSize + binSize / 2).toFixed(2));

  // Value Area High/Low (VAH/VAL) containing 70% of the volume
  const targetVol = totalVol * 0.70;
  let currentVol = binVolumes[pocIdx];
  let valIdx = pocIdx;
  let vahIdx = pocIdx;

  while (currentVol < targetVol) {
    const hasBelow = valIdx - 1 >= 0;
    const hasAbove = vahIdx + 1 < numBins;

    if (!hasBelow && !hasAbove) {
      break;
    }

    if (hasBelow && hasAbove) {
      const volBelow = binVolumes[valIdx - 1];
      const volAbove = binVolumes[vahIdx + 1];

      if (volBelow >= volAbove) {
        valIdx--;
        currentVol += volBelow;
      } else {
        vahIdx++;
        currentVol += volAbove;
      }
    } else if (hasBelow) {
      valIdx--;
      currentVol += binVolumes[valIdx];
    } else {
      vahIdx++;
      currentVol += binVolumes[vahIdx];
    }
  }

  const val = parseFloat((lowPrice + valIdx * binSize).toFixed(2));
  const vah = parseFloat((lowPrice + (vahIdx + 1) * binSize).toFixed(2));

  // --- Volumetric Sponsorship Ratio (VSR) ---
  // VSR = Sum(V_origin) / Sum(V_termination)
  // Split dealing range into 4 quadrants
  const qSize = (highPrice - lowPrice) / 4;
  const quadrantVolumes = [0, 0, 0, 0]; // Q1, Q2, Q3, Q4

  for (const c of rangeCandles) {
    const candleHigh = c.high !== undefined ? c.high : c.h;
    const candleLow = c.low !== undefined ? c.low : c.l;
    const candleVolume = c.volume !== undefined ? c.volume : c.v;

    if (
      candleHigh === undefined ||
      candleLow === undefined ||
      candleVolume === undefined ||
      isNaN(candleHigh) ||
      isNaN(candleLow) ||
      isNaN(candleVolume)
    ) {
      continue;
    }

    if (candleHigh === candleLow) {
      const qIdx = Math.min(3, Math.max(0, Math.floor((candleHigh - lowPrice) / qSize)));
      quadrantVolumes[qIdx] += candleVolume;
    } else {
      for (let q = 0; q < 4; q++) {
        const qLow = lowPrice + q * qSize;
        const qHigh = lowPrice + (q + 1) * qSize;

        const overlap = Math.max(0, Math.min(candleHigh, qHigh) - Math.max(candleLow, qLow));
        if (overlap > 0) {
          const fraction = overlap / (candleHigh - candleLow);
          quadrantVolumes[q] += candleVolume * fraction;
        }
      }
    }
  }

  // Determine which quadrants are origin and termination
  // Bullish: low swing was before high swing. Origin is Q1 (index 0), Termination is Q4 (index 3).
  // Bearish: high swing was before low swing. Origin is Q4 (index 3), Termination is Q1 (index 0).
  const isBullishLeg = Number(dr.anchor_low_swing.t) < Number(dr.anchor_high_swing.t);
  const originVol = isBullishLeg ? quadrantVolumes[0] : quadrantVolumes[3];
  const terminationVol = isBullishLeg ? quadrantVolumes[3] : quadrantVolumes[0];

  const vsr = parseFloat((originVol / (terminationVol || 1e-9)).toFixed(4));

  return {
    poc,
    vah,
    val,
    vsr,
  };
}
