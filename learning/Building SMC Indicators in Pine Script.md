# **Computational Modeling of Price Action: Engineering High-Fidelity Smart Money Concepts and Inefficiency Engines in Pine Script**

## **Heuristic Formulations of Swing Structure and Algorithmic Trend State Machines**

The automation of market structure analysis requires the translation of qualitative price action theories into deterministic computational models.1 Traditional technical indicators rely heavily on lagging calculations such as moving averages, which smooth price data and obscure the underlying liquidity distribution of the market. In contrast, algorithmic implementations of Smart Money Concepts (SMC) analyze localized price extrema and structural transitions directly from candlestick charts.1  
The fundamental framework of any automated structure indicator begins with the calculation of swing points, mathematically classified as pivot points.1 A swing point is a localized peak or trough verified by a surrounding envelope of bars.4

### **The Mathematical Formulation of Pivots**

To identify a pivot point, the algorithm evaluates a price series against a bilateral lookback and lookforward window, defined by the Left Strength (![][image1]) and Right Strength (![][image2]) parameters.4 Mathematically, a Pivot High (![][image3]) at index ![][image4] is established if the high price of that candle is strictly greater than or equal to the high prices of the preceding ![][image1] candles and subsequent ![][image2] candles:  
![][image5]  
Conversely, a Pivot Low (![][image6]) is defined as:  
![][image7]  
The implementation of these calculations in TradingView’s Pine Script relies on built-in functions that search for these localized peaks and troughs.6

Pine Script  
pivHi \= ta.pivothigh(high, leftBars, rightBars)  
pivLo \= ta.pivotlow(low, leftBars, rightBars)

The lookforward parameter (![][image2]) introduces a structural delay of exactly ![][image2] bars into the real-time detection pipeline.4 Although a visual shift using negative offsets can align plotted historical markers with the actual pivot candle on a chart, the execution engine cannot access this pivot price until the current bar closes.5 This creates a systematic latency that must be accounted for in historical backtesting to avoid lookahead bias.8

### **Swings Based on Relative Moves**

To overcome the rigid nature of fixed lookback periods, alternative swing-point architectures calculate structures based on relative price moves.10 Instead of requiring a fixed number of candles to the left and right, these systems evaluate price deviations relative to previous extrema.10 The algorithm starts from a single reference candle and checks if the subsequent price moves retrace by a significant percentage, such as the standard Fibonacci ratios of 23.6% or 50%.10 If the price retraces beyond the specified threshold, the previous extremum is locked in as a confirmed swing point.10 This relative-move model adapts dynamically to changing market volatility, allowing the script to identify macro structure during high-volatility expansions and micro structure during tight consolidations without manual recalibration.10

Pivot High Confirmation (L \= 3, R \= 3, Structural Delay \= 3 Bars)

      \[Candle t-3\] (Highest High)  
         Value: $100.00  
          /   \\  
        /       \\  
      /           \\  
  \[t-6\]   \[t-4\]   \[t-2\]   \[t\] \<--- Current Close (Pivot Confirmed)  
  $96.00  $98.00  $97.50  $95.00  (ta.pivothigh returns $100.00)

### **State-Machine Heuristics for Structural Transitions**

The programmatic determination of structural transitions requires a persistent state-machine architecture to track key parameters over time.6 The state machine evaluates two primary structural breaks: the Break of Structure (BOS) and the Change of Character (CHoCH).3  
A Break of Structure represents a trend continuation signal. It occurs when price closes beyond a previous swing point that aligns with the prevailing trend.3 For example, in an established uptrend, a closing bar above the last confirmed swing high triggers a bullish BOS.12  
A Change of Character, alternatively called a Market Structure Shift, represents a trend reversal signal.3 It occurs when price breaks a swing point in the opposite direction of the current trend.3 For example, if the current trend is bullish, a decline below the last confirmed swing low triggers a bearish CHoCH, updating the internal trend state of the algorithm.12

Pine Script  
// Persistent state variables  
var float prevHigh    \= na  
var float prevLow     \= na  
var int   trendDirection \= 0 // 1 \= Bullish, \-1 \= Bearish  
var bool  highIsActive  \= false  
var bool  lowIsActive   \= false

// Update historical boundaries upon pivot confirmation  
if not na(pivHi)  
    prevHigh     := pivHi  
    highIsActive := true  
if not na(pivLo)  
    prevLow      := pivLo  
    lowIsActive  := true

// Configure confirmation types (Candle Close vs. Wick Breaks)  
highSource \= (confirmationType \== "Candle Close")? close : high  
lowSource  \= (confirmationType \== "Candle Close")? close : low

bool isBullishBreak \= highIsActive and not na(prevHigh) and highSource \> prevHigh  
bool isBearishBreak \= lowIsActive  and not na(prevLow)  and lowSource  \< prevLow

// State machine transition evaluation  
if isBullishBreak  
    highIsActive := false  
    bool isReversal \= (trendDirection \== \-1)  
    trendDirection := 1  
    // Render CHoCH if trend changes; render BOS if trend continues  
    DrawStructure(isReversal? "CHoCH" : "BOS", prevHigh, color.green)

if isBearishBreak  
    lowIsActive := false  
    bool isReversal \= (trendDirection \== 1\)  
    trendDirection := \-1  
    DrawStructure(isReversal? "CHoCH" : "BOS", prevLow, color.red)

The sensitivity of this state machine is highly dependent on the choice of confirmation source.6 Wick-based breakouts provide highly sensitive, early indications of structural shifts but increase the frequency of false triggers.6 Candle close confirmation is more conservative, verifying market consensus at the expense of a 1-bar execution delay.6

## **Systematic Order Block Identification and Advanced Volumetric Filtering**

An Order Block (OB) represents a price level where institutional market participants are hypothesized to have executed substantial buy or sell orders, leaving behind a footprint that acts as a support or resistance zone.1 Programmatically, the classic retail definition of a bullish order block is the last down-candle before a rapid upward impulse that breaks market structure.15

### **The Validation Engine**

To minimize false signals, professional-grade indicators discard unconfirmed candidate candles.10 Candidate candles are evaluated using three primary validation filters 16:

* **Impulse Strength (Candle Body-to-Range Ratio):** The momentum candle that follows the order block must show high physical displacement.16 This is measured using the Momentum Candle Ratio (![][image8]), where the absolute candle body must exceed a specific percentage of its total range 16:  
  ![][image9]  
