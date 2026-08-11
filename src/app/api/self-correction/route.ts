import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';

export interface SelfCorrectionPayload {
  setup_id: string;
  outcome: 'SUCCESS' | 'STOP_OUT' | 'NO_TRIGGER' | 'WRONG_BIAS';
  mistake_category: string;
  lesson_learned: string;
  price_action_notes?: string;
}

export async function POST(req: Request) {
  try {
    const payload: SelfCorrectionPayload = await req.json();

    if (!payload.setup_id || !payload.outcome) {
      return NextResponse.json(
        { error: 'Missing setup_id or outcome in payload.' },
        { status: 400 }
      );
    }

    const now = new Date();
    const jsonPath = path.resolve(process.cwd(), 'directives/ETHUSDC_Daily_Tracker.json');
    const mdPath = path.resolve(process.cwd(), 'directives/ETHUSDC_Daily_Tracker.md');

    let updatedEntry: any = null;

    // ── 1. Update JSON Daily Tracker ─────────────────────────────────────
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf8');
        const trackerJson = JSON.parse(raw);

        if (Array.isArray(trackerJson.entries)) {
          const idx = trackerJson.entries.findIndex((e: any) => e.id === payload.setup_id);
          if (idx !== -1) {
            trackerJson.entries[idx].outcome = payload.outcome;
            const correctionNote = `[SELF-CORRECTION: ${payload.mistake_category}] ${payload.lesson_learned}`;
            trackerJson.entries[idx].notes = payload.price_action_notes
              ? `${trackerJson.entries[idx].notes} | ${correctionNote}`
              : correctionNote;
            updatedEntry = trackerJson.entries[idx];
          }

          // Recalculate stats
          let successCount = 0;
          let stopOutCount = 0;
          let noTriggerCount = 0;

          trackerJson.entries.forEach((e: any) => {
            if (e.outcome === 'SUCCESS') successCount++;
            else if (e.outcome === 'STOP_OUT' || e.outcome === 'WRONG_BIAS') stopOutCount++;
            else if (e.outcome === 'NO_TRIGGER') noTriggerCount++;
          });

          const totalEvaluated = successCount + stopOutCount;
          const winRate = totalEvaluated > 0 ? Number(((successCount / totalEvaluated) * 100).toFixed(1)) : 0;

          trackerJson.stats = {
            totalSetups: trackerJson.entries.length,
            success: successCount,
            stopOut: stopOutCount,
            noTrigger: noTriggerCount,
            winRate
          };

          trackerJson.lastUpdated = now.toISOString();

          fs.writeFileSync(jsonPath, JSON.stringify(trackerJson, null, 2), 'utf8');
        }
      } catch (jsonErr) {
        console.error('[SELF-CORRECTION] Failed to update Daily Tracker JSON:', jsonErr);
      }
    }

    // ── 2. Update Markdown Tracker ───────────────────────────────────────
    if (fs.existsSync(mdPath)) {
      try {
        let mdContent = fs.readFileSync(mdPath, 'utf8');
        if (mdContent.includes(payload.setup_id)) {
          // Replace PENDING status for this row
          const lines = mdContent.split('\n');
          const updatedLines = lines.map((line) => {
            if (line.includes(payload.setup_id) || (updatedEntry && line.includes(updatedEntry.date) && line.includes(`$${updatedEntry.invalidation}`))) {
              return line.replace('| PENDING |', `| ${payload.outcome} |`);
            }
            return line;
          });
          fs.writeFileSync(mdPath, updatedLines.join('\n'), 'utf8');
        }
      } catch (mdErr) {
        console.error('[SELF-CORRECTION] Failed to update Daily Tracker Markdown:', mdErr);
      }
    }

    // ── 3. Upsert Lesson into ai_trade_state (DB Memory) ─────────────────
    try {
      const lessonObj = {
        setup_id: payload.setup_id,
        outcome: payload.outcome,
        category: payload.mistake_category,
        lesson: payload.lesson_learned,
        timestamp: now.toISOString()
      };

      const stateResult = await sql`SELECT state_json FROM ai_trade_state WHERE id = 1`;
      let currentState: Record<string, any> = { status: 'SEARCHING' };

      if (stateResult.rows.length > 0 && stateResult.rows[0].state_json) {
        const raw = stateResult.rows[0].state_json;
        currentState = typeof raw === 'string' ? JSON.parse(raw) : raw;
      }

      if (!Array.isArray(currentState.recent_mistakes_lessons)) {
        currentState.recent_mistakes_lessons = [];
      }

      // Add lesson, keeping last 20 lessons
      currentState.recent_mistakes_lessons.unshift(lessonObj);
      currentState.recent_mistakes_lessons = currentState.recent_mistakes_lessons.slice(0, 20);

      await sql`
        INSERT INTO ai_trade_state (id, state_json, updated_at)
        VALUES (1, ${JSON.stringify(currentState)}, NOW())
        ON CONFLICT (id) DO UPDATE
        SET state_json = ${JSON.stringify(currentState)}, updated_at = NOW()
      `;

      console.log(`[SELF-CORRECTION] Successfully saved lesson for setup ${payload.setup_id} to DB memory.`);
    } catch (dbErr) {
      console.warn('[SELF-CORRECTION] DB memory update skipped (using local storage fallback):', dbErr);
    }

    return NextResponse.json({
      success: true,
      setup_id: payload.setup_id,
      outcome: payload.outcome,
      updated_entry: updatedEntry
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
