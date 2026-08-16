import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  UserDrawing,
  DrawingToolMode,
  DrawingType,
  DrawingStyle,
  DEFAULT_DRAWING_STYLES,
} from './types';

export interface DrawingStoreState {
  /** Map of `${symbol}` -> UserDrawing[] */
  drawingsBySymbol: Record<string, UserDrawing[]>;
  /** Currently active tool */
  activeTool: DrawingToolMode;
  /** Currently selected drawing ID (if in CURSOR mode) */
  selectedDrawingId: string | null;
  /** Active drawing style presets by tool type */
  toolStyles: Record<DrawingType, DrawingStyle>;
  /** Global visibility toggle */
  isGlobalVisible: boolean;
  /** Undo/Redo historical snapshots mapped by `${symbol}` */
  undoStack: Record<string, UserDrawing[][]>;
  redoStack: Record<string, UserDrawing[][]>;

  // Actions
  setActiveTool: (tool: DrawingToolMode) => void;
  setSelectedDrawingId: (id: string | null) => void;
  setToolStyle: (type: DrawingType, style: Partial<DrawingStyle>) => void;
  updateSelectedDrawingStyle: (style: Partial<DrawingStyle>) => void;
  
  getDrawings: (symbol: string, interval?: string) => UserDrawing[];
  addDrawing: (drawing: UserDrawing) => void;
  updateDrawing: (id: string, updates: Partial<UserDrawing>) => void;
  deleteDrawing: (id: string) => void;
  deleteSelectedDrawing: () => void;
  clearDrawings: (symbol: string) => void;
  duplicateDrawing: (id: string) => void;
  toggleLock: (id: string) => void;
  toggleGlobalVisibility: () => void;
  
  undo: (symbol: string) => void;
  redo: (symbol: string) => void;
  
  setServerDrawings: (symbol: string, drawings: UserDrawing[]) => void;
}

const MAX_HISTORY_STEPS = 30;

