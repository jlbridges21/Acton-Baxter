/**
 * Global Search route handlers: server-side authorization, validation, NDJSON streaming,
 * the admin gate, and request rate limiting. Uses the existing test auth bypass (never
 * enabled in production) and in-memory stores.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as searchGET } from "@/app/api/search/route";
import { GET as homeGET } from "@/app/api/search/home/route";
import { POST as trackPOST } from "@/app/api/search/track/route";
import { GET as adminGET, POST as adminPOST } from "@/app/api/admin/search/route";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { invalidateSearchSettings } from "@/lib/search/settings";
import type { SearchStreamEvent } from "@/lib/search/types";
import { setupAgentTestEnv } from "./agents-test-helpers";

function as(role: "user" | "admin") {
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.E2E_TEST_USER_ROLE = role;
  process.env.E2E_TEST_USER_ID = "00000000-0000-4000-8000-0000000000e9";
  resetEnvCacheForTests();
}

async function events(res: Response): Promise<SearchStreamEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SearchStreamEvent);
}

beforeEach(async () => {
  await setupAgentTestEnv();
  resetRateLimitsForTests();
  invalidateSearchSettings();
  as("user");
});
afterEach(() => {
  delete process.env.E2E_TEST_AUTH_BYPASS;
  delete process.env.E2E_TEST_USER_ROLE;
  delete process.env.E2E_TEST_USER_ID;
  resetEnvCacheForTests();
});

describe("GET /api/search", () => {
  it("streams NDJSON events per provider and ends with done", async () => {
    const res = await searchGET(new Request("http://localhost/api/search?q=inventory"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const ev = await events(res);
    expect(ev[0]?.type).toBe("start");
    expect(ev.at(-1)?.type).toBe("done");
    const results = ev.flatMap((e) => (e.type === "provider" ? e.results : []));
    expect(results.some((r) => r.url === "/inventory")).toBe(true);
  });

  it("rejects oversized queries with 400 and invalid categories are ignored", async () => {
    const long = await searchGET(new Request(`http://localhost/api/search?q=${"x".repeat(121)}`));
    expect(long.status).toBe(400);
    const odd = await searchGET(
      new Request("http://localhost/api/search?q=inv&category=../../etc"),
    );
    expect(odd.status).toBe(200);
  });

  it("rate limits runaway clients", async () => {
    let last = 200;
    for (let i = 0; i < 125; i++) {
      const res = await searchGET(new Request("http://localhost/api/search?q="));
      last = res.status;
      if (last === 429) break;
      await res.text();
    }
    expect(last).toBe(429);
  });
});

describe("track and home", () => {
  it("validates the provider and only stores visible records", async () => {
    const bad = await trackPOST(
      new Request("http://localhost/api/search/track", {
        method: "POST",
        body: JSON.stringify({ provider: "nope", recordId: "x" }),
      }),
    );
    expect(bad.status).toBe(400);
    const ok = await trackPOST(
      new Request("http://localhost/api/search/track", {
        method: "POST",
        body: JSON.stringify({ provider: "tools", recordId: "inventory" }),
      }),
    );
    expect(await ok.json()).toEqual({ stored: true });
    const hidden = await trackPOST(
      new Request("http://localhost/api/search/track", {
        method: "POST",
        body: JSON.stringify({ provider: "settings", recordId: "users" }),
      }),
    );
    expect(await hidden.json()).toEqual({ stored: false });
    const home = (await (await homeGET()).json()) as { recent: Array<{ title: string }> };
    expect(home.recent.map((r) => r.title)).toContain("Inventory");
  });
});

describe("/api/admin/search", () => {
  it("is admin-only", async () => {
    expect((await adminGET()).status).toBe(403);
    const post = await adminPOST(
      new Request("http://localhost/api/admin/search", {
        method: "POST",
        body: JSON.stringify({ op: "reindex", provider: "all" }),
      }),
    );
    expect(post.status).toBe(403);
  });

  it("lists providers with availability, index state, and restricted fields marked", async () => {
    as("admin");
    const res = await adminGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Array<{
        id: string;
        fields: Array<{ key: string; sensitivity: string; enabled: boolean }>;
        index: unknown;
      }>;
    };
    const bamboo = body.providers.find((p) => p.id === "bamboohr-employees")!;
    expect(bamboo.fields.find((f) => f.key === "compensation")).toMatchObject({
      sensitivity: "restricted",
      enabled: false,
    });
    expect(body.providers.find((p) => p.id === "jobtread-jobs")?.index).toBeTruthy();
    const bad = await adminPOST(
      new Request("http://localhost/api/admin/search", {
        method: "POST",
        body: JSON.stringify({ op: "set_fields", provider: "bamboohr-employees", fields: ["ssn"] }),
      }),
    );
    expect(bad.status).toBe(400);
  });
});
