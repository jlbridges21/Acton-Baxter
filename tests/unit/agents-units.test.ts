import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeOfficeLayout } from "@/lib/agents/office-layout";
import { sniffImageType } from "@/lib/agents/avatar";
import { summarizeProgress, type InstanceStepRow } from "@/lib/agents/onboarding";
import { canTransition, deriveRuntimeState } from "@/lib/agents/tasks";
import { finalizeResult } from "@/lib/agents/executor";
import { parseJsonObject } from "@/lib/agents/models";
import { setupAgentTestEnv } from "./agents-test-helpers";

describe("office layout", () => {
  const departments = [
    {
      id: "d-exec",
      slug: "executive",
      name: "Executive Office",
      color: "#111",
      is_visible: true,
      sort_order: 0,
    },
    {
      id: "d-hr",
      slug: "hr-admin-legal",
      name: "HR",
      color: "#222",
      is_visible: true,
      sort_order: 10,
    },
    {
      id: "d-fin",
      slug: "finance",
      name: "Finance",
      color: "#333",
      is_visible: true,
      sort_order: 20,
    },
  ];
  const agents = [
    {
      id: "a-bax",
      kind: "orchestrator" as const,
      departmentId: "d-exec",
      desk: { area: "executive", slot: 0 },
    },
    { id: "a-sam", kind: "specialist" as const, departmentId: "d-hr", desk: {} },
  ];

  it("creates rooms only for departments with agents (no empty departments for show)", () => {
    const layout = computeOfficeLayout({
      preset: "studio",
      departments,
      agents,
      showMeetingArea: false,
      showFutureSpace: false,
      labels: {},
    });
    expect(layout.rooms.map((r) => r.key)).toEqual(["d-exec", "d-hr"]);
    expect(layout.seats).toHaveLength(2);
  });

  it("adds meeting and future areas on request, honors renamed labels and desk moves", () => {
    const layout = computeOfficeLayout({
      preset: "campus",
      departments,
      agents: [agents[0]!, { ...agents[1]!, desk: { area: "executive", slot: 1 } }],
      showMeetingArea: true,
      showFutureSpace: true,
      labels: { meeting: "Huddle", "d-exec": "Corner office" },
    });
    expect(layout.rooms.map((r) => r.label)).toEqual([
      "Corner office",
      "Huddle",
      "Space for future departments",
    ]);
    const [b, s] = layout.seats;
    expect(b!.roomKey).toBe(s!.roomKey);
    expect(b!.x).not.toBe(s!.x);
  });

  it("hides agents whose department is hidden", () => {
    const layout = computeOfficeLayout({
      preset: "compact",
      departments: departments.map((d) => (d.id === "d-hr" ? { ...d, is_visible: false } : d)),
      agents,
      showMeetingArea: false,
      showFutureSpace: false,
      labels: {},
    });
    expect(layout.seats.map((s) => s.agentId)).toEqual(["a-bax"]);
  });
});

describe("runtime state reflects only real tasks", () => {
  it("is idle with no tasks, working while running, waiting while a specialist works", () => {
    expect(deriveRuntimeState({ ownActive: [], delegatedRunning: 0, lastTerminal: null })).toBe(
      "idle",
    );
    expect(
      deriveRuntimeState({
        ownActive: [{ status: "running" }],
        delegatedRunning: 0,
        lastTerminal: null,
      }),
    ).toBe("working");
    expect(deriveRuntimeState({ ownActive: [], delegatedRunning: 1, lastTerminal: null })).toBe(
      "awaiting_result",
    );
    expect(
      deriveRuntimeState({
        ownActive: [{ status: "awaiting_approval" }],
        delegatedRunning: 0,
        lastTerminal: null,
      }),
    ).toBe("awaiting_approval");
  });

  it("shows a recent failure, then returns to idle", () => {
    const now = Date.now();
    const failed = {
      status: "failed" as const,
      completed_at: new Date(now - 60_000).toISOString(),
    };
    expect(
      deriveRuntimeState({ ownActive: [], delegatedRunning: 0, lastTerminal: failed, now }),
    ).toBe("failed");
    expect(
      deriveRuntimeState({
        ownActive: [],
        delegatedRunning: 0,
        lastTerminal: failed,
        now: now + 3_600_000,
      }),
    ).toBe("idle");
  });

  it("only allows valid lifecycle transitions", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(true);
  });
});

