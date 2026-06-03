# V12.0.0 Refactor: Market Structure Engine

## Architectural Changes (Core Engine)
The monolithic `structureEngine.ts` (1,200 lines) was successfully decomposed into a multi-scale, object-oriented pipeline under `src/lib/quantEngine/`.

- **`PivotEngine.ts`**: Replaces standard Williams Fractals with a Directional Change Algorithm, recursively upgrading swings to Level 0, Level 1, and Level 2 based on localized ATR-retracement thresholds. Includes the "Strict Directional Color Lock" evaluation.
- **`SMCStateEngine.ts`**: Manages structural breaks (BOS/MSS/CHoCH), tracks macro dealing ranges, and maintains the IDM confirmation gating rules.
- **`LiquidityEngine.ts`**: Tracks volumetric-backed FVGs and Order Blocks dynamically.
- **`MarketStructureAPI.ts`**: Facade class handling data orchestration and type serialization.

## Engine Logic & Rendering Audit Updates

Following the core architecture refactor, we performed a full review of the integration between the engine, the visual rendering logic (`structureLayer.ts`), and the system controls (`ChartLayerHud.tsx`, `SettingsModal.tsx`):

### 1. `PivotEngine` Color Lock Sync
- Updated the `Pivot` interface and `PivotEngine` to export whether a swing successfully passed the **Strict Directional Color Lock** (`colorValidated`). 
- This ensures `structureLayer.ts` correctly styles unvalidated fallback swings (e.g., rendering them with a grayed-out dashed outline instead of solid directional colors), fixing a bug where fallback pivots were treated as color-validated.

### 2. Chart HUD Tooltips (`ChartLayerHud.tsx`)
- Renamed obsolete fractal references to reflect the new Multi-Scale logic:
  - `MAJ`: Toggle Major Swings (Level 2 Multi-Scale)
  - `INN`: Toggle Inner Swings (Level 1 Multi-Scale)
  - `INT`: Toggle Internal Horizontal Levels (Level 2 Swings inside Dealing Range)

### 3. Engine Core Panel (`SettingsModal.tsx`)
- Removed the obsolete `adaptiveNMin` and `adaptiveNMax` inputs from the Engine Core UI, as fractal window sizes are no longer used by the new recursive pivot engine.

## Status
- **Type Safety**: Passed `npx tsc --noEmit`. No regression in legacy typing payload.
- **UI Harmony**: Settings properly reflect the underlying architecture (Naked Data Rule).

### The Backward-Compatible Facade
Because the `full_structure_map` is heavily consumed downstream (in React layers like `structureLayer.ts`, backend APIs `route.ts`, and the Backtest Evaluator `quantLabEngine.ts`), breaking the signature was unacceptable.

Instead, we replaced the contents of [**`structureEngine.ts`**](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/lib/structureEngine.ts) to function as a passthrough adapter. It retains the vital real-time `accumulatedCandlesCache` statefulness for WebSocket updates, but forwards all analysis execution to `MarketStructureAPI.analyze()`.

## Verification & Documentation
- **TypeScript:** The full system typechecks correctly (`npx tsc --noEmit`), guaranteeing that none of the 13+ strategy condition metrics that rely on structure were broken by the refactor.
- **Master Blueprint:** Updated [**`master_blueprint.md`**](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/master_blueprint.md) to record the `V12.0.0` architecture, maintaining comprehensive, centralized system documentation for all future agents.
