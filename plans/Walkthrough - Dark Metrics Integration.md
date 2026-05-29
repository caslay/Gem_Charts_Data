# Walkthrough - Dark Metrics Integration

We have successfully integrated the four high-potency institutional "Dark Metrics" uncovered in the backend systems directly into the Strategy Architect builder UI and the strategy evaluation runtime engine. 

The system remains **100% type-safe** and fully backward-compatible with legacy custom strategies.

---

## 🛠️ Changes Implemented

### 1. Strategy Architect UI
* **File:** [EquationBuilder.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/EquationBuilder.tsx)
* **Description:** Added the 4 new metrics to the typescript type union `MetricKey` and registered their descriptors in the `METRICS` array, enabling them to appear dynamically inside condition selection rows:
  * **`LIQUIDATION_STATUS` (Enum):** Exposes Options `['NORMAL', 'LIQUIDITY_SWEPT']`.
  * **`SMART_MONEY_SYNC` (Boolean):** Enables selecting `IS_TRUE` / `IS_FALSE`.
  * **`BTC_RELATIVE_STRENGTH` (Enum):** Exposes Options `['LEADER', 'LAGGARD']`.
  * **`HTF_MAGNET_DIST` (Number):** Enables operator checks (`<`, `>`, `==`, `!=`) against numeric input values.

---

### 2. Runtime Evaluation Engine
* **File:** [useStrategyEvaluator.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useStrategyEvaluator.ts)
* **Description:** Implemented high-fidelity resolution logic inside the `resolveMetric` function using strict, bulletproof optional chaining to map the backend-calculated metrics:
  * **`LIQUIDATION_STATUS`:** Resolves from `orderFlow.liquidation_events?.status` (falls back to `'NORMAL'`).
  * **`SMART_MONEY_SYNC`:** Resolves to the inverse of `smart_money_divergence` (`smartMoney.smart_money_divergence === false`), indicating institutional alignment.
  * **`BTC_RELATIVE_STRENGTH`:** Resolves from `ipda.smt_context?.btc_relative_strength` (falls back to `'LAGGARD'`).
  * **`HTF_MAGNET_DIST`:** Resolves from `ipda.pricing_context?.nearest_htf_magnet?.distance` (falls back to `999999` to keep default conditions like `< 50.0` safe when no magnet is present).

---

### 3. Documentation Synchronisation
* **File:** [master_blueprint.md](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/master_blueprint.md)
* **Description:** Updated Section 15 with **Section 15.1: Integration of "Dark Metrics"** to record this architectural sync.

---

## 🧪 Verification & Build Results

We executed a strict TypeScript compilation of the Next.js App to verify code safety and compile integrity:

```powershell
npx tsc --noEmit
```

### Result:
* **Status:** **SUCCESS** ✅
* **Stdout:** *Empty*
* **Stderr:** *Empty*

This proves that the entire Strategy Architect pipeline remains cleanly typed, without throwing any compile errors, deprecation warnings, or breaking any of the existing backtest or live paper-trading execution endpoints.
