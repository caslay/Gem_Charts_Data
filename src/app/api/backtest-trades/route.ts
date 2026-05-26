import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

/**
 * Automated Backtesting Trading Journal API Endpoint (Phase 1)
 *
 * GET/POST/PATCH/DELETE /api/backtest-trades
 *
 * Isolated persistence layer mirroring paper trading mechanics.
 */

// Self-healing backtest_trading_account database schema generator
async function initAccountTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS backtest_trading_account (
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
    console.error("[BACKTEST TRADES API] Database table 'backtest_trading_account' initialization failed:", error);
    throw error;
  }
}

// Helper to fetch or seed accounts with $10,000 for a user
async function getOrCreateAccount(userEmail: string) {
  await initAccountTable();
  let accountRes = await sql`
    SELECT * FROM backtest_trading_account WHERE user_id = ${userEmail} LIMIT 1
  `;
  if (accountRes.rows.length === 0) {
    accountRes = await sql`
      INSERT INTO backtest_trading_account (user_id, current_balance, initial_capital, max_risk_limit_pct)
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
      CREATE TABLE IF NOT EXISTS backtest_trades (
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
    
    // Add additional sizing and result columns
    await sql`ALTER TABLE backtest_trades ADD COLUMN IF NOT EXISTS position_size DECIMAL(18, 4) DEFAULT 1.0000;`;
    await sql`ALTER TABLE backtest_trades ADD COLUMN IF NOT EXISTS exit_price DECIMAL(18, 4);`;
    await sql`ALTER TABLE backtest_trades ADD COLUMN IF NOT EXISTS realized_pnl DECIMAL(18, 4);`;
    await sql`ALTER TABLE backtest_trades ADD COLUMN IF NOT EXISTS roi DECIMAL(18, 4);`;
    await sql`ALTER TABLE backtest_trades ADD COLUMN IF NOT EXISTS risk_amount_usd DECIMAL(18, 2);`;
  } catch (error) {
    console.error("[BACKTEST TRADES API] Self-healing table initialization failed:", error);
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

  const candidates = magnets.filter((magnet) => {
    if (direction === "LONG") {
      return magnet >= parseFloat((entryPrice + minReward).toFixed(4));
    } else {
      return magnet <= parseFloat((entryPrice - minReward).toFixed(4));
    }
  });

  if (candidates.length === 0) return null;

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
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    try {
      await initTradesTable();
    } catch (dbError) {
      return NextResponse.json(
        { error: "Database self-healing initialization failed." },
        { status: 500 }
      );
    }

    // Backend Directional Guard (GLOBAL_LOCK Veto)
    try {
      const openCheckRes = await sql`
        SELECT COUNT(*) AS count FROM backtest_trades WHERE status = 'OPEN'
      `;
      const openCount = parseInt(openCheckRes.rows[0]?.count || "0", 10);
      if (openCount > 0) {
        return NextResponse.json(
          { error: "GLOBAL_LOCK: An active backtest trade is already in progress. Close it before initiating new setups." },
          { status: 403 }
        );
      }
    } catch (guardError) {
      console.error("[BACKTEST TRADES API] Directional Guard DB check failed:", guardError);
      return NextResponse.json(
        { error: "Database error during Global Lock verification." },
        { status: 500 }
      );
    }

    const body = await req.json();
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

    if (!ipda_metrics) {
      return NextResponse.json(
        { error: "Missing required 'ipda_metrics' JSON payload." },
        { status: 400 }
      );
    }

    // Resolve current market price
    const current_market_price = body.current_price
      || body.currentPrice
      || ipda_metrics.pricing_context?.local_dealing_range?.currentLivePrice
      || (Array.isArray(ipda_metrics.data_payload?.candles_5m) && ipda_metrics.data_payload.candles_5m.length > 0
          ? ipda_metrics.data_payload.candles_5m[ipda_metrics.data_payload.candles_5m.length - 1].c
          : null);

    // Resolve entry price
    let entry_price = body.entry_price !== undefined && body.entry_price !== null ? body.entry_price : body.price;

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

    // Stop loss calculation based on sl_logic
    const tickIncrement = 0.05;
    let stop_loss: number | null = null;

    const slMode = sl_logic || 'Structural Swing';

    if (slMode === 'Manual Pips') {
      if (direction === 'LONG') {
        stop_loss = parseFloat((entry_price - 10.00).toFixed(4));
      } else {
        stop_loss = parseFloat((entry_price + 10.00).toFixed(4));
      }
    } else if (slMode === 'Last Candle High/Low') {
      const candles = ipda_metrics.data_payload?.candles_5m || [];
      const lastCandle = candles.length >= 2 ? candles[candles.length - 2] : null;

      if (lastCandle) {
        if (direction === 'LONG') {
          stop_loss = parseFloat((lastCandle.l - tickIncrement).toFixed(4));
        } else {
          stop_loss = parseFloat((lastCandle.h + tickIncrement).toFixed(4));
        }
      } else {
        const hardInvalidation = ipda_metrics.trade_execution_parameters?.hard_invalidation_levels;
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
      const hardInvalidation = ipda_metrics.trade_execution_parameters?.hard_invalidation_levels;
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
        const macro = ipda_metrics.macro_levels || {};
        const pdh = macro.pdh || ipda_metrics.pdh || 0;
        const pdl = macro.pdl || ipda_metrics.pdl || 0;

        if (direction === 'LONG' && pdh > 0) {
          take_profit = parseFloat(pdh.toFixed(4));
        } else if (direction === 'SHORT' && pdl > 0) {
          take_profit = parseFloat(pdl.toFixed(4));
        }
      }

      if (take_profit === undefined || take_profit === null) {
        const orderFlow = ipda_metrics.order_flow_engine;
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
    if (rrRatio < 2.0) {
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
        console.error("[BACKTEST TRADES API] Failed to fetch strategy risk_percent from DB:", err);
      }
    }

    const userEmail = session.user.email || "default_user";
    const account = await getOrCreateAccount(userEmail);
    const current_balance = parseFloat(account.current_balance);
    const max_risk_limit_pct = parseFloat(account.max_risk_limit_pct);

    const risk_amount_usd = current_balance * (risk_percent / 100);
    const sl_distance = Math.abs(entry_price - stop_loss);

    if (sl_distance === 0) {
      return NextResponse.json({ error: "Stop Loss distance cannot be zero." }, { status: 400 });
    }

    const position_size = parseFloat((risk_amount_usd / sl_distance).toFixed(4));
    const newTradeRiskUsd = sl_distance * position_size;

    // Check existing open backtest risk
    const openTradesRes = await sql`
      SELECT entry_price, stop_loss, position_size FROM backtest_trades
      WHERE status = 'OPEN'
    `;
    let currentOpenRiskUsd = 0;
    for (const row of openTradesRes.rows) {
      const entry = parseFloat(row.entry_price);
      const sl = parseFloat(row.stop_loss);
      const size = parseFloat(row.position_size || 1.0);
      currentOpenRiskUsd += Math.abs(entry - sl) * size;
    }

    const proposedTotalRiskUsd = currentOpenRiskUsd + newTradeRiskUsd;
    const maxAllowedRiskUsd = current_balance * (max_risk_limit_pct / 100);

    if (proposedTotalRiskUsd > maxAllowedRiskUsd) {
      console.warn(`[RISK_VETO: BACKTEST_PORTFOLIO_AT_CAPACITY] Proposed: $${proposedTotalRiskUsd.toFixed(2)}, Allowed: $${maxAllowedRiskUsd.toFixed(2)}.`);
      return NextResponse.json(
        { error: "[RISK_VETO: PORTFOLIO_AT_CAPACITY]" },
        { status: 403 }
      );
    }

    // One trade per strategy check
    const existingActiveTradeRes = await sql`
      SELECT id FROM backtest_trades
      WHERE strategy_name = ${strategy_name}
        AND status IN ('OPEN', 'PAUSED')
      LIMIT 1
    `;
    if (existingActiveTradeRes.rows.length > 0) {
      return NextResponse.json(
        { error: "[ENTRY_BLOCKED: ONE_TRADE_RULE] This strategy already has an active open backtest position." },
        { status: 409 }
      );
    }

    // Insert
    const status = "OPEN";
    const dbResult = await sql`
      INSERT INTO backtest_trades (
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
    console.error("[BACKTEST TRADES API] POST Handler Failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error during trade logging.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    await initTradesTable();

    const userEmail = session.user.email || "default_user";
    const account = await getOrCreateAccount(userEmail);

    const { rows } = await sql`
      SELECT * FROM backtest_trades
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ success: true, trades: rows, account });
  } catch (error: unknown) {
    console.error("[BACKTEST TRADES API] GET Error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch backtest trades.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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
    const userEmail = session.user.email || "default_user";

    let updateResult;

    if (uppercaseStatus === "CLOSED") {
      await sql`BEGIN`;
      try {
        const tradeResult = await sql`
          SELECT entry_price, stop_loss, direction, position_size, risk_amount_usd, status FROM backtest_trades
          WHERE id = ${trade_id}
          LIMIT 1
        `;
        if (tradeResult.rows.length === 0) {
          await sql`ROLLBACK`;
          return NextResponse.json({ error: `Trade with ID ${trade_id} not found.` }, { status: 404 });
        }
        
        const trade = tradeResult.rows[0];

        if (trade.status === "CLOSED") {
          await sql`ROLLBACK`;
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

        exit_price = parseFloat(exit_price.toFixed(4));
        realized_pnl = parseFloat(realized_pnl.toFixed(4));
        roi = parseFloat(roi.toFixed(4));

        updateResult = await sql`
          UPDATE backtest_trades
          SET status = ${uppercaseStatus},
              exit_price = ${exit_price},
              realized_pnl = ${realized_pnl},
              roi = ${roi}
          WHERE id = ${trade_id}
          RETURNING *;
        `;

        const accountForCapital = await sql`
          SELECT initial_capital FROM backtest_trading_account
          WHERE user_id = ${userEmail}
        `;
        const initialCapital = parseFloat(String(accountForCapital.rows[0]?.initial_capital ?? 10000));

        const pnlSumRes = await sql`
          SELECT COALESCE(SUM(realized_pnl), 0) AS total_realized_pnl
          FROM backtest_trades
          WHERE status = 'CLOSED'
        `;
        const totalRealizedPnl = parseFloat(String(pnlSumRes.rows[0].total_realized_pnl));
        const newBalance = parseFloat((initialCapital + totalRealizedPnl).toFixed(4));

        await sql`
          UPDATE backtest_trading_account
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
      updateResult = await sql`
        UPDATE backtest_trades
        SET status = ${uppercaseStatus}
        WHERE id = ${trade_id}
        RETURNING *;
      `;
    }

    if (updateResult.rows.length === 0) {
      return NextResponse.json({ error: `Trade with ID ${trade_id} not found.` }, { status: 404 });
    }

    const updatedAccount = await getOrCreateAccount(userEmail);

    return NextResponse.json({
      success: true,
      message: `Trade status updated to ${uppercaseStatus}.`,
      trade: updateResult.rows[0],
      account: updatedAccount
    });
  } catch (error: unknown) {
    console.error("[BACKTEST TRADES API] PATCH Error:", error);
    const message = error instanceof Error ? error.message : "Failed to update trade status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

    const userEmail = session.user.email || "default_user";
    await initTradesTable();

    const deleteResult = await sql`
      DELETE FROM backtest_trades
      WHERE id = ${trade_id}
      RETURNING id;
    `;

    if (deleteResult.rows.length === 0) {
      return NextResponse.json({ error: `Trade with ID ${trade_id} not found.` }, { status: 404 });
    }

    const accountCapRes = await sql`
      SELECT initial_capital FROM backtest_trading_account WHERE user_id = ${userEmail}
    `;
    if (accountCapRes.rows.length > 0) {
      const initialCapital = parseFloat(String(accountCapRes.rows[0].initial_capital));
      const pnlSumRes = await sql`
        SELECT COALESCE(SUM(realized_pnl), 0) AS total_realized_pnl
        FROM backtest_trades
        WHERE status = 'CLOSED'
      `;
      const totalRealizedPnl = parseFloat(String(pnlSumRes.rows[0].total_realized_pnl));
      const newBalance = parseFloat((initialCapital + totalRealizedPnl).toFixed(4));
      await sql`
        UPDATE backtest_trading_account
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
    console.error("[BACKTEST TRADES API] DELETE Error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete trade.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
