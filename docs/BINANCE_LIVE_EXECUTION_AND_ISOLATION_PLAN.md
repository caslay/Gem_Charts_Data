# 🌐 Flow-State Quant Engine — Binance Live Execution, Risk Governor & Environment Isolation Plan

> **Document Version:** 1.0.0  
> **Status:** Approved Blueprint / Future Implementation Roadmap  
> **Target Environment:** 24/7 Ubuntu VPS (PM2 Master Daemon) + Next.js 16 Web Terminal + Binance Futures USDⓈ-M  
> **Applicable Symbols:** `ETHUSDC`, `ETHUSDT`, `BTCUSDC`, `BTCUSDT`

---

## 📑 Table of Contents
1. [Executive Summary & Core Objectives](#1-executive-summary--core-objectives)
2. [Quant Execution & Risk Hierarchy Doctrine](#2-quant-execution--risk-hierarchy-doctrine)
   - 2.1 [Take Profit (TP) Geometry: Strategy Preset Level](#21-take-profit-tp-geometry-strategy-preset-level)
   - 2.2 [Risk Ratio & Capital Dynamic Sizing: Global Settings Level](#22-risk-ratio--capital-dynamic-sizing-global-settings-level)
3. [Global Settings & Risk Governor Architecture](#3-global-settings--risk-governor-architecture)
   - 3.1 [New Database Schema Extensions (`trading_account`)](#31-new-database-schema-extensions-trading_account)
   - 3.2 [Account Risk Governor & Circuit Breaker Logic](#32-account-risk-governor--circuit-breaker-logic)
   - 3.3 [UI Settings Dashboard Specification](#33-ui-settings-dashboard-specification)
4. [Dedicated Binance Live Journal Architecture (Post-VPS Migration)](#4-dedicated-binance-live-journal-architecture-post-vps-migration)
   - 4.1 [Active Real-Money Positions Table](#41-active-real-money-positions-table)
   - 4.2 [Completed Trades & Execution Audit Ledger](#42-completed-trades--execution-audit-ledger)
   - 4.3 [Research & Backtest Isolation](#43-research--backtest-isolation)
5. [Local Dev vs. Live VPS Environment Isolation (Zero Real-Money Conflicts)](#5-local-dev-vs-live-vps-environment-isolation-zero-real-money-conflicts)
   - 5.1 [Layer 1: Environment Variables & Secret Separation](#51-layer-1-environment-variables--secret-separation)
   - 5.2 [Layer 2: Server-Side Zero-Trust `BinanceOrderRouter`](#52-layer-2-server-side-zero-trust-binanceorderrouter)
   - 5.3 [Layer 3: Shared Public Data Feed (Zero Credential Leak)](#53-layer-3-shared-public-data-feed-zero-credential-leak)
   - 5.4 [Layer 4: UI Environment Watermark Badges](#54-layer-4-ui-environment-watermark-badges)
   - 5.5 [Dev Branch & Local Settings Isolation Architecture](#55-dev-branch--local-settings-isolation-architecture)
6. [Implementation Roadmap (Step-by-Step Execution Phases)](#6-implementation-roadmap-step-by-step-execution-phases)
7. [Verification, Emergency Killswitches & Safety Checklist](#7-verification-emergency-killswitches--safety-checklist)

---

## 1. Executive Summary & Core Objectives

As the Flow-State Quant Engine transitions from paper simulation to autonomous live deployment on a high-availability Ubuntu VPS, the architecture must ensure:
1. **Zero Real-Money Execution from Local Development:** Developers working on `localhost:4000` must be structurally prevented from opening, modifying, or cancelling real Binance positions, even if code is shared or branch merges occur.
2. **Deterministic Risk Protection (The Risk Governor):** The system must enforce dynamic account-equity-based position sizing, hard risk ceilings, and an automated **Daily Maximum Drawdown Circuit Breaker** that halts trading upon exceeding loss limits.
3. **Dedicated Real-Time Binance Live Journal:** Replace client-side mock/browser stores with real-time exchange position and fill feeds directly synchronized from Binance Futures REST and User Data WebSocket streams.
4. **Strategy vs. Account Parameter Decoupling:** Maintain mathematical purity by locking setup-specific geometric ratios (TP1, TP2, entry offsets) inside Strategy Presets while enforcing capital risk management in Global Account Settings.

---

## 2. Quant Execution & Risk Hierarchy Doctrine

```mermaid
flowchart TD
    subgraph StrategyPreset["🎯 Strategy Preset Level (Setup Specific)"]
        A1["TP1 Multiple (e.g. 1.0R / 50%)"]
        A2["TP2 Multiple (e.g. 1.4R / 50%)"]
        A3["Entry Offset & FVG Routing"]
        A4["Structural Invalidation (ATR Buffer)"]
    end

    subgraph GlobalSettings["🏛️ Global Settings Level (Account & Risk Governor)"]
        B1["Live Binance Balance Sync ($ Margin)"]
        B2["Base Risk % per Trade (e.g. 2.0%)"]
        B3["Hard Max Risk Ceiling (e.g. 3.0%)"]
        B4["Max Daily Drawdown Limit (e.g. -5.0%)"]
        B5["Max Concurrent Positions Cap (= 1)"]
    end

    subgraph ExecutionGate["⚡ Order Execution Engine"]
        C1{"Risk Governor Verification"}
        C2["Calculate Dynamic Lot Size"]
        C3["Route Signed Order to Binance"]
        C4["🛑 Reject & Trip Circuit Breaker"]
    end

    StrategyPreset --> C2
    GlobalSettings --> C1
    C1 -->|Passes All Checks| C2
    C1 -->|Exceeds Daily Loss or Risk Cap| C4
    C2 --> C3
```

### 2.1 Take Profit (TP) Geometry: Strategy Preset Level
* **Status:** **Retained in Strategy Preset (No Changes).**
* **Rationale:** Take Profit targets are intrinsic to the mathematical edge of specific setups:
  * **5m Sweep & Reclaim Ultimate Champion:** Calibrated to a $1.0\text{R}$ TP1 ($50\%$ tranche) and $1.4\text{R}$ TP2 ($50\%$ tranche) for optimal Profit Factor ($2.12$) and minimum drawdown ($-8.07\text{R}$).
  * **Order Block / MSS Setups:** Dynamically target structural Liquidity Magnets (BSL / SSL pools) or static $1:2\text{R}$ / $1:3\text{R}$.
  * **Micro-Scalp Setups:** Require early TP1 at Consequent Encroachment ($50\%$ FVG).
* Hardcoding TP in global settings would destroy multi-strategy flexibility and force inappropriate exit profiles onto disparate strategies.

### 2.2 Risk Ratio & Capital Dynamic Sizing: Global Settings Level
* **Status:** **Enforced via Global Settings & Live Exchange Equity.**
* **Dynamic Sizing Formula:**
  $$\text{Contract Size} = \frac{\text{Live Equity (USDC/USDT)} \times (\text{Risk \%} / 100)}{|\text{Entry Price} - \text{Stop Loss Price}|}$$
* **Sizing Rules:**
  1. $\text{Live Equity}$ is queried directly from Binance (`totalMarginBalance` / `availableBalance`).
  2. $\text{Risk \%}$ is defined in Global Settings (default $2.0\%$).
  3. The contract size is clamped to exchange filters (`minLotSize`, `maxLotSize`, `lotStepPrecision`).
  4. Anti-Micro-Friction Clamp: Stop loss distance is enforced at $\ge 0.15\%$ of index price to prevent abnormal leverage spikes on sub-pip structures.

---

## 3. Global Settings & Risk Governor Architecture

### 3.1 New Database Schema Extensions (`trading_account`)
To support the live Binance integration, the native PostgreSQL database running locally on the VPS (`localhost:5432`) will be upgraded with the following columns:

```sql
-- Schema Migration for Live Binance & Risk Governor
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(32) DEFAULT 'PAPER_SIMULATION';
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS default_risk_pct DECIMAL(5, 2) DEFAULT 2.00;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS max_risk_limit_pct DECIMAL(5, 2) DEFAULT 3.00;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS max_daily_drawdown_pct DECIMAL(5, 2) DEFAULT 5.00;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS max_open_positions INT DEFAULT 1;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS binance_account_equity DECIMAL(18, 4) DEFAULT 0.0000;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS binance_available_balance DECIMAL(18, 4) DEFAULT 0.0000;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS daily_drawdown_anchor_equity DECIMAL(18, 4) DEFAULT 0.0000;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS daily_drawdown_anchor_date VARCHAR(10) DEFAULT '';
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS is_killswitch_active BOOLEAN DEFAULT FALSE;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS killswitch_reason TEXT DEFAULT NULL;
```

### 3.2 Account Risk Governor & Circuit Breaker Logic
The **Risk Governor** evaluates every trade trigger before routing:

1. **Pre-Trade Exposure Verification:**
   * Checks current open positions: If `openPositions.length >= max_open_positions`, order is **VETOED**.
   * Checks single trade risk: If `requestedRiskPct > max_risk_limit_pct`, order is clamped to `max_risk_limit_pct`.
2. **Daily Drawdown Circuit Breaker:**
   * **Anchor Reset:** At 00:00:00 UTC every day, record the starting `daily_drawdown_anchor_equity = totalMarginBalance`.
   * **Cumulative Loss Tracking:**
     $$\text{Daily PnL \%} = \frac{\text{Current Margin Balance} - \text{Anchor Equity}}{\text{Anchor Equity}} \times 100$$
   * **Circuit Breaker Trip Condition:** If $\text{Daily PnL \%} \le -(\text{max\_daily\_drawdown\_pct})$, immediately:
     1. Set `is_killswitch_active = TRUE`.
     2. Send emergency CANCEL command for all resting limit orders on Binance.
     3. Suppress all new auto-execution signals until the next UTC day 00:00:00.
     4. Dispatch high-priority Telegram alert: `🚨 EMERGENCY CIRCUIT BREAKER TRIPPED: Daily Drawdown Limit (-5.0%) Hit. Trading Halted.`

### 3.3 UI Settings Dashboard Specification
The **[ 02 / TRADING ACCOUNT RISK GATES ]** tab on `/settings` will feature:

* **Live Exchange Telemetry Readout:**
  * Real-Time Binance Margin Balance ($).
  * Real-Time Available Unencumbered Balance ($).
  * Current Open Floating P&L ($ / %).
  * Today's Cumulative Drawdown Progress Bar (showing distance to 5% circuit breaker limit).
* **Configurable Input Fields:**
  * `Default Risk per Trade (%)` (e.g. `2.00%`).
  * `Hard Max Risk Limit (%)` (e.g. `3.00%`).
  * `Max Daily Drawdown Limit (%)` (e.g. `5.00%`).
  * `Max Concurrent Open Positions` (e.g. `1`).
  * `Execution Mode Switcher` (`LIVE_BINANCE_FUTURES` vs `PAPER_SIMULATION`).
  * `Manual Emergency Killswitch Button` (1-tap cancel all orders and lock terminal).

---

## 4. Dedicated Binance Live Journal Architecture (Post-VPS Migration)

Once live on the VPS, the paper journal table is replaced with a dedicated **Live Binance Futures Journal** on `/journal`.

```mermaid
flowchart LR
    BinanceAPI["Binance Futures API (/fapi/v2/positionRisk, /fapi/v1/userTrades)"]
    BinanceWS["Binance User Data Stream (listenKey WebSocket)"]
    NextAPI["/api/binance/positions & /api/binance/trades"]
    LiveJournalUI["JournalTable.tsx (Live Binance Mode)"]

    BinanceAPI --> NextAPI
    BinanceWS --> NextAPI
    NextAPI --> LiveJournalUI
```

### 4.1 Active Real-Money Positions Table
Reads directly from `/fapi/v2/positionRisk` and displays:
* **Symbol & Leverage:** `ETHUSDC (Isolated 10x)`
* **Position Direction:** `LONG 🟢` or `SHORT 🔴`
* **Entry Price & Mark Price:** Real Binance fill price vs live Mark Price
* **Position Size:** Exact contracts/units (e.g. `4.125 ETH`)
* **Stop Loss & Take Profit:** Active trigger orders on Binance order book
* **Unrealized P&L & ROI:** Real-time floating dollar PnL & percentage
* **Margin & Liquidation Price:** Margin allocated and distance to liquidation
* **Emergency Action:** `[ Market Close Position ]` button with confirmation modal

### 4.2 Completed Trades & Execution Audit Ledger
Reads from `/fapi/v1/userTrades` and `/fapi/v1/allOrders`:
* Exact fill timestamp (UTC).
* Order ID and Client Order ID (`cId` containing strategy metadata e.g. `FS_SR5_LONG_...`).
* Realized P&L after Binance trading fees.
* Realized Commissions paid (in BNB/USDC/USDT).
* Strategy Name tag extracted from client order ID.

### 4.3 Research & Backtest Isolation
* Algorithmic backtests and Quant Lab test runs remain available under `/quant-lab` and `/backtest`, completely isolated from the live Binance account ledger.

---

## 5. Local Dev vs. Live VPS Environment Isolation (Zero Real-Money Conflicts)

To eliminate the catastrophic risk of a developer on localhost accidentally executing live Binance orders, a **4-Layer Defense-in-Depth Isolation Model** is established.

```mermaid
graph TD
    subgraph LocalMachine["💻 LOCAL DEVELOPMENT MACHINE (localhost:4000)"]
        L1[".env.local: EXECUTION_MODE=PAPER_SIMULATION"]
        L2["Binance Keys: EMPTY or Testnet"]
        L3["Public Klines API: Shared Read-Only Feed"]
        L4["Order Routing: Mock / Simulation Engine"]
        L5["UI Watermark: 🧪 LOCAL DEV (PAPER)"]
    end

    subgraph VPSMachine["☁️ UBUNTU VPS PRODUCTION (24/7 PM2)"]
        V1[".env.production: EXECUTION_MODE=LIVE_BINANCE"]
        V2["Binance Keys: SECURE LIVE VAULT"]
        V3["Signed Orders: Real /fapi/v1/order"]
        V4["PM2 Headless Daemon: Active Autonomous Engine"]
        V5["UI Watermark: 🔴 LIVE PRODUCTION DAEMON"]
    end

    L1 -.->|Git Push (Safe)| V1
```

### 5.1 Layer 1: Environment Variables & Secret Separation
* **Git Security (`.gitignore`):** `.env.local`, `.env.production`, `.env.*.local` are strictly ignored by git.
* **Local Machine (`.env.local`):**
  ```bash
  # Local Development Configuration
  EXECUTION_MODE=PAPER_SIMULATION
  IS_VPS_PRODUCTION=false
  BINANCE_API_KEY=                         # Leave empty
  BINANCE_API_SECRET=                      # Leave empty
  BINANCE_IS_TESTNET=true
  DAEMON_AUTO_EXECUTE=false
  ```
* **VPS Production Server (`.env.production` — Stored strictly on VPS):**
  ```bash
  # Production VPS Live Configuration
  EXECUTION_MODE=LIVE_BINANCE
  IS_VPS_PRODUCTION=true
  BINANCE_API_KEY=prod_live_api_key_xxxxxxxx
  BINANCE_API_SECRET=prod_live_api_secret_xxxxxxxx
  BINANCE_IS_TESTNET=false
  DAEMON_AUTO_EXECUTE=true
  TELEGRAM_ENABLED=true
  ```

### 5.2 Layer 2: Server-Side Zero-Trust `BinanceOrderRouter`
In the backend order dispatcher ([`src/lib/binanceOrderRouter.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/binanceOrderRouter.ts)), signed order routing to Binance is gated by strict triple-validation:

```typescript
export async function routeOrderToBinance(orderPayload: OrderPayload) {
  // Triple-Validation Gate:
  const isProduction = process.env.NODE_ENV === 'production';
  const isVpsProd = process.env.IS_VPS_PRODUCTION === 'true';
  const isLiveExecution = process.env.EXECUTION_MODE === 'LIVE_BINANCE';
  const hasValidKeys = !!process.env.BINANCE_API_KEY && !!process.env.BINANCE_API_SECRET;

  if (!isProduction || !isVpsProd || !isLiveExecution || !hasValidKeys) {
    console.warn(`[SAFETY_GUARD] Local/Paper environment detected. Real Binance execution blocked.`);
    return routeToPaperSimulationEngine(orderPayload);
  }

  // Only reached on verified VPS production with live credentials
  return executeSignedBinanceFuturesOrder(orderPayload);
}
```

### 5.3 Layer 3: Shared Public Data Feed (Zero Credential Leak)
* Binance public market feeds (candlestick klines, depth snapshots, open interest) require **no API authentication**.
* Local development machines ingest the live Binance klines stream directly for zero-latency charting and algorithm development without touching account endpoints or needing trade keys.

### 5.4 Layer 4: UI Environment Watermark Badges
The navigation header renders a high-visibility badge indicating exact runtime mode:
* **Localhost Dev Server (`localhost:4000`):**
  `[ 🧪 LOCAL DEV — PAPER SANDBOX (Public Feed Only) ]` (Amber outline, interactive simulations only).
* **VPS Production Server:**
  `[ 🔴 LIVE PM2 DAEMON — REAL MONEY ACTIVE ]` (Glowing emerald/crimson indicator).

### 5.5 Dev Branch & Local Settings Isolation Architecture
To guarantee that local testing, branch experiments, or feature development on the dev branch NEVER overwrite or pollute live VPS production risk rules:

1. **Production Database Network Isolation:**
   * The live PostgreSQL database on the VPS binds strictly to `127.0.0.1:5432`.
   * The Ubuntu VPS UFW firewall blocks all incoming connections on port `5432`.
   * The local developer machine cannot physically connect to or mutate the VPS production database.
2. **Local Dev Settings Storage Modes:**
   * **Mode A (Zero-Setup Fallback — Default):** If no local PostgreSQL is installed on the dev machine, `src/app/api/settings` and `src/app/api/account` gracefully fall back to local browser `localStorage` and in-memory persistence.
   * **Mode B (Local Dev Database):** If developer runs a local PostgreSQL service (`DATABASE_URL=postgresql://dev_user:password@localhost:5432/flowstate_dev`), migrations run locally against `flowstate_dev`.
3. **Behavior When Modifying Settings on Dev Branch (`localhost:4000/settings`):**
   * Testing risk settings (e.g. changing Max Risk % to 1.0% or 5.0%), editing prompt templates, or customizing theme palettes only writes to the local dev store.
   * Merging git code from the dev branch to `main` and pulling on the VPS **does not copy local settings**, because settings live inside database rows, not in git code. Production settings persist untouched in the VPS local database.

---

## 6. Implementation Roadmap (Step-by-Step Execution Phases)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            EXECUTION ROADMAP                                │
├──────────────┬────────────────────────────────────────┬─────────────────────┤
│ Phase        │ Milestone                              │ Deliverables        │
├──────────────┼────────────────────────────────────────┼─────────────────────┤
│ Phase 1      │ Database & Risk Governor Setup         │ - Local VPS PostgreSQL│
│              │                                        │ - Settings UI Inputs│
│              │                                        │ - Max Drawdown Logic│
├──────────────┼────────────────────────────────────────┼─────────────────────┤
│ Phase 2      │ Binance Client & Zero-Trust Router     │ - Binance REST/WS   │
│              │                                        │ - Safety Router Gate│
│              │                                        │ - Dynamic Sizing    │
├──────────────┼────────────────────────────────────────┼─────────────────────┤
│ Phase 3      │ Dedicated Live Binance Journal         │ - Position Risk View│
│              │                                        │ - User Trade Ledger │
│              │                                        │ - 1-Click Close UI  │
├──────────────┼────────────────────────────────────────┼─────────────────────┤
│ Phase 4      │ VPS PM2 Headless Daemon Wiring         │ - PM2 Real Orders   │
│              │                                        │ - Telegram Alerts   │
│              │                                        │ - Auto-Restart Boot │
├──────────────┼────────────────────────────────────────┼─────────────────────┤
│ Phase 5      │ Binance Testnet & Mainnet Go-Live      │ - Testnet Rehearsal │
│              │                                        │ - Live Mini-Lot     │
│              │                                        │ - 24/7 Monitoring   │
└──────────────┴────────────────────────────────────────┴─────────────────────┘
```

---

## 7. Verification, Emergency Killswitches & Safety Checklist

Before enabling live real-money execution on the VPS:

1. [ ] **IP Whitelisting on Binance:** Ensure the Binance API Key is restricted strictly to the static IP address of the Ubuntu VPS.
2. [ ] **Withdrawal Permissions Disabled:** Ensure the Binance API Key has **Futures Trading ENABLED** and **Withdrawals DISABLED**.
3. [ ] **Local Machine Audit:** Verify that running `npm run dev` on localhost displays the `[ 🧪 LOCAL DEV ]` watermark and that placing manual trades writes strictly to local simulation storage.
4. [ ] **Circuit Breaker Validation:** Simulate a daily loss trigger and confirm that PM2 cancels resting limit orders and dispatches the Telegram emergency alert.
5. [ ] **Telegram Bot 2-Way Command Center:** Verify that `/status`, `/positions`, and `/killswitch` commands respond instantly via `TelegramBotService`.
6. [ ] **Master Blueprint Synchronization:** Keep `directives/master_blueprint.md` updated as components are implemented.

---
*Document approved and recorded in project documentation vault (`docs/BINANCE_LIVE_EXECUTION_AND_ISOLATION_PLAN.md`).*
