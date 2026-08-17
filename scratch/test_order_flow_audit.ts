/**
 * test_order_flow_audit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification Test Suite for Order Flow Timeline & Transitions Synchronization.
 *
 * Asserts:
 *  1. History deduplication correctly excludes uncommitted/overlapping active state timestamps.
 *  2. calculateOrderFlowStats total_transitions strictly equals unified segments count.
 *  3. Top Ribbon and Sidebar mini-ribbon render the identical count of segments.
 *  4. Transitions counter displayed in ribbon and sidebar matches 100%.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { calculateOrderFlowStats } from '../src/lib/orderFlowEngine';
import { getUnifiedTimelineSegments } from '../src/components/OrderFlowTimelineRibbon';
import type { OrderFlowTimelineSummary, OrderFlowStateRecord } from '../src/lib/quantEngine/types';

async function runOrderFlowAudit() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('📊 ORDER FLOW TIMELINE & FOOTPRINT SYNCHRONIZATION AUDIT');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  let passedAssertions = 0;
  let totalAssertions = 0;

  function assert(condition: boolean, description: string) {
    totalAssertions++;
    if (condition) {
      console.log(`  ✅ [PASS] ${description}`);
      passedAssertions++;
    } else {
      console.error(`  ❌ [FAIL] ${description}`);
      throw new Error(`Assertion Failed: ${description}`);
    }
  }

  // ── Scenario 1: Clean History + Active State ──────────────────────────────
  console.log('[TEST 1] Testing Clean 3-Segment History + 1 Active State...');
  const now = Date.now();
  const mockHistory: OrderFlowStateRecord[] = [
    {
      id: 'h1',
      symbol: 'ETHUSDC',
      state: 'RISING_AGAINST_PRICE',
      entered_at: now - 3600000,
      entry_price: 1900,
      exited_at: now - 2400000,
      exit_price: 1895,
      duration_seconds: 1200,
      price_change: -5,
      price_change_pct: -0.26
    },
    {
      id: 'h2',
      symbol: 'ETHUSDC',
      state: 'FLAT',
      entered_at: now - 2400000,
      entry_price: 1895,
      exited_at: now - 1200000,
      exit_price: 1897,
      duration_seconds: 1200,
      price_change: 2,
      price_change_pct: 0.1
    },
    {
      id: 'h3',
      symbol: 'ETHUSDC',
      state: 'RISING_AGAINST_PRICE',
      entered_at: now - 1200000,
      entry_price: 1897,
      exited_at: now - 300000,
      exit_price: 1892,
      duration_seconds: 900,
      price_change: -5,
      price_change_pct: -0.26
    }
  ];

  const mockActive: OrderFlowStateRecord = {
    id: 'active-1',
    symbol: 'ETHUSDC',
    state: 'RISING_AGAINST_PRICE',
    entered_at: now - 300000,
    entry_price: 1892,
    exited_at: null,
    exit_price: null,
    duration_seconds: 300,
    price_change: 0,
    price_change_pct: 0
  };

  const stats = calculateOrderFlowStats(mockHistory, mockActive, now);
  const timelineSummary: OrderFlowTimelineSummary = {
    active_state: mockActive,
    history: mockHistory,
    stats
  };

  const ribbonResult = getUnifiedTimelineSegments(timelineSummary, 1894, 300, 20);
  const sidebarResult = getUnifiedTimelineSegments(timelineSummary, 1894, 300, 10);

  assert(stats.total_transitions === 4, `Stats total_transitions is 4 (actual: ${stats.total_transitions})`);
  assert(ribbonResult.totalTransitions === 4, `Ribbon totalTransitions is 4 (actual: ${ribbonResult.totalTransitions})`);
  assert(sidebarResult.totalTransitions === 4, `Sidebar totalTransitions is 4 (actual: ${sidebarResult.totalTransitions})`);
  assert(ribbonResult.segments.length === 4, `Ribbon has 4 visual segments (actual: ${ribbonResult.segments.length})`);
  assert(sidebarResult.segments.length === 4, `Sidebar has 4 visual segments (actual: ${sidebarResult.segments.length})`);

  // ── Scenario 2: History Contains Duplicate Active State Timestamp ─────────
  console.log('\n[TEST 2] Testing Uncommitted Duplicate In History Handling...');
  const duplicateHistory = [
    ...mockHistory,
    {
      id: 'h-dup',
      symbol: 'ETHUSDC',
      state: 'RISING_AGAINST_PRICE',
      entered_at: mockActive.entered_at, // Duplicate timestamp!
      entry_price: 1892,
      exited_at: null,
      exit_price: null,
      duration_seconds: 50,
      price_change: 0,
      price_change_pct: 0
    }
  ];

  const statsDup = calculateOrderFlowStats(duplicateHistory, mockActive, now);
  const timelineSummaryDup: OrderFlowTimelineSummary = {
    active_state: mockActive,
    history: duplicateHistory,
    stats: statsDup
  };

  const ribbonResultDup = getUnifiedTimelineSegments(timelineSummaryDup, 1894, 300, 20);
  const sidebarResultDup = getUnifiedTimelineSegments(timelineSummaryDup, 1894, 300, 10);

  assert(statsDup.total_transitions === 4, `Stats correctly filters duplicate record: total_transitions is 4 (actual: ${statsDup.total_transitions})`);
  assert(ribbonResultDup.totalTransitions === 4, `Ribbon totalTransitions correctly deduplicated: 4 (actual: ${ribbonResultDup.totalTransitions})`);
  assert(sidebarResultDup.totalTransitions === 4, `Sidebar totalTransitions matches ribbon: 4 (actual: ${sidebarResultDup.totalTransitions})`);
  assert(ribbonResultDup.segments.length === 4, `Ribbon renders exactly 4 segments without ghost bar (actual: ${ribbonResultDup.segments.length})`);
  assert(sidebarResultDup.segments.length === 4, `Sidebar renders exactly 4 segments (actual: ${sidebarResultDup.segments.length})`);

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log(`🎉 ALL ${passedAssertions}/${totalAssertions} ORDER FLOW AUDIT ASSERTIONS PASSED!`);
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

runOrderFlowAudit().catch((err) => {
  console.error('\n❌ AUDIT FAILED:', err);
  process.exit(1);
});
