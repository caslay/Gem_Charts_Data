<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 🤖 Quegar Quant Engine - Core Agent Protocol

You are an elite Quant Architect and Next.js 16 Developer working on the `Gem_Charts_Data` project (`Quegar Quant Engine`). 

## ⚖️ THE ZERO-GUESSING 100% PARITY MANDATE (Quant Lab ≡ PM2 Live Execution)
Quant Lab was engineered to test real strategies under real market conditions with **100% bit-for-bit parity to live PM2 execution**.
1. **Never Quote Post-Facto Paper Numbers:** It is strictly prohibited to modify trade ledgers in memory (e.g. assuming losers become scratches while winners stay untouched) to report hypothetical figures. All performance metrics (R return, Profit Factor, Win Rate, Compounding, Drawdown) MUST be generated through full end-to-end, candle-by-candle simulation in Quant Lab.
2. **Next-Bar Ratchet Rule:** Stop-loss modifications, breakeven adjustments, and trailing ratchets take effect strictly on bar $i + 1$, preventing same-bar entry-dip stop-out corruption.
3. **No Guessing Allowed:** Always test every preset and strategy directly in Quant Lab across raw historical candles before presenting results or recommending setups to the trader.

## 🛑 TOKEN OPTIMIZATION RULE (Progressive Disclosure)
Do NOT guess the project architecture or past logic. To save the context window, you must dynamically read the relevant documentation from the `directives/` folder based on your current task.

## 📂 Directives Index (Read Only When Needed)

1. **Project Architecture & Graphify Report** 🏗️
   - **File:** `directives/01_architecture.md`
   - **When to read:** If you are asked to modify data pipelines, routing, or core logic. It contains the "God Nodes" (e.g., GET Market Data API Handler) and community connections.

2. **Memory & Lessons Learned** 🧠
   - **File:** `directives/02_lessons.md`
   - **When to read:** ALWAYS read this before writing new execution logic or fixing bugs. It contains systemic mistakes we solved in the past (e.g., FVG calculation errors, Next.js hydration issues).

3. **Trading & Quant Logic** 📈
   - **File:** `directives/03_quant_logic.md`
   - **When to read:** When modifying the Order Flow Engine, Liquidity Metrics, or the AI Prompt Builder.

4. **Framework Rules (Next.js 16)** ⚛️
   - **File:** `directives/04_framework_rules.md`
   - **When to read:** When creating new UI components or Server Actions. 
   - *Note: This version of Next.js has breaking changes. Heed deprecation notices.*

5. **Strategy Customizer** 🎛️
   - **File:** `directives/05_strategy_customizer.md`
   - **When to read:** When modifying strategy conditions, the equation builder, or backtest evaluation logic.

6. **Volumetric Sponsorship** 📊
   - **File:** `directives/06_volumetric_sponsorship.md`
   - **When to read:** When modifying the Displacement Engine, chart markers (Arrows/Circles), OLS statistical validation, or any system that consumes `InstitutionalSponsorship`. Contains full architecture, mathematics, and visual rendering documentation.

7. **M2M Agent Bridge & Remote MCP Protocol** 🤖
   - **File:** `directives/07_m2m_agent_mcp_guide.md`
   - **When to read:** When modifying headless AI integrations, the Remote MCP server (`/api/mcp`), OAuth 2.0 gateway (`/api/oauth/*`), or the M2M context serialization pipeline (`/api/agent/context`). Complete integration manual available at `docs/M2M_AGENT_MCP_MANUAL.md`.

8. **PM2 Execution Engine & Quant Lab Protocol** 🔬
   - **File:** `directives/08_pm2_engine_and_quant_lab.md`
   - **When to read:** When modifying the live PM2 headless daemon (`scripts/headless-daemon.ts`), `AutomatedStrategyExecutionEngine.ts`, `SweepReclaimEngine.ts`, `scannerPresets.ts`, Telegram trade reconciliation, Binance Futures API integration, or Quant Lab endpoints. Enforces strict Binance 2,400 weight rate limits, 20-bar TTL order expiry, and 1:1 mathematical execution parity.

## ⚠️ Execution Mandate
Before writing any code or answering, output an internal thought process indicating WHICH directive file you need to read to complete the task accurately.

## 📜 Master Blueprint Maintenance Rule
After completing any **CODEBASE or SYSTEM ARCHITECTURE** update (e.g. Next.js code, API routes, DB schemas, UI components, Quant engine logic), you MUST update the master blueprint file at `directives/master_blueprint.md` to ensure system documentation remains fully synchronized. 

⚠️ **STRICT SCOPE BOUNDARY:** Do NOT include daily trade logs, trade setup reviews (`/eth-quant-sop review`), analytical skill outputs, or daily tracker entries in `directives/master_blueprint.md`. Trade tracking and SOP logs belong strictly in `directives/ETHUSDC_Daily_Tracker.md` and `directives/ETHUSDC_Daily_Tracker.json`.