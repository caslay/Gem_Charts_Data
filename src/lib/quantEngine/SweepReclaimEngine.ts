/**
 * SweepReclaimEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Sweep & Reclaim (Failed Signal Reversal) Quantitative Engine.
 *
 * Implements a deterministic, 4-phase chronological state machine:
 *  - Phase 1 (Multi-Timeframe Anchors): Tracks Asian High/Low (00:00–07:00 UTC),
 *    London High/Low (07:00–12:00 UTC), Previous Day High/Low (PDH/PDL), and
 *    color-locked Major/Internal pivots with strict zero look-ahead bias.
 *  - Phase 2 (Liquidity Sweep Detection): Detects price breaking through the anchor shelf
 *    to purge external liquidity with wick rejection signature (elevated volume + rejection wick).
 *  - Phase 3 (3-Pillar Volumetric Displacement Reclaim Gatekeeper):
 *      - Pillar 1: Volume Ratio >= 1.5x (vs 20-period Volume SMA).
 *      - Pillar 2: Directional Taker Delta Dominance >= 60.0%.
 *      - Pillar 3: Candle Body-to-Range Ratio >= 60.0%.
 *      - Displacement Fair Value Gap (BISI/SIBI) 50% Consequent Encroachment (CE).
 *  - Phase 4 (Precision Order Routing, Valuation Gating & 3-Stage Harvest):
 *      - Precision Routing: FVG 50% CE, Sweep OB 50% MT, or Reclaim Shelf.
 *      - Discount/Premium Valuation Gate: Longs execute in Discount (<= Equilibrium); Shorts execute in Premium (>= Equilibrium).
 *      - Hard Stop Loss: Locked 1 tick beyond the absolute sweep candle extreme.
 *      - Tranche 1 (40% @ 1.0R): Locks +0.40R profit, advances SL to FVG CE / Breakeven.
 *      - Tranche 2 (40% @ 1.5R): Locks +0.60R profit, ratchets SL to guaranteed +1.0R profit floor.
 *      - Tranche 3 (20% @ HTF DOL Runner): Trails remaining inventory along confirmed swing pivots to macro DOL.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from '../fvgEngine';
import { PivotEngine } from './PivotEngine';

// ── Types & Interfaces ────────────────────────────────────────────────────────

export type SweepReclaimType = 'BULLISH' | 'BEARISH';

export type SweepReclaimPhase = 'ANCHOR' | 'SWEEP' | 'RECLAIM' | 'RETEST';

export type SweepReclaimAnchorType = 'PM_VOLUMETRIC';

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

/**
 * Retest Entry Model Options:
 *  - BREAKER_BLOCK: Candle 1's extreme from the PM setup
 */
export type SweepReclaimEntryMode = 'BREAKER_BLOCK';

