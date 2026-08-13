import { verifyDisplacement } from '../src/lib/displacementEngine';

async function run() {
  const symbol = 'ETHUSDT';
  
  // create 200 candles
  const candles = [];
  const now = Date.now();
  let basePrice = 3000;
  for (let i = 0; i < 200; i++) {
    const isUp = Math.random() > 0.5;
    const o = basePrice;
    const c = o + (isUp ? 5 : -5);
    const h = Math.max(o, c) + 2;
    const l = Math.min(o, c) - 2;
    
    // avg volume 1000
    const v = 800 + Math.random() * 400;
    
    // bug might be here in real data?
    // let's simulate taker_buy_vol properly
    const taker_buy_vol = isUp ? v * 0.7 : v * 0.3;
    const taker_sell_vol = v - taker_buy_vol;
    
    candles.push({
      t: now - (200 - i) * 60000,
      o, h, l, c, v,
      taker_buy_vol,
      taker_sell_vol,
      isClosed: true
    });
    basePrice = c;
  }
  
  // Let's force the last closed candle (index 198) to be BEARISH, 
  // but with low taker_sell_vol?
  candles[198].c = candles[198].o - 10;
  candles[198].v = 5000;
  candles[198].taker_buy_vol = 1000;
  candles[198].taker_sell_vol = 4000;
  
  const result = verifyDisplacement(candles, symbol);
  console.log(result);
}

run();
