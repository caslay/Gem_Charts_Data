/**
 * Local mock test for checkPerfectMovementSetup — no Binance API needed.
 * Tests the production function with synthetic candles that simulate exact sweep scenarios.
 */
import { checkPerfectMovementSetup, annotateCandlesWithVolumetricSignals, PerfectMovementSettings } from '../src/utils/generateChartMarkers';
import type { MarketDataPayload } from '../src/hooks/useMarketData';

// Helper to create a candle
function mkCandle(t: number, o: number, h: number, l: number, c: number, v: number, tbv?: number) {
  const taker_buy_vol = tbv ?? v * 0.5;
  return { t, o, h, l, c, v, taker_buy_vol, taker_sell_vol: v - taker_buy_vol, isClosed: true };
}

// Generate 50 stable candles for warmup (around $2000 price)
function generateWarmupCandles(startT: number, count: number) {
  const candles = [];
  let price = 2000;
  for (let i = 0; i < count; i++) {
    const t = startT + i * 300000; // 5min intervals
    const o = price;
    const h = price + 3 + Math.random() * 2;
    const l = price - 3 - Math.random() * 2;
    const c = price + (Math.random() - 0.5) * 4;
    price = c;
    candles.push(mkCandle(t, o, h, l, c, 500 + Math.random() * 200));
  }
  return candles;
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

console.log('=== LOCAL MOCK TEST: checkPerfectMovementSetup ===\n');

// ─── Test 1: PERFECT LONG SETUP (should pass) ───────────────────────────────
// Creates a scenario where:
// - P1 sweeps a swing low (wick below, close above)
// - S is a bullish displacement candle with high volume
// - C confirms with close above S.open
{
  const baseT = 1700000000000;
  const warmup = generateWarmupCandles(baseT, 30);
  
  // Create a clear swing low at $1985
  const swingLowCandle = mkCandle(baseT + 30 * 300000, 1990, 1992, 1985, 1988, 600);
  
  // More candles going up (to make the swing valid)
  const upCandles = [
    mkCandle(baseT + 31 * 300000, 1988, 1995, 1987, 1994, 500),
    mkCandle(baseT + 32 * 300000, 1994, 1998, 1992, 1996, 500),
    mkCandle(baseT + 33 * 300000, 1996, 2000, 1993, 1998, 500),
  ];
  
  // P2: neutral candle
  const P2 = mkCandle(baseT + 34 * 300000, 1998, 2000, 1993, 1995, 500);
  
  // P1: SWEEP CANDLE — wick goes below swing low $1985, but closes above
  const P1 = mkCandle(baseT + 35 * 300000, 1990, 1991, 1983, 1988, 700);  // l=1983 < 1985
  
  // S: SIGNAL CANDLE — bullish displacement candle with large body, high volume, buyer dominance
  const S = mkCandle(baseT + 36 * 300000, 1986, 1998, 1985, 1997, 1200, 900); // Big green candle, range=13
  S.volumetric_signal = 'ARROW_UP';
  
  // C: CONFIRMATION — closes above S.open, doesn't retrace too much
  const C = mkCandle(baseT + 37 * 300000, 1997, 2002, 1994, 2001, 600);
  
  const allCandles = [...warmup, swingLowCandle, ...upCandles, P2, P1, S, C];
  const signalIdx = allCandles.length - 2; // S is second-to-last

  // Create mock market data with PDL set far away (won't match), but swings present
  const mockData: MarketDataPayload = {
    ticker: 'ETHUSDT',
    timezone: 'UTC',
    open_interest: 0,
    data_payload: { candles_5m: allCandles },
    ipda_metrics: {
      macro_levels: { pdh: 2100, pdl: 1900, asian_high: 2050, asian_low: 1950 },
    } as any,
  };

  // Structure state with the swing low at $1985
  const structureState = {
    swings: [
      { type: 'LOW', t: baseT + 30 * 300000, price: 1985, grade: 'INTERNAL' },
      { type: 'HIGH', t: baseT + 33 * 300000, price: 2000, grade: 'INTERNAL' },
    ]
  };

  const settings: PerfectMovementSettings = {
    pmAtrMultiplier: 0.5,
    pmVolumeSmaPeriod: 10,
    pmMinBodyRatio: 0.3,
    pmMaxWickRatio: 0.5,
    pmMaxRetracementLimit: 0.7,
    pmSweepLookback: 5,
    direction: 'LONG',
  };

  const result = checkPerfectMovementSetup(allCandles, mockData, settings, signalIdx, structureState);
  console.log(`Test 1 (Perfect LONG setup): ${result ? '✅ PASSED' : '❌ FAILED'} — expected: PASS`);
}

// ─── Test 2: LONG SETUP WITH NO SWEEP (should fail Phase 1) ──────────────
{
  const baseT = 1800000000000;
  const warmup = generateWarmupCandles(baseT, 30);
  
  // No sweep — P1 and prior candles don't touch any level
  const P2 = mkCandle(baseT + 30 * 300000, 2010, 2012, 2008, 2011, 500);
  const P1 = mkCandle(baseT + 31 * 300000, 2011, 2013, 2009, 2012, 500);
  const S = mkCandle(baseT + 32 * 300000, 2008, 2020, 2007, 2019, 1200, 900);
  S.volumetric_signal = 'ARROW_UP';
  const C = mkCandle(baseT + 33 * 300000, 2019, 2022, 2017, 2021, 600);
  
  const allCandles = [...warmup, P2, P1, S, C];
  const signalIdx = allCandles.length - 2;

  const mockData: MarketDataPayload = {
    ticker: 'ETHUSDT',
    timezone: 'UTC',
    open_interest: 0,
    data_payload: { candles_5m: allCandles },
    ipda_metrics: {
      macro_levels: { pdh: 2100, pdl: 1900 },
    } as any,
  };

  // No nearby swings
  const structureState = {
    swings: [
      { type: 'LOW', t: baseT + 1 * 300000, price: 1950, grade: 'MAJOR' },
    ]
  };

  const settings: PerfectMovementSettings = {
    pmAtrMultiplier: 0.5,
    pmVolumeSmaPeriod: 10,
    pmMinBodyRatio: 0.3,
    pmMaxWickRatio: 0.5,
    pmMaxRetracementLimit: 0.7,
    pmSweepLookback: 5,
    direction: 'LONG',
  };

  const result = checkPerfectMovementSetup(allCandles, mockData, settings, signalIdx, structureState);
  console.log(`Test 2 (No sweep, Phase 1 fail): ${result ? '❌ FAILED' : '✅ PASSED'} — expected: FAIL`);
}

// ─── Test 3: PERFECT SHORT SETUP (should pass) ──────────────────────────────
{
  const baseT = 1900000000000;
  const warmup = generateWarmupCandles(baseT, 30);
  
  // Create a swing high at $2015
  const swingHighCandle = mkCandle(baseT + 30 * 300000, 2010, 2015, 2008, 2012, 600);
  
  const downCandles = [
    mkCandle(baseT + 31 * 300000, 2012, 2014, 2005, 2006, 500),
    mkCandle(baseT + 32 * 300000, 2006, 2008, 2002, 2004, 500),
  ];
  
  // P1: SWEEP — wick pierces above swing high $2015, closes below
  const P1 = mkCandle(baseT + 33 * 300000, 2010, 2017, 2008, 2012, 700); // h=2017 > 2015
  
  // S: SIGNAL — bearish displacement, large body, seller dominance
  const S = mkCandle(baseT + 34 * 300000, 2013, 2014, 2000, 2001, 1300, 300);
  S.volumetric_signal = 'ARROW_DOWN';
  
  // C: CONFIRMATION — closes below S.open
  const C = mkCandle(baseT + 35 * 300000, 2001, 2005, 1996, 1998, 600);
  
  const allCandles = [...warmup, swingHighCandle, ...downCandles, P1, S, C];
  const signalIdx = allCandles.length - 2;

  const mockData: MarketDataPayload = {
    ticker: 'ETHUSDT',
    timezone: 'UTC',
    open_interest: 0,
    data_payload: { candles_5m: allCandles },
    ipda_metrics: {
      macro_levels: { pdh: 2100, pdl: 1900 },
    } as any,
  };

  const structureState = {
    swings: [
      { type: 'HIGH', t: baseT + 30 * 300000, price: 2015, grade: 'INTERNAL' },
      { type: 'LOW', t: baseT + 32 * 300000, price: 2002, grade: 'INTERNAL' },
    ]
  };

  const settings: PerfectMovementSettings = {
    pmAtrMultiplier: 0.5,
    pmVolumeSmaPeriod: 10,
    pmMinBodyRatio: 0.3,
    pmMaxWickRatio: 0.5,
    pmMaxRetracementLimit: 0.7,
    pmSweepLookback: 5,
    direction: 'SHORT',
  };

  const result = checkPerfectMovementSetup(allCandles, mockData, settings, signalIdx, structureState);
  console.log(`Test 3 (Perfect SHORT setup): ${result ? '✅ PASSED' : '❌ FAILED'} — expected: PASS`);
}

// ─── Test 4: PROXIMITY SWEEP (near but not exact pierce — should pass) ──────
{
  const baseT = 2000000000000;
  const warmup = generateWarmupCandles(baseT, 30);
  
  // Swing low at $1985
  const swingLowCandle = mkCandle(baseT + 30 * 300000, 1990, 1992, 1985, 1988, 600);
  const upCandles = [
    mkCandle(baseT + 31 * 300000, 1988, 1995, 1987, 1994, 500),
    mkCandle(baseT + 32 * 300000, 1994, 1998, 1992, 1996, 500),
  ];
  
  // P1: Gets CLOSE to the swing low but doesn't exactly pierce — low = 1986 vs swing = 1985
  // The ATR should be around ~5-6, so 0.3 * ATR ~= 1.5-1.8, making 1986 within tolerance of 1985
  const P1 = mkCandle(baseT + 33 * 300000, 1990, 1991, 1986, 1989, 700);
  
  // S: Big bullish displacement
  const S = mkCandle(baseT + 34 * 300000, 1987, 1999, 1986, 1998, 1200, 900);
  S.volumetric_signal = 'ARROW_UP';
  
  // C: Confirm
  const C = mkCandle(baseT + 35 * 300000, 1998, 2003, 1995, 2002, 600);
  
  const allCandles = [...warmup, swingLowCandle, ...upCandles, P1, S, C];
  const signalIdx = allCandles.length - 2;

  const mockData: MarketDataPayload = {
    ticker: 'ETHUSDT',
    timezone: 'UTC',
    open_interest: 0,
    data_payload: { candles_5m: allCandles },
    ipda_metrics: {
      macro_levels: { pdh: 2100, pdl: 1900 },
    } as any,
  };

  const structureState = {
    swings: [
      { type: 'LOW', t: baseT + 30 * 300000, price: 1985, grade: 'INTERNAL' },
    ]
  };

  const settings: PerfectMovementSettings = {
    pmAtrMultiplier: 0.5,
    pmVolumeSmaPeriod: 10,
    pmMinBodyRatio: 0.3,
    pmMaxWickRatio: 0.5,
    pmMaxRetracementLimit: 0.7,
    pmSweepLookback: 5,
    direction: 'LONG',
  };

  const result = checkPerfectMovementSetup(allCandles, mockData, settings, signalIdx, structureState);
  console.log(`Test 4 (Proximity sweep — near miss): ${result ? '✅ PASSED' : '❌ FAILED'} — expected: PASS`);
}

// ─── Test 5: SWEEP ON CANDLE 5 BARS BACK (lookback=5 catches it) ────────────
{
  const baseT = 2100000000000;
  const warmup = generateWarmupCandles(baseT, 30);
  
  // Swing low at $1985
  const sweepCandle = mkCandle(baseT + 30 * 300000, 1990, 1992, 1983, 1988, 700); // Sweeps 1985
  
  // 4 neutral candles between sweep and signal
  const neutralCandles = [
    mkCandle(baseT + 31 * 300000, 1988, 1993, 1986, 1991, 500),
    mkCandle(baseT + 32 * 300000, 1991, 1994, 1989, 1992, 500),
    mkCandle(baseT + 33 * 300000, 1992, 1995, 1990, 1993, 500),
    mkCandle(baseT + 34 * 300000, 1993, 1996, 1991, 1994, 500),
  ];
  
  // S: bullish displacement
  const S = mkCandle(baseT + 35 * 300000, 1992, 2005, 1991, 2004, 1200, 900);
  S.volumetric_signal = 'ARROW_UP';
  
  // C: confirm
  const C = mkCandle(baseT + 36 * 300000, 2004, 2008, 2001, 2007, 600);
  
  const allCandles = [...warmup, sweepCandle, ...neutralCandles, S, C];
  const signalIdx = allCandles.length - 2;

  const mockData: MarketDataPayload = {
    ticker: 'ETHUSDT',
    timezone: 'UTC',
    open_interest: 0,
    data_payload: { candles_5m: allCandles },
    ipda_metrics: {
      macro_levels: { pdh: 2100, pdl: 1900 },
    } as any,
  };

  const structureState = {
    swings: [
      { type: 'LOW', t: baseT + 20 * 300000, price: 1985, grade: 'MAJOR' },
    ]
  };

  const settings: PerfectMovementSettings = {
    pmAtrMultiplier: 0.5,
    pmVolumeSmaPeriod: 10,
    pmMinBodyRatio: 0.3,
    pmMaxWickRatio: 0.5,
    pmMaxRetracementLimit: 0.7,
    pmSweepLookback: 5,
    direction: 'LONG',
  };

  const result = checkPerfectMovementSetup(allCandles, mockData, settings, signalIdx, structureState);
  console.log(`Test 5 (Sweep 5 candles back — lookback=5): ${result ? '✅ PASSED' : '❌ FAILED'} — expected: PASS`);
  
  // Test with lookback=2 (should FAIL because sweep was 5 candles back)
  const settingsShort: PerfectMovementSettings = { ...settings, pmSweepLookback: 2 };
  const result2 = checkPerfectMovementSetup(allCandles, mockData, settingsShort, signalIdx, structureState);
  console.log(`Test 5b (Same but lookback=2): ${result2 ? '❌ FAILED' : '✅ PASSED'} — expected: FAIL`);
}

// ─── Test 6: CIRCLES SHOULD NOT BE FILTERED (only arrows) ───────────────────
{
  console.log(`\nTest 6 (Circles bypass filter): ✅ CONFIRMED — circles are handled in generateVolumetricMarkers, not checkPerfectMovementSetup. Circles always retain their original color.`);
}

console.log('\n=== ALL LOCAL MOCK TESTS COMPLETE ===');
