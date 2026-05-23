# Strategic Equation Builder — Execution Tracker

## Phase 1: Database & API Layer
- [ ] Add `custom_strategies` table to `initTables()` in `/api/settings/route.ts`
- [ ] Create `/api/strategies/route.ts` (GET/POST/DELETE)

## Phase 2: Global Context Upgrade
- [ ] Hoist `useBinanceWS` into `MarketDataContext.tsx`
- [ ] Expose `liveCandle`, `livePrice`, `wsStatus`, `reconnect`, `wsInterval`/`setWsInterval`
- [ ] Refactor `Chart.tsx` — remove local `useBinanceWS`, consume from context

## Phase 3: Equation Builder Component
- [ ] Create `EquationBuilder.tsx` with row-based logic + temporal toggle
- [ ] TypeScript interfaces for `StrategyCondition`, `CustomStrategy`

## Phase 4: Command Center Modal Refactor
- [ ] Refactor `SettingsModal.tsx` to 3-tab vertical sidebar layout
- [ ] Tab 1: [AI CONFIG] — embed Gemini model/key/prompt
- [ ] Tab 2: [STRATEGY ARCHITECT] — embed EquationBuilder
- [ ] Tab 3: [AUDIO VAULT] — existing signal alert sounds

## Phase 5: Strategy Execution Engine
- [ ] Create `useStrategyEvaluator.ts`
- [ ] Metric evaluation map (FVG, DISPLACEMENT, OI_TREND, MSS, SMT, PRICE_VS_OPEN)
- [ ] Temporal logic (INSTANT vs ON_CLOSE gating)
- [ ] Per-candle debounce lock

## Phase 6: HUD Toast Integration
- [ ] Add `STRATEGY_MATCHED` to `SmartAlert.type` in `useLiveAlerts.ts`
- [ ] Add visual styling in `SmartAlertsToast.tsx` (Crosshair icon)

## Phase 7: Page Integration
- [ ] Wire `useStrategyEvaluator` into `page.tsx`
- [ ] Update header button label → COMMAND CENTER

## Phase 8: Verification
- [ ] `npm run build` — zero type errors
- [ ] Dev server runtime check
