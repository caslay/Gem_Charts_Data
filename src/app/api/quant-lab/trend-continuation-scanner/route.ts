import { NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/auth";
import { saveLocalSrScan } from "@/lib/quantLab/localScanStore";
import { Candle } from "@/lib/fvgEngine";
import {
  TrendContinuationEngine,
  TrendContinuationConfig,
  TrendContinuationSetup,
  TrendContinuationTelemetrySummary,
} from "@/lib/quantEngine/TrendContinuationEngine";

// Base URL for Binance Futures REST API
const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/klines';

function parseBinanceKlines(raw: unknown[][]): Candle[] {
  return raw.map((c) => {
    const o = parseFloat(c[1] as string);
    const h = parseFloat(c[2] as string);
    const l = parseFloat(c[3] as string);
    const close = parseFloat(c[4] as string);
    const v = parseFloat(c[5] as string) || 0;

    let rawTakerBuy = parseFloat(c[9] as string);
    let taker_buy_vol: number;
    if (Number.isFinite(rawTakerBuy) && !isNaN(rawTakerBuy) && rawTakerBuy > 0) {
      taker_buy_vol = parseFloat(rawTakerBuy.toFixed(4));
    } else {
      const range = Math.max(0.0001, h - l);
      const conviction = Math.min(1.0, Math.max(0.0, (close - l) / range));
      taker_buy_vol = parseFloat((conviction * v).toFixed(4));
    }
    const taker_sell_vol = parseFloat(Math.max(0, v - taker_buy_vol).toFixed(4));

    return {
      t: Number(c[0]),
      o,
      h,
      l,
      c: close,
      v,
      taker_buy_vol,
      taker_sell_vol,
      isClosed: true,
    };
  });
}

async function fetchPagedKlines(
  symbol: string,
  interval: string,
  startMs: number,
  endMs: number,
  onProgress?: (fetchedCount: number, currentTimestamp: number) => void
): Promise<Candle[]> {
  const allKlines: Candle[] = [];
  let currentStart = startMs;
  const limit = 1000;

  while (currentStart < endMs) {
    const url = `${BINANCE_REST}?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&endTime=${endMs - 1}&limit=${limit}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) {
        console.warn(`[TC SCANNER] Binance kline fetch warning [${interval}]: ${res.status}`);
        break;
      }
      const raw: unknown[][] = await res.json();
      if (!raw || raw.length === 0) break;

      const parsed = parseBinanceKlines(raw);
      allKlines.push(...parsed);

      if (onProgress) {
        onProgress(allKlines.length, parsed[parsed.length - 1].t);
      }

      const lastTime = Number(raw[raw.length - 1][0]);
      if (lastTime <= currentStart) break;
      currentStart = lastTime + 1;

      if (raw.length < limit) break;

      await new Promise((resolve) => setTimeout(resolve, 40));
    } catch (err) {
      console.warn(`[TC SCANNER] Fetch interrupted, continuing with ${allKlines.length} candles.`, err);
      break;
    }
  }

  return allKlines;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendChunk = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const body = await req.json();

        const scan_name = body.scan_name ?? body.scanName ?? "Trend Continuation & BOS Expansion Backtest";
        const symbol = body.symbol ?? "ETHUSDC";
        const timeframe = body.timeframe ?? "15m";
        const start_date = body.start_date ?? body.startDate;
        const end_date = body.end_date ?? body.endDate;

        const lookback_major = Number(body.lookbackMajor ?? body.lookback_major ?? 15);
        const lookback_internal = Number(body.lookbackInternal ?? body.lookback_internal ?? 10);
        const ema_period = Number(body.emaPeriod ?? body.ema_period ?? 120);
        const enforce_htf_trend_lock = (body.enforceHtfTrendLock ?? body.enforce_htf_trend_lock) !== false;

        const volume_sma_period = Number(body.volumeSmaPeriod ?? body.volume_sma_period ?? 20);
        const volume_expansion_threshold = Number(body.volumeExpansionThreshold ?? body.volume_expansion_threshold ?? 1.25);
        const delta_dominance_threshold = Number(body.deltaDominanceThreshold ?? body.delta_dominance_threshold ?? 52.0);
        const body_ratio_threshold = Number(body.bodyRatioThreshold ?? body.body_ratio_threshold ?? 0.50);
        const require_three_pillar_displacement = (body.requireThreePillarDisplacement ?? body.require_three_pillar_displacement) !== false;

        const max_bars_to_retest = Number(body.maxBarsToRetest ?? body.max_bars_to_retest ?? 12);
        const max_origin_lookback_bars = Number(body.maxOriginLookbackBars ?? body.max_origin_lookback_bars ?? 32);
        const sl_buffer_atr = Number(body.slBufferAtrMultiplier ?? body.sl_buffer_atr ?? 0.10);
        const entry_mode = (body.entryMode ?? body.entry_mode ?? "FVG_PROXIMAL") as "FVG_PROXIMAL" | "FVG_CE";

        const stage1_ratio = Number(body.stage1Ratio ?? body.stage1_ratio ?? 0.30);
        const stage2_ratio = Number(body.stage2Ratio ?? body.stage2_ratio ?? 0.70);
        const stage1_multiple = Number(body.stage1Multiple ?? body.stage1_multiple ?? 1.50);
        const stage2_multiple = Number(body.stage2Multiple ?? body.stage2_multiple ?? 4.00);

        const dynamic_tp2_source = (body.dynamicTp2Source ?? body.dynamic_tp2_source ?? "OPPOSING_LIQUIDITY") as "OPPOSING_LIQUIDITY" | "FIXED_RR";
        const min_dynamic_tp2_multiple = Number(body.minDynamicTp2Multiple ?? body.min_dynamic_tp2_multiple ?? 3.00);
        const max_dynamic_tp2_multiple = Number(body.maxDynamicTp2Multiple ?? body.max_dynamic_tp2_multiple ?? 5.00);

        const enable_m15_structural_trail = (body.enableM15StructuralTrail ?? body.enable_m15_structural_trail) !== false;
        const enable_fee_padded_breakeven = (body.enableFeePaddedBreakeven ?? body.enable_fee_padded_breakeven) !== false;
        const breakeven_offset_pct = Number(body.breakevenOffsetPct ?? body.breakeven_offset_pct ?? 0.015);
        const enable_dynamic_profit_floor = (body.enableDynamicProfitFloor ?? body.enable_dynamic_profit_floor) !== false;
        const post_loss_cooldown_minutes = Number(body.postLossCooldownMinutes ?? body.post_loss_cooldown_minutes ?? 45);

        const enforce_value_area_gate = (body.enforceValueAreaGate ?? body.enforce_value_area_gate) !== false;
        const value_area_lookback_bars = Number(body.valueAreaLookbackBars ?? body.value_area_lookback_bars ?? 96);
        const value_area_mode = (body.valueAreaMode ?? body.value_area_mode ?? "PREVIOUS_DAY_DEVELOPING") as "PREVIOUS_DAY_DEVELOPING" | "ROLLING_HISTOGRAM";
        const poc_band_pct = Number(body.pocBandPct ?? body.poc_band_pct ?? 0.0020);

        const enforce_ols_validation = (body.enforceOlsValidation ?? body.enforce_ols_validation) !== false;
        const enforce_oi_sponsorship = (body.enforceOiSponsorship ?? body.enforce_oi_sponsorship) !== false;
        const enforce_smt_gate = (body.enforceSmtGate ?? body.enforce_smt_gate) !== false;
        const smt_lookback_bars = Number(body.smtLookbackBars ?? body.smt_lookback_bars ?? 15);

        const enforce_toxic_window_blacklist = (body.enforceToxicWindowBlacklist ?? body.enforce_toxic_window_blacklist) !== false;
        const enforce_rollover_freeze = (body.enforceRolloverFreeze ?? body.enforce_rollover_freeze) !== false;
        const enforce_news_freeze = (body.enforceNewsFreeze ?? body.enforce_news_freeze) !== false;

        const maker_fee_pct = Number(body.makerFeePct ?? body.maker_fee_pct ?? 0.0000);
        const taker_fee_pct = Number(body.takerFeePct ?? body.taker_fee_pct ?? 0.0400);
        const initial_equity = Number(body.initialEquity ?? body.initial_equity ?? 10000);
        const compounding_risk_pct = Number(body.compoundingRiskPct ?? body.compounding_risk_pct ?? body.riskPerTradePct ?? 2.0);

        if (!start_date || !end_date) {
          sendChunk({ type: "error", error: "Missing required date range parameters: start_date and end_date are required." });
          controller.close();
          return;
        }

        const startMs = Date.parse(`${start_date}T00:00:00.000Z`);
        const endMs = Date.parse(`${end_date}T23:59:59.000Z`);

        if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
          sendChunk({ type: "error", error: "Invalid date range parameters." });
          controller.close();
          return;
        }

        // Dynamic load of the bootstrap utility
        const { computeStructuralBootstrap } = await import("@/lib/quantEngine/structuralBootstrap");
        const { warmupStartMs, bootstrap } = await computeStructuralBootstrap(symbol, timeframe, startMs, {
          lookbackMajor: lookback_major,
          lookbackInternal: lookback_internal
        });

        sendChunk({
          type: "status",
          message: `Ingesting historical ${timeframe} ${symbol} candlestick data for Trend Continuation scan...`
        });

        const candles = await fetchPagedKlines(symbol, timeframe, warmupStartMs, endMs, (count, lastT) => {
          sendChunk({
            type: "progress",
            phase: "FETCHING_DATA",
            message: `Fetched ${count} candles up to ${new Date(lastT).toISOString().slice(0, 10)}...`,
            candlesFetched: count
          });
        });

        sendChunk({
          type: "status",
          message: `Loaded ${candles.length} candles. Executing Engine 2: Trend Continuation & BOS Expansion state machine...`
        });

        const config: TrendContinuationConfig = {
          symbol,
          timeframe,
          lookbackMajor: lookback_major,
          lookbackInternal: lookback_internal,
          emaPeriod: ema_period,
          enforceHtfTrendLock: enforce_htf_trend_lock,
          volumeSmaPeriod: volume_sma_period,
          volumeExpansionThreshold: volume_expansion_threshold,
          deltaDominanceThreshold: delta_dominance_threshold,
          bodyRatioThreshold: body_ratio_threshold,
          requireThreePillarDisplacement: require_three_pillar_displacement,
          maxBarsToRetest: max_bars_to_retest,
          maxOriginLookbackBars: max_origin_lookback_bars,
          slBufferAtrMultiplier: sl_buffer_atr,
          entryMode: entry_mode,
          stage1Ratio: stage1_ratio,
          stage2Ratio: stage2_ratio,
          stage1Multiple: stage1_multiple,
          stage2Multiple: stage2_multiple,
          dynamicTp2Source: dynamic_tp2_source,
          minDynamicTp2Multiple: min_dynamic_tp2_multiple,
          maxDynamicTp2Multiple: max_dynamic_tp2_multiple,
          enableM15StructuralTrail: enable_m15_structural_trail,
          enableFeePaddedBreakeven: enable_fee_padded_breakeven,
          breakevenOffsetPct: breakeven_offset_pct,
          enableDynamicProfitFloor: enable_dynamic_profit_floor,
          postLossCooldownMinutes: post_loss_cooldown_minutes,
          enforceSinglePositionConcurrency: true,
          enforceValueAreaGate: enforce_value_area_gate,
          valueAreaLookbackBars: value_area_lookback_bars,
          valueAreaMode: value_area_mode,
          pocBandPct: poc_band_pct,
          enforceOlsValidation: enforce_ols_validation,
          enforceOiSponsorship: enforce_oi_sponsorship,
          enforceSmtGate: enforce_smt_gate,
          smtLookbackBars: smt_lookback_bars,
          enforceToxicWindowBlacklist: enforce_toxic_window_blacklist,
          enforceRolloverFreeze: enforce_rollover_freeze,
          enforceNewsFreeze: enforce_news_freeze,
          makerFeePct: maker_fee_pct,
          takerFeePct: taker_fee_pct,
          initialEquity: initial_equity,
          compoundingRiskPct: compounding_risk_pct,
        };

        const engine = new TrendContinuationEngine(config);
        const { setups, telemetry } = engine.scanHistoricalSetups(candles, bootstrap);

        sendChunk({
          type: "progress",
          phase: "ANALYSIS_COMPLETE",
          message: `Identified ${setups.length} Trend Continuation setups across ${candles.length} candles.`,
          detectedCount: setups.length,
          executedCount: telemetry.retestedTradesCount,
          winRate: telemetry.executionWinRatePct,
          netRealizedR: telemetry.netRealizedR,
        });

        const scanId = crypto.randomUUID();
        const scanRecord = {
          id: scanId,
          scan_name,
          symbol,
          timeframe,
          start_date: new Date(startMs).toISOString(),
          end_date: new Date(endMs).toISOString(),
          total_detected: telemetry.totalBosDetected,
          retested_trades_count: telemetry.retestedTradesCount,
          execution_win_rate_pct: telemetry.executionWinRatePct,
          net_realized_r: telemetry.netRealizedR,
          profit_factor: telemetry.netProfitFactor,
          telemetry_summary: telemetry,
          setups: setups,
          created_at: new Date().toISOString()
        };

        try {
          await saveLocalSrScan(scanRecord as any);
        } catch (saveErr) {
          console.error("[TC SCANNER LOCAL] Failed to persist scan record:", saveErr);
        }

        sendChunk({
          type: "complete",
          scan: scanRecord,
          telemetry,
          setups: setups,
          total_candles: candles.length
        });

        controller.close();
      } catch (err: any) {
        console.error("[TC SCANNER API] Execution error:", err);
        sendChunk({ type: "error", error: err.message || "Trend Continuation scanning failed unexpectedly." });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}