describe("onboarding progress", () => {
  const step = (
    position: number,
    status: InstanceStepRow["status"],
    extra: Partial<InstanceStepRow> = {},
  ): InstanceStepRow => ({
    id: `s${position}`,
    instance_id: "i",
    template_step_id: null,
    position,
    title: `Step ${position}`,
    description: null,
    responsible_label: null,
    due_date: null,
    required_document: null,
    completion_requirement: null,
    depends_on_position: null,
    status,
    completed_by: null,
    completed_at: null,
    created_at: "",
    updated_at: "",
    ...extra,
  });

  it("computes percent, next steps that are unblocked, and overdue items", () => {
    const p = summarizeProgress(
      [
        step(1, "done"),
        step(2, "pending", { due_date: "2026-01-01" }),
        step(3, "pending", { depends_on_position: 2 }),
        step(4, "skipped"),
      ],
      "2026-10-22",
    );
    expect(p.percent).toBe(50);
    expect(p.nextSteps.map((s) => s.position)).toEqual([2]);
    expect(p.overdue.map((s) => s.position)).toEqual([2]);
  });
});

describe("avatar validation", () => {
  it("identifies images by their bytes, not their names", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe("png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(
      sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe("webp");
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("specialist output handling", () => {
  it("parses JSON wrapped in prose or code fences", () => {
    expect(parseJsonObject('Sure!\n```json\n{"action":"final"}\n```')).toEqual({ action: "final" });
    expect(parseJsonObject("not json")).toBeNull();
  });

  it("drops citations that no tool returned", () => {
    const result = finalizeResult(
      {
        outcome: "answered",
        summary: "x",
        findings: [],
        sources: [
          { documentId: "real", title: "Real", excerpt: "" },
          { documentId: "made-up", title: "Fake", excerpt: "" },
        ],
        nextSteps: [],
        proposedActions: [],
        missingInformation: [],
        requiresHumanReview: false,
        artifacts: [
          {
            type: "report",
            id: "fake",
            title: "Model-claimed report",
            url: "/reports/fake",
            version: 1,
          },
        ],
      },
      new Map([["real", { documentId: "real", title: "Real SOP", excerpt: "text" }]]),
      ["approval-1"],
    );
    expect(result.sources).toEqual([{ documentId: "real", title: "Real SOP", excerpt: "text" }]);
    expect(result.proposedActions[0]?.approvalId).toBe("approval-1");
    // Reports the model merely claims are discarded; only tool-verified artifacts survive.
    expect(result.artifacts).toEqual([]);
  });
});

describe("backward compatibility", () => {
  beforeEach(async () => {
    await setupAgentTestEnv();
  });
  afterEach(() => {
    vi.doUnmock("@/lib/agents/registry");
    vi.resetModules();
  });

  it("lets Baxter answer normally when the AI Workforce tables are missing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/agents/registry", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/agents/registry")>()),
      getOrchestrator: async () => {
        throw new Error('relation "public.ai_agents" does not exist');
      },
    }));
    const { maybeDelegateBaxterRequest } = await import("@/lib/agents/orchestrator");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const req = {
      question: "What documents must a new hire complete?",
      channel: "web" as const,
      userId: null,
      userName: null,
      conversationId: "c",
      messageId: "m",
    };
    expect((await maybeDelegateBaxterRequest(req)).handled).toBe(false);
    // Second call within the back-off window doesn't even try (no log spam, no latency).
    expect((await maybeDelegateBaxterRequest({ ...req, messageId: "m2" })).handled).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
