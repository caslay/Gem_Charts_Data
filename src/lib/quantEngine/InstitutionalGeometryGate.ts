/**
 * InstitutionalGeometryGate.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Pre-Broadcast Geometry Gate
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforces strict risk-reward geometry invariants prior to broadcast, staging,
 * or order execution:
 *  1. Invariant 9: Minimum Target 1 (TP1) Distance >= 1.50R
 *  2. Invariant 10: Minimum Overall (TP2) Risk-Reward >= 2.00R
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface GeometryVerdict {
  passed: boolean;
  tp1_rr: number;
  tp2_rr: number;
  riskUsd: number;
  tp1_distance: number;
  tp2_distance: number;
  reason?: string;
}

export class InstitutionalGeometryGate {
  public static readonly MIN_TP1_RR = 1.50;
  public static readonly MIN_OVERALL_RR = 2.00;

  /**
   * Evaluates setup geometry against institutional R:R invariants.
   */
  public static evaluateGeometry(
    entry: number,
    stopLoss: number,
    tp1: number | null | undefined,
    tp2: number | null | undefined,
    direction?: 'LONG' | 'SHORT' | string
  ): GeometryVerdict {
    if (!entry || !stopLoss || isNaN(entry) || isNaN(stopLoss)) {
      return {
        passed: false,
        tp1_rr: 0,
        tp2_rr: 0,
        riskUsd: 0,
        tp1_distance: 0,
        tp2_distance: 0,
        reason: 'Invalid entry or stop loss price',
      };
    }

    const riskUsd = Math.abs(entry - stopLoss);
    if (riskUsd <= 0) {
      return {
        passed: false,
        tp1_rr: 0,
        tp2_rr: 0,
        riskUsd: 0,
        tp1_distance: 0,
        tp2_distance: 0,
        reason: 'Risk distance is zero',
      };
    }

    const isLong = direction
      ? direction.toUpperCase().includes('LONG') || direction.toUpperCase().includes('BULL')
      : tp1 ? tp1 > entry : true;

    // Validate Directional Polarity
    if (isLong && stopLoss >= entry) {
      return {
        passed: false,
        tp1_rr: 0,
        tp2_rr: 0,
        riskUsd,
        tp1_distance: 0,
        tp2_distance: 0,
        reason: 'Long stop loss must reside below entry price',
      };
    }
    if (!isLong && stopLoss <= entry) {
      return {
        passed: false,
        tp1_rr: 0,
        tp2_rr: 0,
        riskUsd,
        tp1_distance: 0,
        tp2_distance: 0,
        reason: 'Short stop loss must reside above entry price',
      };
    }

    const tp1Dist = tp1 && typeof tp1 === 'number' ? Math.abs(tp1 - entry) : 0;
    const tp2Dist = tp2 && typeof tp2 === 'number' ? Math.abs(tp2 - entry) : 0;

    const tp1_rr = parseFloat((tp1Dist / riskUsd).toFixed(2));
    const tp2_rr = parseFloat((tp2Dist / riskUsd).toFixed(2));

    // Invariant 9 Check: TP1 R:R >= 1.50
    if (tp1_rr < this.MIN_TP1_RR) {
      return {
        passed: false,
        tp1_rr,
        tp2_rr,
        riskUsd,
        tp1_distance: tp1Dist,
        tp2_distance: tp2Dist,
        reason: `[GEOMETRY_REJECTED] Target 1 R:R (${tp1_rr.toFixed(2)}R) violates institutional minimum 1.50R floor`,
      };
    }

    // Invariant 10 Check: Overall TP2 R:R >= 2.00
    if (tp2_rr < this.MIN_OVERALL_RR) {
      return {
        passed: false,
        tp1_rr,
        tp2_rr,
        riskUsd,
        tp1_distance: tp1Dist,
        tp2_distance: tp2Dist,
        reason: `[GEOMETRY_REJECTED] Overall Target 2 R:R (${tp2_rr.toFixed(2)}R) violates institutional minimum 2.00R floor`,
      };
    }

    return {
      passed: true,
      tp1_rr,
      tp2_rr,
      riskUsd,
      tp1_distance: tp1Dist,
      tp2_distance: tp2Dist,
    };
  }

  /**
   * Generates institutionally compliant targets meeting both minimum invariants.
   */
  public static calculateCompliantTargets(
    entry: number,
    stopLoss: number,
    direction: 'LONG' | 'SHORT' | string,
    customTp1Mult: number = 1.50,
    customTp2Mult: number = 3.00
  ): { tp1: number; tp2: number; riskUsd: number } {
    const riskUsd = Math.max(Math.abs(entry - stopLoss), entry * 0.0015);
    const isLong = direction.toUpperCase().includes('LONG') || direction.toUpperCase().includes('BULL');
    const mult1 = Math.max(this.MIN_TP1_RR, customTp1Mult);
    const mult2 = Math.max(this.MIN_OVERALL_RR, customTp2Mult);

    const tp1 = isLong
      ? parseFloat((entry + mult1 * riskUsd).toFixed(4))
      : parseFloat((entry - mult1 * riskUsd).toFixed(4));

    const tp2 = isLong
      ? parseFloat((entry + mult2 * riskUsd).toFixed(4))
      : parseFloat((entry - mult2 * riskUsd).toFixed(4));

    return { tp1, tp2, riskUsd };
  }
}
