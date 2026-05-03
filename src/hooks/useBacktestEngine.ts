/**
 * useBacktestEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Isolated Market Replay / Backtesting hook.
 *
 * ZERO dependencies on the live `useMarketData` hook or `/api/market-data`.
 * All data flows through Binance public REST (api.binance.com/api/v3/klines).
 *
 * Timezone anchor: Cairo UTC+3 (same rule as project_rules.md §3).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useMemo } from 'react';

// ── Internal types ────────────────────────────────────────────────────────────
// Intentionally NOT imported from useMarketData to maintain full isolation.
export interface BtCandle {
  /** Open time in **milliseconds**, already shifted +3 h to Cairo local time. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
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

/** Binance REST base — public, no auth required. */
const BINANCE_REST = 'https://api.binance.com/api/v3/klines';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse raw Binance kline array into BtCandle[].
 * Applies +3 h shift so all `t` values read as Cairo local milliseconds.
 */
function parseBinanceKlines(raw: unknown[][]): BtCandle[] {
  return raw.map((c) => ({
    t: Number(c[0]) + UTC_PLUS3_MS,
    o: parseFloat(c[1] as string),
    h: parseFloat(c[2] as string),
    l: parseFloat(c[3] as string),
    c: parseFloat(c[4] as string),
    v: parseFloat(c[5] as string),
  }));
}

/**
 * Fetch ALL klines for a given interval within a UTC day.
 * Binance caps each request at 1 000 candles, so we page if needed.
 * For a single UTC day: max 1440 (1m) so 1 h = 24, 15 m = 96, 5 m = 288 —
 * all fit in a single request.
 */
