/**
 * @vitest-environment jsdom
 */
/**
 * Template editor performance, save_item, optimistic UI, section DnD a11y.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  addSection,
  createEmptyTemplate,
  getTemplate,
  reorderSections,
  resetInspectionTemplateMemoryForTests,
  saveItemGraph,
} from "@/lib/inspections";
import { persistItemDraft } from "@/components/inspections/template-item-save";
import { TemplateEditorClient } from "@/components/inspections/template-editor-client";
import type { InspectionTemplateDetail } from "@/lib/inspections/types";
import type { ItemDraft } from "@/components/inspections/template-item-modal";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetInspectionTemplateMemoryForTests();
  cleanup();
});

function richDraft(sectionId: string | null): ItemDraft {
  return {
    serverId: null,
    sectionId,
    title: "Foundation",
    guideNotes: "Check footing",
    allowsMedia: true,
    allowsNotes: true,
    isCoverPhotoSource: false,
    subQuestions: [
      { key: "k1", serverId: null, prompt: "Cracks?", questionType: "yes_no_na", options: [] },
      {
        key: "k2",
        serverId: null,
        prompt: "Surface",
        questionType: "multi_select",
        options: [
          { key: crypto.randomUUID(), label: "Grass" },
          { key: crypto.randomUUID(), label: "Concrete" },
          { key: crypto.randomUUID(), label: "Gravel" },
        ],
      },
      { key: "k3", serverId: null, prompt: "Notes", questionType: "text", options: [] },
    ],
  };
}

describe("save_item single request + timings", () => {
  it("saves item with sub-questions and options in one write", async () => {
    const template = await createEmptyTemplate({ name: "Perf", actorId: "a" });
    let latest = await addSection({ templateId: template.id, title: "STRUCTURE", actorId: "a" });
    const sectionId = latest.sections[0]!.id;

    const posts: string[] = [];
    const post = async (body: Record<string, unknown>) => {
      posts.push(String(body.action));
      if (body.action !== "save_item") throw new Error(`unexpected ${body.action}`);
      latest = await saveItemGraph({
        templateId: String(body.templateId),
        itemId: (body.itemId as string | null) ?? null,
        sectionId: (body.sectionId as string | null) ?? null,
        title: String(body.title),
        guideNotes: String(body.guideNotes ?? ""),
        isCoverPhotoSource: Boolean(body.isCoverPhotoSource),
        allowsMedia: body.allowsMedia as boolean | undefined,
        allowsNotes: body.allowsNotes as boolean | undefined,
        subQuestions: body.subQuestions as Parameters<typeof saveItemGraph>[0]["subQuestions"],
        actorId: "a",
      });
      return latest;
    };

    const t0 = performance.now();
    latest = await persistItemDraft(post, latest, richDraft(sectionId));
    const saveMs = performance.now() - t0;

    console.log(
      "[editor-perf-after]",
      JSON.stringify({
        saveItemMs: Math.round(saveMs * 100) / 100,
        requestCount: posts.length,
        actions: posts,
        subQuestionCount: latest.sections[0]!.items[0]!.subQuestions.length,
        optionCount: latest.sections[0]!.items[0]!.subQuestions[1]!.options.length,
      }),
    );

    expect(posts).toEqual(["save_item"]);
    expect(latest.sections[0]!.items).toHaveLength(1);
    expect(latest.sections[0]!.items[0]!.title).toBe("Foundation");
    expect(latest.sections[0]!.items[0]!.subQuestions).toHaveLength(3);
    expect(latest.sections[0]!.items[0]!.subQuestions[1]!.options.map((o) => o.label)).toEqual([
      "Grass",
      "Concrete",
      "Gravel",
    ]);

    const reloaded = await getTemplate(template.id);
    expect(reloaded.sections[0]!.items[0]!.subQuestions.map((s) => s.prompt)).toEqual([
      "Cracks?",
      "Surface",
      "Notes",
    ]);
  });

  it("appends section items with correct sort_order and preserves order after reload", async () => {
    const template = await createEmptyTemplate({ name: "Order", actorId: "a" });
    let latest = await addSection({ templateId: template.id, title: "A", actorId: "a" });
    const sectionId = latest.sections[0]!.id;
    latest = await saveItemGraph({
      templateId: template.id,
      itemId: null,
      sectionId,
      title: "First",
      subQuestions: [],
      actorId: "a",
    });
    latest = await saveItemGraph({
      templateId: template.id,
      itemId: null,
      sectionId,
      title: "Second",
      subQuestions: [],
      actorId: "a",
    });
    expect(latest.sections[0]!.items.map((i) => i.title)).toEqual(["First", "Second"]);
    expect(latest.sections[0]!.items.map((i) => i.sortOrder)).toEqual([0, 1]);
    const reloaded = await getTemplate(template.id);
    expect(reloaded.sections[0]!.items.map((i) => i.title)).toEqual(["First", "Second"]);
  });
});

describe("optimistic UI rollback", () => {
  it("rolls back a failed item save and shows an error", async () => {
    const base: InspectionTemplateDetail = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "T",
      description: null,
      archivedAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sectionCount: 1,
      itemCount: 0,
      standaloneItems: [],
      sections: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          templateId: "00000000-0000-4000-8000-000000000001",
          title: "SITE",
          sortOrder: 0,
          items: [],
        },
      ],
    };

    const fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: { message: "Simulated write failure" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <div style={{ width: 375 }}>
        <TemplateEditorClient initialTemplate={base} isAdmin />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^\+ Add item$/i }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Title$/i), { target: { value: "Phantom" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save item$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Simulated write failure/i)).toBeTruthy();
    });
    expect(screen.queryByText("Phantom")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("section UI: add item placement + no arrow buttons", () => {
  it("puts Add item in the section header and keeps standalone distinct", () => {
    const sample: InspectionTemplateDetail = {
      id: "t1",
      name: "Detached ADU",
      description: null,
      archivedAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sectionCount: 1,
      itemCount: 0,
      standaloneItems: [],
      sections: [
        {
          id: "s1",
          templateId: "t1",
          title: "SITE OVERVIEW",
          sortOrder: 0,
          items: [],
        },
      ],
    };

    render(
      <div style={{ width: 375 }}>
        <TemplateEditorClient initialTemplate={sample} isAdmin />
      </div>,
    );

    expect(screen.getByRole("button", { name: /^\+ Add standalone item$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^\+ Add section$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^\+ Add item$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Move up/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Move down/i })).toBeNull();

    const handle = screen.getByRole("button", { name: /Reorder section SITE OVERVIEW/i });
    expect(handle.getAttribute("aria-roledescription") || handle.getAttribute("role")).toBeTruthy();
    expect(handle.tabIndex).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /^\+ Add item$/i }));
  });

  it("wires KeyboardSensor and documents keyboard reorder on section handles", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/inspections/template-editor-client.tsx"),
      "utf8",
    );
    expect(source).toContain("KeyboardSensor");
    expect(source).toContain("sortableKeyboardCoordinates");
    expect(source).toContain("Press Space to pick up");
    expect(source).not.toMatch(/onMoveSection/);
  });

  it("persists section order via reorderSections", async () => {
    const template = await createEmptyTemplate({ name: "Sections", actorId: "a" });
    await addSection({ templateId: template.id, title: "A", actorId: "a" });
    await addSection({ templateId: template.id, title: "B", actorId: "a" });
    await addSection({ templateId: template.id, title: "C", actorId: "a" });
    let detail = await getTemplate(template.id);
    const ids = detail.sections.map((s) => s.id);
    detail = await reorderSections({
      templateId: template.id,
      orderedIds: [ids[2]!, ids[0]!, ids[1]!],
      actorId: "a",
    });
    expect(detail.sections.map((s) => s.title)).toEqual(["C", "A", "B"]);
    const reloaded = await getTemplate(template.id);
    expect(reloaded.sections.map((s) => s.title)).toEqual(["C", "A", "B"]);
  });
});
