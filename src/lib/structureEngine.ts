/**
 * structureEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized Algorithmic Market Structure Engine Wrapper.
 * 
 * V12.0.0 Refactor: This file now acts as a backward-compatible wrapper 
 * around the new Multi-Scale Directional Change Quant Engine.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from './fvgEngine';
import { InstitutionalSponsorship } from './displacementEngine';
import { MarketStructureAPI } from './quantEngine/MarketStructureAPI';
import { MarketStructureAnalysis } from './quantEngine/types';

// Re-export all interfaces from the new quant engine to maintain API parity
export * from './quantEngine/types';

export function analyzeMarketStructure(
  candles: Candle[],
  currentPrice: number,
  displacementStatus?: InstitutionalSponsorship | null,
  contextAnchorTimestamp?: number | null,
  globalAnchors?: any | null,
  config?: any
): MarketStructureAnalysis {
  const engine = new MarketStructureAPI(config);
  return engine.analyze(candles, currentPrice, displacementStatus);
}

// Stateful Caching Layer for real-time memory synchronization
const accumulatedCandlesCache = new Map<string, Candle[]>();
const contextAnchorCache = new Map<string, number>();
const globalAnchorsCache = new Map<string, any>();

export function analyzeMarketStructureStateful(
  symbol: string,
  interval: string,
  newCandles: Candle[],
  currentPrice: number,
  displacementStatus: InstitutionalSponsorship | null | undefined,
  isInit: boolean = false,
  globalAnchors?: any | null,
  config?: any
): MarketStructureAnalysis {
  const cacheKey = `${symbol}_${interval}`;
  
  if (isInit) {
    accumulatedCandlesCache.delete(cacheKey);
    contextAnchorCache.delete(cacheKey);
    globalAnchorsCache.delete(cacheKey);
  }

  let accumulated = accumulatedCandlesCache.get(cacheKey) || [];
  if (isInit || accumulated.length === 0) {
    accumulated = [...newCandles].sort((a, b) => a.t - b.t);
  } else {
    const existingIds = new Set(accumulated.map(c => c.t));
    const uniqueNew = newCandles.filter(c => !existingIds.has(c.t));
    accumulated = [...accumulated, ...uniqueNew].sort((a, b) => a.t - b.t);
  }

  // 10,000 candles ceiling to optimize visual canvas performance
  if (accumulated.length > 10000) {
    accumulated = accumulated.slice(-10000);
  }
  accumulatedCandlesCache.set(cacheKey, accumulated);

  let anchor = contextAnchorCache.get(cacheKey) || null;
  if (anchor === null && accumulated.length > 0) {
    anchor = accumulated[0].t;
    contextAnchorCache.set(cacheKey, anchor);
  }

  return analyzeMarketStructure(accumulated, currentPrice, displacementStatus || null, anchor, globalAnchors, config);
}
