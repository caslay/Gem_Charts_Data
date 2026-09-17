/**
 * src/lib/quantEngine/SetupOutcomeReconciler.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Setup Outcome Reconciliation Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Bridges historical AI evaluation logs (ai_analysis_log) with real-world
 * execution states (agent_decision_log, trades, paper_trades, and session logs).
 *
 * Enforces dynamic lifecycle badging:
 *  - 🟢 ACTIVE_SETUP: Restrict strictly to setups genuinely in-flight or armed within 12-bar TTL.
 *  - 🟢 TP1_HIT / 🟢 TP2_HIT: Realized win with harvested R multiple.
 *  - 🔴 STOPPED_OUT: Closed at invalidation level (-1.0R).
 *  - 🔵 BREAKEVEN: Scratched at entry price.
 *  - 🟡 CANCELLED_PRE_FILL: Target 1 reached or Invalidation breached prior to entry fill.
 *  - ⚪ TTL_EXPIRED: Limit order was never filled and 12-bar TTL expired.
 *  - ⚪ NEUTRAL / STAND_DOWN: Non-directional or dead-zone evaluations.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDbPool } from '../postgres';
import type { AiAnalysisRecord } from '../aiCascadeEngine';
import {
  type SetupReconciledStatus,
  type ReconciledOutcome,
  type EnrichedAiAnalysisRecord,
  type DailyAuditMetrics,
  getCairoDateString,
  getCairoDayRange,
  calculateDailyAuditMetrics,
} from './SetupOutcomeTypes';

export * from './SetupOutcomeTypes';

interface TradeMatchCandidate {
  id: string;
  symbol: string;
  direction: string;
  entryPrice: number;
  exitPrice?: number | null;
  status: string;
  realizedR?: number | null;
  realizedPnl?: number | null;
  openTime: number;
  closeTime?: number | null;
  setupId?: string | null;
}

interface DecisionMatchCandidate {
  id: number;
  symbol: string;
  direction: string;
  entryRangeLow?: number | null;
  entryRangeHigh?: number | null;
  invalidationLevel?: number | null;
  target1?: number | null;
  status: string;
  narrative?: string | null;
  submittedAt: number;
  ttlBars: number;
}


export interface ReconciliationCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  closeTime: number;
}

export interface ReconcileOptions {
  currentPrice?: number | null;
  now?: number;
  skipCandleFetch?: boolean;
  injectedCandles?: ReconciliationCandle[];
}

const candleCache = new Map<string, { candles: ReconciliationCandle[]; fetchedAt: number }>();
const CACHE_TTL_MS = 60 * 1000;

/**
 * Fetches 5m or 15m historical klines from Binance public Futures REST API.
 * Uses 60-second in-memory caching to avoid repeated calls within the same minute.
 */
