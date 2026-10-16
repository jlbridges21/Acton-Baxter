import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/auth/session";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  assignDomainOwner,
  DEFAULT_PEM_NEAT_GRADING_SECTION_CONTENT,
  getActiveGovernanceVersion,
  getOrCreateDraftVersion,
  resetGovernanceMemoryForTests,
  updateDraftSection,
} from "@/lib/baxter-ai/governance";
import { POST } from "@/app/api/admin/baxter/governance/route";
import type { Profile, UserRole } from "@/lib/research/db-types";

const ADMIN = "00000000-0000-4000-8000-0000000000bb";
const SUPER = "00000000-0000-4000-8000-0000000000aa";
const OWNER = "00000000-0000-4000-8000-0000000000cc";

function asUser(id: string, role: UserRole) {
  const profile: Profile = {
    id,
    full_name: "Test Admin",
    role,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  return { id, email: "admin@example.com", profile };
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/admin/baxter/governance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "pem_neat_grading", ...body }),
    }),
  );
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetGovernanceMemoryForTests();
});

describe("governance approve_section route", () => {
  it("tells a non-owner admin they cannot approve a PEM section", async () => {
    const draft = await getOrCreateDraftVersion(ADMIN, "Tighten outcome", "pem_neat_grading");
    await updateDraftSection(
      draft.id,
      "pem_decision_outcome",
      `${DEFAULT_PEM_NEAT_GRADING_SECTION_CONTENT.pem_decision_outcome}\n(Extra.)`,
    );
    vi.mocked(requireAdmin).mockResolvedValue(asUser(ADMIN, "admin"));

    const response = await post({
      action: "approve_section",
      versionId: draft.id,
      sectionKey: "pem_decision_outcome",
    });
    const body = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("GOVERNANCE_APPROVAL_FORBIDDEN");
    expect(body.error.message).toBe(
      'Only the Process content owner or a super-admin can approve "Decision, next steps & outcome". No Process content owner is assigned yet; ask a super-admin to assign one under Domain owners.',
    );
    expect(body.error.message).not.toBe("An unexpected error occurred");
  });

  it("lets a super_admin and the assigned domain owner approve", async () => {
    const draft = await getOrCreateDraftVersion(SUPER, "Tighten outcome", "pem_neat_grading");
    await updateDraftSection(
      draft.id,
      "pem_decision_outcome",
      `${DEFAULT_PEM_NEAT_GRADING_SECTION_CONTENT.pem_decision_outcome}\n(Extra.)`,
    );

    vi.mocked(requireAdmin).mockResolvedValue(asUser(SUPER, "super_admin"));
    const asSuper = await post({
      action: "approve_section",
      versionId: draft.id,
      sectionKey: "pem_decision_outcome",
    });
    expect(asSuper.status).toBe(200);
    expect(await asSuper.json()).toMatchObject({ approved: true });

    const owned = await getOrCreateDraftVersion(OWNER, "Another pass", "pem_neat_grading");
    await updateDraftSection(
      owned.id,
      "pem_decision_outcome",
      `${DEFAULT_PEM_NEAT_GRADING_SECTION_CONTENT.pem_decision_outcome}\n(Owner edit.)`,
    );
    await assignDomainOwner("process_content", OWNER, SUPER);
    vi.mocked(requireAdmin).mockResolvedValue(asUser(OWNER, "admin"));
    const asOwner = await post({
      action: "approve_section",
      versionId: owned.id,
      sectionKey: "pem_decision_outcome",
    });
    expect(asOwner.status).toBe(200);
    expect(await asOwner.json()).toMatchObject({ approved: true });
  });

  it("rejects approval of a version that is not a draft", async () => {
    const active = await getActiveGovernanceVersion("pem_neat_grading");
    expect(active).toBeTruthy();
    vi.mocked(requireAdmin).mockResolvedValue(asUser(SUPER, "super_admin"));

    const response = await post({
      action: "approve_section",
      versionId: active!.id,
      sectionKey: "pem_decision_outcome",
    });
    const body = (await response.json()) as { error: { message: string } };
    expect(response.status).toBe(409);
    expect(body.error.message).toBe("Only draft versions can be approved");
  });

  it("exposes assign and unknown-action failures", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(asUser(ADMIN, "admin"));
    const assign = await post({
      action: "assign_domain_owner",
      domain: "process_content",
      profileId: OWNER,
    });
    const assignBody = (await assign.json()) as { error: { message: string } };
    expect(assign.status).toBe(403);
    expect(assignBody.error.message).toBe("Only a super-admin can assign domain owners.");

    const unknown = await post({ action: "not_a_real_action" });
    const unknownBody = (await unknown.json()) as { error: { message: string } };
    expect(unknown.status).toBe(400);
    expect(unknownBody.error.message).toBe("Unknown action: not_a_real_action");
  });
});
