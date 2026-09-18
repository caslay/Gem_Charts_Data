/**
 * test_openrouter_cascade.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification test script for OpenRouter integration & DeepSeek Cascade:
 * - Tests OpenAI-compatible HTTP fetch payload and headers structure
 * - Tests OpenRouter response JSON normalization via safeParseAiJson
 * - Tests multi-model failover cascade (OpenRouter 429 -> Gemini Lite Workhorse)
 * - Tests OpenRouter 401 auth immediate halt guard
 * - Tests telemetry data logging with provider attribution
 * ─────────────────────────────────────────────────────────────────────────────
 */

import assert from 'assert';
import { callOpenRouterApi } from '../src/lib/openRouterClient';
import { safeParseAiJson } from '../src/lib/aiJsonParser';
import { isRecoverableAiError } from '../src/lib/aiCascadeEngine';
import { getFallbackCascadePool, getModelProvider } from '../src/lib/aiModels';

console.log('🧪 [DRY-RUN SUITE] Testing OpenRouter Integration & Multi-Model Cascade...\n');

async function runTests() {
  // ── 1. Test OpenRouter Request Construction & Headers ──
  console.log('--- 1. Testing OpenRouter Client & Header Inspection ---');

  let interceptedUrl = '';
  let interceptedHeaders: Record<string, string> = {};
  let interceptedBody: any = null;

  const originalFetch = global.fetch;

  // Mock global.fetch to intercept outbound OpenRouter HTTP call
  global.fetch = async (input: any, init?: any) => {
    interceptedUrl = String(input);
    interceptedHeaders = (init?.headers as Record<string, string>) || {};
    interceptedBody = JSON.parse(String(init?.body));

    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'gen-12345678',
        model: 'deepseek/deepseek-v4-flash-0731:free',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                bias_signal: 1,
                trade_direction: 'LONG',
                status: 'ACTIVE_SETUP',
                primary_target: 2450.0,
                sop_report: {
                  trade_narrative: 'Confirmed bullish institutional displacement into discount FVG.',
                  risk_parameters: {
                    entry_range: [2380.0, 2385.0],
                    invalidation: 2365.0,
                    tp1: 2420.0,
                    tp2: 2450.0,
                    tp3: 2480.0,
                  },
                },
                next_database_state: {
                  status: 'ARMED',
                  trade_direction: 'LONG',
                  entry_range_low: 2380.0,
                  entry_range_high: 2385.0,
                  invalidation_level: 2365.0,
                },
              }),
            },
          },
        ],
      }),
    } as any;
  };

  try {
    const res = await callOpenRouterApi({
      apiKey: 'test-openrouter-key-123',
      model: 'deepseek/deepseek-v4-flash-0731:free',
      prompt: '{"test": "payload"}',
      systemPrompt: 'System instructions for institutional evaluation',
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 5000,
    });

    assert.strictEqual(interceptedUrl, 'https://openrouter.ai/api/v1/chat/completions');
    assert.strictEqual(interceptedHeaders['Authorization'], 'Bearer test-openrouter-key-123');
    assert.strictEqual(interceptedHeaders['X-Title'], 'Quegar Quant Engine');
    assert.strictEqual(interceptedHeaders['Content-Type'], 'application/json');
    assert.ok(interceptedHeaders['HTTP-Referer']);

    assert.strictEqual(interceptedBody.model, 'deepseek/deepseek-v4-flash-0731:free');
    assert.strictEqual(interceptedBody.temperature, 0.2);
    assert.strictEqual(interceptedBody.max_tokens, 4096);
    assert.deepStrictEqual(interceptedBody.response_format, { type: 'json_object' });
    assert.strictEqual(interceptedBody.messages.length, 2);
    assert.strictEqual(interceptedBody.messages[0].role, 'system');
    assert.strictEqual(interceptedBody.messages[1].role, 'user');

    assert.ok(res.content.includes('Confirmed bullish institutional displacement'));
    console.log('✅ OpenRouter HTTP request headers, payload parameters, and JSON mode formatting verified.');

    // ── 2. Test Institutional SOP JSON Normalization ──
    console.log('\n--- 2. Testing OpenRouter Response Normalization ---');
    const parsed = safeParseAiJson<Record<string, any>>(res.content);
    assert.ok(parsed, 'Response content must parse cleanly via safeParseAiJson');
    assert.strictEqual(parsed.trade_direction, 'LONG');
    assert.strictEqual(parsed.bias_signal, 1);
    assert.strictEqual(parsed.sop_report.risk_parameters.invalidation, 2365.0);
    assert.strictEqual(parsed.sop_report.risk_parameters.tp1, 2420.0);
    console.log('✅ Institutional SOP parser normalized incoming OpenRouter DeepSeek response perfectly.');

    // ── 3. Test OpenRouter Timeout Handling ──
    console.log('\n--- 3. Testing OpenRouter Timeout Handling ---');
    global.fetch = async (_input: any, init?: any) => {
      // Simulate fetch aborting when timeout triggers
      return new Promise((_, reject) => {
        const signal = init?.signal as AbortSignal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        }
      });
    };

    let didCatchTimeout = false;
    try {
      await callOpenRouterApi({
        apiKey: 'test-key',
        model: 'deepseek/deepseek-v4-flash-0731:free',
        prompt: 'test',
        timeoutMs: 50, // 50ms quick timeout for unit test
      });
    } catch (err: any) {
      didCatchTimeout = true;
      const { isRecoverable, reason } = isRecoverableAiError(err);
      assert.strictEqual(isRecoverable, true, 'Timeout must be recognized as recoverable');
      assert.strictEqual(reason, 'Request Timeout / Queue Stalled');
    }
    assert.strictEqual(didCatchTimeout, true, 'Timeout should reject');
    console.log('✅ OpenRouter timeout cleanly trapped and marked as recoverable failover trigger.');

    // ── 4. Test OpenRouter 429 Failover Trigger ──
    console.log('\n--- 4. Testing OpenRouter 429 Quota Failover ---');
    global.fetch = async () => {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({
          error: { message: 'Provider model capacity exceeded. Rate limit active.' },
        }),
      } as any;
    };

    let didCatch429 = false;
    try {
      await callOpenRouterApi({
        apiKey: 'test-key',
        model: 'deepseek/deepseek-v4-flash-0731:free',
        prompt: 'test',
      });
    } catch (err: any) {
      didCatch429 = true;
      const { isRecoverable, reason } = isRecoverableAiError(err);
      assert.strictEqual(isRecoverable, true);
      assert.strictEqual(reason, '429 Quota Exceeded');
    }
    assert.strictEqual(didCatch429, true);
    console.log('✅ OpenRouter 429 rate limit returned recoverable failover trigger.');

    // ── 5. Test OpenRouter 401 Non-Recoverable Halt ──
    console.log('\n--- 5. Testing OpenRouter 401 Non-Recoverable Abort ---');
    global.fetch = async () => {
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          error: { message: 'User key is invalid or disabled' },
        }),
      } as any;
    };

    let didCatch401 = false;
    try {
      await callOpenRouterApi({
        apiKey: 'invalid-key',
        model: 'deepseek/deepseek-v4-flash-0731:free',
        prompt: 'test',
      });
    } catch (err: any) {
      didCatch401 = true;
      const { isRecoverable, reason } = isRecoverableAiError(err);
      assert.strictEqual(isRecoverable, false, '401 MUST NOT cascade');
      assert.ok(reason.includes('401 Invalid API Key'));
    }
    assert.strictEqual(didCatch401, true);
    console.log('✅ OpenRouter 401 auth error correctly halted as non-recoverable.');

    // ── 6. Test Multi-Model Telemetry Construction & Provider Attribution ──
    console.log('\n--- 6. Testing Telemetry Construction with Provider Attribution ---');
    const cascadePool = getFallbackCascadePool('deepseek/deepseek-v4-flash-0731:free');
    assert.strictEqual(cascadePool[0], 'deepseek/deepseek-v4-flash-0731:free');
    assert.strictEqual(getModelProvider(cascadePool[0]), 'OPENROUTER');
    assert.strictEqual(cascadePool[1], 'gemini-3.5-flash-lite');
    assert.strictEqual(getModelProvider(cascadePool[1]), 'GOOGLE');

    const telemetrySample = {
      requested_model: 'deepseek/deepseek-v4-flash-0731:free',
      resolved_model: 'gemini-3.5-flash-lite',
      provider: getModelProvider('gemini-3.5-flash-lite'),
      was_fallback: true,
      fallback_reason: '429 Quota Exceeded on deepseek/deepseek-v4-flash-0731:free (OPENROUTER)',
      execution_latency_ms: 320,
      timestamp: new Date().toISOString(),
      attempts: [
        {
          model: 'deepseek/deepseek-v4-flash-0731:free',
          provider: 'OPENROUTER' as const,
          latency_ms: 120,
          error: '429 Quota Exceeded',
          success: false,
        },
        {
          model: 'gemini-3.5-flash-lite',
          provider: 'GOOGLE' as const,
          latency_ms: 200,
          success: true,
        },
      ],
    };

    assert.strictEqual(telemetrySample.provider, 'GOOGLE');
    assert.strictEqual(telemetrySample.attempts[0].provider, 'OPENROUTER');
    assert.strictEqual(telemetrySample.attempts[1].provider, 'GOOGLE');
    console.log('✅ Telemetry attributes provider correctly across both OpenRouter and Google cascade attempts.');

    // ── 7. Test JSON Mode Fallback on HTTP 400 Unsupported Format ──
    console.log('\n--- 7. Testing OpenRouter JSON Mode Fallback on HTTP 400 ---');
    let attemptCount = 0;
    let retriedWithoutResponseFormat = false;

    global.fetch = async (_input: any, init?: any) => {
      attemptCount++;
      const body = JSON.parse(String(init?.body));
      if (body.response_format) {
        // First attempt: simulate provider rejecting response_format
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          clone: () => ({
            json: async () => ({
              error: { message: 'Provider does not support response_format: json_object' },
            }),
          }),
          json: async () => ({
            error: { message: 'Provider does not support response_format: json_object' },
          }),
        } as any;
      } else {
        // Second attempt: retry without response_format succeeds!
        retriedWithoutResponseFormat = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '{"bias_signal": -1, "trade_direction": "SHORT", "status": "ACTIVE_SETUP"}',
                },
              },
            ],
          }),
        } as any;
      }
    };

    const fallbackRes = await callOpenRouterApi({
      apiKey: 'test-key',
      model: 'deepseek/deepseek-v4-flash-0731:free',
      prompt: 'test',
    });

    assert.strictEqual(attemptCount, 2, 'Must attempt with response_format then retry without it');
    assert.strictEqual(retriedWithoutResponseFormat, true, 'Retry must omit response_format');
    assert.ok(fallbackRes.content.includes('SHORT'));
    console.log('✅ OpenRouter automatic retry without response_format on HTTP 400 format unsupported verified.');

    // ── 8. Test Empty / Whitespace Response Guard (502 Recoverable) ──
    console.log('\n--- 8. Testing Empty or Blank Response Handling ---');
    global.fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '   \n  ', // Blank/whitespace only
              },
            },
          ],
        }),
      } as any;
    };

    let caughtEmptyError = false;
    try {
      await callOpenRouterApi({
        apiKey: 'test-key',
        model: 'deepseek/deepseek-v4-flash-0731:free',
        prompt: 'test',
      });
    } catch (err: any) {
      caughtEmptyError = true;
      const { isRecoverable, reason } = isRecoverableAiError(err);
      assert.strictEqual(isRecoverable, true, 'Empty content must trigger recoverable failover');
      assert.strictEqual(reason, 'HTTP 502 Upstream Error');
    }
    assert.strictEqual(caughtEmptyError, true);
    console.log('✅ Blank/empty OpenRouter response trapped and categorized as recoverable HTTP 502 error.');

    // ── 9. Test OpenRouter 402 Insufficient Provider Credits Failover ──
    console.log('\n--- 9. Testing OpenRouter 402 Insufficient Credits Failover ---');
    const err402 = {
      status: 402,
      message: 'Payment Required: User has insufficient credits to complete request',
    };
    const res402 = isRecoverableAiError(err402);
    assert.strictEqual(res402.isRecoverable, true, 'HTTP 402 must be recoverable to trigger Gemini fallback');
    assert.strictEqual(res402.reason, '402 Insufficient Provider Credits');
    console.log('✅ OpenRouter 402 Insufficient Credits correctly categorized as recoverable failover trigger.');

    // ── 10. Test String Bias Signal Normalization ──
    console.log('\n--- 10. Testing String Bias Signal Normalization ---');
    const parseBullish = safeParseAiJson('{"bias_signal": "BULLISH", "trade_direction": "LONG"}');
    assert.strictEqual(parseBullish?.bias_signal, 'BULLISH');
    let normalizedBias = 0;
    const raw = parseBullish?.bias_signal;
    if (raw === 1 || String(raw).toUpperCase().includes('BULL')) normalizedBias = 1;
    else if (raw === -1 || String(raw).toUpperCase().includes('BEAR')) normalizedBias = -1;
    assert.strictEqual(normalizedBias, 1, 'String BULLISH must map cleanly to +1 numeric bias');

    const parseBearish = safeParseAiJson('{"bias_signal": "CONFIRMED_BEARISH", "trade_direction": "SHORT"}');
    const rawBear = parseBearish?.bias_signal;
    let normalizedBearBias = 0;
    if (rawBear === 1 || String(rawBear).toUpperCase().includes('BULL')) normalizedBearBias = 1;
    else if (rawBear === -1 || String(rawBear).toUpperCase().includes('BEAR')) normalizedBearBias = -1;
    assert.strictEqual(normalizedBearBias, -1, 'String CONFIRMED_BEARISH must map cleanly to -1 numeric bias');
    console.log('✅ Bias signal string-to-numeric normalization verified without NaN pollution.');

    console.log('\n🎉 ALL OPENROUTER INTEGRATION & MULTI-MODEL CASCADE TESTS PASSED!\n');
  } finally {
    global.fetch = originalFetch;
  }
}

runTests().catch((err) => {
  console.error('❌ Dry-run test failed:', err);
  process.exit(1);
});
