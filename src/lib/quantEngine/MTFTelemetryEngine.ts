import { Candle } from '../fvgEngine';
import { verifyDisplacementOffline, InstitutionalSponsorship } from '../displacementEngine';
import { analyzeMarketStructure, MarketStructureAnalysis } from '../structureEngine';
import type { OrderFlowState } from '@/lib/quantEngine/types';
import { OrderBlockEngine } from './OrderBlockEngine';
import { detectActiveFVGs } from '../fvgEngine';

export interface TimeframeTelemetry {
  timeframe: '1m' | '5m' | '15m' | '1h';
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  structure_break: 'BOS' | 'MSS' | 'NONE';
  displacement: 'ACTIVE_BULLISH' | 'ACTIVE_BEARISH' | 'INACTIVE' | 'CONSOLIDATION';
  ols_tier: 'CONFIRMED_95' | 'MODERATE_90' | 'BORDERLINE_85' | 'REJECTED' | 'CONSOLIDATION';
  ols_tier_label: string;
  t_statistic: number;
  p_value: number;
  order_flow_regime: OrderFlowState;
  order_flow_label: string;
  active_ob_count: number;
  unmitigated_fvg_count: number;
  dol_target: { price: number; type: 'BSL' | 'SSL'; distance_pips: number } | null;
  last_close_price: number;
  timestamp: number;
}

export interface MTFTelemetrySummary {
  timeframes: Record<string, TimeframeTelemetry>;
  htf_directional_bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  htf_alignment: boolean;
  top_down_confluence_pct: number;
  active_macro_dol: { price: number; type: 'BSL' | 'SSL'; timeframe: string; distance_pips: number } | null;
  evaluated_at: number;
}

export class MTFTelemetryEngine {
  private symbol: string;
  private lastCompositeFingerprint: string = '';
  private cachedSummary: MTFTelemetrySummary | null = null;
  private tfFingerprints: Map<string, string> = new Map();
  private tfCache: Map<string, TimeframeTelemetry> = new Map();

  constructor(symbol: string = 'ETHUSDC') {
    this.symbol = symbol;
  }

