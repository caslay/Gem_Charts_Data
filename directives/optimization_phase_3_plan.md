# Quantitative Performance Optimization Plan — Phase 3: Render Decoupling & SVG Optimization

This document details the surgical, non-destructive implementation plan for **Phase 3: Render Decoupling & SVG Optimization**, targeting React render cascades, unnecessary SVG coordinate transforms, and coordinate drift during high-frequency WebSocket price updates.

---

## 1. Architectural Audit & Render Cascade Analysis

Currently, the trading dashboard is experiencing visual lag and high CPU consumption due to rendering cascades triggered by the WebSocket price tick updates:
1. **Global Re-render Cascade:** Destructuring `livePrice` or the live kline data payload inside the root [page.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/page.tsx) forces the entire layout to re-evaluate and re-render on every price tick (multiple times per second). This re-evaluates all children, including the Trading Journal, Sidebar, and metrics panels.
2. **SVG Vector Repaint Overhead:** In [Chart.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/Chart.tsx), the `LayerOrchestrator` re-runs `layer.renderChart()` for all active drawing layers (e.g. major swing levels, Fair Value Gaps, session zones) whenever the local candles array changes. This forces the browser to recalculate coordinate transforms and redraw static vectors that have not changed.
3. **Left-Edge Jitter:** When scrolling the chart to the left boundary, `logicalRange.from < 15` triggers `loadMoreHistory()`. The prepended historical candles shift the index coordinates of all drawing assets, causing visual coordinates to jitter or jump if the rendering layers do not buffer offsets correctly.

```mermaid
graph TD
    A[Binance WebSocket / API] -->|Live Price Ticks| B(MarketDataContext)
    B -->|Exposes livePrice, liveCandle| C{Context Consumers}
    
    %% Unoptimized Path
    C -->|Unoptimized: page.tsx re-renders| D[Parent Dashboard page.tsx]
    D -->|Cascading Re-render| E[Sidebar]
    D -->|Cascading Re-render| F[Chart Component]
    D -->|Cascading Re-render| G[Dashboard Metrics]
    D -->|Cascading Re-render| H[Journal Table]
    
    %% Optimized Path (Phase 3)
    C -->|Isolate to Leaf Nodes| I[ManualOrderPanel]
    C -->|Isolate to Leaf Nodes| J[LiveTicker]
    C -->|Isolate to Leaf| K[PremiumDiscountCard]
    
    %% Static Elements Memoized
    D -.-->|React.memo| E
    D -.-->|React.memo| H
    D -.-->|Throttled Updates| F
    
    %% Chart Optimizations
    F -->|Closed-Candle Memoization Barrier| L{Is New Candle Closed?}
    L -->|YES| M[Rebuild Historical SVG Vectors & Markers]
    L -->|NO| N[Only mutate live price lines & active alert coordinates]
```

---

## 2. Proposed Changes & Optimizations

### A. Atomic State Isolation & Decoupling
To eliminate the global re-render cascade:
* **Decouple root page:** Remove destructuring of `livePrice` from the root [page.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/page.tsx). The root component must remain 100% static on price ticks.
* **Isolate Live Ticking Behaviors:**
  * Move the pending order matching logic and the manual entry price locking logic out of `page.tsx` and encapsulate it inside the [ManualOrderPanel.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/ManualOrderPanel.tsx) or a localized hook wrapper.
  * Let `<ManualOrderPanel />` subscribe to `useMarketDataContext()` directly. This confines re-renders to the panel leaf node when manual trading is active.
* **Leaf-Level Metrics Subscription:**
  * Refactor `<DashboardMetrics />` to not take dynamic state props from the parent. Instead, split it into individual, memoized card components: `<MasterBiasCard />`, `<TargetStatusCard />`, and `<PremiumDiscountCard />`.
  * Only `<PremiumDiscountCard />` (which renders the live Premium vs Discount state) will subscribe to the context's `livePrice`. The other cards will remain memoized and only re-render when their respective static metrics change.

