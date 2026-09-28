/**
 * Street View is the default inspection card image until a cover photo is uploaded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  attachSiteInspectionPhoto,
  createSiteInspection,
  createTemplateFromSeed,
  deleteSiteInspectionMedia,
  listSiteInspections,
  resetInspectionTemplateMemoryForTests,
  resetSiteInspectionMediaMemoryForTests,
  resetSiteInspectionMemoryForTests,
  setSiteInspectionProfileNameForTests,
  updateSiteInspectionAddress,
  uploadSiteInspectionPhoto,
} from "@/lib/inspections";

const JPEG_A = Buffer.alloc(64, 0x11);
JPEG_A[0] = 0xff;
JPEG_A[1] = 0xd8;
JPEG_A[2] = 0xff;
const JPEG_B = Buffer.alloc(64, 0x22);
JPEG_B[0] = 0xff;
JPEG_B[1] = 0xd8;
JPEG_B[2] = 0xff;
const COVER_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

const savedEnv = {
  flag: process.env.SITE_INSPECTION_STREET_VIEW_FETCH,
  serverKey: process.env.GOOGLE_MAPS_SERVER_API_KEY,
  mapsKey: process.env.GOOGLE_MAPS_API_KEY,
  publicKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
};

beforeEach(() => {
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.SITE_INSPECTION_STREET_VIEW_FETCH = "1";
  process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-server-key";
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  resetEnvCacheForTests();
  resetInspectionTemplateMemoryForTests();
  resetSiteInspectionMemoryForTests();
  resetSiteInspectionMediaMemoryForTests();
  setSiteInspectionProfileNameForTests("user-1", "Field Tech");
});

afterEach(() => {
  if (savedEnv.flag === undefined) delete process.env.SITE_INSPECTION_STREET_VIEW_FETCH;
  else process.env.SITE_INSPECTION_STREET_VIEW_FETCH = savedEnv.flag;
  if (savedEnv.serverKey === undefined) delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
  else process.env.GOOGLE_MAPS_SERVER_API_KEY = savedEnv.serverKey;
  if (savedEnv.mapsKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = savedEnv.mapsKey;
  if (savedEnv.publicKey === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  else process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = savedEnv.publicKey;
  resetEnvCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockGoogle(input?: { status?: string; fail?: boolean }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      calls.push(href);
      if (input?.fail) throw new Error("google down");
      if (href.includes("streetview/metadata")) {
        const status =
          href.includes("9+Other+Rd") || href.includes("9%20Other%20Rd")
            ? "OK"
            : (input?.status ?? "OK");
        return new Response(JSON.stringify({ status, date: "2024-06" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (href.includes("/maps/api/streetview?")) {
        const image =
          href.includes("9+Other+Rd") || href.includes("9%20Other%20Rd") || href.includes("30.27")
            ? JPEG_B
            : JPEG_A;
        return new Response(image, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    }),
  );
  return calls;
}

async function inspectionAt(address: string) {
  const template = await createTemplateFromSeed(
    {
      name: "Cover template",
      standaloneItems: [
        { title: "Front Photo of Main House", guideNotes: "• x", isCoverPhotoSource: true },
      ],
      sections: [],
    },
    "admin-1",
  );
  return createSiteInspection({
    projectName: "Visit",
    address,
    templateId: template.id,
    createdBy: "user-1",
  });
}

describe("site inspection Street View covers", () => {
  it("stores one Street View image at creation and does not call Google again when listing", async () => {
    const calls = mockGoogle();
    const created = await inspectionAt("1 Covered St, Austin, TX");
    expect(created.coverSource).toBe("street_view");
    expect(created.coverSignedUrl).toBeTruthy();
    expect(created.streetViewCapturedOn).toBe("2024-06");
    expect(created.coverMediaId).toBeNull();
    const googleCallsAfterCreate = calls.length;
    expect(googleCallsAfterCreate).toBe(2);
    expect(calls.some((url) => url.includes("streetview/metadata"))).toBe(true);
    expect(calls.some((url) => url.includes("/maps/api/streetview?"))).toBe(true);

    await listSiteInspections();
    await listSiteInspections();
    expect(calls.length).toBe(googleCallsAfterCreate);

    const card = (await listSiteInspections()).find((row) => row.id === created.id)!;
    expect(card.coverSource).toBe("street_view");
    expect(card.coverSignedUrl).toBe(created.coverSignedUrl);
    const visible = JSON.stringify(card);
    expect(visible).not.toContain("test-server-key");
    expect(visible).not.toContain("maps.googleapis.com");
    expect(visible).not.toContain("GOOGLE_MAPS");
  });

  it("falls back to no cover when Street View has no imagery", async () => {
    const calls = mockGoogle({ status: "ZERO_RESULTS" });
    const created = await inspectionAt("Rural Route 4");
    expect(created.coverSignedUrl).toBeNull();
    expect(created.coverSource ?? null).toBeNull();
    expect(calls.some((url) => url.includes("/maps/api/streetview?"))).toBe(false);

    await listSiteInspections();
    expect(calls.filter((url) => url.includes("streetview/metadata"))).toHaveLength(1);
    const card = (await listSiteInspections()).find((row) => row.id === created.id)!;
    expect(card.coverSignedUrl).toBeNull();
  });

  it("lets an uploaded cover photo replace Street View and restores it when that photo is deleted", async () => {
    mockGoogle();
    const created = await inspectionAt("1 Covered St, Austin, TX");
    const streetUrl = created.coverSignedUrl;
    const cover = created.snapshot.standaloneItems[0]!;
    const uploaded = await uploadSiteInspectionPhoto({
      userId: "user-1",
      inspectionId: created.id,
      buffer: COVER_JPEG,
      filename: "front.jpg",
    });
    const withPhoto = await attachSiteInspectionPhoto({
      inspectionId: created.id,
      snapshotItemId: cover.id,
      storagePath: uploaded.storagePath,
      mimeType: uploaded.mimeType,
      byteSize: uploaded.sizeBytes,
      actorId: "user-1",
    });
    expect(withPhoto.coverSource).toBe("photo");
    expect(withPhoto.coverMediaId).toBeTruthy();
    expect(withPhoto.coverSignedUrl).toBeTruthy();
    expect(withPhoto.coverSignedUrl).not.toBe(streetUrl);

    const removed = await deleteSiteInspectionMedia({
      inspectionId: created.id,
      mediaId: withPhoto.coverMediaId!,
      actorId: "user-1",
    });
    expect(removed.coverMediaId).toBeNull();
    expect(removed.coverSource).toBe("street_view");
    expect(removed.coverSignedUrl).toBe(streetUrl);
  });

  it("refreshes the cached image when the address changes", async () => {
    const calls = mockGoogle();
    const created = await inspectionAt("1 Covered St, Austin, TX");
    const firstUrl = created.coverSignedUrl;
    const updated = await updateSiteInspectionAddress({
      inspectionId: created.id,
      address: "9 Other Rd, Austin, TX",
      actorId: "user-1",
    });
    expect(updated.address).toBe("9 Other Rd, Austin, TX");
    expect(updated.coverSource).toBe("street_view");
    expect(updated.coverSignedUrl).toBeTruthy();
    expect(updated.coverSignedUrl).not.toBe(firstUrl);
    expect(calls.length).toBe(4);
  });

  it("prefers stored coordinates over the address string and refreshes both on edit", async () => {
    const calls = mockGoogle();
    const template = await createTemplateFromSeed(
      {
        name: "Cover template",
        standaloneItems: [
          { title: "Front Photo of Main House", guideNotes: "• x", isCoverPhotoSource: true },
        ],
        sections: [],
      },
      "admin-1",
    );
    const created = await createSiteInspection({
      projectName: "Visit",
      address: "15170 woodard rd, San Jose",
      latitude: 37.4419,
      longitude: -122.143,
      templateId: template.id,
      createdBy: "user-1",
    });
    expect(created.latitude).toBe(37.4419);
    expect(created.longitude).toBe(-122.143);
    expect(created.coverSource).toBe("street_view");
    const locations = calls.map((url) => new URL(url).searchParams.get("location"));
    expect(locations).toContain("37.4419,-122.143");
    expect(locations).not.toContain("15170 woodard rd, San Jose");

    const updated = await updateSiteInspectionAddress({
      inspectionId: created.id,
      address: "9 Other Rd, Austin, TX",
      latitude: 30.27,
      longitude: -97.74,
      actorId: "user-1",
    });
    expect(updated.address).toBe("9 Other Rd, Austin, TX");
    expect(updated.latitude).toBe(30.27);
    expect(updated.longitude).toBe(-97.74);
    expect(updated.coverSignedUrl).not.toBe(created.coverSignedUrl);
    const later = calls.map((url) => new URL(url).searchParams.get("location"));
    expect(later).toContain("30.27,-97.74");
  });

  it("drops the previous Street View when an address change cannot be refreshed", async () => {
    mockGoogle();
    const created = await inspectionAt("1 Covered St, Austin, TX");
    expect(created.coverSignedUrl).toBeTruthy();

    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("google down");
      }),
    );
    const updated = await updateSiteInspectionAddress({
      inspectionId: created.id,
      address: "9 Other Rd, Austin, TX",
      actorId: "user-1",
    });
    expect(updated.address).toBe("9 Other Rd, Austin, TX");
    expect(updated.coverSignedUrl).toBeNull();
    expect(updated.coverSource ?? null).toBeNull();
  });

  it("still creates the inspection when Google fails or the key is missing", async () => {
    mockGoogle({ fail: true });
    const failed = await inspectionAt("1 Covered St, Austin, TX");
    expect(failed.id).toBeTruthy();
    expect(failed.coverSignedUrl).toBeNull();

    vi.unstubAllGlobals();
    delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
    resetEnvCacheForTests();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const missingKey = await inspectionAt("2 Covered St, Austin, TX");
    expect(missingKey.id).toBeTruthy();
    expect(missingKey.coverSignedUrl).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
