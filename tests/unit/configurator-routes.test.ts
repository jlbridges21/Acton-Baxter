import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/errors";

const auth = vi.hoisted(() => ({ role: "admin" as "admin" | "user" | null }));

vi.mock("@/lib/auth/session", () => {
  const user = () => ({
    id: "00000000-0000-4000-8000-0000000000aa",
    email: "admin@acton.test",
    profile: { role: auth.role, full_name: "Admin" },
  });
  return {
    requireAdmin: vi.fn(async () => {
      if (auth.role !== "admin") throw new AuthorizationError("Admin access required");
      return user();
    }),
    getOptionalUser: vi.fn(async () => (auth.role ? user() : null)),
  };
});

import { GET as draftGet, POST as draftPost } from "@/app/api/admin/configurator/draft/route";
import { POST as publishPost } from "@/app/api/admin/configurator/publish/route";
import { GET as catalogGet } from "@/app/api/public/configurator/catalog/route";
import { POST as locationPost } from "@/app/api/public/configurator/location/route";
import { POST as quotePost } from "@/app/api/public/configurator/quote/route";
import { resetConfiguratorMemoryForTests } from "@/lib/configurator/store";
import { fixtureCatalog } from "./configurator-fixture";

const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function publish() {
  auth.role = "admin";
  const res = await publishPost(
    new Request("http://x/api/admin/configurator/publish", json({ notes: "test" })),
  );
  expect(res.status).toBe(200);
}

beforeEach(() => {
  process.env.CONFIGURATOR_DISABLE_SEED = "true";
  resetConfiguratorMemoryForTests({ catalog: fixtureCatalog() });
  auth.role = "admin";
});

describe("admin access", () => {
  it("rejects non-admins on admin routes", async () => {
    auth.role = "user";
    expect((await draftGet()).status).toBe(403);
    const res = await draftPost(new Request("http://x", json({ changes: [] })));
    expect(res.status).toBe(403);
    expect((await publishPost(new Request("http://x", json({})))).status).toBe(403);
  });

  it("lets admins read and save the draft", async () => {
    const res = await draftGet();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { catalog: ReturnType<typeof fixtureCatalog> };
    const model = data.catalog.models[0]!;
    const save = await draftPost(
      new Request(
        "http://x",
        json({
          changes: [
            {
              op: "put",
              collection: "models",
              value: { ...model, name: "Renamed" },
              expectedRev: model.rev,
            },
          ],
        }),
      ),
    );
    expect(save.status).toBe(200);
    const stale = await draftPost(
      new Request(
        "http://x",
        json({
          changes: [
            {
              op: "put",
              collection: "models",
              value: { ...model, name: "Again" },
              expectedRev: model.rev,
            },
          ],
        }),
      ),
    );
    expect(stale.status).toBe(409);
  });

  it("rejects malformed entities", async () => {
    const res = await draftPost(
      new Request(
        "http://x",
        json({
          changes: [{ op: "put", collection: "models", value: { id: "x" }, expectedRev: null }],
        }),
      ),
    );
    expect(res.status).toBe(400);
  });
});

