/**
 * scripts/audit_early_be_candle_path.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Rigorous Forensic Audit of Early Breakeven (+0.60R MFE)
 * Simulates EXACT candle-by-candle path physics:
 *  1. Order fills at entryPrice on candle E.
 *  2. On candle E:
 *     - For LONG: entry was touched (low <= entry).
 *     - If high reached >= entry + 0.60*risk ON THE SAME CANDLE, did it touch SL on that candle?
 *       In reality, if it entered, the dip to low happened BEFORE the surge to high (or vice versa).
 *  3. On subsequent candles (E+1, E+2, ...):
 *     - If SL is still INITIAL:
 *         - Check if high reached >= entry + 0.60*risk: if so, SL ratchets to entryPrice!
 *         - Check if low <= original SL: if so, STOPPED_OUT (-1.00R).
 *     - If SL is BREAKEVEN (ratcheted after 0.60R MFE was achieved):
 *         - Check if high reached TP1 (1.0R): if so, TP1 filled!
 *         - Check if high reached TP2 (1.4R): if so, FULL_TP2_WIN (+1.20R)!
 *         - Check if low <= entryPrice: if so, BE_SCRATCH (0.00R)!
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';
import { adaptSweepReclaimSetupsToTrades, calculateCompoundingMetrics } from '../src/lib/quantEngine/equityCalculator';

const candles: Candle[] = JSON.parse(
  fs.readFileSync('scratch/cached_ETHUSDC_5m_1y_1756512000000_1788480000000.json', 'utf8')
);

// Map timestamp to candle index
const candleMap = new Map<number, number>();
for (let i = 0; i < candles.length; i++) {
  candleMap.set(candles[i].t, i);
}

// 1. Run baseline scan to identify all confirmed retest entries
const scanConfig: SweepReclaimScanConfig = {
  symbol: 'ETHUSDC',
  timeframe: '5m',
  anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
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
  enableEarlyBreakeven: false, // Extract pure setups
};

console.log('🔬 Scanning setups across 106,560 candles...');
const engine = new SweepReclaimEngine(scanConfig);
const rawScan = engine.scanHistoricalSetups(candles);

const retestedSetups = rawScan.setups.filter((s) => s.is_retested && s.retest_time);
console.log(`Identified ${retestedSetups.length} raw retested setups.`);

interface PathSimulationResult {
  id: string;
  type: string;
  outcome: 'FULL_TP2_WIN' | 'STAGE_1_SCRATCH' | 'BE_SCRATCH' | 'STOPPED_OUT';
  realizedR: number;
  entryTime: number;
  exitTime: number;
  mfeR: number;
  maeR: number;
  barsHeld: number;
}

function simulateExactCandlePath(
  setup: any,
  earlyBeThreshold: number,
  sameBarBeProtection: boolean // if true, newly ratcheted BE SL on bar i does NOT check low of bar i
): PathSimulationResult {
  const entryIdx = candleMap.get(setup.retest_time);
  if (entryIdx === undefined) {
    return {
      id: setup.id,
      type: setup.type,
      outcome: setup.simulated_outcome,
      realizedR: setup.realized_rr || 0,
      entryTime: setup.retest_time,
      exitTime: setup.exit_time || setup.retest_time,
      mfeR: setup.mfe_r || 0,
      maeR: setup.mae_r || 0,
      barsHeld: 0,
    };
  }

  const isLong = setup.type === 'BULLISH';
  const entry = setup.entry_price;
  const initialSL = setup.stop_loss;
  const risk = Math.abs(entry - initialSL);

  const tp1 = isLong ? entry + 1.0 * risk : entry - 1.0 * risk;
  const tp2 = isLong ? entry + 1.4 * risk : entry - 1.4 * risk;

  let activeSL = initialSL;
  let isEarlyBeActive = false;
  let isStage1Hit = false;
  let maxMfe = 0;
  let maxMae = 0;

  const maxHoldBars = 288; // 24 hours max
  const endIdx = Math.min(candles.length - 1, entryIdx + maxHoldBars);

  for (let i = entryIdx; i <= endIdx; i++) {
    const c = candles[i];
    const barsHeld = i - entryIdx + 1;

    // Track MFE & MAE
    if (isLong) {
      const barMfe = (c.h - entry) / risk;
      const barMae = (entry - c.l) / risk;
      if (barMfe > maxMfe) maxMfe = barMfe;
      if (barMae > maxMae) maxMae = barMae;
    } else {
      const barMfe = (entry - c.l) / risk;
      const barMae = (c.h - entry) / risk;
      if (barMfe > maxMfe) maxMfe = barMfe;
      if (barMae > maxMae) maxMae = barMae;
    }

    if (isLong) {
      // 1. Check if TP1 already hit
      if (!isStage1Hit && c.h >= tp1) {
        isStage1Hit = true;
        activeSL = entry; // TP1 reached -> SL at breakeven
        isEarlyBeActive = true;
      }

      // 2. Check if TP2 hit (after TP1)
      if (isStage1Hit && c.h >= tp2) {
        return {
          id: setup.id,
          type: setup.type,
          outcome: 'FULL_TP2_WIN',
          realizedR: 1.20, // 50% @ 1.0R + 50% @ 1.4R
          entryTime: setup.retest_time,
          exitTime: c.t,
          mfeR: parseFloat(maxMfe.toFixed(2)),
          maeR: parseFloat(maxMae.toFixed(2)),
          barsHeld,
        };
      }

      // 3. Early Breakeven Check (before TP1)
      let beRatchetedThisBar = false;
      if (!isStage1Hit && !isEarlyBeActive && maxMfe >= earlyBeThreshold) {
        isEarlyBeActive = true;
        activeSL = entry;
        beRatchetedThisBar = true;
      }

      // 4. Check Stop Loss Violation
      // On the candle where BE ratcheted, if sameBarBeProtection is true, don't check entry against that bar's low
      const effectiveSL = (beRatchetedThisBar && sameBarBeProtection) ? initialSL : activeSL;
      if (c.l <= effectiveSL) {
        if (isStage1Hit) {
          // Harvested TP1 (50% @ 1.0R), stopped at BE on runner (50% @ 0.0R) = +0.50R
          return {
            id: setup.id,
            type: setup.type,
            outcome: 'STAGE_1_SCRATCH',
            realizedR: 0.50,
            entryTime: setup.retest_time,
            exitTime: c.t,
            mfeR: parseFloat(maxMfe.toFixed(2)),
            maeR: parseFloat(maxMae.toFixed(2)),
            barsHeld,
          };
        } else if (isEarlyBeActive) {
          // Early Breakeven scratch
          return {
            id: setup.id,
            type: setup.type,
            outcome: 'BE_SCRATCH',
            realizedR: 0.00,
            entryTime: setup.retest_time,
            exitTime: c.t,
            mfeR: parseFloat(maxMfe.toFixed(2)),
            maeR: parseFloat(maxMae.toFixed(2)),
            barsHeld,
          };
        } else {
          // Full stop out
          return {
            id: setup.id,
            type: setup.type,
            outcome: 'STOPPED_OUT',
            realizedR: -1.00,
            entryTime: setup.retest_time,
            exitTime: c.t,
            mfeR: parseFloat(maxMfe.toFixed(2)),
            maeR: parseFloat(maxMae.toFixed(2)),
            barsHeld,
          };
        }
      }
    } else {
      // BEARISH SHORT
      // 1. Check if TP1 hit
      if (!isStage1Hit && c.l <= tp1) {
        isStage1Hit = true;
        activeSL = entry;
        isEarlyBeActive = true;
      }

      // 2. Check if TP2 hit
      if (isStage1Hit && c.l <= tp2) {
        return {
          id: setup.id,
          type: setup.type,
          outcome: 'FULL_TP2_WIN',
          realizedR: 1.20,
          entryTime: setup.retest_time,
          exitTime: c.t,
          mfeR: parseFloat(maxMfe.toFixed(2)),
          maeR: parseFloat(maxMae.toFixed(2)),
          barsHeld,
        };
      }

      // 3. Early Breakeven Check
      let beRatchetedThisBar = false;
      if (!isStage1Hit && !isEarlyBeActive && maxMfe >= earlyBeThreshold) {
        isEarlyBeActive = true;
        activeSL = entry;
        beRatchetedThisBar = true;
      }

      // 4. Check Stop Loss Violation
      const effectiveSL = (beRatchetedThisBar && sameBarBeProtection) ? initialSL : activeSL;
      if (c.h >= effectiveSL) {
        if (isStage1Hit) {
          return {
            id: setup.id,
            type: setup.type,
            outcome: 'STAGE_1_SCRATCH',
            realizedR: 0.50,
            entryTime: setup.retest_time,
            exitTime: c.t,
            mfeR: parseFloat(maxMfe.toFixed(2)),
            maeR: parseFloat(maxMae.toFixed(2)),
            barsHeld,
          };
        } else if (isEarlyBeActive) {
          return {
            id: setup.id,
            type: setup.type,
            outcome: 'BE_SCRATCH',
            realizedR: 0.00,
            entryTime: setup.retest_time,
            exitTime: c.t,
            mfeR: parseFloat(maxMfe.toFixed(2)),
            maeR: parseFloat(maxMae.toFixed(2)),
            barsHeld,
          };
        } else {
          return {
            id: setup.id,
            type: setup.type,
            outcome: 'STOPPED_OUT',
            realizedR: -1.00,
            entryTime: setup.retest_time,
            exitTime: c.t,
            mfeR: parseFloat(maxMfe.toFixed(2)),
            maeR: parseFloat(maxMae.toFixed(2)),
            barsHeld,
          };
        }
      }
    }
  }

  // Fallback if expired
  return {
    id: setup.id,
    type: setup.type,
    outcome: isStage1Hit ? 'STAGE_1_SCRATCH' : 'BE_SCRATCH',
    realizedR: isStage1Hit ? 0.50 : 0.00,
    entryTime: setup.retest_time,
    exitTime: candles[endIdx].t,
    mfeR: parseFloat(maxMfe.toFixed(2)),
    maeR: parseFloat(maxMae.toFixed(2)),
    barsHeld: endIdx - entryIdx + 1,
  };
}

// Test multiple Early BE thresholds (0.50R, 0.60R, 0.70R, 0.80R, and Baseline None)
const thresholds = [
  { name: 'Raw Baseline (No Early BE)', threshold: 999.0 },
  { name: 'Early BE @ 0.50R MFE', threshold: 0.50 },
  { name: 'Early BE @ 0.60R MFE', threshold: 0.60 },
  { name: 'Early BE @ 0.70R MFE', threshold: 0.70 },
  { name: 'Early BE @ 0.80R MFE', threshold: 0.80 },
];

console.log('\n' + '═'.repeat(90));
console.log('🏛️  REAL-WORLD CANDLE PATH SIMULATION RESULTS (Sequential Single-Position Walk)');
console.log('═'.repeat(90));

for (const t of thresholds) {
  // 1. Simulate every setup
  const simulatedSetups = retestedSetups.map((s) => {
    const res = simulateExactCandlePath(s, t.threshold, true);
    return {
      ...s,
      simulated_outcome: res.outcome,
      realized_rr: res.realizedR,
      exit_time: res.exitTime,
      mfe_r: res.mfeR,
      mae_r: res.maeR,
    };
  });

  // 2. Walk sequentially with maxOpenPositions: 1
  const trades = adaptSweepReclaimSetupsToTrades(simulatedSetups as any, {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: false,
    filterWeekend: false,
    postLossCooldownMinutes: 0,
  });

  const total = trades.length;
  const wins = trades.filter((tr) => tr.isWin && tr.realizedR >= 1.0).length;
  const scratches = trades.filter((tr) => tr.realizedR >= 0 && tr.realizedR < 1.0).length;
  const losses = trades.filter((tr) => tr.isLoss).length;
  const netR = parseFloat(trades.reduce((acc, tr) => acc + tr.realizedR, 0).toFixed(2));
  const grossWin = trades.filter((tr) => tr.realizedR > 0).reduce((acc, tr) => acc + tr.realizedR, 0);
  const grossLoss = trades.filter((tr) => tr.realizedR < 0).reduce((acc, tr) => acc + Math.abs(tr.realizedR), 0);
  const pf = grossLoss > 0 ? parseFloat((grossWin / grossLoss).toFixed(2)) : 99.9;

  let peak = 0;
  let cum = 0;
  let maxDd = 0;
  for (const tr of trades) {
    cum += tr.realizedR;
    if (cum > peak) peak = cum;
    if (peak - cum > maxDd) maxDd = peak - cum;
  }

  const comp = calculateCompoundingMetrics(trades, {
    initialCapital: 10000,
    riskPerTradePct: 2.0,
    compoundingMode: 'DYNAMIC_COMPOUNDING',
  });

  console.log(`\n▶ ${t.name}:`);
  console.log(`  Trades: ${total} | Wins: ${wins} (${((wins/total)*100).toFixed(1)}%) | Scratches: ${scratches} (${((scratches/total)*100).toFixed(1)}%) | Losses: ${losses} (${((losses/total)*100).toFixed(1)}%)`);
  console.log(`  Net R: ${netR > 0 ? '+' : ''}${netR}R | PF: ${pf} | Max Drawdown: -${maxDd.toFixed(2)}R`);
  console.log(`  Compounded $10k Equity: $${comp.finalRealizedEquity.toLocaleString()} (Max DD: -${comp.maxDrawdownPct}%)`);
}
