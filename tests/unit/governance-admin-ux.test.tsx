/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  DEFAULT_GOVERNANCE_SECTION_CONTENT,
  DEFAULT_PEM_NEAT_GRADING_SECTION_CONTENT,
  formatActivationBlockedMessage,
  getActivationGate,
  getOrCreateDraftVersion,
  resetGovernanceMemoryForTests,
  updateDraftSection,
} from "@/lib/baxter-ai/governance";
import { ProfilePersonPicker } from "@/components/admin/profile-person-picker";

const USER = "00000000-0000-4000-8000-0000000000bb";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetGovernanceMemoryForTests();
});

describe("governance activation blocked messaging", () => {
  it("uses human-readable section titles, not raw keys", async () => {
    const draft = await getOrCreateDraftVersion(USER, "Tighten role", "pem_neat_grading");
    await updateDraftSection(
      draft.id,
      "pem_role",
      DEFAULT_PEM_NEAT_GRADING_SECTION_CONTENT.pem_role + "\n(Extra.)",
    );

    const gate = await getActivationGate(draft.id);
    expect(gate.ok).toBe(false);
    if (gate.ok) return;

    expect(gate.error).toContain("Role & standard version");
    expect(gate.error).toContain("Process content");
    expect(gate.error).not.toMatch(/\bpem_role\b/);
    expect(gate.error).not.toMatch(/\bprocess_content\b/);
    expect(gate.error).toMatch(/No owner is assigned for Process content/);
    expect(gate.missingApprovals[0]?.sectionLabel).toBe("Role & standard version");
    expect(gate.unassignedDomains.some((d) => d.domain === "process_content")).toBe(true);
  });

  it("formatActivationBlockedMessage groups by domain with bullets", () => {
    const msg = formatActivationBlockedMessage([
      {
        sectionKey: "pem_role",
        sectionLabel: "Role & standard version",
        domain: "process_content",
        domainLabel: "Process content",
        ownerAssigned: false,
      },
      {
        sectionKey: "pem_budget",
        sectionLabel: "Budget rules",
        domain: "process_content",
        domainLabel: "Process content",
        ownerAssigned: false,
      },
    ]);
    expect(msg).toContain(
      "The following sections were changed and need Process content approval before this draft can activate:",
    );
    expect(msg).toContain("• Role & standard version");
    expect(msg).toContain("• Budget rules");
    expect(msg).toContain("No owner is assigned for Process content yet");
    expect(msg).toContain("Domain owners");
  });

  it("baxter runtime blocked message also uses titles", async () => {
    const draft = await getOrCreateDraftVersion(USER, "Tighten confidentiality");
    await updateDraftSection(
      draft.id,
      "confidentiality",
      DEFAULT_GOVERNANCE_SECTION_CONTENT.confidentiality + "\n- Extra line.",
    );
    const gate = await getActivationGate(draft.id);
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.error).toContain("Confidentiality");
    expect(gate.error).toContain("Precedence, confidentiality & scope");
    expect(gate.error).not.toMatch(/missing approvals for:\s*confidentiality\b/i);
    expect(gate.error).not.toMatch(/\(precedence_confidentiality_scope\)/);
    expect(gate.missingApprovals[0]?.sectionLabel).toBe("Confidentiality");
  });
});

describe("ProfilePersonPicker", () => {
  it("searches and selects by name without showing UUIDs", () => {
    const people = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        displayName: "Alex Advisor",
        email: "alex@actonadu.com",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        displayName: "Sam Sales",
        email: "sam@actonadu.com",
      },
    ];
    let selected: string | null = null;
    const { rerender } = render(
      <ProfilePersonPicker
        people={people}
        value={selected}
        onChange={(id) => {
          selected = id;
        }}
      />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Alex" } });
    expect(screen.getByText("Alex Advisor")).toBeTruthy();
    expect(screen.queryByText(people[0]!.id)).toBeNull();

    fireEvent.mouseDown(screen.getByText("Alex Advisor"));
    rerender(
      <ProfilePersonPicker
        people={people}
        value={selected}
        onChange={(id) => {
          selected = id;
        }}
      />,
    );

    expect(selected).toBe(people[0]!.id);
    expect(screen.getByText("Alex Advisor")).toBeTruthy();
    expect(screen.getByText("alex@actonadu.com")).toBeTruthy();
    expect(screen.queryByText(people[0]!.id)).toBeNull();
  });
});
