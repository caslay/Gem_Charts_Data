import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup
} from '../src/lib/quantEngine/SweepReclaimEngine';

interface MonthlyBreakdown {
  month: string;
  trades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number;
  slHitRatePct: number;
  netR: number;
  profitFactor: number;
}

const TOP_3_CONFIGS: { name: string; archetype: string; config: SweepReclaimScanConfig }[] = [
  {
    name: 'Top Refined Winner: Sweep OB 50% Mean Threshold (MT) Master Execution',
    archetype: 'Archetype 1: Sweep OB MT Refinement',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 12,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.25,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.48,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.6,
      stage3Multiple: 3.2,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.12,
    },
  },
  {
    name: 'Top Refined Runner-Up: Displacement FVG Proximal Edge Early-Fill Scalper',
    archetype: 'Archetype 2: FVG Proximal Refinement',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 10,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 20,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.35,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.50,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.6,
      stage3Multiple: 3.0,
      entryMode: 'FVG_PROXIMAL',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.12,
    },
  },
  {
    name: 'Top Refined 3rd Place: Fast-Harvest Structural Pivot & Session Shield',
    archetype: 'Archetype 3: Fast Harvest & Reclaimed Shelf',
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 12,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 18,
      volumeSmaPeriod: 16,
      volumeExpansionThreshold: 1.30,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.50,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 2.8,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.12,
    },
  },
];

function analyzePerformance(name: string, config: SweepReclaimScanConfig, candles: Candle[]) {
  const engine = new SweepReclaimEngine(config);
  const { setups, telemetry } = engine.scanHistoricalSetups(candles);

  const executedTrades = setups.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');

  // Month by Month
  const tradesByMonth = new Map<string, SweepReclaimSetup[]>();
  for (const trade of executedTrades) {
    const monthKey = new Date(trade.retest_time || trade.anchor_time).toISOString().slice(0, 7);
    if (!tradesByMonth.has(monthKey)) tradesByMonth.set(monthKey, []);
    tradesByMonth.get(monthKey)!.push(trade);
  }

  const monthlyResults: MonthlyBreakdown[] = [];
  const sortedMonths = Array.from(tradesByMonth.keys()).sort();

  for (const m of sortedMonths) {
    const list = tradesByMonth.get(m)!;
    const wins = list.filter((s) => s.simulated_outcome === 'FULL_TP3_WIN' || s.simulated_outcome === 'FULL_TP2_WIN').length;
    const losses = list.filter((s) => s.simulated_outcome === 'STOPPED_OUT').length;
    const scratches = list.filter((s) => s.simulated_outcome === 'BE_SCRATCH_WIN' || s.simulated_outcome === 'STRUCTURAL_SCRATCH').length;
    
    let monthNetR = 0;
    let winRSum = 0;
    let lossRSum = 0;

    for (const s of list) {
      monthNetR += s.realized_rr;
      if (s.realized_rr > 0) winRSum += s.realized_rr;
      else lossRSum += Math.abs(s.realized_rr);
    }

    const pf = lossRSum > 0 ? winRSum / lossRSum : winRSum > 0 ? 99.9 : 0;
    const wr = list.length > 0 ? (wins / list.length) * 100 : 0;
    const slRate = list.length > 0 ? (losses / list.length) * 100 : 0;

    monthlyResults.push({
      month: m,
      trades: list.length,
      wins,
      losses,
      scratches,
      winRatePct: parseFloat(wr.toFixed(1)),
      slHitRatePct: parseFloat(slRate.toFixed(1)),
      netR: parseFloat(monthNetR.toFixed(2)),
      profitFactor: parseFloat(pf.toFixed(2)),
    });
  }

  // Anchor Type Breakdown
  const anchorStats = new Map<string, { trades: number; wins: number; losses: number; netR: number }>();
  for (const t of executedTrades) {
    const aType = t.anchor_type || 'SWING_PIVOT';
    if (!anchorStats.has(aType)) anchorStats.set(aType, { trades: 0, wins: 0, losses: 0, netR: 0 });
    const stat = anchorStats.get(aType)!;
    stat.trades++;
    if (t.simulated_outcome === 'FULL_TP3_WIN' || t.simulated_outcome === 'FULL_TP2_WIN') stat.wins++;
    if (t.simulated_outcome === 'STOPPED_OUT') stat.losses++;
    stat.netR += t.realized_rr;
  }

  // Direction Breakdown (Bullish vs Bearish)
  const bullTrades = executedTrades.filter((s) => s.type === 'BULLISH');
  const bearTrades = executedTrades.filter((s) => s.type === 'BEARISH');
  const bullWins = bullTrades.filter((s) => s.simulated_outcome === 'FULL_TP3_WIN' || s.simulated_outcome === 'FULL_TP2_WIN').length;
  const bearWins = bearTrades.filter((s) => s.simulated_outcome === 'FULL_TP3_WIN' || s.simulated_outcome === 'FULL_TP2_WIN').length;
  const bullLosses = bullTrades.filter((s) => s.simulated_outcome === 'STOPPED_OUT').length;
  const bearLosses = bearTrades.filter((s) => s.simulated_outcome === 'STOPPED_OUT').length;

  let bullNetR = 0;
  for (const s of bullTrades) bullNetR += s.realized_rr;
  let bearNetR = 0;
  for (const s of bearTrades) bearNetR += s.realized_rr;

  // Max Drawdown in R
  let peakR = 0;
  let currentR = 0;
  let maxDDR = 0;

  for (const s of executedTrades) {
    currentR += s.realized_rr;
    if (currentR > peakR) peakR = currentR;
    const dd = peakR - currentR;
    if (dd > maxDDR) maxDDR = dd;
  }

  return {
    name,
    telemetry,
    totalExecuted: executedTrades.length,
    monthlyResults,
    anchorStats: Array.from(anchorStats.entries()).map(([k, v]) => ({
      anchor: k,
      trades: v.trades,
      winRate: parseFloat(((v.wins / v.trades) * 100).toFixed(1)),
      slHitRate: parseFloat(((v.losses / v.trades) * 100).toFixed(1)),
      netR: parseFloat(v.netR.toFixed(2)),
    })),
    bullish: {
      trades: bullTrades.length,
      winRate: parseFloat(((bullWins / (bullTrades.length || 1)) * 100).toFixed(1)),
      slHitRate: parseFloat(((bullLosses / (bullTrades.length || 1)) * 100).toFixed(1)),
      netR: parseFloat(bullNetR.toFixed(2)),
    },
    bearish: {
      trades: bearTrades.length,
      winRate: parseFloat(((bearWins / (bearTrades.length || 1)) * 100).toFixed(1)),
      slHitRate: parseFloat(((bearLosses / (bearTrades.length || 1)) * 100).toFixed(1)),
      netR: parseFloat(bearNetR.toFixed(2)),
    },
    maxDrawdownR: parseFloat(maxDDR.toFixed(2)),
  };
}

