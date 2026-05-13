import { useEffect, useRef } from 'react';
import type { MarketDataPayload } from './useMarketData';

export function useLiveAlerts(
  data: MarketDataPayload | null,
  refetch: () => Promise<void>
) {
  // Store previous data to compare against
  const prevDataRef = useRef<{
    ipda_metrics: any;
    active_arrays: any;
  } | null>(null);

  const refetchRef = useRef(refetch);
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

  // Update prevDataRef whenever we get new data and do the comparison
  useEffect(() => {
    if (!data) return;

    if (prevDataRef.current) {
      const oldData = prevDataRef.current;
      const newData = data;

      // Helper to play sound and show notification
      const triggerAlert = (title: string, body: string, soundPath: string) => {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { body });
        }
        const audio = new Audio(soundPath);
        audio.play().catch(e => console.error('Audio play error:', e));
      };

      // a) FVG Alert
      const oldFvgs = oldData.active_arrays?.fvgs || [];
      const newFvgs = newData.active_arrays?.fvgs || [];
      if (newFvgs.length > oldFvgs.length) {
        triggerAlert(
          "⚠️ New FVG Formed",
          "A new Fair Value Gap has been engineered.",
          "/audio/fvg_alert.mp3"
        );
      }

      // b) Displacement Alert
      const oldDisp = oldData.ipda_metrics?.institutional_sponsorship?.displacement_active;
      const newDisp = newData.ipda_metrics?.institutional_sponsorship?.displacement_active;
      if (oldDisp === false && newDisp === true) {
        triggerAlert(
          "🚀 Displacement Detected!",
          "Institutional sponsorship confirmed.",
          "/audio/fvg_alert.mp3"
        );
      }

      // c) Sweep Alert
      const oldSweep = oldData.ipda_metrics?.target_status;
      const newSweep = newData.ipda_metrics?.target_status;
      if (oldSweep === 'PENDING' && newSweep === 'EXHAUSTED') {
        triggerAlert(
          "🩸 Target Purged!",
          "Liquidity has been swept.",
          "/audio/sweep_alert.mp3"
        );
      }
    }

    // Replace the old data in the useRef AFTER the comparison
    prevDataRef.current = {
      ipda_metrics: data.ipda_metrics,
      active_arrays: data.active_arrays,
    };
  }, [data]);

  // Time-Synced Polling Trigger
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let intervalId: NodeJS.Timeout;

    const scheduleNextFetch = () => {
      const now = Date.now();
      const msIn5Mins = 5 * 60 * 1000;
      
      // Calculate exact milliseconds remaining until the next 5-minute boundary
      const msUntilNextBoundary = msIn5Mins - (now % msIn5Mins);
      
      // Wait for exactly that duration PLUS a 2000ms buffer
      const delay = msUntilNextBoundary + 2000;

      timeoutId = setTimeout(() => {
        console.log('Clock: 5m Candle Closed! Fetching new data...');
        if (refetchRef.current) {
          refetchRef.current();
        }

        // Start interval exactly every 5 minutes after the first synced execution
        intervalId = setInterval(() => {
          console.log('Clock: 5m Candle Closed! Fetching new data...');
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
}
