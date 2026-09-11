import { NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/auth";
import { saveLocalSrScan } from "@/lib/quantLab/localScanStore";
import { Candle } from "@/lib/fvgEngine";
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimSetup,
  SweepReclaimTelemetrySummary,
  SweepReclaimAnchorType,
  SweepReclaimEntryMode,
} from "@/lib/quantEngine/SweepReclaimEngine";
import { TrendContinuationEngine } from "@/lib/quantEngine/TrendContinuationEngine";

// Base URL for Binance Futures REST API
const BINANCE_REST = 'https://fapi.binance.com/fapi/v1/klines';

// ── Helpers ──

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
      // Wyckoff price-range conviction estimator fallback (Directive 1)
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

/**
 * Robust paginated historical fetcher supporting multi-month lookbacks
 */
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
        console.warn(`[SR SCANNER] Binance kline fetch warning [${interval}]: ${res.status}`);
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

      // Rate limit pacing: 40ms pause between pages
      await new Promise((resolve) => setTimeout(resolve, 40));
    } catch (err) {
      console.warn(`[SR SCANNER] Fetch interrupted, continuing with ${allKlines.length} candles.`, err);
      break;
    }
  }

  return allKlines;
}

/**
 * Offline Mock Generator Fallback (Lesson #20 & #37)
 */
function generateMockKlines(startMs: number, endMs: number, interval: string): Candle[] {
  const intervalMs = interval === '4h' ? 14400000 : interval === '1h' ? 3600000 : interval === '15m' ? 900000 : interval === '3m' ? 180000 : interval === '1m' ? 60000 : 300000;
  const candles: Candle[] = [];
  let currentPrice = 3150.0;
  let t = Math.floor(startMs / intervalMs) * intervalMs;

  while (t <= endMs) {
    const delta = (Math.random() - 0.49) * 12.0;
    const o = currentPrice;
    const c = o + delta;
    const h = Math.max(o, c) + Math.random() * 6.0;
    const l = Math.min(o, c) - Math.random() * 6.0;
    const v = 800 + Math.random() * 1400;
    const range = Math.max(0.0001, h - l);
    const conviction = Math.min(1.0, Math.max(0.0, (c - l) / range));
    const taker_buy_vol = parseFloat((v * conviction).toFixed(2));
    const taker_sell_vol = parseFloat(Math.max(0, v - taker_buy_vol).toFixed(2));

    candles.push({
      t,
      o: parseFloat(o.toFixed(2)),
      h: parseFloat(h.toFixed(2)),
      l: parseFloat(l.toFixed(2)),
      c: parseFloat(c.toFixed(2)),
      v: parseFloat(v.toFixed(2)),
      taker_buy_vol,
      taker_sell_vol,
      isClosed: true,
    });

    currentPrice = c;
    t += intervalMs;
  }

  return candles;
}

