import { checkPerfectMovementSetup, annotateCandlesWithVolumetricSignals, PerfectMovementSettings } from '../src/utils/generateChartMarkers';
import { analyzeMarketStructure } from '../src/lib/structureEngine';
import type { MarketDataPayload, Candle } from '../src/hooks/useMarketData';
import https from 'https';

// Fetch Binance candles helper (copied from test_structure.ts)
async function fetchBinanceCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const raw = JSON.parse(data);
          if (!Array.isArray(raw)) {
            reject(new Error('Invalid response from Binance'));
            return;
          }
          const candles: Candle[] = raw.map((c: any) => {
            const v = parseFloat(c[5]);
            const taker_buy_vol = parseFloat(c[9]);
            return {
              t: c[0],
              o: parseFloat(c[1]),
              h: parseFloat(c[2]),
              l: parseFloat(c[3]),
              c: parseFloat(c[4]),
              v: v,
              taker_buy_vol,
              taker_sell_vol: v - taker_buy_vol,
              isClosed: true
            };
          });
          resolve(candles);
        } catch (e: any) {
          reject(e);
        }
      });
    }).on('error', (e) => reject(e));
  });
}

// Custom diagnostic version of checkPerfectMovementSetup to report EXACTLY what failed
function diagnosePerfectMovementSetup(
  candles: any[],
  data: MarketDataPayload | null,
  settings: PerfectMovementSettings,
  signalIdx: number,
  structureState: any
): { pass: boolean; reason?: string } {
  if (!data || candles.length < 20 || signalIdx < 3 || signalIdx >= candles.length - 1) {
    return { pass: false, reason: 'Insufficient data boundary guards' };
  }

  const pmAtrMultiplier = settings.pmAtrMultiplier ?? 1.5;
  const pmVolumeSmaPeriod = settings.pmVolumeSmaPeriod ?? 10;
  const pmMinBodyRatio = settings.pmMinBodyRatio ?? 0.6;
  const pmMaxWickRatio = settings.pmMaxWickRatio ?? 0.15;
  const pmMaxRetracementLimit = settings.pmMaxRetracementLimit ?? 0.5;
  const direction = settings.direction || 'LONG';

  const S = candles[signalIdx];
  const C = candles[signalIdx + 1];
  const P1 = candles[signalIdx - 1];
  const P2 = candles[signalIdx - 2];

  const calculateATR = (srcCandles: any[], period = 14) => {
    let trs: number[] = [];
    for (let i = 1; i < srcCandles.length; i++) {
      const high = srcCandles[i].h;
      const low = srcCandles[i].l;
      const prevClose = srcCandles[i - 1].c;
      trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    if (trs.length === 0) return 0;
    return trs.slice(-period).reduce((acc, v) => acc + v, 0) / Math.min(period, trs.length);
  };

  // --- Phase 1: Structural Proximity & Liquidity Sweep (Setup) ---
  const ipda = data.ipda_metrics || {};
  const pdh = ipda.macro_levels?.pdh || ipda.pdh || 0;
  const pdl = ipda.macro_levels?.pdl || ipda.pdl || 0;

  const asianHigh = ipda.macro_levels?.asian_high || ipda.session_ranges?.asian_range?.high || 0;
  const asianLow = ipda.macro_levels?.asian_low || ipda.session_ranges?.asian_range?.low || 0;

  const londonHigh = ipda.session_ranges?.london_range?.high || 0;
  const londonLow = ipda.session_ranges?.london_range?.low || 0;

  const swings = structureState?.swings || ipda.full_structure_map?.swings || [];

  const checkCandleSweep = (c: any): { swept: boolean; matchedLevel?: string } => {
    if (direction === 'LONG') {
      if (pdl > 0 && c.l <= pdl && c.c > pdl) return { swept: true, matchedLevel: `PDL (${pdl})` };
      if (asianLow > 0 && c.l <= asianLow && c.c > asianLow) return { swept: true, matchedLevel: `Asian Low (${asianLow})` };
      if (londonLow > 0 && c.l <= londonLow && c.c > londonLow) return { swept: true, matchedLevel: `London Low (${londonLow})` };

      const priorSwingLows = swings.filter((s: any) => s.type === 'LOW' && s.t < c.t && (s.grade === 'MAJOR' || s.structure_type === 'MAJOR' || s.grade === 'INTERNAL' || s.structure_type === 'INTERNAL'));
      // Check the last 5 swing lows
      const recentLows = priorSwingLows.slice(-5);
      for (const s of recentLows) {
        const p = Number(s.price);
        if (c.l <= p && c.c > p) {
          return { swept: true, matchedLevel: `Swing Low (${p})` };
        }
      }
    } else {
      if (pdh > 0 && c.h >= pdh && c.c < pdh) return { swept: true, matchedLevel: `PDH (${pdh})` };
      if (asianHigh > 0 && c.h >= asianHigh && c.c < asianHigh) return { swept: true, matchedLevel: `Asian High (${asianHigh})` };
      if (londonHigh > 0 && c.h >= londonHigh && c.c < londonHigh) return { swept: true, matchedLevel: `London High (${londonHigh})` };

      const priorSwingHighs = swings.filter((s: any) => s.type === 'HIGH' && s.t < c.t && (s.grade === 'MAJOR' || s.structure_type === 'MAJOR' || s.grade === 'INTERNAL' || s.structure_type === 'INTERNAL'));
      // Check the last 5 swing highs
      const recentHighs = priorSwingHighs.slice(-5);
      for (const s of recentHighs) {
        const p = Number(s.price);
        if (c.h >= p && c.c < p) {
          return { swept: true, matchedLevel: `Swing High (${p})` };
        }
      }
    }
    return { swept: false };
  };

  const sweepP1 = checkCandleSweep(P1);
  const sweepP2 = checkCandleSweep(P2);
  if (!sweepP1.swept && !sweepP2.swept) {
    return { pass: false, reason: 'Phase 1: No sweeps found on P1 or P2 candles.' };
  }
  const matchedLevel = sweepP1.swept ? sweepP1.matchedLevel : sweepP2.matchedLevel;

  // --- Phase 2: Volumetric Anatomy (Catalyst) ---
  const sliceForAtr = candles.slice(0, signalIdx + 1);
  const atr = calculateATR(sliceForAtr, 14);
  const sRange = S.h - S.l;
  if (sRange < pmAtrMultiplier * atr) {
    return { pass: false, reason: `Phase 2: Signal candle range (${sRange.toFixed(2)}) is less than ATR threshold (${(pmAtrMultiplier * atr).toFixed(2)})` };
  }

  let volSum = 0;
  const vStartIdx = Math.max(0, signalIdx - pmVolumeSmaPeriod);
  const vEndIdx = signalIdx;
  for (let idx = vStartIdx; idx < vEndIdx; idx++) {
    volSum += candles[idx].v;
  }
  const avgVol = volSum / Math.max(1, vEndIdx - vStartIdx);
  if (S.v <= avgVol) {
    return { pass: false, reason: `Phase 2: Signal volume (${S.v.toFixed(0)}) is not greater than avg volume (${avgVol.toFixed(0)})` };
  }

  const sBody = Math.abs(S.c - S.o);
  const sBodyRatio = sRange > 0 ? sBody / sRange : 0;
  if (sBodyRatio < pmMinBodyRatio) {
    return { pass: false, reason: `Phase 2: Body ratio (${sBodyRatio.toFixed(2)}) is below minimum (${pmMinBodyRatio.toFixed(2)})` };
  }

  if (direction === 'LONG') {
    const wickHigh = S.h - S.c;
    if (wickHigh > pmMaxWickRatio * sRange) {
      return { pass: false, reason: `Phase 2: Long upper wick (${wickHigh.toFixed(2)}) exceeds max wick limit (${(pmMaxWickRatio * sRange).toFixed(2)})` };
    }
    if (S.c <= S.o) {
      return { pass: false, reason: `Phase 2: Long signal candle is not bullish.` };
    }
    const takerDelta = (S.taker_buy_vol || 0) - (S.taker_sell_vol || 0);
    if (takerDelta <= 0) {
      return { pass: false, reason: `Phase 2: Bullish taker delta (${takerDelta.toFixed(0)}) is not positive.` };
    }
  } else {
    const wickLow = S.c - S.l;
    if (wickLow > pmMaxWickRatio * sRange) {
      return { pass: false, reason: `Phase 2: Short lower wick (${wickLow.toFixed(2)}) exceeds max wick limit (${(pmMaxWickRatio * sRange).toFixed(2)})` };
    }
    if (S.c >= S.o) {
      return { pass: false, reason: `Phase 2: Short signal candle is not bearish.` };
    }
    const takerDelta = (S.taker_buy_vol || 0) - (S.taker_sell_vol || 0);
    if (takerDelta >= 0) {
      return { pass: false, reason: `Phase 2: Bearish taker delta (${takerDelta.toFixed(0)}) is not negative.` };
    }
  }

  // --- Phase 3: Delayed Confirmation Gate ---
  if (direction === 'LONG') {
    if (C.c <= S.o) {
      return { pass: false, reason: `Phase 3: Confirmation close (${C.c}) is not above Signal open (${S.o})` };
    }
    const retracementFloor = S.c - pmMaxRetracementLimit * sBody;
    if (C.l < retracementFloor) {
      return { pass: false, reason: `Phase 3: Confirmation low (${C.l}) breached retracement floor (${retracementFloor.toFixed(2)})` };
    }
  } else {
    if (C.c >= S.o) {
      return { pass: false, reason: `Phase 3: Confirmation close (${C.c}) is not below Signal open (${S.o})` };
    }
    const retracementCeiling = S.c + pmMaxRetracementLimit * sBody;
    if (C.h > retracementCeiling) {
      return { pass: false, reason: `Phase 3: Confirmation high (${C.h}) breached retracement ceiling (${retracementCeiling.toFixed(2)})` };
    }
  }

  // Requirement 3C: No opposing volumetric signal on S or C.
  const sSignal = (S as any).volumetric_signal;
  const cSignal = (C as any).volumetric_signal;
  if (direction === 'LONG') {
    if (sSignal === 'ARROW_DOWN' || sSignal === 'CIRCLE_DOWN') {
      return { pass: false, reason: `Phase 3: Opposing volumetric signal on Signal candle (${sSignal})` };
    }
    if (cSignal === 'ARROW_DOWN' || cSignal === 'CIRCLE_DOWN') {
      return { pass: false, reason: `Phase 3: Opposing volumetric signal on Confirmation candle (${cSignal})` };
    }
  } else {
    if (sSignal === 'ARROW_UP' || sSignal === 'CIRCLE_UP') {
      return { pass: false, reason: `Phase 3: Opposing volumetric signal on Signal candle (${sSignal})` };
    }
    if (cSignal === 'ARROW_UP' || cSignal === 'CIRCLE_UP') {
      return { pass: false, reason: `Phase 3: Opposing volumetric signal on Confirmation candle (${cSignal})` };
    }
  }

  return { pass: true, reason: `SUCCESS: Swept ${matchedLevel}` };
}

async function run() {
  try {
    const rawCandles = await fetchBinanceCandles('ETHUSDT', '5m', 1000);
    const lastPrice = rawCandles[rawCandles.length - 1].c;
    const structureState = analyzeMarketStructure(rawCandles, lastPrice);

    const grades = structureState.swings.map((s: any) => s.grade || s.structure_type || 'undefined');
    const gradeCounts = grades.reduce((acc: any, g: string) => {
      acc[g] = (acc[g] || 0) + 1;
      return acc;
    }, {});
    console.log('Swing Grade Counts:', gradeCounts);

    // Annotate signals
    const annotatedCandles = rawCandles.map(c => ({ ...c }));
    annotateCandlesWithVolumetricSignals(annotatedCandles);

    const arrowUpSignals = annotatedCandles.filter((c, idx) => c.volumetric_signal === 'ARROW_UP' && idx >= 3 && idx < annotatedCandles.length - 1);
    const arrowDownSignals = annotatedCandles.filter((c, idx) => c.volumetric_signal === 'ARROW_DOWN' && idx >= 3 && idx < annotatedCandles.length - 1);
    const totalSignals = arrowUpSignals.length + arrowDownSignals.length;

    console.log(`\n=== Initial Signal Counts ===`);
    console.log(`Total ARROW_UP signals: ${arrowUpSignals.length}`);
    console.log(`Total ARROW_DOWN signals: ${arrowDownSignals.length}`);
    console.log(`Total Arrows: ${totalSignals}`);

    // Precompute mock market data for each index to speed up validation and fix undefined references
    const mockMarketDataMap: Record<number, MarketDataPayload> = {};
    for (let i = 288; i < annotatedCandles.length - 1; i++) {
      const rolling24h = annotatedCandles.slice(i - 288, i);
      const pdh = Math.max(...rolling24h.map(rc => rc.h));
      const pdl = Math.min(...rolling24h.map(rc => rc.l));
      const asianRange = rolling24h.slice(0, 72);
      const asianHigh = Math.max(...asianRange.map(rc => rc.h));
      const asianLow = Math.min(...asianRange.map(rc => rc.l));

      mockMarketDataMap[i] = {
        ticker: 'ETHUSDT',
        timezone: 'UTC',
        open_interest: 0,
        data_payload: {
          candles_5m: rawCandles
        },
        ipda_metrics: {
          macro_levels: {
            pdh,
            pdl,
            asian_high: asianHigh,
            asian_low: asianLow
          },
          full_structure_map: structureState
        } as any
      };
    }

    // --- Part 1: Default Settings Diagnostic Run ---
    const defaultSettings: PerfectMovementSettings = {
      pmAtrMultiplier: 0.5,
      pmVolumeSmaPeriod: 10,
      pmMinBodyRatio: 0.3,
      pmMaxWickRatio: 0.5,
      pmMaxRetracementLimit: 0.7,
      pmSweepLookback: 5
    };

    console.log(`\n=== Diagnostic Run (Optimized Defaults: ATR 0.5, Vol SMA 10, Body 0.3, Wick 0.5, Retrace 0.7, Lookback 5) ===`);

    // Production function pass (verify the actual imported function)
    let prodPassCount = 0;
    for (let i = 288; i < annotatedCandles.length - 1; i++) {
      const c = annotatedCandles[i];
      if (c.volumetric_signal === 'ARROW_UP' || c.volumetric_signal === 'ARROW_DOWN') {
        const pmSettings = {
          ...defaultSettings,
          direction: c.volumetric_signal === 'ARROW_UP' ? 'LONG' as const : 'SHORT' as const
        };
        const mockMarketData = mockMarketDataMap[i];
        if (!mockMarketData) continue;
        const result = checkPerfectMovementSetup(annotatedCandles, mockMarketData, pmSettings, i, structureState);
        if (result) {
          prodPassCount++;
          console.log(`[PROD PASS] Index ${i} (${c.volumetric_signal} at price ${c.c})`);
        }
      }
    }
    console.log(`\nProduction checkPerfectMovementSetup passed: ${prodPassCount} / ${totalSignals} arrows.\n`);
    
    let defaultPassCount = 0;
    const failures: Record<string, number> = {};
    const detailedFailures: string[] = [];

    for (let i = 288; i < annotatedCandles.length - 1; i++) {
      const c = annotatedCandles[i];
      if (c.volumetric_signal === 'ARROW_UP' || c.volumetric_signal === 'ARROW_DOWN') {
        const pmSettings = {
          ...defaultSettings,
          direction: c.volumetric_signal === 'ARROW_UP' ? 'LONG' as const : 'SHORT' as const
        };

        const mockMarketData = mockMarketDataMap[i];
        if (!mockMarketData) continue;
        
        // Log detailed diagnostic for the first 3 signals
        if (false) { // Disabled per previous context
          const S = annotatedCandles[i];
          const C = annotatedCandles[i + 1];
          const P1 = annotatedCandles[i - 1];
          const P2 = annotatedCandles[i - 2];
          console.log(`\n--- Signal Detail #${1} (${c.volumetric_signal} at index ${i}) ---`);
          console.log(`P2: Low=${P2.l}, High=${P2.h}, Close=${P2.c}`);
          console.log(`P1: Low=${P1.l}, High=${P1.h}, Close=${P1.c}`);
          console.log(`S:  Low=${S.l}, High=${S.h}, Close=${S.c}`);
        }

        const diag = diagnosePerfectMovementSetup(annotatedCandles, mockMarketData, pmSettings, i, structureState);
        if (diag.pass) {
          defaultPassCount++;
          console.log(`[PASS] Index ${i} (${c.volumetric_signal} at price ${c.c}): ${diag.reason}`);
        } else {
          const mainReason = diag.reason?.split(':')[0] || 'Unknown';
          failures[mainReason] = (failures[mainReason] || 0) + 1;
          detailedFailures.push(`Index ${i} (${c.volumetric_signal} at ${c.c}): ${diag.reason}`);
        }
      }
    }

    console.log(`\nDefault settings passed: ${defaultPassCount} / ${totalSignals} arrows.`);
    console.log('\n=== Detailed Failure Reasons (All Signals) ===');
    detailedFailures.forEach(f => console.log(f));
    console.log('\nFailure reasons breakdown summary:');
    console.dir(failures);

    // --- Part 2: Parameter Grid Sweep to find optimized setups ---
    console.log(`\n=== Parameter Grid Sweep for Optimization ===`);
    console.log(`Testing parameter configurations to optimize match count...`);

    const atrMultOpts = [0.5, 0.8, 1.0, 1.2, 1.5];
    const minBodyOpts = [0.3, 0.4, 0.5, 0.6];
    const maxWickOpts = [0.15, 0.25, 0.35, 0.5];
    const maxRetraceOpts = [0.3, 0.5, 0.7, 0.9];

    let bestConfig: any = null;
    let maxPassed = 0;
    const allConfigs: Array<{ config: any; passed: number }> = [];
    let configsTested = 0;

    for (const atr of atrMultOpts) {
      for (const body of minBodyOpts) {
        for (const wick of maxWickOpts) {
          for (const retrace of maxRetraceOpts) {
            let passCount = 0;
            configsTested++;
            
            for (let i = 288; i < annotatedCandles.length - 1; i++) {
              const c = annotatedCandles[i];
              if (c.volumetric_signal === 'ARROW_UP' || c.volumetric_signal === 'ARROW_DOWN') {
                const mockMarketData = mockMarketDataMap[i];
                if (!mockMarketData) continue;

                const pmSettings: PerfectMovementSettings = {
                  pmAtrMultiplier: atr,
                  pmVolumeSmaPeriod: 10,
                  pmMinBodyRatio: body,
                  pmMaxWickRatio: wick,
                  pmMaxRetracementLimit: retrace,
                  direction: c.volumetric_signal === 'ARROW_UP' ? 'LONG' : 'SHORT'
                };
                const passed = diagnosePerfectMovementSetup(annotatedCandles, mockMarketData, pmSettings, i, structureState).pass;
                if (passed) {
                  passCount++;
                }
              }
            }

            allConfigs.push({
              config: { pmAtrMultiplier: atr, pmVolumeSmaPeriod: 10, pmMinBodyRatio: body, pmMaxWickRatio: wick, pmMaxRetracementLimit: retrace },
              passed: passCount
            });
          }
        }
      }
    }

    allConfigs.sort((a, b) => b.passed - a.passed);
    bestConfig = allConfigs[0]?.config || null;
    maxPassed = allConfigs[0]?.passed ?? 0;

    console.log(`Tested ${configsTested} configurations.`);
    console.log(`\n=== Top 5 Configurations ===`);
    allConfigs.slice(0, 10).forEach((item, idx) => {
      console.log(`#${idx + 1}: Passed = ${item.passed}/${totalSignals} arrows | Config: ${JSON.stringify(item.config)}`);
    });

    // Let's run a diagnostic of the best settings to print their successes
    console.log(`\n=== Diagnostic Run of Best Settings ===`);
    if (bestConfig) {
      let bestPassCount = 0;
      for (let i = 288; i < annotatedCandles.length - 1; i++) {
        const c = annotatedCandles[i];
        if (c.volumetric_signal === 'ARROW_UP' || c.volumetric_signal === 'ARROW_DOWN') {
          const pmSettings = {
            ...bestConfig,
            direction: c.volumetric_signal === 'ARROW_UP' ? 'LONG' as const : 'SHORT' as const
          };
          const mockMarketData = mockMarketDataMap[i];
          if (!mockMarketData) continue;

          const diag = diagnosePerfectMovementSetup(annotatedCandles, mockMarketData, pmSettings, i, structureState);
          if (diag.pass) {
            bestPassCount++;
            console.log(`[PASS] Index ${i} (${c.volumetric_signal} at price ${c.c}): ${diag.reason}`);
          }
        }
      }
    }

  } catch (err) {
    console.error('Test run failed:', err);
  }
}

run();
