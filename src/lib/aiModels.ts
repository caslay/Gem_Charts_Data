export type ModelTier = 'apex' | 'workhorse' | 'community';
export type ModelProvider = 'GOOGLE' | 'OPENROUTER';

export interface AiModelOption {
  value: string;
  label: string;
  tier: ModelTier;
  tierLabel: string;
  provider: ModelProvider;
  rpdQuota: number;
  description: string;
}

/**
 * Valid Active Multi-Model Registry (Google Gemini & OpenRouter DeepSeek)
 * 
 * Tiers:
 * - OpenRouter Community Tier: DeepSeek V4 Flash (200 RPD Free Community Quota)
 * - OpenRouter Flagship: DeepSeek V3 Chat (1000 RPD Commercial Quota)
 * - Google Apex Reasoning: Gemini 3.5 Flash (Primary Default), Gemini 3.8 Flash, 3.7 Flash, 3.6 Flash, 3 Flash (20 RPD Free Quota)
 * - Google High-Quota Lite Workhorse: Gemini 3.5 Flash Lite, 3.1 Flash Lite (500 RPD High Capacity)
 * - OpenRouter Commercial: DeepSeek V3 Chat (1000 RPD Commercial Quota)
 */
export const AVAILABLE_MODELS: readonly AiModelOption[] = [
  // ── Google Gemini Tier (Primary & High-Capacity Workhorses) ──────────────────
  {
    value: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    tier: "apex",
    tierLabel: "Primary Apex Reasoning",
    provider: "GOOGLE",
    rpdQuota: 20,
    description: "Authoritative balanced reasoning Flash model (Primary Production Model)",
  },
  {
    value: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    tier: "workhorse",
    tierLabel: "High-Quota Lite Workhorse",
    provider: "GOOGLE",
    rpdQuota: 500,
    description: "High-frequency 500 RPD workhorse for continuous uninterrupted scanning (Secondary Failover)",
  },
  {
    value: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    tier: "workhorse",
    tierLabel: "High-Quota Lite Workhorse",
    provider: "GOOGLE",
    rpdQuota: 500,
    description: "High-capacity 500 RPD fallback model for heavy traffic resilience",
  },
  {
    value: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    tier: "apex",
    tierLabel: "Apex Reasoning",
    provider: "GOOGLE",
    rpdQuota: 20,
    description: "Flagship high-reasoning Flash model with deepest structural synthesis (20 RPD Free Quota)",
  },
  {
    value: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    tier: "apex",
    tierLabel: "Apex Reasoning",
    provider: "GOOGLE",
    rpdQuota: 20,
    description: "High-reasoning Flash model with deep market structure parsing (20 RPD Free Quota)",
  },
  {
    value: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    tier: "apex",
    tierLabel: "Apex Reasoning",
    provider: "GOOGLE",
    rpdQuota: 20,
    description: "Reliable institutional Flash model (20 RPD Free Quota)",
  },
  {
    value: "gemini-3-flash",
    label: "Gemini 3 Flash",
    tier: "apex",
    tierLabel: "Apex Reasoning",
    provider: "GOOGLE",
    rpdQuota: 20,
    description: "Baseline Gemini 3 Flash model (20 RPD Free Quota)",
  },
  // ── OpenRouter DeepSeek Commercial Tier ───────────────────────────────────────
  {
    value: "deepseek/deepseek-chat",
    label: "DeepSeek V3 (Chat)",
    tier: "apex",
    tierLabel: "Apex Reasoning",
    provider: "OPENROUTER",
    rpdQuota: 1000,
    description: "Flagship DeepSeek V3 institutional reasoning model via OpenRouter API",
  },
] as const;

export const DEFAULT_MODEL = "gemini-3.5-flash";

/**
 * Standard baseline Gemini sequence:
 * 1. Primary: gemini-3.5-flash (authoritative balanced reasoning)
 * 2. High-Quota Secondary Failover: gemini-3.5-flash-lite (500 RPD)
 * 3. Tertiary Workhorse: gemini-3.1-flash-lite (500 RPD)
 * 4. Apex Reserve Pool: gemini-3.8-flash down to gemini-3-flash
 */
export const GEMINI_CASCADE_ORDER: readonly string[] = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3-flash",
] as const;

export const DEFAULT_CASCADE_ORDER: readonly string[] = [
  ...GEMINI_CASCADE_ORDER,
  "deepseek/deepseek-chat",
] as const;

/**
 * Identify the provider for a model (OPENROUTER vs GOOGLE)
 */
export function getModelProvider(modelName: string): ModelProvider {
  const meta = AVAILABLE_MODELS.find((m) => m.value === modelName);
  if (meta) return meta.provider;
  if (modelName.toLowerCase().includes('deepseek') || modelName.includes('/')) {
    return 'OPENROUTER';
  }
  return 'GOOGLE';
}

/**
 * Check whether a model is routed through OpenRouter
 */
export function isOpenRouterModel(modelName: string): boolean {
  return getModelProvider(modelName) === 'OPENROUTER';
}

