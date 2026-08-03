/**
 * Calendar-boundary helpers for Baxter feedback reporting.
 * Pure (no server-only) so unit tests can pin `now` without I/O.
 *
 * Acton is Bay Area — boundaries use America/Los_Angeles wall time.
 */

export const BAXTER_REPORTING_TIMEZONE = "America/Los_Angeles";

export type FeedbackRangePreset =
  | "this_week"
  | "this_month"
  | "last_month"
  | "this_year"
  | "last_7_days"
  | "last_30_days"
  | "all_time"
  | "custom";

export type DateRangeBounds = {
  /** Inclusive lower bound as ISO UTC, or null = unbounded. */
  start: string | null;
  /** Inclusive upper bound as ISO UTC, or null = unbounded. */
  end: string | null;
};

export type FeedbackSortDirection = "newest" | "oldest";

type ZonedYmd = {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday … 6 = Saturday (JS convention). */
  weekday: number;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Wall-clock Y-M-D + weekday in the given IANA timezone. */
export function getZonedYmd(date: Date, timeZone: string = BAXTER_REPORTING_TIMEZONE): ZonedYmd {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekdayKey = get("weekday");
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayMap[weekdayKey] ?? 0,
  };
}

/**
 * Convert a wall-clock date/time in `timeZone` to a UTC Date.
 * Handles PST/PDT by resolving the offset at that local instant.
 */
export function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string = BAXTER_REPORTING_TIMEZONE,
): Date {
  // Initial guess: treat components as UTC, then correct by the zone offset.
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offsetMs = getTimeZoneOffsetMs(utcGuess, timeZone);
  let result = new Date(utcGuess.getTime() - offsetMs);

  // One refinement pass (needed around DST transitions).
  const offset2 = getTimeZoneOffsetMs(result, timeZone);
  if (offset2 !== offsetMs) {
    result = new Date(utcGuess.getTime() - offset2);
  }
  return result;
}

/** Offset such that `utc + offset ≈ wall clock in timeZone` (as UTC components). */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  let hour = Number(parts.hour);
  // Some engines emit "24" for midnight.
  if (hour === 24) hour = 0;

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

export function startOfZonedDay(
  year: number,
  month: number,
  day: number,
  timeZone: string = BAXTER_REPORTING_TIMEZONE,
): Date {
  return zonedLocalToUtc(year, month, day, 0, 0, 0, timeZone);
}

/** Inclusive end of calendar day: 23:59:59.999 in the zone. */
export function endOfZonedDay(
  year: number,
  month: number,
  day: number,
  timeZone: string = BAXTER_REPORTING_TIMEZONE,
): Date {
  return zonedLocalToUtc(year, month, day, 23, 59, 59, timeZone);
}

function addCalendarDays(year: number, month: number, day: number, delta: number): ZonedYmd {
  // Use UTC noon math to avoid local DST issues when shifting calendar days.
  const utc = new Date(Date.UTC(year, month - 1, day + delta, 12, 0, 0));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    weekday: utc.getUTCDay(),
  };
}

function mondayOnOrBefore(ymd: ZonedYmd): ZonedYmd {
  // weekday: Mon=1 … Sun=0 → days since Monday
  const daysSinceMonday = ymd.weekday === 0 ? 6 : ymd.weekday - 1;
  return addCalendarDays(ymd.year, ymd.month, ymd.day, -daysSinceMonday);
}

/**
 * Resolve a preset (or custom YYYY-MM-DD pair) to ISO UTC bounds.
 * Open-ended presets that mean "through now" use `now` as the inclusive end.
 */
