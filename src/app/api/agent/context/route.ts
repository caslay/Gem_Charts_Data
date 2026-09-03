/**
 * @file src/app/api/agent/context/route.ts
 * @description M2M Agent Bridge REST API — Quegar Core Engine V15.3
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ARCHITECTURE MANDATE                                           ║
 * ║  This route is COMPLETELY INDEPENDENT of NextAuth browser       ║
 * ║  sessions. Authenticates via Bearer token (M2M_AGENT_SECRET).  ║
 * ║                                                                 ║
 * ║  V15.3 REFACTOR: All engine logic has been extracted to        ║
 * ║  src/lib/agentEngineHandlers.ts and shared with the MCP        ║
 * ║  server at /api/mcp. This route is now a thin delegation layer. ║
 * ║                                                                 ║
 * ║  NON-DISRUPTION: Does NOT modify /api/market-data (God Node),  ║
 * ║  Chart.tsx, canvas overlays, or any WebSocket streams.          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Endpoints:
 *   GET   /api/agent/context?symbol=ETHUSDC&timeframe=15m
 *     → Returns enriched AgentContextPayload for LLM reasoning.
 *   POST  /api/agent/context
 *     → Accepts AgentDecisionPayload; invalidation guard; persists to DB.
 *   PATCH /api/agent/context
 *     → Updates an existing agent_decision_log record by id.
 *
 * @version 2.0.0 — Quegar Core Engine V15.3
 */

import { NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';
import { validateM2MToken } from '@/lib/m2mAuth';
import {
  runGetMarketContext,
  runSubmitQuantDecision,
  ensureAgentDecisionTableInitialized,
  fetchLivePrice,
  runInvalidationCheck,
} from '@/lib/agentEngineHandlers';

import type {
  AgentDecisionPayload,
  AgentDecisionPatchPayload,
  AgentDecisionRecord,
} from '@/types/agentTypes';
import type { AgentTimeframe } from '@/lib/agentEngineHandlers';

// ─── Runtime Config ────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

// ─── GET Handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/agent/context?symbol=ETHUSDC&timeframe=15m
 *
 * Returns a token-efficient, LLM-optimized market state snapshot.
 * Fetches fresh data from Binance + DB on every request — no stale cache.
 *
 * Query params:
 *   symbol    — Trading pair (default: ETHUSDC)
 *   timeframe — Primary analysis TF: '1m' | '5m' | '15m' | '1h' (default: 15m)
 *
 * Requires: Authorization: Bearer <M2M_AGENT_SECRET>
 */
export async function GET(req: Request) {
  const auth = validateM2MToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'ETHUSDC').toUpperCase();
  const rawTf = searchParams.get('timeframe') || '15m';

  const validTfs: AgentTimeframe[] = ['1m', '5m', '15m', '1h'];
  const timeframe: AgentTimeframe = validTfs.includes(rawTf as AgentTimeframe)
    ? (rawTf as AgentTimeframe)
    : '15m';

  try {
    const { payload, meta } = await runGetMarketContext({ symbol, timeframe });

    return NextResponse.json(
      { ...payload, _meta: meta },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'X-Agent-Bridge-Version': '2.0.0',
          'X-Timeframe': timeframe,
        },
      }
    );
  } catch (error: any) {
    console.error('[agent/context] GET error:', error);
    return NextResponse.json(
      { error: 'Internal engine error. See server logs.', detail: error.message },
      { status: 500 }
    );
  }
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/agent/context
 *
 * Accepts a structured analytical decision from an AI agent.
 * Delegates to runSubmitQuantDecision (shared with MCP tool).
 *
 * Request body: AgentDecisionPayload (JSON)
 * Requires: Authorization: Bearer <M2M_AGENT_SECRET>
 */
export async function POST(req: Request) {
  const auth = validateM2MToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  let body: AgentDecisionPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const result = await runSubmitQuantDecision(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    const code = error.code ?? 'SUBMIT_ERROR';

    if (code === 'VALIDATION_ERROR') {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 400 });
    }

    if (code === 'INVALIDATION_BREACHED') {
      return NextResponse.json(
        {
          error: 'INVALIDATION_BREACHED',
          message: error.message,
          live_price: error.live_price,
          invalidation_level: error.invalidation_level,
          breach_direction: error.breach_direction,
        },
        { status: 409 }
      );
    }

    console.error('[agent/context] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to persist decision to database.', detail: error.message },
      { status: 500 }
    );
  }
}

