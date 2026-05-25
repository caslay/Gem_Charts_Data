# Walkthrough - Accurate Position Sizing Math (V8.8)

We have successfully implemented proper institutional position sizing math. If a user risks a specific percentage, that percentage represents the maximum monetary loss if the Stop Loss is hit, NOT the total notional position size.

## Modifications Made

### 1. Server-Side Position Sizing Math
- **File:** [route.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/trades/route.ts#L380-L506)
- **Schema Alteration:** Dynamically checks and alters the `paper_trades` table on load to add the `risk_amount_usd DECIMAL(18, 2)` column if it doesn't already exist.
- **Math Integration:** Computes:
  - `risk_amount_usd = current_balance * (risk_percent / 100)`
  - `sl_distance = Math.abs(entry_price - stop_loss)`
  - **Division by Zero Gate:** Checks `if (sl_distance === 0)` and returns a detailed `400` error response to avoid division issues.
  - `position_size = risk_amount_usd / sl_distance`
- **Database Storage:** Saves both `position_size` and `risk_amount_usd` in the paper trade record.

### 2. Realized P&L and Risk-Based ROI on Close
- **File:** [route.ts](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/app/api/trades/route.ts#L600-L649)
- **P&L Calculation:** Computes realized P&L strictly using the calculated dynamic `position_size` (contracts/coins):
  - LONG: `(exit_price - entry_price) * position_size`
  - SHORT: `(entry_price - exit_price) * position_size`
- **ROI % Calculation:** bases realized ROI on the actual dollar risk taken rather than whole notional sizes:
  - `roi = (realized_pnl / risk_amount_usd) * 100` (features backward-compatible fallback calculations for legacy database rows).

### 3. Brutalist Sizing UI Displays
- **File:** [JournalTable.tsx](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/src/components/JournalTable.tsx)
- **Position Size rendering:** Displays `Size: {position_size} ETH` directly below the Asset symbol for both active and closed positions.
- **Stop Loss Invalidation & Dollar Risk:** Renders a clean `Risk: ${risk_amount_usd}` indicator directly underneath the Stop Loss price column to allow the user to easily verify the position sizing math.
- **Open Trade ROI percentage Alignments:** Modified open position unrealized P&L ROI to calculate based on the actual dollar risk taken, establishing consistent metric auditing across active and closed rows.

### 4. Master Blueprint Documentation Synchronization
- **File:** [master_blueprint.md](file:///c:/My%20Files/Work/Lab/Gem_Charts_Data/directives/master_blueprint.md)
- **Change:** Documented the new V8.8 institutional sizing math specifications, database columns, and ROI formulas in the top changelog section.

---

## Verification Results

### TypeScript Compilation (tsc)
- Executed: `npx tsc --noEmit`
- Result: **SUCCESS** (0 errors).

### Next.js Production Build Validation
- Executed: `npm run build`
- Result: Next.js compiler completed clean Turbopack optimized production compilation with **0 errors**.
