/**
 * src/lib/staging/userStagedSetupsStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Persistence & State Store for Copilot Staging Deck.
 * 
 * Provides:
 * 1. Self-healing PostgreSQL persistence via table `user_staged_setups`.
 * 2. Atomic filesystem fallback (`run_logs/user_staged_setups.json`) for local
 *    read-only sandboxes or offline development.
 * 3. Bidirectional pinning, querying, unpinning, and deployment tracking.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import { sql } from '@/lib/postgres';
import type {
  UserStagedSetup,
  CreateStagedSetupInput,
  StagedSetupStatus,
} from '@/types/stagedSetupTypes';

let isTableInitialized = false;
let isPostgresAvailable = false;

function getFallbackFilePath(): string {
  const rootDir = process.cwd();
  const dir = path.join(rootDir, 'run_logs');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
  return path.join(dir, 'user_staged_setups.json');
}

function readFallbackSetups(): UserStagedSetup[] {
  try {
    const file = getFallbackFilePath();
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.map((s: any) => {
      const geom = resolveAndValidateSetupGeometry({
        direction: s.direction,
        entryPrice: s.entryPrice,
        stopLoss: s.stopLoss,
        target1: s.target1,
        target2: s.target2,
        target3: s.target3,
        riskRewardRatio: s.riskRewardRatio,
      });
      return {
        ...s,
        direction: geom.resolvedDirection,
        entryPrice: geom.entryPrice,
        stopLoss: geom.stopLoss,
        target1: geom.target1,
        target2: geom.target2,
        target3: geom.target3,
        riskRewardRatio: geom.riskRewardRatio,
      };
    });
  } catch (err) {
    console.warn('[STAGED_STORE] Could not read fallback JSON store:', err);
    return [];
  }
}

function writeFallbackSetups(setups: UserStagedSetup[]): void {
  try {
    const file = getFallbackFilePath();
    fs.writeFileSync(file, JSON.stringify(setups, null, 2), 'utf8');
  } catch (err) {
    console.warn('[STAGED_STORE] Could not write fallback JSON store:', err);
  }
}

/**
 * Self-healing schema initialization for user_staged_setups.
 */
