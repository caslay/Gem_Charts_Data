import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades, StandardizedExecutedTrade } from '../src/lib/quantEngine/equityCalculator';

// Hierarchy score for anchor types
function getAnchorPriority(anchorType?: string, anchorSwingGrade?: string): number {
  if (anchorType === 'DAILY' || anchorType === 'PDH' || anchorType === 'PDL') return 100;
  if (anchorType === 'LONDON_HIGH' || anchorType === 'LONDON_LOW' || anchorType === 'LONDON') return 90;
  if (anchorType === 'ASIAN_HIGH' || anchorType === 'ASIAN_LOW' || anchorType === 'ASIAN') return 80;
  if (anchorSwingGrade === 'MAJOR') return 70;
  if (anchorSwingGrade === 'INTERNAL') return 50;
  return 30; // INNER
}

export function adaptSweepReclaimSetupsToTradesDeduplicated(
  setups: any[],
  options: { enforceSinglePositionWalk?: boolean } = { enforceSinglePositionWalk: true }
): StandardizedExecutedTrade[] {
  const rawTrades = adaptSweepReclaimSetupsToTrades(setups);
  if (!options.enforceSinglePositionWalk || rawTrades.length <= 1) {
    return rawTrades;
  }

  // 1. Group trades that trigger on the exact same timestamp (same displacement bar)
  // and pick the single highest-priority anchor
  const timestampMap = new Map<number, StandardizedExecutedTrade[]>();
  for (const t of rawTrades) {
    if (!timestampMap.has(t.timestamp)) {
      timestampMap.set(t.timestamp, []);
    }
    timestampMap.get(t.timestamp)!.push(t);
  }

  const waveDeduplicated: StandardizedExecutedTrade[] = [];
  for (const [_, cluster] of timestampMap.entries()) {
    if (cluster.length === 1) {
      waveDeduplicated.push(cluster[0]);
    } else {
      // Pick best anchor
      cluster.sort((a, b) => {
        const pA = getAnchorPriority(a.metadata?.anchorType, a.metadata?.anchorSwingGrade);
        const pB = getAnchorPriority(b.metadata?.anchorType, b.metadata?.anchorSwingGrade);
        return pB - pA;
      });
      waveDeduplicated.push(cluster[0]);
    }
  }

  waveDeduplicated.sort((a, b) => a.timestamp - b.timestamp);

  // 2. Sequential Single-Position Walk:
  // Ensure that no two trades overlap in active execution time window [openTime, exitTime]
  // (matches live engine maxOpenPositions: 1)
  const sequentialTrades: StandardizedExecutedTrade[] = [];
  let lastExitTimestamp = 0;

  for (const t of waveDeduplicated) {
    // Find corresponding setup for exit time
    const setup = setups.find((s) => s.id === t.id);
    const openTime = t.timestamp;
    const exitTime = setup?.exit_time || (openTime + 15 * 60 * 1000);

    if (openTime >= lastExitTimestamp) {
      sequentialTrades.push(t);
      lastExitTimestamp = exitTime;
    }
  }

  return sequentialTrades;
}

async function test() {
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
  const deduplicatedTrades = adaptSweepReclaimSetupsToTradesDeduplicated(setups);

  console.log(`\n===============================================================`);
  console.log(` 📊 DEDUPLICATION COMPARISON SUMMARY`);
  console.log(`===============================================================`);
  console.log(` Raw Executed Setups:            ${rawTrades.length}`);
  console.log(` Single-Position Walk Trades:    ${deduplicatedTrades.length}`);
  console.log(` Concurrency Multi-Entries Cut:  ${rawTrades.length - deduplicatedTrades.length}`);

  console.log(`\nTrades on 2026-08-28 in Deduplicated Walk:`);
  const day28Trades = deduplicatedTrades.filter((t) => t.dateStr.startsWith('2026-08-28'));
  for (const t of day28Trades) {
    console.log(`• [${t.dateStr}] ${t.direction} ${t.label} @ $${t.entryPrice} ➔ Outcome: ${t.outcome} (${t.realizedR > 0 ? '+' : ''}${t.realizedR}R)`);
  }
}

test().catch(console.error);
