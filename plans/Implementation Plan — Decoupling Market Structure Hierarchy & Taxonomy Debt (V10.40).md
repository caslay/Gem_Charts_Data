# Implementation Plan — Decoupling Market Structure Hierarchy & Taxonomy Debt (V10.40)

To resolve the logic bleed, taxonomy confusion, and lookback anchor failures identified during the quantitative audit, we will execute a complete and systematic repair of the market structure engine and downstream consumers.

## Proposed Changes

We will modify four core files to permanently isolate Layer 1 (Major Structure), Layer 2 (Internal Structure), and Layer 3 (Inner Swings).

---

### Component 1: `src/lib/structureEngine.ts`

We will update the structural state machine to enforce strict separation between Layer 2 (Internal) and Layer 3 (Inner) swings, and resolve the lookback truncation bug.

#### [MODIFY] [structureEngine.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/structureEngine.ts)
1. **Refactor Taxonomy Classification:**
   - In `runEquilibriumStateMachine` (lines 258–261), replace the tagging of `volMultiplier < 2.0` (3-bar) swings from `structure_type: 'INTERNAL'` to `structure_type: 'INNER'`.
   - Update line 568 inside the fallback to also use `'INNER'` instead of `'INTERNAL'`.
2. **Resolve Lookback Truncation and Anchoring Drift:**
   - Instead of computing `internalTrend`, `internalZigzag`, `latestInternalMSS`, `internal_market_structure_shift`, and `internalDealingRange` strictly on `majorPost` (the post-anchor short run), we will calculate these on `majorFull` (the full historical run) and return them, or stitch them chronologically.
   - Since internal swings (`structure_type === 'INTERNAL'`) are fully contained within the major bounds, running their trend and dealing range on the entire historical buffer prevents anchor reset issues.

---

### Component 2: `src/app/api/market-data/route.ts`

We will synchronize the API handler to pass stable anchors and serialize the missing internal trend parameters.

#### [MODIFY] [route.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/market-data/route.ts)
1. **Provide Containment Context:**
   - Modify the call to `analyzeMarketStructureStateful` to pass the calculated macro dealing range pivots as the 7th argument (`globalAnchors`). This ensures that the stateful engine is seeded with historical macro boundaries even when called in stateless HTTP cycles.
2. **Expose Missing Serialized Metrics:**
   - Map and expose `internal_market_trend` (derived from `structureAnalysis.internalTrend`) and `internal_structure_shift` (derived from `structureAnalysis.internal_market_structure_shift`) at the top level of the `ipda_metrics` payload.

---

### Component 3: `src/hooks/useStrategyEvaluator.ts`

We will repair the evaluation metric mappings and resolve the veto gate lock.

#### [MODIFY] [useStrategyEvaluator.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useStrategyEvaluator.ts)
1. **Repair Metric Mappings:**
   - Update `INTERNAL_TREND` to read `ipda.internal_context?.trend || ipda.internal_market_trend || 'UNSET'`.
   - Update `INTERNAL_MSS` to read `ipda.internal_context?.market_structure_shift === true || ipda.internal_structure_shift === true`.
   - Update `INTERNAL_PRICING` to safely fallback to `ipda.internal_context?.pricing_status`.
2. **Expose `STRUCTURE_TYPE` Parity:**
   - Ensure that `STRUCTURE_TYPE` correctly returns `'INNER'` for Layer 3 swings and `'INTERNAL'` for Layer 2.
3. **Overhaul `LOCAL_PRICING` Veto Gate:**
   - Delete the short-circuiting check `if (ipda.global_anchors) { return ipda.global_anchors.current_status; }`.
   - Force `LOCAL_PRICING` to resolve strictly against the local dealing range (from `ipda.full_structure_map?.internalDealingRange` or `ipda.internal_context`), decoupling it entirely from the macro pricing.

---

### Component 4: `src/components/Sidebar.tsx`

We will update the Sidebar HUD's telemetry display for absolute alignment.

#### [MODIFY] [Sidebar.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/Sidebar.tsx)
1. **Fallback Resilience:**
   - Ensure the Sidebar consumes the newly corrected `data?.ipda_metrics?.internal_context` seamlessly, aligning the visual dashed-line states with the numeric Equilibriums.

---

## Verification Plan

We will perform strict automated and manual validation checks:

### Automated Tests
- Run `npx tsc --noEmit` to ensure zero compilation or type parity errors across the workspace.
- Run `npm run build` or verify correct API responses using browser validation.

### Manual Verification
- Check the Live HUD chart overlays to verify that `iMSS` and `iBOS` dashed lines render correctly and match the sidebar's Intraday Depth card values.
- Verify that `LOCAL_PRICING` evaluations in the Strategy Builder match the exact discount/premium positions of the local boundaries.
- Inspect the `/api/market-data` endpoint directly to verify that the JSON output has decoupled `internal_context` and correct `global_anchors` alignments.
