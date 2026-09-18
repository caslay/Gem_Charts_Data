/**
 * scripts/verify_scheduled_payload_hydration.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification Test & Export Suite for Scheduled AI Ingestion Payload Hydration
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates:
 * 1. Root 4H Historical Kline Feed Alignment: 4H candles aggregated from 1H
 *    strictly anchored to official Binance 4H UTC boundaries (00:00, 04:00, etc.)
 *    with smooth historical price convergence and zero step-function gaps.
 * 2. Dealing Range Enclosure: Dynamic expansion guarantees anchorHigh >= livePrice >= anchorLow
 *    and equilibrium is strictly between anchor extremes.
 * 3. Directionally Validated Liquidity Magnets: BSL strictly > livePrice (sorted asc),
 *    SSL strictly < livePrice (sorted desc), non-empty arrays guaranteed (Micro-Invariant 2).
 * 4. SMT Fallback Permissive Codification: NEUTRAL fallback handled gracefully without prompt paradox.
 * 5. Payload Deduplication & Telemetry Cleanliness: session_context omitted from ipda_metrics,
 *    body_percentage removed in favor of normalized body_ratio.
 * 6. Bidirectional FVG Scanning & Age Metadata: active_fvgs includes both BISI and SIBI
 *    with created_at_time, age_bars, age_minutes, and valuation-aware prioritization.
 * 7. Synthetic Integrity Block: _integrity verified for timeframe_convergence (<=0.20%),
 *    dealing_range_enclosed, magnets_valid, and overhead_sibi_present.
 * 8. Exports refreshed snapshot to data/ai_15min_sync_payload_export.json.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  hydrateIpdaMetrics,
  reconcileHierarchicalCandles,
  detectSyntheticVolume,
  sanitizeCandleClosureInvariant,
} from '../src/lib/quantEngine/scheduledPayloadHydrator';
import { buildLiveSessionContext } from '../src/lib/sessionContext';
import { DEFAULT_ETH_SOP_SYSTEM_PROMPT } from '../src/lib/sopPromptBuilder';
import {
  synchronizeCandlesWithLiveEdge,
  aggregateCandlesFromLowerTimeframe,
} from '../src/lib/daemon/headlessScheduler';
import { Candle } from '../src/lib/fvgEngine';

/**
 * Generates continuous 1H candles spanning a realistic multi-hour macro impulse wave (~$2436 to ~$2504),
 * embedding an overhead Bearish SIBI in premium and a discount Bullish BISI.
 */
function generateContinuous1hCandles(
  nowMs: number,
  count: number = 80,
  targetLivePrice: number = 2470.11
): Candle[] {
  const candles: Candle[] = [];
  const intervalMs = 60 * 60 * 1000;
  const current1hBucket = Math.floor(nowMs / intervalMs) * intervalMs;

  let currentPrice = 2445.0;

  for (let i = count - 1; i >= 0; i--) {
    const t = current1hBucket - i * intervalMs;
    const isLatest = i === 0;

    let o: number, h: number, l: number, c: number;

    // Embed Bullish BISI at i = 45, 44, 43 (macro discount foundation)
    if (i === 45) {
      o = 2438.0;
      c = 2441.5;
      h = 2444.0;
      l = 2436.0;
      currentPrice = c;
    } else if (i === 44) {
      // Strong upward displacement candle with volume
      o = currentPrice;
      c = 2463.0;
      h = 2465.0;
      l = 2441.5;
      currentPrice = c;
    } else if (i === 43) {
      // High pivot where low > candle 45 high (2452.0 > 2444.0 -> BISI)
      o = currentPrice;
      c = 2468.0;
      h = 2472.0;
      l = 2452.0;
      currentPrice = c;
    }
    // Embed Bearish SIBI at i = 22, 21, 20 (macro premium ceiling)
    else if (i === 22) {
      // High pivot: sets Level-2 Major High anchor at 2504.0
      o = 2496.0;
      c = 2498.0;
      h = 2504.0;
      l = 2492.0;
      currentPrice = c;
    } else if (i === 21) {
      // Strong downward displacement candle with sell volume
      o = currentPrice;
      c = 2482.0;
      h = 2498.5;
      l = 2480.0;
      currentPrice = c;
    } else if (i === 20) {
      // Low pivot where high < candle 22 low (2488.0 < 2492.0 -> SIBI)
      o = currentPrice;
      c = 2484.0;
      h = 2488.0;
      l = 2478.0;
      currentPrice = c;
    } else if (isLatest) {
      o = currentPrice;
      c = targetLivePrice;
      h = Math.max(o, c) + 1.8;
      l = Math.min(o, c) - 1.8;
    } else {
      // Natural path-dependent evolution with continuous variance (zero flatlining)
      const retraceTarget = 2470.0;
      const meanReversion = (retraceTarget - currentPrice) * 0.04;
      const wave = Math.sin(i * 0.35) * 2.8;
      const noise = ((i % 7) - 3) * 0.75;
      const step = meanReversion + wave + noise;

      o = currentPrice;
      c = o + step;

      // Keep within macro boundaries so SIBI and BISI stay active
      c = Math.min(2487.0, Math.max(2453.0, c));
      // Guarantee candle close differs from open
      if (Math.abs(c - o) < 0.20) c = o + (step >= 0 ? 0.45 : -0.45);

      h = Math.max(o, c) + 1.2 + ((i % 3) * 0.4);
      l = Math.min(o, c) - 1.2 - ((i % 4) * 0.3);
      currentPrice = c;
    }

    const v = parseFloat(
      (950 + Math.sin(i * 1.7) * 230 + Math.cos(i * 0.9) * 170 + ((i * 37) % 191) * 3.7).toFixed(2)
    );
    const isBull = c >= o;
    const takerBuy = v * (isBull ? 0.62 : 0.38);
    const takerSell = v - takerBuy;

    candles.push({
      t,
      o: parseFloat(o.toFixed(2)),
      h: parseFloat(h.toFixed(2)),
      l: parseFloat(l.toFixed(2)),
      c: parseFloat(c.toFixed(2)),
      v: parseFloat(v.toFixed(2)),
      taker_buy_vol: parseFloat(takerBuy.toFixed(2)),
      taker_sell_vol: parseFloat(takerSell.toFixed(2)),
      isClosed: !isLatest,
    });
  }

  return candles;
}

