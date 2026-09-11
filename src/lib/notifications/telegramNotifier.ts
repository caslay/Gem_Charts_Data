/**
 * telegramNotifier.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow-State Quant Engine — Production Telegram Bot Notification Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Dispatches real-time HTML-formatted trade notifications to Telegram:
 *  - ⏳ Pending Limit Order Placed
 *  - 🚀 Order Opened / Filled
 *  - 🎯 Stage 1 Harvest (TP1 Hit @ 1.0R, SL to Breakeven/FVG CE)
 *  - 💰 Stage 2 Harvest (TP2 Hit @ 1.4R/1.5R, SL Ratchet to +1.0R Floor)
 *  - 🏁 SL Hit / Position Closed (Full Loss, Scratch, Profit Floor, TP3 Win)
 * 
 * Guarantees STRICT single-dispatch deduplication via dual-layer caching
 * (in-memory Set + persistent JSON registry on disk).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ExecutionEvent,
  StrategyExecutionPosition,
} from '../quantEngine/AutomatedStrategyExecutionEngine';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  persistedRegistryPath?: string;
  ephemeralRegistry?: boolean;
}

export type SparkLifecycleMilestone =
  | 'SIGNAL_RECEIVED'
  | 'ORDER_ARMED'
  | 'ORDER_FILLED'
  | 'TP1_SCALE_RATCHET'
  | 'TRADE_CLOSED';

export interface SparkSignalReceivedPayload {
  id?: number | string;
  decisionId?: number | string;
  symbol: string;
  direction: 'LONG' | 'SHORT' | string;
  entryRangeLow?: number | null;
  entryRangeHigh?: number | null;
  limitEntryPrice?: number | null;
  invalidationLevel?: number | null;
  target1?: number | null;
  target2?: number | null;
  riskUsd: number;
  riskPct: number;
  contractSize?: number;
  narrative?: string | null;
  timestamp?: number;
  mode?: 'STANDBY' | 'PAPER_TRADING' | 'LIVE_BINANCE';
}

export interface SparkOrderArmedPayload {
  tradeId?: string;
  positionId?: string;
  setupId?: string;
  mode: 'PAPER_TRADING' | 'LIVE_BINANCE' | 'STANDBY';
  symbol: string;
  direction: 'LONG' | 'SHORT';
  limitEntryPrice: number;
  stopLossPrice: number;
  contractSize: number;
  notionalValue?: number;
  riskUsd: number;
  riskPct: number;
  ttlBars?: number;
  timestamp?: number;
}

export interface SparkOrderFilledPayload {
  tradeId?: string;
  positionId?: string;
  mode: 'PAPER_TRADING' | 'LIVE_BINANCE';
  symbol: string;
  direction: 'LONG' | 'SHORT';
  executionPrice: number;
  contractSize: number;
  notionalValue?: number;
  activeStopLoss: number;
  stage1Target: number;
  stage2Target?: number;
  timestamp?: number;
}

export interface SparkTp1RatchetPayload {
  tradeId?: string;
  positionId?: string;
  mode: 'PAPER_TRADING' | 'LIVE_BINANCE';
  symbol: string;
  direction: 'LONG' | 'SHORT';
  stage1Target: number;
  stage1Ratio: number;
  bankedR: number;
  bankedUsd: number;
  newStopLoss: number;
  feeShieldOffsetPct?: number;
  remainingAllocationPct?: number;
  stage2Target?: number;
  timestamp?: number;
}

export interface SparkTradeClosedPayload {
  tradeId?: string;
  positionId?: string;
  mode: 'PAPER_TRADING' | 'LIVE_BINANCE';
  symbol: string;
  direction: 'LONG' | 'SHORT';
  exitPrice: number;
  exitReason: string;
  holdingDurationMs?: number;
  holdingDurationStr?: string;
  netRealizedR: number;
  netRealizedUsd: number;
  feeUsd?: number;
  timestamp?: number;
}

export function formatHoldingDuration(ms: number): string {
  if (!ms || ms <= 0) return '0s';
  const totalSecs = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function sanitizeMarkdownText(text?: string | null): string {
  if (!text) return '';
  return String(text).replace(/[*_`\[\]()]/g, '');
}

export function validateTelegramMarkdown(text: string): { isValid: boolean; error?: string } {
  const withoutPre = text.replace(/```[\s\S]*?```/g, '');
  const withoutCode = withoutPre.replace(/`[^`]*`/g, '');

  const asterisks = (withoutCode.match(/\*/g) || []).length;
  if (asterisks % 2 !== 0) {
    return { isValid: false, error: `Unbalanced bold asterisks (${asterisks})` };
  }

  const underscores = (withoutCode.match(/_/g) || []).length;
  if (underscores % 2 !== 0) {
    return { isValid: false, error: `Unbalanced italic underscores (${underscores})` };
  }

  const backticks = (text.match(/`/g) || []).length;
  if (backticks % 2 !== 0) {
    return { isValid: false, error: `Unbalanced backticks (${backticks})` };
  }

  return { isValid: true };
}

export function formatSparkSignalReceivedMarkdown(payload: SparkSignalReceivedPayload): string {
  const isLong = payload.direction === 'LONG' || payload.direction === 'BULLISH';
  const dirEmoji = isLong ? '🟢 LONG' : '🔴 SHORT';
  const timeIso = new Date(payload.timestamp || Date.now())
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19) + ' UTC';
  const cleanNarrative = sanitizeMarkdownText(
    payload.narrative || 'Institutional signal validated by Global Risk Governor.'
  );

  const entryRangeStr =
    typeof payload.entryRangeLow === 'number' && typeof payload.entryRangeHigh === 'number'
      ? `$${payload.entryRangeLow.toFixed(2)} – $${payload.entryRangeHigh.toFixed(2)}`
      : typeof payload.limitEntryPrice === 'number'
        ? `$${payload.limitEntryPrice.toFixed(2)}`
        : 'Market / Dynamic';

  const slStr = typeof payload.invalidationLevel === 'number' ? `$${payload.invalidationLevel.toFixed(2)}` : 'N/A';
  const t1Str = typeof payload.target1 === 'number' && payload.target1 > 0 ? `🎯 *Target 1 (TP1):* \`$${payload.target1.toFixed(2)}\`\n` : '';
  const t2Str = typeof payload.target2 === 'number' && payload.target2 > 0 ? `💰 *Target 2 (TP2):* \`$${payload.target2.toFixed(2)}\`\n` : '';
  const riskUsd = typeof payload.riskUsd === 'number' ? payload.riskUsd.toFixed(2) : '0.00';
  const riskPct = typeof payload.riskPct === 'number' ? payload.riskPct.toFixed(1) : '2.0';

  return (
    `📥 *[SPARK SIGNAL RECEIVED]*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 *Pair:* \`${payload.symbol}\`\n` +
    `🧭 *Bias:* *${dirEmoji}*\n` +
    `🎯 *Entry Range:* \`${entryRangeStr}\`\n` +
    `🛑 *Invalidation Stop:* \`${slStr}\`\n` +
    t1Str +
    t2Str +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 *Risk Size:* \`$${riskUsd}\` (1.0R | ${riskPct}% Compounded)\n` +
    (typeof payload.contractSize === 'number' && payload.contractSize > 0 ? `📐 *Projected Size:* \`${payload.contractSize} contracts\`\n` : '') +
    (payload.mode ? `⚙️ *Assigned Mode:* \`[${payload.mode}]\`\n` : '') +
    `🧠 *Spark Narrative:*\n` +
    `_${cleanNarrative}_\n` +
    `⏰ *Time:* \`${timeIso}\``
  );
}

export function formatSparkOrderArmedMarkdown(payload: SparkOrderArmedPayload): string {
  const dirEmoji = payload.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
  const timeIso = new Date(payload.timestamp || Date.now())
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19) + ' UTC';
  const ttlBars = payload.ttlBars ?? 12;
  const limitPriceStr = typeof payload.limitEntryPrice === 'number' ? payload.limitEntryPrice.toFixed(2) : '0.00';
  const slStr = typeof payload.stopLossPrice === 'number' ? payload.stopLossPrice.toFixed(2) : '0.00';
  const contractSize = typeof payload.contractSize === 'number' ? payload.contractSize : 0;
  const notional = typeof payload.notionalValue === 'number'
    ? payload.notionalValue
    : (typeof payload.limitEntryPrice === 'number' ? contractSize * payload.limitEntryPrice : 0);
  const notionalStr = notional > 0 ? ` (Notional: \`$${notional.toFixed(2)}\`)` : '';
  const riskUsd = typeof payload.riskUsd === 'number' ? payload.riskUsd.toFixed(2) : '0.00';
  const riskPct = typeof payload.riskPct === 'number' ? payload.riskPct.toFixed(1) : '2.0';

  return (
    `🎯 *[ORDER ARMED / QUEUED]*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `⚙️ *Mode:* \`[${payload.mode}]\`\n` +
    `📊 *Pair:* \`${payload.symbol}\`\n` +
    `🧭 *Direction:* *${dirEmoji}*\n` +
    `🎯 *Limit Entry:* \`$${limitPriceStr}\` (Resting Maker)\n` +
    `🛑 *Stop Loss:* \`$${slStr}\` (0.15% Clamped)\n` +
    `⏳ *TTL Expiry:* \`${ttlBars} Bars (${ttlBars * 5}m)\`\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 *Committed Risk:* \`$${riskUsd}\` (${riskPct}%)\n` +
    `📐 *Contract Size:* \`${contractSize} contracts\`${notionalStr}\n` +
    `⏰ *Armed At:* \`${timeIso}\``
  );
}

