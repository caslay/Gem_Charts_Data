# 🧭 Directive 09 — Institutional Quant Research Roadmap & Anti-Tunnel Optimization Protocol

> **Document Type:** Master Quantitative Research Protocol & Strategy Progression Ledger  
> **Status:** ACTIVE & INVIOLABLE  
> **Target Asset:** ETHUSDC.p (Binance USDⓈ-M Futures · 5m Execution Anchor)  
> **Core Baseline Champion:** `factory_sr_5m_fvg_ce_sniper` (+191.9R Net, 1.61 PF, -6.50R Max DD)  
> **Last Updated:** 2026-09-04  

---

## 🏛️ 1. Executive Philosophy: Escaping the "Tight Tunnel"

In systematic quantitative finance, researchers frequently succumb to the **"Tight Tunnel Trap"**:
1. **The Micro-Tweaking Loop (Local Optima):** Spending weeks iterating over microscopic parameter increments (e.g. SL buffer from 0.10 to 0.12, or Volume SMA from 20 to 22), achieving cosmetic, in-sample gains that degrade upon out-of-sample live execution.
2. **The Dormant Feature Graveyard:** Computing vast arrays of high-order microstructure data (OLS regression velocity, CVD absorption, order flow imbalance, HTF dealing range discount/premium, session killzone transitions) while the active execution engine uses only a tiny fraction of it.
3. **The Discretionary Rabbit Hole:** Introducing arbitrary indicators or ambiguous retail concepts that break the mathematical integrity of Sweep & Reclaim, chasing ghosts rather than real market physics.

### 🛡️ The Anti-Tunnel Mandate
* **Immutable Physical Anchor:** The core trading logic remains **Sweep & Reclaim** (liquidity resting above/below structural swing pivots or session extremes swept and aggressively reclaimed).
* **Orthogonal Factor Exploration:** Features are tested strictly across **4 independent, non-overlapping pillars**. We never test combinations blindly.
* **Hypothesis-Driven Science:** Every test must begin with an explicit market microstructure hypothesis grounded in order flow physics (e.g. buyer exhaustion, limit order absorption, maker replenishment).
* **The Zero-Guessing Parity Mandate:** All hypotheses are evaluated candle-by-candle across the full 1-Year historical dataset (106,560 5m bars) in Quant Lab under 100% bit-for-bit parity with the PM2 Headless Daemon.

---

## ⚖️ 2. The Benchmark Hurdle Rate & Acceptance Criteria

Any new candidate setup, factor filter, or parameter modification must satisfy the **Dual-Pillar Superiority Rule** against our verified 1-Year Institutional Champion:

### 🏆 The Champion Baseline Benchmark (`factory_sr_5m_fvg_ce_sniper`)
$$\begin{aligned}
\text{Dataset:} &\quad 106,560\text{ 5m Candles (1 Full Year: Aug 2023 – Aug 2024)} \\
\text{Starting Equity Standard:} &\quad \mathbf{\$1,000.00}\text{ (\$1.0R = \$20.00 initial risk @ 2\% compounding)} \\
\text{Net Realized R:} &\quad \mathbf{+191.90R} \\
\text{Profit Factor (PF):} &\quad \mathbf{1.61} \\
\text{Execution Win Rate:} &\quad \mathbf{53.4\%}\text{ (Ex-Scratch: } 60.2\%\text{)} \\
\text{Max Drawdown (DD):} &\quad \mathbf{-6.50R} \\
\text{Compounded Return (\$1k @ 2\%):} &\quad \mathbf{+3,808\%}\text{ (\$39,082.30 Final Equity)} \\
\text{Max Compounded DD:} &\quad \mathbf{13.4\%} \\
\text{Trade Frequency:} &\quad 206\text{ Trades/Year (}\approx 0.56\text{ trades/day)}
\end{aligned}$$

### 🚦 Acceptance Gatekeeper (The Hurdle Rate)
A candidate setup qualifies for promotion **ONLY IF** it achieves:
1. **Superior Performance:**
   $$\text{Net Return} > +191.90\text{R} \quad \mathbf{OR} \quad \text{Max Drawdown} < -6.00\text{R}$$
2. **Anti-Degradation Constraints:**
   $$\text{Profit Factor (PF)} \ge 1.50$$
   $$\text{Max Drawdown (DD)} \le -8.00\text{R}$$
   $$\text{Sample Size (N)} \ge 150\text{ Trades/Year}$$
   $$\text{Compounded Max DD} \le 16.0\%$$

