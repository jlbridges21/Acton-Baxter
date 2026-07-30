import { describe, expect, it } from "vitest";
import { deriveAnswerTypeLabel, answerModeLabel } from "@/lib/baxter-ai/classify";
import { buildBaxterSlackText } from "@/lib/slack/format";
import type { BaxterAnswer, BaxterSourceReference } from "@/lib/baxter-ai/types";
import {
  contactAddressFromGhl,
  detectGhlSnapshotFocus,
  formatGhlAddressMultiline,
} from "@/lib/connectors/ghl/address";
import { normalizeContact } from "@/lib/connectors/ghl/normalize";
import { formatCustomerSnapshot, type GhlEntityGraph } from "@/lib/connectors/ghl/entity-graph";

function source(
  kind: BaxterSourceReference["sourceKind"],
  title = "Source",
): BaxterSourceReference {
  return {
    title,
    sourceName: title,
    category: null,
    sourceUrl: null,
    citationLabel: title,
    sourceKind: kind,
    openLabel: "Open",
    lastUpdated: null,
    relevanceScore: 1,
    availability: "available",
  };
}

describe("deriveAnswerTypeLabel", () => {
  it("maps knowledge to Approved Acton knowledge", () => {
    expect(
      deriveAnswerTypeLabel({
        answerMode: "grounded",
        sources: [source("knowledge_entry")],
      }),
    ).toBe("Approved Acton knowledge");
  });

  it("maps Slack to Slack conversational update (not Approved Acton knowledge)", () => {
    expect(
      deriveAnswerTypeLabel({
        answerMode: "grounded",
        sources: [source("slack", "Jess in #project-management")],
      }),
    ).toBe("Slack conversational update");
  });

  it("maps GHL to Live Acton data", () => {
    expect(
      deriveAnswerTypeLabel({
        answerMode: "grounded",
        sources: [source("gohighlevel", "GoHighLevel — Rachel")],
      }),
    ).toBe("Live Acton data");
  });

  it("maps PEM to PEM sales intelligence", () => {
    expect(
      deriveAnswerTypeLabel({
        answerMode: "grounded",
        sources: [source("pem_neat")],
      }),
    ).toBe("PEM sales intelligence");
  });

  it("maps general mode with no sources to General knowledge", () => {
    expect(deriveAnswerTypeLabel({ answerMode: "general", sources: [] })).toBe("General knowledge");
  });

  it("maps Slack recall no-result clarification — not General knowledge", () => {
    expect(deriveAnswerTypeLabel({ answerMode: "clarification", sources: [] })).toBe(
      "Clarification",
    );
    expect(deriveAnswerTypeLabel({ answerMode: "clarification", sources: [] })).not.toBe(
      "General knowledge",
    );
  });

  it("maps successful Slack recall cite to Slack conversational update", () => {
    expect(
      deriveAnswerTypeLabel({
        answerMode: "grounded",
        sources: [source("slack", "Milan in #baxter")],
      }),
    ).toBe("Slack conversational update");
  });

  it("joins two kinds with +", () => {
    expect(
      deriveAnswerTypeLabel({
        answerMode: "mixed",
        sources: [source("rulebook"), source("slack")],
      }),
    ).toBe("Approved Acton knowledge + Slack conversational update");
  });

  it("uses Mixed Acton sources for three+ kinds", () => {
    expect(
      deriveAnswerTypeLabel({
        answerMode: "mixed",
        sources: [source("knowledge_entry"), source("gohighlevel"), source("slack")],
      }),
    ).toBe("Mixed Acton sources");
  });

  it("does not trust grounded mode alone when sources are Slack", () => {
    // Legacy answerModeLabel would wrongly say Approved Acton knowledge
    expect(answerModeLabel("grounded")).toBe("Approved Acton knowledge");
    expect(
      deriveAnswerTypeLabel({
        answerMode: "grounded",
        sources: [source("slack")],
      }),
    ).toBe("Slack conversational update");
  });
});

describe("Slack answer type footer", () => {
  it("labels Slack evidence correctly", () => {
    const answer: BaxterAnswer = {
      answer: "Jess’s latest message was about the timeline.",
      conversationId: "c1",
      confidence: "high",
      insufficientKnowledge: false,
      answerMode: "grounded",
      sources: [source("slack", "Jess — #project-management")],
    };
    const text = buildBaxterSlackText(answer);
    expect(text).toContain("Answer type: Slack conversational update");
    expect(text).not.toContain("Answer type: Approved Acton knowledge");
  });

  it("labels GHL evidence as Live Acton data", () => {
    const answer: BaxterAnswer = {
      answer: "123 Main St, San Jose, CA 95125",
      conversationId: "c1",
      confidence: "high",
      insufficientKnowledge: false,
      answerMode: "grounded",
      sources: [source("gohighlevel", "GoHighLevel — Rachel Redmond")],
    };
    expect(buildBaxterSlackText(answer)).toContain("Answer type: Live Acton data");
  });
});

