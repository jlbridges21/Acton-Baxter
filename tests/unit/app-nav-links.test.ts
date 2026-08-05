import { describe, expect, it } from "vitest";
import { getAdminNavLinks, getAdminNavSections } from "@/lib/baxter/admin-nav";
import { getAppNavLinksForRole, getEmployeeNavLinks } from "@/lib/baxter/app-nav-links";

function labels(role: string, pathname = "/") {
  return getAppNavLinksForRole(role, pathname).map((link) => link.label);
}

const EMPLOYEE_NAV = [
  "Dashboard",
  "Knowledge Center",
  "PEM NEAT",
  "New Project Setup",
  "Property Research",
  "Customer Center",
  "Integrations",
  "Settings",
] as const;

describe("getAppNavLinksForRole", () => {
  it("gives super_admin the same full admin nav as admin", () => {
    const adminLabels = labels("admin");
    const superAdminLabels = labels("super_admin");
    const expected = getAdminNavLinks().map((link) => link.label);

    expect(adminLabels).toEqual(expected);
    expect(superAdminLabels).toEqual(expected);
    expect(superAdminLabels).toEqual(adminLabels);
    expect(superAdminLabels).toContain("Users");
    expect(superAdminLabels).toContain("Feedback");
    expect(superAdminLabels).toContain("Settings");
    expect(superAdminLabels).toContain("Connectors");
    expect(superAdminLabels).not.toContain("Integrations");
    expect(superAdminLabels).toContain("New Project Setup");
    expect(superAdminLabels).toContain("Project Setup Settings");
    expect(superAdminLabels).toContain("Diagnostics");
  });

  it("gives the standard user role a persistent 8-item primary nav on every page", () => {
    for (const pathname of [
      "/",
      "/dashboard",
      "/pem-neats",
      "/reports/abc",
      "/customers/lookup",
      "/knowledge",
      "/settings",
    ]) {
      expect(labels("user", pathname)).toEqual([...EMPLOYEE_NAV]);
    }
    expect(getEmployeeNavLinks().map((l) => l.label)).toEqual([...EMPLOYEE_NAV]);
  });

  it("routes Knowledge Center to the admin surface for admin and super_admin, /knowledge for user", () => {
    const knowledgeHref = (role: string) =>
      getAppNavLinksForRole(role).find((link) => link.label === "Knowledge Center")?.href;

    expect(knowledgeHref("admin")).toBe("/admin/knowledge");
    expect(knowledgeHref("super_admin")).toBe("/admin/knowledge");
    expect(knowledgeHref("user")).toBe("/knowledge");
  });

  it("keeps pending / unknown roles off the primary tool nav", () => {
    for (const role of ["new_user", "salesperson"] as const) {
      expect(labels(role)).toEqual([]);
    }
  });
});

describe("getAdminNavSections", () => {
  it("groups admin nav into Tools / Connectors / AI Governance / People & Org", () => {
    const sections = getAdminNavSections();
    expect(sections.map((s) => s.label)).toEqual([
      "Tools",
      "Connectors",
      "AI Governance",
      "People & Org",
    ]);
    expect(sections.find((s) => s.id === "tools")?.links.map((l) => l.label)).toEqual([
      "Dashboard",
      "Knowledge Center",
      "Jurisdictions & Codes",
      "PEM NEAT",
      "New Project Setup",
      "Property Research",
      "Customer Center",
    ]);
    expect(sections.find((s) => s.id === "connectors")?.links.map((l) => l.label)).toEqual([
      "Connectors",
      "Slack",
    ]);
  });
});
