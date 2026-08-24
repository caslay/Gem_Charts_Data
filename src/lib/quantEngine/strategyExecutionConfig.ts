/**
 * strategyExecutionConfig.ts
 * Dual Strategy Independent Auto-Execution Control & Persistence Layer.
 * Manages decoupled, persistent local storage flags and reactive event broadcasting for:
 *   1. Order Block & Breaker Strategy Auto-Execution (isOrderBlockAutoExecEnabled)
 *   2. Sweep & Reclaim 3-Pillar Strategy Auto-Execution (isSweepReclaimAutoExecEnabled)
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SweepReclaimEntryMode } from './SweepReclaimEngine';

export const STORAGE_KEY_OB_AUTO_EXEC = 'FLOW_STATE_OB_AUTO_EXEC';
export const STORAGE_KEY_SR_AUTO_EXEC = 'FLOW_STATE_SR_AUTO_EXEC';
export const STORAGE_KEY_OB_SETTINGS = 'FLOW_STATE_OB_SETTINGS';
export const STORAGE_KEY_SR_SETTINGS = 'FLOW_STATE_SR_SETTINGS';
export const STORAGE_KEY_OB_ENABLED_TIMEFRAMES = 'FLOW_STATE_OB_ENABLED_TIMEFRAMES';

export const STRATEGY_AUTO_EXEC_EVENT = 'strategy-auto-exec-changed';
export const OB_TIMEFRAME_TOGGLE_EVENT = 'strategy-timeframe-toggle-changed';
export const SR_SETTINGS_CHANGED_EVENT = 'strategy-sr-settings-changed';

export const SUPPORTED_OB_TIMEFRAMES = ['5m', '15m', '1h'] as const;
export type SupportedOBTimeframe = typeof SUPPORTED_OB_TIMEFRAMES[number];
export const DEFAULT_ENABLED_TIMEFRAMES: SupportedOBTimeframe[] = ['5m', '15m', '1h'];

export interface StrategyAutoExecState {
  isOrderBlockAutoExecEnabled: boolean;
  isSweepReclaimAutoExecEnabled: boolean;
}

export interface OBTimeframeToggleState {
  enabledTimeframes: SupportedOBTimeframe[];
}

export type LiveExecutionTiming = 'INSTANT' | 'ON_CLOSE';
export type LiveOlsSensitivity = 'STRICT' | 'RELAXED' | 'OFF';
export type LiveDirectionalLock = 'DUAL' | 'LONGS_ONLY' | 'SHORTS_ONLY';
export type LiveSessionKillzone = 'ASIAN' | 'LONDON' | 'NY';

export interface SweepReclaimLiveSettings {
  compoundingRiskPct: number; // 1.0, 2.0, 3.0 (default: 2.0)
  enabledTimeframes: SupportedOBTimeframe[]; // ['5m', '15m', '1h'] (default: ['5m', '15m', '1h'])
  entryMode: SweepReclaimEntryMode; // default: 'BREAKER_BLOCK'
  volumeSmaPeriod?: number; // default: 20 (lookback period for Volume SMA)
  volumeExpansionThreshold: number; // default: 1.50 (Candle 2 Volume Ratio vs SMA)
  maxBarsSweepToReclaim: number; // default: 50 (Phase 3 Reclaim TTL)
  maxBarsToRetest: number; // default: 24 (Phase 4 Retest TTL)
  slBufferAtrMultiplier?: number; // default: 0.15 (Anti-friction SL buffer)
  enableStructuralTrail: boolean; // default: true
  enableProfitRatchet: boolean; // default: true
  enableTp1AutoBreakeven: boolean; // default: true (close partial at TP1, move SL to breakeven 0.0R)
  stage1Multiple: number; // default: 1.0
  stage2Multiple: number; // default: 1.5
  stage3Multiple: number; // default: 3.0
  routeRunnerToHtfDol: boolean; // default: true (route TP3 runner to resting HTF liquidity pools)
  executionTiming: LiveExecutionTiming; // default: 'INSTANT'
  sessionGates: LiveSessionKillzone[]; // default: ['ASIAN', 'LONDON', 'NY']
  directionalLock: LiveDirectionalLock; // default: 'DUAL'
}

export const DEFAULT_SR_LIVE_SETTINGS: SweepReclaimLiveSettings = {
  compoundingRiskPct: 2.0,
  enabledTimeframes: ['5m', '15m', '1h'],
  entryMode: 'BREAKER_BLOCK',
  volumeSmaPeriod: 20,
  volumeExpansionThreshold: 1.50,
  maxBarsSweepToReclaim: 50,
  maxBarsToRetest: 24,
  slBufferAtrMultiplier: 0.15,
  enableStructuralTrail: true,
  enableProfitRatchet: true,
  enableTp1AutoBreakeven: true,
  stage1Multiple: 1.0,
  stage2Multiple: 1.5,
  stage3Multiple: 3.0,
  routeRunnerToHtfDol: true,
  executionTiming: 'INSTANT',
  sessionGates: ['ASIAN', 'LONDON', 'NY'],
  directionalLock: 'DUAL',
};

// Master Reversible Pause Switch for Order Block & Breaker Pipeline
export const IS_ORDER_BLOCK_STRATEGY_PAUSED = true;

/**
 * Reads the Order Block auto-execution toggle from localStorage with SSR safety.
 */
