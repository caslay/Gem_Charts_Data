# **Technical Specification: Real-Time Algorithmic Market Structure Engine (ICT/SMC Framework)**

## **Dynamic Pivot Detection Engine**

Identifying localized price extremes (pivots) forms the computational foundation of any market structure mapping algorithm. Traditional algorithmic solutions, such as static N-period rolling window fractals, struggle with a fundamental "Lag vs. Accuracy" trade-off. A narrow, static lookback/lookahead window (N) registers high-frequency noise and minor pullbacks as major structural turns, causing false breakout signals. Conversely, an excessively wide static window introduces severe lag, delaying state transitions and structural confirmations until the expansion leg is exhausted.  
To resolve this trade-off, this engine implements a **Volatility-Adjusted Adaptive Pivot Window**. The lookback/lookahead half-width N\_t scales dynamically based on localized market volatility, compressing during high-momentum expansions to capture structural shifts with minimal latency and expanding during range-bound consolidation to filter out minor noise.

### **Mathematical Formulation of Volatility-Adjusted Pivots**

Let the price series be represented by vectors of high (H), low (L), and close (C) prices. At any discrete candlestick index t, the localized volatility metric \\sigma\_t is calculated using a normalized M-period Average True Range (ATR\_t) relative to its rolling median over a wider lookback horizon K:  
The adaptive pivot window half-width N\_t \\in \\mathbb{N} is defined at each step by:  
Where:

* N\_{\\text{base}} is the baseline lookback/lookahead parameter (e.g., 5 bars).  
* N\_{\\text{min}} and N\_{\\text{max}} are hard operational limits designed to preserve computational boundaries (typically N\_{\\text{min}} \= 3, N\_{\\text{max}} \= 15).  
* \\text{clamp}(x, a, b) \= \\max(a, \\min(x, b)).

A Volatility-Adjusted Swing High (SH\_i) is identified at index i \= t \- N\_i if and only if:  
A Volatility-Adjusted Swing Low (SL\_i) is identified at index i \= t \- N\_i if and only if:

### **Pivot Detection Profiles and Performance Matrix**

The dynamic pivot engine adapts its parameters across different market regimes to optimize detection latency and prevent structural misidentification.

| Parameter Configuration / Regime | Adaptive Half-Width N\_t | Detection Lag (Bars) | Noise Filtering Efficiency | Target Structural Behavior |
| :---- | :---- | :---- | :---- | :---- |
| **High Volatility / Momentum Expansion** (ATR\_t \> 1.5 \\bar{\\sigma}\_t) | N\_t \\to N\_{\\text{min}} (typically 3\) | 3 bars | High (due to rapid displacement) | Real-time trend reversals, news spikes |
| **Normal Volatility / Steady Trend** (0.8 \\bar{\\sigma}\_t \\le ATR\_t \\le 1.5 \\bar{\\sigma}\_t) | N\_t \\approx N\_{\\text{base}} (typically 5\) | 5 bars | Very High | Standard swing mapping |
| **Low Volatility / Range Compression** (ATR\_t \< 0.8 \\bar{\\sigma}\_t) | N\_t \\to N\_{\\text{max}} (typically 15\) | 15 bars | Maximum | Consolidation filtering, accumulation zones |

This mathematical adaptation ensures that during highly directional breakouts, the detection lag is compressed to its absolute theoretical minimum (N\_{\\text{min}}), whereas during compressive ranges, the window expands to prevent the engine from generating false inner-range pivots.

## **Multi-Tiered Structure Hierarchy and Inducement Logic**

Smart Money Concepts (SMC) categorize market movements into distinct hierarchical tiers to filter out localized price action and identify institutional trend continuations. This engine implements a strict three-tier structural architecture:

1. **Minor Pullbacks (Candlestick Level)**: The basic relationship between successive bars.  
2. **Internal Structure (Micro Level)**: Sub-swings and pullbacks that occur within the validated high-to-low range of a higher-timeframe expansion leg.  
3. **Swing Structure (Macro Level)**: High-probability structural boundaries that are confirmed exclusively when the market sweeps the liquidity of the nearest internal structure extreme, known as **Inducement (IDM)**.

### **Mathematical Definition of a Valid Pullback**

An inducement level cannot be identified without first establishing a valid pullback. Pullback identification requires a strict candlestick-level analysis, bypassing visual approximations.

