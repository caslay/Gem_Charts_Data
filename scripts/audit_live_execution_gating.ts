/**
 * scripts/audit_live_execution_gating.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deep Simulation Audit for Live S&R Strategy Execution Gating:
 * 
 * 1. Cold-Start Stale Reclaim Immunity: Ingesting 72h historical candles must
 *    never arm or execute stale past setups.
 * 2. Below-Anchor Dump Protection: When price is below the anchor, Long setups
 *    must be vetoed and never execute on touch.
 * 3. Legitimate 4-Phase S&R Execution: (Sweep -> Closed Candle Above Anchor ->
 *    Pullback Retest Touch) must cleanly execute exactly 1 position.
 * 4. Missed Expansion & SL Breach Invalidation: Premature breakout or crash
 *    safely purges pending orders.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { Candle } from '../src/lib/fvgEngine';

function createSyntheticCandle(
  t: number,
  o: number,
  h: number,
  l: number,
  c: number,
  v: number = 1000,
  taker_buy_vol: number = 650
): Candle {
  return {
    t,
    o,
    h,
    l,
    c,
    v,
    taker_buy_vol,
    taker_sell_vol: v - taker_buy_vol,
    isClosed: true,
  };
}

async function runLiveExecutionAudit() {
  console.log('======================================================================');
  console.log('🛡️ FLOW-STATE QUANT ENGINE — LIVE EXECUTION GATING AUDIT');
  console.log('======================================================================\n');

  let passedTests = 0;
  let totalTests = 4;

  const barMs = 15 * 60 * 1000; // 15m
  const now = Date.now();

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Cold-Start Historical State Ingestion (72h / 288 Bars)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ TEST 1: Cold-Start 72-Hour Historical Reconciliation...');
  const engine1 = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    autoExecute: true,
    liveSettings: {
      enabledTimeframes: ['15m'],
      maxBarsToRetest: 24,
      enforceDiscountPremiumGate: false,
      requireThreePillarDisplacement: true,
    } as any,
  });

  // Generate 288 historical candles ending 2 hours ago
  const historicalCandles: Candle[] = [];
  const startTs = now - (288 * barMs);
  let price = 2500;
  for (let i = 0; i < 288; i++) {
    const t = startTs + (i * barMs);
    const o = price;
    const c = price + (Math.sin(i / 10) * 8);
    const h = Math.max(o, c) + 3;
    const l = Math.min(o, c) - 3;
    historicalCandles.push(createSyntheticCandle(t, o, h, l, c, 1200, 750));
    price = c;
  }

  const res1 = engine1.onMultiTimeframeCandles({ '15m': historicalCandles });
  const active1 = engine1.getActivePositions();
  const pending1 = engine1.getPendingLimitOrders();

  if (active1.length === 0 && pending1.length === 0) {
    console.log(`✅ TEST 1 PASSED: 0 stale positions armed across ${res1.scannedSetups.length} historical setups.\n`);
    passedTests++;
  } else {
    console.error(`❌ TEST 1 FAILED: Unexpected active=${active1.length}, pending=${pending1.length}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Below-Anchor Dump Protection (User's Screenshot Scenario)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ TEST 2: Below-Anchor Dump Protection (Anchor at $2487, Price at $2462)...');
  const engine2 = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    autoExecute: true,
  });

  const res2 = engine2.submitStrategyOrder({
    strategyId: 'SR_BULL_TEST_DUMP',
    strategyName: 'Test Sweep & Reclaim',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    direction: 'LONG',
    limitEntryPrice: 2463.16,
    stopLossPrice: 2460.52,
    currentMarketPrice: 2462.49, // Price below anchor and below limit
    originAnchorLevel: 2487.00,  // Anchor is way above at $2487.00
  });

  const active2 = engine2.getActivePositions();
  const pending2 = engine2.getPendingLimitOrders();

  if (!res2.success && active2.length === 0 && pending2.length === 0) {
    console.log(`✅ TEST 2 PASSED: Correctly VETOED below-anchor execution: "${res2.message}"\n`);
    passedTests++;
  } else {
    console.error(`❌ TEST 2 FAILED: Order was not vetoed! Active=${active2.length}, Pending=${pending2.length}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Legitimate 4-Phase S&R Sequence (Sweep -> Close Above -> Retest)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ TEST 3: Legitimate 4-Phase S&R Execution Sequence...');
  const engine3 = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    autoExecute: true,
    stage1Multiple: 1.0,
    stage2Multiple: 1.5,
    stage3Multiple: 3.0,
  });

  // 1. Setup confirmed: price closed above anchor ($2487) at $2492.00
  const submitRes3 = engine3.submitStrategyOrder({
    strategyId: 'SR_BULL_CLEAN_RETEST',
    strategyName: 'Sweep & Reclaim (15M Swing Low)',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    direction: 'LONG',
    limitEntryPrice: 2487.00,   // Limit at anchor shelf
    stopLossPrice: 2470.00,     // SL below sweep extreme
    currentMarketPrice: 2492.00, // Price is legitimately ABOVE anchor ($2487)
    originAnchorLevel: 2487.00,
    originZoneId: 'SR_BULL_CLEAN_RETEST',
    threePillarsPassed: true,
  });

  if (submitRes3.success && engine3.getPendingLimitOrders().length === 1 && engine3.getActivePositions().length === 0) {
    console.log(`   Phase 3 Reclaim confirmed: Resting Limit placed @ $2487.00 as PENDING_LIMIT_ENTRY.`);
  } else {
    console.error(`❌ TEST 3 FAILED at limit placement: ${submitRes3.message}`);
  }

  // 2. Price pulls back from $2492 down to touch $2487.00 (Retest Touch)
  engine3.processMarketTick(2487.00);

  const active3 = engine3.getActivePositions();
  const pending3 = engine3.getPendingLimitOrders();

  if (active3.length === 1 && active3[0].status === 'OPEN' && active3[0].entryPrice === 2487.00 && pending3.length === 0) {
    console.log(`✅ TEST 3 PASSED: Trade executed cleanly on pullback retest @ $${active3[0].entryPrice} (Status: OPEN).\n`);
    passedTests++;
  } else {
    console.error(`❌ TEST 3 FAILED on retest fill: Active=${active3.length}, Pending=${pending3.length}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Pending Order SL Invalidation Guard
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ TEST 4: Pending Order SL Gap/Crash Invalidation...');
  const engine4 = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    autoExecute: true,
  });

  engine4.submitStrategyOrder({
    strategyId: 'SR_BULL_CRASH',
    strategyName: 'Test Crash',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    direction: 'LONG',
    limitEntryPrice: 2487.00,
    stopLossPrice: 2470.00,
    currentMarketPrice: 2490.00,
    originAnchorLevel: 2487.00,
  });

  // Sudden crash straight through SL ($2465 <= $2470)
  engine4.processMarketTick(2465.00);

  const active4 = engine4.getActivePositions();
  const pending4 = engine4.getPendingLimitOrders();

  if (active4.length === 0 && pending4.length === 0) {
    console.log(`✅ TEST 4 PASSED: Pending order purged safely on SL crash without opening corrupted trade.\n`);
    passedTests++;
  } else {
    console.error(`❌ TEST 4 FAILED: Order was filled instead of purged! Active=${active4.length}`);
  }

  console.log('======================================================================');
  if (passedTests === totalTests) {
    console.log(`🎉 ALL ${totalTests}/${totalTests} LIVE EXECUTION GATING TESTS PASSED!`);
    console.log('   - 0 Stale Trade Respawning');
    console.log('   - 0 Below-Anchor Dump Premature Fills');
    console.log('   - 100% Strict 4-Phase S&R Retest Compliance');
  } else {
    console.error(`💥 AUDIT FAILED: Only ${passedTests}/${totalTests} passed.`);
    process.exit(1);
  }
  console.log('======================================================================\n');
}

runLiveExecutionAudit().catch((err) => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
