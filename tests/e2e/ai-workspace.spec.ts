import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";

/**
 * AI Workspace (Baxter + Sam) end-to-end checks.
 * Runs against the in-memory stores (E2E_TEST_AUTH_BYPASS + ENABLE_MOCK_RESEARCH) with no
 * Anthropic key, so Sam's model is never actually called — delegation is verified up to
 * the honest "provider not configured" failure, which proves routing, authorization,
 * task persistence, and reporting without spending money or sending data anywhere.
 */

async function asRole(context: BrowserContext, role: "admin" | "user") {
  await context.clearCookies();
  await context.addCookies([
    { name: "baxter_e2e_role", value: role, domain: "localhost", path: "/" },
  ]);
}

test.describe.configure({ mode: "serial" });

test("AI Office shows Baxter and Sam with real (idle) status and an accessible list view", async ({
  page,
  context,
}) => {
  await asRole(context, "admin");
  await page.goto("/ai");
  await expect(page.getByRole("button", { name: /Baxter, AI CEO\. Available\./ })).toBeVisible();
  const sam = page.getByRole("button", { name: /^Sam, HR, Administration & Legal Specialist/ });
  await expect(sam).toBeVisible();
  // Sam is animated (may be walking), so Playwright's "stable" wait never settles.
  await sam.dispatchEvent("click");
  await expect(page.getByRole("heading", { name: "Sam" })).toBeVisible();
  await expect(page.getByText("Reports to", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("Executive Office");
});

test("AI Office animates Baxter, Sam, and Dexter without breaking the map", async ({
  page,
  context,
}) => {
  await asRole(context, "admin");
  const tasksBefore = await (await context.request.get("/api/ai/status")).json();
  await page.goto("/ai");
  const actors = page.locator(".ai-office-actor");
  await expect(actors).toHaveCount(3, { timeout: 30_000 });
  for (const actor of await actors.all()) {
    await expect(actor).toHaveAttribute("data-visual", /^[a-z_]+$/);
  }
  // Each office is decorated for its department.
  await expect(page.locator('[data-decor="strategyBoard"]')).toHaveCount(1);
  await expect(page.locator('[data-decor="onboardingTable"]')).toHaveCount(1);
  await expect(page.locator('[data-decor="whiteboard"]')).toHaveCount(1);
  // Every sprite frame on the page decoded (no broken images).
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLImageElement>(".ai-office-sprite")].filter(
            (img) => !img.complete || img.naturalWidth === 0,
          ).length,
      ),
    )
    .toBe(0);

  // Zoom and pan still work while Baxter moves.
  const world = page.locator(".ai-office > div").first();
  const before = (await world.getAttribute("style")) ?? "";
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(world).not.toHaveAttribute("style", before);
  await page.locator(".ai-office").press("ArrowLeft");

  // A moving button isn't "stable" for Playwright's click; dispatch the click directly.
  await page.getByRole("button", { name: /^Baxter, AI CEO/ }).dispatchEvent("click");
  await expect(page.getByRole("heading", { name: "Baxter" })).toBeVisible();
  await expect(page.getByText("Current assignments")).toBeVisible();

  await page.getByLabel("Reduce motion").check();
  await expect(page.locator(".ai-office")).toHaveAttribute("data-reduced-motion", "true");

  // Ten seconds of idle wandering creates no tasks.
  await page.waitForTimeout(10_000);
  const tasksAfter = await (await context.request.get("/api/ai/status")).json();
  expect(tasksAfter.recent.length).toBe(tasksBefore.recent.length);
});

