# 🏗️ Quegar Architecture & Graphify Directives

> [!IMPORTANT]
> **📜 Master Blueprint Maintenance Rule:** After completing any update or task, you MUST update the master blueprint file at `directives/master_blueprint.md` to ensure all system documentation, database schemas, and API handlers remain fully synchronized and up to date.

## 🌐 Macro Structure
The `Gem_Charts_Data` project is structurally divided into 13 interconnected communities based on the latest Graphify Report. You must observe strict boundary rules when modifying cross-community bridges to prevent cascading failures.

## ⚡ The "God Nodes" (CRITICAL)
These nodes are the absolute core of the project. Modifying them without analyzing the ripple effect will break the entire data pipeline.

1. **`GET Market Data API Handler`**
   - **Role:** The primary cross-community bridge.
   - **Connection:** Connects `Community 0` (Frontend/State) to `Community 6` (Backend Quant Engine).
   - **Directive:** Do NOT modify the response payload structure of this API. It is the lifeblood of the Gemini JSON feed.

2. **`findUnmitigatedFVGs`**
   - **Role:** The algorithmic analytical bridge.
   - **Connection:** Returns complex mathematical data from `Community 6` back to `Community 0`.
   - **Directive:** The internal math logic here must perfectly align with the ICT 2022 Mentorship parameters. Do not alter its threshold logic without explicit permission.

## ⚠️ Inferred Connections (Verify Before Editing)
Graphify has flagged the following functions as having "inferred" (model-reasoned) relationships. If you modify these, manually trace their dependencies first:
- **`GET()`**: Has 11 inferred connections (linked tightly with `fetchRestingLiquidity()` and `fetchSmartMoneySentiment()`).
- **`useLiveAlerts()`**: Has 2 inferred connections with `useMarketData()` and the `MarketProvider()`.

## 🚷 Isolated Nodes (Noise Reduction)
There are ~19 isolated or weakly-connected nodes in this project. They are strictly for documentation, environment setup, or legacy plans. **DO NOT** attempt to wire them into the core execution logic:
- `Claude Agents Reference`
- `LightningCSS Windows Build`
- `Project Migration Plan`
- `Gem_Charts_Data Main Readme`