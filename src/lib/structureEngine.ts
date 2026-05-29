/**
 * structureEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized Market Structure Analysis Engine — SINGLE SOURCE OF TRUTH.
 *
 * This module contains ZERO visual/rendering code.
 * All downstream consumers (structureLayer.ts, market-data/route.ts,
 * useBacktestEngine.ts, useStrategyEvaluator.ts) import from here.
 *
 * Implements:
 *   1. Displacement-Based Anchor Identification (Lesson #17 and new doctrine compliance)
 *   2. The Retracement Gate (Equilibrium Rule: mid-move tap validation)
 *   3. New Wave Validation (BOS / MSS validated strictly upon Equilibrium tap)
 *   4. Absolute Extreme Tracking (dynamic anchor shift on price expansion)
 *   5. Dual-Depth Multi-Level Structure (Major Waves + Inner Sub-Waves)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { detectActiveFVGs } from './fvgEngine';
import type { Candle } from './fvgEngine';
import type { InstitutionalSponsorship } from './displacementEngine';

// ─── Exported Interfaces ──────────────────────────────────────────────────────

export interface StructuralSwing {
  /** Candle open time in milliseconds (UTC). */
  t: number;
  /** Price level of the swing (high for HIGHs, low for LOWs). */
  price: number;
  /** Whether this swing marks a local HIGH or LOW. */
  type: 'HIGH' | 'LOW';
  /** Grade: MAJOR = 5-bar fractal, INNER = 3-bar fractal. Keep for API parity. */
  grade: 'MAJOR' | 'INNER';
  /** Passes the Institutional Color Lock (API parity). */
  colorValidated: boolean;
  /** Index of this swing in the processed array. */
  candle_index?: number;
  /** ISO timestamp string of the swing candle. */
  timestamp?: string;
  /** Structure hierarchy classification: MAJOR (Parent Range) vs INTERNAL (Child Wave) */
  structure_type?: 'MAJOR' | 'INTERNAL';
  /** Confirmation flag: TRUE only when the succeeding candles have fully closed */
  confirmed?: boolean;
}

export interface ZigZagSegment {
  /** The swing point this segment starts from. */
  from: StructuralSwing;
  /** The swing point this segment connects to. */
  to: StructuralSwing;
  /**
   * Contextual classification:
   *   BOS      — Break of Structure (trend continuation)
   *   MSS      — Market Structure Shift (trend reversal)
   *   INTERNAL — First segment / insufficient context for classification
   */
  label: 'BOS' | 'MSS' | 'INTERNAL';
  /** Trend state BEFORE this break was evaluated. */
  trendBefore: 'BULLISH' | 'BEARISH' | 'UNSET';
  /** Trend state AFTER this break was applied. */
  trendAfter: 'BULLISH' | 'BEARISH' | 'UNSET';
  /**
   * TRUE only when label === 'MSS' AND institutional displacement
   * sponsorship was active at the time of evaluation.
   * Strategy evaluator should only trigger on confirmed MSS.
   */
  displacementConfirmed: boolean;
}

export interface StructuralDealingRange {
  high: number;
  low: number;
  equilibrium: number;
  current_status: 'PREMIUM' | 'DISCOUNT';
  /** The swing that anchors the HIGH boundary. */
  anchor_high_swing: StructuralSwing | null;
  /** The swing that anchors the LOW boundary. */
  anchor_low_swing: StructuralSwing | null;
}

export interface MarketStructureAnalysis {
  /** All detected swings (MAJOR + INNER, for visual rendering compatibility). */
  swings: StructuralSwing[];
  /** Alternating zig-zag segments. */
  zigzag: ZigZagSegment[];
  /** Dealing range derived from the most recent structural pivots. */
  dealingRange: StructuralDealingRange;
  /** Current inferred trend state from the state machine. */
  currentTrend: 'BULLISH' | 'BEARISH' | 'UNSET';
  /** Most recent MSS event (if any). */
  latestMSS: ZigZagSegment | null;
  /**
   * Binary flag: TRUE only when the latest MSS is displacement-confirmed.
   * This is the field consumed by useStrategyEvaluator's MSS metric.
   */
  market_structure_shift: boolean;
  /** Direction of the confirmed MSS (the NEW trend direction after the shift). */
  market_structure_shift_direction: 'BULLISH' | 'BEARISH' | null;
  /** Inner sub-wave alternating zig-zag segments. */
  innerZigzag?: ZigZagSegment[];
  /** Inner sub-wave detected swings. */
  innerSwings?: StructuralSwing[];
  /** Inner sub-wave short-term trend state. */
  subTrend?: 'BULLISH' | 'BEARISH' | 'UNSET';

  // Mandate V10.34 additions:
  internalTrend?: 'BULLISH' | 'BEARISH' | 'UNSET';
  internalZigzag?: ZigZagSegment[];
  latestInternalMSS?: ZigZagSegment | null;
  internal_market_structure_shift?: boolean;
  internalDealingRange?: StructuralDealingRange;

