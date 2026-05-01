import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const symbol = 'ETHUSDC';
    const limit = 350;

    const urls = {
      '5m': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=5m&limit=${limit}`,
      '15m': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=${limit}`,
      '1h': `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=${limit}`,
      'openInterest': `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`,
    };

    const [res5m, res15m, res1h, resOi] = await Promise.all([
      fetch(urls['5m']),
      fetch(urls['15m']),
      fetch(urls['1h']),
      fetch(urls['openInterest']),
    ]);

    if (!res5m.ok || !res15m.ok || !res1h.ok || !resOi.ok) {
      const errorText = await res5m.text();
      console.error('Binance API Error:', {
        status5m: res5m.status,
        status15m: res15m.status,
        status1h: res1h.status,
        statusOi: resOi.status,
        response: errorText
      });
      throw new Error('Failed to fetch from Binance API');
    }

    const [data5m, data15m, data1h, dataOi] = await Promise.all([
      res5m.json(),
      res15m.json(),
      res1h.json(),
      resOi.json(),
    ]);

    const utcPlus3OffsetMs = 3 * 60 * 60 * 1000;
    const formatCandles = (data: any[]) => {
      return data.map((c) => ({
        t: c[0] + utcPlus3OffsetMs,
        o: parseFloat(c[1]),
        h: parseFloat(c[2]),
        l: parseFloat(c[3]),
        c: parseFloat(c[4]),
        v: parseFloat(c[5]),
      }));
    };

    const candles1h = formatCandles(data1h);
    const candles15m = formatCandles(data15m);
    const candles5m = formatCandles(data5m);

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

    // 6. Unmitigated FVG Scanner (V7.5 Enriched Only)
    const findUnmitigatedFVGs = (candles: any[]) => {
      const active_fvgs = [];
      for (let i = 0; i < candles.length - 2; i++) {
        const c1 = candles[i];
        const c3 = candles[i + 2];

        let type = null;
        let gapTop = null;
        let gapBottom = null;

        // Bearish FVG (SIBI): c1.l > c3.h
        if (c1.l > c3.h) {
          type = "Bearish_SIBI";
          gapTop = c1.l;
          gapBottom = c3.h;
        } 
        // Bullish FVG (BISI): c1.h < c3.l
        else if (c1.h < c3.l) {
          type = "Bullish_BISI";
          gapTop = c3.l;
          gapBottom = c1.h;
        }

        if (type) {
          let isMitigated = false;
          // Loop through all subsequent candles that came after c3 up to the live price
          for (let j = i + 3; j < candles.length; j++) {
            const futureCandle = candles[j];
            if (type === "Bearish_SIBI" && futureCandle.h >= gapBottom) {
              isMitigated = true;
              break;
            }
            if (type === "Bullish_BISI" && futureCandle.l <= gapTop) {
              isMitigated = true;
              break;
            }
          }

          if (!isMitigated) {
            active_fvgs.push({
              type,
              top: gapTop,
              bottom: gapBottom,
              ce_50: Number(((gapTop + gapBottom) / 2).toFixed(2))
            });
          }
        }
      }
      return active_fvgs;
    };

    const active_fvgs = findUnmitigatedFVGs(candles15m);

    // 7. Killzone Clock (Current Time Window)
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

    // 8. Displacement & Volume Anomaly Scanner
    const checkDisplacement = (candles: any[]) => {
      if (candles.length < 16) return { displacement_active: false };
      
      // Get the last closed candle (Binance API returns current open candle at length - 1, so last closed is length - 2)
      const latestCandle = candles[candles.length - 2];
      // 14 candles prior to latestCandle
      const priorCandles = candles.slice(candles.length - 16, candles.length - 2);

      const latestBodySize = Math.abs(latestCandle.o - latestCandle.c);
      const latestVolume = latestCandle.v;

      const avgBodySize = priorCandles.reduce((sum, c) => sum + Math.abs(c.o - c.c), 0) / 14;
      const avgVolume = priorCandles.reduce((sum, c) => sum + c.v, 0) / 14;

      if (latestBodySize > (avgBodySize * 2.0) && latestVolume > (avgVolume * 1.5)) {
        return {
          displacement_active: true,
          direction: latestCandle.c >= latestCandle.o ? "BULLISH" : "BEARISH"
        };
      }

      return { displacement_active: false };
    };

    const payload = {
      ticker: "ETHUSDC.p",
      timezone: "UTC+3",
      open_interest: parseFloat(dataOi.openInterest),
      data_payload: {
        candles_1h: candles1h,
        candles_15m: candles15m,
        candles_5m: candles5m,
      },
      ipda_metrics: {
        current_time_window: getCurrentKillzone(),
        institutional_sponsorship: checkDisplacement(candles15m),
        true_day_open_0700,
        current_pricing,
        target_status,
        macro_levels: { pdh, pdl },
        stepped_liquidity: {
          asian: asianLiquidity,
          london: londonLiquidity
        },
        smt_traps,
        active_fvgs
      }
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error fetching market data:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
