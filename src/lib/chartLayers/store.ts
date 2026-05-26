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
