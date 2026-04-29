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
      throw new Error('Failed to fetch from Binance API');
    }

    const [data5m, data15m, data1h, dataOi] = await Promise.all([
      res5m.json(),
      res15m.json(),
      res1h.json(),
      resOi.json(),
    ]);

    // Mapping Binance kline format to { t, o, h, l, c, v }
    // c[0] is open_time in raw milliseconds
    const formatCandles = (data: any[]) => {
      return data.map((c) => ({
        t: c[0],
        o: parseFloat(c[1]),
        h: parseFloat(c[2]),
        l: parseFloat(c[3]),
        c: parseFloat(c[4]),
        v: parseFloat(c[5]),
      }));
    };

    const payload = {
      ticker: "ETHUSDC.p",
      timestamp_utc: new Date().toISOString(),
      market_structure_framework: "V6_Naked_Data",
      open_interest: parseFloat(dataOi.openInterest),
      data_payload: {
        candles_1h: formatCandles(data1h),
        candles_15m: formatCandles(data15m),
        candles_5m: formatCandles(data5m),
      }
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error fetching market data:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
