/**
 * test_htf_hysteresis.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification Test Suite for Phase 1: HTF Bias Hysteresis Gate
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { HtfBiasHysteresisEngine } from '../src/lib/quantEngine/HtfBiasHysteresisEngine';
import { resolveTripleVectorBias } from '../src/lib/quantEngine/BiasEngine';
import { Candle } from '../src/lib/fvgEngine';

async function runTests() {
  console.log('🧪 Starting Phase 1: HTF Bias Hysteresis & State Machine Verification...\n');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, message: string) {
    total++;
    if (condition) {
      console.log(`   ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`   ❌ FAIL: ${message}`);
      process.exitCode = 1;
    }
  }

  // ── Test 1: BiasEngine resolveTripleVectorBias() contradiction fix ──
  console.log('1. BiasEngine Triple-Vector Verification:');
  const bullishBias = resolveTripleVectorBias({
    livePrice: 2400,
    activeSwingPOC: 2450, // livePrice < activeSwingPOC (Discount)
    nearest_htf_magnet: { label: 'DAILY_SIBI', distance: 50 },
    liquidation_status: 'LIQUIDITY_SWEPT',
    target_status: 'ACTIVE',
  });
  assert(bullishBias === 'CONFIRMED_BULLISH', `Bullish setup resolves to CONFIRMED_BULLISH (got: ${bullishBias})`);

  const bearishBias = resolveTripleVectorBias({
    livePrice: 2500,
    activeSwingPOC: 2450, // livePrice > activeSwingPOC (Premium)
    nearest_htf_magnet: { label: 'DAILY_BISI', distance: 50 },
    liquidation_status: 'LIQUIDITY_SWEPT',
    target_status: 'ACTIVE',
  });
  assert(bearishBias === 'CONFIRMED_BEARISH', `Bearish setup resolves to CONFIRMED_BEARISH (got: ${bearishBias})`);

  // ── Test 2: HtfBiasHysteresisEngine Multi-Bar Confirmation ──
  console.log('\n2. HtfBiasHysteresisEngine Multi-Bar Confirmation:');
  const engine = new HtfBiasHysteresisEngine('BEARISH_CONFIRMED');

  // Synthetic 1H candles in downtrend
  const baseTime = Date.now() - 30 * 3600 * 1000;
  const mock1hCandles: Candle[] = [];
  for (let i = 0; i < 25; i++) {
    const price = 2500 - i * 10;
    mock1hCandles.push({
      t: baseTime + i * 3600 * 1000,
      o: price + 5,
      h: price + 8,
      l: price - 8,
      c: price,
      v: 1000,
      taker_buy_vol: 450,
      taker_sell_vol: 550,
      isClosed: true,
    });
  }

  // Evaluate initial bearish stream
  const res1 = engine.evaluate(mock1hCandles);
  assert(res1.confirmedBias === 'BEARISH', `Initial state confirmed as BEARISH (got: ${res1.confirmedBias})`);

  // Single 15m bullish counter-trend wick
  const mock15mCandles: Candle[] = [
    {
      t: Date.now(),
      o: 2260,
      h: 2280, // Strong wick bounce
      l: 2255,
      c: 2275,
      v: 800,
      taker_buy_vol: 500,
      taker_sell_vol: 300,
      isClosed: true,
    },
  ];

  const res2 = engine.evaluate(mock1hCandles, mock15mCandles);
  assert(
    res2.confirmedBias === 'BEARISH',
    `Single 15m counter-trend wick does NOT flip confirmed BEARISH bias (got: ${res2.confirmedBias})`
  );
  assert(
    res2.classification === 'RETRACEMENT_IN_DISCOUNT',
    `15m counter-trend wick classified as RETRACEMENT_IN_DISCOUNT (got: ${res2.classification})`
  );
  assert(
    res2.executionDisabled === true,
    `Counter-trend executionDisabled is true (got: ${res2.executionDisabled})`
  );

  // Next: Single 1H break above protected high transitions to BULLISH_PENDING (not immediately CONFIRMED)
  const protectedHigh = res1.protectedHigh ?? 2500;
  const breaking1hCandle: Candle = {
    t: Date.now() - 3600 * 1000,
    o: protectedHigh - 5,
    h: protectedHigh + 20,
    l: protectedHigh - 6,
    c: protectedHigh + 18, // Displaced body close above protected high
    v: 3000,
    taker_buy_vol: 2200,
    taker_sell_vol: 800,
    isClosed: true,
  };
  mock1hCandles.push(breaking1hCandle);

  const res3 = engine.evaluate(mock1hCandles);
  assert(
    res3.state === 'BULLISH_PENDING',
    `Single 1H displaced close enters BULLISH_PENDING state (got: ${res3.state})`
  );
  assert(
    res3.confirmedBias === 'NEUTRAL',
    `In pending state, confirmedBias is NEUTRAL (got: ${res3.confirmedBias})`
  );

  // Next 1H bar confirms by holding above protected high -> BULLISH_CONFIRMED
  const confirming1hCandle: Candle = {
    t: Date.now(),
    o: protectedHigh + 18,
    h: protectedHigh + 30,
    l: protectedHigh + 10,
    c: protectedHigh + 25,
    v: 2500,
    taker_buy_vol: 1800,
    taker_sell_vol: 700,
    isClosed: true,
  };
  mock1hCandles.push(confirming1hCandle);

  const res4 = engine.evaluate(mock1hCandles);
  assert(
    res4.state === 'BULLISH_CONFIRMED',
    `Second 1H confirmation bar transitions state to BULLISH_CONFIRMED (got: ${res4.state})`
  );
  assert(
    res4.confirmedBias === 'BULLISH',
    `Confirmed bias is now BULLISH (got: ${res4.confirmedBias})`
  );

  console.log(`\n=============================================`);
  console.log(`Phase 1 Test Result: ${passed}/${total} assertions passed (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`=============================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
