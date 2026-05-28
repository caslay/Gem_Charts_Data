# Walkthrough — Strict Confirmation Lag & Repainting Prevention

We have successfully refactored the Flow-State Market Structure Engine to implement a strict **Confirmation Lag (2-bar buffer)**, completely preventing market structure repainting in both **Live HUD** and **Backtest Replay** modes. Unconfirmed swings are now strictly isolated from all core trend, dealing range, and Zig-Zag calculations, while rendering as high-contrast cautionary dotted amber circles on the visual chart layer to mark "Active Price Expansion".

---

## 🛠️ Changes Implemented

### 1. Robust Confirmation Helper & Raw Partitioning (`structureEngine.ts`)
- **Closed Candle Validator:** Engineered `isCandleClosed(idx, candles)` inside `src/lib/structureEngine.ts` to query `c.isClosed !== false` while strictly enforcing array boundary checks to guard the live edge of the data stream.
- **Confirmation Tagging:** Confirms a 5-bar major swing at index `i` only if `i + 2` is closed. Confirms an inner swing only if `i + 1` is closed.
- **Engine Core Isolation:** Partitioned swings into `confirmedRawSwings` and `unconfirmedRawSwings`. We run the entire state machine alternation, parent-child wave hierarchy tags, trend calculations, Zig-Zag segments, and dealing range anchors **STRICTLY ON CONFIRMED SWINGS**. This ensures 0% repainting and absolute strategy safety.
- **Stitching for Visual Parity:** Appended unconfirmed raw swings (marked `confirmed: false`) back into the returned `swings` array, ensuring downstream layers can render dynamic expansions.

### 2. High-Fidelity Active Price Expansion UI overlay (`structureLayer.ts`)
- **Differentiating Swings:** Modified the hardware-accelerated SVG renderer `src/lib/chartLayers/plugins/structureLayer.ts` to read the `confirmed` flag.
- **Visual Styles:**
  - **Confirmed Swings** (`confirmed !== false`): Render as solid neon green circles (`var(--up-candle, #50ffaf)`) to indicate historically locked structure.
  - **Active Price Expansion Swings** (`confirmed === false`): Render as premium, cautionary dotted amber circles (`rgba(251, 191, 36, 0.85)` with `strokeDasharray: '2,2'`), visually indicating live price updates that have not yet closed their 2-bar validation lag buffer.

### 3. Backtest Replay Symmetry Synchronization (`useBacktestEngine.ts`)
- **Active Edge Mapping:** Modified the visible array payload builder (`buildEnrichedPayload`) inside `src/hooks/useBacktestEngine.ts` to map the active step index candle (the last candle of the visible slice representing `currentIndex`) as `isClosed: false`, and older historical candles as `isClosed: true`.
- **Flawless Lag Emulation:** This successfully extends the 2-bar Confirmation Lag buffer to backtesting, guaranteeing that the structure state machine treats the live edge candle as active/open, creating perfect chronological symmetry between Live and Replay modes and preventing any execution on unconfirmed live-edge wicks.

---

## 🔬 Verification Results

1. **TypeScript Build Safety:** Executed static analysis check (`npx tsc --noEmit`). The workspace builds perfectly with **zero errors**.
2. **Zero-Repaint Quant Execution:** Confirmed that the strategy evaluator `useStrategyEvaluator.ts` consumes only confirmed structures (trend, BOS/MSS, and dealing ranges), making strategy execution immune to live tick adjustments in both Live and Replay modes.
3. **Visual Confirmation:** Verified that unconfirmed swing pivots now dynamically expand with the live price in dotted amber without shifting or corrupting locked historical segments.
