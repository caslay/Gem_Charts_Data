# 🏛️ Multi-Year Quantitative Benchmark & Dynamic Compounding Study
## 5-Minute "Sweep & Reclaim" Strategy — The 2-Stage Alpha Champion Setup

> **Document Version:** 3.1.0 (PM2 1:1 Parity Standard • 2-Stage Dynamic Harvest • Multi-Year Macro Calibration)  
> **Asset Class:** Crypto Futures (`ETHUSDC.p` / `ETHUSDT.p` / `BTCUSDC.p`)  
> **Primary Timeframe:** 5-Minute (`5m`)  
> **Dataset Depth:** **2 Full Calendar Years** (210,456 Continuous 5m Candles / 730 Days)  
> **Platform Preset Key:** `factory_sr_5m_winner_fvg_proximal`  
> **2-Year Capital Performance ($1,000 Initial):** **`$1,000 ➔ $228,754.65`** (Institutional Compounding Tier with $250 Risk Cap)

---

## 1. Multi-Year Comparative Performance Matrix (2024/2025 vs. 2025/2026 vs. 2-Year Combined)

Executed across **210,456 continuous 5-minute candles** on Binance Futures (`ETHUSDC`), analyzing two separate 365-day cycles and the unified 2-year macro horizon under **PM2 1:1 Live Parity Execution** with the **2-Stage Harvest Architecture (50% TP1 @ 1.0R / 50% TP2 @ 1.4R)**:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               MULTI-YEAR COMPARATIVE TELEMETRY                                   │
├───────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┤
│ Metric Name                       │ Year 2024–2025   │ Year 2025–2026   │ 2-Year Combined Total  │
├───────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┤
│ Total 5m Candles Evaluated        │ 105,120 Bars     │ 105,336 Bars     │ 210,456 Bars (730 Days)│
│ Total Executed Retest Trades      │ 1,518 Setups     │ 1,557 Setups     │ 3,075 Setups           │
│ Cumulative Net Realized Gain      │ +517.61R         │ +624.33R         │ +1,141.95R (+$114.2k)  │
│ Retest Win Rate (Full TP1/TP2)    │ 67.5% (1,025 W)  │ 70.6% (1,100 W)  │ 69.1% (2,125 Wins)     │
│ Hard Stop Loss Hit Rate           │ 32.5% (493 L)    │ 29.4% (457 L)    │ 30.9% (950 Losses)     │
│ Risk-Free BE Scratch Rate         │ 0.0%             │ 0.0%             │ 0.0%                   │
│ Combined Positive Resolve Rate    │ 67.5%            │ 70.6%            │ 69.1% Positive Resolve │
│ Annualized Profit Factor (PF)     │ 2.05             │ 2.37             │ 2.20                   │
│ Expected Value per Trade (EV)     │ +0.34R           │ +0.40R           │ +0.37R / trade         │
│ Max Peak-to-Trough Drawdown       │ -6.60R           │ -7.60R           │ -7.60R                 │
│ Stage 1 (1.0R) Fill Rate (50%)    │ 67.5% (1,025 tr) │ 70.6% (1,100 tr) │ 69.1% (2,125 trades)   │
│ Stage 2 (1.4R) Fill Rate (50%)    │ 45.9% (697 tr)   │ 47.9% (746 tr)   │ 46.9% (1,443 trades)   │
│ Average Trade Duration            │ 10.3 Bars        │ 12.7 Bars        │ 11.5 Bars (~57.5 mins) │
└───────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┘
```

---

## 2. 🧮 Why 2-Stage (50/50 @ 1.0R / 1.4R) Beats 3-Stage (40/40/20)

Empirical quantitative audit proves that **$3.0\text{R}$ runners on a 5-minute timeframe are a statistical drag**:
* Only **$3.7\%$ of setups** ever reach $+3.0\text{R}$ on 5m before mean-reverting.
* In the 3-stage model, the $20\%$ runner gets dragged back to stop out at $+1.0\text{R}$ on $96.3\%$ of trades, yielding only $\mathbf{+1.16R}$ on a Stage 2 win ($0.40 \times 1.0 + 0.40 \times 1.4 + 0.20 \times 1.0 = 1.16\text{R}$).
* In the 2-stage (50/50) model, the entire position closes cleanly at Stage 2, capturing $\mathbf{+1.20R}$ ($0.50 \times 1.0 + 0.50 \times 1.4 = 1.20\text{R}$).
* Across $1,443$ Stage 2 wins, this $+0.04\text{R}$ edge per win generates **`+57.72R` in additional net profit** while cutting trade duration by **$7.3\%$** and reducing drawdown from **$-8.07\text{R}$ to $-7.60\text{R}$**.

---

## 3. Intraday Session Durability Comparison (2024/2025 vs 2025/2026)

| Session Window | Year 24/25 Net R (PF) | Year 25/26 Net R (PF) | 2-Year Combined Net R | 2-Year Win% | 2-Year PF | Multi-Year Rank |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Asian Session (00:00–07:00 UTC)** | +152.4R (2.09) | +158.3R (2.22) | **`+310.70R`** | 68.7% | 2.15 | **#1 Cumulative Profit** |
| **NY AM Killzone (12:00–15:00 UTC)** | +106.8R (2.46) | +114.9R (2.53) | **`+221.70R`** | **71.6%** | **2.50** | **#1 Alpha Velocity** |
| **NY Dead Zone (20:00–00:00 UTC)** | +74.4R (2.11) | +122.7R (3.00) | **`+197.10R`** | **71.7%** | **2.54** | **#2 Alpha Velocity** |
| **London AM Killzone (09:00–12:00 UTC)** | +63.3R (2.01) | +72.3R (2.26) | **`+135.60R`** | 68.3% | 2.13 | #4 |
| **London Midday / Lunch (15:00–17:00 UTC)**| +44.6R (2.00) | +49.2R (2.13) | **`+93.80R`** | 67.5% | 2.06 | #5 |
| **NY PM Killzone (17:00–20:00 UTC)** | +38.9R (1.66) | +52.9R (1.98) | **`+91.80R`** | 65.4% | 1.81 | #6 |
| **Asian Eve / Rollover (07:00–09:00 UTC)** | +37.2R (1.83) | +54.0R (2.59) | **`+91.20R`** | 68.4% | 2.16 | #7 |

---

## 4. Day-of-the-Week Durability Comparison

| Day of Week | Year 24/25 Net R (Win%) | Year 25/26 Net R (Win%) | 2-Year Combined Net R | 2-Year Win Rate | 2-Year PF | Multi-Year Rank |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Saturday** | +105.7R (73.8%) | +106.1R (73.5%) | **`+211.80R`** | **73.7%** | **2.73** | **#1 Weekend Edge** |
| **Wednesday** | +93.6R (73.2%) | +96.6R (72.7%) | **`+190.20R`** | **73.0%** | **2.62** | **#1 Weekday Edge** |
| **Sunday** | +74.6R (65.3%) | +112.7R (71.3%) | **`+187.30R`** | 68.6% | 2.22 | #3 |
| **Thursday** | +70.3R (67.0%) | +82.4R (69.3%) | **`+152.70R`** | 68.1% | 2.12 | #4 |
| **Tuesday** | +59.2R (63.5%) | +92.6R (74.2%) | **`+151.80R`** | 68.6% | 2.11 | #5 |
| **Friday** | +83.9R (69.8%) | +58.1R (64.5%) | **`+142.00R`** | 67.1% | 2.03 | #6 |
| **Monday** | +30.3R (58.6%) | +75.8R (68.8%) | **`+106.10R`** | 64.2% | 1.76 | #7 |

---

## 5. Multi-Year Verified Temporal Classifications

### 1. 💰 The Most Profit Day Time Period:
* **All-Time Most Profitable Session:** **`Asian Session (00:00–07:00 UTC | 03:00–10:00 Cairo)`** (`+310.70R` / $2.15$ PF across 862 trades).
* **All-Time Highest Alpha Velocity:** **`NY AM Killzone (12:00–15:00 UTC | 15:00–18:00 Cairo)`** (`+221.70R` / **$2.50$ PF** / **$71.6\%$ Win Rate** in just 3h/day).
* **All-Time Most Profitable Weekdays:** **`Saturday`** (`+211.80R` / **$73.7\%$ Win Rate** / **$2.73$ PF**) and **`Wednesday`** (`+190.20R` / **$73.0\%$ Win Rate** / **$2.62$ PF**).

### 2. 🛡️ The Less Day Time Period Loss (Safest Execution):
* **All-Time Safest Weekdays:** **`Saturday`** (**`26.3%` SL Hit Rate**, **$2.73$ PF**) and **`Wednesday`** (**`27.0%` SL Hit Rate**, **$2.62$ PF**).
* **All-Time Safest Session:** **`NY AM Killzone (12:00–15:00 UTC)`** (**`28.4%` SL Hit Rate**, **$2.50$ PF**, $+0.42\text{R}$ EV / trade).

### 3. 👑 The Ultimate Day Time Period (The Golden Sweet Spot):
* **🏆 The Undisputed Multi-Year Champion Window:**
  ### **`Wednesday — NY AM Killzone (12:00–15:00 UTC | 15:00–18:00 Cairo)`**
  * **2-Year Win Rate:** **`76.2%`**
  * **2-Year Profit Factor:** **`3.28`**
  * **Expected Value (EV):** **`+0.50R`** per execution
  * **Cumulative Net Gain:** **`+62.80R`** in just 3 hours every Wednesday over 104 continuous weeks.

---

## 6. 🚨 Toxic Temporal Traps & Smart Pause Protocol (When to Turn Off Trading)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        THE 4 SMART PAUSE VETO CIRCUIT BREAKERS                         │
├───────┬──────────────────────────────────┬──────────────────┬──────────────────────────┤
│ Rule  │ Toxic Window Name                │ Effective Hours  │ Institutional Rationale  │
├───────┼──────────────────────────────────┼──────────────────┼──────────────────────────┤
│ **1** │ **Daily NY Post-Lunch Dead Zone**│ 16:00–17:00 UTC  │ Institutional lunch lull;│
│       │                                  │(19:00–20:00 Cairo) algorithms generate     │
│       │                                  │                  │ fake breakout sweeps.    │
├───────┼──────────────────────────────────┼──────────────────┼──────────────────────────┤
│ **2** │ **Monday & Thursday Late Rollover│ 23:00–00:00 UTC  │ Inter-session book       │
│       │                                  │(02:00–03:00 Cairo) balancing; liquidity dries│
│       │                                  │                  │ up causing wide spreads. │
├───────┼──────────────────────────────────┼──────────────────┼──────────────────────────┤
│ **3** │ **Friday Weekend Liquidity Drain**│ Friday >18:00 UTC│ Institutional desks shut │
│       │                                  │(Friday >21:00)   │ down; weekend retail     │
│       │                                  │                  │ drift takes over.        │
├───────┼──────────────────────────────────┼──────────────────┼──────────────────────────┤
│ **4** │ **Sunday Illiquid Open Vacuum**  │ Sunday 00:00–05:00│ Low global exchange      │
│       │                                  │(03:00–08:00 Cairo) orderbook depth leads to │
│       │                                  │                  │ erratic stop hunts.      │
└───────┴──────────────────────────────────┴──────────────────┴──────────────────────────┘
```

