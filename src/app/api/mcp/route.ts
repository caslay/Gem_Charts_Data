/**
 * @file src/app/api/mcp/route.ts
 * @description Remote MCP Server — Flow-State Quant Engine V15.3
 *
 * Implements the Model Context Protocol (MCP) Streamable HTTP transport
 * (spec: 2026-07-28, stateless per-request, no sessions).
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CONNECT TO GEMINI SPARK (Custom Apps → MCP URL):                  ║
 * ║    https://flow-state-terminal.vercel.app/api/mcp                  ║
 * ║    Authorization: Bearer <M2M_AGENT_SECRET>                        ║
 * ║                                                                     ║
 * ║  LOCAL DEV:                                                         ║
 * ║    http://localhost:4000/api/mcp                                    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Tools exposed:
 *   1. get_market_context    — Pull fresh quantitative market state snapshot
 *   2. submit_quant_decision — Submit structured trade decision to DB
 *
 * Auth strategy: M2M Bearer token validated BEFORE mcp-handler runs.
 *   - Any MCP-compliant client (Gemini Spark, Claude Desktop, Cursor, agy)
 *     can connect using the same M2M_AGENT_SECRET.
 *   - No per-client tokens — a single shared secret gates the endpoint.
 *   - Completely decoupled from NextAuth / browser sessions.
 *
 * @version 1.0.0 — Flow-State Quant Engine V15.3
 */

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { validateM2MToken } from '@/lib/m2mAuth';
import {
  runGetMarketContext,
  runSubmitQuantDecision,
} from '@/lib/agentEngineHandlers';
import type { AgentTimeframe } from '@/lib/agentEngineHandlers';

// ─── Runtime Config ────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

// ─── MCP Handler Factory ───────────────────────────────────────────────────────

