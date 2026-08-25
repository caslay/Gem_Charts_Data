/**
 * sessionJournalStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fast, reactive in-memory session trade journaling store for Flow-State Quant Engine.
 * 
 * Provides:
 *  - Sub-millisecond synchronous trade mutations for Live Execution and Backtest Replay
 *  - Zero cloud database blocking: positions never roll back due to network/database latency
 *  - Persistent localStorage session recovery ('flow_state_session_journal_v1')
 *  - 1-Click Client-Side On-Demand Exports: JSON & CSV
 *  - Real-time P&L, Win Rate, and Multi-Stage Harvest telemetry
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type SessionTradeStatus = 'OPEN' | 'STAGE_1_FILLED' | 'STAGE_2_FILLED' | 'CLOSED' | 'PAUSED' | 'PENDING_LIMIT_ENTRY';

export type SessionExecutionMode = 'LIVE' | 'BACKTEST';

export interface SessionTrade {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number | string;
  stop_loss: number | string;
  take_profit: number | string;
  position_size: number | string;
  risk_amount_usd: number | string;
  risk_percent: number | string;
  strategy_name: string;
  ai_narrative_summary?: string | null;
  status: SessionTradeStatus;
  mode: SessionExecutionMode;
  opened_at: string;
  created_at: string;
  closed_at?: string | null;
  exit_price?: number | string | null;
  exit_reason?: string | null;
  realized_pnl?: number | string | null;
  realized_r?: number | string | null;
  roi?: number | string | null;
  timestamp: string; // ISO string for legacy compatibility
  ipda_metrics?: Record<string, any>;
}

export interface SessionAccount {
  current_balance: number;
  initial_capital: number;
  max_risk_limit_pct: number;
}

interface SessionJournalState {
  trades: SessionTrade[];
  account: SessionAccount;
  backtestAccount: SessionAccount;

  // Actions - Mutations
  addTrade: (trade: Omit<SessionTrade, 'id' | 'created_at' | 'timestamp'> & { id?: string }) => SessionTrade;
  updateTrade: (id: string, updates: Partial<SessionTrade>) => void;
  closeTrade: (id: string, exitPrice: number, exitReason?: string, closedAt?: string) => void;
  deleteTrade: (id: string) => void;
  toggleTradeStatus: (id: string) => void;
  clearSession: (mode?: SessionExecutionMode | 'ALL') => void;

  // Account Management
  setAccountBalance: (balance: number, mode?: SessionExecutionMode) => void;
  updateAccount: (updates: Partial<SessionAccount>, mode?: SessionExecutionMode) => void;

  // Queries & Selectors
  getTradesByMode: (mode: SessionExecutionMode) => SessionTrade[];
  getOpenTrades: (mode?: SessionExecutionMode) => SessionTrade[];
  getClosedTrades: (mode?: SessionExecutionMode) => SessionTrade[];

  // Export Utilities
  exportSessionJson: (mode?: SessionExecutionMode | 'ALL') => void;
  exportSessionCsv: (mode?: SessionExecutionMode | 'ALL') => void;
  importSessionJson: (importedData: any) => void;
}

const DEFAULT_ACCOUNT: SessionAccount = {
  current_balance: 10000.0,
  initial_capital: 10000.0,
  max_risk_limit_pct: 3.0,
};

export const useSessionJournalStore = create<SessionJournalState>()(
  persist(
    (set, get) => ({
      trades: [],
      account: { ...DEFAULT_ACCOUNT },
      backtestAccount: { ...DEFAULT_ACCOUNT },

      addTrade: (tradeData) => {
        const id = tradeData.id || `TRADE_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const now = tradeData.opened_at || new Date().toISOString();

        const newTrade: SessionTrade = {
          ...tradeData,
          id,
          created_at: now,
          opened_at: now,
          timestamp: now,
          status: tradeData.status || 'OPEN',
          mode: tradeData.mode || 'LIVE',
          realized_pnl: tradeData.realized_pnl ?? 0,
          realized_r: tradeData.realized_r ?? 0,
        };

        set((state) => ({
          trades: [newTrade, ...state.trades.filter((t) => t.id !== id)],
        }));

        // Trigger local DOM event for backward-compatible listener bridges
        if (typeof window !== 'undefined') {
          const eventName = newTrade.mode === 'BACKTEST' ? 'backtest-trades-refresh' : 'trades-refresh';
          window.dispatchEvent(new Event(eventName));
        }

        return newTrade;
      },

      updateTrade: (id, updates) => {
        set((state) => {
          let updatedMode: string = 'LIVE';
          const updatedTrades = state.trades.map((trade) => {
            if (trade.id === id) {
              updatedMode = trade.mode;
              const merged = { ...trade, ...updates };

              // If updating realized PnL on closed/harvested trade, reflect on balance
              if (updates.realized_pnl !== undefined && updates.realized_pnl !== null) {
                const pnlDiff = parseFloat(String(updates.realized_pnl)) - parseFloat(String(trade.realized_pnl || 0));
                if (pnlDiff !== 0 && !isNaN(pnlDiff)) {
                  if (trade.mode === 'BACKTEST') {
                    state.backtestAccount.current_balance = parseFloat(
                      (state.backtestAccount.current_balance + pnlDiff).toFixed(4)
                    );
                  } else {
                    state.account.current_balance = parseFloat(
                      (state.account.current_balance + pnlDiff).toFixed(4)
                    );
                  }
                }
              }

              return merged;
            }
            return trade;
          });

          if (typeof window !== 'undefined') {
            const eventName = updatedMode === 'BACKTEST' ? 'backtest-trades-refresh' : 'trades-refresh';
            window.dispatchEvent(new Event(eventName));
          }

          return { trades: updatedTrades };
        });
      },

      closeTrade: (id, exitPrice, exitReason, closedAt) => {
        const timestamp = closedAt || new Date().toISOString();
        set((state) => {
          let tradeMode: string = 'LIVE';
          const updatedTrades = state.trades.map((trade) => {
            if (trade.id === id) {
              tradeMode = trade.mode;
              const entry = parseFloat(String(trade.entry_price));
              const size = parseFloat(String(trade.position_size || 1.0));
              const isLong = trade.direction === 'LONG';
              const pnlUsd = isLong ? (exitPrice - entry) * size : (entry - exitPrice) * size;
              const riskUsd = parseFloat(String(trade.risk_amount_usd || 1));
              const realizedR = riskUsd > 0 ? parseFloat((pnlUsd / riskUsd).toFixed(2)) : 0;
              const roi = entry > 0 ? parseFloat((((exitPrice - entry) / entry) * (isLong ? 100 : -100)).toFixed(2)) : 0;

              // Update active account balance
              if (trade.mode === 'BACKTEST') {
                state.backtestAccount.current_balance = parseFloat(
                  (state.backtestAccount.current_balance + pnlUsd).toFixed(4)
                );
              } else {
                state.account.current_balance = parseFloat(
                  (state.account.current_balance + pnlUsd).toFixed(4)
                );
              }

              return {
                ...trade,
                status: 'CLOSED' as const,
                exit_price: exitPrice,
                exit_reason: exitReason || (pnlUsd >= 0 ? 'TARGET_HIT' : 'STOPPED_OUT'),
                closed_at: timestamp,
                realized_pnl: parseFloat(pnlUsd.toFixed(2)),
                realized_r: realizedR,
                roi,
              };
            }
            return trade;
          });

          if (typeof window !== 'undefined') {
            const eventName = tradeMode === 'BACKTEST' ? 'backtest-trades-refresh' : 'trades-refresh';
            window.dispatchEvent(new Event(eventName));
          }

          return { trades: updatedTrades };
        });
      },

      deleteTrade: (id) => {
        set((state) => {
          const target = state.trades.find((t) => t.id === id);
          const mode: string = target?.mode || 'LIVE';
          const filtered = state.trades.filter((t) => t.id !== id);

          if (typeof window !== 'undefined') {
            const eventName = mode === 'BACKTEST' ? 'backtest-trades-refresh' : 'trades-refresh';
            window.dispatchEvent(new Event(eventName));
          }

          return { trades: filtered };
        });
      },

      toggleTradeStatus: (id) => {
        set((state) => {
          let mode: string = 'LIVE';
          const updated = state.trades.map((trade) => {
            if (trade.id === id && trade.status !== 'CLOSED') {
              mode = trade.mode;
              const nextStatus: SessionTradeStatus = trade.status === 'PAUSED' ? 'OPEN' : 'PAUSED';
              return { ...trade, status: nextStatus };
            }
            return trade;
          });

          if (typeof window !== 'undefined') {
            const eventName = mode === 'BACKTEST' ? 'backtest-trades-refresh' : 'trades-refresh';
            window.dispatchEvent(new Event(eventName));
          }

          return { trades: updated };
        });
      },

      clearSession: (mode = 'ALL') => {
        set((state) => {
          let nextTrades: SessionTrade[] = [];
          if (mode === 'LIVE') {
            nextTrades = state.trades.filter((t) => t.mode !== 'LIVE');
          } else if (mode === 'BACKTEST') {
            nextTrades = state.trades.filter((t) => t.mode !== 'BACKTEST');
          } else {
            nextTrades = [];
          }

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('trades-refresh'));
            window.dispatchEvent(new Event('backtest-trades-refresh'));
          }

          return { trades: nextTrades };
        });
      },

      setAccountBalance: (balance, mode = 'LIVE') => {
        set((state) => {
          if (mode === 'BACKTEST') {
            return { backtestAccount: { ...state.backtestAccount, current_balance: balance } };
          }
          return { account: { ...state.account, current_balance: balance } };
        });
      },

      updateAccount: (updates, mode = 'LIVE') => {
        set((state) => {
          if (mode === 'BACKTEST') {
            return { backtestAccount: { ...state.backtestAccount, ...updates } };
          }
          return { account: { ...state.account, ...updates } };
        });
      },

      getTradesByMode: (mode) => {
        return get().trades.filter((t) => t.mode === mode);
      },

      getOpenTrades: (mode) => {
        return get().trades.filter((t) => (mode ? t.mode === mode : true) && t.status !== 'CLOSED');
      },

      getClosedTrades: (mode) => {
        return get().trades.filter((t) => (mode ? t.mode === mode : true) && t.status === 'CLOSED');
      },

      // ── 1-Click Client-Side Export Generators ──────────────────────────────

      exportSessionJson: (mode = 'ALL') => {
        if (typeof window === 'undefined') return;
        const allTrades = get().trades;
        const filtered = mode === 'ALL' ? allTrades : allTrades.filter((t) => t.mode === mode);

        const exportPayload = {
          export_timestamp: new Date().toISOString(),
          platform: 'Flow-State Quant Engine',
          version: 'V16.50',
          mode,
          account: mode === 'BACKTEST' ? get().backtestAccount : get().account,
          total_trades: filtered.length,
          open_trades: filtered.filter((t) => t.status !== 'CLOSED').length,
          closed_trades: filtered.filter((t) => t.status === 'CLOSED').length,
          trades: filtered,
        };

        const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `flow_state_session_journal_${mode.toLowerCase()}_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },

      exportSessionCsv: (mode = 'ALL') => {
        if (typeof window === 'undefined') return;
        const allTrades = get().trades;
        const filtered = mode === 'ALL' ? allTrades : allTrades.filter((t) => t.mode === mode);

        if (filtered.length === 0) {
          alert('No trades available in the active session to export.');
          return;
        }

        const headers = [
          'ID',
          'Mode',
          'Symbol',
          'Direction',
          'Status',
          'Entry Price',
          'Stop Loss',
          'Take Profit',
          'Exit Price',
          'Position Size (ETH)',
          'Risk (USD)',
          'Realized PnL (USD)',
          'Realized R',
          'ROI (%)',
          'Strategy Name',
          'Exit Reason',
          'Opened At',
          'Closed At',
        ];

        const rows = filtered.map((t) => [
          `"${t.id}"`,
          `"${t.mode}"`,
          `"${t.symbol}"`,
          `"${t.direction}"`,
          `"${t.status}"`,
          Number(t.entry_price).toFixed(2),
          Number(t.stop_loss).toFixed(2),
          Number(t.take_profit).toFixed(2),
          t.exit_price ? Number(t.exit_price).toFixed(2) : 'N/A',
          t.position_size || '1.000',
          t.risk_amount_usd || '0.00',
          t.realized_pnl !== undefined && t.realized_pnl !== null ? Number(t.realized_pnl).toFixed(2) : '0.00',
          t.realized_r !== undefined && t.realized_r !== null ? Number(t.realized_r).toFixed(2) : '0.00',
          t.roi !== undefined && t.roi !== null ? Number(t.roi).toFixed(2) : '0.00',
          `"${(t.strategy_name || '').replace(/"/g, '""')}"`,
          `"${(t.exit_reason || '').replace(/"/g, '""')}"`,
          `"${t.opened_at}"`,
          `"${t.closed_at || ''}"`,
        ]);

        const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `flow_state_session_journal_${mode.toLowerCase()}_${dateStr}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },

      importSessionJson: (importedData) => {
        set((state) => {
          let updatedTrades = [...state.trades];
          if (importedData.trades && Array.isArray(importedData.trades)) {
            // merge trades
            const existingIds = new Set(updatedTrades.map(t => t.id));
            const incoming = importedData.trades.filter((t: any) => !existingIds.has(t.id));
            updatedTrades = [...updatedTrades, ...incoming];
          }
          
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('trades-refresh'));
            window.dispatchEvent(new Event('backtest-trades-refresh'));
          }
          return { trades: updatedTrades };
        });
      },
    }),
    {
      name: 'flow_state_session_journal_v1',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

