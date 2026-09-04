---
name: eth-quant-sop
description: >-
  Institutional Synthesis Quantitative Analysis Framework & AI Agent SOP for ETHUSDC.p price action and inter-market correlation (BTC SMT). Integrates Pure ICT, Auction Market Theory (AMT & Volume Profile), The Wyckoff Method, and Market Microstructure (OI & CVD Delta) with live MCP Tool integration (Quegar-mcp) and dual daily tracker persistence. Includes 7 execution sub-commands: analyze, guided, smt, log, review, audit, and report. Strict prohibition of True Day Open (TDO) or Cairo TDO, with Two-Stage Trailing Stop Risk Management.
license: MIT
metadata:
  version: 2.1.0
  author: Flow-State Quant Engine Team
---

# 🤖 Institutional Synthesis Framework: ETHUSDC.p Quantitative Analysis SOP Skill

This skill operationalizes the **Institutional Synthesis Framework: ETHUSDC.p Quantitative Analysis SOP** into a suite of AI Agent commands powered by the live **`Quegar-mcp` Model Context Protocol (MCP)** toolset. It systematically synthesizes **Pure ICT Time & Price**, **Auction Market Theory (AMT & Volume Profile)**, **The Wyckoff Method**, and **Market Microstructure (OI & CVD Delta)** with automated live context extraction, pre-flight safety invalidation guards, and dual daily tracker persistence.

---

## ⚡ LIVE MCP INTEGRATION PROTOCOL (`Quegar-mcp`)

When executing quantitative workflows, the AI Agent must utilize the available MCP tools to fetch live state and log decisions:

### 1. Auto-Fetch Live Market Context: `get_market_context`
* **Invocation:** Call `get_market_context(symbol: "ETHUSDC", timeframe: "15m")` (or `"5m"` / `"1h"` depending on resolution needs).
* **Extracted Properties for SOP:**
  * `live_price`: Synchronizes live price action and dealing range position.
  * `market_structure`: Trend (`BULLISH` / `BEARISH` / `NEUTRAL`), ZigZag pivots, dealing range discount/premium boundaries, and equilibrium ($50\%$).
  * `liquidity`: PDH, PDL, Asian High/Low, London High/Low, and resting BSL/SSL magnets.
  * `active_fvgs`: 5 nearest unmitigated Fair Value Gaps with exact upper/lower bounds, timeframes, and distance to price.
  * `order_flow`: Active state machine intent (`RISING_WITH_PRICE`, `RISING_AGAINST_PRICE`, `FALLING_WITH_PRICE`, `FALLING_AGAINST_PRICE`, `FLAT`) and duration metrics.
  * `displacement`: Institutional sponsorship status (`ACTIVE` vs `INACTIVE`), taker buy volume ratio, and OI delta.
  * `smt`: Inter-market BTC vs ETH divergence classification, HTF trend alignment, and `counter_trend_vetoed` flag.
  * `trade_memory`: Last 5 journal trades and active persistent agent decisions.

### 2. Auto-Log Validated Setups: `submit_quant_decision`
* **Invocation:** When logging a setup via `/eth-quant-sop log` or finalizing `/eth-quant-sop analyze`, call `submit_quant_decision(args)`.
* **Payload Parameters:**
  * `agent_id`: `"eth-quant-sop-agent"` (or custom caller identifier).
  * `symbol`: `"ETHUSDC"`.
  * `bias_signal`: `"CONFIRMED_BULLISH"` | `"CONFIRMED_BEARISH"` | `"NEUTRAL"` | `"ABORT"` | `"COUNTER_TREND_RETRACEMENT"`.
  * `entry_range_low` / `entry_range_high`: Planned execution zone.
  * `invalidation_level`: Hard stop floor/ceiling.
  * `target_1` / `target_2`: TP1 (ERL) and TP2 (HTF DOL).
  * `narrative`: Summary of ICT, AMT, Wyckoff Phase C/D, and SMT confluences.
* **Pre-Flight Safety Guard:** The tool verifies that the live Binance Perpetual price has not breached `invalidation_level` prior to recording.

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
   * **Order Flow State Machine Decoding:** Evaluate active Open Interest and state transitions:
     1. **Institutional Intent:** `RISING_WITH_PRICE` (Aggressive Buy Sponsorship), `RISING_AGAINST_PRICE` (Aggressive Short Sponsorship), `FALLING_WITH_PRICE` (Long Liquidation / Absorption at VAL), `FALLING_AGAINST_PRICE` (Short Covering — do not chase), `FLAT` (Equilibrium).
     2. **Regime Fatigue & Duration Decay:** Compare active state duration vs average persistence (>3x avg indicates statistical exhaustion into HTF boundaries).
     3. **MSS & Auction Gatekeeping:** Bullish MSS is only validated when backed by `RISING_WITH_PRICE`; MSS during short covering is unconfirmed.
     4. **24h Distribution Asymmetry:** Align macro trade sizing and direction with the 24h dominant sponsorship regime.
     5. **Inter-Market Absorption Climax:** Synthesize ETH `RISING_AGAINST_PRICE` with BTC Bullish SMT to detect smart money absorption traps.
   * **DOL Targeting:** Align primary profit targets with Liquidation Density Clusters and HTF External/Internal Range Liquidity.
