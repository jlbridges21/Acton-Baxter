/** @vitest-environment jsdom */

/**
 * PP# editor regressions for the "expected string, received undefined" bug: the editor sends
 * its *current* draft (not the loaded defaults) to preview and save, keeps edits across tabs
 * and failed saves, shows field-path errors next to the controls, blocks invalid JSON instead
 * of sending defaults, and shows the new version after a save and on reopen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PpMappingEditor } from "@/components/report-builder/pp-mapping-editor";

const V0 = {
  schemaVersion: 2,
  caseSensitive: false,
  classification: { mode: "none" },
  link: { mode: "none" },
  percentages: {
    standard: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), 10])),
    overrides: [],
  },
  autoAcceptUnique: false,
};
const emptyPreview = {
  configured: false,
  inspected: 30,
  classified: 0,
  unclassified: [],
  ambiguousClassification: [],
  matched: [],
  ambiguous: [],
  unmatched: [],
  byNumber: {},
  approved: 0,
  pendingApproval: 0,
  conflicts: 0,
};
const state = (config: unknown, version: number) => ({
  ok: true,
  config,
  saved: {
    version,
    updatedAt: version ? "2026-11-02T12:00:00Z" : null,
    updatedBy: version ? "admin" : null,
    storedErrors: null,
  },
  migrated: true,
  preview: emptyPreview,
  queues: { pending: [], approved: [], rejected: [], conflicts: [] },
  projectTasks: {},
  history: [],
});

type Call = { action: string; config?: unknown; expectedVersion?: number };
let calls: Call[];
let server: (body: Call) => { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  let saved: { config: unknown; version: number } = { config: V0, version: 0 };
  server = (body) => {
    if (body.action === "get_pp") return { status: 200, body: state(saved.config, saved.version) };
    if (body.action === "preview_pp")
      return {
        status: 200,
        body: {
          ...state(saved.config, saved.version),
          preview: {
            ...emptyPreview,
            configured: true,
            classified: 2,
            byNumber: { "1": 1, "10": 1 },
          },
        },
      };
    if (body.action === "save_pp_config") {
      const c = body.config as { classification: { mode: string; regex?: string } };
      if (c.classification.mode === "name_pattern" && !c.classification.regex)
        return {
          status: 422,
          body: {
            ok: false,
            errors: [
              {
                path: "classification.regex",
                message: "Required when classification.mode is name_pattern.",
              },
            ],
          },
        };
      saved = { config: body.config, version: saved.version + 1 };
      return { status: 200, body: state(saved.config, saved.version) };
    }
    return { status: 400, body: { error: { message: "unexpected" } } };
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Call;
      calls.push(body);
      const r = server(body);
      return { status: r.status, json: async () => r.body } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open() {
  render(<PpMappingEditor />);
  await screen.findByText("Version 0");
}
const last = (action: string) => calls.filter((c) => c.action === action).at(-1)!;

describe("PP# mapping editor", () => {
  it("loads the v0 config and sends the edited rules (not the defaults) to preview", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Classification mode"), {
      target: { value: "name_pattern" },
    });
    fireEvent.change(screen.getByLabelText("Classification pattern"), {
      target: { value: "PP#(10|[1-9])\\b" },
    });
    fireEvent.change(screen.getByLabelText("Link mode"), {
      target: { value: "task_name_pattern" },
    });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Preview" })));
    expect(last("preview_pp").config).toMatchObject({
      classification: { mode: "name_pattern", regex: "PP#(10|[1-9])\\b" },
      link: { mode: "task_name_pattern", template: "PP#{pp}:" },
    });
    expect(await screen.findByText(/By PP#: PP#1: 1 · PP#10: 1/)).toBeTruthy();
  });

  it("keeps edits across tabs, saves them with the loaded version, and shows the new version", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Classification mode"), {
      target: { value: "name_pattern" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Percentages" }));
    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    expect((screen.getByLabelText("Classification mode") as HTMLSelectElement).value).toBe(
      "name_pattern",
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save version 1" })));
    expect(last("save_pp_config")).toMatchObject({
      expectedVersion: 0,
      config: { classification: { mode: "name_pattern" } },
    });
    expect(await screen.findByText("Version 1")).toBeTruthy();
    expect(screen.getByText(/Saved version 1/)).toBeTruthy();
    // Reopen: the saved config comes back.
    cleanup();
    await act(async () => render(<PpMappingEditor />));
    await screen.findByText("Version 1");
    expect((screen.getByLabelText("Classification mode") as HTMLSelectElement).value).toBe(
      "name_pattern",
    );
  });

  it("shows a field-path error next to the control and keeps the edits on a failed save", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Classification mode"), {
      target: { value: "name_pattern" },
    });
    fireEvent.change(screen.getByLabelText("Classification pattern"), { target: { value: "" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save version 1" })));
    expect(
      await screen.findByText(
        "classification.regex: Required when classification.mode is name_pattern.",
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText("Classification mode") as HTMLSelectElement).value).toBe(
      "name_pattern",
    );
    expect(screen.getByText("Version 0")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("never sends defaults when the JSON is invalid, and shares state with the controls", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: "JSON" }));
    const box = screen.getByLabelText("PP# configuration JSON") as HTMLTextAreaElement;
    fireEvent.change(box, {
      target: { value: JSON.stringify({ ...V0, link: { mode: "manual_only" } }) },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    expect((screen.getByLabelText("Link mode") as HTMLSelectElement).value).toBe("manual_only");
    fireEvent.click(screen.getByRole("tab", { name: "JSON" }));
    fireEvent.change(screen.getByLabelText("PP# configuration JSON"), {
      target: { value: "{ not json" },
    });
    expect(screen.getByRole("alert").textContent).toMatch(/Invalid JSON/);
    const before = calls.length;
    expect(
      (screen.getByRole("button", { name: "Save version 1" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await waitFor(() => expect(calls.length).toBe(before));
  });
});
