import React from 'react';
import type { ChartLayer } from '../types';

export const sessionsLayer: ChartLayer = {
  id: 'sessions',
  name: 'Session Ranges',
  shortName: 'SESSION',
  description: 'Asian / London Killzone range boundaries',
  icon: 'Clock',
  renderChart(context) {
    const { series, data, theme, themeSettings, storage } = context;

    // Clear old lines
    const oldLines = storage.get('lines') || [];
    oldLines.forEach((line: any) => {
      try {
        series.removePriceLine(line);
      } catch {}
    });
    storage.delete('lines');

    const ipda = data.ipda_metrics || {};
    const ranges = ipda.session_ranges || {};
    const asian = ranges.asian_range || {};
    const london = ranges.london_range || {};

    const newLines: any[] = [];

    // Draw Asian High/Low
    if (typeof asian.high === 'number' && asian.high > 0) {
      const line = series.createPriceLine({
        price: asian.high,
        color: theme === 'dark' ? (themeSettings?.dark_chart_session_asian || 'rgba(245, 158, 11, 0.5)') : (themeSettings?.light_chart_session_asian || 'rgba(217, 119, 6, 0.5)'),
        lineStyle: 2,
        lineWidth: 1,
        axisLabelVisible: true,
        title: 'ASIAN HIGH',
      });
      newLines.push(line);
    }
    if (typeof asian.low === 'number' && asian.low > 0) {
      const line = series.createPriceLine({
        price: asian.low,
        color: theme === 'dark' ? (themeSettings?.dark_chart_session_asian || 'rgba(245, 158, 11, 0.5)') : (themeSettings?.light_chart_session_asian || 'rgba(217, 119, 6, 0.5)'),
        lineStyle: 2,
        lineWidth: 1,
        axisLabelVisible: true,
        title: 'ASIAN LOW',
      });
      newLines.push(line);
    }

    // Draw London High/Low
    if (typeof london.high === 'number' && london.high > 0) {
      const line = series.createPriceLine({
        price: london.high,
        color: theme === 'dark' ? (themeSettings?.dark_chart_session_london || 'rgba(59, 130, 246, 0.5)') : (themeSettings?.light_chart_session_london || 'rgba(37, 99, 235, 0.5)'),
        lineStyle: 2,
        lineWidth: 1,
        axisLabelVisible: true,
        title: 'LONDON HIGH',
      });
      newLines.push(line);
    }
    if (typeof london.low === 'number' && london.low > 0) {
      const line = series.createPriceLine({
        price: london.low,
        color: theme === 'dark' ? (themeSettings?.dark_chart_session_london || 'rgba(59, 130, 246, 0.5)') : (themeSettings?.light_chart_session_london || 'rgba(37, 99, 235, 0.5)'),
        lineStyle: 2,
        lineWidth: 1,
        axisLabelVisible: true,
        title: 'LONDON LOW',
      });
      newLines.push(line);
    }

    storage.set('lines', newLines);
  },
  clearChart(context) {
    const { series, storage } = context;
    const oldLines = storage.get('lines') || [];
    oldLines.forEach((line: any) => {
      try {
        series.removePriceLine(line);
      } catch {}
    });
    storage.delete('lines');
  },
  renderHtml(context) {
    const { activeCandles, chart, series, theme, themeSettings } = context;
    if (!activeCandles || activeCandles.length < 2) return null;

    // 1. Group active candles by calendar day in UTC
    interface SessionGroup {
      candles: any[];
      firstCandle: any;
      lastCandle: any;
      high: number;
      low: number;
    }

    const asianGroups: SessionGroup[] = [];
    const londonGroups: SessionGroup[] = [];

    // Group candles by UTC calendar day string: "YYYY-MM-DD"
    const candlesByDay = new Map<string, any[]>();
    activeCandles.forEach(c => {
      const date = new Date(c.t);
      const dayStr = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
      if (!candlesByDay.has(dayStr)) {
        candlesByDay.set(dayStr, []);
      }
      candlesByDay.get(dayStr)!.push(c);
    });

    // For each calendar day, partition candles into Cairo (Asian) and London session brackets
    candlesByDay.forEach((dayCandles) => {
      const asianCandles = dayCandles.filter(c => {
        const date = new Date(c.t);
        const hour = date.getUTCHours();
        return hour >= 0 && hour < 7;
      });

      const londonCandles = dayCandles.filter(c => {
        const date = new Date(c.t);
        const hour = date.getUTCHours();
        return hour >= 7 && hour < 12;
      });

      if (asianCandles.length > 0) {
        const highs = asianCandles.map(c => c.h);
        const lows = asianCandles.map(c => c.l);
        asianGroups.push({
          candles: asianCandles,
          firstCandle: asianCandles[0],
          lastCandle: asianCandles[asianCandles.length - 1],
          high: Math.max(...highs),
          low: Math.min(...lows)
        });
      }

      if (londonCandles.length > 0) {
        const highs = londonCandles.map(c => c.h);
        const lows = londonCandles.map(c => c.l);
        londonGroups.push({
          candles: londonCandles,
          firstCandle: londonCandles[0],
          lastCandle: londonCandles[londonCandles.length - 1],
          high: Math.max(...highs),
          low: Math.min(...lows)
        });
      }
    });

    const timeScale = chart.timeScale();
    const barSpacing = timeScale.options().barSpacing || 6;
    const boxes: React.ReactNode[] = [];

    const lastCandle = activeCandles[activeCandles.length - 1];
    const rightCoord = timeScale.timeToCoordinate(Math.floor(lastCandle.t / 1000) as any);
    const rightX = rightCoord !== null ? rightCoord + 300 : 2500;

    // Helper to render box group with viewport culling
    const renderBox = (group: SessionGroup, type: 'cairo' | 'london', idx: number) => {
      const xStart = timeScale.timeToCoordinate(Math.floor(group.firstCandle.t / 1000) as any);
      const xEnd = timeScale.timeToCoordinate(Math.floor(group.lastCandle.t / 1000) as any);
      const yHigh = series.priceToCoordinate(group.high);
      const yLow = series.priceToCoordinate(group.low);

      if (xStart !== null && xEnd !== null && yHigh !== null && yLow !== null) {
        // Enclose the candles perfectly by expanding left/right by half-bar spacing
        const fromX = xStart - barSpacing / 2;
        const toX = xEnd + barSpacing / 2;

        // Viewport culling: cull session boxes outside the visible chart window
        if (toX < -50 || fromX > rightX + 50) return;

        const width = toX - fromX;
        const height = yLow - yHigh;

        if (width > 0 && height > 0) {
          const fill = type === 'cairo'
            ? (theme === 'dark' ? 'rgba(245, 158, 11, 0.03)' : 'rgba(217, 119, 6, 0.02)')
            : (theme === 'dark' ? 'rgba(59, 130, 246, 0.03)' : 'rgba(37, 99, 235, 0.02)');
          const stroke = type === 'cairo'
            ? (theme === 'dark' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(217, 119, 6, 0.12)')
            : (theme === 'dark' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(37, 99, 235, 0.12)');
          const textFill = type === 'cairo'
            ? (theme === 'dark' ? 'rgba(245, 158, 11, 0.55)' : 'rgba(217, 119, 6, 0.55)')
            : (theme === 'dark' ? 'rgba(59, 130, 246, 0.55)' : 'rgba(37, 99, 235, 0.55)');

          boxes.push(
            React.createElement(
              'g',
              { key: `${type}-session-box-${idx}-${group.firstCandle.t}` },
              // Rect Box
              React.createElement('rect', {
                x: fromX,
                y: yHigh,
                width: width,
                height: height,
                fill: fill,
                stroke: stroke,
                strokeWidth: 0.8,
                strokeDasharray: '3,3',
                rx: 3,
              }),
              // Session Title Label (Top-left inside box)
              React.createElement(
                'text',
                {
                  x: fromX + 6,
                  y: yHigh + 10,
                  fill: textFill,
                  fontSize: '6.5',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                },
                type === 'cairo' ? 'CAIRO (ASIA) SESSION' : 'LONDON SESSION'
              ),
              // Session Price Range Label (Bottom-left inside box)
              React.createElement(
                'text',
                {
                  x: fromX + 6,
                  y: yLow - 6,
                  fill: textFill,
                  fontSize: '5.5',
                  fontFamily: 'monospace',
                  opacity: 0.8,
                },
                `[${group.low.toFixed(2)} - ${group.high.toFixed(2)}]`
              )
            )
          );
        }
      }
    };

    asianGroups.forEach((g, idx) => renderBox(g, 'cairo', idx));
    londonGroups.forEach((g, idx) => renderBox(g, 'london', idx));

    if (boxes.length === 0) return null;

    return React.createElement(
      'div',
      { className: 'absolute inset-0 pointer-events-none z-[1] overflow-hidden' },
      React.createElement(
        'svg',
        { className: 'w-full h-full' },
        boxes
      )
    );
  }
};
