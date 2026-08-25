/**
 * scripts/audit_quant_lab_parity.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive 20-Run Mathematical Parity & Splicing-Drift Audit Suite.
 * 
 * Executes 20 sequential Quant Lab backtests across 20 distinct start dates
 * using identical strategy parameters on ETHUSDC. Extracts all trades falling
 * within the shared target evaluation window and performs a rigorous field-by-field
 * JSON equality comparison to prove 100.00% mathematical parity.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { SweepReclaimEngine, SweepReclaimScanConfig, SweepReclaimSetup } from '../src/lib/quantEngine/SweepReclaimEngine';
import { OrderBlockEngine, OrderBlockScanConfig, InstitutionalOrderBlock } from '../src/lib/quantEngine/OrderBlockEngine';
import { computeStructuralBootstrap, timeframeToMs } from '../src/lib/quantEngine/structuralBootstrap';
import { Candle } from '../src/lib/fvgEngine';

const AUDIT_OUT_DIR = path.join(process.cwd(), '.cache', 'audit_runs');

function ensureAuditDir() {
  if (!fs.existsSync(AUDIT_OUT_DIR)) {
    fs.mkdirSync(AUDIT_OUT_DIR, { recursive: true });
  }
}

/**
 * Deterministic synthetic candle generator for offline simulation consistency
 */
function generateDeterministicCandles(startMs: number, endMs: number, interval: string): Candle[] {
  const intervalMs = timeframeToMs(interval);
  const candles: Candle[] = [];
  let currentPrice = 3000.0;
  let t = Math.floor(startMs / intervalMs) * intervalMs;

  let seed = 1337;
  function pseudoRandom() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  while (t <= endMs) {
    const delta = (pseudoRandom() - 0.49) * 12.0;
    const o = currentPrice;
    const c = o + delta;
    const h = Math.max(o, c) + pseudoRandom() * 6.0;
    const l = Math.min(o, c) - pseudoRandom() * 6.0;
    const v = 800 + pseudoRandom() * 1400;
    const range = Math.max(0.0001, h - l);
    const conviction = Math.min(1.0, Math.max(0.0, (c - l) / range));
    const taker_buy_vol = parseFloat((v * conviction).toFixed(2));
    const taker_sell_vol = parseFloat(Math.max(0, v - taker_buy_vol).toFixed(2));

    candles.push({
      t,
      o: parseFloat(o.toFixed(2)),
      h: parseFloat(h.toFixed(2)),
      l: parseFloat(l.toFixed(2)),
      c: parseFloat(c.toFixed(2)),
      v: parseFloat(v.toFixed(2)),
      taker_buy_vol,
      taker_sell_vol,
      isClosed: true,
    });

    currentPrice = c;
    t += intervalMs;
  }

  return candles;
}

// 20 Distinct Start Dates spanning 3 months back to target start
const START_DATES = [
  '2026-06-01',
  '2026-06-08',
  '2026-06-15',
  '2026-06-22',
  '2026-07-01',
  '2026-07-08',
  '2026-07-15',
  '2026-07-22',
  '2026-07-29',
  '2026-08-01',
  '2026-08-03',
  '2026-08-05',
  '2026-08-08',
  '2026-08-10',
  '2026-08-12',
  '2026-08-14',
  '2026-08-16',
  '2026-08-18',
  '2026-08-19',
  '2026-08-20', // Final start date matches the common window start!
];

const TARGET_WINDOW_START = '2026-08-20T00:00:00.000Z';
const TARGET_WINDOW_END = '2026-08-28T23:59:59.000Z';
const TARGET_START_MS = Date.parse(TARGET_WINDOW_START);
const TARGET_END_MS = Date.parse(TARGET_WINDOW_END);

const SYMBOL = 'ETHUSDC';
const TIMEFRAME = '15m';

interface NormalizedSetupAuditRecord {
  anchor_level: number;
  anchor_type: string;
  sweep_price: number | null;
  reclaim_close_price: number | null;
  retest_price: number | null;
  entry_price: number;
  stop_loss: number;
  stage1_target: number;
  stage2_target: number;
  stage3_target: number;
  status: string;
  realized_rr: number | null;
  trigger_time_iso: string;
}

