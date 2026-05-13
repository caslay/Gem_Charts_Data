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
    const response = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=1000`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Failed to fetch depth data for ${symbol}`);
    const data = await response.json();

    const bids = data.bids || [];
    const asks = data.asks || [];

    const sortedBids = [...bids].sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
    const topBids = sortedBids.slice(0, 3).map(bid => parseFloat(bid[0]));

    const sortedAsks = [...asks].sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
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

export async function fetchOIMetricsAndLiquidations(symbol: string = 'ETHUSDC', isPriceRising: boolean = true): Promise<{ open_interest_trend: string, liquidation_events: LiquidationEvents }> {
  try {
    const [oiResult, liqResult] = await Promise.allSettled([
      fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=2`, { signal: AbortSignal.timeout(5000) }),
      fetch(`https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${symbol}&limit=100`, { signal: AbortSignal.timeout(5000) })
    ]);

    let open_interest_trend = 'UNAVAILABLE';
    let liquidation_events: LiquidationEvents = { last_hour_purged: 'UNAVAILABLE', status: 'UNAVAILABLE' };

    // Process OI
    if (oiResult.status === 'fulfilled' && oiResult.value.ok) {
      try {
        const oiData = await oiResult.value.json();
        if (Array.isArray(oiData) && oiData.length === 2) {
          const prevOI = parseFloat(oiData[0].sumOpenInterestValue || oiData[0].sumOpenInterest);
          const currOI = parseFloat(oiData[1].sumOpenInterestValue || oiData[1].sumOpenInterest);

          if (!isNaN(prevOI) && !isNaN(currOI)) {
            const trend = currOI > prevOI ? 'RISING' : 'FALLING';
            // Align with price direction for status
            if ((trend === 'RISING' && isPriceRising) || (trend === 'FALLING' && !isPriceRising)) {
              open_interest_trend = `${trend}_WITH_PRICE`;
            } else {
              open_interest_trend = `${trend}_AGAINST_PRICE`;
            }
          }
        }
      } catch (err) {}
    }

    // Process Liquidations
    if (liqResult.status === 'fulfilled' && liqResult.value.ok) {
      try {
        const data = await liqResult.value.json();
        if (Array.isArray(data)) {
          const oneHourAgo = Date.now() - 60 * 60 * 1000;
          const recentLiqs = data.filter((order: any) => order.time > oneHourAgo);

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
          let dominantSide = totalLongsUsd >= totalShortsUsd ? 'LONGS' : 'SHORTS';
          let dominantVolume = Math.max(totalLongsUsd, totalShortsUsd);

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
      } catch (err) {}
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
      } catch (err) {}
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
      } catch (err) {}
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
