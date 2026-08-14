const https = require('https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'QuantEngine/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  try {
    const [eth15m, btc15m, eth1h, btc1h, eth4h, eth1d, ethOi] = await Promise.all([
      fetchJson('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDC&interval=15m&limit=100'),
      fetchJson('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDC&interval=15m&limit=100'),
      fetchJson('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDC&interval=1h&limit=50'),
      fetchJson('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDC&interval=1h&limit=50'),
      fetchJson('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDC&interval=4h&limit=30'),
      fetchJson('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDC&interval=1d&limit=14'),
      fetchJson('https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDC').catch(() => null)
    ]);

    const ethCurrent = parseFloat(eth15m[eth15m.length - 1][4]);
    const btcCurrent = parseFloat(btc15m[btc15m.length - 1][4]);

    // D1 levels
    const prevDay = eth1d[eth1d.length - 2];
    const pdh = parseFloat(prevDay[2]);
    const pdl = parseFloat(prevDay[3]);
    const today = eth1d[eth1d.length - 1];
    const dHigh = parseFloat(today[2]);
    const dLow = parseFloat(today[3]);

    // Calculate Volume Profile on recent 15m (last 48 candles = 12 hours / today's sessions)
    const recentCandles = eth15m.slice(-48);
    let minP = Infinity, maxP = -Infinity;
    recentCandles.forEach(c => {
      const h = parseFloat(c[2]), l = parseFloat(c[3]);
      if (h > maxP) maxP = h;
      if (l < minP) minP = l;
    });

    const step = (maxP - minP) / 30;
    const profile = new Array(30).fill(0);
    recentCandles.forEach(c => {
      const close = parseFloat(c[4]), vol = parseFloat(c[5]);
      const idx = Math.min(29, Math.max(0, Math.floor((close - minP) / step)));
      profile[idx] += vol;
    });

    let totalVol = profile.reduce((a, b) => a + b, 0);
    let maxVolIdx = 0;
    profile.forEach((v, i) => {
      if (v > profile[maxVolIdx]) maxVolIdx = i;
    });
    const poc = minP + (maxVolIdx + 0.5) * step;

    // 70% Value Area
    let vaVol = profile[maxVolIdx];
    let upIdx = maxVolIdx, downIdx = maxVolIdx;
    while (vaVol < totalVol * 0.70 && (upIdx < 29 || downIdx > 0)) {
      const nextUp = upIdx < 29 ? profile[upIdx + 1] : 0;
      const nextDown = downIdx > 0 ? profile[downIdx - 1] : 0;
      if (nextUp >= nextDown && upIdx < 29) {
        upIdx++;
        vaVol += profile[upIdx];
      } else if (downIdx > 0) {
        downIdx--;
        vaVol += profile[downIdx];
      } else if (upIdx < 29) {
        upIdx++;
        vaVol += profile[upIdx];
      } else {
        break;
      }
    }
    const vah = minP + (upIdx + 1) * step;
    const val = minP + downIdx * step;

    // Identify London Session (07:00 UTC - 10:00 UTC)
    // and NY Session (13:00 UTC - 16:00 UTC)
    let londonHigh = -Infinity, londonLow = Infinity;
    let nyHigh = -Infinity, nyLow = Infinity;
    const nowUtc = new Date();
    const todayStr = nowUtc.toISOString().split('T')[0];

    eth15m.forEach(c => {
      const d = new Date(c[0]);
      const hour = d.getUTCHours();
      const h = parseFloat(c[2]), l = parseFloat(c[3]);
      // London approx 07-10 UTC
      if (hour >= 7 && hour < 10) {
        if (h > londonHigh) londonHigh = h;
        if (l < londonLow) londonLow = l;
      }
      // NY AM approx 13-16 UTC
      if (hour >= 13 && hour < 16) {
        if (h > nyHigh) nyHigh = h;
        if (l < nyLow) nyLow = l;
      }
    });

    // SMT Analysis on recent swings (compare last 10 candles ETH vs BTC)
    const ethRecentHigh = Math.max(...eth15m.slice(-8).map(c => parseFloat(c[2])));
    const ethRecentLow = Math.min(...eth15m.slice(-8).map(c => parseFloat(c[3])));
    const btcRecentHigh = Math.max(...btc15m.slice(-8).map(c => parseFloat(c[2])));
    const btcRecentLow = Math.min(...btc15m.slice(-8).map(c => parseFloat(c[3])));

    const ethPrevHigh = Math.max(...eth15m.slice(-20, -8).map(c => parseFloat(c[2])));
    const ethPrevLow = Math.min(...eth15m.slice(-20, -8).map(c => parseFloat(c[3])));
    const btcPrevHigh = Math.max(...btc15m.slice(-20, -8).map(c => parseFloat(c[2])));
    const btcPrevLow = Math.min(...btc15m.slice(-20, -8).map(c => parseFloat(c[3])));

    let smt = 'NEUTRAL / SYMMETRICAL';
    if (btcRecentLow < btcPrevLow && ethRecentLow >= ethPrevLow) {
      smt = 'BULLISH SMT (BTC Lower Low, ETH Higher Low)';
    } else if (btcRecentHigh > btcPrevHigh && ethRecentHigh <= ethPrevHigh) {
      smt = 'BEARISH SMT (BTC Higher High, ETH Lower High)';
    }

    // 1H Trend
    const last1h = eth1h.slice(-5);
    const h1Close0 = parseFloat(last1h[last1h.length - 1][4]);
    const h1Close4 = parseFloat(last1h[0][4]);
    const h1Trend = h1Close0 >= h1Close4 ? 'BULLISH / CONSOLIDATION' : 'BEARISH / EXPANSION';

    console.log(JSON.stringify({
      currentTimeUTC: nowUtc.toISOString(),
      ethCurrent,
      btcCurrent,
      d1: { pdh, pdl, dHigh, dLow },
      amt: { vah: vah.toFixed(2), val: val.toFixed(2), poc: poc.toFixed(2) },
      sessions: {
        londonHigh: londonHigh !== -Infinity ? londonHigh : null,
        londonLow: londonLow !== Infinity ? londonLow : null,
        nyHigh: nyHigh !== -Infinity ? nyHigh : null,
        nyLow: nyLow !== Infinity ? nyLow : null
      },
      h1Trend,
      smt,
      ethOi: ethOi ? ethOi.openInterest : null,
      recentEthCandles: eth15m.slice(-5).map(c => ({
        time: new Date(c[0]).toISOString().substring(11, 16),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        vol: parseFloat(c[5])
      }))
    }, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
