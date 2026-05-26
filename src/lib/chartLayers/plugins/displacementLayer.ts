import type { ChartLayer } from '../types';
import { generateVolumetricMarkers } from '@/utils/generateChartMarkers';

export const displacementLayer: ChartLayer = {
  id: 'displacement',
  name: 'Displacement Signals',
  description: 'MSS, Institutional Sponsorship, and SMT divergence markers',
  icon: 'TrendingUp',
  renderChart(context) {
    const { seriesMarkers, activeCandles, theme, storage } = context;
    const isDark = theme === 'dark';

    if (seriesMarkers) {
      // Draw markers using the volumetric generator
      const sortedData = [...activeCandles].sort((a, b) => a.t - b.t);
      const markers = generateVolumetricMarkers(sortedData, isDark);

      // Set markers on the series
      seriesMarkers.setMarkers(markers);
      storage.set('hasMarkers', true);
    }
  },
  clearChart(context) {
    const { seriesMarkers, storage } = context;
    if (seriesMarkers && storage.get('hasMarkers')) {
      seriesMarkers.setMarkers([]);
      storage.delete('hasMarkers');
    }
  }
};
