# 🏛️ Quegar Quant Engine — Architecture & Deployment Walkthrough

## 🎯 Executive Overview

We have audited all legacy deployment plans, resolved outdated and conflicting architecture patterns, and established the official **Quegar Quant Engine (Quegar)** decoupled VPS roadmap.

---

## 🔑 Key Changes Delivered

### 1. Unified Master Roadmap & Outdated Info Deprecation
- **Consolidated Roadmap Created:** [`docs/QUEGAR_VPS_DEPLOYMENT_AND_GO_LIVE_MASTER_PLAN.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/docs/QUEGAR_VPS_DEPLOYMENT_AND_GO_LIVE_MASTER_PLAN.md)
- **Resolved Gaps:**
  - Deprecated Neon cloud database & Vercel serverless in favor of self-hosted PostgreSQL 16 (`quegar_db`) and standalone Next.js on AWS Lightsail (`quegar-core` at `57.181.64.238`).
  - Superseded old 3-stage harvest models with the 2-Stage Dynamic Harvest Champion Model (50% TP1 @ 1.0R / 50% TP2 @ 1.4R).

### 2. Localhost:4000 Read-Only Isolation (Zero VPS Write Access)
- **Database Layer:** Created PostgreSQL provisioning script ([`scripts/db/init_quegar_db.sql`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/scripts/db/init_quegar_db.sql)) defining a dedicated `quegar_readonly` role with `GRANT SELECT ON ALL TABLES` only.
- **Application Layer:** Added `READ_ONLY_LOCAL=true` guards to [`src/app/api/settings/route.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/settings/route.ts) and [`src/app/api/strategies/route.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/strategies/route.ts) returning `403 Forbidden` if local dev attempts to mutate VPS settings or strategies.

### 3. 3-Layer Binance Live Trading Isolation
1. **Exchange IP Whitelist:** Live API key restricted to VPS static IP `57.181.64.238`.
2. **Codebase Fail-Safe Gate:** Mandates `NODE_ENV === 'production' && process.env.IS_LIVE_VPS === 'true' && process.env.AUTO_EXECUTE === 'true'`.
3. **Zero Local Keys:** Local workstation uses only Testnet / Offline simulation mode.

### 4. Stealth & Decoy Route Architecture
- **Root Apex Decoy:** Public visits to `quegar.com` return a lightweight, non-financial developer telemetry response via [`src/app/api/telemetry/route.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/telemetry/route.ts).
- **Private Cockpit:** Secured behind NextAuth on `core.quegar.com` (or SSH tunnel `localhost:3000`) with fail-closed 404 for unauthenticated requests.

### 5. Dedicated Telegram Bot Architecture
- Dedicated `@QuegarLiveBot` token (`TELEGRAM_LIVE_BOT_TOKEN`) on the VPS for live 2-Stage Dynamic Harvest notifications.
- Local development sandbox defaults to `TELEGRAM_ENABLED=false`.

### 6. Full Brand Standardization: "Quegar"
- Updated system directives: [`directives/01_architecture.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/01_architecture.md), [`directives/07_m2m_agent_mcp_guide.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/07_m2m_agent_mcp_guide.md), [`directives/master_blueprint.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/master_blueprint.md) (V17.15 Changelog).
- Updated agent protocols: [`AGENTS.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/AGENTS.md), [`.cursorrules`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/.cursorrules), [`ENGINE_CAPABILITY_MAP.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/ENGINE_CAPABILITY_MAP.md).
- Updated PM2 process ecosystem: [`ecosystem.config.js`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/ecosystem.config.js) (`quegar-server`, `quegar-daemon`, `quegar-dev`).

---

## 🧪 Verification Results

- **Live Execution Gating Simulation:** ✅ 4/4 Passed (0 Stale setups, 0 Below-anchor dump fills, 100% 4-phase retest compliance).
- **Next.js Production Build:** ✅ `Compiled successfully in 8.8s`, 0 TypeScript errors.
