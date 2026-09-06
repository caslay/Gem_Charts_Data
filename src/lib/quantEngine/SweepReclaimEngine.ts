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
import {
  StructuralBootstrapContext,
  MarketRegimeState,
  RetestFreshness,
  RetestType,
  ValuationGateMode,
} from './types';

export type {
  MarketRegimeState,
  RetestFreshness,
  RetestType,
  ValuationGateMode,
};

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
  | 'FULL_TP2_WIN'
  | 'STAGE_2_WIN'
  | 'STAGE_1_SCRATCH'
  | 'STOPPED_OUT'
  | 'PENDING'
  | 'NO_RETEST'
  | 'EXPIRED'
  | 'INVALIDATED';

/**
 * Retest Entry Model Options:
 *  - SHELF_LEVEL / RECLAIM_LEVEL: Reclaimed anchor level.
 *  - FVG_PROXIMAL: Outer opening edge of the displacement FVG.
 *  - FVG_CE: 50% Consequent Encroachment of the displacement FVG.
 *  - FVG_DISTAL: Deepest edge of the displacement FVG prior to invalidation.
 *  - OB_PROXIMAL: Open / first boundary of the sweep Order Block.
 *  - SWEEP_OB_MT: 50% Mean Threshold of the sweep Order Block.
 *  - OTE_62: 62% Fibonacci retracement of the displacement impulse.
 */
export type SweepReclaimEntryMode =
  | 'SHELF_LEVEL'
  | 'RECLAIM_LEVEL' // legacy alias for SHELF_LEVEL
  | 'FVG_PROXIMAL'
  | 'FVG_CE'
  | 'FVG_DISTAL'
  | 'OB_PROXIMAL'
  | 'SWEEP_OB_MT'
  | 'OTE_62';

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
  market_regime_at_entry?: MarketRegimeState;
  valuation_gate_mode?: ValuationGateMode;
  local_wave_equilibrium?: number | null;
  htf_sweep_required?: boolean;
  htf_sweep_level?: number | null;

  // Wave Deduplication & Concurrency Guard Metadata
  wave_fingerprint?: string;
  is_wave_champion?: boolean;
  wave_cluster_size?: number;
  stacking_discount_applied?: boolean;

  // Retest Freshness & Pullback Discrimination
  retest_freshness?: RetestFreshness;
  retest_type?: RetestType;
  retest_max_excursion_r?: number | null;
  retest_delay_bars?: number | null;

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
  anchorTypes?: SweepReclaimAnchorType[];     // Selected anchor types to scan (default: all)
  lookbackMajor?: number;                     // Pivot engine major lookback (default: 15)
  lookbackInternal?: number;                  // Pivot engine internal lookback (default: 5)
  maxBarsAnchorToSweep?: number;              // Max candles between anchor and sweep (default: 30)
  maxBarsSweepToReclaim?: number;             // Max candles from sweep extreme to reclaim close (default: 12)
  maxBarsToRetest?: number;                   // Max candles from reclaim to retest entry (default: 12)

  // 3-Pillar Displacement Gatekeeper Thresholds
  volumeSmaPeriod?: number;                   // Rolling Volume SMA lookback period (default: 20, support: 7 to 50)
  volumeExpansionThreshold?: number;          // Pillar 1: Min Volume Ratio vs SMA (default: 1.50x)
  deltaDominanceThreshold?: number;           // Pillar 2: Min taker delta dominance % (default: 55.0%)
  bodyRatioThreshold?: number;                // Pillar 3: Min candle body-to-range ratio (default: 0.55)
  minBodyRatio?: number;                      // Pillar 3 alias: Min candle body-to-range ratio
  requireThreePillarDisplacement?: boolean;   // Veto reclaims that fail 3-pillar gate (default: true)

  // Valuation Gating & Regime Adaptation
  enforceDiscountPremiumGate?: boolean;       // Require Longs in Discount, Shorts in Premium (default: true)
  enableRegimeAdaptiveEQ?: boolean;           // Decouple trend direction from macro EQ in runaway expansions (default: true)
  runawayVelocityThreshold?: number;          // ATR-relative momentum multiplier for runaway state (default: 2.0)
  transitionalVelocityThreshold?: number;     // ATR-relative momentum multiplier for transitional state (default: 1.0)
  transitionHysteresisBarCount?: number;      // Bars to maintain expansion state before decaying (default: 2)
  relaxedEqAtrBufferMultiplier?: number;      // Buffer in ATR for transitional relaxed EQ (default: 0.25)
  structuralDealingRange?: { high: number; low: number; equilibrium: number } | null; // Parent structural dealing range (from MarketStructureAPI/MacroContext)

  // In-Scanner Concurrency & Wave Deduplication
  enableInScannerWaveDedup?: boolean;         // Group multi-anchor same-wave triggers into single champion (default: true)
  enforceSinglePositionConcurrency?: boolean; // Walk single-position non-overlapping lifecycle (default: true)

  // Retest Validation & Pullback Classification
  pullbackExcursionThreshold?: number;        // Min R-distance excursion from entry for pullback classification (default: 0.5)

  // Target Multiples & Execution
  stage1Multiple?: number;                    // Stage 1 Tranche target R (default: 1.0)
  stage2Multiple?: number;                    // Stage 2 Tranche target R (default: 1.5)
  stage3Multiple?: number;                    // Stage 3 Tranche target R / DOL runner (default: 3.0)
  stage1Ratio?: number;                       // Tranche 1 volume weight (default: 0.50)
  stage2Ratio?: number;                       // Tranche 2 volume weight (default: 0.50)
  stage3Ratio?: number;                       // Tranche 3 volume weight (default: 0.00)
  entryMode?: SweepReclaimEntryMode;          // (default: 'SWEEP_OB_MT')
  enableStructuralTrail?: boolean;            // Trail SL to FVG CE after Stage 1 (default: true)
  enableProfitRatchet?: boolean;              // Ratchet SL to +1.0R floor after Stage 2 (default: true)
  minSweepDepthAtrMultiplier?: number;        // Min sweep penetration in ATR (default: 0.10)
  slBufferAtrMultiplier?: number;             // Volatility buffer added behind sweep extreme (default: 0.15)

  // 🛡️ Quant Shield & Loss Streak Protection Settings (5 Institutional Rules)
  enableWaveDeduplication?: boolean;          // Rule 1: Single-Position & Wave Anchor Deduplication (default: true)
  filterWeekend?: boolean;                    // Rule 2: Weekend Off-Liquidity Filter (Fri 22:00 - Sun 20:00 UTC) (default: true)
  enforceHtfBiasGuard?: boolean;              // Rule 3: Macro Daily Bias & 1H Structure Alignment Guard (default: false)
  enableEarlyBreakeven?: boolean;             // Rule 4: Dynamic Early Breakeven Ratchet (default: true)
  earlyBreakevenMultiple?: number;            // Rule 4: MFE Multiple to trigger Breakeven (default: 0.60)
  enableFeePaddedBreakeven?: boolean;         // Fee-Padded Breakeven: Offset BE stop to cover Binance 0.0400% taker fee (default: true)
  breakevenOffsetPct?: number;                // Percentage offset from entry (default: 0.05% -> Entry * (1 ± 0.0005))
  postLossCooldownMinutes?: number;           // Rule 5: Directional cooldown minutes after stop-out (default: 45)

  // 💰 Institutional Binance Fee Model (USDC-M Futures)
  makerFeePct?: number;                       // Maker fee percentage for Limit orders (default: 0.0000%)
  takerFeePct?: number;                       // Taker fee percentage for Stop-Market / Taker orders (default: 0.0400%)
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

  // Wave Deduplication & Concurrency Telemetry
  total_raw_candidates?: number;
  total_wave_champions?: number;
  stacking_reduction_pct?: number;
  overlapping_concurrency_vetoed_count?: number;

  // Regime & Freshness Distributions
  regime_distribution?: Record<MarketRegimeState, number>;
  retest_freshness_distribution?: Record<RetestFreshness, number>;
  retest_type_distribution?: Record<RetestType, number>;

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

  ex_scratch_win_rate_pct?: number;
  alpha_survival_rate_pct?: number;

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
  timeframe: '5m',
  anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
  lookbackMajor: 10,
  lookbackInternal: 5,
  maxBarsAnchorToSweep: 25,
  maxBarsSweepToReclaim: 10,
  maxBarsToRetest: 12,
  volumeSmaPeriod: 20,
  volumeExpansionThreshold: 1.20,
  deltaDominanceThreshold: 52.0,
  bodyRatioThreshold: 0.40,
  requireThreePillarDisplacement: true,
  enforceDiscountPremiumGate: true,
  enableRegimeAdaptiveEQ: true,
  runawayVelocityThreshold: 2.0,
  transitionalVelocityThreshold: 1.0,
  transitionHysteresisBarCount: 2,
  relaxedEqAtrBufferMultiplier: 0.25,
  enableInScannerWaveDedup: true,
  enforceSinglePositionConcurrency: true,
  pullbackExcursionThreshold: 0.5,
  stage1Multiple: 1.0,
  stage2Multiple: 1.4,
  stage3Multiple: 3.0,
  stage1Ratio: 0.50,
  stage2Ratio: 0.50,
  stage3Ratio: 0.00,
  entryMode: 'FVG_PROXIMAL',
  enableStructuralTrail: true,
  enableProfitRatchet: true,
  enableFeePaddedBreakeven: true,
  breakevenOffsetPct: 0.05,
  minSweepDepthAtrMultiplier: 0.10,
  slBufferAtrMultiplier: 0.10,
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
  const { mode, isBullish, anchorLevel, sweepCandle, fvg, displacementExtremes } = params;

  // FIX-2: Use Number.isFinite() throughout — typeof NaN === 'number' is true and would
  // silently pass NaN values into arithmetic, producing a NaN entry price that cascades
  // into NaN riskDistance, NaN unrealizedR, and a permanent engine lockup.
  switch (mode) {
    case 'SHELF_LEVEL':
    case 'RECLAIM_LEVEL':
      return parseFloat(anchorLevel.toFixed(4));

    case 'FVG_PROXIMAL':
      if (fvg && Number.isFinite(fvg.top) && Number.isFinite(fvg.bottom) && fvg.top > fvg.bottom) {
        // Bullish (BISI): price retracing downward from above hits UPPER gap boundary first = Candle 3 Low  = fvg.top
        // Bearish (SIBI): price retracing upward from below hits LOWER gap boundary first   = Candle 3 High = fvg.bottom
        const proximal = isBullish ? fvg.top : fvg.bottom;
        return parseFloat(proximal.toFixed(4));
      }
      return parseFloat(anchorLevel.toFixed(4));

    case 'FVG_CE':
      if (fvg && Number.isFinite(fvg.top) && Number.isFinite(fvg.bottom) && fvg.top > fvg.bottom) {
        const ce = (Number.isFinite(fvg.ce) && fvg.ce !== undefined)
          ? fvg.ce
          : (fvg.top + fvg.bottom) / 2;
        return parseFloat(ce.toFixed(4));
      }
      return parseFloat(anchorLevel.toFixed(4));

    case 'FVG_DISTAL':
      if (fvg && Number.isFinite(fvg.top) && Number.isFinite(fvg.bottom) && fvg.top > fvg.bottom) {
        // Bullish (BISI): deepest boundary before gap mitigation = Candle 1 High = fvg.bottom
        // Bearish (SIBI): deepest boundary before gap mitigation = Candle 1 Low  = fvg.top
        const distal = isBullish ? fvg.bottom : fvg.top;
        return parseFloat(distal.toFixed(4));
      }
      return parseFloat(anchorLevel.toFixed(4));

    case 'OB_PROXIMAL':
      if (sweepCandle && Number.isFinite(sweepCandle.high) && Number.isFinite(sweepCandle.low) && sweepCandle.high > sweepCandle.low) {
        // Bullish: pullback from above into sweep OB hits OB top boundary (high)
        // Bearish: pullback from below into sweep OB hits OB bottom boundary (low)
        const obProximal = isBullish ? sweepCandle.high : sweepCandle.low;
        return parseFloat(obProximal.toFixed(4));
      }
      return parseFloat(anchorLevel.toFixed(4));

    case 'SWEEP_OB_MT':
      if (sweepCandle && Number.isFinite(sweepCandle.high) && Number.isFinite(sweepCandle.low) && sweepCandle.high > sweepCandle.low) {
        const mt = (Number.isFinite(sweepCandle.mt) && sweepCandle.mt !== undefined)
          ? sweepCandle.mt
          : (sweepCandle.high + sweepCandle.low) / 2;
        return parseFloat(mt.toFixed(4));
      }
      return parseFloat(anchorLevel.toFixed(4));

    case 'OTE_62':
      if (
        displacementExtremes &&
        Number.isFinite(displacementExtremes.impulseHigh) &&
        Number.isFinite(displacementExtremes.impulseLow) &&
        displacementExtremes.impulseHigh > displacementExtremes.impulseLow
      ) {
        const range = displacementExtremes.impulseHigh - displacementExtremes.impulseLow;
        // Bullish: 62% retracement from peak down toward sweep low
        // Bearish: 62% retracement from trough up toward sweep high
        const otePrice = isBullish
          ? displacementExtremes.impulseHigh - 0.62 * range
          : displacementExtremes.impulseLow + 0.62 * range;
        return parseFloat(otePrice.toFixed(4));
      }
      return parseFloat(anchorLevel.toFixed(4));

    default:
      return parseFloat(anchorLevel.toFixed(4));
  }
}

