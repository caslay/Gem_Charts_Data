/**
 * src/types/stagedSetupTypes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional TypeScript Interfaces for Copilot Staging Deck & Setup Pinning.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type StagedSetupStatus =
  | 'PINNED'
  | 'RESTING_LIMIT'
  | 'FILLED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'DISMISSED'
  | 'DEPLOYED';

export interface UserStagedSetup {
  id: number;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  entryRangeLow?: number | null;
  entryRangeHigh?: number | null;
  stopLoss: number;
  target1: number;
  target2?: number | null;
  target3?: number | null;
  riskRewardRatio?: number | null;
  riskUsd?: number | null;
  riskPct?: number | null;
  contractSize?: number | null;
  status: StagedSetupStatus;
  sourceReference: string; // e.g. "AI_ANALYSIS #145" | "SWEEP_RECLAIM"
  analysisLogId?: number | null;
  decisionLogId?: number | null;
  notes?: string | null;
  metadata?: Record<string, any> | null;
  targetMode?: 'PAPER_TRADING' | 'LIVE_BINANCE' | string | null;
  pinnedAt: string; // ISO string
  deployedAt?: string | null;
  filledAt?: string | null;
  cancelledAt?: string | null;
  expiredAt?: string | null;
  cancelReason?: string | null;
  ttlBars?: number | null;
  updatedAt: string; // ISO string
}

export interface CreateStagedSetupInput {
  symbol?: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  entryRangeLow?: number | null;
  entryRangeHigh?: number | null;
  stopLoss: number;
  target1: number;
  target2?: number | null;
  target3?: number | null;
  riskRewardRatio?: number | null;
  riskUsd?: number | null;
  riskPct?: number | null;
  contractSize?: number | null;
  sourceReference?: string;
  analysisLogId?: number | null;
  decisionLogId?: number | null;
  notes?: string | null;
  metadata?: Record<string, any> | null;
}

export interface StagedPreviewOverlayData {
  id?: number | string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  entryRangeLow?: number | null;
  entryRangeHigh?: number | null;
  stopLoss: number;
  target1: number;
  target2?: number | null;
  target3?: number | null;
  sourceReference?: string;
}

export interface ExecuteStagedRequestPayload {
  stagedId: number;
  targetMode: 'PAPER_TRADING' | 'LIVE_BINANCE';
  executionSource: 'COCKPIT_MANUAL_OVERRIDE';
  overrideParams?: {
    riskPct?: number;
    notes?: string;
  };
}
