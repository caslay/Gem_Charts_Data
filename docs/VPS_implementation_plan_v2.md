# 🚀 Flow-State Quant Engine — VPS Deployment Roadmap

> **Status:** Finalized Roadmap (No Code Phase)  
> **Engine Version:** V16.68 (5m Champion, Headless-Ready)  
> **Last Updated:** 2026-08-27  
> **Architecture:** VPS-Only (Lightsail) | SSH Tunnel | Binance Testnet-First  

---

## ✅ Decisions Locked

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Q1 — Architecture** | **VPS-Only** (everything on Lightsail) | Single place to update, single deployment, no Vercel/VPS split sync headaches. Easier future maintenance. |
| **Q2 — Binance API** | **Testnet sandbox first → live API** | Safest validation path. Engine logic stays identical, only env vars swap. |
| **Q3 — Domain** | **No domain. SSH Tunnel only.** | Zero cost, maximum stealth. Add domain later in 30 minutes if ever needed. |
| **Q4 — Lightsail Plan** | **\$7/month** | See rationale below ↓ |

### 💡 Plan Selection Rationale (\$7 vs Others)

| Plan | RAM | Verdict |
|------|-----|---------|
| \$5 / 0.5 GB | 512 MB | ❌ Too tight. `npm run build` for Next.js alone needs ~400–500 MB. Running the daemon alongside leaves no headroom. Risk of OOM kill mid-session. |
| **\$7 / 1 GB** | **1 GB** | **✅ Sweet spot.** Enough for Next.js production server + headless daemon + PM2 process manager. ~400 MB left for OS overhead. |
| \$12 / 2 GB | 2 GB | Overkill for current scope. Can upgrade later with zero downtime via Lightsail snapshot migration. |

> [!TIP]
> Lightsail lets you **upgrade the plan at any time** by creating a snapshot of the instance and restoring it on a larger plan. You are never locked in.

---

## 🏗️ Final Architecture (VPS-Only)

```
YOUR BROWSER (Local)
      │
      │  SSH Tunnel: ssh -L 3000:localhost:3000 ubuntu@VPS_IP
      │
      ▼
AWS Lightsail VPS — $7/month (Ubuntu 22.04 LTS, 1GB RAM)
  ├── PM2 Process 1: Next.js Production Server (port 3000)
  │     ├── All /api/* routes (market-data, mcp, agent/context, trades...)
  │     ├── UI Dashboard (chart, journal, quant lab, backtest)
  │     └── MCP Server (/api/mcp) for Gemini Spark / Antigravity
  │
  ├── PM2 Process 2: Headless Execution Daemon
  │     ├── Node.js Binance WebSocket (replaces browser useBinanceWS)
  │     ├── AutomatedStrategyExecutionEngine (24/7 live tick processing)
  │     └── Posts fills/decisions → localhost:3000/api/agent/context (internal)
  │
  └── Neon PostgreSQL (Cloud — unchanged)
        ├── agent_decision_log
        └── oauth_access_tokens
```

> [!NOTE]
> The daemon calls the Next.js API routes **internally** via `localhost:3000` — no public internet round-trip. No M2M secret needed for internal calls (can use a local env flag). This is the cleanest approach.

---

## 📋 5-Phase Deployment Plan

### PHASE 1 — Provision Lightsail VPS
**Goal:** Running Ubuntu instance with static IP and SSH access.

| Step | Action |
|------|--------|
| 1.1 | Create Lightsail instance → Ubuntu 22.04 LTS → \$7 plan → name: `flow-state-vps` |
| 1.2 | Attach a **Static IP** (free while attached to an instance) |
| 1.3 | Lightsail Firewall: **Only open port 22** (SSH). Keep port 3000 closed to public. |
| 1.4 | Download keypair `.pem` file from Lightsail Account → SSH Keys |
| 1.5 | First SSH connection: `ssh -i key.pem ubuntu@STATIC_IP` |

---

### PHASE 2 — Server Environment Setup
**Goal:** Node.js 20, PM2, Git, project files, and environment variables ready.

| Step | Action |
|------|--------|
| 2.1 | `sudo apt update && sudo apt upgrade -y` |
| 2.2 | Install Node.js 20 LTS via NodeSource script |
| 2.3 | `sudo npm install -g pm2` |
| 2.4 | `sudo apt install -y git` |
| 2.5 | Clone/upload project to `/home/ubuntu/flow-state` |
| 2.6 | `npm install` (install all dependencies) |
| 2.7 | Create `.env.local` with all production env vars (see variables list below) |
| 2.8 | `npm run build` — verify 0 errors |

**Required `.env.local` variables:**
```
BINANCE_API_KEY          → Testnet key first
BINANCE_API_SECRET       → Testnet secret first
BINANCE_BASE_URL         → https://testnet.binancefuture.com (testnet) → https://fapi.binance.com (live)
POSTGRES_URL             → Neon connection string (unchanged)
M2M_AGENT_SECRET         → existing value
OAUTH_CLIENT_ID          → existing value
OAUTH_CLIENT_SECRET      → existing value
NEXTAUTH_SECRET          → existing value
NEXTAUTH_URL             → http://localhost:3000 (SSH tunnel access)
```

