export async function fetchSmartMoneySentiment(symbol: string = 'ETHUSDC') {
  try {
    const [fundingResult, ratioResult] = await Promise.allSettled([
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),
      fetch(`https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`)
    ]);

    let funding_rate_status = 'NEUTRAL';
    let smart_money_divergence = 'NO_CLEAR_DIVERGENCE';

    // Process Funding Rate
    if (fundingResult.status === 'fulfilled' && fundingResult.value.ok) {
      try {
        const fundingData = await fundingResult.value.json();
        const lastFundingRate = parseFloat(fundingData.lastFundingRate);
        if (!isNaN(lastFundingRate)) {
          if (lastFundingRate > 0.0001) {
            funding_rate_status = 'EXTREME_GREED_RETAIL_LONGS';
          } else if (lastFundingRate < -0.0001) {
            funding_rate_status = 'EXTREME_FEAR_RETAIL_SHORTS';
          }
        }
      } catch (err) {
        console.error('Error parsing funding data:', err);
        funding_rate_status = 'UNKNOWN';
      }
    } else {
      funding_rate_status = 'UNKNOWN';
    }

    // Process Top Trader Long/Short Ratio
    if (ratioResult.status === 'fulfilled' && ratioResult.value.ok) {
      try {
        const ratioData = await ratioResult.value.json();
        if (Array.isArray(ratioData) && ratioData.length > 0) {
          const longShortRatio = parseFloat(ratioData[0].longShortRatio);
          if (!isNaN(longShortRatio)) {
            if (longShortRatio < 1.0 && funding_rate_status === 'EXTREME_GREED_RETAIL_LONGS') {
              smart_money_divergence = 'SMART_MONEY_SHORTING_INTO_RETAIL_LONGS';
            } else if (longShortRatio > 1.0 && funding_rate_status === 'EXTREME_FEAR_RETAIL_SHORTS') {
              smart_money_divergence = 'SMART_MONEY_BUYING_RETAIL_PANIC';
            }
          }
        }
      } catch (err) {
        console.error('Error parsing ratio data:', err);
        smart_money_divergence = 'UNKNOWN';
      }
    } else {
      smart_money_divergence = 'UNKNOWN';
    }

    return {
      funding_rate_status,
      smart_money_divergence
    };
  } catch (error) {
    console.error('Error fetching smart money sentiment:', error);
    return {
      funding_rate_status: 'UNKNOWN',
      smart_money_divergence: 'UNKNOWN'
    };
  }
}
