import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { createProjectSetupRunSchema } from "@/lib/project-setup/validation";
import { buildDerivedProjectNames } from "@/lib/project-setup/names";
import { createProjectSetupRun, isProjectNumberInUse } from "@/lib/project-setup/store";
import { loadProjectSetupContactSnapshot } from "@/lib/project-setup/service";
import { enqueueProjectSetupRun } from "@/lib/project-setup/enqueue";
import type { ProjectSetupContactSnapshot } from "@/lib/project-setup/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const rate = checkRateLimit(`project-setup-create:${user.id}`, {
      limit: 10,
      windowMs: 60_000,
    });
    if (!rate.allowed) throw new RateLimitError();

    const body = await request.json();
    const parsed = createProjectSetupRunSchema.parse(body);

    const inUse = await isProjectNumberInUse(parsed.projectNumber);
    if (inUse) {
      throw new AppError(
        `Project number ${parsed.projectNumber} is already in use by another active setup run.`,
        { code: "CONFLICT", statusCode: 409 },
      );
    }

    let contactSnapshot: ProjectSetupContactSnapshot;
    if (parsed.contactSnapshot?.id) {
      contactSnapshot = {
        id: parsed.contactSnapshot.id,
        name: parsed.contactSnapshot.name ?? null,
        firstName: parsed.contactSnapshot.firstName ?? null,
        lastName: parsed.contactSnapshot.lastName ?? null,
        email: parsed.contactSnapshot.email ?? null,
        phone: parsed.contactSnapshot.phone ?? null,
        address: parsed.contactSnapshot.address ?? null,
        city: parsed.contactSnapshot.city ?? null,
        state: parsed.contactSnapshot.state ?? null,
        postalCode: parsed.contactSnapshot.postalCode ?? null,
        assignedUserId: parsed.contactSnapshot.assignedUserId ?? null,
        assignedUserName: parsed.contactSnapshot.assignedUserName ?? null,
      };
    } else {
      contactSnapshot = await loadProjectSetupContactSnapshot(parsed.ghlContactId);
    }

    const derived = buildDerivedProjectNames({
      projectNumber: parsed.projectNumber,
      lastName: parsed.projectLastName,
    });

    const { run } = await createProjectSetupRun({
      initiatedBy: user.id,
      triggerChannel: "web",
      dryRun: true,
      ghlContactId: parsed.ghlContactId,
      contactSnapshot,
      salesRep: parsed.salesRep.trim(),
      projectNumber: parsed.projectNumber,
      projectLastName: derived.projectLastName,
      folderName: derived.folderName,
      charterName: derived.charterName,
      slackChannelName: derived.slackChannelName,
      fpPaidDate: parsed.fpPaidDate,
    });

    const { jobId } = await enqueueProjectSetupRun(run.id);

    return jsonOk({
      runId: run.id,
      jobId,
      status: run.status,
      dryRun: run.dryRun,
    });
  } catch (error) {
    return jsonError(error, "POST /api/projects/setup");
  }
}
