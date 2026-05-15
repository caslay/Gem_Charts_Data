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

## 🛠️ Note to AI Agent:
If you encounter a new bug and successfully fix it, YOU MUST prompt the user to update this `02_lessons.md` file with the new Post-Mortem.