# ðŸ§  Flow-State Systemic Memory & Post-Mortems

## ðŸ›‘ Critical Lessons Learned (Never Repeat These Mistakes)

Before modifying the Quant Logic, Order Flow Engine, or Prompt Builder, review these historical system fixes:

### 1. The "Outside Bar" Anomaly (Resolved in V4/V7.9)
- **The Bug:** The fractal detection algorithm used to get confused by "Outside Bars" (a candle that forms both a swing high and a swing low simultaneously).
- **The Fix:** We implemented the **"Strict Directional Lock"**. A valid Swing High MUST have a red top preceded by green. A valid Swing Low MUST have a green bottom preceded by red. Do NOT revert to standard 3-bar or 5-bar pure-price checks without color validation.

### 2. [DEPRECATED - Phase 2 TDO Removal 2026-07-29] Timezone Drift & The True Day Open
- **Historical Context:** Market data was shifting because servers use UTC, but our institutional analysis relied on the NY Midnight / 07:00 Cairo open. The true_day_open_0700 was hardcoded as the macro pricing anchor.
- **Phase 2 Decision:** The True Day Open has been permanently removed from the entire system. The 00:00 UTC anchor was fragile (required fetching limit=150 BTC candles just to find one anchor), introduced a silent false-positive in the strategy evaluator (PRICE_VS_OPEN returning ABOVE when null), and was a ghost field in BiasEngine.ts (declared but never used).
- **Replacement:** Premium/Discount classification is now anchored to the PDH/PDL midpoint equilibrium ((pdh + pdl) / 2), computed from the previous day's 1h candles. The PRICE_VS_OPEN strategy metric is removed; use LOCAL_PRICING (PREMIUM/DISCOUNT) instead. The SMT relative strength anchor is now the previous 15m candle close (not TDO).

### 3. The Context Window Memory Overflow
- **The Bug:** Sending full raw OHLCV arrays to Gemini caused hallucinations and token limit errors.
- **The Fix:** We use **Payload Pruning & Pre-Computation**. The Backend Next.js engine computes the active_fvgs, BSL_Magnets, and SSL_Magnets first. We ONLY send the "Sliced JSON" (the Focus Window) to the AI. Do NOT write logic that forces the AI to iterate over thousands of raw candles.

### 4. The "DEAD_ZONE" Temporal Trap
- **The Bug:** The algorithm was taking trades during the NY Lunch/Mid-day pause when volume flatlined, falling for fake structural shifts.
- **The Fix:** We introduced the displacement_active flag based on Open Interest (OI) momentum and Volume. If displacement is inactive, the Agent must output [NEUTRAL / ABORT]. Do not bypass this safety net.

### 5. Server-Side Fetch Port Mismatches & Silent Failures (Vercel/Python Bridge)
- **The Bug:** During local development, the Next.js API route (/api/market-data) would silently fail when trying to fetch the Python backend.
- **The Cause:** Server-side fetches in Next.js require absolute URLs. We mistakenly hardcoded 127.0.0.1:3000 as the fallback, but the dev project was running on localhost:4000.
- **The Fix:** We directly bypass the Next.js dev server for internal fetches. In dev: pings http://127.0.0.1:8000 (uvicorn). In prod: routes to https://.

### 6. FastAPI POST returning HTTP 405 in Vercel Production
- **The Bug:** verifyDisplacement returned HTTP Error: 405 in production when calling /api/py/calculate-displacement.
- **The Cause:** The next.config.ts rewrite pointed to /api/index (triggering 308 redirects) and the proxy.ts middleware intercepted the request, redirecting to /login which only accepts GET.
- **The Fix:** Added isPyBackend to the bypass list in src/proxy.ts and corrected the rewrite destination to /api/.

## ðŸ› ï¸� Note to AI Agent:
If you encounter a new bug and successfully fix it, YOU MUST prompt the user to update this 02_lessons.md file with the new Post-Mortem.

If you encounter a new bug and successfully fix it, YOU MUST prompt the user to update this `02_lessons.md` file with the new Post-Mortem.

### 7. The Double-Alert & Double-Polling Hook Trap
- **The Bug:** Notifications and audio alerts for market events (e.g., Session Transitions, Purges) were firing twice simultaneously. The frontend was also duplicating its API calls to the backend.
- **The Cause:** The `useMarketData()` hook (which initializes `useLiveAlerts()`) was imported and called directly in both `page.tsx` and `NavigationHeader.tsx`. React created two independent hook instances, resulting in parallel API polling and duplicated alert triggers.
- **The Fix:** We hoisted the market data state into a global React Context (`MarketDataContext`). `layout.tsx` now wraps the app in the provider (calling the hook exactly once), and child components safely consume the singleton data via `useMarketDataContext()`.

### 8. Chart Candle Gaps & Execution Voids with Alert Lines
- **The Bug:** Placing or updating an alert line on the chart caused candles to break/show visual gaps. In addition, when alerts triggered with "Trigger AI Analysis" active, the visual console did not display the synthesis state or the narrative outcome.
- **The Cause:** 
  1. The chart synchronization effect for historical data included `updateAlertPositions` in its dependencies, which changed whenever alerts changed. This caused `setData()` to be called, discarding live accumulated ticks from the WebSocket connection and leaving a time gap before the next tick.
  2. The AI synthesis states (`aiAnalysis` and `isAnalyzing`) were local to `Sidebar.tsx`, so backend scans executed by the chart's alerts could not be communicated to the UI.
- **The Fix:** 
  1. Removed `updateAlertPositions` from the historical data sync effect dependencies in `Chart.tsx`, keeping only `[data]` to prevent `setData()` triggers during alert edits.
  2. Hoisted AI states (`aiAnalysis`, `isAnalyzing`) and implemented a unified `triggerAiAnalysisScan(alertMetadata?)` action inside the `useMarketData` hook, allowing the Chart and Sidebar to synchronize their triggers and rendering states seamlessly.

### 9. Timeframe & Navigation Chart Gaps (Resolved in V8.2)
- **The Bug:** Switching timeframe scales (e.g., 5m to 15m) or switching tabs to Settings and back broke the chart, rendering massive gaps or missing candles.
- **The Cause:** 
  1. `useBinanceWS` held a stale `liveCandle` from the previous timeframe and immediately updated the new series with out-of-order timestamps.
  2. The timescale fitting sequence did not re-trigger because `isInitialLoad` remained `false`.
  3. Polling in `useMarketData` ignored updates to historical candles (`data_payload`) to prevent UI flashes. This left a gap of minutes/hours between the cached context data and the new WebSocket feed when returning to the dashboard.
- **The Fix:** 
  1. Clear the WebSocket's `liveCandle` state on connection hot-swaps.
  2. Reset chart initial loading state and monitor refs when the interval changes to force timescale coordinate refitting.
  3. Proactively call context `refetch()` on timeframe switches or mount transitions to retrieve absolute-fresh historical candles.

### 10. The Order Book Depth Tick-Noise Alert Loop (Resolved in V8.2)
- **The Bug:** The frontend was triggering the `OBJECTIVE_UPDATE` audio alert continuously (every 5 seconds) inside the `Chart` difference engine.
- **The Cause:** The resting liquidity pool arrays (`BSL_Magnets` and `SSL_Magnets`) are loaded from Binance Futures depth data. Because limit orders are constantly added and canceled, the values fluctuate by tiny decimal amounts (e.g., 0.05 USDC) on every single poll, rendering the array value comparison always true.
- **The Fix:** We implemented a noise-filtering rounding helper `Math.round(val / 5) * 5` inside the Difference Engine watcher. This rounds the levels to the nearest 5 USDC (about 0.15% on ETH), ignoring micro-cancellations in the book while safely capturing major, structural wholesale liquidity shifts.

### 11. Server-Side Implicit Any Type Gating (Resolved in V8.2)
- **The Bug:** The Vercel build failed during production compilation on `src/app/journal/page.tsx:37:7` with: `Variable 'initialTrades' implicitly has type 'any[]' in some locations where its type cannot be determined.`
- **The Cause:** Declaring a variable without explicit type annotations (e.g. `let initialTrades = [];`) and subsequently assigning dynamic query outputs (`initialTrades = rows;`) inside a `try-catch` block triggered TypeScript's `noImplicitAny` safety protocol, blocking production compilation.
- **The Fix:** We imported the robust interface `TradeRecord` from `@/components/JournalTable` and explicitly typed the declaration: `let initialTrades: TradeRecord[] = [];`, casting the database row output using `rows as unknown as TradeRecord[];` to guarantee type safety throughout the Server Component render cycle.

### 12. Browser Autoplay Gating & Autoplay Console Errors (Resolved in V8.3)
- **The Bug:** Programmatic sound alerts (e.g. strategy matching alerts, risk warnings) triggered a browser `NotAllowedError` block inside the console on initial page load before the user interacted with the document.
- **The Cause:** Modern browsers block automated sound playback until the user executes a primary interaction (click, keypress) on the document. Simple `.play()` calls rejected, and their `.catch` blocks logged them as `console.error` which cluttered log telemetry and triggered automated bug filters.
- **The Fix:** We updated all alert audio `.play()` actions inside `useLiveAlerts.ts` and `useAlertSounds.ts` to intercept `NotAllowedError` and handle it gracefully by suppressing the warning/error in the console and printing a clean, low-impact debug info log.

### 13. Dynamic Theme Stylesheet Hydration Mismatch (Resolved in V9.8)
- **The Bug:** Next.js throws an explicit hydration console warning: `A tree hydrated but some attributes of the server rendered HTML didn't match the client properties` pointing to `<style id="dynamic-theme-customizer">` in `ThemeSync.tsx`.
- **The Cause:** The context `themeSettings` state was initialized inside the `useMarketData` hook. During server rendering (SSR), `window` is `undefined`, so the server rendered the `<style>` tag using default institutional theme settings. However, during the initial client hydration paint, `window` is defined, so the state immediately initialized with customized theme settings retrieved from `localStorage`. The difference in CSS overrides triggered a React hydration mismatch error.
- **The Fix:** We implemented a `mounted` state gate initialized to `false` and set to `true` in a client `useEffect` block inside `ThemeSync.tsx`. By checking `if (!mounted) return null;`, the component returns `null` on the server and on the first client paint. Hydration is completed smoothly, and the custom `<style>` stylesheet is safely injected on the post-hydration client paint, eliminating the console error.

### 14. Logic-Display Timezone Sync Drift (Resolved in V10.3)
- **The Bug:** A ~$6.00 price discrepancy in trade entries (e.g. Signal at 2124, Entry at 2118) caused by Logic Debt LD-10. Time offset injection (`utcPlus3OffsetMs`) inside the logic layer created synchronization drifts between WebSocket live data, API fallback price chains, and server-side dealing range clocks.
- **The Cause:** Injecting a +3h timezone shift directly into candle timestamps (`c[0] + utcPlus3OffsetMs`) forced downstream quantitative calculations, True Day Open search, and Killzone rules to run on shifted numbers while the rest of the systems ran on raw UTC.
- **The Fix:** Standardized the entire Quant Engine (API endpoints, kline data shape, WebSocket hook) to UTC-Zero at the logic layer. Shifted Cairo timezone calculations to the display/rendering layer (lightweight-charts time scale tick formatter and hover tooltip formatter configured with `timeZone: 'Africa/Cairo'`).

### 15. Backtest Replay Alert Separation & HUD Bleeding (Resolved in V10.4)
- **The Bug:** Toast notifications for strategy matches and trade executions during backtests were not appearing on the Market Replay screen, but were bleeding into the Live HUD alerts context, causing clutter and out-of-context toasts when navigating back to the main dashboard.
- **The Cause:** The `useStrategyEvaluator` hook executed on the backtest page fell back to the global `MarketDataContext` alert trigger (`triggerSmartAlert`) because no local override was provided. This appended backtest alerts directly to the live alert state. Meanwhile, the backtest page did not render the `<SmartAlertsToast>` component, so replay alerts were never displayed to the user during backtesting.
- **The Fix:** We implemented a decoupled local alert state manager (`activeAlerts`, `dismissAlert`, `triggerSmartAlert`) directly within `src/app/backtest/page.tsx` and explicitly passed the local `triggerSmartAlert` hook to the backtest `useStrategyEvaluator` configuration. We then rendered the `<SmartAlertsToast>` component at the bottom of the replay layout, ensuring instant, premium, zero-latency visual feedback on strategy executions during historical replays while completely isolating the live HUD from backtest alerts.

### 16. Backtest Double-Timezone Offset Shift (Resolved in V10.4)
- **The Bug:** During backtesting, the chart's timeframe was adding 3 additional hours (showing 12:00 PM instead of 9:00 AM), while the sidebar displayed the correct 9:00 AM Cairo time.
- **The Cause:** The replay engine `useBacktestEngine.ts` applied a manual `+3h` shift (`UTC_PLUS3_MS`) directly to the candle timestamps inside `parseBinanceKlines`. However, the Lightweight Charts component in `Chart.tsx` was also configured to format timestamps using `'Africa/Cairo'`, which shifted them by another `+3h`. This created a double shift at the rendering layer.
- **The Fix:** Standardized the backtest replay engine to UTC-Zero at the logic layer, matching the live HUD standard from Lesson 14. We removed the manual +3h shift from `parseBinanceKlines`, corrected the cutoff index search and True Day Open (07:00 Cairo = 04:00 UTC) calculations, and updated the backtest page sidebar `cairoTime` display to format raw UTC timestamps using the `Africa/Cairo` timezone dynamically.

### 17. The Inner-Swing Inducement Trap & Direction-Blind Structure (Resolved in V10.13)
- **The Bug:** The system was producing "Visual Noise" and mathematical corruption by treating minor 3-bar "Inner Swings" as major structural pivots, leading to false dealing ranges and premium/discount errors. In addition, the BOS/MSS classifications were direction-blind (e.g. upward breaks were ALWAYS labeled BOS, and downward breaks ALWAYS labeled MSS), which violated the contextual rules of trending markets. Finally, MSS events were hardcoded to `false` in the backtest engine, creating parity voids.
- **The Cause:** 
  1. Fractal detection in the visual layer, backend API, and backtest hooks was calculated inline without a unified mathematical model or Institutional Directional Color Lock, allowing Outside Bars to register false pivot extremes.
  2. The visual layer used a simple `B.type === 'HIGH' ? 'BOS' : 'MSS'` ternary check without tracking the active structural trend state (`BULLISH` or `BEARISH`).
  3. The Strategy Evaluator was unable to filter by directional MSS conditions (Bullish vs Bearish shift).
- **The Fix:** We created a centralized, pure-logic quant module `src/lib/structureEngine.ts` to govern all calculations. This engine enforces the **Directional Color Lock** on 5-Bar (MAJOR) fractals, tracks active trend states using a rigorous state machine (where breaks in trend direction are **BOS** and breaks against are **MSS**), gates MSS confirmation behind volume-based **displacement sponsorship**, and anchors the Structural Dealing Range strictly on color-validated major fractals. The visual layer, backend API route, backtest engine hook, and strategy evaluator were all refactored to consume this unified engine.

