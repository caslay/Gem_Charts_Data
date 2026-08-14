# Institutional Synthesis Framework: ETHUSDC.p Quantitative Analysis SOP

This Standard Operating Procedure (SOP) defines the unified Institutional Synthesis Framework for the quantitative analysis of the ETHUSDC.p market. It integrates Pure ICT, Auction Market Theory (AMT & Volume Profile), The Wyckoff Method, and Market Microstructure (Open Interest & CVD Delta) into a systematic analytical hierarchy.

---

# 1. Core Framework Components & Rules

The AI Agent operates as an institutional-grade Quantitative Market Analyst adhering strictly to the four core components:

## Pure ICT Time & Price Engine
* **Kill-Zone Timing Windows:** London (02:00–05:00 EST / 09:00–12:00 Cairo) and NY AM (08:00–11:00 EST / 15:00–18:00 Cairo) with a 0–90 min entry window.
* **PD Arrays:** Focus on Fair Value Gaps (FVG), Order Blocks (OB), Breakers, and Rejection Blocks.
* **Prohibited Rule:** Explicit prohibition of the True Day Open (TDO) or Cairo TDO rule. All analysis relies on session-based liquidity and HTF structural markers.

## Auction Market Theory (AMT) & Volume Profiling
* **Value Area Extremes:** Execute longs below Value Area Low (VAL) and shorts above Value Area High (VAH). Avoid trading inside High Volume Nodes (HVN / Fair Value Points).
* **Volume Vacuums:** Filter FVGs to align with Low Volume Nodes (LVN) at Value Area edges to ensure rapid repricing through thin liquidity.

## The Wyckoff Method Integration
* **Phase C:** Utilize Phase C Spring / Shakeout for long entries and Phase C UTAD for short entries.
* **Phase D:** Require Sign of Strength (SOS) or Weakness (SOW) demonstrated via Displacement body closes (MSS) creating clean FVGs.

## Market Microstructure & SMT Gatekeeper
* **SMT Gatekeeper:** Mandatory SMT requirement (ETH vs BTC) as a strict execution gatekeeper.
* **Institutional Backing:** Verify Open Interest (OI) expansion and Cumulative Volume Delta (CVD) divergence to confirm institutional capital absorption over retail stop-outs.
* **DOL Targeting:** Align Action Zones with Liquidation Density Clusters for primary profit targets.

## HTF Order Flow Hierarchy & Counter-Trend Veto
* **Hierarchy Mandate:** Higher Timeframe (1H/H4) Order Flow and Market Structure ALWAYS override 15m micro-structure and SMT signals.
* **Counter-Trend Veto:** If 1H/H4 Order Flow is **BEARISH** (e.g., major support broken into HTF Bearish Supply), the AI Agent is **STRICTLY PROHIBITED** from generating 15m Counter-Trend Bullish Long setups. All 15m Bullish SMT signals inside a 1H Bearish Trend are VETOED as liquidity traps, and analysis must focus exclusively on primary HTF Short Retests (shorting HTF Supply for SSL / HTF Demand targets).

---

# 2. Optimized 5-Step Daily & Hourly Workflow

The workflow follows a systematic 5-step quantitative progression:

* **Step 1: HTF Narrative & DOL:** Analyze higher-timeframe intent (D1/H4) and identify primary Draw on Liquidity (DOL) magnets (PDH/PDL, HTF FVGs, ERL vs IRL, Liquidation Density Clusters).
* **Step 2: Session & Value Profiling:** Identify Value Area Extremes (VAH/VAL) and HVNs/LVNs across London & NY sessions.
* **Step 3: Temporal Execution Gate:** Apply Killzone timing windows (London 02:00–05:00 EST / NY AM 08:00–11:00 EST with 0–90 min entry window) and Pre-News Volatility Filter. Reject setups during the DEAD_ZONE (NY Lunch / Mid-day pause).
* **Step 4: Liquidity Raid & SMT Confirmation:** Confirm setup via liquidity sweep (Phase C Spring/UTAD) and mandatory SMT divergence (ETH vs BTC) at Value Area extremes or session key levels. Validate against HTF Order Flow Gate.
* **Step 5: Micro Execution:** Execute on lower timeframe (15m) based on Phase D SOS/SOW Displacement body closes (MSS) + FVG/LVN entry alignment with OI and CVD Delta institutional backing.

---

# 3. Standardized Output Specification & Report Template

Every complete market analysis must be formatted using the following standardized matrix table:

| Section | Analysis Detail |
| :--- | :--- |
| **Market Context** | Current ETHUSDC.p Price & HTF Trend Bias |
| **HTF DOL** | Identified target on D1/H4 (e.g., PDH or FVG) |
| **Session Profile** | Active Session Liquidity Highs/Lows |
| **SMT Status** | Presence of BTC/ETH Divergence (Yes/No + Description) |
| **Trade Narrative** | Description of the 15m setup and expected move |
| **Risk Parameters** | Invalidation Level and Take Profit (TP) Levels |

---

# 4. Automated Daily Tracker Logging Protocol

To maintain quantitative rigor, all analysis and outcomes must be logged into both daily trackers (`directives/ETHUSDC_Daily_Tracker.md` and `directives/ETHUSDC_Daily_Tracker.json`):

1. **Entry Logging:** Upon identifying a setup, the agent must log the timestamp, the DOL rationale, and the SMT status.
2. **Session Close Review:** At the end of the New York session, the agent must update the tracker with the outcome (`Success`, `Stop Out`, or `No Trigger`).
3. **Data Fields:**
   * Date: `YYYY-MM-DD`
   * Setup Type: (e.g., `SMT Divergence + 15m MSS`)
   * DOL Reached: `Boolean` (`true` / `false`)
   * Notes on Price Action: (Brief commentary on deviation from plan)

---

# 5. Dynamic Risk & Scale-Out Management

This section outlines the Two-Stage Trailing Stop Protocol to ensure systematic risk management during market expansion:

* **Stage 1 (Pre-TP1 / In-Flight):** Stop Loss remains anchored below the True Protected Displacement Base or Entry Breakeven. Strictly prohibit trailing to Internal Range Liquidity (IRL) / micro-swings inside an active expansion leg.
* **Stage 2 (Post-TP1 / Runner Phase):** Only after banking 70% at TP1 (External Range Liquidity), trail SL to the confirmed M15 Structural Higher Low.

---

## Approval & Version Control

| Role | Name | Date |
| :--- | :--- | :--- |
| Document Owner | Quantitative Strategy Team | 2026-08-14 |
| System Reviewer | Flow-State Quant Engine | 2026-08-14 |
