import { useState, useEffect, useCallback, useRef } from 'react';
import { slicePayloadByLookback } from '@/components/Sidebar';
import { SYSTEM_VERSION } from '@/lib/version';
import { useLiveAlerts } from './useLiveAlerts';
import { useAIAnalysis } from './useAIAnalysis';
import { Candle } from '@/lib/fvgEngine';
import { analyzeMarketStructure, MarketStructureAnalysis } from '@/lib/structureEngine';
import type { LiveCandle, ClosedCandleEvent } from './useBinanceWS';
import { MTFTelemetryEngine, MTFTelemetrySummary } from '@/lib/quantEngine/MTFTelemetryEngine';
import { verifyDisplacementOffline } from '@/lib/displacementEngine';
export type { Candle };

export interface SignalAlerts {
  FVG_DETECTION: string;
  DISPLACEMENT_CONFIRMED: string;
  SMT_TRAP_ACTIVE: string;
  DOL_EXHAUSTED: string;
  SESSION_TRANSITION: string;
  PRICING_SHIFT: string;
  SWEEP_ALERT: string;
  FLOW_STATE_CHANGE: string;
  DEAD_ZONE_ENTER: string;
  STRATEGY_MATCHED?: string;
  LIVE_OB_DETECTED?: string;
  IN_ZONE_CONFIRMATION_PENDING?: string;
  AUTO_ORDER_ROUTED?: string;
  STAGE_FILL?: string;
}

export interface SignalAlertsEnabled {
  FVG_DETECTION: boolean;
  DISPLACEMENT_CONFIRMED: boolean;
  SMT_TRAP_ACTIVE: boolean;
  DOL_EXHAUSTED: boolean;
  SESSION_TRANSITION: boolean;
  PRICING_SHIFT: boolean;
  SWEEP_ALERT: boolean;
  FLOW_STATE_CHANGE: boolean;
  DEAD_ZONE_ENTER: boolean;
  STRATEGY_MATCHED?: boolean;
  LIVE_OB_DETECTED?: boolean;
  IN_ZONE_CONFIRMATION_PENDING?: boolean;
  AUTO_ORDER_ROUTED?: boolean;
  STAGE_FILL?: boolean;
}

const DEFAULT_SIGNAL_ALERTS: SignalAlerts = {
  FVG_DETECTION: "fvg_alert.mp3",
  DISPLACEMENT_CONFIRMED: "flow_state.wav",
  SMT_TRAP_ACTIVE: "smt_trap.wav",
  DOL_EXHAUSTED: "objective_update.wav",
  SESSION_TRANSITION: "session_transition.wav",
  PRICING_SHIFT: "pricing_shift.wav",
  SWEEP_ALERT: "sweep_alert.mp3",
  FLOW_STATE_CHANGE: "flow_state.wav",
  DEAD_ZONE_ENTER: "dead_zone.mp3",
  STRATEGY_MATCHED: "fvg_alert.mp3",
  LIVE_OB_DETECTED: "flow_state.wav",
  IN_ZONE_CONFIRMATION_PENDING: "session_transition.wav",
  AUTO_ORDER_ROUTED: "sweep_alert.mp3",
  STAGE_FILL: "objective_update.wav",
};

const DEFAULT_SIGNAL_ALERTS_ENABLED: SignalAlertsEnabled = {
  FVG_DETECTION: true,
  DISPLACEMENT_CONFIRMED: true,
  SMT_TRAP_ACTIVE: true,
  DOL_EXHAUSTED: true,
  SESSION_TRANSITION: true,
  PRICING_SHIFT: true,
  SWEEP_ALERT: true,
  FLOW_STATE_CHANGE: true,
  DEAD_ZONE_ENTER: true,
  STRATEGY_MATCHED: true,
  LIVE_OB_DETECTED: true,
  IN_ZONE_CONFIRMATION_PENDING: true,
  AUTO_ORDER_ROUTED: true,
  STAGE_FILL: true,
};

export interface ThemeSettings {
  dark_bg: string;
  dark_card: string;
  dark_accent: string;
  dark_up_candle: string;
  dark_down_candle: string;
  dark_card_opacity: number;
  
  // Phase 2 Interactive & Typography Customizations
  dark_interactive_default: string;
  dark_interactive_active: string;
  dark_interactive_hover: string;
  dark_text_title: string;
  dark_text_label: string;
  dark_text_value: string;
  dark_highlight_up: string;
  dark_highlight_down: string;

  // Header Customizations
  dark_header_bg: string;
  dark_header_border: string;
  dark_header_text: string;
  dark_header_icon: string;
  dark_header_link_idle: string;
  dark_header_link_hover: string;
  dark_header_link_active: string;
  dark_header_link_active_bg: string;

  // Chart Customizations
  dark_chart_grid: string;
  dark_chart_border: string;
  dark_chart_text: string;
  dark_chart_swing_high: string;
  dark_chart_swing_low: string;
  dark_chart_swing_high_internal: string;
  dark_chart_swing_low_internal: string;
  dark_chart_bos: string;
  dark_chart_mss: string;
  dark_chart_fvg_bullish: string;
  dark_chart_fvg_bearish: string;
  dark_chart_tdo: string;
  dark_chart_session_asian: string;
  dark_chart_session_london: string;
  dark_chart_magnet_bsl: string;
  dark_chart_magnet_ssl: string;
  dark_chart_volumetric_strong_arrow: string;

  // UI Button Variations
  dark_btn_solid_bg: string;
  dark_btn_solid_bg_hover: string;
  dark_btn_solid_text: string;
  dark_btn_trans_border: string;
  dark_btn_trans_bg_hover: string;
  dark_btn_trans_text: string;

  // Sidebar Typography Customizations
  dark_text_sidebar_title: string;
  dark_text_sidebar_label: string;
  dark_text_sidebar_value: string;
  dark_text_sidebar_notes: string;

  light_bg: string;
  light_card: string;
  light_accent: string;
  light_up_candle: string;
  light_down_candle: string;
  light_card_opacity: number;

  // Phase 2 Interactive & Typography Customizations
  light_interactive_default: string;
  light_interactive_active: string;
  light_interactive_hover: string;
  light_text_title: string;
  light_text_label: string;
  light_text_value: string;
  light_highlight_up: string;
  light_highlight_down: string;

