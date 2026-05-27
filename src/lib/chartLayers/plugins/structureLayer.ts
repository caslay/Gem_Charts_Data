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
  description: 'Swings, dealing ranges, and context-aware BOS/MSS Zig-Zag based on Color-Locked 5-Bar Fractals',
  icon: 'Activity',
  renderHtml(context) {
    const { activeCandles, chart, series, data } = context;
    if (!activeCandles || activeCandles.length < 5) return null;

    // 1. Fetch visibility states from Zustand store
    const { visibility } = useLayerStore.getState();
    const showParent = visibility.structure !== false;
    const showMajor = visibility.structure_major !== false;
    const showInner = visibility.structure_inner !== false;
    const showZigZag = visibility.structure_zigzag !== false;

    // If the main layer is hidden, do not render any children
    if (!showParent) return null;

    const timeScale = chart.timeScale();

    // 2. Fetch the pre-calculated, stabilized structural analysis state from context
    const analysis = (context as any).structureState;
    if (!analysis) return null;

    // 3. Pixel Coordinate Conversion — Map swings to SVG coordinates
    const mappedSwings: MappedPoint[] = [];
    for (const pt of analysis.swings) {
      const x = timeScale.timeToCoordinate(Math.floor(pt.t / 1000) as any);
      const y = series.priceToCoordinate(pt.price);
      if (x !== null && y !== null) {
        mappedSwings.push({ ...pt, x, y });
      }
    }

    // 4. Pixel Coordinate Conversion — Map major zig-zag segments
    const mappedSegments: MappedSegment[] = [];
    for (const seg of analysis.zigzag) {
      const fromX = timeScale.timeToCoordinate(Math.floor(seg.from.t / 1000) as any);
      const fromY = series.priceToCoordinate(seg.from.price);
      const toX = timeScale.timeToCoordinate(Math.floor(seg.to.t / 1000) as any);
      const toY = series.priceToCoordinate(seg.to.price);
      if (fromX !== null && fromY !== null && toX !== null && toY !== null) {
        mappedSegments.push({ ...seg, fromX, fromY, toX, toY });
      }
    }

    // 4b. Pixel Coordinate Conversion — Map inner sub-wave zig-zag segments
    const mappedInnerSegments: MappedSegment[] = [];
    if (analysis.innerZigzag) {
      for (const seg of analysis.innerZigzag) {
        const fromX = timeScale.timeToCoordinate(Math.floor(seg.from.t / 1000) as any);
        const fromY = series.priceToCoordinate(seg.from.price);
        const toX = timeScale.timeToCoordinate(Math.floor(seg.to.t / 1000) as any);
        const toY = series.priceToCoordinate(seg.to.price);
        if (fromX !== null && fromY !== null && toX !== null && toY !== null) {
          mappedInnerSegments.push({ ...seg, fromX, fromY, toX, toY });
        }
      }
    }

    // 5. Native SVG Canvas Assembly
    return React.createElement(
      'div',
      { className: 'absolute inset-0 pointer-events-none z-[2] overflow-hidden' },
      React.createElement(
        'svg',
        { className: 'w-full h-full' },
        
        // A1. Draw Inner Sub-Wave Zig-Zag Path (Muted, Dashed)
        showZigZag && showInner &&
          mappedInnerSegments.map((seg, idx) => {
            return React.createElement('line', {
              key: `inner-zz-segment-${idx}`,
              x1: seg.fromX,
              y1: seg.fromY,
              x2: seg.toX,
              y2: seg.toY,
              stroke: 'rgba(168, 85, 247, 0.35)', // Muted transparent purple
              strokeWidth: 1.0,
              strokeDasharray: '3,3',
            });
          }),

        // A2. Draw Major Zig-Zag Path Segments (Context-Aware BOS/MSS)
        showZigZag &&
          mappedSegments.map((seg, idx) => {
            // ── Visual Styling based on classification ──
            // BOS (continuation): dashed purple, standard weight
            // MSS confirmed (reversal + displacement): solid neon green, bold
            // MSS unconfirmed (reversal, no displacement): dashed amber, caution
            // INTERNAL (first segment / no classification): thin dotted grey
            let color: string;
            let strokeWidth: number;
            let strokeDash: string | undefined;
            let badgeLabel: string | null = null;
            let badgeColor: string;

            switch (seg.label) {
              case 'BOS':
                color = 'rgba(168, 85, 247, 0.55)'; // purple
                strokeWidth = 1.0;
                strokeDash = '3,3';
                badgeLabel = 'BOS';
                badgeColor = 'rgba(168, 85, 247, 0.85)';
                break;
              case 'MSS':
                if (seg.displacementConfirmed) {
                  color = 'var(--up-candle, #50ffaf)'; // neon green — confirmed
                  strokeWidth = 1.8;
                  strokeDash = undefined; // solid
                  badgeLabel = 'MSS';
                  badgeColor = 'var(--up-candle, #50ffaf)';
                } else {
                  color = 'rgba(251, 191, 36, 0.65)'; // amber — unconfirmed
                  strokeWidth = 1.2;
                  strokeDash = '4,2';
                  badgeLabel = 'MSS?';
                  badgeColor = 'rgba(251, 191, 36, 0.85)';
                }
                break;
              default: // INTERNAL
                color = 'rgba(148, 163, 184, 0.3)'; // muted grey
                strokeWidth = 0.8;
                strokeDash = '2,4';
                badgeLabel = null;
                badgeColor = 'transparent';
                break;
            }

            const midX = (seg.fromX + seg.toX) / 2;
            const midY = (seg.fromY + seg.toY) / 2;

            return React.createElement(
              'g',
              { key: `zz-segment-${idx}` },
              // Draw the segment line
              React.createElement('line', {
                x1: seg.fromX,
                y1: seg.fromY,
                x2: seg.toX,
                y2: seg.toY,
                stroke: color,
                strokeWidth: strokeWidth,
                strokeDasharray: strokeDash,
              }),
              
              // Draw label badge on BOS/MSS points
              badgeLabel &&
                React.createElement(
                  'g',
                  null,
                  React.createElement('rect', {
                    x: midX - 14,
                    y: midY - 11,
                    width: seg.label === 'MSS' && !seg.displacementConfirmed ? 28 : 24,
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
                      x: midX,
                      y: midY - 4.5,
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
          }),

        // B. Plot Major Swings (Hollow Circles at 5-Bar Fractals)
        // Color-validated = bright neon green; unvalidated = dimmed outline
        showMajor &&
          mappedSwings
            .filter((s) => s.grade === 'MAJOR')
            .map((pt, idx) =>
              React.createElement('circle', {
                key: `major-swing-${idx}`,
                cx: pt.x,
                cy: pt.y,
                r: 4.5,
                stroke: pt.colorValidated
                  ? 'var(--up-candle, #50ffaf)'
                  : 'rgba(148, 163, 184, 0.4)',
                strokeWidth: pt.colorValidated ? 1.5 : 0.8,
                fill: 'none',
              })
            ),

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
