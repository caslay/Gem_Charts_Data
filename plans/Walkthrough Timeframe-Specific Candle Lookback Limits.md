# Walkthrough: Timeframe-Specific Candle Lookback Limits

We have successfully migrated the single Candle Lookback Limit from the settings page into the **System Command Center** (`SettingsModal.tsx`) under the **Engine Core** tab. We upgraded it to support five independent timeframe-specific lookback limits (`1m`, `5m`, `15m`, `1h`, `4h`) backed by a self-healing database table configuration.

---

## 🛠️ Key Technical Implementations

### 1. Database & APIs (`src/app/api/`)
- **Self-Healing SQL Migration:** Updated the `initTables()` migration inside [route.ts (Settings API)](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/settings/route.ts) to automatically alter the `terminal_settings` table, appending five new integer columns: `candles_limit_1m`, `candles_limit_5m`, `candles_limit_15m`, `candles_limit_1h`, and `candles_limit_4h` default to `1000`.
- **API Payload Integration:** Configured the `GET` settings route to retrieve and package the timeframe limits, and updated the `POST` settings route to parse and upsert them upon debounced client autosave events.
- **Dynamic Binance Fe fetches:** Updated [route.ts (Market Data API)](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/market-data/route.ts) to map these search parameters (`limit1m`, `limit5m`, etc.) into the active parallel request URLs, successfully fetching interval-native candles from Binance.

### 2. React Context & Hooks (`src/hooks/`)
- **EngineSettings Expansion:** Added `candlesLimit1m/5m/15m/1h/4h` to the `EngineSettings` interface and defaults in [useMarketData.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/hooks/useMarketData.ts).
- **Storage Rehydration & Autosave:** Integrated the settings rehydration and PostgreSQL sync hooks to load and save timeframe limit selections to localStorage and the cloud database dynamically.
- **Instant Hot-Swaps:** Upgraded the `fetchData` function dependency signature so that editing a timeframe lookback limit instantly triggers an on-the-fly REST API poll to resize the chart series.

### 3. Settings Modal HUD (`src/components/modals/`)
- **Group D Inputs Card:** Appended a premium glassmorphic grid inside the **Engine Core** panel of [SettingsModal.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/modals/SettingsModal.tsx), offering separate numeric input fields for `1m`, `5m`, `15m`, `1h`, and `4h` limits.
- **Premium Input UX Clamping:** Added an `onChange` parsing check with an `onBlur` clamping check to ensure the user can type free-form numeric edits, and the system smoothly enforces the stable institutional bounds of `[100, 1500]` when focus is lost.

### 4. Legacy settings page cleanups (`src/app/settings/`)
- **Lookback Removal:** Completely removed the obsolete single Candle Lookback Limit input elements, states, validations, and save references from [page.tsx (Settings Page)](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/settings/page.tsx) to prevent redundant database queries or state conflicts.

---

## 🔬 Verification Results

- **Type Safety Check:** Executed TypeScript compiler checks (`npx tsc --noEmit`) which compiled **100% successfully** with zero errors.
- **Autosave Synchronicity:** Local state and Neon PostgreSQL databases synchronize smoothly on timeframe adjustments, dynamically driving market data poll limits.
