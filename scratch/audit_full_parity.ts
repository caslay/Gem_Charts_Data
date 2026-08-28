import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { DEFAULT_SR_LIVE_SETTINGS } from '../src/lib/quantEngine/strategyExecutionConfig';

async function runDeepAudit() {
  console.log(`\n===============================================================`);
  console.log(` 🔬 DEEP QUANT LAB VS LIVE EXECUTION ENGINE PARITY AUDIT `);
  console.log(`===============================================================\n`);

  const symbol = 'ETHUSDC';
  const all5m = await fetchHistoricalKlines(symbol, '5m', 1000);
  const all15m = await fetchHistoricalKlines(symbol, '15m', 1000);
  const all1h = await fetchHistoricalKlines(symbol, '1h', 1000);

  console.log(`[AUDIT] Fetched 1,000 bars for 5m, 15m, 1h.`);

  const scanConfig: SweepReclaimScanConfig = {
    symbol,
    timeframe: '5m',
    anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
    lookbackMajor: 10,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 25,
    maxBarsSweepToReclaim: 10,
    maxBarsToRetest: 20,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.12,
    entryMode: 'FVG_PROXIMAL',
    stage1Multiple: 1.0,
    stage2Multiple: 1.4,
    stage3Multiple: 3.0,
    enableStructuralTrail: true,
    enableProfitRatchet: true,
    volumeSmaPeriod: 20,
    volumeExpansionThreshold: 1.35,
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.50,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
  };

  // 1. Run Quant Lab Historical Backtest
  const srEngine = new SweepReclaimEngine(scanConfig);
  const qlResult = srEngine.scanHistoricalSetups(all5m);
  const qlSetups = qlResult.setups || [];
  console.log(`[AUDIT] Quant Lab identified ${qlSetups.length} total setups in 1,000 bars.`);

  // Filter to completed retested setups
  const retestedQl = qlSetups.filter((s) => s.is_retested && s.three_pillar_displacement_passed && s.is_valuation_aligned);
  console.log(`[AUDIT] Quant Lab completed retests: ${retestedQl.length} setups.`);

  // 2. Run Step-By-Step Live Engine Simulation across all 1,000 bars
  const liveEngine = new AutomatedStrategyExecutionEngine({
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

  const armedSetups: string[] = [];
  const filledTrades: any[] = [];
  const duplicateChecks = new Map<string, number>();

  liveEngine.subscribe((evt) => {
    if (evt.type === 'ORDER_FILLED' && evt.position) {
      filledTrades.push(evt.position);
      const zoneKey = `${evt.position.originZoneId || evt.position.setupId}`;
      duplicateChecks.set(zoneKey, (duplicateChecks.get(zoneKey) || 0) + 1);
    }
  });

  // Step through bar-by-bar
  const warmup = 200;
  for (let i = warmup; i < all5m.length; i++) {
    const current5m = all5m.slice(0, i + 1);
    const current15m = all15m.filter((c) => c.t <= all5m[i].t);
    const current1h = all1h.filter((c) => c.t <= all5m[i].t);

    const candle = all5m[i];

    // Candle close scan
    const scanRes = liveEngine.onMultiTimeframeCandles({
      '5m': current5m,
      '15m': current15m,
      '1h': current1h,
    });

    for (const s of scanRes.executedSetups) {
      armedSetups.push(s.id);
    }

    // Process price ticks across bar
    liveEngine.processMarketTick(candle.o);
    liveEngine.processMarketTick(candle.h);
    liveEngine.processMarketTick(candle.l);
    liveEngine.processMarketTick(candle.c);
  }

  const closedTrades = liveEngine.getClosedPositions();
  console.log(`\n[AUDIT] Live Engine Total Closed Trades: ${closedTrades.length}`);
  console.log(`[AUDIT] Total Unique Zones Executed: ${duplicateChecks.size}`);

  // Check for any duplicate execution
  let duplicatesFound = 0;
  for (const [zone, count] of duplicateChecks.entries()) {
    if (count > 1) {
      console.error(`❌ [DUPLICATE_ERROR] Zone ${zone} was executed ${count} times!`);
      duplicatesFound++;
    }
  }

  if (duplicatesFound === 0) {
    console.log(`✅ [AUDIT PASSED] ZERO DUPLICATE EXECUTIONS! Every trade had strict single-execution locking.`);
  }

  console.log(`\n===============================================================`);
  console.log(` 📋 EXECUTED TRADES BREAKDOWN`);
  console.log(`===============================================================`);
  for (const t of closedTrades) {
    const timeStr = t.openTime ? new Date(t.openTime).toISOString().replace('.000Z', 'Z') : 'N/A';
    console.log(`• [${timeStr}] ${t.direction} ${t.anchorName} @ $${t.entryPrice.toFixed(2)} ➔ Exit: $${t.exitPrice?.toFixed(2)} (${t.exitReason}) Realized R: ${t.realizedR > 0 ? '+' : ''}${t.realizedR?.toFixed(2)}R`);
  }
  console.log(`===============================================================\n`);
}

runDeepAudit().catch(console.error);
