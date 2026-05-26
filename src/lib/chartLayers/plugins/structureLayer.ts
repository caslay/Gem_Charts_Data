import React from 'react';
import type { ChartLayer } from '../types';
import { useLayerStore } from '../store';

interface MappedPoint {
  t: number;
  price: number;
  type: 'HIGH' | 'LOW';
  isMajor: boolean;
  x: number;
  y: number;
}

export const structureLayer: ChartLayer = {
  id: 'structure',
  name: 'Market Structure',
  description: 'Swings, dealing ranges, and BOS/MSS Zig-Zag paths based on 5-Bar Fractals',
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
    
    // Fetch local dealing range info for boundary sweeps (j < 2 fallback)
    const pricing = data.ipda_metrics?.pricing_context || {};
    const ldr = pricing.local_dealing_range || {};
    const idHigh = ldr.high || null;
    const idLow = ldr.low || null;

    // 2. Pure price extreme Fractal Detection Loop (Decoupled from color lock or visual flags)
    const points: { t: number; price: number; type: 'HIGH' | 'LOW'; isMajor: boolean }[] = [];

    for (let i = 2; i < activeCandles.length - 2; i++) {
      const c2Prev = activeCandles[i - 2];
      const prev = activeCandles[i - 1];
      const curr = activeCandles[i];
      const next = activeCandles[i + 1];
      const c2Next = activeCandles[i + 2];

      // A. Swing High Check (Pure 5-Bar Extreme vs 3-Bar Extreme, no color locks)
      const is5BarHigh = curr.h > prev.h && curr.h > c2Prev.h && curr.h > next.h && curr.h > c2Next.h;
      if (is5BarHigh) {
        points.push({
          t: curr.t,
          price: curr.h,
          type: 'HIGH',
          isMajor: true,
        });
        continue;
      }

      const is3BarHigh = curr.h > prev.h && curr.h > next.h;
      if (is3BarHigh) {
        points.push({
          t: curr.t,
          price: curr.h,
          type: 'HIGH',
          isMajor: false,
        });
        continue;
      }

      // B. Swing Low Check (Pure 5-Bar Extreme vs 3-Bar Extreme, no color locks)
      const is5BarLow = curr.l < prev.l && curr.l < c2Prev.l && curr.l < next.l && curr.l < c2Next.l;
      if (is5BarLow) {
        points.push({
          t: curr.t,
          price: curr.l,
          type: 'LOW',
          isMajor: true,
        });
        continue;
      }

      const is3BarLow = curr.l < prev.l && curr.l < next.l;
      if (is3BarLow) {
        points.push({
          t: curr.t,
          price: curr.l,
          type: 'LOW',
          isMajor: false,
        });
        continue;
      }
    }

    // Sort detected points by chronological time
    points.sort((a, b) => a.t - b.t);

    // 3. Alternating Zig-Zag Path Constructor (Restricted STRICTLY to Major 5-Bar Swings)
    const majorPoints = points.filter((pt) => pt.isMajor);
    const zigZagPoints: typeof points = [];
    for (const pt of majorPoints) {
      if (zigZagPoints.length === 0) {
        zigZagPoints.push(pt);
        continue;
      }
      const lastPt = zigZagPoints[zigZagPoints.length - 1];
      if (lastPt.type === pt.type) {
        // If consecutive swings are of the same type, retain only the more extreme level
        if (pt.type === 'HIGH') {
          if (pt.price > lastPt.price) {
            zigZagPoints[zigZagPoints.length - 1] = pt; // replace with higher high
          }
        } else {
          if (pt.price < lastPt.price) {
            zigZagPoints[zigZagPoints.length - 1] = pt; // replace with lower low
          }
        }
      } else {
        zigZagPoints.push(pt);
      }
    }

    // 4. Pixel Coordinate Conversion (Map values to SVG coordinates)
    const mappedSwings: MappedPoint[] = [];
    for (const pt of points) {
      const x = timeScale.timeToCoordinate(Math.floor(pt.t / 1000) as any);
      const y = series.priceToCoordinate(pt.price);
      if (x !== null && y !== null) {
        mappedSwings.push({ ...pt, x, y });
      }
    }

    const mappedZigZag: MappedPoint[] = [];
    for (const pt of zigZagPoints) {
      const x = timeScale.timeToCoordinate(Math.floor(pt.t / 1000) as any);
      const y = series.priceToCoordinate(pt.price);
      if (x !== null && y !== null) {
        mappedZigZag.push({ ...pt, x, y });
      }
    }

    // 5. Native SVG Canvas Assembly
    return React.createElement(
      'div',
      { className: 'absolute inset-0 pointer-events-none z-[2] overflow-hidden' },
      React.createElement(
        'svg',
        { className: 'w-full h-full' },
        
        // A. Draw Zig-Zag Path Segments (Strictly 5-Bar)
        showZigZag &&
          mappedZigZag.map((pt, idx) => {
            if (idx === 0) return null;
            const A = mappedZigZag[idx - 1];
            const B = pt;

            // Classify if the expansion breaks historical structures (MSS/BOS)
            let isMssBos = false;
            if (idx >= 2) {
              const prevPeakTrough = mappedZigZag[idx - 2];
              if (B.type === 'HIGH') {
                if (B.price > prevPeakTrough.price) isMssBos = true;
              } else {
                if (B.price < prevPeakTrough.price) isMssBos = true;
              }
            } else {
              // Boundary Sweep checks anchored to the structural local dealing range
              if (B.type === 'HIGH' && idHigh && B.price >= idHigh) isMssBos = true;
              if (B.type === 'LOW' && idLow && B.price <= idLow) isMssBos = true;
            }

            // High-contrast, sleek HFT styling
            const color = isMssBos ? 'var(--up-candle, #50ffaf)' : 'rgba(168, 85, 247, 0.45)';
            const strokeWidth = isMssBos ? 1.5 : 1.0;
            const strokeDash = isMssBos ? undefined : '3,3';

            const midX = (A.x + B.x) / 2;
            const midY = (A.y + B.y) / 2;

            return React.createElement(
              'g',
              { key: `zz-segment-${idx}` },
              // Draw the segment line
              React.createElement('line', {
                x1: A.x,
                y1: A.y,
                x2: B.x,
                y2: B.y,
                stroke: color,
                strokeWidth: strokeWidth,
                strokeDasharray: strokeDash,
              }),
              
              // Draw small glassmorphic badge on BOS/MSS points
              isMssBos &&
                React.createElement(
                  'g',
                  null,
                  React.createElement('rect', {
                    x: midX - 12,
                    y: midY - 11,
                    width: 24,
                    height: 9,
                    rx: 2,
                    fill: 'var(--background, #020617)',
                    stroke: 'var(--up-candle, #50ffaf)',
                    strokeWidth: 0.5,
                    opacity: 0.9,
                  }),
                  React.createElement(
                    'text',
                    {
                      x: midX,
                      y: midY - 4.5,
                      fill: 'var(--up-candle, #50ffaf)',
                      fontSize: '6.5',
                      fontFamily: 'monospace',
                      fontWeight: 'bold',
                      textAnchor: 'middle',
                    },
                    B.type === 'HIGH' ? 'BOS' : 'MSS'
                  )
                )
            );
          }),

        // B. Plot Major Swings (Hollow Circles at 5-Bar Fractals)
        showMajor &&
          mappedSwings
            .filter((s) => s.isMajor)
            .map((pt, idx) =>
              React.createElement('circle', {
                key: `major-swing-${idx}`,
                cx: pt.x,
                cy: pt.y,
                r: 4.5,
                stroke: 'var(--up-candle, #50ffaf)',
                strokeWidth: 1.5,
                fill: 'none',
              })
            ),

        // C. Plot Inner Swings (Small Diamonds at 3-Bar Fractals)
        showInner &&
          mappedSwings
            .filter((s) => !s.isMajor)
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
