/**
 * scheduledPayloadHydrator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow-State Quant Engine — Scheduled AI Ingestion Payload Hydrator
 * ─────────────────────────────────────────────────────────────────────────────
 * Pre-calculates institutional ICT primitives, AMT Value Area, Dealing Range
 * Valuation, SMT divergence telemetry, and 3-pillar displacement metrics in code
 * before dispatching scheduled AI evaluation payloads.
 *
 * Implements:
 * 1. Structural Dealing Range & 50% Equilibrium valuation (DISCOUNT/PREMIUM/EQUILIBRIUM).
 * 2. Auction Market Theory (AMT) rolling 96-bar Value Area (VAH/VAL/POC).
 * 3. Consolidated unmitigated 15m & 5m FVGs (BISI/SIBI with proximal/distal edges & CE).
 * 4. Isolated Intermarket SMT divergence engine against BTCUSDT with 2.5s strict timeout.
 * 5. Order Flow 3-pillar displacement proof (Volume SMA20, Taker Delta, Body Ratio, OI).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle, detectActiveFVGs } from '../fvgEngine';
import { analyzeMarketStructure } from '../structureEngine';
import { calculateValueAreaProfile } from './SweepReclaimEngine';
import { evaluateMicroSmt } from '../smtEngine';
import { fetchOIMetricsAndLiquidations } from '../orderFlowEngine';
import { LiveSessionContext } from '../sessionContext';

export interface HydratedLocalDealingRange {
  anchor_high: number;
  anchor_low: number;
  equilibrium: number;
  current_status: 'DISCOUNT' | 'PREMIUM' | 'EQUILIBRIUM';
  structural_dealing_range_valuation: 'DISCOUNT' | 'PREMIUM' | 'EQUILIBRIUM';
  valuation_basis_note: string;
}

export interface HydratedValueArea {
  vah: number | null;
  val: number | null;
  poc: number | null;
  is_outside_value_area: boolean;
  auction_status: string;
}

export interface HydratedActiveFvg {
  timeframe: string;
  type: 'BISI' | 'SIBI';
  direction: 'BULLISH' | 'BEARISH';
  proximal_edge: number;
  distal_edge: number;
  ce: number;
  status: string;
  distance_to_price: number;
  created_at_time: string;
  age_bars: number;
  age_minutes: number;
}

export interface HydratedSmtContext {
  divergence_detected: boolean;
  status: 'BULLISH_SMT' | 'BEARISH_SMT' | 'NEUTRAL';
  eth_vs_btc_summary: string;
}

export interface HydratedDisplacementMetrics {
  volume_expansion_ratio: number;
  taker_delta_percent: number;
  body_ratio: number;
  is_three_pillar_displaced: boolean;
  open_interest_regime: string;
}

export interface HydratedIntegrityBlock {
  timeframe_convergence: boolean;
  timeframe_max_deviation_percent: number;
  dealing_range_enclosed: boolean;
  magnets_valid: boolean;
  overhead_sibi_present: boolean;
  feed_stale: boolean;
  volume_synthetic_detected: boolean;
}

export interface HydratedIpdaMetrics {
  _integrity: HydratedIntegrityBlock;
  current_time_window: string;
  session_context?: LiveSessionContext;
  current_pricing: 'DISCOUNT' | 'PREMIUM' | 'EQUILIBRIUM';
  pricing_context: {
    local_dealing_range: HydratedLocalDealingRange;
    value_area: HydratedValueArea;
    valuation_reconciliation_note?: string;
  };
  active_fvgs: HydratedActiveFvg[];
  overhead_sibi_status: string;
  discount_bisi_status: string;
  smt_context: HydratedSmtContext;
  displacement_metrics: HydratedDisplacementMetrics;
  open_interest_regime: string;
  macro_structural_magnets?: {
    bsl: number[];
    ssl: number[];
  };
}

export interface HydratePayloadOptions {
  symbol?: string;
  livePrice: number;
  sessionContext: LiveSessionContext;
  candles5m: Candle[];
  candles15m: Candle[];
  candles1h?: Candle[];
  candles4h?: Candle[];
  btcCandles15m?: Candle[];
  btcCandles5m?: Candle[];
  allowNetworkFetch?: boolean;
}

/**
 * Isolated helper to fetch BTCUSDT candles with strict 2.5s AbortController timeout.
 * Guaranteed to failover to an empty array without throwing.
 */
async function fetchBtcCandlesIsolated(interval: string, limit: number = 30): Promise<Candle[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeoutId);

    if (!res.ok) return [];

    const raw = (await res.json()) as any[];
    if (!Array.isArray(raw)) return [];

    return raw.map((c: any) => {
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
  } catch {
    // Timeout, network error, or rate limit: failover gracefully to empty array
    return [];
  }
}

/**
 * Synchronous / In-Memory hydrator that builds the full institutional IPDA metrics payload.
 */
