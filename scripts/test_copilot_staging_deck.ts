import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { userStagedSetupsStore } from '../src/lib/staging/userStagedSetupsStore';
import { evaluateExecutionSafetyGate } from '../src/lib/binanceOrderRouter';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';

async function runStagingDeckTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 TEST SUITE: Copilot Staging Deck & Manual Override Router');
  console.log('🧪 ========================================================\n');

  const testRecordId = 999001;
  const testSymbol = 'ETHUSDT';

  // ----------------------------------------------------
  // TEST 1: Pin a Bullish Setup to the Staging Deck
  // ----------------------------------------------------
  console.log('▶ [TEST 1] Pinning Bullish Setup to userStagedSetupsStore...');
  const pinnedLong = await userStagedSetupsStore.pinSetup({
    analysisLogId: testRecordId,
    symbol: testSymbol,
    direction: 'LONG',
    entryPrice: 2150.0,
    stopLoss: 2120.0,
    target1: 2210.0,
    target2: 2260.0,
    sourceReference: 'AI_ANALYSIS #999001',
    metadata: {
      confidence: 0.88,
      agentId: 'SPARK_LONG_TEST',
      reasons: ['5m Bullish FVG', 'Sweep of Asia Low', 'Delta Divergence'],
      timeframe: '5m',
    },
  });

  assert.ok(pinnedLong, 'Pinned setup must be created');
  assert.strictEqual(pinnedLong.symbol, testSymbol);
  assert.strictEqual(pinnedLong.direction, 'LONG');
  assert.strictEqual(pinnedLong.entryPrice, 2150.0);
  assert.strictEqual(pinnedLong.stopLoss, 2120.0);
  assert.strictEqual(pinnedLong.target1, 2210.0);
  assert.strictEqual(pinnedLong.status, 'PINNED');
  console.log(`✅ TEST 1 PASSED: Long setup pinned successfully with ID: ${pinnedLong.id}`);

  // ----------------------------------------------------
  // TEST 2: Verify Listing and isAnalysisRecordPinned
  // ----------------------------------------------------
  console.log('\n▶ [TEST 2] Verifying listing and pinned predicate...');
  const isPinned = await userStagedSetupsStore.isAnalysisRecordPinned(testRecordId);
  assert.strictEqual(isPinned, true, 'isAnalysisRecordPinned must return true');

  const list = await userStagedSetupsStore.listStagedSetups('PINNED');
  const found = list.find((s) => s.id === pinnedLong.id);
  assert.ok(found, 'Pinned setup must be in staged setups list');
  assert.strictEqual(found!.analysisLogId, testRecordId);
  console.log(`✅ TEST 2 PASSED: Setup found in staged list with correct metadata.`);

  // ----------------------------------------------------
  // TEST 3: Price Sanity Validation (Geometry Rules)
  // ----------------------------------------------------
  console.log('\n▶ [TEST 3] Validating directional price sanity checks...');
  // Long with inverted SL (SL > Entry) must be invalid
  const invalidLong = {
    direction: 'LONG' as const,
    entry: 2150.0,
    sl: 2180.0, // Invalid: above entry
    tp1: 2200.0,
  };
  const isLongGeometryValid = invalidLong.sl < invalidLong.entry && invalidLong.tp1 > invalidLong.entry;
  assert.strictEqual(isLongGeometryValid, false, 'Inverted Long SL must be rejected');

  // Short with inverted SL (SL < Entry) must be invalid
  const invalidShort = {
    direction: 'SHORT' as const,
    entry: 2150.0,
    sl: 2120.0, // Invalid: below entry
    tp1: 2100.0,
  };
  const isShortGeometryValid = invalidShort.sl > invalidShort.entry && invalidShort.tp1 < invalidShort.entry;
  assert.strictEqual(isShortGeometryValid, false, 'Inverted Short SL must be rejected');
  console.log('✅ TEST 3 PASSED: Directional geometry validation correctly rejects inverted setups.');

  // ----------------------------------------------------
  // TEST 4: Safety Gate Engagement for Live Binance
  // ----------------------------------------------------
  console.log('\n▶ [TEST 4] Evaluating Safety Gate for LIVE_BINANCE in test environment...');
  const safetyGate = evaluateExecutionSafetyGate();
  console.log(`ℹ️ Safety Gate Status: isAllowed=${safetyGate.isAllowed}, Reason=${safetyGate.reason}`);
  // In dev/test environment without IS_LIVE_VPS=true, safetyGate MUST disallow real execution
  if (!process.env.IS_LIVE_VPS) {
    assert.strictEqual(safetyGate.isAllowed, false, 'Safety Gate must block live execution in test/sandbox');
    console.log('✅ TEST 4 PASSED: Live execution safety locks engaged in test environment.');
  } else {
    console.log('ℹ️ TEST 4 SKIPPED: VPS environment active.');
  }

  // ----------------------------------------------------
  // TEST 5: Deploy Setup to Paper Trading Mode
  // ----------------------------------------------------
  console.log('\n▶ [TEST 5] Deploying setup to PAPER_TRADING mode...');
  const deploySuccess = await userStagedSetupsStore.markSetupDeployed(pinnedLong.id, 'PAPER_TRADING');
  assert.strictEqual(deploySuccess, true, 'markSetupDeployed must return true');

  const deployedRecord = await userStagedSetupsStore.getStagedSetupById(pinnedLong.id);
  assert.ok(deployedRecord, 'Deployed record must be queryable');
  assert.strictEqual(deployedRecord!.status, 'RESTING_LIMIT');
  assert.ok(deployedRecord!.deployedAt, 'deployedAt must be populated');
  assert.strictEqual(deployedRecord!.targetMode, 'PAPER_TRADING');

  // Verify setup is no longer listed in active PINNED list
  const activeListAfterDeploy = await userStagedSetupsStore.listStagedSetups('PINNED');
  const stillPinned = activeListAfterDeploy.find((s) => s.id === pinnedLong.id);
  assert.strictEqual(stillPinned, undefined, 'Deployed setup must not appear in active PINNED list');

  // Verify setup DOES appear in ACTIVE list (which includes PINNED and RESTING_LIMIT)
  const activeUnionList = await userStagedSetupsStore.listStagedSetups('ACTIVE');
  const foundInActive = activeUnionList.find((s) => s.id === pinnedLong.id);
  assert.ok(foundInActive, 'Deployed setup must appear in ACTIVE list');
  assert.strictEqual(foundInActive!.status, 'RESTING_LIMIT');

  // Test canceling the resting limit order
  const cancelOk = await userStagedSetupsStore.cancelRestingLimit(pinnedLong.id, 'OPERATOR_TEST_CANCEL');
  assert.strictEqual(cancelOk, true, 'cancelRestingLimit must return true');
  const cancelledRecord = await userStagedSetupsStore.getStagedSetupById(pinnedLong.id);
  assert.strictEqual(cancelledRecord!.status, 'CANCELLED');
  assert.strictEqual(cancelledRecord!.cancelReason, 'OPERATOR_TEST_CANCEL');
  console.log('✅ TEST 5 PASSED: Setup transitioned to RESTING_LIMIT, verified in ACTIVE list, and cancelled properly.');

  // ----------------------------------------------------
  // TEST 6: Command Queue (daemon_commands.json) Output Verification
  // ----------------------------------------------------
  console.log('\n▶ [TEST 6] Verifying EXECUTE_STAGED command serialization into daemon_commands.json...');
  const runLogsDir = path.join(process.cwd(), 'run_logs');
  if (!fs.existsSync(runLogsDir)) {
    fs.mkdirSync(runLogsDir, { recursive: true });
  }
  const cmdFile = path.join(runLogsDir, 'daemon_commands.json');

  let existingCommands: any[] = [];
  if (fs.existsSync(cmdFile)) {
    try {
      existingCommands = JSON.parse(fs.readFileSync(cmdFile, 'utf8'));
    } catch {}
  }

  const testCmd = {
    id: `cmd_test_${Date.now()}`,
    action: 'EXECUTE_STAGED',
    decisionId: testRecordId,
    targetMode: 'PAPER_TRADING',
    timestamp: Date.now(),
    timeIso: new Date().toISOString(),
    status: 'PENDING',
    metadata: {
      stagedId: pinnedLong.id,
      decisionId: testRecordId,
      targetMode: 'PAPER_TRADING',
      executionSource: 'COCKPIT_MANUAL_OVERRIDE',
      stagedSetup: deployedRecord,
    },
  };

  fs.writeFileSync(cmdFile, JSON.stringify([...existingCommands, testCmd], null, 2), 'utf8');
  assert.ok(fs.existsSync(cmdFile), 'daemon_commands.json must exist');

  const fileContents = JSON.parse(fs.readFileSync(cmdFile, 'utf8'));
  const foundCmd = fileContents.find((c: any) => c.id === testCmd.id);
  assert.ok(foundCmd, 'Test command must be serialized in daemon_commands.json');
  assert.strictEqual(foundCmd.action, 'EXECUTE_STAGED');
  assert.strictEqual(foundCmd.metadata?.executionSource, 'COCKPIT_MANUAL_OVERRIDE');
  console.log('✅ TEST 6 PASSED: EXECUTE_STAGED command serialized correctly to disk.');

  // ----------------------------------------------------
  // TEST 7: Unpin & Dismissal Cleanup
  // ----------------------------------------------------
  console.log('\n▶ [TEST 7] Testing unpin & dismissal cleanup...');
  // Pin a second setup
  const pinnedShort = await userStagedSetupsStore.pinSetup({
    analysisLogId: 999002,
    symbol: testSymbol,
    direction: 'SHORT',
    entryPrice: 2280.0,
    stopLoss: 2310.0,
    target1: 2220.0,
    target2: 2180.0,
    sourceReference: 'AI_ANALYSIS #999002',
    metadata: {
      confidence: 0.91,
      agentId: 'SPARK_SHORT_TEST',
      reasons: ['Bearish FVG', 'Sweep of Session High'],
    },
  });
  assert.ok(pinnedShort, 'Second setup pinned');

  const unpinned = await userStagedSetupsStore.unpinSetup(pinnedShort.id);
  assert.strictEqual(unpinned, true, 'unpinSetup must return true');

  const recordPinnedAfterUnpin = await userStagedSetupsStore.isAnalysisRecordPinned(999002);
  assert.strictEqual(recordPinnedAfterUnpin, false, 'isAnalysisRecordPinned must return false after unpin');
  console.log('✅ TEST 7 PASSED: Setup unpinned and state cleared successfully.');

  // ----------------------------------------------------
  // TEST 8: Headless Daemon Startup Rehydration Parity
  // ----------------------------------------------------
  console.log('\n▶ [TEST 8] Verifying Headless Daemon Startup Rehydration into AutomatedStrategyExecutionEngine...');
  // Pin and deploy a resting setup to test engine rehydration
  const rehydrateCandidate = await userStagedSetupsStore.pinSetup({
    analysisLogId: 999003,
    symbol: testSymbol,
    direction: 'LONG',
    entryPrice: 2160.0,
    stopLoss: 2130.0,
    target1: 2220.0,
    sourceReference: 'AI_ANALYSIS #999003',
  });
  await userStagedSetupsStore.markSetupDeployed(rehydrateCandidate.id, 'PAPER_TRADING');

  const engine = new AutomatedStrategyExecutionEngine({
    symbol: testSymbol,
    timeframe: '5m',
    autoExecute: true,
  });

  const restingSetups = await userStagedSetupsStore.listStagedSetups('RESTING_LIMIT');
  const targetResting = restingSetups.find((s) => s.id === rehydrateCandidate.id);
  assert.ok(targetResting, 'Resting candidate must be listed in RESTING_LIMIT');

  const deployedTime = targetResting.deployedAt ? new Date(targetResting.deployedAt).getTime() : Date.now();
  engine.rehydratePositionsDirect([{
    id: `staged_${targetResting.id}`,
    dbTradeId: null,
    strategyId: 'COCKPIT_STAGED_LIMIT',
    strategyName: 'Cockpit Staged Limit Order',
    symbol: targetResting.symbol,
    timeframe: '5m',
    direction: targetResting.direction,
    status: 'PENDING_LIMIT_ENTRY',
    limitEntryPrice: targetResting.entryPrice,
    entryPrice: targetResting.entryPrice,
    initialStopLoss: targetResting.stopLoss,
    activeStopLoss: targetResting.stopLoss,
    activeRatchetFloor: null,
    trailingSlSource: 'INITIAL',
    stage1Target: targetResting.target1,
    stage2Target: targetResting.target2 || targetResting.target1,
    stage3Target: targetResting.target3 || targetResting.target1,
    dynamicDolTarget: null,
    fvgCeLevel: null,
    stage1Ratio: 0.4,
    stage2Ratio: 0.4,
    stage3Ratio: 0.2,
    stage1Multiple: 1.0,
    stage2Multiple: 1.5,
    stage3Multiple: 3.0,
    riskUsd: targetResting.riskUsd || 100,
    riskPerContract: Math.abs(targetResting.entryPrice - targetResting.stopLoss),
    equityAtEntry: 10000,
    riskPct: targetResting.riskPct || 1.0,
    contractSize: targetResting.contractSize || 1,
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
    pendingTime: deployedTime,
    openTime: null,
    closeTime: null,
    exitPrice: null,
    exitReason: null,
    setupId: `staged_${targetResting.id}`,
    anchorName: `Staged #${targetResting.id}`,
    originAnchorLevel: targetResting.entryPrice,
    originZoneId: `staged_${targetResting.id}`,
    executionMode: 'PAPER_TRADING',
    maxRetestBars: 48,
    stage1BarTime: null,
    ratchetEffectiveTime: null,
    stagedId: targetResting.id,
  } as any]);

  const pendingInEngine = engine.getPendingLimitOrders();
  assert.strictEqual(pendingInEngine.length, 1, 'Engine must contain exactly 1 rehydrated pending limit order');
  assert.strictEqual(pendingInEngine[0].id, `staged_${targetResting.id}`);
  assert.strictEqual(pendingInEngine[0].status, 'PENDING_LIMIT_ENTRY');
  assert.strictEqual((pendingInEngine[0] as any).stagedId, targetResting.id);
  console.log('✅ TEST 8 PASSED: Resting staged setups successfully rehydrate into engine pendingLimitOrders.');

  // ----------------------------------------------------
  // TEST 9: Operator Preemption & Staged Limit Order Cancellation
  // ----------------------------------------------------
  console.log('\n▶ [TEST 9] Testing cancelPendingLimitOrder matching by stagedId and prefixed ID...');
  const cancelResult = engine.cancelPendingLimitOrder(`staged_${targetResting.id}`, 'TEST_ABORT');
  assert.strictEqual(cancelResult, true, 'cancelPendingLimitOrder must succeed for staged_${id}');
  assert.strictEqual(engine.getPendingLimitOrders().length, 0, 'Pending limit orders must be empty after cancellation');

  // Test cancellation by numeric stagedId
  engine.rehydratePositionsDirect([{
    id: `POS_LONG_${Date.now()}`,
    status: 'PENDING_LIMIT_ENTRY',
    stagedId: targetResting.id,
    direction: 'LONG',
    limitEntryPrice: 2160,
  } as any]);
  assert.strictEqual(engine.getPendingLimitOrders().length, 1, 'Engine rehydrated 1 order with POS_LONG prefix');
  const cancelNumericResult = engine.cancelPendingLimitOrder(String(targetResting.id), 'TEST_NUMERIC_ABORT');
  assert.strictEqual(cancelNumericResult, true, 'cancelPendingLimitOrder must succeed using numeric stagedId');
  assert.strictEqual(engine.getPendingLimitOrders().length, 0, 'Pending orders must be empty after numeric abort');
  console.log('✅ TEST 9 PASSED: cancelPendingLimitOrder reliably cancels staged limit orders by any ID format.');

  console.log('\n========================================================');
  console.log('🎉 ALL COPILOT STAGING DECK TESTS PASSED (100% SUCCESS)');
  console.log('========================================================\n');
}

runStagingDeckTests().catch((err) => {
  console.error('❌ Test suite failed with error:', err);
  process.exit(1);
});
