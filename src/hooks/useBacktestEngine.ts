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
}

export interface BtMasterArrays {
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
const UTC_PLUS3_MS = 3 * 60 * 60 * 1000;

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
 * Fetch klines for a given interval.
 * Limit set to 1500 to accommodate 5 days of 5m candles (5 * 24 * 12 = 1440).
 */
async function fetchLookbackKlines(
  intervalLabel: '1h' | '15m' | '5m',
  startMs: number,   // UTC start (4 days ago)
  endMs: number      // UTC end (midnight after target date)
): Promise<BtCandle[]> {
  const url =
    `${BINANCE_REST}?symbol=${SYMBOL}` +
    `&interval=${intervalLabel}` +
    `&startTime=${startMs}` +
    `&endTime=${endMs - 1}` +   // Binance endTime is inclusive, subtract 1 ms
    `&limit=1500`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance klines error [${intervalLabel}]: ${res.status} — ${text}`);
  }
  const raw: unknown[][] = await res.json();
  return parseBinanceKlines(raw);
}

/**
 * Given a date string "YYYY-MM-DD", returns [startMs, endMs] as UTC ms
 * covering the full UTC day (00:00:00.000 → 23:59:59.999).
 */
function utcDayRange(dateStr: string): [number, number] {
  const startMs = Date.parse(`${dateStr}T00:00:00.000Z`);
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return [startMs, endMs];
}

/**
 * Find the index in a SORTED BtCandle[] array where the target date's Cairo time
 * reaches or exceeds cutoffHour:cutoffMinute.
 */
function findCutoffIndex(candles: BtCandle[], dateStr: string, cutoffHour: number, cutoffMinute: number): number {
  // cutoff time in UTC milliseconds (Cairo is UTC+3, so we subtract 3 hours in minutes = 180 minutes)
  const exactCutoffMs = Date.parse(`${dateStr}T00:00:00.000Z`) + (cutoffHour * 60 + cutoffMinute - 180) * 60 * 1000;

  for (let i = 0; i < candles.length; i++) {
    if (candles[i].t >= exactCutoffMs) {
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
  selectedDate: string
): Record<string, unknown> {
  const { candles_1h, candles_15m, candles_5m } = visible;

  // ── True Day Open (07:00 Cairo = 04:00 UTC) ─────────────────────────────
  let trueDayOpen0700: number | null = null;
  let dayOpenIndex = -1;

  for (let i = candles_15m.length - 1; i >= 0; i--) {
    const d = new Date(candles_15m[i].t);
    const candleDateStr = d.toISOString().slice(0, 10);
    if (candleDateStr === selectedDate && d.getUTCHours() === 4 && d.getUTCMinutes() === 0) {
      trueDayOpen0700 = candles_15m[i].o;
      dayOpenIndex = i;
      break;
    }
  }

  // ── Previous Day H/L from 1h candles ────────────────────────────────────
  const [targetStartMs] = utcDayRange(selectedDate);
  const prevDayStart = targetStartMs - 24 * 60 * 60 * 1000;
  const prevDayEnd = targetStartMs;

  let pdh = 0;
  let pdl = Infinity;
  candles_1h.forEach((c) => {
    const rawUtcMs = c.t;
    if (rawUtcMs >= prevDayStart && rawUtcMs < prevDayEnd) {
      if (c.h > pdh) pdh = c.h;
      if (c.l < pdl) pdl = c.l;
    }
  });
  if (pdl === Infinity) pdl = 0;

  // ── Current price & premium/discount ────────────────────────────────────
  const liveCandle = candles_5m[candles_5m.length - 1] ?? null;
  const livePrice = liveCandle?.c ?? null;

  let currentPricing = 'UNKNOWN';
  if (trueDayOpen0700 !== null && livePrice !== null) {
    if (livePrice > trueDayOpen0700) currentPricing = 'PREMIUM';
    else if (livePrice < trueDayOpen0700) currentPricing = 'DISCOUNT';
    else currentPricing = 'FAIR_VALUE';
  }

  // ── Active FVGs from 15m and 5m visible slices using lib/fvgEngine ──────
  const candles_15m_with_closed = candles_15m.map(c => ({ ...c, isClosed: true }));
  const candles_5m_with_closed = candles_5m.map(c => ({ ...c, isClosed: true }));
  const fvgs15m = detectActiveFVGs(candles_15m_with_closed, true);
  const fvgs5m = detectActiveFVGs(candles_5m_with_closed, true);
  const activeFVGs = mapAndConsolidateFVGs(fvgs15m, fvgs5m);

  // ── Session Ranges ──────────────────────────────────────────────────────
  const getSessionLiquidityLocal = (candles: BtCandle[], startHourLocal: number, endHourLocal: number) => {
    const sessionCandles = candles.filter(c => {
      // Shift raw UTC timestamp by +3h to evaluate local Cairo day and local Cairo hour
      const cairoDate = new Date(c.t + UTC_PLUS3_MS);
      const candleDayStr = cairoDate.toISOString().slice(0, 10);
      const hLocal = cairoDate.getUTCHours();
      return candleDayStr === selectedDate && hLocal >= startHourLocal && hLocal < endHourLocal;
    });

    if (sessionCandles.length === 0) return { high: null, low: null };

    return {
      high: parseFloat(Math.max(...sessionCandles.map(c => c.h)).toFixed(2)),
      low: parseFloat(Math.min(...sessionCandles.map(c => c.l)).toFixed(2))
    };
  };

  const asianLiquidity = getSessionLiquidityLocal(candles_15m, 3, 10);
  const londonLiquidity = getSessionLiquidityLocal(candles_15m, 10, 15);

  // ── Target Sweeps and DOL Status ────────────────────────────────────────
  let target_status = "PENDING";
  const todayCandles = candles_15m.filter(c => {
    const d = new Date(c.t);
    return d.toISOString().slice(0, 10) === selectedDate;
  });

  const sweeps: string[] = [];

  // Check PDH/PDL Exhaustion across all today's candles
  for (const c of todayCandles) {
    if (c.h >= pdh || c.l <= pdl) {
      sweeps.push("EXHAUSTED");
    }
  }

  // Check Asian sweeps (only candles at or after 10:00 Cairo local time = 07:00 UTC)
  const afterAsianCandles = todayCandles.filter(c => new Date(c.t).getUTCHours() >= 7);
  for (const c of afterAsianCandles) {
    if (asianLiquidity.high && c.h >= asianLiquidity.high && c.h < pdh) {
      sweeps.push("ASIAN_HIGH_SWEPT");
    }
    if (asianLiquidity.low && c.l <= asianLiquidity.low && c.l > pdl) {
      sweeps.push("ASIAN_LOW_SWEPT");
    }
  }

  // Check London sweeps (only candles at or after 15:00 Cairo local time = 12:00 UTC)
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
  const displacement = verifyDisplacementOffline(candles_15m, SYMBOL);
  const displacementSponsorship = displacement.status !== 'INACTIVE' && displacement.status !== 'CONSOLIDATION'
    ? 'ACTIVE'
    : 'INACTIVE';
  
  const openInterestTrend = displacement.status !== 'INACTIVE' && displacement.status !== 'CONSOLIDATION'
    ? 'RISING'
    : 'FLAT';

  // ── V10.13 Centralized Structure Analysis via structureEngine ─────────────
  const structureAnalysis = (livePrice !== null)
    ? analyzeMarketStructure(candles_15m, livePrice, displacement)
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
    }
  );

  return {
    ticker: `${SYMBOL}.backtest`,
    timezone: 'UTC+3 (Cairo)',
    replay_date: selectedDate,
    ipda_metrics: {
      note: 'Backtest replay — metrics computed from visible slice only.',
      true_day_open: trueDayOpen0700,
      true_day_open_0700: trueDayOpen0700,
      current_time_window,
      current_pricing: currentPricing,
      // V10.13 — Market Structure Shift from centralized engine
      market_structure_shift: structureAnalysis?.market_structure_shift ?? false,
      market_structure_shift_direction: structureAnalysis?.market_structure_shift_direction ?? null,
      current_trend: structureAnalysis?.currentTrend ?? 'UNSET',
      active_fvgs: activeFVGs,
      macro_levels: {
        pdh,
        pdl,
        asian_high: asianLiquidity.high,
        asian_low: asianLiquidity.low,
        true_day_open: trueDayOpen0700
      },
      session_ranges: {
        asian_range: asianLiquidity,
        london_range: londonLiquidity
      },
      pricing_context: {
        vs_daily_open:
          trueDayOpen0700 !== null && livePrice !== null
            ? livePrice > trueDayOpen0700 ? 'ABOVE_OPEN' : 'BELOW_OPEN'
            : 'UNKNOWN',
        local_dealing_range: localDealingRange,
      },
      order_flow_engine: {
        open_interest_trend: openInterestTrend,
        displacement_sponsorship: displacementSponsorship,
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
  selectedDate: string;
  cutoffTime: string;
  enrichedPayload: Record<string, unknown> | null;
  isDayRevealed: boolean;

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

  const todayCairo = new Date(Date.now() + UTC_PLUS3_MS);
  const todayStr = todayCairo.toISOString().slice(0, 10);

  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [cutoffTime, setCutoffTime] = useState<string>('09:00');
  const [timeframe, setTimeframe] = useState<BacktestTimeframe>('5m');

  const { cutoffHour, cutoffMinute } = useMemo(() => {
    const [hStr, mStr] = cutoffTime.split(':');
    return {
      cutoffHour: parseInt(hStr ?? '9', 10),
      cutoffMinute: parseInt(mStr ?? '0', 10),
    };
  }, [cutoffTime]);

  const totalCandles = masterArrays?.candles_5m.length ?? 0;

  const visibleArrays = useMemo<BtMasterArrays | null>(() => {
    if (!masterArrays || currentIndex === 0) return null;

    const visible5m = masterArrays.candles_5m.slice(0, currentIndex);
    const boundaryMs = visible5m.length > 0
      ? visible5m[visible5m.length - 1].t + 5 * 60 * 1000
      : 0;

    const visible15m = masterArrays.candles_15m.filter((c) => c.t < boundaryMs);
    const visible1h = masterArrays.candles_1h.filter((c) => c.t < boundaryMs);

    return {
      candles_5m: visible5m,
      candles_15m: visible15m,
      candles_1h: visible1h,
    };
  }, [masterArrays, currentIndex]);

  const enrichedPayload = useMemo<Record<string, unknown> | null>(() => {
    if (!visibleArrays) return null;
    return buildEnrichedPayload(visibleArrays, selectedDate);
  }, [visibleArrays, selectedDate]);

  const loadDay = useCallback(async () => {
    setStatus('fetching');
    setError(null);
    setMasterArrays(null);
    setCurrentIndex(0);
    setIsDayRevealed(false);

    try {
      const [targetStartMs, targetEndMs] = utcDayRange(selectedDate);

      // Lookback exactly 4 days before target date
      const startMs = targetStartMs - (4 * 24 * 60 * 60 * 1000);
      const endMs = targetEndMs;

      const [raw1h, raw15m, raw5m] = await Promise.all([
        fetchLookbackKlines('1h', startMs, endMs),
        fetchLookbackKlines('15m', startMs, endMs),
        fetchLookbackKlines('5m', startMs, endMs),
      ]);

      const arrays: BtMasterArrays = {
        candles_1h: raw1h,
        candles_15m: raw15m,
        candles_5m: raw5m,
      };

      setMasterArrays(arrays);

      const ci = findCutoffIndex(raw5m, selectedDate, cutoffHour, cutoffMinute);
      setCurrentIndex(Math.max(1, ci));
      setStatus('ready');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown fetch error';
      setError(msg);
      setStatus('error');
    }
  }, [selectedDate, cutoffHour, cutoffMinute]);

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

    const filename = `BT_Enriched_${SYMBOL}_${selectedDate}_@${ts}_${timeString}.json`;
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
  }, [enrichedPayload, visibleArrays, selectedDate]);

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
    selectedDate,
    cutoffTime,
    enrichedPayload,
    isDayRevealed,
    setSelectedDate,
    setCutoffTime,
    setTimeframe,
    loadDay,
    nextCandle,
    prevCandle,
    revealDay,
    downloadPayload,
    copyPayload,
  };
}