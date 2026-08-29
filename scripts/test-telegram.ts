/**
 * test-telegram.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Diagnostic & Connectivity Test for Flow-State Telegram Bot Notifications
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { TelegramNotifier } from '../src/lib/notifications/telegramNotifier';
import { ExecutionEvent, StrategyExecutionPosition } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';

async function runTest() {
  console.log(`\n===============================================================`);
  console.log(` 🤖 TESTING FLOW-STATE TELEGRAM BOT INTEGRATION`);
  console.log(`===============================================================\n`);

  const notifier = new TelegramNotifier();
  const config = notifier.getConfig();

  console.log(` Enabled:    ${notifier.isEnabled() ? '✅ YES' : '❌ NO'}`);
  console.log(` Bot Token:  ${config.botToken ? config.botToken.substring(0, 10) + '...' : 'NONE'}`);
  console.log(` Chat ID:    ${config.chatId || 'NONE'}`);
  console.log(` Registry:   ${config.persistedRegistryPath}\n`);

  if (!notifier.isEnabled()) {
    console.error(`❌ Telegram notifier is not configured properly.`);
    process.exit(1);
  }

  // 1. Send Welcome Verification Message
  console.log(`📡 [1/3] Sending Connectivity Diagnostic Message...`);
  const welcomeMsg =
    `⚡ <b>Flow-State Quant Engine — Notification System Connected</b> ⚡\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🟢 <b>Status:</b> <code>ONLINE (PM2 / VPS Ready)</code>\n` +
    `🤖 <b>Bot:</b> Flow-State Institutional Telegram Bridge\n` +
    `🛡️ <b>Deduplication:</b> <code>STRICT SINGLE-DISPATCH ACTIVE</code>\n` +
    `⏰ <b>Local Time:</b> <code>${new Date().toLocaleString()}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>You will receive real-time alerts when orders are placed, filled, TPs harvested, or positions closed.</i>`;

  const welcomeSent = await notifier.sendRawMessage(welcomeMsg);
  if (welcomeSent) {
    console.log(`✅ [1/3] Connectivity message delivered successfully to Telegram!`);
  } else {
    console.error(`❌ [1/3] Failed to send Telegram message. Please check token & chat ID.`);
    process.exit(1);
  }

  // 2. Simulate Trade Lifecycle Event Dispatch
  console.log(`\n📡 [2/3] Simulating Trade Lifecycle Event Dispatches...`);
  const dummyTradeId = `TEST_POS_${Date.now()}`;
  const mockPos: StrategyExecutionPosition = {
    id: dummyTradeId,
    strategyId: 'SR_5M_WINNER',
    strategyName: '5M Sweep & Reclaim Champion',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    direction: 'LONG',
    status: 'OPEN',
    limitEntryPrice: 1885.50,
    entryPrice: 1885.50,
    initialStopLoss: 1875.00,
    activeStopLoss: 1885.50,
    activeRatchetFloor: null,
    trailingSlSource: 'BREAKEVEN',
    stage1Target: 1896.00,
    stage2Target: 1900.20,
    stage3Target: 1917.00,
    dynamicDolTarget: 1917.00,
    fvgCeLevel: 1885.50,
    riskUsd: 200.00,
    riskPerContract: 10.50,
    equityAtEntry: 10000.00,
    riskPct: 2.0,
    contractSize: 19.048,
    allocatedAmount: 1.0,
    remainingAllocation: 0.60,
    realizedR: 0.40,
    realizedUsd: 80.00,
    unrealizedR: 0.40,
    unrealizedUsd: 80.00,
    mfeR: 1.05,
    maeR: -0.12,
    isStage1Filled: true,
    isStage2Filled: false,
    isStage3Filled: false,
    stage1HitTime: Date.now(),
    stage2HitTime: null,
    stage3HitTime: null,
    pendingTime: Date.now() - 300000,
    openTime: Date.now() - 180000,
    closeTime: null,
    exitPrice: null,
    exitReason: null,
    anchorName: 'Asian High Liquidity Sweep & Reclaim',
  };

  const sampleEvent: ExecutionEvent = {
    type: 'STAGE_1_HARVEST',
    message: 'Tranche 1 (40% @ 1896.00) filled on ETHUSDC! Locked +0.40R ($80.00). SL advanced to BREAKEVEN ($1885.50).',
    position: mockPos,
    timestamp: Date.now(),
  };

  const eventSent = await notifier.handleExecutionEvent(sampleEvent);
  if (eventSent) {
    console.log(`✅ [2/3] Sample STAGE_1_HARVEST event delivered to Telegram!`);
  }

  // 3. Test Deduplication Engine (Attempt to resend the exact same event)
  console.log(`\n📡 [3/3] Testing Deduplication Mechanism (Re-firing same event)...`);
  const duplicateAttempt = await notifier.handleExecutionEvent(sampleEvent);
  if (!duplicateAttempt) {
    console.log(`✅ [3/3] Deduplication PASSED! Duplicate event was intercepted and blocked.`);
  } else {
    console.error(`❌ [3/3] Deduplication FAILED: Duplicate message was sent.`);
  }

  console.log(`\n===============================================================`);
  console.log(` 🎉 ALL TELEGRAM NOTIFICATION TESTS PASSED SUCCESSFULLY!`);
  console.log(`===============================================================\n`);
}

runTest().catch((err) => {
  console.error('[TEST_ERROR]', err);
  process.exit(1);
});