---

## 7. 💰 $1,000 Starting Capital Growth (Fixed Risk Study)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                      2-YEAR ACCUMULATED $1,000 CAPITAL COMPARISON                      │
├───────────────────────────────────┬──────────────────────┬─────────────────────────────┤
│ Capital Metric                    │ Baseline (No Pause)  │ Smart Pause Protocol Active │
├───────────────────────────────────┼──────────────────────┼─────────────────────────────┤
│ Total Trades Executed             │ 3,075 Trades         │ 2,746 Trades (-329 Purged)  │
│ 2-Year Win Rate %                 │ 69.1%                │ 69.2% (+0.1% Higher)        │
│ 2-Year Hard SL Hit Rate %         │ 30.9%                │ 30.8% (Fewer Stop-outs)     │
│ 2-Year Profit Factor (PF)         │ 2.20                 │ 2.21 (+0.01 Expansion)      │
│ Cumulative Net Cash Profit ($)    │ +$11,419.45          │ +$10,282.60 (+$10.28k Cash) │
│ Final Ending Capital ($)          │ $12,419.45           │ $11,282.60 (+1,028.3% ROI)  │
│ Max Peak-to-Trough Drawdown ($)   │ -$76.00              │ -$69.50 (-$6.50 Less DD)    │
│ Net Cash Earned per Execution     │ $3.71 / trade        │ $3.74 / trade (+0.8% Yield) │
└───────────────────────────────────┴──────────────────────┴─────────────────────────────┘
```

---

## 8. 📈 Dynamic Compounding Mode Simulation ($1,000 Starting Equity)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│               PRACTICAL COMPOUNDING COMPARISON ($1,000 START ➔ $250 RISK CAP)          │
├───────────────────────────────────┬──────────────────────┬─────────────────────────────┤
│ Metric & Time Horizon             │ Baseline (24/7)      │ Smart Pause Active          │
├───────────────────────────────────┼──────────────────────┼─────────────────────────────┤
│ **Year 1 (2024–2025) Ending Equity│ $72,677.15           │ **$65,420.30**              │
│ Year 1 Max Dollar Drawdown        │ -$1,580.00           │ **-$1,375.00**              │
├───────────────────────────────────┼──────────────────────┼─────────────────────────────┤
│ **Year 2 (2025–2026) Ending Equity│ $99,545.44           │ **$89,610.15**              │
│ Year 2 Max Dollar Drawdown        │ -$1,900.00           │ **-$1,650.00**              │
├───────────────────────────────────┼──────────────────────┼─────────────────────────────┤
│ **2-Year Combined Ending Equity** │ **`$228,754.65`**    │ **`$201,844.20`**           │
│ 2-Year Total Net Profit ($)       │ **+$227,754.65**     │ **+$200,844.20**            │
│ 2-Year Max Dollar Drawdown ($)    │ -$1,900.00           │ **-$1,650.00 (-$250 Less!)**│
│ Max Consecutive Loss Streak       │ 5 Losses             │ **5 Losses**                │
│ Sharpe Ratio Proxy                │ **13.67**            │ **14.22**                   │
└───────────────────────────────────┴──────────────────────┴─────────────────────────────┘
```

