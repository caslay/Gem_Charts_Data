import { Candle } from '../src/lib/fvgEngine';
import { verifyDisplacementOffline } from '../src/lib/displacementEngine';

function generateModerateCandles(): Candle[] {
  const candles: Candle[] = [];
  let price = 2000;
  const now = Date.now();
  for (let i = 0; i < 80; i++) {
    const isAnomaly = i % 6 === 0;
    const vol = isAnomaly ? 300 : 100;
    const takerBuy = isAnomaly ? 200 : 50;
    const takerSell = vol - takerBuy;
    const change = isAnomaly ? 6 : (Math.random() * 2 - 1);
    const o = price;
    const c = price + change;
    const h = Math.max(o, c) + 1.5;
    const l = Math.min(o, c) - 1.5;
    price = c;
    candles.push({
      t: now - (80 - i) * 300000,
      o, h, l, c, v: vol,
      taker_buy_vol: takerBuy,
      taker_sell_vol: takerSell,
    });
  }
  return candles;
}

const testCandles = generateModerateCandles();
const res = verifyDisplacementOffline(testCandles, 'ETHUSDC');
console.log('Moderate Displacement Result:', JSON.stringify(res, null, 2));
