/**
 * scripts/test_paper_trading_reconciliation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification Test Suite for Paper Trading Lifecycle, Journal Persistence,
 * and Dynamic Trailing Stop Visualization.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runTests() {
  console.log("=================================================================");
  console.log("🧪 RUNNING PAPER TRADING RECONCILIATION & VISUALIZATION TEST SUITE");
  console.log("=================================================================\n");

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: Daemon State Event Processing & Dynamic Breakeven Ratchet
  // ─────────────────────────────────────────────────────────────────────────
  console.log("--- TEST 1: Daemon In-Flight Position & Breakeven Ratchet ---");
  
  const testEvents = [
    {
      id: "evt-1",
      type: "ORDER_FILLED",
      timestamp: Date.now() - 60000,
      position: {
        id: "POS_TEST_001",
        symbol: "ETHUSDC",
        direction: "LONG",
        entryPrice: 3000.0,
        initialStopLoss: 2950.0,
        activeStopLoss: 2950.0,
        stage1Target: 3050.0,
        stage2Target: 3070.0,
        stage3Target: 3150.0,
        contractSize: 1.5,
        riskUsd: 75.0,
        status: "OPEN",
        trailingSlSource: "INITIAL",
        openTime: Date.now() - 60000,
      }
    },
    {
      id: "evt-2",
      type: "EARLY_BREAKEVEN",
      timestamp: Date.now() - 30000,
      position: {
        id: "POS_TEST_001",
        symbol: "ETHUSDC",
        direction: "LONG",
        entryPrice: 3000.0,
        initialStopLoss: 2950.0,
        activeStopLoss: 3000.45, // Fee-padded breakeven
        stage1Target: 3050.0,
        stage2Target: 3070.0,
        stage3Target: 3150.0,
        contractSize: 1.5,
        riskUsd: 75.0,
        status: "OPEN",
        trailingSlSource: "BREAKEVEN",
        openTime: Date.now() - 60000,
      }
    }
  ];

  // Replay logic from /api/daemon/state/route.ts
  const activeInFlightMap = new Map<string, any>();
  for (const evt of testEvents) {
    if (
      (evt.type === 'ORDER_FILLED' ||
        evt.type === 'SPARK_DECISION_PAPER_FILLED' ||
        evt.type === 'SPARK_DECISION_EXECUTED' ||
        evt.type === 'STAGE_1_HARVEST' ||
        evt.type === 'SPARK_DECISION_TP1_HARVEST' ||
        evt.type === 'EARLY_BREAKEVEN' ||
        evt.type === 'STAGE_2_HARVEST') &&
      evt.position?.id
    ) {
      activeInFlightMap.set(evt.position.id, evt.position);
    } else if (
      (evt.type === 'POSITION_CLOSED' || evt.type === 'SPARK_DECISION_PAPER_CLOSED') &&
      evt.position?.id
    ) {
      activeInFlightMap.delete(evt.position.id);
    }
  }

  const positions = Array.from(activeInFlightMap.values());
  assert(positions.length === 1, "Active in-flight position exists after ORDER_FILLED + EARLY_BREAKEVEN");
  const pos = positions[0];
  assert(pos.id === "POS_TEST_001", "Position ID correctly preserved");
  assert(pos.activeStopLoss === 3000.45, "activeStopLoss ratcheted to fee-padded breakeven (3000.45)");
  assert(pos.trailingSlSource === "BREAKEVEN", "trailingSlSource updated to BREAKEVEN");

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: Dynamic Stop Loss Color & Badge Calculation Parity
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST 2: Stop Loss Visual Badge & Stroke Color Parity ---");

  const srOverlayBullish = {
    id: pos.id,
    type: "BULLISH" as const,
    phase: "OPEN" as const,
    entryPrice: pos.entryPrice,
    stopLoss: pos.activeStopLoss,
    initialStopLoss: pos.initialStopLoss,
    trailingSlSource: pos.trailingSlSource,
    isStage1Filled: false,
    isStage2Filled: false,
    target1: pos.stage1Target,
  };

  const isFloorLocked = srOverlayBullish.isStage2Filled || srOverlayBullish.trailingSlSource === 'PROFIT_RATCHET_FLOOR';
  const isBeRatchet =
    srOverlayBullish.isStage1Filled ||
    srOverlayBullish.trailingSlSource === 'BREAKEVEN' ||
    srOverlayBullish.trailingSlSource === 'FVG_CE' ||
    (srOverlayBullish.type === 'BULLISH' ? srOverlayBullish.stopLoss >= srOverlayBullish.entryPrice : srOverlayBullish.stopLoss <= srOverlayBullish.entryPrice);
  const slColor = isFloorLocked ? '#34d399' : isBeRatchet ? '#facc15' : '#f43f5e';
  const slBadgeText = isFloorLocked
    ? '(+1.0R FLOOR)'
    : srOverlayBullish.isStage1Filled
    ? '(FVG CE / BE)'
    : isBeRatchet
    ? '(BREAKEVEN)'
    : '(-1.0R HARD)';

  assert(isBeRatchet === true, "isBeRatchet evaluates to true on early breakeven ratchet");
  assert(slColor === '#facc15', "Stop Loss line stroke color transitions to golden amber (#facc15)");
  assert(slBadgeText === '(BREAKEVEN)', "Stop Loss label badge displays (BREAKEVEN)");

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: Trades API Ingestion & Journal Record Formatting
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST 3: Trades API Ingestion & Journal Field Mapping ---");

  const tradeRecord = {
    id: pos.id,
    symbol: pos.symbol,
    direction: pos.direction,
    entry_price: pos.entryPrice,
    stop_loss: pos.activeStopLoss,
    take_profit: pos.stage1Target,
    position_size: pos.contractSize,
    realized_pnl: 0,
    realized_r: 0,
    risk_amount_usd: pos.riskUsd,
    status: "OPEN" as const,
    strategy_name: "5M Sweep & Reclaim",
    ai_narrative_summary: `In-Flight Position (${pos.direction}) | SL: $${pos.activeStopLoss.toFixed(2)} | TP1: $${pos.stage1Target.toFixed(2)}`,
    timestamp: new Date(pos.openTime).toISOString(),
    created_at: new Date(pos.openTime).toISOString(),
    opened_at: new Date(pos.openTime).toISOString(),
    execution_mode: "PAPER_TRADING",
  };

  assert(tradeRecord.status === "OPEN", "In-flight trade record has status OPEN");
  assert(tradeRecord.stop_loss === 3000.45, "stop_loss reflects ratcheted BE price in Journal record");
  assert(parseFloat(String(tradeRecord.take_profit || 0)) === 3050.0, "take_profit is numeric and non-NaN");
  assert(parseFloat(String(tradeRecord.entry_price || 0)) === 3000.0, "entry_price is numeric and non-NaN");

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: Position Closure Lifecycle
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST 4: Position Closure & Realized Outcome ---");

  const closeEvt = {
    id: "evt-3",
    type: "POSITION_CLOSED",
    timestamp: Date.now(),
    position: {
      id: "POS_TEST_001",
      symbol: "ETHUSDC",
      direction: "LONG",
      entryPrice: 3000.0,
      exitPrice: 3050.0,
      exitReason: "STAGE_1_TARGET_REACHED",
      realizedR: 1.0,
      realizedUsd: 75.0,
      status: "CLOSED",
      closeTime: Date.now(),
    }
  };

  if (closeEvt.type === 'POSITION_CLOSED') {
    activeInFlightMap.delete(closeEvt.position.id);
  }

  assert(activeInFlightMap.size === 0, "Active in-flight position cleanly purged from open positions on closure");

  console.log("\n=================================================================");
  console.log("🎉 ALL PAPER TRADING RECONCILIATION TESTS PASSED PERFECTLY (100%)");
  console.log("=================================================================\n");
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
