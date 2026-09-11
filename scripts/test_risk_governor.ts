/**
 * test_risk_governor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Test Suite for GlobalRiskGovernor (Phase 4 Verification)
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests:
 * 1. Pre-trade approval under nominal conditions (Tier 1 sizing math check)
 * 2. Pre-trade rejection when Single-Trade Risk Ceiling is exceeded
 * 3. Daily Drawdown circuit breaker trip (Percentage & USD caps)
 * 4. Consecutive Loss Streak timeout trip (Anti-Tilt Governor)
 * 5. Daily Trade Frequency Cap trip (Anti-Chop Governor)
 * 6. Single-Position Cap check
 * 7. Manual Circuit Breaker Reset functionality
 * 8. Session Rollover at 00:00 UTC reset logic
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { GlobalRiskGovernor } from '../src/lib/risk/GlobalRiskGovernor';

async function runTests() {
  console.log('🧪 Starting GlobalRiskGovernor Institutional Test Suite...\n');
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(` ✅ PASS: ${testName}`);
      passedCount++;
    } else {
      console.error(` ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failedCount++;
    }
  }

  const testUser = 'test_quant_auditor@flowstate.local';

  // Test 1: Hydrate & Initialize
  console.log('--- Test 1: Hydration & Default Configuration ---');
  const { config, state } = await GlobalRiskGovernor.hydrateState(testUser);
  assert(config.risk_per_trade_pct === 2.0, 'Default operational risk is 2.0% ($1.0R)');
  assert(config.max_risk_limit_pct === 3.0, 'Default risk ceiling is 3.0%');
  assert(config.max_daily_loss_pct === 4.0, 'Default daily max loss is 4.0%');
  assert(config.max_consecutive_losses === 3, 'Default consecutive loss cap is 3');
  assert(config.max_daily_trades === 6, 'Default daily trade cap is 6');

  // Test 2: Nominal Pre-Trade Assessment
  console.log('\n--- Test 2: Nominal Pre-Trade Assessment ---');
  const nominalAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2100.0,
    stopLossPrice: 2090.0, // $10 stop distance
    currentEquity: 10000.0,
    currentOpenPositionsCount: 0,
    userEmail: testUser,
  });

  assert(nominalAssessment.isApproved, 'Nominal trade is approved');
  assert(nominalAssessment.calculatedRiskUsd === 200, 'Dollar risk is $200 (2% of $10,000)');
  assert(nominalAssessment.contractSize === 20, 'Calculated contract size is 20 ETH ($200 / $10)');
  assert(nominalAssessment.reason.includes('Approved: Risk $200.00'), 'Risk reason string formatted correctly');

  // Test 3: Single-Trade Ceiling Rejection
  console.log('\n--- Test 3: Single-Trade Risk Ceiling Check ---');
  // Temporarily configure operational risk to 4% (above 3% ceiling)
  await GlobalRiskGovernor.updateConfig({ risk_per_trade_pct: 4.0 }, testUser);
  const ceilingAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2100.0,
    stopLossPrice: 2090.0,
    currentEquity: 10000.0,
    currentOpenPositionsCount: 0,
    userEmail: testUser,
  });

  assert(!ceilingAssessment.isApproved, 'Trade rejected when operational risk exceeds ceiling');
  assert(
    ceilingAssessment.reason.includes('Single-trade risk ceiling exceeded'),
    'Rejection reason correctly identifies risk ceiling breach'
  );
  // Revert operational risk to 2.0%
  await GlobalRiskGovernor.updateConfig({ risk_per_trade_pct: 2.0 }, testUser);

  // Test 4: Single Position Cap (maxOpenPositions: 1)
  console.log('\n--- Test 4: Single Position Cap ---');
  const positionCapAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
    symbol: 'ETHUSDC',
    direction: 'SHORT',
    entryPrice: 2100.0,
    stopLossPrice: 2110.0,
    currentEquity: 10000.0,
    currentOpenPositionsCount: 1, // Already 1 open position
    userEmail: testUser,
  });

  assert(!positionCapAssessment.isApproved, 'Trade rejected when open position cap reached');
  assert(
    positionCapAssessment.reason.includes('Max concurrent open positions (1) reached'),
    'Rejection reason notes open position cap'
  );

  // Test 5: Consecutive Loss Streak Cooldown
  console.log('\n--- Test 5: Consecutive Loss Streak Cooldown ---');
  // Record 3 consecutive losses
  for (let i = 1; i <= 3; i++) {
    await GlobalRiskGovernor.recordTradeOutcome({
      symbol: 'ETHUSDC',
      direction: 'LONG',
      entryPrice: 2100.0,
      exitPrice: 2090.0,
      contractSize: 20,
      realizedPnl: -200,
      realizedR: -1.0,
      isWin: false,
      timestamp: Date.now(),
    }, testUser);
  }

  const streakState = GlobalRiskGovernor.getState();
  assert(streakState.consecutive_losses_count === 3, 'Consecutive losses recorded as 3');
  assert(streakState.circuit_breaker_active, 'Circuit breaker tripped by 3 consecutive losses');

  const blockedAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2100.0,
    stopLossPrice: 2090.0,
    currentEquity: 9400.0,
    currentOpenPositionsCount: 0,
    userEmail: testUser,
  });

  assert(!blockedAssessment.isApproved, 'Trade rejected while circuit breaker is active');

  // Test 6: Manual Circuit Breaker Reset
  console.log('\n--- Test 6: Manual Circuit Breaker Reset ---');
  await GlobalRiskGovernor.resetCircuitBreaker(testUser);
  const resetState = GlobalRiskGovernor.getState();
  assert(!resetState.circuit_breaker_active, 'Circuit breaker deactivated after manual reset');
  assert(resetState.consecutive_losses_count === 0, 'Consecutive loss streak cleared');

  // Test 7: Daily Drawdown Circuit Breaker Trip
  console.log('\n--- Test 7: Daily Drawdown Circuit Breaker Trip ---');
  // Record heavy loss exceeding $400 USD limit
  await GlobalRiskGovernor.recordTradeOutcome({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2100.0,
    exitPrice: 2075.0,
    contractSize: 20,
    realizedPnl: -500,
    realizedR: -2.5,
    isWin: false,
    timestamp: Date.now(),
  }, testUser);

  const ddState = GlobalRiskGovernor.getState();
  assert(ddState.circuit_breaker_active, 'Circuit breaker tripped by daily drawdown limit');
  assert(
    ddState.circuit_breaker_reason?.includes('Daily drawdown limit breached') || false,
    'Circuit breaker reason identifies daily drawdown breach'
  );

  // Reset again
  await GlobalRiskGovernor.resetCircuitBreaker(testUser);

  // Test 8: Daily Frequency Cap
  console.log('\n--- Test 8: Daily Trade Frequency Cap ---');
  // Set trade count to cap
  GlobalRiskGovernor._setTestState({ daily_trades_count: 6 });
  const freqAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2100.0,
    stopLossPrice: 2090.0,
    currentEquity: 10000.0,
    currentOpenPositionsCount: 0,
    userEmail: testUser,
  });

  assert(!freqAssessment.isApproved, 'Trade rejected when daily frequency cap is met');
  assert(
    freqAssessment.reason.includes('Daily trade cap reached'),
    'Rejection reason notes daily trade cap'
  );
  // Test 9: Emergency Equity Floor Circuit Breaker
  console.log('\n--- Test 9: Emergency Equity Floor Circuit Breaker ---');
  // 9a. Depleted equity (<= 0)
  const zeroEquityAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2100.0,
    stopLossPrice: 2090.0,
    currentEquity: 0.0,
    currentOpenPositionsCount: 0,
    userEmail: testUser,
  });
  assert(!zeroEquityAssessment.isApproved, 'Trade rejected when equity is depleted (0)');
  assert(
    zeroEquityAssessment.reason.includes('Emergency Equity Floor breached'),
    'Rejection cites Emergency Equity Floor breach'
  );
  assert(
    zeroEquityAssessment.violationTier === 'EMERGENCY_EQUITY_FLOOR_BREACH',
    'Violation tier is EMERGENCY_EQUITY_FLOOR_BREACH'
  );

  // 9b. Breaching configured emergency equity floor
  const floorAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2100.0,
    stopLossPrice: 2090.0,
    currentEquity: 350.0,
    emergencyEquityFloor: 500.0,
    currentOpenPositionsCount: 0,
    userEmail: testUser,
  });
  assert(!floorAssessment.isApproved, 'Trade rejected when equity is below emergency equity floor cutoff');
  assert(
    floorAssessment.reason.includes('breached the global cutoff of $500.00'),
    'Rejection cites global cutoff of $500.00'
  );

  // Test 10: Post-Loss Cooldown Circuit Breaker (Rule 5)
  console.log('\n--- Test 10: Post-Loss Cooldown Circuit Breaker (Rule 5) ---');
  const recentLossTime = Date.now() - 10 * 60 * 1000; // 10 minutes ago
  const cooldownAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2100.0,
    stopLossPrice: 2090.0,
    currentEquity: 10000.0,
    currentOpenPositionsCount: 0,
    lastLossTimestamp: recentLossTime,
    cooldownMinutes: 45,
    userEmail: testUser,
  });
  assert(!cooldownAssessment.isApproved, 'Trade rejected when engine is serving active post-loss cooldown');
  assert(
    cooldownAssessment.reason.includes('Post-loss cooldown active (Rule 5)'),
    'Rejection correctly cites Post-loss cooldown (Rule 5)'
  );
  assert(
    cooldownAssessment.violationTier === 'COOLDOWN_ACTIVE',
    'Violation tier is COOLDOWN_ACTIVE'
  );

  // Cooldown expired
  const expiredLossTime = Date.now() - 50 * 60 * 1000; // 50 minutes ago (> 45 min cooldown)
  GlobalRiskGovernor._setTestState({ daily_trades_count: 0 }); // Reset trade count from test 8
  const unblockedCooldownAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2100.0,
    stopLossPrice: 2090.0,
    currentEquity: 10000.0,
    currentOpenPositionsCount: 0,
    lastLossTimestamp: expiredLossTime,
    cooldownMinutes: 45,
    userEmail: testUser,
  });
  assert(unblockedCooldownAssessment.isApproved, 'Trade approved after post-loss cooldown expires');

  // Test 11: Concurrency Lock Check with Custom maxOpenPositions
  console.log('\n--- Test 11: Concurrency Lock with Custom maxOpenPositions ---');
  const concAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2100.0,
    stopLossPrice: 2090.0,
    currentEquity: 10000.0,
    currentOpenPositionsCount: 2,
    maxOpenPositions: 2,
    userEmail: testUser,
  });
  assert(!concAssessment.isApproved, 'Trade rejected when max concurrent open positions (2) reached');
  assert(
    concAssessment.violationTier === 'CONCURRENCY_LOCK',
    'Violation tier is CONCURRENCY_LOCK'
  );

  // Test 12: Rule 5 Cooldown Resolution from Risk Governor State (Engine Cold Start with param=0)
  console.log('\n--- Test 12: Rule 5 Cooldown on Engine Cold-Start (param=0) ---');
  GlobalRiskGovernor._setTestState({
    last_loss_timestamp: Date.now() - 15 * 60 * 1000, // 15 mins ago (within 45 min cooldown)
    circuit_breaker_active: false,
    daily_trades_count: 0,
    consecutive_losses_count: 0,
  });

  const coldStartAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2100.0,
    stopLossPrice: 2090.0,
    currentEquity: 10000.0,
    currentOpenPositionsCount: 0,
    lastLossTimestamp: 0, // Engine cold start has 0
    cooldownMinutes: 45,
    userEmail: testUser,
  });
  assert(!coldStartAssessment.isApproved, 'Trade rejected when engine timestamp is 0 but RiskGovernor state has active cooldown');
  assert(
    coldStartAssessment.reason.includes('Post-loss cooldown active (Rule 5)'),
    'Cold start rejection cites Rule 5 Post-loss cooldown'
  );
  assert(
    coldStartAssessment.violationTier === 'COOLDOWN_ACTIVE',
    'Cold start violation tier is COOLDOWN_ACTIVE'
  );

  // Reset state
  GlobalRiskGovernor._setTestState({ last_loss_timestamp: null });

  // Test 13: Daily Drawdown Limit Non-Negative Bounds
  console.log('\n--- Test 13: Daily Drawdown Non-Negative Bounds ---');
  GlobalRiskGovernor._setTestState({
    current_balance: 100.0,
    initial_capital: 1000.0,
    daily_realized_pnl: -50.0,
    circuit_breaker_active: false,
  });
  const ddAssessment = await GlobalRiskGovernor.evaluatePreTradeRisk({
    symbol: 'ETHUSDC',
    direction: 'LONG',
    entryPrice: 2100.0,
    stopLossPrice: 2090.0,
    currentEquity: 100.0,
    currentOpenPositionsCount: 0,
    userEmail: testUser,
  });
  // With equity 100, 4% is $4.00 max loss, cumulative loss is -$50 -> tripped
  assert(!ddAssessment.isApproved, 'Trade rejected when loss breaches 4% of equity');
  assert(!ddAssessment.reason.includes('-$-'), 'Drawdown reason does not format negative currency (-$-)');
  assert(ddAssessment.violationTier === 'DAILY_DRAWDOWN_BREACH', 'Violation tier is DAILY_DRAWDOWN_BREACH');

  console.log('\n===============================================================');
  console.log(`Institutional Test Suite Finished: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('===============================================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
