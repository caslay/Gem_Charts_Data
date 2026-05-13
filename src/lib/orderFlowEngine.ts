export async function fetchRestingLiquidity(symbol: string = 'ETHUSDT') {
  try {
    const response = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=1000`);
    if (!response.ok) {
      throw new Error(`Failed to fetch depth data for ${symbol}: ${response.statusText}`);
    }
    const data = await response.json();

    const { bids, asks } = data;

    // Bids: [price, volume]
    // Sort bids by volume descending
    const sortedBids = [...bids].sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
    // Top 3 bids (SSL_Magnets) waiting below the current price
    const topBids = sortedBids.slice(0, 3).map(bid => parseFloat(bid[0]));

    // Asks: [price, volume]
    // Sort asks by volume descending
    const sortedAsks = [...asks].sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
    // Top 3 asks (BSL_Magnets) waiting above the current price
    const topAsks = sortedAsks.slice(0, 3).map(ask => parseFloat(ask[0]));

    return {
      BSL_Magnets: topAsks,
      SSL_Magnets: topBids,
    };
  } catch (error) {
    console.error('Error fetching resting liquidity:', error);
    return {
      BSL_Magnets: [],
      SSL_Magnets: [],
    };
  }
}
