/**
 * scripts/inspect_parity_discrepancy.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Granular Forensics: Quant Lab Backtest vs Live PM2 Daemon Execution Discrepancy
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { fetchHistoricalKlines } from '../src/lib/daemon/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades } from '../src/lib/quantEngine/equityCalculator';

async function main() {
  console.log('======================================================================');
  console.log('🔬 FORENSIC INVESTIGATION: QUANT LAB VS LIVE PM2 RECONCILIATION');
  console.log('======================================================================\n');

  const candles = await fetchHistoricalKlines('ETHUSDC', '5m', 1000);
  console.log(`✓ Fetched ${candles.length} recent 5m candles from Binance Futures.`);

  const config: SweepReclaimScanConfig = {
    symbol: 'ETHUSDC',
    timeframe: '5m',
    anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
    lookbackMajor: 10,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 25,
    maxBarsSweepToReclaim: 10,
    maxBarsToRetest: 20,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.10,
    entryMode: 'FVG_PROXIMAL',
    stage1Multiple: 1.0,
    stage2Multiple: 1.4,
    stage3Multiple: 3.0,
    stage1Ratio: 0.50,
    stage2Ratio: 0.50,
    stage3Ratio: 0.00,
    enableStructuralTrail: true,
    enableProfitRatchet: false,
    volumeSmaPeriod: 20,
    volumeExpansionThreshold: 1.20,
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.40,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
  };

  const engine = new SweepReclaimEngine(config);
  const result = engine.scanHistoricalSetups(candles);
  const trades = adaptSweepReclaimSetupsToTrades(result.setups, { enforceSinglePositionWalk: true });

  const todayTrades = trades.filter(t => t.dateStr.includes('2026-09-02'));

  console.log(`\n📋 All Quant Lab Setups for 2026-09-02 (${todayTrades.length} executed trades):`);
  todayTrades.forEach((t, i) => {
    console.log(`\n[Trade #${i + 1}] ID: ${t.id}`);
    console.log(`  Time: ${t.dateStr} | Dir: ${t.direction} | Anchor: ${t.label}`);
    console.log(`  Entry Price: $${t.entryPrice} | SL: $${t.stopLossPrice} | Exit: $${t.exitPrice}`);
    console.log(`  Outcome: ${t.outcome} (${t.realizedR}R)`);
    console.log(`  MFE: +${t.metadata?.mfeR}R | MAE: ${t.metadata?.maeR}R`);
  });

  // Specifically inspect the setup at 10:20 Cairo
  console.log('\n----------------------------------------------------------------------');
  console.log('🔍 DEEP-DIVE: Setup #6 (10:20 Cairo / 07:20 UTC)');
  console.log('----------------------------------------------------------------------');
  const setup1020 = result.setups.find(s => {
    const d = new Date(s.reclaim_time || s.anchor_time || 0);
    return d.toISOString().includes('2026-09-02') && d.getUTCHours() === 7 && d.getUTCMinutes() === 20;
  });

  if (setup1020) {
    console.log(`ID: ${setup1020.id}`);
    console.log(`Type: ${setup1020.type} | Anchor: ${setup1020.anchor_name} ($${setup1020.anchor_level})`);
    console.log(`Reclaim Price: $${setup1020.reclaim_price} | Entry Mode: ${setup1020.entry_mode}`);
    console.log(`Calculated Entry Price: $${setup1020.entry_price}`);
    console.log(`Retest Time: ${setup1020.retest_time ? new Date(setup1020.retest_time).toISOString() : 'None'}`);
    console.log(`Outcome: ${setup1020.simulated_outcome}`);
  }

  // Inspect candles around 07:20 UTC (10:20 Cairo)
  console.log('\n🕯️ Candles from 07:15 UTC to 08:30 UTC:');
  const candlesWindow = candles.filter(c => {
    const d = new Date(c.t);
    return d.toISOString().includes('2026-09-02') && d.getUTCHours() >= 7 && d.getUTCHours() <= 8;
  });
  candlesWindow.forEach(c => {
    const d = new Date(c.t);
    const cairoH = (d.getUTCHours() + 3) % 24;
    const cairoM = d.getUTCMinutes().toString().padStart(2, '0');
    console.log(`  [${cairoH}:${cairoM} Cairo / ${d.toISOString().slice(11, 16)} UTC] O: ${c.o} | H: ${c.h} | L: ${c.l} | C: ${c.c}`);
  });

  // Specifically inspect setup at 18:45 Cairo
  console.log('\n----------------------------------------------------------------------');
  console.log('🔍 DEEP-DIVE: Setup #7 (18:45 Cairo / 15:45 UTC)');
  console.log('----------------------------------------------------------------------');
  const setup1845 = result.setups.find(s => {
    const d = new Date(s.reclaim_time || s.anchor_time || 0);
    return d.toISOString().includes('2026-09-02') && d.getUTCHours() === 15 && d.getUTCMinutes() === 45;
  });

  if (setup1845) {
    console.log(`ID: ${setup1845.id}`);
    console.log(`Type: ${setup1845.type} | Anchor: ${setup1845.anchor_name} ($${setup1845.anchor_level})`);
    console.log(`Calculated Entry Price: $${setup1845.entry_price}`);
    console.log(`Retest Time: ${setup1845.retest_time ? new Date(setup1845.retest_time).toISOString() : 'None'}`);
    console.log(`Outcome: ${setup1845.simulated_outcome}`);
  }

  // Check resting order timeout / expiration logic in AutomatedStrategyExecutionEngine
  console.log('\n----------------------------------------------------------------------');
  console.log('🔍 CHECKING RESTING ORDER / LIMIT TIMEOUT RULES');
  console.log('----------------------------------------------------------------------');
}

main().catch(console.error);