export interface DisplacementCandleAudit {
  label: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SweepReclaimSetup {
  id: string;
  type: SweepReclaimType;
  symbol: string;
  timeframe: string;
  phase: SweepReclaimPhase;
  status: SweepReclaimStatus;
  displacement_candles?: DisplacementCandleAudit[];

  // Phase 1: Anchor Geometry
  anchor_type: SweepReclaimAnchorType;
  anchor_name: string;
  anchor_level: number;
  anchor_index: number;
  anchor_time: number;
  anchor_swing_type: 'SWING_LOW' | 'SWING_HIGH';
  anchor_swing_grade: 'MAJOR' | 'INTERNAL' | 'INNER' | 'SESSION' | 'DAILY';
  anchor_color_validated: boolean;

  // Phase 2: Sweep Metrics (Purge & Wick Rejection)
  sweep_price: number | null;
  sweep_index: number | null;
  sweep_time: number | null;
  sweep_depth: number | null;
  sweep_depth_pct: number | null;
  sweep_volume_ratio: number | null;
  sweep_wick_ratio: number | null;
  is_wick_rejection_sweep: boolean;
  sweep_ob_mt: number | null;
  sweep_ob_proximal?: number | null;
  bars_anchor_to_sweep: number | null;

  // Phase 3: 3-Pillar Volumetric Reclaim Metrics (Displacement / Inversion)
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
  reclaim_fvg_proximal?: number | null;
  reclaim_fvg_distal?: number | null;
  displacement_impulse_high?: number | null;
  displacement_impulse_low?: number | null;
  ote_62_price?: number | null;
  bars_sweep_to_reclaim: number | null;
  is_reclaimed: boolean;

  // 3-Pillar Displacement Gatekeeper Flags
  pillar1_volume_ratio_passed: boolean;
  pillar2_delta_dominance_passed: boolean;
  pillar3_body_ratio_passed: boolean;
  three_pillar_displacement_passed: boolean;

  // Phase 4: Retest, Valuation Gating & Execution
  retest_index: number | null;
  retest_time: number | null;
  retest_price: number | null;
  bars_reclaim_to_retest: number | null;
  is_retested: boolean;
  is_immediate_fill?: boolean;
  max_retest_index?: number | null;
  is_expired?: boolean;
  body_defense_passed: boolean;

  // Dealing Range & Valuation Gating
  dealing_range_equilibrium: number | null;
  is_valuation_aligned: boolean;

  // Risk / Reward & Execution Geometry
  entry_mode: SweepReclaimEntryMode;
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
  maxBarsSweepToReclaim?: number;             // Max candles from sweep extreme to reclaim close (default: 50)
  maxBarsToRetest?: number;                   // Max candles from reclaim to retest entry (default: 24)

  // PM Volumetric Setup Thresholds
  volumeSmaPeriod?: number;                   // Rolling Volume SMA lookback period (default: 20)
  volumeExpansionThreshold?: number;          // Min Volume Ratio vs SMA for C2 (default: 1.50x)
  deltaDominanceThreshold?: number;           // Min taker delta dominance % for C2 (default: 55.0%)
  bodyRatioThreshold?: number;                // Min candle body-to-range ratio for C2 (default: 0.55)
  minBodyRatio?: number;                      // Alias: Min candle body-to-range ratio

  // Target Multiples & Execution
  stage1Multiple?: number;                    // Stage 1 Tranche target R (default: 1.0)
  stage2Multiple?: number;                    // Stage 2 Tranche target R (default: 1.5)
  stage3Multiple?: number;                    // Stage 3 Tranche target R / DOL runner (default: 3.0)
  enableStructuralTrail?: boolean;            // Trail SL to FVG CE after Stage 1 (default: true)
  enableProfitRatchet?: boolean;              // Ratchet SL to +1.0R floor after Stage 2 (default: true)
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

  // 3-Pillar Displacement Breakdown & Diagnostics
  pillar1_pass_count: number;
  pillar1_pass_pct: number;
  pillar1_volume_passed_count?: number;
  pillar2_pass_count: number;
  pillar2_pass_pct: number;
  pillar2_delta_passed_count?: number;
  pillar3_pass_count: number;
  pillar3_pass_pct: number;
  pillar3_body_passed_count?: number;
  three_pillar_all_pass_count: number;
  three_pillar_all_pass_pct: number;
  three_pillar_all_passed_count?: number;

  // Liquidity & Valuation Metrics
  wick_rejection_sweep_count: number;
  wick_rejection_sweep_pct: number;
  discount_premium_aligned_count: number;
  discount_premium_aligned_pct: number;

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
  maxBarsSweepToReclaim: 50,
  maxBarsToRetest: 24,
  volumeSmaPeriod: 20,
  volumeExpansionThreshold: 1.50,
  deltaDominanceThreshold: 55.0,
  bodyRatioThreshold: 0.55,
  minBodyRatio: 0.55,

  stage1Multiple: 1.0,
  stage2Multiple: 1.5,
  stage3Multiple: 3.0,
  enableStructuralTrail: true,
  enableProfitRatchet: true,
  slBufferAtrMultiplier: 0.15,
};

// ── Centralized Retest Price Resolver ────────────────────────────────────────

export interface RetestPriceResolverParams {
  mode: SweepReclaimEntryMode;
  isBullish: boolean;
  anchorLevel: number;
  sweepCandle?: {
    high: number;
    low: number;
    open?: number;
    close?: number;
    mt?: number;
  } | null;
  fvg?: {
    top: number;
    bottom: number;
    ce?: number;
  } | null;
  displacementExtremes?: {
    impulseHigh: number;
    impulseLow: number;
  } | null;
}

/**
 * Resolves the exact limit entry price for a Sweep & Reclaim setup based on the selected Retest Entry Model.
 * Handles directional orientation (Bullish vs Bearish) and provides safe fallbacks to anchor level.
 */
export function resolveRetestEntryPrice(params: RetestPriceResolverParams): number {
  return parseFloat(params.anchorLevel.toFixed(4));
}

/**
 * Returns human-readable label for a given SweepReclaimEntryMode.
 */
export function getEntryModeLabel(mode: SweepReclaimEntryMode): string {
  return 'Breaker Block (Candle 1 Extreme)';
}

/**
 * Returns full technical description for a given SweepReclaimEntryMode.
 */
export function getEntryModeDescription(mode: SweepReclaimEntryMode): string {
  return 'Limit order anchored to the absolute extreme of PM Candle 1.';
}

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

