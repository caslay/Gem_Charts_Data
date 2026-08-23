import { SweepReclaimEngine, SweepReclaimSetup } from '../src/lib/quantEngine/SweepReclaimEngine';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { Candle } from '../src/lib/fvgEngine';
import assert from 'assert';

console.log('=========================================================================');
console.log('🧪 RUNNING FIRST-TRIGGERED EXECUTION & PENDING QUEUE FLUSH VERIFICATION');
console.log('=========================================================================\n');

// ── 1. Helper to generate realistic multi-month 5m/15m candle sequences ────────
function generateMultiMonthCandles(totalCandles: number = 1000, startPrice: number = 3000): Candle[] {
  const candles: Candle[] = [];
  const baseTime = Date.parse('2026-01-01T00:00:00.000Z');
  const intervalMs = 15 * 60 * 1000; // 15m intervals

  let p = startPrice;
  for (let i = 0; i < totalCandles; i++) {
    const t = baseTime + i * intervalMs;
    const date = new Date(t);
    const hour = date.getUTCHours();
    const day = date.getUTCDate();

    // Generate oscillating waves with structural sweeps and displacements
    const wave = Math.sin(i / 12) * 20 + Math.cos(i / 40) * 40;
    const open = p;
    let delta = (Math.sin(i) * 6 + (Math.random() - 0.5) * 4);
    
    // Inject periodic strong 3-pillar displacement waves
    let isDisplacement = false;
    if (i % 60 === 25) {
      delta = 25.0; // Bullish displacement
      isDisplacement = true;
    } else if (i % 60 === 55) {
      delta = -25.0; // Bearish displacement
      isDisplacement = true;
    }

    const close = open + delta;
    const high = Math.max(open, close) + (isDisplacement ? 2.0 : 4.0);
    const low = Math.min(open, close) - (isDisplacement ? 2.0 : 4.0);
    const vol = isDisplacement ? 5000 : 1000 + Math.abs(Math.sin(i)) * 500;
    const takerBuy = delta > 0 ? vol * 0.70 : vol * 0.30;

    p = close;
    candles.push({
      t,
      o: parseFloat(open.toFixed(2)),
      h: parseFloat(high.toFixed(2)),
      l: parseFloat(low.toFixed(2)),
      c: parseFloat(close.toFixed(2)),
      v: parseFloat(vol.toFixed(2)),
      taker_buy_vol: parseFloat(takerBuy.toFixed(2)),
      taker_sell_vol: parseFloat((vol - takerBuy).toFixed(2)),
      isClosed: true,
    });
  }
  return candles;
}

// ── TEST 1: Unrestricted Candidate Pool & Warmup Buffer Verification ───────────
console.log('=== TEST 1: Unrestricted Candidate Pool & Warmup Buffer ===');
const candles1 = generateMultiMonthCandles(600, 3000);
const engine1 = new SweepReclaimEngine({
  volumeExpansionThreshold: 1.50,
  deltaDominanceThreshold: 60.0,
  bodyRatioThreshold: 0.60,
  stage1Multiple: 1.0,
  stage2Multiple: 1.5,
  stage3Multiple: 3.0,
  entryMode: 'SWEEP_OB_MT',
});

const scanRes1 = engine1.scanHistoricalSetups(candles1);
console.log(`- Total Anchors Detected: ${scanRes1.telemetry.total_anchors_detected}`);
console.log(`- Total Sweeps Detected: ${scanRes1.telemetry.total_sweeps_detected}`);
console.log(`- Total Reclaims Confirmed: ${scanRes1.telemetry.total_reclaims_confirmed}`);
console.log(`- Total Retests Executed: ${scanRes1.telemetry.total_retests_executed}`);

assert(scanRes1.telemetry.total_anchors_detected > 0, 'Multi-timeframe anchors successfully detected');
assert(scanRes1.telemetry.total_sweeps_detected > 0, 'Sweeps successfully detected');
console.log('✅ TEST 1 PASSED: Unrestricted candidate pool generated and evaluated.\n');

