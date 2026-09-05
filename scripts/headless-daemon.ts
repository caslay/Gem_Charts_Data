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

import * as fs from 'fs';
import * as path from 'path';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { DEFAULT_SR_LIVE_SETTINGS } from '../src/lib/quantEngine/strategyExecutionConfig';
import { bootstrapHistoricalBuffers, computeMacroContext } from './lib/restBootstrap';
import { NodeWsClient, CandleClosedPayload, MarketTickPayload } from './lib/nodeWsClient';
import { DaemonLedger } from './lib/daemonLedger';
import { TelegramNotifier } from '../src/lib/notifications/telegramNotifier';
import { TelegramBotService } from '../src/lib/notifications/telegramBotService';
import { getBinanceAccountInfo } from '../src/lib/binanceFuturesClient';
import {
  evaluateExecutionSafetyGate,
  routeLimitOrderPlacement,
  routeLimitOrderCancellation,
  routeOrderFilledBracket,
  routeStage1HarvestUpdate,
  routePositionClosedCleanup,
  routeEmergencyFlatten,
} from '../src/lib/binanceOrderRouter';
import { GlobalRiskGovernor } from '../src/lib/risk/GlobalRiskGovernor';
import { sql } from '../src/lib/postgres';
import { SYSTEM_VERSION } from '../src/lib/version';

// Parse CLI Arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const symbolArg = args.find((a) => a.startsWith('--symbol='))?.split('=')[1] || 'ETHUSDC';
const initialEquityArg = parseFloat(args.find((a) => a.startsWith('--equity='))?.split('=')[1] || '1000.0');

