import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("deployment identity", () => {
  it("returns Baxter app metadata from /api/health", async () => {
    const response = await GET();
    const body = (await response.json()) as {
      app: string;
      packageName: string;
      starterPageExpected: boolean;
      tools?: string[];
    };
    expect(response.status).toBe(200);
    expect(body.app).toBe("Baxter");
    expect(body.packageName).toBe("baxter");
    expect(body.starterPageExpected).toBe(false);
    expect(body.tools).toContain("property-research");
  });
});