function extractTargetWindowSetups(
  allSetups: SweepReclaimSetup[],
  targetStartMs: number,
  targetEndMs: number
): NormalizedSetupAuditRecord[] {
  return allSetups
    .filter((s) => {
      const triggerTime = s.reclaim_time ?? s.sweep_time ?? s.anchor_time;
      return triggerTime >= targetStartMs && triggerTime <= targetEndMs;
    })
    .map((s) => {
      const triggerTime = s.reclaim_time ?? s.sweep_time ?? s.anchor_time;
      return {
        anchor_level: s.anchor_level,
        anchor_type: s.anchor_type,
        sweep_price: s.sweep_price,
        reclaim_close_price: s.reclaim_close_price,
        retest_price: s.retest_price,
        entry_price: s.entry_price,
        stop_loss: s.stop_loss,
        stage1_target: s.stage1_target,
        stage2_target: s.stage2_target,
        stage3_target: s.stage3_target,
        status: s.status,
        realized_rr: s.realized_rr,
        trigger_time_iso: new Date(triggerTime).toISOString(),
      };
    })
    .sort((a, b) => a.trigger_time_iso.localeCompare(b.trigger_time_iso));
}

async function runAudit() {
  console.log('======================================================================');
  console.log('🏛️ FLOW-STATE QUANT LAB — 20-RUN MATHEMATICAL PARITY AUDIT');
  console.log('======================================================================');
  console.log(`Target Parity Evaluation Window: [${TARGET_WINDOW_START} -> ${TARGET_WINDOW_END}]`);
  console.log(`Instrument: ${SYMBOL} | Timeframe: ${TIMEFRAME} | Total Runs: ${START_DATES.length}`);
  console.log('──────────────────────────────────────────────────────────────────────\n');

  ensureAuditDir();

  const strategyConfig: SweepReclaimScanConfig = {
    symbol: SYMBOL,
    timeframe: TIMEFRAME as any,
    anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
    lookbackMajor: 15,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 30,
    maxBarsSweepToReclaim: 12,
    maxBarsToRetest: 24,
    volumeExpansionThreshold: 1.5,
    deltaDominanceThreshold: 55.0,
    bodyRatioThreshold: 0.55,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
    stage1Multiple: 1.0,
    stage2Multiple: 1.5,
    stage3Multiple: 3.0,
    entryMode: 'SWEEP_OB_MT',
    enableStructuralTrail: true,
    enableProfitRatchet: true,
    minSweepDepthAtrMultiplier: 0.1,
    slBufferAtrMultiplier: 0.15,
  };

  // Pre-generate the master continuous candle series from earliest start to end
  const earliestStartMs = Date.parse(`${START_DATES[0]}T00:00:00.000Z`);
  console.log(`Generating master continuous dataset from ${START_DATES[0]} to ${TARGET_WINDOW_END.slice(0, 10)}...`);
  const masterCandles = generateDeterministicCandles(earliestStartMs - (45 * 24 * 3600 * 1000), TARGET_END_MS, TIMEFRAME);
  console.log(`Master dataset ready: ${masterCandles.length} candles.\n`);

  const runResults: { runIndex: number; startDate: string; targetSetups: NormalizedSetupAuditRecord[] }[] = [];

  for (let i = 0; i < START_DATES.length; i++) {
    const startDateStr = START_DATES[i];
    const startMs = Date.parse(`${startDateStr}T00:00:00.000Z`);

    // 1. Resolve 3-Tier Structural Bootstrap at T-Zero of this run
    const { warmupStartMs, bootstrap } = await computeStructuralBootstrap(SYMBOL, TIMEFRAME, startMs, {
      lookbackMajor: strategyConfig.lookbackMajor,
      lookbackInternal: strategyConfig.lookbackInternal,
    });

    // 2. Continuous candle ingestion starting from standardized warmupStartMs
    const runCandles = masterCandles.filter((c) => c.t >= warmupStartMs && c.t <= TARGET_END_MS);

    // 3. Execute Quantitative Engine with bootstrap
    const engine = new SweepReclaimEngine(strategyConfig);
    const { setups } = engine.scanHistoricalSetups(runCandles, bootstrap);

    // 4. Extract setups strictly within target parity window
    const targetSetups = extractTargetWindowSetups(setups, TARGET_START_MS, TARGET_END_MS);

    runResults.push({
      runIndex: i + 1,
      startDate: startDateStr,
      targetSetups,
    });

    // Save JSON audit artifact
    const runJsonPath = path.join(AUDIT_OUT_DIR, `run_${String(i + 1).padStart(2, '0')}_${startDateStr}.json`);
    fs.writeFileSync(runJsonPath, JSON.stringify(targetSetups, null, 2), 'utf-8');

    console.log(
      `✓ Run ${String(i + 1).padStart(2, ' ')}/20 [Start: ${startDateStr}]: Scanned ${runCandles.length} candles -> Found ${setups.length} total setups (${targetSetups.length} in target window)`
    );
  }

  console.log('\n──────────────────────────────────────────────────────────────────────');
  console.log('🔬 PARITY COMPARISON & DRIFT AUDIT');
  console.log('──────────────────────────────────────────────────────────────────────\n');

  const baselineRun = runResults[0];
  const baselineCount = baselineRun.targetSetups.length;
  const baselineJson = JSON.stringify(baselineRun.targetSetups);

  let allRunsIdentical = true;
  let totalDiscrepancies = 0;

  console.log(`Baseline (Run 1: Start ${baselineRun.startDate}): ${baselineCount} Setups in target window`);
  console.log('Comparing Runs 2-20 against Baseline...\n');

  for (let i = 1; i < runResults.length; i++) {
    const currentRun = runResults[i];
    const currentJson = JSON.stringify(currentRun.targetSetups);
    const isMatch = currentJson === baselineJson;

    if (!isMatch) {
      allRunsIdentical = false;
      totalDiscrepancies++;
      console.error(
        `❌ MISMATCH on Run ${currentRun.runIndex} (${currentRun.startDate}): Expected ${baselineCount} setups, got ${currentRun.targetSetups.length}`
      );
    } else {
      console.log(
        `✅ Run ${String(currentRun.runIndex).padStart(2, ' ')} (${currentRun.startDate}): 100.00% MATCH (${currentRun.targetSetups.length}/${baselineCount} setups identical)`
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 2: ORDER BLOCK & BREAKER ENGINE 20-RUN PARITY AUDIT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n======================================================================');
  console.log('🏛️ SECTION 2: ORDER BLOCK & BREAKER 20-RUN PARITY AUDIT');
  console.log('======================================================================\n');

  const obStrategyConfig: OrderBlockScanConfig = {
    symbol: SYMBOL,
    timeframe: TIMEFRAME as any,
    minQualityTier: 'ALL',
    maxBarsToMitigation: 24,
    enableBreakerSimulation: true,
    maxBreakerRetestBars: 20,
    enableDynamicManagement: true,
    tp1Multiple: 1.0,
    tp2Multiple: 1.5,
    positionScalingMode: 'THREE_STAGE_HARVEST',
    trailingStopMode: 'STRUCTURAL_FVG_TRAIL',
    entryMode: 'BOUNDARY',
    targetRewardRatio: 2.5,
  };

  const obRunResults: { runIndex: number; startDate: string; targetBlocks: any[] }[] = [];

  for (let i = 0; i < START_DATES.length; i++) {
    const startDateStr = START_DATES[i];
    const startMs = Date.parse(`${startDateStr}T00:00:00.000Z`);

    const { warmupStartMs, bootstrap } = await computeStructuralBootstrap(SYMBOL, TIMEFRAME, startMs, {
      lookbackMajor: 15,
      lookbackInternal: 5,
    });

    const runCandles = masterCandles.filter((c) => c.t >= warmupStartMs && c.t <= TARGET_END_MS);

    const obEngine = new OrderBlockEngine(obStrategyConfig);
    const { orderBlocks } = obEngine.scanHistoricalOrderBlocks(runCandles, bootstrap);

    const targetBlocks = orderBlocks
      .filter((b) => {
        const triggerTime = b.mitigation_time ?? b.origin_time;
        return triggerTime >= TARGET_START_MS && triggerTime <= TARGET_END_MS;
      })
      .map((b) => ({
        type: b.type,
        top: b.top,
        bottom: b.bottom,
        mean_threshold: b.mean_threshold,
        quality_tier: b.quality_tier,
        lifecycle_status: b.lifecycle_status,
        mitigation_price: b.mitigation_price,
        trigger_time_iso: new Date(b.mitigation_time ?? b.origin_time).toISOString(),
      }))
      .sort((a, b) => a.trigger_time_iso.localeCompare(b.trigger_time_iso));

    obRunResults.push({
      runIndex: i + 1,
      startDate: startDateStr,
      targetBlocks,
    });

    console.log(
      `✓ OB Run ${String(i + 1).padStart(2, ' ')}/20 [Start: ${startDateStr}]: Scanned ${runCandles.length} candles -> Found ${orderBlocks.length} total blocks (${targetBlocks.length} in target window)`
    );
  }

  console.log('\n──────────────────────────────────────────────────────────────────────');
  console.log('🔬 ORDER BLOCK PARITY COMPARISON & DRIFT AUDIT');
  console.log('──────────────────────────────────────────────────────────────────────\n');

  const obBaseline = obRunResults[0];
  const obBaselineCount = obBaseline.targetBlocks.length;
  const obBaselineJson = JSON.stringify(obBaseline.targetBlocks);

  let obAllIdentical = true;
  let obDiscrepancies = 0;

  for (let i = 1; i < obRunResults.length; i++) {
    const currentRun = obRunResults[i];
    const currentJson = JSON.stringify(currentRun.targetBlocks);
    const isMatch = currentJson === obBaselineJson;

    if (!isMatch) {
      obAllIdentical = false;
      obDiscrepancies++;
      console.error(
        `❌ MISMATCH on OB Run ${currentRun.runIndex} (${currentRun.startDate}): Expected ${obBaselineCount} blocks, got ${currentRun.targetBlocks.length}`
      );
      for (let k = 0; k < Math.min(obBaseline.targetBlocks.length, currentRun.targetBlocks.length); k++) {
        const b1 = obBaseline.targetBlocks[k];
        const b2 = currentRun.targetBlocks[k];
        if (JSON.stringify(b1) !== JSON.stringify(b2)) {
          console.error(`  -> Diff at index ${k}:`);
          console.error('     Run 1 :', JSON.stringify(b1));
          console.error(`     Run ${currentRun.runIndex}:`, JSON.stringify(b2));
          break;
        }
      }
    } else {
      console.log(
        `✅ OB Run ${String(currentRun.runIndex).padStart(2, ' ')} (${currentRun.startDate}): 100.00% MATCH (${currentRun.targetBlocks.length}/${obBaselineCount} blocks identical)`
      );
    }
  }

  console.log('\n======================================================================');
  if (allRunsIdentical && obAllIdentical && totalDiscrepancies === 0 && obDiscrepancies === 0) {
    console.log('🎉 FINAL AUDIT RESULT: 100.00% MATHEMATICAL PARITY ACROSS ALL ENGINES');
    console.log(`   - Sweep & Reclaim Parity: 20/20 (100.00%)`);
    console.log(`   - Order Block & Breaker Parity: 20/20 (100.00%)`);
    console.log(`   - Total Executed Tests: 40/40 Identical`);
    console.log(`   - Splicing-Dependent Drift: 0.000%`);
    console.log(`   - Zero-Drift 3-Tier Midnight Ledger is 100% Operational.`);
  } else {
    console.error(`💥 FINAL AUDIT FAILED: Discrepancies detected.`);
    process.exit(1);
  }
  console.log('======================================================================\n');
}

runAudit().catch((err) => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
