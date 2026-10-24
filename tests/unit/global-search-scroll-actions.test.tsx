/**
 * @vitest-environment jsdom
 *
 * Global Search results list: manual scrolling is never overridden (hover, streamed provider
 * results, re-renders), arrow keys reveal the selection, a new query starts at the top; and
 * the customer copy-phone / copy-email actions are distinct, labelled, and copy without
 * opening the record. Synthetic data only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/reports",
  useSearchParams: () => new URLSearchParams(""),
}));

import { GlobalSearch } from "@/components/search/global-search";
import { revealInList } from "@/components/search/search-modal";
import type {
  ProviderOutcome,
  SearchHome,
  SearchResult,
  SearchResultAction,
  SearchStreamEvent,
} from "@/lib/search/types";

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
  categories: [],
  recent: [],
  frequentTools: [],
  pinnedReports: [],
  agents: [],
  askBaxter: false,
};

function outcome(over: Partial<ProviderOutcome> & { provider: string }): ProviderOutcome {
  return {
    name: over.provider,
    category: "tools",
    status: "ok",
    message: null,
    count: 0,
    hasMore: false,
    latencyMs: 3,
    freshness: { kind: "registry" },
    ...over,
  };
}

/** A search response whose NDJSON events the test releases one at a time. */
function controlledStream() {
  let push: (e: SearchStreamEvent) => void = () => undefined;
  let close: () => void = () => undefined;
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      push = (e) => c.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      close = () => c.close();
    },
  });
  return {
    response: new Response(body, { headers: { "content-type": "application/x-ndjson" } }),
    push: (e: SearchStreamEvent) => act(async () => push(e)),
    close: () => act(async () => close()),
  };
}

const many = (prefix: string, n: number, provider = "tools", category = "tools" as const) =>
  Array.from({ length: n }, (_, i) =>
    result({ id: `${prefix}-${i}`, title: `${prefix} result ${i}`, provider, category }),
  );

