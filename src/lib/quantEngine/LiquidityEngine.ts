import { Candle, detectActiveFVGs, mapAndConsolidateFVGs } from '../fvgEngine';
import { OrderBlockEngine, InstitutionalOrderBlock } from './OrderBlockEngine';

export interface OrderBlock {
  type: 'BULLISH' | 'BEARISH';
  status: 'ACTIVE_UNMITIGATED' | 'MITIGATED';
  top: number;
  bottom: number;
  origin_time: number;
  mitigation_time?: number;
}

export class LiquidityEngine {
  public activeOrderBlocks: OrderBlock[] = [];
  public institutionalOrderBlocks: InstitutionalOrderBlock[] = [];
  public activeFVGs: any[] = [];
  
  // FIFO processing for Order Blocks
  public processCandlesForLiquidity(candles: Candle[]) {
    // 1. Detect FVGs using the existing fvgEngine (robust wick-mitigation)
    this.activeFVGs = mapAndConsolidateFVGs([{ fvgs: detectActiveFVGs(candles, true), timeframe: 'raw' }]);

    // 2. High-precision Institutional Order Block Detection
    const obEngine = new OrderBlockEngine();
    const { orderBlocks } = obEngine.scanHistoricalOrderBlocks(candles);
    this.institutionalOrderBlocks = orderBlocks;

    
    for (let i = 2; i < candles.length - 1; i++) {
      const prev = candles[i - 1];
      const current = candles[i];
      const next = candles[i + 1];

      // A Bullish Order Block is the last down candle before a strong impulsive up move (which creates a BISI)
      const isBullishImpulse = current.c > current.o && current.h - current.l > (prev.h - prev.l) * 1.5;
      if (isBullishImpulse && prev.c < prev.o) {
        // Check if there is an FVG formed immediately after
        if (next.l > prev.h) {
          this.activeOrderBlocks.push({
            type: 'BULLISH',
            status: 'ACTIVE_UNMITIGATED',
            top: prev.h,
            bottom: prev.l,
            origin_time: prev.t
          });
        }
      }

      // A Bearish Order Block is the last up candle before a strong impulsive down move (which creates a SIBI)
      const isBearishImpulse = current.c < current.o && current.h - current.l > (prev.h - prev.l) * 1.5;
      if (isBearishImpulse && prev.c > prev.o) {
        // Check if there is an FVG formed immediately after
        if (next.h < prev.l) {
          this.activeOrderBlocks.push({
            type: 'BEARISH',
            status: 'ACTIVE_UNMITIGATED',
            top: prev.h,
            bottom: prev.l,
            origin_time: prev.t
          });
        }
      }
    }

    // Process Mitigations for Order Blocks (FIFO)
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      for (const ob of this.activeOrderBlocks) {
        if (ob.status === 'MITIGATED' || c.t <= ob.origin_time) continue;

        if (ob.type === 'BULLISH') {
          // Mitigated if price trades below the 50% mark of the OB
          const ce = (ob.top + ob.bottom) / 2;
          if (c.l <= ce) {
            ob.status = 'MITIGATED';
            ob.mitigation_time = c.t;
          }
        } else {
          // Mitigated if price trades above the 50% mark of the OB
          const ce = (ob.top + ob.bottom) / 2;
          if (c.h >= ce) {
            ob.status = 'MITIGATED';
            ob.mitigation_time = c.t;
          }
        }
      }
    }

    // Filter out mitigated blocks for memory optimization
    this.activeOrderBlocks = this.activeOrderBlocks.filter(ob => ob.status === 'ACTIVE_UNMITIGATED');
  }
}