* **Volatility Threshold (ATR Support):** To ensure the displacement move is not a low-volume consolidation breakout, the total range of the candle must equal or exceed a volatility-adjusted threshold 16:  
  ![][image10]  
  In this formula, ![][image11] is a user-defined volatility multiplier, typically configured to ![][image12].16  
* **Structural Break Confluence:** The order block zone is confirmed only when the subsequent impulse move successfully triggers a verified BOS or CHoCH.16

Bullish Order Block State Transitions

               
   Last Down-Candle           Impulse Move Closes        Future Price Re-tests  
   Prior to Breakout         Above Candidate High       Upper Boundary of Zone  
        \+---+                      \+---+                      |  
        |   |                      |   |                      |  
   \+----+---+----+            \+----+---+----+                 V  
   |    |   |    |            |  Confirming |            \~\~\~\~\~\~\~\~\~\~\~ (OB Top)  
   |    \+---+    |            |  BOS/CHoCH  |              
   |             |            \+-------------+            \~\~\~\~\~\~\~\~\~\~\~ (OB Bottom)

### **Volumetric and Structural Block Classes**

Advanced variations of order block models refine these zones by integrating volume metrics and structural transitions 14:

#### **Volumetric Order Blocks**

These blocks filter candidates by requiring that the volume of the impulse move exceeds a specified simple moving average of volume (e.g., ![][image13]).14 This ensures that the structural shift is backed by heavy institutional trading volume, validating the presence of a real supply-demand imbalance.14

#### **Breaker Blocks**

A breaker block is a failed order block that has been broken by an aggressive market move.14 When a bullish order block's lower boundary is broken by a closing candle, the zone does not lose all technical significance.14 Instead, it flips into a Bearish Breaker Block.14 The algorithm changes the visual properties of the zone and treats the level as resistance on future retests.14

#### **Rejection Blocks**

These blocks focus on the wicks of candles at key liquidity areas, such as swing highs or swing lows.18 If a candle runs past a previous high but closes with a long upper wick, the wick area itself is mapped as a high-density supply zone.18 This model is based on the idea that heavy limit orders were triggered in the wick region, creating a rapid rejection of price.18

## **Dynamic Array-Based Memory Management for Zone Mitigation**

Once an order block or fair value gap is confirmed, its boundaries must be projected forward in time as potential support or resistance levels.1 In TradingView’s Pine Script, these zones are rendered using visual box objects.13 Because these objects consume chart rendering performance, the script must maintain a dynamic registry of active zones, checking them against incoming price bars and removing mitigated or broken levels to manage system resources.4

### **Dynamic Mitigation Architectures**

The framework must handle two main mitigation methods:

* **Wick-Based Mitigation:** The zone is invalidated and deactivated the moment price wicks through its boundary.13 For a bullish zone, this occurs when the low of the current candle falls below the bottom boundary of the zone.13  
* **Close-Based Mitigation:** The zone remains active until a candle closes past its boundary.13 For a bullish zone, invalidation occurs when the closing price of a candle falls below the bottom boundary of the zone.12

### **Enforcing FIFO Array Operations**

Because TradingView limits scripts to a maximum of 500 active boxes, indicators must manage memory resources carefully.13 The indicator uses parallel float and box arrays, operating on a First-In, First-Out (FIFO) queue structure.13 When a new zone is created, it is pushed onto the end of the arrays.13 If the array size exceeds a specified limit (e.g., 20 active zones), the oldest box is deleted from the chart and its values are shifted out of the tracking arrays.4

Pine Script  
// Parallel arrays for active bullish zone tracking  
var box   bullBoxes \= array.new\_box()  
var float bullTops  \= array.new\_float()  
var float bullBtms  \= array.new\_float()

// Append new bullish order block to arrays  
array.push(bullBoxes, newBox)  
array.push(bullTops, obTopPrice)  
array.push(bullBtms, obBtmPrice)

// Maintain maximum box threshold (FIFO queue cleanup)  
if array.size(bullBoxes) \> maxBoxLimit  
    box.delete(array.shift(bullBoxes))  
    array.shift(bullTops)  
    array.shift(bullBtms)

During each bar update, the algorithm loops through all active zones, updates their right coordinates to the current time, and checks if price has met the invalidation criteria.13 If a zone is mitigated, the script deletes the box or changes its color to denote mitigation, then removes its elements from the tracking arrays.13

## **Mathematical Formalization of Inefficiencies and Multi-Timeframe Pipe Mechanics**

Fair Value Gaps (FVGs) represent price inefficiencies where a single market side dominates the order flow, preventing the opposing side from executing trades at those price levels.20

### **Mathematical Formulation of FVGs**

An FVG is defined using a sequential three-candle pattern.20 A bullish FVG occurs when the low of Candle 3 is strictly higher than the high of Candle 1, leaving an unfilled gap in between 1:  
![][image14]  
A bearish FVG occurs when the high of Candle 3 is strictly lower than the low of Candle 1, leaving an unfilled gap in between 1:  
![][image15]  
To filter out minor price wiggles, the algorithm can enforce a minimum gap size using a volatility-based threshold, requiring the gap to represent a minimum percentage of the recent Average True Range (ATR).17

Bullish Fair Value Gap (Three-Candle Sequence)

  \[Candle t-2\] (Candle 1\)      \=========\> $100.00 (High of Candle 1\)  
                                \--------------------------------------  
                                 \[Imbalance / FVG Zone: $100 to $102\]  
                                \--------------------------------------  
  \[Candle t\]   (Candle 3\)      \=========\> $102.00 (Low of Candle 3\)

  \[Candle t-1\] (Candle 2\) is a strong upward momentum candle.

### **Cumulative Gap Merging**

To simplify charts, advanced indicators can implement consecutive gap merging logic (join\_consecutive). If multiple fair value gaps form in the same direction on consecutive candles, the algorithm merges them into a single unified zone. The top of the merged FVG is set to the highest top of the individual gaps, and the bottom is set to the lowest bottom. This approach reduces chart clutter and highlights broader, more significant zones of market imbalance.

### **Multi-Timeframe Pipeline Security**

Analyzing higher-timeframe (HTF) imbalances on lower-timeframe (LTF) charts is a common approach to locating high-confluence zones.24 However, pulling HTF data into an LTF chart requires careful coding to prevent lookahead bias and repainting.8  
Lookahead bias occurs if the script references the close, high, or low of an HTF candle before that HTF bar has officially completed.8 For example, if a 5-minute chart requests 1-hour bar values using a standard request.security query, the values returned during the hour will include data from the completed portion of the 1-hour candle, which changes historically when the bar closes.8  
To build a secure, non-repainting MTF pipeline, the algorithm must 8:

