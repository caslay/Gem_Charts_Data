Viewed structureLayer.ts:96-140

I will view the `src/lib/structureEngine.ts` file to retrieve the exact functions, variable names, and logic gates that govern the market structure calculations.

Viewed structureEngine.ts:1-800

I will read the rest of the `src/lib/structureEngine.ts` file to review all subsequent logic, including the Retracement Gate and trend state updates.

Viewed structureEngine.ts:801-1119

I will search the codebase for references to `retracement` to see how the "Retracement Gate" validation is mathematically implemented.

Searched for "retracement"

I will view lines 250 to 300 of `src/hooks/useStrategyEvaluator.ts` to examine the mathematical execution of the Retracement Gate / Equilibrium check in strategy evaluations.

Viewed useStrategyEvaluator.ts:1-788

# 🏛️ Flow-State Quant Engine V10.52 — Deep-Dive Logic Report
## Quantitative Audit of Macro Trend State Machine (Layer 1)

This report details the mathematical foundations, state machine transitions, containment rules, and visual parity layers governing the **Macro Trend (Layer 1)** within the `Gem_Charts_Data` project. 

---

### 1. Foundational Fractal Math (Major 5-Bar Fractal)
The foundational fractal math is defined in the pure-logic quant engine:
*   **File:** `src/lib/structureEngine.ts`
*   **Function:** `runEquilibriumStateMachine` (lines 156–755)

```typescript
// Line 164
const span = volMultiplier >= 2.0 ? 2 : 1; // MAJOR (5-bar fractal, span = 2), INNER (3-bar fractal, span = 1)
```

#### Price-Extreme Comparison Logic (Lines 176–220)
For a **Major 5-Bar Fractal** (`volMultiplier = 2.0`), `span` is set to `2`. The comparison logic executes a directional rolling window scanner over the candle high/low extremes:

```typescript
// Check Swing High
let isHigh = true;
for (let j = 1; j <= span; j++) {
  if (curr.h <= candles[i - j].h || curr.h <= candles[i + j].h) {
    isHigh = false;
    break;
  }
}

// Check Swing Low
let isLow = true;
for (let j = 1; j <= span; j++) {
  if (curr.l >= candles[i - j].l || curr.l >= candles[i + j].l) {
    isLow = false;
    break;
  }
}
```

*   **Color-Blind Macro Anchors:** Initial raw fractals are identified purely by mathematical extremes (`curr.h` and `curr.l`). The script evaluates no candle color rules (such as color-closed locks or color validation) inside this initial raw scanner. It operates color-blindly to establish mathematical extremes.
*   **2-Candle Closed Lag:** To enforce **0% repainting** on the historical scale, the engine applies a closed-state verification lag:
    ```typescript
    confirmed: isCandleClosed(i + span) // resolves to i + 2 for Major Swings
    ```
    This gates the confirmation of pivot `i` until the subsequent two candles (`i + 1` and `i + 2`) are fully closed (`isClosed !== false`). Unconfirmed fractals are kept in `unconfirmedRawSwings` and are isolated from trend evaluations.

---

### 2. Trend State Machine & Flip Logic
*   **File:** `src/lib/structureEngine.ts`
*   **Segment Loop:** Lines 323–378 (iterates chronologically over `majorSwingsOnly`).

#### Exact Conditions to Flip `MARKET_TREND` from `BULLISH` to `BEARISH`
The state machine flips `trend` from `BULLISH` to `BEARISH` when a newly confirmed structural swing of type `LOW` breaches the price of the prior confirmed swing low:

```typescript
// Lines 347-354
const priorLow = i >= 1 ? majorSwingsOnly[i - 1] : null;
if (priorLow && to.price < priorLow.price) {
  if (trend === 'BEARISH') {
    label = 'BOS';
    trendAfter = 'BEARISH';
  } else if (trend === 'BULLISH') {
    label = 'MSS';          // <-- The Shift (Flip Logic)
    trendAfter = 'BEARISH';  // <-- MARKET_TREND transitions to BEARISH
  } else {
    trendAfter = 'BEARISH';
  }
```