7. **HTF ORDER FLOW HIERARCHY & COUNTER-TREND VETO:** Higher Timeframe (1H/H4) Order Flow and Market Structure ALWAYS override 15m micro-structure and SMT signals. If 1H/H4 Order Flow is **BEARISH** (e.g., major support broken into HTF Bearish Supply), the AI Agent is **STRICTLY PROHIBITED** from generating 15m Counter-Trend Bullish Long setups. All 15m Bullish SMT signals inside a 1H Bearish Trend are VETOED (`smt.counter_trend_vetoed: true`), and analysis must focus exclusively on primary HTF Short Retests.
8. **DYNAMIC RISK & TWO-STAGE TRAILING STOP PROTOCOL:**
   * **Stage 1 (Pre-TP1 / In-Flight):** Stop Loss remains anchored strictly below the True Protected Displacement Base or Entry Breakeven. Strictly prohibit trailing to Internal Range Liquidity (IRL) / micro-swings inside an active expansion leg.
   * **Stage 2 (Post-TP1 / Runner Phase):** Only after banking 70% at TP1 (External Range Liquidity), trail SL to the confirmed M15 Structural Higher Low (for longs) or Lower High (for shorts).

---

## 🎛️ SUB-COMMAND SUITE (`/eth-quant-sop <sub-command>`)

When invoked, execute the workflow using the live MCP engine:

| Command | MCP Action | Purpose | Description |
| :--- | :--- | :--- | :--- |
| `/eth-quant-sop analyze` | `get_market_context` + `submit_quant_decision` | **Direct Full Synthesis** | Fetches live market context via MCP, performs complete 5-step synthesis, outputs Section 3 Quantitative Report table, and persists decision to Neon DB + local trackers. |
| `/eth-quant-sop guided` | `get_market_context` | **Interactive Walkthrough** | Pulls live MCP context and interactively guides the user step-by-step through HTF Narrative, Value Profile, Temporal Gate, SMT, and Micro Execution. |
| `/eth-quant-sop smt` | `get_market_context` | **Inter-Market SMT Checker** | Pulls live BTC & ETH swing extremes from MCP context and validates institutional divergence and HTF veto status at key structural levels. |
| `/eth-quant-sop log` | `submit_quant_decision` | **Daily Tracker Logger** | Submits setup to database via MCP with pre-flight invalidation check and appends to `directives/ETHUSDC_Daily_Tracker.md` and `.json`. |
| `/eth-quant-sop review` | None (Local DB / File) | **Session Close Outcome Review** | Updates the Daily Tracker at session close with setup outcomes (`Success`, `Stop Out`, `No Trigger`) and price action commentary. |
| `/eth-quant-sop audit` | None | **Rule Compliance Audit** | Audits any given analysis narrative or setup for strict compliance with the 8 core rules (Zero TDO, Killzones, VAH/VAL, SMT, Two-Stage SL, HTF veto). |
| `/eth-quant-sop report` | None | **Standardized Matrix Output** | Formats raw market observations into the standardized Section 3 report matrix table. |

---

## 📈 OPTIMIZED 5-STEP QUANTITATIVE WORKFLOW

### Step 1: HTF Narrative & Draw on Liquidity (DOL)
* Utilize MCP `get_market_context` payload:
  * Primary DOL targets: Nearest BSL/SSL magnets (`liquidity.bsl_magnets`, `liquidity.ssl_magnets`), PDH/PDL (`liquidity.pdh`, `liquidity.pdl`), and HTF FVGs.
  * Dealing range equilibrium: Check `market_structure.dealing_range.equilibrium` ($50\%$) to identify Discount vs Premium pricing.
  * Macro Trend & Daily Bias: Check `macro_daily_bias` and `market_structure.trend`.

### Step 2: Session & Value Profiling (AMT)
* Evaluate session liquidity from MCP context:
  * **London Session:** `liquidity.session_levels.london_high` & `london_low`.
  * **Asian Session:** `liquidity.session_levels.asian_high` & `asian_low`.
  * **Value Area Extremes:** Longs prioritized below VAL; Shorts prioritized above VAH.
  * **Node Profiling:** Avoid HVN equilibrium; align entry FVGs with LVN volume vacuums.

### Step 3: Temporal Execution Gate
* Enforce Kill-Zone entry windows:
  * **London Killzone:** 02:00–05:00 EST (09:00–12:00 Cairo) with 0–90 min entry window.
  * **NY AM Killzone:** 08:00–11:00 EST (15:00–18:00 Cairo) with 0–90 min entry window.
  * **Pre-News Filter:** Stand down 15 min before/after high-impact releases.
  * **DEAD_ZONE Filter:** 12:00–13:30 EST entries are strictly invalid.

