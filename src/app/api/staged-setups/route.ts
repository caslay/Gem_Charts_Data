import { NextResponse } from 'next/server';
import {
  listStagedSetups,
  pinSetup,
  unpinSetup,
  getStagedSetupById,
  resolveAndValidateSetupGeometry,
} from '@/lib/staging/userStagedSetupsStore';
import type { CreateStagedSetupInput, StagedSetupStatus } from '@/types/stagedSetupTypes';

export const dynamic = 'force-dynamic';

/**
 * GET /api/staged-setups
 * Retrieves all currently staged setups (defaults to status = 'PINNED').
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const statusParam = (searchParams.get('status') || 'PINNED').toUpperCase() as StagedSetupStatus;
    const setups = await listStagedSetups(statusParam);

    return NextResponse.json(
      {
        success: true,
        data: setups,
        count: setups.length,
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  } catch (error: any) {
    console.error('[API_STAGED_SETUPS] GET Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch staged setups', data: [] },
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

    return NextResponse.json(
      { success: false, error: `Unsupported action "${action}". Expected PIN or UNPIN.` },
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
