import { fetchHistoricalKlines, computeMacroContext } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';

async function testValuationGateFix() {
  console.log(`\n===============================================================`);
  console.log(` 🔬 VERIFICATION TEST: DISCOUNT/PREMIUM STRUCTURAL GATE VETO`);
  console.log(`===============================================================\n`);

  const symbol = 'ETHUSDC';
  const all5m = await fetchHistoricalKlines(symbol, '5m', 1000);
  const all15m = await fetchHistoricalKlines(symbol, '15m', 500);
  const all1h = await fetchHistoricalKlines(symbol, '1h', 500);

  // Compute macro context with 5m structural dealing range
  const macro = computeMacroContext(all1h, all15m, all5m);
  console.log(`Macro Context Loaded:`);
  console.log(`  Bias: ${macro.macroDailyBias}`);
  console.log(`  PDH: $${macro.pdh}, PDL: $${macro.pdl}`);
  console.log(`  Structural Dealing Range: $${macro.localDealingRange?.low} - $${macro.localDealingRange?.high} (EQ: $${macro.localDealingRange?.equilibrium})`);
  console.log(`  Current Status: ${macro.localDealingRange?.current_status}`);

  // 1. Test with exact screenshot structural dealing range ($2400-$2516.78, EQ $2458.39)
  console.log(`\n▶ TEST CASE 1: Exact UI Screenshot Dealing Range ($2400 - $2516.78, EQ $2458.39)`);
  const scanConfigScreenshot: SweepReclaimScanConfig = {
    symbol,
    timeframe: '5m',
    anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
    lookbackMajor: 10,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 25,
    maxBarsSweepToReclaim: 10,
    maxBarsToRetest: 20,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.12,
    entryMode: 'FVG_PROXIMAL',
    stage1Multiple: 1.0,
    stage2Multiple: 1.4,
    stage3Multiple: 3.0,
    enableStructuralTrail: true,
    enableProfitRatchet: false,
    volumeSmaPeriod: 20,
    volumeExpansionThreshold: 1.35,
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.50,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
    structuralDealingRange: {
      high: 2516.78,
      low: 2400.00,
      equilibrium: 2458.39
    }
  };

  const srEngineScreenshot = new SweepReclaimEngine(scanConfigScreenshot);
  const scanResScreenshot = srEngineScreenshot.scanHistoricalSetups(all5m);
  const setupsScreenshot = scanResScreenshot.setups || [];

  const screenshotSetup = setupsScreenshot.find(s => 
    s.type === 'BEARISH' && 
    Math.abs(s.anchor_level - 2445.51) < 0.1 &&
    s.reclaim_index !== null
  );

  if (screenshotSetup) {
    console.log(`  Setup ID: ${screenshotSetup.id}`);
    console.log(`  Anchor: ${screenshotSetup.anchor_name} ($${screenshotSetup.anchor_level})`);
    console.log(`  Entry Price: $${screenshotSetup.entry_price}`);
    console.log(`  Dealing Range EQ: $${screenshotSetup.dealing_range_equilibrium}`);
    console.log(`  is_valuation_aligned: ${screenshotSetup.is_valuation_aligned}`);
    console.log(`  simulated_outcome: ${screenshotSetup.simulated_outcome}`);

    if (screenshotSetup.is_valuation_aligned === false && screenshotSetup.simulated_outcome === 'INVALIDATED') {
      console.log(`\n✅ TEST CASE 1 PASSED: Short setup @ $${screenshotSetup.entry_price} was SUCCESSFULLY VETOED (Entry $${screenshotSetup.entry_price} < EQ $2458.39)!`);
    } else {
      console.log(`\n❌ TEST CASE 1 FAILED: Setup was not vetoed.`);
    }
  } else {
    console.log(`  Target screenshot setup not found.`);
  }

  // Test AutomatedStrategyExecutionEngine live scan loop
  console.log(`\n▶ AUTOMATED EXECUTION ENGINE LIVE SCAN TEST:`);
  const liveEngine = new AutomatedStrategyExecutionEngine({
    symbol,
    compoundingRiskPct: 2.0,
    maxOpenPositions: 1,
    autoExecute: true,
    liveSettings: {
      enabledTimeframes: ['5m'],
      entryMode: 'FVG_PROXIMAL',
      stage1Multiple: 1.0,
      stage2Multiple: 1.4,
      stage3Multiple: 3.0,
      stage1Ratio: 0.50,
      stage2Ratio: 0.50,
      stage3Ratio: 0.00,
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
    }
  });

  const scanResult = liveEngine.onMultiTimeframeCandles(
    { '5m': all5m, '15m': all15m, '1h': all1h },
    macro
  );

  console.log(`  Scanned Setups: ${scanResult.scannedSetups.length}`);
  console.log(`  Pending Limit Orders Armed: ${liveEngine.getPendingLimitOrders().length}`);
  console.log(`  Active Positions: ${liveEngine.getActivePositions().length}`);

  // Confirm zero short orders armed in discount
  const armedShortsInDiscount = liveEngine.getPendingLimitOrders().filter(p => 
    p.direction === 'SHORT' && 
    macro.localDealingRange?.equilibrium && 
    p.entryPrice < macro.localDealingRange.equilibrium
  );

  if (armedShortsInDiscount.length === 0) {
    console.log(`\n✅ LIVE EXECUTION ENGINE TEST PASSED: 0 short orders armed in Discount!`);
  } else {
    console.log(`\n❌ LIVE EXECUTION ENGINE TEST FAILED: Armed short in discount:`, armedShortsInDiscount);
  }
}

testValuationGateFix().catch(console.error);
