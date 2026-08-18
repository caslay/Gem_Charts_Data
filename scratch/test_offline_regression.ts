import { Candle } from '../src/lib/fvgEngine';
import { verifyDisplacementOffline } from '../src/lib/displacementEngine';

function generateSyntheticCandles(): Candle[] {
  const candles: Candle[] = [];
  let price = 2000;
  const now = Date.now();
  for (let i = 0; i < 60; i++) {
    const isBull = i % 2 === 0;
    const change = (Math.random() * 5 + 1) * (isBull ? 1 : -1);
    const o = price;
    const c = price + change;
    const h = Math.max(o, c) + Math.random() * 2;
    const l = Math.min(o, c) - Math.random() * 2;
    price = c;
    const vol = 100 + Math.random() * 50;
    const takerBuy = isBull ? vol * 0.7 : vol * 0.3;
    const takerSell = vol - takerBuy;
    candles.push({
      t: now - (60 - i) * 300000,
      o, h, l, c, v: vol,
      taker_buy_vol: takerBuy,
      taker_sell_vol: takerSell,
    });
  }
  return candles;
}

const testCandles = generateSyntheticCandles();
const res = verifyDisplacementOffline(testCandles, 'ETHUSDC');
console.log('Result:', JSON.stringify(res, null, 2));
