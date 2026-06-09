import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

// --- HIGH-RELIABILITY LOCAL IN-MEMORY FALLBACK SYSTEM ---
let isDbOffline = false;
let inMemoryTrades: any[] = [];
let inMemoryAccount: any = null;

function initializeInMemoryAccount(userEmail: string) {
  if (!inMemoryAccount) {
    inMemoryAccount = {
      id: "mock-account-uuid",
      user_id: userEmail,
      current_balance: "10000.0000",
      initial_capital: "10000.0000",
      max_risk_limit_pct: "3.00",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }
  return inMemoryAccount;
}

// --- IN-MEMORY FALLBACK IMPLEMENTATION FOR PAPER TRADES ---
function handleGetFallback(userEmail: string) {
  const account = initializeInMemoryAccount(userEmail);
  const trades = [...inMemoryTrades].sort(
    (a, b) => new Date(b.created_at || b.timestamp).getTime() - new Date(a.created_at || a.timestamp).getTime()
  );
  return NextResponse.json({ success: true, trades, account });
}

async function handlePostFallback(req: Request, userEmail: string, parsedBody?: any) {
  try {
    const account = initializeInMemoryAccount(userEmail);
    const body = parsedBody || await req.json();
    const { symbol, direction, strategy_name, ai_narrative_summary, ipda_metrics, sl_logic, tp_logic } = body;

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

    // Dynamic checks
    const openTradesCount = inMemoryTrades.filter(t => t.status === "OPEN").length;
    if (openTradesCount > 0) {
      return NextResponse.json(
        { error: "GLOBAL_LOCK: An active trade is already in progress. Close it before initiating new setups." },
        { status: 403 }
      );
    }

    const isThisStrategyAlreadyOpen = inMemoryTrades.some(
      t => t.strategy_name === strategy_name && (t.status === "OPEN" || t.status === "PAUSED")
    );
    if (isThisStrategyAlreadyOpen) {
      return NextResponse.json(
        { error: "[ENTRY_BLOCKED: ONE_TRADE_RULE] This strategy already has an active open position. Close it before opening a new one." },
        { status: 409 }
      );
    }

    // Resolve current market price
    const current_market_price = body.current_price
      || body.currentPrice
      || ipda_metrics?.pricing_context?.local_dealing_range?.currentLivePrice
      || (Array.isArray(ipda_metrics?.data_payload?.candles_5m) && ipda_metrics.data_payload.candles_5m.length > 0
          ? ipda_metrics.data_payload.candles_5m[ipda_metrics.data_payload.candles_5m.length - 1].c
          : null)
      || (Array.isArray(body.data_payload?.candles_5m) && body.data_payload.candles_5m.length > 0
          ? body.data_payload.candles_5m[body.data_payload.candles_5m.length - 1].c
          : null);

    // Resolve entry price
    let entry_price = body.entry_price !== undefined && body.entry_price !== null ? body.entry_price : body.price;

    if (entry_price === undefined || entry_price === null) {
      const fvg_ce = ipda_metrics?.trade_execution_parameters?.closest_active_fvg_ce;
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

    // Stop loss calculation based on sl_logic
    const tickIncrement = 0.05;
    let stop_loss: number | null = null;
    if (body.stop_loss !== undefined && body.stop_loss !== null) {
      stop_loss = parseFloat(body.stop_loss);
    } else {
      const slMode = sl_logic || 'Structural Swing';

      if (slMode === 'Manual Pips') {
        if (direction === 'LONG') {
          stop_loss = parseFloat((entry_price - 10.00).toFixed(4));
        } else {
          stop_loss = parseFloat((entry_price + 10.00).toFixed(4));
        }
      } else if (slMode === 'Last Candle High/Low') {
        const candles = ipda_metrics?.data_payload?.candles_5m || body.data_payload?.candles_5m || [];
        const lastCandle = candles.length >= 2 ? candles[candles.length - 2] : null;

        if (lastCandle) {
          if (direction === 'LONG') {
            stop_loss = parseFloat((lastCandle.l - tickIncrement).toFixed(4));
          } else {
            stop_loss = parseFloat((lastCandle.h + tickIncrement).toFixed(4));
          }
        } else {
          const hardInvalidation = ipda_metrics?.trade_execution_parameters?.hard_invalidation_levels;
          if (direction === 'LONG') {
            const bullish_invalidation = hardInvalidation?.bullish_invalidation;
            if (bullish_invalidation !== undefined && bullish_invalidation !== null) {
              stop_loss = parseFloat((bullish_invalidation - tickIncrement).toFixed(4));
            }
          } else {
            const bearish_invalidation = hardInvalidation?.bearish_invalidation;
            if (bearish_invalidation !== undefined && bearish_invalidation !== null) {
              stop_loss = parseFloat((bearish_invalidation + tickIncrement).toFixed(4));
            }
          }
        }
      }

      if (stop_loss === null) {
        const hardInvalidation = ipda_metrics?.trade_execution_parameters?.hard_invalidation_levels;
        if (direction === "LONG") {
          const bullish_invalidation = hardInvalidation?.bullish_invalidation;
          if (bullish_invalidation === undefined || bullish_invalidation === null) {
            return NextResponse.json(
              { error: "Missing hard invalidation level (bullish_invalidation) required for LONG trade SL." },
              { status: 400 }
            );
          }
          stop_loss = parseFloat((bullish_invalidation - tickIncrement).toFixed(4));
        } else {
          const bearish_invalidation = hardInvalidation?.bearish_invalidation;
          if (bearish_invalidation === undefined || bearish_invalidation === null) {
            return NextResponse.json(
              { error: "Missing hard invalidation level (bearish_invalidation) required for SHORT trade SL." },
              { status: 400 }
            );
          }
          stop_loss = parseFloat((bearish_invalidation + tickIncrement).toFixed(4));
        }
      }
    }

    if (stop_loss === null || isNaN(stop_loss)) {
      return NextResponse.json(
        { error: "Could not calculate a valid Stop Loss level." },
        { status: 400 }
      );
    }

    // Take Profit calculation
    let take_profit = body.take_profit;
    const tpMode = tp_logic || 'Nearest Order Book Magnet';

    if (take_profit === undefined || take_profit === null) {
      if (tpMode === 'Manual Pips') {
        const risk = Math.abs(entry_price - stop_loss);
        if (direction === 'LONG') {
          take_profit = parseFloat((entry_price + 2 * risk).toFixed(4));
        } else {
          take_profit = parseFloat((entry_price - 2 * risk).toFixed(4));
        }
      } else if (tpMode === 'PDH/PDL Target') {
        const macro = ipda_metrics?.macro_levels || {};
        const pdh = macro.pdh || ipda_metrics?.pdh || 0;
        const pdl = macro.pdl || ipda_metrics?.pdl || 0;

        if (direction === 'LONG' && pdh > 0) {
          take_profit = parseFloat(pdh.toFixed(4));
        } else if (direction === 'SHORT' && pdl > 0) {
          take_profit = parseFloat(pdl.toFixed(4));
        }
      }

      if (take_profit === undefined || take_profit === null) {
        const orderFlow = ipda_metrics?.order_flow_engine;
        const restingLiquidity = orderFlow?.resting_liquidity_pools;
        const magnets = direction === "LONG"
          ? (restingLiquidity?.BSL_Magnets || [])
          : (restingLiquidity?.SSL_Magnets || []);
        
        take_profit = getBestMagnet(magnets, entry_price, stop_loss, direction);
      }
    }

    if (take_profit === undefined || take_profit === null || isNaN(take_profit)) {
      const risk = Math.abs(entry_price - stop_loss);
      if (direction === 'LONG') {
        take_profit = parseFloat((entry_price + 2.0 * risk).toFixed(4));
      } else {
        take_profit = parseFloat((entry_price - 2.0 * risk).toFixed(4));
      }
    }

    take_profit = parseFloat(take_profit.toFixed(4));

    // Risk-to-reward check
    const risk = Math.abs(entry_price - stop_loss);
    let reward = Math.abs(take_profit - entry_price);

    if (risk === 0) {
      return NextResponse.json(
        { error: "Invalid trade parameters: Risk is zero (Entry equals Stop Loss)." },
        { status: 400 }
      );
    }

    if (direction === "LONG") {
      if (stop_loss >= entry_price) {
        return NextResponse.json({ error: "Invalid LONG parameters: Stop Loss must be below Entry Price." }, { status: 400 });
      }
      if (take_profit <= entry_price) {
        return NextResponse.json({ error: "Invalid LONG parameters: Take Profit must be above Entry Price." }, { status: 400 });
      }
    } else {
      if (stop_loss <= entry_price) {
        return NextResponse.json({ error: "Invalid SHORT parameters: Stop Loss must be above Entry Price." }, { status: 400 });
      }
      if (take_profit >= entry_price) {
        return NextResponse.json({ error: "Invalid SHORT parameters: Take Profit must be below Entry Price." }, { status: 400 });
      }
    }

    let rrRatio = parseFloat((reward / risk).toFixed(4));
    if (body.stop_loss === undefined && rrRatio < 2.0) {
      if (direction === 'LONG') {
        take_profit = parseFloat((entry_price + 2.0 * risk).toFixed(4));
      } else {
        take_profit = parseFloat((entry_price - 2.0 * risk).toFixed(4));
      }
      reward = Math.abs(take_profit - entry_price);
      rrRatio = parseFloat((reward / risk).toFixed(4));
    }

    // Sizing
    let risk_percent = 1.0;
    if (body.risk_percent !== undefined && body.risk_percent !== null) {
      risk_percent = parseFloat(body.risk_percent);
    }

    const current_balance = parseFloat(account.current_balance);
    const max_risk_limit_pct = parseFloat(account.max_risk_limit_pct);

    const risk_amount_usd = current_balance * (risk_percent / 100);
    const sl_distance = Math.abs(entry_price - stop_loss);

    const position_size = parseFloat((risk_amount_usd / sl_distance).toFixed(4));
    const newTradeRiskUsd = sl_distance * position_size;

    let currentOpenRiskUsd = 0;
    for (const t of inMemoryTrades.filter(t => t.status === "OPEN")) {
      const entry = parseFloat(t.entry_price);
      const sl = parseFloat(t.stop_loss);
      const size = parseFloat(t.position_size || 1.0);
      currentOpenRiskUsd += Math.abs(entry - sl) * size;
    }

    const proposedTotalRiskUsd = currentOpenRiskUsd + newTradeRiskUsd;
    const maxAllowedRiskUsd = current_balance * (max_risk_limit_pct / 100);

    if (proposedTotalRiskUsd > maxAllowedRiskUsd) {
      return NextResponse.json(
        { error: "[RISK_VETO: PORTFOLIO_AT_CAPACITY]" },
        { status: 403 }
      );
    }

    const savedTrade = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15) + '-' + Math.random().toString(36).substring(2, 15),
      timestamp: new Date().toISOString(),
      symbol,
      direction,
      entry_price: parseFloat(entry_price.toFixed(4)),
      stop_loss: parseFloat(stop_loss.toFixed(4)),
      take_profit: parseFloat(take_profit.toFixed(4)),
      status: "OPEN",
      strategy_name,
      ai_narrative_summary: ai_narrative_summary || null,
      position_size,
      exit_price: null,
      realized_pnl: null,
      roi: null,
      risk_amount_usd,
      created_at: new Date().toISOString()
    };

    inMemoryTrades.push(savedTrade);

    const execution_parameters = {
      symbol,
      direction,
      entry_price,
      stop_loss,
      take_profit,
      status: "OPEN",
      risk_reward_ratio: rrRatio,
      risk_amount: risk,
      reward_amount: reward,
      strategy_name,
      ai_narrative_summary: ai_narrative_summary || null,
      position_size,
      risk_percent,
      risk_amount_usd
    };

    return NextResponse.json({
      success: true,
      trade_id: savedTrade.id,
      timestamp: savedTrade.timestamp,
      execution_parameters
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "In-memory fallback POST failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handlePatchFallback(req: Request, parsedBody?: any) {
  try {
    const body = parsedBody || await req.json();
    const { trade_id, status, stop_loss, take_profit } = body;

    if (!trade_id) {
      return NextResponse.json(
        { error: "Missing required fields: 'trade_id' must be provided." },
        { status: 400 }
      );
    }

    if (!status && (stop_loss !== undefined || take_profit !== undefined)) {
      const tradeIndex = inMemoryTrades.findIndex(t => t.id === trade_id);
      if (tradeIndex === -1) {
        return NextResponse.json({ error: `Trade with ID ${trade_id} not found.` }, { status: 404 });
      }
      const trade = inMemoryTrades[tradeIndex];
      if (stop_loss !== undefined) {
        trade.stop_loss = stop_loss === null ? null : parseFloat(stop_loss);
      }
      if (take_profit !== undefined) {
        trade.take_profit = take_profit === null ? null : parseFloat(take_profit);
      }
      return NextResponse.json({
        success: true,
        message: "Trade levels updated.",
        trade,
        account: inMemoryAccount
      });
    }

    if (!status) {
      return NextResponse.json(
        { error: "Missing required fields: 'status' must be provided if not updating levels." },
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

    const tradeIndex = inMemoryTrades.findIndex(t => t.id === trade_id);
    if (tradeIndex === -1) {
      return NextResponse.json({ error: `Trade with ID ${trade_id} not found.` }, { status: 404 });
    }

    const trade = inMemoryTrades[tradeIndex];
    if (uppercaseStatus === "CLOSED") {
      if (trade.status === "CLOSED") {
        return NextResponse.json({ error: `Trade with ID ${trade_id} is already CLOSED.` }, { status: 400 });
      }

      let exit_price = body.exit_price !== undefined && body.exit_price !== null 
        ? parseFloat(body.exit_price) 
        : null;

      if (exit_price === null || isNaN(exit_price)) {
        exit_price = parseFloat(trade.entry_price);
      }

      const entryPrice = parseFloat(trade.entry_price);
      const stopLoss = parseFloat(trade.stop_loss);
      const positionSize = parseFloat(trade.position_size ?? 1.0);
      const direction = trade.direction;

      const rawRiskAmountUsd = trade.risk_amount_usd !== null && trade.risk_amount_usd !== undefined ? parseFloat(trade.risk_amount_usd) : 0;
      const riskAmountUsd = rawRiskAmountUsd > 0 ? rawRiskAmountUsd : Math.abs(entryPrice - stopLoss) * positionSize;

      let realized_pnl = direction === "LONG"
        ? (exit_price - entryPrice) * positionSize
        : (entryPrice - exit_price) * positionSize;

      let roi = riskAmountUsd > 0 ? (realized_pnl / riskAmountUsd) * 100 : 0;

      trade.exit_price = parseFloat(exit_price.toFixed(4));
      trade.realized_pnl = parseFloat(realized_pnl.toFixed(4));
      trade.roi = parseFloat(roi.toFixed(4));
      trade.status = "CLOSED";

      const initialCapital = parseFloat(inMemoryAccount.initial_capital);
      const totalRealizedPnl = inMemoryTrades
        .filter(t => t.status === "CLOSED")
        .reduce((sum, t) => sum + parseFloat(t.realized_pnl || 0), 0);
      
      inMemoryAccount.current_balance = parseFloat((initialCapital + totalRealizedPnl).toFixed(4));
      inMemoryAccount.updated_at = new Date().toISOString();
    } else {
      trade.status = uppercaseStatus;
    }

    return NextResponse.json({
      success: true,
      message: `Trade status updated to ${uppercaseStatus}.`,
      trade,
      account: inMemoryAccount
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "In-memory fallback PATCH failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleDeleteFallback(req: Request) {
  try {
    let trade_id: string | null = null;
    const url = new URL(req.url);
    trade_id = url.searchParams.get("trade_id") || url.searchParams.get("id");

    if (!trade_id) {
      try {
        const body = await req.json();
        trade_id = body.trade_id || body.id;
      } catch {}
    }

    if (!trade_id) {
      return NextResponse.json({ error: "Missing required parameter: 'trade_id' is required to delete." }, { status: 400 });
    }

    const tradeIndex = inMemoryTrades.findIndex(t => t.id === trade_id);
    if (tradeIndex === -1) {
      return NextResponse.json({ error: `Trade with ID ${trade_id} not found.` }, { status: 404 });
    }

    inMemoryTrades.splice(tradeIndex, 1);

    const initialCapital = parseFloat(inMemoryAccount.initial_capital);
    const totalRealizedPnl = inMemoryTrades
      .filter(t => t.status === "CLOSED")
      .reduce((sum, t) => sum + parseFloat(t.realized_pnl || 0), 0);
    
    inMemoryAccount.current_balance = parseFloat((initialCapital + totalRealizedPnl).toFixed(4));
    inMemoryAccount.updated_at = new Date().toISOString();

    return NextResponse.json({
      success: true,
      message: "Trade successfully purged from local memory.",
      deleted_id: trade_id,
      account: inMemoryAccount
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "In-memory fallback DELETE failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


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

// Self-healing trading_account database schema generator
async function initAccountTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS trading_account (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL UNIQUE,
        current_balance DECIMAL(18, 4) NOT NULL,
        initial_capital DECIMAL(18, 4) NOT NULL,
        max_risk_limit_pct DECIMAL(5, 2) NOT NULL DEFAULT 3.00,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (error) {
    console.error("[PAPER TRADES API] Database table 'trading_account' initialization failed:", error);
    throw error;
  }
}

// Helper to fetch or seed accounts with $10,000 for a user
async function getOrCreateAccount(userEmail: string) {
  await initAccountTable();
  let accountRes = await sql`
    SELECT * FROM trading_account WHERE user_id = ${userEmail} LIMIT 1
  `;
  if (accountRes.rows.length === 0) {
    accountRes = await sql`
      INSERT INTO trading_account (user_id, current_balance, initial_capital, max_risk_limit_pct)
      VALUES (${userEmail}, 10000.0000, 10000.0000, 3.00)
      RETURNING *
    `;
  }
  return accountRes.rows[0];
}

// Self-healing database schema generator
async function initTradesTable() {
  try {
    // Ensure account table is initialized
    await initAccountTable();

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
    
    // Self-healing table alterations for V8.3 P&L and sizing metrics
    await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS position_size DECIMAL(18, 4) DEFAULT 1.0000;`;
    await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS exit_price DECIMAL(18, 4);`;
    await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS realized_pnl DECIMAL(18, 4);`;
    await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS roi DECIMAL(18, 4);`;
    await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS risk_amount_usd DECIMAL(18, 2);`;
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
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized: No active session." },
      { status: 401 }
    );
  }

  const userEmail = session.user.email || "default_user";

  if (isDbOffline) {
    return handlePostFallback(req, userEmail);
  }

  let parsedBody: any = null;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON payload." }, { status: 400 });
  }

  try {
    try {
      await initTradesTable();
    } catch (dbError) {
      return NextResponse.json(
        { error: "Database self-healing initialization failed." },
        { status: 500 }
      );
    }

    // ── 2b. Backend Directional Guard (GLOBAL_LOCK Veto) ────────────────────
    try {
      const openCheckRes = await sql`
        SELECT COUNT(*) AS count FROM paper_trades WHERE status = 'OPEN'
      `;
      const openCount = parseInt(openCheckRes.rows[0]?.count || "0", 10);
      if (openCount > 0) {
        return NextResponse.json(
          { error: "GLOBAL_LOCK: An active trade is already in progress. Close it before initiating new setups." },
          { status: 403 }
        );
      }
    } catch (guardError) {
      console.error("[PAPER TRADES API] Directional Guard DB check failed:", guardError);
      return NextResponse.json(
        { error: "Database error during Global Lock verification." },
        { status: 500 }
      );
    }

    // ── 3. Parse and Validate Request Payload ──────────────────────────────
    const body = parsedBody;
    const { symbol, direction, strategy_name, ai_narrative_summary, ipda_metrics, sl_logic, tp_logic } = body;

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

    if (!ipda_metrics && body.stop_loss === undefined) {
      return NextResponse.json(
        { error: "Missing required 'ipda_metrics' JSON payload." },
        { status: 400 }
      );
    }

    // ── 4. Resolve Current Market Price ─────────────────────────────────────
    const current_market_price = body.current_price
      || body.currentPrice
      || ipda_metrics?.pricing_context?.local_dealing_range?.currentLivePrice
      || (Array.isArray(ipda_metrics?.data_payload?.candles_5m) && ipda_metrics.data_payload.candles_5m.length > 0
          ? ipda_metrics.data_payload.candles_5m[ipda_metrics.data_payload.candles_5m.length - 1].c
          : null)
      || (Array.isArray(body.data_payload?.candles_5m) && body.data_payload.candles_5m.length > 0
          ? body.data_payload.candles_5m[body.data_payload.candles_5m.length - 1].c
          : null);

    // ── 5. Resolve Entry Price ──────────────────────────────────────────────
    let entry_price = body.entry_price !== undefined && body.entry_price !== null ? body.entry_price : body.price;

    if (entry_price === undefined || entry_price === null) {
      // 1st Fallback: Fetch fresh live Binance price directly from REST API
      try {
        const sanitizedSymbol = symbol.replace('.p', '').replace('.P', '').toUpperCase();
        const binanceUrl = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sanitizedSymbol}`;
        const binanceRes = await fetch(binanceUrl);
        if (binanceRes.ok) {
          const binanceData = await binanceRes.json();
          const livePrice = parseFloat(binanceData.price);
          if (livePrice && !isNaN(livePrice)) {
            entry_price = livePrice;
            console.log(`[Trades API] Successfully fetched fresh Binance price for ${sanitizedSymbol}: ${livePrice}`);
          }
        } else {
          console.warn(`[Trades API] Binance price fetch returned status ${binanceRes.status}`);
        }
      } catch (err) {
        console.error("[Trades API] Failed to fetch live Binance price fallback:", err);
      }

      // 2nd Fallback: closest FVG Consequent Encroachment (stale)
      if (entry_price === undefined || entry_price === null) {
        const fvg_ce = ipda_metrics?.trade_execution_parameters?.closest_active_fvg_ce;
        if (fvg_ce !== undefined && fvg_ce !== null && !isNaN(fvg_ce)) {
          entry_price = fvg_ce;
        } else if (current_market_price !== undefined && current_market_price !== null && !isNaN(current_market_price)) {
          // 3rd Fallback: Stale market price
          entry_price = current_market_price;
        }
      }
    }

    if (entry_price === undefined || entry_price === null || isNaN(entry_price)) {
      return NextResponse.json(
        { error: "Could not determine Entry Price. Provide 'entry_price' or ensure a valid market price/FVG CE exists." },
        { status: 400 }
      );
    }

    entry_price = parseFloat(entry_price.toFixed(4));

    // ── 6. Stop Loss Calculation based on sl_logic ───────────────────────────
    const tickIncrement = 0.05;
    let stop_loss: number | null = null;

    if (body.stop_loss !== undefined && body.stop_loss !== null) {
      stop_loss = parseFloat(body.stop_loss);
    } else {
      const slMode = sl_logic || 'Structural Swing';

      if (slMode === 'Manual Pips') {
        if (direction === 'LONG') {
          stop_loss = parseFloat((entry_price - 10.00).toFixed(4));
        } else {
          stop_loss = parseFloat((entry_price + 10.00).toFixed(4));
        }
      } else if (slMode === 'Last Candle High/Low') {
        const candles = ipda_metrics?.data_payload?.candles_5m || body.data_payload?.candles_5m || [];
        const lastCandle = candles.length >= 2 ? candles[candles.length - 2] : null;

        if (lastCandle) {
          if (direction === 'LONG') {
            stop_loss = parseFloat((lastCandle.l - tickIncrement).toFixed(4));
          } else {
            stop_loss = parseFloat((lastCandle.h + tickIncrement).toFixed(4));
          }
        } else {
          // Fallback to structural swing if candles not available
          const hardInvalidation = ipda_metrics?.trade_execution_parameters?.hard_invalidation_levels;
          if (direction === 'LONG') {
            const bullish_invalidation = hardInvalidation?.bullish_invalidation;
            if (bullish_invalidation !== undefined && bullish_invalidation !== null) {
              stop_loss = parseFloat((bullish_invalidation - tickIncrement).toFixed(4));
            }
          } else {
            const bearish_invalidation = hardInvalidation?.bearish_invalidation;
            if (bearish_invalidation !== undefined && bearish_invalidation !== null) {
              stop_loss = parseFloat((bearish_invalidation + tickIncrement).toFixed(4));
            }
          }
        }
      }

      // Default or Fallback to Structural Swing
      if (stop_loss === null) {
        const hardInvalidation = ipda_metrics?.trade_execution_parameters?.hard_invalidation_levels;
        if (direction === "LONG") {
          const bullish_invalidation = hardInvalidation?.bullish_invalidation;
          if (bullish_invalidation === undefined || bullish_invalidation === null) {
            return NextResponse.json(
              { error: "Missing hard invalidation level (bullish_invalidation) required for LONG trade SL." },
              { status: 400 }
            );
          }
          stop_loss = parseFloat((bullish_invalidation - tickIncrement).toFixed(4));
        } else {
          const bearish_invalidation = hardInvalidation?.bearish_invalidation;
          if (bearish_invalidation === undefined || bearish_invalidation === null) {
            return NextResponse.json(
              { error: "Missing hard invalidation level (bearish_invalidation) required for SHORT trade SL." },
              { status: 400 }
            );
          }
          stop_loss = parseFloat((bearish_invalidation + tickIncrement).toFixed(4));
        }
      }
    }

    if (stop_loss === null || isNaN(stop_loss)) {
      return NextResponse.json(
        { error: "Could not calculate a valid Stop Loss level." },
        { status: 400 }
      );
    }

    // ── 7. Take Profit Calculation based on tp_logic ────────────────────────
    let take_profit = body.take_profit;
    const tpMode = tp_logic || 'Nearest Order Book Magnet';

    if (take_profit === undefined || take_profit === null) {
      if (tpMode === 'Manual Pips') {
        const risk = Math.abs(entry_price - stop_loss);
        if (direction === 'LONG') {
          take_profit = parseFloat((entry_price + 2 * risk).toFixed(4));
        } else {
          take_profit = parseFloat((entry_price - 2 * risk).toFixed(4));
        }
      } else if (tpMode === 'PDH/PDL Target') {
        const macro = ipda_metrics?.macro_levels || {};
        const pdh = macro.pdh || ipda_metrics?.pdh || 0;
        const pdl = macro.pdl || ipda_metrics?.pdl || 0;

        if (direction === 'LONG' && pdh > 0) {
          take_profit = parseFloat(pdh.toFixed(4));
        } else if (direction === 'SHORT' && pdl > 0) {
          take_profit = parseFloat(pdl.toFixed(4));
        }
      }

      // Default or Fallback to Nearest Order Book Magnet
      if (take_profit === undefined || take_profit === null) {
        const orderFlow = ipda_metrics?.order_flow_engine;
        const restingLiquidity = orderFlow?.resting_liquidity_pools;
        const magnets = direction === "LONG"
          ? (restingLiquidity?.BSL_Magnets || [])
          : (restingLiquidity?.SSL_Magnets || []);
        
        take_profit = getBestMagnet(magnets, entry_price, stop_loss, direction);
      }
    }

    // Self-healing take profit resolution
    if (take_profit === undefined || take_profit === null || isNaN(take_profit)) {
      const risk = Math.abs(entry_price - stop_loss);
      if (direction === 'LONG') {
        take_profit = parseFloat((entry_price + 2.0 * risk).toFixed(4));
      } else {
        take_profit = parseFloat((entry_price - 2.0 * risk).toFixed(4));
      }
    }

    take_profit = parseFloat(take_profit.toFixed(4));

    // ── 8. Risk-to-Reward Ratio Validation Gate ────────────────────────────
    const risk = Math.abs(entry_price - stop_loss);
    let reward = Math.abs(take_profit - entry_price);

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

    let rrRatio = parseFloat((reward / risk).toFixed(4));

    // If calculated setup ratio is inefficient (e.g. dynamic PDH sweep target is too close),
    // automatically scale the Take Profit target outward to satisfy the strict >= 2.0 RR threshold
    // instead of throwing an execution abort error.
    if (body.stop_loss === undefined && rrRatio < 2.0) {
      if (direction === 'LONG') {
        take_profit = parseFloat((entry_price + 2.0 * risk).toFixed(4));
      } else {
        take_profit = parseFloat((entry_price - 2.0 * risk).toFixed(4));
      }
      reward = Math.abs(take_profit - entry_price);
      rrRatio = parseFloat((reward / risk).toFixed(4));
    }

    // ── 9. Portfolio-Aware Position Sizing Math (V8.8) ──────────────────────
    // Retrieve strategy-specific risk percent (fallbacks: body parameter → database lookup → default 1.0)
    let risk_percent = 1.0;
    if (body.risk_percent !== undefined && body.risk_percent !== null) {
      risk_percent = parseFloat(body.risk_percent);
    } else if (strategy_name) {
      try {
        const stratResult = await sql`
          SELECT logic_json FROM custom_strategies 
          WHERE name = ${strategy_name} 
          LIMIT 1
        `;
        if (stratResult.rows.length > 0) {
          const logic = stratResult.rows[0].logic_json;
          if (logic && typeof logic === 'object' && !Array.isArray(logic)) {
            risk_percent = parseFloat((logic as any).risk_percent ?? 1.0);
          }
        }
      } catch (err) {
        console.error("[PAPER TRADES API] Failed to fetch strategy risk_percent from DB:", err);
      }
    }

    // Retrieve persistent account status for dynamic sizing and risk exposure calculations
    const userEmail = session.user.email || "default_user";
    const account = await getOrCreateAccount(userEmail);
    const current_balance = parseFloat(account.current_balance);
    const max_risk_limit_pct = parseFloat(account.max_risk_limit_pct);

    // Dynamic position sizing based on real balance from database
    const risk_amount_usd = current_balance * (risk_percent / 100);
    const sl_distance = Math.abs(entry_price - stop_loss);

    if (sl_distance === 0) {
      return NextResponse.json(
        { error: "Stop Loss distance cannot be zero." },
        { status: 400 }
      );
    }

    const position_size = parseFloat((risk_amount_usd / sl_distance).toFixed(4));

    // ── 9b. Global Portfolio Risk Guard Veto Gate (V8.4) ────────────────────
    const newTradeRiskUsd = sl_distance * position_size;

    // Calculate sum of Risk Amount for all currently OPEN trades
    const openTradesRes = await sql`
      SELECT entry_price, stop_loss, position_size FROM paper_trades
      WHERE status = 'OPEN'
    `;
    let currentOpenRiskUsd = 0;
    for (const row of openTradesRes.rows) {
      const entry = parseFloat(row.entry_price);
      const sl = parseFloat(row.stop_loss);
      const size = parseFloat(row.position_size || 1.0);
      currentOpenRiskUsd += Math.abs(entry - sl) * size;
    }

    // Reject trade if (Current Open Risk + New Trade Risk) > max_risk_limit_pct of portfolio
    const proposedTotalRiskUsd = currentOpenRiskUsd + newTradeRiskUsd;
    const maxAllowedRiskUsd = current_balance * (max_risk_limit_pct / 100);

    if (proposedTotalRiskUsd > maxAllowedRiskUsd) {
      console.warn(`[RISK_VETO: PORTFOLIO_AT_CAPACITY] Rejecting trade. Proposed: $${proposedTotalRiskUsd.toFixed(2)}, Allowed: $${maxAllowedRiskUsd.toFixed(2)}.`);
      return NextResponse.json(
        { error: "[RISK_VETO: PORTFOLIO_AT_CAPACITY]" },
        { status: 403 }
      );
    }

    // ── 9c. One-Trade Rule (Server-Side Guard, V8.5) ─────────────────────────
    // Reject if a trade with the same strategy_name is already OPEN or PAUSED.
    const existingActiveTradeRes = await sql`
      SELECT id FROM paper_trades
      WHERE strategy_name = ${strategy_name}
        AND status IN ('OPEN', 'PAUSED')
      LIMIT 1
    `;
    if (existingActiveTradeRes.rows.length > 0) {
      return NextResponse.json(
        { error: "[ENTRY_BLOCKED: ONE_TRADE_RULE] This strategy already has an active open position. Close it before opening a new one." },
        { status: 409 }
      );
    }

    // ── 10. Persist Trade Execution ──────────────────────────────────────────
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
        ai_narrative_summary,
        position_size,
        risk_amount_usd
      ) VALUES (
        ${symbol},
        ${direction},
        ${entry_price},
        ${stop_loss},
        ${take_profit},
        ${status},
        ${strategy_name},
        ${ai_narrative_summary || null},
        ${position_size},
        ${risk_amount_usd}
      ) RETURNING id, timestamp;
    `;

    const savedTrade = dbResult.rows[0];

    // ── 11. Construct and Return Success Response ───────────────────────────
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
      ai_narrative_summary: ai_narrative_summary || null,
      position_size,
      risk_percent,
      risk_amount_usd
    };

    return NextResponse.json({
      success: true,
      trade_id: savedTrade.id,
      timestamp: savedTrade.timestamp,
      execution_parameters
    });

  } catch (error: unknown) {
    console.error("[PAPER TRADES API] POST Handler Failed:", error);
    console.warn("[PAPER TRADES API] DB connection error during POST. Activating in-memory fallback.");
    isDbOffline = true;
    return handlePostFallback(req, userEmail, parsedBody);
  }
}

// ─── GET: Fetch all paper trades ordered by created_at DESC ───────────────────
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized: No active session." },
      { status: 401 }
    );
  }

  const userEmail = session.user.email || "default_user";

  if (isDbOffline) {
    return handleGetFallback(userEmail);
  }

  try {
    // Ensure database table is verified
    await initTradesTable();
    const account = await getOrCreateAccount(userEmail);

    const { rows } = await sql`
      SELECT * FROM paper_trades
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ success: true, trades: rows, account });
  } catch (error: unknown) {
    console.error("[PAPER TRADES API] GET Error:", error);
    console.warn("[PAPER TRADES API] DB connection error during GET. Activating in-memory fallback.");
    isDbOffline = true;
    return handleGetFallback(userEmail);
  }
}

// ─── PATCH: Update manual trade status (OPEN, CLOSED, PAUSED) ────────────────
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized: No active session." },
      { status: 401 }
    );
  }

  if (isDbOffline) {
    return handlePatchFallback(req);
  }

  let parsedBody: any = null;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON payload." }, { status: 400 });
  }

  try {
    const body = parsedBody;
    const { trade_id, status, stop_loss, take_profit } = body;

    if (!trade_id) {
      return NextResponse.json(
        { error: "Missing required fields: 'trade_id' must be provided." },
        { status: 400 }
      );
    }

    if (!status && (stop_loss !== undefined || take_profit !== undefined)) {
      await initTradesTable();
      const userEmail = session.user.email || "default_user";
      let updateResult;

      if (stop_loss !== undefined && take_profit !== undefined) {
        updateResult = await sql`
          UPDATE paper_trades
          SET stop_loss = ${stop_loss === null ? null : parseFloat(stop_loss)},
              take_profit = ${take_profit === null ? null : parseFloat(take_profit)}
          WHERE id = ${trade_id}
          RETURNING *;
        `;
      } else if (stop_loss !== undefined) {
        updateResult = await sql`
          UPDATE paper_trades
          SET stop_loss = ${stop_loss === null ? null : parseFloat(stop_loss)}
          WHERE id = ${trade_id}
          RETURNING *;
        `;
      } else {
        updateResult = await sql`
          UPDATE paper_trades
          SET take_profit = ${take_profit === null ? null : parseFloat(take_profit)}
          WHERE id = ${trade_id}
          RETURNING *;
        `;
      }

      if (updateResult.rows.length === 0) {
        return NextResponse.json(
          { error: `Trade with ID ${trade_id} not found.` },
          { status: 404 }
        );
      }

      const updatedAccount = await getOrCreateAccount(userEmail);
      return NextResponse.json({
        success: true,
        message: "Trade levels updated.",
        trade: updateResult.rows[0],
        account: updatedAccount
      });
    }

    if (!status) {
      return NextResponse.json(
        { error: "Missing required fields: 'status' must be provided if not updating levels." },
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
    const userEmail = session.user.email || "default_user";

    let updateResult;

    if (uppercaseStatus === "CLOSED") {
      // Execute all operations inside an atomic transaction to prevent data race conditions
      await sql`BEGIN`;
      try {
        // 1. Fetch trade parameters to calculate realized P&L
        const tradeResult = await sql`
          SELECT entry_price, stop_loss, direction, position_size, risk_amount_usd, status FROM paper_trades
          WHERE id = ${trade_id}
          LIMIT 1
        `;
        if (tradeResult.rows.length === 0) {
          await sql`ROLLBACK`;
          return NextResponse.json(
            { error: `Trade with ID ${trade_id} not found.` },
            { status: 404 }
          );
        }
        
        const trade = tradeResult.rows[0];

        if (trade.status === "CLOSED") {
          await sql`ROLLBACK`;
          return NextResponse.json(
            { error: `Trade with ID ${trade_id} is already CLOSED.` },
            { status: 400 }
          );
        }

        // 2. Resolve exit price (passed from body or fallback to entry_price)
        let exit_price = body.exit_price !== undefined && body.exit_price !== null 
          ? parseFloat(body.exit_price) 
          : null;

        if (exit_price === null || isNaN(exit_price)) {
          exit_price = parseFloat(trade.entry_price);
        }

        const entryPrice = parseFloat(trade.entry_price);
        const stopLoss = parseFloat(trade.stop_loss);
        const positionSize = parseFloat(trade.position_size ?? 1.0);
        const direction = trade.direction;

        // Fallback for legacy trades without risk_amount_usd
        const rawRiskAmountUsd = trade.risk_amount_usd !== null && trade.risk_amount_usd !== undefined ? parseFloat(trade.risk_amount_usd) : 0;
        const riskAmountUsd = rawRiskAmountUsd > 0 ? rawRiskAmountUsd : Math.abs(entryPrice - stopLoss) * positionSize;

        // 3. Calculate Realized P&L
        let realized_pnl = direction === "LONG"
          ? (exit_price - entryPrice) * positionSize
          : (entryPrice - exit_price) * positionSize;

        // 4. Calculate ROI Percentage based on risk taken
        let roi = riskAmountUsd > 0
          ? (realized_pnl / riskAmountUsd) * 100
          : 0;

        exit_price = parseFloat(exit_price.toFixed(4));
        realized_pnl = parseFloat(realized_pnl.toFixed(4));
        roi = parseFloat(roi.toFixed(4));

        // 6. Update trade record with closed parameters FIRST (so it's included in the P&L SUM)
        updateResult = await sql`
          UPDATE paper_trades
          SET status = ${uppercaseStatus},
              exit_price = ${exit_price},
              realized_pnl = ${realized_pnl},
              roi = ${roi}
          WHERE id = ${trade_id}
          RETURNING *;
        `;

        // 7. Recalculate balance from scratch: initial_capital + SUM(all CLOSED realized_pnl)
        // V8.5 — Deterministic formula prevents ghost profits from delta drift.
        const accountForCapital = await sql`
          SELECT initial_capital FROM trading_account
          WHERE user_id = ${userEmail}
        `;
        const initialCapital = parseFloat(String(accountForCapital.rows[0]?.initial_capital ?? 10000));

        const pnlSumRes = await sql`
          SELECT COALESCE(SUM(realized_pnl), 0) AS total_realized_pnl
          FROM paper_trades
          WHERE status = 'CLOSED'
        `;
        const totalRealizedPnl = parseFloat(String(pnlSumRes.rows[0].total_realized_pnl));
        const newBalance = parseFloat((initialCapital + totalRealizedPnl).toFixed(4));

        // 8. Update current_balance in the trading_account
        await sql`
          UPDATE trading_account
          SET current_balance = ${newBalance},
              updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ${userEmail}
        `;


        await sql`COMMIT`;
      } catch (txErr) {
        await sql`ROLLBACK`;
        throw txErr;
      }
    } else {
      // Status change to other values (OPEN / PAUSED)
      updateResult = await sql`
        UPDATE paper_trades
        SET status = ${uppercaseStatus}
        WHERE id = ${trade_id}
        RETURNING *;
      `;
    }

    if (updateResult.rows.length === 0) {
      return NextResponse.json(
        { error: `Trade with ID ${trade_id} not found.` },
        { status: 404 }
      );
    }

    const updatedAccount = await getOrCreateAccount(userEmail);

    return NextResponse.json({
      success: true,
      message: `Trade status updated to ${uppercaseStatus}.`,
      trade: updateResult.rows[0],
      account: updatedAccount
    });
  } catch (error: unknown) {
    console.error("[PAPER TRADES API] PATCH Error:", error);
    console.warn("[PAPER TRADES API] DB connection error during PATCH. Activating in-memory fallback.");
    isDbOffline = true;
    return handlePatchFallback(req, parsedBody);
  }
}

// ─── DELETE: Surgery row purge from database ──────────────────────────────────
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized: No active session." },
      { status: 401 }
    );
  }

  if (isDbOffline) {
    return handleDeleteFallback(req);
  }

  try {

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

    // V8.5 — Recalculate full balance after DELETE to remove any ghost profits
    const userEmail = session.user.email || "default_user";
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

    // Recalculate account balance from scratch after row removal
    const accountCapRes = await sql`
      SELECT initial_capital FROM trading_account WHERE user_id = ${userEmail}
    `;
    if (accountCapRes.rows.length > 0) {
      const initialCapital = parseFloat(String(accountCapRes.rows[0].initial_capital));
      const pnlSumRes = await sql`
        SELECT COALESCE(SUM(realized_pnl), 0) AS total_realized_pnl
        FROM paper_trades
        WHERE status = 'CLOSED'
      `;
      const totalRealizedPnl = parseFloat(String(pnlSumRes.rows[0].total_realized_pnl));
      const newBalance = parseFloat((initialCapital + totalRealizedPnl).toFixed(4));
      await sql`
        UPDATE trading_account
        SET current_balance = ${newBalance}, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ${userEmail}
      `;
    }

    const updatedAccount = await getOrCreateAccount(userEmail);

    return NextResponse.json({
      success: true,
      message: "Trade successfully purged from the database.",
      deleted_id: trade_id,
      account: updatedAccount
    });
  } catch (error: unknown) {
    console.error("[PAPER TRADES API] DELETE Error:", error);
    console.warn("[PAPER TRADES API] DB connection error during DELETE. Activating in-memory fallback.");
    isDbOffline = true;
    return handleDeleteFallback(req);
  }
}

