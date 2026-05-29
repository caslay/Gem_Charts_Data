# 📈 Flow-State Quant Engine - Deep-Code Extraction Report

This report provides the exact raw math, logic gates, and variables implemented in the backend services of the `Gem_Charts_Data` project that are currently unexposed or "dark" in the front-end Strategy Builder UI (`EquationBuilder.tsx`) or the Sidebar HUD.

---

## 1. The "Hidden" Order Flow Math

### A. Cumulative Volume Delta (CVD) Logic
In both the TypeScript backend (`displacementEngine.ts`) and the Python microservice (`api/index.py` / `quant_engine_api.py`), **there is no cumulative lookback summation** (such as a rolling sum or rolling integral) for Cumulative Volume Delta (CVD). Instead, the system computes the raw volume delta exclusively for the current candle:

$$\text{Volume Delta} = \text{taker\_buy\_vol} - \text{taker\_sell\_vol}$$

**TypeScript Implementation (`src/lib/displacementEngine.ts` Line 62):**
```typescript
const volume_delta = parseFloat((latestBuyVol - latestSellVol).toFixed(2));
```

**Python Implementation (`api/index.py` Line 85):**
```python
df['volume_delta'] = df['taker_buy_vol'] - df['taker_sell_vol']
```

### B. "Liquidation Sensitivity" Threshold
The order flow engine queries Binance's force liquidation orders in the last hour. If the sum of long and short liquidations in USD is **strictly greater than $1,000,000**, the status flips to `LIQUIDITY_SWEPT`.

**TypeScript Implementation (`src/lib/orderFlowEngine.ts` Lines 180-184):**
```typescript
liquidation_events = {
  last_hour_purged,
  status: totalPurged > 1_000_000 ? 'LIQUIDITY_SWEPT' : 'NORMAL'
};
```

---

## 2. The SMT Tick-Precision Gate

### A. Equal Highs/Lows Constant
The tick-tolerance buffer for identifying "Equal Highs/Lows" (or SMT traps) is **not strictly $0.50**. It is a dynamic, volatility-adjusted buffer based on the 15-minute Average True Range (ATR). If the ATR is unavailable or $\le 0$, the engine falls back to a static threshold of **$0.50**:

$$\text{SMT Buffer} = \begin{cases} 0.2 \times \text{ATR}(15m), & \text{if } \text{ATR} > 0 \\ 0.50, & \text{otherwise} \end{cases}$$

**TypeScript Implementation (`src/app/api/market-data/route.ts` Lines 402-408):**
```typescript
const smtAtr = calculateATR(candles15m);
const smtBuffer = smtAtr > 0 ? 0.2 * smtAtr : 0.50;

const smt_traps = [];
for (let i = 0; i < swingHighs.length; i++) {
  for (let j = i + 1; j < swingHighs.length; j++) {
    if (Math.abs(swingHighs[i].price - swingHighs[j].price) <= smtBuffer) {
```

