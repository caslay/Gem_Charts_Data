export type ModelTier = 'apex' | 'workhorse';

export interface AiModelOption {
  value: string;
  label: string;
  tier: ModelTier;
  tierLabel: string;
  rpdQuota: number;
  description: string;
}

/**
 * Valid Active Gemini Models Registry
 * 
 * Tiers:
 * - Apex Reasoning: Gemini 3.8 Flash, 3.7 Flash, 3.6 Flash, 3.5 Flash, 3 Flash, 2.5 Flash (20 RPD Free Quota)
 * - High-Quota Lite Workhorse: Gemini 3.5 Flash Lite, 3.1 Flash Lite (500 RPD High Capacity)
 */
export const AVAILABLE_MODELS: readonly AiModelOption[] = [
  {
    value: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    tier: "apex",
    tierLabel: "Apex Reasoning",
    rpdQuota: 20,
    description: "Flagship high-reasoning Flash model with deepest structural synthesis (20 RPD Free Quota)",
  },
  {
    value: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    tier: "apex",
    tierLabel: "Apex Reasoning",
    rpdQuota: 20,
    description: "High-reasoning Flash model with deep market structure parsing (20 RPD Free Quota)",
  },
  {
    value: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    tier: "apex",
    tierLabel: "Apex Reasoning",
    rpdQuota: 20,
    description: "Reliable institutional Flash model (20 RPD Free Quota)",
  },
  {
    value: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    tier: "apex",
    tierLabel: "Apex Reasoning",
    rpdQuota: 20,
    description: "Standard balanced reasoning Flash model (20 RPD Free Quota)",
  },
  {
    value: "gemini-3-flash",
    label: "Gemini 3 Flash",
    tier: "apex",
    tierLabel: "Apex Reasoning",
    rpdQuota: 20,
    description: "Baseline Gemini 3 Flash model (20 RPD Free Quota)",
  },
  {
    value: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    tier: "apex",
    tierLabel: "Apex Reasoning",
    rpdQuota: 20,
    description: "Fast stable predecessor model (20 RPD Free Quota)",
  },
  {
    value: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    tier: "workhorse",
    tierLabel: "High-Quota Lite Workhorse",
    rpdQuota: 500,
    description: "High-frequency 500 RPD workhorse for continuous uninterrupted scanning",
  },
  {
    value: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    tier: "workhorse",
    tierLabel: "High-Quota Lite Workhorse",
    rpdQuota: 500,
    description: "High-capacity 500 RPD fallback model for heavy traffic resilience",
  },
] as const;

export const DEFAULT_MODEL = "gemini-3.8-flash";

/**
 * Standard cascade sequence: Apex models first, then 500 RPD Lite workhorses.
 */
export const DEFAULT_CASCADE_ORDER: readonly string[] = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

/**
 * Returns an ordered pool of candidate models starting with the requested model.
 * If the requested model is already a Lite model, it will still prioritize other Lite models
 * before attempting any Apex models.
 */
export function getFallbackCascadePool(requestedModel: string): string[] {
  const cleanRequested = (requestedModel || DEFAULT_MODEL).trim();
  const selectedMeta = AVAILABLE_MODELS.find((m) => m.value === cleanRequested);

  if (selectedMeta && selectedMeta.tier === 'workhorse') {
    // If user explicitly requested a workhorse model, cascade through Lite models first
    const liteModels = AVAILABLE_MODELS.filter((m) => m.tier === 'workhorse').map((m) => m.value);
    const otherLite = liteModels.filter((m) => m !== cleanRequested);
    const apexModels = AVAILABLE_MODELS.filter((m) => m.tier === 'apex').map((m) => m.value);
    return [cleanRequested, ...otherLite, ...apexModels];
  }

  // Progressive downward cascade: requested -> remaining models down to Lite -> higher fallback models
  const idx = DEFAULT_CASCADE_ORDER.indexOf(cleanRequested);
  if (idx !== -1) {
    const following = DEFAULT_CASCADE_ORDER.slice(idx + 1);
    const preceding = DEFAULT_CASCADE_ORDER.slice(0, idx);
    return [cleanRequested, ...following, ...preceding];
  }

  // Fallback for custom or unlisted model: start with requested, then full default cascade order
  const rest = DEFAULT_CASCADE_ORDER.filter((m) => m !== cleanRequested);
  return [cleanRequested, ...rest];
}

/**
 * Check if a given model identifier belongs to a Lite/High-Quota workhorse tier
 */
export function isLiteWorkhorseModel(modelName: string): boolean {
  const found = AVAILABLE_MODELS.find((m) => m.value === modelName);
  return found?.tier === 'workhorse' || modelName.includes('-lite');
}
