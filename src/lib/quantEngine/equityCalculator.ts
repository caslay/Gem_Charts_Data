/**
 * equityCalculator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Dual Compounding Calculation Engine & Trade Adapters.
 *
 * Implements:
 *  1. Standardized Executed Trade Data Normalization
 *  2. Approach A: Theoretical Closed Expectancy (Closed-form EV compounding)
 *  3. Approach B: Path-Dependent Sequential Walk (Exact step-by-step compounding,
 *     Max Peak-to-Trough Drawdown %, streak tracking, and profit factor analytics)
 *  4. High-Performance SVG Equity Curve Path & Coordinate Generator
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { SweepReclaimSetup } from './SweepReclaimEngine';
import { InstitutionalOrderBlock } from './OrderBlockEngine';

// ── Cairo Timezone Formatting Utility ─────────────────────────────────────────

/**
 * Formats a timestamp or Date into standardized Cairo time (YYYY-MM-DD HH:mm).
 */
export function formatCairoDateTime(timestamp: number | string | Date | undefined | null): string {
  if (!timestamp) return '—';
  const d = typeof timestamp === 'number' || typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (isNaN(d.getTime())) return '—';

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(d).replace(',', '');
  } catch {
    // Fallback if timezone is unavailable
    return new Date(d.getTime() + 3 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);
  }
}

// ── Standardized Trade Interface ─────────────────────────────────────────────

export interface StandardizedExecutedTrade {
  id: string;
  timestamp: number;
  dateStr: string;
  symbol: string;
  direction: 'BULLISH' | 'BEARISH' | 'LONG' | 'SHORT';
  entryPrice: number;
  stopLossPrice: number;
  exitPrice?: number | null;
  realizedR: number; // e.g. +1.5, -1.0, +0.4
  outcome: string;   // e.g. "FULL_TP2_WIN", "STOPPED_OUT", "STAGE_2_WIN"
  isWin: boolean;
  isLoss: boolean;
  isScratch: boolean;
  label: string;
  metadata?: Record<string, any>;
}

// ── Sequential Equity Point for Path-Dependent Visualization ──────────────────

export interface SequentialEquityPoint {
  tradeIndex: number;
  tradeId: string;
  timestamp: number;
  dateStr: string;
  equity: number;
  peakEquity: number;
  drawdownPct: number;
  drawdownUsd: number;
  riskUsd: number;
  pnlUsd: number;
  realizedR: number;
  isWin: boolean;
  isLoss: boolean;
  isScratch: boolean;
  outcome: string;
  direction: string;
  symbol: string;
  label: string;
  entryPrice: number;
  stopLossPrice: number;
  exitPrice?: number | null;
}

// ── Full Compounding Telemetry Output ────────────────────────────────────────

export interface CompoundingMetricsSummary {
  // Trade Counts & Execution Rates
  totalExecutedTrades: number;
  winningTradesCount: number;
  losingTradesCount: number;
  scratchTradesCount: number;
  executionWinRatePct: number;
  executionLossRatePct: number;
  executionScratchRatePct: number;

  // Realized R-Multiples & Asymmetry
  avgWinningR: number;
  avgLosingR: number;
  avgRealizedR: number;
  realizedWinLossAsymmetryRatio: number; // Avg Win R / Avg Loss R

  // Approach A: Theoretical Closed Expectancy
  expectedValueR: number; // EV_R = (WinRate * AvgWinR) - (LossRate * AvgLossR)
  theoreticalFinalEquity: number;
  theoreticalNetRoiPct: number;
  theoreticalNetPnlUsd: number;

  // Approach B: Path-Dependent Sequential Walk
  initialCapital: number;
  riskPerTradePct: number;
  compoundingMode: 'DYNAMIC_COMPOUNDING' | 'FIXED_FRACTIONAL';
  finalRealizedEquity: number;
  realizedNetPnlUsd: number;
  realizedNetRoiPct: number;
  maxDrawdownPct: number;
  maxDrawdownUsd: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  profitFactor: number;

  // Streaks
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreakType: 'WIN' | 'LOSS' | 'NONE';
  currentStreakCount: number;

  // Sequential Data Points
  equityCurvePoints: SequentialEquityPoint[];
}

// ── Sweep & Reclaim Trade Adapter ─────────────────────────────────────────────

// ── Sweep & Reclaim Trade Adapter ─────────────────────────────────────────────

export interface AdaptSweepReclaimOptions {
  enforceSinglePositionWalk?: boolean; // default true: 1:1 match with Live Daemon maxOpenPositions: 1
  enableWaveDeduplication?: boolean; // Rule 1: Multi-anchor wave deduplication (default true)
  filterWeekend?: boolean; // Rule 2: Weekend Off-Liquidity filter (default true)
  enforceHtfBiasGuard?: boolean; // Rule 3: Macro HTF Bias filter (default false)
  enableEarlyBreakeven?: boolean; // Early Breakeven Ratchet (default false)
  earlyBreakevenMultiple?: number; // MFE Multiple to trigger Breakeven (default 0.60)
  postLossCooldownMinutes?: number; // Rule 5: Directional cooldown after stop-out in minutes (default 45)
}

function getAnchorPriority(anchorType?: string, anchorSwingGrade?: string): number {
  if (anchorType === 'DAILY' || anchorType === 'PDH' || anchorType === 'PDL') return 100;
  if (anchorType === 'LONDON_HIGH' || anchorType === 'LONDON_LOW' || anchorType === 'LONDON') return 90;
  if (anchorType === 'ASIAN_HIGH' || anchorType === 'ASIAN_LOW' || anchorType === 'ASIAN') return 80;
  if (anchorSwingGrade === 'MAJOR') return 70;
  if (anchorSwingGrade === 'INTERNAL') return 50;
  return 30; // INNER
}

