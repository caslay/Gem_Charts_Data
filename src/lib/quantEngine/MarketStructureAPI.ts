import { Candle } from '../fvgEngine';
import { PivotEngine } from './PivotEngine';
import { SMCStateEngine } from './SMCStateEngine';
import { LiquidityEngine } from './LiquidityEngine';
import { 
  MarketStructureAnalysis, MarketStructureConfig, 
  StructuralSwing, ZigZagSegment, StructuralDealingRange, Pivot 
} from './types';
import { InstitutionalSponsorship } from '../displacementEngine';
import { calculateVolumeProfile } from './VolumeProfileEngine';

export class MarketStructureAPI {
  private config?: MarketStructureConfig;

  constructor(config?: MarketStructureConfig) {
    this.config = config;
  }

  public analyze(
    candles: Candle[],
    currentPrice: number,
    displacementStatus?: InstitutionalSponsorship | null
  ): MarketStructureAnalysis {
    return this.internalAnalyze(candles, currentPrice, displacementStatus);
  }

  public analyzeWarmup(warmupCandles: Candle[]): import('./types').StructuralBootstrapContext {
    // Normalize
    const normalizedCandles = warmupCandles.map(c => ({
      ...c,
      open: c.open !== undefined ? c.open : c.o,
      high: c.high !== undefined ? c.high : c.h,
      low: c.low !== undefined ? c.low : c.l,
      close: c.close !== undefined ? c.close : c.c,
      volume: c.volume !== undefined ? c.volume : c.v
    }));

    const pivotEngine = new PivotEngine(this.config);
    pivotEngine.processCandles(normalizedCandles);

    const stateEngine     = new SMCStateEngine(this.config, 2);
    const innerStateEngine = new SMCStateEngine(this.config, 1);
    const microStateEngine = new SMCStateEngine(this.config, 0);

    stateEngine.initializeFromFirstPivot(pivotEngine.pivots);
    innerStateEngine.initializeFromFirstPivot(pivotEngine.pivots);
    microStateEngine.initializeFromFirstPivot(pivotEngine.pivots);

    for (let i = 0; i < normalizedCandles.length; i++) {
      const c = normalizedCandles[i];
      const currentPivots = pivotEngine.pivots.filter(p => p.index === i && p.confirmed);
      for (const p of currentPivots) {
        stateEngine.processPivot(p, normalizedCandles);
        innerStateEngine.processPivot(p, normalizedCandles);
        microStateEngine.processPivot(p, normalizedCandles);
      }
      const atr = c.high - c.low;
      stateEngine.processCandle(c, normalizedCandles, i, atr);
      innerStateEngine.processCandle(c, normalizedCandles, i, atr);
      microStateEngine.processCandle(c, normalizedCandles, i, atr);
    }

    const liquidityEngine = new LiquidityEngine();
    liquidityEngine.processCandlesForLiquidity(normalizedCandles);

    const majorPivots = pivotEngine.pivots.filter(p => p.level === 2);
    const majorSwings: StructuralSwing[] = majorPivots.map(pt => ({
      t: pt.timestamp,
      price: pt.price,
      type: pt.type === 'SWING_HIGH' ? 'HIGH' : 'LOW',
      grade: 'MAJOR',
      colorValidated: pt.colorValidated ?? false,
      candle_index: pt.index,
      timestamp: new Date(pt.timestamp).toISOString(),
      structure_type: 'MAJOR',
      confirmed: pt.confirmed
    }));
    
    // We only really need to pass back the final dealing range state if we want it,
    // but the engine recomputes it dynamically anyway. Let's just capture snapshots.
    return {
      majorSnapshot: stateEngine.captureSnapshot(),
      internalSnapshot: innerStateEngine.captureSnapshot(),
      microSnapshot: microStateEngine.captureSnapshot(),
      confirmedPivots: pivotEngine.pivots.filter(p => p.confirmed && p.colorValidated),
      activeFVGs: liquidityEngine.activeFVGs,
      activeOrderBlocks: liquidityEngine.activeOrderBlocks,
      institutionalOrderBlocks: liquidityEngine.institutionalOrderBlocks,
      lastConfirmedDealingRange: null, // Build if needed
      warmupCutoffTs: normalizedCandles.length > 0 ? normalizedCandles[normalizedCandles.length - 1].t : 0
    };
  }

