# 📈 Flow-State Quant Logic & IPDA Rules (V7.9 / V8.2)

## 🛑 Core Doctrine: THE NAKED DATA RULE
Do NOT hallucinate traditional retail patterns (RSI, MACD, Trendlines, Double Tops). You operate STRICTLY on the Interbank Price Delivery Algorithm (IPDA) mechanics. If it is not Time, Price, Volume, or Engineered Liquidity, it does not exist.

## 1. The Strict Directional Lock (Fractals)
A Swing High / Swing Low cannot be assumed by pure price action. You must validate the algorithmic signature (Color Check):
- **Valid Swing High:** Must have a RED local top, preceded immediately by a GREEN candle.
- **Valid Swing Low:** Must have a GREEN local bottom, preceded immediately by a RED candle.
- *Anomaly:* "Outside Bars" must be treated with caution and rely strictly on the color validation logic to avoid false pivots.

## 2. The Dual-Pricing Matrix & The Veto
Never execute a trade without cross-referencing BOTH the Macro and Local dealing ranges:
- **Macro Baseline [UPDATED — Phase 2]:** The premium/discount anchor is now the **PDH/PDL midpoint** (`(pdh + pdl) / 2`), computed from the previous day's 1h candles. The deprecated `true_day_open_0700` (Cairo UTC+3 / NY Midnight) has been **permanently removed**.
- **The Rule:** 🟢 BUYS are STRICTLY LOCKED if price is in PREMIUM territory (above PDH/PDL midpoint AND above Local Range Equilibrium). 🔴 SELLS are STRICTLY LOCKED if price is in DISCOUNT territory (below PDH/PDL midpoint AND below Local Equilibrium).
- **Strategy Metric:** Use `LOCAL_PRICING` (`PREMIUM`/`DISCOUNT`) in the Equation Builder. The deprecated `PRICE_VS_OPEN` metric has been removed.
- *Exception:* Reversal profiles confirmed by heavy Order Flow displacement.

## 3. Order Flow & Liquidity Engine (V8.2)
Do NOT parse raw OHLCV arrays to guess liquidity. Use the parsed `order_flow_engine` data:
- **Magnets:** `BSL_Magnets` (Buy Stops / Asks) and `SSL_Magnets` (Sell Stops / Bids) represent engineered retail liquidity. Price will magnetically seek the heaviest pool.
- **Sponsorship (Displacement):** A Market Structure Shift (MSS) is ONLY valid if `displacement_sponsorship` is ACTIVE (backed by heavy Taker Volume and rising Open Interest).

## 4. Temporal Filters (The DEAD_ZONE)
- Do NOT execute setups during the NY Lunch/Mid-day pause (The DEAD_ZONE). If the time window aligns with this zone, output `[⚪ NEUTRAL / 🚫 ABORT]` and await the PM Killzone.

## 5. Market Structure Classification Rules (V10.13)

### 5.1 The Trend State Machine
The Market Structure Engine maintains a running trend state (`BULLISH` | `BEARISH` | `UNSET`). Classification of structural breaks depends entirely on this state:

| Current Trend | Break Direction | Classification | State After |
|---|---|---|---|
| BULLISH | Above prior Swing HIGH | **BOS** (continuation) | BULLISH (unchanged) |
| BULLISH | Below prior Swing LOW | **MSS** (reversal) | BEARISH (flipped) |
| BEARISH | Below prior Swing LOW | **BOS** (continuation) | BEARISH (unchanged) |
| BEARISH | Above prior Swing HIGH | **MSS** (reversal) | BULLISH (flipped) |

### 5.2 Critical Rule: Direction-Blind Classification is FORBIDDEN
Labeling ALL upward breaks as "BOS" and ALL downward breaks as "MSS" is a systemic failure that produces false narratives. The label depends on the CONTEXT of the current trend, not the raw direction of the price movement. Source of truth: `src/lib/structureEngine.ts`.

### 5.3 MSS Displacement Gating (Soft Gate)
A Market Structure Shift (MSS) event is classified as:
- **CONFIRMED** — When `institutional_sponsorship.status` is `ACTIVE_BULLISH` or `ACTIVE_BEARISH` at the time of the break. Only CONFIRMED MSS events set `market_structure_shift: true` in `ipda_metrics` and trigger strategy evaluator conditions.
- **UNCONFIRMED** — When displacement sponsorship is `INACTIVE` or `CONSOLIDATION`. The visual layer renders this as a dashed amber line with "MSS?" label. The strategy evaluator IGNORES unconfirmed MSS events.

### 5.4 Dealing Range Anchor Rules
- The Structural Dealing Range is anchored ONLY on **color-validated 5-bar (MAJOR) fractals**.
- 3-bar (INNER) fractals are informational visual aids only and NEVER anchor the dealing range.
- Color Lock (§1 above) is MANDATORY for dealing range fractal anchors: a fractal without proper institutional color signature is rejected.
- Fallback: if no validated fractals exist in the candle window, raw candle extremes are used (documented as degraded mode).