import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimAnchorType,
  SweepReclaimEntryMode,
} from '../src/lib/quantEngine/SweepReclaimEngine';

interface RefinedSetupCandidate {
  id: string;
  archetype: string;
  name: string;
  config: SweepReclaimScanConfig;
  totalRetests: number;
  winningTrades: number;
  losingTrades: number;
  beScratches: number;
  structuralScratches: number;
  stoppedOutCount: number;
  retestWinRatePct: number;
  slHitRatePct: number;
  avgRealizedRr: number;
  profitFactor: number;
  expectedValueR: number;
  netRealizedR: number;
  avgMfeR: number;
  avgMaeR: number;
  stage1Fills: number;
  stage2Fills: number;
  stage3Fills: number;
  compositeScore: number;
}

const ALL_ANCHORS: SweepReclaimAnchorType[] = [
  'SWING_PIVOT',
  'ASIAN_HIGH',
  'ASIAN_LOW',
  'LONDON_HIGH',
  'LONDON_LOW',
  'PDH',
  'PDL',
];

async function main() {
  const cachePath = path.join(__dirname, 'candles_5m_ethusdc.json');
  if (!fs.existsSync(cachePath)) {
    console.error(`Dataset not found at ${cachePath}. Run download script first.`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(cachePath, 'utf8');
  const candles: Candle[] = JSON.parse(rawData);
  console.log(`Loaded ${candles.length} 5m candles for refinement testing...\n`);

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('🔬 REFINEMENT & OPTIMIZATION GRID SEARCH FOR TOP 3 SWEEP & RECLAIM ARCHETYPES (5M TIMEFRAME)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');

  const candidates: RefinedSetupCandidate[] = [];
  let candidateIndex = 1;

  // Grid definitions for Archetype 1: Sweep OB MT (Mean Threshold Perfection)
  const volThresholds = [1.25, 1.35, 1.45, 1.50];
  const deltaThresholds = [50.0, 52.0, 55.0, 58.0];
  const bodyThresholds = [0.45, 0.50, 0.55];
  const stage2Mults = [1.4, 1.5, 1.6, 1.7];
  const stage3Mults = [2.8, 3.0, 3.2, 3.5];
  const slBuffers = [0.12, 0.15, 0.18];
  const lookbackMajors = [12, 15, 18];

  console.log('Testing Archetype 1: Sweep OB 50% Mean Threshold (MT) Parameter Grid...');
  for (const vol of volThresholds) {
    for (const delta of [52.0, 55.0]) {
      for (const body of [0.48, 0.52]) {
        for (const st2 of [1.4, 1.5, 1.6]) {
          for (const st3 of [3.0, 3.2]) {
            for (const slBuf of [0.12, 0.15, 0.18]) {
              for (const lbMaj of [12, 15]) {
                const config: SweepReclaimScanConfig = {
                  symbol: 'ETHUSDC',
                  timeframe: '5m',
                  anchorTypes: ALL_ANCHORS,
                  lookbackMajor: lbMaj,
                  lookbackInternal: 5,
                  maxBarsAnchorToSweep: 30,
                  maxBarsSweepToReclaim: 12,
                  maxBarsToRetest: 24,
                  volumeSmaPeriod: 20,
                  volumeExpansionThreshold: vol,
                  deltaDominanceThreshold: delta,
                  bodyRatioThreshold: body,
                  requireThreePillarDisplacement: true,
                  enforceDiscountPremiumGate: true,
                  stage1Multiple: 1.0,
                  stage2Multiple: st2,
                  stage3Multiple: st3,
                  entryMode: 'SWEEP_OB_MT',
                  enableStructuralTrail: true,
                  enableProfitRatchet: true,
                  minSweepDepthAtrMultiplier: 0.10,
                  slBufferAtrMultiplier: slBuf,
                };

                const engine = new SweepReclaimEngine(config);
                const { setups, telemetry } = engine.scanHistoricalSetups(candles);
                const executedTrades = setups.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');
                const totalExecuted = executedTrades.length;
                if (totalExecuted < 30) continue;

                const stoppedOut = executedTrades.filter((s) => s.simulated_outcome === 'STOPPED_OUT').length;
                const slHitRate = parseFloat(((stoppedOut / totalExecuted) * 100).toFixed(2));
                let netR = 0;
                for (const trade of executedTrades) netR += trade.realized_rr;
                netR = parseFloat(netR.toFixed(2));

                // Composite score balancing Net R (+), Win Rate (+), PF (+) and SL Hit Rate (-)
                const score = netR * 0.5 + telemetry.retest_win_rate_pct * 4 + telemetry.profit_factor * 25 - slHitRate * 10;

                candidates.push({
                  id: `A1_${candidateIndex++}`,
                  archetype: 'Archetype 1: Sweep OB MT Refinement',
                  name: `OB_MT (Vol:${vol}x_D:${delta}%_B:${body}_S2:${st2}R_S3:${st3}R_SL:${slBuf}_LB:${lbMaj})`,
                  config,
                  totalRetests: totalExecuted,
                  winningTrades: telemetry.total_winning_trades,
                  losingTrades: telemetry.total_losing_trades,
                  beScratches: telemetry.total_be_scratches,
                  structuralScratches: telemetry.total_structural_scratches,
                  stoppedOutCount: stoppedOut,
                  retestWinRatePct: telemetry.retest_win_rate_pct,
                  slHitRatePct: slHitRate,
                  avgRealizedRr: telemetry.avg_realized_rr,
                  profitFactor: telemetry.profit_factor,
                  expectedValueR: telemetry.expected_value_r,
                  netRealizedR: netR,
                  avgMfeR: telemetry.avg_mfe_r,
                  avgMaeR: telemetry.avg_mae_r,
                  stage1Fills: telemetry.stage1_fill_count,
                  stage2Fills: telemetry.stage2_fill_count,
                  stage3Fills: telemetry.stage3_fill_count,
                  compositeScore: parseFloat(score.toFixed(2)),
                });
              }
            }
          }
        }
      }
    }
  }

  console.log(`Archetype 1 produced ${candidates.length} evaluated configurations.`);

  // Grid definitions for Archetype 2: Displacement FVG Proximal Edge (Early Fill Scalper)
  const a2StartCount = candidates.length;
  console.log('Testing Archetype 2: Displacement FVG Proximal / 50% CE Parameter Grid...');
  for (const entryM of ['FVG_PROXIMAL', 'FVG_CE'] as SweepReclaimEntryMode[]) {
    for (const vol of [1.35, 1.45, 1.55]) {
      for (const delta of [52.0, 55.0, 58.0]) {
        for (const body of [0.50, 0.55]) {
          for (const st2 of [1.4, 1.5, 1.6]) {
            for (const slBuf of [0.12, 0.15, 0.18]) {
              for (const lbMaj of [10, 15]) {
                const config: SweepReclaimScanConfig = {
                  symbol: 'ETHUSDC',
                  timeframe: '5m',
                  anchorTypes: ALL_ANCHORS,
                  lookbackMajor: lbMaj,
                  lookbackInternal: 5,
                  maxBarsAnchorToSweep: 25,
                  maxBarsSweepToReclaim: 10,
                  maxBarsToRetest: 20,
                  volumeSmaPeriod: 20,
                  volumeExpansionThreshold: vol,
                  deltaDominanceThreshold: delta,
                  bodyRatioThreshold: body,
                  requireThreePillarDisplacement: true,
                  enforceDiscountPremiumGate: true,
                  stage1Multiple: 1.0,
                  stage2Multiple: st2,
                  stage3Multiple: 3.0,
                  entryMode: entryM,
                  enableStructuralTrail: true,
                  enableProfitRatchet: true,
                  minSweepDepthAtrMultiplier: 0.10,
                  slBufferAtrMultiplier: slBuf,
                };

                const engine = new SweepReclaimEngine(config);
                const { setups, telemetry } = engine.scanHistoricalSetups(candles);
                const executedTrades = setups.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');
                const totalExecuted = executedTrades.length;
                if (totalExecuted < 30) continue;

                const stoppedOut = executedTrades.filter((s) => s.simulated_outcome === 'STOPPED_OUT').length;
                const slHitRate = parseFloat(((stoppedOut / totalExecuted) * 100).toFixed(2));
                let netR = 0;
                for (const trade of executedTrades) netR += trade.realized_rr;
                netR = parseFloat(netR.toFixed(2));

                const score = netR * 0.5 + telemetry.retest_win_rate_pct * 4 + telemetry.profit_factor * 25 - slHitRate * 10;

                candidates.push({
                  id: `A2_${candidateIndex++}`,
                  archetype: `Archetype 2: ${entryM} Refinement`,
                  name: `${entryM} (Vol:${vol}x_D:${delta}%_B:${body}_S2:${st2}R_SL:${slBuf}_LB:${lbMaj})`,
                  config,
                  totalRetests: totalExecuted,
                  winningTrades: telemetry.total_winning_trades,
                  losingTrades: telemetry.total_losing_trades,
                  beScratches: telemetry.total_be_scratches,
                  structuralScratches: telemetry.total_structural_scratches,
                  stoppedOutCount: stoppedOut,
                  retestWinRatePct: telemetry.retest_win_rate_pct,
                  slHitRatePct: slHitRate,
                  avgRealizedRr: telemetry.avg_realized_rr,
                  profitFactor: telemetry.profit_factor,
                  expectedValueR: telemetry.expected_value_r,
                  netRealizedR: netR,
                  avgMfeR: telemetry.avg_mfe_r,
                  avgMaeR: telemetry.avg_mae_r,
                  stage1Fills: telemetry.stage1_fill_count,
                  stage2Fills: telemetry.stage2_fill_count,
                  stage3Fills: telemetry.stage3_fill_count,
                  compositeScore: parseFloat(score.toFixed(2)),
                });
              }
            }
          }
        }
      }
    }
  }

  console.log(`Archetype 2 produced ${candidates.length - a2StartCount} evaluated configurations.`);

  // Grid definitions for Archetype 3: Reclaimed Shelf / Hybrid Fast Harvest Model
  const a3StartCount = candidates.length;
  console.log('Testing Archetype 3: Reclaimed Shelf & Fast Harvest Parameter Grid...');
  for (const entryM of ['SHELF_LEVEL', 'SWEEP_OB_MT'] as SweepReclaimEntryMode[]) {
    for (const vol of [1.30, 1.40, 1.50]) {
      for (const delta of [52.0, 55.0]) {
        for (const body of [0.50, 0.55]) {
          for (const st2 of [1.3, 1.4, 1.5]) {
            for (const st3 of [2.2, 2.5, 2.8]) {
              for (const slBuf of [0.12, 0.15, 0.20]) {
                const config: SweepReclaimScanConfig = {
                  symbol: 'ETHUSDC',
                  timeframe: '5m',
                  anchorTypes: ALL_ANCHORS,
                  lookbackMajor: 12,
                  lookbackInternal: 5,
                  maxBarsAnchorToSweep: 25,
                  maxBarsSweepToReclaim: 10,
                  maxBarsToRetest: 18,
                  volumeSmaPeriod: 16,
                  volumeExpansionThreshold: vol,
                  deltaDominanceThreshold: delta,
                  bodyRatioThreshold: body,
                  requireThreePillarDisplacement: true,
                  enforceDiscountPremiumGate: true,
                  stage1Multiple: 1.0,
                  stage2Multiple: st2,
                  stage3Multiple: st3,
                  entryMode: entryM,
                  enableStructuralTrail: true,
                  enableProfitRatchet: true,
                  minSweepDepthAtrMultiplier: 0.10,
                  slBufferAtrMultiplier: slBuf,
                };

                const engine = new SweepReclaimEngine(config);
                const { setups, telemetry } = engine.scanHistoricalSetups(candles);
                const executedTrades = setups.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');
                const totalExecuted = executedTrades.length;
                if (totalExecuted < 30) continue;

                const stoppedOut = executedTrades.filter((s) => s.simulated_outcome === 'STOPPED_OUT').length;
                const slHitRate = parseFloat(((stoppedOut / totalExecuted) * 100).toFixed(2));
                let netR = 0;
                for (const trade of executedTrades) netR += trade.realized_rr;
                netR = parseFloat(netR.toFixed(2));

                const score = netR * 0.5 + telemetry.retest_win_rate_pct * 4 + telemetry.profit_factor * 25 - slHitRate * 10;

                candidates.push({
                  id: `A3_${candidateIndex++}`,
                  archetype: 'Archetype 3: Fast Harvest & Reclaimed Shelf',
                  name: `FAST_HARVEST_${entryM} (Vol:${vol}x_D:${delta}%_S2:${st2}R_S3:${st3}R_SL:${slBuf})`,
                  config,
                  totalRetests: totalExecuted,
                  winningTrades: telemetry.total_winning_trades,
                  losingTrades: telemetry.total_losing_trades,
                  beScratches: telemetry.total_be_scratches,
                  structuralScratches: telemetry.total_structural_scratches,
                  stoppedOutCount: stoppedOut,
                  retestWinRatePct: telemetry.retest_win_rate_pct,
                  slHitRatePct: slHitRate,
                  avgRealizedRr: telemetry.avg_realized_rr,
                  profitFactor: telemetry.profit_factor,
                  expectedValueR: telemetry.expected_value_r,
                  netRealizedR: netR,
                  avgMfeR: telemetry.avg_mfe_r,
                  avgMaeR: telemetry.avg_mae_r,
                  stage1Fills: telemetry.stage1_fill_count,
                  stage2Fills: telemetry.stage2_fill_count,
                  stage3Fills: telemetry.stage3_fill_count,
                  compositeScore: parseFloat(score.toFixed(2)),
                });
              }
            }
          }
        }
      }
    }
  }

  console.log(`Archetype 3 produced ${candidates.length - a3StartCount} evaluated configurations.`);
  console.log(`Total configurations evaluated: ${candidates.length}\n`);

  // Sort by Composite Institutional Score (Highest Profit, Highest Win Rate, Lowest SL Hit Rate)
  const rankedCandidates = [...candidates].sort((a, b) => b.compositeScore - a.compositeScore);

  // Group by Archetype and find the best in each archetype
  const bestArchetype1 = rankedCandidates.filter((c) => c.archetype.includes('Archetype 1'))[0];
  const bestArchetype2 = rankedCandidates.filter((c) => c.archetype.includes('Archetype 2'))[0];
  const bestArchetype3 = rankedCandidates.filter((c) => c.archetype.includes('Archetype 3'))[0];

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('🏆 BEST REFINED SETUP FOR EACH OF THE TOP 3 ARCHETYPES:');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');

  const top3Refined = [bestArchetype1, bestArchetype2, bestArchetype3];
  top3Refined.sort((a, b) => b.netRealizedR - a.netRealizedR);

  top3Refined.forEach((c, idx) => {
    console.log(`\n[TOP REFINED #${idx + 1}] ${c.name}`);
    console.log(`  Archetype:           ${c.archetype}`);
    console.log(`  Net Realized Gain:   ${c.netRealizedR > 0 ? '+' : ''}${c.netRealizedR}R`);
    console.log(`  Win Rate:            ${c.retestWinRatePct}% (${c.winningTrades}W / ${c.losingTrades}L / ${c.beScratches} BE Scratches)`);
    console.log(`  Stop Loss Hit Rate:  ${c.slHitRatePct}% (${c.stoppedOutCount} hard stops out of ${c.totalRetests})`);
    console.log(`  Profit Factor:       ${c.profitFactor}`);
    console.log(`  Expected Value (EV): ${c.expectedValueR > 0 ? '+' : ''}${c.expectedValueR}R / trade`);
    console.log(`  Total Trades:        ${c.totalRetests}`);
    console.log(`  Entry Mode:          ${c.config.entryMode}`);
    console.log(`  Pillars:             Vol: ${c.config.volumeExpansionThreshold}x, Delta: ${c.config.deltaDominanceThreshold}%, Body: ${c.config.bodyRatioThreshold}`);
    console.log(`  Harvest Targets:     Stage 1: ${c.config.stage1Multiple}R, Stage 2: ${c.config.stage2Multiple}R, Stage 3: ${c.config.stage3Multiple}R`);
    console.log(`  Stop Buffer:         ${c.config.slBufferAtrMultiplier}x ATR`);
  });

  const absoluteWinner = top3Refined[0];
  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(`👑 ULTIMATE WINNER SETUP: ${absoluteWinner.name}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(`Full Config JSON:\n${JSON.stringify(absoluteWinner.config, null, 2)}`);

  // Save refined results
  const refinedOutputPath = path.join(__dirname, 'quant_lab_top3_refined_results.json');
  fs.writeFileSync(
    refinedOutputPath,
    JSON.stringify(
      {
        evaluated_count: candidates.length,
        top_3_refined: top3Refined,
        winner: absoluteWinner,
      },
      null,
      2
    )
  );
  console.log(`\nRefined results saved to ${refinedOutputPath}`);
}

main().catch(console.error);
