import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { DEFAULT_SR_LIVE_SETTINGS } from '../src/lib/quantEngine/strategyExecutionConfig';

async function stepThroughDay() {
  const symbol = 'ETHUSDC';
  console.log(`Stepping bar-by-bar through 2026-08-28...`);

  const all5m = await fetchHistoricalKlines(symbol, '5m', 1000);
  const all15m = await fetchHistoricalKlines(symbol, '15m', 1000);
  const all1h = await fetchHistoricalKlines(symbol, '1h', 1000);

  // Find index of first candle of 2026-08-28
  const startDayIdx = all5m.findIndex((c) => new Date(c.t).toISOString().startsWith('2026-08-28'));
  console.log(`First candle of 2026-08-28 is at index ${startDayIdx} (${new Date(all5m[startDayIdx].t).toISOString()})`);

  // Create fresh engine
  const engine = new AutomatedStrategyExecutionEngine({
    symbol,
    initialEquity: 10000,
    compoundingRiskPct: 2.0,
    maxOpenPositions: 1,
    autoExecute: true,
    liveSettings: {
      ...DEFAULT_SR_LIVE_SETTINGS,
      enabledTimeframes: ['5m'],
      entryMode: 'FVG_PROXIMAL',
      stage1Multiple: 1.0,
      stage2Multiple: 1.4,
      stage3Multiple: 3.0,
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
    },
  });

  engine.subscribe((evt) => {
    console.log(`\n🚨 [EVENT: ${evt.type}] ${evt.message}`);
    if (evt.position) {
      console.log(`   Pos: Direction=${evt.position.direction} Entry=${evt.position.entryPrice} SL=${evt.position.activeStopLoss} Status=${evt.position.status}`);
    }
  });

  // Step bar-by-bar from startDayIdx to end of array
  for (let i = startDayIdx; i < all5m.length; i++) {
    const current5mSlice = all5m.slice(0, i + 1);
    const current15mSlice = all15m.filter((c) => c.t <= all5m[i].t);
    const current1hSlice = all1h.filter((c) => c.t <= all5m[i].t);

    const candle = all5m[i];
    const timeStr = new Date(candle.t).toISOString();

    // 1. Candle closed scan
    const res = engine.onMultiTimeframeCandles({
      '5m': current5mSlice,
      '15m': current15mSlice,
      '1h': current1hSlice,
    });

    if (res.executedSetups.length > 0) {
      console.log(`\n📌 [ARMED @ ${timeStr}] Setup armed: ${res.executedSetups.map((s) => s.id).join(', ')}`);
    }

    // 2. Simulated tick through high, low, close of the bar
    engine.processMarketTick(candle.o);
    engine.processMarketTick(candle.l);
    engine.processMarketTick(candle.h);
    engine.processMarketTick(candle.c);
  }

  console.log(`\n==================================================`);
  console.log(`Simulation Complete!`);
  console.log(`Closed Trades in Engine: ${engine.getClosedPositions().length}`);
  for (const pos of engine.getClosedPositions()) {
    console.log(`Trade: ${pos.direction} Entry=$${pos.entryPrice} Exit=$${pos.exitPrice} Reason=${pos.exitReason} RealizedR=${pos.realizedR}`);
  }
}

stepThroughDay().catch(console.error);
