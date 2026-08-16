'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useDrawingStore } from '@/lib/drawings/store';
import type { UserDrawing, DrawingType, DrawingStyle, DrawingToolMode } from '@/lib/drawings/types';

interface UseDrawingsOptions {
  symbol?: string;
  interval?: string;
  enabled?: boolean;
}

export function useDrawings({ symbol = 'ETHUSDC', interval = '5m', enabled = true }: UseDrawingsOptions = {}) {
  const {
    drawingsBySymbol,
    activeTool,
    selectedDrawingId,
    toolStyles,
    isGlobalVisible,
    setActiveTool,
    setSelectedDrawingId,
    setToolStyle,
    updateSelectedDrawingStyle,
    addDrawing,
    updateDrawing,
    deleteDrawing,
    deleteSelectedDrawing,
    clearDrawings,
    duplicateDrawing,
    toggleLock,
    toggleGlobalVisibility,
    undo,
    redo,
    setServerDrawings,
  } = useDrawingStore();

  const activeDrawings = (drawingsBySymbol[symbol] || []).filter(
    (d) => !d.interval || d.interval === 'ALL' || d.interval === interval
  );

  const selectedDrawing = activeDrawings.find((d) => d.id === selectedDrawingId) || null;

  // ── 1. Initial Server Hydration ──────────────────────────────────────────
  const isHydratedRef = useRef(false);
  useEffect(() => {
    if (!enabled || isHydratedRef.current) return;
    isHydratedRef.current = true;

    async function fetchDrawings() {
      try {
        const res = await fetch(`/api/drawings?symbol=${encodeURIComponent(symbol)}`);
        if (res.ok) {
          const json = await res.json();
          if (json.drawings && Array.isArray(json.drawings)) {
            setServerDrawings(symbol, json.drawings);
          }
        }
      } catch (err) {
        console.warn('[useDrawings] Server fetch failed, utilizing local persistence:', err);
      }
    }

    fetchDrawings();
  }, [symbol, enabled, setServerDrawings]);

  // ── 2. Debounced Database Sync (on mutation pointer-up) ───────────────────
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevDrawingsJsonRef = useRef<string>('');

  const syncToServer = useCallback(
    (drawings: UserDrawing[]) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await fetch('/api/drawings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol, drawings }),
          });
        } catch (err) {
          console.warn('[useDrawings] Debounced server sync failed:', err);
        }
      }, 600);
    },
    [symbol]
  );

  useEffect(() => {
    const currentList = drawingsBySymbol[symbol] || [];
    const currentJson = JSON.stringify(currentList);
    if (prevDrawingsJsonRef.current && prevDrawingsJsonRef.current !== currentJson) {
      syncToServer(currentList);
    }
    prevDrawingsJsonRef.current = currentJson;
  }, [drawingsBySymbol, symbol, syncToServer]);

  // ── 3. Global Keyboard Shortcuts Listener ────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      // Hotkey: Delete / Backspace -> Delete selected drawing
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedDrawingId) {
          e.preventDefault();
          deleteSelectedDrawing();
        }
      }

      // Hotkey: Escape -> Abort / Deselect
      if (e.key === 'Escape') {
        if (activeTool !== 'CURSOR') {
          setActiveTool('CURSOR');
        } else if (selectedDrawingId) {
          setSelectedDrawingId(null);
        }
      }

      // Tool Switching Hotkeys (without Meta/Ctrl)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') {
          setActiveTool('CURSOR');
        } else if (e.key === 'l' || e.key === 'L') {
          setActiveTool('LINE');
        } else if (e.key === 'r' || e.key === 'R') {
          setActiveTool('RECTANGLE');
        } else if (e.key === 'b' || e.key === 'B') {
          setActiveTool('FREEHAND');
        }
      }

      // Undo / Redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z)
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (e.shiftKey) {
            redo(symbol);
          } else {
            undo(symbol);
          }
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          redo(symbol);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    enabled,
    selectedDrawingId,
    activeTool,
    symbol,
    deleteSelectedDrawing,
    setActiveTool,
    setSelectedDrawingId,
    undo,
    redo,
  ]);

  return {
    drawings: activeDrawings,
    allSymbolDrawings: drawingsBySymbol[symbol] || [],
    selectedDrawing,
    selectedDrawingId,
    activeTool,
    toolStyles,
    isGlobalVisible,
    setActiveTool,
    setSelectedDrawingId,
    setToolStyle,
    updateSelectedDrawingStyle,
    addDrawing,
    updateDrawing,
    deleteDrawing,
    deleteSelectedDrawing,
    clearDrawings: () => clearDrawings(symbol),
    duplicateDrawing,
    toggleLock,
    toggleGlobalVisibility,
    undo: () => undo(symbol),
    redo: () => redo(symbol),
  };
}
