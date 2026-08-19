/**
 * test_hardening_guardrails.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification Test Suite for Production-Grade Hardening & Risk Guardrails (V16.30/V16.32)
 *
 * Tests:
 * 1. PATCH 1: One-Active-Position-Per-Structural-Wave Concurrency Lock
 *    - Validates that concurrent / clustered anchor sweeps on the same wave are vetoed.
 *    - Validates that [EXECUTION_LOCK] veto message is emitted.
 * 2. PATCH 2: Minimum Stop Loss Distance Buffer (Anti-Micro-Friction Clamp)
 *    - Validates that tight stops (< 0.15% price buffer) are clamped to the 0.15% floor.
 *    - Validates that wider stops (>= 0.15%) are preserved with exact structural accuracy.
 *    - Validates position sizing does not inflate excessively on micro-wicks.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  AutomatedStrategyExecutionEngine,
  DEFAULT_AUTOMATED_CONFIG,
} from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import {
  SweepReclaimEngine,
  DEFAULT_SWEEP_RECLAIM_CONFIG,
} from '../src/lib/quantEngine/SweepReclaimEngine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ ${message}`);
  }
}

console.log('=========================================================================');
console.log('🛡️ RUNNING PRODUCTION-GRADE HARDENING & RISK GUARDRAIL VERIFICATION');
console.log('=========================================================================\n');

// ── TEST 1: Anti-Micro-Friction Stop Loss Clamp (0.15% Floor) ─────────────────
console.log('=== TEST 1: Anti-Micro-Friction Clamp (0.15% Minimum Stop Distance) ===');

const engine = new AutomatedStrategyExecutionEngine({
  ...DEFAULT_AUTOMATED_CONFIG,
  autoExecute: true,
  maxOpenPositions: 5, // Allow multiple for testing concurrency locks
});

const equity = 10000.0;
const entryPrice = 3000.0; // ETH at $3,000.00 -> 0.15% floor = $4.50
const minExpectedDistance = entryPrice * 0.0015; // $4.50

// Case 1A: Micro-wick Stop Loss (Distance = $1.00, only 0.033%)
const microStopLoss = 2999.0;
const microSizing = engine.calculateCompoundedPositionSize(equity, entryPrice, microStopLoss);

console.log(`- Case 1A (Micro Stop: Entry=$3000, SL=$2999, Raw Dist=$1.00):`);
console.log(`  Calculated Distance: $${microSizing.distance.toFixed(2)} (Expected Floor: $${minExpectedDistance.toFixed(2)})`);
console.log(`  Contract Size: ${microSizing.contractSize} ETH (Without clamp: 200 ETH, Clamped: ~44.44 ETH)`);

assert(
  microSizing.distance === minExpectedDistance,
  `Micro stop distance automatically widened from $1.00 to $${minExpectedDistance.toFixed(2)} (0.15% floor)`
);
assert(
  microSizing.contractSize <= (200 / minExpectedDistance) + 0.01,
  `Position sizing safely protected from micro-wick inflation`
);

// Case 1B: Normal Structural Stop Loss (Distance = $25.00, ~0.83% > 0.15%)
const normalStopLoss = 2975.0;
const normalSizing = engine.calculateCompoundedPositionSize(equity, entryPrice, normalStopLoss);

console.log(`- Case 1B (Normal Stop: Entry=$3000, SL=$2975, Raw Dist=$25.00):`);
console.log(`  Calculated Distance: $${normalSizing.distance.toFixed(2)} (Expected: $25.00)`);
console.log(`  Contract Size: ${normalSizing.contractSize} ETH`);

assert(
  normalSizing.distance === 25.0,
  `Normal structural stop distance ($25.00) preserved untouched`
);

// Case 1C: submitStrategyOrder automatically clamps effective initialStopLoss & activeStopLoss
const submitResTight = engine.submitStrategyOrder({
  strategyId: 'TEST_TIGHT_SL',
  strategyName: 'Sweep & Reclaim Tight SL Test',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'LONG',
  limitEntryPrice: 3000.0,
  stopLossPrice: 2998.5, // Raw distance = $1.50
  originAnchorLevel: 3000.0,
  originZoneId: 'ZONE_TIGHT_1',
});

assert(submitResTight.success, 'Order submitted successfully');
assert(
  submitResTight.position?.initialStopLoss === 3000.0 - minExpectedDistance,
  `submitStrategyOrder clamped initialStopLoss to $${(3000.0 - minExpectedDistance).toFixed(2)}`
);
assert(
  submitResTight.position?.activeStopLoss === 3000.0 - minExpectedDistance,
  `submitStrategyOrder clamped activeStopLoss to $${(3000.0 - minExpectedDistance).toFixed(2)}`
);

// ── TEST 2: One-Active-Position-Per-Structural-Wave Concurrency Lock ───────────
console.log('\n=== TEST 2: One-Active-Position-Per-Structural-Wave Concurrency Lock ===');

// Attempt to submit a duplicate order for the same anchor level ($3000.00 / ZONE_TIGHT_1)
const duplicateRes1 = engine.submitStrategyOrder({
  strategyId: 'TEST_DUPLICATE_1',
  strategyName: 'Sweep & Reclaim Duplicate Test 1',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'LONG',
  limitEntryPrice: 3000.0,
  stopLossPrice: 2990.0,
  originAnchorLevel: 3000.0, // Same anchor level
  originZoneId: 'ZONE_TIGHT_1', // Same zone ID
});

console.log(`- Duplicate Submission Result: ${duplicateRes1.message}`);
assert(
  !duplicateRes1.success,
  'Duplicate submission for active zone was vetoed by Concurrency Lock'
);
assert(
  duplicateRes1.message.includes('[EXECUTION_LOCK]'),
  'Veto message contains [EXECUTION_LOCK] tag'
);

// Attempt to submit another clustered anchor on the same wave ($3000.25)
const duplicateRes2 = engine.submitStrategyOrder({
  strategyId: 'TEST_DUPLICATE_CLUSTERED',
  strategyName: 'Sweep & Reclaim Clustered Anchor Test',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'LONG',
  limitEntryPrice: 3000.0,
  stopLossPrice: 2990.0,
  originAnchorLevel: 3000.25, // Clustered within 0.50 margin
  originZoneId: 'ZONE_CLUSTERED_2',
});

console.log(`- Clustered Wave Submission Result: ${duplicateRes2.message}`);
assert(
  !duplicateRes2.success,
  'Clustered anchor on the same active structural wave vetoed by Concurrency Lock'
);
assert(
  duplicateRes2.message.includes('[EXECUTION_LOCK]'),
  'Clustered veto message contains [EXECUTION_LOCK] tag'
);

// Attempt to submit an order on a distinct, independent structural level ($3150.00)
const distinctRes = engine.submitStrategyOrder({
  strategyId: 'TEST_DISTINCT_ZONE',
  strategyName: 'Sweep & Reclaim Distinct Zone Test',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'LONG',
  limitEntryPrice: 3150.0,
  stopLossPrice: 3140.0,
  originAnchorLevel: 3150.0,
  originZoneId: 'ZONE_DISTINCT_3',
});

console.log(`- Distinct Zone Submission Result: ${distinctRes.message}`);
assert(
  distinctRes.success,
  'Distinct, independent anchor zone permitted without interference'
);

// ── TEST 3: SweepReclaimEngine Backtest Simulation Guardrails ──────────────────
console.log('\n=== TEST 3: SweepReclaimEngine Scan & Replay Guardrails ===');

const srEngine = new SweepReclaimEngine();

// Build a candle sequence with tight wicks and clustered anchors
const testCandles: any[] = [];
let baseTime = Date.UTC(2026, 0, 1, 0, 0, 0);
let currentP = 3000.0;

for (let i = 0; i < 300; i++) {
  const t = baseTime + i * 15 * 60 * 1000;
  let delta = Math.sin(i / 10) * 15;
  const open = currentP;
  const close = open + delta;
  const high = Math.max(open, close) + 2.0;
  const low = Math.min(open, close) - 2.0;
  const vol = 1200 + Math.abs(Math.sin(i)) * 400;
  const isUp = close >= open;
  const takerBuy = isUp ? vol * 0.65 : vol * 0.35;

  testCandles.push({
    t,
    o: parseFloat(open.toFixed(2)),
    h: parseFloat(high.toFixed(2)),
    l: parseFloat(low.toFixed(2)),
    c: parseFloat(close.toFixed(2)),
    v: parseFloat(vol.toFixed(2)),
    taker_buy_vol: parseFloat(takerBuy.toFixed(2)),
    taker_sell_vol: parseFloat((vol - takerBuy).toFixed(2)),
  });

  currentP = close;
}

const scanRes = srEngine.scanHistoricalSetups(testCandles);
console.log(`- Scanned setups count: ${scanRes.setups.length}`);

// Verify all reclaimed/retested setups in scanRes respect the minimum stop distance floor
let allStopsRespected = true;
const calculatedSetups = scanRes.setups.filter(s => s.is_reclaimed || s.is_retested || s.risk_usd > 0);
console.log(`- Reclaimed/Retested setups count with active risk: ${calculatedSetups.length}`);

for (const s of calculatedSetups) {
  const minBuffer = s.entry_price * 0.0015;
  const actualRisk = s.risk_usd;
  if (actualRisk < minBuffer - 0.01) {
    allStopsRespected = false;
    console.error(`❌ Setup ${s.id} violated stop buffer: Risk=$${actualRisk}, Min=$${minBuffer}`);
    break;
  }
}

assert(
  allStopsRespected,
  'All calculated setups strictly enforce the 0.15% minimum stop loss distance buffer floor'
);

console.log('\n=========================================================================');
console.log('🎉 ALL PRODUCTION-GRADE HARDENING & RISK GUARDRAIL TESTS PASSED 100%!');
console.log('=========================================================================');
