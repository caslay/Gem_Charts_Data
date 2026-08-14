---
name: eth-quant-sop
description: >-
  Institutional Synthesis Quantitative Analysis Framework & AI Agent SOP for ETHUSDC.p price action and inter-market correlation (BTC SMT). Integrates Pure ICT, Auction Market Theory (AMT & Volume Profile), The Wyckoff Method, and Market Microstructure (OI & CVD Delta). Includes 7 execution sub-commands: analyze, guided, smt, log, review, audit, and report. Strict prohibition of True Day Open (TDO) or Cairo TDO, with Two-Stage Trailing Stop Risk Management.
license: MIT
metadata:
  version: 2.0.0
  author: Flow-State Quant Engine Team
---

# 🤖 Institutional Synthesis Framework: ETHUSDC.p Quantitative Analysis SOP Skill

This skill operationalizes the **Institutional Synthesis Framework: ETHUSDC.p Quantitative Analysis SOP** into a suite of AI Agent commands. It systematically synthesizes **Pure ICT Time & Price**, **Auction Market Theory (AMT & Volume Profile)**, **The Wyckoff Method**, and **Market Microstructure (OI & CVD Delta)** with dual daily tracker persistence.

---

## 🛑 STRICT SYSTEM OPERATING RULES

1. **PROHIBITION OF TDO / CAIRO TDO:** The AI Agent is **EXPLICITLY PROHIBITED** from calculating, using, or referencing True Day Open (TDO) or Cairo TDO in any narrative or calculation. All market analysis must rely exclusively on session-based liquidity (London/NY), Value Area profiles (VAH/VAL/POC), and HTF structural markers (D1/H4 swings, FVGs, ERL/IRL).
2. **ASSET FOCUS:** Primary asset is **ETHUSDC.p** with secondary inter-market correlation on **BTCUSDC.p**.
3. **PURE ICT TIME & PRICE ENGINE:**
   * **Kill-Zone Timing Windows:** London (02:00–05:00 EST / 09:00–12:00 Cairo) and NY AM (08:00–11:00 EST / 15:00–18:00 Cairo) with a strict 0–90 min entry window.
   * **Temporal Invalidation:** The NY Lunch/Mid-day pause (12:00–13:30 EST / DEAD_ZONE) is strictly prohibited for trade entries.
   * **PD Arrays:** Target Fair Value Gaps (FVG), Order Blocks (OB), Breakers, and Rejection Blocks.
4. **AUCTION MARKET THEORY (AMT) & VOLUME PROFILING:**
   * **Value Area Extremes:** Long executions are prioritized below Value Area Low (VAL); Short executions are prioritized above Value Area High (VAH).
   * **High Volume Nodes (HVN):** Strictly avoid initiating trades inside HVNs / Fair Value Points.
   * **Volume Vacuums:** Filter entry FVGs to align with Low Volume Nodes (LVN) at Value Area edges for high-velocity repricing.
5. **THE WYCKOFF METHOD INTEGRATION:**
   * **Phase C:** Require Phase C Spring / Shakeout for long setups and Phase C Upthrust After Distribution (UTAD) for short setups.
   * **Phase D:** Require Sign of Strength (SOS) or Weakness (SOW) demonstrated via Displacement candle body closes (MSS) leaving clean imbalances (FVG).
6. **MARKET MICROSTRUCTURE & ORDER FLOW STATE MACHINE ENGINE:**
   * **SMT Gatekeeper:** Mandatory SMT requirement (ETH vs BTC divergence) at structural levels as a strict execution gatekeeper.
   * **Order Flow State Machine Decoding:** Evaluate the active Open Interest trend and state transitions across 5 dimensions:
     1. **Institutional Intent:** `RISING_WITH_PRICE` (Aggressive Buy Sponsorship / Long Deployment), `RISING_AGAINST_PRICE` (Aggressive Short Sponsorship / Short Deployment), `FALLING_WITH_PRICE` (Long Liquidation / Bear Trap Absorption at VAL), `FALLING_AGAINST_PRICE` (Short Covering / Squeeze — do not chase breakouts), `FLAT` (Passive Equilibrium).
     2. **Regime Fatigue & Duration Decay:** Compare active state duration vs average persistence (>3x avg indicates statistical exhaustion into HTF boundaries).
     3. **MSS & Auction Gatekeeping:** Bullish MSS is only validated when backed by `RISING_WITH_PRICE`; MSS during short covering is unconfirmed.
     4. **24h Distribution Asymmetry:** Align macro trade sizing and direction with the 24h dominant sponsorship regime.
     5. **Inter-Market Absorption Climax:** Synthesize ETH `RISING_AGAINST_PRICE` with BTC Bullish SMT to detect smart money absorption traps.
   * **DOL Targeting:** Align primary profit targets with Liquidation Density Clusters and HTF External/Internal Range Liquidity.
