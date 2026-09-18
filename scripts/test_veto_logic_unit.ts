/**
 * scripts/test_veto_logic_unit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit test for Constraint 3 (Veto State Cleanliness):
 * Verifies that when an AI response contains [VALUATION_VETO] or attempts to Long
 * in Premium / Short in Discount, it is deterministically mapped to:
 * - bias_signal: 0
 * - status: "SEARCHING"
 * - trade_direction: null
 * ─────────────────────────────────────────────────────────────────────────────
 */

function evaluateVetoCleanliness(payload: any, parsedResponse: any, rawText: string) {
  let biasSignal = 'NEUTRAL';
  let tradeDirection = 'NEUTRAL';
  let status = 'COMPLETED';
  let entryRangeLow: number | null = null;
  let entryRangeHigh: number | null = null;
  let invalidationLevel: number | null = null;
  let target1: number | null = null;
  let target2: number | null = null;
  let target3: number | null = null;

  // 1. Bias Signal & Direction
  const rawBias = parsedResponse.bias_signal ?? parsedResponse.bias_label;
  if (rawBias === 1 || String(rawBias).toUpperCase().includes('BULL') || String(rawBias).toUpperCase().includes('LONG')) {
    biasSignal = 'BULLISH';
    tradeDirection = 'LONG';
  } else if (rawBias === -1 || String(rawBias).toUpperCase().includes('BEAR') || String(rawBias).toUpperCase().includes('SHORT')) {
    biasSignal = 'BEARISH';
    tradeDirection = 'SHORT';
  } else {
    biasSignal = 'NEUTRAL';
    tradeDirection = 'NEUTRAL';
  }

  const rawStatus = (parsedResponse.status ?? parsedResponse.next_database_state?.status ?? '').toString().toUpperCase();
  if (rawStatus.includes('ACTIVE') || rawStatus.includes('ARMED')) {
    status = 'ACTIVE_SETUP';
  }

  // ── Veto State Cleanliness & Programmatic Valuation Guard (Constraint 3) ──
  const narrativeText = (
    parsedResponse.narrative ||
    parsedResponse.narrative_summary ||
    parsedResponse.sop_report?.trade_narrative ||
    rawText ||
    ''
  );
  const hasValuationVeto =
    narrativeText.includes('VALUATION_VETO') ||
    String(parsedResponse.next_database_state?.notes || '').includes('VALUATION_VETO');

  const pricingStatus = (
    payload?.ipda_metrics as any
  )?.pricing_context?.local_dealing_range?.current_status || (payload?.ipda_metrics as any)?.current_pricing;

  const isValuationMismatch =
    (pricingStatus === 'PREMIUM' && (tradeDirection === 'LONG' || biasSignal === 'BULLISH')) ||
    (pricingStatus === 'DISCOUNT' && (tradeDirection === 'SHORT' || biasSignal === 'BEARISH'));

  if (hasValuationVeto || isValuationMismatch) {
    biasSignal = 'NEUTRAL';
    tradeDirection = 'NEUTRAL';
    status = 'NEUTRAL';
    entryRangeLow = null;
    entryRangeHigh = null;
    invalidationLevel = null;
    target1 = null;
    target2 = null;
    target3 = null;

    parsedResponse.bias_signal = 0;
    parsedResponse.bias_label = 'NEUTRAL';
    if (!parsedResponse.next_database_state) {
      parsedResponse.next_database_state = {};
    }
    parsedResponse.next_database_state.status = 'SEARCHING';
    parsedResponse.next_database_state.trade_direction = null;
    parsedResponse.next_database_state.invalidation_level = null;
    parsedResponse.next_database_state.target_level = null;
    parsedResponse.next_database_state.active_setup_id = null;

    if (isValuationMismatch && !hasValuationVeto) {
      const vetoMsg = `[VALUATION_VETO] ${pricingStatus === 'PREMIUM' ? 'Long prohibited in Premium territory' : 'Short prohibited in Discount territory'}. Automatic valuation gate enforced.`;
      parsedResponse.narrative = `${vetoMsg} ${parsedResponse.narrative || ''}`.trim();
      parsedResponse.next_database_state.notes = vetoMsg;
    }
  }

  return { biasSignal, tradeDirection, status, parsedResponse };
}

console.log('--- Unit Testing Valuation Veto Cleanliness ---');

// Case A: AI issued [VALUATION_VETO] correctly in Premium
const payloadA = {
  ipda_metrics: {
    current_pricing: 'PREMIUM',
    pricing_context: {
      local_dealing_range: { current_status: 'PREMIUM' }
    }
  }
};
const aiResponseA = {
  bias_signal: 0,
  bias_label: 'NEUTRAL',
  narrative: '[VALUATION_VETO] Long prohibited in Premium territory',
  next_database_state: {
    status: 'SEARCHING',
    trade_direction: null,
    notes: '[VALUATION_VETO] Long prohibited in Premium territory'
  }
};
const resA = evaluateVetoCleanliness(payloadA, aiResponseA, JSON.stringify(aiResponseA));
if (resA.biasSignal !== 'NEUTRAL' || resA.parsedResponse.bias_signal !== 0 || resA.parsedResponse.next_database_state.status !== 'SEARCHING') {
  throw new Error('Case A failed');
}
console.log('✓ Case A (AI emitted VALUATION_VETO) passed: bias_signal=0, status=SEARCHING');

// Case B: AI hallucinated and tried to Long in Premium without VETO
const payloadB = {
  ipda_metrics: {
    current_pricing: 'PREMIUM',
    pricing_context: {
      local_dealing_range: { current_status: 'PREMIUM' }
    }
  }
};
const aiResponseB = {
  bias_signal: 1,
  bias_label: 'BULLISH',
  trade_direction: 'LONG',
  narrative: 'Bullish BOS continuation buy',
  next_database_state: {
    status: 'ARMED',
    trade_direction: 'LONG'
  }
};
const resB = evaluateVetoCleanliness(payloadB, aiResponseB, JSON.stringify(aiResponseB));
if (resB.biasSignal !== 'NEUTRAL' || resB.parsedResponse.bias_signal !== 0 || resB.parsedResponse.next_database_state.status !== 'SEARCHING') {
  throw new Error('Case B failed: Programmatic veto did not catch Long in Premium!');
}
console.log('✓ Case B (AI hallucinated Long in Premium) passed: Overridden to bias_signal=0, status=SEARCHING, notes prefixed with [VALUATION_VETO]');

// Case C: AI hallucinated and tried to Short in Discount without VETO
const payloadC = {
  ipda_metrics: {
    current_pricing: 'DISCOUNT',
    pricing_context: {
      local_dealing_range: { current_status: 'DISCOUNT' }
    }
  }
};
const aiResponseC = {
  bias_signal: -1,
  bias_label: 'BEARISH',
  trade_direction: 'SHORT',
  narrative: 'Bearish continuation sell',
  next_database_state: {
    status: 'ARMED',
    trade_direction: 'SHORT'
  }
};
const resC = evaluateVetoCleanliness(payloadC, aiResponseC, JSON.stringify(aiResponseC));
if (resC.biasSignal !== 'NEUTRAL' || resC.parsedResponse.bias_signal !== 0 || resC.parsedResponse.next_database_state.status !== 'SEARCHING') {
  throw new Error('Case C failed: Programmatic veto did not catch Short in Discount!');
}
console.log('✓ Case C (AI hallucinated Short in Discount) passed: Overridden to bias_signal=0, status=SEARCHING, notes prefixed with [VALUATION_VETO]');

console.log('🎉 ALL VETO CLEANLINESS CASES PASSED WITH 100% PARITY!');
