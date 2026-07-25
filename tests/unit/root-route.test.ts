import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getEnabledBaxterTools } from "@/lib/baxter/tools";

describe("Baxter platform shell", () => {
  it("home page renders Baxter Dashboard (not Create Next App starter)", () => {
    const rootPage = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(rootPage).not.toMatch(/To get started, edit the/);
    expect(rootPage).not.toMatch(/Deploy Now/);
    expect(rootPage).not.toMatch(/Looking for a starting point/);
    expect(rootPage).not.toMatch(/redirect\("\/login"\)/);
    expect(rootPage).toMatch(/BaxterDashboard/);
    expect(rootPage).toMatch(/requireActiveUser/);
  });

  it("uses Baxter metadata in the root layout", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/Baxter/);
    expect(layout).not.toMatch(/Create Next App/);
    expect(layout).toMatch(/data-baxter-app/);
    expect(layout).not.toMatch(/Acton Property Research/);
  });

  it("has only one package.json named baxter at the project root", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      name: string;
    };
    expect(pkg.name).toBe("baxter");
  });

  it("registers Property Research as the enabled Baxter tool at /dashboard", () => {
    const tools = getEnabledBaxterTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.key).toBe("property-research");
    expect(tools[0]?.href).toBe("/dashboard");
    expect(tools[0]?.enabled).toBe(true);
    expect(tools[0]?.icon).toBeTruthy();
  });

  it("uses tool-scoped navigation contexts", async () => {
    const { getNavContext } = await import("@/lib/baxter/tools");
    expect(getNavContext("/")).toBe("platform");
    expect(getNavContext("/reports/new")).toBe("property-research");
    expect(getNavContext("/admin/knowledge")).toBe("knowledge");
  });

  it("preserves Property Research routes", () => {
    const reportsNew = readFileSync(
      path.join(process.cwd(), "src/app/reports/new/page.tsx"),
      "utf8",
    );
    expect(reportsNew).toMatch(/requireActiveUser|requireUser/);
    const reportsList = readFileSync(path.join(process.cwd(), "src/app/reports/page.tsx"), "utf8");
    expect(reportsList).toMatch(/redirect\("\/dashboard"\)/);
  });

  it("defaults branding fallback title to Baxter", () => {
    const branding = readFileSync(path.join(process.cwd(), "src/lib/branding/types.ts"), "utf8");
    expect(branding).toMatch(/DEFAULT_REPORT_TITLE = "Baxter"/);
  });
});
