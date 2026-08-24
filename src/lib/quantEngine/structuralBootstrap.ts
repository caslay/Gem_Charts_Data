import { sql } from "@vercel/postgres";
import { MarketStructureConfig, StructuralBootstrapContext, MidnightLedgerRecord } from './types';
import { MarketStructureAPI } from './MarketStructureAPI';
import { Candle } from '../fvgEngine';

export async function computeStructuralBootstrap(
  symbol: string,
  timeframe: string,
  userStartMs: number,
  config?: MarketStructureConfig
): Promise<{ warmupStartMs: number; bootstrap?: StructuralBootstrapContext }> {
  // 1. Try to fetch the snapshot from the Neon DB for the midnight of userStartMs.
  const snapshotDate = new Date(userStartMs);
  snapshotDate.setUTCHours(0, 0, 0, 0); // round down to midnight UTC
  
  try {
    const { rows } = await sql`
      SELECT state_json FROM quant_lab_daily_structural_snapshots 
      WHERE symbol = ${symbol} 
      AND timeframe = ${timeframe} 
      AND snapshot_date = ${snapshotDate.toISOString()}
      LIMIT 1;
    `;
    
    if (rows.length > 0) {
      const state_json = rows[0].state_json;
      const parsed = typeof state_json === 'string' ? JSON.parse(state_json) : state_json;
      return { 
        warmupStartMs: userStartMs, 
        bootstrap: parsed as StructuralBootstrapContext 
      };
    }
  } catch (err) {
    console.error("[structuralBootstrap] Failed to query snapshot, falling back to dynamic warmup:", err);
  }

  // 2. Fallback: Dynamic warmup
  const intervalMs = timeframeToMs(timeframe);
  const lookbackMajor = config?.lookbackMajor ?? 15;
  const warmupBars = lookbackMajor * 3; 
  const warmupStartMs = Math.max(0, userStartMs - (warmupBars * intervalMs));

  return { warmupStartMs, bootstrap: undefined };
}

export function timeframeToMs(tf: string): number {
  switch (tf) {
    case '1m': return 60000;
    case '5m': return 300000;
    case '15m': return 900000;
    case '1h': return 3600000;
    case '4h': return 14400000;
    case '1d': return 86400000;
    default: return 900000; // default 15m
  }
}

export function generateSnapshot(
  warmupCandles: Candle[],
  config?: MarketStructureConfig
): StructuralBootstrapContext {
  const engine = new MarketStructureAPI(config);
  return engine.analyzeWarmup(warmupCandles);
}