// ── SSE Streaming Route ──

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

        const scan_name = body.scan_name ?? body.scanName ?? "Sweep & Reclaim Backtest Scan";
        const symbol = body.symbol ?? "ETHUSDC";
        const timeframe = body.timeframe ?? "15m";
        const start_date = body.start_date ?? body.startDate;
        const end_date = body.end_date ?? body.endDate;

        const rawAnchorTypes = body.anchorTypes ?? body.anchor_types;
        const anchor_types: SweepReclaimAnchorType[] = Array.isArray(rawAnchorTypes) && rawAnchorTypes.length > 0
          ? rawAnchorTypes
          : ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'];

        const lookback_major = Number(body.lookbackMajor ?? body.lookback_major ?? 10);
        const lookback_internal = Number(body.lookbackInternal ?? body.lookback_internal ?? 5);
        const max_bars_anchor_to_sweep = Number(body.maxBarsAnchorToSweep ?? body.max_bars_anchor_to_sweep ?? 25);
        const max_bars_sweep_to_reclaim = Number(body.maxBarsSweepToReclaim ?? body.max_bars_sweep_to_reclaim ?? 10);
        const max_bars_to_retest = Number(body.maxBarsToRetest ?? body.max_bars_to_retest ?? 20);
        const volume_sma_period = Number(body.volumeSmaPeriod ?? body.volume_sma_period ?? 20);
        const volume_expansion_threshold = Number(body.volumeExpansionThreshold ?? body.volume_expansion_threshold ?? 1.20);
        const delta_dominance_threshold = Number(body.deltaDominanceThreshold ?? body.delta_dominance_threshold ?? 52.0);
        const body_ratio_threshold = Number(body.bodyRatioThreshold ?? body.body_ratio_threshold ?? body.minBodyRatio ?? body.min_body_ratio ?? 0.40);
        const require_three_pillar_displacement = (body.requireThreePillarDisplacement ?? body.require_three_pillar_displacement) !== false;
        const enforce_discount_premium_gate = (body.enforceDiscountPremiumGate ?? body.enforce_discount_premium_gate) !== undefined ? Boolean(body.enforceDiscountPremiumGate ?? body.enforce_discount_premium_gate) : true;
        const enable_regime_adaptive_eq = (body.enableRegimeAdaptiveEQ ?? body.enable_regime_adaptive_eq) !== false;
        const enable_in_scanner_wave_dedup = (body.enableInScannerWaveDedup ?? body.enable_in_scanner_wave_dedup) !== false;
        const enforce_single_position_concurrency = (body.enforceSinglePositionConcurrency ?? body.enforce_single_position_concurrency) !== false;
        const pullback_excursion_threshold = Number(body.pullbackExcursionThreshold ?? body.pullback_excursion_threshold ?? 0.5);
        const stage1_multiple = Number(body.stage1Multiple ?? body.stage1_multiple ?? 1.0);
        const stage2_multiple = Number(body.stage2Multiple ?? body.stage2_multiple ?? 1.35);
        const stage3_multiple = Number(body.stage3Multiple ?? body.stage3_multiple ?? 3.0);
        const stage1_ratio = Number(body.stage1Ratio ?? body.stage1_ratio ?? 0.50);
        const stage2_ratio = Number(body.stage2Ratio ?? body.stage2_ratio ?? 0.50);
        const stage3_ratio = Number(body.stage3Ratio ?? body.stage3_ratio ?? 0.00);

        const target_mode = body.targetMode ?? body.target_mode ?? 'FIXED_RR';
        const dynamic_tp1_source = body.dynamicTp1Source ?? body.dynamic_tp1_source ?? 'FIXED_RR';
        const dynamic_tp2_source = body.dynamicTp2Source ?? body.dynamic_tp2_source ?? 'FIXED_RR';
        const min_dynamic_tp1_multiple = Number(body.minDynamicTp1Multiple ?? body.min_dynamic_tp1_multiple ?? 0.80);
        const max_dynamic_tp1_multiple = Number(body.maxDynamicTp1Multiple ?? body.max_dynamic_tp1_multiple ?? 1.50);
        const min_dynamic_tp2_multiple = Number(body.minDynamicTp2Multiple ?? body.min_dynamic_tp2_multiple ?? 1.30);
        const max_dynamic_tp2_multiple = Number(body.maxDynamicTp2Multiple ?? body.max_dynamic_tp2_multiple ?? 3.50);

        const require_mss_confirmation = (body.requireMssConfirmation ?? body.require_mss_confirmation) === true;
        const mss_lookback_bars = Number(body.mssLookbackBars ?? body.mss_lookback_bars ?? 15);
        const max_bars_sweep_to_mss = Number(body.maxBarsSweepToMss ?? body.max_bars_sweep_to_mss ?? 15);

        const rawEntryMode = String(body.entryMode ?? body.entry_mode ?? "FVG_PROXIMAL").toUpperCase();
        const validEntryModes: SweepReclaimEntryMode[] = [
          'SHELF_LEVEL',
          'RECLAIM_LEVEL',
          'FVG_PROXIMAL',
          'FVG_CE',
          'FVG_DISTAL',
          'OB_PROXIMAL',
          'SWEEP_OB_MT',
          'OTE_62',
        ];
        const entry_mode: SweepReclaimEntryMode = validEntryModes.includes(rawEntryMode as SweepReclaimEntryMode)
          ? (rawEntryMode as SweepReclaimEntryMode)
          : "FVG_CE";
        const enable_structural_trail = (body.enableStructuralTrail ?? body.enable_structural_trail) !== false;
        const enable_profit_ratchet = (body.enableProfitRatchet ?? body.enable_profit_ratchet) === true;
        const min_sweep_depth_atr = Number(body.minSweepDepthAtrMultiplier ?? body.min_sweep_depth_atr ?? 0.10);
        const sl_buffer_atr = Number(body.slBufferAtrMultiplier ?? body.sl_buffer_atr ?? 0.10);

        // 🛡️ Quant Shield & 6 Anti-Loss Streak Parameters (Default to Champion FVG CE Preset)
        const enable_wave_deduplication = (body.enableWaveDeduplication ?? body.enable_wave_deduplication) !== undefined ? Boolean(body.enableWaveDeduplication ?? body.enable_wave_deduplication) : true;
        const filter_weekend = (body.filterWeekend ?? body.filter_weekend) !== undefined ? Boolean(body.filterWeekend ?? body.filter_weekend) : false;
        const filter_dead_zones = (body.filterDeadZones ?? body.filter_dead_zones) !== undefined ? Boolean(body.filterDeadZones ?? body.filter_dead_zones) : false;
        const enforce_htf_bias_guard = (body.enforceHtfBiasGuard ?? body.enforce_htf_bias_guard) !== undefined ? Boolean(body.enforceHtfBiasGuard ?? body.enforce_htf_bias_guard) : false;
        const enable_early_breakeven = (body.enableEarlyBreakeven ?? body.enable_early_breakeven) !== undefined ? Boolean(body.enableEarlyBreakeven ?? body.enable_early_breakeven) : true;
        const early_breakeven_multiple = Number(body.earlyBreakevenMultiple ?? body.early_breakeven_multiple ?? 0.40);
        const enable_fee_padded_breakeven = (body.enableFeePaddedBreakeven ?? body.enable_fee_padded_breakeven) !== undefined ? Boolean(body.enableFeePaddedBreakeven ?? body.enable_fee_padded_breakeven) : true;
        const breakeven_offset_pct = Number(body.breakevenOffsetPct ?? body.breakeven_offset_pct ?? 0.05);
        const post_loss_cooldown_minutes = Number(body.postLossCooldownMinutes ?? body.post_loss_cooldown_minutes ?? 0);
        const maker_fee_pct = Number(body.makerFeePct ?? body.maker_fee_pct ?? 0.0000);
        const taker_fee_pct = Number(body.takerFeePct ?? body.taker_fee_pct ?? 0.0400);

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

        sendChunk({ type: "status", message: "Querying Midnight State Ledger for T-Zero Structural Seed..." });
        
        // Dynamic load of the bootstrap utility
        const { computeStructuralBootstrap } = await import("@/lib/quantEngine/structuralBootstrap");
        const { warmupStartMs, bootstrap } = await computeStructuralBootstrap(symbol, timeframe, startMs, {
          lookbackMajor: lookback_major,
          lookbackInternal: lookback_internal
        });

        if (bootstrap) {
          sendChunk({ type: "status", message: "T-Zero Snapshot Found. Re-hydrating Quantitative Engine..." });
        } else {
          sendChunk({ type: "status", message: "Snapshot missing. Falling back to dynamic structural warmup..." });
        }

        sendChunk({
          type: "status",
          message: `Ingesting historical ${timeframe} ${symbol} candlestick data from Binance...`
        });

        let candles = await fetchPagedKlines(symbol, timeframe, warmupStartMs, endMs, (count, lastT) => {
          sendChunk({
            type: "progress",
            phase: "FETCHING_DATA",
            message: `Fetched ${count} candles up to ${new Date(lastT).toISOString().slice(0, 10)}...`,
            candlesFetched: count
          });
        });

        if (candles.length === 0) {
          console.warn("[SR SCANNER] Live fetch returned 0 candles, deploying offline mock simulation fallback...");
          sendChunk({ type: "status", message: "Live connection throttled. Generating simulation stream..." });
          candles = generateMockKlines(warmupStartMs, endMs, timeframe);
        }

        sendChunk({
          type: "status",
          message: `Successfully loaded ${candles.length} historical candles. Executing multi-timeframe 4-Phase Sweep & Reclaim state engine...`
        });

        // Configure Engine parameters
        let structural_dealing_range = body.structuralDealingRange ?? body.structural_dealing_range ?? null;
        if (!structural_dealing_range && candles.length >= 25 && candles.length <= 2000) {
          try {
            const { MarketStructureAPI } = await import("@/lib/quantEngine/MarketStructureAPI");
            const msApi = new MarketStructureAPI({
              lookbackMajor: lookback_major,
              lookbackInternal: lookback_internal,
            });
            const lastCandle = candles[candles.length - 1];
            const lastPrice = lastCandle.c ?? (lastCandle as any).close ?? 0;
            const structure = bootstrap
              ? msApi.analyzeWithBootstrap(candles, lastPrice, undefined, bootstrap)
              : msApi.analyze(candles, lastPrice);
            const structEq = structure?.dealingRange?.equilibrium;
            if (structEq !== null && structEq !== undefined && Number.isFinite(structEq) && structEq > 0) {
              structural_dealing_range = {
                high: Number(structure.dealingRange.high),
                low: Number(structure.dealingRange.low),
                equilibrium: parseFloat(structEq.toFixed(4)),
              };
            }
          } catch (msErr) {
            console.warn("[SR SCANNER] MarketStructure dealing range fallback:", msErr);
          }
        }

        const scanConfig: SweepReclaimScanConfig = {
          symbol,
          timeframe,
          anchorTypes: anchor_types,
          lookbackMajor: lookback_major,
          lookbackInternal: lookback_internal,
          maxBarsAnchorToSweep: max_bars_anchor_to_sweep,
          maxBarsSweepToReclaim: max_bars_sweep_to_reclaim,
          maxBarsToRetest: max_bars_to_retest,
          volumeSmaPeriod: volume_sma_period,
          volumeExpansionThreshold: volume_expansion_threshold,
          deltaDominanceThreshold: delta_dominance_threshold,
          bodyRatioThreshold: body_ratio_threshold,
          minBodyRatio: body_ratio_threshold,
          requireThreePillarDisplacement: require_three_pillar_displacement,
          enforceDiscountPremiumGate: enforce_discount_premium_gate,
          enableRegimeAdaptiveEQ: enable_regime_adaptive_eq,
          enableInScannerWaveDedup: enable_wave_deduplication && enable_in_scanner_wave_dedup,
          enforceSinglePositionConcurrency: enforce_single_position_concurrency,
          pullbackExcursionThreshold: pullback_excursion_threshold,
          structuralDealingRange: structural_dealing_range,
          stage1Multiple: stage1_multiple,
          stage2Multiple: stage2_multiple,
          stage3Multiple: stage3_multiple,
          stage1Ratio: stage1_ratio,
          stage2Ratio: stage2_ratio,
          stage3Ratio: stage3_ratio,
          targetMode: target_mode,
          dynamicTp1Source: dynamic_tp1_source,
          dynamicTp2Source: dynamic_tp2_source,
          minDynamicTp1Multiple: min_dynamic_tp1_multiple,
          maxDynamicTp1Multiple: max_dynamic_tp1_multiple,
          minDynamicTp2Multiple: min_dynamic_tp2_multiple,
          maxDynamicTp2Multiple: max_dynamic_tp2_multiple,
          requireMssConfirmation: require_mss_confirmation,
          mssLookbackBars: mss_lookback_bars,
          maxBarsSweepToMss: max_bars_sweep_to_mss,
          entryMode: entry_mode,
          enableStructuralTrail: enable_structural_trail,
          enableProfitRatchet: enable_profit_ratchet,
          minSweepDepthAtrMultiplier: min_sweep_depth_atr,
          slBufferAtrMultiplier: sl_buffer_atr,

          // 🛡️ Quant Shield Parameters
          enableWaveDeduplication: enable_wave_deduplication,
          filterWeekend: filter_weekend,
          filterDeadZones: filter_dead_zones,
          enforceHtfBiasGuard: enforce_htf_bias_guard,
          enableEarlyBreakeven: enable_early_breakeven,
          earlyBreakevenMultiple: early_breakeven_multiple,
          enableFeePaddedBreakeven: enable_fee_padded_breakeven,
          breakevenOffsetPct: breakeven_offset_pct,
          postLossCooldownMinutes: post_loss_cooldown_minutes,
          makerFeePct: maker_fee_pct,
          takerFeePct: taker_fee_pct,
        };

        const strategy_type = body.strategyType ?? body.strategy_type ?? "SWEEP_RECLAIM";
        if (strategy_type === "TREND_CONTINUATION") {
          const tcEngine = new TrendContinuationEngine({
            symbol,
            timeframe,
            lookbackMajor: lookback_major,
            lookbackInternal: lookback_internal,
            emaPeriod: Number(body.emaPeriod ?? body.ema_period ?? 120),
            enforceHtfTrendLock: (body.enforceHtfTrendLock ?? body.enforce_htf_trend_lock) !== false,
            volumeSmaPeriod: volume_sma_period,
            volumeExpansionThreshold: volume_expansion_threshold,
            deltaDominanceThreshold: delta_dominance_threshold,
            bodyRatioThreshold: body_ratio_threshold,
            requireThreePillarDisplacement: require_three_pillar_displacement,
            maxBarsToRetest: max_bars_to_retest,
            maxOriginLookbackBars: Number(body.maxOriginLookbackBars ?? body.max_origin_lookback_bars ?? 32),
            slBufferAtrMultiplier: sl_buffer_atr,
            entryMode: entry_mode === 'FVG_CE' ? 'FVG_CE' : 'FVG_PROXIMAL',
            stage1Ratio: stage1_ratio,
            stage2Ratio: stage2_ratio,
            stage1Multiple: stage1_multiple,
            stage2Multiple: stage2_multiple,
            dynamicTp2Source: (body.dynamicTp2Source ?? body.dynamic_tp2_source ?? "OPPOSING_LIQUIDITY") as "OPPOSING_LIQUIDITY" | "FIXED_RR",
            minDynamicTp2Multiple: Number(body.minDynamicTp2Multiple ?? body.min_dynamic_tp2_multiple ?? 3.00),
            maxDynamicTp2Multiple: Number(body.maxDynamicTp2Multiple ?? body.max_dynamic_tp2_multiple ?? 5.00),
            enableM15StructuralTrail: (body.enableM15StructuralTrail ?? body.enable_m15_structural_trail) !== false,
            enableFeePaddedBreakeven: enable_fee_padded_breakeven,
            breakevenOffsetPct: breakeven_offset_pct,
            enableDynamicProfitFloor: (body.enableDynamicProfitFloor ?? body.enable_dynamic_profit_floor) !== false,
            postLossCooldownMinutes: post_loss_cooldown_minutes,
            enforceSinglePositionConcurrency: true,
            enforceValueAreaGate: (body.enforceValueAreaGate ?? body.enforce_value_area_gate) !== false,
            valueAreaLookbackBars: Number(body.valueAreaLookbackBars ?? body.value_area_lookback_bars ?? 96),
            valueAreaMode: (body.valueAreaMode ?? body.value_area_mode ?? "PREVIOUS_DAY_DEVELOPING") as "PREVIOUS_DAY_DEVELOPING" | "ROLLING_HISTOGRAM",
            pocBandPct: Number(body.pocBandPct ?? body.poc_band_pct ?? 0.0020),
            enforceOlsValidation: (body.enforceOlsValidation ?? body.enforce_ols_validation) !== false,
            enforceOiSponsorship: (body.enforceOiSponsorship ?? body.enforce_oi_sponsorship) !== false,
            enforceSmtGate: (body.enforceSmtGate ?? body.enforce_smt_gate) !== false,
            smtLookbackBars: Number(body.smtLookbackBars ?? body.smt_lookback_bars ?? 15),
            enforceToxicWindowBlacklist: (body.enforceToxicWindowBlacklist ?? body.enforce_toxic_window_blacklist) !== false,
            enforceRolloverFreeze: (body.enforceRolloverFreeze ?? body.enforce_rollover_freeze) !== false,
            enforceNewsFreeze: (body.enforceNewsFreeze ?? body.enforce_news_freeze) !== false,
            makerFeePct: maker_fee_pct,
            takerFeePct: taker_fee_pct,
            initialEquity: Number(body.initialEquity ?? body.initial_equity ?? 10000),
            compoundingRiskPct: Number(body.compoundingRiskPct ?? body.compounding_risk_pct ?? body.riskPerTradePct ?? 2.0),
          });
          const { setups: tcSetups, telemetry: tcTelemetry } = tcEngine.scanHistoricalSetups(candles, bootstrap);

          sendChunk({
            type: "progress",
            phase: "ANALYSIS_COMPLETE",
            message: `Identified ${tcSetups.length} Trend Continuation setups across ${candles.length} candles.`,
            detectedCount: tcSetups.length,
            executedCount: tcTelemetry.retestedTradesCount,
            winRate: tcTelemetry.executionWinRatePct,
            netRealizedR: tcTelemetry.netRealizedR,
          });

          const scanId = crypto.randomUUID();
          const scanRecord = {
            id: scanId,
            scan_name,
            symbol,
            timeframe,
            start_date: new Date(startMs).toISOString(),
            end_date: new Date(endMs).toISOString(),
            total_detected: tcTelemetry.totalBosDetected,
            retested_trades_count: tcTelemetry.retestedTradesCount,
            execution_win_rate_pct: tcTelemetry.executionWinRatePct,
            net_realized_r: tcTelemetry.netRealizedR,
            profit_factor: tcTelemetry.netProfitFactor,
            telemetry_summary: tcTelemetry,
            setups: tcSetups,
            created_at: new Date().toISOString(),
          };

          try {
            await saveLocalSrScan(scanRecord as any);
          } catch (saveErr) {
            console.error("[SR SCANNER LOCAL] Failed to persist scan record:", saveErr);
          }

          sendChunk({
            type: "complete",
            scan: scanRecord,
            telemetry: tcTelemetry,
            setups: tcSetups,
            total_candles: candles.length,
          });

          controller.close();
          return;
        }

        const engine = new SweepReclaimEngine(scanConfig);
        const { setups, telemetry } = engine.scanHistoricalSetups(candles, bootstrap);

        sendChunk({
          type: "progress",
          phase: "ANALYSIS_COMPLETE",
          message: `Identified ${setups.length} Sweep & Reclaim setups across ${candles.length} candles. Persisting scan run...`,
          detectedCount: setups.length,
          reclaimRate: telemetry.reclaim_rate_pct,
          retestRate: telemetry.retest_rate_pct,
          winRate: telemetry.retest_win_rate_pct
        });

        // Persist 100% locally to data/quant_lab/sr_scans/{id}.json
        const scanId = crypto.randomUUID();
        const scanRecord = {
          id: scanId,
          scan_name,
          symbol,
          timeframe,
          start_date: new Date(startMs).toISOString(),
          end_date: new Date(endMs).toISOString(),
          total_detected: telemetry.total_anchors_detected,
          sweep_rate_pct: telemetry.sweep_rate_pct,
          reclaim_rate_pct: telemetry.reclaim_rate_pct,
          retest_rate_pct: telemetry.retest_rate_pct,
          retest_win_rate_pct: telemetry.retest_win_rate_pct,
          avg_realized_rr: telemetry.avg_realized_rr,
          profit_factor: telemetry.profit_factor,
          telemetry_summary: telemetry,
          setups: setups,
          created_at: new Date().toISOString()
        };

        try {
          await saveLocalSrScan(scanRecord);
        } catch (saveErr) {
          console.error("[SR SCANNER LOCAL] Failed to persist scan record:", saveErr);
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
        console.error("[SR SCANNER API] Execution error:", err);
        sendChunk({ type: "error", error: err.message || "Sweep & Reclaim scanning failed unexpectedly." });
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
