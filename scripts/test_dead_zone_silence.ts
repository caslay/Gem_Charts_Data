/**
 * test_dead_zone_silence.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification Test Suite for Phase 3: Dead Zone Silence Engine
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { isDeadZone, formatDeadZoneObservationHeartbeat } from '../src/lib/temporalGatekeeper';

async function runTests() {
  console.log('🧪 Starting Phase 3: Dead Zone Silence Engine Verification...\n');
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

  // Helper to create UTC timestamp for specific hour & minute
  function makeUtcTimestamp(hour: number, min: number): number {
    const d = new Date('2026-09-16T00:00:00.000Z');
    d.setUTCHours(hour, min, 0, 0);
    return d.getTime();
  }

  // ── Test 1: NY Lunch Dead Zone (12:00 - 13:30 EST / ~16:00 - 17:30 UTC in EDT) ──
  console.log('1. NY Lunch Dead Zone Gating:');
  // 12:15 PM EST -> ~16:15 UTC EDT
  const nyLunchTs = makeUtcTimestamp(16, 15);
  const nyLunchRes = isDeadZone(nyLunchTs);
  assert(nyLunchRes.isDead === true, `NY Lunch hour is flagged as dead zone (${nyLunchRes.reason})`);
  assert(nyLunchRes.category === 'NY_LUNCH', `Category is NY_LUNCH`);

  // 12:00 PM EST boundary
  const nyLunchStart = makeUtcTimestamp(16, 0);
  assert(isDeadZone(nyLunchStart).isDead === true, `NY Lunch exact boundary 12:00 PM EST is flagged dead`);

  // 1:35 PM EST (after lunch) -> ~17:35 UTC EDT
  const postLunchTs = makeUtcTimestamp(17, 35);
  assert(isDeadZone(postLunchTs).isDead === false, `Post-lunch 1:35 PM EST is active session (NOT dead zone)`);

  // ── Test 2: Binance Daily Funding Rollover Freeze (23:50 – 00:10 UTC) ──
  console.log('\n2. Daily Funding Rollover Freeze Gating:');
  const rolloverPreTs = makeUtcTimestamp(23, 55);
  const rolloverPreRes = isDeadZone(rolloverPreTs);
  assert(rolloverPreRes.isDead === true, `23:55 UTC funding rollover is flagged as dead zone`);
  assert(rolloverPreRes.category === 'FUNDING_ROLLOVER', `Category is FUNDING_ROLLOVER`);

  const rolloverPostTs = makeUtcTimestamp(0, 5);
  assert(isDeadZone(rolloverPostTs).isDead === true, `00:05 UTC funding rollover is flagged as dead zone`);

  const safeAsianTs = makeUtcTimestamp(0, 20);
  assert(isDeadZone(safeAsianTs).isDead === false, `00:20 UTC (after rollover) is active session`);

  // ── Test 3: Macroeconomic News Freeze (CPI / PPI 12:10 - 12:50 UTC) ──
  console.log('\n3. Macroeconomic News Freeze Gating:');
  const cpiTs = makeUtcTimestamp(12, 30);
  const cpiRes = isDeadZone(cpiTs);
  assert(cpiRes.isDead === true, `12:30 UTC CPI release is flagged as news freeze (${cpiRes.reason})`);
  assert(cpiRes.category === 'MACRO_NEWS', `Category is MACRO_NEWS`);

  // FOMC 18:00 UTC
  const fomcTs = makeUtcTimestamp(18, 5);
  assert(isDeadZone(fomcTs).isDead === true, `18:05 UTC FOMC window is flagged as news freeze`);

  // ── Test 4: Normal Active Trading Session (e.g. London AM 08:00 UTC) ──
  console.log('\n4. Active Trading Session Liquidity:');
  const londonActiveTs = makeUtcTimestamp(8, 0);
  const londonRes = isDeadZone(londonActiveTs);
  assert(londonRes.isDead === false, `London active session 08:00 UTC is fully authorized`);

  // ── Test 5: Dead Zone Heartbeat Formatting (Quiet observation only, NO sizing/targets/stops) ──
  console.log('\n5. Observation Heartbeat Restrictions:');
  const heartbeatText = formatDeadZoneObservationHeartbeat(nyLunchRes.reason, nyLunchTs);
  assert(heartbeatText.includes('⚪ *[OBSERVATION: DEADZONE_STAND_DOWN]*'), `Heartbeat header contains OBSERVATION tag`);
  assert(heartbeatText.includes('STAND_DOWN'), `Contains STAND_DOWN status`);
  assert(!heartbeatText.includes('Target 1'), `Heartbeat contains NO Target 1`);
  assert(!heartbeatText.includes('Target 2'), `Heartbeat contains NO Target 2`);
  assert(!heartbeatText.includes('Invalidation Stop'), `Heartbeat contains NO Invalidation Stop`);
  assert(!heartbeatText.includes('Risk Sizing'), `Heartbeat contains NO Risk Sizing`);

  console.log(`\n=============================================`);
  console.log(`Phase 3 Test Result: ${passed}/${total} assertions passed (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`=============================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
