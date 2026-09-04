import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

export interface DaemonCommandPayload {
  id: string;
  action: 'EMERGENCY_FLATTEN' | 'SNAP_BREAKEVEN' | 'CANCEL_PENDING' | 'TOGGLE_AUTO_EXEC' | 'UPDATE_SETTINGS';
  positionId?: string;
  timestamp: number;
  timeIso: string;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  metadata?: Record<string, any>;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, positionId, metadata } = body;

    if (!action) {
      return NextResponse.json({ error: 'Missing action parameter' }, { status: 400 });
    }

    const rootDir = process.cwd();
    const runLogsDir = path.join(rootDir, 'run_logs');
    if (!fs.existsSync(runLogsDir)) {
      fs.mkdirSync(runLogsDir, { recursive: true });
    }

    // When updating settings, atomically mirror active settings to daemon_live_settings.json
    if (action === 'UPDATE_SETTINGS' && metadata?.settings) {
      const liveSettingsFile = path.join(runLogsDir, 'daemon_live_settings.json');
      try {
        let existing = {};
        if (fs.existsSync(liveSettingsFile)) {
          existing = JSON.parse(fs.readFileSync(liveSettingsFile, 'utf8'));
        }
        const updated = { ...existing, ...metadata.settings, updatedAt: Date.now() };
        fs.writeFileSync(liveSettingsFile, JSON.stringify(updated, null, 2), 'utf8');
      } catch (e) {
        console.warn('[DAEMON COMMAND API] Failed to mirror daemon_live_settings.json:', e);
      }
    }

    const commandFile = path.join(runLogsDir, 'daemon_commands.json');
    let commands: DaemonCommandPayload[] = [];
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
    const newCommand: DaemonCommandPayload = {
      id: `cmd_${now}_${Math.random().toString(36).substring(2, 7)}`,
      action,
      positionId,
      timestamp: now,
      timeIso: new Date(now).toISOString(),
      status: 'PENDING',
      metadata,
    };

    // Keep only last 50 commands
    commands = [...commands.slice(-49), newCommand];

    fs.writeFileSync(commandFile, JSON.stringify(commands, null, 2), 'utf8');
    console.log(`[DAEMON COMMAND API] Dispatched command: ${action} for position ${positionId || 'ALL'}`);

    return NextResponse.json({
      success: true,
      command: newCommand,
    });
  } catch (error: any) {
    console.error('[DAEMON COMMAND API] Error writing command:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to dispatch command' },
      { status: 500 }
    );
  }
}
