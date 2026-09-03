import { NextResponse } from 'next/server';
import {
  getBinanceAccountInfo,
  getBinanceOpenPositions,
  getBinanceOpenOrders,
  getBinanceUserTrades,
} from '@/lib/binanceFuturesClient';
import { evaluateExecutionSafetyGate } from '@/lib/binanceOrderRouter';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

interface CachedLiveState {
  timestamp: number;
  payload: any;
}

let cachedState: CachedLiveState | null = null;
const CACHE_TTL_MS = 3000; // 3-second in-memory rate-limit cache

/**
 * Helper to read latest local daemon session log when in Shadow / Dev mode
 */
function getLocalDaemonSessionFallback(symbol: string = 'ETHUSDC') {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const logPath = path.join(process.cwd(), 'run_logs', `live_session_${todayStr}.json`);
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      const parsed = JSON.parse(content);
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function GET(request: Request) {
  const now = Date.now();

  // 1. Serve cached response if within 3-second TTL window
  if (cachedState && now - cachedState.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({
      ...cachedState.payload,
      cached: true,
      cacheAgeMs: now - cachedState.timestamp,
    });
  }

  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || 'ETHUSDC').toUpperCase();

  const safetyGate = evaluateExecutionSafetyGate();

  // 2. Local Workstation or Unarmed Mode -> Shadow / Paper Telemetry
  if (!safetyGate.isAllowed) {
    const sessionLog = getLocalDaemonSessionFallback(symbol);
    const activePositions = sessionLog?.activePositions || [];
    const pendingOrders = sessionLog?.pendingLimitOrders || [];
    const completedTrades = sessionLog?.completedTrades || [];

    const mockEquity = sessionLog?.currentCapital || 15000.0;
    const sessionRealizedUsd = sessionLog?.totalRealizedUsd || 0.0;
    const sessionRealizedR = sessionLog?.totalRealizedR || 0.0;

    const shadowPayload = {
      success: true,
      environment: 'LOCAL_DEV',
      isLiveExecution: false,
      mode: safetyGate.mode,
      watermark: '🧪 LOCAL DEV — SHADOW / PAPER SANDBOX',
      gateReason: safetyGate.reason,
      symbol,
      account: {
        totalWalletBalance: mockEquity.toFixed(2),
        totalMarginBalance: (mockEquity + (activePositions[0]?.unrealizedUsd || 0)).toFixed(2),
        availableBalance: mockEquity.toFixed(2),
        totalUnrealizedProfit: (activePositions[0]?.unrealizedUsd || 0).toFixed(2),
        marginRatio: '0.00',
        todayRealizedUsd: sessionRealizedUsd.toFixed(2),
        todayRealizedR: sessionRealizedR.toFixed(2),
        currency: 'USD',
      },
      positions: activePositions.map((p: any) => ({
        symbol: p.symbol || symbol,
        positionAmt: p.direction === 'LONG' ? String(p.contractSize) : String(-p.contractSize),
        direction: p.direction,
        entryPrice: String(p.entryPrice),
        markPrice: String(p.entryPrice),
        unRealizedProfit: String(p.unrealizedUsd || 0),
        liquidationPrice: '0.00',
        leverage: '10',
        marginType: 'ISOLATED',
        notional: String((p.contractSize * p.entryPrice).toFixed(2)),
        activeStopLoss: String(p.activeStopLoss || 0),
        stage1Target: String(p.stage1Target || 0),
        stage2Target: String(p.stage2Target || 0),
      })),
      openOrders: pendingOrders.map((po: any) => ({
        orderId: 0,
        clientOrderId: `MOCK_PENDING_${po.id}`,
        symbol: po.symbol || symbol,
        side: po.direction === 'LONG' ? 'BUY' : 'SELL',
        type: 'LIMIT',
        price: String(po.limitEntryPrice || po.entryPrice),
        origQty: String(po.contractSize),
        stopPrice: String(po.initialStopLoss || 0),
        status: 'NEW',
        time: po.pendingTime || Date.now(),
        anchorName: po.anchorName || '5m Anchor',
      })),
      recentTrades: completedTrades.map((t: any) => ({
        symbol: t.symbol || symbol,
        id: t.id,
        orderId: 0,
        side: t.direction === 'LONG' ? 'BUY' : 'SELL',
        price: String(t.entryPrice),
        exitPrice: String(t.exitPrice || 0),
        qty: String(t.contractSize),
        realizedPnl: String(t.realizedUsd || 0),
        realizedR: String(t.realizedR || 0),
        commission: '0.0000',
        commissionAsset: 'USDC',
        time: t.closeTime || t.openTime || Date.now(),
        exitReason: t.exitReason || 'CLOSED',
      })),
      lastUpdated: now,
    };

    cachedState = { timestamp: now, payload: shadowPayload };
    return NextResponse.json({ ...shadowPayload, cached: false });
  }

  // 3. Live VPS Production Execution -> Query Signed Binance Endpoints
  try {
    const [accountData, positionsData, openOrdersRes, tradesRes] = await Promise.all([
      getBinanceAccountInfo(),
      getBinanceOpenPositions(symbol),
      getBinanceOpenOrders(symbol),
      getBinanceUserTrades(symbol, 25),
    ]);

    const openOrdersData = openOrdersRes.data || [];
    const tradesData = tradesRes.data || [];

    // Filter to active positions with non-zero size
    const activePositions = (positionsData || []).filter((p) => parseFloat(p.positionAmt) !== 0);

    const livePayload = {
      success: true,
      environment: 'VPS_PRODUCTION',
      isLiveExecution: true,
      mode: 'LIVE_BINANCE',
      watermark: '🔴 VPS LIVE PM2 — REAL MONEY ARMED',
      gateReason: safetyGate.reason,
      symbol,
      account: {
        totalWalletBalance: (accountData?.totalWalletBalance || 0).toFixed(2),
        totalMarginBalance: (accountData?.totalMarginBalance || 0).toFixed(2),
        availableBalance: (accountData?.availableBalance || 0).toFixed(2),
        totalUnrealizedProfit: (accountData?.totalUnrealizedProfit || 0).toFixed(2),
        marginRatio: '0.00',
        currency: symbol.endsWith('USDC') ? 'USDC' : 'USDT',
      },
      positions: activePositions.map((p) => {
        const amt = parseFloat(p.positionAmt);
        return {
          symbol: p.symbol,
          positionAmt: p.positionAmt,
          direction: amt > 0 ? 'LONG' : 'SHORT',
          entryPrice: p.entryPrice,
          markPrice: p.markPrice,
          unRealizedProfit: p.unRealizedProfit,
          liquidationPrice: p.liquidationPrice,
          leverage: p.leverage,
          marginType: p.marginType,
          notional: p.notional || String((Math.abs(amt) * parseFloat(p.markPrice || p.entryPrice || '0')).toFixed(2)),
          isolatedMargin: p.isolatedMargin,
          updateTime: p.updateTime,
        };
      }),
      openOrders: openOrdersData.map((o) => ({
        orderId: o.orderId,
        clientOrderId: o.clientOrderId,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        price: o.price,
        origQty: o.origQty,
        executedQty: o.executedQty,
        stopPrice: o.stopPrice,
        status: o.status,
        time: o.updateTime || Date.now(),
        reduceOnly: o.reduceOnly,
      })),
      recentTrades: tradesData.map((t) => ({
        symbol: t.symbol,
        id: t.id,
        orderId: t.orderId,
        side: t.side,
        price: t.price,
        qty: t.qty,
        realizedPnl: t.realizedPnl,
        commission: t.commission,
        commissionAsset: t.commissionAsset,
        time: t.time,
        maker: t.maker,
      })),
      lastUpdated: now,
    };

    cachedState = { timestamp: now, payload: livePayload };
    return NextResponse.json({ ...livePayload, cached: false });
  } catch (err: any) {
    console.error('[BINANCE_LIVE_STATE_API_ERROR]', err);
    return NextResponse.json(
      { success: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
