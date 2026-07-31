/**
 * useBacktestEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Isolated Market Replay / Backtesting hook.
 *
 * ZERO dependencies on the live `useMarketData` hook or `/api/market-data`.
 * All data flows through Binance public REST (fapi.binance.com/fapi/v1/klines).
 *
 * Timezone anchor: Cairo UTC+3 (same rule as project_rules.md §3).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useMemo } from 'react';
import { detectActiveFVGs, mapAndConsolidateFVGs } from '@/lib/fvgEngine';
import { verifyDisplacementOffline } from '@/lib/displacementEngine';
import { generateTradeExecutionParameters } from '@/lib/riskEngine';
import { analyzeMarketStructure } from '@/lib/structureEngine';
import { resolveTripleVectorBias } from '@/lib/quantEngine/BiasEngine';
import { annotateCandlesWithVolumetricSignals } from '@/utils/generateChartMarkers';


// ── Internal types ────────────────────────────────────────────────────────────
export interface BtCandle {
  /** Open time in **milliseconds** (raw UTC). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  taker_buy_vol: number;
  taker_sell_vol: number;
  volumetric_signal?: 'ARROW_UP' | 'ARROW_DOWN' | 'CIRCLE_UP' | 'CIRCLE_DOWN' | null;
}

export interface BtMasterArrays {
  candles_4h: BtCandle[];
  candles_1h: BtCandle[];
  candles_15m: BtCandle[];
  candles_5m: BtCandle[];
}

export type BacktestStatus =
  | 'idle'
  | 'fetching'
  | 'ready'
  | 'error';

export type BacktestTimeframe = '5m' | '15m' | '1h';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const SYMBOL = 'ETHUSDC';

/** Binance Futures REST base — public, no auth required. */
const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/klines';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse raw Binance kline array into BtCandle[].
 * Pulls index 9 as taker_buy_vol and computes taker_sell_vol.
 */
function parseBinanceKlines(raw: unknown[][]): BtCandle[] {
  return raw.map((c) => {
    const v = parseFloat(c[5] as string);
    const taker_buy_vol = parseFloat(c[9] as string);
    return {
      t: Number(c[0]),
      o: parseFloat(c[1] as string),
      h: parseFloat(c[2] as string),
      l: parseFloat(c[3] as string),
      c: parseFloat(c[4] as string),
      v,
      taker_buy_vol,
      taker_sell_vol: parseFloat((v - taker_buy_vol).toFixed(4)),
    };
  });
}

/**
 * Fetch klines for a given interval using pagination to support arbitrary date ranges.
 */
