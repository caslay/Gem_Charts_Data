import type { ChartLayer } from '../types';
import { generateVolumetricMarkers } from '@/utils/generateChartMarkers';

export const displacementLayer: ChartLayer = {
  id: 'displacement',
  name: 'Displacement Signals',
  description: 'MSS, Institutional Sponsorship, and SMT divergence markers',
  icon: 'TrendingUp',
  renderChart(context) {
    const { seriesMarkers, activeCandles, theme, themeSettings, storage, engineSettings, data } = context;

    if (seriesMarkers) {
      // Resolve dynamic customizer colors
      const sponsorshipColor = theme === 'dark'
        ? (themeSettings?.dark_text_title || '#ffffff')
        : (themeSettings?.light_text_title || '#020617');

      const bullishSweepColor = theme === 'dark'
        ? (themeSettings?.dark_chart_swing_low || '#50ffaf')
        : (themeSettings?.light_chart_swing_low || '#059669');

      const bearishSweepColor = theme === 'dark'
        ? (themeSettings?.dark_chart_swing_high || '#ffb4ab')
        : (themeSettings?.light_chart_swing_high || '#e11d48');

      const volumetricStrongArrowColor = theme === 'dark'
        ? (themeSettings?.dark_chart_volumetric_strong_arrow || '#ff007f')
        : (themeSettings?.light_chart_volumetric_strong_arrow || '#e11d48');

      // Draw markers using the volumetric generator
      const sortedData = [...activeCandles].sort((a, b) => a.t - b.t);
      const markers = generateVolumetricMarkers(
        sortedData,
        {
          sponsorshipColor,
          bullishSweepColor,
          bearishSweepColor,
          volumetricStrongArrowColor,
          theme,
          visualizePerfectMovementOnly: engineSettings?.visualizePerfectMovementOnly ?? false,
          marketData: data,
          structureState: context.structureState,
          pmAtrMultiplier: engineSettings?.pmAtrMultiplier,
          pmVolumeSmaPeriod: engineSettings?.pmVolumeSmaPeriod,
          pmMinBodyRatio: engineSettings?.pmMinBodyRatio,
          pmMaxWickRatio: engineSettings?.pmMaxWickRatio,
          pmMaxRetracementLimit: engineSettings?.pmMaxRetracementLimit,
          pmSweepLookback: engineSettings?.pmSweepLookback,
        }
      );

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