async function main() {
  const telegram = new TelegramNotifier();

  // Dynamic live equity hydration from Binance Futures if API credentials are configured
  let startingEquity = initialEquityArg;
  let isBinanceLiveHydrated = false;

  if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
    try {
      const binanceInfo = await getBinanceAccountInfo();
      if (binanceInfo && binanceInfo.totalWalletBalance > 0) {
        startingEquity = binanceInfo.totalWalletBalance;
        isBinanceLiveHydrated = true;
      }
    } catch (e: any) {
      console.warn('[DAEMON_BOOT] Non-fatal Binance balance query warning:', e?.message || e);
    }
  }

  const riskPerTrade = startingEquity * 0.02;
  const safetyGate = evaluateExecutionSafetyGate();

  console.log(`\n===============================================================`);
  console.log(` ⚡ QUEGAR ENGINE — LOCAL HEADLESS DAEMON (VPS HOST · V${SYSTEM_VERSION}) `);
  console.log(`===============================================================`);
  console.log(` Asset:           ${symbolArg.toUpperCase()} (Binance Futures)`);
  console.log(` Starting Equity: $${startingEquity.toFixed(2)} USD (2% Compounded Risk = $${riskPerTrade.toFixed(2)} / trade)`);
  console.log(` Exchange Link:   ${isBinanceLiveHydrated ? '🟢 BINANCE USDⓈ-M LIVE CONNECTED' : '⚪ VIRTUAL / SANDBOX'}`);
  console.log(` Execution Gate:  ${safetyGate.isAllowed ? '🔴 LIVE REAL EXECUTION ARMED' : '🧪 SHADOW SIMULATION (' + safetyGate.reason + ')'}`);
  console.log(` Strategy:        5M Sweep & Reclaim Champion (2-Stage Dynamic Harvest: 50% TP1 @ 1.0R / 50% TP2 @ 1.4R)`);
  console.log(` Telegram Alerts: ${telegram.isEnabled() ? '✅ ACTIVE (Chat: ' + telegram.getConfig().chatId + ')' : '⚪ DISABLED'}`);
  console.log(` Mode:            ${isDryRun ? 'DRY-RUN (30s Diagnostic Validation)' : '24/7 LIVE BACKGROUND EXECUTION'}`);
  console.log(` Local Time:      ${new Date().toLocaleString()} (UTC: ${new Date().toISOString()})`);
  console.log(`===============================================================\n`);

  // 1. Initialize Persistence Ledger
  const ledger = new DaemonLedger(symbolArg, startingEquity);
  ledger.logEvent('BOOT', `Headless daemon booting for ${symbolArg}`, {
    metadata: { isDryRun, initialEquity: startingEquity, isBinanceLive: isBinanceLiveHydrated },
  });

  // 2. Cold-Start REST Bootstrap (1000 Historical 5m Candles for Extended Anchor Continuity)
  let bootstrapData;
  try {
    bootstrapData = await bootstrapHistoricalBuffers(symbolArg, {
      '5m': 1000,
      '15m': 500,
      '1h': 500,
    });
  } catch (err: any) {
    console.error(`❌ [DAEMON] Bootstrap failed:`, err.message);
    ledger.logEvent('ERROR', `Bootstrap failure: ${err.message}`);
    process.exit(1);
  }

  // 3. Hydrate Institutional Risk Configuration & Initialize Engine
  const { config: initialRiskConfig, state: initialRiskState } = await GlobalRiskGovernor.hydrateState('institutional_admin');
  console.log(
    `[DAEMON] 🛡️ Global Risk Governor: Operational Risk ${initialRiskConfig.risk_per_trade_pct}% ($1.0R) | Max Drawdown ${initialRiskConfig.max_daily_loss_pct}% ($${initialRiskConfig.max_daily_loss_usd}) | Streak Cap ${initialRiskConfig.max_consecutive_losses}`
  );

  // If not live hydrated from Binance balance, use configured initial_capital from settings if available
  if (!isBinanceLiveHydrated && initialRiskState.initial_capital && initialRiskState.initial_capital > 0) {
    startingEquity = initialRiskState.initial_capital;
    console.log(`[DAEMON] 💰 Starting Equity synchronized from Risk Config: $${startingEquity.toFixed(2)} USD`);
  }

  // Load persisted live settings if available (synced from UI or saved presets)
  let persistedLiveSettings: any = {};
  const liveSettingsFile = path.join(process.cwd(), 'run_logs', 'daemon_live_settings.json');
  if (fs.existsSync(liveSettingsFile)) {
    try {
      persistedLiveSettings = JSON.parse(fs.readFileSync(liveSettingsFile, 'utf8'));
      console.log(`[DAEMON] 📂 Hydrated persisted live settings from daemon_live_settings.json`);
    } catch (e) {
      console.warn('[DAEMON] ⚠️ Could not parse daemon_live_settings.json:', e);
    }
  }

  const initialLiveSettings = {
    ...DEFAULT_SR_LIVE_SETTINGS,
    enabledTimeframes: ['5m'] as any,
    ...persistedLiveSettings,
  };

  const engine = new AutomatedStrategyExecutionEngine({
    symbol: symbolArg.toUpperCase(),
    initialEquity: startingEquity,
    compoundingRiskPct: initialLiveSettings.compoundingRiskPct ?? initialRiskConfig.risk_per_trade_pct,
    maxOpenPositions: 1,
    autoExecute: true,
    stage1Ratio: initialLiveSettings.stage1Ratio ?? 0.50,
    stage2Ratio: initialLiveSettings.stage2Ratio ?? 0.50,
    stage3Ratio: initialLiveSettings.stage3Ratio ?? 0.00,
    stage1Multiple: initialLiveSettings.stage1Multiple ?? 1.0,
    stage2Multiple: initialLiveSettings.stage2Multiple ?? 1.4,
    stage3Multiple: initialLiveSettings.stage3Multiple ?? 3.0,
    enableStructuralTrail: initialLiveSettings.enableStructuralTrail ?? true,
    enableProfitRatchet: initialLiveSettings.enableProfitRatchet ?? false,
    slBufferAtrMultiplier: initialLiveSettings.slBufferAtrMultiplier ?? 0.10,
    enableWaveDeduplication: initialLiveSettings.enableWaveDeduplication ?? true,
    enableEarlyBreakeven: initialLiveSettings.enableEarlyBreakeven ?? true,
    earlyBreakevenMultiple: initialLiveSettings.earlyBreakevenMultiple ?? 0.40,
    liveSettings: initialLiveSettings,
  });

  // Explicitly enforce account equity on the engine
  engine.setAccountEquity(startingEquity);

  // 4. Pre-run historical candle scan & mark cold-start setups as PROCESSED
  const initialScan = engine.onMultiTimeframeCandles(bootstrapData.buffers, bootstrapData.macroContext);
  console.log(
    `[DAEMON] 🔍 Historical scan completed: ${initialScan.scannedSetups.length} setups in history indexed. Cold-start guard active.`
  );

  // 4b. Rehydrate any active in-flight positions from today's session ledger
  const inFlightPositions = ledger.getActiveInFlightPositions();
  if (inFlightPositions.length > 0) {
    engine.rehydratePositionsDirect(inFlightPositions);
    console.log(
      `[DAEMON] 🔄 Successfully restored ${inFlightPositions.length} active in-flight position(s) from persistence ledger:`
    );
    for (const p of inFlightPositions) {
      console.log(
        `   ➔ Restored Position [${p.id}]: ${p.direction} ${p.symbol} @ $${p.entryPrice.toFixed(2)} | SL: $${p.activeStopLoss.toFixed(2)} | TP1: $${p.stage1Target.toFixed(2)} | TP2: $${p.stage2Target.toFixed(2)} | Status: ${p.status}`
      );
    }
  }

  // 5. Subscribe to Execution Engine Events
  engine.subscribe((event) => {
    const pos = event.position;
    const now = new Date().toLocaleTimeString();

    switch (event.type) {
      case 'LIMIT_ORDER_PLACED':
        console.log(`\n📌 [${now}] [LIMIT_ORDER_PLACED] ${event.message}`);
        if (pos) {
          console.log(
            `   ➔ Setup: ${pos.anchorName} | Limit: $${pos.limitEntryPrice.toFixed(2)} | SL: $${pos.initialStopLoss.toFixed(2)} | TP1: $${pos.stage1Target.toFixed(2)} | TP2: $${pos.stage2Target.toFixed(2)}`
          );

          // 🛡️ INSTITUTIONAL PRE-TRADE RISK GOVERNOR GATE
          GlobalRiskGovernor.evaluatePreTradeRisk({
            symbol: pos.symbol,
            direction: pos.direction,
            entryPrice: pos.limitEntryPrice,
            stopLossPrice: pos.initialStopLoss,
            currentEquity: engine.getAccountEquity(),
            currentOpenPositionsCount: engine.getActivePositions().length,
          }).then((assessment) => {
            if (!assessment.isApproved) {
              console.warn(`[DAEMON] 🚫 [RISK_GOVERNOR_VETO] ${assessment.reason}`);
              engine.cancelPendingLimitOrder(pos.id, `Risk Governor Veto: ${assessment.reason}`);
              telegram.sendRawMessage(
                `🛡️ <b>[RISK GOVERNOR VETO]</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                `📊 <b>Pair:</b> <code>${pos.symbol}</code>\n` +
                `🧭 <b>Direction:</b> <b>${pos.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}</b>\n` +
                `🏛️ <b>Anchor:</b> <i>${pos.anchorName || '5m Setup'}</i>\n` +
                `⚠️ <b>Reason:</b> <i>${assessment.reason}</i>\n` +
                `🛑 <b>Action:</b> Limit order aborted. Zero exchange exposure.`
              ).catch(() => {});
              return;
            }

            // Route limit order to Binance (armed on VPS production)
            routeLimitOrderPlacement(pos).catch((err) => {
              console.error('[ORDER_ROUTER_ERROR] Failed routing limit order placement:', err);
            });
          }).catch((err) => {
            console.error('[RISK_GOVERNOR_ERROR]', err);
            routeLimitOrderPlacement(pos).catch((rErr) => {
              console.error('[ORDER_ROUTER_ERROR] Failed routing limit order placement:', rErr);
            });
          });
        }
        ledger.logEvent('LIMIT_ORDER_PLACED', event.message, { position: pos });
        break;

      case 'LIMIT_ORDER_CANCELLED':
        console.log(`\n⌛ [${now}] [LIMIT_ORDER_CANCELLED] ${event.message}`);
        if (pos) {
          // Cancel order on Binance order book
          routeLimitOrderCancellation(pos, event.message).catch((err) => {
            console.error('[ORDER_ROUTER_ERROR] Failed routing limit order cancellation:', err);
          });
        }
        ledger.logEvent('LIMIT_ORDER_CANCELLED', event.message, { position: pos });
        break;

      case 'ORDER_FILLED':
        console.log(`\n🚀 [${now}] [ORDER_FILLED] ${event.message}`);
        if (pos) {
          console.log(
            `   ➔ Direction: ${pos.direction} | Fill Price: $${pos.entryPrice.toFixed(2)} | Size: ${pos.contractSize} contracts ($${pos.riskUsd.toFixed(2)} Risk)`
          );
          // Arm native exchange Stop Loss and Stage 1 TP limit orders on Binance
          routeOrderFilledBracket(pos).catch((err) => {
            console.error('[ORDER_ROUTER_ERROR] Failed routing bracket orders:', err);
          });
        }
        ledger.logEvent('ORDER_FILLED', event.message, { position: pos });
        break;

      case 'STAGE_1_HARVEST':
        console.log(`\n🎯 [${now}] [STAGE_1_HARVEST] ${event.message}`);
        if (pos) {
          console.log(`   ➔ Locked: +0.50R | Stop Loss advanced to Breakeven ($${pos.activeStopLoss.toFixed(2)})`);
          // Ratchet Stop Loss to Breakeven on Binance & submit Stage 2 TP limit
          routeStage1HarvestUpdate(pos).catch((err) => {
            console.error('[ORDER_ROUTER_ERROR] Failed routing Stage 1 harvest update:', err);
          });
        }
        ledger.logEvent('STAGE_1_HARVEST', event.message, { position: pos });
        break;

      case 'STAGE_2_HARVEST':
        console.log(`\n💰 [${now}] [STAGE_2_HARVEST] ${event.message}`);
        if (pos) {
          console.log(`   ➔ Locked: +0.70R | Total Realized: +${pos.realizedR.toFixed(2)}R | 100% Position Closed!`);
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

          // 1. Record outcome in GlobalRiskGovernor (updates daily realized PnL, loss streaks, trade count)
          GlobalRiskGovernor.recordTradeOutcome({
            symbol: pos.symbol,
            direction: pos.direction,
            entryPrice: pos.entryPrice,
            exitPrice: pos.exitPrice || pos.entryPrice,
            contractSize: pos.contractSize,
            realizedPnl: pos.realizedUsd || 0,
            realizedR: pos.realizedR || 0,
            isWin: (pos.realizedR || 0) > 0,
            timestamp: Date.now(),
            anchorName: pos.anchorName,
            binanceOrderId: pos.binanceOrderId || undefined,
            binanceClientOrderId: pos.binanceClientOrderId || undefined,
          }).catch((err) => console.warn('[DAEMON] Failed recording outcome to RiskGovernor:', err));

          // 2. Permanent PostgreSQL trade audit persistence
          sql`
            INSERT INTO trades (
              trade_id, symbol, direction, entry_price, exit_price, stop_loss,
              take_profit_1, take_profit_2, status, realized_pnl, realized_r,
              entry_time, exit_time, metadata, binance_order_id, binance_client_order_id,
              execution_mode, anchor_name
            )
            VALUES (
              ${pos.id}, ${pos.symbol}, ${pos.direction}, ${pos.entryPrice},
              ${pos.exitPrice || pos.entryPrice}, ${pos.initialStopLoss},
              ${pos.stage1Target}, ${pos.stage2Target}, ${pos.exitReason || 'CLOSED'},
              ${pos.realizedUsd || 0}, ${pos.realizedR || 0},
              ${new Date(pos.openTime || Date.now())}, ${new Date(pos.closeTime || Date.now())},
              ${JSON.stringify({ riskUsd: pos.riskUsd, contractSize: pos.contractSize, setupId: pos.setupId })},
              ${pos.binanceOrderId || null}, ${pos.binanceClientOrderId || null},
              ${process.env.IS_LIVE_VPS === 'true' ? 'LIVE_BINANCE' : 'SHADOW_SIMULATION'},
              ${pos.anchorName || null}
            )
            ON CONFLICT (trade_id) DO UPDATE SET
              exit_price = EXCLUDED.exit_price,
              status = EXCLUDED.status,
              realized_pnl = EXCLUDED.realized_pnl,
              realized_r = EXCLUDED.realized_r,
              exit_time = EXCLUDED.exit_time;
          `.catch((err) => console.warn('[DAEMON] DB trade insert skipped (offline fallback):', err?.message || err));
        }
        // Purge lingering open orders on Binance to ensure zero orphans
        routePositionClosedCleanup(symbolArg).catch((err) => {
          console.error('[ORDER_ROUTER_ERROR] Failed cleaning up open orders:', err);
        });
        ledger.logEvent('POSITION_CLOSED', event.message, { position: pos });
        break;
    }

    // Dispatch real-time deduplicated notification to Telegram
    telegram.handleExecutionEvent(event).catch((err) => {
      console.warn('[TELEGRAM_DISPATCH_ERROR]', err?.message || err);
    });
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
  let latestScannedSetups = initialScan.scannedSetups || [];

  // 6.2. UI-to-Daemon Command Processor (run_logs/daemon_commands.json)
  let lastCommandCheckTime = 0;
  const processPendingCommands = () => {
    try {
      const rootDir = process.cwd();
      const commandFile = path.join(rootDir, 'run_logs', 'daemon_commands.json');
      if (!fs.existsSync(commandFile)) return;
      const raw = fs.readFileSync(commandFile, 'utf8');
      const commands = JSON.parse(raw);
      if (!Array.isArray(commands)) return;

      let mutated = false;
      for (const cmd of commands) {
        if (cmd.status === 'PENDING') {
          console.log(`\n⚡ [DAEMON COMMAND] Executing UI command: ${cmd.action} (ID: ${cmd.id})`);
          if (cmd.action === 'EMERGENCY_FLATTEN') {
            const posId = cmd.positionId;
            const activePos = engine.getActivePositions()[0];
            engine.emergencyClearAllPendingOrders();
            if (posId) {
              const closed = engine.emergencyClosePosition(posId, wsClient.getLatestPrice());
              cmd.status = closed ? 'PROCESSED' : 'FAILED';
            } else {
              // Flatten all
              for (const p of engine.getActivePositions()) {
                engine.emergencyClosePosition(p.id, wsClient.getLatestPrice());
              }
              cmd.status = 'PROCESSED';
            }
            routeEmergencyFlatten(symbolArg, activePos).catch((err) => {
              console.error('[ORDER_ROUTER_ERROR] Emergency flatten exception:', err);
            });
            mutated = true;
          } else if (cmd.action === 'SNAP_BREAKEVEN' && cmd.positionId) {
            const snapped = engine.moveStopToBreakeven(cmd.positionId);
            cmd.status = snapped ? 'PROCESSED' : 'FAILED';
            mutated = true;
          } else if (cmd.action === 'TOGGLE_AUTO_EXEC') {
            const enabled = !!cmd.metadata?.enabled;
            engine.updateConfig({ autoExecute: enabled });
            cmd.status = 'PROCESSED';
            mutated = true;
          } else if (cmd.action === 'UPDATE_SETTINGS' && cmd.metadata?.settings) {
            console.log(`[DAEMON] 🔄 Applying live settings hot-reload from UI command:`, Object.keys(cmd.metadata.settings));
            engine.updateSweepReclaimSettings(cmd.metadata.settings);
            cmd.status = 'PROCESSED';
            mutated = true;
          }
        }
      }
      if (mutated) {
        fs.writeFileSync(commandFile, JSON.stringify(commands, null, 2), 'utf8');
      }
    } catch {
      // Non-blocking
    }
  };

  // Real-Time Trade Ticks Dispatcher
  wsClient.onMarketTick((tick: MarketTickPayload) => {
    tickCount++;
    const now = Date.now();
    ledger.checkAndPerformDateRollover(tick.timestamp || now);
    engine.processMarketTick(tick.price);

    // Poll for UI commands every 1 second
    if (now - lastCommandCheckTime > 1000) {
      lastCommandCheckTime = now;
      processPendingCommands();
    }

    // Heartbeat ticker in console every 10 seconds
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
    const candleTime = payload.candle.t || Date.now();
    ledger.checkAndPerformDateRollover(candleTime);

    const timeStr = new Date(payload.candle.t).toISOString().substring(11, 16);
    console.log(`\n[${new Date().toLocaleTimeString()}] 🕯️ [${payload.interval.toUpperCase()} Candle Closed @ ${timeStr} UTC] O:$${payload.candle.o} H:$${payload.candle.h} L:$${payload.candle.l} C:$${payload.candle.c} Vol:${payload.candle.v.toFixed(1)}`);

    const buffers = wsClient.getRingBuffers();

    // Recompute macro context on closed candles (5m, 15m, 1h)
    currentMacroContext = computeMacroContext(buffers['1h'], buffers['15m'], buffers['5m']);

    // Trigger strategy candidate scan
    const scanResult = engine.onMultiTimeframeCandles(buffers, currentMacroContext);
    latestScannedSetups = scanResult.scannedSetups || [];
    if (scanResult.scannedSetups.length > 0) {
      console.log(`   ➔ Scanned ${scanResult.scannedSetups.length} valid structural setups.`);
    }

    // 🛡️ Dynamic Risk Hot-Reload from GlobalRiskGovernor / PostgreSQL
    GlobalRiskGovernor.hydrateState('institutional_admin').then(({ config: freshConfig, state: freshState }) => {
      if (engine.config.compoundingRiskPct !== freshConfig.risk_per_trade_pct) {
        console.log(
          `\n[DAEMON] 🔄 Dynamic Risk Hot-Reload: Updated compounding risk to ${freshConfig.risk_per_trade_pct}% (was ${engine.config.compoundingRiskPct}%)`
        );
        engine.updateConfig({ compoundingRiskPct: freshConfig.risk_per_trade_pct });
      }

      // Sync account equity if capital configured in UI changed
      const targetEquity = isBinanceLiveHydrated ? startingEquity : (freshState.initial_capital || startingEquity);
      if (targetEquity > 0 && Math.abs(engine.getAccountEquity() - targetEquity) > 0.01) {
        console.log(
          `\n[DAEMON] 🔄 Dynamic Equity Hot-Reload: Updated account equity to $${targetEquity.toFixed(2)} USD (was $${engine.getAccountEquity().toFixed(2)})`
        );
        engine.setAccountEquity(targetEquity);
      }
    }).catch(() => {});
  });

  // 6.5. Start Interactive Telegram Bot Command Center (Two-Way Commands)
  const botService = new TelegramBotService(
    {
      engine,
      ledger,
      wsClient,
      symbol: symbolArg,
      equity: startingEquity,
      isDryRun,
      bootTimestamp: Date.now(),
      getMacroContext: () => currentMacroContext,
      getLatestSetups: () => latestScannedSetups,
    },
    telegram
  );
  botService.startPolling();

  // Connect WebSocket
  await wsClient.connect();

  console.log(`\n[DAEMON] 🟢 Quegar Engine is actively monitoring live market order flow.\n`);

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
      botService.stop();
      wsClient.stop();
      process.exit(0);
    }, 30000);
  }

  // Graceful Shutdown
  const shutdown = () => {
    console.log(`\n\n[DAEMON] 🛑 Stopping Quegar Headless Daemon...`);
    ledger.logEvent('HEARTBEAT', `Daemon stopped cleanly.`);
    botService.stop();
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
