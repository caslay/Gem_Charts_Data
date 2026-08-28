# 🚀 Flow-State Headless Daemon & 1:1 Quant Lab Reconciliation Guide

> **Engine Version:** Flow-State Quant Engine V16.70  
> **Strategy:** 5M Sweep & Reclaim Champion (The Ultimate Winner Setup)  
> **Architecture:** Pure Headless Node.js Daemon (Local VPS Host) + Sub-Second WebSockets + Atomic JSON & DB Persistence + 1:1 Quant Lab Reconciliation  

---

## 🌟 Overview & Concept

You can run the complete quantitative execution engine 24/7 on your local PC as a **Local VPS** without needing a browser tab open, with **zero DOM/React rendering overhead**, streaming sub-second market ticks directly from Binance Futures WebSockets.

### ❓ Two Ways to Run (Why PM2 is Recommended)

| Feature | 🖥️ Method A: Foreground Terminal (`npm run daemon`) | 🤖 Method B: Background Local VPS (`PM2`) — **RECOMMENDED** |
| :--- | :--- | :--- |
| **How it runs** | Opens a black console window that stays on screen | Runs silently in the background as a daemon service |
| **Window Closing** | If you close the terminal, the engine stops | **You can close PowerShell completely**, it keeps running |
| **Auto-Restart** | No auto-restart if process crashes or PC sleeps | **Auto-restarts automatically** upon network reconnections |
| **Resource Usage** | ~45 MB RAM | ~45 MB RAM |

---

## 🛑 Step 0: Clean Slate (Shut Down Everything First)

If you ever need to stop all instances and start fresh from scratch:

1. **Close any open `node.exe` foreground terminal windows** (Press `Ctrl + C` or click the `X`).
2. In PowerShell, clear all PM2 processes:
   ```powershell
   pm2 delete all
   ```

---

## 🚀 Running as a True Local VPS (PM2 Background Mode)

### **Step 1: Open PowerShell and navigate to the project**
```powershell
cd "C:\My Files\Work\Lab\Gem_Charts_Data"
```

### **Step 2: Start the Daemon via PM2**
```powershell
pm2 start ecosystem.config.js
```
*You will see a green table showing `flow-state-local` with status `online`.*

### **Step 3: Close PowerShell! (Done)**
You can now close your PowerShell / Terminal window completely. The engine is running silently in the background 24/7.

---

## 🔍 Managing the PM2 Daemon (PowerShell Commands)

Whenever you open PowerShell in the future, you can manage the local VPS with these commands:

| Action | PowerShell Command | Note |
| :--- | :--- | :--- |
| **View Live Ticks & Executions** | `pm2 logs flow-state-local` | Press `Ctrl + C` anytime to exit log view (daemon keeps running!) |
| **Check Health, Uptime & RAM** | `pm2 status` | Shows memory usage (~54 MB) and restart counts |
| **Restart Daemon** | `pm2 restart flow-state-local` | Performs a clean reboot with cold-start guard |
| **Stop Daemon (Pause)** | `pm2 stop flow-state-local` | Pauses execution |
| **Delete from PM2** | `pm2 delete flow-state-local` | Completely removes process from PM2 |
| **Save PM2 across PC Reboots** | `pm2 save` | Remembers running state for Windows startup |

---

## 🔬 1:1 Quant Lab Reconciliation & Parity Matching

To verify that the live background daemon caught the exact trades predicted by the Quant Lab backtest:

### Run the Reconciliation Script
```powershell
npm run reconcile
```
*Or match against a specific date:*
```powershell
npx tsx scripts/reconcile-session.ts --date=2026-08-27
```

### What It Does:
1. Reads your recorded live session log from `run_logs/live_session_YYYY-MM-DD.json`.
2. Fetches historical candles from Binance for that 24h window.
3. Replays the exact Quant Lab `SweepReclaimEngine` on that data.
4. Generates a **4-Pillar Parity Audit Matrix** and outputs a Markdown report at:
   `run_logs/reconciliation_YYYY-MM-DD.md`

---

## 🛠️ Optional: Running in Foreground Mode (For Quick Debugging)

If you just want to run a quick 30-second live test in the terminal without PM2:

* **30-Second Diagnostic (Dry Run):**
  ```powershell
  npm run daemon:dry
  ```

* **Foreground Live Runner (Terminal must stay open):**
  ```powershell
  npm run daemon
  ```

---

## 📁 File Structure Reference

```
Gem_Charts_Data/
├── ecosystem.config.js       # PM2 process configuration for Windows & Linux
├── scripts/
│   ├── headless-daemon.ts    # Master 24/7 background execution host
│   ├── reconcile-session.ts  # 1:1 Quant Lab parity matching engine
│   └── lib/
│       ├── restBootstrap.ts  # Cold-start 500-bar historical fetcher & macro context
│       ├── nodeWsClient.ts   # Sub-second WebSocket multi-stream driver (5m/15m/1h + aggTrade)
│       └── daemonLedger.ts   # Atomic session logger & ETHUSDC_Daily_Tracker.json syncer
└── run_logs/
    ├── live_session_*.json   # Real-time event and tick log
    └── reconciliation_*.md   # 1:1 Quant Lab comparison reports
```
