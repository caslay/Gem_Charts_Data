/**
 * LiveOrderBlockExecutionEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 7 & 8 Multi-Timeframe (MTF) Live Automated Execution Engine & Position Manager.
 *
 * Capabilities:
 *  - Multi-Timeframe Background Stream Ingestion (5m, 15m, 1h concurrently)
 *  - Universal Active Zone Registry (activeZonesByTimeframe & allActiveZones)
 *  - Structural Role Tagging (1h Macro Anchor, 15m Structural, 5m Precision Trigger)
 *  - Higher-Timeframe (HTF) Directional Alignment Gatekeeper (vetoes counter-trend 5m entries)
 *  - Global Single-Position Concurrency Cap (maxOpenPositions: 1)
 *  - Zone Single-Use Doctrine (consumedZoneIds Set to eliminate multi-entry spam)
 *  - Mandatory Post-Trade Cooldown Timer (prevents rapid-fire stop-out loops)
 *  - Live In-Zone Volumetric Confirmation Gatekeeper (50% MT body defense, >= 1.25x Volume SMA)
 *  - Live 3-Stage Position Scaling & Profit-Locking Ratchet Router (40% TP1, 40% TP2, 20% TP3 Runner)
 *  - Active Zone Garbage Collection & Lookback Pruning per timeframe
 *  - Auto-Journaling Bridge for automated database trade persistence (/api/trades)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from '../fvgEngine';
import {
  InstitutionalOrderBlock,
  OrderBlockEngine,
  OrderBlockScanConfig,
  PositionScalingMode,
  TrailingStopMode
} from './OrderBlockEngine';

export interface LivePosition {
  id: string;
  orderBlockId: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  status: 'OPEN' | 'STAGE_1_FILLED' | 'STAGE_2_FILLED' | 'CLOSED';
  entryPrice: number;
  initialStopLoss: number;
  activeStopLoss: number;
  activeRatchetFloor: number | null;
  trailingSlSource: 'INITIAL' | 'FVG_CE' | 'SWING_PIVOT' | 'PROFIT_RATCHET_FLOOR' | 'BREAKEVEN';

  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  dynamicDolTarget: number | null;
  risk: number;

  allocatedAmount: number;     // e.g. 1.0 unit position size
  remainingAllocation: number;  // starts at 1.0 -> 0.6 -> 0.2 -> 0.0
  realizedR: number;            // cumulative realized R-multiple
  unrealizedR: number;          // current open unrealized R on active balance

  isTp1Filled: boolean;
  isTp2Filled: boolean;
  isTp3Filled: boolean;
  tp1HitTime: number | null;
  tp2HitTime: number | null;
  tp3HitTime: number | null;
  openTime: number;
  closeTime: number | null;
  exitReason: 'STOPPED_OUT' | 'STAGE_1_SCRATCH' | 'STAGE_2_WIN' | 'FULL_TP3_WIN' | null;

  orderBlock: InstitutionalOrderBlock;
}

export interface LiveExecutionConfig extends OrderBlockScanConfig {
  autoExecute: boolean;
  maxOpenPositions: number;
  fixedRiskUsd: number;
  enableSoundAlerts: boolean;
  cooldownMs: number;
  requireInZoneConfirmation: boolean;
  volumeExpansionThreshold: number;
  enforceHtfAlignment: boolean; // Enforce 15m/1h sponsorship before executing 5m trades
}

export const DEFAULT_LIVE_EXEC_CONFIG: LiveExecutionConfig = {
  symbol: 'ETHUSDC',
  timeframe: '15m',
  autoExecute: true,
  maxOpenPositions: 1,           // Strict single-position cap
  fixedRiskUsd: 100,
  enableSoundAlerts: true,
  cooldownMs: 60000,             // 60-second mandatory cooldown post trade close
  requireInZoneConfirmation: true,// Eliminate blind limit fills
  volumeExpansionThreshold: 1.25,// >= 1.25x Volume SMA requirement
  enforceHtfAlignment: true,     // Veto counter-trend 5m signals
  strictTierAPlus: false,
  minQualityTier: 'ALL',
  maxBarsToMitigation: 24,       // Lookback limit for fresh zones
  enableBreakerSimulation: true,
  maxBreakerRetestBars: 20,
  enableDynamicManagement: true,
  positionScalingMode: 'THREE_STAGE_HARVEST',
  tp1Ratio: 0.40,
  tp2Ratio: 0.40,
  tp3Ratio: 0.20,
  tp1Multiple: 1.0,
  tp2Multiple: 1.5,
  targetRewardRatio: 2.5,
  trailingStopMode: 'STRUCTURAL_FVG_TRAIL',
  trailingBuffer: 0.05,
  adaptiveBreakerConfirmation: true,
  dynamicDolTp2Scaling: true,
  requireBreakerConfirmation: true,
  requireBreakerDOL: true,
  requireBreakerVolumetric: true,
  breakerSessionFilter: 'ALL',
  aggregateConsecutiveCandles: true,
  maxConsecutiveLookback: 5,
  entryMode: 'MEAN_THRESHOLD',
};

export type TradeEventCallback = (event: {
  type: 'ORDER_OPENED' | 'STAGE_1_HARVEST' | 'STAGE_2_HARVEST' | 'STAGE_3_RUNNER' | 'POSITION_CLOSED' | 'CONFIRMATION_PENDING' | 'COOLDOWN_ACTIVE' | 'HTF_VETO';
  position?: LivePosition;
  message: string;
}) => void;

export interface InZoneTestingState {
  zoneId: string;
  timeframe: string;
  touchTime: number;
  touchPrice: number;
  status: 'AWAITING_IN_ZONE_CONFIRMATION' | 'CONFIRMED' | 'REJECTED';
}

export interface MacroMarketContext {
  macroDailyBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  dolDirection?: 'BULLISH' | 'BEARISH' | 'NONE';
  bslMagnets?: number[];
  sslMagnets?: number[];
  localDealingRange?: any;
}

export const SUPPORTED_TIMEFRAMES = ['5m', '15m', '1h'] as const;
export type SupportedTimeframe = typeof SUPPORTED_TIMEFRAMES[number];

export class LiveOrderBlockExecutionEngine {
  private config: LiveExecutionConfig;
  private orderBlockEngines: Map<string, OrderBlockEngine> = new Map();
  private closedCandlesByTimeframe: Map<string, Candle[]> = new Map();
  private lastProcessedCandleTimes: Map<string, number> = new Map();

  // Multi-Timeframe Active Zone Pool
  private activeZonesByTimeframe: Map<string, InstitutionalOrderBlock[]> = new Map();
  private allActiveZones: InstitutionalOrderBlock[] = [];

  // Live Position Manager
  private openPositions: Map<string, LivePosition> = new Map();
  private closedPositions: LivePosition[] = [];
  private eventListeners: TradeEventCallback[] = [];

  // Single-use zone doctrine and cooldown tracking
  private consumedZoneIds: Set<string> = new Set();
  private cooldownUntilTimestamp: number = 0;
  private inZoneTestingStates: Map<string, InZoneTestingState> = new Map();
  private currentMacroContext: MacroMarketContext = {};

  constructor(customConfig?: Partial<LiveExecutionConfig>) {
    this.config = { ...DEFAULT_LIVE_EXEC_CONFIG, ...customConfig };
    this.initializeTimeframeEngines();
  }

  private initializeTimeframeEngines() {
    this.orderBlockEngines.clear();
    for (const tf of SUPPORTED_TIMEFRAMES) {
      this.orderBlockEngines.set(
        tf,
        new OrderBlockEngine({
          ...this.config,
          timeframe: tf,
          // Calibrate max bars to mitigation for each timeframe
          maxBarsToMitigation: this.config.maxBarsToMitigation ?? 24
        })
      );
      if (!this.closedCandlesByTimeframe.has(tf)) {
        this.closedCandlesByTimeframe.set(tf, []);
      }
      if (!this.activeZonesByTimeframe.has(tf)) {
        this.activeZonesByTimeframe.set(tf, []);
      }
    }
  }

  public updateConfig(newConfig: Partial<LiveExecutionConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.initializeTimeframeEngines();
  }

  public subscribe(callback: TradeEventCallback): () => void {
    this.eventListeners.push(callback);
    return () => {
      this.eventListeners = this.eventListeners.filter(cb => cb !== callback);
    };
  }

  private emitEvent(
    type: 'ORDER_OPENED' | 'STAGE_1_HARVEST' | 'STAGE_2_HARVEST' | 'STAGE_3_RUNNER' | 'POSITION_CLOSED' | 'CONFIRMATION_PENDING' | 'COOLDOWN_ACTIVE' | 'HTF_VETO',
    position: LivePosition | undefined,
    message: string
  ) {
    for (const listener of this.eventListeners) {
      try {
        listener({ type, position, message });
      } catch (err) {
        console.error('[LiveExecutionEngine] Listener error:', err);
      }
    }
  }

  /**
   * Ingests multi-timeframe candle streams (5m, 15m, 1h) concurrently.
   * Runs the zero look-ahead multi-gate validation pipeline independently per timeframe.
   */
  public onMultiTimeframeCandles(
    timeframeCandles: {
      '5m'?: Candle[];
      '15m'?: Candle[];
      '1h'?: Candle[];
      [tf: string]: Candle[] | undefined;
    },
    macroContext?: MacroMarketContext
  ) {
    if (macroContext) {
      this.currentMacroContext = { ...this.currentMacroContext, ...macroContext };
    }

    let hasUpdates = false;

    for (const tf of SUPPORTED_TIMEFRAMES) {
      const candles = timeframeCandles[tf];
      if (!candles || candles.length === 0) continue;

      const lastCandle = candles[candles.length - 1];
      const lastProcessed = this.lastProcessedCandleTimes.get(tf) ?? 0;

      if (lastCandle.t <= lastProcessed && this.closedCandlesByTimeframe.get(tf)?.length === candles.length) {
        continue;
      }

      this.lastProcessedCandleTimes.set(tf, lastCandle.t);
      this.closedCandlesByTimeframe.set(tf, [...candles].sort((a, b) => a.t - b.t));

      // Get or create dedicated engine for this timeframe
      let engine = this.orderBlockEngines.get(tf);
      if (!engine) {
        engine = new OrderBlockEngine({ ...this.config, timeframe: tf as any });
        this.orderBlockEngines.set(tf, engine);
      }

      // Run Order Block detection on closed candles
      const scanResult = engine.scanHistoricalOrderBlocks(candles);

      // ── Active Zone Garbage Collection & Expiry Pruning per Timeframe ──
      const timeframeMinutes = tf === '1h' ? 60 : tf === '15m' ? 15 : 5;
      const maxLookbackMs = (this.config.maxBarsToMitigation ?? 24) * timeframeMinutes * 60 * 1000;
      const now = lastCandle.t;

      const validTfZones = scanResult.orderBlocks.filter(ob => {
        // 1. Purge consumed zones (single-use doctrine)
        if (this.consumedZoneIds.has(ob.id)) return false;

        // 2. Purge stale zones exceeding timeframe lookback window
        const ageMs = now - ob.origin_time;
        if (ageMs > maxLookbackMs && ob.lifecycle_status === 'UNTESTED') return false;

        // 3. Purge invalidated zones
        if (
          ob.lifecycle_status === 'ZONE_INVALIDATED' ||
          ob.lifecycle_status === 'MEAN_THRESHOLD_VIOLATED' ||
          ob.lifecycle_status === 'EXPIRED_STALE' ||
          ob.lifecycle_status === 'BREAKER_EXPIRED' ||
          ob.lifecycle_status === 'BREAKER_VETOED_NO_DOL' ||
          ob.lifecycle_status === 'BREAKER_VETOED_VALUATION'
        ) {
          this.consumedZoneIds.add(ob.id);
          return false;
        }

        // 4. Retain only valid resting or active breaker zones
        return (
          ob.lifecycle_status === 'UNTESTED' ||
          ob.lifecycle_status === 'ACTIVE_BREAKER' ||
          ob.lifecycle_status === 'BREAKER_CONFIRMED_ACTIVE'
        );
      });

      // ── Assign Structural Weights & Evaluate HTF Alignment ──
      const taggedZones = validTfZones.map(zone => {
        const structural_weight: InstitutionalOrderBlock['structural_weight'] =
          tf === '1h' ? '1H_MACRO_ANCHOR' :
          tf === '15m' ? '15M_STRUCTURAL' :
          '5M_PRECISION_TRIGGER';

        const alignment = this.evaluateHtfAlignment(zone, tf, this.currentMacroContext);

        return {
          ...zone,
          timeframe: tf,
          structural_weight,
          htf_alignment_status: alignment.status,
          htf_veto_reason: alignment.reason,
        };
      });

      this.activeZonesByTimeframe.set(tf, taggedZones);
      hasUpdates = true;

      // ── Evaluate In-Zone Testing Confirmations on Closed Candle ──
      this.evaluateInZoneConfirmationsForTimeframe(tf, lastCandle);
    }

    if (hasUpdates) {
      this.rebuildAllActiveZones();
    }
  }

  /**
   * Backwards-compatible single-candle ingestion.
   */
  public onCandleClosed(candle: Candle, allHistoricalCandles?: Candle[], timeframe: string = '15m') {
    this.onMultiTimeframeCandles({
      [timeframe]: allHistoricalCandles || [candle]
    });
  }

  /**
   * Evaluates Top-Down Higher-Timeframe (HTF) Alignment for a candidate zone.
   * 1h is the Macro Anchor. 15m is the Structural Anchor. 5m is the Precision Trigger.
   */
  private evaluateHtfAlignment(
    zone: InstitutionalOrderBlock,
    timeframe: string,
    macroContext: MacroMarketContext
  ): { status: 'HTF_ALIGNED' | 'VETOED_COUNTER_HTF' | 'HTF_ANCHOR'; reason: string | null } {
    // 1h zones are primary macro anchors
    if (timeframe === '1h') {
      return { status: 'HTF_ANCHOR', reason: null };
    }

    const isBullish = zone.is_breaker ? (zone.type === 'BEARISH') : (zone.type === 'BULLISH');
    const macroBias = macroContext.macroDailyBias || 'NEUTRAL';
    const dolDir = macroContext.dolDirection || 'NONE';

    // 15m zones: aligned if not strictly opposing a confirmed macro bias
    if (timeframe === '15m') {
      if (isBullish && macroBias === 'BEARISH' && dolDir === 'BEARISH') {
        // Counter-trend 15m trade against both daily bias and DOL
        return {
          status: 'VETOED_COUNTER_HTF',
          reason: '15m Bullish setup counters prevailing Bearish Macro Daily Bias and Bearish DOL.'
        };
      }
      if (!isBullish && macroBias === 'BULLISH' && dolDir === 'BULLISH') {
        return {
          status: 'VETOED_COUNTER_HTF',
          reason: '15m Bearish setup counters prevailing Bullish Macro Daily Bias and Bullish DOL.'
        };
      }
      return { status: 'HTF_ALIGNED', reason: null };
    }

    // 5m Precision Triggers: require explicit 15m/1h confluence or HTF liquidity sweep sponsorship
    if (timeframe === '5m') {
      const htf15mZones = this.activeZonesByTimeframe.get('15m') || [];
      const htf1hZones = this.activeZonesByTimeframe.get('1h') || [];

      const has15mSponsorship = htf15mZones.some(z => {
        const zBull = z.is_breaker ? (z.type === 'BEARISH') : (z.type === 'BULLISH');
        return zBull === isBullish && z.quality_tier !== 'UNVALIDATED';
      });

      const has1hSponsorship = htf1hZones.some(z => {
        const zBull = z.is_breaker ? (z.type === 'BEARISH') : (z.type === 'BULLISH');
        return zBull === isBullish;
      });

      const isMacroAligned = isBullish
        ? (macroBias === 'BULLISH' || dolDir === 'BULLISH')
        : (macroBias === 'BEARISH' || dolDir === 'BEARISH');

      const isHtfSweepSponsored = zone.gates?.gate1_liquidity_sweep && (
        zone.gates.sweep_type === 'PDH' ||
        zone.gates.sweep_type === 'PDL' ||
        zone.gates.sweep_type === 'ASIAN_HIGH' ||
        zone.gates.sweep_type === 'ASIAN_LOW' ||
        zone.gates.sweep_type === 'LONDON_HIGH' ||
        zone.gates.sweep_type === 'LONDON_LOW' ||
        zone.gates.sweep_type === 'BSL' ||
        zone.gates.sweep_type === 'SSL'
      );

      // Gate check: 5m must have at least one valid higher-timeframe confluence vector
      if (has15mSponsorship || has1hSponsorship || isMacroAligned || isHtfSweepSponsored) {
        return { status: 'HTF_ALIGNED', reason: null };
      }

      if (this.config.enforceHtfAlignment) {
        return {
          status: 'VETOED_COUNTER_HTF',
          reason: `5m ${zone.type} trigger lacks 15m/1h structural sponsorship or Macro Bias alignment.`
        };
      }
    }

    return { status: 'HTF_ALIGNED', reason: null };
  }

  /**
   * Rebuilds the unified active zone array across all timeframes.
   */
  private rebuildAllActiveZones() {
    const combined: InstitutionalOrderBlock[] = [];
    for (const tf of SUPPORTED_TIMEFRAMES) {
      const zones = this.activeZonesByTimeframe.get(tf) || [];
      combined.push(...zones);
    }

    // Sort priority:
    // 1. HTF Aligned / Anchor before Vetoed
    // 2. Higher Tier (A+ > A > B)
    // 3. Higher Timeframe (1h > 15m > 5m)
    // 4. Fresher origin timestamp
    const tierWeight = (t: string) => t === 'A_PLUS' ? 3 : t === 'A' ? 2 : 1;
    const tfWeight = (t: string) => t === '1h' ? 3 : t === '15m' ? 2 : 1;

    this.allActiveZones = combined.sort((a, b) => {
      const aVeto = a.htf_alignment_status === 'VETOED_COUNTER_HTF' ? 0 : 1;
      const bVeto = b.htf_alignment_status === 'VETOED_COUNTER_HTF' ? 0 : 1;
      if (aVeto !== bVeto) return bVeto - aVeto;

      const aTier = tierWeight(a.quality_tier);
      const bTier = tierWeight(b.quality_tier);
      if (aTier !== bTier) return bTier - aTier;

      const aTf = tfWeight(a.timeframe);
      const bTf = tfWeight(b.timeframe);
      if (aTf !== bTf) return bTf - aTf;

      return b.origin_time - a.origin_time;
    });
  }

  /**
   * Evaluates In-Zone testing confirmations for zones of a specific timeframe upon candle close.
   */
  private evaluateInZoneConfirmationsForTimeframe(timeframe: string, candle: Candle) {
    if (this.inZoneTestingStates.size === 0 || !this.config.autoExecute) return;
    if (this.openPositions.size >= this.config.maxOpenPositions) return;

    for (const [zoneId, testState] of this.inZoneTestingStates.entries()) {
      if (testState.timeframe !== timeframe) continue;

      const zone = this.allActiveZones.find(z => z.id === zoneId);
      if (!zone || this.consumedZoneIds.has(zoneId)) {
        this.inZoneTestingStates.delete(zoneId);
        continue;
      }

      // Check if zone was vetoed by HTF Gatekeeper
      if (zone.htf_alignment_status === 'VETOED_COUNTER_HTF') {
        this.emitEvent(
          'HTF_VETO',
          undefined,
          `⛔ [HTF VETO] Trade on ${zone.timeframe} ${zone.type} OB blocked: ${zone.htf_veto_reason}`
        );
        this.consumedZoneIds.add(zoneId);
        this.inZoneTestingStates.delete(zoneId);
        continue;
      }

      const isBullish = zone.is_breaker ? (zone.type === 'BEARISH') : (zone.type === 'BULLISH');

      // Check Mean Threshold Respect: Candle body must not close beyond MT
      const mtRespected = isBullish
        ? candle.c >= zone.mean_threshold
        : candle.c <= zone.mean_threshold;

      if (!mtRespected) {
        this.consumedZoneIds.add(zoneId);
        this.inZoneTestingStates.delete(zoneId);
        continue;
      }

      // Check Volumetric Rejection Expansion & Directional Taker Delta
      const volExp = this.verifyVolumetricConfirmation(timeframe, isBullish, candle);

      if (volExp) {
        testState.status = 'CONFIRMED';
        this.openLivePosition(zone, candle.c, candle.t);
        this.inZoneTestingStates.delete(zoneId);
        if (this.openPositions.size >= this.config.maxOpenPositions) break;
      }
    }
  }

  /**
   * Verifies volume expansion and directional taker delta dominance on closed rejection bar.
   */
  private verifyVolumetricConfirmation(timeframe: string, isBullish: boolean, candle: Candle): boolean {
    const candles = this.closedCandlesByTimeframe.get(timeframe);
    if (!candles || candles.length < 10) return true;

    const recentBars = candles.slice(-10);
    const avgVol = recentBars.reduce((sum, c) => sum + (c.v || 0), 0) / recentBars.length;
    const volRatio = (candle.v || 0) / Math.max(1, avgVol);
    const threshold = this.config.volumeExpansionThreshold ?? 1.25;

    const hasVolExpansion = volRatio >= threshold;
    const takerDelta = (candle.taker_buy_vol || 0) - (candle.taker_sell_vol || 0);
    const hasDeltaDominance = isBullish ? (takerDelta >= 0) : (takerDelta <= 0);

    return hasVolExpansion && hasDeltaDominance;
  }

  /**
   * Evaluates live incoming real-time price ticks across all active multi-timeframe zones.
   */
  public onPriceTick(tickPrice: number, tickTime: number = Date.now()): {
    activePositions: LivePosition[];
    activeZones: InstitutionalOrderBlock[];
  } {
    if (!tickPrice || tickPrice <= 0) {
      return {
        activePositions: Array.from(this.openPositions.values()),
        activeZones: this.allActiveZones
      };
    }

    const isCoolingDown = tickTime < this.cooldownUntilTimestamp;

    // ── 1. Evaluate Entry Triggers on Resting Multi-Timeframe Zones ──
    if (
      this.config.autoExecute &&
      this.openPositions.size < this.config.maxOpenPositions &&
      !isCoolingDown
    ) {
      for (const zone of this.allActiveZones) {
        // Enforce Single-Use Doctrine and skip VETOED zones
        if (this.consumedZoneIds.has(zone.id) || this.openPositions.has(zone.id)) continue;
        if (zone.htf_alignment_status === 'VETOED_COUNTER_HTF') continue;

        const isBullish = zone.is_breaker ? (zone.type === 'BEARISH') : (zone.type === 'BULLISH');
        const entryPrice = this.config.entryMode === 'MEAN_THRESHOLD' ? zone.mean_threshold : (isBullish ? zone.top : zone.bottom);

        let isTouched = false;
        if (zone.lifecycle_status === 'ACTIVE_BREAKER' || zone.lifecycle_status === 'BREAKER_CONFIRMED_ACTIVE') {
          const isBearishBreaker = zone.type === 'BULLISH';
          if (isBearishBreaker && tickPrice >= (zone.breaker_entry_price || zone.mean_threshold)) {
            isTouched = true;
          } else if (!isBearishBreaker && tickPrice <= (zone.breaker_entry_price || zone.mean_threshold)) {
            isTouched = true;
          }
        } else {
          if (isBullish && tickPrice <= entryPrice && tickPrice >= zone.bottom) {
            isTouched = true;
          } else if (!isBullish && tickPrice >= entryPrice && tickPrice <= zone.top) {
            isTouched = true;
          }
        }

        if (isTouched) {
          if (this.config.requireInZoneConfirmation) {
            if (!this.inZoneTestingStates.has(zone.id)) {
              this.inZoneTestingStates.set(zone.id, {
                zoneId: zone.id,
                timeframe: zone.timeframe,
                touchTime: tickTime,
                touchPrice: tickPrice,
                status: 'AWAITING_IN_ZONE_CONFIRMATION'
              });
              this.emitEvent(
                'CONFIRMATION_PENDING',
                undefined,
                `⏳ [${zone.timeframe.toUpperCase()} IN-ZONE TEST] Price entered ${zone.quality_tier} ${zone.type} zone @ $${tickPrice}. Awaiting ${zone.timeframe} rejection candle & volume confirmation...`
              );
            }
          } else {
            this.openLivePosition(zone, tickPrice, tickTime);
            if (this.openPositions.size >= this.config.maxOpenPositions) break;
          }
        }
      }
    }

    // ── 2. Manage Active Open Positions (Scaling & Trailing Stops) ──
    for (const [posId, pos] of this.openPositions.entries()) {
      this.updatePositionState(pos, tickPrice, tickTime);
      if (pos.status === 'CLOSED') {
        this.closedPositions.push(pos);
        this.openPositions.delete(posId);
        // Activate mandatory cooldown period
        this.cooldownUntilTimestamp = tickTime + (this.config.cooldownMs ?? 60000);
        this.emitEvent(
          'COOLDOWN_ACTIVE',
          pos,
          `⏱️ [COOLDOWN] Trade completed. 60-second execution cooldown active to prevent rapid-fire loops.`
        );
      }
    }

    return {
      activePositions: Array.from(this.openPositions.values()),
      activeZones: this.allActiveZones
    };
  }

  /**
   * Opens a new live position on confirmed zone trigger.
   */
  private openLivePosition(zone: InstitutionalOrderBlock, fillPrice: number, time: number) {
    if (this.openPositions.size >= this.config.maxOpenPositions) return;

    // Single-use doctrine: immediately flag zone as consumed
    this.consumedZoneIds.add(zone.id);
    zone.is_consumed = true;

    const isBullish = zone.is_breaker ? (zone.type === 'BEARISH') : (zone.type === 'BULLISH');
    const direction: 'LONG' | 'SHORT' = isBullish ? 'LONG' : 'SHORT';

    const entryPrice = fillPrice;
    let initialStopLoss = isBullish ? zone.bottom : zone.top;
    if (zone.is_breaker && zone.breaker_stop_loss) {
      initialStopLoss = zone.breaker_stop_loss;
    }

    const risk = Math.abs(entryPrice - initialStopLoss);
    if (risk <= 0) return;

    const tp1Mult = this.config.tp1Multiple ?? 1.0;
    const tp2Mult = this.config.tp2Multiple ?? 1.5;
    const targetR = this.config.targetRewardRatio ?? 2.5;

    const tp1Price = isBullish
      ? parseFloat((entryPrice + tp1Mult * risk).toFixed(4))
      : parseFloat((entryPrice - tp1Mult * risk).toFixed(4));

    const tp2Price = isBullish
      ? parseFloat((entryPrice + tp2Mult * risk).toFixed(4))
      : parseFloat((entryPrice - tp2Mult * risk).toFixed(4));

    const tp3Price = isBullish
      ? parseFloat((entryPrice + targetR * risk).toFixed(4))
      : parseFloat((entryPrice - targetR * risk).toFixed(4));

    const newPosition: LivePosition = {
      id: `live_pos_${Date.now()}_${zone.id}`,
      orderBlockId: zone.id,
      symbol: this.config.symbol || 'ETHUSDC',
      timeframe: zone.timeframe,
      direction,
      status: 'OPEN',
      entryPrice,
      initialStopLoss,
      activeStopLoss: initialStopLoss,
      activeRatchetFloor: null,
      trailingSlSource: 'INITIAL',
      tp1Price,
      tp2Price,
      tp3Price,
      dynamicDolTarget: zone.breaker_dol_target || null,
      risk,
      allocatedAmount: 1.0,
      remainingAllocation: 1.0,
      realizedR: 0,
      unrealizedR: 0,
      isTp1Filled: false,
      isTp2Filled: false,
      isTp3Filled: false,
      tp1HitTime: null,
      tp2HitTime: null,
      tp3HitTime: null,
      openTime: time,
      closeTime: null,
      exitReason: null,
      orderBlock: zone
    };

    this.openPositions.set(newPosition.id, newPosition);

    this.emitEvent(
      'ORDER_OPENED',
      newPosition,
      `🚀 [${zone.timeframe.toUpperCase()} ORDER OPENED] ${direction} @ $${entryPrice} | SL: $${initialStopLoss} | TP1: $${tp1Price} (40%) | TP2: $${tp2Price} (40%) | TP3: $${tp3Price} (20% Runner)`
    );
  }

  /**
   * Updates an open position state machine on live tick.
   */
  private updatePositionState(pos: LivePosition, currentPrice: number, time: number) {
    const isLong = pos.direction === 'LONG';
    const rawR = isLong
      ? (currentPrice - pos.entryPrice) / pos.risk
      : (pos.entryPrice - currentPrice) / pos.risk;

    pos.unrealizedR = parseFloat((rawR * pos.remainingAllocation).toFixed(2));

    const hitTP1 = isLong ? (currentPrice >= pos.tp1Price) : (currentPrice <= pos.tp1Price);
    const hitTP2 = isLong ? (currentPrice >= pos.tp2Price) : (currentPrice <= pos.tp2Price);
    const hitTP3 = isLong ? (currentPrice >= pos.tp3Price) : (currentPrice <= pos.tp3Price);
    const hitSL = isLong ? (currentPrice <= pos.activeStopLoss) : (currentPrice >= pos.activeStopLoss);

    const tp1Weight = this.config.tp1Ratio ?? 0.40;
    const tp2Weight = this.config.tp2Ratio ?? 0.40;
    const tp3Weight = this.config.tp3Ratio ?? 0.20;
    const tp1Mult = this.config.tp1Multiple ?? 1.0;
    const tp2Mult = this.config.tp2Multiple ?? 1.5;

    // ── STAGE 1 HARVEST: Scale 40% @ 1.0R & Trail SL to FVG CE ──
    if (hitTP1 && !pos.isTp1Filled) {
      pos.isTp1Filled = true;
      pos.tp1HitTime = time;
      pos.status = 'STAGE_1_FILLED';
      pos.remainingAllocation = parseFloat((pos.remainingAllocation - tp1Weight).toFixed(2));
      pos.realizedR = parseFloat((pos.realizedR + (tp1Weight * tp1Mult)).toFixed(2));

      // Structural FVG Consequent Encroachment (50% CE) Trailing Stop
      let trailingSl = pos.entryPrice;
      let slSource: LivePosition['trailingSlSource'] = 'BREAKEVEN';

      if (pos.orderBlock.gates.fvg_top && pos.orderBlock.gates.fvg_bottom) {
        const ce = (pos.orderBlock.gates.fvg_top + pos.orderBlock.gates.fvg_bottom) / 2;
        trailingSl = isLong ? Math.max(pos.entryPrice, ce) : Math.min(pos.entryPrice, ce);
        slSource = 'FVG_CE';
      }

      pos.activeStopLoss = parseFloat(trailingSl.toFixed(4));
      pos.trailingSlSource = slSource;

      this.emitEvent('STAGE_1_HARVEST', pos, `💰 [STAGE 1 HARVEST] Scaled 40% @ 1.0R (+0.4R secured). SL trailed to ${slSource} ($${pos.activeStopLoss})`);
      return;
    }

    // ── STAGE 2 HARVEST: Scale 40% @ 1.5R & Ratchet SL to +1.0R Floor ──
    if (hitTP2 && pos.isTp1Filled && !pos.isTp2Filled) {
      pos.isTp2Filled = true;
      pos.tp2HitTime = time;
      pos.status = 'STAGE_2_FILLED';
      pos.remainingAllocation = parseFloat((pos.remainingAllocation - tp2Weight).toFixed(2));
      pos.realizedR = parseFloat((pos.realizedR + (tp2Weight * tp2Mult)).toFixed(2));

      // Ratchet Stop Loss to guaranteed +1.0R structural profit floor
      const ratchetFloor = isLong
        ? parseFloat((pos.entryPrice + 1.0 * pos.risk).toFixed(4))
        : parseFloat((pos.entryPrice - 1.0 * pos.risk).toFixed(4));

      pos.activeStopLoss = ratchetFloor;
      pos.activeRatchetFloor = ratchetFloor;
      pos.trailingSlSource = 'PROFIT_RATCHET_FLOOR';

      this.emitEvent('STAGE_2_HARVEST', pos, `🔒 [STAGE 2 HARVEST] Scaled 40% @ 1.5R (+1.0R cumulative secured on 80%). SL ratcheted to +1.0R Profit Floor ($${ratchetFloor})`);
      return;
    }

    // ── STAGE 3 RUNNER: Scale 20% @ Macro DOL ──
    if (hitTP3 && pos.isTp2Filled) {
      pos.isTp3Filled = true;
      pos.tp3HitTime = time;
      pos.status = 'CLOSED';
      pos.closeTime = time;
      const runnerR = isLong ? (pos.tp3Price - pos.entryPrice) / pos.risk : (pos.entryPrice - pos.tp3Price) / pos.risk;
      pos.realizedR = parseFloat((pos.realizedR + (tp3Weight * runnerR)).toFixed(2));
      pos.remainingAllocation = 0;
      pos.exitReason = 'FULL_TP3_WIN';

      this.emitEvent('STAGE_3_RUNNER', pos, `🏆 [STAGE 3 DOL RUNNER] Macro target filled @ $${pos.tp3Price}! Full position completed (+${pos.realizedR}R Blended Return)`);
      return;
    }

    // ── STOP LOSS / TRAILING STOP EXITS ──
    if (hitSL) {
      pos.status = 'CLOSED';
      pos.closeTime = time;

      if (pos.isTp2Filled) {
        pos.realizedR = parseFloat((pos.realizedR + (pos.remainingAllocation * 1.0)).toFixed(2));
        pos.exitReason = 'STAGE_2_WIN';
        pos.remainingAllocation = 0;
        this.emitEvent('POSITION_CLOSED', pos, `✅ [STAGE 2 EXIT] Runner closed at +1.0R Ratchet Floor ($${pos.activeStopLoss}). Final Return: +${pos.realizedR}R`);
      } else if (pos.isTp1Filled) {
        const runnerR = isLong ? (pos.activeStopLoss - pos.entryPrice) / pos.risk : (pos.entryPrice - pos.activeStopLoss) / pos.risk;
        pos.realizedR = parseFloat((pos.realizedR + (pos.remainingAllocation * runnerR)).toFixed(2));
        pos.exitReason = 'STAGE_1_SCRATCH';
        pos.remainingAllocation = 0;
        this.emitEvent('POSITION_CLOSED', pos, `🛡️ [STAGE 1 SCRATCH] Position closed at Structural Trail ($${pos.activeStopLoss}). Final Return: +${pos.realizedR}R`);
      } else {
        pos.realizedR = -1.0;
        pos.exitReason = 'STOPPED_OUT';
        pos.remainingAllocation = 0;
        this.emitEvent('POSITION_CLOSED', pos, `🛑 [STOPPED OUT] Initial SL hit ($${pos.activeStopLoss}). Realized Loss: -1.0R`);
      }
    }
  }

  // ── Public Accessors & Matrix Getters ──

  public getActivePositions(): LivePosition[] {
    return Array.from(this.openPositions.values());
  }

  public getActiveZones(timeframeFilter?: 'ALL' | '5m' | '15m' | '1h'): InstitutionalOrderBlock[] {
    if (!timeframeFilter || timeframeFilter === 'ALL') {
      return this.allActiveZones;
    }
    return this.activeZonesByTimeframe.get(timeframeFilter) || [];
  }

  public getActiveZonesByTimeframe(): Record<string, InstitutionalOrderBlock[]> {
    const res: Record<string, InstitutionalOrderBlock[]> = {};
    for (const tf of SUPPORTED_TIMEFRAMES) {
      res[tf] = this.activeZonesByTimeframe.get(tf) || [];
    }
    return res;
  }

  public getClosedPositions(): LivePosition[] {
    return this.closedPositions;
  }

  public getConfig(): LiveExecutionConfig {
    return this.config;
  }

  public getCooldownRemainingSec(): number {
    const diffMs = this.cooldownUntilTimestamp - Date.now();
    return Math.max(0, Math.ceil(diffMs / 1000));
  }

  public getInZoneTestingStates(): InZoneTestingState[] {
    return Array.from(this.inZoneTestingStates.values());
  }
}