  // Header Customizations
  light_header_bg: string;
  light_header_border: string;
  light_header_text: string;
  light_header_icon: string;
  light_header_link_idle: string;
  light_header_link_hover: string;
  light_header_link_active: string;
  light_header_link_active_bg: string;

  // Chart Customizations
  light_chart_grid: string;
  light_chart_border: string;
  light_chart_text: string;
  light_chart_swing_high: string;
  light_chart_swing_low: string;
  light_chart_swing_high_internal: string;
  light_chart_swing_low_internal: string;
  light_chart_bos: string;
  light_chart_mss: string;
  light_chart_fvg_bullish: string;
  light_chart_fvg_bearish: string;
  light_chart_tdo: string;
  light_chart_session_asian: string;
  light_chart_session_london: string;
  light_chart_magnet_bsl: string;
  light_chart_magnet_ssl: string;
  light_chart_volumetric_strong_arrow: string;

  // UI Button Variations
  light_btn_solid_bg: string;
  light_btn_solid_bg_hover: string;
  light_btn_solid_text: string;
  light_btn_trans_border: string;
  light_btn_trans_bg_hover: string;
  light_btn_trans_text: string;

  // Sidebar Typography Customizations
  light_text_sidebar_title: string;
  light_text_sidebar_label: string;
  light_text_sidebar_value: string;
  light_text_sidebar_notes: string;
  structure_istr_atr_multiplier: string;
  theme_manual_entry_line: string;
  theme_manual_tp_line: string;
  theme_manual_sl_line: string;
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  dark_bg: '#020617',
  dark_card: '#0f172a',
  dark_accent: '#a855f7',
  dark_up_candle: '#50ffaf',
  dark_down_candle: '#ffb4ab',
  dark_card_opacity: 90,
  
  dark_interactive_default: '#94a3b8',
  dark_interactive_active: '#a855f7',
  dark_interactive_hover: '#ffffff',
  dark_text_title: '#ffffff',
  dark_text_label: '#64748b',
  dark_text_value: '#f8fafc',
  dark_highlight_up: '#50ffaf',
  dark_highlight_down: '#ffb4ab',

  // Header Customizations (Midnight)
  dark_header_bg: '#0f172a',
  dark_header_border: '#1e293b',
  dark_header_text: '#ffffff',
  dark_header_icon: '#94a3b8',
  dark_header_link_idle: '#64748b',
  dark_header_link_hover: '#ffffff',
  dark_header_link_active: '#ffffff',
  dark_header_link_active_bg: '#a855f7',

  // Chart Customizations (Midnight)
  dark_chart_grid: 'rgba(255, 255, 255, 0.05)',
  dark_chart_border: 'rgba(255, 255, 255, 0.08)',
  dark_chart_text: '#94a3b8',
  dark_chart_swing_high: 'rgba(239, 68, 68, 0.85)',
  dark_chart_swing_low: 'rgba(80, 255, 175, 0.85)',
  dark_chart_swing_high_internal: 'rgba(239, 68, 68, 0.45)',
  dark_chart_swing_low_internal: 'rgba(80, 255, 175, 0.45)',
  dark_chart_bos: 'rgba(168, 85, 247, 0.85)',
  dark_chart_mss: 'rgba(80, 255, 175, 0.85)',
  dark_chart_fvg_bullish: '#50ffaf',
  dark_chart_fvg_bearish: '#ffb4ab',
  dark_chart_tdo: '#a855f7',
  dark_chart_session_asian: 'rgba(245, 158, 11, 0.5)',
  dark_chart_session_london: 'rgba(59, 130, 246, 0.5)',
  dark_chart_magnet_bsl: 'rgba(255, 180, 171, 0.45)',
  dark_chart_magnet_ssl: 'rgba(80, 255, 175, 0.45)',
  dark_chart_volumetric_strong_arrow: '#ff007f',

  // UI Button Variations (Midnight)
  dark_btn_solid_bg: '#a855f7',
  dark_btn_solid_bg_hover: '#c084fc',
  dark_btn_solid_text: '#ffffff',
  dark_btn_trans_border: '#1e293b',
  dark_btn_trans_bg_hover: 'rgba(255, 255, 255, 0.05)',
  dark_btn_trans_text: '#94a3b8',

  // Sidebar Typography Customizations (Midnight)
  dark_text_sidebar_title: '#ffffff',
  dark_text_sidebar_label: '#64748b',
  dark_text_sidebar_value: '#f8fafc',
  dark_text_sidebar_notes: '#475569',

  light_bg: '#fafafa',
  light_card: '#ffffff',
  light_accent: '#4f46e5',
  light_up_candle: '#059669',
  light_down_candle: '#e11d48',
  light_card_opacity: 75,

  light_interactive_default: '#475569',
  light_interactive_active: '#4f46e5',
  light_interactive_hover: '#020617',
  light_text_title: '#020617',
  light_text_label: '#64748b',
  light_text_value: '#334155',
  light_highlight_up: '#059669',
  light_highlight_down: '#e11d48',

  // Header Customizations (Daylight)
  light_header_bg: '#ffffff',
  light_header_border: '#e2e8f0',
  light_header_text: '#0f172a',
  light_header_icon: '#475569',
  light_header_link_idle: '#64748b',
  light_header_link_hover: '#0f172a',
  light_header_link_active: '#ffffff',
  light_header_link_active_bg: '#4f46e5',

  // Chart Customizations (Daylight)
  light_chart_grid: 'rgba(0, 0, 0, 0.04)',
  light_chart_border: 'rgba(0, 0, 0, 0.06)',
  light_chart_text: '#475569',
  light_chart_swing_high: 'rgba(225, 29, 72, 0.85)',
  light_chart_swing_low: 'rgba(5, 150, 105, 0.85)',
  light_chart_swing_high_internal: 'rgba(225, 29, 72, 0.45)',
  light_chart_swing_low_internal: 'rgba(5, 150, 105, 0.45)',
  light_chart_bos: 'rgba(79, 70, 229, 0.85)',
  light_chart_mss: 'rgba(5, 150, 105, 0.85)',
  light_chart_fvg_bullish: '#059669',
  light_chart_fvg_bearish: '#e11d48',
  light_chart_tdo: '#4f46e5',
  light_chart_session_asian: 'rgba(217, 119, 6, 0.5)',
  light_chart_session_london: 'rgba(37, 99, 235, 0.5)',
  light_chart_magnet_bsl: 'rgba(225, 29, 72, 0.45)',
  light_chart_magnet_ssl: 'rgba(5, 150, 105, 0.45)',
  light_chart_volumetric_strong_arrow: '#e11d48',

