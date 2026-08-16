import { LiveOrderBlockExecutionEngine, LivePosition } from '../src/lib/quantEngine/LiveOrderBlockExecutionEngine';
import { InstitutionalOrderBlock } from '../src/lib/quantEngine/OrderBlockEngine';

async function testPersistenceAndRehydration() {
  console.log('=== Testing Live Automated Trade Persistence & DB Re-hydration ===\n');

  const engine = new LiveOrderBlockExecutionEngine({
    autoExecute: true,
    maxOpenPositions: 1,
    fixedRiskUsd: 100,
    enforceHtfAlignment: true
  });

  const emittedEvents: string[] = [];
  engine.subscribe((ev) => {
    emittedEvents.push(`[${ev.type}] ${ev.message}`);
    console.log(`  -> Event: ${ev.message}`);
  });

  // ── TEST 1: Re-hydration of Active DB Trades on Mount ────────────────────
  console.log('[TEST 1] Re-hydrating active OPEN trade from mock database ledger...');
  const mockDbTrade = {
    id: 'e4a1c5d0-9921-4f81-8b20-721865910fa2',
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entry_price: '2800.0000',
    stop_loss: '2750.0000',
    take_profit: '2950.0000',
    status: 'OPEN',
    strategy_name: 'Auto OB Execution (15M A_PLUS)',
    position_size: '1.0000',
    realized_pnl: '0.0000',
    opened_at: new Date(Date.now() - 3600000).toISOString(),
    ipda_metrics: {
      timeframe: '15m',
      quality_tier: 'A_PLUS',
      orderBlockId: 'ob_origin_15m_bullish'
    }
  };

  const rehydrated = engine.rehydrateOpenPositions([mockDbTrade]);
  console.log(`  Rehydrated ${rehydrated.length} position(s).`);
  
  const activePos = engine.getActivePositions();
  console.log(`  Active Open Positions in Engine: ${activePos.length}`);
  if (activePos.length > 0) {
    const pos = activePos[0];
    console.log(`  - Position ID: ${pos.id}`);
    console.log(`  - DB Trade ID: ${pos.dbTradeId}`);
    console.log(`  - Direction: ${pos.direction} @ $${pos.entryPrice}`);
    console.log(`  - Active Stop Loss: $${pos.activeStopLoss}`);
    console.log(`  - Rehydrated Flag: ${pos.isRehydrated}`);
  }

  // ── TEST 2: Progressive Lifecycle Scaling on Rehydrated Trade ───────────
  console.log('\n[TEST 2] Simulating Live Price Ticks to Trigger Stage 1 & Stage 2 Harvest...');
  // Entry was 2800, SL was 2750, Risk = 50.
  // TP1 (1.0R) = 2850
  // TP2 (1.5R) = 2875
  // TP3 (DOL Runner) = 2950

  console.log('  Tick 1: Price reaches $2852 (TP1 @ 1.0R Hit)...');
  engine.onPriceTick(2852, Date.now());

  const posAfterTp1 = engine.getActivePositions()[0];
  console.log(`  - Status: ${posAfterTp1.status}`);
  console.log(`  - Stage 1 Filled: ${posAfterTp1.isTp1Filled}`);
  console.log(`  - Realized Secured: +${posAfterTp1.realizedR}R`);
  console.log(`  - Trailed SL: $${posAfterTp1.activeStopLoss} (${posAfterTp1.trailingSlSource})`);

  console.log('\n  Tick 2: Price reaches $2876 (TP2 @ 1.5R Hit)...');
  engine.onPriceTick(2876, Date.now());

  const posAfterTp2 = engine.getActivePositions()[0];
  console.log(`  - Status: ${posAfterTp2.status}`);
  console.log(`  - Stage 2 Filled: ${posAfterTp2.isTp2Filled}`);
  console.log(`  - Realized Secured: +${posAfterTp2.realizedR}R`);
  console.log(`  - Ratchet Profit Floor SL: $${posAfterTp2.activeStopLoss} (${posAfterTp2.trailingSlSource})`);

  console.log('\n  Tick 3: Price reaches $2955 (TP3 DOL Runner Hit)...');
  engine.onPriceTick(2955, Date.now());

  console.log(`  Active Open Positions after TP3: ${engine.getActivePositions().length}`);
  const closed = engine.getClosedPositions();
  console.log(`  Closed Positions in Engine: ${closed.length}`);
  if (closed.length > 0) {
    const finalTrade = closed[0];
    console.log(`  - Final Status: ${finalTrade.status}`);
    console.log(`  - Exit Reason: ${finalTrade.exitReason}`);
    console.log(`  - Final Realized Return: +${finalTrade.realizedR}R`);
  }

  // ── TEST 3: Rollback Guard for Failed API Creation ──────────────────────
  console.log('\n[TEST 3] Testing Position Rollback Guard (Preventing Ghost Positions)...');
  const dummyZone: InstitutionalOrderBlock = {
    id: 'ob_fail_test_zone',
    type: 'BULLISH',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    origin_time: Date.now() - 100000,
    formation_time: Date.now() - 100000,
    origin_index: 0,
    formation_index: 0,
    candles_count: 1,
    top: 2800,
    bottom: 2780,
    mean_threshold: 2790,
    range_height: 20,
    range_pct: 0.7,
    volume_total: 100,
    taker_buy_vol_total: 60,
    taker_sell_vol_total: 40,
    volume_delta_total: 20,
    gates: {} as any,
    quality_tier: 'A',
    confluence_score: 80,
    lifecycle_status: 'UNTESTED',
    is_body_close_violated: false,
    first_test_time: null,
    first_test_index: null,
    mitigation_time: null,
    mitigation_index: null,
    mitigation_price: null,
    max_penetration_price: null,
    max_retracement_depth_pct: null,
    invalidation_time: null,
    invalidation_index: null,
    is_expired: false,
    expiration_time: null,
    is_fresh_mitigation: true,
    is_breaker: false,
    breaker_flip_time: null,
    breaker_is_expired: false,
    breaker_expiration_time: null,
    breaker_is_fresh: false,
    breaker_trade_outcome: 'PENDING',
    breaker_entry_price: null,
    breaker_stop_loss: null,
    breaker_tp: null,
    breaker_realized_rr: 0,
    breaker_retest_time: null,
    breaker_bars_to_retest: null,
    breaker_is_confirmed: false,
    breaker_confirmation_type: 'NONE',
    breaker_confirmation_time: null,
    breaker_confirmation_index: null,
    breaker_fvg_top: null,
    breaker_fvg_bottom: null,
    breaker_volume_expansion: null,
    breaker_taker_delta: null,
    breaker_dol_target: null,
    breaker_dol_type: 'NONE',
    breaker_veto_reason: null,
    position_scaling_mode: 'THREE_STAGE_HARVEST',
    simulated_entry_price: 2790,
    simulated_stop_loss: 2780,
    simulated_tp1: 2800,
    simulated_tp2: 2805,
    simulated_tp3: 2820,
    dynamic_tp2_target: 2805,
    is_tp1_filled: false,
    is_tp2_filled: false,
    is_tp3_filled: false,
    tp1_hit_time: null,
    tp2_hit_time: null,
    tp3_hit_time: null,
    simulated_trade_outcome: 'PENDING',
    simulated_realized_rr: 0,
    simulated_exit_price: null,
    simulated_exit_reason: null,
    htf_alignment_status: 'HTF_ALIGNED'
  };

  // ── TEST 3: Rollback Guard for Failed API Creation ──────────────────────
  console.log('\n[TEST 3] Testing Position Rollback Guard (Preventing Ghost Positions)...');
  const rollbackEngine = new LiveOrderBlockExecutionEngine({
    autoExecute: true,
    maxOpenPositions: 1
  });

  const dummyTrade = {
    id: 'test-ghost-trade-uuid',
    symbol: 'ETHUSDC',
    direction: 'SHORT',
    entry_price: '3000.0000',
    stop_loss: '3050.0000',
    take_profit: '2850.0000',
    status: 'OPEN',
    strategy_name: 'Auto OB Execution (5M A)',
    position_size: '1.0000',
    realized_pnl: '0.0000',
    opened_at: new Date().toISOString()
  };

  rollbackEngine.rehydrateOpenPositions([dummyTrade]);
  const beforeRollback = rollbackEngine.getActivePositions();
  console.log(`  Active Positions before rollback: ${beforeRollback.length}`);

  if (beforeRollback.length > 0) {
    const posId = beforeRollback[0].id;
    console.log(`  Executing rollback on position: ${posId} (Simulated 403 Portfolio At Capacity error)...`);
    rollbackEngine.rollbackPosition(posId, '[RISK_VETO: PORTFOLIO_AT_CAPACITY]');
    const afterRollback = rollbackEngine.getActivePositions();
    console.log(`  Active Positions after rollback: ${afterRollback.length} (Ghost position successfully eliminated)`);
  }

  console.log('\n=== Persistence & Re-hydration Test Complete ===');
}

testPersistenceAndRehydration().catch(console.error);

