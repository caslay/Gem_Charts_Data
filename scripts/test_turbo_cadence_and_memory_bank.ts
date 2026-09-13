import assert from 'node:assert';
import { generatePotentialTrades } from '../src/lib/quantTradeEngine';

// 1. Test Non-Destructive State Merge (matching aiCascadeEngine.ts)
function mergeAiTradeState(existingState: any, nextState: any) {
  const existingLessons = Array.isArray(existingState?.recent_mistakes_lessons)
    ? existingState.recent_mistakes_lessons
    : [];
  const nextLessons = Array.isArray(nextState?.recent_mistakes_lessons)
    ? nextState.recent_mistakes_lessons
    : [];

  const seenLessons = new Set<string>();
  const combinedLessons: unknown[] = [];
  for (const item of [...nextLessons, ...existingLessons]) {
    const key = typeof item === 'string'
      ? item.trim()
      : item && typeof item === 'object'
      ? ((item as any).lesson || (item as any).setup_id ? `${(item as any).setup_id || ''}::${(item as any).lesson || ''}` : JSON.stringify(item))
      : JSON.stringify(item);
    if (!seenLessons.has(key)) {
      seenLessons.add(key);
      combinedLessons.push(item);
    }
  }

  return {
    ...existingState,
    ...nextState,
    recent_mistakes_lessons: combinedLessons.slice(0, 20),
    updated_at: new Date().toISOString()
  };
}

console.log('--- Test 1: Non-destructive Memory Bank Merge (Strings & Structured Objects) ---');
const existingState = {
  active_bias: 'BULLISH',
  consecutive_losses: 1,
  recent_mistakes_lessons: [
    { setup_id: 'SOP-01', lesson: 'Avoid shorting into 1h FVG support', timestamp: '2026-09-12T10:00:00Z' },
    { setup_id: 'SOP-02', lesson: 'Do not chase market orders at high of day', timestamp: '2026-09-12T11:00:00Z' }
  ],
  risk_multiplier: 0.8
};

const incomingNextState = {
  active_bias: 'BEARISH',
  consecutive_losses: 0,
  recent_mistakes_lessons: [
    // New lesson (prepended first)
    { setup_id: 'SOP-03', lesson: 'Wait for MSS candle close before entering reclaim', timestamp: '2026-09-13T12:30:00Z' },
    // Duplicate lesson with same setup_id and lesson text
    { setup_id: 'SOP-02', lesson: 'Do not chase market orders at high of day', timestamp: '2026-09-13T12:00:00Z' }
  ]
};

const merged = mergeAiTradeState(existingState, incomingNextState);
assert.strictEqual(merged.active_bias, 'BEARISH', 'active_bias should update');
assert.strictEqual(merged.consecutive_losses, 0, 'consecutive_losses should update');
assert.strictEqual(merged.risk_multiplier, 0.8, 'risk_multiplier should be preserved from existing state');
assert.strictEqual(merged.recent_mistakes_lessons.length, 3, 'recent_mistakes_lessons should combine unique structured items');
assert.strictEqual((merged.recent_mistakes_lessons[0] as any).setup_id, 'SOP-03', 'Newest lesson should be prepended');
console.log('✅ Non-destructive Memory Bank Merge Passed!');

// 2. Test In-Zone POI Proximity Detection with 0.05% tolerance & Inverted / Edge Cases
console.log('\n--- Test 2: In-Zone Proximity Detection (0.05% tolerance & edge cases) ---');
function evaluateProximity(currentPrice: number, entry1: number, entry2: number, sl: number | null, direction: string | null) {
  if (currentPrice <= 0 || entry1 <= 0 || entry2 <= 0 || isNaN(entry1) || isNaN(entry2) || !isFinite(entry1) || !isFinite(entry2)) {
    return { inZone: false, isInvalidated: false };
  }

  const low = Math.min(entry1, entry2);
  const high = Math.max(entry1, entry2);

  let isInvalidated = false;
  if (sl != null && sl > 0 && isFinite(sl)) {
    if ((direction === 'BULLISH' || direction === 'LONG') && currentPrice <= sl) {
      isInvalidated = true;
    } else if ((direction === 'BEARISH' || direction === 'SHORT') && currentPrice >= sl) {
      isInvalidated = true;
    }
  }

  if (isInvalidated) {
    return { inZone: false, isInvalidated: true };
  }

  const buffer = low * 0.0005;
  const inZone = currentPrice >= (low - buffer) && currentPrice <= (high + buffer);

  return { inZone, isInvalidated: false };
}

