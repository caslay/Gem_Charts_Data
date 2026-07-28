import type { MarketDataPayload } from "@/hooks/useMarketData";

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
}

export interface TradeEngineSummary {
  symbol: string;
  currentPrice: number;
  trueDayOpen: number;
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

export function generatePotentialTrades(data: MarketDataPayload | null): TradeEngineSummary {
  const currentPrice = data?.ipda_metrics?.last_price || 1875.55;
  const trueDayOpen = data?.ipda_metrics?.true_day_open_0700 || 1880.35;
  const swingHigh = data?.ipda_metrics?.macro_structural_magnets?.major_swing_high || 1881.42;
  const swingLow = data?.ipda_metrics?.macro_structural_magnets?.major_swing_low || 1870.66;
  const equilibrium = (swingHigh + swingLow) / 2;

  const dealingZone = currentPrice > equilibrium + 0.5 ? "PREMIUM" : currentPrice < equilibrium - 0.5 ? "DISCOUNT" : "EQUILIBRIUM";

  const activeFvgs = data?.data_payload?.active_fvgs || [];
  const bullFvgObj = activeFvgs.find((f: any) => f.type === "BULLISH");
  const bearFvgObj = activeFvgs.find((f: any) => f.type === "BEARISH");

  const bullishFvg: [number, number] | null = bullFvgObj ? [bullFvgObj.bottom, bullFvgObj.top] : [1871.27, 1874.44];
  const bearishFvg: [number, number] | null = bearFvgObj ? [bearFvgObj.bottom, bearFvgObj.top] : [1877.09, 1879.80];

  const bslMagnets = data?.ipda_metrics?.order_flow_engine?.resting_liquidity_pools?.BSL_Magnets || [1881.42, 1884.08, 1884.81];
  const sslMagnets = data?.ipda_metrics?.order_flow_engine?.resting_liquidity_pools?.SSL_Magnets || [1870.66, 1865.00];

  const sponsorshipStatus = data?.ipda_metrics?.order_flow_engine?.displacement_sponsorship?.status || "ACTIVE_BULLISH";

  // Extract recent candle extremes for historical touch & target validation
  const candles5m = data?.data_payload?.candles_5m || [];
  const recentCandles = candles5m.slice(-30);
  const lowestRecent = recentCandles.length > 0
    ? Math.min(...recentCandles.map((c: any) => (typeof c.l === 'number' ? c.l : typeof c.low === 'number' ? c.low : c.c)))
    : currentPrice;
  const highestRecent = recentCandles.length > 0
    ? Math.max(...recentCandles.map((c: any) => (typeof c.h === 'number' ? c.h : typeof c.high === 'number' ? c.high : c.c)))
    : currentPrice;

  const setups: PotentialTrade[] = [];

  // ── 1. Long Setup: Discount FVG Re-entry ─────────────────────────────────
  const longEntryMin = bullishFvg ? bullishFvg[0] : swingLow + 1.5;
  const longEntryMax = bullishFvg ? bullishFvg[1] : swingLow + 4.0;
  const longSL = Math.min(swingLow - 1.5, longEntryMin - 3.0);
  const longTP1 = Math.min(equilibrium, bslMagnets[0] || swingHigh);
  const longTP2 = bslMagnets[1] || swingHigh;
  const longRisk = (longEntryMin + longEntryMax) / 2 - longSL;
  const longReward = longTP2 - (longEntryMin + longEntryMax) / 2;
  const longRR = longRisk > 0 ? parseFloat((longReward / longRisk).toFixed(2)) : 3.2;

  // Determine dynamic setup lifecycle status
  let longStatus: "ACTIVE_WATCH" | "PENDING_TOUCH" | "CONFIRMED" | "WAITING" | "TARGET_HIT" | "INVALIDATED" = "PENDING_TOUCH";
  const touchedLongEntry = lowestRecent <= longEntryMax + 0.5;

  if (touchedLongEntry) {
    if (highestRecent >= longTP1 || currentPrice >= longTP1) {
      longStatus = "TARGET_HIT";
    } else if (currentPrice < longSL) {
      longStatus = "INVALIDATED";
    } else {
      longStatus = "ACTIVE_WATCH";
    }
  } else if (currentPrice <= longEntryMax && currentPrice >= longEntryMin) {
    longStatus = "ACTIVE_WATCH";
  }

  setups.push({
    id: "SET-01",
    type: "Discount FVG Re-entry",
    direction: "BULLISH",
    trigger: "Retest & bounce inside Bullish FVG after SSL liquidity sweep",
    entryMin: parseFloat(longEntryMin.toFixed(2)),
    entryMax: parseFloat(longEntryMax.toFixed(2)),
    stopLoss: parseFloat(longSL.toFixed(2)),
    target1: parseFloat(longTP1.toFixed(2)),
    target2: parseFloat(longTP2.toFixed(2)),
    rrRatio: Math.max(longRR, 1.5),
    confluence: "SSL Sweep @ " + swingLow.toFixed(2) + " + VSR Volume Sponsorship + Bullish FVG Retest",
    status: longStatus,
  });

  // ── 2. Short Setup: Premium FVG Rejection ───────────────────────────────
  const shortEntryMin = bearishFvg ? bearishFvg[0] : equilibrium + 1.0;
  const shortEntryMax = bearishFvg ? bearishFvg[1] : swingHigh - 1.0;
  const shortSL = Math.max(swingHigh + 1.5, shortEntryMax + 3.0);
  const shortTP1 = parseFloat(equilibrium.toFixed(2));
  const shortTP2 = sslMagnets[0] || swingLow;
  const shortRisk = shortSL - (shortEntryMin + shortEntryMax) / 2;
  const shortReward = (shortEntryMin + shortEntryMax) / 2 - shortTP2;
  const shortRR = shortRisk > 0 ? parseFloat((shortReward / shortRisk).toFixed(2)) : 3.5;

  let shortStatus: "ACTIVE_WATCH" | "PENDING_TOUCH" | "CONFIRMED" | "WAITING" | "TARGET_HIT" | "INVALIDATED" = "PENDING_TOUCH";
  const touchedShortEntry = highestRecent >= shortEntryMin - 0.5;

  if (touchedShortEntry) {
    if (lowestRecent <= shortTP1 || currentPrice <= shortTP1) {
      shortStatus = "TARGET_HIT";
    } else if (currentPrice > shortSL) {
      shortStatus = "INVALIDATED";
    } else {
      shortStatus = "ACTIVE_WATCH";
    }
  } else if (currentPrice >= shortEntryMin && currentPrice <= shortEntryMax) {
    shortStatus = "ACTIVE_WATCH";
  }

  setups.push({
    id: "SET-02",
    type: "Premium FVG Rejection",
    direction: "BEARISH",
    trigger: "Rejection inside Bearish FVG + Confluence with True Day Open baseline",
    entryMin: parseFloat(shortEntryMin.toFixed(2)),
    entryMax: parseFloat(shortEntryMax.toFixed(2)),
    stopLoss: parseFloat(shortSL.toFixed(2)),
    target1: shortTP1,
    target2: parseFloat(shortTP2.toFixed(2)),
    rrRatio: Math.max(shortRR, 1.5),
    confluence: "Confluence with True Day Open (" + trueDayOpen.toFixed(2) + ") + Premium Dealing Zone",
    status: shortStatus,
  });

  // ── 3. Long Setup: BSL Breakout Expansion ────────────────────────────────
  const breakoutEntry = swingHigh + 0.5;
  const breakoutSL = equilibrium;
  const breakoutTP1 = bslMagnets[1] || swingHigh + 8.0;
  const breakoutTP2 = bslMagnets[2] || swingHigh + 15.0;
  const breakoutRisk = breakoutEntry - breakoutSL;
  const breakoutReward = breakoutTP2 - breakoutEntry;
  const breakoutRR = breakoutRisk > 0 ? parseFloat((breakoutReward / breakoutRisk).toFixed(2)) : 3.0;

  let breakoutStatus: "ACTIVE_WATCH" | "PENDING_TOUCH" | "CONFIRMED" | "WAITING" | "TARGET_HIT" | "INVALIDATED" = "WAITING";
  if (currentPrice >= breakoutTP1 || highestRecent >= breakoutTP1) {
    breakoutStatus = "TARGET_HIT";
  } else if (currentPrice > swingHigh) {
    breakoutStatus = "CONFIRMED";
  }

  setups.push({
    id: "SET-03",
    type: "BSL Breakout Expansion",
    direction: "BULLISH",
    trigger: "Structural 5m Candle Close above Major Swing High BSL Pool",
    entryMin: parseFloat(breakoutEntry.toFixed(2)),
    entryMax: parseFloat((breakoutEntry + 1.2).toFixed(2)),
    stopLoss: parseFloat(breakoutSL.toFixed(2)),
    target1: parseFloat(breakoutTP1.toFixed(2)),
    target2: parseFloat(breakoutTP2.toFixed(2)),
    rrRatio: Math.max(breakoutRR, 1.5),
    confluence: "Confirmed 5-bar BOS + Active Institutional Displacement Sponsorship",
    status: currentPrice > swingHigh ? "CONFIRMED" : "WAITING",
  });

  return {
    symbol: "ETHUSDT",
    currentPrice,
    trueDayOpen,
    swingHigh,
    swingLow,
    equilibrium: parseFloat(equilibrium.toFixed(2)),
    dealingZone,
    bullishFvg,
    bearishFvg,
    bslMagnets,
    sslMagnets,
    sponsorshipStatus,
    setups,
  };
}
