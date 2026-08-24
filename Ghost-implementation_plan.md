# Start-Date Drift Elimination — Deterministic Structural State Bootstrap

## Background

The engine currently produces different structural narratives (BOS/MSS labels, Dealing Ranges, trend state) depending on the user's chosen backtest `start_date`. Shifting the window by even 6 days can swap which candle occupies the `PivotEngine`'s blind zone, change the first confirmed pivot fed to `initializeFromFirstPivot`, and seed a completely different `current_trend_state` in `SMCStateEngine` — making every downstream signal drift.

The fix does **not** require a Genesis Map server or an external database. All three scanner routes already fetch data from Binance using a paginated `fetchPagedKlines` helper, so the structural warmup candles can be prepended to the live fetch at zero architectural cost.

---

## User Review Required

> [!IMPORTANT]
> The SR scanner already has a 200-bar warmup (`warmupBars = 200`). The OB scanner does **not** — it fetches from `startMs` directly. Both warmups are currently `N-Period` warmups (fixed bar count), not **structural** warmups. This plan replaces the bar-count warmup with an engine-driven structural warmup tied to `lookbackMajor`. Any existing saved scan results will remain valid; only future runs will use the new deterministic seeding path.

> [!WARNING]
> The `SweepReclaimEngine.scanHistoricalSetups(candles)` and `OrderBlockEngine.scanHistoricalOrderBlocks(candles)` both receive the full flat candle array (warmup + evaluation together). After this change, a `warmupCutoffTs` timestamp will be passed alongside the candles so each engine knows to **skip recording any setup whose anchor forms before that timestamp**. This is a minor interface addition — not a breaking change, since the parameter will default to `0` (no cutoff).

---

## Open Questions

> [!NOTE]
> **Q1:** Should the structural warmup multiplier be configurable from the UI, or hardcoded at `3 × lookbackMajor`?  
> The default `lookbackMajor = 15` → `3 × 15 = 45` warmup bars. This is small enough to be cheap on any timeframe and large enough to guarantee at least one full confirmed MAJOR pivot in the warmup window before the evaluation starts.

> [!NOTE]
> **Q2:** For the `quant-lab/run` (Strategy Backtest) route, there is currently **no warmup logic at all** — it fetches exactly `startDate → endDate`. Should this route receive the same structural warmup fix, or is the Strategy Backtest scope out of this PR?  
> Recommendation: Include it for completeness.

---

## Root Cause Summary (Code-Level)

| # | Location | Exact Problem |
|---|----------|---------------|
| RC-1 | `PivotEngine.ts:32` | MAJOR pivots require `lookbackMajor=15` candles on both sides. The first and last 15 candles of any slice can never produce a confirmed MAJOR pivot → the first confirmed pivot in short slices comes from deep inside the window, varying by start date. |
| RC-2 | `SMCStateEngine.ts:initializeFromFirstPivot()` | The trend state is seeded from the **first confirmed pivot in the supplied candle array**. If the start date shifts, the first pivot shifts → the initial `BULLISH_SWING` / `BEARISH_SWING` seed changes → all BOS/MSS labels downstream diverge. |
| RC-3 | `sweep-reclaim-scanner/route.ts:260` | The 200-bar warmup is a **fixed bar count**, not tied to `lookbackMajor`. On a 15m timeframe 200 bars = 50 hours, but if the market has no major pivot in those 50 hours the engine still starts blind. |
| RC-4 | `ob-scanner/route.ts:236` | The OB scanner has **zero warmup** — it fetches from `startMs` exactly. Every scan starting on a different day produces a completely fresh, cold engine state. |
| RC-5 | `MarketStructureAPI.ts:55` | The candle processing loop is monolithic — there is no concept of "warmup candles" vs "evaluation candles". The engine processes all candles identically, and any setup detected on the very first candles of the array is silently included. |

---

## Proposed Changes

### Component 1 — `src/lib/quantEngine/` (Engine Layer)

---

#### [MODIFY] [`SMCStateEngine.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/SMCStateEngine.ts)

**Add a `restoreSnapshot` / `captureSnapshot` pair.**

