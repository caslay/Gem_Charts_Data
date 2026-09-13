/**
 * ── Operational Schedule & Active Hours Engine ────────────────────────────────
 * Institutional trading window and active hours evaluator.
 * Controls automated AI scanning windows to prevent quota exhaustion during
 * low-volume Asian chop and off-hours, while ensuring instant manual synthesis.
 */

export type AutoScanScheduleMode = 'SESSION_PRESET' | 'CUSTOM' | 'ALWAYS_ON';

export interface OperationalScheduleConfig {
  scheduleMode?: AutoScanScheduleMode;
  activeStart?: string; // "HH:MM" (24h)
  activeEnd?: string;   // "HH:MM" (24h)
  timezone?: string;    // e.g. "Africa/Cairo"
}

export interface ScheduleEvaluationResult {
  isWithinActiveSchedule: boolean;
  nextSessionOpenTimestamp: number | null; // Epoch ms of next session open
  resumesAtFormatted: string;              // e.g. "08:00"
  currentLocalizedTime: string;            // e.g. "14:25:30"
  currentTimezone: string;
  effectiveMode: AutoScanScheduleMode;
  effectiveStart: string;
  effectiveEnd: string;
}

export const DEFAULT_SCHEDULE_MODE: AutoScanScheduleMode = 'SESSION_PRESET';
export const DEFAULT_ACTIVE_START = '08:00';
export const DEFAULT_ACTIVE_END = '22:00';
export const DEFAULT_TIMEZONE = 'Africa/Cairo';

/**
 * Validate whether a timezone identifier is supported by the JavaScript Intl runtime.
 */
export function isValidTimezone(tz?: string | null): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Return a guaranteed valid IANA timezone name, defaulting safely to Africa/Cairo or UTC.
 */
export function getSafeTimezone(tz?: string | null): string {
  if (tz && isValidTimezone(tz)) {
    return tz.trim();
  }
  if (isValidTimezone(DEFAULT_TIMEZONE)) {
    return DEFAULT_TIMEZONE;
  }
  return 'UTC';
}

/**
 * Safely parse "HH:MM" string into hours and minutes
 */
export function parseTimeString(timeStr?: string | null, defaultH = 8, defaultM = 0): { hours: number; minutes: number } {
  if (!timeStr || typeof timeStr !== 'string') {
    return { hours: defaultH, minutes: defaultM };
  }
  const parts = timeStr.trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return {
    hours: isNaN(h) || h < 0 || h > 23 ? defaultH : h,
    minutes: isNaN(m) || m < 0 || m > 59 ? defaultM : m,
  };
}

/**
 * Convert localized date/time in given IANA timezone into absolute UTC epoch timestamp.
 * Includes defensive fallback to UTC and strict hourCycle 'h23' to eliminate 24:00 midnight quirks.
 */
export function convertLocalizedToUtcEpoch(
  y: number,
  m: number, // 1-12
  d: number,
  h: number,
  min: number,
  sec: number,
  timeZone: string
): number {
  const guessUtc = Date.UTC(y, m - 1, d, h, min, sec);
  const safeTz = getSafeTimezone(timeZone);

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: safeTz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
      hourCycle: 'h23',
    });

    const getLocalizedUtc = (ms: number) => {
      const parts = formatter.formatToParts(new Date(ms));
      let y1 = 0, m1 = 0, d1 = 0, h1 = 0, min1 = 0, s1 = 0;
      for (const p of parts) {
        if (p.type === 'year') y1 = parseInt(p.value, 10);
        if (p.type === 'month') m1 = parseInt(p.value, 10);
        if (p.type === 'day') d1 = parseInt(p.value, 10);
        if (p.type === 'hour') h1 = parseInt(p.value, 10) % 24;
        if (p.type === 'minute') min1 = parseInt(p.value, 10);
        if (p.type === 'second') s1 = parseInt(p.value, 10);
      }
      return Date.UTC(y1, m1 - 1, d1, h1, min1, s1);
    };

    const guessLocalizedUtc = getLocalizedUtc(guessUtc);
    const offset = guessLocalizedUtc - guessUtc;
    let targetUtc = guessUtc - offset;

    const verified = getLocalizedUtc(targetUtc);
    if (verified !== guessUtc) {
      targetUtc += (guessUtc - verified);
    }

    return targetUtc;
  } catch {
    return guessUtc;
  }
}

/**
 * Evaluate whether current localized time is within active schedule boundaries,
 * and calculate the exact epoch timestamp of the next session open.
 */
