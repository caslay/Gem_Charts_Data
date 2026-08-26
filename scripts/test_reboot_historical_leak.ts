import { SweepReclaimEngine } from '../src/lib/quantEngine/SweepReclaimEngine';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { Candle } from '../src/lib/fvgEngine';

async function fetchBinanceKlines(symbol: string = 'ETHUSDC', interval: string = '5m', limit: number = 80): Promise<Candle[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Binance API error: ${res.statusText}`);
  }
  const data = (await res.json()) as any[];

  return data.map((k) => {
    const o = parseFloat(k[1]);
    const h = parseFloat(k[2]);
    const l = parseFloat(k[3]);
    const c = parseFloat(k[4]);
    const v = parseFloat(k[5]);
    const taker_buy = parseFloat(k[9]);
    return {
      t: k[0],
      o,
      h,
      l,
      c,
      v,
      taker_buy_vol: taker_buy,
      taker_sell_vol: Math.max(0, v - taker_buy),
      isClosed: true,
    };
  });
}

async function runAudit() {
  console.log('======================================================================');
  console.log('🔍 AUDIT: COLD-START REBOOT / NPM RESTART HISTORICAL LEAK TEST');
  console.log('======================================================================\n');

  const candles = await fetchBinanceKlines('ETHUSDC', '5m', 80);
  const latestPrice = candles[candles.length - 1].c;
  console.log(`Fetched ${candles.length} closed 5m candles. Latest price: $${latestPrice}`);

  // 1. Simulate fresh cold start (like restarting browser or restarting NPM)
  const engine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    timeframe: '5m',
    autoExecute: true,
  });

  const res = engine.onMultiTimeframeCandles({
    '5m': candles,
    '15m': [],
    '1h': [],
  });

  console.log(`Scanned setups detected in history: ${res.scannedSetups.length}`);
  console.log(`Pending limit orders armed on boot: ${engine.getPendingLimitOrders().length}`);
  console.log(`Active positions on boot: ${engine.getActivePositions().length}`);

  // 2. Simulate next market tick
  engine.processMarketTick(latestPrice);

  const pendingCount = engine.getPendingLimitOrders().length;
  const activeCount = engine.getActivePositions().length;

  console.log('\n--- Post-Tick Execution Status ---');
  console.log(`Pending Limit Orders: ${pendingCount}`);
  console.log(`Active Positions: ${activeCount}`);

  if (activeCount > 0) {
    const pos = engine.getActivePositions()[0];
    console.error(`\n❌ LEAK DETECTED: Engine opened phantom position on boot: ${pos.direction} @ $${pos.entryPrice}, SL: $${pos.activeStopLoss}`);
    process.exit(1);
  } else if (pendingCount > 0) {
    const order = engine.getPendingLimitOrders()[0];
    console.error(`\n❌ LEAK DETECTED: Engine armed stale pending order on boot: ${order.direction} @ $${order.limitEntryPrice}`);
    process.exit(1);
  } else {
    console.log('\n✅ PASS: Zero historical setups leaked into live execution upon fresh reboot!');
  }
}

runAudit().catch((err) => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
