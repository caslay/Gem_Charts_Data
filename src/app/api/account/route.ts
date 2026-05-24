import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

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
    console.error("[ACCOUNT API] Database table 'trading_account' initialization failed:", error);
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
    console.log(`[ACCOUNT API] Seeded new trading account for user: ${userEmail} with $10,000.`);
  }
  return accountRes.rows[0];
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

    const userEmail = session.user.email || "default_user";
    const account = await getOrCreateAccount(userEmail);

    return NextResponse.json({ success: true, account });
  } catch (error: unknown) {
    console.error("[ACCOUNT API] GET Error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch account state.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
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

    const userEmail = session.user.email || "default_user";

    // Open ACID transaction block to update account capital safely
    await sql`BEGIN`;
    try {
      // 1. Fetch and Lock the user's trading_account row using FOR UPDATE to prevent clashing writes
      let accountRes = await sql`
        SELECT * FROM trading_account WHERE user_id = ${userEmail} FOR UPDATE
      `;

      if (accountRes.rows.length === 0) {
        // Seed first if missing
        await sql`
          INSERT INTO trading_account (user_id, current_balance, initial_capital, max_risk_limit_pct)
          VALUES (${userEmail}, 10000.0000, 10000.0000, 3.00)
        `;
        accountRes = await sql`
          SELECT * FROM trading_account WHERE user_id = ${userEmail} FOR UPDATE
        `;
      }

      // 2. Fetch sum of realized_pnl of all CLOSED trades
      // (This guarantees immediate dynamic recalculation of exposure and drawdown balance)
      const pnlRes = await sql`
        SELECT SUM(realized_pnl) as total_pnl FROM paper_trades
        WHERE status = 'CLOSED'
      `;
      const totalPnl = parseFloat(pnlRes.rows[0].total_pnl || "0.0000");

      // 3. Recalculate dynamic balance = new initial capital + total realized profit/loss
      const newBalance = parseFloat((capital + totalPnl).toFixed(4));

      // 4. Update configurations and dynamic balance
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

      console.log(`[ACCOUNT API] Account updated for user: ${userEmail}. Initial capital: $${capital}, Max risk: ${riskLimit}%, Recalculated balance: $${newBalance}`);

      return NextResponse.json({
        success: true,
        account: updateRes.rows[0]
      });

    } catch (txErr) {
      await sql`ROLLBACK`;
      throw txErr;
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
