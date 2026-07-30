/**
 * GHL conversation lookup — intent, filtering, John Example fixture, admin search helpers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { detectGhlIntent } from "@/lib/baxter-ai/ghl-intent";
import {
  classifyCapabilityQuestion,
  isImpliedCapabilityAction,
} from "@/lib/baxter/capability-intent";
import { answerCapabilityHelp } from "@/lib/baxter/capability-help";
import { detectConceptQuestion } from "@/lib/baxter/concept-vocabulary";
import {
  extractConversationContactQuery,
  inferConversationLookupFilters,
  isGhlConversationLookupQuestion,
} from "@/lib/baxter-data/ghl/conversation-intent";
import {
  isEmailMessageType,
  messageMatchesChannel,
  messageMatchesDirection,
  sortMessagesNewestFirst,
  messageTimestampMs,
  buildDeterministicConversationAnswer,
} from "@/lib/baxter-data/ghl/conversation-lookup";
import type { GhlMessage } from "@/lib/connectors/ghl/types";
import { deriveAnswerTypeLabel } from "@/lib/baxter-ai/classify";
import { contextItemToSourceReference } from "@/lib/baxter-ai/citations";
import type { BaxterContextItem } from "@/lib/baxter-ai/types";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
});

/** Synthetic fixture (modeled on production Petr case — do not hardcode Petr answer). */
const JOHN = {
  id: "contact-john-example",
  name: "John Example",
  email: "john.example@example.com",
};

function msg(
  partial: Partial<GhlMessage> &
    Pick<GhlMessage, "id" | "type" | "direction" | "dateAdded" | "body">,
): GhlMessage {
  return {
    conversationId: "conv-john-1",
    contactId: JOHN.id,
    locationId: "loc",
    status: "delivered",
    attachments: [],
    ...partial,
  };
}

const FIXTURE_MESSAGES: GhlMessage[] = [
  msg({
    id: "m1-outbound-email",
    type: "TYPE_EMAIL",
    direction: "outbound",
    dateAdded: "2026-06-01T15:00:00.000Z",
    body: "Hi John, following up on the attached ADU proposal.",
  }),
  msg({
    id: "m2-inbound-email",
    type: "TYPE_EMAIL",
    direction: "inbound",
    dateAdded: "2026-06-10T18:30:00.000Z",
    body: "Thanks — the arborist visit went well. We will explore an attached ADU and pause for now given our $400k budget.",
  }),
  msg({
    id: "m3-sms-newer",
    type: "TYPE_SMS",
    direction: "inbound",
    dateAdded: "2026-06-12T12:00:00.000Z",
    body: "Quick SMS: still deciding on the attached path.",
  }),
];

describe("GHL conversation intent routing", () => {
  it("classifies last email from Petr as conversation_lookup", () => {
    const q = "What is the last email from Petr Jordan in GHL?";
    expect(isGhlConversationLookupQuestion(q)).toBe(true);
    expect(detectGhlIntent(q).intent).toBe("conversation_lookup");
    expect(detectGhlIntent(q).entities.contactName).toMatch(/Petr Jordan/i);
    expect(inferConversationLookupFilters(q)).toEqual({
      channel: "email",
      direction: "inbound",
    });
  });

  it("does not classify as specific_capability or GHL concept", () => {
    const q = "What is the last email from Petr Jordan in GHL?";
    expect(classifyCapabilityQuestion(q).kind).toBe("implied_action");
    expect(detectConceptQuestion(q).kind).toBe("none");
    expect(answerCapabilityHelp({ question: q, role: "admin", profile: null })).toBeNull();
  });

  it("Can you find Petr’s latest email executes as implied action / conversation lookup", () => {
    const q = "Can you find Petr Jordan's latest email in GHL?";
    expect(isImpliedCapabilityAction(q)).toBe(true);
    expect(classifyCapabilityQuestion(q).kind).toBe("implied_action");
    expect(detectGhlIntent(q).intent).toBe("conversation_lookup");
    expect(extractConversationContactQuery(q)).toMatch(/Petr Jordan/i);
  });

  it("outbound vs inbound email phrasing", () => {
    expect(inferConversationLookupFilters("What was the last email we sent Petr?")).toEqual({
      channel: "email",
      direction: "outbound",
    });
    expect(inferConversationLookupFilters("what did Petr last email us?")).toEqual({
      channel: "email",
      direction: "inbound",
    });
    expect(inferConversationLookupFilters("What is the latest conversation with Petr?")).toEqual({
      channel: "any",
      direction: "any",
    });
  });

  it("extracts contact by email", () => {
    expect(
      extractConversationContactQuery("Show me recent emails for john.example@example.com"),
    ).toBe("john.example@example.com");
  });
});

