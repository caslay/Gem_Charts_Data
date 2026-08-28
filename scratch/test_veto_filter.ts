import fs from 'fs';
import path from 'path';
import { Candle } from '../src/lib/fvgEngine';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup
} from '../src/lib/quantEngine/SweepReclaimEngine';

interface TemporalBucket {
  key: string;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number;
  slHitRatePct: number;
  netR: number;
  profitFactor: number;
  expectedValueR: number;
  grossWinR: number;
  grossLossR: number;
  maxDrawdownR: number;
}

function computeBucketMetrics(key: string, label: string, tradeList: SweepReclaimSetup[]): TemporalBucket {
  let netR = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let wins = 0;
  let losses = 0;
  let scratches = 0;

  for (const t of tradeList) {
    netR += t.realized_rr;
    if (t.simulated_outcome === 'FULL_TP3_WIN' || t.simulated_outcome === 'FULL_TP2_WIN') {
      wins++;
    } else if (t.simulated_outcome === 'STOPPED_OUT') {
      losses++;
    } else {
      scratches++;
    }

    if (t.realized_rr > 0) {
      grossWinR += t.realized_rr;
    } else {
      grossLossR += Math.abs(t.realized_rr);
    }
  }

  const n = tradeList.length;
  const winRate = n > 0 ? (wins / n) * 100 : 0;
  const slHitRate = n > 0 ? (losses / n) * 100 : 0;
  const pf = grossLossR > 0 ? grossWinR / grossLossR : grossWinR > 0 ? 99.9 : 0;
  const ev = n > 0 ? netR / n : 0;

  let peakR = 0;
  let currentR = 0;
  let maxDDR = 0;
  for (const t of tradeList) {
    currentR += t.realized_rr;
    if (currentR > peakR) peakR = currentR;
    const dd = peakR - currentR;
    if (dd > maxDDR) maxDDR = dd;
  }

  return {
    key,
    label,
    trades: n,
    wins,
    losses,
    scratches,
    winRatePct: parseFloat(winRate.toFixed(1)),
    slHitRatePct: parseFloat(slHitRate.toFixed(1)),
    netR: parseFloat(netR.toFixed(2)),
    profitFactor: parseFloat(pf.toFixed(2)),
    expectedValueR: parseFloat(ev.toFixed(2)),
    grossWinR: parseFloat(grossWinR.toFixed(2)),
    grossLossR: parseFloat(grossLossR.toFixed(2)),
    maxDrawdownR: parseFloat(maxDDR.toFixed(2)),
  };
}

async function main() {
  const championConfig: SweepReclaimScanConfig = {
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
    stage2Multiple: 1.4,
    stage3Multiple: 3.0,
    entryMode: 'FVG_PROXIMAL',
    enableStructuralTrail: true,
    enableProfitRatchet: true,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.12,
  };

  const pathYear1 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_2024_2025.json');
  const candlesYear1: Candle[] = JSON.parse(fs.readFileSync(pathYear1, 'utf8'));

  const pathYear2 = path.resolve(process.cwd(), 'scratch', 'candles_5m_ethusdc_1year.json');
  const candlesYear2: Candle[] = JSON.parse(fs.readFileSync(pathYear2, 'utf8'));

  const candlesCombined: Candle[] = [...candlesYear1, ...candlesYear2].sort((a, b) => a.t - b.t);

  const engine = new SweepReclaimEngine(championConfig);
  const { setups } = engine.scanHistoricalSetups(candlesCombined);
  const executedTrades = setups.filter((s) => s.is_retested && s.simulated_outcome !== 'NO_RETEST' && s.simulated_outcome !== 'INVALIDATED');

  // Veto Filter: Target the specific toxic clusters identified:
  // 1. 16:00 UTC (19:00 Cairo) - Highest SL failure rate of the 24-hour cycle (35%-42% SL rate).
  // 2. 18:00 UTC (21:00 Cairo) on Mondays
  // 3. 23:00 UTC (02:00 Cairo) on Mondays and Thursdays
  // 4. 03:00-04:00 UTC (06:00-07:00 Cairo) on Tuesdays and Sundays
  // 5. Friday evenings (>= 18:00 UTC)
  
  const vetoTrades = executedTrades.filter((t) => {
    const dt = new Date(t.retest_time || t.anchor_time);
    const day = dt.getUTCDay();
    const hour = dt.getUTCHours();

    // 16:00 UTC across all days (The NY Dead Zone Trap)
    if (hour === 16) return false;

    // Monday 18:00 UTC and 23:00 UTC
    if (day === 1 && (hour === 18 || hour === 23)) return false;

    // Tuesday 03:00 UTC
    if (day === 2 && hour === 3) return false;

    // Thursday 23:00 UTC
    if (day === 4 && hour === 23) return false;

    // Friday post 18:00 UTC
    if (day === 5 && hour >= 18) return false;

    // Sunday 04:00 UTC & 21:00 UTC
    if (day === 0 && (hour === 4 || hour === 21)) return false;

    return true;
  });

  const baseMetrics = computeBucketMetrics('BASE', '2-Year Baseline (No Veto)', executedTrades);
  const smartPauseMetrics = computeBucketMetrics('VETO', '2-Year Smart Pause Protocol', vetoTrades);

  console.log('Baseline Trades:', baseMetrics.trades, 'Net R:', baseMetrics.netR, 'Win Rate:', baseMetrics.winRatePct + '%', 'SL Hit Rate:', baseMetrics.slHitRatePct + '%', 'PF:', baseMetrics.profitFactor);
  console.log('Smart Pause Trades:', smartPauseMetrics.trades, 'Net R:', smartPauseMetrics.netR, 'Win Rate:', smartPauseMetrics.winRatePct + '%', 'SL Hit Rate:', smartPauseMetrics.slHitRatePct + '%', 'PF:', smartPauseMetrics.profitFactor);
  console.log('Purged Trades:', baseMetrics.trades - smartPauseMetrics.trades);
}

main().catch(console.error);
