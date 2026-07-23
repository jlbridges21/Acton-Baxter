import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { getReportStore } from "@/lib/research/report-store";
import { isUuid } from "@/lib/utils";

const updateRoleSchema = z.object({
  role: z.enum(["admin", "salesperson", "new_user"]),
});

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireAdmin();
    const { userId } = await context.params;
    if (!isUuid(userId)) {
      throw new ValidationError("Invalid user id");
    }

    const body = await request.json();
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid role");
    }

    const profile = await getReportStore().updateProfileRole(userId, parsed.data.role);
    return jsonOk({ profile });
  } catch (error) {
    return jsonError(error, "PATCH /api/admin/users/[userId]");
  }
}
