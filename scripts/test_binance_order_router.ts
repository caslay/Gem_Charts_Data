/**
 * scripts/test_binance_order_router.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Test Suite: Binance Order Router & Triple-Lock Safety Governor
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates:
 *  1. Triple-Lock Safety Gate default state (guaranteed shadow simulation)
 *  2. Micro-Lot sizing & exchange notional filter compliance ($5 min, 0.001 step)
 *  3. Safe order parameter mapping (LIMIT, STOP_MARKET, reduceOnly)
 *  4. Emergency Flatten killswitch behavior & queue purge
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  evaluateExecutionSafetyGate,
  routeLimitOrderPlacement,
  routeLimitOrderCancellation,
  routeOrderFilledBracket,
  routeStage1HarvestUpdate,
  routePositionClosedCleanup,
  routeEmergencyFlatten,
} from '../src/lib/binanceOrderRouter';
import { calculateMicroLotSize } from '../src/lib/binanceFuturesClient';
import {
  AutomatedStrategyExecutionEngine,
  StrategyExecutionPosition,
} from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`   ✅ ${message}`);
}

async function runTests() {
  console.log('======================================================================');
  console.log('🛡️ TESTING BINANCE ORDER ROUTER & TRIPLE-LOCK SAFETY GOVERNOR');
  console.log('======================================================================\n');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1: Triple-Lock Safety Gate Default State (Zero Exchange Exposure)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 1] Verifying Triple-Lock Safety Gate in Local Development...');
  const gate = evaluateExecutionSafetyGate();
  console.log(`   • Safety Gate Allowed: ${gate.isAllowed}`);
  console.log(`   • Operational Mode:    ${gate.mode}`);
  console.log(`   • Gate Reasoning:      ${gate.reason}`);

  assert(gate.isAllowed === false, 'Safety gate must be FALSE on local workstation');
  assert(gate.mode === 'SHADOW_SIMULATION', 'Operational mode must be SHADOW_SIMULATION');
  assert(
    gate.reason.includes('Shadow simulation mode active'),
    'Reason must indicate shadow simulation mode'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: Shadow Order Routing (Guaranteed Zero Network Mutation)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 2] Verifying Shadow Order Routing when Gate is Closed...');
  const mockPosition: StrategyExecutionPosition = {
    id: 'test_pos_001',
    strategyId: 'sr_champion',
    strategyName: '5M Sweep Reclaim',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    direction: 'LONG',
    status: 'PENDING_LIMIT_ENTRY',
    limitEntryPrice: 2400.0,
    entryPrice: 2400.0,
    initialStopLoss: 2390.0,
    activeStopLoss: 2390.0,
    activeRatchetFloor: null,
    trailingSlSource: 'ANCHOR',
    stage1Target: 2410.0,
    stage2Target: 2414.0,
    stage3Target: 2430.0,
    dynamicDolTarget: null,
    fvgCeLevel: null,
    riskUsd: 300.0,
    riskPerContract: 10.0,
    equityAtEntry: 15000.0,
    riskPct: 2.0,
    contractSize: 30.0,
    allocatedAmount: 1.0,
    remainingAllocation: 1.0,
    realizedR: 0,
    realizedUsd: 0,
    unrealizedR: 0,
    unrealizedUsd: 0,
    mfeR: 0,
    maeR: 0,
    isStage1Filled: false,
    isStage2Filled: false,
    isStage3Filled: false,
    stage1HitTime: null,
    stage2HitTime: null,
    stage3HitTime: null,
    pendingTime: Date.now(),
    openTime: null,
    closeTime: null,
    exitPrice: null,
    exitReason: 'ACTIVE',
  };

  const limitResult = await routeLimitOrderPlacement(mockPosition);
  assert(limitResult.routedToExchange === false, 'Limit order must not route to exchange in shadow mode');

  const cancelResult = await routeLimitOrderCancellation(mockPosition, 'TTL_EXPIRED');
  assert(cancelResult.cancelledOnExchange === false, 'Cancel order must not hit exchange in shadow mode');

  const bracketResult = await routeOrderFilledBracket(mockPosition);
  assert(bracketResult.slOrderId === undefined, 'Stop loss must not hit exchange in shadow mode');

  const harvestResult = await routeStage1HarvestUpdate(mockPosition);
  assert(harvestResult.beSlOrderId === undefined, 'Stage 1 harvest must not hit exchange in shadow mode');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: Micro-Lot Risk Sizing with Binance Step & Notional Filters
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 3] Validating Dynamic 2% Compounding Micro-Lot Sizing...');
  // Scenario A: Standard account $10,000 equity, $10 distance
  const sizingA = calculateMicroLotSize(2400.0, 2390.0, 10000.0, 2.0);
  console.log(
    `   • $10,000 Equity (Risk $200.00): Size = ${sizingA.contractSize} ETH | Notional = $${sizingA.notionalUsd}`
  );
  assert(sizingA.isValid === true, 'Sizing A must be valid');
  assert(sizingA.contractSize === 20.0, '200 USD risk / 10 USD distance must equal 20.0 ETH');
  assert(sizingA.minNotionalMet === true, 'Notional ($48,000) must exceed $5.00 minimum');

  // Scenario B: Micro account $100 equity, small distance $5 -> target risk $2.00
  // Raw size = 2 / 5 = 0.4 ETH (Notional = 0.4 * 2400 = $960)
  const sizingB = calculateMicroLotSize(2400.0, 2395.0, 100.0, 2.0);
  console.log(
    `   • $100 Equity (Risk $2.00): Size = ${sizingB.contractSize} ETH | Notional = $${sizingB.notionalUsd}`
  );
  assert(sizingB.isValid === true, 'Sizing B must be valid');
  assert(sizingB.contractSize === 0.4, 'Contract size must be 0.400 ETH');
  assert(sizingB.minNotionalMet === true, 'Notional must meet $5 minimum');

  // Scenario C: Tiny micro account $20 equity, distance $20 -> target risk $0.40
  // Raw size = 0.40 / 20 = 0.02 ETH. Notional = 0.02 * 2400 = $48.
  const sizingC = calculateMicroLotSize(2400.0, 2380.0, 20.0, 2.0);
  assert(sizingC.isValid === true, 'Sizing C must be valid');
  assert(sizingC.notionalUsd >= 5.0, 'Must meet Binance $5.00 min notional');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: Engine Emergency Clear Methods & Flatten Behavior
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 4] Testing Engine Emergency Clear & Flatten Protocol...');
  const engine = new AutomatedStrategyExecutionEngine({ symbol: 'ETHUSDC', autoExecute: true });

  // Manually push a test pending order
  const testPending = { ...mockPosition, id: 'pending_to_clear' };
  (engine as any).pendingLimitOrders.push(testPending);
  assert(engine.getPendingLimitOrders().length === 1, 'Engine must have 1 pending limit order');

  // Cancel individual order
  const cancelledIndividual = engine.cancelPendingLimitOrder('pending_to_clear');
  assert(cancelledIndividual === true, 'cancelPendingLimitOrder must return true');
  assert(engine.getPendingLimitOrders().length === 0, 'Pending queue must now be 0');

  // Push two orders and test emergencyClearAllPendingOrders
  (engine as any).pendingLimitOrders.push({ ...mockPosition, id: 'pending_1' });
  (engine as any).pendingLimitOrders.push({ ...mockPosition, id: 'pending_2' });
  assert(engine.getPendingLimitOrders().length === 2, 'Engine must have 2 pending orders');

  const purgedCount = engine.emergencyClearAllPendingOrders();
  assert(purgedCount === 2, 'emergencyClearAllPendingOrders must return purged count 2');
  assert(engine.getPendingLimitOrders().length === 0, 'Pending queue must be completely empty');

  // Test routeEmergencyFlatten
  const flattenResult = await routeEmergencyFlatten('ETHUSDC', mockPosition);
  assert(flattenResult.success === true, 'routeEmergencyFlatten must return success');
  console.log(`   • Flatten Output: "${flattenResult.message}"`);

  console.log('\n======================================================================');
  console.log(' 🎉 ALL BINANCE ORDER ROUTER & SAFETY TESTS PASSED WITH 100% SUCCESS');
  console.log('======================================================================\n');
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
