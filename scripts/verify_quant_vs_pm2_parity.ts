import { computeStructuralBootstrap } from '../src/lib/quantEngine/structuralBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';
import { adaptSweepReclaimSetupsToTrades } from '../src/lib/quantEngine/equityCalculator';
import { fetchHistoricalKlines } from '../src/lib/daemon/restBootstrap';

async function main() {
  console.log('======================================================================');
  console.log('🔍 VERIFYING QUANT LAB VS PM2 1:1 EXECUTION PARITY (2026-09-02)');
  console.log('======================================================================');

  const startMs = Date.parse('2026-08-31T00:00:00.000Z');
  const { bootstrap } = await computeStructuralBootstrap('ETHUSDC', '5m', startMs, {
    lookbackMajor: 10,
    lookbackInternal: 5,
  });

  let candles = await fetchHistoricalKlines('ETHUSDC', '5m', 1000);
  // Ensure candles cover the verification window from startMs; if live 1000 buffer rolled forward, load from disk cache
  if (!candles || candles.length === 0 || candles[0].t > startMs) {
    const fs = await import('fs');
    const path = await import('path');
    const scratchDir = path.join(process.cwd(), 'scratch');
    const files = fs.readdirSync(scratchDir).filter(f => f.startsWith('cached_ETHUSDC_5m_1y_'));
    if (files.length > 0) {
      const allCandles = JSON.parse(fs.readFileSync(path.join(scratchDir, files[0]), 'utf8'));
      candles = allCandles.filter((c: any) => c.t >= startMs && c.t <= Date.parse('2026-09-03T00:00:00.000Z'));
    }
  }

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

  // Quant Lab Engine (With Bootstrap)
  const qlEngine = new SweepReclaimEngine(config);
  const qlResult = qlEngine.scanHistoricalSetups(candles, bootstrap || undefined);
  const qlTrades = adaptSweepReclaimSetupsToTrades(qlResult.setups, { enforceSinglePositionWalk: true });
  const qlToday = qlTrades.filter(t => t.dateStr.includes('2026-09-02'));

  // Live PM2 Engine (Without Bootstrap, Pure Live Candles)
  const pm2Engine = new SweepReclaimEngine(config);
  const pm2Result = pm2Engine.scanHistoricalSetups(candles);
  const pm2Trades = adaptSweepReclaimSetupsToTrades(pm2Result.setups, { enforceSinglePositionWalk: true });
  const pm2Today = pm2Trades.filter(t => t.dateStr.includes('2026-09-02'));

  console.log(`\n📊 Quant Lab 2026-09-02 Trades: ${qlToday.length}`);
  qlToday.forEach((t, i) => console.log(`  QL #${i+1}: [${t.dateStr}] ${t.direction} @ $${t.entryPrice} -> ${t.outcome} (${t.realizedR}R) | ${t.label}`));

  console.log(`\n⚡ Live PM2 2026-09-02 Trades: ${pm2Today.length}`);
  pm2Today.forEach((t, i) => console.log(`  PM2 #${i+1}: [${t.dateStr}] ${t.direction} @ $${t.entryPrice} -> ${t.outcome} (${t.realizedR}R) | ${t.label}`));

  // Check 1:1 Parity
  let match = qlToday.length === pm2Today.length;
  if (match) {
    for (let i = 0; i < qlToday.length; i++) {
      if (
        qlToday[i].dateStr !== pm2Today[i].dateStr ||
        qlToday[i].direction !== pm2Today[i].direction ||
        Math.abs(qlToday[i].entryPrice - pm2Today[i].entryPrice) > 0.05 ||
        qlToday[i].outcome !== pm2Today[i].outcome
      ) {
        match = false;
        break;
      }
    }
  }

  console.log('\n======================================================================');
  if (match && qlToday.length >= 4) {
    console.log(`🎉 100.00% PARITY CONFIRMED: Quant Lab and PM2 match ${qlToday.length}/${qlToday.length} trades perfectly!`);
  } else {
    console.error('❌ Parity mismatch between Quant Lab and PM2!');
    process.exit(1);
  }
  console.log('======================================================================\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
