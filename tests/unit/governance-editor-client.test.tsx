/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GovernanceEditorClient } from "@/components/admin/governance-editor-client";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockPayload(overrides: Record<string, unknown> = {}) {
  return {
    surface: "pem_neat_grading",
    active: { id: "a", version_number: 1, status: "active" },
    activeSections: [
      {
        section_key: "pem_role",
        content: "Role content",
        domain: "process_content",
      },
    ],
    draft: {
      id: "d",
      version_number: 2,
      status: "draft",
      rationale: null,
    },
    draftSections: [
      {
        section_key: "pem_role",
        content: "Role content changed",
        domain: "process_content",
      },
    ],
    draftApprovals: [],
    gate: {
      ok: false,
      error:
        "The following sections were changed and need Process content approval before this draft can activate:\n• Role & standard version\nNo owner is assigned for Process content yet. A super-admin can assign one under Domain owners on this page.",
      missingApprovals: [
        {
          sectionKey: "pem_role",
          sectionLabel: "Role & standard version",
          domain: "process_content",
          domainLabel: "Process content",
          ownerAssigned: false,
        },
      ],
      unassignedDomains: [{ domain: "process_content", domainLabel: "Process content" }],
    },
    owners: [{ domain: "process_content", profile_id: null }],
    ownerCandidates: [
      {
        id: "00000000-0000-4000-8000-000000000099",
        displayName: "Jamie Manager",
        email: "jamie@actonadu.com",
        role: "super_admin",
      },
    ],
    loaded: { versionNumber: 1, usedFallback: false },
    meta: {
      surface: "pem_neat_grading",
      surfaces: ["baxter_runtime", "pem_neat_grading"],
      surfaceLabels: {
        baxter_runtime: "Baxter chat runtime",
        pem_neat_grading: "PEM NEAT grading standard",
      },
      sectionKeys: ["pem_role"],
      sectionLabels: { pem_role: "Role & standard version" },
      sectionDomains: { pem_role: "process_content" },
      domains: ["process_content"],
      domainLabels: { process_content: "Process content" },
    },
    ...overrides,
  };
}

describe("GovernanceEditorClient UX", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => mockPayload(),
      })),
    );
  });

  it("Open existing draft switches into draft review mode", async () => {
    render(<GovernanceEditorClient isSuperAdmin />);

    await screen.findByText("Currently live: v1");
    expect(screen.getByTestId("governance-open-draft")).toBeTruthy();

    // Sections collapsed by default — raw content hidden
    expect(screen.queryByText("Role content")).toBeNull();

    fireEvent.click(screen.getByTestId("governance-open-draft"));

    await waitFor(() => {
      expect(screen.getByTestId("governance-draft-mode").className).toMatch(/accent|bg-/);
    });

    // Draft mode selected — expand to see draft content
    fireEvent.click(screen.getByTestId("governance-section-pem_role"));
    expect(screen.getByText("Role content changed")).toBeTruthy();
  });

  it("shows human-readable activation blocked panel with link to owners", async () => {
    render(<GovernanceEditorClient isSuperAdmin />);
    await screen.findByText(/need Process content approval/);
    expect(screen.getByText("• Role & standard version")).toBeTruthy();
    expect(screen.queryByText(/\bpem_role\b/)).toBeNull();
    expect(screen.getByRole("button", { name: /Go to Domain owners/i })).toBeTruthy();
  });

  it("hides Approve from a non-owner admin and shows who must approve", async () => {
    const ownerId = "00000000-0000-4000-8000-0000000000cc";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () =>
          mockPayload({
            viewer: { profileId: "00000000-0000-4000-8000-0000000000bb", isSuperAdmin: false },
            owners: [{ domain: "process_content", profile_id: ownerId }],
            ownerCandidates: [
              {
                id: ownerId,
                displayName: "Pat Process",
                email: "pat@actonadu.com",
                role: "admin",
              },
            ],
            canApprove: { process_content: false },
          }),
      })),
    );
    render(<GovernanceEditorClient isSuperAdmin={false} />);
    await screen.findByText("Currently live: v1");
    fireEvent.click(screen.getByTestId("governance-open-draft"));
    expect(
      (await screen.findByTestId("governance-approval-needed-pem_role")).textContent,
    ).toContain("Needs approval from Pat Process (Process content owner)");
    fireEvent.click(screen.getByTestId("governance-section-pem_role"));
    expect(screen.queryByTestId("governance-approve-pem_role")).toBeNull();
    expect((screen.getByTestId("governance-activate") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Approve for a super_admin", async () => {
    render(<GovernanceEditorClient isSuperAdmin />);
    await screen.findByText("Currently live: v1");
    fireEvent.click(screen.getByTestId("governance-open-draft"));
    fireEvent.click(screen.getByTestId("governance-section-pem_role"));
    expect(screen.getByTestId("governance-approve-pem_role")).toBeTruthy();
    expect(screen.queryByTestId("governance-approval-needed-pem_role")).toBeNull();
  });

  it("shows Approve for the domain owner", async () => {
    const ownerId = "00000000-0000-4000-8000-0000000000cc";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () =>
          mockPayload({
            viewer: { profileId: ownerId, isSuperAdmin: false },
            owners: [{ domain: "process_content", profile_id: ownerId }],
            ownerCandidates: [
              {
                id: ownerId,
                displayName: "Pat Process",
                email: "pat@actonadu.com",
                role: "admin",
              },
            ],
            canApprove: { process_content: true },
          }),
      })),
    );
    render(<GovernanceEditorClient isSuperAdmin={false} />);
    await screen.findByText("Currently live: v1");
    fireEvent.click(screen.getByTestId("governance-open-draft"));
    fireEvent.click(screen.getByTestId("governance-section-pem_role"));
    expect(screen.getByTestId("governance-approve-pem_role")).toBeTruthy();
    expect(screen.queryByTestId("governance-approval-needed-pem_role")).toBeNull();
  });

  it("shows the exposed approval error in the banner", async () => {
    const message =
      'Only the Process content owner or a super-admin can approve "Role & standard version". No Process content owner is assigned yet; ask a super-admin to assign one under Domain owners.';
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return {
            ok: false,
            status: 403,
            json: async () => ({ error: { code: "GOVERNANCE_APPROVAL_FORBIDDEN", message } }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () =>
            mockPayload({
              viewer: { profileId: "00000000-0000-4000-8000-0000000000aa", isSuperAdmin: true },
              canApprove: { process_content: true },
            }),
        };
      }),
    );
    render(<GovernanceEditorClient isSuperAdmin />);
    await screen.findByText("Currently live: v1");
    fireEvent.click(screen.getByTestId("governance-open-draft"));
    fireEvent.click(screen.getByTestId("governance-section-pem_role"));
    fireEvent.click(screen.getByTestId("governance-approve-pem_role"));
    expect((await screen.findByRole("alert")).textContent).toContain(message);
  });

  it("domain owner assignment uses person picker, not UUID input", async () => {
    render(<GovernanceEditorClient isSuperAdmin />);
    await screen.findByText("Currently live: v1");
    fireEvent.click(screen.getByRole("button", { name: "Domain owners" }));
    expect(screen.queryByPlaceholderText(/Profile UUID/i)).toBeNull();
    expect(screen.getByPlaceholderText(/Search by name or email/i)).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Jamie" } });
    fireEvent.mouseDown(screen.getByText("Jamie Manager"));
    expect(screen.getByText("jamie@actonadu.com")).toBeTruthy();
    expect(screen.queryByText("00000000-0000-4000-8000-000000000099")).toBeNull();
  });
});
