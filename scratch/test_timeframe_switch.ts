import { analyzeMarketStructure } from '../src/lib/structureEngine';
import { OrderBlockEngine } from '../src/lib/quantEngine/OrderBlockEngine';

async function benchmarkTimeframes() {
  const symbol = 'ETHUSDC';
  const intervals = ['1m', '5m', '15m', '1h', '4h'];

  console.log('--- Benchmarking Timeframe Transitions ---');

  for (const tf of intervals) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=1000`;
    const t0 = performance.now();
    const res = await fetch(url);
    const data = await res.json();
    const tFetch = performance.now() - t0;

    const candles = data.map((c: any) => ({
      t: c[0],
      o: parseFloat(c[1]),
      h: parseFloat(c[2]),
      l: parseFloat(c[3]),
      c: parseFloat(c[4]),
      v: parseFloat(c[5]),
      taker_buy_vol: parseFloat(c[9]),
      taker_sell_vol: parseFloat(c[5]) - parseFloat(c[9]),
      isClosed: true
    }));

    const tStructStart = performance.now();
    const structure = analyzeMarketStructure(candles, candles[candles.length - 1].c, null, candles[0].t);
    const tStruct = performance.now() - tStructStart;

    const tOBStart = performance.now();
    const engine = new OrderBlockEngine({ timeframe: tf as any });
    const { orderBlocks: obs } = engine.scanHistoricalOrderBlocks(candles);
    const tOB = performance.now() - tOBStart;

    console.log(`[TF: ${tf.padEnd(4)}] Candles: ${candles.length} | Fetch: ${tFetch.toFixed(1)}ms | Structure: ${tStruct.toFixed(1)}ms (Swings: ${structure.swings?.length || 0}) | OB Scan: ${tOB.toFixed(1)}ms (OBs: ${obs.length}) | Total Engine Time: ${(tStruct + tOB).toFixed(1)}ms`);
  }
}

benchmarkTimeframes().catch(console.error);
