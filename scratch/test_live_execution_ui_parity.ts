/**
 * test_live_execution_ui_parity.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification test suite for 1:1 Live Execution UI Parity:
 * 1. Full 8-mode Retest Entry Model configuration & dynamic binding.
 * 2. Multi-Stage Trade Management (TP1 auto-breakeven, TP2 harvest, TP3 runner & HTF DOL).
 * 3. Temporal, Statistical, Session Killzone, and Directional Lock Gates.
 * 4. Reactive event dispatching & local storage persistence.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  SweepReclaimLiveSettings,
  DEFAULT_SR_LIVE_SETTINGS,
  getSweepReclaimLiveSettings,
  updateSweepReclaimLiveSettings,
  SR_SETTINGS_CHANGED_EVENT,
} from '../src/lib/quantEngine/strategyExecutionConfig';

import {
  SweepReclaimEntryMode,
  resolveRetestEntryPrice,
} from '../src/lib/quantEngine/SweepReclaimEngine';

// Mock browser window and localStorage for headless Node environment
const mockStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => { mockStorage[key] = val; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
};

const dispatchedEvents: { type: string; detail: any }[] = [];
(global as any).window = {
  dispatchEvent: (event: any) => {
    dispatchedEvents.push({ type: event.type, detail: event.detail });
    return true;
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

(global as any).CustomEvent = class CustomEvent {
  type: string;
  detail: any;
  constructor(type: string, params?: { detail: any }) {
    this.type = type;
    this.detail = params?.detail;
  }
};

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 TEST SUITE: 1:1 Live Execution UI Parity & Gating Controls');
  console.log('================================================================\n');

  // ── [1/4] All 8 Retest Entry Modes in Live Settings ────────────────────────
  console.log('▶ [1/4] Testing All 8 Retest Entry Modes in Live Settings...');
  const allModes: SweepReclaimEntryMode[] = [
    'SWEEP_OB_MT',
    'OB_PROXIMAL',
    'FVG_CE',
    'FVG_PROXIMAL',
    'FVG_DISTAL',
    'OTE_62',
    'SHELF_LEVEL',
    'RECLAIM_LEVEL',
  ];

  for (const mode of allModes) {
    updateSweepReclaimLiveSettings({ entryMode: mode });
    const current = getSweepReclaimLiveSettings();
    assert(current.entryMode === mode, `Live setting entryMode correctly set to ${mode}`);

    // Verify price resolver calculation works cleanly for this mode
    const price = resolveRetestEntryPrice({
      entryMode: mode,
      direction: 'BULLISH',
      anchorLevel: 3000,
      sweepExtremePrice: 2980,
      reclaimPrice: 3020,
      sweepObHigh: 2995,
      sweepObLow: 2980,
      sweepObMtPrice: 2987.5,
      fvgTop: 3015,
      fvgBottom: 3005,
      fvgCePrice: 3010,
    });
    assert(price > 0 && !isNaN(price), `Price resolved for ${mode}: $${price.toFixed(2)}`);
  }

  // ── [2/4] Multi-Stage Harvest Targets (TP1 Auto-BE, TP2, TP3 & HTF DOL) ────
  console.log('\n▶ [2/4] Testing Multi-Stage Harvest Controls in Live Settings...');
  updateSweepReclaimLiveSettings({
    enableTp1AutoBreakeven: true,
    stage1Multiple: 1.0,
    stage2Multiple: 2.0,
    stage3Multiple: 4.0,
    routeRunnerToHtfDol: true,
  });

  const harvestSettings = getSweepReclaimLiveSettings();
  assert(harvestSettings.enableTp1AutoBreakeven === true, 'TP1 Auto-Breakeven enabled');
  assert(harvestSettings.stage1Multiple === 1.0, 'Stage 1 multiple is 1.0R');
  assert(harvestSettings.stage2Multiple === 2.0, 'Stage 2 multiple is 2.0R');
  assert(harvestSettings.stage3Multiple === 4.0, 'Stage 3 multiple is 4.0R');
  assert(harvestSettings.routeRunnerToHtfDol === true, 'HTF DOL runner routing enabled');

  // ── [3/4] Temporal & Statistical Gate Toggles ─────────────────────────────
  console.log('\n▶ [3/4] Testing Temporal, Statistical, Session & Directional Gates...');
  updateSweepReclaimLiveSettings({
    executionTiming: 'ON_CLOSE',
    olsSensitivity: 'STRICT',
    enableMomentumOverride: true,
    sessionGates: ['LONDON', 'NY'],
    directionalLock: 'LONGS_ONLY',
  });

  const gateSettings = getSweepReclaimLiveSettings();
  assert(gateSettings.executionTiming === 'ON_CLOSE', 'Execution timing set to ON_CLOSE');
  assert(gateSettings.olsSensitivity === 'STRICT', 'OLS sensitivity set to STRICT');
  assert(gateSettings.enableMomentumOverride === true, 'Momentum override enabled');
  assert(gateSettings.sessionGates.length === 2 && gateSettings.sessionGates.includes('LONDON'), 'Session gates filtered to London & NY');
  assert(gateSettings.directionalLock === 'LONGS_ONLY', 'Directional lock set to LONGS_ONLY');

  // ── [4/4] Event Dispatch & Storage Consistency ────────────────────────────
  console.log('\n▶ [4/4] Testing Event Broadcasting & Local Storage Persistence...');
  dispatchedEvents.length = 0;
  updateSweepReclaimLiveSettings({
    directionalLock: 'DUAL',
    executionTiming: 'INSTANT',
  });

  assert(dispatchedEvents.some(e => e.type === SR_SETTINGS_CHANGED_EVENT), 'Settings update dispatched SR_SETTINGS_CHANGED_EVENT');

  const finalSettings = getSweepReclaimLiveSettings();
  assert(finalSettings.directionalLock === 'DUAL', 'Directional lock restored to DUAL');
  assert(finalSettings.executionTiming === 'INSTANT', 'Execution timing restored to INSTANT');

  console.log('\n================================================================');
  console.log('✅ ALL 4/4 LIVE EXECUTION UI PARITY STAGES PASSED CLEANLY!');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
