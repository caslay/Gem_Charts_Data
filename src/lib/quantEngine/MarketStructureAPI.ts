import { Candle } from '../fvgEngine';
import { PivotEngine } from './PivotEngine';
import { SMCStateEngine } from './SMCStateEngine';
import { LiquidityEngine } from './LiquidityEngine';
import { 
  MarketStructureAnalysis, MarketStructureConfig, 
  StructuralSwing, ZigZagSegment, StructuralDealingRange, Pivot 
} from './types';
import { InstitutionalSponsorship } from '../displacementEngine';

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
    const stateEngine = new SMCStateEngine(this.config);
    for (let i = 0; i < normalizedCandles.length; i++) {
      const c = normalizedCandles[i];
      // Feed pivots that occur at this candle
      const currentPivots = pivotEngine.pivots.filter(p => p.index === i);
      for (const p of currentPivots) {
        stateEngine.processPivot(p, normalizedCandles);
      }
      // Compute pseudo-atr for sharp departures
      const atr = c.high - c.low; // Simple fallback
      stateEngine.processCandle(c, normalizedCandles, i, atr);
    }

    // 3. Liquidity Engine (FVG & OB)
    const liquidityEngine = new LiquidityEngine();
    liquidityEngine.processCandlesForLiquidity(normalizedCandles);

    // 4. Map to Downstream Data Contract

    // Map MAJOR Swings (Level 2)
    const majorPivots = pivotEngine.pivots.filter(p => p.level === 2);
    const swings: StructuralSwing[] = majorPivots.map(pt => ({
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

    // Map INNER Swings (Level 1)
    const innerPivots = pivotEngine.pivots.filter(p => p.level === 1);
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

    // Build ZigZag Arrays
    const zigzag = this.buildZigZag(swings, stateEngine);
    const innerZigzag = this.buildZigZag(innerSwingsRaw, stateEngine, true);

    const latestMSS = zigzag.filter(z => z.label === 'MSS').slice(-1)[0] ?? null;
    const hasConfirmedMSS = latestMSS !== null && latestMSS.displacementConfirmed;

    // Macro Dealing Range
    let dealingRange = this.buildDealingRange(swings, currentPrice);

    // Inner Dealing Range
    let internalDealingRange = this.buildDealingRange(innerSwingsRaw, currentPrice);

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
      internalTrend: 'UNSET',
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

      // Avoid connecting HIGH to HIGH
      if (from.type === to.type) continue;

      const ev = stateEngine.registered_events.find(e => e.index === to.candle_index && (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH'));
      let label: 'BOS' | 'MSS' | 'INTERNAL' = 'INTERNAL';
      let trendAfter: 'BULLISH' | 'BEARISH' | 'UNSET' = currentTrend;

      if (ev) {
        label = ev.type === 'BOS' ? 'BOS' : 'MSS';
        trendAfter = ev.direction || 'UNSET';
      }

      zigzag.push({
        from,
        to,
        label,
        trendBefore: currentTrend,
        trendAfter,
        displacementConfirmed: label === 'MSS' && !ev?.sharp_departure_failed
      });

      currentTrend = trendAfter;
    }
    return zigzag;
  }

  private buildDealingRange(swings: StructuralSwing[], currentPrice: number): StructuralDealingRange {
    const highs = swings.filter(s => s.type === 'HIGH');
    const lows = swings.filter(s => s.type === 'LOW');
    
    if (highs.length > 0 && lows.length > 0) {
      const lastHigh = highs[highs.length - 1];
      const lastLow = lows[lows.length - 1];
      const highVal = parseFloat((lastHigh.price as number).toFixed(2));
      const lowVal = parseFloat((lastLow.price as number).toFixed(2));
      const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));
      
      return {
        high: highVal,
        low: lowVal,
        equilibrium: eqVal,
        current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
        anchor_high_swing: lastHigh,
        anchor_low_swing: lastLow
      };
    }

    return {
      high: "AWAITING_IDM_SWEEP",
      low: "AWAITING_IDM_SWEEP",
      equilibrium: "AWAITING_IDM_SWEEP",
      current_status: 'AWAITING_IDM_SWEEP',
      anchor_high_swing: null,
      anchor_low_swing: null
    };
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
        high: "AWAITING_IDM_SWEEP",
        low: "AWAITING_IDM_SWEEP",
        equilibrium: "AWAITING_IDM_SWEEP",
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