  /**
   * Evaluates telemetry for a single timeframe candle series with fingerprint caching
   */
  public evaluateTimeframe(
    candles: Candle[],
    timeframe: '1m' | '5m' | '15m' | '1h',
    currentPrice?: number
  ): TimeframeTelemetry {
    if (!candles || candles.length < 16) {
      return this.getDefaultTimeframeTelemetry(timeframe, currentPrice ?? 0);
    }

    const lastCandle = candles[candles.length - 1];
    const livePrice = currentPrice ?? lastCandle.c;
    const tfKey = `${timeframe}_${lastCandle.t}_${candles.length}`;

    // Return cached timeframe telemetry if closed-candle fingerprint has not changed
    if (this.tfCache.has(timeframe) && this.tfFingerprints.get(timeframe) === tfKey) {
      return this.tfCache.get(timeframe)!;
    }

    // 1. Displacement & 3-Bar Forward OLS Validation
    const sponsorship = verifyDisplacementOffline(candles, this.symbol);
    const statVal = sponsorship.statistical_validation;

    // 2. Market Structure & Swings (Pivot Engine)
    let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let structureBreak: 'BOS' | 'MSS' | 'NONE' = 'NONE';
    try {
      const structure = analyzeMarketStructure(candles, livePrice, sponsorship);
      if (structure?.dealingRange?.current_status) {
        trend = structure.dealingRange.current_status === 'PREMIUM' ? 'BEARISH' : 'BULLISH';
      }
      if (structure?.latestMSS) {
        structureBreak = 'MSS';
      } else if (structure?.zigzag && structure.zigzag.length > 0) {
        const lastSeg = structure.zigzag[structure.zigzag.length - 1];
        if (lastSeg.label === 'BOS') structureBreak = 'BOS';
        else if (lastSeg.label === 'MSS') structureBreak = 'MSS';
      }
    } catch {
      trend = lastCandle.c >= candles[0].c ? 'BULLISH' : 'BEARISH';
    }

    // 3. Order Flow State Machine
    let ofRegime: OrderFlowState = 'NEUTRAL';
    if (candles.length >= 2) {
      const prev = candles[candles.length - 2];
      const priceUp = lastCandle.c >= prev.c;
      const netDelta = (lastCandle.taker_buy_vol || 0) - (lastCandle.taker_sell_vol || 0);

      if (priceUp && netDelta > 0) ofRegime = 'RISING_WITH_PRICE';
      else if (!priceUp && netDelta < 0) ofRegime = 'RISING_AGAINST_PRICE';
      else if (priceUp && netDelta < 0) ofRegime = 'FALLING_AGAINST_PRICE';
      else if (!priceUp && netDelta > 0) ofRegime = 'FALLING_WITH_PRICE';
      else ofRegime = 'FLAT';
    }

    // 4. Active Order Blocks (4-Gate Detection)
    let obCount = 0;
    try {
      const obEngine = new OrderBlockEngine({
        symbol: this.symbol,
        timeframe,
        minQualityTier: 'ALL',
        strictTierAPlus: false,
        enableBreakerSimulation: true,
      });
      const obScan = obEngine.scanHistoricalOrderBlocks(candles);
      obCount = (obScan?.orderBlocks || []).filter(ob => ob.lifecycle_status === 'UNTESTED' || ob.lifecycle_status === 'ACTIVE_BREAKER').length;
    } catch {
      obCount = 0;
    }

    // 5. Unmitigated FVGs
    let fvgCount = 0;
    try {
      const activeFvgs = detectActiveFVGs(candles, true);
      fvgCount = activeFvgs.length;
    } catch {
      fvgCount = 0;
    }

    // 6. Draw on Liquidity (DOL) Nearest Magnet Target
    let dolTarget: { price: number; type: 'BSL' | 'SSL'; distance_pips: number } | null = null;
    const highs = candles.slice(-50).map(c => c.h);
    const lows = candles.slice(-50).map(c => c.l);
    const recentHigh = Math.max(...highs);
    const recentLow = Math.min(...lows);

    if (trend === 'BULLISH' && recentHigh > livePrice) {
      dolTarget = {
        price: parseFloat(recentHigh.toFixed(2)),
        type: 'BSL',
        distance_pips: parseFloat((recentHigh - livePrice).toFixed(2)),
      };
    } else if (trend === 'BEARISH' && recentLow < livePrice) {
      dolTarget = {
        price: parseFloat(recentLow.toFixed(2)),
        type: 'SSL',
        distance_pips: parseFloat((livePrice - recentLow).toFixed(2)),
      };
    }

    const result: TimeframeTelemetry = {
      timeframe,
      trend,
      structure_break: structureBreak,
      displacement: sponsorship.status,
      ols_tier: statVal.confidence_tier || 'REJECTED',
      ols_tier_label: statVal.confidence_tier_label || 'REJECTED',
      t_statistic: statVal.t_statistic || 0,
      p_value: statVal.p_value ?? 1,
      order_flow_regime: ofRegime,
      order_flow_label: this.formatOrderFlowLabel(ofRegime),
      active_ob_count: obCount,
      unmitigated_fvg_count: fvgCount,
      dol_target: dolTarget,
      last_close_price: lastCandle.c,
      timestamp: lastCandle.t,
    };

    this.tfCache.set(timeframe, result);
    this.tfFingerprints.set(timeframe, tfKey);
    return result;
  }