Currently the engine state (`current_trend_state`, `protected_high`, `protected_low`, `active_swing_high`, `active_swing_low`, `expansion_*`) can only be read externally. There is no way to inject a pre-computed state before the evaluation loop begins.

**Plan:**
- Add a `StructuralStateSnapshot` interface containing every mutable property of `SMCStateEngine`.
- Add `captureSnapshot(): StructuralStateSnapshot` — serializes the full engine state to a plain object.
- Add `restoreFromSnapshot(snapshot: StructuralStateSnapshot): void` — deserializes the snapshot back into the engine, overwriting all state properties. This is the "T-Zero Re-hydration" injection point.
- Export `StructuralStateSnapshot` from `types.ts`.

---

#### [MODIFY] [`types.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/types.ts)

**Add `StructuralStateSnapshot` interface and `StructuralBootstrapContext`.**

```
StructuralStateSnapshot {
  current_trend_state: 'BULLISH_SWING' | 'BEARISH_SWING';
  protected_high: number | null;
  protected_low: number | null;
  active_swing_high: number | null;
  active_swing_low: number | null;
  expansion_high_float: number | null;
  expansion_low_float: number | null;
  is_in_expansion: boolean;
  expansion_origin_price: number | null;
}

StructuralBootstrapContext {
  majorSnapshot: StructuralStateSnapshot;
  internalSnapshot: StructuralStateSnapshot;
  microSnapshot: StructuralStateSnapshot;
  confirmedMajorPivots: Pivot[];       // color-validated, confirmed pivots from warmup
  lastConfirmedDealingRange: StructuralDealingRange;
  warmupCutoffTs: number;              // UTC ms — evaluation boundary timestamp
}
```

---

#### [MODIFY] [`MarketStructureAPI.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/MarketStructureAPI.ts)

**Separate the monolithic `analyze()` into two phases.**

The current `analyze(candles, price, displacement)` method processes all candles identically. We need to split it so warmup candles can be processed in isolation and their resulting state serialized.

**Plan — two new methods alongside the existing `analyze()`:**

1. **`analyzeWarmup(warmupCandles: Candle[]): StructuralBootstrapContext`**  
   - Runs the full `PivotEngine` + three `SMCStateEngine` instances over `warmupCandles` only.  
   - After the loop, calls `captureSnapshot()` on each of the three state engines.  
   - Captures the `buildDealingRange()` result from the MAJOR state engine.  
   - Returns a `StructuralBootstrapContext` containing the three snapshots, confirmed major pivots, the dealing range, and `warmupCutoffTs = warmupCandles[last].t`.

2. **`analyzeWithBootstrap(evaluationCandles: Candle[], currentPrice: number, displacementStatus, bootstrap: StructuralBootstrapContext): MarketStructureAnalysis`**  
   - Creates fresh `PivotEngine` + three `SMCStateEngine` instances.  
   - **Before the main loop:** calls `restoreFromSnapshot()` on each state engine using the matching snapshot from `bootstrap`.  
   - **Also before the main loop:** pre-seeds the new `PivotEngine`'s pivot array with `bootstrap.confirmedMajorPivots` (the color-validated pivots from warmup) so the engine doesn't have to rediscover them.  
   - Runs the evaluation loop normally from candle index 0 of `evaluationCandles`.  
   - Skips recording any detected setup whose candle timestamp is `< bootstrap.warmupCutoffTs` (safety net).  
   - Returns the standard `MarketStructureAnalysis` object.

3. **Keep existing `analyze()` unchanged** — it remains the live/stateful path used by the live HUD. No regression risk.

---

#### [NEW] `src/lib/quantEngine/structuralBootstrap.ts`

**A pure utility module with a single exported function:**

```
computeStructuralBootstrap(
  symbol: string,
  timeframe: string,
  userStartMs: number,
  config?: MarketStructureConfig
): async Promise<{ warmupStartMs: number; bootstrap?: StructuralBootstrapContext }>
```

This function:
1. Computes `warmupStartMs = userStartMs - (lookbackMajor * 3 * intervalMs)`.  
   - Default: `15 × 3 = 45 warmup bars` — enough for at least 3 full confirmed MAJOR pivots.  
   - This is deterministic: same `userStartMs` + same `lookbackMajor` = identical `warmupStartMs` every time.  
