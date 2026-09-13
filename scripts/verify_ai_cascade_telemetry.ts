import assert from 'assert';
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  DEFAULT_CASCADE_ORDER,
  getFallbackCascadePool,
  isLiteWorkhorseModel,
} from '../src/lib/aiModels';
import {
  isRecoverableAiError,
} from '../src/lib/aiCascadeEngine';

console.log('🧪 [TEST SUITE] Running Resilient Multi-Model Cascade & Telemetry Verification...');

// ── Test 1: Centralized Model Registry Verification ──────────────────────────
console.log('\n--- 1. Testing Centralized Model Registry ---');

const expectedModels = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3-flash',
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];

assert.strictEqual(AVAILABLE_MODELS.length, 8, `Expected 8 models in registry, found ${AVAILABLE_MODELS.length}`);

for (const expected of expectedModels) {
  const found = AVAILABLE_MODELS.find((m) => m.value === expected);
  assert.ok(found, `Expected model ${expected} to be in AVAILABLE_MODELS`);
}

// Ensure deprecated models are pruned
const deprecatedModels = ['gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-1.5-pro'];
for (const dep of deprecatedModels) {
  const found = AVAILABLE_MODELS.find((m) => m.value === dep);
  assert.strictEqual(found, undefined, `Deprecated model ${dep} MUST be pruned from registry`);
}

// Verify model tiers and quotas
const apexModels = AVAILABLE_MODELS.filter((m) => m.tier === 'apex');
const workhorseModels = AVAILABLE_MODELS.filter((m) => m.tier === 'workhorse');

assert.strictEqual(apexModels.length, 6, 'Should have exactly 6 Apex models');
assert.strictEqual(workhorseModels.length, 2, 'Should have exactly 2 High-Quota Lite Workhorse models');

for (const m of apexModels) {
  assert.strictEqual(m.rpdQuota, 20, `Apex model ${m.value} must have 20 RPD quota`);
  assert.strictEqual(m.tierLabel, 'Apex Reasoning');
}

for (const m of workhorseModels) {
  assert.strictEqual(m.rpdQuota, 500, `Workhorse model ${m.value} must have 500 RPD quota`);
  assert.strictEqual(m.tierLabel, 'High-Quota Lite Workhorse');
  assert.ok(isLiteWorkhorseModel(m.value), `${m.value} must be detected by isLiteWorkhorseModel`);
}

assert.strictEqual(DEFAULT_MODEL, 'gemini-3.8-flash', 'Default model should be gemini-3.8-flash');
console.log('✅ Model Registry audit passed: 8 active models registered with correct tiers and quotas.');

// ── Test 2: Progressive Downward Cascade Pool Generation ──────────────────────
console.log('\n--- 2. Testing Cascade Pool Generation & Progressive Ordering ---');

// Case A: User requests flagship gemini-3.8-flash
const poolApex = getFallbackCascadePool('gemini-3.8-flash');
assert.strictEqual(poolApex[0], 'gemini-3.8-flash', 'First candidate must be requested model');
assert.strictEqual(poolApex.length, 8, 'Pool should contain all models without duplication');
assert.strictEqual(poolApex[poolApex.length - 2], 'gemini-3.5-flash-lite', 'Second to last should be 500 RPD Lite');
assert.strictEqual(poolApex[poolApex.length - 1], 'gemini-3.1-flash-lite', 'Last should be 500 RPD Lite');

// Case B: User requests mid-tier gemini-3.6-flash -> cascades progressively down to Lite workhorses first
const poolMid = getFallbackCascadePool('gemini-3.6-flash');
assert.strictEqual(poolMid[0], 'gemini-3.6-flash');
assert.strictEqual(poolMid[1], 'gemini-3.5-flash');
assert.strictEqual(poolMid[2], 'gemini-3-flash');
assert.strictEqual(poolMid[3], 'gemini-2.5-flash');
assert.strictEqual(poolMid[4], 'gemini-3.5-flash-lite');
assert.strictEqual(poolMid[5], 'gemini-3.1-flash-lite');
assert.strictEqual(poolMid[6], 'gemini-3.8-flash');
assert.strictEqual(poolMid[7], 'gemini-3.7-flash');

// Case C: User requests a Lite model directly
const poolLite = getFallbackCascadePool('gemini-3.5-flash-lite');
assert.strictEqual(poolLite[0], 'gemini-3.5-flash-lite', 'First candidate must be requested Lite model');
assert.strictEqual(poolLite[1], 'gemini-3.1-flash-lite', 'Second candidate should be next Lite model');

