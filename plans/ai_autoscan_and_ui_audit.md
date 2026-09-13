# Architectural Audit & Diagnostic Report: AI Auto-Scan Engine, HUD Timers & Action Deck

**Project:** Quegar Quant Engine (`Gem_Charts_Data`)  
**Current System Version:** `17.40.0` (via `src/lib/version.ts`)  
**Status:** Audit Completed — Source Code Unmodified  
**Target Output:** `/plans/ai_autoscan_and_ui_audit.md`  

---

## Executive Summary

Following the upgrade of the Quant Intelligence layer to a resilient Multi-Model AI Cascade (`runAiCascadeEvaluation` with automatic failover between Apex Flash and High-Quota Lite models, backed by PostgreSQL telemetry logging and historical inspection via `ai_analysis_log`), this audit investigates the client-side HUD control deck, timer cadences, action buttons, legacy debt, and the feasibility of a dynamic dual-cadence "Turbo Mode".

### Key Findings
1. **Hardcoded 30-Minute Cadence:** The "30m Auto-Scan" timer is driven purely client-side by an unconfigured, hardcoded `1800 * 1000` ms interval across three separate locations in `src/hooks/useMarketData.ts`. It has zero binding to backend system/terminal settings, and the toggle is stored in browser `localStorage['gem_auto_30m_scan']`.
2. **HUD Buttons & Cascade Routing:**
   - **`SYNTHESIZE LIVE DATA`**: Successfully routes through the new multi-model cascade engine via `POST /api/quant-analyze`, pruning OHLCV focus windows to the last 30 candles per timeframe and updating telemetry, bias, and HUD diagnostics. A duplicate button exists in `HudModal.tsx`.
   - **`CORRECT`**: Triggers `SelfCorrectionModal.tsx` which updates `directives/ETHUSDC_Daily_Tracker.json` / `.md` and attempts to persist lessons into PostgreSQL table `ai_trade_state` (`id = 1`). **CRITICAL FLAW DETECTED:** When subsequent AI scans complete, `aiCascadeEngine.ts` overwrites `ai_trade_state.state_json` with `next_database_state`, completely wiping out the `recent_mistakes_lessons` array recorded by the trader.
   - **`TRADES`**: Opens `PotentialTradesModal.tsx`, which synthesizes the active AI SOP setup (`AI-SOP-01`) alongside rule-based setups. It dispatches trade executions to `POST /api/trades`, synchronizing with `JournalTable.tsx` via `trades-refresh` events.
   - **`HISTORY`**: Opens `AiAnalysisHistoryModal.tsx`, querying `GET /api/quant-analyze?limit=50`. However, the `onApplyAnalysis` callback passed from `Sidebar.tsx` is completely unused inside the modal, preventing users from restoring historical setups into the active HUD.
3. **Dead Code & State Debt:**
   - `src/lib/aiSystemPrompt.ts` is 100% unreferenced dead code; the active prompt is `DEFAULT_ETH_SOP_SYSTEM_PROMPT` in `src/lib/sopPromptBuilder.ts`.
   - `src/app/api/quant-analyze/history/route.ts` is a redundant orphan route duplicating `GET /api/quant-analyze`.
   - `src/hooks/useAutoTradeExecutor.ts` omits `aiAnalysis` when invoking `generatePotentialTrades`, meaning background trade execution completely ignores the `AI-SOP-01` setup.
   - Version drift: `package.json` is at `"17.28.0"` while `src/lib/version.ts` is at `"17.40.0"`. `src/app/api/agent/context/route.ts` contains legacy comments referencing `V15.3`.
   - `src/lib/quantTradeEngine.ts:960` retains a hardcoded fallback string `"Gemini 3.6 Flash Quant SOP Analysis"`.
4. **Turbo Mode Feasibility:** Highly feasible with zero breaking changes. By measuring WebSocket `livePrice` against the active setup's `entry_range_low` and `entry_range_high`, the client scheduler can dynamically shift between a user-configured Base Scan Interval (15m or 30m) and an accelerated 5m Turbo Mode while within the POI, guarded by rate-limit throttling and invalidation checks.

