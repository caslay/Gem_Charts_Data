import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { StrategyExecutionPosition } from '@/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { DaemonSessionLog, DaemonSessionEvent } from '@/lib/daemon/daemonLedger';

export const dynamic = 'force-dynamic';

function getTodayUtcString(): string {
  return new Date().toISOString().split('T')[0];
}

interface DaemonStateResponse {
  success: boolean;
  isDaemonActive: boolean;
  lastHeartbeatTime: number | null;
  lastEvent: DaemonSessionEvent | null;
  symbol: string;
  equity: number;
  initialEquity: number;
  totalRealizedR: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  daemonState?: 'SEARCHING' | 'ARMED_WATCHING_TRIGGER' | 'ORDER_RESTING' | 'ACTIVE_TRADE' | string;
  armedIntents?: any[];
  activePositions: any[];
  pendingOrders: any[];
  completedTrades: StrategyExecutionPosition[];
  allTodayTrades: any[];
  serverTime: number;
  compoundingRiskPct?: number;
  liveSettings?: Record<string, any>;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get('symbol') || 'ETHUSDC').toUpperCase();
    const today = searchParams.get('date') || getTodayUtcString();

    const rootDir = process.cwd();
    const sessionLogPath = path.join(rootDir, 'run_logs', `live_session_${today}.json`);
    const trackerJsonPath = path.join(rootDir, 'directives', 'ETHUSDC_Daily_Tracker.json');

    let sessionLog: DaemonSessionLog | null = null;
    if (fs.existsSync(sessionLogPath)) {
      try {
        const raw = fs.readFileSync(sessionLogPath, 'utf8');
        sessionLog = JSON.parse(raw);
      } catch (err) {
        console.warn('[api/daemon/state] Warning reading session log:', err);
      }
    }

    // Load Daily Tracker records for today
    let allTodayTrades: any[] = [];
    if (fs.existsSync(trackerJsonPath)) {
      try {
        const rawTracker = fs.readFileSync(trackerJsonPath, 'utf8');
        const tracker = JSON.parse(rawTracker);
        if (tracker.trades && Array.isArray(tracker.trades)) {
          allTodayTrades = tracker.trades.filter((t: any) => t.date === today);
        }
      } catch (err) {
        console.warn('[api/daemon/state] Warning reading tracker json:', err);
      }
    }

    if (!sessionLog) {
      // Default flat state when no daemon session has run today yet
      const fallback: DaemonStateResponse = {
        success: true,
        isDaemonActive: false,
        lastHeartbeatTime: null,
        lastEvent: null,
        symbol,
        equity: 1000.0,
        initialEquity: 1000.0,
        totalRealizedR: 0,
        totalTrades: allTodayTrades.length,
        winningTrades: allTodayTrades.filter((t) => (t.realized_r || 0) > 0).length,
        losingTrades: allTodayTrades.filter((t) => (t.realized_r || 0) < 0).length,
        winRatePct: allTodayTrades.length > 0
          ? (allTodayTrades.filter((t) => (t.realized_r || 0) > 0).length / allTodayTrades.length) * 100
          : 0,
        activePositions: [],
        pendingOrders: [],
        completedTrades: [],
        allTodayTrades,
        serverTime: Date.now(),
      };
      return NextResponse.json(fallback);
    }

    // Extract in-flight active positions and resting pending limit orders from session events
    const activeMap = new Map<string, StrategyExecutionPosition>();
    const pendingMap = new Map<string, StrategyExecutionPosition>();
    let lastHeartbeat: number | null = null;
    let lastEvt: DaemonSessionEvent | null = null;

    const events = sessionLog.events || [];
    if (events.length > 0) {
      lastEvt = events[events.length - 1];
    }

    for (const evt of events) {
      if (evt.timestamp) {
        lastHeartbeat = Math.max(lastHeartbeat || 0, evt.timestamp);
      }

      if (evt.type === 'LIMIT_ORDER_PLACED' && evt.position?.id) {
        pendingMap.set(evt.position.id, evt.position as StrategyExecutionPosition);
      } else if (evt.type === 'ORDER_FILLED' && evt.position?.id) {
        pendingMap.delete(evt.position.id);
        activeMap.set(evt.position.id, evt.position as StrategyExecutionPosition);
      } else if ((evt.type === 'STAGE_1_HARVEST' || evt.type === 'STAGE_2_HARVEST' || evt.type === 'EARLY_BREAKEVEN') && evt.position?.id) {
        activeMap.set(evt.position.id, evt.position as StrategyExecutionPosition);
      } else if (evt.type === 'POSITION_CLOSED' && evt.position?.id) {
        activeMap.delete(evt.position.id);
        pendingMap.delete(evt.position.id);
      } else if (evt.type === 'LIMIT_ORDER_CANCELLED' && evt.position?.id) {
        pendingMap.delete(evt.position.id);
      }
    }

    const now = Date.now();
    // Daemon is considered active if we received an event/heartbeat in the last 120 seconds
    const isDaemonActive = lastHeartbeat !== null && (now - lastHeartbeat) < 120_000;

    const winCount = sessionLog.winningTrades || 0;
    const lossCount = sessionLog.losingTrades || 0;
    const totalClosed = sessionLog.totalTrades || (winCount + lossCount);
    const winRatePct = totalClosed > 0 ? (winCount / totalClosed) * 100 : 0;

    // Read active live settings from disk if available
    const liveSettingsPath = path.join(rootDir, 'run_logs', 'daemon_live_settings.json');
    let liveSettings: any = {};
    if (fs.existsSync(liveSettingsPath)) {
      try {
        liveSettings = JSON.parse(fs.readFileSync(liveSettingsPath, 'utf8'));
      } catch {}
    }

    // Stage-tagged positions
    const stageTaggedPositions = Array.from(activeMap.values()).map((p: any) => {
      let stageTag = 'IN_FLIGHT_STAGE_1';
      if (p.isStage2Filled) {
        stageTag = 'IN_FLIGHT_STAGE_3';
      } else if (p.isStage1Filled) {
        stageTag = 'IN_FLIGHT_STAGE_2';
      }
      return { ...p, stage: stageTag };
    });

    // Stage-tagged pending orders
    const stageTaggedPendingOrders = Array.from(pendingMap.values()).map((po: any) => ({
      ...po,
      stage: 'ORDER_RESTING',
    }));

    const armedIntents = Array.isArray(sessionLog.armedIntents) ? sessionLog.armedIntents : [];
    const activeArmedIntents = armedIntents.filter(
      (i: any) => i.stage === 'ARMED_PENDING' || i.stage === 'PROXIMITY_ELEVATED'
    );

    let daemonState: 'SEARCHING' | 'ARMED_WATCHING_TRIGGER' | 'ORDER_RESTING' | 'ACTIVE_TRADE' =
      'SEARCHING';
    if (stageTaggedPositions.length > 0) {
      daemonState = 'ACTIVE_TRADE';
    } else if (stageTaggedPendingOrders.length > 0) {
      daemonState = 'ORDER_RESTING';
    } else if (activeArmedIntents.length > 0) {
      daemonState = 'ARMED_WATCHING_TRIGGER';
    } else if (sessionLog.daemonState) {
      daemonState = sessionLog.daemonState as any;
    }

    const response: DaemonStateResponse = {
      success: true,
      isDaemonActive,
      lastHeartbeatTime: lastHeartbeat,
      lastEvent: lastEvt,
      daemonState,
      armedIntents,
      symbol: sessionLog.symbol || symbol,
      equity: sessionLog.currentEquity || 1000.0,
      initialEquity: sessionLog.initialEquity || 1000.0,
      totalRealizedR: sessionLog.totalRealizedR || 0,
      totalTrades: totalClosed,
      winningTrades: winCount,
      losingTrades: lossCount,
      winRatePct,
      compoundingRiskPct: liveSettings.compoundingRiskPct ?? 2.0,
      liveSettings,
      activePositions: stageTaggedPositions,
      pendingOrders: stageTaggedPendingOrders,
      completedTrades: sessionLog.completedTrades || [],
      allTodayTrades,
      serverTime: now,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.warn('[api/daemon/state] Non-fatal state read fallback:', error?.message || error);
    return NextResponse.json(
      {
        success: true,
        isDaemonActive: false,
        lastHeartbeatTime: null,
        lastEvent: null,
        symbol: 'ETHUSDC',
        equity: 1000.0,
        initialEquity: 1000.0,
        totalRealizedR: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRatePct: 0,
        activePositions: [],
        pendingOrders: [],
        completedTrades: [],
        allTodayTrades: [],
        serverTime: Date.now(),
        isFallback: true,
      },
      { status: 200 }
    );
  }
}