2. Fetches `warmupCandles` from `warmupStartMs` to `userStartMs - 1ms` (the warmup window only).
3. Calls `new MarketStructureAPI(config).analyzeWarmup(warmupCandles)`.
4. Returns the `StructuralBootstrapContext` and the `warmupStartMs`.

This abstraction means the three route handlers can all call the same bootstrap utility in one line, keeping the route files clean.

---

### Component 2 — `src/app/api/quant-lab/` (API Route Layer)

---

#### [MODIFY] [`sweep-reclaim-scanner/route.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/quant-lab/sweep-reclaim-scanner/route.ts)

**Replace the hardcoded 200-bar warmup with the structural bootstrap.**

Current flow:
```
warmupBars = 200
fetchStartMs = startMs - (200 × intervalMs)
candles = fetchPagedKlines(fetchStartMs, endMs)
engine.scanHistoricalSetups(candles)  // sees warmup + evaluation as one flat array
```

New flow:
```
1. Call computeStructuralBootstrap(symbol, timeframe, startMs, config)
   → returns { warmupStartMs, bootstrap }

2. SSE status: "Running structural pre-warmup pass..."

3. Fetch evaluation candles: fetchPagedKlines(startMs, endMs)

4. Pass (evaluationCandles, bootstrap) to SweepReclaimEngine
   → engine uses bootstrap to pre-seed its internal structural state
   → engine only records setups where anchor.t >= startMs
```

The `SweepReclaimEngine.scanHistoricalSetups()` signature becomes:
```
scanHistoricalSetups(candles: Candle[], bootstrap?: StructuralBootstrapContext): { setups, telemetry }
```
When `bootstrap` is provided, the engine injects the state before processing. When absent (backward-compat fallback), it works exactly as before.

---

#### [MODIFY] [`ob-scanner/route.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/quant-lab/ob-scanner/route.ts)

**Add the structural bootstrap for the first time** (currently has zero warmup).

Same new flow as the SR scanner. The `OrderBlockEngine.scanHistoricalOrderBlocks()` signature gains the same optional `bootstrap?: StructuralBootstrapContext` parameter.

---

#### [MODIFY] [`run/route.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/quant-lab/run) *(Strategy Backtest)*

**Add the structural bootstrap** (currently has zero warmup of any kind).

The strategy backtest route passes `start_date` and `end_date` raw to its execution engine. The same bootstrap utility is called here to produce the structural seed state before the first evaluation candle is processed.

---

### Component 3 — `src/lib/quantEngine/SweepReclaimEngine.ts` & `OrderBlockEngine.ts`

---

#### [MODIFY] [`SweepReclaimEngine.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/SweepReclaimEngine.ts)

**Accept and apply the `StructuralBootstrapContext`.**

The engine internally builds its own pivot list and structural state from the candle array it receives. After this change:

1. If `bootstrap` is provided, the engine calls `restoreFromSnapshot()` on its internal `SMCStateEngine` instances **before** the main scan loop.
2. The engine also pre-seeds its pivot registry with `bootstrap.confirmedMajorPivots` so it doesn't have to re-discover structure that was already established in the warmup window.
3. Any setup detected with `anchor_timestamp < bootstrap.warmupCutoffTs` is filtered out of the returned `setups[]`.

**No existing public API surface changes** — `scanHistoricalSetups()` gains one optional parameter with a safe `undefined` default.

---

#### [MODIFY] [`OrderBlockEngine.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/OrderBlockEngine.ts)

**Identical pattern to `SweepReclaimEngine.ts`.**

`scanHistoricalOrderBlocks(candles, bootstrap?)` — inject bootstrap state before the main scan loop, filter out any order blocks whose `formation_timestamp < bootstrap.warmupCutoffTs`.

---

### Component 4 — `src/lib/quantEngine/PivotEngine.ts`

---

#### [MODIFY] [`PivotEngine.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantEngine/PivotEngine.ts)

**Add a `seedConfirmedPivots(pivots: Pivot[]): void` method.**

When called before `processCandles()`, this method pre-populates `this.pivots` with the supplied confirmed pivots from the warmup pass. The main `processCandles()` loop will then:
- Skip detecting new pivots at indices that overlap with a pre-seeded pivot's timestamp.
- Continue adding new pivots discovered in the evaluation candles normally.

