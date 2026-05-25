"use client";

import { useEffect, useState } from "react";
import { useMarketDataContext } from "@/context/MarketDataContext";

export default function ThemeSync() {
  const { themeSettings } = useMarketDataContext();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !themeSettings) return null;

  return (
    <style id="dynamic-theme-customizer" dangerouslySetInnerHTML={{
      __html: `
        :root {
          --background: ${themeSettings.light_bg} !important;
          --accent: ${themeSettings.light_accent} !important;
          --up-candle: ${themeSettings.light_up_candle} !important;
          --down-candle: ${themeSettings.light_down_candle} !important;
          --chart-bg: ${themeSettings.light_bg} !important;
          
          /* Dynamic Card Panel with Opacity Control */
          --card: color-mix(in srgb, ${themeSettings.light_card} ${themeSettings.light_card_opacity}%, transparent) !important;

          /* Phase 2: Interactive and Typography overrides */
          --btn-default: ${themeSettings.light_interactive_default} !important;
          --btn-active: ${themeSettings.light_interactive_active} !important;
          --btn-hover: ${themeSettings.light_interactive_hover} !important;
          --text-title: ${themeSettings.light_text_title} !important;
          --text-label: ${themeSettings.light_text_label} !important;
          --text-value: ${themeSettings.light_text_value} !important;
          --highlight-up: ${themeSettings.light_highlight_up} !important;
          --highlight-down: ${themeSettings.light_highlight_down} !important;
        }
        .dark {
          --background: ${themeSettings.dark_bg} !important;
          --accent: ${themeSettings.dark_accent} !important;
          --up-candle: ${themeSettings.dark_up_candle} !important;
          --down-candle: ${themeSettings.dark_down_candle} !important;
          --chart-bg: ${themeSettings.dark_bg} !important;
          
          /* Dynamic Card Panel with Opacity Control */
          --card: color-mix(in srgb, ${themeSettings.dark_card} ${themeSettings.dark_card_opacity}%, transparent) !important;

          /* Phase 2: Interactive and Typography overrides */
          --btn-default: ${themeSettings.dark_interactive_default} !important;
          --btn-active: ${themeSettings.dark_interactive_active} !important;
          --btn-hover: ${themeSettings.dark_interactive_hover} !important;
          --text-title: ${themeSettings.dark_text_title} !important;
          --text-label: ${themeSettings.dark_text_label} !important;
          --text-value: ${themeSettings.dark_text_value} !important;
          --highlight-up: ${themeSettings.dark_highlight_up} !important;
          --highlight-down: ${themeSettings.dark_highlight_down} !important;
        }
      `
    }} />
  );
}
