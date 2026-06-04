import { MarketStructureAPI } from '../src/lib/quantEngine/MarketStructureAPI';
import { StructuralSwing, StructuralDealingRange, Candle } from '../src/lib/quantEngine/types';
import { calculateVolumeProfile } from '../src/lib/quantEngine/VolumeProfileEngine';

// Subclass MarketStructureAPI to override buildDealingRange with the fix
class PatchedMarketStructureAPI extends MarketStructureAPI {
  // Override private/protected method or analyze wrapper
  public analyze(candles: any[], currentPrice: number, displacementStatus?: any): any {
    const res = super.analyze(candles, currentPrice, displacementStatus);
    
    // We will re-calculate the dealingRange and profile_metrics using our patch
    // first, recreate what super.analyze did but with our fallback anchor swing logic.
    const normalizedCandles = candles.map(c => ({
      ...c,
      open: c.open !== undefined ? c.open : c.o,
      high: c.high !== undefined ? c.high : c.h,
      low: c.low !== undefined ? c.low : c.l,
      close: c.close !== undefined ? c.close : c.c,
      volume: c.volume !== undefined ? c.volume : c.v
    }));

    const majorSwings = res.swings.filter(s => s.grade === 'MAJOR');
    
    // Retrieve prices from res.engine_state
    let highPrice = res.engine_state.active_swing_range.high;
    let lowPrice = res.engine_state.active_swing_range.low;
    
    // Re-resolve dealing range prices using the same engine logic
    const stateEngine = (this as any).stateEngine; // wait, stateEngine is not exposed on super, so we use the result fields:
    const trend = res.engine_state.current_trend_state;
    const protected_high = res.engine_state.protected_high;
    const protected_low = res.engine_state.protected_low;
    const active_high = res.engine_state.active_swing_range.high;
    const active_low = res.engine_state.active_swing_range.low;

    let targetHigh: number = -Infinity;
    let targetLow: number = Infinity;

    if (trend === 'BULLISH_SWING') {
      targetHigh = active_high ?? Math.max(currentPrice, ...majorSwings.filter(s => s.type === 'HIGH').map(s => Number(s.price)));
      targetLow = protected_low ?? Math.min(...majorSwings.filter(s => s.type === 'LOW').map(s => Number(s.price)));
      
      if (active_high === null) {
          const anchorSwing = [...majorSwings].reverse().find(s => s.type === 'LOW' && s.price === targetLow);
          const anchorIdx = anchorSwing?.candle_index ?? 0;
          const candlesSinceAnchor = normalizedCandles.slice(anchorIdx);
          targetHigh = candlesSinceAnchor.length > 0 ? Math.max(...candlesSinceAnchor.map(c => c.high)) : currentPrice;
      }
    } else {
      targetHigh = protected_high ?? Math.max(...majorSwings.filter(s => s.type === 'HIGH').map(s => Number(s.price)));
      targetLow = active_low ?? currentPrice;

      if (active_low === null) {
          const anchorSwing = [...majorSwings].reverse().find(s => s.type === 'HIGH' && s.price === targetHigh);
          const anchorIdx = anchorSwing?.candle_index ?? 0;
          const candlesSinceAnchor = normalizedCandles.slice(anchorIdx);
          targetLow = candlesSinceAnchor.length > 0 ? Math.min(...candlesSinceAnchor.map(c => c.low)) : currentPrice;
      }
    }

    if (targetHigh === -Infinity || targetHigh === null) targetHigh = currentPrice;
    if (targetLow === Infinity || targetLow === null) targetLow = currentPrice;

    // --- PATCH STARTS HERE ---
    // Find the latest swings that match these anchor prices
    let anchor_high_swing = [...majorSwings].reverse().find(s => s.type === 'HIGH' && s.price === targetHigh) || null;
    if (anchor_high_swing === null && normalizedCandles.length > 0) {
      let minDiff = Infinity;
      let closestIdx = -1;
      for (let i = 0; i < normalizedCandles.length; i++) {
        const diff = Math.abs(normalizedCandles[i].high - targetHigh);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }
      if (closestIdx !== -1) {
        const c = normalizedCandles[closestIdx];
        anchor_high_swing = {
          t: c.t,
          price: c.high,
          type: 'HIGH',
          grade: 'MAJOR',
          colorValidated: true,
          candle_index: closestIdx,
          timestamp: new Date(c.t).toISOString(),
          structure_type: 'MAJOR',
          confirmed: true
        };
      }
    }

    let anchor_low_swing = [...majorSwings].reverse().find(s => s.type === 'LOW' && s.price === targetLow) || null;
    if (anchor_low_swing === null && normalizedCandles.length > 0) {
      let minDiff = Infinity;
      let closestIdx = -1;
      for (let i = 0; i < normalizedCandles.length; i++) {
        const diff = Math.abs(normalizedCandles[i].low - targetLow);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }
      if (closestIdx !== -1) {
        const c = normalizedCandles[closestIdx];
        anchor_low_swing = {
          t: c.t,
          price: c.low,
          type: 'LOW',
          grade: 'MAJOR',
          colorValidated: true,
          candle_index: closestIdx,
          timestamp: new Date(c.t).toISOString(),
          structure_type: 'MAJOR',
          confirmed: true
        };
      }
    }
    // --- PATCH ENDS HERE ---

    const highVal = parseFloat(targetHigh.toFixed(2));
    const lowVal = parseFloat(targetLow.toFixed(2));
    const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));

    const dr: StructuralDealingRange = {
      high: highVal,
      low: lowVal,
      equilibrium: eqVal,
      current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
      anchor_high_swing,
      anchor_low_swing
    };

    dr.profile_metrics = calculateVolumeProfile(dr, normalizedCandles);
    res.dealingRange = dr;
    return res;
  }
}

async function testTimeframe(interval: string) {
  try {
    const symbol = 'ETHUSDC';
    const limit = 1000;
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    console.log(`\nFetching ${interval} candles directly from Binance...`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed to fetch: HTTP ${res.status}`);
      return;
    }
    const rawData = (await res.json()) as any[];
    const candles = rawData.map((c: any) => {
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

    const currentPrice = candles[candles.length - 1].c;
    const api = new PatchedMarketStructureAPI();
    const result = api.analyze(candles, currentPrice);

    console.log(`=== Result for ${interval} (PATCHED) ===`);
    console.log(`Dealing Range:`, JSON.stringify({
      high: result.dealingRange.high,
      low: result.dealingRange.low,
      anchor_high_swing: result.dealingRange.anchor_high_swing ? { price: result.dealingRange.anchor_high_swing.price, t: result.dealingRange.anchor_high_swing.t, index: result.dealingRange.anchor_high_swing.candle_index } : null,
      anchor_low_swing: result.dealingRange.anchor_low_swing ? { price: result.dealingRange.anchor_low_swing.price, t: result.dealingRange.anchor_low_swing.t, index: result.dealingRange.anchor_low_swing.candle_index } : null,
      profile_metrics: result.dealingRange.profile_metrics
    }, null, 2));

  } catch (err: any) {
    console.error(`Error testing ${interval}:`, err.message);
  }
}

async function run() {
  await testTimeframe('5m');
  await testTimeframe('15m');
  await testTimeframe('1h');
}

run();
