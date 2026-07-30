# TRUE DAY OPEN (TDO) — Comprehensive Codebase Audit Map

> **Audit Date:** 2026-07-29  
> **Audit Scope:** Full codebase search across `*.ts`, `*.tsx`, `*.js`, `*.py`, `*.json`, `*.md`  
> **Search Terms:** `true_day_open`, `true_day_open_0700`, `TDO`, `PRICE_VS_OPEN`, `open_price`, `midnight_open`, `ethOpen`, `btcOpen`, `trueDayOpen`, `vs_daily_open`  
> **Purpose:** Pre-decoupling structural footprint mapping for Phase 2 removal.

---

## Executive Summary

True Day Open (TDO) is a **mid-weight dependency** woven across 6 functional domains. Its primary role is a **session anchor price** — the open of the 00:00 UTC 15-minute candle — classifying live price as "premium" or "discount" relative to NY Midnight open.

| Metric | Count |
|---|---|
| Total source files with TDO references | **12** |
| Directive/doc files | **4** |
| Functional domains touched | **6 of 6** |
| Hard TS compilation dependencies | **3** |
| Runtime crash risks (silent behavioral) | **3** |
| UI components displaying TDO | **4** |
| Strategy condition types using TDO | **1** (`PRICE_VS_OPEN`) |
| Saved test strategy JSONs using TDO | **2** |
| Theme tokens for TDO chart color | **2** (`dark_chart_tdo`, `light_chart_tdo`) |

> **Critical Insight — BiasEngine Ghost Reference:** `BiasEngine.ts` accepts `true_day_open_0700` in its interface but **never uses it** in the bias logic. Zero-impact dead field.
>
> **Critical Insight — Live Route TDO Already Omitted:** The live `resolveTripleVectorBias()` call at `route.ts:1119` does NOT pass `true_day_open_0700`. TDO is already decoupled from the live bias engine. Only backtest engines still pass it.

---

## Domain 1: Data Ingestion & API Layer

### `src/app/api/market-data/route.ts`

| Line(s) | Symbol | Role | Notes |
|---|---|---|---|
| 485–492 | `btc_true_day_open_0700` | **BTC TDO computation** | Backward-scans `candlesBtc15m` for `getUTCHours()===0 && getUTCMinutes()===0` |
| 604 | `true_day_open_0700` | ETH TDO variable | `number | null`, default null |
| 305 comment | `limit=150` for `btc_15m` | API over-fetch for TDO lookback | Can be reduced to ~20 after removal |
| 1170 | `ethOpen: true_day_open_0700` | SMT engine input | Passed as `ethOpen` to `getSmtContext()` |
| 1174 | `btcOpen: btc_true_day_open_0700` | SMT engine input | Passed as `btcOpen` to `getSmtContext()` |
| 1182 | `true_day_open: true_day_open_0700` | IPDA payload emission | Top-level key in API JSON response |

**Risk:** `btc_15m` fetches `limit=150` solely for TDO resolution. Removing TDO without reducing this limit wastes quota.

---

### `src/lib/quantLabEngine.ts`

| Line(s) | Symbol | Role |
|---|---|---|
| 42–50 | `trueDayOpen0700` + `for` loop | TDO computation (headless backtest path) |
| 73–77 | `currentPricing` assignment | Sets PREMIUM / DISCOUNT / FAIR_VALUE |
| 226–227 | `true_day_open`, `true_day_open_0700` | Emitted into `ipda_metrics` |
| 273 | `true_day_open: trueDayOpen0700` | Emitted into `ipda_metrics.macro_levels` |
| 280–283 | `vs_daily_open` | Sets `ABOVE_OPEN` / `BELOW_OPEN` in `pricing_context` |
| 432–435 | `PRICE_VS_OPEN` case | Evaluates strategy condition |

---

### `src/hooks/useBacktestEngine.ts`