  // UI Button Variations (Daylight)
  light_btn_solid_bg: '#4f46e5',
  light_btn_solid_bg_hover: '#4338ca',
  light_btn_solid_text: '#ffffff',
  light_btn_trans_border: '#cbd5e1',
  light_btn_trans_bg_hover: 'rgba(0, 0, 0, 0.03)',
  light_btn_trans_text: '#475569',

  // Sidebar Typography Customizations (Daylight)
  light_text_sidebar_title: '#0f172a',
  light_text_sidebar_label: '#64748b',
  light_text_sidebar_value: '#334155',
  light_text_sidebar_notes: '#94a3b8',
  structure_istr_atr_multiplier: '1.5',
  theme_manual_entry_line: '#eab308',
  theme_manual_tp_line: '#10b981',
  theme_manual_sl_line: '#ef4444',
};

export interface EngineSettings {
  atrPeriod: number;
  adaptiveNMin: number;
  adaptiveNMax: number;
  mssBodyRatio: number;
  displacementVef: number;
  sharpDepartureMult: number;
  candlesLimit1m: number;
  candlesLimit5m: number;
  candlesLimit15m: number;
  candlesLimit1h: number;
  candlesLimit4h: number;
  includeBtcCorrelation: boolean;
  includeStructureAnalysis: boolean;
  includeFvgDetection: boolean;
  visualizePerfectMovementOnly: boolean;
  highPerformanceMode?: boolean;
  pmAtrMultiplier: number;
  pmVolumeSmaPeriod: number;
  pmMinBodyRatio: number;
  pmMaxWickRatio: number;
  pmMaxRetracementLimit: number;
  pmSweepLookback: number;
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  atrPeriod: 14,
  adaptiveNMin: 3,
  adaptiveNMax: 15,
  mssBodyRatio: 0.70,
  displacementVef: 1.50,
  sharpDepartureMult: 1.50,
  candlesLimit1m: 350,
  candlesLimit5m: 350,
  candlesLimit15m: 250,
  candlesLimit1h: 120,
  candlesLimit4h: 80,
  includeBtcCorrelation: true,
  includeStructureAnalysis: true,
  includeFvgDetection: true,
  visualizePerfectMovementOnly: false,
  highPerformanceMode: true,
  pmAtrMultiplier: 0.5,
  pmVolumeSmaPeriod: 10,
  pmMinBodyRatio: 0.3,
  pmMaxWickRatio: 0.5,
  pmMaxRetracementLimit: 0.7,
  pmSweepLookback: 5,
};



export interface MarketDataPayload {
  ticker: string;
  timestamp?: string;
  timezone: string;
  open_interest: number;
  candles_limit?: number; // Dynamic limit from Neon SQL
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ipda_metrics: any;
  risk_management?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  active_arrays: any;
  correlation_data?: any; // V8.7 Correlation Data
  data_payload: {
    candles_4h?: Candle[];
    candles_1h?: Candle[];
    candles_15m?: Candle[];
    candles_5m?: Candle[];
    [key: string]: Candle[] | undefined;
  };
}

export interface MarketDataDeltaPayload {
  isDelta: true;
  timestamp: string;
  open_interest: number;
  risk_management?: any;
  correlation_data: {
    btc_live_price: number;
  };
  delta_candles: Candle[];
  order_flow_engine: {
    open_interest_trend: string;
    resting_liquidity_pools: { BSL_Magnets: number[]; SSL_Magnets: number[] };
    liquidation_events: any;
    smart_money_sentiment: any;
    state_timeline?: any;
  };
  delta_structure?: {
    latestMSS: any;
    latestInternalMSS: any;
    currentTrend: string;
    dealingRange: any;
  };
}

export function mergeDeltaPayload(
  prev: MarketDataPayload,
  delta: MarketDataDeltaPayload,
  activeInterval: string
): MarketDataPayload {
  const activeKey = `candles_${activeInterval}`;
  const prevCandles = prev?.data_payload?.[activeKey] || [];
  
  // Merge only the last few candles, matching by timestamp
  const candleMap = new Map(prevCandles.map(c => [c.t, c]));
  (delta.delta_candles || []).forEach(c => candleMap.set(c.t, c));
  const mergedCandles = Array.from(candleMap.values()).sort((a, b) => a.t - b.t);

  return {
    ...prev,
    open_interest: delta.open_interest,
    risk_management: delta.risk_management || prev?.risk_management,
    correlation_data: {
      ...prev?.correlation_data,
      btc_live_price: delta.correlation_data?.btc_live_price ?? prev?.correlation_data?.btc_live_price,
    },
    ipda_metrics: {
      ...prev?.ipda_metrics,
      order_flow_engine: {
        ...prev?.ipda_metrics?.order_flow_engine,
        ...delta.order_flow_engine,
        // Preserve displacement_sponsorship from prev state during delta ticks
        displacement_sponsorship: prev?.ipda_metrics?.order_flow_engine?.displacement_sponsorship,
      },
      // Update structural delta components if available
      ...(delta.delta_structure ? {
        market_structure_shift: delta.delta_structure.currentTrend !== prev?.ipda_metrics?.current_trend,
        current_trend: delta.delta_structure.currentTrend,
        full_structure_map: {
          ...prev?.ipda_metrics?.full_structure_map,
          latestMSS: delta.delta_structure.latestMSS,
          latestInternalMSS: delta.delta_structure.latestInternalMSS,
          currentTrend: delta.delta_structure.currentTrend,
          dealingRange: delta.delta_structure.dealingRange,
        }
      } : {})
    },
    data_payload: {
      ...(prev?.data_payload || {}),
      [activeKey]: mergedCandles,
    },
  };
}

