import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  detectGhlSnapshotFocus,
  isContactLevelGhlQuestion,
  contactAddressFromGhl,
} from "@/lib/connectors/ghl/address";
import { formatCustomerSnapshot, type GhlEntityGraph } from "@/lib/connectors/ghl/entity-graph";
import type { GhlContact } from "@/lib/connectors/ghl/types";

function rachelContact(overrides: Partial<GhlContact> = {}): GhlContact {
  return {
    id: "abc",
    locationId: "loc",
    firstName: "Rachel",
    lastName: "Redmond",
    name: "Rachel and Genaro Redmond",
    email: "rachred1@yahoo.com",
    phone: "(408) 460-6287",
    companyName: null,
    address1: "13050 Haga Dr",
    city: "San Jose",
    state: "CA",
    postalCode: "95111",
    country: "US",
    source: null,
    tags: [],
    customFields: {},
    dateAdded: null,
    dateUpdated: null,
    dnd: false,
    assignedTo: "kevin",
    ...overrides,
  };
}

function graphWithOpps(contact: GhlContact, ambiguous: boolean): GhlEntityGraph {
  return {
    retrievedAt: "2026-07-29T12:00:00.000Z",
    query: "Rachel and Genaro Redmond",
    ambiguous: false,
    clarificationMessage: ambiguous
      ? "This contact has multiple relevant opportunities:\n• Marketing Pipeline — Booked Inquiry Call\n• Feasibility Package Pipeline — Closed Lost\nWhich pipeline/stage should I use?"
      : null,
    opportunityAmbiguous: ambiguous,
    contact,
    opportunities: [
      {
        opportunity: {
          id: "o1",
          name: "Opp 1",
          pipelineId: "p1",
          pipelineStageId: "s1",
          status: "open",
          monetaryValue: 1000,
          contactId: contact.id,
          assignedTo: null,
          source: null,
          dateAdded: null,
          dateUpdated: null,
          customFields: {},
        },
        pipelineName: "Marketing Pipeline",
        stageName: "Booked Inquiry Call",
        ownerName: null,
      },
      {
        opportunity: {
          id: "o2",
          name: "Opp 2",
          pipelineId: "p2",
          pipelineStageId: "s2",
          status: "lost",
          monetaryValue: null,
          contactId: contact.id,
          assignedTo: null,
          source: null,
          dateAdded: null,
          dateUpdated: null,
          customFields: {},
        },
        pipelineName: "Feasibility Package Pipeline",
        stageName: "Closed Lost",
        ownerName: null,
      },
    ],
    nextAppointment: null,
    recentConversation: null,
    recentMessages: [],
    customFieldLabels: {},
    contactOwnerName: "Kevin Lee",
  };
}

describe("GHL contact-level address vs opportunity ambiguity", () => {
  it("treats address/phone/email/tags as contact-level", () => {
    expect(
      isContactLevelGhlQuestion("What is Rachel And Genaro Redmond full address in GHL?"),
    ).toBe(true);
    expect(isContactLevelGhlQuestion("What is Rachel’s phone?")).toBe(true);
    expect(isContactLevelGhlQuestion("What tags are on Rachel?")).toBe(true);
    expect(detectGhlSnapshotFocus("What stage is Rachel in?")).toContain("opportunity");
    expect(isContactLevelGhlQuestion("What stage is Rachel in?")).toBe(false);
  });

  it("address intent wins when pipeline is also mentioned", () => {
    expect(
      isContactLevelGhlQuestion(
        "Feasibility Package Pipeline, but I’m asking for their Address. What is Rachel And Genaro Redmond full address in GHL?",
      ),
    ).toBe(true);
  });

  it("snapshot includes street address and skips opportunity clarification for address asks", () => {
    const contact = rachelContact();
    const graph = graphWithOpps(contact, true);
    const snapshot = formatCustomerSnapshot(graph, {
      question: "What is Rachel And Genaro Redmond full address in GHL?",
    });
    expect(snapshot).toContain("13050 Haga Dr, San Jose, CA 95111");
    expect(snapshot).toContain("loaded_present");
    expect(snapshot).not.toContain("Which pipeline/stage should I use?");
    expect(contactAddressFromGhl(contact).formatted).toBe("13050 Haga Dr, San Jose, CA 95111");
  });

  it("opportunity questions still surface opportunity block when focused", () => {
    const graph = graphWithOpps(rachelContact(), true);
    const snapshot = formatCustomerSnapshot(graph, {
      question: "What stage is Rachel and Genaro Redmond in?",
    });
    expect(snapshot).toContain("Which pipeline/stage should I use?");
  });
});

describe("retrieveGhlLiveEvidence skips opp ambiguity for address", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns snapshot without ambiguityWarning for address questions", async () => {
    const contact = rachelContact();
    const graph = graphWithOpps(contact, true);

    vi.doMock("@/lib/connectors/ghl/config", () => ({
      isGhlConfigured: () => true,
    }));
    vi.doMock("@/lib/baxter-ai/ghl-intent", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/baxter-ai/ghl-intent")>();
      return {
        ...actual,
        detectGhlIntent: () => ({
          intent: "contact_lookup",
          confidence: 0.9,
          entities: {
            contactName: "Rachel And Genaro Redmond",
            requestedField: "address",
          },
          isWriteIntent: false,
          requiresConfirmation: false,
          explicitGhl: true,
        }),
      };
    });
    vi.doMock("@/lib/connectors/ghl/entity-graph", async () => {
      const actual = await vi.importActual<typeof import("@/lib/connectors/ghl/entity-graph")>(
        "@/lib/connectors/ghl/entity-graph",
      );
      return {
        ...actual,
        resolveGhlEntityGraph: async () => graph,
      };
    });

    const { retrieveGhlLiveEvidence } = await import("@/lib/baxter-ai/ghl-runtime");
    const result = await retrieveGhlLiveEvidence(
      "What is Rachel And Genaro Redmond full address in GHL?",
    );
    expect(result.ambiguityWarning).toBeUndefined();
    expect(result.contextText).toContain("13050 Haga Dr, San Jose, CA 95111");
    expect(result.items[0]?.citationLabel).toContain("Rachel and Genaro Redmond");
  });

  it("still returns ambiguityWarning for stage questions", async () => {
    const graph = graphWithOpps(rachelContact(), true);
    vi.doMock("@/lib/connectors/ghl/config", () => ({
      isGhlConfigured: () => true,
    }));
    vi.doMock("@/lib/baxter-ai/ghl-intent", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/baxter-ai/ghl-intent")>();
      return {
        ...actual,
        detectGhlIntent: () => ({
          intent: "opportunity_lookup",
          confidence: 0.9,
          entities: {
            contactName: "Rachel And Genaro Redmond",
            requestedField: "stage",
          },
          isWriteIntent: false,
          requiresConfirmation: false,
          explicitGhl: true,
        }),
      };
    });
    vi.doMock("@/lib/connectors/ghl/entity-graph", async () => {
      const actual = await vi.importActual<typeof import("@/lib/connectors/ghl/entity-graph")>(
        "@/lib/connectors/ghl/entity-graph",
      );
      return {
        ...actual,
        resolveGhlEntityGraph: async () => graph,
      };
    });

    const { retrieveGhlLiveEvidence } = await import("@/lib/baxter-ai/ghl-runtime");
    const result = await retrieveGhlLiveEvidence("What stage is Rachel and Genaro Redmond in?");
    expect(result.ambiguityWarning).toContain("Which pipeline/stage");
  });
});