  // Runaway momentum override fields
  expansion_mode?: 'NORMAL' | 'RUNAWAY';
  market_velocity?: number;
  runaway_origin_price?: number | null;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Helper to identify if a candle represents an institutional displacement move.
 * Uses a rolling 14-period average of buy/sell volume to locate high-momentum legs.
 */
function isDisplacementCandle(i: number, candles: Candle[], volMultiplier: number): { active: boolean; direction: 'BULLISH' | 'BEARISH' | null } {
  if (i < 14) return { active: false, direction: null };
  const slice = candles.slice(i - 14, i);
  let sumBuy = 0;
  let sumSell = 0;
  for (const c of slice) {
    sumBuy += c.taker_buy_vol || 0;
    sumSell += c.taker_sell_vol || 0;
  }
  const avgBuy = sumBuy / 14;
  const avgSell = sumSell / 14;

  const curr = candles[i];
  const isBullish = curr.c > curr.o;
  const isBearish = curr.c < curr.o;

  const takerBuy = curr.taker_buy_vol || 0;
  const takerSell = curr.taker_sell_vol || 0;

  if (isBullish && takerBuy > (avgBuy * volMultiplier) && avgBuy > 0) {
    return { active: true, direction: 'BULLISH' };
  }
  if (isBearish && takerSell > (avgSell * volMultiplier) && avgSell > 0) {
    return { active: true, direction: 'BEARISH' };
  }
  return { active: false, direction: null };
}

/**
 * Executes the chronological Equilibrium-Based wave state machine on a candle series.
 */
function runEquilibriumStateMachine(
  candles: Candle[],
  currentPrice: number,
  displacementStatus: InstitutionalSponsorship | null | undefined,
  volMultiplier: number,
  indexOffset: number = 0,
  globalAnchors?: any | null
) {
  const span = volMultiplier >= 2.0 ? 2 : 1; // MAJOR (5-bar fractal, span = 2), INNER (3-bar fractal, span = 1)
  const swings: StructuralSwing[] = [];

  // Robust boundary check helper to check if a candle has closed
  const isCandleClosed = (idx: number): boolean => {
    if (idx < 0 || idx >= candles.length) return false;
    const c = candles[idx];
    if (!c) return false;
    return c.isClosed !== false;
  };
  
  // 1. Detect raw price-extreme-only fractals
  for (let i = span; i < candles.length - span; i++) {
    const curr = candles[i];
    
    // Check Swing High
    let isHigh = true;
    for (let j = 1; j <= span; j++) {
      if (curr.h <= candles[i - j].h || curr.h <= candles[i + j].h) {
        isHigh = false;
        break;
      }
    }
    
    // Check Swing Low
    let isLow = true;
    for (let j = 1; j <= span; j++) {
      if (curr.l >= candles[i - j].l || curr.l >= candles[i + j].l) {
        isLow = false;
        break;
      }
    }
    
    if (isHigh) {
      swings.push({
        t: curr.t,
        price: curr.h,
        type: 'HIGH',
        grade: volMultiplier >= 2.0 ? 'MAJOR' : 'INNER',
        colorValidated: true,
        candle_index: i + indexOffset,
        timestamp: new Date(curr.t).toISOString(),
        confirmed: isCandleClosed(i + span)
      });
    } else if (isLow) {
      swings.push({
        t: curr.t,
        price: curr.l,
        type: 'LOW',
        grade: volMultiplier >= 2.0 ? 'MAJOR' : 'INNER',
        colorValidated: true,
        candle_index: i + indexOffset,
        timestamp: new Date(curr.t).toISOString(),
        confirmed: isCandleClosed(i + span)
      });
    }
  }

  // Partition raw swings into confirmed and unconfirmed
  const confirmedRawSwings = swings.filter(s => s.confirmed);
  const unconfirmedRawSwings = swings.filter(s => !s.confirmed);
  
  // 2. Strict Zig-Zag Alternation ON CONFIRMED SWINGS ONLY to maintain 0% repainting
  const alternatingSwings: StructuralSwing[] = [];
  for (const s of confirmedRawSwings) {
    if (alternatingSwings.length === 0) {
      alternatingSwings.push(s);
      continue;
    }
    
    const last = alternatingSwings[alternatingSwings.length - 1];
    if (last.type === s.type) {
      // Consecutive peaks of the same type: retain only the highest peak / lowest valley
      if (s.type === 'HIGH') {
        if (s.price > last.price) {
          alternatingSwings[alternatingSwings.length - 1] = s;
        }
      } else {
        if (s.price < last.price) {
          alternatingSwings[alternatingSwings.length - 1] = s;
        }
      }
    } else {
      alternatingSwings.push(s);
    }
  }

  // ─── Parent-Child Wave Containment Tagging ON CONFIRMED SWINGS ONLY ───
  let currentMajorHigh = (globalAnchors && typeof globalAnchors.high === 'number') ? globalAnchors.high : -Infinity;
  let currentMajorLow = (globalAnchors && typeof globalAnchors.low === 'number') ? globalAnchors.low : Infinity;

  const markedConfirmedSwings = alternatingSwings.map((s) => {
    let structure_type: 'MAJOR' | 'INTERNAL' = 'MAJOR';

    // For 3-bar (INNER) sub-waves, we treat all of them as INTERNAL to separate them cleanly.
    if (volMultiplier < 2.0) {
      return { ...s, structure_type: 'INTERNAL' as const };
    }

    let isAnchor = false;
    if (globalAnchors) {
      if (s.type === 'HIGH' && globalAnchors.anchor_high_swing && s.t === globalAnchors.anchor_high_swing.t) {
        isAnchor = true;
      }
      if (s.type === 'LOW' && globalAnchors.anchor_low_swing && s.t === globalAnchors.anchor_low_swing.t) {
        isAnchor = true;
      }
    }

    if (isAnchor) {
      structure_type = 'MAJOR';
      if (s.type === 'HIGH') {
        currentMajorHigh = s.price;
      } else {
        currentMajorLow = s.price;
      }
      return { ...s, structure_type };
    }

    if (currentMajorHigh === -Infinity || currentMajorLow === Infinity) {
      if (s.type === 'HIGH') {
        currentMajorHigh = s.price;
      } else {
        currentMajorLow = s.price;
      }
      return { ...s, structure_type };
    }

    // Containment Rule: Formed entirely within the active Major Range
    if (s.price >= currentMajorLow && s.price <= currentMajorHigh) {
      structure_type = 'INTERNAL';
    } else {
      structure_type = 'MAJOR';
      if (s.type === 'HIGH' && s.price > currentMajorHigh) {
        currentMajorHigh = s.price;
      } else if (s.type === 'LOW' && s.price < currentMajorLow) {
        currentMajorLow = s.price;
      }
    }

    return { ...s, structure_type };
  });

  // Filter out INTERNAL swings from Major wave trend logic, Zig-Zag lines, and Dealing Ranges
  // BUT for 3-bar inner waves (volMultiplier < 2.0), we analyze all of its swings to compute the sub-trend and sub-zigzag path.
  const majorSwingsOnly = volMultiplier < 2.0
    ? markedConfirmedSwings
    : markedConfirmedSwings.filter(s => s.structure_type === 'MAJOR');
  
  // 3. Build Zig-Zag Segments & Track Trend State Machine ON CONFIRMED SWINGS ONLY
  const zigzagSegments: ZigZagSegment[] = [];
  let trend: 'BULLISH' | 'BEARISH' | 'UNSET' = 'UNSET';
  let latestMSS: ZigZagSegment | null = null;
  
  const isDisplacementActive = displacementStatus !== null &&
    displacementStatus !== undefined &&
    displacementStatus.status !== 'INACTIVE' &&
    displacementStatus.status !== 'CONSOLIDATION';
    
  for (let i = 0; i < majorSwingsOnly.length - 1; i++) {
    const from = majorSwingsOnly[i];
    const to = majorSwingsOnly[i + 1];
    const trendBefore = trend;
    let label: 'BOS' | 'MSS' | 'INTERNAL' = 'INTERNAL';
    let trendAfter: 'BULLISH' | 'BEARISH' | 'UNSET' = trend;
    
    if (to.type === 'HIGH') {
      const priorHigh = i >= 1 ? majorSwingsOnly[i - 1] : null;
      if (priorHigh && to.price > priorHigh.price) {
        if (trend === 'BULLISH') {
          label = 'BOS';
          trendAfter = 'BULLISH';
        } else if (trend === 'BEARISH') {
          label = 'MSS';
          trendAfter = 'BULLISH';
        } else {
          trendAfter = 'BULLISH';
        }
      } else if (trend === 'UNSET') {
        trendAfter = 'BULLISH';
      }
    } else {
      // to.type === 'LOW'
      const priorLow = i >= 1 ? majorSwingsOnly[i - 1] : null;
      if (priorLow && to.price < priorLow.price) {
        if (trend === 'BEARISH') {
          label = 'BOS';
          trendAfter = 'BEARISH';
        } else if (trend === 'BULLISH') {
          label = 'MSS';
          trendAfter = 'BEARISH';
        } else {
          trendAfter = 'BEARISH';
        }
      } else if (trend === 'UNSET') {
        trendAfter = 'BEARISH';
      }
    }
    
    trend = trendAfter;
    
    const segment: ZigZagSegment = {
      from,
      to,
      label,
      trendBefore,
      trendAfter,
      displacementConfirmed: label === 'MSS' && isDisplacementActive
    };
    
    zigzagSegments.push(segment);
    if (label === 'MSS') {
      latestMSS = segment;
    }
  }

  // 3b. Mandate Task 1: Build Internal Zig-Zag Segments & Track Internal Trend State Machine ON CONFIRMED INTERNAL SWINGS ONLY
  const internalZigzagSegments: ZigZagSegment[] = [];
  let internalTrend: 'BULLISH' | 'BEARISH' | 'UNSET' = 'UNSET';
  let latestInternalMSS: ZigZagSegment | null = null;

  const internalSwingsOnly = markedConfirmedSwings.filter(s => s.structure_type === 'INTERNAL');
  const majorMssTimes = zigzagSegments
    .filter(seg => seg.label === 'MSS')
    .map(seg => seg.to.t);

  for (let i = 0; i < internalSwingsOnly.length - 1; i++) {
    const from = internalSwingsOnly[i];
    const to = internalSwingsOnly[i + 1];

    // Reset internal trend state if a Major MSS occurred in between to maintain hierarchical synchronization
    const hasMajorMssBetween = majorMssTimes.some(t => t > from.t && t <= to.t);
    if (hasMajorMssBetween) {
      internalTrend = 'UNSET';
    }

    const trendBefore = internalTrend;
    let label: 'BOS' | 'MSS' | 'INTERNAL' = 'INTERNAL';
    let trendAfter: 'BULLISH' | 'BEARISH' | 'UNSET' = internalTrend;

    if (to.type === 'HIGH') {
      const priorHighs = internalSwingsOnly
        .slice(0, i + 1)
        .filter(s => s.type === 'HIGH' && (!hasMajorMssBetween || s.t > Math.max(...majorMssTimes.filter(t => t <= to.t))));
      const priorHigh = priorHighs.length > 0 ? priorHighs[priorHighs.length - 1] : null;

      if (priorHigh && to.price > priorHigh.price) {
        if (internalTrend === 'BULLISH') {
          label = 'BOS';
          trendAfter = 'BULLISH';
        } else if (internalTrend === 'BEARISH') {
          label = 'MSS';
          trendAfter = 'BULLISH';
        } else {
          trendAfter = 'BULLISH';
        }
      } else if (internalTrend === 'UNSET') {
        trendAfter = 'BULLISH';
      }
    } else {
      // to.type === 'LOW'
      const priorLows = internalSwingsOnly
        .slice(0, i + 1)
        .filter(s => s.type === 'LOW' && (!hasMajorMssBetween || s.t > Math.max(...majorMssTimes.filter(t => t <= to.t))));
      const priorLow = priorLows.length > 0 ? priorLows[priorLows.length - 1] : null;

      if (priorLow && to.price < priorLow.price) {
        if (internalTrend === 'BEARISH') {
          label = 'BOS';
          trendAfter = 'BEARISH';
        } else if (internalTrend === 'BULLISH') {
          label = 'MSS';
          trendAfter = 'BEARISH';
        } else {
          trendAfter = 'BEARISH';
        }
      } else if (internalTrend === 'UNSET') {
        trendAfter = 'BEARISH';
      }
    }

    internalTrend = trendAfter;

    const segment: ZigZagSegment = {
      from,
      to,
      label,
      trendBefore,
      trendAfter,
      displacementConfirmed: label === 'MSS' && isDisplacementActive
    };

    internalZigzagSegments.push(segment);
    if (label === 'MSS') {
      latestInternalMSS = segment;
    }
  }
  
  // 4. Determine structural dealing range anchored strictly on confirmed major structural pivots
  let dealingRange: StructuralDealingRange;
  const majorHighs = majorSwingsOnly.filter(s => s.type === 'HIGH');
  const majorLows = majorSwingsOnly.filter(s => s.type === 'LOW');
  
  if (globalAnchors && typeof globalAnchors.high === 'number' && typeof globalAnchors.low === 'number') {
    let highVal = globalAnchors.high;
    let lowVal = globalAnchors.low;
    let localHighAnchor = globalAnchors.anchor_high_swing;
    let localLowAnchor = globalAnchors.anchor_low_swing;

    if (majorHighs.length > 0) {
      const lastHigh = majorHighs[majorHighs.length - 1];
      if (!globalAnchors.anchor_high_swing || lastHigh.t > globalAnchors.anchor_high_swing.t || lastHigh.price > globalAnchors.high) {
        highVal = parseFloat(lastHigh.price.toFixed(2));
        localHighAnchor = lastHigh;
      }
    }
    if (majorLows.length > 0) {
      const lastLow = majorLows[majorLows.length - 1];
      if (!globalAnchors.anchor_low_swing || lastLow.t > globalAnchors.anchor_low_swing.t || lastLow.price < globalAnchors.low) {
        lowVal = parseFloat(lastLow.price.toFixed(2));
        localLowAnchor = lastLow;
      }
    }

    const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));
    dealingRange = {
      high: highVal,
      low: lowVal,
      equilibrium: eqVal,
      current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
      anchor_high_swing: localHighAnchor,
      anchor_low_swing: localLowAnchor
    };
  } else if (majorHighs.length > 0 && majorLows.length > 0) {
    const lastHigh = majorHighs[majorHighs.length - 1];
    const lastLow = majorLows[majorLows.length - 1];
    const highVal = parseFloat(lastHigh.price.toFixed(2));
    const lowVal = parseFloat(lastLow.price.toFixed(2));
    const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));
    
    dealingRange = {
      high: highVal,
      low: lowVal,
      equilibrium: eqVal,
      current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
      anchor_high_swing: lastHigh,
      anchor_low_swing: lastLow
    };
  } else {
    const highVal = candles.length > 0 ? Math.max(...candles.map(c => c.h)) : 0;
    const lowVal = candles.length > 0 ? Math.min(...candles.map(c => c.l)) : 0;
    const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));
    dealingRange = {
      high: highVal,
      low: lowVal,
      equilibrium: eqVal,
      current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
      anchor_high_swing: null,
      anchor_low_swing: null
    };
  }
  
  // Determine structural internal dealing range anchored strictly on confirmed internal structural pivots
  let internalDealingRange: StructuralDealingRange;
  const internalHighs = internalSwingsOnly.filter(s => s.type === 'HIGH');
  const internalLows = internalSwingsOnly.filter(s => s.type === 'LOW');

  if (internalHighs.length > 0 && internalLows.length > 0) {
    const lastHigh = internalHighs[internalHighs.length - 1];
    const lastLow = internalLows[internalLows.length - 1];
    const highVal = parseFloat(lastHigh.price.toFixed(2));
    const lowVal = parseFloat(lastLow.price.toFixed(2));
    const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));
    
    internalDealingRange = {
      high: highVal,
      low: lowVal,
      equilibrium: eqVal,
      current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
      anchor_high_swing: lastHigh,
      anchor_low_swing: lastLow
    };
  } else {
    // Fallback if no internal swings yet: use standard local extremes
    const highVal = candles.length > 0 ? Math.max(...candles.map(c => c.h)) : 0;
    const lowVal = candles.length > 0 ? Math.min(...candles.map(c => c.l)) : 0;
    const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));
    internalDealingRange = {
      high: highVal,
      low: lowVal,
      equilibrium: eqVal,
      current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
      anchor_high_swing: null,
      anchor_low_swing: null
    };
  }

  const hasConfirmedMSS = latestMSS !== null && latestMSS.displacementConfirmed;

  // Stitch unconfirmed raw swings back into the returned swings array strictly for visualization/display
  const returnedSwings = [...markedConfirmedSwings];
  unconfirmedRawSwings.forEach(s => {
    let structure_type: 'MAJOR' | 'INTERNAL' = 'MAJOR';
    if (volMultiplier < 2.0) {
      structure_type = 'INTERNAL';
    } else if (currentMajorHigh !== -Infinity && currentMajorLow !== Infinity) {
      if (s.price >= currentMajorLow && s.price <= currentMajorHigh) {
        structure_type = 'INTERNAL';
      }
    }
    returnedSwings.push({
      ...s,
      structure_type
    });
  });
  returnedSwings.sort((a, b) => a.t - b.t);
  
  return {
    swings: returnedSwings, // Return combined swings (marked with confirmed: true/false) for display
    zigzag: zigzagSegments,
    dealingRange,
    trend,
    latestMSS,
    market_structure_shift: hasConfirmedMSS,
    // Mandate V10.34 additions:
    internalTrend,
    internalZigzag: internalZigzagSegments,
    latestInternalMSS,
    internal_market_structure_shift: latestInternalMSS !== null,
    internalDealingRange
  };
}

