import * as fs from 'fs';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';
import { adaptSweepReclaimSetupsToTrades, calculateCompoundingMetrics } from '../src/lib/quantEngine/equityCalculator';

const candles: Candle[] = JSON.parse(
  fs.readFileSync('scratch/cached_ETHUSDC_5m_1y_1756512000000_1788480000000.json', 'utf8')
);

// Champion + Early BE + Wave Dedup + 45m CD
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
  enableEarlyBreakeven: true,
  earlyBreakevenMultiple: 0.50,
  enableWaveDeduplication: true,
  postLossCooldownMinutes: 45,
};

console.log('Testing Alpha Shield Champion Preset across 1-year candles...');
const t0 = Date.now();
const engine = new SweepReclaimEngine(scanConfig);
const res = engine.scanHistoricalSetups(candles);
console.log(`Scan completed in ${((Date.now() - t0) / 1000).toFixed(2)}s`);

const trades = adaptSweepReclaimSetupsToTrades(res.setups, {
  enforceSinglePositionWalk: true,
  enableWaveDeduplication: true,
  postLossCooldownMinutes: 45,
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

console.log('\n=== Alpha Shield Champion Preset Performance ===');
console.log(`Trades: ${total} | Wins: ${wins} | Scratches: ${scratches} | Losses: ${losses}`);
console.log(`Net R: ${netR > 0 ? '+' : ''}${netR}R | PF: ${pf} | Max DD: -${maxDd.toFixed(2)}R`);
console.log(`Compounded Balance: $${comp.finalRealizedEquity.toLocaleString()} | Max DD %: -${comp.maxDrawdownPct}%`);
