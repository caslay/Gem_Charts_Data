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

  // Clean up test setup
  await userStagedSetupsStore.unpinSetup(pinned.id);
  const unpinned = await userStagedSetupsStore.getStagedSetupById(pinned.id);
  assert(unpinned?.status === 'DISMISSED', 'Setup successfully dismissed');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
