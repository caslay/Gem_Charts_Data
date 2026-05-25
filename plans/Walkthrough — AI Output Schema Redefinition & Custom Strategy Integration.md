# Walkthrough — AI Output Schema Redefinition & Custom Strategy Integration

We have successfully redefined the AI Analyst into a "Bias-only" microservice. The AI response is now fully integrated into the global `MarketDataContext` and is usable as a logical variable in the Custom Strategy Builder!

---

## Changes Implemented

### 1. ⚙️ Redefined the System Prompt & Database Seeding
- Updated the base system prompt reference in [aiSystemPrompt.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/aiSystemPrompt.ts) to define a strict JSON schema:
  ```json
  {
    "bias_signal": 1,
    "bias_label": "BULLISH",
    "primary_target": 2145.50,
    "narrative": "Price is respecting True Day Open with an unmitigated BSL magnet at 2145.50.",
    "narrative_summary": "Price is respecting True Day Open with an unmitigated BSL magnet at 2145.50."
  }
  ```
- Created and executed a database migration script [update_db_prompt.js](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/scratch/update_db_prompt.js) that immediately updated the `SYSTEM_PROMPT` key in the database `system_settings` Neon table.

### 2. ⚡ Global Context Hook Mappings (`useMarketData` & `MarketDataContext`)
- Added `aiBias` state (`number | null`) in [useMarketData.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useMarketData.ts).
- Integrated robust parsing to extract the dynamic `bias_signal` from the AI's returned JSON block.
- Shared `aiBias` globally in [MarketDataContext.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/context/MarketDataContext.tsx), ensuring all quant hooks and child views have access.

### 3. 🎯 Strategy Architect Variable (`EquationBuilder.tsx`)
- Registered `"AI_DAILY_BIAS"` as a new enum-type metric option inside [EquationBuilder.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/EquationBuilder.tsx).
- Restricted its allowed operator to `EQUALS` and options to `["BULLISH", "BEARISH", "NEUTRAL"]`.

### 4. 📈 Directional Strategy Evaluator Engine (`useStrategyEvaluator.ts`)
- Destructured `aiBias` from `useMarketDataContext()` in [useStrategyEvaluator.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useStrategyEvaluator.ts).
- Passed `aiBias` into strategy evaluation routines, and handled the `'AI_DAILY_BIAS'` case mapping numeric states to strings (`BULLISH` for `1`, `BEARISH` for `-1`, `NEUTRAL` for `0`), allowing equations to evaluate `ai_bias === 1` correctly.

### 5. 🖥️ HUD Console Schema Compatibility (`Sidebar.tsx`)
- Upgraded the parsing blocks inside [Sidebar.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/Sidebar.tsx) to natively detect the new V8.3 Bias-only JSON schema structure and automatically map the fields:
  - `bias_signal`, `bias_label`, and `primary_target` populate `hudData`.
  - `narrative_summary` / `narrative` populate `aiNote`.

---

## Verification & Build Soundness

We executed a full production compilation build:
```bash
npm run build
```
- **Result:** **Successfully compiled in `3.3s`!**
- **TypeScript:** Checked and passed in `3.5s` with **zero compiler warnings or type mismatch errors**!
- All Next.js pages and API route handlers generated successfully.

### How it Operates:
1. **User triggers scan:** Pings `/api/quant-analyze`, executing Gemini.
2. **AI returns new structure:** Evaluates market conditions and outputs the defined bias-only JSON.
3. **Frontend receives and parses:**
   - Populates the HUD display columns and Narrative note on the right sidebar.
   - Dynamically sets `aiBias` state.
4. **Strategy evaluator monitors tick:** If a custom strategy includes `AI Daily Bias == BULLISH`, the evaluator evaluates it dynamically against the active `aiBias` context value, authorising automated paper trade journals instantly when matching.
