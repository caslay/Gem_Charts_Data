/**
 * scripts/test_telegram_resilience_and_html.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive Test Suite for Telegram HTML Standardization & Keyboard Resilience
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  escapeHtml,
  validateTelegramHtml,
  buildStandbyActionKeyboard,
  formatQuantIntentSignalMarkdown,
  formatOrderArmedMarkdown,
  formatOrderFilledMarkdown,
  formatTp1RatchetMarkdown,
  formatTradeClosedMarkdown,
  formatArmedIntentRegisteredMarkdown,
  formatArmedIntentTriggeredMarkdown,
  formatArmedIntentExpiredMarkdown,
  formatArmedIntentInvalidatedMarkdown,
} from '../src/lib/notifications/telegramNotifier';
import { formatDeadZoneObservationHeartbeat } from '../src/lib/temporalGatekeeper';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

async function runTests() {
  console.log('🧪 [TEST] Starting Telegram HTML & Resilience Test Suite...\n');

  // ── Test 1: escapeHtml Handles All Dangerous Characters ──
  {
    const raw = 'Limit $2500 < Market $2550 & "Spread" > 0.05%';
    const escaped = escapeHtml(raw);
    assert(escaped === 'Limit $2500 &lt; Market $2550 &amp; &quot;Spread&quot; &gt; 0.05%', `escapeHtml mismatch: ${escaped}`);
    console.log('✅ Test 1 Passed: escapeHtml correctly sanitizes <, >, &, and "');
  }

  // ── Test 2: Standard and Error Action Keyboards ──
  {
    const standardKb = buildStandbyActionKeyboard(42);
    assert(standardKb.inline_keyboard.length === 2, 'Standard keyboard should have 2 rows');
    assert(standardKb.inline_keyboard[0][0].callback_data === 'paper_trade_42', 'Row 1 Col 1 callback mismatch');
    assert(standardKb.inline_keyboard[0][1].callback_data === 'live_exec_init_42', 'Row 1 Col 2 callback mismatch');
    assert(standardKb.inline_keyboard[1][0].callback_data === 'dismiss_42', 'Row 2 Col 1 callback mismatch');

    const errorKb = buildStandbyActionKeyboard(42, { hasError: true, errorReason: 'RESTING_SIDE_VETO' });
    assert(errorKb.inline_keyboard.length === 2, 'Error keyboard should have 2 rows');
    assert(errorKb.inline_keyboard[0][0].text === '🔄 Retry Paper Trade', 'Row 1 Col 1 should be retry paper');
    assert(errorKb.inline_keyboard[0][0].callback_data === 'retry_paper_42', 'Row 1 Col 1 callback should be retry_paper_42');
    assert(errorKb.inline_keyboard[0][1].text === '⚡ Execute Live', 'Row 1 Col 2 should be retry live');
    assert(errorKb.inline_keyboard[0][1].callback_data === 'retry_live_42', 'Row 1 Col 2 callback should be retry_live_42');
    assert(errorKb.inline_keyboard[1][0].callback_data === 'dismiss_42', 'Dismiss callback preserved');
    console.log('✅ Test 2 Passed: Resilient action keyboards generate valid retry buttons on error');
  }

  // ── Test 3: formatQuantIntentSignalMarkdown Produces Valid HTML with Sanitized Content ──
  {
    const html = formatQuantIntentSignalMarkdown({
      symbol: 'ETHUSDC <test & demo>',
      direction: 'LONG',
      limitEntryPrice: 2500,
      invalidationLevel: 2480,
      target1: 2520,
      target2: 2540,
      narrative: 'Testing unescaped <script>alert("xss")</script> & raw ampersand',
    });

    assert(!html.includes('<script>'), 'Unescaped script tag leaked into output');
    assert(html.includes('&lt;script&gt;'), 'Script tag was not escaped');
    const val = validateTelegramHtml(html);
    assert(val.isValid, `HTML Validation Error: ${val.error}`);
    console.log('✅ Test 3 Passed: formatQuantIntentSignalMarkdown produces valid, sanitized HTML');
  }

  // ── Test 4: formatOrderArmedMarkdown Produces Valid HTML ──
  {
    const html = formatOrderArmedMarkdown({
      mode: 'PAPER_TRADING',
      symbol: 'ETHUSDC',
      direction: 'LONG',
      limitEntryPrice: 2500,
      stopLossPrice: 2480,
      contractSize: 10,
      target1: 2520,
      target2: 2540,
    });

    const val = validateTelegramHtml(html);
    assert(val.isValid, `HTML Validation Error: ${val.error}`);
    console.log('✅ Test 4 Passed: formatOrderArmedMarkdown produces valid HTML');
  }

  // ── Test 5: formatOrderFilledMarkdown Produces Valid HTML ──
  {
    const html = formatOrderFilledMarkdown({
      mode: 'PAPER_TRADING',
      symbol: 'ETHUSDC',
      direction: 'LONG',
      executionPrice: 2500,
      contractSize: 10,
      activeStopLoss: 2480,
      stage1Target: 2520,
      stage2Target: 2540,
    });

    const val = validateTelegramHtml(html);
    assert(val.isValid, `HTML Validation Error: ${val.error}`);
    console.log('✅ Test 5 Passed: formatOrderFilledMarkdown produces valid HTML');
  }

  // ── Test 6: formatTp1RatchetMarkdown Produces Valid HTML ──
  {
    const html = formatTp1RatchetMarkdown({
      mode: 'PAPER_TRADING',
      symbol: 'ETHUSDC',
      direction: 'LONG',
      stage1Target: 2520,
      stage1Ratio: 0.30,
      bankedR: 0.30,
      bankedUsd: 150,
      newStopLoss: 2500,
      stage2Target: 2540,
    });

    const val = validateTelegramHtml(html);
    assert(val.isValid, `HTML Validation Error: ${val.error}`);
    console.log('✅ Test 6 Passed: formatTp1RatchetMarkdown produces valid HTML');
  }

  // ── Test 7: formatTradeClosedMarkdown Produces Valid HTML with Special Characters ──
  {
    const html = formatTradeClosedMarkdown({
      mode: 'PAPER_TRADING',
      symbol: 'ETHUSDC',
      direction: 'LONG',
      exitPrice: 2540,
      exitReason: 'FULL_TP2_WIN <Automatic Harvest>',
      netRealizedR: 1.70,
      netRealizedUsd: 850,
      feeUsd: 2.50,
    });

    assert(!html.includes('<Automatic Harvest>'), 'Exit reason unescaped');
    const val = validateTelegramHtml(html);
    assert(val.isValid, `HTML Validation Error: ${val.error}`);
    console.log('✅ Test 7 Passed: formatTradeClosedMarkdown produces valid, sanitized HTML');
  }

  // ── Test 8: Armed Intent Formatters Produce Valid HTML ──
  {
    const regHtml = formatArmedIntentRegisteredMarkdown({
      id: 'reg_1',
      symbol: 'ETHUSDC',
      direction: 'LONG',
      triggerCondition: '15m BOS > $2510',
      triggerPrice: 2510,
      triggerTimeframe: '15m',
      poiZoneLow: 2495,
      poiZoneHigh: 2505,
      invalidationLevel: 2480,
      target1: 2520,
      target2: 2540,
      narrative: 'BOS setup with <special> characters & symbols',
    });
    assert(validateTelegramHtml(regHtml).isValid, 'ArmedIntentRegistered invalid HTML');

    const trigHtml = formatArmedIntentTriggeredMarkdown({
      id: 'trig_1',
      symbol: 'ETHUSDC',
      direction: 'LONG',
      triggerCondition: 'BOS Confirmed',
      triggerPrice: 2510,
      triggerTimeframe: '15m',
      limitEntryPrice: 2500,
      stopLossPrice: 2480,
    });
    assert(validateTelegramHtml(trigHtml).isValid, 'ArmedIntentTriggered invalid HTML');

    const expHtml = formatArmedIntentExpiredMarkdown({
      id: 'exp_1',
      symbol: 'ETHUSDC',
      direction: 'LONG',
      triggerCondition: 'BOS',
      triggerPrice: 2510,
      triggerTimeframe: '15m',
      ttlBars: 12,
    });
    assert(validateTelegramHtml(expHtml).isValid, 'ArmedIntentExpired invalid HTML');

    const invHtml = formatArmedIntentInvalidatedMarkdown({
      id: 'inv_1',
      symbol: 'ETHUSDC',
      direction: 'LONG',
      reason: 'Low volatility & chop < 0.2% ATR',
    });
    assert(validateTelegramHtml(invHtml).isValid, 'ArmedIntentInvalidated invalid HTML');

    console.log('✅ Test 8 Passed: All Armed Intent formatters produce valid, sanitized HTML');
  }

  // ── Test 9: formatDeadZoneObservationHeartbeat Produces Valid HTML ──
  {
    const dzHtml = formatDeadZoneObservationHeartbeat(
      'DEADZONE: Daily Close & Funding Settlement <23:45 - 00:15 UTC>',
      Date.now()
    );
    assert(validateTelegramHtml(dzHtml).isValid, 'Dead zone heartbeat invalid HTML');
    assert(dzHtml.includes('&lt;23:45 - 00:15 UTC&gt;'), 'Dead zone reason was not escaped');
    console.log('✅ Test 9 Passed: formatDeadZoneObservationHeartbeat produces valid, sanitized HTML');
  }

  console.log('\n🎉 ALL 9 TELEGRAM RESILIENCE & HTML TESTS PASSED WITH 100% SUCCESS!\n');
}

runTests().catch((err) => {
  console.error('❌ Test Suite Failed:', err);
  process.exit(1);
});
