/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useAsyncRunStatus, DEFAULT_ASYNC_RUN_MAX_DURATION_MS } from "@/hooks/use-async-run-status";
import { AsyncRunProgress } from "@/components/ui/async-run-progress";
import { summarizeProjectSetupStepOutput } from "@/lib/project-setup/step-output-summary";

function HookProbe(props: {
  url: string;
  enabled?: boolean;
  maxDurationMs?: number;
  intervalMs?: number;
}) {
  const result = useAsyncRunStatus<{ status: string }>({
    url: props.url,
    enabled: props.enabled,
    intervalMs: props.intervalMs ?? 100,
    maxDurationMs: props.maxDurationMs ?? DEFAULT_ASYNC_RUN_MAX_DURATION_MS,
    isTerminal: (d) => d.status === "complete" || d.status === "failed",
  });
  return (
    <div>
      <span data-testid="polling">{String(result.isPolling)}</span>
      <span data-testid="timed-out">{String(result.isTimedOut)}</span>
      <span data-testid="status">{result.data?.status ?? "none"}</span>
      <span data-testid="error">{result.error ?? ""}</span>
      <button type="button" onClick={() => void result.refresh()}>
        refresh
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useAsyncRunStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("starts polling and stops on terminal status", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        const status = calls >= 2 ? "complete" : "running";
        return {
          ok: true,
          json: async () => ({ status }),
        };
      }),
    );

    render(<HookProbe url="/api/status" intervalMs={50} />);

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("complete");
    });
    expect(screen.getByTestId("polling").textContent).toBe("false");
    const callsAfterTerminal = calls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(calls).toBe(callsAfterTerminal);
  });

  it("cleans up in-flight fetch on unmount", async () => {
    const abortSpy = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", abortSpy);
        }
        return new Promise(() => {
          /* never resolves */
        });
      }),
    );

    const { unmount } = render(<HookProbe url="/api/status" intervalMs={50} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    unmount();
    expect(abortSpy).toHaveBeenCalled();
  });

  it("hits max-poll-duration and surfaces timed-out state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: "running" }),
      })),
    );

    render(<HookProbe url="/api/status" intervalMs={20} maxDurationMs={80} />);

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("running");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    await waitFor(() => {
      expect(screen.getByTestId("timed-out").textContent).toBe("true");
    });
    expect(screen.getByTestId("polling").textContent).toBe("false");
  });
});

describe("AsyncRunProgress", () => {
  it("renders step states and fires retry", () => {
    const onRetry = vi.fn();
    render(
      <AsyncRunProgress
        title="Run failed"
        description="Something went wrong"
        runStatus="failed"
        friendlyError="Employee-facing error"
        steps={[
          { key: "a", label: "Step A", status: "complete" },
          { key: "b", label: "Step B", status: "failed" },
          { key: "c", label: "Step C", status: "pending" },
        ]}
        retryAction={{ label: "Retry now", onClick: onRetry }}
      />,
    );

    expect(screen.getByText("Step A")).toBeTruthy();
    expect(screen.getByText(/Step B/)).toBeTruthy();
    expect(screen.getByText("Employee-facing error")).toBeTruthy();
    expect(screen.queryByText("Technical details (admin)")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides admin technical details for non-admins and shows for admins", () => {
    const { rerender } = render(
      <AsyncRunProgress
        title="Failed"
        runStatus="failed"
        steps={[{ key: "a", label: "A", status: "failed" }]}
        isAdmin={false}
        adminTechnicalDetails={<pre data-testid="admin-json">{`{"secret":true}`}</pre>}
      />,
    );
    expect(screen.queryByText("Technical details (admin)")).toBeNull();
    expect(screen.queryByTestId("admin-json")).toBeNull();

    rerender(
      <AsyncRunProgress
        title="Failed"
        runStatus="failed"
        steps={[{ key: "a", label: "A", status: "failed" }]}
        isAdmin
        adminTechnicalDetails={<pre data-testid="admin-json">{`{"secret":true}`}</pre>}
      />,
    );
    expect(screen.getByText("Technical details (admin)")).toBeTruthy();
  });

  it("shows taking-longer-than-expected when timed out", () => {
    render(
      <AsyncRunProgress
        title="Still going"
        runStatus="timed_out"
        steps={[{ key: "a", label: "A", status: "running" }]}
        onManualRefresh={() => undefined}
      />,
    );
    expect(screen.getByText(/taking longer than expected/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /refresh status/i })).toBeTruthy();
  });
});

describe("Project Setup friendly step summaries", () => {
  it("formats live step outputs without relying on raw JSON as the headline", () => {
    expect(
      summarizeProjectSetupStepOutput("append_master_log_row", {
        mode: "live",
        spreadsheetId: "sheet123",
        alreadyPresent: false,
      }).headline,
    ).toBe("Added row to Master Project Log");

    expect(
      summarizeProjectSetupStepOutput("copy_template_folder", {
        mode: "live",
        webViewLink: "https://drive.google.com/folder/1",
        copiedFiles: 12,
        createdFolders: 3,
      }).headline,
    ).toMatch(/Copied project folder/);

    expect(
      summarizeProjectSetupStepOutput("create_slack_channel", {
        mode: "live",
        channelName: "26-0100-smith",
        channelId: "C123",
      }).headline,
    ).toBe("Created Slack channel #26-0100-smith");

    expect(
      summarizeProjectSetupStepOutput("post_kickoff_message", {
        mode: "live",
        channelId: "C123",
      }).headline,
    ).toMatch(/Posted kickoff message/);

    expect(
      summarizeProjectSetupStepOutput("copy_charter_spreadsheet", {
        mode: "live",
        webViewLink: "https://docs.google.com/spreadsheets/d/x",
      }).headline,
    ).toBe("Copied project charter");

    expect(
      summarizeProjectSetupStepOutput("append_charter_list_row", {
        mode: "live",
        spreadsheetId: "sheet123",
      }).headline,
    ).toBe("Added row to Project Charter List");
  });
});