  /**
   * Concurrently evaluates all standard MTF streams and generates a top-down summary
   */
  public evaluateAll(
    payload: {
      candles_1m?: Candle[];
      candles_5m?: Candle[];
      candles_15m?: Candle[];
      candles_1h?: Candle[];
    },
    livePrice?: number
  ): MTFTelemetrySummary {
    const c1m = payload.candles_1m || [];
    const c5m = payload.candles_5m || [];
    const c15m = payload.candles_15m || [];
    const c1h = payload.candles_1h || [];

    const compositeFingerprint = `${c1m[c1m.length - 1]?.t || 0}_${c5m[c5m.length - 1]?.t || 0}_${c15m[c15m.length - 1]?.t || 0}_${c1h[c1h.length - 1]?.t || 0}_${c1m.length}_${c5m.length}_${c15m.length}_${c1h.length}`;

    // 0ms early return bailout if composite closed candle boundary is unchanged
    if (this.cachedSummary && this.lastCompositeFingerprint === compositeFingerprint) {
      return this.cachedSummary;
    }

    const timeframes: Record<string, TimeframeTelemetry> = {
      '1m': this.evaluateTimeframe(c1m, '1m', livePrice),
      '5m': this.evaluateTimeframe(c5m, '5m', livePrice),
      '15m': this.evaluateTimeframe(c15m, '15m', livePrice),
      '1h': this.evaluateTimeframe(c1h, '1h', livePrice),
    };

    // Calculate Higher Timeframe (15m + 1h) Directional Bias
    const tf15 = timeframes['15m'];
    const tf1h = timeframes['1h'];
    const tf5 = timeframes['5m'];

    let htfBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (tf1h.trend === tf15.trend && tf1h.trend !== 'NEUTRAL') {
      htfBias = tf1h.trend;
    } else if (tf1h.trend !== 'NEUTRAL') {
      htfBias = tf1h.trend;
    } else {
      htfBias = tf15.trend;
    }

    // Top-down alignment score
    let alignmentPoints = 0;
    if (tf5.trend === htfBias && htfBias !== 'NEUTRAL') alignmentPoints += 40;
    if (tf15.trend === tf1h.trend && tf1h.trend !== 'NEUTRAL') alignmentPoints += 30;
    if (tf5.order_flow_regime.includes('RISING') && (htfBias === 'BULLISH' || htfBias === 'BEARISH')) alignmentPoints += 15;
    if (tf15.ols_tier === 'CONFIRMED_95' || tf15.ols_tier === 'MODERATE_90') alignmentPoints += 15;

    const topDownConfluencePct = Math.min(100, alignmentPoints);
    const htfAlignment = tf5.trend === htfBias && htfBias !== 'NEUTRAL';

    const activeMacroDol = tf1h.dol_target 
      ? { ...tf1h.dol_target, timeframe: '1h' } 
      : tf15.dol_target 
      ? { ...tf15.dol_target, timeframe: '15m' } 
      : null;

    const summary: MTFTelemetrySummary = {
      timeframes,
      htf_directional_bias: htfBias,
      htf_alignment: htfAlignment,
      top_down_confluence_pct: topDownConfluencePct,
      active_macro_dol: activeMacroDol,
      evaluated_at: Date.now(),
    };

    this.cachedSummary = summary;
    this.lastCompositeFingerprint = compositeFingerprint;
    return summary;
  }

  private formatOrderFlowLabel(regime: OrderFlowState): string {
    switch (regime) {
      case 'RISING_WITH_PRICE': return 'AGGRESSIVE BUYING';
      case 'RISING_AGAINST_PRICE': return 'AGGRESSIVE SHORTING';
      case 'FALLING_WITH_PRICE': return 'LONG LIQUIDATION';
      case 'FALLING_AGAINST_PRICE': return 'SHORT COVERING';
      case 'FLAT': return 'EQUILIBRIUM';
      default: return 'NEUTRAL';
    }
  }

  private getDefaultTimeframeTelemetry(
    timeframe: '1m' | '5m' | '15m' | '1h',
    price: number
  ): TimeframeTelemetry {
    return {
      timeframe,
      trend: 'NEUTRAL',
      structure_break: 'NONE',
      displacement: 'INACTIVE',
      ols_tier: 'REJECTED',
      ols_tier_label: 'REJECTED',
      t_statistic: 0,
      p_value: 1,
      order_flow_regime: 'NEUTRAL',
      order_flow_label: 'NEUTRAL',
      active_ob_count: 0,
      unmitigated_fvg_count: 0,
      dol_target: null,
      last_close_price: price,
      timestamp: Date.now(),
    };
  }
}
