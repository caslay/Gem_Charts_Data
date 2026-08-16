import React from 'react';
import type { ChartLayer } from '../types';
import { useLayerStore } from '../store';
import type { StructuralSwing, ZigZagSegment } from '@/lib/structureEngine';
import { calculateATR } from '@/lib/riskEngine';

interface MappedPoint extends StructuralSwing {
  x: number;
  y: number;
}

interface MappedSegment extends ZigZagSegment {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export const structureLayer: ChartLayer = {
  id: 'structure',
  name: 'Market Structure',
  shortName: 'MARKET',
  description: 'Bloomberg-style horizontal ceilings/floors, dealing range boxes, and unconfirmed expansion rays',
  icon: 'Activity',
  renderHtml(context) {
    const { activeCandles, chart, series, theme, themeSettings } = context;
    if (!activeCandles || activeCandles.length < 5) return null;

    // 1. Fetch visibility states from Zustand store
    const { visibility } = useLayerStore.getState();
    const showParent = visibility.structure !== false;
    const showMajor = visibility.structure_major !== false;
    const showInner = visibility.structure_inner !== false;
    const showInternalSwings = visibility.structure_int !== false; // Governs the Internal Swings and Horizontal Levels
    const showIstr = visibility.structure_istr !== false;

    // If the main layer is hidden, do not render any children
    if (!showParent) return null;

    const timeScale = chart.timeScale();

    // 2. Fetch the pre-calculated, stabilized structural analysis state from context
    const analysis = (context as any).structureState;
    if (!analysis) return null;

    const lastCandle = activeCandles[activeCandles.length - 1];
    const rightX = timeScale.timeToCoordinate(Math.floor(lastCandle.t / 1000) as any);
    if (rightX === null) return null;

    // Volatility suppression calculation
    const atr = activeCandles ? calculateATR(activeCandles) : 0;
    const internalRange = analysis.internalDealingRange;
    const multiplier = parseFloat(themeSettings?.structure_istr_atr_multiplier || '1.5');
    const rangeHeight = (internalRange && internalRange.high !== null && internalRange.low !== null) ? (internalRange.high - internalRange.low) : 0;
    const isVolatilitySuppressed = showIstr && rangeHeight > 0 && atr > 0 && rangeHeight < atr * multiplier;

    // Resolve dynamic colors based on theme settings
    const swingHighColor = theme === 'dark'
      ? (themeSettings?.dark_chart_swing_high || 'rgba(239, 68, 68, 0.85)')
      : (themeSettings?.light_chart_swing_high || 'rgba(225, 29, 72, 0.85)');

    const swingLowColor = theme === 'dark'
      ? (themeSettings?.dark_chart_swing_low || 'rgba(80, 255, 175, 0.85)')
      : (themeSettings?.light_chart_swing_low || 'rgba(5, 150, 105, 0.85)');

    const swingHighInternalColor = theme === 'dark'
      ? (themeSettings?.dark_chart_swing_high_internal || 'rgba(239, 68, 68, 0.45)')
      : (themeSettings?.light_chart_swing_high_internal || 'rgba(225, 29, 72, 0.45)');

    const swingLowInternalColor = theme === 'dark'
      ? (themeSettings?.dark_chart_swing_low_internal || 'rgba(80, 255, 175, 0.45)')
      : (themeSettings?.light_chart_swing_low_internal || 'rgba(5, 150, 105, 0.45)');

    const bosColor = theme === 'dark'
      ? (themeSettings?.dark_chart_bos || 'rgba(168, 85, 247, 0.85)')
      : (themeSettings?.light_chart_bos || 'rgba(79, 70, 229, 0.85)');

    const mssColor = theme === 'dark'
      ? (themeSettings?.dark_chart_mss || 'rgba(80, 255, 175, 0.85)')
      : (themeSettings?.light_chart_mss || 'rgba(5, 150, 105, 0.85)');

    const accentColor = theme === 'dark'
      ? (themeSettings?.dark_accent || '#a855f7')
      : (themeSettings?.light_accent || '#4f46e5');
    // 3. Pixel Coordinate Conversion — Map swings to SVG coordinates
    const mappedSwings: MappedPoint[] = [];
    const swings = (analysis.swings || []).slice(-150); // Cap to last 150 swings for ultra-responsive rendering

    for (let i = 0; i < swings.length; i++) {
      const pt = swings[i];
      if (pt.candle_index === undefined) continue;

      const x = timeScale.timeToCoordinate(Math.floor(pt.t / 1000) as any);
      const y = series.priceToCoordinate(pt.price);

      if (x !== null && y !== null) {
        mappedSwings.push({
          ...pt,
          x,
          y
        });
      }
    }

    // Isolate confirmed major and internal swings and sort chronologically
    const confirmedMajor = mappedSwings
      .filter((s) => (s.grade === 'MAJOR' || s.grade === 'INTERNAL') && s.confirmed !== false)
      .sort((a, b) => a.t - b.t)
      .slice(-40); // Limit horizontal levels to top 40 recent major swings

    // ─── 1. Implement Horizontal Price Ceilings / Floors ───
    const horizontalLevels: React.ReactElement[] = [];
    confirmedMajor.forEach((S, idx) => {
      const isInternal = S.structure_type === 'INTERNAL';
      
      // Major Swings horizontal levels are controlled by showMajor.
      // Internal Swings horizontal levels are controlled by showInternalSwings.
      const shouldRender = isInternal ? showInternalSwings : showMajor;
      if (!shouldRender) return;

      // Find the first confirmed major swing after S that breaches S.price
      const breachSwing = confirmedMajor
        .slice(idx + 1)
        .find((later) =>
          S.type === 'HIGH' ? later.price > S.price : later.price < S.price
        );

      const xEnd = breachSwing ? breachSwing.x : rightX;
      
      // Viewport culling: Skip horizontal levels completely off-screen
      if (xEnd < -50 || S.x > rightX + 50) return;

      // Visual Separation: Check if this Level 2 swing is a Parent range boundary or an Internal wave
      const color = isInternal
        ? (S.type === 'HIGH' ? swingHighInternalColor : swingLowInternalColor)
        : (S.type === 'HIGH' ? swingHighColor : swingLowColor);

      // Draw structural price line
      horizontalLevels.push(
        React.createElement('line', {
          key: `hz-level-line-${idx}`,
          x1: Math.max(0, S.x),
          y1: S.y,
          x2: xEnd,
          y2: S.y,
          stroke: color,
          strokeWidth: isInternal ? 0.9 : 1.5,
          strokeDasharray: isInternal ? '3,3' : undefined, // Dashed lines for internal swings
        })
      );

      // Draw structural label
      if (S.x >= -50 && S.x <= rightX) {
        horizontalLevels.push(
          React.createElement(
            'text',
            {
              key: `hz-level-label-${idx}`,
              x: Math.max(4, S.x + 4),
              y: S.type === 'HIGH' ? S.y - 4 : S.y + 10,
              fill: color,
              fontSize: '6.5',
              fontFamily: 'monospace',
              fontWeight: 'bold',
            },
            isInternal
              ? (S.type === 'HIGH' ? 'INT HIGH' : 'INT LOW')
              : (S.type === 'HIGH' ? 'MAJOR HIGH' : 'MAJOR LOW')
          )
        );
      }
    });

    // ─── 2. Implement BOS/MSS Horizontal Breach Badges ───
    const breachBadges: React.ReactElement[] = [];
    if (showMajor) {
      // 2a. Major Swings Breaks
      const recentZigzag = (analysis.zigzag || []).slice(-50);
      for (const seg of recentZigzag) {
        if (seg.label === 'BOS' || seg.label === 'MSS') {
          const toX = timeScale.timeToCoordinate(Math.floor(seg.to.t / 1000) as any);
          if (toX === null || toX < -50 || toX > rightX + 50) continue;
          
          // Use the EXACT broken structural level for the badge, not the leg origin
          const brokenPrice = seg.brokenLevel ?? seg.from.price;
          const levelY = series.priceToCoordinate(brokenPrice);

          if (levelY !== null) {
            let badgeColor: string;
            let badgeLabel: string = seg.label;

            if (seg.label === 'BOS') {
              badgeColor = bosColor;
            } else {
              // MSS
              if (seg.displacementConfirmed) {
                badgeColor = mssColor;
              } else {
                badgeColor = theme === 'dark' ? 'rgba(251, 191, 36, 0.85)' : 'rgba(217, 119, 6, 0.85)'; // Amber
                badgeLabel = 'MSS?';
              }
            }

            const isHighBreak = seg.to.type === 'HIGH'; // High broken to the upside
            const badgeY = isHighBreak ? levelY - 12 : levelY + 4;

            breachBadges.push(
              React.createElement(
                'g',
                { key: `breach-badge-${seg.to.t}` },
                React.createElement('rect', {
                  x: toX - 14,
                  y: badgeY,
                  width: badgeLabel.length > 3 ? 28 : 24,
                  height: 9,
                  rx: 2,
                  fill: 'var(--background, #020617)',
                  stroke: badgeColor,
                  strokeWidth: 0.5,
                  opacity: 0.9,
                }),
                React.createElement(
                  'text',
                  {
                    x: toX - (badgeLabel.length > 3 ? 0 : 2),
                    y: badgeY + 6.5,
                    fill: badgeColor,
                    fontSize: '6.5',
                    fontFamily: 'monospace',
                    fontWeight: 'bold',
                    textAnchor: 'middle',
                  },
                  badgeLabel
                )
              )
            );
          }
        }
      }
    }

    // 2b. Internal Structure Breaks (iMSS & iBOS) (governed by showIstr & volatility gate)
    if (showIstr && !isVolatilitySuppressed && analysis.internalZigzag) {
      const recentInternalZigzag = (analysis.internalZigzag || []).slice(-50);
      for (const seg of recentInternalZigzag) {
        if (seg.label === 'MSS' || seg.label === 'BOS') {
          const toX = timeScale.timeToCoordinate(Math.floor(seg.to.t / 1000) as any);
            if (toX === null || toX < -50 || toX > rightX + 50) continue;

            const rawFromX = timeScale.timeToCoordinate(Math.floor(seg.from.t / 1000) as any);
            const brokenPrice = seg.brokenLevel ?? seg.from.price;
            const levelY = series.priceToCoordinate(brokenPrice);

            // Coordinate Clamping: clamp rawFromX to left edge (0) if scrolled off-screen
            const fromX = rawFromX !== null ? rawFromX : 0;

            if (toX !== null && levelY !== null) {
              const isHighBreak = seg.to.type === 'HIGH'; // High broken = bullish shift
              let color: string;
              let label: string;

              if (seg.label === 'MSS') {
                color = isHighBreak
                  ? `color-mix(in srgb, ${mssColor} 50%, transparent)` // Muted Emerald (50% opacity of mssColor)
                  : `color-mix(in srgb, ${swingHighColor} 50%, transparent)`; // Muted Rose (50% opacity of swingHighColor)
                label = 'IMSS';
              } else {
                // BOS
                color = `color-mix(in srgb, ${bosColor} 50%, transparent)`; // Muted Purple/Indigo (50% opacity of bosColor)
                label = 'IBOS';
              }

              // Render horizontal dashed line from fromX to toX
              breachBadges.push(
                React.createElement('line', {
                  key: `istr-level-line-${seg.to.t}`,
                  x1: fromX,
                  y1: levelY,
                  x2: toX,
                  y2: levelY,
                  stroke: color,
                  strokeWidth: 1.0,
                  strokeDasharray: '2,2',
                })
              );

              // Render small hollow badge labeled "iMSS" or "iBOS"
              const badgeY = isHighBreak ? levelY - 11 : levelY + 2;
              breachBadges.push(
                React.createElement(
                  'g',
                  { key: `istr-badge-${seg.to.t}` },
                  React.createElement('rect', {
                    x: toX - 14,
                    y: badgeY,
                    width: 28,
                    height: 9,
                    rx: 1.5,
                    fill: 'var(--background, #020617)',
                    stroke: color,
                    strokeWidth: 0.5,
                    strokeDasharray: '2,2',
                    opacity: 0.9,
                  }),
                  React.createElement(
                    'text',
                    {
                      x: toX,
                      y: badgeY + 6.5,
                      fill: color,
                      fontSize: '6.5',
                      fontFamily: 'monospace',
                      fontWeight: 'bold',
                      textAnchor: 'middle',
                    },
                    label
                  )
                )
              );
            }
          }
        }
      }

    // ─── 2c. Implement Equal Highs & Equal Lows (SMT Traps) ───
    const smtLevels: React.ReactElement[] = [];
    const smtTraps = (context.data as any)?.ipda_metrics?.smt_traps || [];
    smtTraps.forEach((trap: any, idx: number) => {
      const x1 = timeScale.timeToCoordinate(Math.floor(trap.time1 / 1000) as any);
      const x2 = timeScale.timeToCoordinate(Math.floor(trap.time2 / 1000) as any);
      const y = series.priceToCoordinate(trap.price);

      if (x1 !== null && x2 !== null && y !== null) {
        const xStart = Math.min(x1, x2);
        const color = theme === 'dark' ? '#fbbf24' : '#d97706'; // Vibrant Gold/Amber
        const isHigh = trap.side !== 'low'; // Default to high (equal highs) if side not specified

        // Draw solid line spanning from the first anchor to the right edge
        smtLevels.push(
          React.createElement('line', {
            key: `smt-line-${idx}`,
            x1: xStart,
            y1: y,
            x2: rightX,
            y2: y,
            stroke: color,
            strokeWidth: 1.5,
            opacity: 0.85,
          })
        );

        // Draw anchor circle 1
        smtLevels.push(
          React.createElement('circle', {
            key: `smt-anchor1-${idx}`,
            cx: x1,
            cy: y,
            r: 3,
            stroke: color,
            strokeWidth: 1.5,
            fill: 'none',
          })
        );

        // Draw anchor circle 2
        smtLevels.push(
          React.createElement('circle', {
            key: `smt-anchor2-${idx}`,
            cx: x2,
            cy: y,
            r: 3,
            stroke: color,
            strokeWidth: 1.5,
            fill: 'none',
          })
        );

        // Draw monospace label showing "EQH" or "EQL"
        smtLevels.push(
          React.createElement(
            'text',
            {
              key: `smt-label-${idx}`,
              x: rightX - 90,
              y: isHigh ? y - 4 : y + 9,
              fill: color,
              fontSize: '6.5',
              fontFamily: 'monospace',
              fontWeight: 'bold',
            },
            isHigh ? 'EQH (EQUAL HIGHS)' : 'EQL (EQUAL LOWS)'
          )
        );
      }
    });

    // ─── 3. Implement The Dealing Range Shadow Box & Equilibrium ───
    let drShadowBox: React.ReactElement | null = null;
    const drEqMidline: React.ReactElement[] = [];
    let savpValueArea: React.ReactElement | null = null;
    let savpPocLine: React.ReactElement | null = null;

    const dr = analysis.dealingRange;
    if (dr && dr.anchor_high_swing && dr.anchor_low_swing && dr.high !== null && dr.low !== null && dr.equilibrium !== null) {
      const rawHighX = timeScale.timeToCoordinate(Math.floor(dr.anchor_high_swing.t / 1000) as any);
      const rawLowX = timeScale.timeToCoordinate(Math.floor(dr.anchor_low_swing.t / 1000) as any);
      const boxTopY = series.priceToCoordinate(dr.high);
      const boxBottomY = series.priceToCoordinate(dr.low);
      const eqY = series.priceToCoordinate(dr.equilibrium);

      const highX = rawHighX !== null ? (rawHighX as unknown as number) : 0;
      const lowX = rawLowX !== null ? (rawLowX as unknown as number) : 0;

      if (boxTopY !== null && boxBottomY !== null && eqY !== null) {
        const boxStartX = Math.min(highX, lowX);
        const trendState = analysis.currentTrend || 'UNSET';
        
        let fillStyle = `color-mix(in srgb, ${accentColor} 4%, transparent)`;
        if (trendState === 'BULLISH') {
          fillStyle = `color-mix(in srgb, ${swingLowColor} 4%, transparent)`;
        } else if (trendState === 'BEARISH') {
          fillStyle = `color-mix(in srgb, ${swingHighColor} 4%, transparent)`;
        }

        // Draw shadow rectangle
        drShadowBox = React.createElement('rect', {
          key: 'dr-shadow-box',
          x: boxStartX,
          y: Math.min(boxTopY, boxBottomY),
          width: rightX - boxStartX,
          height: Math.abs(boxBottomY - boxTopY),
          fill: fillStyle,
          stroke: 'none',
        });

        // Draw SAVP Value Area and POC if metrics are available
        if (dr.profile_metrics && dr.profile_metrics.poc !== null) {
          const pm = dr.profile_metrics;
          const pocY = series.priceToCoordinate(pm.poc);
          const vahY = pm.vah !== null ? series.priceToCoordinate(pm.vah) : null;
          const valY = pm.val !== null ? series.priceToCoordinate(pm.val) : null;

          if (vahY !== null && valY !== null) {
            savpValueArea = React.createElement('rect', {
              key: 'dr-savp-va',
              x: boxStartX,
              y: Math.min(vahY, valY),
              width: rightX - boxStartX,
              height: Math.abs(valY - vahY),
              fill: `color-mix(in srgb, ${accentColor} 8%, transparent)`,
              stroke: 'none',
            });
          }

          if (pocY !== null) {
            savpPocLine = React.createElement('line', {
              key: 'dr-savp-poc',
              x1: boxStartX,
              y1: pocY,
              x2: rightX,
              y2: pocY,
              stroke: 'var(--accent, ' + accentColor + ')',
              strokeWidth: 2.0,
            });
          }
        }

        // Draw dashed midline at 50% Equilibrium
        drEqMidline.push(
          React.createElement('line', {
            key: 'dr-eq-midline',
            x1: boxStartX,
            y1: eqY,
            x2: rightX,
            y2: eqY,
            stroke: theme === 'dark' ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.25)',
            strokeWidth: 1.0,
            strokeDasharray: '4,4',
          })
        );

        // Draw equilibrium label
        drEqMidline.push(
          React.createElement(
            'text',
            {
              key: 'dr-eq-label',
              x: rightX - 52,
              y: eqY - 4,
              fill: theme === 'dark' ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.45)',
              fontSize: '6px',
              fontFamily: 'monospace',
              fontWeight: 'bold',
            },
            'EQUILIBRIUM (0.50)'
          )
        );
      }
    }

