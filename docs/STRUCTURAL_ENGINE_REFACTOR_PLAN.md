# 🏗️ STRUCTURAL ENGINE REFACTOR PLAN — Regime-Adaptive Architecture

**Companion To:** [`FORENSIC_QUANT_AUDIT_REPORT.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/docs/FORENSIC_QUANT_AUDIT_REPORT.md)
**Classification:** Production Engineering Specification — INTERNAL
**Date:** 2026-08-31
**Author Role:** Senior Quantitative Architect & SMC/ICT Systems Engineer

---

## Table of Contents

1. [Architectural Specification: Trend-Direction Decoupling](#1-architectural-specification-trend-direction-decoupling)
2. [Wave Deduplication & Concurrency Guard](#2-wave-deduplication--concurrency-guard)
3. [Retest Validation Engine Upgrade](#3-retest-validation-engine-upgrade)
4. [Phased Implementation Roadmap](#4-phased-implementation-roadmap)

---

## 1. Architectural Specification: Trend-Direction Decoupling

### 1.1 Problem Statement

The current valuation gate in [`SweepReclaimEngine.ts:1463–1466`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/SweepReclaimEngine.ts#L1463-L1466) applies a **regime-agnostic** premium/discount filter:

```
Bullish → executionEntry <= dealingRangeEquilibrium (must be in Discount)
Bearish → executionEntry >= dealingRangeEquilibrium (must be in Premium)
```

This works in **11 of 13 months** (rotational markets) but fails catastrophically in **2 of 13 months** (vertical trending expansions). The February 2026 cascade cost −23.2R due to:
- Vetoing valid trend-continuation shorts (entry below lagging EQ)
- Permitting counter-trend knife-catching longs (entry in apparent "deep discount")

### 1.2 Solution: The Regime-Adaptive Valuation State Machine

The core insight: the valuation gate must behave differently under **two distinct regime states**:

| Regime State | Behavior | EQ Source | Gate Logic |
|:---|:---|:---|:---|
| **ROTATIONAL_AUCTION** | Enforce full structural dealing range EQ | `MarketStructureAPI.buildDealingRange()` | Shorts must be in Premium; Longs must be in Discount |
| **RUNAWAY_EXPANSION** | Decouple trend-direction trades from macro EQ | Local wave retest midpoint | Trend-following trades: local wave EQ only; Counter-trend trades: require Major HTF key level sweep |

### 1.3 Regime Classification Engine

The regime classifier consumes three signals already available in the codebase:

#### Signal 1: SMCStateEngine Expansion Flag
The `SMCStateEngine` in [`MarketStructureAPI.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/MarketStructureAPI.ts) already tracks `is_in_expansion` — a boolean indicating price has broken a structural extreme without forming a confirming counter-fractal. This is exposed via `expansion_high_float` / `expansion_low_float`.

#### Signal 2: Market Velocity (Sequential Unmitigated FVGs)
The `MARKET_VELOCITY` metric in the strategy evaluator counts sequential unmitigated FVGs in the displacement direction. A velocity ≥ 2.0 indicates a runaway impulse.

#### Signal 3: Displacement Sponsorship State
The `InstitutionalSponsorship` object tracks directional displacement intensity (`ACTIVE_BULLISH`, `ACTIVE_BEARISH`, `CONSOLIDATION`, `INACTIVE`).

#### Composite Regime Classifier:

```
REGIME_STATE = classify(expansion_flag, market_velocity, sponsorship):

  IF expansion_flag == true
     AND market_velocity >= 2.0
     AND sponsorship IN [ACTIVE_BULLISH, ACTIVE_BEARISH]:
    RETURN RUNAWAY_EXPANSION(direction = sponsorship.direction)

  IF expansion_flag == true
     AND market_velocity >= 1.0:
    RETURN TRANSITIONAL_EXPANSION(direction = sponsorship.direction)

  RETURN ROTATIONAL_AUCTION
```

**TRANSITIONAL_EXPANSION** is a buffer state — it relaxes the EQ gate slightly but doesn't fully decouple. This prevents whipsawing between states on minor momentum bursts.

### 1.4 Valuation Gate Rules per Regime × Direction

#### Regime: ROTATIONAL_AUCTION (Default — 11/13 months)