* **Bullish Expansion Leg Pullback**: For a rising leg, a valid pullback is initiated if and only if the absolute low of the highest candle in that leg is breached by a subsequent candle. Let i\_{\\text{max}} be the index of the candle with the maximum high price in the current unconfirmed bullish leg:

A pullback is validated at index t if:

* **Bearish Expansion Leg Pullback**: For a falling leg, a valid pullback is initiated if and only if the absolute high of the lowest candle in that leg is breached by a subsequent candle. Let i\_{\\text{min}} be the index of the candle with the minimum low price in the current unconfirmed bearish leg:

A pullback is validated at index t if:  
Any candle classified as an **Inside Bar** is omitted when resolving the reference indices i\_{\\text{max}} and i\_{\\text{min}} to prevent false pullback triggers.

### **The Inducement (IDM) Confirmation Gate**

Inducement is defined as the extreme price level of the *first valid pullback* from the absolute peak or trough of the active expansion leg.  
`Uptrend: Confirmed Swing High Formation`  
                       `[Candidate[span_34](start_span)[span_34](end_span)[span_42](start_span)[span_42](end_span) High] (Unconfirmed)`  
                             `/\`  
                            `/  \`  
                           `/    \  [First Pullback]`  
                          `/      \──────┐  ◄─── Active IDM Level (Pullback Low)`  
                         `/              │`  
                        `/               ▼`  
                       `/          (Low_t < IDM)`  
                      `/                 │`  
                     `/                  ▼`  
 `────────┘         SWING HIGH CONFIRMED!`

A temporary candidate swing high or swing low remains unconfirmed and is excluded from macro-structure calculations until price action sweeps the active inducement level, harvesting retail stop losses clustered at that pivot.

* **Swing High Confirmation (Uptrend)**: Let H\_{\\text{cand}} be an unconfirmed candidate high printed at index i\_{\\text{cand}}. Let IDM\_{\\text{bullish}} be the lowest low of the most recent valid pullback formed prior to H\_{\\text{cand}}. The candidate high is confirmed and locked as a structural **Swing High (SH)** at index t if and only if a subsequent candle low sweeps or closes below this inducement level :  
* **Swing Low Confirmation (Downtrend)**: Let L\_{\\text{cand}} be an unconfirmed candidate low printed at index i\_{\\text{cand}}. Let IDM\_{\\text{bearish}} be the highest high of the most recent valid pullback formed prior to L\_{\\text{cand}}. The candidate low is confirmed and locked as a structural **Swing Low (SL)** at index t if and only if a subsequent candle high sweeps or closes above this inducement level :

### **Inducement Shift Mechanism**

If the market continues its expansion in the trend direction without sweeping the existing IDM level, the inducement level must shift dynamically to the extreme point of the newest valid pullback, updating the target validation threshold.

## **State Machine for Structure Transitions**

The market structure engine operates as a deterministic, real-time Finite State Machine (FSM). It processes incoming bar data sequentially, maintains structural state variables, and executes state transitions to register continuation events (Break of Structure \- BOS) or reversal events (Market Structure Shift \- MSS / Change of Character \- CHoCH).

### **State Variables Definition**

The engine's global memory state is preserved in a structured class containing the following primary state variables:

| State Variable | Data Type | Functional Description |
| :---- | :---- | :---- |
| current\_trend\_state | Enum | \`\` \- Denotes active macro structural bias. |
| active\_swing\_high | Float | Price level of the most recently confirmed structural Swing High. |
| active\_swing\_low | Float | Price level of the most recently confirmed structural Swing Low. |
| candidate\_high | Float | Absolute highest price recorded in the active unconfirmed bullish expansion leg. |
| candidate\_low | Float | Absolute lowest price recorded in the active unconfirmed bearish expansion leg. |
| active\_idm\_level | Float | Active price threshold used to validate candidate swing points. |
| protected\_high | Float | Strong structural defense level; violation triggers a trend reversal (CHoCH). |
| protected\_low | Float | Strong structural defense level; violation triggers a trend reversal (CHoCH). |

### **FSM Transition Table and Transition Logic**

At each candle close, the engine evaluates price action against the active trend state using the following FSM transition rules:

| Source State | Trigger Condition | Target State | Registered Event | Structural State Mutators |
| :---- | :---- | :---- | :---- | :---- |
| **BULLISH\_SWING** | C\_t \> \\text{active\\\_swing\\\_high} | **BULLISH\_SWING** (Continuation) | **BULLISH\_BOS** | protected\_low \= active\_swing\_low (lowest point of the trend run) ; active\_swing\_high \= \\infty (reset). |
| **BULLISH\_SWING** | C\_t \< \\text{protected\\\_low} | **BEARISH\_SWING** (Reversal) | **BEARISH\_CHoCH** | \[span\_121\](start\_span)\[span\_121\](end\_span)\[span\_125\](start\_span)\[span\_125\](end\_span)\[span\_129\](start\_span)\[span\_129\](end\_span)protected\_high \= active\_swing\_high ; active\_swing\_low \= L\_t; current\_trend\_state \= BEARISH\_SWING. |
| **BEARISH\_SWING** | C\_t \< \\text{active\\\_swing\\\_low} | **BEARISH\_SWING** (Continuation) | **BEARISH\_BOS** | protecte\[span\_122\](start\_span)\[span\_122\](end\_span)\[span\_126\](start\_span)\[span\_126\](end\_span)\[span\_130\](start\_span)\[span\_130\](end\_span)d\_high \= active\_swing\_h\[span\_95\](start\_span)\[span\_95\](end\_span)\[span\_102\](start\_span)\[span\_102\](end\_span)igh (highest point of the trend run) ; active\_swing\_low \= \-\\infty (reset). |
| **BEARISH\_SWING** | C\_t \> \\text{protected\\\_high} | **BULLISH\_SWING** (Reversal) | **BULLISH\_CHoCH** | protected\_low \= ac\[span\_123\](start\_span)\[span\_123\](end\_span)\[span\_127\](start\_span)\[span\_127\](end\_span)\[span\_131\](start\_span)\[span\_131\](end\_span)tive\_swing\_low ; \[span\_109\](start\_span)\[span\_109\](end\_span)active\_swing\_high \= H\_t; current\_trend\_state \= BULLISH\_SWING. |

### **Mathematical Definition of Displacement (MSS vs. CHoCH)**

While a Change of Character (CHoCH) represents any structural break of the protected swing high or low, a Market Structure Shift (MSS) requires **displacement**. Displacement is defined as an impulsive breakout characterized by wide-bodied candles with high relative volume and minimal wick representation, signaling institutional momentum.  
To quantify displacement mathematically, the engine calculates the **Candle Body Ratio (BR\_t)** and the **Volume Expansion Factor (VEF\_t)**:  
A transition is classified as an **MSS (High Confidence)** rather than a standard **CHoCH (Low Confidence)** if and only if:  
Where the standard optimized thresholds are defined as:

* \\theta\_{\\text{body}} \= 0.70 (the breakout candle's real body must comprise at least 70% of its total range).  
* \\the\[span\_147\](start\_span)\[span\_147\](end\_span)ta\_{\\text{volume}} \= 1.50 (breakout volume must be at least 150% of the simple moving average of volume over V\_{\\text{lookback}} \= 20 periods).

## **Validation Filters and Anti-Fakeout Architecture**

To minimize the impact of high-frequency noise, institutional stop-hunts, and range-bound volatility compression, the engine employs a multi-layered validation and anti-fakeout filter.

### **Body Closure vs. Wick Sweep Filter**

A Break of Structure (BOS) or Change of Character (CHoCH) is validated if and only if the breakout candle's body closes beyond the reference swing level. If the price penetrates the reference level with its wick but closes back within the established structural range, the event is flagged as a **Wick Sweep (Liquidity Grab)** and the state machine's structural state remains unchanged.  
Let P\_{\\text{ref}} be the active price boundary of the structural extreme (e.g., active\_swing\_high in an uptrend, or protected\_low during a reversal evaluation). At the close of candle t, the logic gate evaluates as follows:

* **Bullish Breakout Validation Logic Gate**:

$$\\text{Trigger STRUCTURAL\_BREAK (BOS / CHoCH) Event } $$

* **Bearish Breakout Validation Logic Gate**:

$$\\text{Trigger STRUCTURAL\_BREAK (BOS / CHoCH) Event } $$

### **Inside Bar Mitigation Filter**

Inside bars represent local market consolidation and volatility contraction, offering no structural information about trend expansion. If these bars are not filtered, they can trigger false pullback validations, corrupting the active inducement levels.  
An *Inside Bar* at index t relative to a parent mother bar at index m is defined mathematically as:  
The engine implements a recursive filtering mechanism to bypass inside bars:  
`If Inside_Bar_t Evaluates to True:`  
    `Flag candle t as inside_bar = true`  
    `Retain index m as the active reference for all subsequent pullback and pivot checks [span_192](start_span)[span_192](end_span)[span_193](start_span)[span_193](end_span)`  
`Else:`  
    `Set the active parent mother bar index m = t`

This recursive filter ensures that the engine only evaluates price action that breaks outside the parent candle's boundaries, preventing localized consolidation from corrupting the structural state.

### **Sharp Departure Filter (Momentum Validation)**

To confirm that a breakout is driven by institutional order flow, the engine applies a **Sharp Departure Filter** inspired by momentum validation algorithms. This filter checks if the price departs the breakout zone within a strict consolidation window (MaxConsolidation \= 5 candles).  
$$\\text{Sharp\_Departure} \= \\begin{cases} \\text{True} & \\text{if } \\exists k \\in \[1, \\text{MaxConsolidation}\] \\quad \\text{such that} \\quad \\left|C\_{t+k} \- P\_{\\text{ref}}\\right| \\ge 1.5 \\times ATR\_{t+k} \\ \\text{False} & \\text{otherwise} \\end{cases} \\quad $$  
If Sharp\_Departure evaluates to False, the breakout is flagged as a low-momentum consolidation trap, and any generated structural zones are invalidated.

## **Data Structure Architecture and Serialization**

To visualize real-time market structure on web-based charting frontends (e.g., React/Next.js using Canvas-based libraries like TradingView Lightweight Charts or SVG-based engines like D3.js) , the engine serializes its state into an optimized JSON payload.  
To ensure rendering performance and prevent DOM rendering bottlenecks, the schema uses **flat array structures with numerical indexing**. This approach allows the frontend to reference coordinates directly without parsing deeply nested objects.

### **High-Performance JSON Schema Specification**

`{`  
  `"ticker": "BTCUSD",`  
  `"timeframe": "15m",`  
  `"last_processed_index": 82045,`  
  `"engine_state": {`  
    `"current_trend_state": "BULLISH_SWING",`  
    `"protected_high": 68450.00,`  
    `"protected_low": 65120.50,`  
    `"active_swing_range": {`  
      `"low": 65120.50,`  
      `"high": 69200.00`  
    `}`  
  `},`  
  `"swing_points":,`  
  `"structural_events":,`  
  `"liquidity_zones":`  
`}`

## **Engine Processing Loop and Object-Oriented Pseudocode**

The following language-agnostic, object-oriented pseudocode defines the execution loop of the market structure engine. Designed for execution within a real-time event-driven loop or a backtesting broker engine , this code processes incoming candles sequentially, handles inside bars, updates dynamic volatility-adjusted windows, tracks inducement shifts, and evaluates state machine transitions.  
`class Candlestick {`  
    `public timestamp: number;`  
    `public open: number;`  
    `public high: number;`  
    `public low: number;`  
    `public close: number;`  
    `public volume: number;`  
`}`

`class Pivot {`  
    `public type: string; // "SWING_HIGH" | "SWING_LOW"`  
    `public index: number;`  
    `public price: number;`  
`}`

`class MarketStructureEngine {`  
    `// Configuration Parameters`  
    `private n_base: number;`  
    `private n_min: number;`  
    `private n_max: number;`  
    `private atr_period: number;`

    `// FSM State Variables`  
    `public current_trend_state: string; // "BULLISH_SWING" | "BEARISH_SWING"`  
    `public active_swing_high: number | null;`  
    `public active_swing_low: number | null;`  
    `public candidate_high: number;`  
    `public candidate_low: number;`  
    `public protected_high: number | null;`  
    `public protected_low: number | null;`  
    `public active_idm_level: number | null;`

    `// Internal Memory buffers`  
    `private candles: Candlestick;`  
    `private last_mother_bar_index: number;`  
    `private confirmed_pivots: Pivot;`  
    `private registered_events: any;`

    `constructor(base_period: number = 5, min_n: number = 3, max_n: number = 15, atr_len: number = 14) {`  
        `this.n_base = base_period;`  
        `this.n_min = min_n;`  
        `this.n_max = max_n;`  
        `this.atr_period = atr_len;`

        `this.current_trend_state = "BULLISH_SWING";`  
        `this.active_swing_high = null;`  
        `this.active_swing_low = null;`  
        `this.candidate_high = -Infinity;`  
        `this.candidate_low = Infinity;`  
        `this.protected_high = null;`  
        `this.protected_low = null;`  
        `this.active_idm_level = null;`

        `this.candles =;`  
        `this.last_mother_bar_index = 0;`  
        `this.confirmed_pivots =;`  
        `this.registered_events =;`  
    `}`

    `// Dynamic Volatility Window Calculation`  
    `private calculate_adaptive_n(current_idx: number): number {`  
        `const atr = this.compute_atr(current_idx, this.atr_period);`  
        `const rolling_median_atr = this.compute_median_atr(current_idx, 100);`  
          
        `if (rolling_median_atr === 0) return this.n_base;`  
          
        `const ratio = atr / rolling_median_atr;`  
        `const adaptive_n = Math.floor(this.n_base * (2.0 - ratio));`  
          
        `// Clamp to operational limits`  
        `return Math.max(this.n_min, Math.min(this.n_max, adaptive_n));`  
    `}`

    `// Inside Bar Filtering Gate`  
    `private is_inside_bar(current_idx: number, mother_idx: number): boolean {`  
        `const current = this.candles[current_idx];`  
        `const mother = this.candles[mother_idx];`  
        `return (current.high <= mother.high && current.low >= mother.low);`  
    `}`

    `// Ingests a new bar and executes the single-pass processing pipeline`  
    `public process_candle(candle: Candlestick): void {`  
        `this.candles.push(candle);`  
        `const t = this.candles.length - 1;`

        `if (t < 2) {`  
            `this.last_mother_bar_index = t;`  
            `return;`  
        `}`

        `// 1. Evaluate Inside Bar Mitigation Filter`  
        `if (this.is_inside_bar(t, this.last_mother_bar_index)) {`  
            `// Drop inside bar, lock parent index reference, prevent structural update`  
            `return;`  
        `} else {`  
            `// Update active parent mother bar reference index`  
            `this.last_mother_bar_index = t;`  
        `}`

        `// 2. Compute Volatility-Adjusted Window`  
        `const N_t = this.calculate_adaptive_n(t);`

        `// 3. Scan for Volatility-Adjusted Pivots`  
        `this.detect_pivots(t, N_t);`

        `// 4. Update Inducement and Swing Boundary Gates`  
        `this.update_inducement_gates(t);`

        `// 5. Evaluate FSM State Transitions`  
        `this.evaluate_state_transitions(t);`  
    `}`

    `private detect_pivots(t: number, N_t: number): void {`  
        `const check_idx = t - N_t;`  
        `if (check_idx < N_t) return;`

        `const target_high = this.candles[check_idx].high;`  
        `const target_low = this.candles[check_idx].low;`  
        `let is_swing_high = true;`  
        `let is_swing_low = true;`

        `for (let j = 1; j <= N_t; j++) {`  
            `if (this.candles[check_idx - j].high > target_high || this.candles[check_idx + j].high > target_high) {`  
                `is_swing_high = false;`  
            `}`  
            `if (this.candles[check_idx - j].low < target_low || this.candles[check_idx + j].low < target_low) {`  
                `is_swing_low = false;`  
            `}`  
        `}`

        `if (is_swing_high) {`  
            `this.confirmed_pivots.push({ type: "SWING_HIGH", index: check_idx, price: target_high });`  
            `if (target_high > this.candidate_high) {`  
                `this.candidate_high = target_high;`  
            `}`  
        `}`  
        `if (is_swing_low) {`  
            `this.confirmed_pivots.push({ type: "SWING_LOW", index: check_idx, price: target_low });`  
            `if (target_low < this.candidate_low) {`  
                `this.candidate_low = target_low;`  
            `}`  
        `}`  
    `}`

    `private update_inducement_gates(t: number): void {`  
        `const current = this.candles[t];`

        `if (this.current_trend_state === "BULLISH_SWING") {`  
            `// Check for Inducement Sweep`  
            `if (this.active_idm_level!== null && current.low < this.active_idm_level) {`  
                `this.active_swing_high = this.candidate_high;`  
                `this.active_idm_level = null; // Reset IDM level, swing high confirmed`  
                `this.registered_events.push({ type: "SWING_HIGH_CONFIRMED", price: this.active_swing_high, index: t });`  
            `}`

            `// Inducement Shift Mechanism`  
            `if (current.high > this.candidate_high) {`  
                `this.candidate_high = current.high;`  
                `const new_idm = this.locate_last_pullback_low(t);`  
                `if (new_idm!== null) {`  
                    `this.active_idm_level = new_idm;`  
                `}`  
            `}`  
        `}`   
        `else if (this.current_trend_state === "BEARISH_SWING") {`  
            `// Check for Inducement Sweep`  
            `if (this.active_idm_level!== null && current.high > this.active_idm_level) {`  
                `this.active_swing_low = this.candidate_low;`  
                `this.active_idm_level = null; // Reset IDM level, swing low confirmed`  
                `this.registered_events.push({ type: "SWING_LOW_CONFIRMED", price: this.active_swing_low, index: t });`  
            `}`

            `// Inducement Shift Mechanism`  
            `if (current.low < this.candidate_low) {`  
                `this.candidate_low = current.low;`  
                `const new_idm = this.locate_last_pullback_high(t);`  
                `if (new_idm!== null) {`  
                    `this.active_idm_level = new_idm;`  
                `}`  
            `}`  
        `}`  
    `}`

    `private evaluate_state_transitions(t: number): void {`  
        `const current = this.candles[t];`

        `if (this.current_trend_state === "BULLISH_SWING") {`  
            `// Evaluate Break of Structure (BOS)`  
            `if (this.active_swing_high!== null && current.close > this.active_swing_high) {`  
                `this.registered_events.push({ type: "BOS", direction: "BULLISH", level: this.active_swing_high, index: t });`  
                `this.protected_low = this.active_swing_low;`  
                `this.active_swing_high = null; // Reset swing boundary`  
                `this.candidate_high = current.high;`  
            `}`

            `// Evaluate Change of Character (CHoCH)`  
            `if (this.protected_low!== null && current.close < this.protected_low) {`  
                `const body_ratio = Math.abs(current.close - current.open) / (current.high - current.low);`  
                `const is_displaced = body_ratio >= 0.70;`  
                `const event_type = is_displaced? "MSS" : "CHoCH";`

                `this.registered_events.push({ type: event_type, direction: "BEARISH", level: this.protected_low, index: t });`  
                  
                `// Perform FSM State Mutation`  
                `this.current_trend_state = "BEARISH_SWING";`  
                `this.protected_high = this.candidate_high;`  
                `this.active_swing_low = current.low;`  
                `this.candidate_low = current.low;`  
            `}`  
        `}`   
        `else if (this.current_trend_state === "BEARISH_SWING") {`  
            `// Evaluate Break of Structure (BOS)`  
            `if (this.active_swing_low!== null && current.close < this.active_swing_low) {`  
                `this.registered_events.push({ type: "BOS", direction: "BEARISH", level: this.active_swing_low, index: t });`  
                `this.protected_high = this.active_swing_high;`  
                `this.active_swing_low = null; // Reset swing boundary`  
                `this.candidate_low = current.low;`  
            `}`

            `// Evaluate Change of Character (CHoCH)`  
            `if (this.protected_high!== null && current.close > this.protected_high) {`  
                `const body_ratio = Math.abs(current.close - current.open) / (current.high - current.low);`  
                `const is_displaced = body_ratio >= 0.70;`  
                `const event_type = is_displaced? "MSS" : "CHoCH";`

                `this.registered_events.push({ type: event_type, direction: "BULLISH", level: this.protected_high, index: t });`  
                  
                `// Perform FSM State Mutation`  
                `this.current_trend_state = "BULLISH_SWING";`  
                `this.protected_low = this.candidate_low;`  
                `this.active_swing_high = current.high;`  
                `this.candidate_high = current.high;`  
            `}`  
        `}`  
    `}`

    `// Helper math functions`  
    `private compute_atr(idx: number, len: number): number {... }`  
    `private compute_median_atr(idx: number, horizon: number): number {... }`  
    `private locate_last_pullback_low(idx: number): number | null {... }`  
    `private locate_last_pullback_high(idx: number): number | null {... }`  
`}`

## **Edge Cases and Algorithmic Hardening Protocols**

Market structures frequently exhibit anomalous, non-textbook behaviors that can compromise automated tracking systems. This engine implements specific algorithmic overrides to handle these edge cases.

### **V-Reversals (Liquidity sweeps without retracements)**

V-Reversals represent sudden, highly volatile trend shifts where the market sweeps major liquidity and reverses aggressively without establishing a standard retracement leg or dynamic pullback, leaving no inducement (IDM).  
`Anomalous V-Reversal Reversal Override`

     `(Decisive Close, Volume > 200% Median, Body Ratio >= 0.85)`  
           `/\`  
          `/  \`  
         `/    \   ◄─── No Pullback / No IDM Formed`  
        `/      \`  
       `/        \`  
`[Protected Low]  \ ───► Decisively broken with Displacement (MSS Triggered)`

* **Failure Mode**: Because no dynamic pullback forms, the engine never identifies an active IDM to sweep. This prevents the engine from confirming the swing high, leaving the trend state stuck in a stale bullish regime while price collapses.  
* **Algorithmic Override Gate**:

Evaluate momentum conditions using the **Candle Body Ratio (BR\_t)** and volume metrics:  
$$\\text{Force Confirm Swing High } SH \= \\max\\left(H \\text{ of the active expansion leg}\\right) \\quad $$

### **Extended Sideways Ranges and Volatility Compression**

During low-volatility consolidation phases, the market can generate highly compressed, range-bound candles that print repetitive, micro-pivots.

* **Failure Mode**: A standard engine will continually identify minor pullbacks, updating and shifting inducement levels rapidly within a tight range. This often results in a false structural breakout if a minor consolidation wick breaches these compressed levels.  
* **Algorithmic Override Gate**: To prevent this, the engine applies a **Minimum Leg Height** filter. A candidate swing high or low is only eligible for confirmation if the total price distance of its expansion leg is significant relative to historical volatility:

If the leg height is less than twice the current ATR, the entire range is classified as market noise. Pivot detection and inducement shifts are suspended until price expands beyond the range boundaries.

### **Inside Bar Cascades (Consecutive Nesting)**

During corrective phases, the market often prints consecutive inside bars (e.g., double, triple, or coiling inside bars).

* **Failure Mode**: If the engine resets its reference mother bar dynamically to the immediate predecessor, a compressing range can trigger false pullback detections as the inner candles drift.  
* **Algorithmic Override Gate**: The engine maintains a static reference index last\_mother\_bar\_index (m). This reference index is updated if and only if a subsequent candle close breaks completely outside the boundaries of that mother bar :

This ensures that the entire consolidation range is treated as a single unified chunk of price compression, preserving structural integrity.

### **Back-to-Back sweeps (Liquidity Hunts)**

In highly volatile regimes, the market may print consecutive liquidity sweeps, where price sweeps the candidate swing high and immediately reverses to sweep the candidate swing low within the same structural range, without printing any intermediate candle body closes.  
`Back-to-Back Sweeps (Double Liquidity Hunt)`  
                   
               `Sweep Candlestick (High_t > active_swing_high, Close_[span_176](start_span)[span_176](end_span)[span_183](start_span)[span_183](end_span)t <= active_swing_high)`  
                     `/\`  
                    `/  \`  
                   `/    \`  
                  `/      \`  
                 `/        \`  
               `=================== active_swing_high (No Close Above, State Locked)`  
               `=================== active_swing_low (No Close Below, State Locked)`  
                 `\        /`  
                  `\      /`  
                   `\    /`  
                    `\  /`  
                     `\/`  
               `Sweep Candlestick (Low_t+1 < active_swing_low, Close_t+1 >= active_swing_low)`

* **Failure Mode**: Traditional indicators may trigger multiple false trend transitions, whipsawing the state machine.  
* **Algorithmic Override Gate**: The state machine strictly isolates trend state updates from raw sweeps. Sweeps are processed as liquidity capture events and recorded in a separate database, but they are barred from modifying the active swing high or low levels.

The structural boundaries remain locked until a validated **Body Close** is registered on the chart, preserving the engine's core structural bias.

#### **Works cited**

1\. Smart Money Concept (SMC) Forex Strategy Explained \- ePlanet Brokers, https://eplanetbrokers.com/training/smart-money-concept 2\. Python-Based SMC Automation (Structure \+ Order Block Logic) — Development Thread : r/Trading \- Reddit, https://www.reddit.com/r/Trading/comments/1qyauat/pythonbased\_smc\_automation\_structure\_order\_block/ 3\. I ran STATS about Market Structure (BoS & ChoCh) : r/algotrading \- Reddit, https://www.reddit.com/r/algotrading/comments/1r6ad82/i\_ran\_stats\_about\_market\_structure\_bos\_choch/ 4\. 5 Common Mistakes When Reading Inducement in Trading | EBC Financial Group, https://www.ebc.com/forex/5-common-mistakes-when-reading-inducement-in-trading 5\. Smart Money Concepts Made Simple: The Definitive SMC Guide \- Daily Price Action, https://dailypriceaction.com/blog/smart-money-concepts/ 6\. QuantForgeIO/cTrader-Smart-Structure-SMC: Professional Supply & Demand indicator for cTrader with automated BOS detection and momentum validation. \- GitHub, https://github.com/QuantForgeIO/cTrader-Smart-Structure-SMC 7\. Inside Bar Candlestick Pattern: Trading Strategy Guide \- Admiral Markets, https://admiralmarkets.com/education/articles/forex-strategy/inside-bar-forex-trading-strategy 8\. Inside Bar Trading Strategy | PriceAction.com, https://priceaction.com/price-action-university/strategies/inside-bar/ 9\. The 5 Characteristics Of A Profitable Inside Bar Setup \- Daily Price Action, https://dailypriceaction.com/blog/the-5-characteristics-of-a-profitable-inside-bar-setup/ 10\. Smart Money Concepts | TrendSpider Store, https://trendspider.com/trading-tools-store/collection/smart-money-concepts/ 11\. SMC 101: Advanced Smart Money Concepts by Jay Forex House \- Studocu, https://www.studocu.vn/vn/document/ho-chi-minh-city-university-of-industry-and-trade/giao-dich/smc-101-advanced-smart-money-concepts-by-jay-forex-house/137393756 12\. Advanced SMC Trading Strategy Guide | PDF | Day Trading | Market Liquidity \- Scribd, https://www.scribd.com/document/694146201/Advanced-SMC-Pt-1-Theory 13\. Understanding Market Structure Concepts | PDF \- Scribd, https://www.scribd.com/document/958419659/Market-Structure-Indicator-Basics 14\. SMC Valid Pullback & Inducement: The ONLY Rule You Need to Know \- YouTube, https://www.youtube.com/watch?v=Ovd5QzZutsw 15\. Smart Money Concepts in Market Structure | PDF \- Scribd, https://www.scribd.com/document/730952875/Smart-Money-Concept 16\. Understanding SMC Trading Concepts | PDF | Market Trend \- Scribd, https://www.scribd.com/document/627844629/E-book-Smart-Money-SMC 17\. 03- Pullback & Valid Inducement | English | Smart Money Approach | Forex Minions, https://www.youtube.com/watch?v=f9rg4BDaaXE 18\. Smart Money Concept: Structure Mapping Guide | PDF | Market (Economics) \- Scribd, https://www.scribd.com/document/967158581/SMC 19\. Smart Money Concepts (SMC): Complete Guide to Order Blocks, FVG and Liquidity | Trading Wyckoff | Rubén Villahermosa, https://tradingwyckoff.com/en/smart-money-concepts/ 20\. Understanding SMC Market Structure in Trading | PDF \- Scribd, https://www.scribd.com/document/951812582/Market-Structure-in-SMC 21\. Displacement in ICT: Smart Money Price Moves, https://arongroups.co/technical-analyze/displacement-in-ict/ 22\. ICT Basics: A Beginners Guide | TrendSpider Blog, https://trendspider.com/blog/ict-basics-a-beginners-guide/ 23\. Body Ratio Indicator | Free Download Trading Indicator for MetaTrader 5 \- MQL5, https://www.mql5.com/en/market/product/145536 24\. Identify Inducement in Forex Trading: The Ultimate Guide for Traders \- ePlanet Brokers, https://eplanetbrokers.com/training/what-is-inducement-in-forex 25\. SMC Automated: Are AI Trading Agents Cheating in 2026? \- Medium, https://medium.com/@margaretwhite569uknancy8htmll/i-spent-14-000-testing-23-trading-bots-only-one-actually-works-031804b1d621 26\. lightweight-charts-react-components \- NPM, https://npmjs.com/package/lightweight-charts-react-components 27\. Stacked Bar chart in React with D3 using JSON data | by Stuthi Neal \- Medium, https://medium.com/@stuthineal/stacked-bar-chart-in-react-with-d3-using-json-data-9a873a99a7ae 28\. Using D3.js with React.js: An 8-step comprehensive manual \- Grid Dynamics, https://www.griddynamics.com/blog/using-d3-js-with-react-js 29\. Shadow Trading AI | Buidls \- DoraHacks, https://dorahacks.io/buidl/37471 30\. Inside Bar Forex Trading Strategy: Start To Finish Guide \- Daily Price Action, https://dailypriceaction.com/blog/inside-bar-trading-strategy/ 31\. SMC BOS vs CHoCH: Stop Getting Trapped by Fake Reversals, https://fxnx.com/en/blog/smc-bos-vs-choch-stop-getting-trapped-fake-reversals