    // ─── 4. Implement The Active Expansion Trace Ray (Unconfirmed Swings) ───
    const expansionRays: React.ReactElement[] = [];

    // 5. Native SVG Canvas Assembly
    return React.createElement(
      'div',
      { className: 'absolute inset-0 pointer-events-none z-[2] overflow-hidden' },
      React.createElement(
        'svg',
        { className: 'w-full h-full' },
        
        // A1. Draw Inner Sub-Wave Zig-Zag Path (Muted, Dashed)
        // Kept for inner sub-wave visual subordinate mapping if visible
        showInternalSwings && showInner && analysis.innerZigzag &&
          analysis.innerZigzag.map((seg: any, idx: number) => {
            const fromX = timeScale.timeToCoordinate(Math.floor(seg.from.t / 1000) as any);
            const fromY = series.priceToCoordinate(seg.from.price);
            const toX = timeScale.timeToCoordinate(Math.floor(seg.to.t / 1000) as any);
            const toY = series.priceToCoordinate(seg.to.price);

            if (fromX !== null && fromY !== null && toX !== null && toY !== null) {
              return React.createElement('line', {
                key: `inner-zz-segment-${idx}`,
                x1: fromX,
                y1: fromY,
                x2: toX,
                y2: toY,
                stroke: theme === 'dark'
                  ? `color-mix(in srgb, ${themeSettings?.dark_accent || '#a855f7'} 35%, transparent)`
                  : `color-mix(in srgb, ${themeSettings?.light_accent || '#4f46e5'} 35%, transparent)`,
                strokeWidth: 1.0,
                strokeDasharray: '3,3',
              });
            }
            return null;
          }),

        // A2. Draw Shadow Box
        drShadowBox,
        savpValueArea,

        // A3. Draw Equilibrium midline
        drEqMidline,
        savpPocLine,

        // A4. Draw Horizontal price levels
        horizontalLevels,

        // A5. Draw Active Expansion Trace rays
        expansionRays,

        // A6. Draw BOS/MSS badges horizontally
        breachBadges,

        // A7. Draw Equal Highs & Equal Lows levels
        smtLevels,

        // B. Plot Major/Internal Swings (Hollow Circles at Level 2 Multi-Scale Swings)
        mappedSwings
          .filter((s) => {
            if (s.grade !== 'MAJOR') return false;
            if (s.confirmed === false) return false; // Hide candidate/unconfirmed circles
            if (s.x < -50 || s.x > rightX + 50) return false; // Viewport culling
            const isInternal = s.structure_type === 'INTERNAL';
            if (isInternal) {
              return showInternalSwings && !isVolatilitySuppressed;
            } else {
              return showMajor;
            }
          })
          .map((pt, idx) => {
              const isConfirmed = pt.confirmed !== false;
              const isInternal = pt.structure_type === 'INTERNAL';
              const color = isConfirmed
                ? (isInternal
                    ? (pt.type === 'HIGH' ? swingHighInternalColor : swingLowInternalColor)
                    : (pt.type === 'HIGH' ? swingHighColor : swingLowColor))
                : (theme === 'dark' ? 'rgba(251, 191, 36, 0.85)' : 'rgba(217, 119, 6, 0.85)');
              return React.createElement('circle', {
                key: `major-swing-${idx}`,
                cx: pt.x,
                cy: pt.y,
                r: 4.5,
                stroke: isConfirmed
                  ? (pt.colorValidated ? color : 'rgba(148, 163, 184, 0.4)')
                  : (theme === 'dark' ? 'rgba(251, 191, 36, 0.85)' : 'rgba(217, 119, 6, 0.85)'),
                strokeWidth: isConfirmed ? (pt.colorValidated ? 1.5 : 0.8) : 1.2,
                strokeDasharray: isConfirmed ? undefined : '2,2',
                fill: 'none',
              });
            }),

        // C. Plot Inner Swings (Small Diamonds at Level 1 Multi-Scale Swings)
        showInner &&
          mappedSwings
            .filter((s) => s.grade === 'INNER' && s.x >= -50 && s.x <= rightX + 50)
            .map((pt, idx) => {
              const pointsStr = `${pt.x},${pt.y - 3.5} ${pt.x + 3.5},${pt.y} ${pt.x},${pt.y + 3.5} ${pt.x - 3.5},${pt.y}`;
              return React.createElement('polygon', {
                key: `inner-swing-${idx}`,
                points: pointsStr,
                fill: accentColor,
                stroke: accentColor,
                strokeWidth: 1,
              });
            }),

        // D. Volatility Suppression Warning Badge (Amber, Top Right)
        isVolatilitySuppressed && React.createElement(
          'g',
          { key: 'istr-vol-suppression-badge' },
          React.createElement('rect', {
            x: '98%',
            y: 12,
            width: 175,
            height: 16,
            rx: 4,
            fill: 'rgba(251, 191, 36, 0.08)',
            stroke: 'rgba(251, 191, 36, 0.45)',
            strokeWidth: 0.8,
            transform: 'translate(-175, 0)',
            opacity: 0.95,
          }),
          React.createElement(
            'text',
            {
              x: '98%',
              y: 22,
              fill: 'rgba(251, 191, 36, 0.95)',
              fontSize: '6.5',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              textAnchor: 'end',
              dx: -6,
            },
            '⚠️ iSTR VOLATILITY: NOISE SUPPRESSED'
          )
        )
      )
    );
  },
};
