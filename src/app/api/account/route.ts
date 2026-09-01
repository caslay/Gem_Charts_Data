import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/postgres";
import { getBinanceAccountInfo } from "@/lib/binanceFuturesClient";

// In-memory fallback account storage for offline mode / local development
interface TradingAccountRecord {
  id: string;
  user_id: string;
  current_balance: string | number;
  initial_capital: string | number;
  max_risk_limit_pct: string | number;
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
      max_risk_limit_pct: "2.00",
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
        max_risk_limit_pct DECIMAL(5, 2) NOT NULL DEFAULT 2.00,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
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
        INSERT INTO trading_account (user_id, current_balance, initial_capital, max_risk_limit_pct)
        VALUES (${userEmail}, 10000.0000, 10000.0000, 2.00)
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

        // Fetch user custom risk percentage from database/in-memory if configured
        const { account: dbAccount } = await getOrCreateAccount(userEmail);
        const riskLimitPct = dbAccount?.max_risk_limit_pct ? parseFloat(String(dbAccount.max_risk_limit_pct)) : 2.00;

        const liveAccount = {
          id: `binance_live_${userEmail}`,
          user_id: userEmail,
          current_balance: liveBalanceStr,
          available_balance: liveAvailableStr,
          initial_capital: liveBalanceStr,
          max_risk_limit_pct: riskLimitPct.toFixed(2),
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

    // 2. Fallback to Database / Local Sandbox Storage ($10,000 baseline)
    const { account, isOffline } = await getOrCreateAccount(userEmail);

    return NextResponse.json({
      success: true,
      isLive: false,
      account: {
        ...account,
        is_live: false,
      },
      ...(isOffline ? { isOffline: true } : {}),
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
    const { initial_capital, max_risk_limit_pct } = body;

    const riskLimit = max_risk_limit_pct !== undefined ? parseFloat(max_risk_limit_pct) : 2.0;

    if (isNaN(riskLimit) || riskLimit <= 0 || riskLimit > 100) {
      return NextResponse.json(
        { error: "Invalid parameter: 'max_risk_limit_pct' must be a percentage between 0 and 100." },
        { status: 400 }
      );
    }

    const capital = initial_capital !== undefined ? parseFloat(initial_capital) : 10000.0;

    // In Live VPS mode with Binance active:
    if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
      const binanceInfo = await getBinanceAccountInfo();
      const liveBal = binanceInfo ? binanceInfo.totalWalletBalance : (capital || 312.51);

      try {
        await initAccountTable();
        await sql`
          INSERT INTO trading_account (user_id, current_balance, initial_capital, max_risk_limit_pct, updated_at)
          VALUES (${userEmail}, ${liveBal}, ${liveBal}, ${riskLimit}, CURRENT_TIMESTAMP)
          ON CONFLICT (user_id)
          DO UPDATE SET max_risk_limit_pct = ${riskLimit}, updated_at = CURRENT_TIMESTAMP
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
          INSERT INTO trading_account (user_id, current_balance, initial_capital, max_risk_limit_pct)
          VALUES (${userEmail}, ${capital}, ${capital}, ${riskLimit})
        `;
        accountRes = await sql`
          SELECT * FROM trading_account WHERE user_id = ${userEmail} FOR UPDATE
        `;
      }

      const updateRes = await sql`
        UPDATE trading_account
        SET initial_capital = ${capital},
            max_risk_limit_pct = ${riskLimit},
            current_balance = ${capital},
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
