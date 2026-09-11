/**
 * TrendContinuationEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Trend-Following & BOS Expansion Engine (Engine 2).
 *
 * Implements a deterministic, 4-phase chronological state machine:
 *  - Phase 1 (Higher Timeframe Trend Lock): Evaluates 1H/4H directional order flow
 *    using rolling structural Level-2 swing highs/lows and 120-period EMA.
 *    Strict Directional Lock: Long-Only in bullish trend, Short-Only in bearish trend.
 *    Strictly forbids counter-trend fade/scalp attempts.
 *  - Phase 2 (Confirmed Break of Structure - BOS): Detects 15m structural fractal
 *    swing pivots (Level-2 Major Swings) and demands a physical candlestick body close
 *    beyond the pivot in the direction of the HTF trend.
 *    3-Pillar Displacement Verification:
 *      - Volume Expansion >= 1.25x SMA20
 *      - Directional Taker Delta Dominance >= 52.0%
 *      - Candlestick Body-to-Range Ratio >= 50.0%
 *  - Phase 3 (Mitigation Retest Entry): Queues a resting LIMIT order at the
 *    FVG Proximal Edge (outer boundary) formed by the displacement breakout leg
 *    with a 12-bar Time-To-Live (TTL).
 *    Hard Stop Loss pinned strictly beyond the origin swing of the breakout leg
 *    with standard ATR buffer (0.10 ATR) and 0.15% minimum distance floor.
 *  - Phase 4 (Inverted Asymmetric Harvest - 30/70 Model):
 *      - Target 1 (De-Risking Tranche - 30% position): Placed at 1.5R. Banks 30%
 *        cash profit to pay for Binance fees (0.04%) and immediately ratchets SL
 *        to Breakeven (+0.015% taker shield) on bar i+1 (Next-Bar Ratchet Rule).
 *      - Target 2 (70% Macro Runner): Held for 3.0R to 5.0R (default 4.0R or dynamic
 *        opposing external liquidity).
 *      - Structural Trailing: Trails runner SL along confirmed 15m 3-bar structural
 *        higher lows (for longs) or lower highs (for shorts).
 *      - Streak Protection: Enforces a 45-minute post-loss cooldown (Rule 5)
 *        to prevent momentum re-entry tilt.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from '../fvgEngine';
import { PivotEngine } from './PivotEngine';
import { Pivot, StructuralBootstrapContext, OrderFlowState } from './types';
import { calculateValueAreaProfile, ValueAreaProfile } from './SweepReclaimEngine';
import { runRegression, OLSStatisticalValidationResult } from '../displacementEngine';
import {
  formatCairoDateTime,
  StandardizedExecutedTrade,
  calculateCompoundingMetrics,
} from './equityCalculator';

// ── Types & Interfaces ────────────────────────────────────────────────────────

export type TrendContinuationType = 'BULLISH' | 'BEARISH';
export type TrendContinuationPhase = 'HTF_LOCK' | 'BOS' | 'DISPLACEMENT' | 'RETEST';

export type TrendContinuationStatus =
  | 'RETESTED'
  | 'BOS_NO_RETEST'
  | 'BOS_DISPLACEMENT_ONLY'
  | 'INVALIDATED_AT_RETEST'
  | 'EXPIRED';

export type TrendContinuationTradeOutcome =
  | 'FULL_TP2_WIN'
  | 'STAGE_2_WIN'
  | 'BE_SCRATCH_WIN'
  | 'STRUCTURAL_SCRATCH'
  | 'STOPPED_OUT'
  | 'PENDING'
  | 'NO_RETEST'
  | 'EXPIRED'
  | 'INVALIDATED';

export type TrendContinuationStageExitType =
  | 'FULL_TP2_WIN'
  | 'STAGE_2_WIN'
  | 'STAGE_1_SCRATCH'
  | 'STOPPED_OUT'
  | 'PENDING'
  | 'NO_RETEST'
  | 'EXPIRED'
  | 'INVALIDATED';

import { DisplacementCandleAudit } from './SweepReclaimEngine';

export interface TrendContinuationSetup {
  id: string;
  type: TrendContinuationType;
  symbol: string;
  timeframe: string;
  phase: TrendContinuationPhase;
  status: TrendContinuationStatus;
  displacement_candles?: DisplacementCandleAudit[];

  // Phase 1: HTF Trend Lock
  htf_trend: 'BULLISH' | 'BEARISH';
  htf_ema120: number;
  htf_structural_trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  is_htf_aligned: boolean;

  // AMT Value Area & Anti-Chop Telemetry
  value_area_vah: number | null;
  value_area_val: number | null;
  value_area_poc: number | null;
  value_area_state: 'EXPANSION_ABOVE_VAH' | 'EXPANSION_BELOW_VAL' | 'VALUE_ACCEPTANCE_HVN' | 'POC_CONSENSUS' | 'UNKNOWN';
  is_value_area_approved: boolean;

  // OLS Statistical Validation & OI Sponsorship
  ols_t_statistic: number;
  ols_p_value: number;
  ols_confidence_tier: string;
  ols_passed: boolean;
  order_flow_regime: OrderFlowState;
  is_oi_sponsored: boolean;

  // Intermarket SMT Tracking Metadata
  smt_status?: 'BULLISH_SMT' | 'BEARISH_SMT' | 'SYMMETRIC' | 'OPPOSING_TAKER_VOLUME' | 'OPPOSING_CASCADE' | 'UNKNOWN';
  is_smt_aligned?: boolean;
  is_smt_authorized?: boolean;
  smt_gate_status?: string;

  // Phase 2: Confirmed BOS
  pivot_id?: string;
  broken_pivot_level: number;
  broken_pivot_index: number;
  broken_pivot_time: number;
  broken_pivot_type: 'SWING_HIGH' | 'SWING_LOW';
  broken_pivot_level_grade: 'MAJOR';
  bos_candle_index: number;
  bos_candle_time: number;
  bos_close_price: number;
  origin_swing_level: number;
  origin_swing_index: number;
  origin_swing_time: number;

  // 3-Pillar Volumetric Displacement Reclaim Metrics
  bos_volume_expansion: number;
  bos_body_ratio: number;
  bos_delta_dominance_pct: number;
  pillar1_volume_ratio_passed: boolean;
  pillar2_delta_dominance_passed: boolean;
  pillar3_body_ratio_passed: boolean;
  three_pillar_displacement_passed: boolean;

  // Phase 3: Mitigation Retest & FVG Geometry
  fvg_created: boolean;
  fvg_top: number | null;
  fvg_bottom: number | null;
  fvg_ce: number | null;
  fvg_proximal: number;
  fvg_distal: number | null;

  entry_price: number;
  stop_loss: number;
  risk_usd: number;
  risk_pct: number;

  // Dealing Range & HUD Telemetry
  dealing_range_equilibrium: number | null;

  // Phase 4: Inverted 30/70 Asymmetric Harvest Targets
  stage1_target: number;
  stage2_target: number;
  stage1_ratio: number;
  stage2_ratio: number;
  stage1_multiple: number;
  stage2_multiple: number;

  opposing_liquidity_name?: string | null;
  opposing_liquidity_price?: number | null;
  dynamic_target_source?: string;

  // Retest & Execution State
  retest_index: number | null;
  retest_time: number | null;
  retest_price: number | null;
  bars_bos_to_retest: number | null;
  is_retested: boolean;

  // Position Execution Tracking
  is_stage1_filled: boolean;
  is_stage2_filled: boolean;
  stage1_hit_time: number | null;
  stage1_hit_index: number | null;
  stage2_hit_time: number | null;
  stage2_hit_index: number | null;

  active_trailing_sl: number;
  trailing_sl_source: 'INITIAL' | 'BREAKEVEN' | 'PROFIT_FLOOR_1R' | 'SWING_TRAIL';
  is_be_scratch: boolean;
  is_structural_scratch: boolean;

  // Performance & Simulation Outcome
  simulated_outcome: TrendContinuationTradeOutcome;
  stage_exit_type: TrendContinuationStageExitType;
  realized_rr: number; // Gross R
  fee_in_r?: number;
  net_realized_rr?: number;
  mfe_r: number;
  mae_r: number;
  bars_to_outcome: number | null;
  exit_time: number | null;
  exit_price: number | null;
  wave_fingerprint?: string;
}

export interface TrendContinuationConfig {
  symbol?: string;
  timeframe?: string;
  lookbackMajor?: number;
  lookbackInternal?: number;

  // Phase 1: HTF Trend Lock
  emaPeriod?: number;
  enforceHtfTrendLock?: boolean;

  // AMT Value Area & Anti-Chop Gate (Macro Anchor Alignment)
  enforceValueAreaGate?: boolean;
  valueAreaLookbackBars?: number;
  valueAreaMode?: 'PREVIOUS_DAY_DEVELOPING' | 'ROLLING_HISTOGRAM';
  pocBandPct?: number;

  // OLS Statistical Validation & OI State Machine
  enforceOlsValidation?: boolean;
  enforceOiSponsorship?: boolean;

  // Intermarket SMT Tracking Options
  enforceSmtGate?: boolean;
  smtLookbackBars?: number;
  btcCandles?: Candle[];

  // Phase 2: BOS & 3-Pillar Displacement
  volumeSmaPeriod?: number;
  volumeExpansionThreshold?: number;
  deltaDominanceThreshold?: number;
  bodyRatioThreshold?: number;
  requireThreePillarDisplacement?: boolean;

  // Phase 3: Mitigation Retest
  maxBarsToRetest?: number;
  maxOriginLookbackBars?: number;
  slBufferAtrMultiplier?: number;
  entryMode?: 'FVG_PROXIMAL' | 'FVG_CE';

  // Structural Dealing Range & HUD Telemetry
  structuralDealingRange?: { high: number; low: number; equilibrium: number } | null;
  restingLiquidityPools?: { BSL_Magnets?: number[]; SSL_Magnets?: number[] };

  // Phase 4: Inverted Asymmetric Harvest (30/70)
  stage1Ratio?: number;
  stage2Ratio?: number;
  stage1Multiple?: number;
  stage2Multiple?: number;
  dynamicTp2Source?: 'OPPOSING_LIQUIDITY' | 'FIXED_RR';
  minDynamicTp2Multiple?: number;
  maxDynamicTp2Multiple?: number;

  enableM15StructuralTrail?: boolean;
  enableFeePaddedBreakeven?: boolean;
  breakevenOffsetPct?: number;
  enableDynamicProfitFloor?: boolean; // When MFE >= +2.0R, ratchet SL to +1.0R floor
  postLossCooldownMinutes?: number;
  enforceSinglePositionConcurrency?: boolean;

  // Strict Negative Filtering (Toxic Window Blacklist)
  enforceToxicWindowBlacklist?: boolean;
  enforceRolloverFreeze?: boolean;
  enforceNewsFreeze?: boolean;

  // Institutional Fee Schedule
  makerFeePct?: number;
  takerFeePct?: number;
  initialEquity?: number;
  compoundingRiskPct?: number;
}

export interface TrendContinuationTelemetrySummary {
  totalCandles: number;
  totalBosDetected: number;
  retestedTradesCount: number;
  winningTradesCount: number;
  losingTradesCount: number;
  scratchTradesCount: number;
  executionWinRatePct: number;
  exScratchWinRatePct: number;
  realizedWinLossAsymmetry: number;
  grossRealizedR: number;
  netRealizedR: number;
  totalFeesR: number;
  totalFeesUsd: number;
  netProfitFactor: number;
  maxCompoundedDrawdownPct: number;
  maxDrawdownR: number;
  initialEquity: number;
  finalEquity: number;
  tradesPerWeek: number;
}

export const DEFAULT_TREND_CONTINUATION_CONFIG: TrendContinuationConfig = {
  symbol: 'ETHUSDC',
  timeframe: '15m',
  lookbackMajor: 15,
  lookbackInternal: 10,

  emaPeriod: 120,
  enforceHtfTrendLock: true,

  enforceValueAreaGate: true,
  valueAreaLookbackBars: 96,
  valueAreaMode: 'PREVIOUS_DAY_DEVELOPING',
  pocBandPct: 0.0020,

  enforceOlsValidation: true,
  enforceOiSponsorship: true,

  enforceSmtGate: true,
  smtLookbackBars: 15,

  volumeSmaPeriod: 20,
  volumeExpansionThreshold: 1.25,
  deltaDominanceThreshold: 52.0,
  bodyRatioThreshold: 0.50,
  requireThreePillarDisplacement: true,

  maxBarsToRetest: 12,
  maxOriginLookbackBars: 32,
  slBufferAtrMultiplier: 0.10,
  entryMode: 'FVG_PROXIMAL',

  stage1Ratio: 0.30,
  stage2Ratio: 0.70,
  stage1Multiple: 1.50,
  stage2Multiple: 4.00,
  dynamicTp2Source: 'OPPOSING_LIQUIDITY',
  minDynamicTp2Multiple: 3.00,
  maxDynamicTp2Multiple: 5.00,

  enableM15StructuralTrail: true,
  enableFeePaddedBreakeven: true,
  breakevenOffsetPct: 0.015,
  enableDynamicProfitFloor: true,
  postLossCooldownMinutes: 45,
  enforceSinglePositionConcurrency: true,

  enforceToxicWindowBlacklist: true,
  enforceRolloverFreeze: true,
  enforceNewsFreeze: true,

  makerFeePct: 0.0000,
  takerFeePct: 0.0400,
  initialEquity: 10000.0,
  compoundingRiskPct: 2.0,
};

// ── Toxic Window Blacklist & AMT Session Profile Helpers ───────────────────────

export interface ToxicWindowResult {
  isToxic: boolean;
  reason?: 'FUNDING_ROLLOVER_FREEZE' | 'MACRO_NEWS_FREEZE';
}

/**
 * Strict Negative Filtering (Toxic Window Blacklist):
 *  - Funding Rollover Freeze: 23:50 to 00:10 UTC (daily funding settlement & midnight rollover chop)
 *  - Macro News Freeze: ±20 minutes around major US macroeconomic data releases:
 *      * CPI / PPI: 12:20 to 12:40 UTC
 *      * FOMC Interest Rate Decision: 17:50 to 18:10 UTC
 * Permanently mutes trade initiations during these toxic intervals while authorizing 24/7 scanning
 * across all global sessions (Asia, London, New York, Weekends) with zero 14:30 UTC curfew.
 */