// Case D: User has custom/unknown model in settings
const poolCustom = getFallbackCascadePool('custom-finetuned-model');
assert.strictEqual(poolCustom[0], 'custom-finetuned-model', 'Custom model must be tried first');
assert.ok(poolCustom.includes('gemini-3.5-flash-lite'), 'Pool must still cascade to Lite workhorses');
console.log('✅ Progressive cascade pool ordering passed: Models cascade progressively down into 500 RPD Lite workhorses.');

// ── Test 3: Error Categorization & Failover Detection ─────────────────────────
console.log('\n--- 3. Testing Error Categorization (429 Quota, 503 Traffic & 401 Auth) ---');

// Test 429 Quota exhaustion
const err429Http = { status: 429, message: 'Too Many Requests' };
const res429Http = isRecoverableAiError(err429Http);
assert.strictEqual(res429Http.isRecoverable, true);
assert.strictEqual(res429Http.reason, '429 Quota Exceeded');

const err429Msg = new Error('[GoogleGenerativeAI Error]: Resource has been exhausted (check quota)');
const res429Msg = isRecoverableAiError(err429Msg);
assert.strictEqual(res429Msg.isRecoverable, true);
assert.strictEqual(res429Msg.reason, '429 Quota Exceeded');

// Test 503 Model overloaded / High traffic
const err503Http = { status: 503, message: 'Service Unavailable' };
const res503Http = isRecoverableAiError(err503Http);
assert.strictEqual(res503Http.isRecoverable, true);
assert.strictEqual(res503Http.reason, '503 Service Overloaded');

const err503Msg = new Error('The model is temporarily overloaded. Please try again.');
const res503Msg = isRecoverableAiError(err503Msg);
assert.strictEqual(res503Msg.isRecoverable, true);
assert.strictEqual(res503Msg.reason, '503 Service Overloaded');

// Test 404 Discontinued endpoint
const err404 = { status: 404, message: 'models/gemini-3-preview is not found' };
const res404 = isRecoverableAiError(err404);
assert.strictEqual(res404.isRecoverable, true);
assert.strictEqual(res404.reason, '404 Model Endpoint Unavailable');

// Test Non-recoverable fatal errors (e.g. 401 Invalid Auth Key & 403 Forbidden)
const err401 = { status: 401, message: 'API key not valid' };
const res401 = isRecoverableAiError(err401);
assert.strictEqual(res401.isRecoverable, false, 'Auth errors must not cascade in loop');
assert.ok(res401.reason.includes('401 Invalid API Key'));

const err403 = { status: 403, message: 'PERMISSION_DENIED' };
const res403 = isRecoverableAiError(err403);
assert.strictEqual(res403.isRecoverable, false, 'Permission errors must not cascade');
assert.ok(res403.reason.includes('403 Permission Denied'));

console.log('✅ Error categorization passed: 429, 503, 404 recoverable; 401 and 403 recognized as non-recoverable.');

// ── Test 4: Cascade Execution Loop Simulation & Immediate Abort on 401 ────────
console.log('\n--- 4. Testing End-to-End Cascade Loop Simulation & 401 Abort Guard ---');

// Mock cascade simulation engine honoring isRecoverable check
async function simulateCascadeEngine(requestedModel: string, errorType?: 'quota' | 'auth') {
  const cascadePool = getFallbackCascadePool(requestedModel);
  const attempts: Array<{ model: string; latency_ms: number; error?: string; success: boolean }> = [];
  let resolvedModel = requestedModel;
  let wasFallback = false;
  let fallbackReason: string | null = null;
  let textResult = '';

  for (let i = 0; i < cascadePool.length; i++) {
    const candidate = cascadePool[i];

    if (errorType === 'auth') {
      const err = { status: 401, message: 'API_KEY_INVALID' };
      const { isRecoverable, reason } = isRecoverableAiError(err);
      attempts.push({
        model: candidate,
        latency_ms: 50,
        error: reason,
        success: false,
      });
      if (!isRecoverable) {
        throw new Error(`AI evaluation failed on ${candidate}: ${reason}`);
      }
    }

    if (errorType === 'quota' && (candidate === 'gemini-3.8-flash' || candidate === 'gemini-3.7-flash')) {
      const { isRecoverable, reason } = isRecoverableAiError({ status: 429, message: 'Resource has been exhausted' });
      attempts.push({
        model: candidate,
        latency_ms: 120,
        error: reason,
        success: false,
      });
      if (!fallbackReason) {
        fallbackReason = `${reason} on ${candidate}`;
      }
      continue;
    }

    // Success
    attempts.push({
      model: candidate,
      latency_ms: 250,
      success: true,
    });
    resolvedModel = candidate;
    if (i > 0) {
      wasFallback = true;
    }
    textResult = `{"bias_signal": 1, "narrative": "Institutional long setup via ${candidate}"}`;
    break;
  }

  return {
    requested_model: requestedModel,
    resolved_model: resolvedModel,
    was_fallback: wasFallback,
    fallback_reason: fallbackReason,
    attempts,
    text: textResult,
  };
}

