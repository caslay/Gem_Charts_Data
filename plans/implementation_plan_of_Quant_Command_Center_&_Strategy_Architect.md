# Strategic Equation Builder with Temporal Logic

Evolve the SettingsModal into a 3-tab Command Center, build a custom strategy Equation Builder with per-condition temporal toggles (Instant vs On Close), create an execution engine hook, persist strategies to Neon PostgreSQL, and integrate strategy-match notifications into the existing Brutalist toast system.

---

## User Review Required

> [!IMPORTANT]
> **AI CONFIG tab content**: The existing `/settings` page ([page.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/settings/page.tsx)) already contains the Gemini API Key, Model Select, and System Prompt UI. For the new **[AI CONFIG]** tab in the modal, I plan to **embed the same 3 settings inline** (model select, system prompt textarea, API key input) directly inside the modal — but backed by the same `/api/settings` route. This means:
> - The standalone `/settings` page will remain functional (no removal).
> - The modal tab is a convenience shortcut, not a replacement.
> - Changes made in either location sync through the same Neon DB table (`system_settings`).
>
> Is this the desired behavior, or should the standalone page be deprecated?

> [!WARNING]
> **Execution scope**: The `useStrategyEvaluator` hook subscribes to data from `MarketDataContext` (polled every 5s) and `useBinanceWS` (live ticks). Since `useBinanceWS` is currently consumed **only inside `Chart.tsx`** and is NOT part of the global context, we have two options:
> 1. **(Recommended) Hoist `useBinanceWS` into `MarketDataContext`** — making `livePrice` and `liveCandle` globally accessible. This is the cleanest path for "INSTANT" evaluations.
> 2. **Pass WebSocket data as props** from `page.tsx` into the evaluator — requires more plumbing.
>
> I recommend Option 1. Please confirm.

## Open Questions

> [!IMPORTANT]
> **Available Metrics**: The user request lists: `FVG`, `Displacement`, `OI_Trend`, `MSS`, `SMT`, `Price_vs_Open`. The current backend payload exposes most of these via `ipda_metrics` and `order_flow_engine`. I will map them as:
>
> | Metric Key | Source Field | Type |
> |---|---|---|
> | `FVG` | `ipda_metrics.active_fvgs.length > 0` | boolean |
> | `DISPLACEMENT` | `ipda_metrics.institutional_sponsorship.status === 'ACTIVE'` | boolean |
> | `OI_TREND` | `order_flow_engine.oi_trend` (inferred from OI delta) | `RISING` / `FALLING` / `FLAT` |
> | `MSS` | `ipda_metrics.market_structure_shift` | boolean |
> | `SMT` | `order_flow_engine.smart_money_sentiment.smart_money_divergence` | boolean |
> | `PRICE_VS_OPEN` | `livePrice > ipda_metrics.true_day_open_0700` | `ABOVE` / `BELOW` |
>
> Are there additional metrics you want in V1 or is this mapping correct?

---

## Proposed Changes

### Component: Command Center Modal Refactor

Refactoring the existing 2-tab SettingsModal into a 3-tab Command Center. The existing Signal Alerts tab becomes "AUDIO VAULT", AI Config is added as tab 1, and the new Equation Builder occupies tab 2.

#### [MODIFY] [SettingsModal.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/SettingsModal.tsx)

- **Tab system**: Replace 2-tab (`price` | `signal`) with a **vertical sidebar tab** system containing 3 tabs:
  - `ai_config` — **[AI CONFIG]**: Gemini model select, system prompt, API key (same fields as `/settings` page)
  - `strategy` — **[STRATEGY ARCHITECT]**: Houses the new EquationBuilder component
  - `audio` — **[AUDIO VAULT]**: Existing signal alert sound mappings (moved from the current "Signal Alerts" tab)
- **Price Alert panel**: Remains accessible when the modal is opened with an `alert` prop (opens in a **sub-panel overlay** within the modal, not a tab — preserving existing behavior from `Chart.tsx` alert editing).
- **Modal width**: Increase from `max-w-md` to `max-w-3xl` to accommodate the wider Equation Builder.
- **Tab styling**: Vertical tabs on the left with icon + label, active state uses the existing `#50ffaf` accent.
- **AI Config tab**: Fetches from and saves to `/api/settings` using the existing `system_settings` table pattern.
- **Props change**: Add `initialTab` options: `'ai_config' | 'strategy' | 'audio'` (default: `'ai_config'`). The existing `'price'` and `'signal'` variants map to `'price_overlay'` and `'audio'` respectively.