/**
 * Returns human-readable label for a given SweepReclaimEntryMode.
 */
export function getEntryModeLabel(mode: SweepReclaimEntryMode): string {
  switch (mode) {
    case 'SWEEP_OB_MT':
      return 'Sweep OB 50% MT';
    case 'OB_PROXIMAL':
      return 'Sweep OB Proximal';
    case 'FVG_CE':
      return 'Displacement FVG 50% CE';
    case 'FVG_PROXIMAL':
      return 'Displacement FVG Proximal';
    case 'FVG_DISTAL':
      return 'Displacement FVG Distal';
    case 'OTE_62':
      return '62% OTE Retracement';
    case 'SHELF_LEVEL':
    case 'RECLAIM_LEVEL':
      return 'Reclaimed Shelf Level';
    default:
      return mode;
  }
}

/**
 * Returns full technical description for a given SweepReclaimEntryMode.
 */
export function getEntryModeDescription(mode: SweepReclaimEntryMode): string {
  switch (mode) {
    case 'SWEEP_OB_MT':
      return '50% Mean Threshold midpoint of the liquidity sweep candle / Order Block';
    case 'OB_PROXIMAL':
      return 'First boundary edge of the sweep Order Block (High for Longs, Low for Shorts)';
    case 'FVG_CE':
      return '50% Consequent Encroachment midpoint of the displacement Fair Value Gap';
    case 'FVG_PROXIMAL':
      return 'Outer opening edge of the displacement Fair Value Gap (Top for BISI, Bottom for SIBI)';
    case 'FVG_DISTAL':
      return 'Deepest boundary edge of the Fair Value Gap prior to full fill/invalidation';
    case 'OTE_62':
      return '62% Fibonacci Retracement of the displacement impulse wave from sweep to reclaim';
    case 'SHELF_LEVEL':
    case 'RECLAIM_LEVEL':
      return 'Exact price level of the reclaimed structural pivot / session anchor shelf';
    default:
      return '';
  }
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

export function getAnchorPriority(anchorType?: string, anchorSwingGrade?: string): number {
  if (anchorType === 'DAILY' || anchorType === 'PDH' || anchorType === 'PDL') return 100;
  if (anchorType === 'LONDON_HIGH' || anchorType === 'LONDON_LOW' || anchorType === 'LONDON') return 90;
  if (anchorType === 'ASIAN_HIGH' || anchorType === 'ASIAN_LOW' || anchorType === 'ASIAN') return 80;
  if (anchorSwingGrade === 'MAJOR') return 70;
  if (anchorSwingGrade === 'INTERNAL') return 50;
  return 30; // INNER
}

export function classifyMarketRegime(
  candleIdx: number,
  candles: Candle[],
  atrSeries: number[],
  bootstrap?: StructuralBootstrapContext,
  config?: SweepReclaimScanConfig
): {
  regime: MarketRegimeState;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  velocity: number;
} {
  const runawayThresh = config?.runawayVelocityThreshold ?? 2.0;
  const transitionalThresh = config?.transitionalVelocityThreshold ?? 1.0;

  const currentCandle = candles[candleIdx];
  if (!currentCandle) {
    return { regime: 'ROTATIONAL_AUCTION', direction: 'NEUTRAL', velocity: 0 };
  }

  // 1. Check structural bootstrap expansion state strictly at initial seed boundary (candleIdx === 0)
  // to avoid falsely inflating velocity across future rolling historical candles
  const isExpanding = candleIdx === 0 && !!bootstrap?.majorSnapshot?.is_in_expansion;
  const expansionTrend: 'BULLISH' | 'BEARISH' | null =
    bootstrap?.majorSnapshot?.current_trend_state === 'BULLISH_SWING' ? 'BULLISH' : 'BEARISH';

  // 2. Compute local 6-candle displacement velocity relative to ATR
  const lookbackBars = Math.min(6, candleIdx);
  const startCandle = candles[candleIdx - lookbackBars];
  const startPrice = startCandle.c ?? (startCandle as any).close;
  const currentPrice = currentCandle.c ?? (currentCandle as any).close;
  const priceDelta = currentPrice - startPrice;
  const currentAtr = atrSeries[candleIdx] || 1.0;

  let velocity = Math.abs(priceDelta) / Math.max(0.001, currentAtr * 3);
  if (isExpanding) {
    velocity += 1.5;
  }

  const direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    priceDelta > 0 ? 'BULLISH' : priceDelta < 0 ? 'BEARISH' : expansionTrend || 'NEUTRAL';

  if (velocity >= runawayThresh && (isExpanding || Math.abs(priceDelta) >= currentAtr * 2)) {
    return { regime: 'RUNAWAY_EXPANSION', direction, velocity: parseFloat(velocity.toFixed(2)) };
  }

  if (velocity >= transitionalThresh) {
    return { regime: 'TRANSITIONAL_EXPANSION', direction, velocity: parseFloat(velocity.toFixed(2)) };
  }

  return { regime: 'ROTATIONAL_AUCTION', direction: 'NEUTRAL', velocity: parseFloat(velocity.toFixed(2)) };
}

// ── SweepReclaimEngine Implementation ────────────────────────────────────────

export class SweepReclaimEngine {
  public config: SweepReclaimScanConfig;
  private confirmedPivots: any[] = [];

  constructor(config: SweepReclaimScanConfig = {}) {
    this.config = { ...DEFAULT_SWEEP_RECLAIM_CONFIG, ...config };
  }

  /**
   * Extracts multi-timeframe liquidity anchors chronologically with zero look-ahead bias.
   */
  private extractAnchors(candles: Candle[], bootstrap?: import('./types').StructuralBootstrapContext): LiquidityAnchor[] {
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
      if (bootstrap) {
        pivotEngine.seedConfirmedPivots(bootstrap.confirmedPivots);
      }
      pivotEngine.processCandles(candles);
      this.confirmedPivots = pivotEngine.pivots;

      const uniquePivotsMap = new Map<string, (typeof pivotEngine.pivots)[0]>();
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
        const aHigh = Math.max(...asianCandles.map((c) => c.h ?? (c as any).high));
        const aLow = Math.min(...asianCandles.map((c) => c.l ?? (c as any).low));
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
        const lHigh = Math.max(...londonCandles.map((c) => c.h ?? (c as any).high));
        const lLow = Math.min(...londonCandles.map((c) => c.l ?? (c as any).low));
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

      // ── Previous Day High / Low (PDH / PDL) ─────────────────────────────────
      if (dIdx > 0) {
        const prevDayKey = daysList[dIdx - 1];
        const { candles: prevCandles, indices: prevIndices } = candlesByDay.get(prevDayKey)!;

        if (prevCandles.length >= 10) {
          const pdh = Math.max(...prevCandles.map((c) => c.h ?? (c as any).high));
          const pdl = Math.min(...prevCandles.map((c) => c.l ?? (c as any).low));
          const dayFirstIdx = dayIndices[0];
          const anchorTime = candles[dayFirstIdx].t;

          if (allowedTypes.has('PDH')) {
            anchors.push({
              type: 'PDH',
              name: `Previous Day High ($${pdh.toFixed(2)})`,
              level: pdh,
              time: anchorTime,
              index: dayFirstIdx,
              bias: 'BEARISH',
              grade: 'DAILY',
              colorValidated: true,
            });
          }

          if (allowedTypes.has('PDL')) {
            anchors.push({
              type: 'PDL',
              name: `Previous Day Low ($${pdl.toFixed(2)})`,
              level: pdl,
              time: anchorTime,
              index: dayFirstIdx,
              bias: 'BULLISH',
              grade: 'DAILY',
              colorValidated: true,
            });
          }
        }
      }
    }

    anchors.sort((a, b) => a.index - b.index);
    return anchors;
  }

  /**
   * Scans a full historical candle series through the 4-phase Sweep & Reclaim state machine.
   */
  public scanHistoricalSetups(
    rawCandles: Candle[], 
    bootstrap?: import('./types').StructuralBootstrapContext
  ): {
    setups: SweepReclaimSetup[];
    telemetry: SweepReclaimTelemetrySummary;
  } {
    // Enforce strict completed-bar evaluation: ignore forming unclosed candles
    const candles = rawCandles.filter((c) => c.isClosed !== false);
    const n = candles.length;
    if (n < 20) {
      return { setups: [], telemetry: this.createEmptyTelemetry() };
    }

    const anchors = this.extractAnchors(candles, bootstrap);
    const atrSeries = calculateAtrSeries(candles, 14);

    let detectedSetups: SweepReclaimSetup[] = [];

    // Rolling Volume SMA (configurable period, default 20)
    // FIX-6: Use Number.isFinite() to guard against undefined/NaN volume fields from offline
    // mock candles or incomplete historical data. candles[i].v ?? 0 passes when v is undefined
    // but still passes through NaN if v is explicitly NaN. Number.isFinite() rejects both.
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

    const volumeExpansionThreshold = this.config.volumeExpansionThreshold ?? 1.35;
    const deltaDominanceThreshold = this.config.deltaDominanceThreshold ?? 52.0;
    const bodyRatioThreshold = this.config.minBodyRatio ?? this.config.bodyRatioThreshold ?? 0.50;
    const requireThreePillar = this.config.requireThreePillarDisplacement !== false;
    const enforceDiscountPremium = !!this.config.enforceDiscountPremiumGate;

    const stage1Multiple = this.config.stage1Multiple ?? 1.0;
    const stage2Multiple = this.config.stage2Multiple ?? 1.4;
    const stage3Multiple = this.config.stage3Multiple ?? 3.0;
    const entryMode = this.config.entryMode ?? 'FVG_PROXIMAL';

    // ── Phase 1, 2, 3: Extract and Evaluate All Candidate Setups Across History ──
    const allCandidateSetups: SweepReclaimSetup[] = [];

    // Iterate through confirmed multi-timeframe anchors
    for (const anchor of anchors) {
      const anchorIdx = anchor.index;
      if (anchorIdx < 2 || anchorIdx >= n - 5) continue;

      const anchorTime = anchor.time;

      // 🛡️ Quant Shield Rule 2: Weekend Off-Liquidity Filter (Fri 22:00 - Sun 20:00 UTC)
      if (this.config.filterWeekend) {
        const d = new Date(anchorTime);
        const day = d.getUTCDay();
        const hr = d.getUTCHours();
        const isWknd = (day === 5 && hr >= 22) || day === 6 || (day === 0 && hr < 20);
        if (isWknd) continue;
      }

      const isBullish = anchor.bias === 'BULLISH';
      const anchorLevel = anchor.level;
      const anchorGrade = anchor.grade;
      const anchorType = anchor.type;
      const anchorName = anchor.name;

      const maxSweepLookback =
        anchorGrade === 'SESSION' || anchorGrade === 'DAILY'
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
      let sweepWickRatio = 0.0;
      let isWickRejection = false;
      let sweepObMt: number | null = null;

      // ─── Phase 2: Liquidity Sweep Detection (Wick Rejection Signature) ───────
      if (isBullish) {
        let localMinLow = Infinity;
        let localMinIdx = -1;

        for (let i = anchorIdx + 1; i <= maxSweepIdx; i++) {
          const c = candles[i];
          const low = c.l ?? (c as any).low;
          const close = c.c ?? (c as any).close;

          if (low < anchorLevel) {
            if (low < localMinLow) {
              localMinLow = low;
              localMinIdx = i;
            }
          }

          // 🛡️ Causal First-Confirmed-Reclaim Lock:
          // If price has breached the anchor with minimum depth and closed back inside (reclaim close),
          // lock this sweep extreme immediately. Do not allow subsequent wicks across the 25-bar
          // lookahead window to overwrite an already completed, reclaimed sweep cycle.
          if (localMinIdx !== -1) {
            const atr = atrSeries[localMinIdx] || 1.0;
            const minDepth = (this.config.minSweepDepthAtrMultiplier ?? 0.10) * atr;
            const currentDepth = anchorLevel - localMinLow;
            if (currentDepth >= minDepth && close > anchorLevel) {
              break;
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

            // Wick Rejection Math: lower wick ratio
            const sc = candles[localMinIdx];
            const scOpen = sc.o ?? (sc as any).open;
            const scClose = sc.c ?? (sc as any).close;
            const scHigh = sc.h ?? (sc as any).high;
            const scLow = sc.l ?? (sc as any).low;
            const scRange = Math.max(0.0001, scHigh - scLow);
            const lowerWick = Math.min(scOpen, scClose) - scLow;
            sweepWickRatio = parseFloat(((lowerWick / scRange) * 100).toFixed(1));
            isWickRejection = sweepWickRatio >= 40.0 && sweepVolRatio >= 1.0;
            sweepObMt = parseFloat(((scHigh + scLow) / 2).toFixed(4));
          }
        }
      } else {
        // Bearish: Price violates above the anchor high shelf
        let localMaxHigh = -Infinity;
        let localMaxIdx = -1;

        for (let i = anchorIdx + 1; i <= maxSweepIdx; i++) {
          const c = candles[i];
          const high = c.h ?? (c as any).high;
          const close = c.c ?? (c as any).close;

          if (high > anchorLevel) {
            if (high > localMaxHigh) {
              localMaxHigh = high;
              localMaxIdx = i;
            }
          }

          // 🛡️ Causal First-Confirmed-Reclaim Lock:
          // If price has breached the anchor with minimum depth and closed back inside (reclaim close),
          // lock this sweep extreme immediately. Do not allow subsequent wicks across the 25-bar
          // lookahead window to overwrite an already completed, reclaimed sweep cycle.
          if (localMaxIdx !== -1) {
            const atr = atrSeries[localMaxIdx] || 1.0;
            const minDepth = (this.config.minSweepDepthAtrMultiplier ?? 0.10) * atr;
            const currentDepth = localMaxHigh - anchorLevel;
            if (currentDepth >= minDepth && close < anchorLevel) {
              break;
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

            // Wick Rejection Math: upper wick ratio
            const sc = candles[localMaxIdx];
            const scOpen = sc.o ?? (sc as any).open;
            const scClose = sc.c ?? (sc as any).close;
            const scHigh = sc.h ?? (sc as any).high;
            const scLow = sc.l ?? (sc as any).low;
            const scRange = Math.max(0.0001, scHigh - scLow);
            const upperWick = scHigh - Math.max(scOpen, scClose);
            sweepWickRatio = parseFloat(((upperWick / scRange) * 100).toFixed(1));
            isWickRejection = sweepWickRatio >= 40.0 && sweepVolRatio >= 1.0;
            sweepObMt = parseFloat(((scHigh + scLow) / 2).toFixed(4));
          }
        }
      }

      const sweepTag = sweepFound && sweepIdx !== null ? `_SW${sweepIdx}` : '';
      const setupId = `SR_${isBullish ? 'BULL' : 'BEAR'}_${anchorType}_${anchorLevel.toFixed(2)}_${anchorTime}${sweepTag}`;

      // ── BUG-3 FIX: Post-Phase-2 Anchor Polarity Hard Gate ────────────────────
      // Enforce strict directional alignment:
      //   BULLISH / LONG setups MUST sweep Sell-Side Liquidity (SSL):
      //     anchor.bias === 'BULLISH' → Swing Low / Asian Low / London Low / PDL
      //   BEARISH / SHORT setups MUST sweep Buy-Side Liquidity (BSL):
      //     anchor.bias === 'BEARISH' → Swing High / Asian High / London High / PDH
      // Any anchor whose recorded bias contradicts the setup direction is a polarity
      // inversion — discard it as ANCHOR_ONLY before Phase 3 evaluation ever runs.
      const anchorBiasMatchesDirection = anchor.bias === (isBullish ? 'BULLISH' : 'BEARISH');
      if (!anchorBiasMatchesDirection) {
        // Inverted polarity candidate: Short paired with swept Low or Long with swept High.
        // Emit a minimal ANCHOR_ONLY record for telemetry and skip Phase 3.
        const polarityGuardSetup: SweepReclaimSetup = {
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
          sweep_price: null, sweep_index: null, sweep_time: null,
          sweep_depth: null, sweep_depth_pct: null, sweep_volume_ratio: null,
          sweep_wick_ratio: null, is_wick_rejection_sweep: false,
          sweep_ob_mt: null, sweep_ob_proximal: null, bars_anchor_to_sweep: null,
          reclaim_index: null, reclaim_time: null, reclaim_close_price: null,
          reclaim_volume_expansion: null, reclaim_body_ratio: null,
          reclaim_delta_dominance_pct: null, reclaim_fvg_created: false,
          reclaim_fvg_top: null, reclaim_fvg_bottom: null, reclaim_fvg_ce: null,
          reclaim_fvg_proximal: null, reclaim_fvg_distal: null,
          displacement_impulse_high: null, displacement_impulse_low: null,
          ote_62_price: null, bars_sweep_to_reclaim: null, is_reclaimed: false,
          pillar1_volume_ratio_passed: false, pillar2_delta_dominance_passed: false,
          pillar3_body_ratio_passed: false, three_pillar_displacement_passed: false,
          retest_index: null, retest_time: null, retest_price: null,
          bars_reclaim_to_retest: null, is_retested: false, is_immediate_fill: false,
          max_retest_index: null, is_expired: false, body_defense_passed: false,
          dealing_range_equilibrium: null, is_valuation_aligned: false,
          market_regime_at_entry: 'ROTATIONAL_AUCTION',
          valuation_gate_mode: 'STRUCTURAL_EQ',
          wave_fingerprint: `${anchorTime}_${isBullish ? 'BULLISH' : 'BEARISH'}`,
          is_wave_champion: true,
          wave_cluster_size: 1,
          stacking_discount_applied: false,
          entry_mode: entryMode,
          entry_price: parseFloat(anchorLevel.toFixed(4)),
          stop_loss: parseFloat((isBullish ? anchorLevel - anchorLevel * 0.0015 : anchorLevel + anchorLevel * 0.0015).toFixed(4)),
          risk_usd: parseFloat((anchorLevel * 0.0015).toFixed(4)),
          risk_pct: 0.15,
          stage1_target: parseFloat((isBullish ? anchorLevel + stage1Multiple * (anchorLevel * 0.0015) : anchorLevel - stage1Multiple * (anchorLevel * 0.0015)).toFixed(4)),
          stage2_target: parseFloat((isBullish ? anchorLevel + stage2Multiple * (anchorLevel * 0.0015) : anchorLevel - stage2Multiple * (anchorLevel * 0.0015)).toFixed(4)),
          stage3_target: parseFloat((isBullish ? anchorLevel + stage3Multiple * (anchorLevel * 0.0015) : anchorLevel - stage3Multiple * (anchorLevel * 0.0015)).toFixed(4)),
          stage1_multiple: stage1Multiple, stage2_multiple: stage2Multiple, stage3_multiple: stage3Multiple,
          is_stage1_filled: false, is_stage2_filled: false, is_stage3_filled: false,
          stage1_hit_time: null, stage1_hit_index: null, stage2_hit_time: null,
          stage2_hit_index: null, stage3_hit_time: null, stage3_hit_index: null,
          active_trailing_sl: parseFloat((isBullish ? anchorLevel - 1.0 : anchorLevel + 1.0).toFixed(4)),
          active_ratchet_floor: null, trailing_sl_source: 'INITIAL',
          is_be_scratch: false, is_structural_scratch: false,
          simulated_outcome: 'NO_RETEST', stage_exit_type: 'NO_RETEST',
          realized_rr: 0, mfe_r: 0, mfe_usd: 0, mae_r: 0, mae_usd: 0,
          bars_to_outcome: null, exit_time: null, exit_price: null,
        };
        detectedSetups.push(polarityGuardSetup);
        continue;
      }

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
          sweep_wick_ratio: null,
          is_wick_rejection_sweep: false,
          sweep_ob_mt: null,
          sweep_ob_proximal: null,
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
          reclaim_fvg_proximal: null,
          reclaim_fvg_distal: null,
          displacement_impulse_high: null,
          displacement_impulse_low: null,
          ote_62_price: null,
          bars_sweep_to_reclaim: null,
          is_reclaimed: false,

          pillar1_volume_ratio_passed: false,
          pillar2_delta_dominance_passed: false,
          pillar3_body_ratio_passed: false,
          three_pillar_displacement_passed: false,

          retest_index: null,
          retest_time: null,
          retest_price: null,
          bars_reclaim_to_retest: null,
          is_retested: false,
          is_immediate_fill: false,
          max_retest_index: null,
          is_expired: false,
          body_defense_passed: false,

          dealing_range_equilibrium: null,
          is_valuation_aligned: false,
          market_regime_at_entry: 'ROTATIONAL_AUCTION',
          valuation_gate_mode: 'STRUCTURAL_EQ',
          wave_fingerprint: `${anchorTime}_${isBullish ? 'BULLISH' : 'BEARISH'}`,
          is_wave_champion: true,
          wave_cluster_size: 1,
          stacking_discount_applied: false,

          entry_mode: entryMode,
          entry_price: parseFloat(anchorLevel.toFixed(4)),
          stop_loss: parseFloat(
            (isBullish ? anchorLevel - anchorLevel * 0.0015 : anchorLevel + anchorLevel * 0.0015).toFixed(4)
          ),
          risk_usd: parseFloat((anchorLevel * 0.0015).toFixed(4)),
          risk_pct: 0.15,
          stage1_target: parseFloat(
            (isBullish ? anchorLevel + stage1Multiple * (anchorLevel * 0.0015) : anchorLevel - stage1Multiple * (anchorLevel * 0.0015)).toFixed(4)
          ),
          stage2_target: parseFloat(
            (isBullish ? anchorLevel + stage2Multiple * (anchorLevel * 0.0015) : anchorLevel - stage2Multiple * (anchorLevel * 0.0015)).toFixed(4)
          ),
          stage3_target: parseFloat(
            (isBullish ? anchorLevel + stage3Multiple * (anchorLevel * 0.0015) : anchorLevel - stage3Multiple * (anchorLevel * 0.0015)).toFixed(4)
          ),
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
          active_trailing_sl: parseFloat(
            (isBullish ? anchorLevel - 1.0 : anchorLevel + 1.0).toFixed(4)
          ),
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

      // ─── Phase 3: 3-Pillar Volumetric Displacement Reclaim Confirmation ──────
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

      let p1Passed = false;
      let p2Passed = false;
      let p3Passed = false;
      let threePillarsPassed = false;

      // Helper: Extract taker buy volume with Wyckoff price-range conviction fallback
      const getTakerBuyVol = (ck: any): number => {
        const v = Number.isFinite(ck.v) ? Number(ck.v) : 0;
        if (Number.isFinite(ck.taker_buy_vol) && !isNaN(ck.taker_buy_vol) && ck.taker_buy_vol > 0) {
          return Number(ck.taker_buy_vol);
        }
        const h = Number.isFinite(ck.h) ? Number(ck.h) : Number(ck.high ?? 0);
        const l = Number.isFinite(ck.l) ? Number(ck.l) : Number(ck.low ?? 0);
        const cl = Number.isFinite(ck.c) ? Number(ck.c) : Number(ck.close ?? 0);
        const range = Math.max(0.0001, h - l);
        const conviction = Math.min(1.0, Math.max(0.0, (cl - l) / range));
        return conviction * v;
      };

      const getTakerSellVol = (ck: any): number => {
        const v = Number.isFinite(ck.v) ? Number(ck.v) : 0;
        if (Number.isFinite(ck.taker_sell_vol) && !isNaN(ck.taker_sell_vol) && ck.taker_sell_vol > 0) {
          return Number(ck.taker_sell_vol);
        }
        return Math.max(0, v - getTakerBuyVol(ck));
      };

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
            // Multi-Candle Displacement Window: inspect [sweepIdx..i] for absorption + follow-through
            let maxVolExpInWindow = 0;
            let windowVolSum = 0;
            let windowTakerBuySum = 0;
            let maxBodyRatioInWindow = 0;

            for (let k = sweepIdx; k <= i; k++) {
              const ck = candles[k];
              const ckClose = ck.c ?? (ck as any).close;
              const ckOpen = ck.o ?? (ck as any).open;
              const ckHigh = ck.h ?? (ck as any).high;
              const ckLow = ck.l ?? (ck as any).low;
              const ckVol = Number.isFinite(ck.v) ? (ck.v as number) : 0;
              const ckAvgVol = volSmaSeries[k] || 1;
              const ckVolExp = ckAvgVol > 0 ? ckVol / ckAvgVol : 1.0;
              if (ckVolExp > maxVolExpInWindow) maxVolExpInWindow = ckVolExp;

              const ckTBuy = getTakerBuyVol(ck);
              windowVolSum += ckVol;
              windowTakerBuySum += ckTBuy;

              const ckRange = Math.max(0.0001, ckHigh - ckLow);
              const ckBody = Math.abs(ckClose - ckOpen);
              const ckBodyRatio = ckBody / ckRange;
              if (ckBodyRatio > maxBodyRatioInWindow) maxBodyRatioInWindow = ckBodyRatio;
            }

            const curAvgVol = volSmaSeries[i] || 1;
            const curRawVol = Number.isFinite(c.v) ? (c.v as number) : 0;
            const curVolExp = (Number.isFinite(curAvgVol) && curAvgVol > 0) ? curRawVol / curAvgVol : 1.0;

            const curTakerBuy = getTakerBuyVol(c);
            const curDeltaPct = curRawVol > 0 ? (curTakerBuy / curRawVol) * 100 : 50.0;
            const windowDeltaPct = windowVolSum > 0 ? (windowTakerBuySum / windowVolSum) * 100 : 50.0;
            const effectiveDeltaPct = Math.max(curDeltaPct, windowDeltaPct);

            const targetBodyThreshold = bodyRatioThreshold > 1 ? bodyRatioThreshold / 100 : bodyRatioThreshold;

            // Pillar 1: Volume expansion on sweep absorption bar, reclaim bar, or window max
            const curP1 = maxVolExpInWindow >= volumeExpansionThreshold || curVolExp >= volumeExpansionThreshold;
            // Pillar 2: Taker delta dominance on reclaim bar or across sweep-reclaim window
            const curP2 = effectiveDeltaPct >= deltaDominanceThreshold;
            // Pillar 3: Body-to-range conviction on reclaim bar or displacement impulse
            const curP3 = bodyRatio >= targetBodyThreshold || maxBodyRatioInWindow >= targetBodyThreshold;
            const curAll3 = curP1 && curP2 && curP3;

            if (curP1) p1Passed = true;
            if (curP2) p2Passed = true;
            if (curP3) p3Passed = true;

            if (requireThreePillar && !curAll3) {
              continue; // Veto low-momentum overlap
            }

            // Check / Extract Active Displacement BISI FVG
            let foundFvg = false;
            let fvgTop = 0;
            let fvgBottom = 0;
            // FVG must be formed strictly by candles that have already closed on or before reclaim candle i
            const searchMax = i;
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
            reclaimVolExp = parseFloat(Math.max(curVolExp, maxVolExpInWindow).toFixed(2));
            reclaimBodyRatio = parseFloat((Math.max(bodyRatio, maxBodyRatioInWindow) * 100).toFixed(1));
            reclaimDeltaDominance = parseFloat(effectiveDeltaPct.toFixed(1));

            p1Passed = true;
            p2Passed = true;
            p3Passed = true;
            threePillarsPassed = true;

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
            // Multi-Candle Displacement Window: inspect [sweepIdx..i] for absorption + follow-through
            let maxVolExpInWindow = 0;
            let windowVolSum = 0;
            let windowTakerSellSum = 0;
            let maxBodyRatioInWindow = 0;

            for (let k = sweepIdx; k <= i; k++) {
              const ck = candles[k];
              const ckClose = ck.c ?? (ck as any).close;
              const ckOpen = ck.o ?? (ck as any).open;
              const ckHigh = ck.h ?? (ck as any).high;
              const ckLow = ck.l ?? (ck as any).low;
              const ckVol = Number.isFinite(ck.v) ? (ck.v as number) : 0;
              const ckAvgVol = volSmaSeries[k] || 1;
              const ckVolExp = ckAvgVol > 0 ? ckVol / ckAvgVol : 1.0;
              if (ckVolExp > maxVolExpInWindow) maxVolExpInWindow = ckVolExp;

              const ckTSell = getTakerSellVol(ck);
              windowVolSum += ckVol;
              windowTakerSellSum += ckTSell;

              const ckRange = Math.max(0.0001, ckHigh - ckLow);
              const ckBody = Math.abs(ckClose - ckOpen);
              const ckBodyRatio = ckBody / ckRange;
              if (ckBodyRatio > maxBodyRatioInWindow) maxBodyRatioInWindow = ckBodyRatio;
            }

            const curAvgVol = volSmaSeries[i] || 1;
            const curRawVol = Number.isFinite(c.v) ? (c.v as number) : 0;
            const curVolExp = (Number.isFinite(curAvgVol) && curAvgVol > 0) ? curRawVol / curAvgVol : 1.0;

            const curTakerSell = getTakerSellVol(c);
            const curDeltaPct = curRawVol > 0 ? (curTakerSell / curRawVol) * 100 : 50.0;
            const windowDeltaPct = windowVolSum > 0 ? (windowTakerSellSum / windowVolSum) * 100 : 50.0;
            const effectiveDeltaPct = Math.max(curDeltaPct, windowDeltaPct);

            const targetBodyThreshold = bodyRatioThreshold > 1 ? bodyRatioThreshold / 100 : bodyRatioThreshold;

            const curP1 = maxVolExpInWindow >= volumeExpansionThreshold || curVolExp >= volumeExpansionThreshold;
            const curP2 = effectiveDeltaPct >= deltaDominanceThreshold;
            const curP3 = bodyRatio >= targetBodyThreshold || maxBodyRatioInWindow >= targetBodyThreshold;
            const curAll3 = curP1 && curP2 && curP3;

            if (curP1) p1Passed = true;
            if (curP2) p2Passed = true;
            if (curP3) p3Passed = true;

            if (requireThreePillar && !curAll3) {
              continue; // Veto low-momentum overlap
            }

            // Check / Extract Active Displacement SIBI FVG
            let foundFvg = false;
            let fvgTop = 0;
            let fvgBottom = 0;
            // FVG must be formed strictly by candles that have already closed on or before reclaim candle i
            const searchMax = i;
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
            reclaimVolExp = parseFloat(Math.max(curVolExp, maxVolExpInWindow).toFixed(2));
            reclaimBodyRatio = parseFloat((Math.max(bodyRatio, maxBodyRatioInWindow) * 100).toFixed(1));
            reclaimDeltaDominance = parseFloat(effectiveDeltaPct.toFixed(1));

            p1Passed = true;
            p2Passed = true;
            p3Passed = true;
            threePillarsPassed = true;

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

      // ── Dealing Range & Valuation Gating (Discount vs Premium) ──────────────
      let dealingRangeEquilibrium: number | null = null;
      if (
        this.config.structuralDealingRange &&
        Number.isFinite(this.config.structuralDealingRange.equilibrium) &&
        this.config.structuralDealingRange.equilibrium > 0
      ) {
        dealingRangeEquilibrium = parseFloat(this.config.structuralDealingRange.equilibrium.toFixed(4));
      } else if (this.confirmedPivots && this.confirmedPivots.length > 0) {
        const evalIndex = reclaimIdx !== null ? reclaimIdx : (sweepIdx !== null ? sweepIdx : anchorIdx);
        const pastPivots = this.confirmedPivots.filter((p) => p.index <= evalIndex && p.confirmed);
        // Prioritize Level 2 (MAJOR) swings for macro structural dealing range
        const majorHighs = pastPivots.filter((p) => p.type === 'SWING_HIGH' && (p.level ?? 0) === 2);
        const majorLows = pastPivots.filter((p) => p.type === 'SWING_LOW' && (p.level ?? 0) === 2);
        const lastHigh = (majorHighs.length > 0 ? majorHighs : pastPivots.filter((p) => p.type === 'SWING_HIGH' && (p.level ?? 0) >= 1)).pop();
        const lastLow = (majorLows.length > 0 ? majorLows : pastPivots.filter((p) => p.type === 'SWING_LOW' && (p.level ?? 0) >= 1)).pop();
        if (lastHigh && lastLow && lastHigh.price > lastLow.price) {
          dealingRangeEquilibrium = parseFloat(((lastHigh.price + lastLow.price) / 2).toFixed(4));
        }
      }

      if (dealingRangeEquilibrium === null) {
        const lookbackStart = Math.max(0, anchorIdx - (this.config.lookbackMajor ?? 15) * 6);
        const lookbackEnd = reclaimIdx !== null ? reclaimIdx : sweepIdx;
        let rangeHigh = -Infinity;
        let rangeLow = Infinity;
        for (let k = lookbackStart; k <= lookbackEnd; k++) {
          const cHigh = candles[k].h ?? (candles[k] as any).high;
          const cLow = candles[k].l ?? (candles[k] as any).low;
          if (cHigh > rangeHigh) rangeHigh = cHigh;
          if (cLow < rangeLow) rangeLow = cLow;
        }
        dealingRangeEquilibrium =
          rangeHigh > rangeLow ? parseFloat(((rangeHigh + rangeLow) / 2).toFixed(4)) : anchorLevel;
      }

      // Extract displacement impulse bounds from sweep to reclaim
      let impulseHigh = -Infinity;
      let impulseLow = Infinity;
      const impStart = sweepIdx !== null ? sweepIdx : anchorIdx;
      const impEnd = reclaimIdx !== null ? reclaimIdx : sweepIdx !== null ? sweepIdx : anchorIdx;
      for (let k = impStart; k <= impEnd; k++) {
        const cHigh = candles[k].h ?? (candles[k] as any).high;
        const cLow = candles[k].l ?? (candles[k] as any).low;
        if (cHigh > impulseHigh) impulseHigh = cHigh;
        if (cLow < impulseLow) impulseLow = cLow;
      }

      const sweepCandleData = sweepIdx !== null ? {
        high: candles[sweepIdx].h ?? (candles[sweepIdx] as any).high,
        low: candles[sweepIdx].l ?? (candles[sweepIdx] as any).low,
        open: candles[sweepIdx].o ?? (candles[sweepIdx] as any).open,
        close: candles[sweepIdx].c ?? (candles[sweepIdx] as any).close,
        mt: sweepObMt ?? ((candles[sweepIdx].h ?? (candles[sweepIdx] as any).high) + (candles[sweepIdx].l ?? (candles[sweepIdx] as any).low)) / 2,
      } : null;

      const fvgData = (reclaimFvgCreated && reclaimFvgTop !== null && reclaimFvgBottom !== null) ? {
        top: reclaimFvgTop,
        bottom: reclaimFvgBottom,
        ce: reclaimFvgCe ?? (reclaimFvgTop + reclaimFvgBottom) / 2,
      } : null;

      const displacementData = (impulseHigh > impulseLow) ? {
        impulseHigh,
        impulseLow,
      } : null;

      // Select Entry Level via centralized price resolver
      const executionEntry = resolveRetestEntryPrice({
        mode: entryMode,
        isBullish,
        anchorLevel,
        sweepCandle: sweepCandleData,
        fvg: fvgData,
        displacementExtremes: displacementData,
      });

      // Directional geometry fields
      const sweepObProximal = sweepCandleData ? (isBullish ? sweepCandleData.high : sweepCandleData.low) : null;
      const reclaimFvgProximal = fvgData ? (isBullish ? fvgData.bottom : fvgData.top) : null;
      const reclaimFvgDistal = fvgData ? (isBullish ? fvgData.top : fvgData.bottom) : null;
      const ote62Price = displacementData ? resolveRetestEntryPrice({
        mode: 'OTE_62',
        isBullish,
        anchorLevel,
        displacementExtremes: displacementData,
      }) : null;

      // ── Regime-Adaptive Valuation Gating (Trend-Direction Decoupling) ─────────
      const evalIdx = reclaimIdx !== null ? reclaimIdx : (sweepIdx !== null ? sweepIdx : anchorIdx);
      const regimeAnalysis = (this.config.enableRegimeAdaptiveEQ !== false)
        ? classifyMarketRegime(evalIdx, candles, atrSeries, bootstrap, this.config)
        : { regime: 'ROTATIONAL_AUCTION' as MarketRegimeState, direction: 'NEUTRAL' as const, velocity: 0 };
      const marketRegime = regimeAnalysis.regime;
      const regimeDirection = regimeAnalysis.direction;

      let valuationGateMode: ValuationGateMode = 'STRUCTURAL_EQ';
      let localWaveEquilibrium: number | null = null;
      let htfSweepRequired = false;
      let htfSweepLevel: number | null = null;
      let isValuationAligned = false;

      if (marketRegime === 'RUNAWAY_EXPANSION') {
        const isWithTrend = (isBullish && regimeDirection === 'BULLISH') || (!isBullish && regimeDirection === 'BEARISH');
        if (isWithTrend) {
          // Trend-following: decouple from macro EQ, use local wave midpoint
          const localWaveMidpoint = impulseHigh > impulseLow
            ? parseFloat(((impulseHigh + impulseLow) / 2).toFixed(4))
            : (dealingRangeEquilibrium ?? anchorLevel);
          localWaveEquilibrium = localWaveMidpoint;
          valuationGateMode = 'LOCAL_WAVE_EQ';
          isValuationAligned = isBullish
            ? executionEntry <= localWaveMidpoint
            : executionEntry >= localWaveMidpoint;
        } else {
          // Counter-trend: Require sweep of Major HTF level
          valuationGateMode = 'HTF_SWEEP_REQUIRED';
          htfSweepRequired = true;
          htfSweepLevel = anchorLevel;
          const isMajorHtf =
            anchorGrade === 'DAILY' ||
            anchorGrade === 'SESSION' ||
            anchorGrade === 'MAJOR' ||
            anchorType === 'PDH' ||
            anchorType === 'PDL' ||
            anchorType === 'LONDON_HIGH' ||
            anchorType === 'LONDON_LOW' ||
            anchorType === 'ASIAN_HIGH' ||
            anchorType === 'ASIAN_LOW';
          if (isMajorHtf) {
            const eq = dealingRangeEquilibrium ?? anchorLevel;
            isValuationAligned = isBullish
              ? executionEntry <= eq
              : executionEntry >= eq;
          } else {
            isValuationAligned = false; // Veto counter-trend minor anchor entries during runaway expansion
          }
        }
      } else if (marketRegime === 'TRANSITIONAL_EXPANSION') {
        valuationGateMode = 'RELAXED_EQ';
        const atr = atrSeries[evalIdx] || 1.0;
        const relaxedBuffer = (this.config.relaxedEqAtrBufferMultiplier ?? 0.25) * atr;
        const eq = dealingRangeEquilibrium ?? anchorLevel;
        isValuationAligned = isBullish
          ? executionEntry <= eq + relaxedBuffer
          : executionEntry >= eq - relaxedBuffer;
      } else {
        // ROTATIONAL_AUCTION (Default)
        valuationGateMode = 'STRUCTURAL_EQ';
        const eq = dealingRangeEquilibrium ?? anchorLevel;
        isValuationAligned = isBullish
          ? executionEntry <= eq
          : executionEntry >= eq;
      }

      // ── Wave Fingerprint Generation for Multi-Anchor Deduplication ────────────
      let waveFingerprint: string;
      if (reclaimIdx !== null && sweepIdx !== null) {
        const midpoint = impulseHigh > impulseLow ? (impulseHigh + impulseLow) / 2 : (candles[reclaimIdx].c ?? (candles[reclaimIdx] as any).close);
        const atr = atrSeries[reclaimIdx] || 1.0;
        const priceBand = Math.floor(midpoint / Math.max(0.5, atr));
        // Cluster by reclaim time, direction, and price band so all multi-anchor sweeps reclaimed together belong to the same wave cluster
        waveFingerprint = `${candles[reclaimIdx].t}_${isBullish ? 'BULLISH' : 'BEARISH'}_${priceBand}`;
      } else if (sweepIdx !== null) {
        waveFingerprint = `${anchorTime}_${candles[sweepIdx].t}_${isBullish ? 'BULLISH' : 'BEARISH'}`;
      } else {
        waveFingerprint = `${anchorTime}_${isBullish ? 'BULLISH' : 'BEARISH'}`;
      }

      // Stop Loss: Locked 1 tick beyond sweep candle extreme with Anti-Micro-Friction Clamp (0.15% minimum distance)
      const atrAtSweep = atrSeries[sweepIdx] || 1.0;
      const slBuffer = Math.max(0.01, (this.config.slBufferAtrMultiplier ?? 0.15) * atrAtSweep);

      const rawStopLoss = isBullish
        ? Math.min(sweepExtremePrice - slBuffer, executionEntry - 0.50)
        : Math.max(sweepExtremePrice + slBuffer, executionEntry + 0.50);

      const calculatedRawDistance = Math.abs(executionEntry - rawStopLoss);
      const minStopLossDistance = Math.max(calculatedRawDistance, executionEntry * 0.0015);
      const stopLoss = isBullish
        ? parseFloat((executionEntry - minStopLossDistance).toFixed(4))
        : parseFloat((executionEntry + minStopLossDistance).toFixed(4));

      const riskUsd = minStopLossDistance;
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

      // ── BUG-1 FIX: 3-Candle Displacement Sequence — Anchor to reclaimIdx ────
      // When reclaimIdx is confirmed, extract the 3-candle sequence as:
      //   Candle 1 (Origin / Sweep Base):      candles[reclaimIdx - 2]
      //   Candle 2 (Displacement Impulse):     candles[reclaimIdx - 1]
      //   Candle 3 (Confirmation / Reclaim):   candles[reclaimIdx]
      // This guarantees three consecutive, distinct bars anchored to the reclaim
      // event, eliminating duplicate timestamps in the Audit Inspector.
      // Fall back to sweep-relative indexing only when reclaimIdx is null (no
      // reclaim found) using sweepIdx as Candle 1 / +1 / +2.
      const displacementCandles: DisplacementCandleAudit[] = [];
      if (sweepIdx !== null && sweepIdx < candles.length) {
        const hasConfirmedReclaim = reclaimIdx !== null && reclaimIdx >= 2;

        // Resolve indices — clamp strictly within [0, n-1] bounds
        const c1Idx = hasConfirmedReclaim
          ? Math.max(0, reclaimIdx! - 2)
          : Math.max(0, sweepIdx);
        const c2Idx = hasConfirmedReclaim
          ? Math.max(0, reclaimIdx! - 1)
          : Math.min(candles.length - 1, sweepIdx + 1);
        const c3Idx = hasConfirmedReclaim
          ? Math.min(candles.length - 1, reclaimIdx!)
          : Math.min(candles.length - 1, sweepIdx + 2);

        // Deduplicate: if any two indices resolve to the same value, fall back to
        // purely sweep-relative indexing to avoid emitting duplicate timestamps.
        const indicesAreUnique = c1Idx !== c2Idx && c2Idx !== c3Idx && c1Idx !== c3Idx;
        const baseC1 = indicesAreUnique ? c1Idx : Math.max(0, sweepIdx);
        const baseC2 = indicesAreUnique ? c2Idx : Math.min(candles.length - 1, sweepIdx + 1);
        const baseC3 = indicesAreUnique ? c3Idx : Math.min(candles.length - 1, sweepIdx + 2);

        const c1 = candles[baseC1];
        displacementCandles.push({
          label: 'Candle 1 (Origin / Sweep Base)',
          time: c1.t,
          open: parseFloat(Number(c1.o ?? (c1 as any).open).toFixed(2)),
          high: parseFloat(Number(c1.h ?? (c1 as any).high).toFixed(2)),
          low: parseFloat(Number(c1.l ?? (c1 as any).low).toFixed(2)),
          close: parseFloat(Number(c1.c ?? (c1 as any).close).toFixed(2)),
          volume: parseFloat(Number(c1.v ?? (c1 as any).volume ?? 0).toFixed(2)),
        });

        const c2 = candles[baseC2];
        displacementCandles.push({
          label: 'Candle 2 (Expansion Impulse)',
          time: c2.t,
          open: parseFloat(Number(c2.o ?? (c2 as any).open).toFixed(2)),
          high: parseFloat(Number(c2.h ?? (c2 as any).high).toFixed(2)),
          low: parseFloat(Number(c2.l ?? (c2 as any).low).toFixed(2)),
          close: parseFloat(Number(c2.c ?? (c2 as any).close).toFixed(2)),
          volume: parseFloat(Number(c2.v ?? (c2 as any).volume ?? 0).toFixed(2)),
        });

        const c3 = candles[baseC3];
        displacementCandles.push({
          label: 'Candle 3 (Confirmation / Reclaim Close)',
          time: c3.t,
          open: parseFloat(Number(c3.o ?? (c3 as any).open).toFixed(2)),
          high: parseFloat(Number(c3.h ?? (c3 as any).high).toFixed(2)),
          low: parseFloat(Number(c3.l ?? (c3 as any).low).toFixed(2)),
          close: parseFloat(Number(c3.c ?? (c3 as any).close).toFixed(2)),
          volume: parseFloat(Number(c3.v ?? (c3 as any).volume ?? 0).toFixed(2)),
        });
      }

      const baseSetup: SweepReclaimSetup = {
        id: setupId,
        type: isBullish ? 'BULLISH' : 'BEARISH',
        symbol: this.config.symbol || 'ETHUSDC',
        timeframe: this.config.timeframe || '15m',
        phase: reclaimFound ? 'RECLAIM' : 'SWEEP',
        status: reclaimFound ? 'RECLAIMED_NO_RETEST' : 'SWEPT_NO_RECLAIM',
        displacement_candles: displacementCandles,

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
        sweep_wick_ratio: sweepWickRatio,
        is_wick_rejection_sweep: isWickRejection,
        sweep_ob_mt: sweepObMt,
        sweep_ob_proximal: sweepObProximal !== null ? parseFloat(sweepObProximal.toFixed(4)) : null,
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
        reclaim_fvg_proximal: reclaimFvgProximal !== null ? parseFloat(reclaimFvgProximal.toFixed(4)) : null,
        reclaim_fvg_distal: reclaimFvgDistal !== null ? parseFloat(reclaimFvgDistal.toFixed(4)) : null,
        displacement_impulse_high: impulseHigh !== -Infinity ? parseFloat(impulseHigh.toFixed(4)) : null,
        displacement_impulse_low: impulseLow !== Infinity ? parseFloat(impulseLow.toFixed(4)) : null,
        ote_62_price: ote62Price !== null ? parseFloat(ote62Price.toFixed(4)) : null,
        bars_sweep_to_reclaim: reclaimIdx !== null ? reclaimIdx - sweepIdx : null,
        is_reclaimed: reclaimFound,

        // ── BUG-2 FIX: Re-derive 3-Pillar flags from stored final metrics ────────
        // The stored display metrics (reclaim_volume_expansion, reclaim_body_ratio,
        // reclaim_delta_dominance_pct) are window-maxed values. Re-computing the
        // boolean flags from these exact stored values — rather than from the
        // intermediate window variables — guarantees that the Audit Inspector badge
        // is mathematically consistent with what each pillar row displays.
        // Strict conjunction: if any single pillar fails → three_pillar = false.
        pillar1_volume_ratio_passed: p1Passed,
        pillar2_delta_dominance_passed: p2Passed,
        pillar3_body_ratio_passed: p3Passed,
        three_pillar_displacement_passed: p1Passed && p2Passed && p3Passed,

        retest_index: null,
        retest_time: null,
        retest_price: null,
        bars_reclaim_to_retest: null,
        is_retested: false,
        is_immediate_fill: false,
        max_retest_index: null,
        is_expired: false,
        body_defense_passed: false,

        dealing_range_equilibrium: dealingRangeEquilibrium,
        is_valuation_aligned: isValuationAligned,
        market_regime_at_entry: marketRegime,
        valuation_gate_mode: valuationGateMode,
        local_wave_equilibrium: localWaveEquilibrium,
        htf_sweep_required: htfSweepRequired,
        htf_sweep_level: htfSweepLevel,

        wave_fingerprint: waveFingerprint,
        is_wave_champion: true,
        wave_cluster_size: 1,
        stacking_discount_applied: false,

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

      if (enforceDiscountPremium && !isValuationAligned) {
        baseSetup.status = 'RECLAIMED_NO_RETEST';
        baseSetup.simulated_outcome = 'INVALIDATED';
        detectedSetups.push(baseSetup);
        continue;
      }

      // ─── Phase 4: Independent Retest & 3-Stage Harvest Execution Simulation ───
      // 0. Immediate Missed Expansion Check at Reclaim Candle Close:
      // If the reclaim candle itself has already closed at or past Target 1,
      // price expanded directly to TP1 during displacement without waiting for a retrace.
      // In live PM2 (Gate 4), this setup is rejected as MISSED_TP1_EXPANSION and never armed.
      const reclaimCandle = candles[reclaimIdx];
      const reclaimClose = reclaimCandle.c ?? (reclaimCandle as any).close;
      if ((isBullish && reclaimClose >= target1) || (!isBullish && reclaimClose <= target1)) {
        baseSetup.status = 'RECLAIMED_NO_RETEST';
        baseSetup.simulated_outcome = 'NO_RETEST';
        baseSetup.stage_exit_type = 'NO_RETEST';
        detectedSetups.push(baseSetup);
        continue;
      }

      const effectiveMaxRetestIdx = Math.min(n - 1, reclaimIdx + (this.config.maxBarsToRetest ?? 12));
      let retestFound = false;
      let retestIdx: number | null = null;
      let retestPrice: number | null = null;
      let retestTime: number | null = null;
      let bodyDefenseValid = false;

      // 1. Search subsequent candles strictly AFTER the reclaim candle has closed
      // (An institutional limit order placed upon candle close can only execute on subsequent ticks/bars)
      for (let i = reclaimIdx + 1; i <= effectiveMaxRetestIdx; i++) {
        const c = candles[i];
        const open = c.o ?? (c as any).open;
        const low = c.l ?? (c as any).low;
        const high = c.h ?? (c as any).high;
        const close = c.c ?? (c as any).close;

        if (isBullish) {
          // 1. Retest Fill: If price dipped to or below limit entry on this candle, order fills!
          if (low <= executionEntry) {
            retestFound = true;
            retestIdx = i;
            retestPrice = executionEntry;
            retestTime = c.t;
            bodyDefenseValid = true;
            break;
          }

          // 2. Pre-fill target invalidation (MISSED_TP1_EXPANSION):
          // Only triggers if price reached target 1 WITHOUT touching entry (low > executionEntry)
          if (open >= target1 || high >= target1) {
            baseSetup.status = 'RECLAIMED_NO_RETEST';
            baseSetup.simulated_outcome = 'NO_RETEST';
            baseSetup.stage_exit_type = 'NO_RETEST';
            break;
          }

          // 3. Pre-fill stop loss breach (price dumped past SL without touching entry)
          if (open <= stopLoss || low <= stopLoss) {
            baseSetup.status = 'INVALIDATED_AT_RETEST';
            baseSetup.simulated_outcome = 'NO_RETEST';
            baseSetup.stage_exit_type = 'NO_RETEST';
            break;
          }
        } else {
          // 1. Retest Fill: If price rallied to or above limit entry on this candle, order fills!
          if (high >= executionEntry) {
            retestFound = true;
            retestIdx = i;
            retestPrice = executionEntry;
            retestTime = c.t;
            bodyDefenseValid = true;
            break;
          }

          // 2. Pre-fill target invalidation (MISSED_TP1_EXPANSION):
          // Only triggers if price reached target 1 WITHOUT touching entry (high < executionEntry)
          if (open <= target1 || low <= target1) {
            baseSetup.status = 'RECLAIMED_NO_RETEST';
            baseSetup.simulated_outcome = 'NO_RETEST';
            baseSetup.stage_exit_type = 'NO_RETEST';
            break;
          }

          // 3. Pre-fill stop loss breach (price rallied past SL without touching entry)
          if (open >= stopLoss || high >= stopLoss) {
            baseSetup.status = 'INVALIDATED_AT_RETEST';
            baseSetup.simulated_outcome = 'NO_RETEST';
            baseSetup.stage_exit_type = 'NO_RETEST';
            break;
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

      // Retest Freshness & Pullback Discrimination Classification
      const retestDelay = retestIdx - reclaimIdx;
      let retestFreshness: RetestFreshness = 'STANDARD';
      if (retestDelay === 1) retestFreshness = 'IMMEDIATE';
      else if (retestDelay <= 3) retestFreshness = 'FAST';
      else if (retestDelay <= 8) retestFreshness = 'STANDARD';
      else if (retestDelay <= (this.config.maxBarsToRetest ?? 12)) retestFreshness = 'EXTENDED';
      else retestFreshness = 'STALE';

      let maxExcursionPrice = 0;
      for (let k = reclaimIdx + 1; k <= retestIdx; k++) {
        const ck = candles[k];
        const cHigh = ck.h ?? (ck as any).high;
        const cLow = ck.l ?? (ck as any).low;
        if (isBullish) {
          const exc = cHigh - executionEntry;
          if (exc > maxExcursionPrice) maxExcursionPrice = exc;
        } else {
          const exc = executionEntry - cLow;
          if (exc > maxExcursionPrice) maxExcursionPrice = exc;
        }
      }
      const excR = riskUsd > 0 ? maxExcursionPrice / riskUsd : 0;
      const retestMaxExcursionR = parseFloat(excR.toFixed(2));
      const pullbackThreshold = this.config.pullbackExcursionThreshold ?? 0.5;
      const retestType: RetestType = excR >= pullbackThreshold
        ? 'PULLBACK_RETEST'
        : excR >= 0.2
        ? 'SHALLOW_PULLBACK'
        : 'CONTINUATION';

      baseSetup.phase = 'RETEST';
      baseSetup.status = 'RETESTED';
      baseSetup.is_retested = true;
      baseSetup.body_defense_passed = true;
      baseSetup.retest_index = retestIdx;
      baseSetup.retest_time = retestTime;
      baseSetup.retest_price = retestPrice;
      baseSetup.bars_reclaim_to_retest = retestDelay;
      baseSetup.retest_freshness = retestFreshness;
      baseSetup.retest_type = retestType;
      baseSetup.retest_max_excursion_r = retestMaxExcursionR;
      baseSetup.retest_delay_bars = retestDelay;


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
      const w1 = typeof this.config.stage1Ratio === 'number' ? this.config.stage1Ratio : 0.50;
      const w2 = typeof this.config.stage2Ratio === 'number' ? this.config.stage2Ratio : 0.50;
      const w3 = typeof this.config.stage3Ratio === 'number' ? this.config.stage3Ratio : 0.00;

      for (let i = retestIdx; i < n; i++) {
        if (!positionOpen) break;

        const c = candles[i];
        const high = c.h ?? (c as any).high;
        const low = c.l ?? (c as any).low;

        if (isBullish) {
          if (high > maxFavorablePrice) maxFavorablePrice = high;
          if (low < maxAdversePrice) maxAdversePrice = low;

          const initialBarSL = activeStopLoss;
          const hitStage1 = high >= target1;
          const hitStage2 = high >= target2;
          const hitStage3 = target3 !== null && high >= target3;

          let stageFilledThisBar = false;

          // Proactive Early Breakeven Ratchet (with Fee-Padded Breakeven & Breathing Room Guard)
          const enableEarlyBreakeven = this.config.enableEarlyBreakeven === true;
          const earlyBreakevenMultiple = typeof this.config.earlyBreakevenMultiple === 'number' ? this.config.earlyBreakevenMultiple : 0.60;
          const enableFeePaddedBreakeven = this.config.enableFeePaddedBreakeven === true;
          const breakevenOffsetPct = typeof this.config.breakevenOffsetPct === 'number' ? this.config.breakevenOffsetPct : 0.05;

          const feeOffsetPoints = enableFeePaddedBreakeven ? executionEntry * (breakevenOffsetPct / 100) : 0;
          const targetBreakevenPrice = executionEntry + feeOffsetPoints;
          const feeOffsetInR = feeOffsetPoints / riskUsd;
          const effectiveEarlyBEMultiple = enableFeePaddedBreakeven
            ? Math.max(earlyBreakevenMultiple, feeOffsetInR + 0.05)
            : earlyBreakevenMultiple;

          if (enableEarlyBreakeven && !baseSetup.is_stage1_filled) {
            const currentMfeR = (maxFavorablePrice - executionEntry) / riskUsd;
            if (currentMfeR >= effectiveEarlyBEMultiple && activeStopLoss < targetBreakevenPrice) {
              activeStopLoss = targetBreakevenPrice;
              baseSetup.active_trailing_sl = parseFloat(targetBreakevenPrice.toFixed(4));
              baseSetup.trailing_sl_source = 'BREAKEVEN';
              // Do NOT set stageFilledThisBar = true here; the new BE stop loss applies
              // starting on the next bar (i + 1), preventing false same-bar exits caused by bar i's entry dip.
            }
          }

          if (hitStage1 && !baseSetup.is_stage1_filled) {
            baseSetup.is_stage1_filled = true;
            baseSetup.stage1_hit_time = c.t;
            baseSetup.stage1_hit_index = i;
            stageFilledThisBar = true;

            if (enableStructuralTrail) {
              const structuralTrailLevel =
                reclaimFvgCe !== null && reclaimFvgCe > stopLoss ? reclaimFvgCe : targetBreakevenPrice;
              const maxGuaranteedFloor = executionEntry - 0.60 * riskUsd;
              activeStopLoss = Math.max(structuralTrailLevel, targetBreakevenPrice, maxGuaranteedFloor);
              baseSetup.active_trailing_sl = parseFloat(activeStopLoss.toFixed(4));
              baseSetup.trailing_sl_source = reclaimFvgCe !== null && reclaimFvgCe > targetBreakevenPrice ? 'FVG_CE' : 'BREAKEVEN';
            } else {
              activeStopLoss = targetBreakevenPrice;
              baseSetup.active_trailing_sl = parseFloat(targetBreakevenPrice.toFixed(4));
              baseSetup.trailing_sl_source = 'BREAKEVEN';
            }
          }

          if (hitStage2 && baseSetup.is_stage1_filled && !baseSetup.is_stage2_filled) {
            baseSetup.is_stage2_filled = true;
            baseSetup.stage2_hit_time = c.t;
            baseSetup.stage2_hit_index = i;
            stageFilledThisBar = true;

            if (w3 === 0) {
              realizedRr = w1 * stage1Multiple + w2 * stage2Multiple;
              outcome = 'FULL_TP2_WIN';
              stageExit = 'FULL_TP2_WIN';
              exitIdx = i;
              exitPrice = target2;
              exitTime = c.t;
              positionOpen = false;
              break;
            } else if (enableProfitRatchet) {
              const ratchetLevel = executionEntry + 1.0 * riskUsd;
              activeStopLoss = Math.max(activeStopLoss, ratchetLevel);
              baseSetup.active_trailing_sl = parseFloat(activeStopLoss.toFixed(4));
              baseSetup.active_ratchet_floor = parseFloat(ratchetLevel.toFixed(4));
              baseSetup.trailing_sl_source = 'PROFIT_RATCHET_FLOOR';
            }
          }

          if (w3 > 0 && hitStage3 && baseSetup.is_stage2_filled && !baseSetup.is_stage3_filled) {
            baseSetup.is_stage3_filled = true;
            baseSetup.stage3_hit_time = c.t;
            baseSetup.stage3_hit_index = i;

            realizedRr = w1 * stage1Multiple + w2 * stage2Multiple + w3 * stage3Multiple;
            outcome = 'FULL_TP3_WIN';
            stageExit = 'FULL_TP3_WIN';
            exitIdx = i;
            exitPrice = target3;
            exitTime = c.t;
            positionOpen = false;
            break;
          }

          const checkSL = stageFilledThisBar ? activeStopLoss : initialBarSL;
          if (low <= checkSL) {
            exitIdx = i;
            exitPrice = checkSL;
            exitTime = c.t;
            positionOpen = false;

            if (baseSetup.is_stage2_filled && w3 > 0) {
              const runnerR = (checkSL - executionEntry) / riskUsd;
              realizedRr = w1 * stage1Multiple + w2 * stage2Multiple + w3 * runnerR;
              outcome = 'FULL_TP2_WIN';
              stageExit = 'STAGE_2_WIN';
            } else if (baseSetup.is_stage1_filled) {
              const runnerR = (checkSL - executionEntry) / riskUsd;
              realizedRr = w1 * stage1Multiple + (w2 + w3) * runnerR;
              if (realizedRr >= 0) {
                outcome = 'BE_SCRATCH_WIN';
                stageExit = 'STAGE_1_SCRATCH';
                baseSetup.is_be_scratch = true;
              } else {
                outcome = 'STRUCTURAL_SCRATCH';
                stageExit = 'STAGE_1_SCRATCH';
                baseSetup.is_structural_scratch = true;
              }
            } else if (baseSetup.trailing_sl_source === 'BREAKEVEN' || checkSL >= executionEntry) {
              realizedRr = 0.0;
              outcome = 'BE_SCRATCH_WIN';
              stageExit = 'STAGE_1_SCRATCH';
              baseSetup.is_be_scratch = true;
            } else {
              realizedRr = -1.0;
              outcome = 'STOPPED_OUT';
              stageExit = 'STOPPED_OUT';
            }
            break;
          }
        } else {
          if (low < maxFavorablePrice) maxFavorablePrice = low;
          if (high > maxAdversePrice) maxAdversePrice = high;

          const initialBarSL = activeStopLoss;
          const hitStage1 = low <= target1;
          const hitStage2 = low <= target2;
          const hitStage3 = target3 !== null && low <= target3;

          let stageFilledThisBar = false;

          // Proactive Early Breakeven Ratchet (with Fee-Padded Breakeven & Breathing Room Guard)
          const enableEarlyBreakeven = this.config.enableEarlyBreakeven === true;
          const earlyBreakevenMultiple = typeof this.config.earlyBreakevenMultiple === 'number' ? this.config.earlyBreakevenMultiple : 0.60;
          const enableFeePaddedBreakeven = this.config.enableFeePaddedBreakeven === true;
          const breakevenOffsetPct = typeof this.config.breakevenOffsetPct === 'number' ? this.config.breakevenOffsetPct : 0.05;

          const feeOffsetPoints = enableFeePaddedBreakeven ? executionEntry * (breakevenOffsetPct / 100) : 0;
          const targetBreakevenPrice = executionEntry - feeOffsetPoints;
          const feeOffsetInR = feeOffsetPoints / riskUsd;
          const effectiveEarlyBEMultiple = enableFeePaddedBreakeven
            ? Math.max(earlyBreakevenMultiple, feeOffsetInR + 0.05)
            : earlyBreakevenMultiple;

          if (enableEarlyBreakeven && !baseSetup.is_stage1_filled) {
            const currentMfeR = (executionEntry - maxFavorablePrice) / riskUsd;
            if (currentMfeR >= effectiveEarlyBEMultiple && activeStopLoss > targetBreakevenPrice) {
              activeStopLoss = targetBreakevenPrice;
              baseSetup.active_trailing_sl = parseFloat(targetBreakevenPrice.toFixed(4));
              baseSetup.trailing_sl_source = 'BREAKEVEN';
              // Do NOT set stageFilledThisBar = true here; the new BE stop loss applies
              // starting on the next bar (i + 1), preventing false same-bar exits caused by bar i's entry rally.
            }
          }

          if (hitStage1 && !baseSetup.is_stage1_filled) {
            baseSetup.is_stage1_filled = true;
            baseSetup.stage1_hit_time = c.t;
            baseSetup.stage1_hit_index = i;
            stageFilledThisBar = true;

            if (enableStructuralTrail) {
              const structuralTrailLevel =
                reclaimFvgCe !== null && reclaimFvgCe < stopLoss ? reclaimFvgCe : targetBreakevenPrice;
              const maxGuaranteedFloor = executionEntry + 0.60 * riskUsd;
              activeStopLoss = Math.min(structuralTrailLevel, targetBreakevenPrice, maxGuaranteedFloor);
              baseSetup.active_trailing_sl = parseFloat(activeStopLoss.toFixed(4));
              baseSetup.trailing_sl_source = reclaimFvgCe !== null && reclaimFvgCe < targetBreakevenPrice ? 'FVG_CE' : 'BREAKEVEN';
            } else {
              activeStopLoss = targetBreakevenPrice;
              baseSetup.active_trailing_sl = parseFloat(targetBreakevenPrice.toFixed(4));
              baseSetup.trailing_sl_source = 'BREAKEVEN';
            }
          }

          if (hitStage2 && baseSetup.is_stage1_filled && !baseSetup.is_stage2_filled) {
            baseSetup.is_stage2_filled = true;
            baseSetup.stage2_hit_time = c.t;
            baseSetup.stage2_hit_index = i;
            stageFilledThisBar = true;

            if (w3 === 0) {
              realizedRr = w1 * stage1Multiple + w2 * stage2Multiple;
              outcome = 'FULL_TP2_WIN';
              stageExit = 'FULL_TP2_WIN';
              exitIdx = i;
              exitPrice = target2;
              exitTime = c.t;
              positionOpen = false;
              break;
            } else if (enableProfitRatchet) {
              const ratchetLevel = executionEntry - 1.0 * riskUsd;
              activeStopLoss = Math.min(activeStopLoss, ratchetLevel);
              baseSetup.active_trailing_sl = parseFloat(activeStopLoss.toFixed(4));
              baseSetup.active_ratchet_floor = parseFloat(ratchetLevel.toFixed(4));
              baseSetup.trailing_sl_source = 'PROFIT_RATCHET_FLOOR';
            }
          }

          // ── Tranche 3: Stage 3 Target (e.g. 20% at Macro DOL Target) ────────
          if (w3 > 0 && hitStage3 && baseSetup.is_stage2_filled && !baseSetup.is_stage3_filled) {
            baseSetup.is_stage3_filled = true;
            baseSetup.stage3_hit_time = c.t;
            baseSetup.stage3_hit_index = i;

            realizedRr = w1 * stage1Multiple + w2 * stage2Multiple + w3 * stage3Multiple;
            outcome = 'FULL_TP3_WIN';
            stageExit = 'FULL_TP3_WIN';
            exitIdx = i;
            exitPrice = target3;
            exitTime = c.t;
            positionOpen = false;
            break;
          }

          // Stop Loss / Ratchet Violation Check
          const checkSL = stageFilledThisBar ? activeStopLoss : initialBarSL;
          if (high >= checkSL) {
            exitIdx = i;
            exitPrice = checkSL;
            exitTime = c.t;
            positionOpen = false;

            if (baseSetup.is_stage2_filled) {
              const runnerR = (executionEntry - checkSL) / riskUsd;
              realizedRr = w1 * stage1Multiple + w2 * stage2Multiple + w3 * runnerR;
              outcome = 'FULL_TP2_WIN';
              stageExit = 'STAGE_2_WIN';
            } else if (baseSetup.is_stage1_filled) {
              const runnerR = (executionEntry - checkSL) / riskUsd;
              realizedRr = w1 * stage1Multiple + (w2 + w3) * runnerR;
              if (realizedRr >= 0) {
                outcome = 'BE_SCRATCH_WIN';
                stageExit = 'STAGE_1_SCRATCH';
                baseSetup.is_be_scratch = true;
              } else {
                outcome = 'STRUCTURAL_SCRATCH';
                stageExit = 'STAGE_1_SCRATCH';
                baseSetup.is_structural_scratch = true;
              }
            } else if (baseSetup.trailing_sl_source === 'BREAKEVEN' || checkSL <= executionEntry) {
              realizedRr = 0.0;
              outcome = 'BE_SCRATCH_WIN';
              stageExit = 'STAGE_1_SCRATCH';
              baseSetup.is_be_scratch = true;
            } else {
              realizedRr = -1.0;
              outcome = 'STOPPED_OUT';
              stageExit = 'STOPPED_OUT';
            }
            break;
          }
        }
      }

      // Calculate MFE / MAE
      const maxFavorableDelta = isBullish
        ? maxFavorablePrice - executionEntry
        : executionEntry - maxFavorablePrice;
      const maxAdverseDelta = isBullish
        ? executionEntry - maxAdversePrice
        : maxAdversePrice - executionEntry;

      const mfeR = parseFloat((Math.max(0, maxFavorableDelta) / riskUsd).toFixed(2));
      const maeR = parseFloat((Math.max(0, maxAdverseDelta) / riskUsd).toFixed(2));

      baseSetup.simulated_outcome = outcome;
      baseSetup.stage_exit_type = stageExit;
      baseSetup.realized_rr = parseFloat(realizedRr.toFixed(2));
      baseSetup.mfe_r = mfeR;
      baseSetup.mfe_usd = parseFloat((mfeR * 100).toFixed(2));
      baseSetup.mae_r = maeR;
      baseSetup.mae_usd = parseFloat((maeR * 100).toFixed(2));
      baseSetup.exit_price = exitPrice !== null ? parseFloat(exitPrice.toFixed(4)) : null;
      baseSetup.exit_time = exitTime;
      baseSetup.bars_to_outcome = exitIdx !== null ? exitIdx - retestIdx : null;

      detectedSetups.push(baseSetup);
    }

    // ── In-Scanner Multi-Anchor Wave Deduplication & Concurrency Guard ────────
    const enableInScannerWaveDedup = this.config.enableWaveDeduplication !== false && this.config.enableInScannerWaveDedup !== false;
    const enforceSinglePositionConcurrency = this.config.enforceSinglePositionConcurrency !== false;

    if (enableInScannerWaveDedup && detectedSetups.length > 0) {
      // Step 1: Cluster candidate setups by wave_fingerprint
      const waveMap = new Map<string, SweepReclaimSetup[]>();
      for (const s of detectedSetups) {
        const fp = s.wave_fingerprint || `${s.reclaim_time || s.sweep_time || s.anchor_time}_${s.type}`;
        if (!waveMap.has(fp)) {
          waveMap.set(fp, []);
        }
        waveMap.get(fp)!.push(s);
      }

      // Step 2: Elect Champion for each wave cluster using institutional market touch physics
      const champions: SweepReclaimSetup[] = [];
      for (const [_, cluster] of waveMap.entries()) {
        const clusterSize = cluster.length;
        for (const s of cluster) {
          s.wave_cluster_size = clusterSize;
        }

        if (cluster.length === 1) {
          cluster[0].is_wave_champion = true;
          champions.push(cluster[0]);
        } else {
          cluster.sort((a, b) => {
            if (a.type === 'BEARISH') {
              if (Math.abs(a.entry_price - b.entry_price) > 0.01) {
                return a.entry_price - b.entry_price; // Lowest entry touched first on rally
              }
            } else {
              if (Math.abs(a.entry_price - b.entry_price) > 0.01) {
                return b.entry_price - a.entry_price; // Highest entry touched first on dip
              }
            }
            // Tie-breaker: Anchor tier ranking
            const pA = getAnchorPriority(a.anchor_type, a.anchor_swing_grade);
            const pB = getAnchorPriority(b.anchor_type, b.anchor_swing_grade);
            if (pB !== pA) return pB - pA;

            const depthA = a.sweep_depth_pct ?? 0;
            const depthB = b.sweep_depth_pct ?? 0;
            return depthB - depthA;
          });

          cluster[0].is_wave_champion = true;
          for (let k = 1; k < cluster.length; k++) {
            cluster[k].is_wave_champion = false;
          }
          champions.push(cluster[0]);
        }
      }

      // Step 3: Single-Position Concurrency Walk & Rule 5 Post-Loss Cooldown (enforce maxOpenPositions: 1)
      if (enforceSinglePositionConcurrency) {
        // Sort champions chronologically by entry open timestamp, then tiebreak by anchor tier ranking
        champions.sort((a, b) => {
          const timeA = a.retest_time || a.reclaim_time || a.sweep_time || a.anchor_time || 0;
          const timeB = b.retest_time || b.reclaim_time || b.sweep_time || b.anchor_time || 0;
          if (timeA !== timeB) return timeA - timeB;
          const pA = getAnchorPriority(a.anchor_type, a.anchor_swing_grade);
          const pB = getAnchorPriority(b.anchor_type, b.anchor_swing_grade);
          return pB - pA;
        });

        let lastExitTimestamp = 0;
        let lastOpenTimestamp = 0;
        let lastTradeWasLoss = false;
        const cooldownMs = (typeof this.config.postLossCooldownMinutes === 'number' ? this.config.postLossCooldownMinutes : 0) * 60 * 1000;

        for (const champ of champions) {
          if (!champ.is_retested) {
            champ.stacking_discount_applied = false;
            continue;
          }
          const openTime = champ.retest_time || champ.reclaim_time || champ.sweep_time || champ.anchor_time || 0;
          const exitTime = champ.exit_time || (openTime + 15 * 60 * 1000);

          // Strictly enforce: No trade at the same open timestamp AND no trade during an active open position
          const isSameTimestamp = lastOpenTimestamp !== 0 && openTime === lastOpenTimestamp;
          const isOverlapping = lastExitTimestamp !== 0 && openTime < lastExitTimestamp;
          const inPostLossCooldown = cooldownMs > 0 && lastTradeWasLoss && lastExitTimestamp !== 0 && openTime < lastExitTimestamp + cooldownMs;

          if (!isSameTimestamp && !isOverlapping && !inPostLossCooldown) {
            champ.stacking_discount_applied = false;
            lastExitTimestamp = Math.max(lastExitTimestamp, exitTime);
            lastOpenTimestamp = openTime;
            lastTradeWasLoss = (typeof champ.realized_rr === 'number' ? champ.realized_rr : 0) < 0;
          } else {
            champ.stacking_discount_applied = true; // Overlaps with an open position, same-timestamp entry, or post-loss cooldown
          }
        }
      }
    }

    if (bootstrap && bootstrap.warmupCutoffTs) {
      detectedSetups = detectedSetups.filter((s) => {
        const triggerTime = s.reclaim_time ?? s.sweep_time ?? s.anchor_time;
        return triggerTime >= bootstrap.warmupCutoffTs;
      });
    }

    // Calculate Telemetry across detected setups
    const telemetry = this.generateTelemetrySummary(detectedSetups);

    return { setups: detectedSetups, telemetry };
  }

  /**
   * Aggregates setups into comprehensive telemetry analytics including 3-pillar displacement distributions.
   */
  private generateTelemetrySummary(setups: SweepReclaimSetup[]): SweepReclaimTelemetrySummary {
    const totalAnchors = setups.length;
    const sweptSetups = setups.filter((s) => s.sweep_index !== null);
    const totalSweeps = sweptSetups.length;
    const reclaimedSetups = setups.filter((s) => s.is_reclaimed);
    const totalReclaims = reclaimedSetups.length;

    // Executable setups: wave champions that did not suffer concurrency overlap veto
    const executableSetups = setups.filter((s) => s.is_wave_champion !== false && !s.stacking_discount_applied);
    const retestedSetups = executableSetups.filter((s) => s.is_retested);
    const totalRetests = retestedSetups.length;

    const totalRawCandidates = setups.length;
    const totalWaveChampions = setups.filter((s) => s.is_wave_champion === true).length;
    const overlappingConcurrencyVetoed = setups.filter((s) => s.stacking_discount_applied === true).length;
    const stackingReductionPct = totalRawCandidates > 0
      ? parseFloat((((totalRawCandidates - totalWaveChampions) / totalRawCandidates) * 100).toFixed(1))
      : 0;

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
      SWING_PIVOT: 0,
      ASIAN_HIGH: 0,
      ASIAN_LOW: 0,
      LONDON_HIGH: 0,
      LONDON_LOW: 0,
      PDH: 0,
      PDL: 0,
    };

    const regimeDistribution: Record<MarketRegimeState, number> = {
      ROTATIONAL_AUCTION: 0,
      TRANSITIONAL_EXPANSION: 0,
      RUNAWAY_EXPANSION: 0,
    };

    const retestFreshnessDistribution: Record<RetestFreshness, number> = {
      IMMEDIATE: 0,
      FAST: 0,
      STANDARD: 0,
      EXTENDED: 0,
      STALE: 0,
    };

    const retestTypeDistribution: Record<RetestType, number> = {
      PULLBACK_RETEST: 0,
      SHALLOW_PULLBACK: 0,
      CONTINUATION: 0,
    };

    for (const s of setups) {
      if (anchorDistribution[s.anchor_type] !== undefined) {
        anchorDistribution[s.anchor_type]++;
      }

      if (s.market_regime_at_entry && regimeDistribution[s.market_regime_at_entry] !== undefined) {
        regimeDistribution[s.market_regime_at_entry]++;
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

      // Retest metrics calculated strictly on executable clean trades
      if (s.is_retested && s.is_wave_champion !== false && !s.stacking_discount_applied) {
        if (s.retest_freshness && retestFreshnessDistribution[s.retest_freshness] !== undefined) {
          retestFreshnessDistribution[s.retest_freshness]++;
        }
        if (s.retest_type && retestTypeDistribution[s.retest_type] !== undefined) {
          retestTypeDistribution[s.retest_type]++;
        }

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
    const exScratchWinRatePct = (totalWins + totalLosses) > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : 0;
    const alphaSurvivalRatePct = totalRetests > 0 ? ((totalWins + totalBeScratches + totalStructuralScratches) / totalRetests) * 100 : 0;
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
      ex_scratch_win_rate_pct: parseFloat(exScratchWinRatePct.toFixed(1)),
      alpha_survival_rate_pct: parseFloat(alphaSurvivalRatePct.toFixed(1)),

      total_raw_candidates: totalRawCandidates,
      total_wave_champions: totalWaveChampions,
      stacking_reduction_pct: stackingReductionPct,
      overlapping_concurrency_vetoed_count: overlappingConcurrencyVetoed,

      regime_distribution: regimeDistribution,
      retest_freshness_distribution: retestFreshnessDistribution,
      retest_type_distribution: retestTypeDistribution,

      pillar1_pass_count: pillar1PassCount,
      pillar1_pass_pct: totalSweeps > 0 ? parseFloat(((pillar1PassCount / totalSweeps) * 100).toFixed(1)) : 0,
      pillar1_volume_passed_count: pillar1PassCount,
      pillar2_pass_count: pillar2PassCount,
      pillar2_pass_pct: totalSweeps > 0 ? parseFloat(((pillar2PassCount / totalSweeps) * 100).toFixed(1)) : 0,
      pillar2_delta_passed_count: pillar2PassCount,
      pillar3_pass_count: pillar3PassCount,
      pillar3_pass_pct: totalSweeps > 0 ? parseFloat(((pillar3PassCount / totalSweeps) * 100).toFixed(1)) : 0,
      pillar3_body_passed_count: pillar3PassCount,
      three_pillar_all_pass_count: threePillarAllPassCount,
      three_pillar_all_pass_pct: totalSweeps > 0 ? parseFloat(((threePillarAllPassCount / totalSweeps) * 100).toFixed(1)) : 0,
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

      total_raw_candidates: 0,
      total_wave_champions: 0,
      stacking_reduction_pct: 0,
      overlapping_concurrency_vetoed_count: 0,

      regime_distribution: {
        ROTATIONAL_AUCTION: 0,
        TRANSITIONAL_EXPANSION: 0,
        RUNAWAY_EXPANSION: 0,
      },
      retest_freshness_distribution: {
        IMMEDIATE: 0,
        FAST: 0,
        STANDARD: 0,
        EXTENDED: 0,
        STALE: 0,
      },
      retest_type_distribution: {
        PULLBACK_RETEST: 0,
        SHALLOW_PULLBACK: 0,
        CONTINUATION: 0,
      },

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
