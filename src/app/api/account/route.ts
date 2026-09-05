import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/postgres";
import { getBinanceAccountInfo } from "@/lib/binanceFuturesClient";
import { GlobalRiskGovernor } from "@/lib/risk/GlobalRiskGovernor";

// In-memory fallback account storage for offline mode / local development
interface TradingAccountRecord {
  id: string;
  user_id: string;
  current_balance: string | number;
  initial_capital: string | number;
  max_risk_limit_pct: string | number;
  risk_per_trade_pct?: string | number;
  max_daily_loss_pct?: string | number;
  max_daily_loss_usd?: string | number;
  max_consecutive_losses?: number;
  max_daily_trades?: number;
  daily_realized_pnl?: string | number;
  consecutive_losses_count?: number;
  circuit_breaker_active?: boolean;
  circuit_breaker_reason?: string | null;
  circuit_breaker_tripped_at?: string | null;
  circuit_breaker_reset_at?: string | null;
  is_live?: boolean;
  available_balance?: string | number;
  total_unrealized_profit?: string | number;
  created_at?: string;
  updated_at?: string;
}

const inMemoryAccounts: Map<string, TradingAccountRecord> = new Map();

function getFallbackAccount(userEmail: string): TradingAccountRecord {
  if (!inMemoryAccounts.has(userEmail)) {
    inMemoryAccounts.set(userEmail, {
      id: `acc_mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      user_id: userEmail,
      current_balance: "10000.0000",
      initial_capital: "10000.0000",
      max_risk_limit_pct: "3.00",
      risk_per_trade_pct: "2.00",
      max_daily_loss_pct: "4.00",
      max_daily_loss_usd: "400.00",
      max_consecutive_losses: 3,
      max_daily_trades: 6,
      daily_realized_pnl: "0.00",
      consecutive_losses_count: 0,
      circuit_breaker_active: false,
      circuit_breaker_reason: null,
      circuit_breaker_tripped_at: null,
      circuit_breaker_reset_at: null,
      is_live: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  return inMemoryAccounts.get(userEmail)!;
}

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
    // Self-healing columns for Phase 4 Global Risk Governor
    await sql`ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS risk_per_trade_pct DECIMAL(5, 2) NOT NULL DEFAULT 2.00;`;
    await sql`ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS max_daily_loss_pct DECIMAL(5, 2) NOT NULL DEFAULT 4.00;`;
    await sql`ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS max_daily_loss_usd DECIMAL(18, 4) NOT NULL DEFAULT 400.00;`;
    await sql`ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS max_consecutive_losses INTEGER NOT NULL DEFAULT 3;`;
    await sql`ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS max_daily_trades INTEGER NOT NULL DEFAULT 6;`;
    await sql`ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS daily_realized_pnl DECIMAL(18, 4) NOT NULL DEFAULT 0.00;`;
    await sql`ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS consecutive_losses_count INTEGER NOT NULL DEFAULT 0;`;
    await sql`ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS circuit_breaker_active BOOLEAN NOT NULL DEFAULT FALSE;`;
    await sql`ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS circuit_breaker_reason TEXT;`;
    await sql`ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS circuit_breaker_tripped_at TIMESTAMP WITH TIME ZONE;`;
    await sql`ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS circuit_breaker_reset_at TIMESTAMP WITH TIME ZONE;`;
  } catch (error: any) {
    console.warn("[ACCOUNT API] Postgres table initialization skipped (offline fallback):", error?.message || error);
  }
}

// Helper to fetch or seed accounts
async function getOrCreateAccount(userEmail: string) {
  try {
    await initAccountTable();
    let accountRes = await sql`
      SELECT * FROM trading_account WHERE user_id = ${userEmail} LIMIT 1
    `;
    if (accountRes.rows.length === 0) {
      accountRes = await sql`
        INSERT INTO trading_account (
          user_id, current_balance, initial_capital, max_risk_limit_pct,
          risk_per_trade_pct, max_daily_loss_pct, max_daily_loss_usd,
          max_consecutive_losses, max_daily_trades
        )
        VALUES (
          ${userEmail}, 10000.0000, 10000.0000, 3.00,
          2.00, 4.00, 400.00,
          3, 6
        )
        RETURNING *
      `;
      console.log(`[ACCOUNT API] Seeded new trading account for user: ${userEmail} with $10,000.`);
    }
    const acc = accountRes.rows[0];
    inMemoryAccounts.set(userEmail, acc as TradingAccountRecord);
    return { account: acc, isOffline: false };
  } catch (dbErr: any) {
    console.warn(`[ACCOUNT API] Database unavailable. Serving from in-memory store:`, dbErr?.message || dbErr);
    const fallback = getFallbackAccount(userEmail);
    return { account: fallback, isOffline: true };
  }
}

export async function GET() {
  try {
    const session = await auth();
    const userEmail = session?.user?.email || "default_user";

    // 1. If Binance API credentials exist (Live VPS mode), hydrate directly from live exchange
    if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
      const binanceInfo = await getBinanceAccountInfo();
      if (binanceInfo && binanceInfo.totalWalletBalance > 0) {
        const liveBalanceStr = binanceInfo.totalWalletBalance.toFixed(4);
        const liveAvailableStr = binanceInfo.availableBalance.toFixed(4);
        const liveUnrealizedStr = binanceInfo.totalUnrealizedProfit.toFixed(4);

        // Fetch risk parameters from database/memory
        const { account: dbAccount } = await getOrCreateAccount(userEmail);

        const liveAccount = {
          id: `binance_live_${userEmail}`,
          user_id: userEmail,
          current_balance: liveBalanceStr,
          available_balance: liveAvailableStr,
          initial_capital: liveBalanceStr,
          max_risk_limit_pct: parseFloat(String(dbAccount?.max_risk_limit_pct || 3.00)).toFixed(2),
          risk_per_trade_pct: parseFloat(String(dbAccount?.risk_per_trade_pct || 2.00)).toFixed(2),
          max_daily_loss_pct: parseFloat(String(dbAccount?.max_daily_loss_pct || 4.00)).toFixed(2),
          max_daily_loss_usd: parseFloat(String(dbAccount?.max_daily_loss_usd || 400.00)).toFixed(2),
          max_consecutive_losses: parseInt(String(dbAccount?.max_consecutive_losses || 3), 10),
          max_daily_trades: parseInt(String(dbAccount?.max_daily_trades || 6), 10),
          daily_realized_pnl: parseFloat(String(dbAccount?.daily_realized_pnl || 0.00)).toFixed(2),
          consecutive_losses_count: parseInt(String(dbAccount?.consecutive_losses_count || 0), 10),
          circuit_breaker_active: Boolean(dbAccount?.circuit_breaker_active),
          circuit_breaker_reason: dbAccount?.circuit_breaker_reason || null,
          circuit_breaker_tripped_at: dbAccount?.circuit_breaker_tripped_at || null,
          circuit_breaker_reset_at: dbAccount?.circuit_breaker_reset_at || null,
          total_unrealized_profit: liveUnrealizedStr,
          is_live: true,
          can_trade: binanceInfo.canTrade,
          assets: binanceInfo.assets,
          positions: binanceInfo.positions,
          updated_at: new Date().toISOString(),
        };

        return NextResponse.json({
          success: true,
          isLive: true,
          account: liveAccount,
        });
      }
    }

    // 2. Local Sandbox / Offline Fallback Mode
    const { account, isOffline } = await getOrCreateAccount(userEmail);
    return NextResponse.json({
      success: true,
      isLive: false,
      account: {
        ...account,
        risk_per_trade_pct: parseFloat(String(account.risk_per_trade_pct || 2.00)).toFixed(2),
        max_risk_limit_pct: parseFloat(String(account.max_risk_limit_pct || 3.00)).toFixed(2),
        max_daily_loss_pct: parseFloat(String(account.max_daily_loss_pct || 4.00)).toFixed(2),
        max_daily_loss_usd: parseFloat(String(account.max_daily_loss_usd || 400.00)).toFixed(2),
        max_consecutive_losses: parseInt(String(account.max_consecutive_losses || 3), 10),
        max_daily_trades: parseInt(String(account.max_daily_trades || 6), 10),
      },
      isOffline,
    });
  } catch (error: unknown) {
    console.error("[ACCOUNT API] GET Error:", error);
    const fallback = getFallbackAccount("default_user");
    return NextResponse.json({
      success: true,
      isLive: false,
      account: fallback,
      isOffline: true,
    });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userEmail = session?.user?.email || "default_user";

    const body = await req.json();
    const {
      initial_capital,
      max_risk_limit_pct,
      risk_per_trade_pct,
      max_daily_loss_pct,
      max_daily_loss_usd,
      max_consecutive_losses,
      max_daily_trades,
    } = body;

    const riskLimit = max_risk_limit_pct !== undefined ? parseFloat(max_risk_limit_pct) : 3.0;
    const tradeRisk = risk_per_trade_pct !== undefined ? parseFloat(risk_per_trade_pct) : 2.0;
    const dailyLossPct = max_daily_loss_pct !== undefined ? parseFloat(max_daily_loss_pct) : 4.0;
    const dailyLossUsd = max_daily_loss_usd !== undefined ? parseFloat(max_daily_loss_usd) : 400.0;
    const maxConsecLosses = max_consecutive_losses !== undefined ? parseInt(max_consecutive_losses, 10) : 3;
    const maxDailyTradesCount = max_daily_trades !== undefined ? parseInt(max_daily_trades, 10) : 6;

    if (isNaN(tradeRisk) || tradeRisk <= 0 || tradeRisk > 100) {
      return NextResponse.json(
        { error: "Invalid parameter: 'risk_per_trade_pct' must be a percentage between 0 and 100." },
        { status: 400 }
      );
    }

    if (tradeRisk > riskLimit * 1.05) {
      return NextResponse.json(
        { error: `Sanity check failed: Operational Risk (${tradeRisk}%) cannot exceed Max Risk Limit (${riskLimit}%).` },
        { status: 400 }
      );
    }

    const capital = initial_capital !== undefined ? parseFloat(initial_capital) : 1000.0;

    // Update GlobalRiskGovernor static memory immediately
    await GlobalRiskGovernor.updateConfig(
      {
        risk_per_trade_pct: tradeRisk,
        max_risk_limit_pct: riskLimit,
        max_daily_loss_pct: dailyLossPct,
        max_daily_loss_usd: dailyLossUsd,
        max_consecutive_losses: maxConsecLosses,
        max_daily_trades: maxDailyTradesCount,
      },
      userEmail
    );

    // Reset circuit breaker on commit so new risk limits apply cleanly
    await GlobalRiskGovernor.resetCircuitBreaker(userEmail);
    await GlobalRiskGovernor.resetCircuitBreaker('institutional_admin');

    // In Live VPS mode with Binance active:
    if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
      const binanceInfo = await getBinanceAccountInfo();
      const liveBal = binanceInfo && binanceInfo.totalWalletBalance > 0 ? binanceInfo.totalWalletBalance : (capital || 312.51);

      try {
        await initAccountTable();
        await sql`
          INSERT INTO trading_account (
            user_id, current_balance, initial_capital, max_risk_limit_pct,
            risk_per_trade_pct, max_daily_loss_pct, max_daily_loss_usd,
            max_consecutive_losses, max_daily_trades, circuit_breaker_active, circuit_breaker_reason, updated_at
          )
          VALUES (
            ${userEmail}, ${liveBal}, ${capital}, ${riskLimit},
            ${tradeRisk}, ${dailyLossPct}, ${dailyLossUsd},
            ${maxConsecLosses}, ${maxDailyTradesCount}, FALSE, NULL, CURRENT_TIMESTAMP
          )
          ON CONFLICT (user_id)
          DO UPDATE SET 
            initial_capital = ${capital},
            max_risk_limit_pct = ${riskLimit},
            risk_per_trade_pct = ${tradeRisk},
            max_daily_loss_pct = ${dailyLossPct},
            max_daily_loss_usd = ${dailyLossUsd},
            max_consecutive_losses = ${maxConsecLosses},
            max_daily_trades = ${maxDailyTradesCount},
            circuit_breaker_active = FALSE,
            circuit_breaker_reason = NULL,
            updated_at = CURRENT_TIMESTAMP
        `;
      } catch (e) {
        console.warn('[ACCOUNT API] Non-fatal DB update error in live mode:', e);
      }

      return NextResponse.json({
        success: true,
        isLive: true,
        account: {
          id: `binance_live_${userEmail}`,
          user_id: userEmail,
          current_balance: liveBal.toFixed(4),
          initial_capital: liveBal.toFixed(4),
          max_risk_limit_pct: riskLimit.toFixed(2),
          risk_per_trade_pct: tradeRisk.toFixed(2),
          max_daily_loss_pct: dailyLossPct.toFixed(2),
          max_daily_loss_usd: dailyLossUsd.toFixed(2),
          max_consecutive_losses: maxConsecLosses,
          max_daily_trades: maxDailyTradesCount,
          is_live: true,
        },
      });
    }

    // Local Sandbox mode
    try {
      await initAccountTable();
      await sql`BEGIN`;
      let accountRes = await sql`
        SELECT * FROM trading_account WHERE user_id = ${userEmail} FOR UPDATE
      `;

      if (accountRes.rows.length === 0) {
        await sql`
          INSERT INTO trading_account (
            user_id, current_balance, initial_capital, max_risk_limit_pct,
            risk_per_trade_pct, max_daily_loss_pct, max_daily_loss_usd,
            max_consecutive_losses, max_daily_trades
          )
          VALUES (
            ${userEmail}, ${capital}, ${capital}, ${riskLimit},
            ${tradeRisk}, ${dailyLossPct}, ${dailyLossUsd},
            ${maxConsecLosses}, ${maxDailyTradesCount}
          )
        `;
        accountRes = await sql`
          SELECT * FROM trading_account WHERE user_id = ${userEmail} FOR UPDATE
        `;
      }

      const updateRes = await sql`
        UPDATE trading_account
        SET initial_capital = ${capital},
            max_risk_limit_pct = ${riskLimit},
            risk_per_trade_pct = ${tradeRisk},
            max_daily_loss_pct = ${dailyLossPct},
            max_daily_loss_usd = ${dailyLossUsd},
            max_consecutive_losses = ${maxConsecLosses},
            max_daily_trades = ${maxDailyTradesCount},
            current_balance = ${capital},
            circuit_breaker_active = FALSE,
            circuit_breaker_reason = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ${userEmail}
        RETURNING *
      `;

      await sql`COMMIT`;

      const acc = updateRes.rows[0];
      inMemoryAccounts.set(userEmail, acc as TradingAccountRecord);

      return NextResponse.json({
        success: true,
        isLive: false,
        account: acc,
      });
    } catch (txErr: any) {
      try { await sql`ROLLBACK`; } catch {}
      const mem = getFallbackAccount(userEmail);
      mem.initial_capital = capital.toFixed(4);
      mem.current_balance = capital.toFixed(4);
      mem.max_risk_limit_pct = riskLimit.toFixed(2);
      mem.risk_per_trade_pct = tradeRisk.toFixed(2);
      mem.max_daily_loss_pct = dailyLossPct.toFixed(2);
      mem.max_daily_loss_usd = dailyLossUsd.toFixed(2);
      mem.max_consecutive_losses = maxConsecLosses;
      mem.max_daily_trades = maxDailyTradesCount;
      mem.updated_at = new Date().toISOString();
      inMemoryAccounts.set(userEmail, mem);

      return NextResponse.json({
        success: true,
        isLive: false,
        account: mem,
        isOffline: true,
      });
    }
  } catch (error: unknown) {
    console.error("[ACCOUNT API] POST Error:", error);
    const message = error instanceof Error ? error.message : "Failed to update configurations.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
