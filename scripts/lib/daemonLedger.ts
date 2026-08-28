/**
 * daemonLedger.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Atomic Local & Database Persistence Ledger for Flow-State Headless Daemon.
 * Records live execution events to JSON session logs and appends completed trades
 * to the institutional ETHUSDC_Daily_Tracker.json.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import { StrategyExecutionPosition } from '../../src/lib/quantEngine/AutomatedStrategyExecutionEngine';

export interface DaemonSessionEvent {
  id: string;
  type:
    | 'BOOT'
    | 'HEARTBEAT'
    | 'LIMIT_ORDER_PLACED'
    | 'LIMIT_ORDER_CANCELLED'
    | 'ORDER_FILLED'
    | 'STAGE_1_HARVEST'
    | 'STAGE_2_HARVEST'
    | 'POSITION_CLOSED'
    | 'ERROR';
  timestamp: number;
  timeIso: string;
  message: string;
  livePrice?: number;
  position?: Partial<StrategyExecutionPosition>;
  metadata?: Record<string, any>;
}

export interface DaemonSessionLog {
  sessionId: string;
  dateStr: string;
  symbol: string;
  bootTime: number;
  bootTimeIso: string;
  initialEquity: number;
  currentEquity: number;
  totalRealizedR: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  events: DaemonSessionEvent[];
  completedTrades: StrategyExecutionPosition[];
}

export class DaemonLedger {
  private sessionDir: string;
  private runLogPath: string;
  private trackerJsonPath: string;
  private sessionLog: DaemonSessionLog;

  constructor(symbol: string = 'ETHUSDC', initialEquity: number = 10000.0) {
    const today = new Date().toISOString().split('T')[0];
    const rootDir = process.cwd();

    this.sessionDir = path.join(rootDir, 'run_logs');
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    this.runLogPath = path.join(this.sessionDir, `live_session_${today}.json`);
    this.trackerJsonPath = path.join(rootDir, 'directives', 'ETHUSDC_Daily_Tracker.json');

    const sessionId = `session_${symbol.toLowerCase()}_${today}_${Date.now()}`;

    // Load existing session log if exists, else create new
    if (fs.existsSync(this.runLogPath)) {
      try {
        const raw = fs.readFileSync(this.runLogPath, 'utf8');
        this.sessionLog = JSON.parse(raw);
      } catch {
        this.sessionLog = this.createNewSessionLog(sessionId, today, symbol, initialEquity);
      }
    } else {
      this.sessionLog = this.createNewSessionLog(sessionId, today, symbol, initialEquity);
    }

    this.flushToDisk();
  }

  private createNewSessionLog(
    sessionId: string,
    dateStr: string,
    symbol: string,
    initialEquity: number
  ): DaemonSessionLog {
    return {
      sessionId,
      dateStr,
      symbol: symbol.toUpperCase(),
      bootTime: Date.now(),
      bootTimeIso: new Date().toISOString(),
      initialEquity,
      currentEquity: initialEquity,
      totalRealizedR: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      events: [],
      completedTrades: [],
    };
  }

  /**
   * Log an event into the session log.
   */
  public logEvent(
    type: DaemonSessionEvent['type'],
    message: string,
    options: {
      livePrice?: number;
      position?: Partial<StrategyExecutionPosition>;
      metadata?: Record<string, any>;
    } = {}
  ): void {
    const now = Date.now();
    const event: DaemonSessionEvent = {
      id: `evt_${now}_${Math.random().toString(36).substring(2, 7)}`,
      type,
      timestamp: now,
      timeIso: new Date(now).toISOString(),
      message,
      livePrice: options.livePrice,
      position: options.position,
      metadata: options.metadata,
    };

    this.sessionLog.events.push(event);

    // If trade closed, update stats
    if (type === 'POSITION_CLOSED' && options.position) {
      const pos = options.position as StrategyExecutionPosition;
      this.sessionLog.completedTrades.push(pos);
      this.sessionLog.totalTrades += 1;

      const realizedR = pos.realizedR || 0;
      this.sessionLog.totalRealizedR = parseFloat((this.sessionLog.totalRealizedR + realizedR).toFixed(4));
      this.sessionLog.currentEquity = parseFloat(
        (this.sessionLog.currentEquity + (pos.realizedUsd || 0)).toFixed(2)
      );

      if (realizedR > 0) {
        this.sessionLog.winningTrades += 1;
      } else if (realizedR < 0) {
        this.sessionLog.losingTrades += 1;
      }

      // Sync to ETHUSDC_Daily_Tracker.json
      this.appendToDailyTracker(pos);
    }

    this.flushToDisk();
  }

  /**
   * Appends completed trade to directives/ETHUSDC_Daily_Tracker.json.
   */
  private appendToDailyTracker(pos: StrategyExecutionPosition): void {
    try {
      if (!fs.existsSync(this.trackerJsonPath)) return;

      const raw = fs.readFileSync(this.trackerJsonPath, 'utf8');
      const tracker = JSON.parse(raw);

      if (!tracker.trades || !Array.isArray(tracker.trades)) {
        tracker.trades = [];
      }

      // Format trade record matching SOP Tracker schema
      const tradeRecord = {
        trade_id: pos.id,
        date: new Date(pos.openTime || Date.now()).toISOString().split('T')[0],
        session: pos.anchorName || 'NEW_YORK',
        pair: pos.symbol || 'ETHUSDC',
        direction: pos.direction,
        timeframe: pos.timeframe || '5m',
        strategy: pos.strategyName || '5m Sweep & Reclaim',
        entry_price: pos.entryPrice,
        stop_loss: pos.initialStopLoss,
        take_profit_1: pos.stage1Target,
        take_profit_2: pos.stage2Target,
        take_profit_3: pos.stage3Target,
        exit_price: pos.exitPrice,
        outcome: (pos.realizedR || 0) >= 0 ? 'WIN' : 'LOSS',
        realized_pnl_usd: pos.realizedUsd || 0,
        realized_r: pos.realizedR || 0,
        status: 'CLOSED',
        open_time: new Date(pos.openTime || Date.now()).toISOString(),
        close_time: new Date(pos.closeTime || Date.now()).toISOString(),
        execution_source: 'LOCAL_HEADLESS_DAEMON',
        notes: `[Auto 5m S&R] Exit: ${pos.exitReason} | Realized R: ${pos.realizedR?.toFixed(2)}R`,
      };

      // Check if trade already exists
      const exists = tracker.trades.some((t: any) => t.trade_id === pos.id);
      if (!exists) {
        tracker.trades.push(tradeRecord);
        fs.writeFileSync(this.trackerJsonPath, JSON.stringify(tracker, null, 2), 'utf8');
        console.log(`[DAEMON_LEDGER] 📜 Trade ${pos.id} appended to ETHUSDC_Daily_Tracker.json.`);
      }
    } catch (err) {
      console.warn('[DAEMON_LEDGER] Warning appending to ETHUSDC_Daily_Tracker.json:', err);
    }
  }

  /**
   * Flush in-memory session log to disk.
   */
  private flushToDisk(): void {
    try {
      fs.writeFileSync(this.runLogPath, JSON.stringify(this.sessionLog, null, 2), 'utf8');
    } catch (err) {
      console.error('[DAEMON_LEDGER] Error saving session log to disk:', err);
    }
  }

  public getSessionLog(): DaemonSessionLog {
    return this.sessionLog;
  }

  public getRunLogPath(): string {
    return this.runLogPath;
  }
}
