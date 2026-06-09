import { useState, useEffect, useCallback, useRef } from 'react';
import { slicePayloadByLookback } from '@/components/Sidebar';
import { useLiveAlerts } from './useLiveAlerts';
import { useAIAnalysis } from './useAIAnalysis';
import { Candle } from '@/lib/fvgEngine';
import { analyzeMarketStructure, MarketStructureAnalysis } from '@/lib/structureEngine';
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
  candlesLimit1m: 1000,
  candlesLimit5m: 1000,
  candlesLimit15m: 1000,
  candlesLimit1h: 1000,
  candlesLimit4h: 1000,
  includeBtcCorrelation: true,
  includeStructureAnalysis: true,
  includeFvgDetection: true,
  visualizePerfectMovementOnly: false,
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

export function useMarketData(selectedInterval: string = '5m') {
  const [data, setData] = useState<MarketDataPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [contextAnchorTimestamp, setContextAnchorTimestamp] = useState<number | null>(null);
  const [structureState, setStructureState] = useState<MarketStructureAnalysis | null>(null);

  // Reset stable context anchor on timeframe interval swaps
  useEffect(() => {
    setContextAnchorTimestamp(null);
    setStructureState(null);
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
              candlesLimit1m: candlesLimit1m ?? 1000,
              candlesLimit5m: candlesLimit5m ?? 1000,
              candlesLimit15m: candlesLimit15m ?? 1000,
              candlesLimit1h: candlesLimit1h ?? 1000,
              candlesLimit4h: candlesLimit4h ?? 1000,
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

  const fetchData = useCallback(async (isPolling = false) => {
    try {
      if (!isPolling) {
        setIsLoading(true);
        setError(null);
      }
      const initParam = !isPolling ? '&init=true' : '';
      const limitParams = `&limit1m=${engineSettings.candlesLimit1m ?? 1000}&limit5m=${engineSettings.candlesLimit5m ?? 1000}&limit15m=${engineSettings.candlesLimit15m ?? 1000}&limit1h=${engineSettings.candlesLimit1h ?? 1000}&limit4h=${engineSettings.candlesLimit4h ?? 1000}`;
      const featureParams = `&includeBtc=${engineSettings.includeBtcCorrelation !== false}&includeStructure=${engineSettings.includeStructureAnalysis !== false}&includeFvg=${engineSettings.includeFvgDetection !== false}`;
      const res = await fetch(`/api/market-data?interval=${selectedInterval}${initParam}${limitParams}${featureParams}`);
      if (!res.ok) {
        throw new Error('Failed to fetch market data');
      }
      const jsonData: MarketDataPayload = await res.json();

      setData((prev) => {
        if (!prev) return jsonData;
        // During polling, preserve both data_payload AND ipda_metrics to prevent the
        // Dynamic Chart Layer Orchestrator from re-firing on every 5-second tick.
        // Only replace these on real initial loads (isPolling = false) or timeframe switches.
        if (isPolling) {
          return {
            ...jsonData,
            data_payload: prev.data_payload,
            ipda_metrics: prev.ipda_metrics,
          };
        }
        return jsonData;
      });

      // Clear any pre-existing initial load error upon a successful poll
      setError(null);

      // Unified event sync: Trigger a refresh of the trades state across the UI on server-side closes
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('trades-refresh'));
      }
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
    // Wrap initial fetch in a macro-task to prevent synchronous cascading React state updates
    const initialTimer = setTimeout(() => {
      fetchData();
    }, 0);
    // Added 5000ms polling to keep resting_liquidity_pools (BSL/SSL) fresh
    const interval = setInterval(() => {
      fetchData(true);
    }, 5000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [fetchData]);

  // Synchronize and update the stabilized structural state
  useEffect(() => {
    if (!data) return;

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

    // 2. Compute structural analysis using the stable lookback anchor
    const currentPrice = activeCandles[activeCandles.length - 1]?.c ?? 0;
    const displacementStatus = data.ipda_metrics?.institutional_sponsorship ?? null;
    const globalAnchors = data.ipda_metrics?.global_anchors ?? null;
    const analysis = analyzeMarketStructure(activeCandles, currentPrice, displacementStatus, anchor, globalAnchors, engineSettings);

    setStructureState(analysis);
  }, [data, selectedInterval, contextAnchorTimestamp, engineSettings]);

  // Hook into live alerts: Triggers Binance WS, performs diffs, fires audio/push alerts
  const { activeAlerts, clearAlerts, dismissAlert, triggerAlert } = useLiveAlerts(data, fetchData);

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

      triggerDownload(v7Data, `V8.2_Enriched_Data_${data.ticker}.json`);
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

  const triggerAiAnalysisScan = useCallback(async (alertMetadata?: unknown) => {
    return triggerScan(data, alertMetadata);
  }, [data, triggerScan]);

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
    updateEngineSettings
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
