import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@vercel/postgres";

/**
 * Settings API — Command Center Backend
 *
 * GET  /api/settings  → Returns all system_settings rows as { key: value } map AND terminal_settings.
 * POST /api/settings  → Upserts key-value pairs into system_settings OR terminal_settings.
 *
 * Both endpoints are protected by NextAuth session validation.
 * Fail-closed: if session is missing, returns 401 immediately.
 */

// Helper to ensure database table is created dynamically (self-healing architecture)
async function initTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS system_settings (
      id SERIAL PRIMARY KEY,
      key_name VARCHAR(255) UNIQUE NOT NULL,
      key_value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS terminal_settings (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) UNIQUE NOT NULL,
      signal_sounds JSONB NOT NULL,
      enabled_signals JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS atr_period INTEGER DEFAULT 14;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS adaptive_n_min INTEGER DEFAULT 3;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS adaptive_n_max INTEGER DEFAULT 15;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS mss_body_ratio DOUBLE PRECISION DEFAULT 0.70;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS displacement_vef DOUBLE PRECISION DEFAULT 1.50;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS sharp_departure_mult DOUBLE PRECISION DEFAULT 1.50;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS candles_limit_1m INTEGER DEFAULT 1000;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS candles_limit_5m INTEGER DEFAULT 1000;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS candles_limit_15m INTEGER DEFAULT 1000;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS candles_limit_1h INTEGER DEFAULT 1000;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS candles_limit_4h INTEGER DEFAULT 1000;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS include_btc_correlation BOOLEAN DEFAULT true;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS include_structure_analysis BOOLEAN DEFAULT true;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS include_fvg_detection BOOLEAN DEFAULT true;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS visualize_perfect_movement_only BOOLEAN DEFAULT false;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS pm_atr_multiplier DOUBLE PRECISION DEFAULT 1.5;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS pm_volume_sma_period INTEGER DEFAULT 10;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS pm_min_body_ratio DOUBLE PRECISION DEFAULT 0.6;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS pm_max_wick_ratio DOUBLE PRECISION DEFAULT 0.15;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS pm_max_retracement_limit DOUBLE PRECISION DEFAULT 0.5;`;
    await sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS pm_sweep_lookback INTEGER DEFAULT 5;`;
  } catch (err) {
    console.error("[SETTINGS API] Failed to alter table terminal_settings:", err);
  }
  await sql`
    CREATE TABLE IF NOT EXISTS custom_strategies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      logic_json JSONB NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await sql`ALTER TABLE custom_strategies ADD COLUMN IF NOT EXISTS target_environment VARCHAR(20) DEFAULT 'BOTH';`;
  } catch (err) {
    console.error("[SETTINGS API] Failed to alter table custom_strategies:", err);
  }
}

// ─── GET: Fetch all settings ──────────────────────────────────────────────────
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    // Ensure the terminal settings schema is loaded
    await initTables();

    // 1. Fetch system settings
    const { rows } = await sql`
      SELECT key_name, key_value FROM system_settings
    `;

    // Transform rows into a clean key-value map
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key_name] = row.key_value;
    }

    // 2. Fetch specific user's terminal settings
    const userEmail = session.user.email;
    const { rows: termRows } = await sql`
      SELECT signal_sounds, enabled_signals, atr_period, adaptive_n_min, adaptive_n_max, mss_body_ratio, displacement_vef, sharp_departure_mult,
             candles_limit_1m, candles_limit_5m, candles_limit_15m, candles_limit_1h, candles_limit_4h,
             include_btc_correlation, include_structure_analysis, include_fvg_detection,
             visualize_perfect_movement_only, pm_atr_multiplier, pm_volume_sma_period, pm_min_body_ratio, pm_max_wick_ratio, pm_max_retracement_limit, pm_sweep_lookback FROM terminal_settings
      WHERE user_id = ${userEmail}
      LIMIT 1
    `;

    const terminalSettings = termRows.length > 0 ? {
      signalSounds: termRows[0].signal_sounds,
      enabledSignals: termRows[0].enabled_signals,
      atrPeriod: termRows[0].atr_period ?? 14,
      adaptiveNMin: termRows[0].adaptive_n_min ?? 3,
      adaptiveNMax: termRows[0].adaptive_n_max ?? 15,
      mssBodyRatio: termRows[0].mss_body_ratio ?? 0.70,
      displacementVef: termRows[0].displacement_vef ?? 1.50,
      sharpDepartureMult: termRows[0].sharp_departure_mult ?? 1.50,
      candlesLimit1m: termRows[0].candles_limit_1m ?? 1000,
      candlesLimit5m: termRows[0].candles_limit_5m ?? 1000,
      candlesLimit15m: termRows[0].candles_limit_15m ?? 1000,
      candlesLimit1h: termRows[0].candles_limit_1h ?? 1000,
      candlesLimit4h: termRows[0].candles_limit_4h ?? 1000,
      includeBtcCorrelation: termRows[0].include_btc_correlation !== false,
      includeStructureAnalysis: termRows[0].include_structure_analysis !== false,
      includeFvgDetection: termRows[0].include_fvg_detection !== false,
      visualizePerfectMovementOnly: !!termRows[0].visualize_perfect_movement_only,
      pmAtrMultiplier: termRows[0].pm_atr_multiplier ?? 0.5,
      pmVolumeSmaPeriod: termRows[0].pm_volume_sma_period ?? 10,
      pmMinBodyRatio: termRows[0].pm_min_body_ratio ?? 0.3,
      pmMaxWickRatio: termRows[0].pm_max_wick_ratio ?? 0.5,
      pmMaxRetracementLimit: termRows[0].pm_max_retracement_limit ?? 0.7,
      pmSweepLookback: termRows[0].pm_sweep_lookback ?? 5,
    } : null;

    return NextResponse.json({ settings, terminalSettings });
  } catch (error: unknown) {
    console.error("[SETTINGS API] GET Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings." },
      { status: 500 }
    );
  }
}

// ─── POST: Upsert settings ───────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: No active session." },
        { status: 401 }
      );
    }

    const body = await req.json();
    
    // Ensure the terminal settings schema is loaded
    await initTables();

    // 1. Handle terminalSettings payload if provided
    if (body.terminalSettings) {
      const {
        signalSounds,
        enabledSignals,
        atrPeriod,
        adaptiveNMin,
        adaptiveNMax,
        mssBodyRatio,
        displacementVef,
        sharpDepartureMult,
        candlesLimit1m,
        candlesLimit5m,
        candlesLimit15m,
        candlesLimit1h,
        candlesLimit4h,
        includeBtcCorrelation,
        includeStructureAnalysis,
        includeFvgDetection,
        visualizePerfectMovementOnly,
        pmAtrMultiplier,
        pmVolumeSmaPeriod,
        pmMinBodyRatio,
        pmMaxWickRatio,
        pmMaxRetracementLimit,
        pmSweepLookback
      } = body.terminalSettings as {
        signalSounds: Record<string, string>;
        enabledSignals: Record<string, boolean>;
        atrPeriod?: number;
        adaptiveNMin?: number;
        adaptiveNMax?: number;
        mssBodyRatio?: number;
        displacementVef?: number;
        sharpDepartureMult?: number;
        candlesLimit1m?: number;
        candlesLimit5m?: number;
        candlesLimit15m?: number;
        candlesLimit1h?: number;
        candlesLimit4h?: number;
        includeBtcCorrelation?: boolean;
        includeStructureAnalysis?: boolean;
        includeFvgDetection?: boolean;
        visualizePerfectMovementOnly?: boolean;
        pmAtrMultiplier?: number;
        pmVolumeSmaPeriod?: number;
        pmMinBodyRatio?: number;
        pmMaxWickRatio?: number;
        pmMaxRetracementLimit?: number;
        pmSweepLookback?: number;
      };

      if (!signalSounds || !enabledSignals) {
        return NextResponse.json(
          { error: "Invalid payload: 'terminalSettings' with 'signalSounds' and 'enabledSignals' required." },
          { status: 400 }
        );
      }

      const userEmail = session.user.email;
      const atr_period = atrPeriod ?? 14;
      const adaptive_n_min = adaptiveNMin ?? 3;
      const adaptive_n_max = adaptiveNMax ?? 15;
      const mss_body_ratio = mssBodyRatio ?? 0.70;
      const displacement_vef = displacementVef ?? 1.50;
      const sharp_departure_mult = sharpDepartureMult ?? 1.50;
      const candles_limit_1m = candlesLimit1m ?? 1000;
      const candles_limit_5m = candlesLimit5m ?? 1000;
      const candles_limit_15m = candlesLimit15m ?? 1000;
      const candles_limit_1h = candlesLimit1h ?? 1000;
      const candles_limit_4h = candlesLimit4h ?? 1000;
      const include_btc_correlation = includeBtcCorrelation !== false;
      const include_structure_analysis = includeStructureAnalysis !== false;
      const include_fvg_detection = includeFvgDetection !== false;
      const visualize_perfect_movement_only = !!visualizePerfectMovementOnly;
      const pm_atr_multiplier = pmAtrMultiplier ?? 0.5;
      const pm_volume_sma_period = pmVolumeSmaPeriod ?? 10;
      const pm_min_body_ratio = pmMinBodyRatio ?? 0.3;
      const pm_max_wick_ratio = pmMaxWickRatio ?? 0.5;
      const pm_max_retracement_limit = pmMaxRetracementLimit ?? 0.7;
      const pm_sweep_lookback = pmSweepLookback ?? 5;

      await sql`
        INSERT INTO terminal_settings (
          user_id, signal_sounds, enabled_signals, 
          atr_period, adaptive_n_min, adaptive_n_max, 
          mss_body_ratio, displacement_vef, sharp_departure_mult, 
          candles_limit_1m, candles_limit_5m, candles_limit_15m, candles_limit_1h, candles_limit_4h,
          include_btc_correlation, include_structure_analysis, include_fvg_detection,
          visualize_perfect_movement_only, pm_atr_multiplier, pm_volume_sma_period, pm_min_body_ratio, pm_max_wick_ratio, pm_max_retracement_limit, pm_sweep_lookback,
          updated_at
        )
        VALUES (
          ${userEmail}, ${JSON.stringify(signalSounds)}, ${JSON.stringify(enabledSignals)},
          ${atr_period}, ${adaptive_n_min}, ${adaptive_n_max},
          ${mss_body_ratio}, ${displacement_vef}, ${sharp_departure_mult},
          ${candles_limit_1m}, ${candles_limit_5m}, ${candles_limit_15m}, ${candles_limit_1h}, ${candles_limit_4h},
          ${include_btc_correlation}, ${include_structure_analysis}, ${include_fvg_detection},
          ${visualize_perfect_movement_only}, ${pm_atr_multiplier}, ${pm_volume_sma_period}, ${pm_min_body_ratio}, ${pm_max_wick_ratio}, ${pm_max_retracement_limit}, ${pm_sweep_lookback},
          NOW()
        )
        ON CONFLICT (user_id)
        DO UPDATE SET 
          signal_sounds = EXCLUDED.signal_sounds,
          enabled_signals = EXCLUDED.enabled_signals,
          atr_period = EXCLUDED.atr_period,
          adaptive_n_min = EXCLUDED.adaptive_n_min,
          adaptive_n_max = EXCLUDED.adaptive_n_max,
          mss_body_ratio = EXCLUDED.mss_body_ratio,
          displacement_vef = EXCLUDED.displacement_vef,
          sharp_departure_mult = EXCLUDED.sharp_departure_mult,
          candles_limit_1m = EXCLUDED.candles_limit_1m,
          candles_limit_5m = EXCLUDED.candles_limit_5m,
          candles_limit_15m = EXCLUDED.candles_limit_15m,
          candles_limit_1h = EXCLUDED.candles_limit_1h,
          candles_limit_4h = EXCLUDED.candles_limit_4h,
          include_btc_correlation = EXCLUDED.include_btc_correlation,
          include_structure_analysis = EXCLUDED.include_structure_analysis,
          include_fvg_detection = EXCLUDED.include_fvg_detection,
          visualize_perfect_movement_only = EXCLUDED.visualize_perfect_movement_only,
          pm_atr_multiplier = EXCLUDED.pm_atr_multiplier,
          pm_volume_sma_period = EXCLUDED.pm_volume_sma_period,
          pm_min_body_ratio = EXCLUDED.pm_min_body_ratio,
          pm_max_wick_ratio = EXCLUDED.pm_max_wick_ratio,
          pm_max_retracement_limit = EXCLUDED.pm_max_retracement_limit,
          pm_sweep_lookback = EXCLUDED.pm_sweep_lookback,
          updated_at = NOW()
      `;

      return NextResponse.json({ success: true, message: "Terminal settings saved." });
    }

    // 2. Otherwise, handle legacy system settings payload
    const { settings } = body as { settings: Record<string, string> };

    if (!settings || typeof settings !== "object") {
      return NextResponse.json(
        { error: "Invalid payload: 'settings' object required." },
        { status: 400 }
      );
    }

    // Upsert each key-value pair using ON CONFLICT
    for (const [key, value] of Object.entries(settings)) {
      if (typeof key !== "string" || typeof value !== "string") continue;

      await sql`
        INSERT INTO system_settings (key_name, key_value)
        VALUES (${key}, ${value})
        ON CONFLICT (key_name)
        DO UPDATE SET key_value = EXCLUDED.key_value, updated_at = NOW()
      `;
    }

    return NextResponse.json({ success: true, message: "Settings saved." });
  } catch (error: unknown) {
    console.error("[SETTINGS API] POST Error:", error);
    return NextResponse.json(
      { error: "Failed to save settings." },
      { status: 500 }
    );
  }
}