  public analyzeWithBootstrap(
    evaluationCandles: Candle[],
    currentPrice: number,
    displacementStatus: InstitutionalSponsorship | null | undefined,
    bootstrap: import('./types').StructuralBootstrapContext
  ): MarketStructureAnalysis {
    return this.internalAnalyze(evaluationCandles, currentPrice, displacementStatus, bootstrap);
  }

  private internalAnalyze(
    candles: Candle[],
    currentPrice: number,
    displacementStatus?: InstitutionalSponsorship | null,
    bootstrap?: import('./types').StructuralBootstrapContext
  ): MarketStructureAnalysis {
    if (candles.length === 0) {
      return this.createEmptyState();
    }

    // Normalize candles to match expected schema
    const normalizedCandles = candles.map(c => ({
      ...c,
      open: c.open !== undefined ? c.open : c.o,
      high: c.high !== undefined ? c.high : c.h,
      low: c.low !== undefined ? c.low : c.l,
      close: c.close !== undefined ? c.close : c.c,
      volume: c.volume !== undefined ? c.volume : c.v
    }));

    // 1. Pivot Engine (Directional Change)
    const pivotEngine = new PivotEngine(this.config);
    if (bootstrap) {
      pivotEngine.seedConfirmedPivots(bootstrap.confirmedPivots);
    }
    pivotEngine.processCandles(normalizedCandles);

    // 2. State Engine (SMC Rules)
    const stateEngine     = new SMCStateEngine(this.config, 2);
    const innerStateEngine = new SMCStateEngine(this.config, 1);
    const microStateEngine = new SMCStateEngine(this.config, 0);

    if (bootstrap) {
      stateEngine.restoreFromSnapshot(bootstrap.majorSnapshot);
      innerStateEngine.restoreFromSnapshot(bootstrap.internalSnapshot);
      microStateEngine.restoreFromSnapshot(bootstrap.microSnapshot);
    } else {
      stateEngine.initializeFromFirstPivot(pivotEngine.pivots);
      innerStateEngine.initializeFromFirstPivot(pivotEngine.pivots);
      microStateEngine.initializeFromFirstPivot(pivotEngine.pivots);
    }

    for (let i = 0; i < normalizedCandles.length; i++) {
      const c = normalizedCandles[i];
      if (bootstrap && c.t < bootstrap.warmupCutoffTs) {
        // Skip processing candles that were already processed in warmup
        continue;
      }
      
      const currentPivots = pivotEngine.pivots.filter(p => p.index === i && p.confirmed);
      for (const p of currentPivots) {
        stateEngine.processPivot(p, normalizedCandles);
        innerStateEngine.processPivot(p, normalizedCandles);
        microStateEngine.processPivot(p, normalizedCandles);
      }
      const atr = c.high - c.low;
      stateEngine.processCandle(c, normalizedCandles, i, atr);
      innerStateEngine.processCandle(c, normalizedCandles, i, atr);
      microStateEngine.processCandle(c, normalizedCandles, i, atr);
    }

    // 3. Liquidity Engine (FVG & OB)
    const liquidityEngine = new LiquidityEngine();
    if (bootstrap) {
      liquidityEngine.seedLiquidity(bootstrap.activeFVGs, bootstrap.activeOrderBlocks, bootstrap.institutionalOrderBlocks);
    }
    
    // Only process new candles for liquidity to prevent double counting
    const newCandlesForLiquidity = bootstrap ? normalizedCandles.filter(c => c.t >= bootstrap.warmupCutoffTs) : normalizedCandles;
    liquidityEngine.processCandlesForLiquidity(newCandlesForLiquidity);

    // 4. Map to Downstream Data Contract

    // Map MAJOR Swings (Level 2)
    const majorPivots = pivotEngine.pivots.filter(p => p.level === 2);
    const majorSwings: StructuralSwing[] = majorPivots.map(pt => ({
      t: pt.timestamp,
      price: pt.price,
      type: pt.type === 'SWING_HIGH' ? 'HIGH' : 'LOW',
      grade: 'MAJOR',
      colorValidated: pt.colorValidated ?? false,
      candle_index: pt.index,
      timestamp: new Date(pt.timestamp).toISOString(),
      structure_type: 'MAJOR',
      confirmed: pt.confirmed
    }));

    // Map INTERNAL Swings (Level 1)
    const internalPivots = pivotEngine.pivots.filter(p => p.level === 1);
    const internalSwings: StructuralSwing[] = internalPivots.map(pt => ({
      t: pt.timestamp,
      price: pt.price,
      type: pt.type === 'SWING_HIGH' ? 'HIGH' : 'LOW',
      grade: 'INTERNAL',
      colorValidated: pt.colorValidated ?? false,
      candle_index: pt.index,
      timestamp: new Date(pt.timestamp).toISOString(),
      structure_type: 'INTERNAL',
      confirmed: pt.confirmed
    }));

    // Map INNER Swings (Level 0)
    const innerPivots = pivotEngine.pivots.filter(p => p.level === 0);
    const innerSwingsRaw: StructuralSwing[] = innerPivots.map(pt => ({
      t: pt.timestamp,
      price: pt.price,
      type: pt.type === 'SWING_HIGH' ? 'HIGH' : 'LOW',
      grade: 'INNER',
      colorValidated: pt.colorValidated ?? false,
      candle_index: pt.index,
      timestamp: new Date(pt.timestamp).toISOString(),
      structure_type: 'INNER',
      confirmed: pt.confirmed
    }));

    // Pass all swings to the UI layer in strict chronological order
    const swings = [...majorSwings, ...internalSwings, ...innerSwingsRaw].sort((a, b) => a.t - b.t);

    // Macro Dealing Range
    const dealingRange = this.buildDealingRange(majorSwings, currentPrice, stateEngine, normalizedCandles);

    // Dynamic macro start time based on the active confirmed Macro High or Macro Low anchors
    const majorRangeStartTime = Math.min(
      dealingRange.anchor_high_swing?.t ?? Infinity,
      dealingRange.anchor_low_swing?.t ?? Infinity
    );

    // Filter candidate internal swings strictly to exclude previous-cycle internal swings for Dealing Range
    const activeInternalSwings = majorRangeStartTime !== Infinity
      ? internalSwings.filter(s => s.t >= majorRangeStartTime)
      : internalSwings;

    // Build ZigZag Arrays — each level uses its OWN dedicated state engine (FIX BUG-2 + GAP-4)
    const zigzag         = this.buildZigZag(majorSwings,          stateEngine);            // MAJOR
    const internalZigzag = this.buildZigZag(internalSwings,        innerStateEngine, true);  // INTERNAL (all internalSwings for full historical chart coverage)
    const innerZigzag    = this.buildZigZag(innerSwingsRaw,        microStateEngine, true); // INNER (was sharing innerStateEngine — now isolated)

    const latestMSS = zigzag.filter(z => z.label === 'MSS').slice(-1)[0] ?? null;
    const hasConfirmedMSS = latestMSS !== null && latestMSS.displacementConfirmed;

    // Inner Dealing Range
    const internalDealingRange = this.buildDealingRange(activeInternalSwings, currentPrice, innerStateEngine, normalizedCandles);

    // Anti-corruption safety clamps: prevent child range boundaries from bleeding outside parent bounds.
    // FIX BUG-4: When clamping the price, DO NOT replace the anchor swing metadata with the Major anchor.
    // Replacing anchor_swing metadata would paint an INT dealing range anchored visually on a Major pivot,
    // corrupting the visual hierarchy. We clamp the price value only and null the anchor metadata instead.
    if (internalDealingRange.low !== null && dealingRange.low !== null && internalDealingRange.low < dealingRange.low) {
      internalDealingRange.low = dealingRange.low;
      // Preserve internal anchor if it exists, otherwise use the Major boundary anchor
      if (!internalDealingRange.anchor_low_swing) {
        internalDealingRange.anchor_low_swing = dealingRange.anchor_low_swing;
      }
    }
    if (internalDealingRange.high !== null && dealingRange.high !== null && internalDealingRange.high > dealingRange.high) {
      internalDealingRange.high = dealingRange.high;
      // Preserve internal anchor if it exists, otherwise use the Major boundary anchor
      if (!internalDealingRange.anchor_high_swing) {
        internalDealingRange.anchor_high_swing = dealingRange.anchor_high_swing;
      }
    }
    if (internalDealingRange.high !== null && internalDealingRange.low !== null) {
      internalDealingRange.equilibrium = parseFloat(((internalDealingRange.high + internalDealingRange.low) / 2).toFixed(2));
      internalDealingRange.current_status = currentPrice > internalDealingRange.equilibrium ? 'PREMIUM' : 'DISCOUNT';
    }

    // ─── Expansion Telemetry ─────────────────────────────────────────────────
    // Compute ATR estimate from last 14 candles for market_velocity (ATR-relative expansion speed)
    const lastN = normalizedCandles.slice(-14);
    const atr14 = lastN.length > 0
      ? lastN.reduce((sum, c) => sum + (c.high - c.low), 0) / lastN.length
      : 1;

    const is_in_expansion = stateEngine.is_in_expansion;
    const expansion_mode: 'NORMAL' | 'RUNAWAY' = is_in_expansion ? 'RUNAWAY' : 'NORMAL';
    const market_velocity = (is_in_expansion && stateEngine.expansion_origin_price !== null)
      ? parseFloat((Math.abs(currentPrice - stateEngine.expansion_origin_price) / (atr14 || 1)).toFixed(2))
      : 0;
    const runaway_origin_price = stateEngine.expansion_origin_price;

    return {
      last_processed_index: normalizedCandles.length - 1,
      engine_state: {
        current_trend_state: stateEngine.current_trend_state,
        protected_high: stateEngine.protected_high,
        protected_low: stateEngine.protected_low,
        active_swing_range: {
          low: stateEngine.active_swing_low,
          high: stateEngine.active_swing_high
        }
      },
      swing_points: pivotEngine.pivots,
      structural_events: stateEngine.registered_events,
      liquidity_zones: liquidityEngine.activeFVGs, // Or merge with OBs
      expansion_mode,
      market_velocity,
      runaway_origin_price,

      // ─── NEW Expansion Telemetry ──────────────────────────────────────────
      is_in_expansion,
      expansion_high_float: stateEngine.expansion_high_float,
      expansion_low_float: stateEngine.expansion_low_float,

      swings,
      zigzag,
      dealingRange,
      // FIX GAP-3: explicit UNSET mapping rather than silent BEARISH collapse
      currentTrend: stateEngine.current_trend_state === 'BULLISH_SWING' ? 'BULLISH'
        : stateEngine.current_trend_state === 'BEARISH_SWING' ? 'BEARISH'
        : 'UNSET',
      latestMSS,
      market_structure_shift: hasConfirmedMSS,
      market_structure_shift_direction: hasConfirmedMSS ? latestMSS!.trendAfter : null,

      subTrend: 'UNSET',
      innerSwings: innerSwingsRaw,
      innerZigzag,
      // FIX GAP-3: same explicit mapping for internal trend
      internalTrend: innerStateEngine.current_trend_state === 'BULLISH_SWING' ? 'BULLISH'
        : innerStateEngine.current_trend_state === 'BEARISH_SWING' ? 'BEARISH'
        : 'UNSET',
      // FIX GAP-4: expose the CORRECT internalZigzag variable (was shadowed by innerZigzag)
      internalZigzag,
      latestInternalMSS: internalZigzag.filter(s => s.label === 'MSS').slice(-1)[0] ?? null,
      internal_market_structure_shift: internalZigzag.some(s => s.label === 'MSS' && s.displacementConfirmed),
      internalDealingRange,
    };
  }

