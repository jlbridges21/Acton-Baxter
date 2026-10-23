import { describe, expect, it } from "vitest";
import { EMPTY_AMBIENT_MEMORY, planAmbient, type AmbientContext } from "@/lib/office/ambient";
import type { Hotspot } from "@/lib/office/navigation";
import {
  EVENT_FRESH_MS,
  activeDelegations,
  modeFromRuntime,
  reconcile,
  seedCoordinator,
  type DelegationSnapshot,
} from "@/lib/office/task-coordinator";

function rng(seed = 3) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const SPOTS: Hotspot[] = ["window", "shelf", "plant", "center", "corner"].map((name, i) => ({
  id: `idle:exec:${name}`,
  kind: "idle",
  roomKey: "exec",
  x: 60 + i * 60,
  y: 120 + (i % 2) * 60,
}));

function ctx(over: Partial<AmbientContext> = {}): AmbientContext {
  return {
    rng: rng(),
    now: 0,
    intensity: "normal",
    position: { x: 10, y: 10 },
    seated: false,
    canSit: true,
    spots: SPOTS,
    randomPoint: () => ({ x: 200, y: 200 }),
    memory: EMPTY_AMBIENT_MEMORY,
    ...over,
  };
}

describe("ambient behaviour", () => {
  it("varies activities, never repeats the same one twice in a row, and spaces out desk visits", () => {
    let memory = EMPTY_AMBIENT_MEMORY;
    const r = rng(11);
    const seen: string[] = [];
    const deskTimes: number[] = [];
    let now = 0;
    for (let i = 0; i < 80; i++) {
      const p = planAmbient(ctx({ rng: r, now, memory }));
      seen.push(p.activity);
      if (p.activity === "desk") deskTimes.push(now);
      memory = p.memory;
      now += 9000;
    }
    expect(new Set(seen)).toEqual(new Set(["desk", "look", "think", "wander"]));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    for (let i = 1; i < deskTimes.length; i++)
      expect(deskTimes[i]! - deskTimes[i - 1]!).toBeGreaterThanOrEqual(40000);
  });

  it("does not revisit the spot it just used", () => {
    const first = planAmbient(
      ctx({ rng: () => 0.5, memory: { ...EMPTY_AMBIENT_MEMORY, last: "desk", lastDeskAt: 0 } }),
    );
    if (first.memory.lastSpot) {
      const second = planAmbient(
        ctx({ rng: () => 0.5, now: 1, memory: { ...first.memory, last: "wander" } }),
      );
      expect(second.memory.lastSpot).not.toBe(first.memory.lastSpot);
    }
  });

  it("the desk routine sits, works briefly, and stands only after a believable pause", () => {
    const p = planAmbient(ctx({ rng: () => 0.01 }));
    expect(p.activity).toBe("desk");
    const kinds = p.actions.map((a) => a.kind);
    expect(kinds.slice(0, 5)).toEqual(["sit", "seated", "seated", "seated", "stand"]);
    const seatedMs = p.actions
      .filter((a): a is Extract<typeof a, { kind: "seated" }> => a.kind === "seated")
      .reduce((s, a) => s + (a.ms ?? 0), 0);
    expect(seatedMs).toBeGreaterThanOrEqual(10000);
  });

  it("when already seated, stays seated for a while before standing", () => {
    const p = planAmbient(ctx({ seated: true }));
    expect(p.actions[0]).toMatchObject({ kind: "seated" });
    expect((p.actions[0] as { ms: number }).ms).toBeGreaterThan(5000);
  });

  it("off: no decorative movement at all", () => {
    const p = planAmbient(ctx({ intensity: "off" }));
    expect(p.actions).toEqual([{ kind: "seated", mode: "idle", ms: null, micro: false }]);
    expect(p.actions.some((a) => a.kind === "walk")).toBe(false);
  });

  it("is pure: planning never touches the network", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("no network in ambient planning");
    }) as typeof fetch;
    try {
      let memory = EMPTY_AMBIENT_MEMORY;
      for (let i = 0; i < 50; i++) memory = planAmbient(ctx({ now: i * 50000, memory })).memory;
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });
});

