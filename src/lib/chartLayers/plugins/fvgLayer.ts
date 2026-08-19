import React from 'react';
import type { ChartLayer } from '../types';

export const fvgLayer: ChartLayer = {
  id: 'fvg',
  name: 'Fair Value Gaps',
  shortName: 'FVG',
  description: 'Unmitigated institutional FVG zones',
  icon: 'Layers',
  renderHtml(context) {
    const { chart, series, data, theme, themeSettings } = context;
    
    const ipda = data.ipda_metrics || {};
    const activeFvgs = ipda.active_fvgs || [];
    if (activeFvgs.length === 0) return null;

    const layoutOptions = chart.options()?.layout as any;
    const timeScaleOptions = chart.timeScale().options() as any;
    const barSpacing = layoutOptions?.barSpacing ?? timeScaleOptions?.barSpacing ?? 6;
    const width = 9 * barSpacing;

    const boxes: React.ReactNode[] = [];

    for (const fvg of activeFvgs) {
      // Only render unmitigated zones
      if (fvg.status !== 'UNMITIGATED') continue;

      const topY = series.priceToCoordinate(fvg.top) as number | null;
      const bottomY = series.priceToCoordinate(fvg.bottom) as number | null;

      if (topY === null || bottomY === null) continue;

      // Starting X position: anchored to origin candle
      const timeSec = Math.floor(fvg.origin_time / 1000);
      const left = chart.timeScale().timeToCoordinate(timeSec as any);

      if (left === null) continue;

      // Viewport culling: Skip FVG boxes completely off-screen
      const lastCandle = context.activeCandles?.[context.activeCandles.length - 1];
      const rightCoord = lastCandle ? chart.timeScale().timeToCoordinate(Math.floor(lastCandle.t / 1000) as any) : null;
      const rightX = rightCoord !== null ? rightCoord + 300 : 2500;
      if (left + width < -50 || left > rightX + 50) continue;

      const pixelTop = Math.min(topY, bottomY);
      const height = Math.abs(topY - bottomY);

      if (height <= 0) continue;

      const isBullish = fvg.type === 'BULLISH';
      const color = isBullish
        ? (theme === 'dark' ? (themeSettings?.dark_chart_fvg_bullish || '#50ffaf') : (themeSettings?.light_chart_fvg_bullish || '#059669'))
        : (theme === 'dark' ? (themeSettings?.dark_chart_fvg_bearish || '#ffb4ab') : (themeSettings?.light_chart_fvg_bearish || '#e11d48'));

      boxes.push(
        React.createElement('div', {
          key: `${fvg.timeframe}_${fvg.type}_${fvg.top}_${fvg.bottom}_${fvg.origin_time}`,
          className: "absolute pointer-events-none z-[1] transition-all duration-150",
          style: {
            top: `${pixelTop}px`,
            height: `${height}px`,
            left: `${left}px`,
            width: `${width}px`,
            backgroundColor: color,
            opacity: 0.2,
            border: `0.3px solid ${color}`,
          }
        })
      );
    }

    return React.createElement(React.Fragment, null, ...boxes);
  }
};
