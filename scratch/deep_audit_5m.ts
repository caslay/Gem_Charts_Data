import { analyzeMarketStructure, analyzeMarketStructureStateful } from '../src/lib/structureEngine';
import { calculateATR } from '../src/lib/riskEngine';

async function audit5m() {
  const symbol = 'ETHUSDC';
  const intervals = ['1m', '5m', '15m', '1h', '4h'];

  console.log('====================================================');
  console.log('DEEP STRUCTURE AUDIT ACROSS ALL TIMEFRAMES');
  console.log('====================================================\n');

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

    const majorSwings = analysis.swings.filter(s => s.grade === 'MAJOR');
    const internalSwings = analysis.swings.filter(s => s.grade === 'INTERNAL');
    const innerSwings = analysis.swings.filter(s => s.grade === 'INNER');

    const confirmedMajor = analysis.swings
      .filter((s) => (s.grade === 'MAJOR' || s.grade === 'INTERNAL') && s.confirmed !== false)
      .sort((a, b) => a.t - b.t)
      .slice(-40);

    const majorHzLevels = confirmedMajor.filter(s => s.structure_type !== 'INTERNAL');
    const intHzLevels = confirmedMajor.filter(s => s.structure_type === 'INTERNAL');

    const atr = calculateATR(candles);
    const internalRange = analysis.internalDealingRange;
    const rangeHeight = (internalRange && internalRange.high !== null && internalRange.low !== null) ? (internalRange.high - internalRange.low) : 0;
    const isVolatilitySuppressed = rangeHeight > 0 && atr > 0 && rangeHeight < atr * 1.5;

    const majorBreaks = (analysis.zigzag || []).filter(z => z.label === 'BOS' || z.label === 'MSS');
    const internalBreaks = (analysis.internalZigzag || []).filter(z => z.label === 'BOS' || z.label === 'MSS');
    const innerBreaks = (analysis.innerZigzag || []).filter(z => z.label === 'BOS' || z.label === 'MSS');

    console.log(`--- Timeframe: ${tf} ---`);
    console.log(`Candles count: ${candles.length}`);
    console.log(`ATR(14): ${atr.toFixed(2)}`);
    console.log(`Dealing Range: High=${analysis.dealingRange.high}, Low=${analysis.dealingRange.low}, Eq=${analysis.dealingRange.equilibrium}`);
    console.log(`Internal DR: High=${internalRange?.high}, Low=${internalRange?.low}, Eq=${internalRange?.equilibrium}, Height=${rangeHeight.toFixed(2)}`);
    console.log(`Volatility Suppressed (rangeHeight < 1.5 * ATR): ${isVolatilitySuppressed} (range=${rangeHeight.toFixed(2)} vs 1.5*ATR=${(1.5 * atr).toFixed(2)})`);
    console.log(`Total Swings: ${analysis.swings.length}`);
    console.log(`  - Major (L2): ${majorSwings.length} (Confirmed: ${majorSwings.filter(s => s.confirmed).length})`);
    console.log(`  - Internal (L1): ${internalSwings.length} (Confirmed: ${internalSwings.filter(s => s.confirmed).length})`);
    console.log(`  - Inner (L0): ${innerSwings.length} (Confirmed: ${innerSwings.filter(s => s.confirmed).length})`);
    console.log(`Horizontal Levels in slice(-40):`);
    console.log(`  - Major Horizontal Lines: ${majorHzLevels.length}`);
    console.log(`  - Internal Horizontal Lines: ${intHzLevels.length}`);
    console.log(`ZigZag Segments:`);
    console.log(`  - Major ZigZag: ${analysis.zigzag?.length || 0} segments (Breaks: ${majorBreaks.length})`);
    console.log(`  - Internal ZigZag: ${analysis.internalZigzag?.length || 0} segments (Breaks: ${internalBreaks.length})`);
    console.log(`  - Inner ZigZag: ${analysis.innerZigzag?.length || 0} segments (Breaks: ${innerBreaks.length})`);
    console.log(`Current Trend: ${analysis.currentTrend}, Internal Trend: ${analysis.internalTrend}`);
    console.log('\n');
  }
}

audit5m().catch(console.error);