export function isToxicWindow(
  timestamp: number,
  options?: {
    enforceRolloverFreeze?: boolean;
    enforceNewsFreeze?: boolean;
  }
): ToxicWindowResult {
  const d = new Date(timestamp);
  const hr = d.getUTCHours();
  const min = d.getUTCMinutes();
  const timeInMinutes = hr * 60 + min;

  // 1. Daily Funding Settlement & Rollover Chop: 23:50 to 00:10 UTC
  if (options?.enforceRolloverFreeze !== false) {
    if (timeInMinutes >= 23 * 60 + 50 || timeInMinutes <= 10) {
      return { isToxic: true, reason: 'FUNDING_ROLLOVER_FREEZE' };
    }
  }

  // 2. High-Impact US Macro Data Releases: ±20 minutes around major releases
  // - CPI / PPI (12:30 UTC): 12:10 to 12:50 UTC
  // - FOMC Interest Rate Decision (18:00 UTC): 17:40 to 18:20 UTC
  if (options?.enforceNewsFreeze !== false) {
    if (
      (timeInMinutes >= 12 * 60 + 10 && timeInMinutes <= 12 * 60 + 50) ||
      (timeInMinutes >= 17 * 60 + 40 && timeInMinutes <= 18 * 60 + 20)
    ) {
      return { isToxic: true, reason: 'MACRO_NEWS_FREEZE' };
    }
  }

  return { isToxic: false };
}

/**
 * Calculates Auction Market Theory (AMT) Value Area Profile (VAH, VAL, POC)
 * from an arbitrary array of completed candles.
 */
