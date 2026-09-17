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
    const mode = searchParams.get("mode") || "all"; // 'paper', 'live', or 'all'

    const tradeMap = new Map<string, any>();
    const rootDir = process.cwd();

    // ── 1. Ingest In-Flight Active Positions from Daemon Session Log ──
    const runLogsDir = path.join(rootDir, "run_logs");
    const todayLogPath = path.join(runLogsDir, `live_session_${today}.json`);
    
    // Find all session log files for scanning (today first, then recent)
    const sessionFiles: string[] = [];
    if (fs.existsSync(todayLogPath)) {
      sessionFiles.push(todayLogPath);
    }
    if (fs.existsSync(runLogsDir)) {
      try {
        const files = fs.readdirSync(runLogsDir)
          .filter(f => f.startsWith("live_session_") && f.endsWith(".json"))
          .sort()
          .reverse();
        for (const f of files) {
          const p = path.join(runLogsDir, f);
          if (!sessionFiles.includes(p)) sessionFiles.push(p);
        }
      } catch (e) {
        console.warn("[TRADES API] Failed to list run_logs:", e);
      }
    }

    // A. Check today's or newest session log for active in-flight positions
    if (sessionFiles.length > 0) {
      try {
        const newestPath = sessionFiles[0];
        const raw = fs.readFileSync(newestPath, "utf8");
        const sessionLog = JSON.parse(raw);
        const events = sessionLog.events || [];

        const activeInFlight = new Map<string, any>();
        for (const evt of events) {
          if (
            (evt.type === 'ORDER_FILLED' ||
              evt.type === 'SPARK_DECISION_PAPER_FILLED' ||
              evt.type === 'SPARK_DECISION_EXECUTED' ||
              evt.type === 'EARLY_BREAKEVEN' ||
              evt.type === 'STAGE_1_HARVEST' ||
              evt.type === 'SPARK_DECISION_TP1_HARVEST' ||
              evt.type === 'STAGE_2_HARVEST') &&
            evt.position?.id
          ) {
            activeInFlight.set(evt.position.id, evt.position);
          } else if (
            (evt.type === 'POSITION_CLOSED' || evt.type === 'SPARK_DECISION_PAPER_CLOSED') &&
            evt.position?.id
          ) {
            activeInFlight.delete(evt.position.id);
          } else if (evt.type === 'LIMIT_ORDER_CANCELLED' && evt.position?.id) {
            activeInFlight.delete(evt.position.id);
          }
        }

        for (const pos of activeInFlight.values()) {
          const tradeId = pos.id;
          const openTimeIso = pos.openTime ? new Date(pos.openTime).toISOString() : new Date().toISOString();
          tradeMap.set(tradeId, {
            id: tradeId,
            symbol: pos.symbol || symbol,
            direction: pos.direction,
            entry_price: pos.entryPrice,
            stop_loss: pos.activeStopLoss || pos.initialStopLoss,
            take_profit: pos.stage1Target,
            position_size: pos.contractSize ?? 1.0,
            realized_pnl: pos.realizedUsd ?? 0,
            realized_r: pos.realizedR ?? 0,
            risk_amount_usd: pos.riskUsd ?? Math.abs(pos.entryPrice - (pos.activeStopLoss || pos.initialStopLoss)) * (pos.contractSize ?? 1.0),
            status: "OPEN",
            strategy_name: pos.strategyName || (pos.anchorName ? `5M S&R (${pos.anchorName})` : "5M Sweep & Reclaim"),
            ai_narrative_summary: `In-Flight Position (${pos.direction}) | SL: $${(pos.activeStopLoss || pos.initialStopLoss).toFixed(2)} | TP1: $${pos.stage1Target.toFixed(2)}`,
            timestamp: openTimeIso,
            created_at: openTimeIso,
            opened_at: openTimeIso,
            execution_mode: pos.executionMode || "PAPER_TRADING",
          });
        }
      } catch (err) {
        console.warn("[TRADES API] Failed to extract active in-flight positions:", err);
      }
    }

    // B. Ingest completed trades from session logs
    for (const sPath of sessionFiles) {
      try {
        const raw = fs.readFileSync(sPath, "utf8");
        const sessionLog = JSON.parse(raw);
        if (sessionLog.completedTrades && Array.isArray(sessionLog.completedTrades)) {
          for (const t of sessionLog.completedTrades) {
            if (!tradeMap.has(t.id)) {
              const pendingTimeIso = new Date(t.pendingTime || t.openTime || Date.now()).toISOString();
              tradeMap.set(t.id, {
                id: t.id,
                symbol: t.symbol || symbol,
                direction: t.direction,
                entry_price: t.entryPrice,
                stop_loss: t.activeStopLoss || t.initialStopLoss,
                take_profit: t.stage1Target,
                position_size: t.contractSize ?? 1.0,
                realized_pnl: t.realizedUsd ?? 0,
                realized_r: t.realizedR ?? 0,
                risk_amount_usd: t.riskUsd ?? Math.abs(t.entryPrice - (t.initialStopLoss || t.entryPrice)) * (t.contractSize ?? 1.0),
                status: "CLOSED",
                strategy_name: t.strategyName || (t.anchorName ? `5M S&R (${t.anchorName})` : "5M Sweep & Reclaim"),
                ai_narrative_summary: `Exit: ${t.exitReason || 'COMPLETED'} | Realized: ${(t.realizedR || 0) >= 0 ? '+' : ''}${(t.realizedR || 0).toFixed(2)}R ($${(t.realizedUsd || 0).toFixed(2)})`,
                timestamp: pendingTimeIso,
                created_at: pendingTimeIso,
                opened_at: t.openTime ? new Date(t.openTime).toISOString() : undefined,
                closed_at: t.closeTime ? new Date(t.closeTime).toISOString() : undefined,
                exit_price: t.exitPrice,
                execution_mode: t.executionMode || "PAPER_TRADING",
              });
            }
          }
        }
      } catch (e) {}
    }

    // ── 2. Ingest Historical Trades from ETHUSDC_Daily_Tracker.json ──
    const trackerPath = path.join(rootDir, "directives", "ETHUSDC_Daily_Tracker.json");
    if (fs.existsSync(trackerPath)) {
      try {
        const raw = fs.readFileSync(trackerPath, "utf8");
        const tracker = JSON.parse(raw);
        if (tracker.trades && Array.isArray(tracker.trades)) {
          for (const dt of tracker.trades) {
            const dtId = dt.trade_id || `tracker_${dt.date}_${dt.open_time}`;
            if (!tradeMap.has(dtId)) {
              tradeMap.set(dtId, {
                id: dtId,
                symbol: dt.pair || symbol,
                direction: dt.direction,
                entry_price: dt.entry_price,
                stop_loss: dt.stop_loss,
                take_profit: dt.take_profit_1,
                position_size: 1.0,
                realized_pnl: dt.realized_pnl_usd ?? 0,
                realized_r: dt.realized_r ?? 0,
                risk_amount_usd: Math.abs(dt.entry_price - dt.stop_loss) * 1.0,
                status: dt.status || "CLOSED",
                strategy_name: dt.strategy || "5M Sweep & Reclaim",
                ai_narrative_summary: dt.notes || `Daily Tracker: ${dt.outcome} (${dt.realized_r ?? 0}R)`,
                timestamp: dt.open_time || dt.date,
                created_at: dt.open_time || dt.date,
                opened_at: dt.open_time,
                closed_at: dt.close_time,
                exit_price: dt.exit_price,
                execution_mode: "PAPER_TRADING",
              });
            }
          }
        }
      } catch (e) {
        console.warn("[TRADES API] Failed to parse Daily Tracker trades:", e);
      }
    }

    // ── 3. Ingest PostgreSQL trades Table ──
    try {
      const dbTrades = await sql`
        SELECT * FROM trades
        ORDER BY entry_time DESC
        LIMIT 100
      `;
      for (const row of dbTrades.rows) {
        const rowId = row.trade_id || String(row.id);
        const meta = typeof row.metadata === 'object' && row.metadata !== null ? row.metadata : {};
        const isDbOpen = row.status === 'OPEN';
        
        // If row is already mapped as OPEN from live session, preserve the live in-flight state
        if (tradeMap.has(rowId) && tradeMap.get(rowId)?.status === 'OPEN' && !isDbOpen) {
          continue;
        }

        tradeMap.set(rowId, {
          id: rowId,
          symbol: row.symbol || symbol,
          direction: row.direction,
          entry_price: parseFloat(row.entry_price),
          exit_price: row.exit_price ? parseFloat(row.exit_price) : undefined,
          stop_loss: parseFloat(row.stop_loss),
          take_profit: parseFloat(row.take_profit_1 ?? row.take_profit ?? 0),
          position_size: meta.contractSize ?? (row.position_size ? parseFloat(row.position_size) : 1.0),
          realized_pnl: row.realized_pnl !== null && row.realized_pnl !== undefined ? parseFloat(row.realized_pnl) : 0,
          realized_r: row.realized_r !== null && row.realized_r !== undefined ? parseFloat(row.realized_r) : 0,
          risk_amount_usd: meta.riskUsd ?? (row.risk_amount_usd ? parseFloat(row.risk_amount_usd) : Math.abs(parseFloat(row.entry_price) - parseFloat(row.stop_loss))),
          status: isDbOpen ? "OPEN" : "CLOSED",
          strategy_name: row.anchor_name ? `5M S&R (${row.anchor_name})` : (row.strategy_name || "5M Sweep & Reclaim"),
          ai_narrative_summary: `DB Record: ${row.execution_mode || 'PAPER'} | Status: ${row.status} | Exit: ${row.exit_price ? '$' + parseFloat(row.exit_price).toFixed(2) : 'Active'}`,
          timestamp: new Date(row.entry_time || row.created_at || Date.now()).toISOString(),
          created_at: new Date(row.created_at || row.entry_time || Date.now()).toISOString(),
          opened_at: row.entry_time ? new Date(row.entry_time).toISOString() : undefined,
          closed_at: row.exit_time ? new Date(row.exit_time).toISOString() : undefined,
          execution_mode: row.execution_mode || "PAPER_TRADING",
        });
      }
    } catch (dbErr) {
      // Fallback query to paper_trades if table exists
      try {
        const fallbackRows = await sql`SELECT * FROM paper_trades ORDER BY created_at DESC LIMIT 50`;
        for (const row of fallbackRows.rows) {
          const rowId = row.trade_id || String(row.id);
          if (!tradeMap.has(rowId)) {
            tradeMap.set(rowId, {
              id: rowId,
              symbol: row.symbol || symbol,
              direction: row.direction,
              entry_price: parseFloat(row.entry_price),
              exit_price: row.exit_price ? parseFloat(row.exit_price) : undefined,
              stop_loss: parseFloat(row.stop_loss),
              take_profit: parseFloat(row.take_profit || row.take_profit_1 || 0),
              position_size: row.position_size ? parseFloat(row.position_size) : 1.0,
              realized_pnl: row.realized_pnl ? parseFloat(row.realized_pnl) : 0,
              roi: row.roi ? parseFloat(row.roi) : 0,
              status: row.status || "CLOSED",
              strategy_name: row.strategy_name || "Paper Trade",
              ai_narrative_summary: row.ai_narrative_summary || null,
              timestamp: new Date(row.created_at || Date.now()).toISOString(),
              created_at: new Date(row.created_at || Date.now()).toISOString(),
              opened_at: row.opened_at ? new Date(row.opened_at).toISOString() : undefined,
              closed_at: row.closed_at ? new Date(row.closed_at).toISOString() : undefined,
              execution_mode: "PAPER_TRADING",
            });
          }
        }
      } catch (e2) {}
    }

    // ── 4. Ingest Live Binance Open Positions (if configured and requested) ──
    if (mode !== "paper" && process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
      try {
        const binancePositions = await getBinanceOpenPositions(symbol);
        for (const pos of binancePositions) {
          const amt = parseFloat(pos.positionAmt);
          if (amt !== 0) {
            const bId = `binance_${pos.symbol}_${pos.positionSide}_${pos.updateTime}`;
            tradeMap.set(bId, {
              id: bId,
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
              execution_mode: "LIVE_BINANCE",
            });
          }
        }
      } catch (binanceErr) {
        console.warn("[TRADES API] Failed to fetch Binance open positions:", binanceErr);
      }
    }

    // ── 5. Mode Filtering & Sorting ──
    let allTrades = Array.from(tradeMap.values());
    if (mode === "paper") {
      allTrades = allTrades.filter(t => t.execution_mode !== "LIVE_BINANCE" && !t.is_exchange_live);
    } else if (mode === "live") {
      allTrades = allTrades.filter(t => t.execution_mode === "LIVE_BINANCE" || t.is_exchange_live);
    }

    // Sort: OPEN positions first, then newest opened_at / created_at / timestamp
    allTrades.sort((a, b) => {
      if (a.status === "OPEN" && b.status !== "OPEN") return -1;
      if (b.status === "OPEN" && a.status !== "OPEN") return 1;
      const timeA = new Date(a.opened_at || a.created_at || a.timestamp || 0).getTime();
      const timeB = new Date(b.opened_at || b.created_at || b.timestamp || 0).getTime();
      return timeB - timeA;
    });

    return NextResponse.json({
      success: true,
      trades: allTrades,
      count: allTrades.length,
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
        await sql`DELETE FROM trades;`;
      } catch {}
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
        await sql`DELETE FROM trades WHERE trade_id = ${id} OR id::text = ${id};`;
      } catch {}
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

