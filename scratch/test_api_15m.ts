async function testApi() {
  console.log('Testing /api/market-data?interval=15m...');
  const t0 = Date.now();
  try {
    const res = await fetch('http://127.0.0.1:4000/api/market-data?interval=15m&poll=false&timeframeGated=true&activeInterval=15m&init=true&limit1m=1000&limit5m=1000&limit15m=1000&limit1h=1000&limit4h=1000&includeBtc=true&includeStructure=true&includeFvg=true');
    console.log('Status:', res.status, 'Time:', Date.now() - t0, 'ms');
    const json = await res.json();
    console.log('Has data_payload:', !!json.data_payload);
    if (json.data_payload) {
      console.log('candles_15m count:', json.data_payload.candles_15m?.length);
      console.log('candles_5m count:', json.data_payload.candles_5m?.length);
    }
  } catch (err) {
    console.error('API Error:', err);
  }
}

testApi();
