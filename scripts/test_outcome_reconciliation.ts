/**
 * scripts/test_outcome_reconciliation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive Automated Verification Suite for:
 * 1. Setup Outcome Reconciliation (Dynamic Lifecycle Badging)
 * 2. Temporal Date Scoping & Cairo Localized Day Ranges
 * 3. Daily Audit Mini-KPI Ribbon Metrics & Edge Cases
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  reconcileSetupOutcomes,
  calculateDailyAuditMetrics,
  getCairoDateString,
  getCairoDayRange,
  type EnrichedAiAnalysisRecord,
} from '../src/lib/quantEngine/SetupOutcomeReconciler';
import type { AiAnalysisRecord } from '../src/lib/aiCascadeEngine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`   ✅ PASS: ${message}`);
}

async function runTests() {
  console.log('\n===============================================================');
  console.log(' 🧪 RUNNING SETUP OUTCOME RECONCILIATION & AUDIT TEST SUITE');
  console.log('===============================================================\n');

  const now = new Date('2026-09-16T18:00:00.000Z').getTime();

  // ── 1. Temporal Scoping & Cairo Date Functions ──
  console.log('── TEST SUITE 1: Cairo Temporal Date Scoping ──');
  const testDate = new Date('2026-09-16T15:00:00.000Z');
  const cairoDateStr = getCairoDateString(testDate);
  assert(cairoDateStr === '2026-09-16', `Cairo date formatted as 2026-09-16 (got ${cairoDateStr})`);

  const range = getCairoDayRange('2026-09-16');
  assert(
    range.startIso === '2026-09-15T21:00:00.000Z',
    `Cairo day start (00:00 Cairo) equals 2026-09-15T21:00:00.000Z (got ${range.startIso})`
  );
  assert(
    range.endIso === '2026-09-16T20:59:59.999Z',
    `Cairo day end (23:59:59 Cairo) equals 2026-09-16T20:59:59.999Z (got ${range.endIso})`
  );

  // ── 2. Workstream A: Outcome Reconciliation Tests ──
  console.log('\n── TEST SUITE 2: Dynamic Lifecycle Badging & Outcome Reconciliation ──');

  // Case 2.1: Fresh ACTIVE_SETUP within 12-bar TTL (5m * 12 = 60m)
  const freshRecord: AiAnalysisRecord = {
    id: 101,
    symbol: 'ETHUSDC',
    timeframe: '5m',
    requested_model: 'gemini-2.5-flash',
    resolved_model: 'gemini-2.5-flash',
    was_fallback: false,
    fallback_reason: null,
    execution_latency_ms: 1150,
    bias_signal: 'BULLISH',
    trade_direction: 'LONG',
    status: 'ACTIVE_SETUP',
    entry_range_low: 2380.0,
    entry_range_high: 2385.0,
    invalidation_level: 2370.0,
    target_1: 2400.0,
    target_2: 2420.0,
    target_3: null,
    narrative: 'High-asymmetry bullish expansion setup.',
    raw_response: null,
    telemetry_data: null,
    created_at: new Date(now - 10 * 60 * 1000).toISOString(), // 10 mins ago (well within 60 min TTL)
  };

  const [reconciledFresh] = await reconcileSetupOutcomes([freshRecord], {
    currentPrice: 2388.0,
    now,
  });

  assert(
    reconciledFresh.reconciled_status === 'ACTIVE_SETUP',
    `Fresh setup within TTL retains ACTIVE_SETUP status (got ${reconciledFresh.reconciled_status})`
  );
  assert(reconciledFresh.reconciled_outcome.is_armed === true, 'Fresh setup is marked as is_armed: true');
  assert(
    reconciledFresh.reconciled_outcome.bars_elapsed === 2,
    `Fresh setup reports 2 bars elapsed (got ${reconciledFresh.reconciled_outcome.bars_elapsed})`
  );

  // Case 2.2: ACTIVE_SETUP where 12-bar TTL expired (> 60m ago) with no trade filled
  const expiredRecord: AiAnalysisRecord = {
    ...freshRecord,
    id: 102,
    created_at: new Date(now - 120 * 60 * 1000).toISOString(), // 120 mins ago (> 60m TTL)
  };

  const [reconciledExpired] = await reconcileSetupOutcomes([expiredRecord], {
    currentPrice: 2383.0,
    now,
  });

  assert(
    reconciledExpired.reconciled_status === 'TTL_EXPIRED',
    `Setup older than 12-bar TTL reconciles to TTL_EXPIRED (got ${reconciledExpired.reconciled_status})`
  );
  assert(
    reconciledExpired.reconciled_outcome.outcome_reason.includes('TTL expired'),
    'Reason mentions TTL expiration'
  );

  // Case 2.3: ACTIVE_SETUP where live price breached invalidation while armed -> CANCELLED_PRE_FILL
  const invalidatedPreFillRecord: AiAnalysisRecord = {
    ...freshRecord,
    id: 103,
    created_at: new Date(now - 15 * 60 * 1000).toISOString(), // 15 mins ago
    trade_direction: 'LONG',
    invalidation_level: 2370.0,
  };

  const [reconciledInvPreFill] = await reconcileSetupOutcomes([invalidatedPreFillRecord], {
    currentPrice: 2365.0, // breached below 2370.0 SL!
    now,
  });

  assert(
    reconciledInvPreFill.reconciled_status === 'CANCELLED_PRE_FILL',
    `Setup with breached invalidation reconciles to CANCELLED_PRE_FILL (got ${reconciledInvPreFill.reconciled_status})`
  );

  // Case 2.4: ACTIVE_SETUP where market reached Target 1 prior to entry fill -> CANCELLED_PRE_FILL
  const missedTpPreFillRecord: AiAnalysisRecord = {
    ...freshRecord,
    id: 104,
    created_at: new Date(now - 15 * 60 * 1000).toISOString(),
    trade_direction: 'LONG',
    target_1: 2400.0,
  };

  const [reconciledMissedTp] = await reconcileSetupOutcomes([missedTpPreFillRecord], {
    currentPrice: 2405.0, // already exploded past TP1 without entry!
    now,
  });

  assert(
    reconciledMissedTp.reconciled_status === 'CANCELLED_PRE_FILL',
    `Setup with missed TP1 expansion reconciles to CANCELLED_PRE_FILL (got ${reconciledMissedTp.reconciled_status})`
  );

  // Case 2.5: NEUTRAL and INVALIDATED setups preserve their non-active status
  const neutralRecord: AiAnalysisRecord = {
    ...freshRecord,
    id: 105,
    status: 'NEUTRAL',
    trade_direction: 'NEUTRAL',
    bias_signal: 'NEUTRAL',
  };

  const [reconciledNeutral] = await reconcileSetupOutcomes([neutralRecord], { now });
  assert(reconciledNeutral.reconciled_status === 'NEUTRAL', 'Neutral setup reconciles to NEUTRAL');

  const invRecord: AiAnalysisRecord = {
    ...freshRecord,
    id: 106,
    status: 'INVALIDATED',
  };

  const [reconciledInv] = await reconcileSetupOutcomes([invRecord], { now });
  assert(reconciledInv.reconciled_status === 'INVALIDATED', 'Invalidated setup reconciles to INVALIDATED');

  // ── 3. Workstream C: Daily Audit Mini-KPI Ribbon ──
  console.log('\n── TEST SUITE 3: Daily Audit Mini-KPI Metrics ──');

  const mockBatch: EnrichedAiAnalysisRecord[] = [
    reconciledFresh,
    reconciledExpired,
    reconciledInvPreFill,
    reconciledMissedTp,
    reconciledNeutral,
    reconciledInv,
    {
      ...freshRecord,
      id: 107,
      status: 'TP1_HIT',
      evaluated_status: 'ACTIVE_SETUP',
      reconciled_status: 'TP1_HIT',
      reconciled_outcome: {
        terminal_state: 'TP1_HIT',
        realized_r: 1.0,
        realized_pnl: 14.5,
        outcome_reason: 'Target 1 harvested (+1.00R)',
      },
    },
    {
      ...freshRecord,
      id: 108,
      status: 'TP2_HIT',
      evaluated_status: 'ACTIVE_SETUP',
      reconciled_status: 'TP2_HIT',
      reconciled_outcome: {
        terminal_state: 'TP2_HIT',
        realized_r: 1.4,
        realized_pnl: 20.3,
        outcome_reason: 'Target 2 harvested (+1.40R)',
      },
    },
    {
      ...freshRecord,
      id: 109,
      status: 'STOPPED_OUT',
      evaluated_status: 'ACTIVE_SETUP',
      reconciled_status: 'STOPPED_OUT',
      reconciled_outcome: {
        terminal_state: 'STOPPED_OUT',
        realized_r: -1.0,
        realized_pnl: -14.5,
        outcome_reason: 'Stopped out at SL (-1.00R)',
      },
    },
    {
      ...freshRecord,
      id: 110,
      was_fallback: true,
      fallback_reason: 'Quota 429 failover',
      execution_latency_ms: 2400,
      status: 'NEUTRAL',
      evaluated_status: 'NEUTRAL',
      reconciled_status: 'NEUTRAL',
      reconciled_outcome: {
        terminal_state: 'NEUTRAL',
        outcome_reason: 'Neutral market context',
      },
    },
  ];

  const metrics = calculateDailyAuditMetrics(mockBatch);

  assert(metrics.totalRuns === 10, `Total runs calculated accurately as 10 (got ${metrics.totalRuns})`);
  assert(metrics.activeSetups === 1, `Active setups count equals 1 (got ${metrics.activeSetups})`);
  assert(metrics.neutralCount === 2, `Neutral count equals 2 (got ${metrics.neutralCount})`);
  assert(metrics.invalidatedCount === 1, `Invalidated count equals 1 (got ${metrics.invalidatedCount})`);
  assert(metrics.winsCount === 2, `Wins count (TP1 + TP2) equals 2 (got ${metrics.winsCount})`);
  assert(metrics.lossesCount === 1, `Losses count equals 1 (got ${metrics.lossesCount})`);
  assert(metrics.expiredCount === 1, `Expired count equals 1 (got ${metrics.expiredCount})`);
  assert(metrics.cancelledCount === 2, `Cancelled pre-fill count equals 2 (got ${metrics.cancelledCount})`);
  assert(metrics.fallbackCount === 1, `Fallback failover count equals 1 (got ${metrics.fallbackCount})`);
  assert(metrics.primaryModelCount === 9, `Primary model count equals 9 (got ${metrics.primaryModelCount})`);
  assert(metrics.avgLatencyMs > 0, `Average latency is positive (got ${metrics.avgLatencyMs}ms)`);

  // Edge Case: Empty list (zero evaluations recorded for day)
  console.log('\n── TEST SUITE 4: Zero Runs Edge Case (Clean Empty State) ──');
  const emptyMetrics = calculateDailyAuditMetrics([]);
  assert(emptyMetrics.totalRuns === 0, 'Empty runs total is 0');
  assert(emptyMetrics.activeSetups === 0, 'Empty active setups is 0');
  assert(emptyMetrics.winsCount === 0, 'Empty wins is 0');
  assert(emptyMetrics.lossesCount === 0, 'Empty losses is 0');
  assert(emptyMetrics.fallbackCount === 0, 'Empty fallback is 0');
  assert(emptyMetrics.avgLatencyMs === 0, 'Empty avg latency is 0');

  console.log('\n===============================================================');
  console.log(' 🎉 ALL 18 VERIFICATION CHECKS PASSED (100% SUCCESS)');
  console.log('===============================================================\n');
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
