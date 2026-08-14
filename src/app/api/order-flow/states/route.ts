import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import {
  OrderFlowStateTracker,
  calculateOrderFlowStats,
  normalizeOrderFlowState
} from '@/lib/orderFlowEngine';
import type { OrderFlowStateRecord } from '@/lib/quantEngine/types';

export const dynamic = 'force-dynamic';

let isSchemaInitialized = false;

async function ensureTableInitialized() {
  if (isSchemaInitialized) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS order_flow_states_log (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(32) NOT NULL,
        state VARCHAR(64) NOT NULL,
        entered_at BIGINT NOT NULL,
        entry_price NUMERIC(16, 4) NOT NULL,
        exited_at BIGINT,
        exit_price NUMERIC(16, 4),
        duration_seconds INTEGER,
        price_change NUMERIC(16, 4),
        price_change_pct NUMERIC(8, 4),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_of_states_symbol_entered ON order_flow_states_log(symbol, entered_at DESC);
    `;
    isSchemaInitialized = true;
  } catch (error: any) {
    console.warn(`[order-flow/states] Table initialization fallback (DB may be offline): ${error.message || error}`);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'ETHUSDC').toUpperCase();
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10), 10), 500);

  try {
    await ensureTableInitialized();

    const res = await sql`
      SELECT
        id,
        symbol,
        state,
        entered_at,
        entry_price,
        exited_at,
        exit_price,
        duration_seconds,
        price_change,
        price_change_pct,
        metadata
      FROM order_flow_states_log
      WHERE symbol = ${symbol}
      ORDER BY entered_at DESC
      LIMIT ${limit}
    `;

    const dbHistory: OrderFlowStateRecord[] = res.rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      state: normalizeOrderFlowState(row.state),
      entered_at: Number(row.entered_at),
      entry_price: parseFloat(row.entry_price),
      exited_at: row.exited_at ? Number(row.exited_at) : null,
      exit_price: row.exit_price ? parseFloat(row.exit_price) : null,
      duration_seconds: row.duration_seconds ? Number(row.duration_seconds) : null,
      price_change: row.price_change ? parseFloat(row.price_change) : null,
      price_change_pct: row.price_change_pct ? parseFloat(row.price_change_pct) : null,
      metadata: typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata || '{}'),
    })).reverse(); // Reverse so oldest is first, chronological

    // Synchronize into tracker memory
    if (dbHistory.length > 0) {
      OrderFlowStateTracker.setHistory(symbol, dbHistory);
    }

    const currentLiveSummary = OrderFlowStateTracker.getTimelineSummary(symbol);
    const active_state = currentLiveSummary.active_state;
    const history = dbHistory.length > 0 ? dbHistory : currentLiveSummary.history;
    const stats = calculateOrderFlowStats(history, active_state);

    return NextResponse.json({
      success: true,
      symbol,
      active_state,
      history,
      stats,
    });
  } catch (error: any) {
    console.warn(`[order-flow/states GET] DB lookup failed, serving from memory: ${error.message || error}`);
    const summary = OrderFlowStateTracker.getTimelineSummary(symbol);
    return NextResponse.json({
      success: true,
      symbol,
      isFallback: true,
      active_state: summary.active_state,
      history: summary.history,
      stats: summary.stats,
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      symbol = 'ETHUSDC',
      state,
      entered_at,
      entry_price,
      exited_at,
      exit_price,
      duration_seconds,
      price_change,
      price_change_pct,
      metadata = {}
    } = body;

    if (!state || !entered_at || entry_price === undefined) {
      return NextResponse.json({ error: 'Missing required parameters: state, entered_at, entry_price' }, { status: 400 });
    }

    const sym = String(symbol).toUpperCase();
    const normalizedState = normalizeOrderFlowState(state);

    await ensureTableInitialized();

    const result = await sql`
      INSERT INTO order_flow_states_log (
        symbol,
        state,
        entered_at,
        entry_price,
        exited_at,
        exit_price,
        duration_seconds,
        price_change,
        price_change_pct,
        metadata
      ) VALUES (
        ${sym},
        ${normalizedState},
        ${Number(entered_at)},
        ${parseFloat(entry_price)},
        ${exited_at ? Number(exited_at) : null},
        ${exit_price ? parseFloat(exit_price) : null},
        ${duration_seconds ? Number(duration_seconds) : null},
        ${price_change ? parseFloat(price_change) : null},
        ${price_change_pct ? parseFloat(price_change_pct) : null},
        ${JSON.stringify(metadata)}
      )
      RETURNING id, symbol, state, entered_at, entry_price, exited_at, exit_price, duration_seconds;
    `;

    return NextResponse.json({
      success: true,
      record: result.rows[0]
    });
  } catch (error: any) {
    console.error(`[order-flow/states POST] Failed to save state log: ${error.message || error}`);
    return NextResponse.json({
      error: 'Failed to record state transition in database',
      details: error.message || String(error)
    }, { status: 500 });
  }
}
