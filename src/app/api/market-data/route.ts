import { NextResponse } from 'next/server';
import { fetchRestingLiquidity, fetchOIMetricsAndLiquidations, fetchSmartMoneySentiment } from '@/lib/orderFlowEngine';
import { detectActiveFVGs, mapAndConsolidateFVGs } from '@/lib/fvgEngine';
import { verifyDisplacement } from '@/lib/displacementEngine';
import { calculateDynamicRisk } from '@/lib/riskEngine';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get('symbol') || 'ETHUSDC';
    const limit5m = parseInt(url.searchParams.get('limit5m') || '100', 10);
    const limit15m = parseInt(url.searchParams.get('limit15m') || '100', 10);
    const limit1h = parseInt(url.searchParams.get('limit1h') || '50', 10);
    const limit4h = parseInt(url.searchParams.get('limit4h') || '50', 10);
    const limit = 350;

    const urls = {
      '5m': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=5m&limit=${limit}`,
      '15m': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=${limit}`,
      '1h': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=${limit}`,
      '4h': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=4h&limit=${limit}`,
      // HTF — fetched for background calculations only, NEVER exposed in data_payload
      '1d': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=100`,
      '1w': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1w&limit=100`,
      'openInterest': `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`,
    };

    const restingLiquidityPromise = fetchRestingLiquidity(symbol);
    const smartMoneyPromise = fetchSmartMoneySentiment(symbol);

    const [res5m, res15m, res1h, res4h, res1d, res1w, resOi] = await Promise.all([
      fetch(urls['5m']),
      fetch(urls['15m']),
      fetch(urls['1h']),
      fetch(urls['4h']),
      fetch(urls['1d']),
      fetch(urls['1w']),
      fetch(urls['openInterest']),
    ]);

    if (!res5m.ok || !res15m.ok || !res1h.ok || !res4h.ok || !res1d.ok || !res1w.ok || !resOi.ok) {
      const errorText = await res5m.text();
      console.error('Binance API Error:', {
        status5m: res5m.status,
        status15m: res15m.status,
        status1h: res1h.status,
        status4h: res4h.status,
        status1d: res1d.status,
        status1w: res1w.status,
        statusOi: resOi.status,
        response: errorText
      });
      throw new Error('Failed to fetch from Binance API');
    }

    const [data5m, data15m, data1h, data4h, data1d, data1w, dataOi, resting_liquidity_pools, smart_money_sentiment] = await Promise.all([
      res5m.json(),
      res15m.json(),
      res1h.json(),
      res4h.json(),
      res1d.json(),
      res1w.json(),
      resOi.json(),
      restingLiquidityPromise,
      smartMoneyPromise,
    ]);

    const utcPlus3OffsetMs = 3 * 60 * 60 * 1000;
    const formatCandles = (data: any[]) => {
      return data.map((c) => {
        const v = parseFloat(c[5]);
        const taker_buy_vol = parseFloat(c[9]);
        const taker_sell_vol = v - taker_buy_vol;
        return {
          t: c[0] + utcPlus3OffsetMs,
          o: parseFloat(c[1]),
          h: parseFloat(c[2]),
          l: parseFloat(c[3]),
          c: parseFloat(c[4]),
          v: v,
          taker_buy_vol,
          taker_sell_vol,
        };
      });
    };

    const candles4h = formatCandles(data4h);
    const candles1h = formatCandles(data1h);
    const candles15m = formatCandles(data15m);
    const candles5m = formatCandles(data5m);
    // HTF — kept in local scope only; NEVER added to data_payload
    const candles1d = formatCandles(data1d);
    const candles1w = formatCandles(data1w);

    const isPriceRising = candles15m.length > 1 && candles15m[candles15m.length - 1].c > candles15m[candles15m.length - 2].c;
    const { open_interest_trend, liquidation_events } = await fetchOIMetricsAndLiquidations(symbol, isPriceRising);

    // 1. Macro Context
    const lastCandle = candles1h[candles1h.length - 1];
    const lastDate = new Date(lastCandle.t);
    const currentYear = lastDate.getUTCFullYear();
    const currentMonth = lastDate.getUTCMonth();
    const currentDate = lastDate.getUTCDate();

    const previousDayDate = new Date(Date.UTC(currentYear, currentMonth, currentDate - 1));
    const prevYear = previousDayDate.getUTCFullYear();
    const prevMonth = previousDayDate.getUTCMonth();
    const prevDate = previousDayDate.getUTCDate();

    let pdh = 0;
    let pdl = Infinity;
    candles1h.forEach(c => {
      const d = new Date(c.t);
      if (d.getUTCFullYear() === prevYear && d.getUTCMonth() === prevMonth && d.getUTCDate() === prevDate) {
        if (c.h > pdh) pdh = c.h;
        if (c.l < pdl) pdl = c.l;
      }
    });
    if (pdl === Infinity) pdl = 0;

    // 2. Target Exhaustion
    let target_status = "PENDING";
    const last3_15m = candles15m.slice(-3);
    for (const c of last3_15m) {
      if (c.h >= pdh || c.l <= pdl) {
        target_status = "EXHAUSTED";
        break;
      }
    }

    // 3. Killzone Stepped Liquidity (UTC+3)
    const getSessionLiquidity = (candles: any[], startHour: number, endHour: number) => {
      const sessionCandles = candles.filter(c => {
        const h = new Date(c.t).getUTCHours();
        return h >= startHour && h < endHour;
      });

      if (sessionCandles.length === 0) return { high: null, low: null };

      const latestSessionDate = new Date(sessionCandles[sessionCandles.length - 1].t).toDateString();
      const latestSessionCandles = sessionCandles.filter(c => new Date(c.t).toDateString() === latestSessionDate);

      return {
        high: Math.max(...latestSessionCandles.map(c => c.h)),
        low: Math.min(...latestSessionCandles.map(c => c.l))
      };
    };

    const asianLiquidity = getSessionLiquidity(candles15m, 3, 7);
    const londonLiquidity = getSessionLiquidity(candles15m, 9, 12);

    // 5. True Day Open (07:00 Anchor)
    let true_day_open_0700: number | null = null;
    for (let i = candles15m.length - 1; i >= 0; i--) {
      const d = new Date(candles15m[i].t);
      if (d.getUTCHours() === 7 && d.getUTCMinutes() === 0) {
        true_day_open_0700 = candles15m[i].o;
        break;
      }
    }

    let current_pricing = "UNKNOWN";
    if (true_day_open_0700 !== null && candles5m.length > 0) {
      const livePrice = candles5m[candles5m.length - 1].c;
      if (livePrice > true_day_open_0700) {
        current_pricing = "PREMIUM";
      } else if (livePrice < true_day_open_0700) {
        current_pricing = "DISCOUNT";
      } else {
        current_pricing = "FAIR_VALUE";
      }
    }

    // 4. SMT/Equal Highs Detector
    const scanWindow = candles15m.slice(-20);
    const swingHighs: { index: number, price: number, time: number }[] = [];
    for (let i = 1; i < scanWindow.length - 1; i++) {
      const prev = scanWindow[i - 1];
      const curr = scanWindow[i];
      const next = scanWindow[i + 1];
      if (curr.h > prev.h && curr.h > next.h) {
        swingHighs.push({ index: i, price: curr.h, time: curr.t });
      }
    }

    const smt_traps = [];
    for (let i = 0; i < swingHighs.length; i++) {
      for (let j = i + 1; j < swingHighs.length; j++) {
        if (Math.abs(swingHighs[i].price - swingHighs[j].price) <= 0.50) {
          smt_traps.push({
            type: "engineered_liquidity",
            price: parseFloat(((swingHighs[i].price + swingHighs[j].price) / 2).toFixed(2)),
            time1: swingHighs[i].time,
            time2: swingHighs[j].time,
          });
        }
      }
    }

    // 7. Historical Magnets Scanner (HTF — 1w / 1d)
    const livePrice = candles5m[candles5m.length - 1].c;

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

    const historical_magnets = {
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

    // 9. Killzone Clock (Current Time Window)
    const getCurrentKillzone = () => {
      const now = new Date();
      const shiftedTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
      const hour = shiftedTime.getUTCHours();

      if (hour >= 3 && hour <= 6) return "ASIAN_RANGE";
      if (hour >= 9 && hour <= 11) return "LONDON_AM_KILLZONE";
      if (hour >= 15 && hour <= 17) return "NY_AM_KILLZONE";
      if (hour >= 20 && hour <= 21) return "NY_PM_KILLZONE";
      return "DEAD_ZONE";
    };

    // 11. Local Dealing Range & Dual-Pricing Context (V8.0)
    //     c.t already has +3h baked in, so getUTCHours() reads Cairo local time.
    const todayCairo = new Date(lastCandle.t); // reference from last 1h candle
    const todayDayStr = `${todayCairo.getUTCFullYear()}-${todayCairo.getUTCMonth()}-${todayCairo.getUTCDate()}`;

    // Filter intraday candles: same calendar day AND at or after 07:00 Cairo
    const intradayCandles = candles15m.filter(c => {
      const d = new Date(c.t);
      const candleDayStr = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
      const candleHour = d.getUTCHours();
      const candleMin = d.getUTCMinutes();
      return candleDayStr === todayDayStr && (candleHour > 7 || (candleHour === 7 && candleMin === 0));
    });

    let pricing_context: {
      vs_daily_open: string;
      local_dealing_range: {
        high: number;
        low: number;
        equilibrium: number;
        current_status: string;
      };
    };

    const currentLivePrice = candles5m[candles5m.length - 1].c;

    if (intradayCandles.length > 0) {
      const intradayHigh = parseFloat(Math.max(...intradayCandles.map(c => c.h)).toFixed(2));
      const intradayLow = parseFloat(Math.min(...intradayCandles.map(c => c.l)).toFixed(2));
      const equilibrium = parseFloat(((intradayHigh + intradayLow) / 2).toFixed(2));

      pricing_context = {
        vs_daily_open: (true_day_open_0700 !== null)
          ? (currentLivePrice > true_day_open_0700 ? "ABOVE_OPEN" : "BELOW_OPEN")
          : "UNKNOWN",
        local_dealing_range: {
          high: intradayHigh,
          low: intradayLow,
          equilibrium,
          current_status: currentLivePrice > equilibrium ? "PREMIUM" : "DISCOUNT",
        },
      };
    } else {
      // Edge-case: exactly 07:00 and no range has formed yet — seed from the 07:00 candle itself
      const anchorCandle = candles15m.find(c => {
        const d = new Date(c.t);
        const candleDayStr = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
        return candleDayStr === todayDayStr && d.getUTCHours() === 7 && d.getUTCMinutes() === 0;
      });

      if (anchorCandle) {
        const seedHigh = parseFloat(anchorCandle.h.toFixed(2));
        const seedLow = parseFloat(anchorCandle.l.toFixed(2));
        const seedEquil = parseFloat(((seedHigh + seedLow) / 2).toFixed(2));
        pricing_context = {
          vs_daily_open: (true_day_open_0700 !== null)
            ? (currentLivePrice > true_day_open_0700 ? "ABOVE_OPEN" : "BELOW_OPEN")
            : "UNKNOWN",
          local_dealing_range: {
            high: seedHigh,
            low: seedLow,
            equilibrium: seedEquil,
            current_status: currentLivePrice > seedEquil ? "PREMIUM" : "DISCOUNT",
          },
        };
      } else {
        // Pre-open: no 07:00 candle exists yet
        pricing_context = {
          vs_daily_open: "UNKNOWN",
          local_dealing_range: {
            high: currentLivePrice,
            low: currentLivePrice,
            equilibrium: currentLivePrice,
            current_status: "FAIR_VALUE",
          },
        };
      }
    }

    const ipda_metrics = {
      true_day_open: true_day_open_0700,
      current_time_window: getCurrentKillzone(),
      institutional_sponsorship: verifyDisplacement(candles15m),
      current_pricing,
      target_status,
      macro_levels: { pdh, pdl },
      historical_magnets,
      projected_targets,
      smt_traps,
      pricing_context,
      order_flow_engine: {
        open_interest_trend,
        displacement_sponsorship: verifyDisplacement(candles15m).status !== "INACTIVE" ? "ACTIVE" : "INACTIVE",
        resting_liquidity_pools,
        liquidation_events,
        smart_money_sentiment,
      },
      active_fvgs: mapAndConsolidateFVGs(detectActiveFVGs(candles15m), detectActiveFVGs(candles5m))
    };



    const risk_management = calculateDynamicRisk(
      currentLivePrice,
      target_status,
      pdh,
      pdl,
      liquidation_events.status
    );

    const payload = {
      ticker: "ETHUSDC.p",
      timestamp: new Date().toISOString(),
      timezone: "UTC+3",
      ipda_metrics,
      risk_management,
      open_interest: parseFloat(dataOi.openInterest),
      // V6 Naked payload — OHLCV only, no HTF arrays, no calculations
      data_payload: {
        candles_4h: limit4h > 0 ? candles4h.slice(-limit4h) : [],
        candles_1h: limit1h > 0 ? candles1h.slice(-limit1h) : [],
        candles_15m: limit15m > 0 ? candles15m.slice(-limit15m) : [],
        candles_5m: limit5m > 0 ? candles5m.slice(-limit5m) : [],
      },
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error fetching market data:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
