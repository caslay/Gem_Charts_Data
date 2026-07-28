/**
 * BiasEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Convergent State Matrix solver for Triple-Vector Macro Daily Bias.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface BiasEngineParams {
  true_day_open_0700?: number | null;
  livePrice: number | null;
  nearest_htf_magnet: { label: string; distance: number } | null;
  activeSwingPOC: number | null;
  liquidation_status: string;
  target_status: string;
}

/**
 * Resolves the triple-vector macro daily bias by evaluating structural,
 * dealing range equilibrium, and volumetric/liquidation vectors.
 *
 * @param params Parameters including live price, nearest magnet, POC, and statuses.
 * @returns 'CONFIRMED_BULLISH' | 'CONFIRMED_BEARISH' | 'NEUTRAL'
 */
export function resolveTripleVectorBias(params: BiasEngineParams): 'CONFIRMED_BULLISH' | 'CONFIRMED_BEARISH' | 'NEUTRAL' {
  const {
    livePrice,
    nearest_htf_magnet,
    activeSwingPOC,
    liquidation_status,
    target_status,
  } = params;

  if (
    livePrice === null ||
    livePrice === 0 ||
    nearest_htf_magnet === null ||
    activeSwingPOC === null
  ) {
    return 'NEUTRAL';
  }

  // Vector 1 (Pricing Zone / POC): Is current price in Discount relative to activeSwingPOC (Bullish) or Premium (Bearish)?
  const v1Bullish = livePrice < activeSwingPOC;
  const v1Bearish = livePrice > activeSwingPOC;

  // Vector 2 (Structure): Is the HTF magnet pointing in the anticipated direction?
  // Bullish magnets (above price): PWH, PMH, DAILY_SIBI
  // Bearish magnets (below price): PWL, PML, DAILY_BISI
  const bullishMagnets = ['PWH', 'PMH', 'DAILY_SIBI'];
  const bearishMagnets = ['PWL', 'PML', 'DAILY_BISI'];
  const v2Bullish = bullishMagnets.includes(nearest_htf_magnet.label);
  const v2Bearish = bearishMagnets.includes(nearest_htf_magnet.label);

  // Vector 3 (Volume/Liquidity): Is the active Swing POC supporting the move, and has a LIQUIDATION_STATUS sweep occurred?
  const sweepOccurred =
    liquidation_status === 'LIQUIDITY_SWEPT' ||
    (target_status && target_status !== 'PENDING' && target_status !== 'UNKNOWN');

  const v3Bullish = livePrice >= activeSwingPOC && sweepOccurred;
  const v3Bearish = livePrice <= activeSwingPOC && sweepOccurred;

  if (v1Bullish && v2Bullish && v3Bullish) {
    return 'CONFIRMED_BULLISH';
  }

  if (v1Bearish && v2Bearish && v3Bearish) {
    return 'CONFIRMED_BEARISH';
  }

  return 'NEUTRAL';
}