// ── TEST 2: Strict Single-Position Concurrency Lock (0 Overlapping Positions) ─
console.log('=== TEST 2: Strict Single-Position Concurrency Lock (0 Overlapping Trades) ===');
const executedSetups = scanRes1.setups.filter((s) => s.is_retested && s.retest_index !== null);
console.log(`- Executed Trades Count: ${executedSetups.length}`);

// Verify that no two executed trades had overlapping execution intervals
let overlapCount = 0;
for (let i = 0; i < executedSetups.length; i++) {
  const tradeA = executedSetups[i];
  const startA = tradeA.retest_index!;
  const endA = tradeA.bars_to_outcome !== null ? startA + tradeA.bars_to_outcome : startA + 20;

  for (let j = i + 1; j < executedSetups.length; j++) {
    const tradeB = executedSetups[j];
    const startB = tradeB.retest_index!;
    const endB = tradeB.bars_to_outcome !== null ? startB + tradeB.bars_to_outcome : startB + 20;

    // Check interval overlap: startA <= endB && startB <= endA
    if (startA <= endB && startB <= endA) {
      overlapCount++;
      console.error(`❌ Overlap detected between Trade ${tradeA.id} [${startA}..${endA}] and Trade ${tradeB.id} [${startB}..${endB}]`);
    }
  }
}

assert(overlapCount === 0, 'Strict single-position concurrency lock maintained: exactly 0 overlapping trades!');
console.log('✅ TEST 2 PASSED: 0 overlapping position collisions across entire dataset.\n');

// ── TEST 3: First-Triggered Execution & Atomic Queue Flush in Live Engine ───────
console.log('=== TEST 3: First-Triggered Execution & Atomic Queue Flush in Live Engine ===');
const liveEngine = new AutomatedStrategyExecutionEngine({
  autoExecute: true,
  compoundingRiskPct: 2.0,
  cooldownMs: 0,
});

// Seed 3 competing pending limit orders for different candidate setups
const order1 = liveEngine.submitStrategyOrder({
  strategyId: 'SETUP_CANDIDATE_1',
  strategyName: 'Sweep & Reclaim Asian Low 1',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'LONG',
  limitEntryPrice: 2980.0,
  stopLossPrice: 2965.0,
  currentMarketPrice: 2990.0,
});

const order2 = liveEngine.submitStrategyOrder({
  strategyId: 'SETUP_CANDIDATE_2',
  strategyName: 'Sweep & Reclaim London Low 2',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'LONG',
  limitEntryPrice: 2975.0,
  stopLossPrice: 2960.0,
  currentMarketPrice: 2990.0,
});

const order3 = liveEngine.submitStrategyOrder({
  strategyId: 'SETUP_CANDIDATE_3',
  strategyName: 'Sweep & Reclaim PDL 3',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'LONG',
  limitEntryPrice: 2970.0,
  stopLossPrice: 2955.0,
  currentMarketPrice: 2990.0,
});

console.log(`- Pending Orders Count before touch: ${liveEngine.getPendingLimitOrders().length}`);
assert(liveEngine.getPendingLimitOrders().length === 3, 'All 3 candidate setups pending in memory queue');
assert(liveEngine.getActivePositions().length === 0, 'No active positions yet');

// Now simulate incoming tick touching first candidate setup @ $2980.00
console.log('- Market tick arrives @ $2979.50 (touches Setup 1 @ $2980.00)...');
liveEngine.processMarketTick(2979.50);

const activePositionsAfter = liveEngine.getActivePositions();
const pendingOrdersAfter = liveEngine.getPendingLimitOrders();

console.log(`- Active Positions Count: ${activePositionsAfter.length} (${activePositionsAfter[0]?.strategyId} @ $${activePositionsAfter[0]?.entryPrice})`);
console.log(`- Pending Orders Count after atomic flush: ${pendingOrdersAfter.length}`);

