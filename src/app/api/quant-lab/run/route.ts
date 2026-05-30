import { NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";
import { buildServerEnrichedPayload, evaluateServerStrategy, ServerBtCandle, ServerMasterArrays } from "@/lib/quantLabEngine";

// Base URL for Binance Futures API
const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/klines';

// ── Helpers ──

function parseBinanceKlines(raw: unknown[][]): ServerBtCandle[] {
  return raw.map((c) => {
    const v = parseFloat(c[5] as string);
    const taker_buy_vol = parseFloat(c[9] as string);
    return {
      t: Number(c[0]),
      o: parseFloat(c[1] as string),
      h: parseFloat(c[2] as string),
      l: parseFloat(c[3] as string),
      c: parseFloat(c[4] as string),
      v,
      taker_buy_vol,
      taker_sell_vol: parseFloat((v - taker_buy_vol).toFixed(4)),
    };
  });
}

async function fetchPagedKlines(
  symbol: string,
  interval: string,
  startMs: number,
  endMs: number
): Promise<ServerBtCandle[]> {
  const allKlines: ServerBtCandle[] = [];
  let currentStart = startMs;
  const limit = 1000;

  while (currentStart < endMs) {
    const url = `${BINANCE_REST}?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&endTime=${endMs - 1}&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Binance klines fetch error [${interval}]: ${res.status} - ${errText}`);
    }
    const raw: any[][] = await res.json();
    if (raw.length === 0) break;

    const parsed = parseBinanceKlines(raw);
    allKlines.push(...parsed);

    const lastTime = raw[raw.length - 1][0];
    currentStart = Number(lastTime) + 1;

    if (raw.length < limit) break;

    // Respect Binance rate limits: add a lightweight 50ms cooldown between sequential pages
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return allKlines;
}

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

async function initTables() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS quant_lab_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        strategy_config JSONB NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        start_date TIMESTAMP WITH TIME ZONE NOT NULL,
        end_date TIMESTAMP WITH TIME ZONE NOT NULL,
        initial_balance DECIMAL(18, 4) NOT NULL,
        final_balance DECIMAL(18, 4) NOT NULL,
        total_trades INT NOT NULL DEFAULT 0,
        winning_trades INT NOT NULL DEFAULT 0,
        losing_trades INT NOT NULL DEFAULT 0,
        win_rate_pct DECIMAL(5, 2) NOT NULL DEFAULT 0,
        total_pnl DECIMAL(18, 4) NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS quant_lab_trades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID REFERENCES quant_lab_runs(id) ON DELETE CASCADE,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        direction VARCHAR(10) NOT NULL,
        entry_price DECIMAL(18, 4) NOT NULL,
        exit_price DECIMAL(18, 4),
        stop_loss DECIMAL(18, 4) NOT NULL,
        take_profit DECIMAL(18, 4) NOT NULL,
        realized_pnl DECIMAL(18, 4),
        roi DECIMAL(18, 4),
        position_size DECIMAL(18, 4) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'CLOSED',
        exit_timestamp TIMESTAMP WITH TIME ZONE,
        logic_trigger VARCHAR(255),
        ipda_metrics_at_entry JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (error) {
    console.error("[QUANT LAB API] Table self-healing initialization failed:", error);
    throw error;
  }
}