test("Clicking an agent takes control; clicking the floor shows a ring and walks it there", async ({
  page,
  context,
}) => {
  await asRole(context, "admin");
  await page.goto("/ai");
  await expect(page.locator(".ai-office-actor")).toHaveCount(3, { timeout: 30_000 });
  const sam = page.getByRole("button", { name: /^Sam, / });
  await sam.dispatchEvent("click");
  await expect(page.getByText(/You're directing Sam/)).toBeVisible();
  // Interrupting doesn't count as a floor click.
  await expect(page.locator(".ai-office-click")).toHaveCount(0);

  const transformOf = () => sam.evaluate((el) => (el as HTMLElement).style.transform);
  await page.waitForTimeout(1500); // stand-up transition
  const before = await transformOf();
  const box = (await sam.boundingBox())!;
  // A spot on the floor below and to the right of Sam.
  await page.mouse.click(box.x + box.width / 2 + 60, box.y + box.height + 40);
  await expect(page.locator(".ai-office-click")).toHaveCount(1);
  await expect.poll(transformOf, { timeout: 8000 }).not.toBe(before);
  await expect(sam).toHaveAttribute("data-visual", /walking_right|walking_left|idle/);
  // The ring is brief.
  await expect(page.locator(".ai-office-click")).toHaveCount(0, { timeout: 2000 });
});

test("Baxter delegates an HR question to Sam and reports failures honestly", async ({
  request,
  context,
}) => {
  await asRole(context, "admin");
  const res = await context.request.post("/api/baxter/chat", {
    data: { question: "What documents must a new hire complete?", clientRequestId: randomUUID() },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    message: {
      answer: string;
      delegation: { agentSlug: string; status: string; taskId: string } | null;
    };
  };
  expect(body.message.delegation?.agentSlug).toBe("sam");
  expect(body.message.answer).toMatch(/Sam's AI provider isn't configured/);

  const task = await context.request.get(`/api/ai/tasks/${body.message.delegation!.taskId}`);
  expect(task.ok()).toBe(true);
  const detail = (await task.json()) as {
    task: { status: string; errorCode: string };
    events: Array<{ type: string }>;
  };
  expect(detail.task.status).toBe("failed");
  expect(detail.task.errorCode).toBe("PROVIDER_NOT_CONFIGURED");
  expect(detail.events.map((e) => e.type)).toEqual(
    expect.arrayContaining(["created", "started", "failed"]),
  );
  void request;
});

test("Employees without Sam access are politely denied and cannot edit agents", async ({
  context,
}) => {
  await asRole(context, "user");
  const res = await context.request.post("/api/baxter/chat", {
    data: {
      question: "Help me figure out how to onboard a new employee.",
      clientRequestId: randomUUID(),
    },
  });
  const body = (await res.json()) as { message: { answer: string; delegation: unknown } };
  expect(body.message.answer).toMatch(/doesn't have access to Sam/);
  expect(body.message.delegation).toBeNull();

  const edit = await context.request.put("/api/ai/agents/sam/draft", { data: { config: {} } });
  expect(edit.status()).toBe(403);
  const knowledge = await context.request.get("/api/ai/knowledge");
  expect(((await knowledge.json()) as { canManage: boolean }).canManage).toBe(false);
});

test("An admin edits Sam's instructions as a draft, publishes, and sees version history", async ({
  page,
  context,
}) => {
  await asRole(context, "admin");
  await page.goto("/ai/agents/sam?tab=instructions");
  const tone = page.getByLabel("Tone and communication style");
  await tone.fill("Warm, clear, and careful. Short steps. (e2e)");
  await expect(page.getByText("Unsaved changes.")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/is saved but not live/)).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published. The new configuration is live.")).toBeVisible();

  await page.goto("/ai/agents/sam?tab=history");
  await expect(page.getByText(/Version \d+\s*Live/)).toBeVisible();
  await expect(page.getByText("Previous").first()).toBeVisible();
});

test("Knowledge Hub upload is indexed and searchable only through assigned agents", async ({
  context,
}) => {
  await asRole(context, "admin");
  const agents = (await (await context.request.get("/api/ai/agents")).json()) as {
    agents: Array<{ id: string; slug: string }>;
  };
  const samId = agents.agents.find((a) => a.slug === "sam")!.id;
  const upload = await context.request.post("/api/ai/knowledge", {
    multipart: {
      file: {
        name: "synthetic-checklist.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(
          "# Synthetic onboarding checklist\n\nSYNTHETIC TEST DATA. New hires sign the sample handbook acknowledgement.",
        ),
      },
      title: "Synthetic onboarding checklist",
      category: "onboarding",
      sensitivity: "confidential",
      agentIds: samId,
    },
  });
  expect(upload.status()).toBe(201);
  const doc = ((await upload.json()) as { document: { status: string } }).document;
  expect(doc.status).toBe("ready");

  const hits = await context.request.get(
    "/api/ai/knowledge/search?agent=sam&q=handbook%20acknowledgement",
  );
  expect(((await hits.json()) as { hits: unknown[] }).hits.length).toBeGreaterThan(0);
  const baxterHits = await context.request.get(
    "/api/ai/knowledge/search?agent=baxter&q=handbook%20acknowledgement",
  );
  expect(((await baxterHits.json()) as { searchedDocuments: number }).searchedDocuments).toBe(0);
});

test("Onboarding: start from the placeholder template and complete steps in order", async ({
  context,
}) => {
  await asRole(context, "admin");
  const { templates } = (await (
    await context.request.get("/api/ai/onboarding/templates")
  ).json()) as {
    templates: Array<{ id: string; is_placeholder: boolean }>;
  };
  const placeholder = templates.find((t) => t.is_placeholder)!;
  const created = await context.request.post("/api/ai/onboarding/instances", {
    data: {
      templateId: placeholder.id,
      employeeDisplayName: "Test Hire (synthetic)",
      startDate: "2026-11-02",
    },
  });
  expect(created.status()).toBe(201);
  const { instance } = (await created.json()) as { instance: { id: string } };
  const detail = (await (
    await context.request.get(`/api/ai/onboarding/instances/${instance.id}`)
  ).json()) as {
    steps: Array<{ id: string; status: string; due_date: string | null }>;
  };
  expect(detail.steps[0]!.due_date).toBe("2026-10-19");
  const done = await context.request.patch(`/api/ai/onboarding/steps/${detail.steps[0]!.id}`, {
    data: { status: "done" },
  });
  expect(done.ok()).toBe(true);
});
