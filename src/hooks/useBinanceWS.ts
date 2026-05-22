/**
 * useBinanceWS.ts — Phase 1: Binance Futures Live Tick Hook
 *
 * CRITICAL RULES (enforced here):
 *  1. This hook is STRICTLY client-side. No API route involvement.
 *  2. `liveCandle` is ONLY for visual updates (lightweight-charts + HUD).
 *  3. This state MUST NEVER be merged into the Enriched AI JSON payload.
 *     The AI snapshot is a stable backend fetch — it is immutable from this hook's POV.
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single live candle bar as received from Binance and shaped for lightweight-charts */
export interface LiveCandle {
  /**
   * Bar open time as lightweight-charts UTCTimestamp (UNIX seconds).
   * IMPORTANT: includes the same UTC+3 offset baked in by the backend
   * `formatCandles()` so it aligns with the historical series time scale.
   */
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed?: boolean;
}

export type WSStatus = 'CONNECTING' | 'OPEN' | 'CLOSED' | 'ERROR';

export interface UseBinanceWSOptions {
  /** e.g. 'ethusdt'. Defaults to 'ethusdt' */
  symbol?: string;
  /** Kline interval. Defaults to '5m' */
  interval?: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h';
  /** Set to false to disable the connection entirely (e.g. during server render) */
  enabled?: boolean;
}

