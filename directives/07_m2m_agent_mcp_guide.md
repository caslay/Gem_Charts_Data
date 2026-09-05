# 🤖 Directive 07: Machine-to-Machine (M2M) Bridge & Remote MCP Protocol

> **Classification:** Core System Directive & Quant Integration Architecture  
> **Last Updated:** 2026-08-15 (V15.4)  
> **Scope:** External AI reasoning agents (Gemini Spark, Antigravity IDE, Background Daemons, Claude Desktop, Cursor)

---

## 1. Architectural Topology

The Quegar Quant Engine provides two unified, high-performance interfaces for headless machine consumers, both decoupled from browser NextAuth session cookies:

```
                                  ┌─────────────────────────────────────────────────────────┐
                                  │                AI Agent Consumers                       │
                                  │  (Gemini Spark, Antigravity, Claude, Cursor, Python)    │
                                  └───────────────┬─────────────────────────┬───────────────┘
                                                  │                         │
                             Standard HTTP REST   │                         │ MCP JSON-RPC 2.0 (StreamableHTTP)
                         (Bearer M2M_AGENT_SECRET)│                         │ (OAuth 2.0 or Bearer Token)
                                                  ▼                         ▼
                                   ┌─────────────────────────┐   ┌───────────────────────────┐
                                   │ /api/agent/context      │   │ /api/mcp                  │
                                   │ (GET, POST, PATCH)      │   │ (tools/list, tools/call)  │
                                   └──────────────┬──────────┘   └──────────┬────────────────┘
                                                  │                         │
                                                  └───────────┬─────────────┘
                                                              ▼
                                               ┌─────────────────────────────┐
                                               │ src/lib/agentEngineHandlers │
                                               │ (Unified Execution Pipeline)│
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
                                               │ agentContextSerializer.ts   │
                                               │ (Token-Pruned Compression)  │
                                               └──────────────┬──────────────┘
                                                              ▼
                                               ┌─────────────────────────────┐
                                               │ Neon PostgreSQL             │
                                               │ (agent_decision_log,        │
                                               │  oauth_access_tokens)       │
                                               └─────────────────────────────┘
```

---

## 2. Authentication & Authorization Security Gates

### Gate A: High-Entropy M2M Static Token (Headless Workers / CLI)
- **Environment Variable:** `M2M_AGENT_SECRET` (configured in `.env.local` and Vercel Project Settings)
- **Header:** `Authorization: Bearer <M2M_AGENT_SECRET>`
- **Validation:** Timing-safe buffer comparison (`crypto.timingSafeEqual`) in `src/lib/m2mAuth.ts`
- **Supported Consumers:** Python scripts, Antigravity CLI, Antigravity IDE (`mcp-remote`), Claude Desktop, Cursor.

### Gate B: RFC 6749 & RFC 8414 OAuth 2.0 Server (Gemini Spark)
- **RFC 8414 Discovery Endpoint:** `/.well-known/oauth-authorization-server` (rewritten to `/api/oauth/discovery`)
- **Authorization Endpoint:** `/api/oauth/authorize` (auto-approves single-tenant Gemini Spark redirect with 5-minute one-time code)
- **Token Endpoint:** `/api/oauth/token` (exchanges code for 30-day token stored in `oauth_access_tokens`)
- **Environment Variables:** `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET`

---

## 3. Remote MCP Server Protocol (`/api/mcp`)

### Protocol Compliance
- **Transport:** StreamableHTTP (stateless request/response over HTTP POST, optional SSE over GET).
- **Specification:** MCP 2026-07-28 standard.
- **Engine Adapter:** `mcp-handler@2.1.1` + `@modelcontextprotocol/server@2.0.0`.

### Exposed Tools

#### Tool 1: `get_market_context`
- **Description:** Pulls fresh, multi-timeframe quantitative state and order flow analytics for an asset.
- **Inputs:**
  - `symbol` (string, default: `"ETHUSDC"`): Binance Futures perpetual contract.
  - `timeframe` (enum: `["1m", "5m", "15m", "1h"]`, default: `"15m"`): Primary analysis resolution.
