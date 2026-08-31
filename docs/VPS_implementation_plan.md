# 🚀 Flow-State Quant Engine — VPS Deployment Master Plan

> **Analysis of the AI Conversation + Cheap Domains PDF**  
> **Prepared:** 2026-08-27  
> **Engine Version:** V16.68 (5m Champion, Headless-Ready)  

---

## 📋 What Was the Conversation About?

You were discussing **the next evolution of the Flow-State Quant Engine**: moving it from a local dev machine + Vercel serverless deployment to a **dedicated AWS Lightsail VPS** for 24/7 headless autonomous execution. The conversation covered:

1. **Cheapest domain registrars** (Porkbun, Spaceship, Cloudflare at-cost)
2. **Domain branding** — evaluating `OrcaQuant.com` as the engine's public identity
3. **Stealth & discretion** — hiding financial infrastructure behind generic-sounding domains
4. **No-domain access** — using the raw Lightsail Static IP or an SSH tunnel

---

## 🧠 My Assessment of the Plan

### ✅ What's STRONG

| Aspect | Assessment |
|--------|-----------|
| **VPS migration timing** | **Perfect timing.** V16.64 already verified 0 browser globals in all core execution files — headless runtime is proven ready |
| **Porkbun / Spaceship choice** | Correct. Both offer flat renewal pricing without first-year bait-and-switch tricks |
| **Stealth domain concept** | Sound operational security thinking for a live autonomous trading engine |
| **SSH tunnel as fallback** | Excellent — closes all public ports, maximum stealth |

### ⚠️ What Needs Refinement

| Issue | Details |
|-------|---------|
| **Vercel vs VPS split** | The conversation doesn't clarify what moves to VPS vs what stays on Vercel. This is the most important architectural decision |
| **PM2 vs Docker** | V16.64 validated headless runtime but didn't specify the process manager. This matters for crash recovery |
| **Binance rate limits** | Lesson 20 in `02_lessons.md` shows Binance can 418-ban residential IPs. AWS data center IPs are much cleaner |
| **WebSocket persistence** | `useBinanceWS` is currently a browser hook. A VPS daemon needs a Node.js equivalent |
| **Domain is optional** | The AI correctly identified this — the raw static IP + SSH tunnel is sufficient for a private single-operator setup |

### 💡 Best Approach: Hybrid Architecture

> [!IMPORTANT]
> **Don't migrate everything away from Vercel.** The optimal architecture keeps Vercel for the public-facing Next.js UI (free, zero-ops) and uses Lightsail **only** for the headless autonomous execution daemon — the component that needs 24/7 uptime and clean IPs.

---

## 🏗️ Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     YOUR BROWSER (Local)                        │
│          http://YOUR_LIGHTSAIL_IP:3000 (SSH Tunnel)             │
│          OR https://flow-state-terminal.vercel.app              │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌────────────────────┐         ┌──────────────────────────┐
│  Vercel (Free)     │         │  AWS Lightsail VPS       │
│  Next.js Frontend  │◄────────│  Ubuntu 22.04 LTS        │
│  /api/mcp          │  M2M    │  Node.js 20 + PM2        │
│  /api/agent/context│  REST   │                          │
│  /api/market-data  │         │  headless-daemon.ts      │
│  UI Dashboard      │         │  ├─ BinanceWS (node)     │
│                    │         │  ├─ AutomatedExecEngine   │
│                    │         │  └─ POSTs decisions to   │
│                    │         │     /api/agent/context   │
└────────────────────┘         └──────────────────────────┘
         │                               │
         ▼                               ▼
┌────────────────────────────────────────────────────────┐
│              Neon PostgreSQL (Cloud)                   │
│  agent_decision_log, oauth_access_tokens               │
└────────────────────────────────────────────────────────┘
```

---

## 📝 Step-by-Step Implementation Plan

### PHASE 1 — AWS Lightsail VPS Setup (Day 1, ~2 hours)

#### Step 1.1 — Launch a Lightsail Instance
1. Go to [lightsail.aws.amazon.com](https://lightsail.aws.amazon.com)
2. Click **Create instance**
3. **Platform:** Linux/Unix
4. **Blueprint:** Ubuntu 22.04 LTS
5. **Plan:** `$5/month` (512MB RAM, 1 vCPU, 20GB SSD) — sufficient for the daemon
   - Upgrade to `$10/month` (2GB RAM) if you run the full Next.js stack on VPS too
6. **Instance name:** `flow-state-daemon` (internal — not visible publicly)
7. Click **Create** → Wait ~60 seconds for provisioning

#### Step 1.2 — Configure Static IP & Firewall
1. In Lightsail dashboard → **Networking** tab of your instance
2. Click **Create static IP** → Attach to `flow-state-daemon`
3. **Firewall rules (Lightsail Networking tab):**

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | Your IP only | SSH access |
| 3000 | TCP | Your IP only | Next.js (optional, if self-hosting UI) |
| 8080 | TCP | 0.0.0.0/0 | If exposing a health endpoint |

> [!TIP]
> For maximum stealth: **only open port 22** and access everything via SSH tunnel. No public web ports needed.

#### Step 1.3 — Connect via SSH
```bash
# Download your Lightsail keypair from the Account > SSH Keys section
# Then:
ssh -i ~/Downloads/LightsailDefaultKey.pem ubuntu@YOUR_STATIC_IP

