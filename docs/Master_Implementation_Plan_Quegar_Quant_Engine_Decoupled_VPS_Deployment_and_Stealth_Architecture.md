# 🏛️ Master Implementation Plan: Quegar Quant Engine — Decoupled VPS Deployment & Stealth Architecture

> **Brand Identity:** **Quegar Quant Engine (Quegar)**  
> **Target Infrastructure:** AWS Lightsail VPS (`quegar-core` in Tokyo `ap-northeast-1a`, Ubuntu 24.04 LTS, Static IP: `57.181.64.238`)  
> **Domain & DNS:** `quegar.com`, `core.quegar.com`, `mcp.quegar.com` (Porkbun DNS configured)  
> **Database:** VPS Local PostgreSQL (`quegar_db` on loopback `localhost:5432`) — **Neon Cloud DB & Vercel Dropped Completely**  
> **Champion Strategy:** 5M Sweep & Reclaim (2-Stage Dynamic Harvest: 50% TP1 @ 1.0R / 50% TP2 @ 1.4R, Rule 4 Disabled)  
> **Risk Model:** 2.0% Compounded Risk ($250 Max Risk Cap)  

---

## 📑 Executive Summary & Document Review

A forensic audit of existing deployment and architecture documents (`Completed_Cloud_and_DNS_Infrastructure_Manifest.md`, `VPS_implementation_plan_v2.md`, `daemon_implementation_plan.md`, `VPS_DEPLOYMENT_AND_GO_LIVE_ROADMAP.md`, `Decoupled VPS and Local Architecture.pdf`) identified key areas of duplicated, outdated, and conflicting information:

1. **Obsolete Cloud Dependencies:** Prior plans referenced Neon PostgreSQL and Vercel hosting. Neon bandwidth quotas (HTTP 402 errors) and Vercel route wiping are completely eliminated by moving to self-hosted VPS PostgreSQL (`quegar_db`) and PM2-managed Next.js standalone on AWS Lightsail.
2. **Old Brand Nomenclature:** Legacy references to "Flow-State Quant Engine", "flow-state", and "flow_state" are replaced across the codebase, directives, docs, and process configs with the new official brand: **Quegar** / **Quegar Quant Engine**.
3. **Outdated Strategy Models:** Legacy plans mentioned 3-stage harvest (40/40/20) and Rule 4 early breakeven defaults. These are superseded by the verified 2-Stage Champion Model (50% TP1 @ 1.0R / 50% TP2 @ 1.4R, Rule 4 inactive by default).
4. **Decoupled Isolation & Stealth Gap:** Previous roadmap files lacked the stealth front-facing decoy strategy, strict read-only database isolation for local dev (`localhost:4000`), and dedicated live Telegram bot separation.

---

## 🎯 Core Requirements & Architectural Principles

### 1. Drop Neon & Vercel Completely
- Everything runs on the AWS Lightsail Ubuntu 24.04 VPS (`57.181.64.238`).
- PostgreSQL runs locally on the VPS (`localhost:5432`, `quegar_db`), providing sub-millisecond query latency, zero cloud transfer quotas, and zero HTTP 402 errors.
- Web server runs as a PM2-managed Next.js production server on the VPS (`quegar-server` on port 3000).

### 2. Localhost:4000 Read-Only Isolation (Zero VPS Write Access)
- Local development (`localhost:4000` via PM2 / dev server) is strictly forbidden from pushing settings, mutating database state, or modifying strategies on the live VPS.
- Enforced by a 2-tier barrier:
  1. **PostgreSQL Role Level:** Local connection uses a dedicated `quegar_readonly` role with `GRANT SELECT ON ALL TABLES` (cannot `INSERT`, `UPDATE`, `DELETE`, or `ALTER`).
  2. **Application Middleware & Route Level:** `READ_ONLY_LOCAL=true` guard intercepts any write/mutate API calls (`POST /api/settings`, `POST /api/strategies`, live execution) and returns `403 Forbidden: Read-Only Local Dev Sandbox`.

### 3. Absolute Binance Live Trading Isolation
- `localhost:4000` can **never** execute live trades on Binance.
- Enforced by a 3-tier defense:
  1. **Exchange IP Whitelisting:** Binance Futures API keys restricted strictly to VPS Static IP `57.181.64.238`.
  2. **Codebase Fail-Safe Live Gate:** `AutomatedStrategyExecutionEngine` blocks live order execution unless `NODE_ENV === 'production' && process.env.IS_LIVE_VPS === 'true' && process.env.AUTO_EXECUTE === 'true'`.
  3. **Environment Segregation:** Zero live Binance keys on local machine; local `.env.local` contains only Testnet or offline simulation flags.