7. **HTF ORDER FLOW HIERARCHY & COUNTER-TREND VETO:** Higher Timeframe (1H/H4) Order Flow and Market Structure ALWAYS override 15m micro-structure and SMT signals. If 1H/H4 Order Flow is **BEARISH** (e.g., major support broken into HTF Bearish Supply), the AI Agent is **STRICTLY PROHIBITED** from generating 15m Counter-Trend Bullish Long setups. All 15m Bullish SMT signals inside a 1H Bearish Trend are VETOED as liquidity traps into 1H Supply, and analysis must focus exclusively on primary HTF Short Retests.
8. **DYNAMIC RISK & TWO-STAGE TRAILING STOP PROTOCOL:**
   * **Stage 1 (Pre-TP1 / In-Flight):** Stop Loss remains anchored strictly below the True Protected Displacement Base or Entry Breakeven. Strictly prohibit trailing to Internal Range Liquidity (IRL) / micro-swings inside an active expansion leg.
   * **Stage 2 (Post-TP1 / Runner Phase):** Only after banking 70% at TP1 (External Range Liquidity), trail SL to the confirmed M15 Structural Higher Low (for longs) or Lower High (for shorts).

---

## 🎛️ SUB-COMMAND SUITE (`/eth-quant-sop <sub-command>`)

When invoked, choose or process the appropriate sub-command:

| Command | Purpose | Description |
| :--- | :--- | :--- |
| `/eth-quant-sop analyze` | **Direct Full Synthesis** | Executes the complete 5-step institutional synthesis analysis and outputs the Section 3 Quantitative Report table immediately with two-stage risk parameters. |
| `/eth-quant-sop guided` | **Interactive Walkthrough** | Interactively guides the user through each of the 5 steps (HTF Narrative, Value Profile, Temporal Gate, SMT Confirmation, Micro Execution + Risk Protocol). |
| `/eth-quant-sop smt` | **Inter-Market SMT Checker** | Validates BTC vs ETH structural swing highs/lows at Value Area Extremes (VAH/VAL) or session liquidity levels for institutional divergence. |
| `/eth-quant-sop log` | **Daily Tracker Logger** | Formats and appends a newly identified setup into both `directives/ETHUSDC_Daily_Tracker.md` and `directives/ETHUSDC_Daily_Tracker.json`. |
| `/eth-quant-sop review` | **Session Close Outcome Review** | Updates the Daily Tracker at NY session close with setup outcomes (`Success`, `Stop Out`, `No Trigger`) and price action commentary. |
| `/eth-quant-sop audit` | **Rule Compliance Audit** | Audits any given analysis narrative or setup for strict rule compliance (Zero TDO, Killzone window, AMT VAH/VAL alignment, Wyckoff Phase C/D, OI/CVD backing, SMT Gatekeeper, Two-Stage SL, and HTF Order Flow alignment). |
| `/eth-quant-sop report` | **Standardized Matrix Output** | Formats raw market observations, indicator readings, or chart notes into the exact Section 3 report matrix table. |

---

## 📈 OPTIMIZED 5-STEP QUANTITATIVE WORKFLOW

### Step 1: HTF Narrative & Draw on Liquidity (DOL)
* Analyze Daily (D1) and 4-Hour (H4) timeframes for macro intent:
  * Primary DOL targets: Unfilled HTF Fair Value Gaps (FVG), Previous Daily High/Low (PDH/PDL), Liquidation Density Clusters.
  * Structural dealing range state: External Range Liquidity (ERL) vs Internal Range Liquidity (IRL).
  * HTF Order Flow Trend: Lock macro bias (BULLISH / BEARISH).

### Step 2: Session & Value Profiling (AMT)
* Identify session key levels and Auction Market Theory profile:
  * **London Session:** London High (LH) & London Low (LL).
  * **New York Session:** Initial Morning Expansion Range.
  * **Value Area Extremes:** Value Area High (VAH), Value Area Low (VAL), Point of Control (POC).
  * **Node Profiling:** Mark High Volume Nodes (HVN — avoid) and Low Volume Nodes (LVN — volume vacuums for FVG alignment).

### Step 3: Temporal Execution Gate
* Enforce Kill-Zone entry window:
  * **London Killzone:** 02:00–05:00 EST (09:00–12:00 Cairo) with 0–90 min entry window.
  * **NY AM Killzone:** 08:00–11:00 EST (15:00–18:00 Cairo) with 0–90 min entry window.
  * **Pre-News Volatility Filter:** Stand down 15 min before/after high-impact macro releases.
  * **DEAD_ZONE Filter:** 12:00–13:30 EST entries are strictly invalid.

