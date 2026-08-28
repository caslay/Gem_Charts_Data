# 🏛️ Implementation Plan: Local Headless VPS Execution & Quant Lab 1:1 Reconciliation

> **Status:** Ready for Review & Approval  
> **Engine:** Flow-State Quant Engine V16.68 (5m Sweep & Reclaim Champion Strategy)  
> **Architecture:** Headless Node.js Daemon (Local VPS) + Pure Quant Engine + Dual-Ledger Persistence + 1:1 Reconciliation Engine  

---

## 1. Executive Summary & Goal Description

The goal is to enable the Flow-State Quant Engine to run **locally in the background as a lightweight, 24/7 headless daemon (Local VPS)** without any browser open or UI rendering overhead. 

The daemon will:
1. Stream sub-second trade ticks and closed 5m/15m/1h candle boundaries directly from Binance Futures WebSocket.
2. Execute the pure algorithmic pipeline (`SweepReclaimEngine`, `AutomatedStrategyExecutionEngine`, `SMCStateEngine`, `MTFTelemetryEngine`).
3. Detect, arm, and manage live trades with sub-second timestamps, 3-stage profit harvesting (40% TP1 @ 1.0R, 40% TP2 @ 1.5R, 20% TP3 Runner), and dynamic trailing profit ratchets.
4. Record every event to an atomic local JSON ledger and Neon PostgreSQL.
5. Provide a automated 1:1 Reconciliation Script (`scripts/reconcile-session.ts`) to cross-match live forward-test trade executions against Quant Lab historical backtests for exact mathematical parity.

---

## 2. 🔍 Double-Audit Findings & Hidden Gap Mitigations

We conducted a deep double-audit across `AutomatedStrategyExecutionEngine.ts`, `SweepReclaimEngine.ts`, `useBinanceWS.ts`, `quantLabEngine.ts`, and database routes. Here are the critical edge cases identified and their built-in solutions:

```
┌───────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────┐
│ Identified Gap / Race Condition       │ Architecture Mitigation & Engine Safeguard                               │
├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ 1. Cold-Start Setup Re-Arming Trap    │ On boot, daemon fetches 500 historical candles via REST, initializes     │
│    (Re-executing yesterday's setups)  │ pivots, and marks all historical setups as PROCESSED. Only setups with   │
│                                       │ reclaim_time >= boot_time are armed for live execution.                 │
├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ 2. Real-Time Tick vs Kline Latency    │ Daemon connects to a combined WebSocket stream:                          │
│    (Missing instant limit touches)    │ ethusdc@kline_5m (for closed bar boundaries) +                           │
│                                       │ ethusdc@aggTrade (for sub-second live trade ticks).                     │
├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ 3. Transient Network Dropouts         │ Daemon includes Heartbeat Ping-Pong monitoring and exponential backoff.   │
│    (Missed 5m bar during reconnect)   │ Upon reconnect, it queries REST for missing klines to backfill memory.   │
├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ 4. Single-Position Concurrency Lock   │ AutomatedStrategyExecutionEngine enforces maxOpenPositions = 1. Active   │
│    (Over-allocating risk)             │ positions atomic flush cancels all other pending limit orders instantly. │
├───────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ 5. Compounding Equity Sync            │ Initializes equity from config/Postgres. Realized PnL is auto-added to   │
│    (Zero-dependency local tracking)   │ running equity upon trade close, updating 2.0% risk sizing per trade.    │
└───────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. User Review Required

> [!IMPORTANT]
> **Zero Code Modification to Existing UI or Core Strategy Math:**  
> The existing frontend, chart layers, and Next.js routes remain 100% untouched. All headless daemon logic lives in dedicated `scripts/` modules that import the existing pure TypeScript classes from `src/lib/quantEngine/`.

> [!TIP]
> **Operating the Local Daemon:**  
> You can launch the daemon in any terminal with `npx tsx scripts/headless-daemon.ts` or keep it running permanently in the background using `pm2 start scripts/headless-daemon.ts --name flow-state-local`.

---

## 4. Proposed Architecture & Modular File Structure

```
                                  ┌─────────────────────────────────────────────────────────┐
                                  │            Binance Futures WebSocket Streams            │
                                  │   wss://fstream.binance.com (Live) or Testnet Stream    │
                                  │     • ethusdc@kline_5m (boundary & OHLCV scans)         │
                                  │     • ethusdc@kline_15m / @kline_1h                     │
                                  │     • ethusdc@aggTrade (real-time sub-sec ticks)        │
                                  └────────────────────────────┬────────────────────────────┘
                                                               │
                                                               ▼
                                ┌───────────────────────────────────────────────────────────┐
                                │     scripts/lib/nodeWsClient.ts (Headless Socket Driver)  │
                                │     • Native `ws` client with auto-reconnect & ping/pong  │
                                │     • Candle buffer manager & gap backfiller              │
                                └──────────────────────────────┬────────────────────────────┘
                                                               │
                                                               ▼
                                ┌───────────────────────────────────────────────────────────┐
                                │     scripts/headless-daemon.ts (Master Execution Host)    │
                                │     • REST Bootstrap (500 bars historical memory)         │
                                │     • Passes ticks to AutomatedStrategyExecutionEngine   │
                                │     • Evaluates SweepReclaimEngine on 5m candle close     │
                                └──────────────────────────────┬────────────────────────────┘
                                                               │
                                  ┌────────────────────────────┴────────────────────────────┐
                                  ▼                                                         ▼
    ┌───────────────────────────────────────────────────────────┐ ┌─────────────────────────────────────────────────────────┐
    │          Local Persistence / Audit Logging                │ │             Quant Lab Reconciliation Engine             │
    │  • run_logs/live_session_YYYY-MM-DD.json (Full tick log)  │ │  • scripts/reconcile-session.ts                         │
    │  • directives/ETHUSDC_Daily_Tracker.json (SOP Journal)    │ │  • Automated 4-Pillar Parity Audit Matrix               │
    │  • Neon PostgreSQL (`trades` & `agent_decision_log`)      │ │  • Markdown Comparison Report                           │
    └───────────────────────────────────────────────────────────┘ └─────────────────────────────────────────────────────────┘