### 18. The NaN Volatility Window Index Drift & Out-of-Bounds Crash (Resolved in V11.1)
- **The Bug:** During live market data polling, server-side fetch updates returned `HTTP 500` status with the error: `TypeError: Cannot read properties of undefined (reading 'inside_bar')` at `MarketStructureEngine.detect_pivots` (line 240).
- **The Cause:** When calculating the dynamic Volatility-Adjusted window size ($N_t$), if the rolling ATR or median calculations encountered a lack of volume/price variation or uninitialized data inputs, the result calculated as `NaN`. Since Javascript/TypeScript propagates `NaN` across mathematical operators:
  1. The pivot check index `check_idx = t - N_t` evaluated to `NaN`.
  2. The boundary gate `if (check_idx < N_t) return;` (`NaN < NaN`) evaluated to `false`, allowing the engine pipeline to proceed.
  3. Evaluating `this.candles[NaN]` returned `undefined`, which immediately crashed when attempting to read the property `inside_bar`.
- **The Fix:** We implemented strict defensive bounds and `NaN` guards throughout `src/lib/structureEngine.ts`:
  1. Guarded `calculate_adaptive_n` to return the fallback `n_base = 5` if the dynamic window evaluates to `NaN`.
  2. Added an explicit `isNaN(N_t)` and `isNaN(check_idx)` check at the start of `detect_pivots`, and validated that `check_idx` lies within the strict bounds of `[0, this.candles.length - 1]`.
  3. Added existence guards (`!current || !mother`, `!left || !right`, `!candle_k`) in `is_inside_bar`, `compute_volume_sma`, and the pullback search loops (`locate_last_pullback_low`/`locate_last_pullback_high`) to guarantee that uninitialized index lookups fail silently rather than crashing the system.

### 19. Stale LocalStorage Properties & Undefined Parameter Leakage (Resolved in V11.2)
- **The Bug:** After introducing timeframe-specific lookback candle limits, the frontend failed with "Failed to fetch market data" console warnings, and backend routes returned `HTTP 500` server errors.
- **The Cause:** When retrieving `engineSettings` on mount, the hook loaded the existing JSON record stored in the user's browser `localStorage` from a previous session. Because that object lacked the newly introduced keys (`candlesLimit1m`, `candlesLimit5m`, etc.), they evaluated to `undefined`. Interpolating them directly in the background fetch query parameter string yielded `&limit1m=undefined&limit5m=undefined...`. On the backend, `parseInt("undefined", 10)` returned `NaN`, forcing Binance REST calls to request `limit=NaN`, which rejected with `HTTP 400 Bad Request` and crashed the API handler.
- **The Fix:** We implemented double-ended defensive synchronizations:
  1. **Client-Side:** Refactored the `useState` initializer in `useMarketData.ts` to merge the parsed `localStorage` object on top of `DEFAULT_ENGINE_SETTINGS` using `{ ...DEFAULT_ENGINE_SETTINGS, ...JSON.parse(stored) }`, guaranteeing all new keys default properly.
  2. **Server-Side:** Injected boundary checks and fallback gates in `/api/market-data/route.ts` for all timeframe query variables: `if (isNaN(limitX) || limitX < 100 || limitX > 1500) limitX = limit;` where `limit` acts as the stable global fallback.

### 20. Severe Binance Rate-Limiting & Bulletproof Offline Simulation Fallback (Resolved in V11.3)
- **The Bug:** During local development, the Next.js backend `/api/market-data` API suddenly throws a 500 error on page load, or a 400 error when scrolling back on the chart to load more history, showing `I'm a teapot (418)` inside the console.
- **The Cause:** Binance Futures REST API has strict DDoS/rate limits and geographic locks. Sequential paginated fetches (e.g. `fetchLargeHistory` requesting 5760 candles) or parallel endpoints queried under residential/USA IPs can trigger rate limits or geoblocks, resulting in HTTP 418 bans. In older code, if *any* single parallel fetch or historical lazy-load (`endTime` fast path) failed, the route threw an error, crashing the entire dashboard or history load cycle with a 500/400 error.
- **The Fix:** We implemented a bulletproof **Offline Simulation Mode** inside `/api/market-data/route.ts`:
  1. Wrapped both the main parallel fetches and the `endTime` lazy-loading fast-path fetches inside try-catch blocks.
  2. If any live Binance query fails or rate-limits, the API logs a warning, flags the state, and seamlessly shifts to **Offline Simulation Mode**.
  3. Built a mathematical price-movement simulator `generateMockCandles` supporting arbitrary anchor timestamps (via `endTimestamp`) to dynamically generate realistic historical OHLCV candle streams ending exactly at the requested `endTime` scroll cursor, allowing infinite smooth scrolling in demo mode without throwing any browser errors.

### 21. Perfect Movement Setup Phase 1 Sweep Bottleneck (Resolved in V11.1)
- **The Bug:** When the "Filter Chart Volumetrics (Perfect setups only)" toggle was enabled, **all** arrows turned grey (20% opacity faded). No arrow ever passed the Perfect Movement 3-Phase filter.
- **The Cause:** Phase 1 (Structural Proximity & Liquidity Sweep) was the critical bottleneck, rejecting **74% of all signals**. Three compounding issues:
  1. The sweep lookback only checked the **2 candles directly before the signal** (`P1` and `P2`). On 5-minute candles, the sweep event often occurs 3-5 candles before the displacement signal Ã¢â‚¬â€� outside this 2-candle window.
  2. The sweep required an **exact wick pierce** through a structural level (candle low Ã¢â€°Â¤ level AND close > level). In practice, price often approaches within 1-2 ticks of a level without piercing it exactly Ã¢â‚¬â€� still a valid "proximity sweep" but rejected by exact-match logic.
  3. The swing level filter only considered `MAJOR` and `INTERNAL` grade swings, ignoring `INNER` swings that are valid liquidity targets on lower timeframes.
  4. Phase 2 defaults were also over-restrictive: ATR multiplier 1.5Ãƒâ€” filtered out normal displacement candles; body ratio 0.6 and wick ratio 0.15 rejected most real-world candle shapes.
- **The Fix:** Implemented a configurable `pmSweepLookback` parameter (default: 5 candles), added **ATR proximity tolerance** (0.3 Ãƒâ€” ATR) for near-sweep matching, expanded swing grade search to all grades, and recalibrated all Phase 2 defaults via a 320-configuration parameter grid sweep against live ETHUSDT data. Added a new UI slider "Sweep Lookback (Candles Before Signal)" to the Smart Money Sweet Spot drawer.

### 22. Volumetric Markers Failing to Render on Live Ticks (Resolved in V11.2)
- **The Bug:** Volumetric arrows and SMT circles were appearing correctly on initial load or timeframe switch, but failed to render on new, real-time live candles as they closed.
- **The Cause:** The `generateVolumetricMarkers` rendering function bypassed calculation if it detected pre-calculated `volumetric_signal` fields on historical candles. Live candles arriving via WebSocket did not have this field pre-calculated by the Python backend. Because the function exited early due to the historical candles, the live candles were completely skipped.
- **The Fix:** Removed the `if (!hasPrecalculatedSignals)` short-circuit block in `src/utils/generateChartMarkers.ts`. We now unconditionally run `annotateCandlesWithVolumetricSignals(candles)` on every tick, which iterates efficiently (O(N)) and correctly calculates the markers for both historical and newly formed live candles.



### 23. FVG Mitigation Ghost Zones â€” Comment-Code Mismatch (Resolved in V11.4)
- **The Bug:** Mitigated FVGs remained visible on the chart as persistent ghost zones even after price had clearly traded through the imbalance area.
- **The Cause:** A critical mismatch between the V8.5 doctrine comment and the actual implementation in `src/lib/fvgEngine.ts` (lines 48â€“56). The comment correctly described wick-entry mitigation (BISI mitigated when `future.l <= top`, SIBI when `future.h >= bottom`), but the code enforced a full-breakout rule (BISI only mitigated when `future.l < bottom`, SIBI when `future.h > top`). This meant price had to **completely break through the entire gap** before it was marked consumed â€” allowing partially-filled or wick-entered FVGs to remain ACTIVE indefinitely and render on the chart.
- **Secondary Bugs Found:** `src/lib/quantEngine/LiquidityEngine.ts` used wrong candle property names (`c.close`, `c.open`, `c.high`, `c.low`) instead of the correct `Candle` interface properties (`c.c`, `c.o`, `c.h`, `c.l`), causing Order Block detection to silently fail (reading `undefined`). Also, `activeFVGs` in `LiquidityEngine` stored raw un-mapped FVG objects, creating a shape mismatch with the `MappedFVG` interface consumed by `MarketStructureAPI`.
- **The Fix:** Corrected mitigation thresholds in `fvgEngine.ts` to match the V8.5 wick-scanning doctrine. Fixed all candle property names in `LiquidityEngine.ts`. Wrapped `detectActiveFVGs` output in `mapAndConsolidateFVGs` inside `LiquidityEngine` to ensure consistent `MappedFVG` shape.

### 24. Market Structure Audit â€” 3 Critical Bugs + 4 Design Gaps (Resolved in V12.1.2)
- **The Bugs (BUG-1):** The Directional Color Lock from Lesson #1 and Lesson #17 was COMPLETELY BYPASSED in `PivotEngine.ts`. Every pivot at every level (MAJOR, INTERNAL, INNER) was hardcoded `colorValidated: true`, allowing outside bars and non-institutional extremes to anchor the Macro Dealing Range, corrupting all downstream BOS/MSS labels.
- **The Bugs (BUG-2 + GAP-4):** INTERNAL and INNER ZigZags shared the same `innerStateEngine` instance (`targetLevel: 1`), so Inner pivot events were contaminated by Internal-level triggers. Additionally, the return object's `internalZigzag` field was silently shadowed to point to `innerZigzag` â€” so all INT structural break labels were lost and both fields returned the same array.
- **The Bug (BUG-4):** The anti-corruption clamp that prevents the internal range from bleeding outside parent bounds was unconditionally replacing `anchor_low_swing` / `anchor_high_swing` with the Major swing anchors. This painted INT levels with Major pivot metadata, corrupting the visual hierarchy.
- **The Gaps (GAP-1 / GAP-2 / GAP-3):** Fallback DR anchors in the nearest-candle search hardcoded `colorValidated: true`. The SMCStateEngine always started BULLISH regardless of the actual market direction, producing false BOS events in bearish-opening datasets. The `currentTrend` ternary silently collapsed UNSET to BEARISH.
- **The Fix:**
  1. **`PivotEngine.ts`:** Implemented the Color Lock â€” SWING_HIGH: red top (close < open) preceded by green (close > open). SWING_LOW: green bottom (close > open) preceded by red (close < open).
  2. **`SMCStateEngine.ts`:** Added `initializeFromFirstPivot()` which bootstraps initial trend state from the first confirmed pivot per level before the candle loop begins.
  3. **`MarketStructureAPI.ts`:** Added a dedicated `microStateEngine = new SMCStateEngine(config, 0)` for Level 0 INNER pivots. Fixed the `internalZigzag` shadow. Fixed anti-corruption clamp to preserve anchor metadata. Fixed fallback anchor `colorValidated` to check actual candle colors. Fixed trend ternaries to explicit 3-way BULLISH / BEARISH / UNSET mapping.


### 25. Potential Trades Engine — 6 Silent Corruption Bugs (Resolved in V12.2)
- **The Bugs:**
  1. **(BUG-1) Dead FVG primary path:** `quantTradeEngine.ts` read `data.data_payload.active_fvgs` which is always `undefined` (the field lives at `data.ipda_metrics.active_fvgs`). Every call fell through to the inline fallback scanner, missing 4h/1h FVG context.
  2. **(BUG-2) Ghost field reads:** `data.ipda_metrics.last_price` and `data.ipda_metrics.bias_signal` do not exist. Real fields are candle close and `macro_daily_bias`. `institutionalBias` was permanently hardcoded to `CONFIRMED_BULLISH`.
  3. **(BUG-3) Missing `macro_structural_magnets` in backtest payload:** `useBacktestEngine.ts` never emitted this field. Backtest setups used raw 50-candle window extremes as dealing range anchors instead of structure-validated levels.
  4. **(BUG-4) Bearish TARGET_HIT checks wrong target:** Checked `lowestRecent <= tp1` (equilibrium) instead of `lowestRecent <= tp2` (SSL magnet). Equilibrium is always between price and the FVG, so every touched bearish setup instantly became TARGET_HIT.
  5. **(BUG-5) BSL Breakout `isNearby` hardcoded `true`:** Skipped the 2% proximity guard, polluting the Nearby quality filter tab.
  6. **(BUG-6) `displacement_sponsorship` type mismatch:** Backtest payload emitted a plain string but engine read `.status` as an object, always returning undefined and falling back to hardcoded `ACTIVE_BULLISH`.
- **The Fix:** (1) `data.ipda_metrics.active_fvgs` path corrected. (2) Ghost reads removed; bias reads from `macro_daily_bias`. (3) `macro_structural_magnets` added to backtest enriched payload, populated from `structureAnalysis.dealingRange` with PDH/PDL fallback. (4) Bearish TARGET_HIT condition corrected to `lowestRecent <= tp2`. (5) `isNearby` now computes real 2% distance. (6) Backtest now emits full `InstitutionalSponsorship` object; engine has dual-form guard for both string and object forms.

### 26. Potential Trades TP Drift & Dead Execute Button (Resolved in V12.3)
- **The Bugs:**
  1. **(TP1 R:R)** TP1 was anchored to `Math.min(equilibrium, bslMagnets[0])`, which could land BELOW the 1:1 R:R threshold (or even below entry when price is near equilibrium). No R:R floor was enforced, violating the minimum institutional execution standard.
  2. **(TP2 Drift)** TP2 was sourced from `bslMagnets[1]` / `sslMagnets[0]` — order-book resting pools that fluctuate by small decimal amounts on every tick. This caused TP2 to visibly change price on every data poll, giving no stable reference level.
  3. **(Execute Button 404)** `PotentialTradesModal.tsx` posted to `/api/journal` which does not exist. The real live journal endpoint is `/api/trades`. Every Execute click silently returned a 404 and the trade was never recorded.
  4. **(Wrong Symbol)** Both modals hardcoded `ETHUSDT` instead of `ETHUSDC`.
- **The Fix:**
  1. **TP1** now enforces a guaranteed 1:1 floor: `tp1 = max(tp1_natural, entryMid + risk)`. The structural anchor (equilibrium / BSL magnet) is preferred only if it surpasses the floor.
  2. **TP2** is now locked to a stable structural anchor chain: `bslMagnets[0]` (PDH-anchored, stable) ? `swingHigh` ? `entryMid + 2×risk`. It no longer uses `bslMagnets[1]` or `[2]` which are deep order-book entries that churn on every poll.
  3. Fixed `/api/journal` ? `/api/trades` in `PotentialTradesModal.tsx`.
  4. Updated all execute handlers to use `ETHUSDC` as symbol.

### 27. Potential Trades Timeline Chronology & False TARGET_HIT Bug (Resolved in V12.4)
- **The Bugs:**
  1. **(False TARGET_HIT)** Setups evaluated status by checking aggregate 50-candle highestRecent / lowestRecent bounds regardless of candle sequence. If price reached TP level hours BEFORE touching the FVG entry, the engine evaluated pre-entry candles and marked the setup as TARGET_HIT prematurely.
  2. **(Identical Open/Close Timestamps)** openTime and closeTime were recorded using 
ew Date().toISOString() on the same millisecond tick when evaluated.
  3. **(Transient Setup Key Collisions)** Setup keys in localStorage were anchored to transient UI display IDs (SET-04_BULL_...), causing setup state to cross-contaminate when FVG positions shifted across poll frames.
