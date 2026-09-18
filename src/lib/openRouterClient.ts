/**
 * openRouterClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow-State Quant Engine — OpenRouter OpenAI-Compatible API Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Dispatches quantitative reasoning prompts to OpenRouter models (e.g. DeepSeek)
 * with strict JSON mode enforcement where supported, custom routing headers,
 * automatic fallback on unsupported format errors, and AbortController timeouts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface OpenRouterCallOptions {
  apiKey: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface OpenRouterResponse {
  content: string;
  raw: Record<string, unknown>;
  latencyMs: number;
}

/**
 * Execute a completion request against OpenRouter chat completions API
 */
export async function callOpenRouterApi(options: OpenRouterCallOptions): Promise<OpenRouterResponse> {
  const {
    apiKey,
    model,
    prompt,
    systemPrompt,
    temperature = 0.2,
    maxTokens = 4096,
    timeoutMs = 15000,
  } = options;

  if (!apiKey || !apiKey.trim()) {
    const err = new Error('401 Invalid API Key: OPENROUTER_API_KEY is not configured');
    (err as any).status = 401;
    throw err;
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }
  messages.push({ role: 'user', content: prompt });

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey.trim()}`,
    'HTTP-Referer': process.env.APP_URL || process.env.NEXTAUTH_URL || 'https://quegar-quant.engine',
    'X-Title': 'Quegar Quant Engine',
    'Content-Type': 'application/json',
  };

  const basePayload: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  try {
    // Attempt #1: Request with JSON mode formatting enforced
    let res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...basePayload,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    // Check if provider rejected response_format: json_object (HTTP 400 format unsupported)
    if (!res.ok && res.status === 400) {
      let errorBody: any = null;
      try {
        errorBody = await res.clone().json();
      } catch {
        // ignore parse error
      }
      const errMessage = String(errorBody?.error?.message || errorBody?.message || '');
      if (/response_format|json_object|json mode|unsupported format|schema/i.test(errMessage)) {
        console.warn(
          `[OpenRouter] Model ${model} rejected response_format: json_object. Retrying without response_format wrapper...`
        );
        // Retry without response_format parameter; systemPrompt already enforces JSON output
        res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify(basePayload),
          signal: controller.signal,
        });
      }
    }

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      let errorBody: any = null;
      try {
        errorBody = await res.json();
      } catch {
        // ignore parse error
      }

      const errMessage =
        errorBody?.error?.message ||
        errorBody?.message ||
        `OpenRouter HTTP ${res.status}: ${res.statusText}`;

      const error = new Error(`[OpenRouter Error ${res.status}]: ${errMessage}`);
      (error as any).status = res.status;
      (error as any).response = { status: res.status, data: errorBody };
      throw error;
    }

    const data = await res.json();
    const message = data?.choices?.[0]?.message;
    const content = message?.content ?? message?.reasoning ?? data?.choices?.[0]?.text;

    if (typeof content !== 'string' || !content.trim()) {
      const error = new Error('[OpenRouter] Received empty or invalid content in choices[0].message');
      (error as any).status = 502;
      throw error;
    }

    return {
      content: content.trim(),
      raw: data,
      latencyMs,
    };
  } catch (err: any) {
    if (err.name === 'AbortError' || err.message?.includes('aborted')) {
      const timeoutErr = new Error(`OpenRouter request timed out after ${timeoutMs}ms`);
      (timeoutErr as any).status = 504;
      (timeoutErr as any).code = 'ETIMEDOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
