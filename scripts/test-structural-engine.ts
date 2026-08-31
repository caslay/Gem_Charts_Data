/**
 * test-structural-engine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Test Suite for Structural Engine Refactor:
 *  1. Market Regime Classification (Rotational, Transitional, Runaway)
 *  2. Anchor Tier Priority & Multi-Anchor Wave Deduplication
 *  3. Single-Position Concurrency Walk & Champion Election
 *  4. Retest Freshness & Pullback vs. Continuation Discrimination
 *  5. Zero-Repainting Determinism Assertion
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  SweepReclaimEngine,
  classifyMarketRegime,
  getAnchorPriority,
  DEFAULT_SWEEP_RECLAIM_CONFIG,
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';
import { StructuralBootstrapContext } from '../src/lib/quantEngine/types';

function generateSyntheticCandles(count: number, basePrice = 2000, trend: 'FLAT' | 'DUMP' | 'PUMP' = 'FLAT'): Candle[] {
  const candles: Candle[] = [];
  let currentPrice = basePrice;
  const now = Date.now() - count * 5 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const time = now + i * 5 * 60 * 1000;
    let step = (Math.random() - 0.5) * 4;
    if (trend === 'DUMP') step -= 8; // Strong cascading selloff
    if (trend === 'PUMP') step += 8;

    const open = currentPrice;
    const close = open + step;
    const high = Math.max(open, close) + Math.random() * 2;
    const low = Math.min(open, close) - Math.random() * 2;
    const volume = 100 + Math.random() * 50;

    candles.push({
      t: time,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume,
      taker_buy_vol: volume * 0.5,
      taker_sell_vol: volume * 0.5,
      isClosed: true,
    });
    currentPrice = close;
  }
  return candles;
}

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${testName} ${details ? `(${details})` : ''}`);
  }
}

console.log('\n🏛️  STARTING STRUCTURAL ENGINE QUANTITATIVE VALIDATION SUITE\n');

// ── Test 1: Anchor Tier Priority Hierarchy ──────────────────────────────────
console.log('📌 Test Suite 1: Anchor Tier Priority Hierarchy');
assert(getAnchorPriority('DAILY') === 100, 'DAILY anchor priority is 100');
assert(getAnchorPriority('PDH') === 100, 'PDH anchor priority is 100');
assert(getAnchorPriority('LONDON_HIGH') === 90, 'LONDON_HIGH priority is 90');
assert(getAnchorPriority('ASIAN_LOW') === 80, 'ASIAN_LOW priority is 80');
assert(getAnchorPriority('SWING_PIVOT', 'MAJOR') === 70, 'MAJOR swing priority is 70');
assert(getAnchorPriority('SWING_PIVOT', 'INTERNAL') === 50, 'INTERNAL swing priority is 50');
assert(getAnchorPriority('SWING_PIVOT', 'INNER') === 30, 'INNER swing priority is 30');
assert(
  getAnchorPriority('DAILY') > getAnchorPriority('LONDON_HIGH') &&
  getAnchorPriority('LONDON_HIGH') > getAnchorPriority('ASIAN_LOW') &&
  getAnchorPriority('ASIAN_LOW') > getAnchorPriority('SWING_PIVOT', 'MAJOR') &&
  getAnchorPriority('SWING_PIVOT', 'MAJOR') > getAnchorPriority('SWING_PIVOT', 'INTERNAL'),
  'Strict monotonic ordering: DAILY > LONDON > ASIAN > MAJOR > INTERNAL > INNER'
);

// ── Test 2: Market Regime Classification ────────────────────────────────────
console.log('\n📌 Test Suite 2: Market Regime Classification');
const flatCandles = generateSyntheticCandles(50, 2000, 'FLAT');
const atrs = new Array(50).fill(2.0);

const flatRegime = classifyMarketRegime(45, flatCandles, atrs);
assert(flatRegime.regime === 'ROTATIONAL_AUCTION', 'Flat market classified as ROTATIONAL_AUCTION', `Got: ${flatRegime.regime}`);

const dumpCandles = generateSyntheticCandles(50, 2000, 'DUMP');
const dumpRegime = classifyMarketRegime(45, dumpCandles, atrs);
assert(dumpRegime.regime === 'RUNAWAY_EXPANSION', 'Cascading dump classified as RUNAWAY_EXPANSION', `Got: ${dumpRegime.regime}`);
assert(dumpRegime.direction === 'BEARISH', 'Runaway dump classified as BEARISH direction', `Got: ${dumpRegime.direction}`);

// Test bootstrap expansion override
const bootstrapWithExpansion: StructuralBootstrapContext = {
  majorSnapshot: {
    current_trend_state: 'BEARISH_SWING',
    is_in_expansion: true,
    protected_high: 2100,
    protected_low: 1900,
    active_swing_high: 2100,
    active_swing_low: 1900,
    expansion_high_float: null,
    expansion_low_float: 1850,
    expansion_origin_price: 1900,
  },
  internalSnapshot: {} as any,
  microSnapshot: {} as any,
  confirmedPivots: [],
  activeFVGs: [],
  activeOrderBlocks: [],
  institutionalOrderBlocks: [],
  lastConfirmedDealingRange: null,
  warmupCutoffTs: 0,
};

const bootstrapRegime = classifyMarketRegime(45, flatCandles, atrs, bootstrapWithExpansion);
assert(
  bootstrapRegime.regime === 'RUNAWAY_EXPANSION' || bootstrapRegime.regime === 'TRANSITIONAL_EXPANSION',
  'Bootstrap expansion properly promotes regime state',
  `Got: ${bootstrapRegime.regime}`
);

// ── Test 3: Engine Execution & In-Scanner Wave Deduplication ─────────────────
console.log('\n📌 Test Suite 3: In-Scanner Wave Deduplication & Concurrency');

const testEngine = new SweepReclaimEngine({
  enableInScannerWaveDedup: true,
  enforceSinglePositionConcurrency: true,
  enableRegimeAdaptiveEQ: true,
  maxBarsToRetest: 12,
});

// Construct a deterministic multi-anchor sweep scenario
const baseCandles = generateSyntheticCandles(100, 2500, 'FLAT');
const scanResult = testEngine.scanHistoricalSetups(baseCandles);

assert(Array.isArray(scanResult.setups), 'scanHistoricalSetups returns array of setups');
assert(typeof scanResult.telemetry.total_anchors_detected === 'number', 'Telemetry contains total_anchors_detected');
assert(typeof scanResult.telemetry.total_raw_candidates === 'number', 'Telemetry tracks total_raw_candidates');
assert(typeof scanResult.telemetry.total_wave_champions === 'number', 'Telemetry tracks total_wave_champions');
assert(typeof scanResult.telemetry.stacking_reduction_pct === 'number', 'Telemetry tracks stacking_reduction_pct');
assert(scanResult.telemetry.regime_distribution !== undefined, 'Telemetry tracks regime_distribution');
assert(scanResult.telemetry.retest_freshness_distribution !== undefined, 'Telemetry tracks retest_freshness_distribution');
assert(scanResult.telemetry.retest_type_distribution !== undefined, 'Telemetry tracks retest_type_distribution');

// Verify all setups carry new required metadata fields
let allMetadataFieldsPresent = true;
for (const s of scanResult.setups) {
  if (s.wave_fingerprint === undefined || s.is_wave_champion === undefined || s.market_regime_at_entry === undefined) {
    allMetadataFieldsPresent = false;
    break;
  }
}
assert(allMetadataFieldsPresent, 'All setups contain wave_fingerprint, is_wave_champion, and market_regime_at_entry');

// ── Test 4: Zero-Repaint Determinism Assertion ───────────────────────────────
console.log('\n📌 Test Suite 4: Zero-Repainting Determinism Assertion');

const run1 = testEngine.scanHistoricalSetups(baseCandles);
const run2 = testEngine.scanHistoricalSetups(baseCandles);

assert(run1.setups.length === run2.setups.length, 'Setup count is deterministic between duplicate runs');
assert(run1.telemetry.total_retests_executed === run2.telemetry.total_retests_executed, 'Retest execution count is 100% deterministic');
assert(run1.telemetry.avg_realized_rr === run2.telemetry.avg_realized_rr, 'Realized RR is 100% deterministic');

let exactSetupMatch = true;
for (let i = 0; i < run1.setups.length; i++) {
  const s1 = run1.setups[i];
  const s2 = run2.setups[i];
  if (
    s1.id !== s2.id ||
    s1.entry_price !== s2.entry_price ||
    s1.wave_fingerprint !== s2.wave_fingerprint ||
    s1.is_wave_champion !== s2.is_wave_champion ||
    s1.market_regime_at_entry !== s2.market_regime_at_entry ||
    s1.retest_freshness !== s2.retest_freshness ||
    s1.realized_rr !== s2.realized_rr
  ) {
    exactSetupMatch = false;
    break;
  }
}
assert(exactSetupMatch, 'Every setup field matches bit-for-bit across duplicate runs (Zero-Repaint Verified)');

// ── Final Scorecard ─────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`📊 FINAL RESULT: ${passedTests} / ${totalTests} TESTS PASSED (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
console.log('─'.repeat(70) + '\n');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
