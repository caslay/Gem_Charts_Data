import { analyzeMarketStructure } from '../src/lib/structureEngine';

async function testFullAudit() {
  const symbol = 'ETHUSDC';
  const intervals = ['1m', '5m', '15m', '1h', '4h'];

  console.log('===============================================================');
  console.log('VERIFYING COMPLETE COMPREHENSIVE MARKET STRUCTURE AUDIT');
  console.log('===============================================================\n');

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

    // Proposed fix 1: Chronological sort
    const chronoSortedSwings = [...(analysis.swings || [])].sort((a, b) => a.t - b.t);

    // Proposed fix 2: Dedicated mapping slice to guarantee Major/Internal never starved
    const confirmedMajorSwings = chronoSortedSwings.filter(s => s.grade === 'MAJOR' || s.grade === 'INTERNAL');
    const recentInnerSwings = chronoSortedSwings.filter(s => s.grade === 'INNER').slice(-100);
    const swingsToMap = [...confirmedMajorSwings.slice(-60), ...recentInnerSwings].sort((a, b) => a.t - b.t);

    const confirmedMajor = swingsToMap
      .filter((s) => (s.grade === 'MAJOR' || s.grade === 'INTERNAL') && s.confirmed !== false)
      .sort((a, b) => a.t - b.t)
      .slice(-40);

    const majorLines = confirmedMajor.filter(s => s.grade === 'MAJOR');
    const internalLines = confirmedMajor.filter(s => s.grade === 'INTERNAL');

    const majorBreaks = (analysis.zigzag || []).filter(z => z.label === 'BOS' || z.label === 'MSS');
    const internalBreaks = (analysis.internalZigzag || []).filter(z => z.label === 'BOS' || z.label === 'MSS');
    const innerBreaks = (analysis.innerZigzag || []).filter(z => z.label === 'BOS' || z.label === 'MSS');

    console.log(`[TF: ${tf.padEnd(4)}] Total Swings: ${chronoSortedSwings.length}`);
    console.log(`         SwingsToMap: ${swingsToMap.length} (Major: ${swingsToMap.filter(s => s.grade === 'MAJOR').length}, Int: ${swingsToMap.filter(s => s.grade === 'INTERNAL').length}, Inner: ${swingsToMap.filter(s => s.grade === 'INNER').length})`);
    console.log(`         Horizontal Lines: Total=${confirmedMajor.length} (MAJOR HIGH/LOW=${majorLines.length}, INT HIGH/LOW=${internalLines.length})`);
    console.log(`         Zigzag Segments: Major=${analysis.zigzag?.length || 0} (Breaks=${majorBreaks.length}), Int=${analysis.internalZigzag?.length || 0} (Breaks=${internalBreaks.length}), Inner=${analysis.innerZigzag?.length || 0} (Breaks=${innerBreaks.length})`);
    console.log(`         Dealing Range: [${analysis.dealingRange.low} -> ${analysis.dealingRange.high}] Eq=${analysis.dealingRange.equilibrium}`);
    console.log(`         Internal Dealing Range: [${analysis.internalDealingRange?.low} -> ${analysis.internalDealingRange?.high}] Eq=${analysis.internalDealingRange?.equilibrium}`);
    console.log('');
  }
}

testFullAudit().catch(console.error);
