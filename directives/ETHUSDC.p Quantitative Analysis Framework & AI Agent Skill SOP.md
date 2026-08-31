# **Institutional Synthesis Framework: ETHUSDC.p Quantitative Analysis SOP**

This Standard Operating Procedure (SOP) defines the unified Institutional Synthesis Framework for the quantitative analysis of the ETHUSDC.p market. It integrates Pure ICT, Auction Market Theory (AMT & Volume Profile), The Wyckoff Method, and Market Microstructure (Open Interest & CVD Delta) into a systematic analytical hierarchy.

# **1\. Core Framework Components & Rules**

## **Pure ICT Time & Price Engine**

* Kill-Zone Timing Windows: London (02:00-05:00 EST / 09:00-12:00 Cairo) and NY AM (08:00-11:00 EST / 15:00-18:00 Cairo) with a 0-90 min entry window.  
* PD Arrays: Focus on Fair Value Gaps (FVG), Order Blocks (OB), Breakers, and Rejection Blocks.  
* Prohibited Rule: Explicit prohibition of the True Day Open (TDO) or Cairo TDO rule.

## **Auction Market Theory (AMT) & Volume Profiling**

* Value Area Extremes: Execute longs below Value Area Low (VAL) and shorts above Value Area High (VAH). Avoid trading inside High Volume Nodes (HVN / Fair Value Points).  
* Volume Vacuums: Filter FVGs to align with Low Volume Nodes (LVN) at Value Area edges.

## **The Wyckoff Method Integration**

* Phase C: Utilize Phase C Spring / Shakeout for long entries and Phase C UTAD for short entries.  
* Phase D: Require Sign of Strength (SOS) or Weakness (SOW) demonstrated via Displacement body closes (MSS) creating clean FVGs.

## **Market Microstructure & Order Flow State Machine Engine**

* SMT Gatekeeper: Mandatory SMT requirement (ETH vs BTC) as a strict execution gatekeeper.  
* Order Flow State Machine Decoding: Evaluate the active Open Interest trend and state transitions across 5 dimensions:
  1. **Institutional Intent:** `RISING_WITH_PRICE` (Aggressive Buy Sponsorship / Long Deployment), `RISING_AGAINST_PRICE` (Aggressive Short Sponsorship / Short Deployment), `FALLING_WITH_PRICE` (Long Liquidation / Bear Trap Absorption at VAL), `FALLING_AGAINST_PRICE` (Short Covering / Squeeze — do not chase breakouts), `FLAT` (Passive Equilibrium).
  2. **Regime Fatigue & Duration Decay:** Compare active state duration vs average persistence (>3x avg indicates statistical exhaustion into HTF boundaries).
  3. **MSS & Auction Gatekeeping:** Bullish MSS is only validated when backed by `RISING_WITH_PRICE`; MSS during short covering is unconfirmed.
  4. **24h Distribution Asymmetry:** Align macro trade sizing and direction with the 24h dominant sponsorship regime.
  5. **Inter-Market Absorption Climax:** Synthesize ETH `RISING_AGAINST_PRICE` with BTC Bullish SMT to detect smart money absorption traps.
* DOL Targeting: Align Action Zones with Liquidation Density Clusters for profit targets.

# **2\. Optimized 5-Step Daily & Hourly Workflow**

1. Step 1: HTF Narrative: Analyze higher-timeframe intent and primary Draw on Liquidity (DOL).  
2. Step 2: Session & Value Profiling: Identify Value Area Extremes (VAH/VAL) and HVNs/LVNs.  
3. Step 3: Temporal Execution Gate: Apply Killzone timing windows and Pre-News Volatility Filter.  
4. Step 4: Liquidity Raid & SMT Confirmation: Confirm setup via liquidity sweep and mandatory SMT divergence.  
5. Step 5: Micro Execution & Order Flow State Telemetry: Execute based on MSS \+ FVG/LVN alignment, Order Flow State Machine regime, and CVD Delta absorption.

# **3\. Standardized Output Specification & Report Template**

Every analysis must be delivered using the following structured template to ensure consistency.

| Section | Analysis Detail |
| :---- | :---- |
| **Market Context** | Current ETHUSDC.p Price & HTF Trend Bias |
| **HTF DOL** | Identified target on D1/H4 (e.g., PDH or FVG) |
| **Session Profile** | Active Session Liquidity Highs/Lows |
| **SMT Status** | Presence of BTC/ETH Divergence (Yes/No \+ Description) |
| **Order Flow State** | Active Regime, Duration, Delta & 24h Dominant State |
| **Trade Narrative** | Description of the 15m setup and expected move |
| **Risk Parameters** | Invalidation Level, Two-Stage SL, and Take Profit (TP) Levels |

# **4\. Automated Daily Tracker Logging Protocol**

To maintain quantitative rigor, all analysis and outcomes must be logged into the Daily Tracker.

1. **Entry Logging:** Upon identifying a setup, the agent must log the timestamp, the DOL rationale, and the SMT status.  
2. **Session Close Review:** At the end of the New York session, the agent must update the tracker with the outcome (Success, Stop Out, or No Trigger).  
3. **Data Fields:**  
   * Date: Date  
   * Setup Type: (e.g., SMT Divergence \+ 15m MSS)  
   * DOL Reached: (Boolean)  
   * Notes on Price Action: (Brief commentary on deviation from plan)

# **5. Dynamic Risk & Scale-Out Management**

This section outlines the Two-Stage Trailing Stop Protocol to ensure systematic risk management during market expansion.

* **Stage 1 (Pre-TP1 / In-Flight):** Stop Loss remains anchored below the True Protected Displacement Base or Entry Breakeven. Strictly prohibit trailing to Internal Range Liquidity (IRL) / micro-swings inside an active expansion leg.
* **Stage 2 (Post-TP1 / Runner Phase):** Only after banking 70% at TP1 (External Range Liquidity), trail SL to the confirmed M15 Structural Higher Low.

---

## **Approval & Version Control**

| Role | Name | Date |
| :---- | :---- | :---- |
| Document Owner | Quantitative Strategy Team | 2026-08-14 |
| System Reviewer | Flow-State Quant Engine | 2026-08-14 |
