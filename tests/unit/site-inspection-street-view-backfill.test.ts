/**
 * Backfill Street View covers for inspections created before covers were fetched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  attachSiteInspectionPhoto,
  backfillPendingStreetViewCovers,
  createSiteInspection,
  createTemplateFromSeed,
  resetInspectionTemplateMemoryForTests,
  resetSiteInspectionMediaMemoryForTests,
  resetSiteInspectionMemoryForTests,
  uploadSiteInspectionPhoto,
} from "@/lib/inspections";
import { maybeEnqueueStreetViewCoverBackfill } from "@/lib/inspections/street-view-backfill";
import { processJob } from "@/lib/jobs/process";
import {
  claimJobById,
  getJobById,
  listMemoryJobsForTests,
  resetMemoryJobsForTests,
} from "@/lib/jobs/queue";

const JPEG = Buffer.alloc(64, 0x11);
JPEG[0] = 0xff;
JPEG[1] = 0xd8;
JPEG[2] = 0xff;
const COVER_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

beforeEach(() => {
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  delete process.env.SITE_INSPECTION_STREET_VIEW_FETCH;
  process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-server-key";
  resetEnvCacheForTests();
  resetInspectionTemplateMemoryForTests();
  resetSiteInspectionMemoryForTests();
  resetSiteInspectionMediaMemoryForTests();
  resetMemoryJobsForTests();
});

afterEach(() => {
  delete process.env.SITE_INSPECTION_STREET_VIEW_FETCH;
  resetEnvCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function inspectionAt(address: string) {
  const template = await createTemplateFromSeed(
    {
      name: `Template ${address}`,
      standaloneItems: [
        { title: "Front Photo of Main House", guideNotes: "• x", isCoverPhotoSource: true },
      ],
      sections: [],
    },
    "admin-1",
  );
  return createSiteInspection({
    projectName: address,
    address,
    templateId: template.id,
    createdBy: "user-1",
  });
}

describe("Street View cover backfill", () => {
  it("fills missing covers once, records no-coverage, and reports failures", async () => {
    const covered = await inspectionAt("1 Covered St, Austin, TX");
    const rural = await inspectionAt("Rural Route 4");
    const broken = await inspectionAt("9 Broken Ln");
    const withPhoto = await inspectionAt("2 Photo Way");
    expect(covered.coverSignedUrl).toBeNull();

    const uploaded = await uploadSiteInspectionPhoto({
      userId: "user-1",
      inspectionId: withPhoto.id,
      buffer: COVER_JPEG,
      filename: "front.jpg",
    });
    const photoCover = await attachSiteInspectionPhoto({
      inspectionId: withPhoto.id,
      snapshotItemId: withPhoto.snapshot.standaloneItems[0]!.id,
      storagePath: uploaded.storagePath,
      mimeType: uploaded.mimeType,
      byteSize: uploaded.sizeBytes,
      actorId: "user-1",
    });
    expect(photoCover.coverSource).toBe("photo");

    const calls: string[] = [];
    process.env.SITE_INSPECTION_STREET_VIEW_FETCH = "1";
    resetEnvCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const href = String(url);
        calls.push(href);
        if (href.includes("9+Broken+Ln") || href.includes("9%20Broken%20Ln")) {
          throw new Error("google down");
        }
        if (href.includes("streetview/metadata")) {
          const status =
            href.includes("Rural+Route+4") || href.includes("Rural%20Route%204")
              ? "ZERO_RESULTS"
              : "OK";
          return new Response(JSON.stringify({ status, date: "2024-06" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (href.includes("/maps/api/streetview?")) {
          return new Response(JPEG, {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          });
        }
        throw new Error(`unexpected fetch ${href}`);
      }),
    );

    expect((await maybeEnqueueStreetViewCoverBackfill()).enqueued).toBe(true);
    const queued = listMemoryJobsForTests().find(
      (job) => job.jobType === "site_inspection_street_view_backfill",
    )!;
    const claimed = await claimJobById(queued.id);
    expect(claimed).toBeTruthy();
    expect(await processJob(claimed!)).toBe("complete");
    const finished = await getJobById(queued.id);
    expect(finished?.metadata).toMatchObject({
      backfilled: 1,
      noCoverage: 1,
      failed: 1,
    });

    const { listSiteInspections } = await import("@/lib/inspections");
    const cards = await listSiteInspections();
    expect(cards.find((row) => row.id === covered.id)?.coverSource).toBe("street_view");
    expect(cards.find((row) => row.id === rural.id)?.coverSignedUrl).toBeNull();
    expect(cards.find((row) => row.id === broken.id)?.coverSignedUrl).toBeNull();
    expect(cards.find((row) => row.id === withPhoto.id)?.coverSource).toBe("photo");
    expect(
      calls.some((url) => url.includes("2+Photo+Way") || url.includes("2%20Photo%20Way")),
    ).toBe(false);
    expect(
      calls.some((url) => url.includes("/maps/api/streetview?") && url.includes("Rural")),
    ).toBe(false);

    const callsAfterFirst = calls.length;
    const second = await backfillPendingStreetViewCovers();
    expect(second.backfilled).toBe(0);
    expect(second.noCoverage).toBe(0);
    expect(second.failed).toBe(1);
    const coveredCalls = calls.filter(
      (url) => url.includes("1+Covered+St") || url.includes("1%20Covered%20St"),
    );
    expect(coveredCalls).toHaveLength(2);
    expect(calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
