/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ProjectSetupRunClient } from "@/components/projects/project-setup-run-client";
import { summarizeProjectSetupStepOutput } from "@/lib/project-setup/step-output-summary";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Project Setup run page — employee-facing output", () => {
  it("source no longer dumps step.outputJson via JSON.stringify as the default view", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../src/components/projects/project-setup-run-client.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/JSON\.stringify\(\s*step\.outputJson/);
    expect(src).not.toMatch(/JSON\.stringify\(\s*step\.outputJson\.planned/);
    expect(src).toContain("summarizeProjectSetupStepOutput");
  });

  it("renders friendly per-step summaries for non-admins (no raw JSON)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        run: {
          id: "run-1",
          status: "complete",
          dryRun: false,
          projectNumber: "26-0100",
          folderName: "26-0100 Smith",
          charterName: "Smith Project Charter",
          slackChannelName: "26-0100-smith",
          salesRep: "Alex",
          error: null,
          initiatedBy: "user-1",
          contactSnapshot: { name: "Smith" },
        },
        steps: [
          {
            id: "s1",
            stepKey: "append_master_log_row",
            title: "Append Master Project Log row",
            orderIndex: 1,
            status: "complete",
            outputJson: {
              mode: "live",
              spreadsheetId: "abc",
              alreadyPresent: false,
              values: ["26-0100", "Smith"],
            },
            error: null,
          },
          {
            id: "s2",
            stepKey: "copy_template_folder",
            title: "Copy project template folder",
            orderIndex: 2,
            status: "complete",
            outputJson: {
              mode: "live",
              webViewLink: "https://drive.google.com/folder/x",
              copiedFiles: 4,
              createdFolders: 2,
            },
            error: null,
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectSetupRunClient runId="run-1" isAdmin={false} />);

    await waitFor(() => {
      expect(screen.getByText("Project setup complete")).toBeTruthy();
    });

    expect(screen.getAllByText("Added row to Master Project Log").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Copied project folder/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Technical details (admin)")).toBeNull();
    expect(document.body.textContent).not.toMatch(/"mode": "live"/);
    expect(document.body.textContent).not.toContain('"spreadsheetId": "abc"');
    expect(
      summarizeProjectSetupStepOutput("append_master_log_row", {
        mode: "live",
        spreadsheetId: "abc",
      }).headline,
    ).toBe("Added row to Master Project Log");
  });

  it("shows admin technical details when isAdmin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          run: {
            id: "run-1",
            status: "failed",
            dryRun: false,
            projectNumber: "26-0100",
            folderName: null,
            charterName: null,
            slackChannelName: null,
            salesRep: null,
            error: "Sheet append failed",
            initiatedBy: "user-1",
            contactSnapshot: { name: "Smith" },
          },
          steps: [
            {
              id: "s1",
              stepKey: "append_master_log_row",
              title: "Append Master Project Log row",
              orderIndex: 1,
              status: "failed",
              outputJson: { mode: "live", spreadsheetId: "abc" },
              error: "Sheet append failed",
            },
          ],
        }),
      })),
    );

    render(<ProjectSetupRunClient runId="run-1" isAdmin canRetry />);

    await waitFor(() => {
      expect(screen.getByText("Technical details (admin)")).toBeTruthy();
    });
  });
});
