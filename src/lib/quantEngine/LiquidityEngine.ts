import { Candle, detectActiveFVGs } from '../fvgEngine';

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
  public activeFVGs: any[] = [];
  
  // FIFO processing for Order Blocks
  public processCandlesForLiquidity(candles: Candle[]) {
    // 1. Detect FVGs using the existing fvgEngine (robust wick-mitigation)
    this.activeFVGs = detectActiveFVGs(candles, true);

    // 2. Simple Volumetric Order Block Detection
    this.activeOrderBlocks = [];
    
    for (let i = 2; i < candles.length - 1; i++) {
      const prev = candles[i - 1];
      const current = candles[i];
      const next = candles[i + 1];

      // A Bullish Order Block is the last down candle before a strong impulsive up move (which creates a BISI)
      const isBullishImpulse = current.close > current.open && current.high - current.low > (prev.high - prev.low) * 1.5;
      if (isBullishImpulse && prev.close < prev.open) {
        // Check if there is an FVG formed immediately after
        if (next.low > prev.high) {
          this.activeOrderBlocks.push({
            type: 'BULLISH',
            status: 'ACTIVE_UNMITIGATED',
            top: prev.high,
            bottom: prev.low,
            origin_time: prev.t
          });
        }
      }

      // A Bearish Order Block is the last up candle before a strong impulsive down move (which creates a SIBI)
      const isBearishImpulse = current.close < current.open && current.high - current.low > (prev.high - prev.low) * 1.5;
      if (isBearishImpulse && prev.close > prev.open) {
        // Check if there is an FVG formed immediately after
        if (next.high < prev.low) {
          this.activeOrderBlocks.push({
            type: 'BEARISH',
            status: 'ACTIVE_UNMITIGATED',
            top: prev.high,
            bottom: prev.low,
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
          if (c.low <= ce) {
            ob.status = 'MITIGATED';
            ob.mitigation_time = c.t;
          }
        } else {
          // Mitigated if price trades above the 50% mark of the OB
          const ce = (ob.top + ob.bottom) / 2;
          if (c.high >= ce) {
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
