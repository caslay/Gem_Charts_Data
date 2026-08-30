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
    };

    // Load persisted deduplication registry
    this.loadDeduplicationRegistry();
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
   * Persist sent event keys to disk.
   */
  private flushDeduplicationRegistry(): void {
    try {
      const arr = Array.from(this.sentEventKeys).slice(-5000);
      fs.writeFileSync(this.registryFilePath, JSON.stringify(arr, null, 2), 'utf8');
    } catch (err) {
      console.error('[TELEGRAM] Error saving deduplication registry:', err);
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
        const targetBlocks = isTwoStage
          ? `🎯 <b>TP1 (1.0R):</b> <code>$${pos.stage1Target.toFixed(2)}</code> (${(stage1Ratio * 100).toFixed(0)}%)\n` +
            `💰 <b>TP2 (1.4R):</b> <code>$${pos.stage2Target.toFixed(2)}</code> (${(stage2Ratio * 100).toFixed(0)}% Full Exit)\n`
          : `🎯 <b>TP1 (1.0R):</b> <code>$${pos.stage1Target.toFixed(2)}</code> (${(stage1Ratio * 100).toFixed(0)}%)\n` +
            `💰 <b>TP2 (1.4R):</b> <code>$${pos.stage2Target.toFixed(2)}</code> (${(stage2Ratio * 100).toFixed(0)}%)\n` +
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
          `💵 <b>Risk USD:</b> <code>$${pos.riskUsd.toFixed(2)}</code> (2.0% Compounded)\n` +
          `📐 <b>Size:</b> <code>${pos.contractSize} contracts</code>\n` +
          `🏛️ <b>Anchor:</b> <i>${pos.anchorName || '5m Structural Liquidity'}</i>\n` +
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
          `💵 <b>Initial Risk:</b> <code>$${pos.riskUsd.toFixed(2)}</code>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          targetBlocks +
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

    const success = await this.sendRawMessage(text);
    if (success) {
      console.log(`[TELEGRAM] 📲 Notification sent for event: ${eventKey}`);
    } else {
      console.warn(`[TELEGRAM] ⚠️ Failed to deliver notification for: ${eventKey}`);
    }

    return success;
  }

  /**
   * Low-level raw HTML message sender via Telegram HTTP Bot API.
   */
  public async sendRawMessage(
    htmlText: string,
    options?: { replyMarkup?: any; targetChatId?: string }
  ): Promise<boolean> {
    const chatId = options?.targetChatId || this.config.chatId;
    if (!this.config.enabled || !this.config.botToken || !chatId) {
      return false;
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
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

  public isEnabled(): boolean {
    return this.config.enabled && Boolean(this.config.botToken && this.config.chatId);
  }

  public getConfig(): TelegramConfig {
    return { ...this.config };
  }
}