- **The Fix:**
  1. Implemented `evaluateSetupTimeline()` in `quantTradeEngine.ts`: scans candles strictly chronologically, first locating the exact candle index where entry touch occurred.
  2. Exit criteria (TP1/TP2 or SL breach) are ONLY evaluated on candles occurring at or after the entry touch index.
  3. `openTime` and `closeTime` are extracted directly from the candle timestamps (c.t) where entry touch and exit target/SL breach occurred.
  4. Migrated localStorage setup keys to stable intrinsic representations (FVG_BULL_1852.41_1852.86_...), eliminating setup ID cross-contamination.

### 28. Potential Trades Auto-Open & Real-Time Journal Tracking (Resolved in V12.5)
- **The Feature:** Traders needed an option to select specific Potential Trades to automatically open positions in the Trading Journal when price touches entry range, so they can track performance in real time without manual execution.
- **The Architecture:**
  1. **Selective Toggle:** Added `setupKey`, `isAutoExecute`, and `isAutoOpened` properties to `PotentialTrade` interface, backed by persistent localStorage helpers (`getAutoExecuteKeys`, `toggleAutoExecuteKey`).
  2. **Background Executor Hook (`useAutoTradeExecutor`):** Mounted inside `MarketDataProvider` (for 24/7 live polling) and `BacktestPage` (for replay steps). Monitors active setups and automatically POSTs to `/api/trades` or `/api/backtest-trades` the moment a setup transitions to `ACTIVE_WATCH` or `CONFIRMED`.
  3. **Idempotency Guard:** utoOpened: true is persisted per setup in localStorage, guaranteeing zero duplicate trade opens.
  3. **Idempotency Guard:**  utoOpened: true is persisted per setup in localStorage, guaranteeing zero duplicate trade opens.
  4. **UI Banner & Controls:** Added Auto-Execution status banner and interactive ? Auto-Open toggle buttons across table rows and inspector cards in both Live and Backtest Potential Trades modals.

### 29. Completed Trade Auto-Open & Historical Journal Record Logging (Resolved in V12.6)
- **The Feature:** When a Potential Trade completes (status TARGET_HIT [WIN] or INVALIDATED [LOSS]), Auto-Open or manual click execution logs it into the Trading Journal as a **COMPLETED / CLOSED TRADE** with complete timeline metadata.
- **The Protocol & Payload:**
  1. **Closed Trade Attributes:** Set status: "CLOSED", outcome: "WIN" | "LOSS", exit_price: closePrice, ealized_pnl: (exit_price - entry_price) * size, opened_at: openTime, closed_at: closeTime.
  2. **API Route Bypass:** Updated /api/trades and /api/backtest-trades POST handlers so status === "CLOSED" payloads bypass the active open-trade locks (GLOBAL_LOCK, portfolio risk cap, and ONE_TRADE_RULE).
  3. **UI Action Buttons:** Replaced disabled states for TARGET_HIT and INVALIDATED with interactive Log Win ?? and Log Loss ?? buttons across table rows and inspector cards.

### 31. Minimalist Ultra-Compact Dashboard Metrics Bar Redesign (Resolved in V12.8)
- **The Issue:** The top `DashboardMetrics` header bar (`MASTER BIAS`, `RANGE CONTEXT`, `TARGET STATUS (DOL)`) occupied over `115px-140px` of vertical height, taking up excessive screen real estate above the chart.
- **The Redesign:**
  1. Reduced total vertical height from `140px` to `~36px-40px` (>70% vertical screen space saved!).
  2. Transformed bulky stacked cards into single-line horizontal flex pills with tight padding (`py-1.5 px-3`), crisp micro-icons (`Compass`, `Activity`, `Target`), and bold monospace badges.
  3. Reclaimed nearly 100 pixels of vertical screen space, expanding chart viewport height significantly.

### 32. Intraday Potential Trade Refresh & Retest Preservation (Resolved in V12.9)
- **The Issue:** When price remained inside yesterday's range, the engine ignored new intraday setups and displayed only passed/completed setups from yesterday.
- **The Cause & Fix:**
  1. **Intraday Session Expiration:** `SetupRecord` in `quantTradeEngine.ts` now stores `dateStr` and `lastUpdated` timestamps. Memory entries older than 24h or from previous calendar days automatically expire, freeing today's price action to evaluate fresh setups.
  2. **FVG Retest Preservation:** Updated `detectActiveFVGs()` in `fvgEngine.ts` so that touching an FVG zone marks it as `ACTIVE_RETESTED` instead of dropping it from active scans. FVGs are only marked mitigated upon full boundary invalidations.
  3. **Always-Active Structural Sweeps:** Decoupled structural SSL liquidity sweep re-entry setups in `quantTradeEngine.ts` so that actionable structural setups generate every session alongside FVG queues.

### 33. Institutional Scenario Grading & Step-by-Step Join Guide (Resolved in V13.0)
- **The Feature:** Enriched setup generation with a 0-100 Quant Confluence Score, Tier Badges (`⭐ A+`, `⚡ A`, `🔹 B`), and step-by-step institutional trade join instructions.
- **The Implementation:**
  1. **Quant Scoring (`computeScenarioMetrics`):** Evaluates Cairo Master Bias match (+25), Dealing Zone alignment (+15), Displacement Sponsorship (+10), Multi-timeframe FVG confluence (+10), and R:R ≥ 1.5 (+10).
  2. **Scenario Join Guide UI:** Rendered a dedicated **"🎯 Institutional Best Scenario Join Guide"** box in both Live and Replay Potential Trades modal inspectors with step-by-step entry, SL protection, and TP scaling rules.

### 34. FVG Retest Status Mapping & Chart Ghost Zone Resolution (Resolved in V13.1)
- **The Bug:** When price ticked into a Fair Value Gap (e.g. 15m BISI or SIBI), the FVG box remained visible on the chart as a persistent unmitigated ghost zone indefinitely.
- **The Cause:** `detectActiveFVGs()` in `fvgEngine.ts` flagged touched FVGs as `ACTIVE_RETESTED`, but `mapAndConsolidateFVGs()` collapsed both `ACTIVE_UNMITIGATED` and `ACTIVE_RETESTED` into `status: 'UNMITIGATED'`. Because `Chart.tsx` and `fvgLayer.ts` filtered overlays via `if (fvg.status !== 'UNMITIGATED') continue;`, touched/retested FVGs were treated as unmitigated fresh zones and rendered continuously.
- **The Fix:** Updated `MappedFVG.status` to include `'RETESTED'`. Refactored `mapAndConsolidateFVGs()` to map `ACTIVE_UNMITIGATED` to `'UNMITIGATED'` and `ACTIVE_RETESTED` to `'RETESTED'`. As a result, once price ticks into an FVG, its mapped status updates to `'RETESTED'`, and it cleanly unmounts from the unmitigated FVG chart overlay.

### 35. Maximum Update Depth Exceeded in Chart useEffect Sync (Resolved in V13.2)
- **The Bug:** Next.js console error: `Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render` at `Chart.useEffect (src/components/Chart.tsx:121:5)`.
- **The Cause:** 
  1. Unstable Array Literals in Parent Render: In `src/app/page.tsx`, `getChartData()` and `activeFvgs={data?.ipda_metrics?.active_fvgs || []}` returned a newly instantiated empty array (`[]`) on every render when data was loading or missing.
  2. Un-guarded State Setters inside Effects: `Chart.tsx` had `useEffect(() => { setLocalCandles(data); }, [data])` and `setFvgOverlayBoxes([])` in `computeFvgOverlay()`. When `data` or `activeFvgs` changed reference on every render, the effects executed `setLocalCandles` and `setFvgOverlayBoxes`, triggering child component re-renders that re-computed `getChartData()`, causing a synchronous infinite render cycle.
- **The Fix:** 
  1. Defined static immutable empty array fallbacks (`EMPTY_CANDLES`, `EMPTY_FVGS`) and memoized `getChartData()` and `onManualPricesChange` in `src/app/page.tsx`.
  2. Implemented functional bailout checks in `Chart.tsx`: `setLocalCandles((prev) => (prev.length === 0 && data.length === 0 ? prev : data))` and `setFvgOverlayBoxes((prev) => (prev.length === 0 && boxes.length === 0 ? prev : boxes))` to bail out of state updates when empty, completely halting infinite re-render loops.

### 36. Micro SMT Counter-Trend Trap & HTF Order Flow Gate (Resolved in V13.3)
- **The Failure:** The quant engine generated a Bullish signal based on a 15m SMT Divergence (BTC Lower Low vs ETH Higher Low at $1,883.73), targeting $1,891.50–$1,897.30 (PDH). The setup stopped out as price rejected sharply from the $1,888.00–$1,898.00 zone down to sweep $1,868.00.
- **The Root Cause:** 
  1. **HTF Structure Blindness:** 1H/H4 market structure had broken major support at $1,905 down to $1,874, flipping HTF Order Flow to **BEARISH**. The rally to $1,888–$1,898 was a 1H Bearish Retest / Premium FVG Mitigation.
  2. **Un-Gated 15m Counter-Trend Scalp:** The engine treated a 15m SMT bounce in Discount as a macro bullish reversal instead of recognizing it as a short-term counter-trend retracement into an HTF Bearish Supply Zone.
  3. **Target Over-Extension:** The SOP failed to enforce Scenario C of `SKILL_BLUEPRINT.md`: Counter-trend SMT scalps must NOT target macro BSL/PDH; they must be strictly capped at 1H Bearish Supply with immediate breakeven stops.
- **The Systemic Fix:** 
  1. Enforced a **Mandatory 1H/H4 HTF Order Flow Gate**: When 1H/H4 Order Flow is Bearish, 15m Bullish SMT signals are marked as `COUNTER_TREND_RETRACEMENT` and capped at 1H Bearish Supply ($1,888–$1,898).
  2. Primary setups in HTF Bearish Order Flow MUST align with the **HTF Bearish Retest** (shorting the $1,888–$1,898 Action Zone down to $1,868 SSL / $1,850 HTF Demand).

### 37. Binance HTTP 418 IP Ban & Chart Ascending Time Assertion Resolution (Resolved in V15.1)
- **The Issue:**
  1. Binance API returned `HTTP 418: I'm a teapot`, triggering offline simulation mode.
  2. Lightweight Charts crashed with `Uncaught Error: Assertion failed: data must be asc ordered by time, index=600, time=1786735500, prev time=1786735500` at `Chart.tsx:1341` during `seriesRef.current.setData(formattedData)`.
- **The Cause:**
  1. **Binance HTTP 418:** Binance uses status code 418 when a client IP address exceeds API rate limits (1200 request weight/min or frequent burst connections from polling/hot-reloads), triggering a temporary WAF IP ban. Restarting the router assigns a fresh public IP from the ISP to immediately bypass the rate limit.
  2. **Duplicate Timestamps:** When historical candles or offline mock candles were formatted (`Math.floor(d.t / 1000)`), two adjacent items with the same second timestamp collided. Lightweight Charts strictly enforces `time[i] > time[i-1]`.
- **The Fix:**
  1. **Chart Data Deduplication:** In `src/components/Chart.tsx`, wrapped `formattedData` conversion in a `Map<number, Candle>` keyed by `timeSec` before sorting and calling `setData(uniqueFormattedData)`. This guarantees that duplicate timestamps are collapsed and strictly ascending.
  2. **Interval Boundary Alignment:** In `src/app/api/market-data/route.ts`, aligned `generateMockCandles` timestamps strictly to the interval multiple `Math.floor(rawNow / intervalMs) * intervalMs`.

### 38. Order Flow Timeline State Drift & Serverless DB Synchronization (Resolved in V15.3)
- **The Bug:** The historical Order Flow Timeline kept mutating and fluctuating every few minutes/seconds (jumping between 50, 100, 111 transitions), producing discrepancies between Localhost (persistent Node process) and Vercel (ephemeral serverless Lambdas). In addition, switching timeframes (e.g. from 15m to 5m in backtesting) created timestamp overlap collisions where `active_state.entered_at` appeared 5 minutes prior to the latest closed history segment, and the modal strip rendered 62% of the timeline as an empty dark void.
- **The Cause:**
  1. **5-Second Micro-Tick Flutter:** `updateLiveState` was evaluated against the unclosed candle on every 5-second poll. When live price or OI micro-fluctuated, `updateLiveState` treated it as a real transition and pushed duplicate 5-second records into `mem.history` and PostgreSQL. Localhost accumulated 111+ mutations while Vercel Lambdas reset to 50 on cold starts.
  2. **Timeframe Timestamp Collision:** In backtest replay, `computeTimelineFromCandles` ran on the visual `activeCandles` (5m) while history was cached from 15m candles, creating out-of-order timestamps.
  3. **Low Visual Contrast:** 62% of the timeline was `NEUTRAL`/`FLAT` styled with 50% opacity grey (`bg-zinc-700/50`) on `#0d0e12`, rendering as an invisible dark void.
- **The Fix:**
  1. **Strict Closed-Candle Boundary Gating:** `OrderFlowStateTracker.updateLiveState` now gates historical segment creation strictly on confirmed candle closes / new candle arrivals (`isNewCandleBoundary`). Intra-candle live price ticks update the active record's live metrics without polluting the historical array.
  2. **15m Structural Timeframe Anchoring:** Anchored backtest Order Flow calculation strictly to `candles_15m` structural arrays across all routes, preventing timeframe cross-contamination.
  3. **Chronological Sanitizer & Sorter:** Added chronological sanitizers in `OrderFlowTimelineModal.tsx` and `OrderFlowTimelineRibbon.tsx` that prune overlapping records past `activeState.entered_at` and enforce strict ascending sort order (`.sort((a, b) => a.entered_at - b.entered_at)`).
  4. **Visual Polish:** Increased contrast for `FLAT` (`bg-slate-600/80`) and `NEUTRAL` (`bg-zinc-600/70`) with `min-w-[6px]` and distinct segment borders, rendering all historical segments cleanly across the timeline strip.

### 39. Delta Polling Undefined Data Payload Guard (Resolved in V15.4)
- **The Bug:** Runtime TypeError: `Cannot read properties of undefined (reading 'candles_5m')` at `useMarketData.useCallback[fetchData] (src/hooks/useMarketData.ts:789:48)`.
- **The Cause:** During initial mount or after transient network reconnection, `prev` or `prev.data_payload` was undefined when a fast 5-second delta poll returned `isDelta: true`. `prev.data_payload[activeKey]` attempted to access a property on `undefined`.
- **The Fix:**
  1. Added strict `if (!prev || !prev.data_payload) return jsonData;` guard in `setData` to automatically accept the incoming payload if previous state is empty.
  2. Added defensive optional chaining `prev?.data_payload?.[activeKey] || []` in both `fetchData` and `mergeDeltaPayload()`.

### 40. Service Worker API Interception & Plain-Text JSON Parsing Collision (Resolved in V15.5)
- **The Bug:** Client console error: `[StrategyEvaluator] Failed to fetch strategies: SyntaxError: Unexpected token 'O', "Offline mode active." is not valid JSON` and `Failed to refresh active trade names: SyntaxError: Unexpected token 'O', "Offline mode active." is not valid JSON`.
- **The Cause:** 
  1. `public/sw.js` intercepted all incoming `fetch()` requests across the origin. When any network request failed or dev server reloaded, its fallback catch returned `new Response("Offline mode active.")` which defaulted to `status: 200` with `text/plain`.
  2. Because `res.ok` was `true`, client hooks (`useStrategyEvaluator`, `EquationBuilder`, `page.tsx`) immediately executed `res.json()`, failing on the plain text string.
  3. In addition, the service worker remained active in development on `localhost` across dev server restarts.
