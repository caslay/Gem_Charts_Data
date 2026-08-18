import { analyzeMarketStructure } from '../src/lib/structureEngine';
import { MarketStructureAPI } from '../src/lib/quantEngine/MarketStructureAPI';

async function testInternalZigzagFull() {
  const symbol = 'ETHUSDC';
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=5m&limit=1000`;
  const res = await fetch(url);
  const data = await res.json();

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

  const analysis = analyzeMarketStructure(candles, candles[candles.length - 1].c, null, candles[0].t);

  console.log('Current analysis:');
  console.log('  zigzag (MAJOR):', analysis.zigzag?.length, 'segments, breaks:', analysis.zigzag?.filter(z => z.label === 'BOS' || z.label === 'MSS').length);
  console.log('  internalZigzag (restricted):', analysis.internalZigzag?.length, 'segments, breaks:', analysis.internalZigzag?.filter(z => z.label === 'BOS' || z.label === 'MSS').length);
  console.log('  innerZigzag (INNER):', analysis.innerZigzag?.length, 'segments, breaks:', analysis.innerZigzag?.filter(z => z.label === 'BOS' || z.label === 'MSS').length);
}

testInternalZigzagFull().catch(console.error);
