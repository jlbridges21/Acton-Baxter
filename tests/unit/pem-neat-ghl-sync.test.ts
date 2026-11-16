import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILDERTREND_FIELD_DEFS } from "@/lib/pem-neat/buildertrend-display";
import {
  buildPemNeatGhlPayload,
  countFilledGhlFields,
  PEM_NEAT_GHL_FIELD_MAP,
  toPayloadKey,
} from "@/lib/pem-neat/ghl-sync-payload";
import { getPemNeatGhlWebhookUrl, postPemNeatToGhlWebhook } from "@/lib/pem-neat/ghl-sync";
import { buildertrendFieldsSchema } from "@/lib/pem-neat/schemas";

/** The mapping Acton supplied: Baxter BuilderTrend label → GHL contact custom field. */
const EXPECTED_GHL_NAMES = [
  "JT - Notes for internal users",
  "JT - Square Feet",
  "JT - Customer Budget",
  "JT - Budget Context",
  "JT - Customer Story",
  "JT - Customer Pain 1",
  "JT - Customer Pain",
  "JT - Customer Priorities",
  "JT - Design Handoff",
  "JT - Decision Making Process",
  "JT - Decision dynamics",
  "JT - Known concerns or fears",
  "JT - Must-have features",
  "JT - Site constraints",
  "JT - Soil / utility notes",
  "JT - Level of involvement",
  "JT - Internal Strategy Notes",
  "JT - Project Intelligence",
  "JT - Schedule Goals",
  "JT - Preferred Contact Method",
  "JT - Sales Commitments",
  "JT - Personality Traits",
  "JT - Assumptions During Sales",
  "JT - Scope Clarifications",
  "JT - Bed / Bath count",
  "JT - Accessibility Requirement",
  "JT - City / zoning feedback",
  "JT - Access/construction issue",
  "JT - Responsiveness expected",
  "JT - Next Steps",
  "JT - Recommended BR Models",
  "JT - Project Type",
];

const contact = { contactId: "abc123", email: "pat@example.com", phone: null, name: "Pat Doe" };

function payloadFor(partial: Record<string, unknown>) {
  return buildPemNeatGhlPayload({
    pemNeatId: "neat-1",
    prospectName: "Pat Doe",
    salesperson: "Sam Seller",
    meetingDate: "2026-11-10",
    fields: buildertrendFieldsSchema.parse(partial),
    contact,
    now: new Date("2026-11-16T12:00:00Z"),
  });
}

describe("PEM NEAT → GHL field mapping", () => {
  it("maps all 32 BuilderTrend fields to the supplied GHL field names, in order", () => {
    expect(PEM_NEAT_GHL_FIELD_MAP.map((m) => m.ghlFieldName)).toEqual(EXPECTED_GHL_NAMES);
    expect(PEM_NEAT_GHL_FIELD_MAP).toHaveLength(BUILDERTREND_FIELD_DEFS.length);
  });

  it("produces unique, workflow-safe payload keys", () => {
    const keys = PEM_NEAT_GHL_FIELD_MAP.map((m) => m.payloadKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^jt_[a-z0-9_]+$/);
    expect(toPayloadKey("JT - Soil / utility notes")).toBe("jt_soil_utility_notes");
    expect(toPayloadKey("JT - Customer Pain 1")).toBe("jt_customer_pain_1");
  });
});

describe("buildPemNeatGhlPayload", () => {
  it("includes contact identifiers, metadata and every field (blank when unknown)", () => {
    const payload = payloadFor({ customerStory: "Wants mom nearby", squareFeet: 600 });
    expect(payload.contact_id).toBe("abc123");
    expect(payload.email).toBe("pat@example.com");
    expect(payload.synced_at).toBe("2026-11-16T12:00:00.000Z");
    expect(payload.jt_customer_story).toBe("Wants mom nearby");
    expect(payload.jt_square_feet).toBe("600");
    expect(payload.jt_next_steps).toBe("");
    expect(Object.keys(payload.fields_by_ghl_name)).toEqual(EXPECTED_GHL_NAMES);
    expect(payload.fields_by_ghl_name["JT - Customer Story"]).toBe("Wants mom nearby");
  });

  it("formats budget as a plain number and priorities as a comma list", () => {
    const payload = payloadFor({
      customerBudget: 400000,
      customerPriorities: ["Cost", "Other"],
      customerPrioritiesOther: "Privacy",
      projectType: "Other",
      projectTypeOther: "Duplex",
    });
    expect(payload.jt_customer_budget).toBe("400000");
    expect(payload.jt_customer_priorities).toBe("Cost, Other — Privacy");
    expect(payload.jt_project_type).toBe("Other — Duplex");
  });

  it("counts filled fields", () => {
    expect(countFilledGhlFields(buildertrendFieldsSchema.parse({}))).toBe(0);
    expect(
      countFilledGhlFields(buildertrendFieldsSchema.parse({ customerStory: "x", squareFeet: 1 })),
    ).toBe(2);
  });
});

describe("postPemNeatToGhlWebhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("posts JSON to the configured webhook", async () => {
    vi.stubEnv("PEM_NEAT_GHL_SYNC", "");
    vi.stubEnv("PEM_NEAT_GHL_WEBHOOK_URL", "https://hooks.example.test/pem");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const payload = payloadFor({ customerStory: "x" });
    await postPemNeatToGhlWebhook(payload, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.example.test/pem");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body)).jt_customer_story).toBe("x");
  });

  it("defaults to the Acton GHL workflow webhook", () => {
    vi.stubEnv("PEM_NEAT_GHL_SYNC", "");
    vi.stubEnv("PEM_NEAT_GHL_WEBHOOK_URL", "");
    expect(getPemNeatGhlWebhookUrl()).toMatch(
      /^https:\/\/services\.leadconnectorhq\.com\/hooks\/.+\/webhook-trigger\//,
    );
  });

  it("is disabled by PEM_NEAT_GHL_SYNC=false and never calls fetch", async () => {
    vi.stubEnv("PEM_NEAT_GHL_SYNC", "false");
    const fetchImpl = vi.fn();
    await expect(
      postPemNeatToGhlWebhook(payloadFor({}), fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: "GHL_SYNC_DISABLED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces GHL rejections as errors", async () => {
    vi.stubEnv("PEM_NEAT_GHL_SYNC", "");
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(
      postPemNeatToGhlWebhook(payloadFor({}), fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: "GHL_SYNC_REJECTED" });
  });
});