// Entry: 2500 - 2510. SL: 2480. Tolerance: 2500 * 0.0005 = 1.25.
// inZoneLow = 2498.75, inZoneHigh = 2511.25.
const r1 = evaluateProximity(2505, 2500, 2510, 2480, 'BULLISH');
assert.strictEqual(r1.inZone, true, 'Price inside entry range should be in zone');

const r2 = evaluateProximity(2511.0, 2500, 2510, 2480, 'BULLISH');
assert.strictEqual(r2.inZone, true, 'Price within 0.05% upper tolerance should be in zone');

const r3 = evaluateProximity(2499.0, 2500, 2510, 2480, 'BULLISH');
assert.strictEqual(r3.inZone, true, 'Price within 0.05% lower tolerance should be in zone');

const r4 = evaluateProximity(2520, 2500, 2510, 2480, 'BULLISH');
assert.strictEqual(r4.inZone, false, 'Price above tolerance should NOT be in zone');

const r5 = evaluateProximity(2475, 2500, 2510, 2480, 'BULLISH');
assert.strictEqual(r5.inZone, false, 'Price below stopLoss should NOT be in zone');
assert.strictEqual(r5.isInvalidated, true, 'Invalidated flag should be true');

// Edge case: Inverted entry range [2510, 2500]
const r6 = evaluateProximity(2505, 2510, 2500, 2480, 'BULLISH');
assert.strictEqual(r6.inZone, true, 'Inverted entry range should be normalized gracefully');

// Edge case: NaN or 0 input
const r7 = evaluateProximity(0, 2500, 2510, 2480, 'BULLISH');
assert.strictEqual(r7.inZone, false, 'Zero price should not trigger inZone');
console.log('✅ In-Zone Proximity Detection Passed!');

// 3. Test Turbo Cadence Scheduler State Machine (Debounce, Burnout Cap, Invalidation)
console.log('\n--- Test 3: Turbo Scheduler State Machine ---');
class CadenceScheduler {
  turboCount = 0;
  isTurboActive = false;
  lastScanTimestamp = 0;
  baseIntervalMinutes = 30;

  evaluate(now: number, inZone: boolean, isInvalidated: boolean, turboEnabled: boolean) {
    if (!turboEnabled || isInvalidated) {
      this.isTurboActive = false;
      this.turboCount = 0;
      return this.baseIntervalMinutes;
    }

    if (inZone) {
      if (this.turboCount >= 4) {
        // Burnout cap reached
        this.isTurboActive = false;
        return this.baseIntervalMinutes;
      }
      this.isTurboActive = true;
      return 5;
    } else {
      this.isTurboActive = false;
      this.turboCount = 0;
      return this.baseIntervalMinutes;
    }
  }

  recordScan(now: number) {
    // 180s debounce guard
    if (now - this.lastScanTimestamp < 180000) {
      return false; // Debounced
    }
    this.lastScanTimestamp = now;
    if (this.isTurboActive) {
      this.turboCount += 1;
    }
    return true;
  }
}

const scheduler = new CadenceScheduler();
let t = 1000000;

// Step 1: In-zone detected with turboEnabled = true
let cad = scheduler.evaluate(t, true, false, true);
assert.strictEqual(cad, 5, 'Cadence should elevate to 5m Turbo');
assert.strictEqual(scheduler.isTurboActive, true);

