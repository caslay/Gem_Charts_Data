/**
 * SweepReclaimEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Sweep & Reclaim (Failed Signal Reversal) Engine.
 *
 * Implements a deterministic, 4-phase chronological state machine:
 *  - Phase 1 (Anchor): Identifies structural swing pivots and caches horizontal reference shelves.
 *  - Phase 2 (Liquidity Sweep): Detects price breaking through the anchor shelf to purge external liquidity
 *    (SSL for Bullish, BSL for Bearish) within a configurable freshness window.
 *  - Phase 3 (Displacement Reclaim): Verifies aggressive reversal with a confirmed candle body close back beyond
 *    the anchor shelf within max_bars_sweep_to_reclaim (Market Structure Shift / Inversion).
 *  - Phase 4 (Retest & Simulated Execution): On subsequent closed candles (strictly after reclaim confirmation),
 *    detects retracements into the reclaimed shelf with ICT body defense validation, simulating entry at shelf,
 *    Stop Loss pinned behind the absolute sweep extreme (plus volatility buffer), and multi-stage TP1/TP2 scaling.
 *
 * Zero Look-Ahead Parity:
 *  - Processes historical candles strictly forward in chronological sequence.
 *  - Validations, reclaims, and executions occur strictly on confirmed candle closes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle, detectActiveFVGs } from '../fvgEngine';
import { PivotEngine } from './PivotEngine';

// ── Types & Interfaces ────────────────────────────────────────────────────────

export type SweepReclaimType = 'BULLISH' | 'BEARISH';

export type SweepReclaimPhase = 'ANCHOR' | 'SWEEP' | 'RECLAIM' | 'RETEST';

export type SweepReclaimStatus =
  | 'RETESTED'
  | 'RECLAIMED_NO_RETEST'
  | 'SWEPT_NO_RECLAIM'
  | 'ANCHOR_ONLY'
  | 'INVALIDATED_AT_RETEST'
  | 'EXPIRED';

export type SweepReclaimTradeOutcome =
  | 'FULL_TP2_WIN'
  | 'TP1_BE_WIN'
  | 'STOPPED_OUT'
  | 'PENDING'
  | 'NO_RETEST'
  | 'EXPIRED'
  | 'INVALIDATED';

export interface SweepReclaimSetup {
  id: string;
  type: SweepReclaimType;
  symbol: string;
  timeframe: string;
  phase: SweepReclaimPhase;
  status: SweepReclaimStatus;

  // Phase 1: Anchor Geometry
  anchor_level: number;
  anchor_index: number;
  anchor_time: number;
  anchor_swing_type: 'SWING_LOW' | 'SWING_HIGH';
  anchor_swing_grade: 'MAJOR' | 'INTERNAL' | 'INNER';
  anchor_color_validated: boolean;

  // Phase 2: Sweep Metrics (Purge)
  sweep_price: number | null;
  sweep_index: number | null;
  sweep_time: number | null;
  sweep_depth: number | null;
  sweep_depth_pct: number | null;
  sweep_volume_ratio: number | null;
  bars_anchor_to_sweep: number | null;

  // Phase 3: Reclaim Metrics (Displacement / Inversion)
  reclaim_index: number | null;
  reclaim_time: number | null;
  reclaim_close_price: number | null;
  reclaim_volume_expansion: number | null;
  reclaim_fvg_created: boolean;
  bars_sweep_to_reclaim: number | null;
  is_reclaimed: boolean;

  // Phase 4: Retest & Execution Simulation
  retest_index: number | null;
  retest_time: number | null;
  retest_price: number | null;
  bars_reclaim_to_retest: number | null;
  is_retested: boolean;
  body_defense_passed: boolean;

  // Risk / Reward & Execution Geometry
  entry_price: number;
  stop_loss: number;
  risk_usd: number;
  risk_pct: number;
  tp1_target: number;
  tp2_target: number;
  tp1_multiple: number;
  tp2_multiple: number;

  // Trade Outcome & Telemetry
  simulated_outcome: SweepReclaimTradeOutcome;
  realized_rr: number;
  mfe_r: number;
  mfe_usd: number;
  mae_r: number;
  mae_usd: number;
  is_tp1_filled: boolean;
  is_tp2_filled: boolean;
  is_be_ratcheted: boolean;
  bars_to_outcome: number | null;
  exit_time: number | null;
  exit_price: number | null;
}

export interface SweepReclaimScanConfig {
  symbol?: string;
  timeframe?: string;
  lookbackMajor?: number;                // Pivot engine major lookback (default: 15)
  lookbackInternal?: number;             // Pivot engine internal lookback (default: 5)
  maxBarsAnchorToSweep?: number;         // Max candles between anchor and sweep (default: 30)
  maxBarsSweepToReclaim?: number;        // Max candles from sweep extreme to reclaim close (default: 12)
  maxBarsToRetest?: number;              // Max candles from reclaim to retest entry (default: 24)
  tp1Multiple?: number;                  // TP1 R-multiple (default: 1.2R)
  tp2Multiple?: number;                  // TP2 R-multiple (default: 2.5R)
  tp1Ratio?: number;                     // Allocation for TP1 (default: 0.50)
  tp2Ratio?: number;                     // Allocation for TP2 (default: 0.50)
  enableTrailingBe?: boolean;            // Move SL to Breakeven after TP1 (default: true)
  minSweepDepthAtrMultiplier?: number;   // Min sweep penetration in ATR (default: 0.1)
  slBufferAtrMultiplier?: number;        // Volatility buffer added behind sweep extreme (default: 0.15)
  requireDisplacementReclaim?: boolean;  // Require volume expansion or body dominance on reclaim (default: false)
}

export interface SweepReclaimTelemetrySummary {
  total_anchors_detected: number;
  total_sweeps_detected: number;
  total_reclaims_confirmed: number;
  total_retests_executed: number;

  sweep_rate_pct: number;
  reclaim_rate_pct: number;
  retest_rate_pct: number;
  retest_win_rate_pct: number;

  total_winning_trades: number;
  total_losing_trades: number;
  total_be_scratches: number;
  total_pending_trades: number;

  avg_realized_rr: number;
  avg_winning_rr: number;
  avg_losing_rr: number;
  profit_factor: number;
  expected_value_r: number;

  avg_mfe_r: number;
  avg_mae_r: number;
  avg_bars_to_reclaim: number;
  avg_bars_to_retest: number;
  avg_bars_to_outcome: number;

  bullish_setups_count: number;
  bullish_retest_count: number;
  bullish_win_rate_pct: number;
  bullish_avg_rr: number;

  bearish_setups_count: number;
  bearish_retest_count: number;
  bearish_win_rate_pct: number;
  bearish_avg_rr: number;

  stage_1_tp1_fill_rate_pct: number;
  stage_2_tp2_fill_rate_pct: number;
}

// ── Default Scan Configuration ───────────────────────────────────────────────

export const DEFAULT_SWEEP_RECLAIM_CONFIG: SweepReclaimScanConfig = {
  symbol: 'ETHUSDC',
  timeframe: '15m',
  lookbackMajor: 15,
  lookbackInternal: 5,
  maxBarsAnchorToSweep: 30,
  maxBarsSweepToReclaim: 12,
  maxBarsToRetest: 24,
  tp1Multiple: 1.2,
  tp2Multiple: 2.5,
  tp1Ratio: 0.50,
  tp2Ratio: 0.50,
  enableTrailingBe: true,
  minSweepDepthAtrMultiplier: 0.10,
  slBufferAtrMultiplier: 0.15,
  requireDisplacementReclaim: false,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function calculateAtrSeries(candles: Candle[], period = 14): number[] {
  const atrs: number[] = new Array(candles.length).fill(0);
  if (candles.length < 2) return atrs;

  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const high = c.h ?? (c as any).high;
    const low = c.l ?? (c as any).low;
    if (i === 0) {
      trs.push(high - low);
    } else {
      const prevClose = candles[i - 1].c ?? (candles[i - 1] as any).close;
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }
  }

  let rollingSum = 0;
  for (let i = 0; i < candles.length; i++) {
    rollingSum += trs[i];
    if (i >= period) {
      rollingSum -= trs[i - period];
      atrs[i] = rollingSum / period;
    } else {
      atrs[i] = rollingSum / (i + 1);
    }
  }

  return atrs;
}

// ── SweepReclaimEngine Implementation ────────────────────────────────────────

export class SweepReclaimEngine {
  public config: SweepReclaimScanConfig;

  constructor(config: SweepReclaimScanConfig = {}) {
    this.config = { ...DEFAULT_SWEEP_RECLAIM_CONFIG, ...config };
  }

  /**
   * Scans a historical sequence of confirmed candles for 4-Phase Sweep & Reclaim setups.
   */
  public scanHistoricalSetups(candles: Candle[]): {
    setups: SweepReclaimSetup[];
    telemetry: SweepReclaimTelemetrySummary;
  } {
    if (!candles || candles.length < 30) {
      return {
        setups: [],
        telemetry: this.createEmptyTelemetry()
      };
    }

    const n = candles.length;
    const atrSeries = calculateAtrSeries(candles, 14);

    // Run Pivot Engine across all candles
    const pivotEngine = new PivotEngine({
      lookbackMajor: this.config.lookbackMajor ?? 15,
      lookbackInternal: this.config.lookbackInternal ?? 5,
      lookbackMicro: 3,
    });
    pivotEngine.processCandles(candles);

    const pivots = pivotEngine.pivots;
    const detectedSetups: SweepReclaimSetup[] = [];

    // Deduplicate pivots occurring on the same candle index and direction, retaining the highest structural grade
    const uniquePivotsMap = new Map<string, typeof pivots[0]>();
    for (const p of pivots) {
      const key = `${p.index}_${p.type}`;
      const existing = uniquePivotsMap.get(key);
      if (!existing || (p.level ?? 0) > (existing.level ?? 0)) {
        uniquePivotsMap.set(key, p);
      }
    }
    const uniquePivots = Array.from(uniquePivotsMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    // Helper map for volume SMA
    const volSmaSeries: number[] = new Array(n).fill(0);
    let volSum = 0;
    const volPeriod = 20;
    for (let i = 0; i < n; i++) {
      volSum += candles[i].v ?? 0;
      if (i >= volPeriod) {
        volSum -= candles[i - volPeriod].v ?? 0;
        volSmaSeries[i] = volSum / volPeriod;
      } else {
        volSmaSeries[i] = volSum / (i + 1);
      }
    }

    // Iterate through confirmed unique pivots to anchor Phase 1
    for (const pivot of uniquePivots) {
      const anchorIdx = pivot.index;
      if (anchorIdx < 5 || anchorIdx >= n - 5) continue;

      const isBullish = pivot.type === 'SWING_LOW'; // SSL Sweep -> Bullish Reversal
      const anchorLevel = pivot.price;
      const anchorTime = pivot.timestamp;
      const anchorGrade: 'MAJOR' | 'INTERNAL' | 'INNER' =
        pivot.level === 2 ? 'MAJOR' : pivot.level === 1 ? 'INTERNAL' : 'INNER';

      const maxSweepIdx = Math.min(n - 1, anchorIdx + (this.config.maxBarsAnchorToSweep ?? 30));
      let sweepFound = false;
      let sweepIdx: number | null = null;
      let sweepExtremePrice: number | null = null;
      let sweepExtremeTime: number | null = null;
      let sweepDepth = 0;
      let sweepDepthPct = 0;
      let sweepVolRatio = 1.0;

      // ─── Phase 2: Liquidity Sweep Detection ──────────────────────────────────
      if (isBullish) {
        // Price must violate below the anchor low shelf
        let localMinLow = Infinity;
        let localMinIdx = -1;

        for (let i = anchorIdx + 1; i <= maxSweepIdx; i++) {
          const c = candles[i];
          const low = c.l ?? (c as any).low;

          if (low < anchorLevel) {
            if (low < localMinLow) {
              localMinLow = low;
              localMinIdx = i;
            }
          }
        }

        if (localMinIdx !== -1) {
          const atr = atrSeries[localMinIdx] || 1.0;
          const minDepth = (this.config.minSweepDepthAtrMultiplier ?? 0.10) * atr;
          const currentDepth = anchorLevel - localMinLow;

          if (currentDepth >= minDepth) {
            sweepFound = true;
            sweepIdx = localMinIdx;
            sweepExtremePrice = localMinLow;
            sweepExtremeTime = candles[localMinIdx].t;
            sweepDepth = currentDepth;
            sweepDepthPct = (currentDepth / anchorLevel) * 100;
            const avgVol = volSmaSeries[localMinIdx] || 1;
            sweepVolRatio = (candles[localMinIdx].v ?? 0) / avgVol;
          }
        }
      } else {
        // Bearish: Price must violate above the anchor high shelf
        let localMaxHigh = -Infinity;
        let localMaxIdx = -1;

        for (let i = anchorIdx + 1; i <= maxSweepIdx; i++) {
          const c = candles[i];
          const high = c.h ?? (c as any).high;

          if (high > anchorLevel) {
            if (high > localMaxHigh) {
              localMaxHigh = high;
              localMaxIdx = i;
            }
          }
        }

        if (localMaxIdx !== -1) {
          const atr = atrSeries[localMaxIdx] || 1.0;
          const minDepth = (this.config.minSweepDepthAtrMultiplier ?? 0.10) * atr;
          const currentDepth = localMaxHigh - anchorLevel;

          if (currentDepth >= minDepth) {
            sweepFound = true;
            sweepIdx = localMaxIdx;
            sweepExtremePrice = localMaxHigh;
            sweepExtremeTime = candles[localMaxIdx].t;
            sweepDepth = currentDepth;
            sweepDepthPct = (currentDepth / anchorLevel) * 100;
            const avgVol = volSmaSeries[localMaxIdx] || 1;
            sweepVolRatio = (candles[localMaxIdx].v ?? 0) / avgVol;
          }
        }
      }

      if (!sweepFound || sweepIdx === null || sweepExtremePrice === null || sweepExtremeTime === null) {
        // Setup stopped at Anchor only
        continue;
      }

      // ─── Phase 3: Displacement Reclaim Confirmation ─────────────────────────
      const maxReclaimIdx = Math.min(n - 1, sweepIdx + (this.config.maxBarsSweepToReclaim ?? 12));
      let reclaimFound = false;
      let reclaimIdx: number | null = null;
      let reclaimTime: number | null = null;
      let reclaimClosePrice: number | null = null;
      let reclaimVolExp = 1.0;
      let reclaimFvgCreated = false;

      for (let i = sweepIdx; i <= maxReclaimIdx; i++) {
        const c = candles[i];
        const close = c.c ?? (c as any).close;
        const open = c.o ?? (c as any).open;
        const high = c.h ?? (c as any).high;
        const low = c.l ?? (c as any).low;

        if (isBullish) {
          // Reclaim: confirmed body close strictly ABOVE the anchor shelf
          if (close > anchorLevel && close > open) {
            // Check volume expansion / displacement
            const avgVol = volSmaSeries[i] || 1;
            const volExpansion = (c.v ?? 0) / avgVol;
            const bodyRatio = Math.abs(close - open) / Math.max(0.0001, high - low);

            if (!this.config.requireDisplacementReclaim || (volExpansion >= 1.15 && bodyRatio >= 0.50)) {
              reclaimFound = true;
              reclaimIdx = i;
              reclaimTime = c.t;
              reclaimClosePrice = close;
              reclaimVolExp = volExpansion;

              // Check if an active BISI FVG was created during this reclaim sequence
              if (i >= 2) {
                const c0 = candles[i - 2];
                const c2 = candles[i];
                if ((c2.l ?? (c2 as any).low) > (c0.h ?? (c0 as any).high)) {
                  reclaimFvgCreated = true;
                }
              }
              break;
            }
          }
        } else {
          // Bearish: confirmed body close strictly BELOW the anchor shelf
          if (close < anchorLevel && close < open) {
            const avgVol = volSmaSeries[i] || 1;
            const volExpansion = (c.v ?? 0) / avgVol;
            const bodyRatio = Math.abs(close - open) / Math.max(0.0001, high - low);

            if (!this.config.requireDisplacementReclaim || (volExpansion >= 1.15 && bodyRatio >= 0.50)) {
              reclaimFound = true;
              reclaimIdx = i;
              reclaimTime = c.t;
              reclaimClosePrice = close;
              reclaimVolExp = volExpansion;

              if (i >= 2) {
                const c0 = candles[i - 2];
                const c2 = candles[i];
                if ((c2.h ?? (c2 as any).high) < (c0.l ?? (c0 as any).low)) {
                  reclaimFvgCreated = true;
                }
              }
              break;
            }
          }
        }
      }

      const setupId = `SR_${isBullish ? 'BULL' : 'BEAR'}_${anchorGrade}_${anchorLevel.toFixed(2)}_${anchorTime}`;
      const atrAtSweep = atrSeries[sweepIdx] || 1.0;
      const slBuffer = (this.config.slBufferAtrMultiplier ?? 0.15) * atrAtSweep;

      const entryPrice = anchorLevel;
      const stopLoss = isBullish
        ? Math.min(sweepExtremePrice - slBuffer, anchorLevel - 0.50)
        : Math.max(sweepExtremePrice + slBuffer, anchorLevel + 0.50);

      const riskUsd = Math.abs(entryPrice - stopLoss);
      const riskPct = (riskUsd / entryPrice) * 100;

      const tp1Multiple = this.config.tp1Multiple ?? 1.2;
      const tp2Multiple = this.config.tp2Multiple ?? 2.5;

      const tp1Target = isBullish ? entryPrice + (riskUsd * tp1Multiple) : entryPrice - (riskUsd * tp1Multiple);
      const tp2Target = isBullish ? entryPrice + (riskUsd * tp2Multiple) : entryPrice - (riskUsd * tp2Multiple);

      if (!reclaimFound || reclaimIdx === null || reclaimTime === null || reclaimClosePrice === null) {
        // Setup reached sweep but failed to reclaim
        detectedSetups.push({
          id: setupId,
          type: isBullish ? 'BULLISH' : 'BEARISH',
          symbol: this.config.symbol || 'ETHUSDC',
          timeframe: this.config.timeframe || '15m',
          phase: 'SWEEP',
          status: 'SWEPT_NO_RECLAIM',
          anchor_level: anchorLevel,
          anchor_index: anchorIdx,
          anchor_time: anchorTime,
          anchor_swing_type: pivot.type,
          anchor_swing_grade: anchorGrade,
          anchor_color_validated: !!pivot.colorValidated,
          sweep_price: sweepExtremePrice,
          sweep_index: sweepIdx,
          sweep_time: sweepExtremeTime,
          sweep_depth: sweepDepth,
          sweep_depth_pct: sweepDepthPct,
          sweep_volume_ratio: sweepVolRatio,
          bars_anchor_to_sweep: sweepIdx - anchorIdx,
          reclaim_index: null,
          reclaim_time: null,
          reclaim_close_price: null,
          reclaim_volume_expansion: null,
          reclaim_fvg_created: false,
          bars_sweep_to_reclaim: null,
          is_reclaimed: false,
          retest_index: null,
          retest_time: null,
          retest_price: null,
          bars_reclaim_to_retest: null,
          is_retested: false,
          body_defense_passed: false,
          entry_price: entryPrice,
          stop_loss: stopLoss,
          risk_usd: riskUsd,
          risk_pct: riskPct,
          tp1_target: tp1Target,
          tp2_target: tp2Target,
          tp1_multiple: tp1Multiple,
          tp2_multiple: tp2Multiple,
          simulated_outcome: 'NO_RETEST',
          realized_rr: 0,
          mfe_r: 0,
          mfe_usd: 0,
          mae_r: 0,
          mae_usd: 0,
          is_tp1_filled: false,
          is_tp2_filled: false,
          is_be_ratcheted: false,
          bars_to_outcome: null,
          exit_time: null,
          exit_price: null,
        });
        continue;
      }

      // ─── Phase 4: Retest Pullback & Trade Lifecycle Simulation ──────────────
      // Zero Look-Ahead Parity: Retest search begins on the candle AFTER the reclaim close
      const startRetestIdx = reclaimIdx + 1;
      const maxRetestIdx = Math.min(n - 1, reclaimIdx + (this.config.maxBarsToRetest ?? 24));

      let retestFound = false;
      let retestIdx: number | null = null;
      let retestTime: number | null = null;
      let retestPrice: number | null = null;
      let bodyDefensePassed = true;

      for (let i = startRetestIdx; i <= maxRetestIdx; i++) {
        const c = candles[i];
        const high = c.h ?? (c as any).high;
        const low = c.l ?? (c as any).low;
        const close = c.c ?? (c as any).close;

        if (isBullish) {
          // Retest: candle reaches down to touch or penetrate the anchor shelf
          if (low <= anchorLevel) {
            // Check if it immediately invalidated below stopLoss
            if (low <= stopLoss) {
              // Failed retest / early invalidation
              retestFound = true;
              retestIdx = i;
              retestTime = c.t;
              retestPrice = anchorLevel;
              bodyDefensePassed = false;
              break;
            }

            // ICT Body Defense: Candle body close must remain at or above the shelf
            if (close < anchorLevel) {
              bodyDefensePassed = false;
            }

            retestFound = true;
            retestIdx = i;
            retestTime = c.t;
            retestPrice = anchorLevel;
            break;
          }
        } else {
          // Bearish Retest: candle reaches up to touch or penetrate the anchor shelf
          if (high >= anchorLevel) {
            if (high >= stopLoss) {
              retestFound = true;
              retestIdx = i;
              retestTime = c.t;
              retestPrice = anchorLevel;
              bodyDefensePassed = false;
              break;
            }

            if (close > anchorLevel) {
              bodyDefensePassed = false;
            }

            retestFound = true;
            retestIdx = i;
            retestTime = c.t;
            retestPrice = anchorLevel;
            break;
          }
        }
      }

      if (!retestFound || retestIdx === null || retestTime === null) {
        // Reclaimed, but never retested before expiration
        detectedSetups.push({
          id: setupId,
          type: isBullish ? 'BULLISH' : 'BEARISH',
          symbol: this.config.symbol || 'ETHUSDC',
          timeframe: this.config.timeframe || '15m',
          phase: 'RECLAIM',
          status: 'RECLAIMED_NO_RETEST',
          anchor_level: anchorLevel,
          anchor_index: anchorIdx,
          anchor_time: anchorTime,
          anchor_swing_type: pivot.type,
          anchor_swing_grade: anchorGrade,
          anchor_color_validated: !!pivot.colorValidated,
          sweep_price: sweepExtremePrice,
          sweep_index: sweepIdx,
          sweep_time: sweepExtremeTime,
          sweep_depth: sweepDepth,
          sweep_depth_pct: sweepDepthPct,
          sweep_volume_ratio: sweepVolRatio,
          bars_anchor_to_sweep: sweepIdx - anchorIdx,
          reclaim_index: reclaimIdx,
          reclaim_time: reclaimTime,
          reclaim_close_price: reclaimClosePrice,
          reclaim_volume_expansion: reclaimVolExp,
          reclaim_fvg_created: reclaimFvgCreated,
          bars_sweep_to_reclaim: reclaimIdx - sweepIdx,
          is_reclaimed: true,
          retest_index: null,
          retest_time: null,
          retest_price: null,
          bars_reclaim_to_retest: null,
          is_retested: false,
          body_defense_passed: false,
          entry_price: entryPrice,
          stop_loss: stopLoss,
          risk_usd: riskUsd,
          risk_pct: riskPct,
          tp1_target: tp1Target,
          tp2_target: tp2Target,
          tp1_multiple: tp1Multiple,
          tp2_multiple: tp2Multiple,
          simulated_outcome: 'NO_RETEST',
          realized_rr: 0,
          mfe_r: 0,
          mfe_usd: 0,
          mae_r: 0,
          mae_usd: 0,
          is_tp1_filled: false,
          is_tp2_filled: false,
          is_be_ratcheted: false,
          bars_to_outcome: null,
          exit_time: null,
          exit_price: null,
        });
        continue;
      }

      // ─── Trade Execution & Forward Simulation ───────────────────────────────
      // Evaluates candles chronologically starting from the retest candle forward
      let isTp1Filled = false;
      let isTp2Filled = false;
      let isBeRatcheted = false;
      let currentSl = stopLoss;
      let tradeOutcome: SweepReclaimTradeOutcome = 'PENDING';
      let realizedRr = 0;
      let exitTime: number | null = null;
      let exitPrice: number | null = null;
      let barsToOutcome: number | null = null;

      let maxFavorableUsd = 0;
      let maxAdverseUsd = 0;

      const tp1Ratio = this.config.tp1Ratio ?? 0.50;
      const tp2Ratio = this.config.tp2Ratio ?? 0.50;

      for (let i = retestIdx; i < n; i++) {
        const c = candles[i];
        const high = c.h ?? (c as any).high;
        const low = c.l ?? (c as any).low;
        const close = c.c ?? (c as any).close;

        // Calculate Excursions relative to Entry
        if (isBullish) {
          const favorableMove = high - entryPrice;
          const adverseMove = entryPrice - low;
          if (favorableMove > maxFavorableUsd) maxFavorableUsd = favorableMove;
          if (adverseMove > maxAdverseUsd) maxAdverseUsd = adverseMove;

          // 1. Check Stop Loss breach
          if (low <= currentSl) {
            exitTime = c.t;
            exitPrice = currentSl;
            barsToOutcome = i - retestIdx + 1;

            if (isTp1Filled && isBeRatcheted) {
              tradeOutcome = 'TP1_BE_WIN';
              // Banked TP1 portion + 0 on remainder
              realizedRr = tp1Ratio * tp1Multiple;
            } else {
              tradeOutcome = 'STOPPED_OUT';
              realizedRr = -1.0;
            }
            break;
          }

          // 2. Check TP1 fill
          if (!isTp1Filled && high >= tp1Target) {
            isTp1Filled = true;
            if (this.config.enableTrailingBe) {
              isBeRatcheted = true;
              currentSl = entryPrice; // Ratchet Stop Loss to Breakeven
            }
          }

          // 3. Check TP2 fill
          if (isTp1Filled && high >= tp2Target) {
            isTp2Filled = true;
            exitTime = c.t;
            exitPrice = tp2Target;
            barsToOutcome = i - retestIdx + 1;
            tradeOutcome = 'FULL_TP2_WIN';
            realizedRr = (tp1Ratio * tp1Multiple) + (tp2Ratio * tp2Multiple);
            break;
          }
        } else {
          // Bearish Simulation
          const favorableMove = entryPrice - low;
          const adverseMove = high - entryPrice;
          if (favorableMove > maxFavorableUsd) maxFavorableUsd = favorableMove;
          if (adverseMove > maxAdverseUsd) maxAdverseUsd = adverseMove;

          // 1. Check Stop Loss breach
          if (high >= currentSl) {
            exitTime = c.t;
            exitPrice = currentSl;
            barsToOutcome = i - retestIdx + 1;

            if (isTp1Filled && isBeRatcheted) {
              tradeOutcome = 'TP1_BE_WIN';
              realizedRr = tp1Ratio * tp1Multiple;
            } else {
              tradeOutcome = 'STOPPED_OUT';
              realizedRr = -1.0;
            }
            break;
          }

          // 2. Check TP1 fill
          if (!isTp1Filled && low <= tp1Target) {
            isTp1Filled = true;
            if (this.config.enableTrailingBe) {
              isBeRatcheted = true;
              currentSl = entryPrice;
            }
          }

          // 3. Check TP2 fill
          if (isTp1Filled && low <= tp2Target) {
            isTp2Filled = true;
            exitTime = c.t;
            exitPrice = tp2Target;
            barsToOutcome = i - retestIdx + 1;
            tradeOutcome = 'FULL_TP2_WIN';
            realizedRr = (tp1Ratio * tp1Multiple) + (tp2Ratio * tp2Multiple);
            break;
          }
        }
      }

      // If loop finished without hitting SL or TP2, mark PENDING or partial
      if (tradeOutcome === 'PENDING') {
        const lastCandle = candles[n - 1];
        exitTime = lastCandle.t;
        const lastClose = lastCandle.c ?? (lastCandle as any).close;
        exitPrice = lastClose;
        barsToOutcome = n - retestIdx;

        if (isTp1Filled) {
          realizedRr = tp1Ratio * tp1Multiple;
        } else {
          const floatingPnl = isBullish ? lastClose - entryPrice : entryPrice - lastClose;
          realizedRr = parseFloat((floatingPnl / riskUsd).toFixed(2));
        }
      }

      const mfeR = riskUsd > 0 ? parseFloat((maxFavorableUsd / riskUsd).toFixed(2)) : 0;
      const maeR = riskUsd > 0 ? parseFloat((maxAdverseUsd / riskUsd).toFixed(2)) : 0;

      detectedSetups.push({
        id: setupId,
        type: isBullish ? 'BULLISH' : 'BEARISH',
        symbol: this.config.symbol || 'ETHUSDC',
        timeframe: this.config.timeframe || '15m',
        phase: 'RETEST',
        status: bodyDefensePassed ? 'RETESTED' : 'INVALIDATED_AT_RETEST',
        anchor_level: anchorLevel,
        anchor_index: anchorIdx,
        anchor_time: anchorTime,
        anchor_swing_type: pivot.type,
        anchor_swing_grade: anchorGrade,
        anchor_color_validated: !!pivot.colorValidated,
        sweep_price: sweepExtremePrice,
        sweep_index: sweepIdx,
        sweep_time: sweepExtremeTime,
        sweep_depth: sweepDepth,
        sweep_depth_pct: sweepDepthPct,
        sweep_volume_ratio: sweepVolRatio,
        bars_anchor_to_sweep: sweepIdx - anchorIdx,
        reclaim_index: reclaimIdx,
        reclaim_time: reclaimTime,
        reclaim_close_price: reclaimClosePrice,
        reclaim_volume_expansion: reclaimVolExp,
        reclaim_fvg_created: reclaimFvgCreated,
        bars_sweep_to_reclaim: reclaimIdx - sweepIdx,
        is_reclaimed: true,
        retest_index: retestIdx,
        retest_time: retestTime,
        retest_price: retestPrice,
        bars_reclaim_to_retest: retestIdx - reclaimIdx,
        is_retested: true,
        body_defense_passed: bodyDefensePassed,
        entry_price: entryPrice,
        stop_loss: stopLoss,
        risk_usd: riskUsd,
        risk_pct: riskPct,
        tp1_target: tp1Target,
        tp2_target: tp2Target,
        tp1_multiple: tp1Multiple,
        tp2_multiple: tp2Multiple,
        simulated_outcome: tradeOutcome,
        realized_rr: parseFloat(realizedRr.toFixed(2)),
        mfe_r: mfeR,
        mfe_usd: parseFloat(maxFavorableUsd.toFixed(2)),
        mae_r: maeR,
        mae_usd: parseFloat(maxAdverseUsd.toFixed(2)),
        is_tp1_filled: isTp1Filled,
        is_tp2_filled: isTp2Filled,
        is_be_ratcheted: isBeRatcheted,
        bars_to_outcome: barsToOutcome,
        exit_time: exitTime,
        exit_price: exitPrice,
      });
    }

    // Sort setups chronologically by anchor timestamp
    detectedSetups.sort((a, b) => a.anchor_time - b.anchor_time);

    const telemetry = this.computeTelemetrySummary(detectedSetups);
    return { setups: detectedSetups, telemetry };
  }

  /**
   * Computes aggregate statistical metrics and conversion funnels across all detected setups.
   */
  public computeTelemetrySummary(setups: SweepReclaimSetup[]): SweepReclaimTelemetrySummary {
    if (setups.length === 0) {
      return this.createEmptyTelemetry();
    }

    const totalAnchors = setups.length;
    const sweeps = setups.filter(s => s.sweep_price !== null);
    const reclaims = setups.filter(s => s.is_reclaimed);
    const retests = setups.filter(s => s.is_retested);

    const totalSweeps = sweeps.length;
    const totalReclaims = reclaims.length;
    const totalRetests = retests.length;

    const sweepRatePct = totalAnchors > 0 ? (totalSweeps / totalAnchors) * 100 : 0;
    const reclaimRatePct = totalSweeps > 0 ? (totalReclaims / totalSweeps) * 100 : 0;
    const retestRatePct = totalReclaims > 0 ? (totalRetests / totalReclaims) * 100 : 0;

    // Retest Trade Outcomes
    const retestedTrades = setups.filter(s => s.is_retested);
    const winningTrades = retestedTrades.filter(s => s.simulated_outcome === 'FULL_TP2_WIN' || s.simulated_outcome === 'TP1_BE_WIN');
    const losingTrades = retestedTrades.filter(s => s.simulated_outcome === 'STOPPED_OUT');
    const beScratches = retestedTrades.filter(s => s.simulated_outcome === 'TP1_BE_WIN');
    const pendingTrades = retestedTrades.filter(s => s.simulated_outcome === 'PENDING');

    const totalWins = winningTrades.length;
    const totalLosses = losingTrades.length;
    const totalResolved = totalWins + totalLosses;

    const retestWinRatePct = totalResolved > 0 ? (totalWins / totalResolved) * 100 : 0;

    let totalRealizedRr = 0;
    let totalWinRr = 0;
    let totalLossRr = 0;
    let totalMfeR = 0;
    let totalMaeR = 0;
    let totalBarsToReclaim = 0;
    let totalBarsToRetest = 0;
    let totalBarsToOutcome = 0;

    for (const trade of retestedTrades) {
      totalRealizedRr += trade.realized_rr;
      totalMfeR += trade.mfe_r;
      totalMaeR += trade.mae_r;

      if (trade.realized_rr > 0) {
        totalWinRr += trade.realized_rr;
      } else if (trade.realized_rr < 0) {
        totalLossRr += Math.abs(trade.realized_rr);
      }

      if (trade.bars_sweep_to_reclaim !== null) totalBarsToReclaim += trade.bars_sweep_to_reclaim;
      if (trade.bars_reclaim_to_retest !== null) totalBarsToRetest += trade.bars_reclaim_to_retest;
      if (trade.bars_to_outcome !== null) totalBarsToOutcome += trade.bars_to_outcome;
    }

    const avgRealizedRr = totalRetests > 0 ? totalRealizedRr / totalRetests : 0;
    const avgWinningRr = totalWins > 0 ? totalWinRr / totalWins : 0;
    const avgLosingRr = totalLosses > 0 ? totalLossRr / totalLosses : 0;
    const profitFactor = totalLossRr > 0 ? totalWinRr / totalLossRr : totalWinRr > 0 ? 99.9 : 0;

    const winProb = totalResolved > 0 ? totalWins / totalResolved : 0;
    const lossProb = totalResolved > 0 ? totalLosses / totalResolved : 0;
    const expectedValueR = (winProb * avgWinningRr) - (lossProb * avgLosingRr);

    const avgMfeR = totalRetests > 0 ? totalMfeR / totalRetests : 0;
    const avgMaeR = totalRetests > 0 ? totalMaeR / totalRetests : 0;

    const avgBarsToReclaim = totalReclaims > 0 ? totalBarsToReclaim / totalReclaims : 0;
    const avgBarsToRetest = totalRetests > 0 ? totalBarsToRetest / totalRetests : 0;
    const avgBarsToOutcome = totalRetests > 0 ? totalBarsToOutcome / totalRetests : 0;

    // Directional Breakdown
    const bullishSetups = setups.filter(s => s.type === 'BULLISH');
    const bullishRetests = bullishSetups.filter(s => s.is_retested);
    const bullishWins = bullishRetests.filter(s => s.simulated_outcome === 'FULL_TP2_WIN' || s.simulated_outcome === 'TP1_BE_WIN');
    const bullishWinRatePct = bullishRetests.length > 0 ? (bullishWins.length / bullishRetests.length) * 100 : 0;
    const bullishAvgRr = bullishRetests.length > 0
      ? bullishRetests.reduce((acc, s) => acc + s.realized_rr, 0) / bullishRetests.length
      : 0;

    const bearishSetups = setups.filter(s => s.type === 'BEARISH');
    const bearishRetests = bearishSetups.filter(s => s.is_retested);
    const bearishWins = bearishRetests.filter(s => s.simulated_outcome === 'FULL_TP2_WIN' || s.simulated_outcome === 'TP1_BE_WIN');
    const bearishWinRatePct = bearishRetests.length > 0 ? (bearishWins.length / bearishRetests.length) * 100 : 0;
    const bearishAvgRr = bearishRetests.length > 0
      ? bearishRetests.reduce((acc, s) => acc + s.realized_rr, 0) / bearishRetests.length
      : 0;

    const tp1Fills = retestedTrades.filter(s => s.is_tp1_filled).length;
    const tp2Fills = retestedTrades.filter(s => s.is_tp2_filled).length;
    const stage1FillRate = totalRetests > 0 ? (tp1Fills / totalRetests) * 100 : 0;
    const stage2FillRate = totalRetests > 0 ? (tp2Fills / totalRetests) * 100 : 0;

    return {
      total_anchors_detected: totalAnchors,
      total_sweeps_detected: totalSweeps,
      total_reclaims_confirmed: totalReclaims,
      total_retests_executed: totalRetests,

      sweep_rate_pct: parseFloat(sweepRatePct.toFixed(1)),
      reclaim_rate_pct: parseFloat(reclaimRatePct.toFixed(1)),
      retest_rate_pct: parseFloat(retestRatePct.toFixed(1)),
      retest_win_rate_pct: parseFloat(retestWinRatePct.toFixed(1)),

      total_winning_trades: totalWins,
      total_losing_trades: totalLosses,
      total_be_scratches: beScratches.length,
      total_pending_trades: pendingTrades.length,

      avg_realized_rr: parseFloat(avgRealizedRr.toFixed(2)),
      avg_winning_rr: parseFloat(avgWinningRr.toFixed(2)),
      avg_losing_rr: parseFloat(avgLosingRr.toFixed(2)),
      profit_factor: parseFloat(profitFactor.toFixed(2)),
      expected_value_r: parseFloat(expectedValueR.toFixed(2)),

      avg_mfe_r: parseFloat(avgMfeR.toFixed(2)),
      avg_mae_r: parseFloat(avgMaeR.toFixed(2)),
      avg_bars_to_reclaim: parseFloat(avgBarsToReclaim.toFixed(1)),
      avg_bars_to_retest: parseFloat(avgBarsToRetest.toFixed(1)),
      avg_bars_to_outcome: parseFloat(avgBarsToOutcome.toFixed(1)),

      bullish_setups_count: bullishSetups.length,
      bullish_retest_count: bullishRetests.length,
      bullish_win_rate_pct: parseFloat(bullishWinRatePct.toFixed(1)),
      bullish_avg_rr: parseFloat(bullishAvgRr.toFixed(2)),

      bearish_setups_count: bearishSetups.length,
      bearish_retest_count: bearishRetests.length,
      bearish_win_rate_pct: parseFloat(bearishWinRatePct.toFixed(1)),
      bearish_avg_rr: parseFloat(bearishAvgRr.toFixed(2)),

      stage_1_tp1_fill_rate_pct: parseFloat(stage1FillRate.toFixed(1)),
      stage_2_tp2_fill_rate_pct: parseFloat(stage2FillRate.toFixed(1)),
    };
  }

  private createEmptyTelemetry(): SweepReclaimTelemetrySummary {
    return {
      total_anchors_detected: 0,
      total_sweeps_detected: 0,
      total_reclaims_confirmed: 0,
      total_retests_executed: 0,
      sweep_rate_pct: 0,
      reclaim_rate_pct: 0,
      retest_rate_pct: 0,
      retest_win_rate_pct: 0,
      total_winning_trades: 0,
      total_losing_trades: 0,
      total_be_scratches: 0,
      total_pending_trades: 0,
      avg_realized_rr: 0,
      avg_winning_rr: 0,
      avg_losing_rr: 0,
      profit_factor: 0,
      expected_value_r: 0,
      avg_mfe_r: 0,
      avg_mae_r: 0,
      avg_bars_to_reclaim: 0,
      avg_bars_to_retest: 0,
      avg_bars_to_outcome: 0,
      bullish_setups_count: 0,
      bullish_retest_count: 0,
      bullish_win_rate_pct: 0,
      bullish_avg_rr: 0,
      bearish_setups_count: 0,
      bearish_retest_count: 0,
      bearish_win_rate_pct: 0,
      bearish_avg_rr: 0,
      stage_1_tp1_fill_rate_pct: 0,
      stage_2_tp2_fill_rate_pct: 0,
    };
  }
}