```

---

## 5. File-by-File Breakdown

### `scripts/lib/` (Headless Drivers & Clients)

#### [NEW] [`nodeWsClient.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/scripts/lib/nodeWsClient.ts)
- **Role:** Pure Node.js WebSocket client replacing browser-only `useBinanceWS`.
- **Features:**
  - Connects to Binance Futures streams (`ethusdc@kline_5m`, `ethusdc@kline_15m`, `ethusdc@kline_1h`, `ethusdc@aggTrade`).
  - Maintains in-memory ring buffers (last 500 closed bars per timeframe).
  - Emits `onCandleClose(interval, candle)` and `onTradeTick(price, timestamp)`.
  - Auto-reconnection with REST gap backfill.

#### [NEW] [`restBootstrap.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/scripts/lib/restBootstrap.ts)
- **Role:** Cold-start bootloader.
- **Features:**
  - Fetches last 500 bars for 5m, 15m, 1h from Binance Futures REST API (`/fapi/v1/klines`).
  - Initializes pivots, session levels (Asian/London), and PDH/PDL.
  - Seeds the `AutomatedStrategyExecutionEngine` and marks all historical setups as `PROCESSED`.

#### [NEW] [`daemonLedger.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/scripts/lib/daemonLedger.ts)
- **Role:** Atomic disk & database persistence manager.
- **Features:**
  - Writes live trade events (`SETUP_ARMED`, `ORDER_FILLED`, `STAGE_1_HARVEST`, `STAGE_2_HARVEST`, `POSITION_CLOSED`) to `run_logs/live_session_YYYY-MM-DD.json`.
  - Appends completed trades to `directives/ETHUSDC_Daily_Tracker.json`.
  - Optionally syncs records to Neon PostgreSQL if `POSTGRES_URL` is configured.

---

### `scripts/` (Main Daemons & Tools)

#### [NEW] [`headless-daemon.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/scripts/headless-daemon.ts)
- **Role:** Master background runner.
- **Features:**
  - CLI runner (`npx tsx scripts/headless-daemon.ts`).
  - Reads config from `.env.local` or environment variables (default: 5m Champion Strategy, 2% risk, \$10,000 equity).
  - Listens to candle closures and triggers `engine.onMultiTimeframeCandles()`.
  - Listens to real-time trade ticks and triggers `engine.processMarketTick()`.
  - Prints clean, formatted CLI console logs (colored badges for signals, entries, stage fills, and exits).

#### [NEW] [`reconcile-session.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/scripts/reconcile-session.ts)
- **Role:** 1:1 Quant Lab Reconciliation Audit Tool.
- **Features:**
  - Usage: `npx tsx scripts/reconcile-session.ts --date=2026-08-28`.
  - Fetches historical candles for that specific day.
  - Replays `SweepReclaimEngine.scanHistoricalSetups()` with the exact same parameters.
  - Compares Quant Lab expected trades vs Live Daemon recorded trades.
  - Outputs a Markdown Parity Report (`run_logs/reconciliation_YYYY-MM-DD.md`) highlighting:
    - Setup Match: ✅ (100%)
    - Execution Price Slippage: $0.00
    - Stage Harvest Parity: ✅ (TP1/TP2/TP3 matched)
    - Realized R Parity: +X.XX vs +X.XX

---

## 6. Verification Plan

### Automated Parity Tests
1. **Bootstrap & Ring Buffer Test:**
   ```bash
   npx tsx scripts/lib/restBootstrap.ts --test
   ```
   *Expectation:* Fetches 500 candles across 5m, 15m, 1h in < 1.5s, verifies zero `NaN` values, and verifies correct UTC timestamp ascending order.

2. **Daemon Dry-Run Test (15-Minute Live Validation):**
   ```bash
   npx tsx scripts/headless-daemon.ts --dry-run
   ```
   *Expectation:* Successfully connects to Binance WS, logs live prices, captures closed 5m bar events, and writes heartbeat to `run_logs/live_session.json`.

3. **Historical Reconciliation Baseline Test:**
   ```bash
   npx tsx scripts/reconcile-session.ts --date=2026-08-26
   ```
   *Expectation:* Runs Quant Lab backtest on past session, simulates daemon replay, and outputs a 100% parity report.
