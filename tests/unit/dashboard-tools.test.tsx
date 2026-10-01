/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaxterDashboard } from "@/components/baxter/baxter-dashboard";
import { FLOOR_PLAN_LIBRARY_URL, getEnabledBaxterTools } from "@/lib/baxter/tools";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import { AppNav } from "@/components/layout/app-nav";

afterEach(() => cleanup());

describe("Floor Plan Library and QR tools", () => {
  it("shows both cards to every app-access role, with the library leaving Baxter", () => {
    for (const isAdmin of [false, true]) {
      const tools = getEnabledBaxterTools({ isAdmin });
      const floorPlan = tools.find((tool) => tool.key === "floor-plan-library");
      const qr = tools.find((tool) => tool.key === "qr-code");
      expect(floorPlan?.href).toBe(FLOOR_PLAN_LIBRARY_URL);
      expect(floorPlan?.external).toBe(true);
      expect(floorPlan?.adminOnly).toBeUndefined();
      expect(qr?.href).toBe("/tools/qr");
      expect(qr?.external).toBeUndefined();
    }
  });

  it("opens the Floor Plan Library in a new tab from the dashboard card", () => {
    const { unmount } = render(<BaxterDashboard isAdmin={false} />);
    const link = screen.getByRole("link", { name: /open floor plan library/i });
    expect(link.getAttribute("href")).toBe(FLOOR_PLAN_LIBRARY_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("Leaves Baxter")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open qr code generator/i }).getAttribute("href")).toBe(
      "/tools/qr",
    );
    unmount();

    render(<BaxterDashboard isAdmin />);
    const adminLink = screen.getByRole("link", { name: /open floor plan library/i });
    expect(adminLink.getAttribute("href")).toBe(FLOOR_PLAN_LIBRARY_URL);
    expect(adminLink.getAttribute("target")).toBe("_blank");
    expect(adminLink.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("opens the Floor Plan Library in a new tab from the nav", () => {
    render(
      <div style={{ width: 375 }}>
        <AppNav userName="Alex" userRole="user" userEmail="alex@actonadu.com" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const link = screen.getByRole("link", { name: /floor plan library/i });
    expect(link.getAttribute("href")).toBe(FLOOR_PLAN_LIBRARY_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("gates the QR page to any app-access role", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/tools/qr/page.tsx"), "utf8");
    expect(page).toMatch(/requireActiveUser/);
    expect(page).not.toMatch(/requireAdmin/);
  });
});