export async function hydrateIpdaMetrics(options: HydratePayloadOptions): Promise<HydratedIpdaMetrics> {
  const {
    symbol = 'ETHUSDC',
    livePrice,
    sessionContext,
    candles5m = [],
    candles15m = [],
    allowNetworkFetch = true,
  } = options;

  let btc15m = options.btcCandles15m || [];
  let btc5m = options.btcCandles5m || [];

  // 1. Fetch BTC correlation klines if missing and network allowed (wrapped in strict 2.5s timeout)
  if (allowNetworkFetch && (btc15m.length === 0 || btc5m.length === 0)) {
    try {
      const [fetched15m, fetched5m] = await Promise.all([
        btc15m.length === 0 ? fetchBtcCandlesIsolated('15m', 30) : Promise.resolve(btc15m),
        btc5m.length === 0 ? fetchBtcCandlesIsolated('5m', 30) : Promise.resolve(btc5m),
      ]);
      btc15m = fetched15m;
      btc5m = fetched5m;
    } catch {
      // Non-fatal isolation failover
      btc15m = [];
      btc5m = [];
    }
  }

  // ── Workstream A.1: Structural Dealing Range & Valuation ───────────────────
  let anchorHigh = 0;
  let anchorLow = 0;
  let equilibrium = 0;

  // 1. Run structure analysis on 1H (macro multi-hour) and 15m (operational)
  let structure1h: any = null;
  if (options.candles1h && options.candles1h.length >= 10) {
    try {
      structure1h = analyzeMarketStructure(options.candles1h, livePrice);
    } catch {
      structure1h = null;
    }
  }

  let structure15m: any = null;
  if (candles15m.length >= 5) {
    try {
      structure15m = analyzeMarketStructure(candles15m, livePrice);
    } catch {
      structure15m = null;
    }
  }

  // 2. Initial dealing range selection: prefer 1H macro dealing range, falling back to 15m
  const primaryDr =
    structure1h?.dealingRange &&
    typeof structure1h.dealingRange.high === 'number' &&
    typeof structure1h.dealingRange.low === 'number' &&
    structure1h.dealingRange.high > structure1h.dealingRange.low
      ? structure1h.dealingRange
      : structure15m?.dealingRange;

  if (
    primaryDr &&
    typeof primaryDr.high === 'number' &&
    typeof primaryDr.low === 'number' &&
    primaryDr.high > primaryDr.low
  ) {
    anchorHigh = Number(primaryDr.high);
    anchorLow = Number(primaryDr.low);
  }

  // 3. Prevent Dealing Range Micro-Collapse (Critical Guardrail: >= 35.0 points on ETH)
  // Search expands backwards into 1H/4H macro swing history (up to 48-72 hours)
  // to locate genuine preceding Level-2 Major anchors, rather than synthesizing artificial levels.
  const minDealingRangeDepth = Math.max(35.0, parseFloat((livePrice * 0.015).toFixed(2)));

  if (anchorHigh <= anchorLow || anchorHigh - anchorLow < minDealingRangeDepth) {
    const majorHighs: number[] = [];
    const majorLows: number[] = [];

    if (structure1h?.swings) {
      for (const s of structure1h.swings) {
        if (s.grade === 'MAJOR' && s.colorValidated !== false) {
          if (s.type === 'HIGH') majorHighs.push(Number(s.price));
          if (s.type === 'LOW') majorLows.push(Number(s.price));
        }
      }
    }

    if (structure15m?.swings) {
      for (const s of structure15m.swings) {
        if (s.grade === 'MAJOR' && s.colorValidated !== false) {
          if (s.type === 'HIGH') majorHighs.push(Number(s.price));
          if (s.type === 'LOW') majorLows.push(Number(s.price));
        }
      }
    }

    if (options.candles4h && options.candles4h.length >= 5) {
      try {
        const structure4h = analyzeMarketStructure(options.candles4h, livePrice);
        if (structure4h?.swings) {
          for (const s of structure4h.swings) {
            if (s.grade === 'MAJOR' && s.colorValidated !== false) {
              if (s.type === 'HIGH') majorHighs.push(Number(s.price));
              if (s.type === 'LOW') majorLows.push(Number(s.price));
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }

    if (majorHighs.length > 0) {
      anchorHigh = Math.max(anchorHigh, ...majorHighs);
    }
    if (majorLows.length > 0) {
      anchorLow = anchorLow === 0 ? Math.min(...majorLows) : Math.min(anchorLow, ...majorLows);
    }

    // If depth is still insufficient, expand into genuine 48-72h historical candle extremes
    if (anchorHigh <= anchorLow || anchorHigh - anchorLow < minDealingRangeDepth) {
      const macroCandlePool =
        options.candles1h && options.candles1h.length > 0
          ? options.candles1h.slice(-72)
          : options.candles4h && options.candles4h.length > 0
          ? options.candles4h.slice(-18)
          : candles15m.slice(-96);

      if (macroCandlePool.length > 0) {
        const poolHigh = Math.max(...macroCandlePool.map((c) => c.h));
        const poolLow = Math.min(...macroCandlePool.map((c) => c.l));
        anchorHigh = Math.max(anchorHigh, poolHigh);
        anchorLow = anchorLow === 0 ? poolLow : Math.min(anchorLow, poolLow);
      }
    }
  }

  // 🛡️ DYNAMIC DEALING RANGE ENCLOSURE INVARIANT:
  // The active dealing range MUST strictly enclose current price: anchorHigh >= livePrice >= anchorLow.
  if (livePrice > anchorHigh) {
    anchorHigh = livePrice;
  }
  if (livePrice < anchorLow || anchorLow === 0) {
    anchorLow = livePrice;
  }

  anchorHigh = parseFloat(anchorHigh.toFixed(2));
  anchorLow = parseFloat(anchorLow.toFixed(2));
  equilibrium = parseFloat(((anchorHigh + anchorLow) / 2).toFixed(2));

  // Determine current_pricing with 0.10% equilibrium band
  const eqTolerance = equilibrium * 0.001;
  let currentPricing: 'DISCOUNT' | 'PREMIUM' | 'EQUILIBRIUM' = 'EQUILIBRIUM';
  if (livePrice > equilibrium + eqTolerance) {
    currentPricing = 'PREMIUM';
  } else if (livePrice < equilibrium - eqTolerance) {
    currentPricing = 'DISCOUNT';
  } else {
    currentPricing = 'EQUILIBRIUM';
  }

  const localDealingRange: HydratedLocalDealingRange = {
    anchor_high: anchorHigh,
    anchor_low: anchorLow,
    equilibrium: equilibrium,
    current_status: currentPricing,
    structural_dealing_range_valuation: currentPricing,
    valuation_basis_note:
      'ICT 50% Equilibrium between validated Level-2 Major impulse extremes (macro structural valuation).',
  };

  // ── Workstream A.2: Auction Market Theory (AMT) Value Area ─────────────────
  let vah: number | null = null;
  let val: number | null = null;
  let poc: number | null = null;
  let isOutsideValueArea = false;
  let auctionStatus = 'VALUE_ACCEPTANCE_CHOP';

  const refCandlesForVa = candles15m.length >= 10 ? candles15m : candles5m;
  if (refCandlesForVa.length >= 2) {
    const vaProfile = calculateValueAreaProfile(refCandlesForVa, refCandlesForVa.length - 1, 96);
    if (vaProfile) {
      vah = vaProfile.vah;
      val = vaProfile.val;
      poc = vaProfile.poc;
      if (vah !== null && val !== null) {
        if (livePrice > vah) {
          isOutsideValueArea = true;
          auctionStatus = 'PREMIUM_AUCTION_EXPANSION (> VAH)';
        } else if (livePrice < val) {
          isOutsideValueArea = true;
          auctionStatus = 'DISCOUNT_AUCTION_EXPANSION (< VAL)';
        } else {
          isOutsideValueArea = false;
          auctionStatus = 'VALUE_ACCEPTANCE_CHOP (INSIDE VA)';
        }
      }
    }
  }

  const valueArea: HydratedValueArea = {
    vah,
    val,
    poc,
    is_outside_value_area: isOutsideValueArea,
    auction_status: auctionStatus,
  };

  let valuationReconciliationNote =
    'ALIGNED: Macro structural dealing range valuation and Volume Profile auction state are in harmonious agreement.';
  if (currentPricing === 'DISCOUNT' && isOutsideValueArea && vah !== null && livePrice > vah) {
    valuationReconciliationNote =
      'MACRO_DISCOUNT_INTERNAL_BULLISH_EXPANSION: Price is structurally in macro DISCOUNT (< Equilibrium), with an active Auction Market Theory initiative expansion leg expanding above intraday VAH targeting higher dealing range liquidity.';
  } else if (currentPricing === 'PREMIUM' && isOutsideValueArea && val !== null && livePrice < val) {
    valuationReconciliationNote =
      'MACRO_PREMIUM_INTERNAL_BEARISH_EXPANSION: Price is structurally in macro PREMIUM (> Equilibrium), with an active Auction Market Theory initiative expansion leg expanding below intraday VAL targeting lower dealing range liquidity.';
  }

  // ── Workstream A.3: Consolidated Active FVGs ───────────────────────────────
  const rawFvgs15m = detectActiveFVGs(candles15m, true);
  const rawFvgs5m = detectActiveFVGs(candles5m, true);

  const formatFvgs = (list: any[], tf: string, candles: Candle[]): HydratedActiveFvg[] => {
    const latestCandle = candles.length > 0 ? candles[candles.length - 1] : null;
    const latestTs = latestCandle ? latestCandle.t : Date.now();
    const tfMinutes = tf === '15m' ? 15 : tf === '5m' ? 5 : tf === '1h' ? 60 : 15;

    return list
      .filter((f) => f.status === 'ACTIVE_UNMITIGATED' || f.status === 'ACTIVE_RETESTED')
      .map((f) => {
        const isBisi = f.type === 'BISI';
        const top = parseFloat(Number(f.coordinates.top).toFixed(2));
        const bottom = parseFloat(Number(f.coordinates.bottom).toFixed(2));
        const ce = parseFloat(Number(f.coordinates.ce_50_percent).toFixed(2));

        // Proximal Edge:
        // For BISI (bullish pullback into discount): price approaches from above -> proximal edge is top
        // For SIBI (bearish pullback into premium): price approaches from below -> proximal edge is bottom
        const proximalEdge = isBisi ? top : bottom;
        const distalEdge = isBisi ? bottom : top;
        const distanceToPrice = parseFloat(Math.abs(livePrice - proximalEdge).toFixed(2));

        // Age metadata
        const originTime = typeof f.origin_time === 'number' ? f.origin_time : latestTs;
        const createdAtTime = new Date(originTime).toISOString();
        const origIdx = candles.findIndex((c) => c.t === originTime);
        const ageBars =
          origIdx >= 0
            ? candles.length - 1 - origIdx
            : Math.max(1, Math.round((latestTs - originTime) / (tfMinutes * 60 * 1000)));
        const ageMinutes = Math.max(0, Math.round((latestTs - originTime) / (60 * 1000)));

        return {
          timeframe: tf,
          type: isBisi ? ('BISI' as const) : ('SIBI' as const),
          direction: isBisi ? ('BULLISH' as const) : ('BEARISH' as const),
          proximal_edge: proximalEdge,
          distal_edge: distalEdge,
          ce,
          status: f.status,
          distance_to_price: distanceToPrice,
          created_at_time: createdAtTime,
          age_bars: ageBars,
          age_minutes: ageMinutes,
        };
      });
  };

  const consolidatedFvgs = [
    ...formatFvgs(rawFvgs15m, '15m', candles15m),
    ...formatFvgs(rawFvgs5m, '5m', candles5m),
  ].sort((a, b) => a.distance_to_price - b.distance_to_price);

  const sibiFvgs = consolidatedFvgs.filter((f) => f.type === 'SIBI');
  const bisiFvgs = consolidatedFvgs.filter((f) => f.type === 'BISI');

  // Valuation-aware prioritization of active FVGs (up to 6 total):
  let activeFvgs: HydratedActiveFvg[] = [];
  if (currentPricing === 'PREMIUM') {
    // In PREMIUM, prioritize nearest SIBIs (overhead resistance / short execution zones)
    const prioritySibis = sibiFvgs.slice(0, 4);
    const targetBisis = bisiFvgs.slice(0, 6 - prioritySibis.length);
    activeFvgs = [...prioritySibis, ...targetBisis].sort((a, b) => a.distance_to_price - b.distance_to_price);
  } else if (currentPricing === 'DISCOUNT') {
    // In DISCOUNT, prioritize nearest BISIs (discount support / long execution zones)
    const priorityBisis = bisiFvgs.slice(0, 4);
    const targetSibis = sibiFvgs.slice(0, 6 - priorityBisis.length);
    activeFvgs = [...priorityBisis, ...targetSibis].sort((a, b) => a.distance_to_price - b.distance_to_price);
  } else {
    activeFvgs = consolidatedFvgs.slice(0, 6);
  }

  // Workstream D: Reconcile detected FVG count strings with serialized array length
  const activeSibiCount = activeFvgs.filter((f) => f.type === 'SIBI').length;
  const activeBisiCount = activeFvgs.filter((f) => f.type === 'BISI').length;
  const nearestSibi = activeFvgs.find((f) => f.type === 'SIBI');
  const nearestBisi = activeFvgs.find((f) => f.type === 'BISI');

  let overheadSibiStatus: string;
  if (activeSibiCount > 0 && nearestSibi) {
    overheadSibiStatus = `ACTIVE_OVERHEAD_SIBI_AVAILABLE (${activeSibiCount} detected, nearest proximal at $${nearestSibi.proximal_edge})`;
  } else {
    overheadSibiStatus =
      'NONE_DETECTED_WITHIN_WINDOW (Price in PREMIUM: requires fresh SIBI formation for short execution)';
  }

  let discountBisiStatus: string;
  if (activeBisiCount > 0 && nearestBisi) {
    discountBisiStatus = `ACTIVE_DISCOUNT_BISI_AVAILABLE (${activeBisiCount} detected, nearest proximal at $${nearestBisi.proximal_edge})`;
  } else {
    discountBisiStatus =
      'NONE_DETECTED_WITHIN_WINDOW (Price in DISCOUNT: requires fresh BISI formation for long execution)';
  }

  // ── Workstream A.4: Intermarket SMT Divergence Engine ───────────────────────
  let smtStatus: 'BULLISH_SMT' | 'BEARISH_SMT' | 'NEUTRAL' = 'NEUTRAL';
  let divergenceDetected = false;
  let ethVsBtcSummary = 'NEUTRAL — No divergence detected across reference swings';

  if (btc15m.length >= 5 && candles15m.length >= 5) {
    const smt15m = evaluateMicroSmt(candles15m, btc15m);
    const smt5m = btc5m.length >= 5 && candles5m.length >= 5 ? evaluateMicroSmt(candles5m, btc5m) : 'NONE';

    if (smt15m === 'BULLISH_CONFIRMED' || smt5m === 'BULLISH_CONFIRMED') {
      divergenceDetected = true;
      smtStatus = 'BULLISH_SMT';
      ethVsBtcSummary = 'BULLISH_SMT — ETH pierced lower low while BTC formed higher low (institutional buy sponsorship)';
    } else if (smt15m === 'BEARISH_CONFIRMED' || smt5m === 'BEARISH_CONFIRMED') {
      divergenceDetected = true;
      smtStatus = 'BEARISH_SMT';
      ethVsBtcSummary = 'BEARISH_SMT — ETH pushed higher high while BTC formed lower high (institutional sell distribution)';
    } else {
      smtStatus = 'NEUTRAL';
      divergenceDetected = false;
      ethVsBtcSummary =
        'NEUTRAL_SYNCHRONIZED — ETH and BTC expanding synchronously with zero structural divergence.';
    }
  } else {
    // Isolated Failover
    smtStatus = 'NEUTRAL';
    divergenceDetected = false;
    ethVsBtcSummary =
      'OFFLINE_FALLBACK — BTC correlation telemetry offline (permissive neutral baseline applied)';
  }

  const smtContext: HydratedSmtContext = {
    divergence_detected: divergenceDetected,
    status: smtStatus,
    eth_vs_btc_summary: ethVsBtcSummary,
  };

  // ── Workstream A.5: Order Flow & Volumetric Sponsorship Proof ───────────────
  // Inspect latest closed 15m candle
  const primaryCandles = candles15m.length >= 2 ? candles15m : candles5m;
  const lastIdx = primaryCandles.length - 1;
  const isLastOpen = primaryCandles[lastIdx]?.isClosed === false;
  const closedIdx = isLastOpen && lastIdx >= 1 ? lastIdx - 1 : lastIdx;
  const targetCandle = primaryCandles[closedIdx] || {
    t: Date.now(),
    o: livePrice,
    h: livePrice,
    l: livePrice,
    c: livePrice,
    v: 100,
    taker_buy_vol: 50,
    taker_sell_vol: 50,
  };

  // 1. Volume vs SMA20 multiplier
  const priorWindow = primaryCandles.slice(Math.max(0, closedIdx - 20), closedIdx);
  const avgSmaVol =
    priorWindow.length > 0
      ? priorWindow.reduce((sum, c) => sum + (c.v || 0), 0) / priorWindow.length
      : targetCandle.v || 1;
  const volumeExpansionRatio =
    avgSmaVol > 0 ? parseFloat(((targetCandle.v || 0) / avgSmaVol).toFixed(2)) : 1.0;

  // 2. Taker Delta percentage dominance
  const candleTotalVol =
    targetCandle.v ||
    (targetCandle.taker_buy_vol || 0) + (targetCandle.taker_sell_vol || 0) ||
    1;
  const isBullishCandle = targetCandle.c >= targetCandle.o;
  const dominantTakerVol = isBullishCandle
    ? targetCandle.taker_buy_vol || candleTotalVol * 0.5
    : targetCandle.taker_sell_vol || candleTotalVol * 0.5;
  const takerDeltaPercent = parseFloat(
    Math.min(100, Math.max(0, (dominantTakerVol / candleTotalVol) * 100)).toFixed(1)
  );

  // 3. Body-to-Range ratio
  const candleRange = Math.max(0.0001, targetCandle.h - targetCandle.l);
  const candleBody = Math.abs(targetCandle.c - targetCandle.o);
  const bodyRatio = parseFloat((candleBody / candleRange).toFixed(2));

  // 4. Open Interest Regime
  let openInterestRegime = 'FLAT';
  if (allowNetworkFetch) {
    try {
      const oiLiqs = await fetchOIMetricsAndLiquidations(symbol, isBullishCandle);
      if (oiLiqs?.open_interest_trend && oiLiqs.open_interest_trend !== 'UNAVAILABLE') {
        openInterestRegime = oiLiqs.open_interest_trend;
      }
    } catch {
      // Fallback below
    }
  }

  if (openInterestRegime === 'FLAT' || openInterestRegime === 'UNAVAILABLE') {
    if (isBullishCandle && takerDeltaPercent >= 52.0) {
      openInterestRegime = 'RISING_WITH_PRICE';
    } else if (!isBullishCandle && takerDeltaPercent >= 52.0) {
      openInterestRegime = 'RISING_AGAINST_PRICE';
    } else {
      openInterestRegime = 'FLAT';
    }
  }

  const isThreePillarDisplaced =
    volumeExpansionRatio >= 1.25 && takerDeltaPercent >= 52.0 && bodyRatio >= 0.5;

  const displacementMetrics: HydratedDisplacementMetrics = {
    volume_expansion_ratio: volumeExpansionRatio,
    taker_delta_percent: takerDeltaPercent,
    body_ratio: bodyRatio,
    is_three_pillar_displaced: isThreePillarDisplaced,
    open_interest_regime: openInterestRegime,
  };

  // ── Workstream B: Macro Structural Magnet Filtering & Minimum Clearance ──
  // Enforce minimum spatial clearance: >= 0.25% or >= 5.0 points on ETH
  const minMagnetClearance = Math.max(5.0, parseFloat((livePrice * 0.0025).toFixed(2)));

  const rawBslCandidates: number[] = [];
  const rawSslCandidates: number[] = [];

  // 1. Validated Level-2 Major swing fractals (from 1H and 15m)
  if (structure1h?.swings) {
    for (const s of structure1h.swings) {
      if (s.grade === 'MAJOR' && s.colorValidated !== false) {
        if (s.type === 'HIGH') rawBslCandidates.push(Number(s.price));
        if (s.type === 'LOW') rawSslCandidates.push(Number(s.price));
      }
    }
  }

  if (structure15m?.swings) {
    for (const s of structure15m.swings) {
      if (s.grade === 'MAJOR' && s.colorValidated !== false) {
        if (s.type === 'HIGH') rawBslCandidates.push(Number(s.price));
        if (s.type === 'LOW') rawSslCandidates.push(Number(s.price));
      }
    }
  }

  // Also include Dealing Range Major anchors
  if (anchorHigh > livePrice) rawBslCandidates.push(anchorHigh);
  if (anchorLow < livePrice && anchorLow > 0) rawSslCandidates.push(anchorLow);

  // 2. Macro session boundaries (Asian High/Low, London High/Low, PDH/PDL)
  const contextAny = sessionContext as any;
  if (contextAny?.session_ranges) {
    for (const range of Object.values(contextAny.session_ranges)) {
      if (range && typeof range === 'object') {
        const r = range as any;
        if (typeof r.high === 'number' && !isNaN(r.high)) rawBslCandidates.push(r.high);
        if (typeof r.low === 'number' && !isNaN(r.low)) rawSslCandidates.push(r.low);
      }
    }
  }
  if (contextAny?.macro_levels) {
    const ml = contextAny.macro_levels;
    if (typeof ml.pdh === 'number' && ml.pdh > 0) rawBslCandidates.push(ml.pdh);
    if (typeof ml.pdl === 'number' && ml.pdl > 0) rawSslCandidates.push(ml.pdl);
    if (typeof ml.asian_high === 'number' && ml.asian_high > 0) rawBslCandidates.push(ml.asian_high);
    if (typeof ml.asian_low === 'number' && ml.asian_low > 0) rawSslCandidates.push(ml.asian_low);
    if (typeof ml.london_high === 'number' && ml.london_high > 0) rawBslCandidates.push(ml.london_high);
    if (typeof ml.london_low === 'number' && ml.london_low > 0) rawSslCandidates.push(ml.london_low);
  }

  // Extract session boundaries from 1H / 15m candles if not already in sessionContext
  const refCandlesForSessions =
    options.candles1h && options.candles1h.length >= 24 ? options.candles1h : candles15m;
  if (refCandlesForSessions.length >= 24) {
    const nowUtc = new Date(sessionContext.timestamp_utc || Date.now());
    const yesterdayUtcDate = new Date(
      Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() - 1)
    );
    const yesterdayCandles = refCandlesForSessions.filter((c) => {
      const d = new Date(c.t);
      return (
        d.getUTCFullYear() === yesterdayUtcDate.getUTCFullYear() &&
        d.getUTCMonth() === yesterdayUtcDate.getUTCMonth() &&
        d.getUTCDate() === yesterdayUtcDate.getUTCDate()
      );
    });
    if (yesterdayCandles.length > 0) {
      const pdh = Math.max(...yesterdayCandles.map((c) => c.h));
      const pdl = Math.min(...yesterdayCandles.map((c) => c.l));
      rawBslCandidates.push(pdh);
      rawSslCandidates.push(pdl);
    }

    const todayCandles = refCandlesForSessions.filter((c) => {
      const d = new Date(c.t);
      return (
        d.getUTCFullYear() === nowUtc.getUTCFullYear() &&
        d.getUTCMonth() === nowUtc.getUTCMonth() &&
        d.getUTCDate() === nowUtc.getUTCDate()
      );
    });

    const asianCandles = todayCandles.filter((c) => {
      const h = new Date(c.t).getUTCHours();
      return h >= 0 && h < 7;
    });
    if (asianCandles.length > 0) {
      rawBslCandidates.push(Math.max(...asianCandles.map((c) => c.h)));
      rawSslCandidates.push(Math.min(...asianCandles.map((c) => c.l)));
    }

    const londonCandles = todayCandles.filter((c) => {
      const h = new Date(c.t).getUTCHours();
      return h >= 7 && h < 12;
    });
    if (londonCandles.length > 0) {
      rawBslCandidates.push(Math.max(...londonCandles.map((c) => c.h)));
      rawSslCandidates.push(Math.min(...londonCandles.map((c) => c.l)));
    }
  }

  // 3. Strict Spatial Clearance Filtering & Directional Sorting:
  // BSL: must sit strictly >= livePrice + minMagnetClearance (sorted ascending: nearest overhead pool first)
  // SSL: must sit strictly <= livePrice - minMagnetClearance (sorted descending: nearest downside pool first)
  const bslFiltered = Array.from(
    new Set(
      rawBslCandidates
        .filter((p) => typeof p === 'number' && !isNaN(p) && p >= livePrice + minMagnetClearance)
        .map((p) => parseFloat(p.toFixed(2)))
    )
  ).sort((a, b) => a - b);

  const sslFiltered = Array.from(
    new Set(
      rawSslCandidates
        .filter((p) => typeof p === 'number' && !isNaN(p) && p <= livePrice - minMagnetClearance)
        .map((p) => parseFloat(p.toFixed(2)))
    )
  ).sort((a, b) => b - a);

  // Micro-Invariant 2: Safe fallback projection pool strictly outside clearance threshold
  const finalBsl =
    bslFiltered.length >= 2
      ? bslFiltered.slice(0, 3)
      : bslFiltered.length === 1
      ? [
          bslFiltered[0],
          parseFloat((Math.max(bslFiltered[0], anchorHigh) + minMagnetClearance * 1.5).toFixed(2)),
          parseFloat((Math.max(bslFiltered[0], anchorHigh) + minMagnetClearance * 3.0).toFixed(2)),
        ]
      : [
          parseFloat(Math.max(anchorHigh, livePrice + minMagnetClearance * 1.5).toFixed(2)),
          parseFloat((Math.max(anchorHigh, livePrice) + minMagnetClearance * 2.5).toFixed(2)),
        ];

  const finalSsl =
    sslFiltered.length >= 2
      ? sslFiltered.slice(0, 3)
      : sslFiltered.length === 1
      ? [
          sslFiltered[0],
          parseFloat((Math.min(sslFiltered[0], anchorLow) - minMagnetClearance * 1.5).toFixed(2)),
          parseFloat((Math.min(sslFiltered[0], anchorLow) - minMagnetClearance * 3.0).toFixed(2)),
        ]
      : [
          parseFloat(Math.min(anchorLow, livePrice - minMagnetClearance * 1.5).toFixed(2)),
          parseFloat((Math.min(anchorLow, livePrice) - minMagnetClearance * 2.5).toFixed(2)),
        ];

  // ── Workstream D: Synthetic Integrity Verification Block ───────────────────
  // Inspect latest closed bars across operational timeframes (excluding active forming bar)
  const getLatestClosedCandle = (arr?: Candle[]): Candle | null => {
    if (!arr || arr.length === 0) return null;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].isClosed !== false) return arr[i];
    }
    return arr[arr.length - 1];
  };

  const closedCandle5m = getLatestClosedCandle(candles5m);
  const closedCandle15m = getLatestClosedCandle(candles15m);

  const latestClosedCloses: number[] = [];
  if (closedCandle5m) latestClosedCloses.push(closedCandle5m.c);
  if (closedCandle15m) latestClosedCloses.push(closedCandle15m.c);

  let maxDeviationPercent = 0;
  let timeframeConvergence = true;
  if (latestClosedCloses.length > 0) {
    const minClose = Math.min(...latestClosedCloses);
    const maxClose = Math.max(...latestClosedCloses);
    maxDeviationPercent = parseFloat((((maxClose - minClose) / livePrice) * 100).toFixed(4));
    timeframeConvergence = maxDeviationPercent <= 0.20;
  }

  // Stale feed detection: check if any series repeats identical closes for N bars
  const checkFeedStale = (arr?: Candle[], n: number = 3): boolean => {
    if (!arr || arr.length < n) return false;
    const closed = arr.filter((c) => c.isClosed !== false);
    if (closed.length < n) return false;
    const lastN = closed.slice(-n);
    const firstClose = lastN[0].c;
    return lastN.every((c) => Math.abs(c.c - firstClose) < 0.0001);
  };

  // Synthetic volume anomaly detection
  const volumeSyntheticDetected =
    detectSyntheticVolume(candles5m) ||
    detectSyntheticVolume(candles15m) ||
    detectSyntheticVolume(options.candles1h);

  const priceFeedStale =
    checkFeedStale(candles5m, 3) ||
    checkFeedStale(candles15m, 3) ||
    checkFeedStale(options.candles1h, 3);

  const feedStale = priceFeedStale || volumeSyntheticDetected;

  const dealingRangeEnclosed = anchorHigh >= livePrice - 0.05 && anchorLow <= livePrice + 0.05;
  const magnetsValid =
    finalBsl.length > 0 &&
    finalSsl.length > 0 &&
    finalBsl.every((p) => p >= livePrice + minMagnetClearance - 0.01) &&
    finalSsl.every((p) => p <= livePrice - minMagnetClearance + 0.01);
  const overheadSibiPresent = activeSibiCount > 0;

  const integrity: HydratedIntegrityBlock = {
    timeframe_convergence: timeframeConvergence,
    timeframe_max_deviation_percent: maxDeviationPercent,
    dealing_range_enclosed: dealingRangeEnclosed,
    magnets_valid: magnetsValid,
    overhead_sibi_present: overheadSibiPresent,
    feed_stale: feedStale,
    volume_synthetic_detected: volumeSyntheticDetected,
  };

  // ── Workstream E: Complete Hydrated IPDA Metrics Assembly (Deduplicated) ──────
  return {
    _integrity: integrity,
    current_time_window: sessionContext.current_killzone,
    current_pricing: currentPricing,
    pricing_context: {
      local_dealing_range: localDealingRange,
      value_area: valueArea,
      valuation_reconciliation_note: valuationReconciliationNote,
    },
    active_fvgs: activeFvgs,
    overhead_sibi_status: overheadSibiStatus,
    discount_bisi_status: discountBisiStatus,
    smt_context: smtContext,
    displacement_metrics: displacementMetrics,
    open_interest_regime: openInterestRegime,
    macro_structural_magnets: {
      bsl: finalBsl,
      ssl: finalSsl,
    },
  };
}

