import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { userStagedSetupsStore, resolveAndValidateSetupGeometry } from '@/lib/staging/userStagedSetupsStore';
import { evaluateExecutionSafetyGate } from '@/lib/binanceOrderRouter';
import { TelegramNotifier } from '@/lib/notifications/telegramNotifier';
import { sql } from '@/lib/postgres';
import { ensureAgentDecisionTableInitialized } from '@/lib/agentEngineHandlers';
import { ExecuteStagedRequestPayload } from '@/types/stagedSetupTypes';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExecuteStagedRequestPayload;
    const { stagedId, targetMode, executionSource = 'COCKPIT_MANUAL_OVERRIDE' } = body;

    if (!stagedId || !targetMode) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: stagedId and targetMode.' },
        { status: 400 }
      );
    }

    if (targetMode !== 'PAPER_TRADING' && targetMode !== 'LIVE_BINANCE') {
      return NextResponse.json(
        { success: false, error: `Invalid targetMode: ${targetMode}. Must be PAPER_TRADING or LIVE_BINANCE.` },
        { status: 400 }
      );
    }

    // 1. Fetch staged setup
    const stagedSetup = await userStagedSetupsStore.getStagedSetupById(stagedId);
    if (!stagedSetup) {
      return NextResponse.json(
        { success: false, error: `Staged setup #${stagedId} not found or expired.` },
        { status: 404 }
      );
    }

    // 2. Mathematical Directional and Risk Sanity Checks
    const geom = resolveAndValidateSetupGeometry({
      direction: stagedSetup.direction,
      entryPrice: stagedSetup.entryPrice,
      stopLoss: stagedSetup.stopLoss,
      target1: stagedSetup.target1,
      target2: stagedSetup.target2,
      target3: stagedSetup.target3,
      riskRewardRatio: stagedSetup.riskRewardRatio,
    });

    if (!geom.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: `Corrupt Geometry: ${geom.error}`,
        },
        { status: 400 }
      );
    }

    const direction = geom.resolvedDirection;
    const entryPrice = geom.entryPrice;
    const stopLoss = geom.stopLoss;
    const target1 = geom.target1;
    const target2 = geom.target2;
    const symbol = stagedSetup.symbol;

    if (geom.wasDirectionCorrected) {
      console.warn(`[EXECUTE_STAGED] ⚠️ Auto-aligned setup #${stagedId} direction: ${geom.correctionReason}`);
    }

    // 3. Execution Safety Gate for LIVE_BINANCE
    if (targetMode === 'LIVE_BINANCE') {
      const safetyGate = evaluateExecutionSafetyGate();
      if (!safetyGate.isAllowed) {
        return NextResponse.json(
          {
            success: false,
            error: `Safety Gate Veto: ${safetyGate.reason}`,
          },
          { status: 403 }
        );
      }
    }

    // 4. Correlate or Create Decision Record in agent_decision_log
    await ensureAgentDecisionTableInitialized().catch(() => {});
    let decisionId: number | undefined = stagedSetup.decisionLogId ?? undefined;

    if (decisionId) {
      try {
        await sql`
          UPDATE agent_decision_log
          SET execution_mode = ${targetMode},
              status = 'ARMED',
              narrative = COALESCE(narrative, '') || ' [COCKPIT_MANUAL_OVERRIDE: Staged #' || ${stagedId} || ' promoted to ' || ${targetMode} || ' @ ' || NOW() || ']',
              updated_at = NOW()
          WHERE id = ${decisionId};
        `;
      } catch (dbErr: any) {
        console.warn(`[EXECUTE_STAGED] Database update error for existing record #${decisionId}:`, dbErr?.message || dbErr);
      }
    } else {
      try {
        const insertRes = await sql`
          INSERT INTO agent_decision_log (
            agent_id, symbol, bias_signal, confidence,
            invalidation_level, target_1, target_2, limit_entry_price,
            execution_mode, status, submitted_at, narrative
          ) VALUES (
            ${stagedSetup.metadata?.agentId || 'COCKPIT_OPERATOR'},
            ${symbol || 'ETHUSDT'},
            ${direction === 'LONG' ? 'CONFIRMED_BULLISH' : 'CONFIRMED_BEARISH'},
            ${stagedSetup.metadata?.confidence || 0.85},
            ${stopLoss},
            ${target1},
            ${target2 || null},
            ${entryPrice},
            ${targetMode},
            'ARMED',
            ${Date.now()},
            ${`[COCKPIT_MANUAL_OVERRIDE: Staged #${stagedId} executed directly by operator into ${targetMode}]`}
          ) RETURNING id;
        `;
        if (insertRes.rows && insertRes.rows.length > 0) {
          decisionId = Number(insertRes.rows[0].id);
        }
      } catch (insertErr: any) {
        console.warn(`[EXECUTE_STAGED] Could not insert new decision record (offline/sandbox):`, insertErr?.message || insertErr);
        // Generate pseudo decisionId if DB write is disallowed
        decisionId = Math.floor(Date.now() / 1000);
      }
    }

    // 5. Update Staging Store: Mark Setup as Deployed
    await userStagedSetupsStore.markSetupDeployed(stagedId, targetMode);

    // 6. Append Command to daemon_commands.json
    const runLogsDir = path.join(process.cwd(), 'run_logs');
    if (!fs.existsSync(runLogsDir)) {
      try {
        fs.mkdirSync(runLogsDir, { recursive: true });
      } catch {}
    }

    const commandFile = path.join(runLogsDir, 'daemon_commands.json');
    let commands: any[] = [];
    if (fs.existsSync(commandFile)) {
      try {
        const raw = fs.readFileSync(commandFile, 'utf8');
        commands = JSON.parse(raw);
        if (!Array.isArray(commands)) commands = [];
      } catch {
        commands = [];
      }
    }

    const now = Date.now();
    const newCommand = {
      id: `cmd_${now}_${Math.random().toString(36).substring(2, 7)}`,
      action: 'EXECUTE_STAGED',
      decisionId: decisionId ? Number(decisionId) : undefined,
      targetMode,
      timestamp: now,
      timeIso: new Date(now).toISOString(),
      status: 'PENDING',
      metadata: {
        stagedId,
        decisionId,
        targetMode,
        executionSource,
        stagedSetup,
      },
    };

    commands = [...commands.slice(-49), newCommand];
    try {
      fs.writeFileSync(commandFile, JSON.stringify(commands, null, 2), 'utf8');
    } catch (fsErr: any) {
      console.warn('[EXECUTE_STAGED] Warning writing daemon_commands.json:', fsErr);
    }

    // 7. Dispatch Telegram HTML Notification
    try {
      const notifier = new TelegramNotifier();
      const modeBadge = targetMode === 'LIVE_BINANCE' ? '🚨 <b>LIVE BINANCE</b>' : '🧪 <b>PAPER TRADING</b>';
      const dirBadge = stagedSetup.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
      const telegramMsg = `
⚡ <b>[COCKPIT MANUAL OVERRIDE] Staged Setup Deployed</b>

• <b>Mode:</b> ${modeBadge}
• <b>Symbol:</b> <code>${stagedSetup.symbol}</code> (${dirBadge})
• <b>Limit Entry:</b> <code>$${entryPrice.toFixed(2)}</code>
• <b>Stop Loss:</b> <code>$${stopLoss.toFixed(2)}</code>
• <b>TP 1:</b> <code>$${target1.toFixed(2)}</code>${target2 ? `\n• <b>TP 2:</b> <code>$${target2.toFixed(2)}</code>` : ''}
• <b>Authority:</b> <code>COCKPIT_MANUAL_OVERRIDE</code> (48-bar TTL, Dead Zone Bypassed)
• <b>Staged ID:</b> <code>#${stagedSetup.id}</code> (Decision #${decisionId || 'N/A'})
`.trim();

      notifier.sendRawMessage(telegramMsg, { parseMode: 'HTML' }).catch((err) => {
        console.warn('[EXECUTE_STAGED] Telegram notification error:', err?.message || err);
      });
    } catch (tgErr) {
      console.warn('[EXECUTE_STAGED] Could not initialize Telegram notifier:', tgErr);
    }

    return NextResponse.json({
      success: true,
      message: `Setup #${stagedId} successfully deployed to ${targetMode}.`,
      data: {
        stagedId,
        decisionId,
        targetMode,
        executionSource,
      },
    });
  } catch (error: any) {
    console.error('[API /api/daemon/execute-staged] Unhandled exception:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal server error while executing staged setup.' },
      { status: 500 }
    );
  }
}
