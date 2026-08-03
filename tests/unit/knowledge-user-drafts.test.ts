import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  canUserReadKnowledgeEntry,
  filterKnowledgeVisibleToUser,
} from "@/lib/knowledge/permissions";
import {
  createKnowledgeEntry,
  listKnowledgeEntries,
  resetKnowledgeMemoryForTests,
  setKnowledgeEntryStatus,
} from "@/lib/knowledge/store";
import { userCreateKnowledgeDraft } from "@/lib/knowledge/mutations";
import type { KnowledgeEntry } from "@/lib/knowledge/types";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetKnowledgeMemoryForTests();
});

const USER_A = "00000000-0000-4000-8000-0000000000aa";
const USER_B = "00000000-0000-4000-8000-0000000000bb";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";

describe("user knowledge drafts", () => {
  it("forces status to draft regardless of submitted payload", async () => {
    const entry = await userCreateKnowledgeDraft(USER_A, {
      title: "User tip",
      content: "How we handle PEMs",
      source_type: "manual",
      status: "approved",
      visibility: "admin_only",
    });
    expect(entry.status).toBe("draft");
    expect(entry.visibility).toBe("internal");
    expect(entry.created_by).toBe(USER_A);
    expect(entry.approved_at).toBeNull();
  });

  it("lists approved + own drafts for a user, excluding others' drafts and archived", async () => {
    const mine = await userCreateKnowledgeDraft(USER_A, {
      title: "My draft",
      content: "Mine",
      source_type: "manual",
    });
    const theirs = await userCreateKnowledgeDraft(USER_B, {
      title: "Their draft",
      content: "Theirs",
      source_type: "manual",
    });
    const approved = await createKnowledgeEntry(
      {
        title: "Approved guide",
        content: "Public",
        source_type: "manual",
        status: "approved",
        visibility: "internal",
      },
      ADMIN,
    );
    const archived = await createKnowledgeEntry(
      {
        title: "Old",
        content: "Gone",
        source_type: "manual",
        status: "archived",
        visibility: "internal",
      },
      ADMIN,
    );

    const all = await listKnowledgeEntries({ sort: "updated" });
    const visible = filterKnowledgeVisibleToUser(all, USER_A, "user");
    const ids = visible.map((e) => e.id);

    expect(ids).toContain(mine.id);
    expect(ids).toContain(approved.id);
    expect(ids).not.toContain(theirs.id);
    expect(ids).not.toContain(archived.id);

    expect(canUserReadKnowledgeEntry(mine, USER_A, "user")).toBe(true);
    expect(canUserReadKnowledgeEntry(theirs, USER_A, "user")).toBe(false);
    expect(canUserReadKnowledgeEntry(approved, USER_A, "user")).toBe(true);
    expect(canUserReadKnowledgeEntry(archived, USER_A, "user")).toBe(false);
  });

  it("admin approval flow lists and can approve a user-created draft", async () => {
    const draft = await userCreateKnowledgeDraft(USER_A, {
      title: "Needs review",
      content: "Please approve",
      source_type: "manual",
    });

    const all = await listKnowledgeEntries({ status: "draft" });
    expect(all.some((e) => e.id === draft.id && e.created_by === USER_A)).toBe(true);

    const approved = await setKnowledgeEntryStatus(draft.id, "approved", ADMIN);
    expect(approved.status).toBe("approved");
    expect(approved.approved_by).toBe(ADMIN);
    expect(canUserReadKnowledgeEntry(approved, USER_B, "user")).toBe(true);
  });
});

describe("POST /api/knowledge draft enforcement", () => {
  it("creates a draft even when the JSON body requests approved", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/session", () => ({
      requireActiveUser: async () => ({
        id: USER_A,
        email: "user@actonadu.com",
        profile: {
          id: USER_A,
          full_name: "User A",
          role: "user",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }),
    }));

    const { POST } = await import("@/app/api/knowledge/route");
    const response = await POST(
      new Request("http://localhost/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "API forced draft",
          content: "Should not publish",
          status: "approved",
        }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { entry: KnowledgeEntry };
    expect(body.entry.status).toBe("draft");
    expect(body.entry.created_by).toBe(USER_A);
  });
});
