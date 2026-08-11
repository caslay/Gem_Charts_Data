---
name: eth-quant-sop
description: >-
  Systematic Quantitative Analysis Framework & AI Agent SOP for ETHUSDC.p price action and inter-market correlation (BTC SMT). Includes 7 execution sub-commands: analyze, guided, smt, log, review, audit, and report. Strict prohibition of True Day Open (TDO) or Cairo TDO.
license: MIT
metadata:
  version: 1.0.0
  author: Flow-State Quant Engine Team
---

# 🤖 ETHUSDC.p Quantitative Analysis & AI Agent SOP Skill

This skill operationalizes the **ETHUSDC.p Quantitative Analysis SOP** into a suite of AI Agent commands. It enforces systematic, top-down technical progression, BTC inter-market SMT analysis, 15m execution mapping, and dual daily tracker logging.

---

## 🛑 STRICT SYSTEM OPERATING RULES

1. **PROHIBITION OF TDO / CAIRO TDO:** The AI Agent is **EXPLICITLY PROHIBITED** from calculating, using, or referencing True Day Open (TDO) or Cairo TDO in any narrative or calculation. All market analysis must rely exclusively on session-based liquidity (London/NY) and HTF structural markers (D1/H4 swings, FVGs, ERL/IRL).
2. **ASSET FOCUS:** Primary asset is **ETHUSDC.p** with secondary inter-market correlation on **BTCUSDC.p**.
3. **OBJECTIVE:** Identify high-probability Draw on Liquidity (DOL) targets, SMT divergence anchors, and 15m displacement execution zones.

---

## 🎛️ SUB-COMMAND SUITE (`/eth-quant-sop <sub-command>`)

When invoked, choose or process the appropriate sub-command:

| Command | Purpose | Description |
| :--- | :--- | :--- |
| `/eth-quant-sop analyze` | **Direct Full Analysis** | Executes the complete 6-step top-down analysis and outputs the Section 3 Quantitative Report table immediately. |
| `/eth-quant-sop guided` | **Interactive Walkthrough** | Interactively guides the user through each of the 6 steps one by one, asking for market data input if needed. |
| `/eth-quant-sop smt` | **Inter-Market SMT Checker** | Validates BTC vs ETH structural swing highs/lows at key liquidity levels for bullish or bearish SMT divergence. |
| `/eth-quant-sop log` | **Daily Tracker Logger** | Formats and appends a newly identified setup into both `directives/ETHUSDC_Daily_Tracker.md` and `directives/ETHUSDC_Daily_Tracker.json`. |
| `/eth-quant-sop review` | **Session Close Outcome Review** | Updates the Daily Tracker at NY session close with setup outcomes (`Success`, `Stop Out`, `No Trigger`) and price action commentary. |
| `/eth-quant-sop audit` | **Rule Compliance Audit** | Audits any given analysis narrative or setup for strict rule compliance (verifying ZERO TDO usage, explicit invalidation, valid targets). |
| `/eth-quant-sop report` | **Standardized Matrix Output** | Formats raw market observations, indicator readings, or chart notes into the exact Section 3 report matrix table. |

---

## 📈 STEP-BY-STEP ANALYTICAL WORKFLOW (6-STEP PROGRESSION)

### Step 1: Real-time Data Intake
* Ingest current ETHUSDC.p and BTCUSDC.p price data, order flow metrics, and volume profiles.

### Step 2: HTF Draw on Liquidity (DOL)
* Analyze D1 and H4 timeframes for primary magnet targets:
  * Unfilled Fair Value Gaps (FVG)
  * Previous Daily Highs/Lows (PDH / PDL)
  * External Range Liquidity (ERL) vs Internal Range Liquidity (IRL)

### Step 3: Session Liquidity Profiling
* Identify session key levels:
  * **London Session:** London High (LH) & London Low (LL)
  * **New York Session:** Morning expansion range
* Determine which session liquidity is expected to sweep based on HTF DOL intent.

### Step 4: BTC SMT Correlation
* Check inter-market divergence at key structural support/resistance:
  * **Bullish SMT:** BTC makes Lower Low while ETH forms Higher Low at support.
  * **Bearish SMT:** BTC makes Higher High while ETH forms Lower High at resistance.

### Step 5: 15m Execution Mapping
* Lower timeframe (15m) entry confirmation:
  * Market Structure Shift (MSS) following session sweep or SMT formation.
  * Strong Displacement candle leaving a clean 15m FVG or Order Block (OB).

### Step 6: Invalidation & Targets
* **Invalidation Point:** Define exact structural level that invalidates the setup (e.g. low of sweep candle).
* **Targets:** Define TP1 (1:1 floor or local liquidity) and TP2 (HTF DOL magnet target).

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
  "id": "ETH-20260808-01",
  "date": "2026-08-08",
  "time": "16:14",
  "symbol": "ETHUSDC.p",
  "setupType": "SMT Divergence + 15m MSS",
  "htfDol": "PDH ($3,520.00)",
  "smtStatus": "Bullish SMT vs BTC",
  "entryRange": [3440.0, 3448.5],
  "invalidation": 3425.0,
  "tp1": 3485.0,
  "tp2": 3520.0,
  "outcome": "PENDING",
  "dolReached": false,
  "notes": "London Low swept into 15m BISI FVG"
}
```

---

## 📑 REFERENCES
- Architectural Blueprint & Guide: [references/SKILL_BLUEPRINT.md](references/SKILL_BLUEPRINT.md)
- Full SOP Reference: [resources/sop_reference.md](resources/sop_reference.md)
- Daily Tracker MD: [file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC_Daily_Tracker.md](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC_Daily_Tracker.md)
- Daily Tracker JSON: [file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC_Daily_Tracker.json](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/ETHUSDC_Daily_Tracker.json)
