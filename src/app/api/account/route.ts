import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

// In-memory fallback account storage for offline mode / Neon database quota degradation
interface TradingAccountRecord {
  id: string;
  user_id: string;
  current_balance: string | number;
  initial_capital: string | number;
  max_risk_limit_pct: string | number;
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
  } catch (error: any) {
    console.warn("[ACCOUNT API] Postgres table initialization skipped (offline/quota fallback):", error?.message || error);
  }
}

// Helper to fetch or seed accounts with $10,000 for a user
async function getOrCreateAccount(userEmail: string) {
  try {
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
      console.log(`[ACCOUNT API] Seeded new trading account for user: ${userEmail} with $10,000.`);
    }
    const acc = accountRes.rows[0];
    inMemoryAccounts.set(userEmail, acc as TradingAccountRecord);
    return { account: acc, isOffline: false, isQuotaExceeded: false };
  } catch (dbErr: any) {
    const isQuotaError = dbErr?.message?.includes('exceeded') || dbErr?.message?.includes('402') || dbErr?.code === '402';
    console.warn(`[ACCOUNT API] Database unavailable (${isQuotaError ? 'Quota Exceeded' : 'Offline'}). Serving from in-memory store:`, dbErr?.message || dbErr);
    const fallback = getFallbackAccount(userEmail);
    return { account: fallback, isOffline: true, isQuotaExceeded: isQuotaError };
  }
}

export async function GET() {
  try {
    const session = await auth();
    const userEmail = session?.user?.email || "default_user";

    const { account, isOffline, isQuotaExceeded } = await getOrCreateAccount(userEmail);

    return NextResponse.json({
      success: true,
      account,
      ...(isOffline ? { isOffline: true } : {}),
      ...(isQuotaExceeded ? { isQuotaExceeded: true } : {}),
    });
  } catch (error: unknown) {
    console.error("[ACCOUNT API] GET Error:", error);
    const fallback = getFallbackAccount("default_user");
    return NextResponse.json({
      success: true,
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

    if (initial_capital === undefined || max_risk_limit_pct === undefined) {
      return NextResponse.json(
        { error: "Missing required parameters: 'initial_capital' and 'max_risk_limit_pct' must be provided." },
        { status: 400 }
      );
    }

    const capital = parseFloat(initial_capital);
    const riskLimit = parseFloat(max_risk_limit_pct);

    if (isNaN(capital) || capital <= 0) {
      return NextResponse.json(
        { error: "Invalid parameter: 'initial_capital' must be a positive number." },
        { status: 400 }
      );
    }

    if (isNaN(riskLimit) || riskLimit <= 0 || riskLimit > 100) {
      return NextResponse.json(
        { error: "Invalid parameter: 'max_risk_limit_pct' must be a percentage between 0 and 100." },
        { status: 400 }
      );
    }

    // Try DB transaction first
    try {
      await sql`BEGIN`;
      let accountRes = await sql`
        SELECT * FROM trading_account WHERE user_id = ${userEmail} FOR UPDATE
      `;

      if (accountRes.rows.length === 0) {
        await sql`
          INSERT INTO trading_account (user_id, current_balance, initial_capital, max_risk_limit_pct)
          VALUES (${userEmail}, 10000.0000, 10000.0000, 3.00)
        `;
        accountRes = await sql`
          SELECT * FROM trading_account WHERE user_id = ${userEmail} FOR UPDATE
        `;
      }

      const pnlRes = await sql`
        SELECT SUM(realized_pnl) as total_pnl FROM paper_trades
        WHERE status = 'CLOSED'
      `;
      const totalPnl = parseFloat(pnlRes.rows[0]?.total_pnl || "0.0000");
      const newBalance = parseFloat((capital + totalPnl).toFixed(4));

      const updateRes = await sql`
        UPDATE trading_account
        SET initial_capital = ${capital},
            max_risk_limit_pct = ${riskLimit},
            current_balance = ${newBalance},
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ${userEmail}
        RETURNING *
      `;

      await sql`COMMIT`;

      const acc = updateRes.rows[0];
      inMemoryAccounts.set(userEmail, acc as TradingAccountRecord);

      return NextResponse.json({
        success: true,
        account: acc,
      });
    } catch (txErr: any) {
      try { await sql`ROLLBACK`; } catch {}
      const isQuotaError = txErr?.message?.includes('exceeded') || txErr?.message?.includes('402') || txErr?.code === '402';
      console.warn(`[ACCOUNT API] POST DB update failed (${isQuotaError ? 'Quota Exceeded' : 'Offline'}). Updating in-memory state:`, txErr?.message || txErr);

      const mem = getFallbackAccount(userEmail);
      mem.initial_capital = capital.toFixed(4);
      mem.current_balance = capital.toFixed(4);
      mem.max_risk_limit_pct = riskLimit.toFixed(2);
      mem.updated_at = new Date().toISOString();
      inMemoryAccounts.set(userEmail, mem);

      return NextResponse.json({
        success: true,
        account: mem,
        isOffline: true,
        ...(isQuotaError ? { isQuotaExceeded: true } : {}),
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
