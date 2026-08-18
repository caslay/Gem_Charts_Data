import { verifyDisplacementOffline } from '../src/lib/displacementEngine';

async function testOlsRecalibration() {
  const symbol = 'ETHUSDC';
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=200`;
  const res = await fetch(url);
  const raw = await res.json();

  const candles = raw.map((k: any) => {
    const vol = parseFloat(k[5]);
    const takerBuy = parseFloat(k[9]);
    const takerSell = Math.max(0, vol - takerBuy);
    return {
      t: k[0],
      o: parseFloat(k[1]),
      h: parseFloat(k[2]),
      l: parseFloat(k[3]),
      c: parseFloat(k[4]),
      v: vol,
      taker_buy_vol: takerBuy,
      taker_sell_vol: takerSell,
    };
  });

  console.log(`Testing with ${candles.length} 5m ETHUSDC candles...`);
  const result = verifyDisplacementOffline(candles, 'ETHUSDC');
  console.log('Displacement Result:', JSON.stringify(result, null, 2));
}

testOlsRecalibration().catch(console.error);
