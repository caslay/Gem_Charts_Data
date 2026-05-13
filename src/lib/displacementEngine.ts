import { Candle } from './fvgEngine';

export function verifyDisplacement(recentCandles: Candle[]) {
  if (recentCandles.length < 16) {
    return {
      status: 'INACTIVE',
      anomaly_multiplier: 0,
      volume_delta: 0
    };
  }

  // Binance's last candle is open, so the last closed candle is length - 2
  const latestClosed = recentCandles[recentCandles.length - 2];
  
  // 14 candles prior to the latest closed candle
  const prior14 = recentCandles.slice(recentCandles.length - 16, recentCandles.length - 2);

  let sumBuyVol = 0;
  let sumSellVol = 0;

  for (const c of prior14) {
    sumBuyVol += c.taker_buy_vol || 0;
    sumSellVol += c.taker_sell_vol || 0;
  }

  const avgBuyVol = sumBuyVol / 14;
  const avgSellVol = sumSellVol / 14;

  const latestBuyVol = latestClosed.taker_buy_vol || 0;
  const latestSellVol = latestClosed.taker_sell_vol || 0;
  const isBullish = latestClosed.c > latestClosed.o;
  const isBearish = latestClosed.c < latestClosed.o;

  let status: 'ACTIVE_BULLISH' | 'ACTIVE_BEARISH' | 'INACTIVE' = 'INACTIVE';
  let anomaly_multiplier = 0;
  const volume_delta = parseFloat((latestBuyVol - latestSellVol).toFixed(2));

  if (isBullish && latestBuyVol > (avgBuyVol * 2.5) && avgBuyVol > 0) {
    status = 'ACTIVE_BULLISH';
    anomaly_multiplier = parseFloat((latestBuyVol / avgBuyVol).toFixed(2));
  } else if (isBearish && latestSellVol > (avgSellVol * 2.5) && avgSellVol > 0) {
    status = 'ACTIVE_BEARISH';
    anomaly_multiplier = parseFloat((latestSellVol / avgSellVol).toFixed(2));
  }

  return {
    status,
    anomaly_multiplier,
    volume_delta
  };
}
