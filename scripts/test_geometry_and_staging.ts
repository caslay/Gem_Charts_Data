import {
  resolveAndValidateSetupGeometry,
  userStagedSetupsStore,
} from '../src/lib/staging/userStagedSetupsStore';

async function runTests() {
  console.log('🧪 Starting Geometry Validation & Staging Parity Tests...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // Test 1: Standard LONG
  const longResult = resolveAndValidateSetupGeometry({
    direction: 'LONG',
    entryPrice: 2400,
    stopLoss: 2380,
    target1: 2450,
  });
  assert(longResult.isValid === true, 'Standard LONG is valid');
  assert(longResult.resolvedDirection === 'LONG', 'Standard LONG direction is LONG');
  assert(!longResult.wasDirectionCorrected, 'Standard LONG was not direction-corrected');
  assert(longResult.riskRewardRatio === 2.5, 'Standard LONG R:R is 2.5');

  // Test 2: Standard SHORT
  const shortResult = resolveAndValidateSetupGeometry({
    direction: 'SHORT',
    entryPrice: 2400,
    stopLoss: 2420,
    target1: 2350,
  });
  assert(shortResult.isValid === true, 'Standard SHORT is valid');
  assert(shortResult.resolvedDirection === 'SHORT', 'Standard SHORT direction is SHORT');
  assert(!shortResult.wasDirectionCorrected, 'Standard SHORT was not direction-corrected');
  assert(shortResult.riskRewardRatio === 2.5, 'Standard SHORT R:R is 2.5');

  // Test 3: Setup #267 Mislabeled LONG -> Auto-corrects to SHORT
  // (Setup #267 had: Entry: 2446.17, SL: 2456.49, TP1: 2429.31)
  const setup267Result = resolveAndValidateSetupGeometry({
    direction: 'LONG',
    entryPrice: 2446.17,
    stopLoss: 2456.49,
    target1: 2429.31,
    target2: 2415.00,
  });
  assert(setup267Result.isValid === true, 'Setup #267 geometry is physically valid');
  assert(setup267Result.resolvedDirection === 'SHORT', 'Setup #267 auto-corrected from LONG to SHORT');
  assert(setup267Result.wasDirectionCorrected === true, 'wasDirectionCorrected flag is true');
  assert(setup267Result.target2 === 2415.00, 'TP2 preserved as valid for SHORT');

  // Test 4: Mislabeled SHORT -> Auto-corrects to LONG
  const mislabeledShort = resolveAndValidateSetupGeometry({
    direction: 'SHORT',
    entryPrice: 2400,
    stopLoss: 2350,
    target1: 2500,
  });
  assert(mislabeledShort.isValid === true, 'Mislabeled SHORT is valid');
  assert(mislabeledShort.resolvedDirection === 'LONG', 'Auto-corrected from SHORT to LONG');
  assert(mislabeledShort.wasDirectionCorrected === true, 'wasDirectionCorrected flag is true');

  // Test 5: Corrupt Setup: Both SL and TP above Entry
  const corruptAbove = resolveAndValidateSetupGeometry({
    direction: 'LONG',
    entryPrice: 2400,
    stopLoss: 2420,
    target1: 2450,
  });
  assert(corruptAbove.isValid === false, 'Corrupt setup (SL & TP both above Entry) is rejected');
  assert(corruptAbove.error !== undefined, 'Corrupt setup returns clear error explanation');

  // Test 6: Corrupt Setup: Both SL and TP below Entry
  const corruptBelow = resolveAndValidateSetupGeometry({
    direction: 'SHORT',
    entryPrice: 2400,
    stopLoss: 2380,
    target1: 2350,
  });
  assert(corruptBelow.isValid === false, 'Corrupt setup (SL & TP both below Entry) is rejected');

  // Test 7: Discard Inverted TP2 / TP3
  const invertedTP2 = resolveAndValidateSetupGeometry({
    direction: 'SHORT',
    entryPrice: 2400,
    stopLoss: 2420,
    target1: 2350,
    target2: 2500, // Inverted! Above entry on a short!
  });
  assert(invertedTP2.isValid === true, 'Inverted TP2 setup is valid');
  assert(invertedTP2.target2 === null, 'Inverted TP2 discarded to protect trader safety');

  // Test 8: Staging Store Pinning with Auto-Correction
  console.log('\nTesting Store Pinning...');
  const pinned = await userStagedSetupsStore.pinSetup({
    symbol: 'ETHUSDC',
    direction: 'LONG', // Deliberately mislabeled
    entryPrice: 2446.17,
    stopLoss: 2456.49,
    target1: 2429.31,
    sourceReference: 'TEST #267 PARITY',
    notes: 'Testing auto-correction on pin',
  });
  assert(pinned.direction === 'SHORT', 'Stored setup #id ' + pinned.id + ' resolved direction to SHORT');
  assert(pinned.entryPrice === 2446.17, 'Entry price preserved');
  assert(pinned.stopLoss === 2456.49, 'Stop loss preserved');

  // Test 9: Get By ID
  const retrieved = await userStagedSetupsStore.getStagedSetupById(pinned.id);
  assert(retrieved !== null, 'Retrieved pinned setup by ID');
  assert(retrieved?.direction === 'SHORT', 'Retrieved setup direction is SHORT');

  // Test 10: Monotonic Target Sorting (Ascending for LONG, Descending for SHORT)
  console.log('\nTesting Monotonic Target Sorting...');
  const outOfOrderLong = resolveAndValidateSetupGeometry({
    direction: 'LONG',
    entryPrice: 2000,
    stopLoss: 1950,
    target1: 2200, // Was put as TP1
    target2: 2050, // Closer milestone, should become TP1
    target3: 2100, // Should become TP2
  });
  assert(outOfOrderLong.isValid === true, 'Out of order Long targets are valid');
  assert(outOfOrderLong.target1 === 2050, 'Target 1 sorted to closest milestone (2050)');
  assert(outOfOrderLong.target2 === 2100, 'Target 2 sorted to next milestone (2100)');
  assert(outOfOrderLong.target3 === 2200, 'Target 3 sorted to farthest milestone (2200)');

  const outOfOrderShort = resolveAndValidateSetupGeometry({
    direction: 'SHORT',
    entryPrice: 2000,
    stopLoss: 2050,
    target1: 1800, // Was put as TP1
    target2: 1950, // Closer milestone, should become TP1
    target3: 1900, // Should become TP2
  });
  assert(outOfOrderShort.isValid === true, 'Out of order Short targets are valid');
  assert(outOfOrderShort.target1 === 1950, 'Short Target 1 sorted to closest milestone (1950)');
  assert(outOfOrderShort.target2 === 1900, 'Short Target 2 sorted to next milestone (1900)');
  assert(outOfOrderShort.target3 === 1800, 'Short Target 3 sorted to farthest milestone (1800)');

  // Test 11: Staging Lifecycle: RESTING_LIMIT -> EXPIRED
  console.log('\nTesting Resting Limit Expiry Lifecycle...');
  const restingToExpire = await userStagedSetupsStore.pinSetup({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2000,
    stopLoss: 1980,
    target1: 2050,
    sourceReference: 'TEST_EXPIRY_LIFECYCLE',
  });
  await userStagedSetupsStore.markSetupRestingLimit(restingToExpire.id, 'PAPER_TRADING');
  let restingRec = await userStagedSetupsStore.getStagedSetupById(restingToExpire.id);
  assert(restingRec?.status === 'RESTING_LIMIT', 'Setup transitioned to RESTING_LIMIT');
  assert(restingRec?.targetMode === 'PAPER_TRADING', 'targetMode recorded as PAPER_TRADING');

  const expireOk = await userStagedSetupsStore.expireRestingLimit(restingToExpire.id, 48);
  assert(expireOk === true, 'expireRestingLimit succeeded');
  restingRec = await userStagedSetupsStore.getStagedSetupById(restingToExpire.id);
  assert(restingRec?.status === 'EXPIRED', 'Setup status updated to EXPIRED');
  assert(restingRec?.expiredAt !== undefined, 'expiredAt timestamp populated');

  // Test 12: Staging Lifecycle: RESTING_LIMIT -> FILLED
  console.log('\nTesting Resting Limit Fill Lifecycle...');
  const restingToFill = await userStagedSetupsStore.pinSetup({
    symbol: 'ETHUSDC',
    direction: 'SHORT',
    entryPrice: 2000,
    stopLoss: 2020,
    target1: 1950,
    sourceReference: 'TEST_FILL_LIFECYCLE',
  });
  await userStagedSetupsStore.markSetupRestingLimit(restingToFill.id, 'LIVE_BINANCE');
  const fillOk = await userStagedSetupsStore.markSetupFilled(restingToFill.id, { fillPrice: 2000 });
  assert(fillOk === true, 'markSetupFilled succeeded');
  const filledRec = await userStagedSetupsStore.getStagedSetupById(restingToFill.id);
  assert(filledRec?.status === 'FILLED', 'Setup status updated to FILLED');
  assert(filledRec?.filledAt !== undefined, 'filledAt timestamp populated');

  // Test 13: Query getRestingLimitSetups
  const restingList = await userStagedSetupsStore.getRestingLimitSetups();
  assert(Array.isArray(restingList), 'getRestingLimitSetups returns array');
  const hasExpiredOrFilled = restingList.some((s) => s.id === restingToExpire.id || s.id === restingToFill.id);
  assert(!hasExpiredOrFilled, 'getRestingLimitSetups excludes EXPIRED and FILLED setups');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
