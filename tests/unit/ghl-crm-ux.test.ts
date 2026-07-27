import { beforeEach, describe, expect, it } from "vitest";
import {
  buildContactSearchBody,
  assertNoDeprecatedContactSearchBody,
  DEPRECATED_CONTACT_SEARCH_BODY_KEYS,
} from "@/lib/connectors/ghl/request-contracts";
import {
  sanitizeMessagePreview,
  labelMessageType,
  formatGhlCurrency,
  formatGhlDateRelative,
  stripHtmlToText,
} from "@/lib/connectors/ghl/present";
import {
  rankOpportunitiesForContact,
  opportunitiesNeedClarification,
} from "@/lib/connectors/ghl/opportunity-ranking";
import type { GhlOpportunity } from "@/lib/connectors/ghl/types";

beforeEach(() => {
  process.env.GHL_LOCATION_ID = "loc-acton";
});

describe("GHL CRM UX — contact search contract", () => {
  it("sends pageLimit and never limit", () => {
    const body = buildContactSearchBody({
      locationId: "loc-acton",
      query: "Barbara",
      page: 1,
      limit: 25,
    });
    expect(body.pageLimit).toBe(25);
    expect(body.query).toBe("Barbara");
    expect("limit" in body).toBe(false);
  });

  it("rejects deprecated limit body key", () => {
    expect(() => assertNoDeprecatedContactSearchBody({ locationId: "x", limit: 10 })).toThrow(
      /Deprecated/,
    );
    expect(DEPRECATED_CONTACT_SEARCH_BODY_KEYS).toContain("limit");
  });

  it("supports email and phone search bodies", () => {
    const emailBody = buildContactSearchBody({
      locationId: "loc-acton",
      email: "a@b.com",
      limit: 10,
    });
    expect(emailBody.email).toBe("a@b.com");
    expect(emailBody.pageLimit).toBe(10);

    const phoneBody = buildContactSearchBody({
      locationId: "loc-acton",
      phone: "4085551234",
      limit: 5,
    });
    expect(phoneBody.phone).toBe("4085551234");
  });

  it("omits empty query fields", () => {
    const body = buildContactSearchBody({ locationId: "loc-acton", query: "  ", limit: 10 });
    expect(body.query).toBeUndefined();
  });
});

describe("GHL CRM UX — presentation", () => {
  it("formats currency and message types", () => {
    expect(formatGhlCurrency(399999)).toBe("$399,999");
    expect(labelMessageType("TYPE_EMAIL")).toBe("Email");
    expect(labelMessageType("TYPE_SMS")).toBe("SMS");
    expect(labelMessageType("TYPE_UNKNOWN_XYZ")).toBe("Other");
  });

  it("sanitizes previews and strips HTML", () => {
    const raw =
      "<p>Hi Donna, thank you for your interest</p><br/>https://track.example.com/x?a=1\nBest regards,\nJesse";
    const preview = sanitizeMessagePreview(raw, 80);
    expect(preview).not.toContain("<p");
    expect(preview).not.toContain("https://");
    expect(preview.toLowerCase()).toContain("hi donna");
    expect(stripHtmlToText("<b>Hello</b>")).toContain("Hello");
  });

  it("formats relative timestamps", () => {
    const today = new Date();
    today.setHours(16, 22, 0, 0);
    const label = formatGhlDateRelative(today.toISOString());
    expect(label).toMatch(/Today at/i);
  });
});

describe("GHL CRM UX — opportunity ranking", () => {
  const mk = (partial: Partial<GhlOpportunity> & { id: string; name: string }): GhlOpportunity => ({
    id: partial.id,
    name: partial.name,
    pipelineId: partial.pipelineId ?? "p1",
    pipelineStageId: partial.pipelineStageId ?? "s1",
    status: partial.status ?? "open",
    monetaryValue: partial.monetaryValue ?? null,
    contactId: partial.contactId ?? "c1",
    assignedTo: partial.assignedTo ?? null,
    source: partial.source ?? null,
    dateAdded: partial.dateAdded ?? null,
    dateUpdated: partial.dateUpdated ?? new Date().toISOString(),
    customFields: {},
  });

  it("prefers project pipelines over marketing", () => {
    const refs = {
      pipelineNameById: new Map([
        ["mkt", "Marketing Pipeline"],
        ["feas", "Feasibility Package Pipeline"],
      ]),
      stageNameByKey: new Map(),
      userNameById: new Map(),
      customFieldNameById: new Map(),
      tagNameById: new Map(),
      locationId: "loc",
      pipelines: [],
      users: [],
      customFields: [],
      tags: [],
      calendars: [],
      refreshedAt: new Date().toISOString(),
    };
    const ranked = rankOpportunitiesForContact(
      [
        mk({ id: "1", name: "Marketing", pipelineId: "mkt", status: "open" }),
        mk({ id: "2", name: "Feasibility", pipelineId: "feas", status: "open" }),
      ],
      refs as never,
    );
    expect(ranked[0]?.id).toBe("2");
  });

  it("flags clarification when scores are close", () => {
    const refs = {
      pipelineNameById: new Map([
        ["a", "Design Agreement Pipeline"],
        ["b", "Feasibility Package Pipeline"],
      ]),
      stageNameByKey: new Map(),
      userNameById: new Map(),
      customFieldNameById: new Map(),
      tagNameById: new Map(),
      locationId: "loc",
      pipelines: [],
      users: [],
      customFields: [],
      tags: [],
      calendars: [],
      refreshedAt: new Date().toISOString(),
    };
    const ranked = rankOpportunitiesForContact(
      [mk({ id: "1", name: "A", pipelineId: "a" }), mk({ id: "2", name: "B", pipelineId: "b" })],
      refs as never,
    );
    expect(opportunitiesNeedClarification(ranked, refs as never)).toBe(true);
  });
});
