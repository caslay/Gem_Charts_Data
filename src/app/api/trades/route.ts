import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/postgres";
import { getBinanceOpenPositions } from "@/lib/binanceFuturesClient";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";

function getTodayUtcString(): string {
  return new Date().toISOString().split("T")[0];
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "ETHUSDC").toUpperCase();
    const today = searchParams.get("date") || getTodayUtcString();

    const trades: any[] = [];

    // 1. If Binance API credentials exist, fetch live exchange open positions
    if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
      try {
        const binancePositions = await getBinanceOpenPositions(symbol);
        for (const pos of binancePositions) {
          const amt = parseFloat(pos.positionAmt);
          if (amt !== 0) {
            trades.push({
              id: `binance_${pos.symbol}_${pos.positionSide}_${pos.updateTime}`,
              symbol: pos.symbol,
              direction: amt > 0 ? "LONG" : "SHORT",
              entry_price: parseFloat(pos.entryPrice),
              mark_price: parseFloat(pos.markPrice),
              stop_loss: 0,
              take_profit: 0,
              position_size: Math.abs(amt),
              realized_pnl: parseFloat(pos.unRealizedProfit),
              roi: parseFloat(pos.unRealizedProfit) !== 0 && parseFloat(pos.isolatedMargin || '0') > 0
                ? (parseFloat(pos.unRealizedProfit) / parseFloat(pos.isolatedMargin)) * 100
                : 0,
              status: "OPEN",
              strategy_name: "Binance Live Futures Position",
              ai_narrative_summary: `Live ${pos.leverage}x ${pos.marginType} position on Binance Futures (${pos.symbol}).`,
              timestamp: new Date(pos.updateTime).toISOString(),
              created_at: new Date(pos.updateTime).toISOString(),
              opened_at: new Date(pos.updateTime).toISOString(),
              is_exchange_live: true,
            });
          }
        }
      } catch (binanceErr) {
        console.warn("[TRADES API] Failed to fetch Binance open positions:", binanceErr);
      }
    }

    // 2. Fetch completed/active trades from today's daemon session log
    const rootDir = process.cwd();
    const sessionLogPath = path.join(rootDir, "run_logs", `live_session_${today}.json`);
    if (fs.existsSync(sessionLogPath)) {
      try {
        const raw = fs.readFileSync(sessionLogPath, "utf8");
        const sessionLog = JSON.parse(raw);
        if (sessionLog.completedTrades && Array.isArray(sessionLog.completedTrades)) {
          for (const t of sessionLog.completedTrades) {
            trades.push({
              id: t.id,
              symbol: t.symbol || symbol,
              direction: t.direction,
              entry_price: t.entryPrice,
              stop_loss: t.activeStopLoss || t.initialStopLoss,
              take_profit: t.stage1Target,
              position_size: t.contractSize,
              realized_pnl: t.realizedUsd,
              realized_r: t.realizedR,
              risk_amount_usd: t.riskUsd,
              status: "CLOSED",
              strategy_name: t.strategyName || "5M Sweep & Reclaim",
              ai_narrative_summary: `Exit: ${t.exitReason || 'COMPLETED'} | Realized: ${t.realizedR >= 0 ? '+' : ''}${t.realizedR.toFixed(2)}R ($${t.realizedUsd.toFixed(2)})`,
              timestamp: new Date(t.pendingTime || Date.now()).toISOString(),
              created_at: new Date(t.pendingTime || Date.now()).toISOString(),
              opened_at: t.openTime ? new Date(t.openTime).toISOString() : undefined,
              closed_at: t.closeTime ? new Date(t.closeTime).toISOString() : undefined,
              exit_price: t.exitPrice,
            });
          }
        }
      } catch (logErr) {
        console.warn("[TRADES API] Failed to read session log:", logErr);
      }
    }

    // 3. Query local database paper_trades table for persistent manual / journal records
    try {
      const dbTrades = await sql`
        SELECT * FROM paper_trades
        ORDER BY created_at DESC
        LIMIT 50
      `;
      for (const row of dbTrades.rows) {
        if (!trades.some(t => t.id === row.id)) {
          trades.push(row);
        }
      }
    } catch (dbErr) {
      // Table may not exist or DB offline - non-fatal
    }

    return NextResponse.json({
      success: true,
      trades,
      count: trades.length,
    });
  } catch (error: any) {
    console.error("[TRADES API] GET Error:", error);
    return NextResponse.json({
      success: true,
      trades: [],
      error: error?.message || "Failed to fetch trades",
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    return NextResponse.json({ success: true, record: body });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to save trade" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, clearAll } = body as { id?: string; clearAll?: boolean };

    if (clearAll) {
      try {
        await sql`DELETE FROM paper_trades;`;
      } catch {}

      // Clean up completedTrades in today's and all recent session logs
      const rootDir = process.cwd();
      const runLogsDir = path.join(rootDir, "run_logs");
      if (fs.existsSync(runLogsDir)) {
        try {
          const files = fs.readdirSync(runLogsDir);
          for (const file of files) {
            if (file.startsWith("live_session_") && file.endsWith(".json")) {
              const fullPath = path.join(runLogsDir, file);
              const raw = fs.readFileSync(fullPath, "utf8");
              const sessionLog = JSON.parse(raw);
              sessionLog.completedTrades = [];
              sessionLog.totalRealizedR = 0;
              sessionLog.totalTrades = 0;
              sessionLog.winningTrades = 0;
              sessionLog.losingTrades = 0;
              fs.writeFileSync(fullPath, JSON.stringify(sessionLog, null, 2), "utf8");
            }
          }
        } catch (e) {
          console.warn("[TRADES API] Failed to reset session log files:", e);
        }
      }

      return NextResponse.json({ success: true, message: "All paper trades and simulation session logs cleared." });
    }

    if (id) {
      try {
        await sql`DELETE FROM paper_trades WHERE id = ${id};`;
      } catch {}

      const rootDir = process.cwd();
      const runLogsDir = path.join(rootDir, "run_logs");
      if (fs.existsSync(runLogsDir)) {
        try {
          const files = fs.readdirSync(runLogsDir);
          for (const file of files) {
            if (file.startsWith("live_session_") && file.endsWith(".json")) {
              const fullPath = path.join(runLogsDir, file);
              const raw = fs.readFileSync(fullPath, "utf8");
              const sessionLog = JSON.parse(raw);
              if (sessionLog.completedTrades && Array.isArray(sessionLog.completedTrades)) {
                sessionLog.completedTrades = sessionLog.completedTrades.filter((t: any) => t.id !== id);
                fs.writeFileSync(fullPath, JSON.stringify(sessionLog, null, 2), "utf8");
              }
            }
          }
        } catch {}
      }

      return NextResponse.json({ success: true, message: `Trade ${id} deleted.` });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to delete trade" }, { status: 500 });
  }
}
