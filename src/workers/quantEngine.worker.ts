/* eslint-disable no-restricted-globals */
import { analyzeMarketStructure } from '../lib/structureEngine';
import { annotateCandlesWithVolumetricSignals } from '../utils/generateChartMarkers';

addEventListener('message', (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type === 'ANALYZE_STRUCTURE') {
    try {
      const { candles, currentPrice, displacementStatus, contextAnchorTimestamp, globalAnchors, config } = payload;
      
      // 1. Copy and annotate candles with volumetric signals in worker thread
      const annotatedCandles = annotateCandlesWithVolumetricSignals([...candles]);

      // 2. Perform centralized structural analysis
      const analysis = analyzeMarketStructure(
        annotatedCandles,
        currentPrice,
        displacementStatus,
        contextAnchorTimestamp,
        globalAnchors,
        config
      );

      postMessage({
        type: 'STRUCTURE_RESULT',
        payload: {
          analysis,
          annotatedCandles
        }
      });
    } catch (err: any) {
      postMessage({
        type: 'ERROR',
        error: err.message || 'Worker analysis failed'
      });
    }
  }
});