### B. Memoized SVG Layering & Visual Cache
To eliminate SVG reflows on every tick:
* **Introduce Drawing Caches:** Implement a caching mechanism in the `LayerOrchestrator` or drawing plugins. 
* **Locked Coordinates:** All confirmed historical drawing assets (major swings, mitigated FVGs, old session ranges) are static. The orchestrator will cache their computed canvas coordinates.
* **Throttled Recalculation:** We only re-calculate coordinate transforms for static vectors when:
  1. A new candle officially closes (signaled by a change in the last closed candle timestamp ref).
  2. The chart viewport zoom or horizontal scroll range changes (monitored via lightweight-charts visible range change subscriptions).
* **Live Edge Separation:** Only the active live-edge elements (e.g. current ticking price line, active alert thresholds, current pending trade lines) participate in coordinate transform checks on intermediate ticks.

### C. Left-Edge Clamping & Coordinate Buffering
To prevent visual coordinate drift or jumping when loading history:
* **Offset Buffer:** Implement a coordinate mapping offset buffer. When new candles are loaded via `loadMoreHistory()`, calculate the shift in indices:
  $$\Delta \text{Index} = N_{\text{new candles}}$$
* **Relative Anchor Locking:** Readjust the coordinates of all cached visual vectors by adding $\Delta \text{Index}$ to their internal indices before rendering, anchoring them to their absolute timestamp rather than their relative index.

---

## 3. Detailed File Modifications [Planned]

### [MODIFY] [page.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/page.tsx)
* Remove destructuring of `livePrice` from `useMarketDataContext()`.
* Shift the effects for `setManualEntryPrice` (MARKET price locking) and pending order matching out of the home component and move them into `ManualOrderPanel.tsx` or a custom bridge component.
* Wrap `<Sidebar />`, `<JournalTable />`, and `<ManualOrderPanel />` in `React.memo` to ensure they do not re-render unless their specific, non-ticking props change.

### [MODIFY] [DashboardMetrics.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/DashboardMetrics.tsx)
* Refactor to consume `MarketDataContext` directly at the component level.
* Break the dashboard indicators into three memoized sub-cards:
  * `MasterBiasCard`: Re-renders only when AI `bias_label` changes.
  * `TargetStatusCard`: Re-renders only when `target_status` changes.
  * `PremiumDiscountCard`: Subscribes to context `livePrice` and updates status (Premium/Discount/Equilibrium) on every tick.

### [MODIFY] [Chart.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/Chart.tsx)
* Refactor the `Dynamic Chart Layer Orchestrator` to skip rendering static layers on live ticks using a Closed-Candle Memoization Barrier check:
  ```typescript
  const lastClosedT = localCandles[localCandles.length - 2]?.t;
  const isNewCandle = lastClosedTRef.current !== lastClosedT;
  const isViewportChanged = hasViewportScrolledOrZoomed();
  
  if (!isNewCandle && !isViewportChanged) {
    // Only render live-edge layers (e.g. Alert lines, Entry/TP/SL modifiers)
    renderLiveEdgeLayersOnly();
    return;
  }
  ```
* Implement coordinate adjustment buffers inside the rendering context to handle historical candle prepends cleanly without throwing vector alignment shifts.

---

## 4. Verification Plan

### Automated Verification
* Verify that the decoupled layout builds successfully:
  ```powershell
  npx tsc --noEmit
  npm run build
  ```

### Manual Verification & Profiling
* **Chrome DevTools Performance Trace:**
  * Record a 10-second trace during high-frequency kline updates.
  * Verify that the main thread scripting time is minimal, and React rendering/reconciliation tasks are absent during intermediate ticks.
* **Frame Rate (FPS) HUD:**
  * Verify that the chart canvas maintains a steady **60 FPS** during drag interactions and live price ticking.
* **Scroll Alignment Check:**
  * Scroll left to trigger lazy loading of historical candles. Verify that drawing vectors (FVG boxes, MSS lines, SMT circles) remain anchored to their correct timestamps and do not shift or warp.