export function adaptSweepReclaimSetupsToTrades(
  setups: SweepReclaimSetup[],
  options: AdaptSweepReclaimOptions = { enforceSinglePositionWalk: true, enableWaveDeduplication: true, filterWeekend: false, enforceHtfBiasGuard: false, enableEarlyBreakeven: true, earlyBreakevenMultiple: 0.40, postLossCooldownMinutes: 0 }
): StandardizedExecutedTrade[] {
  if (!setups || setups.length === 0) return [];

  const nonExecutionOutcomes = [
    'NO_RETEST',
    'EXPIRED',
    'SWEPT_NO_RECLAIM',
    'ANCHOR_ONLY',
    'INVALIDATED',
    'INVALIDATED_AT_RETEST',
  ];

  // 1. Extract strictly valid executed/retested setups (including active in-flight positions)
  let executedSetups = setups.filter((s) => {
    const isRetested = s.is_retested === true || s.status === 'RETESTED';
    const isNonExecution =
      !s.simulated_outcome ||
      nonExecutionOutcomes.includes(s.simulated_outcome as string);
    return isRetested && !isNonExecution;
  });

  if (executedSetups.length === 0) return [];

  // 🛡️ Quant Shield Rule 2: Weekend Filter (Fri 22:00 - Sun 20:00 UTC)
  if (options.filterWeekend) {
    executedSetups = executedSetups.filter((s) => {
      const t = s.retest_time || s.reclaim_time || s.sweep_time || s.anchor_time || 0;
      const d = new Date(t);
      const day = d.getUTCDay();
      const hr = d.getUTCHours();
      const isWknd = (day === 5 && hr >= 22) || day === 6 || (day === 0 && hr < 20);
      return !isWknd;
    });
  }

  // 🛡️ Quant Shield Rule 3: Macro HTF Bias Guard
  if (options.enforceHtfBiasGuard) {
    executedSetups = executedSetups.filter((s) => {
      return s.is_valuation_aligned !== false;
    });
  }

  let candidateSetups = executedSetups;

  // 🛡️ Quant Shield Rule 1: Multi-Anchor Wave Deduplication & Single-Position Walking
  const enableWaveDedup = options.enableWaveDeduplication === true;
  let waveDeduplicated: SweepReclaimSetup[] = [];

  if (enableWaveDedup) {
    // 2A. Cluster setups triggered on the exact same displacement wave (using wave_fingerprint if available)
    const waveMap = new Map<string, SweepReclaimSetup[]>();
    for (const s of candidateSetups) {
      const waveKey = s.wave_fingerprint || `${s.reclaim_time || s.sweep_time || s.anchor_time}_${s.type}`;
      if (!waveMap.has(waveKey)) {
        waveMap.set(waveKey, []);
      }
      waveMap.get(waveKey)!.push(s);
    }

    for (const [_, cluster] of waveMap.entries()) {
      if (cluster.length === 1) {
        waveDeduplicated.push(cluster[0]);
      } else {
        // Real-world Market Physics: When multiple limit orders rest on the same wave,
        // - For Shorts: Lower entry price is closer to market and is touched/filled FIRST as price rallies.
        // - For Longs: Higher entry price is closer to market and is touched/filled FIRST as price dips.
        cluster.sort((a, b) => {
          if (a.type === 'BEARISH') {
            if (Math.abs(a.entry_price - b.entry_price) > 0.01) {
              return a.entry_price - b.entry_price; // Lowest entry price touched first
            }
          } else {
            if (Math.abs(a.entry_price - b.entry_price) > 0.01) {
              return b.entry_price - a.entry_price; // Highest entry price touched first
            }
          }

          // Primary tie-breaker: Anchor level proximity to current market price
          // - For Shorts: Lower anchor level is closer to market and touched first as price rallies
          // - For Longs: Higher anchor level is closer to market and touched first as price dips
          if (a.type === 'BEARISH') {
            if (Math.abs(a.anchor_level - b.anchor_level) > 0.01) {
              return a.anchor_level - b.anchor_level;
            }
          } else {
            if (Math.abs(a.anchor_level - b.anchor_level) > 0.01) {
              return b.anchor_level - a.anchor_level;
            }
          }

          // Secondary tie-breaker: Anchor tier ranking
          const pA = getAnchorPriority(a.anchor_type, a.anchor_swing_grade);
          const pB = getAnchorPriority(b.anchor_type, b.anchor_swing_grade);
          if (pB !== pA) return pB - pA;

          const depthA = a.sweep_depth_pct ?? 0;
          const depthB = b.sweep_depth_pct ?? 0;
          return depthB - depthA;
        });
        // Select the single Champion Setup for this displacement wave
        waveDeduplicated.push(cluster[0]);
      }
    }
  } else {
    waveDeduplicated = [...candidateSetups];
  }

  // Sort chronologically by retest entry time, tiebreak by entry price proximity to market (identical to AutomatedStrategyExecutionEngine)
  waveDeduplicated.sort((a, b) => {
    const timeA = a.retest_time || a.reclaim_time || a.sweep_time || a.anchor_time || 0;
    const timeB = b.retest_time || b.reclaim_time || b.sweep_time || b.anchor_time || 0;
    if (timeA !== timeB) return timeA - timeB;

    // 🛡️ Market Physics Sorting: When multiple candidate setups have the exact same retest time,
    // sort by price proximity to market so that the entry closest to current price is evaluated first:
    // - For SHORT: Lowest entry price is closest to market and fills first.
    // - For LONG: Highest entry price is closest to market and fills first.
    if (a.type === 'BEARISH' && b.type === 'BEARISH') {
      if (Math.abs(a.entry_price - b.entry_price) > 0.01) {
        return a.entry_price - b.entry_price;
      }
    } else if (a.type === 'BULLISH' && b.type === 'BULLISH') {
      if (Math.abs(a.entry_price - b.entry_price) > 0.01) {
        return b.entry_price - a.entry_price;
      }
    }

    const pA = getAnchorPriority(a.anchor_type, a.anchor_swing_grade);
    const pB = getAnchorPriority(b.anchor_type, b.anchor_swing_grade);
    if (pB !== pA) return pB - pA;

    const depthA = a.sweep_depth_pct ?? 0;
    const depthB = b.sweep_depth_pct ?? 0;
    return depthB - depthA;
  });

  // 2B. Sequential Single-Position Lifecycle Walk & 🛡️ Rule 5 Post-Loss Cooldown
  if (options.enforceSinglePositionWalk !== false) {
    const sequentialSetups: SweepReclaimSetup[] = [];
    let lastExitTimestamp = 0;
    let lastOpenTimestamp = 0;
    let lastTradeWasLoss = false;
    const cooldownMs = (typeof options.postLossCooldownMinutes === 'number' ? options.postLossCooldownMinutes : 0) * 60 * 1000;

    for (const s of waveDeduplicated) {
      const openTime = s.retest_time || s.reclaim_time || s.sweep_time || s.anchor_time || 0;
      const isPending = s.simulated_outcome === 'PENDING' || s.exit_time === null;
      const exitTime = isPending ? Infinity : (s.exit_time || (openTime + 15 * 60 * 1000));

      const isSameTimestamp = lastOpenTimestamp !== 0 && openTime === lastOpenTimestamp;
      const isOverlapping = lastExitTimestamp !== 0 && openTime < lastExitTimestamp;

      // 🛡️ Rule 5: Check post-loss cooldown
      let inPostLossCooldown = false;
      if (cooldownMs > 0 && lastTradeWasLoss && lastExitTimestamp !== 0 && lastExitTimestamp !== Infinity) {
        if (openTime < lastExitTimestamp + cooldownMs) {
          inPostLossCooldown = true;
        }
      }

      if (!isSameTimestamp && !isOverlapping && !inPostLossCooldown) {
        sequentialSetups.push(s);
        lastExitTimestamp = Math.max(lastExitTimestamp, exitTime);
        lastOpenTimestamp = openTime;
        lastTradeWasLoss = !isPending && (typeof s.realized_rr === 'number' ? s.realized_rr : 0) < 0;
      }
    }

    candidateSetups = sequentialSetups;
  } else {
    candidateSetups = waveDeduplicated;
  }

  // 3. Map into Standardized Executed Trade Objects
  const enableEarlyBE = options.enableEarlyBreakeven === true;
  const earlyBEMultiple = typeof options.earlyBreakevenMultiple === 'number' ? options.earlyBreakevenMultiple : 0.60;

  const executedTrades: StandardizedExecutedTrade[] = candidateSetups.map((s) => {
    const timestamp = s.retest_time || s.reclaim_time || s.sweep_time || s.anchor_time || Date.now();
    const isPending = s.simulated_outcome === 'PENDING' || s.exit_time === null;
    let realizedR = typeof s.realized_rr === 'number' ? s.realized_rr : 0;
    let outcome: string = isPending
      ? 'PENDING'
      : (s.stage_exit_type || s.simulated_outcome || (realizedR > 0 ? 'FULL_TP2_WIN' : realizedR === 0 ? 'BE_SCRATCH_WIN' : 'STOPPED_OUT'));

    // Note: Early Breakeven MUST be simulated candle-by-candle inside SweepReclaimEngine
    // using the Next-Bar Ratchet Rule to account for both saved losses AND scratched winners.
    // Post-facto modification of realizedR here is strictly prohibited per AGENTS.md Parity Mandate.

    const isWin = !isPending && realizedR > 0;
    const isLoss = !isPending && realizedR < 0;
    const isScratch = !isPending && realizedR === 0;

    return {
      id: s.id,
      timestamp,
      dateStr: formatCairoDateTime(timestamp),
      symbol: s.symbol || 'ETHUSDC',
      direction: s.type,
      entryPrice: s.entry_price,
      stopLossPrice: s.stop_loss,
      exitPrice: s.exit_price,
      realizedR,
      outcome,
      isWin,
      isLoss,
      isScratch,
      label: s.anchor_name ? `S&R (${s.anchor_name})` : `S&R (${s.anchor_type || 'Pivot'})`,
      metadata: {
        anchorType: s.anchor_type,
        anchorLevel: s.anchor_level,
        stageExitType: outcome,
        mfeR: s.mfe_r,
        maeR: s.mae_r,
        anchorSwingGrade: s.anchor_swing_grade,
        entryMode: s.entry_mode,
        isStage1Filled: s.is_stage1_filled,
        isStage2Filled: s.is_stage2_filled,
        isStage3Filled: s.is_stage3_filled,
        exitTime: s.exit_time || null,
      },
    };
  });

  // Sort strictly ascending by execution timestamp
  return executedTrades.sort((a, b) => a.timestamp - b.timestamp);
}

