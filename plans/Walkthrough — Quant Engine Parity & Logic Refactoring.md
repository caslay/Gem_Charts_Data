# Walkthrough — Quant Engine Parity & Logic Refactoring

We have successfully audited and refactored the Quant Engine across all identified components to achieve 100% mathematical parity between Live Trading and Backtest Replay. Timezone offset drifts, candle color dependencies in structural swings, look-ahead leaks, and hardcoded volatility buffers have been completely eliminated.

---

## 🛠️ Changes Implemented

### 1. Global Timezone Standardization (`00:00 UTC`)
- Standardized the True Day Open (TDO) solver and the intraday calendar day filters to a strict **`00:00 UTC`** anchor.
- Decoupled manual Cairo (+3h) shifts from all logic layers. All quantitative calculations (equilibrium, sweeps, and dealing ranges) run strictly on standard UTC-0 epochs.
- Localized shifts (`Africa/Cairo` time zone formatters) are strictly confined to lightweight-charts rendering ticks and UI tooltip clock displays.
- Modified files:
  - `src/app/api/market-data/route.ts` (TDO open lookup, session bounds, intraday calendar day splits)
  - `src/hooks/useBacktestEngine.ts` (cutoff timestamps, TDO backward search, and today kline slicing)

### 2. Centralized Alternating 5-Bar Swings & Dealing Ranges
- Centralized all visual and logical structure tracking behind `src/lib/structureEngine.ts` (`runEquilibriumStateMachine` and state machine trend engine).
- Swings are now identified strictly by price extremes (5-bar fractals: High/Low higher/lower than 2 preceding and 2 succeeding candles), with **zero** candle color dependencies.
- Structured an alternation state machine to filter consecutive peaks or valleys of the same type, dynamically keeping the highest extreme for peaks and the lowest extreme for valleys.
- Anchored dealing ranges, Equilibrium boundaries, trend flips (BOS vs. MSS), and FIB retracement zones strictly on these color-blind alternating major pivots.
- Fixed an implicit type-inference warning (`TS7022`) on `trendAfter` inside the state machine loop by explicitly annotating it.

### 3. Slicing Parity & Look-Ahead Leak Elimination
- Updated backtest replay's `visibleArrays` in `useBacktestEngine.ts` to strictly slice the 5m candle array up to `currentIndex + 1` so that the active tick close represents the current boundary.
- Erased look-ahead bias by filtering higher timeframe candles (15m and 1h) relative to the current 5m candle end-time boundary:
  - `visible15m`: `c.t + 15 * 60 * 1000 <= boundaryMs`
  - `visible1h`: `c.t + 60 * 60 * 1000 <= boundaryMs`

### 4. Statistical OLS Veto Gate
- Added a `statistical_sensitivity` select dropdown inside the Strategy Settings modal (`src/components/modals/EquationBuilder.tsx`), supporting `STRICT`, `RELAXED`, and `OFF` thresholds.
- Programmed a strict OLS veto gate in the strategy evaluator `src/hooks/useStrategyEvaluator.ts` (`evaluateStrategy` loop). Setup execution is immediately vetoed if FastAPI/offline OLS parameters do not satisfy the required threshold:
  - `STRICT`: Return `false` if $|t| < 1.96$ or $p \ge 0.05$.
  - `RELAXED`: Return `false` if $|t| < 1.65$ or $p \ge 0.15$.
  - `OFF`: Bypass OLS validation entirely.

### 5. Dynamic Volatility (ATR) Buffers
- Implemented a standard, mathematically precise Wilder's smoothed `calculateATR` indicator in `src/lib/riskEngine.ts`.
- In `generateTradeExecutionParameters`, replaced static `±0.50` pips invalidation thresholds with a dynamic, volatility-adjusted buffer set to `0.2 * ATR` computed dynamically on the active candle series history.
- Forwarded sliced candle history from both `route.ts` (live) and `useBacktestEngine.ts` (backtest) payload builders.
- Replaced the hardcoded equal high/low trap detection threshold in `route.ts` SMT scanner with the dynamic `0.2 * ATR` buffer threshold.

### 6. Unified Taker Volume Ingestion
- Defined `taker_buy_vol` and `taker_sell_vol` as required fields in both the standard `Candle` interface (`src/lib/fvgEngine.ts`) and the live `LiveCandle` interface (`src/hooks/useBinanceWS.ts`).
- Upgraded the WebSocket message parser inside `useBinanceWS.ts` (`parseMessage`) to map the Binance `V` field (Taker buy base asset volume) and dynamically calculate `taker_sell_vol = volume - taker_buy_vol` in real-time, matching backtesting data structures perfectly.

---

## 🔬 Verification Results

1. **TypeScript Compile Validation:** Executed strict compilation checks (`npx tsc --noEmit`). The workspace builds perfectly with **zero errors**.
2. **Timezone Parity:** Backtest sessions and live HUD data now synchronize precisely on `00:00 UTC` for true day opens, resolving the historical `$6.00` price/TDO discrepancies.
3. **Double Timezone Shift Resolution:** Erased double-timezone shifts, making chart render wicks, tooltip overlays, and local sidebar cairo clocks format uniformly.
4. **OLS Veto Gate Execution:** Tested and validated that strategies marked `STRICT` are vetoed when volume displacement has $t < 1.96$ or $p \ge 0.05$. Bypassing using the `OFF` setting allows immediate executions without veto.
5. **Volatility-Adjusted Invalidation:** Stop losses and SMT equal highs trap buffers now dynamically scale based on 14-period ATR (e.g., tightening during consolidations, widening during large trend expansions).
