/**
 * scripts/run_clean_parity_grid_search.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional 1-Year Multi-Parameter Grid Search & Alpha Discovery Engine
 * 
 * Evaluates core scan configurations with TRUE candle-by-candle simulation:
 *  - Next-Bar Ratchet Rule inside SweepReclaimEngine (zero lookahead)
 *  - Dynamic 2% Compounding ($10,000 initial equity)
 *  - Post-Loss Cooldown and Single-Position Concurrency Lock
 *  - Zero post-facto ledger mutation (100% bit-for-bit parity to live PM2)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';
import {
  adaptSweepReclaimSetupsToTrades,
  StandardizedExecutedTrade,
} from '../src/lib/quantEngine/equityCalculator';

interface StrategyRunResult {
  scanName: string;
  configId: string;
  entryMode: string;
  anchorUniverse: string;
  displacement: string;
  harvest: string;
  earlyBeMultiple: number | null;
  waveDedup: boolean;
  cooldownMin: number;
  filterWeekend: boolean;
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number;
  scratchRatePct: number;
  lossRatePct: number;
  exScratchWinRatePct: number;
  netR: number;
  grossWinR: number;
  grossLossR: number;
  profitFactor: number;
  expectedValueR: number;
  maxDrawdownR: number;
  compoundingEquity10k: number;
  compoundingMaxDdPct: number;
  sharpeRatioEst: number;
  marRatio: number;
}

function analyzeTrades(trades: StandardizedExecutedTrade[]) {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      scratches: 0,
      winRatePct: 0,
      scratchRatePct: 0,
      lossRatePct: 0,
      exScratchWinRatePct: 0,
      netR: 0,
      grossWinR: 0,
      grossLossR: 0,
      profitFactor: 0,
      expectedValueR: 0,
      maxDrawdownR: 0,
      peakR: 0,
      compoundingEquity10k: 10000,
      compoundingMaxDdPct: 0,
      sharpeRatioEst: 0,
      marRatio: 0,
    };
  }

  let wins = 0;
  let losses = 0;
  let scratches = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let netR = 0;

  let cumulativeR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;

  let equity = 10000;
  let peakEquity = 10000;
  let compoundingMaxDdPct = 0;

  const realizedRList: number[] = [];

  for (const t of trades) {
    const r = t.realizedR;
    realizedRList.push(r);
    netR += r;
    cumulativeR += r;
    if (cumulativeR > peakR) peakR = cumulativeR;
    const currentDd = peakR - cumulativeR;
    if (currentDd > maxDrawdownR) maxDrawdownR = currentDd;

    // Dynamic Compounding (2.0% risk per 1R)
    const tradeRiskDollar = equity * 0.02;
    const dollarPnl = tradeRiskDollar * r;
    equity += dollarPnl;
    if (equity > peakEquity) peakEquity = equity;
    const currentEqDd = ((peakEquity - equity) / peakEquity) * 100;
    if (currentEqDd > compoundingMaxDdPct) compoundingMaxDdPct = currentEqDd;

    if (r > 0.05) {
      if (t.outcome === 'FULL_TP2_WIN' || t.outcome === 'FULL_TP3_WIN' || r >= 1.0) {
        wins++;
      } else {
        scratches++;
      }
      grossWinR += r;
    } else if (r < -0.05) {
      losses++;
      grossLossR += Math.abs(r);
    } else {
      scratches++;
    }
  }

  const winRatePct = parseFloat(((wins / totalTrades) * 100).toFixed(1));
  const scratchRatePct = parseFloat(((scratches / totalTrades) * 100).toFixed(1));
  const lossRatePct = parseFloat(((losses / totalTrades) * 100).toFixed(1));
  const exScratchWinRatePct = (wins + losses) > 0 ? parseFloat(((wins / (wins + losses)) * 100).toFixed(1)) : 0;
  const profitFactor = grossLossR > 0 ? parseFloat((grossWinR / grossLossR).toFixed(2)) : 99.9;
  const expectedValueR = parseFloat((netR / totalTrades).toFixed(2));

  const meanR = netR / totalTrades;
  const variance = realizedRList.reduce((acc, val) => acc + Math.pow(val - meanR, 2), 0) / (totalTrades > 1 ? totalTrades - 1 : 1);
  const stdDev = Math.sqrt(variance);
  const sharpeRatioEst = stdDev > 0 ? parseFloat(((meanR / stdDev) * Math.sqrt(totalTrades)).toFixed(2)) : 0;

  const compoundedRoiPct = ((equity - 10000) / 10000) * 100;
  const marRatio = compoundingMaxDdPct > 0 ? parseFloat((compoundedRoiPct / compoundingMaxDdPct).toFixed(2)) : 0;

  return {
    totalTrades,
    wins,
    losses,
    scratches,
    winRatePct,
    scratchRatePct,
    lossRatePct,
    exScratchWinRatePct,
    netR: parseFloat(netR.toFixed(2)),
    grossWinR: parseFloat(grossWinR.toFixed(2)),
    grossLossR: parseFloat(grossLossR.toFixed(2)),
    profitFactor,
    expectedValueR,
    maxDrawdownR: parseFloat(maxDrawdownR.toFixed(2)),
    peakR: parseFloat(peakR.toFixed(2)),
    compoundingEquity10k: parseFloat(equity.toFixed(2)),
    compoundingMaxDdPct: parseFloat(compoundingMaxDdPct.toFixed(1)),
    sharpeRatioEst,
    marRatio,
  };
}

async function main() {
  console.log('═'.repeat(95));
  console.log('🔬  CLEAN 1-YEAR 100% PARITY MULTI-PARAMETER GRID SEARCH (106,560 BARS)');
  console.log('═'.repeat(95));

  const endMs = Date.parse('2026-09-04T00:00:00.000Z');
  const startMs = Date.parse('2025-09-04T00:00:00.000Z');
  const warmupMs = startMs - 5 * 24 * 60 * 60 * 1000;

  const scratchDir = path.join(process.cwd(), 'scratch');
  const cachePath = path.join(scratchDir, `cached_ETHUSDC_5m_1y_${warmupMs}_${endMs}.json`);

  if (!fs.existsSync(cachePath)) {
    console.error(`❌ Cache not found at ${cachePath}`);
    process.exit(1);
  }

  console.log(`📂 Loading cached 1-year historical dataset from disk...`);
  const candles: Candle[] = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  console.log(`✅ Loaded ${candles.length} candles (${(candles.length / 288).toFixed(1)} days of 5m data).\n`);

  const allAnchors = ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'];
  const macroAnchors = ['ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'];

  // Define Matrix of True In-Engine Configurations (simulated candle-by-candle)
  const coreScans: Array<{
    name: string;
    config: SweepReclaimScanConfig;
    anchorUniverse: string;
    displacement: string;
    harvest: string;
    earlyBeMultiple: number | null;
  }> = [];

  // 1. FVG Proximal variations
  for (const be of [0.40, 0.50, 0.60, null]) {
    coreScans.push({
      name: `FVG_PROX_ALL_${be !== null ? `BE${be.toFixed(2)}` : 'NoBE'}`,
      anchorUniverse: 'ALL',
      displacement: '1.20x Vol | 52% Delta',
      harvest: '50% @ 1.0R | 50% @ 1.4R',
      earlyBeMultiple: be,
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: allAnchors,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 20,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.4,
        stage3Multiple: 3.0,
        stage1Ratio: 0.50,
        stage2Ratio: 0.50,
        stage3Ratio: 0.00,
        entryMode: 'FVG_PROXIMAL',
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.10,
        enableEarlyBreakeven: be !== null,
        earlyBreakevenMultiple: be ?? 0.50,
      },
    });
  }

  // 2. FVG CE variations
  for (const be of [0.40, 0.50, 0.60, null]) {
    coreScans.push({
      name: `FVG_CE_ALL_${be !== null ? `BE${be.toFixed(2)}` : 'NoBE'}`,
      anchorUniverse: 'ALL',
      displacement: '1.20x Vol | 52% Delta',
      harvest: '50% @ 1.0R | 50% @ 1.4R',
      earlyBeMultiple: be,
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: allAnchors,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 20,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.4,
        stage3Multiple: 3.0,
        stage1Ratio: 0.50,
        stage2Ratio: 0.50,
        stage3Ratio: 0.00,
        entryMode: 'FVG_CE',
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.10,
        enableEarlyBreakeven: be !== null,
        earlyBreakevenMultiple: be ?? 0.50,
      },
    });
  }

  // 3. Order Block Mean Threshold (OB MT) variations
  for (const be of [0.40, 0.50, 0.60, null]) {
    coreScans.push({
      name: `OB_MT_ALL_${be !== null ? `BE${be.toFixed(2)}` : 'NoBE'}`,
      anchorUniverse: 'ALL',
      displacement: '1.20x Vol | 52% Delta',
      harvest: '50% @ 1.0R | 50% @ 1.4R',
      earlyBeMultiple: be,
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: allAnchors,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 20,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.4,
        stage3Multiple: 3.0,
        stage1Ratio: 0.50,
        stage2Ratio: 0.50,
        stage3Ratio: 0.00,
        entryMode: 'SWEEP_OB_MT',
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.10,
        enableEarlyBreakeven: be !== null,
        earlyBreakevenMultiple: be ?? 0.50,
      },
    });
  }

  // 4. Macro Anchors Only (FVG Proximal)
  for (const be of [0.40, 0.50, 0.60, null]) {
    coreScans.push({
      name: `FVG_PROX_MACRO_${be !== null ? `BE${be.toFixed(2)}` : 'NoBE'}`,
      anchorUniverse: 'MACRO_ONLY',
      displacement: '1.20x Vol | 52% Delta',
      harvest: '50% @ 1.0R | 50% @ 1.4R',
      earlyBeMultiple: be,
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: macroAnchors,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 20,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.4,
        stage3Multiple: 3.0,
        stage1Ratio: 0.50,
        stage2Ratio: 0.50,
        stage3Ratio: 0.00,
        entryMode: 'FVG_PROXIMAL',
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.10,
        enableEarlyBreakeven: be !== null,
        earlyBreakevenMultiple: be ?? 0.50,
      },
    });
  }

  // 5. Extended Harvest (50% @ 1.0R / 50% @ 1.8R)
  for (const be of [0.40, 0.50]) {
    coreScans.push({
      name: `FVG_PROX_EXTENDED_1.8R_${be !== null ? `BE${be.toFixed(2)}` : 'NoBE'}`,
      anchorUniverse: 'ALL',
      displacement: '1.20x Vol | 52% Delta',
      harvest: '50% @ 1.0R | 50% @ 1.8R',
      earlyBeMultiple: be,
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: allAnchors,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 20,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.8,
        stage3Multiple: 3.0,
        stage1Ratio: 0.50,
        stage2Ratio: 0.50,
        stage3Ratio: 0.00,
        entryMode: 'FVG_PROXIMAL',
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.10,
        enableEarlyBreakeven: true,
        earlyBreakevenMultiple: be,
      },
    });
  }

  // 6. High Conviction Volume (1.40x Vol, 55% Delta)
  for (const be of [0.40, 0.50]) {
    coreScans.push({
      name: `FVG_PROX_HIGH_VOL_${be !== null ? `BE${be.toFixed(2)}` : 'NoBE'}`,
      anchorUniverse: 'ALL',
      displacement: '1.40x Vol | 55% Delta',
      harvest: '50% @ 1.0R | 50% @ 1.4R',
      earlyBeMultiple: be,
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: allAnchors,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 20,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.40,
        deltaDominanceThreshold: 55.0,
        bodyRatioThreshold: 0.45,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        stage1Multiple: 1.0,
        stage2Multiple: 1.4,
        stage3Multiple: 3.0,
        stage1Ratio: 0.50,
        stage2Ratio: 0.50,
        stage3Ratio: 0.00,
        entryMode: 'FVG_PROXIMAL',
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        minSweepDepthAtrMultiplier: 0.10,
        slBufferAtrMultiplier: 0.10,
        enableEarlyBreakeven: true,
        earlyBreakevenMultiple: be,
      },
    });
  }

  // Execution variations per scan
  const waveDedupOptions = [true, false];
  const cooldownOptions = [0, 30, 45, 60];
  const weekendOptions = [false, true];

  const allResults: StrategyRunResult[] = [];

  console.log(`🚀 Executing ${coreScans.length} True In-Engine Scans across 106,560 bars...`);
  const startTime = Date.now();

  for (let sIdx = 0; sIdx < coreScans.length; sIdx++) {
    const sc = coreScans[sIdx];
    const tScan0 = Date.now();
    process.stdout.write(`  [${String(sIdx + 1).padStart(2)}/${coreScans.length}] Scanning "${sc.name}"... `);

    const engine = new SweepReclaimEngine(sc.config);
    const scanResult = engine.scanHistoricalSetups(candles);
    const scanMs = Date.now() - tScan0;

    const windowSetups = scanResult.setups.filter((s) => {
      const t = s.retest_time || s.reclaim_time || s.sweep_time || s.anchor_time || 0;
      return t >= startMs && t <= endMs;
    });

    console.log(`done in ${(scanMs / 1000).toFixed(2)}s (${windowSetups.length} setups).`);

    // Permute execution risk controls in memory (NO post-facto early BE patching)
    for (const waveDedup of waveDedupOptions) {
      for (const cooldown of cooldownOptions) {
        for (const weekend of weekendOptions) {
          const trades = adaptSweepReclaimSetupsToTrades(windowSetups, {
            enforceSinglePositionWalk: true,
            enableWaveDeduplication: waveDedup,
            filterWeekend: weekend,
            enableEarlyBreakeven: false, // In-Engine Early BE already executed!
            postLossCooldownMinutes: cooldown,
          });

          const metrics = analyzeTrades(trades);

          if (metrics.totalTrades >= 50) {
            const beStr = sc.earlyBeMultiple !== null ? `BE@+${sc.earlyBeMultiple.toFixed(2)}R` : 'NoBE';
            const cdStr = cooldown > 0 ? `CD${cooldown}m` : 'NoCD';
            const wdStr = waveDedup ? 'WaveDedup' : 'NoDedup';
            const wkStr = weekend ? 'NoWknd' : 'AllDays';
            const configId = `${sc.name}__${wdStr}__${cdStr}__${wkStr}`;

            allResults.push({
              scanName: sc.name,
              configId,
              entryMode: sc.config.entryMode as string,
              anchorUniverse: sc.anchorUniverse,
              displacement: sc.displacement,
              harvest: sc.harvest,
              earlyBeMultiple: sc.earlyBeMultiple,
              waveDedup,
              cooldownMin: cooldown,
              filterWeekend: weekend,
              ...metrics,
            });
          }
        }
      }
    }
  }

  const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n🎉 Grid Search Completed in ${totalDurationSec}s! Evaluated ${allResults.length} true execution configurations.\n`);

  // Rank by Net R Return
  const topByNetR = [...allResults].sort((a, b) => b.netR - a.netR);

  // Rank by MAR Ratio (Compounded ROI % / Max Drawdown %) (Min 150 trades)
  const topByMAR = [...allResults]
    .filter((r) => r.totalTrades >= 150 && r.netR > 50)
    .sort((a, b) => b.marRatio - a.marRatio);

  // Rank by Expected Value per Trade (Min 150 trades)
  const topByEV = [...allResults]
    .filter((r) => r.totalTrades >= 150)
    .sort((a, b) => b.expectedValueR - a.expectedValueR);

  console.log('═'.repeat(125));
  console.log('🏆 TOP 15 CONFIGURATIONS BY NET R RETURN (100% TRUE PATH REALITY & PM2 PARITY)');
  console.log('═'.repeat(125));
  console.log(`Rank | Config ID                                                   | Trades | Win%  | Net R    | PF    | MaxDD (R) | $10k Equity | CompDD% | MAR`);
  console.log('-----+-------------------------------------------------------------+--------+-------+----------+-------+-----------+-------------+---------+------');
  for (let i = 0; i < Math.min(15, topByNetR.length); i++) {
    const r = topByNetR[i];
    console.log(
      `${String(i + 1).padStart(4)} | ${r.configId.padEnd(59)} | ${String(r.totalTrades).padStart(6)} | ${String(r.winRatePct + '%').padStart(5)} | ${String('+' + r.netR.toFixed(1) + 'R').padStart(8)} | ${String(r.profitFactor.toFixed(2)).padStart(5)} | ${String('-' + r.maxDrawdownR.toFixed(1) + 'R').padStart(9)} | ${String('$' + Math.round(r.compoundingEquity10k).toLocaleString()).padStart(11)} | ${String(r.compoundingMaxDdPct.toFixed(1) + '%').padStart(7)} | ${r.marRatio.toFixed(1)}`
    );
  }

  console.log('\n' + '═'.repeat(125));
  console.log('🛡️  TOP 15 CONFIGURATIONS BY MAR RATIO (Compounded ROI % / Max DD %) (Min 150 Trades, Net R > 50R)');
  console.log('═'.repeat(125));
  console.log(`Rank | Config ID                                                   | Trades | Win%  | Net R    | PF    | MaxDD (R) | $10k Equity | CompDD% | MAR`);
  console.log('-----+-------------------------------------------------------------+--------+-------+----------+-------+-----------+-------------+---------+------');
  for (let i = 0; i < Math.min(15, topByMAR.length); i++) {
    const r = topByMAR[i];
    console.log(
      `${String(i + 1).padStart(4)} | ${r.configId.padEnd(59)} | ${String(r.totalTrades).padStart(6)} | ${String(r.winRatePct + '%').padStart(5)} | ${String('+' + r.netR.toFixed(1) + 'R').padStart(8)} | ${String(r.profitFactor.toFixed(2)).padStart(5)} | ${String('-' + r.maxDrawdownR.toFixed(1) + 'R').padStart(9)} | ${String('$' + Math.round(r.compoundingEquity10k).toLocaleString()).padStart(11)} | ${String(r.compoundingMaxDdPct.toFixed(1) + '%').padStart(7)} | ${r.marRatio.toFixed(1)}`
    );
  }

  console.log('\n' + '═'.repeat(125));
  console.log('🎯 TOP 15 CONFIGURATIONS BY EXPECTED VALUE PER TRADE (EV/trade) (Min 150 Trades)');
  console.log('═'.repeat(125));
  console.log(`Rank | Config ID                                                   | Trades | Win%  | Net R    | EV (R) | PF    | MaxDD (R) | $10k Equity | CompDD%`);
  console.log('-----+-------------------------------------------------------------+--------+-------+----------+--------+-------+-----------+-------------+---------');
  for (let i = 0; i < Math.min(15, topByEV.length); i++) {
    const r = topByEV[i];
    console.log(
      `${String(i + 1).padStart(4)} | ${r.configId.padEnd(59)} | ${String(r.totalTrades).padStart(6)} | ${String(r.winRatePct + '%').padStart(5)} | ${String('+' + r.netR.toFixed(1) + 'R').padStart(8)} | ${String('+' + r.expectedValueR.toFixed(2) + 'R').padStart(6)} | ${String(r.profitFactor.toFixed(2)).padStart(5)} | ${String('-' + r.maxDrawdownR.toFixed(1) + 'R').padStart(9)} | ${String('$' + Math.round(r.compoundingEquity10k).toLocaleString()).padStart(11)} | ${String(r.compoundingMaxDdPct.toFixed(1) + '%').padStart(7)}`
    );
  }

  // Save full results JSON to scratch for forensic record
  const outPath = path.join(scratchDir, 'grid_search_clean_parity_results.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        topByNetR: topByNetR.slice(0, 50),
        topByMAR: topByMAR.slice(0, 50),
        topByEV: topByEV.slice(0, 50),
        summary: {
          totalEvaluated: allResults.length,
          coreScansCount: coreScans.length,
        },
      },
      null,
      2
    )
  );
  console.log(`\n💾 Saved forensic audit results to ${outPath}`);
}

main().catch(console.error);
