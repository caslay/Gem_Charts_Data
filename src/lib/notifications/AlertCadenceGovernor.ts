/**
 * AlertCadenceGovernor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Alert Cadence & Spatial Hysteresis Governor
 * ─────────────────────────────────────────────────────────────────────────────
 * Prevents alert thrashing, spam, and operator fatigue by enforcing:
 * 1. Temporal Cooldown: Minimum 15-minute spacing between new signal/intent
 *    broadcast cards for the same symbol and direction.
 * 2. Spatial Hysteresis: Suppresses redundant intent broadcasts when market price
 *    oscillates within an active setup's POI zone (±0.05% proximity tolerance).
 * 3. Leaky Bucket Outbound Queue: Guarantees Telegram Bot API rate limit
 *    compliance (max 1 message per 2,000ms).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface PoiZone {
  low: number;
  high: number;
  expiryMs: number;
}

export interface AlertGovernorConfig {
  temporalCooldownMs: number; // default: 900,000ms (15 minutes)
  spatialTolerancePct: number; // default: 0.0005 (0.05%)
  leakyBucketIntervalMs: number; // default: 2,000ms
  poiZoneTtlMs: number; // default: 1,800,000ms (30 minutes)
}

export const DEFAULT_GOVERNOR_CONFIG: AlertGovernorConfig = {
  temporalCooldownMs: 15 * 60 * 1000, // 15 mins
  spatialTolerancePct: 0.0005, // 0.05%
  leakyBucketIntervalMs: 2000, // 1 msg / 2s
  poiZoneTtlMs: 30 * 60 * 1000, // 30 mins
};

export class AlertCadenceGovernor {
  private config: AlertGovernorConfig;
  private lastAlertTimestamp: Map<string, number> = new Map(); // Key: `${symbol}_${direction}`
  private activePoiZones: Map<string, PoiZone[]> = new Map(); // Key: `${symbol}_${direction}`

  // Leaky Bucket State
  private outboundQueue: Array<{
    task: () => Promise<boolean>;
    resolve: (val: boolean) => void;
    reject: (err: any) => void;
  }> = [];
  private isDrainingQueue: boolean = false;
  private lastDrainTimestamp: number = 0;

  constructor(config?: Partial<AlertGovernorConfig>) {
    this.config = { ...DEFAULT_GOVERNOR_CONFIG, ...config };
  }

  /**
   * Resets all in-memory cooldowns and active POI zones (primarily for testing).
   */
  public reset(): void {
    this.lastAlertTimestamp.clear();
    this.activePoiZones.clear();
    this.outboundQueue = [];
    this.isDrainingQueue = false;
    this.lastDrainTimestamp = 0;
  }

  /**
   * Checks whether a temporal cooldown is active for a given symbol and direction.
   */
  public isTemporalCooldownActive(
    symbol: string,
    direction: string,
    nowMs: number = Date.now()
  ): boolean {
    const key = `${symbol.toUpperCase()}_${direction.toUpperCase()}`;
    const lastAlert = this.lastAlertTimestamp.get(key);
    if (!lastAlert) return false;
    return nowMs - lastAlert < this.config.temporalCooldownMs;
  }

  /**
   * Records that an alert was dispatched for a given symbol and direction.
   */
  public registerAlertDispatched(
    symbol: string,
    direction: string,
    nowMs: number = Date.now()
  ): void {
    const key = `${symbol.toUpperCase()}_${direction.toUpperCase()}`;
    this.lastAlertTimestamp.set(key, nowMs);
  }

  /**
   * Registers an active POI zone to enforce spatial hysteresis.
   */
  public registerActivePoiZone(
    symbol: string,
    direction: string,
    low: number,
    high: number,
    nowMs: number = Date.now(),
    ttlMs?: number
  ): void {
    const key = `${symbol.toUpperCase()}_${direction.toUpperCase()}`;
    const expiryMs = nowMs + (ttlMs ?? this.config.poiZoneTtlMs);
    const zones = this.activePoiZones.get(key) || [];
    
    // Purge expired zones
    const fresh = zones.filter((z) => z.expiryMs > nowMs);
    fresh.push({
      low: Math.min(low, high),
      high: Math.max(low, high),
      expiryMs,
    });
    this.activePoiZones.set(key, fresh);
  }

  /**
   * Checks whether price is hovering inside an existing active POI zone (±0.05% tolerance).
   */
  public isSpatialHysteresisActive(
    symbol: string,
    direction: string,
    currentPrice: number,
    nowMs: number = Date.now()
  ): boolean {
    if (!currentPrice || currentPrice <= 0) return false;
    const key = `${symbol.toUpperCase()}_${direction.toUpperCase()}`;
    const zones = this.activePoiZones.get(key);
    if (!zones || zones.length === 0) return false;

    // Purge expired
    const active = zones.filter((z) => z.expiryMs > nowMs);
    this.activePoiZones.set(key, active);

    for (const zone of active) {
      const mid = (zone.low + zone.high) / 2;
      const epsilon = mid * this.config.spatialTolerancePct;
      const effectiveLow = zone.low - epsilon;
      const effectiveHigh = zone.high + epsilon;

      if (currentPrice >= effectiveLow && currentPrice <= effectiveHigh) {
        return true;
      }
    }

    return false;
  }

  /**
   * Evaluates whether an outbound milestone card is authorized to broadcast.
   * NOTE: Lifecycle progression events (FILLED, RATCHET, CLOSED) bypass signal cooldowns.
   * Only entry/intent cards (SIGNAL_RECEIVED, ARMED_INTENT_REGISTERED) are gated.
   */
  public isAllowed(
    milestone: string,
    payload: any,
    nowMs: number = Date.now()
  ): { allowed: boolean; reason?: string } {
    const isEntryIntent =
      milestone === 'SIGNAL_RECEIVED' ||
      milestone === 'ARMED_INTENT_REGISTERED';

    if (!isEntryIntent) {
      return { allowed: true };
    }

    const symbol = payload.symbol || 'ETHUSDC';
    const rawDir = payload.direction || (payload.isLong ? 'LONG' : 'SHORT');
    const direction = String(rawDir).toUpperCase().includes('LONG') || String(rawDir).toUpperCase().includes('BULL') ? 'LONG' : 'SHORT';

    // 1. Temporal Cooldown Check
    if (this.isTemporalCooldownActive(symbol, direction, nowMs)) {
      const last = this.lastAlertTimestamp.get(`${symbol.toUpperCase()}_${direction}`) || 0;
      const remainingSecs = Math.ceil((this.config.temporalCooldownMs - (nowMs - last)) / 1000);
      return {
        allowed: false,
        reason: `[CADENCE_GOVERNOR] Temporal cooldown active for ${symbol} ${direction} (${remainingSecs}s remaining)`,
      };
    }

    // 2. Spatial Hysteresis Check
    const refPrice = payload.limitEntryPrice ?? payload.entryPrice ?? payload.triggerPrice ?? ((payload.poiZoneLow && payload.poiZoneHigh) ? (payload.poiZoneLow + payload.poiZoneHigh) / 2 : null);
    if (typeof refPrice === 'number' && refPrice > 0) {
      if (this.isSpatialHysteresisActive(symbol, direction, refPrice, nowMs)) {
        return {
          allowed: false,
          reason: `[CADENCE_GOVERNOR] Spatial hysteresis active: price $${refPrice.toFixed(2)} resides inside active POI band for ${symbol} ${direction}`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Enqueues an outbound message through the leaky bucket rate limiter (max 1 msg per 2,000ms).
   */
  public async enqueueMessage(task: () => Promise<boolean>): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      this.outboundQueue.push({ task, resolve, reject });
      this.triggerDrain();
    });
  }

  private triggerDrain(): void {
    if (this.isDrainingQueue) return;
    this.isDrainingQueue = true;

    const drainNext = async () => {
      if (this.outboundQueue.length === 0) {
        this.isDrainingQueue = false;
        return;
      }

      const now = Date.now();
      const timeSinceLast = now - this.lastDrainTimestamp;
      const waitTime = Math.max(0, this.config.leakyBucketIntervalMs - timeSinceLast);

      if (waitTime > 0) {
        setTimeout(drainNext, waitTime);
        return;
      }

      const item = this.outboundQueue.shift();
      if (!item) {
        this.isDrainingQueue = false;
        return;
      }

      this.lastDrainTimestamp = Date.now();

      try {
        const result = await item.task();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }

      if (this.outboundQueue.length > 0) {
        setTimeout(drainNext, this.config.leakyBucketIntervalMs);
      } else {
        this.isDrainingQueue = false;
      }
    };

    drainNext().catch(() => {
      this.isDrainingQueue = false;
    });
  }
}

// Global Singleton instance
export const globalAlertCadenceGovernor = new AlertCadenceGovernor();