#### Distinguishing Between MSS and BOS at the Macro Level
The engine separates structural transitions mathematically based on the active trend context:
1.  **BOS (Break of Structure):** Trend continuation. A confirmed swing extreme breaks a prior pivot of the *same type* in the *same direction* as the active trend.
    *   *Bullish BOS:* `to.type === 'HIGH'`, `to.price > priorHigh.price`, and `trend === 'BULLISH'`.
    *   *Bearish BOS:* `to.type === 'LOW'`, `to.price < priorLow.price`, and `trend === 'BEARISH'`.
2.  **MSS (Market Structure Shift):** Trend reversal. A confirmed swing extreme breaks a prior pivot of the *same type* *against* the direction of the active trend.
    *   *Bullish MSS (Reversal to Upside):* `to.type === 'HIGH'`, `to.price > priorHigh.price`, and `trend === 'BEARISH'`.
    *   *Bearish MSS (Reversal to Downside):* `to.type === 'LOW'`, `to.price < priorLow.price`, and `trend === 'BULLISH'`.

#### Updating the Active Containment Range Boundaries
The local variables `currentMajorHigh` and `currentMajorLow` govern the active containment boundary. They are updated inside the `runEquilibriumStateMachine` containment loops:

```typescript
// Lines 292-302
if (s.price >= currentMajorLow && s.price <= currentMajorHigh) {
  structure_type = 'INTERNAL';
} else {
  structure_type = 'MAJOR';
  if (s.type === 'HIGH' && s.price > currentMajorHigh) {
    currentMajorHigh = s.price; // Update high containment boundary
  } else if (s.type === 'LOW' && s.price < currentMajorLow) {
    currentMajorLow = s.price;  // Update low containment boundary
  }
}
```
Stateful persistent rehydration is then cached at the end of the stateful analysis:
```typescript
// Lines 1103-1115
if (analysis.dealingRange) {
  globalAnchorsCache.set(cacheKey, {
    high: analysis.dealingRange.high,
    low: analysis.dealingRange.low,
    equilibrium: analysis.dealingRange.equilibrium,
    current_status: analysis.dealingRange.current_status,
    anchor_high_swing: analysis.dealingRange.anchor_high_swing,
    anchor_low_swing: analysis.dealingRange.anchor_low_swing,
    current_trend: analysis.currentTrend,
    sub_trend: analysis.subTrend || 'UNSET'
  });
}
```

---

### 3. The Retracement Gate (0.50 Equilibrium)
The mathematical relationship between the Macro Trend and the **0.50 Equilibrium level** defines premium/discount valuations:

$$\text{Equilibrium} = \frac{\text{Dealing Range High} + \text{Dealing Range Low}}{2}$$

*   **Discount Zone:** $\le \text{Equilibrium}$ (Bullish execution environment).
*   **Premium Zone:** $\ge \text{Equilibrium}$ (Bearish execution environment).

#### Proof of the Retracement Gate Validation
In `src/hooks/useStrategyEvaluator.ts` (lines 270–334), the `PRICE_IN_OTE` metric implements the Retracement Gate:

```typescript
// Lines 288-309
if (trend === 'BULLISH') {
  if (zone === 'OTE') {
    const minOte = high - 0.79 * (high - low);
    const maxOte = high - 0.62 * (high - low);
    return price >= minOte && price <= maxOte;
  }
  if (zone === 'FIB_50') {
    const level = high - 0.50 * (high - low); // 0.50 Equilibrium level
    return price <= level; // Must tap Discount to validate the gate
  }
  // ...
```

*   **The Tap Proof:** In institutional trading, a trend expansion (BOS) is not mathematically sponsored unless the pricing engine registers a counter-trend retracement that taps or crosses the 0.50 Equilibrium midpoint (retracing into Discount for long structures, or Premium for short structures). Attempted breakouts without a retracement gate tap are treated as low-sponsorship traps and rejected.
*   **Runaway Momentum Bypass:** During extreme momentum states, the engine softens/bypasses this gate:
    ```typescript
    // Lines 270-277
    case 'PRICE_IN_OTE': {
      const isObj = !Array.isArray(strategy.conditions);
      const momentumOverride = isObj ? !!strategy.conditions.momentum_override : false;
      const expansionMode = ipda.expansion_mode || 'NORMAL';
      
      if (momentumOverride && expansionMode === 'RUNAWAY') {
        return true; // Bypass Equilibrium retracement gate
      }
    ```

---

### 4. Taxonomy & Layer Isolation
To prevent internal sub-waves (Layer 2 & Layer 3) from bleeding into the Macro Trend state, the engine maintains strict visual and logical isolation:

