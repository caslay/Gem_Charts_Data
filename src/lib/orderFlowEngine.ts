export interface RestingLiquidityPools {
  BSL_Magnets: number[];
  SSL_Magnets: number[];
}

export interface LiquidationEvents {
  last_hour_purged: string;
  status: string;
}

export interface SmartMoneySentiment {
  funding_rate_status: string;
  smart_money_divergence: boolean;
}

export interface OrderFlowEngine {
  open_interest_trend: string;
  displacement_sponsorship: string;
  resting_liquidity_pools: RestingLiquidityPools;
  liquidation_events: LiquidationEvents;
  smart_money_sentiment: SmartMoneySentiment;
}

export async function fetchRestingLiquidity(symbol: string = 'ETHUSDC'): Promise<RestingLiquidityPools> {
  try {
    const [depthRes, tickerRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=1000`, { signal: AbortSignal.timeout(5000) }),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(5000) })
    ]);

    if (!depthRes.ok) throw new Error(`Failed to fetch depth data for ${symbol}`);
    if (!tickerRes.ok) throw new Error(`Failed to fetch ticker price for ${symbol}`);

    const [depthData, tickerData] = await Promise.all([
      depthRes.json(),
      tickerRes.json()
    ]);

    const livePrice = parseFloat(tickerData.price);
    if (isNaN(livePrice)) throw new Error(`Invalid live price fetched: ${tickerData.price}`);

    const bids = depthData.bids || [];
    const asks = depthData.asks || [];

    // Filter nodes that are at least 0.5% away from current price
    const filteredBids = bids.filter((bid: any) => {
      const price = parseFloat(bid[0]);
      return (livePrice - price) / livePrice >= 0.005;
    });

    const filteredAsks = asks.filter((ask: any) => {
      const price = parseFloat(ask[0]);
      return (price - livePrice) / livePrice >= 0.005;
    });

    const sortedBids = [...filteredBids].sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
    const topBids = sortedBids.slice(0, 3).map(bid => parseFloat(bid[0]));

    const sortedAsks = [...filteredAsks].sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
    const topAsks = sortedAsks.slice(0, 3).map(ask => parseFloat(ask[0]));

    return {
      BSL_Magnets: topAsks,
      SSL_Magnets: topBids,
    };
  } catch (error) {
    console.error('Error fetching resting liquidity:', error);
    return { BSL_Magnets: [], SSL_Magnets: [] };
  }
}

function calculateSMA(data: number[], period: number): number {
  if (data.length === 0) return 0;
  if (data.length < period) return data.reduce((a, b) => a + b, 0) / data.length;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export async function fetchOIMetricsAndLiquidations(symbol: string = 'ETHUSDC', isPriceRising: boolean = true): Promise<{ open_interest_trend: string, liquidation_events: LiquidationEvents }> {
  try {
    const [oiResult, liqResult] = await Promise.allSettled([
      fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=50`, { signal: AbortSignal.timeout(5000) }),
      fetch(`https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${symbol}&limit=100`, { signal: AbortSignal.timeout(5000) })
    ]);

    let open_interest_trend = 'UNAVAILABLE';
    let liquidation_events: LiquidationEvents = { last_hour_purged: 'UNAVAILABLE', status: 'UNAVAILABLE' };

    // Process OI
    if (oiResult.status === 'fulfilled' && oiResult.value.ok) {
      try {
        const oiData = await oiResult.value.json();
        if (Array.isArray(oiData) && oiData.length >= 14) {
          // sumOpenInterest is base asset quantity (ETH for ETHUSDC)
          const oiValues = oiData.map((d: { sumOpenInterest?: string | number, sumOpenInterestValue?: string | number }) => parseFloat(String(d.sumOpenInterest || d.sumOpenInterestValue))).filter(v => !isNaN(v));
          
          if (oiValues.length >= 14) {
            let currentTrend = 'NEUTRAL';
            const threshold = symbol.toUpperCase().includes('ETH') ? 500 : 50; // Calibrated 500 ETH hysteresis delta threshold
            
            for (let i = 14; i < oiValues.length; i++) {
              const sma = calculateSMA(oiValues.slice(0, i + 1), 14);
              const val = oiValues[i];
              
              if (currentTrend === 'RISING') {
                if (val < sma - threshold) {
                  currentTrend = 'FALLING';
                }
              } else if (currentTrend === 'FALLING') {
                if (val > sma + threshold) {
                  currentTrend = 'RISING';
                }
              } else {
                if (val > sma + threshold) {
                  currentTrend = 'RISING';
                } else if (val < sma - threshold) {
                  currentTrend = 'FALLING';
                }
              }
            }
            
            if ((currentTrend === 'RISING' && isPriceRising) || (currentTrend === 'FALLING' && !isPriceRising)) {
              open_interest_trend = `${currentTrend}_WITH_PRICE`;
            } else if (currentTrend !== 'NEUTRAL') {
              open_interest_trend = `${currentTrend}_AGAINST_PRICE`;
            } else {
              open_interest_trend = 'NEUTRAL';
            }
          }
        } else if (Array.isArray(oiData) && oiData.length >= 2) {
          // Fallback if data length is between 2 and 13
          const prevOI = parseFloat(oiData[oiData.length - 2].sumOpenInterest || oiData[oiData.length - 2].sumOpenInterestValue);
          const currOI = parseFloat(oiData[oiData.length - 1].sumOpenInterest || oiData[oiData.length - 1].sumOpenInterestValue);
          if (!isNaN(prevOI) && !isNaN(currOI)) {
            const trend = currOI > prevOI ? 'RISING' : 'FALLING';
            if ((trend === 'RISING' && isPriceRising) || (trend === 'FALLING' && !isPriceRising)) {
              open_interest_trend = `${trend}_WITH_PRICE`;
            } else {
              open_interest_trend = `${trend}_AGAINST_PRICE`;
            }
          }
        }
      } catch {}
    }

    // Process Liquidations
    if (liqResult.status === 'fulfilled' && liqResult.value.ok) {
      try {
        const data = await liqResult.value.json();
        if (Array.isArray(data)) {
          const oneHourAgo = Date.now() - 60 * 60 * 1000;
          const recentLiqs = data.filter((order: { time: number; executedQty: string; averagePrice: string; side: string }) => order.time > oneHourAgo);

          let totalLongsUsd = 0;
          let totalShortsUsd = 0;

          for (const order of recentLiqs) {
            const volume = parseFloat(order.executedQty) * parseFloat(order.averagePrice);
            if (!isNaN(volume)) {
              if (order.side === 'SELL') totalLongsUsd += volume; // Longs liquidated via Sell
              else if (order.side === 'BUY') totalShortsUsd += volume; // Shorts liquidated via Buy
            }
          }

          const totalPurged = totalLongsUsd + totalShortsUsd;
          const dominantSide = totalLongsUsd >= totalShortsUsd ? 'LONGS' : 'SHORTS';
          const dominantVolume = Math.max(totalLongsUsd, totalShortsUsd);

          let last_hour_purged = 'NO_MAJOR_PURGE';
          if (dominantVolume > 0) {
            if (dominantVolume >= 1_000_000) {
              last_hour_purged = `${(dominantVolume / 1_000_000).toFixed(1)}M_USD_${dominantSide}_PURGED`;
            } else if (dominantVolume >= 1_000) {
              last_hour_purged = `${(dominantVolume / 1_000).toFixed(0)}K_USD_${dominantSide}_PURGED`;
            } else {
              last_hour_purged = `${dominantVolume.toFixed(0)}_USD_${dominantSide}_PURGED`;
            }
          }

          liquidation_events = {
            last_hour_purged,
            status: totalPurged > 1_000_000 ? 'LIQUIDITY_SWEPT' : 'NORMAL'
          };
        }
      } catch {}
    }

    return { open_interest_trend, liquidation_events };
  } catch (error) {
    console.error('Error fetching OI/Liquidations:', error);
    return {
      open_interest_trend: 'UNAVAILABLE',
      liquidation_events: { last_hour_purged: 'UNAVAILABLE', status: 'UNAVAILABLE' }
    };
  }
}

