/**
 * scripts/inspect_tonight_setups.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Inspects all setups detected by SweepReclaimEngine on August 26, 2026
 * between 15:00 UTC and 20:00 UTC (18:00 to 23:00 Cairo).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';

async function fetchBinanceKlines(symbol: string = 'ETHUSDC', interval: string = '5m', limit: number = 300): Promise<Candle[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error: ${res.statusText}`);
  const data = (await res.json()) as any[];

  return data.map((k) => {
    const o = parseFloat(k[1]);
    const h = parseFloat(k[2]);
    const l = parseFloat(k[3]);
    const c = parseFloat(k[4]);
    const v = parseFloat(k[5]);
    const taker_buy = parseFloat(k[9]);
    return {
      t: k[0],
      o,
      h,
      l,
      c,
      v,
      taker_buy_vol: taker_buy,
      taker_sell_vol: Math.max(0, v - taker_buy),
      isClosed: true,
    };
  });
}

async function main() {
  const candles = await fetchBinanceKlines('ETHUSDC', '5m', 300);

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
    volumeExpansionThreshold: 1.35,
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.50,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
    entryMode: 'FVG_PROXIMAL',
    stage1Multiple: 1.0,
    stage2Multiple: 1.4,
    stage3Multiple: 3.0,
    enableStructuralTrail: true,
    enableProfitRatchet: true,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.12,
  };

  const engine = new SweepReclaimEngine(scanConfig);
  const result = engine.scanHistoricalSetups(candles);

  console.log('======================================================================');
  console.log('ALL SETUPS DETECTED TONIGHT (AFTER 15:00 UTC / 18:00 CAIRO):');
  console.log('======================================================================');

  const tonightCutoff = Date.parse('2026-08-26T15:00:00.000Z');
  const tonightSetups = result.setups.filter((s) => s.anchor_time >= tonightCutoff);

  for (const s of tonightSetups) {
    const anchorUtc = new Date(s.anchor_time).toISOString().replace('T', ' ').substring(0, 19);
    const anchorCairo = new Date(s.anchor_time + 3 * 3600 * 1000).toISOString().replace('T', ' ').substring(11, 19);
    const sweepCairo = s.sweep_time ? new Date(s.sweep_time + 3 * 3600 * 1000).toISOString().replace('T', ' ').substring(11, 19) : 'N/A';
    const reclaimCairo = s.reclaim_time ? new Date(s.reclaim_time + 3 * 3600 * 1000).toISOString().replace('T', ' ').substring(11, 19) : 'N/A';
    const retestCairo = s.retest_time ? new Date(s.retest_time + 3 * 3600 * 1000).toISOString().replace('T', ' ').substring(11, 19) : 'N/A';

    console.log(`\n• ID: ${s.id}`);
    console.log(`  Direction: ${s.type} | Anchor: $${s.anchor_level.toFixed(2)} (${anchorUtc} UTC / ${anchorCairo} Cairo)`);
    console.log(`  Phase: ${s.phase} | Status: ${s.status} | 3-Pillars: ${s.three_pillar_displacement_passed}`);
    console.log(`  Sweep: $${s.sweep_price} (${sweepCairo} Cairo) | Reclaim: $${s.reclaim_close_price} (${reclaimCairo} Cairo)`);
    console.log(`  Entry: $${s.entry_price.toFixed(2)} | SL: $${s.stop_loss.toFixed(2)}`);
    console.log(`  Retested: ${s.is_retested} (${retestCairo} Cairo) | Simulated Outcome: ${s.simulated_outcome} | Realized RR: ${s.realized_rr}R`);
  }
}

main().catch((err) => console.error(err));
