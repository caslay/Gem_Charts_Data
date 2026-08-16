import type { ChartLayer } from './types';
import { fvgLayer } from './plugins/fvgLayer';
import { magnetsLayer } from './plugins/magnetsLayer';
import { sessionsLayer } from './plugins/sessionsLayer';
import { displacementLayer } from './plugins/displacementLayer';
import { structureLayer } from './plugins/structureLayer';
import { orderBlockLayer } from './plugins/orderBlockLayer';

class LayerRegistry {
  private layers = new Map<string, ChartLayer>();

  constructor() {
    // Automatically register out-of-the-box standard indicator layers
    this.register(fvgLayer);
    this.register(magnetsLayer);
    this.register(sessionsLayer);
    this.register(displacementLayer);
    this.register(structureLayer);
    this.register(orderBlockLayer);
  }

  /**
   * Register a new custom layer plugin dynamically
   */
  public register(layer: ChartLayer): void {
    this.layers.set(layer.id, layer);
  }

  /**
   * Fetch a registered layer by its unique ID
   */
  public get(id: string): ChartLayer | undefined {
    return this.layers.get(id);
  }

  /**
   * Retrieve all registered visual layers
   */
  public getAll(): ChartLayer[] {
    return Array.from(this.layers.values());
  }
}

export const registry = new LayerRegistry();
export { fvgLayer, magnetsLayer, sessionsLayer, displacementLayer, structureLayer, orderBlockLayer };
