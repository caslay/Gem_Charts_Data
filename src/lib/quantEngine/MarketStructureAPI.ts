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
    pivotEngine.processCandles(normalizedCandles);

    // 2. State Engine (SMC Rules)
    const stateEngine = new SMCStateEngine(this.config, 2);
    const innerStateEngine = new SMCStateEngine(this.config, 1);
    for (let i = 0; i < normalizedCandles.length; i++) {
      const c = normalizedCandles[i];
      // Feed pivots that occur at this candle
      const currentPivots = pivotEngine.pivots.filter(p => p.index === i);
      for (const p of currentPivots) {
        stateEngine.processPivot(p, normalizedCandles);
        innerStateEngine.processPivot(p, normalizedCandles);
      }
      // Compute pseudo-atr for sharp departures
      const atr = c.high - c.low; // Simple fallback
      stateEngine.processCandle(c, normalizedCandles, i, atr);
      innerStateEngine.processCandle(c, normalizedCandles, i, atr);
    }

    // 3. Liquidity Engine (FVG & OB)
    const liquidityEngine = new LiquidityEngine();
    liquidityEngine.processCandlesForLiquidity(normalizedCandles);

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

    // Pass all swings to the UI layer
    const swings = [...majorSwings, ...internalSwings, ...innerSwingsRaw];

    // Build ZigZag Arrays
    const zigzag = this.buildZigZag(majorSwings, stateEngine);
    const internalZigzag = this.buildZigZag(internalSwings, innerStateEngine, true);
    const innerZigzag = this.buildZigZag(innerSwingsRaw, innerStateEngine, true);

    const latestMSS = zigzag.filter(z => z.label === 'MSS').slice(-1)[0] ?? null;
    const hasConfirmedMSS = latestMSS !== null && latestMSS.displacementConfirmed;

    // Macro Dealing Range
    const dealingRange = this.buildDealingRange(majorSwings, currentPrice, stateEngine, normalizedCandles);

    // Inner Dealing Range
    const internalDealingRange = this.buildDealingRange(internalSwings, currentPrice, innerStateEngine, normalizedCandles);

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
      expansion_mode: 'NORMAL',
      market_velocity: 0,
      runaway_origin_price: null,

      swings,
      zigzag,
      dealingRange,
      currentTrend: stateEngine.current_trend_state === 'BULLISH_SWING' ? 'BULLISH' : 'BEARISH',
      latestMSS,
      market_structure_shift: hasConfirmedMSS,
      market_structure_shift_direction: hasConfirmedMSS ? latestMSS!.trendAfter : null,

      subTrend: 'UNSET',
      innerSwings: innerSwingsRaw,
      innerZigzag,
      internalTrend: innerStateEngine.current_trend_state === 'BULLISH_SWING' ? 'BULLISH' : 'BEARISH',
      internalZigzag: innerZigzag,
      latestInternalMSS: innerZigzag.filter(s => s.label === 'MSS').slice(-1)[0] ?? null,
      internal_market_structure_shift: innerZigzag.some(s => s.label === 'MSS' && s.displacementConfirmed),
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
      highPrice = stateEngine.active_swing_high ?? Math.max(currentPrice, ...swings.filter(s => s.type === 'HIGH').map(s => Number(s.price)));
      lowPrice = stateEngine.protected_low ?? Math.min(...swings.filter(s => s.type === 'LOW').map(s => Number(s.price)));
      
      // If we are discovering a new high, find the absolute highest high since the protected low
      if (stateEngine.active_swing_high === null) {
          const anchorSwing = [...swings].reverse().find(s => s.type === 'LOW' && s.price === lowPrice);
          const anchorIdx = anchorSwing?.candle_index ?? 0;
          const candlesSinceAnchor = normalizedCandles.slice(anchorIdx);
          highPrice = candlesSinceAnchor.length > 0 ? Math.max(...candlesSinceAnchor.map(c => c.high)) : currentPrice;
      }
    } else {
      highPrice = stateEngine.protected_high ?? Math.max(...swings.filter(s => s.type === 'HIGH').map(s => Number(s.price)));
      lowPrice = stateEngine.active_swing_low ?? currentPrice;

      // If we are discovering a new low, find the absolute lowest low since the protected high
      if (stateEngine.active_swing_low === null) {
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

    // Find the latest swings that match these anchor prices
    let anchor_high_swing = [...swings].reverse().find(s => s.type === 'HIGH' && s.price === highPrice) || null;
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
        anchor_high_swing = {
          t: c.t,
          price: c.high,
          type: 'HIGH',
          grade: swings[0]?.grade || 'MAJOR',
          colorValidated: true,
          candle_index: closestIdx,
          timestamp: new Date(c.t).toISOString(),
          structure_type: swings[0]?.structure_type || 'MAJOR',
          confirmed: true
        };
      }
    }

    let anchor_low_swing = [...swings].reverse().find(s => s.type === 'LOW' && s.price === lowPrice) || null;
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
        anchor_low_swing = {
          t: c.t,
          price: c.low,
          type: 'LOW',
          grade: swings[0]?.grade || 'MAJOR',
          colorValidated: true,
          candle_index: closestIdx,
          timestamp: new Date(c.t).toISOString(),
          structure_type: swings[0]?.structure_type || 'MAJOR',
          confirmed: true
        };
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

    dr.profile_metrics = calculateVolumeProfile(dr, normalizedCandles);
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
