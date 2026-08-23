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
   * Operates strictly on raw UTC-0.
   */
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  taker_buy_vol: number;
  taker_sell_vol: number;
  isClosed?: boolean;
}

export type WSStatus = 'CONNECTING' | 'OPEN' | 'CLOSED' | 'ERROR';

export interface ClosedCandleEvent {
  interval: string;
  candle: LiveCandle;
  closedAt: number;
}

export interface UseBinanceWSOptions {
  /** e.g. 'ethusdc'. Defaults to 'ethusdc' */
  symbol?: string;
  /** Kline interval for active visual chart. Defaults to '5m' */
  interval?: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h';
  /** Set to false to disable the connection entirely (e.g. during server render) */
  enabled?: boolean;
  /** Enable background multi-timeframe streaming (1m, 5m, 15m, 1h). Defaults to true */
  multiStreamEnabled?: boolean;
}

export interface UseBinanceWSReturn {
  /** The most recent live candle for the active visual interval. */
  liveCandle: LiveCandle | null;
  /** Live candles dictionary for all streamed timeframes ('1m', '5m', '15m', '1h') */
  liveCandles: Record<string, LiveCandle>;
  /** Event emitted on verified candle closure ('isClosed === true') */
  lastClosedEvent: ClosedCandleEvent | null;
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

const BINANCE_WS_BASE = 'wss://fstream.binance.com/market/ws';
const BINANCE_MULTI_STREAM_BASE = 'wss://fstream.binance.com/market/stream';
const CORE_MTF_INTERVALS = ['1m', '5m', '15m', '1h'] as const;

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
  multiStreamEnabled = true,
}: UseBinanceWSOptions = {}): UseBinanceWSReturn {

  const [liveCandle, setLiveCandle] = useState<LiveCandle | null>(null);
  const [liveCandles, setLiveCandles] = useState<Record<string, LiveCandle>>({});
  const [lastClosedEvent, setLastClosedEvent] = useState<ClosedCandleEvent | null>(null);
  const [status, setStatus] = useState<WSStatus>('CLOSED');

  // ---- Refs that must NOT trigger re-renders ----
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDestroyedRef = useRef<boolean>(false);
  const manualRetrigger = useRef<number>(0);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReconnectRef = useRef<() => void>(() => { });

  const liveCandleRef = useRef<LiveCandle | null>(null);
  const liveCandlesRef = useRef<Record<string, LiveCandle>>({});
  const livePriceRef = useRef<number | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);

  // ---------------------------------------------------------------------------
  // Parser: Binance kline message → LiveCandle + interval
  // ---------------------------------------------------------------------------
  const parseMessage = useCallback((raw: MessageEvent<string>): { candle: LiveCandle; interval: string } | null => {
    try {
      const parsed = JSON.parse(raw.data);
      
      // Multi-stream payload wrapper: { stream: 'ethusdc@kline_5m', data: { e: 'kline', k: {...} } }
      // Single-stream payload: { e: 'kline', k: {...} }
      const msg = (parsed && parsed.data) ? parsed.data : parsed;

      if (!msg || msg.e !== 'kline' || !msg.k) return null;

      const k = msg.k;
      const kInterval = k.i || interval;
      const volume = parseFloat(k.v);
      const taker_buy_vol = parseFloat(k.V || '0');
      const taker_sell_vol = parseFloat((volume - taker_buy_vol).toFixed(4));

      const candle: LiveCandle = {
        time: Math.floor(k.t / 1000) as UTCTimestamp,
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume,
        taker_buy_vol,
        taker_sell_vol,
        isClosed: k.x === true,
      };

      return { candle, interval: kInterval };
    } catch {
      return null;
    }
  }, [interval]);

  // ---------------------------------------------------------------------------
  // Core: connect
  // ---------------------------------------------------------------------------
  const connect = useCallback(() => {
    if (isDestroyedRef.current) return;

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

    const sym = symbol.toLowerCase();
    let url: string;

    if (multiStreamEnabled) {
      // Build combined multi-stream URL for background MTF processing
      const uniqueIntervals = Array.from(new Set([...CORE_MTF_INTERVALS, interval]));
      const streams = uniqueIntervals.map(i => `${sym}@kline_${i}`).join('/');
      url = `${BINANCE_MULTI_STREAM_BASE}?streams=${streams}`;
    } else {
      url = `${BINANCE_WS_BASE}/${sym}@kline_${interval}`;
    }

    setStatus('CONNECTING');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (isDestroyedRef.current) { ws.close(); return; }
      retryCountRef.current = 0;
      setStatus('OPEN');
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      if (isDestroyedRef.current) return;
      const res = parseMessage(event);
      if (!res) return;

      const { candle, interval: msgInterval } = res;

      // ── Outlier Price Sanity Gate (>15% Variance Rejection & Silent Resync) ──
      const currentKnownPrice = livePriceRef.current;
      if (currentKnownPrice !== null && currentKnownPrice > 0) {
        const deviation = Math.abs(candle.close - currentKnownPrice) / currentKnownPrice;
        if (deviation > 0.15) {
          console.warn(`[OUTLIER_DATA_DROP] Rejected WebSocket tick for ${msgInterval} (price: ${candle.close}): deviates >15% from last price ${currentKnownPrice}. Triggering silent resync.`);
          scheduleReconnectRef.current();
          return;
        }
      }

      // Update multi-candles dictionary
      liveCandlesRef.current[msgInterval] = candle;
      livePriceRef.current = candle.close;
      setLivePrice(candle.close);

      // If this message belongs to the active visual interval, update liveCandle
      if (msgInterval === interval) {
        liveCandleRef.current = candle;
        setLiveCandle(candle);
      }

      // Verified Candle Closure Dispatcher
      if (candle.isClosed) {
        setLastClosedEvent({
          interval: msgInterval,
          candle,
          closedAt: Date.now(),
        });
      }
    };

    ws.onerror = () => {
      if (isDestroyedRef.current) return;
      setStatus('ERROR');
    };

    ws.onclose = () => {
      if (isDestroyedRef.current) return;
      setStatus('CLOSED');
      scheduleReconnectRef.current();
    };
  }, [symbol, interval, multiStreamEnabled, parseMessage]);

  // ---------------------------------------------------------------------------
  // Exponential backoff scheduler
  // ---------------------------------------------------------------------------
  const scheduleReconnect = useCallback(() => {
    if (isDestroyedRef.current) return;

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
    if (typeof window === 'undefined') return;
    if (!enabled) return;

    isDestroyedRef.current = false;

    // Reset visual active candle on interval change
    setLiveCandle(null);

    connectTimerRef.current = setTimeout(() => {
      if (!isDestroyedRef.current) {
        connect();
      }
    }, 75);

    return () => {
      isDestroyedRef.current = true;

      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }

      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

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

  return {
    liveCandle,
    liveCandles: liveCandlesRef.current,
    lastClosedEvent,
    status,
    livePrice,
    reconnect
  };
}
