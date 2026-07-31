import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";

vi.mock("@/lib/auth/session", () => ({
  requireActiveUser: vi.fn(async () => ({
    id: "user-1",
    email: "jackson.bridges@actonadu.com",
    profile: { role: "user" },
  })),
}));

vi.mock("@/lib/connectors/ghl/config", () => ({
  isGhlConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/connectors/ghl/resources/contacts", () => ({
  searchContacts: vi.fn(async () => ({
    contacts: [
      {
        id: "contact-1",
        name: "Barbara Example",
        firstName: "Barbara",
        lastName: "Example",
        email: "barbara@example.com",
        phone: "4085551212",
        city: "San Jose",
        postalCode: "95110",
        address1: "123 Main St",
        assignedTo: null,
      },
    ],
    meta: {},
  })),
  getContactById: vi.fn(),
  hydrateGhlContact: vi.fn(),
}));

vi.mock("@/lib/connectors/ghl/address", () => ({
  contactAddressFromGhl: vi.fn(() => ({
    formatted: "123 Main St, San Jose, CA 95110",
    line1: "123 Main St",
    city: "San Jose",
    state: "CA",
    postalCode: "95110",
  })),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
}));

describe("GET /api/projects/setup/contacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.E2E_TEST_AUTH_BYPASS = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    resetEnvCacheForTests();
  });

  it("returns hydrated search hits via searchContacts", async () => {
    const { GET } = await import("@/app/api/projects/setup/contacts/route");
    const { searchContacts } = await import("@/lib/connectors/ghl/resources/contacts");

    const response = await GET(
      new Request("http://localhost/api/projects/setup/contacts?q=Barbara"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      contacts: Array<{ id: string; name: string; email: string | null }>;
    };
    expect(searchContacts).toHaveBeenCalledWith({ query: "Barbara", limit: 15 });
    expect(body.contacts[0]).toMatchObject({
      id: "contact-1",
      name: "Barbara Example",
      email: "barbara@example.com",
    });
  });

  it("rejects short queries", async () => {
    const { GET } = await import("@/app/api/projects/setup/contacts/route");
    const response = await GET(new Request("http://localhost/api/projects/setup/contacts?q=a"));
    expect(response.status).toBe(400);
  });
});
