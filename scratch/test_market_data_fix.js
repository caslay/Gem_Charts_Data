const url = 'http://localhost:4000/api/market-data?interval=5m&poll=false&timeframeGated=true&activeInterval=5m&limit1m=250&limit5m=600&limit15m=300&limit1h=200&limit4h=100&includeBtc=true&includeStructure=true&includeFvg=true';

async function test() {
  try {
    console.log("Fetching local API endpoint...");
    const res = await fetch(url);
    console.log("Response status:", res.status);
    const data = await res.json();
    if (res.ok) {
      console.log("Success! Data received successfully.");
      console.log("isDelta:", data.isDelta);
      console.log("delta_candles length:", data.delta_candles?.length);
      console.log("correlation_data:", JSON.stringify(data.correlation_data));
    } else {
      console.error("API returned error:", data);
    }
  } catch (err) {
    console.error("Fetch failed (make sure Next.js dev server is running):", err.message);
  }
}

test();
