# 🏛️ Quegar Quant Engine — VPS Deployment & Institutional Go-Live Master Plan

> **System Identity:** **Quegar Quant Engine (`Quegar`)**  
> **Production Infrastructure:** AWS Lightsail VPS (`quegar-core` in Tokyo `ap-northeast-1a`, Ubuntu 24.04 LTS, Static IP: `57.181.64.238`)  
> **Domain & DNS:** `quegar.com`, `core.quegar.com`, `mcp.quegar.com` (Porkbun DNS configured)  
> **Database Architecture:** VPS Local PostgreSQL (`quegar_db` on loopback `127.0.0.1:5432`) — **Neon & Vercel Dropped Completely**  
> **Local Dev Sandbox:** `localhost:4000` via PM2 / dev server — **Strict Read-Only Access (`quegar_readonly` + `READ_ONLY_LOCAL=true`)**  
> **Exchange Isolation:** Binance Futures Live API keys reside exclusively on VPS (`57.181.64.238` IP Whitelisted)  
> **Champion Strategy:** 5M Sweep & Reclaim (2-Stage Dynamic Harvest: 50% TP1 @ 1.0R / 50% TP2 @ 1.4R, Rule 4 Inactive)  
> **Risk Sizing Model:** 2.0% Compounded Risk ($250 USD Max Risk Cap per trade)  
> **Telegram Dispatcher:** Dedicated Live Bot (`@QuegarLiveBot`) for execution alerts + polling  

---

## 📑 1. Architectural Blueprint & Environment Isolation

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     QUEGAR DECOUPLED ARCHITECTURE                                      │
├────────────────────────────────────────────────────┬───────────────────────────────────────────────────┤
│ 🚀 PRODUCTION LIGHTSAIL VPS (quegar-core)          │ 💻 LOCAL WORKSTATION SANDBOX (localhost:4000)     │
├────────────────────────────────────────────────────┼───────────────────────────────────────────────────┤
│ • Static IPv4: 57.181.64.238                       │ • Local Machine (Loopback 127.0.0.1)              │
│ • Operating System: Ubuntu 24.04 LTS               │ • Port: 4000 (Local PM2 process: quegar-dev)      │
│ • Git Tracking: Strictly 'main' branch             │ • Git Tracking: Strictly feature / dev branches   │
│ • PM2 Process 1: quegar-server (Next.js port 3000) │ • Database Access: Read-Only via SSH tunnel       │
│ • PM2 Process 2: quegar-daemon (24/7 Engine)       │   (quegar_readonly user + READ_ONLY_LOCAL=true)  │
│ • Database: Local PostgreSQL (quegar_db)           │ • Exchange Keys: ZERO Live Keys (Testnet / Paper) │
│ • Binance API: Live Keys (IP Whitelisted to VPS)   │ • Fail-Safe: Live order routing blocked in code   │
│ • Telegram Bot: @QuegarLiveBot (TELEGRAM_LIVE_BOT) │ • Telegram: TELEGRAM_ENABLED=false (or Sandbox)   │
│ • Domain / Web: quegar.com (Stealth Decoy)         │ • Storage: Local JSON buffers (data/quant_lab/)   │
│   and core.quegar.com (Fail-Closed Private Cockpit)│                                                   │
└────────────────────────────────────────────────────┴───────────────────────────────────────────────────┘
```

---

## 🛡️ 2. The 5 Institutional Security & Stealth Pillars

### Pillar 1: Total Elimination of Neon Cloud Database & Vercel
* **The Problem:** Neon database bandwidth quotas lead to HTTP 402 errors and query throttling; Vercel serverless builds introduce cold starts and route stripping.
* **The Solution:** Self-host PostgreSQL 16 directly on the Lightsail VPS (`localhost:5432`). 
  * Sub-millisecond loopback query latency ($< 0.5\text{ ms}$).
  * Zero bandwidth or transfer quotas.
  * Standalone Next.js Node server managed permanently by PM2.

### Pillar 2: Localhost:4000 Read-Only Isolation (Zero VPS Write Access)
* **The Problem:** Accidental settings changes or strategy overrides from local development leaking into the live production database.
* **The Solution:** 2-tier read-only enforcement:
  1. **PostgreSQL Role Level:** `quegar_readonly` role has `GRANT SELECT ON ALL TABLES` only. Any `INSERT`, `UPDATE`, `DELETE`, or `ALTER` is rejected at the database engine level.
  2. **Application Level:** `READ_ONLY_LOCAL=true` guard in Next.js route handlers (`/api/settings`, `/api/strategies`, etc.) returning `403 Forbidden` if local dev attempts to mutate state.

### Pillar 3: 3-Layer Binance Live Trading Isolation
* **The Problem:** Risk of rogue test orders executing live trades on Binance from a local machine.
* **The Solution:** 3-layer live execution barrier:
  1. **Exchange IP Whitelist:** Binance API key restricted exclusively to VPS static IP `57.181.64.238`. Binance rejects requests from any other IP.
  2. **Codebase Fail-Safe Gate:** `AutomatedStrategyExecutionEngine` mandates `process.env.NODE_ENV === 'production' && process.env.IS_LIVE_VPS === 'true' && process.env.AUTO_EXECUTE === 'true'`.
  3. **Zero Local Live Keys:** Local `.env.local` contains strictly empty keys, Binance Testnet keys, or offline paper simulation mode.

### Pillar 4: Maximum Stealth & Decoy Route Architecture
* **The Problem:** Public scrapers, port scanners, and unauthorized visitors discovering the quantitative trading engine.
* **The Solution:**
  * **Root Apex (`https://quegar.com`):** Returns a lightweight, generic, non-financial developer telemetry response (`{"status":"healthy","service":"telemetry-worker","timestamp":"..."}`) or static placeholder.
  * **Private Cockpit (`core.quegar.com`):** Private trading dashboard gated behind NextAuth with a fail-closed `404 Not Found` for unauthenticated visitors.
  * **M2M / MCP Gateway (`mcp.quegar.com` or `/api/mcp`):** Machine-to-Machine interface secured via high-entropy M2M bearer secret / OAuth 2.0 with fail-closed responses.
  * **SSH Tunnel Fallback:** Full private cockpit access is also always available via `ssh -i key.pem -L 3000:localhost:3000 ubuntu@57.181.64.238`.

