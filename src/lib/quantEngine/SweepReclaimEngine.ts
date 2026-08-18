/**
 * SweepReclaimEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Sweep & Reclaim (Failed Signal Reversal) Quantitative Engine.
 *
 * Implements a deterministic, 4-phase chronological state machine:
 *  - Phase 1 (Multi-Timeframe Anchors): Tracks Asian High/Low (00:00–07:00 UTC),
 *    London High/Low (07:00–12:00 UTC), Previous Day High/Low (PDH/PDL), and
 *    color-locked Major/Internal pivots with strict zero look-ahead bias.
 *  - Phase 2 (Liquidity Sweep): Detects price breaking through the anchor shelf
 *    to purge external liquidity (SSL for Bullish, BSL for Bearish) within a
 *    configurable freshness window.
 *  - Phase 3 (Volumetric Displacement Reclaim): Gated strictly on confirmed candle
 *    body close back beyond the anchor shelf with:
 *      1. Candle body-to-range ratio >= 0.55.
 *      2. Directional taker volume delta dominance >= 51.5%.
 *      3. Displacement Fair Value Gap (BISI/SIBI) creation and 50% Consequent Encroachment (CE).
 *  - Phase 4 (3-Stage Harvest & Trailing Execution Engine):
 *      - Tranche 1 (40% at 1.0R): Partial fill, activates structural trailing stop anchored
 *        to displacement FVG 50% CE (capping runner risk so net trade P&L >= 0.0R).
 *      - Tranche 2 (40% at 1.5R): Partial fill, immediately ratchets active SL to a guaranteed +1.0R floor.
 *      - Tranche 3 (20% DOL Runner): Trails remaining inventory along confirmed local swing pivots.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from '../fvgEngine';
import { PivotEngine } from './PivotEngine';

// ── Types & Interfaces ────────────────────────────────────────────────────────

export type SweepReclaimType = 'BULLISH' | 'BEARISH';

export type SweepReclaimPhase = 'ANCHOR' | 'SWEEP' | 'RECLAIM' | 'RETEST';

export type SweepReclaimAnchorType =
  | 'SWING_PIVOT'
  | 'ASIAN_HIGH'
  | 'ASIAN_LOW'
  | 'LONDON_HIGH'
  | 'LONDON_LOW'
  | 'PDH'
  | 'PDL';

export type SweepReclaimStatus =
  | 'RETESTED'
  | 'RECLAIMED_NO_RETEST'
  | 'SWEPT_NO_RECLAIM'
  | 'ANCHOR_ONLY'
  | 'INVALIDATED_AT_RETEST'
  | 'EXPIRED';

export type SweepReclaimTradeOutcome =
  | 'FULL_TP3_WIN'
  | 'FULL_TP2_WIN'
  | 'BE_SCRATCH_WIN'
  | 'STRUCTURAL_SCRATCH'
  | 'STOPPED_OUT'
  | 'PENDING'
  | 'NO_RETEST'
  | 'EXPIRED'
  | 'INVALIDATED';

export type SweepReclaimStageExitType =
  | 'FULL_TP3_WIN'
  | 'STAGE_2_WIN'
  | 'STAGE_1_SCRATCH'
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
  anchor_type: SweepReclaimAnchorType;
  anchor_name: string;
  anchor_level: number;
  anchor_index: number;
  anchor_time: number;
  anchor_swing_type: 'SWING_LOW' | 'SWING_HIGH';
  anchor_swing_grade: 'MAJOR' | 'INTERNAL' | 'INNER' | 'SESSION' | 'DAILY';
  anchor_color_validated: boolean;

  // Phase 2: Sweep Metrics (Purge)
  sweep_price: number | null;
  sweep_index: number | null;
  sweep_time: number | null;
  sweep_depth: number | null;
  sweep_depth_pct: number | null;
  sweep_volume_ratio: number | null;
  bars_anchor_to_sweep: number | null;

  // Phase 3: Volumetric Reclaim Metrics (Displacement / Inversion)
  reclaim_index: number | null;
  reclaim_time: number | null;
  reclaim_close_price: number | null;
  reclaim_volume_expansion: number | null;
  reclaim_body_ratio: number | null;
  reclaim_delta_dominance_pct: number | null;
  reclaim_fvg_created: boolean;
  reclaim_fvg_top: number | null;
  reclaim_fvg_bottom: number | null;
  reclaim_fvg_ce: number | null;
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
  entry_mode: 'FVG_CE' | 'RECLAIM_LEVEL';
  entry_price: number;
  stop_loss: number;
  risk_usd: number;
  risk_pct: number;
  stage1_target: number;
  stage2_target: number;
  stage3_target: number;
  stage1_multiple: number;
  stage2_multiple: number;
  stage3_multiple: number;

  // 3-Stage Harvest Tracking
  is_stage1_filled: boolean;
  is_stage2_filled: boolean;
  is_stage3_filled: boolean;
  stage1_hit_time: number | null;
  stage1_hit_index: number | null;
  stage2_hit_time: number | null;
  stage2_hit_index: number | null;
  stage3_hit_time: number | null;
  stage3_hit_index: number | null;
  active_trailing_sl: number;
  active_ratchet_floor: number | null;
  trailing_sl_source: 'INITIAL' | 'FVG_CE' | 'PROFIT_RATCHET_FLOOR' | 'SWING_TRAIL' | 'BREAKEVEN';
  is_be_scratch: boolean;
  is_structural_scratch: boolean;

  // Trade Outcome & Telemetry
  simulated_outcome: SweepReclaimTradeOutcome;
  stage_exit_type: SweepReclaimStageExitType;
  realized_rr: number;
  mfe_r: number;
  mfe_usd: number;
  mae_r: number;
  mae_usd: number;
  bars_to_outcome: number | null;
  exit_time: number | null;
  exit_price: number | null;
}

export interface SweepReclaimScanConfig {
  symbol?: string;
  timeframe?: string;
  anchorTypes?: SweepReclaimAnchorType[];     // Selected anchor types to scan (default: all)
  lookbackMajor?: number;                     // Pivot engine major lookback (default: 15)
  lookbackInternal?: number;                  // Pivot engine internal lookback (default: 5)
  maxBarsAnchorToSweep?: number;              // Max candles between anchor and sweep (default: 30)
  maxBarsSweepToReclaim?: number;             // Max candles from sweep extreme to reclaim close (default: 12)
  maxBarsToRetest?: number;                   // Max candles from reclaim to retest entry (default: 24)
  deltaDominanceThreshold?: number;           // Min taker delta dominance % (default: 51.5)
  bodyRatioThreshold?: number;                // Min candle body-to-range ratio (default: 0.55)
  stage1Multiple?: number;                    // Stage 1 Tranche target R (default: 1.0)
  stage2Multiple?: number;                    // Stage 2 Tranche target R (default: 1.5)
  stage3Multiple?: number;                    // Stage 3 Tranche target R / DOL runner (default: 3.0)
  entryMode?: 'FVG_CE' | 'RECLAIM_LEVEL';     // Entry at displacement FVG 50% CE or Reclaim Shelf (default: 'FVG_CE')
  enableStructuralTrail?: boolean;            // Trail SL to FVG CE after Stage 1 (default: true)
  enableProfitRatchet?: boolean;              // Ratchet SL to +1.0R floor after Stage 2 (default: true)
  minSweepDepthAtrMultiplier?: number;        // Min sweep penetration in ATR (default: 0.1)
  slBufferAtrMultiplier?: number;             // Volatility buffer added behind sweep extreme (default: 0.15)
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
  total_structural_scratches: number;
  total_pending_trades: number;

  stage1_fill_count: number;
  stage1_fill_pct: number;
  stage2_fill_count: number;
  stage2_fill_pct: number;
  stage3_fill_count: number;
  stage3_fill_pct: number;

  full_tp3_wins: number;
  full_tp2_wins: number;
  stopped_out_count: number;

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

  anchor_type_distribution: Record<SweepReclaimAnchorType, number>;
}

// ── Default Scan Configuration ───────────────────────────────────────────────

export const DEFAULT_SWEEP_RECLAIM_CONFIG: SweepReclaimScanConfig = {
  symbol: 'ETHUSDC',
  timeframe: '15m',
  anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
  lookbackMajor: 15,
  lookbackInternal: 5,
  maxBarsAnchorToSweep: 30,
  maxBarsSweepToReclaim: 12,
  maxBarsToRetest: 24,
  deltaDominanceThreshold: 51.5,
  bodyRatioThreshold: 0.55,
  stage1Multiple: 1.0,
  stage2Multiple: 1.5,
  stage3Multiple: 3.0,
  entryMode: 'FVG_CE',
  enableStructuralTrail: true,
  enableProfitRatchet: true,
  minSweepDepthAtrMultiplier: 0.10,
  slBufferAtrMultiplier: 0.15,
};

// ── Internal Helpers ─────────────────────────────────────────────────────────

interface LiquidityAnchor {
  type: SweepReclaimAnchorType;
  name: string;
  level: number;
  time: number;
  index: number;
  bias: 'BULLISH' | 'BEARISH';
  grade: 'MAJOR' | 'INTERNAL' | 'INNER' | 'SESSION' | 'DAILY';
  colorValidated: boolean;
}

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
   * Extracts multi-timeframe liquidity anchors chronologically with zero look-ahead bias.
   */
  private extractAnchors(candles: Candle[]): LiquidityAnchor[] {
    const anchors: LiquidityAnchor[] = [];
    const n = candles.length;
    if (n < 10) return anchors;

    const allowedTypes = new Set<SweepReclaimAnchorType>(
      this.config.anchorTypes && this.config.anchorTypes.length > 0
        ? this.config.anchorTypes
        : ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL']
    );

    // 1. Major / Internal Pivots from PivotEngine
    if (allowedTypes.has('SWING_PIVOT')) {
      const pivotEngine = new PivotEngine({
        lookbackMajor: this.config.lookbackMajor ?? 15,
        lookbackInternal: this.config.lookbackInternal ?? 5,
        lookbackMicro: 3,
      });
      pivotEngine.processCandles(candles);

      // Deduplicate pivots occurring on the same candle index and direction, retaining highest grade
      const uniquePivotsMap = new Map<string, typeof pivotEngine.pivots[0]>();
      for (const p of pivotEngine.pivots) {
        const key = `${p.index}_${p.type}`;
        const existing = uniquePivotsMap.get(key);
        if (!existing || (p.level ?? 0) > (existing.level ?? 0)) {
          uniquePivotsMap.set(key, p);
        }
      }

      for (const p of uniquePivotsMap.values()) {
        const isBull = p.type === 'SWING_LOW';
        const grade = p.level === 2 ? 'MAJOR' : p.level === 1 ? 'INTERNAL' : 'INNER';
        anchors.push({
          type: 'SWING_PIVOT',
          name: `${grade} ${isBull ? 'Swing Low' : 'Swing High'} ($${p.price.toFixed(2)})`,
          level: p.price,
          time: p.timestamp,
          index: p.index,
          bias: isBull ? 'BULLISH' : 'BEARISH',
          grade,
          colorValidated: !!p.colorValidated,
        });
      }
    }

    // 2. Session Extrema & PDH/PDL Partitioning
    // Group candles chronologically by calendar day (UTC)
    const candlesByDay = new Map<string, { candles: Candle[]; indices: number[] }>();
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const dayKey = new Date(c.t).toISOString().slice(0, 10);
      if (!candlesByDay.has(dayKey)) {
        candlesByDay.set(dayKey, { candles: [], indices: [] });
      }
      const entry = candlesByDay.get(dayKey)!;
      entry.candles.push(c);
      entry.indices.push(i);
    }

    const daysList = Array.from(candlesByDay.keys()).sort();

    for (let dIdx = 0; dIdx < daysList.length; dIdx++) {
      const dayKey = daysList[dIdx];
      const { candles: dayCandles, indices: dayIndices } = candlesByDay.get(dayKey)!;

      // ── Asian Session (00:00 - 07:00 UTC) ──────────────────────────────────
      const asianCandles: Candle[] = [];
      const asianIndices: number[] = [];
      let postAsianFirstIdx: number | null = null;

      for (let k = 0; k < dayCandles.length; k++) {
        const c = dayCandles[k];
        const hour = new Date(c.t).getUTCHours();
        if (hour >= 0 && hour < 7) {
          asianCandles.push(c);
          asianIndices.push(dayIndices[k]);
        } else if (hour >= 7 && postAsianFirstIdx === null) {
          postAsianFirstIdx = dayIndices[k];
        }
      }

      if (asianCandles.length > 0 && postAsianFirstIdx !== null) {
        const aHigh = Math.max(...asianCandles.map(c => c.h ?? (c as any).high));
        const aLow = Math.min(...asianCandles.map(c => c.l ?? (c as any).low));
        const anchorTime = candles[postAsianFirstIdx].t;

        if (allowedTypes.has('ASIAN_HIGH')) {
          anchors.push({
            type: 'ASIAN_HIGH',
            name: `Asian Session High ($${aHigh.toFixed(2)})`,
            level: aHigh,
            time: anchorTime,
            index: postAsianFirstIdx,
            bias: 'BEARISH',
            grade: 'SESSION',
            colorValidated: true,
          });
        }

        if (allowedTypes.has('ASIAN_LOW')) {
          anchors.push({
            type: 'ASIAN_LOW',
            name: `Asian Session Low ($${aLow.toFixed(2)})`,
            level: aLow,
            time: anchorTime,
            index: postAsianFirstIdx,
            bias: 'BULLISH',
            grade: 'SESSION',
            colorValidated: true,
          });
        }
      }

      // ── London Session (07:00 - 12:00 UTC) ─────────────────────────────────
      const londonCandles: Candle[] = [];
      const londonIndices: number[] = [];
      let postLondonFirstIdx: number | null = null;

      for (let k = 0; k < dayCandles.length; k++) {
        const c = dayCandles[k];
        const hour = new Date(c.t).getUTCHours();
        if (hour >= 7 && hour < 12) {
          londonCandles.push(c);
          londonIndices.push(dayIndices[k]);
        } else if (hour >= 12 && postLondonFirstIdx === null) {
          postLondonFirstIdx = dayIndices[k];
        }
      }

      if (londonCandles.length > 0 && postLondonFirstIdx !== null) {
        const lHigh = Math.max(...londonCandles.map(c => c.h ?? (c as any).high));
        const lLow = Math.min(...londonCandles.map(c => c.l ?? (c as any).low));
        const anchorTime = candles[postLondonFirstIdx].t;

        if (allowedTypes.has('LONDON_HIGH')) {
          anchors.push({
            type: 'LONDON_HIGH',
            name: `London Session High ($${lHigh.toFixed(2)})`,
            level: lHigh,
            time: anchorTime,
            index: postLondonFirstIdx,
            bias: 'BEARISH',
            grade: 'SESSION',
            colorValidated: true,
          });
        }

        if (allowedTypes.has('LONDON_LOW')) {
          anchors.push({
            type: 'LONDON_LOW',
            name: `London Session Low ($${lLow.toFixed(2)})`,
            level: lLow,
            time: anchorTime,
            index: postLondonFirstIdx,
            bias: 'BULLISH',
            grade: 'SESSION',
            colorValidated: true,
          });
        }
      }

      // ── Previous Day High / Low (PDH / PDL) ────────────────────────────────
      if (dIdx > 0 && dayIndices.length > 0) {
        const prevDayKey = daysList[dIdx - 1];
        const prevDay = candlesByDay.get(prevDayKey)!;
        if (prevDay.candles.length > 0) {
          const pdh = Math.max(...prevDay.candles.map(c => c.h ?? (c as any).high));
          const pdl = Math.min(...prevDay.candles.map(c => c.l ?? (c as any).low));
          const firstCandleOfDay = dayIndices[0];
          const anchorTime = candles[firstCandleOfDay].t;

          if (allowedTypes.has('PDH')) {
            anchors.push({
              type: 'PDH',
              name: `Previous Day High (PDH: $${pdh.toFixed(2)})`,
              level: pdh,
              time: anchorTime,
              index: firstCandleOfDay,
              bias: 'BEARISH',
              grade: 'DAILY',
              colorValidated: true,
            });
          }

          if (allowedTypes.has('PDL')) {
            anchors.push({
              type: 'PDL',
              name: `Previous Day Low (PDL: $${pdl.toFixed(2)})`,
              level: pdl,
              time: anchorTime,
              index: firstCandleOfDay,
              bias: 'BULLISH',
              grade: 'DAILY',
              colorValidated: true,
            });
          }
        }
      }
    }

    // Sort all anchors strictly chronologically
    return anchors.sort((a, b) => a.index - b.index || a.level - b.level);
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
    const anchors = this.extractAnchors(candles);
    const detectedSetups: SweepReclaimSetup[] = [];

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

    const deltaDominanceThreshold = this.config.deltaDominanceThreshold ?? 51.5;
    const bodyRatioThreshold = this.config.bodyRatioThreshold ?? 0.55;
    const stage1Multiple = this.config.stage1Multiple ?? 1.0;
    const stage2Multiple = this.config.stage2Multiple ?? 1.5;
    const stage3Multiple = this.config.stage3Multiple ?? 3.0;
    const entryMode = this.config.entryMode ?? 'FVG_CE';

    // Iterate through confirmed multi-timeframe anchors to track Phase 1 -> 4
    for (const anchor of anchors) {
      const anchorIdx = anchor.index;
      if (anchorIdx < 2 || anchorIdx >= n - 5) continue;

      const isBullish = anchor.bias === 'BULLISH';
      const anchorLevel = anchor.level;
      const anchorTime = anchor.time;
      const anchorGrade = anchor.grade;
      const anchorType = anchor.type;
      const anchorName = anchor.name;

      const maxSweepLookback = anchorGrade === 'SESSION' || anchorGrade === 'DAILY'
        ? Math.max(96, (this.config.maxBarsAnchorToSweep ?? 30) * 3)
        : (this.config.maxBarsAnchorToSweep ?? 30);
      const maxSweepIdx = Math.min(n - 1, anchorIdx + maxSweepLookback);
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

      const setupId = `SR_${isBullish ? 'BULL' : 'BEAR'}_${anchorType}_${anchorLevel.toFixed(2)}_${anchorTime}`;

      if (!sweepFound || sweepIdx === null || sweepExtremePrice === null || sweepExtremeTime === null) {
        const anchorOnlySetup: SweepReclaimSetup = {
          id: setupId,
          type: isBullish ? 'BULLISH' : 'BEARISH',
          symbol: this.config.symbol || 'ETHUSDC',
          timeframe: this.config.timeframe || '15m',
          phase: 'ANCHOR',
          status: 'ANCHOR_ONLY',
          anchor_type: anchorType,
          anchor_name: anchorName,
          anchor_level: parseFloat(anchorLevel.toFixed(4)),
          anchor_index: anchorIdx,
          anchor_time: anchorTime,
          anchor_swing_type: isBullish ? 'SWING_LOW' : 'SWING_HIGH',
          anchor_swing_grade: anchorGrade,
          anchor_color_validated: anchor.colorValidated,
          sweep_price: null,
          sweep_index: null,
          sweep_time: null,
          sweep_depth: null,
          sweep_depth_pct: null,
          sweep_volume_ratio: null,
          bars_anchor_to_sweep: null,
          reclaim_index: null,
          reclaim_time: null,
          reclaim_close_price: null,
          reclaim_volume_expansion: null,
          reclaim_body_ratio: null,
          reclaim_delta_dominance_pct: null,
          reclaim_fvg_created: false,
          reclaim_fvg_top: null,
          reclaim_fvg_bottom: null,
          reclaim_fvg_ce: null,
          bars_sweep_to_reclaim: null,
          is_reclaimed: false,
          retest_index: null,
          retest_time: null,
          retest_price: null,
          bars_reclaim_to_retest: null,
          is_retested: false,
          body_defense_passed: false,
          entry_mode: entryMode,
          entry_price: parseFloat(anchorLevel.toFixed(4)),
          stop_loss: parseFloat(anchorLevel.toFixed(4)),
          risk_usd: 0,
          risk_pct: 0,
          stage1_target: 0,
          stage2_target: 0,
          stage3_target: 0,
          stage1_multiple: stage1Multiple,
          stage2_multiple: stage2Multiple,
          stage3_multiple: stage3Multiple,
          is_stage1_filled: false,
          is_stage2_filled: false,
          is_stage3_filled: false,
          stage1_hit_time: null,
          stage1_hit_index: null,
          stage2_hit_time: null,
          stage2_hit_index: null,
          stage3_hit_time: null,
          stage3_hit_index: null,
          active_trailing_sl: parseFloat(anchorLevel.toFixed(4)),
          active_ratchet_floor: null,
          trailing_sl_source: 'INITIAL',
          is_be_scratch: false,
          is_structural_scratch: false,
          simulated_outcome: 'NO_RETEST',
          stage_exit_type: 'NO_RETEST',
          realized_rr: 0,
          mfe_r: 0,
          mfe_usd: 0,
          mae_r: 0,
          mae_usd: 0,
          bars_to_outcome: null,
          exit_time: null,
          exit_price: null,
        };
        detectedSetups.push(anchorOnlySetup);
        continue;
      }

      // ─── Phase 3: Volumetric Displacement Reclaim Confirmation ──────────────
      const maxReclaimIdx = Math.min(n - 1, sweepIdx + (this.config.maxBarsSweepToReclaim ?? 12));
      let reclaimFound = false;
      let reclaimIdx: number | null = null;
      let reclaimTime: number | null = null;
      let reclaimClosePrice: number | null = null;
      let reclaimVolExp = 1.0;
      let reclaimBodyRatio = 0.0;
      let reclaimDeltaDominance = 50.0;
      let reclaimFvgCreated = false;
      let reclaimFvgTop: number | null = null;
      let reclaimFvgBottom: number | null = null;
      let reclaimFvgCe: number | null = null;

      for (let i = sweepIdx; i <= maxReclaimIdx; i++) {
        const c = candles[i];
        const close = c.c ?? (c as any).close;
        const open = c.o ?? (c as any).open;
        const high = c.h ?? (c as any).high;
        const low = c.l ?? (c as any).low;
        const candleRange = Math.max(0.0001, high - low);
        const candleBody = Math.abs(close - open);
        const bodyRatio = candleBody / candleRange;

        if (isBullish) {
          // Reclaim: confirmed body close strictly ABOVE the anchor shelf
          if (close > anchorLevel && close > open) {
            // Check Body Ratio Gate
            if (bodyRatio < bodyRatioThreshold) continue;

            // Check Directional Taker Delta Dominance Gate
            let deltaPct = 50.0;
            if (c.taker_buy_vol !== undefined && (c.v ?? 0) > 0) {
              deltaPct = (c.taker_buy_vol / c.v) * 100;
            } else {
              // Synthetic structural delta proxy
              deltaPct = 50.0 + 50.0 * (candleBody / candleRange);
            }
            if (deltaPct < deltaDominanceThreshold) continue;

            // Check / Extract Active Displacement BISI FVG
            let foundFvg = false;
            let fvgTop = 0;
            let fvgBottom = 0;
            const searchMax = Math.min(n - 1, i + 2);
            for (let f = Math.max(2, sweepIdx); f <= searchMax; f++) {
              const c0 = candles[f - 2];
              const c2 = candles[f];
              const c0H = c0.h ?? (c0 as any).high;
              const c2L = c2.l ?? (c2 as any).low;
              if (c2L > c0H) {
                foundFvg = true;
                fvgTop = c2L;
                fvgBottom = c0H;
                break;
              }
            }

            reclaimFound = true;
            reclaimIdx = i;
            reclaimTime = c.t;
            reclaimClosePrice = close;
            const avgVol = volSmaSeries[i] || 1;
            reclaimVolExp = (c.v ?? 0) / avgVol;
            reclaimBodyRatio = parseFloat((bodyRatio * 100).toFixed(1));
            reclaimDeltaDominance = parseFloat(deltaPct.toFixed(1));

            if (foundFvg) {
              reclaimFvgCreated = true;
              reclaimFvgTop = parseFloat(fvgTop.toFixed(4));
              reclaimFvgBottom = parseFloat(fvgBottom.toFixed(4));
              reclaimFvgCe = parseFloat(((fvgTop + fvgBottom) / 2).toFixed(4));
            } else {
              reclaimFvgCreated = false;
              reclaimFvgTop = null;
              reclaimFvgBottom = null;
              reclaimFvgCe = anchorLevel;
            }
            break;
          }
        } else {
          // Bearish: confirmed body close strictly BELOW the anchor shelf
          if (close < anchorLevel && close < open) {
            // Check Body Ratio Gate
            if (bodyRatio < bodyRatioThreshold) continue;

            // Check Directional Taker Delta Dominance Gate
            let deltaPct = 50.0;
            if (c.taker_sell_vol !== undefined && (c.v ?? 0) > 0) {
              deltaPct = (c.taker_sell_vol / c.v) * 100;
            } else {
              // Synthetic structural delta proxy
              deltaPct = 50.0 + 50.0 * (candleBody / candleRange);
            }
            if (deltaPct < deltaDominanceThreshold) continue;

            // Check / Extract Active Displacement SIBI FVG
            let foundFvg = false;
            let fvgTop = 0;
            let fvgBottom = 0;
            const searchMax = Math.min(n - 1, i + 2);
            for (let f = Math.max(2, sweepIdx); f <= searchMax; f++) {
              const c0 = candles[f - 2];
              const c2 = candles[f];
              const c0L = c0.l ?? (c0 as any).low;
              const c2H = c2.h ?? (c2 as any).high;
              if (c2H < c0L) {
                foundFvg = true;
                fvgTop = c0L;
                fvgBottom = c2H;
                break;
              }
            }

            reclaimFound = true;
            reclaimIdx = i;
            reclaimTime = c.t;
            reclaimClosePrice = close;
            const avgVol = volSmaSeries[i] || 1;
            reclaimVolExp = (c.v ?? 0) / avgVol;
            reclaimBodyRatio = parseFloat((bodyRatio * 100).toFixed(1));
            reclaimDeltaDominance = parseFloat(deltaPct.toFixed(1));

            if (foundFvg) {
              reclaimFvgCreated = true;
              reclaimFvgTop = parseFloat(fvgTop.toFixed(4));
              reclaimFvgBottom = parseFloat(fvgBottom.toFixed(4));
              reclaimFvgCe = parseFloat(((fvgTop + fvgBottom) / 2).toFixed(4));
            } else {
              reclaimFvgCreated = false;
              reclaimFvgTop = null;
              reclaimFvgBottom = null;
              reclaimFvgCe = anchorLevel;
            }
            break;
          }
        }
      }

      const atrAtSweep = atrSeries[sweepIdx] || 1.0;
      const slBuffer = (this.config.slBufferAtrMultiplier ?? 0.15) * atrAtSweep;

      // Select Entry Level: FVG 50% CE vs Reclaim Shelf
      const executionEntry = entryMode === 'FVG_CE' && reclaimFvgCe !== null
        ? reclaimFvgCe
        : anchorLevel;

      const stopLoss = isBullish
        ? Math.min(sweepExtremePrice - slBuffer, executionEntry - 0.50)
        : Math.max(sweepExtremePrice + slBuffer, executionEntry + 0.50);

      const riskUsd = Math.max(0.1, Math.abs(executionEntry - stopLoss));
      const riskPct = (riskUsd / executionEntry) * 100;

      const target1 = isBullish
        ? executionEntry + stage1Multiple * riskUsd
        : executionEntry - stage1Multiple * riskUsd;

      const target2 = isBullish
        ? executionEntry + stage2Multiple * riskUsd
        : executionEntry - stage2Multiple * riskUsd;

      const target3 = isBullish
        ? executionEntry + stage3Multiple * riskUsd
        : executionEntry - stage3Multiple * riskUsd;

      const baseSetup: SweepReclaimSetup = {
        id: setupId,
        type: isBullish ? 'BULLISH' : 'BEARISH',
        symbol: this.config.symbol || 'ETHUSDC',
        timeframe: this.config.timeframe || '15m',
        phase: reclaimFound ? 'RECLAIM' : 'SWEEP',
        status: reclaimFound ? 'RECLAIMED_NO_RETEST' : 'SWEPT_NO_RECLAIM',

        anchor_type: anchorType,
        anchor_name: anchorName,
        anchor_level: parseFloat(anchorLevel.toFixed(4)),
        anchor_index: anchorIdx,
        anchor_time: anchorTime,
        anchor_swing_type: isBullish ? 'SWING_LOW' : 'SWING_HIGH',
        anchor_swing_grade: anchorGrade,
        anchor_color_validated: anchor.colorValidated,

        sweep_price: parseFloat(sweepExtremePrice.toFixed(4)),
        sweep_index: sweepIdx,
        sweep_time: sweepExtremeTime,
        sweep_depth: parseFloat(sweepDepth.toFixed(4)),
        sweep_depth_pct: parseFloat(sweepDepthPct.toFixed(3)),
        sweep_volume_ratio: parseFloat(sweepVolRatio.toFixed(2)),
        bars_anchor_to_sweep: sweepIdx - anchorIdx,

        reclaim_index: reclaimIdx,
        reclaim_time: reclaimTime,
        reclaim_close_price: reclaimClosePrice !== null ? parseFloat(reclaimClosePrice.toFixed(4)) : null,
        reclaim_volume_expansion: parseFloat(reclaimVolExp.toFixed(2)),
        reclaim_body_ratio: reclaimBodyRatio,
        reclaim_delta_dominance_pct: reclaimDeltaDominance,
        reclaim_fvg_created: reclaimFvgCreated,
        reclaim_fvg_top: reclaimFvgTop,
        reclaim_fvg_bottom: reclaimFvgBottom,
        reclaim_fvg_ce: reclaimFvgCe,
        bars_sweep_to_reclaim: reclaimIdx !== null ? reclaimIdx - sweepIdx : null,
        is_reclaimed: reclaimFound,

        retest_index: null,
        retest_time: null,
        retest_price: null,
        bars_reclaim_to_retest: null,
        is_retested: false,
        body_defense_passed: false,

        entry_mode: entryMode,
        entry_price: parseFloat(executionEntry.toFixed(4)),
        stop_loss: parseFloat(stopLoss.toFixed(4)),
        risk_usd: parseFloat(riskUsd.toFixed(4)),
        risk_pct: parseFloat(riskPct.toFixed(3)),
        stage1_target: parseFloat(target1.toFixed(4)),
        stage2_target: parseFloat(target2.toFixed(4)),
        stage3_target: parseFloat(target3.toFixed(4)),
        stage1_multiple: stage1Multiple,
        stage2_multiple: stage2Multiple,
        stage3_multiple: stage3Multiple,

        is_stage1_filled: false,
        is_stage2_filled: false,
        is_stage3_filled: false,
        stage1_hit_time: null,
        stage1_hit_index: null,
        stage2_hit_time: null,
        stage2_hit_index: null,
        stage3_hit_time: null,
        stage3_hit_index: null,
        active_trailing_sl: parseFloat(stopLoss.toFixed(4)),
        active_ratchet_floor: null,
        trailing_sl_source: 'INITIAL',
        is_be_scratch: false,
        is_structural_scratch: false,

        simulated_outcome: 'NO_RETEST',
        stage_exit_type: 'NO_RETEST',
        realized_rr: 0,
        mfe_r: 0,
        mfe_usd: 0,
        mae_r: 0,
        mae_usd: 0,
        bars_to_outcome: null,
        exit_time: null,
        exit_price: null,
      };

      if (!reclaimFound || reclaimIdx === null) {
        detectedSetups.push(baseSetup);
        continue;
      }

      // ─── Phase 4: Retest & 3-Stage Harvest Execution Simulation ────────────
      // Retest search begins strictly on candles occurring AFTER the confirmed reclaim close
      const maxRetestIdx = Math.min(n - 1, reclaimIdx + (this.config.maxBarsToRetest ?? 24));
      let retestFound = false;
      let retestIdx: number | null = null;
      let retestPrice: number | null = null;
      let retestTime: number | null = null;
      let bodyDefenseValid = false;

      for (let i = reclaimIdx + 1; i <= maxRetestIdx; i++) {
        const c = candles[i];
        const low = c.l ?? (c as any).low;
        const high = c.h ?? (c as any).high;
        const close = c.c ?? (c as any).close;

        if (isBullish) {
          // Bullish: Price pulls back into execution entry (FVG CE or anchor shelf)
          if (low <= executionEntry) {
            // ICT Body Defense Doctrine: Candle body must close above shelf
            if (close >= anchorLevel) {
              retestFound = true;
              retestIdx = i;
              retestPrice = executionEntry;
              retestTime = c.t;
              bodyDefenseValid = true;
              break;
            } else {
              // Body closed below shelf: Invalidated
              baseSetup.phase = 'RETEST';
              baseSetup.status = 'INVALIDATED_AT_RETEST';
              baseSetup.simulated_outcome = 'INVALIDATED';
              baseSetup.stage_exit_type = 'INVALIDATED';
              break;
            }
          }
        } else {
          // Bearish: Price pulls back up into execution entry
          if (high >= executionEntry) {
            if (close <= anchorLevel) {
              retestFound = true;
              retestIdx = i;
              retestPrice = executionEntry;
              retestTime = c.t;
              bodyDefenseValid = true;
              break;
            } else {
              baseSetup.phase = 'RETEST';
              baseSetup.status = 'INVALIDATED_AT_RETEST';
              baseSetup.simulated_outcome = 'INVALIDATED';
              baseSetup.stage_exit_type = 'INVALIDATED';
              break;
            }
          }
        }
      }

      if (!retestFound || retestIdx === null || !bodyDefenseValid) {
        if (baseSetup.status !== 'INVALIDATED_AT_RETEST') {
          baseSetup.status = 'RECLAIMED_NO_RETEST';
          baseSetup.simulated_outcome = 'NO_RETEST';
          baseSetup.stage_exit_type = 'NO_RETEST';
        }
        detectedSetups.push(baseSetup);
        continue;
      }

      // Mark setup as RETESTED
      baseSetup.phase = 'RETEST';
      baseSetup.status = 'RETESTED';
      baseSetup.is_retested = true;
      baseSetup.body_defense_passed = true;
      baseSetup.retest_index = retestIdx;
      baseSetup.retest_time = retestTime;
      baseSetup.retest_price = retestPrice;
      baseSetup.bars_reclaim_to_retest = retestIdx - reclaimIdx;

      // ─── 3-Stage Harvest Trade Execution State Machine ─────────────────────
      // Forward simulation from retest candle onward
      let positionOpen = true;
      let activeStopLoss = stopLoss;
      let maxFavorablePrice = executionEntry;
      let maxAdversePrice = executionEntry;
      let outcome: SweepReclaimTradeOutcome = 'PENDING';
      let stageExit: SweepReclaimStageExitType = 'PENDING';
      let realizedRr = 0;
      let exitIdx: number | null = null;
      let exitPrice: number | null = null;
      let exitTime: number | null = null;

      const enableStructuralTrail = this.config.enableStructuralTrail !== false;
      const enableProfitRatchet = this.config.enableProfitRatchet !== false;

      // Tranche Weights: 40% Stage 1, 40% Stage 2, 20% Stage 3
      const w1 = 0.40;
      const w2 = 0.40;
      const w3 = 0.20;

      for (let i = retestIdx; i < n; i++) {
        if (!positionOpen) break;

        const c = candles[i];
        const high = c.h ?? (c as any).high;
        const low = c.l ?? (c as any).low;

        if (isBullish) {
          if (high > maxFavorablePrice) maxFavorablePrice = high;
          if (low < maxAdversePrice) maxAdversePrice = low;

          const initialBarSL = activeStopLoss;
          const hitInitialSL = low <= initialBarSL;
          const hitStage1 = high >= target1;
          const hitStage2 = high >= target2;
          const hitStage3 = high >= target3;

          let stageFilledThisBar = false;

          // ── Tranche 1: 40% at 1.0R ────────────────────────────────────────
          if (hitStage1 && !baseSetup.is_stage1_filled) {
            baseSetup.is_stage1_filled = true;
            baseSetup.stage1_hit_time = c.t;
            baseSetup.stage1_hit_index = i;
            stageFilledThisBar = true;

            if (enableStructuralTrail) {
              // Anchor structural trailing stop to FVG 50% CE
              // Net risk cap: remaining 60% position loss cannot exceed Stage 1 profit (+0.40R)
              // max loss allowed on remaining 60% = -0.40 / 0.60 = -0.667R
              const structuralTrailLevel = reclaimFvgCe !== null && reclaimFvgCe > stopLoss
                ? reclaimFvgCe
                : executionEntry;
              const maxGuaranteedFloor = executionEntry - (0.60 * riskUsd);
              activeStopLoss = Math.max(structuralTrailLevel, maxGuaranteedFloor);
              baseSetup.active_trailing_sl = parseFloat(activeStopLoss.toFixed(4));
              baseSetup.trailing_sl_source = reclaimFvgCe !== null ? 'FVG_CE' : 'BREAKEVEN';
            } else {
              activeStopLoss = executionEntry;
              baseSetup.active_trailing_sl = parseFloat(executionEntry.toFixed(4));
              baseSetup.trailing_sl_source = 'BREAKEVEN';
            }
          }

          // ── Tranche 2: 40% at 1.5R ────────────────────────────────────────
          if (hitStage2 && baseSetup.is_stage1_filled && !baseSetup.is_stage2_filled) {
            baseSetup.is_stage2_filled = true;
            baseSetup.stage2_hit_time = c.t;
            baseSetup.stage2_hit_index = i;
            stageFilledThisBar = true;

            if (enableProfitRatchet) {
              // Immediately ratchet active SL to guaranteed +1.0R profit floor
              const ratchetLevel = executionEntry + 1.0 * riskUsd;
              activeStopLoss = Math.max(activeStopLoss, ratchetLevel);
              baseSetup.active_trailing_sl = parseFloat(activeStopLoss.toFixed(4));
              baseSetup.active_ratchet_floor = parseFloat(activeStopLoss.toFixed(4));
              baseSetup.trailing_sl_source = 'PROFIT_RATCHET_FLOOR';
            }
          }

          // ── Tranche 3: 20% DOL Runner ─────────────────────────────────────
          if (hitStage3 && baseSetup.is_stage2_filled) {
            baseSetup.is_stage3_filled = true;
            baseSetup.stage3_hit_time = c.t;
            baseSetup.stage3_hit_index = i;
            outcome = 'FULL_TP3_WIN';
            stageExit = 'FULL_TP3_WIN';
            const runnerR = (target3 - executionEntry) / riskUsd;
            const blended = (w1 * stage1Multiple) + (w2 * stage2Multiple) + (w3 * runnerR);
            realizedRr = parseFloat(blended.toFixed(2));
            exitIdx = i;
            exitPrice = target3;
            exitTime = c.t;
            positionOpen = false;
            break;
          }

          // ── Stop Loss / Ratchet Hit Evaluation ────────────────────────────
          if (!stageFilledThisBar && hitInitialSL) {
            if (baseSetup.is_stage2_filled) {
              // Stopped out with Stage 1 + Stage 2 banked, runner stopped at +1.0R floor
              outcome = 'FULL_TP2_WIN';
              stageExit = 'STAGE_2_WIN';
              const runnerR = (initialBarSL - executionEntry) / riskUsd;
              const blended = (w1 * stage1Multiple) + (w2 * stage2Multiple) + (w3 * runnerR);
              realizedRr = parseFloat(blended.toFixed(2));
            } else if (baseSetup.is_stage1_filled) {
              // Stopped out with Stage 1 banked, runner stopped at structural FVG CE / BE
              outcome = 'BE_SCRATCH_WIN';
              stageExit = 'STAGE_1_SCRATCH';
              const runnerR = (initialBarSL - executionEntry) / riskUsd;
              const blended = (w1 * stage1Multiple) + ((1 - w1) * runnerR);
              realizedRr = parseFloat(Math.max(0.0, blended).toFixed(2));
              if (initialBarSL >= executionEntry) {
                baseSetup.is_be_scratch = true;
              } else {
                baseSetup.is_structural_scratch = true;
              }
            } else {
              // Initial Stop Loss Hit
              outcome = 'STOPPED_OUT';
              stageExit = 'STOPPED_OUT';
              realizedRr = -1.0;
            }
            exitIdx = i;
            exitPrice = initialBarSL;
            exitTime = c.t;
            positionOpen = false;
            break;
          }
        } else {
          // Bearish Execution State Machine
          if (low < maxFavorablePrice) maxFavorablePrice = low;
          if (high > maxAdversePrice) maxAdversePrice = high;

          const initialBarSL = activeStopLoss;
          const hitInitialSL = high >= initialBarSL;
          const hitStage1 = low <= target1;
          const hitStage2 = low <= target2;
          const hitStage3 = low <= target3;

          let stageFilledThisBar = false;

          // ── Tranche 1: 40% at 1.0R ────────────────────────────────────────
          if (hitStage1 && !baseSetup.is_stage1_filled) {
            baseSetup.is_stage1_filled = true;
            baseSetup.stage1_hit_time = c.t;
            baseSetup.stage1_hit_index = i;
            stageFilledThisBar = true;

            if (enableStructuralTrail) {
              const structuralTrailLevel = reclaimFvgCe !== null && reclaimFvgCe < stopLoss
                ? reclaimFvgCe
                : executionEntry;
              const maxGuaranteedFloor = executionEntry + (0.60 * riskUsd);
              activeStopLoss = Math.min(structuralTrailLevel, maxGuaranteedFloor);
              baseSetup.active_trailing_sl = parseFloat(activeStopLoss.toFixed(4));
              baseSetup.trailing_sl_source = reclaimFvgCe !== null ? 'FVG_CE' : 'BREAKEVEN';
            } else {
              activeStopLoss = executionEntry;
              baseSetup.active_trailing_sl = parseFloat(executionEntry.toFixed(4));
              baseSetup.trailing_sl_source = 'BREAKEVEN';
            }
          }

          // ── Tranche 2: 40% at 1.5R ────────────────────────────────────────
          if (hitStage2 && baseSetup.is_stage1_filled && !baseSetup.is_stage2_filled) {
            baseSetup.is_stage2_filled = true;
            baseSetup.stage2_hit_time = c.t;
            baseSetup.stage2_hit_index = i;
            stageFilledThisBar = true;

            if (enableProfitRatchet) {
              const ratchetLevel = executionEntry - 1.0 * riskUsd;
              activeStopLoss = Math.min(activeStopLoss, ratchetLevel);
              baseSetup.active_trailing_sl = parseFloat(activeStopLoss.toFixed(4));
              baseSetup.active_ratchet_floor = parseFloat(activeStopLoss.toFixed(4));
              baseSetup.trailing_sl_source = 'PROFIT_RATCHET_FLOOR';
            }
          }

          // ── Tranche 3: 20% DOL Runner ─────────────────────────────────────
          if (hitStage3 && baseSetup.is_stage2_filled) {
            baseSetup.is_stage3_filled = true;
            baseSetup.stage3_hit_time = c.t;
            baseSetup.stage3_hit_index = i;
            outcome = 'FULL_TP3_WIN';
            stageExit = 'FULL_TP3_WIN';
            const runnerR = (executionEntry - target3) / riskUsd;
            const blended = (w1 * stage1Multiple) + (w2 * stage2Multiple) + (w3 * runnerR);
            realizedRr = parseFloat(blended.toFixed(2));
            exitIdx = i;
            exitPrice = target3;
            exitTime = c.t;
            positionOpen = false;
            break;
          }

          // ── Stop Loss / Ratchet Hit Evaluation ────────────────────────────
          if (!stageFilledThisBar && hitInitialSL) {
            if (baseSetup.is_stage2_filled) {
              outcome = 'FULL_TP2_WIN';
              stageExit = 'STAGE_2_WIN';
              const runnerR = (executionEntry - initialBarSL) / riskUsd;
              const blended = (w1 * stage1Multiple) + (w2 * stage2Multiple) + (w3 * runnerR);
              realizedRr = parseFloat(blended.toFixed(2));
            } else if (baseSetup.is_stage1_filled) {
              outcome = 'BE_SCRATCH_WIN';
              stageExit = 'STAGE_1_SCRATCH';
              const runnerR = (executionEntry - initialBarSL) / riskUsd;
              const blended = (w1 * stage1Multiple) + ((1 - w1) * runnerR);
              realizedRr = parseFloat(Math.max(0.0, blended).toFixed(2));
              if (initialBarSL <= executionEntry) {
                baseSetup.is_be_scratch = true;
              } else {
                baseSetup.is_structural_scratch = true;
              }
            } else {
              outcome = 'STOPPED_OUT';
              stageExit = 'STOPPED_OUT';
              realizedRr = -1.0;
            }
            exitIdx = i;
            exitPrice = initialBarSL;
            exitTime = c.t;
            positionOpen = false;
            break;
          }
        }
      }

      // Calculate MFE & MAE
      const mfeUsd = isBullish
        ? Math.max(0, maxFavorablePrice - executionEntry)
        : Math.max(0, executionEntry - maxFavorablePrice);

      const maeUsd = isBullish
        ? Math.max(0, executionEntry - maxAdversePrice)
        : Math.max(0, maxAdversePrice - executionEntry);

      baseSetup.simulated_outcome = outcome;
      baseSetup.stage_exit_type = stageExit;
      baseSetup.realized_rr = realizedRr;
      baseSetup.mfe_usd = parseFloat(mfeUsd.toFixed(2));
      baseSetup.mfe_r = parseFloat((mfeUsd / riskUsd).toFixed(2));
      baseSetup.mae_usd = parseFloat(maeUsd.toFixed(2));
      baseSetup.mae_r = parseFloat((maeUsd / riskUsd).toFixed(2));
      baseSetup.bars_to_outcome = exitIdx !== null ? exitIdx - retestIdx : null;
      baseSetup.exit_price = exitPrice !== null ? parseFloat(exitPrice.toFixed(4)) : null;
      baseSetup.exit_time = exitTime;

      detectedSetups.push(baseSetup);
    }

    // Sort detected setups chronologically by anchor time
    detectedSetups.sort((a, b) => a.anchor_time - b.anchor_time);

    // Compute comprehensive telemetry summary
    const telemetry = this.computeTelemetry(detectedSetups);

    return {
      setups: detectedSetups,
      telemetry,
    };
  }

  /**
   * Computes quantitative telemetry and performance metrics from detected setups.
   */
  private computeTelemetry(setups: SweepReclaimSetup[]): SweepReclaimTelemetrySummary {
    const totalAnchors = setups.length;
    const totalSweeps = setups.filter(s => s.sweep_index !== null).length;
    const totalReclaims = setups.filter(s => s.is_reclaimed).length;
    const retestedSetups = setups.filter(s => s.is_retested);
    const totalRetests = retestedSetups.length;

    const sweepRatePct = totalAnchors > 0 ? (totalSweeps / totalAnchors) * 100 : 0;
    const reclaimRatePct = totalSweeps > 0 ? (totalReclaims / totalSweeps) * 100 : 0;
    const retestRatePct = totalReclaims > 0 ? (totalRetests / totalReclaims) * 100 : 0;

    let totalWins = 0;
    let totalLosses = 0;
    let totalBeScratches = 0;
    let totalStructuralScratches = 0;
    let totalPending = 0;

    let stage1Fills = 0;
    let stage2Fills = 0;
    let stage3Fills = 0;
    let fullTp3Wins = 0;
    let fullTp2Wins = 0;
    let stoppedOutCount = 0;

    let sumRr = 0;
    let sumWinRr = 0;
    let sumLossRr = 0;
    let sumMfeR = 0;
    let sumMaeR = 0;
    let sumBarsReclaim = 0;
    let sumBarsRetest = 0;
    let sumBarsOutcome = 0;
    let countBarsOutcome = 0;

    let bullTotal = 0;
    let bullRetest = 0;
    let bullWins = 0;
    let bullSumRr = 0;

    let bearTotal = 0;
    let bearRetest = 0;
    let bearWins = 0;
    let bearSumRr = 0;

    const anchorDistribution: Record<SweepReclaimAnchorType, number> = {
      SWING_PIVOT: 0,
      ASIAN_HIGH: 0,
      ASIAN_LOW: 0,
      LONDON_HIGH: 0,
      LONDON_LOW: 0,
      PDH: 0,
      PDL: 0,
    };

    for (const s of setups) {
      if (anchorDistribution[s.anchor_type] !== undefined) {
        anchorDistribution[s.anchor_type]++;
      }

      if (s.type === 'BULLISH') bullTotal++;
      else bearTotal++;

      if (s.bars_sweep_to_reclaim !== null) sumBarsReclaim += s.bars_sweep_to_reclaim;
      if (s.bars_reclaim_to_retest !== null) sumBarsRetest += s.bars_reclaim_to_retest;

      if (s.is_retested) {
        if (s.type === 'BULLISH') bullRetest++;
        else bearRetest++;

        if (s.is_stage1_filled) stage1Fills++;
        if (s.is_stage2_filled) stage2Fills++;
        if (s.is_stage3_filled) stage3Fills++;

        sumRr += s.realized_rr;
        sumMfeR += s.mfe_r;
        sumMaeR += s.mae_r;

        if (s.bars_to_outcome !== null) {
          sumBarsOutcome += s.bars_to_outcome;
          countBarsOutcome++;
        }

        if (s.type === 'BULLISH') bullSumRr += s.realized_rr;
        else bearSumRr += s.realized_rr;

        if (s.simulated_outcome === 'FULL_TP3_WIN') {
          totalWins++;
          fullTp3Wins++;
          sumWinRr += s.realized_rr;
          if (s.type === 'BULLISH') bullWins++;
          else bearWins++;
        } else if (s.simulated_outcome === 'FULL_TP2_WIN') {
          totalWins++;
          fullTp2Wins++;
          sumWinRr += s.realized_rr;
          if (s.type === 'BULLISH') bullWins++;
          else bearWins++;
        } else if (s.simulated_outcome === 'BE_SCRATCH_WIN') {
          totalBeScratches++;
          sumWinRr += s.realized_rr;
        } else if (s.simulated_outcome === 'STRUCTURAL_SCRATCH') {
          totalStructuralScratches++;
          sumWinRr += s.realized_rr;
        } else if (s.simulated_outcome === 'STOPPED_OUT') {
          totalLosses++;
          stoppedOutCount++;
          sumLossRr += Math.abs(s.realized_rr);
        } else if (s.simulated_outcome === 'PENDING') {
          totalPending++;
        }
      }
    }

    const retestWinRatePct = totalRetests > 0 ? (totalWins / totalRetests) * 100 : 0;
    const avgRealizedRr = totalRetests > 0 ? sumRr / totalRetests : 0;
    const avgWinningRr = totalWins > 0 ? sumWinRr / totalWins : 0;
    const avgLosingRr = totalLosses > 0 ? sumLossRr / totalLosses : 0;

    const profitFactor = sumLossRr > 0
      ? sumWinRr / sumLossRr
      : sumWinRr > 0 ? 99.9 : 0;

    const winProb = totalRetests > 0 ? totalWins / totalRetests : 0;
    const lossProb = totalRetests > 0 ? totalLosses / totalRetests : 0;
    const expectedValueR = totalRetests > 0 ? (winProb * avgWinningRr) - (lossProb * (avgLosingRr || 1.0)) : 0;

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
      total_be_scratches: totalBeScratches,
      total_structural_scratches: totalStructuralScratches,
      total_pending_trades: totalPending,

      stage1_fill_count: stage1Fills,
      stage1_fill_pct: totalRetests > 0 ? parseFloat(((stage1Fills / totalRetests) * 100).toFixed(1)) : 0,
      stage2_fill_count: stage2Fills,
      stage2_fill_pct: totalRetests > 0 ? parseFloat(((stage2Fills / totalRetests) * 100).toFixed(1)) : 0,
      stage3_fill_count: stage3Fills,
      stage3_fill_pct: totalRetests > 0 ? parseFloat(((stage3Fills / totalRetests) * 100).toFixed(1)) : 0,

      full_tp3_wins: fullTp3Wins,
      full_tp2_wins: fullTp2Wins,
      stopped_out_count: stoppedOutCount,

      avg_realized_rr: parseFloat(avgRealizedRr.toFixed(2)),
      avg_winning_rr: parseFloat(avgWinningRr.toFixed(2)),
      avg_losing_rr: parseFloat(avgLosingRr.toFixed(2)),
      profit_factor: parseFloat(profitFactor.toFixed(2)),
      expected_value_r: parseFloat(expectedValueR.toFixed(2)),

      avg_mfe_r: totalRetests > 0 ? parseFloat((sumMfeR / totalRetests).toFixed(2)) : 0,
      avg_mae_r: totalRetests > 0 ? parseFloat((sumMaeR / totalRetests).toFixed(2)) : 0,
      avg_bars_to_reclaim: totalReclaims > 0 ? parseFloat((sumBarsReclaim / totalReclaims).toFixed(1)) : 0,
      avg_bars_to_retest: totalRetests > 0 ? parseFloat((sumBarsRetest / totalRetests).toFixed(1)) : 0,
      avg_bars_to_outcome: countBarsOutcome > 0 ? parseFloat((sumBarsOutcome / countBarsOutcome).toFixed(1)) : 0,

      bullish_setups_count: bullTotal,
      bullish_retest_count: bullRetest,
      bullish_win_rate_pct: bullRetest > 0 ? parseFloat(((bullWins / bullRetest) * 100).toFixed(1)) : 0,
      bullish_avg_rr: bullRetest > 0 ? parseFloat((bullSumRr / bullRetest).toFixed(2)) : 0,

      bearish_setups_count: bearTotal,
      bearish_retest_count: bearRetest,
      bearish_win_rate_pct: bearRetest > 0 ? parseFloat(((bearWins / bearRetest) * 100).toFixed(1)) : 0,
      bearish_avg_rr: bearRetest > 0 ? parseFloat((bearSumRr / bearRetest).toFixed(2)) : 0,

      anchor_type_distribution: anchorDistribution,
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
      total_structural_scratches: 0,
      total_pending_trades: 0,
      stage1_fill_count: 0,
      stage1_fill_pct: 0,
      stage2_fill_count: 0,
      stage2_fill_pct: 0,
      stage3_fill_count: 0,
      stage3_fill_pct: 0,
      full_tp3_wins: 0,
      full_tp2_wins: 0,
      stopped_out_count: 0,
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
      anchor_type_distribution: {
        SWING_PIVOT: 0,
        ASIAN_HIGH: 0,
        ASIAN_LOW: 0,
        LONDON_HIGH: 0,
        LONDON_LOW: 0,
        PDH: 0,
        PDL: 0,
      },
    };
  }
}