---

## 1. Inventory of Relevant Files & Components

| File Path | Role & Architectural Function |
| :--- | :--- |
| [`src/lib/version.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/version.ts#L1) | Single source of truth for `SYSTEM_VERSION = "17.40.0"`. |
| [`package.json`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/package.json#L3) | Contains drifted version tag (`17.28.0`). |
| [`src/hooks/useMarketData.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useMarketData.ts#L1319-L1365) | Root market data and timer orchestration. Hardcodes 1800s interval, stores `isAuto30mScanActive`, and manages 5s polling loop. |
| [`src/hooks/useAIAnalysis.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useAIAnalysis.ts#L1-L141) | AI request dispatcher. Prunes OHLCV candles, sends POST to `/api/quant-analyze`, parses bias/telemetry, and hydrates historical logs. |
| [`src/components/Sidebar.tsx`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/Sidebar.tsx#L263-L312) | Renders `AutoScanCountdown`, action deck (`SYNTHESIZE LIVE DATA`, `TRADES`, `HISTORY`, `CORRECT`), version footer, and HUD telemetry. |
| [`src/components/modals/HudModal.tsx`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/HudModal.tsx#L1-L294) | Full-screen brutalist HUD console displaying parsed AI diagnostics, narrative, telemetry, and duplicate synthesis trigger. |
| [`src/components/modals/PotentialTradesModal.tsx`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/PotentialTradesModal.tsx#L1-L250) | Trade execution hub. Synthesizes `AI-SOP-01` setup, manages auto-execution flags, and posts executed trades to `/api/trades`. |
| [`src/components/modals/AiAnalysisHistoryModal.tsx`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/AiAnalysisHistoryModal.tsx#L1-L100) | Historical cascade inspection modal. Displays runs from `ai_analysis_log`, but fails to wire up `onApplyAnalysis`. |
| [`src/components/modals/SelfCorrectionModal.tsx`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/SelfCorrectionModal.tsx#L1-L100) | Post-mortem input dialog for logging trade mistakes and lessons to the daily tracker and database memory bank. |
| [`src/app/api/quant-analyze/route.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/quant-analyze/route.ts#L1-L185) | Primary AI evaluation endpoint. Reads settings from DB, checks invalidation against `ai_trade_state`, and runs `runAiCascadeEvaluation`. |
| [`src/lib/aiCascadeEngine.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/aiCascadeEngine.ts#L1-L579) | Multi-model cascade execution engine, failover router (429/503 handling), telemetry builder, and PostgreSQL logger. |
| [`src/lib/quantTradeEngine.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantTradeEngine.ts#L940-L990) | Generates potential trades, parses `aiAnalysis` to produce `AI-SOP-01`, and manages `localStorage['gem_quant_setup_history']`. |
| [`src/hooks/useAutoTradeExecutor.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useAutoTradeExecutor.ts#L1-L45) | Background auto-trade evaluator. Fails to pass `aiAnalysis` to `generatePotentialTrades`. |
| [`src/app/api/self-correction/route.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/self-correction/route.ts#L1-L148) | Backend handler for self-correction. Writes to `ETHUSDC_Daily_Tracker.json`/`.md` and `ai_trade_state.recent_mistakes_lessons`. |
| [`src/lib/aiSystemPrompt.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/aiSystemPrompt.ts#L1-L88) | **DEAD CODE:** Unused legacy prompt file containing `QUANT_SYSTEM_PROMPT`. |
| [`src/lib/sopPromptBuilder.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/sopPromptBuilder.ts#L1-L98) | Canonical system prompt exporting `DEFAULT_ETH_SOP_SYSTEM_PROMPT`. |
| [`src/app/api/quant-analyze/history/route.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/quant-analyze/history/route.ts#L1-L36) | **REDUNDANT ROUTE:** Unused GET endpoint duplicating `GET /api/quant-analyze`. |
| [`src/app/settings/page.tsx`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/settings/page.tsx#L40-L100) | Command Center settings portal managing `GEMINI_LIVE_KEY`, `ACTIVE_MODEL`, and `SYSTEM_PROMPT`. |

---

## 2. Deep Dive: Auto-Scan Timer & Cadence Engine

### 2.1 State, Intervals & Background Workers
The auto-scan countdown is orchestrated in [`src/hooks/useMarketData.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useMarketData.ts#L1319-L1365):

```typescript
// src/hooks/useMarketData.ts:1320-1322
const [isAuto30mScanActive, setIsAuto30mScanActive] = useState<boolean>(true);
const [nextScanTimestamp, setNextScanTimestamp] = useState<number>(() => Date.now() + 1800 * 1000);
const nextScanTimestampRef = useRef<number>(Date.now() + 1800 * 1000);
```

1. **Storage Persistence:** On client mount, `isAuto30mScanActive` reads from `localStorage.getItem('gem_auto_30m_scan')` ([line 1327](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useMarketData.ts#L1327)). When toggled via `toggleAuto30mScan`, it writes back to `'gem_auto_30m_scan'` ([line 1340](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useMarketData.ts#L1340)).
2. **Background Polling Worker:**
   ```typescript
   // src/hooks/useMarketData.ts:1354-1364
   useEffect(() => {
     if (!isAuto30mScanActive) return;

     const timer = setInterval(() => {
       if (Date.now() >= nextScanTimestampRef.current) {
         triggerAiAnalysisScan();
       }
     }, 5000);

     return () => clearInterval(timer);
   }, [isAuto30mScanActive, triggerAiAnalysisScan]);
   ```
   A silent 5-second `setInterval` polls `nextScanTimestampRef.current`. When elapsed, it dispatches `triggerAiAnalysisScan()`.
3. **Client-Side Countdown Leaf Component:**
   In [`src/components/Sidebar.tsx`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/Sidebar.tsx#L264-L312), `AutoScanCountdown` uses an isolated 1-second `setInterval` to compute `remainingSec = Math.max(0, Math.floor((nextScanTimestamp - Date.now()) / 1000))` without triggering global React re-renders across parent components.
   - Line 293 hardcodes the label: `<span className="text-muted font-bold">30m Auto-Scan:</span>`.

### 2.2 Trigger Mechanism & Network Flow
- The timer **does not poll a background daemon**. The entire trigger pipeline is client-side.
- When the 5-second interval expires (or the user clicks "Synthesize Live Data"):
  1. `triggerAiAnalysisScan` ([`useMarketData.ts:1346`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useMarketData.ts#L1346)) advances `nextScanTimestamp` and `nextScanTimestampRef.current` by `+1800 * 1000` ms.
  2. It invokes `triggerScan(data, alertMetadata)` in [`useAIAnalysis.ts:74`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useAIAnalysis.ts#L74).
  3. `useAIAnalysis.ts` prunes historical candles to the last 30 bars (4h, 1h, 15m, 5m) to prevent LLM context saturation and sends an HTTP `POST` to `/api/quant-analyze`.
  4. `/api/quant-analyze` executes `runAiCascadeEvaluation` on the server, logs telemetry to PostgreSQL, updates `ai_trade_state`, and returns structured JSON.
  5. The client hook updates `aiAnalysis`, parses `aiBias`, stores `aiTelemetry`, and calls `fetchAiHistory({ limit: 20 })`.

### 2.3 Settings Influence Assessment
- **Current Settings Influence:** **0% (Completely Unconnected)**.
- Neither `system_settings` (PostgreSQL), `terminal_settings` (PostgreSQL), nor `DEFAULT_ENGINE_SETTINGS` (`src/hooks/useMarketData.ts:358`) contain any parameter for scan frequency or auto-scan interval.
- The 30m value is hardcoded as `1800 * 1000` ms in three explicit locations (`useMarketData.ts:1321`, `1322`, `1347`).

---

## 3. HUD Action Button & State Wiring

### 3.1 `SYNTHESIZE LIVE DATA` Flow
- **Location:** [`src/components/Sidebar.tsx:1381-1397`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/Sidebar.tsx#L1381-L1397) and [`src/components/modals/HudModal.tsx:229-245, 268-284`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/HudModal.tsx#L229-L245).
- **Handler:** `handleLiveSynthesis` -> `triggerAiAnalysisScan()` -> `useAIAnalysis.triggerAiAnalysisScan()`.
- **Backend Routing:** It **does route through the new multi-model cascade engine**.
  - Endpoint: `POST /api/quant-analyze`.
  - Backend Handler: [`src/app/api/quant-analyze/route.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/quant-analyze/route.ts#L15-L122) calls `runAiCascadeEvaluation()` ([`src/lib/aiCascadeEngine.ts:187`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/aiCascadeEngine.ts#L187)).
  - Model Selection: Resolves `ACTIVE_MODEL` from `system_settings` (defaults to `gemini-2.5-flash`). If 429 quota exhaustion or 503 errors occur, it cascades automatically to `gemini-2.5-flash-lite` or `gemini-1.5-flash-8b`.
  - Invalidation Guard: Evaluates live candle close against `ai_trade_state.invalidation_level` before running the cascade ([`route.ts:65-92`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/quant-analyze/route.ts#L65-L92)).
- **UI State Update:** On successful response:
  - Sidebar HUD displays live telemetry bar: Model name, execution latency (`ms`), fallback status badge (`DIRECT` vs `⚡ FALLBACK`), and HUD metrics table ([`Sidebar.tsx:1255-1359`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/Sidebar.tsx#L1255-L1359)).
  - Next scan timestamp resets to `Date.now() + 1800 * 1000`.

### 3.2 `CORRECT` Button: Purpose & Fatal Memory Erasure Bug
- **Location:** [`src/components/Sidebar.tsx:1417-1423`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/Sidebar.tsx#L1417-L1423).
- **Intended Purpose:** Allows the trader to perform post-trade self-correction and institutional review.
- **Workflow:**
  1. Opens [`SelfCorrectionModal.tsx`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/SelfCorrectionModal.tsx#L40).
  2. Fetches setup records from `/directives/ETHUSDC_Daily_Tracker.json`.
  3. Trader selects a setup, records outcome (`SUCCESS`, `STOP_OUT`, `NO_TRIGGER`, `WRONG_BIAS`), assigns an error category (`EARLY_ENTRY`, `SMT_FAKEOUT`, etc.), and writes lessons learned.
  4. Submits `POST /api/self-correction`.
  5. [`src/app/api/self-correction/route.ts:101-132`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/self-correction/route.ts#L101-L132) updates `ETHUSDC_Daily_Tracker.json` / `.md` and prepends the lesson into `ai_trade_state.recent_mistakes_lessons` (keeping the last 20 entries).
- **🚨 CRITICAL ARCHITECTURAL BUG (State Debt / Memory Erasure):**
  In [`src/lib/aiCascadeEngine.ts:435-443`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/aiCascadeEngine.ts#L435-L443):
  ```typescript
  // src/lib/aiCascadeEngine.ts:435-443
  const nextState = parsedResponse?.next_database_state;
  if (nextState && typeof nextState === 'object') {
    await sql`
      UPDATE ai_trade_state
      SET state_json = ${JSON.stringify(nextState)}, updated_at = NOW()
      WHERE id = 1
    `;
  }
  ```
  The AI's JSON schema outputs `next_database_state` (`{ status, trade_direction, invalidation_level, target_level, active_setup_id, notes }`). When the cascade engine persists `next_database_state`, it **completely overwrites** `state_json`. It does **not** merge with existing state, completely erasing `recent_mistakes_lessons`!
  On the subsequent scan, the prompt's `=== [HISTORICAL MEMORY (CURRENT STATE)] ===` block has lost all previous self-correction lessons.

### 3.3 `TRADES` & `HISTORY` Coordination
- **`TRADES` Button:** Opens [`PotentialTradesModal.tsx`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/PotentialTradesModal.tsx#L38).
  - Consumes `aiAnalysis` from `useMarketDataContext()`.
  - If `aiAnalysis` contains `sop_report`, [`quantTradeEngine.ts:941-986`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/quantTradeEngine.ts#L941-L986) pins an `AI-SOP-01` setup card to the top of the deck.
  - Traders can toggle auto-execution (`gem_quant_auto_execute_keys`), log setups to the SOP tracker (`POST /api/log-sop-tracker`), or execute manually (`POST /api/trades`).
  - Executing a trade dispatches `window.dispatchEvent(new Event("trades-refresh"))`, updating active trade ledgers in `JournalTable.tsx`.
- **`HISTORY` Button:** Opens [`AiAnalysisHistoryModal.tsx`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/AiAnalysisHistoryModal.tsx#L33).
  - Fetches up to 50 historical runs from PostgreSQL (`GET /api/quant-analyze?limit=50`).
  - Allows forensic inspection of model name, latency, fallback status, raw response, and SOP parameters.
- **Coordination Breakdown:**
  1. In `Sidebar.tsx:1563-1585`, an `onApplyAnalysis` callback is passed to `AiAnalysisHistoryModal`. However, inside `AiAnalysisHistoryModal.tsx`, **`onApplyAnalysis` is never called by any button or click handler**. Users cannot restore a previous historical analysis to the HUD.
  2. In `Sidebar.tsx:1564`, the uninvoked callback passes `setAiAnalysis(record.narrative)`. Because `record.narrative` is plain text rather than the JSON string in `record.raw_response`, passing it to `safeParseAiJson` would fail, corrupting the HUD diagnostics table.
  3. In [`src/hooks/useAutoTradeExecutor.ts:30`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useAutoTradeExecutor.ts#L30), the background executor calls `generatePotentialTrades(data, isBacktest)` without passing `aiAnalysis`. Consequently, the background trader cannot auto-execute the `AI-SOP-01` setup.

### 3.4 Version Watermark
- **Location:** [`src/components/Sidebar.tsx:1435`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/Sidebar.tsx#L1435):
  ```tsx
  <span className="text-[8px] font-black text-muted-foreground tracking-widest uppercase">
    Quegar Core V{SYSTEM_VERSION}
  </span>
  ```
- **Source:** Dynamically imported from [`src/lib/version.ts:1`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/version.ts#L1) (`export const SYSTEM_VERSION = "17.40.0";`).
- **Discrepancies:**
  - `package.json:3` lists `"version": "17.28.0"`.
  - `src/app/api/agent/context/route.ts:3,26` lists `@version 2.0.0 — Quegar Core Engine V15.3`.
  - `directives/master_blueprint.md` notes previous version milestones (e.g., V12, V14, V15.3, V17.28).

---

## 4. Lingering Legacy Setups & State Debt

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 STATE DEBT MATRIX                                      │
├──────────────────────────────┬───────────────────────────────┬─────────────────────────┤
│ Artifact / Component         │ Current Behavior              │ Issue / Conflict        │
├──────────────────────────────┼───────────────────────────────┼─────────────────────────┤
│ src/lib/aiSystemPrompt.ts    │ Exports QUANT_SYSTEM_PROMPT   │ 100% Dead Code; unused. │
│                              │                               │ Canonical prompt is in  │
│                              │                               │ sopPromptBuilder.ts.    │
├──────────────────────────────┼───────────────────────────────┼─────────────────────────┤
│ /api/quant-analyze/history   │ GET handler returning history │ Duplicate endpoint. All │
│                              │ from aiCascadeEngine.ts       │ clients call GET        │
│                              │                               │ /api/quant-analyze.     │
├──────────────────────────────┼───────────────────────────────┼─────────────────────────┤
│ ai_trade_state (DB)          │ Overwritten by AI response    │ Overwriting state_json  │
│                              │ next_database_state           │ erases lessons from     │
│                              │                               │ SelfCorrectionModal.    │
├──────────────────────────────┼───────────────────────────────┼─────────────────────────┤
│ gem_auto_30m_scan            │ localStorage key storing      │ Rigidly hardcodes 30m   │
│                              │ boolean toggle                │ cadence into key name.  │
├──────────────────────────────┼───────────────────────────────┼─────────────────────────┤
│ Sidebar.tsx Multi-Schema     │ Handles hud_display (V7),     │ Technical debt. Legacy  │
│                              │ diagnostics (V10), and        │ schemas should be       │
│                              │ sop_report (V14+)             │ normalized.             │
├──────────────────────────────┼───────────────────────────────┼─────────────────────────┤
│ quantTradeEngine.ts:960      │ Fallback trigger: "Gemini 3.6 │ Hardcodes deprecated    │
│                              │ Flash Quant SOP Analysis"     │ single-model reference. │
├──────────────────────────────┼───────────────────────────────┼─────────────────────────┤
│ useAutoTradeExecutor.ts:30   │ generatePotentialTrades(data) │ Missing aiAnalysis      │
│                              │                               │ argument; AI-SOP-01 is  │
│                              │                               │ never auto-executed.    │
├──────────────────────────────┼───────────────────────────────┼─────────────────────────┤
│ AiAnalysisHistoryModal.tsx   │ Receives onApplyAnalysis      │ Prop is uncalled; users │
│                              │                               │ cannot apply history.   │
└──────────────────────────────┴───────────────────────────────┴─────────────────────────┘
```

---

## 5. Architectural Recommendation: Settings-Configurable Interval & 5m In-Zone "Turbo Mode"

### 5.1 System Concept & Operating Modes
Currently, market scans occur every 30 minutes regardless of price action. In reality, when price is trading in a macro equilibrium dead-zone, 30m or 15m scanning preserves AI API quota. However, when price enters an institutional Point of Interest (POI) or active setup Entry Zone (`entry_range_low` to `entry_range_high`), market structure and order flow shift rapidly. A 30-minute lag causes missed entries or unconfirmed fakeouts.

We propose a **Dual-Cadence Architecture**:
1. **Base Cadence (Standard Mode):** User-configurable interval (15m or 30m, default 30m).
2. **Turbo Cadence (In-Zone Mode):** Automatically accelerates to **5-minute intervals** whenever live price penetrates the active setup's Entry Zone / POI.
3. **Automatic Relaxation:** Automatically reverts to Base Cadence when price leaves the Entry Zone, invalidates, or achieves target objectives.

```
                           [ Live WebSocket Price Tick ]
                                         │
                                         ▼
                     ┌──────────────────────────────────────┐
                     │  Active Setup in ai_trade_state or   │
                     │          Current aiAnalysis?         │
                     └───────────────────┬──────────────────┘
                                         │
                         YES ────────────┴──────────── NO
                          │                             │
                          ▼                             ▼
           ┌─────────────────────────────┐    ┌───────────────────┐
           │ Is Live Price inside Entry  │    │   Base Cadence    │
           │ Range [Low, High] ± Buffer? │    │     (15m/30m)     │
           └──────────────┬──────────────┘    └───────────────────┘
                          │
                  YES ────┴──── NO / INVALIDATED
                   │            │
                   ▼            ▼
         ┌──────────────────┐ ┌───────────────────┐
         │ ⚡ Turbo Cadence  │ │   Base Cadence    │
         │     (5-Minute)   │ │     (15m/30m)     │
         └──────────────────┘ └───────────────────┘
```

---

### 5.2 Technical Proposal & Implementation Architecture

#### Step 1: Database & Settings Store Updates
1. Extend `EngineSettings` in [`src/hooks/useMarketData.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useMarketData.ts#L340-L382):
   ```typescript
   export interface EngineSettings {
     // ... existing properties
     autoScanBaseIntervalMinutes: 15 | 30; // default 30
     autoScanTurboEnabled: boolean;        // default true
   }
   ```
2. In `terminal_settings` (Neon PostgreSQL), add columns:
   ```sql
   ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS auto_scan_base_interval INTEGER DEFAULT 30;
   ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS auto_scan_turbo_enabled BOOLEAN DEFAULT true;
   ```
3. In [`src/app/settings/page.tsx`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/settings/page.tsx) under the `[ 01 / QUANT AI ]` tab, add:
   - **Base Scan Frequency Dropdown:** Options: `15 Minutes` or `30 Minutes (Default)`.
   - **Entry-Zone Turbo Mode Toggle:** `Enable 5m In-Zone Acceleration (Recommended)`.

#### Step 2: Fix DB Memory Bank State Erasure
In [`src/lib/aiCascadeEngine.ts:435-443`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/aiCascadeEngine.ts#L435-L443), replace destructive state replacement with state merging:
```typescript
// Proposed Fix in aiCascadeEngine.ts
const nextState = parsedResponse?.next_database_state;
if (nextState && typeof nextState === 'object') {
  // Merge nextState on top of historicalState to preserve recent_mistakes_lessons
  const mergedState = {
    ...historicalState,
    ...nextState,
    recent_mistakes_lessons: Array.isArray(historicalState?.recent_mistakes_lessons)
      ? historicalState.recent_mistakes_lessons
      : [],
    updated_at: new Date().toISOString(),
  };

  await sql`
    INSERT INTO ai_trade_state (id, state_json, updated_at)
    VALUES (1, ${JSON.stringify(mergedState)}, NOW())
    ON CONFLICT (id) DO UPDATE
    SET state_json = ${JSON.stringify(mergedState)}, updated_at = NOW()
  `;
}
```

#### Step 3: Refactor the Cadence Scheduler in `useMarketData.ts`
Replace rigid 30m logic in [`src/hooks/useMarketData.ts`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useMarketData.ts#L1320-L1365) with dynamic interval resolution:

```typescript
// Proposed Dynamic Cadence Engine
const baseIntervalMin = engineSettings.autoScanBaseIntervalMinutes || 30;
const isTurboEnabled = engineSettings.autoScanTurboEnabled ?? true;

// Extract active setup boundaries from parsed AI analysis or latest telemetry
const activeSetup = useMemo(() => {
  if (!aiAnalysis) return null;
  const parsed = safeParseAiJson(aiAnalysis);
  const rp = parsed?.sop_report?.risk_parameters;
  const nextSt = parsed?.next_database_state;

  const low = Array.isArray(rp?.entry_range) && rp.entry_range.length >= 2
    ? Number(rp.entry_range[0])
    : nextSt?.entry_range_low ? Number(nextSt.entry_range_low) : null;
  const high = Array.isArray(rp?.entry_range) && rp.entry_range.length >= 2
    ? Number(rp.entry_range[1])
    : nextSt?.entry_range_high ? Number(nextSt.entry_range_high) : null;
  const invalidation = rp?.invalidation ?? nextSt?.invalidation_level ?? null;
  const direction = parsed?.bias_label ?? nextSt?.trade_direction ?? null;

  return { low, high, invalidation, direction };
}, [aiAnalysis]);

// Detect POI Entry Zone Penetration
const isInPoiZone = useMemo(() => {
  if (!isTurboEnabled || !activeSetup || !livePrice || !activeSetup.low || !activeSetup.high) {
    return false;
  }
  // Check if price is within [low, high] with a slight 0.05% tolerance buffer
  const buffer = activeSetup.low * 0.0005;
  const inRange = livePrice >= (activeSetup.low - buffer) && livePrice <= (activeSetup.high + buffer);
  
  // Check invalidation
  if (activeSetup.invalidation != null) {
    if (activeSetup.direction === 'BULLISH' && livePrice <= activeSetup.invalidation) return false;
    if (activeSetup.direction === 'BEARISH' && livePrice >= activeSetup.invalidation) return false;
  }
  return inRange;
}, [isTurboEnabled, activeSetup, livePrice]);

// Dynamic Interval Duration
const currentCadenceMinutes = isInPoiZone ? 5 : baseIntervalMin;
const currentCadenceMs = currentCadenceMinutes * 60 * 1000;

// Dynamic Clamp: When transitioning into Turbo, clamp remaining time to max 5 minutes
useEffect(() => {
  if (isInPoiZone) {
    const maxTurboTarget = Date.now() + 5 * 60 * 1000;
    if (nextScanTimestampRef.current > maxTurboTarget) {
      nextScanTimestampRef.current = maxTurboTarget;
      setNextScanTimestamp(maxTurboTarget);
    }
  }
}, [isInPoiZone]);
```

#### Step 4: Refactor HUD Control Deck (`Sidebar.tsx`)
1. **Update Leaf Component:** Rename `AutoScanCountdown` props to support dynamic cadences:
   ```typescript
   interface AutoScanCountdownProps {
     nextScanTimestamp: number;
     isAutoScanActive: boolean;
     isTurboActive: boolean;
     baseIntervalMinutes: number;
     onToggle: () => void;
   }
   ```
2. **Dynamic Badging & Visual Styling:**
   - **Standard Mode:** Renders `Clock` icon with label `30m Auto-Scan:` (or `15m Auto-Scan:`).
   - **Turbo Mode:** Renders glowing `Zap` icon in neon amber/accent with label:
     ```tsx
     <div className="flex items-center gap-1.5 animate-pulse text-amber-400">
       <Zap size={11} fill="currentColor" />
       <span className="font-extrabold uppercase tracking-wider">5m TURBO (POI):</span>
       <span className="font-mono font-black">{mins}:{secs}</span>
     </div>
     ```
3. **Wire up `onApplyAnalysis` in `AiAnalysisHistoryModal.tsx`:**
   - Add a button in the history modal details panel: `[ ⚡ Load into Active HUD ]`.
   - On click, invoke `onApplyAnalysis(selectedRecord)`.
   - Pass `record.raw_response || record.narrative` to `setAiAnalysis`, ensuring full JSON structure is preserved for `safeParseAiJson`.
4. **Connect `useAutoTradeExecutor.ts`:**
   - Pass `aiAnalysis` into `generatePotentialTrades(data, isBacktest, aiAnalysis)` in [`useAutoTradeExecutor.ts:30`](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useAutoTradeExecutor.ts#L30) to allow automated monitoring of `AI-SOP-01`.

#### Step 5: Quota & Rate Limit Protection Safeguards
- **Minimum Scan Debounce:** Enforce a hard 180-second (3m) cool-down window so rapid price fluctuations around POI edges cannot trigger back-to-back AI API requests.
- **Max Consecutive Turbo Scans:** Cap consecutive 5m turbo scans to 4 iterations (20 minutes). If price hovers in the zone for >20 minutes without executing or invalidating, relax cadence to 15m until manual intervention.
- **Cascade Fallback Buffer:** If Turbo Mode triggers a 429 quota exhaustion, `aiCascadeEngine.ts` automatically cascades into `gemini-2.5-flash-lite` (500 RPD) while notifying the HUD with the `FALLBACK` badge.

---

## 6. Remaining Questions & Gaps

1. **Telegram Notification Alignment:** Should Turbo Mode scan completions send push notifications to Telegram, or should Telegram alerts remain throttled to major structural events and actual trade entries?
2. **Backtest Replay Parity:** In Market Replay / Backtest mode, should the 5m Turbo Mode trigger during historical replay stepping, or should backtesting rely solely on bar-by-bar candle close evaluation?
3. **Multi-Asset Scope:** While ETHUSDC is currently the primary focus asset, will BTCUSDC or SOLUSDC require independent cadence timers when multi-chart layouts are loaded?
4. **Recommended Next Step for Implementer:** Prioritize fixing the memory bank state erasure in `aiCascadeEngine.ts` and wiring `onApplyAnalysis` before deploying the dynamic Turbo timer.