### Pillar 5: Dedicated Live Telegram Bot Separation
* **The Problem:** Polling collisions (`getUpdates` conflict) and alert spam between live trading and local backtesting.
* **The Solution:**
  * **Live VPS Engine:** Connects to `@QuegarLiveBot` via `TELEGRAM_LIVE_BOT_TOKEN`, delivering 2-Stage Dynamic Harvest alerts (50% TP1 @ 1.0R / 50% TP2 @ 1.4R) and listening for authenticated remote interactive commands.
  * **Local Dev Sandbox:** `TELEGRAM_ENABLED=false` by default, or optionally routed to a separate `@QuegarDevBot` sandbox channel.

---

## 📅 3. Phased Implementation & Go-Live Schedule

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               👑 QUEGAR GO-LIVE EXECUTION PHASES                                 │
├─────────┬──────────────────────────────────┬───────────────────────┬─────────────────────────────┤
│ Phase   │ Focus Area                       │ Target Timeline       │ Primary Objective           │
├─────────┼──────────────────────────────────┼───────────────────────┼─────────────────────────────┤
│ **PHASE 1** │ VPS OS Hardening, Swap & Chrony  │ Day 1 (Morning)       │ Ubuntu 24.04, UFW, Chrony   │
│ **PHASE 2** │ Local PostgreSQL Setup & Schema  │ Day 1 (Midday)        │ quegar_db & quegar_readonly │
│ **PHASE 3** │ Node 20, PM2 & Quegar Build      │ Day 1 (Afternoon)     │ Next.js & Headless Daemon   │
│ **PHASE 4** │ Binance API Bind & Latency Audit │ Day 1 (Evening)       │ IP Whitelist & Balance Check│
│ **PHASE 5** │ @QuegarLiveBot Verification      │ Day 1 (Night)         │ 2-Stage Alert Dispatch      │
│ **PHASE 6** │ 24-Hour Paper Diagnostic Warm-Up │ Day 2 (24h Run)       │ Real-time WS order flow     │
│ **PHASE 7** │ 👑 PRIME GO-LIVE ARMED           │ Day 3 @ NY Open       │ Live Execution Armed        │
└─────────┴──────────────────────────────────┴───────────────────────┴─────────────────────────────┘
```

---

## 🛠️ 4. Step-by-Step Technical Execution Guide

### Phase 1: VPS System Hardening & Millisecond NTP Setup
1. **Connect to VPS:**
   ```bash
   ssh -i LightsailDefaultKey-ap-northeast-1.pem ubuntu@57.181.64.238
   ```
2. **Update Packages & Configure 2GB Swap Space:**
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   sudo sysctl vm.swappiness=10
   echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
   ```
3. **Chrony Microsecond Time Synchronization:**
   ```bash
   sudo apt install -y chrony
   sudo systemctl enable --now chrony
   chronyc tracking
   ```
4. **UFW Firewall Setup:**
   ```bash
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw --force enable
   ```

---

### Phase 2: PostgreSQL 16 Installation & Schema Provisioning
1. **Install PostgreSQL on VPS:**
   ```bash
   sudo apt install -y postgresql postgresql-contrib
   sudo systemctl enable --now postgresql
   ```
2. **Initialize Database & Users:**
   ```bash
   sudo -u postgres psql
   ```
   Execute the schema initialization:
   ```sql
   CREATE DATABASE quegar_db;
   
   -- 1. Create Admin User (Full Access for Live VPS Engine)
   CREATE USER quegar_admin WITH ENCRYPTED PASSWORD 'YOUR_STRONG_ADMIN_PASSWORD';
   GRANT ALL PRIVILEGES ON DATABASE quegar_db TO quegar_admin;
   
   -- 2. Create Read-Only User (For Localhost:4000 Dev Sandbox)
   CREATE USER quegar_readonly WITH ENCRYPTED PASSWORD 'YOUR_STRONG_READONLY_PASSWORD';
   GRANT CONNECT ON DATABASE quegar_db TO quegar_readonly;
   \c quegar_db
   GRANT USAGE ON SCHEMA public TO quegar_readonly;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO quegar_readonly;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO quegar_readonly;
   ```

