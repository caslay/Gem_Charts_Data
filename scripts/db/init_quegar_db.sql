-- =====================================================================
-- 🏛️ QUEGAR QUANT ENGINE — LOCAL POSTGRESQL INITIALIZATION SCRIPT
-- =====================================================================
-- Target Database: quegar_db
-- Target Server: AWS Lightsail VPS (localhost:5432)
-- Architecture: Decoupled VPS (Read/Write) & Local Sandbox (Read-Only)
-- =====================================================================

-- Step 1: Create Database Tables
CREATE TABLE IF NOT EXISTS system_settings (
  id SERIAL PRIMARY KEY,
  key_name VARCHAR(255) UNIQUE NOT NULL,
  key_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS terminal_settings (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) UNIQUE NOT NULL,
  signal_sounds JSONB NOT NULL,
  enabled_signals JSONB NOT NULL,
  atr_period INTEGER DEFAULT 14,
  adaptive_n_min INTEGER DEFAULT 3,
  adaptive_n_max INTEGER DEFAULT 15,
  mss_body_ratio DOUBLE PRECISION DEFAULT 0.70,
  displacement_vef DOUBLE PRECISION DEFAULT 1.50,
  sharp_departure_mult DOUBLE PRECISION DEFAULT 1.50,
  candles_limit_1m INTEGER DEFAULT 1000,
  candles_limit_5m INTEGER DEFAULT 1000,
  candles_limit_15m INTEGER DEFAULT 1000,
  candles_limit_1h INTEGER DEFAULT 1000,
  candles_limit_4h INTEGER DEFAULT 1000,
  include_btc_correlation BOOLEAN DEFAULT true,
  include_structure_analysis BOOLEAN DEFAULT true,
  include_fvg_detection BOOLEAN DEFAULT true,
  visualize_perfect_movement_only BOOLEAN DEFAULT false,
  pm_atr_multiplier DOUBLE PRECISION DEFAULT 1.5,
  pm_volume_sma_period INTEGER DEFAULT 10,
  pm_min_body_ratio DOUBLE PRECISION DEFAULT 0.6,
  pm_max_wick_ratio DOUBLE PRECISION DEFAULT 0.15,
  pm_max_retracement_limit DOUBLE PRECISION DEFAULT 0.5,
  pm_sweep_lookback INTEGER DEFAULT 5,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS custom_strategies (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  direction VARCHAR(10) NOT NULL,
  trigger_conditions JSONB NOT NULL,
  invalidation_conditions JSONB NOT NULL,
  take_profit_conditions JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_decision_log (
  id SERIAL PRIMARY KEY,
  decision_id VARCHAR(255) UNIQUE,
  agent_id VARCHAR(255) NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  bias_signal VARCHAR(50) NOT NULL,
  entry_range_low DOUBLE PRECISION,
  entry_range_high DOUBLE PRECISION,
  invalidation_level DOUBLE PRECISION,
  target_1 DOUBLE PRECISION,
  target_2 DOUBLE PRECISION,
  narrative TEXT,
  market_state JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id SERIAL PRIMARY KEY,
  client_id VARCHAR(255) NOT NULL,
  access_token VARCHAR(255) UNIQUE NOT NULL,
  refresh_token VARCHAR(255) UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  scope VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  trade_id VARCHAR(255) UNIQUE NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL,
  exit_price DOUBLE PRECISION,
  stop_loss DOUBLE PRECISION NOT NULL,
  take_profit_1 DOUBLE PRECISION,
  take_profit_2 DOUBLE PRECISION,
  status VARCHAR(50) NOT NULL,
  realized_pnl DOUBLE PRECISION DEFAULT 0,
  realized_r DOUBLE PRECISION DEFAULT 0,
  entry_time TIMESTAMP NOT NULL,
  exit_time TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: Performance Indexes
CREATE INDEX IF NOT EXISTS idx_agent_decision_created ON agent_decision_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_entry_time ON trades(entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens ON oauth_access_tokens(access_token);
