# Walkthrough — Structural Wave Hierarchy & Runaway Momentum Override

We have successfully refactored the Flow-State Market Structure Engine to support **Parent-Child wave relationships** (structural hierarchy) and implemented the **Velocity-Based Runaway Momentum Override** to protect strategies in high-velocity markets. All changes are type-safe and synchronized across the live HUD trading loop and the historical backtest replay engine.

---

## 🛠️ Changes Implemented

### 1. Structural Hierarchy (Parent-Child Waves)
- **Containment Boundary Solving:** Enhanced `runEquilibriumStateMachine` in `src/lib/structureEngine.ts` to identify Major boundaries. A Major Dealing Range is bounded strictly by the most recent validated alternating 5-bar Swing High and Swing Low.
- **Internal Swing Partitioning:** Swings that form entirely within the containment bounds of the active Major Range are automatically tagged as `INTERNAL_SWINGS`.
- **Trend and Dealing Range Lock:** Market structural trends (`MARKET_TREND` / `BULLISH` | `BEARISH`) and local dealing ranges are locked strictly to the Major extremes, ignoring internal swings and preventing premature trend reversals.

### 2. Velocity-Based Runaway Momentum Override
- **Velocity Tracking:** Introduced `MARKET_VELOCITY` based on sequential unmitigated Fair Value Gaps (FVGs) in the dominant displacement direction.
- **Runaway Mode Trigger:** If the count of sequential unmitigated FVGs $\ge 2$ and the volume displacement `anomaly_multiplier` exceeds $4.0x$, the engine transitions to `RUNAWAY` mode.
- **Gate Softening (Bypass):** Custom strategies that enable `momentum_override` can execute entries at the first available internal FVG or Order Block, bypassing the standard 50% Equilibrium/Premium-Discount retracement gates entirely while in `RUNAWAY` mode.
- **Directional Origin Guard:** Locks the strategy execution bias to prevent trend reversals as long as the price stays above (for Bullish) or below (for Bearish) the breakout origin price (`runaway_origin_price`) established at the oldest unmitigated FVG's extreme.

### 3. Strategy Customizer & Equation Builder UI Integration
- **Metric Definitions:** Registered `'MARKET_VELOCITY'` (Number) and `'STRUCTURE_TYPE'` (Enum: `['MAJOR', 'INTERNAL']`) in the metric definitions list inside `src/components/modals/EquationBuilder.tsx`.
- **Momentum Override Switch:** Placed a sleek, premium, animated glassmorphic toggle switch labeled `Momentum Override (Runaway Market Protection)` right below the OLS statistical sensitivity parameters.
- **Save/Load Compatibility:** Configured save/load states to store the `momentum_override` toggle directly within the custom strategy conditions JSONB payload.

---

## 🔬 Verification Results

1. **TypeScript Compile Validation:** Executed strict compilation checks (`npx tsc --noEmit`). The workspace builds perfectly with **zero errors**.
2. **Gate Softening Verification:** Strategy evaluator (`src/hooks/useStrategyEvaluator.ts`) correctly intercepts `LOCAL_PRICING`, `EQUILIBRIUM_STATUS`, and `PRICE_IN_OTE` queries during `RUNAWAY` momentum override states and successfully bypasses retracement constraints.
3. **Internal Swings Segregation:** Verified that 5-bar fractals forming entirely within the Major range boundaries are correctly tagged as `INTERNAL_SWINGS` and do not flip the structural trend bias.
