/**
 * test_alert_cadence_governor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification Test Suite for Phase 2: Alert Cadence Governor & Spatial Hysteresis
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { AlertCadenceGovernor } from '../src/lib/notifications/AlertCadenceGovernor';

async function runTests() {
  console.log('🧪 Starting Phase 2: Alert Cadence Governor & Spatial Hysteresis Verification...\n');
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

  const governor = new AlertCadenceGovernor({
    temporalCooldownMs: 15 * 60 * 1000, // 15 mins
    spatialTolerancePct: 0.0005, // 0.05%
    leakyBucketIntervalMs: 50, // fast drain for automated test execution
  });

  const now = Date.now();

  // ── Test 1: First signal allowed ──
  console.log('1. First Signal Authorization:');
  const check1 = governor.isAllowed('SIGNAL_RECEIVED', {
    symbol: 'ETHUSDC',
    direction: 'LONG',
    limitEntryPrice: 2400,
  }, now);
  assert(check1.allowed === true, `First SIGNAL_RECEIVED is allowed`);

  // Register dispatch
  governor.registerAlertDispatched('ETHUSDC', 'LONG', now);

  // ── Test 2: Rapid burst signal (2 minutes later) suppressed by temporal cooldown ──
  console.log('\n2. Rapid Burst Suppression (Temporal Cooldown):');
  const check2 = governor.isAllowed('SIGNAL_RECEIVED', {
    symbol: 'ETHUSDC',
    direction: 'LONG',
    limitEntryPrice: 2410,
  }, now + 2 * 60 * 1000);
  assert(check2.allowed === false, `Rapid burst signal after 2 minutes is SUPPRESSED (${check2.reason})`);

  // Different direction (SHORT) should be allowed
  const checkShort = governor.isAllowed('SIGNAL_RECEIVED', {
    symbol: 'ETHUSDC',
    direction: 'SHORT',
    limitEntryPrice: 2450,
  }, now + 2 * 60 * 1000);
  assert(checkShort.allowed === true, `Opposing direction (SHORT) is not blocked by LONG cooldown`);

  // Signal after 16 minutes should be allowed
  const check3 = governor.isAllowed('SIGNAL_RECEIVED', {
    symbol: 'ETHUSDC',
    direction: 'LONG',
    limitEntryPrice: 2420,
  }, now + 16 * 60 * 1000);
  assert(check3.allowed === true, `Signal after 16 minutes (> 15m cooldown) is ALLOWED`);

  // ── Test 3: Spatial Hysteresis Guard ──
  console.log('\n3. Spatial Hysteresis Guard:');
  governor.reset();
  // Register active POI zone [2400, 2410]
  governor.registerActivePoiZone('ETHUSDC', 'LONG', 2400, 2410, now);

  // Price hovering inside active zone (2405)
  const insideCheck = governor.isAllowed('SIGNAL_RECEIVED', {
    symbol: 'ETHUSDC',
    direction: 'LONG',
    limitEntryPrice: 2405,
  }, now);
  assert(insideCheck.allowed === false, `Price $2405 inside active POI [2400, 2410] is SUPPRESSED by spatial hysteresis`);

  // Price hovering within 0.05% tolerance (2410 + 2405*0.0005 = ~2411.2)
  const nearEdgeCheck = governor.isAllowed('SIGNAL_RECEIVED', {
    symbol: 'ETHUSDC',
    direction: 'LONG',
    limitEntryPrice: 2411.0,
  }, now);
  assert(nearEdgeCheck.allowed === false, `Price $2411 inside ±0.05% tolerance band is SUPPRESSED by spatial hysteresis`);

  // Price well outside active zone (2450)
  const outsideCheck = governor.isAllowed('SIGNAL_RECEIVED', {
    symbol: 'ETHUSDC',
    direction: 'LONG',
    limitEntryPrice: 2450,
  }, now);
  assert(outsideCheck.allowed === true, `Price $2450 outside POI band is ALLOWED`);

  // ── Test 4: Lifecycle progression events bypass cadence limits ──
  console.log('\n4. Lifecycle Progression Bypass:');
  governor.registerAlertDispatched('ETHUSDC', 'LONG', now);
  const fillCheck = governor.isAllowed('ORDER_FILLED', { symbol: 'ETHUSDC', direction: 'LONG' }, now + 60 * 1000);
  const ratchetCheck = governor.isAllowed('STAGE_1_HARVEST', { symbol: 'ETHUSDC', direction: 'LONG' }, now + 120 * 1000);
  assert(fillCheck.allowed === true, `ORDER_FILLED bypasses signal cadence governor`);
  assert(ratchetCheck.allowed === true, `STAGE_1_HARVEST bypasses signal cadence governor`);

  // ── Test 5: Leaky Bucket Rate Limiter FIFO drain ──
  console.log('\n5. Leaky Bucket Rate Limiter Queue:');
  const executionTimes: number[] = [];
  const p1 = governor.enqueueMessage(async () => {
    executionTimes.push(Date.now());
    return true;
  });
  const p2 = governor.enqueueMessage(async () => {
    executionTimes.push(Date.now());
    return true;
  });
  const p3 = governor.enqueueMessage(async () => {
    executionTimes.push(Date.now());
    return true;
  });

  await Promise.all([p1, p2, p3]);
  assert(executionTimes.length === 3, `All 3 queued messages executed`);
  const delta1 = executionTimes[1] - executionTimes[0];
  const delta2 = executionTimes[2] - executionTimes[1];
  assert(delta1 >= 40, `Spacing between msg 1 & 2 respects leaky bucket interval (got: ${delta1}ms)`);
  assert(delta2 >= 40, `Spacing between msg 2 & 3 respects leaky bucket interval (got: ${delta2}ms)`);

  console.log(`\n=============================================`);
  console.log(`Phase 2 Test Result: ${passed}/${total} assertions passed (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`=============================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
