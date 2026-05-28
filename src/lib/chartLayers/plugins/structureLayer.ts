import React from 'react';
import type { ChartLayer } from '../types';
import { useLayerStore } from '../store';
import type { StructuralSwing, ZigZagSegment } from '@/lib/structureEngine';

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
  description: 'Bloomberg-style horizontal ceilings/floors, dealing range boxes, and unconfirmed expansion rays',
  icon: 'Activity',
  renderHtml(context) {
    const { activeCandles, chart, series } = context;
    if (!activeCandles || activeCandles.length < 5) return null;

    // 1. Fetch visibility states from Zustand store
    const { visibility } = useLayerStore.getState();
    const showParent = visibility.structure !== false;
    const showMajor = visibility.structure_major !== false;
    const showInner = visibility.structure_inner !== false;
    const showZigZag = visibility.structure_zigzag !== false; // Governs the Horizontal Price Levels

    // If the main layer is hidden, do not render any children
    if (!showParent) return null;

    const timeScale = chart.timeScale();

    // 2. Fetch the pre-calculated, stabilized structural analysis state from context
    const analysis = (context as any).structureState;
    if (!analysis) return null;

    const lastCandle = activeCandles[activeCandles.length - 1];
    const rightX = timeScale.timeToCoordinate(Math.floor(lastCandle.t / 1000) as any);
    if (rightX === null) return null;

    // 3. Pixel Coordinate Conversion — Map swings to SVG coordinates
    const mappedSwings: MappedPoint[] = [];
    for (const pt of analysis.swings) {
      const x = timeScale.timeToCoordinate(Math.floor(pt.t / 1000) as any);
      const y = series.priceToCoordinate(pt.price);
      if (x !== null && y !== null) {
        mappedSwings.push({ ...pt, x, y });
      }
    }

    // Isolate confirmed major swings and sort chronologically
    const confirmedMajor = mappedSwings
      .filter((s) => s.grade === 'MAJOR' && s.confirmed !== false)
      .sort((a, b) => a.t - b.t);

    // ─── 1. Implement Horizontal Price Ceilings / Floors ───
    const horizontalLevels: React.ReactElement[] = [];
    if (showZigZag && showMajor) {
      confirmedMajor.forEach((S, idx) => {
        // Find the first confirmed major swing after S that breaches S.price
        const breachSwing = confirmedMajor
          .slice(idx + 1)
          .find((later) =>
            S.type === 'HIGH' ? later.price > S.price : later.price < S.price
          );

        const xEnd = breachSwing ? breachSwing.x : rightX;
        const color = S.type === 'HIGH' ? 'rgba(239, 68, 68, 0.45)' : 'rgba(80, 255, 175, 0.45)'; // Rose for high, green for low

        // Draw structural price line
        horizontalLevels.push(
          React.createElement('line', {
            key: `hz-level-line-${idx}`,
            x1: S.x,
            y1: S.y,
            x2: xEnd,
            y2: S.y,
            stroke: color,
            strokeWidth: 1.5,
          })
        );

        // Draw structural label
        horizontalLevels.push(
          React.createElement(
            'text',
            {
              key: `hz-level-label-${idx}`,
              x: S.x + 4,
              y: S.type === 'HIGH' ? S.y - 4 : S.y + 10,
              fill: S.type === 'HIGH' ? 'rgba(239, 68, 68, 0.65)' : 'rgba(80, 255, 175, 0.65)',
              fontSize: '6.5',
              fontFamily: 'monospace',
              fontWeight: 'bold',
            },
            S.type === 'HIGH' ? 'MAJOR HIGH' : 'MAJOR LOW'
          )
        );
      });
    }

    // ─── 2. Implement BOS/MSS Horizontal Breach Badges ───
    const breachBadges: React.ReactElement[] = [];
    if (showZigZag) {
      for (const seg of analysis.zigzag) {
        if (seg.label === 'BOS' || seg.label === 'MSS') {
          const toX = timeScale.timeToCoordinate(Math.floor(seg.to.t / 1000) as any);
          const levelY = series.priceToCoordinate(seg.from.price);

          if (toX !== null && levelY !== null) {
            let badgeColor: string;
            let badgeLabel: string = seg.label;

            if (seg.label === 'BOS') {
              badgeColor = 'rgba(168, 85, 247, 0.85)'; // purple
            } else {
              // MSS
              if (seg.displacementConfirmed) {
                badgeColor = 'var(--up-candle, #50ffaf)'; // neon green
              } else {
                badgeColor = 'rgba(251, 191, 36, 0.85)'; // amber
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

    // ─── 3. Implement The Dealing Range Shadow Box & Equilibrium ───
    let drShadowBox: React.ReactElement | null = null;
    let drEqMidline: React.ReactElement[] = [];

    const dr = analysis.dealingRange;
    if (dr && dr.anchor_high_swing && dr.anchor_low_swing) {
      const highX = timeScale.timeToCoordinate(Math.floor(dr.anchor_high_swing.t / 1000) as any);
      const lowX = timeScale.timeToCoordinate(Math.floor(dr.anchor_low_swing.t / 1000) as any);
      const boxTopY = series.priceToCoordinate(dr.high);
      const boxBottomY = series.priceToCoordinate(dr.low);
      const eqY = series.priceToCoordinate(dr.equilibrium);

      if (highX !== null && lowX !== null && boxTopY !== null && boxBottomY !== null && eqY !== null) {
        const boxStartX = Math.min(highX, lowX);
        const trendState = analysis.currentTrend || 'UNSET';
        
        let fillStyle = 'rgba(168, 85, 247, 0.04)'; // Muted purple for Neutral/Unset
        if (trendState === 'BULLISH') {
          fillStyle = 'rgba(80, 255, 175, 0.04)'; // Subtle emerald
        } else if (trendState === 'BEARISH') {
          fillStyle = 'rgba(239, 68, 68, 0.04)'; // Subtle rose
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

        // Draw dashed midline at 50% Equilibrium
        drEqMidline.push(
          React.createElement('line', {
            key: 'dr-eq-midline',
            x1: boxStartX,
            y1: eqY,
            x2: rightX,
            y2: eqY,
            stroke: 'rgba(255, 255, 255, 0.35)',
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
              fill: 'rgba(255, 255, 255, 0.45)',
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
    if (showMajor) {
      mappedSwings
        .filter((s) => s.grade === 'MAJOR' && s.confirmed === false)
        .forEach((pt, idx) => {
          expansionRays.push(
            React.createElement('line', {
              key: `expansion-ray-${idx}`,
              x1: pt.x,
              y1: pt.y,
              x2: rightX,
              y2: pt.y,
              stroke: 'rgba(251, 191, 36, 0.65)', // Amber
              strokeWidth: 1.0,
              strokeDasharray: '2,3',
            })
          );
        });
    }

    // 5. Native SVG Canvas Assembly
    return React.createElement(
      'div',
      { className: 'absolute inset-0 pointer-events-none z-[2] overflow-hidden' },
      React.createElement(
        'svg',
        { className: 'w-full h-full' },
        
        // A1. Draw Inner Sub-Wave Zig-Zag Path (Muted, Dashed)
        // Kept for inner sub-wave visual subordinate mapping if visible
        showZigZag && showInner && analysis.innerZigzag &&
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
                stroke: 'rgba(168, 85, 247, 0.35)', // Muted transparent purple
                strokeWidth: 1.0,
                strokeDasharray: '3,3',
              });
            }
            return null;
          }),

        // A2. Draw Shadow Box
        drShadowBox,

        // A3. Draw Equilibrium midline
        drEqMidline,

        // A4. Draw Horizontal price levels
        horizontalLevels,

        // A5. Draw Active Expansion Trace rays
        expansionRays,

        // A6. Draw BOS/MSS badges horizontally
        breachBadges,

        // B. Plot Major Swings (Hollow Circles at 5-Bar Fractals)
        // Differentiate: Confirmed = solid neon green/dimmed; Active Price Expansion = dotted amber
        showMajor &&
          mappedSwings
            .filter((s) => s.grade === 'MAJOR')
            .map((pt, idx) => {
              const isConfirmed = pt.confirmed !== false;
              return React.createElement('circle', {
                key: `major-swing-${idx}`,
                cx: pt.x,
                cy: pt.y,
                r: 4.5,
                stroke: isConfirmed
                  ? (pt.colorValidated ? 'var(--up-candle, #50ffaf)' : 'rgba(148, 163, 184, 0.4)')
                  : 'rgba(251, 191, 36, 0.85)',
                strokeWidth: isConfirmed ? (pt.colorValidated ? 1.5 : 0.8) : 1.2,
                strokeDasharray: isConfirmed ? undefined : '2,2',
                fill: 'none',
              });
            }),

        // C. Plot Inner Swings (Small Diamonds at 3-Bar Fractals)
        showInner &&
          mappedSwings
            .filter((s) => s.grade === 'INNER')
            .map((pt, idx) => {
              const pointsStr = `${pt.x},${pt.y - 3.5} ${pt.x + 3.5},${pt.y} ${pt.x},${pt.y + 3.5} ${pt.x - 3.5},${pt.y}`;
              return React.createElement('polygon', {
                key: `inner-swing-${idx}`,
                points: pointsStr,
                fill: 'var(--accent, #a855f7)',
                stroke: 'var(--accent, #a855f7)',
                strokeWidth: 1,
              });
            })
      )
    );
  },
};
