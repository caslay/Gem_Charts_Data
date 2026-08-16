/* eslint-disable @typescript-eslint/no-explicit-any */
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
  /** The global engine core configuration settings */
  engineSettings?: any;
}

export interface ChartLayer {
  /** Uniquely identifies this visual layer (e.g. 'fvg') */
  id: string;
  /** Human-readable display label */
  name: string;
  /** Optional compact HUD label (e.g. 'OB', 'FVG', 'LIQ') */
  shortName?: string;
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

export interface QuantLabRun {
  id: string;
  name: string;
  strategy_config: any;
  symbol: string;
  start_date: string;
  end_date: string;
  initial_balance: number;
  final_balance: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate_pct: number;
  total_pnl: number;
  created_at?: string;
}

export interface QuantLabTrade {
  id: string;
  run_id: string;
  timestamp: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price: number | null;
  stop_loss: number;
  take_profit: number;
  realized_pnl: number | null;
  roi: number | null;
  position_size: number;
  status: 'OPEN' | 'CLOSED';
  exit_timestamp: string | null;
  logic_trigger: string | null;
  ipda_metrics_at_entry: {
    trend: string;
    ols_p_value: number;
    displacement: number;
    premium_discount_status: string;
  };
  created_at?: string;
}