async function fetchDayKlines(
  intervalLabel: '1h' | '15m' | '5m',
  startMs: number,   // UTC midnight of selected date
  endMs: number      // UTC midnight of next date (exclusive)
): Promise<BtCandle[]> {
  const url =
    `${BINANCE_REST}?symbol=${SYMBOL}` +
    `&interval=${intervalLabel}` +
    `&startTime=${startMs}` +
    `&endTime=${endMs - 1}` +   // Binance endTime is inclusive, subtract 1 ms
    `&limit=1000`;

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
 * Find the index in a SORTED BtCandle[] array where Cairo time (c.t, already
 * shifted) reaches or exceeds cutoffHour:cutoffMinute.
 *
 * Returns 0 if no candle is before the cutoff (edge case), or the length of
 * the array if the cutoff is after all candles.
 */
function findCutoffIndex(candles: BtCandle[], cutoffHour: number, cutoffMinute: number): number {
  // Cutoff in terms of milliseconds since midnight (Cairo).
  const cutoffMsFromMidnight = (cutoffHour * 60 + cutoffMinute) * 60 * 1000;

  for (let i = 0; i < candles.length; i++) {
    const d = new Date(candles[i].t);
    // c.t is already +3h shifted, so UTC hours/minutes read as Cairo hours/minutes.
    const cairoMsFromMidnight = (d.getUTCHours() * 60 + d.getUTCMinutes()) * 60 * 1000;
    if (cairoMsFromMidnight >= cutoffMsFromMidnight) {
      return i;
    }
  }
  return candles.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enriched JSON builder
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Builds a lightweight "Enriched" JSON payload from visible arrays only.
 * Mirrors the live V7.9 structure so the AI prompt remains identical.
 * Only the fields computable client-side from the OHLCV slice are included.
 */
function buildEnrichedPayload(
  visible: BtMasterArrays,
  selectedDate: string
): Record<string, unknown> {
  const { candles_1h, candles_15m, candles_5m } = visible;

  // ── True Day Open (07:00 Cairo = UTC 04:00) ─────────────────────────────
  let trueDayOpen0700: number | null = null;
  for (let i = candles_15m.length - 1; i >= 0; i--) {
    const d = new Date(candles_15m[i].t);
    if (d.getUTCHours() === 7 && d.getUTCMinutes() === 0) {
      trueDayOpen0700 = candles_15m[i].o;
      break;
    }
  }

  // ── Previous Day H/L from 1h candles ────────────────────────────────────
  // The selected date string "YYYY-MM-DD" → previous UTC day.
  const [startMs] = utcDayRange(selectedDate);
  const prevDayStart = startMs - 24 * 60 * 60 * 1000;
  const prevDayEnd = startMs;

  let pdh = 0;
  let pdl = Infinity;
  candles_1h.forEach((c) => {
    // c.t is Cairo-shifted; strip the +3h to get UTC open time.
    const rawUtcMs = c.t - UTC_PLUS3_MS;
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

  // ── Active FVGs from 15m visible slice ──────────────────────────────────
  const activeFVGs: Array<{
    type: string; top: number; bottom: number; ce_50: number;
  }> = [];

  for (let i = 0; i < candles_15m.length - 2; i++) {
    const c1 = candles_15m[i];
    const c3 = candles_15m[i + 2];

    let type: string | null = null;
    let gapTop: number | null = null;
    let gapBottom: number | null = null;

    if (c1.l > c3.h) {
      type = 'Bearish_SIBI'; gapTop = c1.l; gapBottom = c3.h;
    } else if (c1.h < c3.l) {
      type = 'Bullish_BISI'; gapTop = c3.l; gapBottom = c1.h;
    }

    if (type && gapTop !== null && gapBottom !== null) {
      let mitigated = false;
      for (let j = i + 3; j < candles_15m.length; j++) {
        const fc = candles_15m[j];
        if (type === 'Bearish_SIBI' && fc.h >= gapBottom!) { mitigated = true; break; }
        if (type === 'Bullish_BISI' && fc.l <= gapTop!) { mitigated = true; break; }
      }
      if (!mitigated) {
        activeFVGs.push({
          type,
          top: gapTop,
          bottom: gapBottom,
          ce_50: Number(((gapTop + gapBottom) / 2).toFixed(2)),
        });
      }
    }
  }

  // ── Intraday Dealing Range (07:00 Cairo → last visible candle) ──────────
  const intradayCandles = candles_15m.filter((c) => {
    const d = new Date(c.t);
    return d.getUTCHours() >= 7;
  });

  let localDealingRange: Record<string, unknown> = {
    high: null, low: null, equilibrium: null, current_status: 'UNKNOWN',
  };
  if (intradayCandles.length > 0 && livePrice !== null) {
    const idHigh = parseFloat(Math.max(...intradayCandles.map((c) => c.h)).toFixed(2));
    const idLow = parseFloat(Math.min(...intradayCandles.map((c) => c.l)).toFixed(2));
    const idEqui = parseFloat(((idHigh + idLow) / 2).toFixed(2));
    localDealingRange = {
      high: idHigh, low: idLow, equilibrium: idEqui,
      current_status: livePrice > idEqui ? 'PREMIUM' : 'DISCOUNT',
    };
  }

  return {
    ticker: `${SYMBOL}.backtest`,
    timezone: 'UTC+3 (Cairo)',
    replay_date: selectedDate,
    data_payload: {
      candles_1h,
      candles_15m,
      candles_5m,
    },
    ipda_metrics: {
      note: 'Backtest replay — metrics computed from visible slice only.',
      true_day_open_0700: trueDayOpen0700,
      current_pricing: currentPricing,
      macro_levels: { pdh, pdl },
      active_fvgs: activeFVGs,
      pricing_context: {
        vs_daily_open:
          trueDayOpen0700 !== null && livePrice !== null
            ? livePrice > trueDayOpen0700 ? 'ABOVE_OPEN' : 'BELOW_OPEN'
            : 'UNKNOWN',
        local_dealing_range: localDealingRange,
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The Hook
// ─────────────────────────────────────────────────────────────────────────────
export interface UseBacktestEngineReturn {
  /** Current status of the engine. */
  status: BacktestStatus;
  /** Human-readable error message, null when no error. */
  error: string | null;
  /**
   * Full 24 h dataset for the selected date, all three timeframes.
   * `null` until a successful fetch.
   */
  masterArrays: BtMasterArrays | null;
  /**
   * The sliced "visible" dataset — what the chart renders at any given step.
   * Updated by Next/Prev/RevealDay actions.
   */
  visibleArrays: BtMasterArrays | null;
  /**
   * Index into `masterArrays.candles_5m` that marks the "current" candle.
   * `visibleArrays.candles_5m` = `masterArrays.candles_5m.slice(0, currentIndex)`.
   */
  currentIndex: number;
  /** Total number of 5m candles in the master dataset. */
  totalCandles: number;
  /** Currently active display timeframe (controls which array feeds the chart). */
  timeframe: BacktestTimeframe;
  /** The selected date string "YYYY-MM-DD". */
  selectedDate: string;
  /**
   * Cut-off time expressed as "HH:MM" in Cairo local time.
   * Default: "09:00".
   */
  cutoffTime: string;
  /**
   * Silent enriched JSON payload — updated on every Next/Prev/Reveal action.
   * Ready to download or copy to clipboard.
   */
  enrichedPayload: Record<string, unknown> | null;
  /** Whether the full day has been revealed. */
  isDayRevealed: boolean;

  // ── Actions ─────────────────────────────────────────────────────────────
  setSelectedDate: (date: string) => void;
  setCutoffTime: (time: string) => void;
  setTimeframe: (tf: BacktestTimeframe) => void;
  /** Fetch the full day klines and slice to cutoff. */
  loadDay: () => Promise<void>;
  /** Advance by one 5m candle (Next Candle ⏩). */
  nextCandle: () => void;
  /** Step back by one 5m candle (Prev Candle ⏪). */
  prevCandle: () => void;
  /** Reveal the remaining candles of the day (Reveal Day 👁️). */
  revealDay: () => void;
  /** Download the current enriched JSON payload as a file. */
  downloadPayload: () => void;
  /** Copy the current enriched JSON payload to the clipboard. */
  copyPayload: () => Promise<void>;
}

export function useBacktestEngine(): UseBacktestEngineReturn {
  // ── Core state ───────────────────────────────────────────────────────────
  const [status, setStatus] = useState<BacktestStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [masterArrays, setMasterArrays] = useState<BtMasterArrays | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isDayRevealed, setIsDayRevealed] = useState<boolean>(false);

  // ── UI config state ──────────────────────────────────────────────────────
  // Default date = today in Cairo (UTC+3)
  const todayCairo = new Date(Date.now() + UTC_PLUS3_MS);
  const todayStr = todayCairo.toISOString().slice(0, 10); // "YYYY-MM-DD"

  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [cutoffTime, setCutoffTime] = useState<string>('09:00');
  const [timeframe, setTimeframe] = useState<BacktestTimeframe>('5m');

  // ── Derived: cutoff hour/minute ──────────────────────────────────────────
  const { cutoffHour, cutoffMinute } = useMemo(() => {
    const [hStr, mStr] = cutoffTime.split(':');
    return {
      cutoffHour: parseInt(hStr ?? '9', 10),
      cutoffMinute: parseInt(mStr ?? '0', 10),
    };
  }, [cutoffTime]);

  // ── Derived: cutoffIndex in the 5m master array ──────────────────────────
  const cutoffIndex5m = useMemo(() => {
    if (!masterArrays) return 0;
    return findCutoffIndex(masterArrays.candles_5m, cutoffHour, cutoffMinute);
  }, [masterArrays, cutoffHour, cutoffMinute]);

  // ── Derived: total candles ───────────────────────────────────────────────
  const totalCandles = masterArrays?.candles_5m.length ?? 0;

  // ── Derived: visible arrays (sliced at currentIndex for 5m) ─────────────
  // For 1h and 15m we find the matching time boundary from currentIndex.
  const visibleArrays = useMemo<BtMasterArrays | null>(() => {
    if (!masterArrays || currentIndex === 0) return null;

    const visible5m = masterArrays.candles_5m.slice(0, currentIndex);

    // Derive a UTC ms boundary from the last visible 5m candle
    const boundaryMs = visible5m.length > 0
      ? visible5m[visible5m.length - 1].t + 5 * 60 * 1000  // exclusive upper bound
      : 0;

    const visible15m = masterArrays.candles_15m.filter((c) => c.t < boundaryMs);
    const visible1h = masterArrays.candles_1h.filter((c) => c.t < boundaryMs);

    return {
      candles_5m: visible5m,
      candles_15m: visible15m,
      candles_1h: visible1h,
    };
  }, [masterArrays, currentIndex]);

  // ── Derived: enriched payload (silently recalculated) ────────────────────
  const enrichedPayload = useMemo<Record<string, unknown> | null>(() => {
    if (!visibleArrays) return null;
    return buildEnrichedPayload(visibleArrays, selectedDate);
  }, [visibleArrays, selectedDate]);

  // ── Actions ──────────────────────────────────────────────────────────────

  /** Fetch a fresh 24 h day, store in masterArrays, set currentIndex to cutoff. */
  const loadDay = useCallback(async () => {
    setStatus('fetching');
    setError(null);
    setMasterArrays(null);
    setCurrentIndex(0);
    setIsDayRevealed(false);

    try {
      const [startMs, endMs] = utcDayRange(selectedDate);

      const [raw1h, raw15m, raw5m] = await Promise.all([
        fetchDayKlines('1h', startMs, endMs),
        fetchDayKlines('15m', startMs, endMs),
        fetchDayKlines('5m', startMs, endMs),
      ]);

      const arrays: BtMasterArrays = {
        candles_1h: raw1h,
        candles_15m: raw15m,
        candles_5m: raw5m,
      };

      setMasterArrays(arrays);

      // Compute cutoffIndex immediately with the fresh data
      const ci = findCutoffIndex(raw5m, cutoffHour, cutoffMinute);
      // Guarantee at least 1 candle is visible (ci = 0 means before all data)
      setCurrentIndex(Math.max(1, ci));

      setStatus('ready');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown fetch error';
      setError(msg);
      setStatus('error');
    }
  }, [selectedDate, cutoffHour, cutoffMinute]);

  /** ⏩ Next Candle — increment currentIndex by 1 (capped at totalCandles). */
  const nextCandle = useCallback(() => {
    if (!masterArrays) return;
    setCurrentIndex((prev) => Math.min(prev + 1, masterArrays.candles_5m.length));
  }, [masterArrays]);

  /** ⏪ Prev Candle — decrement currentIndex by 1 (floor at 1). */
  const prevCandle = useCallback(() => {
    setCurrentIndex((prev) => Math.max(prev - 1, 1));
  }, []);

  /** 👁️ Reveal Day — push all remaining candles to visible. */
  const revealDay = useCallback(() => {
    if (!masterArrays) return;
    setCurrentIndex(masterArrays.candles_5m.length);
    setIsDayRevealed(true);
  }, [masterArrays]);

  /** Download enrichedPayload as a JSON file. */
  const downloadPayload = useCallback(() => {
    if (!enrichedPayload) return;
    const lastCandle = visibleArrays?.candles_5m.slice(-1)[0];
    const ts = lastCandle
      ? new Date(lastCandle.t).toISOString().replace(/[:.]/g, '-').slice(0, 19)
      : 'snapshot';
    const filename = `BT_Enriched_${SYMBOL}_${selectedDate}_@${ts}.json`;
    const blob = new Blob([JSON.stringify(enrichedPayload, null, 2)], {
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

  /** Copy enrichedPayload to clipboard. */
  const copyPayload = useCallback(async () => {
    if (!enrichedPayload) return;
    const text =
      'Act as the Institutional Flow Synthesizer V7.9. ' +
      'Analyze the following HISTORICAL backtest data and provide a mechanical bias report:\n\n' +
      JSON.stringify(enrichedPayload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts
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
    // State
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
    // Actions
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
