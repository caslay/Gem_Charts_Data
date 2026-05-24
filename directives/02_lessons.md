# 🧠 Flow-State Systemic Memory & Post-Mortems

## 🛑 Critical Lessons Learned (Never Repeat These Mistakes)

Before modifying the Quant Logic, Order Flow Engine, or Prompt Builder, review these historical system fixes:

### 1. The "Outside Bar" Anomaly (Resolved in V4/V7.9)
- **The Bug:** The fractal detection algorithm used to get confused by "Outside Bars" (a candle that forms both a swing high and a swing low simultaneously).
- **The Fix:** We implemented the **"Strict Directional Lock"**. A valid Swing High MUST have a red top preceded by green. A valid Swing Low MUST have a green bottom preceded by red. Do NOT revert to standard 3-bar or 5-bar pure-price checks without color validation.

### 2. Timezone Drift & The True Day Open
- **The Bug:** Market data was shifting because servers use UTC, but our institutional analysis relies on the NY Midnight / 07:00 Cairo open.
- **The Fix:** We hard-coded the `true_day_open_0700` inside the `ipda_metrics` payload. Always use this anchor for Macro Bias calculations, NOT the rolling 24h open.

### 3. The Context Window Memory Overflow
- **The Bug:** Sending full raw OHLCV arrays to Gemini caused hallucinations and token limit errors.
- **The Fix:** We use **Payload Pruning & Pre-Computation**. The Backend Next.js engine computes the `active_fvgs`, `BSL_Magnets`, and `SSL_Magnets` first. We ONLY send the "Sliced JSON" (the Focus Window) to the AI. Do NOT write logic that forces the AI to iterate over thousands of raw candles.

### 4. The "DEAD_ZONE" Temporal Trap
- **The Bug:** The algorithm was taking trades during the NY Lunch/Mid-day pause when volume flatlined, falling for fake structural shifts.
- **The Fix:** We introduced the `displacement_active` flag based on Open Interest (OI) momentum and Volume. If displacement is inactive, the Agent must output `[⚪ NEUTRAL / 🚫 ABORT]`. Do not bypass this safety net.

### 5. Server-Side Fetch Port Mismatches & Silent Failures (Vercel/Python Bridge)
- **The Bug:** During local development, the Next.js API route (`/api/market-data`) would silently fail when trying to fetch the Python backend. This caused the UI to receive the "offline" fallback values (`t-STAT: 0.0000`, `p-VALUE: 1.0000`, `OLS VALIDATION: REJECTED`) instead of the actual data.
- **The Cause:** Server-side fetches in Next.js require absolute URLs. We mistakenly hardcoded `127.0.0.1:3000` as the fallback, but the developer's Next.js project was actually running on `localhost:4000`. The fetch failed and the `catch` block silently swallowed it.
- **The Fix:** We directly bypass the Next.js dev server for internal fetches. In development, the Next.js server route now directly pings `http://127.0.0.1:8000` (the uvicorn Python engine), while in production, it routes to `https://${process.env.VERCEL_URL}` where the Python endpoint is deployed as a Vercel serverless function (`/api/index.py`).

### 6. FastAPI POST returning HTTP 405 in Vercel Production
- **The Bug:** `verifyDisplacement` returned `HTTP Error: 405` in production when calling `/api/py/calculate-displacement`.
- **The Cause:** 
  1. In `next.config.ts`, the rewrite for `/api/py/:path*` was pointed to `/api/index` which triggered Vercel Clean URL 308 redirects.
  2. The `proxy.ts` (NextAuth middleware) was intercepting the server-to-server fetch. Because the `fetch` from the backend lacked user session cookies, the middleware treated it as unauthenticated and redirected it to `/login?callbackUrl=/api/py/calculate-displacement`. The `fetch` followed the redirect with a `POST` method, hitting `/login` which only accepts `GET`, resulting in `405 Method Not Allowed`.
- **The Fix:** We added `isPyBackend` to the bypass list in `src/proxy.ts` to allow internal server-to-server fetches to `/api/py` to proceed without authentication. Additionally, we corrected the `next.config.ts` rewrite destination to `/api/` to avoid clean-URL redirect issues.

## 🛠️ Note to AI Agent:
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
