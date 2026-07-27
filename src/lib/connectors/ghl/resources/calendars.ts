import "server-only";

import { ghlGet } from "../client";
import {
  ghlCalendarsResponseSchema,
  ghlCalendarEventsResponseSchema,
  type GhlCalendar,
  type GhlCalendarEvent,
} from "../types";
import { normalizeCalendar, normalizeCalendarEvent } from "../normalize";
import { requireGhlLocationId } from "../config";
import { getCachedReference, setCachedReference } from "../cache";

export async function listCalendars(options: { useCache?: boolean } = {}): Promise<GhlCalendar[]> {
  const locationId = requireGhlLocationId();

  if (options.useCache !== false) {
    const cached = await getCachedReference<GhlCalendar[]>(locationId, "calendars");
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await ghlGet("/calendars/", undefined, { resource: "calendars" });
    const parsed = ghlCalendarsResponseSchema.safeParse(response);

    let calendars: GhlCalendar[];

    if (!parsed.success) {
      console.warn("[GHL Calendars] Response validation warning:", parsed.error.message);
      const raw = response as { calendars?: unknown[] };
      calendars = Array.isArray(raw.calendars)
        ? (raw.calendars as Record<string, unknown>[]).map(normalizeCalendar)
        : [];
    } else {
      calendars = parsed.data.calendars.map((c) => normalizeCalendar(c as Record<string, unknown>));
    }

    await setCachedReference(locationId, "calendars", calendars);
    return calendars;
  } catch (error) {
    console.warn(
      "[GHL Calendars] API may not be available:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return [];
  }
}

export async function getCalendarById(
  calendarId: string,
  options: { useCache?: boolean } = {},
): Promise<GhlCalendar | null> {
  const calendars = await listCalendars(options);
  return calendars.find((c) => c.id === calendarId) ?? null;
}

export type CalendarEventSearchOptions = {
  calendarId?: string;
  contactId?: string;
  startTime: string;
  endTime: string;
  limit?: number;
};

export async function listCalendarEvents(
  options: CalendarEventSearchOptions,
): Promise<GhlCalendarEvent[]> {
  const locationId = requireGhlLocationId();

  // HighLevel calendar events require startTime/endTime as unix ms
  const startMs = Number.isFinite(Number(options.startTime))
    ? Number(options.startTime)
    : new Date(options.startTime).getTime();
  const endMs = Number.isFinite(Number(options.endTime))
    ? Number(options.endTime)
    : new Date(options.endTime).getTime();

  const query: Record<string, string | number | boolean | undefined> = {
    locationId,
    startTime: startMs,
    endTime: endMs,
  };

  if (options.calendarId) {
    query.calendarId = options.calendarId;
  }
  if (options.limit) {
    query.limit = Math.min(options.limit, 100);
  }

  try {
    const response = await ghlGet("/calendars/events", query, {
      resource: "calendarEvents",
      injectLocationId: false,
    });
    const parsed = ghlCalendarEventsResponseSchema.safeParse(response);

    if (!parsed.success) {
      console.warn("[GHL Calendar Events] Response validation warning:", parsed.error.message);
      const raw = response as { events?: unknown[] };
      return Array.isArray(raw.events)
        ? (raw.events as Record<string, unknown>[]).map(normalizeCalendarEvent)
        : [];
    }

    let events = parsed.data.events.map((e) =>
      normalizeCalendarEvent(e as Record<string, unknown>),
    );

    if (options.contactId) {
      events = events.filter((e) => e.contactId === options.contactId);
    }

    return events;
  } catch (error) {
    console.warn(
      "[GHL Calendar Events] API may not be available:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return [];
  }
}

export async function listUpcomingEvents(
  daysAhead = 7,
  options: { calendarId?: string; limit?: number } = {},
): Promise<GhlCalendarEvent[]> {
  const now = new Date();
  const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  return listCalendarEvents({
    calendarId: options.calendarId,
    startTime: now.toISOString(),
    endTime: endDate.toISOString(),
    limit: options.limit,
  });
}

export async function listEventsForContact(
  contactId: string,
  options: { startTime?: string; endTime?: string; limit?: number } = {},
): Promise<GhlCalendarEvent[]> {
  const now = new Date();
  const pastDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const futureDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  return listCalendarEvents({
    contactId,
    startTime: options.startTime ?? pastDate.toISOString(),
    endTime: options.endTime ?? futureDate.toISOString(),
    limit: options.limit,
  });
}
