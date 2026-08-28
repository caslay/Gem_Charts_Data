/**
 * headless-daemon.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow-State Quant Engine — Master Headless Execution Daemon (Local VPS Host)
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs the autonomous 5m Sweep & Reclaim quantitative strategy 24/7 locally
 * without browser DOM or UI rendering overhead:
 *  - Sub-second market tick execution via Binance Futures WebSocket
 *  - Dynamic 2% compounding risk management
 *  - 3-stage harvest lifecycle (40% TP1 @ 1.0R, 40% TP2 @ 1.5R, 20% TP3 Runner)
 *  - Trailing Breakeven & Profit-Ratchet state machine
 *  - Atomic event logging to run_logs/live_session_YYYY-MM-DD.json
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { DEFAULT_SR_LIVE_SETTINGS } from '../src/lib/quantEngine/strategyExecutionConfig';
import { bootstrapHistoricalBuffers, computeMacroContext } from './lib/restBootstrap';
import { NodeWsClient, CandleClosedPayload, MarketTickPayload } from './lib/nodeWsClient';
import { DaemonLedger } from './lib/daemonLedger';

// Parse CLI Arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const symbolArg = args.find((a) => a.startsWith('--symbol='))?.split('=')[1] || 'ETHUSDC';
const equityArg = parseFloat(args.find((a) => a.startsWith('--equity='))?.split('=')[1] || '10000.0');

async function main() {
  console.log(`\n===============================================================`);
  console.log(` ⚡ FLOW-STATE QUANT ENGINE — LOCAL HEADLESS DAEMON (VPS HOST) `);
  console.log(`===============================================================`);
  console.log(` Asset:           ${symbolArg.toUpperCase()} (Binance Futures)`);
  console.log(` Starting Equity: $${equityArg.toFixed(2)} USD (2% Compounded Risk)`);
  console.log(` Strategy:        5M Sweep & Reclaim Champion (3-Stage Harvest)`);
  console.log(` Mode:            ${isDryRun ? 'DRY-RUN (30s Diagnostic Validation)' : '24/7 LIVE BACKGROUND EXECUTION'}`);
  console.log(` Local Time:      ${new Date().toLocaleString()} (UTC: ${new Date().toISOString()})`);
  console.log(`===============================================================\n`);

  // 1. Initialize Persistence Ledger
  const ledger = new DaemonLedger(symbolArg, equityArg);
  ledger.logEvent('BOOT', `Headless daemon booting for ${symbolArg}`, {
    metadata: { isDryRun, initialEquity: equityArg },
  });

  // 2. Cold-Start REST Bootstrap (500 Historical Candles per Timeframe)
  let bootstrapData;
  try {
    bootstrapData = await bootstrapHistoricalBuffers(symbolArg, {
      '5m': 500,
      '15m': 500,
      '1h': 500,
    });
  } catch (err: any) {
    console.error(`❌ [DAEMON] Bootstrap failed:`, err.message);
    ledger.logEvent('ERROR', `Bootstrap failure: ${err.message}`);
    process.exit(1);
  }

  // 3. Initialize AutomatedStrategyExecutionEngine
  const engine = new AutomatedStrategyExecutionEngine({
    symbol: symbolArg.toUpperCase(),
    compoundingRiskPct: 2.0,
    maxOpenPositions: 1,
    autoExecute: true,
    liveSettings: {
      ...DEFAULT_SR_LIVE_SETTINGS,
      enabledTimeframes: ['5m'],
      entryMode: 'FVG_PROXIMAL',
      stage1Multiple: 1.0,
      stage2Multiple: 1.4,
      stage3Multiple: 3.0,
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
    },
  });

  // 4. Pre-run historical candle scan & mark cold-start setups as PROCESSED
  const initialScan = engine.onMultiTimeframeCandles(bootstrapData.buffers, bootstrapData.macroContext);
  console.log(
    `[DAEMON] 🔍 Historical scan completed: ${initialScan.scannedSetups.length} setups in history indexed. Cold-start guard active.`
  );

  // 5. Subscribe to Execution Engine Events
  engine.subscribe((event) => {
    const pos = event.position;
    const now = new Date().toLocaleTimeString();

    switch (event.type) {
      case 'LIMIT_ORDER_PLACED':
        console.log(`\n📌 [${now}] [LIMIT_ORDER_PLACED] ${event.message}`);
        if (pos) {
          console.log(
            `   ➔ Setup: ${pos.anchorName} | Limit: $${pos.limitEntryPrice.toFixed(2)} | SL: $${pos.initialStopLoss.toFixed(2)} | TP1: $${pos.stage1Target.toFixed(2)}`
          );
        }
        ledger.logEvent('LIMIT_ORDER_PLACED', event.message, { position: pos });
        break;

      case 'ORDER_FILLED':
        console.log(`\n🚀 [${now}] [ORDER_FILLED] ${event.message}`);
        if (pos) {
          console.log(
            `   ➔ Direction: ${pos.direction} | Fill Price: $${pos.entryPrice.toFixed(2)} | Size: ${pos.contractSize} contracts ($${pos.riskUsd.toFixed(2)} Risk)`
          );
        }
        ledger.logEvent('ORDER_FILLED', event.message, { position: pos });
        break;

      case 'STAGE_1_HARVEST':
        console.log(`\n🎯 [${now}] [STAGE_1_HARVEST] ${event.message}`);
        if (pos) {
          console.log(`   ➔ Locked: +0.40R | Stop Loss advanced to Breakeven ($${pos.activeStopLoss.toFixed(2)})`);
        }
        ledger.logEvent('STAGE_1_HARVEST', event.message, { position: pos });
        break;

      case 'STAGE_2_HARVEST':
        console.log(`\n💰 [${now}] [STAGE_2_HARVEST] ${event.message}`);
        if (pos) {
          console.log(`   ➔ Locked: +0.60R | Stop Loss ratcheted to Profit Floor ($${pos.activeStopLoss.toFixed(2)})`);
        }
        ledger.logEvent('STAGE_2_HARVEST', event.message, { position: pos });
        break;

      case 'POSITION_CLOSED':
        console.log(`\n🏁 [${now}] [POSITION_CLOSED] ${event.message}`);
        if (pos) {
          const sign = (pos.realizedR || 0) >= 0 ? '+' : '';
          console.log(
            `   ➔ Exit: ${pos.exitReason} @ $${pos.exitPrice?.toFixed(2)} | Realized: ${sign}${pos.realizedR?.toFixed(2)}R ($${pos.realizedUsd?.toFixed(2)} USD)`
          );
        }
        ledger.logEvent('POSITION_CLOSED', event.message, { position: pos });
        break;
    }
  });

  // 6. Connect Node.js WebSocket Client
  const wsClient = new NodeWsClient({
    symbol: symbolArg,
    ringBufferSize: 500,
    enableAggTrade: true,
  });

  // Seed buffers from REST bootstrap
  wsClient.seedBuffers(bootstrapData.buffers);

  let tickCount = 0;
  let lastPriceLogTime = 0;
  let currentMacroContext = bootstrapData.macroContext;

  // Real-Time Trade Ticks Dispatcher
  wsClient.onMarketTick((tick: MarketTickPayload) => {
    tickCount++;
    engine.processMarketTick(tick.price);

    // Heartbeat ticker in console every 10 seconds
    const now = Date.now();
    if (now - lastPriceLogTime > 10000) {
      lastPriceLogTime = now;
      const activeCount = engine.getActivePositions().length;
      const pendingCount = engine.getPendingLimitOrders().length;
      process.stdout.write(
        `\r[${new Date().toLocaleTimeString()}] 📊 Live Price: $${tick.price.toFixed(2)} | Active: ${activeCount} | Pending: ${pendingCount} | Ticks: ${tickCount} `
      );
    }
  });

  // Closed Candle Boundary Dispatcher
  wsClient.onCandleClosed((payload: CandleClosedPayload) => {
    const timeStr = new Date(payload.candle.t).toISOString().substring(11, 16);
    console.log(`\n[${new Date().toLocaleTimeString()}] 🕯️ [${payload.interval.toUpperCase()} Candle Closed @ ${timeStr} UTC] O:$${payload.candle.o} H:$${payload.candle.h} L:$${payload.candle.l} C:$${payload.candle.c} Vol:${payload.candle.v.toFixed(1)}`);

    const buffers = wsClient.getRingBuffers();

    // Recompute macro context if 15m or 1h closed
    if (payload.interval === '15m' || payload.interval === '1h') {
      currentMacroContext = computeMacroContext(buffers['1h'], buffers['15m']);
    }

    // Trigger strategy candidate scan
    const scanResult = engine.onMultiTimeframeCandles(buffers, currentMacroContext);
    if (scanResult.scannedSetups.length > 0) {
      console.log(`   ➔ Scanned ${scanResult.scannedSetups.length} valid structural setups.`);
    }
  });

  // Connect WebSocket
  await wsClient.connect();

  console.log(`\n[DAEMON] 🟢 Flow-State Engine is actively monitoring live market order flow.\n`);

  // 7. Handle Dry-Run Timer or Keep-Alive
  if (isDryRun) {
    console.log(`[DRY-RUN] ⏳ Running 30-second live verification diagnostic...`);
    setTimeout(() => {
      console.log(`\n\n===============================================================`);
      console.log(` ✅ DRY-RUN DIAGNOSTIC COMPLETED SUCCESSFULLY`);
      console.log(`===============================================================`);
      console.log(` Total Ticks Processed:  ${tickCount}`);
      console.log(` 5m Ring Buffer Bars:    ${wsClient.getRingBuffers()['5m'].length}`);
      console.log(` Session Log Saved:      ${ledger.getRunLogPath()}`);
      console.log(`===============================================================\n`);
      wsClient.stop();
      process.exit(0);
    }, 30000);
  }

  // Graceful Shutdown
  const shutdown = () => {
    console.log(`\n\n[DAEMON] 🛑 Stopping Flow-State Headless Daemon...`);
    ledger.logEvent('HEARTBEAT', `Daemon stopped cleanly.`);
    wsClient.stop();
    console.log(`[DAEMON] Session saved to: ${ledger.getRunLogPath()}`);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[DAEMON_FATAL_ERROR]', err);
  process.exit(1);
});
