import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/postgres';

/**
 * Reset State API — Manual Override Endpoint (Phase 4)
 *
 * POST /api/reset-state
 *
 * Protected by NextAuth session validation.
 * Forcefully resets the `ai_trade_state` row (id=1) to SEARCHING.
 * Use when a trade is manually closed on Binance or the AI enters
 * a stale/corrupt state.
 */
export async function POST() {
  try {
    // ── 1. Session gate — fail-closed ────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized: No active session.' },
        { status: 401 }
      );
    }

    // ── 2. Force reset state to SEARCHING ────────────────────────────────
    const defaultState = JSON.stringify({ status: 'SEARCHING' });

    await sql`
      UPDATE ai_trade_state
      SET state_json = ${defaultState}, updated_at = NOW()
      WHERE id = 1
    `;

    console.log(`[RESET-STATE] State forcefully reset to SEARCHING by ${session.user.email}`);

    return NextResponse.json({
      success: true,
      message: 'AI state has been reset to SEARCHING.',
      resetBy: session.user.email,
      timestamp: new Date().toISOString(),
    });

  } catch (error: unknown) {
    console.error('[RESET-STATE] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to reset AI state.';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