export function getOrderBlockAutoExec(): boolean {
  if (IS_ORDER_BLOCK_STRATEGY_PAUSED) return false;
  if (typeof window === 'undefined') return false;
  try {
    const item = localStorage.getItem(STORAGE_KEY_OB_AUTO_EXEC);
    if (item === null) return false;
    return item === 'true';
  } catch {
    return false;
  }
}

/**
 * Sets the Order Block auto-execution toggle in localStorage and notifies all listeners.
 */
export function setOrderBlockAutoExec(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_OB_AUTO_EXEC, String(enabled));
    dispatchStrategyAutoExecChange();
  } catch (err) {
    console.warn('[strategyExecutionConfig] Failed to save OB auto-exec state:', err);
  }
}

/**
 * Reads the Sweep & Reclaim auto-execution toggle from localStorage with SSR safety.
 */
export function getSweepReclaimAutoExec(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const item = localStorage.getItem(STORAGE_KEY_SR_AUTO_EXEC);
    if (item === null) return true; // Default ON
    return item === 'true';
  } catch {
    return true;
  }
}

/**
 * Sets the Sweep & Reclaim auto-execution toggle in localStorage and notifies all listeners.
 */
export function setSweepReclaimAutoExec(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_SR_AUTO_EXEC, String(enabled));
    dispatchStrategyAutoExecChange();
  } catch (err) {
    console.warn('[strategyExecutionConfig] Failed to save SR auto-exec state:', err);
  }
}

/**
 * Reads the enabled MTF streams for Live OB Execution from localStorage with SSR safety.
 */
export function getEnabledOBTimeframes(): SupportedOBTimeframe[] {
  if (typeof window === 'undefined') return [...DEFAULT_ENABLED_TIMEFRAMES];
  try {
    const item = localStorage.getItem(STORAGE_KEY_OB_ENABLED_TIMEFRAMES);
    if (!item) return [...DEFAULT_ENABLED_TIMEFRAMES];
    const parsed = JSON.parse(item);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const valid = parsed.filter((tf: any) => SUPPORTED_OB_TIMEFRAMES.includes(tf)) as SupportedOBTimeframe[];
      return valid.length > 0 ? valid : [...DEFAULT_ENABLED_TIMEFRAMES];
    }
    return [...DEFAULT_ENABLED_TIMEFRAMES];
  } catch {
    return [...DEFAULT_ENABLED_TIMEFRAMES];
  }
}

/**
 * Sets the enabled MTF streams in localStorage and broadcasts reactive update event.
 */
export function setEnabledOBTimeframes(timeframes: SupportedOBTimeframe[]): void {
  if (typeof window === 'undefined') return;
  try {
    const sanitized = timeframes.filter(tf => SUPPORTED_OB_TIMEFRAMES.includes(tf));
    const toSave = sanitized.length > 0 ? sanitized : [...DEFAULT_ENABLED_TIMEFRAMES];
    localStorage.setItem(STORAGE_KEY_OB_ENABLED_TIMEFRAMES, JSON.stringify(toSave));
    dispatchOBTimeframeToggleChange(toSave);
  } catch (err) {
    console.warn('[strategyExecutionConfig] Failed to save OB enabled timeframes:', err);
  }
}

/**
 * Toggles a single timeframe stream ON or OFF while ensuring at least one timeframe remains active.
 */
export function toggleOBTimeframeStream(tf: SupportedOBTimeframe): SupportedOBTimeframe[] {
  const current = getEnabledOBTimeframes();
  let next: SupportedOBTimeframe[];
  if (current.includes(tf)) {
    // If it's the only one enabled, prevent disabling it completely to avoid deadlocks
    if (current.length <= 1) {
      return current;
    }
    next = current.filter(t => t !== tf);
  } else {
    next = [...current, tf];
  }
  setEnabledOBTimeframes(next);
  return next;
}

/**
 * Checks if a timeframe stream is enabled.
 */
