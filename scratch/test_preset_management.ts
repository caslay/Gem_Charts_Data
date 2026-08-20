/**
 * scratch/test_preset_management.ts
 * Dedicated Unit & Integration Test Suite for Local-First Scanner Preset Management System.
 */

import {
  ScannerPreset,
  ScannerStrategyType,
  SweepReclaimPresetConfig,
  OrderBlockPresetConfig,
  FACTORY_SWEEP_RECLAIM_PRESETS,
  FACTORY_ORDER_BLOCK_PRESETS,
  ALL_FACTORY_PRESETS,
  STORAGE_KEY_SCANNER_PRESETS,
  STORAGE_KEY_ACTIVE_PRESET_PREFIX,
  loadScannerPresets,
  saveCustomPreset,
  updateCustomPreset,
  deleteCustomPreset,
  getPresetById,
  getActivePresetId,
  setActivePresetId
} from '../src/lib/quantEngine/scannerPresets';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

console.log('================================================================');
console.log('🧪 TEST SUITE: Local-First Scanner Preset Management System');
console.log('================================================================\n');

// Mock localStorage for Node.js environment
const mockStorage = new Map<string, string>();
(global as any).window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
(global as any).localStorage = {
  getItem: (k: string) => mockStorage.get(k) || null,
  setItem: (k: string, v: string) => mockStorage.set(k, v),
  removeItem: (k: string) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};
(global as any).CustomEvent = class CustomEvent {
  detail: any;
  type: string;
  constructor(type: string, opts?: any) {
    this.type = type;
    this.detail = opts?.detail;
  }
};

// ── Test 1: Factory Presets Verification ──
console.log('▶ [1/5] Testing Factory Presets Integrity & SMC/ICT Geometries...');

assert(FACTORY_SWEEP_RECLAIM_PRESETS.length >= 5, `Sweep & Reclaim has at least 5 factory presets (found ${FACTORY_SWEEP_RECLAIM_PRESETS.length})`);
assert(FACTORY_ORDER_BLOCK_PRESETS.length >= 3, `Order Block has at least 3 factory presets (found ${FACTORY_ORDER_BLOCK_PRESETS.length})`);
assert(ALL_FACTORY_PRESETS.length >= 8, `Total factory presets >= 8 (found ${ALL_FACTORY_PRESETS.length})`);

for (const fp of ALL_FACTORY_PRESETS) {
  assert(fp.isFactory === true, `Factory preset "${fp.name}" is marked isFactory: true`);
  assert(fp.syncStatus === 'factory', `Factory preset "${fp.name}" has syncStatus: 'factory'`);
  assert(typeof fp.id === 'string' && fp.id.length > 0, `Factory preset ID valid: ${fp.id}`);
  assert(typeof fp.name === 'string' && fp.name.length > 0, `Factory preset Name valid: ${fp.name}`);
  assert(typeof fp.config === 'object' && fp.config !== null, `Factory preset Config exists for "${fp.name}"`);
}

// Verify Golden Platform Default
const golden = FACTORY_SWEEP_RECLAIM_PRESETS.find(p => p.id === 'factory_sr_golden_default');
assert(!!golden, 'Golden Sweep & Reclaim default preset exists');
const goldenConfig = golden!.config as SweepReclaimPresetConfig;
assert(goldenConfig.entryMode === 'SWEEP_OB_MT', 'Golden default uses SWEEP_OB_MT entry mode');
assert(goldenConfig.enforceDiscountPremiumGate === true, 'Golden default enforces Discount/Premium Gate');
assert(goldenConfig.volumeExpansionThreshold === 1.50, 'Golden default uses 1.50x Volume Expansion');
assert(goldenConfig.deltaDominanceThreshold === 60.0, 'Golden default uses 60% Delta Dominance');


// ── Test 2: Local-First Load Operations ──
console.log('\n▶ [2/5] Testing Local-First Preset Loading...');

const allLoaded = loadScannerPresets();
assert(allLoaded.length === ALL_FACTORY_PRESETS.length, `Initial load on clean storage returns exactly factory presets (${allLoaded.length})`);

const srLoaded = loadScannerPresets('SWEEP_RECLAIM');
assert(srLoaded.every(p => p.strategyType === 'SWEEP_RECLAIM'), 'Loaded SWEEP_RECLAIM presets only contain SWEEP_RECLAIM type');
assert(srLoaded.length === FACTORY_SWEEP_RECLAIM_PRESETS.length, `SWEEP_RECLAIM preset count matches factory count (${srLoaded.length})`);

const obLoaded = loadScannerPresets('ORDER_BLOCK');
assert(obLoaded.every(p => p.strategyType === 'ORDER_BLOCK'), 'Loaded ORDER_BLOCK presets only contain ORDER_BLOCK type');
assert(obLoaded.length === FACTORY_ORDER_BLOCK_PRESETS.length, `ORDER_BLOCK preset count matches factory count (${obLoaded.length})`);


// ── Test 3: Custom Preset CRUD Operations ──
console.log('\n▶ [3/5] Testing Custom Preset Create, Update, and Delete...');

