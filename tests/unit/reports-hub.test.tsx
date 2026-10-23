/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { ReportsHub } from "@/components/report-builder/reports-hub";

const perm = { canView: true, canEdit: true, canShare: true, canDelete: true };
const tpl = (key: string, title: string) => ({
  id: `t-${key}`,
  title,
  description: `${title} template`,
  ownerId: null,
  isMine: false,
  visibility: "company",
  isTemplate: true,
  templateKey: key,
  status: "active",
  pinned: false,
  version: 1,
  widgetCount: 3,
  sources: ["jobs"],
  createdByDexter: false,
  updatedAt: new Date().toISOString(),
  viewedAt: null,
  shareCount: 0,
  permission: { ...perm, canEdit: false, canDelete: false },
  groupIds: [],
});
const rep = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  description: "",
  ownerId: "me",
  isMine: true,
  visibility: "private",
  isTemplate: false,
  templateKey: null,
  status: "active",
  pinned: false,
  version: 1,
  widgetCount: 2,
  sources: ["jobs"],
  createdByDexter: false,
  updatedAt: new Date().toISOString(),
  viewedAt: null,
  shareCount: 0,
  permission: perm,
  groupIds: [],
  ...extra,
});

let state: {
  suggestions: unknown[];
  prefs: { suggestionsCollapsed: boolean; templatesCollapsed: boolean };
};
let calls: Array<{ url: string; method: string; body: unknown }>;

function install() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (b: unknown) =>
        new Response(JSON.stringify(b), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (url === "/api/reports" && method === "GET")
        return json({
          reports: [
            tpl("active_projects", "Active Projects"),
            tpl("sales_commissions", "Sales Commissions"),
            tpl("product_library", "Product Library"),
            tpl("design_handoff", "Design Handoff"),
            tpl("blank", "Blank report"),
            rep("r1", "Commission check", { groupIds: ["g-sales"], pinned: true }),
            rep("r2", "Shared pipeline", { isMine: false, groupIds: ["g-sales"] }),
            rep("r3", "Loose report"),
          ],
          groups: [
            {
              id: "g-sales",
              name: "Sales",
              description: "",
              color: "green",
              icon: "dollar",
              scope: "personal",
              isMine: true,
              canManage: true,
              reportCount: 2,
              sortOrder: 0,
              archived: false,
            },
          ],
          access: { canChat: true, canManage: false, isAdmin: false, categories: [] },
        });
      if (url === "/api/reports/suggestions") return json({ suggestions: state.suggestions });
      if (url === "/api/reports/prefs" && method === "GET") return json({ prefs: state.prefs });
      if (url === "/api/reports/prefs" && method === "PUT")
        return json({ prefs: { ...state.prefs, ...(JSON.parse(String(init!.body)) as object) } });
      return json({});
    }),
  );
}

beforeEach(() => {
  state = {
    suggestions: [
      {
        key: "pm_workload",
        title: "Project Manager Workload",
        description: "Active projects per PM",
        prompt: "Create a PM workload report",
        status: "ready",
        state: "available",
      },
    ],
    prefs: { suggestionsCollapsed: false, templatesCollapsed: false },
  };
  install();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Reports home", () => {
  it("shows exactly four templates in order, without Sales Commissions", async () => {
    render(<ReportsHub dexterAvatarUrl={null} />);
    const gallery = await screen.findByTestId("template-gallery");
    const titles = within(gallery)
      .getAllByText(/./, { selector: "p.font-semibold" })
      .map((p) => p.textContent);
    expect(titles).toEqual([
      "Active Projects",
      "Design Handoff",
      "Product Library",
      "Blank Report",
    ]);
    expect(within(gallery).queryByText("Sales Commissions")).toBeNull();
    expect(gallery.className).toMatch(/lg:grid-cols-4/);
  });

  it("collapses each section independently, with correct semantics, and saves the preference", async () => {
    render(<ReportsHub dexterAvatarUrl={null} />);
    const sugg = await screen.findByRole("button", { name: /Suggested reports/ });
    const tpls = screen.getByRole("button", { name: /Start from a template/ });
    expect(sugg.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(sugg);
    expect(sugg.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Project Manager Workload")).toBeNull();
    expect(tpls.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("template-gallery")).toBeTruthy();
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url === "/api/reports/prefs" &&
            c.method === "PUT" &&
            JSON.stringify(c.body) === '{"suggestionsCollapsed":true}',
        ),
      ).toBe(true),
    );
  });

  it("restores saved collapse preferences", async () => {
    state.prefs = { suggestionsCollapsed: true, templatesCollapsed: true };
    render(<ReportsHub dexterAvatarUrl={null} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Start from a template/ }).getAttribute("aria-expanded"),
      ).toBe("false"),
    );
    expect(screen.queryByTestId("template-gallery")).toBeNull();
  });

  it("hides Suggested reports entirely when there are none, so templates move up", async () => {
    state.suggestions = [];
    render(<ReportsHub dexterAvatarUrl={null} />);
    await screen.findByTestId("template-gallery");
    expect(screen.queryByText(/Suggested reports/)).toBeNull();
  });

  it("links Build with Dexter with the suggestion id and lets users dismiss", async () => {
    render(<ReportsHub dexterAvatarUrl={null} />);
    const link = await screen.findByRole("link", { name: /Build with Dexter/ });
    expect(link.getAttribute("href")).toContain("suggestion=pm_workload");
    fireEvent.click(
      screen.getByRole("button", { name: /Dismiss suggestion: Project Manager Workload/ }),
    );
    expect(screen.queryByText("Project Manager Workload")).toBeNull();
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/reports/suggestions" && c.method === "POST")).toBe(
        true,
      ),
    );
  });

  it("filters by group, combines with tabs and search, and shows the filter state", async () => {
    render(<ReportsHub dexterAvatarUrl={null} />);
    await screen.findByText("Commission check");
    const bar = screen.getByRole("navigation", { name: "Report groups" });
    fireEvent.click(within(bar).getByRole("button", { name: /Sales/ }));
    expect(screen.getByText("Commission check")).toBeTruthy();
    expect(screen.getByText("Shared pipeline")).toBeTruthy();
    expect(screen.queryByText("Loose report")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "My reports" }));
    expect(screen.queryByText("Shared pipeline")).toBeNull(); // tab + group combine
    expect(screen.getByText("Commission check")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search in Sales"), { target: { value: "zzz" } });
    expect(screen.getByText(/Searching only in/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search all groups" }));
    expect(
      within(bar)
        .getByRole("button", { name: /All groups/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.change(screen.getByPlaceholderText("Search reports"), { target: { value: "" } });
    fireEvent.click(within(bar).getByRole("button", { name: /Ungrouped/ }));
    expect(screen.getByText("Loose report")).toBeTruthy();
    expect(screen.queryByText("Commission check")).toBeNull();
  });

  it("gives each report a compact actions menu", async () => {
    render(<ReportsHub dexterAvatarUrl={null} />);
    await screen.findByText("Loose report");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Loose report" }));
    for (const label of [
      "Open",
      "Rename",
      "Add to group…",
      "Duplicate",
      "Pin",
      "Share…",
      "Archive",
      "Delete",
    ]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
    }
  });
});
