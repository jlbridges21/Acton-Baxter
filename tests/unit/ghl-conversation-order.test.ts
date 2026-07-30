import { describe, expect, it } from "vitest";
import {
  sortMessagesNewestFirst,
  sortConversationsNewestFirst,
  conversationActivityTimestampMs,
  mergeConversationTimelineNewestFirst,
} from "@/lib/connectors/ghl/conversation-sort";
import type { GhlConversation, GhlMessage } from "@/lib/connectors/ghl/types";

function msg(id: string, dateAdded: string): GhlMessage {
  return {
    id,
    conversationId: "c1",
    contactId: "contact-1",
    locationId: "loc",
    type: "TYPE_EMAIL",
    direction: "inbound",
    body: id,
    textBody: id,
    htmlBody: null,
    subject: null,
    fromAddress: null,
    toAddresses: [],
    emailMessageIds: [],
    threadId: null,
    status: null,
    dateAdded,
    attachments: [],
  };
}

function conv(
  id: string,
  stamps: { lastMessageAt?: string | null; dateUpdated?: string | null; dateAdded?: string | null },
): GhlConversation {
  return {
    id,
    locationId: "loc",
    contactId: "contact-1",
    type: "TYPE_EMAIL",
    unreadCount: 0,
    lastMessageAt: stamps.lastMessageAt ?? null,
    lastMessageBody: null,
    lastMessageType: null,
    lastMessageDirection: "unknown",
    dateAdded: stamps.dateAdded ?? null,
    dateUpdated: stamps.dateUpdated ?? null,
  };
}

describe("GHL conversation message ordering (newest first)", () => {
  it("sorts mixed dates newest → oldest", () => {
    const sorted = sortMessagesNewestFirst([
      msg("may", "2025-05-01T12:00:00.000Z"),
      msg("jul", "2025-07-29T12:00:00.000Z"),
      msg("jun", "2025-06-10T12:00:00.000Z"),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["jul", "jun", "may"]);
  });

  it("merges pagination pages into global newest → oldest order", () => {
    const page1 = [
      { id: "jul29", dateAdded: "2025-07-29T12:00:00.000Z" },
      { id: "jul20", dateAdded: "2025-07-20T12:00:00.000Z" },
    ];
    const earlier = [
      { id: "jun10", dateAdded: "2025-06-10T12:00:00.000Z" },
      { id: "may1", dateAdded: "2025-05-01T12:00:00.000Z" },
    ];
    const merged = mergeConversationTimelineNewestFirst(page1, earlier);
    expect(merged.map((m) => m.id)).toEqual(["jul29", "jul20", "jun10", "may1"]);
  });

  it("dedupes by id when merging pages", () => {
    const existing = [{ id: "jul29", dateAdded: "2025-07-29T12:00:00.000Z", body: "a" }];
    const page = [
      { id: "jul29", dateAdded: "2025-07-29T12:00:00.000Z", body: "updated" },
      { id: "jun10", dateAdded: "2025-06-10T12:00:00.000Z", body: "c" },
    ];
    const merged = mergeConversationTimelineNewestFirst(existing, page);
    expect(merged.map((m) => m.id)).toEqual(["jul29", "jun10"]);
    expect(merged[0]?.body).toBe("updated");
  });

  it("uses stable id tie-breaker for equal timestamps", () => {
    const ts = "2025-07-29T12:00:00.000Z";
    const sorted = sortMessagesNewestFirst([msg("b-id", ts), msg("a-id", ts)]);
    expect(sorted.map((m) => m.id)).toEqual(["a-id", "b-id"]);
  });
});

describe("GHL conversation list ordering (newest first)", () => {
  it("sorts by lastMessageAt then dateUpdated then dateAdded", () => {
    const sorted = sortConversationsNewestFirst([
      conv("old", { lastMessageAt: "2025-05-01T00:00:00.000Z" }),
      conv("new", { lastMessageAt: "2025-07-29T00:00:00.000Z" }),
      conv("mid-updated", {
        lastMessageAt: null,
        dateUpdated: "2025-06-15T00:00:00.000Z",
      }),
      conv("added-only", {
        lastMessageAt: null,
        dateUpdated: null,
        dateAdded: "2025-06-01T00:00:00.000Z",
      }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["new", "mid-updated", "added-only", "old"]);
  });

  it("prefers lastMessageAt over dateUpdated", () => {
    const c = conv("x", {
      lastMessageAt: "2025-07-01T00:00:00.000Z",
      dateUpdated: "2025-01-01T00:00:00.000Z",
    });
    expect(conversationActivityTimestampMs(c)).toBe(Date.parse("2025-07-01T00:00:00.000Z"));
  });
});
