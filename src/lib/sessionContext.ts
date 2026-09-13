/**
 * @file src/lib/sessionContext.ts
 * @description Clock-Aligned Quant Cadence Engine & Dynamic Live Session Context
 *
 * Provides:
 *  1. getNextCandleCloseTimestamp: Deterministic wall-clock aligned boundary calculations
 *     for 5m (:00, :05, :10...), 15m (:00, :15, :30, :45), and 30m (:00, :30) cadences.
 *  2. calculateCurrentKillzone: Evaluates active institutional session / killzone windows
 *     with NY Lunch Dead Zone preemption.
 *  3. buildLiveSessionContext: Generates un-cached, millisecond-precise session metadata
 *     with synchronized UTC and localized Cairo timestamps to eradicate context freeze.
 */

export type LiveKillzoneWindow =
  | 'ASIAN_RANGE'
  | 'LONDON_AM_KILLZONE'
  | 'NY_AM_KILLZONE'
  | 'NY_PM_KILLZONE'
  | 'DEAD_ZONE';

export interface LiveSessionContext {
  timestamp_utc: string;
  timestamp_cairo: string;
  current_time_utc: string;
  current_time_cairo: string;
  current_killzone: LiveKillzoneWindow;
  is_active_killzone: boolean;
  live_price: number | null;
  execution_millisecond: number;
}

/**
 * Calculates the exact millisecond timestamp of the next upcoming candle close
 * aligned strictly to wall-clock candle boundaries:
 * - 5m:  :00, :05, :10, :15, :20, :25, :30, :35, :40, :45, :50, :55
 * - 15m: :00, :15, :30, :45
 * - 30m: :00, :30
 *
 * Both refreshing the browser and mounting across multiple tabs will compute
 * the exact same remaining seconds to the next candle close.
 *
 * @param intervalMinutes 5 | 15 | 30 (defaults to 15)
 * @param fromTimestamp Epoch ms (defaults to Date.now())
 */
export function getNextCandleCloseTimestamp(
  intervalMinutes: number,
  fromTimestamp: number = Date.now()
): number {
  const safeTimestamp = typeof fromTimestamp === 'number' && !isNaN(fromTimestamp) && fromTimestamp > 0
    ? fromTimestamp
    : Date.now();
  const validMinutes = intervalMinutes === 5 ? 5 : intervalMinutes === 30 ? 30 : 15;
  const intervalMs = validMinutes * 60 * 1000;
  return (Math.floor(safeTimestamp / intervalMs) + 1) * intervalMs;
}

/**
 * Evaluates the active institutional session or killzone from a timestamp.
 * Incorporates NY Lunch Dead Zone preemption (12:00 PM – 1:30 PM New York Time).
 */
export function calculateCurrentKillzone(dateInput: Date | number = new Date()): LiveKillzoneWindow {
  const d = typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return 'DEAD_ZONE';

  // NY Lunch Dead Zone Preemption (12:00 PM – 1:30 PM New York Time)
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(d);
    const nyHour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '-1', 10);
    const nyMin = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '-1', 10);
    if (nyHour === 12 || (nyHour === 13 && nyMin <= 30)) {
      return 'DEAD_ZONE';
    }
  } catch {
    // Non-fatal if timeZone not supported
  }

  const hour = d.getUTCHours();

  if (hour >= 0 && hour <= 3) return 'ASIAN_RANGE';
  if (hour >= 6 && hour <= 8) return 'LONDON_AM_KILLZONE';
  if (hour >= 12 && hour <= 14) return 'NY_AM_KILLZONE';
  if (hour >= 17 && hour <= 18) return 'NY_PM_KILLZONE';
  return 'DEAD_ZONE';
}

/**
 * Formats a timestamp into localized Cairo time (Africa/Cairo UTC+3).
 */
export function formatCairoDateTime(
  timestamp: number | string | Date | undefined | null,
  includeSeconds: boolean = false
): string {
  if (!timestamp) return '—';
  const d = typeof timestamp === 'number' || typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (isNaN(d.getTime())) return '—';

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' } : {}),
      hour12: false,
    });
    return formatter.format(d).replace(',', '');
  } catch {
    // Fallback if timezone is unavailable (Cairo is UTC+3)
    const shifted = new Date(d.getTime() + 3 * 3600 * 1000);
    const iso = shifted.toISOString().replace('T', ' ');
    return includeSeconds ? iso.slice(0, 19) : iso.slice(0, 16);
  }
}

/**
 * Builds dynamic, millisecond-precise session context for AI prompt evaluation and telemetry.
 * Prevents previous candle timestamps or cached server payloads from masquerading as current time.
 */
export function buildLiveSessionContext(
  nowInput: Date | number = new Date(),
  livePrice: number | null = null
): LiveSessionContext {
  const now = typeof nowInput === 'number' ? new Date(nowInput) : nowInput;
  const currentKillzone = calculateCurrentKillzone(now);
  const isActiveKillzone =
    currentKillzone === 'LONDON_AM_KILLZONE' ||
    currentKillzone === 'NY_AM_KILLZONE' ||
    currentKillzone === 'NY_PM_KILLZONE';

  const cairoFormatted = formatCairoDateTime(now, true);
  const cairoTimeOnly = cairoFormatted.includes(' ') ? cairoFormatted.split(' ')[1] : cairoFormatted;
  const utcTimeOnly = now.toISOString().slice(11, 19);

  return {
    timestamp_utc: now.toISOString(),
    timestamp_cairo: cairoFormatted,
    current_time_utc: `${utcTimeOnly} UTC`,
    current_time_cairo: `${cairoTimeOnly} Cairo (UTC+3)`,
    current_killzone: currentKillzone,
    is_active_killzone: isActiveKillzone,
    live_price: livePrice ?? null,
    execution_millisecond: now.getTime(),
  };
}
