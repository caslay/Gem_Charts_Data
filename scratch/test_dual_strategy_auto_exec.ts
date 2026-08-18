/**
 * test_dual_strategy_auto_exec.ts
 * Automated verification suite for Dual Strategy Independent Auto-Execution Control Panel.
 * Tests independent toggle flags, persistence, and bypass behaviors for:
 *   1. Order Block & Breaker Strategy (isOrderBlockAutoExecEnabled)
 *   2. Sweep & Reclaim 3-Pillar Strategy (isSweepReclaimAutoExecEnabled)
 */

import {
  getOrderBlockAutoExec,
  setOrderBlockAutoExec,
  getSweepReclaimAutoExec,
  setSweepReclaimAutoExec,
  STORAGE_KEY_OB_AUTO_EXEC,
  STORAGE_KEY_SR_AUTO_EXEC,
} from '../src/lib/quantEngine/strategyExecutionConfig';
import { LiveOrderBlockExecutionEngine } from '../src/lib/quantEngine/LiveOrderBlockExecutionEngine';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';

console.log("=== [TEST SUITE] Dual Strategy Independent Auto-Execution Control Panel ===");

// ── Mock localStorage in Node.js environment ────────────────────────────────
const mockStorage: Record<string, string> = {};
(global as any).window = {
  dispatchEvent: (event: any) => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};
(global as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => { mockStorage[key] = val; },
  removeItem: (key: string) => { delete mockStorage[key]; },
};

// ── TEST 1: Independent State Persistence & Decoupled Toggles ───────────────
console.log("\n[TEST 1] Testing Independent State Storage & Persistence...");

// Initial defaults should be true
console.log(`- Default OB Auto-Exec: ${getOrderBlockAutoExec()} (Expected: true)`);
console.log(`- Default SR Auto-Exec: ${getSweepReclaimAutoExec()} (Expected: true)`);

if (!getOrderBlockAutoExec() || !getSweepReclaimAutoExec()) {
  console.error("❌ FAIL: Default auto-execution states must be true.");
  process.exit(1);
}

// Toggle OB OFF, keep SR ON
setOrderBlockAutoExec(false);
console.log(`- Toggled OB OFF -> OB: ${getOrderBlockAutoExec()}, SR: ${getSweepReclaimAutoExec()}`);

if (getOrderBlockAutoExec() !== false || getSweepReclaimAutoExec() !== true) {
  console.error("❌ FAIL: OB toggle changed SR state incorrectly.");
  process.exit(1);
}

// Toggle SR OFF, toggle OB ON
setSweepReclaimAutoExec(false);
setOrderBlockAutoExec(true);
console.log(`- Toggled SR OFF, OB ON -> OB: ${getOrderBlockAutoExec()}, SR: ${getSweepReclaimAutoExec()}`);

if (getOrderBlockAutoExec() !== true || getSweepReclaimAutoExec() !== false) {
  console.error("❌ FAIL: Decoupled toggles state mismatch.");
  process.exit(1);
}

console.log("✅ TEST 1 PASSED: Independent state persistence verified.");

// ── TEST 2: Order Block Engine Auto-Execution Bypass ─────────────────────────
console.log("\n[TEST 2] Testing Order Block Execution Bypass when Disabled...");

const obEngineDisabled = new LiveOrderBlockExecutionEngine({
  autoExecute: false, // Order Block Auto-Exec OFF
  requireInZoneConfirmation: false,
});

// Seed mock candles to produce an order block
const baseTime = Date.now() - 3600000;
const mock5mCandles = [
  { t: baseTime, o: 3000, h: 3010, l: 2995, c: 3005, v: 1000, taker_buy_vol: 500, taker_sell_vol: 500, isClosed: true },
  { t: baseTime + 300000, o: 3005, h: 3008, l: 2980, c: 2985, v: 3000, taker_buy_vol: 800, taker_sell_vol: 2200, isClosed: true }, // Sweep candle
  { t: baseTime + 600000, o: 2985, h: 3030, l: 2984, c: 3025, v: 4000, taker_buy_vol: 3200, taker_sell_vol: 800, isClosed: true }, // Displacement
];

obEngineDisabled.onMultiTimeframeCandles({ '5m': mock5mCandles });
const zones = obEngineDisabled.getActiveZones('5m');
console.log(`- Active Zones detected in OB engine: ${zones.length}`);

// Send price tick touching the zone
const tickResDisabled = obEngineDisabled.onPriceTick(2990, Date.now());
console.log(`- Active Positions when OB Auto-Exec is OFF: ${tickResDisabled.activePositions.length}`);

if (tickResDisabled.activePositions.length !== 0) {
  console.error("❌ FAIL: Order Block engine must NOT open positions when autoExecute is false.");
  process.exit(1);
}

console.log("✅ TEST 2 PASSED: Order Block auto-execution bypass verified.");

// ── TEST 3: Sweep & Reclaim Engine Auto-Execution Bypass ─────────────────────
console.log("\n[TEST 3] Testing Sweep & Reclaim Execution Bypass when Disabled...");

const srEngineDisabled = new AutomatedStrategyExecutionEngine({
  autoExecute: false, // Sweep & Reclaim Auto-Exec OFF
  compoundingRiskPct: 2.0,
});

const submitResDisabled = srEngineDisabled.submitStrategyOrder({
  strategyId: 'SR_TEST_1',
  strategyName: 'Sweep & Reclaim 3-Pillar',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'LONG',
  limitEntryPrice: 3000,
  stopLossPrice: 2980,
  activeEquity: 10000,
});

console.log(`- Submission result when SR Auto-Exec is OFF: success = ${submitResDisabled.success}, message = "${submitResDisabled.message}"`);

if (submitResDisabled.success !== false) {
  console.error("❌ FAIL: Sweep & Reclaim engine must reject order submission when autoExecute is false.");
  process.exit(1);
}

// Now enable SR engine
const srEngineEnabled = new AutomatedStrategyExecutionEngine({
  autoExecute: true, // Sweep & Reclaim Auto-Exec ON
  compoundingRiskPct: 2.0,
});

const submitResEnabled = srEngineEnabled.submitStrategyOrder({
  strategyId: 'SR_TEST_2',
  strategyName: 'Sweep & Reclaim 3-Pillar',
  symbol: 'ETHUSDC',
  timeframe: '15m',
  direction: 'LONG',
  limitEntryPrice: 3000,
  stopLossPrice: 2980,
  activeEquity: 10000,
});

console.log(`- Submission result when SR Auto-Exec is ON: success = ${submitResEnabled.success}, position = ${submitResEnabled.position?.id}`);

if (submitResEnabled.success !== true || !submitResEnabled.position) {
  console.error("❌ FAIL: Sweep & Reclaim engine must accept order when autoExecute is true.");
  process.exit(1);
}

console.log("✅ TEST 3 PASSED: Sweep & Reclaim auto-execution bypass verified.");

console.log("\n=========================================================================");
console.log("🎉 ALL DUAL STRATEGY INDEPENDENT AUTO-EXECUTION TESTS PASSED (100%)!");
console.log("=========================================================================");
