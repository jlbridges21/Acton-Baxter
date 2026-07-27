import "server-only";

import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import { listUpcomingEvents, listEventsForContact } from "@/lib/connectors/ghl/resources/calendars";
import type { BaxterGhlCalendarContext, GhlCalendarEvent, GhlEvidenceSource } from "./types";
import { createCalendarEventEvidenceSource } from "./evidence";

export async function getBaxterCalendarContext(
  daysAhead = 7,
): Promise<BaxterGhlCalendarContext | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const upcomingEvents = await listUpcomingEvents(daysAhead);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayEvents = upcomingEvents.filter((e) => {
    const eventDate = new Date(e.startTime);
    return eventDate >= today && eventDate < tomorrow;
  });

  const evidenceSources = upcomingEvents
    .slice(0, 10)
    .map((e) => createCalendarEventEvidenceSource(e.id, e.title, e.startTime));

  return {
    upcomingEvents,
    todayEvents,
    evidenceSources,
  };
}

export async function getBaxterTodayEvents(): Promise<{
  events: GhlCalendarEvent[];
  evidenceSources: GhlEvidenceSource[];
} | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const context = await getBaxterCalendarContext(1);
  if (!context) {
    return null;
  }

  return {
    events: context.todayEvents,
    evidenceSources: context.evidenceSources,
  };
}

export async function getBaxterEventsForContact(
  contactId: string,
  options: { limit?: number } = {},
): Promise<{ events: GhlCalendarEvent[]; evidenceSources: GhlEvidenceSource[] } | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const events = await listEventsForContact(contactId, options);
  const evidenceSources = events.map((e) =>
    createCalendarEventEvidenceSource(e.id, e.title, `Contact: ${contactId}`),
  );

  return { events, evidenceSources };
}