export const useDrawingStore = create<DrawingStoreState>()(
  persist(
    (set, get) => ({
      drawingsBySymbol: {},
      activeTool: 'CURSOR',
      selectedDrawingId: null,
      toolStyles: { ...DEFAULT_DRAWING_STYLES },
      isGlobalVisible: true,
      undoStack: {},
      redoStack: {},

      setActiveTool: (tool) => {
        set({
          activeTool: tool,
          selectedDrawingId: tool === 'CURSOR' ? get().selectedDrawingId : null,
        });
      },

      setSelectedDrawingId: (id) => {
        set({ selectedDrawingId: id });
      },

      setToolStyle: (type, style) => {
        set((state) => ({
          toolStyles: {
            ...state.toolStyles,
            [type]: {
              ...state.toolStyles[type],
              ...style,
            },
          },
        }));
      },

      updateSelectedDrawingStyle: (styleUpdates) => {
        const { selectedDrawingId, drawingsBySymbol } = get();
        if (!selectedDrawingId) return;

        let targetSymbol: string | null = null;
        for (const [sym, list] of Object.entries(drawingsBySymbol)) {
          if (list.some((d) => d.id === selectedDrawingId)) {
            targetSymbol = sym;
            break;
          }
        }
        if (!targetSymbol) return;

        get().updateDrawing(selectedDrawingId, {
          style: {
            ...drawingsBySymbol[targetSymbol].find((d) => d.id === selectedDrawingId)!.style,
            ...styleUpdates,
          },
        });
      },

      getDrawings: (symbol, interval) => {
        const list = get().drawingsBySymbol[symbol] || [];
        if (!interval) return list;
        return list.filter((d) => !d.interval || d.interval === 'ALL' || d.interval === interval);
      },

      addDrawing: (drawing) => {
        set((state) => {
          const symbol = drawing.symbol;
          const currentList = state.drawingsBySymbol[symbol] || [];
          const currentUndo = state.undoStack[symbol] || [];

          return {
            drawingsBySymbol: {
              ...state.drawingsBySymbol,
              [symbol]: [...currentList, drawing],
            },
            undoStack: {
              ...state.undoStack,
              [symbol]: [...currentUndo.slice(-MAX_HISTORY_STEPS + 1), currentList],
            },
            redoStack: {
              ...state.redoStack,
              [symbol]: [],
            },
            selectedDrawingId: drawing.id,
            activeTool: 'CURSOR', // Auto-switch to cursor for immediate handle adjustment
          };
        });
      },

      updateDrawing: (id, updates) => {
        set((state) => {
          let modifiedSymbol: string | null = null;
          const nextBySymbol: Record<string, UserDrawing[]> = {};

          for (const [sym, list] of Object.entries(state.drawingsBySymbol)) {
            const hasTarget = list.some((d) => d.id === id);
            if (hasTarget) {
              modifiedSymbol = sym;
              nextBySymbol[sym] = list.map((d) =>
                d.id === id
                  ? {
                      ...d,
                      ...updates,
                      updatedAt: Date.now(),
                    }
                  : d
              );
            } else {
              nextBySymbol[sym] = list;
            }
          }

          if (!modifiedSymbol) return state;

          return {
            drawingsBySymbol: nextBySymbol,
          };
        });
      },

      deleteDrawing: (id) => {
        set((state) => {
          let modifiedSymbol: string | null = null;
          const nextBySymbol: Record<string, UserDrawing[]> = {};
          const currentUndoBySymbol = { ...state.undoStack };

          for (const [sym, list] of Object.entries(state.drawingsBySymbol)) {
            const hasTarget = list.some((d) => d.id === id);
            if (hasTarget) {
              modifiedSymbol = sym;
              const currentUndo = state.undoStack[sym] || [];
              currentUndoBySymbol[sym] = [...currentUndo.slice(-MAX_HISTORY_STEPS + 1), list];
              nextBySymbol[sym] = list.filter((d) => d.id !== id);
            } else {
              nextBySymbol[sym] = list;
            }
          }

          return {
            drawingsBySymbol: nextBySymbol,
            undoStack: currentUndoBySymbol,
            redoStack: modifiedSymbol
              ? { ...state.redoStack, [modifiedSymbol]: [] }
              : state.redoStack,
            selectedDrawingId: state.selectedDrawingId === id ? null : state.selectedDrawingId,
          };
        });
      },

      deleteSelectedDrawing: () => {
        const { selectedDrawingId } = get();
        if (selectedDrawingId) {
          get().deleteDrawing(selectedDrawingId);
        }
      },

      clearDrawings: (symbol) => {
        set((state) => {
          const currentList = state.drawingsBySymbol[symbol] || [];
          if (currentList.length === 0) return state;
          const currentUndo = state.undoStack[symbol] || [];

          return {
            drawingsBySymbol: {
              ...state.drawingsBySymbol,
              [symbol]: [],
            },
            undoStack: {
              ...state.undoStack,
              [symbol]: [...currentUndo.slice(-MAX_HISTORY_STEPS + 1), currentList],
            },
            redoStack: {
              ...state.redoStack,
              [symbol]: [],
            },
            selectedDrawingId: null,
          };
        });
      },

      duplicateDrawing: (id) => {
        const { drawingsBySymbol, addDrawing } = get();
        for (const [sym, list] of Object.entries(drawingsBySymbol)) {
          const target = list.find((d) => d.id === id);
          if (target) {
            // Offset duplicate slightly in price and time
            const priceOffset = target.points[0] ? target.points[0].price * 0.002 : 0;
            const newDrawing: UserDrawing = {
              ...target,
              id: `drawing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              points: target.points.map((p) => ({
                price: p.price + priceOffset,
                time: p.time,
              })),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            addDrawing(newDrawing);
            break;
          }
        }
      },

      toggleLock: (id) => {
        const { drawingsBySymbol, updateDrawing } = get();
        for (const list of Object.values(drawingsBySymbol)) {
          const target = list.find((d) => d.id === id);
          if (target) {
            updateDrawing(id, { locked: !target.locked });
            break;
          }
        }
      },

      toggleGlobalVisibility: () => {
        set((state) => ({
          isGlobalVisible: !state.isGlobalVisible,
          selectedDrawingId: !state.isGlobalVisible ? state.selectedDrawingId : null,
        }));
      },

      undo: (symbol) => {
        set((state) => {
          const undoList = state.undoStack[symbol] || [];
          if (undoList.length === 0) return state;

          const previousState = undoList[undoList.length - 1];
          const currentList = state.drawingsBySymbol[symbol] || [];
          const nextUndo = undoList.slice(0, -1);
          const currentRedo = state.redoStack[symbol] || [];

          return {
            drawingsBySymbol: {
              ...state.drawingsBySymbol,
              [symbol]: previousState,
            },
            undoStack: {
              ...state.undoStack,
              [symbol]: nextUndo,
            },
            redoStack: {
              ...state.redoStack,
              [symbol]: [...currentRedo, currentList],
            },
            selectedDrawingId: null,
          };
        });
      },

      redo: (symbol) => {
        set((state) => {
          const redoList = state.redoStack[symbol] || [];
          if (redoList.length === 0) return state;

          const nextState = redoList[redoList.length - 1];
          const currentList = state.drawingsBySymbol[symbol] || [];
          const nextRedo = redoList.slice(0, -1);
          const currentUndo = state.undoStack[symbol] || [];

          return {
            drawingsBySymbol: {
              ...state.drawingsBySymbol,
              [symbol]: nextState,
            },
            undoStack: {
              ...state.undoStack,
              [symbol]: [...currentUndo, currentList],
            },
            redoStack: {
              ...state.redoStack,
              [symbol]: nextRedo,
            },
            selectedDrawingId: null,
          };
        });
      },

      setServerDrawings: (symbol, drawings) => {
        set((state) => {
          // Merge local and server drawings without losing locally created ones
          const localList = state.drawingsBySymbol[symbol] || [];
          const map = new Map<string, UserDrawing>();
          
          // Seed server items
          drawings.forEach((d) => map.set(d.id, d));
          // Seed local items (prefer latest updatedAt)
          localList.forEach((local) => {
            const existing = map.get(local.id);
            if (!existing || (local.updatedAt && local.updatedAt > (existing.updatedAt || 0))) {
              map.set(local.id, local);
            }
          });

          return {
            drawingsBySymbol: {
              ...state.drawingsBySymbol,
              [symbol]: Array.from(map.values()),
            },
          };
        });
      },
    }),
    {
      name: 'gem_user_drawings_store_v1',
      partialize: (state) => ({
        drawingsBySymbol: state.drawingsBySymbol,
        toolStyles: state.toolStyles,
        isGlobalVisible: state.isGlobalVisible,
      }),
    }
  )
);
