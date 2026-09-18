/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TemplateEditorClient } from "@/components/inspections/template-editor-client";
import { parseBulkOptions } from "@/components/inspections/template-item-modal";
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

describe("Dialog primitive a11y", () => {
  it("exposes dialog role, aria-modal, labelled title, and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Test dialog</DialogTitle>
          <DialogDescription>Helper text</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <button type="button">Inside</button>
        </DialogBody>
        <DialogFooter>
          <button type="button">OK</button>
        </DialogFooter>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByText("Test dialog")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Backdrop</DialogTitle>
          <DialogDescription>Desc</DialogDescription>
        </DialogHeader>
        <DialogBody>Body</DialogBody>
      </Dialog>,
    );
    fireEvent.click(screen.getByLabelText("Close dialog"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("template editor compact + modal", () => {
  it("uses compact rows without window.prompt/confirm and opens edit modal", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const confirmSpy = vi.spyOn(window, "confirm");

    render(
      <div style={{ width: 375 }}>
        <TemplateEditorClient initialTemplate={SAMPLE} isAdmin />
      </div>,
    );

    expect(screen.getByText("Front Photo of Main House")).toBeTruthy();
    expect(screen.getByText(/Cover photo source/i)).toBeTruthy();
    expect(screen.getAllByText(/Internal only/i).length).toBeGreaterThan(0);
    expect(screen.queryByDisplayValue("Front Photo of Main House")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: /^Edit$/i })[0]!);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText(/^Title$/i)).toBeTruthy();
    expect(screen.getByLabelText(/Guide notes/i)).toBeTruthy();
    expect(screen.getByText(/Attach media/i)).toBeTruthy();

    expect(promptSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it("places Add section beside Add item at the top of standalone items", () => {
    const { container } = render(
      <div style={{ width: 375 }}>
        <TemplateEditorClient initialTemplate={SAMPLE} isAdmin />
      </div>,
    );

    const addSection = screen.getByRole("button", { name: /^\+ Add section$/i });
    const addItems = screen.getAllByRole("button", { name: /^\+ Add item$/i });
    expect(addSection).toBeTruthy();
    expect(addItems.length).toBeGreaterThan(0);

    const standalone = container.querySelector('[data-container="standalone"]');
    expect(standalone).toBeTruthy();
    expect(standalone!.contains(addSection)).toBe(true);
    expect(standalone!.contains(addItems[0]!)).toBe(true);

    // Peers in the same header action group (section then item).
    const group = addSection.parentElement;
    expect(group).toBeTruthy();
    expect(group!.contains(addItems[0]!)).toBe(true);
    expect([...group!.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual([
      "+ Add section",
      "+ Add item",
    ]);

    fireEvent.click(addSection);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Sections group related checklist items/i)).toBeTruthy();
  });

  it("types a full sub-question label without focus jumping to Title", async () => {
    render(
      <div style={{ width: 375 }}>
        <TemplateEditorClient initialTemplate={SAMPLE} isAdmin />
      </div>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /^Edit$/i })[0]!);
    expect(await screen.findByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /\+ Add sub-question/i }));
    const prompt = screen.getByPlaceholderText(/Question label/i) as HTMLInputElement;
    prompt.focus();

    const typed = "Any access restrictions?";
    let value = "";
    for (const ch of typed) {
      value += ch;
      fireEvent.change(prompt, { target: { value } });
      await new Promise((r) => setTimeout(r, 0));
      expect(document.activeElement).toBe(prompt);
    }
    expect(prompt.value).toBe(typed);
    expect(document.activeElement).not.toBe(screen.getByLabelText(/^Title$/i));
  });

  it("source file has no window.prompt or window.confirm", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/inspections/template-editor-client.tsx"),
      "utf8",
    );
    expect(source).not.toContain("window.prompt");
    expect(source).not.toContain("window.confirm");
    expect(source).toContain("@dnd-kit");
    expect(source).toContain("Move up");
  });

  it("parses bulk option paste formats", () => {
    expect(parseBulkOptions("100 / 200 / 320 / 400")).toEqual(["100", "200", "320", "400"]);
    expect(parseBulkOptions('5/8"\n3/4"\n1"')).toEqual(['5/8"', '3/4"', '1"']);
  });
});
