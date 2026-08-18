import { analyzeMarketStructure } from '../src/lib/structureEngine';

async function testFixed() {
  const symbol = 'ETHUSDC';
  const intervals = ['1m', '5m', '15m', '1h', '4h'];

  console.log('=== TESTING CHRONOLOGICALLY SORTED SWINGS ===\n');

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

    // Sort chronologically as it SHOULD be
    const chronoSortedSwings = [...(analysis.swings || [])].sort((a, b) => a.t - b.t);

    // Recent 150 chronologically sorted swings
    const recentSwings = chronoSortedSwings.slice(-150);

    const majorInRecent = recentSwings.filter(s => s.grade === 'MAJOR');
    const internalInRecent = recentSwings.filter(s => s.grade === 'INTERNAL');
    const innerInRecent = recentSwings.filter(s => s.grade === 'INNER');

    const confirmedMajor = recentSwings
      .filter((s) => (s.grade === 'MAJOR' || s.grade === 'INTERNAL') && s.confirmed !== false)
      .sort((a, b) => a.t - b.t)
      .slice(-40);

    const majorHz = confirmedMajor.filter(s => s.grade === 'MAJOR');
    const internalHz = confirmedMajor.filter(s => s.grade === 'INTERNAL');

    console.log(`[TF: ${tf}] Total Swings: ${chronoSortedSwings.length}`);
    console.log(`  In recent 150 swings: Major=${majorInRecent.length}, Internal=${internalInRecent.length}, Inner=${innerInRecent.length}`);
    console.log(`  Confirmed Major + Internal in slice(-40): Total=${confirmedMajor.length} (Major Lines=${majorHz.length}, Internal Lines=${internalHz.length})`);
    console.log(`  Major Zigzag Breaks: ${(analysis.zigzag || []).filter(z => z.label === 'BOS' || z.label === 'MSS').length}`);
    console.log(`  Internal Zigzag Breaks: ${(analysis.internalZigzag || []).filter(z => z.label === 'BOS' || z.label === 'MSS').length}`);
    console.log('\n');
  }
}

testFixed().catch(console.error);