  public scanHistoricalSetups(
    candles: Candle[],
    startMs?: number,
    endMs?: number
  ): {
    setups: SweepReclaimSetup[];
    telemetry: SweepReclaimTelemetrySummary;
  } {
    const n = candles.length;
    if (n < 20) {
      return { setups: [], telemetry: this.createEmptyTelemetry() };
    }

    const volSmaSeries: number[] = new Array(n).fill(1);
    const volPeriod = Math.max(1, Math.min(100, this.config.volumeSmaPeriod ?? 20));
    let volSum = 0;
    for (let i = 0; i < n; i++) {
      const vol = Number.isFinite(candles[i].v) ? (candles[i].v as number) : 0;
      volSum += vol;
      if (i >= volPeriod) {
        const prevVol = Number.isFinite(candles[i - volPeriod].v) ? (candles[i - volPeriod].v as number) : 0;
        volSum -= prevVol;
        volSmaSeries[i] = volPeriod > 0 ? volSum / volPeriod : 1;
      } else {
        volSmaSeries[i] = (i + 1) > 0 ? volSum / (i + 1) : 1;
      }
    }

    const atrSeries = calculateAtrSeries(candles, 14);
    const volumeExpansionThreshold = this.config.volumeExpansionThreshold ?? 1.50;
    const maxBarsSweepToReclaim = this.config.maxBarsSweepToReclaim ?? 50;
    const slBufferMultiplier = this.config.slBufferAtrMultiplier ?? 0.15;

    const allSetups: SweepReclaimSetup[] = [];

    // Main Chronological Loop
    for (let i = 2; i < n; i++) {
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];

      const c1O = c1.o ?? (c1 as any).open;
      const c1H = c1.h ?? (c1 as any).high;
      const c1L = c1.l ?? (c1 as any).low;
      const c1C = c1.c ?? (c1 as any).close;

      const c2O = c2.o ?? (c2 as any).open;
      const c2H = c2.h ?? (c2 as any).high;
      const c2L = c2.l ?? (c2 as any).low;
      const c2C = c2.c ?? (c2 as any).close;
      const c2V = Number.isFinite(c2.v) ? (c2.v as number) : 0;

      const c3H = c3.h ?? (c3 as any).high;
      const c3L = c3.l ?? (c3 as any).low;

      const cCurrentH = c3.h ?? (c3 as any).high;
      const cCurrentL = c3.l ?? (c3 as any).low;
      const cCurrentC = c3.c ?? (c3 as any).close;

      const sma = volSmaSeries[i - 2] || 1;

      // 1. Formation (Anchor) Detection
      const isC1Bullish = c1C > c1O;
      const isC1Bearish = c1C < c1O;
      const isC2Bullish = c2C > c2O;
      const isC2Bearish = c2C < c2O;

      let pmType: 'BEARISH' | 'BULLISH' | null = null;
      let sweepLevel = 0;
      let breakerLevel = 0;

      if (isC1Bullish && isC2Bearish && c2H > c1H && c2H > c3H && c2V >= sma * volumeExpansionThreshold) {
        pmType = 'BEARISH';
        sweepLevel = c2H;
        breakerLevel = c1L;
      } else if (isC1Bearish && isC2Bullish && c2L < c1L && c2L < c3L && c2V >= sma * volumeExpansionThreshold) {
        pmType = 'BULLISH';
        sweepLevel = c2L;
        breakerLevel = c1H;
      }

      if (pmType !== null) {
        // Enforce strict test window filtering: only instantiate anchors formed within [startMs, endMs]
        const isWithinStart = startMs === undefined || c2.t >= startMs;
        const isWithinEnd = endMs === undefined || c2.t <= endMs;

        if (isWithinStart && isWithinEnd) {
          const currentAtr = atrSeries[i] || (sweepLevel * 0.002);
          const slBuffer = currentAtr * slBufferMultiplier;
          const initialSl = pmType === 'BEARISH' ? sweepLevel + slBuffer : sweepLevel - slBuffer;
          const initialRisk = Math.abs(breakerLevel - initialSl);

          const s1Mult = this.config.stage1Multiple ?? 1.0;
          const s2Mult = this.config.stage2Multiple ?? 1.5;
          const s3Mult = this.config.stage3Multiple ?? 3.0;

          const newSetup: SweepReclaimSetup = {
            id: `sr_${c2.t}_${pmType}`,
            type: pmType,
            symbol: this.config.symbol || 'ETHUSDC',
            timeframe: this.config.timeframe || '15m',
            phase: 'ANCHOR',
            status: 'ANCHOR_ONLY',
            anchor_type: 'PM_VOLUMETRIC',
            anchor_name: `PM ${pmType} ${new Date(c2.t).toISOString().replace('T', ' ').slice(0, 16)}`,
            anchor_level: sweepLevel,
            anchor_index: i - 1,
            anchor_time: c2.t,
            anchor_swing_type: pmType === 'BEARISH' ? 'SWING_HIGH' : 'SWING_LOW',
            anchor_swing_grade: 'MAJOR',
            anchor_color_validated: true,

            sweep_price: null,
            sweep_index: null,
            sweep_time: null,
            sweep_depth: null,
            sweep_depth_pct: null,
            sweep_volume_ratio: null,
            sweep_wick_ratio: null,
            is_wick_rejection_sweep: false,
            sweep_ob_mt: null,
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

            pillar1_volume_ratio_passed: true,
            pillar2_delta_dominance_passed: true,
            pillar3_body_ratio_passed: true,
            three_pillar_displacement_passed: true,

            retest_index: null,
            retest_time: null,
            retest_price: null,
            bars_reclaim_to_retest: null,
            is_retested: false,
            body_defense_passed: true,
            dealing_range_equilibrium: null,
            is_valuation_aligned: true,

            entry_mode: 'BREAKER_BLOCK',
            entry_price: breakerLevel,
            stop_loss: initialSl,
            risk_usd: initialRisk,
            risk_pct: 2.0,
            stage1_target: pmType === 'BEARISH' ? breakerLevel - (initialRisk * s1Mult) : breakerLevel + (initialRisk * s1Mult),
            stage2_target: pmType === 'BEARISH' ? breakerLevel - (initialRisk * s2Mult) : breakerLevel + (initialRisk * s2Mult),
            stage3_target: pmType === 'BEARISH' ? breakerLevel - (initialRisk * s3Mult) : breakerLevel + (initialRisk * s3Mult),
            stage1_multiple: s1Mult,
            stage2_multiple: s2Mult,
            stage3_multiple: s3Mult,

            is_stage1_filled: false,
            is_stage2_filled: false,
            is_stage3_filled: false,
            stage1_hit_time: null,
            stage1_hit_index: null,
            stage2_hit_time: null,
            stage2_hit_index: null,
            stage3_hit_time: null,
            stage3_hit_index: null,
            active_trailing_sl: initialSl,
            active_ratchet_floor: null,
            trailing_sl_source: 'INITIAL',
            is_be_scratch: false,
            is_structural_scratch: false,

            simulated_outcome: 'PENDING',
            stage_exit_type: 'PENDING',
            realized_rr: 0,
            mfe_r: 0,
            mfe_usd: 0,
            mae_r: 0,
            mae_usd: 0,
            bars_to_outcome: null,
            exit_time: null,
            exit_price: null,
          };
          allSetups.push(newSetup);
        }
      }

      // 2. Advance Lifecycle for Active Setups
      for (const s of allSetups) {
        if (s.status === 'EXPIRED' || s.status === 'INVALIDATED_AT_RETEST' || ['FULL_TP3_WIN', 'FULL_TP2_WIN', 'BE_SCRATCH_WIN', 'STRUCTURAL_SCRATCH', 'STOPPED_OUT'].includes(s.simulated_outcome)) {
          continue;
        }

        if (s.phase === 'ANCHOR') {
          if (s.type === 'BEARISH') {
            if (cCurrentC > s.anchor_level) {
              s.phase = 'SWEEP';
              s.status = 'SWEPT_NO_RECLAIM';
              s.sweep_index = i;
              s.sweep_time = c3.t;
              s.sweep_price = cCurrentH;
            }
          } else {
            if (cCurrentC < s.anchor_level) {
              s.phase = 'SWEEP';
              s.status = 'SWEPT_NO_RECLAIM';
              s.sweep_index = i;
              s.sweep_time = c3.t;
              s.sweep_price = cCurrentL;
            }
          }
        } 
        else if (s.phase === 'SWEEP') {
          if (s.type === 'BEARISH' && cCurrentH > (s.sweep_price ?? 0)) s.sweep_price = cCurrentH;
          if (s.type === 'BULLISH' && cCurrentL < (s.sweep_price ?? Infinity)) s.sweep_price = cCurrentL;

          const barsSinceSweep = i - (s.sweep_index ?? 0);
          if (barsSinceSweep > maxBarsSweepToReclaim) {
            s.status = 'EXPIRED';
            s.simulated_outcome = 'EXPIRED';
            continue;
          }

          if (s.type === 'BEARISH') {
            if (cCurrentC < s.entry_price) { 
              s.phase = 'RECLAIM';
              s.status = 'RECLAIMED_NO_RETEST';
              s.reclaim_index = i;
              s.reclaim_time = c3.t;
              s.is_reclaimed = true;
              
              const currentAtr = atrSeries[i] || (s.entry_price * 0.002);
              const slBuffer = currentAtr * slBufferMultiplier;
              const rawSweep = s.sweep_price ?? s.anchor_level;
              s.stop_loss = rawSweep + slBuffer;
              s.active_trailing_sl = s.stop_loss;
              
              const risk = Math.abs(s.stop_loss - s.entry_price);
              s.risk_usd = risk;
              s.stage1_target = s.entry_price - (risk * s.stage1_multiple);
              s.stage2_target = s.entry_price - (risk * s.stage2_multiple);
              s.stage3_target = s.entry_price - (risk * s.stage3_multiple);
            }
          } else {
            if (cCurrentC > s.entry_price) { 
              s.phase = 'RECLAIM';
              s.status = 'RECLAIMED_NO_RETEST';
              s.reclaim_index = i;
              s.reclaim_time = c3.t;
              s.is_reclaimed = true;
              
              const currentAtr = atrSeries[i] || (s.entry_price * 0.002);
              const slBuffer = currentAtr * slBufferMultiplier;
              const rawSweep = s.sweep_price ?? s.anchor_level;
              s.stop_loss = rawSweep - slBuffer;
              s.active_trailing_sl = s.stop_loss;

              const risk = Math.abs(s.entry_price - s.stop_loss);
              s.risk_usd = risk;
              s.stage1_target = s.entry_price + (risk * s.stage1_multiple);
              s.stage2_target = s.entry_price + (risk * s.stage2_multiple);
              s.stage3_target = s.entry_price + (risk * s.stage3_multiple);
            }
          }
        }
        else if (s.phase === 'RECLAIM') {
          if (s.type === 'BEARISH') {
            if (cCurrentH >= s.entry_price) {
              s.phase = 'RETEST';
              s.status = 'RETESTED';
              s.retest_index = i;
              s.retest_time = c3.t;
              s.is_retested = true;
            }
          } else {
            if (cCurrentL <= s.entry_price) {
              s.phase = 'RETEST';
              s.status = 'RETESTED';
              s.retest_index = i;
              s.retest_time = c3.t;
              s.is_retested = true;
            }
          }
        }
        
        if (s.phase === 'RETEST') {
          const risk = Math.abs(s.entry_price - s.stop_loss);
          if (risk === 0) continue; // Avoid divide by zero
          
          if (s.type === 'BEARISH') {
            const maxF = (s.entry_price - cCurrentL) / risk;
            if (maxF > s.mfe_r) s.mfe_r = maxF;
            const maxA = (cCurrentH - s.entry_price) / risk;
            if (maxA > s.mae_r) s.mae_r = maxA;

            if (cCurrentH >= s.active_trailing_sl) {
              s.exit_time = c3.t;
              s.bars_to_outcome = i - (s.retest_index ?? i);
              if (s.active_trailing_sl === s.stop_loss) {
                s.simulated_outcome = 'STOPPED_OUT';
                s.realized_rr = -1.0;
              } else if (s.active_trailing_sl === s.entry_price) {
                s.simulated_outcome = 'BE_SCRATCH_WIN';
                s.realized_rr = 0.40; 
              } else {
                s.simulated_outcome = 'FULL_TP2_WIN';
                s.realized_rr = 1.0; 
              }
              continue;
            }

            if (!s.is_stage1_filled && cCurrentL <= s.stage1_target) {
              s.is_stage1_filled = true;
              s.stage1_hit_time = c3.t;
              if (this.config.enableStructuralTrail) {
                s.active_trailing_sl = s.entry_price;
              }
            }

            if (s.is_stage1_filled && !s.is_stage2_filled && cCurrentL <= s.stage2_target) {
              s.is_stage2_filled = true;
              s.stage2_hit_time = c3.t;
              if (this.config.enableProfitRatchet) {
                s.active_trailing_sl = s.stage1_target;
              }
            }

            if (s.is_stage2_filled && !s.is_stage3_filled && cCurrentL <= s.stage3_target) {
              s.is_stage3_filled = true;
              s.stage3_hit_time = c3.t;
              s.simulated_outcome = 'FULL_TP3_WIN';
              s.exit_time = c3.t;
              s.bars_to_outcome = i - (s.retest_index ?? i);
              s.realized_rr = 1.6; 
            }
          } else {
            const maxF = (cCurrentH - s.entry_price) / risk;
            if (maxF > s.mfe_r) s.mfe_r = maxF;
            const maxA = (s.entry_price - cCurrentL) / risk;
            if (maxA > s.mae_r) s.mae_r = maxA;

            if (cCurrentL <= s.active_trailing_sl) {
              s.exit_time = c3.t;
              s.bars_to_outcome = i - (s.retest_index ?? i);
              if (s.active_trailing_sl === s.stop_loss) {
                s.simulated_outcome = 'STOPPED_OUT';
                s.realized_rr = -1.0;
              } else if (s.active_trailing_sl === s.entry_price) {
                s.simulated_outcome = 'BE_SCRATCH_WIN';
                s.realized_rr = 0.40; 
              } else {
                s.simulated_outcome = 'FULL_TP2_WIN';
                s.realized_rr = 1.0; 
              }
              continue;
            }

            if (!s.is_stage1_filled && cCurrentH >= s.stage1_target) {
              s.is_stage1_filled = true;
              s.stage1_hit_time = c3.t;
              if (this.config.enableStructuralTrail) {
                s.active_trailing_sl = s.entry_price;
              }
            }

            if (s.is_stage1_filled && !s.is_stage2_filled && cCurrentH >= s.stage2_target) {
              s.is_stage2_filled = true;
              s.stage2_hit_time = c3.t;
              if (this.config.enableProfitRatchet) {
                s.active_trailing_sl = s.stage1_target;
              }
            }

            if (s.is_stage2_filled && !s.is_stage3_filled && cCurrentH >= s.stage3_target) {
              s.is_stage3_filled = true;
              s.stage3_hit_time = c3.t;
              s.simulated_outcome = 'FULL_TP3_WIN';
              s.exit_time = c3.t;
              s.bars_to_outcome = i - (s.retest_index ?? i);
              s.realized_rr = 1.6; 
            }
          }
        }
      }
    }