export function resolveFeedbackDateRange(input: {
  preset: FeedbackRangePreset;
  /** YYYY-MM-DD — required when preset is custom. */
  customStart?: string | null;
  /** YYYY-MM-DD — required when preset is custom (inclusive end-of-day). */
  customEnd?: string | null;
  now?: Date;
  timeZone?: string;
}): DateRangeBounds {
  const timeZone = input.timeZone ?? BAXTER_REPORTING_TIMEZONE;
  const now = input.now ?? new Date();

  if (input.preset === "all_time") {
    return { start: null, end: null };
  }

  if (input.preset === "custom") {
    const startRaw = input.customStart?.trim() ?? "";
    const endRaw = input.customEnd?.trim() ?? "";
    const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startRaw);
    const endMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endRaw);
    if (!startMatch || !endMatch) {
      return { start: null, end: null };
    }
    const start = startOfZonedDay(
      Number(startMatch[1]),
      Number(startMatch[2]),
      Number(startMatch[3]),
      timeZone,
    );
    const end = endOfZonedDay(
      Number(endMatch[1]),
      Number(endMatch[2]),
      Number(endMatch[3]),
      timeZone,
    );
    return { start: start.toISOString(), end: end.toISOString() };
  }

  const today = getZonedYmd(now, timeZone);
  const nowIso = now.toISOString();

  if (input.preset === "this_week") {
    const monday = mondayOnOrBefore(today);
    const start = startOfZonedDay(monday.year, monday.month, monday.day, timeZone);
    return { start: start.toISOString(), end: nowIso };
  }

  if (input.preset === "this_month") {
    const start = startOfZonedDay(today.year, today.month, 1, timeZone);
    return { start: start.toISOString(), end: nowIso };
  }

  if (input.preset === "this_year") {
    const start = startOfZonedDay(today.year, 1, 1, timeZone);
    return { start: start.toISOString(), end: nowIso };
  }

  if (input.preset === "last_7_days") {
    const startDay = addCalendarDays(today.year, today.month, today.day, -6);
    const start = startOfZonedDay(startDay.year, startDay.month, startDay.day, timeZone);
    return { start: start.toISOString(), end: nowIso };
  }

  if (input.preset === "last_30_days") {
    const startDay = addCalendarDays(today.year, today.month, today.day, -29);
    const start = startOfZonedDay(startDay.year, startDay.month, startDay.day, timeZone);
    return { start: start.toISOString(), end: nowIso };
  }

  if (input.preset === "last_month") {
    const firstOfThisMonth = startOfZonedDay(today.year, today.month, 1, timeZone);
    // Day before this month's 1st, in the zone.
    const lastMonthEndYmd = getZonedYmd(
      new Date(firstOfThisMonth.getTime() - 12 * 60 * 60 * 1000),
      timeZone,
    );
    const start = startOfZonedDay(lastMonthEndYmd.year, lastMonthEndYmd.month, 1, timeZone);
    const end = endOfZonedDay(
      lastMonthEndYmd.year,
      lastMonthEndYmd.month,
      lastMonthEndYmd.day,
      timeZone,
    );
    return { start: start.toISOString(), end: end.toISOString() };
  }

  return { start: null, end: null };
}

export function parseFeedbackRangePreset(raw: string | null | undefined): FeedbackRangePreset {
  const value = (raw ?? "").trim();
  const allowed: FeedbackRangePreset[] = [
    "this_week",
    "this_month",
    "last_month",
    "this_year",
    "last_7_days",
    "last_30_days",
    "all_time",
    "custom",
  ];
  return (allowed.find((p) => p === value) ?? "this_month") as FeedbackRangePreset;
}

export function inDateRange(isoTimestamp: string, range: DateRangeBounds): boolean {
  if (range.start && isoTimestamp < range.start) return false;
  if (range.end && isoTimestamp > range.end) return false;
  return true;
}

/** Format a YYYY-MM-DD for date inputs from an ISO bound (in reporting TZ). */
export function isoToZonedDateInput(
  iso: string | null | undefined,
  timeZone: string = BAXTER_REPORTING_TIMEZONE,
): string {
  if (!iso) return "";
  const ymd = getZonedYmd(new Date(iso), timeZone);
  return `${ymd.year}-${pad2(ymd.month)}-${pad2(ymd.day)}`;
}
