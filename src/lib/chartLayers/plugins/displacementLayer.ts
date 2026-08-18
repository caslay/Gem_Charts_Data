import type { ChartLayer } from '../types';
import { generateVolumetricMarkers } from '@/utils/generateChartMarkers';

export const displacementLayer: ChartLayer = {
  id: 'displacement',
  name: 'Displacement Signals',
  shortName: 'DISP',
  description: 'MSS, Institutional Sponsorship, and SMT divergence markers',
  icon: 'TrendingUp',
  renderChart(context) {
    const { seriesMarkers, activeCandles, theme, themeSettings, storage, engineSettings, data } = context;

    if (seriesMarkers && activeCandles && activeCandles.length > 0) {
      const isHighPerf = engineSettings?.highPerformanceMode ?? false;
      const lastClosedT = activeCandles[activeCandles.length - 2]?.t ?? activeCandles[activeCandles.length - 1]?.t;
      const swingsCount = context.structureState?.swings?.length ?? 0;
      const cacheKey = `${lastClosedT}_${activeCandles.length}_${theme}_${engineSettings?.visualizePerfectMovementOnly}_${engineSettings?.pmAtrMultiplier}_${engineSettings?.pmVolumeSmaPeriod}_${swingsCount}_${isHighPerf}`;

      // Reuse memoized markers if candle close timestamp and settings have not changed
      if (storage.get('cacheKey') === cacheKey && storage.has('cachedMarkers')) {
        const cached = storage.get('cachedMarkers');
        seriesMarkers.setMarkers(cached);
        storage.set('hasMarkers', true);
        return;
      }

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

      // Sort and slice data (in High Performance Mode, limit lookback to last 500 candles for max FPS)
      let sortedData = [...activeCandles].sort((a, b) => a.t - b.t);
      if (isHighPerf && sortedData.length > 500) {
        sortedData = sortedData.slice(sortedData.length - 500);
      }

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

      // Save to storage cache
      storage.set('cacheKey', cacheKey);
      storage.set('cachedMarkers', markers);

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
      storage.delete('cacheKey');
      storage.delete('cachedMarkers');
    }
  }
};
