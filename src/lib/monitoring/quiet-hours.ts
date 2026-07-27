import "server-only";

import type { MonitoringSettings } from "./types";

/**
 * Check if the current time is within quiet hours.
 * @param now Current Date object
 * @param settings Monitoring settings with timezone and quiet hours
 * @returns True if in quiet hours, false otherwise
 */
export function isInQuietHours(now: Date, settings: MonitoringSettings): boolean {
  const { quiet_hours_start, quiet_hours_end, timezone } = settings;

  if (!quiet_hours_start || !quiet_hours_end) {
    return false;
  }

  try {
    // Format current time in the configured timezone as HH:MM
    const currentTimeStr = now.toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });

    const current = parseTime(currentTimeStr);
    const start = parseTime(quiet_hours_start);
    const end = parseTime(quiet_hours_end);

    if (start === null || end === null || current === null) {
      return false;
    }

    // Handle overnight quiet hours (e.g., 22:00 to 06:00)
    if (end < start) {
      return current >= start || current < end;
    }

    // Normal same-day quiet hours (e.g., 12:00 to 13:00)
    return current >= start && current < end;
  } catch {
    return false;
  }
}

/**
 * Parse HH:MM time string to minutes since midnight.
 * @returns Minutes since midnight, or null if invalid
 */
function parseTime(timeStr: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}