  private buildZigZag(swings: StructuralSwing[], stateEngine: SMCStateEngine, isInner: boolean = false): ZigZagSegment[] {
    const zigzag: ZigZagSegment[] = [];
    if (swings.length < 2) return zigzag;

    let currentTrend: 'BULLISH' | 'BEARISH' | 'UNSET' = 'UNSET';

    for (let i = 0; i < swings.length - 1; i++) {
      const from = swings[i];
      const to = swings[i + 1];

      // Avoid connecting HIGH to HIGH or LOW to LOW
      if (from.type === to.type) continue;

      // A segment runs from 'from' pivot to 'to' pivot.
      // An event that breaks structure during this leg will occur AFTER 'from' and UP TO 'to' (or slightly after, but since segments connect pivots, the event is associated with the leg).
      // Find any BOS/MSS/CHoCH event whose candle index falls between this segment's endpoints.
      const fromIdx = from.candle_index ?? 0;
      const toIdx = to.candle_index ?? Number.MAX_SAFE_INTEGER;
      
      const ev = stateEngine.registered_events.find(e => 
        (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH') &&
        e.index > fromIdx && e.index <= toIdx
      );

      let label: 'BOS' | 'MSS' | 'INTERNAL' = 'INTERNAL';
      let trendAfter: 'BULLISH' | 'BEARISH' | 'UNSET' = currentTrend;
      let brokenLevel: number | undefined = undefined;

      if (ev) {
        label = ev.type === 'BOS' ? 'BOS' : 'MSS';
        trendAfter = ev.direction || 'UNSET';
        brokenLevel = ev.level;
      }

      zigzag.push({
        from,
        to,
        label,
        trendBefore: currentTrend,
        trendAfter,
        brokenLevel,
        displacementConfirmed: label === 'MSS' && !ev?.sharp_departure_failed
      });

      currentTrend = trendAfter;
    }
    return zigzag;
  }

  private buildDealingRange(swings: StructuralSwing[], currentPrice: number, stateEngine: SMCStateEngine, normalizedCandles: Candle[]): StructuralDealingRange {
    // The true macro dealing range is bounded by the state engine anchors
    let highPrice: number = -Infinity;
    let lowPrice: number = Infinity;

    if (stateEngine.current_trend_state === 'BULLISH_SWING') {
      // ─── 3-TIER CEILING RESOLUTION (Bullish) ─────────────────────────────
      // Priority 1: Live expansion float (is_in_expansion, pre-fractal momentum leg)
      // Priority 2: Confirmed fractal pivot (active_swing_high)
      // Priority 3: Historical candle scan fallback
      if (stateEngine.is_in_expansion && stateEngine.expansion_high_float !== null) {
        highPrice = stateEngine.expansion_high_float;
      } else if (stateEngine.active_swing_high !== null) {
        highPrice = stateEngine.active_swing_high;
      } else {
        highPrice = Math.max(currentPrice, ...swings.filter(s => s.type === 'HIGH').map(s => Number(s.price)));
      }

      lowPrice = stateEngine.protected_low ?? Math.min(...swings.filter(s => s.type === 'LOW').map(s => Number(s.price)));
      
      // If we are discovering a new low, find the absolute lowest low since the protected high
      if (stateEngine.protected_low === null && stateEngine.active_swing_high === null && !stateEngine.is_in_expansion) {
        const anchorSwing = [...swings].reverse().find(s => s.type === 'LOW' && s.price === lowPrice);
        const anchorIdx = anchorSwing?.candle_index ?? 0;
        const candlesSinceAnchor = normalizedCandles.slice(anchorIdx);
        highPrice = candlesSinceAnchor.length > 0 ? Math.max(...candlesSinceAnchor.map(c => c.high)) : currentPrice;
      }
    } else {
      // ─── 3-TIER FLOOR RESOLUTION (Bearish) ───────────────────────────────
      // Priority 1: Live expansion float (is_in_expansion, pre-fractal momentum leg)
      // Priority 2: Confirmed fractal pivot (active_swing_low)
      // Priority 3: Historical candle scan fallback
      if (stateEngine.is_in_expansion && stateEngine.expansion_low_float !== null) {
        lowPrice = stateEngine.expansion_low_float;
      } else if (stateEngine.active_swing_low !== null) {
        lowPrice = stateEngine.active_swing_low;
      } else {
        lowPrice = Math.min(currentPrice, ...swings.filter(s => s.type === 'LOW').map(s => Number(s.price)));
      }

      highPrice = stateEngine.protected_high ?? Math.max(...swings.filter(s => s.type === 'HIGH').map(s => Number(s.price)));

      // If we are discovering a new high, find the absolute highest high since the protected low
      if (stateEngine.active_swing_low === null && !stateEngine.is_in_expansion) {
        const anchorSwing = [...swings].reverse().find(s => s.type === 'HIGH' && s.price === highPrice);
        const anchorIdx = anchorSwing?.candle_index ?? 0;
        const candlesSinceAnchor = normalizedCandles.slice(anchorIdx);
        lowPrice = candlesSinceAnchor.length > 0 ? Math.min(...candlesSinceAnchor.map(c => c.low)) : currentPrice;
      }
    }

    // Fallbacks if Math.max/min returns +/- Infinity (empty array)
    if (highPrice === -Infinity || highPrice === null) {
      highPrice = currentPrice;
    }
    if (lowPrice === Infinity || lowPrice === null) {
      lowPrice = currentPrice;
    }

    // ─── ANCHOR SWING RESOLUTION ─────────────────────────────────────────────
    // Find the latest swings that match these anchor prices

    // HIGH anchor
    let anchor_high_swing: StructuralSwing | null = null;

    if (stateEngine.is_in_expansion && stateEngine.expansion_high_float !== null) {
      // ─── LIVE EXPANSION ANCHOR (anti-repainting firewall) ─────────────────
      // Use the last candle as the live timestamp — NOT the stale pre-BOS pivot timestamp.
      // confirmed: false + is_expansion_float: true signals the visual layer to render as dashed.
      const lastCandle = normalizedCandles[normalizedCandles.length - 1];
      anchor_high_swing = {
        t: lastCandle.t,
        price: stateEngine.expansion_high_float,
        type: 'HIGH',
        grade: (swings[0]?.grade || 'MAJOR') as 'MAJOR' | 'INTERNAL' | 'INNER',
        colorValidated: false,         // Not yet institutionally confirmed via fractal
        candle_index: normalizedCandles.length - 1,
        timestamp: new Date(lastCandle.t).toISOString(),
        structure_type: (swings[0]?.structure_type || 'MAJOR') as 'MAJOR' | 'INTERNAL' | 'INNER',
        confirmed: false,              // Anti-repainting gate: must render as dashed/translucent
        is_expansion_float: true,      // Additional visual layer gate
      };
    } else {
      anchor_high_swing = [...swings].reverse().find(s => s.type === 'HIGH' && s.price === highPrice) || null;
      if (anchor_high_swing === null && normalizedCandles.length > 0) {
        let minDiff = Infinity;
        let closestIdx = -1;
        for (let i = 0; i < normalizedCandles.length; i++) {
          const diff = Math.abs(normalizedCandles[i].high - highPrice);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }
        if (closestIdx !== -1) {
          const c = normalizedCandles[closestIdx];
          const prev = closestIdx > 0 ? normalizedCandles[closestIdx - 1] : null;
          // FIX GAP-1: derive colorValidated from actual candle color — don't hardcode true
          const cClose = c.close ?? c.c;
          const cOpen  = c.open ?? c.o;
          const prevClose = prev ? (prev.close ?? prev.c) : null;
          const prevOpen  = prev ? (prev.open  ?? prev.o) : null;
          const fallbackHighColorValidated = cClose < cOpen &&
            prevClose !== null && prevOpen !== null && prevClose > prevOpen;
          anchor_high_swing = {
            t: c.t,
            price: c.high,
            type: 'HIGH',
            grade: swings[0]?.grade || 'MAJOR',
            colorValidated: fallbackHighColorValidated,
            candle_index: closestIdx,
            timestamp: new Date(c.t).toISOString(),
            structure_type: swings[0]?.structure_type || 'MAJOR',
            confirmed: true
          };
        }
      }
    }

    // LOW anchor
    let anchor_low_swing: StructuralSwing | null = null;

    if (stateEngine.is_in_expansion && stateEngine.expansion_low_float !== null) {
      // ─── LIVE EXPANSION ANCHOR (BEARISH) ──────────────────────────────────
      const lastCandle = normalizedCandles[normalizedCandles.length - 1];
      anchor_low_swing = {
        t: lastCandle.t,
        price: stateEngine.expansion_low_float,
        type: 'LOW',
        grade: (swings[0]?.grade || 'MAJOR') as 'MAJOR' | 'INTERNAL' | 'INNER',
        colorValidated: false,
        candle_index: normalizedCandles.length - 1,
        timestamp: new Date(lastCandle.t).toISOString(),
        structure_type: (swings[0]?.structure_type || 'MAJOR') as 'MAJOR' | 'INTERNAL' | 'INNER',
        confirmed: false,
        is_expansion_float: true,
      };
    } else {
      anchor_low_swing = [...swings].reverse().find(s => s.type === 'LOW' && s.price === lowPrice) || null;
      if (anchor_low_swing === null && normalizedCandles.length > 0) {
        let minDiff = Infinity;
        let closestIdx = -1;
        for (let i = 0; i < normalizedCandles.length; i++) {
          const diff = Math.abs(normalizedCandles[i].low - lowPrice);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }
        if (closestIdx !== -1) {
          const c = normalizedCandles[closestIdx];
          const prev = closestIdx > 0 ? normalizedCandles[closestIdx - 1] : null;
          // FIX GAP-1: derive colorValidated from actual candle color
          const cClose = c.close ?? c.c;
          const cOpen  = c.open ?? c.o;
          const prevClose = prev ? (prev.close ?? prev.c) : null;
          const prevOpen  = prev ? (prev.open  ?? prev.o) : null;
          const fallbackLowColorValidated = cClose > cOpen &&
            prevClose !== null && prevOpen !== null && prevClose < prevOpen;
          anchor_low_swing = {
            t: c.t,
            price: c.low,
            type: 'LOW',
            grade: swings[0]?.grade || 'MAJOR',
            colorValidated: fallbackLowColorValidated,
            candle_index: closestIdx,
            timestamp: new Date(c.t).toISOString(),
            structure_type: swings[0]?.structure_type || 'MAJOR',
            confirmed: true
          };
        }
      }
    }
    
    const highVal = parseFloat(highPrice.toFixed(2));
    const lowVal = parseFloat(lowPrice.toFixed(2));
    const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));

