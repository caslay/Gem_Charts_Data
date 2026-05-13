export async function fetchOIMetrics(symbol: string = 'ETHUSDT') {
  try {
    const [oiResult, liqResult] = await Promise.allSettled([
      fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=2`),
      fetch(`https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${symbol}&limit=100`)
    ]);

    let open_interest_trend: 'RISING' | 'FALLING' | 'UNKNOWN' = 'UNKNOWN';
    let liquidation_events = {
      last_hour_purged: '0 USD',
      status: 'NORMAL'
    };

    // Process OI
    if (oiResult.status === 'fulfilled' && oiResult.value.ok) {
      try {
        const oiData = await oiResult.value.json();
        if (Array.isArray(oiData) && oiData.length === 2) {
          const prevOI = parseFloat(oiData[0].sumOpenInterestValue || oiData[0].sumOpenInterest);
          const currOI = parseFloat(oiData[1].sumOpenInterestValue || oiData[1].sumOpenInterest);
          
          if (!isNaN(prevOI) && !isNaN(currOI)) {
            open_interest_trend = currOI > prevOI ? 'RISING' : 'FALLING';
          }
        }
      } catch (err) {
        console.error('Error parsing OI data:', err);
      }
    }

    // Process Liquidations
    if (liqResult.status === 'fulfilled' && liqResult.value.ok) {
      try {
        const liqData = await liqResult.value.json();
        if (Array.isArray(liqData)) {
          const oneHourAgo = Date.now() - 60 * 60 * 1000;
          const recentLiqs = liqData.filter((order: any) => order.time > oneHourAgo);

          let totalLongsUsd = 0;
          let totalShortsUsd = 0;

          for (const order of recentLiqs) {
            const volume = parseFloat(order.executedQty) * parseFloat(order.averagePrice);
            if (!isNaN(volume)) {
              if (order.side === 'SELL') {
                // Longs get liquidated by selling
                totalLongsUsd += volume;
              } else if (order.side === 'BUY') {
                // Shorts get liquidated by buying
                totalShortsUsd += volume;
              }
            }
          }

          const totalPurged = totalLongsUsd + totalShortsUsd;
          
          let dominantSide = '';
          let dominantVolume = 0;

          if (totalLongsUsd >= totalShortsUsd) {
            dominantSide = 'LONGS';
            dominantVolume = totalLongsUsd;
          } else {
            dominantSide = 'SHORTS';
            dominantVolume = totalShortsUsd;
          }

          // Format string
          let volumeString = '0 USD';
          if (dominantVolume > 0) {
            if (dominantVolume >= 1_000_000) {
              volumeString = `${(dominantVolume / 1_000_000).toFixed(1)}M USD ${dominantSide}`;
            } else if (dominantVolume >= 1_000) {
              volumeString = `${(dominantVolume / 1_000).toFixed(0)}K USD ${dominantSide}`;
            } else {
              volumeString = `${dominantVolume.toFixed(0)} USD ${dominantSide}`;
            }
          } else {
            volumeString = `0 USD LONGS`;
          }

          liquidation_events = {
            last_hour_purged: volumeString,
            status: totalPurged > 1_000_000 ? 'LIQUIDITY_SWEPT' : 'NORMAL'
          };
        }
      } catch (err) {
        console.error('Error parsing Liquidation data:', err);
      }
    }

    return {
      open_interest_trend,
      liquidation_events
    };
  } catch (error) {
    console.error('Error fetching OI and Liquidations:', error);
    return {
      open_interest_trend: 'UNKNOWN',
      liquidation_events: {
        last_hour_purged: '0 USD',
        status: 'NORMAL'
      }
    };
  }
}