let streams: Array<ReturnType<typeof controlledStream>> = [];
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  router.push.mockReset();
  streams = [];
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as never;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/search/home") return Response.json(HOME);
      if (url.pathname === "/api/search/track") return Response.json({ stored: true });
      if (url.pathname === "/api/search") {
        const s = controlledStream();
        streams.push(s);
        return s.response;
      }
      return new Response("not found", { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function openAndType(q: string) {
  render(<GlobalSearch />);
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  const modal = await screen.findByTestId("global-search-modal");
  const input = within(modal).getByRole("combobox");
  fireEvent.change(input, { target: { value: q } });
  await waitFor(() => expect(streams.length).toBeGreaterThan(0));
  const list = within(modal).getByRole("listbox");
  return { modal, input, list, stream: streams.at(-1)! };
}

/** jsdom has no layout: give the list a real, writable scroll position. */
function scrollable(list: HTMLElement) {
  let top = 0;
  Object.defineProperty(list, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => (top = Math.max(0, v)),
  });
  return {
    get top() {
      return top;
    },
    userScrollTo(v: number) {
      top = v;
      fireEvent.wheel(list, { deltaY: 120 });
      fireEvent.scroll(list);
    },
  };
}

describe("results scrolling", () => {
  it("keeps the user's scroll position while more providers stream into the same search", async () => {
    const { modal, list, stream } = await openAndType("synthetic");
    const pos = scrollable(list);
    await stream.push({
      type: "start",
      query: "synthetic",
      providers: [
        { provider: "tools", name: "Tools", category: "tools" },
        { provider: "jobtread-jobs", name: "Jobs", category: "jobs" },
        { provider: "knowledge", name: "Knowledge", category: "knowledge" },
      ],
    });
    await stream.push({
      type: "provider",
      outcome: outcome({ provider: "tools", count: 5 }),
      results: many("Tool", 5),
    });
    await within(modal).findByText("Tool result 4");

    // Wheel / trackpad scroll down, then the pointer rests on (hovers) a row.
    pos.userScrollTo(640);
    fireEvent.mouseMove(within(modal).getByText("Tool result 3"));

    // Slower providers answer 0.5–1 s later for the same query.
    await stream.push({
      type: "provider",
      outcome: outcome({ provider: "jobtread-jobs", category: "jobs", count: 5 }),
      results: many("Job", 5, "jobtread-jobs", "jobs" as never),
    });
    await stream.push({
      type: "provider",
      outcome: outcome({ provider: "knowledge", category: "knowledge", count: 5 }),
      results: many("Article", 5, "knowledge", "knowledge" as never),
    });
    await stream.push({ type: "done", tookMs: 900, addressGroups: [], askBaxter: false });
    await stream.close();
    await within(modal).findByText("Article result 4");

    expect(pos.top).toBe(640);
    expect(scrollIntoView).not.toHaveBeenCalled();
    // Hover highlighted the row without scrolling anything.
    const hovered = within(modal).getByText("Tool result 3").closest('[role="option"]')!;
    expect(hovered.getAttribute("aria-selected")).toBe("true");
  });

  it("hovering rows never scrolls, even at the list's edge", async () => {
    const { modal, list, stream } = await openAndType("synthetic");
    const pos = scrollable(list);
    await stream.push({
      type: "provider",
      outcome: outcome({ provider: "tools", count: 5 }),
      results: many("Tool", 5),
    });
    await within(modal).findByText("Tool result 4");
    pos.userScrollTo(300);
    for (const i of [1, 2, 3, 4]) fireEvent.mouseMove(within(modal).getByText(`Tool result ${i}`));
    expect(pos.top).toBe(300);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("arrow keys move the selection and reveal it inside the list when it's out of view", async () => {
    const { modal, input, list, stream } = await openAndType("synthetic");
    const pos = scrollable(list);
    await stream.push({
      type: "provider",
      outcome: outcome({ provider: "tools", count: 3 }),
      results: many("Tool", 3),
    });
    await within(modal).findByText("Tool result 2");
    const options = () => within(modal).getAllByRole("option");
    list.getBoundingClientRect = () => ({ top: 100, bottom: 400 }) as DOMRect;
    // Second row is below the visible area.
    options()[1]!.getBoundingClientRect = () => ({ top: 420, bottom: 470 }) as DOMRect;

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    expect(pos.top).toBe(74); // 470 - 400 + 4: the smallest scroll that shows the row

    // Up again: the first row is above the view now.
    options()[0]!.getBoundingClientRect = () => ({ top: 40, bottom: 90 }) as DOMRect;
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(pos.top).toBe(10); // 74 - (100 - 40 + 4)
    expect(scrollIntoView).not.toHaveBeenCalled(); // only the list scrolls, never the page

    fireEvent.keyDown(input, { key: "Enter" });
    expect(router.push).toHaveBeenCalledWith("/Tool-0");
  });

  it("a genuinely new query starts at the top with the first result selected", async () => {
    const { modal, input, list, stream } = await openAndType("synthetic");
    const pos = scrollable(list);
    await stream.push({
      type: "provider",
      outcome: outcome({ provider: "tools", count: 5 }),
      results: many("Tool", 5),
    });
    await within(modal).findByText("Tool result 4");
    fireEvent.mouseMove(within(modal).getByText("Tool result 3"));
    pos.userScrollTo(500);

    fireEvent.change(input, { target: { value: "different" } });
    await waitFor(() => expect(streams).toHaveLength(2));
    // Until the new search answers, the old results (and position) stay put.
    expect(pos.top).toBe(500);
    await streams[1]!.push({
      type: "provider",
      outcome: outcome({ provider: "tools", count: 2 }),
      results: many("Other", 2),
    });
    await within(modal).findByText("Other result 1");
    expect(pos.top).toBe(0);
    expect(within(modal).getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("revealInList scrolls by the smallest amount and leaves visible rows alone", () => {
    const list = document.createElement("div");
    let top = 50;
    Object.defineProperty(list, "scrollTop", { get: () => top, set: (v) => (top = v) });
    list.getBoundingClientRect = () => ({ top: 0, bottom: 200 }) as DOMRect;
    const row = document.createElement("div");
    row.getBoundingClientRect = () => ({ top: 20, bottom: 60 }) as DOMRect;
    revealInList(list, row);
    expect(top).toBe(50);
    row.getBoundingClientRect = () => ({ top: 190, bottom: 230 }) as DOMRect;
    revealInList(list, row);
    expect(top).toBe(84);
  });
});

describe("customer copy actions", () => {
  const contact = (actions: SearchResultAction[]) =>
    result({
      id: "ghl-contacts:ghlContact001",
      title: "Jordan Sample",
      provider: "ghl-contacts",
      category: "customers",
      url: "/customers/lookup?contactId=ghlContact001",
      sourceSystem: "gohighlevel",
      sourceLabel: "GoHighLevel",
      actions,
    });
  const FULL: SearchResultAction[] = [
    { kind: "copy", label: "Copy phone number", value: "(555) 010-2030", field: "phone" },
    { kind: "copy", label: "Copy email address", value: "jordan@example.test", field: "email" },
    { kind: "open", label: "Open customer", href: "/admin/connectors/ghl/contacts/ghlContact001" },
  ];

  async function showContact(actions: SearchResultAction[]) {
    const { modal, stream } = await openAndType("jordan");
    await stream.push({
      type: "provider",
      outcome: outcome({ provider: "ghl-contacts", category: "customers", count: 1 }),
      results: [contact(actions)],
    });
    await within(modal).findByText("Jordan Sample");
    return modal;
  }

  it("phone and email have distinct icons, tooltips, and accessible labels", async () => {
    const modal = await showContact(FULL);
    const phone = modal.querySelector<HTMLButtonElement>('[data-action="phone"]')!;
    const email = modal.querySelector<HTMLButtonElement>('[data-action="email"]')!;
    const open = modal.querySelector<HTMLButtonElement>('[data-action="open"]')!;
    expect(phone.querySelector("svg")!.getAttribute("class")).toContain("lucide-phone");
    expect(email.querySelector("svg")!.getAttribute("class")).toContain("lucide-mail");
    expect(phone.innerHTML).not.toBe(email.innerHTML);
    expect(phone.title).toBe("Copy phone number ((555) 010-2030)");
    expect(email.title).toBe("Copy email address (jordan@example.test)");
    expect(open.title).toBe("Open customer");
    expect(phone.getAttribute("aria-label")).toBe("Copy phone number: Jordan Sample");
    expect(email.getAttribute("aria-label")).toBe("Copy email address: Jordan Sample");
    expect(open.getAttribute("aria-label")).toBe("Open customer: Jordan Sample");
  });

  it("copies the right value, confirms it, and never opens the record or closes search", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const modal = await showContact(FULL);

    fireEvent.click(modal.querySelector('[data-action="phone"]')!);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("(555) 010-2030"));
    expect(await within(modal).findByRole("status")).toHaveProperty(
      "textContent",
      "Phone number copied",
    );
    const phone = modal.querySelector<HTMLButtonElement>('[data-action="phone"]')!;
    expect(phone.title).toBe("Copied!");
    expect(phone.querySelector("svg")!.getAttribute("class")).toContain("lucide-check");

    fireEvent.click(modal.querySelector('[data-action="email"]')!);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("jordan@example.test"));
    await waitFor(() =>
      expect(within(modal).getByRole("status").textContent).toBe("Email address copied"),
    );

    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("global-search-modal")).toBeTruthy();
    // Focus stays in the search box so arrow keys keep working.
    fireEvent.mouseDown(modal.querySelector('[data-action="email"]')!);
    expect(document.activeElement).toBe(within(modal).getByRole("combobox"));
  });

  it("shows no copy-phone or copy-email button when the customer has no phone or email", async () => {
    const modal = await showContact([FULL[1]!, FULL[2]!]);
    expect(modal.querySelector('[data-action="phone"]')).toBeNull();
    expect(modal.querySelector('[data-action="email"]')).not.toBeNull();
    cleanup();
    streams = [];
    const none = await showContact([FULL[2]!]);
    expect(none.querySelector('[data-action="phone"]')).toBeNull();
    expect(none.querySelector('[data-action="email"]')).toBeNull();
    expect(none.querySelector('[data-action="open"]')).not.toBeNull();
  });
});

describe("source notices", () => {
  it("collapses several failing sources into one expandable notice", async () => {
    const { modal, stream } = await openAndType("synthetic");
    for (const [provider, name] of [
      ["inventory", "Inventory"],
      ["knowledge", "Knowledge Center"],
    ] as const) {
      await stream.push({
        type: "provider",
        outcome: outcome({
          provider,
          name,
          status: "error",
          message: `Couldn't search ${name} right now. Results from it may be missing.`,
        }),
        results: [],
      });
    }
    await stream.push({
      type: "provider",
      outcome: outcome({ provider: "tools", count: 1 }),
      results: many("Tool", 1),
    });
    await within(modal).findByText("Tool result 0");
    const notices = within(modal).getByTestId("provider-notices");
    expect(notices.textContent).toContain("Some sources are temporarily unavailable (2)");
    expect(within(modal).queryByTestId("provider-notice-details")).toBeNull();
    fireEvent.click(within(notices).getByRole("button", { expanded: false }));
    const details = within(modal).getByTestId("provider-notice-details");
    expect(details.textContent).toContain("Couldn't search Inventory right now.");
    expect(details.textContent).toContain("Couldn't search Knowledge Center right now.");
  });

  it("a single failure stays one short line", async () => {
    const { modal, stream } = await openAndType("synthetic");
    await stream.push({
      type: "provider",
      outcome: outcome({
        provider: "inventory",
        name: "Inventory",
        status: "timeout",
        message: "Inventory didn't respond in time. Results from it may be missing.",
      }),
      results: [],
    });
    await waitFor(() =>
      expect(within(modal).getByTestId("provider-notices").textContent).toBe(
        "Inventory didn't respond in time. Results from it may be missing.",
      ),
    );
  });
});