| Line(s) | Symbol | Role |
|---|---|---|
| 180–189 | `trueDayOpen0700` + `for` loop | TDO computation for client-side replay |
| 212–216 | `currentPricing` assignment | Sets PREMIUM / DISCOUNT / FAIR_VALUE |
| 384 | `true_day_open_0700: trueDayOpen0700` | Passed to `resolveTripleVectorBias()` |
| 398–399 | `true_day_open`, `true_day_open_0700` | Emitted into `ipda_metrics` |
| 447 | `true_day_open: trueDayOpen0700` | Emitted into `ipda_metrics.macro_levels` |
| 454–456 | `vs_daily_open` | Sets `ABOVE_OPEN` / `BELOW_OPEN` |

---

### `src/hooks/useBacktestEngine-bkup.ts`

**Status: INACTIVE BACKUP FILE** — identical logic, not compiled into production. Delete alongside primary.

---

## Domain 2: State Machines & Quant Metrics

### `src/lib/smtEngine.ts`

| Line(s) | Symbol | Role |
|---|---|---|
| 83 (JSDoc) | `True Day Open` | Function anchors % performance to TDO |
| 88–90 | `ethOpen`, `btcOpen` params | **TDO aliases** — receive `true_day_open_0700` values |
| 92 | `if (!ethOpen || !btcOpen) return 'LAGGARD'` | Graceful fallback — always LAGGARD without TDO |
| 94–95 | `(ethPrice - ethOpen) / ethOpen` | **Core math** — percent-from-TDO |
| 110–114 | Interface fields | `ethOpen`, `btcOpen` in `SmtContext` |
| 136–138 | `params.ethOpen`, `params.btcOpen` | Passed to `calculateRelativeStrength()` |

**Risk:** `BTC_RELATIVE_STRENGTH` metric permanently degrades to static `'LAGGARD'` without TDO. Must define replacement anchor (prev close, PDH/PDL midpoint).

---

### `src/lib/quantEngine/BiasEngine.ts`

| Line(s) | Symbol | Role |
|---|---|---|
| 9 | `true_day_open_0700?: number \| null` | Interface field — **declared but never used** |

**Zero-impact ghost field. Safe to delete from interface.**

---

### `src/hooks/useLiveAlerts.ts`

| Line(s) | Symbol | Role |
|---|---|---|
| 225 | `const trueDayOpen = pricingContext.true_day_open_0700 \|\| 0` | TDO extraction |
| 253 | `if (hasNewBullishFvg && trueDayOpen > 0 && currentPrice > trueDayOpen)` | **RISK_OVERRIDE alert gate** |

**Risk:** Alert permanently silenced when TDO is null/0. Must replace with `local_dealing_range.current_status === 'PREMIUM'`.

---

## Domain 3: Strategy Architect & Evaluator Engine

### `src/components/modals/EquationBuilder.tsx`

| Line(s) | Symbol | Role |
|---|---|---|
| 17 | `'PRICE_VS_OPEN'` | `MetricKey` TypeScript union member |
| 71 | METRICS array entry | UI dropdown option with `['ABOVE', 'BELOW']` enum values |

---

### `src/hooks/useStrategyEvaluator.ts`

| Line(s) | Symbol | Role |
|---|---|---|
| 17 (JSDoc) | `PRICE_VS_OPEN` | Comment example |
| 199 | `case 'PRICE_VS_OPEN':` | Runtime switch case |
| 200–201 | `trueDayOpen` extraction | Two-level fallback: `ipda.true_day_open_0700 \|\| ipda.pricing_context?.true_day_open_0700 \|\| 0` |
| 204 | `if (trueDayOpen === 0 \|\| price === 0) return 'ABOVE'` | **Silent false-positive failsafe** |
| 205 | Comparison logic | `price > trueDayOpen ? 'ABOVE' : 'BELOW'` |

**Risk (HIGH):** Failsafe defaults to `'ABOVE'`. Every LONG strategy using `PRICE_VS_OPEN EQUALS ABOVE` fires permanently when TDO is null.

---

### Saved Strategy JSON Files

| File | Line | Reference |
|---|---|---|
| `ultra_simple_test_long.json` | 13 | `"metric": "PRICE_VS_OPEN"` — sole LONG condition |
| `ultra_simple_test_short.json` | 13 | `"metric": "PRICE_VS_OPEN"` — sole SHORT condition |

