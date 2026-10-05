import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireActiveUser: vi.fn(async () => ({ id: "user" })),
}));

vi.mock("@/lib/tours/store", () => ({
  tourExists: vi.fn(),
  getScenePath: vi.fn(),
  getTourSlug: vi.fn(async () => null),
  writeHotspotRow: vi.fn(async () => ({ error: null })),
}));

import { requireActiveUser } from "@/lib/auth/session";
import { saveHotspot } from "@/lib/tours/actions";
import { getScenePath, tourExists, writeHotspotRow } from "@/lib/tours/store";

const tourId = "11111111-1111-4111-8111-111111111111";
const sceneId = "22222222-2222-4222-8222-222222222222";
const hotspotId = "33333333-3333-4333-8333-333333333333";

function input() {
  return {
    tourId,
    sceneId,
    hotspotId,
    type: "link" as const,
    yaw: 0.2,
    pitch: 0.1,
    label: null,
    content: null,
    targetSceneId: null,
    styleShape: "arrow" as const,
    styleColor: "#FFFFFF",
    styleSize: 48,
    styleRotation: 0,
    stylePlacement: "billboard" as const,
  };
}

describe("saveHotspot access", () => {
  beforeEach(() => {
    vi.mocked(requireActiveUser).mockResolvedValue({ id: "user" } as Awaited<
      ReturnType<typeof requireActiveUser>
    >);
    vi.mocked(tourExists).mockResolvedValue(true);
    vi.mocked(getScenePath).mockResolvedValue({
      id: sceneId,
      storage_path: "tour/scene.jpg",
      compat_path: null,
      thumbnail_path: null,
    });
    vi.mocked(writeHotspotRow).mockClear();
  });

  it("rejects a tour the caller cannot access before writing", async () => {
    vi.mocked(tourExists).mockResolvedValue(false);
    const missingTour = await saveHotspot(input());
    expect(missingTour.error).toBe("That tour was not found.");
    expect(writeHotspotRow).not.toHaveBeenCalled();

    vi.mocked(tourExists).mockResolvedValue(true);
    vi.mocked(getScenePath).mockResolvedValue(null);
    const missingScene = await saveHotspot(input());
    expect(missingScene.error).toBe("That scene was not found.");
    expect(writeHotspotRow).not.toHaveBeenCalled();

    vi.mocked(requireActiveUser).mockRejectedValue(new Error("Admin access required"));
    await expect(saveHotspot(input())).rejects.toThrow("Admin access required");
    expect(writeHotspotRow).not.toHaveBeenCalled();
  });

  it("writes a new hotspot through the same full-row action", async () => {
    const result = await saveHotspot(input());
    expect(result.error).toBeNull();
    expect(writeHotspotRow).toHaveBeenCalledOnce();
    expect(vi.mocked(writeHotspotRow).mock.calls[0]?.[0]).toMatchObject({
      id: hotspotId,
      sceneId,
      yaw: 0.2,
      styleShape: "arrow",
    });
  });
});
