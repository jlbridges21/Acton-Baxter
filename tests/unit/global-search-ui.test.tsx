/**
 * @vitest-environment jsdom
 *
 * Global Search UI: header button placement, shortcuts, focus, debounced live typing,
 * highlighting, category pills, See all, keyboard navigation, stale responses, empty and
 * failure states, Ask Baxter hand-off, and responsive layout classes. Synthetic data only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  pathname: "/reports",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => router.pathname,
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: async () => undefined } }),
}));

import { AppNav } from "@/components/layout/app-nav";
import { GlobalSearch, isSearchShortcut } from "@/components/search/global-search";
import { ASK_BAXTER_DRAFT_KEY } from "@/lib/search/client";
import type { SearchHome, SearchResult, SearchStreamEvent } from "@/lib/search/types";

function result(over: Partial<SearchResult> & { id: string; title: string }): SearchResult {
  return {
    provider: "tools",
    category: "tools",
    subtitle: null,
    description: null,
    breadcrumb: [],
    highlight: { title: [], subtitle: [] },
    url: `/${over.id}`,
    external: false,
    icon: "package",
    avatarUrl: null,
    sourceSystem: "baxter",
    sourceLabel: "Baxter",
    recordId: over.id,
    updatedAt: null,
    freshness: { kind: "registry" },
    preview: [],
    auth: "internal",
    actions: [],
    tier: "prefix",
    score: 6000,
    addressKey: null,
    addressDisplay: null,
    ...over,
  };
}

const HOME: SearchHome = {
  categories: [
    { id: "tools", label: "Tools & Pages", icon: "layout-dashboard", providers: ["tools"] },
    { id: "jobs", label: "Jobs", icon: "folder-kanban", providers: ["jobtread-jobs"] },
    { id: "customers", label: "Customers", icon: "users-round", providers: ["ghl-contacts"] },
  ],
  recent: [
    result({
      id: "recent-1",
      title: "Recently opened report",
      provider: "reports",
      category: "reports",
    }),
  ],
  frequentTools: [result({ id: "inventory", title: "Inventory" })],
  pinnedReports: [],
  agents: [
    result({ id: "dexter", title: "Dexter", provider: "agents", category: "agents", icon: "bot" }),
  ],
  askBaxter: true,
};

function ndjson(events: SearchStreamEvent[]) {
  return new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", {
    headers: { "content-type": "application/x-ndjson" },
  });
}

type Handler = (url: URL) => Promise<Response> | Response;
let searchHandler: Handler;
const calls: URL[] = [];

function streamFor(
  query: string,
  results: SearchResult[],
  extra: Partial<Extract<SearchStreamEvent, { type: "provider" }>["outcome"]> = {},
) {
  return ndjson([
    { type: "start", query, providers: [{ provider: "tools", name: "Tools", category: "tools" }] },
    {
      type: "provider",
      outcome: {
        provider: results[0]?.provider ?? "tools",
        name: "Tools",
        category: results[0]?.category ?? "tools",
        status: results.length ? "ok" : "empty",
        message: null,
        count: results.length,
        hasMore: false,
        latencyMs: 3,
        freshness: { kind: "registry" },
        ...extra,
      },
      results,
    },
    { type: "done", tookMs: 12, addressGroups: [], askBaxter: true },
  ]);
}

beforeEach(() => {
  router.push.mockReset();
  router.pathname = "/reports";
  calls.length = 0;
  searchHandler = (url) => streamFor(url.searchParams.get("q") ?? "", []);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      calls.push(url);
      if (url.pathname === "/api/search/home") return Response.json(HOME);
      if (url.pathname === "/api/search/track") return Response.json({ stored: true });
      if (url.pathname === "/api/search") return searchHandler(url);
      if (url.pathname.startsWith("/api/reports/")) return Response.json({ ok: true });
      return new Response("not found", { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const searchCalls = () => calls.filter((c) => c.pathname === "/api/search");

async function openWithShortcut(meta = true) {
  fireEvent.keyDown(window, { key: "k", metaKey: meta, ctrlKey: !meta });
  return screen.findByTestId("global-search-modal");
}

describe("header button", () => {
  it("sits at the far right, immediately after the menu button, with the shortcut tooltip", () => {
    const platform = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
    render(<AppNav userName="Eli Employee" userRole="user" userEmail="eli@example.test" />);
    const search = screen.getByTestId("global-search-button") as HTMLButtonElement;
    const menu = screen.getByRole("button", { name: "Open navigation" }) as HTMLButtonElement;
    const group = menu.parentElement!;
    const controls = Array.from(group.querySelectorAll("button"));
    expect(controls.indexOf(search)).toBe(controls.indexOf(menu) + 1);
    expect(controls[controls.length - 1]).toBe(search);
    // Profile, logout, and menu are intact.
    expect(screen.getByText("Eli Employee")).toBeTruthy();
    expect(screen.getByRole("button", { name: /logout/i })).toBeTruthy();
    expect(screen.getByRole("tooltip").textContent).toBe("Search Baxter — ⌘K");
    expect(search.getAttribute("aria-label")).toBe("Search Baxter");
    platform.mockRestore();
  });

  it("shows Ctrl+K on Windows and Linux", () => {
    const platform = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
    render(<GlobalSearch />);
    expect(screen.getByRole("tooltip").textContent).toBe("Search Baxter — Ctrl+K");
    platform.mockRestore();
  });

  it("only Cmd/Ctrl+K triggers search, never plain typing", () => {
    const ev = (o: Partial<KeyboardEventInit>) => new KeyboardEvent("keydown", { key: "k", ...o });
    expect(isSearchShortcut(ev({ metaKey: true }))).toBe(true);
    expect(isSearchShortcut(ev({ ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(ev({}))).toBe(false);
    expect(isSearchShortcut(ev({ metaKey: true, shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(ev({ metaKey: true, altKey: true }))).toBe(false);
  });
});

describe("open, close, focus", () => {
  it("opens with ⌘K and Ctrl+K, focuses the input, closes with Escape, restores focus", async () => {
    render(<GlobalSearch />);
    const modal = await openWithShortcut(true);
    const input = within(modal).getByRole("combobox");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("placeholder")).toBe(
      "Search tools, reports, customers, jobs, agents, and more...",
    );
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("global-search-modal")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("global-search-button")),
    );
    await openWithShortcut(false);
    expect(screen.getByTestId("global-search-modal")).toBeTruthy();
  });

  it("does not open when typing a plain 'k' in a text field", () => {
    render(
      <>
        <input aria-label="notes" />
        <GlobalSearch />
      </>,
    );
    const notes = screen.getByLabelText("notes");
    notes.focus();
    fireEvent.keyDown(notes, { key: "k" });
    fireEvent.change(notes, { target: { value: "k" } });
    expect(screen.queryByTestId("global-search-modal")).toBeNull();
  });

  it("opens from the button and closes from the backdrop", async () => {
    render(<GlobalSearch />);
    fireEvent.click(screen.getByTestId("global-search-button"));
    expect(await screen.findByTestId("global-search-modal")).toBeTruthy();

    fireEvent.mouseDown(screen.getByTestId("global-search-backdrop"));
    expect(screen.queryByTestId("global-search-modal")).toBeNull();
  });

  it("is near full-screen on phones and a floating panel on larger screens", async () => {
    render(<GlobalSearch />);
    const modal = await openWithShortcut();
    expect(modal.className).toMatch(/(^|\s)inset-0(\s|$)/);
    expect(modal.className).toContain("sm:max-w-2xl");
    expect(modal.className).toContain("sm:rounded-2xl");
    expect(modal.className).toContain("sm:max-h-[72vh]");
  });
});

describe("empty query view", () => {
  it("shows recents, frequent tools, agents, and only the permitted categories", async () => {
    render(<GlobalSearch />);
    const modal = await openWithShortcut();
    expect(await within(modal).findByText("Recently opened report")).toBeTruthy();
    expect(within(modal).getByText("Inventory")).toBeTruthy();
    expect(within(modal).getByText("Dexter")).toBeTruthy();
    const pills = within(modal)
      .getAllByRole("tab")
      .map((t) => t.textContent);
    expect(pills).toEqual(["All", "Tools & Pages", "Jobs", "Customers"]);
  });

  it("loads the home view once per open (no request loop)", async () => {
    render(<GlobalSearch />);
    const modal = await openWithShortcut();
    await within(modal).findByText("Recently opened report");
    await act(() => new Promise((r) => setTimeout(r, 120)));
    expect(calls.filter((c) => c.pathname === "/api/search/home")).toHaveLength(1);
  });
});

describe("live typing", () => {
  it("debounces keystrokes into one request and highlights matches", async () => {
    searchHandler = (url) =>
      streamFor(url.searchParams.get("q") ?? "", [
        result({
          id: "inventory",
          title: "Inventory",
          highlight: { title: [[0, 3]], subtitle: [] },
        }),
      ]);
    render(<GlobalSearch />);
    const modal = await openWithShortcut();
    const input = within(modal).getByRole("combobox");
    fireEvent.change(input, { target: { value: "i" } });
    fireEvent.change(input, { target: { value: "in" } });
    fireEvent.change(input, { target: { value: "inv" } });
    expect(searchCalls()).toHaveLength(0);
    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    expect(searchCalls()[0]!.searchParams.get("q")).toBe("inv");
    const mark = await within(modal).findByText("Inv", { selector: "mark" });
    expect(mark.parentElement?.textContent).toBe("Inventory");
  });

  it("ignores an older response that arrives after a newer one", async () => {
    let releaseOld: (r: Response) => void = () => undefined;
    searchHandler = (url) => {
      const q = url.searchParams.get("q");
      if (q === "alp") return new Promise<Response>((resolve) => (releaseOld = resolve));
      return streamFor(q ?? "", [result({ id: "new", title: "New alpha result" })]);
    };
    render(<GlobalSearch />);
    const modal = await openWithShortcut();
    const input = within(modal).getByRole("combobox");
    fireEvent.change(input, { target: { value: "alp" } });
    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    fireEvent.change(input, { target: { value: "alpha" } });
    expect(await within(modal).findByText("New alpha result")).toBeTruthy();
    releaseOld(streamFor("alp", [result({ id: "old", title: "Old stale result" })]));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(within(modal).queryByText("Old stale result")).toBeNull();
    expect(within(modal).getByText("New alpha result")).toBeTruthy();
  });

  it("filters by category pill, Tab cycles categories, and See all opens the category", async () => {
    searchHandler = (url) =>
      streamFor(
        url.searchParams.get("q") ?? "",
        [
          result({
            id: "j1",
            title: "Test Project 1",
            provider: "jobtread-jobs",
            category: "jobs",
            sourceLabel: "JobTread",
          }),
        ],
        { hasMore: true, count: 12, provider: "jobtread-jobs", category: "jobs" },
      );
    render(<GlobalSearch />);
    const modal = await openWithShortcut();
    await within(modal).findByText("Recently opened report");
    const input = within(modal).getByRole("combobox");
    fireEvent.change(input, { target: { value: "test" } });
    expect(await within(modal).findByText(/12\+ results/)).toBeTruthy();
    fireEvent.click(within(modal).getByRole("button", { name: /see all/i }));
    await waitFor(() => expect(searchCalls().at(-1)!.searchParams.get("category")).toBe("jobs"));
    expect(within(modal).getByRole("tab", { name: "Jobs" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.keyDown(input, { key: "Tab" });
    await waitFor(() =>
      expect(searchCalls().at(-1)!.searchParams.get("category")).toBe("customers"),
    );
    fireEvent.click(within(modal).getByRole("tab", { name: "All" }));
    await waitFor(() => expect(searchCalls().at(-1)!.searchParams.get("category")).toBeNull());
  });

  it("navigates with arrows and opens with Enter (tracking the open)", async () => {
    searchHandler = (url) =>
      streamFor(url.searchParams.get("q") ?? "", [
        result({ id: "a", title: "Alpha one", tier: "exact" }),
        result({ id: "b", title: "Alpha two" }),
      ]);
    render(<GlobalSearch />);
    const modal = await openWithShortcut();
    const input = within(modal).getByRole("combobox");
    fireEvent.change(input, { target: { value: "alpha" } });
    await within(modal).findByText("Alpha two");
    const options = () => within(modal).getAllByRole("option");
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(router.push).toHaveBeenCalledWith("/b");
    expect(calls.some((c) => c.pathname === "/api/search/track")).toBe(true);
    expect(screen.queryByTestId("global-search-modal")).toBeNull();
  });
});

describe("empty and failure states", () => {
  it("says 'no results' only when every source answered", async () => {
    render(<GlobalSearch />);
    const modal = await openWithShortcut();
    fireEvent.change(within(modal).getByRole("combobox"), { target: { value: "zzqx" } });
    const empty = await within(modal).findByTestId("search-no-results");
    expect(empty.textContent).toContain("No results for “zzqx”");
  });

  it("tells an unavailable provider apart from no results", async () => {
    searchHandler = (url) =>
      streamFor(url.searchParams.get("q") ?? "", [], {
        provider: "bamboohr-employees",
        name: "BambooHR employees",
        category: "employees",
        status: "unavailable",
        message: "BambooHR isn't connected.",
      });
    render(<GlobalSearch />);
    const modal = await openWithShortcut();
    fireEvent.change(within(modal).getByRole("combobox"), { target: { value: "riley" } });
    const empty = await within(modal).findByTestId("search-no-results");
    expect(empty.textContent).toContain("No results from the sources that answered");
    expect(empty.textContent).toContain("BambooHR employees couldn't be searched");
    expect(within(modal).getByTestId("provider-notices").textContent).toContain(
      "BambooHR isn't connected.",
    );
  });

  it("Ask Baxter keeps the query and hands it to the chat", async () => {
    render(<GlobalSearch />);
    const modal = await openWithShortcut();
    fireEvent.change(within(modal).getByRole("combobox"), {
      target: { value: "how do permits work" },
    });
    const ask = await within(modal).findByText("Ask Baxter");
    fireEvent.click(ask);
    expect(window.sessionStorage.getItem(ASK_BAXTER_DRAFT_KEY)).toBe("how do permits work");
    expect(router.push).toHaveBeenCalledWith("/");
  });

  it("shows cached freshness, never as live", async () => {
    searchHandler = (url) =>
      streamFor(url.searchParams.get("q") ?? "", [
        result({
          id: "j1",
          title: "Test Project 1",
          provider: "jobtread-jobs",
          category: "jobs",
          sourceLabel: "JobTread",
          freshness: {
            kind: "cached",
            syncedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
            label: "Last synced",
          },
        }),
      ]);
    render(<GlobalSearch />);
    const modal = await openWithShortcut();
    fireEvent.change(within(modal).getByRole("combobox"), { target: { value: "test" } });
    const source = await within(modal).findByTestId("result-source");
    expect(source.textContent).toBe("JobTread · Last synced 12 min ago");
  });
});
