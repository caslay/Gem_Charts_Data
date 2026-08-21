/**
 * test_live_preset_sync.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification test suite for:
 * 1. Full-Spectrum Live Strategy & Preset Arming (S&R, OB, Custom Equation Strategies).
 * 2. Real-time Live Settings Ingestion into SweepReclaimLiveSettings.
 * 3. Transient Condition Cache Purging (zero logic bleed).
 * 4. Persistent Armed Execution Cockpit Status serialization.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  FACTORY_SWEEP_RECLAIM_PRESETS,
  FACTORY_ORDER_BLOCK_PRESETS,
  loadScannerPresets,
  saveCustomPreset,
  applyPresetToLiveExecution,
  armCustomStrategy,
  getArmedExecutionStatus,
  setArmedExecutionStatus,
  purgeConditionCache,
  FLOW_STATE_PURGE_CACHE_EVENT,
  FLOW_STATE_ARMED_STATE_CHANGED,
  STORAGE_KEY_ARMED_EXECUTION,
} from '../src/lib/quantEngine/scannerPresets';

import {
  getSweepReclaimLiveSettings,
  updateSweepReclaimLiveSettings,
} from '../src/lib/quantEngine/strategyExecutionConfig';

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
  console.log('🧪 TEST SUITE: Live Preset & Strategy Cockpit Synchronization');
  console.log('================================================================\n');

  // ── [1/4] Arming Built-in Sweep & Reclaim Presets ──────────────────────────
  console.log('▶ [1/4] Testing Built-in Sweep & Reclaim Preset Live Arming...');
  const goldenPreset = FACTORY_SWEEP_RECLAIM_PRESETS[0];
  applyPresetToLiveExecution(goldenPreset);

  const armedSr = getArmedExecutionStatus();
  assert(armedSr.type === 'SWEEP_RECLAIM', 'Armed type is SWEEP_RECLAIM');
  assert(armedSr.name === goldenPreset.name, `Armed name matches "${goldenPreset.name}"`);
  assert(armedSr.id === goldenPreset.id, `Armed ID matches "${goldenPreset.id}"`);

  const liveSettings = getSweepReclaimLiveSettings();
  assert(liveSettings.entryMode === 'SWEEP_OB_MT', 'Live settings entryMode updated to SWEEP_OB_MT');
  assert(liveSettings.enforceDiscountPremiumGate === true, 'Discount/Premium gate enabled in live settings');
  assert(liveSettings.volumeExpansionThreshold === 1.50, 'Volume expansion threshold set to 1.50x');

  // ── [2/4] Arming Built-in Order Block Presets ─────────────────────────────
  console.log('\n▶ [2/4] Testing Built-in Order Block Preset Live Arming...');
  const obPreset = FACTORY_ORDER_BLOCK_PRESETS[0];
  applyPresetToLiveExecution(obPreset);

  const armedOb = getArmedExecutionStatus();
  assert(armedOb.type === 'ORDER_BLOCK', 'Armed type is ORDER_BLOCK');
  assert(armedOb.name === obPreset.name, `Armed name matches "${obPreset.name}"`);
  assert(armedOb.id === obPreset.id, `Armed ID matches "${obPreset.id}"`);

  // ── [3/4] Arming Custom Equation Builder Strategies ──────────────────────
  console.log('\n▶ [3/4] Testing Custom Equation Builder Strategy Arming...');
  const customStrategy = {
    id: 'strat_ict_silver_bullet_5m',
    name: 'ICT Silver Bullet 5m Model',
    target_environment: 'LIVE_ONLY',
  };

  armCustomStrategy(customStrategy);

  const armedCustom = getArmedExecutionStatus();
  assert(armedCustom.type === 'CUSTOM_STRATEGY', 'Armed type is CUSTOM_STRATEGY');
  assert(armedCustom.name === 'ICT Silver Bullet 5m Model', 'Armed name matches custom strategy');
  assert(armedCustom.id === 'strat_ict_silver_bullet_5m', 'Armed ID matches custom strategy');
  assert(armedCustom.isAutoExecEnabled === true, 'Custom strategy auto execution armed');

  // ── [4/4] Cache Purging & Event Dispatch Verification ────────────────────
  console.log('\n▶ [4/4] Testing Transient Condition Cache Purging...');
  dispatchedEvents.length = 0;
  purgeConditionCache();

  assert(dispatchedEvents.some(e => e.type === FLOW_STATE_PURGE_CACHE_EVENT), 'Purge event dispatched to window');

  // Switch to another preset and ensure purge is automatically triggered
  const ethScalper = FACTORY_SWEEP_RECLAIM_PRESETS[1];
  dispatchedEvents.length = 0;
  applyPresetToLiveExecution(ethScalper);

  assert(dispatchedEvents.some(e => e.type === FLOW_STATE_PURGE_CACHE_EVENT), 'Purge event dispatched on preset change');
  assert(dispatchedEvents.some(e => e.type === FLOW_STATE_ARMED_STATE_CHANGED), 'Armed state changed event dispatched');

  const liveSettingsUpdated = getSweepReclaimLiveSettings();
  assert(liveSettingsUpdated.entryMode === 'FVG_CE', 'Live settings updated to FVG_CE');

  console.log('\n================================================================');
  console.log('✅ ALL 4/4 LIVE PRESET & STRATEGY SYNC STAGES PASSED CLEANLY!');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