# Or add to ~/.ssh/config for convenience:
# Host flowstate
#   HostName YOUR_STATIC_IP
#   User ubuntu
#   IdentityFile ~/Downloads/LightsailDefaultKey.pem
# Then: ssh flowstate
```

---

### PHASE 2 — Server Environment Setup (Day 1, ~1 hour)

#### Step 2.1 — Install Node.js 20 + PM2
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version  # should be v20.x.x
npm --version

# Install PM2 globally (process manager with auto-restart)
sudo npm install -g pm2

# Install Git
sudo apt install -y git
```

#### Step 2.2 — Clone Your Repository
```bash
# Option A: Clone from GitHub (if you have a private repo)
git clone https://github.com/YOUR_USERNAME/Gem_Charts_Data.git /home/ubuntu/flow-state

# Option B: SCP your project directly (if no GitHub)
# Run this from your LOCAL machine:
# scp -i LightsailDefaultKey.pem -r "c:/My Files/Work/Lab/Gem_Charts_Data" ubuntu@YOUR_IP:/home/ubuntu/flow-state
```

#### Step 2.3 — Install Dependencies
```bash
cd /home/ubuntu/flow-state
npm install
```

#### Step 2.4 — Configure Environment Variables
```bash
# Create the .env.local file (DO NOT commit this to git)
nano /home/ubuntu/flow-state/.env.local
```

Paste all your production environment variables:
```bash
# Binance
BINANCE_API_KEY=your_key
BINANCE_API_SECRET=your_secret

# Neon PostgreSQL
POSTGRES_URL=postgres://...

# M2M Authentication
M2M_AGENT_SECRET=961d2c9ac5320b55c0a455bf41c349fbaeb12b5c609ce756

# OAuth (for Gemini Spark MCP)
OAUTH_CLIENT_ID=gemini-spark-client-176ab3226a39516b
OAUTH_CLIENT_SECRET=sec_b8b3d5aec9bf2271c8f3fcca3e7b1695d58bc425a905b977

# NextAuth (if self-hosting the full UI)
NEXTAUTH_SECRET=your_secret
NEXTAUTH_URL=http://YOUR_STATIC_IP:3000
```

---

### PHASE 3 — Headless Daemon Creation (Day 2, ~3 hours)

> [!IMPORTANT]
> This is the core new code needed. V16.64 confirmed the engine has 0 browser globals, but we need a **Node.js entry point** that replaces the browser's `useBinanceWS` hook.

#### Step 3.1 — Create `scripts/headless-daemon.ts`

This file will:
1. Open a WebSocket connection to Binance Futures using `ws` (Node.js library)
2. Feed live candle ticks to `AutomatedStrategyExecutionEngine`
3. POST decisions to `/api/agent/context` (on Vercel) via M2M REST
4. Log all executions to the Neon DB

**Architecture of the daemon:**
```typescript
// scripts/headless-daemon.ts
// Headless 24/7 autonomous execution node

import WebSocket from 'ws';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { fetch15mHistory } from './lib/fetchHistory'; // new helper
import { submitDecisionToVercel } from './lib/m2mClient'; // new helper

// 1. Boot: fetch 45-day warmup history via Binance REST
// 2. Seed engine via structuralBootstrap
// 3. Open Binance WS stream for live candle ticks
// 4. On each closed candle: engine.onMultiTimeframeCandles(...)
// 5. On position fill: submitDecisionToVercel(decision)
// 6. PM2 restarts on crash; engine reconciles on cold-start
```

#### Step 3.2 — PM2 Ecosystem File `ecosystem.config.js`
```javascript
module.exports = {
  apps: [
    {
      name: 'flow-state-daemon',
      script: 'npx',
      args: 'ts-node scripts/headless-daemon.ts',
      cwd: '/home/ubuntu/flow-state',
      env: { NODE_ENV: 'production' },
      restart_delay: 5000,       // 5s between crash restarts
      max_restarts: 50,
      watch: false,
      log_file: '/var/log/flow-state/daemon.log',
    }
  ]
};
```

