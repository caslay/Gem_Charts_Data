/**
 * headlessScheduler.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow-State Quant Engine — Server-Side Headless Scheduler (PM2 Daemon)
 * ─────────────────────────────────────────────────────────────────────────────
 * 24/7 Autonomous Background Scanning & Proximity Acceleration Worker:
 *  - Tracks physical wall-clock candle closes (15m base cadence and 5m in-zone proximity acceleration).
 *  - Evaluates operational schedule (e.g., Western Sessions window) from PostgreSQL database settings.
 *  - Dynamically accelerates to 5m Turbo cadence when live price enters setup Point of Interest (POI).
 *  - Dispatches multi-model AI cascade evaluations directly from the server without browser dependencies.
 *  - Persists analysis results, telemetry, and updated state directly into PostgreSQL.
 *  - Seamlessly stages qualified ARMED setups into agent_decision_log for Spark Ingestion Dispatcher.
 *  - Atomically writes live scheduler telemetry to run_logs/daemon_scheduler_state.json.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import { sql } from '../postgres';
import { DEFAULT_ETH_SOP_SYSTEM_PROMPT } from '../sopPromptBuilder';
import { DEFAULT_MODEL } from '../aiModels';
import { runAiCascadeEvaluation, ensureAiAnalysisTableInitialized } from '../aiCascadeEngine';
import { buildLiveSessionContext, getNextCandleCloseTimestamp } from '../sessionContext';
import {
  evaluateOperationalSchedule,
  OperationalScheduleConfig,
  ScheduleEvaluationResult,
  DEFAULT_SCHEDULE_MODE,
  DEFAULT_ACTIVE_START,
  DEFAULT_ACTIVE_END,
  DEFAULT_TIMEZONE,
} from '../operationalSchedule';
import { ensureAgentDecisionTableInitialized } from '../agentEngineHandlers';
import { Candle } from '../fvgEngine';
import { DaemonLedger } from './daemonLedger';
import { TelegramNotifier } from '../notifications/telegramNotifier';
import { TelegramBotService } from '../notifications/telegramBotService';
import { SparkIngestionDispatcher } from './sparkIngestionDispatcher';
import { annotateCandlesWithVolumetricSignals } from '../../utils/generateChartMarkers';
import { globalAlertCadenceGovernor } from '../notifications/AlertCadenceGovernor';
import { isDeadZone } from '../temporalGatekeeper';

export interface HeadlessSchedulerOptions {
  symbol?: string;
  getCurrentPrice: (symbol: string) => number | null;
  getRingBuffers: () => Record<string, Candle[]>;
  telegram?: TelegramNotifier | TelegramBotService;
  ledger?: DaemonLedger;
  sparkDispatcher?: SparkIngestionDispatcher;
  allowOfflineFallback?: boolean;
  baseIntervalMinutes?: number; // default: 15
  isTurboEnabled?: boolean;     // default: true
  evaluateAiCascade?: (options: any) => Promise<any>;
}

export interface ActiveSetupContext {
  low: number | null;
  high: number | null;
  invalidation: number | null;
  direction: string | null;
}

export interface DaemonSchedulerStateFile {
  symbol: string;
  isAutoScanActive: boolean;
  isTurboActive: boolean;
  baseIntervalMinutes: number;
  autoScanCadenceMinutes: number;
  nextScanTimestamp: number;
  lastScanDispatchTime: number;
  isWithinActiveSchedule: boolean;
  autoScanResumesAt: string | null;
  autoScanNextOpenTimestamp: number | null;
  scheduleEvaluation: ScheduleEvaluationResult;
  lastScanResult?: {
    status: string;
    biasSignal: string;
    timestamp: string;
    latencyMs: number;
  } | null;
  updatedAt: number;
}

export class HeadlessScheduler {
  private symbol: string;
  private getCurrentPrice: (symbol: string) => number | null;
  private getRingBuffers: () => Record<string, Candle[]>;
  private telegram?: TelegramNotifier | TelegramBotService;
  private ledger?: DaemonLedger;
  private sparkDispatcher?: SparkIngestionDispatcher;
  private allowOfflineFallback: boolean;
  private evaluateAiCascadeFn?: (options: any) => Promise<any>;

  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private isScanning = false;

  private isAutoScanActive = true;
  private baseIntervalMinutes = 15;
  private isTurboEnabled = true;
  private isTurboActive = false;
  private turboScanCount = 0;
  private nextScanTimestamp: number;
  private lastScanDispatchTime = 0;
  private wasSleeping = false;

  private scheduleConfig: OperationalScheduleConfig = {
    scheduleMode: DEFAULT_SCHEDULE_MODE,
    activeStart: DEFAULT_ACTIVE_START,
    activeEnd: DEFAULT_ACTIVE_END,
    timezone: DEFAULT_TIMEZONE,
  };

  private scheduleEvaluation: ScheduleEvaluationResult;
  private activeSetup: ActiveSetupContext | null = null;
  private lastScanResult: any = null;
  private lastSetupRefreshTime = 0;
  private lastSettingsRefreshTime = 0;

  constructor(options: HeadlessSchedulerOptions) {
    this.symbol = (options.symbol || 'ETHUSDC').toUpperCase();
    this.getCurrentPrice = options.getCurrentPrice;
    this.getRingBuffers = options.getRingBuffers;
    this.telegram = options.telegram;
    this.ledger = options.ledger;
    this.sparkDispatcher = options.sparkDispatcher;
    this.allowOfflineFallback = options.allowOfflineFallback ?? false;
    this.evaluateAiCascadeFn = options.evaluateAiCascade;
    this.baseIntervalMinutes = options.baseIntervalMinutes ?? 15;
    this.isTurboEnabled = options.isTurboEnabled ?? true;

    const now = Date.now();
    this.scheduleEvaluation = evaluateOperationalSchedule(this.scheduleConfig, now);
    this.wasSleeping = !this.scheduleEvaluation.isWithinActiveSchedule;

    if (!this.scheduleEvaluation.isWithinActiveSchedule && this.scheduleEvaluation.nextSessionOpenTimestamp) {
      this.nextScanTimestamp = this.scheduleEvaluation.nextSessionOpenTimestamp;
    } else {
      this.nextScanTimestamp = getNextCandleCloseTimestamp(this.baseIntervalMinutes, now);
    }

    // Hydrate persisted state if available
    this.hydrateFromPersistedState();
  }

  /**
   * Reads persisted scheduler state from disk to maintain clock continuity across daemon restarts.
   */
  private hydrateFromPersistedState(): void {
    try {
      const stateFile = path.join(process.cwd(), 'run_logs', 'daemon_scheduler_state.json');
      if (fs.existsSync(stateFile)) {
        const raw = fs.readFileSync(stateFile, 'utf8');
        const state: DaemonSchedulerStateFile = JSON.parse(raw);
        if (typeof state.isAutoScanActive === 'boolean') {
          this.isAutoScanActive = state.isAutoScanActive;
        }
        if (typeof state.baseIntervalMinutes === 'number') {
          this.baseIntervalMinutes = state.baseIntervalMinutes;
        }
        if (typeof state.lastScanDispatchTime === 'number') {
          this.lastScanDispatchTime = state.lastScanDispatchTime;
        }
      }
    } catch (e) {
      // Non-fatal
    }
  }

  /**
   * Persists current scheduler telemetry to run_logs/daemon_scheduler_state.json.
   */
  public persistSchedulerState(): void {
    try {
      const runLogsDir = path.join(process.cwd(), 'run_logs');
      if (!fs.existsSync(runLogsDir)) {
        fs.mkdirSync(runLogsDir, { recursive: true });
      }
      const stateFile = path.join(runLogsDir, 'daemon_scheduler_state.json');
      const stateData: DaemonSchedulerStateFile = {
        symbol: this.symbol,
        isAutoScanActive: this.isAutoScanActive,
        isTurboActive: this.isTurboActive,
        baseIntervalMinutes: this.baseIntervalMinutes,
        autoScanCadenceMinutes: this.isTurboActive ? 5 : this.baseIntervalMinutes,
        nextScanTimestamp: this.nextScanTimestamp,
        lastScanDispatchTime: this.lastScanDispatchTime,
        isWithinActiveSchedule: this.scheduleEvaluation.isWithinActiveSchedule,
        autoScanResumesAt: this.scheduleEvaluation.resumesAtFormatted,
        autoScanNextOpenTimestamp: this.scheduleEvaluation.nextSessionOpenTimestamp,
        scheduleEvaluation: this.scheduleEvaluation,
        lastScanResult: this.lastScanResult,
        updatedAt: Date.now(),
      };
      fs.writeFileSync(stateFile, JSON.stringify(stateData, null, 2), 'utf8');
    } catch {
      // Non-fatal
    }
  }

  /**
   * Start the 24/7 background scheduler loop.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(
      `[HEADLESS_SCHEDULER] 🟢 Autonomous Server-Side Scheduler active for ${this.symbol} (Base Cadence: ${this.baseIntervalMinutes}m, Proximity Turbo: ${this.isTurboEnabled ? 'ENABLED' : 'DISABLED'}).`
    );

    // Initial immediate sync
    this.refreshSettingsAndState(true).catch(() => {});

    // Polling worker running every 1000ms
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.warn('[HEADLESS_SCHEDULER] Tick warning:', err?.message || err);
      });
    }, 1000);
  }

  /**
   * Stop the scheduler loop cleanly.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.persistSchedulerState();
    console.log(`[HEADLESS_SCHEDULER] 🛑 Headless Scheduler stopped.`);
  }

  /**
   * Toggles autonomous scanning state dynamically.
   */
  public setAutoScanActive(active: boolean): void {
    this.isAutoScanActive = active;
    if (active) {
      const now = Date.now();
      const curEval = evaluateOperationalSchedule(this.scheduleConfig, now);
      this.scheduleEvaluation = curEval;
      this.wasSleeping = !curEval.isWithinActiveSchedule;
      let nextTime = getNextCandleCloseTimestamp(this.isTurboActive ? 5 : this.baseIntervalMinutes, now);
      if (!curEval.isWithinActiveSchedule && curEval.nextSessionOpenTimestamp) {
        nextTime = curEval.nextSessionOpenTimestamp;
      }
      this.nextScanTimestamp = nextTime;
    }
    this.persistSchedulerState();
    console.log(`[HEADLESS_SCHEDULER] 🔀 Autonomous scanning set to: ${active ? 'ACTIVE' : 'PAUSED'}`);
  }

  public getSchedulerState(): DaemonSchedulerStateFile {
    return {
      symbol: this.symbol,
      isAutoScanActive: this.isAutoScanActive,
      isTurboActive: this.isTurboActive,
      baseIntervalMinutes: this.baseIntervalMinutes,
      autoScanCadenceMinutes: this.isTurboActive ? 5 : this.baseIntervalMinutes,
      nextScanTimestamp: this.nextScanTimestamp,
      lastScanDispatchTime: this.lastScanDispatchTime,
      isWithinActiveSchedule: this.scheduleEvaluation.isWithinActiveSchedule,
      autoScanResumesAt: this.scheduleEvaluation.resumesAtFormatted,
      autoScanNextOpenTimestamp: this.scheduleEvaluation.nextSessionOpenTimestamp,
      scheduleEvaluation: this.scheduleEvaluation,
      lastScanResult: this.lastScanResult,
      updatedAt: Date.now(),
    };
  }

  /**
   * Evaluates proximity against active setup entry boundaries with 0.05% tolerance band and invalidation guard.
   */
  public evaluateProximityState(): { inZone: boolean; isInvalidated: boolean } {
    if (!this.isTurboEnabled || !this.activeSetup) {
      return { inZone: false, isInvalidated: false };
    }

    const { low, high, invalidation, direction } = this.activeSetup;
    if (low == null || high == null || low <= 0 || high <= 0) {
      return { inZone: false, isInvalidated: false };
    }

    const currentPrice = this.getCurrentPrice(this.symbol);
    if (currentPrice == null || currentPrice <= 0) {
      return { inZone: false, isInvalidated: false };
    }

    let isInvalidated = false;
    if (invalidation != null && invalidation > 0) {
      if ((direction === 'BULLISH' || direction === 'LONG') && currentPrice <= invalidation) {
        isInvalidated = true;
      } else if ((direction === 'BEARISH' || direction === 'SHORT') && currentPrice >= invalidation) {
        isInvalidated = true;
      }
    }

    if (isInvalidated) {
      return { inZone: false, isInvalidated: true };
    }

    const buffer = low * 0.0005; // 0.05% proximity tolerance band
    const inZone = currentPrice >= low - buffer && currentPrice <= high + buffer;

    return { inZone, isInvalidated: false };
  }

  /**
   * Evaluates incoming real-time market ticks.
   */
  public onMarketTick(price: number, symbol: string = this.symbol): void {
    if (symbol.toUpperCase() !== this.symbol) return;
    // Check proximity on tick
    const { inZone, isInvalidated } = this.evaluateProximityState();
    const burnoutReached = this.turboScanCount >= 4;
    const shouldBeTurbo = inZone && !isInvalidated && !burnoutReached && this.scheduleEvaluation.isWithinActiveSchedule;

    if (shouldBeTurbo && !this.isTurboActive) {
      this.isTurboActive = true;
      const now = Date.now();
      const next5m = getNextCandleCloseTimestamp(5, now);
      if (this.nextScanTimestamp > next5m) {
        this.nextScanTimestamp = next5m;
      }
      this.persistSchedulerState();
      console.log(`[HEADLESS_SCHEDULER] ⚡ Elevated to 5m TURBO cadence (POI zone penetrated at $${price.toFixed(2)})`);
    } else if (!shouldBeTurbo && this.isTurboActive) {
      this.isTurboActive = false;
      if (!inZone || isInvalidated) {
        this.turboScanCount = 0;
      }
      const now = Date.now();
      const nextBase = getNextCandleCloseTimestamp(this.baseIntervalMinutes, now);
      if (this.nextScanTimestamp < nextBase) {
        this.nextScanTimestamp = nextBase;
      }
      this.persistSchedulerState();
      console.log(`[HEADLESS_SCHEDULER] ⏳ Relaxed to ${this.baseIntervalMinutes}m Base cadence`);
    }
  }

  /**
   * Evaluates closed candle events.
   */
  public onCandleClosed(interval: string, candle: Candle, symbol: string = this.symbol): void {
    if (symbol.toUpperCase() !== this.symbol) return;
    // Refresh schedule evaluation on candle boundaries
    const now = candle.t || Date.now();
    this.scheduleEvaluation = evaluateOperationalSchedule(this.scheduleConfig, now);
  }

  /**
   * Refreshes active setup from ai_trade_state and operational settings from database.
   */
  private async refreshSettingsAndState(force = false): Promise<void> {
    const now = Date.now();

    // 1. Refresh settings every 10 seconds
    if (force || now - this.lastSettingsRefreshTime > 10000) {
      this.lastSettingsRefreshTime = now;
      try {
        const { rows } = await sql`
          SELECT key_name, key_value FROM system_settings
          WHERE key_name IN (
            'AUTO_SCAN_ACTIVE', 'AUTO_SCAN_BASE_INTERVAL', 'AUTO_SCAN_TURBO_ENABLED',
            'AUTO_SCAN_SCHEDULE_MODE', 'AUTO_SCAN_ACTIVE_START', 'AUTO_SCAN_ACTIVE_END', 'AUTO_SCAN_TIMEZONE'
          )
        `;
        const map = new Map(rows.map((r: any) => [r.key_name, r.key_value]));
        if (map.has('AUTO_SCAN_ACTIVE')) {
          this.isAutoScanActive = map.get('AUTO_SCAN_ACTIVE') !== 'false';
        }
        if (map.has('AUTO_SCAN_BASE_INTERVAL')) {
          const val = parseInt(map.get('AUTO_SCAN_BASE_INTERVAL'), 10);
          if (val === 15 || val === 30) this.baseIntervalMinutes = val;
        }
        if (map.has('AUTO_SCAN_TURBO_ENABLED')) {
          this.isTurboEnabled = map.get('AUTO_SCAN_TURBO_ENABLED') !== 'false';
        }

        this.scheduleConfig = {
          scheduleMode: (map.get('AUTO_SCAN_SCHEDULE_MODE') as any) || this.scheduleConfig.scheduleMode,
          activeStart: map.get('AUTO_SCAN_ACTIVE_START') || this.scheduleConfig.activeStart,
          activeEnd: map.get('AUTO_SCAN_ACTIVE_END') || this.scheduleConfig.activeEnd,
          timezone: map.get('AUTO_SCAN_TIMEZONE') || this.scheduleConfig.timezone,
        };
      } catch (dbErr) {
        // Fallback safely in offline sandbox
      }
    }

    // 2. Refresh active setup geometry from ai_trade_state every 5 seconds
    if (force || now - this.lastSetupRefreshTime > 5000) {
      this.lastSetupRefreshTime = now;
      try {
        const stateResult = await sql`SELECT state_json FROM ai_trade_state WHERE id = 1`;
        if (stateResult.rows.length > 0 && stateResult.rows[0].state_json) {
          const raw = stateResult.rows[0].state_json;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (parsed && typeof parsed === 'object') {
            let low: number | null = null;
            let high: number | null = null;

            if (parsed.entry_range_low != null && parsed.entry_range_high != null) {
              const l = Number(parsed.entry_range_low);
              const h = Number(parsed.entry_range_high);
              if (!isNaN(l) && !isNaN(h) && l > 0 && h > 0) {
                low = Math.min(l, h);
                high = Math.max(l, h);
              }
            }

            const rawInvalidation = parsed.invalidation_level;
            const invalidation =
              typeof rawInvalidation === 'number' && !isNaN(rawInvalidation) && rawInvalidation > 0
                ? rawInvalidation
                : null;

            const rawDir = parsed.trade_direction || (parsed.bias_signal === 1 ? 'LONG' : parsed.bias_signal === -1 ? 'SHORT' : null);
            const direction = typeof rawDir === 'string' ? rawDir.toUpperCase() : null;

            this.activeSetup = { low, high, invalidation, direction };
          }
        }
      } catch {
        // Safe offline fallback
      }
    }
  }

  /**
   * Main scheduler tick running every 1000ms.
   */
  private async tick(): Promise<void> {
    const now = Date.now();

    // Refresh settings & setup
    await this.refreshSettingsAndState();

    // Evaluate operational schedule
    const curEval = evaluateOperationalSchedule(this.scheduleConfig, now);
    this.scheduleEvaluation = curEval;

    // Gate: Off-hours sleep mode
    if (!curEval.isWithinActiveSchedule) {
      this.wasSleeping = true;
      if (this.isTurboActive) {
        this.isTurboActive = false;
      }
      this.turboScanCount = 0;
      if (curEval.nextSessionOpenTimestamp && this.nextScanTimestamp !== curEval.nextSessionOpenTimestamp) {
        this.nextScanTimestamp = curEval.nextSessionOpenTimestamp;
      }
      this.persistSchedulerState();
      return; // Off-hours: suppress scans
    }

    // Transition from sleeping to active schedule window
    if (this.wasSleeping) {
      this.wasSleeping = false;
      const initialTarget = getNextCandleCloseTimestamp(this.baseIntervalMinutes, now);
      this.nextScanTimestamp = initialTarget;
      this.persistSchedulerState();
    }

    // Check Proximity & Turbo Eligibility
    const { inZone, isInvalidated } = this.evaluateProximityState();
    const burnoutReached = this.turboScanCount >= 4;
    const shouldBeTurbo = inZone && !isInvalidated && !burnoutReached;

    if (shouldBeTurbo && !this.isTurboActive) {
      this.isTurboActive = true;
      const next5mTarget = getNextCandleCloseTimestamp(5, now);
      if (this.nextScanTimestamp > next5mTarget) {
        this.nextScanTimestamp = next5mTarget;
      }
      this.persistSchedulerState();
    } else if (!shouldBeTurbo && this.isTurboActive) {
      this.isTurboActive = false;
      if (!inZone || isInvalidated) {
        this.turboScanCount = 0;
      }
      const nextBaseTarget = getNextCandleCloseTimestamp(this.baseIntervalMinutes, now);
      if (this.nextScanTimestamp < nextBaseTarget) {
        this.nextScanTimestamp = nextBaseTarget;
      }
      this.persistSchedulerState();
    }

    // Check wall-clock countdown trigger
    if (now >= this.nextScanTimestamp) {
      if (!this.isAutoScanActive) {
        // Disabled: advance nextScanTimestamp to maintain alignment
        const targetCadence = this.isTurboActive ? 5 : this.baseIntervalMinutes;
        this.nextScanTimestamp = getNextCandleCloseTimestamp(targetCadence, now);
        this.persistSchedulerState();
        return;
      }

      // 180s Debounce Guard
      if (now - this.lastScanDispatchTime >= 180 * 1000) {
        this.lastScanDispatchTime = now;

        if (this.isTurboActive) {
          this.turboScanCount += 1;
          if (this.turboScanCount >= 4) {
            // Burnout reached: relax back to base interval
            this.isTurboActive = false;
            this.nextScanTimestamp = getNextCandleCloseTimestamp(this.baseIntervalMinutes, now);
          } else {
            this.nextScanTimestamp = getNextCandleCloseTimestamp(5, now);
          }
        } else {
          this.turboScanCount = 0;
          this.nextScanTimestamp = getNextCandleCloseTimestamp(this.baseIntervalMinutes, now);
        }

        this.persistSchedulerState();

        // Dispatch autonomous background scan directly from server
        this.executeScan().catch((err) => {
          console.error('[HEADLESS_SCHEDULER] Scan error:', err?.message || err);
        });
      } else {
        // Debounce active (<180s): advance nextScanTimestamp to avoid mid-candle triggering
        const targetCadence = this.isTurboActive ? 5 : this.baseIntervalMinutes;
        this.nextScanTimestamp = getNextCandleCloseTimestamp(targetCadence, now);
        this.persistSchedulerState();
      }
    }
  }

  /**
   * Executes scheduled multi-model AI synthesis pass directly from the server.
   */
  public async executeScan(): Promise<void> {
    if (this.isScanning) {
      console.log('[HEADLESS_SCHEDULER] Scan already in progress. Skipping duplicate pass.');
      return;
    }

    this.isScanning = true;
    const executionNow = new Date();
    const livePrice = this.getCurrentPrice(this.symbol) || 2400.0;
    const sessionContext = buildLiveSessionContext(executionNow, livePrice);

    console.log(
      `\n[HEADLESS_SCHEDULER] 🚀 Dispatched Autonomous AI Scan for ${this.symbol} @ ${executionNow.toISOString()} (Live: $${livePrice.toFixed(2)}, Cadence: ${this.isTurboActive ? '5m Turbo' : `${this.baseIntervalMinutes}m Base`}).`
    );

    this.ledger?.logEvent(
      'AUTONOMOUS_SCAN_DISPATCHED',
      `Autonomous AI scan dispatched for ${this.symbol} @ $${livePrice.toFixed(2)}`,
      { livePrice }
    );

    try {
      // 1. Fetch system settings from DB
      let apiKey = process.env.GEMINI_LIVE_KEY;
      let activeModel = process.env.ACTIVE_MODEL || DEFAULT_MODEL;
      let systemPrompt = DEFAULT_ETH_SOP_SYSTEM_PROMPT;

      try {
        const { rows } = await sql`
          SELECT key_name, key_value FROM system_settings
          WHERE key_name IN ('GEMINI_LIVE_KEY', 'ACTIVE_MODEL', 'SYSTEM_PROMPT')
        `;
        for (const row of rows) {
          if (row.key_name === 'GEMINI_LIVE_KEY' && row.key_value) apiKey = row.key_value;
          if (row.key_name === 'ACTIVE_MODEL' && row.key_value) activeModel = row.key_value;
          if (row.key_name === 'SYSTEM_PROMPT' && row.key_value) systemPrompt = row.key_value;
        }
      } catch (e) {
        // Fallback to environment
      }

      if (!apiKey && !this.allowOfflineFallback) {
        console.warn('[HEADLESS_SCHEDULER] GEMINI_LIVE_KEY not found. Skipping AI dispatch.');
        return;
      }

      // 2. Assemble market data payload from ring buffers
      const buffers = this.getRingBuffers();
      const candles5m = [...(buffers['5m'] || [])];
      const candles15m = [...(buffers['15m'] || [])];
      const candles1h = [...(buffers['1h'] || [])];
      const candles4h = [...(buffers['4h'] || [])];

      annotateCandlesWithVolumetricSignals(candles5m);
      annotateCandlesWithVolumetricSignals(candles15m);
      annotateCandlesWithVolumetricSignals(candles1h);
      annotateCandlesWithVolumetricSignals(candles4h);

      const aiPayload = {
        ticker: `${this.symbol}.p`,
        symbol: this.symbol,
        timestamp: executionNow.toISOString(),
        session_context: sessionContext,
        ipda_metrics: {
          current_time_window: sessionContext.current_killzone,
          session_context: sessionContext,
        },
        data_payload: {
          candles_4h: candles4h.slice(-30),
          candles_1h: candles1h.slice(-30),
          candles_15m: candles15m.slice(-30),
          candles_5m: candles5m.slice(-30),
        },
      };

      // 3. Fetch Historical Memory from ai_trade_state
      let parsedState: Record<string, unknown> = { status: 'SEARCHING' };
      try {
        const stateResult = await sql`SELECT state_json FROM ai_trade_state WHERE id = 1`;
        if (stateResult.rows.length > 0 && stateResult.rows[0].state_json) {
          const raw = stateResult.rows[0].state_json;
          parsedState = typeof raw === 'string' ? JSON.parse(raw) : raw;
        }
      } catch {
        parsedState = { status: 'SEARCHING' };
      }

      // 4. Execute Multi-Model Cascade
      const cascadeRunner = this.evaluateAiCascadeFn || runAiCascadeEvaluation;
      const result = await cascadeRunner({
        apiKey: apiKey || 'mock_key',
        requestedModel: activeModel,
        systemPrompt,
        payload: aiPayload,
        historicalState: parsedState,
        symbol: this.symbol,
        timeframe: '15m',
      });

      console.log(
        `[HEADLESS_SCHEDULER] ✅ Scan finished: Status=${result.status} | Bias=${result.biasSignal} | Latency=${result.telemetry?.execution_latency_ms}ms`
      );

      this.lastScanResult = {
        status: result.status,
        biasSignal: result.biasSignal,
        timestamp: executionNow.toISOString(),
        latencyMs: result.telemetry?.execution_latency_ms || 0,
      };

      this.ledger?.logEvent(
        'AUTONOMOUS_SCAN_COMPLETED',
        `Scan completed: Status=${result.status}, Bias=${result.biasSignal}`,
        {
          livePrice,
          metadata: {
            status: result.status,
            biasSignal: result.biasSignal,
            latencyMs: result.telemetry?.execution_latency_ms,
          },
        }
      );

      // 5. If qualified as ARMED / ACTIVE_SETUP, stage directly into agent_decision_log
      if (
        result.status === 'ACTIVE_SETUP' ||
        (result.parsedResponse?.next_database_state as any)?.status === 'ARMED'
      ) {
        if (result.entryRangeLow != null && result.invalidationLevel != null) {
          try {
            await ensureAgentDecisionTableInitialized();
            const rawLow = Number(result.entryRangeLow);
            const rawHigh = Number(result.entryRangeHigh ?? result.entryRangeLow);
            const safeEntryLow = Math.min(rawLow, rawHigh);
            const safeEntryHigh = Math.max(rawLow, rawHigh);
            const isLong = result.tradeDirection === 'LONG' || result.biasSignal === 1;
            const triggerPrice = isLong ? safeEntryHigh : safeEntryLow;

            await sql`
              INSERT INTO agent_decision_log (
                symbol, agent_id, bias_signal,
                entry_range_low, entry_range_high, invalidation_level,
                target_1, target_2, target_3,
                narrative, status, live_price_at_submission, submitted_at,
                execution_mode, trigger_timeframe, trigger_condition, trigger_price,
                poi_zone_low, poi_zone_high, limit_offset_rule, ttl_bars, radar_status,
                requested_model, resolved_model, latency_ms, was_fallback, fallback_reason
              ) VALUES (
                ${this.symbol},
                'server_headless_daemon',
                ${result.biasSignal},
                ${safeEntryLow},
                ${safeEntryHigh},
                ${result.invalidationLevel},
                ${result.target1},
                ${result.target2},
                ${result.target3},
                ${result.parsedResponse?.narrative || result.text?.slice(0, 1000) || 'Autonomous Trend Continuation Scan'},
                'ACTIVE',
                ${livePrice},
                ${Date.now()},
                'IMMEDIATE_LIMIT',
                '15m',
                ${isLong ? 'MSS_BODY_CLOSE_ABOVE' : 'MSS_BODY_CLOSE_BELOW'},
                ${triggerPrice},
                ${safeEntryLow},
                ${safeEntryHigh},
                'FVG_PROXIMAL',
                12,
                'DORMANT',
                ${result.telemetry?.requested_model || activeModel},
                ${result.telemetry?.resolved_model || activeModel},
                ${result.telemetry?.execution_latency_ms || 0},
                ${result.telemetry?.was_fallback || false},
                ${result.telemetry?.fallback_reason || null}
              )
            `;

            console.log(
              `[HEADLESS_SCHEDULER] 🎯 Dispatched ARMED setup into agent_decision_log (Range: $${safeEntryLow}-$${safeEntryHigh}, SL: $${result.invalidationLevel})`
            );

            // Trigger immediate poll in SparkIngestionDispatcher if authorized
            if (this.sparkDispatcher) {
              const dz = isDeadZone(Date.now());
              const isCooling = globalAlertCadenceGovernor.isTemporalCooldownActive(this.symbol, isLong ? 'LONG' : 'SHORT');
              if (!dz.isDead && !isCooling) {
                this.sparkDispatcher.pollOnce().catch(() => {});
              } else {
                console.log(
                  `[HEADLESS_SCHEDULER] 🛡️ Suppressed immediate sparkDispatcher poll (${dz.isDead ? dz.reason : 'temporal cooldown active'}). Normal background polling cycle will handle staging.`
                );
              }
            }
          } catch (dbErr: any) {
            console.warn('[HEADLESS_SCHEDULER] Could not insert into agent_decision_log:', dbErr?.message || dbErr);
          }
        }
      }

      // Update active setup geometry
      const lowVal = result.entryRangeLow != null ? Math.min(Number(result.entryRangeLow), Number(result.entryRangeHigh ?? result.entryRangeLow)) : null;
      const highVal = result.entryRangeHigh != null ? Math.max(Number(result.entryRangeLow ?? result.entryRangeHigh), Number(result.entryRangeHigh)) : null;
      this.activeSetup = {
        low: lowVal,
        high: highVal,
        invalidation: result.invalidationLevel,
        direction: result.tradeDirection,
      };

      this.persistSchedulerState();
    } catch (scanErr: any) {
      console.error('[HEADLESS_SCHEDULER] Execution scan exception:', scanErr?.message || scanErr);
      this.ledger?.logEvent('AUTONOMOUS_SCAN_ERROR', `Scan error: ${scanErr?.message || scanErr}`);
    } finally {
      this.isScanning = false;
    }
  }
}