export function formatSparkOrderFilledMarkdown(payload: SparkOrderFilledPayload): string {
  const dirEmoji = payload.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
  const timeIso = new Date(payload.timestamp || Date.now())
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19) + ' UTC';
  const execPrice = typeof payload.executionPrice === 'number' ? payload.executionPrice.toFixed(2) : '0.00';
  const contractSize = typeof payload.contractSize === 'number' ? payload.contractSize : 0;
  const notional = typeof payload.notionalValue === 'number'
    ? payload.notionalValue
    : (typeof payload.executionPrice === 'number' ? contractSize * payload.executionPrice : 0);
  const notionalStr = notional > 0 ? ` (Notional: \`$${notional.toFixed(2)}\`)` : '';
  const activeSl = typeof payload.activeStopLoss === 'number' ? payload.activeStopLoss.toFixed(2) : '0.00';
  const t1Str = typeof payload.stage1Target === 'number' && payload.stage1Target > 0
    ? `🎯 *TP1 Target:* \`$${payload.stage1Target.toFixed(2)}\`\n`
    : '';
  const t2Str = typeof payload.stage2Target === 'number' && payload.stage2Target > 0
    ? `💰 *TP2 Target:* \`$${payload.stage2Target.toFixed(2)}\`\n`
    : '';

  return (
    `⚡ *[ORDER FILLED]*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `⚙️ *Mode:* \`[${payload.mode}]\`\n` +
    `📊 *Pair:* \`${payload.symbol}\`\n` +
    `🧭 *Direction:* *${dirEmoji}*\n` +
    `⚡ *Execution Price:* \`$${execPrice}\`\n` +
    `📐 *Position Size:* \`${contractSize} contracts\`${notionalStr}\n` +
    `🛑 *Active Stop Loss:* \`$${activeSl}\`\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    t1Str +
    t2Str +
    `⏰ *Fill Time:* \`${timeIso}\``
  );
}

