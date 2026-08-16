import { OrderBlockEngine } from '../src/lib/quantEngine/OrderBlockEngine';
import { analyzeMarketStructure } from '../src/lib/structureEngine';

async function testTimeframeSwitch() {
  console.log('Testing timeframe execution performance...');
  
  // Create synthetic 1000 candles representing 15m timeframe
  const candles15m: any[] = [];
  let price = 2500;
  const now = Date.now();
  for (let i = 1000; i >= 0; i--) {
    const t = now - i * 15 * 60 * 1000;
    const delta = (Math.random() - 0.49) * 10;
    const o = price;
    const c = price + delta;
    const h = Math.max(o, c) + Math.random() * 5;
    const l = Math.min(o, c) - Math.random() * 5;
    const v = 100 + Math.random() * 500;
    price = c;
    candles15m.push({ t, o, h, l, c, v, isClosed: true });
  }

  console.log(`Generated ${candles15m.length} 15m candles. Running analyzeMarketStructure...`);
  const t0 = Date.now();
  const struct = analyzeMarketStructure(candles15m);
  console.log(`analyzeMarketStructure took ${Date.now() - t0}ms, found ${struct.swings.length} swings`);

  console.log('Running OrderBlockEngine.scanHistoricalOrderBlocks...');
  const t1 = Date.now();
  const engine = new OrderBlockEngine({
    symbol: 'ETHUSDC',
    timeframe: '15m',
    minQualityTier: 'ALL',
    strictTierAPlus: false,
    enableBreakerSimulation: true,
    maxBarsToMitigation: 24,
    maxBreakerRetestBars: 20,
    aggregateConsecutiveCandles: true,
  });
  const obRes = engine.scanHistoricalOrderBlocks(candles15m);
  console.log(`scanHistoricalOrderBlocks took ${Date.now() - t1}ms, found ${obRes.orderBlocks.length} order blocks`);
}

testTimeframeSwitch().catch(console.error);