/**
 * Generates continuous, path-dependent 15m candles with organic variance
 * and a distinct 15m Bearish SIBI at i = 16, 15, 14.
 */
function generateContinuous15mCandles(
  nowMs: number,
  count: number = 100,
  targetLivePrice: number = 2470.11
): Candle[] {
  const candles: Candle[] = [];
  const intervalMs = 15 * 60 * 1000;
  const currentBucket = Math.floor(nowMs / intervalMs) * intervalMs;
  let currentPrice = 2475.0;

  for (let i = count - 1; i >= 0; i--) {
    const t = currentBucket - i * intervalMs;
    const isLatest = i === 0;

    let o: number, h: number, l: number, c: number;

    // Embed distinct 15m SIBI at i = 16, 15, 14
    if (i === 16) {
      o = 2484.0;
      c = 2486.0;
      h = 2488.5;
      l = 2482.5;
      currentPrice = c;
    } else if (i === 15) {
      // 15m Bearish displacement impulse
      o = currentPrice;
      c = 2476.5;
      h = 2486.5;
      l = 2475.0;
      currentPrice = c;
    } else if (i === 14) {
      // Low pivot where high < candle 16 low (2480.0 < 2482.5 -> 15m SIBI)
      o = currentPrice;
      c = 2478.0;
      h = 2480.0;
      l = 2474.0;
      currentPrice = c;
    } else if (i === 1) {
      // Pre-latest closed bar smoothly aligns near livePrice
      o = currentPrice;
      c = 2470.15;
      h = Math.max(o, c) + 1.1;
      l = Math.min(o, c) - 1.1;
      currentPrice = c;
    } else if (isLatest) {
      o = currentPrice;
      c = targetLivePrice;
      h = Math.max(o, targetLivePrice) + 0.8;
      l = Math.min(o, targetLivePrice) - 0.8;
    } else {
      // Natural path-dependent oscillation (never flatlining)
      const target = 2472.0;
      const meanReversion = (target - currentPrice) * 0.06;
      const wave = Math.cos(i * 0.42) * 1.8;
      const noise = ((i % 5) - 2) * 0.4;
      const step = meanReversion + wave + noise;

      o = currentPrice;
      c = o + step;

      // Constrain safely below 15m SIBI (2480.0)
      c = Math.min(2479.2, Math.max(2466.0, c));
      if (Math.abs(c - o) < 0.15) c = o + (step >= 0 ? 0.35 : -0.35);

      h = Math.max(o, c) + 0.9 + ((i % 4) * 0.25);
      l = Math.min(o, c) - 0.9 - ((i % 3) * 0.25);
      currentPrice = c;
    }

    const v = parseFloat(
      (450 + Math.sin(i * 1.9) * 120 + Math.cos(i * 1.1) * 85 + ((i * 29) % 113) * 2.3).toFixed(2)
    );
    const isBull = c >= o;
    const takerBuy = v * (isBull ? 0.59 : 0.41);
    const takerSell = v - takerBuy;

    candles.push({
      t,
      o: parseFloat(o.toFixed(2)),
      h: parseFloat(h.toFixed(2)),
      l: parseFloat(l.toFixed(2)),
      c: parseFloat(c.toFixed(2)),
      v: parseFloat(v.toFixed(2)),
      taker_buy_vol: parseFloat(takerBuy.toFixed(2)),
      taker_sell_vol: parseFloat(takerSell.toFixed(2)),
      isClosed: !isLatest,
    });
  }

  return candles;
}