describe("GHL address normalization", () => {
  it("preserves address1/city/state/postal from raw payload aliases", () => {
    const contact = normalizeContact({
      id: "c1",
      firstName: "Rachel",
      lastName: "Redmond",
      name: "Rachel and Genaro Redmond",
      address1: "123 Main St",
      city: "San Jose",
      state: "CA",
      postalCode: "95125",
      country: "US",
      tags: ["Feasibility Package Paid", "Bay Area"],
      assignedTo: "xLjUvaS0I7P0oYlYAbOQ",
      source: "Facebook",
      customFields: [{ id: "abc123", value: "San Jose" }],
    });

    expect(contact.address1).toBe("123 Main St");
    const address = contactAddressFromGhl(contact);
    expect(address.hasStreet).toBe(true);
    expect(address.formatted).toBe("123 Main St, San Jose, CA 95125");
    expect(formatGhlAddressMultiline(address)).toContain("123 Main St");
    expect(formatGhlAddressMultiline(address)).toContain("San Jose, CA 95125");
  });

  it("accepts address alias when address1 is absent", () => {
    const contact = normalizeContact({
      id: "c2",
      address: "456 Oak Ave",
      city: "Oakland",
      state: "CA",
      zip: "94601",
    });
    expect(contact.address1).toBe("456 Oak Ave");
    expect(contact.postalCode).toBe("94601");
    expect(contactAddressFromGhl(contact).formatted).toBe("456 Oak Ave, Oakland, CA 94601");
  });

  it("does not invent street when only city exists", () => {
    const address = contactAddressFromGhl({
      address1: null,
      city: "San Jose",
      state: "CA",
      postalCode: null,
      country: null,
    });
    expect(address.hasStreet).toBe(false);
    expect(address.present).toBe(true);
    expect(address.formatted).toBe("San Jose, CA");
  });
});

describe("formatCustomerSnapshot address focus", () => {
  const baseGraph = (contactOverrides: Record<string, unknown> = {}): GhlEntityGraph => ({
    retrievedAt: "2026-07-23T12:00:00.000Z",
    query: "Rachel Redmond",
    ambiguous: false,
    clarificationMessage: null,
    opportunityAmbiguous: false,
    contact: {
      id: "c1",
      locationId: "loc",
      firstName: "Rachel",
      lastName: "Redmond",
      name: "Rachel and Genaro Redmond",
      email: "rachel@example.com",
      phone: null,
      companyName: null,
      address1: null,
      city: "San Jose",
      state: "CA",
      postalCode: null,
      country: null,
      source: null,
      tags: ["Bay Area"],
      customFields: { abc123: "San Jose" },
      dateAdded: null,
      dateUpdated: null,
      dnd: false,
      assignedTo: "xLj...",
      ...contactOverrides,
    },
    opportunities: [],
    nextAppointment: null,
    recentConversation: null,
    recentMessages: [],
    customFieldLabels: { abc123: "Lead City" },
    contactOwnerName: "Kevin Lee",
  });

  it("includes street address when present", () => {
    const snapshot = formatCustomerSnapshot(
      baseGraph({ address1: "123 Main St", postalCode: "95125" }),
      { question: "What is Rachel Redmond’s address in GHL?" },
    );
    expect(snapshot).toContain("Address: 123 Main St, San Jose, CA 95125");
    expect(snapshot).toContain("loaded_present");
  });

  it("states street missing when only city is saved", () => {
    const snapshot = formatCustomerSnapshot(baseGraph(), {
      question: "What is Rachel Redmond’s address in GHL?",
    });
    expect(snapshot).toContain("San Jose");
    expect(snapshot).toContain("loaded_missing_street");
    expect(snapshot).toContain("no street address");
  });

  it("resolves custom field labels and owner on general snapshot", () => {
    const snapshot = formatCustomerSnapshot(baseGraph(), {
      question: "Tell me about Rachel Redmond in GHL",
    });
    expect(snapshot).toContain("Lead City: San Jose");
    expect(snapshot).not.toContain("abc123:");
    expect(snapshot).toContain("Owner: Kevin Lee");
    expect(snapshot).toContain("Tags: Bay Area");
  });

  it("detects address focus from question", () => {
    expect(detectGhlSnapshotFocus("What is their street address?")).toContain("address");
    expect(detectGhlSnapshotFocus("Who owns Rachel?")).toContain("owner");
  });
});
