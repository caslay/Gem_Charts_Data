/**
 * scratch/test_entry_modes_resolver.ts
 * Rigorous Unit & Integration Test Suite for Retest Entry Model Price Resolver & Geometry Expansion.
 */

import {
  resolveRetestEntryPrice,
  getEntryModeLabel,
  getEntryModeDescription,
  SweepReclaimEntryMode,
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  DEFAULT_SWEEP_RECLAIM_CONFIG
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

console.log('================================================================');
console.log('🧪 TEST SUITE: Retest Entry Model Price Resolver & Geometries');
console.log('================================================================\n');

// ── Test 1: Bullish Setup Geometry Price Resolution ──
console.log('▶ [1/5] Testing Bullish Setup Geometry Resolution...');

const bullishAnchor = 2000.0;
const bullishSweepCandle = {
  high: 1998.0,
  low: 1980.0,
  open: 1995.0,
  close: 1982.0,
  mt: 1989.0, // (1998 + 1980) / 2
};
const bullishFvg = {
  top: 2015.0,
  bottom: 2005.0,
  ce: 2010.0,
};
const bullishDisplacement = {
  impulseHigh: 2050.0,
  impulseLow: 1980.0, // range = 70.0; 62% retracement = 2050 - 0.62 * 70 = 2050 - 43.4 = 2006.6
};

// 1.1 SHELF_LEVEL / RECLAIM_LEVEL
const bullShelf = resolveRetestEntryPrice({
  mode: 'SHELF_LEVEL',
  isBullish: true,
  anchorLevel: bullishAnchor,
  sweepCandle: bullishSweepCandle,
  fvg: bullishFvg,
  displacementExtremes: bullishDisplacement,
});
assert(bullShelf === 2000.0, `Bullish SHELF_LEVEL === 2000.0 (got ${bullShelf})`);

const bullLegacyReclaim = resolveRetestEntryPrice({
  mode: 'RECLAIM_LEVEL',
  isBullish: true,
  anchorLevel: bullishAnchor,
});
assert(bullLegacyReclaim === 2000.0, `Bullish RECLAIM_LEVEL alias === 2000.0 (got ${bullLegacyReclaim})`);

// 1.2 FVG_PROXIMAL (Bullish -> gap top: 2015.0)
const bullFvgProximal = resolveRetestEntryPrice({
  mode: 'FVG_PROXIMAL',
  isBullish: true,
  anchorLevel: bullishAnchor,
  fvg: bullishFvg,
});
assert(bullFvgProximal === 2015.0, `Bullish FVG_PROXIMAL === 2015.0 (got ${bullFvgProximal})`);

// 1.3 FVG_CE (50% CE: 2010.0)
const bullFvgCe = resolveRetestEntryPrice({
  mode: 'FVG_CE',
  isBullish: true,
  anchorLevel: bullishAnchor,
  fvg: bullishFvg,
});
assert(bullFvgCe === 2010.0, `Bullish FVG_CE === 2010.0 (got ${bullFvgCe})`);

// 1.4 FVG_DISTAL (Bullish -> gap bottom: 2005.0)
const bullFvgDistal = resolveRetestEntryPrice({
  mode: 'FVG_DISTAL',
  isBullish: true,
  anchorLevel: bullishAnchor,
  fvg: bullishFvg,
});
assert(bullFvgDistal === 2005.0, `Bullish FVG_DISTAL === 2005.0 (got ${bullFvgDistal})`);

// 1.5 OB_PROXIMAL (Bullish -> sweep candle high: 1998.0)
const bullObProximal = resolveRetestEntryPrice({
  mode: 'OB_PROXIMAL',
  isBullish: true,
  anchorLevel: bullishAnchor,
  sweepCandle: bullishSweepCandle,
});
assert(bullObProximal === 1998.0, `Bullish OB_PROXIMAL === 1998.0 (got ${bullObProximal})`);

// 1.6 SWEEP_OB_MT (50% Mean Threshold: 1989.0)
const bullObMt = resolveRetestEntryPrice({
  mode: 'SWEEP_OB_MT',
  isBullish: true,
  anchorLevel: bullishAnchor,
  sweepCandle: bullishSweepCandle,
});
assert(bullObMt === 1989.0, `Bullish SWEEP_OB_MT === 1989.0 (got ${bullObMt})`);

// 1.7 OTE_62 (Bullish -> 2050 - 0.62 * 70 = 2006.6)
const bullOte62 = resolveRetestEntryPrice({
  mode: 'OTE_62',
  isBullish: true,
  anchorLevel: bullishAnchor,
  displacementExtremes: bullishDisplacement,
});
assert(bullOte62 === 2006.6, `Bullish OTE_62 === 2006.6 (got ${bullOte62})`);


// ── Test 2: Bearish Setup Geometry Price Resolution ──
console.log('\n▶ [2/5] Testing Bearish Setup Geometry Resolution...');

const bearishAnchor = 3000.0;
const bearishSweepCandle = {
  high: 3020.0,
  low: 3002.0,
  open: 3005.0,
  close: 3018.0,
  mt: 3011.0, // (3020 + 3002) / 2
};
const bearishFvg = {
  top: 2995.0,
  bottom: 2985.0,
  ce: 2990.0,
};
const bearishDisplacement = {
  impulseHigh: 3020.0,
  impulseLow: 2920.0, // range = 100.0; 62% retracement = 2920 + 0.62 * 100 = 2982.0
};

// 2.1 SHELF_LEVEL
const bearShelf = resolveRetestEntryPrice({
  mode: 'SHELF_LEVEL',
  isBullish: false,
  anchorLevel: bearishAnchor,
  sweepCandle: bearishSweepCandle,
  fvg: bearishFvg,
  displacementExtremes: bearishDisplacement,
});
assert(bearShelf === 3000.0, `Bearish SHELF_LEVEL === 3000.0 (got ${bearShelf})`);

// 2.2 FVG_PROXIMAL (Bearish -> gap bottom: 2985.0)
const bearFvgProximal = resolveRetestEntryPrice({
  mode: 'FVG_PROXIMAL',
  isBullish: false,
  anchorLevel: bearishAnchor,
  fvg: bearishFvg,
});
assert(bearFvgProximal === 2985.0, `Bearish FVG_PROXIMAL === 2985.0 (got ${bearFvgProximal})`);

// 2.3 FVG_CE (50% CE: 2990.0)
const bearFvgCe = resolveRetestEntryPrice({
  mode: 'FVG_CE',
  isBullish: false,
  anchorLevel: bearishAnchor,
  fvg: bearishFvg,
});
assert(bearFvgCe === 2990.0, `Bearish FVG_CE === 2990.0 (got ${bearFvgCe})`);

// 2.4 FVG_DISTAL (Bearish -> gap top: 2995.0)
const bearFvgDistal = resolveRetestEntryPrice({
  mode: 'FVG_DISTAL',
  isBullish: false,
  anchorLevel: bearishAnchor,
  fvg: bearishFvg,
});
assert(bearFvgDistal === 2995.0, `Bearish FVG_DISTAL === 2995.0 (got ${bearFvgDistal})`);

// 2.5 OB_PROXIMAL (Bearish -> sweep candle low: 3002.0)
const bearObProximal = resolveRetestEntryPrice({
  mode: 'OB_PROXIMAL',
  isBullish: false,
  anchorLevel: bearishAnchor,
  sweepCandle: bearishSweepCandle,
});
assert(bearObProximal === 3002.0, `Bearish OB_PROXIMAL === 3002.0 (got ${bearObProximal})`);

// 2.6 SWEEP_OB_MT (50% Mean Threshold: 3011.0)
const bearObMt = resolveRetestEntryPrice({
  mode: 'SWEEP_OB_MT',
  isBullish: false,
  anchorLevel: bearishAnchor,
  sweepCandle: bearishSweepCandle,
});
assert(bearObMt === 3011.0, `Bearish SWEEP_OB_MT === 3011.0 (got ${bearObMt})`);

// 2.7 OTE_62 (Bearish -> 2920 + 0.62 * 100 = 2982.0)
const bearOte62 = resolveRetestEntryPrice({
  mode: 'OTE_62',
  isBullish: false,
  anchorLevel: bearishAnchor,
  displacementExtremes: bearishDisplacement,
});
assert(bearOte62 === 2982.0, `Bearish OTE_62 === 2982.0 (got ${bearOte62})`);


// ── Test 3: Safe Fallback Gating When Geometry is Missing ──
console.log('\n▶ [3/5] Testing Safe Fallback Gating...');

const fallbackModes: SweepReclaimEntryMode[] = [
  'SHELF_LEVEL',
  'RECLAIM_LEVEL',
  'FVG_PROXIMAL',
  'FVG_CE',
  'FVG_DISTAL',
  'OB_PROXIMAL',
  'SWEEP_OB_MT',
  'OTE_62',
];

for (const mode of fallbackModes) {
  const result = resolveRetestEntryPrice({
    mode,
    isBullish: true,
    anchorLevel: 2500.0,
    sweepCandle: null,
    fvg: null,
    displacementExtremes: null,
  });
  assert(result === 2500.0, `Fallback for mode ${mode} with null geometry safely returns anchor 2500.0 (got ${result})`);
}


// ── Test 4: Human-Readable Labels & Descriptions ──
console.log('\n▶ [4/5] Testing UI Label & Description Helpers...');

for (const mode of fallbackModes) {
  const label = getEntryModeLabel(mode);
  const desc = getEntryModeDescription(mode);
  assert(typeof label === 'string' && label.length > 0, `Label for ${mode} exists: "${label}"`);
  assert(typeof desc === 'string' && desc.length > 0, `Description for ${mode} exists: "${desc}"`);
}


// ── Test 5: Full SweepReclaimEngine Scan Parity Across All 7 Modes ──
console.log('\n▶ [5/5] Testing Full SweepReclaimEngine Integration Across All Modes...');

// Generate synthetic candles with a clear Bullish Asian Low sweep, displacement reclaim with FVG, and retest
function generateTestCandles(): Candle[] {
  const candles: Candle[] = [];
  const baseTime = Date.parse('2026-08-01T00:00:00.000Z');

  // 1. Asian Session (00:00 - 07:00 UTC) -> 28 15m candles. Low set at 1950.0 on bar 10
  for (let i = 0; i < 28; i++) {
    const t = baseTime + i * 15 * 60 * 1000;
    if (i === 10) {
      candles.push({ t, o: 1960, h: 1965, l: 1950, c: 1955, v: 100, taker_buy_vol: 50 });
    } else {
      candles.push({ t, o: 1970, h: 1980, l: 1965, c: 1975, v: 100, taker_buy_vol: 50 });
    }
  }

  // 2. Post-Asian consolidation (bar 28 to 32)
  for (let i = 28; i < 33; i++) {
    const t = baseTime + i * 15 * 60 * 1000;
    candles.push({ t, o: 1960, h: 1965, l: 1955, c: 1958, v: 100, taker_buy_vol: 50 });
  }

  // 3. Bar 33: Liquidity Sweep of Asian Low 1950 -> Low 1940 with lower wick rejection
  const sweepTime = baseTime + 33 * 15 * 60 * 1000;
  candles.push({
    t: sweepTime,
    o: 1955,
    h: 1956,
    l: 1940, // sweep extreme
    c: 1952,
    v: 300,  // high volume
    taker_buy_vol: 220,
  });

  // 4. Bar 34: Displacement Reclaim with 3 pillars & BISI FVG
  const reclaimTime = baseTime + 34 * 15 * 60 * 1000;
  candles.push({
    t: reclaimTime,
    o: 1953,
    h: 1985,
    l: 1953,
    c: 1982, // closes strictly above Asian Low 1950
    v: 500,  // volume expansion > 1.5x
    taker_buy_vol: 450, // delta dominance > 60%
  });

  // 5. Bar 35: Displacement Continuation
  const contTime = baseTime + 35 * 15 * 60 * 1000;
  candles.push({
    t: contTime,
    o: 1982,
    h: 2000,
    l: 1975, // FVG formed between bar 33 high 1956 and bar 35 low 1975 -> gap (1956 to 1975)
    c: 1995,
    v: 400,
    taker_buy_vol: 350,
  });

  // 6. Bars 36-45: Pullback / Retest into various entry levels and continuation to TP3
  for (let i = 36; i < 50; i++) {
    const t = baseTime + i * 15 * 60 * 1000;
    if (i === 37) {
      // Retest bar dipping to 1942 (touches all OB / FVG / shelf levels) and closing at 1965
      candles.push({ t, o: 1980, h: 1980, l: 1942, c: 1965, v: 200, taker_buy_vol: 120 });
    } else if (i > 37) {
      // Rally to TP3 2050+
      candles.push({ t, o: 1965 + (i - 37) * 10, h: 1975 + (i - 37) * 10, l: 1960 + (i - 37) * 10, c: 1970 + (i - 37) * 10, v: 250, taker_buy_vol: 180 });
    } else {
      candles.push({ t, o: 1990, h: 1992, l: 1980, c: 1982, v: 150, taker_buy_vol: 80 });
    }
  }

  return candles;
}

const testCandles = generateTestCandles();

const testModes: SweepReclaimEntryMode[] = [
  'SWEEP_OB_MT',
  'OB_PROXIMAL',
  'FVG_CE',
  'FVG_PROXIMAL',
  'FVG_DISTAL',
  'OTE_62',
  'SHELF_LEVEL',
];

for (const mode of testModes) {
  const config: SweepReclaimScanConfig = {
    symbol: 'ETHUSDC',
    timeframe: '15m',
    anchorTypes: ['ASIAN_LOW'],
    entryMode: mode,
    enforceDiscountPremiumGate: false,
    requireThreePillarDisplacement: true,
  };

  const engine = new SweepReclaimEngine(config);
  const result = engine.scanHistoricalSetups(testCandles);

  assert(result.setups.length > 0, `Engine with mode ${mode} detected ${result.setups.length} setups`);
  const setup = result.setups[0];
  assert(setup.entry_mode === mode, `Setup entry_mode === ${mode}`);
  assert(typeof setup.entry_price === 'number' && !isNaN(setup.entry_price), `Setup entry_price is valid number: $${setup.entry_price}`);
  console.log(`     [${mode}] Entry Price: $${setup.entry_price} | SL: $${setup.stop_loss} | TP1: $${setup.stage1_target} | Retested: ${setup.is_retested} | Outcome: ${setup.simulated_outcome}`);
}

console.log('\n================================================================');
console.log('✅ ALL 5/5 TEST SUITE STAGES PASSED CLEANLY WITH ZERO REGRESSIONS!');
console.log('================================================================\n');
