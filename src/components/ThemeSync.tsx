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

          /* Header Customizations */
          --header-bg: ${themeSettings.light_header_bg} !important;
          --header-border: ${themeSettings.light_header_border} !important;
          --header-text: ${themeSettings.light_header_text} !important;
          --header-icon: ${themeSettings.light_header_icon} !important;
          --nav-link-idle: ${themeSettings.light_header_link_idle} !important;
          --nav-link-hover: ${themeSettings.light_header_link_hover} !important;
          --nav-link-active: ${themeSettings.light_header_link_active} !important;
          --nav-link-active-bg: ${themeSettings.light_header_link_active_bg} !important;

          /* Chart Customizations */
          --chart-grid: ${themeSettings.light_chart_grid} !important;
          --chart-border: ${themeSettings.light_chart_border} !important;
          --chart-text: ${themeSettings.light_chart_text} !important;
          --chart-swing-high: ${themeSettings.light_chart_swing_high} !important;
          --chart-swing-low: ${themeSettings.light_chart_swing_low} !important;
          --chart-swing-high-internal: ${themeSettings.light_chart_swing_high_internal} !important;
          --chart-swing-low-internal: ${themeSettings.light_chart_swing_low_internal} !important;
          --chart-bos: ${themeSettings.light_chart_bos} !important;
          --chart-mss: ${themeSettings.light_chart_mss} !important;
          --chart-fvg-bullish: ${themeSettings.light_chart_fvg_bullish} !important;
          --chart-fvg-bearish: ${themeSettings.light_chart_fvg_bearish} !important;
          --chart-tdo: ${themeSettings.light_chart_tdo} !important;
          --chart-session-asian: ${themeSettings.light_chart_session_asian} !important;
          --chart-session-london: ${themeSettings.light_chart_session_london} !important;
          --chart-magnet-bsl: ${themeSettings.light_chart_magnet_bsl} !important;
          --chart-magnet-ssl: ${themeSettings.light_chart_magnet_ssl} !important;
          --volumetric-strong-arrow: ${themeSettings.light_chart_volumetric_strong_arrow} !important;

          /* UI Button Variations */
          --btn-solid-bg: ${themeSettings.light_btn_solid_bg} !important;
          --btn-solid-bg-hover: ${themeSettings.light_btn_solid_bg_hover} !important;
          --btn-solid-text: ${themeSettings.light_btn_solid_text} !important;
          --btn-trans-border: ${themeSettings.light_btn_trans_border} !important;
          --btn-trans-bg-hover: ${themeSettings.light_btn_trans_bg_hover} !important;
          --btn-trans-text: ${themeSettings.light_btn_trans_text} !important;

          /* Sidebar Typography Customizations */
          --text-sidebar-title: ${themeSettings.light_text_sidebar_title} !important;
          --text-sidebar-label: ${themeSettings.light_text_sidebar_label} !important;
          --text-sidebar-value: ${themeSettings.light_text_sidebar_value} !important;
          --text-sidebar-notes: ${themeSettings.light_text_sidebar_notes} !important;

          /* Manual Trading Entry Lines */
          --manual-entry-line: ${themeSettings.theme_manual_entry_line} !important;
          --manual-tp-line: ${themeSettings.theme_manual_tp_line} !important;
          --manual-sl-line: ${themeSettings.theme_manual_sl_line} !important;
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

          /* Header Customizations */
          --header-bg: ${themeSettings.dark_header_bg} !important;
          --header-border: ${themeSettings.dark_header_border} !important;
          --header-text: ${themeSettings.dark_header_text} !important;
          --header-icon: ${themeSettings.dark_header_icon} !important;
          --nav-link-idle: ${themeSettings.dark_header_link_idle} !important;
          --nav-link-hover: ${themeSettings.dark_header_link_hover} !important;
          --nav-link-active: ${themeSettings.dark_header_link_active} !important;
          --nav-link-active-bg: ${themeSettings.dark_header_link_active_bg} !important;

          /* Chart Customizations */
          --chart-grid: ${themeSettings.dark_chart_grid} !important;
          --chart-border: ${themeSettings.dark_chart_border} !important;
          --chart-text: ${themeSettings.dark_chart_text} !important;
          --chart-swing-high: ${themeSettings.dark_chart_swing_high} !important;
          --chart-swing-low: ${themeSettings.dark_chart_swing_low} !important;
          --chart-swing-high-internal: ${themeSettings.dark_chart_swing_high_internal} !important;
          --chart-swing-low-internal: ${themeSettings.dark_chart_swing_low_internal} !important;
          --chart-bos: ${themeSettings.dark_chart_bos} !important;
          --chart-mss: ${themeSettings.dark_chart_mss} !important;
          --chart-fvg-bullish: ${themeSettings.dark_chart_fvg_bullish} !important;
          --chart-fvg-bearish: ${themeSettings.dark_chart_fvg_bearish} !important;
          --chart-tdo: ${themeSettings.dark_chart_tdo} !important;
          --chart-session-asian: ${themeSettings.dark_chart_session_asian} !important;
          --chart-session-london: ${themeSettings.dark_chart_session_london} !important;
          --chart-magnet-bsl: ${themeSettings.dark_chart_magnet_bsl} !important;
          --chart-magnet-ssl: ${themeSettings.dark_chart_magnet_ssl} !important;
          --volumetric-strong-arrow: ${themeSettings.dark_chart_volumetric_strong_arrow} !important;

          /* UI Button Variations */
          --btn-solid-bg: ${themeSettings.dark_btn_solid_bg} !important;
          --btn-solid-bg-hover: ${themeSettings.dark_btn_solid_bg_hover} !important;
          --btn-solid-text: ${themeSettings.dark_btn_solid_text} !important;
          --btn-trans-border: ${themeSettings.dark_btn_trans_border} !important;
          --btn-trans-bg-hover: ${themeSettings.dark_btn_trans_bg_hover} !important;
          --btn-trans-text: ${themeSettings.dark_btn_trans_text} !important;

          /* Sidebar Typography Customizations */
          --text-sidebar-title: ${themeSettings.dark_text_sidebar_title} !important;
          --text-sidebar-label: ${themeSettings.dark_text_sidebar_label} !important;
          --text-sidebar-value: ${themeSettings.dark_text_sidebar_value} !important;
          --text-sidebar-notes: ${themeSettings.dark_text_sidebar_notes} !important;

          /* Manual Trading Entry Lines */
          --manual-entry-line: ${themeSettings.theme_manual_entry_line} !important;
          --manual-tp-line: ${themeSettings.theme_manual_tp_line} !important;
          --manual-sl-line: ${themeSettings.theme_manual_sl_line} !important;
        }
      `
    }} />
  );
}
