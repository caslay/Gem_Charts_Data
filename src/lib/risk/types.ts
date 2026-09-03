/**
 * src/lib/risk/types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Quantitative Risk Governor Definitions & Type Interfaces
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface RiskGovernorConfig {
  risk_per_trade_pct: number; // Operational risk ($1.0R) e.g. 2.0%
  max_risk_limit_pct: number; // Hard ceiling e.g. 3.0%
  max_daily_loss_pct: number; // Daily portfolio drawdown cap e.g. 4.0%
  max_daily_loss_usd: number; // Hard USD loss stop e.g. $400.00
  max_consecutive_losses: number; // Streak protection limit e.g. 3
  max_daily_trades: number; // Anti-churn frequency cap e.g. 6
}

export interface RiskGovernorState {
  current_balance: number;
  initial_capital: number;
  daily_realized_pnl: number;
  daily_trades_count: number;
  consecutive_losses_count: number;
  circuit_breaker_active: boolean;
  circuit_breaker_reason: string | null;
  circuit_breaker_tripped_at: string | null;
  circuit_breaker_reset_at: string | null;
}

export type RiskViolationTier =
  | 'CIRCUIT_BREAKER_ACTIVE'
  | 'DAILY_DRAWDOWN_BREACH'
  | 'CONSECUTIVE_LOSS_BREACH'
  | 'DAILY_FREQUENCY_BREACH'
  | 'CEILING_VIOLATION'
  | 'INSUFFICIENT_MARGIN'
  | 'DIRECTIONAL_LOCK';

export interface PreTradeAssessment {
  isApproved: boolean;
  reason: string;
  calculatedRiskUsd: number;
  contractSize: number;
  violationTier?: RiskViolationTier;
}

export interface TradeOutcomeRecord {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  contractSize: number;
  realizedPnl: number;
  realizedR: number;
  isWin: boolean;
  timestamp: number;
  anchorName?: string;
  binanceOrderId?: number;
  binanceClientOrderId?: string;
  exchangeCommission?: number;
  commissionAsset?: string;
}
