/**
 * @vitest-environment jsdom
 *
 * Loading states, nav progress wiring, typed DELETE confirm, archived template delete.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ConfirmDialog } from "@/components/ui/dialog";
import { TemplateEditorClient } from "@/components/inspections/template-editor-client";
import { TemplatesListClient } from "@/components/inspections/templates-list-client";
import type { InspectionTemplateDetail } from "@/lib/inspections/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => cleanup());

const root = join(process.cwd(), "src/app/inspections");

describe("inspections route loading + nav progress", () => {
  it("provides loading.tsx for list, templates, editor, and runner", () => {
    for (const rel of [
      "loading.tsx",
      "templates/loading.tsx",
      "templates/[id]/loading.tsx",
      "[id]/loading.tsx",
    ]) {
      expect(existsSync(join(root, rel))).toBe(true);
      const src = readFileSync(join(root, rel), "utf8");
      expect(src).toContain("RouteLoadingFallback");
    }
  });

  it("root layout mounts NavigationProgressHost and shell tabs are Links", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("NavigationProgressHost");
    const shell = readFileSync(
      join(process.cwd(), "src/components/inspections/inspections-shell.tsx"),
      "utf8",
    );
    expect(shell).toContain('href: "/inspections"');
    expect(shell).toContain('href: "/inspections/templates"');
    expect(shell).toContain('from "next/link"');
  });
});

describe("ConfirmDialog typed DELETE", () => {
  it("keeps confirm disabled until DELETE is typed", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={() => undefined}
        onConfirm={onConfirm}
        title="Remove?"
        description="Will soft-delete"
        confirmLabel="Remove inspection"
        destructive
        requireTypedPhrase="DELETE"
      />,
    );
    const confirm = screen.getByRole("button", { name: /Remove inspection/i });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/i), {
      target: { value: "delete" },
    });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/i), {
      target: { value: "DELETE" },
    });
    expect(confirm.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("archived template delete UI", () => {
  const archived: InspectionTemplateDetail = {
    id: "t-arch",
    name: "Old Template",
    description: null,
    archivedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sectionCount: 0,
    itemCount: 0,
    standaloneItems: [],
    sections: [],
  };

  it("shows permanent delete only on archived templates for admins", () => {
    render(<TemplateEditorClient initialTemplate={archived} isAdmin />);
    expect(screen.getByRole("button", { name: /Delete permanently/i })).toBeTruthy();
  });

  it("hides permanent delete on active templates", () => {
    render(<TemplateEditorClient initialTemplate={{ ...archived, archivedAt: null }} isAdmin />);
    expect(screen.queryByRole("button", { name: /Delete permanently/i })).toBeNull();
  });

  it("hides archived templates until Show archived is checked", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          templates: [
            {
              id: "a",
              name: "Active",
              description: null,
              archivedAt: null,
              createdBy: null,
              updatedBy: null,
              createdAt: "",
              updatedAt: "",
              sectionCount: 0,
              itemCount: 0,
            },
            {
              id: "b",
              name: "Parked",
              description: null,
              archivedAt: "2026-01-01T00:00:00.000Z",
              createdBy: null,
              updatedBy: null,
              createdAt: "",
              updatedAt: "",
              sectionCount: 0,
              itemCount: 0,
            },
          ],
        }),
      })),
    );
    render(
      <TemplatesListClient
        isAdmin
        initialTemplates={[
          {
            id: "a",
            name: "Active",
            description: null,
            archivedAt: null,
            createdBy: null,
            updatedBy: null,
            createdAt: "",
            updatedAt: "",
            sectionCount: 0,
            itemCount: 0,
          },
          {
            id: "b",
            name: "Parked",
            description: null,
            archivedAt: "2026-01-01T00:00:00.000Z",
            createdBy: null,
            updatedBy: null,
            createdAt: "",
            updatedAt: "",
            sectionCount: 0,
            itemCount: 0,
          },
        ]}
      />,
    );
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByText("Parked")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Show archived/i));
    expect(screen.getByText("Parked")).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