No changes from current behavior. Full structural dealing range enforcement:

```
BULLISH entry → Must satisfy: entryPrice <= structuralEQ (Discount)
BEARISH entry → Must satisfy: entryPrice >= structuralEQ (Premium)
```

#### Regime: RUNAWAY_EXPANSION — Bearish Cascade

During a confirmed bearish expansion (price cascading through structural lows):

| Trade Direction | Relative to Trend | Gate Rule |
|:---|:---|:---|
| **SHORT** (trend-following) | WITH trend | Use **local wave retest midpoint** as EQ instead of macro structural EQ. Entry must be above the midpoint of the most recent displacement leg: `entryPrice >= (impulseHigh + impulseLow) / 2` |
| **LONG** (counter-trend) | AGAINST trend | **Require sweep of a Major HTF key level** (PDL, London Low, Asian Low, or a confirmed Major Swing Low from the parent timeframe). Without a Major level sweep, the long is VETOED regardless of local discount positioning. |

**Mathematical Definition of Local Wave Retest Midpoint:**

```
localWaveMidpoint = (maxHigh[sweepIdx..reclaimIdx] + minLow[sweepIdx..reclaimIdx]) / 2
```

This replaces the lagging structural EQ with a context-local reference that tracks the actual displacement impulse, not a stale pre-cascade anchor.

#### Regime: RUNAWAY_EXPANSION — Bullish Rally

Symmetric to bearish cascade:

| Trade Direction | Relative to Trend | Gate Rule |
|:---|:---|:---|
| **LONG** (trend-following) | WITH trend | Use **local wave retest midpoint** as EQ. Entry must be below midpoint. |
| **SHORT** (counter-trend) | AGAINST trend | **Require sweep of a Major HTF key level** (PDH, London High, Asian High, or a confirmed Major Swing High). Without a Major level sweep, the short is VETOED. |

#### Regime: TRANSITIONAL_EXPANSION

A hybrid gate — structural EQ is used, but the enforcement is relaxed:

```
Standard Gate:   entryPrice <= structuralEQ (for longs)
Relaxed Gate:    entryPrice <= structuralEQ + 0.25 × ATR₁₄
```

This provides a ±0.25 ATR buffer zone around the structural equilibrium, accommodating slight EQ lag during early expansion phases.

### 1.5 State Machine Transitions

```
┌─────────────────────┐
│  ROTATIONAL_AUCTION  │ ◀── Default entry state
│  (Full DR EQ Gate)   │
└─────────┬───────────┘
          │
          │ expansion_flag = true && velocity >= 1.0
          ▼
┌─────────────────────────┐
│ TRANSITIONAL_EXPANSION   │ ◀── Buffer zone (relaxed EQ ± 0.25 ATR)
│ (Relaxed DR EQ Gate)     │
└─────────┬───────────────┘
          │
          │ velocity >= 2.0 && sponsorship ACTIVE
          ▼
┌─────────────────────────┐
│   RUNAWAY_EXPANSION      │ ◀── Full decoupling
│ (Local Wave EQ / HTF     │     (Trend-following: local EQ
│  Sweep Gate)              │      Counter-trend: Major HTF sweep required)
└─────────┬───────────────┘
          │
          │ Counter-fractal confirmed OR velocity < 1.0 OR sponsorship INACTIVE
          ▼
┌─────────────────────┐
│  ROTATIONAL_AUCTION  │ ◀── Return to default
└─────────────────────┘
```

**Transition Hysteresis:** To prevent rapid state oscillation, transitions from RUNAWAY back to ROTATIONAL require **2 consecutive bars** of sub-threshold conditions. This prevents a single low-volume bar from collapsing the expansion state.

### 1.6 Impact Estimation

Based on the forensic audit findings:

| Regime Month | Current Net R | Expected with Decoupling | Delta |
|:---|:---:|:---:|:---:|
| Feb 2026 (Bearish Cascade) | −21.2R (vs old) | ~+5R to +10R | +26R to +31R |
| Nov 2025 (Bullish Rally) | −10.3R (vs old) | ~+2R to +5R | +12R to +15R |
| 11 Rotational Months | +117.6R (vs old) | ~+117.6R (unchanged) | 0R |
| **Total Projected** | **+86.1R** | **+124.6R to +132.6R** | **+38.5R to +46.5R** |

