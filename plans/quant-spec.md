# 🛡️ Quant Engine Stability — Architectural Diagnostic Report & Implementation Specification

> **Document Version:** 1.0.0  
> **Date:** 2026-09-16  
> **Classification:** Engineering Specification (Read-Only Diagnostic Phase)  
> **Target Systems:** `TrendContinuationEngine.ts`, `AutomatedStrategyExecutionEngine.ts`, `SweepReclaimEngine.ts`, `SparkIngestionDispatcher.ts`, `HeadlessScheduler.ts`, `TelegramNotifier.ts`, `BiasEngine.ts`, `SMCStateEngine.ts`  
> **Observed Defects:** 4 Critical Behavioral Failures (Sept 15–16 Session)

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Defect 1: HTF Trend Whiplash — Root-Cause Analysis](#2-defect-1-htf-trend-whiplash)
3. [Defect 2: Alert Cadence Thrashing — Root-Cause Analysis](#3-defect-2-alert-cadence-thrashing)
4. [Defect 3: Dead Zone Ghost Alerts — Root-Cause Analysis](#4-defect-3-dead-zone-ghost-alerts)
5. [Defect 4: Pre-Broadcast Geometry Leak — Root-Cause Analysis](#5-defect-4-pre-broadcast-geometry-leak)
6. [State Machine Modifications & Mathematical Invariant Definitions](#6-state-machine-modifications)
7. [Implementation Checklist](#7-implementation-checklist)
8. [Validation Criteria & Test Commands](#8-validation-criteria)

---

## 1. Executive Summary

During the September 15–16 autonomous trading sessions, the Trend Continuation Execution Engine successfully extracted **+7.98R** in high-asymmetry expansions but revealed **4 critical behavioral defects** that degrade institutional execution discipline. This document provides a deterministic forensic root-cause analysis of each defect, proposes concrete state machine modifications with mathematical invariant definitions, and specifies an implementation checklist for the execution agent.

### Defect Severity Matrix

| # | Defect | Severity | Root Cause Category | Affected Files |
|---|--------|----------|---------------------|----------------|
| 1 | HTF Trend Whiplash | 🔴 CRITICAL | Missing hysteresis gate; disconnected bias pipeline | `SMCStateEngine.ts`, `BiasEngine.ts`, `restBootstrap.ts`, `SweepReclaimEngine.ts`, `AutomatedStrategyExecutionEngine.ts` |
| 2 | Alert Cadence Thrashing | 🔴 CRITICAL | Zero outbound rate limiter; no spatial hysteresis | `TelegramNotifier.ts`, `SparkIngestionDispatcher.ts`, `HeadlessScheduler.ts` |
| 3 | Dead Zone Ghost Alerts | 🟡 HIGH | Fragmented temporal gates; dispatcher bypasses dead zone | `SparkIngestionDispatcher.ts`, `agentEngineHandlers.ts`, `sessionContext.ts` |
| 4 | Pre-Broadcast Geometry Leak | 🟡 HIGH | Zero minimum R:R gate on TP1; sub-1.5R presets hardcoded | `AutomatedStrategyExecutionEngine.ts`, `SweepReclaimEngine.ts`, `SparkIngestionDispatcher.ts`, `scannerPresets.ts` |

---

## 2. Defect 1: HTF Trend Whiplash

### 2.1 Observed Behavior
The autonomous engine flipped its macro directional bias to **LONG** on a single 15m counter-trend wick inside a confirmed 1H/4H **bearish supply zone**, generating bullish setups that traded directly into overhead macro resistance.

### 2.2 Root-Cause Analysis

The investigation reveals **5 compounding architectural failures** that collectively allow a single 15m candle to flip macro bias:

#### Failure A: `BiasEngine.ts` — Mathematically Impossible Confirmed Bias

`BiasEngine.ts` contains a `resolveTripleVectorBias()` function with **contradictory inequalities** that make confirmed bias mathematically impossible:

```
v1Bullish = livePrice < activeSwingPOC    // Price must be BELOW POC
v3Bullish = livePrice >= activeSwingPOC   // Price must be AT or ABOVE POC
```

Both conditions can **never be simultaneously true**. Result: `resolveTripleVectorBias()` **permanently returns `'NEUTRAL'`**, 100% of the time. The system has been flying blind on macro bias since deployment.

#### Failure B: `restBootstrap.ts` — Tautological Macro Bias Computation

`restBootstrap.ts` (Lines 198–209) computes `macroDailyBias` via a simple `livePrice > sma20(1h)` comparison with **zero hysteresis buffer**. The `else` branch collapses all cases into a strict binary comparison, making the function equivalent to:

```
macroDailyBias = livePrice > SMA20_1H ? 'BULLISH' : 'BEARISH'
```

A price oscillating at the SMA boundary flips between BULLISH and BEARISH on every tick.

#### Failure C: `AutomatedStrategyExecutionEngine.ts` — Complete Execution Bypass of Macro Bias

`AutomatedStrategyExecutionEngine.ts` (Lines 2131–2144) receives `macroContext.macroDailyBias` but **completely ignores it** during setup qualification. The engine only checks `localDealingRange.equilibrium` for valuation alignment. A confirmed 1H BEARISH macro bias will **not veto** a 5m/15m BULLISH sweep & reclaim setup.

#### Failure D: `SweepReclaimEngine.ts` — Disabled HTF Bias Guard with Pseudo-HTF EMA

`SweepReclaimEngine.ts` (Lines 2466–2493) has an `enforceHtfBiasGuard` parameter that:
1. **Defaults to `false`** (disabled).
2. When enabled, computes a naive **EMA-24 directly on the local candle stream** (not actual 1H/4H candles).
3. Uses a knife-edge `curClose >= htfEma` comparison with **zero hysteresis buffer**.

#### Failure E: `SMCStateEngine.ts` — Instant Trend Flip on Single Undisplaced Close

`SMCStateEngine.ts` (Line 227) flips `current_trend_state` immediately on a **single candle close** past `protected_low`/`protected_high`, even on undisplaced breaks classified as `CHoCH`:

```typescript
// Line 227: Immediate flip with zero confirmation
this.current_trend_state = 'BEARISH_SWING';
```

There is **zero hysteresis**, zero confirmation requirement (e.g., 2 consecutive closes), and no volume displacement requirement to flip the state machine.

### 2.3 Summary of Vulnerability Chain

| Component | Location | Failure Mode |
|---|---|---|
| `BiasEngine.resolveTripleVectorBias()` | Lines 42–65 | Contradictory inequalities → permanently `NEUTRAL` |
| `restBootstrap.computeMacroContext()` | Lines 198–209 | Zero-buffer SMA comparison → tick-by-tick whiplash |
| `AutomatedStrategyExecutionEngine` | Lines 2131–2144 | `macroDailyBias` completely unread → no execution gate |
| `SweepReclaimEngine` | Lines 2466–2493 | `enforceHtfBiasGuard` disabled; pseudo-EMA on local TF |
| `SMCStateEngine` | Line 227 | Instant trend flip on single undisplaced close |
| Dead config: `transitionHysteresisBarCount` | `SweepReclaimEngine` L298,472 | Declared but **never read** by any algorithm |

---

## 3. Defect 2: Alert Cadence Thrashing

### 3.1 Observed Behavior
The system emitted **23 Telegram cards in 8.5 hours**, including burst alerts **1 to 4 minutes apart**, creating operator fatigue and masking genuine high-conviction signals.

### 3.2 Root-Cause Analysis

#### Failure A: Zero Outbound Rate Limiter in `TelegramNotifier`

`TelegramNotifier.sendRawMessage()` (Lines 1292–1335) executes an immediate HTTP POST to the Telegram Bot API with **zero request queueing, zero rate limiting, and zero inter-message delay**:

```typescript
// Line 1292-1335: Fire-and-forget with no spacing
const response = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(6000) });
```

The only guard is **deduplication** (same event key won't fire twice), but distinct setups with distinct fingerprints fire freely at any rate.

#### Failure B: Missing Temporal Cooldown Between Same-Symbol/Direction Alerts

The deduplication key in `generateQuantEventKey()` (Lines 1142–1213) is scoped to **individual unique IDs** (`decisionId`, `timestamp`). Two different BOS signals detected 2 minutes apart on the same symbol and direction generate different keys and both fire. There is **no minimum temporal spacing** between alerts for the same symbol and direction.

#### Failure C: Cascading Dispatch from Multiple Producers

Three asynchronous ingestion mechanisms can all generate Telegram alerts independently within the same candle window:

1. **`HeadlessScheduler.executeScan()`** → writes `ACTIVE` rows to `agent_decision_log` → triggers `sparkDispatcher.pollOnce()`.
2. **`SparkIngestionDispatcher.pollOnce()`** → picks up `ACTIVE` rows → broadcasts `SIGNAL_RECEIVED` / `ARMED_INTENT_REGISTERED`.
3. **`headless-daemon.ts` candle close handler** → runs `engine.evaluateTrendContinuation()` → can emit `LIMIT_ORDER_PLACED`.

Each produces its own Telegram card, and none is aware of what the others have already broadcast.

#### Failure D: No Spatial Hysteresis Gate

When market price oscillates within an active setup's POI zone, each 5m turbo scan can detect a "new" reclaim at a marginally different price, generating a new setup ID and a new Telegram card. There is **no gate** to suppress new intent generation when price remains within an existing active setup's POI band.

---

## 4. Defect 3: Dead Zone Ghost Alerts

### 4.1 Observed Behavior
Full actionable setup cards with sizing, stop-loss levels, and take-profit targets were broadcast to Telegram during **hard-locked dead zone hours** (e.g., NY Lunch 12:00–13:30 EST).

### 4.2 Root-Cause Analysis

#### Failure A: Fragmented, Un-Synchronized Dead Zone Definitions

The codebase contains **4 independent, incompatible** dead zone definitions:

| Definition | File | Scope | Hours (UTC) |
|---|---|---|---|
| NY Lunch Dead Zone | `sessionContext.ts` L61–90 | Returns `'DEAD_ZONE'` string | 16:00–17:30 UTC (EDT) |
| Rule 6 Precision Temporal Filter | `AutomatedStrategyExecutionEngine.ts` L661–670 | Blocks `submitStrategyOrder()` | 00, 09, 13, 17–19, 21 UTC |
| Institutional Cutoff | `SweepReclaimEngine.ts` L983–1024 | `isTradeInitiationAllowed()` | Rollover 23:50–00:10, CPI/FOMC ±20m, 14:30 hard cutoff |
| Operational Schedule | `operationalSchedule.ts` | Mutes `HeadlessScheduler` scans | 22:00–08:00 Cairo (19:00–05:00 UTC) |

These four mechanisms **operate independently** without a centralized temporal gatekeeper.

#### Failure B: Telegram Dispatch Bypasses All Dead Zone Gates

The critical gap: **the Telegram dispatch path bypasses every dead zone gate**:

1. In `sparkIngestionDispatcher.ts` (Lines 1750–1792), when an `ACTIVE` decision is ingested, `SIGNAL_RECEIVED` is **immediately broadcast to Telegram with ZERO Dead Zone check**.
2. In `agentEngineHandlers.ts`, `submitQuantDecision` broadcasts `ARMED_INTENT_REGISTERED` **without checking dead zone status**.
3. The `HeadlessScheduler` suppresses **AI scan initiation** during off-hours via `evaluateOperationalSchedule`, but external API submissions and database polling are **not gated**.

#### Failure C: Client-Only Dead Zone UI Mute

The 90-minute audio/visual mute in `useLiveAlerts.ts` (Lines 296–315) is **purely client-side React DOM logic** and has no connection to the VPS PM2 headless daemon or Telegram dispatch pipeline. It mutes the browser but not the server.

---

## 5. Defect 4: Pre-Broadcast Geometry Leak

### 5.1 Observed Behavior
Actionable setup cards with **Target 1 at 1:1.30R** reached the Telegram dispatcher, violating the institutional minimum 1.5R de-risking threshold. The displayed R:R Ratio showed an inflated `1:3.50` because it was computed against Target 2.

### 5.2 Root-Cause Analysis

#### Failure A: Zero Minimum R:R Gate Anywhere in the Pipeline

A comprehensive search across `AutomatedStrategyExecutionEngine.ts`, `SweepReclaimEngine.ts`, `SparkIngestionDispatcher.ts`, `GlobalRiskGovernor.ts`, `agentEngineHandlers.ts`, and `proximityRadar.ts` confirms: **there is NO minimum R:R gate or filter** to enforce that Target 1 must be >= 1.5R.

The term `minimum_rr` has **zero occurrences** across the entire `src/` directory.

#### Failure B: Factory Presets Hardcode Sub-1.5R Target 1

`scannerPresets.ts` explicitly configures:
- `factory_sr_15m_institutional_asymmetric`: `stage1Multiple: 1.30`
- `factory_sr_15m_institutional_confluence`: `stage1Multiple: 1.30`, `minDynamicTp1Multiple: 1.20`
- Default fallback: `stage1Multiple: 1.30`, `minDynamicTp1Multiple: 1.20`

When `SweepReclaimEngine` detects a dealing range equilibrium at **1.20R** distance, it sets Target 1 to that level and dispatches the setup as fully confirmed.

#### Failure C: Dispatcher Fallback Generates 1.0R Target 1

In `sparkIngestionDispatcher.ts` (Lines 460–476), when an incoming decision lacks a valid Target 1, the fallback algorithm creates:
- **1.0R** Target 1: `stage1Target = limitEntryPrice + riskDist * 1.0`
- **1.5R** Target 2: `stage2Target = limitEntryPrice + riskDist * 1.5`

This guarantees a sub-1.5R setup is queued, executed, and broadcast.

#### Failure D: Telegram R:R Display Masks Sub-1.5R TP1

In `formatQuantIntentSignalMarkdown()` (Lines 252–261), the R:R Ratio is computed using **Target 2 only**:

```typescript
const rewardDist = Math.abs(t2Val - entryPrice);  // Uses Target 2, NOT Target 1
rrStr = `1:${(rewardDist / riskDist).toFixed(2)}`;
```

A setup with TP1 = 1.0R and TP2 = 3.5R displays as `1:3.50`, creating a false sense of institutional quality.

#### Failure E: `submitStrategyOrder()` Lacks Pre-Order Geometry Gate

`AutomatedStrategyExecutionEngine.submitStrategyOrder()` (Lines 614–986) validates concurrency, cooldown, temporal filters, and price polarity, but **never checks** `stage1Multiple >= 1.5`.

---

## 6. State Machine Modifications & Mathematical Invariant Definitions

### 6.1 HTF Bias Hysteresis Gate

#### New State Machine: `HtfBiasHysteresisEngine`

```
State Diagram:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [UNSET] ──────────────── 1H body close > Protected High
           │                     AND displacement confirmed
           │                           ↓
           │                  [BULLISH_CONFIRMED]
           │                      ↑          │
           │    1H fails to   ────┘          │ 1H body close
           │    confirm (revert)             │ < Protected Low
           │                                 ↓
           │                  [BEARISH_PENDING]
           │                           │
           │                           │ Next 1H bar confirms
           │                           ↓
           │                  [BEARISH_CONFIRMED]
           │                      ↑          │
           │    1H fails to   ────┘          │ 1H body close
           │    confirm (revert)             │ > Protected High
           │                                 ↓
           └─────────────────>[BULLISH_PENDING]

  KEY RULE: 15m counter-trend wicks NEVER flip confirmed bias.
  They are classified as RETRACEMENT_IN_PREMIUM/DISCOUNT with
  execution_disabled = true.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Mathematical Invariants

**Invariant 1 — Trend Flip Requires HTF Body Close:**

```
BiasFlip(t) =
  BEARISH_PENDING  if C_body_1H(t) < P_protected_low_1H AND R_body >= 0.40
  BULLISH_PENDING  if C_body_1H(t) > P_protected_high_1H AND R_body >= 0.40
  NO_CHANGE        otherwise
```

**Invariant 2 — Multi-Bar Persistence Confirmation:**

```
BiasConfirm(t+1) =
  CONFIRMED  if C_close_1H(t+1) confirms same direction as pending
  REVERTED   if C_close_1H(t+1) closes opposite, reverting to prior confirmed bias
```

**Invariant 3 — 15m Counter-Trend Suppression:**

```
For all 15m candles c_i with wick beyond P_protected:
  if C_close_15m(c_i) remains inside [P_protected_low, P_protected_high]:
    classify as RETRACEMENT, execution_disabled = true
```

### 6.2 Alert Cadence Governor

#### New Component: `AlertCadenceGovernor`

```typescript
interface AlertCadenceState {
  lastAlertTimestamp: Map<string, number>;       // Key: `${symbol}_${direction}`
  activePoiZones: Map<string, { low: number; high: number; expiryMs: number }>;
  outboundQueue: { text: string; timestamp: number; priority: number }[];
}
```

#### Mathematical Invariants

**Invariant 4 — Temporal Cooldown:**

```
Alert(t) =
  SUPPRESSED  if t - t_last_alert(symbol, dir) < Δt_min
  DISPATCHED  otherwise

Where Δt_min = 900,000ms (15 minutes = 1 candle on 15m).
```

**Invariant 5 — Spatial Hysteresis:**

```
Alert(P_current) =
  SUPPRESSED  if P_poi_low - ε <= P_current <= P_poi_high + ε
  DISPATCHED  otherwise

Where ε = 0.05% × P_poi_mid (proximity tolerance band).
```

**Invariant 6 — Leaky Bucket Rate Limiter:**

```
R_outbound <= 1 message per 2,000ms per chat
```

### 6.3 Dead Zone Silence Engine

#### New Component: `CentralTemporalGatekeeper`

```
Flow:
  Incoming Alert/Setup Candidate
         │
         ▼
  CentralTemporalGatekeeper.isAllowed(timestamp)?
         │
    ┌────┴────┐
    │         │
  DEAD_ZONE   ACTIVE_SESSION
    │         │
    ▼         ▼
  MUTE:       PASS: Allow
  Emit ⚪     full dispatch
  heartbeat   pipeline
  only
```

#### Mathematical Invariants

**Invariant 7 — Unified Dead Zone Window (UTC):**

```
DeadZone(t) = TRUE if any of:
  - t ∈ [16:00, 17:30] EST  (NY Lunch — convert to UTC dynamically)
  - t ∈ [23:50, 00:10] UTC  (Funding Rollover)
  - t ∈ [CPI ± 20m] ∪ [FOMC ± 20m]  (Macro News)
  - t ∉ [activeStart, activeEnd]_Cairo  (Off-Hours)
  Otherwise FALSE
```

**Invariant 8 — Dead Zone Output Restriction:**

```
Output(t ∈ DeadZone) = {
  type: OBSERVATION,
  body: "⚪ DEADZONE_STAND_DOWN",
  sizing: null,
  targets: null,
  stops: null
}
```

### 6.4 Pre-Broadcast Geometry Gate

#### New Guard: `InstitutionalGeometryGate`

```
Flow:
  Candidate Setup
         │
         ▼
  TP1_R >= 1.5?
    │       │
   No      Yes
    │       │
    ▼       ▼
  VETO    Overall R:R >= 2.0?
              │       │
             No      Yes
              │       │
              ▼       ▼
            VETO    PASS → Dispatch
```

#### Mathematical Invariants

**Invariant 9 — Minimum Target 1 Distance:**

```
|P_TP1 - P_entry| / |P_entry - P_SL| >= 1.50
```

**Invariant 10 — Minimum Overall Risk-Reward:**

```
|P_TP2 - P_entry| / |P_entry - P_SL| >= 2.00
```

**Invariant 11 — Telegram R:R Display Accuracy:**

Both TP1 R:R and TP2 R:R must be displayed. The headline R:R Ratio must show TP1 R:R (the binding de-risking tranche), not TP2.

---

## 7. Implementation Checklist

### Phase 1: HTF Bias Hysteresis Gate

- [ ] **1.1** Create new file `src/lib/quantEngine/HtfBiasHysteresisEngine.ts`
  - Implement the 4-state machine: `UNSET → BULLISH_CONFIRMED ↔ BEARISH_PENDING → BEARISH_CONFIRMED ↔ BULLISH_PENDING`
  - Require 1H body close (not wick) beyond protected swing for transition to PENDING state
  - Require next 1H bar confirmation for transition from PENDING to CONFIRMED
  - Classify 15m counter-trend breaks as `RETRACEMENT_IN_PREMIUM` / `RETRACEMENT_IN_DISCOUNT` with `execution_disabled: true`
  - Export `evaluateHtfBias(candles1h: Candle[], currentTimestamp: number): HtfBiasState`

- [ ] **1.2** Fix `BiasEngine.ts` `resolveTripleVectorBias()` contradictory inequalities
  - Fix Vector 3 to use `sweepOccurred` independent of POC polarity, OR
  - Replace the function with a delegation to the new `HtfBiasHysteresisEngine`

- [ ] **1.3** Modify `restBootstrap.ts` `computeMacroContext()`
  - Replace tautological `livePrice > sma20` with hysteresis-aware evaluation:
    - Add 0.15% buffer band around SMA20: only flip bias when price closes > SMA × 1.0015 or < SMA × 0.9985
  - Integrate `HtfBiasHysteresisEngine` to produce `htfConfirmedBias: 'BULLISH' | 'BEARISH' | 'PENDING' | 'UNSET'`

- [ ] **1.4** Modify `AutomatedStrategyExecutionEngine.ts` `onMultiTimeframeCandles()` (Lines 2131–2144)
  - Add explicit gate: if `macroContext.htfConfirmedBias` is BEARISH and setup direction is BULLISH, VETO
  - Add explicit gate: if `macroContext.htfConfirmedBias` is BULLISH and setup direction is BEARISH, VETO
  - Log `[HTF_BIAS_VETO]` with rejected setup details to daemon ledger

- [ ] **1.5** Modify `SweepReclaimEngine.ts`
  - Accept `htfConfirmedBias` in config and enforce it when `enforceHtfBiasGuard: true`
  - Replace pseudo-EMA-24 local computation with consumption of pre-computed `htfConfirmedBias` from 1H candles

- [ ] **1.6** Modify `SMCStateEngine.ts` (Lines 214–247)
  - Add displacement requirement for trend flip: require `body_ratio >= mss_body_ratio AND volume_expansion >= displacement_vef` before executing `current_trend_state` flip
  - Undisplaced `CHoCH` events should NOT flip `current_trend_state`; only confirmed `MSS` events should

- [ ] **1.7** Modify `headless-daemon.ts`
  - Pass 1H ring buffer candles to `HtfBiasHysteresisEngine` on every 1H candle close
  - Inject confirmed bias into `macroContext` passed to `engine.onMultiTimeframeCandles()`

### Phase 2: Alert Cadence Governor

- [ ] **2.1** Create new file `src/lib/notifications/AlertCadenceGovernor.ts`
  - Implement temporal cooldown map: `Map<string, number>` keyed by `${symbol}_${direction}`
  - Default minimum spacing: 900,000ms (15 minutes)
  - Implement spatial hysteresis: `Map<string, { low: number; high: number; expiryMs: number }>`
  - Suppress new intent generation when price oscillates within an active POI ± 0.05% tolerance
  - Implement leaky bucket outbound queue: max 1 message per 2,000ms

- [ ] **2.2** Modify `TelegramNotifier.ts`
  - Inject `AlertCadenceGovernor` into constructor
  - Gate `broadcastQuantMilestone()` through `governor.isAllowed(milestone, payload)` before `sendRawMessage()`
  - Add `queueMessage()` method with FIFO drain at 1 msg/2s rate

- [ ] **2.3** Modify `SparkIngestionDispatcher.ts`
  - Before broadcasting `SIGNAL_RECEIVED` (Lines 1750–1792), check `AlertCadenceGovernor.isTemporalCooldownActive(symbol, direction)`
  - Before broadcasting `ARMED_INTENT_REGISTERED`, check spatial hysteresis against all currently armed intents' POI zones

- [ ] **2.4** Modify `HeadlessScheduler.ts`
  - Before calling `sparkDispatcher.pollOnce()` after `executeScan()`, verify that the last successful alert for this symbol was > 15 minutes ago

### Phase 3: Dead Zone Silence Engine

- [ ] **3.1** Create new file `src/lib/temporalGatekeeper.ts`
  - Consolidate all 4 fragmented dead zone definitions into a single pure function:
    ```typescript
    export function isDeadZone(timestamp: number): { isDead: boolean; reason: string }
    ```
  - Merge: NY Lunch (16:00–17:30 UTC EDT), Rule 6 hours, Funding Rollover, CPI/FOMC ±20m, Off-Hours (outside Cairo 08:00–22:00)

- [ ] **3.2** Modify `SparkIngestionDispatcher.ts` `processDecisionRecord()`
  - At the **TOP** of the function (before any Telegram dispatch), call `isDeadZone(Date.now())`
  - If dead zone is active:
    - Set decision status to `'STAND_DOWN'`
    - Emit ONLY: `⚪ OBSERVATION: DEADZONE_STAND_DOWN` heartbeat (no sizing, no targets, no stops)
    - Skip all Telegram card formatting and `broadcastQuantMilestone()` calls

- [ ] **3.3** Modify `agentEngineHandlers.ts` `runSubmitQuantDecision()`
  - Before broadcasting `ARMED_INTENT_REGISTERED` (Lines 952–983), call `isDeadZone(Date.now())`
  - If dead zone: suppress card broadcast, log telemetry event, still write to database with `status: 'STAND_DOWN'`

- [ ] **3.4** Modify `TelegramNotifier.broadcastQuantMilestone()`
  - Add global dead zone check as the **first guard** before deduplication:
    ```typescript
    if (isDeadZone(Date.now()).isDead) {
      console.log(`[TELEGRAM] ⚪ Dead zone active — suppressing ${milestone} broadcast`);
      return false;
    }
    ```

- [ ] **3.5** Remove or deprecate dead zone checks from:
  - `sessionContext.ts` (Lines 61–90): Keep for display only, tag as `[DISPLAY_ONLY]`
  - `useLiveAlerts.ts` (Lines 296–315): Keep for browser mute, tag as `[CLIENT_ONLY]`
  - `AutomatedStrategyExecutionEngine.ts` (Lines 661–670): Delegate to `isDeadZone()`
  - `SweepReclaimEngine.ts` (Lines 3033–3044): Delegate to `isDeadZone()`

### Phase 4: Pre-Broadcast Geometry Gate

- [ ] **4.1** Create new file `src/lib/quantEngine/InstitutionalGeometryGate.ts`
  - Export `evaluateGeometry(entry, stopLoss, tp1, tp2): GeometryVerdict`
  - Enforce: TP1 R:R >= 1.50, Overall R:R >= 2.00
  - Return `{ passed: boolean; tp1_rr: number; tp2_rr: number; reason?: string }`

- [ ] **4.2** Modify `AutomatedStrategyExecutionEngine.ts` `submitStrategyOrder()`
  - After computing `stage1Target` and `stage2Target` (Lines 810–836), call `InstitutionalGeometryGate.evaluateGeometry()`
  - If verdict is `passed: false`, VETO with `[GEOMETRY_VETO]` and return `{ success: false }`

- [ ] **4.3** Modify `SweepReclaimEngine.ts`
  - After computing `target1` (Lines 2544–2566), enforce:
    ```typescript
    const tp1RR = Math.abs(target1 - executionEntry) / riskUsd;
    if (tp1RR < 1.50) {
      // Clamp TP1 upward to 1.5R minimum or VETO setup entirely
      continue;
    }
    ```

- [ ] **4.4** Modify `SparkIngestionDispatcher.ts` `parseDecisionRecord()`
  - Replace the fallback 1.0R Target 1 (Lines 460–476) with minimum 1.5R:
    ```typescript
    stage1Target = limitEntryPrice + riskDist * 1.50;  // Was: riskDist * 1.0
    stage2Target = limitEntryPrice + riskDist * 3.00;  // Was: riskDist * 1.5
    ```

- [ ] **4.5** Modify `scannerPresets.ts`
  - Update all factory presets to enforce `stage1Multiple >= 1.50`:
    - `factory_sr_15m_institutional_asymmetric`: `stage1Multiple: 1.50` (was 1.30)
    - `factory_sr_15m_institutional_confluence`: `stage1Multiple: 1.50` (was 1.30)
    - `minDynamicTp1Multiple: 1.50` (was 1.20)
  - Add validation in preset registration: throw if `stage1Multiple < 1.50`

- [ ] **4.6** Modify `TelegramNotifier.ts` `formatQuantIntentSignalMarkdown()`
  - Change R:R display to show TP1 R:R as the headline:
    ```typescript
    const tp1RR = entryPrice && payload.invalidationLevel && t1Val
      ? Math.abs(t1Val - entryPrice) / Math.abs(entryPrice - payload.invalidationLevel)
      : 0;
    rrStr = `1:${tp1RR.toFixed(2)} (TP1) / 1:${tp2RR.toFixed(2)} (TP2)`;
    ```

- [ ] **4.7** Modify `TelegramNotifier.ts` `formatArmedIntentRegisteredMarkdown()`
  - Apply same dual R:R display fix as 4.6

---

## 8. Validation Criteria & Test Commands

### 8.1 Pre-Flight Compilation

```bash
# 1. TypeScript compilation (zero errors required)
npx tsc --noEmit

# 2. Next.js production build (zero warnings on critical paths)
npm run build
```

### 8.2 New Automated Test Scripts

```bash
# 3. HTF Bias Hysteresis Verification
npx tsx scripts/test_htf_hysteresis.ts
# Expected: 
#   ✅ Single 15m wick does NOT flip confirmed 1H BEARISH bias
#   ✅ 1H body close + 1H confirmation bar DOES flip bias
#   ✅ Counter-trend 15m breaks classified as RETRACEMENT (execution_disabled)
#   ✅ BiasEngine.resolveTripleVectorBias() returns non-NEUTRAL when conditions met

# 4. Alert Cadence Governor Verification
npx tsx scripts/test_alert_cadence_governor.ts
# Expected:
#   ✅ Same-symbol same-direction alerts within 15m are SUPPRESSED
#   ✅ Spatial hysteresis suppresses alerts when price is within active POI ± 0.05%
#   ✅ Outbound queue drains at max 1 msg/2s (leaky bucket)
#   ✅ 23 alerts in 8.5 hours reduced to <= 8 (capped at 1 per 15m per symbol)

# 5. Dead Zone Silence Verification
npx tsx scripts/test_dead_zone_silence.ts
# Expected:
#   ✅ SIGNAL_RECEIVED during NY Lunch (16:00-17:30 UTC) is SUPPRESSED
#   ✅ ARMED_INTENT_REGISTERED during funding rollover (23:50-00:10 UTC) is SUPPRESSED
#   ✅ Output during dead zone is ONLY: ⚪ OBSERVATION: DEADZONE_STAND_DOWN
#   ✅ Zero sizing, zero targets, zero stops in dead zone output

# 6. Geometry Gate Verification
npx tsx scripts/test_geometry_gate.ts
# Expected:
#   ✅ Setup with TP1 = 1.30R is VETOED (GEOMETRY_REJECTED)
#   ✅ Setup with TP1 = 1.50R and TP2 = 2.00R is PASSED
#   ✅ Setup with TP1 = 1.50R and TP2 = 1.80R is VETOED (overall R:R < 2.0)
#   ✅ Dispatcher fallback generates 1.5R TP1 minimum (not 1.0R)
#   ✅ Telegram card displays TP1 R:R as headline (not TP2)
```

### 8.3 Existing Regression Tests

```bash
# 7. Existing parity and guardrail tests (must remain green)
npx tsx scripts/test_ttl_and_parity.ts
npx tsx scripts/verify_quant_vs_pm2_parity.ts
npx tsx scripts/test_risk_governor.ts
```

### 8.4 Backtest Regression Verification

After implementation, run the factory champion presets through Quant Lab to verify zero regression on verified metrics:

```
# Via MCP (preferred):
# run_quant_backtest with preset_id='factory_sr_5m_alpha_shield_early_be', start_date='2025-09-16', end_date='2026-09-16'
# run_quant_backtest with preset_id='factory_sr_5m_fvg_ce_sniper', start_date='2025-09-16', end_date='2026-09-16'
```

**Acceptance Criteria:**
- `factory_sr_5m_alpha_shield_early_be`: Net Profit >= +155R, PF >= 1.30, Max DD <= -15R
- `factory_sr_5m_fvg_ce_sniper`: Net Profit >= +185R, PF >= 1.55, Max DD <= -8R
- Same-bar exit count (`retest_time === exit_time`) <= 1 across 100,000+ bars
- TrendContinuationEngine champion metrics remain within ±5% of baseline

---

> **⚠️ IMPORTANT:** This document is a **read-only diagnostic specification**. No production source code has been modified. Implementation requires explicit user approval before proceeding.

> **🔴 CRITICAL FINDING:** Defect 1 (BiasEngine) reveals that the system's macro bias solver has been returning `NEUTRAL` 100% of the time due to contradictory inequalities. All setups since deployment have been executing without any macro directional filter. This is the highest-priority fix.
