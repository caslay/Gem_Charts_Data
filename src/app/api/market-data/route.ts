import { NextResponse } from 'next/server';
import { fetchRestingLiquidity, fetchOIMetricsAndLiquidations, fetchSmartMoneySentiment, OrderFlowStateTracker } from '@/lib/orderFlowEngine';
import { detectActiveFVGs, mapAndConsolidateFVGs } from '@/lib/fvgEngine';
import { verifyDisplacement } from '@/lib/displacementEngine';
import { calculateDynamicRisk, generateTradeExecutionParameters, calculateATR } from '@/lib/riskEngine';
import { getSmtContext } from '@/lib/smtEngine';
import { analyzeMarketStructureStateful } from '@/lib/structureEngine';
import { auth } from '@/auth';
import { sql } from '@vercel/postgres';
import { resolveTripleVectorBias } from '@/lib/quantEngine/BiasEngine';
import { annotateCandlesWithVolumetricSignals } from '@/utils/generateChartMarkers';

// NOTE: getStructuralDealingRange() removed — V10.13 Refactor.
// All structural analysis is now centralized in src/lib/structureEngine.ts
// via analyzeMarketStructure(). See implementation_plan.md for rationale.

export const dynamic = 'force-dynamic';

/**
 * Sequential/paginated fetch to Binance REST API for large history sizes.
 * Keeps serverless call roundtrips fast and structured.
 */