/**
 * Performs a complete Market Structure Analysis on the given candle series
 * using the Equilibrium-Based Dealing Range Re-Pricing Model.
 *
 * This is the SINGLE ENTRY POINT for all structural calculations.
 *
 * @param candles - The OHLCV candle series (typically 15m for intraday analysis).
 * @param currentPrice - The latest live/replayed price for premium/discount math.
 * @param displacementStatus - Optional: current displacement sponsorship state.
 * @param contextAnchorTimestamp - Optional: stable lookback anchor to prevent re-calculation drift.
 */
export function analyzeMarketStructure(
  candles: Candle[],
  currentPrice: number,
  displacementStatus?: InstitutionalSponsorship | null,
  contextAnchorTimestamp?: number | null,
  globalAnchors?: any | null
): MarketStructureAnalysis {
  if (candles.length === 0) {
    return {
      swings: [],
      zigzag: [],
      dealingRange: { high: 0, low: 0, equilibrium: 0, current_status: 'DISCOUNT', anchor_high_swing: null, anchor_low_swing: null },
      currentTrend: 'UNSET',
      latestMSS: null,
      market_structure_shift: false,
      market_structure_shift_direction: null,
    };
  }

  // 1. Run full historical state machine for both Major and Inner
  const majorFull = runEquilibriumStateMachine(candles, currentPrice, displacementStatus, 2.0, 0, globalAnchors);
  const innerFull = runEquilibriumStateMachine(candles, currentPrice, displacementStatus, 1.0, 0, globalAnchors);

  // ─── Velocity-Based Momentum Override ───
  let expansion_mode: 'NORMAL' | 'RUNAWAY' = 'NORMAL';
  let market_velocity = 0;
  let runaway_origin_price: number | null = null;

  const dispActive = displacementStatus !== null && displacementStatus !== undefined && displacementStatus.status.includes('ACTIVE');
  const dispMult = displacementStatus?.anomaly_multiplier || 0;

  if (dispActive && dispMult > 4.0) {
    const dispDir = displacementStatus?.status.includes('BULLISH') ? 'BULLISH' : 'BEARISH';
    // Count active unmitigated FVGs in the dominant direction on the active timeframe (which matches candles)
    const fvgs = detectActiveFVGs(candles, true);
    const matchingFvgs = fvgs.filter((f: any) => f.type === (dispDir === 'BULLISH' ? 'BISI' : 'SIBI'));
    market_velocity = matchingFvgs.length;

    if (market_velocity >= 2) {
      expansion_mode = 'RUNAWAY';
      // Find oldest FVG in matchingFvgs to establish the Origin Low/High
      if (matchingFvgs.length > 0) {
        const oldestFvg = matchingFvgs.reduce((oldest: any, fvg: any) => fvg.origin_time < oldest.origin_time ? fvg : oldest, matchingFvgs[0]);
        const originCandle = candles.find(c => c.t === oldestFvg.origin_time);
        if (originCandle) {
          runaway_origin_price = dispDir === 'BULLISH' ? originCandle.l : originCandle.h;
        }
      }
    }
  }

  // If no anchor timestamp is provided, or all candles are older than the anchor, return the full run
  if (!contextAnchorTimestamp || candles[0].t >= contextAnchorTimestamp) {
    // Combine both sets of swings for visual display
    const combinedSwings: StructuralSwing[] = [...majorFull.swings];
    const majorTimes = new Set(majorFull.swings.map(s => s.t));
    
    innerFull.swings.forEach(s => {
      if (!majorTimes.has(s.t)) {
        combinedSwings.push({ ...s, grade: 'INNER' });
      }
    });
    combinedSwings.sort((a, b) => a.t - b.t);

    let finalTrend: 'BULLISH' | 'BEARISH' | 'UNSET' = majorFull.trend;
    let finalExpansionMode = expansion_mode;
    if (expansion_mode === 'RUNAWAY' && runaway_origin_price !== null) {
      const dispDir = displacementStatus?.status.includes('BULLISH') ? 'BULLISH' : 'BEARISH';
      if (dispDir === 'BULLISH') {
        if (currentPrice >= runaway_origin_price) {
          finalTrend = 'BULLISH';
        } else {
          finalExpansionMode = 'NORMAL';
        }
      } else {
        if (currentPrice <= runaway_origin_price) {
          finalTrend = 'BEARISH';
        } else {
          finalExpansionMode = 'NORMAL';
        }
      }
    }

    return {
      swings: combinedSwings,
      zigzag: majorFull.zigzag,
      dealingRange: majorFull.dealingRange,
      currentTrend: finalTrend,
      subTrend: innerFull.trend,
      latestMSS: majorFull.latestMSS,
      market_structure_shift: majorFull.market_structure_shift,
      market_structure_shift_direction: majorFull.market_structure_shift
        ? majorFull.latestMSS!.trendAfter === 'UNSET' ? null : majorFull.latestMSS!.trendAfter
        : null,
      innerZigzag: innerFull.zigzag,
      innerSwings: innerFull.swings,
      expansion_mode: finalExpansionMode,
      market_velocity,
      runaway_origin_price,
      // Mandate V10.34 additions:
      internalTrend: majorFull.internalTrend,
      internalZigzag: majorFull.internalZigzag,
      latestInternalMSS: majorFull.latestInternalMSS,
      internal_market_structure_shift: majorFull.internal_market_structure_shift,
      internalDealingRange: majorFull.internalDealingRange
    };
  }

  // 2. Filter candles to those >= contextAnchorTimestamp
  const postCandles = candles.filter(c => c.t >= contextAnchorTimestamp);
  
  if (postCandles.length === 0) {
    // Fallback if filtering returns empty
    const combinedSwings: StructuralSwing[] = [...majorFull.swings];
    const majorTimes = new Set(majorFull.swings.map(s => s.t));
    innerFull.swings.forEach(s => {
      if (!majorTimes.has(s.t)) combinedSwings.push({ ...s, grade: 'INNER' });
    });
    combinedSwings.sort((a, b) => a.t - b.t);

    let finalTrend: 'BULLISH' | 'BEARISH' | 'UNSET' = majorFull.trend;
    let finalExpansionMode = expansion_mode;
    if (expansion_mode === 'RUNAWAY' && runaway_origin_price !== null) {
      const dispDir = displacementStatus?.status.includes('BULLISH') ? 'BULLISH' : 'BEARISH';
      if (dispDir === 'BULLISH') {
        if (currentPrice >= runaway_origin_price) {
          finalTrend = 'BULLISH';
        } else {
          finalExpansionMode = 'NORMAL';
        }
      } else {
        if (currentPrice <= runaway_origin_price) {
          finalTrend = 'BEARISH';
        } else {
          finalExpansionMode = 'NORMAL';
        }
      }
    }

    return {
      swings: combinedSwings,
      zigzag: majorFull.zigzag,
      dealingRange: majorFull.dealingRange,
      currentTrend: finalTrend,
      latestMSS: majorFull.latestMSS,
      market_structure_shift: majorFull.market_structure_shift,
      market_structure_shift_direction: majorFull.market_structure_shift
        ? majorFull.latestMSS!.trendAfter === 'UNSET' ? null : majorFull.latestMSS!.trendAfter
        : null,
      innerZigzag: innerFull.zigzag,
      innerSwings: innerFull.swings,
      expansion_mode: finalExpansionMode,
      market_velocity,
      runaway_origin_price,
      internalTrend: majorFull.internalTrend,
      internalZigzag: majorFull.internalZigzag,
      latestInternalMSS: majorFull.latestInternalMSS,
      internal_market_structure_shift: majorFull.internal_market_structure_shift,
      internalDealingRange: majorFull.internalDealingRange
    };
  }

  // 3. Run state machine strictly on the stabilized post-anchor candles
  const postAnchorIndexOffset = candles.findIndex(c => c.t >= contextAnchorTimestamp);
  const offsetToUse = postAnchorIndexOffset !== -1 ? postAnchorIndexOffset : 0;
  const majorPost = runEquilibriumStateMachine(postCandles, currentPrice, displacementStatus, 2.0, offsetToUse, globalAnchors);
  const innerPost = runEquilibriumStateMachine(postCandles, currentPrice, displacementStatus, 1.0, offsetToUse, globalAnchors);

  // 4. Stitch Swings
  // Swings with t < contextAnchorTimestamp are taken from full historical run.
  // Swings with t >= contextAnchorTimestamp are taken from post-anchor stabilized run.
  const majorSwingsPre = majorFull.swings.filter(s => s.t < contextAnchorTimestamp);
  const majorSwingsPost = majorPost.swings.filter(s => s.t >= contextAnchorTimestamp);
  const majorSwingsCombined = [...majorSwingsPre, ...majorSwingsPost].sort((a, b) => a.t - b.t);

  const innerSwingsPre = innerFull.swings.filter(s => s.t < contextAnchorTimestamp);
  const innerSwingsPost = innerPost.swings.filter(s => s.t >= contextAnchorTimestamp);
  const innerSwingsCombined = [...innerSwingsPre, ...innerSwingsPost].sort((a, b) => a.t - b.t);

  // Combine both sets of swings for visual display
  const combinedSwings: StructuralSwing[] = [...majorSwingsCombined];
  const majorTimes = new Set(majorSwingsCombined.map(s => s.t));
  innerSwingsCombined.forEach(s => {
    if (!majorTimes.has(s.t)) {
      combinedSwings.push({ ...s, grade: 'INNER' });
    }
  });
  combinedSwings.sort((a, b) => a.t - b.t);

  // 5. Stitch ZigZag Segments
  const stitchZigZag = (
    fullSegs: ZigZagSegment[],
    postSegs: ZigZagSegment[],
    fullSwings: StructuralSwing[],
    postSwings: StructuralSwing[]
  ): ZigZagSegment[] => {
    const postSwingsActual = postSwings.filter(s => s.t >= contextAnchorTimestamp);
    if (postSwingsActual.length === 0) return fullSegs;
    
    const firstPostSwing = postSwingsActual[0];
    
    // Filter full segments to those completed before the first post-anchor swing
    const preSegs = fullSegs.filter(s => s.to.t < firstPostSwing.t);
    const preSwingsBefore = fullSwings.filter(s => s.t < firstPostSwing.t);
    
    const stitched = [...preSegs];
    
    if (preSwingsBefore.length > 0) {
      const lastPreSwing = preSwingsBefore[preSwingsBefore.length - 1];
      if (lastPreSwing.type !== firstPostSwing.type) {
        stitched.push({
          from: lastPreSwing,
          to: firstPostSwing,
          label: 'INTERNAL',
          trendBefore: 'UNSET',
          trendAfter: 'UNSET',
          displacementConfirmed: false
        });
      }
    }
    
    const postSegsFiltered = postSegs.filter(s => s.from.t >= contextAnchorTimestamp || s.to.t >= contextAnchorTimestamp);
    return [...stitched, ...postSegsFiltered];
  };

  const zigzagStitched = stitchZigZag(majorFull.zigzag, majorPost.zigzag, majorFull.swings, majorPost.swings);
  const innerZigzagStitched = stitchZigZag(innerFull.zigzag, innerPost.zigzag, innerFull.swings, innerPost.swings);

  let finalTrend: 'BULLISH' | 'BEARISH' | 'UNSET' = majorPost.trend;
  let finalExpansionMode = expansion_mode;
  if (expansion_mode === 'RUNAWAY' && runaway_origin_price !== null) {
    const dispDir = displacementStatus?.status.includes('BULLISH') ? 'BULLISH' : 'BEARISH';
    if (dispDir === 'BULLISH') {
      if (currentPrice >= runaway_origin_price) {
        finalTrend = 'BULLISH';
      } else {
        finalExpansionMode = 'NORMAL';
      }
    } else {
      if (currentPrice <= runaway_origin_price) {
        finalTrend = 'BEARISH';
      } else {
        finalExpansionMode = 'NORMAL';
      }
    }
  }

  // The active dealing range, trend, and MSS metrics are strictly taken from the stabilized post-anchor run
  return {
    swings: combinedSwings,
    zigzag: zigzagStitched,
    dealingRange: majorPost.dealingRange,
    currentTrend: finalTrend,
    subTrend: innerPost.trend,
    latestMSS: majorPost.latestMSS,
    market_structure_shift: majorPost.market_structure_shift,
    market_structure_shift_direction: majorPost.market_structure_shift
      ? majorPost.latestMSS!.trendAfter === 'UNSET' ? null : majorPost.latestMSS!.trendAfter
      : null,
    innerZigzag: innerZigzagStitched,
    innerSwings: innerSwingsCombined,
    expansion_mode: finalExpansionMode,
    market_velocity,
    runaway_origin_price,
    // Mandate V10.34 additions:
    internalTrend: majorPost.internalTrend,
    internalZigzag: majorPost.internalZigzag,
    latestInternalMSS: majorPost.latestInternalMSS,
    internal_market_structure_shift: majorPost.internal_market_structure_shift,
    internalDealingRange: majorPost.internalDealingRange
  };
}