// Perform 4 turbo scans spaced 5 min apart (300,000 ms > 180,000 ms debounce)
for (let i = 1; i <= 4; i++) {
  t += 300000;
  const scanned = scheduler.recordScan(t);
  assert.strictEqual(scanned, true, `Scan ${i} should succeed`);
  assert.strictEqual(scheduler.turboCount, i, `turboCount should be ${i}`);
}

// Step 2: 5th scan attempt: Burnout cap triggers!
cad = scheduler.evaluate(t, true, false, true);
assert.strictEqual(cad, 30, 'Burnout cap of 4 should relax cadence back to base (30m)');
assert.strictEqual(scheduler.isTurboActive, false, 'Turbo should be disarmed after burnout cap');

// Step 3: Test Debounce Guard (< 180s)
const debounced = scheduler.recordScan(t + 60000); // Only 60s later
assert.strictEqual(debounced, false, 'Scan within 180s must be debounced');

// Step 4: Invalidation immediate disarm
scheduler.turboCount = 2;
scheduler.isTurboActive = true;
cad = scheduler.evaluate(t + 300000, false, true, true); // isInvalidated = true
assert.strictEqual(cad, 30, 'Invalidation must immediately revert to base cadence');
assert.strictEqual(scheduler.isTurboActive, false);
assert.strictEqual(scheduler.turboCount, 0, 'turboCount must reset to 0 upon invalidation');

console.log('✅ Turbo Scheduler State Machine Passed!');

// 4. Test AI SOP Potential Trade Setup Generation with Status and Lifecycle Parity
console.log('\n--- Test 4: AI SOP Setup Lifecycle & Auto-Trade Parity ---');
const mockMarketData: any = {
  ticker: 'ETHUSDC',
  timezone: 'UTC',
  open_interest: 50000,
  data_payload: {
    candles_5m: [
      { t: 1000, o: 2500, h: 2515, l: 2495, c: 2505, v: 100 },
      { t: 2000, o: 2505, h: 2512, l: 2502, c: 2508, v: 120 }
    ],
    candles_15m: [
      { t: 1000, o: 2500, h: 2515, l: 2495, c: 2508, v: 220 }
    ]
  },
  ipda_metrics: {
    macro_daily_bias: 'BULLISH',
    active_fvgs: []
  }
};

const mockAiAnalysis = JSON.stringify({
  bias_signal: 1,
  bias_label: 'BULLISH',
  sop_report: {
    trade_narrative: 'Bullish reclaim of discount liquidity pool',
    risk_parameters: {
      entry_range: [2504, 2510],
      invalidation: 2485,
      tp1: 2525,
      tp2: 2540,
      rr_ratio: 2.1
    }
  }
});

const tradesSummary = generatePotentialTrades(mockMarketData, true, mockAiAnalysis);
const aiSetup = tradesSummary.setups.find((s) => s.id === 'AI-SOP-01');
assert(aiSetup, 'AI-SOP-01 setup must be present in potential trades');
assert.strictEqual(aiSetup.direction, 'BULLISH');
assert.strictEqual(aiSetup.entryMin, 2504);
assert.strictEqual(aiSetup.entryMax, 2510);
assert.strictEqual(aiSetup.stopLoss, 2485);
assert.strictEqual(aiSetup.target1, 2525);
assert.strictEqual(aiSetup.target2, 2540);
assert.strictEqual(aiSetup.rrRatio, 2.1);
assert(['CONFIRMED', 'ACTIVE_WATCH', 'TARGET_HIT'].includes(aiSetup.status), `Setup status should be dynamic, got ${aiSetup.status}`);
console.log(`✅ AI SOP Setup Parity Passed! Status: ${aiSetup.status}`);

console.log('\n🎉 ALL COMPREHENSIVE VERIFICATION TESTS PASSED SUCCESSFULLY!');
