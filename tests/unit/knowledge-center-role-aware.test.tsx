/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  getKnowledgeCenterNavItems,
  KNOWLEDGE_CENTER_ADMIN_ONLY_VIEWS,
} from "@/components/admin/knowledge-center/knowledge-center-sidebar";
import { KnowledgeListClient } from "@/components/admin/knowledge-list-client";
import type { KnowledgeAnalytics } from "@/lib/knowledge/analytics";
import type { KnowledgeEntry } from "@/lib/knowledge/types";
import { BAXTER_ADMIN_CARDS, getEnabledBaxterTools } from "@/lib/baxter/tools";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/knowledge",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
});

function fakeEntry(partial: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: partial.id ?? "11111111-1111-1111-1111-111111111111",
    title: partial.title ?? "Sample entry",
    content: partial.content ?? "Body",
    summary: partial.summary ?? null,
    category: partial.category ?? "General",
    tags: partial.tags ?? [],
    source_name: partial.source_name ?? null,
    source_type: partial.source_type ?? "manual",
    source_url: partial.source_url ?? null,
    source_external_id: partial.source_external_id ?? null,
    status: partial.status ?? "approved",
    visibility: partial.visibility ?? "internal",
    version: partial.version ?? 1,
    created_by: partial.created_by ?? null,
    updated_by: partial.updated_by ?? null,
    approved_by: partial.approved_by ?? null,
    approved_at: partial.approved_at ?? null,
    archived_at: partial.archived_at ?? null,
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: partial.updated_at ?? "2026-01-02T00:00:00.000Z",
    metadata: partial.metadata ?? {},
  };
}

const emptyAnalytics: KnowledgeAnalytics = {
  totals: {
    total: 1,
    approved: 1,
    drafts: 0,
    archived: 0,
    manual: 1,
    uploaded: 0,
    google: 0,
  },
  frequentlyCited: [],
  unusedApproved: [],
  recentlyImported: [],
  unansweredHints: [],
};

describe("Knowledge Center role-aware nav", () => {
  it("hides admin-only sidebar destinations for non-admins and includes Add New", () => {
    const userNav = getKnowledgeCenterNavItems({
      isAdmin: false,
      basePath: "/knowledge",
      newEntryHref: "/knowledge/new",
    });
    const labels = userNav.map((i) => i.label);
    expect(labels).toContain("Knowledge");
    expect(labels).toContain("Add New");
    expect(labels).not.toContain("Process Rulebook");
    expect(labels).not.toContain("Baxter Governance");
    expect(labels).not.toContain("Knowledge Settings");
    expect(labels).not.toContain("Sources");
    expect(labels).not.toContain("Uploads");
    expect(labels).not.toContain("Google Workspace");
    expect(labels).not.toContain("Archived");
    expect(labels).not.toContain("Failed Imports");
    expect(labels).not.toContain("Connector Health");

    for (const view of KNOWLEDGE_CENTER_ADMIN_ONLY_VIEWS) {
      if (view === "monitoring") continue; // may be feature-flagged off
      expect(userNav.some((i) => i.view === view)).toBe(false);
    }
  });

  it("keeps the full admin sidebar for admins", () => {
    const adminNav = getKnowledgeCenterNavItems({
      isAdmin: true,
      basePath: "/admin/knowledge",
      newEntryHref: "/admin/knowledge/new",
    });
    const labels = adminNav.map((i) => i.label);
    expect(labels).toContain("Knowledge");
    expect(labels).toContain("Process Rulebook");
    expect(labels).toContain("Baxter Governance");
    expect(labels).toContain("Knowledge Settings");
    expect(labels).toContain("Sources");
    expect(labels).toContain("Uploads");
    expect(labels).not.toContain("Add New");
  });
});

describe("KnowledgeListClient role-aware actions", () => {
  it("hides Remove from Baxter / Archive / Approve for non-admins but keeps Open and Open in Google", () => {
    const googleEntry = fakeEntry({
      id: "22222222-2222-2222-2222-222222222222",
      title: "Drive doc",
      source_type: "Google Drive",
      source_url: "https://docs.google.com/document/d/abc",
    });

    render(
      <KnowledgeListClient
        initialEntries={[googleEntry]}
        analytics={emptyAnalytics}
        isAdmin={false}
        basePath="/knowledge"
        newEntryHref="/knowledge/new"
      />,
    );

    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Google" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove from Baxter" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
  });

  it("shows admin mutating actions for admins", () => {
    const googleEntry = fakeEntry({
      id: "33333333-3333-3333-3333-333333333333",
      title: "Drive doc",
      source_type: "Google Drive",
      source_url: "https://docs.google.com/document/d/abc",
      status: "approved",
    });

    render(
      <KnowledgeListClient
        initialEntries={[googleEntry]}
        analytics={emptyAnalytics}
        isAdmin
        basePath="/admin/knowledge"
        newEntryHref="/admin/knowledge/new"
      />,
    );

    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Google" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Archive" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Remove from Baxter" })).toBeTruthy();
  });
});

describe("Dashboard Knowledge Center tool card", () => {
  it("registers Knowledge Center as the 5th enabled tool linking to /knowledge", () => {
    const tools = getEnabledBaxterTools();
    expect(tools).toHaveLength(5);
    const knowledge = tools.find((t) => t.key === "knowledge-center");
    expect(knowledge?.href).toBe("/knowledge");
    expect(knowledge?.name).toBe("Knowledge Center");
  });

  it("points admins at the admin Knowledge Center with no duplicate card", () => {
    const tools = getEnabledBaxterTools({ isAdmin: true });
    const knowledgeTools = tools.filter((t) => t.ctaLabel === "Open Knowledge Center");

    expect(knowledgeTools).toHaveLength(1);
    expect(knowledgeTools[0]?.href).toBe("/admin/knowledge");
    expect(knowledgeTools[0]?.createHref).toBe("/admin/knowledge/new");
    expect(BAXTER_ADMIN_CARDS.map((c) => String(c.ctaLabel))).not.toContain(
      "Open Knowledge Center",
    );
  });
});
