import { describe, expect, it } from "vitest";
import { getAdminNavLinks } from "@/lib/baxter/admin-nav";
import { getAppNavLinksForRole } from "@/lib/baxter/app-nav-links";

function labels(role: string, pathname = "/") {
  return getAppNavLinksForRole(role, pathname).map((link) => link.label);
}

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
  });

  it("keeps non-admin roles on the sparse employee/account menu", () => {
    for (const role of ["user", "new_user", "salesperson"] as const) {
      const linkLabels = labels(role);
      expect(linkLabels).toEqual(["Baxter Dashboard", "Integrations"]);
      expect(linkLabels).not.toContain("Users");
      expect(linkLabels).not.toContain("Feedback");
    }
  });
});