// ─── Stateful Caching Layer ───────────────────────────────────────────────────

// Persistent in-memory caches for accumulated candles, anchors, and calculations by symbol
const accumulatedCandlesCache = new Map<string, Candle[]>();
const contextAnchorCache = new Map<string, number>();

/**
 * Stateful structural analysis that accumulates a persistent candle buffer
 * to prevent slicing dependencies and lock historical anchors.
 *
 * @param symbol - The symbol identifier (e.g. 'ETHUSDC').
 * @param newCandles - The newly fetched visual candle slice.
 * @param currentPrice - The latest close/live price.
 * @param displacementStatus - Current displacement sponsorship status.
 * @param isInit - True if this is an initial 60-day buffer load.
 * @param globalAnchors - Optional global anchors from structural scan.
 */
export function analyzeMarketStructureStateful(
  symbol: string,
  interval: string,
  newCandles: Candle[],
  currentPrice: number,
  displacementStatus: InstitutionalSponsorship | null | undefined,
  isInit: boolean = false,
  globalAnchors?: any | null
): MarketStructureAnalysis {
  const cacheKey = `${symbol}_${interval}`;
  let accumulated = accumulatedCandlesCache.get(cacheKey) || [];

  if (isInit || accumulated.length === 0) {
    // Initial load: seed or overwrite cache with the full context buffer
    accumulated = [...newCandles].sort((a, b) => a.t - b.t);
  } else {
    // Incrementally append new candles, filtering out duplicates
    const existingIds = new Set(accumulated.map(c => c.t));
    const uniqueNew = newCandles.filter(c => !existingIds.has(c.t));
    accumulated = [...accumulated, ...uniqueNew].sort((a, b) => a.t - b.t);
  }

  // Cap accumulated buffer size to 10,000 candles to prevent visual memory leak
  if (accumulated.length > 10000) {
    accumulated = accumulated.slice(-10000);
  }

  accumulatedCandlesCache.set(cacheKey, accumulated);

  // Set context anchor if it's not established yet
  let anchor = contextAnchorCache.get(cacheKey) || null;
  if (anchor === null && accumulated.length > 0) {
    anchor = accumulated[0].t;
    contextAnchorCache.set(cacheKey, anchor);
    console.log(`[StatefulQuant] Established stable lookback context anchor for ${cacheKey} at:`, new Date(anchor).toISOString());
  }

  // Compute stabilized structure over full accumulated history
  return analyzeMarketStructure(accumulated, currentPrice, displacementStatus, anchor, globalAnchors);
}