// 3.1 Create Custom Sweep & Reclaim Preset
const newSrCustom = saveCustomPreset({
  name: 'ETHUSDC 5m - High Velocity Shelf Custom',
  description: 'Custom scalper testing Shelf Reclaim level with 70% Delta Dominance',
  strategyType: 'SWEEP_RECLAIM',
  symbol: 'ETHUSDC',
  timeframe: '5m',
  config: {
    symbol: 'ETHUSDC',
    timeframe: '5m',
    anchorTypes: ['ASIAN_LOW', 'LONDON_LOW'],
    lookbackMajor: 10,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 20,
    maxBarsSweepToReclaim: 8,
    maxBarsToRetest: 15,
    volumeExpansionThreshold: 2.0,
    deltaDominanceThreshold: 70.0,
    bodyRatioThreshold: 0.70,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
    stage1Multiple: 1.0,
    stage2Multiple: 2.0,
    stage3Multiple: 4.0,
    entryMode: 'SHELF_LEVEL',
    enableStructuralTrail: true,
    enableProfitRatchet: true,
    minSweepDepthAtrMultiplier: 0.15,
    slBufferAtrMultiplier: 0.20,
  } as SweepReclaimPresetConfig,
});

assert(newSrCustom.id.startsWith('preset_custom_sweep_reclaim_'), `Generated ID matches custom convention: ${newSrCustom.id}`);
assert(newSrCustom.isFactory === false, 'Custom preset isFactory is false');
assert(newSrCustom.syncStatus === 'local_only', 'Custom preset initial syncStatus is local_only');

// Verify stored in localStorage
const reloadedSR = loadScannerPresets('SWEEP_RECLAIM');
assert(reloadedSR.length === FACTORY_SWEEP_RECLAIM_PRESETS.length + 1, `Total SR presets after save is factory + 1 (${reloadedSR.length})`);
const foundCustom = getPresetById(newSrCustom.id);
assert(!!foundCustom, `getPresetById successfully finds custom preset: ${newSrCustom.id}`);
assert(foundCustom!.name === 'ETHUSDC 5m - High Velocity Shelf Custom', 'Preset name matches');
assert((foundCustom!.config as SweepReclaimPresetConfig).entryMode === 'SHELF_LEVEL', 'Config entryMode matches SHELF_LEVEL');

// 3.2 Update Custom Preset
const updated = updateCustomPreset(newSrCustom.id, {
  name: 'ETHUSDC 5m - High Velocity Shelf (Updated)',
  description: 'Updated description with 62% OTE entry mode',
  config: {
    ...(foundCustom!.config as SweepReclaimPresetConfig),
    entryMode: 'OTE_62',
    deltaDominanceThreshold: 75.0,
  },
});

assert(!!updated, 'updateCustomPreset returned updated preset object');
assert(updated!.name === 'ETHUSDC 5m - High Velocity Shelf (Updated)', 'Updated name saved');
assert((updated!.config as SweepReclaimPresetConfig).entryMode === 'OTE_62', 'Updated entryMode matches OTE_62');
assert((updated!.config as SweepReclaimPresetConfig).deltaDominanceThreshold === 75.0, 'Updated delta dominance threshold is 75.0');

// 3.3 Factory Preset Immutability Guard
const factoryUpdateAttempt = updateCustomPreset('factory_sr_golden_default', {
  name: 'Hacked Factory Name',
});
assert(factoryUpdateAttempt === null, 'Protected factory presets cannot be updated / overwritten');

// 3.4 Delete Custom Preset
const deleted = deleteCustomPreset(newSrCustom.id);
assert(deleted === true, 'deleteCustomPreset successfully returned true');
const afterDeleteSR = loadScannerPresets('SWEEP_RECLAIM');
assert(afterDeleteSR.length === FACTORY_SWEEP_RECLAIM_PRESETS.length, 'SR count restored to factory count after deletion');

const factoryDeleteAttempt = deleteCustomPreset('factory_sr_golden_default');
assert(factoryDeleteAttempt === false, 'Protected factory presets cannot be deleted');


// ── Test 4: Active Preset State Persistence ──
console.log('\n▶ [4/5] Testing Active Tab Preset Persistence...');

setActivePresetId('SWEEP_RECLAIM', 'factory_sr_eth_high_velocity');
const activeSR = getActivePresetId('SWEEP_RECLAIM');
assert(activeSR === 'factory_sr_eth_high_velocity', `Active SR preset persists in localStorage: ${activeSR}`);

setActivePresetId('ORDER_BLOCK', 'factory_ob_deep_macro_15m');
const activeOB = getActivePresetId('ORDER_BLOCK');
assert(activeOB === 'factory_ob_deep_macro_15m', `Active OB preset persists in localStorage: ${activeOB}`);


// ── Test 5: Parameter Hydration Parity Across All 7 Modes ──
console.log('\n▶ [5/5] Testing All 7 Entry Modes Parameter Serialization...');

const modes = ['SWEEP_OB_MT', 'OB_PROXIMAL', 'FVG_CE', 'FVG_PROXIMAL', 'FVG_DISTAL', 'OTE_62', 'SHELF_LEVEL'] as const;

for (const m of modes) {
  const customM = saveCustomPreset({
    name: `Test Mode ${m}`,
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    config: {
      ...goldenConfig,
      entryMode: m,
    },
  });

  const retrieved = getPresetById(customM.id);
  assert(!!retrieved, `Retrieved preset for mode ${m}`);
  assert((retrieved!.config as SweepReclaimPresetConfig).entryMode === m, `Retrieved entryMode matches ${m}`);
  deleteCustomPreset(customM.id);
}

console.log('\n================================================================');
console.log('✅ ALL 5/5 TEST SUITE STAGES PASSED CLEANLY WITH ZERO REGRESSIONS!');
console.log('================================================================\n');