* Request historical index values of the HTF series (using index or) rather than the active, uncompleted bar \`\`.8  
* Explicitly disable the lookahead setting by specifying lookahead=barmerge.lookahead\_off inside the security request.8

Pine Script  
// Secure HTF extraction helper function  
f\_get\_htf\_values() \=\>  
    // Retrieve finalized bar values to prevent historical repainting  
    \[high, low, high, low\]

// Execute security request on 1-Hour ("60") timeframe  
\[htf\_hi\_1, htf\_lo\_1, htf\_hi\_3, htf\_lo\_3\] \= request.security(  
     syminfo.tickerid,   
     "60",   
     f\_get\_htf\_values(),   
     barmerge.gaps\_off,   
     barmerge.lookahead\_off  
     )

// Check for FVG using finalized HTF values  
bool htfBullishImbalance \= htf\_lo\_1 \> htf\_hi\_3

This configuration ensures that the 1-hour FVG is only projected on the 5-minute chart once the 1-hour candle has officially closed, maintaining consistency between historical backtests and live trading.8

## **Liquidity Sweeps, Validation Metrics, and Strategic Execution Filtering**

A liquidity sweep represents a price run past a major historical swing point, followed by an immediate rejection and reverse close back within the structural range.14 This pattern suggests that retail stop-loss orders were triggered to absorb liquidity before price reverses in the opposite direction.28

Liquidity Sweep Wick Rejection Heuristic

             (Liquidity Trapped)  
                   |  
     \--------------+-------------- Swing High Level: $105.00 (PDH / PWH)  
    |              |              |  
    |  \[Candle t\]  |              |  
    |  (Bullish    |              |  
    |   Run)       |              |  
    |              \+--------------+ Candle Close: $104.50 (Inside Range)  
    |              |  
    |              |  
    \+--------------+

### **Heuristic Match Criteria**

To programmatically identify a liquidity sweep at candle ![][image16], the algorithm evaluates three primary rules 14:

* **Boundary Breakthrough:** The candle's high must exceed a key resistance level (![][image17]), such as a previous day's high (PDH), previous week's high (PWH), or a confirmed swing high 14:  
  ![][image18]  
* **Close Rejection:** The closing price of the candle must fail to hold above that resistance level, closing back within the established range 30:  
  ![][image19]  
* **Wick Ratio Confirmation:** The upper wick length must represent a substantial portion of the entire candle range, confirming decisive price rejection 14:  
  ![][image20]

Pine Script  
isBullishSweep \= (high \> prevHigh) and (close \<= prevHigh) and   
                 ((high \- math.max(open, close)) / (high \- low) \>= 0.50)

To prevent generating false signals during tight consolidations, the indicator can filter sweeps by checking if they occur in areas of high volume or volatility, such as near the outer bands of a dynamic ATR channel.6

## **Structural Filtering Strategies: HTF Close vs. LTF Displacement**

When filtering automated market structure signals, practitioners typically choose between two main methodologies: Higher-Timeframe (HTF) candle-close confirmation or Lower-Timeframe (LTF) displacement execution.17

### **HTF Candle-Close Confirmation**

This approach requires that the higher-timeframe candle closes beyond a structural level to confirm a breakout, treating intraday wick breaks as temporary liquidity sweeps.6 This method filters out false breakouts but introduces a timing lag, as the confirmation is only available when the higher-timeframe bar closes.4

### **LTF Displacement**

This approach utilizes a multi-timeframe execution model.19 The algorithm maps higher-timeframe supply and demand zones (such as HTF order blocks or fair value gaps) as primary areas of interest.19 Once price enters an HTF zone, the system switches to a lower timeframe (e.g., a 1-minute or 5-minute chart) and waits for a micro CHoCH accompanied by strong displacement to confirm the entry.17

Dual-Timeframe Execution Pipeline

   
  Price enters a confirmed HTF Demand Zone / Order Block.  
         |  
         V (Pipeline switches to execution timeframe)  
   
  System waits for a micro-structural Change of Character (CHoCH)   
  accompanied by a strong displacement candle (MCR \>= 0.66).  
         |  
         V  
  \[Market Entry Execution\]

This dual-timeframe model helps optimize risk-to-reward ratios.19 It uses the higher timeframe to establish the primary directional bias and key levels, and the lower timeframe to identify early signs of structure shifts with smaller, localized stop-loss placements.17

## **Technical Specifications and Comparative Logic**

The following tables summarize the configuration settings and programmatic logic required to implement these automated market structure models.

### **Indicator Configuration Parameters**

The table below outlines the core inputs and statistical thresholds used to calibrate the market structure engine.6

| Parameter Group | Input Name | Variable Type | Default Value | Technical Purpose |
| :---- | :---- | :---- | :---- | :---- |
| **Market Structure** | swingSize | Integer | 10 | Defines the left and right lookback window (![][image21]) for pivot detection.4 |
| **Market Structure** | bosConfType | String | Candle Close | Options: Candle Close or Wicks. Sets the confirmation source for structural breaks.6 |
| **Order Blocks** | volumePivotLength | Integer | 5 | Specifies the volume pivot length used to identify high-density order zones.13 |
| **Order Blocks** | mitigationMethod | String | Wick | Options: Wick or Close. Sets the criteria for deactivating active order blocks.13 |
| **Fair Value Gaps** | minGapSizeATR | Float | 0.1 | The minimum gap width, measured as a fraction of ATR(14), to filter out trivial imbalances.17 |
| **Fair Value Gaps** | joinConsecutive | Boolean | True | Merges adjacent imbalances in the same direction into a single unified zone. |
| **Validation** | wickRatioThreshold | Float | 0.50 | The minimum wick-to-range ratio required to confirm a liquidity sweep.14 |

### **Manual vs. Automated Pine Script Logic**

The table below compares discretionary manual analysis with the exact programmatic conditions used in automated scripts.1

| Feature | Manual Detection (Discretionary) | Indicator Logic (Pine Script Implementation) | System Execution Notes |
| :---- | :---- | :---- | :---- |
| **Trend State** | Visual inspection of swing levels; susceptible to recency bias.10 | Sequential state-machine tracking of higher highs and higher lows.1 | Eliminates subjectivity; updates trendDirection based on structural breaks.6 |
| **Break of Structure** | Subjective assessment of line crossings; inconsistent use of wicks vs. closes. | Strict checks: highSrc \> prevHigh or lowSrc \< prevLow based on user-defined parameters.6 | Provides consistent, rule-based execution; close-based checks introduce a 1-bar delay.6 |
| **Order Block** | Identifying "the last down candle" before an upward expansion by eye. | Automated scans for candidate candles followed by verified BOS/CHoCH patterns.16 | Confirms institutional interest by verifying price momentum and structural breaks.16 |
| **Fair Value Gaps** | Scanning the chart manually for visual spaces between candle wicks. | Strict calculation: low \> high (bullish) or high \< low (bearish).1 | Tracks imbalances instantly; can be projected across multiple timeframes via MTF pipelines.24 |
| **Liquidity Sweep** | Visually identifying price rejection wicks at key swing areas. | Logical evaluation: price breaks a pivot high but closes within range, verified by wick ratios.14 | Distinguishes temporary stop runs from true breakouts; improves entry precision in reverse setups.14 |

## **Structural Synthesis**

Implementing a high-fidelity market structure indicator in TradingView requires a systematic approach to translating qualitative price action rules into deterministic Pine Script calculations.2 By using structured mathematical definitions for pivot points, order blocks, fair value gaps, and liquidity sweeps, developers can build indicators that provide objective, rules-based market context.1  
To build a reliable system, practitioners should focus on structural integrity and performance optimization 31:

* **Manage Delay:** Be mindful of the structural delay (![][image2] bars) required to confirm pivot points, and design execution logic that accounts for this latency to avoid lookahead bias.4  
* **Enforce Strict MTF Pipeling:** When pulling data from higher timeframes, reference strictly completed historical bars and specify lookahead=barmerge.lookahead\_off to prevent repainting.8  
* **Handle Memory Constraints:** Use parallel arrays to manage active zones, and implement FIFO queue cleanups to keep the script within TradingView's box rendering limits.4  
* **Integrate Volumetric Filters:** Combine structural rules with momentum (MCR), volatility (ATR), and volume confirmations to focus on high-conviction institutional moves.14

When designed with these structural principles in mind, automated indicators serve as powerful tools for systematic analysis, helping traders map key market structures, liquidity levels, and price imbalances with technical precision.24

#### **Works cited**

1. GitHub \- joshyattridge/smart-money-concepts: Discover our Python package designed for algorithmic trading. It brings ICT's smart money concepts to Python, offering a range of indicators for your algorithmic trading strategies., accessed June 1, 2026, [https://github.com/joshyattridge/smart-money-concepts](https://github.com/joshyattridge/smart-money-concepts)  
2. Introduction to Pine Script® for custom strategies on TradingView \- ThinkMarkets, accessed June 1, 2026, [https://www.thinkmarkets.com/en/trading-academy/trading-view/introduction-to-pine-script-for-custom-strategies-on-tradingview/](https://www.thinkmarkets.com/en/trading-academy/trading-view/introduction-to-pine-script-for-custom-strategies-on-tradingview/)  
3. Market Structure CHoCH/BOS (Fractal) | Trading Indicator | LuxAl… \- LuxAlgo, accessed June 1, 2026, [https://www.luxalgo.com/library/indicator/market-structure-choch-bos-fractal/](https://www.luxalgo.com/library/indicator/market-structure-choch-bos-fractal/)  
4. Swing High/Low Liquidity Zones Indicator | PDF \- Scribd, accessed June 1, 2026, [https://www.scribd.com/document/866446450/swing-High-Low-pine-script-version-6](https://www.scribd.com/document/866446450/swing-High-Low-pine-script-version-6)  
5. pinescript: ta.pivothigh misunderstanding \- Stack Overflow, accessed June 1, 2026, [https://stackoverflow.com/questions/78214347/pinescript-ta-pivothigh-misunderstanding](https://stackoverflow.com/questions/78214347/pinescript-ta-pivothigh-misunderstanding)  
6. Market Structure Analysis in Pine Script | PDF \- Scribd, accessed June 1, 2026, [https://www.scribd.com/document/879789546/Market-Structure](https://www.scribd.com/document/879789546/Market-Structure)  
7. pine script \- Plotting pivot high/lows with offset vs Actually saving the price of pivot high/low, accessed June 1, 2026, [https://stackoverflow.com/questions/78279005/plotting-pivot-high-lows-with-offset-vs-actually-saving-the-price-of-pivot-high](https://stackoverflow.com/questions/78279005/plotting-pivot-high-lows-with-offset-vs-actually-saving-the-price-of-pivot-high)  
8. How to Write Pine Script for Trading Indicators \- LuxAlgo, accessed June 1, 2026, [https://www.luxalgo.com/blog/how-to-write-pine-script-for-trading-indicators/](https://www.luxalgo.com/blog/how-to-write-pine-script-for-trading-indicators/)  
9. How pivothigh() and pivotlow() function work on Tradingview Pinescript? \- Stack Overflow, accessed June 1, 2026, [https://stackoverflow.com/questions/64019553/how-pivothigh-and-pivotlow-function-work-on-tradingview-pinescript](https://stackoverflow.com/questions/64019553/how-pivothigh-and-pivotlow-function-work-on-tradingview-pinescript)  
10. Market Structure Indicator : r/pinescript \- Reddit, accessed June 1, 2026, [https://www.reddit.com/r/pinescript/comments/1sad83t/market\_structure\_indicator/](https://www.reddit.com/r/pinescript/comments/1sad83t/market_structure_indicator/)  
11. Pivots & Impulsive Moves in Pine Script, accessed June 1, 2026, [https://courses.theartoftrading.com/pages/pivots-impulsive-moves-pine-script](https://courses.theartoftrading.com/pages/pivots-impulsive-moves-pine-script)  
12. Smart Money Concepts \[LuxAlgo\] \[Enhanced\] · GitHub, accessed June 1, 2026, [https://gist.github.com/niquedegraaff/8c2f45dc73519458afeae14b0096d719](https://gist.github.com/niquedegraaff/8c2f45dc73519458afeae14b0096d719)  
13. LuxAlgo Order Block Detector Script | PDF | Computer Programming \- Scribd, accessed June 1, 2026, [https://www.scribd.com/document/884903987/Order-Block-Ema-13-21](https://www.scribd.com/document/884903987/Order-Block-Ema-13-21)  
14. 3astbeast/RedTailIndicators \- GitHub, accessed June 1, 2026, [https://github.com/3astbeast/RedTailIndicators](https://github.com/3astbeast/RedTailIndicators)  
15. strategies/Order-Block-Finder.md at master \- GitHub, accessed June 1, 2026, [https://github.com/fmzquant/strategies/blob/master/Order-Block-Finder.md](https://github.com/fmzquant/strategies/blob/master/Order-Block-Finder.md)  
16. PineScript/\[Screener\] ICT Retracement to Order Block with Screener ..., accessed June 1, 2026, [https://github.com/ArunKBhaskar/PineScript/blob/main/%5BScreener%5D%20ICT%20Retracement%20to%20Order%20Block%20with%20Screener.txt](https://github.com/ArunKBhaskar/PineScript/blob/main/%5BScreener%5D%20ICT%20Retracement%20to%20Order%20Block%20with%20Screener.txt)  
17. FVG full code. . Finished on 12/02/2025 | by Oliver Shaw \- Medium, accessed June 1, 2026, [https://medium.com/@ojshaw20/fvg-full-code-42ebd01ccc9e](https://medium.com/@ojshaw20/fvg-full-code-42ebd01ccc9e)  
18. PyIndicators is a powerful and user-friendly Python library for financial technical analysis indicators, metrics and helper functions for pandas and polars dataframes. Written entirely in Python, it requires no external dependencies, ensuring seamless integration and ease of use. · GitHub, accessed June 1, 2026, [https://github.com/coding-kitties/PyIndicators](https://github.com/coding-kitties/PyIndicators)  
19. KanekiCraynet/Price-Action-Concepts \- GitHub, accessed June 1, 2026, [https://github.com/KanekiCraynet/Price-Action-Concepts](https://github.com/KanekiCraynet/Price-Action-Concepts)  
20. Pine mitigated FVG \- Stack Overflow, accessed June 1, 2026, [https://stackoverflow.com/questions/79529144/pine-mitigated-fvg](https://stackoverflow.com/questions/79529144/pine-mitigated-fvg)  
21. Market Structure Indicator Script | PDF | Computer Programming ..., accessed June 1, 2026, [https://www.scribd.com/document/977978208/Almost-Idm-and-Choch-Bos](https://www.scribd.com/document/977978208/Almost-Idm-and-Choch-Bos)  
22. Automating Fair Value Gaps (FVG) in Python | by Ziad Francis, PhD | Medium, accessed June 1, 2026, [https://medium.com/@ziad.francis/automating-fair-value-gaps-fvg-in-python-0768d3f382e6](https://medium.com/@ziad.francis/automating-fair-value-gaps-fvg-in-python-0768d3f382e6)  
23. sonnyparlin/fvg\_pinescript: A fair value gap indicator for TradingView \- GitHub, accessed June 1, 2026, [https://github.com/sonnyparlin/fvg\_pinescript](https://github.com/sonnyparlin/fvg_pinescript)  
24. abbaselmas/tradingview-indicator-combination \- GitHub, accessed June 1, 2026, [https://github.com/abbaselmas/tradingview-indicator-combination](https://github.com/abbaselmas/tradingview-indicator-combination)  
25. can anyone recommend a good open-source fvg indicator (PineScript)? \- Reddit, accessed June 1, 2026, [https://www.reddit.com/r/TradingView/comments/1p9n9w3/can\_anyone\_recommend\_a\_good\_opensource\_fvg/](https://www.reddit.com/r/TradingView/comments/1p9n9w3/can_anyone_recommend_a_good_opensource_fvg/)  
26. A FVG Imbalance Map that draws and removes Fair Value Gaps on the 15m, 1h and 4h automatically regardless of the timeframe : r/pinescript \- Reddit, accessed June 1, 2026, [https://www.reddit.com/r/pinescript/comments/1s3m5np/a\_fvg\_imbalance\_map\_that\_draws\_and\_removes\_fair/](https://www.reddit.com/r/pinescript/comments/1s3m5np/a_fvg_imbalance_map_that_draws_and_removes_fair/)  
27. Allysson-Rodrigues/tradingview-indicator: Algorithmic trading tools and custom Pine Script scripts for structured technical analysis on TradingView. \- GitHub, accessed June 1, 2026, [https://github.com/Allysson-Rodrigues/tradingview-indicator](https://github.com/Allysson-Rodrigues/tradingview-indicator)  
28. EzAlgo\_V9.pine.txt \- TraderOracle/TradingView \- GitHub, accessed June 1, 2026, [https://github.com/TraderOracle/TradingView/blob/main/EzAlgo\_V9.pine.txt](https://github.com/TraderOracle/TradingView/blob/main/EzAlgo_V9.pine.txt)  
29. Bitcoin Analysis Today (Memorial Day in the U.S.) — TradingView News, accessed June 1, 2026, [https://www.tradingview.com/news/forexlive:b0f00ddf6094b:0-bitcoin-analysis-today-memorial-day-in-the-u-s/](https://www.tradingview.com/news/forexlive:b0f00ddf6094b:0-bitcoin-analysis-today-memorial-day-in-the-u-s/)  
30. how isnt this a liquidity sweep? : r/Daytrading \- Reddit, accessed June 1, 2026, [https://www.reddit.com/r/Daytrading/comments/1mpdlpz/how\_isnt\_this\_a\_liquidity\_sweep/](https://www.reddit.com/r/Daytrading/comments/1mpdlpz/how_isnt_this_a_liquidity_sweep/)  
31. pine-script-v5 · GitHub Topics, accessed June 1, 2026, [https://github.com/topics/pine-script-v5](https://github.com/topics/pine-script-v5)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAaCAYAAACHD21cAAAAs0lEQVR4XmNgGHkgAIjnAvEsNDwTiIWR1GEAXSAOAeKlQPwfiLOhfGcgZkVShxNMYoBoZESXwAc0gfgtEH9FlyAEghggtp1GlyAEYM6cgy6BD/AC8WEGiMZoNDm8ANmZgmhyIMDMgCPACDnTEohZ0AVBNoBswuVMkE2T0QVBADkajNHkQAAkdhxdEATWMkBsA6UamD+kgTgZiD8C8T8gdoGKgwHI3T8ZIJrwYVwBNgpGIgAASSgq5DR3npcAAAAASUVORK5CYII=>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAZCAYAAAA4/K6pAAAA+ElEQVR4Xu2SPwtBYRSHj7IhSSlhkUUpg9VgsFhMBkUZfAYpuw9BGazyEQzKaDGwY2CyKMogfqdz73Xvuf59gPvU063fOffct/NeIg9NFg7gCu6N5wgODdswanV/oQK3MKHyDDzAh8pd9OEU+lUeggv6MSAAZ7CrCyANj/RjgNlU1AXQJHn5pgt2+PjclIJxWIJ1eIUTmLQ63xCEc5IB5ub5FnawBX1W5wf4Gk/wovIwvMOqyl00SL6+0QWSfKxDOxG4JGnkQXZ4sZz3VO6gQHL0M8yrWplkgHm1/H/wdTvokDStyb1pPSAHY6/yf/CCa4b8S3t4WDwByBAwE2J6GB0AAAAASUVORK5CYII=>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACMAAAAaCAYAAAA9rOU8AAABlElEQVR4Xu2UPSwFQRSFjyBR6OiQCJVCVDo6BREiotMoJCQKpUShU+lEFH4aiU5LJaIUFBoVhUKoFCQUxM85uTPPvnm7Yx+l/ZIv8fbMjJm9dxYoKPgbQ3SDbtMLp/7WMzlPm0qjy+mkO/ge622gXXQ9JZujdZqchiZN0F36Safcb+8rfabDbnySZjpG3+gHXYHNSWYLLltyWbfLo6zCNhMyCFvsirYFmUf5DW0JnotxegnbXC466D19CgPYYtqkTt8XZEIlUa43ENJIj+lM8DzKKGzBszAga7DsFOm904rsjaoFHmhvGMRYhv3DrTAgd7C+GQkDxwCyS+QPmbtE/lVq0mTieS3tp4+wG5fFIn2nR6i8OeewdWtKo3/A776qJnOoRLeIl+glDGL4Eu0hcv8zUIl0k2Il0iFzkSxRVR3v8AdJO4T/VOj7lQt/pfUqq+p42JXeR/q36VeH3IRNOIAtkJd6Og2bq8OEzMKya9peHlXSA/vAaULSw+SgDE5QOU+NqobVBVCPhHlaTxUUFBT8P74AQ9ZtYa7zCp0AAAAASUVORK5CYII=>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAaCAYAAADxNd/XAAABuElEQVR4Xu2Wuy8EURSHjyAh3o9EhEqhoaMhohAKEioJhWgUCjQaoVGIf4BIRCRK8Sg0OgWVQi3RSJaCSqkQz9/Pmdm5c3eYbfZmi/slX7H33Nk9d+acMyvi8XiKhXV4AR8Dj+CeYScsye7+g1o4CCvtgANG4Qy8g99w0nAOfsFj2BheYFMGD+Eb7LNirmiB96IHsGHyXGeOzDWHAfgOz2GFFXPFsmiSl9Y6ORWN8YA8aA4rohsW7YAjeFfDJDetGHkSjW2I1QusLwZsq81NDmiDGdFaH46HpEo0p11J6E8m2gqfRRuoK/jsmrCEX0R7sFu0gdfgAxySlCnEE87biwnwS5pED5mP+T5J9h5zYCmH8LdWg/XExg3hI3qFPXYgASZ0ItG8TnNJL0uFFZBUPuOiB/i3KjrgDWywAw5hkhnRXjBhVaQeYAIeSFRj7bA0CjuBSXIKmaViTqYaYz2HLdHG4QGm4HY8XFB4o/rhBxyTeKM2w1uJpiIn0BkcMfb80guv4ZXom64uHi4I7Dv+97HHN5029s3CT7gA9+EOLDfiWfh2q7cXiwTmxpHKUeu6tD0ej8dTxPwApsJfOXU9UwUAAAAASUVORK5CYII=>

[image5]: <data:image/png;base64,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>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB4AAAAaCAYAAACgoey0AAABX0lEQVR4Xu2UPy8FQRTFjyCRkIiQKFCgUqk0QqcgQvHiAygkSqVP4AuIyp9SRUuhUopKoxIJItQkFCQ4J3eHeXd33+7W9pf8EubcebtzZ2aBmv/GAt2lB/SBXiV/a0xu0P7f6mbG8VcXOx0X5TFBV+ghvaeryf/BD/pGF5P6mAG6ST/pN92GzdF4aTRp3w+SefpFb+iIy8QcLL+jQ81RMWP0mU76gDRgq9GqZlwmTmC5Vl6ZZdjkPh+QHVh2iey9fkT+SxWyBfvxLJ5g+7zkgwS1+ZYO+qCIHnqO9IPb6Sx9gZ38PDTvmHb4oIjQ5msflGAYrdvcSzv9YCC0WW9dFZ3ovDbroUd01AcibvN6c1QKvXRem3UN9TFp84EI1+idTrmsiC7YVcq6RlrQGezhmezBVnsKKy6L9m0NNlf7LLQyXTcdyPAVS6EPxSusILY7LsrhAul53lYHrqampqY6P5hdU36z9+aJAAAAAElFTkSuQmCC>

[image7]: <data:image/png;base64,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>

[image8]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAaCAYAAAD1wA/qAAAC6ElEQVR4Xu2WS8iNURSGX6EIyaUQIlFkILkXSkkkiogyNlUMKCMDiomBezKhpDAgDFzKiSJMDIiJOhRGiKKQy3qsb5+z9z7f+c/x96fU99bb/5+19nWtd61vSxUq/PfobxxnHBTZ+D/+3WdYajxtfG58bFyXuluwz/iqIOMnJ14//GrjfeMv42vjN+M540jjVePixmhpv/GW0jVPFjxm3Ngc2jMmGTcYD8o35lI94b183D3jZuPA1K2Hcv9xNS/JmO3Gu8YXxjGFHawybjV+kM87Kj8PPGD8KA9M1yDSn+XRGZL5AiYYb8s33JL5ABsS1Xm5Q36Z88aLxgGZb4bxnfGTcVbmWyC/5OzMXgoOWDM+Nb41Tkm8jiXGvcbv8sgOi3xTjW+MPyNbGeYolVUAQSQ4p3KHPCjtAteC5XIN1+RZYcMYw+Wa5cIseijyEV0OgP1KZC8D647ObEPl+7Y77B7jM/neHbHbuEteHyy4JnVrm7zoODT+9ZFvkfGrPBsrI3sZpqlVVmQfFZTJar5cVnMzeylohRfkKQ8p3hH5ZxqPyDU+Xq5lNB1AdphTL/x/i7Xy+U+M0+XtmiZCUL/Ii78rBFkRKTLBomeN/eRZIBsBZC2WFXgpn0NWe4OaWmU1St79yDS12RWCrAAapkZqcu1SF9QHIHPXlMoKhIuENdoBCZ7IjWovqyDzTuv+QSwrEPTK4SYqjQayqSuVFXikzhuS3cNyyeRgLmuMiGwhaJ3WbSC03aBtOgotmDqgTjhAABKkoOO2C6gfNuRvPD4G34JL8iznYG7edkNA83otBcXL1/mG0i8tKf0hL8IANHtTvjBPkBgcfmfhu1PieyCXVQ58C+UFvaz4HRCCxprULd2Q50re8RpfUgYGhiImldQGF+X5EI8JzKPEITbJnxPIhPkEpG4c2xzWQPjuxKSww4UHG88U9svG6/Kn1D8Dl6cO6EAr1GwUvQGZp/nw5kIRFSpUqFChQp/iNz+/sQNFbgilAAAAAElFTkSuQmCC>

[image9]: <data:image/png;base64,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>

[image10]: <data:image/png;base64,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>

[image11]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA0AAAAZCAYAAADqrKTxAAAA+klEQVR4Xu2SMWoCURRFfwiBBGxCIFZCsBMsAmKZTjeghYgLyBICqWzsRGysLQTBznSW2YFNIIW4AgtRSNAm5Lz5jPy5IwRLIQdOMfcNf95cvnNnzT3e4YUOjnGJTZzgHBf4mHhDaOAAr4LsBb+C5wRZnGJO8g5uJTvwjG3JMviOM8kjrnGMJclt3R1WJY+oYNf5k3u4xD6usB68l+AVW5JZ1UP8dP5/U9iwoKHzzX1jWQfGG95q6HxzP86vn8JOVIq4dr65G5lFzdmJihWxxycdGHn8wIcgs6u0wVqQJYi/YlfHWjLDa5TCVhtp+Be2mjV3EvFN+OdUfgF/hCIa/qU8bAAAAABJRU5ErkJggg==>

[image12]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAZCAYAAAAv3j5gAAABHUlEQVR4Xu2UsWoCQRCGJ0gKQVASG3sRTCWks7BKoYWNjYUP4Bvo04iksBEbu1QilkmboGVsBRtBCwPqP453zK5G3eZAvA8+Dmb39p89do8o5BZ5gGkYsQcukIB5+GgP2HDAC+zDX5gyRv/nCXZJ3mnBOSzpCRruIgZf4RJO6bqgItzAuqol4Q/8gFFVN3ANapMEvakaNzwk2VlW1Q1cg75I5vN7mne4hWWr7uMaxPPOBTWtuo9rEM8NJGhBAQUF9ulOHQa+jx2SoIqqG7gG9UgW1BfUO952Az7cCV/APziDOXN4Dy+qj+0z/IQjGD/UqnB9eB7B3XuLaIckHXp8wwnMqBpfyjEcwBpcwQa5/yuvgn9hBZIg3mVIyD2xA2v9UFrDJCNuAAAAAElFTkSuQmCC>

[image13]: <data:image/png;base64,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>

[image14]: <data:image/png;base64,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>

[image15]: <data:image/png;base64,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>

[image16]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAAeCAYAAADgiwSAAAAAo0lEQVR4XmNgGOpABV0ABhSBeCG6IAy0ArELuiAIcADxViCWRhbMA+L/aPgnEFuCJHmAWBKII4D4H5QtBsTMIEkYKGeA6MIALEC8Boifo0uAgDgQ3wXiA2jiYGADxL+BeBK6BAgUMUDsC2KAWAFynDBIAmbfWyDWBGJjIF4MxJxgbQyQIHvIAPHGKiA2g0mAgC8QfwTiDUDsiSwBA7DAGAXIAAD8ORoJ0Ewr5QAAAABJRU5ErkJggg==>

[image17]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEcAAAAaCAYAAADloEE2AAADBUlEQVR4Xu2YTahNURiGP6H8/0eiRCSilBERIZKSMFDMDAyMMHCLuBMDSgkTIlHyU2RgotQ9MRBGlJJSh5RSEqFkwPvctT5nnXWOc8/kns1pv/XU2Wut++61v/Wt9e19zUqVKlWqOG0RF8X5jHPpoAI0TJwUb8U7Mau+uzNaLLaLq+KT2Buv16aDCtAQsVwcFBUxpq63wzotLlmY1L+kzRbmVpgWiI9iad5RsMiWioX5Faat4peYmHcMoAnWmGlcTxLDsza8hyZtqfCZbI1ec8R7MTZr76hIW4LTjsaJ4xYy7bF4KZYk/X3imfgqNsS2wxb8e+O1y73weWqNXmypduc1KGJVHlr7k6B6PBAz4zUPdyH+HinWxD4qzGULVeeKBX+uXQTBvRBZk3qhY9b+vAZFvqVYuVxsA7YDE4dTVjsc6SMIZImX2Y1xHAf7T7EitiMCsyf248M93Qufo1bv5VuqEq8LkW+pdMVcyyy0s/pTxAvxwcKKwx0x+s/ooNkWsoZg+xnm2UOw3Id7uhc+u6zey7dUYZWKyfMQTGJn1ofOWJgk8orGiraSPxRbwkXAblu4n/uQFa28fEv5/Tsun+g3a17GH4lp8bePHaiieSayxVw7xJH4233SzMrlJZxxjOcc67huWXgQ3o45Cyi/M8Ru8Vmsqw3t1wGxMrnmb56LTUkb50q64j1if627X/h8t5oXPgTAvTyAnFMc8r5wfOqsEq/EQnE/wjnFebUtjjshpsff48U9C5Wxzxrn0iDOkh8WHqIV+coSvC/ihoWJV61WtVxM5rqFUs64Q1b/zoO4pjK5V1XctJoXZ9RZCx48kL//UDxYPD4pEJ8+BOaaeCLmRchSPBBBqlpY6PkWgj1oIuW5Idstf+hUvNj56v1N7tXMh4DwYgipOKfyjH5tIfv5Jlyf9flCsNhkGYvXteIsI3tSvbGQVbmofvssBJTtSmVsdrZ2jahiI7K2itVX214x10Iged9aLRaJu9blmTMqb4jipXSqNf5rw7dnqVKlSpX6n/Qb4hmeSSvvqBQAAAAASUVORK5CYII=>

[image18]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAyCAYAAADhjoeLAAAD8ElEQVR4Xu3cTahuUxgH8CWUr3xHwoCklK8SUuQMJCaSj1JKJqLMKLcYMDFgyIiMlKQwYqCUGwOmipRSSAwkIybysf6ttb3rrM57zrnuOUf0+9XT3Xvt/XbfdUb/nmfvtxQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHZlo9aHtb6qdWdfu6fWn7WeqnVFX4s7an06nG/lmFoP1fppvrCPjivtO2cf3/bj4zfdcfTGfV02XQMA2HcJIbcM5yeUFthmx5YWXHZyf61n58UdJGAdTchKiJr3sdceLke+LwCAPZFwlpC2SOiZO2Rn1TplWosEuHn981oXl/aZ06dr2zm51ve1Xp0v7MILpe0j3bZ18l0SOhdnls0hcfwbRPY1Xl/2BQBwoNKZStB5o9bLvX4omztJCVAJL4drnTusZwR5Sa3TyuawlOOn+/GNtV7vx0fi+lpflt133RIwf5sXu6tL+65xW62za71d64Ja35UWFB+v9U2/J+sZEcflZTUC3arrCACw7zK+TFDJc19L/Vrr9uGeN0sLLj+XFs7ixFq//33HKswktOV4GZ1eU1rQ+ycuKi2IJVDtJP9nOmBb+bG0YBn3lbaHF0sLb3+U9l0TDJfPf1brpn58Q2nfI/vKvQAABy4hJc9mjeYRaXxSNo9J3611qB+fX+vrfpyOWq4tMqpMSFqsC1XbSbfuyXlxkI5ZvvO8j3dKG2HmWl5GeL+0Me0i3bUvhvPs54yyuj97vrBfy74SXAEADlzCSQLPIuO/uZO0dJfSkbq7ryW8ZXQYCTpLeEuoSbiJpYOVz9/b13Y7Hk3XK2PLB+YLW0hQSxAc95GOWvaSDt9Hw/ooe7+rH6eTlq7heaUFuVlCaPaV/ec+AIADcVVpoWV8EP+tWh8M55HQ80ppIeqRvpZnvjI2TGgbQ1+eI1ueZTtcWvi5rrTOVgLUtf3aOunG5fmxK+cLa+Q75UWFB/t5OoOPltWINtd/6cfxcV+L3JORcM4zIl2Mo94E0IxL81zfqWXVLby5tGfs0rXLyHb5uZPn+7/vlXb/Y/0cAGDfnVPWv/G5hKMYu1wxvmmZ8ei6nwXJ556YF/dQOmfzmDeyp632lfvnt1/zN1hk1Lr8hEhexHit1q2ry+W50v4uyzN/AAAHaqO0B/kjI8K8Wbobebkhnbb/w0gxb9EuATDBLp26eKa0FzY2SntRQ2ADAP4VGaG+VNo48NLp2nbyuXH8+l920nSefY0dufHlBgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANjBXwCtiMLC19u2AAAAAElFTkSuQmCC>

[image19]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAyCAYAAADhjoeLAAAD5ElEQVR4Xu3cTahtYxgH8Fc+Qj4j3wPMfA9E+ZoIEclnlBmJiZQBKUYyMxBJSm6UiaQMhJJulIgBSgwYkDIQSlHIx/NvvctZZ9199r2Hc+65t36/+rff9a619l57j56ed63dGgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsKfZv3L8ZPvgyRgAgC10TeX3ysl9+47Km5VLKndWfujzW+30yiHzyYkTKzdV/qg818cbLQXtO5W/5zsAADbL05W35pPl18o+lbsqj8727W63Vl5vw/XsihRTB84nN1AK2A/nkwAAm+GMtnan6NP++lnl1OmO7qi2uIA6dj7RrTW/zFOVh+aTO3FaGzpsy8yv5YjJeFEHb358frPbZnMAABvulMq3lW3zHTPzgu7qyot9/GDl2j6+vHJpG+6D+6LPZZziKUus8UZ/Xeaiykdt+Jz/4onKy/PJLl2xs/v48zZc342VQytf9fk/K+f28WNtx2tPQZj3ObJvAwBsmssqf7XlnaL92nDM6PzKT5XD+/Z5ldf6OEVS5s+qfNLnHq880lY6ce/112Wua8Py51hYrUeKqBRTWcadO6by22Q7BdsFlYMqZ1a29/kUoSnKcs0pVufXnt8rRSEAwKZ7oA0FydhNmspSaZ4Qvbit7lbl+CyRjlK8bO/jFGbZn6RzFRl/0/NMZd8+n/vL7uvjtaRQeqVy+3zHEinU8plHT+byPrkHLoXcj224locn+1Nkvt+Goi3SMcw5uW8vD2LMrz3vs2iJGABgw41LolfOd5R3+2u6ZynasmwYKYZS6I3GLtVxbaVTl3vOxmPmy6mjdPfy+bvq3jbcz7YzKSbnn5lCMr6unDTd0aVwnJ4zLn0+X7lhMj8aj71q1SwAwCZJdykFyGF9O12kD1Z2t+/6vnSo4vvKS318cxvu8YpnK+f08dttpcOW48dxlh7TyYpxGXW9LmyrHxCYStcu3+Xjvp2HIl5tKx3Auyu39HEKt7EAzHcbi7C8/7jcmy7jtj4erz1LxL+0ochNQZeiM/fupaD9uQ3n3t/PGTuXL1Subzs+uAAAsC5XtKFwWfRXGLn3aypF3fTPdUcppBYVJTk/x0+fKB1v8N/d8v0WXXvMrzHG7zqdz3tMf6fpknH+HiX//XbCZO7LNjzIAACw10ixk/vDssy5yD1t5b63RVmrw7ZVstQ6GjtyKfTSrUsBl+/75L9HAADsJfa0ouv/OGC2naXYqUVdRwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFjgH5b2ilpB3xJHAAAAAElFTkSuQmCC>

[image20]: <data:image/png;base64,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>

[image21]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAXCAYAAABJXhw0AAAA3ElEQVR4Xu2VsQrCMBCGT3B1cNLN2cHJya3gLiJuPoJvoy6K4uRDODs4+CwiCA5O+p8xUP6KxGKhgfvgG5pLSy+5XEQMw/iFIdzAFblMT4qBDhzDHbzA6fu5n54UEzO4hRUOxEQbnmGXA7Exgg9Y50BsaFlpIlFTgwfJn0girjmE2nq9VQD+fFw5EEgi2Z/9ZmGJ+LJacwD0xI1XOVA29HCfxCUyoZgyhwMeLCO+rG7yufUeYYMHib24hQhVO+Tf0V3Qj+uucOttwoWU/ILU2r9LdrVYTs4wDMPIzRMU4jmYvyWqhwAAAABJRU5ErkJggg==>