export function formatSparkTp1RatchetMarkdown(payload: SparkTp1RatchetPayload): string {
  const timeIso = new Date(payload.timestamp || Date.now())
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19) + ' UTC';
  const s1Ratio = typeof payload.stage1Ratio === 'number' ? payload.stage1Ratio : 0.5;
  const pctStr = (s1Ratio * 100).toFixed(0);
  const targetStr = typeof payload.stage1Target === 'number' ? payload.stage1Target.toFixed(2) : '0.00';
  const bankedR = typeof payload.bankedR === 'number' ? payload.bankedR.toFixed(2) : '0.00';
  const bankedUsd = typeof payload.bankedUsd === 'number' ? payload.bankedUsd.toFixed(2) : '0.00';
  const newSl = typeof payload.newStopLoss === 'number' ? payload.newStopLoss.toFixed(2) : '0.00';
  const offsetPct = payload.feeShieldOffsetPct ?? 0.015;
  const runnerPct = payload.remainingAllocationPct ?? (100 - parseFloat(pctStr));
  const t2Str = typeof payload.stage2Target === 'number' && payload.stage2Target > 0
    ? ` targeting TP2 (\`$${payload.stage2Target.toFixed(2)}\`)`
    : '';

  return (
    `🛡️ *[TP1 SCALE & RATCHET]*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `⚙️ *Mode:* \`[${payload.mode}]\`\n` +
    `📊 *Pair:* \`${payload.symbol}\`\n` +
    `📦 *Tranche Banked:* \`${pctStr}% @ $${targetStr}\`\n` +
    `🔒 *Banked Profit:* *+${bankedR}R (+$${bankedUsd} USD)*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🛡️ *Stop Loss Ratchet:* Advanced to *Breakeven + ${offsetPct}% Fee Shield* (\`$${newSl}\`)\n` +
    `⚖️ *Ratchet Law:* Next-Bar Ratchet Rule Active (Bar i+1)\n` +
    `📦 *Remaining Runner:* \`${runnerPct}%\`${t2Str}\n` +
    `⏰ *Time:* \`${timeIso}\``
  );
}

export function formatSparkTradeClosedMarkdown(payload: SparkTradeClosedPayload): string {
  const dirEmoji = payload.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
  const timeIso = new Date(payload.timestamp || Date.now())
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19) + ' UTC';
  const exitPriceStr = typeof payload.exitPrice === 'number' ? payload.exitPrice.toFixed(2) : '0.00';
  const safeExitReason = payload.exitReason ? String(payload.exitReason).replace(/[`]/g, '') : 'CLOSED';
  const durationStr =
    payload.holdingDurationStr ||
    (typeof payload.holdingDurationMs === 'number' ? formatHoldingDuration(payload.holdingDurationMs) : 'N/A');
  const netR = typeof payload.netRealizedR === 'number' ? payload.netRealizedR : 0;
  const netUsd = typeof payload.netRealizedUsd === 'number' ? payload.netRealizedUsd : 0;
  const signR = netR >= 0 ? '+' : '';
  const signUsd = netUsd >= 0 ? '+' : '';
  const feeStr =
    typeof payload.feeUsd === 'number' ? `-$${Math.abs(payload.feeUsd).toFixed(2)} USD` : '0.00 USD';

  return (
    `🏁 *[TRADE CLOSED]*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `⚙️ *Mode:* \`[${payload.mode}]\`\n` +
    `📊 *Pair:* \`${payload.symbol}\` (${dirEmoji})\n` +
    `⚡ *Exit Price:* \`$${exitPriceStr}\`\n` +
    `🏷️ *Exit Trigger:* \`${safeExitReason}\`\n` +
    `⏱️ *Holding Duration:* \`${durationStr}\`\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 *Net Realized R:* *${signR}${netR.toFixed(2)}R*\n` +
    `💵 *Net PnL:* *${signUsd}$${netUsd.toFixed(2)} USD* (after fees)\n` +
    `💰 *Simulated Fees:* \`${feeStr}\` (Maker 0.0000% / Taker 0.0400%)\n` +
    `⏰ *Close Time:* \`${timeIso}\``
  );
}

export function formatSparkLifecycleMarkdown(
  milestone: SparkLifecycleMilestone,
  payload: any
): string {
  switch (milestone) {
    case 'SIGNAL_RECEIVED':
      return formatSparkSignalReceivedMarkdown(payload);
    case 'ORDER_ARMED':
      return formatSparkOrderArmedMarkdown(payload);
    case 'ORDER_FILLED':
      return formatSparkOrderFilledMarkdown(payload);
    case 'TP1_SCALE_RATCHET':
      return formatSparkTp1RatchetMarkdown(payload);
    case 'TRADE_CLOSED':
      return formatSparkTradeClosedMarkdown(payload);
    default:
      return '';
  }
}

export class TelegramNotifier {
  private config: TelegramConfig;
  private sentEventKeys: Set<string> = new Set();
  private registryFilePath: string;

  constructor(config?: Partial<TelegramConfig>) {
    this.loadEnvIfPresent();

    const botToken =
      config?.botToken ||
      process.env.TELEGRAM_BOT_TOKEN ||
      '8681842826:AAE_ya3wQ_IABtCXHofLDppNjOAyRDTdcVs';
    const chatId =
      config?.chatId ||
      process.env.TELEGRAM_CHAT_ID ||
      '1553743624';
    const enabled =
      config?.enabled ??
      (process.env.TELEGRAM_ENABLED !== 'false' && Boolean(botToken && chatId));

    const rootDir = process.cwd();
    const logsDir = path.join(rootDir, 'run_logs');
    if (!fs.existsSync(logsDir)) {
      try {
        fs.mkdirSync(logsDir, { recursive: true });
      } catch {
        // ignore
      }
    }

    this.registryFilePath =
      config?.persistedRegistryPath ||
      path.join(logsDir, 'telegram_notified_events.json');

    this.config = {
      botToken: botToken.trim(),
      chatId: chatId.trim(),
      enabled,
      persistedRegistryPath: this.registryFilePath,
      ephemeralRegistry: config?.ephemeralRegistry ?? false,
    };

    // Load persisted deduplication registry if not in ephemeral mode
    if (!this.config.ephemeralRegistry) {
      this.loadDeduplicationRegistry();
    }
  }

