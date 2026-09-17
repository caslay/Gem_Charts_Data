/**
 * temporalGatekeeper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Central Temporal Gatekeeper & Dead Zone Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Unifies all 4 fragmented temporal and dead zone definitions into a single,
 * authoritative gatekeeper:
 *  1. NY Lunch Dead Zone: America/New_York 12:00 PM – 1:30 PM (ICT pause)
 *  2. Funding Rollover Freeze: 23:50 – 00:10 UTC (Binance futures rate resets)
 *  3. Macro News Window: ±20 minutes around major releases (CPI/PPI 12:30 UTC, FOMC 18:00 UTC)
 *  4. Off-Hours Operational Cutoff: Outside active schedule (Africa/Cairo 08:00–22:00)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface DeadZoneOptions {
  enforceNyLunch?: boolean; // default: true
  enforceRolloverFreeze?: boolean; // default: true
  enforceNewsFreeze?: boolean; // default: true
  enforceOffHours?: boolean; // default: false (unless specified)
  activeStartCairo?: string; // default: '08:00'
  activeEndCairo?: string; // default: '22:00'
}

export interface DeadZoneEvaluation {
  isDead: boolean;
  reason: string;
  category: 'NONE' | 'NY_LUNCH' | 'FUNDING_ROLLOVER' | 'MACRO_NEWS' | 'OFF_HOURS';
  nyTimeStr?: string;
  utcTimeStr?: string;
}

/**
 * Evaluates whether a given timestamp falls into any toxic or dead zone window.
 */
export function isDeadZone(
  timestamp: number = Date.now(),
  options?: DeadZoneOptions
): DeadZoneEvaluation {
  const enforceNyLunch = options?.enforceNyLunch !== false;
  const enforceRolloverFreeze = options?.enforceRolloverFreeze !== false;
  const enforceNewsFreeze = options?.enforceNewsFreeze !== false;
  const enforceOffHours = options?.enforceOffHours === true;

  const date = new Date(timestamp);
  const utcHour = date.getUTCHours();
  const utcMin = date.getUTCMinutes();
  const utcTimeStr = `${String(utcHour).padStart(2, '0')}:${String(utcMin).padStart(2, '0')} UTC`;

  // ── 1. NY Lunch Dead Zone (12:00 PM – 1:30 PM America/New_York) ──
  if (enforceNyLunch) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: 'h23',
      });
      const parts = formatter.formatToParts(date);
      const nyHour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '-1', 10);
      const nyMin = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '-1', 10);
      const nyTimeStr = `${String(nyHour).padStart(2, '0')}:${String(nyMin).padStart(2, '0')} EST`;

      if (nyHour === 12 || (nyHour === 13 && nyMin <= 30)) {
        return {
          isDead: true,
          reason: `NY Lunch Dead Zone in effect (12:00 PM – 1:30 PM EST, current: ${nyTimeStr})`,
          category: 'NY_LUNCH',
          nyTimeStr,
          utcTimeStr,
        };
      }
    } catch {
      // Fallback: estimate EDT (UTC-4) -> 16:00 to 17:30 UTC
      if (utcHour === 16 || (utcHour === 17 && utcMin <= 30)) {
        return {
          isDead: true,
          reason: `NY Lunch Dead Zone in effect (~16:00 - 17:30 UTC)`,
          category: 'NY_LUNCH',
          utcTimeStr,
        };
      }
    }
  }

  // ── 2. Daily Funding Rollover Freeze (23:50 – 00:10 UTC) ──
  if (enforceRolloverFreeze) {
    if ((utcHour === 23 && utcMin >= 50) || (utcHour === 0 && utcMin <= 10)) {
      return {
        isDead: true,
        reason: `Daily Funding Rollover Freeze in effect (23:50 – 00:10 UTC, current: ${utcTimeStr})`,
        category: 'FUNDING_ROLLOVER',
        utcTimeStr,
      };
    }
  }

  // ── 3. High-Impact US Macroeconomic Releases (CPI/PPI & FOMC ±20 min) ──
  if (enforceNewsFreeze) {
    // CPI / PPI: 12:30 UTC release -> window: 12:10 - 12:50 UTC
    if (utcHour === 12 && utcMin >= 10 && utcMin <= 50) {
      return {
        isDead: true,
        reason: `Macroeconomic News Freeze in effect (CPI/PPI window: 12:10 – 12:50 UTC)`,
        category: 'MACRO_NEWS',
        utcTimeStr,
      };
    }
    // FOMC Rate Decision: 18:00 UTC release -> window: 17:40 - 18:20 UTC
    if ((utcHour === 17 && utcMin >= 40) || (utcHour === 18 && utcMin <= 20)) {
      return {
        isDead: true,
        reason: `Macroeconomic News Freeze in effect (FOMC window: 17:40 – 18:20 UTC)`,
        category: 'MACRO_NEWS',
        utcTimeStr,
      };
    }
  }

  // ── 4. Off-Hours Operational Cutoff (outside Africa/Cairo 08:00–22:00) ──
  if (enforceOffHours) {
    try {
      const cairoFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Cairo',
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: 'h23',
      });
      const cParts = cairoFormatter.formatToParts(date);
      const cHour = parseInt(cParts.find((p) => p.type === 'hour')?.value ?? '-1', 10);
      const startH = parseInt((options?.activeStartCairo || '08:00').split(':')[0], 10);
      const endH = parseInt((options?.activeEndCairo || '22:00').split(':')[0], 10);

      if (cHour < startH || cHour >= endH) {
        return {
          isDead: true,
          reason: `Off-Hours Schedule in effect (Outside ${startH}:00 – ${endH}:00 Cairo time)`,
          category: 'OFF_HOURS',
          utcTimeStr,
        };
      }
    } catch {
      // ignore
    }
  }

  return {
    isDead: false,
    reason: 'Active session liquidity: trade initiation authorized',
    category: 'NONE',
    utcTimeStr,
  };
}

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Formats a quiet, non-actionable observation heartbeat for dead zone periods.
 */
export function formatDeadZoneObservationHeartbeat(
  reason: string,
  timestamp?: number | string | Date
): string {
  const ts =
    typeof timestamp === 'number' && !isNaN(timestamp)
      ? timestamp
      : timestamp instanceof Date
        ? timestamp.getTime()
        : typeof timestamp === 'string' && !isNaN(Date.parse(timestamp))
          ? Date.parse(timestamp)
          : Date.now();
  const timeIso = new Date(ts).toISOString().substring(11, 19) + ' UTC';
  return (
    `⚪ <b>[OBSERVATION: DEADZONE_STAND_DOWN]</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `⏳ <b>Status:</b> <code>STAND_DOWN (Active Temporal Gate)</code>\n` +
    `ℹ️ <b>Details:</b> <i>${escapeHtml(reason)}</i>\n` +
    `🛑 <b>Action:</b> All setups silenced. Zero trade orders placed.\n` +
    `⏰ <b>Time:</b> <code>${timeIso}</code>`
  );
}
