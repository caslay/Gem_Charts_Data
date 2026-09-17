/**
 * scripts/test_synthetic_tape_reconciliation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive Test Suite for Synthetic Tape Outcome Reconciliation Engine
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  simulateSyntheticTapeOutcome,
  reconcileSetupOutcomes,
  calculateDailyAuditMetrics,
  ReconciliationCandle,
} from '../src/lib/quantEngine/SetupOutcomeReconciler';
import type { AiAnalysisRecord } from '../src/lib/aiCascadeEngine';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

function makeCandle(offsetMins: number, open: number, high: number, low: number, close: number): ReconciliationCandle {
  const openTime = 1700000000000 + offsetMins * 60 * 1000;
  return {
    openTime,
    open,
    high,
    low,
    close,
    closeTime: openTime + 5 * 60 * 1000 - 1,
  };
}

async function runTests() {
  console.log('🧪 [TEST] Starting Synthetic Tape Outcome Reconciliation Test Suite...\n');

  const baseTime = 1700000000000;
  const barMinutes = 5;
  const ttlBars = 12;

  // ── Test 1: Full TP2 Win (Long) ──
  {
    const candles: ReconciliationCandle[] = [
      makeCandle(0, 2505, 2510, 2502, 2504), // Bar 0: Not filled
      makeCandle(5, 2504, 2506, 2498, 2501), // Bar 1: Touches entry (2500) -> FILLED
      makeCandle(10, 2501, 2525, 2500, 2522), // Bar 2: Touches TP1 (2520) -> Banked 30%
      makeCandle(15, 2522, 2545, 2518, 2542), // Bar 3: Touches TP2 (2540) -> Full Exit
    ];

    const res = simulateSyntheticTapeOutcome({
      symbol: 'ETHUSDC',
      isLong: true,
      entryPrice: 2500,
      invalidation: 2480, // risk = 20
      target1: 2520,      // TP1 = 1.0R
      target2: 2540,      // TP2 = 2.0R
      ttlBars,
      barMinutes,
      recTime: baseTime,
      candles,
      now: baseTime + 60 * 60 * 1000,
    });

    assert(res !== null, 'Test 1 returned null');
    assert(res?.terminal_state === 'TP2_HIT', `Test 1 expected TP2_HIT, got ${res?.terminal_state}`);
    assert(res?.realized_r === 1.7, `Test 1 expected 1.7R, got ${res?.realized_r}`);
    assert(res?.is_synthetic_evaluation === true, 'Test 1 should be synthetic');
    console.log('✅ Test 1 Passed: Full 2-Stage TP2 Win (1.70R)');
  }

  // ── Test 2: Stopped Out at Invalidation (Long) ──
  {
    const candles: ReconciliationCandle[] = [
      makeCandle(0, 2502, 2505, 2499, 2500), // Bar 0: Filled at 2500
      makeCandle(5, 2500, 2504, 2478, 2482), // Bar 1: Touches SL (2480) -> Stopped out
    ];

    const res = simulateSyntheticTapeOutcome({
      symbol: 'ETHUSDC',
      isLong: true,
      entryPrice: 2500,
      invalidation: 2480,
      target1: 2520,
      target2: 2540,
      ttlBars,
      barMinutes,
      recTime: baseTime,
      candles,
      now: baseTime + 60 * 60 * 1000,
    });

    assert(res?.terminal_state === 'STOPPED_OUT', `Test 2 expected STOPPED_OUT, got ${res?.terminal_state}`);
    assert(res?.realized_r === -1.0, `Test 2 expected -1.0R, got ${res?.realized_r}`);
    console.log('✅ Test 2 Passed: Stopped Out at Invalidation (-1.00R)');
  }

  // ── Test 3: TP1 Banked + Breakeven Scratch (Long) ──
  {
    const candles: ReconciliationCandle[] = [
      makeCandle(0, 2502, 2505, 2498, 2501), // Bar 0: Filled at 2500
      makeCandle(5, 2501, 2522, 2501, 2520), // Bar 1: Touches TP1 (2520) -> Banked +0.30R, ratchet SL to 2500 on bar 2
      makeCandle(10, 2518, 2519, 2499, 2502), // Bar 2: Retraces to 2499 (touches BE SL 2500) -> Scratches
    ];

    const res = simulateSyntheticTapeOutcome({
      symbol: 'ETHUSDC',
      isLong: true,
      entryPrice: 2500,
      invalidation: 2480,
      target1: 2520,
      target2: 2540,
      ttlBars,
      barMinutes,
      recTime: baseTime,
      candles,
      now: baseTime + 60 * 60 * 1000,
    });

    assert(res?.terminal_state === 'BREAKEVEN', `Test 3 expected BREAKEVEN, got ${res?.terminal_state}`);
    assert(res?.realized_r === 0.30, `Test 3 expected 0.30R, got ${res?.realized_r}`);
    console.log('✅ Test 3 Passed: TP1 Banked + Breakeven Scratch (+0.30R)');
  }

  // ── Test 4: Early Breakeven Ratchet (+0.40R Rule) ──
  {
    const candles: ReconciliationCandle[] = [
      makeCandle(0, 2502, 2505, 2498, 2501), // Bar 0: Filled at 2500
      makeCandle(5, 2501, 2510, 2500, 2509), // Bar 1: Reaches 2510 (MFE = +10 / 20 = +0.50R >= +0.40R) -> Pending BE SL
      makeCandle(10, 2508, 2508, 2498, 2500), // Bar 2: Retraces to 2498 -> Scratches at Breakeven
    ];

    const res = simulateSyntheticTapeOutcome({
      symbol: 'ETHUSDC',
      isLong: true,
      entryPrice: 2500,
      invalidation: 2480,
      target1: 2530,
      target2: 2550,
      ttlBars,
      barMinutes,
      recTime: baseTime,
      candles,
      now: baseTime + 60 * 60 * 1000,
    });

    assert(res?.terminal_state === 'BREAKEVEN', `Test 4 expected BREAKEVEN, got ${res?.terminal_state}`);
    assert(res?.realized_r === 0.0, `Test 4 expected 0.00R, got ${res?.realized_r}`);
    console.log('✅ Test 4 Passed: Early Breakeven Ratchet Protected Scratch (0.00R loss)');
  }

  // ── Test 5: Missed Expansion Pre-Fill Cancellation ──
  {
    const candles: ReconciliationCandle[] = [
      makeCandle(0, 2504, 2525, 2503, 2522), // Bar 0: Expands to 2525 (TP1 2520) without touching entry 2500!
    ];

    const res = simulateSyntheticTapeOutcome({
      symbol: 'ETHUSDC',
      isLong: true,
      entryPrice: 2500,
      invalidation: 2480,
      target1: 2520,
      target2: 2540,
      ttlBars,
      barMinutes,
      recTime: baseTime,
      candles,
      now: baseTime + 60 * 60 * 1000,
    });

    assert(res?.terminal_state === 'CANCELLED_PRE_FILL', `Test 5 expected CANCELLED_PRE_FILL, got ${res?.terminal_state}`);
    assert(res?.outcome_reason.includes('Missed Expansion'), 'Test 5 should note Missed Expansion');
    console.log('✅ Test 5 Passed: Missed Expansion Pre-Fill Cancellation');
  }

  // ── Test 6: Invalidation Breached Pre-Fill Cancellation ──
  {
    const candles: ReconciliationCandle[] = [
      makeCandle(0, 2505, 2506, 2475, 2478), // Drops straight through SL (2480)
    ];

    const res = simulateSyntheticTapeOutcome({
      symbol: 'ETHUSDC',
      isLong: true,
      entryPrice: 2500,
      invalidation: 2480,
      target1: 2520,
      target2: 2540,
      ttlBars,
      barMinutes,
      recTime: baseTime,
      candles,
      now: baseTime + 60 * 60 * 1000,
    });

    assert(res?.terminal_state === 'CANCELLED_PRE_FILL', `Test 6 expected CANCELLED_PRE_FILL, got ${res?.terminal_state}`);
    console.log('✅ Test 6 Passed: Invalidation Breached Pre-Fill Cancellation');
  }

  // ── Test 7: 12-Bar TTL Expiration ──
  {
    const candles: ReconciliationCandle[] = [];
    for (let i = 0; i < 15; i++) {
      candles.push(makeCandle(i * 5, 2504, 2508, 2502, 2505)); // Stays between 2502 and 2508, never fills 2500
    }

    const res = simulateSyntheticTapeOutcome({
      symbol: 'ETHUSDC',
      isLong: true,
      entryPrice: 2500,
      invalidation: 2480,
      target1: 2520,
      target2: 2540,
      ttlBars: 12,
      barMinutes,
      recTime: baseTime,
      candles,
      now: baseTime + 100 * 60 * 1000,
    });

    assert(res?.terminal_state === 'TTL_EXPIRED', `Test 7 expected TTL_EXPIRED, got ${res?.terminal_state}`);
    assert(res?.bars_elapsed === 12, `Test 7 expected bars_elapsed=12, got ${res?.bars_elapsed}`);
    console.log('✅ Test 7 Passed: 12-Bar TTL Expiration');
  }

  // ── Test 8: Short Setup Symmetric Execution ──
  {
    const candles: ReconciliationCandle[] = [
      makeCandle(0, 2495, 2503, 2494, 2498), // Touches short entry 2500
      makeCandle(5, 2498, 2499, 2478, 2480), // Touches TP1 (2480)
      makeCandle(10, 2480, 2481, 2458, 2462), // Touches TP2 (2460)
    ];

    const res = simulateSyntheticTapeOutcome({
      symbol: 'ETHUSDC',
      isLong: false,
      entryPrice: 2500,
      invalidation: 2520, // risk = 20
      target1: 2480,      // 1.0R
      target2: 2460,      // 2.0R
      ttlBars,
      barMinutes,
      recTime: baseTime,
      candles,
      now: baseTime + 60 * 60 * 1000,
    });

    assert(res?.terminal_state === 'TP2_HIT', `Test 8 expected TP2_HIT, got ${res?.terminal_state}`);
    assert(res?.realized_r === 1.7, `Test 8 expected 1.7R, got ${res?.realized_r}`);
    console.log('✅ Test 8 Passed: Short Setup 2-Stage TP2 Win (1.70R)');
  }

  // ── Test 9: End-to-End reconcileSetupOutcomes with Injected Candles & Daily Audit Metrics ──
  {
    const rawRecords: AiAnalysisRecord[] = [
      {
        id: 101,
        symbol: 'ETHUSDC',
        timeframe: '5m',
        requested_model: 'gemini-3.8',
        resolved_model: 'gemini-3.8',
        was_fallback: false,
        fallback_reason: null,
        execution_latency_ms: 350,
        bias_signal: 'BULLISH',
        trade_direction: 'LONG',
        status: 'ACTIVE_SETUP',
        entry_range_low: 2495,
        entry_range_high: 2505,
        invalidation_level: 2480,
        target_1: 2520,
        target_2: 2540,
        target_3: null,
        narrative: 'Bullish order flow continuation',
        raw_response: null,
        telemetry_data: { limitEntryPrice: 2500 },
        created_at: new Date(baseTime).toISOString(),
      },
      {
        id: 102,
        symbol: 'ETHUSDC',
        timeframe: '5m',
        requested_model: 'gemini-3.8',
        resolved_model: 'gemini-3.8',
        was_fallback: false,
        fallback_reason: null,
        execution_latency_ms: 400,
        bias_signal: 'BEARISH',
        trade_direction: 'SHORT',
        status: 'ACTIVE_SETUP',
        entry_range_low: 2495,
        entry_range_high: 2505,
        invalidation_level: 2520,
        target_1: 2480,
        target_2: 2460,
        target_3: null,
        narrative: 'Bearish liquidity sweep',
        raw_response: null,
        telemetry_data: { limitEntryPrice: 2500 },
        created_at: new Date(baseTime).toISOString(),
      },
    ];

    // Candles where Long hits TP2 and Short gets stopped out
    const testCandles: ReconciliationCandle[] = [
      makeCandle(0, 2498, 2504, 2496, 2501), // Touches 2500 (both enter)
      makeCandle(5, 2501, 2525, 2500, 2522), // Long hits TP1 (2520), Short gets stopped out at 2520!
      makeCandle(10, 2522, 2545, 2520, 2542), // Long hits TP2 (2540)
    ];

    const reconciled = await reconcileSetupOutcomes(rawRecords, {
      now: baseTime + 3600 * 1000,
      injectedCandles: testCandles,
    });

    assert(reconciled.length === 2, 'Reconciled count mismatch');
    assert(reconciled[0].reconciled_status === 'TP2_HIT', `Record 101 expected TP2_HIT, got ${reconciled[0].reconciled_status}`);
    assert(reconciled[1].reconciled_status === 'STOPPED_OUT', `Record 102 expected STOPPED_OUT, got ${reconciled[1].reconciled_status}`);

    const metrics = calculateDailyAuditMetrics(reconciled);
    assert(metrics.totalRuns === 2, 'Total runs mismatch');
    assert(metrics.winsCount === 1, `Wins count expected 1, got ${metrics.winsCount}`);
    assert(metrics.lossesCount === 1, `Losses count expected 1, got ${metrics.lossesCount}`);
    assert(metrics.tp2Count === 1, `TP2 count expected 1, got ${metrics.tp2Count}`);
    console.log('✅ Test 9 Passed: End-to-End Reconciler & Daily Audit Metrics (1W / 1L / 50% Win Rate)');
  }

  console.log('\n🎉 ALL 9 SYNTHETIC TAPE RECONCILIATION TESTS PASSED WITH 100% SUCCESS!\n');
}

runTests().catch((err) => {
  console.error('❌ Test Suite Failed:', err);
  process.exit(1);
});
