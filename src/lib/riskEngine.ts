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
