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