// ── 1:1 Institutional PM2 Execution Telemetry & Guardrail Audit ───────────────

export type ExecutionDisposition =
  | 'EXECUTED'
  | 'NO_RETEST'
  | 'VETOED_CONCURRENCY'
  | 'VETOED_COOLDOWN'
  | 'VETOED_DIRECTIONAL'
  | 'CANCELLED_PRE_FILL'
  | 'EXPIRED_TTL';

export interface AnnotatedSetupDisposition {
  setup: SweepReclaimSetup;
  disposition: ExecutionDisposition;
  reason: string;
  badgeLabel: string;
  badgeColor: 'emerald' | 'rose' | 'amber' | 'slate' | 'purple';
  matchedTrade?: StandardizedExecutedTrade;
}

export interface ReconciledExecutionSummary {
  totalScannedSetups: number;
  totalExecutedTrades: number;
  totalWinningTrades: number;
  totalLosingTrades: number;
  totalBeScratches: number;
  executionWinRatePct: number;
  winRateExScratchPct: number;
  totalRealizedR: number;
  avgRealizedR: number;
  profitFactor: number;
  maxDrawdownR: number;
  vetoedBreakdown: {
    unretestedCount: number;
    concurrencyVetoCount: number;
    directionalVetoCount: number;
    cooldownVetoCount: number;
  };
  annotatedSetups: AnnotatedSetupDisposition[];
  executedTrades: StandardizedExecutedTrade[];
}