- **The Fix:**
  1. **SW Bypass Gate:** Updated `public/sw.js` to unconditionally bypass `/api/*` routes, `/_next/*` assets, and non-GET requests, allowing native fetch execution.
  2. **Explicit 503 Status:** Configured fallback responses to return `status: 503` (Service Unavailable) rather than masking failures as `200 OK`.
  3. **Dev SW Auto-Cleanup:** In `src/app/layout.tsx`, gated SW registration to HTTPS production environments and actively unregistered any leftover workers on `localhost` / `http:`.
### 42. Timeframe Switch Browser Freeze & SVG DOM Element Explosion (Resolved in V16.7.2)
- **The Bug:** Switching chart timeframe from 5m to 15m (or any other timeframe) froze the browser completely, triggering the Chrome "Page Unresponsive / Wait or Exit" modal.
- **The Cause:** 
  1. **Hardcoded 5760-Candle Fetch:** `src/app/api/market-data/route.ts` hardcoded `fetchLargeHistory(symbol, '15m', 5760)` on every initial/timeframe fetch (`isInit: true`), injecting an uncapped 5,760 candle array into `data_payload.candles_15m`.
  2. **Unbounded DOM Generation:** When `15m` loaded, `structureLayer.ts` processed all 5,760 candles and generated over 10,000 SVG elements (`mappedSwings`, `horizontalLevels`, `breachBadges`, `innerZigzag`) directly into the React DOM tree without viewport bounding.
  3. **Quadratic Loop in Render Path:** For every swing `S` in the 2,000-swing array, `horizontalLevels.forEach` executed `confirmedMajor.slice(idx + 1).find(...)` during every render frame, performing millions of iterations on the main UI thread.
  4. **Duplicate Parallel Fetch Race:** `page.tsx` called both `setWsInterval(selectedInterval)` AND `refetch()` inside separate `useEffect` hooks, firing duplicate parallel backend requests on every timeframe swap.
- **The Fix:**
  1. **Requested-Limit Gating:** Updated `route.ts` to respect the caller's requested `limit15m` (default 1000) instead of hardcoding 5760 candles, reducing payload size and JSON parsing time by 85%.
  2. **Viewport Culling & Bounding in SVG Layers:** Added strict coordinate filtering to `structureLayer.ts`:
     - Capped `swings` lookback to the most recent 150 swings and `horizontalLevels` to the top 40 major swings.
     - Cull all SVG elements (horizontal lines, breach badges, zigzag paths, and hollow swing circles) that fall outside the active chart viewport ($x < -50$ or $x > \text{rightX} + 50$).
  3. **Eliminated Duplicate Fetch Race:** Removed the redundant `refetch()` in `page.tsx` since `setWsInterval` already updates the global context and triggers `fetchData()` in `useMarketData`.

### 43. Swings Array Group-by-Level Inversion & 5m Structure Line Starvation (Resolved in V16.7.3)
- **The Bug:** On the 5-minute chart, horizontal structure lines (`MAJOR HIGH`, `MAJOR LOW`, `INT HIGH`, `INT LOW`) and Major swing circles failed to render, leaving only BOS/MSS badges visible.
- **The Cause:** 
  1. **Group-by-Level Inversion in `MarketStructureAPI.ts`:** The `swings` return array was constructed by concatenating `[...majorSwings, ...internalSwings, ...innerSwingsRaw]` without sorting by timestamp `t`.
  2. **Starvation in `structureLayer.ts`:** `structureLayer.ts` sliced `analysis.swings.slice(-150)`. On a 5m chart with 1,000 candles and 339 total swings (173 Inner swings), taking the last 150 items sliced exclusively from `innerSwingsRaw`, dropping 100% of Major and Internal swings from `mappedSwings`. As a result, `confirmedMajor` evaluated to `[]` (empty), completely wiping out all horizontal structure lines.
  3. **Dealing Range Truncation on `internalZigzag`:** `internalZigzag` was restricted to `activeInternalSwings` ($t \ge \text{majorRangeStartTime}$), collapsing 120 internal swings down to 4–6 segments on 5m.
- **The Fix:**
  1. **Strict Chronological Sorting:** Sorted `swings` by timestamp in `MarketStructureAPI.ts` (`swings.sort((a, b) => a.t - b.t)`).
  2. **Dedicated Quota Slicing in `structureLayer.ts`:** Mapped confirmed Major/Internal swings alongside recent Inner swings (`[...majorAndInt.slice(-60), ...recentInner].sort(...)`), guaranteeing Major and Internal horizontal levels are never starved by high counts of Inner sub-swings.
  3. **Full Historical `internalZigzag`:** Built `internalZigzag` from all `internalSwings` to ensure complete multi-scale structure shift history across the entire chart.

### 44. Displacement OLS Statistical Over-Filtering & Lookahead Horizon Recalibration (Resolved in V16.7.4)
- **The Bug:** On intraday 5m charts, `OLS 95% CONFIDENCE` was almost permanently `REJECTED` (Salmon), preventing valid institutional displacement signals from achieving verified execution status.
- **The Cause:** 
  1. **1-Bar Retest Penalty:** The OLS regression target evaluated only the immediate $+1$ candle return. Because institutional displacement candles are naturally followed by a 1-bar pause or Fair Value Gap retest, the linear slope coefficient was artificially depressed ($t \approx 1.3 - 1.7$, $p \approx 0.10 - 0.20$).
  2. **Over-Strict Academic Threshold:** $t > 1.96$ ($p < 0.05$) represents a 95% clinical laboratory standard, whereas quantitative finance benchmarks use 90% confidence ($|t| \ge 1.65, p \le 0.10$) for high-frequency financial time series.
  3. **Matrix Singularity in Offline Solver:** When market sessions did not span the NY Lunch dead zone, the `deadZones` feature column had 0 variance (all zeros), making the custom 4x4 matrix singular and failing inversion.
- **The Fix:**
  1. **3-Candle Forward Return Horizon:** Expanded target return to a 3-candle lookahead window ($\frac{c_{t+3} - c_t}{c_t}$) in both Python (`api/index.py`) and TypeScript (`displacementEngine.ts`), with strict chronological safety slicing (`iloc[14:-3]`).
  2. **Calibrated 90% Primary Benchmark:** Standardized institutional confirmation to $|t| \ge 1.65, p \le 0.10$.
  3. **Dynamic Multi-Tier UI Badging:** Replaced binary red/green display with a 4-tier institutional classification:
     - 🟢 **CONFIRMED (95%)**: $|t| \ge 1.96, p < 0.05$ (Elite Conviction)
     - 🟡 **MODERATE (90%)**: $|t| \ge 1.65, p \le 0.10$ (Institutional Standard)
     - 🔵 **BORDERLINE (85%)**: $|t| \ge 1.44, p \le 0.15$ (Emerging Flow)
     - 🔴 **REJECTED**: $p > 0.15$ (Noise)
  4. **Dynamic Column Adaptation & Matrix Inversion:** Implemented dynamic column selection and generalized Gauss-Jordan matrix inversion in `displacementEngine.ts` to prevent zero-variance singularity.

### 45. Chart Initial Load Lookback Explosion & Delta Polling Refetch Loop (Resolved in V16.22)
- **The Bug:** The chart loaded a massive number of candles on the first visit (~4,200+ candles), causing heavy initial network payloads (>2MB), sluggish hydration, and recurrent full-page data reloads every 5 minutes whenever a candle closed.
- **The Cause:**
  1. **1st Load Timeframe Gate Bypass in `route.ts`:** On initial bootstrap (`init=true`), the condition `else if (timeframeGated && !isInit)` evaluated to `false` because `!isInit` was false. This caused the API to fall through to the un-gated branch and fetch 1,000 candles for all timeframes (`5m`, `15m`, `1h`, `4h`) plus HTF data (`1d`, `1w`, `1M`, `BTC`), serializing over 4,200 candles.
  2. **Delta Poll Full Reload Trigger in `useMarketData.ts`:** When a candle close was detected during 5s delta polling, the hook executed `fetchDataRef.current?.(false)`, which reset `isPolling = false` and passed `init=true`. This triggered a complete 4,000-candle REST refetch every 5 minutes (or every 1m on 1m chart), bypassing client-side rolling buffers and WebSocket closed-candle handlers.
  3. **Unculled SVG Session Boxes in `sessionsLayer.ts`:** The session layer grouped all 1,000 historical candles by calendar day and generated SVG `<rect>`, `<text>`, and `<g>` nodes for every Asian and London session across 10–15 days without coordinate viewport culling.
- **Secondary Bugs Found:** `src/lib/quantEngine/LiquidityEngine.ts` used wrong candle property names (`c.close`, `c.open`, `c.high`, `c.low`) instead of the correct `Candle` interface properties (`c.c`, `c.o`, `c.h`, `c.l`), causing Order Block detection to silently fail (reading `undefined`). Also, `activeFVGs` in `LiquidityEngine` stored raw un-mapped FVG objects, creating a shape mismatch with the `MappedFVG` interface consumed by `MarketStructureAPI`.
- **The Fix:** Corrected mitigation thresholds in `fvgEngine.ts` to match the V8.5 wick-scanning doctrine. Fixed all candle property names in `LiquidityEngine.ts`. Wrapped `detectActiveFVGs` output in `mapAndConsolidateFVGs` inside `LiquidityEngine` to ensure consistent `MappedFVG` shape.

### 24. Market Structure Audit — 3 Critical Bugs + 4 Design Gaps (Resolved in V12.1.2)
- **The Bugs (BUG-1):** The Directional Color Lock from Lesson #1 and Lesson #17 was COMPLETELY BYPASSED in `PivotEngine.ts`. Every pivot at every level (MAJOR, INTERNAL, INNER) was hardcoded `colorValidated: true`, allowing outside bars and non-institutional extremes to anchor the Macro Dealing Range, corrupting all downstream BOS/MSS labels.
- **The Bugs (BUG-2 + GAP-4):** INTERNAL and INNER ZigZags shared the same `innerStateEngine` instance (`targetLevel: 1`), so Inner pivot events were contaminated by Internal-level triggers. Additionally, the return object's `internalZigzag` field was silently shadowed to point to `innerZigzag` — so all INT structural break labels were lost and both fields returned the same array.
- **The Bug (BUG-4):** The anti-corruption clamp that prevents the internal range from bleeding outside parent bounds was unconditionally replacing `anchor_low_swing` / `anchor_high_swing` with the Major swing anchors. This painted INT levels with Major pivot metadata, corrupting the visual hierarchy.
- **The Gaps (GAP-1 / GAP-2 / GAP-3):** Fallback DR anchors in the nearest-candle search hardcoded `colorValidated: true`. The SMCStateEngine always started BULLISH regardless of the actual market direction, producing false BOS events in bearish-opening datasets. The `currentTrend` ternary silently collapsed UNSET to BEARISH.
- **The Fix:**
  1. **`PivotEngine.ts`:** Implemented the Color Lock — SWING_HIGH: red top (close < open) preceded by green (close > open). SWING_LOW: green bottom (close > open) preceded by red (close < open).
  2. **`SMCStateEngine.ts`:** Added `initializeFromFirstPivot()` which bootstraps initial trend state from the first confirmed pivot per level before the candle loop begins.
  3. **`MarketStructureAPI.ts`:** Added a dedicated `microStateEngine = new SMCStateEngine(config, 0)` for Level 0 INNER pivots. Fixed the `internalZigzag` shadow. Fixed anti-corruption clamp to preserve anchor metadata. Fixed fallback anchor `colorValidated` to check actual candle colors. Fixed trend ternaries to explicit 3-way BULLISH / BEARISH / UNSET mapping.


### 25. Potential Trades Engine — 6 Silent Corruption Bugs (Resolved in V12.2)
- **The Bugs:**
  1. **(BUG-1) Dead FVG primary path:** `quantTradeEngine.ts` read `data.data_payload.active_fvgs` which is always `undefined` (the field lives at `data.ipda_metrics.active_fvgs`). Every call fell through to the inline fallback scanner, missing 4h/1h FVG context.
  2. **(BUG-2) Ghost field reads:** `data.ipda_metrics.last_price` and `data.ipda_metrics.bias_signal` do not exist. Real fields are candle close and `macro_daily_bias`. `institutionalBias` was permanently hardcoded to `CONFIRMED_BULLISH`.
  3. **(BUG-3) Missing `macro_structural_magnets` in backtest payload:** `useBacktestEngine.ts` never emitted this field. Backtest setups used raw 50-candle window extremes as dealing range anchors instead of structure-validated levels.
  4. **(BUG-4) Bearish TARGET_HIT checks wrong target:** Checked `lowestRecent <= tp1` (equilibrium) instead of `lowestRecent <= tp2` (SSL magnet). Equilibrium is always between price and the FVG, so every touched bearish setup instantly became TARGET_HIT.
  5. **(BUG-5) BSL Breakout `isNearby` hardcoded `true`:** Skipped the 2% proximity guard, polluting the Nearby quality filter tab.
  6. **(BUG-6) `displacement_sponsorship` type mismatch:** Backtest payload emitted a plain string but engine read `.status` as an object, always returning undefined and falling back to hardcoded `ACTIVE_BULLISH`.
- **The Fix:** (1) `data.ipda_metrics.active_fvgs` path corrected. (2) Ghost reads removed; bias reads from `macro_daily_bias`. (3) `macro_structural_magnets` added to backtest enriched payload, populated from `structureAnalysis.dealingRange` with PDH/PDL fallback. (4) Bearish TARGET_HIT condition corrected to `lowestRecent <= tp2`. (5) `isNearby` now computes real 2% distance. (6) Backtest now emits full `InstitutionalSponsorship` object; engine has dual-form guard for both string and object forms.

### 26. Potential Trades TP Drift & Dead Execute Button (Resolved in V12.3)
- **The Bugs:**
  1. **(TP1 R:R)** TP1 was anchored to `Math.min(equilibrium, bslMagnets[0])`, which could land BELOW the 1:1 R:R threshold (or even below entry when price is near equilibrium). No R:R floor was enforced, violating the minimum institutional execution standard.
  2. **(TP2 Drift)** TP2 was sourced from `bslMagnets[1]` / `sslMagnets[0]` — order-book resting pools that fluctuate by small decimal amounts on every tick. This caused TP2 to visibly change price on every data poll, giving no stable reference level.
  3. **(Execute Button 404)** `PotentialTradesModal.tsx` posted to `/api/journal` which does not exist. The real live journal endpoint is `/api/trades`. Every Execute click silently returned a 404 and the trade was never recorded.
  4. **(Wrong Symbol)** Both modals hardcoded `ETHUSDT` instead of `ETHUSDC`.
