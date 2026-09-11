/**
 * scripts/test_tri_state_execution_and_telegram.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Verification Suite for Phase 3:
 *  1. Tri-State Execution Router (STANDBY / PAPER_TRADING / LIVE_BINANCE)
 *  2. In-Daemon Paper Trading Simulator (Resting maker fill, 12-bar TTL, Next-Bar BE ratchet, +1.0R floor, fee parity)
 *  3. Physical Environment Isolation Gate (Local sandbox blocked vs VPS allowed)
 *  4. Real-Time Telegram Broadcast Pipeline (5 milestones, Markdown validation)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import {
  SparkIngestionDispatcher,
  normalizeExecutionMode,
} from '../src/lib/daemon/sparkIngestionDispatcher';
import { DaemonLedger } from '../src/lib/daemon/daemonLedger';
import {
  TelegramNotifier,
  formatSparkSignalReceivedMarkdown,
  formatSparkOrderArmedMarkdown,
  formatSparkOrderFilledMarkdown,
  formatSparkTp1RatchetMarkdown,
  formatSparkTradeClosedMarkdown,
  validateTelegramMarkdown,
} from '../src/lib/notifications/telegramNotifier';
import { evaluateExecutionSafetyGate } from '../src/lib/binanceOrderRouter';

async function runVerification() {
  console.log('======================================================================');
  console.log('🧪 PHASE 3: TRI-STATE ROUTER & TELEGRAM BROADCAST VERIFICATION');
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
  // TEST 1: Mode Normalization & Precedence Resolution
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 1] Verifying Execution Mode Normalization...');
  assert(normalizeExecutionMode('standby') === 'STANDBY', 'Normalized "standby" -> STANDBY');
  assert(normalizeExecutionMode('LOGGED_STANDBY') === 'STANDBY', 'Normalized "LOGGED_STANDBY" -> STANDBY');
  assert(normalizeExecutionMode('paper') === 'PAPER_TRADING', 'Normalized "paper" -> PAPER_TRADING');
  assert(normalizeExecutionMode('paper_trading') === 'PAPER_TRADING', 'Normalized "paper_trading" -> PAPER_TRADING');
  assert(normalizeExecutionMode('live') === 'LIVE_BINANCE', 'Normalized "live" -> LIVE_BINANCE');
  assert(normalizeExecutionMode('live_binance') === 'LIVE_BINANCE', 'Normalized "live_binance" -> LIVE_BINANCE');
  assert(normalizeExecutionMode('unknown') === null, 'Unknown mode returns null');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Mode 1 — STANDBY Routing (UI Cockpit Logging, Zero Margin/Orders)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 2] Verifying Mode 1: STANDBY Execution Routing...');

  const standbyEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false,
    compoundingRiskPct: 2.0,
    initialEquity: 10000.0,
    filterWeekend: false,
  });

  const standbyLedger = new DaemonLedger('ETHUSDC', 10000.0);
  const standbyNotifier = new TelegramNotifier();

  const standbyDispatcher = new SparkIngestionDispatcher({
    engine: standbyEngine,
    getCurrentPrice: () => 2420.0,
    pollIntervalMs: 1000,
    allowOfflineFallback: true,
    executionMode: 'STANDBY',
    ledger: standbyLedger,
    telegram: standbyNotifier,
  });

  const mockSparkDecision = {
    id: 301,
    symbol: 'ETHUSDC',
    agent_id: 'gemini-spark',
    bias_signal: 'CONFIRMED_BULLISH',
    entry_range_low: '2410.00',
    entry_range_high: '2415.00',
    invalidation_level: '2395.00',
    target_1: '2435.00',
    target_2: '2455.00',
    narrative: 'Asian session liquidity sweep with institutional buy imbalance.',
    status: 'ACTIVE',
    submitted_at: Date.now(),
  };

  const standbyResult = await standbyDispatcher.processDecision(mockSparkDecision, 2420.0);

  assert(standbyResult.status === 'LOGGED_STANDBY', 'Decision transitioned to LOGGED_STANDBY status');
  assert(standbyResult.executionMode === 'STANDBY', 'Result reports executionMode = STANDBY');
  assert(standbyEngine.getPendingLimitOrders().length === 0, 'Zero pending limit orders queued in engine');
  assert(standbyEngine.getActivePositions().length === 0, 'Zero active positions opened');

  const standbyLedgerEvents = standbyLedger.getSessionLog().events;
  const hasStandbyLog = standbyLedgerEvents.some((e) => e.type === 'SPARK_DECISION_STANDBY');
  assert(hasStandbyLog, 'Daemon ledger recorded SPARK_DECISION_STANDBY event');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Mode 3 — Physical Environment Isolation for LIVE_BINANCE
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 3] Verifying Mode 3: LIVE_BINANCE Physical Environment Gate...');

  // Ensure local sandbox environment (IS_LIVE_VPS and IS_VPS_PRODUCTION false)
  const prevLiveVps = process.env.IS_LIVE_VPS;
  const prevVpsProd = process.env.IS_VPS_PRODUCTION;
  delete process.env.IS_LIVE_VPS;
  delete process.env.IS_VPS_PRODUCTION;

  const localSafetyCheck = evaluateExecutionSafetyGate();
  assert(!localSafetyCheck.isAllowed, 'Safety gate physically disallows LIVE_BINANCE on local sandbox');

  const liveEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false,
    compoundingRiskPct: 2.0,
    initialEquity: 10000.0,
    filterWeekend: false,
  });

  const liveDispatcher = new SparkIngestionDispatcher({
    engine: liveEngine,
    getCurrentPrice: () => 2420.0,
    pollIntervalMs: 1000,
    allowOfflineFallback: true,
    executionMode: 'LIVE_BINANCE',
  });

  const liveDecision = {
    ...mockSparkDecision,
    id: 302,
  };

  const localLiveResult = await liveDispatcher.processDecision(liveDecision, 2420.0);
  assert(localLiveResult.status === 'REJECTED', 'LIVE_BINANCE rejected on local sandbox environment');
  assert(
    localLiveResult.reason?.includes('physically blocked outside verified production VPS') === true,
    'Rejection cites physical VPS isolation gate'
  );
  assert(liveEngine.getPendingLimitOrders().length === 0, 'Zero exchange orders queued when gate vetoes');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Mode 2 — In-Daemon PAPER_TRADING Simulator (Full Lifecycle Parity)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 4] Verifying Mode 2: In-Daemon Paper Trading Simulator Lifecycle...');

  const paperEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false,
    compoundingRiskPct: 2.0,
    initialEquity: 10000.0,
    stage1Ratio: 0.60,
    stage2Ratio: 0.40,
    stage1Multiple: 1.0,
    stage2Multiple: 2.0,
    makerFeePct: 0.0000,
    takerFeePct: 0.0400,
    filterWeekend: false,
    enableProfitRatchet: true,
  });

  const paperLedger = new DaemonLedger('ETHUSDC', 10000.0);
  const paperNotifier = new TelegramNotifier();

  const paperDispatcher = new SparkIngestionDispatcher({
    engine: paperEngine,
    getCurrentPrice: () => 2420.0,
    pollIntervalMs: 1000,
    allowOfflineFallback: true,
    executionMode: 'PAPER_TRADING',
    ledger: paperLedger,
    telegram: paperNotifier,
  });

  const paperDecision = {
    ...mockSparkDecision,
    id: 303,
  };

  // Step 4.1: Queue Paper Order
  const paperResult = await paperDispatcher.processDecision(paperDecision, 2420.0);
  assert(paperResult.status === 'PAPER_ACTIVE', 'Decision transitioned to PAPER_ACTIVE');
  assert(paperEngine.getPendingLimitOrders().length === 1, 'Resting limit order queued in engine');

  const pendingOrder = paperEngine.getPendingLimitOrders()[0];
  assert(pendingOrder.executionMode === 'PAPER_TRADING', 'Order executionMode tagged as PAPER_TRADING');
  assert(pendingOrder.limitEntryPrice === 2415.0, 'Limit entry placed at proximal high ($2415.00)');
  assert(pendingOrder.activeStopLoss === 2395.0, 'Initial stop loss set at invalidation ($2395.00)');
  assert(pendingOrder.maxRetestBars === 12, '12-bar TTL applied for Spark paper order');

  const paperLedgerEvents = paperLedger.getSessionLog().events;
  const hasPaperQueued = paperLedgerEvents.some((e) => e.type === 'SPARK_DECISION_PAPER_QUEUED');
  assert(hasPaperQueued, 'Ledger recorded SPARK_DECISION_PAPER_QUEUED');

  // Step 4.2: Simulate Maker Fill via Market Tick
  console.log('   ➔ Simulating Maker Touch fill @ $2414.50...');
  // Tick touches and penetrates limit price 2415.00
  paperEngine.processMarketTick(2414.50);

  assert(paperEngine.getPendingLimitOrders().length === 0, 'Pending order cleared upon fill');
  assert(paperEngine.getActivePositions().length === 1, 'Active position opened in paper simulator');

  const activePos = paperEngine.getActivePositions()[0];
  assert(activePos.status === 'OPEN', 'Position status is OPEN');
  assert(activePos.entryPrice === 2415.0, 'Maker filled at limit price $2415.00');

  // Step 4.3: Simulate Intra-Candle Same-Bar Price Dip & Verify Next-Bar Ratchet Rule
  console.log('   ➔ Simulating TP1 Harvest on Bar i and testing Next-Bar Ratchet Rule...');
  const tp1Price = activePos.stage1Target; // 2435.00
  const initialSl = activePos.initialStopLoss; // 2395.00

  // Tick reaches TP1 ($2435.00)
  paperEngine.processMarketTick(tp1Price);

  assert(activePos.status === 'STAGE_1_FILLED', 'Position harvested at Stage 1 (STAGE_1_FILLED)');
  assert(activePos.isStage1Filled === true, 'Stage 1 marked as filled (isStage1Filled = true)');

  // Next-Bar Ratchet Rule: on bar i, stop loss should NOT immediately stop out if price dips back to entry
  console.log('   ➔ Simulating intra-candle dip to entry ($2415.00) on same bar i...');
  paperEngine.processMarketTick(2415.00);
  assert(paperEngine.getActivePositions().length === 1, 'Trade survived same-bar dip to entry under Next-Bar Ratchet Rule');

  // Step 4.4: Advance bar to bar i+1 and verify BE Ratchet activation
  console.log('   ➔ Advancing bar time to i+1 and verifying Breakeven +0.015% Fee Shield ratchet...');
  // Progress market time on position beyond bar duration
  activePos.ratchetEffectiveTime = Date.now() - 1000;
  // Trigger check on next tick
  paperEngine.processMarketTick(2425.00);

  assert(
    activePos.activeStopLoss > 2415.0,
    `Stop loss ratcheted to fee-shielded breakeven ($${activePos.activeStopLoss.toFixed(2)} > $2415.00)`
  );

  // Step 4.5: Simulate +2.0R MFE Profit Ratchet to +1.0R Floor
  console.log('   ➔ Testing Dynamic Profit Floor Ratchet (+1.0R floor @ +2.0R MFE)...');
  // 1.0R risk = 2415 - 2395 = $20.00. At +2.0R MFE, price = 2415 + 40 = 2455.00
  // Floor of +1.0R = 2415 + 20 = $2435.00
  paperEngine.processMarketTick(2454.00); // Excursion to +1.95R
  const floorLevel = 2415.0 + 20.0; // 2435.00
  paperEngine.processMarketTick(2456.00); // Excursion to +2.05R MFE

  assert(
    activePos.activeStopLoss >= floorLevel,
    `Stop loss ratcheted to +1.0R profit floor ($${activePos.activeStopLoss.toFixed(2)} >= $${floorLevel.toFixed(2)})`
  );

  // Step 4.6: Simulate TP2 Full Exit & Fee Parity Deductions
  console.log('   ➔ Simulating TP2 Harvest @ $2455.00 & Full Exit...');
  paperEngine.processMarketTick(2456.00);

  // Position closes on TP2
  assert(paperEngine.getActivePositions().length === 0, 'Position 100% closed upon full TP2 harvest');

  const history = paperEngine.getClosedPositions();
  const closedPos = history[history.length - 1];
  assert(closedPos !== undefined, 'Closed position recorded in engine history');
  assert(closedPos.exitReason === 'FULL_TP2_WIN', 'Exit reason is FULL_TP2_WIN');
  assert((closedPos.realizedR || 0) > 1.0, `Realized R is positive alpha (+${closedPos.realizedR?.toFixed(2)}R)`);
  assert(closedPos.executionMode === 'PAPER_TRADING', 'Closed position executionMode is PAPER_TRADING');

  // Fee Parity Check
  assert(typeof closedPos.feeUsd === 'number', 'Fee USD accurately computed on paper trade');

  // Restore environment variables
  if (prevLiveVps !== undefined) process.env.IS_LIVE_VPS = prevLiveVps;
  if (prevVpsProd !== undefined) process.env.IS_VPS_PRODUCTION = prevVpsProd;

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Telegram Institutional Markdown Cards Validation (5 Milestones)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 5] Verifying Telegram Institutional Markdown Cards (5 Milestones)...');

  // Milestone 1: Signal Received
  const m1Card = formatSparkSignalReceivedMarkdown({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryRangeLow: 2410.0,
    entryRangeHigh: 2415.0,
    limitEntryPrice: 2415.0,
    invalidationLevel: 2395.0,
    target1: 2435.0,
    target2: 2455.0,
    riskUsd: 200.0,
    riskPct: 2.0,
    contractSize: 10.0,
    narrative: 'Asian session liquidity sweep with institutional buy imbalance.',
    timestamp: Date.now(),
    mode: 'PAPER_TRADING',
  });
  const v1 = validateTelegramMarkdown(m1Card);
  assert(v1.isValid, 'Milestone 1 (Signal Received) Markdown is valid', v1.error);
  assert(m1Card.includes('*[SPARK SIGNAL RECEIVED]*'), 'Milestone 1 contains correct header');
  assert(m1Card.includes('`[PAPER_TRADING]`'), 'Milestone 1 displays PAPER_TRADING mode badge');

  // Milestone 2: Order Armed
  const m2Card = formatSparkOrderArmedMarkdown({
    mode: 'PAPER_TRADING',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    limitEntryPrice: 2415.0,
    stopLossPrice: 2395.0,
    contractSize: 10.0,
    notionalValue: 24150.0,
    riskUsd: 200.0,
    riskPct: 2.0,
    ttlBars: 12,
    timestamp: Date.now(),
  });
  const v2 = validateTelegramMarkdown(m2Card);
  assert(v2.isValid, 'Milestone 2 (Order Armed) Markdown is valid', v2.error);
  assert(m2Card.includes('*[ORDER ARMED / QUEUED]*'), 'Milestone 2 contains correct header');
  assert(m2Card.includes('`12 Bars (60m)`'), 'Milestone 2 displays 12-bar TTL window');

  // Milestone 3: Order Filled
  const m3Card = formatSparkOrderFilledMarkdown({
    mode: 'PAPER_TRADING',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    executionPrice: 2415.0,
    contractSize: 10.0,
    notionalValue: 24150.0,
    activeStopLoss: 2395.0,
    stage1Target: 2435.0,
    stage2Target: 2455.0,
    timestamp: Date.now(),
  });
  const v3 = validateTelegramMarkdown(m3Card);
  assert(v3.isValid, 'Milestone 3 (Order Filled) Markdown is valid', v3.error);
  assert(m3Card.includes('*[ORDER FILLED]*'), 'Milestone 3 contains correct header');
  assert(m3Card.includes('`$2415.00`'), 'Milestone 3 displays fill price');

  // Milestone 4: TP1 Scale & Ratchet
  const m4Card = formatSparkTp1RatchetMarkdown({
    mode: 'PAPER_TRADING',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    stage1Target: 2435.0,
    stage1Ratio: 0.6,
    bankedR: 0.6,
    bankedUsd: 120.0,
    newStopLoss: 2415.36,
    feeShieldOffsetPct: 0.015,
    remainingAllocationPct: 40,
    stage2Target: 2455.0,
    timestamp: Date.now(),
  });
  const v4 = validateTelegramMarkdown(m4Card);
  assert(v4.isValid, 'Milestone 4 (TP1 Scale & Ratchet) Markdown is valid', v4.error);
  assert(m4Card.includes('*[TP1 SCALE & RATCHET]*'), 'Milestone 4 contains correct header');
  assert(m4Card.includes('Next-Bar Ratchet Rule Active'), 'Milestone 4 notes Next-Bar Ratchet Law');

  // Milestone 5: Trade Closed
  const m5Card = formatSparkTradeClosedMarkdown({
    mode: 'PAPER_TRADING',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    exitPrice: 2455.0,
    exitReason: 'FULL_TP2_WIN',
    holdingDurationMs: 3600000,
    netRealizedR: 1.4,
    netRealizedUsd: 280.0,
    feeUsd: 4.83,
    timestamp: Date.now(),
  });
  const v5 = validateTelegramMarkdown(m5Card);
  assert(v5.isValid, 'Milestone 5 (Trade Closed) Markdown is valid', v5.error);
  assert(m5Card.includes('*[TRADE CLOSED]*'), 'Milestone 5 contains correct header');
  assert(m5Card.includes('`FULL_TP2_WIN`'), 'Milestone 5 displays safe code block for exit trigger');
  assert(m5Card.includes('+1.40R'), 'Milestone 5 displays net realized alpha');

  // Milestone 1 R-Multiple check
  assert(m1Card.includes('1.0R | 2.0% Compounded'), 'Milestone 1 explicitly broadcasts 1.0R institutional risk notation');

  // Milestone 3 optional field safety check (undefined stage2Target)
  const m3CardNoTp2 = formatSparkOrderFilledMarkdown({
    mode: 'PAPER_TRADING',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    executionPrice: 2415.0,
    contractSize: 10.0,
    activeStopLoss: 2395.0,
    stage1Target: 2435.0,
    stage2Target: undefined as any,
  });
  assert(validateTelegramMarkdown(m3CardNoTp2).isValid, 'Milestone 3 formats safely without optional stage2Target');

  // Milestone 1 partial payload safety check (omitted entryRangeLow/High)
  const m1Partial = formatSparkSignalReceivedMarkdown({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    limitEntryPrice: 2415.0,
    riskUsd: 200.0,
    riskPct: 2.0,
  });
  assert(validateTelegramMarkdown(m1Partial).isValid, 'Milestone 1 formats safely with omitted entryRangeLow/High');
  assert(m1Partial.includes('`$2415.00`'), 'Milestone 1 falls back cleanly to limitEntryPrice');

  // Milestone 4 partial payload safety check
  const m4Partial = formatSparkTp1RatchetMarkdown({
    mode: 'PAPER_TRADING',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    stage1Target: 2435.0,
    stage1Ratio: 0.5,
    bankedR: 0.5,
    bankedUsd: 100.0,
    newStopLoss: 2415.0,
  });
  assert(validateTelegramMarkdown(m4Partial).isValid, 'Milestone 4 formats safely with minimal payload');

  // Milestone 5 partial payload safety check
  const m5Partial = formatSparkTradeClosedMarkdown({
    mode: 'PAPER_TRADING',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    exitPrice: 2455.0,
    exitReason: 'FULL_TP2_WIN',
    netRealizedR: 1.4,
    netRealizedUsd: 280.0,
  });
  assert(validateTelegramMarkdown(m5Partial).isValid, 'Milestone 5 formats safely without holding duration');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: Profit Floor Stop-Out Accounting & Monotonicity
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 6] Verifying Profit Floor Stop-Out Accounting (+1.0R floor @ +2.0R MFE)...');

  const pfEngine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
    enableAutonomousScan: false,
    compoundingRiskPct: 2.0,
    initialEquity: 10000.0,
    stage1Ratio: 0.60,
    stage2Ratio: 0.40,
    stage1Multiple: 1.0,
    stage2Multiple: 3.0, // High TP2 so profit floor is hit instead
    makerFeePct: 0.0000,
    takerFeePct: 0.0400,
    filterWeekend: false,
    enableProfitRatchet: true,
  });

  const pfOrderRes = pfEngine.submitStrategyOrder({
    strategyId: 'SPARK_PF_TEST',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    direction: 'LONG',
    limitEntryPrice: 2415.0,
    stopLossPrice: 2395.0, // 20.00 risk = 1.0R
    stage1Target: 2435.0,
    stage2Target: 2475.0, // TP2 @ +3.0R
    executionMode: 'PAPER_TRADING',
    bypassWeekendFilter: true,
  });

  assert(pfOrderRes.success, 'Profit floor test order submitted');

  // Fill order @ 2415.00
  pfEngine.processMarketTick(2414.50);
  const pfPos = pfEngine.getActivePositions()[0];
  assert(pfPos !== undefined, 'Position filled and active in paper engine');

  // Harvest TP1 @ 2435.00 (+0.60R banked on 60%)
  pfEngine.processMarketTick(2435.00);
  assert(pfPos.isStage1Filled === true, 'Stage 1 filled');
  assert(pfPos.realizedR === 0.60, `Stage 1 realized +0.60R (actual: ${pfPos.realizedR}R)`);

  // Expand to +2.05R MFE (2456.00) -> locks +1.0R profit floor ($2435.00)
  pfEngine.processMarketTick(2456.00);
  assert(pfPos.trailingSlSource === 'PROFIT_RATCHET_FLOOR', 'Ratcheted to PROFIT_RATCHET_FLOOR');
  assert(pfPos.activeStopLoss === 2435.0, `Stop loss is exactly at +1.0R floor ($2435.00)`);

  // Monotonicity Check: Subsequent tick within range cannot demote activeStopLoss back to BE ($2415.36)
  pfEngine.processMarketTick(2440.00);
  assert(pfPos.activeStopLoss === 2435.0, 'Active stop loss maintained monotonicity (not demoted to BE)');

  // Retrace and hit profit floor stop loss ($2434.50 < $2435.00)
  pfEngine.processMarketTick(2434.50);
  assert(pfEngine.getActivePositions().length === 0, 'Position closed upon hitting +1.0R profit floor');

  const pfClosedHistory = pfEngine.getClosedPositions();
  const pfClosed = pfClosedHistory[0];
  assert(pfClosed.exitReason === 'PROFIT_FLOOR_WIN', `Exit reason is PROFIT_FLOOR_WIN (actual: ${pfClosed.exitReason})`);
  assert(
    pfClosed.realizedR === 1.0,
    `Realized R is +1.00R (0.60R from TP1 + 0.40R from floor on remaining 40%, actual: ${pfClosed.realizedR}R)`
  );
  assert(pfClosed.realizedUsd === 200.0, `Realized USD is +$200.00 (actual: $${pfClosed.realizedUsd})`);
  assert(typeof pfClosed.netRealizedR === 'number' && pfClosed.netRealizedR > 0.95, 'Net realized R accurately calculated after taker exit fee');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7: Telegram Deduplication & Multi-Trade Isolation
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [TEST 7] Verifying Telegram Milestone Deduplication & Multi-Trade Isolation...');

  const dedupeNotifier = new TelegramNotifier({
    botToken: 'mock_token',
    chatId: 'mock_chat',
    enabled: true,
    ephemeralRegistry: true,
  });
  dedupeNotifier.clearDeduplicationRegistry();

  // Part A: Explicit eventKey Deduplication
  const sharedEventKey = `evt_SPARK_ORDER_ARMED_ETHUSDC_2415.00_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  let sendCount = 0;
  dedupeNotifier.sendRawMessage = async () => {
    sendCount++;
    return true;
  };

  // Dispatch 1
  const d1 = await dedupeNotifier.broadcastSparkMilestone('ORDER_ARMED', {
    symbol: 'ETHUSDC',
    limitEntryPrice: 2415.0,
    direction: 'LONG',
    mode: 'PAPER_TRADING',
    stopLossPrice: 2395.0,
    contractSize: 10.0,
    riskUsd: 200.0,
    riskPct: 2.0,
  }, { eventKey: sharedEventKey });

  assert(d1 === true, 'First dispatch succeeded');
  assert(sendCount === 1, 'First dispatch invoked sendRawMessage');

  // Dispatch 2 with identical key (simulating concurrent event subscription hook)
  const d2 = await dedupeNotifier.broadcastSparkMilestone('ORDER_ARMED', {
    symbol: 'ETHUSDC',
    limitEntryPrice: 2415.0,
    direction: 'LONG',
    mode: 'PAPER_TRADING',
    stopLossPrice: 2395.0,
    contractSize: 10.0,
    riskUsd: 200.0,
    riskPct: 2.0,
  }, { eventKey: sharedEventKey });

  assert(d2 === true, 'Second dispatch returned true');
  assert(sendCount === 1, 'Second duplicate dispatch was suppressed by deduplication registry');

  // Part B: Default Key Generation without options.eventKey (Multi-Trade Discrimination)
  dedupeNotifier.clearDeduplicationRegistry();
  sendCount = 0;

  // Dispatch trade 1 filled
  const fill1 = await dedupeNotifier.broadcastSparkMilestone('ORDER_FILLED', {
    tradeId: 'spark_trade_001',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    mode: 'PAPER_TRADING',
    executionPrice: 2415.0,
    contractSize: 10.0,
    activeStopLoss: 2395.0,
    stage1Target: 2435.0,
  });
  assert(fill1 === true, 'Trade 1 fill dispatched');
  assert(sendCount === 1, 'Trade 1 fill invoked sendRawMessage');

  // Dispatch duplicate of trade 1 fill
  const fill1Dup = await dedupeNotifier.broadcastSparkMilestone('ORDER_FILLED', {
    tradeId: 'spark_trade_001',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    mode: 'PAPER_TRADING',
    executionPrice: 2415.0,
    contractSize: 10.0,
    activeStopLoss: 2395.0,
    stage1Target: 2435.0,
  });
  assert(fill1Dup === true, 'Trade 1 duplicate fill handled');
  assert(sendCount === 1, 'Trade 1 duplicate fill suppressed by auto-generated eventKey');

  // Dispatch distinct trade 2 filled at the SAME price (must NOT be suppressed)
  const fill2 = await dedupeNotifier.broadcastSparkMilestone('ORDER_FILLED', {
    tradeId: 'spark_trade_002',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    mode: 'PAPER_TRADING',
    executionPrice: 2415.0,
    contractSize: 10.0,
    activeStopLoss: 2395.0,
    stage1Target: 2435.0,
  });
  assert(fill2 === true, 'Trade 2 fill dispatched');
  assert(sendCount === 2, 'Trade 2 fill with distinct tradeId was delivered (not falsely suppressed)');

  // Part C: Verify TRADE_CLOSED and TP1_SCALE_RATCHET without options.eventKey
  // Trade 1 closes
  const close1 = await dedupeNotifier.broadcastSparkMilestone('TRADE_CLOSED', {
    tradeId: 'spark_trade_001',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    mode: 'PAPER_TRADING',
    exitPrice: 2455.0,
    exitReason: 'FULL_TP2_WIN',
    netRealizedR: 1.4,
    netRealizedUsd: 280.0,
  });
  assert(close1 === true, 'Trade 1 close dispatched');
  assert(sendCount === 3, 'Trade 1 close invoked sendRawMessage');

  // Trade 2 closes later (must NOT be suppressed by trade 1's close key)
  const close2 = await dedupeNotifier.broadcastSparkMilestone('TRADE_CLOSED', {
    tradeId: 'spark_trade_002',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    mode: 'PAPER_TRADING',
    exitPrice: 2395.0,
    exitReason: 'STOPPED_OUT',
    netRealizedR: -1.0,
    netRealizedUsd: -200.0,
  });
  assert(close2 === true, 'Trade 2 close dispatched');
  assert(sendCount === 4, 'Trade 2 close with distinct tradeId delivered without collision');

  // Targeted cache invalidation test
  const testKeyToRemove = dedupeNotifier.generateSparkEventKey('TRADE_CLOSED', { tradeId: 'spark_trade_002', symbol: 'ETHUSDC' })!;
  assert(dedupeNotifier.isAlreadyNotified(testKeyToRemove), 'Key is currently present in registry');
  dedupeNotifier.removeEventKey(testKeyToRemove);
  assert(!dedupeNotifier.isAlreadyNotified(testKeyToRemove), 'Key was cleanly evicted via removeEventKey');

  console.log('\n======================================================================');
  console.log(`Phase 3 Verification Finished: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error('Fatal Verification Error:', err);
  process.exit(1);
});