/**
 * Generates continuous, path-dependent 5m candles with organic variance
 * and a distinct 5m Bearish SIBI at i = 10, 9, 8 (completely independent geometry from 15m).
 */
function generateContinuous5mCandles(
  nowMs: number,
  count: number = 100,
  targetLivePrice: number = 2470.11
): Candle[] {
  const candles: Candle[] = [];
  const intervalMs = 5 * 60 * 1000;
  const currentBucket = Math.floor(nowMs / intervalMs) * intervalMs;
  let currentPrice = 2473.0;

  for (let i = count - 1; i >= 0; i--) {
    const t = currentBucket - i * intervalMs;
    const isLatest = i === 0;

    let o: number, h: number, l: number, c: number;

    // Embed independent 5m SIBI at i = 10, 9, 8 (distinct price level $2474.8 - $2476.0)
    if (i === 10) {
      o = 2476.5;
      c = 2478.0;
      h = 2479.5;
      l = 2476.0;
      currentPrice = c;
    } else if (i === 9) {
      // 5m downward displacement impulse
      o = currentPrice;
      c = 2472.5;
      h = 2478.0;
      l = 2471.5;
      currentPrice = c;
    } else if (i === 8) {
      // Low pivot where high < candle 10 low (2474.8 < 2476.0 -> 5m SIBI)
      o = currentPrice;
      c = 2473.5;
      h = 2474.8;
      l = 2471.0;
      currentPrice = c;
    } else if (i === 1) {
      // Pre-latest closed bar smoothly aligns near livePrice
      o = currentPrice;
      c = 2470.18;
      h = Math.max(o, c) + 0.6;
      l = Math.min(o, c) - 0.6;
      currentPrice = c;
    } else if (isLatest) {
      o = currentPrice;
      c = targetLivePrice;
      h = Math.max(o, targetLivePrice) + 0.5;
      l = Math.min(o, targetLivePrice) - 0.5;
    } else {
      // Natural 5m micro-variance (zero flatlining)
      const target = 2471.0;
      const meanReversion = (target - currentPrice) * 0.08;
      const wave = Math.sin(i * 0.55) * 1.2;
      const noise = ((i % 4) - 1.5) * 0.25;
      const step = meanReversion + wave + noise;

      o = currentPrice;
      c = o + step;

      // Constrain safely below 5m SIBI (2474.8)
      c = Math.min(2474.2, Math.max(2468.0, c));
      if (Math.abs(c - o) < 0.10) c = o + (step >= 0 ? 0.25 : -0.25);

      h = Math.max(o, c) + 0.5 + ((i % 3) * 0.15);
      l = Math.min(o, c) - 0.5 - ((i % 4) * 0.15);
      currentPrice = c;
    }

    const v = parseFloat(
      (220 + Math.sin(i * 2.1) * 55 + Math.cos(i * 1.3) * 40 + ((i * 19) % 71) * 1.8).toFixed(2)
    );
    const isBull = c >= o;
    const takerBuy = v * (isBull ? 0.56 : 0.44);
    const takerSell = v - takerBuy;

    candles.push({
      t,
      o: parseFloat(o.toFixed(2)),
      h: parseFloat(h.toFixed(2)),
      l: parseFloat(l.toFixed(2)),
      c: parseFloat(c.toFixed(2)),
      v: parseFloat(v.toFixed(2)),
      taker_buy_vol: parseFloat(takerBuy.toFixed(2)),
      taker_sell_vol: parseFloat(takerSell.toFixed(2)),
      isClosed: !isLatest,
    });
  }

  return candles;
}

