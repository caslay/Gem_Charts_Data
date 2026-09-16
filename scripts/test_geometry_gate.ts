/**
 * test_geometry_gate.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification Test Suite for Phase 4: Pre-Broadcast Geometry Gate
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { InstitutionalGeometryGate } from '../src/lib/quantEngine/InstitutionalGeometryGate';
import { parseSparkDecision } from '../src/lib/daemon/sparkIngestionDispatcher';

async function runTests() {
  console.log('🧪 Starting Phase 4: Pre-Broadcast Geometry Gate Verification...\n');
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

  // ── Test 1: Sub-1.5R Target 1 is VETOED ──
  console.log('1. Minimum Target 1 R:R Invariant (>= 1.50R):');
  // Long setup: Entry = 2400, SL = 2390 (Risk = 10 USD)
  // TP1 = 2413 (Distance = 13 USD = 1.30R) -> Violates 1.50R floor
  // TP2 = 2435 (Distance = 35 USD = 3.50R)
  const v1 = InstitutionalGeometryGate.evaluateGeometry(2400, 2390, 2413, 2435, 'LONG');
  assert(v1.passed === false, `TP1 at 1.30R is VETOED (got: passed=${v1.passed}, reason=${v1.reason})`);
  assert(v1.tp1_rr === 1.3, `tp1_rr recorded as 1.30R`);

  // ── Test 2: Target 1 >= 1.50R and TP2 >= 2.00R is PASSED ──
  console.log('\n2. Compliant Geometry Approval:');
  // Long setup: Entry = 2400, SL = 2390 (Risk = 10 USD)
  // TP1 = 2415 (1.50R), TP2 = 2430 (3.00R)
  const v2 = InstitutionalGeometryGate.evaluateGeometry(2400, 2390, 2415, 2430, 'LONG');
  assert(v2.passed === true, `TP1 at 1.50R and TP2 at 3.00R is PASSED`);
  assert(v2.tp1_rr === 1.5, `tp1_rr is 1.50R`);
  assert(v2.tp2_rr === 3.0, `tp2_rr is 3.00R`);

  // ── Test 3: Sub-2.0R Overall Target 2 is VETOED ──
  console.log('\n3. Minimum Overall Target 2 R:R Invariant (>= 2.00R):');
  // Short setup: Entry = 2500, SL = 2510 (Risk = 10 USD)
  // TP1 = 2485 (1.50R), TP2 = 2482 (Distance = 18 USD = 1.80R)
  const v3 = InstitutionalGeometryGate.evaluateGeometry(2500, 2510, 2485, 2482, 'SHORT');
  assert(v3.passed === false, `TP2 at 1.80R is VETOED despite TP1 being 1.50R (got: ${v3.reason})`);

  // ── Test 4: Directional Polarity Checks ──
  console.log('\n4. Directional Polarity Validation:');
  // Long setup where SL is above entry (inverted)
  const v4 = InstitutionalGeometryGate.evaluateGeometry(2400, 2410, 2420, 2440, 'LONG');
  assert(v4.passed === false, `Inverted Long SL (above entry) is rejected`);

  // Short setup where SL is below entry (inverted)
  const v5 = InstitutionalGeometryGate.evaluateGeometry(2400, 2390, 2380, 2360, 'SHORT');
  assert(v5.passed === false, `Inverted Short SL (below entry) is rejected`);

  // ── Test 5: Target Generator Compliance ──
  console.log('\n5. Compliant Target Generator:');
  const gen = InstitutionalGeometryGate.calculateCompliantTargets(2400, 2390, 'LONG', 1.5, 3.0);
  assert(gen.tp1 === 2415, `Generated TP1 is 2415 (1.50R)`);
  assert(gen.tp2 === 2430, `Generated TP2 is 2430 (3.00R)`);

  // ── Test 6: Dispatcher fallback targets test ──
  console.log('\n6. Spark Dispatcher Fallback Target Parsing:');
  const parsed = parseSparkDecision({
    id: 9999,
    symbol: 'ETHUSDC',
    bias_signal: 'BULLISH_CONTINUATION',
    limit_entry_price: 2400,
    invalidation_level: 2390,
    target_1: null, // missing -> triggers fallback
    target_2: null, // missing -> triggers fallback
  }, 2405);

  assert(parsed.stage1Target !== null, `stage1Target populated by fallback`);
  assert(parsed.stage2Target !== null, `stage2Target populated by fallback`);
  const fbRisk = Math.abs(parsed.limitEntryPrice! - parsed.stopLossPrice!);
  const fbTp1RR = Math.abs(parsed.stage1Target! - parsed.limitEntryPrice!) / fbRisk;
  const fbTp2RR = Math.abs(parsed.stage2Target! - parsed.limitEntryPrice!) / fbRisk;
  assert(parseFloat(fbTp1RR.toFixed(2)) >= 1.5, `Fallback TP1 R:R is >= 1.50R (got: ${fbTp1RR.toFixed(2)}R)`);
  assert(parseFloat(fbTp2RR.toFixed(2)) >= 3.0, `Fallback TP2 R:R is >= 3.00R (got: ${fbTp2RR.toFixed(2)}R)`);

  console.log(`\n=============================================`);
  console.log(`Phase 4 Test Result: ${passed}/${total} assertions passed (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`=============================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