// ── Stream Handler ──

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const encoder = new TextEncoder();

  // Create stream
  const stream = new ReadableStream({
    async start(controller) {
      const sendChunk = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const body = await req.json();
        const {
          strategy_name,
          strategy_config, // Full CustomStrategy JSON object
          start_date,      // YYYY-MM-DD
          end_date,        // YYYY-MM-DD
          symbol = "ETHUSDC",
          timeframe = "5m",
          initial_capital = 10000.0,
          max_risk_limit_pct = 3.00
        } = body;

        if (!strategy_name || !strategy_config || !start_date || !end_date) {
          sendChunk({ type: "error", error: "Missing required parameters: strategy_name, strategy_config, start_date, or end_date." });
          controller.close();
          return;
        }

        sendChunk({ type: "status", message: "Initializing self-healing database tables..." });
        await initTables();

        sendChunk({ type: "status", message: `Fetching and aggregating historical ${symbol} candles from Binance...` });
        const startMs = Date.parse(`${start_date}T00:00:00.000Z`);
        const endMs = Date.parse(`${end_date}T23:59:59.000Z`);

        // Lookback buffer: 4 days (ensures stabilized ATR and swings at start Date)
        const lookbackStartMs = startMs - 4 * 24 * 60 * 60 * 1000;

        // Fetch parallel timeframes sequentially with 100ms gaps to bypass burst rate-limiting firewalls
        const candles5m = await fetchPagedKlines(symbol, "5m", lookbackStartMs, endMs);
        await new Promise((resolve) => setTimeout(resolve, 100));

        const candles15m = await fetchPagedKlines(symbol, "15m", lookbackStartMs, endMs);
        await new Promise((resolve) => setTimeout(resolve, 100));

        const candles1h = await fetchPagedKlines(symbol, "1h", lookbackStartMs, endMs);

        if (candles5m.length === 0) {
          sendChunk({ type: "error", error: "No historical candlestick data fetched from Binance for this range." });
          controller.close();
          return;
        }

        // Find Start Index in active timeframe candles falling inside user range
        const activeCandles = timeframe === '1h'
          ? candles1h
          : timeframe === '15m'
            ? candles15m
            : candles5m;

        const startIndex = activeCandles.findIndex(c => c.t >= startMs);
        if (startIndex === -1) {
          sendChunk({ type: "error", error: `Start date ${start_date} lies outside the fetched candle history range.` });
          controller.close();
          return;
        }

        sendChunk({
          type: "status",
          message: `Aggregated ${activeCandles.length} candles. Beginning sequential backtest from index ${startIndex}...`
        });

        // Setup backtest state variables
        let current_balance = initial_capital;
        let active_trade: any = null;
        const trades_ledger: any[] = [];
        let lastStreamedDay = -1;

        // Extract settings
        const conditionsObj = strategy_config.conditions || {};
        const settings = Array.isArray(strategy_config.conditions) ? {} : conditionsObj;
        const direction = settings.direction || "LONG";
        const sl_logic = settings.sl_logic || "Structural Swing";
        const tp_logic = settings.tp_logic || "Nearest Order Book Magnet";
        const risk_percent = settings.risk_percent ?? 1.0;

        // Sequential Candle-By-Candle Processing Loop (Zero Look-Ahead Bias)
        for (let i = startIndex; i < activeCandles.length; i++) {
          const candle = activeCandles[i];
          const d = new Date(candle.t);
          const dayOfMonth = d.getUTCDate();

          // ── Stream Daily Progress HUD updates ──
          if (dayOfMonth !== lastStreamedDay) {
            lastStreamedDay = dayOfMonth;
            sendChunk({
              type: "progress",
              date: d.toISOString().slice(0, 10),
              equity: parseFloat(current_balance.toFixed(2)),
              tradeCount: trades_ledger.length + (active_trade ? 1 : 0)
            });
          }

          // ── 1. If Position Active: Check Exits ──
          if (active_trade) {
            let hitSL = false;
            let hitTP = false;

            if (active_trade.direction === "LONG") {
              if (candle.l <= active_trade.stop_loss) hitSL = true;
              if (candle.h >= active_trade.take_profit) hitTP = true;

              if (hitSL && hitTP) {
                // Conservative standard: assume SL hit first
                hitSL = true;
                hitTP = false;
              }

              if (hitSL) {
                const pnl = (active_trade.stop_loss - active_trade.entry_price) * active_trade.position_size;
                current_balance += pnl;
                active_trade.exit_price = active_trade.stop_loss;
                active_trade.realized_pnl = parseFloat(pnl.toFixed(4));
                active_trade.roi = parseFloat(((pnl / active_trade.risk_amount_usd) * 100).toFixed(4));
                active_trade.status = "CLOSED";
                active_trade.exit_timestamp = new Date(candle.t).toISOString();
                trades_ledger.push(active_trade);
                active_trade = null;
              } else if (hitTP) {
                const pnl = (active_trade.take_profit - active_trade.entry_price) * active_trade.position_size;
                current_balance += pnl;
                active_trade.exit_price = active_trade.take_profit;
                active_trade.realized_pnl = parseFloat(pnl.toFixed(4));
                active_trade.roi = parseFloat(((pnl / active_trade.risk_amount_usd) * 100).toFixed(4));
                active_trade.status = "CLOSED";
                active_trade.exit_timestamp = new Date(candle.t).toISOString();
                trades_ledger.push(active_trade);
                active_trade = null;
              }
            } else { // SHORT Trade Exits
              if (candle.h >= active_trade.stop_loss) hitSL = true;
              if (candle.l <= active_trade.take_profit) hitTP = true;

              if (hitSL && hitTP) {
                hitSL = true;
                hitTP = false;
              }

              if (hitSL) {
                const pnl = (active_trade.entry_price - active_trade.stop_loss) * active_trade.position_size;
                current_balance += pnl;
                active_trade.exit_price = active_trade.stop_loss;
                active_trade.realized_pnl = parseFloat(pnl.toFixed(4));
                active_trade.roi = parseFloat(((pnl / active_trade.risk_amount_usd) * 100).toFixed(4));
                active_trade.status = "CLOSED";
                active_trade.exit_timestamp = new Date(candle.t).toISOString();
                trades_ledger.push(active_trade);
                active_trade = null;
              } else if (hitTP) {
                const pnl = (active_trade.entry_price - active_trade.take_profit) * active_trade.position_size;
                current_balance += pnl;
                active_trade.exit_price = active_trade.take_profit;
                active_trade.realized_pnl = parseFloat(pnl.toFixed(4));
                active_trade.roi = parseFloat(((pnl / active_trade.risk_amount_usd) * 100).toFixed(4));
                active_trade.status = "CLOSED";
                active_trade.exit_timestamp = new Date(candle.t).toISOString();
                trades_ledger.push(active_trade);
                active_trade = null;
              }
            }
          }

          // ── 2. If No Position Active: Evaluate Setup Entries ──
          if (!active_trade) {
            // Build zero look-ahead-bias timeframe slices up to current candle boundary
            const boundaryMs = candle.t + (timeframe === "1h" ? 3600000 : timeframe === "15m" ? 900000 : 300000);
            
            const visible5m = candles5m.filter(c => c.t + 300000 <= boundaryMs);
            const visible15m = candles15m.filter(c => c.t + 900000 <= boundaryMs);
            const visible1h = candles1h.filter(c => c.t + 3600000 <= boundaryMs);

            const visibleArrays: ServerMasterArrays = {
              candles_5m: visible5m,
              candles_15m: visible15m,
              candles_1h: visible1h
            };

            const data = buildServerEnrichedPayload(visibleArrays, d.toISOString().slice(0, 10), timeframe, symbol);
            const isMatch = evaluateServerStrategy(strategy_config, data, candle.c, candle);

            if (isMatch) {
              const entry_price = candle.c;
              const tickIncrement = 0.05;
              let stop_loss: number | null = null;

              // SL Logic
              if (sl_logic === "Manual Pips") {
                stop_loss = direction === "LONG" ? entry_price - 10.00 : entry_price + 10.00;
              } else if (sl_logic === "Last Candle High/Low") {
                const prevCandle = visible5m[visible5m.length - 2];
                if (prevCandle) {
                  stop_loss = direction === "LONG" ? prevCandle.l - tickIncrement : prevCandle.h + tickIncrement;
                }
              }

              if (stop_loss === null) {
                const hardInvalidation = data.ipda_metrics?.trade_execution_parameters?.hard_invalidation_levels;
                if (direction === "LONG") {
                  const bullish_invalidation = hardInvalidation?.bullish_invalidation;
                  if (bullish_invalidation !== undefined && bullish_invalidation !== null) {
                    stop_loss = bullish_invalidation - tickIncrement;
                  }
                } else {
                  const bearish_invalidation = hardInvalidation?.bearish_invalidation;
                  if (bearish_invalidation !== undefined && bearish_invalidation !== null) {
                    stop_loss = bearish_invalidation + tickIncrement;
                  }
                }
              }

              // In the rare case SL cannot be determined, calculate 2 * ATR
              if (stop_loss === null) {
                const activeArr = timeframe === "1h" ? visible1h : timeframe === "15m" ? visible15m : visible5m;
                const trs = activeArr.slice(-14).map(c => c.h - c.l);
                const atr = trs.reduce((sum, tr) => sum + tr, 0) / trs.length;
                stop_loss = direction === "LONG" ? entry_price - 2 * atr : entry_price + 2 * atr;
              }

              stop_loss = parseFloat(stop_loss.toFixed(4));

              // TP Logic
              let take_profit: number | null = null;
              if (tp_logic === "PDH/PDL Target") {
                const pdh = data.ipda_metrics?.macro_levels?.pdh || 0;
                const pdl = data.ipda_metrics?.macro_levels?.pdl || 0;
                take_profit = direction === "LONG" && pdh > 0 ? pdh : direction === "SHORT" && pdl > 0 ? pdl : null;
              } else if (tp_logic === "Nearest Order Book Magnet") {
                const restingLiquidity = data.ipda_metrics?.order_flow_engine?.resting_liquidity_pools;
                const magnets = direction === "LONG" ? (restingLiquidity?.BSL_Magnets || []) : (restingLiquidity?.SSL_Magnets || []);
                take_profit = getBestMagnet(magnets, entry_price, stop_loss, direction);
              }

              // Fallback to strict 1:2 RR
              if (take_profit === null || isNaN(take_profit)) {
                const risk = Math.abs(entry_price - stop_loss);
                take_profit = direction === "LONG" ? entry_price + 2 * risk : entry_price - 2 * risk;
              }

              take_profit = parseFloat(take_profit.toFixed(4));

              // Risk to Reward checks
              const risk = Math.abs(entry_price - stop_loss);
              let reward = Math.abs(take_profit - entry_price);

              if (risk > 0) {
                if (direction === "LONG") {
                  if (stop_loss >= entry_price || take_profit <= entry_price) continue;
                } else {
                  if (stop_loss <= entry_price || take_profit >= entry_price) continue;
                }

                let rr = reward / risk;
                if (rr < 2.0) {
                  take_profit = direction === "LONG" ? entry_price + 2.0 * risk : entry_price - 2.0 * risk;
                  take_profit = parseFloat(take_profit.toFixed(4));
                  reward = Math.abs(take_profit - entry_price);
                  rr = reward / risk;
                }

                // Sizing & Risk Veto
                const risk_amount_usd = current_balance * (risk_percent / 100);
                const position_size = parseFloat((risk_amount_usd / risk).toFixed(4));

                const proposedTotalRiskUsd = risk * position_size;
                const maxAllowedRiskUsd = current_balance * (max_risk_limit_pct / 100);

                if (proposedTotalRiskUsd <= maxAllowedRiskUsd) {
                  active_trade = {
                    id: crypto.randomUUID(),
                    timestamp: new Date(candle.t).toISOString(),
                    direction,
                    entry_price: parseFloat(entry_price.toFixed(4)),
                    exit_price: null,
                    stop_loss: parseFloat(stop_loss.toFixed(4)),
                    take_profit: parseFloat(take_profit.toFixed(4)),
                    realized_pnl: null,
                    roi: null,
                    position_size,
                    status: "OPEN",
                    exit_timestamp: null,
                    logic_trigger: strategy_name,
                    risk_amount_usd,
                    ipda_metrics_at_entry: {
                      trend: data.ipda_metrics.current_trend || "UNSET",
                      ols_p_value: data.ipda_metrics.institutional_sponsorship?.statistical_validation?.p_value ?? 1.0,
                      displacement: data.ipda_metrics.institutional_sponsorship?.anomaly_multiplier ?? 0,
                      premium_discount_status: data.ipda_metrics.current_pricing || "UNKNOWN"
                    }
                  };
                }
              }
            }
          }
        }

        // Close any remaining active position at the very last candle close to avoid open float
        if (active_trade) {
          const finalCandle = activeCandles[activeCandles.length - 1];
          const pnl = active_trade.direction === "LONG"
            ? (finalCandle.c - active_trade.entry_price) * active_trade.position_size
            : (active_trade.entry_price - finalCandle.c) * active_trade.position_size;
          
          current_balance += pnl;
          active_trade.exit_price = finalCandle.c;
          active_trade.realized_pnl = parseFloat(pnl.toFixed(4));
          active_trade.roi = parseFloat(((pnl / active_trade.risk_amount_usd) * 100).toFixed(4));
          active_trade.status = "CLOSED";
          active_trade.exit_timestamp = new Date(finalCandle.t).toISOString();
          trades_ledger.push(active_trade);
          active_trade = null;
        }

        sendChunk({ type: "status", message: "Saving execution run metadata and trades into the database..." });

        // Calculate summary statistics
        const total_trades = trades_ledger.length;
        const winning_trades = trades_ledger.filter(t => t.realized_pnl > 0).length;
        const losing_trades = trades_ledger.filter(t => t.realized_pnl <= 0).length;
        const win_rate_pct = total_trades > 0 ? parseFloat(((winning_trades / total_trades) * 100).toFixed(2)) : 0.00;
        const total_pnl = parseFloat((current_balance - initial_capital).toFixed(4));

        // Insert into runs
        const runRes = await sql`
          INSERT INTO quant_lab_runs (
            name, strategy_config, symbol, start_date, end_date, initial_balance, final_balance,
            total_trades, winning_trades, losing_trades, win_rate_pct, total_pnl
          ) VALUES (
            ${strategy_name}, ${JSON.stringify(strategy_config)}, ${symbol}, ${start_date}, ${end_date},
            ${initial_capital}, ${current_balance}, ${total_trades}, ${winning_trades}, ${losing_trades},
            ${win_rate_pct}, ${total_pnl}
          ) RETURNING id, created_at
        `;

        const runId = runRes.rows[0].id;
        const createdAt = runRes.rows[0].created_at;

        // Insert trades in batch or sequentially
        for (const trade of trades_ledger) {
          await sql`
            INSERT INTO quant_lab_trades (
              run_id, timestamp, direction, entry_price, exit_price, stop_loss, take_profit,
              realized_pnl, roi, position_size, status, exit_timestamp, logic_trigger, ipda_metrics_at_entry
            ) VALUES (
              ${runId}, ${trade.timestamp}, ${trade.direction}, ${trade.entry_price}, ${trade.exit_price},
              ${trade.stop_loss}, ${trade.take_profit}, ${trade.realized_pnl}, ${trade.roi}, ${trade.position_size},
              ${trade.status}, ${trade.exit_timestamp}, ${trade.logic_trigger}, ${JSON.stringify(trade.ipda_metrics_at_entry)}
            )
          `;
        }

        sendChunk({
          type: "complete",
          run: {
            id: runId,
            name: strategy_name,
            strategy_config,
            symbol,
            start_date,
            end_date,
            initial_balance: initial_capital,
            final_balance: current_balance,
            total_trades,
            winning_trades,
            losing_trades,
            win_rate_pct,
            total_pnl,
            created_at: createdAt
          },
          trades: trades_ledger
        });

      } catch (err: any) {
        console.error("[QUANT LAB API RUN ERROR]:", err);
        sendChunk({ type: "error", error: err.message });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  });
}
