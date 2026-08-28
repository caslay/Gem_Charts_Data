import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { DEFAULT_SR_LIVE_SETTINGS } from '../src/lib/quantEngine/strategyExecutionConfig';

async function diagnose() {
  const symbol = 'ETHUSDC';
  const targetDate = '2026-08-28';
  console.log(`Diagnosing setups for ${targetDate}...`);

  const candles5m = await fetchHistoricalKlines(symbol, '5m', 1000);
  console.log(`Fetched ${candles5m.length} 5m candles.`);

  const scanConfig: SweepReclaimScanConfig = {
    symbol,
    timeframe: '5m',
    anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
    lookbackMajor: 10,
    lookbackInternal: 5,
    maxBarsAnchorToSweep: 25,
    maxBarsSweepToReclaim: 10,
    maxBarsToRetest: 20,
    minSweepDepthAtrMultiplier: 0.10,
    slBufferAtrMultiplier: 0.12,
    entryMode: 'FVG_PROXIMAL',
    stage1Multiple: 1.0,
    stage2Multiple: 1.4,
    stage3Multiple: 3.0,
    enableStructuralTrail: true,
    enableProfitRatchet: true,
    volumeSmaPeriod: 20,
    volumeExpansionThreshold: 1.35,
    deltaDominanceThreshold: 52.0,
    bodyRatioThreshold: 0.50,
    requireThreePillarDisplacement: true,
    enforceDiscountPremiumGate: true,
  };

  const srEngine = new SweepReclaimEngine(scanConfig);
  const scanRes = srEngine.scanHistoricalSetups(candles5m);
  const setups = (scanRes.setups || []).filter((s) => {
    if (!s.reclaim_time) return false;
    return new Date(s.reclaim_time).toISOString().split('T')[0] === targetDate;
  });

  console.log(`Found ${setups.length} setups on ${targetDate}:`);
  for (const s of setups) {
    const timeUtc = new Date(s.reclaim_time || 0).toISOString();
    console.log(`\n--------------------------------------------------`);
    console.log(`Setup ID: ${s.id}`);
    console.log(`Type: ${s.type} | Anchor: ${s.anchor_name} ($${s.anchor_level}) | Reclaim Time: ${timeUtc}`);
    console.log(`Entry Price: $${s.retest_entry_price} | SL: $${s.stop_loss} | TP1: $${s.stage1_target} | TP2: $${s.stage2_target}`);
    console.log(`Status in Quant Lab: ${s.status} | Stage Exit: ${s.stage_exit_type}`);
    console.log(`Retest Time: ${s.retest_time ? new Date(s.retest_time).toISOString() : 'None'}`);
    console.log(`3-Pillar Passed: ${s.three_pillar_displacement_passed} | Vol: ${s.reclaim_volume_expansion?.toFixed(2)}x | Delta: ${s.reclaim_delta_dominance_pct?.toFixed(1)}% | Body: ${s.reclaim_body_ratio?.toFixed(2)}`);
    console.log(`Valuation Aligned: ${s.is_valuation_aligned}`);
  }
}

diagnose().catch(console.error);