/**
 * Pure function that calculates high-fidelity 1:1 Live PM2 execution metrics
 * across candidate setups by strictly honoring institutional risk guardrails:
 * - Single position concurrency lock (maxOpenPositions: 1)
 * - Directional conflict vetoes (no long while holding short)
 * - Retest pullbacks vs missed target expansions
 * - Post-loss cooldown gating
 */
export function calculate1to1ExecutionTelemetry(
  setups: SweepReclaimSetup[],
  options: AdaptSweepReclaimOptions = {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: true,
    filterWeekend: false,
    enforceHtfBiasGuard: false,
    enableEarlyBreakeven: true,
    earlyBreakevenMultiple: 0.40,
    postLossCooldownMinutes: 0,
  }
): ReconciledExecutionSummary {
  if (!setups || setups.length === 0) {
    return {
      totalScannedSetups: 0,
      totalExecutedTrades: 0,
      totalWinningTrades: 0,
      totalLosingTrades: 0,
      totalBeScratches: 0,
      executionWinRatePct: 0,
      winRateExScratchPct: 0,
      totalRealizedR: 0,
      avgRealizedR: 0,
      profitFactor: 0,
      maxDrawdownR: 0,
      vetoedBreakdown: {
        unretestedCount: 0,
        concurrencyVetoCount: 0,
        directionalVetoCount: 0,
        cooldownVetoCount: 0,
      },
      annotatedSetups: [],
      executedTrades: [],
    };
  }

  const executedTrades = adaptSweepReclaimSetupsToTrades(setups, options);
  const executedTradeIds = new Set(executedTrades.map((t) => t.id));
  const executedTradeMap = new Map(executedTrades.map((t) => [t.id, t]));

  const nonExecutionOutcomes = [
    'NO_RETEST',
    'PENDING',
    'EXPIRED',
    'SWEPT_NO_RECLAIM',
    'ANCHOR_ONLY',
    'INVALIDATED',
    'INVALIDATED_AT_RETEST',
  ];

  let unretestedCount = 0;
  let concurrencyVetoCount = 0;
  let directionalVetoCount = 0;
  let cooldownVetoCount = 0;

  const annotatedSetups: AnnotatedSetupDisposition[] = setups.map((s) => {
    // 1. If executed
    if (executedTradeIds.has(s.id)) {
      const matchedTrade = executedTradeMap.get(s.id);
      const isPending = matchedTrade?.outcome === 'PENDING';
      return {
        setup: s,
        disposition: 'EXECUTED',
        reason: isPending ? '1:1 PM2 In-Flight Active Position' : '1:1 PM2 Order Filled & Managed',
        badgeLabel: isPending ? '1:1 PM2 IN-FLIGHT' : '1:1 PM2 FILLED',
        badgeColor: 'emerald',
        matchedTrade,
      };
    }

    // 2. If never pulled back / retested
    const isNonExecution =
      !s.simulated_outcome ||
      nonExecutionOutcomes.includes(s.simulated_outcome as string) ||
      !s.is_retested ||
      s.status === 'RECLAIMED_NO_RETEST';

    if (isNonExecution) {
      unretestedCount++;
      return {
        setup: s,
        disposition: 'NO_RETEST',
        reason: 'Price swept & reclaimed but never pulled back to Limit Entry',
        badgeLabel: 'NO RETEST',
        badgeColor: 'slate',
      };
    }

    // 3. Retested, but vetoed during the sequential execution walk
    const sTime = s.retest_time || s.reclaim_time || s.sweep_time || s.anchor_time || 0;
    const overlappingActiveTrade = executedTrades.find((t) => {
      const tOpen = t.timestamp;
      const isPending = t.outcome === 'PENDING' || !t.metadata?.exitTime;
      const tExit = isPending ? Infinity : (t.metadata?.exitTime ?? tOpen + 60 * 60 * 1000);
      return sTime >= tOpen && sTime <= tExit;
    });

    if (overlappingActiveTrade) {
      concurrencyVetoCount++;
      const isOpposing = overlappingActiveTrade.direction !== s.type;
      const activeDirLabel = overlappingActiveTrade.direction === 'BULLISH' ? 'LONG' : 'SHORT';
      if (isOpposing) {
        directionalVetoCount++;
        return {
          setup: s,
          disposition: 'VETOED_DIRECTIONAL',
          reason: `Guardrail 3: Blocked because an opposing ${activeDirLabel} position was active`,
          badgeLabel: 'VETO: OPPOSING LOCK',
          badgeColor: 'rose',
        };
      }
      return {
        setup: s,
        disposition: 'VETOED_CONCURRENCY',
        reason: `Guardrail 2: Blocked because an active ${activeDirLabel} position was already open`,
        badgeLabel: 'VETO: ACTIVE POSITION',
        badgeColor: 'rose',
      };
    }

    // Default concurrency / cooldown veto
    concurrencyVetoCount++;
    return {
      setup: s,
      disposition: 'VETOED_CONCURRENCY',
      reason: 'Guardrail 2: Single-position concurrency limit reached',
      badgeLabel: 'VETO: CONCURRENCY',
      badgeColor: 'amber',
    };
  });

  // Calculate high-fidelity institutional performance metrics strictly on closed trades
  const closedTrades = executedTrades.filter((t) => t.outcome !== 'PENDING');
  const totalExecutedTrades = closedTrades.length;
  const totalWinningTrades = closedTrades.filter((t) => t.isWin).length;
  const totalLosingTrades = closedTrades.filter((t) => t.isLoss).length;
  const totalBeScratches = closedTrades.filter((t) => t.isScratch).length;

  const executionWinRatePct =
    totalExecutedTrades > 0
      ? parseFloat(((totalWinningTrades / totalExecutedTrades) * 100).toFixed(1))
      : 0;

  const closedWithoutScratch = totalWinningTrades + totalLosingTrades;
  const winRateExScratchPct =
    closedWithoutScratch > 0
      ? parseFloat(((totalWinningTrades / closedWithoutScratch) * 100).toFixed(1))
      : executionWinRatePct;

  const totalRealizedR = parseFloat(
    closedTrades.reduce((acc, t) => acc + (t.realizedR || 0), 0).toFixed(2)
  );
  const avgRealizedR =
    totalExecutedTrades > 0
      ? parseFloat((totalRealizedR / totalExecutedTrades).toFixed(2))
      : 0;

  const grossWinR = closedTrades
    .filter((t) => t.isWin)
    .reduce((acc, t) => acc + t.realizedR, 0);
  const grossLossR = Math.abs(
    closedTrades
      .filter((t) => t.isLoss)
      .reduce((acc, t) => acc + t.realizedR, 0)
  );
  const profitFactor =
    grossLossR > 0
      ? parseFloat((grossWinR / grossLossR).toFixed(2))
      : grossWinR > 0
      ? 99.9
      : 0;

  // Max Drawdown in R
  let peakR = 0;
  let runningR = 0;
  let maxDrawdownR = 0;
  for (const t of executedTrades) {
    runningR += t.realizedR || 0;
    if (runningR > peakR) peakR = runningR;
    const dd = peakR - runningR;
    if (dd > maxDrawdownR) maxDrawdownR = dd;
  }
  maxDrawdownR = parseFloat(maxDrawdownR.toFixed(2));

  return {
    totalScannedSetups: setups.length,
    totalExecutedTrades,
    totalWinningTrades,
    totalLosingTrades,
    totalBeScratches,
    executionWinRatePct,
    winRateExScratchPct,
    totalRealizedR,
    avgRealizedR,
    profitFactor,
    maxDrawdownR,
    vetoedBreakdown: {
      unretestedCount,
      concurrencyVetoCount,
      directionalVetoCount,
      cooldownVetoCount,
    },
    annotatedSetups,
    executedTrades,
  };
}

