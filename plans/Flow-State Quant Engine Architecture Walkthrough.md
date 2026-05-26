# Flow-State Quant Engine Architecture Walkthrough

This walkthrough outlines the design, implementation, and verification outcomes for the **Chart Layer Orchestrator** and **Phase 1: Core Stability** refactors.

---

## 🏗️ Chart Layer Orchestrator Architecture

We designed a robust, extensible, and type-safe **Chart Layer Orchestrator** system using a plugin registry pattern. This allows visual layers (e.g. FVGs, resting liquidity magnets, session clocks) to be dynamically enabled or disabled without impacting chart performance or triggering memory leaks.

### Folder Structure
All Orchestrator configurations and plugins are housed in `src/lib/chartLayers/`:
- `src/lib/chartLayers/types.ts` — Type-safe RenderContext and ChartPlugin interfaces.
- `src/lib/chartLayers/store.ts` — Persistent Zustand store synced with LocalStorage.
- `src/lib/chartLayers/registry.ts` — Central extensibility registry catalog.
- `src/lib/chartLayers/plugins/` — Dynamic plugin drawings:
  - `fvgLayer.ts` — Unmitigated Fair Value Gaps overlays.
  - `magnetsLayer.ts` — Resting BSL/SSL order book liquidity lines.
  - `sessionsLayer.ts` — Asian/London Killzones and True Day Open price boundaries.
  - `displacementLayer.ts` — Displacement and MSS indicators.

---

### Core Interfaces & Registry
The system relies on `RenderContext` to cleanly decouple drawing, cleanup, and DOM overlay logic:

```typescript
export interface RenderContext {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  seriesMarkers?: any;
  data: MarketDataPayload;
  activeCandles: Candle[];
  theme: 'dark' | 'light';
  themeSettings?: ThemeSettings;
  storage: Map<string, any>; // Persistent private plugin state
}
```

New indicators can be integrated simply by implementing `ChartLayer` and invoking `registry.register(newLayer)`.

---

## 🔌 Integrating a New Visual Layer (Extensibility Demonstration)

To show how easily new layers integrate, let's design an example **Pivot Points Layer** (`pivotsLayer.ts`) that draws daily horizontal support and resistance lines:

```typescript
import type { ChartLayer } from '../types';

export const pivotsLayer: ChartLayer = {
  id: 'pivots',
  name: 'Pivot Points',
  description: 'Daily mathematical support and resistance bounds',
  icon: 'TrendingUp',
  renderChart(context) {
    const { series, activeCandles, storage } = context;

    // 1. Clear old pivot lines
    const oldLines = storage.get('lines') || [];
    oldLines.forEach((line: any) => series.removePriceLine(line));
    storage.delete('lines');

    if (activeCandles.length === 0) return;

    // 2. Compute classic pivot point (H + L + C) / 3 from last candle
    const lastCandle = activeCandles[activeCandles.length - 1];
    const pivot = (lastCandle.h + lastCandle.l + lastCandle.c) / 3;

    // 3. Create price line
    const pivotLine = series.createPriceLine({
      price: pivot,
      color: 'rgba(168, 85, 247, 0.6)', // Glowing purple
      lineStyle: 1, // Dotted
      lineWidth: 1,
      axisLabelVisible: true,
      title: 'DAILY PIVOT',
    });

    storage.set('lines', [pivotLine]);
  },
  clearChart(context) {
    const { series, storage } = context;
    const oldLines = storage.get('lines') || [];
    oldLines.forEach((line: any) => series.removePriceLine(line));
    storage.delete('lines');
  }
};
```

---

## 🎛️ Floating Glass HUD Control Panel

We created a gorgeous, floating glass-morphism overlay HUD positioned in the **top-right** of the chart column (`src/components/ChartLayerHud.tsx`).
- **Collapsible Pill Control:** Minimizes into a single layers icon that expands smoothly into a floating glass capsule.
- **Zustand Visibility Binding:** Reflects toggled states with smooth micro-animations and glowing indicators (`bg-[#a855f7]/15 text-[#d1bcff]`), immediately syncing parameters in LocalStorage.

---

## ⏱️ JSON Export Filename Timestamp Utility

We upgraded `triggerDownload` inside `src/hooks/useMarketData.ts` to retrieve the current system time formatted as `_YYYYMMDD_HHMM` (e.g. `_20260526_1825`) and automatically append it to exported filenames for all V6 Naked and V8.2 Enriched files, avoiding filename collisions.

---

## 📝 Complete Verification Checklist

- [x] Zustand library installed successfully.
- [x] Type-safe Registry, persist store, and plugins implemented.
- [x] Decoupled FVG overlays, volumetric markers, magnets, and sessions from `Chart.tsx` to the Orchestrator loop.
- [x] Integrated `ChartLayerHud` component visually on the chart canvas.
- [x] Updated JSON export trigger to format and append time.
- [x] Verified full codebase compilation via `npx tsc --noEmit` returning **zero errors**.