export function calculateValueAreaProfileFromCandles(
  slice: Candle[],
  bins: number = 30
): ValueAreaProfile | null {
  if (!slice || slice.length === 0) return null;

  let minP = Infinity;
  let maxP = -Infinity;

  for (let k = 0; k < slice.length; k++) {
    const c = slice[k];
    const h = Number.isFinite(c.h) ? Number(c.h) : Number((c as any).high ?? 0);
    const l = Number.isFinite(c.l) ? Number(c.l) : Number((c as any).low ?? 0);
    if (h > maxP) maxP = h;
    if (l < minP && l > 0) minP = l;
  }

  if (minP === Infinity || maxP === -Infinity || minP >= maxP) return null;

  const step = (maxP - minP) / bins;
  if (step <= 0) return null;

  const profile = new Array(bins).fill(0);
  let totalVol = 0;

  for (let k = 0; k < slice.length; k++) {
    const c = slice[k];
    const price = Number.isFinite(c.c) ? Number(c.c) : Number((c as any).close ?? ((minP + maxP) / 2));
    const vol = Number.isFinite(c.v) ? Number(c.v) : 1;
    const binIdx = Math.min(bins - 1, Math.max(0, Math.floor((price - minP) / step)));
    profile[binIdx] += vol;
    totalVol += vol;
  }

  if (totalVol <= 0) return null;

  let maxIdx = 0;
  for (let b = 1; b < bins; b++) {
    if (profile[b] > profile[maxIdx]) {
      maxIdx = b;
    }
  }

  const poc = minP + (maxIdx + 0.5) * step;

  let vaVol = profile[maxIdx];
  let up = maxIdx;
  let down = maxIdx;
  const targetVaVol = totalVol * 0.70;

  while (vaVol < targetVaVol && (up < bins - 1 || down > 0)) {
    const nextUp = up < bins - 1 ? profile[up + 1] : 0;
    const nextDown = down > 0 ? profile[down - 1] : 0;

    if (nextUp >= nextDown && up < bins - 1) {
      up++;
      vaVol += profile[up];
    } else if (down > 0) {
      down--;
      vaVol += profile[down];
    } else if (up < bins - 1) {
      up++;
      vaVol += profile[up];
    } else {
      break;
    }
  }

  const vah = minP + (up + 1) * step;
  const val = minP + down * step;

  return {
    vah: parseFloat(vah.toFixed(4)),
    val: parseFloat(val.toFixed(4)),
    poc: parseFloat(poc.toFixed(4)),
    totalVolume: totalVol,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTakerBuyVol(c: Candle): number {
  if (typeof c.taker_buy_vol === 'number' && Number.isFinite(c.taker_buy_vol) && c.taker_buy_vol > 0) {
    return c.taker_buy_vol;
  }
  const close = c.c ?? (c as any).close;
  const low = c.l ?? (c as any).low;
  const high = c.h ?? (c as any).high;
  const vol = Number.isFinite(c.v) ? (c.v as number) : 0;
  const range = Math.max(0.0001, high - low);
  const conviction = Math.min(1.0, Math.max(0.0, (close - low) / range));
  return parseFloat((conviction * vol).toFixed(4));
}

function getTakerSellVol(c: Candle): number {
  if (typeof c.taker_sell_vol === 'number' && Number.isFinite(c.taker_sell_vol) && c.taker_sell_vol > 0) {
    return c.taker_sell_vol;
  }
  const vol = Number.isFinite(c.v) ? (c.v as number) : 0;
  const buy = getTakerBuyVol(c);
  return parseFloat(Math.max(0, vol - buy).toFixed(4));
}

/**
 * Computes Open Interest state machine regime on completed candle c.
 * Identifies active Buyer/Seller sponsorship vs passive drift/liquidation.
 */
function computeCandleOrderFlowRegime(c: Candle, avgVol: number): OrderFlowState {
  const vol = Number.isFinite(c.v) ? (c.v as number) : 0;
  const close = Number(c.c ?? (c as any).close);
  const open = Number(c.o ?? (c as any).open);
  const isPriceRising = close >= open;
  const takerBuy = getTakerBuyVol(c);
  const takerSell = getTakerSellVol(c);
  const totalTaker = takerBuy + takerSell;
  const buyRatio = totalTaker > 0 ? takerBuy / totalTaker : 0.5;

  const isHighVolume = avgVol > 0 ? vol >= avgVol * 0.95 : true;

  if (isHighVolume) {
    if (isPriceRising && buyRatio >= 0.505) {
      return 'RISING_WITH_PRICE'; // Aggressive buyer sponsorship
    } else if (!isPriceRising && buyRatio <= 0.495) {
      return 'RISING_AGAINST_PRICE'; // Aggressive seller sponsorship
    } else if (!isPriceRising && buyRatio > 0.505) {
      return 'FALLING_WITH_PRICE'; // Long liquidation / absorption
    } else if (isPriceRising && buyRatio < 0.495) {
      return 'FALLING_AGAINST_PRICE'; // Short covering / squeeze
    } else {
      return 'FLAT';
    }
  } else {
    return isPriceRising ? 'FLAT' : 'NEUTRAL';
  }
}

export interface AsianRangeTargets {
  asianHigh: number;
  asianLow: number;
  upwardDev1_5: number;
  upwardDev2_0: number;
  downwardDev1_5: number;
  downwardDev2_0: number;
}

/**
 * Calculates Asian Session (00:00 to 07:00 UTC) High/Low and Standard Deviation projections (+1.5 SD / +2.0 SD)
 * strictly using historical candles occurring prior to targetIdx (Zero-Lookahead).
 */
function calculateAsianRangeTargets(
  candles: Candle[],
  targetIdx: number
): AsianRangeTargets | null {
  if (targetIdx < 0 || targetIdx >= candles.length) return null;

  const targetTime = candles[targetIdx].t;
  const targetDate = new Date(targetTime);
  const targetYear = targetDate.getUTCFullYear();
  const targetMonth = targetDate.getUTCMonth();
  const targetDay = targetDate.getUTCDate();

  const todayAsianStart = Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0);
  const todayAsianEnd = Date.UTC(targetYear, targetMonth, targetDay, 7, 0, 0, 0);

  let asianStartMs = todayAsianStart;
  let asianEndMs = todayAsianEnd;

  // If target candle is during or before today's 07:00 UTC, look back to yesterday's Asian session
  if (targetTime < todayAsianEnd) {
    const yesterdayDate = new Date(todayAsianStart - 24 * 60 * 60 * 1000);
    asianStartMs = Date.UTC(yesterdayDate.getUTCFullYear(), yesterdayDate.getUTCMonth(), yesterdayDate.getUTCDate(), 0, 0, 0, 0);
    asianEndMs = Date.UTC(yesterdayDate.getUTCFullYear(), yesterdayDate.getUTCMonth(), yesterdayDate.getUTCDate(), 7, 0, 0, 0);
  }

  let asianHigh = -Infinity;
  let asianLow = Infinity;
  let found = false;

  for (let k = targetIdx; k >= 0; k--) {
    const ct = candles[k].t;
    if (ct >= asianEndMs) continue;
    if (ct < asianStartMs) break;

    const ch = Number(candles[k].h ?? (candles[k] as any).high);
    const cl = Number(candles[k].l ?? (candles[k] as any).low);
    if (ch > asianHigh) asianHigh = ch;
    if (cl < asianLow && cl > 0) asianLow = cl;
    found = true;
  }

  if (!found || asianHigh === -Infinity || asianLow === Infinity || asianHigh <= asianLow) {
    return null;
  }

  const range = asianHigh - asianLow;
  return {
    asianHigh: parseFloat(asianHigh.toFixed(4)),
    asianLow: parseFloat(asianLow.toFixed(4)),
    upwardDev1_5: parseFloat((asianHigh + range * 1.5).toFixed(4)),
    upwardDev2_0: parseFloat((asianHigh + range * 2.0).toFixed(4)),
    downwardDev1_5: parseFloat((asianLow - range * 1.5).toFixed(4)),
    downwardDev2_0: parseFloat((asianLow - range * 2.0).toFixed(4)),
  };
}

// ── Core TrendContinuationEngine Class ─────────────────────────────────────────

export class TrendContinuationEngine {
  private config: TrendContinuationConfig;

  constructor(config?: Partial<TrendContinuationConfig>) {
    this.config = { ...DEFAULT_TREND_CONTINUATION_CONFIG, ...config };
  }

  public getConfig(): TrendContinuationConfig {
    return { ...this.config };
  }

  // ── Intermarket SMT Divergence Engine ──────────────────────────────────────
  private btcCandlesList: Candle[] | null = null;
  private btcCandlesMap: Map<number, { candle: Candle; index: number }> | null = null;

  private getBtcCandles(): Candle[] | null {
    if (this.config.btcCandles && this.config.btcCandles.length > 0) {
      return this.config.btcCandles;
    }
    if (this.btcCandlesList && this.btcCandlesList.length > 0) {
      return this.btcCandlesList;
    }
    if (typeof window === 'undefined') {
      try {
        const fs = require('fs');
        const path = require('path');
        const candidatePaths = [
          path.join(process.cwd(), 'data', 'historical', 'BTCUSDT_15m_1y.json'),
          path.join(process.cwd(), 'scratch', 'cached_BTCUSDT_5m_1y_1756512000000_1788480000000.json'),
        ];
        for (const p of candidatePaths) {
          if (fs.existsSync(p)) {
            const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (Array.isArray(raw) && raw.length > 0) {
              this.btcCandlesList = raw;
              return this.btcCandlesList;
            }
          }
        }
      } catch {
        // Fallback gracefully
      }
    }
    return null;
  }

  private getBtcMap(): Map<number, { candle: Candle; index: number }> | null {
    if (this.btcCandlesMap) return this.btcCandlesMap;
    const btcCandles = this.getBtcCandles();
    if (!btcCandles || btcCandles.length === 0) return null;
    const map = new Map<number, { candle: Candle; index: number }>();
    for (let i = 0; i < btcCandles.length; i++) {
      map.set(btcCandles[i].t, { candle: btcCandles[i], index: i });
    }
    this.btcCandlesMap = map;
    return map;
  }

  private evaluateSmtDivergence(
    isBullish: boolean,
    bosTime: number,
    brokenPivotTime: number
  ): {
    isAligned: boolean;
    isAuthorized: boolean;
    status: 'BULLISH_SMT' | 'BEARISH_SMT' | 'SYMMETRIC' | 'OPPOSING_TAKER_VOLUME' | 'OPPOSING_CASCADE' | 'UNKNOWN';
    reason?: string;
  } {
    const btcCandles = this.getBtcCandles();
    const btcMap = this.getBtcMap();
    if (!btcCandles || !btcMap || btcCandles.length === 0) {
      return { isAligned: true, isAuthorized: true, status: 'UNKNOWN' };
    }

    const findBtcEntry = (targetTime: number): { candle: Candle; index: number } | null => {
      const exact = btcMap.get(targetTime);
      if (exact) return exact;

      let low = 0;
      let high = btcCandles.length - 1;
      let closest: { candle: Candle; index: number } | null = null;
      let minDiff = 900000;

      while (low <= high) {
        const mid = (low + high) >> 1;
        const diff = btcCandles[mid].t - targetTime;
        const absDiff = Math.abs(diff);
        if (absDiff < minDiff) {
          minDiff = absDiff;
          closest = { candle: btcCandles[mid], index: mid };
        }
        if (diff < 0) low = mid + 1;
        else if (diff > 0) high = mid - 1;
        else break;
      }
      return closest;
    };

    const bosBtc = findBtcEntry(bosTime);
    if (!bosBtc) return { isAligned: true, isAuthorized: true, status: 'UNKNOWN' };

    const pivotBtc = findBtcEntry(brokenPivotTime);
    const lookback = this.config.smtLookbackBars ?? 15;
    const btcIdx = bosBtc.index;
    const startIdx = Math.max(0, btcIdx - lookback);

    const btcCurClose = Number(bosBtc.candle.c ?? (bosBtc.candle as any).close);
    const btcCurOpen = Number(bosBtc.candle.o ?? (bosBtc.candle as any).open);

    const btcBuyVol = getTakerBuyVol(bosBtc.candle);
    const btcSellVol = getTakerSellVol(bosBtc.candle);
    const btcTotalVol = btcBuyVol + btcSellVol;
    const btcBuyRatio = btcTotalVol > 0 ? (btcBuyVol / btcTotalVol) * 100 : 50;
    const btcSellRatio = btcTotalVol > 0 ? (btcSellVol / btcTotalVol) * 100 : 50;

    if (isBullish) {
      // 1. Check opposing directional taker volume
      if (btcCurClose < btcCurOpen && btcSellRatio >= 52.0) {
        return {
          isAligned: false,
          isAuthorized: false,
          status: 'OPPOSING_TAKER_VOLUME',
          reason: 'BTC displays opposing directional taker sell volume',
        };
      }

      // 2. Check aggressive dump cascade
      let btcMaxH = -Infinity;
      for (let k = startIdx; k <= btcIdx; k++) {
        const hk = Number(btcCandles[k].h ?? (btcCandles[k] as any).high);
        if (hk > btcMaxH) btcMaxH = hk;
      }
      const btcDumpPct = btcMaxH > 0 ? (btcMaxH - btcCurClose) / btcMaxH : 0;
      const btcIsAggressiveSell = btcCurClose < btcCurOpen && btcDumpPct > 0.02;

      if (btcIsAggressiveSell) {
        return {
          isAligned: false,
          isAuthorized: false,
          status: 'OPPOSING_CASCADE',
          reason: 'BTC aggressive dump cascade',
        };
      }

      // 3. SMT Divergence check against broken swing high
      if (pivotBtc) {
        const btcPivotHigh = Number(pivotBtc.candle.h ?? (pivotBtc.candle as any).high);
        if (btcCurClose < btcPivotHigh) {
          return { isAligned: true, isAuthorized: true, status: 'BULLISH_SMT' };
        } else {
          return { isAligned: true, isAuthorized: true, status: 'SYMMETRIC' };
        }
      }
      return { isAligned: true, isAuthorized: true, status: 'BULLISH_SMT' };
    } else {
      // 1. Check opposing directional taker volume
      if (btcCurClose > btcCurOpen && btcBuyRatio >= 52.0) {
        return {
          isAligned: false,
          isAuthorized: false,
          status: 'OPPOSING_TAKER_VOLUME',
          reason: 'BTC displays opposing directional taker buy volume',
        };
      }

      // 2. Check aggressive pump cascade
      let btcMinL = Infinity;
      for (let k = startIdx; k <= btcIdx; k++) {
        const lk = Number(btcCandles[k].l ?? (btcCandles[k] as any).low);
        if (lk < btcMinL) btcMinL = lk;
      }
      const btcPumpPct = btcMinL > 0 ? (btcCurClose - btcMinL) / btcMinL : 0;
      const btcIsAggressiveBuy = btcCurClose > btcCurOpen && btcPumpPct > 0.02;

      if (btcIsAggressiveBuy) {
        return {
          isAligned: false,
          isAuthorized: false,
          status: 'OPPOSING_CASCADE',
          reason: 'BTC aggressive pump cascade',
        };
      }

      // 3. SMT Divergence check against broken swing low
      if (pivotBtc) {
        const btcPivotLow = Number(pivotBtc.candle.l ?? (pivotBtc.candle as any).low);
        if (btcCurClose > btcPivotLow) {
          return { isAligned: true, isAuthorized: true, status: 'BEARISH_SMT' };
        } else {
          return { isAligned: true, isAuthorized: true, status: 'SYMMETRIC' };
        }
      }
      return { isAligned: true, isAuthorized: true, status: 'BEARISH_SMT' };
    }
  }

  /**
   * Scans a historical sequence of 15m candlestick data.
   * Identifies HTF trend locked BOS expansions, validates 3-pillar displacement,
   * places resting limit orders at FVG proximal edges, and executes the 30/70 harvest model.
   */
  public scanHistoricalSetups(
    inputCandles: Candle[],
    bootstrap?: StructuralBootstrapContext
  ): {
    setups: TrendContinuationSetup[];
    telemetry: TrendContinuationTelemetrySummary;
  } {
    if (!inputCandles || inputCandles.length < 25) {
      return {
        setups: [],
        telemetry: this.createEmptyTelemetry(inputCandles ? inputCandles.length : 0),
      };
    }

    // Zero-Lookahead Mandate: ensure all calculations evaluate strictly upon verified closed bars
    const candles = inputCandles.filter((c) => c.isClosed !== false);
    if (candles.length < 25) {
      return {
        setups: [],
        telemetry: this.createEmptyTelemetry(candles.length),
      };
    }

    const n = candles.length;
    const lookbackMajor = this.config.lookbackMajor ?? 15;
    const lookbackInternal = this.config.lookbackInternal ?? 10;
    const emaPeriod = this.config.emaPeriod ?? 120;
    const volSmaPeriod = this.config.volumeSmaPeriod ?? 20;

    // ── 1. Precompute Technical Indicators ──

    // 1A. 14-period ATR
    const atrSeries = new Float64Array(n);
    let trSum = 0;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const h = c.h ?? (c as any).high;
      const l = c.l ?? (c as any).low;
      if (i === 0) {
        atrSeries[i] = Math.max(0.0001, h - l);
        trSum = atrSeries[i];
      } else {
        const prevC = candles[i - 1].c ?? (candles[i - 1] as any).close;
        const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
        if (i < 14) {
          trSum += tr;
          atrSeries[i] = trSum / (i + 1);
        } else {
          atrSeries[i] = (atrSeries[i - 1] * 13 + tr) / 14;
        }
      }
    }

    // 1B. 20-period Volume SMA
    const volSmaSeries = new Float64Array(n);
    let vSum = 0;
    for (let i = 0; i < n; i++) {
      const v = Number.isFinite(candles[i].v) ? (candles[i].v as number) : 0;
      vSum += v;
      if (i >= volSmaPeriod) {
        const oldV = Number.isFinite(candles[i - volSmaPeriod].v) ? (candles[i - volSmaPeriod].v as number) : 0;
        vSum -= oldV;
        volSmaSeries[i] = vSum / volSmaPeriod;
      } else {
        volSmaSeries[i] = vSum / (i + 1);
      }
    }

    // 1C. 120-period Exponential Moving Average (EMA) for HTF Trend Lock
    const emaSeries = new Float64Array(n);
    const emaK = 2 / (emaPeriod + 1);
    const initialClose = candles[0].c ?? (candles[0] as any).close;
    emaSeries[0] = initialClose;
    for (let i = 1; i < n; i++) {
      const close = candles[i].c ?? (candles[i] as any).close;
      emaSeries[i] = close * emaK + emaSeries[i - 1] * (1 - emaK);
    }

    // 1D. Level-2 Major Fractal Pivots
    const pivotEngine = new PivotEngine({
      lookbackMajor,
      lookbackInternal,
      lookbackMicro: 3,
    });
    if (bootstrap?.confirmedPivots && bootstrap.confirmedPivots.length > 0) {
      pivotEngine.seedConfirmedPivots(bootstrap.confirmedPivots);
    }
    pivotEngine.processCandles(candles);
    const allPivots = pivotEngine.pivots;

    // ── 2. State Tracking for Chronological Execution ──
    const detectedSetups: TrendContinuationSetup[] = [];
    const consumedBreakoutPivots = new Set<string>();

    // 2b. Index candles by UTC Calendar Day for Macro Value Area Anchor Alignment
    const candlesByDay = new Map<string, Candle[]>();
    for (let idx = 0; idx < n; idx++) {
      const c = candles[idx];
      const dayKey = new Date(c.t).toISOString().slice(0, 10);
      let dayList = candlesByDay.get(dayKey);
      if (!dayList) {
        dayList = [];
        candlesByDay.set(dayKey, dayList);
      }
      dayList.push(c);
    }
    const daysList = Array.from(candlesByDay.keys()).sort();
    const dayIndexMap = new Map<string, number>();
    daysList.forEach((d, idx) => dayIndexMap.set(d, idx));

    // Cache computed Previous Day Value Area profiles
    const prevDayProfileCache = new Map<string, ValueAreaProfile | null>();

    // Expansion mode state tracking across days
    let confirmedExpansionDay: string | null = null;
    let confirmedExpansionDirection: TrendContinuationType | null = null;

    let dbgBos = 0;
    let dbgVaVeto = 0;
    let dbgOlsVeto = 0;
    let dbgOiVeto = 0;
    let dbgSmtVeto = 0;
    let dbgDispVeto = 0;
    let dbgToxicVeto = 0;
    let dbgPassedP3 = 0;

    // Start evaluation after warmup (need at least emaPeriod bars)
    const startIdx = Math.max(emaPeriod, lookbackMajor * 2 + 1);

    for (let i = startIdx; i < n - 1; i++) {
      const currentCandle = candles[i];
      const prevCandle = candles[i - 1];

      const curClose = currentCandle.c ?? (currentCandle as any).close;
      const curOpen = currentCandle.o ?? (currentCandle as any).open;
      const curHigh = currentCandle.h ?? (currentCandle as any).high;
      const curLow = currentCandle.l ?? (currentCandle as any).low;
      const curVol = Number.isFinite(currentCandle.v) ? (currentCandle.v as number) : 0;
      const curAvgVol = volSmaSeries[i] || 1;

      const prevClose = prevCandle.c ?? (prevCandle as any).close;
      const currentEma = emaSeries[i];

      // Continuous Macro Value Area Invalidation on EVERY candle close:
      // If price was in bullish expansion and closes below Previous Day VAL, or bearish expansion and closes above Previous Day VAH,
      // immediately terminate the expansion state so stale regimes cannot persist across multi-day consolidations.
      if (confirmedExpansionDirection) {
        const curDayKey = new Date(currentCandle.t).toISOString().slice(0, 10);
        const curDayIdx = dayIndexMap.get(curDayKey) ?? -1;
        let pdProfile: ValueAreaProfile | null = null;
        if (prevDayProfileCache.has(curDayKey)) {
          pdProfile = prevDayProfileCache.get(curDayKey) ?? null;
        } else if (curDayIdx > 0) {
          const prevDayKey = daysList[curDayIdx - 1];
          const prevCandles = candlesByDay.get(prevDayKey) || [];
          if (prevCandles.length >= 10) {
            pdProfile = calculateValueAreaProfileFromCandles(prevCandles);
          }
          prevDayProfileCache.set(curDayKey, pdProfile);
        }

        if (confirmedExpansionDirection === 'BULLISH') {
          if (pdProfile && curClose < pdProfile.val) {
            confirmedExpansionDirection = null;
            confirmedExpansionDay = null;
          }
        } else if (confirmedExpansionDirection === 'BEARISH') {
          if (pdProfile && curClose > pdProfile.vah) {
            confirmedExpansionDirection = null;
            confirmedExpansionDay = null;
          }
        }
      }

      // ── Phase 1: Higher Timeframe (HTF) Trend Lock ──
      // Evaluates 120 EMA alignment & rolling Level-2 major swing sequence
      const confirmedPivotsBeforeI = allPivots.filter(
        (p) => p.confirmed && p.index <= i - lookbackMajor && p.colorValidated !== false
      );
      const majorHighs = confirmedPivotsBeforeI.filter(
        (p) => p.type === 'SWING_HIGH' && p.level === 2
      );
      const majorLows = confirmedPivotsBeforeI.filter(
        (p) => p.type === 'SWING_LOW' && p.level === 2
      );

      let htfStructuralTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
      if (majorHighs.length >= 2 && majorLows.length >= 2) {
        const lastH = majorHighs[majorHighs.length - 1];
        const prevH = majorHighs[majorHighs.length - 2];
        const lastL = majorLows[majorLows.length - 1];
        const prevL = majorLows[majorLows.length - 2];

        if (lastH.price > prevH.price && lastL.price >= prevL.price) {
          htfStructuralTrend = 'BULLISH';
        } else if (lastL.price < prevL.price && lastH.price <= prevH.price) {
          htfStructuralTrend = 'BEARISH';
        }
      }

      // Strict Directional Lock Synthesis:
      // Bullish if price > EMA120 and structure is not bearish
      // Bearish if price < EMA120 and structure is not bullish
      let htfTrend: 'BULLISH' | 'BEARISH' | null = null;
      if (curClose >= currentEma && htfStructuralTrend !== 'BEARISH') {
        htfTrend = 'BULLISH';
      } else if (curClose < currentEma && htfStructuralTrend !== 'BULLISH') {
        htfTrend = 'BEARISH';
      }

      if (!htfTrend && this.config.enforceHtfTrendLock) {
        continue; // Market in transitional chop or conflict — zero initiation
      }

      const activeHtfTrend = htfTrend ?? (curClose >= currentEma ? 'BULLISH' : 'BEARISH');

      // ── Phase 2: Confirmed Break of Structure (BOS) ──
      // Long-Only when Bullish; Short-Only when Bearish.
      let isBullishBos = false;
      let isBearishBos = false;
      let brokenPivot: Pivot | null = null;
      let brokenPivotKey: string | null = null;

      if (activeHtfTrend === 'BULLISH') {
        // Iterate backwards from most recent confirmed major swing highs
        for (let m = majorHighs.length - 1; m >= 0; m--) {
          const targetPivot = majorHighs[m];
          const pivotKey = `MAJOR_HIGH_${targetPivot.index}_${targetPivot.price}`;
          if (consumedBreakoutPivots.has(pivotKey)) continue;

          // Check if candle i prints a physical candlestick body close beyond target pivot
          // and candle i - 1 was <= target pivot (clean breakout transition)
          if (
            curClose > targetPivot.price &&
            curClose > curOpen && // Strong green body
            prevClose <= targetPivot.price &&
            i > targetPivot.index
          ) {
            isBullishBos = true;
            brokenPivot = targetPivot;
            brokenPivotKey = pivotKey;
            break;
          }
        }
      } else if (activeHtfTrend === 'BEARISH') {
        // Iterate backwards from most recent confirmed major swing lows
        for (let m = majorLows.length - 1; m >= 0; m--) {
          const targetPivot = majorLows[m];
          const pivotKey = `MAJOR_LOW_${targetPivot.index}_${targetPivot.price}`;
          if (consumedBreakoutPivots.has(pivotKey)) continue;

          // Check if candle i prints a physical candlestick body close beyond target pivot
          // and candle i - 1 was >= target pivot
          if (
            curClose < targetPivot.price &&
            curClose < curOpen && // Strong red body
            prevClose >= targetPivot.price &&
            i > targetPivot.index
          ) {
            isBearishBos = true;
            brokenPivot = targetPivot;
            brokenPivotKey = pivotKey;
            break;
          }
        }
      }

      if (!isBullishBos && !isBearishBos) {
        continue;
      }
      dbgBos++;

      // Strict Negative Filtering: Mute trade initiations during funding rollover chop (23:50-00:10 UTC)
      // and ±20 minutes around major US macroeconomic releases (CPI/PPI/FOMC)
      if (this.config.enforceToxicWindowBlacklist !== false) {
        const toxic = isToxicWindow(currentCandle.t, {
          enforceRolloverFreeze: this.config.enforceRolloverFreeze,
          enforceNewsFreeze: this.config.enforceNewsFreeze,
        });
        if (toxic.isToxic) {
          dbgToxicVeto++;
          continue;
        }
      }

      const setupDirection: TrendContinuationType = isBullishBos ? 'BULLISH' : 'BEARISH';
      const brokenPivotLevel = brokenPivot!.price;
      const brokenPivotIndex = brokenPivot!.index;
      const brokenPivotTime = brokenPivot!.timestamp;

      // ── AMT Value Area & Anti-Chop Gate (Macro Anchor Alignment) ──
      const vaMode = this.config.valueAreaMode ?? 'PREVIOUS_DAY_DEVELOPING';
      let vaProfile: ValueAreaProfile | null = null;
      let vaState: 'EXPANSION_ABOVE_VAH' | 'EXPANSION_BELOW_VAL' | 'VALUE_ACCEPTANCE_HVN' | 'POC_CONSENSUS' | 'UNKNOWN' = 'UNKNOWN';
      let isVaApproved = true;

      const curDayKey = new Date(currentCandle.t).toISOString().slice(0, 10);
      const curDayIdx = dayIndexMap.get(curDayKey) ?? 0;

      if (vaMode === 'ROLLING_HISTOGRAM') {
        const vaLookback = this.config.valueAreaLookbackBars ?? 96;
        if (i >= 20) {
          try {
            vaProfile = calculateValueAreaProfile(candles, i, vaLookback);
          } catch {
            vaProfile = null;
          }
        }

        if (vaProfile) {
          const poc = vaProfile.poc;
          const pocBandPct = this.config.pocBandPct ?? 0.0020;
          const isWithinPocBand = poc > 0 && Math.abs(curClose - poc) / poc <= pocBandPct;
          const isWithinValueArea = curClose >= vaProfile.val && curClose <= vaProfile.vah;

          if (isWithinPocBand) {
            vaState = 'POC_CONSENSUS';
            isVaApproved = false;
          } else if (isWithinValueArea) {
            vaState = 'VALUE_ACCEPTANCE_HVN';
            isVaApproved = false;
          } else if (isBullishBos && curClose > vaProfile.vah) {
            vaState = 'EXPANSION_ABOVE_VAH';
            isVaApproved = true;
          } else if (!isBullishBos && curClose < vaProfile.val) {
            vaState = 'EXPANSION_BELOW_VAL';
            isVaApproved = true;
          } else {
            vaState = 'UNKNOWN';
            isVaApproved = false;
          }

          if (this.config.enforceValueAreaGate && !isVaApproved) {
            continue; // Anti-Chop Gate: Veto if in HVN, within POC consensus band, or not expanding outside Value Area
          }
        }
      } else {
        // Macro Anchor Alignment: Previous Day / Developing Daily Session Profile
        // 1. Resolve Previous Day Profile (Fixed Macro Anchor)
        let pdProfile: ValueAreaProfile | null = null;
        if (prevDayProfileCache.has(curDayKey)) {
          pdProfile = prevDayProfileCache.get(curDayKey) ?? null;
        } else if (curDayIdx > 0) {
          const prevDayKey = daysList[curDayIdx - 1];
          const prevCandles = candlesByDay.get(prevDayKey) || [];
          if (prevCandles.length >= 10) {
            pdProfile = calculateValueAreaProfileFromCandles(prevCandles);
          }
          prevDayProfileCache.set(curDayKey, pdProfile);
        }

        // 2. Resolve Developing Daily Profile (from today's 00:00 UTC up to candle i)
        const dayCandles = candlesByDay.get(curDayKey) || [];
        const todayCandles = dayCandles.filter((c) => c.t <= currentCandle.t);
        let devProfile: ValueAreaProfile | null = null;
        if (todayCandles.length >= 8) {
          devProfile = calculateValueAreaProfileFromCandles(todayCandles);
        }

        // Primary profile for telemetry & HUD reporting
        vaProfile = pdProfile || devProfile;

        // Fallback to rolling if neither profile has sufficient history (e.g. Day 0)
        if (!vaProfile && i >= 20) {
          try {
            vaProfile = calculateValueAreaProfile(candles, i, this.config.valueAreaLookbackBars ?? 96);
          } catch {
            vaProfile = null;
          }
        }

        const pocBandPct = this.config.pocBandPct ?? 0.0020;

        if (isBullishBos) {
          // Bullish Expansion Criteria:
          // A: Confirmed body close above Previous Day VAH
          const isAbovePdVah = pdProfile ? curClose > pdProfile.vah : false;
          // B: Confirmed body close above Developing Daily VAH
          const isAboveDevVah = devProfile ? curClose > devProfile.vah : false;
          // C: Fallback rolling above VAH
          const isRollingAboveVah = (!pdProfile && !devProfile && vaProfile) ? curClose > vaProfile.vah : false;
          // D: Invalidation State Retention: Once a valid BOS confirms above Previous Day VAH,
          // remain in EXPANSION mode across days rather than re-absorbing into an HVN,
          // until price invalidates by closing below Previous Day VAL
          const hasPriorExpansion = confirmedExpansionDirection === 'BULLISH' &&
            (pdProfile ? curClose >= pdProfile.val : true);

          if (isAbovePdVah || isAboveDevVah || isRollingAboveVah || hasPriorExpansion) {
            vaState = 'EXPANSION_ABOVE_VAH';
            isVaApproved = true;
            confirmedExpansionDay = curDayKey;
            confirmedExpansionDirection = 'BULLISH';
          } else {
            // Price invalidated bullish expansion
            if (pdProfile && curClose < pdProfile.val) {
              confirmedExpansionDirection = null;
              confirmedExpansionDay = null;
            }
            // Price is inside Value Area - check POC consensus vs HVN acceptance
            const refPoc = pdProfile?.poc ?? devProfile?.poc ?? vaProfile?.poc;
            const isWithinPoc = refPoc ? Math.abs(curClose - refPoc) / refPoc <= pocBandPct : false;
            if (isWithinPoc) {
              vaState = 'POC_CONSENSUS';
              isVaApproved = false;
            } else {
              vaState = 'VALUE_ACCEPTANCE_HVN';
              isVaApproved = false;
            }
          }
        } else {
          // Bearish Expansion Criteria:
          // A: Confirmed body close below Previous Day VAL
          const isBelowPdVal = pdProfile ? curClose < pdProfile.val : false;
          // B: Confirmed body close below Developing Daily VAL
          const isBelowDevVal = devProfile ? curClose < devProfile.val : false;
          // C: Fallback rolling below VAL
          const isRollingBelowVal = (!pdProfile && !devProfile && vaProfile) ? curClose < vaProfile.val : false;
          // D: Invalidation State Retention: Once a valid BOS confirms below Previous Day VAL,
          // remain in EXPANSION mode across days rather than re-absorbing into an HVN,
          // until price invalidates by closing above Previous Day VAH
          const hasPriorExpansion = confirmedExpansionDirection === 'BEARISH' &&
            (pdProfile ? curClose <= pdProfile.vah : true);

          if (isBelowPdVal || isBelowDevVal || isRollingBelowVal || hasPriorExpansion) {
            vaState = 'EXPANSION_BELOW_VAL';
            isVaApproved = true;
            confirmedExpansionDay = curDayKey;
            confirmedExpansionDirection = 'BEARISH';
          } else {
            // Price invalidated bearish expansion
            if (pdProfile && curClose > pdProfile.vah) {
              confirmedExpansionDirection = null;
              confirmedExpansionDay = null;
            }
            const refPoc = pdProfile?.poc ?? devProfile?.poc ?? vaProfile?.poc;
            const isWithinPoc = refPoc ? Math.abs(curClose - refPoc) / refPoc <= pocBandPct : false;
            if (isWithinPoc) {
              vaState = 'POC_CONSENSUS';
              isVaApproved = false;
            } else {
              vaState = 'VALUE_ACCEPTANCE_HVN';
              isVaApproved = false;
            }
          }
        }

        if (this.config.enforceValueAreaGate && !isVaApproved) {
          dbgVaVeto++;
          continue; // Anti-Chop Gate: Veto if in HVN, within POC consensus band, or not expanding outside Value Area
        }
      }

      // ── OLS Statistical Validation ──
      let olsTStat = 0;
      let olsPVal = 1;
      let olsTier = 'REJECTED';
      let olsPassed = false;

      if (i >= 27) {
        try {
          const regressionSlice = candles.slice(Math.max(0, i - 40), i + 1);
          if (regressionSlice.length >= 27) {
            const olsRes = runRegression(regressionSlice);
            olsTStat = olsRes.t_statistic;
            olsPVal = olsRes.p_value;
            olsTier = olsRes.confidence_tier_label;
            // 95% Confidence: p-value < 0.05 and |t-stat| >= 1.96
            olsPassed = olsRes.confidence_interval_95_strict || (olsRes.p_value < 0.05 && Math.abs(olsRes.t_statistic) >= 1.96);
          }
        } catch {
          olsPassed = false;
        }
      }

      if (this.config.enforceOlsValidation && !olsPassed) {
        dbgOlsVeto++;
        continue; // Veto if OLS regression confidence is not strictly confirmed (95%)
      }

      // ── Open Interest / Order Flow Regime Sponsorship ──
      const curOrderFlowRegime = computeCandleOrderFlowRegime(currentCandle, curAvgVol);
      let isOiSponsored = false;

      if (isBullishBos) {
        // Buyer Sponsorship: RISING_WITH_PRICE or FALLING_AGAINST_PRICE
        // Veto: FLAT, NEUTRAL, FALLING_WITH_PRICE
        isOiSponsored = curOrderFlowRegime === 'RISING_WITH_PRICE' || curOrderFlowRegime === 'FALLING_AGAINST_PRICE';
      } else {
        // Seller Sponsorship: RISING_AGAINST_PRICE or FALLING_WITH_PRICE
        // Veto: FLAT, NEUTRAL, RISING_WITH_PRICE
        isOiSponsored = curOrderFlowRegime === 'RISING_AGAINST_PRICE' || curOrderFlowRegime === 'FALLING_WITH_PRICE';
      }

      if (this.config.enforceOiSponsorship && !isOiSponsored) {
        dbgOiVeto++;
        continue; // Veto passive drift, neutral chop, or adverse liquidation
      }

      // ── Intermarket SMT Tracking & Gatekeeper ──
      const smtResult = this.evaluateSmtDivergence(isBullishBos, currentCandle.t, brokenPivotTime);
      const isSmtAligned = smtResult.isAligned;
      const isSmtAuthorized = smtResult.isAuthorized;
      const smtStatus = smtResult.status;

      if (this.config.enforceSmtGate && !isSmtAuthorized) {
        dbgSmtVeto++;
        continue; // Veto if SMT gate enforced and opposing taker volume or cascade detected
      }

      // ── 3-Pillar Volumetric Displacement Verification ──
      // Evaluate breakout candle and the immediate impulse leg [max(brokenPivotIndex, i - 4) .. i]
      const impulseStart = Math.max(brokenPivotIndex, i - 4);
      let maxVolExpInLeg = 0;
      let legVolSum = 0;
      let legTakerDirVolSum = 0;
      let maxBodyRatioInLeg = 0;

      for (let k = impulseStart; k <= i; k++) {
        const ck = candles[k];
        const ckClose = ck.c ?? (ck as any).close;
        const ckOpen = ck.o ?? (ck as any).open;
        const ckHigh = ck.h ?? (ck as any).high;
        const ckLow = ck.l ?? (ck as any).low;
        const ckVol = Number.isFinite(ck.v) ? (ck.v as number) : 0;
        const ckAvgVol = volSmaSeries[k] || 1;

        const ckVolExp = ckAvgVol > 0 ? ckVol / ckAvgVol : 1.0;
        if (ckVolExp > maxVolExpInLeg) maxVolExpInLeg = ckVolExp;

        const ckRange = Math.max(0.0001, ckHigh - ckLow);
        const ckBody = Math.abs(ckClose - ckOpen);
        const ckBodyRatio = ckBody / ckRange;
        if (ckBodyRatio > maxBodyRatioInLeg) maxBodyRatioInLeg = ckBodyRatio;

        legVolSum += ckVol;
        const dirVol = setupDirection === 'BULLISH' ? getTakerBuyVol(ck) : getTakerSellVol(ck);
        legTakerDirVolSum += dirVol;
      }

      const curVolExp = curAvgVol > 0 ? curVol / curAvgVol : 1.0;
      const curTakerDirVol = setupDirection === 'BULLISH' ? getTakerBuyVol(currentCandle) : getTakerSellVol(currentCandle);
      const curDeltaPct = curVol > 0 ? (curTakerDirVol / curVol) * 100 : 50.0;
      const legDeltaPct = legVolSum > 0 ? (legTakerDirVolSum / legVolSum) * 100 : 50.0;
      const effectiveDeltaPct = Math.max(curDeltaPct, legDeltaPct);

      const curRange = Math.max(0.0001, curHigh - curLow);
      const curBody = Math.abs(curClose - curOpen);
      const curBodyRatio = curBody / curRange;
      const effectiveBodyRatio = Math.max(curBodyRatio, maxBodyRatioInLeg);

      const effectiveVolExp = Math.max(curVolExp, maxVolExpInLeg);

      const volThreshold = this.config.volumeExpansionThreshold ?? 1.25;
      const deltaThreshold = this.config.deltaDominanceThreshold ?? 52.0;
      const bodyThreshold = this.config.bodyRatioThreshold ?? 0.50;

      const p1Passed = effectiveVolExp >= volThreshold;
      const p2Passed = effectiveDeltaPct >= deltaThreshold;
      const p3Passed = effectiveBodyRatio >= bodyThreshold;
      const allThreePillarsPassed = p1Passed && p2Passed && p3Passed;

      if (this.config.requireThreePillarDisplacement && !allThreePillarsPassed) {
        dbgDispVeto++;
        continue; // Veto low-displacement breakout
      }
      dbgPassedP3++;

      // ── Phase 3: Mitigation Retest Entry Setup & FVG Geometry ──

      // 3A. Locate Origin Swing of the Breakout Leg (clamped to recent breakout impulse launch window)
      const maxOriginBars = this.config.maxOriginLookbackBars ?? 32;
      const launchStart = Math.max(0, Math.max(brokenPivotIndex, i - maxOriginBars));
      let originSwingPrice: number;
      let originSwingIndex: number;
      let originSwingTime: number;

      if (setupDirection === 'BULLISH') {
        // Origin swing is the lowest low in the launch window
        let minL = Infinity;
        let minIdx = i;
        for (let k = launchStart; k <= i; k++) {
          const lk = candles[k].l ?? (candles[k] as any).low;
          if (lk < minL) {
            minL = lk;
            minIdx = k;
          }
        }
        originSwingPrice = minL;
        originSwingIndex = minIdx;
        originSwingTime = candles[minIdx].t;
      } else {
        // Origin swing is the highest high in the launch window
        let maxH = -Infinity;
        let maxIdx = i;
        for (let k = launchStart; k <= i; k++) {
          const hk = candles[k].h ?? (candles[k] as any).high;
          if (hk > maxH) {
            maxH = hk;
            maxIdx = k;
          }
        }
        originSwingPrice = maxH;
        originSwingIndex = maxIdx;
        originSwingTime = candles[maxIdx].t;
      }

      // 3B. Detect Fair Value Gap (BISI for Longs, SIBI for Shorts) formed on the breakout leg
      // Search backwards from breakout candle i down to the breakout leg origin
      let foundFvg = false;
      let fvgTop = 0;
      let fvgBottom = 0;
      let fvgCe = 0;

      const fvgMinBar = Math.max(2, originSwingIndex + 2);
      for (let f = i; f >= fvgMinBar; f--) {
        const c0 = candles[f - 2];
        const c2 = candles[f];
        const c0H = c0.h ?? (c0 as any).high;
        const c0L = c0.l ?? (c0 as any).low;
        const c2H = c2.h ?? (c2 as any).high;
        const c2L = c2.l ?? (c2 as any).low;

        if (setupDirection === 'BULLISH') {
          // BISI: c0 High < c2 Low
          if (c2L > c0H) {
            foundFvg = true;
            fvgTop = c2L;
            fvgBottom = c0H;
            fvgCe = (fvgTop + fvgBottom) / 2;
            break;
          }
        } else {
          // SIBI: c0 Low > c2 High
          if (c2H < c0L) {
            foundFvg = true;
            fvgTop = c0L;
            fvgBottom = c2H;
            fvgCe = (fvgTop + fvgBottom) / 2;
            break;
          }
        }
      }

      // Fallback search across origin window if no gap directly at the breakout edge
      if (!foundFvg) {
        for (let f = i; f >= Math.max(2, originSwingIndex); f--) {
          const c0 = candles[f - 2];
          const c2 = candles[f];
          const c0H = c0.h ?? (c0 as any).high;
          const c0L = c0.l ?? (c0 as any).low;
          const c2H = c2.h ?? (c2 as any).high;
          const c2L = c2.l ?? (c2 as any).low;

          if (setupDirection === 'BULLISH') {
            if (c2L > c0H) {
              foundFvg = true;
              fvgTop = c2L;
              fvgBottom = c0H;
              fvgCe = (fvgTop + fvgBottom) / 2;
              break;
            }
          } else {
            if (c2H < c0L) {
              foundFvg = true;
              fvgTop = c0L;
              fvgBottom = c2H;
              fvgCe = (fvgTop + fvgBottom) / 2;
              break;
            }
          }
        }
      }

      // 3C. Resolve Limit Entry Price (FVG Proximal Edge)
      // For Bullish BISI: outer opening edge = fvgTop (c2 Low)
      // For Bearish SIBI: outer opening edge = fvgBottom (c2 High)
      let executionEntryPrice: number;
      if (foundFvg) {
        if (this.config.entryMode === 'FVG_CE') {
          executionEntryPrice = fvgCe;
        } else {
          executionEntryPrice = setupDirection === 'BULLISH' ? fvgTop : fvgBottom;
        }
      } else {
        // Fallback to broken pivot level
        executionEntryPrice = brokenPivotLevel;
      }

      // 3D. Resolve Hard Stop Loss beyond origin swing with ATR buffer
      const currentAtr = atrSeries[i] || 1.0;
      const slBuffer = Math.max(0.01, (this.config.slBufferAtrMultiplier ?? 0.10) * currentAtr);

      const rawStopLoss = setupDirection === 'BULLISH'
        ? originSwingPrice - slBuffer
        : originSwingPrice + slBuffer;

      // Anti-Micro-Friction Clamp (0.15% minimum distance floor)
      const calculatedRawDistance = Math.abs(executionEntryPrice - rawStopLoss);
      const minStopDistance = Math.max(calculatedRawDistance, executionEntryPrice * 0.0015);

      const stopLoss = setupDirection === 'BULLISH'
        ? parseFloat((executionEntryPrice - minStopDistance).toFixed(4))
        : parseFloat((executionEntryPrice + minStopDistance).toFixed(4));

      const riskUsd = minStopDistance;
      const riskPct = (riskUsd / executionEntryPrice) * 100;

      // 3E. Resolve Targets (Inverted 30/70 Asymmetric Model)
      const stage1Multiple = this.config.stage1Multiple ?? 1.50;
      const defaultStage2Multiple = this.config.stage2Multiple ?? 4.00;

      // Target 1: 1.5R or Dealing Range Equilibrium (whichever is reached first)
      const defaultStage1Target = setupDirection === 'BULLISH'
        ? parseFloat((executionEntryPrice + stage1Multiple * riskUsd).toFixed(4))
        : parseFloat((executionEntryPrice - stage1Multiple * riskUsd).toFixed(4));

      let stage1Target = defaultStage1Target;
      let dealingRangeEq: number | null = null;

      if (
        this.config.structuralDealingRange &&
        Number.isFinite(this.config.structuralDealingRange.equilibrium) &&
        this.config.structuralDealingRange.equilibrium > 0
      ) {
        dealingRangeEq = parseFloat(this.config.structuralDealingRange.equilibrium.toFixed(4));
      } else if (majorHighs.length > 0 && majorLows.length > 0) {
        const lastH = majorHighs[majorHighs.length - 1];
        const lastL = majorLows[majorLows.length - 1];
        if (lastH && lastL && lastH.price > lastL.price) {
          dealingRangeEq = parseFloat(((lastH.price + lastL.price) / 2).toFixed(4));
        }
      }

      if (dealingRangeEq === null && i >= lookbackMajor * 4) {
        const wStart = Math.max(0, i - lookbackMajor * 4);
        let maxP = -Infinity;
        let minP = Infinity;
        for (let w = wStart; w <= i; w++) {
          const wh = candles[w].h ?? (candles[w] as any).high;
          const wl = candles[w].l ?? (candles[w] as any).low;
          if (wh > maxP) maxP = wh;
          if (wl < minP && wl > 0) minP = wl;
        }
        if (maxP > minP && minP > 0) {
          dealingRangeEq = parseFloat(((maxP + minP) / 2).toFixed(4));
        }
      }

      // Dynamic Opposing External Liquidity for Target 2 (Range: 3.0R - 5.0R)
      const minMult = this.config.minDynamicTp2Multiple ?? 3.00;
      const maxMult = this.config.maxDynamicTp2Multiple ?? 5.00;
      let stage2Target = setupDirection === 'BULLISH'
        ? parseFloat((executionEntryPrice + defaultStage2Multiple * riskUsd).toFixed(4))
        : parseFloat((executionEntryPrice - defaultStage2Multiple * riskUsd).toFixed(4));
      let opposingLiqName: string | null = null;
      let opposingLiqPrice: number | null = null;
      let dynamicTargetSource: string = 'FIXED_RR';

      if (this.config.dynamicTp2Source === 'OPPOSING_LIQUIDITY') {
        const asianTargets = calculateAsianRangeTargets(candles, i);
        interface CandidateTarget {
          price: number;
          name: string;
          source: string;
          rDist: number;
          proximity: number;
        }
        const candidates: CandidateTarget[] = [];

        // 1. Resting Liquidity Magnets (BSL for Longs, SSL for Shorts)
        if (setupDirection === 'BULLISH') {
          const bslMagnets = this.config.restingLiquidityPools?.BSL_Magnets || [];
          for (const bsl of bslMagnets) {
            if (bsl > executionEntryPrice) {
              const rDist = (bsl - executionEntryPrice) / riskUsd;
              if (rDist >= minMult && rDist <= maxMult) {
                candidates.push({
                  price: bsl,
                  name: `BSL_MAGNET_${Math.round(bsl)}`,
                  source: 'BSL_MAGNET',
                  rDist,
                  proximity: Math.abs(bsl - executionEntryPrice),
                });
              }
            }
          }
        } else {
          const sslMagnets = this.config.restingLiquidityPools?.SSL_Magnets || [];
          for (const ssl of sslMagnets) {
            if (ssl < executionEntryPrice) {
              const rDist = (executionEntryPrice - ssl) / riskUsd;
              if (rDist >= minMult && rDist <= maxMult) {
                candidates.push({
                  price: ssl,
                  name: `SSL_MAGNET_${Math.round(ssl)}`,
                  source: 'SSL_MAGNET',
                  rDist,
                  proximity: Math.abs(executionEntryPrice - ssl),
                });
              }
            }
          }
        }

        // 2. Asian Range Standard Deviation Targets (+1.5 SD / +2.0 SD)
        if (asianTargets) {
          if (setupDirection === 'BULLISH') {
            const sd1_5 = asianTargets.upwardDev1_5;
            const sd2_0 = asianTargets.upwardDev2_0;
            if (sd1_5 > executionEntryPrice) {
              const rDist = (sd1_5 - executionEntryPrice) / riskUsd;
              if (rDist >= minMult && rDist <= maxMult) {
                candidates.push({
                  price: sd1_5,
                  name: `ASIAN_SD_+1.5_${Math.round(sd1_5)}`,
                  source: 'ASIAN_SD_1_5',
                  rDist,
                  proximity: Math.abs(sd1_5 - executionEntryPrice),
                });
              }
            }
            if (sd2_0 > executionEntryPrice) {
              const rDist = (sd2_0 - executionEntryPrice) / riskUsd;
              if (rDist >= minMult && rDist <= maxMult) {
                candidates.push({
                  price: sd2_0,
                  name: `ASIAN_SD_+2.0_${Math.round(sd2_0)}`,
                  source: 'ASIAN_SD_2_0',
                  rDist,
                  proximity: Math.abs(sd2_0 - executionEntryPrice),
                });
              }
            }
          } else {
            const sd1_5 = asianTargets.downwardDev1_5;
            const sd2_0 = asianTargets.downwardDev2_0;
            if (sd1_5 < executionEntryPrice) {
              const rDist = (executionEntryPrice - sd1_5) / riskUsd;
              if (rDist >= minMult && rDist <= maxMult) {
                candidates.push({
                  price: sd1_5,
                  name: `ASIAN_SD_-1.5_${Math.round(sd1_5)}`,
                  source: 'ASIAN_SD_1_5',
                  rDist,
                  proximity: Math.abs(executionEntryPrice - sd1_5),
                });
              }
            }
            if (sd2_0 < executionEntryPrice) {
              const rDist = (executionEntryPrice - sd2_0) / riskUsd;
              if (rDist >= minMult && rDist <= maxMult) {
                candidates.push({
                  price: sd2_0,
                  name: `ASIAN_SD_-2.0_${Math.round(sd2_0)}`,
                  source: 'ASIAN_SD_2_0',
                  rDist,
                  proximity: Math.abs(executionEntryPrice - sd2_0),
                });
              }
            }
          }
        }

        // 3. Opposing Major Swing Pivots
        const candidateOpposing = allPivots.filter((p) => {
          if (p.index > i) return false;
          if (setupDirection === 'BULLISH') {
            return p.type === 'SWING_HIGH' && p.price > executionEntryPrice;
          } else {
            return p.type === 'SWING_LOW' && p.price < executionEntryPrice;
          }
        });
        for (const cand of candidateOpposing) {
          const rDist = Math.abs(cand.price - executionEntryPrice) / riskUsd;
          if (rDist >= minMult && rDist <= maxMult) {
            candidates.push({
              price: cand.price,
              name: `MAJOR_${cand.type}_${cand.index}`,
              source: 'OPPOSING_PIVOT',
              rDist,
              proximity: Math.abs(cand.price - executionEntryPrice),
            });
          }
        }

        if (candidates.length > 0) {
          candidates.sort((a, b) => a.proximity - b.proximity);
          const best = candidates[0];
          stage2Target = parseFloat(best.price.toFixed(4));
          opposingLiqName = best.name;
          opposingLiqPrice = best.price;
          dynamicTargetSource = best.source;
        }
      }

      const stage2Multiple = parseFloat((Math.abs(stage2Target - executionEntryPrice) / riskUsd).toFixed(2));

      // 3F. Build Candidate Setup Object
      const setupId = `TC_${setupDirection}_${currentCandle.t}_${Math.round(executionEntryPrice)}`;

      // 3-Candle Displacement Audit Sequence
      const displacementCandles: DisplacementCandleAudit[] = [];
      const baseIdx = Math.max(0, i - 2);
      for (let d = baseIdx; d <= i; d++) {
        const cd = candles[d];
        displacementCandles.push({
          label: d === i ? 'Candle 3 (BOS Expansion Close)' : d === i - 1 ? 'Candle 2 (Impulse Body)' : 'Candle 1 (Origin Launch)',
          time: cd.t,
          open: parseFloat(Number(cd.o ?? (cd as any).open).toFixed(2)),
          high: parseFloat(Number(cd.h ?? (cd as any).high).toFixed(2)),
          low: parseFloat(Number(cd.l ?? (cd as any).low).toFixed(2)),
          close: parseFloat(Number(cd.c ?? (cd as any).close).toFixed(2)),
          volume: parseFloat(Number(cd.v ?? (cd as any).volume ?? 0).toFixed(2)),
        });
      }

      const setup: TrendContinuationSetup = {
        id: setupId,
        type: setupDirection,
        symbol: this.config.symbol || 'ETHUSDC',
        timeframe: this.config.timeframe || '15m',
        phase: 'BOS',
        status: 'BOS_NO_RETEST',
        displacement_candles: displacementCandles,

        htf_trend: activeHtfTrend,
        htf_ema120: parseFloat(currentEma.toFixed(4)),
        htf_structural_trend: htfStructuralTrend,
        is_htf_aligned: true,

        // AMT Value Area & Anti-Chop Telemetry
        value_area_vah: vaProfile ? vaProfile.vah : null,
        value_area_val: vaProfile ? vaProfile.val : null,
        value_area_poc: vaProfile ? vaProfile.poc : null,
        value_area_state: vaState,
        is_value_area_approved: isVaApproved,

        // OLS Statistical Validation & OI Sponsorship
        ols_t_statistic: olsTStat,
        ols_p_value: olsPVal,
        ols_confidence_tier: olsTier,
        ols_passed: olsPassed,
        order_flow_regime: curOrderFlowRegime,
        is_oi_sponsored: isOiSponsored,

        // Intermarket SMT Tracking Metadata
        smt_status: smtStatus,
        is_smt_aligned: isSmtAligned,
        is_smt_authorized: isSmtAuthorized,
        smt_gate_status: isSmtAuthorized ? 'AUTHORIZED' : 'VETOED',

        pivot_id: `PIVOT_${brokenPivot!.index}_${brokenPivot!.type}`,
        broken_pivot_level: brokenPivotLevel,
        broken_pivot_index: brokenPivotIndex,
        broken_pivot_time: brokenPivotTime,
        broken_pivot_type: brokenPivot!.type,
        broken_pivot_level_grade: 'MAJOR',
        bos_candle_index: i,
        bos_candle_time: currentCandle.t,
        bos_close_price: curClose,
        origin_swing_level: originSwingPrice,
        origin_swing_index: originSwingIndex,
        origin_swing_time: originSwingTime,

        bos_volume_expansion: parseFloat(effectiveVolExp.toFixed(2)),
        bos_body_ratio: parseFloat((effectiveBodyRatio * 100).toFixed(1)),
        bos_delta_dominance_pct: parseFloat(effectiveDeltaPct.toFixed(1)),
        pillar1_volume_ratio_passed: p1Passed,
        pillar2_delta_dominance_passed: p2Passed,
        pillar3_body_ratio_passed: p3Passed,
        three_pillar_displacement_passed: allThreePillarsPassed,

        fvg_created: foundFvg,
        fvg_top: foundFvg ? parseFloat(fvgTop.toFixed(4)) : null,
        fvg_bottom: foundFvg ? parseFloat(fvgBottom.toFixed(4)) : null,
        fvg_ce: foundFvg ? parseFloat(fvgCe.toFixed(4)) : null,
        fvg_proximal: parseFloat((setupDirection === 'BULLISH' ? fvgTop : fvgBottom).toFixed(4)),
        fvg_distal: foundFvg ? parseFloat((setupDirection === 'BULLISH' ? fvgBottom : fvgTop).toFixed(4)) : null,

        entry_price: parseFloat(executionEntryPrice.toFixed(4)),
        stop_loss: parseFloat(stopLoss.toFixed(4)),
        risk_usd: parseFloat(riskUsd.toFixed(4)),
        risk_pct: parseFloat(riskPct.toFixed(3)),

        dealing_range_equilibrium: dealingRangeEq,

        stage1_target: stage1Target,
        stage2_target: stage2Target,
        stage1_ratio: this.config.stage1Ratio ?? 0.30,
        stage2_ratio: this.config.stage2Ratio ?? 0.70,
        stage1_multiple: stage1Multiple,
        stage2_multiple: stage2Multiple,

        opposing_liquidity_name: opposingLiqName,
        opposing_liquidity_price: opposingLiqPrice,
        dynamic_target_source: dynamicTargetSource,

        retest_index: null,
        retest_time: null,
        retest_price: null,
        bars_bos_to_retest: null,
        is_retested: false,

        is_stage1_filled: false,
        is_stage2_filled: false,
        stage1_hit_time: null,
        stage1_hit_index: null,
        stage2_hit_time: null,
        stage2_hit_index: null,

        active_trailing_sl: parseFloat(stopLoss.toFixed(4)),
        trailing_sl_source: 'INITIAL',
        is_be_scratch: false,
        is_structural_scratch: false,

        simulated_outcome: 'NO_RETEST',
        stage_exit_type: 'NO_RETEST',
        realized_rr: 0,
        mfe_r: 0,
        mae_r: 0,
        bars_to_outcome: null,
        exit_time: null,
        exit_price: null,
        wave_fingerprint: `${currentCandle.t}_${setupDirection}_${Math.round(executionEntryPrice)}`,
      };

      // ── Phase 4: Independent Retest Search (12-Bar TTL) ──
      const maxRetestBars = this.config.maxBarsToRetest ?? 12;
      const effectiveMaxRetestIdx = Math.min(n - 1, i + maxRetestBars);
      let retestFound = false;
      let retestIdx: number | null = null;
      let retestTime: number | null = null;

      for (let r = i + 1; r <= effectiveMaxRetestIdx; r++) {
        const rc = candles[r];
        const rOpen = rc.o ?? (rc as any).open;
        const rLow = rc.l ?? (rc as any).low;
        const rHigh = rc.h ?? (rc as any).high;

        if (setupDirection === 'BULLISH') {
          // Gapped past TP1 or SL
          if (rOpen >= stage1Target) {
            setup.status = 'BOS_NO_RETEST';
            break;
          }
          if (rOpen <= stopLoss) {
            setup.status = 'INVALIDATED_AT_RETEST';
            break;
          }

          // Retest Fill: price dips to or below entry limit
          if (rLow <= executionEntryPrice) {
            if (this.config.enforceToxicWindowBlacklist !== false) {
              const toxic = isToxicWindow(rc.t, {
                enforceRolloverFreeze: this.config.enforceRolloverFreeze,
                enforceNewsFreeze: this.config.enforceNewsFreeze,
              });
              if (toxic.isToxic) {
                // Mute trade initiation during daily funding rollover (23:50-00:10 UTC) or macro releases (CPI/PPI/FOMC)
                setup.status = 'BOS_NO_RETEST';
                break;
              }
            }

            retestFound = true;
            retestIdx = r;
            retestTime = rc.t;
            break;
          }

          // Pre-fill invalidations: Missed expansion (hit TP1 without filling limit)
          if (rHigh >= stage1Target) {
            setup.status = 'BOS_NO_RETEST';
            break;
          }
          // Stop loss breached before fill
          if (rLow <= stopLoss) {
            setup.status = 'INVALIDATED_AT_RETEST';
            break;
          }
        } else {
          // Bearish
          if (rOpen <= stage1Target) {
            setup.status = 'BOS_NO_RETEST';
            break;
          }
          if (rOpen >= stopLoss) {
            setup.status = 'INVALIDATED_AT_RETEST';
            break;
          }

          // Retest Fill: price rallies to or above entry limit
          if (rHigh >= executionEntryPrice) {
            if (this.config.enforceToxicWindowBlacklist !== false) {
              const toxic = isToxicWindow(rc.t, {
                enforceRolloverFreeze: this.config.enforceRolloverFreeze,
                enforceNewsFreeze: this.config.enforceNewsFreeze,
              });
              if (toxic.isToxic) {
                setup.status = 'BOS_NO_RETEST';
                break;
              }
            }

            retestFound = true;
            retestIdx = r;
            retestTime = rc.t;
            break;
          }

          // Pre-fill invalidations: Missed expansion
          if (rLow <= stage1Target) {
            setup.status = 'BOS_NO_RETEST';
            break;
          }
          if (rHigh >= stopLoss) {
            setup.status = 'INVALIDATED_AT_RETEST';
            break;
          }
        }
      }

      if (retestFound && retestIdx !== null && retestTime !== null) {
        setup.phase = 'RETEST';
        setup.status = 'RETESTED';
        setup.is_retested = true;
        setup.retest_index = retestIdx;
        setup.retest_time = retestTime;
        setup.retest_price = executionEntryPrice;
        setup.bars_bos_to_retest = retestIdx - i;
      }

      if (brokenPivotKey) {
        consumedBreakoutPivots.add(brokenPivotKey);
      }

      detectedSetups.push(setup);
    }

    // ── Phase 5: Chronological Single-Position Lifecycle Walk ─────────────────
    // Extract strictly retested setups and sort them chronologically by retest time
    const retestedCandidates = detectedSetups.filter((s) => s.is_retested && s.retest_index !== null);
    retestedCandidates.sort((a, b) => {
      const timeDiff = (a.retest_time || 0) - (b.retest_time || 0);
      if (timeDiff !== 0) return timeDiff;
      // Proximity tiebreak: entry closest to prevailing market
      if (a.type === 'BULLISH' && b.type === 'BULLISH') {
        return b.entry_price - a.entry_price;
      } else if (a.type === 'BEARISH' && b.type === 'BEARISH') {
        return a.entry_price - b.entry_price;
      }
      return 0;
    });

    let lastExitTimestamp = 0;
    let lastTradeWasLoss = false;
    const cooldownMs = (this.config.postLossCooldownMinutes ?? 45) * 60 * 1000;

    let concurrencyVeto = 0;
    let cooldownVeto = 0;
    let toxicVeto = 0;

    for (const setup of retestedCandidates) {
      const openTime = setup.retest_time!;

      // Toxic Window Blacklist check
      if (this.config.enforceToxicWindowBlacklist !== false) {
        const toxic = isToxicWindow(openTime, {
          enforceRolloverFreeze: this.config.enforceRolloverFreeze,
          enforceNewsFreeze: this.config.enforceNewsFreeze,
        });
        if (toxic.isToxic) {
          toxicVeto++;
          setup.status = 'BOS_NO_RETEST';
          setup.simulated_outcome = 'INVALIDATED';
          continue;
        }
      }

      if (this.config.enforceSinglePositionConcurrency) {
        if (openTime < lastExitTimestamp) {
          concurrencyVeto++;
          // Overlaps with an active open position
          setup.status = 'BOS_NO_RETEST';
          setup.simulated_outcome = 'INVALIDATED';
          continue;
        }

        if (lastTradeWasLoss && openTime < lastExitTimestamp + cooldownMs) {
          cooldownVeto++;
          // Rule 5: Post-loss cooldown in effect
          setup.status = 'BOS_NO_RETEST';
          setup.simulated_outcome = 'INVALIDATED';
          continue;
        }
      }

      // Execute simulation for this trade
      const retestIdx = setup.retest_index!;
      const executionEntryPrice = setup.entry_price;
      const stopLoss = setup.stop_loss;
      const riskUsd = setup.risk_usd;
      const stage1Target = setup.stage1_target;
      const stage2Target = setup.stage2_target;
      const stage1Multiple = setup.stage1_multiple;
      const stage2Multiple = setup.stage2_multiple;
      const setupDirection = setup.type;

      let positionOpen = true;
      let activeStopLoss = stopLoss;
      let maxFavorablePrice = executionEntryPrice;
      let maxAdversePrice = executionEntryPrice;
      let outcome: TrendContinuationTradeOutcome = 'PENDING';
      let stageExit: TrendContinuationStageExitType = 'PENDING';
      let realizedRr = 0;
      let exitIdx: number | null = null;
      let exitPrice: number | null = null;
      let exitTime: number | null = null;

      const w1 = setup.stage1_ratio;
      const w2 = setup.stage2_ratio;

      // Fee-Padded Breakeven Stop Level (+0.015% offset)
      const beOffsetPct = this.config.breakevenOffsetPct ?? 0.015;
      const targetBreakevenPrice = setupDirection === 'BULLISH'
        ? executionEntryPrice * (1 + beOffsetPct / 100)
        : executionEntryPrice * (1 - beOffsetPct / 100);

      for (let k = retestIdx; k < n; k++) {
        if (!positionOpen) break;

        const c = candles[k];
        const open = c.o ?? (c as any).open;
        const high = c.h ?? (c as any).high;
        const low = c.l ?? (c as any).low;
        const close = c.c ?? (c as any).close;

        if (setupDirection === 'BULLISH') {
          // Next-Bar Ratchet Rule on entry bar
          const isUnderwaterEntryBar = k === retestIdx && open > executionEntryPrice && close <= executionEntryPrice;
          if (isUnderwaterEntryBar) {
            maxFavorablePrice = executionEntryPrice;
          } else {
            if (high > maxFavorablePrice) maxFavorablePrice = high;
          }
          if (low < maxAdversePrice) maxAdversePrice = low;

          const initialBarSL = activeStopLoss;

          // Priority 1: Check initialBarSL violation
          // If TP1 was not banked on an earlier bar and low reaches SL: stop out
          if (low <= initialBarSL) {
            exitIdx = k;
            exitPrice = initialBarSL;
            exitTime = c.t;
            positionOpen = false;

            if (setup.is_stage1_filled && (setup.stage1_hit_index ?? retestIdx) < k) {
              const runnerR = (initialBarSL - executionEntryPrice) / riskUsd;
              realizedRr = parseFloat((w1 * stage1Multiple + w2 * runnerR).toFixed(4));
              if (runnerR > 0.05) {
                outcome = 'STAGE_2_WIN';
                stageExit = 'STAGE_2_WIN';
                setup.is_be_scratch = false;
              } else if (realizedRr >= 0) {
                outcome = 'BE_SCRATCH_WIN';
                stageExit = 'STAGE_1_SCRATCH';
                setup.is_be_scratch = true;
              } else {
                outcome = 'STRUCTURAL_SCRATCH';
                stageExit = 'STAGE_1_SCRATCH';
                setup.is_structural_scratch = true;
              }
            } else {
              realizedRr = -1.0;
              outcome = 'STOPPED_OUT';
              stageExit = 'STOPPED_OUT';
            }
            break;
          }

          const hitStage1 = isUnderwaterEntryBar ? false : (high >= stage1Target);
          const hitStage2 = isUnderwaterEntryBar ? false : (high >= stage2Target);

          // Priority 2: Target 1 (30% De-Risking Tranche @ 1.5R)
          if (hitStage1 && !setup.is_stage1_filled) {
            setup.is_stage1_filled = true;
            setup.stage1_hit_time = c.t;
            setup.stage1_hit_index = k;

            // Ratchet SL to Breakeven (+0.015% shield) taking effect on bar k + 1
            activeStopLoss = targetBreakevenPrice;
            setup.active_trailing_sl = parseFloat(targetBreakevenPrice.toFixed(4));
            setup.trailing_sl_source = 'BREAKEVEN';
          }

          // Priority 2.5: +1.0R Dynamic Profit Floor Ratchet
          // When floating MFE crosses +2.0R, immediately ratchet runner SL to lock in +1.0R profit floor
          const floatingMfeR = (high - executionEntryPrice) / riskUsd;
          if (this.config.enableDynamicProfitFloor !== false && floatingMfeR >= 2.0 && setup.is_stage1_filled) {
            const profitFloorPrice = executionEntryPrice + 1.0 * riskUsd;
            if (activeStopLoss < profitFloorPrice) {
              activeStopLoss = parseFloat(profitFloorPrice.toFixed(4));
              setup.active_trailing_sl = activeStopLoss;
              setup.trailing_sl_source = 'PROFIT_FLOOR_1R';
            }
          }

          // Priority 3: 15m 3-Bar Structural Trailing for Runner
          if (this.config.enableM15StructuralTrail && setup.is_stage1_filled && k > (setup.stage1_hit_index ?? retestIdx)) {
            if (k >= 3) {
              const cPrev2L = Number(candles[k - 2].l ?? (candles[k - 2] as any).low);
              const cPrev3L = Number(candles[k - 3].l ?? (candles[k - 3] as any).low);
              const cPrev1L = Number(candles[k - 1].l ?? (candles[k - 1] as any).low);
              const isSwingLow = cPrev2L < cPrev3L && cPrev2L <= cPrev1L;
              if (isSwingLow && cPrev2L > activeStopLoss && cPrev2L >= targetBreakevenPrice) {
                activeStopLoss = cPrev2L;
                setup.active_trailing_sl = parseFloat(activeStopLoss.toFixed(4));
                setup.trailing_sl_source = 'SWING_TRAIL';
              }
            }
          }

          // Priority 4: Target 2 (70% Macro Runner @ 3.0R - 5.0R)
          if (hitStage2 && setup.is_stage1_filled && !setup.is_stage2_filled) {
            setup.is_stage2_filled = true;
            setup.stage2_hit_time = c.t;
            setup.stage2_hit_index = k;

            realizedRr = parseFloat((w1 * stage1Multiple + w2 * stage2Multiple).toFixed(4));
            outcome = 'FULL_TP2_WIN';
            stageExit = 'FULL_TP2_WIN';
            exitIdx = k;
            exitPrice = stage2Target;
            exitTime = c.t;
            positionOpen = false;
            break;
          }
        } else {
          // BEARISH
          const isUnderwaterEntryBar = k === retestIdx && open < executionEntryPrice && close >= executionEntryPrice;
          if (isUnderwaterEntryBar) {
            maxFavorablePrice = executionEntryPrice;
          } else {
            if (low < maxFavorablePrice) maxFavorablePrice = low;
          }
          if (high > maxAdversePrice) maxAdversePrice = high;

          const initialBarSL = activeStopLoss;

          // Priority 1: Check initialBarSL violation
          if (high >= initialBarSL) {
            exitIdx = k;
            exitPrice = initialBarSL;
            exitTime = c.t;
            positionOpen = false;

            if (setup.is_stage1_filled && (setup.stage1_hit_index ?? retestIdx) < k) {
              const runnerR = (executionEntryPrice - initialBarSL) / riskUsd;
              realizedRr = parseFloat((w1 * stage1Multiple + w2 * runnerR).toFixed(4));
              if (runnerR > 0.05) {
                outcome = 'STAGE_2_WIN';
                stageExit = 'STAGE_2_WIN';
                setup.is_be_scratch = false;
              } else if (realizedRr >= 0) {
                outcome = 'BE_SCRATCH_WIN';
                stageExit = 'STAGE_1_SCRATCH';
                setup.is_be_scratch = true;
              } else {
                outcome = 'STRUCTURAL_SCRATCH';
                stageExit = 'STAGE_1_SCRATCH';
                setup.is_structural_scratch = true;
              }
            } else {
              realizedRr = -1.0;
              outcome = 'STOPPED_OUT';
              stageExit = 'STOPPED_OUT';
            }
            break;
          }

          const hitStage1 = isUnderwaterEntryBar ? false : (low <= stage1Target);
          const hitStage2 = isUnderwaterEntryBar ? false : (low <= stage2Target);

          // Priority 2: Target 1 (30% @ 1.5R)
          if (hitStage1 && !setup.is_stage1_filled) {
            setup.is_stage1_filled = true;
            setup.stage1_hit_time = c.t;
            setup.stage1_hit_index = k;

            activeStopLoss = targetBreakevenPrice;
            setup.active_trailing_sl = parseFloat(targetBreakevenPrice.toFixed(4));
            setup.trailing_sl_source = 'BREAKEVEN';
          }

          // Priority 2.5: +1.0R Dynamic Profit Floor Ratchet
          const floatingMfeR = (executionEntryPrice - low) / riskUsd;
          if (this.config.enableDynamicProfitFloor !== false && floatingMfeR >= 2.0 && setup.is_stage1_filled) {
            const profitFloorPrice = executionEntryPrice - 1.0 * riskUsd;
            if (activeStopLoss > profitFloorPrice) {
              activeStopLoss = parseFloat(profitFloorPrice.toFixed(4));
              setup.active_trailing_sl = activeStopLoss;
              setup.trailing_sl_source = 'PROFIT_FLOOR_1R';
            }
          }

          // Priority 3: 15m 3-Bar Structural Trailing for Runner
          if (this.config.enableM15StructuralTrail && setup.is_stage1_filled && k > (setup.stage1_hit_index ?? retestIdx)) {
            if (k >= 3) {
              const cPrev2H = Number(candles[k - 2].h ?? (candles[k - 2] as any).high);
              const cPrev3H = Number(candles[k - 3].h ?? (candles[k - 3] as any).high);
              const cPrev1H = Number(candles[k - 1].h ?? (candles[k - 1] as any).high);
              const isSwingHigh = cPrev2H > cPrev3H && cPrev2H >= cPrev1H;
              if (isSwingHigh && cPrev2H < activeStopLoss && cPrev2H <= targetBreakevenPrice) {
                activeStopLoss = cPrev2H;
                setup.active_trailing_sl = parseFloat(activeStopLoss.toFixed(4));
                setup.trailing_sl_source = 'SWING_TRAIL';
              }
            }
          }

          // Priority 4: Target 2 (70% Runner)
          if (hitStage2 && setup.is_stage1_filled && !setup.is_stage2_filled) {
            setup.is_stage2_filled = true;
            setup.stage2_hit_time = c.t;
            setup.stage2_hit_index = k;

            realizedRr = parseFloat((w1 * stage1Multiple + w2 * stage2Multiple).toFixed(4));
            outcome = 'FULL_TP2_WIN';
            stageExit = 'FULL_TP2_WIN';
            exitIdx = k;
            exitPrice = stage2Target;
            exitTime = c.t;
            positionOpen = false;
            break;
          }
        }
      }

      // Compute MFE / MAE
      const mfeR = setupDirection === 'BULLISH'
        ? (maxFavorablePrice - executionEntryPrice) / riskUsd
        : (executionEntryPrice - maxFavorablePrice) / riskUsd;
      const maeR = setupDirection === 'BULLISH'
        ? (maxAdversePrice - executionEntryPrice) / riskUsd
        : (executionEntryPrice - maxAdversePrice) / riskUsd;

      // Fee Accounting:
      // Entry limit: 0.0000% maker
      // Stop Loss / Scratch: 0.0400% taker
      const makerFeeRate = (this.config.makerFeePct ?? 0.0000) / 100;
      const takerFeeRate = (this.config.takerFeePct ?? 0.0400) / 100;
      const isScratch = setup.is_be_scratch || (realizedRr >= 0 && realizedRr <= 0.05);
      const isFeePaddedScratch = isScratch && (this.config.enableFeePaddedBreakeven !== false);

      let feeInR = 0;
      if (outcome !== 'PENDING' && exitPrice !== null) {
        if (isFeePaddedScratch) {
          feeInR = 0; // covered by price offset
        } else if (outcome === 'FULL_TP2_WIN') {
          // Maker exit
          const exitFeeR = (exitPrice / riskUsd) * makerFeeRate;
          feeInR = parseFloat(exitFeeR.toFixed(4));
        } else if (setup.is_stage1_filled) {
          // 30% maker + 70% taker stop
          const exitFeeR = (exitPrice / riskUsd) * (w1 * makerFeeRate + w2 * takerFeeRate);
          feeInR = parseFloat(exitFeeR.toFixed(4));
        } else {
          // Full taker stop out
          const exitFeeR = (exitPrice / riskUsd) * takerFeeRate;
          feeInR = parseFloat(exitFeeR.toFixed(4));
        }
      }

      const netRealizedR = outcome === 'PENDING' ? 0 : parseFloat((realizedRr - feeInR).toFixed(4));

      setup.simulated_outcome = outcome;
      setup.stage_exit_type = stageExit;
      setup.realized_rr = realizedRr;
      setup.fee_in_r = feeInR;
      setup.net_realized_rr = netRealizedR;
      setup.mfe_r = parseFloat(mfeR.toFixed(2));
      setup.mae_r = parseFloat(maeR.toFixed(2));
      setup.bars_to_outcome = exitIdx !== null ? exitIdx - retestIdx : null;
      setup.exit_time = exitTime;
      setup.exit_price = exitPrice;

      if (exitTime !== null) {
        lastExitTimestamp = exitTime;
        lastTradeWasLoss = realizedRr < 0;
      }
    }

    // ── 3. Generate Telemetry Summary ──
    const telemetry = this.computeTelemetry(detectedSetups, candles.length);
    console.log(`[TC Diagnostics] BOS: ${dbgBos} | VA Veto: ${dbgVaVeto} | OLS Veto: ${dbgOlsVeto} | OI Veto: ${dbgOiVeto} | SMT Veto: ${dbgSmtVeto} | Disp Veto: ${dbgDispVeto} | Passed to P3: ${dbgPassedP3} | Retested Cand: ${retestedCandidates.length} | Conc Veto: ${concurrencyVeto} | Cooldown Veto: ${cooldownVeto} | Toxic Veto: ${toxicVeto + dbgToxicVeto} | Executed: ${telemetry.retestedTradesCount}`);

    return {
      setups: detectedSetups,
      telemetry,
    };
  }

  private computeTelemetry(
    setups: TrendContinuationSetup[],
    totalCandles: number
  ): TrendContinuationTelemetrySummary {
    const retestedTrades = setups.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');
    const totalExecuted = retestedTrades.length;

    let winningCount = 0;
    let losingCount = 0;
    let scratchCount = 0;
    let grossRealizedR = 0;
    let totalFeesR = 0;
    let grossWinsR = 0;
    let grossLossesR = 0;

    for (const t of retestedTrades) {
      const r = t.realized_rr;
      const fee = t.fee_in_r ?? 0;
      grossRealizedR += r;
      totalFeesR += fee;

      if (r > 0.05) {
        winningCount++;
        grossWinsR += r;
      } else if (r < -0.05) {
        losingCount++;
        grossLossesR += Math.abs(r);
      } else {
        scratchCount++;
      }
    }

    const netRealizedR = parseFloat((grossRealizedR - totalFeesR).toFixed(2));
    const executionWinRatePct = totalExecuted > 0 ? parseFloat(((winningCount / totalExecuted) * 100).toFixed(1)) : 0;
    const nonScratchCount = winningCount + losingCount;
    const exScratchWinRatePct = nonScratchCount > 0 ? parseFloat(((winningCount / nonScratchCount) * 100).toFixed(1)) : 0;

    const avgWinR = winningCount > 0 ? grossWinsR / winningCount : 0;
    const avgLossR = losingCount > 0 ? grossLossesR / losingCount : 1.0;
    const asymmetry = avgLossR > 0 ? parseFloat((avgWinR / avgLossR).toFixed(2)) : 0;

    const netWinsR = grossWinsR;
    const netLossesAndFeesR = grossLossesR + totalFeesR;
    const netProfitFactor = netLossesAndFeesR > 0 ? parseFloat((netWinsR / netLossesAndFeesR).toFixed(2)) : grossWinsR > 0 ? 99.9 : 1.0;

    // Compounded Walk Simulation ($10k starting, 2% risk)
    const initialEquity = this.config.initialEquity ?? 10000.0;
    const riskPct = (this.config.compoundingRiskPct ?? 2.0) / 100;
    let currentEquity = initialEquity;
    let peakEquity = initialEquity;
    let maxDrawdownPct = 0;
    let maxDrawdownR = 0;
    let peakR = 0;
    let currentR = 0;

    for (const t of retestedTrades) {
      const rNet = t.net_realized_rr ?? (t.realized_rr - (t.fee_in_r ?? 0));
      currentR += rNet;
      if (currentR > peakR) peakR = currentR;
      const rDd = peakR - currentR;
      if (rDd > maxDrawdownR) maxDrawdownR = rDd;

      const riskUsd = currentEquity * riskPct;
      const pnlUsd = riskUsd * rNet;
      currentEquity += pnlUsd;

      if (currentEquity > peakEquity) {
        peakEquity = currentEquity;
      }
      const ddPct = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
      if (ddPct > maxDrawdownPct) {
        maxDrawdownPct = ddPct;
      }
    }

    const totalWeeks = Math.max(1, totalCandles / (4 * 24 * 7));
    const tradesPerWeek = parseFloat((totalExecuted / totalWeeks).toFixed(1));
    const avgRiskUsd = initialEquity * riskPct;
    const totalFeesUsd = parseFloat((totalFeesR * avgRiskUsd).toFixed(2));

    return {
      totalCandles,
      totalBosDetected: setups.length,
      retestedTradesCount: totalExecuted,
      winningTradesCount: winningCount,
      losingTradesCount: losingCount,
      scratchTradesCount: scratchCount,
      executionWinRatePct,
      exScratchWinRatePct,
      realizedWinLossAsymmetry: asymmetry,
      grossRealizedR: parseFloat(grossRealizedR.toFixed(2)),
      netRealizedR,
      totalFeesR: parseFloat(totalFeesR.toFixed(2)),
      totalFeesUsd,
      netProfitFactor,
      maxCompoundedDrawdownPct: parseFloat(maxDrawdownPct.toFixed(2)),
      maxDrawdownR: parseFloat(maxDrawdownR.toFixed(2)),
      initialEquity,
      finalEquity: parseFloat(currentEquity.toFixed(2)),
      tradesPerWeek,
    };
  }

  private createEmptyTelemetry(totalCandles: number): TrendContinuationTelemetrySummary {
    return {
      totalCandles,
      totalBosDetected: 0,
      retestedTradesCount: 0,
      winningTradesCount: 0,
      losingTradesCount: 0,
      scratchTradesCount: 0,
      executionWinRatePct: 0,
      exScratchWinRatePct: 0,
      realizedWinLossAsymmetry: 0,
      grossRealizedR: 0,
      netRealizedR: 0,
      totalFeesR: 0,
      totalFeesUsd: 0,
      netProfitFactor: 1.0,
      maxCompoundedDrawdownPct: 0,
      maxDrawdownR: 0,
      initialEquity: this.config.initialEquity ?? 10000.0,
      finalEquity: this.config.initialEquity ?? 10000.0,
      tradesPerWeek: 0,
    };
  }
}
