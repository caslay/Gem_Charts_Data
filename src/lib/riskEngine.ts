export function calculateDynamicRisk(
  currentPrice: number,
  targetStatus: string,
  pdh: number,
  pdl: number,
  liquidationStatus: string
) {
  // Rule 1: The Kill-Switch
  if (targetStatus === "EXHAUSTED" || liquidationStatus === "LIQUIDITY_SWEPT") {
    return {
      mode: "OBSERVATION_ONLY",
      reason: "Macro targets exhausted or liquidity purged. Market is highly toxic. Await Smart Money Reversal."
    };
  }

  // Rule 2: Half-Risk Continuation (Danger Zone is within $10 of major targets)
  if (Math.abs(currentPrice - pdh) <= 10 || Math.abs(currentPrice - pdl) <= 10) {
    return {
      mode: "HALF_RISK_CONTINUATION",
      reason: "Price is deeply inside the Danger Zone of a major historical magnet. Expect violent volatility or immediate rejection."
    };
  }

  // Rule 3: Clear Runway
  return {
    mode: "FULL_RISK_AUTHORIZED",
    reason: "Clear pricing runway with no immediate macro blockades."
  };
}

import { MappedFVG } from './fvgEngine';
import { RestingLiquidityPools } from './orderFlowEngine';
import { InstitutionalSponsorship } from './displacementEngine';

export interface ATRCandle {
  h: number;
  l: number;
  c: number;
}

/**
 * Calculate the Average True Range (ATR) over a candle series.
 * Uses the standard Wilder's smoothing technique.
 */
export function calculateATR(candles: ATRCandle[], period = 14): number {
  if (candles.length === 0) return 0;
  if (candles.length === 1) return candles[0].h - candles[0].l;

  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      trs.push(c.h - c.l);
    } else {
      const prevC = candles[i - 1];
      const tr = Math.max(
        c.h - c.l,
        Math.abs(c.h - prevC.c),
        Math.abs(c.l - prevC.c)
      );
      trs.push(tr);
    }
  }

  if (trs.length <= period) {
    return trs.reduce((sum, tr) => sum + tr, 0) / trs.length;
  }

  let atr = trs.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

export interface HardInvalidationLevels {
  bearish_invalidation: number | null;
  bullish_invalidation: number | null;
}

export interface TradeExecutionParameters {
  risk_mode: "HALF_RISK_OR_STAND_DOWN" | "FULL_MACRO_RISK" | "STANDARD_RISK";
  closest_active_fvg_ce: number | null;
  hard_invalidation_levels: HardInvalidationLevels;
}

export function generateTradeExecutionParameters(
  target_status: string,
  current_time_window: string,
  institutional_sponsorship: InstitutionalSponsorship,
  currentPrice: number,
  active_fvgs: MappedFVG[],
  resting_liquidity_pools: RestingLiquidityPools,
  candles?: ATRCandle[]
): TradeExecutionParameters {
  let risk_mode: "HALF_RISK_OR_STAND_DOWN" | "FULL_MACRO_RISK" | "STANDARD_RISK" = "STANDARD_RISK";

  const isSponsorshipActive = institutional_sponsorship.status.includes("ACTIVE");
  const isConfidenceValidated = institutional_sponsorship.statistical_validation.confidence_interval_95 === true;

  if (target_status === "EXHAUSTED" || current_time_window === "DEAD_ZONE") {
    risk_mode = "HALF_RISK_OR_STAND_DOWN";
  } else if (target_status.includes("PENDING") && isSponsorshipActive) {
    if (isConfidenceValidated) {
      risk_mode = "FULL_MACRO_RISK";
    } else {
      // Sponsorship is active but fails OLS statistical validation -> downgrade risk
      risk_mode = "HALF_RISK_OR_STAND_DOWN";
    }
  }

  let closest_active_fvg_ce: number | null = null;
  if (active_fvgs.length > 0) {
    let closestDiff = Infinity;
    for (const fvg of active_fvgs) {
      const diff = Math.abs(fvg.ce - currentPrice);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest_active_fvg_ce = parseFloat(fvg.ce.toFixed(2));
      }
    }
  }

  const { BSL_Magnets, SSL_Magnets } = resting_liquidity_pools;

  // Calculate volatility-adjusted buffer with Anti-Micro-Friction Clamp (0.15% minimum buffer)
  const atr = candles ? calculateATR(candles) : 0;
  const rawBuffer = candles && atr > 0 ? 0.2 * atr : 0.50;
  const minBuffer = currentPrice > 0 ? currentPrice * 0.0015 : 0.50;
  const buffer = Math.max(rawBuffer, minBuffer);

  const rawBearish = BSL_Magnets.length > 0 ? Math.max(...BSL_Magnets) + buffer : null;
  const rawBullish = SSL_Magnets.length > 0 ? Math.min(...SSL_Magnets) - buffer : null;

  const bearish_invalidation = rawBearish !== null 
    ? parseFloat((currentPrice > 0 ? Math.max(rawBearish, currentPrice + minBuffer) : rawBearish).toFixed(2)) 
    : null;
    
  const bullish_invalidation = rawBullish !== null 
    ? parseFloat((currentPrice > 0 ? Math.min(rawBullish, currentPrice - minBuffer) : rawBullish).toFixed(2)) 
    : null;

  return {
    risk_mode,
    closest_active_fvg_ce,
    hard_invalidation_levels: {
      bearish_invalidation,
      bullish_invalidation
    }
  };
}