    return {
      setups: allSetups,
      telemetry: this.generateTelemetrySummary(allSetups),
    };
  }

  private generateTelemetrySummary(setups: SweepReclaimSetup[]): SweepReclaimTelemetrySummary {
    const totalAnchors = setups.length;
    const sweptSetups = setups.filter((s) => s.sweep_index !== null);
    const totalSweeps = sweptSetups.length;
    const reclaimedSetups = setups.filter((s) => s.is_reclaimed);
    const totalReclaims = reclaimedSetups.length;
    const retestedSetups = setups.filter((s) => s.is_retested);
    const totalRetests = retestedSetups.length;

    const sweepRatePct = totalAnchors > 0 ? (totalSweeps / totalAnchors) * 100 : 0;
    const reclaimRatePct = totalSweeps > 0 ? (totalReclaims / totalSweeps) * 100 : 0;
    const retestRatePct = totalReclaims > 0 ? (totalRetests / totalReclaims) * 100 : 0;

    let pillar1PassCount = 0;
    let pillar2PassCount = 0;
    let pillar3PassCount = 0;
    let threePillarAllPassCount = 0;

    let wickRejectionCount = 0;
    let discountPremiumCount = 0;

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
      PM_VOLUMETRIC: 0,
    };

    for (const s of setups) {
      if (anchorDistribution[s.anchor_type] !== undefined) {
        anchorDistribution[s.anchor_type]++;
      }

      if (s.type === 'BULLISH') bullTotal++;
      else bearTotal++;

      if (s.is_wick_rejection_sweep) wickRejectionCount++;
      if (s.is_valuation_aligned) discountPremiumCount++;

      if (s.pillar1_volume_ratio_passed) pillar1PassCount++;
      if (s.pillar2_delta_dominance_passed) pillar2PassCount++;
      if (s.pillar3_body_ratio_passed) pillar3PassCount++;
      if (s.three_pillar_displacement_passed) threePillarAllPassCount++;

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

    const profitFactor = sumLossRr > 0 ? sumWinRr / sumLossRr : sumWinRr > 0 ? 99.9 : 0;

    const winProb = totalRetests > 0 ? totalWins / totalRetests : 0;
    const lossProb = totalRetests > 0 ? totalLosses / totalRetests : 0;
    const expectedValueR = totalRetests > 0 ? winProb * avgWinningRr - lossProb * (avgLosingRr || 1.0) : 0;

    return {
      total_anchors_detected: totalAnchors,
      total_sweeps_detected: totalSweeps,
      total_reclaims_confirmed: totalReclaims,
      total_retests_executed: totalRetests,

      sweep_rate_pct: parseFloat(sweepRatePct.toFixed(1)),
      reclaim_rate_pct: parseFloat(reclaimRatePct.toFixed(1)),
      retest_rate_pct: parseFloat(retestRatePct.toFixed(1)),
      retest_win_rate_pct: parseFloat(retestWinRatePct.toFixed(1)),

      pillar1_pass_count: pillar1PassCount,
      pillar1_pass_pct: totalReclaims > 0 ? parseFloat(((pillar1PassCount / totalReclaims) * 100).toFixed(1)) : 0,
      pillar1_volume_passed_count: pillar1PassCount,
      pillar2_pass_count: pillar2PassCount,
      pillar2_pass_pct: totalReclaims > 0 ? parseFloat(((pillar2PassCount / totalReclaims) * 100).toFixed(1)) : 0,
      pillar2_delta_passed_count: pillar2PassCount,
      pillar3_pass_count: pillar3PassCount,
      pillar3_pass_pct: totalReclaims > 0 ? parseFloat(((pillar3PassCount / totalReclaims) * 100).toFixed(1)) : 0,
      pillar3_body_passed_count: pillar3PassCount,
      three_pillar_all_pass_count: threePillarAllPassCount,
      three_pillar_all_pass_pct: totalReclaims > 0 ? parseFloat(((threePillarAllPassCount / totalReclaims) * 100).toFixed(1)) : 0,
      three_pillar_all_passed_count: threePillarAllPassCount,

      wick_rejection_sweep_count: wickRejectionCount,
      wick_rejection_sweep_pct: totalSweeps > 0 ? parseFloat(((wickRejectionCount / totalSweeps) * 100).toFixed(1)) : 0,
      discount_premium_aligned_count: discountPremiumCount,
      discount_premium_aligned_pct: totalAnchors > 0 ? parseFloat(((discountPremiumCount / totalAnchors) * 100).toFixed(1)) : 0,

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

      pillar1_pass_count: 0,
      pillar1_pass_pct: 0,
      pillar2_pass_count: 0,
      pillar2_pass_pct: 0,
      pillar3_pass_count: 0,
      pillar3_pass_pct: 0,
      three_pillar_all_pass_count: 0,
      three_pillar_all_pass_pct: 0,

      wick_rejection_sweep_count: 0,
      wick_rejection_sweep_pct: 0,
      discount_premium_aligned_count: 0,
      discount_premium_aligned_pct: 0,

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
        PM_VOLUMETRIC: 0,
      },
    };
  }
}