export async function fetchSmartMoneySentiment(symbol: string = 'ETHUSDC'): Promise<SmartMoneySentiment> {
  try {
    const [fundingResult, ratioResult] = await Promise.allSettled([
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { signal: AbortSignal.timeout(5000) }),
      fetch(`https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`, { signal: AbortSignal.timeout(5000) })
    ]);

    let funding_rate_status = 'NEUTRAL';
    let smart_money_divergence = false;

    if (fundingResult.status === 'fulfilled' && fundingResult.value.ok) {
      try {
        const fundingData = await fundingResult.value.json();
        const lastFundingRate = parseFloat(fundingData.lastFundingRate);
        if (!isNaN(lastFundingRate)) {
          if (lastFundingRate > 0.0001) {
            funding_rate_status = 'HIGHLY_POSITIVE_RETAIL_LONG';
          } else if (lastFundingRate < -0.0001) {
            funding_rate_status = 'NEGATIVE_RETAIL_SHORT';
          }
        }
      } catch {}
    }

    if (ratioResult.status === 'fulfilled' && ratioResult.value.ok) {
      try {
        const ratioData = await ratioResult.value.json();
        if (Array.isArray(ratioData) && ratioData.length > 0) {
          const longShortRatio = parseFloat(ratioData[0].longShortRatio);
          if (!isNaN(longShortRatio)) {
            // Divergence is true if top traders oppose retail sentiment
            if (longShortRatio < 1.0 && funding_rate_status === 'HIGHLY_POSITIVE_RETAIL_LONG') {
              smart_money_divergence = true;
            } else if (longShortRatio > 1.0 && funding_rate_status === 'NEGATIVE_RETAIL_SHORT') {
              smart_money_divergence = true;
            }
          }
        }
      } catch {}
    }

    return { funding_rate_status, smart_money_divergence };
  } catch (error) {
    console.error('Error fetching smart money sentiment:', error);
    return {
      funding_rate_status: 'UNAVAILABLE',
      smart_money_divergence: false
    };
  }
}