// ─── PATCH Handler ────────────────────────────────────────────────────────────

/**
 * PATCH /api/agent/context
 *
 * Updates an existing agent_decision_log record by id.
 * Re-runs invalidation guard against live price before updating.
 * Auto-marks records INVALIDATED if the guard fires.
 *
 * Request body: AgentDecisionPatchPayload (JSON)
 * Requires: Authorization: Bearer <M2M_AGENT_SECRET>
 */
export async function PATCH(req: Request) {
  const auth = validateM2MToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  let body: AgentDecisionPatchPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.id || typeof body.id !== 'number') {
    return NextResponse.json(
      { error: 'Missing or invalid field: id (must be a number).' },
      { status: 400 }
    );
  }

  // ── Initialize DB schema ─────────────────────────────────────────────────
  await ensureAgentDecisionTableInitialized();

  // ── Fetch existing record ────────────────────────────────────────────────
  let existingRecord: AgentDecisionRecord | null = null;
  try {
    const res = await sql`
      SELECT * FROM agent_decision_log WHERE id = ${body.id} LIMIT 1
    `;
    existingRecord = (res.rows[0] as AgentDecisionRecord) ?? null;
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Database lookup failed.', detail: error.message },
      { status: 500 }
    );
  }

  if (!existingRecord) {
    return NextResponse.json(
      { error: `No agent_decision_log record found with id=${body.id}.` },
      { status: 404 }
    );
  }

  // ── Re-run invalidation guard on existing record ─────────────────────────
  if (
    existingRecord.invalidation_level &&
    (body.status === 'ACTIVE' || body.status === undefined)
  ) {
    const livePrice = await fetchLivePrice(existingRecord.symbol);
    if (livePrice !== null) {
      const check = runInvalidationCheck(
        Number(existingRecord.invalidation_level),
        livePrice,
        existingRecord.bias_signal
      );
      if (check.breached) {
        // Auto-mark as INVALIDATED
        await sql`
          UPDATE agent_decision_log
          SET status = 'INVALIDATED', invalidated_at = ${Date.now()}
          WHERE id = ${body.id}
        `.catch(() => {}); // Best effort

        return NextResponse.json(
          {
            error: 'INVALIDATION_BREACHED',
            message: `Live price (${livePrice}) has breached the stored invalidation level (${existingRecord.invalidation_level}). Record auto-marked INVALIDATED.`,
            live_price: livePrice,
            invalidation_level: existingRecord.invalidation_level,
            breach_direction: check.breach_direction,
          },
          { status: 409 }
        );
      }
    }
  }

  // ── Apply updates ────────────────────────────────────────────────────────
  const newStatus = body.status ?? existingRecord.status;
  const newNarrative = body.narrative ?? existingRecord.narrative;
  const newTarget1 = body.target_1 ?? existingRecord.target_1;
  const newTarget2 = body.target_2 ?? existingRecord.target_2;
  const newInvalidatedAt =
    newStatus === 'INVALIDATED' && !existingRecord.invalidated_at
      ? Date.now()
      : existingRecord.invalidated_at;

  try {
    const updateRes = await sql`
      UPDATE agent_decision_log
      SET
        status         = ${newStatus},
        narrative      = ${newNarrative},
        target_1       = ${newTarget1},
        target_2       = ${newTarget2},
        invalidated_at = ${newInvalidatedAt}
      WHERE id = ${body.id}
      RETURNING *
    `;

    const updated = updateRes.rows[0] as AgentDecisionRecord;
    console.log(`[agent/context] ✅ Decision updated. id=${body.id} status=${newStatus}`);

    return NextResponse.json({ success: true, record: updated }, { status: 200 });
  } catch (error: any) {
    console.error('[agent/context] PATCH DB error:', error);
    return NextResponse.json(
      { error: 'Failed to update record in database.', detail: error.message },
      { status: 500 }
    );
  }
}
