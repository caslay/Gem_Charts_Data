import { analyzeMarketStructure } from '../src/lib/structureEngine';

async function testSliceBug() {
  const symbol = 'ETHUSDC';
  const intervals = ['1m', '5m', '15m', '1h', '4h'];

  for (const tf of intervals) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=1000`;
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

    const fullSwings = analysis.swings || [];
    const slicedSwings = fullSwings.slice(-150);

    const fullMajor = fullSwings.filter(s => s.grade === 'MAJOR').length;
    const fullInternal = fullSwings.filter(s => s.grade === 'INTERNAL').length;
    const fullInner = fullSwings.filter(s => s.grade === 'INNER').length;

    const slicedMajor = slicedSwings.filter(s => s.grade === 'MAJOR').length;
    const slicedInternal = slicedSwings.filter(s => s.grade === 'INTERNAL').length;
    const slicedInner = slicedSwings.filter(s => s.grade === 'INNER').length;

    console.log(`[TF: ${tf}] Total Swings: ${fullSwings.length} (Major: ${fullMajor}, Int: ${fullInternal}, Inner: ${fullInner})`);
    console.log(`         After slice(-150): (Major: ${slicedMajor}, Int: ${slicedInternal}, Inner: ${slicedInner})`);

    // Let's check what confirmedMajor gets in structureLayer.ts:
    const confirmedMajorFromSliced = slicedSwings
      .filter((s) => (s.grade === 'MAJOR' || s.grade === 'INTERNAL') && s.confirmed !== false)
      .sort((a, b) => a.t - b.t)
      .slice(-40);
    console.log(`         confirmedMajor length: ${confirmedMajorFromSliced.length} (Major: ${confirmedMajorFromSliced.filter(s => s.grade === 'MAJOR').length}, Int: ${confirmedMajorFromSliced.filter(s => s.grade === 'INTERNAL').length})`);
  }
}

testSliceBug().catch(console.error);