export interface UseBinanceWSReturn {
  /** The most recent live candle. Null until first message arrives. */
  liveCandle: LiveCandle | null;
  /** WebSocket connection status */
  status: WSStatus;
  /** Current live close price — convenience accessor for the HUD */
  livePrice: number | null;
  /** Manually force a reconnect (e.g. user presses a "Reconnect" button) */
  reconnect: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * ⚠️ MIGRATION NOTE (April 2026):
 * Binance decommissioned the legacy `/ws` endpoint for market data streams.
 * Kline streams must now connect to `/market/ws`.
 * Old (dead): wss://fstream.binance.com/ws/ethusdc@kline_5m
 * New (live):  wss://fstream.binance.com/market/ws/ethusdc@kline_5m
 */
const BINANCE_WS_BASE = 'wss://fstream.binance.com/market/ws';

/**
 * UTC+3 offset in seconds — MUST match the `utcPlus3OffsetMs` applied by the
 * backend `formatCandles()` in `/api/market-data/route.ts` (line 70-77).
 * Historical candle `t` values are stored as: `binance_open_time_ms + 10_800_000 ms`
 * then divided by 1000 in Chart.tsx → unix seconds with +3h baked in.
 * The live WS tick must carry the same offset or lightweight-charts will
 * silently reject .update() (incoming time < last bar time).
 */
const UTC_PLUS_3_OFFSET_S = 3 * 60 * 60; // 10_800 seconds
const BACKOFF_BASE_MS = 1_000;   // 1s initial delay
const BACKOFF_MAX_MS = 30_000;  // 30s ceiling
const BACKOFF_FACTOR = 2;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBinanceWS({
  symbol = 'ethusdc',
  interval = '5m',
  enabled = true,
}: UseBinanceWSOptions = {}): UseBinanceWSReturn {

  const [liveCandle, setLiveCandle] = useState<LiveCandle | null>(null);
  const [status, setStatus] = useState<WSStatus>('CLOSED');

  // ---- Refs that must NOT trigger re-renders ----
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A stable ref so connect() closure can check whether it should bail */
  const isDestroyedRef = useRef<boolean>(false);
  /** Allows external callers to trigger a manual reconnect */
  const manualRetrigger = useRef<number>(0);
  /**
   * Holds the deferred-connect setTimeout handle.
   * Used to cancel the initial connection attempt during React Strict Mode's
   * first (dev-only) mount/unmount cycle before any WebSocket is created.
   */
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Indirection ref so `connect`'s ws.onclose handler always calls the LATEST
   * version of scheduleReconnect without being frozen in a stale closure.
   * (scheduleReconnect is defined after connect — calling it directly from
   * inside connect's useCallback closure captures `undefined` on first render.)
   */
  const scheduleReconnectRef = useRef<() => void>(() => { });

  // Keep a stable ref to the current liveCandle so other logic can read it
  // synchronously without adding it as a useEffect dependency.
  const liveCandleRef = useRef<LiveCandle | null>(null);

  // ---------------------------------------------------------------------------
  // Parser: Binance kline message → LiveCandle
  // ---------------------------------------------------------------------------
  const parseMessage = useCallback((raw: MessageEvent<string>): LiveCandle | null => {
    try {
      const msg = JSON.parse(raw.data) as {
        e: string;
        k: {
          t: number; // Open time ms
          o: string;
          h: string;
          l: string;
          c: string;
          v: string;
          x: boolean; // Candle is closed flag
        };
      };

      // Guard: only process kline events
      if (msg.e !== 'kline' || !msg.k) return null;

      const k = msg.k;
      return {
        // +10_800s: mirrors the utcPlus3OffsetMs the backend bakes into every
        // historical candle (route.ts → formatCandles). Without this the time
        // sent to .update() would be 3h behind the last bar and be silently dropped.
        time: (Math.floor(k.t / 1000) + UTC_PLUS_3_OFFSET_S) as UTCTimestamp,
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        isClosed: k.x,
      };
    } catch {
      return null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Core: connect
  // ---------------------------------------------------------------------------
  const connect = useCallback(() => {
    // Bail if the hook has been torn down (handles React Strict Mode double-invoke)
    if (isDestroyedRef.current) return;

    // Close any existing socket cleanly before opening a new one.
    // Guard: skip close() on a CONNECTING socket to avoid the browser error.
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      if (wsRef.current.readyState !== WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
    const url = `${BINANCE_WS_BASE}/${streamName}`;

    setStatus('CONNECTING');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (isDestroyedRef.current) { ws.close(); return; }
      retryCountRef.current = 0; // reset backoff on successful open
      setStatus('OPEN');
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      if (isDestroyedRef.current) return;
      const candle = parseMessage(event);
      if (candle) {
        liveCandleRef.current = candle;
        setLiveCandle(candle);
      }
    };

    ws.onerror = () => {
      if (isDestroyedRef.current) return;
      setStatus('ERROR');
      // onclose fires right after onerror on WebSocket — reconnect is handled there
    };

    ws.onclose = () => {
      if (isDestroyedRef.current) return;
      setStatus('CLOSED');
      // Always call via ref to avoid the stale-closure trap:
      // connect() is defined before scheduleReconnect, so a direct call
      // would capture undefined on the first render.
      scheduleReconnectRef.current();
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval, parseMessage]);

  // ---------------------------------------------------------------------------
  // Exponential backoff scheduler
  // ---------------------------------------------------------------------------
  const scheduleReconnect = useCallback(() => {
    if (isDestroyedRef.current) return;

    // Clear any pending retry timer
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const delay = Math.min(
      BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, retryCountRef.current),
      BACKOFF_MAX_MS,
    );

    retryCountRef.current += 1;

    retryTimerRef.current = setTimeout(() => {
      if (!isDestroyedRef.current) {
        connect();
      }
    }, delay);
  }, [connect]);

  // Keep the ref in sync so connect's ws.onclose always calls the live version
  scheduleReconnectRef.current = scheduleReconnect;

  // ---------------------------------------------------------------------------
  // Public: manual reconnect (resets backoff counter)
  // ---------------------------------------------------------------------------
  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    manualRetrigger.current += 1;
    connect();
  }, [connect]);

  // ---------------------------------------------------------------------------
  // Effect: mount / unmount lifecycle
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // SSR guard — WebSocket is not available on the server
    if (typeof window === 'undefined') return;
    if (!enabled) return;

    isDestroyedRef.current = false;

    // ── Strict Mode Race Condition Fix ──────────────────────────────────────
    // In React 19 dev mode, effects fire twice (mount → unmount → mount).
    // Calling connect() synchronously means the cleanup from the *first* cycle
    // calls ws.close() on a socket still in CONNECTING state, producing:
    //   "WebSocket is closed before the connection is established"
    //
    // The 75 ms delay ensures the first-cycle cleanup (which runs within ~1 ms)
    // will cancel connectTimerRef before a WebSocket is ever created.
    // On the real second mount the timer fires normally.
    connectTimerRef.current = setTimeout(() => {
      if (!isDestroyedRef.current) {
        connect();
      }
    }, 75);

    // Cleanup: called on unmount OR when deps change (symbol/interval hot-swap)
    return () => {
      isDestroyedRef.current = true;

      // Cancel the deferred-connect timer (main guard against Strict Mode thrash)
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }

      // Cancel any pending reconnect timer
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      // Tear down the WebSocket gracefully.
      // Guard: calling close() on a CONNECTING socket is what triggers the
      // browser error. Only close if the socket has advanced past that state.
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        if (wsRef.current.readyState !== WebSocket.CONNECTING) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
    };
  }, [connect, enabled]);

  // ---------------------------------------------------------------------------
  // Derived state: live price
  // ---------------------------------------------------------------------------
  const livePrice = liveCandle?.close ?? null;

  return { liveCandle, status, livePrice, reconnect };
}
