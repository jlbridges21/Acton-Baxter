import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  detectGhlIntent,
  shouldSkipSlackForGhlContactField,
  normalizeGhlQuestionText,
  stripContactNamePossessive,
} from "@/lib/baxter-ai/ghl-intent";
import {
  buildDeterministicGhlContactFieldAnswer,
  contactAddressFromGhl,
  isContactLevelGhlQuestion,
} from "@/lib/connectors/ghl/address";
import { formatCustomerSnapshot, type GhlEntityGraph } from "@/lib/connectors/ghl/entity-graph";
import { rankContactMatches } from "@/lib/connectors/ghl/normalize";
import type { GhlContact } from "@/lib/connectors/ghl/types";

/** Exact regression fixture from Stanley Quan production bug. */
export const stanleyQuanFixture: GhlContact = {
  id: "stanley-quan-contact",
  locationId: "loc",
  firstName: "Stanley",
  lastName: "Quan",
  name: "Stanley Quan",
  email: "akaltos3@gmail.com",
  phone: "(650) 823-6728",
  companyName: null,
  address1: "2050 Kent Drive",
  city: "Los Altos",
  state: "CA",
  postalCode: "94024",
  country: "US",
  source: null,
  tags: [],
  customFields: {},
  dateAdded: null,
  dateUpdated: null,
  dnd: false,
  assignedTo: null,
};

function stanleyGraph(contact: GhlContact = stanleyQuanFixture): GhlEntityGraph {
  return {
    retrievedAt: "2026-07-29T12:00:00.000Z",
    query: "Stanley Quan",
    ambiguous: false,
    clarificationMessage: null,
    opportunityAmbiguous: false,
    contact,
    opportunities: [],
    nextAppointment: null,
    recentConversation: null,
    recentMessages: [],
    customFieldLabels: {},
  };
}

describe("Stanley Quan name extraction (curly apostrophe + explicit GHL)", () => {
  it("normalizes curly apostrophes", () => {
    expect(normalizeGhlQuestionText("Stanley Quan\u2019s address")).toContain("Stanley Quan's");
    expect(stripContactNamePossessive("Stanley Quan\u2019s")).toBe("Stanley Quan");
  });

  it("extracts Stanley Quan from ASCII possessive address ask", () => {
    const d = detectGhlIntent("What is Stanley Quan's address?");
    expect(d.intent).toBe("contact_lookup");
    expect(d.entities.contactName).toBe("Stanley Quan");
    expect(d.entities.requestedField).toBe("address");
  });

  it("extracts Stanley Quan from curly possessive address ask", () => {
    const d = detectGhlIntent("What is Stanley Quan\u2019s address?");
    expect(d.intent).toBe("contact_lookup");
    expect(d.entities.contactName).toBe("Stanley Quan");
    expect(d.entities.requestedField).toBe("address");
  });

  it("extracts Stanley Quan from explicit GHL search phrasing", () => {
    const d = detectGhlIntent("search GHL for Stanley Quan\u2019s address");
    expect(d.intent).toBe("contact_lookup");
    expect(d.explicitGhl).toBe(true);
    expect(d.entities.contactName).toBe("Stanley Quan");
    expect(d.entities.requestedField).toBe("address");
  });

  it("extracts Stanley Quan from city / email phrasings", () => {
    expect(detectGhlIntent("What city is Stanley Quan in?").entities.contactName).toBe(
      "Stanley Quan",
    );
    expect(detectGhlIntent("What email do we have for Stanley Quan?").entities.contactName).toBe(
      "Stanley Quan",
    );
  });
});

