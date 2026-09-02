/**
 * scripts/test_ttl_and_parity.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit & Integration Test for Pending Limit Order TTL Expiry & Directional Unblock
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  AutomatedStrategyExecutionEngine,
  ExecutionEvent,
} from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { TelegramNotifier } from '../src/lib/notifications/telegramNotifier';

async function run() {
  console.log('======================================================================');
  console.log('🧪 TESTING RESTING LIMIT ORDER TTL EXPIRATION & QUEUE UNBLOCK');
  console.log('======================================================================\n');

  const engine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    autoExecute: true,
    compoundingRiskPct: 2.0,
    maxOpenPositions: 1,
    liveSettings: {
      maxBarsToRetest: 20, // 20 bars = 100 minutes TTL on 5m
      enabledTimeframes: ['5m'],
    } as any,
  });

  const events: ExecutionEvent[] = [];
  engine.subscribe((e) => events.push(e));

  // Test 1: Submit a SHORT Limit Order at $2424.00
  console.log('▶ [TEST 1] Submitting SHORT limit order @ $2424.00...');
  const res1 = engine.submitStrategyOrder({
    strategyId: 'test_short_setup_1',
    strategyName: 'Sweep & Reclaim (5m Asian High)',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    direction: 'SHORT',
    limitEntryPrice: 2424.00,
    stopLossPrice: 2427.70,
    currentMarketPrice: 2422.50,
    anchorName: 'ASIAN_HIGH ($2424.00)',
    originAnchorLevel: 2424.00,
    originZoneId: 'zone_asian_high_2424',
  });

  if (!res1.success) {
    throw new Error(`❌ Failed to submit initial short limit order: ${res1.message}`);
  }
  console.log('   ✅ SHORT limit order submitted successfully.');
  console.log(`   • Pending Orders Count: ${engine.getPendingLimitOrders().length}`);

  // Test 2: Verify Guardrail 3 (Directional Conflict) VETOES opposing LONG setup while SHORT is pending
  console.log('\n▶ [TEST 2] Verifying Guardrail 3 vetoes opposing LONG setup while SHORT is pending...');
  const res2 = engine.submitStrategyOrder({
    strategyId: 'test_long_setup_opposing',
    strategyName: 'Sweep & Reclaim (5m Swing Low)',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    direction: 'LONG',
    limitEntryPrice: 2390.00,
    stopLossPrice: 2380.00,
    currentMarketPrice: 2400.00,
    anchorName: 'SWING_LOW ($2390.00)',
    originAnchorLevel: 2390.00,
    originZoneId: 'zone_swing_low_2390',
  });

  if (res2.success) {
    throw new Error('❌ Guardrail 3 FAILED: opposing LONG was accepted while SHORT was pending!');
  }
  console.log(`   ✅ Correctly Vetoed Opposing Setup: "${res2.message}"`);

  // Test 3: Advance time beyond 100-minute TTL (e.g. 105 minutes) and tick market price
  console.log('\n▶ [TEST 3] Simulating 105 minutes elapsed without fill (TTL Expiry)...');
  const pending = engine.getPendingLimitOrders()[0];
  // Artificially age the pending order by 105 minutes
  pending.pendingTime = Date.now() - (105 * 60 * 1000);

  // Send a tick at $2422.00 (within range between entry 2424 and TP1 2420.30, neither SL nor TP1 reached)
  engine.processMarketTick(2422.00);

  const pendingAfterTick = engine.getPendingLimitOrders();
  console.log(`   • Pending Orders After 105m Tick: ${pendingAfterTick.length}`);

  if (pendingAfterTick.length !== 0) {
    throw new Error(`❌ TTL Expiry FAILED: order is still pending after 105m!`);
  }

  const cancelEvent = events.find((e) => e.type === 'LIMIT_ORDER_CANCELLED');
  if (!cancelEvent) {
    throw new Error('❌ LIMIT_ORDER_CANCELLED event was not emitted on TTL expiry!');
  }
  console.log(`   ✅ Order Expired Cleanly: "${cancelEvent.message}"`);

  // Test 4: Verify that after TTL expiry, Guardrail 3 is unblocked and new LONG can be submitted!
  console.log('\n▶ [TEST 4] Verifying Queue Unblocked: New LONG setup now succeeds...');
  const res3 = engine.submitStrategyOrder({
    strategyId: 'test_long_setup_unblocked',
    strategyName: 'Sweep & Reclaim (5m Swing Low)',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    direction: 'LONG',
    limitEntryPrice: 2390.00,
    stopLossPrice: 2380.00,
    currentMarketPrice: 2395.00,
    anchorName: 'SWING_LOW ($2390.00)',
    originAnchorLevel: 2390.00,
    originZoneId: 'zone_swing_low_2390',
  });

  if (!res3.success) {
    throw new Error(`❌ Failed to submit LONG setup after TTL unblock: ${res3.message}`);
  }
  console.log('   ✅ LONG setup successfully accepted and placed in pending queue!');
  console.log(`   • Active Pending Orders: ${engine.getPendingLimitOrders().length}`);

  // Test 5: Verify Telegram Formatter for LIMIT_ORDER_CANCELLED
  console.log('\n▶ [TEST 5] Verifying Telegram message formatting for LIMIT_ORDER_CANCELLED...');
  const telegram = new TelegramNotifier();
  const formatted = telegram.formatMessage(cancelEvent);
  if (!formatted || !formatted.includes('PENDING LIMIT ORDER EXPIRED')) {
    throw new Error(`❌ Telegram formatter failed for LIMIT_ORDER_CANCELLED: ${formatted}`);
  }
  console.log('   ✅ Telegram Notification Formatted Correctly:');
  console.log('   ' + formatted.split('\n').join('\n   '));

  console.log('\n======================================================================');
  console.log(' 🎉 ALL TTL & PARITY TESTS PASSED WITH 100% SUCCESS');
  console.log('======================================================================\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