describe("draft vs published", () => {
  it("does not show anything publicly until published, and ignores ?preview for non-admins", async () => {
    auth.role = null;
    expect((await catalogGet(new Request("http://x/api/public/configurator/catalog"))).status).toBe(
      404,
    );
    expect(
      (await catalogGet(new Request("http://x/api/public/configurator/catalog?preview=draft")))
        .status,
    ).toBe(404);
    auth.role = "admin";
    expect(
      (await catalogGet(new Request("http://x/api/public/configurator/catalog?preview=draft")))
        .status,
    ).toBe(200);
  });

  it("publishes, and later draft edits stay out of the live catalog", async () => {
    await publish();
    auth.role = null;
    const live = (await (
      await catalogGet(new Request("http://x/api/public/configurator/catalog"))
    ).json()) as { version: number; models: { name: string }[] };
    expect(live.version).toBe(1);
    expect(live.models.map((m) => m.name)).toContain("Manzanita i448 A1");

    auth.role = "admin";
    const draft = (await (await draftGet()).json()) as {
      catalog: ReturnType<typeof fixtureCatalog>;
    };
    const model = draft.catalog.models[0]!;
    await draftPost(
      new Request(
        "http://x",
        json({
          changes: [
            {
              op: "put",
              collection: "models",
              value: { ...model, name: "Draft Only Name" },
              expectedRev: model.rev,
            },
          ],
        }),
      ),
    );

    auth.role = null;
    const after = (await (
      await catalogGet(new Request("http://x/api/public/configurator/catalog"))
    ).json()) as { models: { name: string }[] };
    expect(after.models.map((m) => m.name)).not.toContain("Draft Only Name");
  });

  it("never publishes a model whose prices were not reviewed", async () => {
    const c = fixtureCatalog();
    c.models[1]!.basePrice.needsReview = true;
    resetConfiguratorMemoryForTests({ catalog: c });
    await publish();
    auth.role = null;
    const live = (await (
      await catalogGet(new Request("http://x/api/public/configurator/catalog"))
    ).json()) as { models: { slug: string }[] };
    expect(live.models.map((m) => m.slug)).toEqual(["manzanita-i448-a1"]);
  });
});

describe("location-gated pricing", () => {
  beforeEach(async () => {
    await publish();
    auth.role = null;
  });

  it("refuses prices without a verified location", async () => {
    const res = await quotePost(new Request("http://x", json({ model: "cypress-s748-b1" })));
    expect(res.status).toBe(401);
    const forged = await quotePost(
      new Request("http://x", json({ model: "cypress-s748-b1", token: "abc.def" })),
    );
    expect(forged.status).toBe(401);
  });

  it("prices by the property's city and region", async () => {
    const loc = await locationPost(
      new Request(
        "http://x/api/public/configurator/location",
        json({ address: "1 Main St", city: "Sacramento", state: "CA", postalCode: "95814" }),
      ),
    );
    const located = (await loc.json()) as { status: string; regionName: string; token: string };
    expect(located).toMatchObject({ status: "supported", regionName: "Sacramento" });
    expect(JSON.stringify(located)).not.toContain("455000");
    const quote = (await (
      await quotePost(
        new Request("http://x", json({ model: "cypress-s748-b1", token: located.token })),
      )
    ).json()) as { status: string; sheet: { base: number } };
    expect(quote.status).toBe("priced");
    expect(quote.sheet.base).toBe(455000);
  });

  it("uses the ZIP only to look up the city name when the city is missing", async () => {
    const loc = (await (
      await locationPost(
        new Request(
          "http://x/api/public/configurator/location",
          json({ postalCode: "95112", state: "CA" }),
        ),
      )
    ).json()) as { status: string; city: string };
    expect(loc).toMatchObject({ status: "supported", city: "San Jose" });
  });

  it("reports cities outside every region without a token", async () => {
    const res = (await (
      await locationPost(
        new Request(
          "http://x/api/public/configurator/location",
          json({ city: "Fresno", state: "CA", postalCode: "93721" }),
        ),
      )
    ).json()) as { status: string; token?: string };
    expect(res.status).toBe("outside");
    expect(res.token).toBeUndefined();
  });

  it("lets admins price the draft for a chosen region in preview", async () => {
    auth.role = "admin";
    const res = (await (
      await quotePost(
        new Request(
          "http://x",
          json({ model: "manzanita-i448-a1", preview: true, regionId: "bay-area" }),
        ),
      )
    ).json()) as { status: string; preview: boolean };
    expect(res).toMatchObject({ status: "priced", preview: true });
    auth.role = null;
    const blocked = await quotePost(
      new Request(
        "http://x",
        json({ model: "manzanita-i448-a1", preview: true, regionId: "bay-area" }),
      ),
    );
    expect(blocked.status).toBe(401);
  });
});
