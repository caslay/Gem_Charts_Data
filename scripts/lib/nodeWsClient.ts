/**
 * nodeWsClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Native Node.js Multi-Stream WebSocket Client for Flow-State Headless Daemon.
 * Subscribes to Binance Futures kline streams (5m, 15m, 1h) and real-time
 * trade ticks (aggTrade) with auto-reconnection and ring-buffer maintenance.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import WebSocket from 'ws';
import { Candle } from '../../src/lib/fvgEngine';

export interface NodeWsClientOptions {
  symbol?: string; // e.g. 'ETHUSDC'
  ringBufferSize?: number; // default 500 bars per timeframe
  multiStreamBase?: string; // default wss://fstream.binance.com/market/stream
  enableAggTrade?: boolean; // default true for sub-millisecond execution
}

export type WSConnectionStatus = 'CONNECTING' | 'OPEN' | 'CLOSED' | 'ERROR' | 'RECONNECTING';

export interface CandleClosedPayload {
  interval: '5m' | '15m' | '1h';
  candle: Candle;
  closedAt: number;
}

export interface MarketTickPayload {
  symbol: string;
  price: number;
  quantity: number;
  timestamp: number;
  isBuyerMaker: boolean;
}

export class NodeWsClient {
  private symbol: string;
  private ringBufferSize: number;
  private multiStreamBase: string;
  private enableAggTrade: boolean;

  private ws: WebSocket | null = null;
  private status: WSConnectionStatus = 'CLOSED';
  private retryCount = 0;
  private isDestroyed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;

  // In-memory candle ring buffers
  private buffers: {
    '5m': Candle[];
    '15m': Candle[];
    '1h': Candle[];
  } = {
    '5m': [],
    '15m': [],
    '1h': [],
  };

  // Active forming candles
  private activeCandles: Record<string, Candle> = {};

  // Event Listeners
  private tickListeners: Array<(payload: MarketTickPayload) => void> = [];
  private candleClosedListeners: Array<(payload: CandleClosedPayload) => void> = [];
  private statusListeners: Array<(status: WSConnectionStatus) => void> = [];

  constructor(options: NodeWsClientOptions = {}) {
    this.symbol = (options.symbol || 'ETHUSDC').toLowerCase();
    this.ringBufferSize = options.ringBufferSize || 500;
    this.multiStreamBase = options.multiStreamBase || 'wss://fstream.binance.com/market/stream';
    this.enableAggTrade = options.enableAggTrade !== false;
  }

  /**
   * Seed existing historical buffers from REST bootstrap.
   */
  public seedBuffers(buffers: { '5m': Candle[]; '15m': Candle[]; '1h': Candle[] }): void {
    this.buffers['5m'] = [...buffers['5m'].slice(-this.ringBufferSize)];
    this.buffers['15m'] = [...buffers['15m'].slice(-this.ringBufferSize)];
    this.buffers['1h'] = [...buffers['1h'].slice(-this.ringBufferSize)];
    console.log(
      `[NODE_WS] 📦 Ring buffers seeded: 5m (${this.buffers['5m'].length}), 15m (${this.buffers['15m'].length}), 1h (${this.buffers['1h'].length})`
    );
  }

  /**
   * Retrieve clone of current ring buffers.
   */
  public getRingBuffers(): { '5m': Candle[]; '15m': Candle[]; '1h': Candle[] } {
    return {
      '5m': [...this.buffers['5m']],
      '15m': [...this.buffers['15m']],
      '1h': [...this.buffers['1h']],
    };
  }

  /**
   * Register event listeners.
   */
  public onMarketTick(cb: (payload: MarketTickPayload) => void): () => void {
    this.tickListeners.push(cb);
    return () => {
      this.tickListeners = this.tickListeners.filter((l) => l !== cb);
    };
  }

  public onCandleClosed(cb: (payload: CandleClosedPayload) => void): () => void {
    this.candleClosedListeners.push(cb);
    return () => {
      this.candleClosedListeners = this.candleClosedListeners.filter((l) => l !== cb);
    };
  }

  public onStatusChange(cb: (status: WSConnectionStatus) => void): () => void {
    this.statusListeners.push(cb);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== cb);
    };
  }

  private setStatus(newStatus: WSConnectionStatus): void {
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      try {
        listener(newStatus);
      } catch (err) {
        console.error('[NODE_WS] Listener error in status change:', err);
      }
    }
  }

  /**
   * Connect to Binance Multi-Stream.
   */
  public async connect(): Promise<void> {
    if (this.isDestroyed) return;

    this.cleanupSocket();

    const sym = this.symbol;
    const streams = [
      `${sym}@kline_5m`,
      `${sym}@kline_15m`,
      `${sym}@kline_1h`,
    ];

    if (this.enableAggTrade) {
      streams.push(`${sym}@aggTrade`);
    }

    const url = `${this.multiStreamBase}?streams=${streams.join('/')}`;
    this.setStatus('CONNECTING');
    console.log(`[NODE_WS] 🌐 Connecting to Binance Futures Multi-Stream: ${streams.join(', ')}...`);

    try {
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        if (this.isDestroyed) {
          this.cleanupSocket();
          return;
        }
        this.retryCount = 0;
        this.setStatus('OPEN');
        console.log(`[NODE_WS] 🟢 Connected successfully to Binance Futures WebSocket!`);

        // Start heartbeat ping
        this.startHeartbeat();
      });

      this.ws.on('message', (data: any) => {
        if (this.isDestroyed) return;
        const rawData = typeof data === 'string' ? data : data?.toString?.();
        if (!rawData) return;
        this.handleMessage(rawData);
      });

      this.ws.on('error', (err: any) => {
        if (this.isDestroyed) return;
        console.warn(`[NODE_WS] ⚠️ WebSocket error encountered:`, err?.message || err);
        this.setStatus('ERROR');
      });

      this.ws.on('close', () => {
        if (this.isDestroyed) return;
        console.warn(`[NODE_WS] 🔴 WebSocket connection closed. Scheduling reconnect...`);
        this.setStatus('CLOSED');
        this.scheduleReconnect();
      });
    } catch (err) {
      console.error('[NODE_WS] Exception creating WebSocket:', err);
      this.setStatus('ERROR');
      this.scheduleReconnect();
    }
  }

  private handleMessage(rawData: string): void {
    try {
      const parsed = JSON.parse(rawData);
      const stream = parsed.stream;
      const data = parsed.data || parsed;

      if (!data) return;

      // ── A. Process Real-Time Aggregate Trade Ticks ──
      if (data.e === 'aggTrade') {
        const price = parseFloat(data.p);
        const qty = parseFloat(data.q);
        const timestamp = Number(data.T || data.E);
        const isBuyerMaker = data.m === true;

        if (!isNaN(price) && price > 0) {
          const payload: MarketTickPayload = {
            symbol: this.symbol.toUpperCase(),
            price,
            quantity: qty,
            timestamp,
            isBuyerMaker,
          };
          for (const listener of this.tickListeners) {
            listener(payload);
          }
        }
        return;
      }

      // ── B. Process Multi-Timeframe Kline Data ──
      if (data.e === 'kline' && data.k) {
        const k = data.k;
        const interval = k.i as '5m' | '15m' | '1h';
        if (!['5m', '15m', '1h'].includes(interval)) return;

        const volume = parseFloat(k.v);
        const taker_buy_vol = parseFloat(k.V || '0');
        const taker_sell_vol = parseFloat((volume - taker_buy_vol).toFixed(4));
        const isClosed = k.x === true;

        const candle: Candle = {
          t: Number(k.t),
          o: parseFloat(k.o),
          h: parseFloat(k.h),
          l: parseFloat(k.l),
          c: parseFloat(k.c),
          v: volume,
          taker_buy_vol,
          taker_sell_vol,
          isClosed,
        };

        this.activeCandles[interval] = candle;

        // If aggTrade is not active, emit tick from kline close price
        if (!this.enableAggTrade) {
          const payload: MarketTickPayload = {
            symbol: this.symbol.toUpperCase(),
            price: candle.c,
            quantity: volume,
            timestamp: Date.now(),
            isBuyerMaker: false,
          };
          for (const listener of this.tickListeners) {
            listener(payload);
          }
        }

        // ── When candle closes (k.x === true) ──
        if (isClosed) {
          const buffer = this.buffers[interval];
          
          // Deduplicate if bar already exists
          const existingIdx = buffer.findIndex((c) => c.t === candle.t);
          if (existingIdx >= 0) {
            buffer[existingIdx] = candle;
          } else {
            buffer.push(candle);
            if (buffer.length > this.ringBufferSize) {
              buffer.shift();
            }
          }

          const closePayload: CandleClosedPayload = {
            interval,
            candle,
            closedAt: Date.now(),
          };

          for (const listener of this.candleClosedListeners) {
            try {
              listener(closePayload);
            } catch (err) {
              console.error(`[NODE_WS] Listener error on ${interval} candle close:`, err);
            }
          }
        }
      }
    } catch (err) {
      // Ignore corrupted frames
    }
  }

  private startHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        try {
          if (typeof this.ws.ping === 'function') {
            this.ws.ping();
          }
        } catch {
          // Ignore ping errors
        }
      }
    }, 60000); // 1 minute keepalive
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.setStatus('RECONNECTING');
    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
    this.retryCount += 1;

    console.log(`[NODE_WS] ⏳ Reconnecting in ${(delay / 1000).toFixed(1)}s (Attempt #${this.retryCount})...`);

    this.reconnectTimer = setTimeout(() => {
      if (!this.isDestroyed) {
        this.connect();
      }
    }, delay);
  }

  private cleanupSocket(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        if (this.ws.readyState === 1 || this.ws.readyState === 0) {
          this.ws.close();
        }
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
  }

  /**
   * Graceful shutdown of socket and timers.
   */
  public stop(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupSocket();
    this.setStatus('CLOSED');
    console.log(`[NODE_WS] 🛑 WebSocket client stopped.`);
  }
}
