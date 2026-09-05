# 📘 Flow-State Quant Engine — M2M & Remote MCP Integration Manual

> **Complete Operational Guide for AI Agents, IDEs, and Quantitative Microservices**  
> **Version:** 15.4  
> **Last Updated:** 2026-08-15  

---

## 📑 Table of Contents
1. [System Overview & Architecture](#1-system-overview--architecture)
2. [Quick Reference Matrix](#2-quick-reference-matrix)
3. [Connecting Google Gemini Spark](#3-connecting-google-gemini-spark)
4. [Connecting Google Antigravity & Antigravity IDE](#4-connecting-google-antigravity--antigravity-ide)
5. [Connecting Claude Desktop & Cursor](#5-connecting-claude-desktop--cursor)
6. [Direct Headless M2M REST Integration (Python / Node.js / cURL)](#6-direct-headless-m2m-rest-integration)
7. [MCP Tool Reference & Schemas](#7-mcp-tool-reference--schemas)
8. [Data Dictionary & Output Payloads](#8-data-dictionary--output-payloads)
9. [Pre-Flight Invalidation Guard](#9-pre-flight-invalidation-guard)
10. [Environment Variables & Deployment Checklist](#10-environment-variables--deployment-checklist)
11. [Troubleshooting & FAQ](#11-troubleshooting--faq)

---

## 1. System Overview & Architecture

The Flow-State Quant Engine provides two machine-level entry points that operate independently of browser authentication cookies (NextAuth / Google OAuth):

1. **Remote Model Context Protocol (MCP) Server (`/api/mcp`):**
   - Implements the open standard MCP specification (`2026-07-28`) over StreamableHTTP.
   - Dual-mode authentication:
     - **OAuth 2.0 Authorization Server** with RFC 8414 Discovery (`/.well-known/oauth-authorization-server`) for **Google Gemini Spark**.
     - **Static Bearer Token** for **Antigravity IDE**, **Claude Desktop**, and **Cursor**.
   - Enables LLMs to autonomously discover tools, execute live market analytics, and persist trade decisions.

2. **Direct M2M REST API (`/api/agent/context`):**
   - Headless HTTP REST interface (`GET`, `POST`, `PATCH`) secured via high-entropy timing-safe Bearer tokens.
   - Built for background workers, automated trading bots, and headless analytical scripts.

```
                          ┌────────────────────────────────────────────────────────┐
                          │                AI Reasoning Consumers                  │
                          │  (Gemini Spark, Antigravity, Claude, Cursor, Python)   │
                          └───────────────┬────────────────────────┬───────────────┘
                                          │                        │
                     Standard HTTP REST   │                        │ MCP JSON-RPC 2.0 (StreamableHTTP)
                 (Bearer M2M_AGENT_SECRET)│                        │ (OAuth 2.0 / Bearer Secret)
                                          ▼                        ▼
                           ┌────────────────────────┐    ┌──────────────────────────┐
                           │   /api/agent/context   │    │        /api/mcp          │
                           │   (GET / POST / PATCH) │    │ (tools/list, tools/call) │
                           └──────────────┬─────────┘    └──────────┬───────────────┘
                                          │                         │
                                          └───────────┬─────────────┘
                                                      ▼
                                       ┌─────────────────────────────┐
                                       │ src/lib/agentEngineHandlers │
                                       │ (Shared Quant Pipeline)     │
                                       └──────────────┬──────────────┘
                                                      │
             ┌───────────────────┬────────────────────┼───────────────────┬────────────────────┐
             ▼                   ▼                    ▼                   ▼                    ▼
     ┌───────────────┐   ┌───────────────┐    ┌───────────────┐   ┌───────────────┐    ┌───────────────┐
     │StructureEngine│   │   FvgEngine   │    │DisplacementEng│   │   SmtEngine   │    │OrderFlowEngine│
     └───────────────┘   └───────────────┘    └───────────────┘   └───────────────┘    └───────────────┘
             │                   │                    │                   │                    │
             └───────────────────┴────────────────────┼───────────────────┴────────────────────┘
                                                      ▼
                                       ┌─────────────────────────────┐
                                       │ Neon PostgreSQL             │
                                       │ (agent_decision_log,        │
                                       │  oauth_access_tokens)       │
                                       └─────────────────────────────┘
```

---

## 2. Quick Reference Matrix

| Platform | Protocol | Connection Type | Auth Method | Primary Endpoint |
|---|---|---|---|---|
| **Google Gemini Spark** | MCP | Custom Connected App | OAuth 2.0 | `https://mcp.quegar.com/api/mcp` |
| **Antigravity IDE / CLI** | MCP (stdio bridge) | `mcp_config.json` | `mcp-remote` + Bearer Token | `https://mcp.quegar.com/api/mcp` |
| **Claude Desktop** | MCP (stdio bridge) | `claude_desktop_config.json` | `mcp-remote` + Bearer Token | `https://mcp.quegar.com/api/mcp` |
| **Cursor IDE** | MCP (stdio bridge) | Cursor Settings -> MCP | `mcp-remote` + Bearer Token | `https://mcp.quegar.com/api/mcp` |
| **Python / Background Daemons** | REST HTTP | Direct Requests / HTTPX | Bearer Header | `https://mcp.quegar.com/api/agent/context` |

---

## 3. Connecting Google Gemini Spark

Gemini Spark utilizes the Model Context Protocol over StreamableHTTP with strict OAuth 2.0 discovery requirements.

### Step 1: Open Connected Apps Settings
1. Navigate to [gemini.google.com](https://gemini.google.com).
2. Click **Settings & help** (bottom left gear icon) -> **Connected Apps**.
3. Select **Custom apps for Spark** -> Click **Add App** (or **+**).

### Step 2: Configure Connection Fields
Fill in the modal fields exactly as follows:

* **Add a custom app link:**
  ```text
  https://mcp.quegar.com/api/mcp
  ```
* **Under Advanced Settings (Expand):**
  * **Client ID:**
    ```text
    gemini-spark-client-176ab3226a39516b
    ```
  * **Client secret:**
    ```text
    sec_b8b3d5aec9bf2271c8f3fcca3e7b1695d58bc425a905b977
    ```

### Step 3: Authorize
1. Click **Next**.
2. Gemini will automatically discover `/.well-known/oauth-authorization-server`, execute the authorization code handshake, and store the access token.
3. The status indicator will turn green: **Connected**.

### Step 4: Interacting with Gemini Spark
You can now ask natural language questions in your Gemini Spark prompt window:

> **Example Prompts:**
> - *"Pull the live 15m quantitative context for ETHUSDC and summarize key liquidity levels."*
> - *"Check the order flow and SMT divergence on ETHUSDC 5m. Is there confirmed institutional displacement?"*
> - *"Based on current market structure, submit a bearish trade evaluation with target at SSL magnet."*

---

## 4. Connecting Google Antigravity & Antigravity IDE

Antigravity uses `mcp-remote` to bridge remote HTTPS MCP servers to local Language Server processes over STDIO.

### Option A: Global Configuration (Applies to all workspaces)
Edit your global configuration file at:
- **Windows:** `C:\Users\<username>\.gemini\config\mcp_config.json`
- **macOS/Linux:** `~/.gemini/config/mcp_config.json`

Add the `Quegar-mcp` server definition:

```json
{
  "mcpServers": {
    "Quegar-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.quegar.com/api/mcp",
        "--header",
        "Authorization: Bearer 919ffb05b951192f6baefc10d23c5f3012ff4c2988491a07b42c5c46e3ce138f"
      ]
    }
  }
}
```

### Option B: Project Workspace Configuration
Place the file at `.agents/mcp_config.json` at the root of your repository:

```json
{
  "mcpServers": {
    "Quegar-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.quegar.com/api/mcp",
        "--header",
        "Authorization: Bearer 919ffb05b951192f6baefc10d23c5f3012ff4c2988491a07b42c5c46e3ce138f"
      ]
    }
  }
}
```

### Verification in Antigravity
In the Antigravity Chat panel, run:
> *"What tools are available from the Quegar-mcp MCP server?"*

The agent will automatically list all 6 tools: `get_market_context`, `submit_quant_decision`, `run_quant_backtest`, `get_trade_diagnostics`, `get_live_daemon_status`, and `get_market_structure`.

---

## 5. Connecting Claude Desktop & Cursor

### Claude Desktop Configuration
Edit `claude_desktop_config.json`:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "Quegar-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.quegar.com/api/mcp",
        "--header",
        "Authorization: Bearer 919ffb05b951192f6baefc10d23c5f3012ff4c2988491a07b42c5c46e3ce138f"
      ]
    }
  }
}
```

### Cursor IDE Configuration
1. Go to **Cursor Settings** -> **Features** -> **MCP**.
2. Click **+ Add New MCP Server**.
3. **Name:** `Quegar-mcp`
4. **Type:** `command`
5. **Command:**
   ```bash
   npx -y mcp-remote https://mcp.quegar.com/api/mcp --header "Authorization: Bearer 919ffb05b951192f6baefc10d23c5f3012ff4c2988491a07b42c5c46e3ce138f"
   ```

---

## 6. Direct Headless M2M REST Integration

For automated bots, trading microservices, or custom scripts, the `/api/agent/context` endpoint provides a lightning-fast, stateless REST interface.

### 1. Fetch Market Context (`GET /api/agent/context`)

#### cURL Example:
```bash
curl -X GET "https://mcp.quegar.com/api/agent/context?symbol=ETHUSDC&timeframe=15m" \
  -H "Authorization: Bearer 919ffb05b951192f6baefc10d23c5f3012ff4c2988491a07b42c5c46e3ce138f"
```

#### Python (`httpx` / `requests`) Example:
```python
import httpx

M2M_SECRET = "919ffb05b951192f6baefc10d23c5f3012ff4c2988491a07b42c5c46e3ce138f"
BASE_URL = "https://mcp.quegar.com"

headers = {
    "Authorization": f"Bearer {M2M_SECRET}",
    "Content-Type": "application/json"
}

def get_quant_context(symbol: str = "ETHUSDC", timeframe: str = "15m"):
    url = f"{BASE_URL}/api/agent/context"
    params = {"symbol": symbol, "timeframe": timeframe}
    
    with httpx.Client(timeout=10.0) as client:
        response = client.get(url, headers=headers, params=params)
        response.raise_for_status()
        return response.json()

context = get_quant_context("ETHUSDC", "15m")
print(f"Current Price: {context['price_action']['current_price']}")
print(f"Macro Bias: {context['macro_bias']}")
print(f"Displacement Sponsorship: {context['order_flow']['displacement_sponsorship']}")
```

---

### 2. Submit Decision (`POST /api/agent/context`)

#### Python Submission Example:
```python
def submit_trade_decision(decision_payload: dict):
    url = f"{BASE_URL}/api/agent/context"
    
    with httpx.Client(timeout=10.0) as client:
        response = client.post(url, headers=headers, json=decision_payload)
        
        if response.status_code == 201:
            print("✅ Decision persisted successfully:", response.json())
            return response.json()
        elif response.status_code == 409:
            print("⚠️ Pre-flight guard triggered: Invalidated level already breached.")
            print(response.json())
            return response.json()
        else:
            response.raise_for_status()

# Example Bearish Setup
payload = {
    "agent_id": "gemini-spark-autonomous-v1",
    "symbol": "ETHUSDC",
    "bias_signal": "CONFIRMED_BEARISH",
    "entry_range_low": 2640.50,
    "entry_range_high": 2655.00,
    "invalidation_level": 2672.00, # If live price > 2672, submission is rejected
    "target_1": 2610.00,
    "target_2": 2580.00,
    "narrative": "London Session High swept, bearish MSS confirmed on 15m with active displacement."
}

submit_trade_decision(payload)
```

---

### 3. Update Existing Decision (`PATCH /api/agent/context`)

```python
def update_trade_decision(decision_id: int, status: str, narrative: str = None):
    url = f"{BASE_URL}/api/agent/context"
    body = {
        "id": decision_id,
        "status": status, # "ACTIVE" | "COMPLETED" | "INVALIDATED" | "CANCELLED"
        "narrative": narrative
    }
    
    with httpx.Client(timeout=10.0) as client:
        response = client.patch(url, headers=headers, json=body)
        response.raise_for_status()
        return response.json()
```

---

## 7. MCP Tool Reference & Schemas

### Tool: `get_market_context`

```json
{
  "name": "get_market_context",
  "description": "Pulls a fresh, token-efficient quantitative market state snapshot for the given trading symbol and timeframe.",
  "parameters": {
    "type": "object",
    "properties": {
      "symbol": {
        "type": "string",
        "default": "ETHUSDC",
        "description": "Binance Futures perpetual contract (e.g. 'ETHUSDC', 'BTCUSDC')"
      },
      "timeframe": {
        "type": "string",
        "enum": ["1m", "5m", "15m", "1h"],
        "default": "15m",
        "description": "Primary analysis timeframe resolution"
      }
    }
  }
}
```

### Tool: `submit_quant_decision`

```json
{
  "name": "submit_quant_decision",
  "description": "Submits a structured quantitative trade decision to the persistent Neon PostgreSQL decision log with pre-flight invalidation guard.",
  "parameters": {
    "type": "object",
    "required": ["agent_id", "symbol", "bias_signal"],
    "properties": {
      "agent_id": {
        "type": "string",
        "description": "Identifier of the calling agent (e.g. 'gemini-spark', 'antigravity-ide')"
      },
      "symbol": {
        "type": "string",
        "default": "ETHUSDC"
      },
      "bias_signal": {
        "type": "string",
        "enum": [
          "CONFIRMED_BULLISH",
          "CONFIRMED_BEARISH",
          "NEUTRAL",
          "ABORT",
          "COUNTER_TREND_RETRACEMENT"
        ]
      },
      "entry_range_low": { "type": "number" },
      "entry_range_high": { "type": "number" },
      "invalidation_level": { "type": "number" },
      "target_1": { "type": "number" },
      "target_2": { "type": "number" },
      "narrative": { "type": "string" }
    }
  }
}
```

### Tool: `run_quant_backtest`

```json
{
  "name": "run_quant_backtest",
  "description": "Executes a candle-by-candle quantitative backtest directly in memory with 100% bit-for-bit parity to live PM2 execution.",
  "parameters": {
    "type": "object",
    "properties": {
      "symbol": { "type": "string", "default": "ETHUSDC" },
      "timeframe": { "type": "string", "default": "5m" },
      "preset_id": { "type": "string", "default": "factory_sr_5m_fvg_ce_sniper_v2" },
      "days_lookback": { "type": "number", "default": 30 },
      "start_date": { "type": "string" },
      "end_date": { "type": "string" },
      "initial_equity": { "type": "number", "default": 1000 },
      "risk_per_trade_pct": { "type": "number", "default": 2.0 },
      "compounding_mode": { "type": "string", "enum": ["DYNAMIC_COMPOUNDING", "FIXED_FRACTIONAL"], "default": "DYNAMIC_COMPOUNDING" }
    }
  }
}
```

### Tool: `get_trade_diagnostics`

```json
{
  "name": "get_trade_diagnostics",
  "description": "Pulls forensic quantitative diagnostics for any specific trade setup, price level, or timestamp with 100% PM2 parity.",
  "parameters": {
    "type": "object",
    "properties": {
      "symbol": { "type": "string", "default": "ETHUSDC" },
      "timeframe": { "type": "string", "default": "5m" },
      "target_price": { "type": "number" },
      "timestamp": { "type": "string" },
      "lookback_candles": { "type": "number", "default": 300 }
    }
  }
}
```

### Tool: `get_live_daemon_status`

```json
{
  "name": "get_live_daemon_status",
  "description": "Queries the live headless PM2 execution daemon ('quegar-daemon') state, active in-flight positions, pending limit orders, and session events.",
  "parameters": {
    "type": "object",
    "properties": {
      "symbol": { "type": "string", "default": "ETHUSDC" }
    }
  }
}
```

### Tool: `get_market_structure`

```json
{
  "name": "get_market_structure",
  "description": "Retrieves real-time Level 2 Dealing Range (High, Low, Equilibrium, Regime), Protected High/Low, and ZigZag swings via MarketStructureAPI.",
  "parameters": {
    "type": "object",
    "properties": {
      "symbol": { "type": "string", "default": "ETHUSDC" },
      "timeframe": { "type": "string", "enum": ["1m", "5m", "15m", "1h"], "default": "5m" },
      "lookback_candles": { "type": "number", "default": 250 }
    }
  }
}
```

---

## 8. Data Dictionary & Output Payloads

When an agent calls `get_market_context`, the serialized JSON contains:

```json
{
  "symbol": "ETHUSDC",
  "timeframe": "15m",
  "price_action": {
    "current_price": 2634.50,
    "pdh": 2680.00,
    "pdl": 2590.25,
    "asian_high": 2650.00,
    "asian_low": 2615.00,
    "london_high": 2662.00,
    "london_low": 2620.00
  },
  "market_structure": {
    "trend": "BEARISH",
    "structure_events": [
      { "type": "MSS", "direction": "BEARISH", "level": 2650.00, "timestamp": 1786800000000 }
    ],
    "zigzag_pivots": [
      { "type": "HIGH", "price": 2662.00, "time": 1786801000000 },
      { "type": "LOW", "price": 2630.00, "time": 1786802500000 }
    ],
    "dealing_range": {
      "high": 2680.00,
      "low": 2590.25,
      "equilibrium": 2635.12,
      "discount_zone": [2590.25, 2635.12],
      "premium_zone": [2635.12, 2680.00]
    }
  },
  "active_fvgs": [
    {
      "timeframe": "15m",
      "type": "BEARISH",
      "top": 2655.00,
      "bottom": 2645.00,
      "mitigated": false,
      "distance_to_price": 10.50
    }
  ],
  "order_flow": {
    "oi_trend": "RISING",
    "displacement_sponsorship": "ACTIVE",
    "resting_bsl_magnets": [2665.00, 2680.00],
    "resting_ssl_magnets": [2610.00, 2590.00],
    "taker_buy_ratio": 0.42
  },
  "smt_divergence": {
    "detected": true,
    "type": "BEARISH_SMT",
    "btc_made_hh": true,
    "eth_failed_hh": true
  },
  "macro_bias": "CONFIRMED_BEARISH",
  "recent_trades": [],
  "last_agent_decision": null,
  "generated_at": 1786808500000
}
```

---

## 9. Pre-Flight Invalidation Guard

The engine enforces automated pre-flight safety on all submitted trade decisions:

1. When `invalidation_level` is provided in `submit_quant_decision`:
   - The engine synchronously queries live Binance Perpetual Price.
   - For **BULLISH** signals: If `live_price < invalidation_level`, the decision is **REJECTED** (`INVALIDATION_BREACHED`).
   - For **BEARISH** signals: If `live_price > invalidation_level`, the decision is **REJECTED** (`INVALIDATION_BREACHED`).
2. This protects autonomous reasoning agents from committing executions on hallucinated or stale levels.

---

## 10. Environment Variables & Deployment Checklist
 
 Ensure the following variables are configured in the VPS production environment (`/home/ubuntu/quegar/.env.production`) and local `.env.local`:
 
 ```bash
 # 1. High-Entropy Shared M2M Secret (Bearer Token for Antigravity, Claude, Python)
 M2M_AGENT_SECRET=919ffb05b951192f6baefc10d23c5f3012ff4c2988491a07b42c5c46e3ce138f
 
 # 2. OAuth 2.0 Credentials for Gemini Spark
 OAUTH_CLIENT_ID=gemini-spark-client-176ab3226a39516b
 OAUTH_CLIENT_SECRET=sec_b8b3d5aec9bf2271c8f3fcca3e7b1695d58bc425a905b977
 
 # 3. Database Connection (VPS PostgreSQL on loopback)
 POSTGRES_URL=postgres://quegar_admin:...@127.0.0.1:5432/quegar_db
 ```
 
 ---
 
 ## 11. Troubleshooting & FAQ
 
 ### Q1: Gemini Spark says "This MCP server is not yet supported"
 - **Cause:** The OAuth discovery endpoint metadata returned an unreachable URL (e.g. `localhost`).
 - **Fix:** Verify that `https://mcp.quegar.com/.well-known/oauth-authorization-server` returns `https://mcp.quegar.com` in `issuer` and `authorization_endpoint`.
 
 ### Q2: MCP request returns `406 Not Acceptable`
 - **Cause:** Missing client header `Accept: application/json, text/event-stream`.
 - **Fix:** Use standard MCP clients or ensure `Accept` header includes both `application/json` and `text/event-stream`.
 
 ### Q3: External agent requests are redirected to `/login`
 - **Cause:** Middleware route protection intercepting machine paths.
 - **Fix:** Verify `src/proxy.ts` contains the bypass list for `/api/agent`, `/api/mcp`, `/api/oauth`, and `/.well-known`.
 
 ### Q4: How do I test the endpoint manually via cURL?
 ```bash
 # Test MCP tools/list
 curl -X POST https://mcp.quegar.com/api/mcp \
   -H "Authorization: Bearer 919ffb05b951192f6baefc10d23c5f3012ff4c2988491a07b42c5c46e3ce138f" \
   -H "Accept: application/json, text/event-stream" \
   -H "Content-Type: application/json" \
   -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
 ```
