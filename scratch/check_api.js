async function check() {
  const intervals = ['5m', '15m', '1h'];
  for (const interval of intervals) {
    try {
      const url = `http://127.0.0.1:4000/api/market-data?symbol=ETHUSDC&interval=${interval}&init=true`;
      console.log(`Fetching: ${url}`);
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`Error fetching ${interval}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const dr = data.pricing_context?.local_dealing_range || data.local_dealing_range || data.ipda_metrics?.local_dealing_range;
      console.log(`\n=== Interval: ${interval} ===`);
      console.log("Dealing Range:", JSON.stringify(dr, null, 2));
    } catch (err) {
      console.error(`Error for ${interval}:`, err.message);
    }
  }
}
check();