### Step 4: Liquidity Raid & SMT Confirmation
* Synthesize Wyckoff Phase C and MCP SMT data:
  * **Wyckoff Phase C:** Identify Spring / Shakeout below Session Low/VAL or UTAD above Session High/VAH.
  * **Inter-Market SMT Status:** Evaluate `smt.divergence`.
    * *Bullish SMT:* BTC makes Lower Low while ETH forms Higher Low at key support/VAL.
    * *Bearish SMT:* BTC makes Higher High while ETH forms Lower High at key resistance/VAH.
  * **HTF Order Flow Veto:** Verify `smt.counter_trend_vetoed` is `false`. If `true`, counter-trend setups are strictly VETOED.

### Step 5: Micro Execution & Microstructure Verification
* Confirm lower timeframe execution parameters:
  * **Wyckoff Phase D / Displacement:** Require clean MSS candle close leaving a high-quality 15m FVG (`active_fvgs`).
  * **Microstructure Verification:** Verify `displacement.institutional_sponsorship: "ACTIVE"` and `order_flow.active_state.state: "RISING_WITH_PRICE"`.
  * **Risk Protocol (Two-Stage SL):**
    * *Stage 1 (Pre-TP1):* Anchor SL strictly below True Protected Displacement Base.
    * *Stage 2 (Post-TP1):* Bank 70% at TP1 (ERL), trail SL to M15 Structural Higher Low.

---

## 📋 STANDARDIZED REPORT MATRIX TEMPLATE

Every complete market analysis must be formatted into this exact matrix table:

```markdown
| Section | Analysis Detail |
| :--- | :--- |
| **Market Context** | Current ETHUSDC.p Price ($[price]) & HTF Trend Bias ([bias]) |
| **HTF DOL** | Identified target on D1/H4 (e.g., PDH $[pdh] or BSL Magnet $[bsl]) |
| **Session Profile** | Active Session Liquidity (London: $[lh] / $[ll], Asian: $[ah] / $[al]) |
| **SMT Status** | Presence of BTC/ETH Divergence ([Yes/No] — [Description]) |
| **Order Flow State** | Active Regime ([state]) & Displacement Sponsorship ([ACTIVE/INACTIVE]) |
| **Trade Narrative** | Description of the 15m setup and expected move |
| **Risk Parameters** | Invalidation Level ($[sl]) and Take Profit Levels (TP1: $[tp1], TP2: $[tp2]) |
```

---

## 💾 DUAL DAILY TRACKER & MCP PERSISTENCE PROTOCOL

> ⚠️ **Scope Boundary:** Trade setup logs and outcome reviews are strictly written to these 2 daily tracker files and the Neon PostgreSQL `agent_decision_log` table via MCP. Do NOT write trade logs to `directives/master_blueprint.md`.

When `/eth-quant-sop log` or `/eth-quant-sop analyze` is executed, persist across **ALL 3 stores**:

### 1. Database Persistence via MCP (`submit_quant_decision`)
Call `submit_quant_decision` with structured parameters. The pre-flight invalidation guard automatically validates that live price has not breached `invalidation_level`.

### 2. Markdown Tracker (`directives/ETHUSDC_Daily_Tracker.md`)
Append row to setup table:
`| YYYY-MM-DD | HH:MM | Setup Type | HTF DOL Target | SMT Divergence | Invalidation | TP Targets | Pending/Success/Stop Out | Commentary |`

### 3. JSON Tracker (`directives/ETHUSDC_Daily_Tracker.json`)
Append entry object to `"entries"` array and update `"stats"` object counters (`totalSetups`, `success`, `stopOut`, `noTrigger`, `winRate`).

```json
{
  "id": "ETH-20260815-01",
  "date": "2026-08-15",
  "time": "19:45",
  "symbol": "ETHUSDC.p",
  "setupType": "Wyckoff Phase C Spring + SMT + 15m MSS",
  "htfDol": "PDH ($1,892.00)",
  "smtStatus": "Bullish SMT vs BTC at VAL",
  "entryRange": [1878.0, 1882.5],
  "invalidation": 1861.0,
  "tp1": 1892.0,
  "tp2": 1920.0,
  "stage1Sl": 1861.0,
  "stage2Sl": "M15 Structural HL post-TP1",
  "outcome": "PENDING",
  "dolReached": false,
  "notes": "London Low swept below VAL into 15m BISI FVG with RISING_WITH_PRICE sponsorship"
}
```

---

## 📑 REFERENCES
- Architectural Blueprint & Guide: [references/SKILL_BLUEPRINT.md](references/SKILL_BLUEPRINT.md)
- Full SOP Reference: [resources/sop_reference.md](resources/sop_reference.md)
- M2M & Remote MCP Integration Manual: [file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/docs/M2M_AGENT_MCP_MANUAL.md](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/docs/M2M_AGENT_MCP_MANUAL.md)
- Core MCP Directive: [file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/07_m2m_agent_mcp_guide.md](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/07_m2m_agent_mcp_guide.md)
- Daily Tracker MD: [file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC_Daily_Tracker.md](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC_Daily_Tracker.md)
- Daily Tracker JSON: [file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC_Daily_Tracker.json](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC_Daily_Tracker.json)