// ── Order Block Trade Adapter ─────────────────────────────────────────────────

export function adaptOrderBlocksToTrades(
  orderBlocks: InstitutionalOrderBlock[]
): StandardizedExecutedTrade[] {
  if (!orderBlocks || orderBlocks.length === 0) return [];

  const executedTrades: StandardizedExecutedTrade[] = [];

  for (const ob of orderBlocks) {
    // 1. Primary OB Mitigation Trade
    const validMitigationOutcomes = [
      'FULL_TP2_WIN', 'BE_SCRATCH_WIN', 'STOPPED_OUT', 'WIN', 'LOSS',
      'STAGE_1_SCRATCH', 'STAGE_2_WIN', 'FULL_TP3_WIN'
    ];

    const isMitigated =
      (ob.mitigation_time !== null ||
        ob.lifecycle_status === 'MITIGATED_RESPECTED' ||
        ob.lifecycle_status === 'MEAN_THRESHOLD_VIOLATED') &&
      validMitigationOutcomes.includes(ob.simulated_outcome as string) &&
      ob.lifecycle_status !== 'UNTESTED' &&
      ob.lifecycle_status !== 'EXPIRED_STALE' &&
      ob.lifecycle_status !== 'ZONE_INVALIDATED';

    if (isMitigated) {
      const timestamp = ob.mitigation_time || ob.first_test_time || ob.formation_time || Date.now();
      const realizedR = typeof ob.realized_rr === 'number' ? ob.realized_rr : 0;
      const isWin = realizedR > 0;
      const isLoss = realizedR < 0;
      const isScratch = realizedR === 0;

      executedTrades.push({
        id: ob.id,
        timestamp,
        dateStr: formatCairoDateTime(timestamp),
        symbol: ob.symbol || 'ETHUSDC',
        direction: ob.type,
        entryPrice: ob.simulated_entry_price || ob.mean_threshold,
        stopLossPrice: ob.simulated_stop_loss || (ob.type === 'BULLISH' ? ob.bottom : ob.top),
        realizedR,
        outcome: ob.stage_exit_type || ob.simulated_outcome,
        isWin,
        isLoss,
        isScratch,
        label: `${ob.type} OB (${ob.quality_tier})`,
        metadata: {
          qualityTier: ob.quality_tier,
          confluenceScore: ob.confluence_score,
          lifecycleStatus: ob.lifecycle_status,
          isFresh: ob.is_fresh_mitigation,
          meanThreshold: ob.mean_threshold,
        }
      });
    }

    // 2. Inverted Breaker Block Trade (if triggered & tested)
    const isExecutedBreaker =
      ob.is_breaker === true &&
      ob.breaker_retest_time !== null &&
      (ob.breaker_trade_outcome === 'WIN' || ob.breaker_trade_outcome === 'LOSS');

    if (isExecutedBreaker) {
      const breakerTimestamp = ob.breaker_retest_time || ob.breaker_flip_time || ob.formation_time || Date.now();
      const breakerRealizedR = typeof ob.breaker_realized_rr === 'number' ? ob.breaker_realized_rr : 0;
      const breakerDirection = ob.type === 'BULLISH' ? 'BEARISH' : 'BULLISH';
      const breakerIsWin = breakerRealizedR > 0;
      const breakerIsLoss = breakerRealizedR < 0;

      executedTrades.push({
        id: `${ob.id}_BRK`,
        timestamp: breakerTimestamp,
        dateStr: formatCairoDateTime(breakerTimestamp),
        symbol: ob.symbol || 'ETHUSDC',
        direction: breakerDirection,
        entryPrice: ob.breaker_entry_price || ob.mean_threshold,
        stopLossPrice: ob.breaker_stop_loss || (ob.type === 'BULLISH' ? ob.top : ob.bottom),
        realizedR: breakerRealizedR,
        outcome: ob.breaker_trade_outcome === 'WIN' ? 'BREAKER_WIN' : 'BREAKER_LOSS',
        isWin: breakerIsWin,
        isLoss: breakerIsLoss,
        isScratch: breakerRealizedR === 0,
        label: `Inverted ${ob.type === 'BULLISH' ? 'Bearish' : 'Bullish'} Breaker`,
        metadata: {
          isBreaker: true,
          breakerConfirmed: ob.breaker_is_confirmed,
          breakerConfirmationType: ob.breaker_confirmation_type,
          parentObId: ob.id,
        }
      });
    }
  }

  // Sort strictly ascending by execution timestamp
  return executedTrades.sort((a, b) => a.timestamp - b.timestamp);
}

