import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, ValidationError } from "@/lib/errors";
import { getReportStore } from "@/lib/research/report-store";
import { isUuid } from "@/lib/utils";

const SUPER_ADMIN_EMAIL = "baxter@actonadu.com";

const updateRoleSchema = z.object({
  role: z.enum(["admin", "salesperson", "new_user"]),
});

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const admin = await requireAdmin();
    const { userId } = await context.params;
    if (!isUuid(userId)) {
      throw new ValidationError("Invalid user id");
    }

    const body = await request.json();
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid role");
    }

    const nextRole = parsed.data.role;
    const isSuperAdmin = admin.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;

    if (nextRole === "admin" && !isSuperAdmin) {
      throw new AppError(
        "Only the super-admin (baxter@actonadu.com) can grant admin access. You can grant salesperson access.",
        { code: "SUPER_ADMIN_REQUIRED", statusCode: 403, expose: true },
      );
    }

    if (userId === admin.id && nextRole !== "admin" && isSuperAdmin) {
      throw new AppError("The super-admin account cannot demote itself.", {
        code: "SUPER_ADMIN_PROTECTED",
        statusCode: 400,
        expose: true,
      });
    }

    const profile = await getReportStore().updateProfileRole(userId, nextRole);
    return jsonOk({ profile });
  } catch (error) {
    return jsonError(error, "PATCH /api/admin/users/[userId]");
  }
}
