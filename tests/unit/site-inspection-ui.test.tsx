/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InspectionsShell } from "@/components/inspections/inspections-shell";
import { TemplatesListClient } from "@/components/inspections/templates-list-client";
import { TemplateEditorClient } from "@/components/inspections/template-editor-client";
import type { InspectionTemplateDetail } from "@/lib/inspections/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => cleanup());

const SAMPLE: InspectionTemplateDetail = {
  id: "t1",
  name: "Detached ADU",
  description: "Test",
  archivedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  sectionCount: 1,
  itemCount: 1,
  standaloneItems: [
    {
      id: "i0",
      templateId: "t1",
      sectionId: null,
      title: "Front Photo of Main House",
      guideNotes: "• Capture front elevation",
      allowsMedia: true,
      allowsNotes: true,
      isCoverPhotoSource: true,
      sortOrder: 0,
      subQuestions: [],
    },
  ],
  sections: [
    {
      id: "s1",
      templateId: "t1",
      title: "SITE OVERVIEW",
      sortOrder: 0,
      items: [
        {
          id: "i1",
          templateId: "t1",
          sectionId: "s1",
          title: "Access",
          guideNotes: "• Access route",
          allowsMedia: true,
          allowsNotes: true,
          isCoverPhotoSource: false,
          sortOrder: 0,
          subQuestions: [
            {
              id: "q1",
              itemId: "i1",
              prompt: "Are there any access restrictions or barriers?",
              questionType: "yes_no_na",
              sortOrder: 0,
              options: [],
            },
          ],
        },
      ],
    },
  ],
};

describe("Inspections UI at phone width", () => {
  it("renders shell nav for Site Inspections and Templates", () => {
    const { container } = render(
      <div style={{ width: 375 }}>
        <InspectionsShell activeView="inspections" title="Site Inspections">
          <p>Stub</p>
        </InspectionsShell>
      </div>,
    );
    expect(screen.getByRole("link", { name: /Site Inspections/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Templates$/i })).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).style.width).toBe("375px");
  });

  it("marks guide notes as internal-only in the editor", () => {
    render(
      <div style={{ width: 375 }}>
        <TemplateEditorClient initialTemplate={SAMPLE} isAdmin />
      </div>,
    );
    expect(screen.getAllByText(/Internal only/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Front Photo of Main House")).toBeTruthy();
    expect(screen.getByText(/Cover photo source/i)).toBeTruthy();
  });

  it("lists templates without admin create controls for users", () => {
    render(
      <div style={{ width: 375 }}>
        <TemplatesListClient
          isAdmin={false}
          initialTemplates={[
            {
              id: "t1",
              name: "Detached ADU",
              description: null,
              archivedAt: null,
              createdBy: null,
              updatedBy: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              sectionCount: 10,
              itemCount: 20,
            },
          ]}
        />
      </div>,
    );
    expect(screen.getByText("Detached ADU")).toBeTruthy();
    expect(screen.queryByLabelText(/New template/i)).toBeNull();
  });
});
