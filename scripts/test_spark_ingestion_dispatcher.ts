/**
 * test_spark_ingestion_dispatcher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Test Suite for Phase 1:
 *  1. Autonomous Strategy Scanning Silence / Standby Verification
 *  2. Dedicated Spark Inbound Ingestion Dispatcher Pipeline
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import {
  SparkIngestionDispatcher,
  parseSparkDecision,
  calculateSparkPositionSizing,
} from '../src/lib/daemon/sparkIngestionDispatcher';
import { GlobalRiskGovernor } from '../src/lib/risk/GlobalRiskGovernor';
import { Candle } from '../src/lib/fvgEngine';

// Helper to create synthetic candles for scanning test
function createSyntheticCandles(count: number, basePrice: number = 2500): Candle[] {
  const candles: Candle[] = [];
  const now = Date.now();
  const barMs = 5 * 60 * 1000;
  let p = basePrice;

  for (let i = 0; i < count; i++) {
    const t = now - (count - i) * barMs;
    const o = p;
    const c = p + (i % 2 === 0 ? 3 : -2);
    const h = Math.max(o, c) + 2;
    const l = Math.min(o, c) - 2;
    candles.push({
      t,
      o,
      h,
      l,
      c,
      v: 1000 + (i === count - 2 ? 3000 : 0),
      taker_buy_vol: 600,
      taker_sell_vol: 400,
      isClosed: true,
    });
    p = c;
  }
  return candles;
}

async function runTests() {
  console.log('======================================================================');
  console.log('🧪 TESTING SPARK INBOUND INGESTION DISPATCHER & AUTONOMOUS LOOP SILENCE');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      console.log(` ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(` ❌ FAIL: ${name} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Autonomous Loop Silence / Standby in Execution Engine
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 1] Verifying Autonomous Strategy Scanning Loops are on Standby...');

  const engine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false, // Explicitly on standby
    compoundingRiskPct: 2.0,
    maxOpenPositions: 1,
    filterWeekend: false,
  });

  const candles = createSyntheticCandles(80, 2400);
  const scanRes = engine.onMultiTimeframeCandles({ '5m': candles });

  assert(
    scanRes.executedSetups.length === 0,
    'Zero strategy orders executed from autonomous candle scan when enableAutonomousScan=false'
  );
  assert(
    engine.getPendingLimitOrders().length === 0,
    'Pending limit order queue remains empty after candle closes'
  );

  const tcRes = engine.evaluateTrendContinuation(candles);
  assert(
    tcRes.executed.length === 0,
    'Zero Trend Continuation orders executed from autonomous scan when enableAutonomousScan=false'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Structured Parsing of Spark Decision Records
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 2] Verifying Spark Decision Parsing Logic...');

  const mockRecordBullish = {
    id: 101,
    symbol: 'ETHUSDC',
    agent_id: 'gemini-spark',
    bias_signal: 'CONFIRMED_BULLISH',
    entry_range_low: '2410.00',
    entry_range_high: '2415.00',
    invalidation_level: '2395.00',
    target_1: '2435.00',
    target_2: '2455.00',
    narrative: 'Bullish sweep of Asian Low with displacement.',
    status: 'ACTIVE',
    submitted_at: Date.now(),
  };

  const parsedBull = parseSparkDecision(mockRecordBullish, 2420.0);
  assert(parsedBull.id === 101, 'Parsed ID matches 101');
  assert(parsedBull.direction === 'LONG', 'Resolved direction is LONG');
  assert(parsedBull.limitEntryPrice === 2415.0, 'Limit entry price is proximal high ($2415.00)');
  assert(parsedBull.stopLossPrice === 2395.0, 'Stop loss price matches invalidation ($2395.00)');
  assert(parsedBull.stage1Target === 2435.0, 'Stage 1 target matches $2435.00');
  assert(parsedBull.stage2Target === 2455.0, 'Stage 2 target matches $2455.00');
  assert(!parsedBull.isInvalidatedPriorToQueue, 'Bullish setup is NOT invalidated when price is $2420.00');

  const mockRecordBearish = {
    id: 102,
    symbol: 'ETH',
    agent_id: 'gemini-spark',
    bias_signal: 'CONFIRMED_BEARISH',
    entry_range_low: '2450.00',
    entry_range_high: '2455.00',
    invalidation_level: '2470.00',
    target_1: '2430.00',
    target_2: '2410.00',
    narrative: 'Bearish liquidity sweep above London High.',
    status: 'ACTIVE',
    submitted_at: Date.now(),
  };

  const parsedBear = parseSparkDecision(mockRecordBearish, 2445.0);
  assert(parsedBear.symbol === 'ETHUSDC', 'Normalized symbol to ETHUSDC');
  assert(parsedBear.direction === 'SHORT', 'Resolved direction is SHORT');
  assert(parsedBear.limitEntryPrice === 2450.0, 'Limit entry price is proximal low ($2450.00)');
  assert(parsedBear.stopLossPrice === 2470.0, 'Stop loss price matches invalidation ($2470.00)');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2b: Non-Directional Intent (NEUTRAL / ABORT with targets supplied)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 2b] Verifying Non-Directional Intent Immunity from Target Comparison...');

  const neutralWithTargets = {
    id: 1021,
    symbol: 'ETHUSDC',
    agent_id: 'gemini-spark',
    bias_signal: 'NEUTRAL',
    entry_range_low: '2410.00',
    entry_range_high: '2415.00',
    invalidation_level: '2395.00',
    target_1: '2435.00',
    target_2: '2455.00',
    status: 'ACTIVE',
    submitted_at: Date.now(),
  };
  const parsedNeutral = parseSparkDecision(neutralWithTargets, 2420.0);
  assert(
    parsedNeutral.direction === null,
    'NEUTRAL bias signal strictly yields null direction even when target1 > invalidation'
  );

  const abortWithTargets = {
    ...neutralWithTargets,
    id: 1022,
    bias_signal: 'ABORT',
  };
  const parsedAbort = parseSparkDecision(abortWithTargets, 2420.0);
  assert(
    parsedAbort.direction === null,
    'ABORT bias signal strictly yields null direction even when target1 > invalidation'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2c: Inverted Entry Boundaries & Sanity Clamps
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 2c] Verifying Range Normalization & Inverted Price Clamps...');

  const invertedRangeRecord = {
    ...mockRecordBullish,
    id: 1023,
    entry_range_low: '2415.00', // high passed in low
    entry_range_high: '2410.00', // low passed in high
  };
  const parsedInverted = parseSparkDecision(invertedRangeRecord, 2420.0);
  assert(parsedInverted.entryRangeLow === 2410.0, 'Normalized entryRangeLow correctly');
  assert(parsedInverted.entryRangeHigh === 2415.0, 'Normalized entryRangeHigh correctly');
  assert(parsedInverted.limitEntryPrice === 2415.0, 'Proximal entry matches normalized high');

  // Inverted stop loss for Long (stopLoss >= limitEntryPrice)
  const invertedSlRecord = {
    ...mockRecordBullish,
    id: 1024,
    invalidation_level: '2450.00', // higher than entry!
  };
  const parsedInvertedSl = parseSparkDecision(invertedSlRecord, 2420.0);
  assert(
    parsedInvertedSl.stopLossPrice !== null && parsedInvertedSl.stopLossPrice < (parsedInvertedSl.limitEntryPrice || 0),
    'Inverted stop loss for Long clamped safely below entry price'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Invalidation Pre-Flight Gate (Stand Down if Breached Prior to Queue)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 3] Verifying Invalidation Pre-Flight Gate...');

  // Bullish setup where price has already plunged BELOW invalidation level (2395.00)
  const breachedRecord = {
    ...mockRecordBullish,
    id: 103,
  };
  const livePriceBreached = 2390.0; // below 2395.00
  const parsedBreached = parseSparkDecision(breachedRecord, livePriceBreached);

  assert(
    parsedBreached.isInvalidatedPriorToQueue === true,
    'Identified that price ($2390.00) breached invalidation ($2395.00) prior to queueing'
  );

  const dispatcher = new SparkIngestionDispatcher({
    engine,
    getCurrentPrice: () => livePriceBreached,
    pollIntervalMs: 1000,
    allowOfflineFallback: true,
    executionMode: 'PAPER_TRADING',
  });

  const breachedResult = await dispatcher.processDecision(breachedRecord, livePriceBreached);
  assert(
    breachedResult.status === 'INVALIDATED',
    'Dispatcher marked breached decision as INVALIDATED and stood down'
  );
  assert(
    engine.getPendingLimitOrders().length === 0,
    'No order placed for invalidated setup'
  );

  // Exact touch boundary: livePrice == invalidation_level (2395.00)
  const touchBreachedRecord = {
    ...mockRecordBullish,
    id: 1031,
  };
  const parsedTouch = parseSparkDecision(touchBreachedRecord, 2395.0);
  assert(
    parsedTouch.isInvalidatedPriorToQueue === true,
    'Identified that price touching exact invalidation ($2395.00) is invalidated'
  );

  // Missed Expansion: Target 1 already achieved before queueing
  const missedExpansionRecord = {
    ...mockRecordBullish,
    id: 1032,
    target_1: '2435.00',
  };
  const parsedMissed = parseSparkDecision(missedExpansionRecord, 2440.0); // reached 2440 > 2435
  assert(
    parsedMissed.isInvalidatedPriorToQueue === true,
    'Identified missed expansion when price already reached Target 1 prior to queueing'
  );
  assert(
    parsedMissed.invalidationReason?.includes('Target 1') === true,
    'Invalidation reason correctly identifies Target 1 reached'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Pre-Trade Validation Pipeline Handover & Execution
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 4] Verifying Pre-Trade Validation Pipeline Handover...');

  // Live price at 2420.00 (above entry range [2410, 2415], long limit rests at 2415.00)
  const validLivePrice = 2420.0;
  const validRecord = {
    ...mockRecordBullish,
    id: 104,
  };

  const validResult = await dispatcher.processDecision(validRecord, validLivePrice);
  assert(
    validResult.status === 'PAPER_ACTIVE' || validResult.status === 'EXECUTED',
    'Dispatcher successfully handed setup to pre-trade pipeline and executed pending limit'
  );
  assert(
    engine.getPendingLimitOrders().length === 1,
    'Engine has 1 pending resting limit order in queue'
  );

  const pending = engine.getPendingLimitOrders()[0];
  assert(pending.direction === 'LONG', 'Pending order direction is LONG');
  assert(pending.limitEntryPrice === 2415.0, 'Pending order limit price is $2415.00');
  assert(pending.activeStopLoss === 2395.0, 'Pending order active stop loss is $2395.00');
  assert(pending.strategyId === 'SPARK_104', 'Strategy ID tagged with Spark Decision ID');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Opposing Directional Lock Rejection
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 5] Verifying Guardrail 3 (Directional Conflict) Veto on Opposing Spark Decision...');

  // Submit Bearish decision while Bullish order is pending in queue
  const opposingRecord = {
    ...mockRecordBearish,
    id: 105,
  };
  const opposingResult = await dispatcher.processDecision(opposingRecord, 2445.0);

  assert(
    opposingResult.status === 'REJECTED',
    'Pre-trade validation rejected opposing SHORT decision while LONG order is pending'
  );
  assert(
    opposingResult.reason?.includes('DIRECTIONAL_LOCK') === true,
    'Rejection reason correctly cites DIRECTIONAL_LOCK'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: Non-Directional Stand Down (NEUTRAL / ABORT with targets)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 6] Verifying Non-Directional Stand Down (NEUTRAL / ABORT)...');

  const neutralRecord = {
    id: 106,
    symbol: 'ETHUSDC',
    agent_id: 'gemini-spark',
    bias_signal: 'NEUTRAL',
    target_1: '2450.00',
    invalidation_level: '2400.00',
    narrative: 'Market in tight chop range, no edge.',
    status: 'ACTIVE',
    submitted_at: Date.now(),
  };

  const neutralResult = await dispatcher.processDecision(neutralRecord, 2420.0);
  assert(
    neutralResult.status === 'STAND_DOWN',
    'Dispatcher marked NEUTRAL decision with targets as STAND_DOWN'
  );
  assert(
    engine.getPendingLimitOrders().length === 1,
    'Pending limit order queue unchanged by non-directional stand-down'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7: Cross-Asset Symbol Mismatch Protection Gate
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 7] Verifying Cross-Asset Symbol Mismatch Protection...');

  const btcRecord = {
    id: 107,
    symbol: 'BTCUSDC',
    agent_id: 'gemini-spark',
    bias_signal: 'CONFIRMED_BULLISH',
    entry_range_low: '65000.00',
    entry_range_high: '65200.00',
    invalidation_level: '64500.00',
    target_1: '66000.00',
    target_2: '67000.00',
    status: 'ACTIVE',
    submitted_at: Date.now(),
  };

  const btcResult = await dispatcher.processDecision(btcRecord, 65500.0);
  assert(
    btcResult.status === 'STAND_DOWN',
    'BTC decision deferred with STAND_DOWN when engine is configured for ETHUSDC'
  );
  assert(
    btcResult.reason?.includes('Symbol mismatch') === true,
    'Reason correctly cites Symbol mismatch'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 8: Entry Range Boundary Resting Limit Order Physics
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 8] Verifying Entry Range Boundary Physics (Long & Short)...');

  // Long when price is inside the entry range [2410, 2415] @ 2412: limit must be distal low 2410
  const longInside = parseSparkDecision(mockRecordBullish, 2412.0);
  assert(
    longInside.limitEntryPrice === 2410.0,
    'Long limit price inside zone [2410, 2415] rests at distal low ($2410.00)'
  );

  // Long when price is at range low 2410: limit is range low 2410
  const longAtLow = parseSparkDecision(mockRecordBullish, 2410.0);
  assert(
    longAtLow.limitEntryPrice === 2410.0,
    'Long limit price at low boundary rests at range low ($2410.00)'
  );

  // Short when price is inside the entry range [2450, 2455] @ 2452: limit must be distal high 2455
  const shortInside = parseSparkDecision(mockRecordBearish, 2452.0);
  assert(
    shortInside.limitEntryPrice === 2455.0,
    'Short limit price inside zone [2450, 2455] rests at distal high ($2455.00)'
  );

  // Short when price is at range high 2455: limit is range high 2455
  const shortAtHigh = parseSparkDecision(mockRecordBearish, 2455.0);
  assert(
    shortAtHigh.limitEntryPrice === 2455.0,
    'Short limit price at high boundary rests at range high ($2455.00)'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 9: Dynamic Position Sizing & Anti-Micro-Friction Clamp (0.15% Floor)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 9] Verifying Dynamic Position Sizing & 0.15% Clamp...');

  // 9a: Tight wick stop clamp: entry 2500, invalidation 2499 -> raw dist $1.00 < $3.75
  const tightSizing = calculateSparkPositionSizing({
    accountEquity: 10000.0,
    compoundingRiskPct: 2.0,
    entryPrice: 2500.0,
    invalidationLevel: 2499.0,
    direction: 'LONG',
  });

  assert(tightSizing.isValid, 'Tight stop sizing is valid');
  assert(tightSizing.isClamped === true, 'Anti-micro-friction clamp activated for tight stop');
  assert(tightSizing.clampedStopDistance === 3.75, 'Stop distance clamped to 0.15% ($3.75 on $2500.00)');
  assert(tightSizing.clampedStopLoss === 2496.25, 'Clamped stop loss is $2496.25 for Long');
  assert(tightSizing.dollarRisk === 200.0, 'Dollar risk is $200.00 (2% of $10,000)');
  assert(tightSizing.contractSize === 53.333, 'Contract size is 53.333 ETH ($200 / 3.75 rounded down)');
  assert(tightSizing.effectiveLeverage === 13.33, 'Effective leverage clamped to 13.33x eliminating hyper-leverage');

  // 9b: Wide stop above 0.15%: entry 2500, invalidation 2450 -> raw dist $50.00 >= $3.75
  const wideSizing = calculateSparkPositionSizing({
    accountEquity: 10000.0,
    compoundingRiskPct: 2.0,
    entryPrice: 2500.0,
    invalidationLevel: 2450.0,
    direction: 'LONG',
  });

  assert(wideSizing.isValid, 'Wide stop sizing is valid');
  assert(wideSizing.isClamped === false, 'Wide stop was not clamped');
  assert(wideSizing.clampedStopDistance === 50.0, 'Stop distance remains raw $50.00');
  assert(wideSizing.clampedStopLoss === 2450.0, 'Stop loss remains original $2450.00');
  assert(wideSizing.contractSize === 4.0, 'Contract size is 4.000 ETH ($200 / $50)');
  assert(wideSizing.effectiveLeverage === 1.0, 'Effective leverage is 1.00x');

  // 9c: Bearish clamp: entry 2500, invalidation 2501 (SHORT)
  const shortTightSizing = calculateSparkPositionSizing({
    accountEquity: 10000.0,
    compoundingRiskPct: 2.0,
    entryPrice: 2500.0,
    invalidationLevel: 2501.0,
    direction: 'SHORT',
  });
  assert(shortTightSizing.isClamped === true, 'Short clamp activated');
  assert(shortTightSizing.clampedStopLoss === 2503.75, 'Short clamped stop loss is $2503.75');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 10: Dynamic Risk Parameter Hydration without Daemon Reboot
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 10] Verifying Dynamic Risk Parameter Hydration...');

  let testDynamicRiskPct = 1.5;
  let testDynamicEquity = 12000.0;

  const dynamicEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false,
    compoundingRiskPct: 2.0, // initial
    initialEquity: 1000.0,   // initial
  });

  const dynamicDispatcher = new SparkIngestionDispatcher({
    engine: dynamicEngine,
    getCurrentPrice: () => 2420.0,
    pollIntervalMs: 1000,
    allowOfflineFallback: true,
    getRiskSettings: () => ({
      compoundingRiskPct: testDynamicRiskPct,
      accountEquity: testDynamicEquity,
    }),
  });

  const activeParams = await dynamicDispatcher.getActiveRiskParameters();
  assert(activeParams.compoundingRiskPct === 1.5, 'Active risk % dynamically hydrated as 1.5%');
  assert(activeParams.accountEquity === 12000.0, 'Active equity dynamically hydrated as $12,000.00');
  assert(dynamicEngine.config.compoundingRiskPct === 1.5, 'Engine config hot-reloaded to 1.5%');
  assert(dynamicEngine.getAccountEquity() === 12000.0, 'Engine equity hot-reloaded to $12,000.00');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 11: Global Risk Governor Gatekeeper - Emergency Equity Floor
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 11] Verifying Risk Governor: Emergency Equity Floor...');

  const floorEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false,
    initialEquity: 400.0,
  });

  const floorDispatcher = new SparkIngestionDispatcher({
    engine: floorEngine,
    getCurrentPrice: () => 2420.0,
    pollIntervalMs: 1000,
    allowOfflineFallback: true,
    getRiskSettings: () => ({
      accountEquity: 400.0,
      emergencyEquityFloor: 500.0, // Floor is 500, equity is 400
    }),
  });

  const floorRecord = {
    ...mockRecordBullish,
    id: 111,
  };

  const floorResult = await floorDispatcher.processDecision(floorRecord, 2420.0);
  assert(
    floorResult.status === 'REJECTED_BY_RISK_GOVERNOR',
    'Setup rejected by Risk Governor when account is below Emergency Equity Floor'
  );
  assert(
    floorResult.reason?.includes('Emergency Equity Floor breached') === true,
    'Rejection reason notes Emergency Equity Floor breach'
  );
  assert(
    floorEngine.getPendingLimitOrders().length === 0,
    'Zero orders queued when Emergency Equity Floor is breached'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 12: Global Risk Governor Gatekeeper - Post-Loss Cooldown (Rule 5)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 12] Verifying Risk Governor: Post-Loss Cooldown (Rule 5)...');

  const cooldownEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false,
    postLossCooldownMinutes: 45,
  });

  // Simulate a loss closed 10 minutes ago
  cooldownEngine.setLastLossClosedTimestamp(Date.now() - 10 * 60 * 1000);
  assert(cooldownEngine.isPostLossCooldownActive().isActive, 'Post-loss cooldown is active on engine');

  const cooldownDispatcher = new SparkIngestionDispatcher({
    engine: cooldownEngine,
    getCurrentPrice: () => 2420.0,
    pollIntervalMs: 1000,
    allowOfflineFallback: true,
  });

  const cooldownRecord = {
    ...mockRecordBullish,
    id: 112,
  };

  const cooldownResult = await cooldownDispatcher.processDecision(cooldownRecord, 2420.0);
  assert(
    cooldownResult.status === 'REJECTED_BY_RISK_GOVERNOR',
    'Setup rejected by Risk Governor when post-loss cooldown is active'
  );
  assert(
    cooldownResult.reason?.includes('Post-loss cooldown active (Rule 5)') === true,
    'Rejection reason correctly cites Rule 5 Post-loss cooldown'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 13: Global Risk Governor Gatekeeper - Concurrency Lock
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 13] Verifying Risk Governor: Concurrency Lock...');

  const concEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false,
    maxOpenPositions: 1,
  });

  // Rehydrate a synthetic active position to simulate in-flight position
  concEngine.rehydratePositionsDirect([
    {
      id: 'active_in_flight_1',
      strategyId: 'SPARK_EXISTING',
      strategyName: 'Existing Active Trade',
      symbol: 'ETHUSDC',
      timeframe: '5m',
      direction: 'LONG',
      limitEntryPrice: 2415.0,
      entryPrice: 2415.0,
      initialStopLoss: 2395.0,
      activeStopLoss: 2395.0,
      stage1Target: 2435.0,
      stage2Target: 2455.0,
      contractSize: 10,
      riskUsd: 200,
      status: 'OPEN',
      openTime: Date.now() - 300000,
    } as any,
  ]);

  assert(concEngine.getActivePositions().length === 1, 'Engine has 1 active open position');

  const concDispatcher = new SparkIngestionDispatcher({
    engine: concEngine,
    getCurrentPrice: () => 2420.0,
    pollIntervalMs: 1000,
    allowOfflineFallback: true,
  });

  const concRecord = {
    ...mockRecordBullish,
    id: 113,
  };

  const concResult = await concDispatcher.processDecision(concRecord, 2420.0);
  assert(
    concResult.status === 'REJECTED_BY_RISK_GOVERNOR',
    'Setup rejected by Risk Governor when active position already exists (Concurrency Lock)'
  );
  assert(
    concResult.reason?.includes('Max concurrent open positions') === true,
    'Rejection reason cites max concurrent open positions'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 14: Global Risk Governor Gatekeeper - Daily Drawdown Cap
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 14] Verifying Risk Governor: Daily Drawdown Cap...');

  // Set daily realized loss to -$450 (cap is $400)
  GlobalRiskGovernor._setTestState({ daily_realized_pnl: -450.0 });

  const ddEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false,
  });

  const ddDispatcher = new SparkIngestionDispatcher({
    engine: ddEngine,
    getCurrentPrice: () => 2420.0,
    pollIntervalMs: 1000,
    allowOfflineFallback: true,
  });

  const ddRecord = {
    ...mockRecordBullish,
    id: 114,
  };

  const ddResult = await ddDispatcher.processDecision(ddRecord, 2420.0);
  assert(
    ddResult.status === 'REJECTED_BY_RISK_GOVERNOR',
    'Setup rejected by Risk Governor when Daily Drawdown Cap is breached'
  );
  assert(
    ddResult.reason?.includes('Daily drawdown limit breached') === true,
    'Rejection reason cites Daily drawdown limit breached'
  );

  // Reset GlobalRiskGovernor state back to clean
  await GlobalRiskGovernor.resetCircuitBreaker('institutional_admin');
  GlobalRiskGovernor._setTestState({ daily_realized_pnl: 0.0, daily_trades_count: 0 });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 15: State Transition & Staging Audit Logging
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 15] Verifying State Transition to STAGED with Payload Attachment...');

  const stagingEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false,
    compoundingRiskPct: 2.0,
    initialEquity: 10000.0,
    filterWeekend: false,
  });

  const stagingDispatcher = new SparkIngestionDispatcher({
    engine: stagingEngine,
    getCurrentPrice: () => 2420.0,
    pollIntervalMs: 1000,
    allowOfflineFallback: true,
    executionMode: 'PAPER_TRADING',
    getRiskSettings: () => ({
      compoundingRiskPct: 2.0,
      accountEquity: 10000.0,
    }),
  });

  const stagingRecord = {
    ...mockRecordBullish,
    id: 115,
  };

  // Test staging only mode
  const stagedResult = await stagingDispatcher.processDecision(stagingRecord, 2420.0, { stageOnly: true });

  assert(stagedResult.status === 'STAGED', 'Setup transitioned to STAGED status');
  assert(stagedResult.parsed !== undefined, 'Parsed decision is returned in result');
  assert(stagedResult.parsed?.positionSize !== undefined && stagedResult.parsed.positionSize > 0, 'Position size attached to decision payload');
  assert(stagedResult.parsed?.dollarRisk === 200.0, 'Dollar risk ($200.00) attached to decision payload');
  assert(stagedResult.parsed?.clampedStopLossPrice === 2395.0, 'Clamped stop loss ($2395.00) attached to decision payload');
  assert(stagedResult.parsed?.effectiveLeverage !== undefined && stagedResult.parsed.effectiveLeverage > 0, 'Effective leverage attached to decision payload');
  assert(stagingEngine.getPendingLimitOrders().length === 0, 'Pending limit queue remains empty when stageOnly=true');

  // Test full execution handover (default mode)
  const executedResult = await stagingDispatcher.processDecision(stagingRecord, 2420.0);
  assert(
    executedResult.status === 'PAPER_ACTIVE' || executedResult.status === 'EXECUTED',
    'Setup advanced from STAGED to execution in PAPER_TRADING mode'
  );
  assert(stagingEngine.getPendingLimitOrders().length === 1, 'Resting limit order placed in engine queue');
  const placedOrder = stagingEngine.getPendingLimitOrders()[0];
  assert(placedOrder.contractSize === stagedResult.parsed?.positionSize, 'Placed contract size matches computed staged sizing');
  assert(placedOrder.riskUsd === stagedResult.parsed?.dollarRisk, 'Placed risk USD matches computed staged dollar risk');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 16: File-based Live Settings Hydration Precedence over Engine Default
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 16] Verifying Live Settings File Hydration Precedence...');
  const runLogsDir = path.join(process.cwd(), 'run_logs');
  const liveSettingsPath = path.join(runLogsDir, 'daemon_live_settings.json');
  let originalFileContent: string | null = null;
  if (fs.existsSync(liveSettingsPath)) {
    originalFileContent = fs.readFileSync(liveSettingsPath, 'utf8');
  }

  try {
    fs.mkdirSync(runLogsDir, { recursive: true });
    fs.writeFileSync(
      liveSettingsPath,
      JSON.stringify({
        accountEquity: 18500.0,
        compoundingRiskPct: 1.75,
        maxOpenPositions: 3,
      }),
      'utf8'
    );

    const testEngine = new AutomatedStrategyExecutionEngine({
      symbol: 'ETHUSDC',
      timeframe: '5m',
      autoExecute: true,
      enableAutonomousScan: false,
      compoundingRiskPct: 2.0, // initial
      initialEquity: 1000.0,   // initial (should be overridden by file)
    });

    const fileDispatcher = new SparkIngestionDispatcher({
      engine: testEngine,
      getCurrentPrice: () => 2420.0,
      allowOfflineFallback: true,
    });

    const fileParams = await fileDispatcher.getActiveRiskParameters();
    assert(fileParams.accountEquity === 18500.0, 'File accountEquity (18,500) overrides initial engine equity (1,000)');
    assert(fileParams.compoundingRiskPct === 1.75, 'File compoundingRiskPct (1.75%) overrides initial engine risk');
    assert(fileParams.maxOpenPositions === 3, 'File maxOpenPositions (3) overrides engine default');
    assert(testEngine.getAccountEquity() === 18500.0, 'Engine equity hot-reloaded to 18,500');
    assert(testEngine.config.compoundingRiskPct === 1.75, 'Engine risk hot-reloaded to 1.75%');
  } finally {
    if (originalFileContent !== null) {
      fs.writeFileSync(liveSettingsPath, originalFileContent, 'utf8');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 17: Processing Pre-Queued Decision Record (status = 'QUEUED')
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 17] Verifying Pre-Queued Decision Ingestion (status = QUEUED)...');
  const queuedRecord = {
    ...mockRecordBullish,
    id: 117,
    status: 'QUEUED',
  };

  const queuedEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false,
    compoundingRiskPct: 2.0,
    initialEquity: 10000.0,
  });

  const queuedDispatcher = new SparkIngestionDispatcher({
    engine: queuedEngine,
    getCurrentPrice: () => 2420.0,
    allowOfflineFallback: true,
  });

  const queuedResult = await queuedDispatcher.processDecision(queuedRecord, 2420.0, { stageOnly: true });
  assert(queuedResult.status === 'STAGED', 'Pre-queued setup successfully claimed and transitioned to STAGED');
  assert(queuedResult.status !== 'ALREADY_CLAIMED', 'Pre-queued setup did not falsely trigger ALREADY_CLAIMED');
  assert(queuedResult.sizing?.contractSize !== undefined && queuedResult.sizing.contractSize > 0, 'Pre-queued setup dynamically sized');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 18: Sizing Input Validation (Negative/Excessive Risk & Direction)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 18] Verifying Sizing Engine Input Validations...');
  const negRiskSizing = calculateSparkPositionSizing({
    accountEquity: 10000.0,
    compoundingRiskPct: -2.0,
    entryPrice: 2500.0,
    invalidationLevel: 2450.0,
    direction: 'LONG',
  });
  assert(!negRiskSizing.isValid, 'Negative risk percentage is rejected');
  assert(negRiskSizing.error?.includes('Invalid compounding risk percentage') === true, 'Error message identifies invalid risk %');

  const zeroRiskSizing = calculateSparkPositionSizing({
    accountEquity: 10000.0,
    compoundingRiskPct: 0,
    entryPrice: 2500.0,
    invalidationLevel: 2450.0,
    direction: 'LONG',
  });
  assert(!zeroRiskSizing.isValid, 'Zero risk percentage is rejected');

  const excessRiskSizing = calculateSparkPositionSizing({
    accountEquity: 10000.0,
    compoundingRiskPct: 150,
    entryPrice: 2500.0,
    invalidationLevel: 2450.0,
    direction: 'LONG',
  });
  assert(!excessRiskSizing.isValid, 'Risk percentage > 100 is rejected');

  const invalidDirSizing = calculateSparkPositionSizing({
    accountEquity: 10000.0,
    compoundingRiskPct: 2.0,
    entryPrice: 2500.0,
    invalidationLevel: 2450.0,
    direction: 'UNKNOWN' as any,
  });
  assert(!invalidDirSizing.isValid, 'Invalid direction is rejected');
  assert(invalidDirSizing.error?.includes('Invalid direction') === true, 'Error message identifies invalid direction');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 19: Dispatcher Instance Configured with stageOnly: true
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 19] Verifying Dispatcher Instance stageOnly: true Setting...');
  const stageOnlyEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false,
    compoundingRiskPct: 2.0,
    initialEquity: 10000.0,
  });

  const stageOnlyDispatcher = new SparkIngestionDispatcher({
    engine: stageOnlyEngine,
    getCurrentPrice: () => 2420.0,
    allowOfflineFallback: true,
    stageOnly: true, // Instance-level setting
  });

  const stageOnlyRecord = {
    ...mockRecordBullish,
    id: 119,
  };

  const stageOnlyResult = await stageOnlyDispatcher.processDecision(stageOnlyRecord, 2420.0);
  assert(stageOnlyResult.status === 'STAGED', 'Decision remains in STAGED status when dispatcher has stageOnly: true');
  assert(stageOnlyEngine.getPendingLimitOrders().length === 0, 'Zero orders submitted to execution queue in stageOnly mode');

  console.log('\n======================================================================');
  console.log(`Institutional Test Suite Finished: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal Test Exception:', err);
  process.exit(1);
});
