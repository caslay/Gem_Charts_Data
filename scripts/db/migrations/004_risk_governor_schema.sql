-- =====================================================================
-- 🏛️ MIGRATION 004: GLOBAL RISK GOVERNOR & EXCHANGE PARITY SCHEMA
-- =====================================================================
-- Target Database: quegar_db
-- Target Server: AWS Lightsail VPS (localhost:5432)
-- =====================================================================

-- 1. Extend trading_account with Institutional Risk Governor Parameters
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS risk_per_trade_pct DECIMAL(5, 2) NOT NULL DEFAULT 2.00;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS max_daily_loss_pct DECIMAL(5, 2) NOT NULL DEFAULT 4.00;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS max_daily_loss_usd DECIMAL(18, 4) NOT NULL DEFAULT 400.00;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS max_consecutive_losses INTEGER NOT NULL DEFAULT 3;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS max_daily_trades INTEGER NOT NULL DEFAULT 6;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS daily_realized_pnl DECIMAL(18, 4) NOT NULL DEFAULT 0.00;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS consecutive_losses_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS circuit_breaker_active BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS circuit_breaker_reason TEXT;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS circuit_breaker_tripped_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE trading_account ADD COLUMN IF NOT EXISTS circuit_breaker_reset_at TIMESTAMP WITH TIME ZONE;

-- 2. Extend trades table with Exchange Execution & Slippage Parity
ALTER TABLE trades ADD COLUMN IF NOT EXISTS binance_order_id BIGINT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS binance_client_order_id VARCHAR(100);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS binance_stop_loss_order_id BIGINT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exchange_commission DECIMAL(18, 4) DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS commission_asset VARCHAR(20) DEFAULT 'USDC';
ALTER TABLE trades ADD COLUMN IF NOT EXISTS slippage_usd DECIMAL(18, 4) DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(20) DEFAULT 'SHADOW_SIMULATION';
ALTER TABLE trades ADD COLUMN IF NOT EXISTS mfe_r DECIMAL(8, 2) DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS mae_r DECIMAL(8, 2) DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS anchor_name VARCHAR(100);

-- Performance Index for Rapid Execution Reconciliation
CREATE INDEX IF NOT EXISTS idx_trades_binance_client_id ON trades(binance_client_order_id);
CREATE INDEX IF NOT EXISTS idx_trades_execution_mode ON trades(execution_mode);