### Step 4: Liquidity Raid & SMT Confirmation
* Confirm liquidity raid and institutional divergence:
  * **Wyckoff Phase C:** Identify Spring / Shakeout below VAL/Session Low (for longs) or UTAD above VAH/Session High (for shorts).
  * **Inter-Market SMT Gatekeeper:**
    * *Bullish SMT:* BTC makes Lower Low while ETH forms Higher Low at key support/VAL.
    * *Bearish SMT:* BTC makes Higher High while ETH forms Lower High at key resistance/VAH.
  * **HTF Order Flow Veto:** Verify setup aligns with 1H/H4 Order Flow. Counter-trend long setups in a 1H Bearish Trend are VETOED.

### Step 5: Micro Execution & Microstructure Verification
* Lower timeframe (15m) execution confirmation:
  * **Wyckoff Phase D / Displacement:** Require clean Market Structure Shift (MSS) candle body close leaving a high-quality 15m FVG overlapping an LVN.
  * **Microstructure Validation:** Confirm rising Open Interest (OI) and directional Cumulative Volume Delta (CVD) delta skew, proving institutional capital absorption.
  * **Risk Protocol (Two-Stage SL):**
    * *Stage 1 (Pre-TP1):* Anchor SL strictly below the True Protected Displacement Base.
    * *Stage 2 (Post-TP1):* Bank 70% at TP1 (ERL), trail SL to M15 Structural Higher Low.

---

## 📋 STANDARDIZED REPORT MATRIX TEMPLATE

Every complete market analysis must be formatted into this exact matrix table:

```markdown
| Section | Analysis Detail |
| :--- | :--- |
| **Market Context** | Current ETHUSDC.p Price & HTF Trend Bias |
| **HTF DOL** | Identified target on D1/H4 (e.g., PDH or FVG) |
| **Session Profile** | Active Session Liquidity Highs/Lows |
| **SMT Status** | Presence of BTC/ETH Divergence (Yes/No + Description) |
| **Trade Narrative** | Description of the 15m setup and expected move |
| **Risk Parameters** | Invalidation Level and Take Profit (TP) Levels |
```

---

## 💾 DUAL DAILY TRACKER LOGGING PROTOCOL

> ⚠️ **Scope Boundary:** Trade setup logs and outcome reviews are strictly written to these 2 daily tracker files. Do NOT write or append trade logs or outcome reviews to `directives/master_blueprint.md` (which is reserved exclusively for system code and architecture updates).

When `/eth-quant-sop log` or `/eth-quant-sop review` is executed, update **BOTH** files in `directives/`:

### 1. Markdown Tracker (`directives/ETHUSDC_Daily_Tracker.md`)
Append row to setup table:
`| YYYY-MM-DD | HH:MM | Setup Type | HTF DOL Target | SMT Divergence | Invalidation | TP Targets | Pending/Success/Stop Out | Commentary |`

### 2. JSON Tracker (`directives/ETHUSDC_Daily_Tracker.json`)
Append entry object to `"entries"` array and update `"stats"` object counters (`totalSetups`, `success`, `stopOut`, `noTrigger`, `winRate`).

```json
{
  "id": "ETH-20260814-01",
  "date": "2026-08-14",
  "time": "16:14",
  "symbol": "ETHUSDC.p",
  "setupType": "Wyckoff Phase C Spring + SMT + 15m MSS",
  "htfDol": "PDH ($3,520.00)",
  "smtStatus": "Bullish SMT vs BTC at VAL",
  "entryRange": [3440.0, 3448.5],
  "invalidation": 3425.0,
  "tp1": 3485.0,
  "tp2": 3520.0,
  "stage1Sl": 3425.0,
  "stage2Sl": "M15 Structural HL post-TP1",
  "outcome": "PENDING",
  "dolReached": false,
  "notes": "London Low swept below VAL into 15m BISI FVG / LVN with CVD absorption"
}
```

---

## 📑 REFERENCES
- Architectural Blueprint & Guide: [references/SKILL_BLUEPRINT.md](references/SKILL_BLUEPRINT.md)
- Full SOP Reference: [resources/sop_reference.md](resources/sop_reference.md)
- Canonical SOP Directive: [file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC.p%20Quantitative%20Analysis%20Framework%20&%20AI%20Agent%20Skill%20SOP.md](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC.p%20Quantitative%20Analysis%20Framework%20&%20AI%20Agent%20Skill%20SOP.md)
- Daily Tracker MD: [file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC_Daily_Tracker.md](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC_Daily_Tracker.md)
- Daily Tracker JSON: [file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC_Daily_Tracker.json](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC_Daily_Tracker.json)
