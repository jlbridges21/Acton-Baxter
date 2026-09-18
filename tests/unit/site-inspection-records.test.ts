/**
 * Site inspection records — snapshot isolation, responses, status, cover photo, RLS text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  addItem,
  addSection,
  attachSiteInspectionPhoto,
  createSiteInspection,
  createTemplateFromSeed,
  getSiteInspection,
  getTemplate,
  listSiteInspections,
  resetInspectionTemplateMemoryForTests,
  resetSiteInspectionMediaMemoryForTests,
  resetSiteInspectionMemoryForTests,
  setSiteInspectionProfileNameForTests,
  updateItem,
  updateSection,
  uploadSiteInspectionPhoto,
  upsertSiteInspectionResponse,
  DETACHED_ADU_TEMPLATE_NAME,
  listTemplates,
  buildInspectionSnapshot,
  splitProjectLabel,
} from "@/lib/inspections";
import {
  clearAllPendingResponses,
  listPendingResponses,
  queuePendingResponse,
} from "@/lib/inspections/client-autosave";

beforeEach(() => {
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetInspectionTemplateMemoryForTests();
  resetSiteInspectionMemoryForTests();
  resetSiteInspectionMediaMemoryForTests();
  setSiteInspectionProfileNameForTests("user-1", "Field Tech");
  setSiteInspectionProfileNameForTests("admin-1", "Ops Lead");
});

describe("migration 047 RLS + schema", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/047_site_inspection_records.sql"),
    "utf8",
  );

  it("creates inspections, responses, media with authenticated read and no client writes", () => {
    for (const table of [
      "site_inspections",
      "site_inspection_responses",
      "site_inspection_media",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toMatch(new RegExp(`on public\\.${table} for select`));
      expect(migration).toContain(`on public.${table} for insert`);
      expect(migration).toContain("with check (false)");
    }
    expect(migration).toContain("snapshot_json");
    expect(migration).toContain("upload_status");
    expect(migration).toContain("site-inspection-media");
  });
});

describe("splitProjectLabel", () => {
  it("splits Master Project Log style labels into name + address", () => {
    expect(splitProjectLabel("L01-26019 Liniger — 25 N Avalon Dr, Los Altos")).toEqual({
      projectName: "L01-26019 Liniger",
      address: "25 N Avalon Dr, Los Altos",
    });
  });

  it("leaves address blank for free-text names", () => {
    expect(splitProjectLabel("Trailer yard")).toEqual({
      projectName: "Trailer yard",
      address: "",
    });
  });
});

describe("template snapshot isolation", () => {
  it("keeps existing inspections unchanged when the live template is edited", async () => {
    const templates = await listTemplates();
    const detached = templates.find((t) => t.name === DETACHED_ADU_TEMPLATE_NAME)!;
    const before = await getTemplate(detached.id);

    const inspection = await createSiteInspection({
      projectName: "Liniger",
      address: "25 N Avalon Dr, Los Altos",
      templateId: detached.id,
      createdBy: "user-1",
    });

    const snapTitles = [
      ...inspection.snapshot.standaloneItems.map((i) => i.title),
      ...inspection.snapshot.sections.flatMap((s) => s.items.map((i) => i.title)),
    ];
    expect(snapTitles).toContain("Front Photo of Main House");
    expect(snapTitles).toContain("Access");
    const originalSectionCount = inspection.snapshot.sections.length;
    const originalAccessTitle = inspection.snapshot.sections
      .flatMap((s) => s.items)
      .find((i) => i.title === "Access")!.title;

    // Mutate the live template aggressively.
    const access = before.sections
      .flatMap((s) => s.items.map((item) => ({ sectionId: s.id, item })))
      .find((x) => x.item.title === "Access")!;
    await updateItem({
      itemId: access.item.id,
      title: "Access RENAMED",
      actorId: "admin-1",
    });
    await updateSection({
      sectionId: before.sections[0]!.id,
      title: "SITE OVERVIEW CHANGED",
      actorId: "admin-1",
    });
    await addSection({
      templateId: detached.id,
      title: "BRAND NEW SECTION",
      actorId: "admin-1",
    });
    const firstSection = (await getTemplate(detached.id)).sections[0]!;
    await addItem({
      templateId: detached.id,
      sectionId: firstSection.id,
      title: "Brand new item",
      actorId: "admin-1",
    });

    const reloaded = await getSiteInspection(inspection.id);
    expect(reloaded.snapshot.sections.length).toBe(originalSectionCount);
    expect(reloaded.snapshot.sections.some((s) => s.title === "BRAND NEW SECTION")).toBe(false);
    expect(
      reloaded.snapshot.sections.flatMap((s) => s.items).some((i) => i.title === "Access RENAMED"),
    ).toBe(false);
    const stillAccess = reloaded.snapshot.sections
      .flatMap((s) => s.items)
      .find((i) => i.title === originalAccessTitle);
    expect(stillAccess?.title).toBe("Access");

    // A newly created inspection reflects the edits.
    const newer = await createSiteInspection({
      projectName: "New Visit",
      address: "1 Main St",
      templateId: detached.id,
      createdBy: "user-1",
    });
    expect(newer.snapshot.sections.some((s) => s.title === "BRAND NEW SECTION")).toBe(true);
    expect(
      newer.snapshot.sections.flatMap((s) => s.items).some((i) => i.title === "Access RENAMED"),
    ).toBe(true);
  });

  it("assigns fresh snapshot ids distinct from template item ids", async () => {
    const template = await createTemplateFromSeed(
      {
        name: "Tiny",
        standaloneItems: [{ title: "Cover", guideNotes: "• x", isCoverPhotoSource: true }],
        sections: [
          {
            title: "One",
            items: [{ title: "Item", guideNotes: "• y" }],
          },
        ],
      },
      "admin-1",
    );
    const snap = buildInspectionSnapshot(template);
    expect(snap.standaloneItems[0]!.id).not.toBe(template.standaloneItems[0]!.id);
    expect(snap.standaloneItems[0]!.sourceTemplateItemId).toBe(template.standaloneItems[0]!.id);
  });
});

describe("responses, status, cover photo", () => {
  async function tinyInspection() {
    const template = await createTemplateFromSeed(
      {
        name: "Two-item",
        standaloneItems: [{ title: "Cover", guideNotes: "• front", isCoverPhotoSource: true }],
        sections: [
          {
            title: "A",
            items: [
              {
                title: "Check",
                guideNotes: "• g",
                subQuestions: [
                  { prompt: "OK?", questionType: "yes_no_na" },
                  {
                    prompt: "Lot",
                    questionType: "single_select",
                    options: [{ label: "Flat" }, { label: "Sloped" }],
                  },
                  {
                    prompt: "Surface",
                    questionType: "multi_select",
                    options: [{ label: "Grass" }, { label: "Concrete" }],
                  },
                  { prompt: "Notes detail", questionType: "text" },
                ],
              },
            ],
          },
        ],
      },
      "admin-1",
    );
    return createSiteInspection({
      projectName: "Job",
      address: "123 St",
      templateId: template.id,
      assignedTo: "user-1",
      createdBy: "admin-1",
    });
  }

  it("round-trips checkbox, notes, and each sub-question type", async () => {
    const inspection = await tinyInspection();
    const cover = inspection.snapshot.standaloneItems[0]!;
    const check = inspection.snapshot.sections[0]!.items[0]!;
    const [yn, single, multi, text] = check.subQuestions;

    await upsertSiteInspectionResponse({
      inspectionId: inspection.id,
      snapshotItemId: check.id,
      isComplete: true,
      notes: "Side yard clear",
      answers: {
        [yn!.id]: { type: "yes_no_na", value: "yes" },
        [single!.id]: { type: "single_select", value: "Flat" },
        [multi!.id]: { type: "multi_select", value: ["Grass", "Concrete"] },
        [text!.id]: { type: "text", value: "OK" },
      },
      actorId: "user-1",
    });

    const reloaded = await getSiteInspection(inspection.id);
    const response = reloaded.responses.find((r) => r.snapshotItemId === check.id)!;
    expect(response.isComplete).toBe(true);
    expect(response.notes).toBe("Side yard clear");
    expect(response.answers[yn!.id]?.value).toBe("yes");
    expect(response.answers[single!.id]?.value).toBe("Flat");
    expect(response.answers[multi!.id]?.value).toEqual(["Grass", "Concrete"]);
    expect(response.answers[text!.id]?.value).toBe("OK");

    // Cover still incomplete → pending
    expect(reloaded.status).toBe("pending");
    expect(reloaded.completedItemCount).toBe(1);

    await upsertSiteInspectionResponse({
      inspectionId: inspection.id,
      snapshotItemId: cover.id,
      isComplete: true,
      actorId: "user-1",
    });
    const complete = await getSiteInspection(inspection.id);
    expect(complete.status).toBe("complete");
    expect(complete.completedItemCount).toBe(2);

    await upsertSiteInspectionResponse({
      inspectionId: inspection.id,
      snapshotItemId: cover.id,
      isComplete: false,
      actorId: "user-1",
    });
    const pendingAgain = await getSiteInspection(inspection.id);
    expect(pendingAgain.status).toBe("pending");
  });

  it("sets cover media from the first photo on the cover-photo item", async () => {
    const inspection = await tinyInspection();
    const cover = inspection.snapshot.standaloneItems[0]!;
    // Minimal JPEG
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
    ]);
    const uploaded = await uploadSiteInspectionPhoto({
      userId: "user-1",
      inspectionId: inspection.id,
      buffer: jpeg,
      filename: "cover.jpg",
    });
    const withCover = await attachSiteInspectionPhoto({
      inspectionId: inspection.id,
      snapshotItemId: cover.id,
      storagePath: uploaded.storagePath,
      mimeType: uploaded.mimeType,
      byteSize: uploaded.sizeBytes,
      actorId: "user-1",
    });
    expect(withCover.coverMediaId).toBeTruthy();
    expect(withCover.coverSignedUrl).toBeTruthy();
    expect(withCover.media[0]?.uploadStatus).toBe("ready");

    const list = await listSiteInspections();
    const card = list.find((i) => i.id === inspection.id)!;
    expect(card.coverSignedUrl).toBeTruthy();
    expect(card.assignedToName).toMatch(/Field Tech/i);
  });

  it("lists newest first and filters by status", async () => {
    const a = await tinyInspection();
    await new Promise((r) => setTimeout(r, 5));
    const b = await createSiteInspection({
      projectName: "Later",
      address: "9 End",
      templateId: a.sourceTemplateId!,
      createdBy: "user-1",
    });
    const list = await listSiteInspections();
    expect(list[0]!.id).toBe(b.id);

    await upsertSiteInspectionResponse({
      inspectionId: b.id,
      snapshotItemId: b.snapshot.standaloneItems[0]!.id,
      isComplete: true,
      actorId: "user-1",
    });
    // Still pending — second item incomplete
    const pending = await listSiteInspections({ status: "pending" });
    expect(pending.some((i) => i.id === b.id)).toBe(true);
  });
});

describe("client autosave queue", () => {
  it("keeps pending patches in localStorage across a sync failure", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
    });

    queuePendingResponse("insp-1", {
      snapshotItemId: "item-1",
      notes: "typed offline",
      isComplete: true,
      updatedAt: new Date().toISOString(),
    });
    expect(listPendingResponses("insp-1")).toHaveLength(1);
    expect(listPendingResponses("insp-1")[0]?.notes).toBe("typed offline");

    // Simulate surviving a reload — queue still present until cleared after successful sync.
    expect(listPendingResponses("insp-1")[0]?.isComplete).toBe(true);
    clearAllPendingResponses("insp-1");
    expect(listPendingResponses("insp-1")).toHaveLength(0);

    vi.unstubAllGlobals();
  });
});
