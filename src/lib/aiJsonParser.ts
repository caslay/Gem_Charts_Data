/**
 * Extract the first balanced JSON object {...} from a raw string.
 * Handles string literals, escaped quotes, and nested braces cleanly.
 */
export function extractFirstJsonObject(str: string): string | null {
  const start = str.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\' && inString) {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          return str.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

/**
 * Robust AI JSON response parser.
 * Handles markdown code blocks, trailing narrative text after position N,
 * multiple JSON objects, unescaped newlines, and trailing commas.
 */
export function safeParseAiJson<T = any>(rawText: string | null | undefined): T | null {
  if (!rawText || typeof rawText !== "string") return null;

  const trimmed = rawText.trim();
  if (!trimmed) return null;

  // 1. Check for markdown code fence ```json ... ```
  let candidate = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i)?.[1]?.trim();

  if (!candidate) {
    candidate = trimmed;
  }

  // 2. Try direct JSON.parse first
  try {
    return JSON.parse(candidate);
  } catch (e) {
    // Direct parse failed (e.g. trailing text after position 168)
  }

  // 3. Extract exact balanced JSON object from candidate or raw text
  const balancedJson = extractFirstJsonObject(candidate) || extractFirstJsonObject(trimmed);
  if (balancedJson) {
    try {
      return JSON.parse(balancedJson);
    } catch (e) {
      // Clean up common AI JSON artifacts (control characters, trailing commas)
      try {
        const cleaned = balancedJson
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // remove control chars
          .replace(/,\s*([}\]])/g, "$1"); // fix trailing commas
        return JSON.parse(cleaned);
      } catch (innerErr) {
        console.warn("[safeParseAiJson] Failed to parse extracted balanced JSON:", innerErr);
      }
    }
  }

  return null;
}
