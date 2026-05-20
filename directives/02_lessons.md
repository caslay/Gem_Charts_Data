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
- **The Cause:** In `next.config.ts`, the rewrite for `/api/py/:path*` was pointed to `/api/index`. Vercel's Edge routing can mishandle Next.js rewrites to `/api/index` (due to clean URLs creating a 308 redirect, or Next.js App Router intercepting the POST request and returning 405 because pages only accept GET).
- **The Fix:** The Next.js rewrite destination for Vercel Python serverless functions MUST be `/api/` (the base directory mapped by `api/index.py`), not `/api/index`. This allows Vercel's ASGI wrapper to correctly pass the original `PATH_INFO` to FastAPI without triggering Next.js catch-all or Clean URL redirects.

## 🛠️ Note to AI Agent:
If you encounter a new bug and successfully fix it, YOU MUST prompt the user to update this `02_lessons.md` file with the new Post-Mortem.