// ── Dual Compounding Engine Calculation ───────────────────────────────────────

export interface CalculateCompoundingOptions {
  initialCapital?: number;       // default 10,000
  riskPerTradePct?: number;      // default 1.5
  compoundingMode?: 'DYNAMIC_COMPOUNDING' | 'FIXED_FRACTIONAL'; // default DYNAMIC_COMPOUNDING
}

export function calculateCompoundingMetrics(
  trades: StandardizedExecutedTrade[],
  options: CalculateCompoundingOptions = {}
): CompoundingMetricsSummary {
  const initialCapital = Math.max(100, options.initialCapital ?? 10000);
  const riskPerTradePct = Math.max(0.01, Math.min(50, options.riskPerTradePct ?? 1.5));
  const compoundingMode = options.compoundingMode ?? 'DYNAMIC_COMPOUNDING';

  const totalExecutedTrades = trades.length;

  if (totalExecutedTrades === 0) {
    const startPoint: SequentialEquityPoint = {
      tradeIndex: 0,
      tradeId: 'START',
      timestamp: Date.now(),
      dateStr: formatCairoDateTime(Date.now()),
      equity: initialCapital,
      peakEquity: initialCapital,
      drawdownPct: 0,
      drawdownUsd: 0,
      riskUsd: 0,
      pnlUsd: 0,
      realizedR: 0,
      isWin: false,
      isLoss: false,
      isScratch: false,
      outcome: 'START',
      direction: '',
      symbol: '',
      label: 'Initial Capital',
      entryPrice: 0,
      stopLossPrice: 0,
    };

    return {
      totalExecutedTrades: 0,
      winningTradesCount: 0,
      losingTradesCount: 0,
      scratchTradesCount: 0,
      executionWinRatePct: 0,
      executionLossRatePct: 0,
      executionScratchRatePct: 0,
      avgWinningR: 0,
      avgLosingR: 0,
      avgRealizedR: 0,
      realizedWinLossAsymmetryRatio: 0,
      expectedValueR: 0,
      theoreticalFinalEquity: initialCapital,
      theoreticalNetRoiPct: 0,
      theoreticalNetPnlUsd: 0,
      initialCapital,
      riskPerTradePct,
      compoundingMode,
      finalRealizedEquity: initialCapital,
      realizedNetPnlUsd: 0,
      realizedNetRoiPct: 0,
      maxDrawdownPct: 0,
      maxDrawdownUsd: 0,
      grossProfitUsd: 0,
      grossLossUsd: 0,
      profitFactor: 0,
      longestWinStreak: 0,
      longestLossStreak: 0,
      currentStreakType: 'NONE',
      currentStreakCount: 0,
      equityCurvePoints: [startPoint],
    };
  }

  // 1. Classify trades
  const winningTrades = trades.filter((t) => t.realizedR > 0);
  const losingTrades = trades.filter((t) => t.realizedR < 0);
  const scratchTrades = trades.filter((t) => t.realizedR === 0);

  const winningTradesCount = winningTrades.length;
  const losingTradesCount = losingTrades.length;
  const scratchTradesCount = scratchTrades.length;

  const winRate = winningTradesCount / totalExecutedTrades;
  const lossRate = losingTradesCount / totalExecutedTrades;
  const scratchRate = scratchTradesCount / totalExecutedTrades;

  const executionWinRatePct = parseFloat((winRate * 100).toFixed(2));
  const executionLossRatePct = parseFloat((lossRate * 100).toFixed(2));
  const executionScratchRatePct = parseFloat((scratchRate * 100).toFixed(2));

  // 2. Compute R-Multiple averages
  const totalWinningR = winningTrades.reduce((sum, t) => sum + t.realizedR, 0);
  const totalLosingR = losingTrades.reduce((sum, t) => sum + Math.abs(t.realizedR), 0);
  const sumRealizedR = trades.reduce((sum, t) => sum + t.realizedR, 0);

  const avgWinningR = winningTradesCount > 0 ? parseFloat((totalWinningR / winningTradesCount).toFixed(2)) : 0;
  const avgLosingR = losingTradesCount > 0 ? parseFloat((totalLosingR / losingTradesCount).toFixed(2)) : 0;
  const avgRealizedR = parseFloat((sumRealizedR / totalExecutedTrades).toFixed(2));

  const realizedWinLossAsymmetryRatio = avgLosingR > 0 ? parseFloat((avgWinningR / avgLosingR).toFixed(2)) : avgWinningR;

  // 3. Approach A: Theoretical Closed Expectancy
  // EV_R = (WinRate * AvgWinR) - (LossRate * AvgLossR)
  const expectedValueR = parseFloat(((winRate * avgWinningR) - (lossRate * avgLosingR)).toFixed(3));

  // Theoretical standard fractional capital growth across trade count:
  // Growth Factor per trade = (1 + (RiskPct/100) * EV_R)
  const growthMultiplier = 1 + (riskPerTradePct / 100) * expectedValueR;
  const theoreticalFinalEquity = parseFloat(
    (initialCapital * Math.pow(Math.max(0.01, growthMultiplier), totalExecutedTrades)).toFixed(2)
  );
  const theoreticalNetPnlUsd = parseFloat((theoreticalFinalEquity - initialCapital).toFixed(2));
  const theoreticalNetRoiPct = parseFloat(((theoreticalNetPnlUsd / initialCapital) * 100).toFixed(2));

  // 4. Approach B: Path-Dependent Sequential Walk
  const equityCurvePoints: SequentialEquityPoint[] = [];

  // Start point
  const firstTimestamp = trades[0].timestamp;
  const startTimestamp = firstTimestamp - 3600000; // 1 hour prior
  let runningEquity = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdownPct = 0;
  let maxDrawdownUsd = 0;
  let grossProfitUsd = 0;
  let grossLossUsd = 0;

  equityCurvePoints.push({
    tradeIndex: 0,
    tradeId: 'START',
    timestamp: startTimestamp,
    dateStr: formatCairoDateTime(startTimestamp),
    equity: runningEquity,
    peakEquity,
    drawdownPct: 0,
    drawdownUsd: 0,
    riskUsd: 0,
    pnlUsd: 0,
    realizedR: 0,
    isWin: false,
    isLoss: false,
    isScratch: false,
    outcome: 'START',
    direction: '',
    symbol: '',
    label: 'Initial Capital Base',
    entryPrice: 0,
    stopLossPrice: 0,
  });

  // Streaks Tracking
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;

  for (let i = 0; i < totalExecutedTrades; i++) {
    const trade = trades[i];
    const tradeIdx = i + 1;

    // Calculate risk dollar allocation for trade i
    const riskUsd = compoundingMode === 'DYNAMIC_COMPOUNDING'
      ? runningEquity * (riskPerTradePct / 100)
      : initialCapital * (riskPerTradePct / 100);

    const pnlUsd = parseFloat((riskUsd * trade.realizedR).toFixed(2));
    runningEquity = parseFloat(Math.max(0, runningEquity + pnlUsd).toFixed(2));

    if (pnlUsd > 0) {
      grossProfitUsd += pnlUsd;
      currentWinStreak += 1;
      currentLossStreak = 0;
      if (currentWinStreak > longestWinStreak) longestWinStreak = currentWinStreak;
    } else if (pnlUsd < 0) {
      grossLossUsd += Math.abs(pnlUsd);
      currentLossStreak += 1;
      currentWinStreak = 0;
      if (currentLossStreak > longestLossStreak) longestLossStreak = currentLossStreak;
    } else {
      // Breakeven / Scratch
      currentWinStreak = 0;
      currentLossStreak = 0;
    }

    if (runningEquity > peakEquity) {
      peakEquity = runningEquity;
    }

    const drawdownUsd = parseFloat((peakEquity - runningEquity).toFixed(2));
    const drawdownPct = peakEquity > 0 ? parseFloat(((drawdownUsd / peakEquity) * 100).toFixed(2)) : 0;

    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;
    if (drawdownUsd > maxDrawdownUsd) maxDrawdownUsd = drawdownUsd;

    equityCurvePoints.push({
      tradeIndex: tradeIdx,
      tradeId: trade.id,
      timestamp: trade.timestamp,
      dateStr: trade.dateStr,
      equity: runningEquity,
      peakEquity,
      drawdownPct,
      drawdownUsd,
      riskUsd: parseFloat(riskUsd.toFixed(2)),
      pnlUsd,
      realizedR: trade.realizedR,
      isWin: trade.isWin,
      isLoss: trade.isLoss,
      isScratch: trade.isScratch,
      outcome: trade.outcome,
      direction: trade.direction,
      symbol: trade.symbol,
      label: trade.label,
      entryPrice: trade.entryPrice,
      stopLossPrice: trade.stopLossPrice,
      exitPrice: trade.exitPrice,
    });
  }

  const finalRealizedEquity = runningEquity;
  const realizedNetPnlUsd = parseFloat((finalRealizedEquity - initialCapital).toFixed(2));
  const realizedNetRoiPct = parseFloat(((realizedNetPnlUsd / initialCapital) * 100).toFixed(2));
  const profitFactor = grossLossUsd > 0
    ? parseFloat((grossProfitUsd / grossLossUsd).toFixed(2))
    : grossProfitUsd > 0 ? 99.9 : 0;

  // Determine current active streak
  let currentStreakType: 'WIN' | 'LOSS' | 'NONE' = 'NONE';
  let currentStreakCount = 0;
  if (currentWinStreak > 0) {
    currentStreakType = 'WIN';
    currentStreakCount = currentWinStreak;
  } else if (currentLossStreak > 0) {
    currentStreakType = 'LOSS';
    currentStreakCount = currentLossStreak;
  }

  return {
    totalExecutedTrades,
    winningTradesCount,
    losingTradesCount,
    scratchTradesCount,
    executionWinRatePct,
    executionLossRatePct,
    executionScratchRatePct,
    avgWinningR,
    avgLosingR,
    avgRealizedR,
    realizedWinLossAsymmetryRatio,
    expectedValueR,
    theoreticalFinalEquity,
    theoreticalNetRoiPct,
    theoreticalNetPnlUsd,
    initialCapital,
    riskPerTradePct,
    compoundingMode,
    finalRealizedEquity,
    realizedNetPnlUsd,
    realizedNetRoiPct,
    maxDrawdownPct: parseFloat(maxDrawdownPct.toFixed(2)),
    maxDrawdownUsd: parseFloat(maxDrawdownUsd.toFixed(2)),
    grossProfitUsd: parseFloat(grossProfitUsd.toFixed(2)),
    grossLossUsd: parseFloat(grossLossUsd.toFixed(2)),
    profitFactor,
    longestWinStreak,
    longestLossStreak,
    currentStreakType,
    currentStreakCount,
    equityCurvePoints,
  };
}

