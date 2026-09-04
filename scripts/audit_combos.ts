import * as fs from 'fs';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';
import { adaptSweepReclaimSetupsToTrades, calculateCompoundingMetrics } from '../src/lib/quantEngine/equityCalculator';

const candles: Candle[] = JSON.parse(
  fs.readFileSync('scratch/cached_ETHUSDC_5m_1y_1756512000000_1788480000000.json', 'utf8')
);
const candleMap = new Map<number, number>();
for (let i = 0; i < candles.length; i++) candleMap.set(candles[i].t, i);

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
  enableEarlyBreakeven: false,
};

const engine = new SweepReclaimEngine(scanConfig);
const rawScan = engine.scanHistoricalSetups(candles);
const retestedSetups = rawScan.setups.filter((s) => s.is_retested && s.retest_time);

function simulateExactCandlePath(setup: any, earlyBeThreshold: number) {
  const entryIdx = candleMap.get(setup.retest_time);
  if (entryIdx === undefined) return setup;

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
  const endIdx = Math.min(candles.length - 1, entryIdx + 288);

  for (let i = entryIdx; i <= endIdx; i++) {
    const c = candles[i];
    if (isLong) {
      const barMfe = (c.h - entry) / risk;
      if (barMfe > maxMfe) maxMfe = barMfe;

      if (!isStage1Hit && c.h >= tp1) {
        isStage1Hit = true;
        activeSL = entry;
        isEarlyBeActive = true;
      }
      if (isStage1Hit && c.h >= tp2) {
        return { ...setup, simulated_outcome: 'FULL_TP2_WIN', realized_rr: 1.20, exit_time: c.t, is_stage1_filled: true, is_stage2_filled: true };
      }
      let beRatchetedThisBar = false;
      if (!isStage1Hit && !isEarlyBeActive && maxMfe >= earlyBeThreshold) {
        isEarlyBeActive = true;
        activeSL = entry;
        beRatchetedThisBar = true;
      }
      const effectiveSL = beRatchetedThisBar ? initialSL : activeSL;
      if (c.l <= effectiveSL) {
        if (isStage1Hit) return { ...setup, simulated_outcome: 'STAGE_1_SCRATCH', realized_rr: 0.50, exit_time: c.t, is_stage1_filled: true };
        if (isEarlyBeActive) return { ...setup, simulated_outcome: 'BE_SCRATCH_WIN', realized_rr: 0.00, exit_time: c.t, is_be_scratch: true };
        return { ...setup, simulated_outcome: 'STOPPED_OUT', realized_rr: -1.00, exit_time: c.t };
      }
    } else {
      const barMfe = (entry - c.l) / risk;
      if (barMfe > maxMfe) maxMfe = barMfe;

      if (!isStage1Hit && c.l <= tp1) {
        isStage1Hit = true;
        activeSL = entry;
        isEarlyBeActive = true;
      }
      if (isStage1Hit && c.l <= tp2) {
        return { ...setup, simulated_outcome: 'FULL_TP2_WIN', realized_rr: 1.20, exit_time: c.t, is_stage1_filled: true, is_stage2_filled: true };
      }
      let beRatchetedThisBar = false;
      if (!isStage1Hit && !isEarlyBeActive && maxMfe >= earlyBeThreshold) {
        isEarlyBeActive = true;
        activeSL = entry;
        beRatchetedThisBar = true;
      }
      const effectiveSL = beRatchetedThisBar ? initialSL : activeSL;
      if (c.h >= effectiveSL) {
        if (isStage1Hit) return { ...setup, simulated_outcome: 'STAGE_1_SCRATCH', realized_rr: 0.50, exit_time: c.t, is_stage1_filled: true };
        if (isEarlyBeActive) return { ...setup, simulated_outcome: 'BE_SCRATCH_WIN', realized_rr: 0.00, exit_time: c.t, is_be_scratch: true };
        return { ...setup, simulated_outcome: 'STOPPED_OUT', realized_rr: -1.00, exit_time: c.t };
      }
    }
  }
  return { ...setup, simulated_outcome: 'BE_SCRATCH_WIN', realized_rr: 0.00, exit_time: candles[endIdx].t };
}

// Audit 4 Combos with Exact Path Simulation
const combos = [
  { name: '1. Early BE 0.50R alone', be: 0.50, dedup: false, cd: 0, anchors: 'ALL' },
  { name: '2. Early BE 0.50R + Wave Dedup + 45m CD', be: 0.50, dedup: true, cd: 45, anchors: 'ALL' },
  { name: '3. Early BE 0.60R + Wave Dedup + 45m CD', be: 0.60, dedup: true, cd: 45, anchors: 'ALL' },
  { name: '4. Early BE 0.50R + Wave Dedup + 45m CD (SWING_PIVOT ONLY)', be: 0.50, dedup: true, cd: 45, anchors: 'SWING_ONLY' },
];

for (const cb of combos) {
  let list = retestedSetups;
  if (cb.anchors === 'SWING_ONLY') list = list.filter((s: any) => s.anchor_type === 'SWING_PIVOT');
  const sim = list.map((s: any) => simulateExactCandlePath(s, cb.be));
  const trades = adaptSweepReclaimSetupsToTrades(sim as any, {
    enforceSinglePositionWalk: true,
    enableWaveDeduplication: cb.dedup,
    postLossCooldownMinutes: cb.cd,
    filterWeekend: false,
  });

  const total = trades.length;
  const wins = trades.filter((t) => t.isWin && t.realizedR >= 1.0).length;
  const scratches = trades.filter((t) => t.realizedR >= 0 && t.realizedR < 1.0).length;
  const losses = trades.filter((t) => t.isLoss).length;
  const netR = parseFloat(trades.reduce((a, t) => a + t.realizedR, 0).toFixed(2));
  const winR = trades.filter((t) => t.realizedR > 0).reduce((a, t) => a + t.realizedR, 0);
  const lossR = trades.filter((t) => t.realizedR < 0).reduce((a, t) => a + Math.abs(t.realizedR), 0);
  const pf = lossR > 0 ? parseFloat((winR / lossR).toFixed(2)) : 99.9;

  let peak = 0, cum = 0, maxDd = 0;
  for (const t of trades) {
    cum += t.realizedR;
    if (cum > peak) peak = cum;
    if (peak - cum > maxDd) maxDd = peak - cum;
  }

  const comp = calculateCompoundingMetrics(trades, { initialCapital: 10000, riskPerTradePct: 2.0 });
  console.log(`\n=== ${cb.name} ===`);
  console.log(`Trades: ${total} | Wins: ${wins} | Scratches: ${scratches} | Losses: ${losses}`);
  console.log(`Net R: ${netR > 0 ? '+' : ''}${netR}R | PF: ${pf} | Max DD: -${maxDd.toFixed(2)}R`);
  console.log(`Compounded Balance: $${comp.finalRealizedEquity.toLocaleString()} | Max DD %: -${comp.maxDrawdownPct}%`);
}
