/**
 * test_automated_strategy_execution.ts
 * Automated mathematical and state machine verification suite for:
 *  - Dynamic 2% Compounding Risk Sizing ($1.0R = Equity * 0.02)
 *  - Resting Limit Order Routing (Touch Execution)
 *  - 3-Stage Harvest Lifecycle (40% @ 1.0R, 40% @ 1.5R, 20% @ DOL)
 *  - Dynamic Trailing Stop & Profit-Locking Ratchet State Machine
 *  - Multi-Position Guardrails (Concurrency Cap, Directional Lock, Cooldown)
 *  - On-Mount Database Re-hydration
 */

import {
  AutomatedStrategyExecutionEngine,
  StrategyExecutionPosition
} from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';

console.log("=== [TEST SUITE] Automated Strategy Execution Engine & 2% Compounding ===");

// ── TEST 1: Dynamic 2% Compounding Risk Sizing Math ──────────────────────────
console.log("\n[TEST 1] Testing Dynamic 2% Compounding Risk Sizing Math...");

const engine = new AutomatedStrategyExecutionEngine({
  compoundingRiskPct: 2.0,
  minLotSize: 0.001,
  maxLotSize: 100.0,
  lotPrecision: 3
});

// Scenario A: $10,000 Equity, Entry $3,000, SL $2,980 (Distance = $20)
// Expected: 1.0R = $200, Contract Size = $200 / $20 = 10.000 contracts
const sizingA = engine.calculateCompoundedPositionSize(10000, 3000, 2980);
console.log(`- Equity $10,000 -> Risk: $${sizingA.riskUsd} (2%), Distance: $${sizingA.distance}, Size: ${sizingA.contractSize} ETH`);
if (sizingA.riskUsd !== 200 || sizingA.contractSize !== 10.0) {
  console.error("❌ FAIL: Sizing A math mismatch.");
  process.exit(1);
}

// Scenario B: $15,000 Compounded Equity, Entry $3,000, SL $2,950 (Distance = $50)
// Expected: 1.0R = $300, Contract Size = $300 / $50 = 6.000 contracts
const sizingB = engine.calculateCompoundedPositionSize(15000, 3000, 2950);
console.log(`- Equity $15,000 -> Risk: $${sizingB.riskUsd} (2%), Distance: $${sizingB.distance}, Size: ${sizingB.contractSize} ETH`);
if (sizingB.riskUsd !== 300 || sizingB.contractSize !== 6.0) {
  console.error("❌ FAIL: Sizing B math mismatch.");
  process.exit(1);
}

// Scenario C: $8,000 Drawdown Equity, Entry $3,000, SL $2,990 (Distance = $10)
// Expected: 1.0R = $160, Contract Size = $160 / $10 = 16.000 contracts
const sizingC = engine.calculateCompoundedPositionSize(8000, 3000, 2990);
console.log(`- Equity $8,000 -> Risk: $${sizingC.riskUsd} (2%), Distance: $${sizingC.distance}, Size: ${sizingC.contractSize} ETH`);
if (sizingC.riskUsd !== 160 || sizingC.contractSize !== 16.0) {
  console.error("❌ FAIL: Sizing C math mismatch.");
  process.exit(1);
}

// Scenario D: Zero Distance Error Guard
const sizingD = engine.calculateCompoundedPositionSize(10000, 3000, 3000);
console.log(`- Zero Distance Guard: isValid = ${sizingD.isValid}, error = "${sizingD.error}"`);
if (sizingD.isValid) {
  console.error("❌ FAIL: Expected zero distance error to be rejected.");
  process.exit(1);
}

console.log("✅ TEST 1 PASSED: Dynamic 2% Compounding math verified.");

// ── TEST 2: Resting Limit Order Touch Execution & 3-Stage Harvest ────────────
console.log("\n[TEST 2] Testing Resting Limit Order Routing & 3-Stage Harvest...");

const execEngine = new AutomatedStrategyExecutionEngine({
  compoundingRiskPct: 2.0,
  stage1Multiple: 1.0,
  stage2Multiple: 1.5,
  stage3Multiple: 3.0,
  stage1Ratio: 0.40,
  stage2Ratio: 0.40,
  stage3Ratio: 0.20,
  enableStructuralTrail: true,
  enableProfitRatchet: true
});
execEngine.setAccountEquity(12500); // 1.0R = $250