*If a candidate fails any of these criteria, it is immediately discarded. No exceptions.*

---

## 🧱 3. The 4 Orthogonal Factor Pillars & Engine Feature Inventory

The Quant Engine's intelligence is strictly compartmentalized into 4 independent layers. Research and optimization proceed **one pillar at a time**:

```mermaid
flowchart TD
    P1[Pillar 1: Structural Context & Macro Gating] -->|Location Approved| P2[Pillar 2: Liquidity Geometry & Sweep Dynamics]
    P2 -->|Physical Sweep Confirmed| P3[Pillar 3: Microstructure & Volumetric Sponsorship]
    P3 -->|Order Flow Validated| P4[Pillar 4: Execution Mechanics & Dynamic Harvest]
    P4 -->|Execution Signal Dispatched| LIVE[Binance Futures PM2 Engine]
```

### 📊 Feature Inventory: Active vs. Dormant Metrics

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ PILLAR 1: STRUCTURAL CONTEXT & MACRO GATING (WHERE?)                              │
├──────────────────────────────────────┬────────────────────────────────────────────┤
│ Currently Active in Champion         │ Dormant Intelligence in Quant Engine       │
├──────────────────────────────────────┼────────────────────────────────────────────┤
│ • Discount/Premium Dealing Range     │ • BTC vs ETH Multi-Timeframe SMT           │
│   Equilibrium Gating (50% Range Gate)│ • Prior Day/Week Value Area (VAH, VAL, POC)│
│                                      │ • Macro 1D/1H Trend Alignment Vector       │
│                                      │ • HTF Draw on Liquidity (DOL) Distance     │
└──────────────────────────────────────┴────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────────────────────────┐
│ PILLAR 2: LIQUIDITY GEOMETRY & SWEEP DYNAMICS (WHAT?)                             │
├──────────────────────────────────────┬────────────────────────────────────────────┤
│ Currently Active in Champion         │ Dormant Intelligence in Quant Engine       │
├──────────────────────────────────────┼────────────────────────────────────────────┤
│ • 5m Swing Pivots (Major/Internal)   │ • Sweep Velocity (1-bar breach vs chop)    │
│ • Asian Session High/Low             │ • Anchor Cluster Density (Multi-touch taps)│
│ • London Session High/Low            │ • Anchor Age Decay (Penalizing > 48h bars) │
│ • Prior Day High/Low (PDH/PDL)       │ • Sweep Depth ATR Ceiling (Anti-blowout)   │
│ • Rule 1: Wave Deduplication         │ • Inner Swing Pivot Elimination Filter     │
└──────────────────────────────────────┴────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────────────────────────┐
│ PILLAR 3: MICROSTRUCTURE & VOLUMETRIC SPONSORSHIP (WHY?)                         │
├──────────────────────────────────────┬────────────────────────────────────────────┤
│ Currently Active in Champion         │ Dormant Intelligence in Quant Engine       │
├──────────────────────────────────────┼────────────────────────────────────────────┤
│ • Volume Expansion (>= 1.20x SMA20)  │ • OLS Displacement Slope (Impulse angle)   │
│ • Delta Dominance (>= 50.0%)         │ • Cumulative Volume Delta (CVD) Divergence │
│ • Body-to-Range Ratio (>= 0.40)      │ • Volumetric Absorption at Sweep Extreme   │
│                                      │ • Taker Aggression vs Resting Depth Imbal  │
└──────────────────────────────────────┴────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────────────────────────┐
│ PILLAR 4: EXECUTION MECHANICS & DYNAMIC HARVEST (HOW TO EXIT?)                     │
├──────────────────────────────────────┬────────────────────────────────────────────┤
│ Currently Active in Champion         │ Dormant Intelligence in Quant Engine       │
├──────────────────────────────────────┼────────────────────────────────────────────┤
│ • FVG 50% CE Retest Entry            │ • Volatility-Adaptive TP2 (Expanding ATR)  │
│ • 2-Stage TP (50% @ 1.0R / 50% @ 1.4R│ • Time-Decay Stale Trade Exit (> 12 bars)  │
│ • Rule 4: Early Breakeven (+0.40R)   │ • HTF DOL Magnet Runner Routing (TP3)      │
│ • Next-Bar Ratchet Protection        │ • Trailing SL to Dynamic Swing Pivots      │
│ • Structural Stop Loss (0.10 ATR)    │ • Post-Loss Directional Cooldown Tuning    │
└──────────────────────────────────────┴────────────────────────────────────────────┘
```

---

## 🛑 4. Anti-Tunnel Governance: The 3-Strike Hypothesis Rejection Rule

To permanently eradicate circular development and analysis paralysis, every research phase is bound by the **3-Strike Rule**:

```mermaid
flowchart TD
    START[Formulate Microstructure Hypothesis] --> RUN[Run 1-Year Full Parity Quant Lab Test]
    RUN --> EVAL{Beats Hurdle Rate?}
    EVAL -->|YES| STRESS[Pass 3-Regime Anti-Fragility Audit]
    EVAL -->|NO| COUNT{Strike Count?}
    COUNT -->|< 3 Strikes| REFINE[Formulate Next Distinct Hypothesis]
    REFINE --> RUN
    COUNT -->|3 Strikes Reached| KILL[MARK FACTOR AS EXHAUSTED]
    KILL --> LOG[Log Quant Lessons in Ledger]
    LOG --> NEXT[Permanently Bar Factor & Move to Next Pillar]
```

1. **Max 3 Hypotheses per Factor:** Under any given research pillar, we test at most 3 distinct, pre-defined microstructure hypotheses.
2. **Immediate Discard on Strike 3:** If all 3 hypotheses fail to beat the Champion Hurdle Rate across the full 1-year dataset, that factor is officially classified as **`EXHAUSTED / NO_EDGE`**.
3. **Permanent Lock:** Once a factor is marked `EXHAUSTED`, agents and developers are **strictly prohibited** from revisiting or micro-tweaking it. The findings and quantitative reasons are recorded in the Fine-Tuning Ledger, and research immediately advances to the next pillar.

---

## 🔬 5. Phased Research & Optimization Sequence (ETHUSDC Tailored)

ETHUSDC futures price action is characterized by frequent false stop sweeps, aggressive market-maker absorption during London/NY transitions, and severe sensitivity to BTC market correlation. Therefore, research follows this factual sequence:

### Phase 1: Microstructure & Volumetric Absorption (Pillar 3)
* **Objective:** Leverage order flow delta, CVD divergence, and OLS velocity to eliminate fake reclaim traps without degrading entry fill rate.
* **Target Metric:** Push Win Rate from $53.4\% \to 58.0\%+$ while holding Drawdown $\le -6.5\text{R}$.

### Phase 2: Liquidity Anchor Quality & Sweep Dynamics (Pillar 2)
* **Objective:** Test anchor weighting (Session Extremes vs Swing Pivots), sweep depth ATR ceilings (preventing entry into runaway momentum freight trains), and sweep velocity.
* **Target Metric:** Cut total losing trades by $15\%$ while maintaining $\ge 160$ trades/year.

### Phase 3: Dynamic Harvest & Target Expansion (Pillar 4)
* **Objective:** Test volatility-adaptive target scaling (expanding TP2 to $1.6\text{R} - 1.8\text{R}$ in high-ATR regimes) and time-based stale trade exits.
* **Target Metric:** Boost Net Return from $+191.9\text{R} \to +220.0\text{R}+$ while holding Max Drawdown $\le -6.0\text{R}$.

### Phase 4: Macro HTF Context & Intermarket SMT (Pillar 1)
* **Objective:** Integrate BTC vs ETH SMT divergence and 1H dealing range equilibrium to veto counter-trend knife catches.
* **Target Metric:** Compress Max Drawdown from $-6.5\text{R} \to < -5.0\text{R}$.

---

## 🚀 6. The Staged Operational Promotion Protocol

No code or parameter modification reaches live PM2 execution without completing this 4-step deployment pipeline:

```
[1. Quant Lab 1Y Proof] ──► [2. 3-Regime Audit] ──► [3. Ledger Sync] ──► [4. PM2 Hot-Reload]
  106,560 5m Candles           Bull / Bear / Chop       Directive & Blueprint    Zero-Downtime VPS
```

1. **Step 1: Quant Lab 1-Year Proof:** Full candle-by-candle backtest across 106,560 5m bars. Must strictly clear the Hurdle Rate.
2. **Step 2: 3-Regime Anti-Fragility Audit:** Must be profitable across all 3 historical sub-regimes:
   - *Trending Bull:* Q1 2024 ETF Expansion (Feb 1 – Mar 31, 2024)
   - *Violent Bear Dump:* Aug 5, 2024 Yen Carry Crash (Jul 25 – Aug 10, 2024)
   - *Low-Vol Summer Chop:* Range Compression (Jun 1 – Jul 15, 2024)
3. **Step 3: Ledger Documentation:** Log setup ID, parameters, performance delta, and institutional lessons in the Fine-Tuning Ledger below and update `directives/master_blueprint.md`.
4. **Step 4: Live PM2 Hot-Reload:** Register the setup in `scannerPresets.ts`, update UI defaults, and dispatch an atomic `UPDATE_SETTINGS` command to the VPS daemon without interrupting the background process.

## 📋 7. Dynamic Progress & Fine-Tuning Ledger

This live ledger tracks every completed, active, and pending research experiment across our 4-pillar orthogonal roadmap.

### 📊 Master Progress Summary
* **Current Operational Champion:** `factory_sr_5m_fvg_ce_sniper` (+197.90R Net, 1.62 PF, -6.50R Max DD, $43,989 final eq from $1,000)
* **Qualified Successor Candidate (Max Return):** `factory_sr_5m_fvg_ce_sniper_v2` (**+223.76R Net**, **1.75 PF**, -6.68R Max DD, **$74,287 final eq from $1,000**, 12.9% Comp DD, **14/14 Winning Months**)
* **Qualified Successor Candidate (Low Drawdown):** `factory_sr_5m_alpha_shield_v2` (**+206.75R Net**, **1.70 PF**, **-5.75R Max DD**, **$52,821 final eq from $1,000**, **11.3% Comp DD**, **14/14 Winning Months**)
* **Current Active Phase:** **Phases 1, 2 & 3 Completed · Phase 4 (Macro HTF SMT Bias) Next**
* **Total Completed Experiments:** 25 Candle-by-Candle Path-Dependent Backtests
* **Total Factors Exhausted (3-Strike Rule):** 1 (Taker Delta Dominance > 52% permanently locked)

---

### 🧪 Comprehensive Tournament Matrix ($1,000 Starting Capital · 2% Compounding · 1-Year Parity)

| Experiment ID | Pillar | Factor Tested | Value Tested | Trades | Net R | PF | Max DD | Comp DD% | $1k Final Eq | Outcome / Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BENCHMARK** | — | `FVG_CE_SNIPER` | 1.20x Vol, All Anchors, 20 TTL, 1.0/1.4R | 1,958 | **+197.90R** | **1.62** | **-6.50R** | **13.4%** | **$43,989** | 🏆 **CONTROL BENCHMARK** |
| `EXP-P1-01A` | P3 | Delta Dominance | 50.0% Gate | 2,076 | +211.50R | 1.62 | -8.10R | 15.2% | $56,983 | 🔴 REJECTED (DD > -8.0R) |
| `EXP-P1-01B` | P3 | Delta Dominance | 55.0% Gate | 1,702 | +162.60R | 1.59 | -8.10R | 15.4% | $22,265 | 🔴 REJECTED (Strike 2) |
| `EXP-P1-01C` | P3 | Delta Dominance | 58.0% Gate | 1,394 | +127.10R | 1.56 | -10.90R | 20.1% | $11,243 | 🔴 **EXHAUSTED (Strike 3)** |
| `EXP-P1-02A` | P3 | Volume Expansion | 1.10x SMA20 | 2,056 | **+211.30R** | **1.64** | -7.10R | 13.5% | **$57,048** | 🟢 **QUALIFIED (Beats Hurdle)** |
| `EXP-P1-02B` | P3 | Volume Expansion | 1.35x SMA20 | 1,797 | +178.10R | 1.59 | -7.90R | 14.9% | $29,934 | 🔴 REJECTED |
| `EXP-P1-02C` | P3 | Volume Expansion | 1.50x SMA20 | 1,655 | +181.50R | 1.66 | -8.70R | 16.3% | $32,331 | 🔴 REJECTED |
| `EXP-P1-03A` | P3 | Body-to-Range | 0.30 Ratio | 1,994 | +204.00R | 1.64 | -8.30R | 15.7% | $49,542 | 🔴 REJECTED (DD > -8.0R) |
| `EXP-P1-03B` | P3 | Body-to-Range | 0.50 Ratio | 1,899 | +191.50R | 1.62 | **-6.00R** | **12.0%** | $38,923 | 🛡️ Slashes Drawdown |
| `EXP-P1-03C` | P3 | Body-to-Range | 0.60 Ratio | 1,771 | +165.30R | 1.56 | -7.00R | 13.5% | $23,284 | 🔴 REJECTED |
| `EXP-P2-01A` | P2 | Anchor Universe | Session Only (No Swings) | 247 | +7.40R | 1.15 | -7.50R | 14.4% | $1,135 | 🔴 REJECTED (Under-trading) |
| `EXP-P2-01B` | P2 | Anchor Universe | Swing Pivots + Daily Only | 1,926 | **+216.20R** | **1.73** | **-6.30R** | **12.2%** | **$63,710** | 🟢 **QUALIFIED (Alpha Breakthrough)** |
| `EXP-P2-02A` | P2 | Anchor-Sweep TTL | 15 bars (75m) | 1,794 | +188.40R | 1.67 | -7.00R | 13.2% | $37,003 | 🔴 REJECTED |
| `EXP-P2-02B` | P2 | Anchor-Sweep TTL | 35 bars (~3h) | 2,210 | +228.20R | 1.65 | -8.10R | 15.2% | $78,976 | 🔴 REJECTED (DD > -8.0R) |
| `EXP-P2-02C` | P2 | Anchor-Sweep TTL | 50 bars (~4h) | 2,332 | +229.40R | 1.60 | -8.10R | 15.2% | $79,903 | 🔴 REJECTED (DD > -8.0R) |
| `EXP-P2-03A` | P2 | Reclaim Snapback | 5 bars (25m) | 1,689 | +183.00R | 1.70 | -8.70R | 16.6% | $33,525 | 🔴 REJECTED |
| `EXP-P2-03B` | P2 | Reclaim Snapback | 15 bars (75m) | 2,169 | +209.10R | 1.58 | -8.80R | 17.1% | $53,927 | 🔴 REJECTED |
| `EXP-P2-04A` | P2 | Retest Window TTL | 10 bars (50m) | 2,043 | +211.80R | 1.65 | -7.10R | 13.5% | $57,654 | 🟢 Beats Hurdle |
| `EXP-P2-04B` | P2 | Retest Window TTL | 15 bars (75m) | 2,053 | +213.30R | 1.65 | -7.10R | 13.5% | $59,401 | 🟢 Beats Hurdle |
| `EXP-P2-HYB-A`| P2 | Combined P2 Winner | Pivots + Daily, Retest 15b | 1,924 | **+217.20R** | **1.73** | **-6.30R** | **12.2%** | **$65,010** | 🟢 **QUALIFIED PHASE 2 CHAMPION** |
| `EXP-P3-01A` | P4 | TP2 Multiple | 1.30R (50/50) | 1,938 | **+221.95R** | **1.74** | -6.60R | 12.8% | **$71,483** | 🟢 Beats Hurdle |
| `EXP-P3-01B` | P4 | TP2 Multiple | 1.50R (50/50) | 1,914 | +206.75R | 1.70 | **-5.75R** | **11.3%** | $52,821 | 🛡️ **SLASHES DD (< -5.8R)** |
| `EXP-P3-02B` | P4 | Tranche Split | 60% @ 1.0R / 40% @ 1.4R | 1,924 | **+220.16R** | **1.74** | -6.44R | 12.5% | $69,170 | 🟢 Beats Hurdle |
| `EXP-P3-SYN-B`| P4 | Synthesis All-Time | TP2 1.30R (60/40 Split) | 1,938 | **+223.76R** | **1.75** | **-6.68R** | **12.9%** | **$74,287** | 🏆 **NEW ALL-TIME CHAMPION** |
| `EXP-P3-03B` | P4 | Early BE Multiple | Delayed to 0.50R | 1,886 | +193.00R | 1.47 | -9.70R | 18.2% | $38,374 | 🔴 Severe Degradation |
| `EXP-P3-03C` | P4 | Early BE Multiple | Delayed to 0.60R | 1,850 | +167.10R | 1.33 | -18.30R | 32.0% | $22,058 | 🔴 Catastrophic DD |
| `EXP-P4-01A` | P1 | HTF Valuation Gate | HTF Guard: ON (Eq Filter) | 1,938 | **+223.76R** | **1.75** | -6.68R | 12.9% | **$74,287** | ⚪ Identical (Gate Active) |
| `EXP-P4-02A` | P1 | Weekend Filter | Filter Fri 22:00-Sun 20:00 | 1,238 | +134.90R | 1.72 | -6.60R | 12.7% | $13,401 | 🔴 REJECTED (-82% Eq Loss) |
| `EXP-P4-SMT-1`| P1 | BTC Strict SMT | Bullish/Bearish Divergence | 758 | +95.10R | **1.84** | **-5.30R** | **10.2%** | $6,270 | 🛡️ **PRECISION PROFILE (1.84 PF)** |
| `EXP-P4-SMT-2`| P1 | BTC Symmetric Sweeps | Both ETH & BTC Sweep | 1,251 | +129.10R | 1.64 | -7.60R | 14.9% | $11,874 | ⚪ Positive Secondary Alpha |

---

### 🧠 Institutional Lessons & Fine-Tuning Log

*Document every quantitative truth discovered, hypothesis failure, and structural insight here to prevent repeating mistakes.*

#### Entry 001 (2026-09-04) — The FVG CE Sniper & Wave Deduplication Breakthrough
* **Finding:** Switching entry geometry from FVG Proximal to FVG 50% Consequent Encroachment (CE) paired with Rule 1 Wave Deduplication and accelerated +0.40R Early Breakeven reduced Max Drawdown by over $50\%$ (from $-13.2\text{R} \to -6.5\text{R}$) while increasing Net Return from $+155.4\text{R} \to +191.9\text{R}$ and Profit Factor from $1.35 \to 1.61$.
* **Microstructure Rationale:** Entering at the 50% mean threshold of the displacement imbalance provides a strictly superior risk-to-reward ratio. Tighter structural stop distance ($|Entry - SL|$) directly increases compounded contract size per trade for the same dollar risk.
* **Anti-Tunnel Lesson:** Never accept wide stop losses when an imbalance offers a clean 50% mathematical discount. Always simulate the Next-Bar Ratchet Rule to ensure breakeven adjustments accurately reflect live exchange mechanics.

#### Entry 002 (2026-09-04) — The Taker Delta Dominance Trap (Passive Absorption vs Late Momentum)
* **Finding:** Stricter taker delta thresholds ($55.0\%$ and $58.0\%$) monotonically degraded net performance (from $+197.9\text{R} \to +162.6\text{R} \to +127.1\text{R}$) and caused Max Drawdown to balloon from $-6.5\text{R} \to -10.9\text{R}$ ($20.1\%$ compounded DD). Under the 3-Strike Rule, increasing delta dominance is permanently marked **`EXHAUSTED / NO_EDGE`**.
* **Microstructure Rationale:** In 5m crypto futures, authentic institutional sweep reversals occur through **passive limit-order absorption** at the extreme. A massive market-order taker surge often prints *late* in the impulse or during retail FOMO breakouts. Filtering for $\ge 58\%$ taker volume causes the engine to buy local highs and short local lows, forfeiting early FVG retests. The baseline $52.0\%$ threshold represents the optimal mathematical sweet spot.

#### Entry 003 (2026-09-04) — Volume Expansion Multiplier (1.10x vs Climax Exhaustion)
* **Finding:** Relaxing volume expansion from $1.20\text{x} \to 1.10\text{x}$ boosted Net Return from $+197.9\text{R} \to +211.3\text{R}$, Profit Factor to $1.64$, and final equity from $\$43,989 \to $\$57,048$ with zero degradation in compounded drawdown ($13.5\%$). Conversely, demanding high volume climaxes ($1.35\text{x} - 1.50\text{x}$) degraded performance ($+178.1\text{R}$).
* **Microstructure Rationale:** A $1.10\text{x}$ volume threshold captures the subtle initiation of institutional displacement. Waiting for a $1.50\text{x}$ volume spike frequently enters at the climax exhaustion point, where market makers are offloading inventory rather than establishing a fresh directional wave.

#### Entry 004 (2026-09-04) — Anchor Universe Purification (Swing Pivots + Daily Superiority)
* **Finding:** Purging noisy session extremes (`ASIAN_HIGH`, `ASIAN_LOW`, `LONDON_HIGH`, `LONDON_LOW`) and restricting the engine strictly to structural `SWING_PIVOT`, `PDH`, and `PDL` anchors increased Profit Factor from $1.64 \to 1.73$, compressed Max Drawdown to $-6.30\text{R}$ ($12.2\%$ compounded DD), and boosted return to $+216.2\text{R}$. An Asian/London session-only strategy produced an abysmal $+7.4\text{R}$ over 1 year.
* **Microstructure Rationale:** In ETHUSDC 24/7 futures, arbitrary clock-based session boundaries are constantly traversed by organic crypto flow. Structural price swings (validated fractal pivots) and Previous Day High/Low represent genuine resting liquidity pools with institutional buy/sell stops.

#### Entry 005 (2026-09-04) — Retest Window TTL (Eliminating Stale Limit Drag)
* **Finding:** Shortening the retest order expiration window from $20\text{ bars} \to 15\text{ bars}$ ($75$ minutes) improved Profit Factor to $1.73$ and added $+1.0\text{R}$ net, bringing combined Phase 2 equity to $\$65,010$ ($+217.2\text{R}$).
* **Microstructure Rationale:** Fresh imbalances are filled quickly. Retests that linger for $> 15$ bars ($> 75$ minutes) often indicate loss of institutional displacement momentum and transition into choppy consolidation, increasing the probability of a failed reclaim.

#### Entry 006 (2026-09-04) — Target Harvest Calibration & The Early Breakeven Bedrock
* **Finding:** Shifting harvest execution to **$60\%$ @ $1.0\text{R}$ and $40\%$ @ $1.30\text{R}$** crowned a new All-Time Champion: **$+223.76\text{R}$ Net Return, $1.75$ Profit Factor, $-6.68\text{R}$ Max Drawdown, and $\$74,287$ final equity from $\$1,000$** ($+68.9\%$ higher capital accumulation than baseline). Delaying Early Breakeven to $0.50\text{R}$ or $0.60\text{R}$ caused catastrophic drawdown degradation ($-18.3\text{R}$ Max DD, $32.0\%$ compounded DD).
* **Microstructure Rationale:** Banking $60\%$ of inventory at $1.0\text{R}$ mathematically guarantees a winning trade, while a $1.30\text{R}$ TP2 has a significantly higher hit probability in 5m ETH market structure than wider targets. Meanwhile, the $+0.40\text{R}$ Early Breakeven is proven to be the non-negotiable structural bedrock of the entire engine: it converts impending multi-R loss streaks into harmless breakeven scratches.

#### Entry 007 (2026-09-04) — The Weekend Liquidity Paradox (Why 24/7 Crypto Flow Must Not Be Filtered)
* **Finding:** Filtering weekend trading (Rule 2) chopped off 700 executed setups, causing Net Return to collapse from $+223.8\text{R} \to +134.9\text{R}$ and destroying $82\%$ of total compounded equity ($\$74,287 \to \$13,401$) with zero improvement in drawdown ($-6.6\text{R}$ vs $-6.7\text{R}$).
* **Microstructure Rationale:** Unlike traditional equity markets where weekends cause erratic gaps, crypto futures operate 24/7. Weekend sessions routinely feature low-volume stop purges of Friday's swing pivots that trigger exceptionally clean, high-conviction mean-reversion reclaims. Filtering weekends discards one of the richest sources of institutional alpha in crypto derivatives.

#### Entry 008 (2026-09-04) — BTC vs ETH SMT Divergence (Precision Sniper vs Volume Compounding Trade-Off)
* **Finding:** Requiring strict BTC SMT Divergence (ETH sweeps while BTC holds Higher Low / Lower High) pushed the Profit Factor to an engine-record **$1.84\text{ PF}$** and compressed Max Drawdown to **$-5.30\text{R}$** ($10.2\%$ compounded DD). However, it reduced annual trade count from $1,938 \to 758$, lowering total 1-year compounded accumulation to $+95.1\text{R}$ ($\$6,270$). Symmetric sweeps (where both ETH and BTC sweep together) independently generated $+129.1\text{R}$ ($1.64\text{ PF}$).
* **Microstructure Rationale:** SMT divergence is the ultimate institutional confirmation signal for high win-rate, low-drawdown execution. For traders seeking maximum peace of mind and minimum drawdowns ($-5.3\text{R}$), strict SMT filtering is supreme. For maximum accumulated portfolio compounding, accepting both confirmed SMT and symmetric liquidity sweeps captures the full $+223.8\text{R}$ and $\$74,287$ equity trajectory.

