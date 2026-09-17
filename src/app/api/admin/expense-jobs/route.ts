import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import {
  createCustomExpenseJob,
  expenseJobCreateSchema,
  expenseJobReorderSchema,
  expenseJobUpdateSchema,
  listExpenseJobs,
  reorderExpenseJobs,
  syncExpenseJobsFromMasterProjectLog,
  updateExpenseJob,
} from "@/lib/receipts";
import { z } from "zod";

export async function GET() {
  try {
    await requireAdmin();
    const jobs = await listExpenseJobs({ includeInactive: true });
    return jsonOk({ jobs });
  } catch (error) {
    return jsonError(error, "GET /api/admin/expense-jobs");
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_custom"),
    job: expenseJobCreateSchema,
  }),
  z.object({
    action: z.literal("update"),
    job: expenseJobUpdateSchema,
  }),
  z.object({
    action: z.literal("reorder"),
    reorder: expenseJobReorderSchema,
  }),
  z.object({
    action: z.literal("sync_projects"),
  }),
]);

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const parsed = actionSchema.parse(body);

    if (parsed.action === "create_custom") {
      const job = await createCustomExpenseJob({
        label: parsed.job.label,
        sortOrder: parsed.job.sortOrder,
        isActive: parsed.job.isActive,
        createdBy: user.id,
      });
      return jsonOk({ job });
    }

    if (parsed.action === "update") {
      const job = await updateExpenseJob({
        id: parsed.job.id,
        label: parsed.job.label,
        sortOrder: parsed.job.sortOrder,
        isActive: parsed.job.isActive,
        updatedBy: user.id,
      });
      return jsonOk({ job });
    }

    if (parsed.action === "reorder") {
      await reorderExpenseJobs(parsed.reorder.orderedIds, user.id);
      const jobs = await listExpenseJobs({ includeInactive: true });
      return jsonOk({ jobs });
    }

    const sync = await syncExpenseJobsFromMasterProjectLog({ updatedBy: user.id });
    const jobs = await listExpenseJobs({ includeInactive: true });
    return jsonOk({
      jobs,
      sync: { upserted: sync.upserted, deactivatedMissing: sync.deactivatedMissing },
    });
  } catch (error) {
    return jsonError(error, "POST /api/admin/expense-jobs");
  }
}
