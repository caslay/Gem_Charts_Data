import React from 'react';
import type { ChartLayer } from '../types';
import { OrderBlockEngine, InstitutionalOrderBlock } from '@/lib/quantEngine/OrderBlockEngine';

function findClosestCandleSec(candles: Array<{ t: number }>, targetMs: number): number {
  if (!candles || candles.length === 0) return Math.floor(targetMs / 1000);
  let closestSec = Math.floor(candles[0].t / 1000);
  let minDiff = Math.abs(candles[0].t - targetMs);

  for (let i = 1; i < candles.length; i++) {
    const diff = Math.abs(candles[i].t - targetMs);
    if (diff < minDiff) {
      minDiff = diff;
      closestSec = Math.floor(candles[i].t / 1000);
    }
  }
  return closestSec;
}

export const orderBlockLayer: ChartLayer = {
  id: 'order_blocks',
  name: 'Order Blocks',
  shortName: 'OB',
  description: 'Validated Tier A/A+ Order Blocks, MT Midlines & Breakers',
  icon: 'Layers',
  renderHtml(context) {
    const { chart, series, data, activeCandles, theme, themeSettings, storage } = context;

    if (!activeCandles || activeCandles.length < 5) return null;

    // 1. Resolve Order Blocks: either from pre-enriched data payload or dynamically from OrderBlockEngine
    const ipda = data?.ipda_metrics || {};
    let liveZones: InstitutionalOrderBlock[] =
      (data as any)?.active_order_blocks ||
      (ipda as any)?.order_blocks ||
      [];

    if (!liveZones || liveZones.length === 0) {
      // Run optimized client-side scan cached by last closed candle timestamp
      const lastCandle = activeCandles[activeCandles.length - 1];
      const cacheKey = `ob_scan_v2_${lastCandle.t}_${activeCandles.length}`;
      let scanResult = storage.get(cacheKey);

      if (!scanResult) {
        const engine = new OrderBlockEngine({
          symbol: data?.ticker || 'ETHUSDC',
          timeframe: '15m',
          minQualityTier: 'ALL',
          strictTierAPlus: false,
          enableBreakerSimulation: true,
          maxBarsToMitigation: 24,       // Strict 24-bar freshness window
          maxBreakerRetestBars: 20,
          aggregateConsecutiveCandles: true,
        });
        scanResult = engine.scanHistoricalOrderBlocks(activeCandles);
        storage.set(cacheKey, scanResult);
      }

      liveZones = scanResult?.orderBlocks || [];
    }

    if (!liveZones || liveZones.length === 0) return null;

    const timeScale = chart.timeScale();
    const layoutOptions = chart.options()?.layout as any;
    const timeScaleOptions = timeScale.options() as any;
    const barSpacing = layoutOptions?.barSpacing ?? timeScaleOptions?.barSpacing ?? 6;

    // Get right-most coordinate for extending active zones forward
    const lastCandleSec = Math.floor(activeCandles[activeCandles.length - 1].t / 1000);
    const lastCandleX = timeScale.timeToCoordinate(lastCandleSec as any);

    const elements: React.ReactNode[] = [];

    // Filter to visible active Order Blocks, recent Breakers, and recently mitigated zones
    const displayableZones = liveZones.filter(ob =>
      !ob.is_consumed && (
        ob.lifecycle_status === 'UNTESTED' ||
        ob.lifecycle_status === 'ACTIVE_BREAKER' ||
        ob.lifecycle_status === 'BREAKER_CONFIRMED_ACTIVE' ||
        (ob.lifecycle_status === 'MITIGATED_RESPECTED' && ob.mitigation_time && (Date.now() - ob.mitigation_time < 3600000))
      )
    );

    // Strict Architectural Directive: Limit rendered resting zones to top 4 active structures closest to price
    const currentPrice = activeCandles[activeCandles.length - 1].c;
    const sortedZones = [...displayableZones].sort((a, b) => {
      const isFreshA = a.lifecycle_status === 'UNTESTED' ? 0 : 1;
      const isFreshB = b.lifecycle_status === 'UNTESTED' ? 0 : 1;
      if (isFreshA !== isFreshB) return isFreshA - isFreshB;

      const distA = Math.abs(a.mean_threshold - currentPrice);
      const distB = Math.abs(b.mean_threshold - currentPrice);
      return distA - distB;
    }).slice(0, 4);

    for (const ob of sortedZones) {
      const topY = series.priceToCoordinate(ob.top) as number | null;
      const bottomY = series.priceToCoordinate(ob.bottom) as number | null;
      const mtY = series.priceToCoordinate(ob.mean_threshold) as number | null;

      if (topY === null || bottomY === null) continue;

      // Calculate X start position (anchored to formation origin)
      const exactSec = Math.floor(ob.origin_time / 1000);
      let left = timeScale.timeToCoordinate(exactSec as any);
      if (left === null) {
        const closestSec = findClosestCandleSec(activeCandles, ob.origin_time);
        left = timeScale.timeToCoordinate(closestSec as any);
      }

      if (left === null) continue;

      // ── Clean Box Truncation: Terminate cleanly at exact mitigation / invalidation timestamp ──
      let rightX = (lastCandleX !== null) ? lastCandleX + (8 * barSpacing) : left + (20 * barSpacing);

      if (ob.lifecycle_status === 'MITIGATED_RESPECTED' && ob.mitigation_time) {
        const mitSec = findClosestCandleSec(activeCandles, ob.mitigation_time);
        const mitX = timeScale.timeToCoordinate(mitSec as any);
        if (mitX !== null && mitX > left) {
          rightX = mitX; // Crisp cutoff at exact mitigation bar
        }
      } else if (ob.invalidation_time) {
        const invSec = findClosestCandleSec(activeCandles, ob.invalidation_time);
        const invX = timeScale.timeToCoordinate(invSec as any);
        if (invX !== null && invX > left) {
          rightX = invX; // Crisp cutoff at exact invalidation bar
        }
      }

      const width = Math.max(16, rightX - left);
      const pixelTop = Math.min(topY, bottomY);
      const height = Math.max(3, Math.abs(topY - bottomY));

      const isBullish = ob.type === 'BULLISH';
      const isBreaker = ob.is_breaker || ob.lifecycle_status === 'ACTIVE_BREAKER' || ob.lifecycle_status === 'BREAKER_CONFIRMED_ACTIVE';

      // Curated Institutional Color Palette
      const baseColor = isBreaker
        ? '#a855f7' // Purple for Breakers
        : isBullish
        ? (theme === 'dark' ? (themeSettings?.dark_chart_fvg_bullish || '#10b981') : '#059669')
        : (theme === 'dark' ? (themeSettings?.dark_chart_fvg_bearish || '#f43f5e') : '#e11d48');

      const isFresh = ob.lifecycle_status === 'UNTESTED';
      const bgOpacity = isBreaker ? 0.16 : isFresh ? 0.20 : 0.10;
      const borderStyle = isFresh ? '1.5px solid' : '1px dashed';

      const tierBadge = isBreaker
        ? '⚡ BREAKER'
        : ob.quality_tier === 'A_PLUS'
        ? '⭐ A+ OB'
        : ob.quality_tier === 'A'
        ? '💎 A OB'
        : '📦 OB';

      const dirBadge = ob.type === 'BULLISH' ? 'BULL' : 'BEAR';

      elements.push(
        // ── 1. Order Block Shaded Zone Box ────────────────────────────────────
        React.createElement('div', {
          key: `ob_box_${ob.id}`,
          className: 'absolute pointer-events-none z-[2] transition-all duration-150 rounded-sm',
          style: {
            top: `${pixelTop}px`,
            height: `${height}px`,
            left: `${left}px`,
            width: `${width}px`,
            backgroundColor: baseColor,
            opacity: bgOpacity,
            border: `${borderStyle} ${baseColor}`,
          }
        }),

        // ── 2. Mean Threshold (50% Midline) ──────────────────────────────────
        mtY !== null
          ? React.createElement('div', {
              key: `ob_mt_${ob.id}`,
              className: 'absolute pointer-events-none z-[3]',
              style: {
                top: `${mtY}px`,
                left: `${left}px`,
                width: `${width}px`,
                height: '1px',
                borderTop: `1.5px dashed ${baseColor}`,
                opacity: 0.85,
              }
            })
          : null,

        // ── 3. High-Density Tactical HUD Tag ─────────────────────────────────
        React.createElement('div', {
          key: `ob_tag_${ob.id}`,
          className: 'absolute pointer-events-none z-[4] font-mono text-[9px] font-bold px-1.5 py-0.5 rounded shadow-lg backdrop-blur-sm flex items-center gap-1 border',
          style: {
            top: `${Math.max(4, pixelTop - 16)}px`,
            left: `${left + 4}px`,
            backgroundColor: theme === 'dark' ? 'rgba(10, 15, 30, 0.88)' : 'rgba(255, 255, 255, 0.92)',
            borderColor: baseColor,
            color: baseColor,
          }
        },
          React.createElement('span', { className: 'font-black tracking-wider' }, `${tierBadge} [${dirBadge}]`),
          React.createElement('span', { className: 'text-[8px] opacity-75 text-slate-300 font-normal ml-0.5' },
            `$${ob.bottom.toFixed(1)} – $${ob.top.toFixed(1)} (MT: $${ob.mean_threshold.toFixed(1)})`
          )
        )
      );
    }

    return React.createElement(React.Fragment, null, ...elements);
  }
};
