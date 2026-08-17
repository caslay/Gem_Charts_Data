import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LayerState {
  /** Map of layerId -> boolean (enabled/disabled) */
  visibility: Record<string, boolean>;
  /** Toggle visibility of a specific layer */
  toggleVisibility: (layerId: string) => void;
  /** Set absolute visibility of a specific layer */
  setVisibility: (layerId: string, visible: boolean) => void;
}

export const useLayerStore = create<LayerState>()(
  persist(
    (set) => ({
      visibility: {
        fvg: true,
        magnets: true,
        sessions: true,
        displacement: true,
        structure: true,
        order_blocks: true,
        order_blocks_labels: true, // Sub-toggle: compact micro-pills on origin edge
        order_blocks_mt: true,     // Sub-toggle: 50% Mean Threshold dashed midline
        structure_major: true,   // Layer 1: MAJ — 5-bar fractal horizontal ceilings/floors
        structure_int: true,     // Layer 2: INT — Internal dashed breach rays (from macro engine unconfirmed)
        structure_inner: true,   // Layer 3: INN — Inner zigzag paths (from PASS 2 inner engine)
        structure_istr: true,    // iSTR — Volatility suppression gate badge
      },
      toggleVisibility: (layerId) =>
        set((state) => ({
          visibility: {
            ...state.visibility,
            [layerId]: state.visibility[layerId] === false ? true : false,
          },
        })),
      setVisibility: (layerId, visible) =>
        set((state) => ({
          visibility: {
            ...state.visibility,
            [layerId]: visible,
          },
        })),
    }),
    {
      name: 'gem-chart-layers-store', // LocalStorage item key
    }
  )
);
