/**
 * scripts/test_telegram_callbacks.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit & Integration Test for Telegram Bot Interactive Inline Callbacks
 * ─────────────────────────────────────────────────────────────────────────────
 */

import assert from 'assert';
import { TelegramNotifier, buildStandbyActionKeyboard } from '../src/lib/notifications/telegramNotifier';
import { TelegramBotService } from '../src/lib/notifications/telegramBotService';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { DaemonLedger } from './lib/daemonLedger';

async function runCallbackTests() {
  console.log(`======================================================================`);
  console.log(`🧪 TESTING TELEGRAM INTERACTIVE INLINE CALLBACKS (WORKSTREAM B)`);
  console.log(`======================================================================\n`);

  let dispatchedMessages: { text: string; options?: any }[] = [];
  let editedMessages: { text: string; options?: any }[] = [];

  const mockNotifier = new TelegramNotifier({
    enabled: true,
    botToken: 'TEST_BOT_TOKEN',
    chatId: '12345678',
  });

  mockNotifier.sendRawMessage = async (msg: string, options?: any) => {
    dispatchedMessages.push({ text: msg, options });
    return true;
  };

  mockNotifier.editMessageText = async (_chatId: string | number, _msgId: number, text: string, options?: any) => {
    editedMessages.push({ text, options });
    return true;
  };

  mockNotifier.answerCallbackQuery = async (_id: string, text?: string) => {
    return true;
  };

  const engine = new AutomatedStrategyExecutionEngine({ symbol: 'ETHUSDC' });
  const ledger = new DaemonLedger('ETHUSDC', 10000);

  // Mock SparkDispatcher
  let promotedDecisions: { id: number; mode: string }[] = [];
  let dismissedDecisions: number[] = [];

  const mockSparkDispatcher = {
    promoteStandbyToMode: async (id: number, mode: string) => {
      promotedDecisions.push({ id, mode });
      return { success: true, message: `Promoted ${id} to ${mode}` };
    },
    dismissDecision: async (id: number) => {
      dismissedDecisions.push(id);
      return { success: true, message: `Dismissed ${id}` };
    },
  };

  const botService = new TelegramBotService(
    {
      engine,
      ledger,
      sparkDispatcher: mockSparkDispatcher,
      symbol: 'ETHUSDC',
      equity: 10000,
      isDryRun: false,
      bootTimestamp: Date.now(),
      wsClient: {
        getLatestPrice: () => 2450.0,
        getStatus: () => 'OPEN',
      } as any,
    },
    mockNotifier
  );

  // Test 1: Keyboard layout
  console.log(`▶ [TEST 1] Verifying buildStandbyActionKeyboard structure...`);
  const keyboard = buildStandbyActionKeyboard(42);
  assert(keyboard.inline_keyboard.length === 2, 'Keyboard has 2 rows');
  assert(keyboard.inline_keyboard[0][0].text === '📝 Paper Trade', 'Row 1 Col 1 is Paper Trade');
  assert(keyboard.inline_keyboard[0][0].callback_data === 'paper_trade_42', 'Row 1 Col 1 callback data matches');
  assert(keyboard.inline_keyboard[0][1].text === '⚡ Execute Live', 'Row 1 Col 2 is Execute Live');
  assert(keyboard.inline_keyboard[0][1].callback_data === 'live_exec_init_42', 'Row 1 Col 2 callback data matches');
  assert(keyboard.inline_keyboard[1][0].text === '❌ Dismiss', 'Row 2 Col 1 is Dismiss');
  assert(keyboard.inline_keyboard[1][0].callback_data === 'dismiss_42', 'Row 2 Col 1 callback data matches');
  console.log(` ✅ PASS: buildStandbyActionKeyboard returns compliant institutional keyboard layout.\n`);

  // Test 2: paper_trade callback
  console.log(`▶ [TEST 2] Verifying 'paper_trade_42' callback query...`);
  await (botService as any).processIncomingCallbackQuery({
    id: 'cb_1',
    from: { id: 12345678, first_name: 'Trader' },
    message: { message_id: 101, chat: { id: 12345678 } },
    data: 'paper_trade_42',
  });
  assert(promotedDecisions.some((d) => d.id === 42 && d.mode === 'PAPER_TRADING'), 'Decision 42 was promoted to PAPER_TRADING');
  assert(editedMessages.some((m) => m.text.includes('PROMOTED TO PAPER TRADING')), 'Telegram message was edited to show promotion');
  console.log(` ✅ PASS: paper_trade_42 successfully promoted setup in memory and edited Telegram message.\n`);

  // Test 3: live_exec_init callback (Step 1 of 2-step confirmation)
  console.log(`▶ [TEST 3] Verifying 'live_exec_init_42' 2-step confirmation prompt...`);
  await (botService as any).processIncomingCallbackQuery({
    id: 'cb_2',
    from: { id: 12345678, first_name: 'Trader' },
    message: { message_id: 102, chat: { id: 12345678 } },
    data: 'live_exec_init_42',
  });
  const promptEdit = editedMessages[editedMessages.length - 1];
  assert(promptEdit.text.includes('CONFIRM LIVE EXECUTION'), 'Confirmation prompt rendered');
  assert(promptEdit.options?.replyMarkup?.inline_keyboard[0][0].text.includes('YES'), 'Has YES button');
  assert(promptEdit.options?.replyMarkup?.inline_keyboard[0][1].text.includes('NO'), 'Has NO button');
  console.log(` ✅ PASS: live_exec_init_42 rendered institutional 2-step confirmation prompt.\n`);

  // Test 4: live_exec_cancel callback
  console.log(`▶ [TEST 4] Verifying 'live_exec_cancel_42' disarm and return...`);
  await (botService as any).processIncomingCallbackQuery({
    id: 'cb_3',
    from: { id: 12345678, first_name: 'Trader' },
    message: { message_id: 102, chat: { id: 12345678 } },
    data: 'live_exec_cancel_42',
  });
  const cancelEdit = editedMessages[editedMessages.length - 1];
  assert(cancelEdit.text.includes('LIVE EXECUTION DISARMED'), 'Message shows disarmed notification');
  assert(cancelEdit.options?.replyMarkup?.inline_keyboard[0][0].text === '📝 Paper Trade', 'Standby keyboard restored');
  console.log(` ✅ PASS: live_exec_cancel_42 successfully cancelled live prompt and restored standby keyboard.\n`);

  // Test 5: live_exec_confirm callback (Safety Gate Veto verification)
  console.log(`▶ [TEST 5] Verifying 'live_exec_confirm_42' safety gate veto in local environment...`);
  await (botService as any).processIncomingCallbackQuery({
    id: 'cb_4',
    from: { id: 12345678, first_name: 'Trader' },
    message: { message_id: 102, chat: { id: 12345678 } },
    data: 'live_exec_confirm_42',
  });
  const liveGateEdit = editedMessages[editedMessages.length - 1];
  assert(liveGateEdit.text.includes('LIVE EXECUTION BLOCKED — SAFETY GATE'), 'Live execution safely blocked by gate');
  assert(liveGateEdit.text.includes('Zero exchange exposure'), 'Affirms zero exchange exposure');
  console.log(` ✅ PASS: live_exec_confirm_42 evaluated safety gate and rejected execution safely outside verified VPS.\n`);

  // Test 6: dismiss callback
  console.log(`▶ [TEST 6] Verifying 'dismiss_42' callback...`);
  await (botService as any).processIncomingCallbackQuery({
    id: 'cb_5',
    from: { id: 12345678, first_name: 'Trader' },
    message: { message_id: 103, chat: { id: 12345678 } },
    data: 'dismiss_42',
  });
  assert(dismissedDecisions.includes(42), 'Decision 42 was dismissed');
  const dismissEdit = editedMessages[editedMessages.length - 1];
  assert(dismissEdit.text.includes('SETUP DISMISSED'), 'Message shows dismissed');
  console.log(` ✅ PASS: dismiss_42 dismissed decision and purged from proximity radar.\n`);

  // Test 7: Fallback Command File Dispatch (without in-memory dispatcher)
  console.log(`▶ [TEST 7] Verifying file-based command router dispatch (daemon_commands.json)...`);
  const botServiceFileMode = new TelegramBotService(
    {
      engine,
      ledger,
      symbol: 'ETHUSDC',
      equity: 10000,
      isDryRun: false,
      bootTimestamp: Date.now(),
      wsClient: {
        getLatestPrice: () => 2450.0,
        getStatus: () => 'OPEN',
      } as any,
    },
    mockNotifier
  );

  await (botServiceFileMode as any).processIncomingCallbackQuery({
    id: 'cb_6',
    from: { id: 12345678, first_name: 'Trader' },
    message: { message_id: 104, chat: { id: 12345678 } },
    data: 'paper_trade_999',
  });

  const fs = await import('fs');
  const path = await import('path');
  const cmdFilePath = path.join(process.cwd(), 'run_logs', 'daemon_commands.json');
  assert(fs.existsSync(cmdFilePath), 'daemon_commands.json was created/updated');
  const queuedCommands = JSON.parse(fs.readFileSync(cmdFilePath, 'utf8'));
  const targetCmd = queuedCommands.find((c: any) => c.decisionId === 999 && c.action === 'PROMOTE_STANDBY');
  assert(targetCmd !== undefined, 'Target command was written to daemon_commands.json');
  assert(targetCmd.targetMode === 'PAPER_TRADING', 'Command specifies targetMode = PAPER_TRADING');
  assert(targetCmd.metadata?.decisionId === 999, 'Command contains metadata.decisionId');
  assert(targetCmd.metadata?.targetMode === 'PAPER_TRADING', 'Command contains metadata.targetMode');
  console.log(` ✅ PASS: File-based command queue written with dual top-level and metadata contract.\n`);

  console.log(`======================================================================`);
  console.log(`🎉 ALL WORKSTREAM B INTERACTIVE CALLBACK TESTS PASSED!`);
  console.log(`======================================================================`);
}

runCallbackTests().catch((err) => {
  console.error('[CALLBACK_TEST_FATAL]', err);
  process.exit(1);
});
