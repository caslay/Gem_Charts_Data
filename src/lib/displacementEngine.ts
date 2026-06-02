import { Candle } from './fvgEngine';
 
export interface InstitutionalSponsorship {
  status: 'ACTIVE_BULLISH' | 'ACTIVE_BEARISH' | 'INACTIVE' | 'CONSOLIDATION';
  anomaly_multiplier: number;
  volume_delta: number;
  statistical_validation: {
    t_statistic: number;
    p_value: number;
    confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
    confidence_interval_95: boolean | 'CONSOLIDATION'; // Must be TRUE to execute
    confidence_interval_95_strict?: boolean | 'CONSOLIDATION';
  };
}
 
export function verifyDisplacementOffline(recentCandles: Candle[], symbol: string = 'ETHUSDC'): InstitutionalSponsorship {
  if (recentCandles.length < 16) {
    return {
      status: 'INACTIVE',
      anomaly_multiplier: 0,
      volume_delta: 0,
      statistical_validation: {
        t_statistic: 0,
        p_value: 1,
        confidence_level: 'LOW',
        confidence_interval_95: false,
        confidence_interval_95_strict: false
      }
    };
  }

  // Volatility Filter offline check (price range < 0.1% is CONSOLIDATION)
  const minPrice = Math.min(...recentCandles.map(c => c.l));
  const maxPrice = Math.max(...recentCandles.map(c => c.h));
  const volatilityRange = (maxPrice - minPrice) / (minPrice + 1e-9);
  const isConsolidation = volatilityRange < 0.001;
 
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
 
  let status: 'ACTIVE_BULLISH' | 'ACTIVE_BEARISH' | 'INACTIVE' | 'CONSOLIDATION' = isConsolidation ? 'CONSOLIDATION' : 'INACTIVE';
  let anomaly_multiplier = 0;
  const volume_delta = parseFloat((latestBuyVol - latestSellVol).toFixed(2));
 
  const volMultiplier = symbol.includes('ETH') ? 2.0 : 2.5;

  if (!isConsolidation) {
    if (isBullish && latestBuyVol > (avgBuyVol * volMultiplier) && avgBuyVol > 0) {
      status = 'ACTIVE_BULLISH';
      anomaly_multiplier = parseFloat((latestBuyVol / avgBuyVol).toFixed(2));
    } else if (isBearish && latestSellVol > (avgSellVol * volMultiplier) && avgSellVol > 0) {
      status = 'ACTIVE_BEARISH';
      anomaly_multiplier = parseFloat((latestSellVol / avgSellVol).toFixed(2));
    }
  }
 
  return {
    status,
    anomaly_multiplier,
    volume_delta,
    statistical_validation: {
      t_statistic: 0,
      p_value: 1,
      confidence_level: 'LOW',
      confidence_interval_95: isConsolidation ? 'CONSOLIDATION' : false,
      confidence_interval_95_strict: isConsolidation ? 'CONSOLIDATION' : false
    }
  };
}
 
export async function verifyDisplacement(recentCandles: Candle[], symbol: string = 'ETHUSDC'): Promise<InstitutionalSponsorship> {
  const localResult = verifyDisplacementOffline(recentCandles, symbol);
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1200); // 1.2s rapid response threshold
 
    const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    const baseUrl = process.env.NODE_ENV === 'development' 
      ? 'http://127.0.0.1:8000' 
      : (vercelHost ? `https://${vercelHost}` : 'http://127.0.0.1:4000');
 
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Bypass Vercel Authentication on Preview Deployments for server-to-server fetches
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }
 
    const response = await fetch(`${baseUrl}/api/py/calculate-displacement?symbol=${symbol}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(recentCandles.map(c => ({
        t: c.t,
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
        v: c.v || ((c.taker_buy_vol || 0) + (c.taker_sell_vol || 0)),
        taker_buy_vol: c.taker_buy_vol || 0,
        taker_sell_vol: c.taker_sell_vol || 0,
      }))),
      signal: controller.signal
    });
 
    clearTimeout(id);
    if (response.ok) {
      const data = await response.json();
      return data as InstitutionalSponsorship;
    } else {
      console.error('[verifyDisplacement] HTTP Error:', response.status, await response.text());
    }
  } catch (error: any) {
    console.warn(`[verifyDisplacement] Fetch Error: ${error.message || error}`);
    // Silent fail back to local offline analytical engine
  }
 
  return localResult;
}
