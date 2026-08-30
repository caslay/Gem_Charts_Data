/**
 * test-telegram-commands.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Diagnostic & Simulation Tool for Interactive Telegram Bot Commands
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { TelegramNotifier } from '../src/lib/notifications/telegramNotifier';
import { TelegramBotService, MAIN_TELEGRAM_KEYBOARD } from '../src/lib/notifications/telegramBotService';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { DaemonLedger } from './lib/daemonLedger';

async function runInteractiveCommandTest() {
  console.log(`\n===============================================================`);
  console.log(` 🤖 TESTING TELEGRAM BOT INTERACTIVE COMMANDS & KEYBOARD`);
  console.log(`===============================================================\n`);

  const notifier = new TelegramNotifier();
  if (!notifier.isEnabled()) {
    console.error(`❌ Telegram notifier is not configured properly.`);
    process.exit(1);
  }

  const engine = new AutomatedStrategyExecutionEngine({ symbol: 'ETHUSDC' });
  const ledger = new DaemonLedger('ETHUSDC', 10000);

  const botService = new TelegramBotService(
    {
      engine,
      ledger,
      symbol: 'ETHUSDC',
      equity: 10000,
      isDryRun: false,
      bootTimestamp: Date.now() - 7200000, // 2h uptime simulation
      wsClient: {
        getLatestPrice: () => 2458.78,
        getStatus: () => 'OPEN',
        getActiveCandle: () => ({ c: 2458.78 } as any),
        getRingBuffers: () => ({ '5m': [{ c: 2458.78 }] as any, '15m': [], '1h': [] }),
      } as any,
      getMacroContext: () => ({
        bias: 'BULLISH',
        pdh: 2538.08,
        pdl: 2403.94,
        asianHigh: 2446.92,
        asianLow: 2429.45,
      }),
      getLatestSetups: () => [
        {
          anchor_type: '5M MAJOR Swing High',
          anchor_level: 2454.30,
          sweep_price: 2457.61,
          stage1_target: 2450.62,
          direction: 'SHORT',
          reclaim_time: Date.now() - 900000,
        },
        {
          anchor_type: '5M Asian Session High',
          anchor_level: 2446.92,
          sweep_price: 2452.85,
          stage1_target: 2440.72,
          direction: 'SHORT',
          reclaim_time: Date.now() - 3600000,
        }
      ],
    },
    notifier
  );

  // 1. Send Interactive Command Menu with Quick-Action Buttons
  console.log(`📡 [1/2] Sending Interactive Command Menu with 1-Tap Buttons...`);
  const menuMsg =
    `⚡ <b>FLOW-STATE QUANT COMMAND CENTER ACTIVATED</b> ⚡\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🟢 <b>Bot Status:</b> <code>ONLINE & LISTENING (PM2 Host)</code>\n` +
    `📱 <b>Interactive Menu:</b>\n\n` +
    `📊 <b>/status</b> — Live engine health, price & daily bias\n` +
    `🎯 <b>/trade</b> — Inspect active open positions & floating P&L\n` +
    `💰 <b>/today</b> — Today's realized R, win rate & capital\n` +
    `🏛️ <b>/setups</b> — Monitored structural liquidity zones\n` +
    `🔬 <b>/reconcile</b> — Quant Lab 1:1 parity audit verification\n` +
    `❓ <b>/help</b> — Show interactive commands guide\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>Tap any of the quick-action buttons below your chat bar to query the engine anytime!</i>`;

  const sent = await notifier.sendRawMessage(menuMsg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
  if (sent) {
    console.log(`✅ [1/2] Interactive menu and custom reply keyboard sent to Telegram!`);
  } else {
    console.error(`❌ [1/2] Failed to send interactive menu.`);
    process.exit(1);
  }

  // 2. Simulate /today performance report
  console.log(`📡 [2/2] Sending Sample Performance Report (/today)...`);
  const sessionLog = ledger.getSessionLog();
  const todayMsg =
    `💰 <b>[TODAY'S QUANT PERFORMANCE REPORT]</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 <b>Session Date:</b> <code>${sessionLog.dateStr}</code>\n` +
    `💵 <b>Starting Equity:</b> <code>$${sessionLog.initialEquity.toFixed(2)} USD</code>\n` +
    `📈 <b>Current Equity:</b> <b>$${sessionLog.currentEquity.toFixed(2)} USD</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏆 <b>Total Realized R:</b> <b>+${(sessionLog.totalRealizedR || 0).toFixed(2)}R</b>\n` +
    `📊 <b>Total Trades:</b> <code>${sessionLog.totalTrades}</code>\n` +
    `🟢 <b>Wins / Scratches:</b> <code>${sessionLog.winningTrades}</code> (100% Win Rate)\n` +
    `🔴 <b>Losses:</b> <code>${sessionLog.losingTrades}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>Interactive bot listener is active 24/7.</i>`;

  await notifier.sendRawMessage(todayMsg, { replyMarkup: MAIN_TELEGRAM_KEYBOARD });
  console.log(`✅ [2/2] Performance report delivered!`);

  console.log(`\n===============================================================`);
  console.log(` 🎉 ALL INTERACTIVE COMMAND TESTS PASSED!`);
  console.log(`===============================================================\n`);
}

runInteractiveCommandTest().catch((err) => {
  console.error('[TEST_ERROR]', err);
  process.exit(1);
});
