/**
 * test_armed_intent_pipeline.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow-State Quant Engine — Institutional Test Suite
 * Mission: Asynchronous Armed Intent & Proximity Radar Pipeline
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates the complete two-stage lifecycle:
 *  1. Schema Permissiveness & Pre-Flight Invalidation Gate (MCP submission)
 *  2. Proximity Radar Hysteresis & Tick Invalidation (DORMANT -> PROXIMITY_ELEVATED)
 *  3. Structural Trigger Evaluator (MSS_BODY_CLOSE, SWEEP_AND_RECLAIM, Volumetric)
 *  4. 12-Bar TTL Expiration & Early Target 1 Cancellation (Missed Expansion)
 *  5. Limit Entry Price Resolution (FVG_PROXIMAL, POI_MIDPOINT, LIMIT_EXACT)
 *  6. End-to-End Trigger Dispatch to Resting Limit Placement & Dynamic Sizing
 *  7. State Machine & Stage Progression (ARMED_PENDING -> ORDER_RESTING -> IN_FLIGHT_STAGE_1/2/3)
 *  8. Telegram Markdown Formatting & Deduplication for All 4 Armed Milestones
 *  9. Bidirectional Parity in get_live_daemon_status
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  ProximityRadarEngine,
  ArmedIntent,
  CandleEvaluationOutput,
} from '../src/lib/daemon/proximityRadar';
import {
  SparkIngestionDispatcher,
  calculateSparkPositionSizing,
} from '../src/lib/daemon/sparkIngestionDispatcher';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { Candle } from '../src/lib/fvgEngine';
import {
  TelegramNotifier,
  formatArmedIntentRegisteredMarkdown,
  formatArmedIntentTriggeredMarkdown,
  formatArmedIntentExpiredMarkdown,
  formatArmedIntentInvalidatedMarkdown,
} from '../src/lib/notifications/telegramNotifier';
import { runInvalidationCheck, runGetLiveDaemonStatus } from '../src/lib/agentEngineHandlers';

function createCandle(params: {
  t?: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  takerBuy?: number;
}): Candle {
  const v = params.v ?? 1000;
  const takerBuy = params.takerBuy ?? 600;
  return {
    t: params.t ?? Date.now(),
    o: params.o,
    h: params.h,
    l: params.l,
    c: params.c,
    v,
    taker_buy_vol: takerBuy,
    taker_sell_vol: v - takerBuy,
    isClosed: true,
  };
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('🧪 TESTING ASYNCHRONOUS ARMED INTENT & PROXIMITY RADAR PIPELINE');
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
  // TEST 1: Schema Permissiveness & Pre-Flight Invalidation Gate
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 1] Testing Schema Permissiveness & Invalidation Guard...');

  // Bullish setup where live price (2390) has ALREADY breached invalidation level (2400)
  const breachCheckLong = runInvalidationCheck(
    2400, // invalidation level
    2390, // live price
    'CONFIRMED_BULLISH',
    2500, // target 1
    2410, // entry low
    2420  // entry high
  );
  assert(breachCheckLong.breached === true, 'Invalidation guard detects pre-existing breach for LONG');
  assert(breachCheckLong.breach_direction === 'BELOW', 'Correct breach direction BELOW');

  // Bullish setup where live price (2415) is healthy (above invalidation 2400)
  const validCheckLong = runInvalidationCheck(
    2400,
    2415,
    'CONFIRMED_BULLISH',
    2500,
    2410,
    2420
  );
  assert(validCheckLong.breached === false, 'Invalidation guard passes valid healthy price for LONG');

  // Bearish setup where live price (2460) has ALREADY breached invalidation level (2450)
  const breachCheckShort = runInvalidationCheck(
    2450,
    2460,
    'CONFIRMED_BEARISH',
    2350,
    2430,
    2440
  );
  assert(breachCheckShort.breached === true, 'Invalidation guard detects pre-existing breach for SHORT');
  assert(breachCheckShort.breach_direction === 'ABOVE', 'Correct breach direction ABOVE');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Proximity Radar Hysteresis & State Transitions
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 2] Testing Proximity Radar Hysteresis & Elevation...');

  const radar = new ProximityRadarEngine();
  const testIntent1: ArmedIntent = {
    id: 501,
    symbol: 'ETHUSDC',
    agentId: 'gemini_spark_test',
    direction: 'LONG',
    executionMode: 'TRIGGER_ON_CONFIRMATION',
    triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
    triggerPrice: 2420,
    triggerTimeframe: '5m',
    poiZoneLow: 2405,
    poiZoneHigh: 2415,
    limitOffsetRule: 'FVG_PROXIMAL',
    ttlBars: 12,
    barsElapsed: 0,
    invalidationLevel: 2390,
    target1: 2460,
    target2: 2500,
    target3: 2550,
    stage1Ratio: 0.4,
    stage2Ratio: 0.4,
    stage3Ratio: 0.2,
    radarStatus: 'DORMANT',
    stage: 'ARMED_PENDING',
    armedAt: Date.now(),
  };

  radar.registerIntent(testIntent1);
  assert(radar.getAllIntents().length === 1, 'Intent successfully registered in radar');
  assert(radar.getIntent(501)?.radarStatus === 'DORMANT', 'Initial radarStatus is DORMANT');

  // Price far above zone (2450): Should remain DORMANT
  const tickFar = radar.onMarketTick(2450, 'ETHUSDC');
  assert(tickFar.elevated.length === 0, 'No elevation when live price is far from POI zone');
  assert(radar.getIntent(501)?.radarStatus === 'DORMANT', 'Radar status remains DORMANT @ $2450');

  // Price penetrates POI zone buffer (POI zone: 2405-2415, 20% buffer: 2403 - 2417): Tick @ 2416
  const tickPenetrate = radar.onMarketTick(2416, 'ETHUSDC');
  assert(tickPenetrate.elevated.length === 1, 'Elevation triggered upon entering POI proximity');
  assert(radar.getIntent(501)?.radarStatus === 'PROXIMITY_ELEVATED', 'Radar status elevated to PROXIMITY_ELEVATED');
  assert(radar.getIntent(501)?.stage === 'PROXIMITY_ELEVATED', 'Intent stage advanced to PROXIMITY_ELEVATED');

  // Price pulls back slightly outside zone but within 50% hysteresis buffer (2418): Should stay PROXIMITY_ELEVATED
  radar.onMarketTick(2418, 'ETHUSDC');
  assert(
    radar.getIntent(501)?.radarStatus === 'PROXIMITY_ELEVATED',
    'Radar maintains PROXIMITY_ELEVATED within hysteresis buffer (anti-oscillation)'
  );

  // Price pulls far away (> 50% buffer, e.g. 2430): Should drop back to DORMANT
  radar.onMarketTick(2430, 'ETHUSDC');
  assert(
    radar.getIntent(501)?.radarStatus === 'DORMANT',
    'Radar drops back to DORMANT when price leaves hysteresis zone'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Tick-Level Invalidation & Early Target 1 Cancellation
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 3] Testing Tick-Level Invalidation & Early Target 1 Hit (Missed Expansion)...');

  const radarStop = new ProximityRadarEngine();
  // 3a. Adverse Stop Loss Breach
  const testIntentStop = { ...testIntent1, id: 502, radarStatus: 'DORMANT' as const, stage: 'ARMED_PENDING' as const };
  radarStop.registerIntent(testIntentStop);
  const tickStopBreach = radarStop.onMarketTick(2389, 'ETHUSDC'); // Stop is 2390
  assert(tickStopBreach.invalidated.length === 1, 'Stop breach generates invalidation result');
  assert(radarStop.getIntent(502)?.stage === 'INVALIDATED', 'Intent marked as INVALIDATED on stop breach');
  assert(
    radarStop.getIntent(502)?.invalidationReason?.includes('breached invalidation level') === true,
    'Invalidation reason correctly identifies stop breach'
  );

  // 3b. Early Target 1 Touch (Missed Expansion before entry)
  const radarTarget = new ProximityRadarEngine();
  const testIntentTarget = { ...testIntent1, id: 503, radarStatus: 'DORMANT' as const, stage: 'ARMED_PENDING' as const };
  radarTarget.registerIntent(testIntentTarget);
  const tickTargetHit = radarTarget.onMarketTick(2461, 'ETHUSDC'); // Target 1 is 2460
  assert(tickTargetHit.invalidated.length === 1, 'Target 1 hit before entry generates invalidation result');
  assert(radarTarget.getIntent(503)?.stage === 'INVALIDATED', 'Intent marked as INVALIDATED on Target 1 touch');
  assert(
    radarTarget.getIntent(503)?.invalidationReason?.includes('Missed Expansion') === true,
    'Reason correctly records Missed Expansion'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Structural Trigger Evaluator (MSS Body Close, Sweep & Reclaim)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 4] Testing Candle Closed Trigger Evaluator...');

  const radarTrig = new ProximityRadarEngine();

  // Setup A: LONG with MSS_BODY_CLOSE_ABOVE trigger @ 2420
  const intentMssLong: ArmedIntent = {
    ...testIntent1,
    id: 601,
    triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
    triggerPrice: 2420,
    limitOffsetRule: 'FVG_PROXIMAL',
    poiZoneLow: 2405,
    poiZoneHigh: 2415,
  };
  radarTrig.registerIntent(intentMssLong);

  // Candle 1: Closes at 2418 (below trigger price 2420) -> NOT triggered
  const candleBelow = createCandle({ o: 2410, h: 2419, l: 2408, c: 2418, v: 1000, takerBuy: 600 });
  const eval1 = radarTrig.onCandleClosed('5m', candleBelow, 'ETHUSDC');
  assert(eval1.triggered.length === 0, 'MSS_BODY_CLOSE_ABOVE does not trigger when close is below trigger price');
  assert(radarTrig.getIntent(601)?.barsElapsed === 1, 'Bars elapsed incremented to 1');

  // Candle 2: Bullish candle body close at 2423 (> 2420) with strong body ratio -> TRIGGERED!
  const candleTrigger = createCandle({ o: 2415, h: 2425, l: 2414, c: 2423, v: 2000, takerBuy: 1400 });
  const eval2 = radarTrig.onCandleClosed('5m', candleTrigger, 'ETHUSDC');
  assert(eval2.triggered.length === 1, 'MSS_BODY_CLOSE_ABOVE triggered upon confirmed bullish body close');
  assert(eval2.triggered[0].intent.id === 601, 'Triggered intent ID matches 601');
  assert(eval2.triggered[0].volumetricPassed === true, 'Volumetric sponsorship passed');
  assert(eval2.triggered[0].resolvedEntryPrice === 2415, 'Resolved entry price uses FVG_PROXIMAL (poiZoneHigh 2415 for LONG)');

  // Setup B: SHORT with MSS_BODY_CLOSE_BELOW trigger @ 2400
  const intentMssShort: ArmedIntent = {
    ...testIntent1,
    id: 602,
    direction: 'SHORT',
    triggerCondition: 'MSS_BODY_CLOSE_BELOW',
    triggerPrice: 2400,
    invalidationLevel: 2430,
    target1: 2360,
    limitOffsetRule: 'FVG_PROXIMAL',
    poiZoneLow: 2405,
    poiZoneHigh: 2415,
  };
  radarTrig.registerIntent(intentMssShort);

  // Bearish candle body close at 2397 (< 2400) -> TRIGGERED!
  const candleShortTrig = createCandle({ o: 2408, h: 2409, l: 2395, c: 2397, v: 2500, takerBuy: 800 });
  const evalShort = radarTrig.onCandleClosed('5m', candleShortTrig, 'ETHUSDC');
  assert(evalShort.triggered.length === 1, 'MSS_BODY_CLOSE_BELOW triggered upon confirmed bearish body close');
  assert(evalShort.triggered[0].resolvedEntryPrice === 2405, 'Resolved entry price uses FVG_PROXIMAL (poiZoneLow 2405 for SHORT)');

  // Setup C: SWEEP_AND_RECLAIM for LONG (sweep below 2400 and close back above 2400)
  const intentSweep: ArmedIntent = {
    ...testIntent1,
    id: 603,
    direction: 'LONG',
    triggerCondition: 'SWEEP_AND_RECLAIM',
    triggerPrice: 2400,
    limitOffsetRule: 'POI_MIDPOINT',
    poiZoneLow: 2400,
    poiZoneHigh: 2420,
  };
  radarTrig.registerIntent(intentSweep);

  // Sweep candle: low dips to 2395 (< 2400), close reclaims to 2405 (> 2400)
  const candleSweep = createCandle({ o: 2402, h: 2408, l: 2395, c: 2405, v: 3000, takerBuy: 1800 });
  const evalSweep = radarTrig.onCandleClosed('5m', candleSweep, 'ETHUSDC');
  assert(evalSweep.triggered.length === 1, 'SWEEP_AND_RECLAIM triggered upon low sweep and reclaim body close');
  assert(evalSweep.triggered[0].resolvedEntryPrice === 2410, 'Resolved entry price uses POI_MIDPOINT (2400+2420)/2 = 2410');

  // Setup D: LIMIT_EXACT rule
  const intentExact: ArmedIntent = {
    ...testIntent1,
    id: 604,
    direction: 'LONG',
    triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
    triggerPrice: 2420,
    limitOffsetRule: 'LIMIT_EXACT',
    limitEntryPrice: 2412.5,
  };
  radarTrig.registerIntent(intentExact);
  const evalExact = radarTrig.onCandleClosed('5m', candleTrigger, 'ETHUSDC');
  assert(evalExact.triggered[0].resolvedEntryPrice === 2412.5, 'Resolved entry price matches exact specified limit price');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: 12-Bar TTL Expiration
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 5] Testing 12-Bar TTL Expiration...');

  const radarTtl = new ProximityRadarEngine();
  const intentTtl: ArmedIntent = {
    ...testIntent1,
    id: 701,
    ttlBars: 12,
    barsElapsed: 11, // 1 bar away from expiry
  };
  radarTtl.registerIntent(intentTtl);

  // 12th candle close without trigger condition met
  const neutralCandle = createCandle({ o: 2410, h: 2414, l: 2409, c: 2412 });
  const evalTtl = radarTtl.onCandleClosed('5m', neutralCandle, 'ETHUSDC');

  assert(evalTtl.expired.length === 1, 'Intent expires on exactly 12th bar');
  assert(evalTtl.expired[0].id === 701, 'Expired intent ID matches 701');
  assert(radarTtl.getIntent(701)?.stage === 'EXPIRED', 'Intent stage marked as EXPIRED');
  assert(
    radarTtl.getActiveIntents().length === 0,
    'Expired intent is purged from active monitoring list'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: Auto-Arming to Execution & Stage Progression
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 6] Testing End-to-End Trigger Dispatch & Stage Progression...');

  const engine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    initialEquity: 1000,
    compoundingRiskPct: 2.0,
    maxOpenPositions: 1,
    autoExecute: true,
    enableAutonomousScan: false,
  });

  const dispatcher = new SparkIngestionDispatcher({
    engine,
    getCurrentPrice: () => 2415,
    pollIntervalMs: 5000,
    allowOfflineFallback: true,
    executionMode: 'PAPER_TRADING',
  });

  // Check initial daemon state
  assert(dispatcher.getDaemonState() === 'SEARCHING', 'Initial daemon state is SEARCHING');

  // Register armed intent into dispatcher radar
  const liveArmedIntent: ArmedIntent = {
    id: 801,
    symbol: 'ETHUSDC',
    agentId: 'gemini_spark_live',
    direction: 'LONG',
    executionMode: 'TRIGGER_ON_CONFIRMATION',
    triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
    triggerPrice: 2420,
    triggerTimeframe: '5m',
    poiZoneLow: 2405,
    poiZoneHigh: 2415,
    limitOffsetRule: 'FVG_PROXIMAL',
    ttlBars: 12,
    barsElapsed: 0,
    invalidationLevel: 2390,
    target1: 2450,
    target2: 2480,
    target3: 2520,
    stage1Ratio: 0.4,
    stage2Ratio: 0.4,
    stage3Ratio: 0.2,
    radarStatus: 'DORMANT',
    stage: 'ARMED_PENDING',
    armedAt: Date.now(),
  };

  dispatcher.getProximityRadar().registerIntent(liveArmedIntent);
  assert(
    dispatcher.getDaemonState() === 'ARMED_WATCHING_TRIGGER',
    'Daemon state transitions to ARMED_WATCHING_TRIGGER when armed intent is active'
  );

  // Trigger the intent via candle closed
  const triggerCandle = createCandle({ o: 2415, h: 2426, l: 2414, c: 2424, v: 3000, takerBuy: 2200 });
  await dispatcher.onCandleClosed('5m', triggerCandle, 'ETHUSDC');

  // Verify resting limit order was placed in engine
  const pendingOrders = engine.getPendingLimitOrders();
  assert(pendingOrders.length === 1, 'Resting limit order placed in execution engine upon trigger confirmation');
  assert(pendingOrders[0].limitEntryPrice === 2415, 'Resting limit order price matches resolved entry ($2415.00)');
  assert(pendingOrders[0].direction === 'LONG', 'Order direction is LONG');
  assert(pendingOrders[0].executionMode === 'PAPER_TRADING', 'Order tagged as PAPER_TRADING');

  // Verify daemon state transitioned to ORDER_RESTING
  assert(
    dispatcher.getDaemonState() === 'ORDER_RESTING',
    'Daemon state transitions to ORDER_RESTING when resting limit order is active'
  );
  assert(
    dispatcher.getProximityRadar().getIntent(801)?.stage === 'ORDER_RESTING',
    'Radar intent stage transitioned to ORDER_RESTING'
  );

  // Simulate limit fill
  engine.processMarketTick(2414.5);
  assert(engine.getActivePositions().length === 1, 'Position opened upon market tick fill');
  assert(
    dispatcher.getDaemonState() === 'ACTIVE_TRADE',
    'Daemon state transitions to ACTIVE_TRADE when position is in flight'
  );
  assert(
    dispatcher.getProximityRadar().getIntent(801)?.stage === 'IN_FLIGHT_STAGE_1',
    'Radar intent stage transitioned to IN_FLIGHT_STAGE_1 upon order fill'
  );

  // Simulate TP1 harvest @ 2450
  engine.processMarketTick(2451);
  assert(
    dispatcher.getProximityRadar().getIntent(801)?.stage === 'IN_FLIGHT_STAGE_2',
    'Radar intent stage transitioned to IN_FLIGHT_STAGE_2 upon TP1 harvest'
  );

  // Simulate position close at trailing stop
  const activePos = engine.getActivePositions()[0];
  engine.emergencyClosePosition(activePos.id, 2430);
  assert(
    dispatcher.getProximityRadar().getIntent(801)?.stage === 'COMPLETED',
    'Radar intent stage transitioned to COMPLETED upon trade exit'
  );
  assert(
    dispatcher.getDaemonState() === 'SEARCHING',
    'Daemon state returns to SEARCHING once trade is completed'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7: Bidirectional Parity in runGetLiveDaemonStatus
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 7] Testing Bidirectional Parity in runGetLiveDaemonStatus...');

  const liveStatus = await runGetLiveDaemonStatus();
  assert(typeof liveStatus.daemon_state === 'string', 'Live daemon status includes daemon_state');
  assert(typeof liveStatus.armed_intents_count === 'number', 'Live daemon status includes armed_intents_count');
  assert(Array.isArray(liveStatus.armed_intents), 'Live daemon status includes armed_intents array');
  assert(Array.isArray(liveStatus.active_in_flight_positions), 'Live daemon status includes active_in_flight_positions');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 8: Telegram Markdown Cards (All 4 Armed Lifecycle Milestones)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 8] Testing Telegram Markdown Cards for 4 Armed Milestones...');

  // 8a. ARMED_INTENT_REGISTERED
  const regMd = formatArmedIntentRegisteredMarkdown({
    id: 901,
    symbol: 'ETHUSDC',
    direction: 'LONG',
    triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
    triggerPrice: 2420,
    triggerTimeframe: '5m',
    poiZoneLow: 2405,
    poiZoneHigh: 2415,
    invalidationLevel: 2390,
    target1: 2450,
    target2: 2480,
    target3: 2520,
    ttlBars: 12,
    narrative: 'Testing radar arming format.',
  });
  assert(regMd.includes('INTENT REGISTERED'), 'Registered card has correct header');
  assert(regMd.includes('MSS_BODY_CLOSE_ABOVE'), 'Registered card includes trigger condition');
  assert(regMd.includes('$2405.00 — $2415.00'), 'Registered card includes POI Zone');
  assert(regMd.includes('12 Bars (60m)'), 'Registered card includes TTL window');

  // 8b. ARMED_INTENT_TRIGGERED
  const trigMd = formatArmedIntentTriggeredMarkdown({
    id: 901,
    symbol: 'ETHUSDC',
    direction: 'LONG',
    triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
    triggerPrice: 2420,
    triggerTimeframe: '5m',
    limitEntryPrice: 2415,
    stopLossPrice: 2390,
    contractSize: 0.8,
    riskUsd: 20,
    riskPct: 2.0,
    target1: 2450,
  });
  assert(trigMd.includes('[ARMED INTENT TRIGGERED & ORDER RESTING]'), 'Triggered card has correct header');
  assert(trigMd.includes('Resting Maker'), 'Triggered card highlights resting maker physics');
  assert(trigMd.includes('$2415.00'), 'Triggered card displays resting limit entry');
  assert(trigMd.includes('0.8 contracts'), 'Triggered card displays position size');

  // 8c. ARMED_INTENT_EXPIRED
  const expMd = formatArmedIntentExpiredMarkdown({
    id: 901,
    symbol: 'ETHUSDC',
    direction: 'LONG',
    triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
    triggerPrice: 2420,
    triggerTimeframe: '5m',
    ttlBars: 12,
  });
  assert(expMd.includes('[ARMED INTENT EXPIRED]'), 'Expired card has correct header');
  assert(expMd.includes('12 bars elapsed without trigger confirmation'), 'Expired card notes TTL exhaustion');
  assert(expMd.includes('Intent disarmed & pending queue flushed'), 'Expired card confirms atomic flushing');

  // 8d. ARMED_INTENT_INVALIDATED
  const invMd = formatArmedIntentInvalidatedMarkdown({
    id: 901,
    symbol: 'ETHUSDC',
    direction: 'LONG',
    reason: 'Target 1 ($2450.00) touched before entry fill (Missed Expansion)',
  });
  assert(invMd.includes('[ARMED INTENT INVALIDATED]'), 'Invalidated card has correct header');
  assert(invMd.includes('Missed Expansion'), 'Invalidated card contains exact invalidation reason');
  assert(invMd.includes('Zero exchange exposure'), 'Invalidated card confirms zero exchange exposure');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 9: Telegram Milestone Deduplication
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 9] Testing Telegram Deduplication for Armed Milestones...');

  const telegram = new TelegramNotifier({
    botToken: 'mock_bot_token',
    chatId: 'mock_chat_id',
    enabled: true,
    ephemeralRegistry: true,
  });
  telegram.clearDeduplicationRegistry();
  const testKey = 'evt_ARMED_INTENT_TRIGGERED_ETHUSDC_999';

  // First broadcast
  let sendCount = 0;
  telegram.sendRawMessage = async () => {
    sendCount++;
    return true;
  };

  await telegram.broadcastSparkMilestone(
    'ARMED_INTENT_TRIGGERED',
    {
      id: 999,
      symbol: 'ETHUSDC',
      direction: 'LONG',
      triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
      triggerPrice: 2420,
      triggerTimeframe: '5m',
      limitEntryPrice: 2415,
      stopLossPrice: 2390,
    },
    { eventKey: testKey }
  );
  assert(sendCount === 1, 'First broadcast sends message to Telegram');

  // Duplicate broadcast with same key
  await telegram.broadcastSparkMilestone(
    'ARMED_INTENT_TRIGGERED',
    {
      id: 999,
      symbol: 'ETHUSDC',
      direction: 'LONG',
      triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
      triggerPrice: 2420,
      triggerTimeframe: '5m',
      limitEntryPrice: 2415,
      stopLossPrice: 2390,
    },
    { eventKey: testKey }
  );
  assert(sendCount === 1, 'Duplicate broadcast with same eventKey is strictly suppressed');

  // Clean up
  telegram.removeEventKey(testKey);

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 10: Elevated 1m Micro-Candle Does NOT Trigger 5m Structural MSS
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 10] Testing Elevated Micro-Candle Timeframe Gating...');

  const gatingRadar = new ProximityRadarEngine();
  const gatingIntent: ArmedIntent = {
    id: 1001,
    symbol: 'ETHUSDC',
    agentId: 'gating_test',
    direction: 'LONG',
    executionMode: 'TRIGGER_ON_CONFIRMATION',
    triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
    triggerPrice: 2420,
    triggerTimeframe: '5m', // Requires 5m candle close
    poiZoneLow: 2405,
    poiZoneHigh: 2415,
    limitOffsetRule: 'FVG_PROXIMAL',
    ttlBars: 12,
    barsElapsed: 0,
    invalidationLevel: 2390,
    target1: 2460,
    target2: null,
    target3: null,
    radarStatus: 'DORMANT',
    stage: 'ARMED_PENDING',
    armedAt: Date.now(),
  };
  gatingRadar.registerIntent(gatingIntent);

  // Elevate radar via market tick into POI zone
  gatingRadar.onMarketTick(2410, 'ETHUSDC');
  assert(gatingRadar.getIntent(1001)?.radarStatus === 'PROXIMITY_ELEVATED', 'Intent elevated to PROXIMITY_ELEVATED');

  // Feed a bullish 1m candle close above triggerPrice ($2420)
  const oneMinCandle = createCandle({
    o: 2408,
    h: 2425,
    l: 2405,
    c: 2422,
    v: 8000,
    takerBuy: 6500,
  });
  const res1m = gatingRadar.onCandleClosed('1m', oneMinCandle, 'ETHUSDC');
  assert(res1m.triggered.length === 0, '1m candle close does NOT trigger 5m structural MSS setup');
  assert(gatingRadar.getIntent(1001)?.barsElapsed === 0, '1m candle does NOT increment 5m TTL bars elapsed');

  // Now feed a bullish 5m candle close above triggerPrice ($2420)
  const fiveMinCandle = createCandle({
    o: 2408,
    h: 2425,
    l: 2405,
    c: 2422,
    v: 12000,
    takerBuy: 9000,
  });
  const res5m = gatingRadar.onCandleClosed('5m', fiveMinCandle, 'ETHUSDC');
  assert(res5m.triggered.length === 1, '5m candle close successfully triggers 5m structural MSS setup');
  assert(res5m.triggered[0].intent.id === 1001, 'Triggered intent ID matches 1001');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 11: ANCHOR_PRICE Limit Offset Rule Resolution
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 11] Testing ANCHOR_PRICE Limit Offset Rule Resolution...');

  const anchorRadar = new ProximityRadarEngine();
  const anchorLongIntent: ArmedIntent = {
    id: 1101,
    symbol: 'ETHUSDC',
    agentId: 'anchor_long_test',
    direction: 'LONG',
    executionMode: 'TRIGGER_ON_CONFIRMATION',
    triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
    triggerPrice: 2420,
    triggerTimeframe: '5m',
    poiZoneLow: 2405,
    poiZoneHigh: 2415,
    limitOffsetRule: 'ANCHOR_PRICE', // Long uses zoneFloor ($2405)
    ttlBars: 12,
    barsElapsed: 0,
    invalidationLevel: 2390,
    target1: 2460,
    target2: null,
    target3: null,
    radarStatus: 'DORMANT',
    stage: 'ARMED_PENDING',
    armedAt: Date.now(),
  };
  const anchorShortIntent: ArmedIntent = {
    id: 1102,
    symbol: 'ETHUSDC',
    agentId: 'anchor_short_test',
    direction: 'SHORT',
    executionMode: 'TRIGGER_ON_CONFIRMATION',
    triggerCondition: 'MSS_BODY_CLOSE_BELOW',
    triggerPrice: 2400,
    triggerTimeframe: '5m',
    poiZoneLow: 2405,
    poiZoneHigh: 2415,
    limitOffsetRule: 'ANCHOR_PRICE', // Short uses zoneCeil ($2415)
    ttlBars: 12,
    barsElapsed: 0,
    invalidationLevel: 2430,
    target1: 2360,
    target2: null,
    target3: null,
    radarStatus: 'DORMANT',
    stage: 'ARMED_PENDING',
    armedAt: Date.now(),
  };

  anchorRadar.registerIntent(anchorLongIntent);
  anchorRadar.registerIntent(anchorShortIntent);

  const anchorLongCandle = createCandle({ o: 2410, h: 2425, l: 2408, c: 2422, v: 5000, takerBuy: 4000 });
  const anchorLongRes = anchorRadar.onCandleClosed('5m', anchorLongCandle, 'ETHUSDC');
  assert(anchorLongRes.triggered.length === 1, 'Anchor long intent triggered');
  assert(anchorLongRes.triggered[0].resolvedEntryPrice === 2405, 'LONG ANCHOR_PRICE resolves to poiZoneLow ($2405.00)');

  const anchorShortCandle = createCandle({ o: 2410, h: 2412, l: 2395, c: 2398, v: 5000, takerBuy: 1000 });
  const anchorShortRes = anchorRadar.onCandleClosed('5m', anchorShortCandle, 'ETHUSDC');
  assert(anchorShortRes.triggered.length === 1, 'Anchor short intent triggered');
  assert(anchorShortRes.triggered[0].resolvedEntryPrice === 2415, 'SHORT ANCHOR_PRICE resolves to poiZoneHigh ($2415.00)');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 12: Rejection in executeTriggeredIntent Cleanly Invalidates Intent
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 12] Testing executeTriggeredIntent Rejection Clean Invalidation...');

  const mockExecEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    executionMode: 'PAPER_TRADING',
  });
  let invalidationTelegramFired = false;
  const testTelegram = new TelegramNotifier({
    botToken: 'mock_bot',
    chatId: 'mock_chat',
    enabled: true,
    ephemeralRegistry: true,
  });
  testTelegram.broadcastSparkMilestone = async (milestone: any) => {
    if (milestone === 'ARMED_INTENT_INVALIDATED') {
      invalidationTelegramFired = true;
    }
    return true;
  };

  const rejectionDispatcher = new SparkIngestionDispatcher({
    engine: mockExecEngine,
    telegram: testTelegram,
    getCurrentPrice: () => 2415,
  });

  const rejectedIntent: ArmedIntent = {
    id: 1201,
    symbol: 'ETHUSDC',
    agentId: 'rejection_test',
    direction: 'LONG',
    executionMode: 'TRIGGER_ON_CONFIRMATION',
    triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
    triggerPrice: 2420,
    triggerTimeframe: '5m',
    poiZoneLow: 2405,
    poiZoneHigh: 2415,
    limitOffsetRule: 'FVG_PROXIMAL',
    ttlBars: 12,
    barsElapsed: 0,
    // Invalidation level equal to entry price creates 0 stop distance -> sizing failure
    invalidationLevel: 2415,
    target1: 2460,
    target2: null,
    target3: null,
    radarStatus: 'TRIGGERED',
    stage: 'ORDER_RESTING',
    armedAt: Date.now(),
  };

  const procResult = await rejectionDispatcher.executeTriggeredIntent({
    intent: rejectedIntent,
    triggerCandle: createCandle({ o: 2410, h: 2425, l: 2405, c: 2422 }),
    resolvedEntryPrice: 2415,
    volumetricPassed: true,
    timestamp: Date.now(),
  });

  assert(procResult.status === 'REJECTED', 'Execution result status is REJECTED');
  assert(rejectedIntent.stage === 'INVALIDATED', 'Intent stage transitioned from ORDER_RESTING to INVALIDATED on failure');
  assert(typeof rejectedIntent.invalidationReason === 'string' && rejectedIntent.invalidationReason.length > 0, 'Invalidation reason recorded');
  assert(invalidationTelegramFired === true, 'ARMED_INTENT_INVALIDATED Telegram card broadcast on execution rejection');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 13: Resting Order Cancellation (TTL / Invalidation) via Engine Listener
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 13] Testing Resting Maker Limit Cancellation Handling...');

  const cancelEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    executionMode: 'PAPER_TRADING',
  });
  let expiredBroadcastFired = false;
  const cancelTelegram = new TelegramNotifier({
    botToken: 'mock_bot',
    chatId: 'mock_chat',
    enabled: true,
    ephemeralRegistry: true,
  });
  cancelTelegram.broadcastSparkMilestone = async (milestone: any) => {
    if (milestone === 'ARMED_INTENT_EXPIRED') {
      expiredBroadcastFired = true;
    }
    return true;
  };

  const cancelDispatcher = new SparkIngestionDispatcher({
    engine: cancelEngine,
    telegram: cancelTelegram,
    getCurrentPrice: () => 2415,
  });

  const restingIntent: ArmedIntent = {
    id: 1301,
    symbol: 'ETHUSDC',
    agentId: 'ttl_cancel_test',
    direction: 'LONG',
    executionMode: 'TRIGGER_ON_CONFIRMATION',
    triggerCondition: 'MSS_BODY_CLOSE_ABOVE',
    triggerPrice: 2420,
    triggerTimeframe: '5m',
    poiZoneLow: 2405,
    poiZoneHigh: 2415,
    limitOffsetRule: 'FVG_PROXIMAL',
    ttlBars: 12,
    barsElapsed: 0,
    invalidationLevel: 2390,
    target1: 2460,
    target2: null,
    target3: null,
    radarStatus: 'TRIGGERED',
    stage: 'ORDER_RESTING',
    armedAt: Date.now(),
  };
  cancelDispatcher.getProximityRadar().registerIntent(restingIntent);

  // Simulate engine order cancellation due to TTL expiration
  (cancelEngine as any).emit(
    'LIMIT_ORDER_CANCELLED',
    'TTL expired: Max retest bars (12) reached without fill',
    {
      id: 'spark_decision_1301',
      strategyId: 'SPARK_1301',
      setupId: 'spark_decision_1301',
      symbol: 'ETHUSDC',
      direction: 'LONG',
      limitEntryPrice: 2415,
    }
  );

  const finalRestingIntent = cancelDispatcher.getProximityRadar().getIntent(1301);
  assert(finalRestingIntent?.stage === 'EXPIRED', 'Resting intent transitioned to EXPIRED stage on TTL cancel event');
  assert(expiredBroadcastFired === true, 'ARMED_INTENT_EXPIRED Telegram card broadcast on TTL cancellation');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
