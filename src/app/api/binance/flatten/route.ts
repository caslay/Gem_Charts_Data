import { NextResponse } from 'next/server';
import { routeEmergencyFlatten } from '@/lib/binanceOrderRouter';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const symbol = (body?.symbol || 'ETHUSDC').toUpperCase();

    console.log(`[API_FLATTEN] 🚨 Emergency Flatten requested via Web UI for ${symbol}`);

    // 1. Dispatch emergency flatten command to headless daemon via daemon_commands.json queue
    try {
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const cmdFile = path.join(dataDir, 'daemon_commands.json');
      let cmds: any[] = [];
      if (fs.existsSync(cmdFile)) {
        cmds = JSON.parse(fs.readFileSync(cmdFile, 'utf8'));
      }
      cmds.push({
        id: `web_flatten_${Date.now()}`,
        action: 'EMERGENCY_FLATTEN',
        timestamp: Date.now(),
        status: 'PENDING',
      });
      fs.writeFileSync(cmdFile, JSON.stringify(cmds, null, 2));
    } catch (cmdErr) {
      console.warn('[API_FLATTEN] Could not write to daemon_commands.json:', cmdErr);
    }

    // 2. Call Binance Order Router to cancel all orders & market close on exchange
    const routerResult = await routeEmergencyFlatten(symbol);

    return NextResponse.json({
      success: routerResult.success,
      message: routerResult.message,
      timestamp: Date.now(),
      symbol,
    });
  } catch (err: any) {
    console.error('[API_FLATTEN_ERROR]', err);
    return NextResponse.json(
      { success: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
