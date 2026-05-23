# Walkthrough: Strategic Equation Builder with Temporal Logic

## Summary

Implemented a comprehensive Custom Equation Builder system that transforms the SettingsModal into a 3-tab Command Center, adds a row-based strategy editor with per-condition temporal toggles (INSTANT vs ON_CLOSE), creates a real-time execution engine, persists strategies to Neon PostgreSQL, and integrates strategy-match notifications into the existing Brutalist HUD toast system.

**Build: ✅ Zero errors** | **New routes: `/api/strategies`** | **8 files modified/created**

---

## Changes Made

### 1. Database Schema — `custom_strategies` table

**File:** [route.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/settings/route.ts) (modified `initTables()`)

Added auto-creation of the `custom_strategies` table alongside the existing `terminal_settings` table. Self-healing architecture — table creates on first access if missing.

```sql
CREATE TABLE IF NOT EXISTS custom_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  logic_json JSONB NOT NULL,       -- Array of StrategyCondition objects
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

### 2. Strategies API Route

**File:** [route.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/strategies/route.ts) (NEW)

Full CRUD API with auth protection:
- **GET** — Returns all strategies for the authenticated user
- **POST** — Creates new or updates existing strategy (by id)
- **DELETE** — Removes a strategy by UUID (ownership-scoped)

Follows the exact same pattern as the existing `/api/settings` route.

---

### 3. Global Context Upgrade — WebSocket Hoist

**File:** [MarketDataContext.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/context/MarketDataContext.tsx) (rewritten)

Hoisted `useBinanceWS()` from `Chart.tsx` into the global `MarketDataProvider`. This:
- Prevents duplicate WebSocket connections (Lesson #7 compliance)
- Makes `liveCandle`, `livePrice`, `wsStatus` globally accessible
- Adds `wsInterval` / `setWsInterval` to let the Chart control the WS timeframe

**File:** [Chart.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/Chart.tsx) (modified)

- Removed the local `useBinanceWS()` import and call
- Now destructures `liveCandle`, `livePrice`, `setWsInterval` from `useMarketDataContext()`
- Added a sync effect: when the chart's `interval` prop changes, it updates the global WS interval

---

### 4. Equation Builder Component

**File:** [EquationBuilder.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/EquationBuilder.tsx) (NEW)

A split-panel component:
- **Left panel**: Strategy list with active/inactive power toggles and "New Strategy" button
- **Right panel**: Strategy editor with:
  - Name input
  - Row-based logic conditions, each with:
    - Metric selector (FVG, Displacement, OI_Trend, MSS, SMT, Price_vs_Open)
    - Context-aware operator (IS_TRUE/IS_FALSE for booleans, ==/!= for enums)
    - Optional value selector (for enum metrics)
    - **Temporal Toggle**: ⚡ TICK (instant) or 🔒 CLOSE (on candle close)
    - Delete row button
  - Add Condition / Save / Delete actions

---

### 5. Command Center Modal Refactor

**File:** [SettingsModal.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/SettingsModal.tsx) (rewritten)

Transformed from 2-tab horizontal to 3-tab vertical sidebar:

| Tab | Icon | Content |
|---|---|---|
| **AI CONFIG** | Brain | Gemini model select, system prompt, API key |
| **STRATEGY** | Crosshair | EquationBuilder component |
| **AUDIO** | Music | Existing signal alert sound mappings |

- Modal width expanded to `max-w-3xl`
- Price alert editing is now a floating overlay (not a tab)
- AI Config fetches/saves via the existing `/api/settings` route

---

### 6. Strategy Execution Engine

**File:** [useStrategyEvaluator.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useStrategyEvaluator.ts) (NEW)

The runtime evaluator that monitors the global state:

**Metric Resolution Map:**

| Metric | Source | Return Type |
|---|---|---|
| `FVG` | `ipda_metrics.active_fvgs.length > 0` | boolean |
| `DISPLACEMENT` | `institutional_sponsorship.status === 'ACTIVE'` | boolean |
| `OI_TREND` | `order_flow_engine.open_interest_trend` | `RISING`/`FALLING`/`FLAT` |
| `MSS` | `market_structure_shift` flag | boolean |
| `SMT` | `smart_money_sentiment.smart_money_divergence` | boolean |
| `PRICE_VS_OPEN` | `livePrice > true_day_open_0700` | `ABOVE`/`BELOW` |

**Temporal Logic:**
- If ANY condition has `ON_CLOSE` temporal mode, the entire strategy is gated behind `liveCandle.isClosed === true`
- Pure INSTANT strategies can fire mid-candle

**Debounce Lock:**
- Tracks `lastFiredCandleTime` per strategy ID
- A strategy fires **once per candle** (prevents execution loops — Lesson #10)
- Strategies are fetched on mount + refreshed every 30s

---

### 7. HUD Toast Integration

**Files:** [useLiveAlerts.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useLiveAlerts.ts), [SmartAlertsToast.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/SmartAlertsToast.tsx)

- Added `STRATEGY_MATCHED` to the `SmartAlert.type` union
- Toast styling: high-contrast black background, white border, green `#50ffaf` left accent border, pulsing Crosshair icon
- Message format: `[SYSTEM: STRATEGY_MATCHED → {STRATEGY_NAME}]`

---

### 8. Page Integration

**File:** [page.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/page.tsx) (modified)

- Imported and called `useStrategyEvaluator()` — runs silently in background
- Header button renamed from `[ ALERT SOUNDS ]` → `[ COMMAND CENTER ]` with Settings icon
- Modal now opens to the Strategy tab by default
- Tab selection is stateful — clicking different UI entry points can open different tabs

---

## Validation

| Check | Result |
|---|---|
| `npx next build` | ✅ Compiled successfully, zero type errors |
| `/api/strategies` in route table | ✅ Visible as dynamic route |
| TypeScript strict mode | ✅ No type errors in any new/modified file |
| No duplicate WS connections | ✅ Single `useBinanceWS` in MarketDataProvider |
| Lesson #7 compliance | ✅ Hook hoisted to context singleton |
| Lesson #10 compliance | ✅ Per-candle debounce lock in evaluator |
