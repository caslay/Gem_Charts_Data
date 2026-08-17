'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { RenderContext } from '@/lib/chartLayers/types';
import { useLayerStore } from '@/lib/chartLayers/store';
import { OrderBlockEngine, InstitutionalOrderBlock } from '@/lib/quantEngine/OrderBlockEngine';
import {
  X,
  Layers,
  Shield,
  Zap,
  CheckCircle2,
  AlertCircle,
  Crosshair,
  TrendingUp,
  TrendingDown,
  Clock,
  Lock,
  Scale,
  Target,
  Sparkles,
  Info,
  ChevronRight
} from 'lucide-react';

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

interface OrderBlockOverlayProps {
  context: RenderContext;
}

export default function OrderBlockOverlay({ context }: OrderBlockOverlayProps) {
  const { chart, series, data, activeCandles, theme, themeSettings, storage } = context;

  const [selectedZone, setSelectedZone] = useState<InstitutionalOrderBlock | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);

  // Fetch user visibility preferences
  const { visibility } = useLayerStore();
  const showLayer = visibility.order_blocks !== false;
  const showLabels = (visibility as any).order_blocks_labels !== false;
  const showMt = (visibility as any).order_blocks_mt !== false;

  // Keyboard shortcut to close inspector (Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedZone) {
        setSelectedZone(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedZone]);

  if (!showLayer || !activeCandles || activeCandles.length < 5) return null;

  // ── 1. Resolve Active Order Blocks & Breakers ─────────────────────────────
  const ipda = data?.ipda_metrics || {};
  let liveZones: InstitutionalOrderBlock[] =
    (data as any)?.active_order_blocks ||
    (ipda as any)?.order_blocks ||
    [];

  if (!liveZones || liveZones.length === 0) {
    const lastCandle = activeCandles[activeCandles.length - 1];
    const cacheKey = `ob_scan_v3_${lastCandle.t}_${activeCandles.length}`;
    let scanResult = storage.get(cacheKey);

    if (!scanResult) {
      const engine = new OrderBlockEngine({
        symbol: data?.ticker || 'ETHUSDC',
        timeframe: '15m',
        minQualityTier: 'ALL',
        strictTierAPlus: false,
        enableBreakerSimulation: true,
        maxBarsToMitigation: 24,
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

  const lastCandleSec = Math.floor(activeCandles[activeCandles.length - 1].t / 1000);
  const lastCandleX = timeScale.timeToCoordinate(lastCandleSec as any);

  // Filter to visible active Order Blocks, Breakers, and recently mitigated zones
  const displayableZones = liveZones.filter(ob =>
    !ob.is_consumed && (
      ob.lifecycle_status === 'UNTESTED' ||
      ob.lifecycle_status === 'ACTIVE_BREAKER' ||
      ob.lifecycle_status === 'BREAKER_CONFIRMED_ACTIVE' ||
      (ob.lifecycle_status === 'MITIGATED_RESPECTED' && ob.mitigation_time && (Date.now() - ob.mitigation_time < 3600000))
    )
  );

  // Limit rendered resting zones to top 4 active structures closest to price
  const currentPrice = activeCandles[activeCandles.length - 1].c;
  const sortedZones = [...displayableZones].sort((a, b) => {
    const isFreshA = a.lifecycle_status === 'UNTESTED' ? 0 : 1;
    const isFreshB = b.lifecycle_status === 'UNTESTED' ? 0 : 1;
    if (isFreshA !== isFreshB) return isFreshA - isFreshB;

    const distA = Math.abs(a.mean_threshold - currentPrice);
    const distB = Math.abs(b.mean_threshold - currentPrice);
    return distA - distB;
  }).slice(0, 4);

  return (
    <>
      {/* ── Visual Zones Overlay ─────────────────────────────────────────── */}
      {sortedZones.map((ob) => {
        const topY = series.priceToCoordinate(ob.top) as number | null;
        const bottomY = series.priceToCoordinate(ob.bottom) as number | null;
        const mtY = series.priceToCoordinate(ob.mean_threshold) as number | null;

        if (topY === null || bottomY === null) return null;

        // Calculate X start position (anchored to formation origin)
        const exactSec = Math.floor(ob.origin_time / 1000);
        let left = timeScale.timeToCoordinate(exactSec as any);
        if (left === null) {
          const closestSec = findClosestCandleSec(activeCandles, ob.origin_time);
          left = timeScale.timeToCoordinate(closestSec as any);
        }

        if (left === null) return null;

        // ── Clean Box Truncation: Terminate cleanly at exact mitigation / invalidation timestamp ──
        let rightX = (lastCandleX !== null) ? lastCandleX + (8 * barSpacing) : left + (20 * barSpacing);

        if (ob.lifecycle_status === 'MITIGATED_RESPECTED' && ob.mitigation_time) {
          const mitSec = findClosestCandleSec(activeCandles, ob.mitigation_time);
          const mitX = timeScale.timeToCoordinate(mitSec as any);
          if (mitX !== null && mitX > left) {
            rightX = mitX;
          }
        } else if (ob.invalidation_time) {
          const invSec = findClosestCandleSec(activeCandles, ob.invalidation_time);
          const invX = timeScale.timeToCoordinate(invSec as any);
          if (invX !== null && invX > left) {
            rightX = invX;
          }
        }

        const width = Math.max(16, rightX - left);
        const pixelTop = Math.min(topY, bottomY);
        const height = Math.max(3, Math.abs(topY - bottomY));

        const isBullish = ob.type === 'BULLISH';
        const isBreaker = ob.is_breaker || ob.lifecycle_status === 'ACTIVE_BREAKER' || ob.lifecycle_status === 'BREAKER_CONFIRMED_ACTIVE';
        const isSelected = selectedZone?.id === ob.id;
        const isHovered = hoveredZoneId === ob.id;

        // Instant Visual Scan: Green/Emerald for BULLISH, Red/Rose for BEARISH
        const directionColor = isBullish
          ? (theme === 'dark' ? (themeSettings?.dark_chart_fvg_bullish || '#10b981') : '#059669')
          : (theme === 'dark' ? (themeSettings?.dark_chart_fvg_bearish || '#f43f5e') : '#e11d48');

        // Distinct border & accent colors
        const borderColor = directionColor;
        const mtColor = isBreaker ? '#c084fc' : directionColor; // Violet MT for Breakers, Emerald/Rose for OBs

        // Subtle 5%-8% fill opacity for maximum candlestick & wick visibility
        const bgOpacity = isSelected ? 0.14 : isHovered ? 0.10 : isBreaker ? 0.07 : 0.05;
        const isFresh = ob.lifecycle_status === 'UNTESTED';
        const borderStyle = isBreaker ? 'solid' : isFresh ? 'solid' : 'dashed';
        const borderWidth = isSelected ? '2px' : isBreaker ? '1.5px' : '1.5px';

        // Explicit, instantly scannable micro-pills with Bullish/Bearish indication
        const tierPrefix = ob.quality_tier === 'A_PLUS' ? 'A+ ' : ob.quality_tier === 'A' ? 'A ' : '';
        const microTag = isBreaker
          ? (isBullish ? `⚡🟢 BULL BB` : `⚡🔴 BEAR BB`)
          : (isBullish ? `🟢 ${tierPrefix}BULL OB` : `🔴 ${tierPrefix}BEAR OB`);

        return (
          <React.Fragment key={`zone_group_${ob.id}`}>
            {/* ── 1. Order Block / Breaker Box ──────────────────────────────── */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                setSelectedZone(isSelected ? null : ob);
              }}
              onMouseEnter={() => setHoveredZoneId(ob.id)}
              onMouseLeave={() => setHoveredZoneId(null)}
              className={`absolute pointer-events-auto z-[2] transition-all duration-150 rounded-sm cursor-pointer ${isSelected
                ? 'ring-2 ring-cyan-400 shadow-[0_0_22px_rgba(6,182,212,0.6)]'
                : isHovered
                  ? 'shadow-[0_0_14px_rgba(255,255,255,0.2)]'
                  : ''
                }`}
              style={{
                top: `${pixelTop}px`,
                height: `${height}px`,
                left: `${left}px`,
                width: `${width}px`,
                backgroundColor: directionColor,
                opacity: bgOpacity,
                border: `${borderWidth} ${borderStyle} ${borderColor}`,
                boxShadow: isHovered
                  ? `0 0 10px ${borderColor}66, inset 0 0 8px ${borderColor}33`
                  : undefined,
              }}
              title={`Click to inspect ${isBullish ? 'Bullish' : 'Bearish'} ${isBreaker ? 'Breaker Block' : 'Order Block'} ($${ob.bottom.toFixed(1)} – $${ob.top.toFixed(1)})`}
            />

            {/* ── 2. High-Contrast 50% Mean Threshold (MT) Midline ─────────── */}
            {showMt && mtY !== null && (
              <div
                className="absolute pointer-events-none z-[3] flex items-center justify-end pr-1"
                style={{
                  top: `${mtY}px`,
                  left: `${left}px`,
                  width: `${width}px`,
                  height: '1px',
                  borderTop: `1.5px dashed ${mtColor}`,
                  opacity: isSelected ? 1 : isHovered ? 0.95 : 0.85,
                }}
              >
                {width > 60 && (
                  <span
                    className="text-[7px] font-mono font-bold px-1 rounded -translate-y-2 select-none shadow-sm"
                    style={{
                      backgroundColor: theme === 'dark' ? 'rgba(5, 10, 20, 0.85)' : 'rgba(255, 255, 255, 0.9)',
                      color: mtColor,
                    }}
                  >
                    MT ${ob.mean_threshold.toFixed(1)}
                  </span>
                )}
              </div>
            )}

            {/* ── 3. Minimalist Origin Edge Micro-Pill ──────────────────────── */}
            {showLabels && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedZone(isSelected ? null : ob);
                }}
                onMouseEnter={() => setHoveredZoneId(ob.id)}
                onMouseLeave={() => setHoveredZoneId(null)}
                className={`absolute pointer-events-auto z-[4] font-mono text-[8px] font-black px-1.5 py-0.5 rounded shadow-lg backdrop-blur-md flex items-center gap-1 border cursor-pointer transition-all duration-150 select-none ${isSelected
                  ? 'border-cyan-400 bg-cyan-950/95 text-cyan-200 ring-1 ring-cyan-400 scale-105'
                  : isHovered
                    ? 'scale-105'
                    : ''
                  }`}
                style={{
                  top: `${Math.max(4, pixelTop - 15)}px`,
                  left: `${left + 2}px`,
                  backgroundColor: theme === 'dark' ? 'rgba(5, 10, 20, 0.92)' : 'rgba(255, 255, 255, 0.95)',
                  borderColor: isSelected ? '#22d3ee' : borderColor,
                  color: isSelected ? '#22d3ee' : borderColor,
                }}
                title="Click to view quantitative diagnostics"
              >
                <span className="font-normal">{microTag}</span>
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* ── 4. Interactive Glassmorphic Zone Inspector Popover ───────────── */}
      {selectedZone && (
        <ZoneInspectorPopover
          zone={selectedZone}
          theme={theme}
          onClose={() => setSelectedZone(null)}
        />
      )}
    </>
  );
}

// ── Interactive Zone Inspector Popover Component ─────────────────────────────
interface ZoneInspectorPopoverProps {
  zone: InstitutionalOrderBlock;
  theme: 'dark' | 'light';
  onClose: () => void;
}

function ZoneInspectorPopover({ zone, theme, onClose }: ZoneInspectorPopoverProps) {
  const isBullish = zone.type === 'BULLISH';
  const isBreaker = zone.is_breaker || zone.lifecycle_status === 'ACTIVE_BREAKER' || zone.lifecycle_status === 'BREAKER_CONFIRMED_ACTIVE';

  const tierBadgeColor =
    zone.quality_tier === 'A_PLUS' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
      zone.quality_tier === 'A' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' :
        'bg-slate-800 text-slate-300 border-slate-700';

  const directionColor = isBullish
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    : 'bg-rose-500/20 text-rose-300 border-rose-500/40';

  const formattedOriginTime = new Date(zone.origin_time).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const gates = zone.gates || ({} as any);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute top-12 right-4 z-[100] w-96 max-w-[calc(100vw-2rem)] bg-slate-950/95 border border-cyan-500/40 backdrop-blur-2xl rounded-xl shadow-2xl p-4 font-mono text-xs text-slate-100 select-none animate-in fade-in zoom-in-95 duration-150 flex flex-col gap-3"
      role="dialog"
      aria-label="Zone Inspector"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1.5 rounded-lg border ${isBreaker ? 'bg-purple-950/80 border-purple-500/40 text-purple-300' : directionColor}`}>
            {isBreaker ? <Zap className="w-4 h-4" /> : isBullish ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-black text-white text-[11px] uppercase tracking-wider truncate">
                {isBreaker ? 'Breaker Block' : 'Order Block'}
              </span>
              <span className={`px-1.5 py-0.2 rounded text-[8px] font-black uppercase border ${directionColor}`}>
                {zone.type}
              </span>
            </div>
            <span className="text-[9px] text-slate-400">
              Origin: {formattedOriginTime} ({zone.timeframe || '15m'})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase border ${tierBadgeColor}`}>
            {zone.quality_tier.replace('_', '+')}
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800/80 text-slate-400 hover:text-white transition cursor-pointer"
            aria-label="Close Inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Price Geometry Ribbon ──────────────────────────────────────────── */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5 grid grid-cols-3 gap-2 text-center text-[10px]">
        <div className="flex flex-col justify-between">
          <span className="text-[8px] uppercase text-slate-500 font-bold">Zone Top</span>
          <span className="font-bold text-slate-200 mt-0.5">${zone.top.toFixed(2)}</span>
        </div>
        <div className="flex flex-col justify-between border-x border-slate-800 px-1">
          <span className="text-[8px] uppercase text-cyan-400 font-bold">50% MT Midline</span>
          <span className="font-bold text-cyan-300 mt-0.5">${zone.mean_threshold.toFixed(2)}</span>
        </div>
        <div className="flex flex-col justify-between">
          <span className="text-[8px] uppercase text-slate-500 font-bold">Zone Bottom</span>
          <span className="font-bold text-slate-200 mt-0.5">${zone.bottom.toFixed(2)}</span>
        </div>
      </div>

      {/* ── 4-Gate Quantitative Validation Diagnostics ──────────────────────── */}
      <div className="flex flex-col gap-1.5 bg-slate-900/50 border border-slate-800/80 rounded-lg p-2.5 text-[9px]">
        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1">
          <span className="font-bold uppercase text-slate-400 flex items-center gap-1">
            <Shield className="w-3 h-3 text-cyan-400" />
            <span>4-Gate Institutional Validation</span>
          </span>
          <span className="font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-500/30">
            Score: {zone.confluence_score || 85}/100
          </span>
        </div>

        {/* Gate 1: Liquidity Sweep */}
        <div className="flex items-center justify-between pt-0.5">
          <span className="text-slate-400 flex items-center gap-1">
            <Target className="w-2.5 h-2.5 text-amber-400" />
            <span>Gate 1: Liquidity Sweep</span>
          </span>
          <span className={`font-bold ${gates.gate1_liquidity_sweep ? 'text-emerald-400' : 'text-slate-500'}`}>
            {gates.gate1_liquidity_sweep ? `✓ ${gates.sweep_type || 'Swept'}` : '✕ None'}
          </span>
        </div>

        {/* Gate 2: Displacement & Volume */}
        <div className="flex items-center justify-between">
          <span className="text-slate-400 flex items-center gap-1">
            <Zap className="w-2.5 h-2.5 text-cyan-400" />
            <span>Gate 2: Displacement & FVG</span>
          </span>
          <span className={`font-bold ${gates.gate2_displacement_imbalance ? 'text-emerald-400' : 'text-slate-500'}`}>
            {gates.gate2_displacement_imbalance
              ? `✓ ${gates.displacement_volume_expansion ? `${gates.displacement_volume_expansion.toFixed(1)}x Vol` : 'Active'}`
              : '✕ Weak'}
          </span>
        </div>

        {/* Gate 3: Structure Break (MSS/BOS) */}
        <div className="flex items-center justify-between">
          <span className="text-slate-400 flex items-center gap-1">
            <Layers className="w-2.5 h-2.5 text-purple-400" />
            <span>Gate 3: Structural Shift</span>
          </span>
          <span className={`font-bold ${gates.gate3_structure_break ? 'text-emerald-400' : 'text-slate-500'}`}>
            {gates.gate3_structure_break ? `✓ ${gates.structure_break_type || 'MSS'}` : '✕ None'}
          </span>
        </div>

        {/* Gate 4: Dealing Range */}
        <div className="flex items-center justify-between">
          <span className="text-slate-400 flex items-center gap-1">
            <Scale className="w-2.5 h-2.5 text-blue-400" />
            <span>Gate 4: Dealing Range</span>
          </span>
          <span className={`font-bold ${gates.gate4_dealing_range ? 'text-emerald-400' : 'text-slate-400'}`}>
            {gates.dealing_range_location || (isBullish ? 'DISCOUNT' : 'PREMIUM')}
          </span>
        </div>
      </div>

      {/* ── Institutional Targeting & Execution Context ─────────────────────── */}
      <div className="grid grid-cols-2 gap-2 text-[9px]">
        <div className="bg-slate-900/60 border border-slate-800 rounded p-2 flex flex-col justify-between">
          <span className="text-[8px] uppercase text-slate-500 font-bold">Structural Role</span>
          <span className="font-bold text-cyan-300 mt-1">
            {zone.structural_weight || (zone.timeframe === '1h' ? '1H Macro Anchor' : '15m Structural')}
          </span>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded p-2 flex flex-col justify-between">
          <span className="text-[8px] uppercase text-slate-500 font-bold">Lifecycle State</span>
          <span className="font-bold text-emerald-400 mt-1">
            {zone.lifecycle_status === 'UNTESTED' ? 'Resting (Fresh)' :
              zone.lifecycle_status === 'ACTIVE_BREAKER' ? 'Active Breaker' :
                zone.lifecycle_status}
          </span>
        </div>
      </div>

      {/* ── Retest Depth & Spread Summary ──────────────────────────────────── */}
      <div className="flex items-center justify-between text-[9px] text-slate-400 px-1 border-t border-slate-800/80 pt-2">
        <span>Range Height: <strong className="text-slate-200">${zone.range_height.toFixed(2)}</strong> ({zone.range_pct.toFixed(2)}%)</span>
        <span className="text-cyan-400 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          <span>Active MT Defense</span>
        </span>
      </div>
    </div>
  );
}