### 4. Maximum Operational Stealth & Decoy Routing
- Public visits to root `https://quegar.com` return a lightweight, non-financial developer telemetry health payload (`{"status":"healthy","service":"telemetry-worker","timestamp":...}`) or static placeholder.
- Private trading cockpit hosted on `core.quegar.com` (or accessed via SSH tunnel `localhost:3000`) gated behind NextAuth with fail-closed `404 Not Found` for unauthenticated requests.
- Machine-to-Machine MCP endpoint (`mcp.quegar.com` or `/api/mcp`) secured via high-entropy M2M bearer secret / OAuth 2.0 with fail-closed behavior.

### 5. Dedicated Live Telegram Bot Separation
- Live VPS Engine uses a dedicated production bot (e.g. `@QuegarLiveBot` / `TELEGRAM_LIVE_BOT_TOKEN`) for 2-Stage dynamic harvest alerts, stop loss modifications, and interactive command polling.
- Local dev sandbox sets `TELEGRAM_ENABLED=false` (or optional test sandbox bot `@QuegarDevBot`) to prevent bot polling collisions (`getUpdates` conflict) and alert pollution.

### 6. Full Rebranding to "Quegar"
- Directives (`01_architecture.md` through `07_m2m_agent_mcp_guide.md`, `master_blueprint.md`).
- Agent SOP and rules (`AGENTS.md`, `.cursorrules`, `ENGINE_CAPABILITY_MAP.md`).
- Master documentation and roadmap files.
- Process configurations (`quegar-server`, `quegar-daemon`, `quegar-dev`).

---

## 🏗️ Phased Implementation Plan

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 QUEGAR QUANT ENGINE GO-LIVE ROADMAP                                    │
├─────────┬───────────────────────────────────────┬──────────────────────────────────────────────────────┤
│ Phase   │ Focus Area                            │ Primary Deliverables                                 │
├─────────┼───────────────────────────────────────┼──────────────────────────────────────────────────────┤
│ PHASE 1 │ Master Blueprint & Docs Rebranding    │ Rebrand Directives, AGENTS.md, consolidate plans     │
│ PHASE 2 │ Codebase Safety Gates & Local Isolation│ READ_ONLY_LOCAL guard & IS_LIVE_VPS fail-safe gate   │
│ PHASE 3 │ Stealth Decoy & Private Cockpit Route │ Root telemetry decoy + fail-closed auth handling     │
│ PHASE 4 │ Local PostgreSQL & Database Migration │ Scripts for local quegar_db & quegar_readonly role   │
│ PHASE 5 │ Telegram Live Bot Dispatcher Setup    │ Dedicated live bot config & polling isolation        │
│ PHASE 6 │ VPS Deployment & PM2 Orchestration    │ ecosystem.config.js (quegar-server, quegar-daemon)   │
└─────────┴───────────────────────────────────────┴──────────────────────────────────────────────────────┘
```

---

## 📋 Detailed Phase Breakdown

### Phase 1: Master Documentation Consolidation & Rebranding to "Quegar"
- Create consolidated master roadmap: [`docs/QUEGAR_VPS_DEPLOYMENT_AND_GO_LIVE_MASTER_PLAN.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/docs/QUEGAR_VPS_DEPLOYMENT_AND_GO_LIVE_MASTER_PLAN.md).
- Update and clean up legacy documents:
  - [`docs/Completed_Cloud_and_DNS_Infrastructure_Manifest.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/docs/Completed_Cloud_and_DNS_Infrastructure_Manifest.md)
  - [`docs/VPS_implementation_plan_v2.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/docs/VPS_implementation_plan_v2.md)
  - [`docs/daemon_implementation_plan.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/docs/daemon_implementation_plan.md)
  - [`docs/VPS_DEPLOYMENT_AND_GO_LIVE_ROADMAP.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/docs/VPS_DEPLOYMENT_AND_GO_LIVE_ROADMAP.md)
- Rebrand system directives:
  - [`directives/master_blueprint.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/master_blueprint.md)
  - [`directives/01_architecture.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/01_architecture.md)
  - [`directives/02_lessons.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/02_lessons.md)
  - [`directives/03_quant_logic.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/03_quant_logic.md)
  - [`directives/04_framework_rules.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/04_framework_rules.md)
  - [`directives/05_strategy_customizer.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/05_strategy_customizer.md)
  - [`directives/06_volumetric_sponsorship.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/06_volumetric_sponsorship.md)
  - [`directives/07_m2m_agent_mcp_guide.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/07_m2m_agent_mcp_guide.md)
  - [`AGENTS.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/AGENTS.md)
  - [`.cursorrules`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/.cursorrules)
  - [`ENGINE_CAPABILITY_MAP.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/ENGINE_CAPABILITY_MAP.md)

