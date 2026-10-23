/**
 * BambooHR integration (synthetic company "acmesynthetic"): OAuth, token refresh, read-only
 * data access, identity links, access control, Sam tools, and source attribution.
 * Every HTTP call goes to a fake BambooHR; nothing real is contacted and nothing is written.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emails = vi.hoisted(() => ({ map: new Map<string, string>() }));
vi.mock("@/lib/auth/load-profile-display", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/load-profile-display")>()),
  loadAuthEmailsByUserIds: async (ids: string[]) =>
    new Map(ids.filter((i) => emails.map.has(i)).map((i) => [i, emails.map.get(i)!])),
}));

import { finalizeResult } from "@/lib/agents/executor";
import { agentDb, eq, selectOne } from "@/lib/agents/store";
import { getTool } from "@/lib/agents/tools";
import type { Requester } from "@/lib/agents/types";
import { getBambooAccess, setReadableCustomFields } from "@/lib/bamboohr/access";
import { runDiagnostics } from "@/lib/bamboohr/capabilities";
import { setBambooSleepForTests } from "@/lib/bamboohr/client";
import {
  completeAuthorization,
  disconnect,
  getConnection,
  keepAlive,
  publicConnection,
  setBambooFetcherForTests,
  startAuthorization,
  type ConnectionRow,
} from "@/lib/bamboohr/connection";
import { isSensitiveField, readableFieldIds } from "@/lib/bamboohr/fields";
import { confirmLink, rejectOrUnlink, suggestLinksByEmail } from "@/lib/bamboohr/identity";
import { describeSource } from "@/lib/bamboohr/provenance";
import { FORBIDDEN_SCOPE, SCOPE_GROUPS, scopesFor } from "@/lib/bamboohr/scopes";
import {
  getEmployeeFields,
  listEmployees,
  resetBambooFieldCacheForTests,
} from "@/lib/bamboohr/service";
import { employeeView } from "@/lib/bamboohr/views";
import { assertBambooWriteAllowed, BAMBOOHR_WRITES_ENABLED } from "@/lib/bamboohr/writes";
import { resetOpsOrgForTests, getOpsAccess, setDecision } from "@/lib/ops/org";
import { getReportStore } from "@/lib/research/report-store";
import { ADMIN_ID, EMPLOYEE_ID, HR_ID, setupAgentTestEnv } from "./agents-test-helpers";

const CEO_ID = "00000000-0000-4000-8000-0000000000b1";
const COO_ID = "00000000-0000-4000-8000-0000000000b2";
const OTHER_ID = "00000000-0000-4000-8000-0000000000e2";
const DOMAIN = "acmesynthetic";
const req = (
  id: string | null,
  role = "user",
  via: Requester["verifiedVia"] = "web_session",
): Requester => ({ userId: id, role, departmentId: null, label: "Tester", verifiedVia: via });

type Call = { url: string; method: string; body: string; auth: string };
let calls: Call[] = [];
let tokenCounter = 0;
let grantedScope = "";
let apiOverride: ((c: Call) => Response | null) | null = null;
let refreshFails = false;

type FakeEmployee = {
  firstName: string;
  lastName: string;
  workEmail: string;
  [field: string]: string;
};
const EMPLOYEES: Record<string, FakeEmployee> = {
  "101": {
    firstName: "Avery",
    lastName: "Synthetic",
    displayName: "Avery Synthetic",
    jobTitle: "Project Manager",
    department: "Operations",
    supervisor: "Morgan COO",
    hireDate: "2024-03-04",
    workEmail: "eli@acme.test",
    status: "Active",
    payRate: "99.00 USD",
    ssn: "000-00-0000",
  },
  "102": {
    firstName: "Jordan",
    lastName: "Synthetic",
    displayName: "Jordan Synthetic",
    jobTitle: "Estimator",
    department: "Preconstruction",
    supervisor: "Avery Synthetic",
    hireDate: "2025-01-06",
    workEmail: "jordan@acme.test",
    status: "Active",
  },
  "103": {
    firstName: "Jordan",
    lastName: "Doppel",
    displayName: "Jordan Doppel",
    jobTitle: "Carpenter",
    department: "Field",
    workEmail: "jordan@acme.test",
    status: "Active",
  },
};

function fakeBamboo(c: Call): Response {
  const u = new URL(c.url);
  expect(u.hostname).toBe(`${DOMAIN}.bamboohr.com`);
  if (u.pathname === "/token.php" && u.searchParams.get("request") === "token") {
    const body = c.body.startsWith("{")
      ? JSON.parse(c.body)
      : Object.fromEntries(new URLSearchParams(c.body));
    if (body.grant_type === "refresh_token" && refreshFails)
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    if (body.grant_type === "authorization_code" && body.code !== "good-code")
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    tokenCounter++;
    return Response.json({
      access_token: `access-${tokenCounter}`,
      refresh_token: `refresh-${tokenCounter}`,
      expires_in: 3600,
      token_type: "Bearer",
      scope: grantedScope,
      companyDomain: DOMAIN,
      id_token: "x",
    });
  }
  if (u.pathname === "/token.php" && u.searchParams.get("request") === "userInfo")
    return Response.json({ sub: "5", email: "coo@acme.test", company_id: "77" });
  const override = apiOverride?.(c);
  if (override) return override;
  if (u.pathname === "/api/v1/company_information")
    return Response.json({
      legalName: "Acme Synthetic LLC",
      displayName: "Acme Synthetic",
      domain: DOMAIN,
      timezone: "America/Los_Angeles",
    });
  if (u.pathname === "/api/v1/meta/fields")
    return Response.json([
      { id: 1, name: "Job title", type: "list", alias: "jobTitle" },
      { id: 4001, name: "Tool allowance", type: "text" },
      { id: 4002, name: "Pay rate", type: "currency", alias: "payRate" },
    ]);
  if (u.pathname === "/api/v1/employees") {
    const filterLast = u.searchParams.get("filter[lastName]");
    const filterFirst = u.searchParams.get("filter[firstName]");
    const filterEmail = u.searchParams.get("filter[workEmail]");
    let rows = Object.entries(EMPLOYEES).map(([id, e]) => ({
      employeeId: Number(id),
      ...e,
      jobTitleName: e.jobTitle,
      _restrictedFields: [],
    }));
    if (filterLast)
      rows = rows.filter((r) => r.lastName.toLowerCase().includes(filterLast.toLowerCase()));
    if (filterFirst)
      rows = rows.filter((r) => r.firstName.toLowerCase().includes(filterFirst.toLowerCase()));
    if (filterEmail) rows = rows.filter((r) => r.workEmail === filterEmail);
    const limit = Number(u.searchParams.get("page[limit]") ?? 250);
    const after = Number(u.searchParams.get("page[after]") ?? 0);
    const page = rows.slice(after, after + limit);
    return Response.json({
      data: page,
      meta: {
        total: rows.length,
        page: {
          limit,
          nextCursor: after + limit < rows.length ? String(after + limit) : null,
          prevCursor: null,
        },
      },
    });
  }
  const m = /^\/api\/v1\/employees\/(\d+)(\/.*)?$/.exec(u.pathname);
  if (m) {
    const [, id, rest] = m;
    if (id === "999") return new Response("", { status: 403 });
    const e = EMPLOYEES[id!];
    if (!e) return new Response("", { status: 404 });
    if (rest === "/files/view")
      return Response.json({
        employee: { id },
        categories: [
          {
            id: 1,
            name: "Signed Documents",
            files: [
              {
                id: 9,
                name: "Offer letter.pdf",
                size: 1000,
                dateCreated: "2025-01-02T00:00:00Z",
                shareWithEmployee: "yes",
              },
            ],
          },
        ],
      });
    if (rest === "/onboarding-experiences")
      return Response.json({
        onboardingExperiences: [
          { id: 5, employeeId: Number(id), newHirePacketId: 5, status: "sent" },
        ],
      });
    // BambooHR returns requested fields, silently dropping unknown ones (and here also leaking a sensitive one to prove we strip it).
    const fields = (u.searchParams.get("fields") ?? "").split(",");
    const out: Record<string, string> = { id: id!, payRate: e.payRate ?? "" };
    for (const f of fields) if (f in e) out[f] = e[f]!;
    return Response.json(out);
  }
  return new Response("", { status: 404 });
}

async function bootstrap() {
  const admin = await getOpsAccess(req(ADMIN_ID, "admin"));
  await setDecision({
    key: "ceo_account",
    status: "confirmed",
    value: CEO_ID,
    access: admin,
    actorLabel: "Admin",
  });
  const ceo = await getOpsAccess(req(CEO_ID));
  await setDecision({
    key: "coo_account",
    status: "confirmed",
    value: COO_ID,
    access: ceo,
    actorLabel: "CEO",
  });
  await setDecision({
    key: "hr_admins",
    status: "confirmed",
    value: [HR_ID],
    access: ceo,
    actorLabel: "CEO",
  });
}

async function connect(scope = scopesFor([]).join(" ")): Promise<ConnectionRow> {
  grantedScope = scope;
  const { url } = await startAuthorization({ userId: COO_ID, optionalGroups: [] });
  const state = new URL(url).searchParams.get("state")!;
  return completeAuthorization({ code: "good-code", state, userId: COO_ID, actorLabel: "COO" });
}

beforeEach(async () => {
  await setupAgentTestEnv();
  resetOpsOrgForTests();
  resetBambooFieldCacheForTests();
  const now = new Date().toISOString();
  for (const [id, full_name] of [
    [CEO_ID, "Casey CEO"],
    [COO_ID, "Morgan COO"],
    [OTHER_ID, "Olive Other"],
  ] as const) {
    await getReportStore().ensureProfile({
      id,
      full_name,
      role: "user",
      created_at: now,
      updated_at: now,
    });
  }
  process.env.BAMBOOHR_CLIENT_ID = "synthetic-client-id";
  process.env.BAMBOOHR_CLIENT_SECRET = "synthetic-client-secret";
  process.env.BAMBOOHR_COMPANY_DOMAIN = DOMAIN;
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "synthetic-test-encryption-key";
  delete process.env.BAMBOOHR_REDIRECT_URI;
  calls = [];
  tokenCounter = 0;
  apiOverride = null;
  refreshFails = false;
  emails.map = new Map();
  setBambooSleepForTests(async () => undefined);
  setBambooFetcherForTests(async (url, init) => {
    const headers = new Headers(init.headers);
    const c = {
      url,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : "",
      auth: headers.get("authorization") ?? "",
    };
    calls.push(c);
    return fakeBamboo(c);
  });
});

afterEach(() => {
  setBambooFetcherForTests(null);
  setBambooSleepForTests(null);
});

describe("scopes and field policy", () => {
  it("requests least-privilege read scopes with offline_access, and never write or sensitive scopes", () => {
    const s = scopesFor(["files", "onboarding", "custom"]);
    expect(s).toEqual(
      expect.arrayContaining([
        "openid",
        "email",
        "company_id",
        "offline_access",
        "company:info",
        "employee:name",
        "employee:job",
        "employee:contact",
        "employee_directory",
        "field",
        "employee:file",
        "onboarding",
        "employee:custom_fields",
      ]),
    );
    expect(s.some((x) => FORBIDDEN_SCOPE.test(x))).toBe(false);
    expect(
      SCOPE_GROUPS.flatMap((g) => g.scopes).some((x) =>
        /\.write|compensation|protected_info|identification/.test(x),
      ),
    ).toBe(false);
    expect(scopesFor([])).not.toContain("employee:file");
  });

  it("never requests sensitive fields, even if custom-allowlisted", () => {
    const f = readableFieldIds(
      ["basic", "job", "contact"],
      ["toolAllowance", "payRate", "homeAddress", "dateOfBirth", "customShirtSize"],
    );
    expect(f).toContain("toolAllowance");
    expect(f).toContain("customShirtSize");
    for (const bad of ["payRate", "homeAddress", "dateOfBirth", "ssn", "mobilePhone", "homeEmail"])
      expect(f).not.toContain(bad);
    for (const ok of [
      "jobTitle",
      "department",
      "hireDate",
      "workEmail",
      "status",
      "employmentHistoryStatus",
    ])
      expect(isSensitiveField(ok)).toBe(false);
  });
});

describe("OAuth connection", () => {
  it("builds the documented authorize URL with a CSRF state and the exact redirect URI", async () => {
    const { url, scopes } = await startAuthorization({
      userId: COO_ID,
      optionalGroups: ["onboarding"],
    });
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(`https://${DOMAIN}.bamboohr.com/authorize.php`);
    expect(u.searchParams.get("request")).toBe("authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("synthetic-client-id");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://baxter.example.com/api/integrations/bamboohr/oauth/callback",
    );
    expect(u.searchParams.get("state")!.length).toBeGreaterThan(30);
    expect(url).toContain(`scope=${scopes.map(encodeURIComponent).join("+")}`);
    expect(url).not.toContain("synthetic-client-secret");
  });

  it("rejects unknown, reused, expired-user, or cross-user states and bad codes", async () => {
    await expect(
      completeAuthorization({
        code: "good-code",
        state: "forged",
        userId: COO_ID,
        actorLabel: "COO",
      }),
    ).rejects.toThrow(/Unknown connection request/);
    const { url } = await startAuthorization({ userId: COO_ID, optionalGroups: [] });
    const state = new URL(url).searchParams.get("state")!;
    await expect(
      completeAuthorization({ code: "good-code", state, userId: HR_ID, actorLabel: "HR" }),
    ).rejects.toThrow(/different Baxter user/);
    const { url: url2 } = await startAuthorization({ userId: COO_ID, optionalGroups: [] });
    const state2 = new URL(url2).searchParams.get("state")!;
    await expect(
      completeAuthorization({ code: "bad-code", state: state2, userId: COO_ID, actorLabel: "COO" }),
    ).rejects.toThrow(/refused the authorization/);
    await expect(
      completeAuthorization({
        code: "good-code",
        state: state2,
        userId: COO_ID,
        actorLabel: "COO",
      }),
    ).rejects.toThrow(/already used/);
  });

  it("stores tokens encrypted, records granted and missing scopes, and never exposes tokens", async () => {
    const row = await connect(
      scopesFor([])
        .filter((s) => s !== "employee:contact")
        .join(" "),
    );
    expect(row.status).toBe("connected");
    expect(row.company_id).toBe("77");
    expect(row.connected_email).toBe("coo@acme.test");
    expect(row.encrypted_access_token).not.toContain("access-1");
    expect(row.encrypted_refresh_token).not.toContain("refresh-1");
    const pub = publicConnection(row)!;
    expect(pub.missingScopes).toEqual(["employee:contact"]);
    expect(JSON.stringify(pub)).not.toMatch(/access-1|refresh-1|encrypted/);
    expect(pub.hasRefreshToken).toBe(true);
  });

  it("refuses a different BambooHR company than the one configured", async () => {
    grantedScope = "openid";
    const { url } = await startAuthorization({ userId: COO_ID, optionalGroups: [] });
    setBambooFetcherForTests(async (u) =>
      u.includes("request=token")
        ? Response.json({
            access_token: "x",
            expires_in: 3600,
            scope: "openid",
            companyDomain: "someoneelse",
          })
        : new Response("", { status: 404 }),
    );
    await expect(
      completeAuthorization({
        code: "good-code",
        state: new URL(url).searchParams.get("state")!,
        userId: COO_ID,
        actorLabel: "COO",
      }),
    ).rejects.toThrow(/configured for "acmesynthetic"/);
    expect(await getConnection()).toBeNull();
  });

  it("refreshes expired tokens, retries a 401 once, and asks for reauthorization when refresh fails", async () => {
    await connect();
    const conn = (await getConnection())!;
    await agentDb().update("bamboohr_connections", [eq("id", conn.id)], {
      access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    await listEmployees({ limit: 1 });
    const apiCall = calls.filter((c) => c.url.includes("/api/v1/")).at(-1)!;
    expect(apiCall.auth).toBe("Bearer access-2");
    expect((await getConnection())!.last_refresh_at).not.toBeNull();

    let first = true;
    apiOverride = (c) =>
      c.url.includes("/company_information") && first
        ? ((first = false), new Response("", { status: 401 }))
        : null;
    const { getCompanyInfo } = await import("@/lib/bamboohr/service");
    expect((await getCompanyInfo()).data.displayName).toBe("Acme Synthetic");

    refreshFails = true;
    await agentDb().update("bamboohr_connections", [eq("id", conn.id)], {
      access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    await expect(listEmployees()).rejects.toThrow(/needs to be reauthorized/);
    expect((await getConnection())!.status).toBe("reauthorization_required");
  });

  it("retries rate limits and outages with backoff, then gives a clear message", async () => {
    await connect();
    let n = 0;
    apiOverride = (c) =>
      c.url.includes("/company_information")
        ? n++ < 2
          ? new Response("", { status: 429, headers: { "retry-after": "1" } })
          : null
        : null;
    const { getCompanyInfo } = await import("@/lib/bamboohr/service");
    expect((await getCompanyInfo()).data.legalName).toBe("Acme Synthetic LLC");
    apiOverride = (c) =>
      c.url.includes("/company_information") ? new Response("", { status: 503 }) : null;
    await expect(getCompanyInfo()).rejects.toThrow(/temporarily unavailable/);
  });

  it("keeps the refresh token alive from the sweep and deletes tokens on disconnect", async () => {
    await connect();
    const conn = (await getConnection())!;
    expect(await keepAlive()).toBe("skipped");
    await agentDb().update("bamboohr_connections", [eq("id", conn.id)], {
      last_refresh_at: new Date(Date.now() - 25 * 3600_000).toISOString(),
    });
    expect(await keepAlive()).toBe("refreshed");
    await disconnect({ userId: COO_ID, actorLabel: "COO" });
    const gone = (await getConnection())!;
    expect(gone.status).toBe("disconnected");
    expect(gone.encrypted_access_token).toBeNull();
    expect(gone.encrypted_refresh_token).toBeNull();
    await expect(listEmployees()).rejects.toThrow(/isn't connected/);
  });
});

describe("read-only data access", () => {
  it("pages through employees and requests only explicit, permitted fields", async () => {
    await connect();
    const page1 = await listEmployees({ limit: 2 });
    expect(page1.data.employees.map((e) => e.name)).toEqual([
      "Avery Synthetic",
      "Jordan Synthetic",
    ]);
    expect(page1.data.nextCursor).toBe("2");
    const page2 = await listEmployees({ limit: 2, after: page1.data.nextCursor });
    expect(page2.data.employees).toHaveLength(1);
    expect(page1.source).toMatchObject({
      provider: "bamboohr",
      entityType: "Employee list",
      freshness: "live",
    });

    const p = await getEmployeeFields("101", ["basic", "job"]);
    const req = calls.filter((c) => c.url.includes("/employees/101?")).at(-1)!;
    const asked = new URL(req.url).searchParams.get("fields")!.split(",");
    expect(asked).toEqual(
      expect.arrayContaining(["jobTitle", "department", "supervisor", "hireDate"]),
    );
    expect(asked.some((f) => isSensitiveField(f))).toBe(false);
    expect(p.data.fields.department).toBe("Operations");
    expect(p.data.fields).not.toHaveProperty("payRate"); // BambooHR returned it; Baxter dropped it
    expect(p.data.notReturned).toEqual(expect.arrayContaining(["division", "location"]));
    expect(p.source).toMatchObject({
      provider: "bamboohr",
      recordId: "101",
      entityType: "Employee profile",
      sourceUrl: null,
    });
  });

  it("explains record-level restrictions and missing records without guessing", async () => {
    await connect();
    await expect(getEmployeeFields("999", ["job"])).rejects.toThrow(/don't allow reading it/);
    await expect(getEmployeeFields("4242", ["job"])).rejects.toThrow(
      /found nothing for this employee's record/,
    );
    await expect(getEmployeeFields("abc", ["job"])).rejects.toThrow(/numbers/);
  });

  it("only issues GET requests to the API — writes are disabled", async () => {
    await connect();
    await bootstrap();
    const hr = await getBambooAccess(req(HR_ID));
    await employeeView(hr, "101", { include: ["files", "onboarding"] });
    expect(calls.filter((c) => c.url.includes("/api/v1/") && c.method !== "GET")).toEqual([]);
    expect(BAMBOOHR_WRITES_ENABLED).toBe(false);
    expect(() => assertBambooWriteAllowed("update job title")).toThrow(/turned off/);
  });
});

describe("identity links and access control", () => {
  it("suggests links only from exact work-email matches, flags ambiguity, and needs confirmation", async () => {
    await connect();
    await bootstrap();
    emails.map = new Map([
      [EMPLOYEE_ID, "eli@acme.test"],
      [OTHER_ID, "jordan@acme.test"],
      [HR_ID, "harper@acme.test"],
    ]);
    const hr = await getBambooAccess(req(HR_ID));
    const r = await suggestLinksByEmail(hr);
    expect(r).toMatchObject({ suggested: 1, ambiguous: 1, unmatched: 1 });
    const links = await agentDb().select<{
      id: string;
      profile_id: string;
      bamboohr_employee_id: string;
      status: string;
      note: string;
    }>("bamboohr_identity_links", {});
    expect(
      links
        .filter((l) => l.profile_id === OTHER_ID)
        .map((l) => l.bamboohr_employee_id)
        .sort(),
    ).toEqual(["102", "103"]);
    expect(links.find((l) => l.profile_id === OTHER_ID)!.note).toMatch(/Ambiguous/);
    // Suggestions grant nothing.
    const eli = await getBambooAccess(req(EMPLOYEE_ID));
    expect(eli.ownEmployeeId).toBeNull();
    await expect(employeeView(eli, "101")).rejects.toThrow(/isn't linked/);

    const eliLink = links.find((l) => l.profile_id === EMPLOYEE_ID)!;
    const employee = await getBambooAccess(req(EMPLOYEE_ID));
    await expect(confirmLink({ linkId: eliLink.id, access: employee })).rejects.toThrow(
      /Only the CEO, COO, or an HR administrator/,
    );
    await confirmLink({ linkId: eliLink.id, access: hr });
    const jordanPick = links.find(
      (l) => l.profile_id === OTHER_ID && l.bamboohr_employee_id === "102",
    )!;
    await confirmLink({ linkId: jordanPick.id, access: hr });
    const rejectedTwin = await selectOne<{ status: string }>("bamboohr_identity_links", {
      filters: [eq("profile_id", OTHER_ID), eq("bamboohr_employee_id", "103")],
    });
    expect(rejectedTwin!.status).toBe("rejected");
    // No double links.
    await expect(confirmLink({ profileId: HR_ID, employeeId: "101", access: hr })).rejects.toThrow(
      /already linked to a different Baxter account/,
    );
  });

  it("lets employees read only their own record; HR reads anyone; nobody else sees anything", async () => {
    await connect();
    await bootstrap();
    const hr = await getBambooAccess(req(HR_ID));
    await confirmLink({ profileId: EMPLOYEE_ID, employeeId: "101", access: hr });
    const eli = await getBambooAccess(req(EMPLOYEE_ID));
    expect(eli.ownEmployeeId).toBe("101");
    const own = await employeeView(eli, "101", { include: ["files", "onboarding"] });
    expect(own.self).toBe(true);
    expect(own.files).toBeNull(); // HR-only sections aren't fetched for employees
    expect(own.onboarding).toBeNull();
    await expect(employeeView(eli, "102")).rejects.toThrow(
      /restricted\. You can only view your own record/,
    );
    const other = await getBambooAccess(req(OTHER_ID));
    await expect(employeeView(other, "101")).rejects.toThrow(/isn't linked/);
    const unverified = await getBambooAccess(req(CEO_ID, "admin", "unverified"));
    await expect(employeeView(unverified, "101")).rejects.toThrow(/couldn't be verified/);
    const hrView = await employeeView(hr, "102", { include: ["files", "onboarding"] });
    expect(hrView.onboarding!.data).toBeNull(); // onboarding scope not granted
    expect("problem" in hrView.onboarding! && hrView.onboarding.problem).toMatch(/onboarding/);
    // Reads are audited, without contents.
    const audit = await agentDb().select<{ action: string; summary: string }>("ai_audit_log", {
      filters: [eq("action", "bamboohr.read")],
    });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toMatch(/Operations|Preconstruction|eli@acme/);
  });

  it("gives connection control to the COO and custom-field approval only to the COO", async () => {
    await bootstrap();
    expect((await getBambooAccess(req(COO_ID))).canManageConnection).toBe(true);
    expect((await getBambooAccess(req(CEO_ID))).canManageConnection).toBe(false);
    expect((await getBambooAccess(req(ADMIN_ID, "admin"))).canManageConnection).toBe(false);
    expect((await getBambooAccess(req(HR_ID))).canManageConnection).toBe(false);
    await expect(
      setReadableCustomFields(["toolAllowance"], await getBambooAccess(req(HR_ID))),
    ).rejects.toThrow(/Only the COO/);
    await expect(
      setReadableCustomFields(["payRate"], await getBambooAccess(req(COO_ID))),
    ).rejects.toThrow(/can't be read/);
    await setReadableCustomFields(["toolAllowance"], await getBambooAccess(req(COO_ID)));
  });

  it("unlinking removes self-access immediately", async () => {
    await connect();
    await bootstrap();
    const hr = await getBambooAccess(req(HR_ID));
    const link = await confirmLink({ profileId: EMPLOYEE_ID, employeeId: "101", access: hr });
    await rejectOrUnlink(link.id, hr);
    expect((await getBambooAccess(req(EMPLOYEE_ID))).ownEmployeeId).toBeNull();
  });
});

describe("diagnostics", () => {
  it("reports only verified capabilities and names missing scopes", async () => {
    await connect(
      scopesFor([])
        .filter((s) => s !== "employee_directory")
        .join(" "),
    );
    await bootstrap();
    const r = await runDiagnostics(await getBambooAccess(req(COO_ID)));
    const status = Object.fromEntries(r.capabilities.map((c) => [c.key, c.status]));
    expect(status).toMatchObject({
      company: "working",
      employee_list: "working",
      employee_job: "working",
      employee_contact: "working",
      directory: "scope_not_granted",
      fields: "working",
      files: "scope_not_granted",
      onboarding: "scope_not_granted",
      surveys: "unsupported",
      write_job_update: "disabled",
    });
    expect(r.missingScopes).toEqual(["employee_directory"]);
    await expect(runDiagnostics(await getBambooAccess(req(EMPLOYEE_ID)))).rejects.toThrow(
      /Only the COO, CEO, or HR/,
    );
  });
});

describe("Sam tools and source attribution", () => {
  const ctx = (r: Requester) => ({
    task: { id: "00000000-0000-4000-8000-00000000abcd" } as never,
    agent: {} as never,
    requester: r,
    access: new Set<never>(),
  });

  it("answers HR questions with BambooHR provenance and refuses restricted requests without leaking", async () => {
    await connect();
    await bootstrap();
    const hrOut = await getTool("bamboohr_employee_profile")!.execute(ctx(req(HR_ID)), {
      employeeId: "102",
      sections: ["job"],
    });
    expect(hrOut.data).toMatchObject({
      fields: {
        Department: "Preconstruction",
        Manager: "Avery Synthetic",
        "Hire date": "2025-01-06",
      },
    });
    expect(hrOut.sources![0]!.provenance).toMatchObject({
      provider: "bamboohr",
      recordId: "102",
      entityType: "Employee profile",
    });
    expect(JSON.stringify(hrOut.data)).not.toMatch(/99\.00|000-00-0000/);

    // An employee asking through Baxter keeps their own identity: restricted, nothing revealed, no source.
    const viaBaxter = await getTool("bamboohr_employee_profile")!.execute(
      ctx(req(EMPLOYEE_ID, "user", "slack_mapping")),
      { employeeId: "102" },
    );
    expect(viaBaxter.data).toMatchObject({ available: false });
    expect(JSON.stringify(viaBaxter.data)).not.toMatch(/Preconstruction|Estimator/);
    expect(viaBaxter.sources ?? []).toHaveLength(0);

    const find = await getTool("bamboohr_find_employee")!.execute(ctx(req(EMPLOYEE_ID)), {
      name: "Jordan",
    });
    expect(find.data).toMatchObject({ available: false, reason: "not_authorized" });
    const hrFind = await getTool("bamboohr_find_employee")!.execute(ctx(req(HR_ID)), {
      name: "Jordan",
    });
    expect((hrFind.data as { matches: unknown[] }).matches).toHaveLength(2);
    expect((hrFind.data as { note?: string }).note).toMatch(/confirm which one/);
  });

  it("attributes BambooHR data even when the model forgets to cite it, and never mislabels other sources", async () => {
    await connect();
    await bootstrap();
    const out = await getTool("bamboohr_employee_profile")!.execute(ctx(req(HR_ID)), {
      employeeId: "101",
    });
    const seen = new Map(out.sources!.map((s) => [s.documentId ?? s.title, s]));
    seen.set("doc-1", { documentId: "doc-1", title: "Handbook", excerpt: "x" });
    const result = finalizeResult(
      {
        outcome: "answered",
        summary: "Avery is in Operations.",
        findings: [],
        sources: [{ documentId: "doc-1", title: "Handbook", excerpt: "" }],
        nextSteps: [],
        proposedActions: [],
        missingInformation: [],
        requiresHumanReview: false,
        artifacts: [],
      } as never,
      seen,
      [],
    );
    const bamboo = result.sources.filter((s) => s.provider === "bamboohr");
    expect(bamboo).toHaveLength(1);
    expect(bamboo[0]).toMatchObject({
      recordType: "Employee profile",
      recordId: "101",
      freshness: "live",
    });
    expect(result.sources.find((s) => s.documentId === "doc-1")!.provider).toBeUndefined();
    expect(
      describeSource({
        provider: "bamboohr",
        entityType: "Employee profile",
        freshness: "live",
        retrievedAt: new Date().toISOString(),
      }),
    ).toBe("BambooHR · Employee profile · retrieved live just now");
  });

  it("reports capabilities honestly to the requester", async () => {
    await bootstrap();
    const notConnected = await getTool("bamboohr_capabilities")!.execute(ctx(req(EMPLOYEE_ID)), {});
    expect(notConnected.data).toMatchObject({
      connected: false,
      writes: "Off. Sam cannot change BambooHR records.",
    });
    await connect();
    const emp = await getTool("bamboohr_capabilities")!.execute(ctx(req(EMPLOYEE_ID)), {});
    expect((emp.data as { yourAccess: string }).yourAccess).toMatch(/isn't linked/);
    expect((emp.data as { grantedScopes?: string[] }).grantedScopes).toBeUndefined();
  });
});
