'use client';

/**
 * LiveTicker.tsx — Phase 3: Real-Time HUD Leaf Component
 *
 * ARCHITECTURE NOTE:
 *   This component is intentionally isolated from NavigationHeader.
 *   By keeping useBinanceWS here (at the leaf), only this tiny component
 *   re-renders on every WS tick. NavigationHeader stays completely static.
 *
 * GUARDRAIL:
 *   livePrice is ONLY used for visual display.
 *   It is NEVER forwarded to any AI JSON payload or global state.
 */

import { useRef, useEffect, useState } from 'react';
import { useBinanceWS } from '@/hooks/useBinanceWS';

// ─── Types ────────────────────────────────────────────────────────────────────

type TickDirection = 'up' | 'down' | 'neutral';

// ─── Status Dot ──────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ReturnType<typeof useBinanceWS>['status'] }) {
  if (status === 'OPEN') {
    return (
      <span className="relative flex h-2 w-2" title="WebSocket: Connected">
        {/* Ping ring — expands outward */}
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#50ffaf] opacity-75" />
        {/* Solid core */}
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#50ffaf]" />
      </span>
    );
  }

  if (status === 'CONNECTING') {
    return (
      <span
        className="relative flex h-2 w-2 rounded-full bg-yellow-400 animate-pulse"
        title="WebSocket: Connecting…"
      />
    );
  }

  // CLOSED | ERROR
  return (
    <span
      className="relative flex h-2 w-2 rounded-full bg-[#ffb4ab]"
      title={`WebSocket: ${status}`}
    />
  );
}

// ─── LiveTicker ───────────────────────────────────────────────────────────────

export function LiveTicker() {
  const { livePrice, status } = useBinanceWS({ symbol: 'ethusdc', interval: '1m' });

  // Track previous price to determine tick direction
  const prevPriceRef = useRef<number | null>(null);
  const [direction, setDirection] = useState<TickDirection>('neutral');
  // Flash timer ref — clears itself so the color reverts after 600 ms
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (livePrice === null) return;

    const prev = prevPriceRef.current;

    if (prev !== null && livePrice !== prev) {
      const dir: TickDirection = livePrice > prev ? 'up' : 'down';
      setDirection(dir);

      // Clear any existing flash timer
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);

      // Revert to neutral after flash duration
      flashTimerRef.current = setTimeout(() => {
        setDirection('neutral');
      }, 600);
    }

    prevPriceRef.current = livePrice;

    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [livePrice]);

  // ── Formatted price ──────────────────────────────────────────────────────
  const formatted = livePrice !== null
    ? `$${livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

  // ── Tick colour class ────────────────────────────────────────────────────
  const priceColorClass =
    direction === 'up' ? 'text-[#50ffaf]' :
      direction === 'down' ? 'text-[#ffb4ab]' :
        'text-[#e5e2e3]';

  return (
    <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 bg-[#0e0e0f] border border-[#4a4457]/50 rounded select-none">
      {/* Status dot */}
      <StatusDot status={status} />

      {/* Asset label */}
      <span className="font-mono text-[10px] text-[#4a4457] uppercase tracking-wider">
        ETH
      </span>

      {/* Live price — transitions colour on each tick */}
      <span
        className={`font-mono text-[11px] font-bold tabular-nums transition-colors duration-300 ${priceColorClass}`}
      >
        {formatted}
      </span>
    </div>
  );
}