### Phase 2: Codebase Safety Gates & Environment Isolation
- **Fail-Safe Live Gate in Execution Engine:** Update [`src/lib/quantEngine/AutomatedStrategyExecutionEngine.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/AutomatedStrategyExecutionEngine.ts) to verify `process.env.IS_LIVE_VPS === 'true'` before routing live orders.
- **Read-Only Local Protection:** Update [`src/app/api/settings/route.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/settings/route.ts) and [`src/app/api/strategies/route.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/strategies/route.ts) so that if `process.env.READ_ONLY_LOCAL === 'true'` (default on localhost:4000), all `POST`/`PUT`/`DELETE` mutations return `403 Forbidden`.

### Phase 3: Stealth Decoy Routing & Private Cockpit
- Create decoy root route handler / middleware that serves a non-financial telemetry worker response on unauthenticated apex `quegar.com` requests.
- Configure private routing on `core.quegar.com` with fail-closed 404 response for unauthenticated visitors.
- Protect M2M agent endpoints (`/api/mcp`, `/api/agent/context`) behind M2M bearer token validation.

### Phase 4: Local PostgreSQL Schema & Migration Scripts
- Create PostgreSQL setup & migration script (`scripts/db/init_quegar_db.sql`) to provision:
  - Database: `quegar_db`
  - Admin user: `quegar_admin` (full read/write for VPS live engine)
  - Read-only user: `quegar_readonly` (strictly `SELECT` permissions for local dev SSH tunnel)
  - Tables: `system_settings`, `terminal_settings`, `custom_strategies`, `agent_decision_log`, `oauth_access_tokens`, `trades`.
- Update database connection utilities to support standard PostgreSQL connection strings (`POSTGRES_URL=postgres://quegar_admin:password@localhost:5432/quegar_db`) without Neon dependencies.

### Phase 5: Telegram Bot Architecture & Notifications
- Update [`src/lib/notifications/telegramNotifier.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/notifications/telegramNotifier.ts) and [`src/lib/notifications/telegramBotService.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/notifications/telegramBotService.ts) to support:
  - `TELEGRAM_LIVE_BOT_TOKEN` for VPS live engine alerts.
  - `TELEGRAM_ENABLED=false` fallback for local dev.
  - Formatted 2-Stage Dynamic Harvest alerts (50% TP1 @ 1.0R / 50% TP2 @ 1.4R).

### Phase 6: PM2 Ecosystem Configuration & Operational Scripts
- Update [`ecosystem.config.js`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/ecosystem.config.js) to manage:
  - `quegar-server`: Next.js standalone server on port 3000.
  - `quegar-daemon`: Headless 24/7 background execution engine.
  - `quegar-dev`: Local dev runner on port 4000.
- Update [`scripts/headless-daemon.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/scripts/headless-daemon.ts) with the Quegar engine header, cold-start bootstrap, and 2-stage execution flow.

---

## 🔍 Verification Plan

### Automated Tests
1. **Audit Live Execution Gating:**
   ```bash
   npx tsx scripts/audit_live_execution_gating.ts
   ```
   *Expectation:* Verifies that execution fails safely unless `IS_LIVE_VPS=true` and `NODE_ENV=production`.
2. **Local Read-Only Guard Audit:**
   ```bash
   npx tsx -e "console.log('Testing READ_ONLY_LOCAL guard on settings API...')"
   ```
   *Expectation:* Verifies write endpoints reject mutating requests when `READ_ONLY_LOCAL=true`.
3. **Database Schema & Parity Verification:**
   ```bash
   npx tsx scripts/audit_quant_lab_parity.ts
   ```
   *Expectation:* Verifies 1:1 strategy math parity and clean local data handling.
4. **TypeScript Compilation & Next.js Build:**
   ```bash
   npm run build
   ```
   *Expectation:* Zero TypeScript errors, clean production bundle.

### Manual Verification
- Verify SSH tunnel connectivity to VPS: `ssh -i key.pem -L 3000:localhost:3000 ubuntu@57.181.64.238`.
- Test unauthenticated public curl to `https://quegar.com` to verify decoy telemetry response.
- Verify Telegram alert receipt from `@QuegarLiveBot`.
