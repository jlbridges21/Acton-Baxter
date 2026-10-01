/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BaxterDashboard } from "@/components/baxter/baxter-dashboard";
import { DASHBOARD_TOOLS_VIEW_STORAGE_KEY } from "@/lib/baxter/dashboard-tools-view";
import {
  BAXTER_ADMIN_CARDS,
  FLOOR_PLAN_LIBRARY_URL,
  getEnabledBaxterTools,
} from "@/lib/baxter/tools";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("dashboard tools layout", () => {
  it("switches between card and list views and keeps the choice", async () => {
    const tools = getEnabledBaxterTools({ isAdmin: false });
    const first = render(
      <div style={{ width: 375 }}>
        <BaxterDashboard />
      </div>,
    );

    const gridButton = screen.getByRole("button", { name: "Grid view" });
    const listButton = screen.getByRole("button", { name: "List view" });
    expect(gridButton.getAttribute("aria-pressed")).toBe("true");
    expect(gridButton.className).toContain("bg-[var(--acton-navy)]");
    expect(listButton.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("dashboard-tool-grid")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-tool-list")).toBeNull();
    expect((first.container.firstElementChild as HTMLElement).style.width).toBe("375px");

    fireEvent.click(listButton);
    expect(listButton.getAttribute("aria-pressed")).toBe("true");
    expect(listButton.className).toContain("bg-[var(--acton-navy)]");
    expect(gridButton.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("dashboard-tool-grid")).toBeNull();

    const list = screen.getByTestId("dashboard-tool-list");
    expect(list.className).toContain("overflow-hidden");
    for (const tool of tools) {
      expect(screen.getByText(tool.name)).toBeTruthy();
      expect(screen.getByText(tool.description)).toBeTruthy();
      expect(screen.getByRole("link", { name: new RegExp(tool.ctaLabel, "i") })).toBeTruthy();
    }
    const floorPlan = screen.getByRole("link", { name: /open floor plan library/i });
    expect(floorPlan.getAttribute("href")).toBe(FLOOR_PLAN_LIBRARY_URL);
    expect(floorPlan.getAttribute("target")).toBe("_blank");
    expect(floorPlan.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("Leaves Baxter")).toBeTruthy();
    expect(window.localStorage.getItem(DASHBOARD_TOOLS_VIEW_STORAGE_KEY)).toBe("list");

    const row = list.querySelector("li");
    expect(row?.className).toContain("flex-col");
    expect(row?.className).toContain("min-w-0");
    first.unmount();

    render(<BaxterDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-tool-list")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "List view" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("uses the same view for admin-only cards", () => {
    render(<BaxterDashboard isAdmin />);
    expect(screen.getByTestId("dashboard-tool-grid")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open integrations/i })).toBeTruthy();
    expect(screen.queryByTestId("dashboard-tool-list")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    const list = screen.getByTestId("dashboard-tool-list");
    expect(screen.queryByTestId("dashboard-tool-grid")).toBeNull();
    for (const card of BAXTER_ADMIN_CARDS) {
      expect(screen.getByText(card.name)).toBeTruthy();
      expect(screen.getByText(card.description)).toBeTruthy();
      expect(screen.getByRole("link", { name: new RegExp(card.ctaLabel, "i") })).toBeTruthy();
    }
    expect(list.querySelectorAll("li").length).toBe(
      getEnabledBaxterTools({ isAdmin: true }).length + BAXTER_ADMIN_CARDS.length,
    );
  });
});
