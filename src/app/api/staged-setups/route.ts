import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import {
  listStagedSetups,
  pinSetup,
  unpinSetup,
  getStagedSetupById,
  cancelRestingLimit,
  resolveAndValidateSetupGeometry,
} from '@/lib/staging/userStagedSetupsStore';
import { TelegramNotifier } from '@/lib/notifications/telegramNotifier';
import type { CreateStagedSetupInput, StagedSetupStatus } from '@/types/stagedSetupTypes';

export const dynamic = 'force-dynamic';

/**
 * GET /api/staged-setups
 * Retrieves staged setups. Supports status: 'PINNED', 'RESTING_LIMIT', 'ACTIVE', 'ALL', or comma-separated.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const statusParam = (searchParams.get('status') || 'PINNED').toUpperCase();
    const setups = await listStagedSetups(statusParam);

    // Compute active summary counts
    const pinnedCount = setups.filter((s) => s.status === 'PINNED').length;
    const restingCount = setups.filter((s) => s.status === 'RESTING_LIMIT').length;

    return NextResponse.json(
      {
        success: true,
        data: setups,
        count: setups.length,
        counts: {
          pinned: pinnedCount,
          resting: restingCount,
        },
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  } catch (error: any) {
    console.error('[API_STAGED_SETUPS] GET Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch staged setups', data: [], counts: { pinned: 0, resting: 0 } },
      { status: 500, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  }
}

/**
 * POST /api/staged-setups
 * Handles atomic actions: PIN, UNPIN, DISMISS.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body.action || 'PIN').toUpperCase();

    if (action === 'PIN') {
      const {
        symbol = 'ETHUSDC',
        direction,
        entryPrice,
        entryRangeLow,
        entryRangeHigh,
        stopLoss,
        target1,
        target2,
        target3,
        riskRewardRatio,
        riskUsd,
        riskPct,
        contractSize,
        sourceReference,
        analysisLogId,
        decisionLogId,
        notes,
        metadata,
      } = body;

      if (!entryPrice || !stopLoss || !target1) {
        return NextResponse.json(
          { success: false, error: 'Missing required setup parameters (entryPrice, stopLoss, target1)' },
          { status: 400 }
        );
      }

      // Mathematical price geometry resolution & sanity validation
      const geom = resolveAndValidateSetupGeometry({
        direction,
        entryPrice: Number(entryPrice),
        stopLoss: Number(stopLoss),
        target1: Number(target1),
        target2: target2 != null ? Number(target2) : null,
        target3: target3 != null ? Number(target3) : null,
        riskRewardRatio: riskRewardRatio != null ? Number(riskRewardRatio) : null,
      });

      if (!geom.isValid) {
        return NextResponse.json(
          { success: false, error: `Sanity validation failed: ${geom.error}` },
          { status: 400 }
        );
      }

      const input: CreateStagedSetupInput = {
        symbol: (symbol || 'ETHUSDC').trim().toUpperCase(),
        direction: geom.resolvedDirection,
        entryPrice: geom.entryPrice,
        entryRangeLow: entryRangeLow != null ? Number(entryRangeLow) : null,
        entryRangeHigh: entryRangeHigh != null ? Number(entryRangeHigh) : null,
        stopLoss: geom.stopLoss,
        target1: geom.target1,
        target2: geom.target2,
        target3: geom.target3,
        riskRewardRatio: geom.riskRewardRatio,
        riskUsd: riskUsd != null ? Number(riskUsd) : null,
        riskPct: riskPct != null ? Number(riskPct) : null,
        contractSize: contractSize != null ? Number(contractSize) : null,
        sourceReference,
        analysisLogId: analysisLogId != null ? Number(analysisLogId) : null,
        decisionLogId: decisionLogId != null ? Number(decisionLogId) : null,
        notes,
        metadata: {
          ...(metadata || {}),
          wasDirectionCorrected: geom.wasDirectionCorrected,
          correctionReason: geom.correctionReason || null,
        },
      };

      const staged = await pinSetup(input);
      return NextResponse.json(
        {
          success: true,
          message: `Setup #${staged.id} pinned to Copilot Staging Deck.`,
          warning: geom.wasDirectionCorrected ? geom.correctionReason : undefined,
          data: staged,
        },
        { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
      );
    }

    if (action === 'UNPIN' || action === 'DISMISS') {
      const id = body.id || body.stagedId;
      if (!id) {
        return NextResponse.json(
          { success: false, error: 'Missing setup ID to unpin' },
          { status: 400 }
        );
      }

      const dismissed = await unpinSetup(id);
      return NextResponse.json(
        {
          success: dismissed,
          message: dismissed
            ? `Setup #${id} unpinned from Copilot Staging Deck.`
            : `Setup #${id} could not be unpinned.`,
        },
        { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
      );
    }

    if (action === 'CANCEL_LIMIT' || action === 'CANCEL') {
      const id = body.id || body.stagedId;
      if (!id) {
        return NextResponse.json(
          { success: false, error: 'Missing setup ID to cancel resting limit' },
          { status: 400 }
        );
      }

      const existing = await getStagedSetupById(id);
      const reason = body.reason || 'OPERATOR_MANUAL_CANCEL';
      const cancelled = await cancelRestingLimit(id, reason);

      // Append CANCEL_PENDING command to daemon_commands.json
      const runLogsDir = path.join(process.cwd(), 'run_logs');
      if (!fs.existsSync(runLogsDir)) {
        try { fs.mkdirSync(runLogsDir, { recursive: true }); } catch {}
      }
      const cmdFile = path.join(runLogsDir, 'daemon_commands.json');
      let commands: any[] = [];
      if (fs.existsSync(cmdFile)) {
        try {
          commands = JSON.parse(fs.readFileSync(cmdFile, 'utf8'));
          if (!Array.isArray(commands)) commands = [];
        } catch {
          commands = [];
        }
      }
      const now = Date.now();
      const cancelCmd = {
        id: `cmd_${now}_${Math.random().toString(36).substring(2, 7)}`,
        action: 'CANCEL_PENDING',
        positionId: `staged_${id}`,
        decisionId: existing?.decisionLogId ?? undefined,
        targetMode: existing?.targetMode ?? undefined,
        timestamp: now,
        timeIso: new Date(now).toISOString(),
        status: 'PENDING',
        metadata: {
          stagedId: id,
          symbol: existing?.symbol,
          reason,
        },
      };
      commands = [...commands.slice(-49), cancelCmd];
      try {
        fs.writeFileSync(cmdFile, JSON.stringify(commands, null, 2), 'utf8');
      } catch (e) {
        console.warn('[API_STAGED_SETUPS] Could not write cancel command:', e);
      }

      // Dispatch Telegram notification
      if (existing) {
        try {
          const notifier = new TelegramNotifier();
          const dirBadge = existing.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
          const msg = `🚫 <b>[RESTING LIMIT CANCELLED]</b>\n\n• Operator cancelled resting limit <code>#${id}</code>\n• Symbol: <code>${existing.symbol}</code> (${dirBadge})\n• Level: <code>$${existing.entryPrice.toFixed(2)}</code>\n• Authority: <code>OPERATOR_MANUAL_CANCEL</code>`;
          notifier.sendRawMessage(msg, { parseMode: 'HTML' }).catch(() => {});
        } catch {}
      }

      return NextResponse.json(
        {
          success: cancelled,
          message: cancelled
            ? `Resting limit #${id} successfully aborted.`
            : `Could not abort resting limit #${id}.`,
        },
        { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
      );
    }

    return NextResponse.json(
      { success: false, error: `Unsupported action "${action}". Expected PIN, UNPIN, or CANCEL_LIMIT.` },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('[API_STAGED_SETUPS] POST Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to process staged setup request' },
      { status: 500, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  }
}
