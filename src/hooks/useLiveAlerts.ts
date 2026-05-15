import { useEffect, useRef, useState, useCallback } from 'react';

// Define the alert structure for the frontend UI
export interface SmartAlert {
  id: string;
  type: 'PURGE' | 'DEAD_ZONE' | 'RISK_OVERRIDE' | 'SMT_TRAP';
  message: string;
  timestamp: number;
}

export function useLiveAlerts(
  data: any, 
  refetch?: () => Promise<void>
) {
  const [activeAlerts, setActiveAlerts] = useState<SmartAlert[]>([]);
  const prevDataRef = useRef<any>(null);
  const cooldownsRef = useRef<Record<string, number>>({});
  const refetchRef = useRef(refetch);

  // Keep refetch ref updated
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  // Request Notification permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    }
  }, []);

  const checkCooldown = useCallback((alertType: string, cooldownMs: number) => {
    const now = Date.now();
    const lastFired = cooldownsRef.current[alertType] || 0;
    if (now - lastFired >= cooldownMs) {
      cooldownsRef.current[alertType] = now;
      return true;
    }
    return false;
  }, []);

  const triggerAlert = useCallback((type: SmartAlert['type'], message: string, soundPath?: string) => {
    setActiveAlerts((prev) => {
      const newAlert: SmartAlert = {
        id: `${type}-${Date.now()}`,
        type,
        message,
        timestamp: Date.now(),
      };
      // Keep only the most recent 10 alerts
      return [newAlert, ...prev].slice(0, 10);
    });

    if (typeof window !== 'undefined') {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification("Flow-State Alert", { body: message });
      }
      if (soundPath) {
        const audio = new Audio(soundPath);
        audio.play().catch(e => console.error('Audio play error:', e));
      }
    }
  }, []);

  // Main Effect: Evaluate Alert Protocols
  useEffect(() => {
    if (!data) return;

    const oldData = prevDataRef.current;
    const newData = data;

    // --- 2. The DEAD_ZONE Mute ---
    // Check if we are in the NY Lunch/Mid-day pause (12:00 PM - 1:30 PM NY Time)
    const nyTimeStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    const nyDate = new Date(nyTimeStr);
    const hours = nyDate.getHours();
    const mins = nyDate.getMinutes();
    
    const isDeadZone = hours === 12 || (hours === 13 && mins <= 30);

    if (isDeadZone) {
      if (checkCooldown('DEAD_ZONE', 90 * 60 * 1000)) { // 90-minute cooldown
        triggerAlert(
          'DEAD_ZONE', 
          "🔕 Market entering DEAD_ZONE. All structural alerts muted to prevent FOMO."
        );
      }
      prevDataRef.current = newData;
      return; // 🛑 SUPPRESS ALL OTHER ALERTS
    }

    // Safely extract V8/V7 data fields
    const currentPrice = newData.current_price || newData.price || 0;
    const orderFlow = newData.order_flow_engine || {};
    const liquidity = orderFlow.resting_liquidity_pools || {};
    const bslMagnets: number[] = liquidity.BSL_Magnets || [];
    const sslMagnets: number[] = liquidity.SSL_Magnets || [];
    const liquidations = orderFlow.liquidation_events || {};
    const lastHourPurged = liquidations.last_hour_purged || 0;
    
    const smartMoney = orderFlow.smart_money_sentiment || {};
    const isSmtDivergence = smartMoney.smart_money_divergence === true;

    const pricingContext = newData.pricing_context || newData.ipda_metrics || {};
    const trueDayOpen = pricingContext.true_day_open_0700 || 0;

    const newFvgs = newData.active_arrays?.fvgs || [];
    const oldFvgs = oldData?.active_arrays?.fvgs || [];

    // --- 1. Liquidity Purge & Exhaustion Alert ---
    const priceMargin = currentPrice > 0 ? currentPrice * 0.001 : 0; // 0.1% threshold
    const hitBsl = bslMagnets.some((p: number) => Math.abs(currentPrice - p) <= priceMargin);
    const hitSsl = sslMagnets.some((p: number) => Math.abs(currentPrice - p) <= priceMargin);
    const massivePurge = lastHourPurged > 0; // Trigger on any registered volume purge

    if ((hitBsl || hitSsl) && massivePurge) {
      if (checkCooldown('PURGE', 10 * 60 * 1000)) { // 10m cooldown
        triggerAlert(
          'PURGE', 
          "🚨 TARGET EXHAUSTED: Liquidity Purged - Await Smart Money Reversal",
          "/audio/sweep_alert.mp3"
        );
      }
    }

    // --- 3. Dual-Pricing & Risk Override Alert ---
    // Detect new Bullish FVG
    const hasNewBullishFvg = newFvgs.length > oldFvgs.length && newFvgs.some((fvg: any) => 
      (fvg.type === 'BULLISH' || fvg.type === 'BUY') && 
      !oldFvgs.some((oldFvg: any) => oldFvg.price === fvg.price || oldFvg.id === fvg.id)
    );

    if (hasNewBullishFvg && trueDayOpen > 0 && currentPrice > trueDayOpen) {
      if (checkCooldown('RISK_OVERRIDE', 5 * 60 * 1000)) { // 5m cooldown
        triggerAlert(
          'RISK_OVERRIDE', 
          "⚠️ Valid FVG formed, but Macro Bias is Premium. Half-Risk Continuation Mode Recommended.",
          "/audio/fvg_alert.mp3"
        );
      }
    }

    // --- 4. Smart Money Divergence Alert (SMT Trap) ---
    // Detect local higher high (inferred from price jump or explicit flag)
    const localHigherHigh = newData.market_structure?.local_higher_high || (oldData && currentPrice > (oldData.current_price || oldData.price || 0));
    
    if (localHigherHigh && isSmtDivergence) {
      if (checkCooldown('SMT_TRAP', 5 * 60 * 1000)) { // 5m cooldown
        triggerAlert(
          'SMT_TRAP', 
          "📉 SMT Trap Detected: Price rising without Open Interest backing."
        );
      }
    }

    prevDataRef.current = newData;

  }, [data, triggerAlert, checkCooldown]);

  // --- Time-Synced Polling Trigger (Legacy System Support) ---
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let intervalId: NodeJS.Timeout;

    const scheduleNextFetch = () => {
      if (!refetchRef.current) return;
      
      const now = Date.now();
      const msIn5Mins = 5 * 60 * 1000;
      
      // Calculate exact milliseconds remaining until the next 5-minute boundary
      const msUntilNextBoundary = msIn5Mins - (now % msIn5Mins);
      const delay = msUntilNextBoundary + 2000; // 2000ms buffer

      timeoutId = setTimeout(() => {
        if (refetchRef.current) {
          refetchRef.current();
        }

        // Start interval exactly every 5 minutes after the first synced execution
        intervalId = setInterval(() => {
          if (refetchRef.current) {
            refetchRef.current();
          }
        }, msIn5Mins);

      }, delay);
    };

    scheduleNextFetch();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const clearAlerts = useCallback(() => setActiveAlerts([]), []);
  const dismissAlert = useCallback((id: string) => {
    setActiveAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { activeAlerts, clearAlerts, dismissAlert };
}