/**
 * Detects synthetic or mock volume artifacts:
 * 1. Multi-bar consecutive identical volume values (>= 3 bars with identical volume).
 * 2. Zero-variance volume distributions (variance < 0.0001).
 * 3. Deterministic repeating cyclical loop patterns (period p in [2, 10]).
 * 4. Multi-bar consecutive zero volume in active futures market (>= 3 bars).
 */
export function detectSyntheticVolume(candles?: Candle[], minBars: number = 8): boolean {
  if (!candles || candles.length < minBars) return false;
  const closed = candles.filter((c) => c.isClosed !== false);
  if (closed.length < minBars) return false;

  const vols = closed.slice(-Math.min(40, closed.length)).map((c) => c.v || 0);

  // 1. Check for consecutive identical non-zero volumes (>= 3 bars)
  for (let i = 2; i < vols.length; i++) {
    if (vols[i] > 0 && Math.abs(vols[i] - vols[i - 1]) < 0.0001 && Math.abs(vols[i - 1] - vols[i - 2]) < 0.0001) {
      return true;
    }
  }

  // 2. Check for consecutive zero volumes (>= 3 bars)
  for (let i = 2; i < vols.length; i++) {
    if (vols[i] === 0 && vols[i - 1] === 0 && vols[i - 2] === 0) {
      return true;
    }
  }

  // 3. Check for zero-variance distribution across closed bars
  const mean = vols.reduce((s, v) => s + v, 0) / vols.length;
  const variance = vols.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vols.length;
  if (variance < 0.0001) {
    return true; // Zero variance
  }

  // 4. Check for repeating cyclical loops (period p from 2 to 10)
  for (let p = 2; p <= 10; p++) {
    if (vols.length >= p * 2) {
      let isCyclic = true;
      for (let j = 0; j < p; j++) {
        const idx1 = vols.length - 1 - j;
        const idx2 = idx1 - p;
        if (Math.abs(vols[idx1] - vols[idx2]) > 0.0001) {
          isCyclic = false;
          break;
        }
      }
      if (isCyclic) {
        if (p >= 4) return true;
        if (vols.length >= p * 3) {
          let isCycle2 = true;
          for (let j = 0; j < p; j++) {
            const idx1 = vols.length - 1 - j;
            const idx3 = idx1 - 2 * p;
            if (Math.abs(vols[idx1] - vols[idx3]) > 0.0001) {
              isCycle2 = false;
              break;
            }
          }
          if (isCycle2) return true;
        }
      }
    }
  }

  return false;
}

