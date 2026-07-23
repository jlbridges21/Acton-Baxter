import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("deployment identity", () => {
  it("returns Acton app metadata from /api/health", async () => {
    const response = await GET();
    const body = (await response.json()) as {
      app: string;
      packageName: string;
      starterPageExpected: boolean;
    };
    expect(response.status).toBe(200);
    expect(body.app).toBe("Acton Property Research");
    expect(body.packageName).toBe("acton-property-research");
    expect(body.starterPageExpected).toBe(false);
  });
});