---

## 2. Wave Deduplication & Concurrency Guard

### 2.1 Problem Statement

The batch scanner ([`SweepReclaimEngine.scanHistoricalSetups()`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/SweepReclaimEngine.ts#L785)) produces ~3,550 raw setups per year. After wave deduplication via [`adaptSweepReclaimSetupsToTrades()`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/equityCalculator.ts#L155), the clean count is ~2,088. This ~41% inflation distorts all reporting metrics.

### 2.2 Solution: In-Scanner Wave Deduplication

Rather than deduplicating only at equity curve generation, the deduplication logic should be embedded **within** the scan loop itself. This ensures all downstream consumers (reports, metrics, UI) receive clean data.

#### Design: Single Active Trade Per Structural Wave

The scanner maintains a `WaveConcurrencyTracker` state object that enforces one-at-a-time execution:

```
WaveConcurrencyTracker:
  activeTradeWindow:
    openTimestamp:  number | null    // When current trade opened
    exitTimestamp:  number | null    // When current trade exited (or projected exit)
    direction:      'BULLISH' | 'BEARISH'
    waveId:         string           // Unique displacement wave identifier
  pendingQueue:     SweepReclaimSetup[]  // Setups waiting for concurrency slot
```

#### Wave Identity Fingerprint

The current wave key (`reclaim_time || sweep_time || anchor_time`) suffers from `anchor_time` fallback clustering (Finding F-10). The improved wave fingerprint should use:

```
waveFingerprint = hash(
  displacement_start_timestamp,    // First candle of the impulse leg
  displacement_end_timestamp,      // Reclaim candle timestamp
  direction,                       // BULLISH | BEARISH
  floor(displacement_impulse_midpoint / ATR₁₄)  // Normalized price band
)
```

This fingerprint uniquely identifies a displacement wave regardless of which anchors were swept. Two setups from different anchors (e.g., MAJOR_LOW at \$2,412.50 and INT_LOW at \$2,414.30) swept by the same wave will share the same fingerprint.

#### Champion Selection Algorithm

When multiple setups share the same `waveFingerprint`, select the single champion using the priority chain from [`equityCalculator.ts:200–227`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/equityCalculator.ts#L200-L227):

```
1. Market Physics Priority (which limit is touched first):
   - Shorts: Lowest entry price → touched first as price rallies
   - Longs:  Highest entry price → touched first as price dips

2. Anchor Tier Priority (if entry prices are within $0.01):
   DAILY > LONDON > ASIAN > MAJOR > INTERNAL > INNER

3. Sweep Depth Tiebreaker:
   Deeper sweep depth percentage wins
```

#### Concurrency Enforcement During Scan Loop

At each bar iteration in `scanHistoricalSetups()`, before emitting a new setup:

```
FOR each candidate setup S at bar index I:
  IF waveConcurrency.activeTradeWindow != null:
    IF S.retest_time < waveConcurrency.activeTradeWindow.exitTimestamp:
      DISCARD S (overlapping with active trade)
      CONTINUE
  
  IF waveFingerprint(S) already has a champion:
    DISCARD S (duplicate anchor on same wave)
    CONTINUE
  
  EMIT S as executed trade
  UPDATE waveConcurrency.activeTradeWindow = {
    openTimestamp: S.retest_time,
    exitTimestamp: S.exit_time,
    direction: S.type,
    waveId: waveFingerprint(S)
  }
```

### 2.3 Impact on Reporting

With in-scanner deduplication, all downstream metrics automatically reflect clean single-position trades:

| Metric | Before (Raw) | After (In-Scanner Dedup) |
|:---|:---:|:---:|
| Reported Trade Count | 3,550 | ~2,088 |
| Monthly Breakdown Accuracy | Inflated | True executable counts |
| Streak Analysis | Unreliable | Accurate max consecutive losses |
| R Totals | Inflated | True compounding-model R |

### 2.4 Backward Compatibility

The existing `adaptSweepReclaimSetupsToTrades()` function in [`equityCalculator.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/equityCalculator.ts) should be retained as a **validation pass** (double-checking that the scanner's in-line deduplication is correct), but should no longer serve as the primary deduplication layer.

---

## 3. Retest Validation Engine Upgrade

### 3.1 Problem Statement

Three distinct issues in the retest validation pipeline:

1. **0-bar/same-bar retest leak:** Currently prevented by `reclaimIdx + 1` start index, but 1-bar retests include continuation trades (not genuine pullbacks).
2. **Overly aggressive `maxBarsToRetest` clamping proposal:** The report's proposed 6-bar clamp is mathematically counterproductive (net −25.6R).
3. **Intra-bar execution order ambiguity:** Standard bar-level simulation limitation.

### 3.2 Solution A: Retest Freshness Classification

Instead of a binary include/exclude based on `maxBarsToRetest`, classify retests into quality tiers that provide transparency without discarding profitable trades:

```
RetestFreshness:
  IMMEDIATE:    reclaimIdx + 1                    (1 bar after reclaim)
  FAST:         reclaimIdx + 2 to reclaimIdx + 3  (2–3 bars)
  STANDARD:     reclaimIdx + 4 to reclaimIdx + 8  (4–8 bars)
  EXTENDED:     reclaimIdx + 9 to reclaimIdx + 16 (9–16 bars)
  STALE:        reclaimIdx + 17+                  (17+ bars — DISCARD)
```

Each executed trade carries a `retest_freshness` metadata field. The equity calculator and reporting can then:
- Display per-freshness statistics
- Allow configurable freshness filtering per scan preset
- Provide clear transparency into the 95.3% concentration stat

### 3.3 Solution B: Continuation vs. Pullback Retest Discrimination

A genuine **pullback retest** requires price to move AWAY from the entry zone after reclaim and then RETURN to it. A **continuation retest** is when price never meaningfully leaves the entry zone.

**Discrimination Algorithm:**

```
FOR retest candle at index retestIdx:
  
  // Measure maximum excursion between reclaim and retest
  maxExcursion = 0
  FOR k = reclaimIdx + 1 TO retestIdx:
    IF isBullish:
      excursion = candles[k].high - executionEntry  // How far above entry did price go
    ELSE:
      excursion = executionEntry - candles[k].low    // How far below entry did price go
    maxExcursion = max(maxExcursion, excursion)
  
  // Classify
  IF maxExcursion >= 0.5 × riskDistance:
    retestType = 'PULLBACK_RETEST'    // Price moved at least 0.5R away then returned
  ELSE IF maxExcursion >= 0.2 × riskDistance:
    retestType = 'SHALLOW_PULLBACK'   // Price moved but stayed close
  ELSE:
    retestType = 'CONTINUATION'       // Price never meaningfully left the zone
```

**Usage:** Continuation retests are still valid trades (they often work well) but should be reported separately from pullback retests to avoid conflating two distinct market dynamics.

### 3.4 Solution C: Strict Retest Freshness Window (Optimal Range)

Based on the mathematical analysis in the forensic audit (§4.3), the optimal `maxBarsToRetest` is **12 bars (60 minutes)**, not 6:

| Window | Win Rate | Breakeven WR | Above Breakeven? | Include? |
|:---|:---:|:---:|:---:|:---:|
| 1–2 bars | 74.4% | 45.45% | ✅ Yes (+29.0%) | ✅ |
| 3–5 bars | 60.1% | 45.45% | ✅ Yes (+14.6%) | ✅ |
| 6–10 bars | 54.5% | 45.45% | ✅ Yes (+9.1%) | ✅ |
| 11–12 bars | ~53.0% | 45.45% | ✅ Yes (+7.5%) | ✅ (boundary) |
| 13–20 bars | ~50.0% | 45.45% | ✅ Yes (+4.5%) | ⚠️ Marginal |
| 20+ bars | ~47.0% | 45.45% | ✅ Barely | ❌ Discard |

**Recommended Configuration:**
- **Default `maxBarsToRetest`:** 12 bars (60 minutes on 5M)
- **Aggressive preset:** 8 bars (40 minutes)
- **Conservative preset:** 16 bars (80 minutes)

### 3.5 Solution D: Intra-Bar Execution Order Model

For advanced simulation fidelity, implement a **probabilistic intra-bar execution model** for candles where both entry and exit are touched:

**Current Model (Deterministic Favorable):**
- If candle touches both entry AND TP → entry fills first → WIN
- If candle touches both entry AND SL → entry fills first → LOSS

**Proposed Model (Probabilistic):**
```
IF candle touches entry AND TP1:
  // Probability that entry was filled before TP1
  p_entry_first = f(entry_distance_from_open, tp_distance_from_open, bar_range)
  
  // Simple heuristic: closer to open = more likely filled first
  dist_entry = |entryPrice - candle.open|
  dist_tp    = |tp1Price - candle.open|
  p_entry_first = dist_tp / (dist_entry + dist_tp)
  
  // Expected R = p_entry_first × R_win + (1 - p_entry_first) × 0 (missed trade)
```

This is a **reporting enhancement** — it doesn't change the trade list but provides a confidence-adjusted R-multiple that accounts for intra-bar ambiguity. The probabilistic adjustment is expected to reduce total R by approximately 3–5%, providing a more conservative (and realistic) backtest estimate.

---

## 4. Phased Implementation Roadmap

### Phase 1: In-Scanner Wave Deduplication (Priority: 🔴 CRITICAL)

**Objective:** Eliminate anchor stacking from all batch scan outputs.

**Components:**
1. Implement `WaveConcurrencyTracker` class with wave fingerprint generation
2. Integrate tracker into `SweepReclaimEngine.scanHistoricalSetups()` scan loop
3. Add `waveFingerprint` and `is_wave_champion` fields to `SweepReclaimSetup` interface
4. Retain `adaptSweepReclaimSetupsToTrades()` as validation-only pass
5. Update all Quant Lab report generators to use post-dedup counts

**TypeScript Interface Changes:**
```typescript
// Addition to SweepReclaimSetup interface
interface SweepReclaimSetup {
  // ... existing fields ...
  wave_fingerprint?: string;            // Unique displacement wave ID
  is_wave_champion?: boolean;           // True if this is the selected champion for its wave
  wave_cluster_size?: number;           // How many setups shared this wave (for transparency)
  stacking_discount_applied?: boolean;  // True if discarded due to concurrency overlap
}
```

**Zero-Repainting Guarantee:**
- The `WaveConcurrencyTracker` processes setups in strict chronological order (same as the bar iteration loop)
- Champion selection is deterministic (sorted by entry price → anchor tier → sweep depth)
- No future bar data is accessed during champion selection
- **Test assertion:** For any setup S at index I, the champion decision uses only data from bars [0..I]

**Verification Checklist:**
- [ ] Unit test: 3 setups on same wave → only 1 emitted
- [ ] Unit test: 2 setups on different waves, overlapping in time → only 1 emitted (concurrency guard)
- [ ] Integration test: 1-year scan produces ~2,088 trades (±10% of estimate)
- [ ] Regression test: `adaptSweepReclaimSetupsToTrades()` output matches in-scanner dedup output
- [ ] Zero-repaint test: Running the scan twice on identical data produces identical results

---

### Phase 2: Regime-Adaptive Valuation Gate (Priority: 🔴 CRITICAL)

**Objective:** Decouple trend-direction trades from lagging macro EQ during vertical expansions.

**Components:**
1. Implement `RegimeClassifier` utility function consuming expansion_flag, market_velocity, and sponsorship
2. Add `ROTATIONAL_AUCTION | TRANSITIONAL_EXPANSION | RUNAWAY_EXPANSION` enum to quant engine types
3. Modify valuation gate in `SweepReclaimEngine.ts:1463–1466` to branch on regime state
4. Add local wave midpoint calculator for RUNAWAY mode
5. Add Major HTF level sweep gate for counter-trend trades in RUNAWAY mode
6. 2-bar hysteresis for RUNAWAY → ROTATIONAL transition

**TypeScript Interface Changes:**
```typescript
// New enum
type MarketRegimeState =
  | 'ROTATIONAL_AUCTION'
  | 'TRANSITIONAL_EXPANSION'
  | 'RUNAWAY_EXPANSION';

// Addition to SweepReclaimSetup interface
interface SweepReclaimSetup {
  // ... existing fields ...
  market_regime_at_entry?: MarketRegimeState;
  valuation_gate_mode?: 'STRUCTURAL_EQ' | 'LOCAL_WAVE_EQ' | 'HTF_SWEEP_REQUIRED' | 'RELAXED_EQ';
  local_wave_equilibrium?: number;
  htf_sweep_required?: boolean;
  htf_sweep_level?: number | null;
}

// Addition to SweepReclaimEngineConfig
interface SweepReclaimEngineConfig {
  // ... existing fields ...
  enableRegimeAdaptiveEQ?: boolean;         // Default: true
  runawayVelocityThreshold?: number;        // Default: 2.0
  transitionalVelocityThreshold?: number;   // Default: 1.0
  transitionHysteresisBarCount?: number;    // Default: 2
  relaxedEqAtrBufferMultiplier?: number;    // Default: 0.25
}
```

**Zero-Repainting Guarantee:**
- Regime classification uses only data available at the current bar (expansion_flag, velocity, sponsorship are all computed from past/current bars)
- The 2-bar hysteresis prevents future data from affecting current bar's regime state
- **Test assertion:** Regime state at bar I is determined solely by bars [0..I]; appending bar I+1 does not change bar I's regime

**Verification Checklist:**
- [ ] Unit test: February 2026 cascade → SHORT at \$1,980 is PERMITTED (not vetoed)
- [ ] Unit test: February 2026 cascade → LONG without Major HTF sweep is VETOED
- [ ] Unit test: Rotational month (May 2026) → Behavior unchanged from current engine
- [ ] Integration test: 1-year scan with regime adaptation produces +124R to +133R net R
- [ ] Regression test: Rotational months show ≤ ±2R variance from current engine
- [ ] Hysteresis test: Single low-velocity bar during expansion does NOT collapse to ROTATIONAL

---

### Phase 3: Retest Freshness Classification & Optimal Window (Priority: 🟡 MEDIUM)

**Objective:** Replace binary include/exclude with quality-tiered retest classification.

**Components:**
1. Add `RetestFreshness` enum (`IMMEDIATE | FAST | STANDARD | EXTENDED | STALE`)
2. Add `retest_freshness` field to `SweepReclaimSetup` interface
3. Add pullback vs. continuation discrimination algorithm
4. Add `retest_type` field (`PULLBACK_RETEST | SHALLOW_PULLBACK | CONTINUATION`)
5. Update default `maxBarsToRetest` from 20 to 12 across all presets
6. Add per-freshness statistics to Quant Lab report output

**TypeScript Interface Changes:**
```typescript
// New enums
type RetestFreshness = 'IMMEDIATE' | 'FAST' | 'STANDARD' | 'EXTENDED' | 'STALE';
type RetestType = 'PULLBACK_RETEST' | 'SHALLOW_PULLBACK' | 'CONTINUATION';

// Addition to SweepReclaimSetup interface
interface SweepReclaimSetup {
  // ... existing fields ...
  retest_freshness?: RetestFreshness;
  retest_type?: RetestType;
  retest_max_excursion_r?: number;    // Max excursion in R-multiples before retest
  retest_delay_bars?: number;         // Exact number of bars between reclaim and retest
}

// Update to SweepReclaimEngineConfig defaults
interface SweepReclaimEngineConfig {
  // ... existing fields ...
  maxBarsToRetest?: number;           // Updated default: 12 (was 20)
  minBarsToRetest?: number;           // New: minimum bars for PULLBACK classification (default: 0)
  pullbackExcursionThreshold?: number; // Minimum R-distance for pullback classification (default: 0.5)
}
```

**Zero-Repainting Guarantee:**
- Freshness and type are computed at retest time using only bars [reclaimIdx+1..retestIdx]
- No future bar data is accessed
- **Test assertion:** Retest classification at bar retestIdx uses only bars [0..retestIdx]

**Verification Checklist:**
- [ ] Unit test: 1-bar continuation (no pullback) → classified as CONTINUATION
- [ ] Unit test: 3-bar pullback with 0.7R excursion → classified as PULLBACK_RETEST
- [ ] Unit test: maxBarsToRetest = 12 → bars 13–20 are classified as STALE and discarded
- [ ] Integration test: Freshness distribution matches expected decay curve
- [ ] Regression test: maxBarsToRetest = 12 vs 20 → net R change within −5R to +5R

---

### Phase 4: Reporting & Metric Pipeline Upgrade (Priority: 🟡 MEDIUM)

**Objective:** Ensure all user-facing metrics reflect clean, de-duplicated, freshness-classified data.

**Components:**
1. Update Quant Lab scan result UI to display de-duplicated trade counts
2. Add "Stacking Factor" transparency badge showing raw vs. clean counts
3. Add regime distribution pie chart to scan reports
4. Add retest freshness distribution histogram to scan reports
5. Update monthly calendar breakdown to use de-duplicated counts
6. Add confidence-adjusted R-multiple column (probabilistic intra-bar model)

**Verification Checklist:**
- [ ] UI test: Scan results show both raw and clean trade counts
- [ ] UI test: Monthly calendar uses clean counts and clean R totals
- [ ] Report test: Streak analysis runs on sequential (non-overlapping) trades only

---

### Phase 5: Validation & Hardening (Priority: 🟢 FINAL)

**Objective:** Comprehensive validation suite ensuring zero regression.

**Automated Test Suite:**

```
test_suite/
├── unit/
│   ├── test_wave_deduplication.ts           # 15+ test cases
│   ├── test_regime_classifier.ts            # 12+ test cases
│   ├── test_retest_freshness.ts             # 10+ test cases
│   └── test_valuation_gate_branching.ts     # 20+ test cases
├── integration/
│   ├── test_1year_scan_clean_counts.ts      # Full 1-year scan validation
│   ├── test_february_cascade_regime.ts      # Regime transition during cascade
│   └── test_may_rotation_unchanged.ts       # Regression on rotational months
└── regression/
    ├── test_zero_repaint_determinism.ts     # Dual-run identical output
    └── test_equity_curve_parity.ts          # In-scanner dedup matches post-processing dedup
```

**Zero-Repainting Master Assertion:**
For every setup S emitted by the scanner:
1. S.wave_fingerprint is deterministic given bars [0..S.retest_index]
2. S.is_wave_champion is deterministic given all setups with S.wave_fingerprint in bars [0..S.retest_index]
3. S.market_regime_at_entry is deterministic given bars [0..S.reclaim_index]
4. S.retest_freshness is deterministic given bars [S.reclaim_index+1..S.retest_index]
5. No setup field depends on any bar with index > S.retest_index

---

## Appendix A: Glossary of Referenced Components

| Component | File Path | Purpose |
|:---|:---|:---|
| SweepReclaimEngine | [`src/lib/quantEngine/SweepReclaimEngine.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/SweepReclaimEngine.ts) | 4-phase S&R state machine (anchors → sweeps → reclaims → retests) |
| MarketStructureAPI | [`src/lib/quantEngine/MarketStructureAPI.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/MarketStructureAPI.ts) | Structural dealing range, BOS/MSS, multi-level zigzag |
| equityCalculator | [`src/lib/quantEngine/equityCalculator.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/equityCalculator.ts) | Wave deduplication & equity curve generation |
| PivotEngine | [`src/lib/quantEngine/PivotEngine.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/PivotEngine.ts) | Multi-scale fractal pivot detection with Color Lock |
| SMCStateEngine | [`src/lib/quantEngine/MarketStructureAPI.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/MarketStructureAPI.ts) | Trend state machine (BULLISH/BEARISH/UNSET) |
| AutomatedStrategyExecutionEngine | [`src/lib/quantEngine/AutomatedStrategyExecutionEngine.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/AutomatedStrategyExecutionEngine.ts) | Live execution daemon with concurrency guards |
| useBacktestStrategyExecution | [`src/hooks/useBacktestStrategyExecution.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useBacktestStrategyExecution.ts) | Interactive replay execution hook |
| useStrategyEvaluator | [`src/hooks/useStrategyEvaluator.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useStrategyEvaluator.ts) | 10-tier strategy evaluation gate hierarchy |
| scannerPresets | [`src/lib/quantEngine/scannerPresets.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/scannerPresets.ts) | Configurable scan parameter presets |

---

*Specification authored by: Quantitative Architecture Engineering Division*
*Cross-reference: [`FORENSIC_QUANT_AUDIT_REPORT.md`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/docs/FORENSIC_QUANT_AUDIT_REPORT.md)*
