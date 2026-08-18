/**
 * strategyExecutionConfig.ts
 * Dual Strategy Independent Auto-Execution Control & Persistence Layer.
 * Manages decoupled, persistent local storage flags and reactive event broadcasting for:
 *   1. Order Block & Breaker Strategy Auto-Execution (isOrderBlockAutoExecEnabled)
 *   2. Sweep & Reclaim 3-Pillar Strategy Auto-Execution (isSweepReclaimAutoExecEnabled)
 */

'use client';

import { useState, useEffect, useCallback } from 'react';

export const STORAGE_KEY_OB_AUTO_EXEC = 'FLOW_STATE_OB_AUTO_EXEC';
export const STORAGE_KEY_SR_AUTO_EXEC = 'FLOW_STATE_SR_AUTO_EXEC';
export const STORAGE_KEY_OB_SETTINGS = 'FLOW_STATE_OB_SETTINGS';
export const STORAGE_KEY_SR_SETTINGS = 'FLOW_STATE_SR_SETTINGS';

export const STRATEGY_AUTO_EXEC_EVENT = 'strategy-auto-exec-changed';

export interface StrategyAutoExecState {
  isOrderBlockAutoExecEnabled: boolean;
  isSweepReclaimAutoExecEnabled: boolean;
}

/**
 * Reads the Order Block auto-execution toggle from localStorage with SSR safety.
 */
export function getOrderBlockAutoExec(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const item = localStorage.getItem(STORAGE_KEY_OB_AUTO_EXEC);
    if (item === null) return true; // Default ON
    return item === 'true';
  } catch {
    return true;
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
