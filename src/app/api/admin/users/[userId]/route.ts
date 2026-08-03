import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, ValidationError } from "@/lib/errors";
import { getReportStore } from "@/lib/research/report-store";
import { isUuid } from "@/lib/utils";
import { isSuperAdmin, BOOTSTRAP_SUPER_ADMIN_EMAIL } from "@/lib/auth/super-admin";
import { assignUserDepartment, assignUserDepartmentLabel } from "@/lib/org/departments";
import type { UserRole } from "@/lib/research/types";

const updateUserSchema = z.object({
  role: z.enum(["new_user", "user", "admin", "super_admin"]).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  department: z.string().max(120).nullable().optional(),
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
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");
    }

    if (
      parsed.data.role === undefined &&
      parsed.data.departmentId === undefined &&
      parsed.data.department === undefined
    ) {
      throw new ValidationError("Provide role, departmentId, and/or department");
    }

    const adminIsSuperAdmin = isSuperAdmin(admin);
    const nextRole = parsed.data.role;

    if (nextRole === "super_admin" && !adminIsSuperAdmin) {
      throw new AppError(
        `Only a super-admin (${BOOTSTRAP_SUPER_ADMIN_EMAIL}) can grant super_admin access.`,
        { code: "SUPER_ADMIN_REQUIRED", statusCode: 403, expose: true },
      );
    }

    if (
      userId === admin.id &&
      nextRole !== undefined &&
      nextRole !== "admin" &&
      nextRole !== "super_admin" &&
      adminIsSuperAdmin
    ) {
      throw new AppError("The super-admin account cannot demote itself.", {
        code: "SUPER_ADMIN_PROTECTED",
        statusCode: 400,
        expose: true,
      });
    }

    let profile = await getReportStore().getProfile(userId);
    if (!profile) {
      throw new AppError("Profile not found", {
        code: "PROFILE_NOT_FOUND",
        statusCode: 404,
        expose: true,
      });
    }

    if (nextRole !== undefined) {
      profile = await getReportStore().updateProfileRole(userId, nextRole as UserRole);
    }

    if (parsed.data.departmentId !== undefined) {
      profile = await assignUserDepartment(userId, parsed.data.departmentId);
    }

    if (parsed.data.department !== undefined) {
      profile = await assignUserDepartmentLabel(userId, parsed.data.department);
    }

    return jsonOk({ profile });
  } catch (error) {
    return jsonError(error, "PATCH /api/admin/users/[userId]");
  }
}