export function isOBTimeframeStreamEnabled(tf: SupportedOBTimeframe): boolean {
  return getEnabledOBTimeframes().includes(tf);
}

/**
 * Dispatches timeframe stream toggle event across components.
 */
export function dispatchOBTimeframeToggleChange(enabledTimeframes?: SupportedOBTimeframe[]): void {
  if (typeof window !== 'undefined') {
    const payload: OBTimeframeToggleState = {
      enabledTimeframes: enabledTimeframes || getEnabledOBTimeframes(),
    };
    window.dispatchEvent(new CustomEvent(OB_TIMEFRAME_TOGGLE_EVENT, { detail: payload }));
  }
}

/**
 * Dispatches a window custom event to notify all active hooks and UI components.
 */
export function dispatchStrategyAutoExecChange(): void {
  if (typeof window !== 'undefined') {
    const payload: StrategyAutoExecState = {
      isOrderBlockAutoExecEnabled: getOrderBlockAutoExec(),
      isSweepReclaimAutoExecEnabled: getSweepReclaimAutoExec(),
    };
    window.dispatchEvent(new CustomEvent(STRATEGY_AUTO_EXEC_EVENT, { detail: payload }));
  }
}

/**
 * Reactive React hook to access and toggle MTF stream states.
 */
export function useOBTimeframeStreams() {
  const [enabledTimeframes, setEnabledTimeframesState] = useState<SupportedOBTimeframe[]>(DEFAULT_ENABLED_TIMEFRAMES);

  // Sync on mount
  useEffect(() => {
    setEnabledTimeframesState(getEnabledOBTimeframes());
  }, []);

  // Listen for real-time cross-component updates
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<OBTimeframeToggleState>;
      if (customEvent.detail && Array.isArray(customEvent.detail.enabledTimeframes)) {
        setEnabledTimeframesState(customEvent.detail.enabledTimeframes);
      } else {
        setEnabledTimeframesState(getEnabledOBTimeframes());
      }
    };

    window.addEventListener(OB_TIMEFRAME_TOGGLE_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(OB_TIMEFRAME_TOGGLE_EVENT, handleUpdate);
    };
  }, []);

  const toggleTimeframe = useCallback((tf: SupportedOBTimeframe) => {
    const next = toggleOBTimeframeStream(tf);
    setEnabledTimeframesState(next);
    return next;
  }, []);

  const setTimeframeEnabled = useCallback((tf: SupportedOBTimeframe, enabled: boolean) => {
    const current = getEnabledOBTimeframes();
    let next: SupportedOBTimeframe[];
    if (enabled) {
      next = current.includes(tf) ? current : [...current, tf];
    } else {
      if (current.length <= 1 && current.includes(tf)) {
        return; // Prevent disabling last remaining timeframe
      }
      next = current.filter(t => t !== tf);
    }
    setEnabledOBTimeframes(next);
    setEnabledTimeframesState(next);
  }, []);

  const isTimeframeEnabled = useCallback((tf: SupportedOBTimeframe) => {
    return enabledTimeframes.includes(tf);
  }, [enabledTimeframes]);

  return {
    enabledTimeframes,
    isTimeframeEnabled,
    toggleTimeframe,
    setTimeframeEnabled,
    setEnabledTimeframes: setEnabledOBTimeframes,
  };
}

/**
 * Reactive React hook to access and toggle dual strategy auto-execution states.
 */
export function useDualStrategyAutoExec() {
  const [obAutoExec, setObAutoExecState] = useState<boolean>(true);
  const [srAutoExec, setSrAutoExecState] = useState<boolean>(true);

  // Sync on mount from localStorage
  useEffect(() => {
    setObAutoExecState(getOrderBlockAutoExec());
    setSrAutoExecState(getSweepReclaimAutoExec());
  }, []);

  // Listen for real-time cross-component updates
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<StrategyAutoExecState>;
      if (customEvent.detail) {
        setObAutoExecState(customEvent.detail.isOrderBlockAutoExecEnabled);
        setSrAutoExecState(customEvent.detail.isSweepReclaimAutoExecEnabled);
      } else {
        setObAutoExecState(getOrderBlockAutoExec());
        setSrAutoExecState(getSweepReclaimAutoExec());
      }
    };

    window.addEventListener(STRATEGY_AUTO_EXEC_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(STRATEGY_AUTO_EXEC_EVENT, handleUpdate);
    };
  }, []);

  const toggleOrderBlockAutoExec = useCallback(() => {
    const nextVal = !getOrderBlockAutoExec();
    setOrderBlockAutoExec(nextVal);
    setObAutoExecState(nextVal);
    return nextVal;
  }, []);

  const toggleSweepReclaimAutoExec = useCallback(() => {
    const nextVal = !getSweepReclaimAutoExec();
    setSweepReclaimAutoExec(nextVal);
    setSrAutoExecState(nextVal);
    return nextVal;
  }, []);

  const setOrderBlockEnabled = useCallback((enabled: boolean) => {
    setOrderBlockAutoExec(enabled);
    setObAutoExecState(enabled);
  }, []);

  const setSweepReclaimEnabled = useCallback((enabled: boolean) => {
    setSweepReclaimAutoExec(enabled);
    setSrAutoExecState(enabled);
  }, []);

  return {
    isOrderBlockAutoExecEnabled: obAutoExec,
    isSweepReclaimAutoExecEnabled: srAutoExec,
    toggleOrderBlockAutoExec,
    toggleSweepReclaimAutoExec,
    setOrderBlockAutoExec: setOrderBlockEnabled,
    setSweepReclaimAutoExec: setSweepReclaimEnabled,
  };
}

