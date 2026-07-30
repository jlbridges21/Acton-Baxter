import { describe, expect, it } from "vitest";
import {
  detectRequestedGhlFields,
  primaryRequestedField,
  isPronounOrStopwordName,
} from "@/lib/baxter-data/ghl/field-aliases";
import { buildGhlQueryPlan } from "@/lib/baxter-data/ghl/query-plan";
import { buildGhlConversationContext } from "@/lib/baxter-data/ghl/conversation-state";
import { detectGhlIntent } from "@/lib/baxter-ai/ghl-intent";
import {
  buildDeterministicGhlContactFieldAnswer,
  buildDeterministicGhlOpportunityAnswer,
} from "@/lib/connectors/ghl/address";
import {
  rankOpportunitiesForContact,
  STAGE_QUESTION_RANK_POLICY,
} from "@/lib/connectors/ghl/opportunity-ranking";
import type { GhlOpportunity } from "@/lib/connectors/ghl/types";
import type { GhlReferenceData } from "@/lib/connectors/ghl/reference-data";

describe("GHL field alias registry", () => {
  it("maps email address to email, not street address", () => {
    const fields = detectRequestedGhlFields("What is his email address?");
    expect(fields).toContain("email");
    expect(fields).not.toContain("address");
    expect(primaryRequestedField(fields)).toBe("email");
  });

  it("detects email and phone together", () => {
    const fields = detectRequestedGhlFields("What is Denis Example’s email and phone number?");
    expect(fields).toEqual(expect.arrayContaining(["email", "phone"]));
  });

  it("detects stage for opportunity questions", () => {
    const fields = detectRequestedGhlFields("What stage is the Denis Example opportunity?");
    expect(fields).toContain("stage");
  });
});

describe("GHL intent name cleaning", () => {
  it("extracts contact name from stage opportunity phrasing", () => {
    const intent = detectGhlIntent("What stage is the Denis Example opportunity?");
    expect(intent.intent).toBe("opportunity_lookup");
    expect(intent.entities.contactName).toBe("Denis Example");
    expect(intent.entities.requestedField).toBe("stage");
  });

  it("maps email address field correctly", () => {
    const intent = detectGhlIntent("What is John Example’s email address?");
    expect(intent.entities.requestedField).toBe("email");
    expect(intent.intent).toBe("contact_lookup");
  });

  it("rejects pronoun as contact name", () => {
    const intent = detectGhlIntent("What is his email address?");
    expect(intent.entities.contactName).toBeUndefined();
    expect(intent.entities.requestedField).toBe("email");
  });
});

describe("GHL query plan + entity memory", () => {
  const active = buildGhlConversationContext({
    contact: {
      id: "contact-john",
      displayName: "John Example",
      email: "john@example.com",
      setAt: new Date().toISOString(),
    },
    lastRequestedFields: ["phone"],
  });

  it("inherits active entity on pronoun email-address follow-up", () => {
    const plan = buildGhlQueryPlan({
      question: "What is his email address?",
      activeGhl: active,
    });
    expect(plan.followupEntityInherited).toBe(true);
    expect(plan.entityName).toBe("John Example");
    expect(plan.entityContactId).toBe("contact-john");
    expect(plan.requestedFields).toContain("email");
    expect(plan.requestedFields).not.toContain("address");
    expect(plan.primaryField).toBe("email");
  });

  it("does not persist prior street-address field over email address", () => {
    const afterAddress = buildGhlConversationContext({
      contact: active.contact,
      lastRequestedFields: ["address"],
    });
    const plan = buildGhlQueryPlan({
      question: "What is his email address?",
      activeGhl: afterAddress,
    });
    expect(plan.primaryField).toBe("email");
    expect(plan.requestedFields).not.toContain("address");
  });

  it("resets entity when a new person is named", () => {
    const plan = buildGhlQueryPlan({
      question: "What is Petr Jordan’s latest email?",
      activeGhl: active,
    });
    expect(plan.explicitNewEntity).toBe(true);
    expect(plan.entityContactId).toBeNull();
    expect(plan.entityName?.toLowerCase()).toContain("petr");
  });

  it("asks for clarification when pronoun has no active entity", () => {
    const plan = buildGhlQueryPlan({
      question: "What is his email?",
      activeGhl: null,
    });
    expect(plan.needsEntityClarification).toBe(true);
  });

  it("treats stopword names as empty", () => {
    expect(isPronounOrStopwordName("his")).toBe(true);
    expect(isPronounOrStopwordName("John Example")).toBe(false);
  });
});