- **Return Value:** Token-pruned `AgentContextPayload` JSON string.

#### Tool 2: `submit_quant_decision`
- **Description:** Submits a structured trade evaluation to the persistent database log with a pre-flight invalidation guard.
- **Inputs:**
  - `agent_id` (string, required): Calling agent identifier (e.g., `"gemini-spark"`, `"antigravity-ide"`).
  - `symbol` (string, required): Trading pair symbol.
  - `bias_signal` (enum, required): `"CONFIRMED_BULLISH"` | `"CONFIRMED_BEARISH"` | `"NEUTRAL"` | `"ABORT"` | `"COUNTER_TREND_RETRACEMENT"`.
  - `entry_range_low` (number, optional): Entry zone floor.
  - `entry_range_high` (number, optional): Entry zone ceiling.
  - `invalidation_level` (number, optional): Hard stop level.
  - `target_1` (number, optional): First take-profit target.
  - `target_2` (number, optional): Second macro take-profit target.
  - `narrative` (string, optional): Structured ICT/SOP reasoning text.

#### Tool 3: `run_quant_backtest`
- **Description:** Executes a candle-by-candle quantitative backtest directly in memory with 100% bit-for-bit parity to live PM2 execution (eliminating terminal commands).
- **Inputs:**
  - `symbol` (string, default: `"ETHUSDC"`): Trading pair symbol.
  - `timeframe` (string, default: `"5m"`): Primary execution timeframe.
  - `preset_id` (string, default: `"factory_sr_5m_fvg_ce_sniper_v2"`): Strategy preset ID.
  - `days_lookback` (number, default: `30`, range: 1-365): Historical days to test.
  - `start_date` / `end_date` (string, optional): Specific date bounds (YYYY-MM-DD).
  - `initial_equity` (number, default: `1000`): Starting account balance in USD.
  - `risk_per_trade_pct` (number, default: `2.0`): 1.0R compounded risk per trade.
  - `compounding_mode` (`"DYNAMIC_COMPOUNDING"` | `"FIXED_FRACTIONAL"`, default: `"DYNAMIC_COMPOUNDING"`).
- **Return Value:** Structured summary containing total trades, win rate %, net realized R, profit factor, max drawdown (R and %), final equity, and recent 10 trades.

#### Tool 4: `get_trade_diagnostics`
- **Description:** Forensic quantitative diagnostics for any specific trade setup, price level, or timestamp with 100% PM2 parity.
- **Inputs:**
  - `symbol` (string, default: `"ETHUSDC"`): Trading pair symbol.
  - `timeframe` (string, default: `"5m"`): Candle timeframe.
  - `target_price` (number, optional): Target price level (matches entry, anchor, or sweep).
  - `timestamp` (string | number, optional): Target timestamp (matches execution within 30m).
  - `lookback_candles` (number, default: `300`): Historical buffer to evaluate.
- **Return Value:** Forensic breakdown of anchor geometry, sweep depth, reclaim candle, 3-pillar displacement metrics (volume expansion, delta dominance, body ratio), dealing range equilibrium, bracket levels, and simulated outcome.

#### Tool 5: `get_live_daemon_status`
- **Description:** Queries the live headless PM2 execution daemon (`quegar-daemon`), active in-flight positions, pending limit orders, and session events.
- **Inputs:**
  - `symbol` (string, default: `"ETHUSDC"`): Trading pair symbol.
- **Return Value:** Live session ID, date, boot time, equity, total R, active in-flight positions, pending limit orders, and last 15 session events from `run_logs/live_session_YYYY-MM-DD.json`.

#### Tool 6: `get_market_structure`
- **Description:** Retrieves real-time Level 2 Dealing Range (High, Low, Equilibrium, Regime), Protected High/Low, and ZigZag swings via `MarketStructureAPI`.
- **Inputs:**
  - `symbol` (string, default: `"ETHUSDC"`): Trading pair symbol.
  - `timeframe` (enum: `["1m", "5m", "15m", "1h"]`, default: `"5m"`).
  - `lookback_candles` (number, default: `250`): Candle count.
- **Return Value:** Dealing range boundaries, equilibrium, current discount/premium regime, protected levels, recent confirmed swings, and active displacement state.