describe("Stanley Quan address normalization + evidence", () => {
  it("formats address like the admin Contacts UI", () => {
    const address = contactAddressFromGhl(stanleyQuanFixture);
    expect(address.formatted).toBe("2050 Kent Drive, Los Altos, CA 94024");
    expect(address.hasStreet).toBe(true);
  });

  it("serializes address into GHL snapshot evidence", () => {
    const snapshot = formatCustomerSnapshot(stanleyGraph(), {
      question: "What is Stanley Quan\u2019s address?",
    });
    expect(snapshot).toContain("Address: 2050 Kent Drive, Los Altos, CA 94024");
    expect(snapshot).toContain("Requested field: address");
    expect(snapshot).toContain("stanley-quan-contact");
    expect(snapshot).not.toContain("Opportunity");
  });

  it("deterministic address answer matches expected production phrasing", () => {
    const answer = buildDeterministicGhlContactFieldAnswer(
      "What is Stanley Quan\u2019s address?",
      stanleyQuanFixture,
    );
    expect(answer).toBe(
      "Stanley Quan's address in GoHighLevel is 2050 Kent Drive, Los Altos, CA 94024.",
    );
  });

  it("deterministic answers for phone, email, and city", () => {
    expect(
      buildDeterministicGhlContactFieldAnswer(
        "What is Stanley Quan's phone number?",
        stanleyQuanFixture,
      ),
    ).toContain("(650) 823-6728");
    expect(
      buildDeterministicGhlContactFieldAnswer(
        "What email do we have for Stanley Quan?",
        stanleyQuanFixture,
      ),
    ).toContain("akaltos3@gmail.com");
    expect(
      buildDeterministicGhlContactFieldAnswer("What city is Stanley Quan in?", stanleyQuanFixture),
    ).toContain("Los Altos");
  });

  it("distinguishes missing street from missing record", () => {
    const cityOnly = { ...stanleyQuanFixture, address1: null };
    const answer = buildDeterministicGhlContactFieldAnswer(
      "What is Stanley Quan's address?",
      cityOnly,
    );
    expect(answer).toMatch(/lists Los Altos/i);
    expect(answer).toMatch(/no street address is saved/i);
    expect(answer).not.toMatch(/don.?t have a retrieved record/i);
  });
});

describe("name ranking among similar contacts", () => {
  it("ranks exact Stanley Quan above partial matches", () => {
    const ranked = rankContactMatches(
      [
        stanleyQuanFixture,
        { ...stanleyQuanFixture, id: "other", name: "Stanley Quantrill", lastName: "Quantrill" },
      ],
      "Stanley Quan",
    );
    expect(ranked[0]?.contact.id).toBe("stanley-quan-contact");
    expect(ranked[0]?.matchedOn).toContain("name_exact");
  });
});

describe("retrieveGhlLiveEvidence Stanley path", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    process.env.GHL_ENABLE = "true";
    process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "pit-test";
    process.env.GHL_LOCATION_ID = "loc";
  });

  it("returns deterministic address evidence and does not set opportunity ambiguity", async () => {
    vi.doMock("@/lib/connectors/ghl/config", () => ({
      isGhlConfigured: () => true,
      requireGhlLocationId: () => "loc",
      resetGhlConfigCacheForTests: () => undefined,
    }));
    vi.doMock("@/lib/connectors/ghl/entity-graph", async () => {
      const actual = await vi.importActual<typeof import("@/lib/connectors/ghl/entity-graph")>(
        "@/lib/connectors/ghl/entity-graph",
      );
      return {
        ...actual,
        resolveGhlEntityGraph: async () => stanleyGraph(),
      };
    });

    const { retrieveGhlLiveEvidence } = await import("@/lib/baxter-ai/ghl-runtime");
    const result = await retrieveGhlLiveEvidence("search GHL for Stanley Quan\u2019s address");
    expect(result.ambiguityWarning).toBeUndefined();
    expect(result.items.length).toBe(1);
    expect(result.items[0]?.contentExcerpt).toContain("2050 Kent Drive, Los Altos, CA 94024");
    expect(result.deterministicAnswer).toContain("2050 Kent Drive, Los Altos, CA 94024");
    expect(result.diagnostics?.ghlContactSearchAttempted).toBe(true);
    expect(result.diagnostics?.selectedContactId).toBe("stanley-quan-contact");
    expect(result.diagnostics?.addressPresent).toBe(true);
    expect(shouldSkipSlackForGhlContactField("search GHL for Stanley Quan\u2019s address")).toBe(
      true,
    );
  });
});

describe("Rachel address regression preserved", () => {
  it("still treats Rachel address as contact-level", () => {
    expect(
      isContactLevelGhlQuestion("What is Rachel and Genaro Redmond\u2019s full address in GHL?"),
    ).toBe(true);
    expect(isContactLevelGhlQuestion("What stage is Rachel and Genaro Redmond in?")).toBe(false);
  });
});