/**
 * Enforces strict hierarchical price consistency between lower timeframe (child)
 * and higher timeframe (parent) candles (e.g., 15m ≡ 5m or 4H ≡ 1H).
 *
 * Micro-Invariants enforced for each parent candle:
 * - parent.o = firstChild.o
 * - parent.c = lastChild.c
 * - parent.h = max(child highs)
 * - parent.l = min(child lows)
 * - parent.v = sum(child volumes)
 * - parent.taker_buy_vol = sum(child taker_buy_vol)
 * - parent.taker_sell_vol = sum(child taker_sell_vol)
 *
 * Safe Live-Edge Forming Bar Handling:
 * - If a parent window contains partial sets of child candles (e.g. 1 or 2 closed 5m bars
 *   for an open 15m bar), the parent aggregates whatever child bars are present so far,
 *   and marks `parent.isClosed = false`.
 * - If the parent window is closed (all expected child bars are present and closed),
 *   `parent.isClosed = true`.
 * - If no child bars exist in the child buffer for an older historical parent bar,
 *   the historical parent bar is preserved as-is.
 */
export function reconcileHierarchicalCandles(
  childCandles: Candle[],
  parentCandles: Candle[],
  childIntervalMinutes: number = 5,
  parentIntervalMinutes: number = 15
): Candle[] {
  if (!parentCandles || parentCandles.length === 0) return [];
  if (!childCandles || childCandles.length === 0) return parentCandles.map((c) => ({ ...c }));

  const parentIntervalMs = parentIntervalMinutes * 60 * 1000;
  const expectedChildCount = Math.floor(parentIntervalMinutes / childIntervalMinutes);

  // Index child candles into parent buckets
  const bucketMap = new Map<number, Candle[]>();
  for (const child of childCandles) {
    const bucketTs = child.t - (child.t % parentIntervalMs);
    const list = bucketMap.get(bucketTs) || [];
    list.push(child);
    bucketMap.set(bucketTs, list);
  }

  const result: Candle[] = [];

  for (const p of parentCandles) {
    const bucketTs = p.t - (p.t % parentIntervalMs);
    const children = bucketMap.get(bucketTs);

    if (!children || children.length === 0) {
      // Historical parent candle outside child buffer range: retain original
      result.push({ ...p });
      continue;
    }

    // Sort constituent children strictly ascending by timestamp
    const sorted = [...children].sort((a, b) => a.t - b.t);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    let maxHigh = -Infinity;
    let minLow = Infinity;
    let totalVol = 0;
    let totalTakerBuy = 0;
    let totalTakerSell = 0;

    for (const c of sorted) {
      if (c.h > maxHigh) maxHigh = c.h;
      if (c.l < minLow) minLow = c.l;
      totalVol += c.v || 0;
      totalTakerBuy += c.taker_buy_vol || 0;
      totalTakerSell += c.taker_sell_vol || 0;
    }

    // Safe live-edge forming bar handling:
    // Parent is closed ONLY if all expected child bars exist AND all children are closed
    const hasAllChildren = sorted.length >= expectedChildCount;
    const allChildrenClosed = sorted.every((c) => c.isClosed !== false);
    const isClosed = hasAllChildren && allChildrenClosed;

    result.push({
      t: bucketTs,
      o: first.o,
      h: parseFloat(maxHigh.toFixed(2)),
      l: parseFloat(minLow.toFixed(2)),
      c: last.c,
      v: parseFloat(totalVol.toFixed(2)),
      taker_buy_vol: parseFloat(totalTakerBuy.toFixed(2)),
      taker_sell_vol: parseFloat(totalTakerSell.toFixed(2)),
      isClosed,
    });
  }

  // Check if childCandles has an active forming bucket that isn't yet in parentCandles
  const lastChild = childCandles[childCandles.length - 1];
  if (lastChild) {
    const lastChildBucket = lastChild.t - (lastChild.t % parentIntervalMs);
    const alreadyIncluded = result.some((p) => p.t === lastChildBucket);
    if (!alreadyIncluded) {
      const activeChildren = (bucketMap.get(lastChildBucket) || []).sort((a, b) => a.t - b.t);
      if (activeChildren.length > 0) {
        const first = activeChildren[0];
        const last = activeChildren[activeChildren.length - 1];
        let maxHigh = -Infinity;
        let minLow = Infinity;
        let totalVol = 0;
        let totalTakerBuy = 0;
        let totalTakerSell = 0;

        for (const c of activeChildren) {
          if (c.h > maxHigh) maxHigh = c.h;
          if (c.l < minLow) minLow = c.l;
          totalVol += c.v || 0;
          totalTakerBuy += c.taker_buy_vol || 0;
          totalTakerSell += c.taker_sell_vol || 0;
        }

        result.push({
          t: lastChildBucket,
          o: first.o,
          h: parseFloat(maxHigh.toFixed(2)),
          l: parseFloat(minLow.toFixed(2)),
          c: last.c,
          v: parseFloat(totalVol.toFixed(2)),
          taker_buy_vol: parseFloat(totalTakerBuy.toFixed(2)),
          taker_sell_vol: parseFloat(totalTakerSell.toFixed(2)),
          isClosed: false, // Active forming bar with partial child set
        });
      }
    }
  }

  const sortedResult = result.sort((a, b) => a.t - b.t);
  return sanitizeCandleClosureInvariant(sortedResult);
}

/**
 * Enforces the strict chronological closure invariant across candle arrays:
 * - All historical bars from index 0 to array.length - 2 MUST strictly have `isClosed: true`.
 * - ONLY the final forming bar at array.length - 1 is permitted to have `isClosed: false`.
 */
export function sanitizeCandleClosureInvariant(candles: Candle[]): Candle[] {
  if (!candles || candles.length === 0) return [];
  const lastIdx = candles.length - 1;
  return candles.map((c, idx) => {
    if (idx < lastIdx) {
      if (c.isClosed === false) {
        return { ...c, isClosed: true };
      }
      return c;
    }
    return c;
  });
}

