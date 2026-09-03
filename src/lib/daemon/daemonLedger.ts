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
import { StrategyExecutionPosition } from '../quantEngine/AutomatedStrategyExecutionEngine';
import { formatCairoDateTime } from '../quantEngine/equityCalculator';

export interface DaemonSessionEvent {
  id: string;
  type:
    | 'BOOT'
    | 'HEARTBEAT'
    | 'SESSION_ROLLOVER'
    | 'LIMIT_ORDER_PLACED'
    | 'LIMIT_ORDER_CANCELLED'
    | 'ORDER_FILLED'
    | 'STAGE_1_HARVEST'
    | 'STAGE_2_HARVEST'
    | 'POSITION_CLOSED'
    | 'EMERGENCY_FLATTEN'
    | 'ERROR';
  timestamp: number;
  timeIso: string;
  timeCairo?: string;
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
  bootTimeCairo?: string;
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
  private symbol: string;

  constructor(symbol: string = 'ETHUSDC', initialEquity: number = 10000.0) {
    this.symbol = symbol.toUpperCase();
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
    const now = Date.now();
    return {
      sessionId,
      dateStr,
      symbol: symbol.toUpperCase(),
      bootTime: now,
      bootTimeIso: new Date(now).toISOString(),
      bootTimeCairo: formatCairoDateTime(now),
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
   * Automatically checks if the current timestamp has crossed midnight 00:00:00 UTC.
   * If crossed, gracefully finalizes the existing session log and rolls over to a fresh
   * live_session_YYYY-MM-DD.json without dropping active in-flight positions or requiring daemon restart.
   */
  public checkAndPerformDateRollover(timestamp: number = Date.now()): boolean {
    const targetDateStr = new Date(timestamp).toISOString().split('T')[0];
    if (targetDateStr === this.sessionLog.dateStr) {
      return false; // Still within active session day
    }

    console.log(`\n===============================================================`);
    console.log(` 🌅 [SESSION ROLLOVER] Midnight UTC Boundary Crossed (${this.sessionLog.dateStr} ➔ ${targetDateStr})`);
    console.log(`===============================================================`);

    // 1. Finalize previous day's session
    const oldDateStr = this.sessionLog.dateStr;
    const carryForwardEquity = this.sessionLog.currentEquity;
    this.sessionLog.events.push({
      id: `evt_${timestamp}_rollover_close`,
      type: 'SESSION_ROLLOVER',
      timestamp,
      timeIso: new Date(timestamp).toISOString(),
      timeCairo: formatCairoDateTime(timestamp),
      message: `Session finalized at midnight 00:00 UTC. Rolled over to session ${targetDateStr}.`,
      metadata: { finalizedDate: oldDateStr, closingEquity: carryForwardEquity },
    });
    this.flushToDisk();
    console.log(`[DAEMON_LEDGER] 💾 Finalized session log: ${this.runLogPath}`);

    // 2. Initialize fresh session log for the new UTC day
    const newSessionId = `session_${this.symbol.toLowerCase()}_${targetDateStr}_${timestamp}`;
    this.runLogPath = path.join(this.sessionDir, `live_session_${targetDateStr}.json`);
    this.sessionLog = this.createNewSessionLog(newSessionId, targetDateStr, this.symbol, carryForwardEquity);

    // 3. Log rollover startup event in new session
    this.sessionLog.events.push({
      id: `evt_${timestamp}_rollover_boot`,
      type: 'BOOT',
      timestamp,
      timeIso: new Date(timestamp).toISOString(),
      timeCairo: formatCairoDateTime(timestamp),
      message: `Headless daemon rolled over to new session ${targetDateStr} with equity $${carryForwardEquity.toFixed(2)} USD.`,
      metadata: { previousDate: oldDateStr, startingEquity: carryForwardEquity },
    });
    this.flushToDisk();
    console.log(`[DAEMON_LEDGER] 🟢 New active session initialized: ${this.runLogPath}\n`);

    return true;
  }

  /**
   * Log an event into the session log with automatic date rollover check.
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
    this.checkAndPerformDateRollover(now);

    const event: DaemonSessionEvent = {
      id: `evt_${now}_${Math.random().toString(36).substring(2, 7)}`,
      type,
      timestamp: now,
      timeIso: new Date(now).toISOString(),
      timeCairo: formatCairoDateTime(now),
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
   * Scans the session log events to retrieve any active in-flight position
   * or pending limit order that has not been closed.
   */
  public getActiveInFlightPositions(): StrategyExecutionPosition[] {
    const activeMap = new Map<string, StrategyExecutionPosition>();

    for (const evt of this.sessionLog.events) {
      if (
        (evt.type === 'LIMIT_ORDER_PLACED' ||
          evt.type === 'ORDER_FILLED' ||
          evt.type === 'STAGE_1_HARVEST' ||
          evt.type === 'STAGE_2_HARVEST') &&
        evt.position?.id
      ) {
        activeMap.set(evt.position.id, evt.position as StrategyExecutionPosition);
      } else if (evt.type === 'POSITION_CLOSED' && evt.position?.id) {
        activeMap.delete(evt.position.id);
      } else if (evt.type === 'LIMIT_ORDER_CANCELLED' && evt.position?.id) {
        activeMap.delete(evt.position.id);
      }
    }

    return Array.from(activeMap.values());
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
        open_time_cairo: formatCairoDateTime(pos.openTime || Date.now()),
        close_time: new Date(pos.closeTime || Date.now()).toISOString(),
        close_time_cairo: formatCairoDateTime(pos.closeTime || Date.now()),
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