async function fetchLargeHistory(symbol: string, interval: string, totalLimit: number, endTime?: string): Promise<any[]> {
  let allKlines: any[] = [];
  let currentEndTime = endTime || '';
  const batchLimit = 1500;
  
  while (allKlines.length < totalLimit) {
    const limitToFetch = Math.min(batchLimit, totalLimit - allKlines.length);
    const suffix = currentEndTime ? `&endTime=${currentEndTime}` : '';
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limitToFetch}${suffix}`;
    
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`[fetchLargeHistory] Failed to fetch batch: HTTP ${res.status} ${res.statusText}`);
    }
    
    const batch: any[] = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    
    // Prepend older batch to allKlines
    allKlines = [...batch, ...allKlines];
    
    // Update currentEndTime to the oldest candle timestamp in the fetched batch
    const oldestTimestamp = batch[0][0];
    currentEndTime = String(oldestTimestamp);
    
    // If we got fewer candles than requested, we reached the end of history
    if (batch.length < limitToFetch) {
      break;
    }
  }
  
  if (allKlines.length === 0) {
    throw new Error(`[fetchLargeHistory] No klines fetched for ${symbol}`);
  }
  
  // Return sorted oldest to newest
  return allKlines.sort((a, b) => a[0] - b[0]);
}

// ── Dynamic In-Memory Price Cache (Lesson #41) ──────────────────────────────────
// Caches latest verified live prices per symbol to anchor offline mock generators dynamically
const LAST_KNOWN_PRICES = new Map<string, number>([
  ['ETHUSDC', 2400.00],
  ['ETHUSDT', 2400.00],
  ['BTCUSDT', 67000.00],
  ['BTCUSDC', 67000.00],
  ['SOLUSDC', 160.00],
  ['SOLUSDT', 160.00],
  ['XRPUSDC', 0.50],
  ['XRPUSDT', 0.50],
  ['BNBUSDC', 580.00],
  ['BNBUSDT', 580.00],
  ['ADAUSDC', 0.45],
  ['ADAUSDT', 0.45],
  ['DOTUSDC', 6.00],
  ['DOTUSDT', 6.00],
]);

/**
 * Enhanced Brownian motion candle generator for offline development & backtest fallback.
 * Generates continuous synthetic OHLCV data ending at the requested `endTimestamp`.
 * Supports arbitrary intervals, dynamic symbol pricing, and taker order flow volumes.
 * Performs a backward walk in time from `now` to `now - count * interval`.
 *
 * @param interval  - Binance-style interval string (e.g. '1m', '5m', '30m', '1h', '4h', '1d', '1w', '1M').
 *                    Parsed with a generic regex so any numeric prefix + unit combo works.
 * @param count     - Number of candles to generate.
 * @param endTimestamp - Unix ms timestamp for the newest candle. Defaults to now.
 * @param symbol    - Asset symbol used to choose a realistic base price.
 * @param startPrice - Optional override for the walk's starting (newest) price.
 *                    Pass the client's oldest candle close to guarantee seamless price continuity
 *                    when lazy-loading historical data in offline simulation mode.
 */
function generateMockCandles(
  interval: string,
  count: number,
  endTimestamp?: number,
  symbol: string = 'ETHUSDC',
  startPrice?: number
): any[] {
  const candles: any[] = [];
  const now = endTimestamp || Date.now();

  // ── Generic interval parser — handles any Binance format (1m, 30m, 2h, 3d, 1w, 1M) ──
  let intervalMs = 5 * 60 * 1000; // safe fallback: 5 minutes
  const match = interval.match(/^(\d+)([mhdwM])$/);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    if (unit === 'm') intervalMs = value * 60 * 1000;
    else if (unit === 'h') intervalMs = value * 60 * 60 * 1000;
    else if (unit === 'd') intervalMs = value * 24 * 60 * 60 * 1000;
    else if (unit === 'w') intervalMs = value * 7 * 24 * 60 * 60 * 1000;
    else if (unit === 'M') intervalMs = value * 30 * 24 * 60 * 60 * 1000;
  }

  // ── Base price: startPrice (client anchor) > LAST_KNOWN_PRICES > default by symbol ──
  const sym = symbol.toUpperCase();
  let basePrice = LAST_KNOWN_PRICES.get(sym);
  if (!basePrice) {
    if (sym.includes('BTC')) basePrice = 67000.00;
    else if (sym.includes('SOL')) basePrice = 160.00;
    else if (sym.includes('XRP')) basePrice = 0.50;
    else if (sym.includes('BNB')) basePrice = 580.00;
    else if (sym.includes('ADA')) basePrice = 0.45;
    else if (sym.includes('DOT')) basePrice = 6.00;
    else basePrice = 2400.00;
  }

  // If the client passed its oldest candle's close price, anchor the walk there for
  // seamless price continuity across the lazy-load boundary.
  let currentPrice = (startPrice && isFinite(startPrice) && startPrice > 0) ? startPrice : basePrice;

  // Align start timestamp to the exact interval boundary
  const rawNow = endTimestamp || Date.now();
  const alignedNow = Math.floor(rawNow / intervalMs) * intervalMs;

  for (let i = 0; i < count; i++) {
    const timestamp = alignedNow - i * intervalMs;
    const change = (Math.random() - 0.5) * (currentPrice * 0.0008);
    const close = currentPrice;
    const open = currentPrice - change;
    const high = Math.max(open, close) + Math.random() * (currentPrice * 0.0004);
    const low = Math.min(open, close) - Math.random() * (currentPrice * 0.0004);
    const volume = 100 + Math.random() * 900;
    const taker_buy_vol = volume * (0.46 + Math.random() * 0.08);
    const taker_sell_vol = volume - taker_buy_vol;

    candles.push({
      t: timestamp,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume,
      taker_buy_vol,
      taker_sell_vol,
      isClosed: true
    });
    currentPrice = open;
  }
  return candles.sort((a, b) => a.t - b.t);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get('symbol') || 'ETHUSDC';
    
    // Calibrated baseline candle lookback limits per timeframe (V16.22 Performance Optimization)
    const DEFAULT_LIMIT_1M = 350;
    const DEFAULT_LIMIT_5M = 350;
    const DEFAULT_LIMIT_15M = 250;
    const DEFAULT_LIMIT_1H = 120;
    const DEFAULT_LIMIT_4H = 80;

    const isPoll = url.searchParams.get('poll') === 'true';
    const timeframeGated = url.searchParams.get('timeframeGated') === 'true';
    const isInit = url.searchParams.get('init') === 'true';

    // Fetch custom base candle limit from query param, or fallback to 350
    let limit = 350;
    const queryLimit = parseInt(url.searchParams.get('limit') || '', 10);
    if (!isNaN(queryLimit) && queryLimit > 0) {
      limit = queryLimit;
    }

    let limit1m = 0;
    let limit5m = 0;
    let limit15m = 0;
    let limit1h = 0;
    let limit4h = 0;

    const visualInterval = url.searchParams.get('interval') || '5m';
    const isStandardInterval = ['5m', '15m', '1h', '4h'].includes(visualInterval);

    if (isPoll) {
      // Polling mode: only fetch 5 delta candles of the active interval
      if (visualInterval === '1m') limit1m = 5;
      else if (visualInterval === '5m') limit5m = 5;
      else if (visualInterval === '15m') limit15m = 5;
      else if (visualInterval === '1h') limit1h = 5;
      else if (visualInterval === '4h') limit4h = 5;
    } else if (timeframeGated && !isInit) {
      // Gated mode: fetch calibrated limit only for active interval
      const parsed1m = parseInt(url.searchParams.get('limit1m') || String(DEFAULT_LIMIT_1M), 10);
      const parsed5m = parseInt(url.searchParams.get('limit5m') || String(DEFAULT_LIMIT_5M), 10);
      const parsed15m = parseInt(url.searchParams.get('limit15m') || String(DEFAULT_LIMIT_15M), 10);
      const parsed1h = parseInt(url.searchParams.get('limit1h') || String(DEFAULT_LIMIT_1H), 10);
      const parsed4h = parseInt(url.searchParams.get('limit4h') || String(DEFAULT_LIMIT_4H), 10);

      if (visualInterval === '1m') limit1m = !isNaN(parsed1m) && parsed1m > 0 ? parsed1m : DEFAULT_LIMIT_1M;
      else if (visualInterval === '5m') limit5m = !isNaN(parsed5m) && parsed5m > 0 ? parsed5m : DEFAULT_LIMIT_5M;
      else if (visualInterval === '15m') limit15m = !isNaN(parsed15m) && parsed15m > 0 ? parsed15m : DEFAULT_LIMIT_15M;
      else if (visualInterval === '1h') limit1h = !isNaN(parsed1h) && parsed1h > 0 ? parsed1h : DEFAULT_LIMIT_1H;
      else if (visualInterval === '4h') limit4h = !isNaN(parsed4h) && parsed4h > 0 ? parsed4h : DEFAULT_LIMIT_4H;
    } else {
      // Initial bootstrap load (init=true) or full load — right-size each timeframe independently
      const parsed1m = parseInt(url.searchParams.get('limit1m') || '', 10);
      const parsed5m = parseInt(url.searchParams.get('limit5m') || '', 10);
      const parsed15m = parseInt(url.searchParams.get('limit15m') || '', 10);
      const parsed1h = parseInt(url.searchParams.get('limit1h') || '', 10);
      const parsed4h = parseInt(url.searchParams.get('limit4h') || '', 10);

      limit1m = !isNaN(parsed1m) && parsed1m > 0 ? parsed1m : DEFAULT_LIMIT_1M;
      limit5m = !isNaN(parsed5m) && parsed5m > 0 ? parsed5m : DEFAULT_LIMIT_5M;
      limit15m = !isNaN(parsed15m) && parsed15m > 0 ? parsed15m : DEFAULT_LIMIT_15M;
      limit1h = !isNaN(parsed1h) && parsed1h > 0 ? parsed1h : DEFAULT_LIMIT_1H;
      limit4h = !isNaN(parsed4h) && parsed4h > 0 ? parsed4h : DEFAULT_LIMIT_4H;
    }

    if (isNaN(limit1m) || limit1m < 0 || limit1m > 1500) limit1m = DEFAULT_LIMIT_1M;
    if (isNaN(limit5m) || limit5m < 0 || limit5m > 1500) limit5m = DEFAULT_LIMIT_5M;
    if (isNaN(limit15m) || limit15m < 0 || limit15m > 1500) limit15m = DEFAULT_LIMIT_15M;
    if (isNaN(limit1h) || limit1h < 0 || limit1h > 1500) limit1h = DEFAULT_LIMIT_1H;
    if (isNaN(limit4h) || limit4h < 0 || limit4h > 1500) limit4h = DEFAULT_LIMIT_4H;

    const includeBtc = url.searchParams.get('includeBtc') !== 'false';
    const includeStructure = url.searchParams.get('includeStructure') !== 'false';
    const includeFvg = url.searchParams.get('includeFvg') !== 'false';

    const visualLimit = visualInterval === '1m' ? limit1m :
                        visualInterval === '5m' ? limit5m :
                        visualInterval === '15m' ? limit15m :
                        visualInterval === '1h' ? limit1h :
                        visualInterval === '4h' ? limit4h : limit;

    const endTime = url.searchParams.get('endTime') || '';

    // Optional price anchor sent by the client — the close of its current oldest/newest candle.
    // Consumed by offline simulation fallback to guarantee seamless price continuity and prevent outlier jumps.
    const fallbackPriceParam = url.searchParams.get('fallbackPrice') || url.searchParams.get('lastPrice');
    const fallbackPrice = (fallbackPriceParam && !isNaN(parseFloat(fallbackPriceParam)) && parseFloat(fallbackPriceParam) > 0)
      ? parseFloat(fallbackPriceParam)
      : undefined;

    if (fallbackPrice) {
      LAST_KNOWN_PRICES.set(symbol.toUpperCase(), fallbackPrice);
    }

    if (endTime) {
      // Direct fast path for historical lazy-loading.
      // Bypasses SMT, risk, orderflow pools, database transactions, and unnecessary HTF fetches.
      const urlBinance = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${visualInterval}&limit=${visualLimit}&endTime=${endTime}`;
      try {
        const resBinance = await fetch(urlBinance);
        if (!resBinance.ok) {
          throw new Error(`Binance API error: ${resBinance.statusText}`);
        }
        
        const rawData = await resBinance.json();
        if (!Array.isArray(rawData)) {
          throw new Error('Invalid response from Binance API');
        }
        
        const formatted = rawData.map((c: any) => {
          const v = parseFloat(c[5]);
          const taker_buy_vol = parseFloat(c[9]);
          const taker_sell_vol = v - taker_buy_vol;
          return {
            t: c[0],
            o: parseFloat(c[1]),
            h: parseFloat(c[2]),
            l: parseFloat(c[3]),
            c: parseFloat(c[4]),
            v: v,
            taker_buy_vol,
            taker_sell_vol,
            isClosed: true
          };
        });
        
        annotateCandlesWithVolumetricSignals(formatted);

        const payload = {
          ticker: `${symbol}.p`,
          timestamp: new Date().toISOString(),
          timezone: "UTC",
          candles_limit: visualLimit,
          data_payload: {
            [`candles_${visualInterval}`]: formatted
          }
        };
        
        return NextResponse.json(payload);
      } catch (err: any) {
        console.warn(`[MarketData API] Operating in OFFLINE SIMULATION MODE. Historical lazy-load Binance feed unavailable: ${err.message || err}`);
        
        // Pass dynamic anchor price so the backward walk starts exactly at the client's oldest
        // candle close — preventing vertical price jumps at the lazy-load boundary.
        const resolvedLazyFallback = fallbackPrice || LAST_KNOWN_PRICES.get(symbol.toUpperCase()) || 2400.00;
        const mockHist = generateMockCandles(visualInterval, 100, Number(endTime), symbol, resolvedLazyFallback);
        annotateCandlesWithVolumetricSignals(mockHist);

        const payload = {
          ticker: `${symbol}.p`,
          timestamp: new Date().toISOString(),
          timezone: "UTC",
          candles_limit: visualLimit,
          data_payload: {
            [`candles_${visualInterval}`]: mockHist
          }
        };
        
        return NextResponse.json(payload);
      }
    }

    const endTimeSuffix = endTime ? `&endTime=${endTime}` : '';

    const urls = {
      '5m': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=5m&limit=${limit5m}${endTimeSuffix}`,
      '15m': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=${limit15m}${endTimeSuffix}`,
      '1h': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=${limit1h}${endTimeSuffix}`,
      '4h': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=4h&limit=${limit4h}${endTimeSuffix}`,
      // HTF — fetched for background calculations only, NEVER exposed in data_payload
      '1d': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=100`,
      '1w': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1w&limit=100`,
      '1M': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1M&limit=24`,
      'openInterest': `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`,
      // Parallel fetches for BTCUSDT
      'btc_5m': `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=20`,
      'btc_15m': `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=20`,
      'btc_1h': `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=24`,
    };

    let isOffline = false;
    let data5m: any[] = [];
    let data1h: any[] = [];
    let data4h: any[] = [];
    let data15m: any[] = [];
    let data1d: any[] = [];
    let data1w: any[] = [];
    let data1M: any[] = [];
    let dataBtc5m: any[] = [];
    let dataBtc15m: any[] = [];
    let dataBtc1h: any[] = [];
    let dataOi = { openInterest: "350000" };
    let resting_liquidity_pools = { BSL_Magnets: [] as number[], SSL_Magnets: [] as number[] };
    let smart_money_sentiment = { funding_rate_status: 'NEUTRAL', smart_money_divergence: false };
    let visualDataRaw: any[] | null = null;

    try {
      const fetchJson = async (url: string) => {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
      };

      const fetchJsonOrEmpty = async (url: string, limitVal: number) => {
        if (limitVal <= 0) return [];
        return fetchJson(url);
      };

      const fetchHtf = !(isPoll || (timeframeGated && !isInit));
      const fetchBtcHtf = includeBtc && !(isPoll || (timeframeGated && !isInit));

      const restingLiquidityPromise = fetchRestingLiquidity(symbol).catch(() => ({ BSL_Magnets: [], SSL_Magnets: [] }));
      const smartMoneyPromise = fetchSmartMoneySentiment(symbol).catch(() => ({ funding_rate_status: 'NEUTRAL', smart_money_divergence: false }));

      // Fetch 15m candles respecting user configured limit
      const res15mPromise = (limit15m > 1500)
        ? fetchLargeHistory(symbol, '15m', limit15m, endTime)
        : fetchJsonOrEmpty(urls['15m'], limit15m);

      let visualFetchPromise = Promise.resolve(null as any);
      if (!isStandardInterval) {
        const visualUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${visualInterval}&limit=${visualLimit}${endTimeSuffix}`;
        visualFetchPromise = isPoll ? fetchJsonOrEmpty(visualUrl, 5) : fetchJsonOrEmpty(visualUrl, visualLimit);
      }

      const [r5m, r1h, r4h, r1d, r1w, r1M, rOi, rBtc5m, rBtc15m, rBtc1h, rVisual, rResting, rSmart, r15m] = await Promise.all([
        fetchJsonOrEmpty(urls['5m'], limit5m),
        fetchJsonOrEmpty(urls['1h'], limit1h),
        fetchJsonOrEmpty(urls['4h'], limit4h),
        fetchHtf ? fetchJson(urls['1d']) : Promise.resolve([]),
        fetchHtf ? fetchJson(urls['1w']) : Promise.resolve([]),
        fetchHtf ? fetchJson(urls['1M']) : Promise.resolve([]),
        fetchJson(urls['openInterest']),
        includeBtc ? fetchJson(urls['btc_5m']).catch(() => []) : Promise.resolve([]),
        fetchBtcHtf ? fetchJson(urls['btc_15m']).catch(() => []) : Promise.resolve([]),
        fetchBtcHtf ? fetchJson(urls['btc_1h']).catch(() => []) : Promise.resolve([]),
        visualFetchPromise,
        restingLiquidityPromise,
        smartMoneyPromise,
        res15mPromise,
      ]);

      data5m = r5m;
      data1h = r1h;
      data4h = r4h;
      data1d = r1d;
      data1w = r1w;
      data1M = r1M;
      dataOi = rOi;
      dataBtc5m = rBtc5m;
      dataBtc15m = rBtc15m;
      dataBtc1h = rBtc1h;
      visualDataRaw = rVisual;
      resting_liquidity_pools = rResting;
      smart_money_sentiment = rSmart;
      data15m = r15m;
    } catch (err: any) {
      console.warn(`[MarketData API] Operating in OFFLINE SIMULATION MODE. Binance feed unavailable: ${err.message || err}`);
      isOffline = true;
    }

    const formatCandles = (data: any[]) => {
      const now = Date.now();
      return data.map((c) => {
        const v = parseFloat(c[5]) || 0;
        const openPrice = parseFloat(c[1]);
        const closePrice = parseFloat(c[4]);
        const rawTakerBuy = parseFloat(c[9]);
        const taker_buy_vol = !isNaN(rawTakerBuy) && rawTakerBuy >= 0 ? rawTakerBuy : (v * (closePrice > openPrice ? 0.6 : 0.4));
        const taker_sell_vol = v - taker_buy_vol;
        return {
          t: c[0],
          o: openPrice,
          h: parseFloat(c[2]),
          l: parseFloat(c[3]),
          c: closePrice,
          v: v,
          taker_buy_vol,
          taker_sell_vol,
          isClosed: now >= c[6]
        };
      });
    };

    let candles4h: any[] = [];
    let candles1h: any[] = [];
    let candles15m: any[] = [];
    let candles5m: any[] = [];
    let dynamicVisualCandles: any[] = [];
    let candles1d: any[] = [];
    let candles1w: any[] = [];
    let candles1M: any[] = [];
    let candlesBtc5m: any[] = [];
    let candlesBtc15m: any[] = [];
    let candlesBtc1h: any[] = [];

    if (isOffline) {
      const activeAnchorPrice = fallbackPrice || LAST_KNOWN_PRICES.get(symbol.toUpperCase()) || 2400.00;
      const btcAnchorPrice = LAST_KNOWN_PRICES.get('BTCUSDT') || 67000.00;

      candles5m = generateMockCandles('5m', limit5m, undefined, symbol, activeAnchorPrice);
      candles15m = generateMockCandles('15m', limit15m, undefined, symbol, activeAnchorPrice);
      candles1h = generateMockCandles('1h', limit1h, undefined, symbol, activeAnchorPrice);
      candles4h = generateMockCandles('4h', limit4h, undefined, symbol, activeAnchorPrice);
      candlesBtc5m = generateMockCandles('5m', 20, undefined, 'BTCUSDT', btcAnchorPrice);
      candlesBtc15m = generateMockCandles('15m', 20, undefined, 'BTCUSDT', btcAnchorPrice);
      candlesBtc1h = generateMockCandles('1h', 24, undefined, 'BTCUSDT', btcAnchorPrice);
      candles1d = generateMockCandles('1d', 100, undefined, symbol, activeAnchorPrice);
      candles1w = generateMockCandles('1w', 100, undefined, symbol, activeAnchorPrice);
      candles1M = generateMockCandles('1M', 24, undefined, symbol, activeAnchorPrice);
      resting_liquidity_pools = { BSL_Magnets: [], SSL_Magnets: [] };
      smart_money_sentiment = { funding_rate_status: 'NEUTRAL', smart_money_divergence: false };
      if (!isStandardInterval) {
        dynamicVisualCandles = generateMockCandles(visualInterval, visualLimit, undefined, symbol, activeAnchorPrice);
      }
    } else {
      candles4h = formatCandles(data4h);
      candles1h = formatCandles(data1h);
      candles15m = formatCandles(data15m);
      candles5m = formatCandles(data5m);
      dynamicVisualCandles = (!isStandardInterval && visualDataRaw) ? formatCandles(visualDataRaw) : [];
      candles1d = formatCandles(data1d);
      candles1w = formatCandles(data1w);
      candles1M = formatCandles(data1M);
      candlesBtc5m = formatCandles(dataBtc5m);
      candlesBtc15m = formatCandles(dataBtc15m);
      candlesBtc1h = formatCandles(dataBtc1h);
    }

    // Find the latest valid candle across any non-empty candle arrays to act as a robust fallback
    let latestCandleFromAny: any = null;
    const allCandleArrays = [
      dynamicVisualCandles,
      candles5m,
      candles15m,
      candles1h,
      candles4h,
      candles1d,
      candles1w,
      candles1M
    ];
    for (const arr of allCandleArrays) {
      if (arr && arr.length > 0) {
        const last = arr[arr.length - 1];
        if (!latestCandleFromAny || last.t > latestCandleFromAny.t) {
          latestCandleFromAny = last;
        }
      }
    }

    const currentLivePrice = latestCandleFromAny ? latestCandleFromAny.c : 0;
    if (!isOffline && currentLivePrice > 0) {
      LAST_KNOWN_PRICES.set(symbol.toUpperCase(), currentLivePrice);
    }

    // BTC PDH and PDL solvers (based on last 24h of 1h klines)
    let btcPdh = 0;
    let btcPdl = Infinity;
    candlesBtc1h.forEach((c) => {
      if (c.h > btcPdh) btcPdh = c.h;
      if (c.l < btcPdl) btcPdl = c.l;
    });
    if (btcPdl === Infinity) btcPdl = 0;

    const isPriceRising = candles15m.length > 1 && candles15m[candles15m.length - 1].c > candles15m[candles15m.length - 2].c;
    
    let open_interest_trend = 'NEUTRAL';
    let liquidation_events = { last_hour_purged: 'NO_MAJOR_PURGE', status: 'NORMAL' };
    
    if (!isOffline) {
      const oiLiqs = await fetchOIMetricsAndLiquidations(symbol, isPriceRising);
      open_interest_trend = oiLiqs.open_interest_trend;
      liquidation_events = oiLiqs.liquidation_events;
    }

    // Helper to get true UTC date
    const getUtcDate = (t: number) => new Date(t);

    // 1. Macro Context
    const lastCandle = (candles1h && candles1h.length > 0)
      ? candles1h[candles1h.length - 1]
      : (latestCandleFromAny || { t: Date.now(), c: 0 });
    const lastDateUtc = getUtcDate(lastCandle.t);
    const currentYear = lastDateUtc.getUTCFullYear();
    const currentMonth = lastDateUtc.getUTCMonth();
    const currentDate = lastDateUtc.getUTCDate();

    const previousDayDateUtc = new Date(Date.UTC(currentYear, currentMonth, currentDate - 1));
    const prevYear = previousDayDateUtc.getUTCFullYear();
    const prevMonth = previousDayDateUtc.getUTCMonth();
    const prevDate = previousDayDateUtc.getUTCDate();

    let pdh = 0;
    let pdl = Infinity;
    candles1h.forEach(c => {
      const dUtc = getUtcDate(c.t);
      if (dUtc.getUTCFullYear() === prevYear && dUtc.getUTCMonth() === prevMonth && dUtc.getUTCDate() === prevDate) {
        if (c.h > pdh) pdh = c.h;
        if (c.l < pdl) pdl = c.l;
      }
    });
    if (pdl === Infinity) pdl = 0;

    // 3. Killzone Stepped Liquidity (UTC based)
    const getSessionLiquidityUTC = (candles: any[], startHourUTC: number, endHourUTC: number) => {
      const currentDayStr = `${currentYear}-${currentMonth}-${currentDate}`;
      const sessionCandles = candles.filter(c => {
        const dUtc = getUtcDate(c.t);
        const candleDayStr = `${dUtc.getUTCFullYear()}-${dUtc.getUTCMonth()}-${dUtc.getUTCDate()}`;
        const hUtc = dUtc.getUTCHours();
        return candleDayStr === currentDayStr && hUtc >= startHourUTC && hUtc < endHourUTC;
      });

      if (sessionCandles.length === 0) return { high: null, low: null };

      return {
        high: parseFloat(Math.max(...sessionCandles.map(c => c.h)).toFixed(2)),
        low: parseFloat(Math.min(...sessionCandles.map(c => c.l)).toFixed(2))
      };
    };

    const asianLiquidity = getSessionLiquidityUTC(candles15m, 0, 7);
    const londonLiquidity = getSessionLiquidityUTC(candles15m, 7, 12);

    // 2. Target Exhaustion (Persistent Daily Sweeps)
    let target_status = "PENDING";
    const currentDayStrForSweep = `${currentYear}-${currentMonth}-${currentDate}`;

    const todayCandles = candles15m.filter(c => {
      const dUtc = getUtcDate(c.t);
      return `${dUtc.getUTCFullYear()}-${dUtc.getUTCMonth()}-${dUtc.getUTCDate()}` === currentDayStrForSweep;
    });

    const sweeps: string[] = [];

    // Check PDH/PDL Exhaustion across all today's candles
    if (pdh > 0 && pdl > 0 && pdl !== Infinity) {
      for (const c of todayCandles) {
        if (c.h >= pdh || c.l <= pdl) {
          sweeps.push("EXHAUSTED");
        }
      }
    }

    // Check Asian sweeps (only candles at or after 07:00 UTC)
    const afterAsianCandles = todayCandles.filter(c => getUtcDate(c.t).getUTCHours() >= 7);
    for (const c of afterAsianCandles) {
      if (asianLiquidity.high && c.h >= asianLiquidity.high && (pdh > 0 ? c.h < pdh : true)) {
        sweeps.push("ASIAN_HIGH_SWEPT");
      }
      if (asianLiquidity.low && c.l <= asianLiquidity.low && (pdl > 0 ? c.l > pdl : true)) {
        sweeps.push("ASIAN_LOW_SWEPT");
      }
    }

    // Check London sweeps (only candles at or after 12:00 UTC)
    const afterLondonCandles = todayCandles.filter(c => getUtcDate(c.t).getUTCHours() >= 12);
    for (const c of afterLondonCandles) {
      if (londonLiquidity.high && c.h >= londonLiquidity.high && (pdh > 0 ? c.h < pdh : true)) {
        sweeps.push("LONDON_HIGH_SWEPT");
      }
      if (londonLiquidity.low && c.l <= londonLiquidity.low && (pdl > 0 ? c.l > pdl : true)) {
        sweeps.push("LONDON_LOW_SWEPT");
      }
    }

    if (sweeps.includes("EXHAUSTED")) {
      target_status = "EXHAUSTED";
    } else if (sweeps.length > 0) {
      const uniqueSweeps = Array.from(new Set(sweeps));
      target_status = uniqueSweeps.join(" | ") + " / PDH_PDL_PENDING";
    }

    // 5. Dealing Range Pricing Zone (Premium / Equilibrium / Discount)
    let current_pricing = "UNKNOWN";
    const rangeEq = (pdh > 0 && pdl > 0) ? (pdh + pdl) / 2 : currentLivePrice;
    if (rangeEq > 0 && currentLivePrice > 0) {
      if (currentLivePrice > rangeEq + 0.5) {
        current_pricing = "PREMIUM";
      } else if (currentLivePrice < rangeEq - 0.5) {
        current_pricing = "DISCOUNT";
      } else {
        current_pricing = "EQUILIBRIUM";
      }
    }

    // 4. SMT/Equal Highs & Lows Detector
    const scanWindow = candles15m.slice(-20);
    const swingHighs: { index: number, price: number, time: number }[] = [];
    const swingLows: { index: number, price: number, time: number }[] = [];
    for (let i = 1; i < scanWindow.length - 1; i++) {
      const prev = scanWindow[i - 1];
      const curr = scanWindow[i];
      const next = scanWindow[i + 1];
      
      // Swing High Color Lock: peak candle 'curr' must be RED (close < open) preceded by a GREEN candle (close > open)
      const isFractalHigh = curr.h > prev.h && curr.h > next.h;
      const isHighColorLocked = curr.c < curr.o && prev.c > prev.o;
      if (isFractalHigh && isHighColorLocked) {
        swingHighs.push({ index: i, price: curr.h, time: curr.t });
      }

      // Swing Low Color Lock: valley candle 'curr' must be GREEN (close > open) preceded by a RED candle (close < open)
      const isFractalLow = curr.l < prev.l && curr.l < next.l;
      const isLowColorLocked = curr.c > curr.o && prev.c < prev.o;
      if (isFractalLow && isLowColorLocked) {
        swingLows.push({ index: i, price: curr.l, time: curr.t });
      }
    }

    const smtAtr = calculateATR(candles15m);
    const smtBuffer = smtAtr > 0 ? 0.2 * smtAtr : 0.50;

    const smt_traps = [];
    // Equal Highs (Resistance Liquidity)
    for (let i = 0; i < swingHighs.length; i++) {
      for (let j = i + 1; j < swingHighs.length; j++) {
        if (Math.abs(swingHighs[i].price - swingHighs[j].price) <= smtBuffer) {
          smt_traps.push({
            type: "engineered_liquidity",
            side: "high",
            price: parseFloat(((swingHighs[i].price + swingHighs[j].price) / 2).toFixed(2)),
            time1: swingHighs[i].time,
            time2: swingHighs[j].time,
          });
        }
      }
    }
    // Equal Lows (Support Liquidity)
    for (let i = 0; i < swingLows.length; i++) {
      for (let j = i + 1; j < swingLows.length; j++) {
        if (Math.abs(swingLows[i].price - swingLows[j].price) <= smtBuffer) {
          smt_traps.push({
            type: "engineered_liquidity",
            side: "low",
            price: parseFloat(((swingLows[i].price + swingLows[j].price) / 2).toFixed(2)),
            time1: swingLows[i].time,
            time2: swingLows[j].time,
          });
        }
      }
    }

    // 7. Historical Magnets Scanner (HTF — 1w / 1d)
    const livePrice = currentLivePrice;

    // Previous Week High / Low (exclude current open week)
    const prevWeeklyCandle = candles1w.length > 1 ? candles1w[candles1w.length - 2] : null;
    const pwh = prevWeeklyCandle ? prevWeeklyCandle.h : null;
    const pwl = prevWeeklyCandle ? prevWeeklyCandle.l : null;

    // Previous Month High / Low (exclude current open month)
    const prevMonthlyCandle = candles1M.length > 1 ? candles1M[candles1M.length - 2] : null;
    const pmh = prevMonthlyCandle ? prevMonthlyCandle.h : null;
    const pml = prevMonthlyCandle ? prevMonthlyCandle.l : null;

    // 7a. Weekly High / Low — last 4 completed weekly candles (exclude current open)
    const last4Weeks = candles1w.slice(-5, -1);
    const nearest_weekly_high = last4Weeks.length > 0
      ? Math.max(...last4Weeks.map((c: any) => c.h))
      : null;
    const nearest_weekly_low = last4Weeks.length > 0
      ? Math.min(...last4Weeks.map((c: any) => c.l))
      : null;

    // 7b. Daily FVG Scanner — last 30 daily candles (exclude current open)
    const last30Daily = candles1d.slice(-31, -1);
    const dailyFVGs = detectActiveFVGs(last30Daily);

    // Find nearest unmitigated SIBI above price and BISI below price
    const sibisAbove = dailyFVGs
      .filter((fvg: any) => fvg.type === 'SIBI' && fvg.coordinates.bottom > livePrice)
      .sort((a: any, b: any) => a.coordinates.bottom - b.coordinates.bottom);
    const bisiBelow = dailyFVGs
      .filter((fvg: any) => fvg.type === 'BISI' && fvg.coordinates.top < livePrice)
      .sort((a: any, b: any) => b.coordinates.top - a.coordinates.top);

    const bsl_long_term = [];
    if (pwh !== null) {
      bsl_long_term.push({ label: 'PWH', price: pwh, distance: parseFloat(Math.abs(pwh - livePrice).toFixed(2)) });
    }
    if (pmh !== null) {
      bsl_long_term.push({ label: 'PMH', price: pmh, distance: parseFloat(Math.abs(pmh - livePrice).toFixed(2)) });
    }
    if (sibisAbove.length > 0) {
      const sibiPrice = sibisAbove[0].coordinates.bottom;
      bsl_long_term.push({
        label: 'DAILY_SIBI_ENTRY',
        price: sibiPrice,
        distance: parseFloat(Math.abs(sibiPrice - livePrice).toFixed(2)),
        details: sibisAbove[0]
      });
    }

    const ssl_long_term = [];
    if (pwl !== null) {
      ssl_long_term.push({ label: 'PWL', price: pwl, distance: parseFloat(Math.abs(pwl - livePrice).toFixed(2)) });
    }
    if (pml !== null) {
      ssl_long_term.push({ label: 'PML', price: pml, distance: parseFloat(Math.abs(pml - livePrice).toFixed(2)) });
    }
    if (bisiBelow.length > 0) {
      const bisiPrice = bisiBelow[0].coordinates.top;
      ssl_long_term.push({
        label: 'DAILY_BISI_ENTRY',
        price: bisiPrice,
        distance: parseFloat(Math.abs(bisiPrice - livePrice).toFixed(2)),
        details: bisiBelow[0]
      });
    }

    const macro_structural_magnets = {
      bsl_long_term,
      ssl_long_term
    };

    const historical_magnets = {
      pwh,
      pwl,
      pmh,
      pml,
      nearest_weekly_high,
      nearest_weekly_low,
      nearest_daily_sibi: sibisAbove.length > 0 ? sibisAbove[0] : null,
      nearest_daily_bisi: bisiBelow.length > 0 ? bisiBelow[0] : null,
    };

    // 8. Price Discovery & Standard Deviations (Asian Range Projections)
    const asianHigh = asianLiquidity.high;
    const asianLow = asianLiquidity.low;

    let projected_targets: Record<string, number | null>;
    if (!asianHigh || !asianLow || asianHigh === 0 || asianLow === 0) {
      projected_targets = {
        asian_range_size: null,
        upward_dev_1_5: null,
        upward_dev_2_0: null,
        upward_dev_2_5: null,
        downward_dev_1_5: null,
        downward_dev_2_0: null,
        downward_dev_2_5: null,
      };
    } else {
      const range = asianHigh - asianLow;
      projected_targets = {
        asian_range_size: parseFloat(range.toFixed(4)),
        upward_dev_1_5: parseFloat((asianHigh + range * 1.5).toFixed(2)),
        upward_dev_2_0: parseFloat((asianHigh + range * 2.0).toFixed(2)),
        upward_dev_2_5: parseFloat((asianHigh + range * 2.5).toFixed(2)),
        downward_dev_1_5: parseFloat((asianLow - range * 1.5).toFixed(2)),
        downward_dev_2_0: parseFloat((asianLow - range * 2.0).toFixed(2)),
        downward_dev_2_5: parseFloat((asianLow - range * 2.5).toFixed(2)),
      };
    }

    // 9. Killzone Clock (Current Time Window - UTC hours)
    const getCurrentKillzone = () => {
      const now = new Date();
      
      // NY Lunch Dead Zone Preemption (12:00 PM – 1:30 PM New York Time)
      const nyTimeStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
      const nyDate = new Date(nyTimeStr);
      const nyHour = nyDate.getHours();
      const nyMin = nyDate.getMinutes();
      if (nyHour === 12 || (nyHour === 13 && nyMin <= 30)) {
        return "DEAD_ZONE";
      }

      const hour = now.getUTCHours();

      if (hour >= 0 && hour <= 3) return "ASIAN_RANGE";
      if (hour >= 6 && hour <= 8) return "LONDON_AM_KILLZONE";
      if (hour >= 12 && hour <= 14) return "NY_AM_KILLZONE";
      if (hour >= 17 && hour <= 18) return "NY_PM_KILLZONE";
      return "DEAD_ZONE";
    };

    // 11. Local Dealing Range & Dual-Pricing Context (V8.2)
    const todayDayStr = `${currentYear}-${currentMonth}-${currentDate}`;

    // Filter intraday candles: same calendar day starting at 00:00 UTC
    const intradayCandles = candles15m.filter(c => {
      const d = new Date(c.t);
      const candleDayStr = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
      return candleDayStr === todayDayStr;
    });

    let pricing_context: {
      vs_daily_open: string;
      local_dealing_range: {
        high: number | string;
        low: number | string;
        equilibrium: number | string;
        current_status: string;
        anchor_high_swing?: any;
        anchor_low_swing?: any;
      };
      distance_to_PWH: number | null;
      distance_to_PWL: number | null;
      distance_to_PMH: number | null;
      distance_to_PML: number | null;
      distance_to_nearest_daily_sibi: number | null;
      distance_to_nearest_daily_bisi: number | null;
      nearest_htf_magnet: {
        label: string;
        distance: number;
      } | null;
    };



    // Ensure resting_liquidity_pools are dynamically populated and scaled if empty/failed
    if (!resting_liquidity_pools || !resting_liquidity_pools.BSL_Magnets || resting_liquidity_pools.BSL_Magnets.length === 0) {
      resting_liquidity_pools = {
        BSL_Magnets: [
          parseFloat((currentLivePrice * 1.006).toFixed(2)),
          parseFloat((currentLivePrice * 1.012).toFixed(2)),
          parseFloat((currentLivePrice * 1.018).toFixed(2))
        ],
        SSL_Magnets: resting_liquidity_pools?.SSL_Magnets || []
      };
    }
    if (!resting_liquidity_pools.SSL_Magnets || resting_liquidity_pools.SSL_Magnets.length === 0) {
      resting_liquidity_pools = {
        BSL_Magnets: resting_liquidity_pools.BSL_Magnets,
        SSL_Magnets: [
          parseFloat((currentLivePrice * 0.994).toFixed(2)),
          parseFloat((currentLivePrice * 0.988).toFixed(2)),
          parseFloat((currentLivePrice * 0.982).toFixed(2))
        ]
      };
    }

    const distance_to_PWH = pwh !== null ? parseFloat(Math.abs(pwh - currentLivePrice).toFixed(2)) : null;
    const distance_to_PWL = pwl !== null ? parseFloat(Math.abs(pwl - currentLivePrice).toFixed(2)) : null;
    const distance_to_PMH = pmh !== null ? parseFloat(Math.abs(pmh - currentLivePrice).toFixed(2)) : null;
    const distance_to_PML = pml !== null ? parseFloat(Math.abs(pml - currentLivePrice).toFixed(2)) : null;

    const nearestSibiPrice = sibisAbove.length > 0 ? sibisAbove[0].coordinates.bottom : null;
    const nearestBisiPrice = bisiBelow.length > 0 ? bisiBelow[0].coordinates.top : null;
    const distance_to_nearest_daily_sibi = nearestSibiPrice !== null ? parseFloat(Math.abs(nearestSibiPrice - currentLivePrice).toFixed(2)) : null;
    const distance_to_nearest_daily_bisi = nearestBisiPrice !== null ? parseFloat(Math.abs(nearestBisiPrice - currentLivePrice).toFixed(2)) : null;

    const allHtfDistances = [
      { label: 'PWH', val: distance_to_PWH },
      { label: 'PWL', val: distance_to_PWL },
      { label: 'PMH', val: distance_to_PMH },
      { label: 'PML', val: distance_to_PML },
      { label: 'DAILY_SIBI', val: distance_to_nearest_daily_sibi },
      { label: 'DAILY_BISI', val: distance_to_nearest_daily_bisi }
    ].filter((d): d is { label: string; val: number } => d.val !== null);

    const nearestHtfMagnet = allHtfDistances.length > 0
      ? allHtfDistances.reduce((min, cur) => (cur.val! < min.val! ? cur : min), allHtfDistances[0])
      : null;

    const pricing_context_addon = {
      distance_to_PWH,
      distance_to_PWL,
      distance_to_PMH,
      distance_to_PML,
      distance_to_nearest_daily_sibi,
      distance_to_nearest_daily_bisi,
      nearest_htf_magnet: nearestHtfMagnet ? {
        label: nearestHtfMagnet.label,
        distance: nearestHtfMagnet.val
      } : null
    };

    // ── Server-Side "Lazy Exit" Logic (Phase 3) ─────────────────────────────
    if (!isPoll) {
      try {
        const openTradesRes = await sql`
          SELECT * FROM paper_trades WHERE status = 'OPEN'
        `;
        
        if (openTradesRes.rows.length > 0) {
          let userEmail = "default_user";
          try {
            const session = await auth();
            if (session?.user?.email) {
              userEmail = session.user.email;
            }
          } catch (sessErr) {
            console.warn("[LAZY EXIT] Auth session lookup skipped/failed:", sessErr);
          }

          for (const trade of openTradesRes.rows) {
            const entryPrice = parseFloat(trade.entry_price);
            const stopLoss = parseFloat(trade.stop_loss);
            const takeProfit = parseFloat(trade.take_profit);
            const direction = trade.direction;
            const positionSize = parseFloat(trade.position_size ?? 1.0);
            const rawRiskAmountUsd = trade.risk_amount_usd !== null && trade.risk_amount_usd !== undefined ? parseFloat(trade.risk_amount_usd) : 0;
            const riskAmountUsd = rawRiskAmountUsd > 0 ? rawRiskAmountUsd : Math.abs(entryPrice - stopLoss) * positionSize;

            let isBreached = false;
            let exitPrice = entryPrice;

            if (direction === "LONG") {
              if (currentLivePrice >= takeProfit) {
                isBreached = true;
                exitPrice = takeProfit;
              } else if (currentLivePrice <= stopLoss) {
                isBreached = true;
                exitPrice = stopLoss;
              }
            } else if (direction === "SHORT") {
              if (currentLivePrice <= takeProfit) {
                isBreached = true;
                exitPrice = takeProfit;
              } else if (currentLivePrice >= stopLoss) {
                isBreached = true;
                exitPrice = stopLoss;
              }
            }

            if (isBreached) {
              // Calculate Realized P&L and ROI
              let realized_pnl = direction === "LONG"
                ? (exitPrice - entryPrice) * positionSize
                : (entryPrice - exitPrice) * positionSize;

              let roi = riskAmountUsd > 0
                ? (realized_pnl / riskAmountUsd) * 100
                : 0;

              exitPrice = parseFloat(exitPrice.toFixed(4));
              realized_pnl = parseFloat(realized_pnl.toFixed(4));
              roi = parseFloat(roi.toFixed(4));

              console.log(`[LAZY EXIT] Breach detected for trade ${trade.id} (${direction}). Auto-closing at ${exitPrice}. Realized P&L: $${realized_pnl}`);

              // Update trade status to CLOSED in the database
              await sql`
                UPDATE paper_trades
                SET status = 'CLOSED',
                    exit_price = ${exitPrice},
                    realized_pnl = ${realized_pnl},
                    roi = ${roi}
                WHERE id = ${trade.id}
              `;

              // Recalculate account balance from scratch to prevent ghost PnL drift
              let initialCapital = 10000.0000;
              const accountCapRes = await sql`
                SELECT initial_capital FROM trading_account WHERE user_id = ${userEmail}
              `;
              if (accountCapRes.rows.length === 0) {
                // Seed the account with $10,000 if it does not exist yet
                await sql`
                  INSERT INTO trading_account (user_id, current_balance, initial_capital, max_risk_limit_pct)
                  VALUES (${userEmail}, 10000.0000, 10000.0000, 3.00)
                `;
              } else {
                initialCapital = parseFloat(String(accountCapRes.rows[0].initial_capital));
              }

              const pnlSumRes = await sql`
                SELECT COALESCE(SUM(realized_pnl), 0) AS total_realized_pnl
                FROM paper_trades
                WHERE status = 'CLOSED'
              `;
              const totalRealizedPnl = parseFloat(String(pnlSumRes.rows[0].total_realized_pnl));
              const newBalance = parseFloat((initialCapital + totalRealizedPnl).toFixed(4));

              await sql`
                UPDATE trading_account
                SET current_balance = ${newBalance}, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ${userEmail}
              `;
              console.log(`[LAZY EXIT] Account balance updated for ${userEmail}: $${newBalance}`);
            }
          }
        }
      } catch (lazyExitError: any) {
        console.error(`[LAZY EXIT ERROR] Failed to execute server-side trade monitoring: ${lazyExitError.message || lazyExitError}`);
      }
    }

    // Explicitly define stat_payload with at least 200 candles matching the requested visual interval to ensure OLS significance and prevent multi-timeframe leak
    let stat_payload = candles15m.slice(-200);
    let activeCandlesForStructure = candles15m;

    if (visualInterval === '5m') {
      stat_payload = candles5m.slice(-200);
      activeCandlesForStructure = candles5m;
    } else if (visualInterval === '1h') {
      stat_payload = candles1h.slice(-200);
      activeCandlesForStructure = candles1h;
    } else if (visualInterval === '4h') {
      stat_payload = candles4h.slice(-200);
      activeCandlesForStructure = candles4h;
    } else if (visualInterval === '15m') {
      stat_payload = candles15m.slice(-200);
      activeCandlesForStructure = candles15m;
    } else if (!isStandardInterval && dynamicVisualCandles && dynamicVisualCandles.length > 0) {
      stat_payload = dynamicVisualCandles.slice(-200);
      activeCandlesForStructure = dynamicVisualCandles;
    }

    const institutional_sponsorship = await verifyDisplacement(stat_payload, symbol);

    // V10.19 — Centralized Stateful Market Structure Analysis via structureEngine (Fully Isolated per timeframe)
    let structureAnalysis: any = {
      market_structure_shift: false,
      market_structure_shift_direction: null,
      currentTrend: 'UNSET',
      internalTrend: 'UNSET',
      internal_market_structure_shift: false,
      expansion_mode: 'NORMAL',
      market_velocity: 0,
      runaway_origin_price: null,
      dealingRange: {
        high: 0,
        low: 0,
        equilibrium: 0,
        current_status: 'UNKNOWN',
        anchor_high_swing: null,
        anchor_low_swing: null,
        profile_metrics: null
      },
      internalDealingRange: null,
      swing_points: [],
      structural_events: [],
      swings: [],
      zigzag: []
    };

    if (includeStructure) {
      structureAnalysis = analyzeMarketStructureStateful(symbol, visualInterval, activeCandlesForStructure, currentLivePrice, institutional_sponsorship, isInit);
    }
    const localDealingRange = structureAnalysis.dealingRange;

    const internal_dealing_range = structureAnalysis.internalDealingRange || {
      high: 0,
      low: 0,
      equilibrium: 0,
      current_status: 'UNKNOWN',
      anchor_high_swing: null,
      anchor_low_swing: null
    };

    // Anti-corruption safety clamps inside the serialization routing layer
    if (
      typeof internal_dealing_range.low === 'number' &&
      typeof localDealingRange.low === 'number' &&
      internal_dealing_range.low < localDealingRange.low
    ) {
      internal_dealing_range.low = localDealingRange.low;
      internal_dealing_range.anchor_low_swing = localDealingRange.anchor_low_swing;
    }
    if (
      typeof internal_dealing_range.high === 'number' &&
      typeof localDealingRange.high === 'number' &&
      internal_dealing_range.high > localDealingRange.high
    ) {
      internal_dealing_range.high = localDealingRange.high;
      internal_dealing_range.anchor_high_swing = localDealingRange.anchor_high_swing;
    }
    if (
      typeof internal_dealing_range.high === 'number' &&
      typeof internal_dealing_range.low === 'number'
    ) {
      internal_dealing_range.equilibrium = parseFloat(((internal_dealing_range.high + internal_dealing_range.low) / 2).toFixed(2));
      internal_dealing_range.current_status = currentLivePrice > internal_dealing_range.equilibrium ? 'PREMIUM' : 'DISCOUNT';
    }

    const internal_context = {
      trend: structureAnalysis.internalTrend || 'UNSET',
      high: internal_dealing_range.high,
      low: internal_dealing_range.low,
      equilibrium: internal_dealing_range.equilibrium,
      pricing_status: internal_dealing_range.current_status,
      anchor_high_swing: internal_dealing_range.anchor_high_swing,
      anchor_low_swing: internal_dealing_range.anchor_low_swing
    };

    pricing_context = {
      vs_daily_open: (rangeEq > 0)
        ? (currentLivePrice > rangeEq ? "ABOVE_EQUILIBRIUM" : "BELOW_EQUILIBRIUM")
        : "UNKNOWN",
      local_dealing_range: localDealingRange,
      ...pricing_context_addon
    };

    // Resolve Triple-Vector Macro Daily Bias
    const activeSwingPOC = structureAnalysis.dealingRange.profile_metrics?.poc ?? null;
    const resolvedBias = resolveTripleVectorBias({
      livePrice: currentLivePrice,
      nearest_htf_magnet: pricing_context_addon.nearest_htf_magnet,
      activeSwingPOC,
      liquidation_status: liquidation_events.status,
      target_status
    });

    const fvgGroups = [
      { fvgs: detectActiveFVGs(candles5m, true), timeframe: '5m' },
      { fvgs: detectActiveFVGs(candles15m, true), timeframe: '15m' },
      { fvgs: detectActiveFVGs(candles1h, true), timeframe: '1h' },
      { fvgs: detectActiveFVGs(candles4h, true), timeframe: '4h' },
    ];

    const allFvgGroups = [
      { fvgs: detectActiveFVGs(candles5m, false), timeframe: '5m' },
      { fvgs: detectActiveFVGs(candles15m, false), timeframe: '15m' },
      { fvgs: detectActiveFVGs(candles1h, false), timeframe: '1h' },
      { fvgs: detectActiveFVGs(candles4h, false), timeframe: '4h' },
    ];

    if (includeFvg && !isStandardInterval && dynamicVisualCandles && dynamicVisualCandles.length > 0) {
      fvgGroups.push({ fvgs: detectActiveFVGs(dynamicVisualCandles, true), timeframe: visualInterval });
      allFvgGroups.push({ fvgs: detectActiveFVGs(dynamicVisualCandles, false), timeframe: visualInterval });
    }

    const active_fvgs = mapAndConsolidateFVGs(fvgGroups);
    const all_fvgs = mapAndConsolidateFVGs(allFvgGroups);
    const pending_fvgs = all_fvgs.filter(fvg => fvg.status === 'PENDING');
    
    const current_time_window = getCurrentKillzone();

    const trade_execution_parameters = generateTradeExecutionParameters(
      target_status,
      current_time_window,
      institutional_sponsorship,
      currentLivePrice,
      active_fvgs,
      resting_liquidity_pools,
      stat_payload
    );

    // Calculate SMT context using the new SMT Detection Engine
    const btcPrice = candlesBtc5m.length > 0 ? candlesBtc5m[candlesBtc5m.length - 1].c : 0;
    if (!isOffline && btcPrice > 0) {
      LAST_KNOWN_PRICES.set('BTCUSDT', btcPrice);
    }
    // Use previous 15m close as performance anchor (replaces True Day Open)
    const ethPrevClose = candles15m.length > 1 ? candles15m[candles15m.length - 2].c : null;
    const btcPrevClose = candlesBtc15m.length > 1 ? candlesBtc15m[candlesBtc15m.length - 2].c : null;
    const smt_context = getSmtContext({
      ethCandles5m: candles5m,
      btcCandles5m: candlesBtc5m,
      ethCandles15m: candles15m,
      btcCandles15m: candlesBtc15m,
      ethPrice: currentLivePrice,
      ethPrevClose,
      ethPdh: pdh,
      ethPdl: pdl,
      btcPrice,
      btcPrevClose,
      btcHigh1h: btcPdh,
      btcLow1h: btcPdl,
      btcPdh,
      btcPdl,
    });

    const ipda_metrics = {
      current_time_window,
      institutional_sponsorship,
      current_pricing,
      target_status,
      macro_daily_bias: resolvedBias,
      // V10.13 — Market Structure Shift fields from centralized engine
      market_structure_shift: structureAnalysis.market_structure_shift,
      market_structure_shift_direction: structureAnalysis.market_structure_shift_direction,
      current_trend: structureAnalysis.currentTrend,
      internal_market_trend: structureAnalysis.internalTrend || 'UNSET',
      internal_structure_shift: structureAnalysis.internal_market_structure_shift === true,
      internal_context,
      expansion_mode: structureAnalysis.expansion_mode || 'NORMAL',
      market_velocity: structureAnalysis.market_velocity || 0,
      runaway_origin_price: structureAnalysis.runaway_origin_price || null,
      // ─── Expansion Telemetry (Dynamic Range Freeze Resolution) ─────────────
      is_in_expansion: structureAnalysis.is_in_expansion || false,
      expansion_high_float: structureAnalysis.expansion_high_float ?? null,
      expansion_low_float: structureAnalysis.expansion_low_float ?? null,
      full_structure_map: {
        swing_points: structureAnalysis.swing_points,
        structural_events: structureAnalysis.structural_events,
        swings: structureAnalysis.swings,
        zigzag: structureAnalysis.zigzag,
        innerSwings: structureAnalysis.innerSwings || [],
        innerZigzag: structureAnalysis.innerZigzag || [],
        currentTrend: structureAnalysis.currentTrend,
        subTrend: structureAnalysis.subTrend || 'UNSET',
        dealingRange: structureAnalysis.dealingRange,
        internalTrend: structureAnalysis.internalTrend || 'UNSET',
        internalZigzag: structureAnalysis.internalZigzag || [],
        latestInternalMSS: structureAnalysis.latestInternalMSS || null,
        internal_market_structure_shift: structureAnalysis.internal_market_structure_shift === true,
        internalDealingRange: internal_dealing_range,
        latestMSS: structureAnalysis.latestMSS || null,
        market_structure_shift: structureAnalysis.market_structure_shift || false,
        market_structure_shift_direction: structureAnalysis.market_structure_shift_direction || null,
        // Expansion fields for chart layer consumption
        expansion_mode: structureAnalysis.expansion_mode || 'NORMAL',
        is_in_expansion: structureAnalysis.is_in_expansion || false,
        expansion_high_float: structureAnalysis.expansion_high_float ?? null,
        expansion_low_float: structureAnalysis.expansion_low_float ?? null,
        market_velocity: structureAnalysis.market_velocity || 0,
      },
      global_anchors: {
        high: localDealingRange.high,
        low: localDealingRange.low,
        equilibrium: localDealingRange.equilibrium,
        current_status: localDealingRange.current_status,
        anchor_high_swing: localDealingRange.anchor_high_swing,
        anchor_low_swing: localDealingRange.anchor_low_swing,
        current_trend: structureAnalysis.currentTrend,
        sub_trend: structureAnalysis.subTrend || 'UNSET'
      },
      macro_levels: {
        pdh,
        pdl,
        asian_high: asianLiquidity.high,
        asian_low: asianLiquidity.low
      },
      session_ranges: {
        asian_range: asianLiquidity,
        london_range: londonLiquidity
      },
      historical_magnets,
      macro_structural_magnets,
      projected_targets,
      smt_traps,
      pricing_context,
      order_flow_engine: (() => {
        // Bootstrap in-memory state tracking if needed
        const primaryCandles = candles15m.length > 0 ? candles15m : candles5m;
        const currentCandleT = primaryCandles.length > 0 ? primaryCandles[primaryCandles.length - 1].t : undefined;
        OrderFlowStateTracker.bootstrapFromCandles(symbol, primaryCandles);
        const state_timeline = OrderFlowStateTracker.updateLiveState(
          symbol,
          open_interest_trend,
          latestCandleFromAny ? latestCandleFromAny.t : Date.now(),
          currentLivePrice,
          {
            displacement_status: institutional_sponsorship.status,
            liquidation_status: liquidation_events.status,
          },
          currentCandleT
        );
        return {
          open_interest_trend,
          displacement_sponsorship: institutional_sponsorship.status !== "INACTIVE" ? "ACTIVE" : "INACTIVE",
          resting_liquidity_pools,
          liquidation_events,
          smart_money_sentiment,
          state_timeline,
        };
      })(),
      active_fvgs,
      pending_fvgs,
      trade_execution_parameters,
      smt_context, // Injected V8.7 SMT Context
    };

    const risk_management = calculateDynamicRisk(
      currentLivePrice,
      target_status,
      pdh,
      pdl,
      liquidation_events.status
    );

    if (isPoll) {
      const activeKey = `candles_${visualInterval}`;
      const activeCandles = activeKey === 'candles_5m' ? candles5m :
                            activeKey === 'candles_15m' ? candles15m :
                            activeKey === 'candles_1h' ? candles1h :
                            activeKey === 'candles_4h' ? candles4h : dynamicVisualCandles;

      // Annotate delta candles before slicing
      annotateCandlesWithVolumetricSignals(activeCandles);

      const state_timeline = OrderFlowStateTracker.getTimelineSummary(symbol);

      const deltaPayload = {
        isDelta: true,
        timestamp: new Date().toISOString(),
        open_interest: parseFloat(dataOi.openInterest),
        risk_management: null, // Bypassed for delta tick to let client preserve risk settings
        correlation_data: {
          btc_live_price: btcPrice,
        },
        delta_candles: activeCandles.slice(-5), // Only the last 5 active timeframe candles
        order_flow_engine: {
          open_interest_trend,
          resting_liquidity_pools,
          liquidation_events,
          smart_money_sentiment,
          state_timeline,
        },
      };

      return NextResponse.json(deltaPayload);
    }

    // Annotate historical candle arrays with volumetric signal highlights before slicing
    annotateCandlesWithVolumetricSignals(candles4h);
    annotateCandlesWithVolumetricSignals(candles1h);
    annotateCandlesWithVolumetricSignals(candles15m);
    annotateCandlesWithVolumetricSignals(candles5m);
    if (!isStandardInterval && dynamicVisualCandles && dynamicVisualCandles.length > 0) {
      annotateCandlesWithVolumetricSignals(dynamicVisualCandles);
    }

    const payload = {
      ticker: "ETHUSDC.p",
      timestamp: new Date().toISOString(),
      timezone: "UTC",
      candles_limit: visualLimit,
      ipda_metrics,
      risk_management,
      open_interest: parseFloat(dataOi.openInterest),
      correlation_data: {
        btc_live_price: btcPrice,
        btc_pdh: btcPdh,
        btc_pdl: btcPdl,
        btc_candles_5m: candlesBtc5m.slice(-20),
        btc_candles_15m: candlesBtc15m.slice(-20),
      },
      // V6 Naked payload — OHLCV only, no HTF arrays, no calculations
      data_payload: {
        candles_4h: limit4h > 0 ? candles4h.slice(-limit4h) : [],
        candles_1h: limit1h > 0 ? candles1h.slice(-limit1h) : [],
        candles_15m: limit15m > 0 ? candles15m.slice(-limit15m) : [],
        candles_5m: limit5m > 0 ? candles5m.slice(-limit5m) : [],
        ...(!isStandardInterval ? { [`candles_${visualInterval}`]: dynamicVisualCandles } : {}),
      },
    };

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error(`Error fetching market data: ${error.message || error}`);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
