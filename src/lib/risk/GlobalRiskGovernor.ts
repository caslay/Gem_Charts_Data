/**
 * src/lib/risk/GlobalRiskGovernor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Quantitative Pre-Trade Gatekeeper & Circuit Breaker Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforces a strict 3-tier risk hierarchy before any order routes to Binance:
 *  Tier 1: Operational Compounding Sizing (Risk Ratio per Trade $1.0R)
 *  Tier 2: Single-Trade Ceiling (Max Risk Limit %)
 *  Tier 3: Portfolio Circuit Breakers (Daily Drawdown, Consecutive Losses, Trade Cap)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  RiskGovernorConfig,
  RiskGovernorState,
  PreTradeAssessment,
  TradeOutcomeRecord,
} from './types';
import { sql } from '../postgres';

export const DEFAULT_RISK_CONFIG: RiskGovernorConfig = {
  risk_per_trade_pct: 2.00, // 2.00% operational risk per trade ($1.0R)
  max_risk_limit_pct: 3.00, // 3.00% hard ceiling per position
  max_daily_loss_pct: 4.00, // 4.00% daily account drawdown shutdown
  max_daily_loss_usd: 400.00, // $400 USD daily drawdown cap
  max_consecutive_losses: 3, // 3 stop-outs trigger a 6-hour timeout
  max_daily_trades: 6, // 6 trades max per day to stop chop churn
};

export class GlobalRiskGovernor {
  private static inMemoryConfig: RiskGovernorConfig = { ...DEFAULT_RISK_CONFIG };
  private static inMemoryState: RiskGovernorState = {
    current_balance: 10000.0,
    initial_capital: 10000.0,
    daily_realized_pnl: 0.0,
    daily_trades_count: 0,
    consecutive_losses_count: 0,
    circuit_breaker_active: false,
    circuit_breaker_reason: null,
    circuit_breaker_tripped_at: null,
    circuit_breaker_reset_at: null,
  };
  private static lastUtcDay: number = new Date().getUTCDate();

  /**
   * Hydrates risk configuration and account state from PostgreSQL,
   * falling back smoothly to memory for local offline development.
   */
  public static async hydrateState(userEmail: string = 'institutional_admin'): Promise<{
    config: RiskGovernorConfig;
    state: RiskGovernorState;
  }> {
    this.checkSessionRollover();

    try {
      const res = await sql`
        SELECT 
          current_balance,
          initial_capital,
          COALESCE(risk_per_trade_pct, 2.00) as risk_per_trade_pct,
          COALESCE(max_risk_limit_pct, 3.00) as max_risk_limit_pct,
          COALESCE(max_daily_loss_pct, 4.00) as max_daily_loss_pct,
          COALESCE(max_daily_loss_usd, 400.00) as max_daily_loss_usd,
          COALESCE(max_consecutive_losses, 3) as max_consecutive_losses,
          COALESCE(max_daily_trades, 6) as max_daily_trades,
          COALESCE(daily_realized_pnl, 0.00) as daily_realized_pnl,
          COALESCE(consecutive_losses_count, 0) as consecutive_losses_count,
          COALESCE(circuit_breaker_active, false) as circuit_breaker_active,
          circuit_breaker_reason,
          circuit_breaker_tripped_at,
          circuit_breaker_reset_at
        FROM trading_account 
        WHERE user_id = ${userEmail}
        LIMIT 1;
      `;

      if (res.rows && res.rows.length > 0) {
        const row = res.rows[0];
        this.inMemoryConfig = {
          risk_per_trade_pct: parseFloat(row.risk_per_trade_pct) || 2.0,
          max_risk_limit_pct: parseFloat(row.max_risk_limit_pct) || 3.0,
          max_daily_loss_pct: parseFloat(row.max_daily_loss_pct) || 4.0,
          max_daily_loss_usd: parseFloat(row.max_daily_loss_usd) || 400.0,
          max_consecutive_losses: parseInt(row.max_consecutive_losses, 10) || 3,
          max_daily_trades: parseInt(row.max_daily_trades, 10) || 6,
        };

        this.inMemoryState = {
          current_balance: parseFloat(row.current_balance) || 10000.0,
          initial_capital: parseFloat(row.initial_capital) || 10000.0,
          daily_realized_pnl: parseFloat(row.daily_realized_pnl) || 0.0,
          daily_trades_count: this.inMemoryState.daily_trades_count,
          consecutive_losses_count: parseInt(row.consecutive_losses_count, 10) || 0,
          circuit_breaker_active: Boolean(row.circuit_breaker_active),
          circuit_breaker_reason: row.circuit_breaker_reason || null,
          circuit_breaker_tripped_at: row.circuit_breaker_tripped_at
            ? new Date(row.circuit_breaker_tripped_at).toISOString()
            : null,
          circuit_breaker_reset_at: row.circuit_breaker_reset_at
            ? new Date(row.circuit_breaker_reset_at).toISOString()
            : null,
        };
      }
    } catch {
      // PostgreSQL offline or tunneling unavailable -> rely on in-memory state
    }

    // Check if a timed circuit breaker has expired
    if (
      this.inMemoryState.circuit_breaker_active &&
      this.inMemoryState.circuit_breaker_reset_at
    ) {
      const resetTime = new Date(this.inMemoryState.circuit_breaker_reset_at).getTime();
      if (Date.now() >= resetTime) {
        await this.resetCircuitBreaker(userEmail);
      }
    }

    return {
      config: { ...this.inMemoryConfig },
      state: { ...this.inMemoryState },
    };
  }

  /**
   * Pre-Trade Risk Evaluation Gate.
   * Runs all 5 institutional safety checks before any order can be placed.
   */
  public static async evaluatePreTradeRisk(params: {
    symbol: string;
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    stopLossPrice: number;
    currentEquity?: number;
    currentOpenPositionsCount?: number;
    currentOpenPositionsFloatingPnl?: number;
    userEmail?: string;
  }): Promise<PreTradeAssessment> {
    const { config, state } = await this.hydrateState(params.userEmail);
    const equity = params.currentEquity && params.currentEquity > 0
      ? params.currentEquity
      : state.current_balance;

    const stopDistance = Math.abs(params.entryPrice - params.stopLossPrice);
    if (stopDistance <= 0 || isNaN(stopDistance)) {
      return {
        isApproved: false,
        reason: `Invalid stop loss distance: Entry $${params.entryPrice.toFixed(2)} vs SL $${params.stopLossPrice.toFixed(2)}`,
        calculatedRiskUsd: 0,
        contractSize: 0,
        violationTier: 'CEILING_VIOLATION',
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK 1: Master Circuit Breaker
    // ─────────────────────────────────────────────────────────────────────────
    if (state.circuit_breaker_active) {
      return {
        isApproved: false,
        reason: `🚨 Circuit Breaker Active: ${state.circuit_breaker_reason || 'Trading halted by risk governor.'}`,
        calculatedRiskUsd: 0,
        contractSize: 0,
        violationTier: 'CIRCUIT_BREAKER_ACTIVE',
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK 2: Daily Drawdown Limit
    // ─────────────────────────────────────────────────────────────────────────
    const floatingLoss = Math.min(0, params.currentOpenPositionsFloatingPnl || 0);
    const cumulativeLoss = Math.min(0, state.daily_realized_pnl) + floatingLoss;
    const maxDrawdownUsd = Math.min(
      (config.max_daily_loss_pct / 100) * equity,
      config.max_daily_loss_usd
    );

    if (Math.abs(cumulativeLoss) >= maxDrawdownUsd) {
      const reason = `Daily drawdown limit breached: Cumulative loss -$${Math.abs(cumulativeLoss).toFixed(2)} reached cap of -$${maxDrawdownUsd.toFixed(2)} (${config.max_daily_loss_pct}%).`;
      await this.tripCircuitBreaker(reason, 24, params.userEmail);
      return {
        isApproved: false,
        reason,
        calculatedRiskUsd: 0,
        contractSize: 0,
        violationTier: 'DAILY_DRAWDOWN_BREACH',
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK 3: Consecutive Loss Streak Cooldown
    // ─────────────────────────────────────────────────────────────────────────
    if (state.consecutive_losses_count >= config.max_consecutive_losses) {
      const reason = `Loss streak protection: ${state.consecutive_losses_count} consecutive losses reached max limit of ${config.max_consecutive_losses}. 6-hour timeout triggered.`;
      await this.tripCircuitBreaker(reason, 6, params.userEmail);
      return {
        isApproved: false,
        reason,
        calculatedRiskUsd: 0,
        contractSize: 0,
        violationTier: 'CONSECUTIVE_LOSS_BREACH',
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK 4: Daily Trade Frequency Cap
    // ─────────────────────────────────────────────────────────────────────────
    if (state.daily_trades_count >= config.max_daily_trades) {
      return {
        isApproved: false,
        reason: `Daily trade cap reached: ${state.daily_trades_count}/${config.max_daily_trades} trades executed today. Paused to prevent churn.`,
        calculatedRiskUsd: 0,
        contractSize: 0,
        violationTier: 'DAILY_FREQUENCY_BREACH',
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK 5: Single-Position Cap
    // ─────────────────────────────────────────────────────────────────────────
    if ((params.currentOpenPositionsCount || 0) >= 1) {
      return {
        isApproved: false,
        reason: `Max concurrent open positions (1) reached. New setup rejected.`,
        calculatedRiskUsd: 0,
        contractSize: 0,
        violationTier: 'DIRECTIONAL_LOCK',
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SIZING & CEILING SANITY CHECK
    // ─────────────────────────────────────────────────────────────────────────
    const operationalRiskUsd = equity * (config.risk_per_trade_pct / 100);
    const ceilingRiskUsd = equity * (config.max_risk_limit_pct / 100);

    if (operationalRiskUsd > ceilingRiskUsd * 1.05) {
      return {
        isApproved: false,
        reason: `Single-trade risk ceiling exceeded: Operational risk ($${operationalRiskUsd.toFixed(2)}) exceeds Max Risk Ceiling ($${ceilingRiskUsd.toFixed(2)}).`,
        calculatedRiskUsd: operationalRiskUsd,
        contractSize: 0,
        violationTier: 'CEILING_VIOLATION',
      };
    }

    // Raw calculated contract size (rounded to 3 decimal places for ETHUSDC)
    const rawContractSize = operationalRiskUsd / stopDistance;
    const contractSize = Math.max(0.001, Number(rawContractSize.toFixed(3)));

    return {
      isApproved: true,
      reason: `Approved: Risk $${operationalRiskUsd.toFixed(2)} (${config.risk_per_trade_pct}%) | Sized ${contractSize} ${params.symbol}`,
      calculatedRiskUsd: operationalRiskUsd,
      contractSize,
    };
  }

  /**
   * Records completed trade outcomes to update daily realized P&L,
   * trade frequency counts, and consecutive loss streaks.
   */
  public static async recordTradeOutcome(
    outcome: TradeOutcomeRecord,
    userEmail: string = 'institutional_admin'
  ): Promise<void> {
    this.checkSessionRollover();

    this.inMemoryState.daily_realized_pnl += outcome.realizedPnl;
    this.inMemoryState.daily_trades_count += 1;
    this.inMemoryState.current_balance += outcome.realizedPnl;

    if (outcome.isWin || outcome.realizedR > 0) {
      this.inMemoryState.consecutive_losses_count = 0;
    } else if (outcome.realizedR < 0) {
      this.inMemoryState.consecutive_losses_count += 1;
    }

    // Automatic Circuit Breaker Evaluation upon trade completion
    const maxDrawdownUsd = Math.min(
      (this.inMemoryConfig.max_daily_loss_pct / 100) * this.inMemoryState.current_balance,
      this.inMemoryConfig.max_daily_loss_usd
    );

    if (this.inMemoryState.consecutive_losses_count >= this.inMemoryConfig.max_consecutive_losses) {
      await this.tripCircuitBreaker(
        `Consecutive loss streak limit reached (${this.inMemoryState.consecutive_losses_count} losses). 6-hour timeout triggered.`,
        6,
        userEmail
      );
    } else if (Math.abs(Math.min(0, this.inMemoryState.daily_realized_pnl)) >= maxDrawdownUsd) {
      await this.tripCircuitBreaker(
        `Daily drawdown limit breached: Cumulative loss -$${Math.abs(this.inMemoryState.daily_realized_pnl).toFixed(2)} reached cap of -$${maxDrawdownUsd.toFixed(2)}.`,
        24,
        userEmail
      );
    }

    try {
      await sql`
        UPDATE trading_account
        SET 
          current_balance = current_balance + ${outcome.realizedPnl},
          daily_realized_pnl = daily_realized_pnl + ${outcome.realizedPnl},
          consecutive_losses_count = ${this.inMemoryState.consecutive_losses_count},
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ${userEmail};
      `;
    } catch {
      // Offline fallback
    }
  }

  /**
   * Trips the circuit breaker and locks out automated executions.
   */
  public static async tripCircuitBreaker(
    reason: string,
    durationHours: number = 24,
    userEmail: string = 'institutional_admin'
  ): Promise<void> {
    const now = new Date();
    const resetTime = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

    this.inMemoryState.circuit_breaker_active = true;
    this.inMemoryState.circuit_breaker_reason = reason;
    this.inMemoryState.circuit_breaker_tripped_at = now.toISOString();
    this.inMemoryState.circuit_breaker_reset_at = resetTime.toISOString();

    console.warn(`[RISK_GOVERNOR] 🚨 CIRCUIT BREAKER TRIPPED: ${reason} (Locked for ${durationHours}h)`);

    try {
      await sql`
        UPDATE trading_account
        SET 
          circuit_breaker_active = true,
          circuit_breaker_reason = ${reason},
          circuit_breaker_tripped_at = ${now},
          circuit_breaker_reset_at = ${resetTime},
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ${userEmail};
      `;
    } catch {
      // Offline fallback
    }
  }

  /**
   * Manually resets the circuit breaker and clears loss streaks.
   */
  public static async resetCircuitBreaker(userEmail: string = 'institutional_admin'): Promise<void> {
    this.inMemoryState.circuit_breaker_active = false;
    this.inMemoryState.circuit_breaker_reason = null;
    this.inMemoryState.circuit_breaker_tripped_at = null;
    this.inMemoryState.circuit_breaker_reset_at = null;
    this.inMemoryState.consecutive_losses_count = 0;
    this.inMemoryState.daily_realized_pnl = 0.0;

    console.log('[RISK_GOVERNOR] 🔓 Circuit breaker successfully reset. Operational status restored.');

    try {
      await sql`
        UPDATE trading_account
        SET 
          circuit_breaker_active = false,
          circuit_breaker_reason = null,
          circuit_breaker_tripped_at = null,
          circuit_breaker_reset_at = null,
          consecutive_losses_count = 0,
          daily_realized_pnl = 0.0,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ${userEmail};
      `;
    } catch {
      // Offline fallback
    }
  }

  /**
   * Updates configuration settings in database and memory.
   */
  public static async updateConfig(
    newConfig: Partial<RiskGovernorConfig>,
    userEmail: string = 'institutional_admin'
  ): Promise<RiskGovernorConfig> {
    this.inMemoryConfig = { ...this.inMemoryConfig, ...newConfig };

    try {
      await sql`
        UPDATE trading_account
        SET 
          risk_per_trade_pct = ${this.inMemoryConfig.risk_per_trade_pct},
          max_risk_limit_pct = ${this.inMemoryConfig.max_risk_limit_pct},
          max_daily_loss_pct = ${this.inMemoryConfig.max_daily_loss_pct},
          max_daily_loss_usd = ${this.inMemoryConfig.max_daily_loss_usd},
          max_consecutive_losses = ${this.inMemoryConfig.max_consecutive_losses},
          max_daily_trades = ${this.inMemoryConfig.max_daily_trades},
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ${userEmail};
      `;
    } catch {
      // Offline fallback
    }

    return { ...this.inMemoryConfig };
  }

  /**
   * Resets daily counters at 00:00 UTC rollover.
   */
  private static checkSessionRollover(): void {
    const currentUtcDay = new Date().getUTCDate();
    if (currentUtcDay !== this.lastUtcDay) {
      this.inMemoryState.daily_realized_pnl = 0.0;
      this.inMemoryState.daily_trades_count = 0;
      this.lastUtcDay = currentUtcDay;
      console.log(`[RISK_GOVERNOR] 🌅 00:00 UTC Daily Rollover: Daily P&L and trade counts reset.`);
    }
  }

  /**
   * Returns current active in-memory state snapshot.
   */
  public static getState(): RiskGovernorState {
    return { ...this.inMemoryState };
  }

  /**
   * Returns current active in-memory configuration snapshot.
   */
  public static getConfig(): RiskGovernorConfig {
    return { ...this.inMemoryConfig };
  }

  /**
   * For testing and simulation purposes only.
   */
  public static _setTestState(state: Partial<RiskGovernorState>, config?: Partial<RiskGovernorConfig>) {
    this.inMemoryState = { ...this.inMemoryState, ...state };
    if (config) {
      this.inMemoryConfig = { ...this.inMemoryConfig, ...config };
    }
  }
}