async function main() {
  const cachePath = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc.json');
  const rawData = fs.readFileSync(cachePath, 'utf8');
  const candles: Candle[] = JSON.parse(rawData);

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('📊 DETAILED AUDIT & INSTITUTIONAL REPORT FOR TOP 3 REFINED SETUPS (5M ETHUSDC)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');

  for (let i = 0; i < TOP_3_CONFIGS.length; i++) {
    const item = TOP_3_CONFIGS[i];
    const audit = analyzePerformance(item.name, item.config, candles);
    const tel = audit.telemetry;

    let netR = 0;
    const executed = audit.totalExecuted;

    console.log(`───────────────────────────────────────────────────────────────────────────────────────────────`);
    console.log(`RANK #${i + 1}: ${item.name}`);
    console.log(`───────────────────────────────────────────────────────────────────────────────────────────────`);
    console.log(`Archetype:           ${item.archetype}`);
    console.log(`Total Trades:        ${audit.totalExecuted} executed setups`);
    console.log(`Retest Win Rate:     ${tel.retest_win_rate_pct}% (${tel.total_winning_trades}W / ${tel.total_losing_trades}L / ${tel.total_be_scratches + tel.total_structural_scratches} BE Scratches)`);
    console.log(`Hard SL Hit Rate:    ${((tel.stopped_out_count / audit.totalExecuted) * 100).toFixed(2)}% (${tel.stopped_out_count} stopped out)`);
    console.log(`Profit Factor:       ${tel.profit_factor}`);
    console.log(`Avg Realized R:      +${tel.avg_realized_rr}R per trade (Expected Value: +${tel.expected_value_r}R)`);
    console.log(`Max Drawdown:        -${audit.maxDrawdownR}R across 6 months (51,459 5m candles)`);
    console.log(`Stage Harvest Fills: Stage 1 (1.0R): ${tel.stage1_fill_count} (${tel.stage1_fill_pct}%) | Stage 2 (${item.config.stage2Multiple}R): ${tel.stage2_fill_count} (${tel.stage2_fill_pct}%) | Stage 3 (${item.config.stage3Multiple}R): ${tel.stage3_fill_count} (${tel.stage3_fill_pct}%)`);

    console.log(`\nMonth-by-Month Consistency:`);
    console.log(`Month    | Trades | Win Rate | SL Hit % | Net R Gain  | Profit Factor`);
    console.log(`---------|--------|----------|----------|-------------|--------------`);
    for (const m of audit.monthlyResults) {
      console.log(
        `${m.month}  | ${String(m.trades).padStart(6)} | ${(m.winRatePct.toFixed(1) + '%').padStart(8)} | ${(m.slHitRatePct.toFixed(1) + '%').padStart(8)} | ${(m.netR > 0 ? '+' : '') + (m.netR.toFixed(1) + 'R').padStart(11)} | ${m.profitFactor.toFixed(2).padStart(13)}`
      );
    }

    console.log(`\nDirectional Symmetry:`);
    console.log(`  • Bullish (Longs):  ${audit.bullish.trades} trades | Win Rate: ${audit.bullish.winRate}% | SL Hit: ${audit.bullish.slHitRate}% | Net R: +${audit.bullish.netR}R`);
    console.log(`  • Bearish (Shorts): ${audit.bearish.trades} trades | Win Rate: ${audit.bearish.winRate}% | SL Hit: ${audit.bearish.slHitRate}% | Net R: +${audit.bearish.netR}R`);

    console.log(`\nAnchor Source Performance:`);
    for (const a of audit.anchorStats) {
      console.log(`  • ${a.anchor.padEnd(16)}: ${String(a.trades).padStart(4)} trades | Win Rate: ${(a.winRate.toFixed(1) + '%').padStart(6)} | SL Hit: ${(a.slHitRate.toFixed(1) + '%').padStart(6)} | Net R: ${(a.netR > 0 ? '+' : '') + a.netR.toFixed(1) + 'R'}`);
    }
    console.log('\n');
  }
}

main().catch(console.error);
