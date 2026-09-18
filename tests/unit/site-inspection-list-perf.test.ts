/**
 * Real before/after-style timing for inspections list work (memory store).
 * "Before" approximates select(*) payload by including snapshot_json size.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  addItem,
  addSection,
  createEmptyTemplate,
  createSiteInspection,
  getSiteInspection,
  listSiteInspections,
  listTemplates,
  resetInspectionTemplateMemoryForTests,
  resetSiteInspectionMediaMemoryForTests,
  resetSiteInspectionMemoryForTests,
} from "@/lib/inspections";

beforeEach(() => {
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetInspectionTemplateMemoryForTests();
  resetSiteInspectionMemoryForTests();
  resetSiteInspectionMediaMemoryForTests();
});

describe("inspections list timing + payload", () => {
  it("reports stage timings and slim list payload vs snapshot-heavy cards", async () => {
    const seedStart = performance.now();
    const template = await createEmptyTemplate({ name: "Perf Bench", actorId: "u1" });
    const withSection = await addSection({
      templateId: template.id,
      title: "S1",
      actorId: "u1",
    });
    const sectionId = withSection.sections[0]!.id;
    for (let i = 0; i < 40; i++) {
      await addItem({
        templateId: template.id,
        sectionId,
        title: `Item ${i}`,
        guideNotes: "x".repeat(200),
        actorId: "u1",
      });
    }
    const seedMs = performance.now() - seedStart;

    const createStart = performance.now();
    for (let i = 0; i < 25; i++) {
      await createSiteInspection({
        projectName: `P${i}`,
        address: `Addr ${i}`,
        templateId: template.id,
        createdBy: "u1",
      });
    }
    const createMs = performance.now() - createStart;

    const detail = await getSiteInspection((await listSiteInspections())[0]!.id);
    const snapshotBytes = Buffer.byteLength(JSON.stringify(detail.snapshot), "utf8");
    const beforeCardBytes = Buffer.byteLength(
      JSON.stringify({
        id: detail.id,
        projectName: detail.projectName,
        address: detail.address,
        status: detail.status,
        assignedToName: detail.assignedToName,
        coverSignedUrl: detail.coverSignedUrl,
        totalItemCount: detail.totalItemCount,
        completedItemCount: detail.completedItemCount,
        snapshot_json: detail.snapshot,
      }),
      "utf8",
    );

    const listStart = performance.now();
    const list = await listSiteInspections();
    const listMs = performance.now() - listStart;
    const afterCardBytes = Buffer.byteLength(JSON.stringify(list[0]), "utf8");
    const afterPayloadBytes = Buffer.byteLength(JSON.stringify(list), "utf8");
    const beforePayloadBytes = beforeCardBytes * list.length;

    const tplStart = performance.now();
    await listTemplates({ includeArchived: false });
    const templatesMs = performance.now() - tplStart;

    console.log(
      "[inspections-perf]",
      JSON.stringify({
        seedMs: Math.round(seedMs),
        create25Ms: Math.round(createMs),
        listMs: Math.round(listMs * 100) / 100,
        templatesMs: Math.round(templatesMs * 100) / 100,
        snapshotBytes,
        beforeCardBytes,
        afterCardBytes,
        beforePayloadBytes,
        afterPayloadBytes,
        reductionPct: Math.round((1 - afterCardBytes / beforeCardBytes) * 1000) / 10,
        progressSample: `${list[0]!.completedItemCount} of ${list[0]!.totalItemCount}`,
      }),
    );

    expect(list).toHaveLength(25);
    expect(list[0]!.totalItemCount).toBe(40);
    expect(afterCardBytes).toBeLessThan(beforeCardBytes * 0.05);
    expect(listMs).toBeLessThan(500);
  });
});