    const dr: StructuralDealingRange = {
      high: highVal,
      low: lowVal,
      equilibrium: eqVal,
      current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
      anchor_high_swing,
      anchor_low_swing
    };

    // Thread is_in_expansion to VolumeProfileEngine so the AMT window extends to the live edge
    dr.profile_metrics = calculateVolumeProfile(dr, normalizedCandles, stateEngine.is_in_expansion);
    return dr;
  }

  private createEmptyState(): MarketStructureAnalysis {
    return {
      last_processed_index: 0,
      engine_state: {
        current_trend_state: 'BULLISH_SWING',
        protected_high: null,
        protected_low: null,
        active_swing_range: { low: null, high: null }
      },
      swing_points: [],
      structural_events: [],
      liquidity_zones: [],
      expansion_mode: 'NORMAL',
      market_velocity: 0,
      runaway_origin_price: null,
      is_in_expansion: false,
      expansion_high_float: null,
      expansion_low_float: null,
      swings: [],
      zigzag: [],
      dealingRange: {
        high: null,
        low: null,
        equilibrium: null,
        current_status: 'AWAITING_IDM_SWEEP',
        anchor_high_swing: null,
        anchor_low_swing: null
      },
      internalDealingRange: {
        high: null,
        low: null,
        equilibrium: null,
        current_status: 'AWAITING_IDM_SWEEP',
        anchor_high_swing: null,
        anchor_low_swing: null
      },
      currentTrend: 'UNSET',
      latestMSS: null,
      market_structure_shift: false,
      market_structure_shift_direction: null
    };
  }
}