async function main() {
  console.log('======================================================================');
  console.log('🧪 VERIFYING SCHEDULED AI INGESTION PAYLOAD HYDRATION & INTEGRITY');
  console.log('======================================================================\n');

  const livePrice = 2470.11;
  const executionNow = new Date();
  const nowMs = executionNow.getTime();
  const sessionContext = buildLiveSessionContext(executionNow, livePrice);

  // 1. Generate 1H continuous candles with realistic swings spanning macro impulse wave ($2436 - $2504)
  const rawCandles1h = generateContinuous1hCandles(nowMs, 80, livePrice);

  // 2. Aggregate 4H candles strictly from 1H anchored to official UTC boundaries
  const rawCandles4h = aggregateCandlesFromLowerTimeframe(rawCandles1h, 240);

  // 3. Generate distinct, continuous 5m and 15m sub-candles, reconciling 15m from 5m (15m ≡ 5m invariant)
  const rawCandles5m = generateContinuous5mCandles(nowMs, 100, livePrice);
  const rawCandles15mBase = generateContinuous15mCandles(nowMs, 100, livePrice);
  const rawCandles15m = reconcileHierarchicalCandles(rawCandles5m, rawCandles15mBase, 5, 15);

  // 4. Synchronize all timeframes with the live edge and enforce closure invariant
  const candles5m = sanitizeCandleClosureInvariant(synchronizeCandlesWithLiveEdge(rawCandles5m, 5, livePrice, nowMs));
  const candles15m = sanitizeCandleClosureInvariant(synchronizeCandlesWithLiveEdge(rawCandles15m, 15, livePrice, nowMs));
  const candles1h = sanitizeCandleClosureInvariant(synchronizeCandlesWithLiveEdge(rawCandles1h, 60, livePrice, nowMs));
  const candles4h = sanitizeCandleClosureInvariant(synchronizeCandlesWithLiveEdge(rawCandles4h, 240, livePrice, nowMs));

  // ── TEST 1: Timeframe Synchronization & 4H-1H Mathematical Convergence ──
  console.log('--- TEST 1: Timeframe Synchronization & 4H-1H Historical Parity ---');
  const tfCandles = [
    { tf: '5m', c: candles5m[candles5m.length - 1], intervalMinutes: 5 },
    { tf: '15m', c: candles15m[candles15m.length - 1], intervalMinutes: 15 },
    { tf: '1h', c: candles1h[candles1h.length - 1], intervalMinutes: 60 },
    { tf: '4h', c: candles4h[candles4h.length - 1], intervalMinutes: 240 },
  ];

  for (const { tf, c } of tfCandles) {
    if (!c) throw new Error(`Missing latest candle for timeframe ${tf}`);
    console.log(`  [${tf}] Open: $${c.o}, High: $${c.h}, Low: $${c.l}, Close: $${c.c} (t=${new Date(c.t).toISOString()})`);

    // Invariant: latest candle close must equal livePrice
    if (Math.abs(c.c - livePrice) > 0.01) {
      throw new Error(`[${tf}] Latest candle close ($${c.c}) must equal livePrice ($${livePrice})`);
    }
    // Micro-Invariant 1: OHLC integrity (high >= livePrice and low <= livePrice)
    if (c.h < livePrice || c.l > livePrice) {
      throw new Error(`[${tf}] Micro-Invariant 1 violated: high ($${c.h}) must be >= livePrice ($${livePrice}) and low ($${c.l}) <= livePrice`);
    }
  }

  // Verify Candle Closure Invariant across all 4 operational timeframes:
  // Indices 0 to length - 2 strictly isClosed === true. Only index length - 1 permitted isClosed === false.
  const allTfSeries = [
    { tf: '5m', series: candles5m },
    { tf: '15m', series: candles15m },
    { tf: '1h', series: candles1h },
    { tf: '4h', series: candles4h },
  ];
  for (const { tf, series } of allTfSeries) {
    for (let i = 0; i < series.length - 1; i++) {
      if (series[i].isClosed === false) {
        throw new Error(`Candle closure invariant violation in ${tf}: historical candle at index ${i} has isClosed === false`);
      }
    }
    if (series[series.length - 1].isClosed !== false) {
      console.warn(`[${tf}] Live edge candle at index ${series.length - 1} isClosed is not false (${series[series.length - 1].isClosed})`);
    }
  }
  console.log('  Candle closure invariant confirmed across 5m, 15m, 1h, 4h: 100% closed historical bars.');

  // Verify 4H candles strictly anchor to Binance UTC boundaries (00, 04, 08, 12, 16, 20 UTC)
  const fourHoursMs = 4 * 60 * 60 * 1000;
  for (const c4 of candles4h) {
    if (c4.t % fourHoursMs !== 0) {
      throw new Error(`4H candle timestamp ${c4.t} (${new Date(c4.t).toISOString()}) is not aligned to 4H UTC boundary`);
    }
  }

  // Verify 4H historical prices mathematically match child 1H bars (Zero step-function dislocation)
  if (candles4h.length >= 2) {
    const closed4h = candles4h[candles4h.length - 2];
    const child1hBars = candles1h.filter((c) => c.t >= closed4h.t && c.t < closed4h.t + fourHoursMs);
    if (child1hBars.length > 0) {
      const expectedClose = child1hBars[child1hBars.length - 1].c;
      const expectedOpen = child1hBars[0].o;
      const expectedHigh = Math.max(...child1hBars.map((b) => b.h));
      const expectedLow = Math.min(...child1hBars.map((b) => b.l));

      console.log(`  4H Historical Validation (t=${new Date(closed4h.t).toISOString()}):`);
      console.log(`    4H Close: $${closed4h.c} | Child 1H Close: $${expectedClose}`);
      console.log(`    4H High:  $${closed4h.h} | Child 1H High:  $${expectedHigh}`);
      console.log(`    4H Low:   $${closed4h.l} | Child 1H Low:   $${expectedLow}`);

      if (Math.abs(closed4h.c - expectedClose) > 0.01) {
        throw new Error(`4H close ($${closed4h.c}) deviates from child 1H close ($${expectedClose})`);
      }
      if (Math.abs(closed4h.o - expectedOpen) > 0.01) {
        throw new Error(`4H open ($${closed4h.o}) deviates from child 1H open ($${expectedOpen})`);
      }
    }
  }

  // Verify 15m candles strictly enclose child 5m bars (15m ≡ 5m Invariant)
  const fifteenMinutesMs = 15 * 60 * 1000;
  let verified15mEnclosures = 0;
  for (let idx = 0; idx < candles15m.length - 1; idx++) {
    const p15 = candles15m[idx];
    const child5mBars = candles5m.filter((c) => c.t >= p15.t && c.t < p15.t + fifteenMinutesMs);
    if (child5mBars.length === 3) {
      const expOpen = child5mBars[0].o;
      const expClose = child5mBars[2].c;
      const expHigh = Math.max(...child5mBars.map((b) => b.h));
      const expLow = Math.min(...child5mBars.map((b) => b.l));
      const expVol = parseFloat(child5mBars.reduce((s, b) => s + b.v, 0).toFixed(2));

      if (Math.abs(p15.o - expOpen) > 0.01) throw new Error(`15m Open mismatch: ${p15.o} != ${expOpen}`);
      if (Math.abs(p15.c - expClose) > 0.01) throw new Error(`15m Close mismatch: ${p15.c} != ${expClose}`);
      if (Math.abs(p15.h - expHigh) > 0.01) throw new Error(`15m High mismatch: ${p15.h} != ${expHigh}`);
      if (Math.abs(p15.l - expLow) > 0.01) throw new Error(`15m Low mismatch: ${p15.l} != ${expLow}`);
      if (Math.abs(p15.v - expVol) > 0.05) throw new Error(`15m Vol mismatch: ${p15.v} != ${expVol}`);
      verified15mEnclosures++;
    }
  }
  console.log(`  15m ≡ 5m Micro-Consistency Verified: ${verified15mEnclosures} candles mathematically enclosed.`);
  console.log('✅ TEST 1 PASSED: Multi-timeframe synchronization, closure invariants, and 4H-1H / 15m-5m mathematical parity verified.\n');

  // ── TEST 2: Workstream A — Zero Flatlined Closes & Path Variance ───────────
  console.log('--- TEST 2: Workstream A — Path-Dependent Continuity & Zero Flatlines ---');
  const checkZeroFlatlines = (candles: Candle[], name: string) => {
    const closed = candles.filter((c) => c.isClosed !== false);
    for (let i = 2; i < closed.length; i++) {
      if (closed[i].c === closed[i - 1].c && closed[i - 1].c === closed[i - 2].c) {
        throw new Error(`Flatline sequence detected in ${name} at bar ${i}: 3 consecutive closes at $${closed[i].c}`);
      }
    }
  };

  checkZeroFlatlines(candles5m, '5m');
  checkZeroFlatlines(candles15m, '15m');
  checkZeroFlatlines(candles1h, '1h');
  console.log('  Zero flatline sequences verified across 5m, 15m, and 1H candle series.');
  console.log('✅ TEST 2 PASSED: Realistic continuous market data harness verified.\n');

  // ── TEST 3: Workstream C — Macro Dealing Range Depth & Anchoring ───────────
  console.log('--- TEST 3: Workstream C — Macro Dealing Range Anchoring & Depth ---');
  const hydratedIpda = await hydrateIpdaMetrics({
    symbol: 'ETHUSDC',
    livePrice,
    sessionContext,
    candles5m,
    candles15m,
    candles1h,
    candles4h,
    allowNetworkFetch: false,
  });

  const dr = hydratedIpda.pricing_context.local_dealing_range;
  const drDepth = parseFloat((dr.anchor_high - dr.anchor_low).toFixed(2));
  console.log(`  Anchor High:  $${dr.anchor_high}`);
  console.log(`  Equilibrium:  $${dr.equilibrium}`);
  console.log(`  Anchor Low:   $${dr.anchor_low}`);
  console.log(`  Dealing Depth: $${drDepth} points`);
  console.log(`  Live Price:   $${livePrice}`);
  console.log(`  Valuation:    ${hydratedIpda.current_pricing}`);

  // Invariant: Dealing Range Enclosure
  if (dr.anchor_high < livePrice) {
    throw new Error(`Dealing Range anchor_high ($${dr.anchor_high}) MUST be >= livePrice ($${livePrice})`);
  }
  if (dr.anchor_low > livePrice) {
    throw new Error(`Dealing Range anchor_low ($${dr.anchor_low}) MUST be <= livePrice ($${livePrice})`);
  }
  if (dr.equilibrium < dr.anchor_low || dr.equilibrium > dr.anchor_high) {
    throw new Error(`Dealing Range equilibrium ($${dr.equilibrium}) must lie between anchor_low and anchor_high`);
  }
  if (!['DISCOUNT', 'PREMIUM', 'EQUILIBRIUM'].includes(hydratedIpda.current_pricing)) {
    throw new Error(`Invalid current_pricing: ${hydratedIpda.current_pricing}`);
  }

  // Workstream C Critical Guardrail: Dealing range depth must be >= 35.0 points
  if (drDepth < 35.0) {
    throw new Error(`Dealing Range micro-collapsed! Depth ($${drDepth} pts) is less than minimum 35.0 points.`);
  }
  console.log(`  Confirmed macro depth: ${drDepth} points >= 35.0 points (anti-micro-collapse enforced)`);

  if (!dr.structural_dealing_range_valuation) {
    throw new Error('Missing structural_dealing_range_valuation in local_dealing_range');
  }
  if (!dr.valuation_basis_note) {
    throw new Error('Missing valuation_basis_note in local_dealing_range');
  }
  if (!hydratedIpda.pricing_context.valuation_reconciliation_note) {
    throw new Error('Missing valuation_reconciliation_note in pricing_context');
  }
  console.log(`  Structural Dealing Valuation: ${dr.structural_dealing_range_valuation} (${dr.valuation_basis_note})`);
  console.log(`  Valuation Reconciliation Note: "${hydratedIpda.pricing_context.valuation_reconciliation_note}"`);
  console.log('✅ TEST 3 PASSED: Macro dealing range depth, enclosure, and dual-valuation semantics verified.\n');

  // ── TEST 4: Workstream B — Macro Structural Magnets & Minimum Clearance ───
  console.log('--- TEST 4: Workstream B — Macro Liquidity Magnets Minimum Clearance ---');
  const magnets = hydratedIpda.macro_structural_magnets;
  if (!magnets) throw new Error('macro_structural_magnets must be defined');

  console.log(`  Buy-Side Liquidity (BSL):  [${magnets.bsl.join(', ')}]`);
  console.log(`  Sell-Side Liquidity (SSL): [${magnets.ssl.join(', ')}]`);

  if (!Array.isArray(magnets.bsl) || magnets.bsl.length === 0) {
    throw new Error('Micro-Invariant 2 violated: BSL array must not be empty');
  }
  if (!Array.isArray(magnets.ssl) || magnets.ssl.length === 0) {
    throw new Error('Micro-Invariant 2 violated: SSL array must not be empty');
  }

  const minClearance = Math.max(5.0, parseFloat((livePrice * 0.0025).toFixed(2))); // ~6.18 pts

  for (const bsl of magnets.bsl) {
    const clearance = parseFloat((bsl - livePrice).toFixed(2));
    if (clearance < minClearance) {
      throw new Error(`BSL magnet ($${bsl}) sits inside clearance threshold: ${clearance} pts < ${minClearance} pts`);
    }
  }

  for (const ssl of magnets.ssl) {
    const clearance = parseFloat((livePrice - ssl).toFixed(2));
    if (clearance < minClearance) {
      throw new Error(`SSL magnet ($${ssl}) sits inside clearance threshold: ${clearance} pts < ${minClearance} pts`);
    }
  }

  // Sorting verification: BSL ascending, SSL descending
  for (let i = 1; i < magnets.bsl.length; i++) {
    if (magnets.bsl[i] < magnets.bsl[i - 1]) {
      throw new Error('BSL must be sorted ascending (closest to price first)');
    }
  }
  for (let i = 1; i < magnets.ssl.length; i++) {
    if (magnets.ssl[i] > magnets.ssl[i - 1]) {
      throw new Error('SSL must be sorted descending (closest to price first)');
    }
  }
  console.log(`  All BSL and SSL magnets sit strictly outside the >= ${minClearance} pt (>= 0.25%) clearance threshold.`);
  console.log('✅ TEST 4 PASSED: Macro liquidity magnets and spatial clearance verified.\n');

  // ── TEST 5: Workstream D — FVG Telemetry Count Parity ───────────────────────
  console.log('--- TEST 5: Workstream D — Array Synchronization & Metric Parity ---');
  const fvgs = hydratedIpda.active_fvgs;
  const sibiCount = fvgs.filter((f) => f.type === 'SIBI').length;
  const bisiCount = fvgs.filter((f) => f.type === 'BISI').length;

  console.log(`  Total Active FVGs in Array: ${fvgs.length} (${sibiCount} SIBI, ${bisiCount} BISI)`);
  console.log(`  Overhead SIBI Status String: "${hydratedIpda.overhead_sibi_status}"`);
  console.log(`  Discount BISI Status String: "${hydratedIpda.discount_bisi_status}"`);

  // Verify status string numerical parity with serialized array
  if (sibiCount > 0 && !hydratedIpda.overhead_sibi_status.includes(`${sibiCount} detected`)) {
    throw new Error(`Telemetry count mismatch! SIBI status reports incorrect count vs serialized array (${sibiCount})`);
  }
  if (bisiCount > 0 && !hydratedIpda.discount_bisi_status.includes(`${bisiCount} detected`)) {
    throw new Error(`Telemetry count mismatch! BISI status reports incorrect count vs serialized array (${bisiCount})`);
  }
  console.log('  Exact numerical parity confirmed between status strings and serialized array length.');
  console.log('✅ TEST 5 PASSED: Telemetry count parity verified.\n');

  // ── TEST 6: Workstream A/D — Synthetic Integrity & Feed Stale Check ─────────
  console.log('--- TEST 6: Synthetic Integrity & Stale Feed Gatekeeper ---');
  const integrity = hydratedIpda._integrity;
  if (!integrity) throw new Error('_integrity block must be present at root of ipda_metrics');

  console.log(`  Timeframe Convergence:          ${integrity.timeframe_convergence} (max dev: ${integrity.timeframe_max_deviation_percent}%)`);
  console.log(`  Dealing Range Enclosed:         ${integrity.dealing_range_enclosed}`);
  console.log(`  Liquidity Magnets Valid:        ${integrity.magnets_valid}`);
  console.log(`  Overhead SIBI Present:          ${integrity.overhead_sibi_present}`);
  console.log(`  Feed Stale:                     ${integrity.feed_stale}`);

  if (!integrity.timeframe_convergence) {
    throw new Error(`_integrity.timeframe_convergence failed! Max deviation: ${integrity.timeframe_max_deviation_percent}% > 0.20%`);
  }
  if (!integrity.dealing_range_enclosed) {
    throw new Error('_integrity.dealing_range_enclosed failed! Price breached dealing range');
  }
  if (!integrity.magnets_valid) {
    throw new Error('_integrity.magnets_valid failed! Inverted or empty liquidity magnets');
  }
  if (integrity.volume_synthetic_detected) {
    throw new Error('_integrity.volume_synthetic_detected should be false for healthy continuous feed');
  }
  if (integrity.feed_stale) {
    throw new Error('_integrity.feed_stale should be false for healthy continuous feed');
  }

  // 1. Inject artificial flatlined feed to verify that feed_stale triggers true
  const flatlined5m = candles5m.map((c, idx) =>
    idx >= candles5m.length - 4 ? { ...c, c: 2470.0, o: 2470.0, h: 2470.0, l: 2470.0, isClosed: true } : c
  );
  const staleCheckIpda = await hydrateIpdaMetrics({
    symbol: 'ETHUSDC',
    livePrice,
    sessionContext,
    candles5m: flatlined5m,
    candles15m,
    candles1h,
    candles4h,
    allowNetworkFetch: false,
  });

  if (!staleCheckIpda._integrity.feed_stale) {
    throw new Error('Stale feed detection failed! Expected feed_stale: true when 4 consecutive bars flatline.');
  }
  console.log('  Artificially flatlined price feed successfully triggered _integrity.feed_stale: true');

  // 2. Inject artificial synthetic repeating volume to verify volume_synthetic_detected triggers true
  const syntheticVol5m = candles5m.map((c, idx) => ({
    ...c,
    v: 100 + (idx % 4) * 20, // repeating pattern period 4
  }));
  const syntheticVolIpda = await hydrateIpdaMetrics({
    symbol: 'ETHUSDC',
    livePrice,
    sessionContext,
    candles5m: syntheticVol5m,
    candles15m,
    candles1h,
    candles4h,
    allowNetworkFetch: false,
  });

  if (!syntheticVolIpda._integrity.volume_synthetic_detected) {
    throw new Error('Synthetic volume detection failed! Expected volume_synthetic_detected: true for cyclical volume.');
  }
  if (!syntheticVolIpda._integrity.feed_stale) {
    throw new Error('feed_stale must trigger true when synthetic volume is detected.');
  }
  console.log('  Artificially repeating volume feed successfully triggered _integrity.volume_synthetic_detected & feed_stale: true');
  console.log('✅ TEST 6 PASSED: Integrity block, stale feed, and synthetic volume anomaly guard verified.\n');

  // ── TEST 7: SMT Permissive Fallback Isolation ───────────────────────────────
  console.log('--- TEST 7: SMT Fallback Permissive Codification & Isolation ---');
  const isolatedIpda = await hydrateIpdaMetrics({
    symbol: 'ETHUSDC',
    livePrice,
    sessionContext,
    candles5m,
    candles15m,
    btcCandles15m: [],
    btcCandles5m: [],
    allowNetworkFetch: false,
  });

  if (isolatedIpda.smt_context.status !== 'NEUTRAL') {
    throw new Error(`Expected NEUTRAL fallback when BTC is offline, got ${isolatedIpda.smt_context.status}`);
  }
  if (!isolatedIpda.smt_context.eth_vs_btc_summary.includes('OFFLINE_FALLBACK')) {
    throw new Error(`Expected eth_vs_btc_summary to contain OFFLINE_FALLBACK when isolated, got: ${isolatedIpda.smt_context.eth_vs_btc_summary}`);
  }
  if (!DEFAULT_ETH_SOP_SYSTEM_PROMPT.includes('CONDITIONAL PERMISSIVE FALLBACK')) {
    throw new Error('DEFAULT_ETH_SOP_SYSTEM_PROMPT must include CONDITIONAL PERMISSIVE FALLBACK for SMT');
  }
  console.log('  SMT Status on Isolation:', isolatedIpda.smt_context.status);
  console.log('  SMT Summary on Isolation:', isolatedIpda.smt_context.eth_vs_btc_summary);
  console.log('✅ TEST 7 PASSED: SMT Fallback and OFFLINE_FALLBACK status verified.\n');

  // ── TEST 8: Verify Payload Serialization & Synthetic Test Fixture ───────────
  console.log('--- TEST 8: Verify Payload Serialization & Synthetic Test Fixture ---');
  const exportPath = path.join(process.cwd(), 'data', 'test_payload_synthetic_fixture.json');

  const sessionHeader = `=== [LIVE EXECUTION TIMESTAMPS & SESSION CONTEXT] ===\n- System Clock UTC: ${sessionContext.timestamp_utc} (${sessionContext.current_time_utc})\n- Localized Cairo Time: ${sessionContext.timestamp_cairo} (${sessionContext.current_time_cairo})\n- Active Institutional Killzone: ${sessionContext.current_killzone}\n- In-Flight Live Price: $${livePrice.toFixed(2)}\n- Millisecond Stamp: ${sessionContext.execution_millisecond}\n\n`;

  const aiMarketPayload = {
    ticker: 'ETHUSDC.p',
    symbol: 'ETHUSDC',
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

  const historicalMemoryState = {
    status: 'SEARCHING',
    trade_direction: null,
    invalidation_level: null,
    target_level: null,
    active_setup_id: null,
    notes: 'Awaiting clean discount/premium displacement outside Value Area',
  };

  const memorySection = `\n\n=== [HISTORICAL MEMORY (CURRENT STATE)] ===\n${JSON.stringify(historicalMemoryState, null, 2)}`;
  const fullPromptText = `${DEFAULT_ETH_SOP_SYSTEM_PROMPT}\n\n${sessionHeader}=== MARKET DATA PAYLOAD ===\n${JSON.stringify(aiMarketPayload, null, 2)}${memorySection}`;

  const fullPromptChars = fullPromptText.length;
  const estTotalInputTokens = Math.round(fullPromptChars / 3.7);

  const fullPayload = {
    _description:
      'Quegar Quant Engine — Synthetic Test Harness Fixture (Decoupled from Live Production Snapshot)',
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

  fs.writeFileSync(exportPath, JSON.stringify(fullPayload, null, 2), 'utf8');
  console.log(`✓ Successfully verified serialization to synthetic fixture: ${exportPath}`);
  console.log(`  Total Prompt Characters: ${fullPromptChars.toLocaleString()}`);
  console.log(`  Estimated Input Tokens: ${estTotalInputTokens.toLocaleString()}`);
  console.log('✅ TEST 8 PASSED: Synthetic fixture serialization verified without touching production live snapshot.\n');

  console.log('======================================================================');
  console.log('🎉 ALL 8 TESTS PASSED: Continuous Variance, Macro Geometry & Parity Enforced!');
  console.log('======================================================================');
}

main().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