**Risk (HIGH):** After removal, LONG strategy fires on every tick due to silent failsafe.

---

## Domain 4: Canvas & Visualization Layer

### `src/lib/chartLayers/plugins/sessionsLayer.ts`

| Line(s) | Symbol | Role |
|---|---|---|
| 23 | `macro.true_day_open \|\| macro.true_day_open_0700 \|\| null` | Two-key fallback TDO read |
| 31–40 | `series.createPriceLine(...)` | Draws horizontal `'TRUE DAY OPEN'` ray on chart |
| 34 | `themeSettings?.dark_chart_tdo` | User-customizable line color token |

---

### `src/app/settings/page.tsx`

| Line(s) | Symbol | Role |
|---|---|---|
| 1285 | `dark_chart_tdo` ColorPickerItem | Dark theme TDO color UI control |
| 1565 | `light_chart_tdo` ColorPickerItem | Light theme TDO color UI control |

---

### `src/components/Sidebar.tsx`

| Line(s) | Symbol | Role |
|---|---|---|
| 367–368 | `metrics?.true_day_open` | "NY Day Open" HUD display row — optional chaining, no crash |

---

### `src/app/backtest/BacktestSidebar.tsx`

| Line(s) | Symbol | Role |
|---|---|---|
| 203–206 | `metrics?.true_day_open` | "NY Day Open" replay sidebar row — optional chaining, no crash |

---

### `src/components/MatrixConfigDrawer.tsx`

| Line(s) | Symbol | Role |
|---|---|---|
| 7, 20 | `true_day_open?: number \| null` | Two optional interface fields |
| 134–136 | `metrics?.true_day_open` | "True Day Open" display row in Temporal Context section |

---

### `src/app/quant-sandbox/page.tsx`

| Line(s) | Symbol | Role |
|---|---|---|
| 851–852 | `True Day Open (07:00 Cairo):` | **Static mock** — hardcoded `$3,412.00`, no live binding |
| 1075–1079 | SVG line at `priceToY(3412)` | **Static SVG line** — hardcoded, no data binding |

---

## Domain 5: AI Agent & System Prompts

### `src/lib/aiSystemPrompt.ts`

**Result: NO TDO REFERENCE — DOMAIN IS CLEAN.**

Current prompt (V12.1.0) operates exclusively on `macro_structural_magnets`, `pricing_context.local_dealing_range.profile_metrics`, and `ipda_metrics.macro_daily_bias`. TDO was previously removed in the Bias-Only Quant Protocol refactor. Zero action required.

---

## Domain 6: Historical Backtest Engine

Both `useBacktestEngine.ts` and `quantLabEngine.ts` implement identical TDO computation:

```typescript
let trueDayOpen0700: number | null = null;
for (let i = candles_15m.length - 1; i >= 0; i--) {
  const d = new Date(candles_15m[i].t);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
    trueDayOpen0700 = candles_15m[i].o;
    break;
  }
}
```

Used to: (1) set `currentPricing`, (2) emit `vs_daily_open` enum, (3) emit dual TDO keys in payload.

---

## Master Breakdown Table