---

### Component: Equation Builder

A new component containing the core strategy creation/editing UI with row-based logic and temporal toggles.

#### [NEW] [EquationBuilder.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/EquationBuilder.tsx)

**Features:**
- **Strategy List**: Left panel showing saved strategies with active/inactive toggles and an "Add Strategy" button.
- **Strategy Editor**: Right panel showing:
  - **Strategy Name**: Text input with brutalist styling.
  - **Logic Rows**: Each row contains:
    1. **Metric Selector**: Dropdown with options: `FVG`, `DISPLACEMENT`, `OI_TREND`, `MSS`, `SMT`, `PRICE_VS_OPEN`
    2. **Operator**: Dropdown with `IS_TRUE`, `IS_FALSE`, `EQUALS`, `NOT_EQUALS` (context-dependent based on metric type)
    3. **Value** (optional): For enum metrics like `OI_TREND` → `RISING`/`FALLING`/`FLAT`
    4. **Temporal Toggle**: A switch button with two states:
       - `⚡ INSTANT` — evaluates against live WebSocket tick price
       - `🔒 ON_CLOSE` — only evaluates when `liveCandle.isClosed === true`
    5. **Delete Row** button (trash icon)
  - **Add Condition** button to append a new row.
  - **Save Strategy** / **Delete Strategy** actions.
- **Data flow**: Reads/writes via new API endpoints: `GET /api/strategies` and `POST /api/strategies`.
- **State management**: Local `useState` for the editor form, fetches list from API on mount.

**TypeScript Interfaces:**
```typescript
interface StrategyCondition {
  id: string;
  metric: 'FVG' | 'DISPLACEMENT' | 'OI_TREND' | 'MSS' | 'SMT' | 'PRICE_VS_OPEN';
  operator: 'IS_TRUE' | 'IS_FALSE' | 'EQUALS' | 'NOT_EQUALS';
  value?: string; // For enum-type metrics
  temporal: 'INSTANT' | 'ON_CLOSE';
}

interface CustomStrategy {
  id: string;       // UUID
  name: string;
  conditions: StrategyCondition[];
  is_active: boolean;
}
```

---

### Component: Strategy API Route

#### [NEW] [route.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/strategies/route.ts)

- **GET**: Returns all `custom_strategies` rows for the authenticated user.
- **POST**: Upserts a strategy (create or update). Accepts `{ id?, name, conditions, is_active }`.
- **DELETE**: Deletes a strategy by ID. Accepts `{ id }`.
- Auth-protected using the existing `auth()` pattern from `@/auth`.
- Self-healing: auto-creates the `custom_strategies` table if missing (matching the `initTables()` pattern in [route.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/settings/route.ts)).

---

### Hook: Strategy Execution Engine

The core runtime evaluator that subscribes to market data and fires strategy-matched alerts.

#### [NEW] [useStrategyEvaluator.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useStrategyEvaluator.ts)

**Architecture:**
1. **Subscribes to**: `MarketDataContext` (polled data, ipda_metrics, order_flow_engine) + `liveCandle` / `livePrice` (from hoisted `useBinanceWS`).
2. **On every tick** (liveCandle update):
   - For each active strategy:
     - Evaluate all `INSTANT` conditions against `livePrice` and current `data` snapshot.
     - Hold `ON_CLOSE` conditions in a pending state.
     - When `liveCandle.isClosed === true`:
       - Evaluate all `ON_CLOSE` conditions.
       - Check if ALL conditions (both INSTANT and ON_CLOSE) are simultaneously TRUE.
       - If matched → fire alert via `triggerAlert()`.
