import { Candle } from '../src/lib/fvgEngine';

async function debugRegression() {
  const symbol = 'ETHUSDC';
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=200`;
  const res = await fetch(url);
  const raw = await res.json();

  const recentCandles: Candle[] = raw.map((k: any) => {
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

  const N = recentCandles.length;
  const volumes = recentCandles.map(c => c.v !== undefined ? c.v : ((c.taker_buy_vol || 0) + (c.taker_sell_vol || 0)));
  const volumeDeltas = recentCandles.map(c => (c.taker_buy_vol || 0) - (c.taker_sell_vol || 0));
  
  const rollingVols = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    const count = Math.min(i + 1, 14);
    for (let k = 0; k < count; k++) {
      sum += volumes[i - k];
    }
    rollingVols[i] = sum / count;
  }

  const anomalyMultipliers = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    anomalyMultipliers[i] = volumes[i] / (rollingVols[i] + 1e-5);
  }

  const deadZones = new Array<number>(N).fill(0);

  const futureReturns = new Array<number>(N);
  for (let i = 0; i < N - 3; i++) {
    const prevC = recentCandles[i].c;
    futureReturns[i] = prevC !== 0 ? (recentCandles[i + 3].c - prevC) / prevC : 0;
  }

  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 14; i < N - 3; i++) {
    X.push([1, anomalyMultipliers[i], volumeDeltas[i], deadZones[i]]);
    y.push(futureReturns[i]);
  }

  console.log(`M = ${y.length} samples`);
  console.log('Sample X[0]:', X[0], 'y[0]:', y[0]);
}

debugRegression().catch(console.error);