// ── SVG Path Derivation Helper ────────────────────────────────────────────────

export interface SvgEquityPathData {
  equityPathD: string;
  areaPathD: string;
  peakPathD: string;
  baselineY: number;
  minVal: number;
  maxVal: number;
  points: { x: number; y: number; point: SequentialEquityPoint }[];
}

export function generateSvgEquityPaths(
  points: SequentialEquityPoint[],
  width: number = 800,
  height: number = 240,
  padding: { top: number; right: number; bottom: number; left: number } = { top: 20, right: 20, bottom: 30, left: 50 }
): SvgEquityPathData {
  if (!points || points.length === 0) {
    return {
      equityPathD: '',
      areaPathD: '',
      peakPathD: '',
      baselineY: height / 2,
      minVal: 0,
      maxVal: 100,
      points: [],
    };
  }

  const initialCapital = points[0].equity;
  let minEquity = Math.min(...points.map((p) => Math.min(p.equity, p.peakEquity)));
  let maxEquity = Math.max(...points.map((p) => Math.max(p.equity, p.peakEquity)));

  // Add buffer to bounds
  const range = maxEquity - minEquity;
  const buffer = Math.max(range * 0.1, initialCapital * 0.05);
  minEquity = Math.max(0, minEquity - buffer);
  maxEquity = maxEquity + buffer;

  if (maxEquity === minEquity) {
    maxEquity += 100;
    minEquity = Math.max(0, minEquity - 100);
  }

  const chartWidth = Math.max(10, width - padding.left - padding.right);
  const chartHeight = Math.max(10, height - padding.top - padding.bottom);

  const getX = (index: number) => {
    if (points.length <= 1) return padding.left;
    return padding.left + (index / (points.length - 1)) * chartWidth;
  };

  const getY = (val: number) => {
    const norm = (val - minEquity) / (maxEquity - minEquity);
    return padding.top + chartHeight - norm * chartHeight;
  };

  const baselineY = getY(initialCapital);

  // Generate SVG path strings
  let equityPathD = '';
  let peakPathD = '';
  const renderedPoints: { x: number; y: number; point: SequentialEquityPoint }[] = [];

  points.forEach((p, idx) => {
    const x = getX(idx);
    const y = getY(p.equity);
    const peakY = getY(p.peakEquity);

    renderedPoints.push({ x, y, point: p });

    if (idx === 0) {
      equityPathD += `M ${x.toFixed(2)} ${y.toFixed(2)}`;
      peakPathD += `M ${x.toFixed(2)} ${peakY.toFixed(2)}`;
    } else {
      // Linear SVG segment
      equityPathD += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
      peakPathD += ` L ${x.toFixed(2)} ${peakY.toFixed(2)}`;
    }
  });

  // Area under equity curve
  const firstX = getX(0);
  const lastX = getX(points.length - 1);
  const bottomY = padding.top + chartHeight;
  const areaPathD = `${equityPathD} L ${lastX.toFixed(2)} ${bottomY.toFixed(2)} L ${firstX.toFixed(2)} ${bottomY.toFixed(2)} Z`;

  return {
    equityPathD,
    areaPathD,
    peakPathD,
    baselineY,
    minVal: minEquity,
    maxVal: maxEquity,
    points: renderedPoints,
  };
}
