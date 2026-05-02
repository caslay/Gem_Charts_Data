# FLOW-STATE QUANT ENGINE: IDE CORE DIRECTIVES

DO NOT DEVIATE FROM THESE RULES UNDER ANY CIRCUMSTANCES.

1. THE NAKED DATA RULE (V6):
   - The `V6_Naked_Data` export must ALWAYS remain pure. It only contains `ticker`, `timezone`, `open_interest`, and the raw `data_payload` arrays.
   - NEVER inject calculations, moving averages, or IPDA logic into the Naked payload.

2. THE ENRICHED DATA RULE (V7.9+):
   - ALL mathematical and quantitative calculations (Killzones, FVG Scanners, SMT traps, Daily Open) must be injected EXCLUSIVELY into the `ipda_metrics` object of the Enriched export.

3. THE TIMEZONE ANCHOR (CAIRO UTC+3):
   - Binance raw timestamps are UTC. Before ANY calculation is made, timestamps MUST be shifted by +3 hours (`+ 3 * 60 * 60 * 1000`).
   - True Day Open (NY Midnight) is exactly 07:00 AM Cairo Time.
   - The Asian Range is strictly 03:00 to 07:00 Cairo Time.

4. THE FVG MITIGATION LOGIC:
   - A Fair Value Gap (FVG) is only valid if it is UNMITIGATED. Always loop through subsequent candles to verify that no wick has closed the gap before adding it to `active_fvgs`.
