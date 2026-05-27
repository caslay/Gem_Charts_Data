import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { MarketDataPayload, Candle } from '@/hooks/useMarketData';
import type { ThemeSettings } from '@/hooks/useMarketData';

export interface RenderContext {
  /** The lightweight-charts IChartApi instance */
  chart: IChartApi;
  /** The candlestick series instance */
  series: ISeriesApi<"Candlestick">;
  /** The series markers plugin instance for volumetric signals */
  seriesMarkers?: any;
  /** The live enriched market data snapshot */
  data: MarketDataPayload;
  /** The candles of the currently selected visual timeframe */
  activeCandles: Candle[];
  /** The active visual theme name */
  theme: 'dark' | 'light';
  /** The dynamic Appearance studio theme override parameters */
  themeSettings?: ThemeSettings;
  /** A persistent private storage map scoped to this specific plugin instance */
  storage: Map<string, any>;
  /** The stabilized calculated structure state */
  structureState?: any;
  /** The stable lookback context anchor timestamp */
  contextAnchorTimestamp?: number | null;
}

export interface ChartLayer {
  /** Uniquely identifies this visual layer (e.g. 'fvg') */
  id: string;
  /** Human-readable display label */
  name: string;
  /** Short explanatory description */
  description: string;
  /** Lucide icon name for HUD rendering (e.g. 'Layers') */
  icon: string;
  /**
   * Execute lightweight-charts API drawings (price lines, markers, custom series)
   */
  renderChart?: (context: RenderContext) => void;
  /**
   * Clean up any lightweight-charts items created during renderChart
   */
  clearChart?: (context: RenderContext) => void;
  /**
   * Render custom React overlay boxes absolute-positioned on the canvas
   */
  renderHtml?: (context: RenderContext) => React.ReactNode;
}
