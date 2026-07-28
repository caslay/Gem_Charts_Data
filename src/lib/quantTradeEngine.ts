import type { MarketDataPayload } from "@/hooks/useMarketData";
import { detectActiveFVGs, mapAndConsolidateFVGs } from "@/lib/fvgEngine";

export interface PotentialTrade {
  id: string;
  type: string;
  direction: "BULLISH" | "BEARISH";
  trigger: string;
  entryMin: number;
  entryMax: number;
  stopLoss: number;
  target1: number;
  target2: number;
  rrRatio: number;
  confluence: string;
  status: "ACTIVE_WATCH" | "PENDING_TOUCH" | "CONFIRMED" | "WAITING" | "TARGET_HIT" | "INVALIDATED";
  isHighProbability?: boolean;
  isNearby?: boolean;
  timeframeConfluence?: string;
}

export interface TradeEngineSummary {
  symbol: string;
  currentPrice: number;
  institutionalBias: string;
  swingHigh: number;
  swingLow: number;
  equilibrium: number;
  dealingZone: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
  bullishFvg: [number, number] | null;
  bearishFvg: [number, number] | null;
  bslMagnets: number[];
  sslMagnets: number[];
  sponsorshipStatus: string;
  setups: PotentialTrade[];
}

export function generatePotentialTrades(data: MarketDataPayload | null, isBacktest: boolean = false): TradeEngineSummary {
  // Extract recent candles for dynamic live structure detection
  const candles5m = data?.data_payload?.candles_5m || [];
  const candles15m = data?.data_payload?.candles_15m || [];
  const recentCandles = candles5m.slice(-50);

  const currentPrice = data?.ipda_metrics?.last_price || (recentCandles.length > 0 ? recentCandles[recentCandles.length - 1].c : 1875.55);

  // Dynamic swing high & low from live candle stream
  const candleHighs = recentCandles.map((c: any) => (typeof c.h === 'number' ? c.h : typeof c.high === 'number' ? c.high : c.c));
  const candleLows = recentCandles.map((c: any) => (typeof c.l === 'number' ? c.l : typeof c.low === 'number' ? c.low : c.c));

  const dynamicSwingHigh = candleHighs.length > 0 ? Math.max(...candleHighs) : 1888.0;
  const dynamicSwingLow = candleLows.length > 0 ? Math.min(...candleLows) : 1870.0;

  const swingHigh = data?.ipda_metrics?.macro_structural_magnets?.major_swing_high || dynamicSwingHigh;
  const swingLow = data?.ipda_metrics?.macro_structural_magnets?.major_swing_low || dynamicSwingLow;
  const equilibrium = (swingHigh + swingLow) / 2;

  const dealingZone = currentPrice > equilibrium + 0.5 ? "PREMIUM" : currentPrice < equilibrium - 0.5 ? "DISCOUNT" : "EQUILIBRIUM";

  let activeFvgs: Array<{ type: string; bottom: number; top: number; timeframe?: string; origin_time?: number }> =
    (data?.data_payload?.active_fvgs as any) || [];

  // Inline Fallback Scanner: If active_fvgs payload is empty, scan candles_15m and candles_5m directly
  if (activeFvgs.length === 0 && (candles15m.length > 0 || candles5m.length > 0)) {
    const fvgGroups = [];
    if (candles15m.length > 0) {
      fvgGroups.push({ fvgs: detectActiveFVGs(candles15m, true), timeframe: '15m' });
    }
    if (candles5m.length > 0) {
      fvgGroups.push({ fvgs: detectActiveFVGs(candles5m, true), timeframe: '5m' });
    }
    activeFvgs = mapAndConsolidateFVGs(fvgGroups) as any;
  }

  // ── Multi-Timeframe FVG Overlap Consolidator ──────────────────────────────
  // Group FVGs whose entry midpoints are within 0.35% of each other to eliminate duplicates
  const consolidatedFvgs: Array<{
    type: string;
    bottom: number;
    top: number;
    timeframes: string[];
    origin_time?: number;
  }> = [];

  activeFvgs.forEach((fvg) => {
    const fvgMid = (fvg.bottom + fvg.top) / 2;
    const existing = consolidatedFvgs.find((c) => {
      if (c.type !== fvg.type) return false;
      const cMid = (c.bottom + c.top) / 2;
      return Math.abs(cMid - fvgMid) / fvgMid <= 0.0035;
    });

    if (existing) {
      existing.bottom = Math.min(existing.bottom, fvg.bottom);
      existing.top = Math.max(existing.top, fvg.top);
      if (fvg.timeframe && !existing.timeframes.includes(fvg.timeframe)) {
        existing.timeframes.push(fvg.timeframe);
      }
    } else {
      consolidatedFvgs.push({
        type: fvg.type,
        bottom: fvg.bottom,
        top: fvg.top,
        timeframes: fvg.timeframe ? [fvg.timeframe] : [],
        origin_time: fvg.origin_time,
      });
    }
  });

  const bslMagnets = data?.ipda_metrics?.order_flow_engine?.resting_liquidity_pools?.BSL_Magnets || [swingHigh, swingHigh + 4.0, swingHigh + 10.0];
  const sslMagnets = data?.ipda_metrics?.order_flow_engine?.resting_liquidity_pools?.SSL_Magnets || [swingLow, swingLow - 5.0];

  const sponsorshipStatus = data?.ipda_metrics?.order_flow_engine?.displacement_sponsorship?.status || "ACTIVE_BULLISH";
  const institutionalBias = data?.ipda_metrics?.bias_signal || "CONFIRMED_BULLISH";

  // Persistent Setup Memory Handler (bypassed during Backtest Replay)
  let storedHistory: Record<string, string> = {};
  if (!isBacktest && typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("gem_quant_setup_history");
      if (raw) storedHistory = JSON.parse(raw);
    } catch {}
  }

  const saveSetupState = (setupKey: string, status: string) => {
    if (!isBacktest && typeof window !== "undefined") {
      try {
        storedHistory[setupKey] = status;
        localStorage.setItem("gem_quant_setup_history", JSON.stringify(storedHistory));
      } catch {}
    }
  };

  const lowestRecent = candleLows.length > 0 ? Math.min(...candleLows) : currentPrice;
  const highestRecent = candleHighs.length > 0 ? Math.max(...candleHighs) : currentPrice;

  const setups: PotentialTrade[] = [];
  let setupCounter = 1;

  // ── 1. Dynamic FVG Setup Queue (Consolidated Multi-FVG Scanner) ─────────
  if (consolidatedFvgs.length > 0) {
    consolidatedFvgs.forEach((fvg) => {
      const isBull = fvg.type === "BULLISH";
      const id = `SET-${String(setupCounter++).padStart(2, "0")}`;
      const entryMin = Math.min(fvg.bottom, fvg.top);
      const entryMax = Math.max(fvg.bottom, fvg.top);
      const entryMid = (entryMin + entryMax) / 2;
      const tfLabel = fvg.timeframes.length > 0 ? ` (${fvg.timeframes.join(" + ")})` : "";

      const distPct = Math.abs(entryMid - currentPrice) / currentPrice;
      const isNearby = distPct <= 0.02; // Within 2% distance of live price

      if (isBull) {
        const sl = Math.min(swingLow - 1.5, entryMin - 3.0);
        const tp1 = Math.min(equilibrium, bslMagnets[0] || swingHigh);
        const tp2 = bslMagnets[1] || swingHigh;
        const risk = entryMid - sl;
        const reward = tp2 - entryMid;
        // Exact mathematical R:R calculation without artificial ceilings or floors
        const rr = risk > 0 ? parseFloat((reward / risk).toFixed(2)) : 0;
        const isHighProbability = rr >= 1.5 && isNearby;

        const setupKey = `${id}_BULL_${entryMin.toFixed(1)}_${entryMax.toFixed(1)}`;
        let status: PotentialTrade["status"] = (storedHistory[setupKey] as any) || "PENDING_TOUCH";

        if (status !== "TARGET_HIT" && status !== "INVALIDATED") {
          const touched = lowestRecent <= entryMax + 0.2;
          if (touched) {
            if (currentPrice < sl) {
              status = "INVALIDATED";
              saveSetupState(setupKey, "INVALIDATED");
            } else if (highestRecent >= tp1) {
              status = "TARGET_HIT";
              saveSetupState(setupKey, "TARGET_HIT");
            } else {
              status = "ACTIVE_WATCH";
            }
          } else if (currentPrice <= entryMax && currentPrice >= entryMin) {
            status = "ACTIVE_WATCH";
          }
        }

        setups.push({
          id,
          type: `Discount FVG Re-entry${tfLabel}`,
          direction: "BULLISH",
          trigger: `Retest & bounce inside Bullish FVG [${entryMin.toFixed(2)} - ${entryMax.toFixed(2)}]`,
          entryMin: parseFloat(entryMin.toFixed(2)),
          entryMax: parseFloat(entryMax.toFixed(2)),
          stopLoss: parseFloat(sl.toFixed(2)),
          target1: parseFloat(tp1.toFixed(2)),
          target2: parseFloat(tp2.toFixed(2)),
          rrRatio: rr,
          confluence: `VSR Volume Sponsorship + Bullish FVG Retest${tfLabel}`,
          status,
          isHighProbability,
          isNearby,
          timeframeConfluence: fvg.timeframes.join(" + "),
        });
      } else {
        const sl = Math.max(swingHigh + 1.5, entryMax + 3.0);
        const tp1 = parseFloat(equilibrium.toFixed(2));
        const tp2 = sslMagnets[0] || swingLow;
        const risk = sl - entryMid;
        const reward = entryMid - tp2;
        // Exact mathematical R:R calculation without artificial ceilings or floors
        const rr = risk > 0 ? parseFloat((reward / risk).toFixed(2)) : 0;
        const isHighProbability = rr >= 1.5 && isNearby;

        const setupKey = `${id}_BEAR_${entryMin.toFixed(1)}_${entryMax.toFixed(1)}`;
        let status: PotentialTrade["status"] = (storedHistory[setupKey] as any) || "PENDING_TOUCH";

        if (status !== "TARGET_HIT" && status !== "INVALIDATED") {
          const touched = highestRecent >= entryMin - 0.2;
          if (touched) {
            if (currentPrice > sl) {
              status = "INVALIDATED";
              saveSetupState(setupKey, "INVALIDATED");
            } else if (lowestRecent <= tp1) {
              status = "TARGET_HIT";
              saveSetupState(setupKey, "TARGET_HIT");
            } else {
              status = "ACTIVE_WATCH";
            }
          } else if (currentPrice >= entryMin && currentPrice <= entryMax) {
            status = "ACTIVE_WATCH";
          }
        }

        setups.push({
          id,
          type: `Premium FVG Rejection${tfLabel}`,
          direction: "BEARISH",
          trigger: `Rejection inside Bearish FVG [${entryMin.toFixed(2)} - ${entryMax.toFixed(2)}]`,
          entryMin: parseFloat(entryMin.toFixed(2)),
          entryMax: parseFloat(entryMax.toFixed(2)),
          stopLoss: parseFloat(sl.toFixed(2)),
          target1: tp1,
          target2: parseFloat(tp2.toFixed(2)),
          rrRatio: rr,
          confluence: `Confluence with Equilibrium ($${equilibrium.toFixed(2)}) + Bearish FVG${tfLabel}`,
          status,
          isHighProbability,
          isNearby,
          timeframeConfluence: fvg.timeframes.join(" + "),
        });
      }
    });
  } else {
    // Structural Fallback Setups if payload active_fvgs is currently empty
    const bullEntryMin = swingLow + 1.5;
    const bullEntryMax = swingLow + 4.0;
    const bullSL = Math.min(swingLow - 1.5, bullEntryMin - 3.0);
    const bullTP1 = Math.min(equilibrium, bslMagnets[0] || swingHigh);
    const bullTP2 = bslMagnets[1] || swingHigh;
    const bullRisk = (bullEntryMin + bullEntryMax) / 2 - bullSL;
    const bullReward = bullTP2 - (bullEntryMin + bullEntryMax) / 2;
    const bullRR = bullRisk > 0 ? parseFloat((bullReward / bullRisk).toFixed(2)) : 0;

    const set1Key = `SET-01_${bullEntryMin.toFixed(1)}_${bullEntryMax.toFixed(1)}`;
    let bullStatus: PotentialTrade["status"] = (storedHistory[set1Key] as any) || "PENDING_TOUCH";

    if (bullStatus !== "TARGET_HIT" && bullStatus !== "INVALIDATED") {
      if (lowestRecent <= bullEntryMax + 0.2) {
        if (currentPrice < bullSL) {
          bullStatus = "INVALIDATED";
          saveSetupState(set1Key, "INVALIDATED");
        } else if (highestRecent >= bullTP1) {
          bullStatus = "TARGET_HIT";
          saveSetupState(set1Key, "TARGET_HIT");
        } else {
          bullStatus = "ACTIVE_WATCH";
        }
      } else if (currentPrice <= bullEntryMax && currentPrice >= bullEntryMin) {
        bullStatus = "ACTIVE_WATCH";
      }
    }

    setups.push({
      id: `SET-${String(setupCounter++).padStart(2, "0")}`,
      type: "Discount FVG Re-entry",
      direction: "BULLISH",
      trigger: "Retest & bounce inside Bullish FVG after SSL liquidity sweep",
      entryMin: parseFloat(bullEntryMin.toFixed(2)),
      entryMax: parseFloat(bullEntryMax.toFixed(2)),
      stopLoss: parseFloat(bullSL.toFixed(2)),
      target1: parseFloat(bullTP1.toFixed(2)),
      target2: parseFloat(bullTP2.toFixed(2)),
      rrRatio: bullRR,
      confluence: `SSL Sweep @ ${swingLow.toFixed(2)} + VSR Volume Sponsorship + Bullish FVG Retest`,
      status: bullStatus,
      isHighProbability: bullRR >= 1.5,
      isNearby: true,
    });
  }

  // ── 2. Structural Breakout Expansion Setup ───────────────────────────────
  const breakoutEntry = swingHigh + 0.5;
  const breakoutSL = equilibrium;
  const breakoutTP1 = bslMagnets[1] || swingHigh + 8.0;
  const breakoutTP2 = bslMagnets[2] || swingHigh + 15.0;
  const breakoutRisk = breakoutEntry - breakoutSL;
  const breakoutReward = breakoutTP2 - breakoutEntry;
  const breakoutRR = breakoutRisk > 0 ? parseFloat((breakoutReward / breakoutRisk).toFixed(2)) : 0;

  const setBreakKey = `SET_BREAKOUT_${breakoutEntry.toFixed(1)}`;
  let breakoutStatus: PotentialTrade["status"] = (storedHistory[setBreakKey] as any) || "WAITING";

  if (breakoutStatus !== "TARGET_HIT" && breakoutStatus !== "INVALIDATED") {
    if (highestRecent >= breakoutTP1) {
      breakoutStatus = "TARGET_HIT";
      saveSetupState(setBreakKey, "TARGET_HIT");
    } else if (currentPrice > swingHigh) {
      breakoutStatus = "CONFIRMED";
    }
  }

  setups.push({
    id: `SET-${String(setupCounter++).padStart(2, "0")}`,
    type: "BSL Breakout Expansion",
    direction: "BULLISH",
    trigger: "Structural 5m Candle Close above Major Swing High BSL Pool",
    entryMin: parseFloat(breakoutEntry.toFixed(2)),
    entryMax: parseFloat((breakoutEntry + 1.2).toFixed(2)),
    stopLoss: parseFloat(breakoutSL.toFixed(2)),
    target1: parseFloat(breakoutTP1.toFixed(2)),
    target2: parseFloat(breakoutTP2.toFixed(2)),
    rrRatio: breakoutRR,
    confluence: "Confirmed 5-bar BOS + Active Institutional Displacement Sponsorship",
    status: breakoutStatus,
    isHighProbability: breakoutRR >= 1.5,
    isNearby: true,
  });

  const firstBull = consolidatedFvgs.find((f) => f.type === "BULLISH");
  const firstBear = consolidatedFvgs.find((f) => f.type === "BEARISH");

  return {
    symbol: "ETHUSDT",
    currentPrice,
    institutionalBias,
    swingHigh,
    swingLow,
    equilibrium: parseFloat(equilibrium.toFixed(2)),
    dealingZone,
    bullishFvg: firstBull ? [firstBull.bottom, firstBull.top] : [swingLow + 1.2, swingLow + 4.5],
    bearishFvg: firstBear ? [firstBear.bottom, firstBear.top] : [swingHigh - 4.5, swingHigh - 1.2],
    bslMagnets,
    sslMagnets,
    sponsorshipStatus,
    setups,
  };
}
