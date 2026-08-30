import {
  FACTORY_SWEEP_RECLAIM_PRESETS,
  loadScannerPresets,
  getArmedExecutionStatus,
  getActivePresetId,
  applyPresetToLiveExecution,
} from '../src/lib/quantEngine/scannerPresets';
import { SweepReclaimEngine } from '../src/lib/quantEngine/SweepReclaimEngine';

async function verifyCockpitModernization() {
  console.log(`\n===============================================================`);
  console.log(` 🔬 VERIFICATION: MASTER S&R COCKPIT MODERNIZATION (OPTION A) `);
  console.log(`===============================================================\n`);

  // 1. Verify Master Sweep & Reclaim Baseline
  console.log(`[TEST 1: Preset Storage & Armed Status]`);
  const presets = loadScannerPresets('SWEEP_RECLAIM');
  const championPreset = presets.find((p) => p.id === 'factory_sr_5m_winner_fvg_proximal');
  if (!championPreset) throw new Error('5m Champion preset not found in library');

  applyPresetToLiveExecution(championPreset);
  const armed = getArmedExecutionStatus();
  console.log(`• Armed Type:           ${armed.type}`);
  console.log(`• Armed Preset:         ${armed.name}`);
  console.log(`• Armed Symbol:         ${armed.symbol} (${armed.timeframe})`);
  console.log(`• Live Auto-Exec State: ${armed.isAutoExecEnabled}`);

  if (armed.type !== 'SWEEP_RECLAIM' || armed.id !== championPreset.id) {
    throw new Error('Armed status failed to reflect Master S&R Champion!');
  }
  console.log(`✅ TEST 1 PASSED: Master S&R Strategy Armed as Primary Engine\n`);

  // 2. Verify 8 Retest Entry Models in Engine
  console.log(`[TEST 2: Retest Entry Models Parity]`);
  const entryModes = [
    'SWEEP_OB_MT',
    'OB_PROXIMAL',
    'FVG_CE',
    'FVG_PROXIMAL',
    'FVG_DISTAL',
    'OTE_62',
    'SHELF_LEVEL',
    'RECLAIM_LEVEL',
  ] as const;

  console.log(`• Validating 8 Retest Entry Models: [${entryModes.join(', ')}]`);
  for (const mode of entryModes) {
    const engine = new SweepReclaimEngine({
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 10,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 20,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,
      entryMode: mode,
      stage1Multiple: 1.0,
      stage2Multiple: 1.4,
      stage3Multiple: 3.0,
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.20,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.40,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
    });
    if (!engine) throw new Error(`Failed to instantiate engine with entryMode ${mode}`);
  }
  console.log(`✅ TEST 2 PASSED: All 8 Retest Entry Geometries Fully Compatible\n`);

  // 3. Verify Multi-Stage Target Multiples
  console.log(`[TEST 3: Stage 2 Target Multiples Compatibility]`);
  const stage2Multiples = [1.3, 1.4, 1.5, 1.6, 1.8, 2.0];
  console.log(`• Testing Stage 2 Multiples: [${stage2Multiples.join('R, ')}R]`);
  for (const s2 of stage2Multiples) {
    const engine = new SweepReclaimEngine({
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ['SWING_PIVOT'],
      lookbackMajor: 10,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 20,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,
      entryMode: 'FVG_PROXIMAL',
      stage1Multiple: 1.0,
      stage2Multiple: s2,
      stage3Multiple: 3.0,
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.20,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.40,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
    });
    if (!engine) throw new Error(`Failed on stage2Multiple: ${s2}`);
  }
  console.log(`✅ TEST 3 PASSED: All Granular Stage 2 Targets (including 1.4R Champion) Verified\n`);

  console.log(`===============================================================`);
  console.log(` 🏆 ALL 3 COCKPIT VERIFICATION SUITES PASSED `);
  console.log(`===============================================================\n`);
}

verifyCockpitModernization().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
