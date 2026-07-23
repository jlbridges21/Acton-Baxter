import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("production root route", () => {
  it("does not contain the Create Next App starter UI", () => {
    const rootPage = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(rootPage).not.toMatch(/To get started, edit the/);
    expect(rootPage).not.toMatch(/Deploy Now/);
    expect(rootPage).not.toMatch(/Looking for a starting point/);
    expect(rootPage).toMatch(/redirect\("\/login"\)/);
  });

  it("uses Acton metadata in the root layout", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/Acton Property Research/);
    expect(layout).not.toMatch(/Create Next App/);
    expect(layout).toMatch(/data-acton-app/);
  });

  it("has only one package.json at the project root", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      name: string;
    };
    expect(pkg.name).toBe("acton-property-research");
  });
});