| # | File | Line(s) | Symbol | Domain | Risk |
|---|---|---|---|---|---|
| 1 | `route.ts` | 485–492 | `btc_true_day_open_0700` computation | Ingestion | 🟡 Medium |
| 2 | `route.ts` | 604 | `true_day_open_0700` declaration | Ingestion | 🟡 Medium |
| 3 | `route.ts` | 305 | `btc_15m limit=150` API over-fetch | Ingestion | 🟡 Medium |
| 4 | `route.ts` | 1170, 1174 | `ethOpen`, `btcOpen` → SMT engine | State Machine | 🔴 High |
| 5 | `route.ts` | 1182 | `true_day_open` in IPDA payload | Ingestion | 🟡 Medium |
| 6 | `smtEngine.ts` | 88–98 | `calculateRelativeStrength()` core math | State Machine | 🔴 High |
| 7 | `smtEngine.ts` | 110–138 | Interface + orchestrator pass-through | State Machine | 🟡 Medium |
| 8 | `BiasEngine.ts` | 9 | Ghost field (dead-weight) | State Machine | 🟢 Low |
| 9 | `useLiveAlerts.ts` | 225, 253 | `trueDayOpen` RISK_OVERRIDE gate | State Machine | 🔴 High |
| 10 | `useStrategyEvaluator.ts` | 199–205 | `PRICE_VS_OPEN` case + silent failsafe | Strategy | 🔴 High |
| 11 | `EquationBuilder.tsx` | 17, 71 | MetricKey union + UI dropdown | Strategy | 🟡 Medium |
| 12 | `quantLabEngine.ts` | 43–283, 432–435 | Full computation + evaluator | Ingestion+Strategy | 🔴 High |
| 13 | `useBacktestEngine.ts` | 182–456 | Full computation + payload + bias call | Backtest | 🔴 High |
| 14 | `useBacktestEngine-bkup.ts` | 143–255 | Inactive legacy copy | Backtest | 🟢 Low |
| 15 | `sessionsLayer.ts` | 23, 31–40 | Chart price line rendering | Canvas | 🟡 Medium |
| 16 | `settings/page.tsx` | 1285, 1565 | Theme color picker controls | Canvas | 🟢 Low |
| 17 | `Sidebar.tsx` | 367–368 | HUD display row | Canvas | 🟢 Low |
| 18 | `BacktestSidebar.tsx` | 203–206 | Replay display row | Canvas | 🟢 Low |
| 19 | `MatrixConfigDrawer.tsx` | 7, 20, 134–136 | Interface fields + display | Canvas | 🟢 Low |
| 20 | `quant-sandbox/page.tsx` | 851, 1075–1079 | Static mock display + SVG line | Canvas | 🟢 Low |
| 21 | `ultra_simple_test_long.json` | 13 | Sole LONG condition | Strategy | 🔴 High |
| 22 | `ultra_simple_test_short.json` | 13 | Sole SHORT condition | Strategy | 🔴 High |
| 23 | `aiSystemPrompt.ts` | — | **No reference** | AI | ✅ None |

---

## Dependency & Risk Analysis

### Hard TypeScript Compilation Risks

1. **`BiasEngine.ts:9`** — `BiasEngineParams.true_day_open_0700` optional field. Callers still pass it — removing from interface causes no error (callers can pass extra props in TS), but callers should be cleaned up.
2. **`MatrixConfigDrawer.tsx:7,20`** — `true_day_open?` optional fields. Removing is safe as all consumers use optional chaining.
3. **`EquationBuilder.tsx:17`** — Removing `'PRICE_VS_OPEN'` from `MetricKey` union causes TS errors wherever `evaluateMetric` is typed to accept `MetricKey`.

### Runtime Silent Regression Risks

1. **`useStrategyEvaluator.ts:204` & `quantLabEngine.ts:434`** — `return 'ABOVE'` failsafe causes all `PRICE_VS_OPEN EQUALS ABOVE` strategies to permanently fire.
2. **`useLiveAlerts.ts:253`** — `RISK_OVERRIDE` alert permanently silenced when TDO is null.
3. **`smtEngine.ts:92`** — `BTC_RELATIVE_STRENGTH` permanently returns `'LAGGARD'`.

---

## Phase 2 Decoupling & Safelist Strategy

### Removal Sequence (Safe-First Order)

```
STEP 1  → Neutralize evaluator cases (prevent silent false-positives)
STEP 2  → Remove PRICE_VS_OPEN from MetricKey union + METRICS array
STEP 3  → Migrate test JSON strategies to LOCAL_PRICING metric
STEP 4  → Replace live alert gate with local_dealing_range.current_status
STEP 5  → Define SMT relative strength replacement anchor (prev close or PDH/PDL midpoint)
STEP 6  → Delete TDO computation loops + all payload emissions (3 files)
STEP 7  → Delete vs_daily_open from pricing_context
STEP 8  → Clean BiasEngine interface ghost field
STEP 9  → UI/Canvas cosmetic cleanup (7 files)
STEP 10 → TypeScript interface cleanup + tsc --noEmit validation pass
STEP 11 → Delete useBacktestEngine-bkup.ts
STEP 12 → Update directive documentation (4 files)
```

