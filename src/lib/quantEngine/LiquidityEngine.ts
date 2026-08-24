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
  
  public seedLiquidity(activeFVGs: any[], activeOrderBlocks: any[], institutionalOrderBlocks: any[]) {
    this.activeFVGs = [...activeFVGs];
    this.activeOrderBlocks = [...activeOrderBlocks];
    this.institutionalOrderBlocks = [...institutionalOrderBlocks];
  }
  
  // FIFO processing for Order Blocks
  public processCandlesForLiquidity(candles: Candle[]) {
    // 1. Detect FVGs using the existing fvgEngine (robust wick-mitigation)
    const newFVGs = mapAndConsolidateFVGs([{ fvgs: detectActiveFVGs(candles, true), timeframe: 'raw' }]);
    
    // Merge with seeded FVGs and filter out mitigated ones
    const fvgMap = new Map();
    for (const fvg of [...this.activeFVGs, ...newFVGs]) {
      const key = `${fvg.top}_${fvg.bottom}_${fvg.origin_time}`;
      if (!fvgMap.has(key)) fvgMap.set(key, fvg);
    }
    this.activeFVGs = Array.from(fvgMap.values());
    // (Note: To properly mitigate seeded FVGs, we should run a mitigation check here)
    for (const c of candles) {
      for (const fvg of Array.from(fvgMap.values())) {
        if (fvg.status === 'MITIGATED' || c.t <= fvg.origin_time) continue;
        
        if (fvg.type === 'BISI') {
          if (c.l < fvg.bottom) {
            fvg.status = 'MITIGATED';
          } else if (c.l <= fvg.top) {
            fvg.status = 'RETESTED';
          }
        } else if (fvg.type === 'SIBI') {
          if (c.h > fvg.top) {
            fvg.status = 'MITIGATED';
          } else if (c.h >= fvg.bottom) {
            fvg.status = 'RETESTED';
          }
        }
      }
    }
    
    // Filter out mitigated from active list
    this.activeFVGs = Array.from(fvgMap.values()).filter(fvg => fvg.status !== 'MITIGATED');

    // 2. High-precision Institutional Order Block Detection
    const obEngine = new OrderBlockEngine();
    const { orderBlocks } = obEngine.scanHistoricalOrderBlocks(candles);
    
    const obMap = new Map();
    for (const ob of [...this.institutionalOrderBlocks, ...orderBlocks]) {
       const key = `${ob.type}_${ob.top}_${ob.bottom}_${ob.origin_time}`;
       if (!obMap.has(key)) obMap.set(key, ob);
    }
    this.institutionalOrderBlocks = Array.from(obMap.values());


    
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
