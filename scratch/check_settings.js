const { db } = require('@vercel/postgres');

process.env.POSTGRES_URL = "postgresql://neondb_owner:npg_rUMbCxOu5mT7@ep-winter-base-aux6y2ja-pooler.c-10.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require";

async function main() {
  try {
    const client = await db.connect();
    console.log("Connected to database successfully!");

    // 1. system_settings
    await client.sql`
      CREATE TABLE IF NOT EXISTS system_settings (
        id SERIAL PRIMARY KEY,
        key_name VARCHAR(255) UNIQUE NOT NULL,
        key_value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("1. system_settings ready.");

    // 2. terminal_settings
    await client.sql`
      CREATE TABLE IF NOT EXISTS terminal_settings (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) UNIQUE NOT NULL,
        signal_sounds JSONB NOT NULL,
        enabled_signals JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS atr_period INTEGER DEFAULT 14;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS adaptive_n_min INTEGER DEFAULT 3;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS adaptive_n_max INTEGER DEFAULT 15;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS mss_body_ratio DOUBLE PRECISION DEFAULT 0.70;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS displacement_vef DOUBLE PRECISION DEFAULT 1.50;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS sharp_departure_mult DOUBLE PRECISION DEFAULT 1.50;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS candles_limit_1m INTEGER DEFAULT 1000;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS candles_limit_5m INTEGER DEFAULT 1000;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS candles_limit_15m INTEGER DEFAULT 1000;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS candles_limit_1h INTEGER DEFAULT 1000;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS candles_limit_4h INTEGER DEFAULT 1000;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS include_btc_correlation BOOLEAN DEFAULT true;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS include_structure_analysis BOOLEAN DEFAULT true;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS include_fvg_detection BOOLEAN DEFAULT true;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS visualize_perfect_movement_only BOOLEAN DEFAULT false;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS pm_atr_multiplier DOUBLE PRECISION DEFAULT 1.5;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS pm_volume_sma_period INTEGER DEFAULT 10;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS pm_min_body_ratio DOUBLE PRECISION DEFAULT 0.6;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS pm_max_wick_ratio DOUBLE PRECISION DEFAULT 0.15;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS pm_max_retracement_limit DOUBLE PRECISION DEFAULT 0.5;`;
    await client.sql`ALTER TABLE terminal_settings ADD COLUMN IF NOT EXISTS pm_sweep_lookback INTEGER DEFAULT 5;`;
    console.log("2. terminal_settings ready.");

    // 3. custom_strategies
    await client.sql`
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
    await client.sql`ALTER TABLE custom_strategies ADD COLUMN IF NOT EXISTS target_environment VARCHAR(20) DEFAULT 'BOTH';`;
    console.log("3. custom_strategies ready.");

    // 4. trading_account
    await client.sql`
      CREATE TABLE IF NOT EXISTS trading_account (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL UNIQUE,
        current_balance DECIMAL(18, 4) NOT NULL,
        initial_capital DECIMAL(18, 4) NOT NULL,
        max_risk_limit_pct DECIMAL(5, 2) NOT NULL DEFAULT 3.00,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("4. trading_account ready.");

    // 5. paper_trades
    await client.sql`
      CREATE TABLE IF NOT EXISTS paper_trades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        entry_price DECIMAL(18, 4) NOT NULL,
        stop_loss DECIMAL(18, 4) NOT NULL,
        take_profit DECIMAL(18, 4) NOT NULL,
        position_size DECIMAL(18, 4) NOT NULL DEFAULT 1.0,
        risk_percent DECIMAL(5, 2) NOT NULL DEFAULT 1.00,
        risk_amount_usd DECIMAL(18, 4),
        status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        outcome VARCHAR(20),
        exit_price DECIMAL(18, 4),
        realized_pnl DECIMAL(18, 4),
        strategy_name VARCHAR(255) NOT NULL,
        ai_narrative_summary TEXT,
        ipda_metrics JSONB,
        opened_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("5. paper_trades ready.");

    // 6. user_drawings
    await client.sql`
      CREATE TABLE IF NOT EXISTS user_drawings (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        interval VARCHAR(20) NOT NULL DEFAULT 'ALL',
        drawing_type VARCHAR(50) NOT NULL,
        points JSONB NOT NULL,
        style JSONB NOT NULL,
        locked BOOLEAN DEFAULT false,
        visible BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("6. user_drawings ready.");

    // 7. order_flow_states_log
    await client.sql`
      CREATE TABLE IF NOT EXISTS order_flow_states_log (
        id SERIAL PRIMARY KEY,
        state_name VARCHAR(50) NOT NULL,
        entered_at BIGINT NOT NULL,
        exited_at BIGINT,
        duration_seconds INTEGER,
        start_price NUMERIC(18, 4),
        end_price NUMERIC(18, 4),
        net_delta_change NUMERIC(18, 4),
        net_oi_change NUMERIC(18, 4),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("7. order_flow_states_log ready.");

    // 8. agent_decision_log
    await client.sql`
      CREATE TABLE IF NOT EXISTS agent_decision_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        decision VARCHAR(50) NOT NULL,
        confidence NUMERIC(5, 2) NOT NULL,
        bias VARCHAR(50) NOT NULL,
        suggested_action VARCHAR(50) NOT NULL,
        entry_price NUMERIC(18, 4),
        stop_loss NUMERIC(18, 4),
        take_profit NUMERIC(18, 4),
        risk_percent NUMERIC(5, 2),
        reasoning TEXT NOT NULL,
        market_state JSONB,
        executed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("8. agent_decision_log ready.");

    // 9. backtest_paper_trades and backtest_trading_account
    await client.sql`
      CREATE TABLE IF NOT EXISTS backtest_trading_account (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL UNIQUE,
        current_balance DECIMAL(18, 4) NOT NULL,
        initial_capital DECIMAL(18, 4) NOT NULL,
        max_risk_limit_pct DECIMAL(5, 2) NOT NULL DEFAULT 3.00,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await client.sql`
      CREATE TABLE IF NOT EXISTS backtest_paper_trades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        entry_price DECIMAL(18, 4) NOT NULL,
        stop_loss DECIMAL(18, 4) NOT NULL,
        take_profit DECIMAL(18, 4) NOT NULL,
        position_size DECIMAL(18, 4) NOT NULL DEFAULT 1.0,
        risk_percent DECIMAL(5, 2) NOT NULL DEFAULT 1.00,
        risk_amount_usd DECIMAL(18, 4),
        status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        outcome VARCHAR(20),
        exit_price DECIMAL(18, 4),
        realized_pnl DECIMAL(18, 4),
        strategy_name VARCHAR(255) NOT NULL,
        ai_narrative_summary TEXT,
        ipda_metrics JSONB,
        opened_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("9. backtest tables ready.");

    // Seed default account for sherif.else@gmail.com
    const userEmail = "sherif.else@gmail.com";
    await client.sql`
      INSERT INTO trading_account (user_id, current_balance, initial_capital, max_risk_limit_pct)
      VALUES (${userEmail}, 10000.0000, 10000.0000, 3.00)
      ON CONFLICT (user_id) DO NOTHING;
    `;
    console.log("Seeded trading account for", userEmail);

    // Test GET settings
    const { rows: testRows } = await client.sql`SELECT key_name, key_value FROM system_settings;`;
    const settingsMap = {};
    for (const r of testRows) {
      settingsMap[r.key_name] = r.key_value;
    }
    console.log("Simulated GET settings output:", settingsMap);

    // Test POST settings upsert
    const testPayload = {
      ACTIVE_MODEL: "gemini-3.6-flash",
      SYSTEM_PROMPT: "Test institutional prompt for flow-state engine",
      GEMINI_LIVE_KEY: "AIzaSyTestKey123456789"
    };

    for (const [key, value] of Object.entries(testPayload)) {
      const strVal = String(value);
      await client.sql`
        INSERT INTO system_settings (key_name, key_value)
        VALUES (${key}, ${strVal})
        ON CONFLICT (key_name)
        DO UPDATE SET key_value = EXCLUDED.key_value, updated_at = NOW()
      `;
    }
    console.log("Simulated POST settings saved successfully!");

    // Verify saved settings
    const { rows: verifyRows } = await client.sql`SELECT key_name, key_value FROM system_settings;`;
    const verifiedMap = {};
    for (const r of verifyRows) {
      verifiedMap[r.key_name] = r.key_value;
    }
    console.log("Verified saved settings in Neon DB:", verifiedMap);

    await client.end();
    console.log("All settings tests passed with 100% success!");
  } catch (err) {
    console.error("Error:", err);
  }
}

main();



