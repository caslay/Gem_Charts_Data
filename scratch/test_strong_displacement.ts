import { Candle } from '../src/lib/fvgEngine';
import { verifyDisplacementOffline } from '../src/lib/displacementEngine';

function generateDisplacedCandles(): Candle[] {
  const candles: Candle[] = [];
  let price = 2000;
  const now = Date.now();
  for (let i = 0; i < 80; i++) {
    // Generate trending market where high volume consistently triggers +3 bar upward surges
    const isAnomaly = i % 5 === 0;
    const vol = isAnomaly ? 800 : 100;
    const takerBuy = isAnomaly ? 700 : 50;
    const takerSell = vol - takerBuy;
    const change = isAnomaly ? 15 : (Math.random() * 2 - 1);
    const o = price;
    const c = price + change;
    const h = Math.max(o, c) + 2;
    const l = Math.min(o, c) - 2;
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

const testCandles = generateDisplacedCandles();
const res = verifyDisplacementOffline(testCandles, 'ETHUSDC');
console.log('Strong Displacement Result:', JSON.stringify(res, null, 2));
