import { describe, expect, it } from "vitest";
import { buildGoogleMapLinks, buildGoogleStaticImageUrl } from "@/lib/providers/google/imagery";
import { resetEnvCacheForTests } from "@/lib/env";

describe("Google property imagery helpers", () => {
  it("builds Google Maps and Street View deep links", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
    resetEnvCacheForTests();

    const links = buildGoogleMapLinks({
      address: "655 13th St, San Jose, CA 95112",
      latitude: 37.34521,
      longitude: -121.88045,
    });

    expect(links.googleMapsUrl).toContain("google.com/maps/search");
    expect(links.streetViewUrl).toContain("map_action=pano");
    expect(links.streetViewUrl).toContain("37.34521");
    expect(links.satelliteImageAvailable).toBe(false);
    expect(
      buildGoogleStaticImageUrl({
        view: "parcel",
        latitude: 37.34521,
        longitude: -121.88045,
        parcelGeometry: {
          type: "Polygon",
          coordinates: [
            [
              [-121.881, 37.345],
              [-121.88, 37.345],
              [-121.88, 37.346],
              [-121.881, 37.345],
            ],
          ],
        },
      }),
    ).toBeNull();
  });
});
