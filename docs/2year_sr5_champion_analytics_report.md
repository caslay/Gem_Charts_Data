# 📊 2-Year Quantitative Analytics & Statistical Audit
## 5-Minute Sweep & Reclaim (S&R 5) Ultimate Champion Setup

> **Asset:** `ETHUSDC` (Binance Futures)  
> **Evaluation Horizon:** **2 Full Calendar Years** (August 27, 2024 – August 27, 2026)  
> **Candle Sample:** **210,456 Continuous 5-Minute Candles (730 Days)**  
> **Execution Engine:** **PM2 1:1 Parity Standard** (Directional First-Touch • Strict Post-Close Retests • Single-Position Sequential Walk)  
> **Authoritative Strategy Preset:** `factory_sr_5m_winner_fvg_proximal`  

---

## Executive Summary: 2-Year Performance Telemetry

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 2-YEAR MACRO PERFORMANCE BENCHMARK                               │
├───────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┤
│ Metric Name                       │ Year 1 (2024–25) │ Year 2 (2025–26) │ 2-Year Combined Total  │
├───────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┤
│ Total 5m Candles Analyzed         │ 105,120 Bars     │ 105,336 Bars     │ 210,456 Bars (730 Days)│
│ Total Executed Retest Trades      │ 1,518 Setups     │ 1,557 Setups     │ 3,075 Setups           │
│ Cumulative Net Realized Gain      │ +480.54R         │ +584.50R         │ +1,065.04R (+$106.5k)  │
│ Retest Win Rate (TP1/TP2/TP3)     │ 67.5% (1,025 W)  │ 70.6% (1,100 W)  │ 69.11% (2,125 Wins)    │
│ Hard Stop Loss Hit Rate           │ 32.5% (493 L)    │ 29.4% (457 L)    │ 30.89% (950 Losses)    │
│ Annualized Profit Factor (PF)     │ 1.97             │ 2.28             │ 2.12                   │
│ Expected Value per Trade (EV)     │ +0.317R          │ +0.375R          │ +0.346R / trade        │
│ Average Winning Trade             │ +0.94R           │ +0.97R           │ +0.96R                 │
│ Average Losing Trade              │ -1.00R           │ -1.00R           │ -1.00R                 │
│ Max Peak-to-Trough Drawdown       │ -7.39R           │ -8.07R           │ -8.07R                 │
│ Stage 1 (+1.0R) Fill Rate         │ 67.5%            │ 70.6%            │ 69.11% (2,125 trades)  │
│ Stage 2 (+1.4R) Fill Rate         │ 45.9%            │ 47.9%            │ 46.90% (1,442 trades)  │
│ Stage 3 (+3.0R DOL) Fill Rate     │ 3.6%             │ 3.8%             │ 3.71% (114 trades)     │
└───────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┘
```

---

## 1. 🏆 Best Periods, Best Days, Best Sessions & Best 3 Months

### A. 👑 The Best Intraday Trading Hours (Ranked by Profit Factor & Net R)

Across all 24 hours of the day (evaluated in UTC and Cairo Time `UTC+3`), the top-performing windows are:

| Rank | UTC Hour | Cairo Time | Trades | Win Rate | Hard SL% | Net Realized R | Profit Factor | EV / Trade | Alpha Rating |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **#1** | **14:00 UTC** | **17:00 Cairo** | **178** | **76.4%** | **23.6%** | **`+91.92R`** | **`3.19`** | **`+0.516R`** | 👑 **All-Time Golden Hour** |
| **#2** | **04:00 UTC** | **07:00 Cairo** | **111** | **75.7%** | **24.3%** | **`+57.70R`** | **`3.14`** | **`+0.520R`** | 👑 **Asia Alpha Peak** |
| **#3** | **13:00 UTC** | **16:00 Cairo** | **180** | **68.9%** | **31.1%** | **`+58.13R`** | **`2.04`** | **`+0.323R`** | ⭐ **NY Open Velocity** |
| **#4** | **12:00 UTC** | **15:00 Cairo** | **164** | **69.5%** | **30.5%** | **`+56.67R`** | **`2.13`** | **`+0.346R`** | ⭐ **NY AM Overlap** |
| **#5** | **10:00 UTC** | **13:00 Cairo** | **138** | **69.6%** | **30.4%** | **`+52.85R`** | **`2.26`** | **`+0.383R`** | ⭐ **London Momentum** |
| **#6** | **22:00 UTC** | **01:00 Cairo** | **122** | **73.8%** | **26.2%** | **`+51.82R`** | **`2.62`** | **`+0.425R`** | ⭐ **Late NY Efficiency** |
| **#7** | **15:00 UTC** | **18:00 Cairo** | **145** | **69.0%** | **31.0%** | **`+51.22R`** | **`2.14`** | **`+0.353R`** | ⭐ **NY Midday Flow** |
| **#8** | **08:00 UTC** | **11:00 Cairo** | **137** | **69.3%** | **30.7%** | **`+50.58R`** | **`2.20`** | **`+0.369R`** | ⭐ **London Pre-Open** |

---

### B. 📅 Day-of-the-Week Performance Ranking

| Rank | Day of Week | Trades | Win Rate | Hard SL% | Net Realized R | Profit Factor | Expected Value | Max Drawdown | Institutional Profile |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **#1** | **Saturday** | **463** | **73.7%** | **26.4%** | **`+197.79R`** | **`2.62`** | **`+0.427R`** | **`-4.00R`** | 👑 **#1 Highest Net Profit & Lowest DD** |
| **#2** | **Wednesday** | **433** | **73.0%** | **27.0%** | **`+177.52R`** | **`2.52`** | **`+0.410R`** | **`-5.00R`** | 👑 **#1 Mid-Week Institutional Driver** |
| **#3** | **Sunday** | **490** | **68.6%** | **31.4%** | **`+174.94R`** | **`2.14`** | **`+0.357R`** | **`-5.00R`** | ⭐ **High Trade Count Weekend Flow** |
| **#4** | **Thursday** | **429** | **68.1%** | **31.9%** | **`+142.40R`** | **`2.04`** | **`+0.332R`** | **`-5.44R`** | ⭐ **Solid Mid-Week Expansion** |
| **#5** | **Tuesday** | **439** | **68.6%** | **31.4%** | **`+141.74R`** | **`2.03`** | **`+0.323R`** | **`-6.78R`** | ⭐ **Steady Trend Reversal Day** |
| **#6** | **Friday** | **422** | **67.1%** | **32.9%** | **`+132.44R`** | **`1.95`** | **`+0.314R`** | **`-9.45R`** | ⚠️ **High Intra-Day Volatility Drain** |
| **#7** | **Monday** | **399** | **64.2%** | **35.8%** | **`+98.21R`** | **`1.69`** | **`+0.246R`** | **`-7.80R`** | ⚠️ **Lowest Edge & Highest SL Hit Rate** |

---

### C. 🏛️ Intraday Sessions Breakdown

| Rank | Session Window | UTC Hours | Cairo Time | Trades | Win% | SL% | Net Realized R | PF | EV / Trade | Role in Strategy |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **#1** | **Asian Session** | 00:00–07:00 | 03:00–10:00 | **862** | **68.7%** | 31.3% | **`+289.68R`** | **2.07** | +0.336R | **#1 Cumulative Profit Anchor** |
| **#2** | **NY AM Killzone** | 12:00–15:00 | 15:00–18:00 | **522** | **71.7%** | **28.4%** | **`+206.72R`** | **2.40** | **+0.396R** | **#1 Alpha Velocity (Highest Yield/Hr)** |
| **#3** | **NY Dead Zone** | 20:00–00:00 | 23:00–03:00 | **453** | **71.7%** | **28.3%** | **`+184.06R`** | **2.44** | **+0.406R** | **#2 Alpha Velocity (Late Night Pure Flow)** |
| **#4** | **London AM KZ** | 09:00–12:00 | 12:00–15:00 | **382** | 68.3% | 31.7% | **`+126.48R`** | 2.05 | +0.331R | Steady European Expansion |
| **#5** | **London Midday** | 15:00–17:00 | 18:00–20:00 | **274** | 67.5% | 32.5% | **`+87.49R`** | 1.98 | +0.319R | Transatlantic Overlap |
| **#6** | **NY PM Killzone**| 17:00–20:00 | 20:00–23:00 | **332** | 65.4% | 34.6% | **`+85.56R`** | 1.74 | +0.258R | Late Session Exhaustion |
| **#7** | **Asian Rollover** | 07:00–09:00 | 10:00–12:00 | **250** | 68.4% | 31.6% | **`+85.05R`** | 2.08 | +0.340R | Pre-London Positioning |

---

### D. 📈 Best 3-Month Windows (Rolling & Quarters)

#### Top 5 Rolling 3-Month Windows:
1. **🥇 November 2025 to January 2026:** **`+167.93R Net Gain`** (391 Trades, **73.2% Win Rate**, **2.60 PF**, **+0.429R EV**, Max DD `-4.10R`)
2. **🥈 March 2026 to May 2026:** **`+165.05R Net Gain`** (412 Trades, **71.8% Win Rate**, **2.42 PF**, **+0.401R EV**, Max DD `-5.77R`)
3. **🥉 February 2026 to April 2026:** **`+163.96R Net Gain`** (401 Trades, **71.6% Win Rate**, **2.44 PF**, **+0.409R EV**, Max DD `-6.44R`)
4. **January 2026 to March 2026:** **`+160.51R Net Gain`** (392 Trades, **71.2% Win Rate**, **2.42 PF**, **+0.409R EV**)
5. **October 2025 to December 2025:** **`+146.22R Net Gain`** (363 Trades, **72.7% Win Rate**, **2.48 PF**, **+0.403R EV**)

#### Top Calendar Quarters:
* **Q1 2026 (Jan–Mar 2026):** **`+160.51R`** (392 Trades, **71.2% Win Rate**, **2.42 PF**, Max DD `-6.44R`)
* **Q4 2025 (Oct–Dec 2025):** **`+146.22R`** (363 Trades, **72.7% Win Rate**, **2.48 PF**, Max DD `-4.10R`)
* **Q4 2024 (Oct–Dec 2024):** **`+138.52R`** (392 Trades, **69.9% Win Rate**, **2.17 PF**, Max DD `-6.68R`)
* **Q2 2026 (Apr–Jun 2026):** **`+135.35R`** (408 Trades, **69.4% Win Rate**, **2.08 PF**, Max DD `-5.77R`)

#### Top 3 Individual Months:
1. **July 2026:** **`+69.23R`** (134 Trades, **76.12% Win Rate**, **3.16 PF**, **+0.517R EV**)
2. **March 2026:** **`+64.26R`** (129 Trades, **75.97% Win Rate**, **3.07 PF**, **+0.498R EV**)
3. **November 2025:** **`+64.23R`** (110 Trades, **80.91% Win Rate**, **4.06 PF**, **+0.584R EV**)

---

## 2. 🚨 Worst Periods, Toxic Windows & Drawdown Analysis

### A. ⚠️ The Worst Trading Hours (Toxic Windows)

| Rank | UTC Hour | Cairo Time | Trades | Win Rate | Hard SL% | Net Realized R | Profit Factor | Expected Value | Max DD | Rationale / Danger |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **#1 Worst** | **00:00 UTC** | **03:00 Cairo** | **118** | **56.8%** | **43.2%** | **`+11.61R`** | **`1.23`** | **`+0.098R`** | **`-6.44R`** | 🚨 **Midnight Rollover & Funding Fee Whipsaw** |
| **#2 Worst** | **18:00 UTC** | **21:00 Cairo** | **119** | **58.8%** | **41.2%** | **`+17.82R`** | **`1.36`** | **`+0.150R`** | **`-7.24R`** | 🚨 **NY Late Session Institutional Desk Close** |
| **#3 Worst** | **09:00 UTC** | **12:00 Cairo** | **111** | **64.0%** | **36.0%** | **`+26.21R`** | **`1.66`** | **`+0.236R`** | **`-5.00R`** | ⚠️ **London Open False Proximity Traps** |
| **#4 Worst** | **17:00 UTC** | **20:00 Cairo** | **93** | **68.8%** | **31.2%** | **`+30.20R`** | **`2.04`** | **`+0.325R`** | **`-3.00R`** | ⚠️ **London Close / NY PM Volume Lull** |

---

### B. 📉 The Worst 3-Month Windows & Slowest Months

* **Worst Rolling 3 Months:** **January 2025 to March 2025** (`+95.69R`, 366 Trades, **65.8% Win Rate**, **34.1% SL Hit Rate**, **1.77 PF**).
* **Slowest Single Months:**
  1. **August 2024 (Inception partial):** `+3.80R` (25 trades, 60.0% Win Rate, 40.0% SL Rate)
  2. **February 2025:** `+25.95R` (121 trades, 62.81% Win Rate, 37.19% SL Rate)
  3. **March 2025:** `+27.93R` (122 trades, 63.93% Win Rate, 36.07% SL Rate)
  4. **September 2025:** `+29.17R` (120 trades, 65.00% Win Rate, 35.00% SL Rate)
  5. **August 2026:** `+29.47R` (119 trades, 63.03% Win Rate, 36.97% SL Rate, `-8.07R Max DD`)

> [!NOTE]
> **Zero Negative Months in 2 Full Years:** Even during the absolute slowest and choppiest months (February 2025 and August 2026), the strategy still generated positive returns (`+25.95R` and `+29.47R`), demonstrating incredible institutional resilience and positive mathematical expectancy across all market regimes.

---

## 3. 🔍 Deep Streak Forensics: Wins vs. Losses in a Row

### A. 🥇 All-Time Win Streak Records

The strategy produced **97 distinct win streaks of $\ge 6$ consecutive wins** totaling 754 winning trades.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               TOP 5 ALL-TIME WIN STREAKS                               │
├──────┬──────────────┬─────────────┬──────────────────────────┬─────────────────────────┤
│ Rank │ Streak Size  │ Realized R  │ Date Range (UTC)         │ Primary Catalysts       │
├──────┼──────────────┼─────────────┼──────────────────────────┼─────────────────────────┤
│ #1   │ **17 WINS**  │ **+18.30R** │ Oct 15, 2024 – Oct 19    │ 100% Structural Sweeps  │
│ #2   │ **15 WINS**  │ **+11.38R** │ Oct 30, 2025 – Nov 02    │ Session Anchor Cascade  │
│ #3   │ **14 WINS**  │ **+14.88R** │ Apr 16, 2025 – Apr 19    │ Wed-Sat Trend Flow      │
│ #4   │ **14 WINS**  │ **+14.44R** │ Aug 03, 2026 – Aug 06    │ High Delta Dominance    │
│ #5   │ **13 WINS**  │ **+12.05R** │ Nov 25, 2025 – Nov 28    │ Pre-London FVG Snipes   │
└──────┴──────────────┴─────────────┴──────────────────────────┴─────────────────────────┘
```

