import type { ChartLayer } from '../types';

export const sessionsLayer: ChartLayer = {
  id: 'sessions',
  name: 'Session Ranges',
  description: 'Asian / London Killzone range boundaries & True Open',
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
    const macro = ipda.macro_levels || {};
    const tdo = macro.true_day_open || macro.true_day_open_0700 || null;
    const ranges = ipda.session_ranges || {};
    const asian = ranges.asian_range || {};
    const london = ranges.london_range || {};

    const newLines: any[] = [];

    // Draw True Day Open
    if (typeof tdo === 'number' && tdo > 0) {
      const line = series.createPriceLine({
        price: tdo,
        color: theme === 'dark' ? (themeSettings?.dark_chart_tdo || '#a855f7') : (themeSettings?.light_chart_tdo || '#4f46e5'),
        lineStyle: 0, // Solid
        lineWidth: 2,
        axisLabelVisible: true,
        title: 'TRUE DAY OPEN',
      });
      newLines.push(line);
    }

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
  }
};
