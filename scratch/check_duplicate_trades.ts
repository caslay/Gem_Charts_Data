import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades } from '../src/lib/quantEngine/equityCalculator';

async function checkDuplicates() {
  const symbol = 'ETHUSDC';
  const all5m = await fetchHistoricalKlines(symbol, '5m', 1000);

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

  const srEngine = new SweepReclaimEngine(scanConfig);
  const scanRes = srEngine.scanHistoricalSetups(all5m);
  const setups = scanRes.setups || [];

  const rawTrades = adaptSweepReclaimSetupsToTrades(setups);
  console.log(`Total Raw Trades from adaptSweepReclaimSetupsToTrades: ${rawTrades.length}`);

  // Group by timestamp
  const byTimestamp = new Map<number, typeof rawTrades>();
  for (const t of rawTrades) {
    if (!byTimestamp.has(t.timestamp)) {
      byTimestamp.set(t.timestamp, []);
    }
    byTimestamp.get(t.timestamp)!.push(t);
  }

  console.log(`\nTimestamp clusters with multiple concurrent trades:`);
  for (const [ts, cluster] of byTimestamp.entries()) {
    if (cluster.length > 1) {
      const dateStr = cluster[0].dateStr;
      console.log(`\n📅 Cluster @ ${dateStr} (${cluster.length} trades):`);
      for (const t of cluster) {
        console.log(`   • ID: ${t.id}`);
        console.log(`     Label: ${t.label} | Dir: ${t.direction} | Entry: $${t.entryPrice} | SL: $${t.stopLossPrice} | Outcome: ${t.outcome} | RealizedR: ${t.realizedR}R`);
      }
    }
  }
}

checkDuplicates().catch(console.error);