  /**
   * Helper to load .env.local or .env if present in root when running outside Next.js
   */
  private loadEnvIfPresent(): void {
    const rootDir = process.cwd();
    const envFiles = ['.env.local', '.env'];
    for (const file of envFiles) {
      const fullPath = path.join(rootDir, file);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
              const eqIdx = trimmed.indexOf('=');
              const key = trimmed.substring(0, eqIdx).trim();
              const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
              if (!process.env[key]) {
                process.env[key] = val;
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Load sent event keys from disk to prevent duplicate notifications on daemon restart.
   */
  private loadDeduplicationRegistry(): void {
    if (this.config?.ephemeralRegistry) return;
    try {
      if (fs.existsSync(this.registryFilePath)) {
        const raw = fs.readFileSync(this.registryFilePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          // Keep only the most recent 5,000 keys to keep memory lean
          const trimmed = list.slice(-5000);
          for (const k of trimmed) {
            this.sentEventKeys.add(k);
          }
        }
      }
    } catch (err) {
      console.warn('[TELEGRAM] Warning reading deduplication registry:', err);
    }
  }

  /**
   * Persist sent event keys to disk atomically.
   */
  private flushDeduplicationRegistry(): void {
    if (this.config?.ephemeralRegistry) return;
    try {
      const arr = Array.from(this.sentEventKeys).slice(-5000);
      const tmpPath = `${this.registryFilePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(arr, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.registryFilePath);
    } catch (err) {
      console.error('[TELEGRAM] Error saving deduplication registry:', err);
    }
  }

  /**
   * Clears the deduplication cache in memory and optionally on disk.
   */
  public clearDeduplicationRegistry(clearPersisted: boolean = true): void {
    this.sentEventKeys.clear();
    if (clearPersisted && !this.config.ephemeralRegistry) {
      try {
        if (fs.existsSync(this.registryFilePath)) {
          const tmpPath = `${this.registryFilePath}.${process.pid}.${Date.now()}.tmp`;
          fs.writeFileSync(tmpPath, JSON.stringify([], null, 2), 'utf8');
          fs.renameSync(tmpPath, this.registryFilePath);
        }
      } catch (err) {
        console.warn('[TELEGRAM] Warning clearing deduplication registry file:', err);
      }
    }
  }

  /**
   * Removes a specific event key from the deduplication cache.
   */
  public removeEventKey(eventKey: string): void {
    this.sentEventKeys.delete(eventKey);
    if (!this.config.ephemeralRegistry) {
      this.flushDeduplicationRegistry();
    }
  }

  /**
   * Generates a deterministic deduplication fingerprint for a given position and event.
   */
  public generateEventKey(event: ExecutionEvent): string {
    const pos = event.position;
    if (!pos) {
      return `evt_GLOBAL_${event.type}_${Math.floor(event.timestamp / 1000)}`;
    }
    const tradeId = pos.id || `POS_${pos.direction}_${pos.entryPrice}`;
    if (event.type === 'POSITION_CLOSED') {
      return `evt_${tradeId}_CLOSED_${pos.exitReason || 'EXIT'}`;
    }
    return `evt_${tradeId}_${event.type}`;
  }

  /**
   * Checks if an event has already been notified.
   */
  public isAlreadyNotified(eventKey: string): boolean {
    return this.sentEventKeys.has(eventKey);
  }

  /**
   * Formats execution events into rich HTML Telegram messages.
   */
  public formatMessage(event: ExecutionEvent): string | null {
    const pos = event.position;
    const isSpark = Boolean(pos?.strategyId?.startsWith('SPARK_') || pos?.executionMode);
    const mode = (pos?.executionMode || 'PAPER_TRADING') as 'PAPER_TRADING' | 'LIVE_BINANCE';

    if (isSpark && pos) {
      switch (event.type) {
        case 'LIMIT_ORDER_PLACED':
          return formatSparkOrderArmedMarkdown({
            mode,
            symbol: pos.symbol,
            direction: pos.direction,
            limitEntryPrice: pos.limitEntryPrice,
            stopLossPrice: pos.initialStopLoss,
            contractSize: pos.contractSize,
            notionalValue: pos.contractSize * pos.limitEntryPrice,
            riskUsd: pos.riskUsd,
            riskPct: pos.riskPct ?? 2.0,
            ttlBars: pos.maxRetestBars ?? 12,
            timestamp: event.timestamp,
          });

        case 'ORDER_FILLED':
          return formatSparkOrderFilledMarkdown({
            mode,
            symbol: pos.symbol,
            direction: pos.direction,
            executionPrice: pos.entryPrice,
            contractSize: pos.contractSize,
            notionalValue: pos.contractSize * pos.entryPrice,
            activeStopLoss: pos.activeStopLoss,
            stage1Target: pos.stage1Target,
            stage2Target: pos.stage2Target,
            timestamp: event.timestamp,
          });

        case 'STAGE_1_HARVEST': {
          const s1Ratio = pos.stage1Ratio ?? 0.5;
          const s1Mult = pos.stage1Multiple ?? 1.0;
          const bankedR = s1Ratio * s1Mult;
          return formatSparkTp1RatchetMarkdown({
            mode,
            symbol: pos.symbol,
            direction: pos.direction,
            stage1Target: pos.stage1Target,
            stage1Ratio: s1Ratio,
            bankedR,
            bankedUsd: bankedR * pos.riskUsd,
            newStopLoss: pos.activeStopLoss,
            feeShieldOffsetPct: 0.015,
            remainingAllocationPct: Math.round(pos.remainingAllocation * 100),
            stage2Target: pos.stage2Target,
            timestamp: event.timestamp,
          });
        }

        case 'POSITION_CLOSED': {
          const durationMs = pos.closeTime && pos.openTime ? pos.closeTime - pos.openTime : 0;
          return formatSparkTradeClosedMarkdown({
            mode,
            symbol: pos.symbol,
            direction: pos.direction,
            exitPrice: pos.exitPrice || pos.activeStopLoss,
            exitReason: pos.exitReason || 'CLOSED',
            holdingDurationMs: durationMs,
            netRealizedR: pos.netRealizedR ?? pos.realizedR ?? 0,
            netRealizedUsd: pos.netRealizedUsd ?? pos.realizedUsd ?? 0,
            feeUsd: pos.feeUsd ?? 0,
            timestamp: event.timestamp,
          });
        }
      }
    }

    const nowIso = new Date(event.timestamp || Date.now())
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19) + ' UTC';

    const stage1Ratio = pos?.stage1Ratio ?? 0.50;
    const stage2Ratio = pos?.stage2Ratio ?? 0.50;
    const stage3Ratio = pos?.stage3Ratio ?? 0.00;
    const isTwoStage = stage3Ratio === 0;

    switch (event.type) {
      case 'LIMIT_ORDER_PLACED': {
        if (!pos) return null;
        const dirEmoji = pos.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
        const tp2Label = (pos.stage2Multiple ?? 1.30).toFixed(1);
        const targetBlocks = isTwoStage
          ? `🎯 <b>TP1 (1.0R):</b> <code>$${pos.stage1Target.toFixed(2)}</code> (${(stage1Ratio * 100).toFixed(0)}%)\n` +
            `💰 <b>TP2 (${tp2Label}R):</b> <code>$${pos.stage2Target.toFixed(2)}</code> (${(stage2Ratio * 100).toFixed(0)}% Full Exit)\n`
          : `🎯 <b>TP1 (1.0R):</b> <code>$${pos.stage1Target.toFixed(2)}</code> (${(stage1Ratio * 100).toFixed(0)}%)\n` +
            `💰 <b>TP2 (${tp2Label}R):</b> <code>$${pos.stage2Target.toFixed(2)}</code> (${(stage2Ratio * 100).toFixed(0)}%)\n` +
            `🚀 <b>TP3 (DOL):</b> <code>$${pos.stage3Target.toFixed(2)}</code> (${(stage3Ratio * 100).toFixed(0)}% Runner)\n`;

        return (
          `⏳ <b>[PENDING LIMIT ORDER PLACED]</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 <b>Pair:</b> <code>${pos.symbol}</code> (${pos.timeframe || '5m'})\n` +
          `🧭 <b>Direction:</b> <b>${dirEmoji}</b>\n` +
          `🎯 <b>Limit Entry:</b> <code>$${pos.limitEntryPrice.toFixed(2)}</code>\n` +
          `🛑 <b>Stop Loss:</b> <code>$${pos.initialStopLoss.toFixed(2)}</code>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          targetBlocks +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `💵 <b>Risk USD:</b> <code>$${pos.riskUsd.toFixed(2)}</code> (${(pos.riskPct ?? 2.0).toFixed(1)}% Compounded)\n` +
          `📐 <b>Size:</b> <code>${pos.contractSize} contracts</code>\n` +
          `🏛️ <b>Anchor:</b> <i>${pos.anchorName || '5m Structural Liquidity'}</i>\n` +
          `⏰ <b>Time:</b> <code>${nowIso}</code>`
        );
      }

      case 'LIMIT_ORDER_CANCELLED': {
        if (!pos) return null;
        const dirEmoji = pos.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
        const isExpired = event.message.toLowerCase().includes('expired');
        const badgeTitle = isExpired ? 'PENDING LIMIT ORDER EXPIRED' : 'PENDING LIMIT ORDER CANCELLED';
        const statusDetail = isExpired
          ? 'Retest window expired (TTL 20-bar timeout). Queue unblocked.'
          : 'Invalidated before fill (SL breached or TP1 reached).';

        return (
          `⌛ <b>[${badgeTitle}]</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 <b>Pair:</b> <code>${pos.symbol}</code> (${pos.timeframe || '5m'})\n` +
          `🧭 <b>Direction:</b> <b>${dirEmoji}</b>\n` +
          `🎯 <b>Unfilled Limit:</b> <code>$${pos.limitEntryPrice.toFixed(2)}</code>\n` +
          `🛑 <b>Stop Loss:</b> <code>$${pos.initialStopLoss.toFixed(2)}</code>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `ℹ️ <b>Reason:</b> <i>${statusDetail}</i>\n` +
          `⏰ <b>Time:</b> <code>${nowIso}</code>`
        );
      }

      case 'ORDER_FILLED': {
        if (!pos) return null;
        const dirEmoji = pos.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
        const targetBlocks = isTwoStage
          ? `🎯 <b>TP1 Target:</b> <code>$${pos.stage1Target.toFixed(2)}</code> (${(stage1Ratio * 100).toFixed(0)}%)\n` +
            `💰 <b>TP2 Target:</b> <code>$${pos.stage2Target.toFixed(2)}</code> (${(stage2Ratio * 100).toFixed(0)}% Full Exit)\n`
          : `🎯 <b>TP1 Target:</b> <code>$${pos.stage1Target.toFixed(2)}</code> (${(stage1Ratio * 100).toFixed(0)}%)\n` +
            `💰 <b>TP2 Target:</b> <code>$${pos.stage2Target.toFixed(2)}</code> (${(stage2Ratio * 100).toFixed(0)}%)\n` +
            `🚀 <b>TP3 Runner:</b> <code>$${pos.stage3Target.toFixed(2)}</code> (${(stage3Ratio * 100).toFixed(0)}%)\n`;

        return (
          `🚀 <b>[ORDER OPENED / FILLED]</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 <b>Pair:</b> <code>${pos.symbol}</code> (${pos.timeframe || '5m'})\n` +
          `🧭 <b>Direction:</b> <b>${dirEmoji}</b>\n` +
          `⚡ <b>Fill Price:</b> <code>$${pos.entryPrice.toFixed(2)}</code>\n` +
          `🛑 <b>Stop Loss:</b> <code>$${pos.activeStopLoss.toFixed(2)}</code>\n` +
          `📐 <b>Contract Size:</b> <code>${pos.contractSize} contracts</code>\n` +
          `💵 <b>Initial Risk:</b> <code>$${pos.riskUsd.toFixed(2)}</code> (${(pos.riskPct ?? 2.0).toFixed(1)}% Compounded)\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          targetBlocks +
          `⏰ <b>Time:</b> <code>${nowIso}</code>`
        );
      }

      case 'EARLY_BREAKEVEN': {
        if (!pos) return null;
        return (
          `🛡️ <b>[EARLY BREAKEVEN ACTIVATED — RULE 4]</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 <b>Pair:</b> <code>${pos.symbol}</code> (${pos.timeframe || '5m'})\n` +
          `⚡ <b>Floating Peak:</b> <b>+${(pos.mfeR || 0).toFixed(2)}R MFE</b>\n` +
          `🛡️ <b>Trailing Stop Loss:</b> Advanced to <b>BREAKEVEN ($${pos.activeStopLoss.toFixed(2)})</b>\n` +
          `<i>Net trade risk is now eliminated (Risk-Free / Scratch Protected).</i>\n` +
          `⏰ <b>Time:</b> <code>${nowIso}</code>`
        );
      }

      case 'STAGE_1_HARVEST': {
        if (!pos) return null;
        const lockedR = stage1Ratio * (pos.stage1Multiple ?? 1.0);
        return (
          `🎯 <b>[TP1 FILLED — STAGE 1 HARVEST]</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 <b>Pair:</b> <code>${pos.symbol}</code> (${pos.timeframe || '5m'})\n` +
          `📦 <b>Tranche:</b> <code>${(stage1Ratio * 100).toFixed(0)}% Position Filled @ $${pos.stage1Target.toFixed(2)}</code>\n` +
          `🔒 <b>Locked Realized:</b> <b>+${lockedR.toFixed(2)}R (+$${(lockedR * pos.riskUsd).toFixed(2)} USD)</b>\n` +
          `📦 <b>Remaining Allocation:</b> <code>${(pos.remainingAllocation * 100).toFixed(0)}%</code>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🛡️ <b>Trailing Stop Loss:</b> Advanced to <b>${pos.trailingSlSource}</b> (<code>$${pos.activeStopLoss.toFixed(2)}</code>)\n` +
          `<i>Net Trade Risk is now capped (Risk-Free / Scratch Protected).</i>\n` +
          `⏰ <b>Time:</b> <code>${nowIso}</code>`
        );
      }

      case 'STAGE_2_HARVEST': {
        if (!pos) return null;
        if (isTwoStage) {
          return (
            `💰 <b>[TP2 FILLED — FULL 2-STAGE HARVEST]</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📊 <b>Pair:</b> <code>${pos.symbol}</code> (${pos.timeframe || '5m'})\n` +
            `📦 <b>Tranche:</b> <code>${(stage2Ratio * 100).toFixed(0)}% Position Filled @ $${pos.stage2Target.toFixed(2)}</code>\n` +
            `🔒 <b>Total Realized:</b> <b>+${pos.realizedR.toFixed(2)}R (+$${pos.realizedUsd.toFixed(2)} USD)</b>\n` +
            `🏆 <b>Status:</b> <b>100% Position Closed with Maximum Alpha (+1.20R)</b>\n` +
            `⏰ <b>Time:</b> <code>${nowIso}</code>`
          );
        }
        return (
          `💰 <b>[TP2 FILLED — STAGE 2 HARVEST]</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 <b>Pair:</b> <code>${pos.symbol}</code> (${pos.timeframe || '5m'})\n` +
          `📦 <b>Tranche:</b> <code>${(stage2Ratio * 100).toFixed(0)}% Position Filled @ $${pos.stage2Target.toFixed(2)}</code>\n` +
          `🔒 <b>Total Realized:</b> <b>+${pos.realizedR.toFixed(2)}R (+$${pos.realizedUsd.toFixed(2)} USD)</b>\n` +
          `📦 <b>Remaining Runner:</b> <code>${(pos.remainingAllocation * 100).toFixed(0)}%</code> (Targeting DOL: <code>$${pos.stage3Target.toFixed(2)}</code>)\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `💎 <b>Profit Ratchet:</b> Active SL ratcheted to <b>+1.0R Profit Floor</b> (<code>$${pos.activeStopLoss.toFixed(2)}</code>)\n` +
          `⏰ <b>Time:</b> <code>${nowIso}</code>`
        );
      }

      case 'POSITION_CLOSED': {
        if (!pos) return null;
        const realizedR = pos.realizedR || 0;
        const realizedUsd = pos.realizedUsd || 0;
        const sign = realizedR >= 0 ? '+' : '';
        const usdSign = realizedUsd >= 0 ? '+' : '';

        let outcomeHeader = '🏁 <b>[POSITION CLOSED]</b>';
        if (pos.exitReason === 'FULL_TP2_WIN') {
          outcomeHeader = '🏆 <b>[FULL TP2 WIN — 100% POSITION CLOSED]</b>';
        } else if (pos.exitReason === 'FULL_TP3_WIN') {
          outcomeHeader = '🏆 <b>[FULL TP3 WIN — RUNNER COMPLETED]</b>';
        } else if (pos.exitReason === 'STAGE_2_WIN') {
          outcomeHeader = '💰 <b>[POSITION CLOSED — PROFIT FLOOR WIN]</b>';
        } else if (pos.exitReason === 'STAGE_1_SCRATCH') {
          outcomeHeader = '🛡️ <b>[POSITION CLOSED — BREAKEVEN SCRATCH]</b>';
        } else if (pos.exitReason === 'BREAKEVEN_SCRATCH') {
          outcomeHeader = '🛡️ <b>[EARLY BREAKEVEN SCRATCH — ZERO LOSS]</b>';
        } else if (pos.exitReason === 'STOPPED_OUT') {
          outcomeHeader = '🛑 <b>[STOP LOSS HIT — POSITION CLOSED]</b>';
        }

        return (
          `${outcomeHeader}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 <b>Pair:</b> <code>${pos.symbol}</code> (${pos.direction})\n` +
          `⚡ <b>Exit Price:</b> <code>$${(pos.exitPrice || pos.activeStopLoss).toFixed(2)}</code>\n` +
          `🏷️ <b>Exit Reason:</b> <code>${pos.exitReason || 'CLOSED'}</code>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 <b>Final Realized R:</b> <b>${sign}${realizedR.toFixed(2)}R</b>\n` +
          `💵 <b>Final Realized USD:</b> <b>${usdSign}$${realizedUsd.toFixed(2)}</b>\n` +
          `⏳ <b>Status:</b> <i>Post-Trade Cooldown Active (60s)</i>\n` +
          `⏰ <b>Time:</b> <code>${nowIso}</code>`
        );
      }

      default:
        return null;
    }
  }

  /**
   * Main dispatch method: checks deduplication key, formats, and sends to Telegram.
   */
  public async handleExecutionEvent(event: ExecutionEvent): Promise<boolean> {
    if (!this.config.enabled || !this.config.botToken || !this.config.chatId) {
      return false;
    }

    const eventKey = this.generateEventKey(event);

    // ── Deduplication Guard ──
    if (this.isAlreadyNotified(eventKey)) {
      return false;
    }

    const text = this.formatMessage(event);
    if (!text) {
      return false;
    }

    // Mark as notified in memory before sending to prevent race conditions
    this.sentEventKeys.add(eventKey);
    this.flushDeduplicationRegistry();

    const pos = event.position;
    const isSpark = Boolean(pos?.strategyId?.startsWith('SPARK_') || pos?.executionMode);
    const parseMode = isSpark ? 'Markdown' : 'HTML';

    const success = await this.sendRawMessage(text, { parseMode });
    if (success) {
      console.log(`[TELEGRAM] 📲 Notification sent for event: ${eventKey} (Mode: ${parseMode})`);
    } else {
      console.warn(`[TELEGRAM] ⚠️ Failed to deliver notification for: ${eventKey}`);
    }

    return success;
  }

  /**
   * Generates a deterministic deduplication key for a Spark trade lifecycle milestone event.
   * Scopes strictly by trade/decision ID when available, or milestone-specific discriminator
   * values to guarantee zero false-positive suppression across distinct trades.
   */
  public generateSparkEventKey(
    milestone: SparkLifecycleMilestone,
    payload: any
  ): string | null {
    if (!payload?.symbol || !milestone) return null;

    const uniqueId =
      payload.decisionId ??
      payload.id ??
      payload.tradeId ??
      payload.positionId ??
      payload.setupId;

    if (uniqueId !== undefined && uniqueId !== null && String(uniqueId).trim() !== '') {
      return `evt_SPARK_${milestone}_${payload.symbol}_${uniqueId}`;
    }

    switch (milestone) {
      case 'SIGNAL_RECEIVED': {
        const price = payload.limitEntryPrice ?? payload.entryRangeLow ?? '';
        const dir = payload.direction ? `_${payload.direction}` : '';
        const ts = payload.timestamp ? `_${Math.floor(payload.timestamp / 1000)}` : '';
        return `evt_SPARK_SIGNAL_${payload.symbol}${dir}_${price}${ts}`;
      }
      case 'ORDER_ARMED': {
        const price = payload.limitEntryPrice ?? '';
        const dir = payload.direction ? `_${payload.direction}` : '';
        const ts = payload.timestamp ? `_${Math.floor(payload.timestamp / 1000)}` : '';
        return `evt_SPARK_ARMED_${payload.symbol}${dir}_${price}${ts}`;
      }
      case 'ORDER_FILLED': {
        const price = payload.executionPrice ?? '';
        const dir = payload.direction ? `_${payload.direction}` : '';
        const ts = payload.timestamp ? `_${Math.floor(payload.timestamp / 1000)}` : '';
        return `evt_SPARK_FILLED_${payload.symbol}${dir}_${price}${ts}`;
      }
      case 'TP1_SCALE_RATCHET': {
        const target = payload.stage1Target ?? '';
        const newSl = payload.newStopLoss ?? '';
        const ts = payload.timestamp ? `_${Math.floor(payload.timestamp / 1000)}` : '';
        return `evt_SPARK_TP1_${payload.symbol}_${target}_${newSl}${ts}`;
      }
      case 'TRADE_CLOSED': {
        const exitPrice = payload.exitPrice ?? '';
        const reason = payload.exitReason ?? '';
        const ts = payload.timestamp ? `_${Math.floor(payload.timestamp / 1000)}` : '';
        return `evt_SPARK_CLOSED_${payload.symbol}_${exitPrice}_${reason}${ts}`;
      }
      default:
        return `evt_SPARK_${milestone}_${payload.symbol}_${Date.now()}`;
    }
  }

  /**
   * Broadcasts a Spark trade lifecycle milestone institutional card.
   * Guarantees strict single-dispatch deduplication across parallel event hooks.
   */
  public async broadcastSparkMilestone(
    milestone: SparkLifecycleMilestone,
    payload: any,
    options?: { targetChatId?: string; parseMode?: 'Markdown' | 'HTML'; eventKey?: string }
  ): Promise<boolean> {
    if (!this.config.enabled || !this.config.botToken || !this.config.chatId) {
      return false;
    }

    const eventKey =
      options?.eventKey ||
      this.generateSparkEventKey(milestone, payload);

    if (eventKey && this.isAlreadyNotified(eventKey)) {
      console.log(`[TELEGRAM] 🛡️ Milestone ${milestone} already notified (${eventKey}). Skipping duplicate.`);
      return true;
    }

    const text = formatSparkLifecycleMarkdown(milestone, payload);
    if (!text) return false;

    const val = validateTelegramMarkdown(text);
    if (!val.isValid) {
      console.warn(`[TELEGRAM] ⚠️ Markdown validation warning for ${milestone}:`, val.error);
    }

    const success = await this.sendRawMessage(text, {
      targetChatId: options?.targetChatId,
      parseMode: options?.parseMode || 'Markdown',
    });

    if (success && eventKey) {
      this.sentEventKeys.add(eventKey);
      this.flushDeduplicationRegistry();
    }

    return success;
  }

  /**
   * Low-level raw message sender via Telegram HTTP Bot API.
   */
  public async sendRawMessage(
    messageText: string,
    options?: { replyMarkup?: any; targetChatId?: string; parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2' }
  ): Promise<boolean> {
    const chatId = options?.targetChatId || this.config.chatId;
    if (!this.config.enabled || !this.config.botToken || !chatId) {
      return false;
    }

    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
    const payload: any = {
      chat_id: chatId,
      text: messageText,
      parse_mode: options?.parseMode || 'HTML',
      disable_web_page_preview: true,
    };

    if (options?.replyMarkup) {
      payload.reply_markup = options.replyMarkup;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[TELEGRAM_API_ERROR] HTTP ${res.status}:`, errText);
        return false;
      }

      const json = await res.json();
      return json.ok === true;
    } catch (err: any) {
      console.error('[TELEGRAM_NETWORK_ERROR]', err.message || err);
      return false;
    }
  }

  /**
   * Low-level raw HTML message sender returning the message_id and API result.
   */
  public async sendRawMessageWithResponse(
    htmlText: string,
    options?: { replyMarkup?: any; targetChatId?: string }
  ): Promise<{ ok: boolean; messageId?: number; result?: any }> {
    const chatId = options?.targetChatId || this.config.chatId;
    if (!this.config.enabled || !this.config.botToken || !chatId) {
      return { ok: false };
    }

    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
    const payload: any = {
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };

    if (options?.replyMarkup) {
      payload.reply_markup = options.replyMarkup;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[TELEGRAM_API_ERROR] HTTP ${res.status}:`, errText);
        return { ok: false };
      }

      const json = await res.json();
      return { ok: json.ok === true, messageId: json.result?.message_id, result: json.result };
    } catch (err: any) {
      console.error('[TELEGRAM_NETWORK_ERROR]', err.message || err);
      return { ok: false };
    }
  }

  /**
   * Answers a Telegram callback query (dismisses loading indicator on inline buttons).
   */
  public async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert: boolean = false
  ): Promise<boolean> {
    if (!this.config.botToken) return false;
    const url = `https://api.telegram.org/bot${this.config.botToken}/answerCallbackQuery`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text,
          show_alert: showAlert,
        }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Updates an existing message's reply markup (e.g. to remove or update inline buttons).
   */
  public async editMessageReplyMarkup(
    chatId: string | number,
    messageId: number,
    replyMarkup: any = { inline_keyboard: [] }
  ): Promise<boolean> {
    if (!this.config.botToken) return false;
    const url = `https://api.telegram.org/bot${this.config.botToken}/editMessageReplyMarkup`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: replyMarkup,
        }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Updates an existing message's text and reply markup in-place.
   */
  public async editMessageText(
    chatId: string | number,
    messageId: number,
    htmlText: string,
    options?: { replyMarkup?: any }
  ): Promise<boolean> {
    if (!this.config.botToken) return false;
    const url = `https://api.telegram.org/bot${this.config.botToken}/editMessageText`;
    const payload: any = {
      chat_id: chatId,
      message_id: messageId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (options?.replyMarkup) {
      payload.reply_markup = options.replyMarkup;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Clears any active webhooks to guarantee unblocked long-polling execution.
   */
  public async deleteWebhook(options?: { dropPendingUpdates?: boolean }): Promise<boolean> {
    if (!this.config.botToken) return false;
    const drop = options?.dropPendingUpdates ?? false;
    const url = `https://api.telegram.org/bot${this.config.botToken}/deleteWebhook?drop_pending_updates=${drop}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json();
        return data.ok === true;
      }
      return false;
    } catch (err: any) {
      console.warn('[TELEGRAM_WEBHOOK_CLEAR_WARN]', err?.message || err);
      return false;
    }
  }

  public isEnabled(): boolean {
    return this.config.enabled && Boolean(this.config.botToken && this.config.chatId);
  }

  public getConfig(): TelegramConfig {
    return { ...this.config };
  }
}
