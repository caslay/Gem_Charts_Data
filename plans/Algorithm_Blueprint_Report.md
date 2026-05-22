# Algorithm Blueprint Report: Quant Engine Logic Audit

This report provides a technical deep-dive into the mathematical models and conditional logic powering the Flow-State Quant Engine, acting as an audit to align the AI System Prompt with the live codebase.

---

## 1. Target State (EXHAUSTED vs. PENDING)

### Monitored Levels
The engine persistently tracks the Previous Day High (`pdh`), Previous Day Low (`pdl`), and institutional session ranges specifically **Asian High/Low** and **London High/Low**.

### Buffer Zone
There is **no buffer zone** in ticks or percentage for triggering a sweep. The engine uses strict equality/crossover (`c.h >= pdh` or `c.l <= pdl`). However, in risk management (`riskEngine.ts`), there is a strict **$10 USD buffer** ("Danger Zone") that downgrades risk execution to `HALF_RISK_CONTINUATION` if the current price approaches within $10 of `pdh` or `pdl`.

### Exhausted Condition
The `EXHAUSTED` status is triggered if **any 15-minute candle** during the current UTC calendar day sweeps the `pdh` or `pdl`.

**Code Snippet Reference (`src/app/api/market-data/route.ts`):**
```typescript
// Exhaustion Logic Check
for (const c of todayCandles) {
  if (c.h >= pdh || c.l <= pdl) {
    sweeps.push("EXHAUSTED");
  }
}

if (sweeps.includes("EXHAUSTED")) {
  target_status = "EXHAUSTED";
}
```

```typescript
// Risk Engine Danger Zone ($10 buffer) - src/lib/riskEngine.ts
if (Math.abs(currentPrice - pdh) <= 10 || Math.abs(currentPrice - pdl) <= 10) {
  return {
    mode: "HALF_RISK_CONTINUATION",
    reason: "Price is deeply inside the Danger Zone of a major historical magnet..."
  };
}
```

---

## 2. Premium/Discount (Local Dealing Range)

### Range Anchoring
The Local Dealing Range is anchored using **intraday 15-minute candles** strictly starting from **07:00 UTC+3** (True Day Open / Cairo local time). It does not use fractal pivots; instead, it uses the absolute highest high and lowest low printed since the 07:00 anchor candle.

### Equilibrium Formula
Equilibrium is the exact midpoint between the intraday high and low since the 07:00 anchor. 
`Equilibrium = (Intraday High + Intraday Low) / 2`

### Decimal Precision
The current pricing flip from Discount to Premium (or vice versa) evaluates the equilibrium at a **2-decimal precision** (`.toFixed(2)`).

**Code Snippet Reference (`src/app/api/market-data/route.ts`):**
```typescript
const intradayHigh = parseFloat(Math.max(...intradayCandles.map(c => c.h)).toFixed(2));
const intradayLow = parseFloat(Math.min(...intradayCandles.map(c => c.l)).toFixed(2));
const equilibrium = parseFloat(((intradayHigh + intradayLow) / 2).toFixed(2));

pricing_context = {
  // ...
  local_dealing_range: {
    high: intradayHigh,
    low: intradayLow,
    equilibrium,
    current_status: currentLivePrice > equilibrium ? "PREMIUM" : "DISCOUNT",
  },
};
```

---

## 3. Open Interest (OI) Trend

### Directional Alignment (RISING_WITH_PRICE)
The engine classifies the OI trend by comparing the literal rise or fall in OI against the underlying price trajectory. If the Open Interest increases (`currOI > prevOI`) AND the price of the last 15m candle closed higher than the previous one, it outputs `RISING_WITH_PRICE`. If they move inversely, it prints `RISING_AGAINST_PRICE` or `FALLING_AGAINST_PRICE`.

### Look-back Window
The look-back window is ultra-short: it compares exactly the **last two 5-minute periods** from Binance's Open Interest history endpoint (`period=5m&limit=2`). Price direction is gauged over the last two **15-minute** candles.