/**
 * Returns an ordered pool of candidate models starting with the requested model.
 *
 * Cascade Priorities:
 * 1. If OpenRouter model is requested:
 *    - Attempt #1: Active Selected Model (e.g., OpenRouter DeepSeek Chat)
 *    - Attempt #2 (on failover): High-Quota Gemini Flash-Lite Workhorses (3.5 Lite, 3.1 Lite)
 *    - Attempt #3: Gemini Flash Reserve Pool (3.5 Flash, 3.8 Flash, etc.)
 *    - Attempt #4: Remaining commercial OpenRouter models (free tier pruned)
 * 2. If Gemini Lite Workhorse is requested:
 *    - Requested Lite model -> other Lite models -> Gemini 3.5 Flash & Apex models -> OpenRouter models
 * 3. If Gemini Flash/Apex model is requested:
 *    - Requested model -> following in GEMINI_CASCADE_ORDER (e.g. 3.5-flash-lite failover) -> preceding -> OpenRouter models (free tier pruned)
 */
export function getFallbackCascadePool(requestedModel: string): string[] {
  let cleanRequested = (requestedModel || DEFAULT_MODEL).trim();

  // Auto-migrate deprecated/legacy models to authoritative DEFAULT_MODEL (gemini-3.5-flash)
  if (
    cleanRequested === "gemini-2.5-flash" ||
    cleanRequested === "gemini-2.5-flash-lite" ||
    cleanRequested === "deepseek/deepseek-v4-flash-0731:free"
  ) {
    cleanRequested = DEFAULT_MODEL;
  }

  const provider = getModelProvider(cleanRequested);

  // Filter helper: completely bypasses free-tier queue stalls from automated fallback cascades
  const isEligibleFallback = (m: string) => {
    if (m === 'deepseek/deepseek-v4-flash-0731:free' && cleanRequested !== m) {
      return false;
    }
    return true;
  };

  // Case 1: OpenRouter model requested
  if (provider === 'OPENROUTER') {
    const geminiLiteWorkhorses = AVAILABLE_MODELS
      .filter((m) => m.provider === 'GOOGLE' && m.tier === 'workhorse')
      .map((m) => m.value);
    const geminiApexReserve = AVAILABLE_MODELS
      .filter((m) => m.provider === 'GOOGLE' && m.tier === 'apex')
      .map((m) => m.value);
    const otherOpenRouter = AVAILABLE_MODELS
      .filter((m) => m.provider === 'OPENROUTER' && m.value !== cleanRequested && isEligibleFallback(m.value))
      .map((m) => m.value);

    return [
      cleanRequested,
      ...geminiLiteWorkhorses,
      ...geminiApexReserve,
      ...otherOpenRouter,
    ];
  }

  // Case 2: Gemini Lite Workhorse requested
  const selectedMeta = AVAILABLE_MODELS.find((m) => m.value === cleanRequested);
  if (selectedMeta && selectedMeta.tier === 'workhorse') {
    const liteModels = AVAILABLE_MODELS.filter((m) => m.provider === 'GOOGLE' && m.tier === 'workhorse').map((m) => m.value);
    const otherLite = liteModels.filter((m) => m !== cleanRequested);
    const apexModels = AVAILABLE_MODELS.filter((m) => m.provider === 'GOOGLE' && m.tier === 'apex').map((m) => m.value);
    const openRouterModels = AVAILABLE_MODELS.filter((m) => m.provider === 'OPENROUTER' && isEligibleFallback(m.value)).map((m) => m.value);
    return [cleanRequested, ...otherLite, ...apexModels, ...openRouterModels];
  }

  // Case 3: Gemini model requested -> Progressive downward cascade
  const idx = GEMINI_CASCADE_ORDER.indexOf(cleanRequested);
  if (idx !== -1) {
    const following = GEMINI_CASCADE_ORDER.slice(idx + 1);
    const preceding = GEMINI_CASCADE_ORDER.slice(0, idx);
    const openRouterModels = AVAILABLE_MODELS.filter((m) => m.provider === 'OPENROUTER' && isEligibleFallback(m.value)).map((m) => m.value);
    return [cleanRequested, ...following, ...preceding, ...openRouterModels];
  }

  // Case 4: Fallback for custom or unlisted model
  const geminiRest = GEMINI_CASCADE_ORDER.filter((m) => m !== cleanRequested);
  const openRouterRest = AVAILABLE_MODELS.filter((m) => m.provider === 'OPENROUTER' && m.value !== cleanRequested && isEligibleFallback(m.value)).map((m) => m.value);
  return [cleanRequested, ...geminiRest, ...openRouterRest];
}

/**
 * Check if a given model identifier belongs to a Lite/High-Quota workhorse tier
 */
export function isLiteWorkhorseModel(modelName: string): boolean {
  const found = AVAILABLE_MODELS.find((m) => m.value === modelName);
  return found?.tier === 'workhorse' || modelName.includes('-lite');
}
