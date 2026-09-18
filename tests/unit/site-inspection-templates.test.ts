/**
 * Site Inspection Checklist — templates data model, seed, CRUD, ordering, RLS text.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  DETACHED_ADU_SEED,
  DETACHED_ADU_TEMPLATE_NAME,
  addItem,
  addOption,
  addSection,
  addSubQuestion,
  archiveTemplate,
  createEmptyTemplate,
  deleteItem,
  deleteOption,
  deleteSection,
  deleteSubQuestion,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  reorderItems,
  reorderOptions,
  reorderSections,
  reorderSubQuestions,
  resetInspectionTemplateMemoryForTests,
  updateItem,
  updateOption,
  updateSection,
  updateSubQuestion,
  updateTemplateMeta,
} from "@/lib/inspections";
import { getEnabledBaxterTools, getNavContext } from "@/lib/baxter/tools";
import { getAdminNavLinks } from "@/lib/baxter/admin-nav";
import { getEmployeeNavLinks } from "@/lib/baxter/app-nav-links";

beforeEach(() => {
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetInspectionTemplateMemoryForTests();
});

describe("Site Inspection migration + shared projects", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/046_site_inspection_templates.sql"),
    "utf8",
  );

  it("creates template hierarchy tables with authenticated read and no client writes", () => {
    for (const table of [
      "inspection_templates",
      "inspection_template_sections",
      "inspection_template_items",
      "inspection_template_sub_questions",
      "inspection_template_sub_question_options",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toMatch(
        new RegExp(`Authenticated users can read[\\s\\S]*?on public\\.${table} for select`),
      );
      expect(migration).toContain(`on public.${table} for insert`);
      expect(migration).toContain(`on public.${table} for update`);
      expect(migration).toContain(`on public.${table} for delete`);
      expect(migration).toContain("with check (false)");
    }
  });

  it("keeps expense_jobs as the shared project list (comment update only)", () => {
    expect(migration).toContain("comment on table public.expense_jobs");
    expect(migration).toMatch(/Receipt Log and Site Inspection Checklist/);
    expect(migration).not.toMatch(/rename table.*expense_jobs/i);
  });

  it("stores ordering via sort_order and unique cover photo per template", () => {
    expect(migration).toContain("sort_order integer not null");
    expect(migration).toContain("inspection_template_items_cover_photo_uidx");
    expect(migration).toContain("is_cover_photo_source");
    expect(migration).toContain("allows_media");
    expect(migration).toContain("archived_at");
  });
});

describe("Detached ADU seed", () => {
  it("matches the stakeholder spec structure", async () => {
    const templates = await listTemplates();
    const summary = templates.find((t) => t.name === DETACHED_ADU_TEMPLATE_NAME);
    expect(summary).toBeTruthy();
    const detail = await getTemplate(summary!.id);

    expect(detail.standaloneItems).toHaveLength(1);
    expect(detail.standaloneItems[0]?.title).toBe("Front Photo of Main House");
    expect(detail.standaloneItems[0]?.isCoverPhotoSource).toBe(true);

    const sectionTitles = detail.sections.map((s) => s.title);
    expect(sectionTitles).toEqual([
      "SITE OVERVIEW & PROPERTY CHARACTERISTICS",
      "MAIN HOUSE",
      "PROPOSED ADU AREA",
      "TRENCH",
      "ELECTRICAL",
      "WATER",
      "SEWER",
      "GAS",
      "HYDRANT / FIRE SPRINKLERS",
      "RED FLAGS / CONCERNS",
    ]);

    // Spot-check key items / sub-questions / options against seed canonical data.
    expect(detail.sections[0]?.items.map((i) => i.title)).toEqual(
      DETACHED_ADU_SEED.sections[0]?.items.map((i) => i.title),
    );

    const topography = detail.sections[0]?.items.find((i) => i.title === "Topography");
    expect(topography?.subQuestions[0]?.questionType).toBe("single_select");
    expect(topography?.subQuestions[0]?.options.map((o) => o.label)).toEqual(["Flat", "Sloped"]);

    const trench = detail.sections.find((s) => s.title === "TRENCH")?.items[0];
    expect(trench?.subQuestions[0]?.questionType).toBe("multi_select");
    expect(trench?.subQuestions[0]?.options.map((o) => o.label)).toEqual([
      "Grass",
      "Concrete",
      "Pavers",
    ]);

    const electrical = detail.sections.find((s) => s.title === "ELECTRICAL")?.items[0];
    expect(electrical?.subQuestions.map((q) => q.prompt)).toEqual([
      "Service type",
      "Main panel size",
      "Relocate existing panel?",
    ]);
    expect(electrical?.subQuestions[1]?.options.map((o) => o.label)).toEqual([
      "100",
      "200",
      "320",
      "400",
    ]);

    const water = detail.sections.find((s) => s.title === "WATER")?.items[0];
    expect(water?.subQuestions[0]?.options.map((o) => o.label)).toEqual([
      '5/8"',
      '3/4"',
      '1"',
      '1-1/4"',
      '1-1/2"',
      '2"',
    ]);

    // Every seeded item has media + notes capability.
    for (const item of [...detail.standaloneItems, ...detail.sections.flatMap((s) => s.items)]) {
      expect(item.allowsMedia).toBe(true);
      expect(item.allowsNotes).toBe(true);
      expect(item.guideNotes.length).toBeGreaterThan(0);
    }

    expect(detail.itemCount).toBe(
      (DETACHED_ADU_SEED.standaloneItems?.length ?? 0) +
        DETACHED_ADU_SEED.sections.reduce((n, s) => n + s.items.length, 0),
    );
  });
});

describe("Template CRUD + ordering persistence", () => {
  it("creates, duplicates, archives, and edits meta", async () => {
    const created = await createEmptyTemplate({
      name: "Remodel Draft",
      description: "Scratch",
      actorId: "admin-1",
    });
    expect(created.name).toBe("Remodel Draft");

    const renamed = await updateTemplateMeta({
      id: created.id,
      name: "Remodel",
      description: null,
      actorId: "admin-1",
    });
    expect(renamed.name).toBe("Remodel");
    expect(renamed.description).toBeNull();

    const copy = await duplicateTemplate(created.id, "admin-1");
    expect(copy.name).toBe("Copy of Remodel");
    expect(copy.id).not.toBe(created.id);

    const archived = await archiveTemplate(created.id, "admin-1");
    expect(archived.archivedAt).toBeTruthy();
    const active = await listTemplates({ includeArchived: false });
    expect(active.some((t) => t.id === created.id)).toBe(false);
    const all = await listTemplates({ includeArchived: true });
    expect(all.some((t) => t.id === created.id)).toBe(true);
  });

  it("reorders sections, items, sub-questions, and options identically after reload", async () => {
    const template = await createEmptyTemplate({ name: "Order Test", actorId: "a" });
    await addSection({ templateId: template.id, title: "A", actorId: "a" });
    await addSection({ templateId: template.id, title: "B", actorId: "a" });
    await addSection({ templateId: template.id, title: "C", actorId: "a" });
    let detail = await getTemplate(template.id);
    const sectionIds = detail.sections.map((s) => s.id);
    await reorderSections({
      templateId: template.id,
      orderedIds: [sectionIds[2]!, sectionIds[0]!, sectionIds[1]!],
      actorId: "a",
    });
    detail = await getTemplate(template.id);
    expect(detail.sections.map((s) => s.title)).toEqual(["C", "A", "B"]);

    const sectionA = detail.sections.find((s) => s.title === "A")!;
    await addItem({
      templateId: template.id,
      sectionId: sectionA.id,
      title: "Item 1",
      actorId: "a",
    });
    await addItem({
      templateId: template.id,
      sectionId: sectionA.id,
      title: "Item 2",
      actorId: "a",
    });
    detail = await getTemplate(template.id);
    const items = detail.sections.find((s) => s.title === "A")!.items;
    await reorderItems({
      templateId: template.id,
      sectionId: sectionA.id,
      orderedIds: [items[1]!.id, items[0]!.id],
      actorId: "a",
    });
    detail = await getTemplate(template.id);
    expect(detail.sections.find((s) => s.title === "A")!.items.map((i) => i.title)).toEqual([
      "Item 2",
      "Item 1",
    ]);

    const item = detail.sections.find((s) => s.title === "A")!.items[0]!;
    await addSubQuestion({
      itemId: item.id,
      prompt: "Q1",
      questionType: "single_select",
      options: [{ label: "One" }, { label: "Two" }, { label: "Three" }],
      actorId: "a",
    });
    await addSubQuestion({
      itemId: item.id,
      prompt: "Q2",
      questionType: "text",
      actorId: "a",
    });
    detail = await getTemplate(template.id);
    const itemAfter = detail.sections.find((s) => s.title === "A")!.items[0]!;
    await reorderSubQuestions({
      itemId: itemAfter.id,
      orderedIds: [itemAfter.subQuestions[1]!.id, itemAfter.subQuestions[0]!.id],
      actorId: "a",
    });
    detail = await getTemplate(template.id);
    const sqs = detail.sections.find((s) => s.title === "A")!.items[0]!.subQuestions;
    expect(sqs.map((q) => q.prompt)).toEqual(["Q2", "Q1"]);

    const select = sqs[1]!;
    await reorderOptions({
      subQuestionId: select.id,
      orderedIds: [select.options[2]!.id, select.options[0]!.id, select.options[1]!.id],
      actorId: "a",
    });
    detail = await getTemplate(template.id);
    expect(
      detail.sections
        .find((s) => s.title === "A")!
        .items[0]!.subQuestions.find((q) => q.prompt === "Q1")!
        .options.map((o) => o.label),
    ).toEqual(["Three", "One", "Two"]);

    // Mutate labels / titles and ensure deletes work.
    await updateSection({ sectionId: sectionA.id, title: "Alpha", actorId: "a" });
    await updateItem({
      itemId: item.id,
      title: "Item Two",
      guideNotes: "• Check access",
      isCoverPhotoSource: true,
      actorId: "a",
    });
    await updateSubQuestion({
      subQuestionId: select.id,
      prompt: "Choose one",
      actorId: "a",
    });
    await addOption({ subQuestionId: select.id, label: "Four", actorId: "a" });
    detail = await getTemplate(template.id);
    const coverCount = [
      ...detail.standaloneItems,
      ...detail.sections.flatMap((s) => s.items),
    ].filter((i) => i.isCoverPhotoSource).length;
    expect(coverCount).toBe(1);

    const opt = detail.sections
      .find((s) => s.title === "Alpha")!
      .items.find((i) => i.title === "Item Two")!
      .subQuestions.find((q) => q.prompt === "Choose one")!
      .options.find((o) => o.label === "Four")!;
    await updateOption({ optionId: opt.id, label: "IV", actorId: "a" });
    await deleteOption({ optionId: opt.id, actorId: "a" });
    await deleteSubQuestion({ subQuestionId: select.id, actorId: "a" });
    await deleteItem({ itemId: item.id, actorId: "a" });
    await deleteSection({ sectionId: sectionA.id, actorId: "a" });
    detail = await getTemplate(template.id);
    expect(detail.sections.map((s) => s.title)).toEqual(["C", "B"]);
  });
});

describe("Site Inspections tool registration", () => {
  it("exposes dashboard card for app-access users", () => {
    const tools = getEnabledBaxterTools({ isAdmin: false });
    const card = tools.find((t) => t.key === "site-inspections");
    expect(card?.name).toBe("Site Inspection Checklist");
    expect(card?.href).toBe("/inspections");
    expect(getEnabledBaxterTools({ isAdmin: true }).some((t) => t.key === "site-inspections")).toBe(
      true,
    );
  });

  it("registers nav for employees and admins", () => {
    expect(getEmployeeNavLinks().some((l) => l.href === "/inspections")).toBe(true);
    expect(getAdminNavLinks().some((l) => l.href === "/inspections")).toBe(true);
    expect(getNavContext("/inspections/templates")).toBe("site-inspections");
  });
});