---

### Phase 3: Node.js 20, PM2 & Quegar Repository Setup
1. **Install Node.js 20 LTS:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs build-essential git
   sudo npm install -g pm2 tsx
   pm2 startup systemd
   ```
2. **Clone Quegar Codebase:**
   ```bash
   git clone https://github.com/your-username/Gem_Charts_Data.git /home/ubuntu/quegar
   cd /home/ubuntu/quegar
   npm ci
   ```
3. **Configure VPS Production Environment (`.env.production`):**
   ```env
   # =================================================================
   # 🏛️ QUEGAR QUANT ENGINE — VPS PRODUCTION CONFIGURATION
   # =================================================================
   NODE_ENV=production
   IS_LIVE_VPS=true
   AUTO_EXECUTE=true
   
   # 1. Binance Futures API (Live Keys - Whitelisted to 57.181.64.238)
   BINANCE_API_KEY=your_binance_futures_api_key_here
   BINANCE_API_SECRET=your_binance_futures_api_secret_here
   BINANCE_BASE_URL=https://fapi.binance.com
   BINANCE_WS_URL=wss://fstream.binance.com
   
   # 2. Sizing & Strategy Configuration
   STRATEGY_SYMBOL=ETHUSDC
   STARTING_EQUITY_USD=10000.00
   COMPOUNDING_RISK_PCT=2.0
   MAX_RISK_CAP_USD=250.00
   MAX_OPEN_POSITIONS=1
   
   # 3. 2-Stage Dynamic Harvest Champion Model
   SR_STAGE1_RATIO=0.50
   SR_STAGE2_RATIO=0.50
   SR_STAGE3_RATIO=0.00
   SR_STAGE1_MULTIPLE=1.0
   SR_STAGE2_MULTIPLE=1.4
   SR_STAGE3_MULTIPLE=3.0
   SR_ENABLE_STRUCTURAL_TRAIL=true
   SR_ENABLE_EARLY_BREAKEVEN=false
   
   # 4. Telegram Live Bot Configuration
   TELEGRAM_LIVE_BOT_TOKEN=your_telegram_live_bot_token_here
   TELEGRAM_CHAT_ID=your_telegram_chat_id_here
   TELEGRAM_ENABLED=true
   
   # 5. Database (VPS Local PostgreSQL)
   POSTGRES_URL=postgres://quegar_admin:YOUR_STRONG_ADMIN_PASSWORD@127.0.0.1:5432/quegar_db
   
   # 6. Security & M2M
   NEXTAUTH_SECRET=generate_with_openssl_rand_hex_32
   NEXTAUTH_URL=https://core.quegar.com
   M2M_AGENT_SECRET=your_high_entropy_m2m_secret
   ```
4. **Compile Quegar Next.js Application:**
   ```bash
   npm run build
   ```

---

### Phase 4: Binance Connectivity & IP Whitelist Verification
Run the verification check on the VPS:
```bash
npx tsx scripts/audit_live_execution_gating.ts
```

---

### Phase 5: PM2 Process Orchestration & Launch
Start the two dedicated Quegar processes using `ecosystem.config.js`:
```bash
# Start Quegar Server & Daemon
pm2 start ecosystem.config.js

# Save PM2 state for automatic reboot recovery
pm2 save

# Monitor live execution stream
pm2 logs quegar-daemon --lines 50
```

---

## 🛡️ 5. Localhost:4000 Development Sandbox SOP

When working locally on your development machine:
1. **Local Environment File (`.env.local`):**
   ```env
   NODE_ENV=development
   IS_LIVE_VPS=false
   READ_ONLY_LOCAL=true
   AUTO_EXECUTE=false
   
   # Read-Only Database Connection over SSH Tunnel (Port 5433 -> VPS 5432)
   POSTGRES_URL=postgres://quegar_readonly:YOUR_READONLY_PASSWORD@127.0.0.1:5433/quegar_db
   
   # Offline / Testnet Simulation
   BINANCE_BASE_URL=https://testnet.binancefuture.com
   BINANCE_WS_URL=wss://stream.binancefuture.com
   
   TELEGRAM_ENABLED=false
   ```
2. **Open Read-Only SSH Database Tunnel:**
   ```bash
   ssh -i LightsailDefaultKey-ap-northeast-1.pem -N -L 5433:localhost:5432 ubuntu@57.181.64.238
   ```
3. **Launch Local Sandbox:**
   ```bash
   npm run dev
   # Terminal accessible at http://localhost:4000
   ```

---

## 🚨 6. Emergency Killswitch & Incident Management

1. **Immediate Execution Pause:**
   ```bash
   pm2 stop quegar-daemon
   ```
2. **Market Close All Active Positions:**
   Log into Binance Futures Web/App ➔ Click **Close All Positions (Market)**.
3. **Emergency API Revocation:**
   Instantly delete or disable API key in Binance API Management.