---

## 4. Pre-Flight Invalidation Guard Algorithm

To prevent agents from recording stale or hallucinated decisions when market price has moved past invalidation during the reasoning loop:

```typescript
function runInvalidationCheck(invalidationLevel: number, livePrice: number, biasSignal: string) {
  const isBullish = biasSignal.includes('BULLISH');
  if (isBullish && livePrice < invalidationLevel) {
    // Rejected: Bullish setup invalid because price breached below stop floor
    return { breached: true, breach_direction: 'BELOW' };
  }
  if (!isBullish && livePrice > invalidationLevel) {
    // Rejected: Bearish setup invalid because price breached above stop ceiling
    return { breached: true, breach_direction: 'ABOVE' };
  }
  return { breached: false, breach_direction: null };
}
```

If breached:
- **REST POST:** Rejects with `HTTP 409 Conflict` and `{ error: "INVALIDATION_BREACHED", live_price, invalidation_level, breach_direction }`.
- **MCP Tool:** Returns `isError: true` with structured breach error details.

---

## 5. Token-Optimization & Serialization Bounds

To guarantee high model performance and prevent context overflow, `agentContextSerializer.ts` enforces deterministic constraints:

| Category | Compression Policy | Maximum Count / Precision |
|---|---|---|
| **ZigZag Structure** | Sorted descending by timestamp | 10 most recent pivots |
| **Active FVGs** | Sorted by absolute distance to live price | 5 nearest unmitigated FVGs |
| **Liquidity Pools** | Nearest resting BSL and SSL magnets | Top 3 each |
| **Journal Memory** | Recent paper trades | 5 most recent trades |
| **Price Precision** | Rounded numeric values | 2 to 4 decimal places |
| **Raw OHLCV** | Stripped entirely | 0 raw candle arrays returned |

---

## 6. Neon PostgreSQL Database Schemas

```sql
-- Persistent Agent Decision Audit Log
CREATE TABLE IF NOT EXISTS agent_decision_log (
  id                       SERIAL PRIMARY KEY,
  symbol                   VARCHAR(32)   NOT NULL,
  agent_id                 VARCHAR(128)  NOT NULL,
  bias_signal              VARCHAR(64)   NOT NULL,
  entry_range_low          NUMERIC(16,4),
  entry_range_high         NUMERIC(16,4),
  invalidation_level       NUMERIC(16,4),
  target_1                 NUMERIC(16,4),
  target_2                 NUMERIC(16,4),
  narrative                TEXT,
  status                   VARCHAR(32)   NOT NULL DEFAULT 'PENDING',
  live_price_at_submission  NUMERIC(16,4),
  submitted_at             BIGINT        NOT NULL,
  invalidated_at           BIGINT,
  created_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- OAuth 2.0 Authorization Codes (One-Time Use, 5-Min TTL)
CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  id           SERIAL PRIMARY KEY,
  code         VARCHAR(128) UNIQUE NOT NULL,
  client_id    VARCHAR(256) NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at   BIGINT NOT NULL,
  used         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- OAuth 2.0 Bearer Access Tokens (30-Day TTL)
CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id          SERIAL PRIMARY KEY,
  token       VARCHAR(128) UNIQUE NOT NULL,
  client_id   VARCHAR(256) NOT NULL,
  scope       TEXT,
  expires_at  BIGINT NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## 7. Operational Guidelines for LLM Agents

1. **Always Request Fresh Context First:** Call `get_market_context(symbol, timeframe)` at the beginning of each reasoning pass.
2. **Select Context Resolution Appropriately:**
   - Use `15m` for Macro Trend, dealing range, and session bias.
   - Use `5m` or `1m` for micro-structure confirmation and pinpoint FVG entries.
3. **Check Displacements and SMT Alignment:** Ensure institutional sponsorship is `ACTIVE` and verify whether SMT divergence confirms directional bias before submitting `CONFIRMED_BULLISH` or `CONFIRMED_BEARISH`.
4. **Always Provide Hard Invalidation:** Include `invalidation_level` on every submission to engage the pre-flight invalidation guard.
