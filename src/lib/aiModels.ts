export interface AiModelOption {
  value: string;
  label: string;
}

export const AVAILABLE_MODELS: readonly AiModelOption[] = [
  { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)" },
  { value: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash (Preview)" },
  { value: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro (Preview)" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
] as const;

export const DEFAULT_MODEL = "gemini-3.6-flash";
