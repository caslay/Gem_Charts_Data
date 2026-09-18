/**
 * scripts/export_live_ai_payload.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 100% Organic Live Binance Market Data Snapshot Exporter
 * ─────────────────────────────────────────────────────────────────────────────
 * Decoupled from synthetic test harnesses. Pulls authentic, real-time market data
 * directly from Binance Futures public REST endpoints, enforces hierarchical
 * timeframe consistency (15m ≡ 5m and 4H ≡ 1H invariants), hydrates native IPDA
 * institutional primitives, and serializes the genuine payload to:
 *   data/ai_15min_sync_payload_export.json
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import { fetchHistoricalKlines } from '../src/lib/daemon/restBootstrap';
import { fetchOIMetricsAndLiquidations } from '../src/lib/orderFlowEngine';
import {
  hydrateIpdaMetrics,
  reconcileHierarchicalCandles,
  detectSyntheticVolume,
  sanitizeCandleClosureInvariant,
} from '../src/lib/quantEngine/scheduledPayloadHydrator';
import { buildLiveSessionContext } from '../src/lib/sessionContext';
import { DEFAULT_ETH_SOP_SYSTEM_PROMPT } from '../src/lib/sopPromptBuilder';
import { synchronizeCandlesWithLiveEdge } from '../src/lib/daemon/headlessScheduler';
import { annotateCandlesWithVolumetricSignals } from '../src/utils/generateChartMarkers';
import { Candle } from '../src/lib/fvgEngine';
import { sql } from '../src/lib/postgres';

async function fetchLiveTickerPrice(symbol: string = 'ETHUSDC'): Promise<number> {
  const url = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol.toUpperCase()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch ticker price: HTTP ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { price?: string };
  const price = parseFloat(data.price || '0');
  if (isNaN(price) || price <= 0) throw new Error(`Invalid ticker price received: ${data.price}`);
  return price;
}

async function fetchBtcKlines(interval: '5m' | '15m', limit: number = 30): Promise<Candle[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
  if (!res.ok) return [];
  const raw = (await res.json()) as any[];
  if (!Array.isArray(raw)) return [];

  return raw.map((c) => {
    const v = parseFloat(c[5]) || 0;
    const takerBuy = parseFloat(c[9]) || 0;
    return {
      t: Number(c[0]),
      o: parseFloat(c[1]),
      h: parseFloat(c[2]),
      l: parseFloat(c[3]),
      c: parseFloat(c[4]),
      v,
      taker_buy_vol: takerBuy,
      taker_sell_vol: Math.max(0, v - takerBuy),
      isClosed: true,
    };
  });
}

async function main() {
  console.log('======================================================================');
  console.log('🚀 QUEGAR QUANT ENGINE — LIVE BINANCE MARKET SNAPSHOT EXPORTER');
  console.log('======================================================================\n');

  const symbol = 'ETHUSDC';
  const executionNow = new Date();
  const nowMs = executionNow.getTime();

  // 1. Fetch live mark / ticker price
  console.log(`1. Ingesting live ${symbol} mark price from Binance Futures...`);
  const livePrice = await fetchLiveTickerPrice(symbol);
  console.log(`   ✓ In-Flight Mark Price: $${livePrice.toFixed(2)} (t=${executionNow.toISOString()})\n`);

  // 2. Fetch genuine closed bars across 4H, 1H, 15M, 5M (100 bars each)
  console.log('2. Pulling latest 100 genuine closed bars across all operational intervals...');
  const [raw5m, raw15m, raw1h, raw4h, btc5m, btc15m] = await Promise.all([
    fetchHistoricalKlines(symbol, '5m', 100),
    fetchHistoricalKlines(symbol, '15m', 100),
    fetchHistoricalKlines(symbol, '1h', 100),
    fetchHistoricalKlines(symbol, '4h', 100),
    fetchBtcKlines('5m', 30),
    fetchBtcKlines('15m', 30),
  ]);

  console.log(`   ✓ Received 5m:  ${raw5m.length} bars`);
  console.log(`   ✓ Received 15m: ${raw15m.length} bars`);
  console.log(`   ✓ Received 1h:  ${raw1h.length} bars`);
  console.log(`   ✓ Received 4h:  ${raw4h.length} bars`);
  console.log(`   ✓ Received BTC: 5m (${btc5m.length} bars), 15m (${btc15m.length} bars)\n`);

  // 3. Ingest real Open Interest and Order Flow Delta
  console.log('3. Ingesting real Open Interest regime and Order Flow delta...');
  const isBullishCandle = raw15m.length > 0 ? raw15m[raw15m.length - 1].c >= raw15m[raw15m.length - 1].o : true;
  let oiMetrics = { open_interest_trend: 'UNAVAILABLE' };
  try {
    oiMetrics = await fetchOIMetricsAndLiquidations(symbol, isBullishCandle);
    console.log(`   ✓ Real Open Interest Regime: ${oiMetrics.open_interest_trend}`);
  } catch (err: any) {
    console.warn(`   ⚠️ OI ingestion warning: ${err?.message || err}. Falling back to order flow delta.`);
  }

  // 4. Workstream B: Enforce Cross-Timeframe Micro-Consistency (15m ≡ 5m and 4H ≡ 1H)
  console.log('\n4. Enforcing hierarchical cross-timeframe micro-consistency...');
  const reconciled15m = reconcileHierarchicalCandles(raw5m, raw15m, 5, 15);
  const reconciled4h = reconcileHierarchicalCandles(raw1h, raw4h, 60, 240);

  // Synchronize all timeframes with the live edge and sanitize historical closure invariant
  const candles5m = sanitizeCandleClosureInvariant(synchronizeCandlesWithLiveEdge(raw5m, 5, livePrice, nowMs));
  const candles15m = sanitizeCandleClosureInvariant(synchronizeCandlesWithLiveEdge(reconciled15m, 15, livePrice, nowMs));
  const candles1h = sanitizeCandleClosureInvariant(synchronizeCandlesWithLiveEdge(raw1h, 60, livePrice, nowMs));
  const candles4h = sanitizeCandleClosureInvariant(synchronizeCandlesWithLiveEdge(reconciled4h, 240, livePrice, nowMs));

  // Annotate volumetric signals
  annotateCandlesWithVolumetricSignals(candles5m);
  annotateCandlesWithVolumetricSignals(candles15m);
  annotateCandlesWithVolumetricSignals(candles1h);
  annotateCandlesWithVolumetricSignals(candles4h);

  // Verify 15m ≡ 5m invariant on closed candles
  const fifteenMinutesMs = 15 * 60 * 1000;
  let enclosed15mCount = 0;
  for (let i = 0; i < candles15m.length - 1; i++) {
    const parent = candles15m[i];
    const children = candles5m.filter((c) => c.t >= parent.t && c.t < parent.t + fifteenMinutesMs);
    if (children.length === 3 && children.every((c) => c.isClosed !== false)) {
      const expOpen = children[0].o;
      const expClose = children[2].c;
      const expHigh = Math.max(...children.map((c) => c.h));
      const expLow = Math.min(...children.map((c) => c.l));
      const expVol = parseFloat(children.reduce((s, c) => s + c.v, 0).toFixed(2));

      if (Math.abs(parent.o - expOpen) > 0.01) throw new Error(`Hierarchical 15m Open mismatch at ${new Date(parent.t).toISOString()}`);
      if (Math.abs(parent.c - expClose) > 0.01) throw new Error(`Hierarchical 15m Close mismatch at ${new Date(parent.t).toISOString()}`);
      if (Math.abs(parent.h - expHigh) > 0.01) throw new Error(`Hierarchical 15m High mismatch at ${new Date(parent.t).toISOString()}`);
      if (Math.abs(parent.l - expLow) > 0.01) throw new Error(`Hierarchical 15m Low mismatch at ${new Date(parent.t).toISOString()}`);
      if (Math.abs(parent.v - expVol) > 0.05) throw new Error(`Hierarchical 15m Volume mismatch at ${new Date(parent.t).toISOString()}`);
      enclosed15mCount++;
    }
  }
  console.log(`   ✓ 15m ≡ 5m hierarchical micro-consistency verified: ${enclosed15mCount} closed parent bars enclosed.`);

  // 5. Build Session Context and Hydrate IPDA Metrics
  console.log('\n5. Executing hydrateIpdaMetrics on genuine market buffers...');
  const sessionContext = buildLiveSessionContext(executionNow, livePrice);

  const hydratedIpda = await hydrateIpdaMetrics({
    symbol,
    livePrice,
    sessionContext,
    candles5m,
    candles15m,
    candles1h,
    candles4h,
    btcCandles5m: btc5m,
    btcCandles15m: btc15m,
    allowNetworkFetch: true,
  });

  // Verify volume sanity
  if (hydratedIpda._integrity?.volume_synthetic_detected) {
    throw new Error('Volume anomaly guard triggered: synthetic or mock volume detected in live Binance buffers!');
  }
  if (hydratedIpda._integrity?.feed_stale) {
    throw new Error('Feed stale guard triggered: consecutive flatlined closes or volume anomaly detected!');
  }
  console.log(`   ✓ Dealing Range: [${hydratedIpda.pricing_context.local_dealing_range.anchor_low} - ${hydratedIpda.pricing_context.local_dealing_range.anchor_high}] (Eq: $${hydratedIpda.pricing_context.local_dealing_range.equilibrium} | Status: ${hydratedIpda.pricing_context.local_dealing_range.current_status})`);
  console.log(`   ✓ Dealing Range Depth: ${(hydratedIpda.pricing_context.local_dealing_range.anchor_high - hydratedIpda.pricing_context.local_dealing_range.anchor_low).toFixed(2)} pts`);
  console.log(`   ✓ Macro Magnets: BSL=[${hydratedIpda.macro_structural_magnets.bsl.join(', ')}] | SSL=[${hydratedIpda.macro_structural_magnets.ssl.join(', ')}]`);
  console.log(`   ✓ Active FVGs: ${hydratedIpda.active_fvgs.length} active gaps serialized`);
  console.log(`   ✓ Feed Stale: ${hydratedIpda._integrity.feed_stale} | Volume Synthetic: ${hydratedIpda._integrity.volume_synthetic_detected}`);

  // 6. Fetch historical memory state from PostgreSQL (graceful fallback)
  console.log('\n6. Fetching historical memory state...');
  let historicalMemoryState: Record<string, unknown> = {
    status: 'SEARCHING',
    trade_direction: null,
    invalidation_level: null,
    target_level: null,
    active_setup_id: null,
    notes: 'Awaiting clean discount/premium displacement outside Value Area',
  };

  try {
    const stateResult = await sql`SELECT state_json FROM ai_trade_state WHERE id = 1`;
    if (stateResult.rows.length > 0 && stateResult.rows[0].state_json) {
      const raw = stateResult.rows[0].state_json;
      historicalMemoryState = typeof raw === 'string' ? JSON.parse(raw) : raw;
      console.log(`   ✓ Database memory state loaded: Status=${historicalMemoryState.status}`);
    }
  } catch {
    console.log('   ℹ️ Database offline / local sandbox: defaulted historical memory to SEARCHING state.');
  }

  // 7. Assemble Complete AI Sync Components
  console.log('\n7. Assembling full composite prompt and token telemetry...');
  const sessionHeader = `=== [LIVE EXECUTION TIMESTAMPS & SESSION CONTEXT] ===\n- System Clock UTC: ${sessionContext.timestamp_utc} (${sessionContext.current_time_utc})\n- Localized Cairo Time: ${sessionContext.timestamp_cairo} (${sessionContext.current_time_cairo})\n- Active Institutional Killzone: ${sessionContext.current_killzone}\n- In-Flight Live Price: $${livePrice.toFixed(2)}\n- Millisecond Stamp: ${sessionContext.execution_millisecond}\n\n`;

  const aiMarketPayload = {
    ticker: `${symbol}.p`,
    symbol,
    timestamp: executionNow.toISOString(),
    session_context: sessionContext,
    ipda_metrics: hydratedIpda,
    data_payload: {
      candles_4h: sanitizeCandleClosureInvariant(candles4h.slice(-30)),
      candles_1h: sanitizeCandleClosureInvariant(candles1h.slice(-30)),
      candles_15m: sanitizeCandleClosureInvariant(candles15m.slice(-30)),
      candles_5m: sanitizeCandleClosureInvariant(candles5m.slice(-30)),
    },
  };

  // Post-export invariant assertions
  for (const [tf, arr] of Object.entries(aiMarketPayload.data_payload)) {
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i].isClosed === false) {
        throw new Error(`Candle closure invariant violation in ${tf}: historical candle at index ${i} has isClosed === false`);
      }
    }
    const lastBar = arr[arr.length - 1];
    console.log(`   ✓ Invariant verified [${tf}]: ${arr.length - 1} closed historical bars, live edge bar isClosed=${lastBar.isClosed}`);
  }

  // Verify SMT & Valuation semantics
  if (
    !hydratedIpda.smt_context.eth_vs_btc_summary ||
    (!hydratedIpda.smt_context.eth_vs_btc_summary.includes('NEUTRAL_SYNCHRONIZED') &&
      !hydratedIpda.smt_context.eth_vs_btc_summary.includes('OFFLINE_FALLBACK') &&
      !hydratedIpda.smt_context.eth_vs_btc_summary.includes('BULLISH') &&
      !hydratedIpda.smt_context.eth_vs_btc_summary.includes('BEARISH'))
  ) {
    throw new Error(`Unexpected SMT summary status: ${hydratedIpda.smt_context.eth_vs_btc_summary}`);
  }
  console.log(`   ✓ SMT Status Verified: ${hydratedIpda.smt_context.status} — "${hydratedIpda.smt_context.eth_vs_btc_summary}"`);

  if (!hydratedIpda.pricing_context.valuation_reconciliation_note) {
    throw new Error('Missing valuation_reconciliation_note in pricing_context');
  }
  console.log(`   ✓ Valuation Reconciliation Note: "${hydratedIpda.pricing_context.valuation_reconciliation_note}"`);

  const memorySection = `\n\n=== [HISTORICAL MEMORY (CURRENT STATE)] ===\n${JSON.stringify(historicalMemoryState, null, 2)}`;
  const fullPromptText = `${DEFAULT_ETH_SOP_SYSTEM_PROMPT}\n\n${sessionHeader}=== MARKET DATA PAYLOAD ===\n${JSON.stringify(aiMarketPayload, null, 2)}${memorySection}`;

  const fullPromptChars = fullPromptText.length;
  const estTotalInputTokens = Math.round(fullPromptChars / 3.7);

  const fullPayload = {
    _description:
      'Quegar Quant Engine — 15-Minute Headless Scheduler AI Sync Payload Snapshot (100% Genuine Live Binance Futures Market Data)',
    _export_timestamp: executionNow.toISOString(),
    _cadence: 'Every 15 minutes (base interval) / 5 minutes (in-zone turbo acceleration)',
    _token_telemetry: {
      system_prompt_characters: DEFAULT_ETH_SOP_SYSTEM_PROMPT.length,
      session_context_characters: sessionHeader.length,
      ipda_metrics_characters: JSON.stringify(hydratedIpda, null, 2).length,
      market_data_payload_characters: JSON.stringify(aiMarketPayload, null, 2).length,
      historical_memory_characters: memorySection.length,
      total_full_prompt_characters: fullPromptChars,
      estimated_input_tokens: estTotalInputTokens,
      expected_output_tokens: 500,
      total_tokens_per_sync: estTotalInputTokens + 500,
    },
    sync_components: {
      '1_system_prompt': DEFAULT_ETH_SOP_SYSTEM_PROMPT,
      '2_session_header': sessionHeader,
      '3_market_data_payload': aiMarketPayload,
      '4_historical_memory_state': historicalMemoryState,
    },
    full_exact_prompt_sent_to_model: fullPromptText,
  };

  // 8. Serialize directly to data/ai_15min_sync_payload_export.json
  const exportPath = path.join(process.cwd(), 'data', 'ai_15min_sync_payload_export.json');
  fs.writeFileSync(exportPath, JSON.stringify(fullPayload, null, 2), 'utf8');

  console.log(`\n✅ 100% ORGANIC LIVE SNAPSHOT EXPORTED SUCCESSFULLY!`);
  console.log(`   Export File:             ${exportPath}`);
  console.log(`   Total File Characters:   ${JSON.stringify(fullPayload, null, 2).length.toLocaleString()}`);
  console.log(`   Total Prompt Characters: ${fullPromptChars.toLocaleString()}`);
  console.log(`   Estimated Input Tokens:  ${estTotalInputTokens.toLocaleString()}`);
  console.log('======================================================================\n');
}

main().catch((err) => {
  console.error('❌ Live Snapshot Export Failed:', err);
  process.exit(1);
});