// Submit resting limit order: Entry $3000, SL $2980 ($20 distance), FVG CE $2990, DOL $3060 (3.0R)
const orderRes = execEngine.submitStrategyOrder({
  strategyId: 'STRAT_OB_BULL',
  strategyName: 'Institutional Bullish OB',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'LONG',
  limitEntryPrice: 3000,
  stopLossPrice: 2980,
  fvgCeLevel: 2990,
  dynamicDolTarget: 3060,
  currentMarketPrice: 3010, // Higher than limit, so goes to pending
  activeEquity: 12500
});

console.log(`- Order Submission: ${orderRes.message}`);
if (!orderRes.success || execEngine.getPendingLimitOrders().length !== 1) {
  console.error("❌ FAIL: Expected resting limit order in queue.");
  process.exit(1);
}

const pos = orderRes.position!;
console.log(`  Target 1: $${pos.stage1Target} | Target 2: $${pos.stage2Target} | Target 3 (DOL): $${pos.stage3Target}`);

// Tick 1: Market dips to $3000 -> Fills Limit Order
execEngine.processMarketTick(3000);
if (execEngine.getActivePositions().length !== 1 || execEngine.getPendingLimitOrders().length !== 0) {
  console.error("❌ FAIL: Limit order should be filled at $3000.");
  process.exit(1);
}
console.log(`- Tick @ $3000: Limit order filled into active position.`);

// Tick 2: Market rallies to $3020 (Stage 1 @ 1.0R = $3000 + $20 = $3020)
execEngine.processMarketTick(3020);
const activePos = execEngine.getActivePositions()[0];
console.log(`- Tick @ $3020 (Stage 1): Realized = +${activePos.realizedR}R ($${activePos.realizedUsd}), SL = $${activePos.activeStopLoss} (${activePos.trailingSlSource})`);
if (!activePos.isStage1Filled || activePos.realizedR !== 0.40 || activePos.activeStopLoss !== 2990 || activePos.trailingSlSource !== 'FVG_CE') {
  console.error("❌ FAIL: Stage 1 harvest or FVG CE trailing stop mismatch.");
  process.exit(1);
}

// Tick 3: Market rallies to $3030 (Stage 2 @ 1.5R = $3000 + $30 = $3030)
execEngine.processMarketTick(3030);
console.log(`- Tick @ $3030 (Stage 2): Realized = +${activePos.realizedR}R ($${activePos.realizedUsd}), SL = $${activePos.activeStopLoss} (${activePos.trailingSlSource})`);
if (!activePos.isStage2Filled || activePos.realizedR !== 1.0 || activePos.activeStopLoss !== 3020 || activePos.trailingSlSource !== 'PROFIT_RATCHET_FLOOR') {
  console.error("❌ FAIL: Stage 2 harvest or +1.0R ratchet floor mismatch.");
  process.exit(1);
}

// Tick 4: Market rallies to $3060 (Stage 3 @ DOL = 3.0R = $3060)
execEngine.processMarketTick(3060);
if (execEngine.getActivePositions().length !== 0 || execEngine.getClosedPositions().length !== 1) {
  console.error("❌ FAIL: Full position should close at Stage 3 DOL target.");
  process.exit(1);
}

const closedPos = execEngine.getClosedPositions()[0];
console.log(`- Tick @ $3060 (Stage 3 DOL Fill): Status = ${closedPos.status}, Exit = $${closedPos.exitPrice}, Net Realized = +${closedPos.realizedR}R ($${closedPos.realizedUsd})`);
// 0.40 * 1.0 + 0.40 * 1.5 + 0.20 * 3.0 = 0.40 + 0.60 + 0.60 = 1.60R
if (closedPos.realizedR !== 1.60 || closedPos.realizedUsd !== 400.0) {
  console.error("❌ FAIL: Final realized P&L mismatch (expected +1.60R / $400.00).");
  process.exit(1);
}

console.log("✅ TEST 2 PASSED: 3-Stage Harvest & Target Ladder execution verified.");

// ── TEST 3: +1.0R Profit Ratchet Floor Stop-Out Protection ───────────────────
console.log("\n[TEST 3] Testing +1.0R Profit Ratchet Floor Stop-Out Protection...");

const ratchetEngine = new AutomatedStrategyExecutionEngine({
  compoundingRiskPct: 2.0,
  cooldownMs: 0 // zero for instant test
});
ratchetEngine.setAccountEquity(10000); // 1.0R = $200