export async function ensureUserStagedSetupsTableInitialized(): Promise<void> {
  if (isTableInitialized) return;

  try {
    const probe = await sql`SELECT 1 as test;`;
    if (!probe || !probe.rows || probe.rows.length === 0 || (probe.rows[0] as any)?.test != 1) {
      isPostgresAvailable = false;
      isTableInitialized = true;
      return;
    }
    isPostgresAvailable = true;

    await sql`
      CREATE TABLE IF NOT EXISTS user_staged_setups (
        id                  SERIAL PRIMARY KEY,
        symbol              VARCHAR(32)   NOT NULL DEFAULT 'ETHUSDC',
        direction           VARCHAR(16)   NOT NULL,
        entry_price         NUMERIC(16,4) NOT NULL,
        entry_range_low     NUMERIC(16,4),
        entry_range_high    NUMERIC(16,4),
        stop_loss           NUMERIC(16,4) NOT NULL,
        target_1            NUMERIC(16,4) NOT NULL,
        target_2            NUMERIC(16,4),
        target_3            NUMERIC(16,4),
        risk_reward_ratio   NUMERIC(6,2),
        risk_usd            NUMERIC(16,4),
        risk_pct            NUMERIC(6,2),
        contract_size       NUMERIC(16,4),
        status              VARCHAR(32)   NOT NULL DEFAULT 'PINNED',
        source_reference    VARCHAR(128)  NOT NULL DEFAULT 'MANUAL',
        analysis_log_id     INTEGER,
        decision_log_id     INTEGER,
        notes               TEXT,
        metadata            JSONB,
        target_mode         VARCHAR(32),
        pinned_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        deployed_at         TIMESTAMP WITH TIME ZONE,
        filled_at           TIMESTAMP WITH TIME ZONE,
        cancelled_at        TIMESTAMP WITH TIME ZONE,
        expired_at          TIMESTAMP WITH TIME ZONE,
        cancel_reason       TEXT,
        updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Self-healing column additions for existing installations
    await sql`ALTER TABLE user_staged_setups ADD COLUMN IF NOT EXISTS target_mode VARCHAR(32);`.catch(() => {});
    await sql`ALTER TABLE user_staged_setups ADD COLUMN IF NOT EXISTS filled_at TIMESTAMP WITH TIME ZONE;`.catch(() => {});
    await sql`ALTER TABLE user_staged_setups ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE;`.catch(() => {});
    await sql`ALTER TABLE user_staged_setups ADD COLUMN IF NOT EXISTS expired_at TIMESTAMP WITH TIME ZONE;`.catch(() => {});
    await sql`ALTER TABLE user_staged_setups ADD COLUMN IF NOT EXISTS cancel_reason TEXT;`.catch(() => {});

    await sql`
      CREATE INDEX IF NOT EXISTS idx_user_staged_status
        ON user_staged_setups (status, pinned_at DESC);
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_user_staged_analysis_log_id
        ON user_staged_setups (analysis_log_id);
    `;

    // 3. Self-healing geometry reconciliation: auto-correct historical mislabeled direction rows
    await sql`
      UPDATE user_staged_setups
      SET direction = 'SHORT', updated_at = NOW()
      WHERE direction = 'LONG' AND stop_loss > entry_price AND target_1 < entry_price;
    `.catch(() => {});

    await sql`
      UPDATE user_staged_setups
      SET direction = 'LONG', updated_at = NOW()
      WHERE direction = 'SHORT' AND stop_loss < entry_price AND target_1 > entry_price;
    `.catch(() => {});

    isTableInitialized = true;
  } catch (err) {
    console.warn('[STAGED_STORE] Postgres table initialization skipped or offline (using JSON fallback):', err);
    isPostgresAvailable = false;
    isTableInitialized = true;
  }
}

export interface ResolvedGeometry {
  isValid: boolean;
  resolvedDirection: 'LONG' | 'SHORT';
  wasDirectionCorrected: boolean;
  correctionReason?: string;
  error?: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2?: number | null;
  target3?: number | null;
  riskRewardRatio: number;
}

/**
 * Validates and auto-corrects directional geometry based on price action physics.
 * Long: Stop Loss < Entry Price and Target 1 > Entry Price.
 * Short: Stop Loss > Entry Price and Target 1 < Entry Price.
 * Automatically corrects mislabeled direction if price geometry unambiguously dictates it.
 */
export function resolveAndValidateSetupGeometry(params: {
  direction?: string | null;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2?: number | null;
  target3?: number | null;
  riskRewardRatio?: number | null;
}): ResolvedGeometry {
  const entry = Number(params.entryPrice);
  const sl = Number(params.stopLoss);
  const tp1 = Number(params.target1);

  if (isNaN(entry) || entry <= 0) {
    return { isValid: false, error: `Invalid Entry Price: ${params.entryPrice}`, resolvedDirection: 'LONG', wasDirectionCorrected: false, entryPrice: entry, stopLoss: sl, target1: tp1, riskRewardRatio: 0 };
  }
  if (isNaN(sl) || sl <= 0) {
    return { isValid: false, error: `Invalid Stop Loss: ${params.stopLoss}`, resolvedDirection: 'LONG', wasDirectionCorrected: false, entryPrice: entry, stopLoss: sl, target1: tp1, riskRewardRatio: 0 };
  }
  if (isNaN(tp1) || tp1 <= 0) {
    return { isValid: false, error: `Invalid Target 1: ${params.target1}`, resolvedDirection: 'LONG', wasDirectionCorrected: false, entryPrice: entry, stopLoss: sl, target1: tp1, riskRewardRatio: 0 };
  }

  // Check if SL and TP1 are on the same side of Entry
  if ((sl >= entry && tp1 >= entry) || (sl <= entry && tp1 <= entry)) {
    return {
      isValid: false,
      error: `Corrupt setup geometry: Stop Loss ($${sl}) and Target 1 ($${tp1}) cannot both be on the same side of Entry ($${entry}).`,
      resolvedDirection: 'LONG',
      wasDirectionCorrected: false,
      entryPrice: entry,
      stopLoss: sl,
      target1: tp1,
      riskRewardRatio: 0,
    };
  }

  // Derive mathematical direction from price physics
  let trueDirection: 'LONG' | 'SHORT';
  if (sl < entry && tp1 > entry) {
    trueDirection = 'LONG';
  } else if (sl > entry && tp1 < entry) {
    trueDirection = 'SHORT';
  } else {
    return {
      isValid: false,
      error: `Invalid geometry coordinates: Entry=$${entry}, SL=$${sl}, TP1=$${tp1}.`,
      resolvedDirection: 'LONG',
      wasDirectionCorrected: false,
      entryPrice: entry,
      stopLoss: sl,
      target1: tp1,
      riskRewardRatio: 0,
    };
  }

  const rawDirection = (params.direction || '').trim().toUpperCase();
  let wasDirectionCorrected = false;
  let correctionReason: string | undefined;

  if (rawDirection && rawDirection !== trueDirection) {
    wasDirectionCorrected = true;
    correctionReason = `Mislabeled direction: Setup was labeled ${rawDirection}, but price geometry (Entry: $${entry}, SL: $${sl}, TP1: $${tp1}) dictates ${trueDirection}. Auto-corrected to ${trueDirection}.`;
    console.warn(`[GEOMETRY_VALIDATOR] ⚠️ ${correctionReason}`);
  }

  // Sanitize and sort targets monotonically away from entry to guarantee physical milestone order
  const rawTargets = [tp1, params.target2 != null ? Number(params.target2) : null, params.target3 != null ? Number(params.target3) : null]
    .filter((t): t is number => t !== null && !isNaN(t));

  let cleanTp1 = tp1;
  let cleanTarget2: number | null = null;
  let cleanTarget3: number | null = null;

  if (trueDirection === 'LONG') {
    // Valid long targets must be strictly greater than entry, sorted ascending (closest milestone first)
    const validLongTargets = rawTargets.filter((t) => t > entry).sort((a, b) => a - b);
    if (validLongTargets.length > 0) {
      cleanTp1 = validLongTargets[0];
      cleanTarget2 = validLongTargets[1] ?? null;
      cleanTarget3 = validLongTargets[2] ?? null;
    }
  } else {
    // Valid short targets must be strictly less than entry, sorted descending (closest milestone first)
    const validShortTargets = rawTargets.filter((t) => t < entry).sort((a, b) => b - a);
    if (validShortTargets.length > 0) {
      cleanTp1 = validShortTargets[0];
      cleanTarget2 = validShortTargets[1] ?? null;
      cleanTarget3 = validShortTargets[2] ?? null;
    }
  }

  // Calculate clean R:R
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(cleanTp1 - entry);
  const rrr = risk > 0 ? parseFloat((reward / risk).toFixed(2)) : 0;

  return {
    isValid: true,
    resolvedDirection: trueDirection,
    wasDirectionCorrected,
    correctionReason,
    entryPrice: entry,
    stopLoss: sl,
    target1: cleanTp1,
    target2: cleanTarget2,
    target3: cleanTarget3,
    riskRewardRatio: params.riskRewardRatio != null ? Number(params.riskRewardRatio) : rrr,
  };
}

/**
 * Maps a raw database row to the typed UserStagedSetup object.
 * Enforces automatic geometry validation and direction resolution.
 */
function mapRowToSetup(row: any): UserStagedSetup {
  const rawDirection = String(row.direction || 'LONG').toUpperCase();
  const entryPrice = Number(row.entry_price || 0);
  const stopLoss = Number(row.stop_loss || 0);
  const target1 = Number(row.target_1 || 0);
  const target2 = row.target_2 != null ? Number(row.target_2) : null;
  const target3 = row.target_3 != null ? Number(row.target_3) : null;

  // Auto-validate and correct direction based on physical price geometry
  const geom = resolveAndValidateSetupGeometry({
    direction: rawDirection,
    entryPrice,
    stopLoss,
    target1,
    target2,
    target3,
    riskRewardRatio: row.risk_reward_ratio != null ? Number(row.risk_reward_ratio) : null,
  });

  return {
    id: Number(row.id),
    symbol: String(row.symbol || 'ETHUSDC'),
    direction: geom.resolvedDirection,
    entryPrice: geom.entryPrice,
    entryRangeLow: row.entry_range_low != null ? Number(row.entry_range_low) : null,
    entryRangeHigh: row.entry_range_high != null ? Number(row.entry_range_high) : null,
    stopLoss: geom.stopLoss,
    target1: geom.target1,
    target2: geom.target2,
    target3: geom.target3,
    riskRewardRatio: geom.riskRewardRatio,
    riskUsd: row.risk_usd != null ? Number(row.risk_usd) : null,
    riskPct: row.risk_pct != null ? Number(row.risk_pct) : null,
    contractSize: row.contract_size != null ? Number(row.contract_size) : null,
    status: (row.status as StagedSetupStatus) || 'PINNED',
    sourceReference: String(row.source_reference || 'MANUAL'),
    analysisLogId: row.analysis_log_id != null ? Number(row.analysis_log_id) : null,
    decisionLogId: row.decision_log_id != null ? Number(row.decision_log_id) : null,
    notes: row.notes || null,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || null),
    targetMode: row.target_mode || (row.metadata?.targetMode ?? null),
    pinnedAt: row.pinned_at ? new Date(row.pinned_at).toISOString() : new Date().toISOString(),
    deployedAt: row.deployed_at ? new Date(row.deployed_at).toISOString() : null,
    filledAt: row.filled_at ? new Date(row.filled_at).toISOString() : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    expiredAt: row.expired_at ? new Date(row.expired_at).toISOString() : null,
    cancelReason: row.cancel_reason || (row.metadata?.cancelReason ?? null),
    ttlBars: row.metadata?.ttlBars ?? 48,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

/**
 * Pins a setup into the Staging Queue.
 * If already pinned for the same analysisLogId, updates it and returns it.
 */
export async function pinSetup(input: CreateStagedSetupInput): Promise<UserStagedSetup> {
  await ensureUserStagedSetupsTableInitialized();

  // Validate and resolve directional geometry
  const geom = resolveAndValidateSetupGeometry({
    direction: input.direction,
    entryPrice: Number(input.entryPrice),
    stopLoss: Number(input.stopLoss),
    target1: Number(input.target1),
    target2: input.target2 != null ? Number(input.target2) : null,
    target3: input.target3 != null ? Number(input.target3) : null,
    riskRewardRatio: input.riskRewardRatio != null ? Number(input.riskRewardRatio) : null,
  });

  if (!geom.isValid) {
    throw new Error(geom.error || 'Corrupt or invalid setup geometry coordinates.');
  }

  const symbol = (input.symbol || 'ETHUSDC').trim().toUpperCase();
  const direction = geom.resolvedDirection;
  const entryPrice = geom.entryPrice;
  const entryRangeLow = input.entryRangeLow != null ? Number(input.entryRangeLow) : null;
  const entryRangeHigh = input.entryRangeHigh != null ? Number(input.entryRangeHigh) : null;
  const stopLoss = geom.stopLoss;
  const target1 = geom.target1;
  const target2 = geom.target2 ?? null;
  const target3 = geom.target3 ?? null;
  const rrr = geom.riskRewardRatio;

  const sourceRef = input.sourceReference || 'MANUAL';
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  const now = new Date().toISOString();

  // Try PostgreSQL first
  try {
    if (input.analysisLogId != null) {
      const existing = await sql`
        SELECT * FROM user_staged_setups
        WHERE analysis_log_id = ${input.analysisLogId} AND status = 'PINNED'
        LIMIT 1;
      `;
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        const setup = mapRowToSetup(row);
        // Also mirror to fallback JSON
        updateFallbackRecord(setup);
        return setup;
      }
    }

    const { rows } = await sql`
      INSERT INTO user_staged_setups (
        symbol, direction, entry_price, entry_range_low, entry_range_high,
        stop_loss, target_1, target_2, target_3, risk_reward_ratio,
        risk_usd, risk_pct, contract_size, status, source_reference,
        analysis_log_id, decision_log_id, notes, metadata, pinned_at, updated_at
      ) VALUES (
        ${symbol}, ${direction}, ${entryPrice}, ${entryRangeLow}, ${entryRangeHigh},
        ${stopLoss}, ${target1}, ${target2}, ${target3}, ${rrr},
        ${input.riskUsd ?? null}, ${input.riskPct ?? null}, ${input.contractSize ?? null},
        'PINNED', ${sourceRef}, ${input.analysisLogId ?? null}, ${input.decisionLogId ?? null},
        ${input.notes ?? null}, ${metadataJson}, NOW(), NOW()
      )
      RETURNING *;
    `;

    if (rows && rows.length > 0) {
      const created = mapRowToSetup(rows[0]);
      updateFallbackRecord(created);
      return created;
    }
  } catch (dbErr: any) {
    console.warn('[STAGED_STORE] PostgreSQL write failed (falling back to JSON store):', dbErr?.message || dbErr);
  }

  // Fallback to local JSON store
  const fallbacks = readFallbackSetups();
  if (input.analysisLogId != null) {
    const existing = fallbacks.find(
      (s) => s.analysisLogId === input.analysisLogId && s.status === 'PINNED'
    );
    if (existing) return existing;
  }

  const newId = fallbacks.length > 0 ? Math.max(...fallbacks.map((f) => f.id)) + 1 : 1;
  const fallbackSetup: UserStagedSetup = {
    id: newId,
    symbol,
    direction,
    entryPrice,
    entryRangeLow,
    entryRangeHigh,
    stopLoss,
    target1,
    target2,
    target3,
    riskRewardRatio: rrr,
    riskUsd: input.riskUsd ?? null,
    riskPct: input.riskPct ?? null,
    contractSize: input.contractSize ?? null,
    status: 'PINNED',
    sourceReference: sourceRef,
    analysisLogId: input.analysisLogId ?? null,
    decisionLogId: input.decisionLogId ?? null,
    notes: input.notes ?? null,
    metadata: input.metadata ?? null,
    pinnedAt: now,
    deployedAt: null,
    updatedAt: now,
  };

  fallbacks.unshift(fallbackSetup);
  writeFallbackSetups(fallbacks);
  return fallbackSetup;
}

/**
 * Unpins or dismisses a setup from the Staging Deck.
 */
export async function unpinSetup(id: number | string): Promise<boolean> {
  await ensureUserStagedSetupsTableInitialized();
  const numId = Number(id);

  let success = false;
  try {
    const res = await sql`
      UPDATE user_staged_setups
      SET status = 'DISMISSED', updated_at = NOW()
      WHERE id = ${numId}
      RETURNING id;
    `;
    if (res.rows.length > 0) {
      success = true;
    }
  } catch (err: any) {
    console.warn('[STAGED_STORE] PostgreSQL unpin failed (falling back to JSON):', err?.message || err);
  }

  // Always mirror in JSON fallback
  const fallbacks = readFallbackSetups();
  const idx = fallbacks.findIndex((s) => s.id === numId);
  if (idx !== -1) {
    fallbacks[idx].status = 'DISMISSED';
    fallbacks[idx].updatedAt = new Date().toISOString();
    writeFallbackSetups(fallbacks);
    success = true;
  }

  return success;
}

/**
 * Lists active staged setups. Supports 'PINNED', 'RESTING_LIMIT', 'ACTIVE' (both PINNED & RESTING_LIMIT), 'ALL', or comma-separated.
 */
export async function listStagedSetups(
  status: StagedSetupStatus | 'ACTIVE' | 'ALL' | string = 'PINNED'
): Promise<UserStagedSetup[]> {
  await ensureUserStagedSetupsTableInitialized();

  let statusList: string[];
  if (status === 'ACTIVE') {
    statusList = ['PINNED', 'RESTING_LIMIT'];
  } else if (status === 'ALL') {
    statusList = ['PINNED', 'RESTING_LIMIT', 'FILLED', 'CANCELLED', 'EXPIRED', 'DEPLOYED'];
  } else {
    statusList = status.split(',').map((s) => s.trim().toUpperCase());
  }

  if (isPostgresAvailable) {
    try {
      const { rows } = await sql`
        SELECT * FROM user_staged_setups
        WHERE status = ANY(${statusList})
        ORDER BY pinned_at DESC;
      `;
      if (rows) {
        return rows.map(mapRowToSetup);
      }
    } catch (err: any) {
      console.warn('[STAGED_STORE] PostgreSQL list query failed (using JSON fallback):', err?.message || err);
    }
  }

  // Fallback to JSON
  const fallbacks = readFallbackSetups();
  return fallbacks.filter((s) => statusList.includes(s.status));
}

/**
 * Retrieves a single staged setup by ID.
 */
export async function getStagedSetupById(
  id: number | string
): Promise<UserStagedSetup | null> {
  await ensureUserStagedSetupsTableInitialized();
  const numId = Number(id);

  if (isPostgresAvailable) {
    try {
      const { rows } = await sql`
        SELECT * FROM user_staged_setups
        WHERE id = ${numId}
        LIMIT 1;
      `;
      if (rows && rows.length > 0) {
        return mapRowToSetup(rows[0]);
      }
      return null;
    } catch (err: any) {
      console.warn('[STAGED_STORE] PostgreSQL getById query failed (using JSON fallback):', err?.message || err);
    }
  }

  const fallbacks = readFallbackSetups();
  return fallbacks.find((s) => s.id === numId) || null;
}

/**
 * Transitions a staged setup to RESTING_LIMIT upon cockpit manual override deployment.
 */
export async function markSetupRestingLimit(
  id: number | string,
  targetMode: string,
  details?: any
): Promise<boolean> {
  await ensureUserStagedSetupsTableInitialized();
  const numId = Number(id);
  const nowIso = new Date().toISOString();

  let success = false;
  try {
    const note = details?.notes ? String(details.notes) : `Dispatched to ${targetMode} (Resting Limit) @ ${nowIso}`;
    const res = await sql`
      UPDATE user_staged_setups
      SET status = 'RESTING_LIMIT',
          target_mode = ${targetMode},
          deployed_at = NOW(),
          updated_at = NOW(),
          notes = COALESCE(notes, '') || ' [' || ${note} || ']'
      WHERE id = ${numId}
      RETURNING id;
    `;
    if (res.rows.length > 0) {
      success = true;
    }
  } catch (err: any) {
    console.warn('[STAGED_STORE] PostgreSQL markSetupRestingLimit failed (using JSON fallback):', err?.message || err);
  }

  const fallbacks = readFallbackSetups();
  const idx = fallbacks.findIndex((s) => s.id === numId);
  if (idx !== -1) {
    fallbacks[idx].status = 'RESTING_LIMIT';
    fallbacks[idx].targetMode = targetMode;
    fallbacks[idx].deployedAt = nowIso;
    fallbacks[idx].updatedAt = nowIso;
    if (details?.notes) {
      fallbacks[idx].notes = `${fallbacks[idx].notes || ''} [${details.notes}]`;
    }
    writeFallbackSetups(fallbacks);
    success = true;
  }

  return success;
}

/**
 * Marks a staged setup as DEPLOYED upon manual cockpit execution (bridges to markSetupRestingLimit).
 */
export async function markSetupDeployed(
  id: number | string,
  targetMode: string,
  details?: any
): Promise<boolean> {
  return markSetupRestingLimit(id, targetMode, details);
}

/**
 * Cancels an active resting limit order by operator action.
 */
export async function cancelRestingLimit(
  id: number | string,
  reason: string = 'OPERATOR_CANCELLED'
): Promise<boolean> {
  await ensureUserStagedSetupsTableInitialized();
  const numId = Number(id);
  const nowIso = new Date().toISOString();

  let success = false;
  try {
    const res = await sql`
      UPDATE user_staged_setups
      SET status = 'CANCELLED',
          cancelled_at = NOW(),
          cancel_reason = ${reason},
          updated_at = NOW(),
          notes = COALESCE(notes, '') || ' [CANCELLED: ' || ${reason} || ' @ ' || NOW() || ']'
      WHERE id = ${numId}
      RETURNING id;
    `;
    if (res.rows.length > 0) {
      success = true;
    }
  } catch (err: any) {
    console.warn('[STAGED_STORE] PostgreSQL cancelRestingLimit failed (using JSON fallback):', err?.message || err);
  }

  const fallbacks = readFallbackSetups();
  const idx = fallbacks.findIndex((s) => s.id === numId);
  if (idx !== -1) {
    fallbacks[idx].status = 'CANCELLED';
    fallbacks[idx].cancelledAt = nowIso;
    fallbacks[idx].cancelReason = reason;
    fallbacks[idx].updatedAt = nowIso;
    writeFallbackSetups(fallbacks);
    success = true;
  }

  return success;
}

/**
 * Marks an active resting limit order as EXPIRED after TTL retest bars lapse.
 */
export async function expireRestingLimit(
  id: number | string,
  reason: string = 'TTL_RETEST_EXPIRED'
): Promise<boolean> {
  await ensureUserStagedSetupsTableInitialized();
  const numId = Number(id);
  const nowIso = new Date().toISOString();

  let success = false;
  try {
    const res = await sql`
      UPDATE user_staged_setups
      SET status = 'EXPIRED',
          expired_at = NOW(),
          cancel_reason = ${reason},
          updated_at = NOW(),
          notes = COALESCE(notes, '') || ' [EXPIRED: ' || ${reason} || ' @ ' || NOW() || ']'
      WHERE id = ${numId}
      RETURNING id;
    `;
    if (res.rows.length > 0) {
      success = true;
    }
  } catch (err: any) {
    console.warn('[STAGED_STORE] PostgreSQL expireRestingLimit failed (using JSON fallback):', err?.message || err);
  }

  const fallbacks = readFallbackSetups();
  const idx = fallbacks.findIndex((s) => s.id === numId);
  if (idx !== -1) {
    fallbacks[idx].status = 'EXPIRED';
    fallbacks[idx].expiredAt = nowIso;
    fallbacks[idx].cancelReason = reason;
    fallbacks[idx].updatedAt = nowIso;
    writeFallbackSetups(fallbacks);
    success = true;
  }

  return success;
}

/**
 * Marks an active resting limit order as FILLED when price touches limit.
 */
export async function markSetupFilled(
  id: number | string,
  details?: any
): Promise<boolean> {
  await ensureUserStagedSetupsTableInitialized();
  const numId = Number(id);
  const nowIso = new Date().toISOString();

  let success = false;
  try {
    const fillPrice = details?.entryPrice ? Number(details.entryPrice) : null;
    const note = `FILLED @ $${fillPrice ?? 'N/A'}`;
    const res = await sql`
      UPDATE user_staged_setups
      SET status = 'FILLED',
          filled_at = NOW(),
          updated_at = NOW(),
          notes = COALESCE(notes, '') || ' [' || ${note} || ' @ ' || NOW() || ']'
      WHERE id = ${numId}
      RETURNING id;
    `;
    if (res.rows.length > 0) {
      success = true;
    }
  } catch (err: any) {
    console.warn('[STAGED_STORE] PostgreSQL markSetupFilled failed (using JSON fallback):', err?.message || err);
  }

  const fallbacks = readFallbackSetups();
  const idx = fallbacks.findIndex((s) => s.id === numId);
  if (idx !== -1) {
    fallbacks[idx].status = 'FILLED';
    fallbacks[idx].filledAt = nowIso;
    fallbacks[idx].updatedAt = nowIso;
    writeFallbackSetups(fallbacks);
    success = true;
  }

  return success;
}

/**
 * Convenience helper to list all active RESTING_LIMIT setups for a given symbol.
 */
export async function getRestingLimitSetups(symbol?: string): Promise<UserStagedSetup[]> {
  const setups = await listStagedSetups('RESTING_LIMIT');
  if (!symbol) return setups;
  const upperSymbol = symbol.trim().toUpperCase();
  return setups.filter((s) => s.symbol.toUpperCase() === upperSymbol);
}

/**
 * Checks whether an analysis log record is currently pinned in the staging queue.
 */
export async function isAnalysisRecordPinned(analysisLogId: number): Promise<boolean> {
  await ensureUserStagedSetupsTableInitialized();
  if (isPostgresAvailable) {
    try {
      const { rows } = await sql`
        SELECT id FROM user_staged_setups
        WHERE analysis_log_id = ${analysisLogId} AND status = 'PINNED'
        LIMIT 1;
      `;
      return !!(rows && rows.length > 0);
    } catch {}
  }

  const fallbacks = readFallbackSetups();
  return fallbacks.some((s) => s.analysisLogId === analysisLogId && s.status === 'PINNED');
}

function updateFallbackRecord(setup: UserStagedSetup): void {
  const fallbacks = readFallbackSetups();
  const idx = fallbacks.findIndex((s) => s.id === setup.id);
  if (idx !== -1) {
    fallbacks[idx] = setup;
  } else {
    fallbacks.unshift(setup);
  }
  writeFallbackSetups(fallbacks);
}

export const userStagedSetupsStore = {
  ensureUserStagedSetupsTableInitialized,
  resolveAndValidateSetupGeometry,
  pinSetup,
  unpinSetup,
  listStagedSetups,
  getStagedSetupById,
  markSetupDeployed,
  markSetupRestingLimit,
  cancelRestingLimit,
  expireRestingLimit,
  markSetupFilled,
  getRestingLimitSetups,
  isAnalysisRecordPinned,
};

export default userStagedSetupsStore;

