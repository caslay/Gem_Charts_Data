# Move Project & Revert Accidentally Modified Repository

This plan will recreate the "V6 Multi-Timeframe Market Visualizer & Data Exporter" project inside the correct workspace (`Gem_Charts_Data`) and restore your other `crypto-dashboard` project back to its original state.

## Proposed Changes

### 1. Initialize Project in `Gem_Charts_Data`
- Run `npx create-next-app` in `Gem_Charts_Data` to scaffold a fresh Next.js environment (App Router, Tailwind, TypeScript).
- Install required dependencies: `lightweight-charts` and `lucide-react`.

### 2. Migrate V6 Dashboard Code
- I will transfer the files that were written to `crypto-dashboard` (the naked chart, sidebar, Binance API route, and market data hooks) over to `Gem_Charts_Data/src`.

### 3. Revert `crypto-dashboard` (The "Old Shit")
- Run `git reset --hard 9fb66f1b73dba343cfa94751a0cf878cb97de4d3` in `c:\My Files\Work\Lab\ssp\crypto-dashboard\frontend`. This will reset the repository back to the "Initial commit from Create Next App" state.
- Run `git clean -fd` to remove any untracked files I might have generated.

## User Review Required
> [!IMPORTANT]
> The reset command in `crypto-dashboard` is destructive and will wipe out all changes made *after* your "Initial commit from Create Next App" (commit `9fb66f1b`). This includes the commit you made earlier (`ae98983` - "feat: implement crypto market dashboard..."). Please confirm you are okay with losing all changes in `crypto-dashboard` to fully restore it!

## Verification Plan
- Verify that `npm run dev` in `Gem_Charts_Data` successfully starts the dashboard.
- Verify that `git status` in `crypto-dashboard` shows a clean working tree on the initial commit.