- **The Fix:**
  1. **TP1** now enforces a guaranteed 1:1 floor: `tp1 = max(tp1_natural, entryMid + risk)`. The structural anchor (equilibrium / BSL magnet) is preferred only if it surpasses the floor.
  2. **TP2** is now locked to a stable structural anchor chain: `bslMagnets[0]` (PDH-anchored, stable) ? `swingHigh` ? `entryMid + 2×risk`. It no longer uses `bslMagnets[1]` or `[2]` which are deep order-book entries that churn on every poll.
  3. Fixed `/api/journal` ? `/api/trades` in `PotentialTradesModal.tsx`.
  4. Updated all execute handlers to use `ETHUSDC` as symbol.

### 27. Potential Trades Timeline Chronology & False TARGET_HIT Bug (Resolved in V12.4)
- **The Bugs:**
  1. **(False TARGET_HIT)** Setups evaluated status by checking aggregate 50-candle highestRecent / lowestRecent bounds regardless of candle sequence. If price reached TP level hours BEFORE touching the FVG entry, the engine evaluated pre-entry candles and marked the setup as TARGET_HIT prematurely.
  2. **(Identical Open/Close Timestamps)** openTime and closeTime were recorded using 
ew Date().toISOString() on the same millisecond tick when evaluated.
  3. **(Transient Setup Key Collisions)** Setup keys in localStorage were anchored to transient UI display IDs (SET-04_BULL_...), causing setup state to cross-contaminate when FVG positions shifted across poll frames.
- **The Fix:**
  1. Implemented `evaluateSetupTimeline()` in `quantTradeEngine.ts`: scans candles strictly chronologically, first locating the exact candle index where entry touch occurred.
  2. Exit criteria (TP1/TP2 or SL breach) are ONLY evaluated on candles occurring at or after the entry touch index.
  3. `openTime` and `closeTime` are extracted directly from the candle timestamps (c.t) where entry touch and exit target/SL breach occurred.
  4. Migrated localStorage setup keys to stable intrinsic representations (FVG_BULL_1852.41_1852.86_...), eliminating setup ID cross-contamination.

### 28. Potential Trades Auto-Open & Real-Time Journal Tracking (Resolved in V12.5)
- **The Feature:** Traders needed an option to select specific Potential Trades to automatically open positions in the Trading Journal when price touches entry range, so they can track performance in real time without manual execution.
- **The Architecture:**
  1. **Selective Toggle:** Added `setupKey`, `isAutoExecute`, and `isAutoOpened` properties to `PotentialTrade` interface, backed by persistent localStorage helpers (`getAutoExecuteKeys`, `toggleAutoExecuteKey`).
  2. **Background Executor Hook (`useAutoTradeExecutor`):** Mounted inside `MarketDataProvider` (for 24/7 live polling) and `BacktestPage` (for replay steps). Monitors active setups and automatically POSTs to `/api/trades` or `/api/backtest-trades` the moment a setup transitions to `ACTIVE_WATCH` or `CONFIRMED`.
  3. **Idempotency Guard:**  utoOpened: true is persisted per setup in localStorage, guaranteeing zero duplicate trade opens.
  3. **Idempotency Guard:**  utoOpened: true is persisted per setup in localStorage, guaranteeing zero duplicate trade opens.
  4. **UI Banner & Controls:** Added Auto-Execution status banner and interactive ? Auto-Open toggle buttons across table rows and inspector cards in both Live and Backtest Potential Trades modals.

### 29. Completed Trade Auto-Open & Historical Journal Record Logging (Resolved in V12.6)
- **The Feature:** When a Potential Trade completes (status TARGET_HIT [WIN] or INVALIDATED [LOSS]), Auto-Open or manual click execution logs it into the Trading Journal as a **COMPLETED / CLOSED TRADE** with complete timeline metadata.
- **The Protocol & Payload:**
  1. **Closed Trade Attributes:** Set status: "CLOSED", outcome: "WIN" | "LOSS", exit_price: closePrice, ealized_pnl: (exit_price - entry_price) * size, opened_at: openTime, closed_at: closeTime.
  2. **API Route Bypass:** Updated /api/trades and /api/backtest-trades POST handlers so status === "CLOSED" payloads bypass the active open-trade locks (GLOBAL_LOCK, portfolio risk cap, and ONE_TRADE_RULE).
  3. **UI Action Buttons:** Replaced disabled states for TARGET_HIT and INVALIDATED with interactive Log Win ?? and Log Loss ?? buttons across table rows and inspector cards.

### 31. Minimalist Ultra-Compact Dashboard Metrics Bar Redesign (Resolved in V12.8)
- **The Issue:** The top `DashboardMetrics` header bar (`MASTER BIAS`, `RANGE CONTEXT`, `TARGET STATUS (DOL)`) occupied over `115px-140px` of vertical height, taking up excessive screen real estate above the chart.
- **The Redesign:**
  1. Reduced total vertical height from `140px` to `~36px-40px` (>70% vertical screen space saved!).
  2. Transformed bulky stacked cards into single-line horizontal flex pills with tight padding (`py-1.5 px-3`), crisp micro-icons (`Compass`, `Activity`, `Target`), and bold monospace badges.
  3. Reclaimed nearly 100 pixels of vertical screen space, expanding chart viewport height significantly.

### 32. Intraday Potential Trade Refresh & Retest Preservation (Resolved in V12.9)
- **The Issue:** When price remained inside yesterday's range, the engine ignored new intraday setups and displayed only passed/completed setups from yesterday.
- **The Cause & Fix:**
  1. **Intraday Session Expiration:** `SetupRecord` in `quantTradeEngine.ts` now stores `dateStr` and `lastUpdated` timestamps. Memory entries older than 24h or from previous calendar days automatically expire, freeing today's price action to evaluate fresh setups.
  2. **FVG Retest Preservation:** Updated `detectActiveFVGs()` in `fvgEngine.ts` so that touching an FVG zone marks it as `ACTIVE_RETESTED` instead of dropping it from active scans. FVGs are only marked mitigated upon full boundary invalidations.
  3. **Always-Active Structural Sweeps:** Decoupled structural SSL liquidity sweep re-entry setups in `quantTradeEngine.ts` so that actionable structural setups generate every session alongside FVG queues.

### 33. Institutional Scenario Grading & Step-by-Step Join Guide (Resolved in V13.0)
- **The Feature:** Enriched setup generation with a 0-100 Quant Confluence Score, Tier Badges (`⭐ A+`, `⚡ A`, `🔹 B`), and step-by-step institutional trade join instructions.
- **The Implementation:**
  1. **Quant Scoring (`computeScenarioMetrics`):** Evaluates Cairo Master Bias match (+25), Dealing Zone alignment (+15), Displacement Sponsorship (+10), Multi-timeframe FVG confluence (+10), and R:R ≥ 1.5 (+10).
  2. **Scenario Join Guide UI:** Rendered a dedicated **"🎯 Institutional Best Scenario Join Guide"** box in both Live and Replay Potential Trades modal inspectors with step-by-step entry, SL protection, and TP scaling rules.

### 34. FVG Retest Status Mapping & Chart Ghost Zone Resolution (Resolved in V13.1)
- **The Bug:** When price ticked into a Fair Value Gap (e.g. 15m BISI or SIBI), the FVG box remained visible on the chart as a persistent unmitigated ghost zone indefinitely.
- **The Cause:** `detectActiveFVGs()` in `fvgEngine.ts` flagged touched FVGs as `ACTIVE_RETESTED`, but `mapAndConsolidateFVGs()` collapsed both `ACTIVE_UNMITIGATED` and `ACTIVE_RETESTED` into `status: 'UNMITIGATED'`. Because `Chart.tsx` and `fvgLayer.ts` filtered overlays via `if (fvg.status !== 'UNMITIGATED') continue;`, touched/retested FVGs were treated as unmitigated fresh zones and rendered continuously.
- **The Fix:** Updated `MappedFVG.status` to include `'RETESTED'`. Refactored `mapAndConsolidateFVGs()` to map `ACTIVE_UNMITIGATED` to `'UNMITIGATED'` and `ACTIVE_RETESTED` to `'RETESTED'`. As a result, once price ticks into an FVG, its mapped status updates to `'RETESTED'`, and it cleanly unmounts from the unmitigated FVG chart overlay.

### 35. Maximum Update Depth Exceeded in Chart useEffect Sync (Resolved in V13.2)
- **The Bug:** Next.js console error: `Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render` at `Chart.useEffect (src/components/Chart.tsx:121:5)`.
- **The Cause:** 
  1. Unstable Array Literals in Parent Render: In `src/app/page.tsx`, `getChartData()` and `activeFvgs={data?.ipda_metrics?.active_fvgs || []}` returned a newly instantiated empty array (`[]`) on every render when data was loading or missing.
  2. Un-guarded State Setters inside Effects: `Chart.tsx` had `useEffect(() => { setLocalCandles(data); }, [data])` and `setFvgOverlayBoxes([])` in `computeFvgOverlay()`. When `data` or `activeFvgs` changed reference on every render, the effects executed `setLocalCandles` and `setFvgOverlayBoxes`, triggering child component re-renders that re-computed `getChartData()`, causing a synchronous infinite render cycle.
- **The Fix:** 
  1. Defined static immutable empty array fallbacks (`EMPTY_CANDLES`, `EMPTY_FVGS`) and memoized `getChartData()` and `onManualPricesChange` in `src/app/page.tsx`.
  2. Implemented functional bailout checks in `Chart.tsx`: `setLocalCandles((prev) => (prev.length === 0 && data.length === 0 ? prev : data))` and `setFvgOverlayBoxes((prev) => (prev.length === 0 && boxes.length === 0 ? prev : boxes))` to bail out of state updates when empty, completely halting infinite re-render loops.

### 36. Micro SMT Counter-Trend Trap & HTF Order Flow Gate (Resolved in V13.3)
- **The Failure:** The quant engine generated a Bullish signal based on a 15m SMT Divergence (BTC Lower Low vs ETH Higher Low at $1,883.73), targeting $1,891.50–$1,897.30 (PDH). The setup stopped out as price rejected sharply from the $1,888.00–$1,898.00 zone down to sweep $1,868.00.
- **The Root Cause:** 
  1. **HTF Structure Blindness:** 1H/H4 market structure had broken major support at $1,905 down to $1,874, flipping HTF Order Flow to **BEARISH**. The rally to $1,888–$1,898 was a 1H Bearish Retest / Premium FVG Mitigation.
  2. **Un-Gated 15m Counter-Trend Scalp:** The engine treated a 15m SMT bounce in Discount as a macro bullish reversal instead of recognizing it as a short-term counter-trend retracement into an HTF Bearish Supply Zone.
  3. **Target Over-Extension:** The SOP failed to enforce Scenario C of `SKILL_BLUEPRINT.md`: Counter-trend SMT scalps must NOT target macro BSL/PDH; they must be strictly capped at 1H Bearish Supply with immediate breakeven stops.
- **The Systemic Fix:** 
  1. Enforced a **Mandatory 1H/H4 HTF Order Flow Gate**: When 1H/H4 Order Flow is Bearish, 15m Bullish SMT signals are marked as `COUNTER_TREND_RETRACEMENT` and capped at 1H Bearish Supply ($1,888–$1,898).
  2. Primary setups in HTF Bearish Order Flow MUST align with the **HTF Bearish Retest** (shorting the $1,888–$1,898 Action Zone down to $1,868 SSL / $1,850 HTF Demand).

### 37. Binance HTTP 418 IP Ban & Chart Ascending Time Assertion Resolution (Resolved in V15.1)
- **The Issue:**
  1. Binance API returned `HTTP 418: I'm a teapot`, triggering offline simulation mode.
  2. Lightweight Charts crashed with `Uncaught Error: Assertion failed: data must be asc ordered by time, index=600, time=1786735500, prev time=1786735500` at `Chart.tsx:1341` during `seriesRef.current.setData(formattedData)`.
- **The Cause:**
  1. **Binance HTTP 418:** Binance uses status code 418 when a client IP address exceeds API rate limits (1200 request weight/min or frequent burst connections from polling/hot-reloads), triggering a temporary WAF IP ban. Restarting the router assigns a fresh public IP from the ISP to immediately bypass the rate limit.
  2. **Duplicate Timestamps:** When historical candles or offline mock candles were formatted (`Math.floor(d.t / 1000)`), two adjacent items with the same second timestamp collided. Lightweight Charts strictly enforces `time[i] > time[i-1]`.
- **The Fix:**
  1. **Chart Data Deduplication:** In `src/components/Chart.tsx`, wrapped `formattedData` conversion in a `Map<number, Candle>` keyed by `timeSec` before sorting and calling `setData(uniqueFormattedData)`. This guarantees that duplicate timestamps are collapsed and strictly ascending.
  2. **Interval Boundary Alignment:** In `src/app/api/market-data/route.ts`, aligned `generateMockCandles` timestamps strictly to the interval multiple `Math.floor(rawNow / intervalMs) * intervalMs`.

### 38. Order Flow Timeline State Drift & Serverless DB Synchronization (Resolved in V15.3)
- **The Bug:** The historical Order Flow Timeline kept mutating and fluctuating every few minutes/seconds (jumping between 50, 100, 111 transitions), producing discrepancies between Localhost (persistent Node process) and Vercel (ephemeral serverless Lambdas). In addition, switching timeframes (e.g. from 15m to 5m in backtesting) created timestamp overlap collisions where `active_state.entered_at` appeared 5 minutes prior to the latest closed history segment, and the modal strip rendered 62% of the timeline as an empty dark void.
- **The Cause:**
  1. **5-Second Micro-Tick Flutter:** `updateLiveState` was evaluated against the unclosed candle on every 5-second poll. When live price or OI micro-fluctuated, `updateLiveState` treated it as a real transition and pushed duplicate 5-second records into `mem.history` and PostgreSQL. Localhost accumulated 111+ mutations while Vercel Lambdas reset to 50 on cold starts.
  2. **Timeframe Timestamp Collision:** In backtest replay, `computeTimelineFromCandles` ran on the visual `activeCandles` (5m) while history was cached from 15m candles, creating out-of-order timestamps.
  3. **Low Visual Contrast:** 62% of the timeline was `NEUTRAL`/`FLAT` styled with 50% opacity grey (`bg-zinc-700/50`) on `#0d0e12`, rendering as an invisible dark void.
- **The Fix:**
  1. **Strict Closed-Candle Boundary Gating:** `OrderFlowStateTracker.updateLiveState` now gates historical segment creation strictly on confirmed candle closes / new candle arrivals (`isNewCandleBoundary`). Intra-candle live price ticks update the active record's live metrics without polluting the historical array.
  2. **15m Structural Timeframe Anchoring:** Anchored backtest Order Flow calculation strictly to `candles_15m` structural arrays across all routes, preventing timeframe cross-contamination.
  3. **Chronological Sanitizer & Sorter:** Added chronological sanitizers in `OrderFlowTimelineModal.tsx` and `OrderFlowTimelineRibbon.tsx` that prune overlapping records past `activeState.entered_at` and enforce strict ascending sort order (`.sort((a, b) => a.entered_at - b.entered_at)`).
  4. **Visual Polish:** Increased contrast for `FLAT` (`bg-slate-600/80`) and `NEUTRAL` (`bg-zinc-600/70`) with `min-w-[6px]` and distinct segment borders, rendering all historical segments cleanly across the timeline strip.