export function evaluateOperationalSchedule(
  config?: OperationalScheduleConfig,
  nowEpochMs: number = Date.now()
): ScheduleEvaluationResult {
  const mode: AutoScanScheduleMode = config?.scheduleMode || DEFAULT_SCHEDULE_MODE;
  // SESSION_PRESET ('Western Sessions') is strictly pegged to Africa/Cairo
  const timezone = mode === 'SESSION_PRESET' ? 'Africa/Cairo' : getSafeTimezone(config?.timezone);

  // Resolve active boundary strings based on mode
  let effectiveStart = DEFAULT_ACTIVE_START;
  let effectiveEnd = DEFAULT_ACTIVE_END;

  if (mode === 'CUSTOM') {
    effectiveStart = config?.activeStart || DEFAULT_ACTIVE_START;
    effectiveEnd = config?.activeEnd || DEFAULT_ACTIVE_END;
  } else if (mode === 'SESSION_PRESET') {
    // Western Sessions Preset (Pre-London, London, NY AM, NY Close): 08:00 - 22:00 Cairo
    effectiveStart = '08:00';
    effectiveEnd = '22:00';
  } else if (mode === 'ALWAYS_ON') {
    effectiveStart = '00:00';
    effectiveEnd = '24:00';
  }

  const startParsed = parseTimeString(effectiveStart, 8, 0);
  const endParsed = parseTimeString(effectiveEnd, 22, 0);

  const resumesAtFormatted = `${startParsed.hours.toString().padStart(2, '0')}:${startParsed.minutes.toString().padStart(2, '0')}`;

  const formatCurrentLocalizedTime = (epochMs: number, tz: string): string => {
    try {
      return new Date(epochMs).toLocaleTimeString('en-GB', { timeZone: tz, hour12: false, hourCycle: 'h23' });
    } catch {
      return new Date(epochMs).toISOString().substring(11, 19);
    }
  };

  // If ALWAYS_ON, active at all times
  if (mode === 'ALWAYS_ON') {
    return {
      isWithinActiveSchedule: true,
      nextSessionOpenTimestamp: null,
      resumesAtFormatted,
      currentLocalizedTime: formatCurrentLocalizedTime(nowEpochMs, timezone),
      currentTimezone: timezone,
      effectiveMode: mode,
      effectiveStart,
      effectiveEnd,
    };
  }

  // Extract current localized time components
  const targetDate = new Date(nowEpochMs);
  let year = 1970, month = 1, day = 1, hour = 0, minute = 0, second = 0;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(targetDate);
    for (const p of parts) {
      if (p.type === 'year') year = parseInt(p.value, 10);
      if (p.type === 'month') month = parseInt(p.value, 10);
      if (p.type === 'day') day = parseInt(p.value, 10);
      if (p.type === 'hour') hour = parseInt(p.value, 10) % 24;
      if (p.type === 'minute') minute = parseInt(p.value, 10);
      if (p.type === 'second') second = parseInt(p.value, 10);
    }
  } catch {
    // Fallback if invalid timezone supplied
    year = targetDate.getUTCFullYear();
    month = targetDate.getUTCMonth() + 1;
    day = targetDate.getUTCDate();
    hour = targetDate.getUTCHours();
    minute = targetDate.getUTCMinutes();
    second = targetDate.getUTCSeconds();
  }

  const currentSec = hour * 3600 + minute * 60 + second;
  const startSec = startParsed.hours * 3600 + startParsed.minutes * 60;
  const endSec = endParsed.hours * 3600 + endParsed.minutes * 60;

  let isWithinActiveSchedule = false;
  if (startSec === endSec) {
    // 24-hour window
    isWithinActiveSchedule = true;
  } else if (startSec < endSec) {
    // Standard daytime window, e.g. 08:00 to 22:00
    isWithinActiveSchedule = currentSec >= startSec && currentSec < endSec;
  } else {
    // Overnight window, e.g. 22:00 to 06:00
    isWithinActiveSchedule = currentSec >= startSec || currentSec < endSec;
  }

  const currentLocalizedTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`;

  if (isWithinActiveSchedule) {
    return {
      isWithinActiveSchedule: true,
      nextSessionOpenTimestamp: null,
      resumesAtFormatted,
      currentLocalizedTime,
      currentTimezone: timezone,
      effectiveMode: mode,
      effectiveStart,
      effectiveEnd,
    };
  }

  // Calculate next session open timestamp
  let openTargetY = year;
  let openTargetM = month;
  let openTargetD = day;

  if (startSec < endSec) {
    // Standard intraday window
    if (currentSec >= endSec) {
      // Past end time today -> opens tomorrow
      const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
      openTargetY = nextDay.getUTCFullYear();
      openTargetM = nextDay.getUTCMonth() + 1;
      openTargetD = nextDay.getUTCDate();
    }
    // If currentSec < startSec -> opens today at startSec (openTargetD unchanged)
  } else {
    // Overnight window (startSec > endSec), e.g. 22:00 to 06:00
    // If outside, endSec <= currentSec < startSec -> opens today at startSec (openTargetD unchanged)
    if (currentSec >= startSec) {
      // Handled by isWithinActiveSchedule = true
    }
  }

  let nextOpenMs = convertLocalizedToUtcEpoch(
    openTargetY,
    openTargetM,
    openTargetD,
    startParsed.hours,
    startParsed.minutes,
    0,
    timezone
  );

  // Guard against any minor negative delta due to seconds
  if (nextOpenMs <= nowEpochMs) {
    const nextDay = new Date(Date.UTC(openTargetY, openTargetM - 1, openTargetD + 1));
    nextOpenMs = convertLocalizedToUtcEpoch(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
      startParsed.hours,
      startParsed.minutes,
      0,
      timezone
    );
  }

  return {
    isWithinActiveSchedule: false,
    nextSessionOpenTimestamp: nextOpenMs,
    resumesAtFormatted,
    currentLocalizedTime,
    currentTimezone: timezone,
    effectiveMode: mode,
    effectiveStart,
    effectiveEnd,
  };
}
