import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

/**
 * Automated Paper Trading Journal API Endpoint (Phase 3)
 *
 * POST /api/trades
 *
 * This endpoint:
 * 1. Requires an active NextAuth session (401 Unauthorized if missing).
 * 2. Self-heals the 'paper_trades' table on the first hit inside a try/catch.
 * 3. Calculates dynamic trade execution parameters based on incoming `ipda_metrics`:
 *    - Entry Price: Defaults to `entry_price` in request. Fallback to `closest_active_fvg_ce`
 *      or current market price.
 *    - Stop Loss (SL): 1 tick (0.05) below/above institutional hard invalidation levels.
 *    - Take Profit (TP): Nearest resting liquidity magnet (BSL/SSL) that achieves >= 1:2 RR.
 * 4. Enforces validation gate of at least 1:2 Risk-Reward ratio.
 * 5. Persists the trade execution into the Neon SQL PostgreSQL database.
 */

// Self-healing database schema generator
async function initTradesTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS paper_trades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        symbol VARCHAR(50) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        entry_price DECIMAL(18, 4) NOT NULL,
        stop_loss DECIMAL(18, 4) NOT NULL,
        take_profit DECIMAL(18, 4) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        strategy_name VARCHAR(255) NOT NULL,
        ai_narrative_summary TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("[PAPER TRADES API] Database table 'paper_trades' initialized / verified.");
  } catch (error) {
    console.error("[PAPER TRADES API] Self-healing table initialization failed:", error);
    throw error;
  }
}

// Helper to get nearest magnet satisfying the 1:2 RR condition
function getBestMagnet(
  magnets: number[],
  entryPrice: number,
  stopLoss: number,
  direction: "LONG" | "SHORT"
): number | null {
  if (!magnets || magnets.length === 0) return null;

  const risk = Math.abs(entryPrice - stopLoss);
  const minReward = 2.0 * risk;

  // Filter candidates that meet the 1:2 RR constraint
  const candidates = magnets.filter((magnet) => {
    if (direction === "LONG") {
      // Long TP must be at least entry + 2 * risk
      return magnet >= parseFloat((entryPrice + minReward).toFixed(4));
    } else {
      // Short TP must be at least entry - 2 * risk
      return magnet <= parseFloat((entryPrice - minReward).toFixed(4));
    }
  });

  if (candidates.length === 0) return null;

  // Find the candidate nearest to the entry price
  let nearest = candidates[0];
  let minDiff = Math.abs(nearest - entryPrice);
  for (let i = 1; i < candidates.length; i++) {
    const diff = Math.abs(candidates[i] - entryPrice);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = candidates[i];
    }
  }
  return nearest;
}