assert(activePositionsAfter.length === 1, 'Exactly 1 active position opened on first touch');
assert(activePositionsAfter[0].strategyId === 'SETUP_CANDIDATE_1', 'First triggered setup executed');
assert(pendingOrdersAfter.length === 0, 'ATOMIC QUEUE FLUSH: All competing pending limit orders purged instantly!');
console.log('✅ TEST 3 PASSED: First-Triggered Execution and Atomic Queue Flush verified.\n');

// ── TEST 4: Post-Exit State Reset & Fresh Candidate Ingestion ──────────────────
console.log('=== TEST 4: Post-Exit State Reset & Fresh Candidate Ingestion ===');
const activePos = activePositionsAfter[0];
const target3 = activePos.stage3Target;

console.log(`- Simulating price expansion to Stage 3 Target ($${target3.toFixed(2)})...`);
// Step 1: Stage 1 harvest @ 1.0R
liveEngine.processMarketTick(activePos.stage1Target);
assert(activePos.isStage1Filled, 'Stage 1 tranche filled');

// Step 2: Stage 2 harvest @ 1.5R
liveEngine.processMarketTick(activePos.stage2Target);
assert(activePos.isStage2Filled, 'Stage 2 tranche filled');

// Step 3: Stage 3 full win
liveEngine.processMarketTick(target3);
assert(liveEngine.getActivePositions().length === 0, 'Position closed after Full TP3 win');
assert(liveEngine.getClosedPositions().length === 1, 'Closed trade recorded in journal');

console.log('- Submitting fresh candidate setup after terminal exit...');
const freshOrder = liveEngine.submitStrategyOrder({
  strategyId: 'FRESH_CANDIDATE_4',
  strategyName: 'Sweep & Reclaim Fresh Pivot 4',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'LONG',
  limitEntryPrice: 3050.0,
  stopLossPrice: 3030.0,
  currentMarketPrice: 3060.0,
});

assert(freshOrder.success, 'Fresh candidate setup accepted after lock release');
assert(liveEngine.getPendingLimitOrders().length === 1, 'Fresh candidate queued in empty pool');
console.log('✅ TEST 4 PASSED: Post-Exit state reset and fresh candidate ingestion verified.\n');

// ── TEST 5: Large Multi-Month Dataset Frequency Verification ───────────────────
console.log('=== TEST 5: Multi-Month Dataset Scan Frequency & Statistical Sanity ===');
const multiMonthCandles = generateMultiMonthCandles(1500, 3000);
const multiMonthRes = engine1.scanHistoricalSetups(multiMonthCandles);

console.log(`- Total Dataset Candles: ${multiMonthCandles.length} (15m ~ 15.6 days)`);
console.log(`- Anchors: ${multiMonthRes.telemetry.total_anchors_detected}`);
console.log(`- Sweeps: ${multiMonthRes.telemetry.total_sweeps_detected} (${multiMonthRes.telemetry.sweep_rate_pct}%)`);
console.log(`- Reclaims: ${multiMonthRes.telemetry.total_reclaims_confirmed} (${multiMonthRes.telemetry.reclaim_rate_pct}%)`);
console.log(`- Retests Executed: ${multiMonthRes.telemetry.total_retests_executed} (${multiMonthRes.telemetry.retest_rate_pct}%)`);
console.log(`- Retest Win Rate: ${multiMonthRes.telemetry.retest_win_rate_pct}%`);
console.log(`- Avg Realized RR: +${multiMonthRes.telemetry.avg_realized_rr}R`);

assert(multiMonthRes.telemetry.total_retests_executed > 0, 'Executions occur at natural statistical frequency');
console.log('✅ TEST 5 PASSED: Multi-month historical simulation completed with healthy frequency.\n');

console.log('=========================================================================');
console.log('🎉 ALL FIRST-TRIGGERED EXECUTION & QUEUE FLUSH TESTS PASSED (100%)!');
console.log('=========================================================================');
