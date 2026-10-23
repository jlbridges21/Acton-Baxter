import { beforeEach, describe, expect, it } from "vitest";
import { listOfficeDelegations } from "@/lib/agents/office-activity";
import { createTask, patchTask } from "@/lib/agents/tasks";
import { setupAgentTestEnv } from "./agents-test-helpers";

async function delegate(key: string, assigning: string | null, title = "Confidential HR question") {
  const { task } = await createTask({
    idempotencyKey: key,
    initiatingUserId: null,
    initiatingUserLabel: "Test",
    channel: "web",
    assigningAgentId: assigning,
    assignedAgentId: "sam-id",
    configVersionId: null,
    taskType: "delegated_request",
    title,
    instructions: "Secret instructions",
    delegationDepth: 1,
    routing: {},
    allowedContext: {},
    sensitivity: "confidential",
  });
  return task;
}

describe("listOfficeDelegations", () => {
  beforeEach(async () => {
    await setupAgentTestEnv();
  });

  it("returns active and recently finished delegations as ids, status, and timestamps only", async () => {
    const running = await delegate("a", "baxter-id");
    const done = await delegate("b", "baxter-id");
    await patchTask(done.id, { status: "completed", completed_at: new Date().toISOString() });
    await delegate("c", null); // direct chat with a specialist: not a delegation

    const rows = await listOfficeDelegations();
    expect(rows.map((r) => r.id).sort()).toEqual([running.id, done.id].sort());
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "completedAt",
          "createdAt",
          "fromAgentId",
          "id",
          "startedAt",
          "status",
          "toAgentId",
        ].sort(),
      );
      expect(JSON.stringify(row)).not.toMatch(/Confidential|Secret/);
    }
  });

  it("drops delegations that finished long ago", async () => {
    const old = await delegate("old", "baxter-id");
    await patchTask(old.id, {
      status: "failed",
      completed_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    expect(await listOfficeDelegations()).toEqual([]);
  });
});
