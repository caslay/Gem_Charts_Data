import { useEffect, useRef, useState, useCallback } from 'react';

// Define the alert structure for the frontend UI
export interface SmartAlert {
  id: string;
  type:
    | 'PURGE'
    | 'DEAD_ZONE'
    | 'RISK_OVERRIDE'
    | 'SMT_TRAP'
    | 'PRICING_SHIFT'
    | 'OBJECTIVE_UPDATE'
    | 'FLOW_STATE'
    | 'SESSION_TRANSITION'
    | 'STRATEGY_MATCHED'
    | 'LIVE_OB_DETECTED'
    | 'IN_ZONE_CONFIRMATION_PENDING'
    | 'AUTO_ORDER_ROUTED'
    | 'STAGE_FILL';
  message: string;
  timestamp: number;
  sourceTag?: 'AUTONOMOUS_OB' | 'STRATEGY_ARCHITECT' | 'MARKET_STRUCTURE' | 'RISK_MANAGEMENT' | string;
}

export interface SignalAlertsEnabled {
  FVG_DETECTION: boolean;
  DISPLACEMENT_CONFIRMED: boolean;
  SMT_TRAP_ACTIVE: boolean;
  DOL_EXHAUSTED: boolean;
  SESSION_TRANSITION: boolean;
  PRICING_SHIFT: boolean;
  SWEEP_ALERT: boolean;
  FLOW_STATE_CHANGE: boolean;
  DEAD_ZONE_ENTER: boolean;
  STRATEGY_MATCHED?: boolean;
  LIVE_OB_DETECTED?: boolean;
  IN_ZONE_CONFIRMATION_PENDING?: boolean;
  AUTO_ORDER_ROUTED?: boolean;
  STAGE_FILL?: boolean;
}

export interface SignalAlerts {
  FVG_DETECTION: string;
  DISPLACEMENT_CONFIRMED: string;
  SMT_TRAP_ACTIVE: string;
  DOL_EXHAUSTED: string;
  SESSION_TRANSITION: string;
  PRICING_SHIFT: string;
  SWEEP_ALERT: string;
  FLOW_STATE_CHANGE: string;
  DEAD_ZONE_ENTER: string;
  STRATEGY_MATCHED?: string;
  LIVE_OB_DETECTED?: string;
  IN_ZONE_CONFIRMATION_PENDING?: string;
  AUTO_ORDER_ROUTED?: string;
  STAGE_FILL?: string;
}

const ALERT_TYPE_TO_SIGNAL_KEY: Record<SmartAlert['type'], keyof SignalAlertsEnabled> = {
  PURGE: 'SWEEP_ALERT',
  DEAD_ZONE: 'DEAD_ZONE_ENTER',
  RISK_OVERRIDE: 'FVG_DETECTION',
  SMT_TRAP: 'SMT_TRAP_ACTIVE',
  PRICING_SHIFT: 'PRICING_SHIFT',
  OBJECTIVE_UPDATE: 'DOL_EXHAUSTED',
  FLOW_STATE: 'FLOW_STATE_CHANGE',
  SESSION_TRANSITION: 'SESSION_TRANSITION',
  STRATEGY_MATCHED: 'STRATEGY_MATCHED',
  LIVE_OB_DETECTED: 'LIVE_OB_DETECTED',
  IN_ZONE_CONFIRMATION_PENDING: 'IN_ZONE_CONFIRMATION_PENDING',
  AUTO_ORDER_ROUTED: 'AUTO_ORDER_ROUTED',
  STAGE_FILL: 'STAGE_FILL',
};

