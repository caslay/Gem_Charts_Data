# 🏛️ Quegar Quant Engine — Master Live Deployment & Infrastructure Ledger

> **Document Type:** Master Operational & Production Architecture Ledger  
> **System Identity:** **Quegar Quant Engine (`QUEGAR`)**  
> **Production Target:** AWS Lightsail VPS (`quegar-core` | `57.181.64.238` — Tokyo `ap-northeast-1a`)  
> **Status:** 🟢 **CORE INFRASTRUCTURE LIVE & AUTHENTICATED**  
> **Last Synchronized:** September 1, 2026 (`2026-09-01T20:10:00Z`)  

---

## 🏗️ 1. Completed Infrastructure & Security Manifest

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   QUEGAR LIVE PRODUCTION TOPOLOGY                                      │
├──────────────────────────────────────┬─────────────────────────────────────────────────────────────────┤
│ Architectural Layer                  │ Production Implementation Specification                         │
├──────────────────────────────────────┼─────────────────────────────────────────────────────────────────┤
│ **Host Compute Instance**            │ AWS Lightsail `quegar-core` (Tokyo `ap-northeast-1a`)           │
│ **Operating System**                 │ Ubuntu 24.04 LTS (Kernel `6.17.0-1019-aws`, 64-bit)            │
│ **Hardware Specs & Memory**          │ 2 vCPUs, 1 GB RAM + 2.0 GB Active Swap (`/swapfile` in fstab)  │
│ **Public IPv4 Allocation**           │ Static IP: `57.181.64.238` (Attached to `quegar-core`)          │
│ **DNS & Domain Names (Porkbun)**     │ • Apex `@` (`quegar.com`)        $\rightarrow$ `57.181.64.238`  │
│                                      │ • Trading Cockpit (`core.quegar.com`) $\rightarrow$ `57.181.64.238` │
│                                      │ • M2M Agent Gateway (`mcp.quegar.com`) $\rightarrow$ `57.181.64.238`│
│ **Edge Web Server & TLS**            │ Caddy v2.11.4 with automated Let's Encrypt / ZeroSSL TLS        │
│ **Internal Port Routing**            │ Ports 80/443 $\rightarrow$ Next.js Standalone on Port 5522      │
│ **Database Architecture**            │ PostgreSQL 16.15 on loopback (`127.0.0.1:5432`/`quegar_db`)     │
│ **Database Role Isolation**          │ • `quegar_admin`    : Full R/W for VPS Next.js server & daemon  │
│                                      │ • `quegar_readonly` : Read-Only `SELECT` for local dev sandbox  │
│ **Authentication & Authorization**   │ NextAuth v5 + Google OAuth 2.0 (`https://core.quegar.com/login`)│
│ **Public Stealth Layer**             │ Root `https://quegar.com` returns non-financial telemetry JSON  │
│ **Process Supervisor (PM2)**         │ • `quegar-server` (PID 26072, Next.js 16.2.4, Port 5522)        │
│                                      │ • `quegar-daemon` (PID 23570, 24/7 Headless WebSocket Engine)   │
│ **NTP Clock Synchronization**        │ Chrony actively synchronized to AWS NTP ($< 1\ \mu\text{s}$)    │
└──────────────────────────────────────┴─────────────────────────────────────────────────────────────────┘
```

---

## 📈 2. Codebase & Mathematical Parity Status

```
┌──────────────────────────────────────┬─────────────────────────────────────────────────────────────────┤
│ Metric / Strategy Parameter          │ Institutional Implementation Status                             │
├──────────────────────────────────────┼─────────────────────────────────────────────────────────────────┤
│ **Brand Identity**                   │ **Quegar Quant Engine** (`Quegar`) — full directive alignment   │
│ **Champion Strategy**                │ 5M Sweep & Reclaim (Champion Preset: `factory_sr_5m_winner`)    │
│ **Multi-Stage Harvesting**           │ 2-Stage Dynamic Harvest: 50% TP1 @ 1.0R / 50% TP2 @ 1.4R        │
│ **Trailing Stop Model**              │ Structural Trailing (Pivot / FVG Consequent Encroachment)       │
│ **Streak Anti-Loss Rule 4**          │ Early Breakeven Disabled by default (Pure baseline alpha)       │
│ **Compounding Risk Sizing**          │ 2.0% Compounded Risk per trade with $250.00 USD Hard Risk Cap   │
│ **Local Sandbox Safety Guard**       │ `READ_ONLY_LOCAL=true` guard on `/api/settings` & `/api/strategies`│
│ **Live Execution Gate**              │ `IS_LIVE_VPS=true` + `NODE_ENV=production` required in code     │
│ **Zero-Browser Headless Daemon**     │ Native `ws` client with sub-second WebSocket tick processing    │
└──────────────────────────────────────┴─────────────────────────────────────────────────────────────────┘
```

---

## 📋 3. Remaining Go-Live Punch List (Pending Activation)

| Task | Component | Operational Action | Status |
| :--- | :--- | :--- | :--- |
| **1. Exchange Credentials Injection** | Binance Futures API | Update `/home/ubuntu/quegar/.env.production` with live Binance API & Secret Keys (Strictly Whitelisted to `57.181.64.238`, Futures Trading enabled, Withdrawals STRICTLY DISABLED). | ⏳ Pending User Key Entry |
| **2. Telegram Live Bot Pairing** | Real-Time Alerts | Dedicated `@QuegarLiveBot` configured in `.env.production` (`TELEGRAM_ENABLED=true`), long-polling active in `quegar-daemon`. | 🟢 Active & Polling (Awaiting `/start`) |
| **3. Local Dev Read-Only Tunnel Verification** | Development Sandbox | Establish SSH database tunnel (`ssh -i key.pem -N -L 5433:localhost:5432 ubuntu@57.181.64.238`) and verify `localhost:4000` dev server reads live state without mutation rights. | ⏳ Ready for Testing |
| **4. End-to-End Live Session Smoke Test** | Full Trading Terminal | Access `https://core.quegar.com`, log in with authorized Google account, and verify real-time chart rendering, open position tracker, and WebSocket order flow sync. | ⏳ Ready for Execution |

---

## 🛠️ 4. Quick Operational Management Guide

### Accessing the Live Dashboard
* **Direct HTTPS (Browser):** [**https://core.quegar.com**](https://core.quegar.com)
* **Private SSH Tunnel (Alternative):**
  ```bash
  ssh -i LightsailDefaultKey-ap-northeast-1.pem -N -L 5522:localhost:5522 ubuntu@57.181.64.238
  ```
  *Then open `http://localhost:5522` in your local browser.*

### Useful Server Commands (Over SSH)
```bash
# Check status of all running processes
ssh -i LightsailDefaultKey-ap-northeast-1.pem ubuntu@57.181.64.238 "pm2 status"

# Stream live headless daemon execution logs
ssh -i LightsailDefaultKey-ap-northeast-1.pem ubuntu@57.181.64.238 "pm2 logs quegar-daemon --lines 50"

# Restart all Quegar services
ssh -i LightsailDefaultKey-ap-northeast-1.pem ubuntu@57.181.64.238 "pm2 restart all"

# Check Caddy edge reverse proxy status & logs
ssh -i LightsailDefaultKey-ap-northeast-1.pem ubuntu@57.181.64.238 "sudo systemctl status caddy"
```