const mcpHandler = createMcpHandler(
  (server) => {
    // ── Tool 1: get_market_context ─────────────────────────────────────────
    server.registerTool(
      'get_market_context',
      {
        title: 'Get Market Context',
        description: `Pulls a fresh, token-efficient quantitative market state snapshot for the given trading symbol and timeframe.

Returns the full Flow-State Quant Engine output including:
- Market structure (trend, MSS/BOS events, ZigZag segments, dealing range)
- Active unmitigated FVGs (sorted nearest-to-price, max 5)
- Liquidity levels (BSL/SSL magnets, PDH/PDL, session highs/lows)
- Order flow state (OI trend, displacement sponsorship, state timeline)
- SMT divergence context (BTC correlation)
- Trade memory (last 5 paper trades from journal)
- Last agent decision from persistent DB log

Timeframe controls the primary analysis resolution:
- '15m' (default): Institutional ICT structure — recommended for session analysis
- '5m': Micro-structure precision — recommended for entry timing
- '1m': Ultra-short term / order flow confirmation
- '1h': Macro swing context — recommended for bias confirmation

All data is fetched fresh from Binance Futures on every call. No stale cache.`,
        inputSchema: z.object({
          symbol: z
            .string()
            .default('ETHUSDC')
            .describe(
              "Trading pair symbol (e.g. 'ETHUSDC', 'BTCUSDC'). Must match a valid Binance Futures perpetual contract."
            ),
          timeframe: z
            .enum(['1m', '5m', '15m', '1h'])
            .default('15m')
            .describe(
              "Primary analysis timeframe. Controls structure engine, FVG detection, and displacement verification. '15m' is the institutional standard for ICT methodology."
            ),
        }),
      },
      async ({ symbol, timeframe }) => {
        try {
          const { payload, meta } = await runGetMarketContext({
            symbol,
            timeframe: timeframe as AgentTimeframe,
          });

          // Return compact JSON as MCP text content
          // The agent can parse JSON.parse(content[0].text) directly
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  ...payload,
                  _meta: meta,
                }),
              },
            ],
          };
        } catch (error: any) {
          console.error('[MCP] get_market_context error:', error);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'ENGINE_ERROR',
                  message: error.message || 'Market context pipeline failed. Check server logs.',
                  symbol,
                  timeframe,
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ── Tool 2: submit_quant_decision ─────────────────────────────────────
    server.registerTool(
      'submit_quant_decision',
      {
        title: 'Submit Quant Decision',
        description: `Submits a structured quantitative trade decision to the persistent Neon PostgreSQL decision log.

Before persisting, runs a pre-flight invalidation guard:
- Fetches the current live Binance Futures price for the symbol.
- If 'invalidation_level' is provided, rejects the decision if live price has already breached it.
  - Bullish bias: rejected if live price < invalidation_level (floor already broken)
  - Bearish bias: rejected if live price > invalidation_level (ceiling already broken)

On success, returns the database record ID and the live price at submission time.
On invalidation breach, returns error code 'INVALIDATION_BREACHED' with breach direction.

The decision is stored with status 'ACTIVE' and can later be updated via the REST PATCH endpoint at /api/agent/context.`,
        inputSchema: z.object({
          agent_id: z
            .string()
            .describe(
              "Unique identifier for the calling agent (e.g. 'gemini-spark-v1', 'claude-3-5-sonnet'). Used for audit trail."
            ),
          symbol: z
            .string()
            .default('ETHUSDC')
            .describe("Trading pair symbol. Must match the symbol used in get_market_context."),
          bias_signal: z
            .enum([
              'CONFIRMED_BULLISH',
              'CONFIRMED_BEARISH',
              'NEUTRAL',
              'ABORT',
              'COUNTER_TREND_RETRACEMENT',
            ])
            .describe(
              "Macro directional bias. Use 'ABORT' if no valid setup exists. Use 'COUNTER_TREND_RETRACEMENT' for pullback trades in the direction of HTF structure."
            ),
          entry_range_low: z
            .number()
            .optional()
            .describe('Lower bound of the entry zone (price level). Optional.'),
          entry_range_high: z
            .number()
            .optional()
            .describe('Upper bound of the entry zone (price level). Optional.'),
          invalidation_level: z
            .number()
            .optional()
            .describe(
              'Hard stop level. Pre-flight guard: decision is REJECTED if live price has already breached this level in the adverse direction. For BULLISH: floor. For BEARISH: ceiling.'
            ),
          target_1: z
            .number()
            .optional()
            .describe('First profit target (TP1) price level.'),
          target_2: z
            .number()
            .optional()
            .describe('Second profit target (TP2) price level. Typically a macro liquidity level.'),
          narrative: z
            .string()
            .optional()
            .describe(
              'Agent SOP reasoning narrative. Document the ICT confluences, displacement status, SMT context, and session timing that led to this decision. Stored as-is for audit.'
            ),
        }),
      },
      async (args) => {
        try {
          const result = await runSubmitQuantDecision(args as any);

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result),
              },
            ],
          };
        } catch (error: any) {
          const code = error.code ?? 'SUBMIT_ERROR';
          const isBreach = code === 'INVALIDATION_BREACHED';

          console.warn(`[MCP] submit_quant_decision ${code}:`, error.message);

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: code,
                  message: error.message,
                  ...(isBreach && {
                    live_price: error.live_price,
                    invalidation_level: error.invalidation_level,
                    breach_direction: error.breach_direction,
                  }),
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );
  },
  {
    // MCP server metadata — visible to Gemini Spark and other MCP clients
    serverInfo: {
      name: 'Flow-State Quant Engine',
      version: '15.3.0',
    },
  }
);

// ─── Auth Wrapper ──────────────────────────────────────────────────────────────
//
// Validates M2M_AGENT_SECRET BEFORE the MCP handler runs.
// If unauthorized, the MCP protocol handshake never starts.
// Any MCP client with the correct Bearer token is accepted.

async function authGuard(req: Request): Promise<Response | null> {
  const auth = validateM2MToken(req);
  if (!auth.ok) {
    return new Response(
      JSON.stringify({ error: auth.error, hint: 'Add Authorization: Bearer <M2M_AGENT_SECRET> header.' }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer realm="Flow-State Quant Engine MCP"',
        },
      }
    );
  }
  return null; // Authorized — proceed
}

// ─── Route Exports (Next.js App Router) ──────────────────────────────────────
//
// MCP Streamable HTTP transport uses:
//   GET  — SSE channel for server-initiated notifications (optional)
//   POST — Primary JSON-RPC request/response channel

export async function GET(req: Request): Promise<Response> {
  const unauthorized = await authGuard(req);
  if (unauthorized) return unauthorized;
  return mcpHandler(req);
}

export async function POST(req: Request): Promise<Response> {
  const unauthorized = await authGuard(req);
  if (unauthorized) return unauthorized;
  return mcpHandler(req);
}