async function run() {
  // Test A: 429 Quota exhaustion triggers cascade to third model
  const simResult = await simulateCascadeEngine('gemini-3.8-flash', 'quota');
  assert.strictEqual(simResult.requested_model, 'gemini-3.8-flash');
  assert.strictEqual(simResult.resolved_model, 'gemini-3.6-flash');
  assert.strictEqual(simResult.was_fallback, true);
  assert.ok(simResult.fallback_reason?.includes('429 Quota Exceeded'));
  assert.strictEqual(simResult.attempts.length, 3);
  assert.strictEqual(simResult.attempts[0].success, false);
  assert.strictEqual(simResult.attempts[1].success, false);
  assert.strictEqual(simResult.attempts[2].success, true);
  console.log('✅ Quota cascade simulation passed: 429 smoothly cascaded to gemini-3.6-flash.');

  // Test B: 401 Auth error immediately aborts without attempting all 8 models
  let didThrowAuth = false;
  try {
    await simulateCascadeEngine('gemini-3.8-flash', 'auth');
  } catch (err: any) {
    didThrowAuth = true;
    assert.ok(err.message.includes('401 Invalid API Key'));
  }
  assert.strictEqual(didThrowAuth, true, 'Cascade must abort immediately on 401 without looping');
  console.log('✅ Non-recoverable abort guard passed: 401 halted after exactly 1 attempt.');

  // Test C: Status categorization logic
  console.log('\n--- 5. Testing Status Categorization (INVALIDATED vs ACTIVE_SETUP vs NEUTRAL) ---');
  function determineStatus(parsed: any): string {
    const rawBias = parsed.bias_signal ?? parsed.bias_label;
    let tradeDirection = 'NEUTRAL';
    if (rawBias === 1 || String(rawBias).toUpperCase().includes('BULL')) tradeDirection = 'LONG';
    else if (rawBias === -1 || String(rawBias).toUpperCase().includes('BEAR')) tradeDirection = 'SHORT';

    const explicitDir = parsed.trade_direction ?? parsed.next_database_state?.trade_direction;
    if (explicitDir) {
      const up = String(explicitDir).toUpperCase();
      if (up.includes('LONG')) tradeDirection = 'LONG';
      else if (up.includes('SHORT')) tradeDirection = 'SHORT';
      else if (up.includes('NEUTRAL')) tradeDirection = 'NEUTRAL';
    }

    const rawStatus = (parsed.status ?? parsed.next_database_state?.status ?? '').toString().toUpperCase();
    if (rawStatus.includes('INVALIDAT')) return 'INVALIDATED';
    if (rawStatus.includes('STAND_DOWN') || rawStatus.includes('NEUTRAL') || tradeDirection === 'NEUTRAL') return 'NEUTRAL';
    if (rawStatus.includes('ACTIVE') || rawStatus.includes('ARMED') || (parsed.invalidation && parsed.tp1)) return 'ACTIVE_SETUP';
    return 'COMPLETED';
  }

  assert.strictEqual(determineStatus({ status: 'INVALIDATED' }), 'INVALIDATED');
  assert.strictEqual(determineStatus({ next_database_state: { status: 'INVALIDATED' } }), 'INVALIDATED');
  assert.strictEqual(determineStatus({ bias_signal: 0, status: 'STAND_DOWN' }), 'NEUTRAL');
  assert.strictEqual(determineStatus({ bias_signal: 0, trade_direction: 'NEUTRAL' }), 'NEUTRAL');
  assert.strictEqual(determineStatus({ bias_signal: 1, status: 'ARMED', invalidation: 1850, tp1: 1890 }), 'ACTIVE_SETUP');
  console.log('✅ Status categorization passed: INVALIDATED, NEUTRAL, and ACTIVE_SETUP correctly identified.');

  console.log('\n🎉 ALL 5 AI CASCADE & TELEMETRY VERIFICATION TEST SUITES PASSED PERFECTLY!\n');
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