export async function POST(req: Request) {
  try {
    // ── 1. NextAuth Session Guard ──────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    // ── 2. Self-Healing Database Initialization ─────────────────────────────
    try {
      await initTradesTable();
    } catch (dbError) {
      return NextResponse.json(
        { error: "Database self-healing initialization failed." },
        { status: 500 }
      );
    }

    // ── 3. Parse and Validate Request Payload ──────────────────────────────
    const body = await req.json();
    const { symbol, direction, strategy_name, ai_narrative_summary, ipda_metrics } = body;

    if (!symbol || !direction || !strategy_name) {
      return NextResponse.json(
        { error: "Missing required parameters: 'symbol', 'direction', or 'strategy_name'." },
        { status: 400 }
      );
    }

    if (direction !== "LONG" && direction !== "SHORT") {
      return NextResponse.json(
        { error: "Invalid trade direction. Must be 'LONG' or 'SHORT'." },
        { status: 400 }
      );
    }

    if (!ipda_metrics) {
      return NextResponse.json(
        { error: "Missing required 'ipda_metrics' JSON payload." },
        { status: 400 }
      );
    }

    // ── 4. Resolve Current Market Price ─────────────────────────────────────
    const current_market_price = body.current_price
      || body.currentPrice
      || ipda_metrics.pricing_context?.local_dealing_range?.currentLivePrice
      || (Array.isArray(ipda_metrics.data_payload?.candles_5m) && ipda_metrics.data_payload.candles_5m.length > 0
          ? ipda_metrics.data_payload.candles_5m[ipda_metrics.data_payload.candles_5m.length - 1].c
          : null)
      || (Array.isArray(body.data_payload?.candles_5m) && body.data_payload.candles_5m.length > 0
          ? body.data_payload.candles_5m[body.data_payload.candles_5m.length - 1].c
          : null);

    // ── 5. Resolve Entry Price ──────────────────────────────────────────────
    let entry_price = body.entry_price;
    if (entry_price === undefined || entry_price === null) {
      const fvg_ce = ipda_metrics.trade_execution_parameters?.closest_active_fvg_ce;
      if (fvg_ce !== undefined && fvg_ce !== null && !isNaN(fvg_ce)) {
        entry_price = fvg_ce;
      } else if (current_market_price !== undefined && current_market_price !== null && !isNaN(current_market_price)) {
        entry_price = current_market_price;
      }
    }

    if (entry_price === undefined || entry_price === null || isNaN(entry_price)) {
      return NextResponse.json(
        { error: "Could not determine Entry Price. Provide 'entry_price' or ensure a valid market price/FVG CE exists." },
        { status: 400 }
      );
    }

    entry_price = parseFloat(entry_price.toFixed(4));

    // ── 6. Strict IPDA Stop Loss Calculation (with 0.05 tick offset) ─────────
    const tickIncrement = 0.05;
    let stop_loss: number | null = null;

    const hardInvalidation = ipda_metrics.trade_execution_parameters?.hard_invalidation_levels;

    if (direction === "LONG") {
      const bullish_invalidation = hardInvalidation?.bullish_invalidation;
      if (bullish_invalidation === undefined || bullish_invalidation === null) {
        return NextResponse.json(
          { error: "Missing hard invalidation level (bullish_invalidation) required for LONG trade SL." },
          { status: 400 }
        );
      }
      // Floating-point precision safe calculation: 1 tick below bullish invalidation
      stop_loss = parseFloat((bullish_invalidation - tickIncrement).toFixed(4));
    } else {
      const bearish_invalidation = hardInvalidation?.bearish_invalidation;
      if (bearish_invalidation === undefined || bearish_invalidation === null) {
        return NextResponse.json(
          { error: "Missing hard invalidation level (bearish_invalidation) required for SHORT trade SL." },
          { status: 400 }
        );
      }
      // Floating-point precision safe calculation: 1 tick above bearish invalidation
      stop_loss = parseFloat((bearish_invalidation + tickIncrement).toFixed(4));
    }

    if (stop_loss === null || isNaN(stop_loss)) {
      return NextResponse.json(
        { error: "Could not calculate a valid Stop Loss level." },
        { status: 400 }
      );
    }

    // ── 7. Strict Take Profit Calculation (Nearest Magnet >= 1:2 RR) ────────
    let take_profit = body.take_profit;
    if (take_profit === undefined || take_profit === null) {
      const orderFlow = ipda_metrics.order_flow_engine;
      const restingLiquidity = orderFlow?.resting_liquidity_pools;
      const magnets = direction === "LONG"
        ? (restingLiquidity?.BSL_Magnets || [])
        : (restingLiquidity?.SSL_Magnets || []);
      
      take_profit = getBestMagnet(magnets, entry_price, stop_loss, direction);
    }

    if (take_profit === undefined || take_profit === null || isNaN(take_profit)) {
      return NextResponse.json(
        { error: "Inefficient Algorithm: RR < 2.0" },
        { status: 400 }
      );
    }

    take_profit = parseFloat(take_profit.toFixed(4));

    // ── 8. Risk-to-Reward Ratio Validation Gate ────────────────────────────
    const risk = Math.abs(entry_price - stop_loss);
    const reward = Math.abs(take_profit - entry_price);

    if (risk === 0) {
      return NextResponse.json(
        { error: "Invalid trade parameters: Risk is zero (Entry equals Stop Loss)." },
        { status: 400 }
      );
    }

    // Validate directional sanity
    if (direction === "LONG") {
      if (stop_loss >= entry_price) {
        return NextResponse.json(
          { error: "Invalid LONG parameters: Stop Loss must be below Entry Price." },
          { status: 400 }
        );
      }
      if (take_profit <= entry_price) {
        return NextResponse.json(
          { error: "Invalid LONG parameters: Take Profit must be above Entry Price." },
          { status: 400 }
        );
      }
    } else {
      if (stop_loss <= entry_price) {
        return NextResponse.json(
          { error: "Invalid SHORT parameters: Stop Loss must be above Entry Price." },
          { status: 400 }
        );
      }
      if (take_profit >= entry_price) {
        return NextResponse.json(
          { error: "Invalid SHORT parameters: Take Profit must be below Entry Price." },
          { status: 400 }
        );
      }
    }

    const rrRatio = parseFloat((reward / risk).toFixed(4));

    if (rrRatio < 2.0) {
      return NextResponse.json(
        { error: "Inefficient Algorithm: RR < 2.0" },
        { status: 400 }
      );
    }

    // ── 9. Persist Trade Execution ──────────────────────────────────────────
    const status = "OPEN";
    const dbResult = await sql`
      INSERT INTO paper_trades (
        symbol,
        direction,
        entry_price,
        stop_loss,
        take_profit,
        status,
        strategy_name,
        ai_narrative_summary
      ) VALUES (
        ${symbol},
        ${direction},
        ${entry_price},
        ${stop_loss},
        ${take_profit},
        ${status},
        ${strategy_name},
        ${ai_narrative_summary || null}
      ) RETURNING id, timestamp;
    `;

    const savedTrade = dbResult.rows[0];

    // ── 10. Construct and Return Success Response ───────────────────────────
    const execution_parameters = {
      symbol,
      direction,
      entry_price,
      stop_loss,
      take_profit,
      status,
      risk_reward_ratio: rrRatio,
      risk_amount: risk,
      reward_amount: reward,
      strategy_name,
      ai_narrative_summary: ai_narrative_summary || null
    };

    return NextResponse.json({
      success: true,
      trade_id: savedTrade.id,
      timestamp: savedTrade.timestamp,
      execution_parameters
    });

  } catch (error: unknown) {
    console.error("[PAPER TRADES API] POST Handler Failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error during trade logging.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// ─── GET: Fetch all paper trades ordered by created_at DESC ───────────────────
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    // Ensure database table is verified
    await initTradesTable();

    const { rows } = await sql`
      SELECT * FROM paper_trades
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ success: true, trades: rows });
  } catch (error: unknown) {
    console.error("[PAPER TRADES API] GET Error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch paper trades.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// ─── PATCH: Update manual trade status (OPEN, CLOSED, PAUSED) ────────────────
export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { trade_id, status } = body;

    if (!trade_id || !status) {
      return NextResponse.json(
        { error: "Missing required fields: 'trade_id' and 'status' must be provided." },
        { status: 400 }
      );
    }

    const uppercaseStatus = status.toUpperCase();
    if (uppercaseStatus !== "OPEN" && uppercaseStatus !== "CLOSED" && uppercaseStatus !== "PAUSED") {
      return NextResponse.json(
        { error: "Invalid status transition. Allowed values: 'OPEN', 'CLOSED', 'PAUSED'." },
        { status: 400 }
      );
    }

    await initTradesTable();

    const updateResult = await sql`
      UPDATE paper_trades
      SET status = ${uppercaseStatus}
      WHERE id = ${trade_id}
      RETURNING id, status;
    `;

    if (updateResult.rows.length === 0) {
      return NextResponse.json(
        { error: `Trade with ID ${trade_id} not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Trade status updated to ${uppercaseStatus}.`,
      trade: updateResult.rows[0]
    });
  } catch (error: unknown) {
    console.error("[PAPER TRADES API] PATCH Error:", error);
    const message = error instanceof Error ? error.message : "Failed to update trade status.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// ─── DELETE: Surgery row purge from database ──────────────────────────────────
export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    let trade_id: string | null = null;

    // Try reading trade_id from URL query params
    const url = new URL(req.url);
    trade_id = url.searchParams.get("trade_id") || url.searchParams.get("id");

    // Fallback: try reading trade_id from JSON request body
    if (!trade_id) {
      try {
        const body = await req.json();
        trade_id = body.trade_id || body.id;
      } catch {}
    }

    if (!trade_id) {
      return NextResponse.json(
        { error: "Missing required parameter: 'trade_id' is required to delete." },
        { status: 400 }
      );
    }

    await initTradesTable();

    const deleteResult = await sql`
      DELETE FROM paper_trades
      WHERE id = ${trade_id}
      RETURNING id;
    `;

    if (deleteResult.rows.length === 0) {
      return NextResponse.json(
        { error: `Trade with ID ${trade_id} not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Trade successfully purged from the database.",
      deleted_id: trade_id
    });
  } catch (error: unknown) {
    console.error("[PAPER TRADES API] DELETE Error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete trade.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

