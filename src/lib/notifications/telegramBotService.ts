/**
 * telegramBotService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow-State Quant Engine — Interactive Two-Way Telegram Command Center
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides 24/7 interactive bidirectional command handling via Telegram Long-Polling:
 *  - 📊 /status   : Live engine health, price, uptime, buffer size, macro context
 *  - 🎯 /trade    : Real-time inspection of active positions and floating P&L
 *  - 💰 /today    : Today's performance summary, realized R, win rate, capital
 *  - 🏛️ /setups   : Monitored structural liquidity zones & candidate setups
 *  - 🔬 /reconcile: Instant on-demand Quant Lab 1:1 parity audit verification
 *  - ❓ /help     : Command reference & interactive keyboard menu
 * 
 * Features:
 *  - Zero-port architecture (100% firewall / NAT / VPS friendly)
 *  - Strict Chat ID security gating (rejects unauthorized access)
 *  - Persistent custom reply keyboard (1-tap quick buttons)
 *  - Non-blocking, fault-tolerant async loop with auto-reconnection
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  TelegramNotifier,
  TelegramConfig,
  QuantLifecycleMilestone,
  SparkLifecycleMilestone,
  buildStandbyActionKeyboard,
} from './telegramNotifier';
import { AutomatedStrategyExecutionEngine } from '../quantEngine/AutomatedStrategyExecutionEngine';
import { DaemonLedger } from '../daemon/daemonLedger';
import { NodeWsClient } from '../daemon/nodeWsClient';
import { formatCairoDateTime } from '../quantEngine/equityCalculator';
import { routeEmergencyFlatten } from '../binanceOrderRouter';
import { GlobalRiskGovernor } from '../risk/GlobalRiskGovernor';
import { SYSTEM_VERSION } from '../version';
import {
  getBinanceAccountInfo,
  getBinanceOpenPositions,
  getBinanceOpenOrders,
} from '../binanceFuturesClient';
import { evaluateExecutionSafetyGate } from '../binanceOrderRouter';
import { sql } from '../postgres';

export interface TelegramBotServiceContext {
  engine: AutomatedStrategyExecutionEngine;
  ledger: DaemonLedger;
  wsClient?: NodeWsClient;
  sparkDispatcher?: any;
  symbol: string;
  equity: number;
  isDryRun: boolean;
  bootTimestamp: number;
  getMacroContext: () => any;
  getLatestSetups: () => any[];
  runReconciliationFn?: () => Promise<string>;
}

export const MAIN_TELEGRAM_KEYBOARD = {
  keyboard: [
    [{ text: '⚡ /price' }, { text: '📊 /status' }],
    [{ text: '🎯 /trade' }, { text: '💰 /today' }],
    [{ text: '🏛️ /setups' }, { text: '🛡️ /risk' }],
    [{ text: '🔬 /reconcile' }, { text: '🚨 /flatten' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

interface PendingFlattenState {
  chatId: string | number;
  messageId: number;
  armedAt: number;
  timeoutTimer: NodeJS.Timeout;
}

export class TelegramBotService {
  private notifier: TelegramNotifier;
  private context: TelegramBotServiceContext;
  private isPolling = false;
  private lastUpdateId = 0;
  private abortController: AbortController | null = null;
  private pendingFlatten: PendingFlattenState | null = null;

  constructor(context: TelegramBotServiceContext, notifier?: TelegramNotifier) {
    this.context = context;
    this.notifier = notifier || new TelegramNotifier();
  }

  /**
   * Starts the background long-polling loop with automatic webhook clearing.
   */
  public async startPolling(): Promise<void> {
    if (this.isPolling) return;
    if (!this.notifier.isEnabled()) {
      console.log(`[TELEGRAM_BOT] ⚪ Interactive bot commands disabled (no credentials).`);
      return;
    }

    // Proactively clear any stale webhook to eliminate polling collisions
    await this.notifier.deleteWebhook({ dropPendingUpdates: false });

    this.isPolling = true;
    console.log(`[TELEGRAM_BOT] 🤖 Interactive Command Center started (Long-Polling Active)...`);
    this.pollLoop().catch((err) => {
      console.error('[TELEGRAM_BOT_FATAL]', err);
    });
  }

  /**
   * Gracefully stops long-polling.
   */
  public stop(): void {
    this.isPolling = false;
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        // ignore
      }
      this.abortController = null;
    }
    console.log(`[TELEGRAM_BOT] 🛑 Interactive bot commands stopped.`);
  }

  /**
   * Broadcasts an institutional trade lifecycle milestone card.
   */
  public async broadcastQuantMilestone(
    milestone: QuantLifecycleMilestone,
    payload: any,
    options?: { targetChatId?: string; parseMode?: 'Markdown' | 'HTML'; eventKey?: string; replyMarkup?: any }
  ): Promise<boolean> {
    return await this.notifier.broadcastQuantMilestone(milestone, payload, options);
  }

  /**
   * Broadcasts a trade lifecycle milestone institutional card (backward compatibility alias).
   */
  public async broadcastSparkMilestone(
    milestone: SparkLifecycleMilestone,
    payload: any,
    options?: { targetChatId?: string; parseMode?: 'Markdown' | 'HTML'; eventKey?: string; replyMarkup?: any }
  ): Promise<boolean> {
    return await this.broadcastQuantMilestone(milestone, payload, options);
  }

  /**
   * Returns underlying TelegramNotifier instance.
   */
  public getNotifier(): TelegramNotifier {
    return this.notifier;
  }

  /**
   * Clears the deduplication cache in memory and optionally on disk.
   */
  public clearDeduplicationRegistry(clearPersisted: boolean = true): void {
    this.notifier.clearDeduplicationRegistry(clearPersisted);
  }

  /**
   * Removes a specific event key from the deduplication cache.
   */
  public removeEventKey(eventKey: string): void {
    this.notifier.removeEventKey(eventKey);
  }

  /**
   * Core long-polling loop with exponential jitter backoff and non-blocking dispatch.
   */
  private async pollLoop(): Promise<void> {
    const config = this.notifier.getConfig();
    const token = config.botToken;

    while (this.isPolling) {
      try {
        this.abortController = new AbortController();
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=20&allowed_updates=["message","callback_query"]`;

        const res = await fetch(url, {
          method: 'GET',
          signal: this.abortController.signal,
        });

        if (!res.ok) {
          if (res.status === 409) {
            // Jittered backoff (2.5s - 5.0s) to prevent persistent lockstep collisions
            const jitterMs = Math.floor(2500 + Math.random() * 2500);
            console.warn(`[TELEGRAM_BOT] ⚠️ Polling collision (HTTP 409). Backing off ${jitterMs}ms with jitter...`);
            await this.sleep(jitterMs);
            continue;
          }
          await this.sleep(2000);
          continue;
        }

        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            if (update.update_id > this.lastUpdateId) {
              this.lastUpdateId = update.update_id;
            }
            if (update.message && update.message.text) {
              // Non-blocking asynchronous message dispatch: prevents command queue stalls
              this.processIncomingMessage(update.message).catch((cmdErr) => {
                console.error('[TELEGRAM_COMMAND_DISPATCH_ERROR]', cmdErr);
              });
            } else if (update.callback_query) {
              // Non-blocking asynchronous callback query dispatch
              this.processIncomingCallbackQuery(update.callback_query).catch((cbErr) => {
                console.error('[TELEGRAM_CALLBACK_DISPATCH_ERROR]', cbErr);
              });
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || !this.isPolling) {
          break;
        }
        // Transient network error, wait briefly and retry
        await this.sleep(2000);
      }
    }
  }

  /**
   * Validates sender security and routes incoming commands.
   */
  private async processIncomingMessage(message: any): Promise<void> {
    const fromChatId = String(message.chat?.id || message.from?.id || '').trim();
    const config = this.notifier.getConfig();

    // ── Security Gate: Reject unauthorized senders ──
    if (fromChatId !== config.chatId) {
      console.warn(`[TELEGRAM_BOT] 🔒 Blocked unauthorized message from Chat ID: ${fromChatId}`);
      return;
    }

    const rawText = String(message.text || '').trim();
    // Normalize command (strip emojis like "📊 /status" -> "/status", strip @botusername)
    const match = rawText.match(/\/([a-zA-Z0-9_]+)/);
    const command = match ? `/${match[1].toLowerCase()}` : rawText.toLowerCase();

    console.log(`[TELEGRAM_BOT] 📥 Command received: "${rawText}" ➔ Routed as: "${command}"`);

    switch (command) {
      case '/start':
      case '/menu':
      case '/help':
        await this.handleHelpCommand();
        break;

      case '/status':
      case '/now':
        await this.handleStatusCommand();
        break;

      case '/trade':
      case '/pos':
      case '/position':
        await this.handleTradeCommand();
        break;

      case '/today':
      case '/pnl':
      case '/history':
        await this.handleTodayCommand();
        break;

      case '/setups':
      case '/scanner':
      case '/zones':
        await this.handleSetupsCommand();
        break;

      case '/reconcile':
        await this.handleReconcileCommand();
        break;

      case '/price':
      case '/p':
        await this.handlePriceCommand();
        break;

      case '/risk':
      case '/governor':
        await this.handleRiskCommand();
        break;

      case '/reset_risk':
      case '/reset_circuit':
        await this.handleResetRiskCommand();
        break;

      case '/flatten':
      case '/panic':
      case '/closeall':
        await this.handleEmergencyFlattenCommand();
        break;

      default:
        await this.notifier.sendRawMessage(
          `❓ <b>Unrecognized Command:</b> <code>${rawText}</code>\n\n` +
          `<i>Use the interactive buttons below or type /help to view available commands.</i>`,
          { replyMarkup: MAIN_TELEGRAM_KEYBOARD }
        );
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: Live Market Price Retrieval
  // ─────────────────────────────────────────────────────────────────────────────

  private getLivePrice(): { price: number; formatted: string } {
    const { wsClient } = this.context;
    let price = 0;
    if (wsClient && typeof wsClient.getLatestPrice === 'function') {
      price = wsClient.getLatestPrice();
    }
    if (!price || price <= 0) {
      const c5m = wsClient?.getActiveCandle('5m') || wsClient?.getRingBuffers()['5m'].slice(-1)[0];
      if (c5m && c5m.c > 0) price = c5m.c;
    }
    const formatted = price > 0 ? `$${price.toFixed(2)}` : 'Streaming...';
    return { price, formatted };
  }

  private getMacroInfo() {
    const { getMacroContext } = this.context;
    const macro = getMacroContext ? getMacroContext() : null;

    const bias = macro?.macroDailyBias || macro?.bias || 'BULLISH';
    const pdhVal = macro?.pdh;
    const pdlVal = macro?.pdl;
    const pdhStr = (typeof pdhVal === 'number' && pdhVal > 0) ? `$${pdhVal.toFixed(2)}` : '---';
    const pdlStr = (typeof pdlVal === 'number' && pdlVal > 0) ? `$${pdlVal.toFixed(2)}` : '---';

    const asianHigh = macro?.asianSession?.high ?? macro?.asianHigh ?? null;
    const asianLow = macro?.asianSession?.low ?? macro?.asianLow ?? null;
    const asianStr =
      asianHigh != null && asianLow != null && !isNaN(asianHigh) && !isNaN(asianLow)
        ? `$${asianLow.toFixed(2)} ⟷ $${asianHigh.toFixed(2)}`
        : '---';

    const londonHigh = macro?.londonSession?.high ?? macro?.londonHigh ?? null;
    const londonLow = macro?.londonSession?.low ?? macro?.londonLow ?? null;
    const londonStr =
      londonHigh != null && londonLow != null && !isNaN(londonHigh) && !isNaN(londonLow)
        ? `$${londonLow.toFixed(2)} ⟷ $${londonHigh.toFixed(2)}`
        : '---';

    return {
      bias,
      pdhStr,
      pdlStr,
      asianStr,
      londonStr,
      asianHigh,
      asianLow,
      pdh: pdhVal,
      pdl: pdlVal,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Command Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  private async handleHelpCommand(): Promise<void> {
    const livePrice = this.getLivePrice();
    const msg =
      `⚡ <b>QUEGAR COMMAND CENTER</b> ⚡\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ <b>Live Price:</b> <b>${livePrice.formatted}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>Available Interactive Commands:</b>\n\n` +
      `⚡ <b>/price</b> — Instant 1-second live price & range check\n` +
      `📊 <b>/status</b> — Live engine health, price, uptime & macro bias\n` +
      `🎯 <b>/trade</b> — Active open trade, live price, floating P&L & targets\n` +
      `💰 <b>/today</b> — Today's closed performance, realized R & capital\n` +
      `🏛️ <b>/setups</b> — Monitored liquidity anchors with live price distance\n` +
      `🔬 <b>/reconcile</b> — 1:1 Quant Lab parity audit check\n` +
      `🚨 <b>/flatten</b> — Emergency panic market close & purge all orders\n` +
      `❓ <b>/help</b> — Show this command menu & quick buttons\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Tap any quick-action button below to execute instantly!</i>`;

    await this.notifier.sendRawMessage(msg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
  }

  private async handlePriceCommand(): Promise<void> {
    const { symbol } = this.context;
    const livePrice = this.getLivePrice();
    const macro = this.getMacroInfo();

    const msg =
      `⚡ <b>[LIVE PRICE RADAR]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>Asset:</b> <code>${symbol.toUpperCase()}</code> (Binance Futures)\n` +
      `⚡ <b>Live Market Price:</b> <b>${livePrice.formatted} USD</b>\n` +
      `🧭 <b>Daily Bias:</b> <b>${macro.bias}</b>\n` +
      `🏛️ <b>Dealing Range (PDH/PDL):</b> <code>${macro.pdlStr} ⟷ ${macro.pdhStr}</code>\n` +
      `🌏 <b>Asian Session Range:</b> <code>${macro.asianStr}</code>`;

    await this.notifier.sendRawMessage(msg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
  }

  private async handleStatusCommand(): Promise<void> {
    const { engine, symbol, bootTimestamp, isDryRun, wsClient } = this.context;

    const uptimeMs = Date.now() - bootTimestamp;
    const hours = Math.floor(uptimeMs / 3600000);
    const minutes = Math.floor((uptimeMs % 3600000) / 60000);
    const seconds = Math.floor((uptimeMs % 60000) / 1000);
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    const activePositions = engine.getActivePositions();
    const pendingOrders = engine.getPendingLimitOrders();
    const macro = this.getMacroInfo();
    const livePrice = this.getLivePrice();

    const msg =
      `⚡ <b>[QUEGAR ENGINE — LIVE STATUS]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🟢 <b>Daemon Status:</b> <code>ONLINE (PM2 Host · V${SYSTEM_VERSION})</code>\n` +
      `⏱️ <b>Uptime:</b> <code>${uptimeStr}</code>\n` +
      `📊 <b>Asset:</b> <code>${symbol.toUpperCase()}</code> (Binance Futures)\n` +
      `⚡ <b>Live Market Price:</b> <b>${livePrice.formatted} USD</b>\n` +
      `⚙️ <b>Mode:</b> <code>${isDryRun ? 'DRY-RUN' : '24/7 LIVE EXECUTION'}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🧭 <b>Daily Macro Bias:</b> <b>${macro.bias}</b>\n` +
      `🏛️ <b>PDH / PDL:</b> <code>${macro.pdhStr} / ${macro.pdlStr}</code>\n` +
      `🌏 <b>Asian Range:</b> <code>${macro.asianStr}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 <b>Active Trades:</b> <code>${activePositions.length}</code>\n` +
      `⏳ <b>Pending Limits:</b> <code>${pendingOrders.length}</code>\n` +
      `🔌 <b>WebSocket:</b> <code>${wsClient ? wsClient.getStatus() : 'ACTIVE'}</code>`;

    await this.notifier.sendRawMessage(msg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
  }

  private async handleTradeCommand(): Promise<void> {
    const { engine, symbol } = this.context;
    const activePositions = engine.getActivePositions();
    const pendingOrders = engine.getPendingLimitOrders();
    const livePrice = this.getLivePrice();

    if (activePositions.length > 0) {
      const pos = activePositions[0];
      const dirEmoji = pos.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
      const floatingR = pos.unrealizedR || 0;
      const floatingUsd = pos.unrealizedUsd || 0;
      const sign = floatingR >= 0 ? '+' : '';
      const usdSign = floatingUsd >= 0 ? '+' : '';

      // Compute price delta from entry
      let deltaStr = '';
      if (livePrice.price > 0 && pos.entryPrice > 0) {
        const diff = livePrice.price - pos.entryPrice;
        const pct = (diff / pos.entryPrice) * 100;
        const diffSign = diff >= 0 ? '+' : '';
        deltaStr = ` (${diffSign}$${diff.toFixed(2)} / ${diffSign}${pct.toFixed(2)}%)`;
      }

      // Compute distance to SL and targets
      const slDist = livePrice.price > 0 ? Math.abs(livePrice.price - pos.activeStopLoss).toFixed(2) : '---';
      const tp1Dist = livePrice.price > 0 ? Math.abs(pos.stage1Target - livePrice.price).toFixed(2) : '---';
      const tp2Dist = livePrice.price > 0 ? Math.abs(pos.stage2Target - livePrice.price).toFixed(2) : '---';

      const msg =
        `🎯 <b>[ACTIVE POSITION INSPECTION]</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 <b>Pair:</b> <code>${pos.symbol}</code> (${pos.timeframe || '5m'})\n` +
        `🧭 <b>Direction:</b> <b>${dirEmoji}</b>\n` +
        `⚡ <b>Entry Fill:</b> <code>$${pos.entryPrice.toFixed(2)}</code>\n` +
        `🔴 <b>Live Market Price:</b> <b>${livePrice.formatted}</b>${deltaStr}\n` +
        `📈 <b>Floating P&L:</b> <b>${sign}${floatingR.toFixed(2)}R (${usdSign}$${floatingUsd.toFixed(2)})</b>\n` +
        `📐 <b>Size:</b> <code>${pos.contractSize} contracts</code> ($${pos.riskUsd.toFixed(2)} Risk)\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🛡️ <b>Active Stop Loss:</b> <code>$${pos.activeStopLoss.toFixed(2)}</code> (<i>${pos.trailingSlSource}</i>) [<code>$${slDist} buffer</code>]\n` +
        `🎯 <b>TP1 (30% De-Risking):</b> <code>$${pos.stage1Target.toFixed(2)}</code> (${pos.isStage1Filled ? '✅ FILLED' : `⏳ $${tp1Dist} away`})\n` +
        `💰 <b>TP2 (70% Macro Runner):</b> <code>$${pos.stage2Target.toFixed(2)}</code> (${pos.isStage2Filled ? '✅ FILLED' : `⏳ $${tp2Dist} away`})\n` +
        (typeof pos.stage3Target === 'number' && pos.stage3Target > 0
          ? `🚀 <b>TP3 (Runner):</b> <code>$${pos.stage3Target.toFixed(2)}</code> (${pos.isStage3Filled ? '✅ FILLED' : '⏳ Open'})\n`
          : '') +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 <b>Remaining Allocation:</b> <code>${(pos.remainingAllocation * 100).toFixed(0)}%</code>\n` +
        `🏛️ <b>Setup:</b> <i>${pos.anchorName || '15m Trend Continuation / Retest POI'}</i>`;

      await this.notifier.sendRawMessage(msg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
      return;
    }

    if (pendingOrders.length > 0) {
      const ord = pendingOrders[0];
      const dirEmoji = ord.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';

      let distanceStr = '';
      if (livePrice.price > 0 && ord.limitEntryPrice > 0) {
        const diff = Math.abs(livePrice.price - ord.limitEntryPrice);
        const isAbove = livePrice.price > ord.limitEntryPrice;
        distanceStr = ` [<code>$${diff.toFixed(2)} ${isAbove ? 'above entry' : 'below entry'} ⏳</code>]`;
      }

      const msg =
        `⏳ <b>[RESTING PENDING LIMIT ORDER]</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 <b>Pair:</b> <code>${ord.symbol}</code> (${ord.timeframe || '5m'})\n` +
        `🧭 <b>Direction:</b> <b>${dirEmoji}</b>\n` +
        `🎯 <b>Limit Entry Price:</b> <code>$${ord.limitEntryPrice.toFixed(2)}</code>\n` +
        `⚡ <b>Live Market Price:</b> <b>${livePrice.formatted}</b>${distanceStr}\n` +
        `🛑 <b>Stop Loss:</b> <code>$${ord.initialStopLoss.toFixed(2)}</code>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🎯 <b>TP1 (30%):</b> <code>$${ord.stage1Target.toFixed(2)}</code>\n` +
        `💰 <b>TP2 (70%):</b> <code>$${ord.stage2Target.toFixed(2)}</code>\n` +
        `💵 <b>Risk USD:</b> <code>$${ord.riskUsd.toFixed(2)}</code> (${(ord.riskPct ?? 2.0).toFixed(1)}% Compounded)\n` +
        `🏛️ <b>Setup:</b> <i>${ord.anchorName || '15m Trend Continuation / Retest POI'}</i>\n` +
        `<i>Awaiting market price pullback to execute fill.</i>`;

      await this.notifier.sendRawMessage(msg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
      return;
    }

    const msg =
      `⚪ <b>[NO ACTIVE TRADES]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>Asset:</b> <code>${symbol.toUpperCase()}</code> (5m)\n` +
      `⚡ <b>Current Live Price:</b> <b>${livePrice.formatted} USD</b>\n` +
      `📦 <b>Active Positions:</b> <code>0</code> | ⏳ <b>Pending Limits:</b> <code>0</code>\n\n` +
      `<i>The engine is actively scanning order flow for high-confluence trend continuation setups.</i>`;

    await this.notifier.sendRawMessage(msg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
  }

  private async handleTodayCommand(): Promise<void> {
    const { ledger, symbol } = this.context;
    const sessionLog = ledger.getSessionLog();
    const livePrice = this.getLivePrice();

    const realizedR = sessionLog.totalRealizedR || 0;
    const sign = realizedR >= 0 ? '+' : '';
    const winRate =
      sessionLog.totalTrades > 0
        ? ((sessionLog.winningTrades / sessionLog.totalTrades) * 100).toFixed(1)
        : '0.0';

    let completedListStr = '';
    if (sessionLog.completedTrades && sessionLog.completedTrades.length > 0) {
      completedListStr = '\n\n📜 <b>Completed Trades Today:</b>\n';
      sessionLog.completedTrades.forEach((t, i) => {
        const rSign = (t.realizedR || 0) >= 0 ? '+' : '';
        const usdSign = (t.realizedUsd || 0) >= 0 ? '+' : '';
        const entryCairo = t.openTime ? formatCairoDateTime(t.openTime).substring(11, 16) : '—';
        const exitCairo = t.closeTime ? formatCairoDateTime(t.closeTime).substring(11, 16) : '—';
        completedListStr += `${i + 1}. <b>${t.direction}</b> @ $${t.entryPrice?.toFixed(2)} ➔ <code>${t.exitReason || 'CLOSED'}</code> (${rSign}${t.realizedR?.toFixed(2)}R / ${usdSign}$${t.realizedUsd?.toFixed(2)}) [${entryCairo} ➔ ${exitCairo} Cairo]\n`;
      });
    }

    const msg =
      `💰 <b>[TODAY'S QUANT PERFORMANCE REPORT]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📅 <b>Session Date:</b> <code>${sessionLog.dateStr}</code>\n` +
      `⚡ <b>Live Price:</b> <b>${livePrice.formatted} USD</b> (<code>${symbol.toUpperCase()}</code>)\n` +
      `💵 <b>Starting Equity:</b> <code>$${sessionLog.initialEquity.toFixed(2)} USD</code>\n` +
      `📈 <b>Current Equity:</b> <b>$${sessionLog.currentEquity.toFixed(2)} USD</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏆 <b>Total Realized R:</b> <b>${sign}${realizedR.toFixed(2)}R</b>\n` +
      `📊 <b>Total Trades:</b> <code>${sessionLog.totalTrades}</code>\n` +
      `🟢 <b>Wins / Scratches:</b> <code>${sessionLog.winningTrades}</code> (${winRate}% Win Rate)\n` +
      `🔴 <b>Losses:</b> <code>${sessionLog.losingTrades}</code>` +
      completedListStr;

    await this.notifier.sendRawMessage(msg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
  }

  private async handleSetupsCommand(): Promise<void> {
    const { getLatestSetups, symbol } = this.context;
    const setups = getLatestSetups ? getLatestSetups() : [];
    const livePrice = this.getLivePrice();

    if (!setups || setups.length === 0) {
      const msg =
        `🏛️ <b>[MONITORED TREND CONTINUATION POI ZONES]</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⚡ <b>Current Market Price:</b> <b>${livePrice.formatted} USD</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>No active un-retested trend continuation POIs currently on ${symbol.toUpperCase()}.</i>\n` +
        `The engine is indexing 15m Break of Structure & FVG Proximal shelves.`;
      await this.notifier.sendRawMessage(msg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
      return;
    }

    const recent = setups.slice(-6).reverse();
    let setupListStr = '';
    recent.forEach((s: any, idx: number) => {
      const dirEmoji = s.direction === 'LONG' ? '🟢' : '🔴';
      const level = s.entry_price || s.retest_price || s.anchor_level || 0;
      const timeStr = s.reclaim_time
        ? new Date(s.reclaim_time).toISOString().substring(11, 16) + ' UTC'
        : '---';

      let distanceStr = '';
      if (livePrice.price > 0 && level > 0) {
        const diff = livePrice.price - level;
        const diffAbs = Math.abs(diff);
        const positionRel = diff >= 0 ? 'above POI' : 'below POI';
        distanceStr = `\n   📍 <b>Live Distance:</b> <code>$${diffAbs.toFixed(2)} ${positionRel}</code>`;
      }

      setupListStr += `${idx + 1}. ${dirEmoji} <b>${s.anchor_type || '15m BOS'}</b> @ <code>$${level.toFixed(2)}</code> [${timeStr}]${distanceStr}\n   ➔ POI: <code>$${(s.anchor_level || level).toFixed(2)}</code> | TP1 (30%): <code>$${(s.stage1_target || 0).toFixed(2)}</code> | TP2 (70%): <code>$${(s.stage2_target || 0).toFixed(2)}</code>\n`;
    });

    const msg =
      `🏛️ <b>[MONITORED TREND CONTINUATION SETUPS (${setups.length} Total)]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ <b>Current Market Price:</b> <b>${livePrice.formatted} USD</b> (<code>${symbol.toUpperCase()}</code>)\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      setupListStr +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Showing latest ${recent.length} structural candidates with real-time distance.</i>`;

    await this.notifier.sendRawMessage(msg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
  }

  private async handleReconcileCommand(): Promise<void> {
    const { engine, ledger, symbol } = this.context;
    const sessionLog = ledger.getSessionLog();
    const todayStr = sessionLog.dateStr || new Date().toISOString().split('T')[0];
    const livePrice = this.getLivePrice();
    const cairoTime = formatCairoDateTime(Date.now());

    // ── PARTY 1: Authenticated Exchange Client (Binance Futures) ──
    let exchangeStatus = '⚪ SANDBOX / SIMULATED (No Live Exchange Keys)';
    let exchangeBalance = 0;
    let exchangeMargin = 0;
    let availableBalance = 0;
    let totalUnrealizedPnL = 0;
    let exchangePositions: any[] = [];
    let exchangeOrders: any[] = [];
    let isExchangeConnected = false;

    try {
      const binanceInfo = await getBinanceAccountInfo();
      if (binanceInfo) {
        isExchangeConnected = true;
        exchangeStatus = '🟢 CONNECTED (Binance USDⓈ-M Futures)';
        exchangeBalance = binanceInfo.totalWalletBalance;
        exchangeMargin = binanceInfo.totalMarginBalance;
        availableBalance = binanceInfo.availableBalance;
        totalUnrealizedPnL = binanceInfo.totalUnrealizedProfit;
        exchangePositions = binanceInfo.positions || [];

        const ordersRes = await getBinanceOpenOrders(symbol);
        if (ordersRes.success && Array.isArray(ordersRes.data)) {
          exchangeOrders = ordersRes.data;
        }
      }
    } catch (binanceErr: any) {
      exchangeStatus = `⚠️ ERROR: ${binanceErr?.message || binanceErr}`;
    }

    // ── PARTY 2: In-Daemon Ledger & Execution Engine ──
    const daemonPositions = engine.getActivePositions();
    const daemonPendingOrders = engine.getPendingLimitOrders();
    const daemonEquity = engine.getAccountEquity();
    const daemonExecutionMode = this.context.sparkDispatcher
      ? this.context.sparkDispatcher.getExecutionMode()
      : (process.env.EXECUTION_MODE || 'STANDBY');
    const daemonState = this.context.sparkDispatcher
      ? this.context.sparkDispatcher.getDaemonState()
      : (daemonPositions.length > 0 ? 'ACTIVE_TRADE' : (daemonPendingOrders.length > 0 ? 'ORDER_RESTING' : 'SEARCHING'));

    // ── PARTY 3: PostgreSQL Database Records ──
    let dbTrades: any[] = [];
    let dbAccount: any = null;
    let isDbConnected = false;

    try {
      const tradesQuery = await sql`
        SELECT trade_id, symbol, direction, entry_price, status, realized_pnl, realized_r,
               entry_time, exit_time, execution_mode
        FROM trades
        WHERE status IN ('OPEN', 'ACTIVE', 'PARTIAL', 'PENDING_LIMIT_ENTRY')
        ORDER BY entry_time DESC
        LIMIT 10;
      `;
      dbTrades = tradesQuery.rows || [];

      const accountQuery = await sql`
        SELECT current_balance, initial_capital, daily_realized_pnl, circuit_breaker_active
        FROM trading_account
        WHERE email = 'institutional_admin'
        LIMIT 1;
      `;
      if (accountQuery.rows.length > 0) {
        dbAccount = accountQuery.rows[0];
      }
      isDbConnected = true;
    } catch (dbErr) {
      console.warn('[RECONCILER] PostgreSQL query skipped (offline fallback):', dbErr);
    }

    // ── STATE RECONCILIATION & PHANTOM PURGE ──
    let desyncClearedCount = 0;

    // A. Detect & Clear Orphaned DB Trades
    if (isDbConnected && dbTrades.length > 0) {
      for (const row of dbTrades) {
        const tId = row.trade_id;
        const existsInDaemon =
          daemonPositions.some((p) => p.id === tId || (p as any).dbTradeId === tId) ||
          daemonPendingOrders.some((p) => p.id === tId || (p as any).dbTradeId === tId);
        const existsInExchange = exchangePositions.some((ep) =>
          Math.abs(parseFloat(ep.entryPrice) - Number(row.entry_price)) < 0.50
        );

        if (!existsInDaemon && !existsInExchange) {
          try {
            await sql`
              UPDATE trades
              SET status = 'RECONCILED_CLOSED',
                  exit_reason = 'TRI_PARTY_AUDIT_PURGE',
                  exit_time = NOW()
              WHERE trade_id = ${tId};
            `;
            desyncClearedCount++;
            console.log(`[RECONCILER] 🧹 Safely cleared orphaned DB phantom trade: ${tId}`);
          } catch {}
        }
      }
    }

    // B. Detect & Expire Stale In-Daemon Pending Orders
    const now = Date.now();
    for (const ord of daemonPendingOrders) {
      const ttlBars = ord.maxRetestBars || 20;
      const ttlMs = ttlBars * 5 * 60 * 1000;
      const pendingTime = ord.pendingTime || ord.openTime || now;
      if (now - pendingTime >= ttlMs) {
        engine.cancelPendingLimitOrder(ord.id, `TTL expired (${ttlBars} bars elapsed, auto-purged by Tri-Party Reconciler)`);
        desyncClearedCount++;
        console.log(`[RECONCILER] ⌛ Purged expired resting limit order: ${ord.id}`);
      }
    }

    // C. Live Binance Mode Desynchronization Detection
    if (daemonExecutionMode === 'LIVE_BINANCE' && isExchangeConnected) {
      if (daemonPositions.length > 0 && exchangePositions.length === 0) {
        for (const p of daemonPositions) {
          engine.emergencyClosePosition(p.id, livePrice.price);
          desyncClearedCount++;
          console.warn(`[RECONCILER] ⚠️ Reconciled closed position in daemon (absent on Binance): ${p.id}`);
        }
      }
    }

    // ── FORMAT AUDIT METRICS ──
    const walletBal = isExchangeConnected ? exchangeBalance : (dbAccount ? Number(dbAccount.current_balance) : daemonEquity);
    const totalEq = isExchangeConnected ? exchangeBalance + totalUnrealizedPnL : daemonEquity;
    const availBal = isExchangeConnected ? availableBalance : walletBal;
    const marginUtilPct = walletBal > 0 && isExchangeConnected
      ? Math.max(0, ((exchangeMargin - availableBalance) / walletBal) * 100)
      : 0;

    // Active Positions Block (auditing both in-daemon paper & exchange positions simultaneously)
    let positionsBlock = '';
    if (daemonPositions.length > 0) {
      daemonPositions.forEach((p, idx) => {
        const dirEmoji = p.direction === 'LONG' ? '🟢' : '🔴';
        let floatingR = p.unrealizedR || 0;
        let floatingUsd = p.unrealizedUsd || 0;
        if (floatingUsd === 0 && livePrice.price > 0 && p.entryPrice > 0) {
          const isLong = p.direction === 'LONG';
          const priceDiff = isLong ? livePrice.price - p.entryPrice : p.entryPrice - livePrice.price;
          floatingUsd = priceDiff * p.contractSize * (p.remainingAllocation ?? 1.0);
          floatingR = p.riskUsd > 0 ? floatingUsd / p.riskUsd : 0;
        }
        const signR = floatingR >= 0 ? '+' : '';
        const signUsd = floatingUsd >= 0 ? '+' : '';
        positionsBlock +=
          ` ${idx + 1}. ${dirEmoji} <b>${p.direction} ${p.symbol}</b> (<code>${p.executionMode || daemonExecutionMode}</code>)\n` +
          `    • Entry: <code>$${p.entryPrice.toFixed(2)}</code> | Mark: <code>${livePrice.formatted}</code>\n` +
          `    • Floating PnL: <b>${signR}${floatingR.toFixed(2)}R (${signUsd}$${floatingUsd.toFixed(2)})</b>\n` +
          `    • Trailing SL: <code>$${p.activeStopLoss.toFixed(2)}</code> (<i>${p.trailingSlSource}</i>)\n`;
      });
    }

    if (exchangePositions.length > 0) {
      if (positionsBlock) positionsBlock += '\n   <i>Binance USDⓈ-M Live Positions:</i>\n';
      exchangePositions.forEach((ep, idx) => {
        const amt = parseFloat(ep.positionAmt);
        const dirEmoji = amt > 0 ? '🟢 LONG' : '🔴 SHORT';
        const uPnl = parseFloat(ep.unRealizedProfit);
        const sign = uPnl >= 0 ? '+' : '';
        const entryPr = parseFloat(ep.entryPrice);
        const markPr = parseFloat(ep.markPrice);
        positionsBlock +=
          ` ${idx + 1}. ${dirEmoji} <b>${ep.symbol}</b>: <code>${amt} contracts @ $${entryPr.toFixed(2)}</code>\n` +
          `    • Mark: <code>$${markPr.toFixed(2)}</code> | Floating uPnL: <b>${sign}$${uPnl.toFixed(2)} USD</b>\n`;
      });
    }

    if (!positionsBlock) {
      positionsBlock = ' • <i>Zero active positions (No market exposure).</i>\n';
    }

    // Resting Orders Block with active TTL countdown
    let pendingOrdersBlock = '';
    if (daemonPendingOrders.length > 0) {
      daemonPendingOrders.forEach((ord, idx) => {
        const dirEmoji = ord.direction === 'LONG' ? '🟢' : '🔴';
        const ttlBars = ord.maxRetestBars || 20;
        const totalTtlMs = ttlBars * 5 * 60 * 1000;
        const pendingTime = ord.pendingTime || ord.openTime || now;
        const remainingMs = Math.max(0, totalTtlMs - (now - pendingTime));
        const remMins = Math.floor(remainingMs / 60000);
        const remSecs = Math.floor((remainingMs % 60000) / 1000);
        const remBars = Math.ceil(remainingMs / (5 * 60 * 1000));
        const countdownStr = remainingMs > 0 ? `${remBars} bars left (${remMins}m ${remSecs}s)` : 'EXPIRED';

        pendingOrdersBlock +=
          ` ${idx + 1}. ${dirEmoji} <b>${ord.direction} Limit @ $${ord.limitEntryPrice.toFixed(2)}</b>\n` +
          `    • Stop Loss: <code>$${ord.initialStopLoss.toFixed(2)}</code> | Size: <code>${ord.contractSize}</code>\n` +
          `    • TTL Countdown: <code>${countdownStr}</code>\n`;
      });
    }

    if (exchangeOrders.length > 0) {
      if (pendingOrdersBlock) pendingOrdersBlock += '\n   <i>Binance Live Resting Orders:</i>\n';
      exchangeOrders.forEach((eo, idx) => {
        const dirEmoji = eo.side === 'BUY' ? '🟢' : '🔴';
        const orderPrice = parseFloat(eo.price) || parseFloat(eo.stopPrice) || 0;
        const origQty = parseFloat(eo.origQty) || 0;
        pendingOrdersBlock +=
          ` ${idx + 1}. ${dirEmoji} <b>${eo.type} ${eo.side} @ $${orderPrice.toFixed(2)}</b> (${eo.symbol})\n` +
          `    • Order ID: <code>${eo.orderId}</code> | Qty: <code>${origQty}</code>\n`;
      });
    }

    if (!pendingOrdersBlock) {
      pendingOrdersBlock = ' • <i>No resting limit orders in queue.</i>\n';
    }

    const parityStatus = (daemonPositions.length === 0 && exchangePositions.length === 0 && desyncClearedCount === 0)
      ? '100% PERFECT PARITY'
      : desyncClearedCount > 0
        ? `PARITY RESTORED (${desyncClearedCount} DESYNCS CLEARED)`
        : 'IN-FLIGHT ACTIVE MATCH';

    // Generate Markdown report and save to run_logs/reconciliation_YYYY-MM-DD.md
    try {
      const rootDir = process.cwd();
      const logsDir = path.join(rootDir, 'run_logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const mdPath = path.join(logsDir, `reconciliation_${todayStr}.md`);

      let md = `# 🔬 Tri-Party State Reconciliation Audit (${todayStr})\n\n`;
      md += `> **Symbol:** ${symbol.toUpperCase()}  \n`;
      md += `> **Session Date:** ${todayStr} (Cairo: ${cairoTime})  \n`;
      md += `> **Execution Mode:** ${daemonExecutionMode}  \n`;
      md += `> **Exchange Gateway:** ${exchangeStatus}  \n`;
      md += `> **Daemon Active Positions:** ${daemonPositions.length}  \n`;
      md += `> **Exchange Active Positions:** ${exchangePositions.length}  \n`;
      md += `> **Daemon Pending Limits:** ${daemonPendingOrders.length}  \n`;
      md += `> **Exchange Open Orders:** ${exchangeOrders.length}  \n`;
      md += `> **Desynchronizations Cleared:** ${desyncClearedCount}  \n`;
      md += `> **Parity Status:** ${parityStatus}  \n`;
      md += `> **Generated:** ${new Date().toISOString()}  \n\n`;

      fs.writeFileSync(mdPath, md, 'utf8');
    } catch (saveErr) {
      console.warn('[RECONCILE_MD_SAVE_WARN]', saveErr);
    }

    // Build rich institutional status card
    const cardHtml =
      `🔬 <b>[TRI-PARTY STATE RECONCILIATION AUDIT]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚙️ <b>Execution Environment:</b> <code>[${daemonExecutionMode}]</code>\n` +
      `📡 <b>Daemon Status:</b> <code>ONLINE (${daemonState})</code>\n` +
      `🔌 <b>Exchange Gateway:</b> <code>${exchangeStatus}</code>\n\n` +
      `💰 <b>Capital & Margin Utilization:</b>\n` +
      ` • <b>Account Balance:</b> <code>$${walletBal.toFixed(2)} USD</code>\n` +
      ` • <b>Total Equity:</b> <b>$${totalEq.toFixed(2)} USD</b>\n` +
      ` • <b>Available:</b> <code>$${availBal.toFixed(2)} USD</code>\n` +
      ` • <b>Margin Utilization:</b> <code>${marginUtilPct.toFixed(1)}%</code>\n\n` +
      `📦 <b>Active Positions:</b>\n` +
      positionsBlock +
      `\n⏳ <b>Resting Limit Orders:</b>\n` +
      pendingOrdersBlock +
      `\n🛡️ <b>Audit Telemetry:</b>\n` +
      ` • <b>Parity Status:</b> <b>${parityStatus}</b>\n` +
      ` • <b>Orphaned Phantom Records Cleared:</b> <code>${desyncClearedCount}</code>\n` +
      ` • <b>Audited At:</b> <code>${cairoTime} Cairo</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Binance Futures ≡ In-Daemon Engine ≡ PostgreSQL Verified</i>`;

    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: '🔬 Refresh Reconcile Audit', callback_data: 'trigger_reconcile' }],
      ],
    };

    await this.notifier.sendRawMessage(cardHtml, {
      replyMarkup: inlineKeyboard,
    });
  }

  /**
   * Processes incoming Telegram callback queries (e.g. inline button clicks).
   */
  private async processIncomingCallbackQuery(cb: any): Promise<void> {
    const cbId = cb.id;
    const data = String(cb.data || '').trim();
    const chatId = cb.message?.chat?.id;
    const messageId = cb.message?.message_id;

    console.log(`[TELEGRAM_BOT] 🔘 Callback Query received: "${data}" from chat ${chatId}`);

    // Always acknowledge callback immediately to dismiss button loading spinner
    await this.notifier.answerCallbackQuery(cbId);

    if (data.startsWith('paper_trade_')) {
      const decisionId = parseInt(data.replace('paper_trade_', ''), 10);
      await this.handlePaperTradeCallback(decisionId, chatId, messageId);
    } else if (data.startsWith('live_exec_init_')) {
      const decisionId = parseInt(data.replace('live_exec_init_', ''), 10);
      await this.handleLiveExecInitCallback(decisionId, chatId, messageId);
    } else if (data.startsWith('live_exec_confirm_')) {
      const decisionId = parseInt(data.replace('live_exec_confirm_', ''), 10);
      await this.handleLiveExecConfirmCallback(decisionId, chatId, messageId);
    } else if (data.startsWith('live_exec_cancel_')) {
      const decisionId = parseInt(data.replace('live_exec_cancel_', ''), 10);
      await this.handleLiveExecCancelCallback(decisionId, chatId, messageId);
    } else if (data.startsWith('dismiss_')) {
      const decisionId = parseInt(data.replace('dismiss_', ''), 10);
      await this.handleDismissCallback(decisionId, chatId, messageId);
    } else if (data === 'trigger_reconcile') {
      await this.handleReconcileCommand();
    } else if (data === 'confirm_flatten') {
      if (this.pendingFlatten && (!messageId || this.pendingFlatten.messageId === messageId)) {
        clearTimeout(this.pendingFlatten.timeoutTimer);
        this.pendingFlatten = null;
        if (chatId && messageId) {
          await this.notifier.editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        }
        await this.executeEmergencyFlatten();
      } else {
        await this.notifier.sendRawMessage(
          `ℹ️ <b>[ACTION EXPIRED]</b> This emergency flatten confirmation has expired or was already handled.`,
          { replyMarkup: MAIN_TELEGRAM_KEYBOARD }
        );
      }
    } else if (data === 'cancel_flatten') {
      if (this.pendingFlatten && (!messageId || this.pendingFlatten.messageId === messageId)) {
        clearTimeout(this.pendingFlatten.timeoutTimer);
        this.pendingFlatten = null;
        if (chatId && messageId) {
          await this.notifier.editMessageText(
            chatId,
            messageId,
            `🛡️ <b>[EMERGENCY FLATTEN DISARMED]</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `Operation cancelled by user. <b>Zero action taken.</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `<i>Normal algorithmic execution continues uninterrupted.</i>`,
            { replyMarkup: { inline_keyboard: [] } }
          );
        } else {
          await this.notifier.sendRawMessage(
            `🛡️ <b>[EMERGENCY FLATTEN DISARMED]</b> Cancelled. Zero action taken.`,
            { replyMarkup: MAIN_TELEGRAM_KEYBOARD }
          );
        }
      } else {
        await this.notifier.sendRawMessage(
          `ℹ️ <b>[ACTION EXPIRED]</b> This confirmation has already been cleared.`,
          { replyMarkup: MAIN_TELEGRAM_KEYBOARD }
        );
      }
    }
  }

  /**
   * Dispatches command to promote standby setup to active paper trading simulator.
   */
  private async handlePaperTradeCallback(
    decisionId: number,
    chatId?: string | number,
    messageId?: number
  ): Promise<void> {
    console.log(`[TELEGRAM_BOT] 📝 User clicked [Paper Trade] for setup #${decisionId}`);

    let promotionResult = { success: false, message: '' };

    if (this.context.sparkDispatcher && typeof this.context.sparkDispatcher.promoteStandbyToMode === 'function') {
      promotionResult = await this.context.sparkDispatcher.promoteStandbyToMode(decisionId, 'PAPER_TRADING');
    } else {
      try {
        await sql`
          UPDATE agent_decision_log
          SET execution_mode = 'PAPER_TRADING',
              status = 'QUEUED',
              narrative = COALESCE(narrative, '') || ' [PROMOTED_VIA_TELEGRAM: Promoted to PAPER_TRADING @ ' || NOW() || ']',
              updated_at = NOW()
          WHERE id = ${decisionId};
        `;

        const rootDir = process.cwd();
        const commandFile = path.join(rootDir, 'run_logs', 'daemon_commands.json');
        let existingCmds: any[] = [];
        if (fs.existsSync(commandFile)) {
          try {
            existingCmds = JSON.parse(fs.readFileSync(commandFile, 'utf8'));
          } catch {}
        }
        existingCmds.push({
          id: `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          action: 'PROMOTE_STANDBY',
          decisionId,
          targetMode: 'PAPER_TRADING',
          metadata: { decisionId, targetMode: 'PAPER_TRADING' },
          status: 'PENDING',
          timestamp: Date.now(),
        });
        fs.writeFileSync(commandFile, JSON.stringify(existingCmds, null, 2), 'utf8');

        promotionResult = {
          success: true,
          message: `Decision #${decisionId} queued for Paper Trading promotion via daemon command router.`,
        };
      } catch (err: any) {
        promotionResult = {
          success: false,
          message: `Database/Command error: ${err?.message || err}`,
        };
      }
    }

    const cairoTime = formatCairoDateTime(Date.now());
    const replyText = promotionResult.success
      ? `📝 <b>[SETUP PROMOTED TO PAPER TRADING]</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Setup #<code>${decisionId}</code> promoted to <b>[PAPER_TRADING]</b>.\n` +
        `Simulated resting limit order armed in execution engine.\n` +
        `Zero real exchange margin committed.\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⏰ <code>${cairoTime} Cairo</code>`
      : `⚠️ <b>[PROMOTION FAILED]</b>\n` +
        `Could not promote setup #<code>${decisionId}</code>: ${promotionResult.message}`;

    if (chatId && messageId) {
      await this.notifier.editMessageText(chatId, messageId, replyText, {
        replyMarkup: { inline_keyboard: [] },
      });
    } else {
      await this.notifier.sendRawMessage(replyText, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
    }
  }

  /**
   * Prompts user with a two-step confirmation before executing live order on Binance.
   */
  private async handleLiveExecInitCallback(
    decisionId: number,
    chatId?: string | number,
    messageId?: number
  ): Promise<void> {
    console.log(`[TELEGRAM_BOT] ⚡ User requested [Execute Live] for setup #${decisionId} — Prompting Confirmation`);

    const confirmText =
      `⚠️ <b>[CONFIRM LIVE EXECUTION ON BINANCE FUTURES]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Are you sure you want to execute setup #<code>${decisionId}</code> on <b>LIVE BINANCE FUTURES</b>?\n\n` +
      `⚠️ <b>TRIPLE-LOCK RISK WARNING:</b>\n` +
      ` • Server environment gates will be enforced (IS_LIVE_VPS).\n` +
      ` • Global Risk Governor circuit breakers & sizing will be validated.\n` +
      ` • Real margin will be committed to the Binance Futures order book.\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Confirm execution below:</i>`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '⚡ YES, EXECUTE LIVE', callback_data: `live_exec_confirm_${decisionId}` },
          { text: '❌ NO, CANCEL', callback_data: `live_exec_cancel_${decisionId}` },
        ],
      ],
    };

    if (chatId && messageId) {
      await this.notifier.editMessageText(chatId, messageId, confirmText, {
        replyMarkup: inlineKeyboard,
      });
    } else {
      await this.notifier.sendRawMessage(confirmText, { replyMarkup: inlineKeyboard });
    }
  }

  /**
   * Disarms live execution confirmation and restores standby action buttons.
   */
  private async handleLiveExecCancelCallback(
    decisionId: number,
    chatId?: string | number,
    messageId?: number
  ): Promise<void> {
    console.log(`[TELEGRAM_BOT] 🟢 User cancelled live execution for setup #${decisionId}`);

    const cancelText =
      `🛡️ <b>[LIVE EXECUTION DISARMED]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Live execution for setup #<code>${decisionId}</code> was cancelled by user.\n` +
      `Setup returned to <b>[STANDBY]</b> observation mode. Zero live orders placed.\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Normal algorithmic observation continues uninterrupted.</i>`;

    if (chatId && messageId) {
      await this.notifier.editMessageText(chatId, messageId, cancelText, {
        replyMarkup: buildStandbyActionKeyboard(decisionId),
      });
    } else {
      await this.notifier.sendRawMessage(cancelText, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
    }
  }

  /**
   * Confirms live execution after evaluating safety gates and Risk Governor limits.
   */
  private async handleLiveExecConfirmCallback(
    decisionId: number,
    chatId?: string | number,
    messageId?: number
  ): Promise<void> {
    console.log(`[TELEGRAM_BOT] ⚡ User CONFIRMED live execution for setup #${decisionId}! Validating safety gates...`);

    // 1. Physical Environment & Safety Gate Check
    const safetyGate = evaluateExecutionSafetyGate();
    if (!safetyGate.isAllowed) {
      console.warn(`[TELEGRAM_BOT] 🚫 Live execution blocked by Safety Gate: ${safetyGate.reason}`);
      const blockedText =
        `🚫 <b>[LIVE EXECUTION BLOCKED — SAFETY GATE]</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Execution on live Binance Futures rejected.\n` +
        `⚠️ <b>Reason:</b> <code>${safetyGate.reason}</code>\n` +
        `🛑 Setup #<code>${decisionId}</code> remains in <b>[STANDBY]</b>. Zero exchange exposure.`;

      if (chatId && messageId) {
        await this.notifier.editMessageText(chatId, messageId, blockedText, {
          replyMarkup: buildStandbyActionKeyboard(decisionId),
        });
      } else {
        await this.notifier.sendRawMessage(blockedText, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
      }
      return;
    }

    // 2. Fetch setup record to validate Pre-Trade Risk Governor limits
    let record: any = null;
    try {
      const { rows } = await sql`
        SELECT * FROM agent_decision_log WHERE id = ${decisionId} LIMIT 1;
      `;
      if (rows && rows.length > 0) record = rows[0];
    } catch {}

    if (!record) {
      const errorText = `❌ <b>[EXECUTION FAILED]</b> Decision record #${decisionId} could not be retrieved from database.`;
      if (chatId && messageId) {
        await this.notifier.editMessageText(chatId, messageId, errorText, { replyMarkup: { inline_keyboard: [] } });
      } else {
        await this.notifier.sendRawMessage(errorText, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
      }
      return;
    }

    const direction = String(record.bias_signal || '').includes('BULL') ? 'LONG' : 'SHORT';
    const entryPrice = parseFloat(String(record.limit_entry_price || record.entry_range_high || record.entry_range_low || 0));
    const slPrice = parseFloat(String(record.invalidation_level || 0));

    // 3. Global Risk Governor Gatekeeper
    try {
      const riskAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
        symbol: String(record.symbol || this.context.symbol).toUpperCase(),
        direction,
        entryPrice,
        stopLossPrice: slPrice,
        currentEquity: this.context.engine.getAccountEquity(),
        currentOpenPositionsCount: this.context.engine.getActivePositions().length,
      });

      if (!riskAssessment.isApproved) {
        console.warn(`[TELEGRAM_BOT] 🛡️ Live execution vetoed by Risk Governor: ${riskAssessment.reason}`);
        const vetoText =
          `🚫 <b>[LIVE EXECUTION VETOED — RISK GOVERNOR]</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `Pre-trade risk assessment failed.\n` +
          `⚠️ <b>Violation:</b> <i>${riskAssessment.reason}</i>\n` +
          `🛑 Setup #<code>${decisionId}</code> remains in <b>[STANDBY]</b>. Zero exchange exposure.`;

        if (chatId && messageId) {
          await this.notifier.editMessageText(chatId, messageId, vetoText, {
            replyMarkup: buildStandbyActionKeyboard(decisionId),
          });
        } else {
          await this.notifier.sendRawMessage(vetoText, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
        }
        return;
      }
    } catch (riskErr) {
      console.warn('[TELEGRAM_BOT] Risk evaluation non-fatal warning:', riskErr);
    }

    // 4. Dispatch live execution to in-daemon engine or command router
    let executionResult = { success: false, message: '' };
    if (this.context.sparkDispatcher && typeof this.context.sparkDispatcher.promoteStandbyToMode === 'function') {
      executionResult = await this.context.sparkDispatcher.promoteStandbyToMode(decisionId, 'LIVE_BINANCE');
    } else {
      try {
        await sql`
          UPDATE agent_decision_log
          SET execution_mode = 'LIVE_BINANCE',
              status = 'QUEUED',
              narrative = COALESCE(narrative, '') || ' [LIVE_PROMOTION_VIA_TELEGRAM @ ' || NOW() || ']',
              updated_at = NOW()
          WHERE id = ${decisionId};
        `;

        const rootDir = process.cwd();
        const commandFile = path.join(rootDir, 'run_logs', 'daemon_commands.json');
        let existingCmds: any[] = [];
        if (fs.existsSync(commandFile)) {
          try {
            existingCmds = JSON.parse(fs.readFileSync(commandFile, 'utf8'));
          } catch {}
        }
        existingCmds.push({
          id: `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          action: 'PROMOTE_STANDBY',
          decisionId,
          targetMode: 'LIVE_BINANCE',
          metadata: { decisionId, targetMode: 'LIVE_BINANCE' },
          status: 'PENDING',
          timestamp: Date.now(),
        });
        fs.writeFileSync(commandFile, JSON.stringify(existingCmds, null, 2), 'utf8');

        executionResult = {
          success: true,
          message: `Setup #${decisionId} queued for LIVE_BINANCE execution via daemon command router.`,
        };
      } catch (err: any) {
        executionResult = {
          success: false,
          message: `Live execution dispatch error: ${err?.message || err}`,
        };
      }
    }

    const cairoTime = formatCairoDateTime(Date.now());
    const successText =
      `⚡ <b>[LIVE EXECUTION ARMED ON BINANCE FUTURES]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Setup #<code>${decisionId}</code> promoted to <b>[LIVE_BINANCE]</b>.\n` +
      `Resting maker limit order submitted to Binance USDⓈ-M Futures order book.\n` +
      `Native exchange STOP_MARKET and 30/70 take-profit ladder armed.\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⏰ <code>${cairoTime} Cairo</code>`;

    const failText =
      `❌ <b>[LIVE PROMOTION FAILED]</b>\n` +
      `Could not route setup #<code>${decisionId}</code> to live execution: ${executionResult.message}`;

    if (chatId && messageId) {
      await this.notifier.editMessageText(chatId, messageId, executionResult.success ? successText : failText, {
        replyMarkup: { inline_keyboard: [] },
      });
    } else {
      await this.notifier.sendRawMessage(executionResult.success ? successText : failText, {
        replyMarkup: MAIN_TELEGRAM_KEYBOARD,
      });
    }
  }

  /**
   * Dismisses a decision record and removes it from active proximity radar.
   */
  private async handleDismissCallback(
    decisionId: number,
    chatId?: string | number,
    messageId?: number
  ): Promise<void> {
    console.log(`[TELEGRAM_BOT] ❌ User clicked [Dismiss] for setup #${decisionId}`);

    if (this.context.sparkDispatcher && typeof this.context.sparkDispatcher.dismissDecision === 'function') {
      await this.context.sparkDispatcher.dismissDecision(decisionId);
    } else {
      try {
        await sql`
          UPDATE agent_decision_log
          SET status = 'DISMISSED',
              narrative = COALESCE(narrative, '') || ' [DISMISSED_VIA_TELEGRAM @ ' || NOW() || ']',
              updated_at = NOW()
          WHERE id = ${decisionId};
        `;
      } catch {}
      try {
        const rootDir = process.cwd();
        const commandFile = path.join(rootDir, 'run_logs', 'daemon_commands.json');
        let existingCmds: any[] = [];
        if (fs.existsSync(commandFile)) {
          try {
            existingCmds = JSON.parse(fs.readFileSync(commandFile, 'utf8'));
          } catch {}
        }
        existingCmds.push({
          id: `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          action: 'DISMISS_SETUP',
          decisionId,
          metadata: { decisionId },
          status: 'PENDING',
          timestamp: Date.now(),
        });
        fs.writeFileSync(commandFile, JSON.stringify(existingCmds, null, 2), 'utf8');
      } catch {}
    }

    const cairoTime = formatCairoDateTime(Date.now());
    const dismissText =
      `❌ <b>[SETUP DISMISSED]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Setup #<code>${decisionId}</code> has been dismissed and purged from radar.\n` +
      `Status marked as <code>DISMISSED</code> in database records.\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⏰ <code>${cairoTime} Cairo</code>`;

    if (chatId && messageId) {
      await this.notifier.editMessageText(chatId, messageId, dismissText, {
        replyMarkup: { inline_keyboard: [] },
      });
    } else {
      await this.notifier.sendRawMessage(dismissText, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
    }
  }

  /**
   * 🚨 Step 1 of Two-Factor Flatten: Arms the safety interlock and presents inline confirmation
   */
  private async handleEmergencyFlattenCommand(): Promise<void> {
    const activePositions = this.context.engine.getActivePositions();
    const pendingOrders = this.context.engine.getPendingLimitOrders();
    const livePrice = this.getLivePrice();
    const { symbol } = this.context;
    const config = this.notifier.getConfig();
    const chatId = config.chatId;

    console.log(`[TELEGRAM_BOT] ⚠️ User requested /flatten — Arming 20-second Two-Factor Interlock...`);

    // Cancel any previous pending flatten timer
    if (this.pendingFlatten) {
      clearTimeout(this.pendingFlatten.timeoutTimer);
      this.pendingFlatten = null;
    }

    const activePos = activePositions[0];
    let positionDetails = `📦 <b>Active Position:</b> <i>None (No open market exposure)</i>\n`;
    if (activePos) {
      const isLong = activePos.direction === 'LONG';
      const priceDiff = isLong ? livePrice.price - activePos.entryPrice : activePos.entryPrice - livePrice.price;
      const floatingUsd = priceDiff * activePos.contractSize;
      const floatingR = activePos.riskUsd > 0 ? floatingUsd / activePos.riskUsd : 0;
      const signUsd = floatingUsd >= 0 ? '+' : '';
      const signR = floatingR >= 0 ? '+' : '';

      positionDetails =
        `📦 <b>Active Position:</b> <b>${activePos.direction}</b> <code>${activePos.contractSize} contracts @ $${activePos.entryPrice.toFixed(2)}</code>\n` +
        `💵 <b>Floating P&L:</b> <b>${signUsd}$${floatingUsd.toFixed(2)} USD (${signR}${floatingR.toFixed(2)}R)</b>\n` +
        `🛑 <b>Active SL:</b> <code>$${activePos.activeStopLoss.toFixed(2)}</code> | 🎯 <b>TP1:</b> <code>$${activePos.stage1Target.toFixed(2)}</code>\n`;
    }

    const pendingDetails = `🛑 <b>Resting Limit Orders:</b> <code>${pendingOrders.length} pending order(s)</code>\n`;

    const warningText =
      `⚠️ <b>[EMERGENCY FLATTEN ARMED — CONFIRMATION REQUIRED]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ <b>Asset:</b> <code>${symbol.toUpperCase()}</code> (Binance Futures)\n` +
      positionDetails +
      pendingDetails +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚠️ <b>CONFIRMING WILL IMMEDIATELY:</b>\n` +
      ` • Market close active open positions\n` +
      ` • Purge all resting limit & stop orders on Binance\n` +
      ` • Clear local execution queues\n\n` +
      `⏱️ <i>Safety Timeout: Automatically disarming in 20 seconds...</i>`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '🔴 CONFIRM EMERGENCY FLATTEN', callback_data: 'confirm_flatten' },
          { text: '🟢 CANCEL / DISARM', callback_data: 'cancel_flatten' },
        ],
      ],
    };

    const sent = await this.notifier.sendRawMessageWithResponse(warningText, {
      replyMarkup: inlineKeyboard,
      targetChatId: chatId,
    });

    if (!sent.ok || !sent.messageId) {
      console.error('[TELEGRAM_BOT] ❌ Failed to dispatch armed flatten confirmation message.');
      return;
    }

    const messageId = sent.messageId;

    // Start the 20-second auto-disarm timer
    const timeoutTimer = setTimeout(async () => {
      if (this.pendingFlatten && this.pendingFlatten.messageId === messageId) {
        console.log(`[TELEGRAM_BOT] ⌛ Emergency flatten timed out after 20s. Disarming...`);
        this.pendingFlatten = null;
        await this.notifier.editMessageText(
          chatId,
          messageId,
          `⌛ <b>[EMERGENCY FLATTEN TIMED OUT]</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `20 seconds elapsed with no confirmation.\n` +
          `🛡️ Safety interlock disarmed. <b>No trades were touched.</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `<i>Normal algorithmic execution continues uninterrupted.</i>`,
          { replyMarkup: { inline_keyboard: [] } }
        );
      }
    }, 20000);

    this.pendingFlatten = {
      chatId,
      messageId,
      armedAt: Date.now(),
      timeoutTimer,
    };
  }

  /**
   * 🚨 Step 2: Executes the verified emergency flatten after user confirmation
   */
  private async executeEmergencyFlatten(): Promise<void> {
    const activePositions = this.context.engine.getActivePositions();
    const livePrice = this.getLivePrice();

    console.log(`[TELEGRAM_BOT] 🚨 EXECUTING CONFIRMED EMERGENCY FLATTEN!`);

    // 1. Purge all pending limit orders in engine
    const purgedPendingCount = this.context.engine.emergencyClearAllPendingOrders();

    // 2. Emergency close active open position in engine
    let closedPositionSummary = 'No active position open.';
    const activePos = activePositions[0];
    if (activePos) {
      this.context.engine.emergencyClosePosition(activePos.id, livePrice.price);
      closedPositionSummary = `${activePos.direction} ${activePos.contractSize} contracts @ ~$${livePrice.price.toFixed(2)}`;
    }

    // 3. Call Binance Order Router to cancel orders and market close on Binance
    const routerResult = await routeEmergencyFlatten(this.context.symbol, activePos);

    // 4. Log to persistence ledger
    this.context.ledger.logEvent('EMERGENCY_FLATTEN', `Telegram /flatten executed: ${closedPositionSummary}`, {
      metadata: {
        purgedPendingCount,
        closedPosition: activePos
          ? { id: activePos.id, direction: activePos.direction, size: activePos.contractSize }
          : null,
        currentPrice: livePrice.price,
        routerMessage: routerResult.message,
      },
    });

    const cairoTime = formatCairoDateTime(Date.now());

    const message =
      `🚨 <b>[EMERGENCY FLATTEN COMPLETED]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ <b>Asset:</b> <code>${this.context.symbol.toUpperCase()}</code>\n` +
      `🏷️ <b>Action:</b> Instant Market Liquidation & Order Purge\n` +
      `🛑 <b>Pending Limits Purged:</b> <code>${purgedPendingCount}</code>\n` +
      `📦 <b>Closed Position:</b> <code>${closedPositionSummary}</code>\n` +
      `🛡️ <b>Exchange Router:</b> <i>${routerResult.message}</i>\n` +
      `⏰ <b>Timestamp:</b> <code>${cairoTime} Cairo</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ <i>Account is flat. Zero active resting risk.</i>`;

    await this.notifier.sendRawMessage(message, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
  }

  /**
   * /risk: Real-time report of Global Risk Governor parameters, daily P&L, and circuit breaker health
   */
  private async handleRiskCommand(): Promise<void> {
    const { config, state } = await GlobalRiskGovernor.hydrateState('institutional_admin');
    const equity = state.current_balance;
    const riskUsd = (equity * config.risk_per_trade_pct) / 100;
    const estSize = (riskUsd / 10).toFixed(3);
    const cbStatus = state.circuit_breaker_active
      ? `🚨 <b>ENGAGED (LOCKED)</b>\n<i>Reason: ${state.circuit_breaker_reason || 'Threshold reached'}</i>`
      : `🟢 <b>ARMED & NORMAL (No Halts)</b>`;

    const sign = state.daily_realized_pnl >= 0 ? '+' : '';

    const message =
      `🛡️ <b>[GLOBAL RISK GOVERNOR REPORT]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 <b>Ledger Equity:</b> <code>$${equity.toFixed(2)} USD</code>\n` +
      `📊 <b>Operational Risk:</b> <code>${config.risk_per_trade_pct.toFixed(2)}% ($${riskUsd.toFixed(2)} USD)</code>\n` +
      `🎯 <b>Size Est. ($10 Stop):</b> <code>${estSize} ETH</code>\n` +
      `🧱 <b>Risk Ceiling:</b> <code>${config.max_risk_limit_pct.toFixed(2)}%</code>\n\n` +
      `📉 <b>Today's Realized P&L:</b> <code>${sign}$${state.daily_realized_pnl.toFixed(2)} USD</code>\n` +
      `🛑 <b>Max Daily Drawdown:</b> <code>-${config.max_daily_loss_pct.toFixed(2)}% (-$${config.max_daily_loss_usd.toFixed(2)})</code>\n` +
      `⚠️ <b>Loss Streak:</b> <code>${state.consecutive_losses_count} / ${config.max_consecutive_losses} max</code>\n` +
      `🔄 <b>Daily Trades:</b> <code>${state.daily_trades_count} / ${config.max_daily_trades} cap</code>\n\n` +
      `⚡ <b>Circuit Breaker:</b>\n${cbStatus}\n` +
      `⏰ <b>Server Time:</b> <code>${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC</code>`;

    await this.notifier.sendRawMessage(message, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
  }

  /**
   * /reset_risk: Unlocks circuit breaker and restores operational status
   */
  private async handleResetRiskCommand(): Promise<void> {
    await GlobalRiskGovernor.resetCircuitBreaker('institutional_admin');
    await this.notifier.sendRawMessage(
      `🔓 <b>[CIRCUIT BREAKER RESET]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ Circuit breaker manually unlocked.\n` +
      `🔄 Consecutive loss streak reset to 0.\n` +
      `🚀 Automated execution engine re-armed for live orders.\n` +
      `⏰ <b>Timestamp:</b> <code>${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC</code>`,
      { replyMarkup: MAIN_TELEGRAM_KEYBOARD }
    );
  }

  public isRunning(): boolean {
    return this.isPolling;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
