import { Candle } from '../src/lib/fvgEngine';
import { MTFTelemetryEngine } from '../src/lib/quantEngine/MTFTelemetryEngine';

function generateCandles(count: number, intervalMinutes: number, trendDirection: 'UP' | 'DOWN'): Candle[] {
  const candles: Candle[] = [];
  let price = 2000;
  const now = Date.now();
  const intervalMs = intervalMinutes * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const isUp = trendDirection === 'UP' ? i % 3 !== 0 : i % 3 === 0;
    const change = (Math.random() * 4 + 1) * (isUp ? 1 : -1);
    const o = price;
    const c = price + change;
    const h = Math.max(o, c) + Math.random() * 2;
    const l = Math.min(o, c) - Math.random() * 2;
    price = c;
    const vol = 100 + Math.random() * 50;
    const takerBuy = isUp ? vol * 0.7 : vol * 0.3;
    const takerSell = vol - takerBuy;

    candles.push({
      t: now - (count - i) * intervalMs,
      o, h, l, c, v: vol,
      taker_buy_vol: takerBuy,
      taker_sell_vol: takerSell,
      isClosed: true,
    });
  }
  return candles;
}

console.log('Testing MTFTelemetryEngine Background Evaluation Pipeline...');

const candles1m = generateCandles(100, 1, 'UP');
const candles5m = generateCandles(100, 5, 'UP');
const candles15m = generateCandles(100, 15, 'UP');
const candles1h = generateCandles(100, 60, 'UP');

const engine = new MTFTelemetryEngine('ETHUSDC');
const summary = engine.evaluateAll({
  candles_1m: candles1m,
  candles_5m: candles5m,
  candles_15m: candles15m,
  candles_1h: candles1h,
}, candles5m[candles5m.length - 1].c);

console.log('MTF Summary Result:', JSON.stringify({
  htf_directional_bias: summary.htf_directional_bias,
  htf_alignment: summary.htf_alignment,
  top_down_confluence_pct: summary.top_down_confluence_pct,
  active_macro_dol: summary.active_macro_dol,
  timeframes_evaluated: Object.keys(summary.timeframes),
  sample_5m_telemetry: summary.timeframes['5m'],
  sample_15m_telemetry: summary.timeframes['15m'],
  sample_1h_telemetry: summary.timeframes['1h'],
}, null, 2));

console.log('✅ MTFTelemetryEngine verified successfully!');