This ensures that MAJOR pivots discovered during warmup are fully visible to the `SMCStateEngine` during evaluation, preventing the "first candle blind zone" problem (RC-1).

---

## Verification Plan

### Determinism Test (Primary)
After implementation, run two identical scans using the same engine type (e.g., SR Scanner, 15m):
- **Run A:** `start_date = 2026-08-18`, `end_date = 2026-08-24`
- **Run B:** `start_date = 2026-08-24`, `end_date = 2026-08-24` *(single-day slice of Run A)*

The structural state at `2026-08-24T00:00:00Z` must be identical in both runs:
- `current_trend_state` must match.
- `protected_high` / `protected_low` must match.
- `dealingRange.high` / `dealingRange.low` must match.

### Regression Test (Secondary)
- All 3 scanner types (SR, OB, Strategy Backtest) must still complete without errors.
- Scan results for existing date ranges must still produce results (total detected count in same order of magnitude as before).
- No setup with `anchor_timestamp < warmupCutoffTs` should appear in results.

### Backward Compatibility
- `analyzeMarketStructure()` (live HUD path via `structureEngine.ts`) must remain completely unmodified.
- `analyzeMarketStructureStateful()` must remain completely unmodified.
- No `MarketStructureAnalysis` interface properties are removed.

### Manual Verification
- Open Quant Lab, run SR scan with two different overlapping date ranges that share the last 7 days.
- Inspect the structural state logged in SSE status messages for both runs at the boundary date.
- Confirm the dealing range and trend state match at the overlap point.

---

## File Change Summary

| File | Change Type | Reason |
|------|-------------|--------|
| `src/lib/quantEngine/types.ts` | MODIFY | Add `StructuralStateSnapshot`, `StructuralBootstrapContext` |
| `src/lib/quantEngine/SMCStateEngine.ts` | MODIFY | Add `captureSnapshot()` / `restoreFromSnapshot()` |
| `src/lib/quantEngine/PivotEngine.ts` | MODIFY | Add `seedConfirmedPivots()` |
| `src/lib/quantEngine/MarketStructureAPI.ts` | MODIFY | Add `analyzeWarmup()` and `analyzeWithBootstrap()` |
| `src/lib/quantEngine/structuralBootstrap.ts` | **NEW** | Shared utility: fetch warmup candles + build bootstrap context |
| `src/lib/quantEngine/SweepReclaimEngine.ts` | MODIFY | Accept `bootstrap?` in `scanHistoricalSetups()`, inject state |
| `src/lib/quantEngine/OrderBlockEngine.ts` | MODIFY | Accept `bootstrap?` in `scanHistoricalOrderBlocks()`, inject state |
| `src/app/api/quant-lab/sweep-reclaim-scanner/route.ts` | MODIFY | Replace 200-bar warmup with structural bootstrap call |
| `src/app/api/quant-lab/ob-scanner/route.ts` | MODIFY | Add structural bootstrap (currently has none) |
| `src/app/api/quant-lab/run/route.ts` | MODIFY | Add structural bootstrap to Strategy Backtest route |
| `directives/02_lessons.md` | MODIFY | Add Lesson #41: Start-Date Structural Drift |
| `directives/master_blueprint.md` | MODIFY | Sync system docs |

---

## Execution Order

```
Phase 1: types.ts               → add new interfaces (no logic, no risk)
Phase 2: SMCStateEngine.ts      → add snapshot methods
Phase 3: PivotEngine.ts         → add seedConfirmedPivots
Phase 4: MarketStructureAPI.ts  → add analyzeWarmup + analyzeWithBootstrap
Phase 5: structuralBootstrap.ts → new utility (wires phases 1-4)
Phase 6: SweepReclaimEngine.ts  → bootstrap injection (optional param)
Phase 7: OrderBlockEngine.ts    → bootstrap injection (optional param)
Phase 8: Route files (×3)       → wire bootstrap utility into SSE handlers
Phase 9: Lessons + Blueprint    → documentation sync
```

Each phase is independently testable before moving to the next. Phases 1–5 can be completed without touching any route or scanner engine, making early unit testing possible.