async function fetchLookbackKlines(
  intervalLabel: '4h' | '1h' | '15m' | '5m',
  startMs: number,   // UTC start
  endMs: number      // UTC end
): Promise<BtCandle[]> {
  const allKlines: BtCandle[] = [];
  let currentStart = startMs;

  while (currentStart < endMs) {
    const url =
      `${BINANCE_REST}?symbol=${SYMBOL}` +
      `&interval=${intervalLabel}` +
      `&startTime=${currentStart}` +
      `&endTime=${endMs - 1}` +   // Binance endTime is inclusive, subtract 1 ms
      `&limit=1500`;

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Binance klines error [${intervalLabel}]: ${res.status} — ${text}`);
    }
    const raw: unknown[][] = await res.json();
    if (!raw || raw.length === 0) break;

    const parsed = parseBinanceKlines(raw);
    allKlines.push(...parsed);

    const lastTime = parsed[parsed.length - 1].t;
    if (lastTime <= currentStart) break;
    currentStart = lastTime + 1;

    if (raw.length < 1500 || currentStart >= endMs) {
      break;
    }
  }

  // Deduplicate and sort chronologically
  const map = new Map<number, BtCandle>();
  for (const k of allKlines) {
    map.set(k.t, k);
  }
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}

/**
 * Converts a date string "YYYY-MM-DD" and time string "HH:MM" (Cairo UTC+3)
 * into absolute UTC milliseconds.
 */
function getUtcMs(dateStr: string, timeStr: string, defaultTime: string, isEnd = false): number {
  const [hStr, mStr] = (timeStr || defaultTime).split(':');
  const hour = parseInt(hStr ?? (isEnd ? '23' : '0'), 10);
  const minute = parseInt(mStr ?? (isEnd ? '59' : '0'), 10);

  const baseMs = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (isNaN(baseMs)) return Date.now();

  // Cairo is UTC+3 (subtract 180 minutes)
  return baseMs + (hour * 60 + minute - 180) * 60 * 1000 + (isEnd ? 59999 : 0);
}

/**
 * Find the index in a SORTED BtCandle[] array matching or exceeding target start timestamp.
 */
function findCutoffIndex(candles: BtCandle[], startUtcMs: number): number {
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].t >= startUtcMs) {
      return i;
    }
  }
  return candles.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enriched JSON builder
// ─────────────────────────────────────────────────────────────────────────────
function buildEnrichedPayload(
  visible: BtMasterArrays,
  selectedDate: string,
  timeframe: BacktestTimeframe
): Record<string, unknown> {
  const { candles_4h, candles_1h, candles_15m, candles_5m } = visible;

  const activeCandles = timeframe === '1h'
    ? candles_1h
    : timeframe === '15m'
      ? candles_15m
      : candles_5m;

  // ── Current price & premium/discount ────────────────────────────────────
  const liveCandle = candles_5m[candles_5m.length - 1] ?? null;
  const livePrice = liveCandle?.c ?? null;

  const lastDateUtc = liveCandle ? new Date(liveCandle.t) : null;

  // ── Previous Day H/L from 1h candles ────────────────────────────────────
  let pdh = 0;
  let pdl = Infinity;
  if (lastDateUtc) {
    const previousDayDateUtc = new Date(Date.UTC(lastDateUtc.getUTCFullYear(), lastDateUtc.getUTCMonth(), lastDateUtc.getUTCDate() - 1));
    const prevYear = previousDayDateUtc.getUTCFullYear();
    const prevMonth = previousDayDateUtc.getUTCMonth();
    const prevDate = previousDayDateUtc.getUTCDate();

    candles_1h.forEach((c) => {
      const dUtc = new Date(c.t);
      if (dUtc.getUTCFullYear() === prevYear && dUtc.getUTCMonth() === prevMonth && dUtc.getUTCDate() === prevDate) {
        if (c.h > pdh) pdh = c.h;
        if (c.l < pdl) pdl = c.l;
      }
    });
  }
  if (pdl === Infinity) pdl = 0;

  // ── Current price & premium/discount status (anchored to PDH/PDL midpoint) ──────────────────────────────
  let currentPricing = 'UNKNOWN';
  const rangeEq = (pdh > 0 && pdl > 0) ? (pdh + pdl) / 2 : null;
  if (rangeEq !== null && livePrice !== null) {
    if (livePrice > rangeEq + 0.5) currentPricing = 'PREMIUM';
    else if (livePrice < rangeEq - 0.5) currentPricing = 'DISCOUNT';
    else currentPricing = 'EQUILIBRIUM';
  }

  // ── Active FVGs from 4h, 1h, 15m and 5m visible slices using lib/fvgEngine ──
  // Treat all historical candles as closed, and the very last visible candle as the active open candle
  const candles_4h_with_closed = candles_4h.map((c, idx) => ({ ...c, isClosed: idx < candles_4h.length - 1 }));
  const candles_1h_with_closed = candles_1h.map((c, idx) => ({ ...c, isClosed: idx < candles_1h.length - 1 }));
  const candles_15m_with_closed = candles_15m.map((c, idx) => ({ ...c, isClosed: idx < candles_15m.length - 1 }));
  const candles_5m_with_closed = candles_5m.map((c, idx) => ({ ...c, isClosed: idx < candles_5m.length - 1 }));
  
  const fvgs4h = detectActiveFVGs(candles_4h_with_closed, true);
  const fvgs1h = detectActiveFVGs(candles_1h_with_closed, true);
  const fvgs15m = detectActiveFVGs(candles_15m_with_closed, true);
  const fvgs5m = detectActiveFVGs(candles_5m_with_closed, true);

  const activeFVGs = mapAndConsolidateFVGs([
    { fvgs: fvgs5m, timeframe: '5m' },
    { fvgs: fvgs15m, timeframe: '15m' },
    { fvgs: fvgs1h, timeframe: '1h' },
    { fvgs: fvgs4h, timeframe: '4h' },
  ]);

  // ── Session Ranges (Aligned with live HUD's UTC hour metrics) ─────────────
  const getSessionLiquidityUTC = (candles: BtCandle[], startHourUTC: number, endHourUTC: number) => {
    if (!lastDateUtc) return { high: null, low: null };

    const sessionCandles = candles.filter(c => {
      const d = new Date(c.t);
      return d.getUTCFullYear() === lastDateUtc.getUTCFullYear() &&
        d.getUTCMonth() === lastDateUtc.getUTCMonth() &&
        d.getUTCDate() === lastDateUtc.getUTCDate() &&
        d.getUTCHours() >= startHourUTC &&
        d.getUTCHours() < endHourUTC;
    });

    if (sessionCandles.length === 0) return { high: null, low: null };

    return {
      high: parseFloat(Math.max(...sessionCandles.map(c => c.h)).toFixed(2)),
      low: parseFloat(Math.min(...sessionCandles.map(c => c.l)).toFixed(2))
    };
  };

  const asianLiquidity = getSessionLiquidityUTC(candles_15m, 0, 7);
  const londonLiquidity = getSessionLiquidityUTC(candles_15m, 7, 12);

  // ── Target Sweeps and DOL Status ────────────────────────────────────────
  let target_status = "PENDING";
  const todayCandles = lastDateUtc
    ? candles_15m.filter(c => {
      const d = new Date(c.t);
      return d.getUTCFullYear() === lastDateUtc.getUTCFullYear() &&
        d.getUTCMonth() === lastDateUtc.getUTCMonth() &&
        d.getUTCDate() === lastDateUtc.getUTCDate();
    })
    : [];

  const sweeps: string[] = [];

  // Check PDH/PDL Exhaustion across all today's candles
  for (const c of todayCandles) {
    if (c.h >= pdh || c.l <= pdl) {
      sweeps.push("EXHAUSTED");
    }
  }

  // Check Asian sweeps (only candles at or after 07:00 UTC)
  const afterAsianCandles = todayCandles.filter(c => new Date(c.t).getUTCHours() >= 7);
  for (const c of afterAsianCandles) {
    if (asianLiquidity.high && c.h >= asianLiquidity.high && c.h < pdh) {
      sweeps.push("ASIAN_HIGH_SWEPT");
    }
    if (asianLiquidity.low && c.l <= asianLiquidity.low && c.l > pdl) {
      sweeps.push("ASIAN_LOW_SWEPT");
    }
  }

  // Check London sweeps (only candles at or after 12:00 UTC)
  const afterLondonCandles = todayCandles.filter(c => new Date(c.t).getUTCHours() >= 12);
  for (const c of afterLondonCandles) {
    if (londonLiquidity.high && c.h >= londonLiquidity.high && c.h < pdh) {
      sweeps.push("LONDON_HIGH_SWEPT");
    }
    if (londonLiquidity.low && c.l <= londonLiquidity.low && c.l > pdl) {
      sweeps.push("LONDON_LOW_SWEPT");
    }
  }

  if (sweeps.includes("EXHAUSTED")) {
    target_status = "EXHAUSTED";
  } else if (sweeps.length > 0) {
    const uniqueSweeps = Array.from(new Set(sweeps));
    target_status = uniqueSweeps.join(" | ") + " / PDH_PDL_PENDING";
  }

  // ── Offline Sponsorship and Risk calculations ────────────────────────────
  const displacement = verifyDisplacementOffline(activeCandles, SYMBOL);
  const displacementSponsorship = displacement.status !== 'INACTIVE' && displacement.status !== 'CONSOLIDATION'
    ? 'ACTIVE'
    : 'INACTIVE';

  const openInterestTrend = displacement.status !== 'INACTIVE' && displacement.status !== 'CONSOLIDATION'
    ? 'RISING'
    : 'FLAT';

  // ── V10.13 Centralized Structure Analysis via structureEngine ─────────────
  // Slice active candles to match the standard 350-candle lookback limit of the live HUD.
  // Treat all historical candles as closed, and the very last visible candle as the active open candle.
  const activeCandlesWithClosed = activeCandles.map((c, idx) => ({
    ...c,
    isClosed: idx < activeCandles.length - 1
  }));
  const structureCandles = activeCandlesWithClosed.slice(-350);

  const structureAnalysis = (livePrice !== null)
    ? analyzeMarketStructure(structureCandles, livePrice, displacement)
    : null;
  const localDealingRange = structureAnalysis
    ? structureAnalysis.dealingRange
    : { high: null, low: null, equilibrium: null, current_status: 'UNKNOWN' };

  // Determine current killzone from replayed candle time
  const current_time_window = liveCandle ? (() => {
    const utcDate = new Date(liveCandle.t);

    // NY Lunch Dead Zone Preemption (12:00 PM – 1:30 PM New York Time)
    const nyTimeStr = utcDate.toLocaleString("en-US", { timeZone: "America/New_York" });
    const nyDate = new Date(nyTimeStr);
    const nyHour = nyDate.getHours();
    const nyMin = nyDate.getMinutes();
    if (nyHour === 12 || (nyHour === 13 && nyMin <= 30)) {
      return "DEAD_ZONE";
    }

    const hour = utcDate.getUTCHours();
    if (hour >= 0 && hour <= 3) return "ASIAN_RANGE";
    if (hour >= 6 && hour <= 8) return "LONDON_AM_KILLZONE";
    if (hour >= 12 && hour <= 14) return "NY_AM_KILLZONE";
    if (hour >= 17 && hour <= 18) return "NY_PM_KILLZONE";
    return "DEAD_ZONE";
  })() : "DEAD_ZONE";

  const trade_execution_parameters = generateTradeExecutionParameters(
    target_status,
    current_time_window,
    displacement,
    livePrice ?? 0,
    activeFVGs,
    {
      BSL_Magnets: pdh > 0 ? [pdh] : [],
      SSL_Magnets: pdl > 0 ? [pdl] : [],
    },
    activeCandles
  );

  const distance_to_PWH = pdh > 0 && livePrice !== null ? parseFloat(Math.abs(pdh - livePrice).toFixed(2)) : null;
  const distance_to_PWL = pdl > 0 && livePrice !== null ? parseFloat(Math.abs(pdl - livePrice).toFixed(2)) : null;

  const allHtfDistances = [
    { label: 'PWH', val: distance_to_PWH },
    { label: 'PWL', val: distance_to_PWL }
  ].filter((d): d is { label: string; val: number } => d.val !== null);

  const nearestHtfMagnet = allHtfDistances.length > 0
    ? (() => {
        const min = allHtfDistances.reduce((m, cur) => (cur.val! < m.val! ? cur : m), allHtfDistances[0]);
        return { label: min.label, distance: min.val };
      })()
    : null;

  const activeSwingPOC = structureAnalysis?.dealingRange?.profile_metrics?.poc ?? null;
  const resolvedBias = resolveTripleVectorBias({
    livePrice,
    nearest_htf_magnet: nearestHtfMagnet,
    activeSwingPOC,
    liquidation_status: displacement.status.startsWith('ACTIVE') ? 'LIQUIDITY_SWEPT' : 'NORMAL',
    target_status
  });

  return {
    ticker: `${SYMBOL}.backtest`,
    timezone: 'UTC',
    replay_date: selectedDate,
    ipda_metrics: {
      note: 'Backtest replay — metrics computed from visible slice only.',
      current_time_window,
      current_pricing: currentPricing,
      target_status,
      macro_daily_bias: resolvedBias,
      // V10.13 — Market Structure Shift from centralized engine
      market_structure_shift: structureAnalysis?.market_structure_shift ?? false,
      market_structure_shift_direction: structureAnalysis?.market_structure_shift_direction ?? null,
      current_trend: structureAnalysis?.currentTrend ?? 'UNSET',
      internal_market_trend: structureAnalysis?.internalTrend || 'UNSET',
      internal_structure_shift: structureAnalysis?.internal_market_structure_shift === true,
      internal_context: {
        trend: structureAnalysis?.internalTrend || 'UNSET',
        high: structureAnalysis?.internalDealingRange?.high || 0,
        low: structureAnalysis?.internalDealingRange?.low || 0,
        equilibrium: structureAnalysis?.internalDealingRange?.equilibrium || 0,
        pricing_status: structureAnalysis?.internalDealingRange?.current_status || 'UNKNOWN',
        anchor_high_swing: structureAnalysis?.internalDealingRange?.anchor_high_swing || null,
        anchor_low_swing: structureAnalysis?.internalDealingRange?.anchor_low_swing || null
      },
      expansion_mode: structureAnalysis?.expansion_mode ?? 'NORMAL',
      market_velocity: structureAnalysis?.market_velocity ?? 0,
      runaway_origin_price: structureAnalysis?.runaway_origin_price ?? null,
      full_structure_map: structureAnalysis ? {
        swing_points: structureAnalysis.swing_points,
        structural_events: structureAnalysis.structural_events,
        swings: structureAnalysis.swings,
        zigzag: structureAnalysis.zigzag,
        innerSwings: structureAnalysis.innerSwings || [],
        innerZigzag: structureAnalysis.innerZigzag || [],
        currentTrend: structureAnalysis.currentTrend,
        subTrend: structureAnalysis.subTrend || 'UNSET',
        dealingRange: structureAnalysis.dealingRange,
        internalTrend: structureAnalysis.internalTrend || 'UNSET',
        internalZigzag: structureAnalysis.internalZigzag || [],
        latestInternalMSS: structureAnalysis.latestInternalMSS || null,
        internal_market_structure_shift: structureAnalysis.internal_market_structure_shift === true,
        internalDealingRange: structureAnalysis.internalDealingRange,
        latestMSS: structureAnalysis.latestMSS || null,
        market_structure_shift: structureAnalysis.market_structure_shift || false,
        market_structure_shift_direction: structureAnalysis.market_structure_shift_direction || null
      } : null,
      active_fvgs: activeFVGs,
      // BUG-3 FIX: quantTradeEngine reads macro_structural_magnets to anchor the dealing range.
      // The backtest payload omitted this field entirely, causing the engine to fall back
      // to a raw 50-candle window high/low (much tighter than the real structural anchors).
      macro_structural_magnets: {
        major_swing_high: structureAnalysis?.dealingRange?.high ?? (pdh > 0 ? pdh : null),
        major_swing_low:  structureAnalysis?.dealingRange?.low  ?? (pdl > 0 ? pdl : null),
      },
      macro_levels: {
        pdh,
        pdl,
        asian_high: asianLiquidity.high,
        asian_low: asianLiquidity.low
      },
      session_ranges: {
        asian_range: asianLiquidity,
        london_range: londonLiquidity
      },
      pricing_context: {
        local_dealing_range: localDealingRange,
      },
      order_flow_engine: {
        open_interest_trend: openInterestTrend,
        // BUG-6 FIX: was emitting a plain string ("ACTIVE"/"INACTIVE") but quantTradeEngine
        // reads displacement_sponsorship?.status (object form). Now emits the full object.
        displacement_sponsorship: displacement,
        smart_money_sentiment: { smart_money_divergence: false },
        resting_liquidity_pools: {
          BSL_Magnets: pdh > 0 ? [pdh] : [],
          SSL_Magnets: pdl > 0 ? [pdl] : [],
        },
      },
      institutional_sponsorship: displacement,
      trade_execution_parameters,
    },
    active_arrays: {
      fvgs: activeFVGs,
    },
    data_payload: {
      candles_4h,
      candles_1h,
      candles_15m,
      candles_5m,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The Hook
// ─────────────────────────────────────────────────────────────────────────────
export interface UseBacktestEngineReturn {
  status: BacktestStatus;
  error: string | null;
  masterArrays: BtMasterArrays | null;
  visibleArrays: BtMasterArrays | null;
  currentIndex: number;
  totalCandles: number;
  timeframe: BacktestTimeframe;

  // Date Range Controls
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;

  // Legacy aliases for backward compatibility
  selectedDate: string;
  cutoffTime: string;

  enrichedPayload: Record<string, unknown> | null;
  isDayRevealed: boolean;

  setStartDate: (date: string) => void;
  setStartTime: (time: string) => void;
  setEndDate: (date: string) => void;
  setEndTime: (time: string) => void;

  // Legacy setters
  setSelectedDate: (date: string) => void;
  setCutoffTime: (time: string) => void;

  setTimeframe: (tf: BacktestTimeframe) => void;
  loadDay: () => Promise<void>;
  nextCandle: () => void;
  prevCandle: () => void;
  revealDay: () => void;
  downloadPayload: (counts: { '5m': number, '15m': number, '1h': number, '4h': number }) => void;
  copyPayload: (counts: { '5m': number, '15m': number, '1h': number, '4h': number }) => Promise<void>;
}

export function useBacktestEngine(): UseBacktestEngineReturn {
  const [status, setStatus] = useState<BacktestStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [masterArrays, setMasterArrays] = useState<BtMasterArrays | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isDayRevealed, setIsDayRevealed] = useState<boolean>(false);

  const todayUtc = new Date();
  const todayStr = todayUtc.toISOString().slice(0, 10);
  const threeDaysAgoUtc = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const threeDaysAgoStr = threeDaysAgoUtc.toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState<string>(threeDaysAgoStr);
  const [startTime, setStartTime] = useState<string>('09:00');
  const [endDate, setEndDate] = useState<string>(todayStr);
  const [endTime, setEndTime] = useState<string>('23:59');
  const [timeframe, setTimeframe] = useState<BacktestTimeframe>('5m');

  const totalCandles = masterArrays?.candles_5m.length ?? 0;

  const visibleArrays = useMemo<BtMasterArrays | null>(() => {
    if (!masterArrays || currentIndex === 0) return null;

    // Slice up to currentIndex + 1 to include the current active candle
    const visible5m = masterArrays.candles_5m.slice(0, currentIndex + 1);
    const boundaryMs = visible5m.length > 0
      ? visible5m[visible5m.length - 1].t + 5 * 60 * 1000
      : 0;

    // Exclude HTF candles that are not fully closed at boundaryMs to prevent look-ahead bias
    const visible15m = masterArrays.candles_15m.filter((c) => c.t + 15 * 60 * 1000 <= boundaryMs);
    const visible1h = masterArrays.candles_1h.filter((c) => c.t + 60 * 60 * 1000 <= boundaryMs);
    const visible4h = masterArrays.candles_4h.filter((c) => c.t + 4 * 60 * 60 * 1000 <= boundaryMs);

    return {
      candles_4h: visible4h,
      candles_5m: visible5m,
      candles_15m: visible15m,
      candles_1h: visible1h,
    };
  }, [masterArrays, currentIndex]);

  const enrichedPayload = useMemo<Record<string, unknown> | null>(() => {
    if (!visibleArrays) return null;
    return buildEnrichedPayload(visibleArrays, startDate === endDate ? startDate : `${startDate} -> ${endDate}`, timeframe);
  }, [visibleArrays, startDate, endDate, timeframe]);

  const loadDay = useCallback(async () => {
    setStatus('fetching');
    setError(null);
    setMasterArrays(null);
    setCurrentIndex(0);
    setIsDayRevealed(false);

    try {
      const startUtcMs = getUtcMs(startDate, startTime, '09:00', false);
      let endUtcMs = getUtcMs(endDate, endTime, '23:59', true);

      // Sanity check: Ensure endUtcMs is at least 1 day after startUtcMs if user picked end < start
      if (endUtcMs <= startUtcMs) {
        endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
      }

      // Lookback 4 days before target start date to warm up HTF structural indicators
      const lookbackStartMs = startUtcMs - (4 * 24 * 60 * 60 * 1000);

      const [raw4h, raw1h, raw15m, raw5m] = await Promise.all([
        fetchLookbackKlines('4h', lookbackStartMs, endUtcMs),
        fetchLookbackKlines('1h', lookbackStartMs, endUtcMs),
        fetchLookbackKlines('15m', lookbackStartMs, endUtcMs),
        fetchLookbackKlines('5m', lookbackStartMs, endUtcMs),
      ]);

      // Annotate raw arrays with volumetric signals before initializing masterArrays
      annotateCandlesWithVolumetricSignals(raw4h);
      annotateCandlesWithVolumetricSignals(raw1h);
      annotateCandlesWithVolumetricSignals(raw15m);
      annotateCandlesWithVolumetricSignals(raw5m);

      const arrays: BtMasterArrays = {
        candles_4h: raw4h,
        candles_1h: raw1h,
        candles_15m: raw15m,
        candles_5m: raw5m,
      };

      setMasterArrays(arrays);

      const ci = findCutoffIndex(raw5m, startUtcMs);
      setCurrentIndex(Math.max(1, ci));
      setStatus('ready');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown fetch error';
      setError(msg);
      setStatus('error');
    }
  }, [startDate, startTime, endDate, endTime]);

  const nextCandle = useCallback(() => {
    if (!masterArrays) return;
    setCurrentIndex((prev) => Math.min(prev + 1, masterArrays.candles_5m.length));
  }, [masterArrays]);

  const prevCandle = useCallback(() => {
    setCurrentIndex((prev) => Math.max(prev - 1, 1));
  }, []);

  const revealDay = useCallback(() => {
    if (!masterArrays) return;
    setCurrentIndex(masterArrays.candles_5m.length);
    setIsDayRevealed(true);
  }, [masterArrays]);

  const downloadPayload = useCallback((counts: { '5m': number, '15m': number, '1h': number, '4h': number }) => {
    if (!enrichedPayload) return;

    const payloadToExport = { ...enrichedPayload };
    const data_payload: any = {};

    if (counts['1h'] > 0 && Array.isArray((payloadToExport.data_payload as any).candles_1h)) {
      data_payload.candles_1h = (payloadToExport.data_payload as any).candles_1h.slice(-counts['1h']);
    }
    if (counts['15m'] > 0 && Array.isArray((payloadToExport.data_payload as any).candles_15m)) {
      data_payload.candles_15m = (payloadToExport.data_payload as any).candles_15m.slice(-counts['15m']);
    }
    if (counts['5m'] > 0 && Array.isArray((payloadToExport.data_payload as any).candles_5m)) {
      data_payload.candles_5m = (payloadToExport.data_payload as any).candles_5m.slice(-counts['5m']);
    }

    payloadToExport.data_payload = data_payload;

    const lastCandle = visibleArrays?.candles_5m.slice(-1)[0];
    const ts = lastCandle
      ? new Date(lastCandle.t).toISOString().replace(/[:.]/g, '-').slice(0, 19)
      : 'snapshot';

    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = hours < 10 ? '0' + hours : hours.toString();
    const minutesStr = minutes < 10 ? '0' + minutes : minutes.toString();
    const timeString = `${hoursStr}-${minutesStr}-${ampm}`;

    const rangeTag = startDate === endDate ? startDate : `${startDate}_to_${endDate}`;
    const filename = `BT_Enriched_${SYMBOL}_${rangeTag}_@${ts}_${timeString}.json`;
    const blob = new Blob([JSON.stringify(payloadToExport, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [enrichedPayload, visibleArrays, startDate, endDate]);

  const copyPayload = useCallback(async (counts: { '5m': number, '15m': number, '1h': number, '4h': number }) => {
    if (!enrichedPayload) return;

    const payloadToExport = { ...enrichedPayload };
    const data_payload: any = {};

    if (counts['1h'] > 0 && Array.isArray((payloadToExport.data_payload as any).candles_1h)) {
      data_payload.candles_1h = (payloadToExport.data_payload as any).candles_1h.slice(-counts['1h']);
    }
    if (counts['15m'] > 0 && Array.isArray((payloadToExport.data_payload as any).candles_15m)) {
      data_payload.candles_15m = (payloadToExport.data_payload as any).candles_15m.slice(-counts['15m']);
    }
    if (counts['5m'] > 0 && Array.isArray((payloadToExport.data_payload as any).candles_5m)) {
      data_payload.candles_5m = (payloadToExport.data_payload as any).candles_5m.slice(-counts['5m']);
    }

    payloadToExport.data_payload = data_payload;

    const text =
      'Act as the Institutional Flow Synthesizer V8.2. ' +
      'Analyze the following HISTORICAL backtest data and provide a mechanical bias report:\n\n' +
      JSON.stringify(payloadToExport, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }, [enrichedPayload]);

  return {
    status,
    error,
    masterArrays,
    visibleArrays,
    currentIndex,
    totalCandles,
    timeframe,
    startDate,
    startTime,
    endDate,
    endTime,
    selectedDate: startDate,
    cutoffTime: startTime,
    enrichedPayload,
    isDayRevealed,
    setStartDate,
    setStartTime,
    setEndDate,
    setEndTime,
    setSelectedDate: setStartDate,
    setCutoffTime: setStartTime,
    setTimeframe,
    loadDay,
    nextCandle,
    prevCandle,
    revealDay,
    downloadPayload,
    copyPayload,
  };
}