### Step-by-Step Details

**STEP 1 — Neutralize Evaluator Cases**
Files: `useStrategyEvaluator.ts`, `quantLabEngine.ts`
Replace `case 'PRICE_VS_OPEN':` block with explicit deprecation warning + passthrough (not silent failure):
```typescript
case 'PRICE_VS_OPEN':
  console.warn('[Deprecated] PRICE_VS_OPEN removed. Migrate to LOCAL_PRICING.');
  return 'UNKNOWN';
```

**STEP 2 — Remove MetricKey + METRICS Entry**
File: `EquationBuilder.tsx` lines 17 and 71.
Run `tsc --noEmit` to catch downstream type errors.

**STEP 3 — Migrate Test JSON Strategies**
```json
// Before:
{"metric": "PRICE_VS_OPEN", "operator": "EQUALS", "value": "ABOVE"}
// After:
{"metric": "LOCAL_PRICING", "operator": "EQUALS", "value": "PREMIUM"}
```

**STEP 4 — Replace Live Alert Gate**
File: `useLiveAlerts.ts`
```typescript
// DELETE: const trueDayOpen = pricingContext.true_day_open_0700 || 0;
// DELETE: if (hasNewBullishFvg && trueDayOpen > 0 && currentPrice > trueDayOpen) {
// ADD:
const dealingStatus = pricingContext?.local_dealing_range?.current_status || 'UNKNOWN';
if (hasNewBullishFvg && dealingStatus === 'PREMIUM') {
```

**STEP 5 — Replace SMT Anchor**
Option A: Use previous 15m candle close as performance baseline.
Option B: Deprecate `calculateRelativeStrength()` entirely, use `m5_divergence`/`m15_divergence` output.

**STEP 6 — Delete TDO Computation Loops**
Remove `for` loops + variable declarations from `route.ts`, `quantLabEngine.ts`, `useBacktestEngine.ts`.
Reduce `btc_15m` API fetch from `limit=150` to `limit=20` in `route.ts`.

**STEP 7 — Delete vs_daily_open**
Remove `vs_daily_open` ternary emission from `pricing_context` in all three files.
Confirmed no downstream consumers read this field.

**STEP 8 — BiasEngine Ghost Field**
Delete `true_day_open_0700?: number | null` from `BiasEngineParams`.
Clean up `useBacktestEngine.ts:384` call site.

**STEP 9 — Canvas Cleanup**
| File | Action |
|---|---|
| `sessionsLayer.ts` | Delete TDO `createPriceLine` block (lines 30–41) |
| `settings/page.tsx` | Delete both TDO ColorPickerItem rows + `dark_chart_tdo`/`light_chart_tdo` from DEFAULT_THEME_SETTINGS |
| `Sidebar.tsx` | Delete "NY Day Open" row |
| `BacktestSidebar.tsx` | Delete "NY Day Open" row |
| `MatrixConfigDrawer.tsx` | Delete `true_day_open?` fields + "True Day Open" display row |
| `quant-sandbox/page.tsx` | Replace with equilibrium price display, delete SVG TDO line |

**STEP 10 — TypeScript Validation**
Run `npx tsc --noEmit` to surface any remaining issues.

**STEP 11 — Delete Backup File**
`git rm src/hooks/useBacktestEngine-bkup.ts`

**STEP 12 — Update Directives**
- `directives/02_lessons.md` — Update Lesson 2 to reflect TDO is removed
- `directives/03_quant_logic.md` — Remove `true_day_open_0700` Macro Baseline reference
- `directives/05_strategy_customizer.md` — Remove `PRICE_VS_OPEN` row from metrics table
- `directives/master_blueprint.md` — Archive TDO under Deprecated Features section

---

*Generated by automated codebase audit — 2026-07-29. Senior Quant Architect role.*
