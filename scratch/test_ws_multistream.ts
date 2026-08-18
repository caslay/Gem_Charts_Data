const url = 'wss://fstream.binance.com/market/stream?streams=ethusdc@kline_1m/ethusdc@kline_5m/ethusdc@kline_15m/ethusdc@kline_1h';

console.log('Connecting to:', url);
const ws = new WebSocket(url);

let count = 0;
ws.onopen = () => {
  console.log('Connected to Binance Market Multi-Stream!');
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log(`[Stream: ${msg.stream}] Interval: ${msg.data.k.i}, Close: ${msg.data.k.c}, isClosed: ${msg.data.k.x}`);
  count++;
  if (count >= 5) {
    ws.close();
    process.exit(0);
  }
};

ws.onerror = (err) => {
  console.error('WS Error:', err);
};

setTimeout(() => {
  console.log('Timeout after 10s');
  ws.close();
  process.exit(0);
}, 10000);