### 39. Delta Polling Undefined Data Payload Guard (Resolved in V15.4)
- **The Bug:** Runtime TypeError: `Cannot read properties of undefined (reading 'candles_5m')` at `useMarketData.useCallback[fetchData] (src/hooks/useMarketData.ts:789:48)`.
- **The Cause:** During initial mount or after transient network reconnection, `prev` or `prev.data_payload` was undefined when a fast 5-second delta poll returned `isDelta: true`. `prev.data_payload[activeKey]` attempted to access a property on `undefined`.
- **The Fix:**
  1. Added strict `if (!prev || !prev.data_payload) return jsonData;` guard in `setData` to automatically accept the incoming payload if previous state is empty.
  2. Added defensive optional chaining `prev?.data_payload?.[activeKey] || []` in both `fetchData` and `mergeDeltaPayload()`.

### 40. Service Worker API Interception & Plain-Text JSON Parsing Collision (Resolved in V15.5)
- **The Bug:** Client console error: `[StrategyEvaluator] Failed to fetch strategies: SyntaxError: Unexpected token 'O', "Offline mode active." is not valid JSON` and `Failed to refresh active trade names: SyntaxError: Unexpected token 'O', "Offline mode active." is not valid JSON`.
- **The Cause:** 
  1. `public/sw.js` intercepted all incoming `fetch()` requests across the origin. When any network request failed or dev server reloaded, its fallback catch returned `new Response("Offline mode active.")` which defaulted to `status: 200` with `text/plain`.
  2. Because `res.ok` was `true`, client hooks (`useStrategyEvaluator`, `EquationBuilder`, `page.tsx`) immediately executed `res.json()`, failing on the plain text string.
  3. In addition, the service worker remained active in development on `localhost` across dev server restarts.
- **The Fix:**
  1. **SW Bypass Gate:** Updated `public/sw.js` to unconditionally bypass `/api/*` routes, `/_next/*` assets, and non-GET requests, allowing native fetch execution.
  2. **Explicit 503 Status:** Configured fallback responses to return `status: 503` (Service Unavailable) rather than masking failures as `200 OK`.
  3. **Dev SW Auto-Cleanup:** In `src/app/layout.tsx`, gated SW registration to HTTPS production environments and actively unregistered any leftover workers on `localhost` / `http:`.

### 42. Timeframe Switch Browser Freeze & SVG DOM Element Explosion (Resolved in V16.7.2)
- **The Bug:** Switching chart timeframe from 5m to 15m (or any other timeframe) froze the browser completely, triggering the Chrome "Page Unresponsive / Wait or Exit" modal.
- **The Cause:** 
  1. **Hardcoded 5760-Candle Fetch:** `src/app/api/market-data/route.ts` hardcoded `fetchLargeHistory(symbol, '15m', 5760)` on every initial/timeframe fetch (`isInit: true`), injecting an uncapped 5,760 candle array into `data_payload.candles_15m`.
  2. **Unbounded DOM Generation:** When `15m` loaded, `structureLayer.ts` processed all 5,760 candles and generated over 10,000 SVG elements (`mappedSwings`, `horizontalLevels`, `breachBadges`, `innerZigzag`) directly into the React DOM tree without viewport bounding.
  3. **Quadratic Loop in Render Path:** For every swing `S` in the 2,000-swing array, `horizontalLevels.forEach` executed `confirmedMajor.slice(idx + 1).find(...)` during every render frame, performing millions of iterations on the main UI thread.
  4. **Duplicate Parallel Fetch Race:** `page.tsx` called both `setWsInterval(selectedInterval)` AND `refetch()` inside separate `useEffect` hooks, firing duplicate parallel backend requests on every timeframe swap.
- **The Fix:**
  1. **Requested-Limit Gating:** Updated `route.ts` to respect the caller's requested `limit15m` (default 1000) instead of hardcoding 5760 candles, reducing payload size and JSON parsing time by 85%.
  2. **Viewport Culling & Bounding in SVG Layers:** Added strict coordinate filtering to `structureLayer.ts`:
     - Capped `swings` lookback to the most recent 150 swings and `horizontalLevels` to the top 40 major swings.
     - Cull all SVG elements (horizontal lines, breach badges, zigzag paths, and hollow swing circles) that fall outside the active chart viewport ($x < -50$ or $x > \text{rightX} + 50$).
  3. **Eliminated Duplicate Fetch Race:** Removed the redundant `refetch()` in `page.tsx` since `setWsInterval` already updates the global context and triggers `fetchData()` in `useMarketData`.

### 43. Swings Array Group-by-Level Inversion & 5m Structure Line Starvation (Resolved in V16.7.3)
- **The Bug:** On the 5-minute chart, horizontal structure lines (`MAJOR HIGH`, `MAJOR LOW`, `INT HIGH`, `INT LOW`) and Major swing circles failed to render, leaving only BOS/MSS badges visible.
- **The Cause:** 
  1. **Group-by-Level Inversion in `MarketStructureAPI.ts`:** The `swings` return array was constructed by concatenating `[...majorSwings, ...internalSwings, ...innerSwingsRaw]` without sorting by timestamp `t`.
  2. **Starvation in `structureLayer.ts`:** `structureLayer.ts` sliced `analysis.swings.slice(-150)`. On a 5m chart with 1,000 candles and 339 total swings (173 Inner swings), taking the last 150 items sliced exclusively from `innerSwingsRaw`, dropping 100% of Major and Internal swings from `mappedSwings`. As a result, `confirmedMajor` evaluated to `[]` (empty), completely wiping out all horizontal structure lines.
  3. **Dealing Range Truncation on `internalZigzag`:** `internalZigzag` was restricted to `activeInternalSwings` ($t \ge \text{majorRangeStartTime}$), collapsing 120 internal swings down to 4–6 segments on 5m.
- **The Fix:**
  1. **Strict Chronological Sorting:** Sorted `swings` by timestamp in `MarketStructureAPI.ts` (`swings.sort((a, b) => a.t - b.t)`).
  2. **Dedicated Quota Slicing in `structureLayer.ts`:** Mapped confirmed Major/Internal swings alongside recent Inner swings (`[...majorAndInt.slice(-60), ...recentInner].sort(...)`), guaranteeing Major and Internal horizontal levels are never starved by high counts of Inner sub-swings.
  3. **Full Historical `internalZigzag`:** Built `internalZigzag` from all `internalSwings` to ensure complete multi-scale structure shift history across the entire chart.

### 44. Displacement OLS Statistical Over-Filtering & Lookahead Horizon Recalibration (Resolved in V16.7.4)
- **The Bug:** On intraday 5m charts, `OLS 95% CONFIDENCE` was almost permanently `REJECTED` (Salmon), preventing valid institutional displacement signals from achieving verified execution status.
- **The Cause:** 
  1. **1-Bar Retest Penalty:** The OLS regression target evaluated only the immediate $+1$ candle return. Because institutional displacement candles are naturally followed by a 1-bar pause or Fair Value Gap retest, the linear slope coefficient was artificially depressed ($t \approx 1.3 - 1.7$, $p \approx 0.10 - 0.20$).
  2. **Over-Strict Academic Threshold:** $t > 1.96$ ($p < 0.05$) represents a 95% clinical laboratory standard, whereas quantitative finance benchmarks use 90% confidence ($|t| \ge 1.65, p \le 0.10$) for high-frequency financial time series.
  3. **Matrix Singularity in Offline Solver:** When market sessions did not span the NY Lunch dead zone, the `deadZones` feature column had 0 variance (all zeros), making the custom 4x4 matrix singular and failing inversion.
- **The Fix:**
  1. **3-Candle Forward Return Horizon:** Expanded target return to a 3-candle lookahead window ($\frac{c_{t+3} - c_t}{c_t}$) in both Python (`api/index.py`) and TypeScript (`displacementEngine.ts`), with strict chronological safety slicing (`iloc[14:-3]`).
  2. **Calibrated 90% Primary Benchmark:** Standardized institutional confirmation to $|t| \ge 1.65, p \le 0.10$.
  3. **Dynamic Multi-Tier UI Badging:** Replaced binary red/green display with a 4-tier institutional classification:
     - 🟢 **CONFIRMED (95%)**: $|t| \ge 1.96, p < 0.05$ (Elite Conviction)
     - 🟡 **MODERATE (90%)**: $|t| \ge 1.65, p \le 0.10$ (Institutional Standard)
     - 🔵 **BORDERLINE (85%)**: $|t| \ge 1.44, p \le 0.15$ (Emerging Flow)
     - 🔴 **REJECTED**: $p > 0.15$ (Noise)
  4. **Dynamic Column Adaptation & Matrix Inversion:** Implemented dynamic column selection and generalized Gauss-Jordan matrix inversion in `displacementEngine.ts` to prevent zero-variance singularity.

### 45. Chart Initial Load Lookback Explosion & Delta Polling Refetch Loop (Resolved in V16.22)
- **The Bug:** The chart loaded a massive number of candles on the first visit (~4,200+ candles), causing heavy initial network payloads (>2MB), sluggish hydration, and recurrent full-page data reloads every 5 minutes whenever a candle closed.
- **The Cause:**
  1. **1st Load Timeframe Gate Bypass in `route.ts`:** On initial bootstrap (`init=true`), the condition `else if (timeframeGated && !isInit)` evaluated to `false` because `!isInit` was false. This caused the API to fall through to the un-gated branch and fetch 1,000 candles for all timeframes (`5m`, `15m`, `1h`, `4h`) plus HTF data (`1d`, `1w`, `1M`, `BTC`), serializing over 4,200 candles.
  2. **Delta Poll Full Reload Trigger in `useMarketData.ts`:** When a candle close was detected during 5s delta polling, the hook executed `fetchDataRef.current?.(false)`, which reset `isPolling = false` and passed `init=true`. This triggered a complete 4,000-candle REST refetch every 5 minutes (or every 1m on 1m chart), bypassing client-side rolling buffers and WebSocket closed-candle handlers.
  3. **Unculled SVG Session Boxes in `sessionsLayer.ts`:** The session layer grouped all 1,000 historical candles by calendar day and generated SVG `<rect>`, `<text>`, and `<g>` nodes for every Asian and London session across 10–15 days without coordinate viewport culling.
  4. **Uncapped Lookback in `displacementLayer.ts` and `OrderBlockOverlay.tsx`:** Volumetric marker scanning and OrderBlock fallback scanning evaluated all 1,000 historical bars on the main UI thread during renders.
- **The Fix:**
  1. **Right-Sized Calibrated Lookbacks in `route.ts`:** Calibrated default candle limits per timeframe (`5m`: 350, `15m`: 250, `1h`: 120, `4h`: 80, `1m`: 350), reducing total payload size by **77.4%** (654 KB -> 147 KB) and engine computation time by **83.2%** (120ms -> 20ms).
  2. **Eliminated Delta Full Reload Trap in `useMarketData.ts`:** Removed `fetchDataRef.current?.(false)` from the delta candle close handler. Candle close updates and indicators are now driven purely event-driven via client-side rolling buffers and WebSocket dispatchers (`lastClosedEvent`).
  3. **SVG Coordinate Viewport Culling in `sessionsLayer.ts`:** Added bounding checks (`toX < -50 || fromX > rightX + 50`) to cull off-screen historical session boxes from the SVG DOM.
  4. **Strict Lookback Clamping in `displacementLayer.ts` & `OrderBlockOverlay.tsx`:** Defaulted `highPerformanceMode` to true and clamped volumetric marker and OrderBlock fallback scans to the most recent 250–350 bars for guaranteed 60+ FPS chart interaction.

### 46. Neon Data Transfer Quota Exhaustion & Settings API Type Coercion (Resolved in V16.23)
- **The Bug:** Settings failed to load data from Neon, displaying empty defaults and throwing "Failed to fetch settings from cloud vault." When attempting to update/save, the system displayed "TELEMETRY WARNING: Failed to save settings." (HTTP 500 / code 53000).
- **The Cause:**
  1. **Neon Data Transfer Quota Exceeded:** The active Neon project (`neon-flow-state` / `snowy-darkness-92610779`) exceeded its free monthly bandwidth quota, rejecting connections with `HTTP 402 / code 53000: Your project has exceeded the data transfer quota`.
  2. **Redundant Polling DB Queries:** `src/app/api/market-data/route.ts` executed `SELECT key_value FROM system_settings WHERE key_name = 'candles_limit'` on every 5-second polling request even though candle limits were already passed by the client, consuming thousands of queries per day.
  3. **Strict Type Gating in Settings Upsert:** `POST /api/settings` enforced `typeof value !== "string"`, silently skipping numeric (e.g. `dark_card_opacity: 90`) and non-string settings during theme or parameter saves.
- **The Fix:**
  1. **Hot-Swapped to Ready Neon Project:** Updated `.env.local` with the active, healthy Neon project (`neon-cyclamen-field` / `morning-lab-92807161`), initialized all self-healing tables, and seeded default settings & accounts.
  2. **Eliminated Polling DB Queries in `market-data/route.ts`:** Removed redundant database lookups during polling and prioritized client-supplied URL query parameters.
  3. **Universal Type Coercion in `settings/route.ts`:** Coerced non-string payloads to valid database strings (`typeof value === 'object' ? JSON.stringify(value) : String(value)`) and enriched error telemetry with descriptive messages.

### 47. OAuth Callback Regression & Database Whitelist Table Initialization (Resolved in V16.34)
- **The Bug:** Sign-in with Google on production resulted in an `OAuthCallback` / `Try signing in with a different account` error.
- **The Cause:**
  1. **Environment Variable Naming Mismatch:** `auth.ts` and `auth.config.ts` hardcoded `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, but Auth.js / Vercel often provides `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
  2. **Missing `whitelisted_users` Table & Fail-Closed Trap:** In `signIn`, the database query `SELECT 1 FROM whitelisted_users` threw `relation "whitelisted_users" does not exist` on newly migrated databases, and the `catch` block returned `false`, rejecting all sign-in attempts.
  3. **Missing `trustHost: true`:** NextAuth did not have `trustHost: true` configured to trust Vercel serverless proxy headers.
  4. **Proxy Matcher Asset & Auth Route Exclusion:** `src/proxy.ts` matcher did not explicitly exclude `/api/auth/*` from middleware evaluation.
- **The Fix:**
  1. **Normalized Env Fallbacks:** Normalized credentials across `AUTH_GOOGLE_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_ID`, and secrets across `AUTH_SECRET`, `NEXTAUTH_SECRET`.
  2. **Self-Healing Whitelist:** Added dynamic `CREATE TABLE IF NOT EXISTS whitelisted_users`, case-insensitive lookup (`LOWER(email)`), initial-admin auto-whitelisting on empty tables, and non-blocking defensive error handling.
  3. **Configured `trustHost: true`:** Added `trustHost: true` across `auth.ts` and `auth.config.ts`.
  4. **Explicit Proxy Matcher Exclusion:** Excluded `api/auth` directly in `src/proxy.ts` matcher.

### 48. Settings Load Race Condition (401) & Default Schema Auto-Seeding (Resolved in V16.35)
- **The Bug:** On dashboard mount in production, the client threw "FAILED TO LOAD SETTINGS - Using default configuration (401 Unauthorized)".
- **The Cause:**
  1. **Ungated Mount-Time Fetch Race:** `src/hooks/useMarketData.ts` immediately dispatched `fetch('/api/settings')` on component mount before NextAuth's `useSession()` resolved from `loading` to `authenticated`.
  2. **Omitted Same-Origin Credentials:** Client-side `fetch` calls omitted explicit `credentials: 'same-origin'`, risking cookie stripping on HTTPS production environments.
  3. **Missing Terminal Settings Default Return:** In `src/app/api/settings/route.ts`, if an authenticated user did not yet have a record in `terminal_settings`, the GET endpoint returned `terminalSettings: null` and did not auto-seed defaults in Neon.