describe("John Example fixture — channel vs recency", () => {
  it("sorts by message timestamp descending", () => {
    const sorted = sortMessagesNewestFirst(FIXTURE_MESSAGES);
    expect(sorted.map((m) => m.id)).toEqual([
      "m3-sms-newer",
      "m2-inbound-email",
      "m1-outbound-email",
    ]);
    expect(messageTimestampMs(sorted[0]!)).toBeGreaterThan(messageTimestampMs(sorted[1]!));
  });

  it("last email from John → inbound email #2, not newer SMS", () => {
    const filtered = sortMessagesNewestFirst(
      FIXTURE_MESSAGES.filter(
        (m) => messageMatchesChannel(m, "email") && messageMatchesDirection(m, "inbound"),
      ),
    );
    expect(filtered[0]?.id).toBe("m2-inbound-email");
    expect(isEmailMessageType(filtered[0]?.type)).toBe(true);
  });

  it("latest message from John → SMS #3", () => {
    const filtered = sortMessagesNewestFirst(
      FIXTURE_MESSAGES.filter(
        (m) => messageMatchesChannel(m, "any") && messageMatchesDirection(m, "any"),
      ),
    );
    expect(filtered[0]?.id).toBe("m3-sms-newer");
  });

  it("latest outbound email → email #1", () => {
    const filtered = sortMessagesNewestFirst(
      FIXTURE_MESSAGES.filter(
        (m) => messageMatchesChannel(m, "email") && messageMatchesDirection(m, "outbound"),
      ),
    );
    expect(filtered[0]?.id).toBe("m1-outbound-email");
  });

  it("TYPE_CALL is not treated as email", () => {
    const callLike = msg({
      id: "call",
      type: "TYPE_CALL",
      direction: "inbound",
      dateAdded: "2026-06-13T00:00:00.000Z",
      body: "Hi Kevin, this looks like an email body but type is call.",
    });
    expect(isEmailMessageType(callLike.type)).toBe(false);
    expect(messageMatchesChannel(callLike, "email")).toBe(false);
  });

  it("deterministic answer includes live body (no fabrication)", () => {
    const answer = buildDeterministicConversationAnswer({
      question: "What is the last email from John Example in GHL?",
      contactName: JOHN.name,
      contactEmail: JOHN.email,
      message: FIXTURE_MESSAGES[1]!,
    });
    expect(answer).toContain("John Example");
    expect(answer).toContain("arborist");
    expect(answer).toContain("$400k");
    expect(answer).toMatch(/inbound/i);
  });

  it("answer type is Live Acton data when citing GHL", () => {
    const item: BaxterContextItem = {
      number: 1,
      id: "m2",
      title: "GoHighLevel — John Example — Email",
      summary: null,
      contentExcerpt: "arborist",
      category: "GoHighLevel",
      tags: ["gohighlevel"],
      sourceName: "GoHighLevel",
      sourceUrl: null,
      sourceType: "GoHighLevel",
      mimeType: null,
      updatedAt: "2026-06-10T18:30:00.000Z",
      citationLabel: "GoHighLevel — John Example — Email",
      relevanceScore: 0.99,
    };
    const sources = [contextItemToSourceReference(item)];
    expect(sources[0]?.sourceKind).toBe("gohighlevel");
    expect(deriveAnswerTypeLabel({ answerMode: "grounded", sources })).toBe("Live Acton data");
  });
});