describe("GHL deterministic contact field completeness", () => {
  const contact = {
    firstName: "John",
    lastName: "Example",
    name: "John Example",
    email: "john@example.com",
    phone: "4085550100",
    address1: "123 Main St",
    city: "San Jose",
    state: "CA",
    postalCode: "95125",
    country: "US",
  };

  it("returns both email and phone when both requested", () => {
    const answer = buildDeterministicGhlContactFieldAnswer(
      "What is John Example’s email and phone number?",
      contact,
      ["email", "phone"],
    );
    expect(answer).toContain("john@example.com");
    expect(answer).toContain("4085550100");
    expect(answer).not.toContain("123 Main St");
  });

  it("returns email for email address follow-up, never street address", () => {
    const answer = buildDeterministicGhlContactFieldAnswer("What is his email address?", contact, [
      "email",
    ]);
    expect(answer).toContain("john@example.com");
    expect(answer).not.toContain("123 Main St");
  });

  it("explicitly notes missing email when only phone exists", () => {
    const answer = buildDeterministicGhlContactFieldAnswer(
      "What is John’s email and phone?",
      { ...contact, email: null },
      ["email", "phone"],
    );
    expect(answer).toContain("4085550100");
    expect(answer?.toLowerCase()).toMatch(/don.?t have.*email|does not include.*email/);
  });

  it("explicitly notes missing phone when only email exists", () => {
    const answer = buildDeterministicGhlContactFieldAnswer(
      "What is John’s email and phone?",
      { ...contact, phone: null },
      ["email", "phone"],
    );
    expect(answer).toContain("john@example.com");
    expect(answer?.toLowerCase()).toMatch(/don.?t have.*phone|does not include.*phone/);
  });
});

describe("GHL deterministic opportunity answer", () => {
  it("returns stage and pipeline from contact-linked opportunity", () => {
    const answer = buildDeterministicGhlOpportunityAnswer({
      contactName: "Denis Example",
      pipelineName: "Feasibility Package Pipeline",
      stageName: "Site Inspection Phase",
      requestedFields: ["stage"],
    });
    expect(answer).toContain("Site Inspection Phase");
    expect(answer).toContain("Feasibility Package Pipeline");
  });
});

describe("GHL opportunity ranking for stage questions", () => {
  it("prefers Feasibility Package over open Marketing for stage questions", () => {
    const refs = {
      pipelineNameById: new Map([
        ["fp", "Feasibility Package Pipeline"],
        ["mkt", "Marketing Pipeline"],
      ]),
    } as GhlReferenceData;

    const opps: GhlOpportunity[] = [
      {
        id: "opp-mkt",
        name: "Lead",
        contactId: "c1",
        pipelineId: "mkt",
        pipelineStageId: "s1",
        status: "open",
        monetaryValue: null,
        assignedTo: null,
        source: null,
        dateAdded: null,
        dateUpdated: new Date().toISOString(),
        customFields: {},
      },
      {
        id: "opp-fp",
        name: "Different Opp Name",
        contactId: "c1",
        pipelineId: "fp",
        pipelineStageId: "s2",
        status: "open",
        monetaryValue: null,
        assignedTo: null,
        source: null,
        dateAdded: null,
        dateUpdated: new Date(Date.now() - 86400000).toISOString(),
        customFields: {},
      },
    ];

    const ranked = rankOpportunitiesForContact(opps, refs, STAGE_QUESTION_RANK_POLICY);
    expect(ranked[0]?.id).toBe("opp-fp");
  });
});
