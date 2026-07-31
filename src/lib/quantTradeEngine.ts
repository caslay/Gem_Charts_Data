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
  // Trade timeline — populated when a setup transitions through ACTIVE_WATCH → TARGET_HIT/INVALIDATED
  openPrice?: number;
  openTime?: string;   // ISO 8601
  closePrice?: number;
  closeTime?: string;  // ISO 8601
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

  // BUG-2 FIX: last_price is a ghost field — it does not exist on ipda_metrics.
  // Price is always sourced from the most recent candle close as the ground truth.
  const currentPrice = (recentCandles.length > 0 ? recentCandles[recentCandles.length - 1].c : null)
    ?? (data?.ipda_metrics?.current_price as number | undefined)
    ?? 1875.55;

  // Dynamic swing high & low from live candle stream
  const candleHighs = recentCandles.map((c: any) => (typeof c.h === 'number' ? c.h : typeof c.high === 'number' ? c.high : c.c));
  const candleLows = recentCandles.map((c: any) => (typeof c.l === 'number' ? c.l : typeof c.low === 'number' ? c.low : c.c));

  const dynamicSwingHigh = candleHighs.length > 0 ? Math.max(...candleHighs) : 1888.0;
  const dynamicSwingLow = candleLows.length > 0 ? Math.min(...candleLows) : 1870.0;

  const swingHigh = data?.ipda_metrics?.macro_structural_magnets?.major_swing_high || dynamicSwingHigh;
  const swingLow = data?.ipda_metrics?.macro_structural_magnets?.major_swing_low || dynamicSwingLow;
  const equilibrium = (swingHigh + swingLow) / 2;

  const dealingZone = currentPrice > equilibrium + 0.5 ? "PREMIUM" : currentPrice < equilibrium - 0.5 ? "DISCOUNT" : "EQUILIBRIUM";

  // BUG-1 FIX: FVGs are published at ipda_metrics.active_fvgs, NOT data_payload.active_fvgs.
  // data_payload only contains raw candle arrays (candles_5m, 15m, 1h, 4h).
  // Reading data_payload.active_fvgs silently returned undefined on every call,
  // forcing the inline fallback scanner to run on every invocation.
  let activeFvgs: Array<{ type: string; bottom: number; top: number; timeframe?: string; origin_time?: number }> =
    (data?.ipda_metrics?.active_fvgs as any) || [];

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

  // BUG-6 FIX: In the backtest payload, displacement_sponsorship is a plain string ("ACTIVE"/"INACTIVE"),
  // not an object. Guard both forms.
  const rawSponsor = data?.ipda_metrics?.order_flow_engine?.displacement_sponsorship;
  const sponsorshipStatus = (typeof rawSponsor === 'object' && rawSponsor !== null)
    ? (rawSponsor as { status?: string }).status || 'INACTIVE'
    : (typeof rawSponsor === 'string' ? rawSponsor : 'INACTIVE');

  // BUG-2 FIX: bias_signal is a ghost field. The actual field is macro_daily_bias.
  const institutionalBias = (data?.ipda_metrics?.macro_daily_bias as string | undefined) || "UNRESOLVED";

  // ── Persistent Setup Memory (bypassed during Backtest Replay) ────────────
  // Storage shape: { [setupKey]: SetupRecord }
  // SetupRecord = { status, openPrice?, openTime?, closePrice?, closeTime? }
  // Backward-compat: old entries may be a plain string (status only).
  interface SetupRecord {
    status: string;
    openPrice?: number;
    openTime?: string;
    closePrice?: number;
    closeTime?: string;
  }

  let storedHistory: Record<string, SetupRecord | string> = {};
  if (!isBacktest && typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("gem_quant_setup_history");
      if (raw) storedHistory = JSON.parse(raw);
    } catch {}
  }

  /** Read the status string from a stored entry (handles both old strings and new objects). */
  const readStatus = (entry: SetupRecord | string | undefined): string | undefined => {
    if (!entry) return undefined;
    if (typeof entry === "string") return entry;
    return entry.status;
  };

  /** Read the full record (upgrading plain strings to objects on read). */
  const readRecord = (entry: SetupRecord | string | undefined): SetupRecord | undefined => {
    if (!entry) return undefined;
    if (typeof entry === "string") return { status: entry };
    return entry;
  };

  const saveSetupState = (
    setupKey: string,
    status: string,
    extra?: { openPrice?: number; openTime?: string; closePrice?: number; closeTime?: string }
  ) => {
    if (!isBacktest && typeof window !== "undefined") {
      try {
        const existing = readRecord(storedHistory[setupKey]) || {};
        const next: SetupRecord = { ...existing, status, ...extra };
        storedHistory[setupKey] = next;
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
        const risk = entryMid - sl;

        // TP1 RULE: Minimum 1:1 R:R. Anchor to equilibrium or BSL[0] only if it
        // clears the 1:1 floor; otherwise use entryMid + risk (exact 1:1).
        const tp1_natural = Math.min(equilibrium, bslMagnets[0] || swingHigh);
        const tp1_floor   = entryMid + risk;          // exact 1:1
        const tp1 = tp1_natural > tp1_floor ? tp1_natural : tp1_floor;

        // TP2 RULE: Locked structural anchor — BSL magnet[0] (not [1], which drifts more),
        // falling back to swingHigh, then 2× risk. Never changes unless the structural
        // swing high itself changes.
        const tp2_candidate = bslMagnets[0] || swingHigh;
        const tp2 = tp2_candidate > tp1 ? tp2_candidate : entryMid + 2 * risk;

        const reward = tp2 - entryMid;
        const rr = risk > 0 ? parseFloat((reward / risk).toFixed(2)) : 0;
        const isHighProbability = rr >= 1.5 && isNearby;

        const setupKey = `${id}_BULL_${entryMin.toFixed(1)}_${entryMax.toFixed(1)}`;
        const storedRec = readRecord(storedHistory[setupKey]);
        let status: PotentialTrade["status"] = (readStatus(storedHistory[setupKey]) as any) || "PENDING_TOUCH";
        let openPrice  = storedRec?.openPrice;
        let openTime   = storedRec?.openTime;
        let closePrice = storedRec?.closePrice;
        let closeTime  = storedRec?.closeTime;

        if (status !== "TARGET_HIT" && status !== "INVALIDATED") {
          const touched = lowestRecent <= entryMax + 0.2;
          if (touched) {
            // Record open price the first time price enters the zone
            if (!openPrice) {
              openPrice = parseFloat(entryMid.toFixed(2));
              openTime  = new Date().toISOString();
              saveSetupState(setupKey, status, { openPrice, openTime });
            }
            if (currentPrice < sl) {
              status     = "INVALIDATED";
              closePrice = parseFloat(sl.toFixed(2));
              closeTime  = new Date().toISOString();
              saveSetupState(setupKey, "INVALIDATED", { openPrice, openTime, closePrice, closeTime });
            } else if (highestRecent >= tp1) {
              status     = "TARGET_HIT";
              closePrice = parseFloat(tp1.toFixed(2));
              closeTime  = new Date().toISOString();
              saveSetupState(setupKey, "TARGET_HIT", { openPrice, openTime, closePrice, closeTime });
            } else {
              status = "ACTIVE_WATCH";
              saveSetupState(setupKey, "ACTIVE_WATCH", { openPrice, openTime });
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
          openPrice,
          openTime,
          closePrice,
          closeTime,
        });
      } else {
        const sl = Math.max(swingHigh + 1.5, entryMax + 3.0);
        const risk = sl - entryMid;

        // TP1 RULE: Minimum 1:1 R:R. Anchor to equilibrium only if it gives ≥1:1;
        // otherwise use exact 1:1 floor (entryMid - risk).
        const tp1_natural = equilibrium;
        const tp1_floor   = entryMid - risk;          // exact 1:1 short
        const tp1 = tp1_natural < tp1_floor ? tp1_natural : tp1_floor;

        // TP2 RULE: Locked structural anchor — SSL magnet[0] → swingLow → 2× risk.
        // Uses sslMagnets[0] which is the deepest resting pool (PDL), stable across ticks.
        const tp2_candidate = sslMagnets[0] || swingLow;
        const tp2 = tp2_candidate < tp1 ? tp2_candidate : entryMid - 2 * risk;

        const reward = entryMid - tp2;
        const rr = risk > 0 ? parseFloat((reward / risk).toFixed(2)) : 0;
        const isHighProbability = rr >= 1.5 && isNearby;

        const setupKey = `${id}_BEAR_${entryMin.toFixed(1)}_${entryMax.toFixed(1)}`;
        const storedRec = readRecord(storedHistory[setupKey]);
        let status: PotentialTrade["status"] = (readStatus(storedHistory[setupKey]) as any) || "PENDING_TOUCH";
        let openPrice  = storedRec?.openPrice;
        let openTime   = storedRec?.openTime;
        let closePrice = storedRec?.closePrice;
        let closeTime  = storedRec?.closeTime;

        if (status !== "TARGET_HIT" && status !== "INVALIDATED") {
          const touched = highestRecent >= entryMin - 0.2;
          if (touched) {
            if (!openPrice) {
              openPrice = parseFloat(entryMid.toFixed(2));
              openTime  = new Date().toISOString();
              saveSetupState(setupKey, status, { openPrice, openTime });
            }
            if (currentPrice > sl) {
              status     = "INVALIDATED";
              closePrice = parseFloat(sl.toFixed(2));
              closeTime  = new Date().toISOString();
              saveSetupState(setupKey, "INVALIDATED", { openPrice, openTime, closePrice, closeTime });
            } else if (lowestRecent <= tp2) {
              status     = "TARGET_HIT";
              closePrice = parseFloat(tp1.toFixed(2));
              closeTime  = new Date().toISOString();
              saveSetupState(setupKey, "TARGET_HIT", { openPrice, openTime, closePrice, closeTime });
            } else {
              status = "ACTIVE_WATCH";
              saveSetupState(setupKey, "ACTIVE_WATCH", { openPrice, openTime });
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
          openPrice,
          openTime,
          closePrice,
          closeTime,
        });
      }
    });
  } else {
    // Structural Fallback Setups if payload active_fvgs is currently empty
    const bullEntryMin = swingLow + 1.5;
    const bullEntryMax = swingLow + 4.0;
    const bullSL = Math.min(swingLow - 1.5, bullEntryMin - 3.0);
    const bullEntryMid = (bullEntryMin + bullEntryMax) / 2;
    const bullRisk = bullEntryMid - bullSL;

    // TP1: 1:1 floor, step up to equilibrium if it clears the floor
    const bullTP1_natural = Math.min(equilibrium, bslMagnets[0] || swingHigh);
    const bullTP1 = bullTP1_natural > bullEntryMid + bullRisk ? bullTP1_natural : bullEntryMid + bullRisk;

    // TP2: structural BSL anchor → swingHigh → 2× risk. No drift.
    const bullTP2_candidate = bslMagnets[0] || swingHigh;
    const bullTP2 = bullTP2_candidate > bullTP1 ? bullTP2_candidate : bullEntryMid + 2 * bullRisk;

    const bullReward = bullTP2 - bullEntryMid;
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
  const breakoutSL    = equilibrium;
  const breakoutRisk  = breakoutEntry - breakoutSL;

  // TP1: 1:1 floor from entry. Prefer BSL[1] if it clears, else exact 1:1.
  const breakoutTP1_natural = bslMagnets[1] || swingHigh + 8.0;
  const breakoutTP1 = breakoutTP1_natural > breakoutEntry + breakoutRisk
    ? breakoutTP1_natural
    : breakoutEntry + breakoutRisk;

  // TP2: BSL[2] → structural extension 15pt above swing high. Locked.
  const breakoutTP2_candidate = bslMagnets[2] || swingHigh + 15.0;
  const breakoutTP2 = breakoutTP2_candidate > breakoutTP1
    ? breakoutTP2_candidate
    : breakoutTP1 + breakoutRisk;

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
    // BUG-5 FIX: was hardcoded true, bypassing the 2% proximity guard used by all FVG setups.
    isNearby: currentPrice > 0 && Math.abs(breakoutEntry - currentPrice) / currentPrice <= 0.02,
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
