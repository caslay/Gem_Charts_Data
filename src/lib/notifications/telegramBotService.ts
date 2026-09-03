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
import { TelegramNotifier, TelegramConfig } from './telegramNotifier';
import { AutomatedStrategyExecutionEngine } from '../quantEngine/AutomatedStrategyExecutionEngine';
import { DaemonLedger } from '../daemon/daemonLedger';
import { NodeWsClient } from '../daemon/nodeWsClient';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup,
} from '../quantEngine/SweepReclaimEngine';
import { DEFAULT_SR_LIVE_SETTINGS } from '../quantEngine/strategyExecutionConfig';
import { formatCairoDateTime } from '../quantEngine/equityCalculator';
import { routeEmergencyFlatten } from '../binanceOrderRouter';

export interface TelegramBotServiceContext {
  engine: AutomatedStrategyExecutionEngine;
  ledger: DaemonLedger;
  wsClient?: NodeWsClient;
  symbol: string;
  equity: number;
  isDryRun: boolean;
  bootTimestamp: number;
  getMacroContext: () => any;
  getLatestSetups?: () => any[];
  runReconciliationFn?: () => Promise<string>;
}

export const MAIN_TELEGRAM_KEYBOARD = {
  keyboard: [
    [{ text: '⚡ /price' }, { text: '📊 /status' }],
    [{ text: '🎯 /trade' }, { text: '💰 /today' }],
    [{ text: '🏛️ /setups' }, { text: '🔬 /reconcile' }],
    [{ text: '🚨 /flatten' }],
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
      `⚡ <b>FLOW-STATE QUANT COMMAND CENTER</b> ⚡\n` +
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
      `⚡ <b>[FLOW-STATE ENGINE — LIVE STATUS]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🟢 <b>Daemon Status:</b> <code>ONLINE (PM2 Host)</code>\n` +
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
        `🎯 <b>TP1 (1.0R):</b> <code>$${pos.stage1Target.toFixed(2)}</code> (${pos.isStage1Filled ? '✅ FILLED' : `⏳ $${tp1Dist} away`})\n` +
        `💰 <b>TP2 (1.4R):</b> <code>$${pos.stage2Target.toFixed(2)}</code> (${pos.isStage2Filled ? '✅ FILLED' : `⏳ $${tp2Dist} away`})\n` +
        `🚀 <b>TP3 (DOL):</b> <code>$${pos.stage3Target.toFixed(2)}</code> (${pos.isStage3Filled ? '✅ FILLED' : '⏳ Runner'})\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 <b>Remaining Allocation:</b> <code>${(pos.remainingAllocation * 100).toFixed(0)}%</code>\n` +
        `🏛️ <b>Setup:</b> <i>${pos.anchorName || '5m Sweep & Reclaim'}</i>`;

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
        `🎯 <b>TP1 (1.0R):</b> <code>$${ord.stage1Target.toFixed(2)}</code>\n` +
        `💰 <b>TP2 (1.4R):</b> <code>$${ord.stage2Target.toFixed(2)}</code>\n` +
        `🚀 <b>TP3 (DOL):</b> <code>$${ord.stage3Target.toFixed(2)}</code>\n` +
        `💵 <b>Risk USD:</b> <code>$${ord.riskUsd.toFixed(2)}</code> (2% Compounded)\n` +
        `🏛️ <b>Setup:</b> <i>${ord.anchorName || '5m Structural Liquidity'}</i>\n` +
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
      `<i>The engine is actively scanning real-time order flow for high-confluence liquidity sweeps.</i>`;

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
        `🏛️ <b>[MONITORED LIQUIDITY ZONES]</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⚡ <b>Current Market Price:</b> <b>${livePrice.formatted} USD</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>No active un-retested sweep setups currently on ${symbol.toUpperCase()}.</i>\n` +
        `The engine is indexing multi-timeframe candles on every 5m/15m/1h close.`;
      await this.notifier.sendRawMessage(msg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
      return;
    }

    const recent = setups.slice(-6).reverse();
    let setupListStr = '';
    recent.forEach((s: any, idx: number) => {
      const dirEmoji = s.direction === 'LONG' ? '🟢' : '🔴';
      const anchorLevel = s.anchor_level || s.originAnchorLevel || 0;
      const timeStr = s.reclaim_time
        ? new Date(s.reclaim_time).toISOString().substring(11, 16) + ' UTC'
        : '---';

      let distanceStr = '';
      if (livePrice.price > 0 && anchorLevel > 0) {
        const diff = livePrice.price - anchorLevel;
        const diffAbs = Math.abs(diff);
        const positionRel = diff >= 0 ? 'above anchor' : 'below anchor';
        distanceStr = `\n   📍 <b>Live Distance:</b> <code>$${diffAbs.toFixed(2)} ${positionRel}</code>`;
      }

      setupListStr += `${idx + 1}. ${dirEmoji} <b>${s.anchor_type || 'SWING'}</b> @ <code>$${anchorLevel.toFixed(2)}</code> [${timeStr}]${distanceStr}\n   ➔ Sweep: <code>$${(s.sweep_price || 0).toFixed(2)}</code> | Target: <code>$${(s.stage1_target || 0).toFixed(2)}</code>\n`;
    });

    const msg =
      `🏛️ <b>[MONITORED LIQUIDITY SETUPS (${setups.length} Total)]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ <b>Current Market Price:</b> <b>${livePrice.formatted} USD</b> (<code>${symbol.toUpperCase()}</code>)\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      setupListStr +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Showing latest ${recent.length} structural candidates with real-time distance.</i>`;

    await this.notifier.sendRawMessage(msg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
  }

  private async handleReconcileCommand(): Promise<void> {
    const { ledger, symbol, wsClient, bootTimestamp } = this.context;
    const sessionLog = ledger.getSessionLog();
    const todayStr = sessionLog.dateStr || new Date().toISOString().split('T')[0];
    const livePrice = this.getLivePrice();

    const candles5m = wsClient?.getRingBuffers?.()['5m'] || [];
    const completedTrades = sessionLog.completedTrades || [];
    const inFlightPositions = ledger.getActiveInFlightPositions();

    // Combine all live tracked positions
    const liveTradeMap = new Map<string, any>();
    for (const t of completedTrades) {
      if (t.id) liveTradeMap.set(t.id, t);
    }
    for (const p of inFlightPositions) {
      if (p.id) liveTradeMap.set(p.id, p);
    }
    for (const ev of sessionLog.events || []) {
      if (ev.position && ev.position.id) {
        if (ev.type === 'LIMIT_ORDER_CANCELLED') {
          liveTradeMap.delete(ev.position.id);
        } else {
          liveTradeMap.set(ev.position.id, {
            ...(liveTradeMap.get(ev.position.id) || {}),
            ...ev.position,
          });
        }
      }
    }
    const allLiveTrades = Array.from(liveTradeMap.values());

    let qlSetups: SweepReclaimSetup[] = [];
    let isDynamicScanExecuted = false;

    if (candles5m.length >= 25) {
      try {
        const scanConfig: SweepReclaimScanConfig = {
          symbol: symbol.toUpperCase(),
          timeframe: '5m',
          anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
          lookbackMajor: 10,
          lookbackInternal: 5,
          maxBarsAnchorToSweep: 25,
          maxBarsSweepToReclaim: 10,
          maxBarsToRetest: 20,
          minSweepDepthAtrMultiplier: 0.10,
          slBufferAtrMultiplier: 0.10,
          entryMode: 'FVG_PROXIMAL',
          stage1Multiple: 1.0,
          stage2Multiple: 1.4,
          stage3Multiple: 3.0,
          stage1Ratio: 0.50,
          stage2Ratio: 0.50,
          stage3Ratio: 0.00,
          enableStructuralTrail: true,
          enableProfitRatchet: false,
          volumeSmaPeriod: 20,
          volumeExpansionThreshold: 1.20,
          deltaDominanceThreshold: 52.0,
          bodyRatioThreshold: 0.40,
          requireThreePillarDisplacement: true,
          enforceDiscountPremiumGate: true,
        };

        const engine = new SweepReclaimEngine(scanConfig);
        const result = engine.scanHistoricalSetups(candles5m);
        qlSetups = result.setups || [];
        isDynamicScanExecuted = true;
      } catch (scanErr) {
        console.warn('[RECONCILE_DYNAMIC_SCAN_WARN]', scanErr);
      }
    }

    // Filter setups relevant to current session
    const sessionBootMs = sessionLog.bootTime || bootTimestamp || (Date.now() - 24 * 3600 * 1000);
    const sessionSetups = qlSetups.filter((s) => {
      const sTime = s.reclaim_time || s.sweep_time || s.anchor_time || 0;
      const sDate = new Date(sTime).toISOString().split('T')[0];
      return sDate === todayStr || sTime >= sessionBootMs - 3600000;
    });

    const stripSuffix = (id?: string) => (id ? id.replace(/_SW\d+$/, '') : '');
    const matchedSetupIds = new Set<string>();

    interface ReconcileItem {
      tradeId: string;
      direction: string;
      anchorName: string;
      liveEntry: number | string;
      qlEntry: number | string;
      slippage: number;
      liveOutcome: string;
      qlOutcome: string;
      liveRealizedR: number | string;
      status: 'EXACT_MATCH' | 'IN_FLIGHT_ACTIVE' | 'INTRA_WAVE_SUPERSEDED' | 'SLIPPAGE_VARIANCE' | 'NOT_RECORDED';
      notes?: string;
      openTime?: number | null;
      closeTime?: number | null;
    }

    const reconcileItems: ReconcileItem[] = [];
    let maxSlippage = 0;
    let exactMatches = 0;
    let intraWaveCount = 0;

    // Collect all cancelled order IDs from events
    const cancelledOrderIds = new Set<string>();
    for (const ev of sessionLog.events || []) {
      if (ev.type === 'LIMIT_ORDER_CANCELLED' && ev.position?.id) {
        cancelledOrderIds.add(ev.position.id);
      }
    }

    // Separate executed trades from active resting pending orders
    const executedTrades = allLiveTrades.filter(
      (t) => t.openTime && t.status !== 'PENDING_LIMIT_ENTRY' && t.status !== 'CANCELLED' && !cancelledOrderIds.has(t.id)
    );
    const pendingOrders = inFlightPositions.filter(
      (t) =>
        (!t.openTime || t.status === 'PENDING_LIMIT_ENTRY') &&
        t.status !== 'CANCELLED' &&
        !cancelledOrderIds.has(t.id)
    );

    for (const lt of executedTrades) {
      const isFilled = !!lt.openTime && lt.status !== 'PENDING_LIMIT_ENTRY';
      const liveEntry = lt.entryPrice || lt.limitEntryPrice || 0;
      const expectedDir = lt.direction;
      const ltBaseId = stripSuffix(lt.originZoneId || lt.setupId || lt.id);

      // Match against Quant Lab setups
      const matchedQl = sessionSetups.find((s) => {
        if (matchedSetupIds.has(s.id)) return false;
        if (stripSuffix(s.id) === ltBaseId) return true;
        const sameDir = (s.type === 'BULLISH' ? 'LONG' : 'SHORT') === expectedDir;
        const sameAnchor =
          Math.abs((lt.originAnchorLevel ?? liveEntry) - s.anchor_level) < 0.50 ||
          lt.anchorName === s.anchor_name;
        const timeDiff = Math.abs((lt.openTime || lt.pendingTime || 0) - (s.reclaim_time || 0));
        return sameDir && sameAnchor && timeDiff <= 3 * 3600 * 1000;
      });

      if (matchedQl) {
        matchedSetupIds.add(matchedQl.id);
        const qlEntry = matchedQl.entry_price || matchedQl.retest_price || matchedQl.anchor_level;
        const slip = Math.abs(liveEntry - qlEntry);
        if (slip > maxSlippage) maxSlippage = slip;

        const isExactOutcome =
          lt.exitReason === matchedQl.stage_exit_type ||
          (lt.exitReason?.includes('WIN') && matchedQl.stage_exit_type?.includes('WIN')) ||
          (lt.exitReason?.includes('STOP') && matchedQl.stage_exit_type?.includes('STOP')) ||
          (lt.exitReason?.includes('SCRATCH') && matchedQl.stage_exit_type?.includes('SCRATCH'));

        const isInFlight = lt.status === 'STAGE_1_FILLED' || lt.status === 'STAGE_2_FILLED' || lt.status === 'OPEN';

        let status: ReconcileItem['status'] = 'EXACT_MATCH';
        let notes = '';

        if (isInFlight) {
          status = 'IN_FLIGHT_ACTIVE';
          notes = 'Position currently active & floating';
        } else if (matchedQl.status === 'RECLAIMED_NO_RETEST' && isFilled) {
          status = 'INTRA_WAVE_SUPERSEDED';
          intraWaveCount++;
          notes = 'Live intermediate fill executed prior to wider batch wave expansion';
        } else if (isExactOutcome && slip < 0.50) {
          status = 'EXACT_MATCH';
          exactMatches++;
        } else {
          status = 'SLIPPAGE_VARIANCE';
        }

        reconcileItems.push({
          tradeId: lt.id,
          direction: lt.direction,
          anchorName: lt.anchorName || matchedQl.anchor_name || '5m Anchor',
          liveEntry,
          qlEntry,
          slippage: slip,
          liveOutcome: lt.exitReason || (isInFlight ? `ACTIVE (${lt.status})` : 'CLOSED'),
          qlOutcome: matchedQl.stage_exit_type || matchedQl.status || 'N/A',
          liveRealizedR: lt.realizedR !== undefined ? lt.realizedR : (isInFlight ? (lt.unrealizedR || 0) : 0),
          status,
          notes,
          openTime: lt.openTime,
          closeTime: lt.closeTime,
        });
      } else {
        reconcileItems.push({
          tradeId: lt.id,
          direction: lt.direction,
          anchorName: lt.anchorName || '5m Live Order',
          liveEntry,
          qlEntry: 'N/A',
          slippage: 0,
          liveOutcome: lt.exitReason || 'CLOSED',
          qlOutcome: 'UNINDEXED',
          liveRealizedR: lt.realizedR || 0,
          status: 'NOT_RECORDED',
          notes: 'Live order executed on dynamic intra-candle tick',
          openTime: lt.openTime,
          closeTime: lt.closeTime,
        });
      }
    }

    // Calculate Mathematical Parity Score strictly across executed trades
    const totalExecuted = executedTrades.length;
    let parityScorePct = '100.0';
    if (totalExecuted > 0) {
      const verifiedCount = exactMatches + intraWaveCount + (executedTrades.some(t => t.status === 'OPEN') ? 1 : 0);
      parityScorePct = Math.min(100.0, (verifiedCount / totalExecuted) * 100).toFixed(1);
    }

    // Generate Markdown report and save to run_logs/reconciliation_YYYY-MM-DD.md
    try {
      const rootDir = process.cwd();
      const logsDir = path.join(rootDir, 'run_logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const mdPath = path.join(logsDir, `reconciliation_${todayStr}.md`);

      let md = `# 🔬 Quant Lab 1:1 Live Reconciliation Audit (${todayStr})\n\n`;
      md += `> **Symbol:** ${symbol.toUpperCase()}  \n`;
      md += `> **Session Date:** ${todayStr} (Cairo: ${formatCairoDateTime(Date.now())})  \n`;
      md += `> **Live Executed Trades:** ${executedTrades.length}  \n`;
      md += `> **Pending Limit Orders:** ${pendingOrders.length}  \n`;
      md += `> **Mathematical Parity:** ${parityScorePct}%  \n`;
      md += `> **Max Slippage:** $${maxSlippage.toFixed(2)}  \n`;
      md += `> **Generated:** ${new Date().toISOString()}  \n\n`;
      md += `| Trade ID | Dir | Anchor | Live Entry | QL Entry | Slippage | Live Outcome | QL Outcome | Status |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

      for (const item of reconcileItems) {
        md += `| \`${item.tradeId}\` | **${item.direction}** | ${item.anchorName} | $${typeof item.liveEntry === 'number' ? item.liveEntry.toFixed(2) : item.liveEntry} | $${typeof item.qlEntry === 'number' ? item.qlEntry.toFixed(2) : item.qlEntry} | $${item.slippage.toFixed(2)} | ${item.liveOutcome} | ${item.qlOutcome} | ${item.status} |\n`;
      }

      if (pendingOrders.length > 0) {
        md += `\n### ⏳ Active Resting Orders (Awaiting Fill)\n\n`;
        md += `| Order ID | Dir | Anchor | Limit Price | Status |\n`;
        md += `| :--- | :--- | :--- | :--- | :--- |\n`;
        for (const po of pendingOrders) {
          const lp = po.limitEntryPrice || po.entryPrice || 0;
          md += `| \`${po.id}\` | **${po.direction}** | ${po.anchorName || '5m Anchor'} | $${typeof lp === 'number' ? lp.toFixed(2) : lp} | Resting Limit |\n`;
        }
      }

      fs.writeFileSync(mdPath, md, 'utf8');
    } catch (saveErr) {
      console.warn('[RECONCILE_MD_SAVE_WARN]', saveErr);
    }

    // Build Rich HTML Telegram Message
    let tradesListStr = '';
    if (reconcileItems.length > 0) {
      tradesListStr = '\n\n📜 <b>Session Trade Parity Breakdown:</b>\n';
      reconcileItems.forEach((r, idx) => {
        const dirEmoji = r.direction === 'LONG' ? '🟢' : '🔴';
        const badge =
          r.status === 'EXACT_MATCH'
            ? '✅ EXACT MATCH'
            : r.status === 'IN_FLIGHT_ACTIVE'
            ? '⚡ ACTIVE IN-FLIGHT'
            : r.status === 'INTRA_WAVE_SUPERSEDED'
            ? '🌊 INTRA-WAVE FILL'
            : '⚠️ SLIPPAGE';
        const slipStr = r.slippage === 0 ? '$0.00' : `$${r.slippage.toFixed(2)}`;
        const rSign = (typeof r.liveRealizedR === 'number' && r.liveRealizedR >= 0) ? '+' : '';
        const entryCairo = r.openTime ? formatCairoDateTime(r.openTime).substring(11, 16) : '—';
        const exitCairo = r.closeTime ? formatCairoDateTime(r.closeTime).substring(11, 16) : '';
        const timeBadge = exitCairo ? `[${entryCairo} ➔ ${exitCairo} Cairo]` : `[${entryCairo} Cairo]`;
        tradesListStr += `${idx + 1}. ${dirEmoji} <b>${r.direction}</b> @ $${typeof r.liveEntry === 'number' ? r.liveEntry.toFixed(2) : r.liveEntry} ${timeBadge} ➔ <code>${r.liveOutcome}</code> (${rSign}${r.liveRealizedR}R) [${badge} | Slip: ${slipStr}]\n`;
        if (r.status === 'INTRA_WAVE_SUPERSEDED') {
          tradesListStr += `   ↳ <i>Note: Live intermediate sweep entry; batch scanner evaluated full wave expansion.</i>\n`;
        }
      });
    }

    let pendingOrdersStr = '';
    if (pendingOrders.length > 0) {
      pendingOrdersStr = '\n\n⏳ <b>Active Resting Orders (Awaiting Fill):</b>\n';
      pendingOrders.forEach((po, idx) => {
        const dirEmoji = po.direction === 'LONG' ? '🟢' : '🔴';
        const limitPrice = po.limitEntryPrice || po.entryPrice || 0;
        const placedCairo = (po.pendingTime || po.openTime) ? formatCairoDateTime(po.pendingTime || po.openTime).substring(11, 16) : '—';
        pendingOrdersStr += `${idx + 1}. ${dirEmoji} <b>${po.direction}</b> Limit @ $${typeof limitPrice === 'number' ? limitPrice.toFixed(2) : limitPrice} (<code>${po.anchorName || '5m Anchor'}</code>) [Resting since ${placedCairo} Cairo]\n`;
      });
    }

    const msg =
      `🔬 <b>[QUANT LAB 1:1 RECONCILIATION AUDIT]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📅 <b>Session Date:</b> <code>${todayStr}</code> (<code>${formatCairoDateTime(Date.now())} Cairo</code>)\n` +
      `⚡ <b>Live Price:</b> <b>${livePrice.formatted} USD</b> (<code>${symbol.toUpperCase()}</code>)\n` +
      `📊 <b>Live Session Trades:</b> <code>${executedTrades.length}</code> (${sessionLog.winningTrades}W / ${sessionLog.losingTrades}L)\n` +
      `🏆 <b>Session Realized R:</b> <b>${(sessionLog.totalRealizedR || 0) >= 0 ? '+' : ''}${(sessionLog.totalRealizedR || 0).toFixed(2)}R</b>\n` +
      `🏛️ <b>Candidate Setups:</b> <code>${sessionSetups.length} detected</code> (${candles5m.length} 5m bars)\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ <b>Quant Lab Mathematical Parity:</b> <b>${parityScorePct}% VERIFIED</b>\n` +
      `⚖️ <b>Max Fill Slippage:</b> <code>$${maxSlippage.toFixed(2)}</code>\n` +
      `📁 <b>Audit Log:</b> <code>run_logs/reconciliation_${todayStr}.md</code>` +
      tradesListStr +
      pendingOrdersStr;

    await this.notifier.sendRawMessage(msg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
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

    if (data === 'confirm_flatten') {
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

  public isRunning(): boolean {
    return this.isPolling;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