#### Step 3.3 — Start with PM2
```bash
pm2 start ecosystem.config.js
pm2 save              # persist across reboots
pm2 startup ubuntu    # auto-start PM2 on boot
sudo systemctl enable pm2-ubuntu

# Useful PM2 commands
pm2 logs flow-state-daemon   # live log tail
pm2 status                   # process health
pm2 restart flow-state-daemon
```

---

### PHASE 4 — Dashboard Access (No Domain Required)

#### Option A: SSH Tunnel (Maximum Stealth — Recommended)
```bash
# Run on your LOCAL machine. Tunnels VPS port 3000 to your localhost:3000.
ssh -i LightsailDefaultKey.pem -N -L 3000:localhost:3000 ubuntu@YOUR_STATIC_IP

# Then open browser:
# http://localhost:3000
```
**Pros:** Zero public ports open. Completely invisible to internet scanners.

#### Option B: Direct IP Access
```bash
# Build the Next.js app
npm run build

# Start with PM2
pm2 start npm --name 'flow-state-ui' -- run start
```
Then open: `http://YOUR_LIGHTSAIL_STATIC_IP:3000`

> [!NOTE]
> Keep NextAuth active. Unauthorized visitors hitting the raw IP will see the login page — your trading controls remain protected.

---

### PHASE 5 — Domain (Optional, Stealth-First)

Based on the AI conversation, here's the **definitive recommendation**:

#### If you want a domain (for long-term use):

| Recommendation | Domain | Cost | Vibe |
|---|---|---|---|
| 🥇 **Best Stealth** | `statevector.xyz` | ~$2-3/yr | Academic state-machine aesthetic |
| 🥈 **Runner-up** | `streamcore.dev` | ~$10/yr | Sounds like a WebSocket relay |
| 🥉 **Apex Predator Stealth** | `orcanode.net` | ~$10/yr | Removes "Quant" flag, keeps apex predator DNA |

**Register at:** [Porkbun.com](https://porkbun.com) → point A-record to your Lightsail Static IP

#### If you want HTTPS with a domain:
```bash
# Install Caddy (easiest auto-SSL)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Caddyfile at /etc/caddy/Caddyfile:
# yourdomain.xyz {
#   reverse_proxy localhost:3000
# }
# Caddy auto-issues Let's Encrypt SSL — zero config.
sudo systemctl restart caddy
```

---

## 🔒 Security Hardening (Production Checklist)

| Task | Command / Action |
|------|-----------------|
| Change SSH port from 22 | Edit `/etc/ssh/sshd_config` → `Port 2222` |
| Disable password SSH auth | `PasswordAuthentication no` in sshd_config |
| UFW firewall | `sudo ufw allow 2222/tcp; sudo ufw enable` |
| Fail2ban | `sudo apt install fail2ban -y` |
| Verify M2M bearer token is NOT in git | Check `.gitignore` includes `.env.local` |
| IP whitelist Lightsail firewall | Restrict port 3000 to your home/office IP |

---

## 🆚 VPS vs Vercel: What Moves Where?

| Component | Stay on Vercel | Move to Lightsail VPS |
|-----------|---------------|----------------------|
| Next.js UI + API routes | ✅ Yes | Optional |
| `/api/mcp` MCP server | ✅ Yes | No (Vercel stateless is fine) |
| `/api/agent/context` | ✅ Yes | No |
| `AutomatedStrategyExecutionEngine` | ❌ No (serverless = dies) | ✅ **Must move** |
| Binance WebSocket feed | ❌ No (browser-only) | ✅ **Must move** |
| PM2 crash recovery | ❌ N/A | ✅ Required |
| 24/7 uptime | ❌ No (serverless) | ✅ Core value prop |

---

## 📅 Timeline Summary

| Phase | Task | Est. Time |
|-------|------|-----------|
| Phase 1 | Lightsail VPS + Static IP + SSH access | 2 hours |
| Phase 2 | Node.js + PM2 + repo clone + .env setup | 1 hour |
| Phase 3 | Write `headless-daemon.ts` + PM2 config | 3 hours |
| Phase 4 | Dashboard access via SSH tunnel (no domain needed) | 15 minutes |
| Phase 5 (Optional) | Buy domain at Porkbun + Caddy HTTPS | 1 hour |
| **Total** | | **~7 hours** |

---

## 🚦 Open Questions

> [!IMPORTANT]
> **Q1:** Do you want the full Next.js UI running on Lightsail (VPS-only setup), or keep Vercel for the UI and only run the headless execution daemon on Lightsail?
> 
> **Q2:** Do you already have a Binance API key? The daemon needs REST + WebSocket access.
>
> **Q3:** Domain preference: pure SSH tunnel (no domain, maximum stealth) or one of the stealth domains (`statevector.xyz`, `streamcore.dev`, `orcanode.net`)?
>
> **Q4:** Budget for VPS plan: \$5/month (daemon only) or \$10/month (full UI + daemon)?