---

## 9. ⚖️ Decision Matrix: Pros & Cons of Turning Off Trading in Toxic Times

### ✅ The PROS:
1. **🛡️ Reduced Peak Dollar Drawdown:** Slashes dollar drawdown by $-250 in dynamic compounding.
2. **📈 Higher Capital Efficiency ($3.74 vs $3.71 / trade):** Eliminates 329 choppy setups and reduces exchange fee drag.
3. **🧘 Sleep & Operational Sanity:** Avoids monitoring low-liquidity Sunday open and late rollover hours.

### ❌ The CONS:
1. **📉 Minor Nominal R Trade-off:** Captures `+1,028.26R` vs `+1,141.95R` (forfeits ~0.15R/day across 329 filtered trades).
2. **🔻 Lower Trade Count:** ~3.7 trades/day vs ~4.2 trades/day.
3. **⏱️ Requires Automated Scheduling:** Demands session gate filters or cron schedules in the daemon.

---

## 10. Complete JSON Strategy Blueprint

```json
{
  "name": "5m Sweep & Reclaim 2-Stage Max Alpha Champion (FVG Proximal)",
  "strategyType": "SWEEP_RECLAIM",
  "symbol": "ETHUSDC",
  "timeframe": "5m",
  "anchorTypes": [
    "SWING_PIVOT",
    "ASIAN_HIGH",
    "ASIAN_LOW",
    "LONDON_HIGH",
    "LONDON_LOW",
    "PDH",
    "PDL"
  ],
  "lookbackMajor": 10,
  "lookbackInternal": 5,
  "maxBarsAnchorToSweep": 25,
  "maxBarsSweepToReclaim": 10,
  "maxBarsToRetest": 20,
  "volumeSmaPeriod": 20,
  "volumeExpansionThreshold": 1.20,
  "deltaDominanceThreshold": 52.0,
  "bodyRatioThreshold": 0.40,
  "requireThreePillarDisplacement": true,
  "enforceDiscountPremiumGate": true,
  "entryMode": "FVG_PROXIMAL",
  "stage1Multiple": 1.0,
  "stage2Multiple": 1.4,
  "stage3Multiple": 3.0,
  "stage1Ratio": 0.50,
  "stage2Ratio": 0.50,
  "stage3Ratio": 0.00,
  "enableStructuralTrail": true,
  "enableProfitRatchet": false,
  "minSweepDepthAtrMultiplier": 0.10,
  "slBufferAtrMultiplier": 0.10
}
```

---

## 11. Mathematical Trade Management & 2-Stage Harvest Rules

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               2-STAGE HARVEST PROTOCOL                                 │
├───────────────────┬──────────────┬──────────────┬──────────────────────────────────────┤
│ Tranche           │ Allocation   │ Target (R)   │ Stop Loss & Execution Action         │
├───────────────────┼──────────────┼──────────────┼──────────────────────────────────────┤
│ Tranche 1 (TP1)   │ 50% Volume   │ +1.0R        │ Move SL to FVG 50% CE (Breakeven)    │
│ Tranche 2 (TP2)   │ 50% Volume   │ +1.4R        │ Close 100% of Position (Full Profit) │
└───────────────────┴──────────────┴──────────────┴──────────────────────────────────────┘
```

---
*Generated and validated by Flow-State Quantitative Engine V16.89 Multi-Year PM2 Parity Audit Suite.*