/**
 * Reads the Sweep & Reclaim live settings from localStorage with SSR safety.
 */
export function getSweepReclaimLiveSettings(): SweepReclaimLiveSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SR_LIVE_SETTINGS };
  try {
    const item = localStorage.getItem(STORAGE_KEY_SR_SETTINGS);
    if (!item) return { ...DEFAULT_SR_LIVE_SETTINGS };
    const parsed = JSON.parse(item);
    return {
      ...DEFAULT_SR_LIVE_SETTINGS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_SR_LIVE_SETTINGS };
  }
}

/**
 * Sets the Sweep & Reclaim live settings in localStorage and broadcasts reactive update event.
 */
export function setSweepReclaimLiveSettings(settings: SweepReclaimLiveSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_SR_SETTINGS, JSON.stringify(settings));
    dispatchSweepReclaimSettingsChange(settings);
  } catch (err) {
    console.warn('[strategyExecutionConfig] Failed to save SR live settings:', err);
  }
}

/**
 * Partially updates the Sweep & Reclaim live settings in localStorage.
 */
export function updateSweepReclaimLiveSettings(partial: Partial<SweepReclaimLiveSettings>): SweepReclaimLiveSettings {
  const current = getSweepReclaimLiveSettings();
  const next = { ...current, ...partial };
  setSweepReclaimLiveSettings(next);
  return next;
}

/**
 * Dispatches a window custom event for Sweep & Reclaim settings updates.
 */
export function dispatchSweepReclaimSettingsChange(settings?: SweepReclaimLiveSettings): void {
  if (typeof window !== 'undefined') {
    const payload = settings || getSweepReclaimLiveSettings();
    window.dispatchEvent(new CustomEvent(SR_SETTINGS_CHANGED_EVENT, { detail: payload }));
  }
}

/**
 * Reactive React hook to access and update Sweep & Reclaim live settings across components.
 */
export function useSweepReclaimLiveSettings() {
  const [settings, setSettingsState] = useState<SweepReclaimLiveSettings>(DEFAULT_SR_LIVE_SETTINGS);

  // Sync on mount
  useEffect(() => {
    setSettingsState(getSweepReclaimLiveSettings());
  }, []);

  // Listen for real-time cross-component updates
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<SweepReclaimLiveSettings>;
      if (customEvent.detail) {
        setSettingsState(customEvent.detail);
      } else {
        setSettingsState(getSweepReclaimLiveSettings());
      }
    };

    window.addEventListener(SR_SETTINGS_CHANGED_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(SR_SETTINGS_CHANGED_EVENT, handleUpdate);
    };
  }, []);

  const updateSettings = useCallback((partial: Partial<SweepReclaimLiveSettings>) => {
    const next = updateSweepReclaimLiveSettings(partial);
    setSettingsState(next);
    return next;
  }, []);

  const toggleTimeframe = useCallback((tf: SupportedOBTimeframe) => {
    const current = getSweepReclaimLiveSettings();
    let nextTfs: SupportedOBTimeframe[];
    if (current.enabledTimeframes.includes(tf)) {
      if (current.enabledTimeframes.length <= 1) return current.enabledTimeframes;
      nextTfs = current.enabledTimeframes.filter(t => t !== tf);
    } else {
      nextTfs = [...current.enabledTimeframes, tf];
    }
    const next = updateSweepReclaimLiveSettings({ enabledTimeframes: nextTfs });
    setSettingsState(next);
    return nextTfs;
  }, []);

  return {
    settings,
    updateSettings,
    toggleTimeframe,
    setSettings: setSweepReclaimLiveSettings,
  };
}