#### Logical Decoupling
The engine processes two completely independent instances of `runEquilibriumStateMachine`:
1.  **Major Series (Layer 1 & Layer 2):** Calls the state machine with `volMultiplier = 2.0` (span = 2, representing color-blind 5-bar fractals).
2.  **Inner Series (Layer 3):** Calls the state machine with `volMultiplier = 1.0` (span = 1, representing 3-bar fractals).

#### Containment Rule & Trend Filtration
Within the Major Series, swings are tagged as `INTERNAL` (Layer 2) if their extremes reside within the active major range. The engine explicitly filters out these internal swings before calculating the `MARKET_TREND` or structural zig-zag paths:

```typescript
// Lines 309-311
const majorSwingsOnly = volMultiplier < 2.0
  ? markedConfirmedSwings
  : markedConfirmedSwings.filter(s => s.structure_type === 'MAJOR'); // Isolates Layer 2
```

#### Historical Bounds Isolation (`majorRangeStartTime`)
To prevent historical child waves from corrupting the current dealing range calculations, the engine boundaries are isolated chronologically:

```typescript
// Lines 529-537
let majorRangeStartTime = 0;
if (dealingRange && dealingRange.anchor_high_swing && dealingRange.anchor_low_swing) {
  majorRangeStartTime = Math.min(dealingRange.anchor_high_swing.t, dealingRange.anchor_low_swing.t);
}

// Filter internal swings to only those that formed within the active Major Dealing Range
const activeInternalSwings = majorRangeStartTime > 0
  ? internalSwingsOnly.filter(s => s.t >= majorRangeStartTime) // Bounds Isolation
  : internalSwingsOnly;
```
This isolates Layer 2 pivots, ensuring that any child waves formed before the current macro anchors were locked do not bleed into the active intraday pricing metrics.

---

### 5. Visual Parity (Render Translation)
The state mappings are translated visually into SVG graphics inside `src/lib/chartLayers/plugins/structureLayer.ts`:

#### Pivot Circles ("Hollow Circles")
Pivots are drawn as hollow circles using the mapped coordinates (`pt.x`, `pt.y`):

```typescript
// Lines 515-535 in structureLayer.ts
mappedSwings
  .filter((s) => {
    if (s.grade !== 'MAJOR') return false;
    const isInternal = s.structure_type === 'INTERNAL';
    if (isInternal) {
      return showInternalSwings && !isVolatilitySuppressed;
    } else {
      return showMajor;
    }
  })
  .map((pt, idx) => {
    return React.createElement('circle', {
      key: `major-swing-${idx}`,
      cx: pt.x,
      cy: pt.y,
      r: 4.5,
      stroke: color,
      strokeWidth: 1.5,
      fill: 'none', // Hollow anchor
    });
  })
```

#### Price Ceilings & Floors ("Solid / Dashed Lines")
Alternating swing boundaries are drawn as horizontal rays running from the pivot coordinate `S.x` to the breach point `xEnd`:

```typescript
// Lines 120-131 in structureLayer.ts
// Draw structural price line
horizontalLevels.push(
  React.createElement('line', {
    key: `hz-level-line-${idx}`,
    x1: S.x,
    y1: S.y,
    x2: xEnd,
    y2: S.y,
    stroke: color,
    strokeWidth: isInternal ? 0.9 : 1.5, // Thinner lines for child waves
    strokeDasharray: isInternal ? '3,3' : undefined, // Solid for Parent, Dashed for Child
  })
);
```

#### Labels on HUD
Labels are rendered next to the lines at `S.x + 4`, offset vertically by `-4` (above highs) or `+10` (below lows):

```typescript
// Lines 134-149 in structureLayer.ts
horizontalLevels.push(
  React.createElement(
    'text',
    {
      key: `hz-level-label-${idx}`,
      x: S.x + 4,
      y: S.type === 'HIGH' ? S.y - 4 : S.y + 10,
      fill: color,
      fontSize: '6.5',
      fontFamily: 'monospace',
      fontWeight: 'bold',
    },
    isInternal
      ? (S.type === 'HIGH' ? 'INT HIGH' : 'INT LOW')
      : (S.type === 'HIGH' ? 'MAJOR HIGH' : 'MAJOR LOW')
  )
);
```