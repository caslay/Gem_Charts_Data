import type { ChartLayer } from '../types';

export const magnetsLayer: ChartLayer = {
  id: 'magnets',
  name: 'Liquidity Magnets',
  description: 'Resting order book liquidity levels (BSL/SSL)',
  icon: 'Magnet',
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
    const orderFlow = ipda.order_flow_engine || {};
    const bsl = orderFlow.resting_liquidity_pools?.BSL_Magnets || [];
    const ssl = orderFlow.resting_liquidity_pools?.SSL_Magnets || [];

    const newLines: any[] = [];

    // Render BSL magnets
    bsl.forEach((price: number, idx: number) => {
      const line = series.createPriceLine({
        price,
        color: theme === 'dark' ? (themeSettings?.dark_chart_magnet_bsl || 'rgba(255, 180, 171, 0.45)') : (themeSettings?.light_chart_magnet_bsl || 'rgba(225, 29, 72, 0.45)'),
        lineStyle: 2, // Dashed
        lineWidth: 1,
        axisLabelVisible: true,
        title: `BSL MAGNET #${idx + 1}`,
      });
      newLines.push(line);
    });

    // Render SSL magnets
    ssl.forEach((price: number, idx: number) => {
      const line = series.createPriceLine({
        price,
        color: theme === 'dark' ? (themeSettings?.dark_chart_magnet_ssl || 'rgba(80, 255, 175, 0.45)') : (themeSettings?.light_chart_magnet_ssl || 'rgba(5, 150, 105, 0.45)'),
        lineStyle: 2, // Dashed
        lineWidth: 1,
        axisLabelVisible: true,
        title: `SSL MAGNET #${idx + 1}`,
      });
      newLines.push(line);
    });

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