---

### PHASE 3 — Headless Execution Daemon
**Goal:** A standalone Node.js script that runs the engine 24/7 without a browser.

**What needs to be written (new code — future session):**

| File | Purpose |
|------|---------|
| `scripts/headless-daemon.ts` | Main entry point. Boots engine, opens Binance WS, feeds ticks to `AutomatedStrategyExecutionEngine` |
| `scripts/lib/nodeWsClient.ts` | Node.js equivalent of `useBinanceWS` using the `ws` npm package (not a browser hook) |
| `scripts/lib/internalApiClient.ts` | Thin wrapper to POST fills/decisions to `localhost:3000/api/agent/context` |
| `ecosystem.config.js` | PM2 config: 2 apps (next-server + daemon), restart policies, log paths |

**Engine compatibility verified (V16.64):**
- ✅ `AutomatedStrategyExecutionEngine.ts` — 0 browser globals
- ✅ `SweepReclaimEngine.ts` — 0 browser globals
- ✅ `structuralBootstrap.ts` — 0 browser globals
- ⚠️ `useBinanceWS` — browser hook → **needs Node.js `ws` replacement** (the only new component)

---

### PHASE 4 — Dashboard Access (SSH Tunnel)
**Goal:** View the live dashboard on your local browser with zero public ports open.

**Permanent command to access dashboard:**
```
ssh -i key.pem -N -L 3000:localhost:3000 ubuntu@STATIC_IP
```
Then open: `http://localhost:3000`

**Optional: `~/.ssh/config` shortcut (set up once, use forever):**
```
Host flowstate
  HostName YOUR_STATIC_IP
  User ubuntu
  IdentityFile ~/path/to/key.pem

# Then run: ssh -N -L 3000:localhost:3000 flowstate
```

> [!TIP]
> On Windows, you can use the built-in OpenSSH client in PowerShell or Windows Terminal. No PuTTY needed.

---

### PHASE 5 — Testnet Validation → Live Cutover
**Goal:** Confirm engine executes correctly on testnet before touching real capital.

| Step | Action | Success Criteria |
|------|--------|-----------------|
| 5.1 | Start daemon with testnet API keys | PM2 shows `online`, no crash loops |
| 5.2 | Let engine run through a full session (London + NY) | Setups detected, limit orders placed in testnet |
| 5.3 | Inspect `agent_decision_log` in Neon DB | Decisions persisted with correct bias + invalidation |
| 5.4 | Check session journal (dashboard) | Trades appear in journal with correct P&L math |
| 5.5 | Verify cold-start reconciliation | Restart PM2 daemon → old historical setups NOT re-armed |
| 5.6 | **Swap to live API keys** | Update `.env.local` → `pm2 restart flow-state-daemon` |

---

## 🔒 Security Hardening (Do After Phase 2)

| Task | Priority |
|------|----------|
| Restrict SSH to your home IP in Lightsail firewall | 🔴 High |
| Disable password SSH auth (keypair only) | 🔴 High |
| Ensure `.env.local` is in `.gitignore` | 🔴 High |
| Install `fail2ban` (blocks brute-force SSH) | 🟡 Medium |
| Change default SSH port 22 → custom port | 🟡 Medium |
| Set `NEXTAUTH_URL=http://localhost:3000` so login page only works via tunnel | 🟢 Low |

---

## 🔄 Future Update Workflow (Maintenance)

When a new version is ready to deploy:

```
1. SSH into VPS
2. cd /home/ubuntu/flow-state
3. git pull origin main          ← pull new code
4. npm install                   ← update deps if needed
5. npm run build                 ← rebuild Next.js
6. pm2 restart all               ← zero-downtime restart
```

> [!NOTE]
> This is why VPS-only is the right call for maintainability. One server, one `git pull`, one `pm2 restart`. No Vercel dashboard, no split deployments, no env-var duplication across two platforms.

---

## 📌 Open Items for Next Session

1. **Write `scripts/headless-daemon.ts`** — the only genuinely new code this deployment requires
2. **Write `scripts/lib/nodeWsClient.ts`** — Node.js `ws`-based replacement for `useBinanceWS`
3. **Write `ecosystem.config.js`** — PM2 config for both processes
4. **Confirm Binance testnet WebSocket endpoint** — `wss://stream.binancefuture.com` (testnet) vs production

---

## 🗺️ Summary Diagram

```
TODAY:  Local machine (dev) + Vercel (prod UI) + Neon DB
                      ↓
PHASE 1-2: Lightsail VPS provisioned + Node.js + repo cloned
                      ↓
PHASE 3:  Headless daemon written + PM2 running both processes
                      ↓
PHASE 4:  SSH tunnel → http://localhost:3000 (live dashboard)
                      ↓
PHASE 5A: Testnet run (validate engine + reconciliation)
                      ↓
PHASE 5B: Swap to live Binance API → Go live 🚀
```
