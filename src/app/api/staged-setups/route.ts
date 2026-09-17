import { NextResponse } from 'next/server';
import {
  listStagedSetups,
  pinSetup,
  unpinSetup,
  getStagedSetupById,
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

      if (!direction || !entryPrice || !stopLoss || !target1) {
        return NextResponse.json(
          { success: false, error: 'Missing required setup parameters (direction, entryPrice, stopLoss, target1)' },
          { status: 400 }
        );
      }

      // Financial boundary sanity check
      const dirUpper = String(direction).toUpperCase();
      const numEntry = Number(entryPrice);
      const numSl = Number(stopLoss);
      const numTp1 = Number(target1);

      if (dirUpper === 'LONG') {
        if (numSl >= numEntry) {
          return NextResponse.json(
            { success: false, error: 'Sanity validation failed: LONG Stop Loss must be below Entry Price.' },
            { status: 400 }
          );
        }
        if (numTp1 <= numEntry) {
          return NextResponse.json(
            { success: false, error: 'Sanity validation failed: LONG Target 1 must be above Entry Price.' },
            { status: 400 }
          );
        }
      } else if (dirUpper === 'SHORT') {
        if (numSl <= numEntry) {
          return NextResponse.json(
            { success: false, error: 'Sanity validation failed: SHORT Stop Loss must be above Entry Price.' },
            { status: 400 }
          );
        }
        if (numTp1 >= numEntry) {
          return NextResponse.json(
            { success: false, error: 'Sanity validation failed: SHORT Target 1 must be below Entry Price.' },
            { status: 400 }
          );
        }
      }

      const input: CreateStagedSetupInput = {
        symbol,
        direction: dirUpper === 'SHORT' ? 'SHORT' : 'LONG',
        entryPrice: numEntry,
        entryRangeLow: entryRangeLow != null ? Number(entryRangeLow) : null,
        entryRangeHigh: entryRangeHigh != null ? Number(entryRangeHigh) : null,
        stopLoss: numSl,
        target1: numTp1,
        target2: target2 != null ? Number(target2) : null,
        target3: target3 != null ? Number(target3) : null,
        riskRewardRatio: riskRewardRatio != null ? Number(riskRewardRatio) : null,
        riskUsd: riskUsd != null ? Number(riskUsd) : null,
        riskPct: riskPct != null ? Number(riskPct) : null,
        contractSize: contractSize != null ? Number(contractSize) : null,
        sourceReference,
        analysisLogId: analysisLogId != null ? Number(analysisLogId) : null,
        decisionLogId: decisionLogId != null ? Number(decisionLogId) : null,
        notes,
        metadata,
      };

      const staged = await pinSetup(input);
      return NextResponse.json(
        {
          success: true,
          message: `Setup #${staged.id} pinned to Copilot Staging Deck.`,
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