describe("conversation lookup with mocked GHL APIs", () => {
  it("resolves contact by name and returns latest inbound email", async () => {
    vi.resetModules();
    vi.doMock("@/lib/connectors/ghl/config", () => ({
      isGhlConfigured: () => true,
      requireGhlLocationId: () => "loc",
    }));
    vi.doMock("@/lib/baxter-data/ghl/resolve", () => ({
      resolveContact: async () => ({
        resolved: true,
        ambiguous: false,
        notFound: false,
        entity: {
          id: JOHN.id,
          name: JOHN.name,
          email: JOHN.email,
          phone: null,
          firstName: "John",
          lastName: "Example",
        },
      }),
    }));
    vi.doMock("@/lib/connectors/ghl/resources/contacts", () => ({
      searchContacts: async () => ({ contacts: [], total: 0 }),
      getContactById: async () => ({
        id: JOHN.id,
        name: JOHN.name,
        email: JOHN.email,
        phone: null,
        firstName: "John",
        lastName: "Example",
      }),
    }));
    vi.doMock("@/lib/connectors/ghl/resources/conversations", () => ({
      listConversationsForContact: async () => [
        {
          id: "conv-john-1",
          contactId: JOHN.id,
          type: "TYPE_EMAIL",
          lastMessageAt: "2026-06-12T12:00:00.000Z",
        },
      ],
      getConversationMessages: async () => ({
        messages: FIXTURE_MESSAGES,
        hasMore: false,
      }),
      searchConversations: async () => ({ conversations: [], total: 0 }),
    }));

    const { lookupGhlConversationMessages } =
      await import("@/lib/baxter-data/ghl/conversation-lookup");
    const emailResult = await lookupGhlConversationMessages({
      contactQuery: "John Example",
      channel: "email",
      direction: "inbound",
      limit: 1,
    });
    expect(emailResult.ok).toBe(true);
    expect(emailResult.selected?.id).toBe("m2-inbound-email");
    expect(emailResult.diagnostics.contactResolved).toBe(true);

    const latest = await lookupGhlConversationMessages({
      contactQuery: "john.example@example.com",
      channel: "any",
      direction: "any",
      limit: 1,
    });
    expect(latest.selected?.id).toBe("m3-sms-newer");

    const noEmail = await lookupGhlConversationMessages({
      contactQuery: "John Example",
      channel: "email",
      direction: "inbound",
      limit: 1,
    });
    // still ok with fixture
    expect(noEmail.ok).toBe(true);

    vi.resetModules();
    vi.doUnmock("@/lib/connectors/ghl/config");
    vi.doUnmock("@/lib/baxter-data/ghl/resolve");
    vi.doUnmock("@/lib/connectors/ghl/resources/contacts");
    vi.doUnmock("@/lib/connectors/ghl/resources/conversations");
  });

  it("admin search is contact-first by name and email", async () => {
    vi.resetModules();
    vi.doMock("@/lib/connectors/ghl/config", () => ({
      isGhlConfigured: () => true,
      requireGhlLocationId: () => "loc",
    }));
    vi.doMock("@/lib/baxter-data/ghl/resolve", () => ({
      resolveContact: async (input: { name?: string; email?: string }) => ({
        resolved: true,
        ambiguous: false,
        notFound: false,
        entity: {
          id: JOHN.id,
          name: JOHN.name,
          email: JOHN.email,
          phone: null,
          firstName: "John",
          lastName: "Example",
        },
        // prove query shape reached resolve
        _query: input,
      }),
    }));
    vi.doMock("@/lib/connectors/ghl/resources/contacts", () => ({
      searchContacts: async () => ({ contacts: [], total: 0 }),
      getContactById: async () => null,
    }));
    vi.doMock("@/lib/connectors/ghl/resources/conversations", () => ({
      listConversationsForContact: async (contactId: string) => {
        expect(contactId).toBe(JOHN.id);
        return [
          {
            id: "conv-john-1",
            contactId: JOHN.id,
            type: "TYPE_EMAIL",
            lastMessageBody: "arborist visit went well",
            lastMessageAt: "2026-06-12T12:00:00.000Z",
          },
        ];
      },
      getConversationMessages: async () => ({ messages: [], hasMore: false }),
      searchConversations: async () => ({ conversations: [], total: 0 }),
    }));

    const { searchConversationsForAdmin } =
      await import("@/lib/baxter-data/ghl/conversation-lookup");
    const byName = await searchConversationsForAdmin({ query: "John Example", limit: 10 });
    expect(byName.contactsMatched).toBe(1);
    expect(byName.conversations[0]?.id).toBe("conv-john-1");
    expect(byName.statusMessage).toMatch(/1 contact/i);

    const byEmail = await searchConversationsForAdmin({
      query: "john.example@example.com",
      limit: 10,
    });
    expect(byEmail.conversations.length).toBe(1);

    vi.resetModules();
    vi.doUnmock("@/lib/connectors/ghl/config");
    vi.doUnmock("@/lib/baxter-data/ghl/resolve");
    vi.doUnmock("@/lib/connectors/ghl/resources/contacts");
    vi.doUnmock("@/lib/connectors/ghl/resources/conversations");
  });

  it("reports no email found without capability FAQ language", async () => {
    vi.resetModules();
    vi.doMock("@/lib/connectors/ghl/config", () => ({
      isGhlConfigured: () => true,
      requireGhlLocationId: () => "loc",
    }));
    vi.doMock("@/lib/baxter-data/ghl/resolve", () => ({
      resolveContact: async () => ({
        resolved: true,
        ambiguous: false,
        notFound: false,
        entity: {
          id: JOHN.id,
          name: JOHN.name,
          email: JOHN.email,
          phone: null,
          firstName: "John",
          lastName: "Example",
        },
      }),
    }));
    vi.doMock("@/lib/connectors/ghl/resources/contacts", () => ({
      searchContacts: async () => ({ contacts: [], total: 0 }),
      getContactById: async (id: string) => ({
        id,
        name: JOHN.name,
        email: JOHN.email,
        phone: null,
        firstName: "John",
        lastName: "Example",
      }),
    }));
    vi.doMock("@/lib/connectors/ghl/resources/conversations", () => ({
      listConversationsForContact: async () => [
        { id: "conv-sms-only", contactId: JOHN.id, type: "TYPE_SMS" },
      ],
      getConversationMessages: async () => ({
        messages: [FIXTURE_MESSAGES[2]!],
        hasMore: false,
      }),
      searchConversations: async () => ({ conversations: [], total: 0 }),
    }));

    const { lookupGhlConversationMessages } =
      await import("@/lib/baxter-data/ghl/conversation-lookup");
    const result = await lookupGhlConversationMessages({
      contactQuery: "John Example",
      channel: "email",
      direction: "inbound",
    });
    expect(result.ok).toBe(false);
    expect(result.failureMessage).toMatch(/didn’t find an email/i);
    expect(result.failureMessage).not.toMatch(/Yes\. I can search/i);

    vi.resetModules();
    vi.doUnmock("@/lib/connectors/ghl/config");
    vi.doUnmock("@/lib/baxter-data/ghl/resolve");
    vi.doUnmock("@/lib/connectors/ghl/resources/contacts");
    vi.doUnmock("@/lib/connectors/ghl/resources/conversations");
  });
});