// Open Short: Entry $3000, SL $3020 ($20 distance), Stage 1 $2980, Stage 2 $2970 (+1.0R floor = $2980)
const shortOrder = ratchetEngine.submitStrategyOrder({
  strategyId: 'STRAT_SHORT',
  strategyName: 'Bearish MSS Retest',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'SHORT',
  limitEntryPrice: 3000,
  stopLossPrice: 3020,
  fvgCeLevel: 3010,
  currentMarketPrice: 3000
});

// Hits Stage 1 ($2980) and Stage 2 ($2970)
ratchetEngine.processMarketTick(2980);
ratchetEngine.processMarketTick(2970);

// Price reverses violently back to $2980 (hits +1.0R profit floor)
ratchetEngine.processMarketTick(2980);

if (ratchetEngine.getActivePositions().length !== 0 || ratchetEngine.getClosedPositions().length !== 1) {
  console.error("❌ FAIL: Position should be stopped out at +1.0R profit floor.");
  process.exit(1);
}

const ratchetClosed = ratchetEngine.getClosedPositions()[0];
console.log(`- Reversal Hit Ratchet Floor: Realized = +${ratchetClosed.realizedR}R ($${ratchetClosed.realizedUsd}), Reason = ${ratchetClosed.exitReason}`);
// 0.40 * 1.0 + 0.40 * 1.5 + 0.20 * 1.0 = 0.40 + 0.60 + 0.20 = +1.20R net!
if (ratchetClosed.realizedR !== 1.20 || ratchetClosed.realizedUsd !== 240.0) {
  console.error("❌ FAIL: Ratchet floor realized R mismatch (expected +1.20R / $240.00).");
  process.exit(1);
}

console.log("✅ TEST 3 PASSED: +1.0R Profit Ratchet Floor Stop-Out verified.");

// ── TEST 4: Multi-Position Guardrails & Re-hydration ────────────────────────
console.log("\n[TEST 4] Testing Multi-Position Safety Guardrails & Re-hydration...");

const guardEngine = new AutomatedStrategyExecutionEngine({
  maxOpenPositions: 1,
  cooldownMs: 60000
});
guardEngine.setAccountEquity(10000);

// Open position
guardEngine.submitStrategyOrder({
  strategyId: 'S1',
  strategyName: 'Strat 1',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'LONG',
  limitEntryPrice: 3000,
  stopLossPrice: 2980,
  currentMarketPrice: 3000
});

// Attempt opposing short (Directional Veto)
const vetoRes = guardEngine.submitStrategyOrder({
  strategyId: 'S2',
  strategyName: 'Strat 2',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'SHORT',
  limitEntryPrice: 3050,
  stopLossPrice: 3070
});
console.log(`- Directional Veto Result: success = ${vetoRes.success}, message = "${vetoRes.message}"`);
if (vetoRes.success) {
  console.error("❌ FAIL: Opposing position should be vetoed.");
  process.exit(1);
}

// Test Re-hydration from database payload
const mockDbTrades = [
  {
    id: 'db-trade-uuid-1',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entry_price: '2800.00',
    stop_loss: '2750.00',
    status: 'STAGE_1_FILLED',
    strategy_name: 'Rehydrated Macro Setup',
    risk_amount_usd: '200.00',
    position_size: '4.000',
    ipda_metrics: {
      timeframe: '1h',
      stage1_target: 2850,
      stage2_target: 2875,
      stage3_target: 2950
    }
  }
];

const rehydratedEngine = new AutomatedStrategyExecutionEngine();
const rehydrated = rehydratedEngine.rehydrateOpenPositions(mockDbTrades);
console.log(`- Rehydrated count: ${rehydrated.length}`);
if (rehydrated.length !== 1 || rehydrated[0].status !== 'STAGE_1_FILLED' || rehydrated[0].activeStopLoss !== 2750) {
  console.error("❌ FAIL: Rehydration mismatch.");
  process.exit(1);
}

console.log("✅ TEST 4 PASSED: Multi-position guardrails & database re-hydration verified.");

console.log("\n=========================================================================");
console.log("🎉 ALL AUTOMATED STRATEGY EXECUTION & 2% COMPOUNDING TESTS PASSED (100%)!");
console.log("=========================================================================");