3. **Debounce/Lock**: Track `lastFiredCandleTime` per strategy. A strategy can only fire **once per candle close timestamp** to prevent execution loops (Lesson #10 from directives).
4. **Metric Evaluation Map**: A pure function mapping each metric key to its boolean/enum evaluation against the current data snapshot.

**Key Functions:**
```typescript
function evaluateCondition(
  condition: StrategyCondition,
  data: MarketDataPayload,
  livePrice: number,
  liveCandle: LiveCandle | null
): boolean

function evaluateStrategy(
  strategy: CustomStrategy,
  data: MarketDataPayload,
  livePrice: number,
  liveCandle: LiveCandle | null
): boolean
```

**Temporal Logic:**
- If a strategy has mixed temporal modes (e.g. 2 INSTANT + 1 ON_CLOSE), the strategy **cannot trigger until a candle close event** where all 3 conditions are simultaneously true.
- Pure INSTANT strategies can fire mid-candle.
- Pure ON_CLOSE strategies only fire on close events.

---

### Context: Hoist WebSocket into Global Context

#### [MODIFY] [MarketDataContext.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/context/MarketDataContext.tsx)

- Import and call `useBinanceWS()` inside `MarketDataProvider`.
- Expose `liveCandle`, `livePrice`, `wsStatus`, and `reconnect` on the context.
- Ensures the evaluator and other consumers can access tick data without prop drilling.

#### [MODIFY] [useMarketData.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useMarketData.ts)

- **No changes to the hook itself** — the WS data is added at the context level, not inside useMarketData.

#### [MODIFY] [Chart.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/Chart.tsx)

- Remove the local `useBinanceWS()` call.
- Consume `liveCandle`, `livePrice`, `wsStatus` from `useMarketDataContext()` instead.
- **Critical**: Preserve the existing `interval` prop pass-through for WS connection. The context's `useBinanceWS` must accept the active interval from somewhere — likely from a new state in the context or passed to the provider.

#### [MODIFY] [page.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/page.tsx)

- Integrate the `useStrategyEvaluator` hook.
- Pass strategy-matched alerts to `SmartAlertsToast` (reuses existing alert system).
- Update the "ALERT SOUNDS" button label → "COMMAND CENTER" and open the modal to the `strategy` tab by default.

---

### Database: Custom Strategies Table

#### [MODIFY] [route.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/settings/route.ts) (initTables)

Add auto-creation of `custom_strategies` table inside the existing `initTables()` function:

```sql
CREATE TABLE IF NOT EXISTS custom_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  logic_json JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

### HUD: Strategy Match Toast

#### [MODIFY] [SmartAlertsToast.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/SmartAlertsToast.tsx)

- Add a new alert type: `STRATEGY_MATCHED` to the `SmartAlert` type union.
- Add visual styling for `STRATEGY_MATCHED`:
  - High-contrast white-on-black brutalist style with a thick left border accent.
  - Message format: `[SYSTEM: STRATEGY_MATCHED → {STRATEGY_NAME}]`
  - Icon: `Crosshair` from lucide-react.

#### [MODIFY] [useLiveAlerts.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useLiveAlerts.ts)

- Add `STRATEGY_MATCHED` to the `SmartAlert.type` union.

---

## Verification Plan

### Automated Tests
1. **Build check**: `npm run build` — ensure zero type errors across all modified/new files.
2. **Dev server**: `npm run dev` — verify no runtime crashes.

### Manual Verification
1. **Command Center Modal**:
   - Open via the header button → verify 3 tabs render correctly.
   - AI Config tab: verify settings load from Neon, save correctly.
   - Audio Vault tab: verify existing sound mapping functionality is preserved.
   - Strategy Architect tab: verify builder UI renders.
2. **Equation Builder**:
   - Create a strategy with 2 INSTANT + 1 ON_CLOSE condition.
   - Verify it saves to Neon via `/api/strategies`.
   - Reload page → verify strategy persists.
3. **Execution Engine**:
   - Create a simple strategy: `DISPLACEMENT IS_TRUE [INSTANT]`.
   - Wait for displacement to become active in the live feed → verify toast fires.
   - Verify the toast does NOT fire again for the same candle (debounce lock).
4. **WebSocket Hoist**:
   - Verify chart still renders live candles correctly after the `useBinanceWS` hoist.
   - Verify no duplicate WebSocket connections (check browser DevTools → Network → WS).