export async function fetchCandlesForReconciliation(
  symbol: string,
  minTime: number,
  maxTime: number,
  timeframe: string = '5m'
): Promise<ReconciliationCandle[]> {
  const cleanSymbol = (symbol || 'ETHUSDC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const tf = timeframe === '15m' ? '15m' : '5m';
  const roundedMinTime = Math.floor(minTime / 60000) * 60000;
  const cacheKey = `${cleanSymbol}_${tf}_${roundedMinTime}`;

  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.candles;
  }

  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSymbol}&interval=${tf}&startTime=${minTime}&endTime=${maxTime}&limit=1000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!res.ok) {
      if (cleanSymbol.endsWith('USDC')) {
        const altSymbol = cleanSymbol.replace('USDC', 'USDT');
        const altUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${altSymbol}&interval=${tf}&startTime=${minTime}&endTime=${maxTime}&limit=1000`;
        const altRes = await fetch(altUrl, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
        if (altRes.ok) {
          const raw = await altRes.json();
          if (Array.isArray(raw)) {
            const candles: ReconciliationCandle[] = raw.map((k: any) => ({
              openTime: Number(k[0]),
              open: parseFloat(String(k[1])),
              high: parseFloat(String(k[2])),
              low: parseFloat(String(k[3])),
              close: parseFloat(String(k[4])),
              closeTime: Number(k[6]),
            }));
            candleCache.set(cacheKey, { candles, fetchedAt: Date.now() });
            return candles;
          }
        }
      }
      return [];
    }

    const raw = await res.json();
    if (Array.isArray(raw)) {
      const candles: ReconciliationCandle[] = raw.map((k: any) => ({
        openTime: Number(k[0]),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        closeTime: Number(k[6]),
      }));
      candleCache.set(cacheKey, { candles, fetchedAt: Date.now() });
      return candles;
    }
  } catch (err) {
    console.warn('[SetupOutcomeReconciler] Candle fetch non-fatal warning:', err);
  }

  return [];
}

/**
 * Simulates the theoretical market lifecycle (fills, TP1, TP2, SL, Breakeven, and TTL)
 * using forward historical candle telemetry.
 */
export function simulateSyntheticTapeOutcome(params: {
  symbol: string;
  isLong: boolean;
  entryPrice: number;
  invalidation: number;
  target1: number;
  target2: number | null;
  ttlBars: number;
  barMinutes: number;
  recTime: number;
  candles: ReconciliationCandle[];
  now: number;
}): ReconciledOutcome | null {
  const { isLong, entryPrice, invalidation, target1, target2, ttlBars, barMinutes, recTime, candles, now } = params;

  const riskDist = Math.abs(entryPrice - invalidation);
  if (riskDist <= 0 || isNaN(riskDist)) {
    return null;
  }

  const barMs = barMinutes * 60 * 1000;
  const forwardCandles = candles
    .filter((c) => c.closeTime >= recTime || c.openTime + barMs >= recTime)
    .sort((a, b) => a.openTime - b.openTime);

  if (forwardCandles.length === 0) {
    return null;
  }

  let isFilled = false;
  let fillBarIdx = -1;
  let activeStopLoss = invalidation;
  let pendingStopLoss: number | null = null;
  let tp1Hit = false;
  let earlyBreakevenHit = false;
  let peakFavorablePrice = entryPrice;
  let maxAdversePrice = entryPrice;
  const elapsedSinceRec = Math.max(0, now - recTime);

  for (let i = 0; i < forwardCandles.length; i++) {
    const c = forwardCandles[i];
    const barsElapsed = i;

    // Apply pending stop loss ratchet from previous bar (Next-Bar Ratchet Rule)
    if (pendingStopLoss !== null) {
      activeStopLoss = pendingStopLoss;
      pendingStopLoss = null;
    }

    if (!isFilled) {
      // 1. Check TTL expiry before fill
      if (barsElapsed >= ttlBars) {
        return {
          terminal_state: 'TTL_EXPIRED',
          bars_elapsed: ttlBars,
          ttl_bars: ttlBars,
          is_synthetic_evaluation: true,
          outcome_reason: `Synthetic tape: Limit entry ($${entryPrice.toFixed(2)}) was never touched within ${ttlBars} bars (${ttlBars * barMinutes}m TTL expired).`,
        };
      }

      // 2. Check Pre-fill Invalidation breach
      const isSlBreached = isLong ? c.low <= invalidation : c.high >= invalidation;
      if (isSlBreached) {
        return {
          terminal_state: 'CANCELLED_PRE_FILL',
          bars_elapsed: barsElapsed,
          ttl_bars: ttlBars,
          is_synthetic_evaluation: true,
          outcome_reason: `Synthetic tape: Invalidation level ($${invalidation.toFixed(2)}) breached prior to limit entry fill.`,
        };
      }

      // 3. Check Pre-fill Target 1 expansion (missed fill)
      const isTp1PreFill = isLong ? c.high >= target1 : c.low <= target1;
      if (isTp1PreFill) {
        return {
          terminal_state: 'CANCELLED_PRE_FILL',
          bars_elapsed: barsElapsed,
          ttl_bars: ttlBars,
          is_synthetic_evaluation: true,
          outcome_reason: `Synthetic tape: Market expanded directly to Target 1 ($${target1.toFixed(2)}) before limit fill (Missed Expansion).`,
        };
      }

      // 4. Check Limit Fill Touch
      const isLimitTouched = isLong ? c.low <= entryPrice : c.high >= entryPrice;
      if (isLimitTouched) {
        isFilled = true;
        fillBarIdx = i;
        peakFavorablePrice = entryPrice;
        maxAdversePrice = entryPrice;

        // Intra-bar check on fill bar: Did adverse excursion hit SL?
        const sameBarStopHit = isLong ? c.low <= invalidation : c.high >= invalidation;
        if (sameBarStopHit) {
          return {
            terminal_state: 'STOPPED_OUT',
            realized_r: -1.0,
            realized_pnl: null,
            is_synthetic_evaluation: true,
            synthetic_fill_price: entryPrice,
            synthetic_exit_price: invalidation,
            synthetic_mfe_r: 0,
            synthetic_mae_r: -1.0,
            bars_elapsed: barsElapsed,
            ttl_bars: ttlBars,
            outcome_reason: `Synthetic tape: Filled @ $${entryPrice.toFixed(2)} and stopped out at Invalidation ($${invalidation.toFixed(2)}) on bar ${barsElapsed}.`,
          };
        }

        // Record excursion on fill candle
        if (isLong) {
          peakFavorablePrice = Math.max(peakFavorablePrice, c.high);
          maxAdversePrice = Math.min(maxAdversePrice, c.low);
        } else {
          peakFavorablePrice = Math.min(peakFavorablePrice, c.low);
          maxAdversePrice = Math.max(maxAdversePrice, c.high);
        }
      }
      continue;
    }

    // ── Position is in-flight on subsequent bars (i >= fillBarIdx) ──
    const favorable = isLong ? c.high : c.low;
    const adverse = isLong ? c.low : c.high;
    if (isLong) {
      peakFavorablePrice = Math.max(peakFavorablePrice, c.high);
      maxAdversePrice = Math.min(maxAdversePrice, c.low);
    } else {
      peakFavorablePrice = Math.min(peakFavorablePrice, c.low);
      maxAdversePrice = Math.max(maxAdversePrice, c.high);
    }

    const currentMfeR = isLong
      ? (peakFavorablePrice - entryPrice) / riskDist
      : (entryPrice - peakFavorablePrice) / riskDist;

    // Check Stop Loss breach
    const isStopHit = isLong ? adverse <= activeStopLoss : adverse >= activeStopLoss;
    if (isStopHit) {
      if (tp1Hit) {
        // Banked 30% on TP1 (+0.30R), scratched remainder at Breakeven
        return {
          terminal_state: 'BREAKEVEN',
          realized_r: 0.30,
          realized_pnl: null,
          is_synthetic_evaluation: true,
          synthetic_fill_price: entryPrice,
          synthetic_exit_price: activeStopLoss,
          synthetic_mfe_r: parseFloat(currentMfeR.toFixed(2)),
          bars_elapsed: i,
          ttl_bars: ttlBars,
          outcome_reason: `Synthetic tape: Filled @ $${entryPrice.toFixed(2)}, TP1 banked (+0.30R), runner scratched at Breakeven ($${activeStopLoss.toFixed(2)}).`,
        };
      }

      if (earlyBreakevenHit) {
        // Early breakeven ratchet (+0.40R rule) protected scratch
        return {
          terminal_state: 'BREAKEVEN',
          realized_r: 0.0,
          realized_pnl: null,
          is_synthetic_evaluation: true,
          synthetic_fill_price: entryPrice,
          synthetic_exit_price: activeStopLoss,
          synthetic_mfe_r: parseFloat(currentMfeR.toFixed(2)),
          bars_elapsed: i,
          ttl_bars: ttlBars,
          outcome_reason: `Synthetic tape: Filled @ $${entryPrice.toFixed(2)}, Early Breakeven ratchet protected full scratch ($0.00R loss).`,
        };
      }

      // Stopped Out at initial invalidation
      return {
        terminal_state: 'STOPPED_OUT',
        realized_r: -1.0,
        realized_pnl: null,
        is_synthetic_evaluation: true,
        synthetic_fill_price: entryPrice,
        synthetic_exit_price: invalidation,
        synthetic_mfe_r: parseFloat(currentMfeR.toFixed(2)),
        synthetic_mae_r: -1.0,
        bars_elapsed: i,
        ttl_bars: ttlBars,
        outcome_reason: `Synthetic tape: Filled @ $${entryPrice.toFixed(2)}, stopped out at Invalidation ($${invalidation.toFixed(2)}) (-1.00R).`,
      };
    }

    // Check TP2 (Full 2-Stage Win)
    if (target2 !== null) {
      const isTp2Hit = isLong ? favorable >= target2 : favorable <= target2;
      if (isTp2Hit) {
        const tp1R = Math.abs(target1 - entryPrice) / riskDist;
        const tp2R = Math.abs(target2 - entryPrice) / riskDist;
        const totalRealizedR = 0.30 * tp1R + 0.70 * tp2R;

        return {
          terminal_state: 'TP2_HIT',
          realized_r: parseFloat(totalRealizedR.toFixed(2)),
          realized_pnl: null,
          is_synthetic_evaluation: true,
          synthetic_fill_price: entryPrice,
          synthetic_exit_price: target2,
          synthetic_mfe_r: parseFloat(totalRealizedR.toFixed(2)),
          bars_elapsed: i,
          ttl_bars: ttlBars,
          outcome_reason: `Synthetic tape: Full 2-stage harvest completed. TP1 ($${target1.toFixed(2)}) & TP2 ($${target2.toFixed(2)}) filled (+${totalRealizedR.toFixed(2)}R).`,
        };
      }
    }

    // Check TP1 (Stage 1 Harvest)
    if (!tp1Hit) {
      const isTp1Hit = isLong ? favorable >= target1 : favorable <= target1;
      if (isTp1Hit) {
        tp1Hit = true;
        // Next-Bar Ratchet Rule: Ratchet SL to Breakeven on bar i+1
        pendingStopLoss = entryPrice;

        if (target2 === null || target2 === target1) {
          // Single target full exit
          const tp1R = Math.abs(target1 - entryPrice) / riskDist;
          return {
            terminal_state: 'TP1_HIT',
            realized_r: parseFloat(tp1R.toFixed(2)),
            realized_pnl: null,
            is_synthetic_evaluation: true,
            synthetic_fill_price: entryPrice,
            synthetic_exit_price: target1,
            synthetic_mfe_r: parseFloat(tp1R.toFixed(2)),
            bars_elapsed: i,
            ttl_bars: ttlBars,
            outcome_reason: `Synthetic tape: Target 1 ($${target1.toFixed(2)}) harvested successfully (+${tp1R.toFixed(2)}R).`,
          };
        }
      }
    }

    // Early Breakeven Ratchet (+0.40R Rule)
    if (!tp1Hit && !earlyBreakevenHit && currentMfeR >= 0.40) {
      earlyBreakevenHit = true;
      pendingStopLoss = entryPrice;
    }
  }

  // ── End of available candles reached ──
  const finalMfeR = isLong
    ? (peakFavorablePrice - entryPrice) / riskDist
    : (entryPrice - peakFavorablePrice) / riskDist;

  if (isFilled) {
    if (tp1Hit) {
      return {
        terminal_state: 'TP1_HIT',
        realized_r: 0.30,
        is_in_flight: true,
        is_synthetic_evaluation: true,
        synthetic_fill_price: entryPrice,
        synthetic_mfe_r: parseFloat(finalMfeR.toFixed(2)),
        bars_elapsed: forwardCandles.length,
        ttl_bars: ttlBars,
        outcome_reason: `Synthetic tape: TP1 harvested (+0.30R locked), runner actively floating in profit (+${finalMfeR.toFixed(2)}R MFE, SL @ Breakeven).`,
      };
    }

    return {
      terminal_state: 'ACTIVE_SETUP',
      is_in_flight: true,
      is_synthetic_evaluation: true,
      synthetic_fill_price: entryPrice,
      synthetic_mfe_r: parseFloat(finalMfeR.toFixed(2)),
      bars_elapsed: forwardCandles.length,
      ttl_bars: ttlBars,
      outcome_reason: `Synthetic tape: Limit entry filled @ $${entryPrice.toFixed(2)}, position currently in-flight (+${finalMfeR.toFixed(2)}R MFE).`,
    };
  }

  // Never filled: check if still within TTL or expired
  const ttlDurationMs = ttlBars * barMs;
  if (elapsedSinceRec <= ttlDurationMs) {
    const barsElapsed = Math.floor(elapsedSinceRec / barMs);
    return {
      terminal_state: 'ACTIVE_SETUP',
      is_armed: true,
      is_synthetic_evaluation: true,
      bars_elapsed: barsElapsed,
      ttl_bars: ttlBars,
      outcome_reason: `Armed setup within active ${ttlBars}-bar window (${barsElapsed}/${ttlBars} bars elapsed)`,
    };
  }

  return {
    terminal_state: 'TTL_EXPIRED',
    bars_elapsed: ttlBars,
    ttl_bars: ttlBars,
    is_synthetic_evaluation: true,
    outcome_reason: `Synthetic tape: Limit order was never filled and ${ttlBars}-bar TTL expired without execution`,
  };
}

/**
 * Reconciles an array of raw ai_analysis_log records into terminal execution outcomes.
 */
export async function reconcileSetupOutcomes(
  records: AiAnalysisRecord[],
  options: ReconcileOptions = {}
): Promise<EnrichedAiAnalysisRecord[]> {
  if (!records || records.length === 0) return [];

  const now = options.now ?? Date.now();
  const currentPrice = options.currentPrice ?? null;

  // Gather time range for batch context lookup
  const timestamps = records
    .map((r) => new Date(r.created_at).getTime())
    .filter((t) => !isNaN(t));

  const minTime = timestamps.length > 0 ? Math.min(...timestamps) - 5 * 60 * 1000 : now - 24 * 3600 * 1000;
  const maxTime = timestamps.length > 0 ? Math.max(...timestamps) + 6 * 3600 * 1000 : now;

  // 1. Fetch relevant trades from DB & session logs
  const trades = await fetchTradeCandidates(minTime, maxTime);

  // 2. Fetch relevant agent decisions from DB
  const decisions = await fetchDecisionCandidates(minTime, maxTime);

  // 3. Pre-fetch historical candles for ACTIVE_SETUP records to evaluate synthetic tape outcomes
  const candlesBySymbol = new Map<string, ReconciliationCandle[]>();
  const activeRecords = records.filter(
    (r) => (r.status || 'COMPLETED').toUpperCase() === 'ACTIVE_SETUP'
  );

  if (activeRecords.length > 0) {
    if (options.injectedCandles && options.injectedCandles.length > 0) {
      for (const rec of activeRecords) {
        const pairKey = `${(rec.symbol || 'ETHUSDC').toUpperCase()}|${rec.timeframe === '15m' ? '15m' : '5m'}`;
        candlesBySymbol.set(pairKey, options.injectedCandles);
      }
    } else if (!options.skipCandleFetch) {
      const uniquePairs = Array.from(
        new Set(
          activeRecords.map((r) => {
            const sym = (r.symbol || 'ETHUSDC').toUpperCase();
            const tf = r.timeframe === '15m' ? '15m' : '5m';
            return `${sym}|${tf}`;
          })
        )
      );

      await Promise.all(
        uniquePairs.map(async (pairKey) => {
          const [sym, tf] = pairKey.split('|');
          const candles = await fetchCandlesForReconciliation(
            sym,
            minTime - 15 * 60 * 1000,
            maxTime + 12 * 15 * 60 * 1000,
            tf
          );
          candlesBySymbol.set(pairKey, candles);
        })
      );
    }
  }

  // 4. Reconcile each record
  return records.map((rec) => {
    const rawStatus = (rec.status || 'COMPLETED').toUpperCase();
    const evaluatedStatus = rawStatus;

    // Non-ACTIVE_SETUP records retain their natural status
    if (rawStatus !== 'ACTIVE_SETUP') {
      let terminalState: SetupReconciledStatus = 'NEUTRAL';
      let reason = 'Evaluated as Neutral / Stand Down by SOP criteria';

      if (rawStatus.includes('INVALIDAT')) {
        terminalState = 'INVALIDATED';
        reason = 'Invalidated by structure or order flow filter';
      } else if (rawStatus.includes('STAND_DOWN') || rawStatus === 'NEUTRAL') {
        terminalState = 'NEUTRAL';
        reason = 'Neutral market context / Stand Down';
      } else {
        terminalState = rawStatus as SetupReconciledStatus;
      }

      return {
        ...rec,
        evaluated_status: evaluatedStatus,
        reconciled_status: terminalState,
        reconciled_outcome: {
          terminal_state: terminalState,
          outcome_reason: reason,
        },
      };
    }

    // ── ACTIVE_SETUP: Perform Deep Outcome Reconciliation ──
    const recTime = new Date(rec.created_at).getTime();
    const elapsedMs = Math.max(0, now - recTime);
    const barMinutes = rec.timeframe === '15m' ? 15 : 5;
    const ttlBars = 12;
    const ttlDurationMs = ttlBars * barMinutes * 60 * 1000;
    const isWithinTtl = elapsedMs <= ttlDurationMs;

    const dir = (rec.trade_direction || '').toUpperCase();
    const isLong = Boolean(dir.includes('LONG') || rec.bias_signal?.toUpperCase().includes('BULL'));
    const normDir = isLong ? 'LONG' : 'SHORT';

    const entryLow = rec.entry_range_low !== null ? Number(rec.entry_range_low) : null;
    const entryHigh = rec.entry_range_high !== null ? Number(rec.entry_range_high) : null;
    const invalidation = rec.invalidation_level !== null ? Number(rec.invalidation_level) : null;
    const target1 = rec.target_1 !== null ? Number(rec.target_1) : null;
    const target2 = rec.target_2 !== null ? Number(rec.target_2) : null;

    // ── Step A: Check matched filled/in-flight trade ──
    const matchedTrade = findMatchingTrade(trades, {
      symbol: rec.symbol,
      direction: normDir,
      entryLow,
      entryHigh,
      recTime,
      ttlDurationMs,
    });

    if (matchedTrade) {
      if (matchedTrade.status === 'OPEN') {
        return {
          ...rec,
          status: 'ACTIVE_SETUP',
          evaluated_status: evaluatedStatus,
          reconciled_status: 'ACTIVE_SETUP',
          reconciled_outcome: {
            terminal_state: 'ACTIVE_SETUP',
            is_in_flight: true,
            matched_trade_id: matchedTrade.id,
            outcome_reason: `Position actively in-flight on exchange (${matchedTrade.direction} @ $${matchedTrade.entryPrice})`,
          },
        };
      }

      // Closed trade outcome
      const r = matchedTrade.realizedR ?? 0;
      const pnl = matchedTrade.realizedPnl ?? 0;
      const isWin = r > 0;
      const isBreakeven = r === 0 || matchedTrade.status.includes('BREAKEVEN');

      if (isWin) {
        const isTp2 = r >= 1.2 || matchedTrade.status.includes('STAGE_2') || matchedTrade.status.includes('TP2');
        const state: SetupReconciledStatus = isTp2 ? 'TP2_HIT' : 'TP1_HIT';
        const label = isTp2 ? 'Target 2' : 'Target 1';

        return {
          ...rec,
          status: state,
          evaluated_status: evaluatedStatus,
          reconciled_status: state,
          reconciled_outcome: {
            terminal_state: state,
            realized_r: r,
            realized_pnl: pnl,
            matched_trade_id: matchedTrade.id,
            outcome_reason: `${label} harvested successfully (+${r.toFixed(2)}R)`,
          },
        };
      }

      if (isBreakeven) {
        return {
          ...rec,
          status: 'BREAKEVEN',
          evaluated_status: evaluatedStatus,
          reconciled_status: 'BREAKEVEN',
          reconciled_outcome: {
            terminal_state: 'BREAKEVEN',
            realized_r: 0,
            realized_pnl: pnl,
            matched_trade_id: matchedTrade.id,
            outcome_reason: 'Scratched at breakeven after partial or drawdown',
          },
        };
      }

      // Stopped Out
      const stopR = r !== 0 ? r : -1.0;
      return {
        ...rec,
        status: 'STOPPED_OUT',
        evaluated_status: evaluatedStatus,
        reconciled_status: 'STOPPED_OUT',
        reconciled_outcome: {
          terminal_state: 'STOPPED_OUT',
          realized_r: stopR,
          realized_pnl: pnl,
          matched_trade_id: matchedTrade.id,
          outcome_reason: `Stopped out at Invalidation level (${stopR.toFixed(2)}R)`,
        },
      };
    }

    // ── Step B: Check matched agent_decision_log record ──
    const matchedDecision = findMatchingDecision(decisions, {
      symbol: rec.symbol,
      recTime,
      entryLow,
      entryHigh,
    });

    if (matchedDecision) {
      const decStatus = matchedDecision.status.toUpperCase();

      if (decStatus === 'STAND_DOWN') {
        return {
          ...rec,
          status: 'STAND_DOWN',
          evaluated_status: evaluatedStatus,
          reconciled_status: 'STAND_DOWN',
          reconciled_outcome: {
            terminal_state: 'STAND_DOWN',
            outcome_reason: matchedDecision.narrative?.includes('DEADZONE')
              ? 'Stand down: Toxic dead zone window hard-locked execution'
              : 'Stand down: Microstructure condition rejected order placement',
          },
        };
      }

      if (decStatus === 'INVALIDATED') {
        return {
          ...rec,
          status: 'CANCELLED_PRE_FILL',
          evaluated_status: evaluatedStatus,
          reconciled_status: 'CANCELLED_PRE_FILL',
          reconciled_outcome: {
            terminal_state: 'CANCELLED_PRE_FILL',
            outcome_reason: 'Cancelled pre-fill: Invalidation level breached before limit fill',
          },
        };
      }

      if (decStatus.includes('REJECTED') || decStatus.includes('VETO')) {
        return {
          ...rec,
          status: 'CANCELLED_PRE_FILL',
          evaluated_status: evaluatedStatus,
          reconciled_status: 'CANCELLED_PRE_FILL',
          reconciled_outcome: {
            terminal_state: 'CANCELLED_PRE_FILL',
            outcome_reason: 'Cancelled pre-fill: Vetoed by Global Risk Governor or Geometry Gate',
          },
        };
      }
    }

    // ── Step C: Synthetic Tape Outcome Evaluation (Forward Candle Simulation) ──
    const pairKey = `${(rec.symbol || 'ETHUSDC').toUpperCase()}|${rec.timeframe === '15m' ? '15m' : '5m'}`;
    const candles = candlesBySymbol.get(pairKey) || [];

    const limitPriceCandidate =
      (rec.telemetry_data as any)?.limitEntryPrice ??
      (rec.telemetry_data as any)?.limit_entry_price ??
      (typeof entryLow === 'number' && typeof entryHigh === 'number'
        ? (entryLow + entryHigh) / 2
        : entryLow ?? entryHigh);

    if (
      typeof limitPriceCandidate === 'number' &&
      !isNaN(limitPriceCandidate) &&
      limitPriceCandidate > 0 &&
      invalidation !== null &&
      target1 !== null &&
      candles.length > 0
    ) {
      const syntheticOutcome = simulateSyntheticTapeOutcome({
        symbol: rec.symbol,
        isLong,
        entryPrice: limitPriceCandidate,
        invalidation,
        target1,
        target2,
        ttlBars,
        barMinutes,
        recTime,
        candles,
        now,
      });

      if (syntheticOutcome) {
        return {
          ...rec,
          status: syntheticOutcome.terminal_state,
          evaluated_status: evaluatedStatus,
          reconciled_status: syntheticOutcome.terminal_state,
          reconciled_outcome: syntheticOutcome,
        };
      }
    }

    // ── Step D: Decision Fallback & Temporal TTL Fallback ──
    if (matchedDecision) {
      const decStatus = matchedDecision.status.toUpperCase();
      if (decStatus === 'TTL_EXPIRED' || decStatus === 'CANCELLED') {
        const isCancelPreFill =
          matchedDecision.narrative?.includes('STOP_LOSS_BREACHED') ||
          matchedDecision.narrative?.includes('MISSED_TP1');
        const finalState: SetupReconciledStatus = isCancelPreFill ? 'CANCELLED_PRE_FILL' : 'TTL_EXPIRED';
        const reason = isCancelPreFill
          ? 'Cancelled pre-fill: Target reached or SL breached before limit entry'
          : 'TTL expired: Limit order was never filled within 12 bars';

        return {
          ...rec,
          status: finalState,
          evaluated_status: evaluatedStatus,
          reconciled_status: finalState,
          reconciled_outcome: {
            terminal_state: finalState,
            bars_elapsed: ttlBars,
            ttl_bars: ttlBars,
            outcome_reason: reason,
          },
        };
      }

      if (decStatus.includes('ARMED') && isWithinTtl) {
        return {
          ...rec,
          status: 'ACTIVE_SETUP',
          evaluated_status: evaluatedStatus,
          reconciled_status: 'ACTIVE_SETUP',
          reconciled_outcome: {
            terminal_state: 'ACTIVE_SETUP',
            is_armed: true,
            bars_elapsed: Math.floor(elapsedMs / (barMinutes * 60 * 1000)),
            ttl_bars: ttlBars,
            outcome_reason: 'Actively armed in Proximity Radar awaiting trigger confirmation',
          },
        };
      }
    }
    if (isWithinTtl) {
      // Check if immediate live price breached invalidation while armed
      if (currentPrice !== null && invalidation !== null) {
        const isBreached = isLong ? currentPrice <= invalidation : currentPrice >= invalidation;
        if (isBreached) {
          return {
            ...rec,
            status: 'CANCELLED_PRE_FILL',
            evaluated_status: evaluatedStatus,
            reconciled_status: 'CANCELLED_PRE_FILL',
            reconciled_outcome: {
              terminal_state: 'CANCELLED_PRE_FILL',
              outcome_reason: `Cancelled pre-fill: Live price ($${currentPrice.toFixed(2)}) breached invalidation ($${invalidation.toFixed(2)})`,
            },
          };
        }
      }

      // Check if price already reached Target 1 prior to filling entry
      if (currentPrice !== null && target1 !== null) {
        const isTp1Reached = isLong ? currentPrice >= target1 : currentPrice <= target1;
        if (isTp1Reached) {
          return {
            ...rec,
            status: 'CANCELLED_PRE_FILL',
            evaluated_status: evaluatedStatus,
            reconciled_status: 'CANCELLED_PRE_FILL',
            reconciled_outcome: {
              terminal_state: 'CANCELLED_PRE_FILL',
              outcome_reason: `Cancelled pre-fill: Market reached Target 1 ($${target1.toFixed(2)}) before filling entry`,
            },
          };
        }
      }

      // Still actively armed and valid
      const barsElapsed = Math.floor(elapsedMs / (barMinutes * 60 * 1000));
      return {
        ...rec,
        status: 'ACTIVE_SETUP',
        evaluated_status: evaluatedStatus,
        reconciled_status: 'ACTIVE_SETUP',
        reconciled_outcome: {
          terminal_state: 'ACTIVE_SETUP',
          is_armed: true,
          bars_elapsed: barsElapsed,
          ttl_bars: ttlBars,
          outcome_reason: `Armed setup within active ${ttlBars}-bar window (${barsElapsed}/${ttlBars} bars elapsed)`,
        },
      };
    }

    // TTL Has Expired (>12 bars elapsed without an executed trade)
    return {
      ...rec,
      status: 'TTL_EXPIRED',
      evaluated_status: evaluatedStatus,
      reconciled_status: 'TTL_EXPIRED',
      reconciled_outcome: {
        terminal_state: 'TTL_EXPIRED',
        bars_elapsed: ttlBars,
        ttl_bars: ttlBars,
        outcome_reason: `Limit order was never filled and ${ttlBars}-bar TTL expired without execution`,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Private Data Fetching & Matching Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTradeCandidates(minTime: number, maxTime: number): Promise<TradeMatchCandidate[]> {
  const trades: TradeMatchCandidate[] = [];

  // 1. Fetch from PostgreSQL trades table
  try {
    const pool = getDbPool();
    const res = await pool.query(
      `SELECT trade_id, symbol, direction, entry_price, exit_price, status,
              realized_pnl, realized_r, entry_time, exit_time, metadata
       FROM trades
       WHERE entry_time >= $1 AND entry_time <= $2`,
      [new Date(minTime), new Date(maxTime)]
    );

    for (const row of res.rows) {
      let setupId: string | null = null;
      if (row.metadata) {
        const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        setupId = meta?.setupId || null;
      }

      trades.push({
        id: String(row.trade_id),
        symbol: String(row.symbol),
        direction: String(row.direction).toUpperCase(),
        entryPrice: parseFloat(row.entry_price) || 0,
        exitPrice: row.exit_price ? parseFloat(row.exit_price) : null,
        status: String(row.status).toUpperCase(),
        realizedR: row.realized_r !== null ? parseFloat(row.realized_r) : null,
        realizedPnl: row.realized_pnl !== null ? parseFloat(row.realized_pnl) : null,
        openTime: new Date(row.entry_time).getTime(),
        closeTime: row.exit_time ? new Date(row.exit_time).getTime() : null,
        setupId,
      });
    }
  } catch (dbErr) {
    // Database fallback
  }

  // 2. Fetch from local session log file if today matches
  try {
    const today = new Date().toISOString().split('T')[0];
    const sessionLogPath = path.join(process.cwd(), 'run_logs', `live_session_${today}.json`);
    if (fs.existsSync(sessionLogPath)) {
      const raw = fs.readFileSync(sessionLogPath, 'utf8');
      const sessionLog = JSON.parse(raw);

      // Add completed trades
      if (Array.isArray(sessionLog.completedTrades)) {
        for (const t of sessionLog.completedTrades) {
          if (!trades.some((existing) => existing.id === t.id)) {
            trades.push({
              id: t.id,
              symbol: t.symbol || 'ETHUSDC',
              direction: String(t.direction).toUpperCase(),
              entryPrice: t.entryPrice || 0,
              exitPrice: t.exitPrice || null,
              status: String(t.exitReason || 'CLOSED').toUpperCase(),
              realizedR: typeof t.realizedR === 'number' ? t.realizedR : null,
              realizedPnl: typeof t.realizedUsd === 'number' ? t.realizedUsd : null,
              openTime: t.openTime ? new Date(t.openTime).getTime() : Date.now(),
              closeTime: t.closeTime ? new Date(t.closeTime).getTime() : null,
              setupId: t.setupId || null,
            });
          }
        }
      }

      // Add active open positions
      if (Array.isArray(sessionLog.activeInFlightPositions)) {
        for (const pos of sessionLog.activeInFlightPositions) {
          if (!trades.some((existing) => existing.id === pos.id)) {
            trades.push({
              id: pos.id,
              symbol: pos.symbol || 'ETHUSDC',
              direction: String(pos.direction).toUpperCase(),
              entryPrice: pos.entryPrice || 0,
              status: 'OPEN',
              openTime: pos.openTime ? new Date(pos.openTime).getTime() : Date.now(),
              setupId: pos.setupId || null,
            });
          }
        }
      }
    }
  } catch {}

  return trades;
}

async function fetchDecisionCandidates(minTime: number, maxTime: number): Promise<DecisionMatchCandidate[]> {
  const decisions: DecisionMatchCandidate[] = [];

  try {
    const pool = getDbPool();
    const res = await pool.query(
      `SELECT id, symbol, bias_signal, entry_range_low, entry_range_high,
              invalidation_level, target_1, status, narrative, submitted_at, ttl_bars, created_at
       FROM agent_decision_log
       WHERE created_at >= $1 AND created_at <= $2`,
      [new Date(minTime), new Date(maxTime)]
    );

    for (const row of res.rows) {
      const rawBias = String(row.bias_signal || '').toUpperCase();
      const dir = rawBias.includes('BULL') || rawBias.includes('LONG') ? 'LONG' : 'SHORT';

      decisions.push({
        id: Number(row.id),
        symbol: String(row.symbol),
        direction: dir,
        entryRangeLow: row.entry_range_low ? parseFloat(row.entry_range_low) : null,
        entryRangeHigh: row.entry_range_high ? parseFloat(row.entry_range_high) : null,
        invalidationLevel: row.invalidation_level ? parseFloat(row.invalidation_level) : null,
        target1: row.target_1 ? parseFloat(row.target_1) : null,
        status: String(row.status || 'PENDING').toUpperCase(),
        narrative: row.narrative || null,
        submittedAt: row.submitted_at ? Number(row.submitted_at) : new Date(row.created_at).getTime(),
        ttlBars: Number(row.ttl_bars) || 12,
      });
    }
  } catch {}

  return decisions;
}

function findMatchingTrade(
  trades: TradeMatchCandidate[],
  criteria: {
    symbol: string;
    direction: string;
    entryLow: number | null;
    entryHigh: number | null;
    recTime: number;
    ttlDurationMs: number;
  }
): TradeMatchCandidate | null {
  for (const t of trades) {
    if (t.symbol !== criteria.symbol) continue;
    if (t.direction !== criteria.direction) continue;

    // Time window check: trade opened between recTime - 2m and recTime + TTL + 5m
    const openedWithinWindow =
      t.openTime >= criteria.recTime - 2 * 60 * 1000 &&
      t.openTime <= criteria.recTime + criteria.ttlDurationMs + 5 * 60 * 1000;

    if (!openedWithinWindow) continue;

    // Entry price proximity check
    if (criteria.entryLow !== null && criteria.entryHigh !== null) {
      const minEntry = Math.min(criteria.entryLow, criteria.entryHigh) * 0.998;
      const maxEntry = Math.max(criteria.entryLow, criteria.entryHigh) * 1.002;
      if (t.entryPrice >= minEntry && t.entryPrice <= maxEntry) {
        return t;
      }
    } else {
      return t;
    }
  }

  return null;
}

function findMatchingDecision(
  decisions: DecisionMatchCandidate[],
  criteria: {
    symbol: string;
    recTime: number;
    entryLow: number | null;
    entryHigh: number | null;
  }
): DecisionMatchCandidate | null {
  for (const d of decisions) {
    if (d.symbol !== criteria.symbol) continue;

    // Time window check: submitted within 3 minutes of evaluation
    const timeDelta = Math.abs(d.submittedAt - criteria.recTime);
    if (timeDelta <= 3 * 60 * 1000) {
      return d;
    }
  }

  return null;
}