#### 🧬 Common Characteristics of Massive Win Streaks:
1. **High Delta & Volume Dominance:** Average Volume Expansion was **`2.34x SMA`**, with Directional Delta Dominance averaging **`60.56%`** and Candle Body Ratio at **`73.39%`**.
2. **Session Concentration:** Over **60.8%** of all streak wins occurred in **Asian Session** (208 trades), **NY AM Killzone** (134 trades), and **NY Dead Zone** (111 trades).
3. **Mid-Week & Weekend Anchoring:** Win streaks clustered heavily on **Wednesday** (128 trades), **Tuesday** (111 trades), and **Saturday** (141 trades).
4. **Session Structural Anchors:** Setups sweeping **Asian High/Low**, **London High/Low**, and **PDH/PDL** had an 82%+ conversion rate into multi-trade win clusters.

---

### B. 🛑 All-Time Loss Streak Records

The maximum consecutive loss streak across 2 full years was **5 consecutive losses** (occurred exactly 5 times across 3,075 trades). There were **59 loss streaks of $\ge 3$ consecutive losses**.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              THE 5 ALL-TIME 5-LOSS STREAKS                             │
├──────┬──────────────┬─────────────┬──────────────────────────┬─────────────────────────┤
│ Rank │ Streak Size  │ Loss in R   │ Date Range (UTC)         │ Root Cause Diagnosis    │
├──────┼──────────────┼─────────────┼──────────────────────────┼─────────────────────────┤
│ #1   │ **5 Losses** │ **-5.00R**  │ Oct 05, 2024 – Oct 06    │ Sunday Low-Depth Drift  │
│ #2   │ **5 Losses** │ **-5.00R**  │ Aug 20, 2025 – Aug 22    │ High-ATR Macro Whipsaw  │
│ #3   │ **5 Losses** │ **-5.00R**  │ Sep 08, 2025 – Sep 09    │ Monday Rebalancing Trap │
│ #4   │ **5 Losses** │ **-5.00R**  │ May 02, 2026 – May 03    │ Saturday Night Choppiness│
│ #5   │ **5 Losses** │ **-5.00R**  │ Aug 12, 2026 (1 Day)     │ News Event Intra-Day Chop│
└──────┴──────────────┴─────────────┴──────────────────────────┴─────────────────────────┘
```

#### 🔬 Root Cause Analysis: Why Did These 5-Loss Streaks Occur?
1. **Sunday & Monday Clustering (34.7% of all Loss Streaks):**
   * In Streak #1 (Oct 5–6, 2024) and Streak #4 (May 2–3, 2026), 4 out of 5 stop-outs occurred on **Sunday** during low-liquidity market drift where market makers sweep both sides of a tight range without genuine institutional follow-through.
2. **Single-Day Overtrading / Intraday Chop Clustering:**
   * In Streak #3 (Sep 8, 2025: 4 losses in 10 hours) and Streak #5 (Aug 12, 2026: 5 losses in 10.5 hours), all setups triggered rapidly on the **same trading day** during major macroeconomic volatility shocks (CPI/FOMC or flash liquidation days). The market was whipsawing in a wide consolidation bracket, invalidating retests before reaching Stage 1.
3. **Minor Pivot Fragility:**
   * **96.5% of all loss streak trades** were anchored to minor 5m Swing Pivots (`SWING_PIVOT`) rather than high-grade session levels (`ASIAN_HIGH/LOW`, `PDH/PDL`). Minor pivots lack structural resting liquidity, making them vulnerable to double-sweeps.
4. **Toxic Hour Collisions:**
   * Stop-outs heavily coincided with **00:00 UTC (Midnight Funding / Early Asia)** and **18:00–19:00 UTC (NY PM Liquidity Drain)**.

---

## 4. 🛠️ Actionable Prescriptions: How to Avoid Loss Streaks & Maximize Win Streaks

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        QUANTITATIVE ACTION PLAN & OPTIMIZATION                         │
├───────────────────────────────────────┬────────────────────────────────────────────────┤
│ 🛡️ HOW TO ELIMINATE LOSS STREAKS      │ 🚀 HOW TO INCREASE & EXTEND WIN STREAKS        │
├───────────────────────────────────────┼────────────────────────────────────────────────┤
│ 1. **Daily 2-Loss Circuit Breaker:**  │ 1. **Focus on Golden Sessions:**               │
│    If 2 consecutive losses occur on a │    Prioritize execution during Wednesday NY AM │
│    single calendar day, freeze trades │    (12:00–15:00 UTC) and Saturday Asian        │
│    until the next major session.      │    (00:00–07:00 UTC) (73%+ Win Rate).          │
│    *Result: Eliminates 100% of 4 & 5  │                                                │
│     loss streaks!*                    │                                                │
├───────────────────────────────────────┼────────────────────────────────────────────────┤
│ 2. **Sunday & Toxic Hour Veto Filter:│ 2. **Session Anchor Prioritization:**          │
│    Mute triggers on Sunday 00:00–05:00 │    Give highest priority / size to sweeps of   │
│    UTC and daily 00:00 & 18:00 UTC.   │    `ASIAN_HIGH/LOW`, `LONDON_HIGH/LOW` & `PDH/ │
│    *Result: Saves -18.5R in stops.*   │    PDL` (82%+ win conversion).                 │
├───────────────────────────────────────┼────────────────────────────────────────────────┤
│ 3. **High-ATR News Shock Veto:**      │ 3. **Dynamic Stage 3 Runner Extension:**       │
│    If Stop Loss distance expands >$20 │    When 3-Pillar Displacement exceeds 2.5x Vol │
│    on ETH (indicating extreme news    │    and 65% Delta in NY AM, hold the 20% Stage 3│
│    whipsaw), pause automated entries. │    runner to macro HTF DOL (+4.0R to +5.0R).   │
└───────────────────────────────────────┴────────────────────────────────────────────────┘
```

---
*Report Generated by Flow-State Quant Engine V16.88 Multi-Year Parity Audit Suite.*