### B. SMT Correlation Coefficient Handling
The engine **does not calculate any mathematical correlation coefficient** (such as Pearson's $r$, rolling covariance, or beta) between BTC and ETH before flagging SMT divergence. Instead, SMT divergence is checked using pure directional price-action logic gates:

* **Bullish Divergence Gate:** ETH makes a lower low while BTC makes a higher low relative to their respective reference windows.
* **Bearish Divergence Gate:** ETH makes a higher high while BTC makes a lower high.

**TypeScript Implementation (`src/lib/smtEngine.ts` Lines 41-49):**
```typescript
// BULLISH MICRO SMT check
if (ethTarget.l < ethRefLow && btcTarget.l > btcRefLow) {
  return 'BULLISH_CONFIRMED';
}

// BEARISH MICRO SMT check
if (ethTarget.h > ethRefHigh && btcTarget.h < btcRefHigh) {
  return 'BEARISH_CONFIRMED';
}
```

---

## 3. The OLS Python Payload

### A. Returned OLS Metrics
Beyond the $t$-statistic (`t_statistic`) and $p$-value (`p_value`), the Python microservice does **not** return R-squared ($R^2$), Standard Error, or Residual Anomaly detection in its output payload. The payload model is strictly constrained to statsmodels output.

**Python Implementation (`api/index.py` Lines 184-190):**
```python
return DisplacementResponse(
    status=status,
    anomaly_multiplier=anomaly_multiplier_val,
    volume_delta=volume_delta_val,
    statistical_validation={
        "t_statistic": float(round(t_statistic, 4)),
        "p_value": float(round(p_value, 4)),
        "confidence_level": confidence_level,
        "confidence_interval_95": confidence_interval_95,
        "confidence_interval_95_strict": confidence_interval_95_strict
    }
)
```

### B. Confidence Level Logic
The raw $p$-value obtained from statsmodels' OLS fit on the `anomaly_multiplier` is translated into a `confidence_level` string using these exact gates:

* **`HIGH`**: $p\text{-value} < 0.05$
* **`MEDIUM`**: $0.05 \le p\text{-value} < 0.15$
* **`LOW`**: $p\text{-value} \ge 0.15$ (also defaults to `LOW` in price consolidation or error states)

**Python Implementation (`api/index.py` Lines 130-140):**
```python
if p_value < 0.05:
    confidence_level = "HIGH"
elif p_value < 0.15:
    confidence_level = "MEDIUM"
else:
    confidence_level = "LOW"
    
# Backward compatibility: Confidence Interval validation: p-value < 0.15 and t_statistic > 1.96
confidence_interval_95 = bool(p_value < 0.15 and t_statistic > 1.96)
confidence_interval_95_strict = bool(p_value < 0.05 and t_statistic > 1.96)
```

---

## 4. The "Runaway" Momentum Trigger

### A. `MARKET_VELOCITY` Calculation
`MARKET_VELOCITY` represents the count of active **unmitigated** Fair Value Gaps (BISI for Bullish trend states, SIBI for Bearish trend states) on the active chart timeframe.

### B. `RUNAWAY` Expansion Mode Conditions
The system transitions to `expansion_mode = 'RUNAWAY'` when:
1. Institutional displacement is active (`status` contains `ACTIVE`).
2. The displacement `anomaly_multiplier` is strictly greater than **`4.0`**.
3. There are **at least `2`** active unmitigated FVGs in the dominant direction on the active timeframe (`market_velocity >= 2`).

**TypeScript Implementation (`src/lib/structureEngine.ts` Lines 452-470):**
```typescript
if (dispActive && dispMult > 4.0) {
  const dispDir = displacementStatus?.status.includes('BULLISH') ? 'BULLISH' : 'BEARISH';
  // Count active unmitigated FVGs in the dominant direction on the active timeframe
  const fvgs = detectActiveFVGs(candles, true);
  const matchingFvgs = fvgs.filter((f: any) => f.type === (dispDir === 'BULLISH' ? 'BISI' : 'SIBI'));
  market_velocity = matchingFvgs.length;

  if (market_velocity >= 2) {
    expansion_mode = 'RUNAWAY';
    // Find oldest FVG in matchingFvgs to establish the Origin Low/High
    if (matchingFvgs.length > 0) {
      const oldestFvg = matchingFvgs.reduce((oldest: any, fvg: any) => fvg.origin_time < oldest.origin_time ? fvg : oldest, matchingFvgs[0]);
      const originCandle = candles.find(c => c.t === oldestFvg.origin_time);
      if (originCandle) {
        runaway_origin_price = dispDir === 'BULLISH' ? originCandle.l : originCandle.h;
      }
    }
  }
}
```

### C. FVG Gravitational Weight / Time-Decay Factor
**There is no time-decay or distance-decay factor** implemented for FVGs in the source code. FVGs do not lose weight over time. The only way an FVG is mitigated (and removed from `MARKET_VELOCITY`) is when a subsequent candle's wick enters the imbalance zone.

**TypeScript Implementation (`src/lib/fvgEngine.ts` Lines 39-54):**
```typescript
let isMitigated = false;
// V8.5 — Strict Wick-Scanning: subsequent candles whose wicks enter the imbalance zone mitigation
for (let j = i + 3; j < candles.length; j++) {
  const future = candles[j];
  if (type === 'BISI' && future.l <= top) {
    isMitigated = true;
    break;
  }
  if (type === 'SIBI' && future.h >= bottom) {
    isMitigated = true;
    break;
  }
}
```

---

## 5. UI Leak Audit ("Dark" Variables)

The following variables are calculated by the backend and returned inside `ipda_metrics` or `order_flow_engine` payloads, but are **not** mapped or selectable as logical options or triggers in the `EquationBuilder.tsx` strategy editor:

1. **`ipda_metrics.expansion_mode`**: Tracks the binary state `'NORMAL'` or `'RUNAWAY'`. While `MARKET_VELOCITY` (number of FVGs) is exposed, the stateful override status itself is hidden.
2. **`ipda_metrics.runaway_origin_price`**: Calculates the precise price level where a runaway momentum move originated (based on the oldest FVG low/high). 
3. **`order_flow_engine.smart_money_sentiment.funding_rate_status`**: Identifies extremes in retail futures positioning (`'HIGHLY_POSITIVE_RETAIL_LONG'` or `'NEGATIVE_RETAIL_SHORT'`).
4. **`order_flow_engine.smart_money_sentiment.smart_money_divergence`**: A boolean flag indicating if top account ratios (institutionals) are actively trading against retail funding rate sentiment.
5. **`order_flow_engine.liquidation_events.status`** and **`last_hour_purged`**: Tracks forced futures liquidations. The specific values (e.g., `'1.2M_USD_LONGS_PURGED'`) and swept state (`LIQUIDITY_SWEPT`) are calculated but missing as builder conditions.
6. **`ipda_metrics.smt_context.btc_relative_strength`**: Determines whether BTC is currently acting as a `'LEADER'` or `'LAGGARD'` relative to its distance from True Day Open.
7. **`ipda_metrics.smt_context.macro_bias_sync`**: Indicates if macro biases are `'SYNCED'` or `'DECOUPLED'` across BTC/ETH correlation boundaries.
8. **`ipda_metrics.pricing_context.nearest_htf_magnet`**: Exposes the label and distance of the closest HTF liquidity magnet (e.g. `PWH`, `DAILY_SIBI`) which are processed but not selectable in the strategy conditions.
9. **`ipda_metrics.projected_targets`**: Dynamic standard deviations calculated off of the Asian range dimensions (e.g. `upward_dev_1_5`, `downward_dev_2_0`).
