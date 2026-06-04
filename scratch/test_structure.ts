import { MarketStructureAPI } from '../src/lib/quantEngine/MarketStructureAPI';

async function testTimeframe(interval: string) {
  try {
    const symbol = 'ETHUSDC';
    const limit = 1000;
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    console.log(`\nFetching ${interval} candles directly from Binance...`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed to fetch from Binance: HTTP ${res.status}`);
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
    const api = new MarketStructureAPI();
    const result = api.analyze(candles, currentPrice);

    console.log(`=== Result for ${interval} ===`);
    console.log(`Trend: ${result.currentTrend}`);
    console.log(`Engine State:`, JSON.stringify(result.engine_state, null, 2));
    console.log(`Dealing Range:`, JSON.stringify({
      high: result.dealingRange.high,
      low: result.dealingRange.low,
      anchor_high_swing: result.dealingRange.anchor_high_swing ? { price: result.dealingRange.anchor_high_swing.price, t: result.dealingRange.anchor_high_swing.t } : null,
      anchor_low_swing: result.dealingRange.anchor_low_swing ? { price: result.dealingRange.anchor_low_swing.price, t: result.dealingRange.anchor_low_swing.t } : null
    }, null, 2));

    // Let's check why the anchor was null:
    const targetLow = result.engine_state.protected_low ?? result.engine_state.active_swing_range.low;
    const targetHigh = result.engine_state.protected_high ?? result.engine_state.active_swing_range.high;
    const majorSwings = result.swings.filter(s => s.grade === 'MAJOR');

    console.log(`Looking for Low Price: ${targetLow}`);
    const matchingLows = majorSwings.filter(s => s.type === 'LOW' && s.price === targetLow);
    console.log(`Matching Low Swings (exact match): ${matchingLows.length}`);
    
    if (matchingLows.length === 0 && targetLow !== null) {
      console.log("No exact match. Let's look for close prices (within 0.05 tolerance):");
      const closeLows = majorSwings.filter(s => s.type === 'LOW' && Math.abs(s.price - targetLow) < 0.05);
      closeLows.forEach(s => console.log(`  - Price: ${s.price}, t: ${s.t}, index: ${s.candle_index}`));
      
      console.log("All Major Low Swings in the last 100 candles:");
      majorSwings.filter(s => s.type === 'LOW').slice(-5).forEach(s => {
        console.log(`  - Price: ${s.price}, t: ${s.t}, index: ${s.candle_index}`);
      });
    }

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