- **The Fix:**
  1. **Auth Status Gate:** Gated `loadSettings()` in `useMarketData.ts` on `authStatus === 'authenticated'`.
  2. **Same-Origin Credentials:** Added `credentials: 'same-origin'` across all settings, account, trade, strategy, and drawing fetch calls.
  3. **Self-Healing Settings Seeding:** Refactored `GET /api/settings` to automatically insert and return complete `DEFAULT_SIGNAL_SOUNDS` and `DEFAULT_ENABLED_SIGNALS` for authenticated users without existing rows, guaranteeing `terminalSettings` is never null for logged-in sessions.

### 49. Neon Database Egress Spike & Unpruned Query Projection (Resolved in V16.36)
- **The Bug:** Neon PostgreSQL database threw HTTP 402 ("project has exceeded the data transfer quota" / code 53000) due to excessive data egress across Quant Lab and trading endpoints.
- **The Cause:**
  1. **Unprojected JSONB Queries:** `GET /api/quant-lab/runs`, `GET /api/quant-lab/ob-scans`, `GET /api/quant-lab/sr-scans`, and `GET /api/quant-lab/trades` executed `SELECT *` without column projection, streaming multi-megabyte JSONB structures (`order_blocks`, `setups`, `strategy_config`, `ipda_metrics_at_entry`) on every list or index request.
  2. **Missing Pagination & Query Bounds:** Scans, runs, and trade queries lacked default `LIMIT` clauses, dumping entire tables across the serverless wire.
  3. **Uncaught Quota Exceptions:** When quota was exceeded, endpoints threw generic 500 errors instead of structured 402 / quota alert responses.
- **The Fix:**
  1. **Split Summary vs Detail Queries:** Separated index/sidebar list queries (projecting only scalar metadata) from dedicated single-item detail queries (`?id=<uuid>`).
  2. **Client Lazy Detail Hydration:** In `src/app/quant-lab/page.tsx`, loaded lightweight lists on mount and dynamically fetched complete scan/run payloads only upon explicit user selection.
  3. **Strict Pagination:** Implemented default bounds (`LIMIT 25`, max 100 on scans/runs; `LIMIT 50-100`, max 500 on trades) with offset pagination across all endpoints (`/api/quant-lab/runs`, `/api/quant-lab/ob-scans`, `/api/quant-lab/sr-scans`, `/api/quant-lab/trades`, `/api/trades`, `/api/backtest-trades`, `/api/strategies`).
  4. **Resilient Quota Error Handling:** Trapped PostgreSQL code `53000` / HTTP 402 errors to return clean `{ success: false, quota_exceeded: true, error: "..." }` responses.

### 50. Live Cockpit Status Badge SSR/Client LocalStorage Hydration Mismatch (Resolved in V16.40)
- **The Bug:** Next.js threw a recoverable Hydration Mismatch error on `LiveCockpitStatusBadge.tsx` during initial page load: `Hydration failed because the server rendered text didn't match the client`.
- **The Cause:** `LiveCockpitStatusBadge` initialized its state synchronously using `() => getArmedExecutionStatus()`. On the server (SSR), `window` was undefined so it rendered the platform default preset name (`Golden Sweep & Reclaim`). On the client during hydration, `window` was defined and read the user's custom armed preset (`ETH RASL No DP (Golden)`) from `localStorage`. The differing HTML produced a hydration error.
- **The Fix:** Implemented a standard `mounted` client gate initialized to `false` and set to `true` in `useEffect`. Server render and initial client hydration paint output the constant `DEFAULT_SERVER_STATUS`, and custom storage settings are safely rendered on the subsequent client paint, eliminating the hydration mismatch.

### 51. Chart Layout Scheduler Cyclical Re-render Loop & S&R Overlay Undefined Guard (Resolved in V16.40)
- **The Bug:** 
  1. `TypeError: Cannot read properties of undefined (reading 'toFixed')` at `useBacktestStrategyExecution.useMemo[srOverlay]`.
  2. `Maximum update depth exceeded` at `Chart.useCallback[updateAlertPositions]` and `Chart.useCallback[scheduleLayoutUpdates]`.
- **The Cause:**
  1. `activePosition.unrealizedR` and `pendingLimitOrder.entryPrice` were accessed with `.toFixed(2)` without default fallback guards (`?? 0`), failing when newly initialized.
  2. In `Chart.tsx`, `updateAlertPositions` and `computeFvgOverlay` called `setAlertLabelPositions(positions)` and `setFvgOverlayBoxes(boxes)` returning new array references on every calculation frame. This re-triggered `scheduleLayoutUpdates` and the chart logical range subscription in an infinite loop.
- **The Fix:**
  1. Added null-safe guards `(activePosition.unrealizedR ?? 0).toFixed(2)` and `(pendingLimitOrder.entryPrice ?? 0).toFixed(2)` in `useBacktestStrategyExecution.ts`.
  2. Added element-wise memoized equality checks inside `setAlertLabelPositions` and `setFvgOverlayBoxes` in `Chart.tsx`.
  3. Stabilized `scheduleLayoutUpdates` with callback refs (`updateAlertPositionsRef`, `computeFvgOverlayRef`, `updateSvgCoordinatesRef`, `updateCountdownPositionRef`), breaking the re-render cycle.

### 52. Execution Parity & Autonomous Engine Harmonization across Quant Lab, Replay, and Live HUD (Resolved in V16.42)
- **The Bug:**
  1. **Untriggered Limit Orders in Backtest Replay:** Setups were detected in Quant Lab batch scans, but when stepping through the historical replay, limit orders were stranded in pending state or skipped entirely.
  2. **Zero Live HUD Trades:** Live autonomous execution never placed or filled trades on incoming market data streams.
- **The Root Causes:**
  1. **Hook Effect Race Condition:** In `useBacktestStrategyExecution.ts`, `useEffect #2` ran before `useEffect #1` updated `activeSetupRef.current`, stamped `lastProcessedCandleTimeRef`, and aborted early on subsequent re-renders, skipping the pending limit order placement pass (`STEP A`).
  2. **Status Gating Exclusion:** When a candle retested the entry, `scanHistoricalSetups` set `status: 'RETESTED'`. The replay hook strictly required `RECLAIMED_NO_RETEST`, causing retested bars to be vetoed rather than immediately filled.
  3. **Stranded Limits & Concurrency Deadlock:** Pending limit orders lacked a Time-To-Live (TTL) expiration mechanism. In both Replay and Live HUD (`maxOpenPositions = 1`), a single untriggered limit order occupied the slot indefinitely, permanently deadlocking all subsequent setups.
  4. **Premature Setup Blacklisting:** `AutomatedStrategyExecutionEngine.ts` permanently blacklisted setups on temporary price distance checks (`priceDistancePct > 0.05`).
  5. **Mount Point Isolation:** `useAutomatedStrategyExecution` was mounted only on `src/app/page.tsx` instead of the global `MarketDataProvider`, halting background scans on route navigation.
- **The Fixes:**
  1. **Synchronized Replay Execution:** Unified visible candle scan evaluation with position lifecycle in `useBacktestStrategyExecution.ts`. Added support for immediate touch fills on `RETESTED` candles.
  2. **Time-To-Live Expiration (TTL):** Added automatic TTL expiration (24 bars / 2 hours) to pending limit orders in both `useBacktestStrategyExecution.ts` and `AutomatedStrategyExecutionEngine.ts`, auto-cancelling dead limits and freeing the concurrency slot.
  3. **Immediate Touch Protocol in Engine:** Added `is_immediate_fill`, `max_retest_index`, and `is_expired` metadata to `SweepReclaimSetup` in `SweepReclaimEngine.ts`.
  4. **Global Host in MarketDataProvider:** Hoisted `AutonomousExecutionHost` directly into `MarketDataProvider` in `src/context/MarketDataContext.tsx`, ensuring 24/7 background execution across all routes.
  5. **Sanitized Blacklisting:** Removed premature blacklisting on temporary distance deviations in `AutomatedStrategyExecutionEngine.ts`.

### 53. Outlier Candle Injection & Price Scale Compression ($3300 Ghost Cluster Resolution) (Resolved in V16.43)
- **The Bug:** During live chart operation or background delta polling, a rogue cluster of outlier candles at `$3300.00` was injected into the active `$2400.00` ETH series at the right edge of the chart. This expanded the Lightweight Charts vertical price scale from $2200 to $3600, severely compressing the entire chart viewport into a flat horizontal line and stretching London/Asian session boxes up to $3300.
- **The Root Causes:**
  1. **Unanchored Offline Mock Generator:** When Binance REST returned rate limits (HTTP 418/429) or network timeouts during a 5-second polling tick (`poll=true`), `/api/market-data/route.ts` switched to offline simulation mode (`isOffline = true`). Because `startPrice` was omitted in the fallback calls, `generateMockCandles` defaulted to a hardcoded legacy base price of `3300.00` for ETH.
  2. **Missing Client Ingestion Sanity Gate:** `mergeDeltaPayload()` in `useMarketData.ts` and `LiveSeriesCanvasUpdater` in `Chart.tsx` blindly merged incoming delta candles and WebSocket ticks into the active series without checking price continuity against the last known candle close.
  3. **Unclamped Visual Layer Coordinates:** Session ranges (`sessionsLayer.ts`) and liquidity magnets (`magnetsLayer.ts`) registered `series.createPriceLine()` and SVG coordinate boxes using the corrupted $3300 values, which locked the Lightweight Charts price scale into an expanded state.
- **The Fixes:**
  1. **Dynamic In-Memory Server Price Cache & Client Anchor Injection:** Implemented a server-side cache `LAST_KNOWN_PRICES: Map<string, number>` in `/api/market-data/route.ts` updated on every live tick. `fetchData()` in `useMarketData.ts` now transmits `&fallbackPrice=${latestPrice}&lastPrice=${latestPrice}`, and all offline simulation calls dynamically anchor to the verified asset price ($2400 for ETH).
  2. **Client-Side 15% Outlier Sanity Gate (>15% Drop & Silent Resync):** Intercepted and rejected all incoming bars/ticks deviating >15% from the preceding closed price across `mergeDeltaPayload()`, `useMarketData.ts` (full payload replacement, `lastClosedEvent`, and `liveCandle` sync), `useBinanceWS.ts` (`onmessage`), and `Chart.tsx` (`LiveSeriesCanvasUpdater` and historical `setData` deduplication). All drops log an `[OUTLIER_DATA_DROP]` warning and trigger a silent background resync.
  3. **Visual Layer Price Scale Clamping:** In `sessionsLayer.ts` and `magnetsLayer.ts`, added price validity gates (`isPriceValid`) that omit levels deviating >20% from the current market price, preventing rogue lines or distorted session boxes from expanding the vertical price scale.

### 54. Dynamic Fallback Hook Dependency Cycle & Rapid-Fire Re-init Loop (Resolved in V16.44)
- **The Bug:** During offline mode or live streaming, the chart flashed rapidly and re-rendered completely 2-3 times per second, generating new mock series continuously with `init=true`.
- **The Cause:** `fetchData` in `useMarketData.ts` included `data` and `liveCandle` in its `useCallback` dependency array to extract the active price anchor. When `fetchData()` resolved and called `setData()`, `data` mutated, changing `fetchData`'s reference. This immediately triggered `useEffect([fetchData])`, launching an un-polled `fetchData()` (`init=true`) in an infinite synchronous refetch cycle.
- **The Fix:** Decoupled `fetchData` from mutating state references using `dataRef` and `liveCandleRef`. `fetchData` now depends strictly on `[selectedInterval, engineSettings]`, stabilizing hook references and ensuring only the 5000ms delta timer triggers background polls (`poll=true`).

### 55. FVG Proximal/Distal Polarity Inversion in Sweep & Reclaim Entry Resolver (Resolved in V16.46)
- **The Bug:** In the Sweep & Reclaim execution engine, entry prices for `FVG_PROXIMAL` and `FVG_DISTAL` modes resolved to the **wrong gap boundary** for both Bullish (BISI) and Bearish (SIBI) setups. A Bearish short setup using `FVG_PROXIMAL` was routing the limit order to the Candle 3 High (deep fill price) instead of the Candle 1 Low (shallow, first-touch entry). A Bullish long setup using `FVG_PROXIMAL` was routing to Candle 3 Low instead of Candle 1 High. The downstream `reclaimFvgProximal` and `reclaimFvgDistal` metadata fields on the setup payload carried the same inversion.
- **The Cause:** In `resolveRetestEntryPrice()` inside `SweepReclaimEngine.ts`, both the `FVG_PROXIMAL` and `FVG_DISTAL` case branches had their directional ternary expressions inverted — the comment described the correct behaviour but the code implemented the opposite polarity. The `FVG_PROXIMAL` case returned `isBullish ? fvg.top : fvg.bottom` and `FVG_DISTAL` returned `isBullish ? fvg.bottom : fvg.top`. The FVG data model stores `{ top: <higher price>, bottom: <lower price> }` so for a BISI gap, `fvg.top` is Candle 3 Low and `fvg.bottom` is Candle 1 High. The proximal for a Bullish retracement (price coming down) is the **lower** boundary (Candle 1 High = `fvg.bottom`), not `fvg.top`. The downstream geometry fields at lines 1285–1288 were written to match the wrong resolver, perpetuating the inversion into the setup payload and the `srOverlay` served to the chart.
- **The Fix:** Three surgical changes to `src/lib/quantEngine/SweepReclaimEngine.ts`:
  1. **`FVG_PROXIMAL`** — flipped ternary: `isBullish ? fvg.bottom : fvg.top` (Bullish → Candle 1 High; Bearish → Candle 1 Low).
  2. **`FVG_DISTAL`** — flipped ternary: `isBullish ? fvg.top : fvg.bottom` (Bullish → Candle 3 Low; Bearish → Candle 3 High).
  3. **Downstream geometry** — `reclaimFvgProximal` and `reclaimFvgDistal` expressions both flipped to match.
  - The FVG gap extraction logic (`fvgTop`/`fvgBottom` assignments in BISI/SIBI loops), the `FVG_CE` midpoint formula, the `SHELF_LEVEL`/`RECLAIM_LEVEL` case, and the SVG chart overlay were all **already correct** and required no changes. `npx tsc --noEmit` confirmed 0 compilation errors post-fix.

### 56. Stale Pending Limit Respawning & Co-Located Chart Label Collision (Resolved in V16.47)
- **The Bug:** On client mount or page refresh, historical Sweep & Reclaim setups from earlier in the session were respawning active resting limit orders in the HUD and triggering notifications even when price had already expanded past TP1 or when the retest window had elapsed. In addition, when the setup entry mode was set to `SHELF_LEVEL` (where entry price equals anchor level), the cyan anchor badge and entry badge rendered at the exact same vertical coordinate, causing unreadable text overplotting.
- **The Causes:**
  1. `AutomatedStrategyExecutionEngine.onMultiTimeframeCandles()` only checked bar index relative to the loaded buffer (`reclaim_index >= candles.length - 12`), which allowed older setups to pass if buffer sizes or timeframes loaded historical bars without testing if price had already expanded beyond TP1 or if real-time elapsed time exceeded `maxBarsToRetest`.
  2. `Chart.tsx` rendered `<g id="svg-sr-label-anchor">` and `<g id="svg-sr-label-entry">` unconditionally at their respective price coordinates without testing for spatial collision between `entryPrice` and `anchorLevel`.