export function useMarketData(
  selectedInterval: string = '5m',
  liveCandle: LiveCandle | null = null,
  liveCandles: Record<string, LiveCandle> = {},
  lastClosedEvent: ClosedCandleEvent | null = null,
  livePrice: number | null = null
) {
  const [data, setData] = useState<MarketDataPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [mtfSummary, setMtfSummary] = useState<MTFTelemetrySummary | null>(null);
  const mtfEngineRef = useRef<MTFTelemetryEngine>(new MTFTelemetryEngine('ETHUSDC'));

  // Reversible feature pause switch for MTF Radar Telemetry calculations
  const ENABLE_MTF_RADAR_TELEMETRY = true;

  const [contextAnchorTimestamp, setContextAnchorTimestamp] = useState<number | null>(null);
  const [structureState, setStructureState] = useState<MarketStructureAnalysis | null>(null);

  // Reset stable context anchor on timeframe interval swaps
  useEffect(() => {
    setContextAnchorTimestamp(null);
    setStructureState(null);
  }, [selectedInterval]);

  const workerRef = useRef<Worker | null>(null);
  const lastProcessedClosedTimestampRef = useRef<number | null>(null);
  const lastProcessedIntervalRef = useRef<string | null>(null);

  // Web Worker lifecycle management
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        workerRef.current = new Worker(new URL('../workers/quantEngine.worker.ts', import.meta.url));
        
        workerRef.current.onmessage = (event) => {
          const { type, payload, error } = event.data;
          if (type === 'STRUCTURE_RESULT') {
            setStructureState(payload.analysis);
          } else if (type === 'ERROR') {
            console.error('[QuantWorker] Error:', error);
          }
        };
      } catch (workerError) {
        console.warn('[QuantWorker] Web Worker initialization failed. Falling back to main-thread execution.', workerError);
        workerRef.current = null;
      }
    }

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [selectedInterval]);

  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME_SETTINGS;
    try {
      const stored = localStorage.getItem('gem_theme_settings');
      return stored ? JSON.parse(stored) : DEFAULT_THEME_SETTINGS;
    } catch {
      return DEFAULT_THEME_SETTINGS;
    }
  });

  const [signalAlerts, setSignalAlerts] = useState<SignalAlerts>(() => {
    if (typeof window === 'undefined') return DEFAULT_SIGNAL_ALERTS;
    try {
      const stored = localStorage.getItem('gem_signal_sounds');
      return stored ? JSON.parse(stored) : DEFAULT_SIGNAL_ALERTS;
    } catch {
      return DEFAULT_SIGNAL_ALERTS;
    }
  });

  const [signalAlertsEnabled, setSignalAlertsEnabled] = useState<SignalAlertsEnabled>(() => {
    if (typeof window === 'undefined') return DEFAULT_SIGNAL_ALERTS_ENABLED;
    try {
      const stored = localStorage.getItem('gem_signal_enabled');
      return stored ? JSON.parse(stored) : DEFAULT_SIGNAL_ALERTS_ENABLED;
    } catch {
      return DEFAULT_SIGNAL_ALERTS_ENABLED;
    }
  });

  const [engineSettings, setEngineSettings] = useState<EngineSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_ENGINE_SETTINGS;
    try {
      const stored = localStorage.getItem('gem_engine_settings');
      return stored ? { ...DEFAULT_ENGINE_SETTINGS, ...JSON.parse(stored) } : DEFAULT_ENGINE_SETTINGS;
    } catch {
      return DEFAULT_ENGINE_SETTINGS;
    }
  });

  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'saved' | 'error'>('idle');

  // Keep refs of latest values to avoid closure/dependency loop issues in the debounced sync call
  const signalAlertsRef = useRef(signalAlerts);
  const signalAlertsEnabledRef = useRef(signalAlertsEnabled);
  const engineSettingsRef = useRef(engineSettings);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    engineSettingsRef.current = engineSettings;
  }, [engineSettings]);

  useEffect(() => {
    signalAlertsRef.current = signalAlerts;
  }, [signalAlerts]);

  useEffect(() => {
    signalAlertsEnabledRef.current = signalAlertsEnabled;
  }, [signalAlertsEnabled]);

  // Clean up any pending sync timeout on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  const updateThemeSettings = useCallback(async (newSettings: Partial<ThemeSettings>) => {
    setThemeSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('gem_theme_settings', JSON.stringify(updated));
        } catch (e) {
          console.error('[MarketData] Failed to save theme settings to localStorage:', e);
        }
      }
      
      // Persist delta to DB
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: newSettings }),
      }).catch(err => console.error('[MarketData] Failed to sync theme settings:', err));

      return updated;
    });
  }, []);

  // Background SWR Rehydration: fetch settings from Neon on mount to overwrite localStorage
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          
          // Rehydrate dynamic theme settings
          const s = data.settings || {};
          const loadedTheme: ThemeSettings = { ...DEFAULT_THEME_SETTINGS };
          Object.keys(DEFAULT_THEME_SETTINGS).forEach((key) => {
            const val = s[key];
            if (val !== undefined && val !== null) {
              if (typeof DEFAULT_THEME_SETTINGS[key as keyof typeof DEFAULT_THEME_SETTINGS] === 'number') {
                loadedTheme[key as keyof typeof DEFAULT_THEME_SETTINGS] = Number(val) as never;
              } else {
                loadedTheme[key as keyof typeof DEFAULT_THEME_SETTINGS] = String(val) as never;
              }
            }
          });
          setThemeSettings(loadedTheme);
          if (typeof window !== 'undefined') {
            localStorage.setItem('gem_theme_settings', JSON.stringify(loadedTheme));
          }

          if (data.terminalSettings) {
            const { signalSounds, enabledSignals, atrPeriod, adaptiveNMin, adaptiveNMax, mssBodyRatio, displacementVef, sharpDepartureMult, candlesLimit1m, candlesLimit5m, candlesLimit15m, candlesLimit1h, candlesLimit4h, includeBtcCorrelation, includeStructureAnalysis, includeFvgDetection, visualizePerfectMovementOnly, pmAtrMultiplier, pmVolumeSmaPeriod, pmMinBodyRatio, pmMaxWickRatio, pmMaxRetracementLimit, pmSweepLookback } = data.terminalSettings;
            if (signalSounds) {
              setSignalAlerts(signalSounds);
              if (typeof window !== 'undefined') {
                localStorage.setItem('gem_signal_sounds', JSON.stringify(signalSounds));
              }
            }
            if (enabledSignals) {
              setSignalAlertsEnabled(enabledSignals);
              if (typeof window !== 'undefined') {
                localStorage.setItem('gem_signal_enabled', JSON.stringify(enabledSignals));
              }
            }
            
            const loadedEngine = {
              atrPeriod: atrPeriod ?? 14,
              adaptiveNMin: adaptiveNMin ?? 3,
              adaptiveNMax: adaptiveNMax ?? 15,
              mssBodyRatio: mssBodyRatio ?? 0.70,
              displacementVef: displacementVef ?? 1.50,
              sharpDepartureMult: sharpDepartureMult ?? 1.50,
              candlesLimit1m: candlesLimit1m ?? 350,
              candlesLimit5m: candlesLimit5m ?? 350,
              candlesLimit15m: candlesLimit15m ?? 250,
              candlesLimit1h: candlesLimit1h ?? 120,
              candlesLimit4h: candlesLimit4h ?? 80,
              includeBtcCorrelation: includeBtcCorrelation !== false,
              includeStructureAnalysis: includeStructureAnalysis !== false,
              includeFvgDetection: includeFvgDetection !== false,
              visualizePerfectMovementOnly: !!visualizePerfectMovementOnly,
              pmAtrMultiplier: pmAtrMultiplier ?? 0.5,
              pmVolumeSmaPeriod: pmVolumeSmaPeriod ?? 10,
              pmMinBodyRatio: pmMinBodyRatio ?? 0.3,
              pmMaxWickRatio: pmMaxWickRatio ?? 0.5,
              pmMaxRetracementLimit: pmMaxRetracementLimit ?? 0.7,
              pmSweepLookback: pmSweepLookback ?? 5,
            };
            setEngineSettings(loadedEngine);
            if (typeof window !== 'undefined') {
              localStorage.setItem('gem_engine_settings', JSON.stringify(loadedEngine));
            }
          }
        }
      } catch (err) {
        console.error('[MarketData] Failed to fetch server settings:', err);
      }
    };
    loadSettings();
  }, []);

  // Debounced Neon PostgreSQL sync
  const queueSettingsSync = useCallback(() => {
    setSyncStatus('syncing');
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            terminalSettings: {
              signalSounds: signalAlertsRef.current,
              enabledSignals: signalAlertsEnabledRef.current,
              atrPeriod: engineSettingsRef.current.atrPeriod,
              adaptiveNMin: engineSettingsRef.current.adaptiveNMin,
              adaptiveNMax: engineSettingsRef.current.adaptiveNMax,
              mssBodyRatio: engineSettingsRef.current.mssBodyRatio,
              displacementVef: engineSettingsRef.current.displacementVef,
              sharpDepartureMult: engineSettingsRef.current.sharpDepartureMult,
              candlesLimit1m: engineSettingsRef.current.candlesLimit1m,
              candlesLimit5m: engineSettingsRef.current.candlesLimit5m,
              candlesLimit15m: engineSettingsRef.current.candlesLimit15m,
              candlesLimit1h: engineSettingsRef.current.candlesLimit1h,
              candlesLimit4h: engineSettingsRef.current.candlesLimit4h,
              includeBtcCorrelation: engineSettingsRef.current.includeBtcCorrelation !== false,
              includeStructureAnalysis: engineSettingsRef.current.includeStructureAnalysis !== false,
              includeFvgDetection: engineSettingsRef.current.includeFvgDetection !== false,
              visualizePerfectMovementOnly: engineSettingsRef.current.visualizePerfectMovementOnly,
              pmAtrMultiplier: engineSettingsRef.current.pmAtrMultiplier,
              pmVolumeSmaPeriod: engineSettingsRef.current.pmVolumeSmaPeriod,
              pmMinBodyRatio: engineSettingsRef.current.pmMinBodyRatio,
              pmMaxWickRatio: engineSettingsRef.current.pmMaxWickRatio,
              pmMaxRetracementLimit: engineSettingsRef.current.pmMaxRetracementLimit,
              pmSweepLookback: engineSettingsRef.current.pmSweepLookback,
            },
          }),
        });
        if (!res.ok) throw new Error('Failed to save settings');
        setSyncStatus('saved');
        // Reset saved indicator to idle after 2 seconds
        setTimeout(() => setSyncStatus('idle'), 2000);
      } catch (err) {
        console.error('[MarketData] Sync error:', err);
        setSyncStatus('error');
      }
    }, 1000); // 1-second debounce
  }, []);

  const updateEngineSettings = useCallback((newSettings: Partial<EngineSettings>) => {
    setEngineSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      if (typeof window !== 'undefined') {
        localStorage.setItem('gem_engine_settings', JSON.stringify(updated));
      }
      engineSettingsRef.current = updated;
      queueSettingsSync();
      return updated;
    });
  }, [queueSettingsSync]);

  const updateSignalAlert = useCallback((event: keyof SignalAlerts, fileName: string) => {
    setSignalAlerts((prev) => {
      const updated = { ...prev, [event]: fileName };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('gem_signal_sounds', JSON.stringify(updated));
        } catch (e) {
          console.error('[MarketData] Failed to save signal alerts to localStorage:', e);
        }
      }
      signalAlertsRef.current = updated;
      queueSettingsSync();
      return updated;
    });
  }, [queueSettingsSync]);

  const toggleSignalAlertEnabled = useCallback((event: keyof SignalAlertsEnabled) => {
    setSignalAlertsEnabled((prev) => {
      const updated = { ...prev, [event]: !prev[event] };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('gem_signal_enabled', JSON.stringify(updated));
        } catch (e) {
          console.error('[MarketData] Failed to save signal alerts enabled to localStorage:', e);
        }
      }
      signalAlertsEnabledRef.current = updated;
      queueSettingsSync();
      return updated;
    });
  }, [queueSettingsSync]);

  const fetchDataRef = useRef<((isPolling?: boolean) => Promise<void>) | null>(null);

  const fetchData = useCallback(async (isPolling = false) => {
    try {
      if (!isPolling) {
        setIsLoading(true);
        setError(null);
      }
      const pollParam = isPolling ? '&poll=true' : '';
      const timeframeGatedParam = '&timeframeGated=true';
      const activeIntervalParam = `&activeInterval=${selectedInterval}`;
      const initParam = !isPolling ? '&init=true' : '';
      const limitParams = `&limit1m=${engineSettings.candlesLimit1m ?? 350}&limit5m=${engineSettings.candlesLimit5m ?? 350}&limit15m=${engineSettings.candlesLimit15m ?? 250}&limit1h=${engineSettings.candlesLimit1h ?? 120}&limit4h=${engineSettings.candlesLimit4h ?? 80}`;
      const featureParams = `&includeBtc=${engineSettings.includeBtcCorrelation !== false}&includeStructure=${engineSettings.includeStructureAnalysis !== false}&includeFvg=${engineSettings.includeFvgDetection !== false}`;
      
      const res = await fetch(`/api/market-data?interval=${selectedInterval}${pollParam}${timeframeGatedParam}${activeIntervalParam}${initParam}${limitParams}${featureParams}`);
      if (!res.ok) {
        throw new Error('Failed to fetch market data');
      }
      const jsonData: MarketDataPayload = await res.json();

      setData((prev) => {
        if (!prev || !prev.data_payload) return jsonData;

        // Check if the incoming payload is a delta structure
        if ('isDelta' in jsonData && (jsonData as any).isDelta) {
          const delta = jsonData as any as MarketDataDeltaPayload;
          // Incrementally merge delta candles into active rolling buffer without triggering full REST reloads
          return mergeDeltaPayload(prev, delta, selectedInterval);
        }

        return jsonData;
      });

      // Clear any pre-existing initial load error upon a successful poll
      setError(null);
    } catch (err: unknown) {
      console.warn('[MarketData] Background poll error caught:', err);
      if (!isPolling) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      if (!isPolling) {
        setIsLoading(false);
      }
    }
  }, [selectedInterval, engineSettings]);

  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  useEffect(() => {
    // Wrap initial fetch in a macro-task to prevent synchronous cascading React state updates
    const initialTimer = setTimeout(() => {
      fetchData();
    }, 0);

    // 5000ms polling to keep resting_liquidity_pools (BSL/SSL) fresh
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchData(true);
    }, 5000);

    // Instantly refetch on tab return/focus to prevent background queue buildup
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        fetchData(true);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [fetchData]);

  // ── 1. Event-Driven Automated Recalculation & MTF Rolling Buffers ─────────────
  // Deterministically executed strictly upon verified candle close events ('isClosed === true')
  useEffect(() => {
    if (!lastClosedEvent || !data || !data.data_payload) return;

    const { interval: closedInterval, candle: closedCandle } = lastClosedEvent;
    const seriesKey = `candles_${closedInterval}`;
    const currentCandles = data.data_payload[seriesKey] || [];
    if (currentCandles.length === 0) return;

    const lastCandle = currentCandles[currentCandles.length - 1];
    const lastTimeSec = Math.floor(lastCandle.t / 1000);

    const isSameTime = closedCandle.time === lastTimeSec;
    const isNewerTime = closedCandle.time > lastTimeSec;

    const mappedCandle: Candle = {
      t: closedCandle.time * 1000,
      o: closedCandle.open,
      h: closedCandle.high,
      l: closedCandle.low,
      c: closedCandle.close,
      v: closedCandle.volume,
      taker_buy_vol: (closedCandle as any).taker_buy_vol ?? closedCandle.volume / 2,
      taker_sell_vol: (closedCandle as any).taker_sell_vol ?? closedCandle.volume / 2,
      isClosed: true
    };

    let updatedCandles = [...currentCandles];
    if (isSameTime) {
      updatedCandles[updatedCandles.length - 1] = mappedCandle;
    } else if (isNewerTime) {
      updatedCandles.push(mappedCandle);
    }

    // Enforce fixed-size rolling buffer limit (350–500 bars per interval) to prevent memory leaks
    if (updatedCandles.length > 500) {
      updatedCandles = updatedCandles.slice(-500);
    }

    const updatedPayload = {
      ...data.data_payload,
      [seriesKey]: updatedCandles,
    };

    // Instant local OLS displacement calculation on verified candle close
    let updatedSponsorship = data.ipda_metrics?.institutional_sponsorship;
    if (closedInterval === selectedInterval) {
      try {
        const sponsorship = verifyDisplacementOffline(updatedCandles, 'ETHUSDC');
        updatedSponsorship = sponsorship as any;
      } catch (err) {
        console.warn('[MarketData] Instant displacement solver error:', err);
      }
    }

    // Recalculate MTF Telemetry Summary reactively (Paused if ENABLE_MTF_RADAR_TELEMETRY is false)
    if (ENABLE_MTF_RADAR_TELEMETRY) {
      const updatedSummary = mtfEngineRef.current.evaluateAll(updatedPayload, closedCandle.close);
      setMtfSummary(updatedSummary);
    }

    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        ipda_metrics: {
          ...prev.ipda_metrics,
          institutional_sponsorship: updatedSponsorship,
          order_flow_engine: {
            ...prev.ipda_metrics?.order_flow_engine,
            displacement_sponsorship: updatedSponsorship,
          }
        },
        data_payload: updatedPayload,
      };
    });
  }, [lastClosedEvent, selectedInterval]);

  // ── 2. Tick-Speed Stream Synchronization ─────────────────────────────────────
  // Intermediate open-candle ticks update the active series array smoothly
  useEffect(() => {
    if (!liveCandle || !data || !data.data_payload) return;

    const activeSeriesKey = `candles_${selectedInterval}`;
    const prevCandles = data.data_payload[activeSeriesKey] || [];
    if (prevCandles.length === 0) return;

    const lastCandle = prevCandles[prevCandles.length - 1];
    const lastTimeSec = Math.floor(lastCandle.t / 1000);

    const isSameTime = liveCandle.time === lastTimeSec;
    const isNewerTime = liveCandle.time > lastTimeSec;

    // Skip intermediate ticks on the open candle to prevent root React re-render cascades
    if (isSameTime && !liveCandle.isClosed) return;
    if (!isSameTime && !isNewerTime) return;

    setData((prev) => {
      if (!prev || !prev.data_payload) return prev;
      const candles = prev.data_payload[activeSeriesKey] || [];
      if (candles.length === 0) return prev;

      const updatedCandles = [...candles];
      const lastIdx = updatedCandles.length - 1;
      const mappedCandle: Candle = {
        t: liveCandle.time * 1000,
        o: liveCandle.open,
        h: liveCandle.high,
        l: liveCandle.low,
        c: liveCandle.close,
        v: liveCandle.volume,
        taker_buy_vol: (liveCandle as any).taker_buy_vol ?? liveCandle.volume / 2,
        taker_sell_vol: (liveCandle as any).taker_sell_vol ?? liveCandle.volume / 2,
        isClosed: liveCandle.isClosed === true
      };

      if (isSameTime) {
        // Update the last candle on official close
        updatedCandles[lastIdx] = mappedCandle;
      } else {
        // Append a new candle frame (candle officially closed and a new one started)
        updatedCandles.push(mappedCandle);
      }

      return {
        ...prev,
        data_payload: {
          ...prev.data_payload,
          [activeSeriesKey]: updatedCandles
        }
      };
    });
  }, [liveCandle, selectedInterval]);

  // ── 3. Initial & Polling MTF Telemetry Evaluation (Closed-Candle Gated) ──────
  const lastMtfEvaluatedClosedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!ENABLE_MTF_RADAR_TELEMETRY) return;
    if (!data || !data.data_payload) return;
    const candles5m = data.data_payload.candles_5m || [];
    const lastClosedT = candles5m.length >= 2 ? candles5m[candles5m.length - 2]?.t : (candles5m[0]?.t ?? null);
    
    // Evaluate on initial load or when closed candle boundary shifts via polling
    if (lastMtfEvaluatedClosedRef.current !== lastClosedT) {
      lastMtfEvaluatedClosedRef.current = lastClosedT;
      const lastClosePrice = candles5m.length > 0 ? candles5m[candles5m.length - 1].c : undefined;
      const summary = mtfEngineRef.current.evaluateAll(data.data_payload, lastClosePrice);
      setMtfSummary(summary);
    }
  }, [data?.data_payload]);

  // Synchronize and update the stabilized structural state
  useEffect(() => {
    if (!data || !data.data_payload) return;

    // Prefer the backend's fully computed, stateful structural map if available to ensure 100% stability and zero lookback truncation drift
    if (data.ipda_metrics?.full_structure_map) {
      setStructureState(data.ipda_metrics.full_structure_map as any);
      return;
    }

    const activeSeriesKey = `candles_${selectedInterval}`;
    const activeCandles = data.data_payload[activeSeriesKey] || data.data_payload.candles_15m || [];
    if (activeCandles.length === 0) return;

    // 1. Establish the stable Context Anchor on the very first successful initial load
    let anchor = contextAnchorTimestamp;
    if (anchor === null) {
      anchor = activeCandles[0].t;
      setContextAnchorTimestamp(anchor);
      console.log('[MarketData] Established stable lookback context anchor at:', new Date(anchor).toISOString());
    }

    // --- Closed-Candle Memoization Barrier ---
    // The second-to-last candle represents the last completed/closed candle.
    const lastClosedCandle = activeCandles[activeCandles.length - 2];
    const lastClosedT = lastClosedCandle ? lastClosedCandle.t : null;

    const isIntervalChanged = lastProcessedIntervalRef.current !== selectedInterval;
    const isNewCandleClosed = lastProcessedClosedTimestampRef.current !== lastClosedT;

    if (!isIntervalChanged && !isNewCandleClosed) {
      // TELEMETRY UPDATE MODE: Bypassing worker execution for intermediate ticks.
      // Perform a lightweight mutation on the live-edge candle preview properties
      const currentPrice = activeCandles[activeCandles.length - 1]?.c ?? 0;
      setStructureState((prev) => {
        if (!prev) return null;
        
        // Update price-dependent dealing range properties
        const updatedDealingRange = prev.dealingRange ? {
          ...prev.dealingRange,
          current_status: prev.dealingRange.equilibrium === null
            ? 'AWAITING_IDM_SWEEP' as const
            : (currentPrice > Number(prev.dealingRange.equilibrium) ? 'PREMIUM' as const : 'DISCOUNT' as const)
        } : null;

        const updatedInternalDealingRange = prev.internalDealingRange ? {
          ...prev.internalDealingRange,
          current_status: prev.internalDealingRange.equilibrium === null
            ? 'AWAITING_IDM_SWEEP' as const
            : (currentPrice > Number(prev.internalDealingRange.equilibrium) ? 'PREMIUM' as const : 'DISCOUNT' as const)
        } : null;

        return {
          ...prev,
          dealingRange: updatedDealingRange,
          internalDealingRange: updatedInternalDealingRange
        } as any;
      });
      return;
    }

    // Update cache refs
    lastProcessedClosedTimestampRef.current = lastClosedT;
    lastProcessedIntervalRef.current = selectedInterval;

    // 2. Compute structural analysis using the stable lookback anchor
    const currentPrice = activeCandles[activeCandles.length - 1]?.c ?? 0;
    const displacementStatus = data.ipda_metrics?.institutional_sponsorship ?? null;
    const globalAnchors = data.ipda_metrics?.global_anchors ?? null;

    if (workerRef.current) {
      // Background worker path: offload heavy calculations to background thread
      workerRef.current.postMessage({
        type: 'ANALYZE_STRUCTURE',
        payload: {
          candles: activeCandles,
          currentPrice,
          displacementStatus,
          contextAnchorTimestamp: anchor,
          globalAnchors,
          config: engineSettings
        }
      });
    } else {
      // Synchronous fallback (if Web Worker initialization failed or during SSR)
      const analysis = analyzeMarketStructure(activeCandles, currentPrice, displacementStatus, anchor, globalAnchors, engineSettings);
      setStructureState(analysis);
    }
  }, [data, selectedInterval, contextAnchorTimestamp, engineSettings]);

  // Hook into live alerts: Triggers Binance WS, performs diffs, fires audio/push alerts
  const { activeAlerts, clearAlerts, dismissAlert, triggerAlert } = useLiveAlerts(data, fetchData, signalAlertsEnabled, signalAlerts, mtfSummary);

  // ── V6 Naked — always full, unsliced ─────────────────────────────────────
  const downloadV6 = useCallback(() => {
    if (!data) return;

    const v6Data = {
      ticker: data.ticker,
      timezone: data.timezone,
      open_interest: data.open_interest,
      data_payload: data.data_payload,
    };

    triggerDownload(v6Data, `V6_Naked_Data_${data.ticker}.json`);
  }, [data]);

  // ── V8.2 Enriched — sliced by candle counts ───────────────────────────────
  const downloadV7Sliced = useCallback(
    (counts: { '5m': number, '15m': number, '1h': number, '4h': number }) => {
      if (!data) return;

      const sliced = slicePayloadByLookback(data, counts);
      const v7Data = {
        ticker: sliced.ticker,
        timestamp: new Date().toISOString(),
        timezone: sliced.timezone,
        ipda_metrics: sliced.ipda_metrics,
        active_arrays: sliced.active_arrays,
        open_interest: sliced.open_interest,
        data_payload: sliced.data_payload,
      };

      const now = new Date();
      let hours = now.getHours();
      const minutes = now.getMinutes();
      const ampm = hours >= 12 ? 'pm' : 'am';

      hours = hours % 12;
      hours = hours ? hours : 12; // تحويل الصفر لـ 12

      triggerDownload(v7Data, `V${SYSTEM_VERSION}_Enriched_Data_${data.ticker}.json`);
    },
    [data]
  );

  const [isFetchingMore, setIsFetchingMore] = useState<boolean>(false);

  const loadMoreHistory = useCallback(async () => {
    if (!data || isFetchingMore) return;

    const activeSeriesKey = `candles_${selectedInterval}`;
    const prevCandles = data.data_payload[activeSeriesKey] || data.data_payload.candles_15m || [];
    if (prevCandles.length === 0) return;

    // Find the oldest candle timestamp and its close price.
    // The close price is sent as `fallbackPrice` so that the offline simulation
    // mock generator anchors its backward walk exactly at the chart's current left boundary,
    // preventing vertical price jumps when lazy-loading history in offline mode.
    const oldestTimestamp = prevCandles[0].t;
    const oldestPrice = prevCandles[0].c;

    setIsFetchingMore(true);
    try {
      const res = await fetch(`/api/market-data?interval=${selectedInterval}&endTime=${oldestTimestamp}&fallbackPrice=${oldestPrice}`);
      if (!res.ok) throw new Error('Failed to fetch more history');

      const newBatch: MarketDataPayload = await res.json();
      const newCandles = newBatch.data_payload[activeSeriesKey] || newBatch.data_payload.candles_15m || [];

      if (newCandles.length > 0) {
        setData((prev) => {
          if (!prev) return newBatch;

          const prevActiveCandles = prev.data_payload[activeSeriesKey] || [];
          const existingIds = new Set(prevActiveCandles.map((c) => c.t));
          const uniqueNewCandles = newCandles.filter((c) => !existingIds.has(c.t));

          const combinedCandles = [...uniqueNewCandles, ...prevActiveCandles].sort((a, b) => a.t - b.t);

          return {
            ...prev,
            data_payload: {
              ...prev.data_payload,
              [activeSeriesKey]: combinedCandles,
            },
          };
        });
      }
    } catch (err) {
      console.error('[MarketData] Failed to load more history:', err);
    } finally {
      setIsFetchingMore(false);
    }
  }, [data, selectedInterval, isFetchingMore]);

  const {
    aiAnalysis,
    aiBias,
    isAnalyzing,
    triggerAiAnalysisScan: triggerScan,
    setAiAnalysis,
    setAiBias
  } = useAIAnalysis();

  // ── 30-Minute Automated Analysis Scan Scheduler ────────────────────────────
  const [isAuto30mScanActive, setIsAuto30mScanActive] = useState<boolean>(true);
  const [nextScanTimestamp, setNextScanTimestamp] = useState<number>(() => Date.now() + 1800 * 1000);
  const nextScanTimestampRef = useRef<number>(Date.now() + 1800 * 1000);

  // Sync with localStorage on client mount (avoids SSR hydration mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem('gem_auto_30m_scan');
      if (stored !== null) {
        setIsAuto30mScanActive(stored === 'true');
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const toggleAuto30mScan = useCallback(() => {
    setIsAuto30mScanActive((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('gem_auto_30m_scan', String(next));
      }
      return next;
    });
  }, []);

  const triggerAiAnalysisScan = useCallback(async (alertMetadata?: unknown) => {
    const nextTime = Date.now() + 1800 * 1000;
    nextScanTimestampRef.current = nextTime;
    setNextScanTimestamp(nextTime);
    return triggerScan(data, alertMetadata);
  }, [data, triggerScan]);

  // 30-minute periodic scan check (silent 5s polling check, zero React re-render churn)
  useEffect(() => {
    if (!isAuto30mScanActive) return;

    const timer = setInterval(() => {
      if (Date.now() >= nextScanTimestampRef.current) {
        triggerAiAnalysisScan();
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [isAuto30mScanActive, triggerAiAnalysisScan]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchData,
    downloadV6,
    downloadV7Sliced,
    activeAlerts,
    clearAlerts,
    dismissAlert,
    triggerSmartAlert: triggerAlert,
    aiAnalysis,
    aiBias,
    isAnalyzing,
    setAiAnalysis,
    triggerAiAnalysisScan,
    isAuto30mScanActive,
    toggleAuto30mScan,
    nextScanTimestamp,
    signalAlerts,
    updateSignalAlert,
    signalAlertsEnabled,
    toggleSignalAlertEnabled,
    syncStatus,
    themeSettings,
    updateThemeSettings,
    isFetchingMore,
    loadMoreHistory,
    structureState,
    contextAnchorTimestamp,
    engineSettings,
    updateEngineSettings,
    mtfSummary,
  };
}

function getFormattedTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}`;
}

// ── Shared file-download helper ───────────────────────────────────────────────
function triggerDownload(payload: unknown, baseFilename: string) {
  const ts = getFormattedTimestamp();
  const dotIndex = baseFilename.lastIndexOf('.');
  const baseWithoutExt = dotIndex !== -1 ? baseFilename.substring(0, dotIndex) : baseFilename;
  const filename = `${baseWithoutExt}_${ts}.json`;

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
