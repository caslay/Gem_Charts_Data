# Walkthrough — Realized P&L Persistence & Strategy-specific Risk Management (V8.3)

We have successfully designed, built, and synchronized the portfolio-aware risk parameters and realized trade metrics persistence engine!

---

## 🛠️ Changes Implemented

### 1. Self-Healing Database Migrations (`src/app/api/trades/route.ts`)
- Added safe alter-table scripts to dynamic table self-healing functions:
  ```sql
  ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS position_size DECIMAL(18, 4) DEFAULT 1.0000;
  ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS exit_price DECIMAL(18, 4);
  ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS realized_pnl DECIMAL(18, 4);
  ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS roi DECIMAL(18, 4);
  ```

### 2. Strategy Sizing Sytem (`src/app/api/trades/route.ts` & `src/hooks/useStrategyEvaluator.ts`)
- **Evaluator linkage:** Evaluator hook reads the strategy settings and submits the strategy-specific `risk_percent` inside the POST body payload.
- **Dynamic Sizing Sizer:**
  - Balance baseline: **$100,000 USD**.
  - Risk formula:
    $$\text{Position Size} = \frac{\$100,000 \times \frac{\text{Risk } \%}{100}}{\text{Abs}(\text{Entry Price} - \text{Stop Loss})}$$
  - Backed by dynamic database queries if the risk percentage parameter is omitted in incoming payload.

### 3. Realized P&L Calculation & Closing (`src/app/api/trades/route.ts`)
- Computed realized P&L and ROI percentage in `/api/trades` PATCH upon status transition to `CLOSED`:
  - **LONG P&L:** `(exit_price - entry_price) * position_size`
  - **SHORT P&L:** `(entry_price - exit_price) * position_size`
  - **ROI %:** `(realized_pnl / (entry_price * position_size)) * 100`
- Persisted exit coordinates and returns all modified columns dynamically.

### 4. Custom Strategy Settings Input (`src/components/modals/EquationBuilder.tsx`)
- Added a numeric `"Risk per Trade (%)"` input field (step 0.1, min 0.1, max 100.0, default 1.0) under strategy settings.
- PERSISTED `risk_percent` in custom strategy `logic_json` payloads.

### 5. High-Fidelity Risk Summary HUD & Closed UI (`src/components/JournalTable.tsx`)
- Main table component pulls `livePrice` from WebSocket context singletons and feeds it as the `exit_price` parameter when closing a position.
- Closed trade rows render final static data with high-contrast, non-pulsing text colors (`text-[#50ffaf]/80 font-bold` for positive, and red for negative) to differentiate them from active live ticks.
- Embedded a brutalist, responsive **Risk Summary HUD** above the table showing:
  - **Total Realized P&L** (with vibrant glowing typography)
  - **Closed Positions Count**
  - **Win Rate %** (Calculated dynamically as Winners / Total Closed).

### 6. Master Blueprint & Lessons Alignment (`directives/master_blueprint.md` & `directives/02_lessons.md`)
- Synchronized documentation of database schemas and API endpoints.
- Documented a new post-mortem for browser audio autoplay policy restrictions.

### 7. Browser Audio Autoplay Fix (`src/hooks/useLiveAlerts.ts` & `src/hooks/useAlertSounds.ts`)
- Intercepted the rejected browser promise for `Audio.play()` and AudioContext resume triggers under `NotAllowedError`.
- Suppressed loud console errors/warnings, replacing them with a low-impact clean debug message to prevent log telemetry clutter when users have not interacted with the document yet.

---

## 🔬 Validation Strategy

1. **DB Self-Healing Checks:** Deployed safely without errors, dynamically altering the schemas.
2. **Strategy Risk Creation:** Verified saving and loading new custom risk inputs.
3. **Closing Execution:** Verified that clicking `Close Position` on active trades calculates precise realized P&L and ROI from live prices and displays them with a solid static design instantly.
4. **Summary HUD Updates:** Verified that the sum of closed trades updates the HUD cards reactively.