export function useLiveAlerts(
  data: any,
  refetch?: () => Promise<void>,
  signalAlertsEnabled?: SignalAlertsEnabled,
  signalAlerts?: SignalAlerts,
  mtfSummary?: any
) {
  const [activeAlerts, setActiveAlerts] = useState<SmartAlert[]>([]);
  const prevDataRef = useRef<any>(null);
  const cooldownsRef = useRef<Record<string, number>>({});
  const refetchRef = useRef(refetch);
  const signalAlertsEnabledRef = useRef(signalAlertsEnabled);
  const signalAlertsRef = useRef(signalAlerts);

  // Transition Tracking Refs (V8.2 Protocol)
  const prevPricingRef = useRef<string | null>(null);
  const prevTargetStatusRef = useRef<string | null>(null);
  const prevSponsorshipRef = useRef<string | null>(null);
  const prevTimeWindowRef = useRef<string | null>(null);
  const prevMtfBreaksRef = useRef<Record<string, string>>({});
  const prevMtfOlsRef = useRef<Record<string, string>>({});

  // Keep refs updated for effects/callbacks
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useEffect(() => {
    signalAlertsEnabledRef.current = signalAlertsEnabled;
    signalAlertsRef.current = signalAlerts;
  }, [signalAlertsEnabled, signalAlerts]);

  const messageCooldownsRef = useRef<Map<string, number>>(new Map());
  const lastDesktopNotificationTimeRef = useRef<number>(0);
  const lastAudioPlayTimeRef = useRef<number>(0);

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

  const triggerAlert = useCallback((
    type: SmartAlert['type'],
    message: string,
    soundPath?: string,
    sourceTag?: SmartAlert['sourceTag']
  ) => {
    // 🛑 AUDIT GATE: Check if alert type is enabled in user settings
    const signalKey = ALERT_TYPE_TO_SIGNAL_KEY[type];
    const enabledMap = signalAlertsEnabledRef.current;
    if (enabledMap && signalKey && enabledMap[signalKey] === false) {
      console.log(`[useLiveAlerts] Alert suppressed because '${signalKey}' is disabled in settings.`);
      return;
    }

    // 🛑 ANTI-SPAM DEDUPLICATION: Suppress identical alert messages within 15 seconds
    const now = Date.now();
    const lastMessageTime = messageCooldownsRef.current.get(message) || 0;
    if (now - lastMessageTime < 15000) {
      return;
    }
    messageCooldownsRef.current.set(message, now);

    // Garbage-collect message cooldowns map periodically
    if (messageCooldownsRef.current.size > 200) {
      for (const [k, v] of messageCooldownsRef.current.entries()) {
        if (now - v > 60000) messageCooldownsRef.current.delete(k);
      }
    }

    // Default source tagging based on event taxonomy if not provided
    const resolvedSourceTag = sourceTag || (
      type === 'STRATEGY_MATCHED' ? 'STRATEGY_ARCHITECT' :
      (type === 'LIVE_OB_DETECTED' || type === 'IN_ZONE_CONFIRMATION_PENDING' || type === 'AUTO_ORDER_ROUTED' || type === 'STAGE_FILL') ? 'AUTONOMOUS_OB' :
      type === 'RISK_OVERRIDE' ? 'RISK_MANAGEMENT' :
      'MARKET_STRUCTURE'
    );

    setActiveAlerts((prev) => {
      const newAlert: SmartAlert = {
        id: `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        type,
        message,
        timestamp: Date.now(),
        sourceTag: resolvedSourceTag,
      };
      // Keep only the most recent 10 alerts
      return [newAlert, ...prev].slice(0, 10);
    });

    if (typeof window !== 'undefined') {
      // 🛑 DESKTOP NOTIFICATION GATE: Only send OS banners for high-priority executions
      const isHighPriorityExecution = type === 'AUTO_ORDER_ROUTED' || type === 'STAGE_FILL' || type === 'STRATEGY_MATCHED' || type === 'OBJECTIVE_UPDATE';
      if ('Notification' in window && Notification.permission === 'granted' && isHighPriorityExecution) {
        if (now - lastDesktopNotificationTimeRef.current >= 4000) {
          lastDesktopNotificationTimeRef.current = now;
          new Notification("Flow-State Alert", { body: message });
        }
      }
      
      // Resolve custom sound file from signalAlerts map if available
      const mappedSoundFile = signalAlertsRef.current && signalKey ? signalAlertsRef.current[signalKey] : null;
      const finalSoundPath = mappedSoundFile ? `/audio/${mappedSoundFile}` : soundPath;

      if (finalSoundPath) {
        // Audio Chime Throttle: Minimum 600ms gap between chimes to prevent audio screech bursts
        if (now - lastAudioPlayTimeRef.current >= 600) {
          lastAudioPlayTimeRef.current = now;
          const audio = new Audio(finalSoundPath);
          audio.play().catch(e => {
            if (e.name === 'NotAllowedError') {
              console.log('[Audio] Playback blocked by browser autoplay policy until user interacts.');
            } else {
              console.error('Audio play error:', e);
            }
          });
        }
      }
    }
  }, []);

  // Main Effect: Evaluate Alert Protocols
  useEffect(() => {
    if (!data) return;

    const oldData = prevDataRef.current;
    const newData = data;

    // --- V8.2 STATE-TRANSITION PROTOCOLS ---
    const ipda = newData.ipda_metrics || {};

    // 1. Pricing Context Alert
    const currentPricing = ipda.current_pricing;
    if (currentPricing && prevPricingRef.current && currentPricing !== prevPricingRef.current) {
      triggerAlert(
        'PRICING_SHIFT',
        `⚖️ PRICING SHIFT: Market moved to ${currentPricing}`,
        "/audio/pricing_shift.wav"
      );
    }
    if (currentPricing) prevPricingRef.current = currentPricing;

    // 2. Target Status Alert
    const targetStatus = ipda.target_status;
    if (targetStatus && prevTargetStatusRef.current && targetStatus !== prevTargetStatusRef.current) {
      triggerAlert(
        'OBJECTIVE_UPDATE',
        `🎯 OBJECTIVE UPDATE: Primary Target is now ${targetStatus}`,
        "/audio/objective_update.wav"
      );
    }
    if (targetStatus) prevTargetStatusRef.current = targetStatus;

    // 3. Institutional Sponsorship Alert
    const sponsorshipStatus = ipda.institutional_sponsorship?.status;
    if (sponsorshipStatus && prevSponsorshipRef.current && sponsorshipStatus !== prevSponsorshipRef.current) {
      triggerAlert(
        'FLOW_STATE',
        `🌊 FLOW STATE: Institutional Sponsorship is now ${sponsorshipStatus}`,
        "/audio/flow_state.wav"
      );
    }
    if (sponsorshipStatus) prevSponsorshipRef.current = sponsorshipStatus;

    // 4. Time Window Alert
    const timeWindow = ipda.current_time_window;
    if (timeWindow && prevTimeWindowRef.current && timeWindow !== prevTimeWindowRef.current) {
      triggerAlert(
        'SESSION_TRANSITION',
        `🕒 SESSION TRANSITION: Entering ${timeWindow}`,
        "/audio/session_transition.wav"
      );
    }
    if (timeWindow) prevTimeWindowRef.current = timeWindow;

    // 5. Multi-Timeframe Background Alerts (Cross-Timeframe Monitoring)
    if (mtfSummary && mtfSummary.timeframes) {
      ['5m', '15m', '1h'].forEach((tfKey) => {
        const tfData = mtfSummary.timeframes[tfKey];
        if (!tfData) return;

        // Background MSS alert
        if (tfData.structure_break === 'MSS' && prevMtfBreaksRef.current[tfKey] !== 'MSS') {
          if (checkCooldown(`MTF_MSS_${tfKey}`, 5 * 60 * 1000)) {
            triggerAlert(
              'FLOW_STATE',
              `⚡ [${tfKey.toUpperCase()} MSS DETECTED] Market Structure Shift forming on ${tfKey.toUpperCase()}!`,
              "/audio/flow_state.wav"
            );
          }
        }
        prevMtfBreaksRef.current[tfKey] = tfData.structure_break;

        // Background OLS 95% Elite confirmation alert
        if (tfData.ols_tier === 'CONFIRMED_95' && prevMtfOlsRef.current[tfKey] !== 'CONFIRMED_95') {
          if (checkCooldown(`MTF_OLS_${tfKey}`, 10 * 60 * 1000)) {
            triggerAlert(
              'FLOW_STATE',
              `🟢 [${tfKey.toUpperCase()} OLS CONFIRMED] Institutional Sponsorship confirmed at 95% on ${tfKey.toUpperCase()}!`,
              "/audio/flow_state.wav"
            );
          }
        }
        prevMtfOlsRef.current[tfKey] = tfData.ols_tier;
      });
    }

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
          "🔕 Market entering DEAD_ZONE. All structural alerts muted to prevent FOMO.",
          "/audio/dead_zone.mp3"
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
    const dealingRangeStatus = (pricingContext?.local_dealing_range?.current_status ||
      pricingContext?.pricing_context?.local_dealing_range?.current_status || 'UNKNOWN') as string;

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

    if (hasNewBullishFvg && dealingRangeStatus === 'PREMIUM') {
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
          "📉 SMT Trap Detected: Price rising without Open Interest backing.",
          "/audio/smt_trap.wav"
        );
      }
    }

    prevDataRef.current = newData;

  }, [data, triggerAlert, checkCooldown]);



  const clearAlerts = useCallback(() => setActiveAlerts([]), []);
  const dismissAlert = useCallback((id: string) => {
    setActiveAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { activeAlerts, clearAlerts, dismissAlert, triggerAlert };
}
