import { analyzeMarketStructure } from '../src/lib/structureEngine';
import { OrderBlockEngine } from '../src/lib/quantEngine/OrderBlockEngine';

async function benchmarkTimeframes() {
  const symbol = 'ETHUSDC';
  const timeframes = [
    { tf: '5m', oldLimit: 1000, newLimit: 350 },
    { tf: '15m', oldLimit: 1000, newLimit: 250 },
    { tf: '1h', oldLimit: 1000, newLimit: 120 },
    { tf: '4h', oldLimit: 1000, newLimit: 80 },
    { tf: '1m', oldLimit: 1000, newLimit: 350 }
  ];

  console.log('========================================================================================');
  console.log('  CANDLE LOAD & PERFORMANCE BENCHMARK: OLD (1000 BARS) vs NEW CALIBRATED LIMITS');
  console.log('========================================================================================\n');

  let oldTotalBytes = 0;
  let newTotalBytes = 0;
  let oldTotalEngineMs = 0;
  let newTotalEngineMs = 0;

  for (const item of timeframes) {
    // 1. Old (1000 candles)
    const oldUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${item.tf}&limit=${item.oldLimit}`;
    const resOld = await fetch(oldUrl);
    const rawOld = await resOld.json();
    const bytesOld = JSON.stringify(rawOld).length;
    oldTotalBytes += bytesOld;

    const candlesOld = rawOld.map((c: any) => ({
      t: c[0], o: parseFloat(c[1]), h: parseFloat(c[2]), l: parseFloat(c[3]), c: parseFloat(c[4]), v: parseFloat(c[5]),
      taker_buy_vol: parseFloat(c[9]), taker_sell_vol: parseFloat(c[5]) - parseFloat(c[9]), isClosed: true
    }));

    const t0Old = performance.now();
    analyzeMarketStructure(candlesOld, candlesOld[candlesOld.length - 1].c, null, candlesOld[0].t);
    const engineOld = new OrderBlockEngine({ timeframe: item.tf as any });
    engineOld.scanHistoricalOrderBlocks(candlesOld);
    const msOld = performance.now() - t0Old;
    oldTotalEngineMs += msOld;

    // 2. New Calibrated
    const newUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${item.tf}&limit=${item.newLimit}`;
    const resNew = await fetch(newUrl);
    const rawNew = await resNew.json();
    const bytesNew = JSON.stringify(rawNew).length;
    newTotalBytes += bytesNew;

    const candlesNew = rawNew.map((c: any) => ({
      t: c[0], o: parseFloat(c[1]), h: parseFloat(c[2]), l: parseFloat(c[3]), c: parseFloat(c[4]), v: parseFloat(c[5]),
      taker_buy_vol: parseFloat(c[9]), taker_sell_vol: parseFloat(c[5]) - parseFloat(c[9]), isClosed: true
    }));

    const t0New = performance.now();
    analyzeMarketStructure(candlesNew, candlesNew[candlesNew.length - 1].c, null, candlesNew[0].t);
    const engineNew = new OrderBlockEngine({ timeframe: item.tf as any });
    engineNew.scanHistoricalOrderBlocks(candlesNew.length > 250 ? candlesNew.slice(-250) : candlesNew);
    const msNew = performance.now() - t0New;
    newTotalEngineMs += msNew;

    console.log(`[TF: ${item.tf.padEnd(4)}] Old: ${item.oldLimit} bars (${(bytesOld / 1024).toFixed(1)} KB, ${msOld.toFixed(1)}ms) -> New: ${item.newLimit} bars (${(bytesNew / 1024).toFixed(1)} KB, ${msNew.toFixed(1)}ms) | Saved: ${(((bytesOld - bytesNew) / bytesOld) * 100).toFixed(0)}% payload, ${(((msOld - msNew) / msOld) * 100).toFixed(0)}% CPU time`);
  }

  console.log('\n----------------------------------------------------------------------------------------');
  console.log(`TOTAL PAYLOAD REDUCTION: ${(oldTotalBytes / 1024).toFixed(1)} KB -> ${(newTotalBytes / 1024).toFixed(1)} KB (-${(((oldTotalBytes - newTotalBytes) / oldTotalBytes) * 100).toFixed(1)}%)`);
  console.log(`TOTAL ENGINE CPU SPEEDUP: ${oldTotalEngineMs.toFixed(1)}ms -> ${newTotalEngineMs.toFixed(1)}ms (-${(((oldTotalEngineMs - newTotalEngineMs) / oldTotalEngineMs) * 100).toFixed(1)}%)`);
  console.log('========================================================================================\n');
}

benchmarkTimeframes().catch(console.error);