const T0 = Date.parse("2026-10-22T18:00:00.000Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
function task(
  id: string,
  status: string,
  createdMs = 0,
  completedMs: number | null = null,
): DelegationSnapshot {
  return {
    id,
    fromAgentId: "baxter",
    toAgentId: "sam",
    status,
    createdAt: iso(createdMs),
    startedAt: status === "queued" ? null : iso(createdMs + 100),
    completedAt: completedMs === null ? null : iso(completedMs),
  };
}

describe("task animation coordinator", () => {
  it("maps runtime states to modes", () => {
    expect(modeFromRuntime("working")).toBe("working");
    expect(modeFromRuntime("receiving")).toBe("receiving");
    expect(modeFromRuntime("awaiting_result")).toBe("waiting");
    expect(modeFromRuntime("awaiting_approval")).toBe("approval");
    expect(modeFromRuntime("failed")).toBe("failed");
    expect(modeFromRuntime("idle")).toBe("ambient");
    expect(modeFromRuntime(undefined)).toBe("ambient");
  });

  it("a real new delegation produces exactly one hand-off, then one result", () => {
    let state = seedCoordinator([], iso(0));
    let r = reconcile(state, { delegations: [task("t1", "queued", 1000)], serverTime: iso(1500) });
    expect(r.events).toEqual([
      { type: "handoff", taskId: "t1", fromAgentId: "baxter", toAgentId: "sam" },
    ]);
    state = r.state;
    // Same snapshot again (poll + Realtime both fire): no duplicate.
    r = reconcile(state, { delegations: [task("t1", "running", 1000)], serverTime: iso(2500) });
    expect(r.events).toEqual([]);
    state = r.state;
    r = reconcile(state, {
      delegations: [task("t1", "completed", 1000, 6000)],
      serverTime: iso(6500),
    });
    expect(r.events).toEqual([
      {
        type: "result",
        taskId: "t1",
        fromAgentId: "baxter",
        toAgentId: "sam",
        outcome: "completed",
      },
    ]);
    r = reconcile(r.state, {
      delegations: [task("t1", "completed", 1000, 6000)],
      serverTime: iso(9000),
    });
    expect(r.events).toEqual([]);
  });

  it("no task, no animation: an empty snapshot creates nothing", () => {
    const r = reconcile(seedCoordinator([], iso(0)), { delegations: [], serverTime: iso(5000) });
    expect(r.events).toEqual([]);
  });

  it("a task that finished before we saw it running yields only a result (no walk)", () => {
    const r = reconcile(seedCoordinator([], iso(0)), {
      delegations: [task("fast", "completed", 1000, 1200)],
      serverTime: iso(2000),
    });
    expect(r.events.map((e) => e.type)).toEqual(["result"]);
  });

  it("failed tasks are reported as failures", () => {
    let state = reconcile(seedCoordinator([], iso(0)), {
      delegations: [task("f", "running")],
      serverTime: iso(500),
    }).state;
    const r = reconcile(state, {
      delegations: [task("f", "failed", 0, 900)],
      serverTime: iso(1000),
    });
    state = r.state;
    expect(r.events).toEqual([
      { type: "result", taskId: "f", fromAgentId: "baxter", toAgentId: "sam", outcome: "failed" },
    ]);
  });

  it("ignores stale snapshots and out-of-order statuses", () => {
    let state = seedCoordinator([], iso(0));
    state = reconcile(state, {
      delegations: [task("t", "completed", 0, 2000)],
      serverTime: iso(3000),
    }).state;
    // An older poll arriving late.
    expect(
      reconcile(state, { delegations: [task("t", "running")], serverTime: iso(2500) }).events,
    ).toEqual([]);
    // A newer response that still carries an older status for the task.
    expect(
      reconcile(state, { delegations: [task("t", "running")], serverTime: iso(4000) }).events,
    ).toEqual([]);
  });

  it("after a page refresh, existing work is shown as state and history is not replayed", () => {
    const existing = [task("done", "completed", 0, 500), task("live", "running", 0)];
    const state = seedCoordinator(existing, iso(1000));
    expect(reconcile(state, { delegations: existing, serverTime: iso(2000) }).events).toEqual([]);
    expect(activeDelegations(existing).map((d) => d.id)).toEqual(["live"]);
    // The live one still finishes normally later.
    const r = reconcile(state, {
      delegations: [task("live", "completed", 0, 3000)],
      serverTime: iso(3500),
    });
    expect(r.events.map((e) => e.type)).toEqual(["result"]);
  });

  it("old events seen for the first time are not animated as new", () => {
    const r = reconcile(seedCoordinator([], iso(0)), {
      delegations: [task("old", "running", 0)],
      serverTime: iso(EVENT_FRESH_MS + 5000),
    });
    expect(r.events).toEqual([]);
  });
});