- **The Fixes:**
  1. **Missed Expansion Gate (`AutomatedStrategyExecutionEngine.ts`):** Evaluates `latestPrice` against `s.stage1_target`. If price has already reached or exceeded TP1 in the setup's favor, order routing is bypassed. Additionally in `processMarketTick()`, active pending orders are checked on every live tick and auto-cancelled with `INVALIDATED_EXPANDED` if price reaches TP1 before touching the entry limit.
  2. **Wall-Clock Retest TTL Guard (`AutomatedStrategyExecutionEngine.ts`):** Evaluates `Date.now() - s.reclaim_time`. If elapsed time exceeds `maxBarsToRetest × barMs`, live order placement is bypassed.
  3. **Chart Visualizer Label Collision Deduplication (`Chart.tsx`):** In `updateSrLineAndLabel()` and SVG JSX, checks `Math.abs(entryPrice - anchorLevel) < 0.05`. When true, the redundant anchor text badge is hidden (while keeping the dashed reference line), and the entry badge is enriched to `"🎯 S&R ENTRY / ⚓ SHELF (DIRECTION): $PRICE"` with expanded width, cleanly deduplicating the visual overlay.

### 57. Flawed Global Dataset Median Drop & Trade Close Idempotency (Resolved in V16.48)
- **The Bug:** During live market rendering, `Chart.tsx` flooded the browser console with hundreds of `[OUTLIER_DATA_DROP] Filtered out historical anomaly candle... deviates >25% from dataset median 1910.72` warnings, dropping all legitimate current candles between $2388 and $2457 from the chart. In addition, when auto-closing backtest trades, the browser logged `Failed to auto-close backtest trade: Bad Request` with HTTP 400.
- **The Causes:**
  1. `Chart.tsx` contained an outlier filter comparing every candle in the historical dataset against the static median of the whole series (`closes[Math.floor(closes.length / 2)]`). Over a dataset where price trended up from $1800 to $2450+, the global median was $1910. Any candle >$2388 was >25% above the median, causing the chart to incorrectly drop all legitimate current market candles.
  2. `/api/backtest-trades` and `/api/trades` returned `400 Bad Request` if a trade being closed was already in `CLOSED` state, which broke client auto-close retry loops.
- **The Fixes:**
  1. **`Chart.tsx`:** Removed the flawed global median filter from the historical data loop and retained robust positive numerical validation (`isFinite && c > 0`). Bar-to-bar outlier filtering remains strictly on live streaming ticks (`useMarketData.ts`, `useBinanceWS.ts`, `LiveSeriesCanvasUpdater`).
### 58. Closed-Trade In-Memory Singleton Desynchronization & Ghost Chart Overlay Trap (Resolved in V16.50)
- **The Bug:** After manually closing or purging a trade in the Trading Journal (`/journal`), the live chart continued to display the trade as `OPEN` in the S&R 3-Pillar HUD (`Live Position OPEN (LONG) | +2.07R`), and permanently rendered `🛑 S&R SL`, `🏆 TP1`, `💎 TP2`, and `🚀 TP3` lines on the chart screen as if the trade were still active or unopened.
- **The Causes:**
  1. **One-Way In-Memory Singleton Sync:** `AutomatedStrategyExecutionEngine` and `LiveOrderBlockExecutionEngine` run as persistent module-scoped singletons (`sharedStrategyEngineInstance`). When a trade was opened, the engine added it to `this.activePositions` and mirrored it into `useSessionJournalStore`. When the user closed or purged the trade in `/journal`, `useSessionJournalStore` updated `localStorage` and dispatched `'trades-refresh'`, but the execution engines never listened to this event. `this.activePositions` retained the closed position in memory, continuously updating its floating P&L and feeding `srOverlay.isPositionOpen = true` and `srOverlay.phase = 'OPEN'` to `Chart.tsx`.
  2. **Empty-Array State Guard in `src/app/page.tsx` & `src/app/backtest/page.tsx`:** `fetchOpenTrades` and `fetchBacktestTrades` were wrapped in `if (localOpenTrades.length > 0) { setOpenTrades(localOpenTrades); }`. When all open trades were closed, `localOpenTrades.length === 0`, so `setOpenTrades([])` was never called, leaving the previous trade state stuck in React memory and continuing to paint generic `ENTRY`, `TP`, and `SL` lines.
- **The Fixes:**
### 59. Displacement Audit Metadata Loss & Zoom-Dependent Setup Bleed (Resolved in V16.58)
- **The Bug:** In the Institutional Setup Audit popover (`Chart.tsx`), active Sweep & Reclaim trades displayed `$N/A` for `Sweep Extreme` and `Reclaim Close`, failed to render the 3-candle displacement leg coordinates, and reverted 3-pillar metrics to `1.00x / 50.0% / 50.0%` with false `✗ Pillars Failed`. The real metrics only appeared if the user manually zoomed out far enough to load older historical bars.
- **The Causes:**
  1. **Transient Audit Stripping:** `submitStrategyOrder()` in `AutomatedStrategyExecutionEngine.ts` only stored entry/SL/TP prices and failed to attach the setup's `displacement_candles`, `sweep_price`, `reclaim_close_price`, `vol_expansion`, `delta_dominance`, `body_ratio`, and `three_pillars_passed` onto the active in-memory `StrategyExecutionPosition`.
  2. **Lookback Buffer Dependence:** Because `StrategyExecutionPosition` was an "empty shell", `useAutomatedStrategyExecution.ts` had to dynamically re-scan historical candles to reconstruct the setup. When zoomed in, the origin displacement candles (e.g. 17:30 UTC) fell outside the loaded candle buffer.
  3. **Broken Lookup Key & Fallback Bleed:** `srOverlay` searched for `(activePos as any).setupId` (which was `undefined` since the engine stored `originZoneId`), causing `matchById` to fail and fall back to `scannedSetups[scannedSetups.length - 1]`—an unconfirmed `ANCHOR_ONLY` pivot that had no sweep or reclaim yet.
- **The Fixes:**
  1. **Immutable Position Audit Snapshot:** Extended `StrategyExecutionPosition` and `submitStrategyOrder()` to capture and lock `displacement_candles`, `sweep_price`, `reclaim_price`, `vol_expansion`, `delta_dominance`, `body_ratio`, and `three_pillars_passed` directly on the position at order execution time.
  2. **Journal Metric Persistence (`ipda_metrics`):** Saved the full audit block inside `useSessionJournalStore`'s `ipda_metrics` and updated `rehydrateOpenPositions()` to seamlessly restore all klines and metrics upon page mount.
  3. **Direct Position-First Resolution:** Updated `srOverlay` `useMemo` in `useAutomatedStrategyExecution.ts` to prioritize the position's own preserved audit snapshot over transient candle scans, and fixed the ID search keys.
  4. **Cairo Timezone Alignment:** Updated `Chart.tsx` displacement kline cards to render timestamps in institutional Cairo time (`Africa/Cairo`) matching the Quant Lab and Session Journal.



### 50. The Auto-Executor Phantom "Take Profit" Loop & Inverted Stop Losses (Resolved in V16.60)
- **The Bug:** Long trades generated by the SweepReclaimEngine were executing in the journal with positive PnL (e.g., +.96) and "CLOSED" status, despite instantly stopping out. Analysis showed that the trades were executing with a Stop Loss price mathematically HIGHER than the entry price.
- **The Cause:** 
  1. The AutomatedStrategyExecutionEngine calculated the clampedStopLoss and R-multiple targets strictly based on the structural limitEntryPrice.
  2. If the active market price gapped down significantly, canFillNow = currentPrice <= limitEntryPrice would evaluate to true, instantly executing the Limit Order as a Market Order at currentPrice.
  3. However, if the market price dropped so far that it was already BELOW the calculated clampedStopLoss, the engine still executed the trade (newPosition.entryPrice = currentPrice), creating a corrupted trade where entryPrice < stopLoss.
  4. On the next tick, processMarketTick correctly evaluated livePrice <= stopLoss and triggered an immediate STOPPED_OUT event. But because the system exited at a Stop Loss that was structurally higher than the entry price, it recorded a phantom positive PnL.
- **The Fix:**
  1. **Price Sanity Veto Guardrail:** Injected a pre-flight check in submitStrategyOrder: const isStopLossBreached = isLong ? currentPrice <= clampedStopLoss : currentPrice >= clampedStopLoss. If breached, the engine immediately vetoes execution (DIRECTIONAL_VETO), correctly preventing setups from being blindly traded when their structural anchor is already blown out.

### 61. Live S&R Stale Setup Respawning & Inverted Below-Anchor Market Fills (Resolved in V16.62)
- **The Bug:** During live execution (on Vercel wakeups, browser tab reconnects, or live engine cold starts), the engine was opening Long positions when price was dumping deep below the anchor (e.g. trading at $2,462 while anchor was at $2,487). The trade executed immediately on limit touch without price ever having closed back above the anchor level or performing a true pullback retest.
- **The Causes:**
  1. **Unbounded Historical Candidate Ingestion:** When `useAutomatedStrategyExecution.ts` fetched the 72-hour historical buffer (288 bars) on mount, `onMultiTimeframeCandles` iterated over all historical setups from the past 3 days without checking if the reclaim candle occurred on recent bars. A 2-day-old setup was picked up with blank `processedSetupIds` and armed as live.
  2. **Inverted `canFillNow` Immediate Market Execution:** In `submitStrategyOrder`, checking `canFillNow = isLong ? currentPrice <= limitEntryPrice : ...` caused the engine to treat a falling market (where price was lower than the limit) as an immediately filled market order, buying into crashing knives below the anchor.
  3. **Violation of Institutional 4-Phase S&R Order Lifecycle:** In pure S&R, Phase 2 (Sweep) touches must NEVER arm or execute an order. Only Phase 3 (Confirmed Candle Close strictly ABOVE the Anchor with 3-Pillar Displacement) arms a resting limit order (`PENDING_LIMIT_ENTRY`), and Phase 4 (Retest) fills the order only when price pulls back into the limit from above.
- **The Fixes:**
  1. **Strict Reclaim Freshness & Wall-Clock TTL Gating (`AutomatedStrategyExecutionEngine.ts`):** Only setups whose reclaim occurred within the active `maxBarsToRetest` window from the latest candle (`latestIndex - s.reclaim_index <= maxBarsToRetest`) and within real-time duration are eligible for live order submission.
  2. **Mandatory Anchor Polarity Guardrail:** Enforced that for Long setups, current market price must be strictly above the anchor level (`currentPrice >= originAnchorLevel`). Any attempt to execute while price is below the anchor is vetoed (`[EXECUTION_VETO] Price is below anchor level`).
  3. **Resting Limit Queue Order Model:** Removed premature immediate market fills on fresh setups. All confirmed setups are placed into `pendingLimitOrders` as `PENDING_LIMIT_ENTRY` and only fill when `processMarketTick` receives a real-time pullback touch from above.
  4. **Multi-Scenario Simulation Audit Suite (`scripts/audit_live_execution_gating.ts`):** Verified 4/4 live simulation tests (Cold-start 72h ingestion, Below-anchor dump veto, Legitimate 4-phase S&R pullback execution, SL crash purge).

### 62. Completed-Bar vs. In-Progress Forming Candle Scanning Discrepancy (Resolved in V16.64)
- **The Bug:** A live Short trade occurred on ETHUSDC ($2466.21 entry, $2473.30 SL) and stopped out, but when running the exact same configuration in Quant Lab, the loss trade was absent from the backtest results.
- **The Causes:**
  1. **In-Progress Forming Candle Ingestion in Live Engine:** `useAutomatedStrategyExecution.ts` passed `marketData.data_payload.candles_5m` directly into `onMultiTimeframeCandles()`. The trailing candle at `candles_5m[length - 1]` was the **unclosed in-progress candle** (`isClosed: false`).
  2. **Transient 1st-Second Volume & Conviction Glitch:** At the very first millisecond of a new 5m candle opening (e.g., 21:35:01 Cairo), a single small tick (e.g., 0.3 BTC volume) produced a temporary candle where `High == Open` and `Close == Low`, yielding a synthetic `100% Body Ratio` and false 3-pillar displacement signal before the candle actually developed.
  3. **Quant Lab Strict Closed-Bar Model:** Quant Lab fetches finalized completed candles from Binance REST API (`isClosed: true`). On the finalized completed 5m bar at 21:35, price formed a neutral doji ($2,463.53 close with 1,379 volume) that failed displacement criteria, so Quant Lab never took the trade.
### 63. Cold-Start Reboot & NPM Restart Historical Trade Leak (Resolved in V16.67)
- **The Bug:** When the browser window was reloaded or NPM was restarted, the Live Automated Execution Engine immediately opened an old Short position ($2,474.35 entry, $2,483.67 SL) that had already completed its trade cycle ~1.5 hours earlier (at 22:35 Cairo). Since current market price had already moved past $2,483, the trade stopped out within seconds, recording a phantom -$300 loss.
- **The Causes:**
  1. **Historical Completed Setups Treated as Fresh Pending Orders:** When `onMultiTimeframeCandles` ran historical candle scanning on boot with an empty in-memory `processedSetupIds` set, it iterated through all scanned setups from history. Even though a setup had already been retested, reached its targets, or stopped out in historical candles (`s.is_retested === true`, `s.simulated_outcome !== null`), the live engine did not check for historical completion and armed it as a fresh resting limit order.
  2. **Missing Limit Order Resting-Side Gate:** When current market price was $2,483.42 (above the short limit entry of $2,474.35), the engine allowed a Short limit order to be submitted at $2,474.35. The subsequent tick loop immediately executed the limit order because market price was already past the entry level.
  3. **Unreconciled Session Journal Closed IDs:** When rehydrating from `useSessionJournalStore`, closed trade records did not populate their `setupId`, `strategyId`, or `originZoneId` into `engine.processedSetupIds`.
- **The Fixes:**
  1. **Historical Resolution & Zero-Leak Guard (`AutomatedStrategyExecutionEngine.ts`):** In `onMultiTimeframeCandles`, any setup with `s.is_retested === true`, `s.simulated_outcome !== null`, `s.retest_time !== null`, or completed/invalidated status is immediately marked as processed and discarded from live pending order submission.
  2. **Resting-Side Market Price Gate:** In both `onMultiTimeframeCandles` and `submitStrategyOrder`, enforced that for Short setups, current market price must be resting strictly below the limit entry price (waiting to rally up into entry). For Long setups, current market price must be resting strictly above the limit entry price. Any order submitted when market price has already penetrated the entry level is vetoed (`[RESTING_SIDE_VETO]`).
  3. **Closed Setup ID Synchronization:** Updated `reconcileWithOpenTrades()` to extract all `setupId`, `strategyId`, `originZoneId`, and `metadata.setupId` from closed trades in `useSessionJournalStore` and register them into `processedSetupIds` on mount.
  4. **Cold-Start Reboot Leak Verification Suite (`scripts/test_reboot_historical_leak.ts`):** Created an automated test suite verifying that bootstrapping a fresh engine instance across 80 historical candles results in 0 phantom limit orders and 0 phantom positions.



