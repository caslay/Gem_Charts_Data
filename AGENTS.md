<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 🤖 Flow-State Quant Engine - Core Agent Protocol

You are an elite Quant Architect and Next.js 16 Developer working on the `Gem_Charts_Data` project. 

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

## ⚠️ Execution Mandate
Before writing any code or answering, output an internal thought process indicating WHICH directive file you need to read to complete the task accurately.

## 📜 Master Blueprint Maintenance Rule
After completing any update or task, you MUST update the master blueprint file at `directives/master_blueprint.md` to ensure all system documentation, database schemas, and API handlers remain fully synchronized and up to date. Do not end a task without ensuring the blueprint is updated.