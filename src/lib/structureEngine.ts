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
  indexOffset: number = 0
) {
  // Running range state
  let range: {
    high: number;
    low: number;
    origin: number;
    type: 'BULLISH' | 'BEARISH';
    originT: number;
    extremeT: number;
    originIdx: number;
    extremeIdx: number;
  } | null = null;

  let trend: 'BULLISH' | 'BEARISH' | 'UNSET' = 'UNSET';
  let hasTappedEquilibrium = false;

  // Retracement extremes trackers
  let retracementExtreme = 0;
  let retracementExtremeT = 0;
  let retracementExtremeIdx = 0;

  // Alternating swing points & segments in the zig-zag
  const zigzagPoints: StructuralSwing[] = [];
  const zigzagSegments: ZigZagSegment[] = [];
  let latestMSS: ZigZagSegment | null = null;

  const isDisplacementActive = displacementStatus !== null &&
    displacementStatus !== undefined &&
    displacementStatus.status !== 'INACTIVE' &&
    displacementStatus.status !== 'CONSOLIDATION';

  // Process candles chronologically to build wave structure
  for (let i = 0; i < candles.length; i++) {
    const curr = candles[i];
    const disp = isDisplacementCandle(i, candles, volMultiplier);

    if (range === null) {
      // Look for the first displacement candle to anchor the initial range
      if (disp.active) {
        if (disp.direction === 'BULLISH') {
          range = {
            high: curr.h,
            low: curr.l,
            origin: curr.l,
            type: 'BULLISH',
            originT: curr.t,
            extremeT: curr.t,
            originIdx: i + indexOffset,
            extremeIdx: i + indexOffset,
          };
          trend = 'BULLISH';
          hasTappedEquilibrium = false;
          retracementExtreme = Infinity;
          retracementExtremeT = curr.t;
          retracementExtremeIdx = i + indexOffset;

          zigzagPoints.push({ t: curr.t, price: curr.l, type: 'LOW', grade: 'MAJOR', colorValidated: true, candle_index: i + indexOffset, timestamp: new Date(curr.t).toISOString() });
          zigzagPoints.push({ t: curr.t, price: curr.h, type: 'HIGH', grade: 'MAJOR', colorValidated: true, candle_index: i + indexOffset, timestamp: new Date(curr.t).toISOString() });
        } else if (disp.direction === 'BEARISH') {
          range = {
            high: curr.h,
            low: curr.l,
            origin: curr.h,
            type: 'BEARISH',
            originT: curr.t,
            extremeT: curr.t,
            originIdx: i + indexOffset,
            extremeIdx: i + indexOffset,
          };
          trend = 'BEARISH';
          hasTappedEquilibrium = false;
          retracementExtreme = -Infinity;
          retracementExtremeT = curr.t;
          retracementExtremeIdx = i + indexOffset;

          zigzagPoints.push({ t: curr.t, price: curr.h, type: 'HIGH', grade: 'MAJOR', colorValidated: true, candle_index: i + indexOffset, timestamp: new Date(curr.t).toISOString() });
          zigzagPoints.push({ t: curr.t, price: curr.l, type: 'LOW', grade: 'MAJOR', colorValidated: true, candle_index: i + indexOffset, timestamp: new Date(curr.t).toISOString() });
        }
      }
      continue;
    }

    // Evaluate active range
    const eq = (range.high + range.low) / 2;

    // Check if price retraces to or exceeds Equilibrium (0.50 level)
    if (!hasTappedEquilibrium) {
      if (range.type === 'BULLISH' && curr.l <= eq) {
        hasTappedEquilibrium = true;
        retracementExtreme = curr.l;
        retracementExtremeT = curr.t;
        retracementExtremeIdx = i + indexOffset;
      } else if (range.type === 'BEARISH' && curr.h >= eq) {
        hasTappedEquilibrium = true;
        retracementExtreme = curr.h;
        retracementExtremeT = curr.t;
      }
    } else {
      // Record the absolute deepest extreme of the retracement since the high/low was set
      if (range.type === 'BULLISH') {
        if (curr.l < retracementExtreme) {
          retracementExtreme = curr.l;
          retracementExtremeT = curr.t;
          retracementExtremeIdx = i + indexOffset;
        }
      } else {
        if (curr.h > retracementExtreme) {
          retracementExtreme = curr.h;
          retracementExtremeT = curr.t;
          retracementExtremeIdx = i + indexOffset;
        }
      }
    }

    // Wave Validation
    if (range.type === 'BULLISH') {
      // BOS (Trend Continuation): expands to break previous High
      if (hasTappedEquilibrium && curr.h > range.high) {
        const fromSwing = zigzagPoints[zigzagPoints.length - 1]; // Previous HIGH

        // Push the retracement LOW point
        const lowSwing: StructuralSwing = {
          t: retracementExtremeT,
          price: retracementExtreme,
          type: 'LOW',
          grade: 'MAJOR',
          colorValidated: true,
          candle_index: retracementExtremeIdx,
          timestamp: new Date(retracementExtremeT).toISOString()
        };
        zigzagPoints.push(lowSwing);

        // Push the new HIGH point
        const highSwing: StructuralSwing = {
          t: curr.t,
          price: curr.h,
          type: 'HIGH',
          grade: 'MAJOR',
          colorValidated: true,
          candle_index: i + indexOffset,
          timestamp: new Date(curr.t).toISOString()
        };
        zigzagPoints.push(highSwing);

        const segment: ZigZagSegment = {
          from: fromSwing,
          to: lowSwing,
          label: 'INTERNAL',
          trendBefore: trend,
          trendAfter: trend,
          displacementConfirmed: false
        };
        const activeSegment: ZigZagSegment = {
          from: lowSwing,
          to: highSwing,
          label: trend === 'BULLISH' ? 'BOS' : 'MSS',
          trendBefore: trend,
          trendAfter: 'BULLISH',
          displacementConfirmed: trend !== 'BULLISH' && (isDisplacementActive || (disp.active && disp.direction === 'BULLISH'))
        };

        zigzagSegments.push(segment);
        zigzagSegments.push(activeSegment);

        if (activeSegment.label === 'MSS') {
          latestMSS = activeSegment;
          trend = 'BULLISH';
        }

        // Establish new range
        range = {
          high: curr.h,
          low: retracementExtreme,
          origin: retracementExtreme,
          type: 'BULLISH',
          originT: retracementExtremeT,
          extremeT: curr.t,
          originIdx: retracementExtremeIdx,
          extremeIdx: i + indexOffset,
        };
        hasTappedEquilibrium = false;
        retracementExtreme = Infinity;
        retracementExtremeT = curr.t;
        retracementExtremeIdx = i + indexOffset;
      }
      // MSS (Trend Reversal): breaks the origin point (low)
      else if (hasTappedEquilibrium && curr.l < range.low) {
        const fromSwing = zigzagPoints[zigzagPoints.length - 1]; // Previous HIGH

        const highSwing: StructuralSwing = {
          t: range.extremeT,
          price: range.high,
          type: 'HIGH',
          grade: 'MAJOR',
          colorValidated: true,
          candle_index: range.extremeIdx,
          timestamp: new Date(range.extremeT).toISOString()
        };
        zigzagPoints.push(highSwing);

        const lowSwing: StructuralSwing = {
          t: curr.t,
          price: curr.l,
          type: 'LOW',
          grade: 'MAJOR',
          colorValidated: true,
          candle_index: i + indexOffset,
          timestamp: new Date(curr.t).toISOString()
        };
        zigzagPoints.push(lowSwing);

        const segment: ZigZagSegment = {
          from: fromSwing,
          to: highSwing,
          label: 'INTERNAL',
          trendBefore: trend,
          trendAfter: trend,
          displacementConfirmed: false
        };
        const activeSegment: ZigZagSegment = {
          from: highSwing,
          to: lowSwing,
          label: trend === 'BEARISH' ? 'BOS' : 'MSS',
          trendBefore: trend,
          trendAfter: 'BEARISH',
          displacementConfirmed: trend !== 'BEARISH' && (isDisplacementActive || (disp.active && disp.direction === 'BEARISH'))
        };

        zigzagSegments.push(segment);
        zigzagSegments.push(activeSegment);

        if (activeSegment.label === 'MSS') {
          latestMSS = activeSegment;
          trend = 'BEARISH';
        }

        // Establish new bearish range
        range = {
          high: range.high,
          low: curr.l,
          origin: range.high,
          type: 'BEARISH',
          originT: range.extremeT,
          extremeT: curr.t,
          originIdx: range.extremeIdx,
          extremeIdx: i + indexOffset,
        };
        hasTappedEquilibrium = false;
        retracementExtreme = -Infinity;
        retracementExtremeT = curr.t;
        retracementExtremeIdx = i + indexOffset;
      }
      // Absolute Extreme Tracking (shifts high on same-direction expansion)
      else if (curr.h > range.high) {
        range.high = curr.h;
        range.extremeT = curr.t;
        range.extremeIdx = i + indexOffset;
        // Shift last HIGH in structural swings list
        if (zigzagPoints.length > 0) {
          const lastIdx = zigzagPoints.map(p => p.type).lastIndexOf('HIGH');
          if (lastIdx !== -1) {
            zigzagPoints[lastIdx].price = curr.h;
            zigzagPoints[lastIdx].t = curr.t;
            zigzagPoints[lastIdx].candle_index = i + indexOffset;
            zigzagPoints[lastIdx].timestamp = new Date(curr.t).toISOString();
          }
        }
        retracementExtreme = Infinity;
        retracementExtremeT = curr.t;
        retracementExtremeIdx = i + indexOffset;
      }
    } else {
      // Bearish Range
      // BOS (Trend Continuation): expands to break previous Low
      if (hasTappedEquilibrium && curr.l < range.low) {
        const fromSwing = zigzagPoints[zigzagPoints.length - 1]; // Previous LOW

        // Push the retracement HIGH point
        const highSwing: StructuralSwing = {
          t: retracementExtremeT,
          price: retracementExtreme,
          type: 'HIGH',
          grade: 'MAJOR',
          colorValidated: true,
          candle_index: retracementExtremeIdx,
          timestamp: new Date(retracementExtremeT).toISOString()
        };
        zigzagPoints.push(highSwing);

        // Push the new LOW point
        const lowSwing: StructuralSwing = {
          t: curr.t,
          price: curr.l,
          type: 'LOW',
          grade: 'MAJOR',
          colorValidated: true,
          candle_index: i + indexOffset,
          timestamp: new Date(curr.t).toISOString()
        };
        zigzagPoints.push(lowSwing);

        const segment: ZigZagSegment = {
          from: fromSwing,
          to: highSwing,
          label: 'INTERNAL',
          trendBefore: trend,
          trendAfter: trend,
          displacementConfirmed: false
        };
        const activeSegment: ZigZagSegment = {
          from: highSwing,
          to: lowSwing,
          label: trend === 'BEARISH' ? 'BOS' : 'MSS',
          trendBefore: trend,
          trendAfter: 'BEARISH',
          displacementConfirmed: trend !== 'BEARISH' && (isDisplacementActive || (disp.active && disp.direction === 'BEARISH'))
        };

        zigzagSegments.push(segment);
        zigzagSegments.push(activeSegment);

        if (activeSegment.label === 'MSS') {
          latestMSS = activeSegment;
          trend = 'BEARISH';
        }

        // Establish new range
        range = {
          high: retracementExtreme,
          low: curr.l,
          origin: retracementExtreme,
          type: 'BEARISH',
          originT: retracementExtremeT,
          extremeT: curr.t,
          originIdx: retracementExtremeIdx,
          extremeIdx: i + indexOffset,
        };
        hasTappedEquilibrium = false;
        retracementExtreme = -Infinity;
        retracementExtremeT = curr.t;
        retracementExtremeIdx = i + indexOffset;
      }
      // MSS (Trend Reversal): breaks origin point (high)
      else if (hasTappedEquilibrium && curr.h > range.high) {
        const fromSwing = zigzagPoints[zigzagPoints.length - 1]; // Previous LOW

        const lowSwing: StructuralSwing = {
          t: range.extremeT,
          price: range.low,
          type: 'LOW',
          grade: 'MAJOR',
          colorValidated: true,
          candle_index: range.extremeIdx,
          timestamp: new Date(range.extremeT).toISOString()
        };
        zigzagPoints.push(lowSwing);

        const highSwing: StructuralSwing = {
          t: curr.t,
          price: curr.h,
          type: 'HIGH',
          grade: 'MAJOR',
          colorValidated: true,
          candle_index: i + indexOffset,
          timestamp: new Date(curr.t).toISOString()
        };
        zigzagPoints.push(highSwing);

        const segment: ZigZagSegment = {
          from: fromSwing,
          to: lowSwing,
          label: 'INTERNAL',
          trendBefore: trend,
          trendAfter: trend,
          displacementConfirmed: false
        };
        const activeSegment: ZigZagSegment = {
          from: lowSwing,
          to: highSwing,
          label: trend === 'BULLISH' ? 'BOS' : 'MSS',
          trendBefore: trend,
          trendAfter: 'BULLISH',
          displacementConfirmed: trend !== 'BULLISH' && (isDisplacementActive || (disp.active && disp.direction === 'BULLISH'))
        };

        zigzagSegments.push(segment);
        zigzagSegments.push(activeSegment);

        if (activeSegment.label === 'MSS') {
          latestMSS = activeSegment;
          trend = 'BULLISH';
        }

        // Establish new bullish range
        range = {
          high: curr.h,
          low: range.low,
          origin: range.low,
          type: 'BULLISH',
          originT: range.extremeT,
          extremeT: curr.t,
          originIdx: range.extremeIdx,
          extremeIdx: i + indexOffset,
        };
        hasTappedEquilibrium = false;
        retracementExtreme = Infinity;
        retracementExtremeT = curr.t;
        retracementExtremeIdx = i + indexOffset;
      }
      // Absolute Extreme Tracking (shifts low on same-direction expansion)
      else if (curr.l < range.low) {
        range.low = curr.l;
        range.extremeT = curr.t;
        range.extremeIdx = i + indexOffset;
        // Shift last LOW in structural swings list
        if (zigzagPoints.length > 0) {
          const lastIdx = zigzagPoints.map(p => p.type).lastIndexOf('LOW');
          if (lastIdx !== -1) {
            zigzagPoints[lastIdx].price = curr.l;
            zigzagPoints[lastIdx].t = curr.t;
            zigzagPoints[lastIdx].candle_index = i + indexOffset;
            zigzagPoints[lastIdx].timestamp = new Date(curr.t).toISOString();
          }
        }
        retracementExtreme = -Infinity;
        retracementExtremeT = curr.t;
        retracementExtremeIdx = i + indexOffset;
      }
    }
  }

  // Determine structural dealing range
  let dealingRange: StructuralDealingRange;
  if (range !== null) {
    const highVal = parseFloat(range.high.toFixed(2));
    const lowVal = parseFloat(range.low.toFixed(2));
    const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));

    const anchorHigh: StructuralSwing = {
      t: range.type === 'BULLISH' ? range.extremeT : range.originT,
      price: highVal,
      type: 'HIGH',
      grade: 'MAJOR',
      colorValidated: true,
      candle_index: range.type === 'BULLISH' ? range.extremeIdx : range.originIdx,
      timestamp: new Date(range.type === 'BULLISH' ? range.extremeT : range.originT).toISOString()
    };
    const anchorLow: StructuralSwing = {
      t: range.type === 'BULLISH' ? range.originT : range.extremeT,
      price: lowVal,
      type: 'LOW',
      grade: 'MAJOR',
      colorValidated: true,
      candle_index: range.type === 'BULLISH' ? range.originIdx : range.extremeIdx,
      timestamp: new Date(range.type === 'BULLISH' ? range.originT : range.extremeT).toISOString()
    };

    dealingRange = {
      high: highVal,
      low: lowVal,
      equilibrium: eqVal,
      current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
      anchor_high_swing: anchorHigh,
      anchor_low_swing: anchorLow,
    };
  } else {
    const highVal = Math.max(...candles.map(c => c.h));
    const lowVal = Math.min(...candles.map(c => c.l));
    const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));
    dealingRange = {
      high: highVal,
      low: lowVal,
      equilibrium: eqVal,
      current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
      anchor_high_swing: null,
      anchor_low_swing: null,
    };
  }

  const hasConfirmedMSS = latestMSS !== null && latestMSS.displacementConfirmed;

  // Collapse consecutive duplicate swing types for clean rendering
  const collapsedSwings: StructuralSwing[] = [];
  for (const pt of zigzagPoints) {
    if (collapsedSwings.length === 0) {
      collapsedSwings.push(pt);
      continue;
    }
    const last = collapsedSwings[collapsedSwings.length - 1];
    if (last.type === pt.type) {
      if (pt.type === 'HIGH' && pt.price > last.price) {
        collapsedSwings[collapsedSwings.length - 1] = pt;
      } else if (pt.type === 'LOW' && pt.price < last.price) {
        collapsedSwings[collapsedSwings.length - 1] = pt;
      }
    } else {
      collapsedSwings.push(pt);
    }
  }

  collapsedSwings.forEach(s => {
    s.grade = volMultiplier >= 2.0 ? 'MAJOR' : 'INNER';
    s.colorValidated = true;
  });

  return {
    swings: collapsedSwings,
    zigzag: zigzagSegments,
    dealingRange,
    trend,
    latestMSS,
    market_structure_shift: hasConfirmedMSS,
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
  contextAnchorTimestamp?: number | null
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
  const majorFull = runEquilibriumStateMachine(candles, currentPrice, displacementStatus, 2.0);
  const innerFull = runEquilibriumStateMachine(candles, currentPrice, displacementStatus, 1.0);

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

    return {
      swings: combinedSwings,
      zigzag: majorFull.zigzag,
      dealingRange: majorFull.dealingRange,
      currentTrend: majorFull.trend !== 'UNSET' ? majorFull.trend : 'UNSET',
      latestMSS: majorFull.latestMSS,
      market_structure_shift: majorFull.market_structure_shift,
      market_structure_shift_direction: majorFull.market_structure_shift
        ? majorFull.latestMSS!.trendAfter === 'UNSET' ? null : majorFull.latestMSS!.trendAfter
        : null,
      innerZigzag: innerFull.zigzag,
      innerSwings: innerFull.swings,
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
    return {
      swings: combinedSwings,
      zigzag: majorFull.zigzag,
      dealingRange: majorFull.dealingRange,
      currentTrend: majorFull.trend !== 'UNSET' ? majorFull.trend : 'UNSET',
      latestMSS: majorFull.latestMSS,
      market_structure_shift: majorFull.market_structure_shift,
      market_structure_shift_direction: majorFull.market_structure_shift
        ? majorFull.latestMSS!.trendAfter === 'UNSET' ? null : majorFull.latestMSS!.trendAfter
        : null,
      innerZigzag: innerFull.zigzag,
      innerSwings: innerFull.swings,
    };
  }

  // 3. Run state machine strictly on the stabilized post-anchor candles
  const postAnchorIndexOffset = candles.findIndex(c => c.t >= contextAnchorTimestamp);
  const offsetToUse = postAnchorIndexOffset !== -1 ? postAnchorIndexOffset : 0;
  const majorPost = runEquilibriumStateMachine(postCandles, currentPrice, displacementStatus, 2.0, offsetToUse);
  const innerPost = runEquilibriumStateMachine(postCandles, currentPrice, displacementStatus, 1.0, offsetToUse);

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

  // The active dealing range, trend, and MSS metrics are strictly taken from the stabilized post-anchor run
  return {
    swings: combinedSwings,
    zigzag: zigzagStitched,
    dealingRange: majorPost.dealingRange,
    currentTrend: majorPost.trend !== 'UNSET' ? majorPost.trend : 'UNSET',
    latestMSS: majorPost.latestMSS,
    market_structure_shift: majorPost.market_structure_shift,
    market_structure_shift_direction: majorPost.market_structure_shift
      ? majorPost.latestMSS!.trendAfter === 'UNSET' ? null : majorPost.latestMSS!.trendAfter
      : null,
    innerZigzag: innerZigzagStitched,
    innerSwings: innerSwingsCombined,
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
 */
export function analyzeMarketStructureStateful(
  symbol: string,
  interval: string,
  newCandles: Candle[],
  currentPrice: number,
  displacementStatus: InstitutionalSponsorship | null | undefined,
  isInit: boolean = false
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
  return analyzeMarketStructure(accumulated, currentPrice, displacementStatus, anchor);
}