**Code Snippet Reference (`src/lib/orderFlowEngine.ts` & `src/app/api/market-data/route.ts`):**
```typescript
// Price trajectory mapped in route.ts
const isPriceRising = candles15m.length > 1 && candles15m[candles15m.length - 1].c > candles15m[candles15m.length - 2].c;

// OI mapping in orderFlowEngine.ts
const prevOI = parseFloat(oiData[0].sumOpenInterestValue);
const currOI = parseFloat(oiData[1].sumOpenInterestValue);
const trend = currOI > prevOI ? 'RISING' : 'FALLING';

if ((trend === 'RISING' && isPriceRising) || (trend === 'FALLING' && !isPriceRising)) {
  open_interest_trend = `${trend}_WITH_PRICE`;
} else {
  open_interest_trend = `${trend}_AGAINST_PRICE`;
}
```

---

## 4. Institutional Displacement

### Anomaly Multiplier Variables
In the underlying Python OLS model (`api/index.py`), the statistical `anomaly_multiplier` is calculated using Total Volume (`v`) against a 14-period rolling mean: 
`anomaly_multiplier = v / (rolling_vol_14 + 1e-5)`

However, for the hard Boolean trigger `ACTIVE_BULLISH / ACTIVE_BEARISH`, the calculation uses strictly the **Taker Volume (Aggressive Market Orders)**.

### Hard-Coded Threshold
The baseline threshold for displacement to flip to `ACTIVE` is a **2.5x multiplier** (250%). The latest 15-minute Taker Buy (or Sell) volume must exceed the average Taker volume of the prior 14 candles by 2.5x.

**Code Snippet Reference (`api/index.py` & `quant_engine_api.py`):**
```python
# OLS Statistical Multiplier calculation
df['rolling_vol_14'] = df['v'].rolling(window=14, min_periods=1).mean()
df['anomaly_multiplier'] = df['v'] / (df['rolling_vol_14'] + 1e-5)

# Hard Activation Trigger (Taker Volume Based)
avg_buy_vol = prior_14['taker_buy_vol'].mean()
latest_buy_vol = latest_closed['taker_buy_vol']
is_bullish = latest_closed['c'] > latest_closed['o']

if is_bullish and latest_buy_vol > (avg_buy_vol * 2.5) and avg_buy_vol > 0:
    status = 'ACTIVE_BULLISH'
```

---

## 5. Resting Magnets (BSL/SSL)

### High-Concentration Node Identification
The engine reads the raw Binance limit order book (`fapi/v1/depth?limit=1000`). It ignores standard deviations or relative depth completely. Instead, it sorts the entire array of limit orders strictly by **absolute size/quantity** and blindly takes the **Top 3 Largest Orders** for BSL (Asks) and SSL (Bids).

### Threshold Metrics
There is **no fixed USD value** or relative standard deviation threshold. It purely sorts the raw arrays by sheer coin quantity at a specific price point and isolates the top 3 pools.

**Code Snippet Reference (`src/lib/orderFlowEngine.ts`):**
```typescript
const bids = data.bids || [];
const asks = data.asks || [];

// Sorts bids purely by volume size (index 1 is quantity) and slices top 3
const sortedBids = [...bids].sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
const topBids = sortedBids.slice(0, 3).map(bid => parseFloat(bid[0]));

const sortedAsks = [...asks].sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
const topAsks = sortedAsks.slice(0, 3).map(ask => parseFloat(ask[0]));

return {
  BSL_Magnets: topAsks,
  SSL_Magnets: topBids,
};
```

---

## 💡 Additional Key Findings (Audit Bonus)

1. **Strict Timezone Manipulation (`utcPlus3OffsetMs`)**: The engine programmatically intercepts all Binance timestamps and shifts them by `+3 hours` locally within the Node backend to ensure the engine inherently obeys Cairo/Eastern Europe (`UTC+3`) timezone characteristics, primarily to lock the 07:00 True Day Open anchor dynamically.
2. **OLS Tiered Confidence Constraints**: Although Displacement can be flagged as `ACTIVE_BULLISH/BEARISH` by hitting the 2.5x Taker Volume requirement, the engine's `TradeExecutionParameters` will explicitly **downgrade risk to `HALF_RISK_OR_STAND_DOWN`** if the underlying OLS regression does not produce a p-value `< 0.15` and a t-statistic `> 1.96` (`confidence_interval_95` flag).
3. **SMT Divergence Engine (Equal Highs)**: The engine searches the last 20 candles (15m timeframe) for Swing Highs. If two swing highs exist within exactly **$0.50** of each other, it flags them as an `engineered_liquidity` SMT trap.
