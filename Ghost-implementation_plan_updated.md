# Start-Date Drift Elimination — The Midnight State Ledger

## Goal
Implement the "Midnight State Ledger" (Database Snapshot) & T-Zero Re-hydration Engine.
Eliminate start-date backtest drift and ensure 100% mathematical parity between Quant Lab backtests and Live Execution by saving daily midnight snapshots of the structural state machine into Neon PostgreSQL.

## Architectural Directives

### 1. Database Schema (The Midnight Ledger)
- **Table:** `daily_structural_snapshots` in Neon SQL.
- **Columns:** `symbol`, `timeframe`, `snapshot_date` (UTC 00:00), `state_json` (serialized state: trend bias, major pivots, dealing range boundaries, unmitigated FVGs), `updated_at`.
- **Indexes:** `symbol`, `timeframe`, `snapshot_date`.

### 2. T-Zero State Re-hydration (The Read Path)
- Update quantitative engine initialization.
- Query `daily_structural_snapshots` for the `start_date` at 00:00 UTC.
- If found, deserialize `state_json` and inject into `SMCStateEngine`, `PivotEngine`, and `LiquidityEngine`.

### 3. The Flush & Sync Utility (The Write Path)
- **API Route:** `POST /api/quant-lab/ledger-sync`
- **Mode 1: Daily Append:** Runs daily at 00:00 UTC, captures current state, saves snapshot.
- **Mode 2: Global Flush & Rebuild:** Drops existing records, fetches history from Epoch, runs engine, generates midnight snapshots for every day.

### 4. Fallback & Graceful Degradation
- If snapshot is missing (intra-day start or pre-Epoch), gracefully fall back to a localized dynamic warmup buffer (e.g., `lookbackMajor * 3` candles).

### 5. Verification
- 100% TypeScript type safety for serialized `state_json`.
- Do not mutate or break Live HUD WebSocket ingestion pipelines.
- Verify with `npx tsc --noEmit`.

## Execution Steps
1. **Types:** Define `StructuralStateSnapshot`, `MidnightLedgerRecord` in `types.ts`.
2. **State Machines:** Implement `captureSnapshot` and `restoreFromSnapshot` in `SMCStateEngine`, `PivotEngine`, `LiquidityEngine`, and `MarketStructureAPI`.
3. **Database & Bootstrap Utility:** Create `structuralBootstrap.ts` to query Neon SQL for snapshots and handle the fallback warmup logic.
4. **Write Path:** Implement `/api/quant-lab/ledger-sync/route.ts`.
5. **Read Path Integration:** Update `ob-scanner`, `sweep-reclaim-scanner`, and `run` API routes to use the bootstrap utility.
6. **Compile Check:** Run `npx tsc --noEmit`.
